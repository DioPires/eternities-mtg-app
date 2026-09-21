/**
 * PRD 5.8's dimming, delivered: the store's filter evaluation, subscribed to the worlds cell sheets.
 *
 * **Why a plain function and not a hook.** The hook is a few lines at the bottom of this file; the
 * work is in {@link bindWorldsFilterMask} so that a test can drive the real seam — the real store,
 * the real `evaluateFilters` — without a React renderer. The defect this module was written against
 * was a *wiring* defect (the mask was computed and never reached a GPU, review §5.2 F1), so the test
 * has to exercise the wiring rather than re-assert the rule. See `test/filter-mask.test.ts`.
 *
 * **One writer.** `useFilterEvaluation` is the only producer of `filterEvaluation` and this is the
 * only consumer that writes it at a GPU; `test/filter-mask.test.ts` pins that too.
 *
 * The star field's half — `bindFilterMask`, which scattered the mask into `StarGeometry`'s filter
 * lane — outlived the field it fed (DEC-752) and was deleted by DEC-868: after the cutover no mesh
 * uploaded that lane, so every chip click cost a ~28 KB strided write nothing read.
 */

import { useEffect } from 'react'

import { useStore, type AppState } from '../store/store'

/** Just the slice of the store this needs, so a test can pass a stub without faking the rest. */
export interface FilterMaskSource {
  getState: () => Pick<AppState, 'filterEvaluation'>
  subscribe: (listener: (state: Pick<AppState, 'filterEvaluation'>) => void) => () => void
}

/**
 * Subscribe the worlds attachment to the store's filter evaluation until the returned function is
 * called (spec §1.11, DEC-751). `null` — no `stars.bin` yet, or no filter — clears.
 *
 * Applies the current evaluation immediately, because a deep link may already carry filters in the
 * URL. The attachment outlives every roster it composes and rebuilds its surfaces on §1.12's rung,
 * so it holds the last mask itself: this is a push, not a handshake.
 */
export function bindWorldsFilterMask(
  worlds: WorldsFilterTarget,
  source: FilterMaskSource = useStore,
): () => void {
  let last = source.getState().filterEvaluation
  worlds.setFilterMask(last?.mask ?? null)
  return source.subscribe((state) => {
    // Identity on the wrapper, not on the array: `evaluateFilters` reuses its buffer, so the array
    // is the same object across evaluations and comparing it would never see a change.
    if (state.filterEvaluation === last) return
    last = state.filterEvaluation
    worlds.setFilterMask(last?.mask ?? null)
  })
}

/** Just the method, so a test — and the type — need nothing of the renderer. */
export interface WorldsFilterTarget {
  setFilterMask: (mask: Uint8Array | null) => void
}

/** The React attachment for the worlds half. One call, from `EternitiesScene`. */
export function useWorldsFilterMask(worlds: WorldsFilterTarget | null): void {
  useEffect(() => {
    if (worlds === null) return
    return bindWorldsFilterMask(worlds)
  }, [worlds])
}
