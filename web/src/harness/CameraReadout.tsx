/**
 * A live readout of where the camera actually is.
 *
 * Harness-only, and it goes with the rest of the harness when Phase 4's HUD lands. It exists
 * because "the camera moved" is otherwise unobservable from outside: reading a WebGL canvas back
 * with `toDataURL` returns a stale or cleared drawing buffer unless the context was created with
 * `preserveDrawingBuffer`, which costs a full-frame copy every frame and is not something to turn
 * on in production to make a test easier. So the rig's own numbers are printed instead, and
 * `scripts/verify-browser.mjs` asserts on them.
 *
 * It writes `textContent` on one node from its own `requestAnimationFrame`, rather than through
 * React state: 60 re-renders a second is exactly what PRD 7.3.2 and 7.3.3 rule out.
 */

import { useEffect, useRef, type ReactElement } from 'react'

import type { CameraRig } from '../camera/rig'

export function CameraReadout({ rig }: { readonly rig: CameraRig }): ReactElement {
  const node = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let handle = requestAnimationFrame(function tick() {
      const element = node.current
      if (element) {
        const { x, y, z } = rig.position
        element.textContent =
          `${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)} · d ${rig.distanceToTether.toFixed(1)}`
      }
      handle = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(handle)
    }
  }, [rig])

  return (
    <li>
      camera: <span ref={node} data-testid="camera">…</span>
    </li>
  )
}
