/**
 * The rig, wired to the canvas and to the pointer (PRD 6.1.1, 5.7.3, 8.4.5).
 *
 * Three jobs, and nothing else:
 *
 * 1. Advance the rig on the loop's own clock, so the camera shares the tick's `delta` with
 *    everything else that moves (PRD 5.3.17).
 * 2. Copy the rig's position and look-at onto the three.js camera. The rig owns the numbers; the
 *    camera object is an output.
 * 3. Turn pointer and wheel events into orbit, zoom and — the load-bearing one — `handOver`
 *    (PRD 5.7.3: "any input cancels the fly-to and hands over control at the current camera state
 *    without a jump").
 *
 * A drag is distinguished from a click by movement, not by timing: a click that sets focus
 * (PRD 6.1.2) must not be read as a one-pixel orbit that cancels the fly-to it just started.
 *
 * **This was `CameraRigController.tsx`; review §3.6 phase 3 folds it into the renderer.** Nothing
 * about it was ever React — it rendered `null`, held every value in a ref, and used `useThree`
 * purely to reach the camera and the canvas that the loop now hands it directly. The one thing that
 * changes is the `rig` step's position in the frame: it was a `useFrame` subscriber whose place in
 * the order was its JSX position among four siblings, and it is now the `rig` phase of
 * {@link TICK_PHASES}, which runs after `motionSync` has filled the mirror it tethers through.
 */

import type { NavigationApi } from '../navigation/types'
import type { FrameLoop } from '../scene/renderer/frameLoop'

import type { CameraRig } from './rig'

/** Radians of orbit per pixel of drag. */
const ORBIT_PER_PX = 0.0055
/** Zoom factor per wheel notch. */
const ZOOM_PER_NOTCH = 0.0016
/** A pointer that has not moved this far is a click, not a drag. */
const DRAG_THRESHOLD_PX = 3

/** What the camera object needs to be for the rig to write onto it. No three import here. */
export interface RigCameraTarget {
  readonly position: { set: (x: number, y: number, z: number) => void }
  lookAt: (x: number, y: number, z: number) => void
  updateMatrixWorld: () => void
}

export interface AttachRigOptions {
  readonly rig: CameraRig
  readonly nav: NavigationApi
  readonly camera: RigCameraTarget
  readonly domElement: HTMLElement
  readonly loop: FrameLoop
  /** Advance the rig here; pass `false` when something else already drives it (the bench). */
  readonly drive?: boolean
  /** Called for a pointer press that turned out to be a click, in CSS pixels. */
  readonly onClick?: (x: number, y: number) => void
}

export function attachCameraRig({
  rig,
  nav,
  camera,
  domElement,
  loop,
  drive = true,
  onClick,
}: AttachRigOptions): () => void {
  let dragging = false
  let moved = 0
  const last = { x: 0, y: 0, t: 0 }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    dragging = true
    moved = 0
    last.x = event.clientX
    last.y = event.clientY
    last.t = event.timeStamp
    domElement.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return
    const dx = event.clientX - last.x
    const dy = event.clientY - last.y
    const dt = Math.max((event.timeStamp - last.t) / 1000, 1 / 240)
    last.x = event.clientX
    last.y = event.clientY
    last.t = event.timeStamp
    moved += Math.abs(dx) + Math.abs(dy)
    if (moved < DRAG_THRESHOLD_PX) return

    // The first real movement is what takes the camera back — not the press, which may yet turn
    // out to be the click that started a fly-to (PRD 6.1.2).
    nav.handOver('pointer')
    const ax = -dx * ORBIT_PER_PX
    const ay = -dy * ORBIT_PER_PX
    // The instantaneous drag speed becomes the coast when the pointer is released.
    rig.orbitBy(ax, ay, ax / dt, ay / dt)
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    if (domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId)
    }
    if (moved < DRAG_THRESHOLD_PX) {
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

  const unsubscribe = loop.subscribe('rig', ({ delta }) => {
    // PRD 7.3.2: no allocation per frame. `rig.position` and `rig.lookAt` are the rig's own
    // long-lived vectors, and `Object3D.position.set` copies numbers rather than objects.
    if (drive) rig.update(delta)
    camera.position.set(rig.position.x, rig.position.y, rig.position.z)
    camera.lookAt(rig.lookAt.x, rig.lookAt.y, rig.lookAt.z)
    // The camera's matrices are final at the end of this step, which is the contract the `labels`
    // phase depends on: `TICK_PHASES` runs `labels` after `rig`, so a label can no longer be placed
    // against a camera pose from the previous frame (PRD 5.3.8).
    camera.updateMatrixWorld()
  })

  return () => {
    unsubscribe()
    domElement.removeEventListener('pointerdown', onPointerDown)
    domElement.removeEventListener('pointermove', onPointerMove)
    domElement.removeEventListener('pointerup', onPointerUp)
    domElement.removeEventListener('pointercancel', onPointerUp)
    domElement.removeEventListener('wheel', onWheel)
  }
}
