/**
 * PRD 6.4's plane panel.
 *
 *  1. Plane name.
 *  2. Card count.
 *  3. Sets mapped to the plane (Appendix B) in chronological order, each with release year and the
 *     number of cards first printed there. Clicking a set adds a set filter chip.
 *  4. First and last appearance years, derived from the set list.
 *  5. Zero-card planes show the name and "No cards assigned".
 *  6. The Blind Eternities panel lists the sets whose cards landed there, same format.
 *
 * All six come out of `planes.json` alone — `PlaneRecord.sets` is already chronological (data
 * contract: "chronological, and therefore the chronology-band order of PRD 5.4.2"), so no shard
 * fetch is needed to open this panel.
 */

import type { ReactElement } from 'react'

import { useFilters } from '../app/hooks'
import type { PlaneRecord } from '../data'
import { formatCount } from './format'


export function PlanePanel({ plane }: { plane: PlaneRecord }): ReactElement {
  const { filters, addSet } = useFilters()

  return (
    <div className="panel-body">
      <h2 className="panel-title">{plane.displayName}</h2>

      {plane.cardCount === 0 ? (
        <p className="panel-empty">No cards assigned</p>
      ) : (
        <>
          <p className="panel-stat">
            <strong>{formatCount(plane.cardCount)}</strong> cards
            {plane.firstYear !== null && plane.lastYear !== null ? (
              <>
                {' · '}
                {plane.firstYear === plane.lastYear
                  ? plane.firstYear
                  : `${String(plane.firstYear)}–${String(plane.lastYear)}`}
              </>
            ) : null}
          </p>

          <h3 className="panel-heading">Sets</h3>
          <ul className="set-list">
            {plane.sets.map((set) => {
              const code = set.code.toLowerCase()
              const active = filters.sets.includes(code)
              return (
                <li key={set.id}>
                  <button
                    type="button"
                    className={active ? 'set-row set-row-active' : 'set-row'}
                    onClick={() => {
                      addSet(code)
                    }}
                    aria-pressed={active}
                    title={`Filter to ${set.name}`}
                  >
                    <span className="set-name">{set.name}</span>
                    <span className="set-year">{set.year}</span>
                    <span className="set-count">{formatCount(set.cardCount)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
