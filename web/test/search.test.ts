/**
 * PRD 6.5's search: grouping, ordering, typo tolerance, both faces, and the reprint-only set that
 * PRD 6.5.4 gives its own behaviour to.
 *
 * Also a scale check. The index is queried on every keystroke over the whole card list (PRD 6.5.5
 * forbids a round trip), so a scoring pass that is fine on twelve names and quadratic on thirty
 * thousand is a real failure mode — the last test builds the real 30k and asserts a budget.
 */

import { describe, expect, it } from 'vitest'

import type { SearchFile } from '../src/data'
import { CONTRACT_VERSION } from '../src/data'
import { RESULTS_PER_GROUP, buildSearchIndex, search } from '../src/search'
import { editDistanceWithin, matchScore, typoBudget } from '../src/search/fuzzy'

const FILE: SearchFile = {
  contractVersion: CONTRACT_VERSION,
  starCount: 8,
  planes: [
    { index: 0, slug: 'blind-eternities', name: 'Blind Eternities', cardCount: 6600 },
    { index: 1, slug: 'dominaria', name: 'Dominaria', cardCount: 2400 },
    { index: 2, slug: 'ravnica', name: 'Ravnica', cardCount: 1800 },
  ],
  sets: [
    { id: 1, code: 'dom', name: 'Dominaria', year: 2018, planeSlug: 'dominaria', cardCount: 269 },
    { id: 2, code: 'grn', name: 'Guilds of Ravnica', year: 2018, planeSlug: 'ravnica', cardCount: 259 },
    // PRD 6.5.4's reprint-only set: no Appendix B row, no plane.
    { id: 3, code: 'mh2', name: 'Modern Horizons 2', year: 2021, planeSlug: null, cardCount: 303 },
  ],
  cardNames: [
    'Lightning Bolt',
    'Lightning Helix',
    'Bolt Hound',
    'Bonecrusher Giant',
    'Fire // Ice',
    'Counterspell',
    'Serra Angel',
    'Shivan Dragon',
  ],
  backNames: [
    [3, 'Stomp'],
    [4, 'Ice'],
  ],
}

const INDEX = buildSearchIndex(FILE)

describe('grouping and order (PRD 6.5.3)', () => {
  it('returns Planes, Sets, Cards in that order in the flat arrow-key list', () => {
    const results = search(INDEX, 'dom')
    expect(results.planes[0]?.name).toBe('Dominaria')
    expect(results.sets[0]?.code).toBe('dom')
    expect(results.flat[0]?.kind).toBe('plane')
    const kinds = results.flat.map((hit) => hit.kind)
    expect(kinds.indexOf('set')).toBeGreaterThan(kinds.indexOf('plane'))
    expect(kinds.lastIndexOf('plane')).toBeLessThan(kinds.indexOf('set'))
  })

  it('caps each group at eight', () => {
    const many: SearchFile = {
      ...FILE,
      starCount: 40,
      cardNames: Array.from({ length: 40 }, (_, i) => `Bolt Number ${String(i)}`),
      backNames: [],
    }
    const results = search(buildSearchIndex(many), 'bolt')
    expect(results.cards).toHaveLength(RESULTS_PER_GROUP)
  })

  it('returns nothing for an empty query', () => {
    expect(search(INDEX, '   ').flat).toEqual([])
  })

  it('returns nothing when the index has not loaded (the box is disabled until it has)', () => {
    expect(search(null, 'bolt').flat).toEqual([])
  })
})

describe('prefix-favouring (PRD 6.5.2)', () => {
  it('ranks a whole-string prefix above a word-boundary one', () => {
    const cards = search(INDEX, 'bolt').cards
    expect(cards[0]?.name).toBe('Bolt Hound')
    expect(cards.map((hit) => hit.name)).toContain('Lightning Bolt')
  })

  it('ranks an exact name first', () => {
    expect(search(INDEX, 'counterspell').cards[0]?.name).toBe('Counterspell')
  })

  it('matches a set by its code outright', () => {
    expect(search(INDEX, 'mh2').sets[0]?.name).toBe('Modern Horizons 2')
  })
})

describe('typo tolerance (PRD 6.5.2)', () => {
  it('finds a transposition', () => {
    expect(search(INDEX, 'lightnign').cards.map((hit) => hit.name)).toContain('Lightning Bolt')
  })

  it('finds a substitution inside a word', () => {
    expect(search(INDEX, 'countersqell').cards[0]?.name).toBe('Counterspell')
  })

  it('gives a three-letter query no budget, so short queries stay precise', () => {
    expect(typoBudget(3)).toBe(0)
    expect(typoBudget(4)).toBe(1)
    expect(typoBudget(8)).toBe(2)
  })

  it('editDistanceWithin bails out rather than computing a distance it will not use', () => {
    expect(editDistanceWithin('abcdefghij', 'z', 2)).toBe(3)
    expect(editDistanceWithin('kitten', 'sitting', 3)).toBe(3)
    expect(editDistanceWithin('teh', 'the', 2)).toBe(1) // one transposition, not two edits
  })
})

describe('both faces (PRD 6.5.2)', () => {
  it('finds an adventure card by its adventure name', () => {
    const hit = search(INDEX, 'stomp').cards[0]
    expect(hit?.starIndex).toBe(3)
    expect(hit?.face).toBe('back')
    expect(hit?.frontName).toBe('Bonecrusher Giant')
  })

  it('finds a split card by its second half', () => {
    expect(search(INDEX, 'ice').cards.map((hit) => hit.starIndex)).toContain(4)
  })

  it('never returns the same card twice when both faces match', () => {
    const both: SearchFile = {
      ...FILE,
      cardNames: ['Bolt Giant'],
      starCount: 1,
      backNames: [[0, 'Bolt Stomp']],
    }
    const cards = search(buildSearchIndex(both), 'bolt').cards
    expect(cards).toHaveLength(1)
  })
})

describe('reprint-only sets (PRD 6.5.4)', () => {
  it('carries planeSlug: null so the caller flies to the multiverse instead of a plane', () => {
    expect(search(INDEX, 'modern horizons').sets[0]?.planeSlug).toBeNull()
  })

  it('carries the plane for a set that has one', () => {
    expect(search(INDEX, 'guilds').sets[0]?.planeSlug).toBe('ravnica')
  })
})

describe('scale (PRD 6.5.5: no round trip per keystroke)', () => {
  it('queries 30k names well inside a keystroke', () => {
    const words = ['Lightning', 'Serra', 'Shivan', 'Goblin', 'Elvish', 'Phyrexian', 'Sunlit']
    const big: SearchFile = {
      ...FILE,
      starCount: 30_000,
      cardNames: Array.from(
        { length: 30_000 },
        (_, i) => `${words[i % words.length]!} Guardian ${String(i)}`,
      ),
      backNames: [],
    }
    const index = buildSearchIndex(big)

    // Warm the JIT, then measure a query that is *not* well served by the fast pass, so the typo
    // fallback runs too — that is the expensive path and the one worth budgeting.
    search(index, 'lightning')
    const started = performance.now()
    for (const query of ['lightning', 'phyrexain', 'guardain 1234', 'srra']) search(index, query)
    const elapsed = performance.now() - started

    // Generous against CI noise; the point is to catch an accidental quadratic, not to pin a number.
    expect(elapsed).toBeLessThan(1500)
  })
})

describe('matchScore', () => {
  it('scores nothing for a needle that is not a subsequence', () => {
    expect(matchScore('lightning bolt', 'zzz')).toBe(0)
  })

  it('prefers the shorter of two equally-prefixed names', () => {
    expect(matchScore('bolt', 'bolt')).toBeGreaterThan(matchScore('bolt hound', 'bolt'))
  })
})
