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
  ART_CROP_ADMITTED_MEAN_BYTES,
  ART_CROP_ESTIMATED_BYTES,
  ART_CROP_HEIGHT,
  ART_CROP_WIDTH,
  ART_LAYER_HEIGHT,
  ART_LAYER_WIDTH,
  ArtStream,
  BYTE_BUDGET_HEADROOM,
  defaultByteBudget,
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
  /**
   * Let **every** held fetch finish, including the ones not started yet.
   *
   * Necessary because `hold` interacts with the queue's six-concurrent cap: a burst of forty leaves
   * thirty-four requests waiting with no gate to release, and each round of releases only admits
   * the next six. Releasing `urls` once and settling therefore resolves six of them and silently
   * leaves the rest outstanding — which reads as a budget that refused work it had actually queued.
   */
  readonly drain: () => Promise<void>
  readonly pending: () => number
  readonly settle: () => Promise<void>
}

function harness(options: {
  layers?: number
  byteBudget?: number
  /**
   * The body size, flat or **per URL** (DEC-812).
   *
   * Per URL because the reclaim credits back a specific key's body, and a reclaim of a constant —
   * the estimate, the running mean, anything uniform — is indistinguishable from the right one while
   * every body weighs the same. A test whose art is all one size cannot see that mutant.
   */
  bytes?: number | ((url: string) => number)
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
        const size =
          typeof options.bytes === 'function' ? options.bytes(url) : (options.bytes ?? BODY_BYTES)
        return {
          ok: true,
          status: 200,
          blob: () => Promise.resolve({ size } as Blob),
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

  const settle = async (): Promise<void> => {
    // Four turns: fetch -> blob -> decode -> the stream's own continuation.
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  }

  return {
    stream,
    pool,
    queue,
    uploads,
    urls,
    inits,
    release: (url) => gates.get(url)?.(),
    drain: async () => {
      // Bounded rather than `while (queue.stats.inFlight + queue.stats.waiting > 0)`: a stall is a
      // real failure mode of this fix — a reservation that is never credited back stops the queue
      // from draining — and an unbounded loop would hang the suite instead of failing a row.
      //
      // **The stream's reservation is part of the exit condition, and the queue's two counters
      // alone are not enough (DEC-812).** There is a window in which a request has been dequeued
      // and its fetch has resolved — so `waiting` and `inFlight` both read 0 — while the stream is
      // still a microtask or two from `pool.resolve`. Measured: a burst of eight into an
      // eight-layer pool returned from here with **six** resident and two reservations outstanding,
      // which reads as a pool that refused work it had in fact queued. `bytesReserved` is the
      // stream-side half of the same question and it is zero exactly when no request is in flight,
      // so the three together mean "nothing is pending anywhere".
      for (let round = 0; round < 24; round += 1) {
        const held = [...gates.keys()]
        for (const url of held) gates.get(url)?.()
        await settle()
        if (
          queue.stats.inFlight === 0 &&
          queue.stats.waiting === 0 &&
          stream.report().bytesReserved === 0
        ) {
          return
        }
      }
    },
    pending: () => gates.size,
    settle,
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

    // Two wants in ONE frame, which is the shape the selection pass actually has. Key 3 is admitted
    // — nothing is outstanding and 180,226 is a byte under the budget — and its reservation is what
    // refuses key 4 **in the same frame, before key 3's body exists**. Under the pre-DEC-780
    // spelling both passed at the landed total and this row scored one decline instead of two.
    for (const key of [3, 4]) h.stream.request(key, `${key}${ID.slice(1)}`, TS, () => 0)
    expect(h.stream.report().declinedBudget).toBe(1)
    expect(h.stream.report().bytesReserved).toBe(ART_CROP_ESTIMATED_BYTES)
    await h.settle()
    expect(h.stream.swatchOnly).toBe(true)
    // Reconciled: the estimate is gone and the real body has replaced it. Asserted because a charge
    // that was never released would hold the stream swatch-only on a budget it had not spent.
    expect(h.stream.report().bytesReserved).toBe(0)
    expect(h.stream.report().bytesFetched).toBe(BODY_BYTES * 3)

    const declined = h.stream.request(9, `9${ID.slice(1)}`, TS, () => 0)
    expect(declined).toBeNull()
    const report = h.stream.report()
    expect(report.declinedBudget).toBe(2)
    // Not scored as exhaustion: the pool has 16 layers and 3 in use. §3.1's W4 row reads these
    // apart, and collapsing them is how a control passes for the wrong reason.
    expect(report.declinedExhausted).toBe(0)
    expect(report.declinedFailedBefore).toBe(0)
  })

  it('does NOT evict what it already paid for', async () => {
    // The body that crosses the budget is still allowed: the estimate charged at issue time bounds
    // how many requests may be outstanding, it does not predict any particular body's size. Each
    // request below settles before the next is made, so nothing is outstanding when the budget is
    // consulted and the landed total is the whole of it — which is why this row reads the same
    // before and after DEC-780.
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

/**
 * The rows above all let one request settle before making the next, so the landed byte total is the
 * whole of what the session has committed and a budget charged on completion looks like it works.
 *
 * **Production does not do that, and that is the entire defect (DEC-780).** The selection pass
 * issues every want for a pose in one frame: 967 calls to `request` before a single body returns.
 * A budget consulted against landed bytes therefore tests every one of them at zero and admits
 * every one of them, spending **88.7 MiB against a 64 MiB budget** — §1.6's "over budget the stream
 * stops asking", unable to.
 *
 * **Note what the defect is not.** It is not that the unfixed stream never declines: it declines
 * 23,715 times in a 32 s run, once the 88.7 MiB has landed and the running total is over budget.
 * Those refusals just come after the money is gone, so a row that asserted `declinedBudget > 0`
 * would pass on both trees. Every row below therefore reads the counters **inside the burst**, with
 * nothing settled — which is the one state the two spellings disagree about.
 *
 * So these rows never await inside the burst. The distinguishing fact is not how many bytes the
 * session ends up spending; it is whether the *second* request in a frame can see the first.
 */
describe('§1.6 the budget binds within a single frame (DEC-780)', () => {
  /** Ten requests' worth of estimate, so the binding point is a count rather than a byte total. */
  const TEN_REQUESTS = ART_CROP_ESTIMATED_BYTES * 10

  it('stops asking part-way through ONE frame, before any byte has landed', async () => {
    // `hold` so nothing settles: every request below is outstanding for the whole row, which is the
    // state the shipped one-frame issuer spends its entire first frame in. The pool is far larger
    // than the burst, so a decline here cannot be exhaustion wearing the budget's clothes.
    const h = harness({ layers: 256, byteBudget: TEN_REQUESTS, hold: true })
    for (let key = 0; key < 40; key += 1) {
      h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0)
    }

    const report = h.stream.report()
    // Exactly ten admitted, and the eleventh is the one that crosses. Derived from the estimate
    // rather than written as 10, so a change to the constant moves this row instead of breaking it.
    expect(report.requested).toBe(10)
    expect(report.declinedBudget).toBe(30)
    expect(report.bytesReserved).toBe(TEN_REQUESTS)
    // **Zero bytes have landed.** This is the assertion that separates the fix from the bug: under
    // the pre-DEC-780 spelling `swatchOnly` is `0 >= 921600`, false, and all forty are admitted.
    expect(report.bytesFetched).toBe(0)
    expect(report.swatchOnly).toBe(true)
    // Ten reached the queue; six of them have started, because the concurrency cap is a *queue*
    // and the budget is a *refusal*. Asserting `urls` alone would read 6 and conflate the two — the
    // four that are merely waiting were admitted by the budget and will fetch without asking again.
    expect(h.queue.stats.inFlight).toBe(6)
    expect(h.queue.stats.waiting).toBe(4)
    expect(h.urls).toHaveLength(6)

    // Not exhaustion, and not a poisoned key. §3.1's W4 control needs the causes apart, and a fix
    // that declined for the wrong recorded reason would score W4's control green for the wrong one.
    expect(report.declinedExhausted).toBe(0)
    expect(report.declinedFailedBefore).toBe(0)
    expect(h.pool.reserved).toBe(10)
    await h.settle()
  })

  it('the non-binding control: the SAME burst under a slack budget declines nothing', async () => {
    // Without this row a stream that refused everything after the tenth request — or that had
    // simply capped outstanding requests at ten and called it a budget — passes the row above
    // unchanged. Same burst, same pool, same frame; only the budget moves.
    const h = harness({ layers: 256, byteBudget: TEN_REQUESTS * 100, hold: true })
    for (let key = 0; key < 40; key += 1) {
      h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0)
    }

    const report = h.stream.report()
    expect(report.requested).toBe(40)
    expect(report.declinedBudget).toBe(0)
    expect(report.swatchOnly).toBe(false)
    expect(report.bytesReserved).toBe(ART_CROP_ESTIMATED_BYTES * 40)
    // The six-concurrent cap still holds. It is not what refused anything above: 40 requests reach
    // the queue here and 34 of them are merely waiting, so "queued" and "declined" stay distinct.
    expect(h.queue.stats.inFlight).toBe(6)
    expect(h.queue.stats.waiting).toBe(34)
    await h.settle()
  })

  it('a throwing URL build strands nothing: not the budget, not the slot, not the layer, and it does not reject (DEC-786 N1, DEC-791)', async () => {
    // `imageUri` throws on a printing id shorter than two characters (`data/images.ts`), and it is
    // called in the request literal — which used to leave `fetch` *before* any `try`, so no
    // `finally` and no failure path ran. Unreachable on shipped data (36-char Scryfall ids), which
    // is why this row builds the short id by hand. Four things were stranded by that one throw, and
    // they were fixed in two goes: **DEC-786 N1** moved the charge below the literal, so the 90 KiB
    // is no longer held for the life of the session; **DEC-791** put the literal inside the `try`,
    // so the `inFlight` slot, the pool's RESERVED layer and the discarded promise take the failure
    // path too. All four are scored here, because they share one cause and one line of fix.
    const FOUR = ART_CROP_ESTIMATED_BYTES * 4
    const h = harness({ layers: 256, byteBudget: FOUR, hold: true })

    // `request` discards the fetch promise (`void this.fetch(...)`), so how it settled is only
    // observable at this seam. **Recording the outcome is not the same as catching it, and the
    // difference is this row's history:** DEC-787's version *swallowed* the rejection and asserted
    // that it happened, which is exactly what made this file blind to the leak DEC-791 fixes
    // (DEC-792's hand-off note). This one hands `request` the original promise — so the product's
    // `void` discards precisely what it discards in production — and attaches its recorder on a
    // separate branch. That branch attaches *synchronously*, which is what keeps a regression a RED
    // row here instead of a run-level vitest error that prints all 28 rows green and exits 1.
    const inner = h.stream as unknown as { fetch(...args: never[]): Promise<void> }
    const real = inner.fetch.bind(inner)
    const settled: string[] = []
    inner.fetch = (...args: never[]) => {
      const promise = real(...args)
      void promise.then(
        () => settled.push('resolved'),
        (error: unknown) => settled.push(`REJECTED: ${error instanceof Error ? error.message : String(error)}`),
      )
      return promise
    }

    // The bad key first, so anything it strands is already charged when the valid four ask. `hold`,
    // so nothing settles and no credit can reach `bytesReserved` by the honest route either.
    h.stream.request(0, 'x', TS, () => 0)
    // DEC-786 N1, and also this row's guard against vacuity: on a tree where `imageUri` stopped
    // rejecting short ids the bad key would be admitted like any other and this would read 92,160.
    // Every assertion below the drain would still pass there, so the row needs this line.
    expect(h.stream.report().bytesReserved).toBe(0)

    for (let key = 1; key <= 4; key += 1) {
      h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0)
    }

    const report = h.stream.report()
    // **`bytesReserved` is not the discriminator here, and reading it as one is the trap.** Above
    // the literal the stranded estimate eats one of the four slots, so only three admit — and the
    // running total then reads `3 + 1 = FOUR` exactly as it does below the literal. The row would
    // pass on both trees on this line alone. What separates them is *who* holds those four
    // estimates: three fetches and a ghost, or four fetches. So the line is kept as the budget's
    // own sanity check and the discrimination is carried by the two below it, each of which
    // measured differently on the unfixed tree: `declinedBudget` 1, and three URLs rather than four.
    expect(report.bytesReserved).toBe(FOUR)
    expect(report.declinedBudget).toBe(0)
    // Reserved, not merely counted: four URLs were actually built and handed to the queue. The bad
    // key is not among them, having thrown before `queue.request` — so `requested` reads five while
    // only four can ever fetch, and asserting `requested` alone would not see the difference.
    expect(h.urls).toHaveLength(4)
    expect(report.swatchOnly).toBe(true)
    expect(report.bytesFetched).toBe(0)

    // DEC-791's first residual: the `inFlight` slot. `fetch` enters the key before it builds the
    // URL, and only the settlement path below the `await` removes it, so a throw in between left
    // the entry there for good. Reflected, because the map is private and deliberately has no seam
    // (its two halves are a cancellation concern, not a probe one) — the behavioural consequence is
    // asserted after the drain as well, and that half needs no reflection.
    const inFlight = (h.stream as unknown as { inFlight: Map<number, string> }).inFlight
    expect(inFlight.has(0)).toBe(false)
    expect([...inFlight.keys()]).toEqual([1, 2, 3, 4])

    // **`pool.reserved` is inert before the valid four settle, for the same reason `bytesReserved`
    // is.** The strand displaces an admission, so it reads 4 on both trees. Draining separates
    // them: the requests that really went out become resident, and any layer still RESERVED
    // afterwards is one no fetch will ever come back for.
    await h.drain()
    await h.settle()
    const drained = h.stream.report()
    expect(h.pool.reserved).toBe(0)
    expect(h.pool.resident).toBe(4)
    expect(inFlight.size).toBe(0)
    // The ledger balances: five requests counted, four bodies, one failure. A URL that cannot be
    // built is a failure of this key rather than of the session, and counting it keeps
    // `resolved + failed === requested` — a request that reached neither total is the shape the
    // strand had.
    expect(drained.requested).toBe(5)
    expect(drained.resolved).toBe(4)
    expect(drained.failed).toBe(1)
    // DEC-791's third residual: nothing rejected. Five requests issued, five promises, all of them
    // resolved — so the product's `void this.fetch(...)` discards nothing that could escape. On the
    // pre-fix tree the list is the same length and its **first** entry reads
    // `REJECTED: printing id x is too short`, which is why this is an ordered `toEqual` over five
    // and not a count.
    expect(settled).toEqual(['resolved', 'resolved', 'resolved', 'resolved', 'resolved'])

    // DEC-791's second residual, behaviourally — and the reason the failure path is `pool.fail` and
    // not `pool.release`. A printing id whose URL will not build this frame will not build next
    // frame either, so the key has to leave the askable set (§1.6's "a failed key is never retried
    // in the same session"); releasing it would re-throw once per frame per cell for the life of
    // the session. On the unfixed tree this returns the stranded layer instead of `null`, because
    // `reserve` hands back the layer a key already holds and the `inFlight` entry then suppresses
    // the re-ask — a cell pointed at a layer whose art is never coming.
    h.stream.beginFrame(1)
    expect(h.stream.request(0, 'x', TS, () => 0)).toBeNull()
    expect(h.stream.report().declinedFailedBefore).toBe(1)
    expect(h.urls).toHaveLength(4)
  })

  it('re-consults the budget on LATER frames, which the landed-bytes spelling never did', async () => {
    // The second half of the defect. Even had the first frame bound, `request` returns early for a
    // key that is resident or in flight, so a budget tested only on completion is never reached
    // again by anything. A fresh key on a fresh frame has no early return to hide behind.
    const h = harness({ layers: 256, byteBudget: TEN_REQUESTS, hold: true })
    for (let key = 0; key < 10; key += 1) {
      h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0)
    }
    expect(h.stream.report().declinedBudget).toBe(0)

    h.stream.beginFrame(1)
    expect(h.stream.request(900, `9${ID.slice(1)}`, TS, () => 0)).toBeNull()
    h.stream.beginFrame(2)
    expect(h.stream.request(901, `8${ID.slice(1)}`, TS, () => 0)).toBeNull()
    expect(h.stream.report().declinedBudget).toBe(2)
    await h.settle()
  })

  it('degrading is still not tearing down: the ten it paid for keep their layers', async () => {
    // §1.6's other half, re-asserted under the burst rather than under the serialised rows above,
    // because this fix is the one that could plausibly have broken it: a budget that binds mid-frame
    // is a budget that could start refusing keys it has already reserved.
    const h = harness({ layers: 256, byteBudget: TEN_REQUESTS, hold: true })
    const layers: Array<number | null> = []
    for (let key = 0; key < 40; key += 1) {
      layers.push(h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0))
    }
    await h.drain()

    expect(h.pool.resident).toBe(10)
    expect(h.stream.report().resolved).toBe(10)
    // Every admitted key still answers with the layer it was given, on a frame that is now well
    // past swatch-only. Asking again must be a no-op, not a refusal.
    for (let key = 0; key < 10; key += 1) {
      expect(h.pool.layerOf(key)).toBe(layers[key])
      expect(h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0)).toBe(layers[key])
    }
    expect(h.stream.report().declinedBudget).toBe(30)
  })

  it('gives an over-estimate back, so a cheap session is not throttled by its own guess', async () => {
    // The reconciliation, isolated. Bodies of 1,024 bytes against a 92,160-byte estimate: the burst
    // is refused at ten, and once those ten land the session has actually spent 10,240 bytes and is
    // free to ask again. A charge that was never credited back — or one that predicted sizes and
    // never corrected them — leaves the stream swatch-only for a budget it did not spend, which is
    // this fix failing in the direction opposite to the bug.
    const h = harness({ layers: 256, byteBudget: TEN_REQUESTS, bytes: 1_024, hold: true })
    for (let key = 0; key < 20; key += 1) {
      h.stream.request(key, `${key}${ID.slice(2)}`, TS, () => 0)
    }
    expect(h.stream.report().declinedBudget).toBe(10)
    expect(h.stream.swatchOnly).toBe(true)

    await h.drain()
    expect(h.stream.report().bytesReserved).toBe(0)
    expect(h.stream.report().bytesFetched).toBe(10 * 1_024)
    expect(h.stream.swatchOnly).toBe(false)
    expect(h.stream.request(500, `5${ID.slice(1)}`, TS, () => 0)).not.toBeNull()
  })

  it('credits the estimate back on every way a request can settle, not just success', async () => {
    // Four settlements, one per branch of `ImageResult`, each in its own stream so the row names
    // which branch leaked if it fails. A branch that returned without releasing its reservation
    // ratchets `bytesReserved` up for the session; `dropped` and `cancelled` are the easy ones to
    // miss, because neither goes through the byte-charging path at all.
    const resolved = harness({ layers: 8 })
    resolved.stream.request(1, ID, TS, () => 0)
    await resolved.settle()
    expect(resolved.stream.report().bytesReserved).toBe(0)
    expect(resolved.stream.report().bytesFetched).toBe(BODY_BYTES)

    const failed = harness({ layers: 8, fail: () => true })
    failed.stream.request(1, ID, TS, () => 0)
    await failed.settle()
    expect(failed.stream.report().bytesReserved).toBe(0)

    const dropped = harness({ layers: 8, hold: true })
    dropped.stream.request(1, ID, TS, () => null)
    await dropped.settle()
    expect(dropped.stream.report().bytesReserved).toBe(0)

    const cancelled = harness({ layers: 8, hold: true })
    cancelled.stream.request(1, ID, TS, () => 0)
    await cancelled.settle()
    expect(cancelled.stream.report().bytesReserved).toBe(ART_CROP_ESTIMATED_BYTES)
    cancelled.stream.reset()
    await cancelled.settle()
    // `reset()` cancels, the cancellation *resolves* — `cancel` settles a waiting request with
    // `CANCELLED` and an in-flight abort is caught in `run()`, so `queue.request` has no reject
    // path at all (DEC-786 N3) — and the `finally` credits the estimate back on that resolve, so
    // a reservation cannot outlive a dataset swap. This row does **not** separate the running sum
    // from `inFlight.size * ART_CROP_ESTIMATED_BYTES` — the derived spelling reads zero here too,
    // and passes every row in this file. That mutant is equivalent for the reason `bytesReserved`'s
    // declaration gives, and it is recorded there rather than chased with a contrived row.
    expect(cancelled.stream.report().bytesReserved).toBe(0)
  })

  it('pins the estimate itself, since every row above is derived from it', () => {
    // Derived assertions cannot see a change to the thing they derive from. 90 KiB is Scryfall's
    // median art_crop, under the 96,159-byte mean measured over all 967 fetches at §3.1's pose, so
    // reconciliation corrects upward rather than throttling a session on a guess.
    expect(ART_CROP_ESTIMATED_BYTES).toBe(92_160)
    expect(ART_CROP_ESTIMATED_BYTES).toBeLessThan(96_159)
  })

  it('admits `byteBudget / estimate` requests AT ONCE — what the estimate actually bounds', () => {
    // The count law, stated as what it is after DEC-812: a bound on how many bodies may be
    // outstanding simultaneously with an empty pool behind them, not on what a session will ever
    // fetch. The pool is far larger than the admission count, so the pool cannot be what refused.
    const BUDGET = ART_CROP_ESTIMATED_BYTES * 50
    const h = harness({ layers: 512, byteBudget: BUDGET, hold: true })
    for (let key = 0; key < 80; key += 1) h.stream.request(key, `${key}${ID.slice(3)}`, TS, () => 0)
    const report = h.stream.report()
    expect(Math.floor(BUDGET / ART_CROP_ESTIMATED_BYTES)).toBe(50)
    expect(report.requested).toBe(50)
    expect(report.declinedBudget).toBe(80 - 50)
    expect(report.declinedExhausted).toBe(0)
    expect(report.bytesFetched).toBe(0)
  })
})

/**
 * The budget is a bound on **outstanding** spend, and eviction reclaims (DEC-812).
 *
 * Every row in the block above lets the budget fill and then asks whether it bound. None of them
 * asks whether it ever *un*-binds, and it never did: `bytesFetched` is monotonic, so once a session
 * had spent 64 MiB the stream was swatch-only for the life of the page. Leg G's 45-world acceptance
 * tour is what made that visible — full art through the eighth world, **0.000 on all thirty-seven
 * after it**, `pool.evictions` reading 0 throughout because the budget refused before the pool was
 * ever consulted, so the LRU never ran.
 *
 * **What separates the trees is not that declines happen.** The unfixed tour declined 3,052,268
 * times; a fixed tree declines too, whenever a burst out-runs the pool. So no row here gates on
 * `declinedBudget > 0` (§1.6's own note, DEC-791). What separates them is that a fixed session's
 * `resolved` keeps moving and its evictions are non-zero — art arriving at the *fortieth* world.
 *
 * Bodies below are **distinct sizes**, which the rows above did not need. A reclaim that credits
 * back a constant — the estimate, a running mean, anything uniform — is indistinguishable from one
 * that credits the evicted key's own body while every body weighs the same.
 */
describe('§1.6 the budget releases what the pool evicts (DEC-812)', () => {
  /** Eight cells per world, five worlds, one pool that holds exactly one world. */
  const PER_WORLD = 8
  const WORLDS = 5

  /** A printing id per (world, cell), and the size of the body it returns. */
  const idOf = (world: number, cell: number): string => `w${world}c${cell}${ID.slice(4)}`
  /** Distinct per key, and unlike every default: no two bodies weigh the same. */
  const sizeOf = (world: number, cell: number): number => BODY_BYTES + world * 1_301 + cell * 137
  /** The harness hands back the URL; `imageUri` puts the printing id in it verbatim. */
  const sizeForUrl = (url: string): number => {
    const id = /\/([^/]+)\.jpg/.exec(url)?.[1] ?? ''
    const parsed = /^w(\d+)c(\d+)/.exec(id)
    if (!parsed) throw new Error(`unroutable art url ${url}`)
    return sizeOf(Number(parsed[1]), Number(parsed[2]))
  }
  const worldTotal = (world: number): number =>
    Array.from({ length: PER_WORLD }, (_, cell) => sizeOf(world, cell)).reduce((a, b) => a + b, 0)

  /** Past §1.6's 30-frame grace window, so the previous world's layers are evictable. */
  const frameOf = (world: number): number => world * 100

  it('gives every world art, not just the ones before the budget filled', async () => {
    // **The composition row, and the one the unfixed tree fails.** A pool that holds exactly one
    // world, visited five times over, under the *shipped* derived default — no contrived budget.
    // On the unfixed tree the landed total is monotonic: world 2 gets six of its eight cells and
    // worlds 3, 4 and 5 get nothing at all, which is leg G's tour in miniature.
    const h = harness({ layers: PER_WORLD, bytes: sizeForUrl })
    expect(h.stream.byteBudget).toBe(defaultByteBudget(PER_WORLD))

    for (let world = 0; world < WORLDS; world += 1) {
      h.stream.beginFrame(frameOf(world))
      for (let cell = 0; cell < PER_WORLD; cell += 1) {
        h.stream.request(world * 100 + cell, idOf(world, cell), TS, () => cell)
      }
      await h.drain()
      // Every cell of the world in front of the camera is showing its own art, on world 5 exactly
      // as on world 1. This is the assertion that reads 0-of-8 on the unfixed tree from world 3 on.
      for (let cell = 0; cell < PER_WORLD; cell += 1) {
        expect(h.pool.layerOf(world * 100 + cell)).not.toBeNull()
      }
      expect(h.pool.resident).toBe(PER_WORLD)
      expect(h.stream.swatchOnly).toBe(false)
    }

    const report = h.stream.report()
    expect(report.requested).toBe(WORLDS * PER_WORLD)
    expect(report.resolved).toBe(WORLDS * PER_WORLD)
    expect(report.declinedBudget).toBe(0)
    // Non-zero evictions are the mechanism, and they read **0 on all 45 worlds** of the unfixed
    // tour: four world-transitions, a whole pool recycled at each.
    expect(h.pool.report().evictions).toBe((WORLDS - 1) * PER_WORLD)
    // Outstanding is the last world's bodies and nothing else — the four before it were credited
    // back as their layers went. `bytesFetched` is all forty, and it is **over budget**, which is
    // exactly right: a session that has toured five worlds has legitimately fetched more art than
    // any one of them can hold.
    expect(report.bytesOutstanding).toBe(worldTotal(WORLDS - 1))
    expect(report.bytesFetched).toBe(
      Array.from({ length: WORLDS }, (_, w) => worldTotal(w)).reduce((a, b) => a + b, 0),
    )
    expect(report.bytesFetched).toBeGreaterThan(h.stream.byteBudget)
    // …and that last line passes on the unfixed tree too, which is why it is not the discriminator.
    // The pair above it — `resolved` at forty and evictions non-zero — is.
  })

  it("credits back the evicted key's OWN body, not a constant", async () => {
    // The mutant: reclaim `ART_CROP_ESTIMATED_BYTES`, or the mean, or any fixed figure. With one
    // body size in play that mutant is invisible; with eight distinct ones it lands on the wrong
    // number. One eviction, named and arithmetically pinned.
    const h = harness({ layers: PER_WORLD, bytes: sizeForUrl })
    h.stream.beginFrame(frameOf(0))
    for (let cell = 0; cell < PER_WORLD; cell += 1) {
      h.stream.request(cell, idOf(0, cell), TS, () => cell)
    }
    await h.drain()
    expect(h.stream.report().bytesOutstanding).toBe(worldTotal(0))

    // One new key on a later frame. The pool is full, so it evicts the least-recently-wanted layer
    // — layer 0, holding cell 0, since the whole world was touched on one frame and the LRU scan
    // takes the first of the tied.
    h.stream.beginFrame(frameOf(1))
    expect(h.stream.request(999, idOf(1, 0), TS, () => 0)).not.toBeNull()
    expect(h.pool.layerOf(0)).toBeNull()
    expect(h.pool.report().evictions).toBe(1)
    // Credited the moment the pool displaced it, before the replacement's body exists.
    expect(h.stream.report().bytesOutstanding).toBe(worldTotal(0) - sizeOf(0, 0))
    await h.drain()
    expect(h.stream.report().bytesOutstanding).toBe(worldTotal(0) - sizeOf(0, 0) + sizeOf(1, 0))

    // The three constants a reclaim would plausibly be written with, each shown to give a different
    // answer. Without these the row asserts a number that several wrong implementations also hit.
    for (const wrong of [ART_CROP_ESTIMATED_BYTES, ART_CROP_ADMITTED_MEAN_BYTES, sizeOf(0, 7)]) {
      expect(wrong).not.toBe(sizeOf(0, 0))
    }
  })

  it('binds on resident bytes with nothing in flight, which is the new predicates own domain', async () => {
    // The row that kills a hardcoded `swatchOnly = false`, with an injected budget that actually
    // binds — a bound-check is vacuous while the bound never binds. It also pins the boundary
    // `ArtStreamOptions.byteBudget` documents: a budget set BELOW a full pool is a deliberate spend
    // cap. The pool still has fourteen free layers here, so nothing will ever ask it for one,
    // nothing will be evicted, and nothing will be reclaimed — §1.6's "over budget the stream stops
    // asking", which is correct behaviour for a hand-set cap and is precisely why the *default* is
    // derived from the pool instead.
    // Exactly two bodies, not two-and-a-byte: the predicate is `>=`, so the budget has to be the
    // pair's own weight for residency alone to reach it with nothing in flight.
    const h = harness({ layers: 16, byteBudget: BODY_BYTES * 2 })
    for (const key of [1, 2]) {
      h.stream.request(key, `${key}${ID.slice(1)}`, TS, () => 0)
      await h.settle()
    }
    const report = h.stream.report()
    // Nothing in flight: the whole charge is residency, so this row cannot pass on `bytesReserved`.
    expect(report.bytesReserved).toBe(0)
    expect(report.bytesOutstanding).toBe(BODY_BYTES * 2)
    expect(h.stream.swatchOnly).toBe(true)
    expect(h.stream.request(3, `3${ID.slice(1)}`, TS, () => 0)).toBeNull()
    expect(h.stream.report().declinedBudget).toBe(1)
    expect(h.pool.resident).toBe(2)
    expect(h.pool.report().evictions).toBe(0)
  })

  it('sizes the default ABOVE a full pool, which is what keeps the reclaim reachable', () => {
    // Design consequence 3 of the ruling. If the default sat below a full pool's settled cost, a
    // full pool would sit *at* the budget, nothing further would be asked for, nothing would be
    // evicted and nothing reclaimed — DEC-812's deadlock rebuilt in residency spelling. The retired
    // 64 MiB was exactly there: 1,024 layers at the admitted mean is 98.6 MiB.
    expect(1024 * ART_CROP_ADMITTED_MEAN_BYTES).toBeGreaterThan(64 * 1024 * 1024)
    for (const layers of [16, 128, 256, 1024]) {
      expect(defaultByteBudget(layers)).toBeGreaterThan(layers * ART_CROP_ADMITTED_MEAN_BYTES)
    }
    // Responds to its input rather than returning a constant, and by the factor it claims to.
    expect(defaultByteBudget(256)).toBe(defaultByteBudget(128) * 2)
    expect(defaultByteBudget(1)).toBe(Math.ceil(ART_CROP_ADMITTED_MEAN_BYTES * BYTE_BUDGET_HEADROOM))
    expect(BYTE_BUDGET_HEADROOM).toBeGreaterThan(1)
    // The zero-layer floor. A pool with nothing to give must refuse for EXHAUSTION; a budget of
    // zero would make it refuse for budget, and §3.1's W4 control reads those two apart.
    expect(defaultByteBudget(0)).toBe(defaultByteBudget(1))
  })

  it('lets the POOL refuse first at the shipped default, not the budget', async () => {
    // The behavioural half of the row above: same burst, no injected budget. What runs out is
    // layers, and the cause is recorded as exhaustion — the state `?artThreshold=fixed24` exists to
    // produce, and one a budget that bound first would have stolen.
    const LAYERS = 64
    const h = harness({ layers: LAYERS, hold: true, bytes: sizeForUrl })
    for (let cell = 0; cell < 100; cell += 1) {
      h.stream.request(cell, idOf(0, cell), TS, () => cell)
    }
    const report = h.stream.report()
    expect(h.stream.byteBudget).toBe(defaultByteBudget(LAYERS))
    expect(report.requested).toBe(LAYERS)
    expect(report.declinedExhausted).toBe(100 - LAYERS)
    expect(report.declinedBudget).toBe(0)
    expect(report.swatchOnly).toBe(false)
    await h.drain()
  })

  it('charges a decode failure to the ledger and NOT to outstanding', async () => {
    // Design consequence 2. The body crossed the wire, so §1.6 charges it; but `pool.fail` hands
    // the reservation straight back, so no layer stands behind it and no eviction could ever credit
    // it. An outstanding charge with nothing resident behind it is charge that stands for the life
    // of the page — DEC-812 at one key's scale. What bounds this path instead is the no-retry set.
    const h = harness({ layers: 8, decodeThrows: true })
    h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    const report = h.stream.report()
    expect(report.failed).toBe(1)
    expect(report.bytesFetched).toBe(BODY_BYTES)
    expect(report.bytesOutstanding).toBe(0)
    expect(h.pool.resident).toBe(0)
    // The bound on the path, asserted rather than asserted-about: the key cannot be asked for again.
    expect(h.stream.request(1, ID, TS, () => 0)).toBeNull()
    expect(h.stream.report().declinedFailedBefore).toBe(1)
    expect(h.urls).toHaveLength(1)
  })

  it('charges a body whose reservation vanished, and leaves nothing outstanding', async () => {
    // The other path that charges without residency: the body lands and `pool.resolve` has no
    // reservation to promote, so the bitmap is dropped. Driven here by taking the reservation back
    // directly — the product's door to this state is a `reset()` between the request and its
    // landing — because what is being asserted is the accounting, not the door.
    const h = harness({ layers: 8, hold: true })
    h.stream.request(1, ID, TS, () => 0)
    await h.settle()
    h.pool.release(1)
    await h.drain()
    const report = h.stream.report()
    expect(report.bytesFetched).toBe(BODY_BYTES)
    expect(report.bytesOutstanding).toBe(0)
    expect(report.bytesReserved).toBe(0)
    expect(report.resolved).toBe(0)
    expect(h.pool.resident).toBe(0)
    expect(h.uploads).toHaveLength(0)
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
