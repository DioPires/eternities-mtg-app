/**
 * The card tier inside the R3F canvas: the thumbnail layer, the focused card and its planets, all
 * advanced from one per-frame callback (PRD 5.5, 5.6).
 *
 * This is the Phase 3 sibling of `scene/StarScene`, and it follows the same rule: one `useFrame`,
 * preallocated state, no allocation in the frame path (PRD 7.3.2). What it adds to the scene graph
 * is four objects — the thumbnail mesh and its pick twin, and the card group with its planets —
 * and what it adds to the frame is one selector pass every 200 ms, one instance rebuild, and the
 * card's springs.
 *
 * It computes exactly one star position on the CPU per frame: the focused card's, through the same
 * `starWorldPosition` the vertex shader runs. That is PRD 8.5.7's single permitted mirror, and it is
 * why the card sits on its star rather than near it while the plane turns underneath.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useImperativeHandle, useMemo, useRef, type ReactElement, type Ref } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'

import type { CardRecord, PlaneRecord } from '../../data/types'
import type { SceneNavigation } from '../../navigation/scene'
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
 * A mutable object written by the frame loop and read by the overlay's own `requestAnimationFrame`,
 * exactly as the plane labels work (PRD 7.3.3, `labels/PlaneLabels`): a hover must not cost a React
 * render, and the label must not be a frame behind the planet.
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
}

export interface CardTierProps {
  readonly resources: SceneResources
  readonly nav: SceneNavigation
  /** The plane the camera is at, or `null` at multiverse level. */
  readonly plane: PlaneRecord | null
  readonly cards: PlaneCards
  /** The star the card level is focused on, or -1. */
  readonly focusedStar: number
  readonly reducedMotion: boolean
  /** PRD 8.5.11's third degradation step. */
  readonly thumbnailCapacity: number
  /** The planet under the pointer, or -1 (PRD 5.6.9). */
  readonly hoveredPlanet: number
  readonly labelState: PlanetLabelState
  readonly handleRef?: Ref<CardTierHandle>
}

export function CardTier({
  resources,
  nav,
  plane,
  cards,
  focusedStar,
  reducedMotion,
  thumbnailCapacity,
  hoveredPlanet,
  labelState,
  handleRef,
}: CardTierProps): ReactElement {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)

  const queue = useMemo(() => new ImageQueue(), [])
  const tier = useMemo(
    () => new ThumbnailTier(resources.geometry, resources.table, queue, thumbnailCapacity),
    // Rebuilt only with the scene itself. `thumbnailCapacity` is applied through `setCapacity`
    // below rather than by reconstruction: PRD 8.5.11 steps quality, it does not restart the tier.
    [resources, queue],
  )
  const card = useMemo(() => new FocusedCard(queue), [queue])
  // PRD 7.3.2: built once per card set rather than per frame.
  const cardIndex = useMemo(
    () => ({ firstPrintingOf: (star: number) => cards.get(star)?.p[0] ?? null }),
    [cards],
  )

  const cardPosition = useRef(new Vector3()).current
  const cameraPosition = useRef(new Vector3()).current
  const forward = useRef(new Vector3()).current
  const projected = useRef(new Vector3()).current
  // Mutable behind a `SelectorView` view of it: the selector only reads, and rebuilding this
  // object every frame is the allocation PRD 7.3.2 rules out.
  const view = useRef({
    position: cameraPosition,
    forward,
    sizeScale: 1,
    pixelRatio: 1,
  }).current
  const selectorView: SelectorView = view
  const pointer = useRef({ x: 0, y: 0, inside: false }).current
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
  const canvasBox = useRef({ width: 0, height: 0 }).current

  useEffect(() => {
    tier.setCapacity(thumbnailCapacity)
  }, [tier, thumbnailCapacity])

  useEffect(
    () => () => {
      tier.dispose()
      card.dispose()
      queue.dispose()
    },
    [tier, card, queue],
  )

  // The canvas's CSS box, for the hover label's projection. `ResizeObserver` fires once on
  // observation, so the initial size comes from the same path the later ones do.
  useEffect(() => {
    const canvas = gl.domElement
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect()
      canvasBox.width = rect.width
      canvasBox.height = rect.height
    })
    observer.observe(canvas)
    return () => {
      observer.disconnect()
    }
  }, [gl, canvasBox])

  // PRD 5.6.3: the tilt follows the pointer. On the canvas rather than in React, because a pointer
  // move must not cost a render (PRD 7.3.3).
  useEffect(() => {
    const canvas = gl.domElement
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
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [gl, pointer])

  // PRD 5.6.1: focusing a card shows it; releasing focus hides it. The record arrives with the
  // plane's shards, so this runs again when they land.
  useEffect(() => {
    if (focusedStar < 0) {
      card.hide()
      return
    }
    const record = cards.get(focusedStar)
    if (!record) return
    card.show(record, focusedStar, resources.geometry.hueClassOf(focusedStar))
  }, [card, cards, focusedStar, resources])

  useEffect(() => {
    card.setHoveredPlanet(hoveredPlanet)
  }, [card, hoveredPlanet])

  useImperativeHandle(
    handleRef,
    (): CardTierHandle => ({
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
    }),
    [card, tier, queue],
  )

  useFrame((_, delta) => {
    const perspective = camera as PerspectiveCamera
    const motionScale = reducedMotion ? 0 : 1

    camera.getWorldPosition(cameraPosition)
    camera.getWorldDirection(forward)
    view.sizeScale =
      gl.domElement.height / (2 * Math.tan(((perspective.fov ?? 55) * Math.PI) / 360))
    view.pixelRatio = gl.getPixelRatio()

    // Every frame, focused or not: a decoded image that arrives as focus is released still has to
    // reach the GPU and let its bitmap go.
    card.flushUploads(gl)

    tier.update(
      delta,
      gl,
      nav.rig.motion,
      plane,
      selectorView,
      cardIndex,
      motionScale,
      focusedStar,
    )

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
        projected.project(perspective)
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

  return (
    <>
      <primitive object={tier.mesh} />
      <primitive object={tier.pickMesh} />
      <primitive object={card.root} />
    </>
  )
}
