/**
 * The filter vocabulary of PRD 6.6.1-3, and the mapping from each facet value onto the star
 * record fields it is evaluated against (PRD 8.3, data contract §5).
 *
 * Everything here is a plain value table so the URL grammar (`../router/route`), the evaluator
 * (`./evaluate`) and the chips (`../ui/FilterChips`) all read the same vocabulary.
 */

import { CardTypeBit, COLOUR_LETTERS, HueClass, SizeClass } from '../data'

/**
 * PRD 6.7.2's `c` parameter: colour letters plus `C` for colourless.
 *
 * Spread from `COLOUR_LETTERS` rather than written out again, so `Exclude<FilterColour, 'C'>` is
 * exactly `COLOUR_LETTER_BIT`'s key set and a sixth letter cannot be added on one side only.
 * `colour-byte.test.ts` pins that equivalence at the type level (DEC-650 N4).
 */
export const FILTER_COLOURS = [...COLOUR_LETTERS, 'C'] as const
export type FilterColour = (typeof FILTER_COLOURS)[number]

/** PRD 6.6.2's eight filterable types, in star-record bit order. */
export const FILTER_TYPES = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'battle',
] as const
export type FilterType = (typeof FILTER_TYPES)[number]

/** PRD 6.6.3. `special` and `bonus` were folded into rare and mythic by the pipeline. */
export const FILTER_RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const
export type FilterRarity = (typeof FILTER_RARITIES)[number]

export interface FilterState {
  readonly colours: readonly FilterColour[]
  readonly types: readonly FilterType[]
  readonly rarities: readonly FilterRarity[]
  /** Set *codes*, because PRD 6.7.2 puts codes in the URL. Resolved to ids by `search.json`. */
  readonly sets: readonly string[]
}

export type FilterFacet = keyof FilterState

export const EMPTY_FILTERS: FilterState = { colours: [], types: [], rarities: [], sets: [] }

export function emptyFilters(): FilterState {
  return EMPTY_FILTERS
}

export function isFilterActive(filters: FilterState): boolean {
  return (
    filters.colours.length > 0 ||
    filters.types.length > 0 ||
    filters.rarities.length > 0 ||
    filters.sets.length > 0
  )
}

export function filterCount(filters: FilterState): number {
  return (
    filters.colours.length + filters.types.length + filters.rarities.length + filters.sets.length
  )
}

export const TYPE_BIT: Readonly<Record<FilterType, number>> = {
  creature: 1 << CardTypeBit.Creature,
  instant: 1 << CardTypeBit.Instant,
  sorcery: 1 << CardTypeBit.Sorcery,
  artifact: 1 << CardTypeBit.Artifact,
  enchantment: 1 << CardTypeBit.Enchantment,
  planeswalker: 1 << CardTypeBit.Planeswalker,
  land: 1 << CardTypeBit.Land,
  battle: 1 << CardTypeBit.Battle,
}

export const RARITY_CLASS: Readonly<Record<FilterRarity, number>> = {
  common: SizeClass.Common,
  uncommon: SizeClass.Uncommon,
  rare: SizeClass.Rare,
  mythic: SizeClass.Mythic,
}

/**
 * There is deliberately no `FilterColour → HueClass` table here any more.
 *
 * PRD 6.6.2's colour facet evaluates against the star record's five-bit colour identity, not its
 * hue class (`../data/colourByte`, amendment A3). A second letter mapping kept "for reference" is
 * how the two drift back apart, so `COLOUR_LETTER_BIT` is now the only one. `HUE_LABEL` below
 * stays, because PRD 7.5.3 names the *rendered* class in the panels and that is a different job.
 */

export const COLOUR_LABEL: Readonly<Record<FilterColour, string>> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colourless',
}

export const TYPE_LABEL: Readonly<Record<FilterType, string>> = {
  creature: 'Creature',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  planeswalker: 'Planeswalker',
  land: 'Land',
  battle: 'Battle',
}

export const RARITY_LABEL: Readonly<Record<FilterRarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
}

/**
 * PRD 7.5.3: the star encoding is spelled out as text in the panels, never colour alone.
 *
 * Keyed by `HueClass`, not by `number`: all seven classes are present, so a lookup on a value
 * `hueClassFromIdentity` returned is total and the panel needs no fallback behind it.
 */
export const HUE_LABEL: Readonly<Record<HueClass, string>> = {
  [HueClass.White]: 'White',
  [HueClass.Blue]: 'Blue',
  [HueClass.Black]: 'Black',
  [HueClass.Red]: 'Red',
  [HueClass.Green]: 'Green',
  [HueClass.Multicolour]: 'Multicolour',
  [HueClass.Colourless]: 'Colourless',
}

export const RARITY_OF_CLASS: readonly FilterRarity[] = ['common', 'uncommon', 'rare', 'mythic']

export function toggleFacetValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}
