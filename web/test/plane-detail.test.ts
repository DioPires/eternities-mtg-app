/**
 * Runtime plane-detail loading (PRD 8.7.6, amendment A1).
 *
 * Exercised against fixture-scale's real Blind Eternities shards — the case A1 exists for, and the
 * only plane in either fixture that actually shards.
 *
 * The worker is not booted here (Node's `vitest` has no module-worker DOM), so these run the inline
 * path. That is the point of keeping the work in `handlePlaneDetailRequest`: the thread it runs on
 * is a deployment detail, and the ordering, supersede and failure rules are not.
 */

import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPlaneDetailLoader } from '../src/plane-detail/client'
import { BLIND_ETERNITIES_SLUG, type PlaneShardFile } from '../src/data/types'

import { fixturePath, loadFixturePlanes } from './fixtures'

const ROOT = 'https://eternities.test/data/fixture/'
const planes = loadFixturePlanes('scale')
const blindEternities = planes.planes.find((p) => p.slug === BLIND_ETERNITIES_SLUG)!

const realFetch = globalThis.fetch

interface FetchLog {
  readonly urls: string[]
}

/** Serves the committed fixture files, with an optional list of paths that always fail. */
function stubFetch(failing: readonly string[] = []): FetchLog {
  const urls: string[] = []
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    urls.push(url)
    const relative = url.slice(ROOT.length)
    if (failing.includes(relative)) return Promise.resolve(new Response('nope', { status: 503 }))
    try {
      return Promise.resolve(new Response(readFileSync(fixturePath('scale', relative))))
    } catch {
      return Promise.resolve(new Response('missing', { status: 404 }))
    }
  })
  return { urls }
}

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function loadAll(
  slug: string,
  shardCount: number,
  options: { failing?: readonly string[] } = {},
): Promise<{ shards: PlaneShardFile[]; errors: string[]; log: FetchLog }> {
  const log = stubFetch(options.failing ?? [])
  const loader = createPlaneDetailLoader({ root: ROOT, createWorker: () => null })
  const shards: PlaneShardFile[] = []
  const errors: string[] = []
  return new Promise((resolve) => {
    loader.load(slug, shardCount, {
      onShard: (file) => shards.push(file),
      onError: (message) => errors.push(message),
      onComplete: () => {
        loader.dispose()
        resolve({ shards, errors, log })
      },
    })
  })
}

describe('plane detail loading (PRD 8.7.6, amendment A1)', () => {
  it('delivers the Blind Eternities shard by shard, in order', async () => {
    expect(blindEternities.shardCount).toBeGreaterThan(1)
    const { shards, errors } = await loadAll(BLIND_ETERNITIES_SLUG, blindEternities.shardCount)

    expect(errors).toEqual([])
    expect(shards.map((s) => s.shard)).toEqual(
      Array.from({ length: blindEternities.shardCount }, (_, i) => i),
    )
    // Shard order is star-record order, so a card's shard is `floor(local index / 2000)` with no
    // lookup table (PRD 8.3). The offsets have to line up for that to be true.
    for (const shard of shards) {
      expect(shard.starOffset).toBe(blindEternities.starOffset + shard.shard * planes.shardSize)
    }
    const total = shards.reduce((n, s) => n + s.cards.length, 0)
    expect(total).toBe(blindEternities.cardCount)
  })

  it('asks for the next shard only once the previous one has landed', async () => {
    // A plane the user leaves after half a second must not have queued four megabytes it will
    // never read, and the first cards have to be usable before the last shard arrives.
    const { log } = await loadAll(BLIND_ETERNITIES_SLUG, blindEternities.shardCount)
    expect(log.urls).toEqual(
      Array.from(
        { length: blindEternities.shardCount },
        (_, i) => `${ROOT}planes/${BLIND_ETERNITIES_SLUG}.${i}.json`,
      ),
    )
  })

  it('keeps going after a failed shard (PRD 7.4.1)', async () => {
    const bad = `planes/${BLIND_ETERNITIES_SLUG}.1.json`
    const { shards, errors } = await loadAll(BLIND_ETERNITIES_SLUG, blindEternities.shardCount, {
      failing: [bad],
    })

    // One non-blocking error, and the rest of the plane still arrives — a partial panel beats an
    // empty one.
    expect(errors).toHaveLength(1)
    expect(shards.map((s) => s.shard)).toEqual([0, 2, 3])
  })

  it('supersedes the previous plane when focus moves on (PRD 8.7.6)', async () => {
    const log = stubFetch()
    const loader = createPlaneDetailLoader({ root: ROOT, createWorker: () => null })
    const first: number[] = []
    const second: number[] = []

    loader.load(BLIND_ETERNITIES_SLUG, blindEternities.shardCount, {
      onShard: (file) => first.push(file.shard),
    })
    // The user clicked another plane before the first shard came back.
    loader.load('ravnica', 1, { onShard: (file) => second.push(file.shard) })

    await new Promise((resolve) => setTimeout(resolve, 250))
    loader.dispose()

    expect(second).toEqual([0])
    // The abandoned load delivers nothing: its responses are for a stale request id.
    expect(first).toEqual([])
    expect(log.urls.some((u) => u.includes('ravnica'))).toBe(true)
  })

  it('is a no-op for a plane with no shards', async () => {
    const { shards, errors, log } = await loadAll('nowhere', 0)
    expect(shards).toEqual([])
    expect(errors).toEqual([])
    expect(log.urls).toEqual([])
  })
})
