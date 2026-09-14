/**
 * The label overlay (PRD 5.3.8–12, 5.4.5, 8.4.4).
 *
 * "One HTML layer for HUD, panels, search, labels, and hints. Labels are positioned each frame by
 * CPU-side projection of plane centres (~80 points), never by per-star work."
 *
 * The layer sits *outside* the canvas, which is what PRD 8.4.4 asks for. That used to force it onto
 * a `requestAnimationFrame` of its own — HTML cannot live inside an R3F tree, so it could not take a
 * `useFrame` — and **a second clock is what review §3.6 phase 3 came here to delete**. The browser
 * hands both callbacks the same timestamp but not the same position in the queue, and on a cold load
 * this one was registered first, so a label was routinely placed against the camera pose of the
 * *previous* frame. A label a frame behind the plane it names is PRD 5.3.8's whole complaint.
 *
 * It is now a subscriber to the loop's `labels` phase, which {@link TICK_PHASES} runs after `rig` —
 * the step in which `camera.updateMatrixWorld()` makes the matrices final. The two cannot disagree.
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
import { BLIND_ETERNITIES_SLUG, isWorldPlane } from '../data/types'
import type { Level } from '../navigation/types'
import type { FrameLoop } from '../scene/renderer/frameLoop'

import { layoutLabels, type LabelCandidate, type LabelPlacement } from './layout'
import { createProjected, Projector } from './project'

export interface PlaneLabelsProps {
  readonly planes: PlanesFile
  readonly rig: CameraRig
  /**
   * The loop this places labels on, at the `labels` phase. Required, not optional: an optional loop
   * would leave the private `requestAnimationFrame` alive as a fallback, and the second clock is
   * the defect. See the header.
   */
  readonly loop: FrameLoop
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
  loop,
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
  /**
   * The last values written to each node, so an unchanged label costs no string (DEC-692 R7).
   *
   * `transform` and `opacity` are composited, so writing them unconditionally was cheap for the
   * browser — but *building* them was not: two `toFixed` calls and a template literal per label per
   * frame, some 350 short-lived strings a frame on the production roster, on a path whose header
   * promises no allocation. The quantised numbers are compared instead and the strings built only
   * when one of them has actually moved: nothing at all while the camera is still, and nothing for
   * a label the solver has already faded out and left faded.
   */
  const written = useRef(
    new Map<string, { tx: number; ty: number; opacity: number; frame: number }>(),
  )
  /** Which frame last placed a label, so the hide pass can tell "dropped" from "moved". */
  const frameCount = useRef(0)
  /** Whether the last frame ran with labels off and has already blanked every node. */
  const blanked = useRef(false)
  const projector = useMemo(() => new Projector(), [])
  const projected = useMemo(() => createProjected(), [])
  const point = useMemo<MutVec3>(() => vec(), [])
  const placements = useMemo<LabelPlacement[]>(() => [], [])

  /**
   * The home view's subjects.
   *
   * PRD 5.3.4: the dust spans the whole multiverse and has no centre worth labelling; its name is
   * the HUD's job when it is focused. That is the whole rule on a v2 dataset — 87 of 88 planes.
   *
   * **On a worlds dataset the subject is the worlds (spec §1.11, DEC-751).** The moons are
   * unlabelled until hover (§1.8) and the belt is dropped before projection, so the count is
   * `worldsWithCards.length` — 45 on v3 — rather than the plane count. This is not cosmetic: the
   * solver seats a bounded number of labels per frame and `priority` only *orders* them, so the 42
   * moons are not competing for their own names, they are taking them from the worlds. Measured
   * over a turn, the 42 empty planes seat ~2,587 label-frames that the worlds would otherwise
   * have.
   *
   * Derived from the data, never from a version constant, for the reason §1.12 gives about its own
   * two dataset-dependent rows: a constant is right on exactly one of the two datasets this build
   * is guaranteed to meet. `isWorldPlane` tests `rowCells`, which §2.4 makes the field to test for
   * and which no v2 plane carries — so a v2 page finds no worlds and keeps PRD 5.3.4's rule
   * unchanged, and the galaxy's labelling is untouched until the cutover.
   */
  const labelled = useMemo(() => {
    const withoutBelt = planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG)
    const worlds = withoutBelt.filter(isWorldPlane)
    return worlds.length > 0 ? worlds : withoutBelt
  }, [planes])
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

  /**
   * Drop every label to `opacity: 0`. Idempotent: a node already at zero is skipped, so calling
   * this every frame after the first costs one map lookup per node and no style write.
   */
  const blankAll = (): void => {
    for (const [key, node] of nodes.current) {
      if (!node) continue
      const last = written.current.get(key)
      if (last?.opacity === 0) continue
      node.style.opacity = '0'
      if (last) last.opacity = 0
      else written.current.set(key, { tx: Number.NaN, ty: Number.NaN, opacity: 0, frame: 0 })
    }
  }

  // One frame of work, hoisted out of the effect so the dependency list stays honest.
  const frameRef = useRef<() => void>(() => {})
  frameRef.current = (): void => {
    // PRD 6.10.1's labels-off setting, taken at the top (DEC-695 N2). `layoutLabels` already
    // returns 0 for this case, but only *after* this function has projected all 86 plane anchors
    // and rebuilt the band candidates — every frame, for labels nobody can see. Blank once, then
    // do nothing at all until the setting comes back.
    if (enabled === false) {
      if (!blanked.current) {
        blankAll()
        blanked.current = true
      }
      return
    }
    blanked.current = false

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

    // Two passes over the nodes: place what the solver kept, then hide everything it dropped.
    // (The original order was the other way round, which meant every visible label was written
    // twice a frame — to 0 and then back — and cost a string each time.) Writing only `transform`
    // and `opacity` keeps this off the layout path (PRD 7.3.3); writing them only when the
    // quantised value has moved keeps it off the allocation path too.
    const frame = (frameCount.current += 1)
    for (let i = 0; i < count; i += 1) {
      const placement = placements[i]!
      const node = nodes.current.get(placement.key)
      if (!node) continue
      // Tenths of a pixel for the transform and thousandths for the opacity — exactly the
      // precision the strings carry, so two placements that round the same way are one write.
      const tx = Math.round(placement.x * 10)
      const ty = Math.round(placement.y * 10)
      const opacity = Math.round(placement.opacity * 1000)
      let last = written.current.get(placement.key)
      if (!last) {
        last = { tx: Number.NaN, ty: Number.NaN, opacity: Number.NaN, frame }
        written.current.set(placement.key, last)
      }
      last.frame = frame
      if (last.tx !== tx || last.ty !== ty) {
        node.style.transform = `translate3d(${(tx / 10).toFixed(1)}px, ${(ty / 10).toFixed(1)}px, 0) translate(-50%, -50%)`
        last.tx = tx
        last.ty = ty
      }
      if (last.opacity !== opacity) {
        node.style.opacity = (opacity / 1000).toFixed(3)
        last.opacity = opacity
      }
      const font = `${placement.fontPx.toFixed(1)}px`
      if (fontPx.current.get(placement.key) !== font) {
        node.style.fontSize = font
        fontPx.current.set(placement.key, font)
      }
    }
    for (const [key, node] of nodes.current) {
      if (!node) continue
      const last = written.current.get(key)
      if (last && (last.frame === frame || last.opacity === 0)) continue
      node.style.opacity = '0'
      if (last) last.opacity = 0
      else written.current.set(key, { tx: Number.NaN, ty: Number.NaN, opacity: 0, frame: 0 })
    }
  }

  // The `labels` phase, which runs after `rig` has finalised the camera matrices. `frameRef` is
  // reassigned on every render, so the subscription itself never needs to be — which is what keeps
  // a settings change from re-subscribing the label layer mid-flight.
  useEffect(() => loop.subscribe('labels', () => frameRef.current()), [loop])

  return (
    <div className="labels" aria-hidden="true">
      {all.map((candidate) => (
        <div
          key={candidate.key}
          className={candidate.tier === 'band' ? 'label label-band' : 'label'}
          /*
           * §3.1's gate seam (`gate-seam-contract.md` §2a, owed by R3 to leg G).
           *
           * W5 counts *world* labels, and the gate's predicate is `opacity > 0.05` — because this
           * overlay renders a div per candidate every frame and signals a drop through opacity
           * alone, so `querySelectorAll('.label').length` is the candidate count regardless. That
           * makes "which plane is this?" un-derivable from the DOM without this attribute: the
           * text is a display name, not a slug.
           *
           * The `tier` guard is load-bearing rather than tidy. A band's key is `${slug}:${code}`,
           * so without it every band label would answer to its plane's slug with a `:` glued on,
           * and a `[data-plane-slug]` sweep would count a focused plane's set names as worlds.
           */
          {...(candidate.tier === 'plane' ? { 'data-plane-slug': candidate.key } : {})}
          ref={(node) => {
            nodes.current.set(candidate.key, node)
            // A fresh node carries no inline styles, so the cached values they would be compared
            // against are not what is on it.
            fontPx.current.delete(candidate.key)
            written.current.delete(candidate.key)
          }}
        >
          <span className="label-name">{candidate.text}</span>
          {candidate.sub !== null && <span className="label-sub">{candidate.sub}</span>}
        </div>
      ))}
    </div>
  )
}
