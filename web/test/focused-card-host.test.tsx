/**
 * The printing ring is *wired*, not merely implemented (DEC-752).
 *
 * `cards.test.ts` covers what `FocusedCard` draws. This file covers the thing that file cannot see:
 * that something still **constructs** one, puts it in the scene, shows it on focus and writes the
 * hover label. That wiring lived in `cards/cardTier.ts`, which §3.2 named for deletion as "the
 * card-sheet tier" — and it was the only `new FocusedCard(...)` in the app, so deleting it would
 * have retired §1.10's ring and PRD 5.6.9's label with a green build and a still-rendering
 * `<PlanetHoverLabel>`. W1–W5 read neither surface, and §3.2's condition-4 parity evidence did not
 * cover the label either, so nothing would have reported it.
 *
 * The board's ruling was to split the module rather than delete it. This is the guard that the
 * surviving half stays attached: **a ring that never appears and a ring nobody focused read
 * identically**, which is exactly why the assertions below are about the wiring and not the shape.
 */

import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'

import type { CardRecord, PrintingTuple } from '../src/data/types'
import { FrameLoop } from '../src/scene/renderer/frameLoop'
import { FLOATS_PER_PLANE } from '../src/scene/starfield/motion'
import {
  attachFocusedCard,
  type PlanetLabelState,
} from '../src/scene/cards/focusedCardHost'
import type { SceneResources } from '../src/scene/useSceneData'

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
 * The two reads `applyFocus` and the tick make of `SceneResources`, and nothing else.
 *
 * Deliberately not a whole `StarGeometry`: the point here is the wiring, and a real buffer would
 * make this a second copy of `starfield.test.ts`.
 */
function resourcesDouble(): SceneResources {
  return {
    geometry: {
      hueClassOf: () => 0,
      localPosition: (_i: number, out: Vector3) => out.set(0, 0, 1),
      planeRowOf: () => 0,
    },
    table: { raw: new Float32Array(FLOATS_PER_PLANE), time: 0, multiverseAngle: 0 },
  } as unknown as SceneResources
}

function rig() {
  const canvas = document.createElement('canvas')
  const gl = { getPixelRatio: () => 1, domElement: canvas } as unknown as WebGLRenderer
  const scene = new Scene()
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000)
  camera.position.set(0, 0, 5)
  camera.updateMatrixWorld(true)
  const loop = new FrameLoop()
  const labelState: PlanetLabelState = { visible: false, x: 0, y: 0, printing: -1 }
  const handle = attachFocusedCard({ gl, scene, camera, loop, resources: resourcesDouble(), labelState })
  return { scene, loop, labelState, handle }
}

describe('§1.10 the printing ring is attached, not only implemented (DEC-752)', () => {
  it('puts the card in the scene graph', () => {
    const { scene, handle } = rig()
    expect(scene.children).toContain(handle.card.root)
    handle.dispose()
    expect(scene.children).not.toContain(handle.card.root)
  })

  it('shows the card when a star is focused and its record is in hand', () => {
    const { handle } = rig()
    expect(handle.card.visible).toBe(false)

    // Focus first, record second — the order the app actually produces, since the shards land after
    // the navigation. `setCards` re-runs the focus for exactly this reason.
    handle.setFocusedStar(0)
    expect(handle.card.visible, 'no record yet, so nothing to show').toBe(false)

    handle.setCards({ get: () => cardWith(4) })
    expect(handle.card.visible, 'the record landed, so the ring appears').toBe(true)

    handle.setFocusedStar(-1)
    expect(handle.card.visible, 'releasing focus hides it (PRD 5.6.1)').toBe(false)
    handle.dispose()
  })

  it('writes the hover label only while a planet is hovered (PRD 5.6.9)', () => {
    const { loop, labelState, handle } = rig()
    handle.setCards({ get: () => cardWith(4) })
    handle.setFocusedStar(0)

    // A tick with nothing hovered, which on its own separates nothing: `visible: false` is also
    // this object's initial value, so a label that is never written reads identically to one
    // correctly withheld. What separates them is the pair below — the label goes **up** on a
    // hovered planet and back **down** when the hover is released (DEC-857 R1). Without the
    // `true` in the middle, replacing the write with a constant `false` passes this row.
    loop.tick(16)
    expect(labelState.visible, 'nothing hovered').toBe(false)

    handle.setHoveredPlanet(0)
    loop.tick(32)
    expect(labelState.printing, 'the hovered planet names a printing').toBeGreaterThanOrEqual(0)
    expect(labelState.visible, 'a hovered planet in front of the camera raises the label').toBe(
      true,
    )

    handle.setHoveredPlanet(-1)
    loop.tick(48)
    expect(labelState.visible, 'releasing the hover takes it down again').toBe(false)
    handle.dispose()
  })
})
