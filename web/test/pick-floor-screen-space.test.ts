/**
 * What §1.11's screen-space pick floor actually delivers, in screen space (DEC-751, for DEC-749).
 *
 * §1.11 (normative on DEC-749's `02e0fe1`) floors the plane-level pick proxy at 24 CSS px of
 * diameter after projection, per frame, per world, because §1.3 rules out raising the world-space
 * radius floor to chase a pixel target. R1 established that the inflation does not collide with
 * neighbours — but measured that in **world space**, and flagged the gap: two worlds at very
 * different depths can still project on top of each other. This file closes that gap, and it
 * reports three things that are invariants rather than digits, because the digits on this family of
 * quantities move with azimuth (see `label-coverage.test.ts`) and have been wrong three times.
 *
 * The subject is the *effective* target: the part of a floored proxy that the picker would actually
 * award to that world. `scenePicker.ts` resolves overlap by nearest ray hit, so a nearer disk takes
 * the pixels it covers. Two coverage rules are compared, and the difference between them is the
 * whole point:
 *
 * - **as-drawn** — neighbours claim only the disk they really draw (`radius × 1.15`). Losses under
 *   this rule are honest occlusion; no pick policy can recover them.
 * - **floored** — neighbours claim their floored proxy too. This is what shipping §1.11 does.
 *
 * What the three tests pin:
 *
 *  1. The floor never *creates* an unpickable world — every world with zero effective target is
 *     already zero as-drawn, i.e. genuinely behind something. The floor is not self-defeating.
 *  2. The floor does not deliver a 24 px *target*. It guarantees a 24 px *proxy*, which is a
 *     different thing, because floored proxies overlap each other and the nearer one wins.
 *  3. That shortfall is caused by neighbours' floors and not only by occlusion — there is a world
 *     that is nearly unoccluded as drawn and still loses most of its target once the floor is on.
 *
 * (2) and (3) are why §1.11's wording overstates its guarantee; the ruling on what to do about it
 * is R1's, and the measurement behind it is in the DEC-751 hand-back.
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
/** `scenePicker.ts`'s `PLANE_PICK_MARGIN`. */
const MARGIN = 1.15
/** §1.11 / WCAG 2.5.8: 24 CSS px of diameter, so 12 px of radius. */
const FLOOR_PX = 12

/** The Blind Eternities is not a sphere and is skipped by the picker for the same reason. */
const pickable = planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG)
const worldSlugs = new Set(
  planes.planes
    .filter((plane) => plane.kind === 'spiral' || plane.kind === 'irregular')
    .map((plane) => plane.slug),
)

interface Disk {
  readonly slug: string
  readonly x: number
  readonly y: number
  readonly depth: number
  /** The proxy the world actually draws, in px of radius. */
  readonly rRaw: number
  /** The same proxy after §1.11's floor. */
  readonly rFloored: number
  readonly isWorld: boolean
}

/** One home-view frame, with the multiverse turned to `angleRad` and the clock pinned at zero. */
function readAt(angleRad: number): Disk[] {
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)
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
  const out: Disk[] = []
  for (const plane of pickable) {
    rig.motion.planePosition(point, plane)
    projector.project(projected, point)
    const rRaw = projector.radiusPx(plane.radius * MARGIN, projected.depth)
    out.push({
      slug: plane.slug,
      x: projected.x,
      y: projected.y,
      depth: projected.depth,
      rRaw,
      rFloored: Math.max(rRaw, FLOOR_PX),
      isWorld: worldSlugs.has(plane.slug),
    })
  }
  return out
}

/**
 * The fraction of `a`'s floored proxy the picker would award to `a`, by area sampling.
 *
 * `neighbourRadius` picks the coverage rule: `rRaw` is the as-drawn control, `rFloored` is shipping
 * §1.11. Only strictly nearer disks can take a pixel, which is `scenePicker.ts`'s nearest-hit
 * resolution written in screen space.
 */
function effectiveFraction(a: Disk, all: readonly Disk[], neighbourRadius: 'rRaw' | 'rFloored') {
  const N = 48
  let inside = 0
  let mine = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const px = a.x + ((i + 0.5) / N - 0.5) * 2 * a.rFloored
      const py = a.y + ((j + 0.5) / N - 0.5) * 2 * a.rFloored
      if (Math.hypot(px - a.x, py - a.y) > a.rFloored) continue
      inside += 1
      let taken = false
      for (const b of all) {
        if (b === a || b.depth >= a.depth) continue
        if (Math.hypot(px - b.x, py - b.y) <= b[neighbourRadius]) {
          taken = true
          break
        }
      }
      if (!taken) mine += 1
    }
  }
  return inside === 0 ? 1 : mine / inside
}

/** A disk of this fraction of a 24 px target, expressed back as a diameter. */
const effectiveDiameterPx = (fraction: number): number => 2 * FLOOR_PX * Math.sqrt(fraction)

const AZIMUTHS = 24
const sweep = Array.from({ length: AZIMUTHS }, (_, i) => readAt((i * 2 * Math.PI) / AZIMUTHS))

interface Sample {
  readonly slug: string
  readonly floored: number
  readonly asDrawn: number
}

/** Every world the floor actually lifts, at every azimuth. */
const samples: Sample[] = []
for (const disks of sweep) {
  for (const disk of disks) {
    if (!disk.isWorld || disk.rRaw >= FLOOR_PX) continue
    samples.push({
      slug: disk.slug,
      floored: effectiveFraction(disk, disks, 'rFloored'),
      asDrawn: effectiveFraction(disk, disks, 'rRaw'),
    })
  }
}

describe('the screen-space pick floor (spec §1.11, WCAG 2.5.8)', () => {
  it('has floored worlds to measure, at more than one azimuth', () => {
    // The denominator guard. A roster or radius-law change that stopped the floor from binding, or
    // a `syncClock` that stopped turning the disc, would make every assertion below vacuous.
    expect(samples.length).toBeGreaterThan(AZIMUTHS)
    expect(new Set(samples.map((s) => s.slug)).size).toBeGreaterThan(1)
  })

  it('never makes a world unpickable that was pickable as drawn', () => {
    // The reassuring half, and R1's open question answered: depth-disparate pairs *do* project
    // together, but inflating the proxy is not what buries anyone. Every world with no effective
    // target at all is already fully behind a neighbour's drawn disk at that azimuth.
    const deadFloored = samples.filter((s) => s.floored <= 0)
    const deadAsDrawn = samples.filter((s) => s.asDrawn <= 0)
    expect(deadFloored.length).toBe(deadAsDrawn.length)

    // ...and the instrument does see burial, so the equality above is not two zeroes agreeing.
    expect(deadAsDrawn.length).toBeGreaterThan(0)
  })

  it('guarantees a 24 px proxy, but not a 24 px target', () => {
    // The finding §1.11's wording does not yet carry. WCAG 2.5.8 is about the target the pointer can
    // actually hit; a proxy floored to 24 px whose nearer neighbour covers most of it is not one.
    const short = samples.filter((s) => effectiveDiameterPx(s.floored) < 2 * FLOOR_PX - 1e-9)
    expect(short.length).toBeGreaterThan(0)
  })

  it('loses target area to neighbours’ floors, not only to occlusion', () => {
    // What makes the previous test a fact about the floor rather than about the layout: a world that
    // is essentially unoccluded by anything drawn, and still loses a large share of its target once
    // the neighbours are floored too. Floored proxies eat each other, so the floor is partly
    // self-cancelling and no nearest-hit tie-break can conjure the area back.
    const selfInflicted = samples.filter((s) => s.asDrawn > 0.9 && s.floored < 0.5)
    expect(selfInflicted.length).toBeGreaterThan(0)
  })
})
