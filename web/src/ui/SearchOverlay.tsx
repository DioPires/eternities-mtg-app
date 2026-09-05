/**
 * PRD 6.5's search.
 *
 *  1. Opened by the search control or `/`; a single text box over the scene, dismissed by Esc or
 *     clicking outside.
 *  2. Card, plane and set names, fuzzy, either face.                       → `../search`
 *  3. Grouped Planes, Sets, Cards, up to 8 per group; arrows move *across* groups; Enter selects.
 *  4. Plane → fly. Card → the two-stage fly-to. Set with a plane → fly and add the chip. Set
 *     without one (reprint-only) → fly out to multiverse and add the chip, "so its reprints light
 *     up across every plane they were first printed on".
 *  5. The index is in memory before the box can open (`../app/dataset` loads it after the first
 *     frame), so there is no per-keystroke round trip and no loading state between letters.
 *  6. Results are filter-blind. Selecting a dimmed card still focuses it; the card panel then
 *     offers the inline "clear filters".
 *
 * The arrow-key model is one flat list across groups (`results.flat`), which is what 6.5.3's
 * "arrow keys move between results across groups" asks for, with `aria-activedescendant` so the
 * keyboard focus never leaves the text box (PRD 7.5.2).
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'

import { useFilters, useNavigateTo, useSearchResults } from '../app/hooks'
import { planeOfStarIndex } from '../app/boot'
import { hitKey, type SearchHit } from '../search'
import { useStore } from '../store/store'
import { useDialog } from './dialog'

const NUMBER = new Intl.NumberFormat('en-GB')

function GroupLabel({ children }: { readonly children: string }): ReactElement {
  return (
    <li className="search-group" role="presentation">
      {children}
    </li>
  )
}

export function SearchOverlay(): ReactElement {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)
  /*
   * The input is the whole point of this dialog, so it is what opens focused — and it is not the
   * first tabbable element in the sheet, so the selector is explicit rather than the default.
   *
   * The results are `role="option"` rows driven by `aria-activedescendant`, so the input is also
   * the *only* tabbable thing in here: Tab has nowhere to go and the trap holds focus on it,
   * which is exactly right for a combobox.
   */
  const dialog = useDialog<HTMLDivElement>('.search-input')

  const setOverlay = useStore((state) => state.setOverlay)
  const planes = useStore((state) => state.planes)
  const sets = useStore((state) => state.sets)
  const searchIndex = useStore((state) => state.searchIndex)
  const go = useNavigateTo()
  const { addSet } = useFilters()

  const results = useSearchResults(query)
  const flat = results.flat
  const ready = searchIndex !== null

  useEffect(() => {
    setCursor(0)
  }, [query])

  // Keep the highlighted row in view without touching layout on every keystroke.
  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]')
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' })
  }, [cursor, query])

  const close = (): void => {
    setOverlay(null)
  }

  const select = (hit: SearchHit): void => {
    if (hit.kind === 'plane') {
      go({ kind: 'plane', slug: hit.slug }, 'search')
      close()
      return
    }
    if (hit.kind === 'set') {
      addSet(hit.code.toLowerCase())
      // PRD 6.5.4: a reprint-only set has no plane, so the camera goes out to the multiverse where
      // its reprints are visible across every plane they were first printed on.
      go(hit.planeSlug === null ? { kind: 'multiverse' } : { kind: 'plane', slug: hit.planeSlug }, 'search')
      close()
      return
    }
    // A card result carries a star index; the plane comes from the roster, so selecting a card
    // never waits on `stars.bin` (PRD 6.2.3's first stage only needs the plane).
    const plane = planes === null ? null : planeOfStarIndex(planes.planes, hit.starIndex)
    if (plane === null || sets === null) return
    go(
      {
        kind: 'card',
        planeSlug: plane.slug,
        oracleId: sets.oracleId(hit.starIndex),
        starIndex: hit.starIndex,
      },
      'search',
    )
    close()
  }

  // Built inline rather than memoised: PRD 6.5.3 caps this at 24 rows, so the render is far
  // cheaper than the dependency list a memo would need to get right.
  const rows = ((): ReactElement[] => {
    const items: ReactElement[] = []
    let index = 0
    const push = (hit: SearchHit): ReactElement => {
      const at = index
      index += 1
      const selected = at === cursor
      return (
        <li
          key={hitKey(hit)}
          id={`search-hit-${String(at)}`}
          role="option"
          aria-selected={selected}
          className={selected ? 'search-hit search-hit-active' : 'search-hit'}
          onPointerDown={(event) => {
            // `pointerdown`, not `click`: the input's blur would otherwise close the overlay first.
            event.preventDefault()
            select(hit)
          }}
          onPointerEnter={() => {
            setCursor(at)
          }}
        >
          {hit.kind === 'plane' ? (
            <>
              <span className="search-name">{hit.name}</span>
              <span className="search-meta">{NUMBER.format(hit.cardCount)} cards</span>
            </>
          ) : hit.kind === 'set' ? (
            <>
              <span className="search-name">{hit.name}</span>
              <span className="search-meta">
                {hit.code.toUpperCase()} · {hit.year}
                {hit.planeSlug === null ? ' · reprints only' : ''}
              </span>
            </>
          ) : (
            <>
              <span className="search-name">{hit.name}</span>
              <span className="search-meta">
                {hit.face === 'back' ? `back of ${hit.frontName}` : 'card'}
              </span>
            </>
          )}
        </li>
      )
    }

    if (results.planes.length > 0) {
      items.push(<GroupLabel key="g-planes">Planes</GroupLabel>)
      for (const hit of results.planes) items.push(push(hit))
    }
    if (results.sets.length > 0) {
      items.push(<GroupLabel key="g-sets">Sets</GroupLabel>)
      for (const hit of results.sets) items.push(push(hit))
    }
    if (results.cards.length > 0) {
      items.push(<GroupLabel key="g-cards">Cards</GroupLabel>)
      for (const hit of results.cards) items.push(push(hit))
    }
    return items
  })()

  return (
    <div
      className="overlay-scrim"
      onPointerDown={(event) => {
        // PRD 6.5.1: "dismissed by Esc or clicking outside".
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="search-box" role="dialog" aria-modal="true" aria-label="Search" ref={dialog}>
        <input
          type="search"
          className="search-input"
          value={query}
          placeholder={ready ? 'Search cards, planes and sets' : 'Loading the search index…'}
          disabled={!ready}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="search-results"
          aria-autocomplete="list"
          {...(flat.length > 0 && { 'aria-activedescendant': `search-hit-${String(cursor)}` })}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((at) => (flat.length === 0 ? 0 : (at + 1) % flat.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((at) => (flat.length === 0 ? 0 : (at - 1 + flat.length) % flat.length))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const hit = flat[cursor]
              if (hit) select(hit)
            }
            // Esc is not handled here: `useKeyboardMap` closes the overlay, so there is one
            // producer of that behaviour rather than two that can disagree (PRD 6.11).
          }}
        />

        <ul
          id="search-results"
          ref={listRef}
          className="search-results"
          role="listbox"
          aria-label="Search results"
        >
          {rows}
        </ul>

        {query.length > 0 && flat.length === 0 && ready ? (
          <p className="search-empty">No matches.</p>
        ) : null}
      </div>
    </div>
  )
}
