/**
 * PRD 6.6's filter semantics, evaluated against the star record and `sets.bin`.
 *
 * Two things come out of one pass: the per-star `mask` the shader dims with (PRD 5.8, consumed by
 * Phase 2a as its `filterMask` attribute, PRD 8.5.1) and the exact match count PRD 6.3.2 puts on
 * the chip row. They are computed together on purpose — "a live count of matching cards computed
 * from the same data the filters use, so the count is exact wherever the filter is" is a
 * requirement that a separately-derived count would quietly break.
 *
 * Semantics: OR within a facet, AND across facets (PRD 6.6.2).
 *
 * This runs on a filter change, not per frame, so the 30k-iteration loop is nowhere near PRD
 * 7.3.2's per-frame budget. It still reuses its output buffer, because the mask is uploaded to the
 * GPU and a fresh 30 KB allocation per keystroke on the chip row is free to avoid.
 */

import {
  COLOUR_LETTER_BIT,
  FILTER_MASK_PASS,
  matchesColourIdentity,
  matchesTypeMask,
  type SetsSidecar,
  type Stars,
} from '../data'
import { RARITY_CLASS, TYPE_BIT, isFilterActive, type FilterState } from './types'

export interface FilterResolution {
  /** Set ids for the selected set codes. Empty until `search.json` resolves the codes. */
  readonly setIds: readonly number[]
  /** `sets.bin`, or `null` while it is still in flight (PRD 6.6.5). */
  readonly sets: SetsSidecar | null
}

export interface FilterEvaluation {
  /**
   * One byte per star: {@link FILTER_MASK_PASS} matches, 0 is dimmed. Reused between calls — do not
   * retain a copy.
   *
   * The byte value is not free choice. This array is handed to `StarGeometry.setFilterMask`
   * verbatim (`app/filterMask.ts`) and becomes a **normalised** vertex attribute, so the pass value
   * has to be the one the shader reads as `1.0`. See {@link FILTER_MASK_PASS}.
   */
  readonly mask: Uint8Array
  /** Exact number of matching cards (PRD 6.3.2). */
  readonly matching: number
  /** Total stars considered, so the chip row can say "1,204 of 30,000". */
  readonly total: number
  /**
   * PRD 6.6.5: the set facet evaluates against `sets.bin`, which arrives after the first frame.
   * `false` means a set chip is selected but not yet applied, and the UI says so rather than
   * showing a count that is silently missing a facet.
   */
  readonly setsApplied: boolean
}

/**
 * The colour selection, resolved to what PRD 6.6.2 actually tests against.
 *
 * **Exact, since contract v2.** 6.6.2 asks for "colour identity matches when the card's identity
 * intersects the selected colours", and 6.6.5 requires colour to evaluate against the star record
 * so it is live from the first frame. Amendment A3 put the five-bit WUBRG identity in the star
 * record's byte 7, so both hold at once and this is a plain intersection test.
 *
 * Until then the record carried only a *hue class* — W, U, B, R, G, multicolour, colourless — and
 * this function admitted the multicolour class under any coloured selection, so an Azorius card
 * stayed lit under a red-only filter. That over-match is the PRD 6.6.2 gap the board closed on
 * 2026-09-04; `stars.colourIdentity` is what closes it. See `docs/app-shell.md` §4.1.
 *
 * `colourless` stays a flag rather than a sixth bit: PRD 6.6.2's `C` "matches only empty identity",
 * and an empty identity intersects nothing, so no bitmask test can express it.
 */
interface ColourSelection {
  /** Union of the selected WUBRG bits — OR within a facet (PRD 6.6.2). */
  readonly bits: number
  readonly colourless: boolean
  readonly active: boolean
}

function selectedColours(colours: FilterState['colours']): ColourSelection {
  let bits = 0
  let colourless = false
  for (const colour of colours) {
    if (colour === 'C') colourless = true
    // No `!`: `COLOUR_LETTER_BIT` is keyed by the facet minus `C`, so this lookup is total and a
    // seventh `FILTER_COLOURS` entry fails to compile here rather than mapping to the White bit.
    else bits |= 1 << COLOUR_LETTER_BIT[colour]
  }
  return { bits, colourless, active: colours.length > 0 }
}

function allowedSizes(rarities: FilterState['rarities']): number {
  let bits = 0
  for (const rarity of rarities) bits |= 1 << RARITY_CLASS[rarity]
  return bits
}

function selectedTypeBits(types: FilterState['types']): number {
  let bits = 0
  for (const type of types) bits |= TYPE_BIT[type]
  return bits
}

/**
 * `out` is reused across calls when its length still matches, so repeated chip toggles allocate
 * nothing. Pass the previous evaluation's `mask` back in.
 */
export function evaluateFilters(
  stars: Stars,
  filters: FilterState,
  resolution: FilterResolution,
  out?: Uint8Array,
): FilterEvaluation {
  const total = stars.count
  const mask = out !== undefined && out.length === total ? out : new Uint8Array(total)

  const setsSelected = filters.sets.length > 0
  // A selected set code that `search.json` has resolved to no id matches nothing, but only once
  // the sidecar is here to say so. Before that the facet is simply not applied yet (PRD 6.6.5).
  const setsApplied = !setsSelected || resolution.sets !== null
  const setIds = setsApplied && setsSelected ? resolution.setIds : []
  const sidecar = setIds.length > 0 ? resolution.sets : null
  // A set chip whose code resolved to nothing still filters — to nothing — once the sidecar is up.
  const setsMatchNothing = setsSelected && setsApplied && setIds.length === 0

  if (!isFilterActive(filters)) {
    mask.fill(FILTER_MASK_PASS)
    return { mask, matching: total, total, setsApplied: true }
  }
  if (setsMatchNothing) {
    mask.fill(0)
    return { mask, matching: 0, total, setsApplied }
  }

  const colours = selectedColours(filters.colours)
  const sizeBits = allowedSizes(filters.rarities)
  const typeBits = selectedTypeBits(filters.types)
  const setCount = setIds.length

  let matching = 0
  for (let i = 0; i < total; i += 1) {
    let ok =
      !colours.active ||
      matchesColourIdentity(stars.colourIdentity(i), colours.bits, colours.colourless)
    if (ok && sizeBits !== 0) ok = (sizeBits & (1 << stars.sizeClass(i))) !== 0
    // PRD 6.6.2: a conspiracy carries no type bits, so it matches only while no type facet is
    // active and dims under any type filter. `matchesTypeMask` is exactly that rule.
    if (ok && typeBits !== 0) ok = matchesTypeMask(stars.typeMask(i), typeBits)
    if (ok && sidecar !== null) {
      let hit = false
      for (let s = 0; s < setCount; s += 1) {
        if (sidecar.hasSet(i, setIds[s]!)) {
          hit = true
          break
        }
      }
      ok = hit
    }
    mask[i] = ok ? FILTER_MASK_PASS : 0
    if (ok) matching += 1
  }
  return { mask, matching, total, setsApplied }
}

/** Whether one star passes the current filters, for the "this card is dimmed" note of PRD 6.5.6. */
export function starMatches(evaluation: FilterEvaluation | null, starIndex: number): boolean {
  if (evaluation === null) return true
  return evaluation.mask[starIndex] !== 0
}
