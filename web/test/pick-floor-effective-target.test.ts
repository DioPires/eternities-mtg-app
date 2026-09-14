/**
 * R1's independent re-measurement behind the §1.11 ruling (DEC-749, on DEC-751's routing).
 *
 * Not a pin — a probe, kept because it is the evidence for two numbers the spec now carries and
 * because `pick-floor-screen-space.test.ts` is the file that should end up owning them. Run it with
 * `PROBE_AZ` (default 37), `PROBE_ORDERING` (`entry` | `centre`) and `PROBE_OUT`.
 *
 * Four deliberate departures from `pick-floor-screen-space.test.ts`:
 *
 *  1. **Ordering rule.** `scenePicker.ts` keeps the candidate whose ray/sphere *hit point* is
 *     nearest the eye, not the one whose *centre* is nearest. Inflating a proxy pulls its entry
 *     point toward the camera by up to its own world radius, so the two rules *could* disagree
 *     exactly where the floor is doing work. **They do not**: every figure below is byte-identical
 *     under `PROBE_ORDERING=centre` and `=entry`, at both sweeps. The centre-depth approximation is
 *     safe here, and that is a measured result rather than an assumption.
 *  2. **Sweep.** 37 azimuths as well as 24, so no agreement is an artefact of a shared sample grid.
 *     The counts that matter are the ones stable across both.
 *  3. **A true as-drawn control.** `effectiveFraction`'s control lets `a` keep claiming its
 *     *floored* disk while the neighbours drop to their drawn one, which is a hybrid, not the
 *     status quo. Here `ownRule` moves with `neighbourRule`, so the control is "no floor anywhere".
 *     Under it the dead-sample counts are not equal but strictly *ordered* — 4 floored vs 5 as
 *     drawn at 24 azimuths, 5 vs 11 at 37 — so the floor does better than DEC-751 claimed for it:
 *     it removes dead samples rather than breaking even. DEC-751's `toBe` should be a `<`.
 *  4. **An attribution row.** The whole measurement is re-run with the neighbours' floors off, so
 *     the only thing that can take a pixel is a disk something really draws. **13 of the 19 short
 *     worlds are still short** — the shortfall is mostly ordinary occlusion, not floored proxies
 *     eating each other, and no overlap rule can reach it.
 *
 * It also measures the quantity DEC-751 did not: what the floor costs planes that are *not*
 * floored, sampled over the disk they actually draw. That is where the ruling's new finding comes
 * from — the floor pushes `eldraine` and `kamigawa`, both already over 24 px as drawn, under it
 * (worst ~20.6 px at 37 azimuths, ~21.8 at 24). The plain floor already has the failure mode that
 * was cited as the reason to reject the Voronoi tie-break.
 *
 * Mutants, each killing exactly one assertion: DEC-751's hybrid control kills #2; dropping the
 * neighbours' floors in the victim pass kills #4; a `FLOOR_PX` of 0 kills all five, which is why
 * #1 is the denominator guard and not evidence for anything else.
 */

import { readFileSync, writeFileSync } from 'node:fs'
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
const FOV = (55 * Math.PI) / 180
const MARGIN = 1.15
const FLOOR_PX = 12
/** `Projector.pixelsPerUnitAtUnitDepth`, recomputed here so world radii can be recovered. */
const PPU = VIEWPORT.viewportHeight / 2 / Math.tan(FOV / 2)

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
  readonly rRaw: number
  readonly rFloored: number
  readonly isWorld: boolean
}

function readAt(angleRad: number): Disk[] {
  const rig = new CameraRig(planes)
  rig.snapTo({
    tether: rig.framing.multiverse(emptyTether()),
    durationS: 0,
    holdS: 0,
  })
  rig.update(1 / 60)
  rig.motion.syncClock(0, angleRad)

  const projector = new Projector()
  projector.update({
    position: rig.position,
    target: rig.lookAt,
    fov: FOV,
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

type Rule = 'rRaw' | 'rFloored'

/**
 * Distance from the eye to the point where the pointer ray enters `d`'s sphere, or `Infinity` if
 * the ray misses it. `screenR` is the sphere's on-screen radius under the rule in force; the
 * matching world radius is recovered from it so the chord is measured on the sphere being tested.
 */
const ORDERING = process.env.PROBE_ORDERING ?? 'entry'

function entryDistance(d: Disk, px: number, py: number, screenR: number): number {
  if (screenR <= 0) return Infinity
  const offset = Math.hypot(px - d.x, py - d.y)
  if (offset > screenR) return Infinity
  // The control: DEC-751 ranks candidates by centre depth, which is what the ray/sphere test
  // reduces to if the sphere had no extent.
  if (ORDERING === 'centre') return d.depth
  const worldR = (screenR * d.depth) / PPU
  return d.depth - worldR * Math.sqrt(Math.max(0, 1 - (offset / screenR) ** 2))
}

/**
 * The fraction of the disk of radius `ownR` around `a` that the picker awards to `a`.
 *
 * `ownRule`/`neighbourRule` choose which radius each side claims, so the same routine serves both
 * "what does a floored world keep" and "what does an as-drawn world lose".
 */
function ownedFraction(
  a: Disk,
  all: readonly Disk[],
  ownR: number,
  ownRule: Rule,
  neighbourRule: Rule,
): number {
  const N = 64
  let inside = 0
  let mine = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const px = a.x + ((i + 0.5) / N - 0.5) * 2 * ownR
      const py = a.y + ((j + 0.5) / N - 0.5) * 2 * ownR
      if (Math.hypot(px - a.x, py - a.y) > ownR) continue
      inside += 1
      const mineEntry = entryDistance(a, px, py, a[ownRule])
      let won = mineEntry < Infinity
      if (won) {
        for (const b of all) {
          if (b === a) continue
          if (entryDistance(b, px, py, b[neighbourRule]) < mineEntry) {
            won = false
            break
          }
        }
      }
      if (won) mine += 1
    }
  }
  return inside === 0 ? 0 : mine / inside
}

const AZIMUTHS = Number(process.env.PROBE_AZ ?? 37)
const sweep = Array.from({ length: AZIMUTHS }, (_, i) => readAt((i * 2 * Math.PI) / AZIMUTHS))

const diameterPx = (fraction: number) => 2 * FLOOR_PX * Math.sqrt(fraction)

function measureWith(flooredNeighbourRule: Rule) {
  {
    const flooredSlugs = new Set<string>()
    let flooredSamples = 0
    let deadFloored = 0
    let deadAsDrawn = 0
    let shortOf24 = 0
    const underBySlug = new Set<string>()
    let selfInflicted = 0
    let worstEffective = Infinity
    let worstSlug = ''

    // What the floor costs planes that are not themselves floored, over the disk they draw.
    const victims = new Map<string, number>()
    let unflooredSamples = 0
    let regressions = 0
    const regressedSlugs = new Set<string>()
    let worstRegressedPx = Infinity
    let worstRegressedSlug = ''

    for (const disks of sweep) {
      for (const disk of disks) {
        if (!disk.isWorld) continue
        if (disk.rRaw < FLOOR_PX) {
          flooredSlugs.add(disk.slug)
          flooredSamples += 1
          const floored = ownedFraction(
            disk,
            disks,
            disk.rFloored,
            'rFloored',
            flooredNeighbourRule,
          )
          const asDrawn = ownedFraction(disk, disks, disk.rFloored, 'rRaw', 'rRaw')
          if (floored <= 0) deadFloored += 1
          if (asDrawn <= 0) deadAsDrawn += 1
          const eff = diameterPx(floored)
          if (eff < 2 * FLOOR_PX - 1e-9) {
            shortOf24 += 1
            underBySlug.add(disk.slug)
          }
          if (eff < worstEffective) {
            worstEffective = eff
            worstSlug = disk.slug
          }
          if (asDrawn > 0.9 && floored < 0.5) selfInflicted += 1
        } else {
          const withFloors = ownedFraction(disk, disks, disk.rRaw, 'rRaw', 'rFloored')
          const without = ownedFraction(disk, disks, disk.rRaw, 'rRaw', 'rRaw')
          const loss = without - withFloors
          if (loss > 1e-6) victims.set(disk.slug, Math.max(victims.get(disk.slug) ?? 0, loss))
          // The decisive question for §1.11's wording: does the floor push a world that already
          // cleared 24 px below it? `rRaw >= FLOOR_PX` means its drawn proxy is already compliant.
          const effWith = 2 * disk.rRaw * Math.sqrt(withFloors)
          const effWithout = 2 * disk.rRaw * Math.sqrt(without)
          unflooredSamples += 1
          if (effWithout >= 2 * FLOOR_PX && effWith < 2 * FLOOR_PX) {
            regressions += 1
            regressedSlugs.add(disk.slug)
            if (effWith < worstRegressedPx) {
              worstRegressedPx = effWith
              worstRegressedSlug = disk.slug
            }
          }
        }
      }
    }

    const victimList = [...victims.entries()].sort((a, b) => b[1] - a[1])
    const report = {
      azimuths: AZIMUTHS,
      worldsInRoster: worldSlugs.size,
      flooredSomewhere: flooredSlugs.size,
      flooredSamples,
      deadFloored,
      deadAsDrawn,
      shortOf24Samples: shortOf24,
      shortOf24DistinctWorlds: underBySlug.size,
      selfInflictedSamples: selfInflicted,
      worstEffectiveDiameterPx: Number(worstEffective.toFixed(2)),
      worstSlug,
      unflooredSamples,
      floorInducedRegressions: regressions,
      regressedWorlds: [...regressedSlugs],
      worstRegressedPx: Number(worstRegressedPx.toFixed(2)),
      worstRegressedSlug,
      unflooredVictims: victimList.length,
      worstVictims: victimList.slice(0, 8).map(([s, l]) => [s, Number(l.toFixed(3))]),
    }
    if (process.env.PROBE_OUT) {
      writeFileSync(process.env.PROBE_OUT, JSON.stringify(report, null, 2))
    }
    return report
  }
}

const report = measureWith('rFloored')

describe('what the §1.11 pick floor does to the effective target (DEC-749, on DEC-751)', () => {
  it('has floored worlds to measure, at more than one azimuth', () => {
    // The denominator guard, kept from DEC-751: without it every assertion below is vacuous.
    expect(report.flooredSamples).toBeGreaterThan(report.azimuths)
    expect(report.flooredSomewhere).toBeGreaterThan(1)
  })

  it('removes dead samples rather than breaking even, under a true no-floor control', () => {
    // DEC-751 asserts equality here, but its control leaves `a` on its floored disk while the
    // neighbours drop to their drawn one. With the control moved to "no floor anywhere", the floor
    // is strictly better than break-even. The direction is the claim; the digits move with the
    // sweep, so only the ordering is pinned.
    // Strict, deliberately: the hybrid control DEC-751 uses yields *equality*, so `<=` would pass
    // under both controls and would not be a test of the correction at all.
    expect(report.deadFloored).toBeLessThan(report.deadAsDrawn)
    // ...and the instrument does see burial, so this is not two zeroes agreeing.
    expect(report.deadAsDrawn).toBeGreaterThan(0)
  })

  it('does not deliver a 24 px effective target to every world it lifts', () => {
    // Why §1.11 no longer claims a 24 px target. Floored proxies overlap and the nearer wins.
    expect(report.shortOf24DistinctWorlds).toBeGreaterThan(0)
    expect(report.shortOf24DistinctWorlds).toBeLessThan(report.flooredSomewhere)
  })

  it('is short mostly because of occlusion, which no pick policy can undo', () => {
    // The attribution, and the reason a tie-break cannot rescue the section: re-run the same
    // measurement with the neighbours' floors switched off, so the only thing that can take a pixel
    // is a disk something really draws. Most of the shortfall survives that, so it is occlusion by
    // genuinely nearer geometry and not floored proxies eating each other. Only the difference
    // between the two is addressable by any overlap rule at all.
    const occlusionOnly = measureWith('rRaw')
    expect(occlusionOnly.shortOf24DistinctWorlds).toBeGreaterThan(0)
    expect(occlusionOnly.shortOf24DistinctWorlds).toBeLessThan(report.shortOf24DistinctWorlds)
    // ...and the addressable remainder is the minority of the samples.
    const addressable = report.shortOf24Samples - occlusionOnly.shortOf24Samples
    expect(addressable).toBeLessThan(report.shortOf24Samples / 2)
  })

  it('pushes worlds that already cleared 24 px as drawn below it', () => {
    // The finding that is R1's rather than DEC-751's, and the one that makes the plain floor and
    // the rejected Voronoi tie-break comparable: both regress already-compliant worlds.
    expect(report.floorInducedRegressions).toBeGreaterThan(0)
    expect(report.worstRegressedPx).toBeLessThan(2 * FLOOR_PX)
    // The victims are unfloored worlds, so this cannot be the floored cohort counted twice.
    expect(report.regressedWorlds.length).toBeGreaterThan(0)
    expect(report.regressedWorlds.every((slug) => worldSlugs.has(slug))).toBe(true)
  })
})
