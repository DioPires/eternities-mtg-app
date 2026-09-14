/**
 * Types for `worlds-metrics.mjs`.
 *
 * Same arrangement as `security-headers.d.mts`: the module is plain `.mjs` because
 * `scripts/worlds-gate.mjs` runs it with no build step, and `test/worlds-metrics.test.ts` imports it
 * too — so it needs a declaration to stay type-safe on the test side.
 */

export type Rgb = readonly [number, number, number]

export interface Lab {
  readonly L: number
  readonly a: number
  readonly b: number
}

/** A cell as the `?probe=` seam reports it, in CSS pixels, plus the colour sampled at its centre. */
export interface CellSample {
  readonly x: number
  readonly y: number
  readonly height: number
  readonly frontFacing: boolean
  readonly band: number
  readonly rgb: Rgb
  /**
   * §1.4's shade term for this cell, as the renderer computed it — `0.10 + 0.95·s²`.
   *
   * W2's lightness half is measured over the iso-shade subset and cannot be computed without it.
   * The gate does not re-derive it from the normal: doing so would assert against the gate's model
   * of the light rather than against the shipped one.
   */
  readonly shade: number
}

export interface ArtCell {
  readonly frontFacing: boolean
  readonly onScreen: boolean
  /** Above the *effective* threshold this frame, which under §1.6's quantile is not 24 px. */
  readonly wantsArt: boolean
  readonly showingArt: boolean
}

export interface EvictionSample {
  /** Seconds. */
  readonly t: number
  /** The pool's cumulative eviction counter, not a per-interval delta. */
  readonly evictions: number
}

/**
 * A criterion's or a measure's verdict.
 *
 * `insufficient` is the absence of a measurement — the subject was outside the criterion's domain —
 * and is not a kind of failure. Anything deciding a run's overall verdict must branch on this
 * rather than on `pass`.
 */
export type Verdict = 'pass' | 'fail' | 'insufficient'

export interface Measure {
  readonly key: string
  readonly label: string
  readonly value: number | null
  readonly bound: number
  readonly direction: 'min' | 'max'
  readonly status: Verdict
  /** `status === 'pass'`. Kept for callers that only branch on success. */
  readonly pass: boolean
  /** Why the subject was out of domain, when `status` is `insufficient`. */
  readonly insufficientReason: string | null
}

export interface Criterion {
  readonly id: string
  readonly title: string
  readonly measures: readonly Measure[]
  readonly status: Verdict
  /** `status === 'pass'`. An unmeasured criterion has not passed. */
  readonly pass: boolean
}

export interface W1Criterion extends Criterion {
  readonly perPlane: ReadonlyArray<{ readonly slug: string; readonly medianHeightPx: number | null }>
  readonly worstPlane: string | null
}

export interface W2Criterion extends Criterion {
  readonly sampled: number
  /** How many of `sampled` fell in the iso-shade ring the lightness half is measured over. */
  readonly isoShadeSampled: number
  readonly medianShade: number | null
}

export interface BandPair {
  readonly bands: readonly [number, number]
  readonly classes: readonly [string, string]
  readonly smallerShare: number
  readonly deltaE: number
}

export interface W3Criterion extends Criterion {
  readonly pairs: readonly BandPair[]
  readonly worstPair: BandPair | null
}

export interface W4Criterion extends Criterion {
  readonly wanting: number
  readonly showing: number
}

export interface W5Criterion extends Criterion {
  /** The worlds with cards that carry no visible label — named, not just counted. */
  readonly missingWorlds: readonly string[]
  readonly coveredWorlds: number
  readonly wantedWorlds: number
}

/** A rendered label as the gate reads it back off the DOM. */
export interface RenderedLabel {
  readonly opacity: number
}

export interface W5Coverage {
  /** Every world with at least one card, by slug — derived from the dataset under test. */
  readonly worldsWithCards: readonly string[]
  /** The slugs carrying a label that passes `isLabelVisible`. */
  readonly labelledWorlds: readonly string[]
  /**
   * Required, deliberately undefaulted: this is a product ruling, not a measurement. See
   * `evaluateW5` — DEC-751's suggested 0.9 fails on DEC-751's own 39/45 = 0.867.
   */
  readonly coverageFloor: number
}

export interface ControlExpectation {
  readonly criterion: string
  /** Omit to assert on the criterion's overall verdict rather than one of its halves. */
  readonly measure?: string
  /** `'N/A'` asserts the criterion was out of its domain — the one-card-world row uses it. */
  readonly expect: 'RED' | 'GREEN' | 'N/A'
}

export interface Roster {
  readonly worlds: number
  readonly belts: number
}

/**
 * The five fixed floors. W5's ceiling is not among them — it is derived from the roster by
 * `homeLabelCeiling`, because the published "≤ 30" was a stale reading of "worlds plus the belt".
 */
export declare const FLOORS: {
  readonly cellHeightPx: number
  readonly neighbourDeltaE: number
  readonly lightnessIqr: number
  readonly bandDeltaE: number
  readonly artFraction: number
  readonly evictionsPerSecond: number
}

export declare function homeLabelCeiling(roster: Roster): number

export declare const ROSTER_V3: {
  readonly worlds: number
  readonly belts: number
  readonly moons: number
  readonly planes: number
}

export declare const W2_MIN_CELL_PX: number
export declare const W2_ISO_SHADE_TOLERANCE: number
export declare const W2_MIN_SAMPLES: number
export declare const W3_MIN_BAND_SHARE: number
export declare const LABEL_VISIBLE_MIN_OPACITY: number
export declare function isLabelVisible(label: RenderedLabel): boolean
export declare const W4_EVICTION_WINDOW_S: number
export declare const BAND_ORDER: readonly string[]
export declare const BAND_ADJACENCY: ReadonlyArray<readonly [number, number]>

export declare function srgbToLab(rgb: Rgb): Lab
export declare function deltaE76(p: Lab, q: Lab): number
export declare function deltaEab(p: Lab, q: Lab): number

export declare function median(xs: readonly number[]): number | null
export declare function quantile(xs: readonly number[], q: number): number | null
export declare function iqr(xs: readonly number[]): number | null

export declare function evaluateW1(
  planes: ReadonlyArray<{
    readonly slug: string
    readonly cells: ReadonlyArray<{ readonly height: number; readonly frontFacing: boolean }>
  }>,
): W1Criterion
export declare function evaluateW2(samples: readonly CellSample[]): W2Criterion
export declare function evaluateW3(
  samples: readonly CellSample[],
  bandShares: readonly number[],
): W3Criterion
export declare function evictionRate(
  samples: readonly EvictionSample[],
  windowS?: number,
): number | null
export declare function evaluateW4(
  cells: readonly ArtCell[],
  evictionTimeline: readonly EvictionSample[],
): W4Criterion
export declare function evaluateW5(
  renderedLabelCount: number,
  roster: Roster,
  coverage: W5Coverage,
): W5Criterion

export declare function checkControlRow(
  criteria: readonly Criterion[],
  expectation: ControlExpectation,
): { readonly ok: boolean; readonly detail: string }
