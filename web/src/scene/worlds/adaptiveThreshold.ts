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
 * One subject's cross-frame threshold state — the hysteresis, and nothing else.
 *
 * > **Normative — the hysteresis is per-subject (§1.6, DEC-768 F2).** §1.12 budgets **one** art
 * > pool for the whole roster, and {@link AdaptiveThreshold} is shared with it because the
 * > histogram is per-frame scratch and the quantile is taken against that one pool's capacity. The
 * > *hysteresis* is neither: "the boundary must not oscillate" is a statement about **this world's
 * > previous frame**, and a roster of 45 surfaces running through one shared bucket makes it a
 * > statement about *the previous surface* instead. Measured on the shipped roster before this type
 * > existed — `zendikar` alternating between 2.18 and 2.20 world-radii at 224 layers, where the raw
 * > quantile moves one bucket every frame: alone on the roster it held at
 * > `44.02 47.48 47.48 47.48 …`, and on the full 45 it oscillated `44.02 47.48 44.02 47.48 …` —
 * > the ring of art flickering one cell wide that the hold branch is declared normative to remove.
 * > A roster of 45 always has a preceding world, so the second row was what always happened. The
 * > mechanism was present, normative, and inert.
 *
 * It is a required argument of {@link AdaptiveThreshold.end} rather than a field with a default,
 * so that sharing one is a thing a caller has to *write* rather than a thing it gets by omission.
 */
export class ThresholdMemory {
  /**
   * The bucket whose lower edge was the threshold in force for this subject last frame. 0 is the
   * 24 px floor, which is also the right starting value: a world that has never been measured has
   * no raised boundary to hold.
   */
  bucket = 0
}

/**
 * The histogram, and the quantile taken over it.
 *
 * Shared across the roster (§1.12's one pool, one policy); the per-frame fields below are written
 * and read within a single {@link AdaptiveThreshold.begin}/{@link AdaptiveThreshold.end} pair and
 * handed out as a fresh {@link ThresholdReport}, so nothing here survives into another subject's
 * pass. The one thing that has to is {@link ThresholdMemory}, and it lives on the subject.
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
   * Close the pass and pick the threshold for `capacity` layers, against `memory`'s previous frame.
   *
   * Counts down from the tallest bucket until admitting one more would exceed capacity; the
   * threshold is the lower edge of the last bucket that fit. A capacity that covers every wanting
   * cell leaves the threshold at the 24 px floor, which is the ordinary case away from a surface.
   *
   * > **Normative — a pool with demand in front of it is never left idle (§1.6, DEC-768 F1).** The
   * > last bucket that fit is one bucket *above* the one the running count crosses at, and §1.6
   * > says the crossing one. The two agree everywhere except the case where the crossing bucket is
   * > the **first non-empty one** — where "the last that fit" is a bucket nothing is in, so the
   * > frame admits **nothing at all** and every layer of the pool sits idle in front of a world
   * > that wants art. Measured before this branch existed: `dominaria` at 2.2 world-radii, tier 4's
   * > 128 layers, 922 wanting cells in buckets 0–3 (185/299/280/158) — bucket 3 alone exceeds 128,
   * > the threshold jumped to 32.50 px and **0** of 128 layers were used. The same world at 1.8
   * > radii wanted 961 and admitted 0 as well; they were the only two poses of ninety in that sweep
   * > that did. That is strictly worse than the `fixed24` prototype this quantile replaces, at the
   * > pose §3.1 states W4 at.
   * >
   * > So the crossing bucket is taken whenever the bucket above it would admit nothing, and the
   * > overshoot — at most that one bucket's own count, 158 against 128 above — is left to the
   * > pool's LRU. A frame that asks for 1.2 pools is a frame with one round of eviction in it; a
   * > frame that asks for nothing is a world with no art on it at all.
   */
  end(capacity: number, memory: ThresholdMemory): ThresholdReport {
    if (!this.adaptive) {
      // The prototype exactly: everything over 24 asks, and the pool runs out.
      memory.bucket = 0
      this.admitted = this.wanting
      return this.report(memory.bucket)
    }
    let running = 0
    let chosen = 0
    for (let index = BUCKETS - 1; index >= 0; index -= 1) {
      if (running + this.histogram[index]! > capacity) {
        // `running === 0` is the whole of the case above: nothing above `index` fit, so `index + 1`
        // is empty by construction. A zero-layer pool is excluded because it is *legal* there —
        // §1.6 makes a pool of no layers a swatch-only world, and it must admit nothing.
        chosen = running === 0 && capacity > 0 ? index : index + 1
        break
      }
      running += this.histogram[index]!
    }
    memory.bucket = this.applyHysteresis(chosen, memory.bucket, capacity)
    this.admitted = this.countAtOrAbove(memory.bucket)
    return this.report(memory.bucket)
  }

  /**
   * One bucket of hysteresis, and it is **one-sided on purpose**.
   *
   * Raising is immediate, because capacity is a hard bound and a frame that admits more cells than
   * the pool holds is the exhaustion this whole mechanism removes. Lowering waits until the
   * histogram has moved clear by more than a single bucket, which is what stops the boundary
   * oscillating between two adjacent edges as the camera drifts — a ring of art flickering one cell
   * wide is more obviously wrong than a ring one cell too small.
   *
   * `previous` is {@link ThresholdMemory.bucket}, this subject's own last frame. See that type: on
   * the shipped roster it used to be *the previous surface's*, which made the hold branch below
   * unreachable in the product.
   */
  private applyHysteresis(chosen: number, previous: number, capacity: number): number {
    if (chosen > previous) return chosen
    if (chosen < previous - 1) return chosen
    // A held boundary that draws nothing is the idle pool above, reached one frame later instead of
    // at once: the subject's own demand has moved entirely below a bucket it is still holding. A
    // ring one cell too small is the trade this hysteresis makes; no ring at all is not.
    if (capacity > 0 && this.wanting > 0 && this.countAtOrAbove(previous) === 0) return chosen
    return previous
  }

  private countAtOrAbove(bucket: number): number {
    let total = 0
    for (let index = bucket; index < BUCKETS; index += 1) total += this.histogram[index]!
    return total
  }

  private report(bucket: number): ThresholdReport {
    return {
      effectiveThresholdPx: this.adaptive ? bucketEdgePx(bucket) : BASE_THRESHOLD_PX,
      wanting: this.wanting,
      admitted: this.admitted,
      adaptive: this.adaptive,
    }
  }
}
