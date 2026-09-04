/**
 * Screen-space plane picking, for the Phase 2b harness.
 *
 * PRD 8.5.6 gives plane picking to Phase 2a: "planes at multiverse level are picked on the CPU by
 * raycasting against invisible bounding spheres (~80 objects), with the id buffer taking
 * precedence when it hits." This is not that. It is the smallest thing that lets a person click a
 * plane and watch the camera fly to it, so that PRD 9.3's checkpoints could be reviewed before 2a
 * landed — and it goes when 2a's picking layer arrives.
 *
 * It picks in screen space rather than with a ray because the projector is already there and
 * already agrees with the labels: what the user aims at is the glow *and the label* they can see,
 * which is the behaviour a ray against a bounding sphere is trying to approximate anyway.
 */

import type { CameraRig } from '../camera/rig'
import { vec } from '../camera/vec'
import type { PlaneRecord } from '../data/types'
import { BLIND_ETERNITIES_SLUG } from '../data/types'
import { createProjected, Projector } from '../labels/project'

/** A plane smaller than this on screen is still clickable; PRD 5.3.6's dim glows are tiny. */
const MIN_PICK_RADIUS_PX = 14

const point = vec()
const projected = createProjected()

export function pickPlane(
  x: number,
  y: number,
  rig: CameraRig,
  projector: Projector,
): PlaneRecord | null {
  let best: PlaneRecord | null = null
  let bestDepth = Number.POSITIVE_INFINITY

  for (const plane of rig.motion.planes) {
    if (plane.slug === BLIND_ETERNITIES_SLUG) continue
    rig.motion.planePosition(point, plane)
    projector.project(projected, point)
    if (!projected.onScreen) continue
    const radius = Math.max(projector.radiusPx(plane.radius, projected.depth), MIN_PICK_RADIUS_PX)
    const dx = projected.x - x
    const dy = projected.y - y
    if (dx * dx + dy * dy > radius * radius) continue
    // Nearest wins, so a plane in front of another is the one you get.
    if (projected.depth < bestDepth) {
      bestDepth = projected.depth
      best = plane
    }
  }
  return best
}

export function createPickProjector(): Projector {
  return new Projector()
}
