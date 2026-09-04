/**
 * Runtime plane-detail loading (PRD 8.7.6, amendment A1).
 *
 * "Requested the moment a plane becomes focus, so it normally arrives during the ≥ 1.2 s fly-to."
 * That is the whole design brief, and it has three consequences:
 *
 * - **Shard by shard, in order.** A1 shards every plane at 2,000 cards, and the Blind Eternities
 *   is the one that actually uses it. Shard 0 is posted, delivered, and only then is shard 1 asked
 *   for — so the first cards are usable while the rest are still coming, and a plane the user
 *   leaves after half a second has not queued four megabytes it will never read.
 * - **A new focus supersedes the old load.** The user clicking past three planes must not leave
 *   three loads racing; the worker gets a `cancel` and aborts the fetch in flight.
 * - **Failure is not fatal.** PRD 7.4.1: the retry policy already lives in `loadPlaneShard`, and
 *   what reaches here is the one non-blocking error the shell's toast fires on (Phase 4 wires it).
 *
 * Where `Worker` is unavailable — a test runner, a browser that refuses module workers — the same
 * `handlePlaneDetailRequest` runs inline. Slower, never wrong: the point of A1 is which thread
 * parses, and a fallback that parsed nothing at all would be worse than one that blocks.
 */

import type { PlaneShardFile } from '../data/types'

import {
  handlePlaneDetailRequest,
  type PlaneDetailRequest,
  type PlaneDetailResponse,
} from './protocol'

export interface PlaneDetailHandlers {
  /** One call per shard, in order. */
  readonly onShard: (file: PlaneShardFile) => void
  /** PRD 7.4.1's single non-blocking error, after the retries inside `loadPlaneShard` gave up. */
  readonly onError?: (message: string, shard: number) => void
  /** Every shard of the plane has arrived. */
  readonly onComplete?: () => void
}

export interface PlaneDetailLoaderOptions {
  /** The hashed data directory; a worker has no `document` to read the `<meta>` from. */
  readonly root: string
  /** Injected in tests, and the seam the inline fallback plugs into. */
  readonly createWorker?: () => Worker | null
}

export interface PlaneDetailLoader {
  /**
   * Load every shard of `slug`. Supersedes whatever was loading — PRD 8.7.6 ties this to focus, and
   * there is only ever one focus.
   */
  readonly load: (slug: string, shardCount: number, handlers: PlaneDetailHandlers) => void
  readonly cancel: () => void
  readonly dispose: () => void
}

function defaultWorker(): Worker | null {
  try {
    if (typeof Worker !== 'function') return null
    // The `new URL(..., import.meta.url)` form is what lets Vite bundle the worker as its own
    // chunk; a bare string would be resolved at runtime against the page and 404 in production.
    return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function createPlaneDetailLoader(options: PlaneDetailLoaderOptions): PlaneDetailLoader {
  const create = options.createWorker ?? defaultWorker
  let worker: Worker | null = null
  let workerTried = false

  let nextRequestId = 1
  /** The request generation. Anything arriving for an older one is a load the user walked away from. */
  let currentId = 0
  let currentSlug = ''
  let currentShardCount = 0
  let nextShard = 0
  let handlers: PlaneDetailHandlers | null = null
  let disposed = false

  const ensureWorker = (): Worker | null => {
    if (workerTried) return worker
    workerTried = true
    worker = create()
    worker?.addEventListener('message', (event: MessageEvent<PlaneDetailResponse>) => {
      receive(event.data)
    })
    return worker
  }

  const receive = (response: PlaneDetailResponse): void => {
    if (disposed || response.requestId !== currentId || response.slug !== currentSlug) return
    if (response.type === 'error') {
      handlers?.onError?.(response.message, response.shard)
      // One bad shard does not abandon the plane: the rest may well be fine, and a partial plane
      // panel beats an empty one (PRD 7.4.1's "non-blocking").
      nextShard += 1
      pump()
      return
    }
    handlers?.onShard(response.file)
    nextShard += 1
    pump()
  }

  const post = (request: PlaneDetailRequest): void => {
    const active = ensureWorker()
    if (active) {
      active.postMessage(request)
      return
    }
    if (request.type !== 'load') return
    // No worker: same code, this thread.
    void handlePlaneDetailRequest(request).then(receive)
  }

  const pump = (): void => {
    if (disposed || handlers === null) return
    if (nextShard >= currentShardCount) {
      const done = handlers.onComplete
      handlers = null
      done?.()
      return
    }
    post({
      type: 'load',
      requestId: currentId,
      root: options.root,
      slug: currentSlug,
      shard: nextShard,
    })
  }

  const cancel = (): void => {
    if (currentId !== 0 && handlers !== null) post({ type: 'cancel', requestId: currentId })
    handlers = null
  }

  return {
    load: (slug, shardCount, next) => {
      if (disposed) return
      cancel()
      currentId = nextRequestId++
      currentSlug = slug
      currentShardCount = Math.max(0, shardCount)
      nextShard = 0
      handlers = next
      pump()
    },
    cancel,
    dispose: () => {
      cancel()
      disposed = true
      worker?.terminate()
      worker = null
    },
  }
}
