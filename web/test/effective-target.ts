/**
 * The *effective* plane-level pick target, in screen space — one instrument, two subjects.
 *
 * §1.11 floors the plane-level pick proxy at 24 CSS px of diameter after projection. What a
 * pointer can actually reach is smaller than that wherever a nearer disk covers it, because
 * `scenePicker.ts` resolves overlap by nearest ray hit. This module measures the difference, and
 * it is shared rather than copied so that the two files asking about it cannot drift apart:
 *
 * - `pick-floor-screen-space.test.ts` (DEC-751) asks what the *floor* delivers, and pins the three
 *   claims §1.11 carries.
 * - `pick-target-separation.test.ts` (DEC-759) asks what the *layout* delivers, which is the only
 *   lever left once §1.11 has ruled the floor cannot deliver a target on its own.
 *
 * Two coverage rules, and the difference between them is the whole point:
 *
 * - **as-drawn** (`rRaw`) — neighbours claim only the disk they really draw. A loss under this
 *   rule is honest occlusion, and no pick policy recovers it. Only a layout change can.
 * - **floored** (`rFloored`) — neighbours claim their floored proxy too, which is what shipping
 *   §1.11 does. Floored proxies eat each other; that remainder is the floor's own.
 */

import { emptyTether } from '../src/camera/framing'
import { CameraRig } from '../src/camera/rig'
import { vec, type MutVec3 } from '../src/camera/vec'
import type { PlanesFile } from '../src/data/types'
import { BLIND_ETERNITIES_SLUG } from '../src/data/types'
import { createProjected, Projector } from '../src/labels/project'

/**
 * §1.3's reference viewport: 1080 rows at a 55 degree vertical fov.
 *
 * The floor is 24 CSS px whatever the viewport, so it is a *larger share of the screen* on a
 * shorter one and the separation a layout buys shrinks with it. Every number either file reports
 * is against this viewport, and neither of them may be read as a claim about another.
 */
export const REFERENCE_VIEWPORT = { viewportWidth: 1920, viewportHeight: 1080 } as const

/** `scenePicker.ts`'s `PLANE_PICK_MARGIN`. */
export const PLANE_PICK_MARGIN = 1.15

/** §1.11 / WCAG 2.5.8: 24 CSS px of diameter, so 12 px of radius. */
export const FLOOR_PX = 12

export interface Disk {
  readonly slug: string
  readonly x: number
  readonly y: number
  readonly depth: number
  /** The proxy the world actually draws, in px of radius. */
  readonly rRaw: number
  /** The same proxy after §1.11's floor. */
  readonly rFloored: number
  readonly isWorld: boolean
}

export type CoverageRule = 'rRaw' | 'rFloored'

/** The worlds — the moons and the belt are pickable but are not this measurement's subject. */
export function worldSlugs(planes: PlanesFile): ReadonlySet<string> {
  return new Set(
    planes.planes
      .filter((plane) => plane.kind === 'spiral' || plane.kind === 'irregular')
      .map((plane) => plane.slug),
  )
}

/** One home-view frame, with the multiverse turned to `angleRad` and the clock pinned at zero. */
export function readAt(
  planes: PlanesFile,
  angleRad: number,
  viewport: { viewportWidth: number; viewportHeight: number } = REFERENCE_VIEWPORT,
): Disk[] {
  const worlds = worldSlugs(planes)
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)
  rig.motion.syncClock(0, angleRad)

  const projector = new Projector()
  projector.update({
    position: rig.position,
    target: rig.lookAt,
    fov: (55 * Math.PI) / 180,
    near: 0.1,
    ...viewport,
  })

  const point: MutVec3 = vec()
  const projected = createProjected()
  const out: Disk[] = []
  // The Blind Eternities is not a sphere and is skipped by the picker for the same reason.
  for (const plane of planes.planes) {
    if (plane.slug === BLIND_ETERNITIES_SLUG) continue
    rig.motion.planePosition(point, plane)
    projector.project(projected, point)
    const rRaw = projector.radiusPx(plane.radius * PLANE_PICK_MARGIN, projected.depth)
    out.push({
      slug: plane.slug,
      x: projected.x,
      y: projected.y,
      depth: projected.depth,
      rRaw,
      rFloored: Math.max(rRaw, FLOOR_PX),
      isWorld: worlds.has(plane.slug),
    })
  }
  return out
}

/** A full turn of the multiverse, `azimuths` frames of it. */
export function sweepAzimuths(
  planes: PlanesFile,
  azimuths: number,
  viewport?: { viewportWidth: number; viewportHeight: number },
): Disk[][] {
  return Array.from({ length: azimuths }, (_, i) =>
    readAt(planes, (i * 2 * Math.PI) / azimuths, viewport),
  )
}

/**
 * The fraction of `a`'s floored proxy the picker would award to `a`, by area sampling.
 *
 * Only strictly nearer disks can take a pixel, which is `scenePicker.ts`'s nearest-hit resolution
 * written in screen space.
 */
export function effectiveFraction(a: Disk, all: readonly Disk[], rule: CoverageRule): number {
  const N = 48
  let inside = 0
  let mine = 0
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const px = a.x + ((i + 0.5) / N - 0.5) * 2 * a.rFloored
      const py = a.y + ((j + 0.5) / N - 0.5) * 2 * a.rFloored
      if (Math.hypot(px - a.x, py - a.y) > a.rFloored) continue
      inside += 1
      let taken = false
      for (const b of all) {
        if (b === a || b.depth >= a.depth) continue
        if (Math.hypot(px - b.x, py - b.y) <= b[rule]) {
          taken = true
          break
        }
      }
      if (!taken) mine += 1
    }
  }
  return inside === 0 ? 1 : mine / inside
}

/**
 * A disk holding this fraction of a proxy, expressed back as a diameter.
 *
 * `proxyPx` is the disk's own floored radius rather than the 12 px constant: for a world the floor
 * lifts they are the same number, but a world that already clears 24 px has a larger target to
 * lose, and reading it against the constant would understate the loss.
 */
export function effectiveDiameterPx(fraction: number, proxyPx: number): number {
  return 2 * proxyPx * Math.sqrt(fraction)
}
