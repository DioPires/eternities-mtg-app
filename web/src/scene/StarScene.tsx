/**
 * The star field's one per-frame callback.
 *
 * Everything that happens each frame happens here, in a fixed order, from preallocated state:
 * advance the plane table, push the uniforms, turn the background, pick under the pointer, mirror
 * the focused star, feed the frame-time monitor. One callback rather than six is what makes PRD
 * 7.3.2's "no allocations in the per-frame path" something you can read off the page instead of
 * something you have to audit across a component tree.
 *
 * What this file deliberately does *not* do is move the camera. PRD 5.7 and the navigation
 * contract are Phase 2b's; the scene exposes what a camera rig needs — a pick result and the
 * focused star's live world position — and stops there.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useImperativeHandle, useMemo, useRef, type ReactElement, type Ref } from 'react'
import { Vector2, Vector3, type PerspectiveCamera } from 'three'

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
import { selfCheckRequested } from './selfCheck.url'
import { starWorldPosition } from './starfield/motion'
import { SKY_COLOUR } from './tuning'
import type { SceneResources } from './useSceneData'

export interface StarSceneHandle {
  /**
   * PRD 8.5.7's CPU motion mirror. The focused star's world position, right now, computed with the
   * same formula the vertex shader used to draw it. Phase 2b's camera tethers to this.
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
}

export interface StarSceneProps {
  readonly resources: SceneResources | null
  /** Every record of `stars.bin` is drawable. Gates the GPU self-check; nothing else needs it. */
  readonly starsComplete?: boolean
  /** PRD 5.9. 0 stops rotation, drift, twinkle and dust turbulence. */
  readonly reducedMotion: boolean
  /**
   * The live tier's bloom resolution multiplier (PRD 8.5.11's second rung), for the bloom source
   * pass (DEC-703).
   *
   * The field's sprite sizes are in device pixels, and the bloom source is a smaller target than
   * the drawing buffer, so the second draw needs the same numbers scaled — see the uniform block in
   * `./starfield/starFieldObjects`. It arrives as a prop rather than off the monitor because the
   * post chain has to be told the same value in the same frame, and one owner of it is the point.
   */
  readonly bloomScale: number
  /**
   * The live tier's glow program (PRD 8.5.11's new bottom rung, DEC-739).
   *
   * A prop for the same reason `bloomScale` is one: the ladder has exactly one owner and it is the
   * monitor inside this component, which announces a tier upwards; the scene resolves the tier into
   * its rungs and hands each one back to whoever applies it. Applied in an effect rather than per
   * frame because it is a pointer write on a mesh, not a uniform.
   */
  readonly glowQuality: GlowQuality
  /** PRD 5.4.12 hover and PRD 5.7.2 click. `null` means the pointer is over empty space. */
  readonly onHover?: (pick: PickResult) => void
  readonly onSelect?: (pick: PickResult) => void
  /** PRD 8.5.11: fires when the frame-time monitor changes tier. Phase 4 stores it (PRD 8.4.2). */
  readonly onQualityChange?: (tier: QualityTier, index: number) => void
  /** One sample per frame, for the bench of implementation-plan §6. */
  readonly onFrame?: (frameMs: number, cpuMs: number, drawn: number) => void
  readonly handleRef?: Ref<StarSceneHandle>
}

/** Pointer moves are cheap; a pick is a render pass. One pick per frame at most (PRD 8.5.6). */
interface PointerState {
  x: number
  y: number
  moved: boolean
  inside: boolean
  downX: number
  downY: number
}

export function StarScene({
  resources,
  starsComplete = false,
  reducedMotion,
  bloomScale,
  glowQuality,
  onHover,
  onSelect,
  onQualityChange,
  onFrame,
  handleRef,
}: StarSceneProps): ReactElement {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  const background = useMemo(() => createBackground(), [])
  const idPicker = useMemo(() => new IdPicker(), [])
  const planePicker = useMemo(() => new PlanePicker(), [])
  /**
   * The tier monitor, floored by what the post chain can actually render (DEC-703, review §3.7).
   *
   * Keyed on `gl` because the floor comes off the GL context: without `EXT_color_buffer_float` the
   * bloom source is quantised to eight bits and the top two rungs stop meaning what they say, so
   * the ladder starts two rungs down instead. See `./platform/capabilities` and `qualityOptionsFor`
   * — a `?quality=` pin still wins, because a pin has to be able to name any tier.
   */
  const capabilities = useMemo(() => detectPlatformCapabilities(gl), [gl])
  const quality = useMemo(
    () => new QualityMonitor(qualityOptionsFor(pinnedQualityTier(), capabilities.minTierIndex)),
    [capabilities],
  )
  /**
   * `?selfcheck=1`, read **once** (DEC-692 R7).
   *
   * The frame callback below consults it every frame to decide whether to feed the monitor, and
   * `selfCheckRequested()` parses `location.search` into a fresh `URLSearchParams` each call — an
   * allocation per frame on a path whose own header promises none. A flag the page was *opened*
   * with is not a value that may change under it, which is the same argument `EternitiesScene`
   * makes for latching `?probe=` and `?quality=`.
   */
  const selfCheckWanted = useMemo(() => selfCheckRequested(), [])

  // Callbacks live in a ref so that a caller passing inline arrows — which every React caller
  // eventually does — cannot re-subscribe pointer listeners or reset the pixel ratio on a render.
  const callbacks = useRef({ onHover, onSelect, onQualityChange, onFrame })
  callbacks.current = { onHover, onSelect, onQualityChange, onFrame }

  // Per-frame scratch. Allocated once, reused for the life of the scene (PRD 7.3.2).
  const ndc = useRef(new Vector2()).current
  const mirror = useRef(new Vector3()).current
  const pointer = useRef<PointerState>({
    x: 0,
    y: 0,
    moved: false,
    inside: false,
    downX: 0,
    downY: 0,
  }).current
  /** The last pick reported to `onHover`, whatever its kind. See {@link samePick}. */
  const hovered = useRef<PickResult>(null)
  const focused = useRef(-1)
  const lastFrame = useRef(0)

  useImperativeHandle(
    handleRef,
    (): StarSceneHandle => ({
      focusedStarPosition: (out) => readStarPosition(focused.current, out),
      starPosition: (index, out) => readStarPosition(index, out),
      get focusedIndex() {
        return focused.current
      },
      get qualityThresholds() {
        const band = quality.thresholdsMs
        return {
          refreshMs: quality.refreshIntervalMs,
          degradeMs: band.degrade,
          restoreMs: band.restore,
        }
      },
    }),
    // `readStarPosition` closes over refs and `resources`, so the handle is rebuilt only when the
    // scene itself is.
    [resources, quality],
  )

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

  // Pointer state lives on the canvas, not in React: a pointer move must not cost a render
  // (PRD 7.3.3), and the pick that follows is throttled to the frame anyway.
  useEffect(() => {
    const canvas = gl.domElement
    const toDevice = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const ratio = canvas.width / rect.width
      pointer.x = (event.clientX - rect.left) * ratio
      pointer.y = (event.clientY - rect.top) * ratio
      pointer.moved = true
      pointer.inside = true
    }
    const onMove = (event: PointerEvent): void => {
      toDevice(event)
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
      // A drag is a camera gesture, not a click. Phase 2b owns the camera; this only decides
      // whether the gesture was a selection.
      const dragged =
        Math.abs(event.clientX - pointer.downX) > 4 || Math.abs(event.clientY - pointer.downY) > 4
      if (dragged) return
      toDevice(event)
      void runPick(true)
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
    }
    // `runPick` reads everything it needs through refs and `resources`, so the listeners only
    // need re-binding when the canvas or the scene itself changes.
  }, [gl, resources])

  /**
   * PRD 8.5.6: the id buffer first, the plane spheres second, "with the id buffer taking
   * precedence when it hits".
   */
  async function runPick(select: boolean): Promise<void> {
    if (!resources || !isPerspective(camera)) return
    const perspective: PerspectiveCamera = camera
    // Bound before the awaits below, so the closures the resolver takes cannot see a `resources`
    // that a re-render swapped underneath them.
    const geometry = resources.geometry
    const table = resources.table
    let result: PickResult = null

    if (pointer.inside) {
      // A click queues for its turn; a hover takes whatever is going. Hover has a next frame to
      // retry on and a click does not, and answering a click from the plane raycast because a
      // hover read happened to be in flight is exactly the precedence rule inverted.
      const starIndex = select
        ? await idPicker.pickQueued(gl, scene, perspective, pointer.x, pointer.y)
        : await idPicker.pick(gl, scene, perspective, pointer.x, pointer.y)

      const resolved = resolvePick(
        starIndex,
        geometry.drawCount,
        (index) => geometry.planeRowOf(index),
        () => {
          ndc.set(
            (pointer.x / gl.domElement.width) * 2 - 1,
            -((pointer.y / gl.domElement.height) * 2 - 1),
          )
          return planePicker.pick(ndc, perspective, table, reducedMotion ? 0 : 1)
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
    if (!samePick(result, hovered.current)) {
      hovered.current = result
      resources.field.setHovered(hoverIndex)
      callbacks.current.onHover?.(result)
    }
    if (select) {
      focused.current = hoverIndex
      // PRD 5.3.4: the dust brightens while it is the focus, and the dust is exactly the stars of
      // the Blind Eternities row.
      resources.table.setDustFocused(
        result?.kind === 'star' && resources.geometry.planeRowOf(result.index) === 0,
      )
      callbacks.current.onSelect?.(result)
    }
  }

  // PRD 7.1.3's pixel-ratio cap is *not* applied here any more (DEC-692 R2). This used to call
  // `setDpr(min(tier.pixelRatioCap, devicePixelRatio))` on mount and on every tier change, which
  // made two writers of one number: R3F re-applies the `<Canvas dpr>` prop on every render, so
  // whichever ran last won and under the free ladder that was the prop, twice a second. The prop is
  // now a range — `dpr={[0.5, tier.pixelRatioCap]}`, which R3F resolves to exactly the `min` above
  // — so the cap has one writer and the rung lands. All this effect does is announce the change.
  //
  // **It announces the starting tier too (DEC-703).** The monitor's initial index is no longer a
  // value the caller can compute for itself: it used to be `pinnedQualityTier() ?? 0`, which both
  // this file and `EternitiesScene` read independently and agreed on by construction, and it is now
  // that pin layered over a GPU capability floor that only the renderer knows. Two authorities for
  // one number is how a caller ends up rendering tier 0's `bloomScale` into tier 2's targets, so
  // the monitor is the authority and this is where it says so. One render, once, on mount.
  useEffect(() => {
    const unsubscribe = quality.subscribe((tier, index) =>
      callbacks.current.onQualityChange?.(tier, index),
    )
    callbacks.current.onQualityChange?.(quality.tier, quality.index)
    return unsubscribe
  }, [quality])

  useEffect(
    () => () => {
      background.dispose()
      idPicker.dispose()
    },
    [background, idPicker],
  )

  // PRD 8.5.11's bottom rung (DEC-739): swap the glow's fragment program. An effect rather than a
  // per-frame write because it is one assignment on a mesh, and re-running it every frame would
  // mean the ladder's cheapest rung was the one that touched the scene graph most.
  useEffect(() => {
    resources?.field.setGlowQuality(glowQuality)
  }, [resources, glowQuality])

  // PRD 8.5.6 and 8.5.7, checked against each other on a real GPU. Diagnostic only, and only when
  // the URL asks — which nothing does automatically since DEC-708. See `./selfCheck`.
  useEffect(() => {
    if (!resources || !starsComplete || !selfCheckWanted || !isPerspective(camera)) return
    let cancelled = false
    // One second in, so every plane has finished fading and the field has actually moved.
    //
    // Imported here rather than at the top of the file, and that is the whole point: `selfCheck.ts`
    // is 993 lines that only this branch can reach, and a static import put every one of them in
    // the product's first chunk (review §5.4 B1). The URL test above lives in `selfCheck.url.ts`
    // so asking the question stays free.
    const timer = window.setTimeout(() => {
      void import('./selfCheck').then(async ({ runSelfCheck, samplesPerRowRequested }) => {
        const result = await runSelfCheck(
          gl,
          scene,
          camera,
          idPicker,
          resources.table,
          resources.geometry,
          resources.field,
          reducedMotion,
          // `?perrow=N` when the URL sets it, the built-in budget otherwise. Diagnostic knob, on a
          // path that only runs under `?selfcheck=1`; see `samplesPerRowRequested`.
          samplesPerRowRequested() ?? undefined,
        )
        if (!cancelled) window.__eternitiesSelfCheck = result
      })
    }, 1000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [resources, starsComplete, selfCheckWanted, gl, scene, camera, idPicker, reducedMotion])

  useFrame((_, delta) => {
    const started = performance.now()
    const motion = reducedMotion ? 0 : 1

    if (resources) {
      const { table, field } = resources
      table.advance(delta, motion)
      field.update(
        motion,
        gl.domElement.height,
        ((camera as PerspectiveCamera).fov * Math.PI) / 180,
        gl.getPixelRatio(),
        bloomScale,
        // `ALIASED_POINT_SIZE_RANGE`'s ceiling, so the sizes the shader asks for are sizes the
        // driver will give (DEC-739). See `StarField.update`.
        capabilities.pointSizeRange[1],
      )
      advanceBackground(background.group, table.multiverseAngle)

      if (pointer.moved && !idPicker.pending) {
        pointer.moved = false
        void runPick(false)
      }
      // PRD 8.5.7: the one star position the CPU computes, refreshed while it is focused so the
      // camera rig always has a current target.
      if (focused.current >= 0) readStarPosition(focused.current, mirror)
    } else {
      advanceBackground(background.group, 0)
    }

    const cpuMs = performance.now() - started
    const frameMs = lastFrame.current === 0 ? delta * 1000 : started - lastFrame.current
    lastFrame.current = started
    // The self-check compares two implementations of one formula; a quality change mid-run
    // resizes the drawing buffer and rebuilds the effect composer underneath it, which is a
    // different subject. Hold the tier still while it runs.
    if (!selfCheckWanted) quality.sample(frameMs)
    callbacks.current.onFrame?.(frameMs, cpuMs, resources?.geometry.drawCount ?? 0)
  })

  return (
    <>
      <color attach="background" args={[SKY_COLOUR]} />
      <primitive object={background.group} />
      {resources && (
        <>
          <primitive object={resources.field.glow} />
          <primitive object={resources.field.points} />
          <primitive object={resources.field.pickPoints} />
          {/* PRD 5.3.20's bloom source. On `BLOOM_LAYER`, so only the post chain's source pass
              draws it; the main pass and the pick pass never see it (DEC-703). The glows need no
              second object — the mesh above is on both layers. */}
          <primitive object={resources.field.bloomPoints} />
        </>
      )}
    </>
  )
}
