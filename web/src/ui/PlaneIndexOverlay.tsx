/**
 * PRD 6.3.3's "plane index" control: the roster, as a list you can fly from.
 *
 * PRD 5.3.4 makes this one of the two ways the Blind Eternities is reached without an anchor —
 * "the multiverse centre when reached from the plane index or search" — which is exactly what
 * `flyToPlane('blind-eternities')` does, so no special case is needed here.
 *
 * Zero-card planes are listed (PRD 5.3.6 renders them, and PRD 6.4.5 gives them a panel), marked
 * rather than hidden.
 */

import { useMemo, useState, type ReactElement } from 'react'

import { useNavigateTo } from '../app/hooks'
import { useStore } from '../store/store'
import { useDialog } from './dialog'

const NUMBER = new Intl.NumberFormat('en-GB')

export function PlaneIndexOverlay(): ReactElement {
  const planes = useStore((state) => state.planes)
  const setOverlay = useStore((state) => state.setOverlay)
  const go = useNavigateTo()
  const [query, setQuery] = useState('')
  // The roster can be hundreds of rows; opening on the filter box means the keyboard route into
  // it is "type a few letters", not "hold Tab".
  const dialog = useDialog<HTMLDivElement>('.sheet-filter')

  const rows = useMemo(() => {
    const all = [...(planes?.planes ?? [])].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'en'),
    )
    const needle = query.trim().toLowerCase()
    return needle.length === 0
      ? all
      : all.filter((plane) => plane.displayName.toLowerCase().includes(needle))
  }, [planes, query])

  return (
    <div
      className="overlay-scrim overlay-scrim-top"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOverlay(null)
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Plane index" ref={dialog}>
        <header className="sheet-head">
          <h2>Planes</h2>
          <input
            type="search"
            className="sheet-filter"
            value={query}
            placeholder="Filter the roster"
            aria-label="Filter the plane roster"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </header>
        <ul className="plane-list">
          {rows.map((plane) => (
            <li key={plane.slug}>
              <button
                type="button"
                className="plane-row"
                onClick={() => {
                  go({ kind: 'plane', slug: plane.slug }, 'user')
                  setOverlay(null)
                }}
              >
                <span className="plane-name">{plane.displayName}</span>
                <span className="plane-count">
                  {plane.cardCount === 0 ? 'no cards' : `${NUMBER.format(plane.cardCount)} cards`}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 ? <li className="muted">No planes match.</li> : null}
        </ul>
      </div>
    </div>
  )
}
