/**
 * §1.3's framing distance, against §3.1's W1 floor (DEC-818).
 *
 * **What this file measures, and why it is not a restatement of the law.** Every number below is
 * taken by posing a real {@link WorldSurface} built from the shipped `planes.json`, `stars.bin` and
 * `swatches.bin`, running a frame, and reading the cells out of `buildWorldsProbe` — the same
 * payload leg G's gate scores W1 from. Nothing here re-derives a projection: the distance comes out
 * of {@link Framing}, the heights come out of the probe, and the only arithmetic this file does is
 * a median.
 *
 * > **The pose is asserted before anything is read (DEC-804's lesson).** `WorldSurface.radii` is
 * > checked against the distance the camera was placed at on every single sample. A W1 number taken
 * > at a pose nobody verified is the defect DEC-804 spent a leg on.
 *
 * ## EVERY NUMBER IN THIS FILE IS THE `[tilted]` ARM, WHICH THE BUILD DOES NOT RENDER TODAY
 *
 * > **Normative — read this before quoting anything below (DEC-822).** `sweepMedians` poses with
 * > `worldOrientation(plane.tilt, 0, ...)`, applying §1.3's `planes.json` quaternion
 * > **unconditionally**. The product composes orientation through `planeOrientation` — the single
 * > writer of `surface.orientation` — and that gates the tilt on `APPLY_PLANE_TILT`, **`false`**
 * > since DEC-750. So this file measures a configuration the shipped build does not run, and it does
 * > so **deliberately**: the tilted arm is the more conservative bound and the one that goes live
 * > the day the flag flips. It is kept as the assertion arm for that reason. **Every pinned figure
 * > here is `[tilted]`; the `[shipped]` figure is quoted beside it wherever it differs, and
 * > `docs/worlds/spec.md` §1.3 carries both columns.**
 *
 * ## W1's per-world median is a FAMILY over the approach azimuth — 11-15% wide `[tilted]`, 0.3-0.6% `[shipped]`
 *
 * The rig arrives at `HOME_POLAR` — 30 deg of elevation — at whatever azimuth the flight inherited,
 * and §1.3 tilts every world's pole by `planes.json`'s own quaternion. So as the azimuth turns, the
 * tilted pole swings in and out of the front-facing cap and takes a cohort of squat polar cells with
 * it. Measured here at 3.2 radii, dominaria's median runs **15.50 to 19.35 px** and ravnica's
 * **23.88 to 32.66** — spreads of 11% and 15% about their own middles. **`[shipped]` those bands are
 * 17.48-17.58 and 28.64-28.99**, 0.3% and 0.6% wide: with the pole upright, turning the azimuth is a
 * spin about that pole, which maps each row-ring onto itself.
 *
 * **Leg G's acceptance tour samples one azimuth per world**, and the draw it got was dominaria 17.14
 * and ravnica 28.49. That draw was **sound**, not lucky: 28.49 sits inside the 0.6%-wide shipped
 * band, so leg G's "one world under the floor" is the correct count for the build that ships. This
 * file reports two because it measures the tilted arm, where ravnica's worst azimuth is 23.88 and a
 * single draw would be a coin flip. Every bound below is therefore taken over the sweep and never at
 * a frame — [[one-frame-of-a-moving-system-is-a-sample]] — which is the rule that binds the day
 * `APPLY_PLANE_TILT` flips.
 *
 * ## The pose is `HOME_POLAR`, which is an OFFLINE APPROXIMATION ~2% HIGH
 *
 * `HOME_POLAR` is 60 deg; read off the probe's own `centre` and `cameraPosition`, the rig actually
 * settles at **63.13 deg on dominaria and 61.82 deg on ravnica**, and the statistic falls 0.12-0.20
 * px per degree there (DEC-822 N2). So every figure in this file is about **2% high** against the
 * product. It is left at `HOME_POLAR` rather than re-pinned because the arrival polar is per-world
 * and only two of the 45 have been measured; re-pinning 45 poses off two readings would trade a
 * stated bias for an unstated one. The bias does not eat the margin — at the measured arrival polars
 * the new law gives dominaria 25.56-31.15 and ravnica 26.63-34.52 `[tilted]`, both clear of 24.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'

import { HOME_POLAR, Framing, emptyTether, planeFramingRadii } from '../src/camera/framing'
import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlaneRecord, PlanesFile } from '../src/data/types'
import { AdaptiveThreshold } from '../src/scene/worlds/adaptiveThreshold'
import { ArtPool } from '../src/scene/worlds/artPool'
import { PLANE_HOME } from '../src/scene/worlds/centre'
import type { WorldsSeams } from '../src/scene/worlds/seams'
import { worldOrientation } from '../src/scene/worlds/spin'
import { cellHeightPx } from '../src/scene/worlds/lod'
import {
  CELL_FRAMING_PX,
  FRAMING_REFERENCE_FOV_RADIANS,
  FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX,
  SILHOUETTE_FRAMING_RADII,
  cellDrawAngles,
  drawRadius,
  framingRadii,
} from '../src/scene/worlds/surfaceLaw'
import { buildWorldSource, worldPlanesOf, type WorldPlane } from '../src/scene/worlds/worldSource'
import { WorldSurface, type WorldFrame } from '../src/scene/worlds/worldSurface'
import { buildWorldsProbe } from '../src/scene/worlds/worldsProbe'

/** §3.1's floor. Quoted, never re-derived — leg G's `worlds-metrics.mjs` owns the criterion. */
const W1_FLOOR_PX = 24

/**
 * §3.1's reference viewport, spelled once here and read from the law everywhere else.
 *
 * The width is the aspect's, and the aspect moves screen `x` alone — `cellScreenRect` takes `height`
 * from the projection's vertical half-angle and `viewportHeightPx`. It is stated so the camera this
 * file builds is the one the gate drives.
 */
const VIEWPORT = { width: 1920, height: FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX }

/**
 * Azimuths per world.
 *
 * A count, not a tolerance: the family is smooth in azimuth, and 24 evenly spaced samples put the
 * worst one within a fraction of a pixel of the 120-sample sweep the constant was chosen against
 * (dominaria 25.55 at 120, 25.55 at 24). Evenly spaced and never random — leg G measured a random
 * comb reporting a false extremum 2.5% of the time on W5's own sweep.
 *
 * > **A worst-of-N is a subsample minimum, so every margin below is an UPPER bound (DEC-822).** Take
 * > the comb to 240 and tilted dominaria drifts 25.550 -> 25.477; ravnica is stable at 25.208 across
 * > n=24/48/120/240. The drift is small enough not to move any verdict here, and it is the reason
 * > the reported margin is quoted as "at least" rather than as the margin —
 * > [[a-subsample-minimum-drifts-with-sample-density]].
 */
const AZIMUTHS = 24

const DATA = resolve(__dirname, '../public/data')
const datasets = JSON.parse(readFileSync(resolve(__dirname, '../datasets.json'), 'utf8')) as Record<
  string,
  string
>
const DIR = resolve(DATA, datasets.worlds!)
const PLANES = JSON.parse(readFileSync(resolve(DIR, 'planes.json'), 'utf8')) as PlanesFile

function bufferOf(name: string): ArrayBuffer {
  const bytes = readFileSync(resolve(DIR, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const STARS = decodeStars(bufferOf('stars.bin'))
const SWATCHES = decodeSwatches(bufferOf('swatches.bin'))
const WORLDS = worldPlanesOf(PLANES.planes)
const FRAMING = new Framing(PLANES)

const NO_SEAMS: WorldsSeams = {
  swatchMean: false,
  bandsShuffle: false,
  artThresholdFixed24: false,
  layersRequested: null,
}

/**
 * The rig's arrival pose, approximated: `distance` from `centre`, at `HOME_POLAR`, looking in.
 *
 * The azimuth is the sweep parameter. The polar is the rig's own `framePolar` and is **not** swept:
 * a fly-to arrives there, and sweeping it would measure poses the product does not stop at.
 *
 * > **`HOME_POLAR` is where the fly-to aims, not where it lands — this pose is ~2% high (DEC-822
 * > N2).** Measured off the probe's `centre` and `cameraPosition`, the settle arrives at 63.13 deg
 * > on dominaria and 61.82 on ravnica against `HOME_POLAR`'s 60, and the statistic falls 0.12-0.20
 * > px/deg there. Every number this function feeds is therefore an offline approximation biased
 * > **high** — the conservative direction for a floor is *low*, so the bias is stated rather than
 * > relied on, and the margins below are quoted with it in view. See the file header.
 */
function frameAt(distance: number, centre: Vector3, azimuth: number): WorldFrame {
  const camera = new PerspectiveCamera(55, VIEWPORT.width / VIEWPORT.height, 0.1, 10_000)
  camera.position.set(
    centre.x + distance * Math.sin(HOME_POLAR) * Math.sin(azimuth),
    centre.y + distance * Math.cos(HOME_POLAR),
    centre.z + distance * Math.sin(HOME_POLAR) * Math.cos(azimuth),
  )
  camera.lookAt(centre)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return {
    camera: {
      matrixWorldInverse: camera.matrixWorldInverse,
      projectionMatrix: camera.projectionMatrix,
      position: camera.position,
      near: camera.near,
    },
    viewport: VIEWPORT,
    fovRadians: FRAMING_REFERENCE_FOV_RADIANS,
    deltaSeconds: 0,
    lightDirection: new Vector3(0, 0, 1),
    centreOf: PLANE_HOME,
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * One world's W1 statistic swept over the azimuth, at a pose given **in radii**.
 *
 * The surface is built once and re-posed, because construction bakes an equirect and a geometry and
 * neither is a function of the camera. Spin is left at zero and that is a measurement, not an
 * assumption: §1.3 spins a world about its own pole, which maps each row-ring onto itself, and a
 * 12-angle sweep moves dominaria's median by 0.16% — against 11% for the azimuth. The tilt, which
 * does move it, is read from `planes.json` and applied.
 *
 * > **This line is the `[tilted]` arm, and it is the one thing here the product does not do
 * > (DEC-822).** `worldOrientation(plane.tilt, 0, ...)` applies the quaternion unconditionally;
 * > `planeOrientation` — the product's single writer of `surface.orientation` — gates it on
 * > `APPLY_PLANE_TILT`, `false` since DEC-750. Swap this one call for `planeOrientation` and the
 * > 11% family collapses to 0.3%, because with the pole upright the azimuth sweep *is* the spin
 * > measured above. Kept tilted on purpose: it is the conservative bound and the live one the day
 * > the flag flips. See the file header for both columns.
 */
function sweepMedians(plane: WorldPlane, radii: number): number[] {
  const surface = new WorldSurface(buildWorldSource(plane, STARS, SWATCHES), {
    seams: NO_SEAMS,
    pool: new ArtPool(1024),
    threshold: new AdaptiveThreshold(true),
    stream: null,
    artTexture: null,
  })
  worldOrientation(plane.tilt, 0, surface.orientation)
  const medians: number[] = []
  for (let i = 0; i < AZIMUTHS; i += 1) {
    // `surface.radius` and not `plane.radius`: §1.3's law derives the radius from `cardCount`
    // while `planes.json` ships it rounded to six places, and the two differ by 2.3e-7 relative.
    // Irrelevant to any picture, and exactly enough to make a tight pose assertion flap.
    const frame = frameAt(surface.radius * radii, surface.centre, (i / AZIMUTHS) * Math.PI * 2)
    surface.update(frame)
    // The pose, asserted before a single height is read (DEC-804). `radii` is the surface's own
    // `|camera - centre| / radius`, so this catches a camera placed at the wrong distance AND a
    // world whose centre has stopped tracking the one the camera was aimed at.
    //
    // Five places and not more, for a measured reason: `WorldSurface` takes `radii` from the camera
    // *after* `applyQuaternion(inverseOrientation)`, and `planes.json` ships `tilt` rounded to six
    // decimals — a quaternion off unit length by ~1e-6, which scales the rotated vector by |q|^2.
    // azgol reads 3.1999992693 for a camera placed at exactly 3.2. It is 2.3e-7 relative, nothing
    // downstream can see it, and DEC-804's own normative wording is "to float precision and not to
    // equality". A tighter bound here would be pinning the rounding of a data field.
    expect(surface.radii, `${plane.slug} pose`).toBeCloseTo(radii, 5)
    const cells = buildWorldsProbe(surface.probeSource(frame)).cells
    const heights = cells.filter((c) => c.frontFacing).map((c) => c.height)
    // A world presenting no front-facing cell has no median — leg G's `evaluateW1` reports that as
    // out-of-domain rather than as zero, and so does this. The six one-card worlds land here at
    // some azimuths and not others.
    if (heights.length > 0) medians.push(median(heights))
  }
  return medians
}

/** The worst azimuth, or `null` where the world offered no measurable frame at all. */
function worstMedian(plane: WorldPlane, radii: number): number | null {
  const medians = sweepMedians(plane, radii)
  return medians.length === 0 ? null : Math.min(...medians)
}

/** What `Framing` — not the law function — actually arrives at, in units of the plane's radius. */
function framedRadii(plane: PlaneRecord): number {
  return FRAMING.plane(emptyTether(), plane).frameDistance / plane.radius
}

/**
 * The worlds the cell law pulls in, taken off the law rather than off `framedRadii`.
 *
 * `frameDistance / radius` is a multiply and a divide, so a capped world comes back as 3.1999999998
 * as often as 3.2 and an `!==` against the cap reports four worlds moved where two are. The wiring
 * between the two spellings is asserted on its own below, so this exactness costs no coverage.
 */
function movedByLaw(): string[] {
  return WORLDS.filter((p) => framingRadii(p.rowCells) < SILHOUETTE_FRAMING_RADII)
    .map((p) => p.slug)
    .sort()
}

describe('§1.3 the framing distance frames cells, not silhouettes (DEC-818)', () => {
  it('finds the roster it is supposed to measure', () => {
    // The denominator, always: "no violations" and "I could not look" must not print the same.
    expect(WORLDS.length).toBe(45)
    expect(WORLDS.some((w) => w.slug === 'dominaria' && w.cardCount === 6271)).toBe(true)
  })

  it('carries every world over §3.1s 24 px floor at every sampled azimuth', () => {
    const rows = WORLDS.map((plane) => ({
      slug: plane.slug,
      rows: plane.rowCells.length,
      radii: framedRadii(plane),
      worst: worstMedian(plane, framedRadii(plane)),
    }))

    const measured = rows.filter((r) => r.worst !== null)
    // The domain, stated rather than counted. `worst` is a minimum over azimuths, so a world is
    // measurable here if it presents a front-facing cell at **any** of the 24 — and on this roster
    // all 45 do, which is the same reachability claim W5's floor makes.
    //
    // **This is why the sweep and leg G's tour report different denominators.** The gate draws one
    // azimuth per world and reported nine worlds out of domain — belenon, ergamon, karsus,
    // muraganda, pyrulea, regatha, segovia, shandalar, zhalfir, every one of them a 1- or 2-card
    // world whose cells happened to face away in that frame. None of them is out of domain here.
    const undefinedPlanes = rows.filter((r) => r.worst === null).map((r) => r.slug)
    expect(undefinedPlanes).toEqual([])
    expect(measured.length).toBe(45)

    const ranked = [...measured].sort((a, b) => a.worst! - b.worst!)
    const worstFive = ranked
      .slice(0, 5)
      .map((r) => `${r.slug} ${r.worst!.toFixed(2)}px at ${r.radii.toFixed(3)} radii`)
      .join(', ')

    for (const row of ranked) {
      expect(row.worst!, `${row.slug} at ${row.radii.toFixed(3)} radii`).toBeGreaterThanOrEqual(
        W1_FLOOR_PX,
      )
    }
    // The margin on the binding world, reported rather than left to the bound. A row that only
    // asserts ">= 24" cannot tell 24.01 from 240, and the whole question this leg answered was how
    // much slack the law leaves.
    //
    // > **4% is the `[tilted]` bound; `[shipped]` the margin is 20% (DEC-822).** The binding world
    // > differs with the arm too — ravnica at 25.21 here, dominaria at 28.74 shipped. The bound is
    // > left at the tilted figure because that is the arm this file poses and the smaller of the
    // > two; a 20% bound asserted against a tilted sweep would red on a build that is fine.
    expect(ranked[0]!.worst!, `worst five: ${worstFive}`).toBeGreaterThan(W1_FLOOR_PX * 1.04)
    // The worst five, pinned by name and to a tenth of a pixel. A bound alone cannot tell which
    // worlds are carrying the law, and those five are the rows a future roster refresh moves first.
    //
    // > `[shipped]` this order is **dominaria 28.74, ravnica 30.19, innistrad 33.78, new-phyrexia
    // > 37.05, zendikar 39.02** — the same five worlds, with the top two swapped (DEC-822).
    expect(ranked.slice(0, 5).map((r) => r.slug)).toEqual([
      'ravnica',
      'dominaria',
      'innistrad',
      'new-phyrexia',
      'zendikar',
    ])
    expect(ranked[0]!.worst!).toBeCloseTo(25.21, 1)
    expect(ranked[1]!.worst!).toBeCloseTo(25.55, 1)
    expect(ranked[2]!.worst!).toBeCloseTo(30.53, 1)
    expect(ranked[3]!.worst!).toBeCloseTo(30.89, 1)
    expect(ranked[4]!.worst!).toBeCloseTo(36.12, 1)
  })

  it('is what the OLD flat 3.2-radii law could not do — two worlds [tilted], one [shipped]', () => {
    // The falsifier, and it is a measurement of the shipped roster rather than a fixture: restoring
    // `frame: r * 3.2` in `Framing.plane` — or making `framingRadii` return the cap — puts these two
    // worlds back under the floor, and the row above goes red with them named.
    //
    // > **The count this row asserts is the `[tilted]` one (DEC-822 B2).** In the arm the build
    // > actually renders, **dominaria alone** is under the floor at 3.2 — 17.48 px — and ravnica is
    // > green at every azimuth (28.64-28.99). Ravnica's 3.2 -> 3.080 move is **margin, not repair**.
    // > The two-world count is real, it is just real in the arm this file poses; it becomes the
    // > shipped count the day `APPLY_PLANE_TILT` flips. Both are kept because the defect and the
    // > repair hold either way: dominaria is under 24 px in **both** arms, and the law carries it to
    // > 28.74 `[shipped]` / 25.55 `[tilted]`.
    const under = WORLDS.map((plane) => ({
      slug: plane.slug,
      worst: worstMedian(plane, SILHOUETTE_FRAMING_RADII),
    })).filter((r) => r.worst !== null && r.worst < W1_FLOOR_PX)

    expect(under.map((r) => r.slug).sort()).toEqual(['dominaria', 'ravnica'])
    // Leg G's single-azimuth tour read 17.14 here; this is the same world at its worst azimuth.
    expect(under.find((r) => r.slug === 'dominaria')!.worst).toBeCloseTo(15.5, 0)
    expect(under.find((r) => r.slug === 'ravnica')!.worst).toBeCloseTo(23.9, 0)
  })

  it('moves exactly the two worlds that needed it and leaves the other 43 untouched', () => {
    // §3.1's "no currently-green world regresses" is checked at its cause rather than by re-running
    // the sweep: a world the law does not pull in is framed at the same distance as before, so its
    // W1 reading is the same number bit for bit.
    expect(movedByLaw()).toEqual(['dominaria', 'ravnica'])
    for (const plane of WORLDS) {
      const moved = movedByLaw().includes(plane.slug)
      // Nearer, never further — the only direction that can raise a cell's pixel height — and
      // *identical* for the 43 the law leaves alone.
      if (moved) expect(framedRadii(plane), plane.slug).toBeLessThan(SILHOUETTE_FRAMING_RADII)
      else expect(framedRadii(plane), plane.slug).toBeCloseTo(SILHOUETTE_FRAMING_RADII, 6)
    }
    expect(framedRadii(WORLDS.find((p) => p.slug === 'dominaria')!)).toBeCloseTo(2.261, 3)
    expect(framedRadii(WORLDS.find((p) => p.slug === 'ravnica')!)).toBeCloseTo(3.08, 3)
  })

  it('is the law Framing.plane actually arrives at, and not a parallel copy of it', () => {
    // The wiring, asserted per plane. Without this row `framingRadii` could be correct and unused —
    // which is exactly what the old `frame: r * 3.2` line was, one edit away.
    for (const plane of PLANES.planes) {
      expect(framedRadii(plane), plane.slug).toBeCloseTo(planeFramingRadii(plane), 6)
    }
    expect(planeFramingRadii(WORLDS.find((p) => p.slug === 'dominaria')!)).toBeLessThan(
      SILHOUETTE_FRAMING_RADII,
    )
  })

  it('keeps the arrival distance inside PRD 5.7.1s own limits', () => {
    // The law chooses `frame`; it does not get to choose `min` and `max`. A framing distance outside
    // them would arrive at a pose the zoom immediately pushes the camera off, which reads as a
    // flight that overshoots rather than as a framing bug.
    for (const plane of PLANES.planes) {
      const tether = FRAMING.plane(emptyTether(), plane)
      expect(tether.frameDistance, plane.slug).toBeGreaterThan(tether.minDistance)
      expect(tether.frameDistance, plane.slug).toBeLessThan(tether.maxDistance)
    }
  })
})

describe('§1.3 the framing law responds to its input', () => {
  it('is strictly nearer for more rows, until the silhouette cap takes over', () => {
    // A constant cannot testify to its own provenance: this gives the law an input and asserts it
    // moves. `rowCells` is only read for its length here, which is the whole of the law's dependence
    // on the data.
    let previous = Infinity
    let capped = 0
    let free = 0
    for (let rows = 1; rows <= 200; rows += 1) {
      const radii = framingRadii(new Array<number>(rows).fill(1))
      expect(radii).toBeLessThanOrEqual(previous)
      if (radii === SILHOUETTE_FRAMING_RADII) capped += 1
      else free += 1
      previous = radii
    }
    // Both branches are exercised, and the crossover is where the header says it is.
    expect(capped).toBeGreaterThan(0)
    expect(free).toBeGreaterThan(0)
    expect(framingRadii(new Array<number>(46).fill(1))).toBe(SILHOUETTE_FRAMING_RADII)
    expect(framingRadii(new Array<number>(47).fill(1))).toBeLessThan(SILHOUETTE_FRAMING_RADII)
  })

  it('inverts cellHeightPx exactly at the sub-camera point', () => {
    // The law's closed form, checked against the renderer's own sizing function rather than against
    // a second copy of the algebra. At the framing distance the nearest cell is `CELL_FRAMING_PX`
    // tall — that is the whole statement, and it is what makes the constant readable.
    const rowCells = new Array<number>(81).fill(1)
    const radii = framingRadii(rowCells)
    expect(radii).toBeLessThan(SILHOUETTE_FRAMING_RADII)
    const latArc = cellDrawAngles(rowCells, 0).lat
    const near = cellHeightPx(
      latArc,
      drawRadius(1),
      radii - drawRadius(1),
      FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX,
      FRAMING_REFERENCE_FOV_RADIANS,
    )
    expect(near).toBeCloseTo(CELL_FRAMING_PX, 9)
  })

  it('frames a plane with no cell sheet on its silhouette', () => {
    // The domain. §2.4 makes `rowCells` the test for "has a surface", and the 42 empty planes and
    // the Blind Eternities have no rows to divide by.
    //
    // > **What this row can and cannot falsify, measured.** Dropping the guard outright — handing
    // > `framingRadii` an absent `rowCells` — reds this row and three others, because the law reads
    // > `rowCells.length`. Substituting a *default* table is **indistinguishable** at any length up
    // > to 46, because the silhouette cap absorbs it and returns 3.2 either way. So this asserts the
    // > guard exists, not that the fallback value was chosen well; the fallback's own justification
    // > is that a plane with no cells has no cell to frame, and that is a claim about §1.8 rather
    // > than a number. [[reachable-is-not-discriminating]].
    const moons = PLANES.planes.filter((p) => !('rowCells' in p) || !Array.isArray(p.rowCells))
    expect(moons.length).toBeGreaterThan(0)
    for (const moon of moons) {
      expect(framedRadii(moon), moon.slug).toBeCloseTo(SILHOUETTE_FRAMING_RADII, 12)
    }
  })
})
