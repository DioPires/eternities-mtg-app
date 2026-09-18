/**
 * The frame's shared machinery: the sky, the plane table's clock, the focused star's CPU mirror
 * and the adaptive quality monitor (PRD 5.3, 8.5.3, 8.5.7, 8.5.11).
 *
 * > **The half of the old `starScene.ts` that outlives the galaxy (DEC-752).** After DEC-852 moved
 * > the picker and the star data out, `starScene.ts` still held four things the worlds build runs
 * > on, none of them the galaxy's to take with it:
 * >
 * > - **the plane table's clock.** `table.advance` is what turns `multiverseAngle` and every
 * >   plane's spin angle — so it is what makes the worlds rotate at all, and what W5's azimuth sweep
 * >   reads back. Deleting it would have frozen the multiverse with a green build.
 * > - **the quality monitor.** The adaptive ladder's driver, the `?quality=N` pin and the starting
 * >   announcement `SceneHost.applyTier` runs on. Without it every rung of PRD 8.5.11 and §1.12 is
 * >   unreachable, on a build that still renders.
 * > - **PRD 8.5.7's focused-star mirror**, which the camera rig tethers to on card focus.
 * > - **the sky and the background shells.**
 * >
 * > So the module was split, the precedent being board ruling `split_cardtier`: this file is the
 * > surviving half, and `starScene.ts` keeps only the star field, which §3.2 deletes.
 */

import { Color, Vector3, type Scene, type WebGLRenderer } from 'three'

import { advanceBackground, createBackground } from './background'
import type { ScenePickingHandle } from './input/attachScenePicking'
import { detectPlatformCapabilities } from './platform/capabilities'
import {
  QualityMonitor,
  pinnedQualityTier,
  qualityOptionsFor,
  type QualityTier,
} from './quality/adaptiveQuality'
import type { FrameLoop } from './renderer/frameLoop'
import { starWorldPosition } from './starfield/motion'
import { SKY_COLOUR } from './tuning'
import type { SceneResources } from './useSceneData'

export interface SceneFrameHandle {
  /**
   * PRD 8.5.7's CPU motion mirror. The focused star's world position, right now, computed with the
   * same formula the vertex shader used to draw it. The camera rig tethers to this.
   *
   * Returns `false` when nothing is focused, in which case `out` is untouched.
   */
  focusedStarPosition: (out: Vector3) => boolean
  /** Any star's live world position. The mirror is cheap; PRD 8.5.7 only limits *who* calls it. */
  starPosition: (index: number, out: Vector3) => boolean
  readonly focusedIndex: number
  /**
   * The frame-interval band the quality monitor is judging against, for the `?probe=1` seam and the
   * bench (DEC-692 R5). Derived from the display's refresh period, not from a constant, so it is
   * worth reporting: the same p90 means different things on a 60 Hz and a 120 Hz panel.
   */
  readonly qualityThresholds: {
    readonly refreshMs: number
    readonly degradeMs: number
    readonly restoreMs: number
  }
  /**
   * The motion factor the clock is actually advancing with: 1, or 0 under PRD 5.9. Read off the
   * live value rather than recomputed, so `?probe=` reports what the frame did (DEC-752).
   */
  readonly motionScale: number
  /** `planes.json` and `stars.bin` have landed; the clock and the mirror have a table to read. */
  setResources: (resources: SceneResources | null) => void
  /** PRD 5.9. `true` stops the multiverse rotation and every plane's spin. */
  setReducedMotion: (reduced: boolean) => void
  /**
   * Send `onQualityChange` the tier the monitor is starting on.
   *
   * **Separate from construction on purpose.** Fired from inside the attach, the caller's handler
   * ran before the handle had been assigned, so `SceneHost.applyTier` reached an `undefined` handle
   * and threw on the first frame of every page load — caught only by `e2e/a11y.spec.ts`'s
   * page-error assertion. The caller assigns the handle, then calls this.
   */
  announceStartingTier: () => void
  dispose: () => void
}

export interface SceneFrameOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly loop: FrameLoop
  readonly picking: ScenePickingHandle
  readonly onQualityChange?: (tier: QualityTier, index: number) => void
}

export function attachSceneFrame({
  gl,
  scene,
  loop,
  picking,
  onQualityChange,
}: SceneFrameOptions): SceneFrameHandle {
  const background = createBackground()
  /**
   * The tier monitor, floored by what the post chain can actually render (DEC-703, review §3.7).
   *
   * The floor comes off the GL context: without `EXT_color_buffer_float` the bloom source is
   * quantised to eight bits and the top two rungs stop meaning what they say, so the ladder starts
   * two rungs down instead. A `?quality=` pin still wins, because a pin has to be able to name any
   * tier.
   */
  const capabilities = detectPlatformCapabilities(gl)
  const quality = new QualityMonitor(
    qualityOptionsFor(pinnedQualityTier(), capabilities.minTierIndex),
  )
  // Per-tick scratch. Allocated once, reused for the life of the scene (PRD 7.3.2).
  const mirror = new Vector3()

  let resources: SceneResources | null = null
  let reducedMotion = false
  let disposed = false

  // PRD 5.3: the sky.
  scene.background = new Color(SKY_COLOUR)
  scene.add(background.group)

  function readStarPosition(index: number, out: Vector3): boolean {
    if (!resources || index < 0 || index >= resources.geometry.drawCount) return false
    const { table, geometry } = resources
    geometry.localPosition(index, out)
    starWorldPosition(
      table.raw,
      geometry.planeRowOf(index),
      out.x,
      out.y,
      out.z,
      table.time,
      table.multiverseAngle,
      reducedMotion ? 0 : 1,
      out,
    )
    return true
  }

  const unsubscribes = [
    loop.subscribe('planeTable', ({ delta }) => {
      if (resources) {
        resources.table.advance(delta, reducedMotion ? 0 : 1)
        advanceBackground(background.group, resources.table.multiverseAngle)
      } else {
        advanceBackground(background.group, 0)
      }
    }),

    // Subscribed after `input/attachScenePicking.ts`, which `SceneHost` attaches first, so the
    // mirror runs after the frame's pick has been issued (DEC-852).
    loop.subscribe('pick', () => {
      if (!resources) return
      // PRD 8.5.7: the one star position the CPU computes, refreshed while it is focused so the
      // camera rig always has a current target.
      const focused = picking.focusedIndex
      if (focused >= 0) readStarPosition(focused, mirror)
    }),

    loop.subscribe('quality', ({ delta }) => {
      quality.sample(delta * 1000)
    }),
  ]

  /**
   * The monitor announces its own starting tier (DEC-703): a pin layered over a GPU capability floor
   * that only the renderer knows, so the monitor is the one authority for it.
   */
  const unsubscribeQuality = quality.subscribe((tier, index) => onQualityChange?.(tier, index))

  return {
    focusedStarPosition: (out) => readStarPosition(picking.focusedIndex, out),
    starPosition: (index, out) => readStarPosition(index, out),
    get focusedIndex() {
      return picking.focusedIndex
    },
    get qualityThresholds() {
      const band = quality.thresholdsMs
      return {
        refreshMs: quality.refreshIntervalMs,
        degradeMs: band.degrade,
        restoreMs: band.restore,
      }
    },

    get motionScale() {
      return reducedMotion ? 0 : 1
    },
    setResources: (next) => {
      resources = next
    },
    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },
    announceStartingTier: () => {
      onQualityChange?.(quality.tier, quality.index)
    },

    dispose: () => {
      if (disposed) return
      disposed = true
      for (const undo of unsubscribes) undo()
      unsubscribeQuality()
      scene.remove(background.group)
      background.dispose()
    },
  }
}
