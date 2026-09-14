/**
 * What `priority` actually is to the label solver (DEC-751, for DEC-758's ruling).
 *
 * DEC-758 is being asked to set a bar on how often each world's label is legible, and the first
 * remedy anyone reaches for is `PlaneLabels.tsx`'s `priority: plane.cardCount` — "weight it less
 * steeply so the small worlds are not buried". This file exists to stop that proposal costing a
 * leg: `layoutLabels` compares priorities only to *order* the candidates, so re-scaling the weight
 * is not a weaker version of the tiering, it is no change at all. `sqrt` and `log1p` of the card
 * counts produce a byte-identical layout.
 *
 * The two tests after it are what keep that from reading as "priority does not matter". It does,
 * and in both directions: on the worlds the shipped descending-count order seats more labels than
 * a flat priority and a flat priority more than an inverted one — but counted over the whole
 * roster the flat priority wins, because the worlds' labels are bought from the empty planes'.
 * Priority is a permutation, not a supply. Which is why moving it redistributes legibility rather
 * than adding any, and why a per-world floor is not something this module can be told to go and
 * meet.
 *
 * Every row here is an ordering or a count of seated labels, never a share: the share digits are
 * evidence for the ruling and live in the DEC-751 hand-back, where they can be superseded without
 * touching a test.
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
/** DEC-752's reading of "visible": above zero, so a label merely dimmed by occlusion still counts. */
const VISIBLE = 0.05
/**
 * Enough of the multiverse turn (PRD 5.3.13) that no single pose decides the answer. Azimuth is
 * not a camera setting these can be held still at — see `label-coverage.test.ts`.
 */
const AZIMUTHS = 36

const labelled = planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG)

/**
 * The worlds, as distinct from the roster: `empty` planes are a point of light with a name, the
 * `spiral` and `irregular` ones are what PRD 5.3.8's claim and DEC-758's ruling are about.
 */
const worldSlugs = new Set(
  labelled.filter((p) => p.kind === 'spiral' || p.kind === 'irregular').map((p) => p.slug),
)

/** Every label seated across the sweep, as `slug@azimuth` keys, under one priority mapping. */
function seatedUnder(priorityOf: (cardCount: number) => number): Set<string> {
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)

  const projector = new Projector()
  const point: MutVec3 = vec()
  const projected = createProjected()
  const out: LabelPlacement[] = []
  const seated = new Set<string>()

  for (let a = 0; a < AZIMUTHS; a += 1) {
    // The clock stays at zero, so drift and shear hold their t=0 pose and azimuth is the only
    // thing moving between readings.
    rig.motion.syncClock(0, (a * 2 * Math.PI) / AZIMUTHS)
    projector.update({
      position: rig.position,
      target: rig.lookAt,
      fov: (55 * Math.PI) / 180,
      near: 0.1,
      ...VIEWPORT,
    })

    const candidates: LabelCandidate[] = []
    for (const plane of labelled) {
      rig.motion.planePosition(point, plane)
      projector.project(projected, point)
      candidates.push({
        key: plane.slug,
        text: plane.displayName,
        sub: plane.cardCount > 0 ? `${plane.cardCount}` : null,
        tier: 'plane',
        priority: priorityOf(plane.cardCount),
        x: projected.x,
        y: projected.y,
        radiusPx: projector.radiusPx(plane.radius, projected.depth),
        depth: projected.depth,
        onScreen: projected.onScreen,
      })
    }

    const count = layoutLabels(candidates, out, VIEWPORT)
    for (let i = 0; i < count; i += 1) {
      const placement = out[i]!
      if (placement.opacity > VISIBLE) seated.add(`${placement.key}@${a}`)
    }
  }
  return seated
}

const shipped = seatedUnder((cardCount) => cardCount)

/** How many of those seats went to worlds. */
function worldsIn(seated: ReadonlySet<string>): number {
  let n = 0
  for (const key of seated) if (worldSlugs.has(key.slice(0, key.lastIndexOf('@')))) n += 1
  return n
}

describe('label priority is an order, not a weight (PRD 5.3.10)', () => {
  it('has a roster crowded enough for priority to decide anything', () => {
    // Without a collision there is nothing for priority to arbitrate and every row below is
    // vacuously equal. `< labelled.length * AZIMUTHS` is exactly "some label lost a collision".
    expect(labelled.length).toBeGreaterThan(1)
    expect(shipped.size).toBeLessThan(labelled.length * AZIMUTHS)
    expect(shipped.size).toBeGreaterThan(0)
  })

  it('is unchanged by any re-scaling that preserves the order and the ties', () => {
    // `sqrt` and `log1p` are strictly increasing and injective on the roster's card counts, so
    // they permute nothing — and the solver reads `priority` only through `cb.priority -
    // ca.priority`'s sign and an equality test. Softening the weight is not a smaller version of
    // the tiering; it is a no-op, and a remedy proposed in those terms will measure as one.
    expect([...seatedUnder((c) => Math.sqrt(c))].sort()).toEqual([...shipped].sort())
    expect([...seatedUnder((c) => Math.log1p(c))].sort()).toEqual([...shipped].sort())
  })

  it('is nonetheless load-bearing: on worlds, descending beats flat beats inverted', () => {
    // The control for the test above. If priority genuinely did not matter these three would be
    // equal too, and "re-scaling changes nothing" would be saying nothing about the solver.
    const flat = seatedUnder(() => 0)
    const inverted = seatedUnder((c) => -c)
    expect(worldsIn(shipped)).toBeGreaterThan(worldsIn(flat))
    expect(worldsIn(flat)).toBeGreaterThan(worldsIn(inverted))
  })

  it('buys those worlds from the empty planes, rather than making labels', () => {
    // The half that is easy to miss, and the reason a per-world floor cannot be handed to this
    // module. Counted over the *whole* roster the ordering runs the other way: a flat priority
    // seats more labels than the shipped one, because descending-by-count lets the same big worlds
    // win every collision they enter. So priority does not create legibility, it moves it — from
    // the 42 `empty` planes to the 45 worlds, and among the worlds from one to another.
    //
    // What the total is, is settled upstream: the packing decides how close two labels are asked
    // to sit in the first place, and `home` is a pure function of the section 1.3 radius law —
    // re-running `place_planes` over the shipped radii reproduces 87 of 87 positions. Retuning
    // this knob redistributes; only the radius law changes what there is to redistribute.
    const flat = seatedUnder(() => 0)
    expect(flat.size).toBeGreaterThan(shipped.size)
    expect(worldsIn(flat)).toBeLessThan(worldsIn(shipped))
  })
})
