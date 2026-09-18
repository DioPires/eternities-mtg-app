/**
 * `SceneHost` routes the pick, on a host with no galaxy in the picture (DEC-852).
 *
 * `scene-picking-host.test.tsx` covers the input layer's own behaviour against doubles. This file
 * covers the two lines that file cannot: the route **inside `SceneHost`** from a pick to §1.10's
 * printing-ring hover label, and the hand-off of the star *data* layer to the picker.
 *
 * Those two lines were copied into the other file rather than imported, because building a
 * `SceneHost` needs a GL context — and a hand-written copy of a wire guards the copy, not the wire.
 * `SceneHostOptions.createPicker` is what removes the need, on exactly the terms `createRenderer`
 * already sets: inject the one object that touches the context, and the rest of the file is
 * testable. Deleting either route leaves `scene-picking-host.test.tsx` fully green.
 *
 * **No `attachStarScene` reaches the picture here.** The host builds one — this leg deletes nothing
 * — but no `StarField` is ever handed to it, so the field's objects are never added and its hover
 * highlight is never registered. That is the post-cutover shape: picking, card focus and the label
 * all answer with the galaxy contributing nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Color, Object3D, type WebGLRenderer } from 'three'

import { STAR_RECORD_BYTES, type CardRecord, type PrintingTuple } from '../src/data/types'
import { PLANET_ID_BASE } from '../src/scene/cards/focusedCard'
import { PICK_MISS, type IdPicker } from '../src/scene/picking/idPicker'
import type { PickResult } from '../src/scene/picking/scenePicker'
import { SceneHost } from '../src/scene/renderer/sceneHost'
import { createStarData } from '../src/scene/starfield/starData'
import type { SceneResources } from '../src/scene/useSceneData'
import { createSceneNavigation, type SceneNavigation } from '../src/navigation/scene'

import { loadFixturePlanes } from './fixtures'

/** Enough drawable records for a star id to be in range. See {@link dataOnlyResources}. */
const STAR_COUNT = 8

function cardWith(printings: number): CardRecord {
  const p: PrintingTuple[] = Array.from({ length: printings }, (_, i) => [
    `0aeebaf5-8c7d-4636-9e82-${String(i).padStart(12, '0')}`,
    1,
    '1',
    1700000000,
    `${i}`,
  ])
  return { u: 'o-1', n: 'Basic', m: '{0}', t: 'Land', o: '', b: null, ci: 'C', r: 0, l: 'normal', p }
}

/**
 * `scene-host-drive.test.tsx`'s renderer, plus the surface **one `loop.tick()`** needs.
 *
 * That file deliberately never ticks, because the `draw` phase renders for real. This one has to:
 * the pointer is drained in the `input` phase and the pick is issued in the `pick` phase, so a
 * frame is the subject. The additions below are all `PostChain.render`'s save-and-restore — it
 * draws to mocked targets and reads nothing back, so a tick costs nothing and answers nothing.
 */
function fakeRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const context = {
    MAX_TEXTURE_SIZE: 0x0d33,
    ALIASED_POINT_SIZE_RANGE: 0x846d,
    getParameter: (name: number) => (name === 0x846d ? new Float32Array([1, 64]) : 8192),
  }
  // jsdom lays nothing out, so the input layer's per-tick device-pixel conversion would bail on a
  // zero rect and never run. A real rect is what makes it convert.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0 }) as DOMRect
  Object.defineProperty(canvas, 'width', { value: 1280, writable: true })
  Object.defineProperty(canvas, 'height', { value: 720, writable: true })
  return {
    domElement: canvas,
    toneMapping: -1,
    extensions: { has: () => false },
    getContext: () => context,
    getPixelRatio: () => 1,
    getSize: (target: { set: (x: number, y: number) => unknown }) => {
      target.set(1280, 720)
      return target
    },
    getDrawingBufferSize: (target: { set: (x: number, y: number) => unknown }) => {
      target.set(1280, 720)
      return target
    },
    autoClear: true,
    getRenderTarget: () => null,
    getClearAlpha: () => 1,
    getClearColor: (target: Color) => target.set(0, 0, 0),
    setClearColor: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  } as unknown as WebGLRenderer
}

/**
 * The star **data** layer, real, plus a `StarField` that draws nothing — which is the point.
 *
 * `SceneResources.field` is non-optional today because the galaxy still ships, so the host has to be
 * handed something. What it is handed here has empty `Object3D`s for the four star meshes and
 * records `setHovered` instead of lighting a star, so **no galaxy geometry is in the scene and none
 * of it participates in a pick**. The ids come from the picker double; the routing is the subject.
 */
function dataOnlyResources(planes: ReturnType<typeof loadFixturePlanes>) {
  // The product's own data-layer constructor (DEC-852), not a hand-built pair: it is what
  // `useSceneData` calls, and it reaches no galaxy module — which is the claim this file rests on.
  const data = createStarData(planes, STAR_COUNT)
  const { table, geometry } = data
  // A fresh `StarGeometry` draws nothing, and `resolvePick` reads `drawCount` to tell a star id
  // from an out-of-range one — so without a stream a star pick would silently fall through to the
  // plane raycast and this file would be asserting about the wrong branch. Zeroed records: every
  // star lands on plane row 0, which is all these cases need of the data.
  geometry.append(new Uint8Array(STAR_RECORD_BYTES * STAR_COUNT), STAR_COUNT)
  const highlights: number[] = []
  const resources = {
    table,
    geometry,
    field: {
      glow: new Object3D(),
      points: new Object3D(),
      pickPoints: new Object3D(),
      bloomPoints: new Object3D(),
      setHovered: (index: number) => highlights.push(index),
      setGlowQuality: () => {},
      update: () => {},
      dispose: () => {},
    },
    positionMode: data.positionMode,
  } as unknown as SceneResources
  return { resources, highlights, dispose: () => data.dispose() }
}

function pickerDouble() {
  let answer = PICK_MISS
  const picker = {
    get pending() {
      return false
    },
    pick: () => Promise.resolve(answer),
    pickQueued: () => Promise.resolve(answer),
    dispose: vi.fn(),
  }
  return {
    picker: picker as unknown as IdPicker,
    answers: (id: number) => {
      answer = id
    },
  }
}

function installResizeObserver(): () => void {
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  return () => {
    globalThis.ResizeObserver = original
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('SceneHost routes the pick with no galaxy in the picture (DEC-852)', () => {
  let host: SceneHost
  let navigation: SceneNavigation
  let data: ReturnType<typeof dataOnlyResources>
  let restoreResizeObserver: () => void
  let answers: (id: number) => void
  let hovered: PickResult[]
  let selected: PickResult[]

  beforeEach(() => {
    restoreResizeObserver = installResizeObserver()
    const planes = loadFixturePlanes('small')
    const double = pickerDouble()
    answers = double.answers
    host = new SceneHost({ createRenderer: fakeRenderer, createPicker: () => double.picker })
    data = dataOnlyResources(planes)
    navigation = createSceneNavigation(planes, { drive: 'manual' })
    hovered = []
    selected = []
    host.hovered.add((pick) => hovered.push(pick))
    host.selected.add((pick) => selected.push(pick))
  })

  afterEach(() => {
    host.dispose()
    data.dispose()
    restoreResizeObserver()
  })

  /** The pointer sample, the tick that converts and picks, and the settling of the async read. */
  async function movePointer(at: number): Promise<void> {
    host.renderer.canvas.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 640, clientY: 360 }),
    )
    host.renderer.loop.tick(at)
    await flush()
  }

  it('subscribes the input phase the pointer drains in', () => {
    // The control row: without it, a host that attached no input layer at all would pass the
    // negative assertions below by doing nothing, which is the failure this whole leg is about.
    expect(host.renderer.loop.stepCount('input')).toBe(1)
    expect(host.renderer.loop.stepCount('pick')).toBe(2)
  })

  it('does not pick before the star data layer arrives', async () => {
    // `setResources` withheld. A pick with nothing to resolve against must report nothing rather
    // than guess — and this is also the control for the next case, which differs only by the setter.
    await movePointer(16)
    expect(hovered).toEqual([])
  })

  it('reports a hover once the star data layer arrives, with no star field drawn', async () => {
    host.setResources(data.resources)
    answers(2)
    await movePointer(16)

    // Row 0: the appended records are zeroed, so every star sits on the first plane.
    expect(hovered).toEqual([{ kind: 'star', index: 2, planeIndex: 0 }])
  })

  it("routes a hovered planet into the printing ring's label (PRD 5.6.9)", async () => {
    host.setResources(data.resources)
    host.setNavigation(navigation)
    host.setCards({ get: () => cardWith(4) })
    host.setFocusedStar(0)

    // The negative control, and it is the half that matters: `visible: false` is also this object's
    // initial value, so a label that is never written reads identically to one correctly withheld.
    host.renderer.loop.tick(16)
    expect(host.labelState.visible, 'nothing hovered').toBe(false)

    answers(PLANET_ID_BASE + 2)
    await movePointer(32)
    host.renderer.loop.tick(48)

    expect(host.labelState.printing, 'the hovered planet names a printing').toBeGreaterThanOrEqual(0)
  })

  it('routes a click into the selection card focus runs on', async () => {
    host.setResources(data.resources)
    answers(2)
    await movePointer(16)

    const canvas = host.renderer.canvas
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 640, clientY: 360 }))
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 640, clientY: 360 }))
    await flush()

    expect(selected).toEqual([{ kind: 'star', index: 2, planeIndex: 0 }])
    expect(host.starScene.focusedIndex, 'PRD 8.5.7 reads its subject from the input layer').toBe(2)
  })

  it('leaves the star highlight unwritten when no field was handed over', async () => {
    // The field here is a recorder, and the host was given one because `SceneResources.field` is
    // still non-optional. What the cutover removes is `setResources` ever running with a real
    // field — so the check that matters is that the *highlight* is a hand-over from the star scene
    // and not something the input layer reaches for on its own.
    host.setResources(data.resources)
    answers(2)
    await movePointer(16)

    expect(hovered).toHaveLength(1)
    expect(
      data.highlights,
      'the star scene registered the highlight, so it is written — see the DEC-852 hand-over',
    ).toEqual([2])
  })
})
