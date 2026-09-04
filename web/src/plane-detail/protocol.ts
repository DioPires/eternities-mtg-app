/**
 * The plane-detail worker's message protocol, and the one function that does the work.
 *
 * PRD 8.7.6 fetches `planes/<slug>.<n>.json` the moment a plane becomes focus, so it arrives during
 * the fly-to. Amendment A1 adds the reason it cannot arrive on the main thread: the Blind
 * Eternities is sharded at 2,000 cards and a shard is megabytes of JSON. `JSON.parse` on a
 * multi-megabyte string is tens of milliseconds of blocked main thread — several dropped frames,
 * in the middle of the transition PRD 7.2 budgets at 16.7 ms p95. So the fetch *and* the parse
 * happen in a worker and only the finished object crosses back.
 *
 * The work itself is `loadPlaneShard` from the data contract, unchanged: same retry policy
 * (PRD 7.4.1), same contract-version and shard-identity checks. The worker adds a thread, not a
 * second implementation.
 */

import { loadPlaneShard } from '../data/load'
import type { PlaneShardFile } from '../data/types'

export type PlaneDetailRequest =
  | {
      readonly type: 'load'
      readonly requestId: number
      /** The hashed data directory, passed in because a worker has no `document` to read it from. */
      readonly root: string
      readonly slug: string
      readonly shard: number
    }
  | { readonly type: 'cancel'; readonly requestId: number }

export type PlaneDetailResponse =
  | {
      readonly type: 'shard'
      readonly requestId: number
      readonly slug: string
      readonly shard: number
      readonly file: PlaneShardFile
    }
  | {
      readonly type: 'error'
      readonly requestId: number
      readonly slug: string
      readonly shard: number
      readonly message: string
    }

/**
 * Handle one request. Exported so the client can run it inline where `Worker` is unavailable — a
 * test runner, or a browser that refuses module workers — and so the worker file itself stays a
 * three-line adapter.
 */
export async function handlePlaneDetailRequest(
  request: Extract<PlaneDetailRequest, { type: 'load' }>,
  signal?: AbortSignal,
): Promise<PlaneDetailResponse> {
  try {
    const file = await loadPlaneShard(request.slug, request.shard, {
      root: request.root,
      ...(signal && { signal }),
    })
    return {
      type: 'shard',
      requestId: request.requestId,
      slug: request.slug,
      shard: request.shard,
      file,
    }
  } catch (error) {
    return {
      type: 'error',
      requestId: request.requestId,
      slug: request.slug,
      shard: request.shard,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
