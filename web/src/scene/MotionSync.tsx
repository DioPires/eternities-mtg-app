/**
 * The one place the scene's two clocks are reconciled (PRD 5.6.6, 8.4.5).
 *
 * Mounted between the star field and the camera rig so R3F runs it in exactly that order. Per
 * frame: the table has already advanced (`StarScene`), so its time, its multiverse angle and its
 * per-plane spin angles are copied into the rig's motion mirror; and the eased spin scale, which
 * the rig owns because it knows what is focused, is pushed back into the table so the shader stops
 * the same plane the tether does. See `camera/motion.ts`.
 */

import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'

import type { SceneMotion } from '../camera/motion'

import type { PlaneTable } from './starfield/planeTable'

export function MotionSync({
  table,
  motion,
}: {
  readonly table: PlaneTable
  readonly motion: SceneMotion
}): null {
  useEffect(() => {
    motion.setExternalClock(true)
    return () => {
      motion.setExternalClock(false)
    }
  }, [motion])

  useFrame(() => {
    motion.syncClock(table.time, table.multiverseAngle)
    for (let row = 0; row < table.planes.length; row += 1) {
      const state = table.planes[row]!
      motion.syncSpin(row, state.spinAngle)
      table.setSpinScale(row, motion.spinScaleOf(row))
    }
  })
  return null
}
