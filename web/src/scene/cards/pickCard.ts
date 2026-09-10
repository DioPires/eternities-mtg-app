/**
 * Which loaded card a harness should focus.
 *
 * One implementation for the two seams that ask. `probe.focusCard` and `benchDrive.focusCard` each
 * carried this loop, and the bench's copy said so in a comment — "the same choice `probe.focusCard`
 * makes, for the same reason" — which is a duplication waiting to diverge (review §6.2).
 *
 * Default: cards ranked by printing count, most first, and `nth` indexes that ranking — so PRD
 * 5.6.7's planets have something to draw, and a caller can walk several distinct cards (DEC-714).
 * `dfc`: walk the map in insertion order and take the nth card that has a back face, for PRD
 * 5.6.5's flip.
 */

import { cardBackImageUri, type CardRecord } from '../../data'

export interface PickCardOptions {
  readonly dfc?: boolean
  readonly nth?: number
}

/** @returns the global star index, or -1 if there is no `nth` card. */
export function pickLoadedCard(
  cards: ReadonlyMap<number, CardRecord>,
  options: PickCardOptions = {},
): number {
  const wantsBack = options.dfc === true
  const nth = options.nth ?? 0

  if (wantsBack) {
    let skip = nth
    for (const [star, record] of cards) {
      const printing = record.p[0]
      if (!printing) continue
      if (cardBackImageUri(record, printing, 'large') === null) continue
      if (skip > 0) {
        skip -= 1
        continue
      }
      return star
    }
    return -1
  }

  // Most printings first, so PRD 5.6.7's planets have something to draw — and `nth` walks that
  // order rather than being ignored, which is what the `Probe` contract has always said and what a
  // caller measuring the planet path needs: `nth: 0` alone re-focuses one card, and `show` is
  // idempotent for the same star, so it rebuilds no planets at all.
  const ranked: Array<{ star: number; printings: number }> = []
  for (const [star, record] of cards) {
    if (!record.p[0]) continue
    ranked.push({ star, printings: record.p.length })
  }
  // Ties broken by star index so the order is stable across calls in one session; a tour that
  // revisited `nth` and got a different card would measure nothing repeatable.
  ranked.sort((a, b) => b.printings - a.printings || a.star - b.star)
  return ranked[nth]?.star ?? -1
}
