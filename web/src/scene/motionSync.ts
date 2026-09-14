/**
 * The one place the scene's two clocks are reconciled (PRD 5.6.6, 8.4.5).
 *
 * Per tick: the table has already advanced (the `planeTable` phase), so its time, its multiverse
 * angle and its per-plane spin angles are copied into the rig's motion mirror; and the eased spin
 * scale, which the rig owns because it knows what is focused, is pushed back into the table so the
 * shader stops the same plane the tether does. See `camera/motion.ts`.
 *
 * **This was `MotionSync.tsx`, and the file header used to say "mounted between the star field and
 * the camera rig so R3F runs it in exactly that order".** That sentence was the whole problem
 * review §3.5 names: the ordering constraint was real, load-bearing and enforced by nothing except
 * the order of two JSX siblings. It is now `TICK_PHASES` — `planeTable`, then `motionSync`, then
 * `rig` — and `test/frame-loop.test.ts` asserts the list.
 */

import type { SceneMotion } from '../camera/motion'

import type { FrameLoop } from './renderer/frameLoop'
import type { PlaneTable } from './starfield/planeTable'

/**
 * Subscribe the clock reconciliation to the `motionSync` phase. Returns its teardown.
 *
 * The `setExternalClock(true)` / `setExternalClock(false)` pair is the same lifetime the old mount
 * effect had: while this is attached, the rig's motion mirror takes its time from the table rather
 * than running a clock of its own.
 */
export function attachMotionSync(loop: FrameLoop, table: PlaneTable, motion: SceneMotion): () => void {
  motion.setExternalClock(true)
  const unsubscribe = loop.subscribe('motionSync', () => {
    motion.syncClock(table.time, table.multiverseAngle)
    for (let row = 0; row < table.planes.length; row += 1) {
      const state = table.planes[row]!
      motion.syncSpin(row, state.spinAngle)
      table.setSpinScale(row, motion.spinScaleOf(row))
    }
  })
  return () => {
    unsubscribe()
    motion.setExternalClock(false)
  }
}
