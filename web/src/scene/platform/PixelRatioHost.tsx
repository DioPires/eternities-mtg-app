/**
 * The quality ladder's first rung, applied by the renderer (DEC-739, review §3.5).
 *
 * > Cap = `min(tier.cap, devicePixelRatio)`, applied by the renderer, not by a prop.
 *
 * **What was wrong with the prop, twice over.** Review finding R2: `<Canvas dpr={cap}>` is re-read
 * by react-three-fiber on *every* render (`events-776716bd.esm.js:2013` — `if (dpr &&
 * state.viewport.dpr !== calculateDpr(dpr)) state.setDpr(dpr)`), so under the free ladder the prop
 * and the monitor were two writers of one number and the prop won twice a second. DEC-692 closed
 * that by making the prop a *range*, `dpr={[0.5, cap]}`, which R3F clamps `devicePixelRatio` into —
 * so re-applying it became idempotent and the rung landed.
 *
 * That fix is correct and it is not the end state, for a reason the range spelling hides: the value
 * is still computed by React, from a prop, on a render. Everything this module is for —
 * `device-pixel-content-box`, the re-armed `matchMedia`, a monitor change that fires no render —
 * happens outside React entirely, and a number that only updates when a component re-renders cannot
 * see any of it. So the prop is switched off (`dpr={0}`, which makes R3F's `if (dpr && ...)` guard
 * false and its writer dead code) and the cap is pushed in from here instead.
 *
 * `setDpr` is R3F's own path to `gl.setPixelRatio` — its store subscription applies the value and
 * re-runs `gl.setSize` — so "the renderer applies it" is literal: this component computes a number
 * and hands it over, and no React render is in the loop. Wave 3 deletes the component and keeps
 * `./backingStore`, which is where the actual mechanism lives.
 *
 * **The first write has to happen in `onCreated`, not here.** With `dpr={0}` the store's initial
 * `viewport.dpr` is 0, and R3F's resize subscription would run `gl.setPixelRatio(0)` before any
 * child of the `<Canvas>` has mounted — a zero-sized drawing buffer for a frame. `SceneView`'s
 * `onCreated` therefore calls `setDpr` once with the starting cap, which happens after `configure`
 * and before the first `requestAnimationFrame`. This component owns every write after that one.
 */

import { useThree } from '@react-three/fiber'
import { useEffect, useRef, type MutableRefObject } from 'react'

import {
  observeBackingStore,
  observeDevicePixelRatio,
  resolvePixelRatio,
  type BackingStoreSize,
} from './backingStore'

export interface PixelRatioHostProps {
  /** The live tier's `pixelRatioCap` (PRD 8.5.11's first rung). */
  readonly tierCap: number
  /**
   * Where to publish the last backing-store observation, for the `?probe=1` seam and the bench.
   *
   * A ref because it changes with the window and nothing renders on it — putting it in state would
   * re-render the component that owns the `<Canvas>` on every drag of a window edge, which is
   * review finding R1 in a new costume.
   */
  readonly sizeRef?: MutableRefObject<BackingStoreSize | null>
}

export function PixelRatioHost({ tierCap, sizeRef }: PixelRatioHostProps): null {
  const gl = useThree((state) => state.gl)
  const setDpr = useThree((state) => state.setDpr)

  // The cap in a ref, so the two DOM observers below can read the current one without
  // being torn down and rebuilt on every tier change. A `ResizeObserver` rebuilt on a tier change
  // would fire a spurious initial observation, and a re-armed `matchMedia` rebuilt mid-move would
  // drop the notification it was armed for.
  const capRef = useRef(tierCap)
  capRef.current = tierCap

  /**
   * `min(tier cap, devicePixelRatio)`, pushed into the renderer.
   *
   * **The ratio comes from `devicePixelRatio`, not from the observed device-pixel box**, and the
   * distinction matters enough to be worth stating. `device-pixel-content-box` answers *how many
   * device pixels the content box is* — it is a **size** signal, and Wave 3's owned renderer will
   * use it to set `canvas.width`/`canvas.height` exactly rather than through a rounded multiply.
   * It is not a second, better `devicePixelRatio`, and treating it as one is wrong in a way that
   * only shows up off a developer's own display:
   *
   * > Measured while writing `e2e/quality.spec.ts`: under Chromium's device emulation — which is
   * > what Playwright's `deviceScaleFactor` uses, and what every CI run of this app is — the canvas
   * > reports a `devicePixelContentBoxSize` equal to its **CSS** box while `window.devicePixelRatio`
   * > reports 2. Deriving the cap from that box resolved every tier to 1.0, silently halving the
   * > resolution and making the ladder's first rung unobservable. The first draft of this file did
   * > exactly that and the e2e caught it.
   *
   * So: `devicePixelRatio` decides the ratio, which is what review §3.5 specifies to the letter
   * ("Cap = `min(tier.cap, devicePixelRatio)`"), and the observer below decides *when to re-ask* and
   * publishes the box for the probe and the bench.
   */
  const apply = useRef<() => void>(() => {})
  apply.current = () => {
    const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio
    const resolved = resolvePixelRatio(capRef.current, device)
    // `setDpr` is idempotent at the store level — R3F's subscription only re-applies when the
    // value actually moves — so calling it on every observation costs nothing when nothing changed.
    setDpr(resolved)
  }

  // The tier moved: re-resolve immediately. This is the rung landing.
  useEffect(() => {
    apply.current()
  }, [tierCap, setDpr])

  // The backing store moved — a resize, a zoom, a monitor with a different scale. Publishes the
  // exact device-pixel box and re-resolves the cap, because a resize and a ratio change arrive
  // together often enough that treating them separately would leave one frame at the old ratio.
  useEffect(() => {
    const canvas = gl.domElement
    return observeBackingStore(canvas, (size) => {
      if (sizeRef) sizeRef.current = size
      apply.current()
    })
  }, [gl, sizeRef])

  // The window moved to a monitor with a different `devicePixelRatio`, which fires no `resize` and
  // no `ResizeObserver` callback when the CSS box is unchanged — so this is the *only* notification
  // of the case, and it is the case the observer above cannot see. See `observeDevicePixelRatio`.
  useEffect(() => observeDevicePixelRatio(() => apply.current()), [])

  return null
}
