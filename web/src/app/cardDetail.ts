/**
 * PRD 6.4's card panel needs oracle text, a type line and a printings list, and none of that is in
 * `stars.bin` — it lives in the plane detail shards of PRD 8.3, fetched on focus (PRD 8.7.6).
 *
 * Amendment A1 makes every plane shard uniformly, so there is one code path: a card's shard is
 * `floor(localIndex / shardSize)` and its row inside the shard is `starIndex - shard.starOffset`.
 * No lookup table, which is exactly what A1 bought.
 */

import {
  loadPlaneShard,
  shardIndexFor,
  type CardRecord,
  type PlaneRecord,
  type PlaneShardFile,
} from '../data'

const shards = new Map<string, Promise<PlaneShardFile>>()

export function shardKey(slug: string, shard: number): string {
  return `${slug}.${shard}`
}

export function fetchShard(slug: string, shard: number): Promise<PlaneShardFile> {
  const key = shardKey(slug, shard)
  const existing = shards.get(key)
  if (existing) return existing
  const promise = loadPlaneShard(slug, shard).catch((error: unknown) => {
    // A failed shard must not be cached as a permanent hole: the next focus retries.
    shards.delete(key)
    throw error
  })
  shards.set(key, promise)
  return promise
}

/**
 * The card at a global star index, or `null` if the shard does not hold it.
 *
 * The direct row lookup is checked against the `oracle_id` before it is trusted and falls back to
 * a scan. That is not paranoia about the pipeline: `starOffset` arithmetic is the kind of off-by-a-
 * plane bug that produces a *plausible* wrong card, which is worse than an empty panel, and the
 * check costs one string compare.
 */
export async function loadCard(
  plane: PlaneRecord,
  starIndex: number,
  oracleId: string,
  shardSize: number,
): Promise<CardRecord | null> {
  const localIndex = starIndex - plane.starOffset
  if (localIndex < 0 || localIndex >= plane.starCount) return null
  const shard = await fetchShard(plane.slug, shardIndexFor(localIndex, shardSize))
  const row = shard.cards[starIndex - shard.starOffset]
  if (row && row.u === oracleId) return row
  return shard.cards.find((card) => card.u === oracleId) ?? null
}
