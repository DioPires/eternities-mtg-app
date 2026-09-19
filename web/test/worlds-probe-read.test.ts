/**
 * `worlds-probe-read.mjs` — the gate's reader for R1's `?probe=` payload.
 *
 * **The type import is the point of this file.** `WorldsProbe` is imported from the renderer, and
 * every fixture below is declared as one, so a field R1 renames or retypes becomes a `tsc` error in
 * leg G's own suite rather than a `NaN` arriving inside a criterion. `skipLibCheck` means the same
 * import inside `worlds-probe-read.d.mts` proves nothing on its own; the pin has to be exercised
 * from a `.ts` file, which is here.
 *
 * The mutation table is the other half. A validator is worth exactly what its negative controls are
 * worth: "the payload is fine" and "I did not look at that field" print identically unless every
 * field has a row that breaks it and is caught by name.
 */

import { describe, expect, it } from 'vitest'

import type { DecodedPng } from '../scripts/lib/png-sample.d.mts'
import type { ArtStreamReport } from '../src/scene/worlds/artStream'
import type { WorldsProbe, WorldsProbeCell } from '../src/scene/worlds/worldsProbe'
import {
  FIXED24_PX,
  artCells,
  cellCardinality,
  cellSamples,
  readWorldsProbe,
  seamEvidence,
} from '../scripts/lib/worlds-probe-read.mjs'
import { evaluateW4 } from '../scripts/lib/worlds-metrics.mjs'

/**
 * A cell that passes every check.
 *
 * `height` is written as `rect.height` rather than repeated, because the reader's job includes
 * catching a payload where the two disagree and a fixture that hard-codes the same literal twice
 * cannot tell whether that check is wired to anything.
 */
function cell(cellId: number, overrides: Partial<WorldsProbeCell> = {}): WorldsProbeCell {
  const rect = { x: 100, y: 200, width: 30, height: 40 }
  return {
    cell: cellId,
    rect,
    x: 118.5,
    y: 221.5,
    height: rect.height,
    band: 6,
    shade: 0.42,
    frontFacing: true,
    onScreen: true,
    wantsArt: true,
    showingArt: true,
    ...overrides,
  }
}

/** Thirteen shares summing to one, with no zero entries so a dropped band shows up in the sum. */
const SHARES = Object.freeze([
  0.05, 0.08, 0.09, 0.07, 0.08, 0.06, 0.14, 0.06, 0.08, 0.07, 0.09, 0.08, 0.05,
])

/**
 * A **live** stream report — one that exists and has asked for things.
 *
 * Every value is distinct and non-zero on purpose. A zeroed fixture would agree with a reader that
 * had silently substituted an all-zero report for the `null` case, which is the one collapse §1.6
 * forbids, and it would also agree with a reader that crossed two of the eleven counters.
 *
 * `bytesReserved` is deliberately **larger** than `bytesFetched` rather than a slice of it. It is
 * neither monotonic nor a subset (DEC-780) — a selection pass that issues every want for a pose
 * before any of them lands is the shipped case, not a pathological one — so a fixture where the
 * reserve was the smaller number would agree with a reader that had assumed containment.
 *
 * `bytesOutstanding` is strictly **less** than `bytesFetched` (DEC-812). It is what is left standing
 * after the pool evicted a body the session had already fetched, so the two are equal only in a
 * session that has evicted nothing — which is precisely the tour that hid the reclaim at DEC-820.
 * Picking them equal here would agree with a reader that had crossed the two fields, and with one
 * that computed `swatchOnly` from the retired `bytesFetched` spelling. The pair also keeps
 * `swatchOnly` false under the shipped `bytesOutstanding + bytesReserved >= byteBudget` rule
 * (3,145,728 + 7,372,800 = 10,518,528, well under the 67,108,864 budget), so the fixture's declared
 * `swatchOnly: false` is consistent with its own counters rather than contradicting them.
 */
function streamReport(overrides: Partial<ArtStreamReport> = {}): ArtStreamReport {
  return {
    bytesFetched: 4_194_304,
    bytesOutstanding: 3_145_728,
    bytesReserved: 7_372_800,
    byteBudget: 67_108_864,
    swatchOnly: false,
    requested: 158,
    resolved: 151,
    failed: 3,
    declinedExhausted: 27,
    declinedBudget: 11,
    declinedFailedBefore: 5,
    ...overrides,
  }
}

/**
 * Dominaria's radius, and a centre far from the origin on all three axes.
 *
 * The centre is **not** the origin and the camera offset is **not** axis-aligned, both deliberately.
 * At the origin `|cameraPosition − centre|` equals `|cameraPosition|`, so a reader that forgot to
 * subtract the centre would agree — which is DEC-804's defect exactly, and the fixture that hid it.
 * A (2, 3, 6)/7 offset makes every component contribute a different amount, so dropping any one of
 * the three moves the derived `radii` by a different, non-zero factor.
 */
const POSE_RADIUS = 9.978
const POSE_CENTRE = [12, -3, 40] as const
const POSE_DIRECTION = [2 / 7, 3 / 7, 6 / 7] as const

/**
 * The world-space pair that makes `radii == |cameraPosition − centre| / radius` hold.
 *
 * Derived from whatever `radii` the caller asked for rather than pinned beside it, so a test that
 * moves the pose does not have to restate the geometry — and so a test that means to break the
 * identity has to say so by overriding `centre`, `cameraPosition` or `radius` itself. A
 * non-measurable `radii` (the NaN and negative rows) keeps the 2.2 geometry, so those rows fault on
 * the one thing they are about.
 */
function poseFor(radii: number): Pick<WorldsProbe, 'radius' | 'centre' | 'cameraPosition'> {
  const distance = (Number.isFinite(radii) && radii >= 0 ? radii : 2.2) * POSE_RADIUS
  return {
    radius: POSE_RADIUS,
    centre: POSE_CENTRE,
    cameraPosition: [
      POSE_CENTRE[0] + POSE_DIRECTION[0] * distance,
      POSE_CENTRE[1] + POSE_DIRECTION[1] * distance,
      POSE_CENTRE[2] + POSE_DIRECTION[2] * distance,
    ],
  }
}

function probe(overrides: Partial<WorldsProbe> = {}): WorldsProbe {
  const radii = overrides.radii ?? 2.2
  return {
    planeSlug: 'dominaria',
    radii,
    ...poseFor(radii),
    viewport: { width: 1920, height: 1080 },
    cells: [cell(0), cell(1), cell(2)],
    pool: { layers: 1024, resident: 900, effectiveThresholdPx: 31.5, evictions: 12 },
    stream: streamReport(),
    bandShares: SHARES,
    seams: {
      swatchMean: false,
      bandsShuffle: false,
      artOff: false,
      artThresholdFixed24: false,
      layersRequested: null,
    },
    ...overrides,
  }
}

/** A payload with one key *deleted* — not set to `undefined`, which is a different state. */
function without(payload: WorldsProbe, key: keyof WorldsProbe): unknown {
  const copy: Record<string, unknown> = { ...payload }
  delete copy[key]
  return copy
}

/** A solid image, so any pixel difference in a test is one the test put there. */
function image(width: number, height: number, rgb: readonly [number, number, number]): DecodedPng {
  const data = Buffer.alloc(width * height * 4, 0xff)
  for (let p = 0; p < width * height; p += 1) {
    data[p * 4] = rgb[0]
    data[p * 4 + 1] = rgb[1]
    data[p * 4 + 2] = rgb[2]
  }
  return { width, height, data }
}

function paint(img: DecodedPng, x: number, y: number, rgb: readonly [number, number, number]): void {
  const at = (y * img.width + x) * 4
  img.data[at] = rgb[0]
  img.data[at + 1] = rgb[1]
  img.data[at + 2] = rgb[2]
}

describe('readWorldsProbe — the three outcomes', () => {
  it('reads a conforming payload and reports how many checks it ran', () => {
    const result = readWorldsProbe(probe(), { expectedViewport: { width: 1920, height: 1080 } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The positive control for every negative one below: this fixture is not passing because the
    // validator is inert. A denominator of zero would score identically to a clean payload.
    expect(result.checked).toBeGreaterThan(50)
    expect(result.faults).toEqual([])
    expect(result.probe.planeSlug).toBe('dominaria')
  })

  it('calls an undefined payload a setup failure, not a criterion result', () => {
    for (const raw of [undefined, null]) {
      const result = readWorldsProbe(raw)
      expect(result.ok).toBe(false)
      if (result.ok) return
      // `absent` and `malformed` are different states and the gate branches on which. Collapsing
      // them is how a page with no world composed on it scores a matrix at all.
      expect(result.reason).toBe('absent')
      expect(result.detail).toMatch(/no world is composed/)
      expect(result.checked).toBe(0)
    }
  })

  it('separates a drifted payload from an absent one', () => {
    const result = readWorldsProbe({ planeSlug: 'dominaria' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    // The count of checks run is in the message, so a run that failed after looking at four fields
    // cannot be read as one that looked at four hundred.
    expect(result.detail).toMatch(/checks failed/)
    expect(result.checked).toBeGreaterThan(0)
  })
})

/**
 * The ten fields `ArtStreamReport` publishes, each broken alone and caught by name.
 *
 * At module scope so the table-completeness guard below can count these as the stream's negative
 * controls: they are the same kind of row as `MUTANTS`, kept separate only because they share the
 * `stream` sub-object rather than sitting at the payload's top level.
 */
const STREAM_FIELDS: ReadonlyArray<{ readonly field: string; readonly bad: unknown }> = [
  { field: 'bytesFetched', bad: -1 },
  // A negative outstanding balance is the reclaim's own failure mode (DEC-812/DEC-820): a body
  // credited back twice, or credited without having been charged. Distinct from `bytesFetched`'s
  // `-1` so a reader that crossed the two fields fails on the field name in the fault.
  { field: 'bytesOutstanding', bad: -4096 },
  { field: 'bytesReserved', bad: -90_000 },
  { field: 'byteBudget', bad: 'lots' },
  { field: 'swatchOnly', bad: 1 },
  { field: 'requested', bad: 1.5 },
  { field: 'resolved', bad: Number.NaN },
  { field: 'failed', bad: null },
  { field: 'declinedExhausted', bad: -2 },
  { field: 'declinedBudget', bad: undefined },
  { field: 'declinedFailedBefore', bad: '5' },
]

/**
 * §1.6's stream report — required, and its two empty-looking states kept apart (DEC-778, DEC-782).
 *
 * The ruling this block pins: the reader takes the **whole payload** and requires the `stream` key.
 * `buildWorldsProbe` publishes it unconditionally from a non-optional source field, so a payload
 * without it is a renderer that stopped publishing rather than an old capture — and the
 * `readStream(raw.stream ?? null, c)` spelling would read that regression as the legal zero-layer
 * world. `null` and all-zeros are different states: `null` is "no stream was composed", all-zeros is
 * "a stream exists and has asked for nothing", which is the shape DEC-772's missing `cardOf` took.
 */
describe('probe.stream — required, and null is not a zeroed report', () => {
  it.each(STREAM_FIELDS)('rejects a $field the renderer published wrong', ({ field, bad }) => {
    const stream: ArtStreamReport = { ...streamReport(), [field]: bad }
    const result = readWorldsProbe(probe({ stream }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.faults).toHaveLength(1)
    expect(result.faults[0]).toContain(`probe.stream.${field}`)
  })

  it('rejects a payload that stopped publishing the key, rather than reading it as null', () => {
    const raw = probe() as unknown as Record<string, unknown>
    delete raw.stream
    const result = readWorldsProbe(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.faults).toHaveLength(1)
    expect(result.faults[0]).toMatch(/probe\.stream: the key is absent/)
    // The distinguishing assertion, not decoration: the fault must not be phrased as, or scored as,
    // the legal no-stream world. `?? null` at the call site passes this file's other rows and fails
    // exactly here.
    expect(result.faults[0]).toMatch(/published as `null`/)
  })

  it('accepts a world composed with no stream at all', () => {
    const result = readWorldsProbe(probe({ stream: null }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.faults).toEqual([])
    expect(result.probe.stream).toBeNull()
  })

  it('rejects a stream of pure garbage instead of scoring it clean', () => {
    // The row that shows the field is *read*. Before this reader existed the payload validated with
    // `ok: true` and zero faults, because `readWorldsProbe` makes only positive per-field checks and
    // has no unknown-key rule — identical check counts are not evidence of acceptance logic.
    const garbage = {
      bytesFetched: 'no',
      bytesOutstanding: 'no',
      byteBudget: 'no',
      swatchOnly: 'no',
      requested: 'no',
      resolved: 'no',
      failed: 'no',
      declinedExhausted: 'no',
      declinedBudget: 'no',
      declinedFailedBefore: 'no',
    } as unknown as ArtStreamReport
    const result = readWorldsProbe(probe({ stream: garbage }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.faults).toHaveLength(STREAM_FIELDS.length)
  })

  it('rejects a stream that is neither the report nor null', () => {
    const result = readWorldsProbe(probe({ stream: 'idle' as unknown as ArtStreamReport }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.faults).toHaveLength(1)
    expect(result.faults[0]).toMatch(/probe\.stream: expected the report object or null/)
  })

  /**
   * The reader's structure, pinned as a difference of denominators rather than an absolute.
   *
   * An absolute count would have to be restated every time any unrelated field gains a check. The
   * three payloads differ only in `stream`, so the deltas are exactly this reader's contribution:
   * one presence check, one shape check, then one check per field in `STREAM_FIELDS`.
   *
   * Stated against the table's length rather than a literal so that a field added to the report —
   * `bytesReserved` was the tenth (DEC-780), `bytesOutstanding` the eleventh (DEC-812) — cannot be
   * added to the reader while the count still reads as pinned. Adding the field without its
   * negative-control row is what the completeness guard below refuses; adding the row without the
   * reader check is what this refuses. Both retirements arrived this way, which is why the pin is
   * a delta and not a number anybody has to remember to restate.
   */
  it('runs one presence check, one shape check and one check per published field', () => {
    const keyless = probe() as unknown as Record<string, unknown>
    delete keyless.stream

    const absent = readWorldsProbe(keyless)
    const composed = readWorldsProbe(probe({ stream: null }))
    const live = readWorldsProbe(probe())

    // The keyless payload has already spent the presence check, so these deltas are measured from a
    // reader that ran one check, not from none: the full contribution on a live payload is thirteen.
    expect(composed.checked - absent.checked).toBe(1)
    expect(live.checked - composed.checked).toBe(STREAM_FIELDS.length)
    expect(live.checked - absent.checked).toBe(STREAM_FIELDS.length + 1)
  })
})

describe('probe.radii — audited against its own operands, not trusted (DEC-804)', () => {
  /** Move the centre `by` scene units along one axis, leaving every other field alone. */
  const centreOffBy = (by: number): WorldsProbe =>
    probe({ centre: [POSE_CENTRE[0] + by, POSE_CENTRE[1], POSE_CENTRE[2]] })

  it('accepts a payload whose three operands reproduce the radii it published', () => {
    const result = readWorldsProbe(probe())
    expect(result.ok).toBe(true)
  })

  it('accepts the degenerate world §1.6 makes legal — radius 0 and radii 0', () => {
    // The positive half of the zero-radius mutant. Without this row the reader could satisfy that
    // mutant by rejecting *every* zero-radius world, and §1.6's swatch-only world would stop being
    // measurable — a guard that passes its negative control by refusing the legal case too.
    const result = readWorldsProbe(probe({ radii: 0, radius: 0 }))
    expect(result.ok).toBe(true)
  })

  /**
   * The tolerance has to bind, and a tolerance is only checked by a pair.
   *
   * `POSE_IDENTITY_TOLERANCE` is relative (1e-6 of 2.2 radii ≈ 2.2e-6 radii ≈ 2.2e-5 scene units at
   * dominaria's radius). One row either side of that: an offset comfortably inside it passes, an
   * offset comfortably outside it fails. Asserting only the failing row would leave a reader that
   * rejected *any* nonzero difference — float noise included — indistinguishable from a correct one,
   * and it would go red on the first live payload.
   */
  it.each([
    { what: 'float noise, well inside the tolerance', by: 1e-9, ok: true },
    { what: 'a drift a thousand times the tolerance', by: 1e-2, ok: false },
  ])('$what: ok=$ok', ({ by, ok }) => {
    expect(readWorldsProbe(centreOffBy(by)).ok).toBe(ok)
  })

  it('catches the drift DEC-804 shipped, at the magnitude it actually had', () => {
    // Leg G measured `radii` at 2.9203 where the pose was 3.2 — the centre was a stale snapshot of
    // `plane.home` while the camera had flown on. Reconstructed here as the payload that defect
    // would have published: a well-formed centre, the correct camera, and a `radii` belonging to
    // neither. The point of the row is the *size*: 0.28 radii is a number a reviewer reads as a
    // plausible pose, which is why it survived a green suite for a whole phase.
    const drifted = probe({ radii: 2.9203 })
    const result = readWorldsProbe({ ...drifted, ...poseFor(3.2), radii: 2.9203 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.faults.join('\n')).toMatch(/the payload says 2\.9203 but its own operands give 3\.2/)
  })

  it('subtracts the centre — a camera measured from the origin is not a pose', () => {
    // The one mistake the check exists to be immune to, and the one a fixture centred on the origin
    // would license. With the centre at the origin the two readings coincide, so this fixture is
    // the whole reason `POSE_CENTRE` is (12, −3, 40).
    const result = readWorldsProbe(probe({ centre: [0, 0, 0] }))
    expect(result.ok).toBe(false)
  })

  it('counts the pose among its checks rather than adding it for free', () => {
    // `checked` is the audit's denominator (DEC-802). A check that does not increment it is a check
    // no report can show was run.
    const full = readWorldsProbe(probe())
    const noPose = readWorldsProbe(without(probe(), 'centre'))
    expect(full.checked).toBeGreaterThan(noPose.checked)
  })
})

/**
 * One row per field the payload publishes.
 *
 * Each row breaks exactly one thing and names the fault it must produce. A field with no row here is
 * a field the reader is free to stop checking without any test noticing.
 */
const MUTANTS: ReadonlyArray<{
  readonly what: string
  readonly payload: unknown
  readonly fault: RegExp
}> = [
  { what: 'not an object at all', payload: 'a world', fault: /probe: expected the payload object/ },
  {
    what: 'planeSlug of the wrong type',
    payload: probe({ planeSlug: 7 as unknown as string }),
    fault: /planeSlug/,
  },
  { what: 'radii NaN', payload: probe({ radii: Number.NaN }), fault: /radii/ },
  { what: 'radii negative', payload: probe({ radii: -1 }), fault: /radii/ },
  {
    // **The row DEC-804 exists for.** Every field is well-formed and every value is plausible; the
    // only thing wrong is that they disagree with each other. Nothing else in this table catches it,
    // because nothing else in the table compares two fields.
    what: 'radii that its own operands contradict — a centre the camera is not looking at',
    payload: probe({ centre: [0, 0, 0] }),
    fault: /the world is not where the camera is looking/,
  },
  {
    what: 'centre absent — the renderer stopped publishing the pose',
    payload: without(probe(), 'centre'),
    fault: /centre: the key is absent/,
  },
  {
    what: 'cameraPosition absent — the renderer stopped publishing the pose',
    payload: without(probe(), 'cameraPosition'),
    fault: /cameraPosition: the key is absent/,
  },
  {
    what: 'radius absent — the renderer stopped publishing radii’s divisor',
    payload: without(probe(), 'radius'),
    fault: /radius: the key is absent/,
  },
  {
    what: 'centre[] of the wrong arity',
    payload: probe({ centre: [1, 2] as unknown as WorldsProbe['centre'] }),
    fault: /centre: expected \[x, y, z\]/,
  },
  {
    what: 'cameraPosition[] holding a NaN',
    payload: probe({ cameraPosition: [1, Number.NaN, 3] }),
    fault: /cameraPosition\[1\]/,
  },
  {
    what: 'radius negative',
    payload: probe({ radius: -1 }),
    fault: /probe\.radius: expected a finite number/,
  },
  {
    // §1.6's zero-layer world is legal and `worldsProbe.ts` reports `radii` 0 rather than dividing.
    // The degenerate arm needs its own row: the identity would read 0/0 and agree with anything, so
    // a reader that simply skipped it would pass this fixture while forgiving any number at all.
    what: 'a zero-radius world reporting a non-zero radii',
    payload: probe({ radius: 0 }),
    fault: /on a world of radius 0/,
  },
  {
    what: 'viewport missing',
    payload: probe({ viewport: undefined as unknown as WorldsProbe['viewport'] }),
    fault: /viewport: expected an object/,
  },
  {
    what: 'viewport zero-width',
    payload: probe({ viewport: { width: 0, height: 1080 } }),
    fault: /viewport\.width/,
  },
  {
    what: 'pool missing',
    payload: probe({ pool: undefined as unknown as WorldsProbe['pool'] }),
    fault: /pool: expected an object/,
  },
  {
    what: 'pool.layers fractional',
    payload: probe({ pool: { layers: 12.5, resident: 4, effectiveThresholdPx: 24, evictions: 0 } }),
    fault: /pool\.layers/,
  },
  {
    what: 'more resident than there are layers — the prototype 1,031-in-1,024 reading',
    payload: probe({
      pool: { layers: 1024, resident: 1031, effectiveThresholdPx: 24, evictions: 0 },
    }),
    fault: /1031 resident in a 1024-layer pool/,
  },
  {
    what: 'evictions counting backwards',
    payload: probe({ pool: { layers: 8, resident: 4, effectiveThresholdPx: 24, evictions: -1 } }),
    fault: /pool\.evictions/,
  },
  {
    what: 'effectiveThresholdPx NaN — the number the fixed24 seam is witnessed by',
    payload: probe({
      pool: { layers: 8, resident: 4, effectiveThresholdPx: Number.NaN, evictions: 0 },
    }),
    fault: /pool\.effectiveThresholdPx/,
  },
  {
    what: 'seams missing',
    payload: probe({ seams: undefined as unknown as WorldsProbe['seams'] }),
    fault: /seams: expected an object/,
  },
  {
    what: 'a seam read-back that is a string rather than a boolean',
    payload: probe({
      seams: {
        swatchMean: 'true' as unknown as boolean,
        bandsShuffle: false,
        artOff: false,
        artThresholdFixed24: false,
        layersRequested: null,
      },
    }),
    fault: /seams\.swatchMean/,
  },
  {
    what: 'layersRequested fractional',
    payload: probe({
      seams: {
        swatchMean: false,
        bandsShuffle: false,
        artOff: false,
        artThresholdFixed24: false,
        layersRequested: 12.5,
      },
    }),
    fault: /seams\.layersRequested/,
  },
  {
    // The seam whose absence would otherwise read as a *failed echo* rather than a broken payload:
    // `artOffRow` compares `seams.artOff === want` and an unseamed row wants `false`, so a renderer
    // that stopped publishing the field would mark a correct run's control as not engaged. The
    // reader has to reject it first.
    what: 'the art=off read-back missing',
    payload: probe({
      seams: {
        swatchMean: false,
        bandsShuffle: false,
        artOff: undefined as unknown as boolean,
        artThresholdFixed24: false,
        layersRequested: null,
      },
    }),
    fault: /seams\.artOff/,
  },
  {
    what: 'the bands=shuffle read-back missing',
    payload: probe({
      seams: {
        swatchMean: false,
        bandsShuffle: undefined as unknown as boolean,
        artOff: false,
        artThresholdFixed24: false,
        layersRequested: null,
      },
    }),
    fault: /seams\.bandsShuffle/,
  },
  {
    what: 'the artThresholdFixed24 read-back missing',
    payload: probe({
      seams: {
        swatchMean: false,
        bandsShuffle: false,
        artOff: false,
        artThresholdFixed24: undefined as unknown as boolean,
        layersRequested: null,
      },
    }),
    fault: /seams\.artThresholdFixed24/,
  },
  {
    what: 'a bandShares[] entry that is not a number',
    payload: probe({ bandShares: SHARES.map((s, i) => (i === 3 ? Number.NaN : s)) }),
    fault: /bandShares\[3\]/,
  },
  {
    what: 'twelve bands instead of thirteen',
    payload: probe({ bandShares: SHARES.slice(0, 12) }),
    fault: /bandShares: expected 13 entries/,
  },
  {
    what: 'a band silently dropped, the rest untouched',
    payload: probe({ bandShares: [0, ...SHARES.slice(1)] }),
    fault: /bandShares: sums to/,
  },
  {
    what: 'cells not an array',
    payload: probe({ cells: {} as unknown as WorldsProbe['cells'] }),
    fault: /cells: expected an array/,
  },
  {
    what: 'cell ids out of order',
    payload: probe({ cells: [cell(0), cell(2), cell(1)] }),
    fault: /cell ids must ascend/,
  },
  {
    what: 'the same cell twice',
    payload: probe({ cells: [cell(0), cell(0)] }),
    fault: /cell ids must ascend/,
  },
  {
    what: 'height and rect.height disagreeing — two frames spliced into one payload',
    payload: probe({ cells: [cell(0, { height: 41 })] }),
    fault: /height 41 is not rect\.height 40/,
  },
  {
    what: 'a band index off the end of the thirteen-band chain',
    payload: probe({ cells: [cell(0, { band: 13 })] }),
    fault: /cells\[0\]\.band/,
  },
  {
    what: 'a negative band index',
    payload: probe({ cells: [cell(0, { band: -1 })] }),
    fault: /cells\[0\]\.band/,
  },
  {
    what: 'shade NaN',
    payload: probe({ cells: [cell(0, { shade: Number.NaN })] }),
    fault: /cells\[0\]\.shade/,
  },
  {
    what: 'a projected centre that is not a number',
    payload: probe({ cells: [cell(0, { x: undefined as unknown as number })] }),
    fault: /cells\[0\]\.x/,
  },
  {
    what: 'rect missing',
    payload: probe({ cells: [cell(0, { rect: undefined as unknown as WorldsProbeCell['rect'] })] }),
    fault: /cells\[0\]\.rect: expected a rect object/,
  },
  {
    what: 'a negative rect width',
    payload: probe({ cells: [cell(0, { rect: { x: 0, y: 0, width: -3, height: 40 } })] }),
    fault: /cells\[0\]\.rect\.width/,
  },
  {
    what: 'showingArt absent, which a truthiness test would read as "not showing"',
    payload: probe({ cells: [cell(0, { showingArt: undefined as unknown as boolean })] }),
    fault: /cells\[0\]\.showingArt/,
  },
  {
    what: 'wantsArt absent',
    payload: probe({ cells: [cell(0, { wantsArt: undefined as unknown as boolean })] }),
    fault: /cells\[0\]\.wantsArt/,
  },
  {
    what: 'onScreen absent',
    payload: probe({ cells: [cell(0, { onScreen: undefined as unknown as boolean })] }),
    fault: /cells\[0\]\.onScreen/,
  },
  {
    what: 'frontFacing absent',
    payload: probe({ cells: [cell(0, { frontFacing: undefined as unknown as boolean })] }),
    fault: /cells\[0\]\.frontFacing/,
  },
]

describe('readWorldsProbe — one negative control per published field', () => {
  it.each(MUTANTS)('rejects $what', ({ payload, fault }) => {
    const result = readWorldsProbe(payload)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    expect(result.faults.join('\n')).toMatch(fault)
  })

  it('has a row for every field the payload publishes', () => {
    // The mutation table is only as good as its coverage, and coverage of a hand-written table
    // drifts silently. This counts the leaf fields of the fixture and holds the table to them, so a
    // field R1 adds fails here rather than going unchecked.
    const leaves = new Set<string>()
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        if (value.length > 0) walk(value[0], `${path}[]`)
        return
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
        return
      }
      leaves.add(path)
    }
    walk(probe(), '')

    // Both tables count. `STREAM_FIELDS` is the stream sub-object's negative controls, and a field
    // covered there is covered; what this guard refuses is a field covered by *neither*.
    const table = [
      ...MUTANTS.map((m) => m.what + String(m.fault)),
      ...STREAM_FIELDS.map((f) => f.field),
    ].join('\n')
    const unmentioned = [...leaves].filter((leaf) => {
      const field = leaf.split('.').pop() ?? leaf
      return !table.includes(field)
    })
    expect(unmentioned).toEqual([])
  })
})

describe('viewport agreement with the capture', () => {
  it('refuses a payload measured at a viewport the screenshot does not have', () => {
    const result = readWorldsProbe(probe(), { expectedViewport: { width: 1280, height: 720 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.faults.join('\n')).toMatch(/measured at 1920x1080 but the capture is 1280x720/)
  })

  it('accepts the matching one', () => {
    expect(readWorldsProbe(probe(), { expectedViewport: { width: 1920, height: 1080 } }).ok).toBe(
      true,
    )
  })
})

describe('cellCardinality', () => {
  it('reports a complete payload as complete', () => {
    expect(cellCardinality(probe(), 3)).toMatchObject({ dropped: 0, complete: true, inRange: true })
  })

  it('counts cards the payload dropped at the near plane', () => {
    // `buildWorldsProbe` skips a cell whose grid is wholly inside the near plane. The payload
    // carries no `cardCount`, so a run that measured 2 of a 3-card world is otherwise
    // indistinguishable from one that measured all of it — the count has to come from the dataset.
    const cardinality = cellCardinality(probe({ cells: [cell(0), cell(1)] }), 3)
    expect(cardinality).toMatchObject({ reported: 2, dropped: 1, complete: false })
  })

  it('catches a cell id past the world it claims to describe', () => {
    expect(cellCardinality(probe({ cells: [cell(0), cell(9)] }), 3).inRange).toBe(false)
  })
})

describe('cellSamples', () => {
  it('samples at the projected centre, not at the centre of the rect', () => {
    // R1's ruling, and the mutant it forbids. The two points are up to 27.8% of a cell height apart,
    // and `shade` is evaluated at the projected centre — W2's lightness half pairs `shade` with this
    // colour per cell, so a sample taken at the rect's centre pairs a shade here with a colour
    // somewhere else. The fixture puts a different colour at each point, so the two spellings cannot
    // both pass.
    const img = image(1920, 1080, [10, 10, 10])
    const one = cell(0, { x: 118.5, y: 221.5, rect: { x: 100, y: 200, width: 30, height: 40 } })
    const rectCentreX = one.rect.x + one.rect.width / 2
    const rectCentreY = one.rect.y + one.rect.height / 2
    expect([Math.floor(rectCentreX), Math.floor(rectCentreY)]).not.toEqual([118, 221])
    paint(img, 118, 221, [200, 30, 40])
    paint(img, Math.floor(rectCentreX), Math.floor(rectCentreY), [40, 30, 200])

    const { samples, offFrame } = cellSamples(probe({ cells: [one] }), img)
    expect(offFrame).toEqual([])
    expect(samples[0]?.rgb).toEqual([200, 30, 40])
  })

  it('carries shade and band through untouched, because the gate may not re-derive them', () => {
    const img = image(1920, 1080, [10, 10, 10])
    const { samples } = cellSamples(probe({ cells: [cell(0, { band: 11, shade: 0.77 })] }), img)
    expect(samples[0]).toMatchObject({ band: 11, shade: 0.77, height: 40, frontFacing: true })
  })

  it('excludes an off-frame centre and counts it, rather than clamping to the border', () => {
    const img = image(64, 64, [10, 10, 10])
    const cells = [cell(0, { x: 10, y: 10 }), cell(1, { x: 70, y: 10 }), cell(2, { x: -0.4, y: 5 })]
    const { samples, offFrame } = cellSamples(
      probe({ cells, viewport: { width: 64, height: 64 } }),
      img,
    )
    // `-0.4` is the row that separates a floor from a round: it rounds to `-0`, which is not `< 0`,
    // so the rounding spelling samples column 0 and reports a colour for a cell off the frame.
    expect(offFrame).toEqual([1, 2])
    expect(samples).toHaveLength(1)
  })

  it('applies an explicit device-pixel scale to both the bound and the sample', () => {
    const img = image(128, 128, [10, 10, 10])
    paint(img, 20, 20, [1, 2, 3])
    const at2x = probe({ cells: [cell(0, { x: 10, y: 10 })], viewport: { width: 64, height: 64 } })
    expect(cellSamples(at2x, img, { scale: 2 }).samples[0]?.rgb).toEqual([1, 2, 3])
  })
})

describe('artCells', () => {
  it('projects exactly the four booleans W4 reads', () => {
    const cells = artCells(probe({ cells: [cell(0, { wantsArt: true, showingArt: false })] }))
    expect(cells).toEqual([
      { frontFacing: true, onScreen: true, wantsArt: true, showingArt: false },
    ])
  })
})

describe('seamEvidence', () => {
  const asked = { artThresholdFixed24: true } as const

  it('rates the fixed24 seam on a policy read-back, not on the URL echo', () => {
    const engaged = seamEvidence(
      probe({
        pool: { layers: 1024, resident: 10, effectiveThresholdPx: FIXED24_PX, evictions: 0 },
        seams: {
          swatchMean: false,
          bandsShuffle: false,
          artOff: false,
          artThresholdFixed24: true,
          layersRequested: null,
        },
      }),
      asked,
    ).find((row) => row.seam === 'artThreshold=fixed24')
    expect(engaged).toMatchObject({ witness: 'policy', echoed: true, policyMoved: true, engaged: true })
  })

  it('catches a seam that echoes true while the renderer ran the unmodified policy', () => {
    // The failure the read-back exists for, one step further along: the parameter parsed, the echo
    // says so, and the quantile is still running. Without the policy witness this row is a passing
    // control and the matrix records a criterion that was never actually challenged.
    const row = seamEvidence(
      probe({
        pool: { layers: 1024, resident: 10, effectiveThresholdPx: 31.5, evictions: 0 },
        seams: {
          swatchMean: false,
          bandsShuffle: false,
          artOff: false,
          artThresholdFixed24: true,
          layersRequested: null,
        },
      }),
      asked,
    ).find((r) => r.seam === 'artThreshold=fixed24')
    expect(row).toMatchObject({ echoed: true, policyMoved: false, engaged: false })
  })

  it('catches a seam engaging that the run never asked for', () => {
    const row = seamEvidence(
      probe({
        seams: {
          swatchMean: true,
          bandsShuffle: false,
          artOff: false,
          artThresholdFixed24: false,
          layersRequested: null,
        },
      }),
      {},
    ).find((r) => r.seam === 'swatch=mean')
    expect(row).toMatchObject({ requested: false, echoed: false, engaged: false })
  })

  // ---- ?art=off, the sixth seam (DEC-821) -------------------------------------------------------
  // The only W2/W3 seam with a policy witness. Every row below asks the same question of it: can
  // this reading be told apart from the run that did *not* engage the seam?
  describe('art=off', () => {
    const artOff = { artOff: true } as const
    const seams = {
      swatchMean: false,
      bandsShuffle: false,
      artOff: true,
      artThresholdFixed24: false,
      layersRequested: null,
    }
    /** The seam's own shape: cells still want art, the stream was asked for none. */
    const suppressed = (overrides: Partial<WorldsProbe> = {}): WorldsProbe =>
      probe({ seams, stream: streamReport({ requested: 0 }), ...overrides })
    const rowOf = (p: WorldsProbe, baseline: WorldsProbe | null = null) =>
      seamEvidence(p, artOff, baseline).find((r) => r.seam === 'art=off')

    it('reads the policy, not the echo: no request against a frame that still wants art', () => {
      expect(rowOf(suppressed())).toMatchObject({
        witness: 'policy',
        echoed: true,
        policyMoved: true,
        engaged: true,
      })
    })

    it('catches the seam that suppresses the draw but still asks the stream', () => {
      // `mutate-attach.mjs`'s third mutant, on this side of the seam. The cells go swatch-only and
      // the capture looks exactly right, but the pool was still worked — so the row is no longer a
      // control on the art path, and the echo alone could never say so. `requested` is the default
      // 158 here: a real number the unseamed run would also produce.
      expect(rowOf(probe({ seams }))).toMatchObject({
        witness: 'policy',
        echoed: true,
        policyMoved: false,
        engaged: false,
      })
    })

    it('refuses the reading that ?layers=0 would also produce', () => {
      // Zero requests against a wanting frame is *not* on its own the seam: taking the capacity away
      // reaches the same two counters. The third clause is the pool holding its shipped size, and it
      // needs the no-seam sibling to be checkable at all.
      const starved = suppressed({ pool: { layers: 0, resident: 0, effectiveThresholdPx: 31.5, evictions: 12 } })
      expect(rowOf(starved, probe())).toMatchObject({ policyMoved: false, engaged: false })
      // Same payload, same seam, sibling that agrees on capacity — the clause is doing the work.
      expect(rowOf(starved, starved)).toMatchObject({ policyMoved: true, engaged: true })
    })

    it('does not claim a witness on a frame where no cell wants art', () => {
      // The precondition arm. `requested === 0` is true of the empty world whether or not the seam
      // parsed, so this frame cannot testify — and saying so is different from scoring it failed.
      const empty = suppressed({ cells: [cell(0, { wantsArt: false }), cell(1, { wantsArt: false })] })
      expect(rowOf(empty)).toMatchObject({ witness: 'echo', policyMoved: null, engaged: true })
      expect(rowOf(empty)?.detail).toMatch(/no policy witness on this frame/)
    })

    it('does not read a null stream as an all-zero one', () => {
      // No `ArtStream` was composed, so there was no request to decline.
      const noStream = suppressed({ stream: null })
      expect(rowOf(noStream)).toMatchObject({ witness: 'echo', policyMoved: null, engaged: true })
      expect(rowOf(noStream)?.detail).toMatch(/no ArtStream composed/)
    })

    it('promises nothing about the counters when the seam was not requested', () => {
      // The shipped build requests art, and that must not read as a failed control. Only the set
      // direction has a witness — exactly as `?artThreshold=fixed24`'s does.
      expect(seamEvidence(probe(), {}).find((r) => r.seam === 'art=off')).toMatchObject({
        requested: false,
        witness: 'echo',
        echoed: true,
        policyMoved: null,
        engaged: true,
      })
    })

    it('catches the seam engaging that the run never asked for', () => {
      expect(seamEvidence(probe({ seams }), {}).find((r) => r.seam === 'art=off')).toMatchObject({
        requested: false,
        echoed: false,
        engaged: false,
      })
    })

    it('counts the same cells W4 scores', () => {
      // The witness says "the frame still wanted art"; W4 says "this many cells wanted art". If the
      // two used different predicates, `art=off` could claim a witness on a frame W4 reads as empty
      // — the seam testifying about cells the criterion is not scoring.
      //
      // One off-screen and one back-facing cell: both are `wantsArt`, and neither counts for either
      // side. The witness must decline the frame, and W4 must report it as wanting nothing.
      const entry = streamReport({ requested: 0 })
      const offFrame = suppressed({
        cells: [cell(0, { onScreen: false }), cell(1, { frontFacing: false })],
        stream: entry,
      })
      expect(rowOf(offFrame)).toMatchObject({ witness: 'echo', policyMoved: null })

      // `entry` doubles as the exit report here: this fixture's subject is the cell predicate, and
      // the visit neither begins nor ends budget-bound, so both ends read the same stream.
      const w4 = evaluateW4(artCells(offFrame), [], offFrame.pool, entry, entry)
      expect(w4.wanting).toBe(0)
      // And the same three cells with the flags on: both sides see the frame, so the disagreement
      // above is the predicate agreeing, not both sides being blind to every fixture.
      const onFrame = suppressed()
      expect(rowOf(onFrame)).toMatchObject({ witness: 'policy', policyMoved: true })
      expect(evaluateW4(artCells(onFrame), [], onFrame.pool, entry, entry).wanting).toBe(3)
    })
  })

  it('marks the two colour seams as echo-only, because the payload has no witness for them', () => {
    const rows = seamEvidence(
      probe({
        seams: {
          swatchMean: true,
          artOff: false,
          bandsShuffle: true,
          artThresholdFixed24: false,
          layersRequested: null,
        },
      }),
      { swatchMean: true, bandsShuffle: true },
    )
    for (const seam of ['swatch=mean', 'bands=shuffle']) {
      const row = rows.find((r) => r.seam === seam)
      // Recorded, not hidden. Both rows are expected-RED, where redness is itself the evidence the
      // policy engaged — but that argument is a property of today's matrix, not of the seam, and it
      // expires the moment a row is added.
      expect(row).toMatchObject({ witness: 'echo', policyMoved: null, engaged: true })
    }
  })

  it('downgrades the layers witness to an echo when no baseline run was taken', () => {
    const withLayers = probe({
      pool: { layers: 128, resident: 10, effectiveThresholdPx: 31.5, evictions: 0 },
      seams: {
        swatchMean: false,
        bandsShuffle: false,
        artOff: false,
        artThresholdFixed24: false,
        layersRequested: 128,
      },
    })
    const alone = seamEvidence(withLayers, { layersRequested: 128 }).find(
      (r) => r.seam === 'layers=N',
    )
    expect(alone).toMatchObject({ witness: 'echo', policyMoved: null })

    const against = seamEvidence(withLayers, { layersRequested: 128 }, probe()).find(
      (r) => r.seam === 'layers=N',
    )
    expect(against).toMatchObject({ witness: 'policy', policyMoved: true, engaged: true })
  })

  it('fails the layers row when the pool did not move off the baseline', () => {
    const unmoved = probe({
      pool: { layers: 1024, resident: 10, effectiveThresholdPx: 31.5, evictions: 0 },
      seams: {
        swatchMean: false,
        bandsShuffle: false,
        artOff: false,
        artThresholdFixed24: false,
        layersRequested: 128,
      },
    })
    const row = seamEvidence(unmoved, { layersRequested: 128 }, probe()).find(
      (r) => r.seam === 'layers=N',
    )
    expect(row).toMatchObject({ policyMoved: false, engaged: false })
  })
})
