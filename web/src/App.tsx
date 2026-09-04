/**
 * The app: Phase 4's shell, and the two phase harnesses it routes around.
 *
 * The default route is the shell of PRD 8.4.3-4 — one R3F canvas and one HTML overlay. Everything
 * it does is composition; the behaviour lives in `./app/boot` (the cold start), `./app/hooks` (the
 * URL, the store and the keyboard) and `./ui/*` (the surfaces).
 *
 * The scene inside the shell's canvas is still Phase 0's hello-scene. Phase 2a's star field and
 * Phase 2b's camera rig drop in here without the shell changing, because the shell only ever talks
 * to the scene through the navigation contract — `createNavigation()` in `./app/services` is the
 * single seam, and it still returns the Phase 0 stub. Swapping it for Phase 2b's real rig, and
 * folding Phase 2a's field into that same scene, is one job and it is Phase 3's (DEC-590).
 *
 * Until then the two phase harnesses are still two separate scenes, and both stay reachable so
 * both phases' exit criteria stay checkable exactly as they were reviewed:
 *
 *   - `?bench`, `?hold` and `?selfcheck` — the three flags `bench.mjs` and `verify-browser.mjs`
 *     drive the star field with — get Phase 2a's harness, and `?harness=2a` gets it by hand;
 *   - `?harness=2b` gets Phase 2b's harness: the navigation contract driving the real camera rig
 *     over the real roster;
 *   - everything else gets the shell.
 *
 * The harness flags bypass the shell entirely rather than rendering inside it. Each harness owns
 * its own canvas, its own camera and — in 2b's case — its own navigation instance, so nesting one
 * inside the shell would put two navigation implementations on screen at once: the HUD reading the
 * stub while the camera obeyed the rig. That is precisely the integration Phase 3 owns.
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
import { Phase2bScene } from './harness/Phase2bScene'
import { HelloScene, SKY_COLOUR } from './scene/HelloScene'
import { selfCheckRequested } from './scene/selfCheck'
import { useStore } from './store/store'
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
 * Which harness the URL asks for, if any. The bench and self-check flags imply 2a because that is
 * the scene they measure; `?harness=` names either one directly.
 */
function harnessRequested(): '2a' | '2b' | null {
  const search = typeof location === 'undefined' ? '' : location.search
  if (benchRequested(search) || benchHold(search) !== null || selfCheckRequested(search)) return '2a'
  const named = new URLSearchParams(search).get('harness')
  return named === '2a' || named === '2b' ? named : null
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
  switch (harnessRequested()) {
    case '2a':
      return <Phase2aScene />
    case '2b':
      return <Phase2bScene />
    case null:
      return <AppShell />
  }
}
