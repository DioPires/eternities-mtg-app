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
 * | **a byte budget on outstanding art spend, degrading to swatch-only** | **here** — nothing else had it** |
 *
 * The fifth is this file's own, and it needs the byte count `imageQueue` now reports: a budget
 * against the network cannot be derived from a decoded `ImageBitmap`, whose footprint is a constant
 * `128 * 96 * 4` regardless of what crossed the wire.
 *
 * > **Normative — the budget bounds what is *outstanding*, and eviction reclaims (§1.6, DEC-812).**
 * > The quantity tested is settled bytes standing behind **resident layers**, plus in-flight
 * > reservations; when the pool's LRU evicts a layer, the stream credits that key's own body size
 * > back. §1.6 used to call this a "per-session byte budget" and it was implemented as one — a
 * > running total nothing ever subtracted from. Leg G's 45-world acceptance tour measured what that
 * > costs: `bytesFetched` crossed 64 MiB at the **eighth** world and then froze exactly, along with
 * > `requested` and `resolved`, so all thirty-seven worlds after it rendered art-free for the life
 * > of the page. The cut was a step function of *tour position* and not of demand — a 676-cell world
 * > early got full art, a 302-cell world late got none — and `pool.evictions` read **0** on all 45
 * > worlds, which is the tell: the budget refused before the pool was ever consulted, so the LRU
 * > never ran and never reclaimed. Swatch-only is now a condition a session comes back out of.
 *
 * > **Normative — degrading is not tearing down (§1.6).** Over budget, the stream stops *asking*.
 * > Layers already resident keep drawing their art; §1.4's shading path degrades to the swatch only
 * > for cells that never got one. A budget that evicted what it had already paid for would spend
 * > the session's bytes and then throw away the picture they bought. **The reclaim above does not
 * > contradict this, and the direction is what separates them**: the pool's LRU decides what to
 * > evict, under demand for *layers*, and the budget follows it down; the budget never asks for an
 * > eviction to buy itself room. That is also why {@link defaultByteBudget} is derived from the pool
 * > — so the pool is the thing under pressure and the budget is a backstop behind it.
 *
 * > **Normative — the budget is charged when a request *issues*, and reconciled when it settles
 * > (§1.6, DEC-780).** The obvious reading — charge `Blob.size` on completion, compare the running
 * > total against the budget — cannot bind on this workload, and shipped not binding: the selection
 * > pass issues every want for a pose in one frame, so all 967 requests tested the budget at zero
 * > bytes fetched and all 967 passed, spending **88.7 MiB against a 64 MiB budget**. So an issuing
 * > request reserves {@link ART_CROP_ESTIMATED_BYTES} against the budget up front, and releases
 * > that estimate for the body's real size once the queue settles it. The quantity
 * > {@link ArtStream.swatchOnly} tests is the **sum** of outstanding and in-flight bytes.
 *
 * > **The defect is not "it never declines" — it is "it declines too late", and the difference
 * > matters to anyone measuring this.** The unfixed stream does eventually refuse: once 88.7 MiB
 * > has landed the total is over budget and every later frame is declined, 23,715 times in a 32 s
 * > run. Those refusals are a post-hoc observation of money already spent. A gate scored on
 * > `declinedBudget > 0` reads **both** trees as passing and tells you nothing; the quantity that
 * > separates them is what crossed the network — 967 requests / 88.7 MiB before, 729 / 70.2 MiB
 * > after. See {@link ART_CROP_ESTIMATED_BYTES} for why the remainder is +9.7% and not zero.
 *
 * > **The same warning survives DEC-812, for a second reason.** A tree with the
 * > session-cumulative budget declines *constantly* once it has frozen — leg G's tour counted
 * > `declinedBudget` climbing to 3,052,268 — and a fixed tree declines too, whenever a burst
 * > out-runs the pool. The signal that separates them is not that declines happen, it is that the
 * > fixed tree's `requested` and `resolved` **keep moving** and its `pool.evictions` are non-zero.
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
 * The mean body of an **admitted** `art_crop`, in bytes — measured, not Scryfall's published median.
 *
 * The admitted set is not a random sample of the roster and is heavier than one: the queue serves
 * nearest-first, so what gets through is a priority-ordered prefix. Over DEC-772's harness at §3.1's
 * pose the population mean across all 967 wants is 96,159 B while the admitted prefix means
 * **100,996 B**, about 5% heavier. {@link defaultByteBudget} sizes against the heavier of the two,
 * because under-stating the mean is the direction that makes the budget bind early.
 */
export const ART_CROP_ADMITTED_MEAN_BYTES = 100_996

/**
 * How far {@link defaultByteBudget} sits above a full pool's measured cost.
 *
 * The budget's job after DEC-812 is to be a **backstop**, not the binding constraint: §1.6's pool
 * and §1.6's adaptive threshold are what bound how much art a frame asks for, and a default that
 * bound first would be the session-cumulative defect wearing a residency spelling — a full pool
 * would sit *at* the budget, nothing further would ever be asked for, and so nothing would ever be
 * evicted to reclaim it. The headroom is what keeps the release valve open.
 *
 * 1.5 is the factor by which the mean admitted body would have to grow before the budget bound at a
 * full pool. That is the number this constant buys and the honest way to state it: art would have
 * to average **151,494 B** — half as much again as the 100,996 B measured — for a full pool to go
 * swatch-only. Below that the pool evicts, the stream reclaims, and the budget stays slack.
 */
export const BYTE_BUDGET_HEADROOM = 1.5

/**
 * The default budget for a pool of `poolLayers` layers, in bytes (§1.6, §1.12, DEC-812).
 *
 * > **Normative — the default is derived from the pool, not typed in (DEC-812).** The retired
 * > constant was a flat 64 MiB sized against *one camera pose*, and it read as deliberate because
 * > §1.6 called it "per-session": 1,024 layers at the 100,996 B admitted mean is **98.6 MiB of
 * > settled bytes at a full pool**, so a full pool was already half as much again as the whole
 * > budget. Under {@link ArtStream.swatchOnly}'s residency semantics that number would bind before
 * > the pool ever did, which is exactly the state leg G measured: art dead from the eighth world on.
 * > Deriving it means the two move together — §1.12's ladder lowers the rung and the budget follows
 * > it down, instead of a 128-layer tier carrying a ceiling sized for 1,024.
 *
 * At tier 0's 1,024 layers this is **147.9 MiB**, and the figure is meant to look large: it is a
 * bound on a quantity the pool already bounds, kept so a session whose bodies are pathologically
 * heavy still has a ceiling. §1.12's `byteBudget` option overrides it — see
 * {@link ArtStreamOptions.byteBudget} for what a budget *below* a full pool means.
 *
 * The `max(1, ...)` floor is for a zero-layer pool, which §1.6 makes legal. A pool with nothing to
 * give must refuse for **exhaustion**, and a budget of zero would make it refuse for budget instead
 * — the same cause-attribution error §3.1's W4 control exists to tell apart. (`attachWorlds` never
 * builds a stream over a zero-layer pool, so this is a floor under a reachable constructor call
 * rather than under a shipped path.)
 */
export function defaultByteBudget(poolLayers: number): number {
  return Math.ceil(Math.max(1, poolLayers) * ART_CROP_ADMITTED_MEAN_BYTES * BYTE_BUDGET_HEADROOM)
}

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
 * 90 KiB is Scryfall's median `art_crop`. It sits a little *under* both measured means — the
 * 96,159-byte population mean over all 967 fetches at §3.1's pose and the
 * {@link ART_CROP_ADMITTED_MEAN_BYTES} of the admitted prefix — so reconciliation corrects the
 * estimate upward as bodies land rather than throttling a session early on a guess.
 *
 * **What the estimate bounds is how many requests may be outstanding at once, not what a session
 * spends.** `byteBudget / ART_CROP_ESTIMATED_BYTES` is the number of bodies that may be in flight
 * simultaneously with an empty pool behind them; each one that settles hands its estimate back and
 * leaves the *real* body standing in {@link ArtStreamReport.bytesOutstanding} instead.
 *
 * > **The count law that used to live here was a law about a session, and DEC-812 retired it.**
 * > While the budget was session-cumulative, `byteBudget / estimate` was the number of bodies a
 * > *page* would ever admit — 729 at the retired 64 MiB — and the table below was the overshoot
 * > against that one-shot total:
 * >
 * > | tree | responses | spent | mean body | vs 64 MiB |
 * > |---|---|---|---|---|
 * > | pre-DEC-780 (charge on completion) | 967 — the whole want set | 88.7 MiB | 96,159 B | **+38.6%** |
 * > | post-DEC-780, pre-DEC-812 | **729** | 70.2 MiB | **100,996 B** | **+9.7%** |
 * >
 * > Both rows are one pose of one world. What neither could show is the second world: on the
 * > pre-DEC-812 tree the 729th body was the *last one of the session*, and leg G's 45-world tour
 * > measured exactly that — art at 1.000 through the eighth world, 0.000 on all thirty-seven after
 * > it. A session now admits as many bodies as the pool can hold layers for, repeatedly, and the
 * > figures above are kept as the provenance of {@link ART_CROP_ADMITTED_MEAN_BYTES} rather than as
 * > a live prediction.
 *
 * The constant sits under both means deliberately: §1.6's budget is a spend ceiling for a prefetch,
 * and starving the picture is the worse failure. Anyone who needs a hard cap should lower
 * {@link ArtStreamOptions.byteBudget} and **not** re-spell {@link ArtStream.swatchOnly}, which is
 * the change that reintroduces DEC-780.
 */
export const ART_CROP_ESTIMATED_BYTES = 90 * 1024

/** What the probe reports about the stream (§3.1). */
export interface ArtStreamReport {
  /**
   * Bytes of image body this session has taken in — successes and decode failures alike. Monotonic.
   *
   * > **Decode volume (`Blob.size`), not wire transfer (DEC-848).** A body served from the HTTP
   * > cache is charged here in full and crossed no wire: over a 660 s run parked at one world this
   * > field read 1,024.7 MiB against 287.0 MiB actually transferred. Do not read it, or any rate
   * > differenced from it, as bandwidth.
   *
   * > **This is the session ledger, and after DEC-812 it is no longer what the budget is tested
   * > against.** It is expected to climb past `byteBudget` on any long session and that is not a
   * > fault: a page that visits forty worlds has legitimately fetched more art than any one of them
   * > can hold. The quantity the budget bounds is {@link ArtStreamReport.bytesOutstanding}.
   * > Reading this field as "the budget" is the defect leg G measured — see that field's note.
   */
  readonly bytesFetched: number
  /**
   * Settled bytes that still have a **resident layer standing behind them** (§1.6, DEC-812).
   *
   * > **Normative — the budget bounds outstanding spend, not the session's total.** It rises by a
   * > body's real `Blob.size` when that body lands on a layer, and falls by exactly that key's own
   * > size when the pool evicts the layer. §1.6's older "per-session byte budget" was a total that
   * > nothing ever subtracted from, which made swatch-only **terminal**: leg G's 45-world tour
   * > crossed 64 MiB at the eighth world and every world after it rendered art-free for the life of
   * > the page, with `pool.evictions` at 0 throughout because the budget refused before the pool was
   * > ever asked. Swatch-only is now a condition a session recovers from as demand moves.
   *
   * > Not every charged byte is outstanding, and the gap is deliberate. A body that arrived and
   * > would not decode is in `bytesFetched` and **not** here — no layer stands behind it, and the
   * > pool's no-retry set is what stops the session paying for it twice. Same for a body that landed
   * > after a `reset()` took its reservation away: charged, dropped, never resident.
   */
  readonly bytesOutstanding: number
  /**
   * Bytes committed to requests that have not settled yet, at
   * {@link ART_CROP_ESTIMATED_BYTES} apiece (§1.6, DEC-780).
   *
   * > **Not monotonic, and not a subset of {@link ArtStreamReport.bytesFetched}.** It rises when a
   * > request issues and falls when that request settles — whichever way it settles. A body that
   * > arrived moves its estimate into `bytesFetched`, and into
   * > {@link ArtStreamReport.bytesOutstanding} as well if it reached a layer; one that was dropped
   * > or cancelled moves it nowhere, because nothing was paid for it.
   *
   * > A reader wanting "what this session is currently committed to" wants the **sum** of this and
   * > `bytesOutstanding`, which is what {@link ArtStreamReport.swatchOnly} is computed from. Do not
   * > re-derive that boolean (DEC-744 B1, DEC-746 D5) — the two components are published so the sum
   * > is *legible*, not so the test can be repeated. They are the reason a report can show
   * > `swatchOnly` true while `bytesOutstanding` is still under `byteBudget`: the difference is in
   * > flight.
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
   * > `bytesOutstanding + bytesReserved >= byteBudget`. Both of the older spellings are defects that
   * > shipped: `bytesFetched >= byteBudget` is DEC-780 (it cannot bind inside the one frame that
   * > issues every want), and `bytesFetched + bytesReserved >= byteBudget` is DEC-812 (it binds, and
   * > then never un-binds, because `bytesFetched` is monotonic). A gate that re-derived either would
   * > re-introduce the bug on the reading side after the stream had been fixed.
   *
   * > **Recoverable, which it was not before DEC-812.** It goes false again when the pool evicts
   * > layers this stream is charged for — that is the whole of the fix — so a tour reads it true
   * > under a burst and false again once the burst has settled and demand has moved on.
   */
  readonly swatchOnly: boolean
  /** Requests handed to the queue. Not the same as cells wanting art — see {@link ArtStream.request}. */
  readonly requested: number
  readonly resolved: number
  /**
   * Requests that will never produce a picture this session, and whose keys the pool refuses from
   * here on: a body that arrived and would not decode, and — DEC-791 — a printing id whose URL
   * could not be built at all. Both are "this key has no art", which is the only distinction
   * §1.6's no-retry rule draws.
   *
   * > Not to be confused with {@link ArtStreamReport.declinedFailedBefore}, which counts the
   * > *later* wants these refuse. `resolved + failed` is what became of the
   * > {@link ArtStreamReport.requested} that have settled; the `declined*` three are wants that
   * > never became requests at all.
   */
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
  /**
   * Defaults to {@link defaultByteBudget} of `pool.layers`. `0` is a legal swatch-only session from
   * frame one.
   *
   * > **A budget set *below* a full pool's settled cost is a deliberate spend cap, and it degrades
   * > the way §1.6 says (DEC-812).** The reclaim that makes swatch-only recoverable is driven by the
   * > pool's own LRU, and the LRU only runs when something asks the pool for a layer — so a budget
   * > that binds while the pool still has free layers stops the asking, nothing is evicted, and the
   * > session stays swatch-only until demand or the dataset changes. That is §1.6's normative
   * > behaviour ("over budget the stream stops asking; layers already resident keep drawing their
   * > art — a budget that evicted what it had already paid for would spend the session's bytes and
   * > then throw away the picture they bought") and not the DEC-812 defect, which was that the
   * > **default** sat below a full pool and so made the terminal state the ordinary one. Anything
   * > at or above `defaultByteBudget(pool.layers)` recovers; §1.12's ladder should move the pool
   * > rung, which moves the derived default with it, rather than reaching for this knob.
   */
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
   * The running sum of {@link settledBytes}, which is what {@link ArtStream.swatchOnly} tests.
   *
   * Kept as a sum rather than derived from the map for the same reason {@link bytesReserved} is:
   * one `+=` where a body becomes resident, one `-=` in the eviction listener, so "is this
   * balanced" is two lines. Unlike `bytesReserved` the derived spelling would also be O(resident)
   * on a getter the selection pass calls once per admitted cell per frame.
   */
  private bytesOutstanding = 0
  /**
   * Per key, the real `Blob.size` of the body standing behind its resident layer (§1.6, DEC-812).
   *
   * **Per key, because the reclaim credits back a body and not an average.** The pool evicts a
   * specific layer holding a specific key, and art bodies are not uniform — the measured spread
   * across one pose runs from a few KiB to several hundred. A reclaim of
   * {@link ART_CROP_ESTIMATED_BYTES}, or of the running mean, drifts the outstanding total away
   * from the truth in whichever direction that session's art happens to lean, and drifts it
   * *permanently*: nothing downstream ever re-measures it.
   *
   * Bounded by the pool: an entry is written only where {@link ArtPool.resolve} handed back a
   * layer, and deleted when that layer is evicted, so `settledBytes.size <= pool.resident` holds by
   * construction. Nothing else removes a resident layer — `release` and `fail` only ever take back
   * a RESERVED one — so eviction is the sole reclaim path and the sole way an entry can die.
   */
  private readonly settledBytes = new Map<number, number>()
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
    this.byteBudget = Math.max(0, options.byteBudget ?? defaultByteBudget(this.pool.layers))
    // Registered here, in the constructor, rather than on the first request: a listener attached
    // lazily would miss every eviction that happened before it, and the charge those evictions were
    // meant to credit back would stand for the session — DEC-812 again, in a smaller window.
    this.pool.onEvict((key) => {
      this.reclaim(key)
    })
  }

  get swatchOnly(): boolean {
    return this.bytesOutstanding + this.bytesReserved >= this.byteBudget
  }

  /**
   * How many admitted cells this budget can keep resident at once (§1.6, DEC-819).
   *
   * > **Normative — §1.6's threshold is taken against the *smaller* of the pool and this
   * > (DEC-819, board ruling on DEC-816 R2).** The quantile fit demand to
   * > {@link ArtPool.layers} and read no byte at all, and the two bounds are independent: a pool can
   * > have layers free while the budget is spent. On a world whose bodies are large enough the
   * > threshold therefore admitted a working set the session could not pay for, spent the budget on
   * > a prefix of it, and declined the rest — reaching {@link ArtStream.swatchOnly} *by exhaustion*
   * > rather than by policy, which is the state §1.6's quantile exists to remove. A world too large
   * > to show art at §3.1's 0.9 now raises its threshold and shows fewer, larger cells at full
   * > coverage.
   *
   * **A total, deliberately — not `(byteBudget − outstanding − reserved) / mean`.** The bound it
   * sits beside is `pool.layers`, which is the pool's *whole* capacity and not its free-layer count:
   * the threshold sizes a steady state in which this world's admitted set has displaced whatever
   * the LRU was holding for the last one. Netting off live spend would make the quantile a
   * controller reading its own output — the admitted set shrinks, the spend it caused is still
   * outstanding, and the next frame shrinks it again — and it would make a cell's admission depend
   * on the *order* worlds were visited in, which is the per-item-reading-order defect §3.1 made W4
   * per-world to avoid.
   *
   * **{@link ART_CROP_ADMITTED_MEAN_BYTES}, not {@link ART_CROP_ESTIMATED_BYTES}.** What has to fit
   * is settled residency, which is what the budget is tested against; the 90 KiB estimate sits
   * ~10% under the admitted mean on purpose (it must not throttle a session early on a guess), and
   * dividing by it would size the admitted set ~10% over what the session can actually hold — the
   * same systematic overshoot, moved from the ledger into the policy.
   *
   * **Inert at the shipped default, by construction.** {@link defaultByteBudget} is
   * `layers x mean x` {@link BYTE_BUDGET_HEADROOM}, so this reads `floor(1.5 x layers)` and
   * `pool.layers` is always the binding one. That is the headroom constant's meaning stated from
   * the other side, and it is why this bound can only ever *raise* the threshold on a session whose
   * budget was hand-set below a full pool's settled cost — see {@link ArtStreamOptions.byteBudget},
   * whose "stays swatch-only until demand or the dataset changes" is exactly what it replaces.
   */
  get affordableCells(): number {
    return Math.floor(this.byteBudget / ART_CROP_ADMITTED_MEAN_BYTES)
  }

  report(): ArtStreamReport {
    return {
      bytesFetched: this.bytesFetched,
      bytesOutstanding: this.bytesOutstanding,
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
    // Discarded deliberately: the caller is a selection pass that has no use for a promise, and
    // `fetch` settles every failure it can name into the pool and the counters rather than out
    // through here (DEC-791). What is left is the one rejection that must **not** be swallowed —
    // the caller's own `upload` throwing, which is a GL fault in code this class does not own and
    // wants in the console, not absorbed into `failed` as if a fetch had gone wrong.
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
    let result: ImageResult
    // The outer boundary means "this key cannot be fetched at all", and it exists because building
    // the URL can say so: `imageUri` throws on a printing id shorter than two characters
    // (`data/images.ts`). DEC-786 N1 already moved the charge below the literal so that throw could
    // not strand 90 KiB against the budget; **the throw still left this method before anything
    // else, and three more things were stranded by it** (DEC-791) — the `inFlight` slot entered on
    // the line above, the pool's RESERVED layer the caller claimed before calling, and the promise
    // itself, which `request` discards (`void this.fetch(...)`) and which therefore escaped as an
    // unhandled rejection. Inside the `try`, all four take the one failure path below.
    //
    // Unreachable on shipped data — Scryfall printing ids are 36-char UUIDs — and that is the point
    // of putting the literal inside a `try` rather than validating the id: the cost is one nesting
    // level, and what it buys is that the *class* of failure is handled rather than this instance
    // of it. `imageUri` is the only expression in here that can throw today.
    try {
      const request: ImageRequest = {
        key: queueKey,
        url: imageUri(printingId, imageTs, this.imageSize),
        priority,
        // The letterboxed size, not the layer size — see `letterbox`'s header for why handing
        // `createImageBitmap` the full 128x96 bakes a 2.7% horizontal stretch in at decode time.
        resize: { width: this.box.width, height: this.box.height },
      }
      // Charged before the await, so it is committed in the same synchronous turn the caller's
      // `request()` ran in. That is what lets the *next* call in the same frame see it — the whole
      // of DEC-780 is that a frame issues all its wants before any of them can land.
      //
      // Below the request literal, not above it (DEC-786 N1). The nesting keeps that ordering
      // load-bearing rather than incidental: the charge and its credit stay a two-line pair in one
      // scope, and no path that skipped the literal can reach either of them.
      this.bytesReserved += ART_CROP_ESTIMATED_BYTES
      try {
        result = await this.queue.request(request)
      } finally {
        // Symmetric with the charge above across **every** way the queue can settle — resolved,
        // `'failed'`, `'dropped'`, `'cancelled'`, and the already-disposed short circuit — and in a
        // `finally` so a throw on the way out cannot strand it either. A path that returned without
        // crediting the estimate back would leave `bytesReserved` permanently high and the session
        // permanently swatch-only, which is this fix failing in the opposite direction: a stream
        // that stops asking for reasons that are no longer true.
        this.bytesReserved -= ART_CROP_ESTIMATED_BYTES
      }
    } catch {
      // **`fail`, not `release`, and the difference is the churn this would otherwise cause.** The
      // two differ on whether the key stays askable, and a printing id whose URL does not build
      // this frame will not build next frame either — released, it would be re-requested and
      // re-throw once per frame per cell for the rest of the session. So it goes into the pool's
      // failed set, which is §1.6's "a failed key is never retried in the same session" applied to
      // the one failure that happens before the network rather than on it.
      //
      // Counted in `failed` for the same reason the decode failure below is: `request()` has
      // already incremented `requested`, and a request that reached neither `resolved` nor `failed`
      // is invisible in the probe's ledger. No bytes are charged — nothing crossed the wire.
      this.inFlight.delete(key)
      this.failed += 1
      this.pool.fail(key)
      return
    }
    this.inFlight.delete(key)

    if (result.ok) {
      this.bytesFetched += result.bytes
      const layer = this.pool.resolve(key)
      if (layer === null) {
        // The reservation is gone. The pool never evicts a RESERVED layer, so the only way here is
        // a `reset()` between the request and its landing — a dataset swap. Drop the bitmap rather
        // than uploading it into whatever now owns the layer.
        //
        // Charged in `bytesFetched` — the body arrived and decoded — and deliberately **not** in
        // `bytesOutstanding`: no layer stands behind it, so there is no eviction that could ever
        // credit it back, and counting it would be a permanent charge for a picture nobody has
        // (DEC-812's whole shape, at one key's scale).
        result.bitmap.close()
        return
      }
      // The real body replaces the estimate as the thing standing against the budget. Recorded per
      // key, because the pool will name this key when it evicts the layer and the credit has to be
      // this body's own size.
      this.settledBytes.set(key, result.bytes)
      this.bytesOutstanding += result.bytes
      this.resolved += 1
      this.upload(layer, result.bitmap, this.box)
      result.bitmap.close()
      return
    }

    if (result.reason === 'failed') {
      // A body that arrived and then failed to decode has still been paid for, so it is charged in
      // the session ledger — a budget that only counted successes would under-count exactly the
      // traffic §1.6 exists to bound.
      //
      // **It is not outstanding, and that is a ruling and not an oversight (DEC-812).** The key
      // holds no layer — `pool.fail` hands the reservation straight back — so nothing could ever
      // evict it, and an outstanding charge with no resident layer behind it is charge that stands
      // for the life of the page. What stops the session paying for it repeatedly instead is the
      // pool's no-retry set, which this line's `fail` puts the key into: §1.6's "a failed key is
      // never retried in the same session" is the bound on this path, and the budget is not.
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
   * The pool evicted `key`'s layer: its body no longer stands against the budget (§1.6, DEC-812).
   *
   * Wired to {@link ArtPool.onEvict} in the constructor. This is the release valve the
   * session-cumulative budget never had — without it `bytesOutstanding` is monotonic, swatch-only
   * is terminal, and a session's art dies at whichever world crosses the budget.
   *
   * The absent-key early return is not a guard against a bug, it is the ordinary case: the pool
   * evicts by layer and announces whatever key it displaced, and a key this stream never charged
   * for — one whose body was dropped after a `reset()`, or one resident from before a swap — has
   * no entry to credit. Crediting a default for it would invent bytes.
   */
  private reclaim(key: number): void {
    const bytes = this.settledBytes.get(key)
    if (bytes === undefined) return
    this.settledBytes.delete(key)
    this.bytesOutstanding -= bytes
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
