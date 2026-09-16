/**
 * W1's gate row takes ONE azimuth per world. This is the precondition that makes that sound.
 *
 * `worlds-gate.mjs` reads each world once at the plane-level settle and scores §3.1's W1 from that
 * draw. But a world's median front-facing cell height is a **family** over the rotation of the
 * mosaic relative to the camera, not a number, so a single draw is the statistic only while that
 * family is narrow — and how narrow it is turns entirely on `spin.ts`'s {@link APPLY_PLANE_TILT},
 * which DEC-750 left open and off. This file measures both arms and turns the assumption into a
 * build error the day the flag moves (DEC-752, relay `03bfa906` item 4).
 *
 * > **The load-bearing assertion is a MEASUREMENT, not a pin on the boolean.** {@link sweepShipped}
 * > poses through {@link planeOrientation} — the product's single writer of `surface.orientation` —
 * > so flipping `APPLY_PLANE_TILT` changes what "shipped" *means* here and the width assertion reds
 * > on its own. The boolean is asserted too, but only as a named cross-check: a constant cannot
 * > testify to its own provenance, so the row that binds is the one that gives the law an input and
 * > watches it respond. {@link sweepTilted} is the negative control that proves the instrument can
 * > see the defect at all — without it, "the family is narrow" is indistinguishable from "the sweep
 * > never moved the camera".
 *
 * ## This file is NOT `worlds-framing.test.ts`
 *
 * DEC-818's file pins the **`[tilted]`** arm at the framing distance, deliberately, as the
 * conservative bound. This one pins the **`[shipped]`** arm — what the build actually renders — and
 * asks a different question: not "does the law carry every world over the floor" but "is the gate's
 * one draw reproducible". The two share a roster and a probe and nothing else.
 *
 * ## Every pose here is re-derived, and the polar is READ rather than assumed
 *
 * The distances come out of {@link framingRadii} rather than being copied from the relay — the law
 * is `min(3.2, CELL_LIFT + cellArc x focalPx / CELL_FRAMING_PX)` and it returns 2.260705 on
 * dominaria and 3.080104 on ravnica, which is what the rig is then measured to arrive at. The
 * polar is `HOME_POLAR` where nothing better is known, but on the two worlds that bind W1 it is the
 * **live arrival polar read off the probe's own `centre` and `cameraPosition`** — see
 * {@link ARRIVAL_POLAR_DEG}. `HOME_POLAR` is where the fly-to aims, not where it lands, and it is
 * optimistic by ~2%; the row below measures that gap rather than inheriting it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'

import { HOME_POLAR } from '../src/camera/framing'
import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlanesFile } from '../src/data/types'
import { AdaptiveThreshold } from '../src/scene/worlds/adaptiveThreshold'
import { ArtPool } from '../src/scene/worlds/artPool'
import { PLANE_HOME } from '../src/scene/worlds/centre'
import type { WorldsSeams } from '../src/scene/worlds/seams'
import { APPLY_PLANE_TILT, NO_SPIN, planeOrientation, worldOrientation } from '../src/scene/worlds/spin'
import {
  FRAMING_REFERENCE_FOV_RADIANS,
  FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX,
  SILHOUETTE_FRAMING_RADII,
  framingRadii,
} from '../src/scene/worlds/surfaceLaw'
import { buildWorldSource, worldPlanesOf, type WorldPlane } from '../src/scene/worlds/worldSource'
import { WorldSurface, type WorldFrame } from '../src/scene/worlds/worldSurface'
import { buildWorldsProbe } from '../src/scene/worlds/worldsProbe'

/** §3.1's floor. Quoted, never re-derived — `worlds-metrics.mjs` owns the criterion. */
const W1_FLOOR_PX = 24

/**
 * The comb, matching `worlds-framing.test.ts` so the two files' figures are comparable.
 *
 * > **A worst-of-N is a subsample minimum, so every margin below is an UPPER bound.** The last row
 * > in this file measures that directly rather than asserting it in prose: taking the comb to 240
 * > moves each minimum **down**, never up. [[a-subsample-minimum-drifts-with-sample-density]].
 */
const AZIMUTHS = 24

/** The density the last row compares against. Ten times the comb, same sweep. */
const DENSE_AZIMUTHS = 240

/**
 * Where the rig actually settles, in degrees of polar angle — **measured, not assumed**.
 *
 * `HOME_POLAR` is 60 deg and is where the fly-to *aims*. Read off the shipped payload's `centre`
 * and `cameraPosition` (the pole is world `+Y`), the rig lands at 63.13 deg on dominaria and 61.82
 * on ravnica, and the W1 statistic falls ~0.12-0.20 px per degree there — so a pose placed at
 * `HOME_POLAR` reads about 2% high. These two are pinned because they are the only two worlds whose
 * arrival pose has been read live, and that is exactly enough: the framing law pulls in exactly
 * these two worlds, and they are exactly the two that bind W1 (asserted below). Re-pinning the
 * other 43 off two readings would trade a stated bias for an unstated one, so they stay at
 * `HOME_POLAR` with the bias declared.
 *
 * Live readings, `?probe=shell` at 1920x1080 dpr 1, held across a near-complete relative turn of the
 * mosaic: dominaria `radii` 2.2607 / polar 63.132 deg / median **28.08-28.23 px** over 89% turnover;
 * ravnica `radii` 3.0801 / polar 61.817 deg / median **29.88-29.95 px** over 52% turnover. Both
 * bracket the offline figures this file pins, which is the cross-check that makes an offline pose a
 * stand-in for the rig rather than a parallel universe.
 */
const ARRIVAL_POLAR_DEG: Readonly<Record<string, number>> = {
  dominaria: 63.132,
  ravnica: 61.817,
}

const VIEWPORT = { width: 1920, height: FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX }
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

const NO_SEAMS: WorldsSeams = {
  swatchMean: false,
  bandsShuffle: false,
  artOff: false,
  artThresholdFixed24: false,
  layersRequested: null,
}

/** §1.3's framing distance for a world, off the law itself rather than off a recorded figure. */
const lawRadii = (plane: WorldPlane): number => framingRadii(plane.rowCells)

/** The pose this file measures a world at: its own arrival polar where one has been read. */
const polarOf = (slug: string): number =>
  slug in ARRIVAL_POLAR_DEG ? (ARRIVAL_POLAR_DEG[slug]! * Math.PI) / 180 : HOME_POLAR

function frameAt(distance: number, centre: Vector3, azimuth: number, polar: number): WorldFrame {
  const camera = new PerspectiveCamera(55, VIEWPORT.width / VIEWPORT.height, 0.1, 10_000)
  camera.position.set(
    centre.x + distance * Math.sin(polar) * Math.sin(azimuth),
    centre.y + distance * Math.cos(polar),
    centre.z + distance * Math.sin(polar) * Math.cos(azimuth),
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
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** One world's W1 family over the azimuth, with the orientation the caller installs. */
function sweep(
  plane: WorldPlane,
  radii: number,
  polar: number,
  azimuths: number,
  orient: (plane: WorldPlane, surface: WorldSurface) => void,
): number[] {
  const surface = new WorldSurface(buildWorldSource(plane, STARS, SWATCHES), {
    seams: NO_SEAMS,
    pool: new ArtPool(1024),
    threshold: new AdaptiveThreshold(true),
    stream: null,
    artTexture: null,
  })
  orient(plane, surface)
  const medians: number[] = []
  for (let i = 0; i < azimuths; i += 1) {
    const frame = frameAt(surface.radius * radii, surface.centre, (i / azimuths) * Math.PI * 2, polar)
    surface.update(frame)
    // The pose, asserted before a single height is read (DEC-804's lesson). Five places: the
    // `tilt` quaternion ships rounded to six decimals, so a rotated vector is off unit length by
    // ~1e-6 and a tighter bound would be pinning the rounding of a data field.
    expect(surface.radii, `${plane.slug} pose`).toBeCloseTo(radii, 5)
    const heights = buildWorldsProbe(surface.probeSource(frame))
      .cells.filter((c) => c.frontFacing)
      .map((c) => c.height)
    // A world presenting no front-facing cell has no median — out of domain, never zero.
    if (heights.length > 0) medians.push(median(heights))
  }
  return medians
}

/**
 * The arm the build renders, posed through the product's own orientation writer.
 *
 * **This indirection is the guard.** `planeOrientation` gates `plane.tilt` on `APPLY_PLANE_TILT`,
 * so flipping that constant silently re-points every figure this function produces — which is the
 * point: the width assertion below then reds on a measurement rather than needing anyone to
 * remember that a gate somewhere takes one draw.
 */
const sweepShipped = (plane: WorldPlane, radii: number, polar: number, n = AZIMUTHS): number[] =>
  sweep(plane, radii, polar, n, (p, s) => {
    planeOrientation(p, NO_SPIN, s.orientation)
  })

/**
 * The negative control: `plane.tilt` applied unconditionally, which is what the flag would turn on.
 *
 * Without this, "the shipped family is 0.1% wide" cannot be told from "the sweep never moved the
 * camera" — [[confirm-the-instrument-sees-the-defect]]. Same surface, same comb, same poses, one
 * quaternion different.
 */
const sweepTilted = (plane: WorldPlane, radii: number, polar: number, n = AZIMUTHS): number[] =>
  sweep(plane, radii, polar, n, (p, s) => {
    worldOrientation(p.tilt, 0, s.orientation)
  })

/** The half-width of a family, as a percentage of its own middle. */
function halfWidthPct(family: readonly number[]): number {
  const min = Math.min(...family)
  const max = Math.max(...family)
  return ((max - min) / 2 / ((max + min) / 2)) * 100
}

/**
 * How wide a family may be before one draw stops standing for it.
 *
 * Not a tuned constant: W1's gate row reports a margin, and a reported margin has to reproduce.
 * 1% is comfortably above the two binding worlds' measured 0.13% and 0.43% and an order of
 * magnitude below the tilted arm's 11% and 16%, so nothing between the two arms could pass.
 */
const SINGLE_DRAW_WIDTH_PCT = 1

/** Every world's worst sampled azimuth in the shipped arm, at its own framing distance. */
function shippedWorstByWorld(): { slug: string; radii: number; worst: number; width: number }[] {
  return WORLDS.map((plane) => {
    const radii = lawRadii(plane)
    const family = sweepShipped(plane, radii, polarOf(plane.slug))
    return {
      slug: plane.slug,
      radii,
      worst: Math.min(...family),
      width: halfWidthPct(family),
    }
  }).sort((a, b) => a.worst - b.worst)
}

describe('W1 is scored from one azimuth, and that is a claim about APPLY_PLANE_TILT (DEC-752)', () => {
  it('binds on exactly the two worlds the framing law pulls in', () => {
    // The denominator, always: "no violations" and "I could not look" must not print the same.
    expect(WORLDS.length).toBe(45)

    // Re-derived from the law, not copied from the relay.
    const moved = WORLDS.filter((p) => lawRadii(p) < SILHOUETTE_FRAMING_RADII).map((p) => p.slug)
    expect(moved.sort()).toEqual(['dominaria', 'ravnica'])
    expect(lawRadii(WORLDS.find((p) => p.slug === 'dominaria')!)).toBeCloseTo(2.260705, 6)
    expect(lawRadii(WORLDS.find((p) => p.slug === 'ravnica')!)).toBeCloseTo(3.080104, 6)

    // **The coincidence this file leans on, asserted rather than assumed.** The two worlds the law
    // moves are the two worlds that bind W1 — which is why pinning an arrival polar for exactly
    // those two is enough, and why the other 43 can stay at `HOME_POLAR` with a declared bias.
    // If a roster refresh ever separated the two sets, this row reds and `ARRIVAL_POLAR_DEG` needs
    // the new binding world measured before any margin below means anything.
    const ranked = shippedWorstByWorld()
    expect(ranked.slice(0, 2).map((r) => r.slug).sort()).toEqual(moved.sort())
    expect(Object.keys(ARRIVAL_POLAR_DEG).sort()).toEqual(moved.sort())
  })

  it('clears §3.1s floor at every sampled azimuth, dominaria binding at 17% of margin', () => {
    const ranked = shippedWorstByWorld()
    // Reachability, stated rather than counted: every world offers a front-facing cell at some
    // azimuth, so none of the 45 is out of domain here.
    expect(ranked.filter((r) => !Number.isFinite(r.worst))).toEqual([])

    const worstFive = ranked
      .slice(0, 5)
      .map((r) => `${r.slug} ${r.worst.toFixed(2)}px at ${r.radii.toFixed(4)} radii`)
      .join(', ')
    for (const row of ranked) {
      expect(row.worst, `${row.slug} at ${row.radii.toFixed(4)} radii`).toBeGreaterThanOrEqual(
        W1_FLOOR_PX,
      )
    }

    // The order, pinned by name — a bound alone cannot say which worlds carry the law, and these
    // five are the rows a roster refresh moves first.
    expect(ranked.slice(0, 5).map((r) => r.slug)).toEqual([
      'dominaria',
      'ravnica',
      'innistrad',
      'new-phyrexia',
      'zendikar',
    ])
    // The margin, reported rather than left to the bound: a row that only asserts ">= 24" cannot
    // tell 24.01 from 240, and how much slack the law leaves is the whole question.
    //
    // Measured at each world's own arrival polar where one is known — dominaria 28.10, ravnica
    // 29.92. At `HOME_POLAR` the same sweep reads 28.74 and 30.19, which is the ~2% optimism the
    // last-but-one row below measures.
    expect(ranked[0]!.worst, `worst five: ${worstFive}`).toBeGreaterThan(W1_FLOOR_PX * 1.15)
    expect(ranked[0]!.worst).toBeCloseTo(28.1, 1)
    expect(ranked[1]!.worst).toBeCloseTo(29.92, 1)
  })

  it('takes one draw from a family 0.14-0.20% wide — and the tilted arm shows the instrument can see 11%', () => {
    const rows = WORLDS.filter((p) => lawRadii(p) < SILHOUETTE_FRAMING_RADII).map((plane) => {
      const radii = lawRadii(plane)
      const polar = polarOf(plane.slug)
      return {
        slug: plane.slug,
        shipped: halfWidthPct(sweepShipped(plane, radii, polar)),
        tilted: halfWidthPct(sweepTilted(plane, radii, polar)),
      }
    })

    for (const row of rows) {
      // **The assertion the gate's single draw rests on.** `sweepShipped` poses through
      // `planeOrientation`, so this reds the day `APPLY_PLANE_TILT` flips — no second edit needed.
      expect(row.shipped, `${row.slug} shipped family half-width`).toBeLessThan(
        SINGLE_DRAW_WIDTH_PCT,
      )
      // The control, scored per world rather than once: an assertion that the tilted arm is wide
      // is what makes the row above a reading instead of a tautology. Both arms share a surface,
      // a comb and a pose, so the only variable between them is the quaternion.
      expect(row.tilted, `${row.slug} tilted family half-width`).toBeGreaterThan(8)
      expect(row.tilted / row.shipped, `${row.slug} arm ratio`).toBeGreaterThan(20)
      // **The bound is not free to drift, and this row is why.** `SINGLE_DRAW_WIDTH_PCT` never
      // binds on the shipped tree — the family is 0.2% against a bound of 1 — so relaxing it to 20
      // would leave the guard admitting the exact 11% configuration it exists to forbid, and the
      // mutation matrix found that **no other row here notices**
      // ([[a-bound-check-is-vacuous-when-the-bound-never-binds]]). Pinning it strictly between the
      // two measured arms makes the constant a consequence of the measurement rather than a
      // number someone may retune to clear a red.
      expect(SINGLE_DRAW_WIDTH_PCT, `${row.slug}: the bound must reject the tilted arm`).toBeLessThan(
        row.tilted,
      )
      expect(
        SINGLE_DRAW_WIDTH_PCT,
        `${row.slug}: the bound must accept the shipped arm`,
      ).toBeGreaterThan(row.shipped)
    }

    // Pinned, because the ratio is the finding: turning the tilt on widens dominaria's family by
    // ~55x and ravnica's by ~109x. Those are the numbers behind "one draw stops being the
    // statistic". All four are taken at each world's own arrival polar, so they differ from the
    // `HOME_POLAR` figures quoted in `worlds-gate.mjs` (0.13% and 0.43% shipped) — the pose is a
    // parameter of the width too, and ravnica's family is the narrower of the two where the rig
    // actually stops.
    const dominaria = rows.find((r) => r.slug === 'dominaria')!
    const ravnica = rows.find((r) => r.slug === 'ravnica')!
    expect(dominaria.shipped).toBeCloseTo(0.2, 2)
    expect(dominaria.tilted).toBeCloseTo(11.2, 1)
    expect(ravnica.shipped).toBeCloseTo(0.14, 2)
    expect(ravnica.tilted).toBeCloseTo(15.19, 1)
  })

  it('names the flag the rows above depend on, so flipping it cannot be a one-line change', () => {
    // The cross-check, and deliberately NOT the load-bearing row — a constant cannot testify to
    // its own provenance, and the width rows above already fail on a measurement if this moves.
    // What this adds is the *message*: whoever flips the flag is told what else is owed, which a
    // width assertion reading "expected 11.2 to be less than 1" does not say on its own.
    expect(
      APPLY_PLANE_TILT,
      'APPLY_PLANE_TILT has been turned on (DEC-750 left it open). W1 in `worlds-gate.mjs` is ' +
        'scored from ONE azimuth per world at the plane-level settle, which is sound only while ' +
        "the per-world median family is flat. With the tilt applied it is 11-16% wide, so every " +
        'W1 verdict the gate prints becomes a draw on the arrival azimuth. Before flipping this: ' +
        'give the gate an azimuth sweep for W1 (it will cost ~24x the tour), or pin W1 to a ' +
        'named azimuth, and re-take every figure in this file and in `worlds-framing.test.ts`.',
    ).toBe(false)
  })

  it('reads the arrival polar off the payload instead of assuming HOME_POLAR, which is ~2% optimistic', () => {
    // Item 5 of the relay, measured rather than inherited. `HOME_POLAR` is where the fly-to aims;
    // the rig lands ~2-3 deg further round, and the statistic falls with the polar there. The
    // direction is what matters: `HOME_POLAR` flatters the build, so a floor checked at it is
    // checked at the wrong end. Both poses clear 24, which is why this is a declared bias and not
    // a defect — but the margin quoted anywhere must be the conservative one.
    for (const slug of ['dominaria', 'ravnica']) {
      const plane = WORLDS.find((p) => p.slug === slug)!
      const radii = lawRadii(plane)
      const atHome = Math.min(...sweepShipped(plane, radii, HOME_POLAR))
      const atArrival = Math.min(...sweepShipped(plane, radii, polarOf(slug)))
      expect(atArrival, `${slug} arrival vs HOME_POLAR`).toBeLessThan(atHome)
      expect(atArrival, `${slug} at its arrival polar`).toBeGreaterThanOrEqual(W1_FLOOR_PX)
      // The size of the gap, so "about 2%" is a reading. dominaria 28.74 -> 28.10 (2.2%),
      // ravnica 30.19 -> 29.92 (0.9%).
      expect((atHome - atArrival) / atHome).toBeLessThan(0.05)
    }
    expect(Math.min(...sweepShipped(WORLDS.find((p) => p.slug === 'dominaria')!, 2.260705, HOME_POLAR))).toBeCloseTo(
      28.74,
      1,
    )
  })

  it('reports an UPPER bound: a coarser comb reads a higher minimum than a denser one', () => {
    // [[a-subsample-minimum-drifts-with-sample-density]], measured on both binding worlds rather
    // than asserted in a docblock. Every margin in this file is a worst-of-24 and therefore an
    // upper bound on the true worst azimuth; this row fixes the SIGN of that bias so no future
    // reader has to guess which way a denser sweep would move a verdict.
    for (const slug of ['dominaria', 'ravnica']) {
      const plane = WORLDS.find((p) => p.slug === slug)!
      const radii = lawRadii(plane)
      const polar = polarOf(slug)
      const coarse = Math.min(...sweepShipped(plane, radii, polar, AZIMUTHS))
      const dense = Math.min(...sweepShipped(plane, radii, polar, DENSE_AZIMUTHS))
      expect(coarse, `${slug} n=${AZIMUTHS} vs n=${DENSE_AZIMUTHS}`).toBeGreaterThanOrEqual(dense)
      // And the drift is small enough that it moves no verdict — the bound still clears the floor
      // at ten times the density, which is the claim that licenses shipping the coarse comb.
      expect(dense, `${slug} dense`).toBeGreaterThanOrEqual(W1_FLOOR_PX)
      expect((coarse - dense) / coarse, `${slug} drift`).toBeLessThan(0.01)
    }
  })
})
