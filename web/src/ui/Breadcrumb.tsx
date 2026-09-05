/**
 * PRD 6.3.1: "Breadcrumb, top-left: Multiverse › Plane › Card. Each ancestor segment is clickable
 * and triggers the corresponding fly-to."
 *
 * The ancestors come from `ancestorsOf(focus)` so the card→plane hop carries its anchor (navigation
 * contract §1); clicking them goes through `navigateTo`, which is the same path Esc and the URL
 * take. The trailing segment is the current focus and is not a button — there is nowhere to fly.
 */

import type { ReactElement } from 'react'

import { useNavSnapshot, useNavigateTo } from '../app/hooks'
import { ancestorsOf } from '../router/route'
import { useStore } from '../store/store'
import type { Focus } from '../navigation'

function labelOf(
  focus: Focus,
  planeName: (slug: string) => string,
  cardName: string | null,
): string {
  if (focus.kind === 'multiverse') return 'Multiverse'
  if (focus.kind === 'plane') return planeName(focus.slug)
  return cardName ?? 'Card'
}

export function Breadcrumb(): ReactElement {
  const { focus } = useNavSnapshot()
  const go = useNavigateTo()
  const planeBySlug = useStore((state) => state.planeBySlug)
  const searchIndex = useStore((state) => state.searchIndex)

  const planeName = (slug: string): string => planeBySlug.get(slug)?.displayName ?? slug
  const starIndex = focus.kind === 'card' ? focus.starIndex : undefined
  const cardName = starIndex !== undefined ? (searchIndex?.nameOf(starIndex) ?? null) : null

  const ancestors = ancestorsOf(focus)

  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {/* `ancestorsOf` only ever yields multiverse and plane focuses — a card is never an
            ancestor — so the key is either the root or the plane slug. */}
        {ancestors.map((ancestor) => (
          <li key={ancestor.kind === 'plane' ? ancestor.slug : 'multiverse'}>
            <button
              type="button"
              className="crumb"
              onClick={() => {
                go(ancestor, 'breadcrumb')
              }}
            >
              {labelOf(ancestor, planeName, null)}
            </button>
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
          </li>
        ))}
        <li>
          <span className="crumb crumb-current" aria-current="page">
            {labelOf(focus, planeName, cardName)}
          </span>
        </li>
      </ol>
    </nav>
  )
}
