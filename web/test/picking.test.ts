/**
 * The pick path's one piece of arithmetic-free logic: what an id-buffer answer *means*.
 *
 * The bug these cover: `IdPicker.pick` used to return `-1` when a readback was already in flight,
 * which is the same value it returns for "nothing under the pointer". The click path had no way to
 * tell the two apart, so it fell through to the plane raycast and a click on a star selected the
 * star's plane — with `focused` set to `-1` and the hover highlight dropped at the same moment.
 * The frame loop happened to be guarded by `!idPicker.pending`; `pointerup` was not.
 *
 * No GPU here. The renderer is a fake whose readback resolves when the test says so, which is the
 * only way to hold a read open across another call deterministically.
 */

import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three'

import { IdPicker, PICK_BUSY, PICK_MISS } from '../src/scene/picking/idPicker'
import { resolvePick } from '../src/scene/picking/scenePicker'

const PICK_SIZE = 11
const CENTRE_PIXEL = ((PICK_SIZE - 1) / 2) * PICK_SIZE + (PICK_SIZE - 1) / 2

/**
 * A renderer that records what it was asked to do and hands back control of every readback.
 *
 * `ids` is the queue of star indices successive reads should report; `-1` writes an empty window
 * (a genuine miss). Each read parks until the matching `release` is called.
 */
/** Let queued microtasks and timers run. Reads start one microtask after the call that asks. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function fakeRenderer(ids: readonly number[]): {
  renderer: WebGLRenderer
  release: (index: number) => Promise<void>
  reads: number
} {
  const releases: (() => void)[] = []
  const state = { reads: 0 }
  const renderer = {
    domElement: { width: 1920, height: 1080 },
    getRenderTarget: () => null,
    getClearAlpha: () => 1,
    getClearColor: (target: { setHex: (hex: number) => void }) => target,
    setClearColor: () => {},
    setRenderTarget: () => {},
    clear: () => {},
    render: () => {},
    readRenderTargetPixelsAsync: (
      _target: unknown,
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      pixels: Uint8Array,
    ) => {
      const id = ids[state.reads] ?? -1
      state.reads += 1
      pixels.fill(0)
      if (id >= 0) {
        // The picker decodes `id + 1` from RGB and treats alpha 0 as "no star here".
        const offset = CENTRE_PIXEL * 4
        pixels[offset] = (id + 1) & 0xff
        pixels[offset + 1] = ((id + 1) >> 8) & 0xff
        pixels[offset + 2] = ((id + 1) >> 16) & 0xff
        pixels[offset + 3] = 255
      }
      return new Promise<void>((resolve) => releases.push(() => resolve()))
    },
  } as unknown as WebGLRenderer
  return {
    renderer,
    // Waits for the read to actually start before releasing it, so a test never races the
    // microtask that hands a queued pick its turn.
    release: async (index: number): Promise<void> => {
      for (let spin = 0; spin < 100 && releases.length <= index; spin += 1) await flush()
      if (releases.length <= index) throw new Error(`read ${index} never started`)
      releases[index]!()
      await flush()
    },
    get reads() {
      return state.reads
    },
  }
}

function scenery(): { scene: Scene; camera: PerspectiveCamera } {
  return { scene: new Scene(), camera: new PerspectiveCamera(50, 16 / 9, 0.1, 1000) }
}

describe('IdPicker busy vs miss', () => {
  it('reports PICK_BUSY, not a miss, while a read is in flight', async () => {
    const picker = new IdPicker()
    const { renderer, release } = fakeRenderer([12])
    const { scene, camera } = scenery()

    const first = picker.pick(renderer, scene, camera, 960, 540)
    // The read is open. This is the state a click used to arrive in.
    expect(picker.pending).toBe(true)

    const second = await picker.pick(renderer, scene, camera, 960, 540)
    // The regression: this used to be PICK_MISS, and PICK_MISS sends the caller to the plane
    // raycast. It must be distinguishable.
    expect(second).toBe(PICK_BUSY)
    expect(second).not.toBe(PICK_MISS)

    await release(0)
    expect(await first).toBe(12)
    picker.dispose()
  })

  it('pickQueued waits its turn and returns its own read rather than PICK_BUSY', async () => {
    const picker = new IdPicker()
    const { renderer, release } = fakeRenderer([12, 7])
    const { scene, camera } = scenery()

    const hover = picker.pick(renderer, scene, camera, 100, 100)
    expect(picker.pending).toBe(true)

    // The click arrives mid-hover. It must get a real answer from the id buffer.
    const click = picker.pickQueued(renderer, scene, camera, 960, 540)
    await release(0)
    expect(await hover).toBe(12)

    // The queued read only starts once the first settles, so its release is the second one.
    await release(1)
    expect(await click).toBe(7)
    picker.dispose()
  })

  it('still reports PICK_MISS for an empty window', async () => {
    const picker = new IdPicker()
    const { renderer, release } = fakeRenderer([-1])
    const { scene, camera } = scenery()

    const pick = picker.pickQueued(renderer, scene, camera, 960, 540)
    await release(0)
    expect(await pick).toBe(PICK_MISS)
    picker.dispose()
  })

  it('a failed read does not wedge the queue', async () => {
    const picker = new IdPicker()
    const { scene, camera } = scenery()
    let calls = 0
    const renderer = {
      domElement: { width: 1920, height: 1080 },
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: (target: unknown) => target,
      setClearColor: () => {},
      setRenderTarget: () => {},
      clear: () => {},
      render: () => {},
      readRenderTargetPixelsAsync: (
        _t: unknown,
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        pixels: Uint8Array,
      ) => {
        calls += 1
        if (calls === 1) return Promise.reject(new Error('context lost'))
        pixels.fill(0)
        const offset = CENTRE_PIXEL * 4
        pixels[offset] = 4
        pixels[offset + 3] = 255
        return Promise.resolve()
      },
    } as unknown as WebGLRenderer

    await expect(picker.pickQueued(renderer, scene, camera, 1, 1)).rejects.toThrow('context lost')
    expect(picker.pending).toBe(false)
    expect(await picker.pickQueued(renderer, scene, camera, 1, 1)).toBe(3)
    picker.dispose()
  })
})

describe('IdPicker.distanceTo — the self-check measurement', () => {
  /** Write `id` into the window at (dx, dy) from the centre. */
  function windowWith(entries: readonly { id: number; dx: number; dy: number }[]): Uint8Array {
    const pixels = new Uint8Array(PICK_SIZE * PICK_SIZE * 4)
    for (const { id, dx, dy } of entries) {
      const centre = (PICK_SIZE - 1) / 2
      const offset = ((centre + dy) * PICK_SIZE + (centre + dx)) * 4
      pixels[offset] = (id + 1) & 0xff
      pixels[offset + 1] = ((id + 1) >> 8) & 0xff
      pixels[offset + 2] = ((id + 1) >> 16) & 0xff
      pixels[offset + 3] = 255
    }
    return pixels
  }

  async function pickWindow(entries: readonly { id: number; dx: number; dy: number }[]) {
    const picker = new IdPicker()
    const { scene, camera } = scenery()
    const pixels = windowWith(entries)
    const renderer = {
      domElement: { width: 1920, height: 1080 },
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: (target: unknown) => target,
      setClearColor: () => {},
      setRenderTarget: () => {},
      clear: () => {},
      render: () => {},
      readRenderTargetPixelsAsync: (
        _t: unknown,
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        out: Uint8Array,
      ) => {
        out.set(pixels)
        return Promise.resolve()
      },
    } as unknown as WebGLRenderer
    const picked = await picker.pickQueued(renderer, scene, camera, 960, 540)
    return { picker, picked }
  }

  it('measures a nominated star even when a nearer one wins the pick', async () => {
    // Star 3 sits on the centre pixel; star 9 is four pixels away. A click gets 3 — correctly.
    // The self-check is asking a different question: where did the shader draw star 9?
    const { picker, picked } = await pickWindow([
      { id: 3, dx: 0, dy: 0 },
      { id: 9, dx: 4, dy: 0 },
    ])
    expect(picked).toBe(3)
    expect(picker.distanceTo(9)).toBe(4)
    // The regression this guards: scoring star 9 by what came back would compare it against star
    // 3's mirrored position, and an error the two share would cancel and read as agreement.
    expect(picker.distanceTo(3)).toBe(0)
    picker.dispose()
  })

  it('reports -1 for a star that is not in the window', async () => {
    const { picker } = await pickWindow([{ id: 3, dx: 0, dy: 0 }])
    expect(picker.distanceTo(41)).toBe(-1)
    picker.dispose()
  })

  it('returns the nearest occurrence of a star that covers several pixels', async () => {
    const { picker } = await pickWindow([
      { id: 5, dx: 3, dy: 0 },
      { id: 5, dx: 1, dy: 0 },
    ])
    expect(picker.distanceTo(5)).toBe(1)
    picker.dispose()
  })
})

describe('resolvePick — PRD 8.5.6 precedence', () => {
  const planeRowOf = (index: number): number => (index < 50 ? 0 : 3)

  it('never consults the plane raycast when the id buffer was not asked', () => {
    const pickPlane = vi.fn(() => 2)
    const resolved = resolvePick(PICK_BUSY, 500, planeRowOf, pickPlane)

    // The bug, stated as an assertion: a busy pick is not a miss and must not become a plane hit.
    expect(resolved).toBeUndefined()
    expect(pickPlane).not.toHaveBeenCalled()
  })

  it('takes the star when the id buffer hits', () => {
    const pickPlane = vi.fn(() => 2)
    expect(resolvePick(104, 500, planeRowOf, pickPlane)).toEqual({
      kind: 'star',
      index: 104,
      planeIndex: 3,
    })
    expect(pickPlane).not.toHaveBeenCalled()
  })

  it('falls through to the plane on a genuine miss', () => {
    expect(resolvePick(PICK_MISS, 500, planeRowOf, () => 2)).toEqual({ kind: 'plane', index: 2 })
  })

  it('reports empty space when neither hits', () => {
    expect(resolvePick(PICK_MISS, 500, planeRowOf, () => -1)).toBeNull()
  })

  it('treats an id past the drawn range as a miss', () => {
    // Streaming grows `drawCount`; an id from a stale pick pass can outrun it.
    expect(resolvePick(600, 500, planeRowOf, () => 2)).toEqual({ kind: 'plane', index: 2 })
  })
})
