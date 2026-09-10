/**
 * Which loaded card a harness should focus.
 *
 * One implementation for the two seams that ask. `probe.focusCard` and `benchDrive.focusCard` each
 * carried this loop, and the bench's copy said so in a comment — "the same choice `probe.focusCard`
 * makes, for the same reason" — which is a duplication waiting to diverge (review §6.2).
 *
 * Default: the card with the most printings, so PRD 5.6.7's planets have something to draw.
 * `dfc`: walk the map in insertion order and take the nth card that has a back face, for PRD
 * 5.6.5's flip.
 */

import { cardBackImageUri, type CardRecord } from '../../data'

export interface PickCardOptions {
  readonly dfc?: boolean
  readonly nth?: number
}

/** @returns the global star index, or -1 if nothing loaded matches. */
export function pickLoadedCard(
  cards: ReadonlyMap<number, CardRecord>,
  options: PickCardOptions = {},
): number {
  const wantsBack = options.dfc === true
  let skip = options.nth ?? 0
  let best = -1
  let bestPrintings = -1

  for (const [star, record] of cards) {
    const printing = record.p[0]
    if (!printing) continue
    if (wantsBack) {
      if (cardBackImageUri(record, printing, 'large') === null) continue
      if (skip > 0) {
        skip -= 1
        continue
      }
      return star
    }
    if (record.p.length > bestPrintings) {
      bestPrintings = record.p.length
      best = star
    }
  }
  return best
}
