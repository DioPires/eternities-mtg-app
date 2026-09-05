/**
 * The app: Phase 4's shell, and the harnesses it routes around.
 *
 * The default route is the shell of PRD 8.4.3-4 — one R3F canvas and one HTML overlay — and since
 * Phase 6 the canvas in it is the real scene. Everything this file does is composition; the
 * behaviour lives in `./app/boot` (the cold start), `./app/hooks` (the URL, the store and the
 * keyboard), `./scene/EternitiesScene` (the scene) and `./ui/*` (the surfaces).
 *
 * **The join.** Phase 3 folded the star field, the camera rig, the labels, the thumbnails, the card
 * and its planets into one scene, and left it reachable only through `?harness=3` — the shell's
 * canvas was still Phase 0's hello-scene. Three things were in the way, and Phase 6 removed each:
 *
 *   - the shell's `NavigationApi` is built before React and the scene's is built when `planes.json`
 *     lands, so one object now spans both (`navigation/host.ts`);
 *   - the shell and the scene each ran PRD 8.7's loading order, so mounting one inside the other
 *     would have doubled every transfer including `stars.bin` (`app/dataset.ts`);
 *   - the scene owned a canvas, a keyboard map and a readout panel that the shell also owns
 *     (`SceneViewProps`).
 *
 * The harnesses stay reachable, so every earlier phase's exit criteria stay checkable exactly as
 * they were reviewed:
 *
 *   - `?bench`, `?hold` and `?selfcheck` — the three flags `bench.mjs` and `verify-browser.mjs`
 *     drive the star field with — get Phase 2a's harness, and `?harness=2a` gets it by hand;
 *   - `?harness=3` gets Phase 3's scene with its readout panel, and `?probe=1` gets it too: the
 *     seam that flag opens (`scene/probe.ts`) is that scene's, and it is what `verify-browser.mjs`
 *     drives the card tier through;
 *   - everything else gets the shell.
 *
 * These flags still bypass the shell rather than rendering inside it. Each owns its own camera, and
 * the bench and the self-check both drive that camera themselves, which they cannot do in a scene
 * where the rig is flying it.
 */

import { useEffect, type ReactElement } from 'react'

import { boot } from './app/boot'
import { useMirrorSceneData, useSceneErrorToasts } from './app/dataset'
import {
  useAttractMode,
  useFilterEvaluation,
  useKeyboardMap,
  usePanelAutoOpen,
  useReducedMotion,
  useResetActivePrintingOnFocus,
  useRouter,
  useNavigation,
} from './app/hooks'
import { benchHold, benchRequested } from './bench/BenchRunner'
import { Phase2aScene } from './harness/Phase2aScene'
import { EternitiesScene, SceneView } from './scene/EternitiesScene'
import { probeRequested } from './scene/probe'
import { selfCheckRequested } from './scene/selfCheck'
import { useSceneData } from './scene/useSceneData'
import { useStore } from './store/store'
import { AboutOverlay } from './ui/AboutOverlay'
import { Drawer } from './ui/Drawer'
import { FilterOverlay } from './ui/FilterOverlay'
import { FirstVisitHint } from './ui/FirstVisitHint'
import { HelpOverlay } from './ui/HelpOverlay'
import { Hud } from './ui/Hud'
import { PlaneIndexOverlay } from './ui/PlaneIndexOverlay'
import { SearchOverlay } from './ui/SearchOverlay'
import { SettingsOverlay } from './ui/SettingsOverlay'
import { Toasts } from './ui/Toasts'

/**
 * Which scene the URL asks for, if any. The bench and self-check flags imply 2a because that is the
 * scene they measure, and `?probe=1` implies 3 because the probe seam is that scene's; `?harness=`
 * names either one directly.
 */
function sceneRequested(): '2a' | '3' | null {
  const search = typeof location === 'undefined' ? '' : location.search
  if (benchRequested(search) || benchHold(search) !== null || selfCheckRequested(search)) return '2a'
  if (probeRequested(search)) return '3'
  const named = new URLSearchParams(search).get('harness')
  return named === '2a' || named === '3' ? named : null
}

function Overlays(): ReactElement | null {
  const overlay = useStore((state) => state.overlay)
  switch (overlay) {
    case 'search':
      return <SearchOverlay />
    case 'plane-index':
      return <PlaneIndexOverlay />
    case 'settings':
      return <SettingsOverlay />
    case 'help':
      return <HelpOverlay />
    case 'filters':
      return <FilterOverlay />
    case 'about':
      return <AboutOverlay />
    case null:
      return null
  }
}

function AppShell(): ReactElement {
  const nav = useNavigation()
  const router = useRouter()
  const hintVisible = useStore((state) => state.hintVisible)
  const overlay = useStore((state) => state.overlay)

  // The one loader on the page, hoisted here so the shell and the scene share it. `app/dataset.ts`
  // explains at length why there cannot be two.
  const data = useSceneData()
  useMirrorSceneData(data)
  // PRD 7.4.1: the scene's one-per-artefact failure event becomes the shell's toast.
  useSceneErrorToasts()

  // PRD 8.7's loading order, PRD 6.8.2's intro and PRD 6.7.1's deep-link resolution. Mounted after
  // the scene's own effects, because children commit first — so by the time this runs the transfer
  // is in flight and, on a warm cache, `planes.json` may already have attached the real rig.
  useEffect(() => boot(nav, router), [nav, router])

  const reducedMotion = useReducedMotion()
  // PRD 5.9: attract mode is disabled under reduced motion.
  useAttractMode(!reducedMotion)
  useKeyboardMap()
  usePanelAutoOpen()
  useResetActivePrintingOnFocus()
  // Publishes the dimming mask Phase 2a's shader reads, and the exact count PRD 6.3.2 shows. This
  // is the only call site — `FilterChips` and `Drawer` read the result from the store, so the
  // record is scanned once per filter change and the mask buffer is reused.
  useFilterEvaluation()

  return (
    <div
      className="app"
      onPointerDown={() => {
        // PRD 5.7.3 / 6.1: touching the camera hands control back from any tween in flight.
        // Phase 2b's rig owns orbit and zoom themselves (navigation contract §6); this is the
        // one thing the UI is responsible for.
        //
        // On the wrapper rather than on the `<Canvas>`, because `SceneView` owns the canvas now and
        // the shell has no handle on it. Pointer events from the HUD bubble through here too, which
        // is correct: clicking a breadcrumb is input, and PRD 5.3.23 exits attract on any input.
        nav.handOver('pointer')
      }}
      onWheel={() => {
        nav.handOver('wheel')
      }}
    >
      <SceneView data={data} reducedMotion={reducedMotion} host={nav} chrome={false} />

      <Hud />
      <Drawer />
      {/* PRD 6.8.3: the hint yields to anything the user deliberately opened. */}
      {hintVisible && overlay === null ? <FirstVisitHint /> : null}
      <Overlays />
      <Toasts />
    </div>
  )
}

export function App(): ReactElement {
  switch (sceneRequested()) {
    case '2a':
      return <Phase2aScene />
    case '3':
      return <EternitiesScene />
    case null:
      return <AppShell />
  }
}
