/**
 * The star field's share of the tick (PRD 5.3, 5.4, 8.5).
 *
 * Everything the *galaxy* does each frame happens here, from preallocated state: advance the plane
 * table, turn the background, push the uniforms, mirror the focused star, feed the frame-time
 * monitor. What changed in review §3.6 phase 3 is *where the order comes from*. This was one
 * `useFrame` callback whose steps ran in source order inside it, and whose position relative to the
 * camera rig, the card tier and the post chain was the position of a JSX element among its
 * siblings. The steps are now subscriptions to named phases of {@link TICK_PHASES}, and the order
 * between them and everything else is that list.
 *
 * What this file deliberately does *not* do is move the camera. PRD 5.7 and the navigation contract
 * are the rig's; the scene exposes what a camera rig needs — a pick result and the focused star's
 * live world position — and stops there.
 *
 * **The pointer is no longer here, and that is DEC-852.** This module used to own the `IdPicker`,
 * the four canvas listeners and the whole of PRD 8.5.6's pick — so the app's input layer, §1.10's
 * hover label and the selection card focus runs on all came out of the module worlds spec §3.2
 * names for deletion. They now live in `scene/input/attachScenePicking.ts`, which outlives the
 * galaxy; what is left here is the one galaxy-shaped part of picking, the star field's hover
 * highlight, handed over through `setStarHighlight` in {@link StarSceneHandle.setResources}.
 *
 * The one thing this file still reads off that attachment is its focused star index, because
 * PRD 8.5.7's CPU motion mirror is computed from the star buffer and the plane table and belongs
 * with them.
 */

import { Color, Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import { advanceBackground, createBackground } from './background'
import type { ScenePickingHandle } from './input/attachScenePicking'
import { isPerspective } from './picking/idPicker'
import { detectPlatformCapabilities } from './platform/capabilities'
import {
  QualityMonitor,
  pinnedQualityTier,
  qualityOptionsFor,
  type GlowQuality,
  type QualityTier,
} from './quality/adaptiveQuality'
import type { FrameLoop } from './renderer/frameLoop'
import { selfCheckLoader } from './selfCheck.register'
import { selfCheckRequested } from './selfCheck.url'
import { starWorldPosition } from './starfield/motion'
import { SKY_COLOUR } from './tuning'
import type { SceneResources } from './useSceneData'

export interface StarSceneHandle {
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
  /** The field's drawable star count, or 0 before `stars.bin` lands (PRD 8.7.3). */
  readonly drawnStars: number
  /** `planes.json` and `stars.bin` have landed; build the field's objects into the scene. */
  setResources: (resources: SceneResources | null) => void
  /** PRD 5.9. `true` stops rotation, drift, twinkle and dust turbulence. */
  setReducedMotion: (reduced: boolean) => void
  /** PRD 8.5.11's second rung, for the field's bloom-source sprite sizing (DEC-703). */
  setBloomScale: (scale: number) => void
  /** PRD 8.5.11's bottom rung: swap the glow's fragment program (DEC-739). */
  setGlowQuality: (quality: GlowQuality) => void
  /** Every record of `stars.bin` is drawable. Gates the GPU self-check; nothing else needs it. */
  setStarsComplete: (complete: boolean) => void
  /**
   * Send `onQualityChange` the tier the monitor is starting on.
   *
   * **Separate from construction on purpose, and it is not a style choice.** The starting
   * announcement used to fire synchronously from inside `attachStarScene`, which meant the
   * caller's handler ran *before* `attachStarScene` had returned — so `SceneHost.applyTier`, whose
   * job is to push the tier at the star field among others, reached a `starSceneHandle` that was
   * still `undefined` and threw on the first frame of every page load. Nothing in the unit suite
   * could see it: building a `SceneHost` needs a GL context, so the whole construction path is
   * e2e-only, and `e2e/a11y.spec.ts`'s page-error assertion is what caught it.
   *
   * The caller assigns the handle, then calls this. The monitor is still the one authority for the
   * starting tier — this only moves *when* it speaks, not who decides.
   */
  announceStartingTier: () => void
  dispose: () => void
}

export interface StarSceneOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  /**
   * The input layer (DEC-852). Read for its focused star index, and given the field's hover
   * highlight while a field exists — never the other way round, so that a build with no galaxy
   * attached still picks, still focuses cards and still writes §1.10's hover label.
   */
  readonly picking: ScenePickingHandle
  /** PRD 8.5.11: fires when the frame-time monitor changes tier, and once for the starting tier. */
  readonly onQualityChange?: (tier: QualityTier, index: number) => void
}

export function attachStarScene({
  gl,
  scene,
  camera,
  loop,
  picking,
  onQualityChange,
}: StarSceneOptions): StarSceneHandle {
  const background = createBackground()
  /**
   * The tier monitor, floored by what the post chain can actually render (DEC-703, review §3.7).
   *
   * The floor comes off the GL context: without `EXT_color_buffer_float` the bloom source is
   * quantised to eight bits and the top two rungs stop meaning what they say, so the ladder starts
   * two rungs down instead. See `./platform/capabilities` and `qualityOptionsFor` — a `?quality=`
   * pin still wins, because a pin has to be able to name any tier.
   */
  const capabilities = detectPlatformCapabilities(gl)
  const quality = new QualityMonitor(
    qualityOptionsFor(pinnedQualityTier(), capabilities.minTierIndex),
  )
  /**
   * `?selfcheck=1`, read **once** (DEC-692 R7). The `quality` phase consults it every tick to
   * decide whether to feed the monitor, and `selfCheckRequested()` parses `location.search` into a
   * fresh `URLSearchParams` each call — an allocation per frame on a path whose own header promises
   * none. A flag the page was *opened* with is not a value that may change under it.
   */
  const selfCheckWanted = selfCheckRequested()

  // Per-tick scratch. Allocated once, reused for the life of the scene (PRD 7.3.2).
  const mirror = new Vector3()

  let resources: SceneResources | null = null
  let reducedMotion = false
  let bloomScale = 1
  let glowQuality: GlowQuality = 'full'
  let starsComplete = false
  let selfCheckStarted = false
  let selfCheckTimer = 0
  let selfCheckCancelled = false
  let disposed = false

  // PRD 5.3: the sky. Was `<color attach="background">`; a plain assignment now that there is no
  // reconciler to attach it through.
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

    loop.subscribe('uniforms', () => {
      if (!resources) return
      resources.field.update(
        reducedMotion ? 0 : 1,
        gl.domElement.height,
        (camera.fov * Math.PI) / 180,
        gl.getPixelRatio(),
        bloomScale,
        // `ALIASED_POINT_SIZE_RANGE`'s ceiling, so the sizes the shader asks for are sizes the
        // driver will give (DEC-739). See `StarField.update`.
        capabilities.pointSizeRange[1],
      )
    }),

    // The pointer's own share of this phase moved to `input/attachScenePicking.ts` (DEC-852),
    // which subscribes first — `SceneHost` attaches it before the field — so the mirror below still
    // runs after the frame's pick has been issued, exactly as it did when both were one callback.
    loop.subscribe('pick', () => {
      if (!resources) return
      // PRD 8.5.7: the one star position the CPU computes, refreshed while it is focused so the
      // camera rig always has a current target.
      const focused = picking.focusedIndex
      if (focused >= 0) readStarPosition(focused, mirror)
    }),

    loop.subscribe('quality', ({ delta }) => {
      // The self-check compares two implementations of one formula; a quality change mid-run
      // resizes the drawing buffer and rebuilds the post chain underneath it, which is a different
      // subject. Hold the tier still while it runs.
      if (!selfCheckWanted) quality.sample(delta * 1000)
    }),
  ]

  /**
   * The monitor announces its own starting tier (DEC-703).
   *
   * Its initial index is not a value the caller can compute for itself: it used to be
   * `pinnedQualityTier() ?? 0`, which two files read independently and agreed on by construction,
   * and it is now that pin layered over a GPU capability floor that only the renderer knows. Two
   * authorities for one number is how a caller ends up rendering tier 0's `bloomScale` into tier 2's
   * targets, so the monitor is the authority and this is where it says so.
   */
  const unsubscribeQuality = quality.subscribe((tier, index) => onQualityChange?.(tier, index))

  /**
   * PRD 8.5.6 and 8.5.7, checked against each other on a real GPU. Diagnostic only, and only when
   * the URL asks — which nothing does automatically since DEC-708. See `./selfCheck`.
   */
  function maybeStartSelfCheck(): void {
    if (selfCheckStarted || !selfCheckWanted || !resources || !starsComplete) return
    if (!isPerspective(camera)) return
    // Asked for, but nothing in this build can answer — the product registers no loader, and
    // `?selfcheck=1` is redirected to the harness entry before React starts. See
    // `selfCheck.register.ts`.
    const load = selfCheckLoader()
    if (!load) return
    selfCheckStarted = true
    const ready = resources
    // One second in, so every plane has finished fading and the field has actually moved.
    //
    // Loaded through the registry rather than imported here, and that is the whole point:
    // `selfCheck.ts` is 993 lines that only this branch can reach. A static import put every one of
    // them in the product's first chunk (review §5.4 B1); a dynamic import fixed that but still put
    // them in the product's *build*, because this file is the shipped field (review §3.6 phase 3,
    // item 4). The URL test lives in `selfCheck.url.ts` so asking the question stays free.
    selfCheckTimer = window.setTimeout(() => {
      void load().then(async ({ runSelfCheck, samplesPerRowRequested }) => {
        const result = await runSelfCheck(
          gl,
          scene,
          camera,
          // The scene's own picker, not a second one: the self-check compares the id buffer this
          // frame's picks read against the CPU's projection, so a fresh `IdPicker` with its own
          // render target would be measuring a different object (DEC-852).
          picking.picker,
          ready.table,
          ready.geometry,
          ready.field,
          reducedMotion,
          // `?perrow=N` when the URL sets it, the built-in budget otherwise. Diagnostic knob, on a
          // path that only runs under `?selfcheck=1`; see `samplesPerRowRequested`.
          samplesPerRowRequested() ?? undefined,
        )
        if (!selfCheckCancelled) window.__eternitiesSelfCheck = result
      })
    }, 1000)
  }

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
    get drawnStars() {
      return resources?.geometry.drawCount ?? 0
    },

    setResources: (next) => {
      if (next === resources) return
      if (resources) {
        scene.remove(
          resources.field.glow,
          resources.field.points,
          resources.field.pickPoints,
          resources.field.bloomPoints,
        )
      }
      resources = next
      // The one galaxy-shaped half of picking, handed to the input layer rather than reached for
      // from it (DEC-852). Bound to *this* field, so a load that swaps the resources swaps the
      // object the highlight lands on; `runPick` snapshots it before its awaits for the same
      // reason it snapshots the geometry.
      picking.setStarHighlight(next ? (starIndex) => next.field.setHovered(starIndex) : null)
      if (next) {
        scene.add(
          next.field.glow,
          next.field.points,
          next.field.pickPoints,
          // PRD 5.3.20's bloom source. On `BLOOM_LAYER`, so only the post chain's source pass
          // draws it; the main pass and the pick pass never see it (DEC-703). The glows need no
          // second object — the mesh above is on both layers.
          next.field.bloomPoints,
        )
        next.field.setGlowQuality(glowQuality)
      }
      maybeStartSelfCheck()
    },

    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },
    setBloomScale: (scale) => {
      bloomScale = scale
    },
    setGlowQuality: (next) => {
      if (next === glowQuality) return
      glowQuality = next
      // One assignment on a mesh, not a per-tick write: the ladder's cheapest rung must not be the
      // one that touches the scene graph most (DEC-739).
      resources?.field.setGlowQuality(next)
    },
    setStarsComplete: (complete) => {
      starsComplete = complete
      maybeStartSelfCheck()
    },

    announceStartingTier: () => {
      onQualityChange?.(quality.tier, quality.index)
    },

    dispose: () => {
      if (disposed) return
      disposed = true
      selfCheckCancelled = true
      if (selfCheckTimer !== 0) window.clearTimeout(selfCheckTimer)
      for (const undo of unsubscribes) undo()
      unsubscribeQuality()
      // The field is going; the input layer must stop highlighting it. It is not disposed here —
      // it outlives the galaxy, and `SceneHost` owns its lifetime.
      picking.setStarHighlight(null)
      scene.remove(background.group)
      background.dispose()
    },
  }
}
