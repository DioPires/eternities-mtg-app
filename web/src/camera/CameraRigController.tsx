/**
 * The rig, wired to R3F and to the pointer (PRD 6.1.1, 5.7.3, 8.4.5).
 *
 * Three jobs, and nothing else:
 *
 * 1. Advance the rig on the renderer's own clock, so the camera shares the frame's `delta` with
 *    everything else that moves (PRD 5.3.17).
 * 2. Copy the rig's position and look-at onto the three.js camera. The rig owns the numbers; the
 *    camera object is an output.
 * 3. Turn pointer and wheel events into orbit, zoom and — the load-bearing one — `handOver`
 *    (PRD 5.7.3: "any input cancels the fly-to and hands over control at the current camera state
 *    without a jump").
 *
 * A drag is distinguished from a click by movement, not by timing: a click that sets focus
 * (PRD 6.1.2) must not be read as a one-pixel orbit that cancels the fly-to it just started.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type ReactElement } from 'react'

import type { NavigationApi } from '../navigation/types'

import type { CameraRig } from './rig'

/** Radians of orbit per pixel of drag. */
const ORBIT_PER_PX = 0.0055
/** Zoom factor per wheel notch. */
const ZOOM_PER_NOTCH = 0.0016
/** A pointer that has not moved this far is a click, not a drag. */
const DRAG_THRESHOLD_PX = 3

export interface CameraRigControllerProps {
  readonly rig: CameraRig
  readonly nav: NavigationApi
  /** Advance the rig here; pass `false` when something else already drives it. */
  readonly drive?: boolean
  /** Called for a pointer press that turned out to be a click, in CSS pixels. */
  readonly onClick?: (x: number, y: number) => void
}

export function CameraRigController({
  rig,
  nav,
  drive = true,
  onClick,
}: CameraRigControllerProps): ReactElement | null {
  const camera = useThree((state) => state.camera)
  const domElement = useThree((state) => state.gl.domElement)
  const dragging = useRef(false)
  const moved = useRef(0)
  const last = useRef({ x: 0, y: 0, t: 0 })
  const rate = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      dragging.current = true
      moved.current = 0
      last.current = { x: event.clientX, y: event.clientY, t: event.timeStamp }
      rate.current = { x: 0, y: 0 }
      domElement.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging.current) return
      const dx = event.clientX - last.current.x
      const dy = event.clientY - last.current.y
      const dt = Math.max((event.timeStamp - last.current.t) / 1000, 1 / 240)
      last.current = { x: event.clientX, y: event.clientY, t: event.timeStamp }
      moved.current += Math.abs(dx) + Math.abs(dy)
      if (moved.current < DRAG_THRESHOLD_PX) return

      // The first real movement is what takes the camera back — not the press, which may yet turn
      // out to be the click that started a fly-to (PRD 6.1.2).
      nav.handOver('pointer')
      const ax = -dx * ORBIT_PER_PX
      const ay = -dy * ORBIT_PER_PX
      // The instantaneous drag speed becomes the coast when the pointer is released.
      rate.current = { x: ax / dt, y: ay / dt }
      rig.orbitBy(ax, ay, rate.current.x, rate.current.y)
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (!dragging.current) return
      dragging.current = false
      if (domElement.hasPointerCapture(event.pointerId)) {
        domElement.releasePointerCapture(event.pointerId)
      }
      if (moved.current < DRAG_THRESHOLD_PX) {
        const rect = domElement.getBoundingClientRect()
        onClick?.(event.clientX - rect.left, event.clientY - rect.top)
      }
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      nav.handOver('wheel')
      rig.zoomBy(Math.exp(event.deltaY * ZOOM_PER_NOTCH))
    }

    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('pointermove', onPointerMove)
    domElement.addEventListener('pointerup', onPointerUp)
    domElement.addEventListener('pointercancel', onPointerUp)
    domElement.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      domElement.removeEventListener('pointerup', onPointerUp)
      domElement.removeEventListener('pointercancel', onPointerUp)
      domElement.removeEventListener('wheel', onWheel)
    }
  }, [domElement, nav, rig, onClick])

  useFrame((_, delta) => {
    // PRD 7.3.2: no allocation per frame. `rig.position` and `rig.lookAt` are the rig's own
    // long-lived vectors, and `Object3D.position.set` copies numbers rather than objects.
    if (drive) rig.update(delta)
    camera.position.set(rig.position.x, rig.position.y, rig.position.z)
    camera.lookAt(rig.lookAt.x, rig.lookAt.y, rig.lookAt.z)
    camera.updateMatrixWorld()
  })

  return null
}
