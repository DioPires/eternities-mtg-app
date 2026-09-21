/**
 * What the `home` law delivers as a pick *target* (DEC-759, the layout half of §1.11).
 *
 * §1.11's floor guarantees a 24 px *proxy* and cannot guarantee a 24 px *target*: floored proxies
 * overlap, and a nearer disk takes the pixels. DEC-749 ruled the remaining lever is layout, and
 * DEC-751's measurement split the shortfall in two. This file measures the split on the homes
 * `planes.json` ships, and the headline is the **occlusion-only** half — the worlds that fall short
 * even when every neighbour claims only the disk it really draws. That half is the layout's,
 * because no pick policy recovers it; the floor-on-floor remainder is §1.11's and is out of scope
 * here (the Voronoi tie-break that could move it was measured and rejected on DEC-749).
 *
 * **One arm.** Until DEC-885 production predated the law, so this file measured two: the shipped
 * homes as the control, and a vendored candidate (`docs/worlds/dec759-home-law.json`) as the arm
 * under test. The DEC-885 refresh carried the law into `planes.json` and retired both — the shipped
 * layout no longer has a defect to see, and the candidate became a second copy of the shipped
 * homes. What stands between the committed layout and a regressed law is now the pipeline:
 * `pipeline/tests/test_home_separation.py`'s far-rim cross-check and drift-closure tests state
 * §1.11's predicate in literals, and `test_pipeline_invariants.py` holds every built roster to it.
 *
 * Measured on the reference viewport (§1.3's 1920x1080) over a full turn. The counts are minima
 * over the sweep — one bad azimuth condemns a world — so they move with sweep density until it is
 * fine enough. 36 is the first density that converged on DEC-759's two arms, so it is what runs
 * here. A single-azimuth number is not evidence and must not be quoted (§1.11).
 *
 * Three limits this file does not hide. The law is written against the reference viewport, and the
 * floor is 24 CSS px on *any* viewport, so it buys less on a shorter one (§1.11 gives the
 * 1280x720 reading). `home` moves on every dataset refresh, so what this file measures is one draw
 * of the law — the seed study over seven draws is reproduced by
 * `docs/worlds/dec759-separation-study.py`, whose header gives the commands. And the rule the
 * layout satisfies is a world-space approximation: it converts the pixel floor at the *deepest*
 * point of the disc and bounds the drift, which makes it conservative in those two terms, but the
 * projection is not affine and the rule cannot see that. This file, not the rule, is what says the
 * target is there.
 *
 * `DEC759_HOMES` (a homes file from that study) overlays other homes on the shipped roster. The
 * study reads its roster from the recorded pre-refresh dataset (`c9468f1125bcddff`, from git), whose
 * `planes.json` differs from the shipped one only in `home`, so the overlay measures the same roster;
 * its `new-shipped` arm reproduces the shipped homes to 1e-6. `DEC759_VIEWPORT` and
 * `DEC759_AZIMUTHS` move the sweep, and `DEC759_OUT` collects the numbers. With `DEC759_HOMES`
 * set, the exact test steps aside — an ablation arm is expected to fall short, that is what it is
 * for. The other three still run and an ablation arm will fail them, so a study sweep is read from
 * `DEC759_OUT` rather than from the exit code; `DEC759_VIEWPORT=1280x720` on the shipped homes fails
 * them too, for the reason in the limits above. No environment at all is the committed measurement,
 * and is what CI scores.
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
const overlay = study
  ? (JSON.parse(readFileSync(study, 'utf8')) as {
      readonly homes?: Record<string, [number, number, number]>
    })
  : undefined
const homes =
  overlay?.homes ?? (overlay as unknown as Record<string, [number, number, number]> | undefined)

const measured: PlanesFile = homes
  ? {
      ...shipped,
      planes: shipped.planes.map((plane) => {
        const home = homes[plane.slug]
        return home ? { ...plane, home } : plane
      }),
    }
  : shipped

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

const arm = measure(measured)

if (process.env.DEC759_OUT) {
  appendFileSync(
    process.env.DEC759_OUT,
    `${JSON.stringify({
      homes: study ?? `web/public/data/${registry.production}/planes.json`,
      viewport: `${VIEWPORT.viewportWidth}x${VIEWPORT.viewportHeight}`,
      azimuths: AZIMUTHS,
      arm,
    })}\n`,
  )
}

describe('the home law as a pick target (spec §1.11 layout amendment, DEC-759)', () => {
  it('has floored worlds to measure', () => {
    // The denominator guard. A roster or radius-law change that stopped the floor from binding
    // would make every count below vacuously zero, which would read as a pass.
    expect(arm.lifted).toBeGreaterThan(1)
  })

  it.skipIf(study)('separates every world far enough that occlusion never takes its target', () => {
    // The acceptance criterion of DEC-759. Occlusion-only, because that is the half a layout owns:
    // a world short under this rule is behind something a neighbour really draws.
    //
    // The exact zero is a property of *this* shipped layout rather than a guarantee of the law —
    // other draws of the same law land one or two grazing worlds (the study in the header). A
    // refresh that re-lays the roster out may legitimately need only the looser bound in the next
    // test; what must never come back is a world losing a material share of its target.
    expect(arm.occlusionOnly).toEqual([])
    expect(arm.worstOcclusionPx).toBe(TARGET_PX)

    // Exact, not bounded, and it is the one assertion here that a *constant* inside the rule can
    // move. Converting the pick floor at `1.9 R` instead of the disc's far rim still satisfies
    // every pipeline invariant — they read the generator's own `pick_proxy_radius` on both sides
    // of their comparison — but on DEC-759's draw it left four worlds short here, worst 20.64 px.
    // The law's own seeded draws reach 19.68 px (the study), so no *bound* can separate that
    // regression from a legitimate reseed; only a layout that sits at the lattice ceiling can.
    // `pipeline/tests/test_home_separation.py::test_the_pick_floor_is_converted_at_the_discs_far_rim`
    // is the reseed-proof half of the same guard. DEC-865, item 5.
    //
    // **At a refresh, this literal is re-measured and never re-baselined.** It discriminates only
    // while the shipped draw reads exactly 24.00 px — the ceiling of the 48x48 area-sampling
    // lattice, where 2 of the law's 7 seeded draws sit. The DEC-885 refresh re-measured it at
    // 24.00. A refresh that reads below 24 must DELETE this assertion, not rewrite it to the new
    // value: pinned to an arbitrary rung it detects only that the bytes moved. The far-rim
    // cross-check is then the only far-rim guard, and the retirement note must say so.
    expect(arm.worstFlooredPx).toBe(TARGET_PX)
  })

  it('never lets occlusion take a material share of a world’s target', () => {
    // The durable half of the criterion, and the one a refresh is held to rather than the exact
    // zero above. The bound is set where the *law's* draws are, not where this one is: every draw
    // of the old law buried some world at 0 px, while across the law's seven study draws the
    // worst effective diameter runs 19.68–24.00 px under both coverage rules. 18 px — three
    // quarters of the target — separates those two populations with room for a reseed, so a
    // failure is a regression and not a new roster. It deliberately does NOT try to catch the
    // far-rim regression, which lands at 20.64 px and so sits *inside* the law's own range; the
    // exact assertion above and the pipeline cross-check do that.
    expect(arm.worstOcclusionPx).toBeGreaterThan(18)
  })

  it('leaves §1.11’s own half nothing material to recover either', () => {
    // Separating the proxies removes most of the floor-on-floor shortfall as a side effect: the
    // rule is stated on proxies rather than on drawn discs, so the floored disks stop eating each
    // other too. That is worth pinning because it is the budget DEC-749's rejected tie-break was
    // arguing over. Same bound, same reason, as the test above.
    expect(arm.worstFlooredPx).toBeGreaterThan(18)
  })
})
