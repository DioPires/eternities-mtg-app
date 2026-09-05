/**
 * PRD 6.6's filter semantics against a hand-built `stars.bin`.
 *
 * Built rather than mocked: `evaluateFilters` reads through the real decoder, so a change to the
 * star record layout (data contract §5) breaks these tests, which is the point — the filter rules
 * and the byte layout are the same requirement seen from two sides.
 */

import { describe, expect, it } from 'vitest'

import {
  BINARY_HEADER_BYTES,
  BinaryKind,
  CONTRACT_VERSION,
  CardTypeBit,
  HueClass,
  SizeClass,
  STAR_RECORD_BYTES,
  colourIdentityBits,
  decodeStars,
  hueClassFromIdentity,
  packColourByte,
  type SetsSidecar,
  type Stars,
} from '../src/data'
import { evaluateFilters, starMatches } from '../src/filters/evaluate'
import { EMPTY_FILTERS, type FilterState } from '../src/filters/types'

interface StarSpec {
  /**
   * The card's colour identity, as the letters a shard carries.
   *
   * Byte 7's hue class is *derived* from it here, exactly as the pipeline derives it, rather than
   * given alongside it. A spec that set the two independently could describe a record the encoder
   * cannot produce — a gold star with an empty identity, say — and a filter test that passes on an
   * impossible record proves nothing about the filter.
   */
  readonly ci: string
  readonly size: number
  readonly types: number
  readonly plane?: number
}

function buildStars(specs: readonly StarSpec[]): Stars {
  const buffer = new ArrayBuffer(BINARY_HEADER_BYTES + specs.length * STAR_RECORD_BYTES)
  const bytes = new Uint8Array(buffer)
  bytes.set([0x45, 0x54, 0x52, 0x4e]) // 'ETRN'
  const view = new DataView(buffer)
  view.setUint8(4, BinaryKind.Stars)
  view.setUint8(5, CONTRACT_VERSION)
  view.setUint16(6, 0, true)
  view.setUint32(8, specs.length, true)
  view.setUint32(12, 0, true)
  specs.forEach((spec, index) => {
    const at = BINARY_HEADER_BYTES + index * STAR_RECORD_BYTES
    // Positions stay zero: nothing in PRD 6.6 reads them.
    view.setUint8(at + 6, spec.plane ?? 0)
    const identity = colourIdentityBits(spec.ci)
    view.setUint8(at + 7, packColourByte(hueClassFromIdentity(identity), identity))
    view.setUint8(at + 8, spec.size)
    view.setUint8(at + 9, 200)
    view.setUint8(at + 10, 0)
    view.setUint8(at + 11, spec.types)
  })
  return decodeStars(buffer)
}

const CREATURE = 1 << CardTypeBit.Creature
const LAND = 1 << CardTypeBit.Land
const INSTANT = 1 << CardTypeBit.Instant

/**
 * Six stars covering every rule in PRD 6.6.2-3:
 *   0 mono-white common creature
 *   1 mono-blue rare instant
 *   2 Azorius (WU) mythic creature — gold, and its identity is *not* red
 *   3 colourless uncommon land
 *   4 mono-red rare creature+land
 *   5 conspiracy: no type bits at all
 */
const STARS = buildStars([
  { ci: 'W', size: SizeClass.Common, types: CREATURE },
  { ci: 'U', size: SizeClass.Rare, types: INSTANT },
  { ci: 'WU', size: SizeClass.Mythic, types: CREATURE },
  { ci: '', size: SizeClass.Uncommon, types: LAND },
  { ci: 'R', size: SizeClass.Rare, types: CREATURE | LAND },
  { ci: 'B', size: SizeClass.Common, types: 0 },
])

function filters(patch: Partial<FilterState>): FilterState {
  return { ...EMPTY_FILTERS, ...patch }
}

function matched(state: FilterState, resolution = { setIds: [] as number[], sets: null }): number[] {
  const result = evaluateFilters(STARS, state, resolution)
  const indices: number[] = []
  for (let i = 0; i < result.total; i += 1) if (result.mask[i] === 1) indices.push(i)
  expect(indices.length).toBe(result.matching)
  return indices
}

describe('no filter', () => {
  it('matches everything and reports an exact total (PRD 6.3.2)', () => {
    const result = evaluateFilters(STARS, EMPTY_FILTERS, { setIds: [], sets: null })
    expect(result.matching).toBe(6)
    expect(result.total).toBe(6)
    expect(result.setsApplied).toBe(true)
  })
})

describe('colour identity (PRD 6.6.2)', () => {
  it('matches every card whose identity contains the selected colour', () => {
    // Star 1 is mono-blue, star 2 is Azorius. Both identities intersect `U`.
    expect(matched(filters({ colours: ['U'] }))).toEqual([1, 2])
  })

  it('excludes a multicolour card from a colour its identity does not contain', () => {
    // The defect the board closed on 2026-09-04. Against the hue *class* the Azorius star 2 was
    // "multicolour", which every coloured selection admitted, so a red-only filter lit it. Against
    // the identity, `R` is simply not one of its two bits.
    expect(matched(filters({ colours: ['R'] }))).toEqual([4])
  })

  it('colourless matches only the empty identity, never multicolour', () => {
    expect(matched(filters({ colours: ['C'] }))).toEqual([3])
  })

  it('never matches an empty identity against a coloured selection', () => {
    // The other direction of 6.6.2's "matches only empty identity": zero intersects nothing, so
    // star 3 stays dark under every WUBRG chip and under all five at once.
    for (const colour of ['W', 'U', 'B', 'R', 'G'] as const) {
      expect(matched(filters({ colours: [colour] }))).not.toContain(3)
    }
    expect(matched(filters({ colours: ['W', 'U', 'B', 'R', 'G'] }))).not.toContain(3)
  })

  it('ORs within the facet', () => {
    // `W` takes the mono-white star and the Azorius one; `C` takes the colourless land. The gold
    // star arrives on its white bit, not on a multicolour exemption.
    expect(matched(filters({ colours: ['W', 'C'] }))).toEqual([0, 2, 3])
  })

  it('counts a multicolour card once when the selection covers both its colours', () => {
    // Union, not per-colour tallies: star 2 intersects both chips and is still one match.
    const result = evaluateFilters(STARS, filters({ colours: ['W', 'U'] }), {
      setIds: [],
      sets: null,
    })
    expect(result.matching).toBe(3)
    expect(matched(filters({ colours: ['W', 'U'] }))).toEqual([0, 1, 2])
  })

  it('is exact for every arity the encoder can produce (PRD 6.6.2, amendment A3)', () => {
    // One star per non-empty identity, plus the empty one: 32 rows. For each of the five chips,
    // the set the filter lights must be exactly the set whose identity has that bit — which is
    // what "intersects" means, stated without reference to the implementation.
    const all = Array.from({ length: 32 }, (_, mask) => mask)
    const stars = buildStars(
      all.map((mask) => ({
        ci: ['W', 'U', 'B', 'R', 'G'].filter((_, bit) => (mask & (1 << bit)) !== 0).join(''),
        size: SizeClass.Common,
        types: CREATURE,
      })),
    )
    const run = (state: FilterState): number[] => {
      const result = evaluateFilters(stars, state, { setIds: [], sets: null })
      return all.filter((i) => result.mask[i] === 1)
    }
    ;(['W', 'U', 'B', 'R', 'G'] as const).forEach((colour, bit) => {
      expect(run(filters({ colours: [colour] }))).toEqual(
        all.filter((mask) => (mask & (1 << bit)) !== 0),
      )
    })
    // 16 of the 32 identities contain white or blue; only mask 0 is colourless.
    expect(run(filters({ colours: ['W', 'U'] }))).toHaveLength(24)
    expect(run(filters({ colours: ['C'] }))).toEqual([0])
    // Sanity on the fixture itself: it really does carry gold cards, so the rows above are not
    // all mono and the exclusion has something to exclude.
    expect(all.filter((mask) => hueClassFromIdentity(mask) === HueClass.Multicolour)).toHaveLength(
      26,
    )
  })
})

describe('rarity (PRD 6.6.3)', () => {
  it('matches the size class', () => {
    expect(matched(filters({ rarities: ['rare'] }))).toEqual([1, 4])
  })

  it('ORs within the facet', () => {
    expect(matched(filters({ rarities: ['common', 'mythic'] }))).toEqual([0, 2, 5])
  })
})

describe('card type (PRD 6.6.2)', () => {
  it('matches any type in the line', () => {
    expect(matched(filters({ types: ['land'] }))).toEqual([3, 4])
  })

  it('a card with two types matches either', () => {
    expect(matched(filters({ types: ['creature'] }))).toEqual([0, 2, 4])
  })

  it('a conspiracy carries no type bits: it matches with no type facet and dims under any', () => {
    expect(matched(EMPTY_FILTERS)).toContain(5)
    expect(matched(filters({ types: ['creature'] }))).not.toContain(5)
    expect(matched(filters({ types: ['land'] }))).not.toContain(5)
  })
})

describe('across facets (PRD 6.6.2: AND)', () => {
  it('intersects colour, rarity and type', () => {
    expect(matched(filters({ colours: ['R'], rarities: ['rare'], types: ['land'] }))).toEqual([4])
  })

  it('an impossible combination matches nothing without throwing', () => {
    expect(matched(filters({ colours: ['C'], types: ['creature'] }))).toEqual([])
  })
})

describe('the set facet waits for sets.bin (PRD 6.6.5)', () => {
  const sidecar: SetsSidecar = {
    starCount: 6,
    oracleId: () => '',
    starIndexOf: () => -1,
    setIdsOf: () => new Uint16Array(),
    // Sets 7 belongs to stars 1 and 4.
    hasSet: (index, setId) => setId === 7 && (index === 1 || index === 4),
  }

  it('reports setsApplied: false and leaves the facet off while the sidecar is in flight', () => {
    const result = evaluateFilters(STARS, filters({ sets: ['mh2'] }), { setIds: [], sets: null })
    expect(result.setsApplied).toBe(false)
    expect(result.matching).toBe(6)
  })

  it('applies the facet once the sidecar lands', () => {
    const state = filters({ sets: ['mh2'] })
    const result = evaluateFilters(STARS, state, { setIds: [7], sets: sidecar })
    expect(result.setsApplied).toBe(true)
    expect(result.matching).toBe(2)
  })

  it('ANDs the set facet with the star-record facets', () => {
    const state = filters({ sets: ['mh2'], rarities: ['rare'], colours: ['U'] })
    const result = evaluateFilters(STARS, state, { setIds: [7], sets: sidecar })
    expect(result.matching).toBe(1)
    expect(result.mask[1]).toBe(1)
  })

  it('a set code that resolves to no id matches nothing once the sidecar is up', () => {
    const result = evaluateFilters(STARS, filters({ sets: ['nope'] }), { setIds: [], sets: sidecar })
    expect(result.setsApplied).toBe(true)
    expect(result.matching).toBe(0)
  })
})

describe('buffer reuse', () => {
  it('reuses the mask when the length still matches, so a chip toggle allocates nothing', () => {
    const first = evaluateFilters(STARS, filters({ colours: ['W'] }), { setIds: [], sets: null })
    const second = evaluateFilters(
      STARS,
      filters({ colours: ['U'] }),
      { setIds: [], sets: null },
      first.mask,
    )
    expect(second.mask).toBe(first.mask)
    expect(second.matching).toBe(2)
  })

  it('starMatches is permissive before the first evaluation', () => {
    expect(starMatches(null, 999)).toBe(true)
  })
})
