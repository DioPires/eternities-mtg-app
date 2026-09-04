/**
 * PRD 6.4: "Panels are a right-side drawer, collapsible, that opens automatically on plane or card
 * focus and closes on Esc to multiverse."
 *
 * The drawer is the container; `PlanePanel` and `CardPanel` are the two contents. It stays mounted
 * and collapses with a transform so nothing reflows the page when it opens (PRD 7.3.3), and it is
 * `aria-hidden` while collapsed so a screen reader does not read a panel that is off-screen.
 */

import type { ReactElement } from 'react'

import { useCardDetail, useFocusedPlane, useNavSnapshot } from '../app/hooks'
import { starMatches } from '../filters/evaluate'
import { useStore } from '../store/store'
import { CardPanel } from './CardPanel'
import { ChevronIcon } from './icons'
import { PlanePanel } from './PlanePanel'

export function Drawer(): ReactElement | null {
  const { focus } = useNavSnapshot()
  const panelOpen = useStore((state) => state.panelOpen)
  const setPanelOpen = useStore((state) => state.setPanelOpen)
  const evaluation = useStore((state) => state.filterEvaluation)
  const plane = useFocusedPlane()
  const detail = useCardDetail()

  if (focus.kind === 'multiverse') return null

  const open = panelOpen
  const isCard = focus.kind === 'card'
  const dimmed =
    isCard && detail.starIndex !== null ? !starMatches(evaluation, detail.starIndex) : false

  return (
    <aside
      className={open ? 'drawer drawer-open' : 'drawer'}
      aria-hidden={!open}
      aria-label={isCard ? 'Card details' : 'Plane details'}
    >
      <button
        type="button"
        className="drawer-toggle"
        onClick={() => {
          setPanelOpen(!open)
        }}
        aria-expanded={open}
        aria-label={open ? 'Collapse the details panel' : 'Expand the details panel'}
        title={open ? 'Collapse' : 'Expand'}
      >
        <span className={open ? 'drawer-chevron drawer-chevron-open' : 'drawer-chevron'}>
          <ChevronIcon />
        </span>
      </button>

      <div className="drawer-scroll">
        {isCard ? (
          detail.card !== null && detail.plane !== null ? (
            <CardPanel card={detail.card} plane={detail.plane} dimmed={dimmed} />
          ) : detail.failed ? (
            <div className="panel-body">
              <p className="panel-empty">Card details are unavailable.</p>
            </div>
          ) : (
            <div className="panel-body">
              <p className="panel-empty">Loading card…</p>
            </div>
          )
        ) : plane !== null ? (
          <PlanePanel plane={plane} />
        ) : (
          <div className="panel-body">
            <p className="panel-empty">Loading plane…</p>
          </div>
        )}
      </div>
    </aside>
  )
}
