/**
 * The URL, parsed and formatted. PRD 6.7 makes it the source of truth for focus and filters, so
 * this module is the single place that knows the mapping in either direction.
 *
 * Routes (PRD 6.7.1):
 *   /                                  multiverse
 *   /plane/<slug>                      a plane, including /plane/blind-eternities
 *   /plane/<slug>/card/<oracle_id>     a card, by Scryfall oracle id
 *
 * Filters are query parameters on any route (PRD 6.7.2): `c` colours, `t` types, `r` rarities,
 * `s` set codes, comma-separated within a parameter.
 *
 * Deliberately free of `window`: `Router` in `./router.ts` owns the browser side, this owns the
 * grammar, and `web/test/route.test.ts` pins the grammar without a DOM.
 */

import type { Focus } from '../navigation'
import {
  FILTER_COLOURS,
  FILTER_RARITIES,
  FILTER_TYPES,
  emptyFilters,
  type FilterColour,
  type FilterRarity,
  type FilterState,
  type FilterType,
} from '../filters/types'

/** PRD 6.7.1: Appendix A slugs are kebab-case. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Scryfall oracle ids are UUIDs; `sets.bin` stores them as 16 raw bytes (data contract §6). */
const ORACLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Scryfall set codes are short and alphanumeric; anything else never matches a facet value. */
const SET_CODE_PATTERN = /^[a-z0-9]{1,10}$/

/**
 * Why a parsed URL is not exactly what was in the address bar.
 *
 * A malformed route is not the same failure as PRD risk 9's dead card link: this one is caught
 * before any data has loaded, so it cannot be a fallback-with-a-toast decision the way an
 * `oracle_id` that `sets.bin` cannot resolve is. The boot path decides what to say about it.
 */
export type RouteWarning =
  | { readonly kind: 'unknown-route'; readonly path: string }
  | { readonly kind: 'bad-slug'; readonly value: string }
  | { readonly kind: 'bad-oracle-id'; readonly value: string }

export interface ParsedRoute {
  readonly focus: Focus
  readonly filters: FilterState
  readonly warnings: readonly RouteWarning[]
}

const COLOUR_SET: ReadonlySet<string> = new Set(FILTER_COLOURS)
const TYPE_SET: ReadonlySet<string> = new Set(FILTER_TYPES)
const RARITY_SET: ReadonlySet<string> = new Set(FILTER_RARITIES)

/**
 * Canonical order for a facet's values, so two URLs that mean the same thing are the same string.
 * Sharing (PRD 6.7.4) and the history dedupe both depend on that.
 */
function canonical<T extends string>(values: Iterable<T>, order: readonly T[]): T[] {
  const seen = new Set(values)
  return order.filter((value) => seen.has(value))
}

function parseFacet<T extends string>(
  raw: string | null,
  allowed: ReadonlySet<string>,
  order: readonly T[],
): T[] {
  if (!raw) return []
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowed.has(value)) as T[]
  return canonical(values, order)
}

/**
 * Set codes have no fixed vocabulary at parse time — `search.json` has not loaded yet on the
 * cold-start path — so they are validated by shape and sorted, not checked against a roster. A
 * code that turns out not to exist simply matches nothing; PRD 6.6.3 needs no more than that.
 */
function parseSetCodes(raw: string | null): string[] {
  if (!raw) return []
  const codes = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SET_CODE_PATTERN.test(value))
  return [...new Set(codes)].sort()
}

export function parseFilters(search: string): FilterState {
  const params = new URLSearchParams(search)
  return {
    colours: parseFacet<FilterColour>(params.get('c'), COLOUR_SET, FILTER_COLOURS),
    types: parseFacet<FilterType>(params.get('t'), TYPE_SET, FILTER_TYPES),
    rarities: parseFacet<FilterRarity>(params.get('r'), RARITY_SET, FILTER_RARITIES),
    sets: parseSetCodes(params.get('s')),
  }
}

export function formatFilters(filters: FilterState): string {
  const params: string[] = []
  if (filters.colours.length > 0) params.push(`c=${filters.colours.join(',')}`)
  if (filters.types.length > 0) params.push(`t=${filters.types.join(',')}`)
  if (filters.rarities.length > 0) params.push(`r=${filters.rarities.join(',')}`)
  if (filters.sets.length > 0) params.push(`s=${filters.sets.join(',')}`)
  return params.length > 0 ? `?${params.join('&')}` : ''
}

export function parseRoute(pathname: string, search = ''): ParsedRoute {
  const filters = parseFilters(search)
  const warnings: RouteWarning[] = []
  const segments = pathname.split('/').filter((segment) => segment.length > 0)

  const fallback = (warning: RouteWarning): ParsedRoute => {
    warnings.push(warning)
    return { focus: { kind: 'multiverse' }, filters, warnings }
  }

  if (segments.length === 0) return { focus: { kind: 'multiverse' }, filters, warnings }
  if (segments[0] !== 'plane') return fallback({ kind: 'unknown-route', path: pathname })

  const slug = decodeURIComponent(segments[1] ?? '')
  if (!SLUG_PATTERN.test(slug)) return fallback({ kind: 'bad-slug', value: segments[1] ?? '' })

  if (segments.length === 2) return { focus: { kind: 'plane', slug }, filters, warnings }
  if (segments.length !== 4 || segments[2] !== 'card') {
    return fallback({ kind: 'unknown-route', path: pathname })
  }

  const oracleId = decodeURIComponent(segments[3] ?? '').toLowerCase()
  if (!ORACLE_ID_PATTERN.test(oracleId)) {
    // The slug is still real, so drop to the plane rather than all the way out — the same
    // reasoning `failCardResolution` uses for its default fallback (navigation contract §3a).
    warnings.push({ kind: 'bad-oracle-id', value: segments[3] ?? '' })
    return { focus: { kind: 'plane', slug }, filters, warnings }
  }
  return { focus: { kind: 'card', planeSlug: slug, oracleId }, filters, warnings }
}

/**
 * The path a focus serialises to — and therefore the history identity of a focus.
 *
 * `starIndex` and `anchor` are deliberately absent: PRD 6.7.1 puts neither in the URL, and
 * navigation contract §3a makes focus equality the router's dedupe test. Two focuses with the same
 * path are the same history entry, which is exactly what stops PRD 6.8.2's deferred second stage
 * from pushing a duplicate.
 */
export function pathOf(focus: Focus): string {
  if (focus.kind === 'multiverse') return '/'
  if (focus.kind === 'plane') return `/plane/${encodeURIComponent(focus.slug)}`
  return `/plane/${encodeURIComponent(focus.planeSlug)}/card/${encodeURIComponent(focus.oracleId)}`
}

export function formatRoute(focus: Focus, filters: FilterState): string {
  return `${pathOf(focus)}${formatFilters(filters)}`
}

/** PRD 6.1.3 / 6.3.1: the ancestors a breadcrumb offers, nearest root first. */
export function ancestorsOf(focus: Focus): Focus[] {
  if (focus.kind === 'multiverse') return []
  if (focus.kind === 'plane') return [{ kind: 'multiverse' }]
  return [
    { kind: 'multiverse' },
    // Carry the card's anchor up, for the same reason `focusParent` does (navigation contract §1):
    // on the Blind Eternities `anchor: undefined` *means* the multiverse centre.
    { kind: 'plane', slug: focus.planeSlug, ...(focus.anchor && { anchor: focus.anchor }) },
  ]
}

export { emptyFilters }
