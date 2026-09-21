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
 * What this file pins, since the DEC-885 refresh:
 *
 *  1. The floor never *creates* an unpickable world — every world with zero effective target is
 *     already zero as-drawn, i.e. genuinely behind something. The floor is not self-defeating.
 *
 * Until DEC-885 it pinned two more, and both were findings about the layout production then
 * shipped rather than about the floor: that the floor does not deliver a 24 px *target* (floored
 * proxies overlapped and the nearer one won), and that some of that shortfall was caused by
 * neighbours' floors rather than by occlusion. They were why §1.11's wording overstated its
 * guarantee, and they are what DEC-759's `home` law was written to remove. The refresh carried the
 * law into `planes.json` and both went false on the shipped roster — by design, so they were
 * retired rather than loosened. `pick-target-separation.test.ts` now asserts the opposite on the
 * same homes: every lifted world holds its full 24 px. The measurement behind the retired pair is
 * in §1.11 and the DEC-751 hand-back.
 *
 * The same refresh left (1)'s old control with nothing to see: the shipped layout buries no world
 * at any azimuth, so "dead floored == dead as-drawn" reads 0 == 0 there. The control now runs on a
 * layout built to bury — every home collapsed onto the origin — so the equality is still backed by
 * an instrument shown to see burial.
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

import { effectiveFraction, FLOOR_PX, sweepAzimuths } from './effective-target'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const registry = JSON.parse(readFileSync(resolve(webRoot, 'datasets.json'), 'utf8')) as {
  readonly worlds: string
}
const planes = JSON.parse(
  readFileSync(resolve(webRoot, 'public', 'data', registry.worlds, 'planes.json'), 'utf8'),
) as PlanesFile

const AZIMUTHS = 24

interface Sample {
  readonly slug: string
  readonly floored: number
  readonly asDrawn: number
}

/** Every world the floor actually lifts, at every azimuth. */
function sampleLifted(subject: PlanesFile): Sample[] {
  const out: Sample[] = []
  for (const disks of sweepAzimuths(subject, AZIMUTHS)) {
    for (const disk of disks) {
      if (!disk.isWorld || disk.rRaw >= FLOOR_PX) continue
      out.push({
        slug: disk.slug,
        floored: effectiveFraction(disk, disks, 'rFloored'),
        asDrawn: effectiveFraction(disk, disks, 'rRaw'),
      })
    }
  }
  return out
}

const samples = sampleLifted(planes)

/**
 * The control: the shipped roster with every home on the origin, so the planes sit on one another
 * and only drift separates them. Nothing ships like this; it exists so that the burial count below
 * is shown to be non-zero on *some* input before a zero on the shipped one is trusted.
 */
const collapsed = sampleLifted({
  ...planes,
  planes: planes.planes.map((plane) => ({ ...plane, home: [0, 0, 0] })),
})

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

    // ...and the instrument does see burial, so the equality above is not two zeroes agreeing by
    // construction. On the shipped homes it *is* two zeroes since DEC-885; the collapsed layout is
    // where the instrument proves it can count a buried world at all.
    expect(collapsed.filter((s) => s.asDrawn <= 0).length).toBeGreaterThan(0)
  })
})
