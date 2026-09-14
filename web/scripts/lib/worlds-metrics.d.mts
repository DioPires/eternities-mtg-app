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

export interface Measure {
  readonly key: string
  readonly label: string
  readonly value: number | null
  readonly bound: number
  readonly direction: 'min' | 'max'
  readonly pass: boolean
}

export interface Criterion {
  readonly id: string
  readonly title: string
  readonly measures: readonly Measure[]
  readonly pass: boolean
}

export interface W1Criterion extends Criterion {
  readonly perPlane: ReadonlyArray<{ readonly slug: string; readonly medianHeightPx: number | null }>
  readonly worstPlane: string | null
}

export interface W2Criterion extends Criterion {
  readonly sampled: number
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

export interface ControlExpectation {
  readonly criterion: string
  /** Omit to assert on the criterion's overall verdict rather than one of its halves. */
  readonly measure?: string
  readonly expect: 'RED' | 'GREEN'
}

export declare const FLOORS: {
  readonly cellHeightPx: number
  readonly neighbourDeltaE: number
  readonly lightnessIqr: number
  readonly bandDeltaE: number
  readonly artFraction: number
  readonly evictionsPerSecond: number
  readonly homeLabels: number
}

export declare const W2_MIN_CELL_PX: number
export declare const W3_MIN_BAND_SHARE: number
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
export declare function evaluateW5(renderedLabelCount: number): Criterion

export declare function checkControlRow(
  criteria: readonly Criterion[],
  expectation: ControlExpectation,
): { readonly ok: boolean; readonly detail: string }
