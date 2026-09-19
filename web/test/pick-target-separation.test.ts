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
 * over the sweep — one bad azimuth condemns a world — so they move with sweep density until it
 * is fine enough: shipped reads 12 occlusion-only at 24 azimuths and 13 at 36, 48, 72 and 144;
 * candidate reads 0 at all five. 36 is the first density that has converged, so it is what runs
 * here. A single-azimuth number is not evidence and must not be quoted (§1.11).
 *
 * Two limits this file does not hide. The law is written against the reference viewport, and the
 * floor is 24 CSS px on *any* viewport: at 1280x720 the same two layouts read 22 and 4
 * occlusion-only rather than 13 and 0. And `home` moves on every dataset refresh, so these are
 * one draw of each law; the seed study over seven draws is in the DEC-759 hand-back.
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
  readonly production: string
}
const shipped = JSON.parse(
  readFileSync(resolve(webRoot, 'public', 'data', registry.production, 'planes.json'), 'utf8'),
) as PlanesFile
const law = JSON.parse(
  readFileSync(resolve(webRoot, '..', 'docs', 'worlds', 'dec759-home-law.json'), 'utf8'),
) as { readonly dataset: string; readonly homes: Record<string, [number, number, number]> }

const candidate: PlanesFile = {
  ...shipped,
  planes: shipped.planes.map((plane) => {
    const home = law.homes[plane.slug]
    return home ? { ...plane, home } : plane
  }),
}

const AZIMUTHS = 36
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
  for (const disks of sweepAzimuths(planes, AZIMUTHS)) {
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

describe('the home law as a pick target (spec §1.11 layout amendment, DEC-759)', () => {
  it('measures the roster the candidate homes were cut from', () => {
    // A seam that answers is not a seam that answers about the right thing: the vendored homes
    // name the dataset they were laid out for, and overlaying them onto a different roster would
    // silently measure a layout nothing produces.
    expect(law.dataset).toBe(registry.production)
    expect(Object.keys(law.homes).length).toBe(shipped.planes.length - 1)
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
    //
    // When a refresh does land, this is the assertion that will fail, and the fix is not to
    // loosen it: delete this arm, point the file at the shipped homes alone, and retire
    // `docs/worlds/dec759-home-law.json` with the pipeline test that pins it.
    expect(shippedArm.occlusionOnly.length).toBeGreaterThan(0)
    expect(shippedArm.worstOcclusionPx).toBe(0)
  })

  it('separates every world far enough that occlusion never takes its target', () => {
    // The acceptance criterion of DEC-759. Occlusion-only, because that is the half a layout owns:
    // a world short under this rule is behind something a neighbour really draws.
    expect(candidateArm.occlusionOnly).toEqual([])
    expect(candidateArm.worstOcclusionPx).toBe(TARGET_PX)
  })

  it('leaves a residual that is floor-on-floor and a graze', () => {
    // What is left is §1.11's own budget, not the layout's, and it is small in a way the count
    // alone hides: the worlds still short are short by a few percent, where the shipped layout
    // buries one completely. Reporting the count without the severity is how "13 of 19" and
    // "0 of 3" get read as the same kind of number.
    expect(candidateArm.shortFloored.length).toBeLessThan(shippedArm.shortFloored.length)
    expect(candidateArm.worstFlooredPx).toBeGreaterThan(18)
    expect(shippedArm.worstFlooredPx).toBe(0)
  })
})
