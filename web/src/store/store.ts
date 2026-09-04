/**
 * PRD 8.4.2's Zustand store: **transient view state only**.
 *
 * > Focus and filters are derived from the URL, never stored twice.
 *
 * That sentence is the design rule of this file, and it is enforced by omission — there is no
 * `focus` and no `filters` slot here, and `../router/router.ts` is where they live. The
 * temptation to mirror them for convenience is exactly what PRD 6.7 exists to prevent, because a
 * mirror can disagree with the address bar and then sharing a link ships the wrong view.
 *
 * What *is* here: hover id, the active printing (PRD 6.2.1: view state, no route, no history),
 * panel and overlay state, attract mode, the adaptive-quality tier slot (PRD 8.5.11 — Phase 2a's
 * monitor writes it, Phase 3 reads the thumbnail step), the loaded artefacts, the derived filter
 * evaluation, the toast queue and the persisted settings.
 */

import { create } from 'zustand'

import type { Manifest, PlaneRecord, PlanesFile, SearchFile, SearchSetRecord, SetsSidecar, Stars } from '../data'
import type { FilterEvaluation } from '../filters/evaluate'
import type { SearchIndex } from '../search'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  osPrefersReducedMotion,
  resolveReducedMotion,
  saveSettings,
  type Settings,
} from './settings'

/**
 * Which overlay is open. At most one, and Esc closes it (PRD 6.11).
 *
 * `'filters'` is not one of PRD 6.3.3's six cluster controls, and deliberately so: it is opened
 * from the chip row (PRD 6.3.2), because the chip row is what PRD 6.6 gives the user to read and
 * remove facet values and something has to let them *add* one. The PRD names the chips and the
 * facets without ever naming the surface that picks them; this is that surface, kept out of the
 * control cluster so 6.3.3's list stays exactly as written.
 *
 * `'about'` is the same story for the same reason: PRD 4.11 requires the view, PRD 6.3.3's list of
 * six is closed, so it opens from the help sheet instead of taking a seventh slot.
 */
export type Overlay = 'search' | 'plane-index' | 'settings' | 'help' | 'filters' | 'about' | null

export type ToastTone = 'info' | 'error'

export interface Toast {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
  /** `null` never auto-dismisses; PRD 7.4.1's data failures stay until acknowledged. */
  readonly timeoutMs: number | null
}

/**
 * PRD 8.5.11's degradation ladder, as a store slot. Phase 4 owns the slot and the settings
 * surface; Phase 2a's frame-time monitor owns the transitions and Phase 3 reads `thumbnails`.
 */
export type QualityTier = 0 | 1 | 2 | 3

export interface DataState {
  readonly manifest: Manifest | null
  readonly planes: PlanesFile | null
  readonly planeBySlug: ReadonlyMap<string, PlaneRecord>
  readonly planeByIndex: readonly PlaneRecord[]
  readonly stars: Stars | null
  /** PRD 6.8.1: the streaming draw range, so the shell can show progress without a spinner. */
  readonly starsDrawable: number
  readonly searchFile: SearchFile | null
  readonly searchIndex: SearchIndex | null
  readonly sets: SetsSidecar | null
  readonly setByCode: ReadonlyMap<string, SearchSetRecord>
  readonly setById: ReadonlyMap<number, SearchSetRecord>
}

export interface AppState extends DataState {
  // --- transient view state (PRD 8.4.2) ---
  /** Star or plane id under the pointer, written by the scene's picking layer (PRD 8.5.6). */
  readonly hoverId: number | null
  /** PRD 6.2.1: the active printing is view state, changes no route and pushes no history. */
  readonly activePrinting: number
  readonly panelOpen: boolean
  readonly overlay: Overlay
  readonly attract: boolean
  readonly hintVisible: boolean
  readonly qualityTier: QualityTier
  readonly toasts: readonly Toast[]
  readonly settings: Settings
  readonly osReducedMotion: boolean
  /** The current filter evaluation, recomputed by `useFilterEvaluation` when the URL changes. */
  readonly filterEvaluation: FilterEvaluation | null

  // --- actions ---
  setHoverId: (id: number | null) => void
  setActivePrinting: (index: number) => void
  setPanelOpen: (open: boolean) => void
  setOverlay: (overlay: Overlay) => void
  setAttract: (attract: boolean) => void
  setHintVisible: (visible: boolean) => void
  setQualityTier: (tier: QualityTier) => void
  setFilterEvaluation: (evaluation: FilterEvaluation | null) => void
  patchData: (patch: Partial<DataState>) => void
  updateSettings: (patch: Partial<Settings>) => void
  setOsReducedMotion: (value: boolean) => void
  pushToast: (message: string, tone?: ToastTone, timeoutMs?: number | null) => number
  dismissToast: (id: number) => void
}

let nextToastId = 1

export const useStore = create<AppState>((set, get) => ({
  manifest: null,
  planes: null,
  planeBySlug: new Map(),
  planeByIndex: [],
  stars: null,
  starsDrawable: 0,
  searchFile: null,
  searchIndex: null,
  sets: null,
  setByCode: new Map(),
  setById: new Map(),

  hoverId: null,
  activePrinting: 0,
  panelOpen: true,
  overlay: null,
  attract: false,
  hintVisible: false,
  qualityTier: 0,
  toasts: [],
  settings: DEFAULT_SETTINGS,
  osReducedMotion: false,
  filterEvaluation: null,

  setHoverId: (hoverId) => {
    // Hover fires on every pointer move the picking layer resolves; bail before Zustand notifies
    // so an unchanged id never re-renders the HUD (PRD 7.3.3's no-layout-per-frame rule).
    if (get().hoverId !== hoverId) set({ hoverId })
  },
  setActivePrinting: (activePrinting) => set({ activePrinting }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setOverlay: (overlay) => set({ overlay }),
  setAttract: (attract) => set({ attract }),
  setHintVisible: (hintVisible) => set({ hintVisible }),
  setQualityTier: (qualityTier) => set({ qualityTier }),
  setFilterEvaluation: (filterEvaluation) => set({ filterEvaluation }),
  patchData: (patch) => set(patch),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    saveSettings(settings)
  },
  setOsReducedMotion: (osReducedMotion) => set({ osReducedMotion }),

  pushToast: (message, tone = 'info', timeoutMs = 6000) => {
    const id = nextToastId++
    // PRD 7.4.1 reports a failed chunk "once": an identical message already on screen is the same
    // report, not a second one, so it is dropped rather than stacked.
    const existing = get().toasts.find((toast) => toast.message === message)
    if (existing) return existing.id
    set({ toasts: [...get().toasts, { id, message, tone, timeoutMs }] })
    return id
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}))

/** Read the persisted settings once, before React mounts, so the first frame is already correct. */
export function initSettings(): void {
  const settings = loadSettings()
  useStore.setState({ settings, osReducedMotion: osPrefersReducedMotion() })
}

export function reducedMotionOf(state: Pick<AppState, 'settings' | 'osReducedMotion'>): boolean {
  return resolveReducedMotion(state.settings.reducedMotion, state.osReducedMotion)
}
