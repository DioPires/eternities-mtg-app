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
 */

import {
  BLOOM_LEVELS_FULL as FULL,
  BLOOM_LEVELS_REDUCED as REDUCED,
} from '../post/postTuning'

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
  readonly label: string
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { pixelRatioCap: 1.5, bloomScale: 0.5, bloomLevels: FULL, thumbnailCapacity: 512, label: 'full' },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.5,
    bloomLevels: FULL,
    thumbnailCapacity: 512,
    label: 'pixel-ratio',
  },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.25,
    bloomLevels: REDUCED,
    thumbnailCapacity: 512,
    label: 'bloom',
  },
  {
    pixelRatioCap: 1.0,
    bloomScale: 0.25,
    bloomLevels: REDUCED,
    thumbnailCapacity: 256,
    label: 'thumbnails',
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
 * A low quantile of the window tracks the cadence the browser is *sustaining* instead, and is let
 * to move in both directions. The direction that would be dangerous — trouble inflating the
 * estimate until the monitor stops caring — is bounded by {@link DEFAULT_REFRESH_MS}: the loosest
 * band reachable is the one derived from 60 Hz, which is the floor the app is held to anyway.
 *
 * The cost of that bound: a 120 Hz panel locked to exactly 60 fps reads as a 60 Hz panel and is
 * accepted. The review named that as a case worth catching, and catching it requires the minimum,
 * which is measurably harmful here. Meeting the 60 fps floor is the stated contract, so this errs
 * towards not degrading a machine that is meeting it.
 */
const REFRESH_QUANTILE = 0.2
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
