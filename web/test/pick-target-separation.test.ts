/**
 * What the `home` law delivers as a pick *target* (DEC-759, the layout half of §1.11).
 *
 * §1.11's floor guarantees a 24 px *proxy* and cannot guarantee a 24 px *target*: floored proxies
 * overlap, and a nearer disk takes the pixels. DEC-749 ruled the remaining lever is layout, and
 * DEC-751's measurement split the shortfall in two. This file measures the split again, against
 * the two layouts, and the headline is the **occlusion-only** half — the worlds that fall short
 * even when every neighbour claims only the disk it really draws. That half is the layout's,
 * because no pick policy recovers it; the floor-on-floor remainder is §1.11's and is out of scope
 * here (the Voronoi tie-break that could move it was measured and rejected on DEC-749).
 *
 * Two arms, because production is only re-laid out on a dataset refresh:
 *
 * - **shipped** — the homes `planes.json` publishes, which predate the law. The control: if this
 *   arm ever stops falling short, the instrument has stopped seeing the defect it measures.
 * - **candidate** — `docs/worlds/dec759-home-law.json`, the homes `layout.place_planes` gives the
 *   same roster under the home-view separation rule. `pipeline/tests/test_home_separation.py`
 *   pins that file to the law, so this file cannot be measuring a layout no law produces.
 *
 * Measured on the reference viewport (§1.3's 1920x1080) over a full turn. The counts are minima
 * over the sweep — one bad azimuth condemns a world — so they move with sweep density until it is
 * fine enough. 36 is the first density that has converged for both arms, so it is what runs here.
 * A single-azimuth number is not evidence and must not be quoted (§1.11).
 *
 * Three limits this file does not hide. The law is written against the reference viewport, and the
 * floor is 24 CSS px on *any* viewport, so it buys less on a shorter one: at 1280x720 the two arms
 * read 22 and 1 occlusion-only rather than 13 and 0. `home` moves on every dataset refresh, so
 * these are one draw of each law — the seed study over seven draws of four arms is reproduced by
 * `docs/worlds/dec759-separation-study.py`, whose header gives the commands. And the rule the
 * layout satisfies is a world-space approximation: it converts the pixel floor at the *deepest*
 * point of the disc and bounds the drift, which makes it conservative in those two terms, but the
 * projection is not affine and the rule cannot see that. This file, not the rule, is what says the
 * target is there.
 *
 * `DEC759_HOMES` (a homes file from that study), `DEC759_VIEWPORT` and `DEC759_AZIMUTHS` re-point
 * the candidate arm, and `DEC759_OUT` collects the numbers. With `DEC759_HOMES` set, exactly two
 * of the six tests step aside: the roster-identity check (a study file names no dataset) and the
 * exact acceptance criterion (an ablation arm is expected to fall short — that is what it is for).
 * The other four still run and an ablation arm will fail them, so a study sweep is read from
 * `DEC759_OUT` rather than from the exit code; `DEC759_VIEWPORT=1280x720` on the committed homes
 * fails them too, for the reason in the limits above. No environment at all is the committed
 * measurement, and is what CI scores.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { PlanesFile } from '../src/data/types'

import {
  effectiveDiameterPx,
  effectiveFraction,
  FLOOR_PX,
  REFERENCE_VIEWPORT,
  sweepAzimuths,
} from './effective-target'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const registry = JSON.parse(readFileSync(resolve(webRoot, 'datasets.json'), 'utf8')) as {
  readonly production: string
}
const shipped = JSON.parse(
  readFileSync(resolve(webRoot, 'public', 'data', registry.production, 'planes.json'), 'utf8'),
) as PlanesFile

const study = process.env.DEC759_HOMES
const law = JSON.parse(
  readFileSync(study ?? resolve(webRoot, '..', 'docs', 'worlds', 'dec759-home-law.json'), 'utf8'),
) as {
  readonly dataset?: string
  readonly homes?: Record<string, [number, number, number]>
}
const homes = law.homes ?? (law as unknown as Record<string, [number, number, number]>)

const candidate: PlanesFile = {
  ...shipped,
  planes: shipped.planes.map((plane) => {
    const home = homes[plane.slug]
    return home ? { ...plane, home } : plane
  }),
}

const [width, height] = (process.env.DEC759_VIEWPORT ?? '').split('x').map(Number)
const VIEWPORT =
  width && height ? { viewportWidth: width, viewportHeight: height } : REFERENCE_VIEWPORT
const AZIMUTHS = Number(process.env.DEC759_AZIMUTHS ?? 36)
const TARGET_PX = 2 * FLOOR_PX
/** Floating-point slack: a world that misses by a millionth of a pixel is not short. */
const EPSILON = 1e-9

interface Shortfall {
  /** Worlds the floor lifts somewhere in the turn — the denominator every count is out of. */
  readonly lifted: number
  /** Of those, the ones under 24 px of effective diameter at some azimuth, under each rule. */
  readonly shortFloored: string[]
  readonly occlusionOnly: string[]
  /** The worst effective diameter any lifted world holds, in px, under each rule. */
  readonly worstFlooredPx: number
  readonly worstOcclusionPx: number
}

function measure(planes: PlanesFile): Shortfall {
  const worst = new Map<string, { floored: number; asDrawn: number }>()
  for (const disks of sweepAzimuths(planes, AZIMUTHS, VIEWPORT)) {
    for (const disk of disks) {
      if (!disk.isWorld || disk.rRaw >= FLOOR_PX) continue
      const floored = effectiveDiameterPx(effectiveFraction(disk, disks, 'rFloored'), disk.rFloored)
      const asDrawn = effectiveDiameterPx(effectiveFraction(disk, disks, 'rRaw'), disk.rFloored)
      const seen = worst.get(disk.slug)
      worst.set(disk.slug, {
        floored: Math.min(seen?.floored ?? Infinity, floored),
        asDrawn: Math.min(seen?.asDrawn ?? Infinity, asDrawn),
      })
    }
  }
  const lifted = [...worst.entries()]
  const shortFloored = lifted.filter(([, px]) => px.floored < TARGET_PX - EPSILON)
  return {
    lifted: lifted.length,
    shortFloored: shortFloored.map(([slug]) => slug).sort(),
    occlusionOnly: shortFloored
      .filter(([, px]) => px.asDrawn < TARGET_PX - EPSILON)
      .map(([slug]) => slug)
      .sort(),
    worstFlooredPx: Math.min(...lifted.map(([, px]) => px.floored)),
    worstOcclusionPx: Math.min(...lifted.map(([, px]) => px.asDrawn)),
  }
}

const shippedArm = measure(shipped)
const candidateArm = measure(candidate)

if (process.env.DEC759_OUT) {
  appendFileSync(
    process.env.DEC759_OUT,
    `${JSON.stringify({
      homes: study ?? 'docs/worlds/dec759-home-law.json',
      viewport: `${VIEWPORT.viewportWidth}x${VIEWPORT.viewportHeight}`,
      azimuths: AZIMUTHS,
      shipped: shippedArm,
      candidate: candidateArm,
    })}\n`,
  )
}

describe('the home law as a pick target (spec §1.11 layout amendment, DEC-759)', () => {
  it.skipIf(study)('measures the roster the candidate homes were cut from', () => {
    // A seam that answers is not a seam that answers about the right thing: the vendored homes
    // name the dataset they were laid out for, and overlaying them onto a different roster would
    // silently measure a layout nothing produces.
    expect(law.dataset).toBe(registry.production)
    expect(Object.keys(homes).length).toBe(shipped.planes.length - 1)
  })

  it('has floored worlds to measure in both arms', () => {
    // The denominator guard. A roster or radius-law change that stopped the floor from binding
    // would make every count below vacuously zero, which would read as a pass.
    expect(shippedArm.lifted).toBeGreaterThan(1)
    expect(candidateArm.lifted).toBeGreaterThan(1)
  })

  it('sees the defect: the shipped layout leaves worlds occluded, one of them entirely', () => {
    // The control. `home` predates the law until a dataset refresh carries it, and while it does
    // this arm must fall short — otherwise the candidate arm's zero says nothing.
    const retire =
      'the shipped layout no longer loses a world to occlusion. If a dataset refresh has ' +
      'landed, that is the good outcome and the fix is NOT to loosen this: DELETE this arm and ' +
      'this test, point the file at the shipped homes alone, and DELETE ' +
      'docs/worlds/dec759-home-law.json with pipeline/tests/test_home_separation.py’s pin'
    expect(shippedArm.occlusionOnly.length, retire).toBeGreaterThan(0)
    expect(shippedArm.worstOcclusionPx, retire).toBe(0)
  })

  it.skipIf(study)('separates every world far enough that occlusion never takes its target', () => {
    // The acceptance criterion of DEC-759. Occlusion-only, because that is the half a layout owns:
    // a world short under this rule is behind something a neighbour really draws.
    //
    // The exact zero is a property of *this* committed layout rather than a guarantee of the law
    // — other draws of the same law land one or two grazing worlds (the study in the header). A
    // refresh that regenerates the vendored homes may legitimately need only the looser bound in
    // the next test; what must never come back is a world losing a material share of its target.
    expect(candidateArm.occlusionOnly).toEqual([])
    expect(candidateArm.worstOcclusionPx).toBe(TARGET_PX)

    // Exact, not bounded, and it is the one assertion here that a *constant* inside the rule can
    // move. Converting the pick floor at `1.9 R` instead of the disc's far rim still satisfies
    // every pipeline invariant — they read the generator's own `pick_proxy_radius` on both sides
    // of their comparison — but it leaves four worlds short here, worst 20.64 px. The law's own
    // seeded draws reach 19.68 px (the study), so no *bound* can separate that regression from a
    // legitimate reseed; only this committed layout's exact 24.00 can. `pipeline/tests/
    // test_home_separation.py::test_the_pick_floor_is_converted_at_the_discs_far_rim` is the
    // reseed-proof half of the same guard. DEC-865, item 5.
    expect(candidateArm.worstFlooredPx).toBe(TARGET_PX)
  })

  it('never lets occlusion take a material share of a world’s target', () => {
    // The durable half of the criterion, and the one a refresh is held to rather than the exact
    // zero above. The bound is set where the *law's* draws are, not where this one is: every draw
    // of the old law buries some world at 0 px, while across the law's seven study draws the
    // worst effective diameter runs 19.68–24.00 px under both coverage rules, and four of the
    // seven lose nothing at all as drawn (two of the seven under the floored rule — an earlier
    // draft said five, which was neither). 18 px — three quarters of the target — separates those
    // two populations with room for a reseed, so a failure is a regression and not a new roster.
    // It deliberately does NOT try to catch the far-rim regression, which lands at 20.64 px and
    // so sits *inside* the law's own range; the exact assertion above and the pipeline
    // cross-check do that.
    expect(candidateArm.worstOcclusionPx).toBeGreaterThan(18)
    expect(candidateArm.occlusionOnly.length).toBeLessThan(shippedArm.occlusionOnly.length)
  })

  it('leaves §1.11’s own half nothing to recover either', () => {
    // Separating the proxies removes the floor-on-floor shortfall as a side effect: the rule is
    // stated on proxies rather than on drawn discs, so the floored disks stop eating each other
    // too. That is worth pinning because it is the budget DEC-749's rejected tie-break was
    // arguing over — on this layout it is empty, and severity, not just the count, says so.
    expect(candidateArm.shortFloored.length).toBeLessThan(shippedArm.shortFloored.length)
    expect(candidateArm.worstFlooredPx).toBeGreaterThan(18)
    expect(shippedArm.worstFlooredPx).toBe(0)
  })
})
