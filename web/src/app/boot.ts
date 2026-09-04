/**
 * The cold-start sequence: PRD 8.7's loading order, PRD 6.8.2's intro, and PRD 6.7.1's deep link
 * resolution, wired together in the one place where their ordering constraints all meet.
 *
 * The order is not arbitrary and each step names the requirement that fixes it:
 *
 *  1. Bind the URL to the scene (PRD 6.7.1), then canonicalise it. A route we could not parse is
 *     rewritten to what we did parse, before any history entry exists to be confused by it.
 *  2. `stars.bin` completes → `playIntro(target)` (PRD 8.7.4: "intro fly-to starts when `stars.bin`
 *     completes"; PRD 7.2 budgets the transfer before the intro on the same basis).
 *  3. `sets.bin` lands → `resolveCard` or `failCardResolution` (PRD 8.7.5: "the set facet and card
 *     deep-link resolution wait for them"; navigation contract §3a).
 *  4. Intro settles *and* the card resolved → the second stage of PRD 6.2.3 (PRD 6.8.2).
 *  5. Intro settles → the first-visit hint (PRD 6.8.3).
 *
 * Pure of React: one call from one effect, one teardown. Everything it reacts to is either a
 * navigation event or a store change, so there is no render loop to reason about.
 */

import type { Flight, Focus, NavigationApi, PlaneSlug } from '../navigation'
import type { PlaneRecord } from '../data'
import type { Router } from '../router/router'
import { createRouterBinding } from '../router/binding'
import { useStore } from '../store/store'
import { startDatasetLoad } from './dataset'

/**
 * Which plane a star index belongs to, from `planes.json` alone.
 *
 * `stars.bin` carries a `planeIndex` per record, but deriving the plane from the roster instead
 * means card resolution does not have to wait for the largest artefact on the page — the roster is
 * ordered by `starOffset` and the ranges are contiguous by construction (PRD 8.3: records are
 * "ordered by plane, then band, then arm").
 */
export function planeOfStarIndex(
  planes: readonly PlaneRecord[],
  starIndex: number,
): PlaneRecord | null {
  for (const plane of planes) {
    if (starIndex >= plane.starOffset && starIndex < plane.starOffset + plane.starCount) {
      return plane
    }
  }
  return null
}

function describeWarnings(router: Router): string | null {
  const { warnings } = router.snapshot()
  for (const warning of warnings) {
    if (warning.kind === 'bad-oracle-id') return 'That card link is malformed. Showing its plane.'
    if (warning.kind === 'bad-slug') return 'That plane link is malformed. Showing the multiverse.'
    if (warning.kind === 'unknown-route') return 'That link does not exist. Showing the multiverse.'
  }
  return null
}

export function boot(nav: NavigationApi, router: Router): () => void {
  const store = useStore.getState()
  const initial = router.snapshot()
  const deepLinkCard = initial.focus.kind === 'card' ? initial.focus : null

  // 1. Bind focus to the address bar in both directions before anything can change focus — the
  //    intro below is a focus change, and an unbound intro would leave the URL behind.
  const unbind = createRouterBinding(nav, router)
  // Canonicalise. `parseRoute` may have dropped an unknown filter value or fallen back from an
  // unparseable path; `replace` is a no-op when the URL already agrees.
  router.replace(initial.focus, initial.filters)
  const warning = describeWarnings(router)
  if (warning !== null) store.pushToast(warning, 'error')

  let introFlight: Flight | null = null
  let introSettled: { cancelled: boolean } | null = null
  let resolutionDone = false
  let secondStageStarted = false
  let disposed = false

  /**
   * PRD 6.8.2's deferred second stage. Runs only once both preconditions hold, which is why it is
   * a function polled from two places rather than a chain: the intro and `sets.bin` land in
   * whichever order the network gives them.
   */
  const maybeSecondStage = (): void => {
    if (disposed || secondStageStarted || deepLinkCard === null) return
    if (introSettled === null || !resolutionDone) return
    // The user grabbed the camera during the intro (PRD 5.7.3). Yanking it back to finish a
    // flight they cancelled is exactly what "returns control without a jump" forbids.
    if (introSettled.cancelled) return
    const focus = nav.snapshot().focus
    if (focus.kind !== 'card' || focus.oracleId !== deepLinkCard.oracleId) return
    secondStageStarted = true
    nav.flyToCard(
      {
        planeSlug: focus.planeSlug,
        oracleId: focus.oracleId,
        ...(focus.starIndex !== undefined && { starIndex: focus.starIndex }),
        ...(focus.anchor && { anchor: focus.anchor }),
      },
      { reason: 'deep-link' },
    )
  }

  const startIntro = (): void => {
    if (introFlight !== null) return
    // PRD 6.8.2 hands the *card* focus to the intro, not the plane: the scene ends the intro
    // framing the card's plane and the caller follows with the second stage (navigation contract
    // §3a). Passing the plane instead would move focus off the card and the router would rewrite
    // the deep link out of the address bar.
    introFlight = nav.playIntro(router.snapshot().focus, { reason: 'intro' })
    void introFlight.done.then((result) => {
      introSettled = { cancelled: result.status === 'cancelled' }
      if (!useStore.getState().settings.hintDismissed) {
        useStore.getState().setHintVisible(true)
      }
      maybeSecondStage()
    })
  }

  /** PRD 6.7.1 and 8.7.5: the deep link's `oracle_id` becomes a star index, or does not exist. */
  const resolveDeepLink = (): void => {
    if (resolutionDone || deepLinkCard === null) return
    const state = useStore.getState()
    const sets = state.sets
    const planes = state.planes
    if (sets === null || planes === null) return
    resolutionDone = true

    const focus = nav.snapshot().focus
    if (focus.kind !== 'card' || focus.oracleId !== deepLinkCard.oracleId) return

    const starIndex = sets.starIndexOf(focus.oracleId)
    if (starIndex < 0) {
      // PRD risk 9: "a dead card link falls back to the multiverse with a toast." The navigation
      // contract's *default* fallback is the card's plane, which is the gentler camera move; the
      // PRD names the multiverse, and the PRD is the higher authority (implementation plan §2
      // repeats it for this phase), so the fallback is passed explicitly.
      nav.failCardResolution(focus.oracleId, { kind: 'multiverse' })
      return
    }
    const plane = planeOfStarIndex(planes.planes, starIndex)
    const movedTo: PlaneSlug | undefined =
      plane !== null && plane.slug !== focus.planeSlug ? plane.slug : undefined
    nav.resolveCard(focus.oracleId, {
      starIndex,
      // PRD 6.7.1: "if a data refresh has moved the card to another plane, the card wins and the
      // URL is rewritten". Only set when it actually moved — `resolveCard` treats it as a change.
      ...(movedTo !== undefined && { planeSlug: movedTo }),
    })
    maybeSecondStage()
  }

  // PRD risk 9's toast hangs off the `'correction'` focuschange and not off the `'failed'` flight
  // result, because under reduced motion there may be no flight left to fail (navigation contract
  // §2 invariant 6). A correction that moves focus *off* a card is the failure; one that leaves a
  // card focus in place is `resolveCard` succeeding.
  const offCorrection = nav.on('focuschange', ({ focus, reason }: { focus: Focus; reason: string }) => {
    if (reason !== 'correction') return
    if (focus.kind === 'card') return
    useStore
      .getState()
      .pushToast('That card is no longer in this dataset. Showing the multiverse instead.', 'error')
  })

  const unsubscribe = useStore.subscribe((state) => {
    if (disposed) return
    if (state.stars !== null) startIntro()
    if (state.sets !== null && state.planes !== null) {
      resolveDeepLink()
      maybeSecondStage()
    }
  })

  void startDatasetLoad()
  // The artefacts may already be in the store when a hot reload re-runs this.
  const current = useStore.getState()
  if (current.stars !== null) startIntro()
  if (current.sets !== null && current.planes !== null) resolveDeepLink()

  return () => {
    disposed = true
    unbind()
    offCorrection()
    unsubscribe()
  }
}
