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
import { cellsWantingArt } from './worlds-metrics.mjs'

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

  readPose(raw, c)
  readPool(raw.pool, c)
  readStream(raw, c)
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

/** The relative agreement `radii` must hold with its own operands. Float, not exact. */
const POSE_IDENTITY_TOLERANCE = 1e-6

/**
 * §3.1's pose, **audited rather than read** — `radii == |cameraPosition − centre| / radius`.
 *
 * > **Normative, and it is DEC-804's whole remedy on this side of the seam.** Until that leg the
 * > payload published `radii` and neither of its operands, so the number was a claim the gate could
 * > only take on trust: leg G watched `radii` run 2.9203 → 2.1687 on a rig whose `cameraDistance`
 * > was constant to four decimals, and reaching that conclusion took instrumenting the product from
 * > outside, because nothing inside the payload disagreed with anything else inside the payload.
 * > A criterion specified "at 2.2 radii" is only as good as `radii`, so `radii` now has to answer
 * > to something. [[a-constant-cannot-testify-to-its-own-provenance]].
 *
 * **The check is not a tautology, and the reason is the frames.** `WorldSurface` measures in the
 * world's own local frame — centre at the origin, the camera counter-rotated onto it — and `radii`
 * is that local camera's length. `centre` and `cameraPosition` are the *untransformed* world-space
 * pair. Agreement therefore says the local-frame substitution was a rigid motion, which is the one
 * assumption it rests on, and it is exactly the assumption that failed in DEC-804: a centre that
 * has stopped tracking the multiverse shows up here as a world sitting where the camera is not
 * looking, on a payload whose every individual field is well-formed.
 *
 * Presence is required, for `readStream`'s reason (DEC-782): `buildWorldsProbe` writes all three
 * unconditionally from non-optional source fields, so a payload missing one is a renderer that
 * stopped publishing, not an old capture — and skipping the identity on a missing operand would
 * retire the audit silently, in the one direction that matters.
 */
function readPose(raw, c) {
  const triple = (name) => {
    if (!c.check(name in raw, `probe.${name}: the key is absent — the renderer stopped publishing it`)) {
      return null
    }
    const value = raw[name]
    if (!c.check(Array.isArray(value) && value.length === 3, `probe.${name}: expected [x, y, z], got ${show(value)}`)) {
      return null
    }
    let ok = true
    for (let i = 0; i < 3; i += 1) ok = c.number(value[i], `probe.${name}[${i}]`) && ok
    return ok ? value : null
  }

  const centre = triple('centre')
  const cameraPosition = triple('cameraPosition')
  const hasRadius =
    c.check('radius' in raw, 'probe.radius: the key is absent — the renderer stopped publishing it') &&
    c.number(raw.radius, 'probe.radius', { min: 0 })
  if (centre === null || cameraPosition === null || !hasRadius) return
  if (typeof raw.radii !== 'number' || !Number.isFinite(raw.radii)) return

  const distance = Math.hypot(
    cameraPosition[0] - centre[0],
    cameraPosition[1] - centre[1],
    cameraPosition[2] - centre[2],
  )
  // `worldsProbe.ts` reports `radii` as 0 rather than dividing when the radius is 0, and §1.6 makes
  // a zero-radius world legal. Scored as its own row so the degenerate arm cannot pass by being
  // skipped — the identity below would read 0/0 and quietly agree with anything.
  if (raw.radius === 0) {
    c.check(
      raw.radii === 0,
      `probe.radii: ${raw.radii} on a world of radius 0 — the renderer reports 0 rather than dividing`,
    )
    return
  }

  const derived = distance / raw.radius
  c.check(
    Math.abs(derived - raw.radii) <= POSE_IDENTITY_TOLERANCE * Math.max(1, Math.abs(raw.radii)),
    `probe.radii: the payload says ${raw.radii} but its own operands give ` +
      `${derived} (|cameraPosition − centre| = ${distance}, radius = ${raw.radius}) — the world is ` +
      'not where the camera is looking, so no criterion taken at a named pose is trustworthy',
  )
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

/**
 * §1.6's stream report (DEC-778), validated on the **whole payload** rather than on `raw.stream`.
 *
 * > **Normative — the key is required, and `?? null` at the call site is the defect (DEC-782).**
 * > `buildWorldsProbe` sets `stream` unconditionally from a *non-optional* `WorldsProbeSource`
 * > field, so on any live payload the key is present and holds either the report or `null`. A
 * > payload with no `stream` key is therefore not an old capture — it is a renderer that stopped
 * > publishing, and `readStream(raw.stream ?? null, c)` would read that regression as the legal
 * > zero-layer world. That is the exact collapse the field exists to prevent, so the presence check
 * > comes first and a missing key fails the gate row.
 *
 * > **`null` is not a zeroed report.** `null` means no `ArtStream` was composed at all — a
 * > zero-layer pool, which §1.6 makes a legal swatch-only world — so nothing was ever going to be
 * > asked for. All-zeros means a stream exists and has asked for nothing, which is a live path that
 * > is idle: the shape DEC-772's missing `cardOf` took. The two must never be collapsed.
 *
 * The gate **reads** `swatchOnly` and never recomputes it (DEC-744 B1 / DEC-746 D5): re-deriving it
 * would assert against the gate's own model of the policy instead of the shipped one.
 *
 * > **And the spelling a re-derivation would reach for has now been the defect TWICE.**
 * > `swatchOnly` is `bytesOutstanding + bytesReserved >= byteBudget` (DEC-812) — what the session
 * > still *holds*, resident and in flight together. It is not `bytesFetched >= byteBudget`, which
 * > DEC-780 retired, and it is no longer `bytesFetched + bytesReserved >= byteBudget`, which DEC-812
 * > retired in turn: `bytesFetched` never decreases, so once the pool begins evicting, that form
 * > charges the session for bodies it no longer holds and declares a healthy world swatch-only for
 * > ever. A gate recomputing either retired form would re-introduce the bug on the reading side
 * > after the stream had been fixed, and silently — each pair of spellings disagrees exactly over
 * > the window its own fix exists to cover (a request in flight for DEC-780, an eviction for
 * > DEC-812).
 * >
 * > The rule generalises past both spellings: **read the field, never re-derive it.** Two
 * > retirements in two legs is the measurement that this policy's spelling is not stable enough to
 * > copy into a reader.
 *
 * Note also that these counters are session-**global** and cumulative, not the focused world's, so
 * no per-world criterion may be written over them (DEC-782 N1).
 */
function readStream(raw, c) {
  if (
    !c.check(
      'stream' in raw,
      'probe.stream: the key is absent. `buildWorldsProbe` publishes it unconditionally, so a ' +
        'payload without it is a renderer that stopped publishing the stream report — not a world ' +
        'that composed without a stream, which is published as `null`.',
    )
  ) {
    return
  }

  const stream = raw.stream
  if (
    !c.check(
      stream === null || isObject(stream),
      `probe.stream: expected the report object or null, got ${show(stream)}`,
    )
  ) {
    return
  }
  // Legal and distinct from an all-zero report: no `ArtStream` was composed, so there are no
  // counters to check rather than counters that read zero.
  if (stream === null) return

  // Byte counts are not asserted integral: `byteBudget` is a §1.12 ladder knob, and a gate that
  // refused to run on a fractional budget would be refusing a legal renderer. Garbage is caught by
  // the type and sign checks either way.
  c.number(stream.bytesFetched, 'probe.stream.bytesFetched', { min: 0 })
  // Bytes of bodies the session still holds: fetched, minus what the pool has since evicted and the
  // stream reclaimed (DEC-812). This is the field the budget actually bounds, and the one
  // `swatchOnly` is computed from — `bytesFetched` is now a lifetime total that only rises.
  //
  // Asserted for sign and for nothing else, deliberately. `bytesOutstanding <= bytesFetched` holds
  // in the shipped stream and is tempting to write here, but it is the arithmetic of the very fix
  // under test rather than an independent invariant, so a reader asserting it would be checking
  // DEC-812 against itself. `min: 0` is the real one: the reclaim credits back exactly the bytes a
  // body was charged, so a negative reading is a double-credit — a body reclaimed twice, or
  // reclaimed without having been charged. That is the failure the eviction listener could
  // plausibly have, which is what makes this check worth its row (DEC-820 rider 3).
  c.number(stream.bytesOutstanding, 'probe.stream.bytesOutstanding', { min: 0 })
  // Bytes charged to requests that have not settled (DEC-780). Checked for sign but for no relation
  // to `bytesFetched`: the field is neither monotonic nor a subset of it — it rises when a request
  // issues and falls when that request settles *whichever way* it settles, so `bytesReserved <=
  // bytesFetched` would be a plausible-looking assertion that a correct stream violates on any frame
  // that issued more than it has landed. `min: 0` is the real invariant: the charge and the credit
  // are symmetric across every settlement, so a negative reading is a leaked credit.
  c.number(stream.bytesReserved, 'probe.stream.bytesReserved', { min: 0 })
  c.number(stream.byteBudget, 'probe.stream.byteBudget', { min: 0 })
  c.boolean(stream.swatchOnly, 'probe.stream.swatchOnly')
  c.number(stream.requested, 'probe.stream.requested', { min: 0, integer: true })
  c.number(stream.resolved, 'probe.stream.resolved', { min: 0, integer: true })
  c.number(stream.failed, 'probe.stream.failed', { min: 0, integer: true })
  c.number(stream.declinedExhausted, 'probe.stream.declinedExhausted', { min: 0, integer: true })
  c.number(stream.declinedBudget, 'probe.stream.declinedBudget', { min: 0, integer: true })
  c.number(stream.declinedFailedBefore, 'probe.stream.declinedFailedBefore', { min: 0, integer: true })
}

function readSeams(seams, c) {
  if (!c.check(isObject(seams), `probe.seams: expected an object, got ${show(seams)}`)) return
  c.boolean(seams.swatchMean, 'probe.seams.swatchMean')
  c.boolean(seams.bandsShuffle, 'probe.seams.bandsShuffle')
  // The sixth seam (DEC-821). Checked here for the same reason as the four above and for one more:
  // `artOffRow` compares this field to the requested boolean with `===`, so a payload that stopped
  // publishing it would read `undefined === false` — which is *false* on an unseamed row, marking a
  // correctly-unseamed run as a seam that failed to echo. A missing field must be read as a
  // malformed payload, not as a control that did not engage.
  c.boolean(seams.artOff, 'probe.seams.artOff')
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
 * The query string for a row's seams. Nothing here invents a seam: these are the renderer's own
 * spellings — R1's four, plus `?art=off` (DEC-821), which `seams.ts` parses as the sixth.
 *
 * > **Here rather than in `worlds-gate.mjs`, and not for tidiness.** This function and
 * > {@link seamEvidence} are the two halves of one contract: this one turns the row's `seams` into
 * > the URL, that one checks the same object against what came back. The gate is a CLI that runs
 * > `main()` on import, so a `seamQuery` living there cannot be tested at all — and the failure it
 * > has is a *silent* one. Drop a spelling and the run still loads a page, still measures, still
 * > produces numbers; it simply measures the unmodified build. `seamEvidence` catches it at run
 * > time via the echo, but only on a row that reaches a live renderer.
 *
 * The spelling is the seam. `worlds-seam-query.test.ts` round-trips every one of these through
 * `readWorldsSeams` — the renderer's own parser, not a second copy of the table — because the two
 * sides sit across a process boundary where a rename cannot be a type error.
 */
export function seamQuery(seams) {
  const parts = []
  if (seams.swatchMean) parts.push('swatch=mean')
  if (seams.bandsShuffle) parts.push('bands=shuffle')
  if (seams.artOff) parts.push('art=off')
  if (seams.artThresholdFixed24) parts.push('artThreshold=fixed24')
  if (typeof seams.layersRequested === 'number') parts.push(`layers=${seams.layersRequested}`)
  return parts.length === 0 ? '' : `&${parts.join('&')}`
}

/**
 * Did the control seam actually engage?
 *
 * > A seam that silently fails to parse its own query parameter runs the **unmodified** policy, its
 * > criterion passes, and the matrix records a *passing control* — which is the
 * > `verify-browser --dataset all` shape of failure, where a whole run was green because it was
 * > measuring nothing. R1 adopted the read-back for this reason and `?probe=` publishes `seams`.
 *
 * **The read-back is not equally strong on all five seams, and this function says which.** Three of
 * them have a *policy* witness in the payload and two have only the URL echo:
 *
 * | Seam | Witness | Strength |
 * |---|---|---|
 * | `?artThreshold=fixed24` | `pool.effectiveThresholdPx === 24` | `policy` — the renderer ran it |
 * | `?layers=N` | `pool.layers` moved off the baseline's | `policy`, given a baseline run |
 * | `?art=off` | `stream.requested === 0` against `wanting > 0`, pool unmoved | `policy` — see {@link artOffRow} |
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
 * > **`?art=off` is why the two echo-only rows are still worth their place.** Both perturb the
 * > *swatch*, and at §3.1's pose `artFraction` measures 0.987–0.997 — essentially every cell draws
 * > art over its swatch — so a swatch that moves moves almost nothing the capture can see. Bare,
 * > `?swatch=mean` reads 25.81 / 28.01 against a no-seam spread of 27.34–27.86 / 24.42–30.75: inside
 * > its own baseline's noise. Composed with `?art=off` every cell draws its swatch, the perturbation
 * > reaches the pixels, and the same row reads **0.954 / 4.673** — both under W2's floors.
 * >
 * > The sibling for a composed row is therefore **`?art=off` alone**, never the bare build:
 * > `?art=off` on its own already moves W2 to 17.92 / 16.50, and scoring the composition against the
 * > bare run would credit the seam under test with the whole of that move.
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
    artOffRow(probe, requested, baseline),
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

/**
 * `?art=off` — the sixth seam (DEC-821), and the only one of the three W2/W3 seams with a **policy**
 * witness rather than an echo.
 *
 * > The seam sits *after* admission and *before* the request (`worldSurface.ts`), and that placement
 * > is what makes it witnessable: the frame still decides which cells want art and still reports
 * > them, so `wantsArt` names the same set as the no-seam run while the stream is asked for nothing.
 * > The witness is that pair read against each other — **`stream.requested === 0` while
 * > `cellsWantingArt > 0`** — because neither half alone says anything. `requested === 0` on a frame
 * > where nothing wanted art is the empty world, not the seam; `wanting > 0` is true of every
 * > unseamed run.
 *
 * **`pool.layers` unmoved is the third clause, and it is the one that separates this seam from the
 * control it must not be confused with.** `?layers=0` also reaches zero requests against a wanting
 * frame — by taking the capacity away. `?art=off` leaves the pool at its shipped size and declines
 * to ask, which is what makes it a control on the *art path* rather than on the *pool*. Checking it
 * needs the no-seam sibling, so without a `baseline` the row says so and keeps the two clauses it
 * can still read.
 *
 * Three ways this degrades to no witness at all, each reported rather than scored `false`:
 *
 * - **`stream === null`** — no `ArtStream` was composed, so there was no request to decline. A
 *   null report is not an all-zero one, and a frame with no stream would read `requested === 0`
 *   whether or not the seam parsed.
 * - **`wanting === 0`** — the frame has no cell asking for art, so the seam has nothing to suppress
 *   and the reading is true of the unseamed build too. The precondition arm, not the measure.
 * - **the seam was not requested** — an unset `?art=off` promises nothing about the counters; the
 *   run is free to request whatever it likes. Only the *set* direction has a witness, exactly as
 *   `?artThreshold=fixed24`'s does.
 */
function artOffRow(probe, requested, baseline) {
  const want = requested.artOff === true
  const echoed = probe.seams.artOff === want
  if (!want) {
    return {
      seam: 'art=off',
      criterion: 'W2/W3',
      requested: false,
      echoed,
      witness: 'echo',
      policyMoved: null,
      detail: `seams echo = ${probe.seams.artOff}; unset, so the counters promise nothing`,
    }
  }

  const wanting = cellsWantingArt(probe.cells).length
  const layersHeld = baseline === null ? null : probe.pool.layers === baseline.pool.layers
  const detail =
    `stream.requested = ${probe.stream === null ? 'null (no ArtStream composed)' : probe.stream.requested}` +
    `, cells wanting art = ${wanting}, pool.layers = ${probe.pool.layers}` +
    (baseline === null
      ? ' (no baseline run, so "pool unmoved" is unchecked)'
      : `, baseline ${baseline.pool.layers}`)

  // The two degenerate frames. `null`, not `false`: the seam is not shown to have failed, it is
  // shown to be unwitnessable here, and the difference is the whole of the precondition arm.
  if (probe.stream === null || wanting === 0) {
    return {
      seam: 'art=off',
      criterion: 'W2/W3',
      requested: true,
      echoed,
      witness: 'echo',
      policyMoved: null,
      detail: `${detail} — no policy witness on this frame`,
    }
  }

  return {
    seam: 'art=off',
    criterion: 'W2/W3',
    requested: true,
    echoed,
    witness: 'policy',
    policyMoved: probe.stream.requested === 0 && (layersHeld === null || layersHeld),
    detail,
  }
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
