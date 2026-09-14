/**
 * The star field's share of the tick (PRD 5.3, 5.4, 8.5).
 *
 * Everything that happens each frame happens here, from preallocated state: drain the pointer,
 * advance the plane table, turn the background, push the uniforms, pick under the pointer, mirror
 * the focused star, feed the frame-time monitor. What changed in review §3.6 phase 3 is *where the
 * order comes from*. This was one `useFrame` callback whose six steps ran in source order inside
 * it, and whose position relative to the camera rig, the card tier and the post chain was the
 * position of a JSX element among its siblings. The six steps are now subscriptions to named
 * phases of {@link TICK_PHASES}, and the order between them and everything else is that list.
 *
 * What this file deliberately does *not* do is move the camera. PRD 5.7 and the navigation contract
 * are the rig's; the scene exposes what a camera rig needs — a pick result and the focused star's
 * live world position — and stops there.
 *
 * **One real change of behaviour, and it is a fix.** The pointer listeners used to call
 * `getBoundingClientRect()` on every `pointermove` to convert to device pixels — a forced
 * synchronous layout per pointer event, on a path whose header promises none, at whatever rate the
 * mouse reports. The listeners now store the raw client coordinates and the `input` phase converts
 * them once per tick, which is at most one layout read per frame and is what gives that phase
 * something to do. The pick still sees the newest sample; it was already throttled to the frame.
 */

import { Color, Vector2, Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import { advanceBackground, createBackground } from './background'
import { IdPicker, isPerspective } from './picking/idPicker'
import {
  PlanePicker,
  pickedStarIndex,
  resolvePick,
  samePick,
  type PickResult,
} from './picking/scenePicker'
import { detectPlatformCapabilities } from './platform/capabilities'
import {
  QualityMonitor,
  pinnedQualityTier,
  qualityOptionsFor,
  type GlowQuality,
  type QualityTier,
} from './quality/adaptiveQuality'
import type { FrameLoop } from './renderer/frameLoop'
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
  /** PRD 5.4.12 hover and PRD 5.7.2 click. `null` means the pointer is over empty space. */
  readonly onHover?: (pick: PickResult) => void
  readonly onSelect?: (pick: PickResult) => void
  /** PRD 8.5.11: fires when the frame-time monitor changes tier, and once for the starting tier. */
  readonly onQualityChange?: (tier: QualityTier, index: number) => void
}

/** Pointer moves are cheap; a pick is a render pass. One pick per frame at most (PRD 8.5.6). */
interface PointerState {
  /** Device pixels, resolved by the `input` phase. */
  x: number
  y: number
  /** Raw client coordinates as the listener saw them, pending conversion. See the header. */
  clientX: number
  clientY: number
  /** A sample arrived since the last `input` phase. */
  fresh: boolean
  /** A converted sample the `pick` phase has not consumed yet. */
  moved: boolean
  inside: boolean
  downX: number
  downY: number
}

export function attachStarScene({
  gl,
  scene,
  camera,
  loop,
  onHover,
  onSelect,
  onQualityChange,
}: StarSceneOptions): StarSceneHandle {
  const canvas = gl.domElement
  const background = createBackground()
  const idPicker = new IdPicker()
  const planePicker = new PlanePicker()
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
  const ndc = new Vector2()
  const mirror = new Vector3()
  const pointer: PointerState = {
    x: 0,
    y: 0,
    clientX: 0,
    clientY: 0,
    fresh: false,
    moved: false,
    inside: false,
    downX: 0,
    downY: 0,
  }
  /** The last pick reported to `onHover`, whatever its kind. See {@link samePick}. */
  let hovered: PickResult = null
  let focused = -1

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

  /**
   * PRD 8.5.6: the id buffer first, the plane spheres second, "with the id buffer taking
   * precedence when it hits".
   */
  async function runPick(select: boolean): Promise<void> {
    if (!resources || !isPerspective(camera)) return
    // Bound before the awaits below, so the closures the resolver takes cannot see a `resources`
    // that a load swapped underneath them.
    const geometry = resources.geometry
    const table = resources.table
    const field = resources.field
    let result: PickResult = null

    if (pointer.inside) {
      // A click queues for its turn; a hover takes whatever is going. Hover has a next frame to
      // retry on and a click does not, and answering a click from the plane raycast because a
      // hover read happened to be in flight is exactly the precedence rule inverted.
      const starIndex = select
        ? await idPicker.pickQueued(gl, scene, camera, pointer.x, pointer.y)
        : await idPicker.pick(gl, scene, camera, pointer.x, pointer.y)

      const resolved = resolvePick(
        starIndex,
        geometry.drawCount,
        (index) => geometry.planeRowOf(index),
        () => {
          ndc.set(
            (pointer.x / gl.domElement.width) * 2 - 1,
            -((pointer.y / gl.domElement.height) * 2 - 1),
          )
          return planePicker.pick(ndc, camera, table, reducedMotion ? 0 : 1)
        },
      )
      // The id buffer was not consulted. Leave hover and focus exactly as they were and let the
      // next frame ask again; reporting anything here would be reporting a guess.
      if (resolved === undefined) return
      result = resolved
    }

    const hoverIndex = pickedStarIndex(result)
    // On the *pick*, not on its star index: a planet and a plane both have index -1 as far as the
    // star field is concerned, and collapsing them onto one another is what silenced PRD 5.6.9's
    // planet hover entirely. `setHovered` still takes the star index, because the highlight it
    // drives belongs to the star field and a planet is not one of its stars.
    if (!samePick(result, hovered)) {
      hovered = result
      field.setHovered(hoverIndex)
      onHover?.(result)
    }
    if (select) {
      focused = hoverIndex
      // PRD 5.3.4: the dust brightens while it is the focus, and the dust is exactly the stars of
      // the Blind Eternities row.
      table.setDustFocused(result?.kind === 'star' && geometry.planeRowOf(result.index) === 0)
      onSelect?.(result)
    }
  }

  // Pointer state lives on the canvas, not in React: a pointer move must not cost a render
  // (PRD 7.3.3), and the pick that follows is throttled to the tick anyway.
  const onMove = (event: PointerEvent): void => {
    pointer.clientX = event.clientX
    pointer.clientY = event.clientY
    pointer.fresh = true
    pointer.inside = true
  }
  const onLeave = (): void => {
    pointer.inside = false
    pointer.moved = true
  }
  const onDown = (event: PointerEvent): void => {
    pointer.downX = event.clientX
    pointer.downY = event.clientY
  }
  const onUp = (event: PointerEvent): void => {
    // A drag is a camera gesture, not a click. The rig owns the camera; this only decides whether
    // the gesture was a selection.
    const dragged =
      Math.abs(event.clientX - pointer.downX) > 4 || Math.abs(event.clientY - pointer.downY) > 4
    if (dragged) return
    // A click has no next frame to retry on, so it converts its own coordinates rather than waiting
    // for the `input` phase — the one place the per-event layout read is still worth paying for.
    pointer.clientX = event.clientX
    pointer.clientY = event.clientY
    pointer.inside = true
    toDevicePixels()
    void runPick(true)
  }

  function toDevicePixels(): void {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const ratio = canvas.width / rect.width
    pointer.x = (pointer.clientX - rect.left) * ratio
    pointer.y = (pointer.clientY - rect.top) * ratio
  }

  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)

  const unsubscribes = [
    // `input`: the phase the scope names first. One layout read per tick, not one per pointer event.
    loop.subscribe('input', () => {
      if (!pointer.fresh) return
      pointer.fresh = false
      toDevicePixels()
      pointer.moved = true
    }),

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

    loop.subscribe('pick', () => {
      if (!resources) return
      if (pointer.moved && !idPicker.pending) {
        pointer.moved = false
        void runPick(false)
      }
      // PRD 8.5.7: the one star position the CPU computes, refreshed while it is focused so the
      // camera rig always has a current target.
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
    selfCheckStarted = true
    const ready = resources
    // One second in, so every plane has finished fading and the field has actually moved.
    //
    // Imported here rather than at the top of the file, and that is the whole point: `selfCheck.ts`
    // is 993 lines that only this branch can reach, and a static import put every one of them in
    // the product's first chunk (review §5.4 B1). The URL test lives in `selfCheck.url.ts` so
    // asking the question stays free.
    selfCheckTimer = window.setTimeout(() => {
      void import('./selfCheck').then(async ({ runSelfCheck, samplesPerRowRequested }) => {
        const result = await runSelfCheck(
          gl,
          scene,
          camera,
          idPicker,
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
    focusedStarPosition: (out) => readStarPosition(focused, out),
    starPosition: (index, out) => readStarPosition(index, out),
    get focusedIndex() {
      return focused
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
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      scene.remove(background.group)
      background.dispose()
      idPicker.dispose()
    },
  }
}
