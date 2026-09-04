/**
 * The React glue between the URL, the store and the navigation contract.
 *
 * Everything here is a hook over state that already exists somewhere else — the address bar
 * (PRD 6.7), the Zustand store (PRD 8.4.2) or the scene. Nothing here is a second copy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BLIND_ETERNITIES_SLUG, type CardRecord, type PlaneRecord } from '../data'
import { evaluateFilters, type FilterEvaluation } from '../filters/evaluate'
import {
  toggleFacetValue,
  type FilterColour,
  type FilterRarity,
  type FilterState,
  type FilterType,
} from '../filters/types'
import { EMPTY_FILTERS } from '../filters/types'
import { search, type SearchResults } from '../search'
import { reducedMotionOf, useStore } from '../store/store'
import { loadCard } from './cardDetail'
import { planeOfStarIndex } from './boot'
import { navigateTo } from '../router/binding'
import { useNavigation, useNavSnapshot, useRoute, useRouter } from './services'

/** PRD 6.6: the filter state and every way the HUD changes it. All of them rewrite the URL. */
export interface FilterActions {
  readonly filters: FilterState
  setFilters: (next: FilterState) => void
  toggleColour: (value: FilterColour) => void
  toggleType: (value: FilterType) => void
  toggleRarity: (value: FilterRarity) => void
  toggleSet: (code: string) => void
  addSet: (code: string) => void
  clearAll: () => void
}

export function useFilters(): FilterActions {
  const router = useRouter()
  const { filters } = useRoute()

  const setFilters = useCallback(
    (next: FilterState) => {
      router.setFilters(next)
    },
    [router],
  )

  return useMemo<FilterActions>(
    () => ({
      filters,
      setFilters,
      toggleColour: (value) =>
        setFilters({ ...filters, colours: toggleFacetValue(filters.colours, value) }),
      toggleType: (value) => setFilters({ ...filters, types: toggleFacetValue(filters.types, value) }),
      toggleRarity: (value) =>
        setFilters({ ...filters, rarities: toggleFacetValue(filters.rarities, value) }),
      toggleSet: (code) => setFilters({ ...filters, sets: toggleFacetValue(filters.sets, code) }),
      addSet: (code) =>
        filters.sets.includes(code)
          ? undefined
          : setFilters({ ...filters, sets: [...filters.sets, code] }),
      clearAll: () => setFilters(EMPTY_FILTERS),
    }),
    [filters, setFilters],
  )
}

/**
 * PRD 6.6.5 + 6.3.2: evaluate the filters against the star record and publish both the dimming
 * mask and the exact count.
 *
 * The mask buffer is reused across evaluations (see `evaluateFilters`), so a chip toggle costs one
 * pass over the star array and no allocation. The result lands in the store because Phase 2a's
 * shader reads the mask as its `filterMask` attribute (PRD 8.5.1) — it is not UI state, it is the
 * one artefact both halves of the filter requirement share.
 *
 * **Call this exactly once, from `App`.** The buffer lives in a ref, so a second caller is a
 * second buffer and a second full pass per toggle — the one-pass guarantee above is a property of
 * there being one producer, not of the function. Everything else reads `state.filterEvaluation`.
 */
export function useFilterEvaluation(): FilterEvaluation | null {
  const { filters } = useRoute()
  const stars = useStore((state) => state.stars)
  const sets = useStore((state) => state.sets)
  const setByCode = useStore((state) => state.setByCode)
  const setFilterEvaluation = useStore((state) => state.setFilterEvaluation)
  const buffer = useRef<Uint8Array | undefined>(undefined)

  const setIds = useMemo(() => {
    const ids: number[] = []
    for (const code of filters.sets) {
      const record = setByCode.get(code)
      if (record) ids.push(record.id)
    }
    return ids
  }, [filters.sets, setByCode])

  const evaluation = useMemo(() => {
    if (stars === null) return null
    const result = evaluateFilters(stars, filters, { setIds, sets }, buffer.current)
    buffer.current = result.mask
    return result
  }, [stars, filters, setIds, sets])

  useEffect(() => {
    setFilterEvaluation(evaluation)
  }, [evaluation, setFilterEvaluation])

  return evaluation
}

/** The plane record for the current focus, or `null` at multiverse level. */
export function useFocusedPlane(): PlaneRecord | null {
  const { focus } = useNavSnapshot()
  const planeBySlug = useStore((state) => state.planeBySlug)
  const slug = focus.kind === 'plane' ? focus.slug : focus.kind === 'card' ? focus.planeSlug : null
  return slug === null ? null : (planeBySlug.get(slug) ?? null)
}

export interface CardDetailState {
  readonly card: CardRecord | null
  readonly plane: PlaneRecord | null
  readonly starIndex: number | null
  readonly loading: boolean
  readonly failed: boolean
}

const NO_CARD: CardDetailState = {
  card: null,
  plane: null,
  starIndex: null,
  loading: false,
  failed: false,
}

/**
 * PRD 6.4's card panel data, fetched shard by shard on focus (PRD 8.7.6).
 *
 * The star index comes from the focus when the scene already resolved it, and from `sets.bin`
 * otherwise — an in-app click carries it, a cold deep link does not until `resolveCard` lands.
 */
export function useCardDetail(): CardDetailState {
  const { focus } = useNavSnapshot()
  const planes = useStore((state) => state.planes)
  const planeBySlug = useStore((state) => state.planeBySlug)
  const sets = useStore((state) => state.sets)
  const manifest = useStore((state) => state.manifest)
  const [state, setState] = useState<CardDetailState>(NO_CARD)

  const oracleId = focus.kind === 'card' ? focus.oracleId : null
  const focusStarIndex = focus.kind === 'card' ? focus.starIndex : undefined
  const planeSlug = focus.kind === 'card' ? focus.planeSlug : null

  useEffect(() => {
    if (oracleId === null || planes === null) {
      setState(NO_CARD)
      return
    }
    const resolvedIndex = focusStarIndex ?? (sets ? sets.starIndexOf(oracleId) : -1)
    if (resolvedIndex < 0) {
      // Still waiting on `sets.bin`; the panel shows its loading state rather than "not found".
      setState({ ...NO_CARD, loading: sets === null })
      return
    }
    const plane =
      planeOfStarIndex(planes.planes, resolvedIndex) ??
      (planeSlug === null ? null : (planeBySlug.get(planeSlug) ?? null))
    if (plane === null) {
      setState({ ...NO_CARD, failed: true })
      return
    }

    let cancelled = false
    setState({ card: null, plane, starIndex: resolvedIndex, loading: true, failed: false })
    void loadCard(plane, resolvedIndex, oracleId, manifest?.shardSize ?? planes.shardSize)
      .then((card) => {
        if (cancelled) return
        setState({ card, plane, starIndex: resolvedIndex, loading: false, failed: card === null })
      })
      .catch(() => {
        if (cancelled) return
        setState({ card: null, plane, starIndex: resolvedIndex, loading: false, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [oracleId, focusStarIndex, planeSlug, planes, planeBySlug, sets, manifest])

  return state
}

/** PRD 6.2.1: activating a printing is view state, so it resets when the focused card changes. */
export function useResetActivePrintingOnFocus(): void {
  const { focus } = useNavSnapshot()
  const setActivePrinting = useStore((state) => state.setActivePrinting)
  const oracleId = focus.kind === 'card' ? focus.oracleId : null
  useEffect(() => {
    setActivePrinting(0)
  }, [oracleId, setActivePrinting])
}

/** PRD 6.4: the drawer "opens automatically on plane or card focus and closes on Esc to multiverse". */
export function usePanelAutoOpen(): void {
  const { focus } = useNavSnapshot()
  const setPanelOpen = useStore((state) => state.setPanelOpen)
  const kind = focus.kind
  useEffect(() => {
    setPanelOpen(kind !== 'multiverse')
  }, [kind, setPanelOpen])
}

/** PRD 5.9 and 6.10.1: the OS preference and the settings toggle both reach the scene. */
export function useReducedMotion(): boolean {
  const nav = useNavigation()
  const settings = useStore((state) => state.settings)
  const osReducedMotion = useStore((state) => state.osReducedMotion)
  const setOsReducedMotion = useStore((state) => state.setOsReducedMotion)
  const reduced = reducedMotionOf({ settings, osReducedMotion })

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const listener = (): void => {
      setOsReducedMotion(query.matches)
    }
    listener()
    query.addEventListener('change', listener)
    return () => {
      query.removeEventListener('change', listener)
    }
  }, [setOsReducedMotion])

  useEffect(() => {
    nav.setReducedMotion(reduced)
  }, [nav, reduced])

  return reduced
}

/** PRD 5.3.22: 45 s without input. PRD 5.9: attract mode is disabled under reduced motion. */
export const ATTRACT_IDLE_MS = 45_000

export function useAttractMode(enabled: boolean): void {
  const nav = useNavigation()
  const setAttract = useStore((state) => state.setAttract)

  useEffect(() => {
    const offEnter = nav.on('attractenter', () => {
      setAttract(true)
    })
    const offExit = nav.on('attractexit', () => {
      setAttract(false)
    })
    return () => {
      offEnter()
      offExit()
    }
  }, [nav, setAttract])

  useEffect(() => {
    if (!enabled) {
      nav.exitAttract('programmatic')
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => nav.enterAttract(), ATTRACT_IDLE_MS)
    }
    const onInput = (): void => {
      // PRD 5.3.23: any input cancels attract immediately. `exitAttract` and not `handOver`: a
      // pointer moving across the HUD is not the user grabbing the camera, and `handOver` would
      // cancel a fly-to that nobody asked to cancel (navigation contract §6).
      nav.exitAttract('pointer')
      arm()
    }
    const events: readonly (keyof WindowEventMap)[] = [
      'pointerdown',
      'pointermove',
      'wheel',
      'keydown',
      // PRD 6.1.5: touch is not supported, but a touch is still input and must not leave the page
      // stuck in attract mode.
      'touchstart',
    ]
    for (const event of events) window.addEventListener(event, onInput, { passive: true })
    arm()
    return () => {
      if (timer !== null) clearTimeout(timer)
      for (const event of events) window.removeEventListener(event, onInput)
    }
  }, [enabled, nav])
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * PRD 6.11's keyboard map, and nothing else: `/` search, Esc up one level or close overlay,
 * `?` help. Enter and the arrows belong to whatever has focus (the search list), so they are not
 * intercepted here.
 */
export function useKeyboardMap(): void {
  const nav = useNavigation()
  const overlay = useStore((state) => state.overlay)
  const setOverlay = useStore((state) => state.setOverlay)
  const hintVisible = useStore((state) => state.hintVisible)
  const setHintVisible = useStore((state) => state.setHintVisible)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        // Ordered by what is on top: overlay, then hint, then the camera (PRD 6.1.3).
        if (overlay !== null) {
          setOverlay(null)
        } else if (hintVisible) {
          setHintVisible(false)
        } else {
          nav.focusParent({ reason: 'user' })
        }
        event.preventDefault()
        return
      }
      if (isTypingTarget(event.target)) return
      if (event.key === '/') {
        setOverlay('search')
        event.preventDefault()
        return
      }
      if (event.key === '?') {
        setOverlay(overlay === 'help' ? null : 'help')
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [nav, overlay, setOverlay, hintVisible, setHintVisible])
}

/** PRD 6.5: the query, debounced by nothing — the index is in memory (PRD 6.5.5). */
export function useSearchResults(query: string): SearchResults {
  const index = useStore((state) => state.searchIndex)
  return useMemo(() => search(index, query), [index, query])
}

/** PRD 6.7.4: copy the current route with filters, confirm with a transient toast. */
export function useShare(): () => void {
  const pushToast = useStore((state) => state.pushToast)
  return useCallback(() => {
    const url = window.location.href
    const confirm = (): void => {
      pushToast('Link copied to the clipboard.', 'info', 3000)
    }
    // `navigator.clipboard` needs a secure context; the fallback keeps the control honest on
    // plain http (a local preview) rather than failing silently.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(confirm, () => {
        pushToast(`Copy failed. The link is ${url}`, 'error')
      })
      return
    }
    pushToast(`Copy is unavailable here. The link is ${url}`, 'error')
  }, [pushToast])
}

/** PRD 6.9's random control. Needs `sets.bin` to turn a star index into an `oracle_id`. */
export function useRandom(): { go: () => void; ready: boolean } {
  const nav = useNavigation()
  const planes = useStore((state) => state.planes)
  const sets = useStore((state) => state.sets)
  const pushToast = useStore((state) => state.pushToast)
  const ready = planes !== null && sets !== null

  const go = useCallback(() => {
    if (planes === null || sets === null) return
    // Imported lazily so the pure picker stays out of the hook's dependency surface.
    void import('./random').then(({ pickRandom }) => {
      const pick = pickRandom(planes.planes)
      if (pick === null) {
        pushToast('No cards to jump to yet.', 'error', 3000)
        return
      }
      const oracleId = sets.oracleId(pick.starIndex)
      nav.flyToCard(
        { planeSlug: pick.plane.slug, oracleId, starIndex: pick.starIndex },
        { reason: 'random' },
      )
    })
  }, [nav, planes, sets, pushToast])

  return { go, ready }
}

/** Fly somewhere from the UI. Everything the HUD, search and panels click goes through here. */
export function useNavigateTo(): (focus: Parameters<typeof navigateTo>[1], reason: Parameters<typeof navigateTo>[2]) => void {
  const nav = useNavigation()
  return useCallback(
    (focus, reason) => {
      navigateTo(nav, focus, reason)
    },
    [nav],
  )
}

export { BLIND_ETERNITIES_SLUG }
/** Re-exported so a component has one import for "everything the shell knows". */
export { useNavigation, useNavSnapshot, useRoute, useRouter, useServices } from './services'
