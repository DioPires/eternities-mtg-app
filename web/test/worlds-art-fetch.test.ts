/**
 * §1.6's fetch discipline: the join between the layer pool, the shared image queue and the
 * per-session byte budget.
 *
 * **These run against the real {@link ImageQueue}, with only `fetch` and the decode injected.** A
 * mock queue would let the four inherited rules — `mode: 'cors'`, `credentials: 'omit'`, six
 * concurrent, and no retry — pass by construction, which is the one thing worth checking about a
 * reuse claim: `artStream`'s header asserts those rules are inherited rather than re-implemented,
 * and a test that stubs the queue asserts the header instead of the behaviour.
 *
 * Every blob below carries a **real, distinctive `size`**. Zero and one are both plausible
 * defaults, so a budget bug that charged a constant would survive a test that spent them.
 */

import { describe, expect, it } from 'vitest'

import { ImageQueue } from '../src/scene/cards/imageQueue'
import { ArtPool } from '../src/scene/worlds/artPool'
import {
  ART_CROP_HEIGHT,
  ART_CROP_WIDTH,
  ART_LAYER_HEIGHT,
  ART_LAYER_WIDTH,
  ArtStream,
  letterbox,
} from '../src/scene/worlds/artStream'

/** Unlike any default: not 0, not 1, and not a power of two. */
const BODY_BYTES = 90_113

interface Harness {
  readonly stream: ArtStream
  readonly pool: ArtPool
  readonly queue: ImageQueue
  readonly uploads: Array<{ layer: number; width: number; height: number; y: number }>
  readonly urls: string[]
  readonly inits: RequestInit[]
  /** Let one queued fetch finish. */
  readonly release: (url: string) => void
  readonly pending: () => number
  readonly settle: () => Promise<void>
}

function harness(options: {
  layers?: number
  byteBudget?: number
  bytes?: number
  hold?: boolean
  fail?: (url: string) => boolean
  decodeThrows?: boolean
} = {}): Harness {
  const urls: string[] = []
  const inits: RequestInit[] = []
  const uploads: Harness['uploads'] = []
  const gates = new Map<string, () => void>()

  const queue = new ImageQueue({
    fetchImpl: ((url: string, init?: RequestInit) => {
      urls.push(url)
      if (init) inits.push(init)
      const respond = (): unknown => {
        if (options.fail?.(url)) return { ok: false, status: 404 }
        return {
          ok: true,
          status: 200,
          blob: () => Promise.resolve({ size: options.bytes ?? BODY_BYTES } as Blob),
        }
      }
      if (!options.hold) return Promise.resolve(respond() as Response)
      return new Promise<Response>((resolve, reject) => {
        gates.set(url, () => resolve(respond() as Response))
        // The real `fetch` rejects when its signal aborts, and `ImageQueue.cancel` works by
        // aborting. A double that ignores the signal leaves every cancelled request in flight
        // forever, which makes the queue's own bookkeeping insensitive to whether a cancel hit
        // anything — and that is precisely the half a `reset()` test needs to observe.
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    }) as typeof fetch,
    decode: (_blob, resize) => {
      if (options.decodeThrows) return Promise.reject(new Error('corrupt'))
      return Promise.resolve({
        width: resize?.width ?? 0,
        height: resize?.height ?? 0,
        close: () => {},
      } as unknown as ImageBitmap)
    },
  })

  const pool = new ArtPool(options.layers ?? 4)
  const stream = new ArtStream({
    pool,
    queue,
    // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes` is on, so an explicit
    // `undefined` is not the same as an absent property and does not fall through to the default.
    ...(options.byteBudget === undefined ? {} : { byteBudget: options.byteBudget }),
    upload: (layer, bitmap, box) => {
      uploads.push({ layer, width: bitmap.width, height: bitmap.height, y: box.y })
    },
  })

  return {
    stream,
    pool,
    queue,
    uploads,
    urls,
    inits,
    release: (url) => gates.get(url)?.(),
    pending: () => gates.size,
    settle: async () => {
      // Four turns: fetch -> blob -> decode -> the stream's own continuation.
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    },
  }
}

/** A printing id, which is what the queue keys and the URL are built from. */
const ID = 'abcdef12-3456-7890-abcd-ef1234567890'
const TS = 1_700_000_000

describe('§1.6 letterboxing, which is a decode-time decision', () => {
  it('preserves the art crop aspect instead of filling the layer', () => {
    const box = letterbox()
    // 626/457 = 1.3698 against the layer's 128/96 = 1.3333. The two do NOT agree, and the gap is
    // not rounding — this is the assertion that makes the whole function load-bearing.
    expect(ART_CROP_WIDTH / ART_CROP_HEIGHT).toBeCloseTo(1.3698, 4)
    expect(ART_LAYER_WIDTH / ART_LAYER_HEIGHT).toBeCloseTo(1.3333, 4)
    expect(box).toEqual({ width: 128, height: 93, x: 0, y: 1 })
    // Re-measured rather than quoted from the header: stretching to fill is 2.7% wide.
    const stretch = ART_LAYER_WIDTH / ART_LAYER_HEIGHT / (ART_CROP_WIDTH / ART_CROP_HEIGHT)
    expect(Math.abs(1 - stretch)).toBeCloseTo(0.027, 3)
    // The mutant this kills: `{width: layerWidth, height: layerHeight}`, which is what an
    // implementation that forgot the letterbox returns.
    expect(box.height).not.toBe(ART_LAYER_HEIGHT)
    // Stated as the quantity that actually improves, because the fit is to whole texels and cannot
    // be exact: letterboxing takes the aspect error from 2.7% to under 0.5%. Asserting equality to
    // two decimals instead fails on the correct implementation — 128/93 is 1.3763 against the
    // crop's 1.3698 — which would have read as a bug in `letterbox` rather than in the assertion.
    const fitted = box.width / box.height
    const source = ART_CROP_WIDTH / ART_CROP_HEIGHT
    expect(Math.abs(1 - fitted / source)).toBeLessThan(0.005)
    expect(Math.abs(1 - fitted / source)).toBeLessThan(Math.abs(1 - stretch) / 5)
  })

  it('bars a tall source on the sides, so the fit is not width-only by luck', () => {
    // The non-degenerate control for the axis the production numbers never exercise: a portrait
    // source must letterbox horizontally. A `letterbox` that always returned full width — which
    // reproduces the 626x457 case exactly — fails here.
    const box = letterbox(96, 256)
    expect(box.height).toBe(ART_LAYER_HEIGHT)
    expect(box.width).toBe(36)
    expect(box.x).toBe(46)
    expect(box.y).toBe(0)
  })

  it('never returns a zero dimension, which createImageBitmap rejects outright', () => {
    expect(letterbox(4096, 1).height).toBe(1)
    expect(letterbox(1, 4096).width).toBe(1)
    expect(letterbox(0, 0)).toEqual({ width: 128, height: 96, x: 0, y: 0 })
  })

  it('decodes AT the letterboxed size, not at the layer size', async () => {
    const h = harness()
    h.stream.request(7, ID, TS, () => 0)
    await h.settle()
    // The bitmap that reached the uploader was decoded 128x93 — if the stream passed the layer
    // size to `createImageBitmap` the stretch would be baked in where nothing downstream can undo
    // it, and the upload offset would be 0 rather than 1.
    expect(h.uploads).toEqual([{ layer: 0, width: 128, height: 93, y: 1 }])
  })
})

describe('§1.6 the four rules inherited from the shared queue', () => {
  it('fetches cors/omit, which is what keeps the upload untainted', async () => {
    const h = harness()
    h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    expect(h.inits).toHaveLength(1)
    expect(h.inits[0]!.mode).toBe('cors')
    expect(h.inits[0]!.credentials).toBe('omit')
  })

  it('cache-busts on the contract imageTs, so a re-issued art crop is not stale', async () => {
    const h = harness()
    h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    expect(h.urls[0]).toContain(`?${TS}`)
    // A different imageTs is a different URL. Without this the CDN serves the old crop for the
    // lifetime of its cache entry, which is the one thing `imageTs` exists to prevent.
    const other = harness()
    other.stream.request(1, ID, TS + 1, () => 0)
    await other.settle()
    expect(other.urls[0]).not.toBe(h.urls[0])
  })

  it('never exceeds six concurrent, because the budget is against the ORIGIN', async () => {
    const h = harness({ layers: 64, hold: true })
    for (let key = 0; key < 20; key += 1) {
      h.stream.request(key, `${key}${ID.slice(1)}`, TS, () => key)
    }
    await h.settle()
    // 20 wanted, 6 in flight. The remaining 14 are queued, not dropped.
    expect(h.queue.stats.inFlight).toBe(6)
    expect(h.queue.stats.peakInFlight).toBe(6)
    expect(h.queue.stats.waiting).toBe(14)
    // The pool reserved all 20 up front: a reservation is not a fetch slot, and conflating them
    // would cap the pool at the concurrency.
    expect(h.pool.reserved).toBe(20)
  })
})

describe('§1.6 reserve-before-fetch, seen from outside the pool', () => {
  it('asks once per key however many cells want it', async () => {
    const h = harness({ hold: true })
    const first = h.stream.request(3, ID, TS, () => 0)
    const second = h.stream.request(3, ID, TS, () => 0)
    const third = h.stream.request(3, ID, TS, () => 0)
    await h.settle()
    // Same layer all three times, one fetch, one reservation. With a two-state pool each want
    // claims a layer, all three fetch, and two silently overwrite the third.
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(h.urls).toHaveLength(1)
    expect(h.pool.reserved).toBe(1)
    expect(h.stream.report().requested).toBe(1)
  })

  it('turns the reservation into residency only when the fetch lands', async () => {
    const h = harness({ hold: true })
    h.stream.request(3, ID, TS, () => 0)
    await h.settle()
    expect(h.pool.reserved).toBe(1)
    expect(h.pool.resident).toBe(0)
    expect(h.pool.layerOf(3)).toBeNull()
    h.release(h.urls[0]!)
    await h.settle()
    expect(h.pool.reserved).toBe(0)
    expect(h.pool.resident).toBe(1)
    expect(h.pool.layerOf(3)).toBe(0)
  })
})

describe('§1.6 the per-session byte budget', () => {
  it('degrades to swatch-only once spent, and counts the cause separately', async () => {
    // Two bodies fit; the third crosses. A budget that charged a constant, or that charged the
    // decoded 128x96x4 instead of the body, lands somewhere else entirely.
    const h = harness({ layers: 16, byteBudget: BODY_BYTES * 2 + 1 })
    for (const key of [1, 2]) h.stream.request(key, `${key}${ID.slice(1)}`, TS, () => 0)
    await h.settle()
    expect(h.stream.report().bytesFetched).toBe(BODY_BYTES * 2)
    expect(h.stream.swatchOnly).toBe(false)

    for (const key of [3, 4]) h.stream.request(key, `${key}${ID.slice(1)}`, TS, () => 0)
    await h.settle()
    expect(h.stream.swatchOnly).toBe(true)

    const declined = h.stream.request(9, `9${ID.slice(1)}`, TS, () => 0)
    expect(declined).toBeNull()
    const report = h.stream.report()
    expect(report.declinedBudget).toBe(1)
    // Not scored as exhaustion: the pool has 16 layers and 3 in use. §3.1's W4 row reads these
    // apart, and collapsing them is how a control passes for the wrong reason.
    expect(report.declinedExhausted).toBe(0)
    expect(report.declinedFailedBefore).toBe(0)
  })

  it('does NOT evict what it already paid for', async () => {
    // The budget is consulted when a request is made, so the body that crosses it is charged after
    // the fact — the crossing fetch is allowed and the NEXT one is refused. That is deliberate: the
    // alternative is predicting a body's size before fetching it.
    const h = harness({ layers: 16, byteBudget: BODY_BYTES + 1 })
    h.stream.request(1, `1${ID.slice(1)}`, TS, () => 0)
    await h.settle()
    expect(h.stream.swatchOnly).toBe(false)
    h.stream.request(2, `2${ID.slice(1)}`, TS, () => 0)
    await h.settle()
    expect(h.stream.swatchOnly).toBe(true)

    // Over budget now — and both cards still hold their layers and still draw their art. Degrading
    // is not tearing down: a budget that evicted here would spend the session's bytes and then
    // throw away the picture they bought.
    expect(h.pool.layerOf(1)).toBe(0)
    expect(h.pool.layerOf(2)).toBe(1)
    expect(h.pool.resident).toBe(2)
    expect(h.stream.request(3, `3${ID.slice(1)}`, TS, () => 0)).toBeNull()
    expect(h.stream.report().declinedBudget).toBe(1)
  })

  it('the non-binding control: a slack budget declines nothing', async () => {
    // Without this row a stream that refused everything unconditionally would pass every
    // assertion above. It is the same vacuity DEC-739 found in the layer clamp.
    const h = harness({ layers: 16, byteBudget: 1_000_000_000 })
    for (let key = 1; key <= 5; key += 1) {
      h.stream.request(key, `${key}${ID.slice(1)}`, TS, () => 0)
    }
    await h.settle()
    const report = h.stream.report()
    expect(h.stream.swatchOnly).toBe(false)
    expect(report.declinedBudget).toBe(0)
    expect(report.resolved).toBe(5)
    expect(h.pool.resident).toBe(5)
  })

  it('a zero budget is swatch-only from the first frame, and asks for nothing', async () => {
    const h = harness({ byteBudget: 0 })
    expect(h.stream.swatchOnly).toBe(true)
    expect(h.stream.request(1, ID, TS, () => 0)).toBeNull()
    await h.settle()
    expect(h.urls).toHaveLength(0)
    expect(h.pool.reserved).toBe(0)
  })

  it('charges a body that arrived and then failed to decode', async () => {
    // The one failure mode that costs a full transfer and returns nothing. A budget that only
    // charged successes under-counts exactly the traffic it exists to bound.
    const h = harness({ decodeThrows: true })
    h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    const report = h.stream.report()
    expect(report.failed).toBe(1)
    expect(report.bytesFetched).toBe(BODY_BYTES)
    expect(h.pool.hasFailed(1)).toBe(true)
  })
})

describe('§1.6 a failed key, and a dropped one, are different facts', () => {
  it('never asks for a failed key again in the session', async () => {
    const h = harness({ fail: () => true })
    h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    expect(h.pool.hasFailed(1)).toBe(true)
    expect(h.pool.reserved).toBe(0)

    const again = h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    expect(again).toBeNull()
    // Still one fetch. Re-queueing a 404 behind five live requests spends the budget on the one
    // thing that cannot succeed.
    expect(h.urls).toHaveLength(1)
    expect(h.stream.report().declinedFailedBefore).toBe(1)
  })

  it('a dropped request hands the layer back WITHOUT poisoning the key', async () => {
    const h = harness({ hold: true })
    // `priority()` returning null is the queue's "the caller stopped wanting this": the cell
    // drifted out of the admitted set while the request waited.
    h.stream.request(5, ID, TS, () => null)
    await h.settle()
    expect(h.pool.reserved).toBe(0)
    // The distinguishing assertion. Marking this failed would make a cell that merely drifted out
    // of the cross-fade band unfetchable for the rest of the session — `imageQueue`'s header makes
    // exactly this distinction, and `release` is what keeps it.
    expect(h.pool.hasFailed(5)).toBe(false)
    expect(h.stream.report().failed).toBe(0)
  })

  it('releasing after the fetch landed does not evict the picture', async () => {
    const h = harness()
    h.stream.request(5, ID, TS, () => 0)
    await h.settle()
    expect(h.pool.layerOf(5)).toBe(0)
    // A late cancellation arriving after residency must be inert: `release` only ever takes back a
    // RESERVED layer.
    h.pool.release(5)
    expect(h.pool.layerOf(5)).toBe(0)
    expect(h.pool.resident).toBe(1)
  })
})

describe('§1.6 reset, for a dataset swap', () => {
  it('cancels by the queue key, not by the card key', async () => {
    const h = harness({ hold: true })
    h.stream.request(11, ID, TS, () => 0)
    await h.settle()
    expect(h.pool.reserved).toBe(1)

    expect(h.queue.stats.inFlight).toBe(1)

    h.stream.reset()
    await h.settle()
    // **The queue is the only witness.** The bug this pins: the queue keys on a string built from
    // the PRINTING id, so cancelling `worlds-art:11` is a silent no-op that leaves the request
    // running. Asserting the pool instead cannot see it — `reset()` calls `pool.release` itself,
    // so the reservation goes back whether or not the cancel found its target, and the mutant
    // survived a pool-only assertion.
    expect(h.queue.stats.inFlight).toBe(0)
    expect(h.pool.reserved).toBe(0)
    expect(h.pool.hasFailed(11)).toBe(false)
    // Askable again after the swap.
    expect(h.stream.request(11, ID, TS, () => 0)).not.toBeNull()
  })
})

describe('§1.6 the pool invariant, under the stream rather than in isolation', () => {
  it('keeps resident + reserved <= layers through churn', async () => {
    const h = harness({ layers: 8 })
    for (let key = 0; key < 60; key += 1) {
      h.stream.beginFrame(key)
      h.stream.request(key, `${key % 10}${ID.slice(1)}`, TS, () => 0)
      await h.settle()
      expect(h.pool.resident + h.pool.reserved).toBeLessThanOrEqual(h.pool.layers)
    }
    // The prototype's tell was 1,031 resident in a 1,024-layer pool. This is that assertion driven
    // through the real fetch path rather than through direct pool calls.
    expect(h.pool.resident).toBeLessThanOrEqual(8)
    expect(h.pool.report().layers).toBe(8)
  })
})
