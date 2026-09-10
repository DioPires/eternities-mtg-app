/**
 * Which loaded card a harness focuses (`scene/cards/pickCard.ts`).
 *
 * This selection used to live twice, inside the `?probe=1` install effect and inside the bench
 * drive, where nothing could reach it: both were closures built inside a 180-line `useEffect` over
 * a live WebGL scene. Review §6.3 split those seams out and §6.2 folded the two copies into one,
 * which is what makes it testable — so these are the first assertions it has ever had.
 *
 * The `dfc` path is the one worth pinning. `probe.focusCard({ dfc: true, nth })` is how
 * `verify-browser.mjs` reaches PRD 5.6.5's flip, and the gate on a back face is
 * `cardBackImageUri(...) !== null` rather than `card.b !== null` — split and adventure cards have a
 * second *face* and no second *image*, so a wrong gate here would hand the flip check a card that
 * cannot flip.
 *
 * No casts below, deliberately: every fixture is a real `CardRecord`, so `pnpm typecheck` is what
 * catches a field name this test invented rather than the assertion quietly passing anyway.
 */

import { describe, expect, it } from 'vitest'

import { SizeClass, type CardFaceRecord, type CardLayout, type CardRecord, type PrintingTuple } from '../src/data'
import { pickLoadedCard } from '../src/scene/cards/pickCard'

const PRINTING: PrintingTuple = ['0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00001', 42, 'neo', 1, '123']

function card(options: {
  readonly name?: string
  readonly printings?: number
  readonly layout?: CardLayout
  readonly back?: CardFaceRecord | null
}): CardRecord {
  return {
    u: '0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00001',
    n: options.name ?? 'Test Card',
    m: '{1}',
    t: 'Creature',
    o: '',
    b: options.back ?? null,
    ci: 'W',
    r: SizeClass.Rare,
    l: options.layout ?? 'normal',
    p: Array.from({ length: options.printings ?? 1 }, () => PRINTING),
  }
}

/** Insertion order is the map's, and `dfc` walks it — so these are built in a deliberate order. */
function loaded(entries: readonly (readonly [number, CardRecord])[]): Map<number, CardRecord> {
  return new Map(entries)
}

describe('pickLoadedCard', () => {
  it('has nothing to offer from an empty map', () => {
    expect(pickLoadedCard(loaded([]))).toBe(-1)
    expect(pickLoadedCard(loaded([]), { dfc: true })).toBe(-1)
  })

  it('takes the most printings, so PRD 5.6.7 planets have something to draw', () => {
    const picked = pickLoadedCard(
      loaded([
        [10, card({ name: 'one', printings: 1 })],
        [20, card({ name: 'nine', printings: 9 })],
        [30, card({ name: 'four', printings: 4 })],
      ]),
    )
    expect(picked).toBe(20)
  })

  it('keeps the first of a tie, so repeated calls on one map agree', () => {
    const map = loaded([
      [10, card({ name: 'first', printings: 3 })],
      [20, card({ name: 'second', printings: 3 })],
    ])
    expect(pickLoadedCard(map)).toBe(10)
    expect(pickLoadedCard(map)).toBe(10)
  })

  it('skips a card with no printings at all rather than picking it', () => {
    // `record.p[0]` is undefined here, and every image URI is derived from a printing. A card with
    // none is in the map — the shard carried it — and cannot be drawn.
    const picked = pickLoadedCard(
      loaded([
        [10, card({ name: 'unprintable', printings: 0 })],
        [20, card({ name: 'drawable', printings: 1 })],
      ]),
    )
    expect(picked).toBe(20)
  })

  describe('dfc', () => {
    it('takes a transform card and ignores printing count entirely', () => {
      // The opposite ranking to the default path, which is the point: a `dfc` request must not be
      // answered with the most-printings card just because it has more.
      const map = loaded([
        [10, card({ name: 'many printings', printings: 9 })],
        [20, card({ name: 'transform', layout: 'transform', printings: 1 })],
      ])
      expect(pickLoadedCard(map, { dfc: true })).toBe(20)
      // The same map without the flag ranks them the other way round.
      expect(pickLoadedCard(map)).toBe(10)
    })

    it('refuses a second face that carries no second image', () => {
      // A split card has `b !== null` and no back image. Gating on `card.b !== null` would return
      // it here; `cardBackImageUri` is why this returns -1.
      const split = card({
        name: 'Split Card',
        layout: 'split',
        back: { n: 'Back Half', m: '{2}', t: 'Instant', o: '' },
      })
      expect(split.b).not.toBeNull()
      expect(pickLoadedCard(loaded([[10, split]]), { dfc: true })).toBe(-1)
    })

    it('accepts a meld back, which is a front image under its own id', () => {
      const meld = card({
        name: 'Meld Component',
        layout: 'meld',
        back: {
          n: 'Melded Thing',
          m: '',
          t: 'Legendary Creature',
          o: '',
          id: '0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00002',
          ts: 7,
        },
      })
      expect(pickLoadedCard(loaded([[10, meld]]), { dfc: true })).toBe(10)
    })

    it('walks past `nth` flippable cards in map order', () => {
      const map = loaded([
        [10, card({ name: 'plain' })],
        [20, card({ name: 'first flippable', layout: 'transform' })],
        [30, card({ name: 'plain again' })],
        [40, card({ name: 'second flippable', layout: 'modal_dfc' })],
      ])
      expect(pickLoadedCard(map, { dfc: true, nth: 0 })).toBe(20)
      expect(pickLoadedCard(map, { dfc: true, nth: 1 })).toBe(40)
      // Asking past the end reports nothing rather than wrapping to the first.
      expect(pickLoadedCard(map, { dfc: true, nth: 2 })).toBe(-1)
    })
  })
})
