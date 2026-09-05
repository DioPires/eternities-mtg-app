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
  decodeStars,
  type SetsSidecar,
  type Stars,
} from '../src/data'
import { evaluateFilters, starMatches } from '../src/filters/evaluate'
import { EMPTY_FILTERS, type FilterState } from '../src/filters/types'

interface StarSpec {
  readonly hue: number
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
    view.setUint8(at + 7, spec.hue)
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
 *   2 multicolour mythic creature
 *   3 colourless uncommon land
 *   4 mono-red rare creature+land
 *   5 conspiracy: no type bits at all
 */
const STARS = buildStars([
  { hue: HueClass.White, size: SizeClass.Common, types: CREATURE },
  { hue: HueClass.Blue, size: SizeClass.Rare, types: INSTANT },
  { hue: HueClass.Multicolour, size: SizeClass.Mythic, types: CREATURE },
  { hue: HueClass.Colourless, size: SizeClass.Uncommon, types: LAND },
  { hue: HueClass.Red, size: SizeClass.Rare, types: CREATURE | LAND },
  { hue: HueClass.Black, size: SizeClass.Common, types: 0 },
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
  it('matches the selected hue class', () => {
    expect(matched(filters({ colours: ['U'] }))).toEqual([1, 2])
  })

  it('admits multicolour under any coloured selection, because the star record stores a class', () => {
    // Documented approximation — see `allowedHues` in src/filters/evaluate.ts. Star 2 is gold and
    // has no stored identity, so it stays lit rather than being hidden from a colour it may have.
    expect(matched(filters({ colours: ['R'] }))).toEqual([2, 4])
  })

  it('colourless matches only the empty identity, never multicolour', () => {
    expect(matched(filters({ colours: ['C'] }))).toEqual([3])
  })

  it('ORs within the facet', () => {
    expect(matched(filters({ colours: ['W', 'C'] }))).toEqual([0, 2, 3])
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
