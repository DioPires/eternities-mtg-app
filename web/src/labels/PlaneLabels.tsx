/**
 * The label overlay (PRD 5.3.8–12, 5.4.5, 8.4.4).
 *
 * "One HTML layer for HUD, panels, search, labels, and hints. Labels are positioned each frame by
 * CPU-side projection of plane centres (~80 points), never by per-star work."
 *
 * The layer sits *outside* the canvas, which is what PRD 8.4.4 asks for and also why this uses a
 * plain `requestAnimationFrame` rather than R3F's `useFrame`: HTML cannot live inside the R3F tree.
 * It reads the rig the canvas is already advancing, so the two stay on the same frame.
 *
 * The React part runs once: one `<div>` per plane, created when `planes.json` lands and never
 * re-rendered. Every frame after that writes `transform` and `opacity` straight onto the DOM nodes
 * through refs — PRD 7.3.3 forbids layout-triggering style changes per frame, and re-rendering one
 * React element per roster plane at 60 fps would be exactly that. Both of those are composited;
 * `fontSize` is the one style here that is not, so it is written only when it changes.
 * `will-change: transform` keeps the nodes on their own compositor layers.
 *
 * The chronology-band labels of PRD 5.4.5 share the layer and the same collision solver, at lower
 * priority, so a band label can never displace a plane name.
 */

import { useEffect, useMemo, useRef, type ReactElement } from 'react'

import type { CameraRig } from '../camera/rig'
import { vec, type MutVec3 } from '../camera/vec'
import type { PlaneRecord, PlanesFile } from '../data/types'
import { BLIND_ETERNITIES_SLUG } from '../data/types'
import type { Level } from '../navigation/types'

import { layoutLabels, type LabelCandidate, type LabelPlacement } from './layout'
import { createProjected, Projector } from './project'

export interface PlaneLabelsProps {
  readonly planes: PlanesFile
  readonly rig: CameraRig
  /** PRD 5.4.15: at plane level this plane's name moves to the HUD and the rest fade out. */
  readonly focusedPlaneSlug: string | null
  readonly level: Level
  /** PRD 6.10.1's labels on/off setting. */
  readonly enabled?: boolean
  /** Vertical field of view in degrees; must match the canvas camera's. */
  readonly fov?: number
}

/** A mutable candidate record, reused every frame (PRD 7.3.2). */
interface MutableCandidate {
  key: string
  text: string
  sub: string | null
  tier: 'plane' | 'band'
  priority: number
  x: number
  y: number
  radiusPx: number
  depth: number
  onScreen: boolean
  widthPx: number
}

function candidateFor(plane: PlaneRecord): MutableCandidate {
  return {
    key: plane.slug,
    text: plane.displayName,
    // PRD 5.3.12: the card count sits beneath the name, and a zero-card plane shows none.
    sub: plane.cardCount > 0 ? `${plane.cardCount}` : null,
    tier: 'plane',
    priority: plane.cardCount,
    x: 0,
    y: 0,
    radiusPx: 0,
    depth: 0,
    onScreen: false,
    widthPx: 0,
  }
}

export function PlaneLabels({
  planes,
  rig,
  focusedPlaneSlug,
  level,
  enabled = true,
  fov = 55,
}: PlaneLabelsProps): ReactElement {
  const nodes = useRef(new Map<string, HTMLDivElement | null>())
  // PRD 7.3.3: `fontSize` is the one style here that invalidates layout, and it tracks the plane's
  // on-screen radius, so it changes on nearly every moving frame — writing it unconditionally cost
  // 82 layout invalidations a frame. Writing it only when the rounded value actually changes keeps
  // the frame path to `transform` and `opacity`, which are composited.
  const fontPx = useRef(new Map<string, string>())
  const projector = useMemo(() => new Projector(), [])
  const projected = useMemo(() => createProjected(), [])
  const point = useMemo<MutVec3>(() => vec(), [])
  const placements = useMemo<LabelPlacement[]>(() => [], [])

  // PRD 5.3.4: the dust spans the whole multiverse and has no centre worth labelling; its name is
  // the HUD's job when it is focused.
  const labelled = useMemo(
    () => planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG),
    [planes],
  )
  const candidates = useMemo(() => labelled.map(candidateFor), [labelled])

  // The band labels of PRD 5.4.5, for the focused plane only — no other plane's bands are legible
  // from plane level, and the whole roster's worth of set names would be a wall of text.
  const bandCandidates = useMemo<MutableCandidate[]>(() => {
    const plane = labelled.find((p) => p.slug === focusedPlaneSlug)
    if (!plane) return []
    return plane.sets.map((set, index) => ({
      key: `${plane.slug}:${set.code}`,
      text: set.name,
      sub: `${set.year}`,
      tier: 'band' as const,
      // Newest bands are at the rim and read first, so they win ties among themselves.
      priority: index,
      x: 0,
      y: 0,
      radiusPx: 0,
      depth: 0,
      onScreen: false,
      widthPx: 0,
    }))
  }, [labelled, focusedPlaneSlug])

  const all = useMemo(
    () => [...candidates, ...bandCandidates] as LabelCandidate[],
    [candidates, bandCandidates],
  )

  // One frame of work, hoisted out of the effect so the dependency list stays honest.
  const frameRef = useRef<() => void>(() => {})
  frameRef.current = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight
    projector.update({
      position: rig.position,
      target: rig.lookAt,
      fov: (fov * Math.PI) / 180,
      near: 0.1,
      viewportWidth: width,
      viewportHeight: height,
    })

    for (let i = 0; i < candidates.length; i += 1) {
      const plane = labelled[i]!
      const candidate = candidates[i]!
      rig.motion.planePosition(point, plane)
      projector.project(projected, point)
      candidate.x = projected.x
      candidate.y = projected.y
      candidate.depth = projected.depth
      candidate.onScreen = projected.onScreen
      candidate.radiusPx = projector.radiusPx(plane.radius, projected.depth)
    }

    const focused = labelled.find((p) => p.slug === focusedPlaneSlug)
    if (focused && bandCandidates.length > 0) {
      rig.motion.planePosition(point, focused)
      projector.project(projected, point)
      // PRD 8.6.2: the bands fill the unit disc, so band `k` of `n` sits at radius
      // `(k + 0.5) / n` of the plane's own radius, and one band is `1 / n` of it wide.
      const bands = bandCandidates.length
      const bandWidth = projector.radiusPx(focused.radius / bands, projected.depth)
      for (let i = 0; i < bandCandidates.length; i += 1) {
        const band = bandCandidates[i]!
        const bandRadiusPx = projector.radiusPx(
          (focused.radius * (i + 0.5)) / bands,
          projected.depth,
        )
        band.x = projected.x
        band.y = projected.y + bandRadiusPx
        band.depth = projected.depth
        band.onScreen = projected.onScreen
        band.radiusPx = 0
        // PRD 5.4.5: shown only when the band is ≥ 120 px wide on screen.
        band.widthPx = bandWidth
      }
    }

    const count = layoutLabels(all, placements, {
      viewportWidth: width,
      viewportHeight: height,
      // PRD 5.4.15: at plane level and below, the multiverse's plane labels are gone.
      planeLevelFade: level === 'multiverse' ? 0 : 1,
      enabled,
    })

    // Two passes over the nodes: hide everything the solver dropped, then place what it kept.
    // Writing only `transform` and `opacity` keeps this off the layout path (PRD 7.3.3).
    for (const node of nodes.current.values()) {
      if (node) node.style.opacity = '0'
    }
    for (let i = 0; i < count; i += 1) {
      const placement = placements[i]!
      const node = nodes.current.get(placement.key)
      if (!node) continue
      node.style.transform = `translate3d(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px, 0) translate(-50%, -50%)`
      node.style.opacity = placement.opacity.toFixed(3)
      const font = `${placement.fontPx.toFixed(1)}px`
      if (fontPx.current.get(placement.key) !== font) {
        node.style.fontSize = font
        fontPx.current.set(placement.key, font)
      }
    }
  }

  useEffect(() => {
    let handle = requestAnimationFrame(function tick() {
      frameRef.current()
      handle = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(handle)
    }
  }, [])

  return (
    <div className="labels" aria-hidden="true">
      {all.map((candidate) => (
        <div
          key={candidate.key}
          className={candidate.tier === 'band' ? 'label label-band' : 'label'}
          ref={(node) => {
            nodes.current.set(candidate.key, node)
            // A fresh node carries no inline font size, so the cached value it would be compared
            // against is not what is on it.
            fontPx.current.delete(candidate.key)
          }}
        >
          <span className="label-name">{candidate.text}</span>
          {candidate.sub !== null && <span className="label-sub">{candidate.sub}</span>}
        </div>
      ))}
    </div>
  )
}
