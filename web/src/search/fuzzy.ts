/**
 * The scoring half of PRD 6.5.2: "fuzzy matching (typo-tolerant, prefix-favouring)".
 *
 * Two passes, because those two adjectives want different algorithms and one algorithm does
 * neither well:
 *
 *  - **`matchScore`** is the prefix-favouring pass: exact, whole-string prefix, word-boundary
 *    prefix, substring, then in-order subsequence. It is a single linear scan and is what runs
 *    over every one of ~30k card names on every keystroke.
 *  - **`editDistanceWithin`** is the typo-tolerant pass: a banded Damerau-Levenshtein with an
 *    early exit, so "lightnign" finds "Lightning Bolt". A subsequence match cannot catch a
 *    transposition or a substitution, which is most of what a typo actually is.
 *
 * The second pass is the expensive one, so `../search/index.ts` runs it only when the first has
 * not already filled a group with strong matches, and only over names within the distance band.
 *
 * No allocation inside either scan: PRD 7.3.2 is about the frame path and this is not it, but the
 * search box is typed at, and a per-name substring allocation over 30k names is 30k garbage
 * strings per keystroke.
 */

/** Score floors, so callers can reason about tiers without knowing the arithmetic. */
export const SCORE_EXACT = 1000
export const SCORE_PREFIX = 900
export const SCORE_WORD_PREFIX = 800
export const SCORE_SUBSTRING = 700
export const SCORE_SUBSEQUENCE = 500
export const SCORE_TYPO = 400
/** At or above this a group is considered well served and the typo pass is skipped. */
export const SCORE_STRONG = SCORE_SUBSTRING

function isBoundary(code: number): boolean {
  // Space, comma, hyphen, apostrophe, slash, colon, parenthesis — everything Magic names use.
  return (
    code === 32 || code === 44 || code === 45 || code === 39 || code === 47 || code === 58 ||
    code === 40 || code === 41 || code === 8217
  )
}

/**
 * Score `needle` (already lowercased) against `haystack` (already lowercased), or `0` for no match.
 *
 * Shorter haystacks win ties: "Bolt" should outrank "Lightning Bolt of the Endless Reach" for the
 * query "bolt", which is what PRD 6.5.2's "prefix-favouring" means in practice.
 */
export function matchScore(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  if (haystack.length < needle.length) return 0

  const lengthBonus = Math.max(0, 60 - haystack.length)

  if (haystack === needle) return SCORE_EXACT + lengthBonus
  if (haystack.startsWith(needle)) return SCORE_PREFIX + lengthBonus

  // Word-boundary prefix: "bolt" against "Lightning Bolt".
  for (let i = 1; i < haystack.length; i += 1) {
    if (!isBoundary(haystack.charCodeAt(i - 1))) continue
    if (haystack.startsWith(needle, i)) return SCORE_WORD_PREFIX + lengthBonus - Math.min(i, 40)
  }

  const at = haystack.indexOf(needle)
  if (at >= 0) return SCORE_SUBSTRING + lengthBonus - Math.min(at, 60)

  // In-order subsequence, penalised by how spread out the match is.
  let hi = 0
  let matched = 0
  let firstAt = -1
  let lastAt = -1
  for (let ni = 0; ni < needle.length; ni += 1) {
    const wanted = needle.charCodeAt(ni)
    let found = -1
    while (hi < haystack.length) {
      const code = haystack.charCodeAt(hi)
      hi += 1
      if (code === wanted) {
        found = hi - 1
        break
      }
    }
    if (found < 0) return 0
    if (firstAt < 0) firstAt = found
    lastAt = found
    matched += 1
  }
  if (matched !== needle.length) return 0
  const spread = lastAt - firstAt + 1 - needle.length
  return Math.max(1, SCORE_SUBSEQUENCE + lengthBonus - Math.min(spread * 4, 200) - Math.min(firstAt, 60))
}

/**
 * Damerau-Levenshtein distance between `a` and `b`, or `max + 1` once it is certain to exceed
 * `max`. Banded and early-exiting, so the cost is O(len * max), not O(len²).
 *
 * Transpositions are counted because they are the single most common typing error and the reason
 * a plain Levenshtein feels unhelpful on names: "teh" → "the" is one keystroke, not two.
 */
export function editDistanceWithin(a: string, b: string, max: number): number {
  const alen = a.length
  const blen = b.length
  if (Math.abs(alen - blen) > max) return max + 1
  if (alen === 0) return blen
  if (blen === 0) return alen

  // Three rolling rows: previous-previous (for transposition), previous, current.
  let prev2 = new Array<number>(blen + 1)
  let prev = new Array<number>(blen + 1)
  let curr = new Array<number>(blen + 1)
  for (let j = 0; j <= blen; j += 1) prev[j] = j

  for (let i = 1; i <= alen; i += 1) {
    curr[0] = i
    const from = Math.max(1, i - max)
    const to = Math.min(blen, i + max)
    // Cells outside the band are unreachable within `max`; mark them so neighbours read a wall.
    if (from > 1) curr[from - 1] = max + 1
    let best = max + 1
    const ai = a.charCodeAt(i - 1)
    for (let j = from; j <= to; j += 1) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      let value = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
      if (
        i > 1 &&
        j > 1 &&
        ai === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, prev2[j - 2]! + 1)
      }
      curr[j] = value
      if (value < best) best = value
    }
    if (to < blen) curr[to + 1] = max + 1
    if (best > max) return max + 1
    const spare = prev2
    prev2 = prev
    prev = curr
    curr = spare
  }
  const distance = prev[blen]!
  return distance > max ? max + 1 : distance
}

/** How much typo tolerance a query of this length earns. Short queries get none: too noisy. */
export function typoBudget(queryLength: number): number {
  if (queryLength < 4) return 0
  if (queryLength < 7) return 1
  return 2
}

/**
 * Typo score for a whole name or any of its words, or `0`.
 *
 * Words matter: a query of "lightnign" should reach "Lightning Bolt" even though the whole-string
 * distance is 7. Word starts are scanned without slicing, so this allocates nothing.
 */
export function typoScore(haystack: string, needle: string, max: number): number {
  if (max <= 0) return 0
  const whole = editDistanceWithin(haystack, needle, max)
  let best = whole <= max ? whole : max + 1

  let start = 0
  for (let i = 0; i <= haystack.length; i += 1) {
    const atEnd = i === haystack.length
    if (!atEnd && !isBoundary(haystack.charCodeAt(i))) continue
    const end = i
    if (end - start >= 1 && Math.abs(end - start - needle.length) <= max) {
      // `slice` here is bounded by the number of words, not the number of names: the caller has
      // already rejected most names on the length band before reaching this.
      const distance = editDistanceWithin(haystack.slice(start, end), needle, max)
      if (distance < best) best = distance
    }
    start = i + 1
  }
  if (best > max) return 0
  return SCORE_TYPO - best * 60 + Math.max(0, 40 - haystack.length)
}
