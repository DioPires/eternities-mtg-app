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
 *
 * The projection and the area sampling live in `effective-target.ts`, shared with DEC-759's
 * `pick-target-separation.test.ts`: that file asks what the *layout* delivers against the same
 * instrument, and a second copy of it would let the two answers drift apart.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { PlanesFile } from '../src/data/types'

import { effectiveDiameterPx, effectiveFraction, FLOOR_PX, sweepAzimuths } from './effective-target'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const registry = JSON.parse(readFileSync(resolve(webRoot, 'datasets.json'), 'utf8')) as {
  readonly worlds: string
}
const planes = JSON.parse(
  readFileSync(resolve(webRoot, 'public', 'data', registry.worlds, 'planes.json'), 'utf8'),
) as PlanesFile

const AZIMUTHS = 24
const sweep = sweepAzimuths(planes, AZIMUTHS)

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
    const short = samples.filter(
      (s) => effectiveDiameterPx(s.floored, FLOOR_PX) < 2 * FLOOR_PX - 1e-9,
    )
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
