/**
 * The app's pointer input layer: the listeners, the per-tick conversion, and PRD 8.5.6's pick
 * (DEC-852).
 *
 * **Why this is its own module, and it is not tidiness.** Every line here used to live in
 * `scene/starScene.ts` — the module worlds spec §3.2 names for deletion as "the galaxy scene". But
 * `starScene.ts` was never only a renderer: it constructed the one `IdPicker` in the app and was
 * the only emitter of `onHover` and `onSelect`, and `SceneHost` routes those into §1.10's printing
 * ring (`setHoveredPlanet`) and into the selection that card focus runs on. So worlds plane
 * picking, card focus and the ring's hover label all came out of a module the cutover was about to
 * delete. Deleting it would have taken the input layer with it — with a green build, because
 * nothing type-checks the *absence* of a pointer listener.
 *
 * This is the same shape as the board's `split_cardtier` ruling on DEC-752 and lands for the same
 * reason: split the module that carries two concerns, keep the half that outlives the galaxy, and
 * let §3.2 delete only the half it actually named. **This file deletes nothing** — see DEC-852.
 *
 * **Nothing here is galaxy-shaped any more.** The one thing that was — the star field's hover
 * highlight, a registration seam the field wrote into — went with the field (DEC-752) and its dead
 * seam with DEC-868. The id buffer is *not* galaxy-shaped, whatever its history suggests: worlds
 * cells write star ids into it (`worlds/cellShaders.ts`), which is why a picked cell arrives here as
 * a `star`.
 *
 * **What deliberately did not move.** The camera. PRD 5.7 and the navigation contract are the rig's;
 * this reports what was picked and stops there — the same boundary `starScene.ts`'s header drew.
 */

import { Vector2, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import { IdPicker, isPerspective } from '../picking/idPicker'
import {
  PlanePicker,
  pickedStarIndex,
  resolvePick,
  samePick,
  type PickResult,
} from '../picking/scenePicker'
import type { FrameLoop } from '../renderer/frameLoop'
import type { PlaneTable } from '../starfield/planeTable'
import type { StarGeometry } from '../starfield/starGeometry'

/**
 * The star **data** layer a pick resolves against — the buffer and the plane table, and neither of
 * the two star *objects* (`StarField`, the nebula) that §3.2 deletes.
 *
 * Structurally the fields `SceneResources` carries that survive the cutover, named as their own
 * type so this module's dependency is the data and not the galaxy's resource bundle.
 */
export interface PickSources {
  readonly geometry: StarGeometry
  readonly table: PlaneTable
}

export interface ScenePickingOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  /** PRD 5.4.12 hover and PRD 5.7.2 click. `null` means the pointer is over empty space. */
  readonly onHover?: (pick: PickResult) => void
  readonly onSelect?: (pick: PickResult) => void
  /**
   * The id-buffer reader, injectable **because the acceptance bar for this split is a test**.
   *
   * A pick is a render pass, so the product's `IdPicker` cannot run without a GL context and the
   * routing below would otherwise be reachable only from e2e — which is how the wiring this module
   * exists to protect came to be unguarded in the first place. The default is the product's, and
   * `SceneHost` never passes one.
   */
  readonly picker?: IdPicker
}

export interface ScenePickingHandle {
  /** The star index the last click resolved to, or `-1`. PRD 8.5.7's mirror tracks this. */
  readonly focusedIndex: number
  /**
   * The picker the scene is reading through, for the GPU self-check — which compares the id
   * buffer against the CPU's own projection and so must read the *same* instance, not a second one
   * with its own render target (`scene/selfCheck.ts`).
   */
  readonly picker: IdPicker
  /** `planes.json` and the star buffer have landed. `null` before them, and after a teardown. */
  setSources: (sources: PickSources | null) => void
  /** PRD 5.9: a plane's pick radius grows with its motion, so a frozen table picks differently. */
  setReducedMotion: (reduced: boolean) => void
  dispose: () => void
}

/** Pointer moves are cheap; a pick is a render pass. One pick per frame at most (PRD 8.5.6). */
interface PointerState {
  /** Device pixels, resolved by the `input` phase. */
  x: number
  y: number
  /** Raw client coordinates as the listener saw them, pending conversion. See {@link toDevicePixels}. */
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

export function attachScenePicking({
  gl,
  scene,
  camera,
  loop,
  onHover,
  onSelect,
  picker = new IdPicker(),
}: ScenePickingOptions): ScenePickingHandle {
  const canvas = gl.domElement
  const planePicker = new PlanePicker()

  // Per-tick scratch. Allocated once, reused for the life of the attachment (PRD 7.3.2).
  const ndc = new Vector2()
  /** Scratch for the renderer's CSS size, which §1.11's pick floor is expressed in. */
  const cssSize = new Vector2()
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

  let sources: PickSources | null = null
  let reducedMotion = false
  let disposed = false

  /**
   * PRD 8.5.6: the id buffer first, the plane spheres second, "with the id buffer taking
   * precedence when it hits".
   */
  async function runPick(select: boolean): Promise<void> {
    if (!sources || !isPerspective(camera)) return
    // Bound before the awaits below, so the closures the resolver takes cannot see a `sources`
    // that a load swapped underneath them.
    const geometry = sources.geometry
    const table = sources.table
    let result: PickResult = null

    if (pointer.inside) {
      // A click queues for its turn; a hover takes whatever is going. Hover has a next frame to
      // retry on and a click does not, and answering a click from the plane raycast because a
      // hover read happened to be in flight is exactly the precedence rule inverted.
      const starIndex = select
        ? await picker.pickQueued(gl, scene, camera, pointer.x, pointer.y)
        : await picker.pick(gl, scene, camera, pointer.x, pointer.y)

      const resolved = resolvePick(
        starIndex,
        geometry.drawCount,
        (index) => geometry.planeRowOf(index),
        () => {
          ndc.set(
            (pointer.x / gl.domElement.width) * 2 - 1,
            -((pointer.y / gl.domElement.height) * 2 - 1),
          )
          // CSS pixels, never the drawing buffer's: §1.11's floor is a CSS-pixel target, and on a
          // 2x display `getDrawingBufferSize` would halve it while the picture stayed identical.
          gl.getSize(cssSize)
          return planePicker.pick(ndc, camera, table, reducedMotion ? 0 : 1, cssSize.y)
        },
      )
      // The id buffer was not consulted. Leave hover and focus exactly as they were and let the
      // next frame ask again; reporting anything here would be reporting a guess.
      if (resolved === undefined) return
      result = resolved
    }

    // On the *pick*, not on its star index: a planet and a plane both have star index -1, and
    // collapsing them onto one another is what silenced PRD 5.6.9's planet hover entirely.
    if (!samePick(result, hovered)) {
      hovered = result
      onHover?.(result)
    }
    if (select) {
      focused = pickedStarIndex(result)
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

  /**
   * Client coordinates to device pixels, once per tick.
   *
   * The listeners used to do this per `pointermove` — a forced synchronous layout per pointer
   * event, at whatever rate the mouse reports. They now store the raw sample and the `input` phase
   * converts it, which is at most one layout read per frame. The pick still sees the newest sample;
   * it was already throttled to the frame.
   */
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

    loop.subscribe('pick', () => {
      if (!sources) return
      if (pointer.moved && !picker.pending) {
        pointer.moved = false
        void runPick(false)
      }
    }),
  ]

  return {
    get focusedIndex() {
      return focused
    },
    picker,

    setSources: (next) => {
      sources = next
    },
    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },

    dispose: () => {
      if (disposed) return
      disposed = true
      for (const undo of unsubscribes) undo()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      picker.dispose()
    },
  }
}
