/**
 * The worlds acceptance criteria, and the negative-control matrix that keeps them honest.
 *
 * Spec §3.1 makes the matrix normative: "a criterion that has never been seen to fail is not an
 * instrument, it is a rubber stamp". `worlds-gate.mjs --negative-controls` runs the matrix against
 * the live renderer, which needs leg R1's seams. This file runs the same matrix against the
 * *arithmetic*, out of the prototype's measured numbers (Appendix A) — so the criteria are known to
 * go red on the frames they exist to forbid before the renderer that produces those frames exists.
 *
 * What this can and cannot prove: it pins the measurement, not the seam. That `?swatch=mean` makes
 * every cell take the plane's mean swatch is R1's to deliver and the live matrix's to check; that a
 * frame in which every cell took the mean swatch fails W2 is settled here.
 */

import { describe, expect, it } from 'vitest'

import {
  BAND_ORDER,
  FLOORS,
  ROSTER_V3,
  W3_MIN_BAND_SHARE,
  checkControlRow,
  deltaE76,
  deltaEab,
  evaluateW1,
  evaluateW2,
  evaluateW3,
  evaluateW4,
  evaluateW5,
  evictionRate,
  homeLabelCeiling,
  iqr,
  isLabelVisible,
  median,
  quantile,
  srgbToLab,
  LABEL_VISIBLE_MIN_OPACITY,
  type Criterion,
  type Measure,
  type CellSample,
  type Rgb,
} from '../scripts/lib/worlds-metrics.mjs'

// ------------------------------------------------------------------------------------------------
// Fixtures — Appendix A's measured poses, and a modelled world surface
// ------------------------------------------------------------------------------------------------

/**
 * Appendix A, `docs/worlds/spec.md`. Production dataset `6d4779695fde33ea`, 1920×1080 CSS, dpr 1,
 * art threshold 24 px, pool 1,024 layers, Apple Silicon. Not a Windows measurement.
 */
const PROTOTYPE = {
  dominariaFrame: { radii: 3.0, cellHeightPx: 25.3, drawn: 333, wanted: 333, evicted: 0 },
  dominariaFar: { radii: 6.0, cellHeightPx: 10.1, drawn: 0, wanted: 0, evicted: 0 },
  tetherSurface: { radii: 2.2, cellHeightPx: 42.1, drawn: 1_024, wanted: 2_759, evicted: 925 },
} as const

/** The 29 worlds, as W1 sees them: Dominaria is the binding plane and the rest sit above it. */
function worldsAtSettle(dominariaMedianPx: number) {
  const cells = (height: number) =>
    Array.from({ length: 200 }, (_, i) => ({ height: height + (i % 5) * 0.1, frontFacing: true }))
  return [
    { slug: 'dominaria', cells: cells(dominariaMedianPx) },
    ...Array.from({ length: 28 }, (_, i) => ({
      slug: `world-${i}`,
      cells: cells(dominariaMedianPx + 4 + i),
    })),
  ]
}

/**
 * A swatch per band class, standing in for what `swatches.bin` will carry.
 *
 * These are the *class means*. Real swatches are per card — a green card's `art_crop` may average
 * to brown, to near-black, to bright gold — and `jitterSwatch` below is what models that. Getting
 * this wrong is not cosmetic: give every cell in a band one identical swatch and W2 fails on a
 * perfectly good mosaic, because a cell's nearest neighbour is almost always in its own band.
 */
const BAND_SWATCH: Record<string, Rgb> = {
  colourless: [150, 150, 150],
  green: [60, 140, 70],
  red: [190, 70, 55],
  black: [70, 60, 65],
  blue: [60, 110, 180],
  white: [225, 215, 180],
  gold: [200, 170, 80],
}

/**
 * §1.4's shading, exactly as the fragment shader writes it.
 *
 *   shade = clamp(dot(n, light) · 0.5 + 0.5, 0, 1);  shade = 0.10 + 0.95 · shade²
 *
 * The light is camera-relative (§1.7, Q6), so `dot(n, light)` is the cell normal's z. This is
 * modelled rather than hand-waved because the W2 control turns on it: shading alone spreads L\*
 * across the disc even when every cell carries the same swatch.
 */
function shade(nz: number): number {
  const s = Math.min(1, Math.max(0, nz * 0.5 + 0.5))
  return 0.1 + 0.95 * s * s
}

function shadeRgb(swatch: Rgb, nz: number): Rgb {
  const k = shade(nz)
  return [
    Math.min(255, Math.round(swatch[0] * k)),
    Math.min(255, Math.round(swatch[1] * k)),
    Math.min(255, Math.round(swatch[2] * k)),
  ]
}

/** A deterministic hash in [0, 1). No `Math.random` — a fixture that moves between runs is not one. */
function hash01(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** One card's swatch: its class mean, plus the per-card spread that makes a mosaic a mosaic. */
function jitterSwatch(base: Rgb, i: number, amount = 26): Rgb {
  return [0, 1, 2].map((c) =>
    Math.min(255, Math.max(0, Math.round((base[c] as number) + (hash01(i, c) - 0.5) * 2 * amount))),
  ) as unknown as Rgb
}

/**
 * A world's front-facing cells, laid out on the projected disc.
 *
 * Three knobs, kept separate because each control turns exactly one of them:
 *
 * - `bandAt` — which band the cell *reports*, from its latitude. The grid.
 * - `classAt` — which colour class the card sitting in that cell belongs to. `?bands=shuffle`
 *   permutes the assignment, so the grid is untouched and every band ends up holding a mix.
 * - `swatchOf` — the colour that card draws with. `?swatch=mean` collapses it to one value.
 *
 * Folding `classAt` into `bandAt` is the mistake that makes a shuffle control look green: shuffle
 * the label and the colour together and each band is still perfectly uniform, just relabelled.
 */
function modelWorld({
  radiusPx = 400,
  step = 20,
  bandAt = (v: number) => bandByLatitude(v),
  classAt,
  swatchOf,
  shaded = true,
}: {
  radiusPx?: number
  step?: number
  bandAt?: (v: number, i: number) => number
  classAt: (v: number, i: number) => string
  swatchOf: (cls: string, i: number) => Rgb
  shaded?: boolean
}): CellSample[] {
  const cells: CellSample[] = []
  let i = 0
  for (let v = -radiusPx + step / 2; v < radiusPx; v += step) {
    for (let u = -radiusPx + step / 2; u < radiusPx; u += step) {
      const r2 = (u * u + v * v) / (radiusPx * radiusPx)
      if (r2 >= 1) continue
      const nz = Math.sqrt(1 - r2)
      // §1.6's facing test: reject if dot(normal, toCamera) <= 0.12.
      if (nz <= 0.12) continue
      const swatch = swatchOf(classAt(v / radiusPx, i), i)
      cells.push({
        x: 960 + u,
        y: 540 + v,
        // Cells foreshorten towards the limb, which is why W2 has a 6 px floor at all.
        height: Math.max(2, 30 * nz),
        frontFacing: true,
        band: bandAt(v / radiusPx, i),
        rgb: shaded ? shadeRgb(swatch, nz) : swatch,
        // What the renderer reports, not what the gate re-derives. An unshaded frame still has a
        // shade term — it is simply constant, which is why the flat-wash case degenerates to one
        // iso-shade ring holding every cell.
        shade: shaded ? shade(nz) : shade(1),
      })
      i += 1
    }
  }
  return cells
}

/** The plane's mean swatch, which is what `?swatch=mean` hands every cell. */
const MEAN_SWATCH: Rgb = [132, 124, 118]

/** Production: the card's own swatch, spread about its class mean. */
const productionSwatch = (cls: string, i: number) => jitterSwatch(BAND_SWATCH[cls] as Rgb, i)

const classByLatitude = (v: number) => BAND_ORDER[bandByLatitude(v)] as string

/** Latitude → band index. `v` runs −1 (north) to +1 (south) across the disc. */
const bandByLatitude = (v: number) =>
  Math.min(BAND_ORDER.length - 1, Math.max(0, Math.floor(((v + 1) / 2) * BAND_ORDER.length)))

/** Every mono class 15% (7.5% per mirrored band), gold 10%, colourless 15%. Sums to 1. */
const BAND_SHARES: number[] = BAND_ORDER.map((c) => (c === 'gold' ? 0.1 : 0.075))

// ------------------------------------------------------------------------------------------------

describe('colour', () => {
  it('puts the sRGB primaries and greys where CIELAB says they are', () => {
    const white = srgbToLab([255, 255, 255])
    expect(white.L).toBeCloseTo(100, 3)
    expect(white.a).toBeCloseTo(0, 3)
    expect(white.b).toBeCloseTo(0, 3)

    expect(srgbToLab([0, 0, 0]).L).toBeCloseTo(0, 6)

    // Mid grey is L* ≈ 53.6, not 50 — the check that the transfer function is applied at all.
    expect(srgbToLab([128, 128, 128]).L).toBeCloseTo(53.585, 2)

    const red = srgbToLab([255, 0, 0])
    expect(red.L).toBeCloseTo(53.24, 1)
    expect(red.a).toBeCloseTo(80.09, 1)
    expect(red.b).toBeCloseTo(67.2, 1)
  })

  it('separates the full ΔE from the a*b*-only distance', () => {
    // Two greys: far apart in L*, identical in chroma. W2 should see a difference; W3 must not.
    const dark = srgbToLab([60, 60, 60])
    const light = srgbToLab([200, 200, 200])
    expect(deltaE76(dark, light)).toBeGreaterThan(50)
    expect(deltaEab(dark, light)).toBeLessThan(0.5)
  })
})

describe('statistics', () => {
  it('takes the median of an even-length sample as the midpoint of the middle pair', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([])).toBeNull()
  })

  it('interpolates quantiles the way NumPy and R do', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10)
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10)
    expect(iqr([1, 2, 3, 4])).toBeCloseTo(1.5, 10)
  })
})

describe('W1 — cells are resolvable at framing distance', () => {
  it('passes on the prototype-measured 25.3 px at the plane-level settle', () => {
    const w1 = evaluateW1(worldsAtSettle(PROTOTYPE.dominariaFrame.cellHeightPx))
    expect(w1.pass).toBe(true)
    expect(w1.worstPlane).toBe('dominaria')
    expect(w1.measures[0]?.value).toBeGreaterThanOrEqual(FLOORS.cellHeightPx)
  })

  it('goes RED on its control — the 6× radius capture, where cells measured 10.1 px', () => {
    const w1 = evaluateW1(worldsAtSettle(PROTOTYPE.dominariaFar.cellHeightPx))
    expect(w1.pass).toBe(false)
    expect(w1.measures[0]?.value).toBeLessThan(FLOORS.cellHeightPx)
  })

  it('is decided by the worst world, not by the pooled median', () => {
    // 28 comfortable worlds and one that is not. Pooling would bury it; "cells are resolvable" is a
    // claim about every world.
    const planes = worldsAtSettle(40)
    planes[0] = { slug: 'rabiah', cells: [{ height: 9, frontFacing: true }] }
    const w1 = evaluateW1(planes)
    expect(w1.pass).toBe(false)
    expect(w1.worstPlane).toBe('rabiah')
  })

  it('ignores back-facing cells', () => {
    const w1 = evaluateW1([
      {
        slug: 'dominaria',
        cells: [
          { height: 30, frontFacing: true },
          { height: 30, frontFacing: true },
          { height: 0.4, frontFacing: false },
          { height: 0.4, frontFacing: false },
          { height: 0.4, frontFacing: false },
        ],
      },
    ])
    expect(w1.measures[0]?.value).toBe(30)
  })
})

describe('W2 — the mosaic reads as tiles', () => {
  const mosaic = modelWorld({ classAt: classByLatitude, swatchOf: productionSwatch })

  /** `?swatch=mean`: every cell takes the plane's mean swatch. Grid and bands unchanged. */
  const meanSwatch = modelWorld({ classAt: classByLatitude, swatchOf: () => MEAN_SWATCH })

  it('passes on a banded mosaic', () => {
    const w2 = evaluateW2(mosaic)
    expect(w2.pass).toBe(true)
  })

  it('goes RED on its control — ?swatch=mean — via the neighbour-ΔE half', () => {
    const w2 = evaluateW2(meanSwatch)
    expect(w2.pass).toBe(false)

    const neighbour = w2.measures.find((m) => m.key === 'medianNeighbourDeltaE')
    expect(neighbour?.pass).toBe(false)
    // Adjacent cells share a normal to within a few degrees, so all that survives is a sliver of
    // the lambert gradient — a median around 1.3 against a floor of 6, and steepest at the limb
    // where the normal turns fastest.
    expect(neighbour?.value).toBeLessThan(FLOORS.neighbourDeltaE / 3)
  })

  /**
   * The iso-shade subset, and why it replaced a gate-side sixth control row.
   *
   * Measured over *every* sampled cell, IQR(L\*) could not be red under `?swatch=mean` — §1.4's
   * shade spreads a ~3× luminance range across the disc with one swatch throughout, so the measure
   * was reading the lit sphere rather than the mosaic. DEC-749 re-derived it and showed the
   * un-subsetted measure cannot go below ~12 for *any* single swatch: not a half without a control,
   * a half that could not fail. Holding shade fixed leaves swatch-to-swatch lightness, which is
   * what W2's title claims to measure — and `?swatch=mean` then drives it to ≈ 0, so one real
   * control row falsifies both halves.
   */
  it('goes RED on ?swatch=mean via the lightness half too, once shade is held fixed', () => {
    const w2 = evaluateW2(meanSwatch)
    const lightness = w2.measures.find((m) => m.key === 'lightnessIqr')
    expect(lightness?.pass).toBe(false)
    // One colour at one shade is one colour: the ring collapses to a point in L*.
    expect(lightness?.value).toBeLessThan(1)
  })

  it('measures the lightness half over a strict subset of the sampled cells', () => {
    const w2 = evaluateW2(mosaic)
    // The guard against the tolerance being widened until the subset is everything, which would
    // silently restore the measure that could not fail.
    expect(w2.isoShadeSampled).toBeGreaterThan(0)
    expect(w2.isoShadeSampled).toBeLessThan(w2.sampled)
    expect(w2.measures.find((m) => m.key === 'lightnessIqr')?.pass).toBe(true)
  })

  /**
   * The negative control for the subset itself: a flat unshaded wash is one iso-shade ring holding
   * every cell, so if the subsetting were inert this frame would be indistinguishable from the
   * un-subsetted measure. Both halves must still go red.
   */
  it('goes RED on a flat unshaded wash — the degenerate single-ring frame', () => {
    const flat = modelWorld({
      classAt: classByLatitude,
      swatchOf: () => MEAN_SWATCH,
      shaded: false,
    })
    const w2 = evaluateW2(flat)
    expect(w2.isoShadeSampled).toBe(w2.sampled)
    expect(w2.measures.find((m) => m.key === 'lightnessIqr')?.pass).toBe(false)
    expect(w2.measures.find((m) => m.key === 'medianNeighbourDeltaE')?.pass).toBe(false)
  })

  it('drops cells below the 6 px floor', () => {
    const w2 = evaluateW2(mosaic)
    expect(w2.sampled).toBeLessThan(mosaic.length)
    expect(w2.sampled).toBeGreaterThan(0)
  })
})

/**
 * **The one-card world — six of them on the v3 roster (DEC-751).**
 *
 * ergamon, muraganda, pyrulea, regatha, segovia and shandalar hold exactly one card each, and 15
 * worlds hold ≤ 4. `minWorld` across tracked datasets was {41, 30, 6}; production now contributes
 * **1**, a case no tracked dataset has ever rendered.
 *
 * W2 and W3 are not merely noisy there, they are **undefined**: "nearest on-screen neighbour" has
 * no referent with one cell, an interquartile range of a single sample is 0, and one populated band
 * yields zero adjacent pairs. Scored as ordinary failures — which is what a floor comparison does
 * to a `null` — those six worlds take the matrix's expected-GREEN row down against a renderer doing
 * exactly what §3.1 asks. That is W5's stale-30 failure one criterion over.
 */
describe('worlds below the criteria’s domain', () => {
  const oneCell: CellSample[] = [
    { x: 960, y: 540, height: 420, frontFacing: true, band: 6, rgb: [120, 90, 60], shade: 0.9 },
  ]
  const oneBandShares = BAND_ORDER.map((_, i) => (i === 6 ? 1 : 0))

  it('reports W2 as insufficient on a one-card world, not as a failure', () => {
    const w2 = evaluateW2(oneCell)
    expect(w2.status).toBe('insufficient')
    expect(w2.measures.every((m) => m.status === 'insufficient')).toBe(true)
    // The distinction that matters: not passing, but not red either.
    expect(w2.pass).toBe(false)
    expect(w2.measures[0]?.insufficientReason).toContain('below W2')
  })

  it('reports W3 as insufficient when no adjacent band pair qualifies', () => {
    const w3 = evaluateW3(oneCell, oneBandShares)
    expect(w3.status).toBe('insufficient')
    expect(w3.pairs).toHaveLength(0)
  })

  it('still measures W1 on a one-card world — that criterion is defined at n = 1', () => {
    const w1 = evaluateW1([
      { slug: 'dominaria', cells: Array.from({ length: 40 }, () => ({ height: 26, frontFacing: true })) },
      { slug: 'segovia', cells: [{ height: 420, frontFacing: true }] },
    ])
    expect(w1.status).toBe('pass')
    // A one-cell world's cell is enormous, so it is never the worst plane — W1 needs no exemption.
    expect(w1.worstPlane).toBe('dominaria')
  })

  /**
   * The regression this whole section exists to prevent: the expected-GREEN row of the matrix must
   * survive a roster that contains degenerate worlds.
   */
  it('keeps the unmodified-build row GREEN across a roster holding six one-card worlds', () => {
    const healthy = modelWorld({ classAt: classByLatitude, swatchOf: productionSwatch })
    const rows = [
      ...['ergamon', 'muraganda', 'pyrulea', 'regatha', 'segovia', 'shandalar'].map(() => oneCell),
      healthy,
    ]
    const verdicts = rows.map((cells) => evaluateW2(cells).status)
    expect(verdicts.filter((v) => v === 'insufficient')).toHaveLength(6)
    expect(verdicts.filter((v) => v === 'pass')).toHaveLength(1)
    // Nothing went red, so nothing fails the run.
    expect(verdicts).not.toContain('fail')
  })

  it('asserts the n/a as a matrix row, so the precondition cannot be widened unnoticed', () => {
    const criteria = [evaluateW2(oneCell), evaluateW3(oneCell, oneBandShares)]
    for (const row of [
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'N/A' as const },
      { criterion: 'W2', measure: 'lightnessIqr', expect: 'N/A' as const },
      { criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'N/A' as const },
    ]) {
      expect(checkControlRow(criteria, row).ok).toBe(true)
    }
    // And N/A is not GREEN: "not measured" may never be recorded as "measured and fine".
    expect(
      checkControlRow(criteria, { criterion: 'W2', measure: 'lightnessIqr', expect: 'GREEN' }).ok,
    ).toBe(false)
  })
})

describe('W3 — latitude reads as colour', () => {
  const banded = modelWorld({ classAt: classByLatitude, swatchOf: productionSwatch })

  /**
   * `?bands=shuffle`: band assignment permuted, grid unchanged.
   *
   * The grid — and so each cell's reported band — is untouched. What moves is which *card* sits in
   * the cell: the permutation scatters the classes across latitudes, so every band ends up holding
   * a mix of all seven and their mean a\*b\* converge on the plane's mean.
   */
  const shuffled = modelWorld({
    classAt: (_v, i) => BAND_ORDER[(i * 7 + 3) % BAND_ORDER.length] as string,
    swatchOf: productionSwatch,
  })

  it('passes when each band holds one class', () => {
    const w3 = evaluateW3(banded, BAND_SHARES)
    expect(w3.pass).toBe(true)
    expect(w3.pairs.length).toBe(BAND_ORDER.length - 1)
  })

  it('goes RED on its control — ?bands=shuffle', () => {
    const w3 = evaluateW3(shuffled, BAND_SHARES)
    expect(w3.pass).toBe(false)
    expect(w3.measures[0]?.value).toBeLessThan(FLOORS.bandDeltaE)
  })

  it('skips a pair whose smaller band is under the 5% share', () => {
    const shares = [...BAND_SHARES]
    shares[0] = W3_MIN_BAND_SHARE / 2
    const w3 = evaluateW3(banded, shares)
    expect(w3.pairs.some((p) => p.bands.includes(0))).toBe(false)
    expect(w3.pairs.length).toBe(BAND_ORDER.length - 2)
  })

  it('does not treat the two ice caps as adjacent', () => {
    // North and south colourless sit at opposite poles with the whole mosaic between them. An
    // adjacency built from the class list rather than the band chain would compare them.
    const w3 = evaluateW3(banded, BAND_SHARES)
    const caps = [0, BAND_ORDER.length - 1]
    expect(w3.pairs.some((p) => p.bands[0] === caps[0] && p.bands[1] === caps[1])).toBe(false)
  })

  it('is blind to a pair that differs only in lightness', () => {
    // Two adjacent bands, same hue, very different brightness. W3 asks whether latitude reads as
    // *colour*; the lambert shade already supplies lightness for free, so this must fail.
    const grey: CellSample[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 0,
        height: 20,
        frontFacing: true,
        band: 5,
        rgb: [50, 50, 50] as Rgb,
        shade: 0.9,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 40,
        height: 20,
        frontFacing: true,
        band: 6,
        rgb: [210, 210, 210] as Rgb,
        shade: 0.9,
      })),
    ]
    const shares = BAND_ORDER.map(() => 0)
    shares[5] = 0.5
    shares[6] = 0.5
    const w3 = evaluateW3(grey, shares)
    expect(w3.pass).toBe(false)
  })
})

describe('W4 — art resolves without exhausting', () => {
  const cells = (wanted: number, drawn: number) =>
    Array.from({ length: wanted }, (_, i) => ({
      frontFacing: true,
      onScreen: true,
      wantsArt: true,
      showingArt: i < drawn,
    }))

  /** A settled pool: the counter has stopped moving. */
  const settled = (at: number) => [
    { t: 0, evictions: at },
    { t: 2.5, evictions: at },
    { t: 5, evictions: at },
  ]

  it('goes RED on its control — ?artThreshold=fixed24 — reproducing tether-surface', () => {
    const { drawn, wanted, evicted } = PROTOTYPE.tetherSurface
    // The pool is exhausted and churning: the prototype reached this pose "with no sign of
    // settling", so the counter is still climbing across the measurement window.
    const churning = [
      { t: 0, evictions: evicted - 240 },
      { t: 2.5, evictions: evicted - 120 },
      { t: 5, evictions: evicted },
    ]
    const w4 = evaluateW4(cells(wanted, drawn), churning)

    expect(w4.pass).toBe(false)
    const fraction = w4.measures.find((m) => m.key === 'artFraction')
    expect(fraction?.pass).toBe(false)
    // 1,024 of 2,759 is 37%, against a 90% floor.
    expect(fraction?.value).toBeCloseTo(0.371, 3)
    expect(w4.measures.find((m) => m.key === 'evictionsPerSecond')?.pass).toBe(false)
  })

  /**
   * Appendix A's 925 is a *cumulative* counter, not a rate.
   *
   * §3.1 reads both halves of W4 as red at `tether-surface`, and the art half certainly is — 37%
   * against 90%, from the drawn/wanted column directly. The eviction half is an inference from "no
   * sign of settling", and an inference is not a measurement: the same 925 cumulative evictions
   * spread over a settled window is 0/s and passes. The gate must take the rate over §3.1's own
   * 2 s window rather than reading the counter, which is what `evictionRate` is for.
   */
  it('reads 925 cumulative evictions as passing once the pool has settled', () => {
    const { drawn, wanted, evicted } = PROTOTYPE.tetherSurface
    const w4 = evaluateW4(cells(wanted, drawn), settled(evicted))
    expect(w4.measures.find((m) => m.key === 'evictionsPerSecond')?.value).toBe(0)
    // The art half still fails, so the row is red either way — but for one reason, not two.
    expect(w4.pass).toBe(false)
  })

  it('stays GREEN on ?layers=128 — tier 4, where the quantile raises the threshold to match', () => {
    // §1.6 defines demand relative to pool capacity, so a 128-layer pool does not starve: the
    // effective threshold rises until ~128 cells want art and ~128 resolve. Condemning this row
    // would be condemning the low-end device the ladder exists to protect.
    const w4 = evaluateW4(cells(128, 128), settled(4_100))
    expect(w4.pass).toBe(true)
    expect(w4.measures.find((m) => m.key === 'artFraction')?.value).toBe(1)
  })

  it('passes the unexhausted prototype pose, dominaria-frame at 333/333', () => {
    const { drawn, wanted, evicted } = PROTOTYPE.dominariaFrame
    const w4 = evaluateW4(cells(wanted, drawn), settled(evicted))
    expect(w4.pass).toBe(true)
  })

  it('averages the eviction rate over the trailing 2 s, not the whole run', () => {
    // A burst while the camera flew, then quiet. The criterion is about the settled pose.
    const timeline = [
      { t: 0, evictions: 0 },
      { t: 1, evictions: 900 },
      { t: 3, evictions: 910 },
      { t: 5, evictions: 912 },
    ]
    expect(evictionRate(timeline)).toBeCloseTo(1, 6)
  })
})

describe('W5 — the home view is not a wall of labels', () => {
  const ceiling = homeLabelCeiling(ROSTER_V3)

  /** 45 world slugs, standing in for the v3 roster's `worldsWithCards`. */
  const WORLDS = Array.from({ length: ROSTER_V3.worlds }, (_, i) => `world-${i + 1}`)

  /** Every world labelled, which is what the ceiling half alone can never confirm. */
  const allCovered = (coverageFloor = 0.9) => ({
    worldsWithCards: WORLDS,
    labelledWorlds: WORLDS,
    coverageFloor,
  })

  /**
   * DEC-751's measurement of the shipped solver under §1.3's radius law: 39 of 45 worlds labelled,
   * the six losses being collision losses at mid card counts (`bloomburrow` 299, `capenna` 352,
   * `thunder-junction` 326) rather than the small worlds anyone would predict.
   */
  const dec751 = (coverageFloor = 0.9) => ({
    worldsWithCards: WORLDS,
    labelledWorlds: WORLDS.slice(0, 39),
    coverageFloor,
  })

  const measureOf = (c: Criterion, key: string): Measure =>
    c.measures.find((m) => m.key === key)!

  it('derives its ceiling from the roster rather than carrying a number', () => {
    // §3.1 published "≤ 30 (29 worlds plus the belt)". DEC-745 / PR #46 took the v3 dataset to 45
    // worlds and 1 belt, so the same derivation gives 46. Held at 30, W5 would be unsatisfiable by
    // construction on the dataset §3.2 requires it to accept.
    expect(ceiling).toBe(46)
    expect(homeLabelCeiling({ worlds: 29, belts: 1 })).toBe(30)
  })

  it('passes at one label per world plus the belt', () => {
    expect(evaluateW5(ceiling, ROSTER_V3, allCovered()).pass).toBe(true)
  })

  it('goes RED on its control — labels forced on for the empty planes', () => {
    // Every plane labelled: 45 worlds, the belt, and the 42 that become unlabelled moons (§1.8).
    expect(evaluateW5(ROSTER_V3.planes, ROSTER_V3, allCovered()).pass).toBe(false)
  })

  it("goes RED on today's galaxy, which renders 87 on this dataset", () => {
    expect(evaluateW5(87, ROSTER_V3, allCovered()).pass).toBe(false)
  })

  it('would have gone RED on a passing frame under the stale ceiling', () => {
    // The regression the derivation removes: 46 labels is the correct answer and the old bare 30
    // rejects it.
    expect(evaluateW5(46, { worlds: 29, belts: 1 }, allCovered()).pass).toBe(false)
    expect(evaluateW5(46, ROSTER_V3, allCovered()).pass).toBe(true)
  })

  // ----------------------------------------------------------------------------------------------
  // The coverage half (DEC-751)
  // ----------------------------------------------------------------------------------------------

  it('cannot tell a good frame from a lossy one on the ceiling alone', () => {
    // The defect's shape: a ceiling is satisfied by rendering *fewer* labels and does not care
    // which. DEC-751's 39 is further under the ceiling than the correct 45, so the ceiling half
    // reads GREEN *more* comfortably on the worse frame. Without a coverage half, W5 rewards the
    // loss.
    const lossy = evaluateW5(39, ROSTER_V3, dec751())
    const good = evaluateW5(45, ROSTER_V3, allCovered())
    expect(measureOf(lossy, 'homeLabels').status).toBe('pass')
    expect(measureOf(good, 'homeLabels').status).toBe('pass')
    // ...and only the coverage half separates them.
    expect(measureOf(lossy, 'worldLabelCoverage').status).toBe('fail')
    expect(measureOf(good, 'worldLabelCoverage').status).toBe('pass')
  })

  it("names the worlds that lost their label, rather than only counting them", () => {
    const c = evaluateW5(39, ROSTER_V3, dec751())
    expect(c.missingWorlds).toEqual(WORLDS.slice(39))
    expect(c.coveredWorlds).toBe(39)
    expect(c.wantedWorlds).toBe(45)
  })

  it("holds DEC-751's own arithmetic: 39/45 is under the 0.9 they proposed", () => {
    // Pinned because it is the open ruling, not a passing detail. 39/45 = 0.8667, so adopting 0.9
    // as suggested scores the *compliant* renderer RED and takes the matrix's expected-GREEN row
    // with it. Either the floor drops or R3 fixes placement first — the CEO's call, and this test
    // fails loudly if the floor is quietly set to 0.9 while the renderer still lands at 39.
    expect(39 / 45).toBeCloseTo(0.8667, 4)
    expect(evaluateW5(39, ROSTER_V3, dec751(0.9)).pass).toBe(false)
    // The same frame clears a floor set where the shipped solver actually lands.
    expect(evaluateW5(39, ROSTER_V3, dec751(0.86)).pass).toBe(true)
  })

  it('does not let labelled moons buy coverage of a world', () => {
    // Coverage is the intersection with `worldsWithCards`. A renderer that labels 45 things, six of
    // them moons, has not covered 45 worlds.
    const c = evaluateW5(45, ROSTER_V3, {
      worldsWithCards: WORLDS,
      labelledWorlds: [...WORLDS.slice(0, 39), 'moon-a', 'moon-b', 'moon-c', 'moon-d', 'moon-e', 'moon-f'],
      coverageFloor: 0.9,
    })
    expect(measureOf(c, 'worldLabelCoverage').value).toBeCloseTo(39 / 45, 6)
    expect(c.missingWorlds).toHaveLength(6)
  })

  it('takes its floor from the caller, with no default to inherit', () => {
    // The floor is a product ruling about how many worlds may be unreachable at home. The same
    // frame passes or fails on it, so it cannot live in this module as a guess.
    expect(evaluateW5(39, ROSTER_V3, dec751(0.85)).pass).toBe(true)
    expect(evaluateW5(39, ROSTER_V3, dec751(0.95)).pass).toBe(false)
  })
})

describe('the W5 visibility predicate', () => {
  it('reads opacity, because the node count is a constant', () => {
    // `labels/layout.ts` places every candidate and signals the drop with opacity alone, so
    // `querySelectorAll('.label').length` is 87 on v3 for *every* renderer — a criterion that cannot
    // vary with its subject. A faded-out label is not on screen.
    expect(isLabelVisible({ opacity: 0 })).toBe(false)
    expect(isLabelVisible({ opacity: 1 })).toBe(true)
  })

  it('counts a label dimmed by occlusion, which is visible and readable', () => {
    // PRD 5.3.11 dims a plane behind a nearer plane to 40%. Thresholding anywhere at or above 0.4
    // would silently drop those from W5 and flatter the ceiling half.
    expect(LABEL_VISIBLE_MIN_OPACITY).toBeLessThan(0.4)
    expect(isLabelVisible({ opacity: 0.4 })).toBe(true)
  })

  it('sits above zero rather than at it', () => {
    expect(LABEL_VISIBLE_MIN_OPACITY).toBeGreaterThan(0)
    expect(isLabelVisible({ opacity: LABEL_VISIBLE_MIN_OPACITY })).toBe(false)
  })
})

describe('the negative-control matrix', () => {
  /**
   * §3.1's matrix, as `checkControlRow` consumes it.
   *
   * Each row names the *measure* it targets, not just the criterion, so a row cannot be scored
   * green by a half it never touches. W2 and W4 are conjunctions and each contributes two rows —
   * one per half — which is what makes a half with no control of its own visible as a gap rather
   * than borrowed from its partner.
   *
   * W2's lightness half has its own row against the same `?swatch=mean` seam only because DEC-749
   * moved the measure onto the iso-shade subset. Before that it was un-failable, and this matrix
   * carried a sixth gate-side row (a flat unshaded wash) to cover for it.
   */
  const MATRIX = [
    { row: 'W1 · capture at 6× radius', criterion: 'W1', measure: 'minMedianCellHeightPx', expect: 'RED' },
    { row: 'W2 · ?swatch=mean', criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'RED' },
    { row: 'W2 · ?swatch=mean (iso-shade half)', criterion: 'W2', measure: 'lightnessIqr', expect: 'RED' },
    { row: 'W3 · ?bands=shuffle', criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'RED' },
    { row: 'W4 · ?artThreshold=fixed24', criterion: 'W4', measure: 'artFraction', expect: 'RED' },
    { row: 'W4 · ?artThreshold=fixed24 (evictions)', criterion: 'W4', measure: 'evictionsPerSecond', expect: 'RED' },
    { row: 'W5 · labels forced on for empty planes', criterion: 'W5', measure: 'homeLabels', expect: 'RED' },
    { row: 'W1 · one-card world', criterion: 'W1', measure: 'minMedianCellHeightPx', expect: 'GREEN' },
    { row: 'W2 · one-card world', criterion: 'W2', measure: 'lightnessIqr', expect: 'N/A' },
    { row: 'W3 · one-card world', criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'N/A' },
    { row: 'W4 · ?layers=128 (tier 4)', criterion: 'W4', expect: 'GREEN' },
    { row: 'all · the unmodified build', criterion: 'W2', expect: 'GREEN' },
  ] as const

  it('has seven expected-RED rows, three expected-GREEN and two expected-N/A', () => {
    expect(MATRIX.filter((r) => r.expect === 'RED')).toHaveLength(7)
    expect(MATRIX.filter((r) => r.expect === 'GREEN')).toHaveLength(3)
    expect(MATRIX.filter((r) => r.expect === 'N/A')).toHaveLength(2)
  })

  it('names only measures the criteria actually emit', () => {
    // A key no criterion returns is reported as a failing row with a confusing detail rather than
    // as a silent pass — safe, but only once. §3.1 shipped two such keys (`medianCellHeightPx`,
    // `worstBandPairDeltaE`); this pins the seven real ones.
    const EMITTED = new Set([
      'minMedianCellHeightPx',
      'medianNeighbourDeltaE',
      'lightnessIqr',
      'minAdjacentBandDeltaE',
      'artFraction',
      'evictionsPerSecond',
      'homeLabels',
      'worldLabelCoverage',
    ])
    for (const row of MATRIX) {
      if ('measure' in row) expect(EMITTED.has(row.measure)).toBe(true)
    }
  })

  it("records that W5's coverage half has no control row of its own", () => {
    // Not a passing detail — a declared gap. Every other conjunction in the matrix contributes one
    // row per half (W2, W4) precisely so a half cannot be scored green by its partner. W5's
    // coverage half, added on DEC-751's measurement, has no seam that moves it: the one W5 control
    // (`labels forced on for empty planes`) leaves world coverage at 39 either way — it adds moon
    // labels, it does not take world labels away — so it tests the ceiling and nothing else.
    //
    // This fails the moment a coverage row is added, which is the point: the gap closes by deleting
    // this test, not by forgetting it. Routed to the CEO with the floor ruling.
    const targeted: readonly string[] = MATRIX.flatMap((r) => ('measure' in r ? [r.measure] : []))
    expect(targeted).not.toContain('worldLabelCoverage')
    expect(targeted.filter((k) => k === 'homeLabels')).toHaveLength(1)
  })

  /** Full world coverage, so these rows turn on the ceiling half alone. */
  const COVERED = {
    worldsWithCards: Array.from({ length: ROSTER_V3.worlds }, (_, i) => `world-${i + 1}`),
    labelledWorlds: Array.from({ length: ROSTER_V3.worlds }, (_, i) => `world-${i + 1}`),
    coverageFloor: 0.9,
  }

  it('scores a row against the measure it names', () => {
    const red = [evaluateW5(87, ROSTER_V3, COVERED)]
    expect(checkControlRow(red, { criterion: 'W5', measure: 'homeLabels', expect: 'RED' }).ok).toBe(true)
    expect(checkControlRow(red, { criterion: 'W5', measure: 'homeLabels', expect: 'GREEN' }).ok).toBe(false)

    const green = [evaluateW5(homeLabelCeiling(ROSTER_V3), ROSTER_V3, COVERED)]
    expect(checkControlRow(green, { criterion: 'W5', measure: 'homeLabels', expect: 'GREEN' }).ok).toBe(true)
  })

  it("scores W5's halves apart, so the ceiling cannot carry the coverage row", () => {
    // The conjunction guard, at the level the matrix consumes it. DEC-751's frame passes the
    // ceiling and fails coverage; a row asserted at criterion level would read the whole of W5 as
    // RED and never say which half, which is how `?swatch=mean` came to look like a working control
    // for both halves of W2.
    const lossy = [
      evaluateW5(39, ROSTER_V3, { ...COVERED, labelledWorlds: COVERED.labelledWorlds.slice(0, 39) }),
    ]
    expect(checkControlRow(lossy, { criterion: 'W5', measure: 'homeLabels', expect: 'GREEN' }).ok).toBe(true)
    expect(checkControlRow(lossy, { criterion: 'W5', measure: 'worldLabelCoverage', expect: 'RED' }).ok).toBe(true)
    expect(checkControlRow(lossy, { criterion: 'W5', expect: 'GREEN' }).ok).toBe(false)
  })

  it('fails loudly rather than passing when a criterion or measure is missing', () => {
    // A control row that silently matched nothing would be the `verify-browser --dataset all`
    // failure again: a matrix printing seven greens while running none of them.
    const absent = checkControlRow([evaluateW5(46, ROSTER_V3, COVERED)], { criterion: 'W4', expect: 'GREEN' })
    expect(absent.ok).toBe(false)
    expect(absent.detail).toContain('was not run')

    const mistyped = checkControlRow([evaluateW5(46, ROSTER_V3, COVERED)], {
      criterion: 'W5',
      measure: 'labelCount',
      expect: 'GREEN',
    })
    expect(mistyped.ok).toBe(false)
    expect(mistyped.detail).toContain('no measure')
  })
})
