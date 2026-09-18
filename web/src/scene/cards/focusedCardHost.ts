/**
 * The focused card's share of the tick: §1.10's flat printing ring, its pointer tilt, and the
 * hovered planet's label (PRD 5.6).
 *
 * > **This is the half of the old `cardTier.ts` that outlives the galaxy (DEC-752, board ruling
 * > `split_cardtier`).** §3.2 lists "the thumbnail atlas and the card-sheet tier" among the things
 * > the cutover deletes, and that module was named for the tier — but it also happened to be the
 * > only place in the app that ever constructed a `FocusedCard`, and `FocusedCard` *is* the printing
 * > ring, a §3.2 condition-4 parity surface. It was likewise the only writer of the hover label's
 * > `labelState`. Deleting it wholesale would have left a green build, a still-rendering
 * > `<PlanetHoverLabel>` and no ring, with nothing to report it: W1–W5 read neither surface. So the
 * > module was split rather than deleted, and this is the surviving side.
 *
 * It computes exactly one star position on the CPU per tick: the focused card's, through the same
 * `starWorldPosition` the vertex shader runs. That is PRD 8.5.7's single permitted mirror, and it is
 * why the card sits on its star rather than near it while the plane turns underneath.
 *
 * **The `cards` phase runs after `rig`** ({@link TICK_PHASES}): this reads `camera.getWorldPosition`
 * and projects the hovered planet's label, so it needs the camera matrices the rig has just
 * finalised.
 */

import { Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import type { CardRecord } from '../../data/types'
import type { FrameLoop } from '../renderer/frameLoop'
import { starWorldPosition } from '../starfield/motion'
import type { SceneResources } from '../useSceneData'

import { FocusedCard } from './focusedCard'
import { ImageQueue, type ImageQueueStats } from './imageQueue'

/** The focused plane's cards, keyed by global star index. Filled by the plane-detail loader. */
export interface PlaneCards {
  readonly get: (starIndex: number) => CardRecord | null
}

/**
 * Where the hovered planet's label should be drawn, in CSS pixels.
 *
 * A mutable object written by the frame loop and read by the overlay, exactly as the plane labels
 * work (PRD 7.3.3, `labels/PlaneLabels`): a hover must not cost a React render, and the label must
 * not be a frame behind the planet.
 */
export interface PlanetLabelState {
  visible: boolean
  x: number
  y: number
  printing: number
}

export interface FocusedCardHandle {
  readonly card: FocusedCard
  /** PRD 7.2's six-request budget, as it is actually being spent. */
  readonly imageStats: ImageQueueStats
  /** Live GPU bytes for everything the focused card has uploaded (PRD 7.2). */
  readonly gpuBytes: { card: number }
  /** The focused plane's cards. Arrives with the plane's shards (PRD 8.7.6). */
  setCards: (cards: PlaneCards) => void
  /** PRD 5.6.1: focusing a card shows it; releasing focus hides it. `-1` is no focus. */
  setFocusedStar: (star: number) => void
  setReducedMotion: (reduced: boolean) => void
  /** The planet under the pointer, or -1 (PRD 5.6.9). */
  setHoveredPlanet: (planet: number) => void
  dispose: () => void
}

export interface FocusedCardOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  readonly resources: SceneResources
  readonly labelState: PlanetLabelState
}

export function attachFocusedCard({
  gl,
  scene,
  camera,
  loop,
  resources,
  labelState,
}: FocusedCardOptions): FocusedCardHandle {
  const canvas = gl.domElement
  const queue = new ImageQueue()
  const card = new FocusedCard(queue)

  let cards: PlaneCards = { get: () => null }
  let focusedStar = -1
  let reducedMotion = false
  let hoveredPlanet = -1
  let disposed = false

  const cardPosition = new Vector3()
  const cameraPosition = new Vector3()
  const projected = new Vector3()
  const pointer = { x: 0, y: 0, inside: false }
  /**
   * The canvas's CSS size, kept by a `ResizeObserver` rather than measured in the frame callback
   * (DEC-692 R11).
   *
   * PRD 5.6.9's hover label needs it to turn a projected NDC position into a pixel offset, and it
   * was calling `getBoundingClientRect()` from inside `useFrame` to get it — a forced synchronous
   * layout, on the frame path, on every frame the pointer was over a planet.
   */
  const canvasBox = { width: 0, height: 0 }

  // `ResizeObserver` fires once on observation, so the initial size comes from the same path the
  // later ones do.
  const observer = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect()
    canvasBox.width = rect.width
    canvasBox.height = rect.height
  })
  observer.observe(canvas)

  // PRD 5.6.3: the tilt follows the pointer. On the canvas rather than in React, because a pointer
  // move must not cost a render (PRD 7.3.3).
  const onMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    pointer.inside = true
  }
  const onLeave = (): void => {
    pointer.inside = false
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)

  scene.add(card.root)

  /** PRD 5.6.1. Re-run when focus moves *and* when the record lands, which can be later. */
  function applyFocus(): void {
    if (focusedStar < 0) {
      card.hide()
      return
    }
    const record = cards.get(focusedStar)
    if (!record) return
    card.show(record, focusedStar, resources.geometry.hueClassOf(focusedStar))
  }

  const unsubscribe = loop.subscribe('cards', ({ delta }) => {
    const motionScale = reducedMotion ? 0 : 1

    camera.getWorldPosition(cameraPosition)
    // §1.10's ticks are sized in CSS pixels and `gl_PointSize` is in device pixels.
    card.setPixelRatio(gl.getPixelRatio())

    // Every tick, focused or not: a decoded image that arrives as focus is released still has to
    // reach the GPU and let its bitmap go.
    card.flushUploads(gl)

    if (card.visible && focusedStar >= 0) {
      const { table, geometry } = resources
      geometry.localPosition(focusedStar, cardPosition)
      starWorldPosition(
        table.raw,
        geometry.planeRowOf(focusedStar),
        cardPosition.x,
        cardPosition.y,
        cardPosition.z,
        table.time,
        table.multiverseAngle,
        motionScale,
        cardPosition,
      )
      card.setPointer(pointer.inside ? pointer.x : null, pointer.inside ? pointer.y : null)
      card.update(delta, cardPosition, cameraPosition, motionScale, reducedMotion)

      // PRD 5.6.9's hover label, projected here so the overlay never has to know about three.js.
      if (hoveredPlanet >= 0 && card.planetWorldPosition(hoveredPlanet, projected)) {
        projected.project(camera)
        labelState.x = ((projected.x + 1) / 2) * canvasBox.width
        labelState.y = ((1 - projected.y) / 2) * canvasBox.height
        labelState.printing = card.hoveredPlanetPrinting() ?? -1
        labelState.visible = projected.z < 1
      } else {
        labelState.visible = false
      }
    } else {
      labelState.visible = false
    }
  })

  return {
    card,
    get imageStats() {
      return queue.stats
    },
    get gpuBytes() {
      return { card: card.gpuBytes }
    },

    setCards: (next) => {
      if (next === cards) return
      cards = next
      // The record for the focused star may have just arrived with this set.
      applyFocus()
    },
    setFocusedStar: (star) => {
      if (star === focusedStar) return
      focusedStar = star
      applyFocus()
    },
    setReducedMotion: (reduced) => {
      reducedMotion = reduced
    },
    setHoveredPlanet: (planet) => {
      if (planet === hoveredPlanet) return
      hoveredPlanet = planet
      card.setHoveredPlanet(planet)
    },

    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      observer.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      scene.remove(card.root)
      card.dispose()
      queue.dispose()
    },
  }
}
