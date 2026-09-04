/**
 * PRD 6.9's random control, as a pure function of the plane roster.
 *
 * "Choose a plane (Blind Eternities included, zero-card planes excluded) with probability
 * proportional to the square root of its card count, then a uniform card within it."
 *
 * The square root is the whole point: uniform-over-cards would land in the Blind Eternities most
 * of the time (it is a fifth of the dataset in the scale fixture), and uniform-over-planes would
 * send a fifth of the clicks to a plane with nine cards. `Math.random` is injectable so the
 * distribution is testable rather than merely plausible.
 *
 * PRD 6.9.2: random ignores active filters. No filter state reaches this file, which is the
 * cheapest way to keep that true.
 */

import type { PlaneRecord } from '../data'

export interface RandomPick {
  readonly plane: PlaneRecord
  /** Global index into `stars.bin`, which `sets.bin` turns into an `oracle_id`. */
  readonly starIndex: number
}

/**
 * `starCount` and not `cardCount` bounds the uniform draw: the weight is a product decision (PRD
 * 6.9.1 says card count) but the index has to be one that `stars.bin` actually holds, and a
 * roster row whose two counts disagree would otherwise produce an out-of-range star.
 */
export function pickRandom(
  planes: readonly PlaneRecord[],
  random: () => number = Math.random,
): RandomPick | null {
  let total = 0
  const eligible: PlaneRecord[] = []
  const weights: number[] = []
  for (const plane of planes) {
    if (plane.cardCount <= 0 || plane.starCount <= 0) continue
    const weight = Math.sqrt(plane.cardCount)
    eligible.push(plane)
    weights.push(weight)
    total += weight
  }
  if (eligible.length === 0) return null

  let ticket = random() * total
  let chosen = eligible[eligible.length - 1]!
  for (let i = 0; i < eligible.length; i += 1) {
    ticket -= weights[i]!
    if (ticket < 0) {
      chosen = eligible[i]!
      break
    }
  }

  const offset = Math.min(chosen.starCount - 1, Math.floor(random() * chosen.starCount))
  return { plane: chosen, starIndex: chosen.starOffset + offset }
}
