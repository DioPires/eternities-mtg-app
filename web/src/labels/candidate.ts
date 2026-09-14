/**
 * What a plane contributes to the label solver, as one function (PRD 5.3.8–12).
 *
 * Split out of `PlaneLabels.tsx` so that a measurement of the label layer can build its candidates
 * the way the product does rather than the way the measurement remembers the product doing it
 * (DEC-779 X2). The fields here are not incidental to those measurements — `priority` in
 * particular is the subject of `test/label-priority-order.test.ts`, which exists to say what
 * changing it would and would not buy. While it was a private function and the harnesses each
 * rebuilt the record by hand, changing this line to a constant, to `sqrt`, or to the *inverted*
 * order that same test measures as the worst of the three left all 968 tests green: the one test
 * whose subject is this line could not see it move.
 *
 * It is deliberately free of React and of the frame-state fields. A candidate is reused across
 * frames (PRD 7.3.2) and its projected half — `x`, `y`, `radiusPx`, `depth`, `onScreen` — is
 * overwritten every tick, so those start at zero and mean nothing until the first projection.
 */

import type { PlaneRecord } from '../data/types'

/** A mutable candidate record, reused every frame (PRD 7.3.2). */
export interface MutableCandidate {
  key: string
  text: string
  sub: string | null
  tier: 'plane' | 'band'
  priority: number
  x: number
  y: number
  radiusPx: number
  depth: number
  onScreen: boolean
  widthPx: number
}

export function candidateFor(plane: PlaneRecord): MutableCandidate {
  return {
    key: plane.slug,
    text: plane.displayName,
    // PRD 5.3.12: the card count sits beneath the name, and a zero-card plane shows none.
    sub: plane.cardCount > 0 ? `${plane.cardCount}` : null,
    tier: 'plane',
    priority: plane.cardCount,
    x: 0,
    y: 0,
    radiusPx: 0,
    depth: 0,
    onScreen: false,
    widthPx: 0,
  }
}
