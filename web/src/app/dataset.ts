/**
 * The dataset, as the shell sees it: one mirror from the scene's load into the Zustand store.
 *
 * **This module used to fetch.** Through Phase 5 it ran PRD 8.7's loading order itself — manifest,
 * planes, `stars.bin`, then `search.json` and `sets.bin` — while `scene/useSceneData.ts` ran the
 * very same order for the scene's GPU resources. Nothing noticed, because the two never ran on the
 * same page: `App` routed the shell and the scene to different URLs. Phase 6 mounts the scene
 * *inside* the shell, and at that point two loaders means two of every transfer, `stars.bin`
 * included — the row PRD 7.2 budgets at 3 MB before the intro and the one artefact the intro waits
 * on (PRD 8.7.4). Doubling it is not a rounding error, it is the budget.
 *
 * So there is one loader now, and it is the scene's, because only the scene's can be one: the star
 * records have to reach a GPU buffer as they arrive (PRD 8.7.3's growing draw range), and a loader
 * that decodes into an array first cannot do that without holding the whole file twice. What the
 * shell needs on top is all derived — indices, a search index, the decoded snapshot the filter mask
 * walks — so it is derived here, from the state the scene already publishes.
 *
 * The direction matters: the scene knows nothing about the store, and this file knows nothing about
 * fetching. `useSceneData` returns plain data; `useMirrorSceneData` copies it across. Either half
 * can be tested without the other, and the Phase 2a and Phase 3 harnesses keep working unchanged
 * because they simply do not mount the mirror.
 *
 * PRD 7.4.1's "reports once via a non-blocking toast" is the other half of the same seam. The
 * retrying is in `data/load.ts`; the one-event-per-artefact rule is in `scene/errors.ts`; turning
 * that event into the toast the user sees is {@link useSceneErrorToasts}, here, because the toast
 * queue is the store's.
 */

import { useEffect, useMemo } from 'react'

import type { PlaneRecord, PlanesFile, SearchFile, SearchSetRecord } from '../data'
import { sceneErrors } from '../scene/errors'
import type { SceneDataState } from '../scene/useSceneData'
import { buildSearchIndex } from '../search'
import { useStore } from '../store/store'

function indexPlanes(planes: readonly PlaneRecord[]): { planeBySlug: Map<string, PlaneRecord> } {
  const planeBySlug = new Map<string, PlaneRecord>()
  for (const plane of planes) planeBySlug.set(plane.slug, plane)
  return { planeBySlug }
}

function indexSets(sets: readonly SearchSetRecord[]): {
  setByCode: Map<string, SearchSetRecord>
  setById: Map<number, SearchSetRecord>
} {
  const setByCode = new Map<string, SearchSetRecord>()
  const setById = new Map<number, SearchSetRecord>()
  for (const set of sets) {
    setByCode.set(set.code.toLowerCase(), set)
    setById.set(set.id, set)
  }
  return { setByCode, setById }
}

/**
 * Copy the scene's load into the store, deriving the indices the shell reads by key.
 *
 * Split into four effects rather than one, and that is not tidiness. Each artefact arrives at its
 * own time and each has its own derivation cost — `buildSearchIndex` walks every card name — so a
 * single effect keyed on the whole `data` object would rebuild all of it on every one of the ~87
 * `drawable` ticks that PRD 8.7.3's per-plane reveal produces. Keyed individually, each derivation
 * runs exactly once.
 *
 * `patchData` is a plain `set()`, so writing the same values again is cheap but not free: Zustand
 * notifies unconditionally. The effect dependencies are what keep the writes to one per artefact.
 */
export function useMirrorSceneData(data: SceneDataState): void {
  const patchData = useStore((state) => state.patchData)

  const { manifest, planes, stars, search, sets, drawable } = data

  const planeIndices = useMemo(
    () => (planes === null ? null : indexPlanes(planes.planes)),
    [planes],
  )
  const setIndices = useMemo(
    () => (search === null ? null : indexSets(search.sets)),
    [search],
  )
  const searchIndex = useMemo(() => (search === null ? null : buildSearchIndex(search)), [search])

  useEffect(() => {
    if (manifest === null) return
    patchData({ manifest })
  }, [manifest, patchData])

  useEffect(() => {
    if (planes === null || planeIndices === null) return
    patchData({ planes, ...planeIndices })
  }, [planes, planeIndices, patchData])

  // PRD 6.8.1: the shell shows the growing draw range instead of a spinner. This is the one write
  // that repeats, once per plane revealed, which is what makes it worth its own effect.
  useEffect(() => {
    patchData({ starsDrawable: drawable })
  }, [drawable, patchData])

  // `boot()` starts PRD 6.8.2's intro off this becoming non-null, so it is written last of the
  // first-load artefacts and only on a complete transfer (PRD 8.7.4).
  useEffect(() => {
    if (stars === null) return
    patchData({ stars, starsDrawable: stars.count })
  }, [stars, patchData])

  useEffect(() => {
    if (search === null || setIndices === null || searchIndex === null) return
    patchData({ searchFile: search, searchIndex, ...setIndices })
  }, [search, setIndices, searchIndex, patchData])

  useEffect(() => {
    if (sets === null) return
    patchData({ sets })
  }, [sets, patchData])
}

/**
 * PRD 7.4.1's non-blocking report, from the scene's hub to the store's toast queue.
 *
 * `timeoutMs: null` keeps it on screen: a missing artefact does not fix itself, and the user needs
 * to be able to read why part of the multiverse is not there. `SceneErrorHub` already enforces one
 * event per artefact, so there is no de-duplication to do here.
 */
export function useSceneErrorToasts(): void {
  const pushToast = useStore((state) => state.pushToast)
  useEffect(
    () =>
      sceneErrors.subscribe((error) => {
        pushToast(error.message, 'error', null)
      }),
    [pushToast],
  )
}

/** Re-exported for the tests that assert the shell's derived indices without a scene. */
export { indexPlanes, indexSets }

export type { PlanesFile, SearchFile }
