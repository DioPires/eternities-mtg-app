/**
 * The app: Phase 4's shell, and the scenes it routes around.
 *
 * The default route is the shell of PRD 8.4.3-4 — one R3F canvas and one HTML overlay. Everything
 * it does is composition; the behaviour lives in `./app/boot` (the cold start), `./app/hooks` (the
 * URL, the store and the keyboard) and `./ui/*` (the surfaces).
 *
 * Phase 3 did half of the integration this file used to anticipate. `scene/EternitiesScene` is now
 * one scene — the star field, the camera rig, the labels, the thumbnails, the focused card and its
 * planets, in one canvas with one camera and one picker — so Phase 2b's harness, its projection
 * picker and `harness/PlaneProxies` are gone, and `?harness=3` reaches what `?harness=2b` used to.
 *
 * The half still outstanding is mounting that scene *inside* the shell. The shell reaches the scene
 * only through the navigation contract, and `createNavigation()` in `./app/services` still returns
 * the Phase 0 stub; the folded scene builds its own navigation from the dataset once that dataset
 * has loaded, on a lifetime the shell's services — created once, outside React, in `main.tsx` — do
 * not have. Bridging the two is a design job rather than a re-parenting, and doing it inside this
 * merge would silently re-point every PRD section 6 assertion (search, random, back/forward) at
 * behaviour no review has seen. So the shell's canvas is still Phase 0's hello-scene, and the join
 * is Phase 6's, alongside PRD 9.1.2's real `/bench` route.
 *
 * Until then every scene stays reachable, so every phase's exit criteria stay checkable exactly as
 * they were reviewed:
 *
 *   - `?bench`, `?hold` and `?selfcheck` — the three flags `bench.mjs` and `verify-browser.mjs`
 *     drive the star field with — get Phase 2a's harness, and `?harness=2a` gets it by hand;
 *   - `?harness=3` gets Phase 3's scene, and `?probe=1` gets it too: the seam that flag opens
 *     (`scene/probe.ts`) is that scene's, and it is what `verify-browser.mjs` drives the card tier
 *     through;
 *   - everything else gets the shell.
 *
 * These flags bypass the shell entirely rather than rendering inside it. Each owns its own canvas,
 * its own camera and — in Phase 3's case — its own navigation instance, so nesting one inside the
 * shell would put two navigation implementations on screen at once: the HUD reading the stub while
 * the camera obeyed the rig. That is precisely the join described above.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, type ReactElement } from 'react'

import { boot } from './app/boot'
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
import { EternitiesScene } from './scene/EternitiesScene'
import { HelloScene, SKY_COLOUR } from './scene/HelloScene'
import { probeRequested } from './scene/probe'
import { selfCheckRequested } from './scene/selfCheck'
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

  // PRD 8.7's loading order, PRD 6.8.2's intro and PRD 6.7.1's deep-link resolution.
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
    <div className="app">
      <Canvas
        camera={{ position: [0, 40, 140], fov: 55, near: 0.1, far: 4000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: SKY_COLOUR }}
        onPointerDown={() => {
          // PRD 5.7.3 / 6.1: touching the camera hands control back from any tween in flight.
          // Phase 2b's rig owns orbit and zoom themselves (navigation contract §6); this is the
          // one thing the UI is responsible for.
          nav.handOver('pointer')
        }}
        onWheel={() => {
          nav.handOver('wheel')
        }}
      >
        <HelloScene />
      </Canvas>

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
