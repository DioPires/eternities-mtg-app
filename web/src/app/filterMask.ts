/**
 * PRD 5.8's dimming, delivered: the store's filter evaluation, subscribed to the GPU.
 *
 * This is the missing half of the filter requirement. `filters/evaluate.ts` has computed the
 * per-star mask since Phase 4 and `StarGeometry.setFilterMask` has been able to upload it since
 * Phase 2a, but nothing joined them — `setFilterMask` and `clearFilter` had test callers only, so
 * `FILTER_DIM` and the shader's `vPickable` gate were dead code and a filter changed the chip count
 * and nothing else on screen.
 *
 * **Why a plain function and not a hook.** The hook is three lines at the bottom of this file; the
 * work is here so that a test can drive the real seam — the real store, the real
 * `evaluateFilters`, a real `StarGeometry` — under Node, without a React renderer (this repo's
 * vitest environment is `node` and it collects only `.test.ts` files, so there is no renderer to
 * reach for). The defect being fixed was precisely a *wiring* defect, so the test has to be able to
 * exercise the wiring rather than re-assert the rule. See `test/filter-mask.test.ts`.
 *
 * **One writer.** `useFilterEvaluation` is the only producer of `filterEvaluation` (it says so, at
 * length) and this is the only consumer that writes to the GPU. Nothing else may call
 * `setFilterMask`; `test/filter-mask.test.ts` pins that too.
 */

import { useEffect } from 'react'

import type { FilterEvaluation } from '../filters/evaluate'
import type { StarGeometry } from '../scene/starfield/starGeometry'
import { useStore, type AppState } from '../store/store'

/** Just the slice of the store this needs, so a test can pass a stub without faking the rest. */
export interface FilterMaskSource {
  getState: () => Pick<AppState, 'filterEvaluation'>
  subscribe: (listener: (state: Pick<AppState, 'filterEvaluation'>) => void) => () => void
}

/**
 * Push one evaluation at the geometry. `null` — no `stars.bin` yet, or no filter — clears.
 *
 * The mask and the geometry are both sized from `manifest.counts.stars`, so the lengths agree by
 * construction. The clamp is there because this runs inside a store listener: a manifest that
 * disagreed with itself should cost the tail of the dimming, not throw out of a subscriber and take
 * the frame loop with it.
 */
export function applyFilterMask(
  geometry: StarGeometry,
  evaluation: FilterEvaluation | null,
): void {
  if (evaluation === null) {
    geometry.clearFilter()
    return
  }
  const count = Math.min(evaluation.mask.length, geometry.capacity)
  geometry.setFilterMask(evaluation.mask, 0, count)
}

/**
 * Subscribe `geometry` to the store's filter evaluation until the returned function is called.
 *
 * Applies the current evaluation immediately: the geometry is built when `planes.json` lands and a
 * deep link may already carry filters in the URL, so "the next change" is not soon enough.
 */
export function bindFilterMask(
  geometry: StarGeometry,
  source: FilterMaskSource = useStore,
): () => void {
  let last = source.getState().filterEvaluation
  applyFilterMask(geometry, last)
  return source.subscribe((state) => {
    // `evaluateFilters` reuses its output buffer, so the *array* is the same object across
    // evaluations and only the wrapper is new. Comparing the wrapper is therefore the only honest
    // change test — and it is also why `setFilterMask` has to copy rather than retain (it does).
    if (state.filterEvaluation === last) return
    last = state.filterEvaluation
    applyFilterMask(geometry, last)
  })
}

/** The React attachment. One call, from `App`, next to `useFilterEvaluation`'s. */
export function useFilterMask(geometry: StarGeometry | null): void {
  useEffect(() => {
    if (geometry === null) return
    return bindFilterMask(geometry)
  }, [geometry])
}

/**
 * The same subscription, for the worlds path (spec §1.11, DEC-751).
 *
 * A separate binding rather than a second consumer inside {@link bindFilterMask}, because the two
 * subjects have different lifetimes: the star geometry is built once with `planes.json`, while the
 * worlds attachment outlives every roster it composes and rebuilds its surfaces on §1.12's rung.
 * The attachment holds the last mask for exactly that reason, so this is a push, not a handshake.
 *
 * The rule the two share is the one that matters: **one writer**. `useFilterEvaluation` produces
 * the evaluation, and these two functions are the only things that write it at a GPU.
 */
export function bindWorldsFilterMask(
  worlds: WorldsFilterTarget,
  source: FilterMaskSource = useStore,
): () => void {
  let last = source.getState().filterEvaluation
  worlds.setFilterMask(last?.mask ?? null)
  return source.subscribe((state) => {
    // Identity on the wrapper, not on the array: `evaluateFilters` reuses its buffer, so the array
    // is the same object across evaluations. Same reasoning as `bindFilterMask` above.
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
