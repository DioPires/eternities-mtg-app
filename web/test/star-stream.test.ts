/**
 * PRD 7.4.1 for `stars.bin`: the retry has to survive a failure *after* the response headers came
 * back, which is the likeliest way the largest artefact in the contract breaks and the one case
 * that used to get no retries at all.
 *
 * Everything here runs against the committed `fixture-small` bytes rather than a hand-rolled
 * header, so "the resumed file is the file" is a byte comparison against what `decodeStars` makes
 * of the same artefact on disk.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { decodeStars, type Stars } from '../src/data/decode'
import { streamStars } from '../src/data/load'
import { STAR_RECORD_BYTES, type PlaneRecord } from '../src/data/types'
import { SceneErrorHub, type SceneDataError } from '../src/scene/errors'
import { PlaneTable } from '../src/scene/starfield/planeTable'
import { StarGeometry } from '../src/scene/starfield/starGeometry'
import { streamStarsIntoScene } from '../src/scene/starfield/starStream'
import { fixturePath, loadFixturePlanes } from './fixtures'

const ROOT = 'https://example.test/data/'

const FILE: Uint8Array = new Uint8Array(readFileSync(fixturePath('small', 'stars.bin')))
const REFERENCE: Stars = decodeStars(FILE.slice().buffer)

interface OriginOptions {
  /** Bytes handed over on each attempt before the connection goes. Past the list: the whole file. */
  readonly deliver?: readonly number[]
  /** How a short attempt ends: a rejected read, or a body that simply stops. */
  readonly ending?: 'error' | 'truncate'
  /** Answer 200 with the whole file even when a `Range` was asked for. */
  readonly ignoreRange?: boolean
  /** Answer 206 starting this far from where it was asked to. Positive is a hole. */
  readonly rangeSkew?: number
  readonly chunkBytes?: number
}

interface Origin {
  readonly fetchImpl: typeof fetch
  /** The `Range` header of each request in order; `null` where none was sent. */
  readonly requests: (string | null)[]
}

/**
 * A byte-serving origin that can drop the connection part-way through a body.
 *
 * Chunks are produced from `pull`, one per read, rather than queued up front: a
 * `ReadableStreamDefaultController` discards its queue when it errors, so a stream that enqueued
 * everything and then errored would deliver nothing at all and quietly test the wrong thing.
 */
function origin(options: OriginOptions = {}): Origin {
  const requests: (string | null)[] = []
  const chunkBytes = options.chunkBytes ?? 512
  let attempt = 0

  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers ?? undefined).get('Range')
    requests.push(range)

    const asked = /^bytes=(\d+)-$/.exec(range ?? '')
    const partial = asked !== null && options.ignoreRange !== true
    const start = partial ? Number(asked[1]) + (options.rangeSkew ?? 0) : 0
    const end = Math.min(FILE.byteLength, start + (options.deliver?.[attempt] ?? FILE.byteLength))
    const short = end < FILE.byteLength
    attempt += 1

    const signal = init?.signal
    let offset = start
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (signal?.aborted === true) {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        if (offset >= end) {
          if (short && options.ending !== 'truncate') {
            controller.error(new Error('connection reset by peer'))
          } else {
            controller.close()
          }
          return
        }
        const next = Math.min(offset + chunkBytes, end)
        controller.enqueue(FILE.slice(offset, next))
        offset = next
      },
    })

    const headers = new Headers()
    if (partial) {
      headers.set('Content-Range', `bytes ${start}-${FILE.byteLength - 1}/${FILE.byteLength}`)
    }
    return Promise.resolve(new Response(body, { status: partial ? 206 : 200, headers }))
  }) as typeof fetch

  return { fetchImpl, requests }
}

/** Index of the first differing byte, `-1` when identical, `-2` when the lengths differ. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.byteLength !== b.byteLength) return -2
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return i
  return -1
}

describe('streamStars resumes a broken body (PRD 7.4.1)', () => {
  it('asks for nothing but the missing bytes, and ends up with the whole file', async () => {
    const server = origin({ deliver: [2000] })
    const drawable: number[] = []
    const retries: number[] = []

    const stars = await streamStars((reader) => drawable.push(reader.completeRecords), {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
      onRetry: (attempt) => retries.push(attempt),
    })

    expect(stars.count).toBe(REFERENCE.count)
    expect(firstDifference(stars.interleaved, REFERENCE.interleaved)).toBe(-1)
    // One failure, one retry — and the second request picks up at exactly the byte the first one
    // stopped on, rather than pulling the file down again.
    expect(retries).toEqual([1])
    expect(server.requests).toEqual([null, 'bytes=2000-'])
    // The draw range only ever grows, which is what the geometry and the plane reveals rely on.
    expect(drawable).toEqual([...drawable].sort((a, b) => a - b))
    expect(drawable.at(-1)).toBe(REFERENCE.count)
  })

  it('sends no Range at all on the first attempt', async () => {
    const server = origin()
    await streamStars(() => {}, { root: ROOT, baseDelayMs: 0, fetchImpl: server.fetchImpl })
    expect(server.requests).toEqual([null])
  })

  it('drops the duplicated prefix when the server ignores the Range', async () => {
    const server = origin({ deliver: [2000], ignoreRange: true })
    const drawable: number[] = []

    const stars = await streamStars((reader) => drawable.push(reader.completeRecords), {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
    })

    // 200 with the whole body, so the bytes already held arrive a second time. They must not be
    // appended: the file would be that much too long and every record past the cut misaligned.
    expect(server.requests).toEqual([null, 'bytes=2000-'])
    expect(stars.count).toBe(REFERENCE.count)
    expect(firstDifference(stars.interleaved, REFERENCE.interleaved)).toBe(-1)
    expect(drawable).toEqual([...drawable].sort((a, b) => a - b))
  })

  it('places a 206 that starts earlier than asked, instead of trusting the offset', async () => {
    // A server free to answer with a wider range than requested is within its rights; the overlap
    // is dropped the same way the ignored-Range case is.
    const server = origin({ deliver: [2000], rangeSkew: -300 })
    const stars = await streamStars(() => {}, {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
    })
    expect(stars.count).toBe(REFERENCE.count)
    expect(firstDifference(stars.interleaved, REFERENCE.interleaved)).toBe(-1)
  })

  it('refuses a 206 that starts past what it holds, rather than splicing in a hole', async () => {
    const server = origin({ deliver: [2000], rangeSkew: 300 })
    await expect(
      streamStars(() => {}, { root: ROOT, baseDelayMs: 0, fetchImpl: server.fetchImpl }),
    ).rejects.toThrow(/Content-Range starts at 2300, past the 2000 bytes held/)
    // The three attempts of PRD 7.4.1, all spent on the same bad answer.
    expect(server.requests).toHaveLength(3)
  })

  it('treats a body that ends early without erroring as a failure, not a short file', async () => {
    // The quiet version: `read()` reports `done`, the file is simply missing its tail, and the old
    // loader returned it as though it were whole — planes past the cut never appearing and nothing
    // ever reported.
    const server = origin({ deliver: [2000], ending: 'truncate' })
    const retries: number[] = []

    const stars = await streamStars(() => {}, {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
      onRetry: (attempt) => retries.push(attempt),
    })

    expect(retries).toEqual([1])
    expect(stars.count).toBe(REFERENCE.count)
    expect(firstDifference(stars.interleaved, REFERENCE.interleaved)).toBe(-1)
  })

  it('resumes more than once, and never re-reads a byte it already has', async () => {
    const server = origin({ deliver: [1000, 1500] })
    const stars = await streamStars(() => {}, {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
    })
    expect(server.requests).toEqual([null, 'bytes=1000-', 'bytes=2500-'])
    expect(stars.count).toBe(REFERENCE.count)
    expect(firstDifference(stars.interleaved, REFERENCE.interleaved)).toBe(-1)
  })

  it('spends the whole budget and then gives up (PRD 7.4.1 three attempts)', async () => {
    const server = origin({ deliver: [1000, 1000, 1000] })
    const retries: number[] = []

    await expect(
      streamStars(() => {}, {
        root: ROOT,
        baseDelayMs: 0,
        fetchImpl: server.fetchImpl,
        onRetry: (attempt) => retries.push(attempt),
      }),
    ).rejects.toThrow(/connection reset/)

    expect(retries).toEqual([1, 2, 3])
    expect(server.requests).toEqual([null, 'bytes=1000-', 'bytes=2000-'])
  })

  it('does not retry an abort — that failure was asked for', async () => {
    const server = origin()
    const controller = new AbortController()

    await expect(
      streamStars(
        () => {
          controller.abort()
        },
        {
          root: ROOT,
          baseDelayMs: 0,
          fetchImpl: server.fetchImpl,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow(/aborted/)

    expect(server.requests).toHaveLength(1)
  })
})

describe('the toast counts the attempts that happened (PRD 7.4.1)', () => {
  interface Scene {
    readonly geometry: StarGeometry
    readonly table: PlaneTable
    readonly planes: readonly PlaneRecord[]
    readonly hub: SceneErrorHub
    readonly reported: SceneDataError[]
  }

  function scene(): Scene {
    const planes = loadFixturePlanes('small').planes
    const hub = new SceneErrorHub()
    const reported: SceneDataError[] = []
    hub.subscribe((error) => reported.push(error))
    return {
      geometry: new StarGeometry(REFERENCE.count),
      table: new PlaneTable(planes, 130),
      planes,
      hub,
      reported,
    }
  }

  it('reports three, not one, when the body dies mid-stream every time', async () => {
    const { geometry, table, planes, hub, reported } = scene()
    const server = origin({ deliver: [1000, 1000, 1000] })

    await streamStarsIntoScene(geometry, table, planes, hub, {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
    })

    expect(reported).toHaveLength(1)
    expect(reported[0]?.attempts).toBe(3)
    expect(reported[0]?.message).toContain('3 attempts')
    // And the scene keeps everything that arrived — across all three attempts, not just the last
    // one. Each resumed attempt picks up where the previous died, so three failures still put
    // three times a single attempt's worth of stars on screen: a partial multiverse, but a bigger
    // one than a restart-from-zero retry could have left.
    expect(geometry.drawCount).toBe(Math.floor((3 * 1000 - 16) / STAR_RECORD_BYTES))
  })

  it('reveals every plane exactly once across a resume, and reports nothing', async () => {
    const { geometry, table, planes, hub, reported } = scene()
    const server = origin({ deliver: [2000] })
    const revealed: string[] = []

    await streamStarsIntoScene(geometry, table, planes, hub, {
      root: ROOT,
      baseDelayMs: 0,
      fetchImpl: server.fetchImpl,
      onPlaneComplete: (plane) => revealed.push(plane.slug),
    })

    expect(reported).toEqual([])
    expect(geometry.drawCount).toBe(REFERENCE.count)
    expect(revealed).toEqual(
      planes
        .filter((plane) => plane.starCount > 0)
        .sort((a, b) => a.starOffset - b.starOffset)
        .map((plane) => plane.slug),
    )
  })
})
