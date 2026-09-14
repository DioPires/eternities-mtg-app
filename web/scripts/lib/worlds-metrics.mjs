/**
 * The measurement core of `worlds-gate.mjs` — spec §3.1's criteria W1–W5 as pure functions.
 *
 * Everything here takes probe geometry plus colours already sampled out of the captured PNG and
 * returns numbers. Nothing here launches a browser, and nothing here knows what a seam is. That
 * split is deliberate and it is what lets the criteria be tested against the prototype's *measured*
 * numbers (Appendix A) rather than against a live renderer: the negative-control matrix of §3.1 can
 * be proven to go red on the frames it exists to forbid before the renderer that produces those
 * frames exists at all.
 *
 * ## Two decisions this module makes that §3.1 leaves open
 *
 * **1. ΔE is CIE76 — plain Euclidean distance in CIELAB.** §3.1 says "convert to CIELAB … the ΔE"
 * without naming a formula. W3 settles it: it asks for "the ΔE between their mean a\*b\*", a
 * distance in the chroma plane alone, and CIEDE2000 is not defined on a\*b\* without L\*. So the
 * only formula that can serve both criteria is the Euclidean one, and using CIEDE2000 for W2 while
 * W3 necessarily used CIE76 would put two different meanings behind one symbol in one table.
 *
 * **2. Every criterion reports each of its halves separately.** W2 and W4 are conjunctions, and a
 * conjunction hides which half is load-bearing. That is not a stylistic preference — it is forced
 * by the matrix. Under `?swatch=mean` every cell takes the plane's mean swatch, so neighbouring
 * cells differ only by `shade`, and adjacent cells have near-identical normals: the neighbour-ΔE
 * half collapses to ≈ 0 and goes solidly red. But `shade` runs 0.34 → 1.05 from limb to sub-camera
 * point (§1.4), a ~3× luminance range across the disc, so **IQR(L\*) stays wide and that half of W2
 * passes on its own negative control**. The row is still red, because the conjunction is, and a
 * gate reporting only the row would report the truth while measuring nothing on that half. The
 * matrix asserts per measure for this reason.
 */

// ------------------------------------------------------------------------------------------------
// Floors — spec §3.1's table, in one place so the gate and its tests cannot drift apart
// ------------------------------------------------------------------------------------------------

export const FLOORS = {
  /** W1: median on-screen height of front-facing cells, CSS px. Binds on Dominaria, 25.3 px. */
  cellHeightPx: 24,
  /** W2: median ΔE from a cell to its nearest on-screen neighbour. */
  neighbourDeltaE: 6,
  /** W2: interquartile range of L\* across the sampled cells. */
  lightnessIqr: 8,
  /** W3: ΔE between the mean a\*b\* of two bands adjacent on the sphere. */
  bandDeltaE: 10,
  /** W4: fraction of cells above the effective threshold that are showing art. */
  artFraction: 0.9,
  /** W4: evictions per second, averaged over the last 2 s. A ceiling, not a floor. */
  evictionsPerSecond: 5,
  /** W5: rendered plane labels in the DOM at the home view. A ceiling. 29 worlds plus the belt. */
  homeLabels: 30,
}

/** W2 only samples cells this tall or taller (§3.1). */
export const W2_MIN_CELL_PX = 6

/** W3 only compares a band pair when the smaller band holds at least this share of the plane. */
export const W3_MIN_BAND_SHARE = 0.05

/** W4's eviction rate is averaged over this window, in seconds (§3.1). */
export const W4_EVICTION_WINDOW_S = 2

/**
 * The 13 bands north to south, from §1.3's `C G R B U W · Gold · W U B R G C`.
 *
 * Thirteen geometric bands over seven colour classes: colourless is split between the two ice caps,
 * each mono colour is a matched pair, gold is the single equatorial belt. `G` in that string is
 * green — gold is spelled out — and getting those two the wrong way round silently mirrors the
 * whole southern hemisphere.
 *
 * Adjacency for W3 is adjacency *in this list*: the pole-to-pole chain. The two colourless caps are
 * not adjacent to each other, and neither are the two white bands; they sit at opposite ends of the
 * sphere with the entire mosaic between them.
 */
export const BAND_ORDER = Object.freeze([
  'colourless',
  'green',
  'red',
  'black',
  'blue',
  'white',
  'gold',
  'white',
  'blue',
  'black',
  'red',
  'green',
  'colourless',
])

/** The index pairs W3 walks: every consecutive pair in `BAND_ORDER`. */
export const BAND_ADJACENCY = Object.freeze(
  BAND_ORDER.slice(0, -1).map((_, i) => Object.freeze([i, i + 1])),
)

// ------------------------------------------------------------------------------------------------
// Colour
// ------------------------------------------------------------------------------------------------

const D65 = { x: 0.95047, y: 1.0, z: 1.08883 }
const DELTA = 6 / 29

/** One sRGB channel, 0–255, to linear light. */
function toLinear(v) {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** CIELAB's cube-root companding, with the linear segment near black. */
function f(t) {
  return t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29
}

/**
 * sRGB `[r, g, b]`, 0–255, to CIELAB under D65.
 *
 * The capture is what the browser wrote to a PNG with no colour profile, which for a page rendered
 * in sRGB is sRGB. This is the point at which the gate stops trusting the renderer and starts
 * trusting the file.
 */
export function srgbToLab([r, g, b]) {
  const rl = toLinear(r)
  const gl = toLinear(g)
  const bl = toLinear(b)

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / D65.x
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) / D65.y
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / D65.z

  const fx = f(x)
  const fy = f(y)
  const fz = f(z)

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** CIE76 ΔE — Euclidean distance in L\*a\*b\*. W2's distance. */
export function deltaE76(p, q) {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b)
}

/**
 * Euclidean distance in the a\*b\* plane alone. W3's distance.
 *
 * Separate from `deltaE76` on purpose: §3.1 asks W3 for the distance "between their mean a\*b\*",
 * and dropping L\* is the whole point of that phrasing. Latitude has to read as *colour*, and a
 * band that differed from its neighbour only in lightness would satisfy a full ΔE while failing the
 * thing W3 is about — which is exactly what the lambert shade of §1.4 hands you for free.
 */
export function deltaEab(p, q) {
  return Math.hypot(p.a - q.a, p.b - q.b)
}

// ------------------------------------------------------------------------------------------------
// Statistics
// ------------------------------------------------------------------------------------------------

/** The median. Returns `null` for an empty sample rather than `NaN`, so callers must decide. */
export function median(xs) {
  if (xs.length === 0) return null
  const s = [...xs].sort((p, q) => p - q)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * The linear-interpolation quantile (the "type 7" definition, which is what NumPy and R default to).
 *
 * Named rather than inlined because W2's IQR is a floor a control has to be able to cross, and a
 * nearest-rank quantile and an interpolated one disagree by enough on small samples to move a
 * verdict.
 */
export function quantile(xs, q) {
  if (xs.length === 0) return null
  const s = [...xs].sort((p, r) => p - r)
  if (s.length === 1) return s[0]
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** The interquartile range, Q3 − Q1. */
export function iqr(xs) {
  if (xs.length === 0) return null
  return quantile(xs, 0.75) - quantile(xs, 0.25)
}

// ------------------------------------------------------------------------------------------------
// The criteria
// ------------------------------------------------------------------------------------------------

/**
 * One measured quantity with its floor and its verdict.
 *
 * `direction` is `'min'` when the floor is a lower bound and `'max'` when it is a ceiling. Spelling
 * it out beats inferring from the name: W4 carries one of each.
 */
function measure(key, label, value, bound, direction) {
  const pass = value === null ? false : direction === 'min' ? value >= bound : value <= bound
  return { key, label, value, bound, direction, pass }
}

/** A criterion passes when every one of its measures does. */
function criterion(id, title, measures, extra = {}) {
  return { id, title, measures, pass: measures.every((m) => m.pass), ...extra }
}

/**
 * **W1 — cells are resolvable at framing distance.**
 *
 * `planes` is one entry per world: `{ slug, cells: [{ height, frontFacing }] }`, measured at that
 * plane's own plane-level settle.
 *
 * The verdict is taken on the *worst* plane, not on the pooled median: "cells are resolvable" is a
 * claim about every world, and pooling lets 28 comfortable worlds carry one that is not. The Blind
 * Eternities is not a world and must not be in `planes` — it has cards but no cell sheet (§1.8), so
 * the statistic is undefined there and "every plane with cards" would wrongly make this 30.
 */
export function evaluateW1(planes) {
  const perPlane = planes.map(({ slug, cells }) => ({
    slug,
    medianHeightPx: median(cells.filter((c) => c.frontFacing).map((c) => c.height)),
  }))

  const worst = perPlane.reduce(
    (acc, p) => (acc === null || p.medianHeightPx === null || p.medianHeightPx < acc.medianHeightPx ? p : acc),
    null,
  )

  return criterion(
    'W1',
    'Cells are resolvable at framing distance',
    [
      measure(
        'minMedianCellHeightPx',
        `median front-facing cell height, worst of ${planes.length} worlds`,
        worst === null ? null : worst.medianHeightPx,
        FLOORS.cellHeightPx,
        'min',
      ),
    ],
    { perPlane, worstPlane: worst === null ? null : worst.slug },
  )
}

/**
 * **W2 — the mosaic reads as tiles, not as a wash.** T7's replacement.
 *
 * `samples` is `{ x, y, height, frontFacing, rgb }` per cell, `rgb` sampled from the capture at the
 * cell's centre. Cells shorter than 6 px are dropped: below that the centre pixel is as much grout
 * and neighbour as it is cell.
 *
 * "Nearest on-screen neighbour" is nearest by screen-space centre distance among the sampled set —
 * so a cell whose neighbours all fell under the height cut is compared against the nearest cell
 * that survived, which is the honest reading of a statistic about what is visible.
 */
export function evaluateW2(samples) {
  const kept = samples.filter((s) => s.frontFacing && s.height >= W2_MIN_CELL_PX)
  const labs = kept.map((s) => srgbToLab(s.rgb))

  const neighbourDeltas = []
  for (let i = 0; i < kept.length; i += 1) {
    let best = Infinity
    let bestAt = -1
    for (let j = 0; j < kept.length; j += 1) {
      if (i === j) continue
      const d = (kept[i].x - kept[j].x) ** 2 + (kept[i].y - kept[j].y) ** 2
      if (d < best) {
        best = d
        bestAt = j
      }
    }
    if (bestAt >= 0) neighbourDeltas.push(deltaE76(labs[i], labs[bestAt]))
  }

  return criterion(
    'W2',
    'The mosaic reads as tiles, not as a wash',
    [
      measure(
        'medianNeighbourDeltaE',
        'median ΔE to nearest on-screen neighbour',
        median(neighbourDeltas),
        FLOORS.neighbourDeltaE,
        'min',
      ),
      measure('lightnessIqr', 'IQR of L*', iqr(labs.map((l) => l.L)), FLOORS.lightnessIqr, 'min'),
    ],
    { sampled: kept.length },
  )
}

/**
 * **W3 — latitude reads as colour.**
 *
 * `samples` carries a `band` index into `BAND_ORDER`; `bandShares` is the plane's card share per
 * band index, and gates which pairs are compared — a band holding under 5% is too thin a stripe to
 * hold the criterion to.
 *
 * The verdict is the *worst* qualifying adjacent pair, because §3.1 says "for every such pair".
 */
export function evaluateW3(samples, bandShares) {
  const byBand = new Map()
  for (const s of samples) {
    if (!s.frontFacing) continue
    if (!byBand.has(s.band)) byBand.set(s.band, [])
    byBand.get(s.band).push(srgbToLab(s.rgb))
  }

  const meanAb = new Map()
  for (const [band, labs] of byBand) {
    meanAb.set(band, {
      a: labs.reduce((t, l) => t + l.a, 0) / labs.length,
      b: labs.reduce((t, l) => t + l.b, 0) / labs.length,
    })
  }

  const pairs = []
  for (const [i, j] of BAND_ADJACENCY) {
    if (!meanAb.has(i) || !meanAb.has(j)) continue
    const smaller = Math.min(bandShares[i] ?? 0, bandShares[j] ?? 0)
    if (smaller < W3_MIN_BAND_SHARE) continue
    pairs.push({
      bands: [i, j],
      classes: [BAND_ORDER[i], BAND_ORDER[j]],
      smallerShare: smaller,
      deltaE: deltaEab(meanAb.get(i), meanAb.get(j)),
    })
  }

  const worst = pairs.reduce((acc, p) => (acc === null || p.deltaE < acc.deltaE ? p : acc), null)

  return criterion(
    'W3',
    'Latitude reads as colour',
    [
      measure(
        'minAdjacentBandDeltaE',
        `ΔE(a*b*) of the closest of ${pairs.length} qualifying adjacent band pairs`,
        worst === null ? null : worst.deltaE,
        FLOORS.bandDeltaE,
        'min',
      ),
    ],
    { pairs, worstPair: worst },
  )
}

/**
 * Evictions per second over the trailing window, from a timeline of the pool's cumulative counter.
 *
 * Separated out and named because the number Appendix A reports is **cumulative to the pose**, not
 * a rate: `tether-surface`'s 925 is every eviction since the camera started moving. §3.1 infers the
 * rate from "no sign of settling", which is an inference and not a measurement. W4's eviction half
 * is only red when a rate measured over this window says so, and the gate measures it here.
 *
 * `samples` is `[{ t, evictions }]`, `t` in seconds, cumulative counter, ascending.
 */
export function evictionRate(samples, windowS = W4_EVICTION_WINDOW_S) {
  if (samples.length < 2) return null
  const end = samples[samples.length - 1]
  const cutoff = end.t - windowS
  // The last sample at or before the cutoff, so the window is fully covered rather than clipped.
  let start = samples[0]
  for (const s of samples) {
    if (s.t <= cutoff) start = s
    else break
  }
  const span = end.t - start.t
  if (span <= 0) return null
  return (end.evictions - start.evictions) / span
}

/**
 * **W4 — art resolves without exhausting.** At the surface view, 2.2× radius, after a 5 s settle.
 *
 * `cells` is `{ frontFacing, onScreen, wantsArt, showingArt }` — `wantsArt` meaning above the
 * *effective* threshold, which under the adaptive quantile of §1.6 is not 24 px. That denominator
 * is the substance of the criterion and the reason `?layers=128` is an expected-GREEN row: shrink
 * the pool and the threshold rises until demand matches capacity, so the ratio stays ≈ 1. Only
 * `?artThreshold=fixed24` starves the policy instead of the resource, and only that goes red.
 */
export function evaluateW4(cells, evictionTimeline) {
  const wanting = cells.filter((c) => c.frontFacing && c.onScreen && c.wantsArt)
  const showing = wanting.filter((c) => c.showingArt)

  return criterion(
    'W4',
    'Art resolves without exhausting',
    [
      measure(
        'artFraction',
        `cells above the effective threshold showing art (${showing.length}/${wanting.length})`,
        wanting.length === 0 ? null : showing.length / wanting.length,
        FLOORS.artFraction,
        'min',
      ),
      measure(
        'evictionsPerSecond',
        `evictions/s over the last ${W4_EVICTION_WINDOW_S} s`,
        evictionRate(evictionTimeline),
        FLOORS.evictionsPerSecond,
        'max',
      ),
    ],
    { wanting: wanting.length, showing: showing.length },
  )
}

/**
 * **W5 — the home view is not a wall of labels.**
 *
 * 29 worlds plus the belt is 30; today the galaxy renders 82. The 57 empty planes become moons and
 * stay unlabelled until hover (§1.8, PRD 5.3.8 as amended in §6).
 */
export function evaluateW5(renderedLabelCount) {
  return criterion('W5', 'The home view is not a wall of labels', [
    measure('homeLabels', 'plane labels in the DOM at the home view', renderedLabelCount, FLOORS.homeLabels, 'max'),
  ])
}

/**
 * Check a run of criteria against what the negative-control matrix expects of it.
 *
 * `expect` names the measure a control is aimed at — `{ criterion: 'W2', measure:
 * 'medianNeighbourDeltaE', expect: 'RED' }` — rather than only the row's verdict, because §3.1's
 * conjunctions can go red on one half while the other half quietly never fails. A row asserted only
 * at criterion level would have recorded `?swatch=mean` as a working control for both halves of W2.
 * See this module's header.
 *
 * `expect: 'GREEN'` on a criterion with no named measure asserts the whole criterion passed, which
 * is what the two green rows want.
 */
export function checkControlRow(criteria, { criterion: id, measure: key, expect }) {
  const found = criteria.find((c) => c.id === id)
  if (found === undefined) return { ok: false, detail: `criterion ${id} was not run` }

  const subject = key === undefined ? found : found.measures.find((m) => m.key === key)
  if (subject === undefined) return { ok: false, detail: `${id} has no measure "${key}"` }

  const wentRed = !subject.pass
  const ok = expect === 'RED' ? wentRed : !wentRed
  const what = key === undefined ? id : `${id}.${key}`
  const value = key === undefined ? '' : ` (value ${subject.value}, bound ${subject.bound})`

  return {
    ok,
    detail: ok
      ? `${what} went ${expect} as expected${value}`
      : `${what} was expected ${expect} but went ${wentRed ? 'RED' : 'GREEN'}${value}`,
  }
}
