/**
 * PRD 6.6's facets, as the surface that picks them.
 *
 *  1. Colour identity, card type, rarity, set.
 *  2. OR within a facet, AND across facets — stated in the panel, because the semantics are not
 *     guessable from a grid of toggles.
 *  4. "The set facet lists the current plane's sets when a plane or card is focused, and all sets
 *     at multiverse level."
 *  5. Colour, rarity and type are live from the first frame; the set facet waits for `sets.bin`
 *     and says so.
 *
 * Every toggle writes the URL (PRD 6.6.6) and nothing else — there is no local mirror of the
 * filter state in this component, which is what keeps a shared link and the screen in agreement.
 */

import { useMemo, type ReactElement } from 'react'

import { useFilters, useNavSnapshot } from '../app/hooks'
import {
  COLOUR_LABEL,
  FILTER_COLOURS,
  FILTER_RARITIES,
  FILTER_TYPES,
  RARITY_LABEL,
  TYPE_LABEL,
} from '../filters/types'
import { useStore } from '../store/store'
import { Sheet } from './Sheet'
import { formatCount } from './format'


function Toggle({
  label,
  active,
  onClick,
}: {
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={active ? 'facet-toggle facet-toggle-active' : 'facet-toggle'}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

export function FilterOverlay(): ReactElement {
  const { filters, toggleColour, toggleType, toggleRarity, toggleSet, clearAll } = useFilters()
  const setOverlay = useStore((state) => state.setOverlay)
  const searchFile = useStore((state) => state.searchFile)
  const sets = useStore((state) => state.sets)
  const planeBySlug = useStore((state) => state.planeBySlug)
  const { focus } = useNavSnapshot()

  const focusedSlug =
    focus.kind === 'plane' ? focus.slug : focus.kind === 'card' ? focus.planeSlug : null

  /** PRD 6.6.4. The plane's own set list is in `planes.json`, so it is available before search.json. */
  const setOptions = useMemo(() => {
    if (focusedSlug !== null) {
      const plane = planeBySlug.get(focusedSlug)
      if (plane) {
        return plane.sets.map((set) => ({
          code: set.code.toLowerCase(),
          name: set.name,
          year: set.year,
          cardCount: set.cardCount,
        }))
      }
    }
    return (searchFile?.sets ?? []).map((set) => ({
      code: set.code.toLowerCase(),
      name: set.name,
      year: set.year,
      cardCount: set.cardCount,
    }))
  }, [focusedSlug, planeBySlug, searchFile])

  return (
    <Sheet
      label="Filters"
      title="Filters"
      className="sheet-filters"
      head={<p className="muted">Any value within a facet, all facets together.</p>}
      footer={
        <>
          <button type="button" className="link-button" onClick={clearAll}>
            Clear all
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOverlay(null)
            }}
          >
            Done
          </button>
        </>
      }
    >

        <section className="facet">
          <h3>Colour identity</h3>
          <div className="facet-row">
            {FILTER_COLOURS.map((colour) => (
              <Toggle
                key={colour}
                label={COLOUR_LABEL[colour]}
                active={filters.colours.includes(colour)}
                onClick={() => {
                  toggleColour(colour)
                }}
              />
            ))}
          </div>
        </section>

        <section className="facet">
          <h3>Card type</h3>
          <div className="facet-row">
            {FILTER_TYPES.map((type) => (
              <Toggle
                key={type}
                label={TYPE_LABEL[type]}
                active={filters.types.includes(type)}
                onClick={() => {
                  toggleType(type)
                }}
              />
            ))}
          </div>
        </section>

        <section className="facet">
          <h3>Rarity</h3>
          <div className="facet-row">
            {FILTER_RARITIES.map((rarity) => (
              <Toggle
                key={rarity}
                label={RARITY_LABEL[rarity]}
                active={filters.rarities.includes(rarity)}
                onClick={() => {
                  toggleRarity(rarity)
                }}
              />
            ))}
          </div>
        </section>

        <section className="facet">
          <h3>
            Set{' '}
            <span className="muted">
              {focusedSlug !== null ? '— this plane' : '— every set'}
              {sets === null ? ' · still loading' : ''}
            </span>
          </h3>
          <div className="facet-list">
            {setOptions.length === 0 ? (
              <p className="muted">Set list is still loading.</p>
            ) : (
              setOptions.map((set) => (
                <Toggle
                  key={set.code}
                  label={`${set.name} · ${String(set.year)} · ${formatCount(set.cardCount)}`}
                  active={filters.sets.includes(set.code)}
                  onClick={() => {
                    toggleSet(set.code)
                  }}
                />
              ))
            )}
          </div>
        </section>

    </Sheet>
  )
}
