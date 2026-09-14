/**
 * Reading `window.__eternitiesProbe.worlds()` — the boundary between R1's payload and G's criteria.
 *
 * `worlds-metrics.mjs` takes numbers and returns verdicts; it does not know where the numbers came
 * from. This module is the only place that knows the shape R1 publishes
 * (`web/src/scene/worlds/worldsProbe.ts`, `docs/worlds/gate-seam-contract.md`), and it exists so
 * that a drift in that shape stops the run *by name* instead of arriving inside a criterion as a
 * `NaN` that compares false against every floor and scores the frame RED.
 *
 * > **Normative — the gate reads this payload and re-derives none of it (DEC-744 B1, DEC-746 D5).**
 * > Nothing here recomputes a screen extent, a band index or a shade. R1's own note on that is worth
 * > repeating because it is the failure mode this file is arranged against: `cellScreenRect` takes
 * > its geometry as *parameters*, so handing it the un-inset arcs (+7.5%) or the unlifted radius
 * > (−0.6%) leaves the picture correct and moves only the measurement — and both land on W1's pixel
 * > floor. A gate with its own copy of that call has its own copy of that bug, and no test on either
 * > side can see the disagreement.
 *
 * ## Three outcomes, not two
 *
 * `readWorldsProbe` distinguishes states that a boolean would collapse, and the collapse is what
 * makes a green matrix meaningless:
 *
 * - **`absent`** — `worlds()` returned `undefined`. No world is composed. This is R1's documented
 *   contract, and it is a *setup* failure: the run took no measurement. It is emphatically not a
 *   criterion going red, because a red criterion is a claim about a picture and there is no picture.
 * - **`malformed`** — something came back, and it is not the published shape. Also a setup failure,
 *   and kept separate from `absent` because it means the two sides have drifted: the renderer is
 *   composing worlds and the gate can no longer read them.
 * - **`ok`** — every field checked, with the count of checks reported. An audit that cannot say how
 *   many checks it ran cannot distinguish "nothing was wrong" from "nothing was looked at".
 *
 * The validation is a positive check per field rather than a `try`/`catch` around a consumer. A
 * reader that catches and continues reports "no violations found" and "I could not look" with the
 * same words.
 */

import { samplePixel } from './png-sample.mjs'

/** §1.3's chain is thirteen bands over seven colour classes — `bandShares` has one entry each. */
const BANDS = 13

/** `bandShares` sums to 1 on any populated plane; the empty plane legally sums to 0. */
const SHARE_SUM_TOLERANCE = 1e-6

/**
 * The `?artThreshold=fixed24` seam's whole point: the prototype's constant, in CSS px.
 *
 * The gate asserts the *reported effective threshold* equals this under that seam. That is a
 * read-back of the policy the renderer ran, which is a different and much stronger statement than
 * the URL echo — see {@link seamEvidence}.
 */
export const FIXED24_PX = 24

class Checker {
  constructor() {
    this.checked = 0
    this.faults = []
  }

  /** Record one check. Returns the check's own result so callers can short-circuit safely. */
  check(ok, fault) {
    this.checked += 1
    if (!ok) this.faults.push(fault)
    return ok
  }

  number(value, path, { min = -Infinity, max = Infinity, integer = false } = {}) {
    const ok =
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isInteger(value))
    return this.check(ok, `${path}: expected a finite number in [${min}, ${max}], got ${show(value)}`)
  }

  boolean(value, path) {
    return this.check(typeof value === 'boolean', `${path}: expected a boolean, got ${show(value)}`)
  }
}

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `an array of ${value.length}`
  return typeof value
}

function isRect(rect, path, checker) {
  if (!checker.check(isObject(rect), `${path}: expected a rect object, got ${show(rect)}`)) return
  checker.number(rect.x, `${path}.x`)
  checker.number(rect.y, `${path}.y`)
  checker.number(rect.width, `${path}.width`, { min: 0 })
  checker.number(rect.height, `${path}.height`, { min: 0 })
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one payload and say which of the three states it is in.
 *
 * `expectedViewport` is the capture's own dimensions. It is checked rather than trusted because
 * every colour criterion samples the PNG at the probe's `(x, y)`: a payload measured at a viewport
 * the screenshot does not have puts every W2 and W3 sample on the wrong pixel, and the resulting
 * numbers are plausible rather than absurd. `null` skips the check, which the unit tests use and a
 * live run never should.
 */
export function readWorldsProbe(raw, { expectedViewport = null } = {}) {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      reason: 'absent',
      detail:
        'window.__eternitiesProbe.worlds() returned undefined — no world is composed, so the run ' +
        'took no measurement. This is a setup failure, not a criterion result.',
      checked: 0,
      faults: [],
    }
  }

  const c = new Checker()

  if (!c.check(isObject(raw), `probe: expected the payload object, got ${show(raw)}`)) {
    return malformed(c)
  }

  c.check(
    raw.planeSlug === null || typeof raw.planeSlug === 'string',
    `probe.planeSlug: expected a string or null, got ${show(raw.planeSlug)}`,
  )
  c.number(raw.radii, 'probe.radii', { min: 0 })

  if (c.check(isObject(raw.viewport), `probe.viewport: expected an object, got ${show(raw.viewport)}`)) {
    c.number(raw.viewport.width, 'probe.viewport.width', { min: 1 })
    c.number(raw.viewport.height, 'probe.viewport.height', { min: 1 })
    if (expectedViewport !== null) {
      c.check(
        raw.viewport.width === expectedViewport.width &&
          raw.viewport.height === expectedViewport.height,
        `probe.viewport: the payload was measured at ${raw.viewport.width}x${raw.viewport.height} ` +
          `but the capture is ${expectedViewport.width}x${expectedViewport.height} — every colour ` +
          'sample would land on the wrong pixel',
      )
    }
  }

  readPool(raw.pool, c)
  readSeams(raw.seams, c)
  readBandShares(raw.bandShares, c)
  readCells(raw.cells, c)

  return c.faults.length > 0 ? malformed(c) : { ok: true, probe: raw, checked: c.checked, faults: [] }
}

function malformed(c) {
  return {
    ok: false,
    reason: 'malformed',
    detail:
      `the ?probe= payload does not match the published shape: ${c.faults.length} of ${c.checked} ` +
      'checks failed. The renderer is composing worlds the gate can no longer read, which is a ' +
      'setup failure and not a criterion result.',
    checked: c.checked,
    faults: c.faults,
  }
}

function readPool(pool, c) {
  if (!c.check(isObject(pool), `probe.pool: expected an object, got ${show(pool)}`)) return
  // `layers` is the *clamped* count and 0 is legal — `capabilities.ts` reports 0 array-texture
  // layers on a lost or non-WebGL2 context, which §1.6 makes a swatch-only world rather than an
  // error. The gate measures that world; it does not refuse to run on it.
  c.number(pool.layers, 'probe.pool.layers', { min: 0, integer: true })
  c.number(pool.resident, 'probe.pool.resident', { min: 0, integer: true })
  c.number(pool.effectiveThresholdPx, 'probe.pool.effectiveThresholdPx', { min: 0 })
  c.number(pool.evictions, 'probe.pool.evictions', { min: 0, integer: true })
  // The prototype's impossible reading — 1,031 resident in a 1,024-layer pool — as a check the gate
  // makes on its own side too. `artPool` asserts it, and a payload that violates it is drifted.
  if (typeof pool.layers === 'number' && typeof pool.resident === 'number') {
    c.check(
      pool.resident <= pool.layers,
      `probe.pool: ${pool.resident} resident in a ${pool.layers}-layer pool`,
    )
  }
}

function readSeams(seams, c) {
  if (!c.check(isObject(seams), `probe.seams: expected an object, got ${show(seams)}`)) return
  c.boolean(seams.swatchMean, 'probe.seams.swatchMean')
  c.boolean(seams.bandsShuffle, 'probe.seams.bandsShuffle')
  c.boolean(seams.artThresholdFixed24, 'probe.seams.artThresholdFixed24')
  c.check(
    seams.layersRequested === null ||
      (typeof seams.layersRequested === 'number' && Number.isInteger(seams.layersRequested)),
    `probe.seams.layersRequested: expected an integer or null, got ${show(seams.layersRequested)}`,
  )
}

function readBandShares(shares, c) {
  if (!c.check(Array.isArray(shares), `probe.bandShares: expected an array, got ${show(shares)}`)) {
    return
  }
  if (!c.check(shares.length === BANDS, `probe.bandShares: expected ${BANDS} entries, got ${shares.length}`)) {
    return
  }
  let sum = 0
  for (let i = 0; i < shares.length; i += 1) {
    if (c.number(shares[i], `probe.bandShares[${i}]`, { min: 0, max: 1 })) sum += shares[i]
  }
  // Two legal sums and nothing between them. An empty plane has no cards to share out and
  // `surfaceLaw.bandShares` returns thirteen zeros for it; anything populated sums to one. A single
  // "≈ 1" check would reject the degenerate plane, and a plain "≤ 1" would accept a payload that had
  // silently dropped a band.
  c.check(
    Math.abs(sum) < SHARE_SUM_TOLERANCE || Math.abs(sum - 1) < SHARE_SUM_TOLERANCE,
    `probe.bandShares: sums to ${sum}, which is neither 0 (an empty plane) nor 1`,
  )
}

function readCells(cells, c) {
  if (!c.check(Array.isArray(cells), `probe.cells: expected an array, got ${show(cells)}`)) return

  let previous = -1
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]
    const path = `probe.cells[${i}]`
    if (!c.check(isObject(cell), `${path}: expected an object, got ${show(cell)}`)) continue

    c.number(cell.cell, `${path}.cell`, { min: 0, integer: true })
    // Ascending and therefore unique. `buildWorldsProbe` walks `0..cardCount` in order and pushes,
    // so this holds by construction — which is exactly why it is worth checking: it is the cheapest
    // statement that fails if the payload was assembled by some other path.
    c.check(
      typeof cell.cell === 'number' && cell.cell > previous,
      `${path}.cell: ${show(cell.cell)} does not follow ${previous} — cell ids must ascend`,
    )
    if (typeof cell.cell === 'number') previous = cell.cell

    isRect(cell.rect, `${path}.rect`, c)
    c.number(cell.x, `${path}.x`)
    c.number(cell.y, `${path}.y`)
    c.number(cell.height, `${path}.height`, { min: 0 })
    // R1 publishes `height === rect.height` by construction. Pinning it here is not redundancy: it
    // is the one field the contract duplicates, so it is the one field where a payload assembled
    // from two different frames would show a seam.
    if (isObject(cell.rect)) {
      c.check(
        cell.height === cell.rect.height,
        `${path}: height ${show(cell.height)} is not rect.height ${show(cell.rect.height)}`,
      )
    }
    c.number(cell.band, `${path}.band`, { min: 0, max: BANDS - 1, integer: true })
    c.number(cell.shade, `${path}.shade`)
    c.boolean(cell.frontFacing, `${path}.frontFacing`)
    c.boolean(cell.onScreen, `${path}.onScreen`)
    c.boolean(cell.wantsArt, `${path}.wantsArt`)
    c.boolean(cell.showingArt, `${path}.showingArt`)
  }
}

/**
 * How many cards the payload did not report, and why the gate cannot see that on its own.
 *
 * `buildWorldsProbe` walks `0..cardCount` and **skips** two kinds of cell: one whose subdivided grid
 * is wholly inside the near plane (`cellScreenRect` returns `null`), and one whose centre is. So
 * `cells.length` is `cardCount` at the two poses §3.1 measures at — the camera sits outside the
 * sphere at 2.2 and 3.5 radii, so nothing is within `near` of the eye — and it is **not**
 * `cardCount` in general. R1's `buildProbeCells` header says "`cells.length` is the world's
 * `cardCount` whatever `k` is", which is a claim about the *subdivision* and reads as a claim about
 * the cardinality; it is the subdivision half that holds.
 *
 * **The obvious consequence is the wrong one and it is not offered here.** A dropped cell looks like
 * it should bias W4 green by leaving its denominator — but `withinFrustum` rejects on the same
 * `z > -near` test, so a cell inside the near plane reads `onScreen: false` and was never in that
 * denominator. (Not quite by construction: the drop is decided on the row-colatitude grid point and
 * `onScreen` on the decoded normal, so a hairline band of cells straddling `-near` can disagree.)
 *
 * What a drop does move is **W1**, which filters on `frontFacing` alone and not on `onScreen`. Its
 * set loses cells the camera is nearly touching — the tallest ones there are — so the median falls.
 * That is toward RED, the safe direction for a floor.
 *
 * The reason to count drops anyway is not a bias, it is blindness: the payload carries no
 * `cardCount`, so a run measuring 480 of a world's 500 cards is indistinguishable from one measuring
 * all 500. The gate has to bring the published count from the dataset — the same number §2.4
 * publishes, so not a re-derivation — which is why this is a separate call and not an assertion
 * inside `readWorldsProbe`. Raised with R1 as a one-field payload ask; until then, pass the
 * dataset's count and refuse a frame that dropped anything.
 */
export function cellCardinality(probe, cardCount) {
  const reported = probe.cells.length
  const highest = reported === 0 ? -1 : probe.cells[reported - 1].cell
  return {
    cardCount,
    reported,
    dropped: cardCount - reported,
    /** A cell id at or past `cardCount` means the payload is not describing this world. */
    inRange: highest < cardCount,
    complete: reported === cardCount && highest < cardCount,
  }
}

/**
 * Pair each cell with the colour the capture actually shows at its centre.
 *
 * **Sampled at `(x, y)`, the projected cell centre — never at the centre of `rect`.** R1 measured
 * the two a mean 1.3–10.3% of a cell height apart and as much as 27.8% (Ravnica, row 42 of 49, at
 * 3.5 radii), because a spherical patch projects to a curved outline whose bounding box is not
 * centred on it. The reason to care is not that the rect's centre lands off its cell — it does not,
 * 0 of 4,803 samples — it is that `shade` is evaluated at `(x, y)`, and W2's lightness half pairs
 * `shade` against the sampled colour *per cell*. Sample anywhere else and the pairing is between a
 * shade here and a colour a fraction of a cell away.
 *
 * A centre that projects outside the capture cannot be sampled, and at 2.2 radii a world overflows
 * the frame so this is routine rather than exceptional. Those cells are **excluded and counted**,
 * never clamped to the frame edge: clamping would hand W2 the colour of whatever is at the border
 * and call it the cell's.
 *
 * The bounds test computes the same `floor(coordinate × scale)` `samplePixel` indexes with, against
 * the same image dimensions, rather than rounding against the probe's viewport. Two nearly-agreeing
 * spellings would disagree on exactly the cells at the edge — and `−0.4` rounds to `−0`, which is
 * not `< 0`, so the rounding spelling samples column 0 for a cell that is off the frame.
 */
export function cellSamples(probe, image, { scale = 1 } = {}) {
  const samples = []
  const offFrame = []
  for (const cell of probe.cells) {
    const px = Math.floor(cell.x * scale)
    const py = Math.floor(cell.y * scale)
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
      offFrame.push(cell.cell)
      continue
    }
    samples.push({
      x: cell.x,
      y: cell.y,
      height: cell.height,
      frontFacing: cell.frontFacing,
      band: cell.band,
      shade: cell.shade,
      rgb: samplePixel(image, cell.x, cell.y, scale),
    })
  }
  return { samples, offFrame }
}

/** The four booleans W4 reads, named so a renamed payload field is a type error and not a `false`. */
export function artCells(probe) {
  return probe.cells.map((cell) => ({
    frontFacing: cell.frontFacing,
    onScreen: cell.onScreen,
    wantsArt: cell.wantsArt,
    showingArt: cell.showingArt,
  }))
}

/**
 * Did the control seam actually engage?
 *
 * > A seam that silently fails to parse its own query parameter runs the **unmodified** policy, its
 * > criterion passes, and the matrix records a *passing control* — which is the
 * > `verify-browser --dataset all` shape of failure, where a whole run was green because it was
 * > measuring nothing. R1 adopted the read-back for this reason and `?probe=` publishes `seams`.
 *
 * **The read-back is not equally strong on all four seams, and this function says which.** Two of
 * them have a *policy* witness in the payload and two have only the URL echo:
 *
 * | Seam | Witness | Strength |
 * |---|---|---|
 * | `?artThreshold=fixed24` | `pool.effectiveThresholdPx === 24` | `policy` — the renderer ran it |
 * | `?layers=N` | `pool.layers` moved off the baseline's | `policy`, given a baseline run |
 * | `?swatch=mean` | `seams.swatchMean` | `echo` — the parameter parsed, nothing more |
 * | `?bands=shuffle` | `seams.bandsShuffle` | `echo` |
 *
 * An `echo` witness is worth having — it separates "the parameter did not parse" from the other two
 * failures — but it cannot separate "the policy did not engage" from "the criterion is insensitive
 * to it". Both echo-only seams carry **expected-RED** rows, where the row going red is itself the
 * evidence that the policy engaged, so nothing in the shipped matrix rests on an echo alone. The
 * gate records the strength per row anyway, because that argument is a property of the current
 * matrix and not of the seam, and it stops being true the moment a row is added.
 *
 * `baseline` is a probe read from the same page with no seams set; `null` means none was taken,
 * which downgrades the `?layers=N` witness to an echo and says so.
 */
export function seamEvidence(probe, requested, baseline = null) {
  const seams = probe.seams
  const rows = []

  rows.push(
    echoRow('swatch=mean', requested.swatchMean === true, seams.swatchMean, 'W2'),
    echoRow('bands=shuffle', requested.bandsShuffle === true, seams.bandsShuffle, 'W3'),
  )

  const wantFixed24 = requested.artThresholdFixed24 === true
  rows.push({
    seam: 'artThreshold=fixed24',
    criterion: 'W4',
    requested: wantFixed24,
    echoed: seams.artThresholdFixed24 === wantFixed24,
    witness: 'policy',
    // Only the *set* direction has a policy witness: an unset seam leaves the quantile free to
    // land on 24 px by coincidence, so `!== 24` is not something the unseamed run can promise.
    policyMoved: wantFixed24 ? probe.pool.effectiveThresholdPx === FIXED24_PX : null,
    detail: `effectiveThresholdPx = ${probe.pool.effectiveThresholdPx}`,
  })

  const wantLayers = requested.layersRequested ?? null
  rows.push({
    seam: 'layers=N',
    criterion: 'W4',
    requested: wantLayers,
    echoed: (seams.layersRequested ?? null) === wantLayers,
    witness: wantLayers !== null && baseline !== null ? 'policy' : 'echo',
    policyMoved:
      wantLayers === null
        ? null
        : baseline === null
          ? null
          : probe.pool.layers !== baseline.pool.layers || probe.pool.layers === wantLayers,
    detail:
      `pool.layers = ${probe.pool.layers}` +
      (baseline === null ? ' (no baseline run)' : `, baseline ${baseline.pool.layers}`),
  })

  return rows.map((row) => ({
    ...row,
    // Unrequested seams must read back false, or the run is measuring a control it did not ask for.
    engaged: row.echoed && row.policyMoved !== false,
  }))
}

function echoRow(seam, requested, reported, criterion) {
  return {
    seam,
    criterion,
    requested,
    echoed: reported === requested,
    witness: 'echo',
    policyMoved: null,
    detail: `seams echo = ${reported}; no policy read-back on the payload`,
  }
}
