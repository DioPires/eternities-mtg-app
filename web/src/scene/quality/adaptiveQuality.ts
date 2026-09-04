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
 */

export interface QualityTier {
  /** PRD 7.1.3: the pixel-ratio cap is also what bounds the cost of a 4K display. */
  readonly pixelRatioCap: number
  /** Multiplier on the bloom's render resolution (PRD 8.5.5's half-resolution blur is 0.5). */
  readonly bloomScale: number
  /** PRD 8.5.8's default atlas capacity. Phase 3 reads it; Phase 2a only carries it. */
  readonly thumbnailCapacity: number
  readonly label: string
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { pixelRatioCap: 1.5, bloomScale: 0.5, thumbnailCapacity: 512, label: 'full' },
  { pixelRatioCap: 1.0, bloomScale: 0.5, thumbnailCapacity: 512, label: 'pixel-ratio' },
  { pixelRatioCap: 1.0, bloomScale: 0.25, thumbnailCapacity: 512, label: 'bloom' },
  { pixelRatioCap: 1.0, bloomScale: 0.25, thumbnailCapacity: 256, label: 'thumbnails' },
]

export interface QualityMonitorOptions {
  /** Step down when the window's p90 frame time exceeds this. Default 20 ms — PRD 7.2's 50 fps. */
  readonly degradeMs?: number
  /** Step up when the window's p90 is under this. Default 13.5 ms, comfortably inside 60 fps. */
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
}

const DEFAULTS = {
  degradeMs: 20,
  restoreMs: 13.5,
  degradeWindowS: 1.5,
  restoreWindowS: 5,
  cooldownS: 2,
  outlierMs: 250,
} as const

/** Frames held in the rolling window. 4 s at 120 fps, which covers the longest window above. */
const WINDOW = 512

export class QualityMonitor {
  private readonly options: Required<Omit<QualityMonitorOptions, 'maxTier'>> & { maxTier: number }
  /** Ring buffer of frame times, in milliseconds. Never grows, never allocates (PRD 7.3.2). */
  private readonly samples = new Float32Array(WINDOW)
  private readonly scratch = new Float32Array(WINDOW)
  private count = 0
  private next = 0
  private elapsed = 0
  private cooldown = 0
  private tierIndex = 0
  private readonly listeners = new Set<(tier: QualityTier, index: number) => void>()

  constructor(options: QualityMonitorOptions = {}) {
    this.options = {
      ...DEFAULTS,
      maxTier: QUALITY_TIERS.length - 1,
      ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
    } as Required<Omit<QualityMonitorOptions, 'maxTier'>> & { maxTier: number }
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
    const clamped = Math.max(0, Math.min(this.options.maxTier, index))
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

    if (this.cooldown > 0) {
      this.cooldown -= frameMs / 1000
      return null
    }

    const degradeFrames = this.framesFor(this.options.degradeWindowS, frameMs)
    if (this.tierIndex < this.options.maxTier && this.count >= degradeFrames) {
      if (this.percentile(degradeFrames, 0.9) > this.options.degradeMs) {
        return this.step(1)
      }
    }

    const restoreFrames = this.framesFor(this.options.restoreWindowS, frameMs)
    if (this.tierIndex > 0 && this.count >= restoreFrames) {
      if (this.percentile(restoreFrames, 0.9) < this.options.restoreMs) {
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

  private step(direction: 1 | -1): QualityTier {
    this.tierIndex = Math.max(0, Math.min(this.options.maxTier, this.tierIndex + direction))
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
