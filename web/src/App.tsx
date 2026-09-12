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
 * Three measurement routes stay reachable, and **none of their code is in the product's chunk**:
 * each is a `lazy()` boundary and the URL tests below are inlined, so deciding to render the shell
 * imports nothing heavy (review §5.4 B1, §6.3).
 *
 *   - `/bench`, and the `?bench` / `?hold` spellings `scripts/bench.mjs` uses, get PRD 9.1.2's
 *     bench route — which since Phase 6 flies the *shipped* scene, so the numbers are the
 *     product's;
 *   - `?selfcheck` gets `harness/SelfCheckScene`, because the GPU self-check holds the field still
 *     and reads pixels back, which it cannot do while anything is flying the camera;
 *   - `?probe=1` gets the scene on its own with the `scene/probe.ts` seam installed, which is what
 *     `verify-browser.mjs` drives the card tier through;
 *   - everything else gets the shell — including `?probe=shell`, which installs that same seam
 *     *here*, because PRD 9.3's visual review is of the shipped composition and since Phase 6 the
 *     scene on its own is no longer that (`scripts/visual-gate.mjs`).
 *
 * The manual `?harness=2a` / `?harness=3` spellings are gone with Phase 2a's harness (review §6.1
 * group B). The routes above are the supported way in.
 *
 * These all bypass the shell rather than rendering inside it. Each owns its own camera, and the
 * bench and the self-check drive that camera themselves, which they cannot do in a scene where the
 * rig is flying it.
 */

import { Suspense, lazy, useEffect, type ReactElement } from 'react'

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
import { EternitiesScene, SceneView } from './scene/EternitiesScene'
import { probeTarget } from './scene/probe'
import { selfCheckRequested } from './scene/selfCheck.url'
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
 * The three measurement routes, behind `lazy()` so none of their code is in the product's chunk.
 *
 * `EternitiesScene` is not one of them: the shell renders `SceneView` from the same module, so
 * splitting it would only move the shipped scene out of the shipped chunk.
 */
const BenchScene = lazy(async () => ({ default: (await import('./bench/BenchScene')).BenchScene }))
const SelfCheckScene = lazy(async () => ({
  default: (await import('./harness/SelfCheckScene')).SelfCheckScene,
}))

/**
 * Which URL asks for the bench.
 *
 * Inlined rather than imported from `bench/BenchScene`, and that is the point: importing the test
 * imports the module that answers it, so every visitor downloaded the bench runner to be told they
 * were not benching (review §6.3). `test/bench.test.ts` pins this against `benchRouteRequested`,
 * which stays exported there as the module's own answer to the same question.
 *
 * Both spellings: `/bench` is PRD 9.1.2's and what a person types; `?bench` and `?hold=<segment>`
 * are what `scripts/bench.mjs` drives and what the committed baseline was recorded through.
 */
export function benchRouteWanted(pathname: string, search: string): boolean {
  if (pathname === '/bench' || pathname === '/bench/') return true
  const params = new URLSearchParams(search)
  const bench = params.get('bench')
  if (bench !== null && bench !== '0') return true
  return params.get('hold') !== null
}

/**
 * Which scene the URL asks for, if any.
 *
 * Every test here is a `URLSearchParams` read against a string. Nothing on this path imports a
 * scene — that is what makes the `lazy()` boundaries above worth having.
 */
function sceneRequested(): 'bench' | 'selfcheck' | 'probe' | null {
  const search = typeof location === 'undefined' ? '' : location.search
  const pathname = typeof location === 'undefined' ? '' : location.pathname
  // PRD 9.1.2's route, intercepted before `parseRoute` can call `/bench` an unknown route.
  if (benchRouteWanted(pathname, search)) return 'bench'
  // The GPU self-check needs a still field over a fixed camera: it reads pixels back, which it
  // cannot do in a scene where a rig or a bench is flying the camera.
  if (selfCheckRequested(search)) return 'selfcheck'
  // `?probe=1` is the scene on its own; `?probe=shell` keeps the shell and lets `SceneView` install
  // the same seam inside it, which is how `scripts/visual-gate.mjs` captures PRD 9.3 against the
  // shipped composition rather than against the scene alone. See `scene/probe.ts`.
  const probe = probeTarget(search)
  return probe === 'scene' ? 'probe' : null
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

export function App(): ReactElement {
  switch (sceneRequested()) {
    case 'bench':
      return (
        <Suspense fallback={null}>
          <BenchScene />
        </Suspense>
      )
    case 'selfcheck':
      return (
        <Suspense fallback={null}>
          <SelfCheckScene />
        </Suspense>
      )
    case 'probe':
      return <EternitiesScene />
    case null:
      return <AppShell />
  }
}
