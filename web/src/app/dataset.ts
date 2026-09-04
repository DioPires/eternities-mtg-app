/**
 * PRD 8.7's loading order, driven once per page load and written into the store.
 *
 *   manifest.json + planes.json  →  first frame
 *   stars.bin                    →  streamed, draw range grows (PRD 6.8.1)
 *   search.json + sets.bin       →  after the first frame (PRD 6.5.5, 7.2)
 *   planes/<slug>.<n>.json       →  on card focus (`./cardDetail`)
 *
 * PRD 7.4.1 is the reliability contract: the loader in `../data/load` already retries with
 * exponential backoff three times; this reports the final failure **once**, through the store's
 * toast queue, and leaves everything that does not depend on the missing artefact working.
 *
 * Idempotent and module-scoped, because `StrictMode` double-invokes effects and a second
 * `stars.bin` stream would double the biggest transfer on the page.
 *
 * **Phase 2a seam.** When the star renderer takes over `stars.bin` it should call
 * {@link reportDataError} for its own exhausted retries rather than growing a second toast path.
 */

import {
  loadManifest,
  loadPlanes,
  loadSearch,
  loadSets,
  streamStars,
  type PlaneRecord,
  type SearchSetRecord,
} from '../data'
import { buildSearchIndex } from '../search'
import { useStore } from '../store/store'

let started = false

/** PRD 7.4.1's non-blocking report. Shared with Phase 2a's streaming loader. */
export function reportDataError(artefact: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  console.warn(`[eternities] ${artefact} failed to load: ${detail}`)
  useStore
    .getState()
    .pushToast(`Could not load ${artefact}. Some of the multiverse may be missing.`, 'error', null)
}

function indexPlanes(planes: readonly PlaneRecord[]): {
  planeBySlug: Map<string, PlaneRecord>
  planeByIndex: PlaneRecord[]
} {
  const planeBySlug = new Map<string, PlaneRecord>()
  const planeByIndex: PlaneRecord[] = []
  for (const plane of planes) {
    planeBySlug.set(plane.slug, plane)
    planeByIndex[plane.index] = plane
  }
  return { planeBySlug, planeByIndex }
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

/** Resolves after the browser has actually painted, which is what PRD 6.5.5 means by "after". */
function afterFirstFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

async function loadFirstFrameArtefacts(): Promise<void> {
  const store = useStore.getState()
  const [manifest, planesFile] = await Promise.all([loadManifest(), loadPlanes()])
  store.patchData({ manifest, planes: planesFile, ...indexPlanes(planesFile.planes) })
}

async function loadStars(): Promise<void> {
  const store = useStore.getState()
  // The draw range changes on every chunk; the HUD does not need to re-render that often, and
  // PRD 7.3.3 forbids layout work per frame. One publish per animation frame is plenty.
  let pendingProgress = 0
  let scheduled = false
  const publish = (): void => {
    scheduled = false
    useStore.getState().patchData({ starsDrawable: pendingProgress })
  }
  const stars = await streamStars((reader) => {
    pendingProgress = reader.completeRecords
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(publish)
    else publish()
  })
  store.patchData({ stars, starsDrawable: stars.count })
}

async function loadSearchArtefacts(): Promise<void> {
  await afterFirstFrame()
  const [searchFile, sets] = await Promise.all([loadSearch(), loadSets()])
  useStore.getState().patchData({
    searchFile,
    searchIndex: buildSearchIndex(searchFile),
    sets,
    ...indexSets(searchFile.sets),
  })
}

/**
 * Kick off the whole load. Returns a promise that settles when everything that is going to arrive
 * has arrived — nothing awaits it in the app, but the browser check does.
 */
export function startDatasetLoad(): Promise<void> {
  if (started) return Promise.resolve()
  started = true

  // `planes.json` gates nothing else here, but a failure to load it is the one that makes the
  // page useless, so it is reported first and loudly.
  const first = loadFirstFrameArtefacts().catch((error: unknown) => {
    reportDataError('the plane roster', error)
  })

  const stars = first.then(() =>
    loadStars().catch((error: unknown) => {
      reportDataError('the star positions', error)
    }),
  )
  const search = first.then(() =>
    loadSearchArtefacts().catch((error: unknown) => {
      reportDataError('the search index', error)
    }),
  )

  return Promise.all([stars, search]).then(() => undefined)
}

/** Test seam. Never called by the app. */
export function resetDatasetLoadForTests(): void {
  started = false
}
