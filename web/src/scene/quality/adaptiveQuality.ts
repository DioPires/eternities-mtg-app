/**
 * PRD 8.5.11's adaptive quality: "a frame-time monitor steps quality down after sustained drops,
 * in this order: pixel ratio cap 1.5 → 1.0, bloom resolution, thumbnail capacity. Geometry and
 * motion are never degraded. Quality steps back up after sustained headroom."
 *
 * Phase 2a owns the monitor and the first two steps. The thumbnail-capacity step belongs to Phase
 * 3 and is already in the ladder below with the capacity Phase 3 will read; the store slot that
 * shows the tier in the UI is Phase 4's (PRD 8.4.2), which is what {@link QualityMonitor.subscribe}
 * is for.
 *
 * Three rules keep this from becoming a flapping mess:
 *  - decisions come from a percentile over a window, not from single frames, so one slow frame
 *    during a fly-to never costs quality;
 *  - stepping up needs a longer, calmer window than stepping down, so the system settles;
 *  - a cooldown after every change stops the ladder from being climbed and descended in a second.
 *
 * "Geometry and motion are never degraded" is a structural promise here: nothing in the ladder can
 * reach the star count, the draw range, or `uMotion`.
 *
 * **The thresholds are relative to the display, not absolute.** What `sample` is fed is a frame
 * *interval*, and on a vsync-locked page that interval is a multiple of the display's refresh
 * period whatever the frame costs — so an absolute threshold measures the monitor rather than the
 * app. The two absolutes this shipped with (degrade above 20 ms, restore below 13.5 ms) were both
 * wrong for that reason: on a 60 Hz panel a *healthy* frame reports 16.7 ms, which is above the
 * restore threshold, so the ladder could only ever descend. See {@link refreshIntervalMs} for what
 * replaces them.
 *
 * **The 50 fps ceiling, and why neither constant is really what governs it (DEC-698 N1).** This
 * paragraph used to also say that 20 ms was PRD 7.2's 50 fps ceiling, so 50–59 fps was accepted as
 * fine — offered as a second defect the relative threshold repairs. It repairs no such thing, and
 * read as an average interval it is worse: `DEGRADE_FACTOR` of 1.45 on a 60 Hz period is 24.2 ms,
 * which is 41 fps against the old constant's 50.
 *
 * But an average interval is not a state a vsync-locked page occupies. On a 60 Hz panel a frame is
 * 16.7 ms or it is 33.3, and *both* thresholds sit in the gap between them, so on that panel the
 * old constant and the new factor decide identically — what actually moves the ladder is the
 * fraction of frames that doubled, and the only limb here is a p90. p90 crosses into the doubled
 * bucket at 10 % doubled, which is 60 / 1.1 ≈ 55 fps. So the band genuinely accepted on a locked
 * 60 Hz panel is about 55–59 fps, under either number, and it is a property of the p90 window
 * rather than of the constant.
 *
 * Where the two do differ is a page that is *not* vsync-locked — an offscreen or vsync-disabled
 * run, which is what the bench and the e2e smoke are — and there 24.2 ms is a real 41 fps and the
 * limb is the looser one. That is the accepted cost of the paragraph below: a threshold tight
 * enough to catch a sustained 50 fps also fires on the jitter of a locked run that is coping, and
 * measurably walked one down all three rungs. Do not tighten `DEGRADE_FACTOR` to recover the 50 fps
 * ceiling without re-running that bench — and do not expect tightening it to change anything on a
 * locked panel, because it will not.
 *
 * The review also wanted the converse caught — a 120 Hz panel dropping every second frame is still
 * only 60 fps. It is **not** caught here, deliberately: the estimate is capped at the 60 Hz period,
 * so a page sustaining 16.7 ms reads as a 60 Hz panel whatever the panel is. Catching that case
 * needs the refresh estimate to be a running *minimum*, which was tried and measured doing real
 * damage on an adaptive-refresh display — see {@link REFRESH_QUANTILE}. 60 fps is the floor the app
 * is judged against, so the trade lands on not degrading a machine that is meeting it.
 *
 * ---
 *
 * ## Audit against review §3.5 (DEC-739 item 3)
 *
 * DEC-739 asks for "an audit of what W1.1 (PR #36) already landed against the section 3.5 spec, and
 * only the gaps implemented". §3.5's sentence is:
 *
 * > The monitor measures the display's refresh (median rAF interval over 60 frames) and defines
 * > "fine" as p90 ≤ one vsync + 0.5 ms; degrade at p90 > 1.05 vsync over 1.5 s.
 *
 * Four clauses. Three were already landed and one was a gap:
 *
 * | Clause | State after W1.1 | DEC-739 |
 * |---|---|---|
 * | refresh from a 60-frame window | landed — {@link REFRESH_ESTIMATE_FRAMES} is 60 | kept |
 * | **median** of that window | **p20**, not the median | **closed**: {@link REFRESH_QUANTILE} is 0.5 |
 * | degrade window of 1.5 s | landed — `DEFAULTS.degradeWindowS` | kept |
 * | thresholds at 1.05 vsync / vsync + 0.5 ms | **deliberately diverged** — 1.45 and 1.20 | kept, see below |
 *
 * **The threshold divergence is kept, and this is the second time it has been examined.** W1.1
 * recorded two measured reasons and neither has expired. The first is arithmetic: "1.05 vsync" and
 * "one vsync + 0.5 ms" *invert* below a 10 ms period — at 120 Hz, 1.05 × 8.33 = 8.75 is under
 * 8.33 + 0.5 = 8.83 — so the same p90 would both degrade and restore on a panel the app supports.
 * The second is measurement: thresholds that close to the period fire on the jitter of a healthy
 * vsync-locked run, and a 1.05 trigger was observed walking a coping machine down all three rungs
 * (see {@link RESTORE_FACTOR}). Re-deriving the review's numbers would reintroduce both. What the
 * review was *asking* for — a band relative to the display rather than to a constant, ordered, with
 * a dead zone — is what is implemented; the constants differ and the reasons are measurements.
 *
 * Two further §3.5 items that touch this file are **out of scope here and named so they are not
 * mistaken for oversights**: `EXT_disjoint_timer_query_webgl2` per-pass GPU timing is described as a
 * bench facility rather than a monitor input, and belongs with `scripts/bench.mjs`; and the ladder's
 * *rungs* — including DEC-739's new tier 4 — are {@link QUALITY_TIERS}' business, not the monitor's.
 * The monitor's only relationship to the rung count is `maxTier`, which is derived from the ladder's
 * length and so took the fifth tier without an edit.
 */

import {
  BLOOM_LEVELS_FULL as FULL,
  BLOOM_LEVELS_REDUCED as REDUCED,
} from '../post/postTuning'

/**
 * How the plane glow's fragment shader is spelled at a given rung (DEC-739, review §3.5's "new 4:
 * a cheap glow variant (one tap, no dither)").
 *
 * `'full'` is PRD 5.3.19's two-tap drifting noise with the dither that keeps eighty-three additive
 * quads off the 8-bit contour rings. `'cheap'` drops to one tap and no dither, which is the second
 * largest item in review §3.3's frame budget after the post chain: the focused plane's glow quad
 * spans 4.2 plane radii, so at plane level it covers most of the screen, and §3.3 prices the
 * overdraw at 32 MB per frame on a 1080p Iris Xe against the post chain's ~360.
 *
 * A variant rather than a uniform, because the saving is the *texture tap* and the *hash*, and a
 * branch that skipped them per fragment would still pay for the register pressure and would defeat
 * the point on a driver that flattens it. Two programs, both linked at boot by `../platform/
 * programWarmup`, and the rung swaps which one the mesh is drawn with.
 */
export type GlowQuality = 'full' | 'cheap'

export interface QualityTier {
  /** PRD 7.1.3: the pixel-ratio cap is also what bounds the cost of a 4K display. */
  readonly pixelRatioCap: number
  /** Multiplier on the bloom's render resolution (PRD 8.5.5's half-resolution blur is 0.5). */
  readonly bloomScale: number
  /**
   * Mip levels the bloom's blur chain runs (DEC-703, review §3.5: "bloom source ½→¼ and 6→5
   * levels").
   *
   * The second rung used to be `bloomScale` alone, and `bloomScale` was inert (finding R3), so the
   * rung moved nothing. It now sizes the source *and* drops a level, which are the two quantities
   * the chain's cost is made of.
   */
  readonly bloomLevels: number
  /** PRD 8.5.8's default atlas capacity. Phase 3 reads it; Phase 2a only carries it. */
  readonly thumbnailCapacity: number
  /**
   * Layers the worlds art pool is *asked* for at this rung (worlds spec §1.12, DEC-751).
   *
   * **Asked for, not allocated.** The renderer runs this through
   * {@link ../worlds/artPool.artPoolSize}, which clamps it to `maxArrayTextureLayers - 32`; on a
   * WebGL 2 spec-minimum device that is 224 and the three top rungs all land there. Anything
   * asserting on the rung — `e2e/quality.spec.ts` above all — must read the value the renderer
   * reports, never this constant. See §1.12 and `artPool.ts`'s own note.
   */
  readonly artPoolLayers: number
  /** Which glow program this rung draws with (DEC-739). See {@link GlowQuality}. */
  readonly glow: GlowQuality
  readonly label: string
}

/**
 * Which knob each field belongs to — the ladder's invariant, as data (DEC-753's R-b, DEC-751).
 *
 * The invariant is **one knob per rung, not one field** (DEC-747 N3): a knob may move several
 * fields, but no two rungs may touch the same knob. Writing the grouping down here rather than
 * leaving it in prose is what lets `test/quality-ladder.test.ts` check it, and the check is not
 * decoration — the rung below this ladder's tier 3 was inert for a whole phase because
 * `bloomScale` moved alone, and the worlds plan would have made tier 3 inert again by stepping a
 * capacity the worlds path does not read.
 *
 * `label` is excluded deliberately: it names the rung, so it moves with whichever knob the rung
 * turns and carries no cost of its own.
 */
export const QUALITY_KNOBS: Readonly<Record<string, readonly (keyof QualityTier)[]>> = {
  'pixel-ratio': ['pixelRatioCap'],
  bloom: ['bloomScale', 'bloomLevels'],
  /**
   * One knob, two fields, for the same reason bloom is: this is the budget for *resident card
   * imagery*, and which field carries it is a function of which card path is live. The galaxy
   * spends it on PRD 8.5.8's thumbnail atlas; worlds retires that atlas (§1.12) and spends it on
   * the art pool. Until the cutover both paths ship, so the rung steps both — and after it, the
   * atlas field goes and the knob is unchanged.
   */
  'card-imagery': ['thumbnailCapacity', 'artPoolLayers'],
  glow: ['glow'],
}

/**
 * The ladder, top rung first. Each rung turns **exactly one knob** relative to the one above it,
 * which is what lets `e2e/quality.spec.ts` isolate a rung by comparing adjacent tiers.
 *
 * *One knob*, not one number (DEC-747 N3). Rung 2's knob is the bloom chain and it is two fields —
 * `bloomScale` 0.5 → 0.25 *and* `bloomLevels` 8 → 7 — because the chain's cost is the product of a
 * source size and a mip count, and moving only one of them is what made this rung inert before
 * (finding R3). The invariant the spec relies on is that no rung touches a knob another rung owns;
 * {@link QUALITY_KNOBS} is that grouping as data and `test/quality-ladder.test.ts` enforces it.
 *
 * Rung 3 is worlds' rung (§1.12, DEC-753's ruling). Its knob is the resident card-image budget, and
 * under worlds that is the art pool: **1,024 → 128 layers**, 48.00 → 6.00 MiB. Three things fix
 * that shape and none of them is taste:
 *
 *  - the pool may step at **exactly one rung** (DEC-753 R-b), so §1.12's original 1,024/1,024/512/
 *    256/128 column — which moved it at three — is not available;
 *  - the step has to clear the clamp, or the rung is inert on the only hardware that matters. WebGL
 *    2's spec minimum for `MAX_ARRAY_TEXTURE_LAYERS` is 256, so `artPoolSize` returns 224 for every
 *    request at or above it. A rung of 1,024 → 256 reads 224 → 224 there: the exact defect this
 *    rung was rewritten to remove, reintroduced on the device W0.1 is about to measure. 128 is
 *    below the clamp, so the rung is live on a spec-minimum device *and* on this Mac;
 *  - 128 is the pool size DEC-770's note N1 measured tier 4 against, so the gate's W4 expectation
 *    at the bottom of the ladder is a measurement of what ships rather than of a neighbouring
 *    configuration.
 *
 * The cost of one-rung-only is a cliff: a machine that walks to tier 3 loses seven eighths of its
 * art capacity in one step and most cells fall back to their swatch (§1.4's degraded shading path,
 * which is a real picture, not a black one). An intermediate pool size wants its own tier, and
 * DEC-753 rules that a tier addition is a separate change.
 *
 * Rung 4 is DEC-739's addition. Review §3.5 asked for it by name — "new 4: a cheap glow variant
 * (one tap, no dither) because glow overdraw is the second cost" — and it is the bottom of the
 * ladder because it is the first rung that changes the picture rather than its resolution: the
 * three above it all draw the same image at fewer pixels, and this one draws a different, flatter
 * nebula. A machine that has walked down to here is a machine that was not going to hold 60 fps
 * with the picture it asked for.
 *
 * Under worlds the same `glow` field also picks the atmosphere rim's variant (§1.7, §1.12): DEC-753
 * ruled that the cheap rim and the cheap glow are one quantity **if and only if one knob drives
 * both**, so the rim reads this field and does not get a switch of its own. A rim that needed
 * independent control would be a second knob and would need its own rung.
 */
export const QUALITY_TIERS: readonly QualityTier[] = [
  {
    pixelRatioCap: 1.5,
    bloomScale: 0.5,
    bloomLevels: FULL,
    thumbnailCapacity: 512,
    artPoolLayers: 1024,
    glow: 'full',
    label: 'full',
  },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.5,
    bloomLevels: FULL,
    thumbnailCapacity: 512,
    artPoolLayers: 1024,
    glow: 'full',
    label: 'pixel-ratio',
  },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.25,
    bloomLevels: REDUCED,
    thumbnailCapacity: 512,
    artPoolLayers: 1024,
    glow: 'full',
    label: 'bloom',
  },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.25,
    bloomLevels: REDUCED,
    thumbnailCapacity: 256,
    artPoolLayers: 128,
    glow: 'full',
    label: 'art-pool',
  },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.25,
    bloomLevels: REDUCED,
    thumbnailCapacity: 256,
    artPoolLayers: 128,
    glow: 'cheap',
    label: 'glow',
  },
]

export interface QualityMonitorOptions {
  /**
   * The display's refresh interval in milliseconds, when the caller knows it. Setting it stops the
   * monitor estimating one; capped at 60 Hz's period like every estimate is.
   *
   * Left unset the monitor starts at 60 Hz — the floor the app is held to — and re-estimates from
   * the cadence the frame intervals actually sustain. See {@link refreshIntervalMs}.
   */
  readonly refreshMs?: number
  /**
   * Absolute step-down threshold, overriding the one derived from the refresh interval. For tests
   * and for a caller that has measured its own budget; nothing in the app sets it.
   */
  readonly degradeMs?: number
  /** Absolute step-up threshold, overriding the derived one. See {@link degradeMs}. */
  readonly restoreMs?: number
  /** Seconds of sustained trouble before stepping down. */
  readonly degradeWindowS?: number
  /** Seconds of sustained headroom before stepping up. Longer, so the system settles. */
  readonly restoreWindowS?: number
  /** Seconds after any change during which no further change is considered. */
  readonly cooldownS?: number
  /**
   * Frames longer than this are dropped, not counted. A tab returning to the foreground, a shard
   * decoding, or the debugger pausing are not evidence about rendering cost.
   */
  readonly outlierMs?: number
  /** Highest tier the monitor may use. Phase 6's forced-degradation check pins this. */
  readonly maxTier?: number
  /**
   * Lowest tier the monitor may use. Setting it equal to `maxTier` pins the ladder, which is what
   * PRD 9.1.4's forced degradation needs: on the reference machine the p90 sits far under the
   * restore threshold, so a tier that is merely *set* climbs back to `full` within
   * `restoreWindowS` and there is nothing left to look at. See {@link pinnedQualityTier}.
   */
  readonly minTier?: number
}

const DEFAULTS = {
  degradeWindowS: 1.5,
  restoreWindowS: 5,
  cooldownS: 2,
  outlierMs: 250,
} as const

/** Frames held in the rolling window. 4 s at 120 fps, which covers the longest window above. */
const WINDOW = 512

/**
 * The refresh interval assumed until one is observed or supplied: the owner's 60 fps floor.
 *
 * Also the ceiling on the estimate. A panel slower than 60 Hz would make every threshold looser
 * than the floor the app is judged against, so the monitor declines to learn one — on such a panel
 * it holds the app to 60 fps and will sit at a lower tier, which is the honest outcome.
 */
export const DEFAULT_REFRESH_MS = 1000 / 60

/**
 * The plausible display periods the estimate snaps to, fastest first: 120, 100, 90, 75, 60 Hz.
 *
 * Snapping is what keeps the estimate off the jitter: an observed 8.30 ms reads as the 8.33 ms
 * period it came from rather than as a period no panel has.
 */
const REFRESH_PERIODS_MS = [1000 / 120, 1000 / 100, 1000 / 90, 1000 / 75, DEFAULT_REFRESH_MS]

/**
 * The quantile of the rolling window taken as the display's cadence, and how often to re-take it.
 *
 * **Not the minimum, which is what this replaced and which was wrong on real hardware.** The
 * argument for a running minimum is seductive — a vsync-locked interval can never be shorter than
 * the period, so the shortest frame seen bounds it from above and no fast frame can make the
 * monitor lenient. It fails on an adaptive-refresh panel, where there is no single period.
 * Measured on the review machine (Chrome, `--use-angle=metal`, 1920×1080): rAF intervals min
 * 11.4 ms, median 13.3, p90 13.8 — the minimum snaps to the 90 Hz period at 11.11 while the panel
 * actually sustains 75 Hz, so `restore` lands at 1.2 × 11.11 = 13.33 ms, *below* the p90 of a
 * perfectly healthy run. The ladder could then descend and never climb back: exactly the one-way
 * ratchet R5 exists to remove, moved from 60 Hz to 90. It was observed doing it — a probe run
 * finished pinned at the bottom `thumbnails` tier on an idle machine.
 *
 * A quantile of the window tracks the cadence the browser is *sustaining* instead, and is let to
 * move in both directions. The direction that would be dangerous — trouble inflating the estimate
 * until the monitor stops caring — is bounded by {@link DEFAULT_REFRESH_MS}: the loosest band
 * reachable is the one derived from 60 Hz, which is the floor the app is held to anyway.
 *
 * The cost of that bound: a 120 Hz panel locked to exactly 60 fps reads as a 60 Hz panel and is
 * accepted. The review named that as a case worth catching, and catching it requires the minimum,
 * which is measurably harmful here. Meeting the 60 fps floor is the stated contract, so this errs
 * towards not degrading a machine that is meeting it.
 *
 * **The median, since DEC-739, and it was a p20 before.** Review §3.5 says the refresh is "the
 * median rAF interval over 60 frames"; DEC-692 implemented the *shape* of that — a quantile of a
 * 60-frame window, snapped — but took the 20th percentile rather than the 50th. Nothing in DEC-692's
 * reasoning argues for 20 specifically: the argument it records is the one above, minimum versus
 * quantile, and a p20 is the *closer* of the two to the minimum it was chosen to get away from. So
 * this is now the median the review asked for.
 *
 * On the distribution the harm was measured against, the change moves nothing: the review machine's
 * rAF intervals were min 11.4 ms, median 13.3, p90 13.8, and both 13.0 (p20) and 13.3 (median) snap
 * to the same 13.33 ms 75 Hz period. What it buys is margin in the safe direction — the median can
 * only ever sit *above* the p20, so the band can only ever be looser, and "looser" is the direction
 * bounded by the 60 Hz cap while "tighter" is the direction that ratcheted a healthy machine to the
 * bottom tier.
 */
const REFRESH_QUANTILE = 0.5
const REFRESH_ESTIMATE_FRAMES = 60

/** Tolerance on the snap, so a 8.30 ms interval reads as the 8.33 ms period it came from. */
const SNAP_TOLERANCE = 0.98

/**
 * Both thresholds are multiples of the refresh period, and both sit between "one vsync with
 * jitter" and "two vsyncs".
 *
 * The tempting reading of the review's wording — "fine at p90 ≤ one vsync + 0.5 ms, degrade above
 * 1.05 vsync" — is wrong twice. It inverts below a 10 ms period (1.05 × 8.33 = 8.75 is *under*
 * 8.33 + 0.5 = 8.83), so the same p90 would both degrade and restore on a 120 Hz panel. And it
 * assumes the intervals are cleanly quantised to multiples of the period, which they are not: a
 * healthy vsync-locked run jitters a couple of milliseconds above the period, and thresholds that
 * close to it fire on the jitter. Measured: the e2e bench smoke on a SwiftShader runner throttled
 * to 60 Hz reports p50 16.9 ms and p95 19.1 ms while keeping up, and a 1.05 or a "+1.5 ms" trigger
 * walked it down all three rungs for nothing.
 *
 * So: **1.20 × the period to restore, 1.45 × to degrade.** On 60 Hz that is 20.0 and 24.2 ms, both
 * clear of the jitter and both well under two refreshes at 33.3; on 120 Hz, 10.0 and 12.1 against
 * a second refresh at 16.7. Ordered at every period, with a dead band between them so the ladder
 * settles. What it costs is that up to about a twentieth of the frames may double before the
 * monitor calls it trouble — the price of not degrading a machine that is in fact fine.
 */
const RESTORE_FACTOR = 1.2
const DEGRADE_FACTOR = 1.45

/**
 * Round an observed frame interval up to the nearest real display period, and never past 60 Hz.
 *
 * The clamp is the safety property: whatever the page reports, the widest band this can produce is
 * the 60 Hz one. See {@link REFRESH_QUANTILE}.
 */
function snapRefresh(observedMs: number): number {
  for (const period of REFRESH_PERIODS_MS) {
    if (period >= observedMs * SNAP_TOLERANCE) return period
  }
  return DEFAULT_REFRESH_MS
}

/** Step down above this p90. Exported so the bench and the probe can report the band in force. */
export function degradeThresholdMs(refreshMs: number): number {
  return refreshMs * DEGRADE_FACTOR
}

/** Step up below this p90. */
export function restoreThresholdMs(refreshMs: number): number {
  return refreshMs * RESTORE_FACTOR
}

/** Round a tier index to an integer inside the ladder. Everything that sets a tier goes through it. */
function inLadder(index: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.max(0, Math.min(QUALITY_TIERS.length - 1, Math.round(index)))
}

/**
 * `?quality=N` pins the ladder at tier N for PRD 9.1.4's forced-degradation check, and `?quality=`
 * anything else is ignored so a typo degrades nothing.
 *
 * Pinning, not nudging: see {@link QualityMonitorOptions.minTier}.
 */
export function pinnedQualityTier(
  search = typeof location === 'undefined' ? '' : location.search,
): number | null {
  const value = new URLSearchParams(search).get('quality')
  if (value === null || !/^\d+$/.test(value)) return null
  const index = Number(value)
  return index < QUALITY_TIERS.length ? index : null
}

/** The monitor options that pin a tier, or `{}` when nothing is pinned. */
export function pinnedQualityOptions(pin: number | null): QualityMonitorOptions {
  return pin === null ? {} : { minTier: pin, maxTier: pin }
}

/**
 * The monitor's options for a `?quality=` pin layered over the post chain's capability floor
 * (DEC-703; `../post/capabilities`, review §3.7).
 *
 * `floor` is the best tier index the chain will honour on this GPU — 0 unless
 * `EXT_color_buffer_float` is missing, in which case the bloom source is 8-bit and claiming `full`
 * would be a lie. It becomes the monitor's `minTier`, so the free ladder starts there and can never
 * climb above it.
 *
 * **A pin beats the floor.** PRD 9.1.4's `?quality=N` is an explicit override whose whole job is to
 * name a tier and hold it; a floor that silently moved it would make the forced-degradation check
 * assert against a tier nobody asked for, and `e2e/quality.spec.ts` pins all four in turn. The
 * capability cap is about what the *adaptive* ladder may choose for a user who is choosing nothing.
 */
export function qualityOptionsFor(pin: number | null, floor: number): QualityMonitorOptions {
  if (pin !== null) return pinnedQualityOptions(pin)
  return floor > 0 ? { minTier: floor } : {}
}

/** Everything the monitor needs a value for; the thresholds are derived, not defaulted. */
type ResolvedOptions = Required<Omit<QualityMonitorOptions, 'refreshMs' | 'degradeMs' | 'restoreMs'>>

export class QualityMonitor {
  private readonly options: ResolvedOptions
  /** Set only when the caller supplied an absolute threshold; otherwise the refresh derives it. */
  private readonly degradeOverrideMs: number | undefined
  private readonly restoreOverrideMs: number | undefined
  /** Ring buffer of frame times, in milliseconds. Never grows, never allocates (PRD 7.3.2). */
  private readonly samples = new Float32Array(WINDOW)
  private readonly scratch = new Float32Array(WINDOW)
  private count = 0
  private next = 0
  private elapsed = 0
  private cooldown = 0
  private tierIndex = 0
  private refreshMs = DEFAULT_REFRESH_MS
  /** Set when the caller supplied a refresh interval, which then stands and is never estimated. */
  private readonly refreshFixed: boolean
  /** Frames since the cadence was last re-taken; the estimate is amortised, not per-frame. */
  private sinceRefreshEstimate = 0
  private readonly listeners = new Set<(tier: QualityTier, index: number) => void>()

  constructor(options: QualityMonitorOptions = {}) {
    // Bound both ends into the ladder first, then let `minTier` win a contradiction: a caller that
    // pins a tier has asked for that tier, and silently handing back a better one would make the
    // forced-degradation check pass against undegraded output.
    const minTier = inLadder(options.minTier ?? 0)
    const maxTier = Math.max(inLadder(options.maxTier ?? QUALITY_TIERS.length - 1), minTier)
    this.options = {
      ...DEFAULTS,
      ...Object.fromEntries(
        Object.entries(options).filter(
          ([key, value]) =>
            value !== undefined && key !== 'refreshMs' && key !== 'degradeMs' && key !== 'restoreMs',
        ),
      ),
      minTier,
      maxTier,
    }
    this.degradeOverrideMs = options.degradeMs
    this.restoreOverrideMs = options.restoreMs
    this.refreshFixed = options.refreshMs !== undefined && options.refreshMs > 0
    if (this.refreshFixed) {
      this.refreshMs = Math.min(options.refreshMs!, DEFAULT_REFRESH_MS)
    }
    this.tierIndex = minTier
  }

  /**
   * The refresh interval every threshold is measured against, in milliseconds.
   *
   * Starts at {@link DEFAULT_REFRESH_MS} and is re-taken from a low quantile of the rolling window
   * (see {@link REFRESH_QUANTILE}), snapped to a real refresh rate (see {@link REFRESH_PERIODS_MS})
   * so jitter cannot move it, and never allowed above the 60 Hz period.
   *
   * The blind spot is a page in trouble on a panel faster than 60 Hz: its sustained cadence is the
   * trouble, so the estimate rises to the 60 Hz cap and the monitor holds the app to 60 fps rather
   * than to the panel. That is the safe direction, and 60 fps is the floor the app is judged
   * against in any case.
   */
  get refreshIntervalMs(): number {
    return this.refreshMs
  }

  /** The p90 band in force, for the bench and the `?probe=1` seam. */
  get thresholdsMs(): { readonly degrade: number; readonly restore: number } {
    return {
      degrade: this.degradeOverrideMs ?? degradeThresholdMs(this.refreshMs),
      restore: this.restoreOverrideMs ?? restoreThresholdMs(this.refreshMs),
    }
  }

  get tier(): QualityTier {
    return QUALITY_TIERS[this.tierIndex]!
  }

  get index(): number {
    return this.tierIndex
  }

  subscribe(listener: (tier: QualityTier, index: number) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Pin the tier, for the forced-degradation verification of PRD 8.5.11 (Phase 6). */
  setTier(index: number): void {
    const clamped = this.clamp(index)
    if (clamped === this.tierIndex) return
    this.tierIndex = clamped
    this.reset()
    for (const listener of this.listeners) listener(this.tier, this.tierIndex)
  }

  /**
   * Feed one frame. Returns the tier if it changed this frame, otherwise `null`.
   *
   * Costs one array write and, at most once per window's worth of frames, one partial sort of a
   * preallocated scratch buffer.
   */
  sample(frameMs: number): QualityTier | null {
    if (frameMs <= 0 || frameMs > this.options.outlierMs) return null

    this.samples[this.next] = frameMs
    this.next = (this.next + 1) % WINDOW
    if (this.count < WINDOW) this.count += 1
    this.elapsed += frameMs / 1000

    // The display's cadence, re-taken from a low quantile of the window every so often. Deliberately
    // outside `reset`: it is a property of the monitor the page is on, not evidence about a tier,
    // so a tier change must not throw it away. See `REFRESH_QUANTILE` for why this is a quantile
    // rather than the running minimum it replaced.
    this.sinceRefreshEstimate += 1
    if (
      !this.refreshFixed &&
      this.count >= REFRESH_ESTIMATE_FRAMES &&
      this.sinceRefreshEstimate >= REFRESH_ESTIMATE_FRAMES
    ) {
      this.sinceRefreshEstimate = 0
      this.refreshMs = snapRefresh(this.percentile(REFRESH_ESTIMATE_FRAMES, REFRESH_QUANTILE))
    }

    if (this.cooldown > 0) {
      this.cooldown -= frameMs / 1000
      return null
    }

    const degrade = this.degradeOverrideMs ?? degradeThresholdMs(this.refreshMs)
    const degradeFrames = this.framesFor(this.options.degradeWindowS, frameMs)
    if (this.tierIndex < this.options.maxTier && this.count >= degradeFrames) {
      if (this.percentile(degradeFrames, 0.9) > degrade) {
        return this.step(1)
      }
    }

    const restore = this.restoreOverrideMs ?? restoreThresholdMs(this.refreshMs)
    const restoreFrames = this.framesFor(this.options.restoreWindowS, frameMs)
    if (this.tierIndex > this.options.minTier && this.count >= restoreFrames) {
      if (this.percentile(restoreFrames, 0.9) < restore) {
        return this.step(-1)
      }
    }
    return null
  }

  /** How many of the most recent frames cover `seconds`, given roughly this frame's cost. */
  private framesFor(seconds: number, frameMs: number): number {
    return Math.min(WINDOW, Math.max(20, Math.ceil((seconds * 1000) / frameMs)))
  }

  private percentile(frames: number, quantile: number): number {
    const n = Math.min(frames, this.count)
    for (let i = 0; i < n; i += 1) {
      this.scratch[i] = this.samples[(this.next - 1 - i + WINDOW * 2) % WINDOW]!
    }
    const view = this.scratch.subarray(0, n)
    view.sort()
    return view[Math.min(n - 1, Math.floor(quantile * n))]!
  }

  private clamp(index: number): number {
    return Math.max(this.options.minTier, Math.min(this.options.maxTier, index))
  }

  private step(direction: 1 | -1): QualityTier {
    this.tierIndex = this.clamp(this.tierIndex + direction)
    this.cooldown = this.options.cooldownS
    this.reset()
    for (const listener of this.listeners) listener(this.tier, this.tierIndex)
    return this.tier
  }

  /** Evidence gathered at one quality level says nothing about the next one. */
  private reset(): void {
    this.count = 0
    this.next = 0
  }

  /** Seconds of frames seen. The bench reports against it; nothing in the ladder uses it. */
  get elapsedSeconds(): number {
    return this.elapsed
  }
}
