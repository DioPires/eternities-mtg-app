/**
 * The art stream (spec §1.6): what turns "this cell wants art" into a layer of the pool.
 *
 * {@link ArtPool} hands out layer indices and {@link ImageQueue} performs fetches; neither knows
 * about the other. This is the join, and it is where §1.6's fetch discipline lives — the part of
 * that paragraph that was not already true of the card tier's queue.
 *
 * **It does not open a second queue, and that is deliberate.** `cards/imageQueue`'s header makes
 * the argument already: PRD 7.2's "concurrent image requests to Scryfall: 6" is a budget against
 * the *origin*, so thumbnails, the focused card and the worlds surface share one, and three queues
 * of six would be eighteen. Four of §1.6's five fetch rules are therefore inherited rather than
 * re-implemented:
 *
 * | §1.6 rule | Where it lives |
 * |---|---|
 * | `mode: 'cors'`, `credentials: 'omit'` | `imageQueue`'s `run` |
 * | at most 6 concurrent | `imageQueue`'s `concurrency`, from `tuning.IMAGE_CONCURRENCY` |
 * | cache-busted by the contract's `imageTs` | `data/images`' `imageUri`, which appends `?<ts>` |
 * | a failed key never retried in the same session | {@link ArtPool.hasFailed}, checked here |
 * | **a per-session byte budget that degrades to swatch-only** | **here** — nothing else had it** |
 *
 * The fifth is this file's own, and it needs the byte count `imageQueue` now reports: a budget
 * against the network cannot be derived from a decoded `ImageBitmap`, whose footprint is a constant
 * `128 * 96 * 4` regardless of what crossed the wire.
 *
 * > **Normative — degrading is not tearing down (§1.6).** Over budget, the stream stops *asking*.
 * > Layers already resident keep drawing their art; §1.4's shading path degrades to the swatch only
 * > for cells that never got one. A budget that evicted what it had already paid for would spend
 * > the session's bytes and then throw away the picture they bought.
 *
 * > **Normative — the budget is charged when a request *issues*, and reconciled when it settles
 * > (§1.6, DEC-780).** The obvious reading — charge `Blob.size` on completion, compare the running
 * > total against the budget — cannot bind on this workload, and shipped not binding: the selection
 * > pass issues every want for a pose in one frame, so all 967 requests tested the budget at zero
 * > bytes fetched and all 967 passed, spending **88.7 MiB against a 64 MiB budget**. So an issuing
 * > request reserves {@link ART_CROP_ESTIMATED_BYTES} against the budget up front, and releases
 * > that estimate for the body's real size once the queue settles it. The quantity
 * > {@link ArtStream.swatchOnly} tests is the **sum** of landed and outstanding bytes.
 *
 * > **The defect is not "it never declines" — it is "it declines too late", and the difference
 * > matters to anyone measuring this.** The unfixed stream does eventually refuse: once 88.7 MiB
 * > has landed the total is over budget and every later frame is declined, 23,715 times in a 32 s
 * > run. Those refusals are a post-hoc observation of money already spent. A gate scored on
 * > `declinedBudget > 0` reads **both** trees as passing and tells you nothing; the quantity that
 * > separates them is what crossed the network — 967 requests / 88.7 MiB before, 729 / 70.2 MiB
 * > after. See {@link ART_CROP_ESTIMATED_BYTES} for why the remainder is +9.7% and not zero.
 */

import { imageUri, type ImageSize } from '../../data/images'

import type { ImageQueue, ImageRequest, ImageResult } from '../cards/imageQueue'

import type { ArtPool } from './artPool'

/** §1.6's layer dimensions: `art_crop` letterboxed into a 128x96 layer of the pool. */
export const ART_LAYER_WIDTH = 128
export const ART_LAYER_HEIGHT = 96

/**
 * Scryfall's `art_crop` is 626x457 (PRD 8.5.10; the same pair `cards/focusedCard` derives from).
 *
 * `626/457 = 1.370` against the layer's `128/96 = 1.333`, so the two do **not** agree and the
 * difference is not rounding — an art crop stretched to fill the layer is 2.7% wide, which reads as
 * a subtly fat card face repeated across a whole hemisphere.
 */
export const ART_CROP_WIDTH = 626
export const ART_CROP_HEIGHT = 457

/** Where a source image lands inside a layer once it has been fitted, in texels. */
export interface Letterbox {
  readonly width: number
  readonly height: number
  readonly x: number
  readonly y: number
}

/**
 * Fit a source into the layer without distorting it — §1.6's "letterboxed", made arithmetic.
 *
 * **This is the size to decode at, not just to draw at.** `ImageQueue`'s `resize` is passed
 * straight to `createImageBitmap`, which scales to exactly the width and height it is given and
 * does not preserve aspect; handing it the layer's full `128x96` is precisely how the stretch
 * above gets baked in at decode time, where no later code can undo it. So the caller decodes at
 * {@link Letterbox.width} x {@link Letterbox.height} and uploads at the offset.
 *
 * The bars are centred, and the offsets floor rather than round: an odd residual puts the extra
 * texel at the bottom on every layer instead of alternating with the source height's parity, which
 * would make neighbouring cells' art sit one texel apart vertically.
 */
export function letterbox(
  sourceWidth = ART_CROP_WIDTH,
  sourceHeight = ART_CROP_HEIGHT,
  layerWidth = ART_LAYER_WIDTH,
  layerHeight = ART_LAYER_HEIGHT,
): Letterbox {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return { width: layerWidth, height: layerHeight, x: 0, y: 0 }
  }
  const scale = Math.min(layerWidth / sourceWidth, layerHeight / sourceHeight)
  // At least one texel in each axis: a source far wider than it is tall would otherwise round to a
  // zero-height bitmap, and `createImageBitmap` rejects a zero dimension rather than returning an
  // empty image — an exception on the decode path, not a blank layer.
  const width = Math.max(1, Math.min(layerWidth, Math.round(sourceWidth * scale)))
  const height = Math.max(1, Math.min(layerHeight, Math.round(sourceHeight * scale)))
  return {
    width,
    height,
    x: Math.floor((layerWidth - width) / 2),
    y: Math.floor((layerHeight - height) / 2),
  }
}

/**
 * The default per-session budget, in bytes.
 *
 * Sized against the number §1.6 is reacting to: the prototype's one camera pose at
 * `tether-surface` spent ~1,900 `art_crop` fetches, roughly **170 MB**. 64 MB is comfortably above
 * what the adaptive threshold needs for a long session — a full pool at tier 4 is ~1,024 fetches,
 * ~92 MB at Scryfall's ~90 KB median `art_crop`, and the threshold's near-zero steady-state
 * eviction means a session re-fetches little of it — while still being *below* what a single
 * un-thresholded pose costs. It is a backstop against a pathological session, not a per-frame
 * budget, and it is a knob so §1.12's ladder can lower it.
 */
export const DEFAULT_BYTE_BUDGET = 64 * 1024 * 1024

/**
 * What one in-flight request is charged against the budget before its body arrives, in bytes.
 *
 * > **Normative — the budget is charged at *issue* time, and this is the price (§1.6, DEC-780).**
 * > A budget consulted only against bytes that have already landed cannot bind on this workload.
 * > The selection pass issues every want for a pose in **one frame**: on the shipped policy that is
 * > 967 calls to {@link ArtStream.request} before a single byte returns, so every one of them tests
 * > `bytesFetched >= byteBudget` at `bytesFetched === 0` and passes. Later frames never re-consult
 * > it, because a key that is resident or in flight returns before the test. Measured on DEC-772's
 * > harness: **88.7 MiB fetched against a 64 MiB budget.** §1.6 is normative that over budget the
 * > stream stops asking; charging only on completion is what made it unable to.
 *
 * 90 KiB is Scryfall's median `art_crop`, the same figure {@link DEFAULT_BYTE_BUDGET}'s header
 * sizes the budget against. It sits a little *under* the 96,159-byte mean measured over all 967
 * fetches, so reconciliation corrects the estimate upward as bodies land rather than throttling a
 * session early on a guess.
 *
 * **What the estimate bounds is the number of requests admitted, not the bytes they turn out to
 * cost.** `byteBudget / ART_CROP_ESTIMATED_BYTES` is 67,108,864/92,160 = 728.2, so a session admits
 * exactly **729** bodies and then stops — measured, not argued, on DEC-772's harness at §3.1's
 * pose. The session's spend is `729 * (whatever those 729 actually weigh)`, so the overshoot is the
 * estimate's error against *that* mean, systematically and in one direction.
 *
 * **The admitted set is not a random sample of the roster, and it is heavier than one.** The queue
 * serves nearest-first, so the 729 that get through are a priority-ordered prefix:
 *
 * | tree | responses | spent | mean body | vs 64 MiB |
 * |---|---|---|---|---|
 * | pre-DEC-780 (charge on completion) | 967 — the whole want set | 88.7 MiB | 96,159 B | **+38.6%** |
 * | this file | **729** | 70.2 MiB | **100,996 B** | **+9.7%** |
 *
 * 96,159 B over all 967 is the population mean, and it reproduces DEC-772's 96,155 independently.
 * The admitted prefix means 100,996 B — about 5% heavier — and 100,996/92,160 = 1.0959 is the
 * +9.7% exactly. **So do not predict the overshoot from the population mean**; it under-states it,
 * which is the direction that matters.
 *
 * The constant sits under both means deliberately: §1.6's budget is a spend ceiling for a prefetch,
 * and starving the picture is the worse failure. Anyone who needs a hard cap should raise this
 * constant — the count law above says exactly what that buys — and **not** re-spell
 * {@link ArtStream.swatchOnly}, which is the change that reintroduces DEC-780.
 */
export const ART_CROP_ESTIMATED_BYTES = 90 * 1024

/** What the probe reports about the stream (§3.1). */
export interface ArtStreamReport {
  /** Bytes charged this session — successes and decode failures alike. Monotonic. */
  readonly bytesFetched: number
  /**
   * Bytes committed to requests that have not settled yet, at
   * {@link ART_CROP_ESTIMATED_BYTES} apiece (§1.6, DEC-780).
   *
   * > **Not monotonic, and not a subset of {@link ArtStreamReport.bytesFetched}.** It rises when a
   * > request issues and falls when that request settles — whichever way it settles. A body that
   * > arrived moves its estimate into `bytesFetched`; one that was dropped or cancelled moves it
   * > nowhere, because nothing was paid for it.
   *
   * > A reader wanting "what this session has committed" wants the **sum** of the two, which is
   * > what {@link ArtStreamReport.swatchOnly} is computed from. Do not re-derive that boolean
   * > (DEC-744 B1, DEC-746 D5) — this field is published so the sum is *legible*, not so the test
   * > can be repeated. It is the reason a report can show `swatchOnly` true while `bytesFetched` is
   * > still under `byteBudget`: the difference is in flight.
   */
  readonly bytesReserved: number
  readonly byteBudget: number
  /**
   * The budget is spent — committed, not merely landed — and the stream has stopped asking (§1.6).
   *
   * > The gate reads this before it reads W4: a session that went swatch-only part-way through has
   * > a legitimate reason for a low art count, and scoring it as a threshold failure would be the
   * > measure being carried by the wrong signal.
   *
   * > **Read it; do not recompute it** (DEC-744 B1, DEC-746 D5). It is
   * > `bytesFetched + bytesReserved >= byteBudget`, not `bytesFetched >= byteBudget` — the second
   * > spelling is the DEC-780 defect, and a gate that re-derived it would re-introduce the bug on
   * > the reading side after the stream had been fixed.
   */
  readonly swatchOnly: boolean
  /** Requests handed to the queue. Not the same as cells wanting art — see {@link ArtStream.request}. */
  readonly requested: number
  readonly resolved: number
  readonly failed: number
  /**
   * Wants the stream refused to ask for, by cause. A pool with nothing to give is exhaustion, which
   * is what `?artThreshold=fixed24` exists to produce; the other three are policy.
   */
  readonly declinedExhausted: number
  readonly declinedBudget: number
  readonly declinedFailedBefore: number
}

export interface ArtStreamOptions {
  readonly pool: ArtPool
  readonly queue: ImageQueue
  /** Defaults to {@link DEFAULT_BYTE_BUDGET}. `0` is a legal swatch-only session from frame one. */
  readonly byteBudget?: number
  /**
   * Hand a decoded bitmap to the caller's uploader, which is the only part of this that touches GL.
   *
   * `copyTextureToTexture(source, target, null, new Vector3(x, y, layer))` — a `texSubImage3D` of
   * one layer, so streaming a card in never re-uploads the pool (§1.6). The stream closes the
   * bitmap afterwards; the uploader must not keep it.
   */
  readonly upload: (layer: number, bitmap: ImageBitmap, box: Letterbox) => void
  readonly imageSize?: ImageSize
}

/**
 * The join between the pool, the queue and §1.6's budget.
 *
 * > **Normative — reserve *before* the fetch, and the reservation is what makes a second want for
 * > the same key a no-op (§1.6).** This is the three-state pool's whole purpose seen from the
 * > outside: {@link ArtPool.reserve} returns the already-held layer for a key whose fetch is still
 * > in flight, so the `requested` counter below rises once per key and not once per frame per cell.
 * > With a two-state pool both wants claim a layer, both fetch, and one silently overwrites the
 * > other — the 1,031-resident-in-1,024 bug.
 */
export class ArtStream {
  private readonly pool: ArtPool
  private readonly queue: ImageQueue
  private readonly upload: ArtStreamOptions['upload']
  private readonly imageSize: ImageSize
  private readonly box = letterbox()

  readonly byteBudget: number

  /** The selection pass's frame counter, which the pool's LRU grace window orders by. */
  private frame = 0
  /**
   * In-flight card key to the queue key its request was filed under.
   *
   * Both halves are needed. The card key is what the pool speaks and what `request` de-duplicates
   * on; the queue key is a string derived from the *printing* id, and {@link ImageQueue.cancel}
   * only answers to that. Keeping the set alone and re-deriving the queue key from the card key
   * would cancel a key that was never queued — a silent no-op, so `reset()` would appear to work
   * while leaving every request running.
   */
  private readonly inFlight = new Map<number, string>()

  private bytesFetched = 0
  /**
   * The estimate standing against every request that has issued and not settled (§1.6, DEC-780).
   *
   * A running sum rather than `inFlight.size * ART_CROP_ESTIMATED_BYTES`, and the two are
   * **behaviourally equivalent on every path this class has** — the derived spelling passes the
   * whole suite, and it is recorded as an accepted equivalent mutant rather than chased with a
   * contrived row. They diverge at exactly one instant: inside the synchronous turn that ran
   * {@link ArtStream.reset}, where `inFlight` is already cleared but the requests it held have not
   * rejected yet, so the sum still holds their estimates and the derived form reads zero. Nothing
   * observes that instant — `reset()`'s only caller drops the stream on the next line
   * (`attachWorlds.ts`'s `releasePool`), so the object carrying the stale charge never serves
   * another request.
   *
   * The sum is kept because it is **symmetric with the release**: one `+=` where a request issues,
   * one `-=` in the `finally` that every settlement passes through, so the audit for "is this
   * balanced" is two lines in one method. Deriving it instead would make the charge depend on a
   * map whose clearing rule is set by a different concern (cancellation), which is a coupling that
   * is free today and would not stay free.
   */
  private bytesReserved = 0
  private requested = 0
  private resolved = 0
  private failed = 0
  private declinedExhausted = 0
  private declinedBudget = 0
  private declinedFailedBefore = 0

  constructor(options: ArtStreamOptions) {
    this.pool = options.pool
    this.queue = options.queue
    this.upload = options.upload
    this.imageSize = options.imageSize ?? 'art_crop'
    this.byteBudget = Math.max(0, options.byteBudget ?? DEFAULT_BYTE_BUDGET)
  }

  get swatchOnly(): boolean {
    return this.bytesFetched + this.bytesReserved >= this.byteBudget
  }

  report(): ArtStreamReport {
    return {
      bytesFetched: this.bytesFetched,
      bytesReserved: this.bytesReserved,
      byteBudget: this.byteBudget,
      swatchOnly: this.swatchOnly,
      requested: this.requested,
      resolved: this.resolved,
      failed: this.failed,
      declinedExhausted: this.declinedExhausted,
      declinedBudget: this.declinedBudget,
      declinedFailedBefore: this.declinedFailedBefore,
    }
  }

  /**
   * A cell wants art for `key`. Idempotent per key, and cheap enough for the selection pass to call
   * on every admitted cell every frame.
   *
   * Returns the layer the key is on or heading for, or `null` if the stream declined — which is not
   * an error: under the adaptive threshold it should be vanishingly rare, and under
   * `?artThreshold=fixed24` it is the exhaustion W4's control exists to produce.
   *
   * The order of the three refusals is load-bearing. A key that already failed is refused before
   * the budget is consulted, so a 404-heavy session does not read as a budget exhaustion; and the
   * budget is consulted before the pool, so going swatch-only does not show up as exhaustion
   * either. Each cause is counted separately because §3.1's W4 row and its control need to tell
   * them apart — collapsing them into one `declined` is how a control gets scored green for the
   * wrong reason.
   *
   * **The two early returns above the budget test are not holes in it (DEC-780).** A key the pool
   * already holds, and a key already in flight, are both keys this session has *already* paid or
   * committed for; re-charging them per frame per cell is the double-count the three-state pool
   * exists to avoid. Everything that would cost a new body passes through the `swatchOnly` test on
   * every call, including on frames after the first — which is precisely what was untrue while the
   * charge happened on completion.
   */
  request(key: number, printingId: string, imageTs: number, priority: () => number | null): number | null {
    const held = this.pool.layerOf(key)
    if (held !== null) {
      this.pool.want(key, this.frame)
      return held
    }
    if (this.pool.hasFailed(key)) {
      this.declinedFailedBefore += 1
      return null
    }
    if (this.swatchOnly) {
      this.declinedBudget += 1
      return null
    }
    const layer = this.pool.reserve(key, this.frame)
    if (layer === null) {
      this.declinedExhausted += 1
      return null
    }
    // `reserve` returns the held layer for a key already in flight, and that key already has a
    // request on the queue. Asking again would be harmless — the queue joins by key — but it would
    // inflate `requested` into a per-frame count and make the probe's fetch total meaningless.
    if (this.inFlight.has(key)) return layer
    this.requested += 1
    void this.fetch(key, printingId, imageTs, priority)
    return layer
  }

  /** Advance the frame the pool's grace window is measured against. Called once per tick. */
  beginFrame(frame: number): void {
    this.frame = frame
  }

  private async fetch(
    key: number,
    printingId: string,
    imageTs: number,
    priority: () => number | null,
  ): Promise<void> {
    const queueKey = `worlds-art:${printingId}`
    this.inFlight.set(key, queueKey)
    // Charged here, before the await, so it is committed in the same synchronous turn the caller's
    // `request()` ran in. That is what lets the *next* call in the same frame see it — the whole of
    // DEC-780 is that a frame issues all its wants before any of them can land.
    this.bytesReserved += ART_CROP_ESTIMATED_BYTES
    const request: ImageRequest = {
      key: queueKey,
      url: imageUri(printingId, imageTs, this.imageSize),
      priority,
      // The letterboxed size, not the layer size — see `letterbox`'s header for why handing
      // `createImageBitmap` the full 128x96 bakes a 2.7% horizontal stretch in at decode time.
      resize: { width: this.box.width, height: this.box.height },
    }
    let result: ImageResult
    try {
      result = await this.queue.request(request)
    } finally {
      // Symmetric with the charge above across **every** way the queue can settle — resolved,
      // `'failed'`, `'dropped'`, `'cancelled'`, and the already-disposed short circuit — and in a
      // `finally` so a throw on the way out cannot strand it either. A path that returned without
      // crediting the estimate back would leave `bytesReserved` permanently high and the session
      // permanently swatch-only, which is this fix failing in the opposite direction: a stream that
      // stops asking for reasons that are no longer true.
      this.bytesReserved -= ART_CROP_ESTIMATED_BYTES
    }
    this.inFlight.delete(key)

    if (result.ok) {
      this.bytesFetched += result.bytes
      const layer = this.pool.resolve(key)
      if (layer === null) {
        // The reservation is gone. The pool never evicts a RESERVED layer, so the only way here is
        // a `reset()` between the request and its landing — a dataset swap. Drop the bitmap rather
        // than uploading it into whatever now owns the layer.
        result.bitmap.close()
        return
      }
      this.resolved += 1
      this.upload(layer, result.bitmap, this.box)
      result.bitmap.close()
      return
    }

    if (result.reason === 'failed') {
      // A body that arrived and then failed to decode has still been paid for.
      this.bytesFetched += result.bytes
      this.failed += 1
      this.pool.fail(key)
      return
    }
    // 'dropped' and 'cancelled' are not failures: the caller stopped wanting this image, and asking
    // again when the camera comes back is correct. So the key must **not** enter the pool's failed
    // set — but the reservation has to go back, or a dropped request holds a layer for the session.
    this.pool.release(key)
  }

  /**
   * Abandon every in-flight request and hand its reservation back. For a dataset swap.
   *
   * The pool keeps what is already resident: those layers hold art for cards that may well still be
   * on the new roster, and the LRU evicts the ones that are not as soon as anything else wants a
   * layer. What cannot survive is a request whose completion would upload into a layer the new
   * roster has since been given.
   */
  reset(): void {
    for (const [key, queueKey] of this.inFlight) {
      this.queue.cancel(queueKey)
      this.pool.release(key)
    }
    this.inFlight.clear()
  }
}
