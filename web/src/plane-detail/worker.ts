/**
 * The plane-detail worker (PRD 8.7.6, amendment A1).
 *
 * A three-line adapter on purpose: every rule lives in `protocol.ts` and, below it, in the data
 * contract's `loadPlaneShard`. The worker's whole contribution is the thread — a multi-megabyte
 * Blind Eternities shard is fetched and `JSON.parse`d here, so the fly-to it arrives during keeps
 * its frames (PRD 7.2's 16.7 ms p95).
 */

import { handlePlaneDetailRequest, type PlaneDetailRequest } from './protocol'

const inFlight = new Map<number, AbortController>()

self.addEventListener('message', (event: MessageEvent<PlaneDetailRequest>) => {
  const request = event.data

  if (request.type === 'cancel') {
    // The user moved on mid-fetch. Aborting matters more here than anywhere else in the app: a
    // Blind Eternities shard is the largest thing the browser ever downloads for this product.
    inFlight.get(request.requestId)?.abort()
    inFlight.delete(request.requestId)
    return
  }

  const controller = new AbortController()
  inFlight.set(request.requestId, controller)
  void handlePlaneDetailRequest(request, controller.signal).then((response) => {
    inFlight.delete(request.requestId)
    if (controller.signal.aborted) return
    self.postMessage(response)
  })
})
