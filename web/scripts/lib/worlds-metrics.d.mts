/**
 * Types for `worlds-metrics.mjs`.
 *
 * Same arrangement as `security-headers.d.mts`: the module is plain `.mjs` because
 * `scripts/worlds-gate.mjs` runs it with no build step, and `test/worlds-metrics.test.ts` imports it
 * too — so it needs a declaration to stay type-safe on the test side.
 */

export type Rgb = readonly [number, number, number];

export interface Lab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** A cell as the `?probe=` seam reports it, in CSS pixels, plus the colour sampled at its centre. */
export interface CellSample {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly frontFacing: boolean;
  readonly band: number;
  readonly rgb: Rgb;
  /**
   * §1.4's shade term for this cell, as the renderer computed it — `0.10 + 0.95·s²`.
   *
   * W2's lightness half is measured over the iso-shade subset and cannot be computed without it.
   * The gate does not re-derive it from the normal: doing so would assert against the gate's model
   * of the light rather than against the shipped one.
   */
  readonly shade: number;
}

export interface ArtCell {
  readonly frontFacing: boolean;
  readonly onScreen: boolean;
  /** Above the *effective* threshold this frame, which under §1.6's quantile is not 24 px. */
  readonly wantsArt: boolean;
  readonly showingArt: boolean;
}

export interface EvictionSample {
  /** Seconds. */
  readonly t: number;
  /** The pool's cumulative eviction counter, not a per-interval delta. */
  readonly evictions: number;
}

/**
 * A criterion's or a measure's verdict.
 *
 * `insufficient` is the absence of a measurement — the subject was outside the criterion's domain —
 * and is not a kind of failure. Anything deciding a run's overall verdict must branch on this
 * rather than on `pass`.
 */
export type Verdict = "pass" | "fail" | "insufficient";

export interface Measure {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly bound: number;
  readonly direction: "min" | "max";
  readonly status: Verdict;
  /** `status === 'pass'`. Kept for callers that only branch on success. */
  readonly pass: boolean;
  /** Why the subject was out of domain, when `status` is `insufficient`. */
  readonly insufficientReason: string | null;
  /**
   * Set only by the driver's `foldCriteria`, which folds a per-world measure into a roster verdict.
   *
   * Optional because a criterion measured on one world has no such denominator, and inventing a
   * "1 of 1" for it would put a fold's vocabulary on a reading that was never folded.
   * `checkControlRow` prints these so a verdict cannot be read without the set it was taken over —
   * after the ring domain (DEC-816 R3) W2's lightness half folds off 2 of 45 worlds.
   */
  readonly scoredPlanes?: number;
  /** How many worlds were out of domain for this measure. See `scoredPlanes`. */
  readonly insufficientPlanes?: number;
  /** The world carrying the folded value. See `scoredPlanes`. */
  readonly worstPlane?: string | null;
}

export interface Criterion {
  readonly id: string;
  readonly title: string;
  readonly measures: readonly Measure[];
  readonly status: Verdict;
  /** `status === 'pass'`. An unmeasured criterion has not passed. */
  readonly pass: boolean;
}

export interface W1Criterion extends Criterion {
  readonly perPlane: ReadonlyArray<{
    readonly slug: string;
    readonly medianHeightPx: number | null;
  }>;
  readonly worstPlane: string | null;
  /**
   * The worlds that presented no front-facing cell at the pose, so W1 is undefined on them.
   *
   * Named rather than counted: six one-card worlds that happened to be turned away at this azimuth,
   * and a build that has stopped drawing cells, are the same number and completely different
   * findings.
   */
  readonly undefinedPlanes: readonly string[];
}

export interface W2Criterion extends Criterion {
  readonly sampled: number;
  /** How many of `sampled` fell in the iso-shade ring the lightness half is measured over. */
  readonly isoShadeSampled: number;
  /** `true` when the iso-shade ring itself is below W2's domain, whatever `sampled` reads. */
  readonly isoShadeThin: boolean;
  readonly medianShade: number | null;
}

export interface BandPair {
  readonly bands: readonly [number, number];
  readonly classes: readonly [string, string];
  readonly smallerShare: number;
  readonly deltaE: number;
}

export interface W3Criterion extends Criterion {
  readonly pairs: readonly BandPair[];
  readonly worstPair: BandPair | null;
}

export interface W4Criterion extends Criterion {
  readonly wanting: number;
  readonly showing: number;
  /** The capacity the count was taken at — the quantile is relative to it, so it is provenance. */
  readonly poolLayers: number;
  /** `true` below tier 4's 128: a reading of the harness, not of any browser. */
  readonly belowShippedPool: boolean;
  /**
   * `true` when the pool has layers and demand, but nothing was ever resident — the art stream
   * never ran. Moves `artFraction` to `insufficient`, because a setup failure scored as `fail` is
   * indistinguishable from a policy that exhausts, and it makes both W4 matrix rows inert.
   */
  readonly streamNeverRan: boolean;
  /**
   * `true` when the session's art byte budget was already spent before this world was visited, so
   * every request here was declined for budget. Moves **both** halves to `insufficient`: the
   * numerator is forced to 0 and, since an eviction is the far end of an admission, so is the
   * eviction rate. Entry, not exit — a world that exhausts the budget on its own demand still fails.
   */
  readonly budgetBoundAtEntry: boolean;
  /**
   * The highest `artFraction` this pool could show — `min(1, layers / wanting)`, or `null` where
   * nothing wants art. Reported and **not** scored: see `capacityCeiling` in the implementation for
   * why the 0.9 floor is not lowered to match it, and what a live reading has to settle first.
   */
  readonly capacityCeiling: number | null;
}

export interface W5Criterion extends Criterion {
  /** The worlds with cards that carry no visible label — named, not just counted. */
  readonly neverLabelledWorlds: readonly string[];
  readonly wantedWorlds: number;
  readonly azimuths: number;
  readonly minAzimuths: number;
  /** The five least-often-labelled worlds, as evidence behind the open share ruling. */
  readonly weakestWorlds: ReadonlyArray<{
    readonly slug: string;
    readonly share: number | null;
  }>;
}

/** A rendered label as the gate reads it back off the DOM. */
export interface RenderedLabel {
  readonly opacity: number;
}

/** One sampled azimuth of the home view. `motion.ts:247` is why there is more than one. */
export interface W5AzimuthSample {
  /** The scene's `multiverseAngle`, in radians, at which this frame was read. */
  readonly azimuth: number;
  /** Plane labels passing `isLabelVisible` at this azimuth. */
  readonly labelCount: number;
  /** The slugs carrying such a label at this azimuth. */
  readonly labelledWorlds: readonly string[];
}

export interface W5Options {
  /** Every world with at least one card, by slug — derived from the dataset under test. */
  readonly worldsWithCards: readonly string[];
  /**
   * Required, deliberately undefaulted: one frame is not a sweep, and handed one the reachability
   * measure silently degenerates into the single-frame coverage count it replaces. See
   * `W5_MIN_AZIMUTHS`.
   */
  readonly minAzimuths: number;
}

export interface ControlExpectation {
  readonly criterion: string;
  /** Omit to assert on the criterion's overall verdict rather than one of its halves. */
  readonly measure?: string;
  /** `'N/A'` asserts the criterion was out of its domain — the one-card-world row uses it. */
  readonly expect: "RED" | "GREEN" | "N/A";
}

export interface Roster {
  readonly worlds: number;
  /**
   * Belts that can actually carry a label — **0 on every roster shipped so far**.
   * `PlaneLabels.tsx:116` filters the Blind Eternities by slug, so its 4,204 cards put it in
   * `planesWithCards` without ever making it labellable. See `homeLabelCeiling`.
   */
  readonly labellableBelts?: number;
}

/**
 * The five fixed floors. W5's ceiling is not among them — it is derived from the roster by
 * `homeLabelCeiling`, because the published "≤ 30" was a stale reading of "worlds plus the belt".
 */
export declare const FLOORS: {
  readonly cellHeightPx: number;
  readonly neighbourDeltaE: number;
  readonly lightnessIqr: number;
  readonly bandDeltaE: number;
  readonly artFraction: number;
  readonly evictionsPerSecond: number;
};

export declare function homeLabelCeiling(roster: Roster): number;

export declare const ROSTER_V3: Roster & {
  /** Belts in the roster, labellable or not. `labellableBelts` is the one the ceiling uses. */
  readonly belts: number;
  readonly moons: number;
  readonly planes: number;
};

/** A plane as `planes.json` carries it, in the fields `rowCellsFaults` reads. */
export interface PlaneRecord {
  readonly slug: string;
  readonly kind: string;
  readonly cardCount: number;
  /** Present on worlds only — absent, not empty, on the belt and the moons (§2.4). */
  readonly rowCells?: readonly number[];
}

export declare const WORLD_KINDS: readonly string[];
export declare function rowsClosedForm(cardCount: number): number;
/** One fault string per violation of §1.3's checkable table invariants; empty when clean. */
export declare function rowCellsFaults(
  planes: readonly PlaneRecord[],
): string[];

export declare const W2_MIN_CELL_PX: number;
export declare const W2_ISO_SHADE_TOLERANCE: number;
export declare const W2_MIN_SAMPLES: number;
export declare const W2_MIN_RING_SAMPLES: number;
export declare const W2_CONTROL_SUBJECT_MIN_RING: number;
export declare const W3_MIN_BAND_SHARE: number;
export declare const LABEL_VISIBLE_MIN_OPACITY: number;
export declare function isLabelVisible(label: RenderedLabel): boolean;
export declare const W4_EVICTION_WINDOW_S: number;
export declare const BAND_ORDER: readonly string[];
export declare const BAND_ADJACENCY: ReadonlyArray<readonly [number, number]>;

export declare function srgbToLab(rgb: Rgb): Lab;
export declare function deltaE76(p: Lab, q: Lab): number;
export declare function deltaEab(p: Lab, q: Lab): number;

export declare function median(xs: readonly number[]): number | null;
export declare function quantile(
  xs: readonly number[],
  q: number,
): number | null;
export declare function iqr(xs: readonly number[]): number | null;

export declare function evaluateW1(
  planes: ReadonlyArray<{
    readonly slug: string;
    readonly cells: ReadonlyArray<{
      readonly height: number;
      readonly frontFacing: boolean;
    }>;
  }>,
): W1Criterion;
export declare function evaluateW2(samples: readonly CellSample[]): W2Criterion;
export declare function evaluateW3(
  samples: readonly CellSample[],
  bandShares: readonly number[],
): W3Criterion;
export declare function evictionRate(
  samples: readonly EvictionSample[],
  windowS?: number,
): number | null;
export declare const SMALLEST_SHIPPED_POOL_LAYERS: number;
/**
 * Did the art stream never run? `true` when the pool has capacity and cells want art, but nothing
 * is resident — so no layer was ever handed out. A zero-layer pool is excluded: §1.6 makes that a
 * legal swatch-only world, which is a measurement rather than a setup failure.
 */
export declare function streamNeverRan(
  wanting: number,
  pool: { readonly layers: number; readonly resident: number },
): boolean;
/**
 * Was the session's art byte budget already committed when this world's visit began? The renderer's
 * own `swatchOnly`, **read** off the report taken at **entry** and never recomputed (DEC-820 rider
 * 2): the byte spelling it would be recomputed from has been retired twice, by DEC-780 and again by
 * DEC-812. The byte counts are required because the disqualification message quotes them.
 */
export declare function budgetBoundAtEntry(stream: {
  readonly swatchOnly: boolean;
  readonly bytesOutstanding: number;
  readonly bytesReserved: number;
  readonly byteBudget: number;
}): boolean;
/**
 * `pool` is required on purpose: a W4 count without its capacity is not a reading of the renderer.
 * `entryStream` is required for the same reason — defaulted, it would default off the guard that
 * separates a world's own exhaustion from a tour's carried-over spend.
 */
export declare function evaluateW4(
  cells: readonly ArtCell[],
  evictionTimeline: readonly EvictionSample[],
  pool: { readonly layers: number; readonly resident: number },
  entryStream: {
    readonly swatchOnly: boolean;
    readonly bytesOutstanding: number;
    readonly bytesReserved: number;
    readonly byteBudget: number;
  },
): W4Criterion;
export declare const W5_MIN_AZIMUTHS: number;
export declare const W5_AZIMUTH_UNIFORMITY_TOLERANCE: number;

/**
 * `null` when the azimuths are evenly spaced around the turn, or the reason they are not. A sweep
 * that fails this reports `insufficient`: bad sampling is the harness's defect, not the renderer's.
 */
export declare function azimuthSpacingFault(
  azimuths: readonly number[],
  tolerance?: number,
): string | null;

export declare function evaluateW5(
  sweep: readonly W5AzimuthSample[],
  roster: Roster,
  options: W5Options,
): W5Criterion;

/**
 * Fold one criterion measured on many planes into the roster's verdict: the worst plane, never a
 * mean, with `insufficient` carried rather than counted as a pass.
 *
 * Returns `null` when no plane produced the criterion at all — an absent criterion is not a passing
 * one, and the caller reports that separately.
 */
export declare function foldCriteria(
  perPlane: ReadonlyArray<{
    readonly slug: string;
    readonly criterion: Criterion | null;
  }>,
): Criterion | null;

export declare function checkControlRow(
  criteria: readonly Criterion[],
  expectation: ControlExpectation,
): { readonly ok: boolean; readonly detail: string };
