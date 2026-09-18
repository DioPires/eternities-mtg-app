/**
 * The input layer survives the galaxy (DEC-852).
 *
 * `picking.test.ts` covers what `IdPicker` reads back and `pick-floor*.test.ts` cover where a plane
 * sits under the pointer. This file covers the thing none of them can see: that something still
 * **attaches** a pointer listener, runs PRD 8.5.6's pick against the star *data* layer, and routes
 * the answer out to the two consumers `SceneHost` wires — §1.10's printing-ring hover label and the
 * selection that card focus runs on.
 *
 * All of that used to live in `scene/starScene.ts`, the module worlds spec §3.2 names for deletion
 * as "the galaxy scene". Deleting it would have taken every pointer listener in the app with it,
 * with a green build and a still-rendering `<PlanetHoverLabel>`, because nothing type-checks the
 * *absence* of an `addEventListener`. W1–W5 read neither surface.
 *
 * **The structural claim is made by what this file does not import.** There is no `starScene` here
 * and no `StarField` in the scene graph — this is the post-cutover shape, built today. If picking
 * were re-entangled with the galaxy scene, these cases could not be written at all, which is a
 * stronger guard than any assertion about the text of `starScene.ts` would be.
 */

import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'

import type { CardRecord, PrintingTuple } from '../src/data/types'
import { attachFocusedCard, type PlanetLabelState } from '../src/scene/cards/focusedCardHost'
import { PLANET_ID_BASE } from '../src/scene/cards/focusedCard'
import { attachScenePicking, type PickSources } from '../src/scene/input/attachScenePicking'
import { PICK_MISS, type IdPicker } from '../src/scene/picking/idPicker'
import type { PickResult } from '../src/scene/picking/scenePicker'
import { FrameLoop } from '../src/scene/renderer/frameLoop'
import { FLOATS_PER_PLANE } from '../src/scene/starfield/motion'
import type { SceneResources } from '../src/scene/useSceneData'

const DRAW_COUNT = 8

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
 * The star **data** layer, and nothing else — no `StarField`, no nebula. Exactly what survives
 * §3.2, so a pick that resolves against this is a pick that still resolves after the cutover.
 *
 * `setDustFocused` records rather than draws: PRD 5.3.4's dust brightening is a `PlaneTable` write
 * and the select path is meant to make it, so it is asserted below rather than stubbed silently.
 */
function sourcesDouble() {
  const dust: boolean[] = []
  const sources = {
    geometry: {
      drawCount: DRAW_COUNT,
      planeRowOf: (index: number) => index % 3,
      hueClassOf: () => 0,
      localPosition: (_i: number, out: Vector3) => out.set(0, 0, 1),
    },
    table: {
      raw: new Float32Array(FLOATS_PER_PLANE),
      time: 0,
      multiverseAngle: 0,
      setDustFocused: (focused: boolean) => dust.push(focused),
    },
  }
  return { sources: sources as unknown as PickSources & SceneResources, dust }
}

/**
 * The id buffer, as an answer rather than a render pass.
 *
 * The product's `IdPicker` needs a GL context, which is why the routing it feeds was reachable only
 * from e2e before this file — and why `ScenePickingOptions.picker` exists. Note `pending` is always
 * false: the busy path is `picking.test.ts`'s subject, not this file's.
 */
function pickerDouble() {
  const calls = { pick: 0, pickQueued: 0, disposed: 0 }
  let answer = PICK_MISS
  const picker = {
    get pending() {
      return false
    },
    pick: () => {
      calls.pick += 1
      return Promise.resolve(answer)
    },
    pickQueued: () => {
      calls.pickQueued += 1
      return Promise.resolve(answer)
    },
    dispose: () => {
      calls.disposed += 1
    },
  }
  return {
    picker: picker as unknown as IdPicker,
    calls,
    answers: (id: number) => {
      answer = id
    },
  }
}

function rig() {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  // jsdom lays nothing out, so the per-tick device-pixel conversion would bail on a zero rect and
  // never be exercised. A real rect is what makes `toDevicePixels` run.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect
  const gl = {
    getPixelRatio: () => 1,
    getSize: (out: { x: number; y: number }) => {
      out.x = 800
      out.y = 600
      return out
    },
    domElement: canvas,
  } as unknown as WebGLRenderer
  const scene = new Scene()
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000)
  camera.position.set(0, 0, 5)
  camera.updateMatrixWorld(true)
  const loop = new FrameLoop()
  const { sources, dust } = sourcesDouble()
  const { picker, calls, answers } = pickerDouble()

  const hovers: PickResult[] = []
  const selects: PickResult[] = []
  const labelState: PlanetLabelState = { visible: false, x: 0, y: 0, printing: -1 }

  // The ring first, so the hover route below has something to reach — the same order `SceneHost`
  // builds them in, minus the galaxy.
  const ring = attachFocusedCard({ gl, scene, camera, loop, resources: sources, labelState })

  const picking = attachScenePicking({
    gl,
    scene,
    camera,
    loop,
    picker,
    onHover: (pick) => {
      // Verbatim `SceneHost`'s route (DEC-852). Copied rather than imported because building a
      // `SceneHost` needs a GL context; the line is one expression and a drift in it is what the
      // label assertions below would catch.
      ring.setHoveredPlanet(pick?.kind === 'planet' ? pick.index : -1)
      hovers.push(pick)
    },
    onSelect: (pick) => selects.push(pick),
  })
  picking.setSources(sources)

  return { canvas, scene, loop, picking, ring, labelState, hovers, selects, dust, calls, answers }
}

/** A pointer sample, then the tick that converts it and the tick's pick, then the settling. */
async function movePointer(canvas: HTMLCanvasElement, loop: FrameLoop, at: number): Promise<void> {
  canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 300 }))
  loop.tick(at)
  await flush()
}

/** A click is down and up at the same point — a drag past 4 px is a camera gesture, not a select. */
async function clickPointer(canvas: HTMLCanvasElement): Promise<void> {
  canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300 }))
  canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 300 }))
  await flush()
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the input layer runs with no galaxy scene attached (DEC-852)', () => {
  it('reports a hovered star from a pointer move, through the tick', async () => {
    const { canvas, scene, loop, hovers, calls, answers } = rig()
    // The post-cutover shape, asserted rather than assumed: the only thing in this scene is the
    // printing ring. No star field, no nebula, no `attachStarScene`.
    expect(scene.children).toHaveLength(1)

    answers(3)
    await movePointer(canvas, loop, 16)

    expect(calls.pick, 'the tick issued one hover pick').toBe(1)
    expect(hovers).toEqual([{ kind: 'star', index: 3, planeIndex: 0 }])
  })

  it('does not report a hover the pointer never made', async () => {
    const { loop, hovers, calls } = rig()
    // The negative control, and it is the half that matters: an empty `hovers` is also this array's
    // initial value, so a route that is never wired reads identically to one correctly quiet.
    // Driving ticks with no pointer sample is what separates them — and the case above, on the same
    // rig, is what shows the quiet one is not simply broken.
    loop.tick(16)
    loop.tick(32)
    await flush()

    expect(calls.pick, 'no sample, so no pick').toBe(0)
    expect(hovers).toEqual([])
  })

  it('reports a hover once while the answer stays the same (PRD 5.4.12 dedupe)', async () => {
    const { canvas, loop, hovers, calls, answers } = rig()
    answers(3)
    await movePointer(canvas, loop, 16)
    await movePointer(canvas, loop, 32)
    await movePointer(canvas, loop, 48)

    expect(calls.pick, 'every move still costs a pick — the dedupe is on the answer').toBe(3)
    expect(hovers, 'three picks, one change under the pointer').toHaveLength(1)
  })

  it('reports the change when the pointer crosses onto a different star', async () => {
    // The other arm of the case above: without it, a `samePick` that answered `true` for
    // *everything* would pass the dedupe assertion by reporting nothing at all after the first.
    const { canvas, loop, hovers, answers } = rig()
    answers(3)
    await movePointer(canvas, loop, 16)
    answers(5)
    await movePointer(canvas, loop, 32)

    expect(hovers).toEqual([
      { kind: 'star', index: 3, planeIndex: 0 },
      { kind: 'star', index: 5, planeIndex: 2 },
    ])
  })

  it('writes the star highlight only while one is registered (DEC-852 hand-over)', async () => {
    const { canvas, loop, picking, answers } = rig()
    const highlights: number[] = []
    picking.setStarHighlight((index) => highlights.push(index))
    answers(3)
    await movePointer(canvas, loop, 16)
    expect(highlights, 'the galaxy registered, so the galaxy is told').toEqual([3])

    // The cutover's shape: the field is gone, so nothing is registered, and the pick keeps working.
    picking.setStarHighlight(null)
    answers(5)
    await movePointer(canvas, loop, 32)
    expect(highlights, 'nothing left to highlight').toEqual([3])
  })

  it('reports a click as a select, and marks the dust when the focus is a dust star', async () => {
    const { canvas, loop, picking, selects, dust, calls, answers } = rig()
    answers(3)
    await movePointer(canvas, loop, 16)
    await clickPointer(canvas)

    expect(calls.pickQueued, 'a click queues for its turn rather than taking what is going').toBe(1)
    expect(selects).toEqual([{ kind: 'star', index: 3, planeIndex: 0 }])
    expect(picking.focusedIndex, 'the mirror reads the focus from here now').toBe(3)
    // Star 3 sits on row 0 under the double's `planeRowOf`, which is the Blind Eternities row.
    expect(dust).toEqual([true])
  })

  it("writes the printing ring's hover label for a hovered planet (PRD 5.6.9)", async () => {
    const { canvas, loop, ring, labelState, answers } = rig()
    ring.setCards({ get: () => cardWith(4) })
    ring.setFocusedStar(0)

    // The negative control again, on the label this time: `visible: false` is the initial value, so
    // a label that is never written reads identically to one correctly withheld.
    loop.tick(16)
    expect(labelState.visible, 'nothing hovered').toBe(false)

    answers(PLANET_ID_BASE + 1)
    await movePointer(canvas, loop, 32)
    loop.tick(48)

    expect(labelState.printing, 'the hovered planet names a printing').toBeGreaterThanOrEqual(0)
  })

  it('stops listening on dispose, and takes the picker with it', async () => {
    const { canvas, loop, picking, hovers, calls, answers } = rig()
    answers(3)
    await movePointer(canvas, loop, 16)
    expect(hovers).toHaveLength(1)

    picking.dispose()
    await movePointer(canvas, loop, 32)
    await clickPointer(canvas)

    expect(hovers, 'the listeners are off the canvas').toHaveLength(1)
    expect(calls.pick, 'and the phases are off the loop').toBe(1)
    expect(calls.pickQueued).toBe(0)
    expect(calls.disposed, 'the render target goes back').toBe(1)
  })
})
