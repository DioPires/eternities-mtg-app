/**
 * The per-frame art threshold (spec §1.6) — this spec's one substantive change to the prototype.
 *
 * The prototype asks for art whenever a cell exceeds 24 CSS px and lets the pool run out. The
 * measured consequence at `tether-surface` is **1,024 drawn against 2,759 wanted, with 925
 * evictions**: the visible swatch/art boundary in that frame is the budget being exhausted, and the
 * churn behind it is ~1,900 `art_crop` fetches — roughly 170 MB — for one camera pose.
 *
 * > **Normative.** The effective threshold is a **per-frame quantile**, not a constant. Maintain a
 * > 64-bucket histogram of the on-screen pixel heights of wanting cells (one pass, no sort). If the
 * > count above 24 px exceeds the pool capacity, raise the effective threshold to the bucket at
 * > which the running count crosses capacity, with one bucket of hysteresis so the boundary does
 * > not oscillate. The result is the same picture — a ring of art around the sub-camera point —
 * > reached by design rather than by exhaustion, with a bounded fetch count and near-zero
 * > steady-state eviction. Acceptance criterion **W4** (§3.1) measures exactly this.
 */

/** The prototype's constant, which is still the floor the quantile starts from (§1.6). */
export const BASE_THRESHOLD_PX = 24

/** §1.6's bucket count. */
const BUCKETS = 64

/**
 * The top of the histogram's range, in CSS px.
 *
 * The buckets are **geometric**, not linear, because the quantity is not: a cell's on-screen height
 * runs from the 24 px floor to most of the viewport as the camera closes on a surface, and a linear
 * span fine enough to separate 24 from 30 px saturates its top bucket long before the near view.
 * Geometric buckets hold a constant ~7.8% per step across the whole range, so the threshold's
 * quantisation error is proportional to the threshold — which is the behaviour a quantile wants.
 * 3,072 px is taller than a 4K viewport, so the top bucket is unreachable rather than merely large.
 */
const TOP_PX = 3072

const RATIO = Math.pow(TOP_PX / BASE_THRESHOLD_PX, 1 / BUCKETS)
const LOG_RATIO = Math.log(RATIO)

/** The lower edge of bucket `index`, in CSS px. Bucket 0's edge is exactly {@link BASE_THRESHOLD_PX}. */
export function bucketEdgePx(index: number): number {
  return BASE_THRESHOLD_PX * Math.pow(RATIO, index)
}

/** The bucket a height falls in; heights below the floor are not wanting cells and return -1. */
export function bucketOf(heightPx: number): number {
  if (!(heightPx >= BASE_THRESHOLD_PX)) return -1
  const index = Math.floor(Math.log(heightPx / BASE_THRESHOLD_PX) / LOG_RATIO)
  return index >= BUCKETS ? BUCKETS - 1 : index
}

/** What the probe reports each frame, and what §3.1's W4 row and its control read. */
export interface ThresholdReport {
  /**
   * The threshold actually in force this frame.
   *
   * > **Normative — the seam reports itself engaged (§1.6, DEC-752).** Under
   * > `?artThreshold=fixed24` this reads **exactly 24**, and the gate asserts that before it reads
   * > W4's criterion. Under the quantile it reads the bucket edge the histogram chose, which is
   * > quantised and is not 24 except by coincidence. Without the read-back, a seam that silently
   * > fails to parse its own query parameter runs the *unmodified* policy, W4 passes, and the
   * > matrix records a passing control.
   */
  readonly effectiveThresholdPx: number
  /** Cells over {@link BASE_THRESHOLD_PX} this frame — the demand, before the quantile trims it. */
  readonly wanting: number
  /** Cells over {@link ThresholdReport.effectiveThresholdPx} — what the frame will actually ask for. */
  readonly admitted: number
  /** False under `?artThreshold=fixed24`. The gate checks this moved. */
  readonly adaptive: boolean
}

/**
 * The histogram and the hysteresis, across frames.
 *
 * > **Normative — the control has to starve the *policy*, not the resource (§1.6).** Shrinking the
 * > pool does not work as W4's negative control: the threshold is defined *relative to pool
 * > capacity*, so a smaller pool simply raises the threshold and the criterion passes. This is why
 * > `?artThreshold=fixed24` exists as a seam in the shipped renderer rather than as a patched
 * > build — W4's whole subject is the *absence* of exhaustion, and the only frame known to exhaust
 * > is the prototype's `tether-surface`.
 */
export class AdaptiveThreshold {
  private readonly histogram = new Int32Array(BUCKETS)
  /** The bucket whose lower edge is the threshold in force. 0 means the 24 px floor. */
  private bucket = 0
  private wanting = 0
  private admitted = 0

  /** `false` under the `?artThreshold=fixed24` seam: constant 24, no histogram, no hysteresis. */
  constructor(readonly adaptive = true) {}

  /** Start a frame's pass. One `fill` over 64 words; there is no sort anywhere in this class. */
  begin(): void {
    this.histogram.fill(0)
    this.wanting = 0
  }

  /** Offer one cell's on-screen height. Cells under the floor are not counted as wanting. */
  offer(heightPx: number): void {
    const index = bucketOf(heightPx)
    if (index < 0) return
    this.histogram[index]! += 1
    this.wanting += 1
  }

  /**
   * Close the pass and pick the threshold for `capacity` layers.
   *
   * Counts down from the tallest bucket until admitting one more would exceed capacity; the
   * threshold is the lower edge of the last bucket that fit. A capacity that covers every wanting
   * cell leaves the threshold at the 24 px floor, which is the ordinary case away from a surface.
   */
  end(capacity: number): ThresholdReport {
    if (!this.adaptive) {
      // The prototype exactly: everything over 24 asks, and the pool runs out.
      this.bucket = 0
      this.admitted = this.wanting
      return this.report()
    }
    let running = 0
    let chosen = 0
    for (let index = BUCKETS - 1; index >= 0; index -= 1) {
      if (running + this.histogram[index]! > capacity) {
        chosen = index + 1
        break
      }
      running += this.histogram[index]!
    }
    this.bucket = this.applyHysteresis(chosen)
    this.admitted = this.countAtOrAbove(this.bucket)
    return this.report()
  }

  /**
   * One bucket of hysteresis, and it is **one-sided on purpose**.
   *
   * Raising is immediate, because capacity is a hard bound and a frame that admits more cells than
   * the pool holds is the exhaustion this whole mechanism removes. Lowering waits until the
   * histogram has moved clear by more than a single bucket, which is what stops the boundary
   * oscillating between two adjacent edges as the camera drifts — a ring of art flickering one cell
   * wide is more obviously wrong than a ring one cell too small.
   */
  private applyHysteresis(chosen: number): number {
    if (chosen > this.bucket) return chosen
    if (chosen < this.bucket - 1) return chosen
    return this.bucket
  }

  private countAtOrAbove(bucket: number): number {
    let total = 0
    for (let index = bucket; index < BUCKETS; index += 1) total += this.histogram[index]!
    return total
  }

  private report(): ThresholdReport {
    return {
      effectiveThresholdPx: this.adaptive ? bucketEdgePx(this.bucket) : BASE_THRESHOLD_PX,
      wanting: this.wanting,
      admitted: this.admitted,
      adaptive: this.adaptive,
    }
  }
}
