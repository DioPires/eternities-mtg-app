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
  /**
   * Layers held at this sample. **Optional because the rate does not need it and the high-water
   * mark does** — a timeline carrying only `evictions` is still a legal input to
   * {@link evictionRate}, and {@link poolHighWater} reports `null` for it rather than `0`.
   */
  readonly resident?: number;
  /** The pool's capacity at this sample. Optional for the same reason as {@link resident}. */
  readonly layers?: number;
}

/**
 * The pool's occupancy over the window {@link evictionRate} scored — the eviction rate's
 * denominator. `resident` only, so it is a **lower bound**: `?probe=` does not publish `reserved`.
 */
export interface PoolHighWater {
  readonly resident: number;
  readonly layers: number;
  /** `resident >= layers` with a non-zero capacity: the state in which `claimLayer` must evict. */
  readonly saturated: boolean;
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
   * `false` on a measure that is reported and does **not** decide its criterion's colour (DEC-752,
   * board ruling `demand_measure_scored` = `reported_only`).
   *
   * Distinct from `insufficient`, which says the subject was not measured: an unscored measure *was*
   * measured and is being shown. Read by the per-plane verdict, the roster fold and the control
   * matrix through one predicate, so those three cannot disagree about which measures count.
   */
  readonly scored: boolean;
  /**
   * How `foldCriteria` aggregates this measure across planes — `'worst'` everywhere but W3, whose
   * roster fold is the **mean** (board ruling `fold_mean`, card `7d3653f6`).
   */
  readonly fold: "worst" | "mean";
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
  /**
   * The worlds whose own reading failed, under a `'worst'` fold — including a world that failed
   * with no value, which the fold counts as a failure rather than as out of domain (DEC-861).
   */
  readonly failingPlanes?: readonly string[];
  /**
   * `evictionsPerSecond` only, and only when it carries a rate: the tail's own drift, printed beside
   * the value with the band it implies (DEC-861). See `withTailDrift`.
   */
  readonly drift?: number;
  /**
   * The world carrying the folded value under a `'worst'` fold; under `'mean'`, the world holding
   * the low end of the readings — reported for context, and not the subject of the verdict.
   */
  readonly worstPlane?: string | null;
  /** Which fold produced the value. Set by `foldCriteria` only. */
  readonly foldKind?: "mean";
  /**
   * Every per-world reading the mean was taken over, lowest first — set by the mean fold alone.
   *
   * Published so a roster mean can be taken apart rather than taken on trust: §3.1 requires the
   * readings and the denominator beside the fold, because a mean is the one fold a narrowed domain
   * flatters.
   */
  readonly readings?: ReadonlyArray<{
    readonly slug: string;
    readonly value: number;
  }>;
  /** The roster's recorded W3 scored-domain size, `null` on a dataset with none recorded. */
  readonly expectedPlanes?: number | null;
  /** The roster's recorded count of worlds W3's band-share rule puts in reach. See `expectedPlanes`. */
  readonly expectedQualifyingPlanes?: number | null;
  /** How many toured worlds qualify for W3 by band share alone, off the run's own probes. */
  readonly qualifyingPlanes?: number | null;
  /**
   * Why a mean fold failed on its denominator rather than on its value — empty when it did not.
   * A domain fault is a `fail`, never an `insufficient`: the measurement happened and is not
   * comparable to the floor.
   */
  readonly domainFaults?: readonly string[];
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
   * Front-facing, on-screen cells — the frame's geometry, before the art policy has had a vote.
   * `artCellsShowing`'s domain is written from this and never from `wanting`, which the adaptive
   * threshold chooses.
   */
  readonly presented: number;
  /** The capacity the eviction bound is derived at: `W4_EVICTION_POOL_LAYERS`. */
  readonly evictionPoolLayers: number;
  /** Whether this session ran at it. `false` moves `evictionsPerSecond` to `insufficient`. */
  readonly atEvictionPool: boolean;
  /**
   * Where the fill ended, how much tail was left, and how far the tail's own second half sat from
   * the whole. Reported even when `rate` is `null`, so a run that failed to settle can be inspected
   * rather than merely disqualified.
   */
  readonly evictionTail: EvictionTail;
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
   * `true` when the renderer reported `swatchOnly` at the **exit** of this world's visit — the
   * eviction half's own domain (DEC-752, ruling `exit_domain`). Moves `evictionsPerSecond` alone to
   * `insufficient`, never `artFraction`: a pool forbidden to admit cannot evict, but a starved frame
   * is still a true reading of a starved frame. This is what retires the `fixed24` row's false GREEN
   * at 0/s.
   */
  readonly budgetBoundAtExit: boolean;
  /**
   * The highest `artFraction` this pool could show — `min(1, layers / wanting)`, or `null` where
   * nothing wants art.
   *
   * **Scored since 2026-09-16**, via `artFractionBar`. See `reachableBar` in the implementation: on
   * a saturated pool `artFraction` equals this ceiling exactly, so a bar that is only a *fraction* of
   * it could never bind — which is why the bar carries an absolute floor as well.
   */
  readonly capacityCeiling: number | null;
  /**
   * The bar `artFraction` was actually scored against:
   * `max(FLOORS.artFraction × capacityCeiling, FLOORS.artFractionAbsolute)` (rulings
   * `split_measures` + `floor_times_ceiling`, then `absolute_floor`), or the flat floor where
   * nothing wants art. Reported so a verdict cannot be read without the bar it was taken against.
   */
  readonly artFractionBar: number;
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
  /**
   * The floor `artFraction` clears whatever the pool's ceiling is (ruling `absolute_floor`). On a
   * saturated pool this is equivalent to "demand may exceed capacity by at most `1 / this`".
   */
  readonly artFractionAbsolute: number;
  /**
   * Evictions/s on the fill-excluded tail, at the 1,024-layer pool alone (ruling `bd5c9aad`,
   * option (a)). `evictions == requested` is an identity, so this bounds want-set turnover.
   */
  readonly evictionsPerSecond: number;
  /**
   * The absolute count of cells showing art a frame in `W4_STARVATION_DOMAIN_CELLS`'s domain must
   * reach — the no-starvation term a ratio could not carry (DEC-834's 14-cell want set read
   * `artFraction` 1.00). **A quarter of the domain threshold, never equal to it:** set equal, the
   * worst in-domain reading is pinned just above the bound on every build.
   */
  readonly artCellsAbsolute: number;
  /** W1's pixel witness on a swept row, ΔE76 centre against surround (DEC-861). */
  readonly cellDrawnDeltaE: number;
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
/**
 * W3's domain per dataset hash — the denominator its mean fold is taken over.
 *
 * `byShares` is what the dataset's card distribution puts in reach; `scored` is what then presents
 * both bands in the sampled cells. **`byShares >= scored`, and on the shipped roster they are 30 and
 * 28** — they are not two spellings of one number.
 */
export declare const W3_DOMAIN_SIZE: Readonly<
  Record<string, Readonly<{ scored: number; byShares: number }>>
>;
/** Whether a plane's thirteen band shares alone put it in W3's domain, before any sampling. */
export declare function w3QualifiesByShares(
  bandShares: readonly number[] | undefined,
): boolean;
export declare const LABEL_VISIBLE_MIN_OPACITY: number;
export declare function isLabelVisible(label: RenderedLabel): boolean;
/** The shortest span a fill-excluded eviction tail may be differenced over, in seconds. */
export declare const W4_EVICTION_WINDOW_S: number;
/** The pool capacity W4's eviction half is scored at — the shipped 1,024, and only it. */
export declare const W4_EVICTION_POOL_LAYERS: number;
export declare const W4_EVICTION_MIN_TAIL_SAMPLES: number;
export declare const W4_EVICTION_TAIL_CONVERGENCE: number;
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
    /**
     * The pixel witness's worst reading over a spin sweep — present only on a swept visit, `null`
     * where the witness could not read a counted phase. See `w1DrawWitness`.
     */
    readonly contrastDeltaE?: number | null;
  }>,
): W1Criterion;

/** The least projected-centre travel, in CSS px, before a spin sweep is believed. */
export declare const SPIN_SWEEP_MIN_TRAVEL_PX: number;

/** W4's `artFraction` on one frame's cells, or `null` when no cell wants art. */
export declare function artFractionOf(cells: readonly ArtCell[]): number | null;

/** Median ΔE76 from a cell's centre pixel to the ring around it, or `null`. */
export declare function centreContrastDeltaE(
  samples: {
    readonly centre: Rgb;
    readonly surround: readonly Rgb[];
  } | null,
): number | null;

/** One sample of a spin sweep, in sweep order. */
export interface SpinPhase {
  readonly t: number;
  /** Front-facing cells on this frame. */
  readonly presented: number;
  /** The first cell's projected centre, or `null` when the frame reported none. */
  readonly x: number | null;
  readonly medianHeightPx: number | null;
  readonly artFraction: number | null;
  /** The pixel witness; absent on a sweep that took none, `null` where unreadable. */
  readonly contrastDeltaE?: number | null;
}

export interface SpinSweepRecord {
  readonly periodS: number;
  readonly samples: number;
  readonly presented: number;
  readonly scorable: number;
  readonly travelPx: number;
  readonly atWorstPhaseS: number;
  readonly medianHeightPx: { readonly worst: number; readonly best: number };
  readonly artFraction: {
    readonly atWorstPhaseS: number;
    readonly worst: number | null;
    readonly best: number | null;
  };
  readonly contrastDeltaE?: {
    readonly atWorstPhaseS: number | null;
    readonly worst: number | null;
    readonly best: number | null;
  };
}

export declare function selectSpinPhases(
  phases: readonly SpinPhase[],
  options: { readonly periodS: number; readonly minTravelPx?: number },
):
  | {
      readonly ok: false;
      readonly reason: "spin-sweep-frozen" | "never-presented" | "no-settled-phase";
      readonly detail: string;
      readonly travelPx: number;
    }
  | {
      readonly ok: true;
      /** Index into `phases` of the phase W1 scores. */
      readonly w1Phase: number;
      /** Index into `phases` of the phase W4 scores — its own worst, not W1's. */
      readonly w4Phase: number;
      readonly sweep: SpinSweepRecord;
    };
export declare function sweepFrames<F>(
  frames: readonly F[],
  picked: { readonly w1Phase: number; readonly w4Phase: number },
):
  | { readonly ok: false; readonly reason: "no-settled-phase"; readonly detail: string }
  | { readonly ok: true; readonly frame: F; readonly w4Frame: F };
export declare function evaluateW2(samples: readonly CellSample[]): W2Criterion;
export declare function evaluateW3(
  samples: readonly CellSample[],
  bandShares: readonly number[],
): W3Criterion;
export declare function evictionRate(
  samples: readonly EvictionSample[],
  windowS?: number,
): number | null;
/**
 * How close the pool came to having no free layer, over the same timeline. `null` when no sample
 * carries occupancy — a pool never read and a pool holding nothing are different facts.
 */
export declare function poolHighWater(
  samples: readonly EvictionSample[],
): PoolHighWater | null;
export declare const SMALLEST_SHIPPED_POOL_LAYERS: number;
/**
 * Front-facing on-screen cells a frame must present before `artCellsShowing` is scored on it — the
 * term's domain, taken from the frame's **geometry** and never from `wanting`, which the policy
 * under test chooses. 13 of the 45 worlds on the shipped roster.
 */
export declare const W4_STARVATION_DOMAIN_CELLS: number;

/**
 * The pool capacity the absolute term's live falsifier runs at — the `?layers=24` matrix row
 * (DEC-890). Below `FLOORS.artCellsAbsolute` on purpose: a cell shows art by holding a layer, so
 * `showing <= pool.layers` on every frame and a pool under the floor cannot reach it however the
 * quantile is resolved.
 */
export declare const W4_STARVED_POOL_LAYERS: number;

/**
 * W4's eviction rate on the fill-excluded tail, with the tail's own convergence scored.
 *
 * `rate` is `null` — and `why` says which condition failed — when the timeline is too short, when
 * the plateau leaves too few samples behind it, or when the tail has not settled. Never a 0 standing
 * in for an absent reading.
 */
export interface EvictionTail {
  readonly rate: number | null;
  readonly halfRate: number | null;
  readonly drift: number | null;
  readonly converged: boolean;
  /** `max(resident)` — where the fill ended. Never "resident stopped climbing": a full pool churns. */
  readonly peakResident: number | null;
  /**
   * Did the pool ever have no free layer over this timeline? `null` when the timeline was too short
   * to ask. Read by `evaluateW4`'s occupancy domain rule (DEC-842): below saturation `claimLayer`
   * never reaches its victim search, so the rate is a structural 0 rather than a reading.
   */
  readonly saturated: boolean | null;
  /**
   * How far the cumulative counter moved across the tail. A count and not `rate > 0`, because `rate`
   * is `null` on an unconverged tail and "did the counter move at all" has to be answerable there:
   * a counter that moved is proof of saturation even where `resident` reads a layer light.
   */
  readonly evictionsObserved: number | null;
  readonly plateauT: number | null;
  readonly tailSamples: number;
  readonly spanS: number;
  readonly why: string | null;
}
export declare function evictionTail(
  samples: readonly EvictionSample[],
  options?: {
    readonly minTailSamples?: number;
    readonly minSpanS?: number;
    readonly convergence?: number;
  },
): EvictionTail;
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
export declare function budgetBoundAtEntry(stream: StreamReport): boolean;
/**
 * The same read taken at the **exit** of a visit: the eviction half's own domain (DEC-752, board
 * ruling `exit_domain`). A session that exhausted mid-visit was forbidden to admit by the time the
 * rate was taken, and a pool that cannot admit cannot evict, so the rate is 0 by construction rather
 * than by policy. Exit-side where `budgetBoundAtEntry` is entry-side, deliberately — giving
 * `artFraction` this rule would excuse the failure W4 exists to catch.
 */
export declare function budgetBoundAtExit(stream: StreamReport): boolean;
/**
 * `pool` is required on purpose: a W4 count without its capacity is not a reading of the renderer.
 * `entryStream` and `exitStream` are required for the same reason — defaulted, either would default
 * off a guard, and each guard off is a defect that has already been observed once.
 */
export declare function evaluateW4(
  cells: readonly ArtCell[],
  evictionTimeline: readonly EvictionSample[],
  pool: { readonly layers: number; readonly resident: number },
  entryStream: StreamReport,
  exitStream: StreamReport,
): W4Criterion;
/** The fields W4 needs off a `?probe=` stream report, at either end of a visit. */
export interface StreamReport {
  readonly swatchOnly: boolean;
  readonly bytesOutstanding: number;
  readonly bytesReserved: number;
  readonly byteBudget: number;
}
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

/** How far the scene turned going from `from` to `to`, folded onto [0, 2π). */
export declare function forwardAzimuthTravel(from: number, to: number): number;

/** Sample `k` of a `count`-azimuth comb is due at `travel` = k·2π/count from `first`. */
export declare function azimuthSweepTargets(
  first: number,
  count: number,
): { readonly travel: number; readonly azimuth: number }[];

export type AzimuthCombResult =
  | { readonly ok: true; readonly azimuths: number[] }
  | { readonly ok: false; readonly reason: "no-azimuth-seam" | "stalled"; readonly detail: string };

/** Steer a sweep closed-loop on the read-back angle; see the implementation for the contract. */
export declare function steerAzimuthComb(options: {
  readonly count: number;
  readonly readAzimuth: () => Promise<number | null>;
  readonly poll: () => Promise<void>;
  readonly onSample: (k: number, azimuth: number) => Promise<void> | void;
  readonly maxPollsPerStep: number;
}): Promise<AzimuthCombResult>;

export declare function evaluateW5(
  sweep: readonly W5AzimuthSample[],
  roster: Roster,
  options: W5Options,
): W5Criterion;

/**
 * The roster tour's own denominator, handed to the mean fold — see {@link foldCriteria}.
 *
 * `qualifying` is `null` when the run cannot say (a payload without band shares, or an older
 * `visits.json`); that half of the check is then skipped and the recorded `expected` still binds.
 */
export interface RosterDomain {
  readonly expected: Readonly<{ scored: number; byShares: number }> | null;
  readonly qualifying: number | null;
  /** What the expectation is a property of, named for the failure message: `dataset <hash>`. */
  readonly label: string;
}

/**
 * Fold one criterion measured on many planes into the roster's verdict: the worst plane, with
 * `insufficient` carried rather than counted as a pass — **except W3, whose fold is the mean**
 * (board ruling `fold_mean`, card `7d3653f6`).
 *
 * `rosterDomain` is read by mean-folded measures only. Pass it on a roster tour and omit it on a row
 * that toured one subject: a mean over one world is not a small roster mean, and the fold reports
 * `insufficient` rather than scoring it against the roster's floor.
 *
 * Returns `null` when no plane produced the criterion at all — an absent criterion is not a passing
 * one, and the caller reports that separately.
 */
export declare function foldCriteria(
  perPlane: ReadonlyArray<{
    readonly slug: string;
    readonly criterion: Criterion | null;
  }>,
  options?: { readonly rosterDomain?: RosterDomain | null },
): Criterion | null;

export declare function checkControlRow(
  criteria: readonly Criterion[],
  expectation: ControlExpectation,
): { readonly ok: boolean; readonly detail: string };
