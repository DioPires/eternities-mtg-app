/**
 * Every Scryfall image the card tier fetches goes through here (PRD 7.2, 7.4.2-3, 8.5.8-10).
 *
 * One queue for the whole scene, not one per consumer, because PRD 7.2's "concurrent image requests
 * to Scryfall: 6" is a budget against the *origin*. Thumbnails, the focused card's two faces and up
 * to 72 planet art crops all draw on it, and three queues of six would be eighteen.
 *
 * Four rules, all of them PRD text rather than taste:
 *
 *  - **Six at a time** (7.2). The ceiling is 8; the target is what ships.
 *  - **Nearest first** (5.5.3). Waiting requests are a priority queue, not a FIFO, and the priority
 *    is re-read at dequeue time — a camera that moved while a request waited re-ranks it rather
 *    than fetching what used to be nearest.
 *  - **CORS on every fetch** (8.5.8 and the phase brief). `mode: 'cors'` with no credentials, so
 *    the `createImageBitmap` upload is never tainted. `cards.scryfall.io` sends
 *    `access-control-allow-origin: *`, verified in Phase 0 (`docs/scryfall-policy.md`).
 *  - **Failure is silent** (7.4.2). A failed image resolves a result the caller can act on and
 *    nothing else happens; the star glow or the previous image stays. No retry: PRD 7.4.1's three
 *    attempts are for *data chunks*, and re-queueing a 404 behind five live requests would spend
 *    the budget on the one thing that cannot succeed.
 *
 * The result is a small union rather than `ImageBitmap | null` because "it failed" and "you no
 * longer wanted it" are different facts with different consequences, and `null` conflates them. A
 * caller that remembers failures so it never asks twice — {@link ThumbnailTier} does, or the
 * selector re-queues a 404 every 200 ms forever — would otherwise also remember every card that
 * merely drifted out of the cross-fade band, and never fetch it when the camera came back.
 *
 * `createImageBitmap` rather than `<img>`: it decodes off the main thread and it can resize on the
 * way, which is what keeps a 1 MB art crop from reaching the GPU at full size (PRD 8.5.10).
 */

import { IMAGE_CONCURRENCY } from '../tuning'

export interface ImageRequest {
  /** Stable identity. A second request for the same key joins the first rather than doubling it. */
  readonly key: string
  readonly url: string
  /**
   * Lower is fetched sooner, and it is re-read at dequeue. Return `null` to drop the request: the
   * caller has moved on and the bitmap would be decoded into a cell that no longer exists.
   */
  readonly priority: () => number | null
  /** Decoded size. `createImageBitmap` resizes during decode, so nothing full-size is ever held. */
  readonly resize?: { readonly width: number; readonly height: number }
}

export interface ImageQueueOptions {
  readonly concurrency?: number
  /** Injected in tests. */
  readonly fetchImpl?: typeof fetch
  /** Injected in tests, where `createImageBitmap` does not exist. */
  readonly decode?: (blob: Blob, resize?: ImageRequest['resize']) => Promise<ImageBitmap>
}

/** Why a request produced no bitmap. See the file header for why this is not just `null`. */
export type ImageResult =
  | { readonly ok: true; readonly bitmap: ImageBitmap }
  /** The fetch or the decode failed. PRD 7.4.2: leave what was there; do not ask again. */
  | { readonly ok: false; readonly reason: 'failed' }
  /** `priority()` returned `null`: the caller stopped wanting it. Asking again later is correct. */
  | { readonly ok: false; readonly reason: 'dropped' }
  /** `cancel()` or `dispose()`. Also not a failure. */
  | { readonly ok: false; readonly reason: 'cancelled' }

const DROPPED: ImageResult = { ok: false, reason: 'dropped' }
const CANCELLED: ImageResult = { ok: false, reason: 'cancelled' }
const FAILED: ImageResult = { ok: false, reason: 'failed' }

interface Waiting {
  readonly request: ImageRequest
  readonly settle: (result: ImageResult) => void
}

export interface ImageQueueStats {
  readonly inFlight: number
  readonly waiting: number
  readonly completed: number
  readonly failed: number
  /** The highest `inFlight` ever reached. PRD 7.2's cap is a claim this number can falsify. */
  readonly peakInFlight: number
}

async function defaultDecode(blob: Blob, resize?: ImageRequest['resize']): Promise<ImageBitmap> {
  if (!resize) return createImageBitmap(blob)
  return createImageBitmap(blob, {
    resizeWidth: resize.width,
    resizeHeight: resize.height,
    resizeQuality: 'high',
  })
}

export class ImageQueue {
  private readonly concurrency: number
  private readonly fetchImpl: typeof fetch
  private readonly decode: (blob: Blob, resize?: ImageRequest['resize']) => Promise<ImageBitmap>

  private readonly waiting: Waiting[] = []
  /** Keyed by request key, so two callers wanting one image share one fetch. */
  private readonly joined = new Map<string, Promise<ImageResult>>()
  private readonly controllers = new Map<string, AbortController>()
  private inFlightCount = 0
  private peak = 0
  private completed = 0
  private failed = 0
  private disposed = false

  constructor(options: ImageQueueOptions = {}) {
    this.concurrency = options.concurrency ?? IMAGE_CONCURRENCY
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
    this.decode = options.decode ?? defaultDecode
  }

  get stats(): ImageQueueStats {
    return {
      inFlight: this.inFlightCount,
      waiting: this.waiting.length,
      completed: this.completed,
      failed: this.failed,
      peakInFlight: this.peak,
    }
  }

  /**
   * Queue an image. Resolves with the decoded bitmap, or with why there is not one.
   *
   * The caller owns the bitmap and must `close()` it once it is uploaded — this queue never holds
   * one, so a decoded 4 MB image cannot outlive the frame that consumed it.
   */
  request(request: ImageRequest): Promise<ImageResult> {
    if (this.disposed) return Promise.resolve(CANCELLED)
    const existing = this.joined.get(request.key)
    if (existing) return existing

    const promise = new Promise<ImageResult>((resolve) => {
      this.waiting.push({ request, settle: resolve })
    }).finally(() => {
      this.joined.delete(request.key)
    })
    this.joined.set(request.key, promise)
    this.pump()
    return promise
  }

  /**
   * Abandon a request by key. A request still waiting is dropped; one in flight is aborted.
   *
   * This is what an LRU eviction calls: the cell the bitmap was going to land in has been given to
   * a nearer card, so finishing the fetch would spend one of six slots on nothing.
   */
  cancel(key: string): void {
    const index = this.waiting.findIndex((entry) => entry.request.key === key)
    if (index >= 0) {
      const [cancelled] = this.waiting.splice(index, 1)
      cancelled?.settle(CANCELLED)
    }
    this.controllers.get(key)?.abort()
  }

  private pump(): void {
    while (!this.disposed && this.inFlightCount < this.concurrency && this.waiting.length > 0) {
      const next = this.takeNearest()
      if (!next) return
      void this.run(next)
    }
  }

  /**
   * The nearest waiting request, dropping any whose priority has become `null`.
   *
   * A linear scan rather than a heap: the queue is bounded by the atlas capacity (512) and this
   * runs at most six times per completion, off the frame path.
   */
  private takeNearest(): Waiting | null {
    let best: Waiting | null = null
    let bestPriority = Infinity
    // Descending so that a drop cannot disturb an index the scan has yet to visit. What it *does*
    // disturb is the index of anything already visited — the best entry included — so the winner is
    // held by reference and looked up once the scan is over. Recording its index instead was a real
    // bug: every later drop shifted the recorded index down by one, so the queue dequeued a
    // neighbour of the nearest request rather than the nearest one, and when the best entry was
    // last the final splice ran off the end, returned `undefined`, and stalled the pump with work
    // still queued.
    for (let i = this.waiting.length - 1; i >= 0; i -= 1) {
      const entry = this.waiting[i]!
      const priority = entry.request.priority()
      if (priority === null) {
        this.waiting.splice(i, 1)
        entry.settle(DROPPED)
        continue
      }
      // Strictly less, on a descending scan, so a tie goes to the earliest entry queued.
      if (priority < bestPriority) {
        bestPriority = priority
        best = entry
      }
    }
    if (best === null) return null
    const index = this.waiting.indexOf(best)
    if (index >= 0) this.waiting.splice(index, 1)
    return best
  }

  private async run(entry: Waiting): Promise<void> {
    const { request, settle } = entry
    this.inFlightCount += 1
    if (this.inFlightCount > this.peak) this.peak = this.inFlightCount
    const controller = new AbortController()
    this.controllers.set(request.key, controller)

    let bitmap: ImageBitmap | null = null
    let aborted = false
    try {
      const response = await this.fetchImpl(request.url, {
        // PRD 7.6.1's CSP grantlists `https://*.scryfall.io` for `connect-src`; this is the fetch
        // it grantlists. `omit` because Scryfall's CDN wants no credentials and a credentialed
        // request against `access-control-allow-origin: *` is rejected by the browser outright.
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`${request.url} returned ${response.status}`)
      bitmap = await this.decode(await response.blob(), request.resize)
      this.completed += 1
    } catch {
      // PRD 7.4.2: nothing renders as a broken rectangle, and nothing is said about it. The caller
      // keeps whatever it had. An abort is this queue's own `cancel` and is not a failure.
      aborted = controller.signal.aborted
      if (!aborted) this.failed += 1
      bitmap = null
    } finally {
      this.controllers.delete(request.key)
      this.inFlightCount -= 1
    }

    if (this.disposed && bitmap) {
      bitmap.close()
      bitmap = null
    }
    settle(
      bitmap ? { ok: true, bitmap } : aborted || this.disposed ? CANCELLED : FAILED,
    )
    this.pump()
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    for (const entry of this.waiting.splice(0)) entry.settle(CANCELLED)
  }
}
