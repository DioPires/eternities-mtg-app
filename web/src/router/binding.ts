/**
 * The two-way binding between the navigation contract and the URL — PRD 6.7.1's "the URL is the
 * source of truth", made concrete.
 *
 * One direction: the scene changes focus, the router writes the URL.
 * The other: the user presses back, the router reads the URL and asks the scene to fly there.
 *
 * The loop is closed by one rule, and it is the rule that keeps this from being an infinite
 * `pushState`: **a write only happens when the *path* actually changes**. A `focuschange` for a
 * focus the URL already names writes nothing, and a `popstate` to a focus the scene already has
 * flies nowhere. Navigation contract §3a makes that the router's obligation explicitly, because
 * PRD 6.8.2's deferred second stage re-issues a focus the URL already holds.
 *
 * Pure of React so `web/test/router.test.ts` can drive it against the Phase 0 stub and a fake
 * history under Node.
 */

import type { Flight, Focus, NavigationApi, NavigationReason } from '../navigation'
import { BLIND_ETERNITIES_SLUG } from '../data'
import { pathOf } from './route'
import type { Router } from './router'

/**
 * Dispatch a `Focus` onto the right contract method.
 *
 * `flyToPlane` already delegates the Blind Eternities slug, but an *anchored* plane focus has to
 * go through `flyToBlindEternities` to carry the anchor (navigation contract §1: `anchor:
 * undefined` on that plane *means* the multiverse centre, so losing it teleports the user).
 */
export function navigateTo(
  nav: NavigationApi,
  focus: Focus,
  reason: NavigationReason,
): Flight | null {
  if (focus.kind === 'multiverse') return nav.flyToMultiverse({ reason })
  if (focus.kind === 'plane') {
    if (focus.slug === BLIND_ETERNITIES_SLUG) return nav.flyToBlindEternities(focus.anchor, { reason })
    return nav.flyToPlane(focus.slug, { reason })
  }
  return nav.flyToCard(
    {
      planeSlug: focus.planeSlug,
      oracleId: focus.oracleId,
      ...(focus.starIndex !== undefined && { starIndex: focus.starIndex }),
      ...(focus.anchor && { anchor: focus.anchor }),
    },
    { reason },
  )
}

/**
 * Turns a card focus parsed from the URL into its star index, or `undefined` while that is not
 * knowable. The URL carries no `starIndex` by design (`route.ts`), so the binding cannot recover it
 * alone; `boot` owns the data it resolves through.
 */
export type StarResolver = (focus: Extract<Focus, { kind: 'card' }>) => number | undefined

function withResolvedStar(focus: Focus, resolveStar: StarResolver): Focus {
  if (focus.kind !== 'card' || focus.starIndex !== undefined) return focus
  const starIndex = resolveStar(focus)
  return starIndex === undefined ? focus : { ...focus, starIndex }
}

export function createRouterBinding(
  nav: NavigationApi,
  router: Router,
  resolveStar: StarResolver = () => undefined,
): () => void {
  const offFocus = nav.on('focuschange', ({ focus, reason }) => {
    const route = router.snapshot()
    if (reason === 'correction') {
      // Navigation contract §3a: a correction rewrites the URL the user already has. Pushing it
      // would leave a dead card id in their back history, which is the one rule Phase 4 would
      // otherwise have guessed wrong.
      router.replace(focus, route.filters)
      return
    }
    // Dedupe on the path, not on the reason. §3a: `flyToCard` after `playIntro` carries an
    // ordinary reason for a focus the URL already names.
    if (pathOf(focus) !== pathOf(route.focus)) router.push(focus, route.filters)
  })

  const offPop = router.onPopState(() => {
    const route = router.snapshot()
    if (pathOf(route.focus) === pathOf(nav.snapshot().focus)) return
    // PRD 6.2.2: "browser back behaves like Esc and browser forward replays the fly-to" — both
    // are ordinary fly-tos to whatever the restored URL names. A replay lands on the focus the
    // original landed on, and a card focus without its `starIndex` is not that focus: no tether to
    // the star and no printing ring (DEC-887). The URL dropped it, so it is resolved back here.
    navigateTo(nav, withResolvedStar(route.focus, resolveStar), 'history')
  })

  return () => {
    offFocus()
    offPop()
  }
}
