/**
 * The Phase 4 app shell: one R3F canvas and one HTML overlay (PRD 8.4.3-4).
 *
 * The scene inside the canvas is still Phase 0's hello-scene. Phase 2a's star field and Phase 2b's
 * camera rig drop in here without the shell changing, because the shell only ever talks to the
 * scene through the navigation contract — see `createNavigation()` in `./app/services`.
 *
 * Everything this component does is composition. The behaviour lives in `./app/boot` (the cold
 * start), `./app/hooks` (the URL, the store and the keyboard) and `./ui/*` (the surfaces).
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
import { HelloScene, SKY_COLOUR } from './scene/HelloScene'
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

export function App(): ReactElement {
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
