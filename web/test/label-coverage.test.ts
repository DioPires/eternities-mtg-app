/**
 * World-label coverage at the home view, across azimuth (DEC-751, for DEC-752's W5).
 *
 * DEC-752's `evaluateW5` scores a `worldLabelCoverage` — the fraction of the roster's *worlds*
 * (every non-dust plane that renders as a surface) whose label is visible at the home view — and
 * needs a floor to compare it against. A floor is only meaningful if the thing it bounds is a
 * property of the renderer rather than of the moment it was sampled, and this file is what decides
 * that: `motion.ts` turns the whole disc by `multiverseAngle` (PRD 5.3.13), so azimuth is not a
 * camera setting a measurement can hold still, it is what the home view *does*, once every twenty
 * minutes. A single-azimuth reading is one frame of a cycle.
 *
 * Two things are asserted, and neither is a digit that drifts:
 *
 * - **Coverage moves with azimuth.** So no single sample is "where the renderer lands", and a floor
 *   has to be stated against the whole sweep.
 * - **Every missing world is missing because the collision solver faded it, never because the
 *   projector put it off screen.** That is what makes coverage a placement property at all — if
 *   worlds were being lost over the horizon, no amount of label work could recover them and a floor
 *   below 1.0 would just be recording the camera's framing.
 *
 * The exact coverage numbers live in the DEC-751 hand-back rather than here, because they are
 * evidence for a ruling and not an invariant.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { emptyTether } from '../src/camera/framing'
import { CameraRig } from '../src/camera/rig'
import { vec, type MutVec3 } from '../src/camera/vec'
import type { PlanesFile } from '../src/data/types'
import { BLIND_ETERNITIES_SLUG } from '../src/data/types'
import { layoutLabels, type LabelCandidate, type LabelPlacement } from '../src/labels/layout'
import { createProjected, Projector } from '../src/labels/project'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const registry = JSON.parse(readFileSync(resolve(webRoot, 'datasets.json'), 'utf8')) as {
  readonly worlds: string
}
const planes = JSON.parse(
  readFileSync(resolve(webRoot, 'public', 'data', registry.worlds, 'planes.json'), 'utf8'),
) as PlanesFile

const VIEWPORT = { viewportWidth: 1920, viewportHeight: 1080 }

/**
 * DEC-752's normative reading of "visible", from its head `46f9657`: above zero rather than at
 * full strength, and deliberately below PRD 5.3.11's 0.4 occlusion dim so a dimmed label still
 * counts. A label the solver has faded out sits at exactly 0.
 */
const VISIBLE = 0.05

/** PRD 5.3.4: the dust spans the multiverse and has no centre to label. */
const labelled = planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG)

/**
 * The worlds, as distinct from the roster. `empty` planes carry no cards and render as a point of
 * light; `spiral` and `irregular` are the ones with a surface, and they are what W5 counts.
 */
const worlds = labelled.filter((plane) => plane.kind === 'spiral' || plane.kind === 'irregular')

interface Reading {
  /** Worlds whose label is visible. */
  readonly visibleWorlds: number
  /** Worlds the projector put off screen — no placement, no chance of a label. */
  readonly offScreen: readonly string[]
  /** Worlds the collision solver placed and then faded to nothing (PRD 5.3.10). */
  readonly faded: readonly string[]
}

/** One home-view frame, with the multiverse turned to `angleRad`. */
function readAt(angleRad: number): Reading {
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)
  // Azimuth alone: the clock is pinned at zero, so PRD 5.4.12's drift and 5.4.13's shear are at
  // their t=0 pose in every reading and cannot be what the spread below is measuring.
  rig.motion.syncClock(0, angleRad)

  const projector = new Projector()
  projector.update({
    position: rig.position,
    target: rig.lookAt,
    fov: (55 * Math.PI) / 180,
    near: 0.1,
    ...VIEWPORT,
  })

  const point: MutVec3 = vec()
  const projected = createProjected()
  const candidates: LabelCandidate[] = []
  const offScreen: string[] = []
  for (const plane of labelled) {
    rig.motion.planePosition(point, plane)
    projector.project(projected, point)
    if (!projected.onScreen && plane.kind !== 'empty') offScreen.push(plane.slug)
    candidates.push({
      key: plane.slug,
      text: plane.displayName,
      // What `PlaneLabels.candidateFor` builds: the bare count, not "N cards".
      sub: plane.cardCount > 0 ? `${plane.cardCount}` : null,
      tier: 'plane',
      priority: plane.cardCount,
      x: projected.x,
      y: projected.y,
      radiusPx: projector.radiusPx(plane.radius, projected.depth),
      depth: projected.depth,
      onScreen: projected.onScreen,
    })
  }

  const out: LabelPlacement[] = []
  const count = layoutLabels(candidates, out, VIEWPORT)
  const visible = new Set<string>()
  const fadedAll = new Set<string>()
  for (let i = 0; i < count; i += 1) {
    const placement = out[i]!
    if (placement.opacity > VISIBLE) visible.add(placement.key)
    else fadedAll.add(placement.key)
  }
  return {
    visibleWorlds: worlds.filter((plane) => visible.has(plane.slug)).length,
    offScreen,
    faded: worlds.filter((plane) => fadedAll.has(plane.slug)).map((plane) => plane.slug),
  }
}

const AZIMUTHS = 24
const sweep = Array.from({ length: AZIMUTHS }, (_, i) => readAt((i * 2 * Math.PI) / AZIMUTHS))

describe('world-label coverage across the multiverse turn (PRD 5.3.10, 5.3.13)', () => {
  it('has worlds to cover, and a turn to cover them through', () => {
    // Guards the two denominators the rest of the file divides by: a roster change that dropped the
    // worlds, or a `syncClock` that stopped turning the disc, would otherwise make every assertion
    // below vacuously true.
    expect(worlds.length).toBeGreaterThan(1)
    expect(sweep).toHaveLength(AZIMUTHS)
  })

  it('coverage is a function of azimuth, not a constant of the renderer', () => {
    // The finding the floor ruling rests on. If this ever collapses to a single value, a
    // single-azimuth floor becomes sound and this test should be deleted rather than loosened.
    const counts = sweep.map((r) => r.visibleWorlds)
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts))
  })

  it('never loses a world off screen — every miss is the collision solver fading it', () => {
    // What makes coverage a *placement* measure. The home view of PRD 8.6.1 frames the whole disc,
    // so a world that has no label had one placed and taken away, and placement work can get it
    // back. The second half is what keeps the first from being trivially true: at a coverage of
    // 1.0 there would be nothing faded either, and the assertion would say nothing.
    for (const reading of sweep) expect(reading.offScreen).toEqual([])
    expect(sweep.some((reading) => reading.faded.length > 0)).toBe(true)
  })
})
