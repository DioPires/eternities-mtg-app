/**
 * PRD 6.7's URL grammar. These pin the mapping in both directions, because a deep link that
 * round-trips wrong is a bug nobody sees until someone shares one.
 */

import { describe, expect, it } from 'vitest'

import { EMPTY_FILTERS } from '../src/filters/types'
import {
  ancestorsOf,
  formatFilters,
  formatRoute,
  parseFilters,
  parseRoute,
  pathOf,
} from '../src/router/route'

const ORACLE = '0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00001'

describe('parseRoute — PRD 6.7.1 routes', () => {
  it('parses the multiverse root', () => {
    expect(parseRoute('/').focus).toEqual({ kind: 'multiverse' })
  })

  it('parses a plane', () => {
    expect(parseRoute('/plane/dominaria').focus).toEqual({ kind: 'plane', slug: 'dominaria' })
  })

  it('parses the Blind Eternities as an ordinary plane', () => {
    expect(parseRoute('/plane/blind-eternities').focus).toEqual({
      kind: 'plane',
      slug: 'blind-eternities',
    })
  })

  it('parses a card', () => {
    expect(parseRoute(`/plane/ravnica/card/${ORACLE}`).focus).toEqual({
      kind: 'card',
      planeSlug: 'ravnica',
      oracleId: ORACLE,
    })
  })

  it('lower-cases an upper-case oracle id so the sets.bin lookup matches', () => {
    const focus = parseRoute(`/plane/ravnica/card/${ORACLE.toUpperCase()}`).focus
    expect(focus).toEqual({ kind: 'card', planeSlug: 'ravnica', oracleId: ORACLE })
  })

  it('falls back to the plane when the oracle id is malformed — the slug is still real', () => {
    const parsed = parseRoute('/plane/ravnica/card/not-a-uuid')
    expect(parsed.focus).toEqual({ kind: 'plane', slug: 'ravnica' })
    expect(parsed.warnings).toEqual([{ kind: 'bad-oracle-id', value: 'not-a-uuid' }])
  })

  it('falls back to the multiverse on an unknown route', () => {
    const parsed = parseRoute('/somewhere/else')
    expect(parsed.focus).toEqual({ kind: 'multiverse' })
    expect(parsed.warnings[0]?.kind).toBe('unknown-route')
  })

  it('rejects a slug that is not kebab-case', () => {
    const parsed = parseRoute('/plane/Not_A_Slug')
    expect(parsed.focus).toEqual({ kind: 'multiverse' })
    expect(parsed.warnings[0]?.kind).toBe('bad-slug')
  })
})

describe('filters in the query string — PRD 6.7.2', () => {
  it('parses every facet', () => {
    expect(parseFilters('?c=W,U&t=creature&r=rare,mythic&s=mh2,dom')).toEqual({
      colours: ['W', 'U'],
      types: ['creature'],
      rarities: ['rare', 'mythic'],
      sets: ['dom', 'mh2'],
    })
  })

  it('drops values outside the vocabulary rather than failing the whole URL', () => {
    expect(parseFilters('?c=W,Z&t=creature,wizard&r=legendary')).toEqual({
      colours: ['W'],
      types: ['creature'],
      rarities: [],
      sets: [],
    })
  })

  it('accepts colourless as an explicit colour option (PRD 6.6.2)', () => {
    expect(parseFilters('?c=C').colours).toEqual(['C'])
  })

  it('canonicalises order, so two URLs that mean the same thing are the same string', () => {
    expect(formatFilters(parseFilters('?c=U,W'))).toBe('?c=W,U')
    expect(formatFilters(parseFilters('?s=mh2,dom'))).toBe('?s=dom,mh2')
  })

  it('de-duplicates set codes and lower-cases them', () => {
    expect(parseFilters('?s=MH2,mh2').sets).toEqual(['mh2'])
  })

  it('emits nothing when no facet is active', () => {
    expect(formatFilters(EMPTY_FILTERS)).toBe('')
  })
})

describe('formatRoute / pathOf', () => {
  it('round-trips a filtered card link', () => {
    const url = `/plane/ravnica/card/${ORACLE}?c=W&r=mythic`
    const parsed = parseRoute(`/plane/ravnica/card/${ORACLE}`, '?c=W&r=mythic')
    expect(formatRoute(parsed.focus, parsed.filters)).toBe(url)
  })

  it('pathOf ignores starIndex and anchor — neither is in the URL (PRD 6.7.1)', () => {
    const bare = pathOf({ kind: 'card', planeSlug: 'ravnica', oracleId: ORACLE })
    const refined = pathOf({
      kind: 'card',
      planeSlug: 'ravnica',
      oracleId: ORACLE,
      starIndex: 42,
      anchor: [1, 2, 3],
    })
    expect(refined).toBe(bare)
  })
})

describe('ancestorsOf — PRD 6.3.1', () => {
  it('gives nothing at multiverse level', () => {
    expect(ancestorsOf({ kind: 'multiverse' })).toEqual([])
  })

  it('gives the multiverse for a plane', () => {
    expect(ancestorsOf({ kind: 'plane', slug: 'kaldheim' })).toEqual([{ kind: 'multiverse' }])
  })

  it("carries a dust card's anchor up into the plane crumb (navigation contract §1)", () => {
    const anchor = [1, 2, 3] as const
    expect(
      ancestorsOf({
        kind: 'card',
        planeSlug: 'blind-eternities',
        oracleId: ORACLE,
        anchor,
      }),
    ).toEqual([
      { kind: 'multiverse' },
      { kind: 'plane', slug: 'blind-eternities', anchor },
    ])
  })
})
