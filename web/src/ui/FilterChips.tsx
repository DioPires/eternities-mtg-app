/**
 * PRD 6.3.2: "Filter chips, beneath the breadcrumb: one chip per active facet value, each
 * individually removable, with a clear-all control and a live count of matching cards computed
 * from the same data the filters use (6.6.5), so the count is exact wherever the filter is."
 *
 * "The same data the filters use" is why the count comes out of `useFilterEvaluation` — the pass
 * that produces the shader's dimming mask also produces this number, so the two cannot disagree.
 * Before `sets.bin` lands a selected set chip is not yet applied (PRD 6.6.5) and the row says so
 * rather than showing a count that is quietly missing a facet.
 */

import type { ReactElement } from 'react'

import { useFilterEvaluation, useFilters } from '../app/hooks'
import {
  COLOUR_LABEL,
  RARITY_LABEL,
  TYPE_LABEL,
  filterCount,
  isFilterActive,
} from '../filters/types'
import { useStore } from '../store/store'
import { CloseIcon, FilterIcon } from './icons'

interface ChipProps {
  readonly label: string
  readonly facet: string
  readonly onRemove: () => void
  readonly pending?: boolean
}

function Chip({ label, facet, onRemove, pending = false }: ChipProps): ReactElement {
  return (
    <li className={pending ? 'chip chip-pending' : 'chip'}>
      <span className="chip-facet">{facet}</span>
      <span className="chip-label">{label}</span>
      <button type="button" className="chip-remove" onClick={onRemove} aria-label={`Remove ${facet} filter ${label}`}>
        <CloseIcon size={12} />
      </button>
    </li>
  )
}

const NUMBER = new Intl.NumberFormat('en-GB')

export function FilterChips(): ReactElement | null {
  const { filters, toggleColour, toggleType, toggleRarity, toggleSet, clearAll } = useFilters()
  const evaluation = useFilterEvaluation()
  const setByCode = useStore((state) => state.setByCode)
  const setOverlay = useStore((state) => state.setOverlay)
  const active = isFilterActive(filters)

  return (
    <div className="chip-row">
      <button
        type="button"
        className={active ? 'chip-add chip-add-active' : 'chip-add'}
        onClick={() => {
          setOverlay('filters')
        }}
        aria-haspopup="dialog"
      >
        <FilterIcon />
        <span>Filters{active ? ` (${String(filterCount(filters))})` : ''}</span>
      </button>

      {active ? (
        <>
          <ul className="chips">
            {filters.colours.map((value) => (
              <Chip
                key={`c-${value}`}
                facet="Colour"
                label={COLOUR_LABEL[value]}
                onRemove={() => {
                  toggleColour(value)
                }}
              />
            ))}
            {filters.types.map((value) => (
              <Chip
                key={`t-${value}`}
                facet="Type"
                label={TYPE_LABEL[value]}
                onRemove={() => {
                  toggleType(value)
                }}
              />
            ))}
            {filters.rarities.map((value) => (
              <Chip
                key={`r-${value}`}
                facet="Rarity"
                label={RARITY_LABEL[value]}
                onRemove={() => {
                  toggleRarity(value)
                }}
              />
            ))}
            {filters.sets.map((code) => (
              <Chip
                key={`s-${code}`}
                facet="Set"
                label={setByCode.get(code)?.name ?? code.toUpperCase()}
                pending={evaluation !== null && !evaluation.setsApplied}
                onRemove={() => {
                  toggleSet(code)
                }}
              />
            ))}
          </ul>

          <p className="chip-count" aria-live="polite">
            {evaluation === null
              ? 'counting…'
              : evaluation.setsApplied
                ? `${NUMBER.format(evaluation.matching)} of ${NUMBER.format(evaluation.total)} cards`
                : `${NUMBER.format(evaluation.matching)} of ${NUMBER.format(evaluation.total)} cards — set filter still loading`}
          </p>

          <button type="button" className="chip-clear" onClick={clearAll}>
            Clear all
          </button>
        </>
      ) : null}
    </div>
  )
}
