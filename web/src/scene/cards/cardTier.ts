/**
 * The card tier's share of the tick: the thumbnail layer, the focused card and its planets
 * (PRD 5.5, 5.6).
 *
 * The sibling of `scene/starScene`, and it follows the same rule: one subscription, preallocated
 * state, no allocation in the frame path (PRD 7.3.2). What it adds to the scene graph is three
 * objects — the thumbnail mesh and its pick twin, and the card group with its planets — and what it
 * adds to the tick is one selector pass every 200 ms, one instance rebuild, and the card's springs.
 *
 * It computes exactly one star position on the CPU per tick: the focused card's, through the same
 * `starWorldPosition` the vertex shader runs. That is PRD 8.5.7's single permitted mirror, and it is
 * why the card sits on its star rather than near it while the plane turns underneath.
 *
 * **The `cards` phase runs after `rig`** ({@link TICK_PHASES}), which is a promotion of what used to
 * be luck: this reads `camera.getWorldPosition` and projects the hovered planet's label, so it needs
 * the camera matrices the rig has just finalised. Under R3F both were priority-0 `useFrame`
 * subscribers and the order between them was their JSX order in `EternitiesScene`.
 */

import { Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import type { CardRecord, PlaneRecord } from '../../data/types'
import type { SceneNavigation } from '../../navigation/scene'
import type { FrameLoop } from '../renderer/frameLoop'
import { starWorldPosition } from '../starfield/motion'
import type { SceneResources } from '../useSceneData'

import { FocusedCard } from './focusedCard'
import { ImageQueue, type ImageQueueStats } from './imageQueue'
import { ThumbnailTier, type ThumbnailTierStats } from './thumbnailTier'
import type { SelectorView } from './thumbnailSelector'

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

export interface CardTierHandle {
  readonly card: FocusedCard
  readonly stats: ThumbnailTierStats
  /** PRD 7.2's six-request budget, as it is actually being spent. */
  readonly imageStats: ImageQueueStats
  /** Star indices the tier is drawing a thumbnail for right now. */
  readonly drawnStars: readonly number[]
  /** Live GPU bytes for the atlas and everything the focused card has uploaded (PRD 7.2). */
  readonly gpuBytes: { atlas: number; card: number }
  /** The plane the camera is at, or `null` at multiverse level. */
  setPlane: (plane: PlaneRecord | null) => void
  /** The focused plane's cards. Arrives with the plane's shards (PRD 8.7.6). */
  setCards: (cards: PlaneCards) => void
  /** PRD 5.6.1: focusing a card shows it; releasing focus hides it. `-1` is no focus. */
  setFocusedStar: (star: number) => void
  setReducedMotion: (reduced: boolean) => void
  /** PRD 8.5.11's third rung. Applied through `setCapacity`: the ladder steps the tier, not restarts it. */
  setThumbnailCapacity: (capacity: number) => void
  /** The planet under the pointer, or -1 (PRD 5.6.9). */
  setHoveredPlanet: (planet: number) => void
  dispose: () => void
}

export interface CardTierOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  readonly resources: SceneResources
  readonly nav: SceneNavigation
  readonly labelState: PlanetLabelState
}

export function attachCardTier({
  gl,
  scene,
  camera,
  loop,
  resources,
  nav,
  labelState,
}: CardTierOptions): CardTierHandle {
  const canvas = gl.domElement
  const queue = new ImageQueue()
  const tier = new ThumbnailTier(resources.geometry, resources.table, queue, 0)
  const card = new FocusedCard(queue)

  let plane: PlaneRecord | null = null
  let cards: PlaneCards = { get: () => null }
  /** PRD 7.3.2: built once per card set rather than per tick. */
  let cardIndex = { firstPrintingOf: (star: number) => cards.get(star)?.p[0] ?? null }
  let focusedStar = -1
  let reducedMotion = false
  let hoveredPlanet = -1
  let disposed = false

  const cardPosition = new Vector3()
  const cameraPosition = new Vector3()
  const forward = new Vector3()
  const projected = new Vector3()
  // Mutable behind a `SelectorView` view of it: the selector only reads, and rebuilding this
  // object every tick is the allocation PRD 7.3.2 rules out.
  const view = { position: cameraPosition, forward, sizeScale: 1, pixelRatio: 1 }
  const selectorView: SelectorView = view
  const pointer = { x: 0, y: 0, inside: false }
  /**
   * The canvas's CSS size, kept by a `ResizeObserver` rather than measured in the frame callback
   * (DEC-692 R11).
   *
   * PRD 5.6.9's hover label needs it to turn a projected NDC position into a pixel offset, and it
   * was calling `getBoundingClientRect()` from inside `useFrame` to get it — a forced synchronous
   * layout, on the frame path, on every frame the pointer was over a planet. The canvas is the only
   * element whose box matters and it changes only when it is resized, so observing it is both
   * cheaper and exact.
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

  scene.add(tier.mesh, tier.pickMesh, card.root)

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
    camera.getWorldDirection(forward)
    view.sizeScale = gl.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360))
    view.pixelRatio = gl.getPixelRatio()

    // Every tick, focused or not: a decoded image that arrives as focus is released still has to
    // reach the GPU and let its bitmap go.
    card.flushUploads(gl)

    tier.update(delta, gl, nav.rig.motion, plane, selectorView, cardIndex, motionScale, focusedStar)

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
    get stats() {
      return tier.stats
    },
    get imageStats() {
      return queue.stats
    },
    get drawnStars() {
      return tier.drawnStars
    },
    get gpuBytes() {
      return { atlas: tier.atlas.gpuBytes, card: card.gpuBytes }
    },

    setPlane: (next) => {
      plane = next
    },
    setCards: (next) => {
      if (next === cards) return
      cards = next
      cardIndex = { firstPrintingOf: (star: number) => cards.get(star)?.p[0] ?? null }
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
    setThumbnailCapacity: (capacity) => {
      tier.setCapacity(capacity)
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
      scene.remove(tier.mesh, tier.pickMesh, card.root)
      tier.dispose()
      card.dispose()
      queue.dispose()
    },
  }
}
