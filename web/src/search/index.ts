/**
 * PRD 6.5's client-side search index, built once from `search.json` (PRD 6.5.5: "loaded once right
 * after the first frame … no network round trip per keystroke").
 *
 * What this module owns: the index, the query, and the grouping of PRD 6.5.3 — Planes, Sets,
 * Cards, in that order, up to 8 per group. What it deliberately does not own: what selecting a
 * result *does* (PRD 6.5.4), which is navigation and lives in the UI, and the plane a card belongs
 * to, which comes from `stars.bin` and not from `search.json`.
 *
 * PRD 6.5.6 is a non-feature here and that is the point: "search respects nothing about active
 * filters". No filter state reaches this file.
 */

import type { SearchFile, SearchSetRecord, StarIndex } from '../data'
import { SCORE_STRONG, matchScore, typoBudget, typoScore } from './fuzzy'

export interface PlaneHit {
  readonly kind: 'plane'
  readonly slug: string
  readonly name: string
  readonly cardCount: number
  readonly score: number
}

export interface SetHit {
  readonly kind: 'set'
  readonly id: number
  readonly code: string
  readonly name: string
  readonly year: number
  /** `null` is PRD 6.5.4's reprint-only set: no Appendix B row, no plane. */
  readonly planeSlug: string | null
  readonly cardCount: number
  readonly score: number
}

export interface CardHit {
  readonly kind: 'card'
  readonly starIndex: StarIndex
  /** The name to show — the face that matched (PRD 6.5.2). */
  readonly name: string
  /** The front-face name, when a back face is what matched, so the row can say "Stomp // …". */
  readonly frontName: string
  readonly face: 'front' | 'back'
  readonly score: number
}

export type SearchHit = PlaneHit | SetHit | CardHit

export interface SearchResults {
  readonly query: string
  readonly planes: readonly PlaneHit[]
  readonly sets: readonly SetHit[]
  readonly cards: readonly CardHit[]
  /** Every hit in PRD 6.5.3's display order, which is also the arrow-key order. */
  readonly flat: readonly SearchHit[]
}

export const EMPTY_RESULTS: SearchResults = {
  query: '',
  planes: [],
  sets: [],
  cards: [],
  flat: [],
}

/** PRD 6.5.3. */
export const RESULTS_PER_GROUP = 8

interface IndexedPlane {
  readonly slug: string
  readonly name: string
  readonly lower: string
  readonly cardCount: number
}

interface IndexedSet {
  readonly record: SearchSetRecord
  readonly lowerName: string
  readonly lowerCode: string
}

export interface SearchIndex {
  readonly planes: readonly IndexedPlane[]
  readonly sets: readonly IndexedSet[]
  readonly cardNames: readonly string[]
  readonly cardLower: readonly string[]
  /** Sparse second faces, as parallel arrays so the hot loop never touches a tuple. */
  readonly backStarIndex: Uint32Array
  readonly backNames: readonly string[]
  readonly backLower: readonly string[]
  readonly starCount: number
  nameOf(starIndex: StarIndex): string
}

export function buildSearchIndex(file: SearchFile): SearchIndex {
  const planes: IndexedPlane[] = file.planes.map((plane) => ({
    slug: plane.slug,
    name: plane.name,
    lower: plane.name.toLowerCase(),
    cardCount: plane.cardCount,
  }))
  const sets: IndexedSet[] = file.sets.map((record) => ({
    record,
    lowerName: record.name.toLowerCase(),
    lowerCode: record.code.toLowerCase(),
  }))
  const cardNames = file.cardNames
  const cardLower = cardNames.map((name) => name.toLowerCase())

  const backStarIndex = new Uint32Array(file.backNames.length)
  const backNames: string[] = new Array<string>(file.backNames.length)
  const backLower: string[] = new Array<string>(file.backNames.length)
  for (let i = 0; i < file.backNames.length; i += 1) {
    const pair = file.backNames[i]!
    backStarIndex[i] = pair[0]
    backNames[i] = pair[1]
    backLower[i] = pair[1].toLowerCase()
  }

  return {
    planes,
    sets,
    cardNames,
    cardLower,
    backStarIndex,
    backNames,
    backLower,
    starCount: file.starCount,
    nameOf(starIndex) {
      return cardNames[starIndex] ?? ''
    },
  }
}

/**
 * A fixed-capacity min-heap-ish top-N collector.
 *
 * Kept as a linear insert into a tiny array rather than a sort of every candidate: 30k card names
 * scored per keystroke would otherwise mean a 30k-element sort, and only 8 of them survive.
 */
class TopN<T extends { readonly score: number }> {
  private readonly items: T[] = []
  private worst = -Infinity

  constructor(private readonly limit: number) {}

  get threshold(): number {
    return this.items.length < this.limit ? -Infinity : this.worst
  }

  get size(): number {
    return this.items.length
  }

  /** The best score seen, or `-Infinity`. Used to decide whether the typo pass is worth running. */
  get best(): number {
    return this.items[0]?.score ?? -Infinity
  }

  add(item: T): void {
    if (this.items.length === this.limit && item.score <= this.worst) return
    let at = this.items.length
    while (at > 0 && this.items[at - 1]!.score < item.score) at -= 1
    this.items.splice(at, 0, item)
    if (this.items.length > this.limit) this.items.pop()
    this.worst = this.items[this.items.length - 1]?.score ?? -Infinity
  }

  drain(): T[] {
    return this.items
  }
}

function searchPlanes(index: SearchIndex, needle: string, budget: number): PlaneHit[] {
  const top = new TopN<PlaneHit>(RESULTS_PER_GROUP)
  for (const plane of index.planes) {
    let score = matchScore(plane.lower, needle)
    if (score === 0 && budget > 0) score = typoScore(plane.lower, needle, budget)
    if (score > 0) {
      top.add({
        kind: 'plane',
        slug: plane.slug,
        name: plane.name,
        cardCount: plane.cardCount,
        score,
      })
    }
  }
  return top.drain()
}

function searchSets(index: SearchIndex, needle: string, budget: number): SetHit[] {
  const top = new TopN<SetHit>(RESULTS_PER_GROUP)
  for (const entry of index.sets) {
    // A set code is short and exact: "mh2" should find Modern Horizons 2 outright, so the code is
    // scored alongside the name and the better of the two wins.
    let score = Math.max(
      matchScore(entry.lowerName, needle),
      entry.lowerCode === needle ? 1200 : matchScore(entry.lowerCode, needle),
    )
    if (score === 0 && budget > 0) score = typoScore(entry.lowerName, needle, budget)
    if (score > 0) {
      const record = entry.record
      top.add({
        kind: 'set',
        id: record.id,
        code: record.code,
        name: record.name,
        year: record.year,
        planeSlug: record.planeSlug,
        cardCount: record.cardCount,
        score,
      })
    }
  }
  return top.drain()
}

/**
 * Cards, over both faces (PRD 6.5.2: "double-faced cards match on either face name" — and the data
 * contract notes `backNames` covers split and adventure cards too, so "Stomp" finds Bonecrusher
 * Giant).
 *
 * One star index yields at most one hit: the better-scoring face wins, so a card whose two faces
 * both match does not occupy two of the eight rows.
 */
function searchCards(index: SearchIndex, needle: string, budget: number): CardHit[] {
  const top = new TopN<CardHit>(RESULTS_PER_GROUP)
  const bestByStar = new Map<StarIndex, number>()

  const offer = (starIndex: StarIndex, name: string, face: 'front' | 'back', score: number): void => {
    const previous = bestByStar.get(starIndex)
    if (previous !== undefined && previous >= score) return
    bestByStar.set(starIndex, score)
    top.add({
      kind: 'card',
      starIndex,
      name,
      frontName: index.cardNames[starIndex] ?? name,
      face,
      score,
    })
  }

  const lower = index.cardLower
  for (let i = 0; i < lower.length; i += 1) {
    const score = matchScore(lower[i]!, needle)
    if (score > 0) offer(i, index.cardNames[i]!, 'front', score)
  }
  for (let i = 0; i < index.backLower.length; i += 1) {
    const score = matchScore(index.backLower[i]!, needle)
    if (score > 0) offer(index.backStarIndex[i]!, index.backNames[i]!, 'back', score)
  }

  // PRD 6.5.2's typo tolerance, second pass. Skipped entirely when the exact pass already filled
  // the group with strong matches — that is the common case and it keeps the common case cheap.
  if (budget > 0 && (top.size < RESULTS_PER_GROUP || top.best < SCORE_STRONG)) {
    for (let i = 0; i < lower.length; i += 1) {
      if (bestByStar.has(i)) continue
      const score = typoScore(lower[i]!, needle, budget)
      if (score > 0) offer(i, index.cardNames[i]!, 'front', score)
    }
    for (let i = 0; i < index.backLower.length; i += 1) {
      const starIndex = index.backStarIndex[i]!
      if (bestByStar.has(starIndex)) continue
      const score = typoScore(index.backLower[i]!, needle, budget)
      if (score > 0) offer(starIndex, index.backNames[i]!, 'back', score)
    }
  }

  // De-duplicate: `offer` may have added a star twice when a later, better face displaced an
  // earlier one inside the heap. Keep the best row per star, in rank order.
  const seen = new Set<StarIndex>()
  const hits: CardHit[] = []
  for (const hit of top.drain()) {
    if (seen.has(hit.starIndex)) continue
    seen.add(hit.starIndex)
    hits.push(hit)
  }
  return hits
}

export function search(index: SearchIndex | null, rawQuery: string): SearchResults {
  const query = rawQuery.trim()
  if (index === null || query.length === 0) return { ...EMPTY_RESULTS, query }
  const needle = query.toLowerCase()
  const budget = typoBudget(needle.length)

  const planes = searchPlanes(index, needle, budget)
  const sets = searchSets(index, needle, budget)
  const cards = searchCards(index, needle, budget)
  return { query, planes, sets, cards, flat: [...planes, ...sets, ...cards] }
}

export function hitKey(hit: SearchHit): string {
  if (hit.kind === 'plane') return `plane:${hit.slug}`
  if (hit.kind === 'set') return `set:${hit.id}`
  return `card:${hit.starIndex}:${hit.face}`
}

export * from './fuzzy'
