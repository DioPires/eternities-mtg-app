/**
 * The app: Phase 4's shell, and nothing else.
 *
 * The default route is the shell of PRD 8.4.3-4 — one canvas and one HTML overlay — and since
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
 * **The measurement routes are not here any more** (review §3.6 phase 3, item 4). The bench, the
 * GPU self-check and the `?probe=1` scene were `lazy()` branches of `App`, which kept them out of
 * the product's first chunk but not out of the product's build — `App` named the modules, so rollup
 * emitted them from the product entry. They now have a Vite entry of their own, `harness.html` ->
 * `harness/main.tsx`, and this file no longer knows they exist. `main.tsx` redirects their URLs
 * there before React starts; `app/harnessRoute.ts` is the whole of what the product still holds.
 *
 * One measurement route deliberately stays: **`?probe=shell`**, which keeps this shell and lets
 * `SceneView` install the `scene/probe.ts` seam inside it. PRD 9.3's visual review is of the
 * shipped composition, and since Phase 6 the scene on its own is no longer that
 * (`scripts/visual-gate.mjs`). It is not a harness — it is the product, watched.
 *
 * The manual `?harness=2a` / `?harness=3` spellings are gone with Phase 2a's harness (review §6.1
 * group B).
 */

import { useEffect, type ReactElement } from 'react'

import { boot } from './app/boot'
import { useMirrorSceneData, useSceneErrorToasts } from './app/dataset'
import { useFilterMask } from './app/filterMask'
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
import { SceneView } from './scene/EternitiesScene'
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

export function App(): ReactElement {
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
  // ...and PRD 5.8's other half: that mask, uploaded to the star geometry. Producer above,
  // consumer here, both in the one component the PRD's "exactly once" applies to. The two used to
  // exist without each other, which is how the dimming came to be computed and never shown.
  useFilterMask(data.resources?.geometry ?? null)

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
