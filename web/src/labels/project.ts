/**
 * CPU-side projection for the label overlay (PRD 8.4.4).
 *
 * "Labels are positioned each frame by CPU-side projection of plane centres (~80 points), never by
 * per-star work." This is that projection, written out rather than delegated to three.js for two
 * reasons: it has to run in Node so the collision rules can be tested against fixture-scale's 83
 * planes without a GPU, and PRD 7.3.2 forbids the per-frame `Vector3` allocation the convenient
 * spelling would cost.
 *
 * The overlay component feeds it the R3F camera's own position, target and fov, so there is one
 * projection in the product and the test exercises the same one the browser runs.
 */

import type { MutVec3 } from '../camera/vec'
import { cross, dot, normalise, set, sub, vec } from '../camera/vec'

export interface ProjectionView {
  readonly position: Readonly<MutVec3>
  readonly target: Readonly<MutVec3>
  /** Vertical field of view in radians. */
  readonly fov: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly near: number
}

export interface Projected {
  x: number
  y: number
  /** Distance along the view direction. The depth PRD 5.3.11's occlusion test compares. */
  depth: number
  onScreen: boolean
}

/**
 * A camera basis, rebuilt once per frame rather than per point. Allocation-free after construction.
 */
export class Projector {
  private readonly forward: MutVec3 = vec()
  private readonly right: MutVec3 = vec()
  private readonly up: MutVec3 = vec()
  private readonly rel: MutVec3 = vec()
  private readonly worldUp: MutVec3 = vec(0, 1, 0)
  private eye: Readonly<MutVec3> = vec()
  private halfHeight = 1
  private halfWidth = 1
  private pixelsPerUnitAtUnitDepth = 1
  private near = 0.1

  update(view: ProjectionView): void {
    this.eye = view.position
    this.near = view.near
    sub(this.forward, view.target, view.position)
    normalise(this.forward, this.forward)
    // Degenerate when the camera looks straight down its own up axis; the rig's polar clamp keeps
    // it out of that corner, and this is the belt to that pair of braces.
    cross(this.right, this.forward, this.worldUp)
    if (dot(this.right, this.right) < 1e-12) set(this.right, 1, 0, 0)
    normalise(this.right, this.right)
    cross(this.up, this.right, this.forward)
    normalise(this.up, this.up)

    this.halfWidth = view.viewportWidth / 2
    this.halfHeight = view.viewportHeight / 2
    // One world unit at one unit of depth covers this many pixels vertically.
    this.pixelsPerUnitAtUnitDepth = this.halfHeight / Math.tan(view.fov / 2)
  }

  /** Project a world point into CSS pixels, with the origin at the top-left of the viewport. */
  project(out: Projected, point: Readonly<MutVec3>): Projected {
    sub(this.rel, point, this.eye)
    const depth = dot(this.rel, this.forward)
    out.depth = depth
    if (depth <= this.near) {
      out.x = 0
      out.y = 0
      out.onScreen = false
      return out
    }
    const scale = this.pixelsPerUnitAtUnitDepth / depth
    out.x = this.halfWidth + dot(this.rel, this.right) * scale
    // Screen y grows downwards; the camera's up does not.
    out.y = this.halfHeight - dot(this.rel, this.up) * scale
    // A generous margin: a label anchored just off screen can still have its box on screen.
    const margin = 160
    out.onScreen =
      out.x > -margin &&
      out.x < this.halfWidth * 2 + margin &&
      out.y > -margin &&
      out.y < this.halfHeight * 2 + margin
    return out
  }

  /** On-screen radius, in pixels, of a sphere of `radius` world units at `depth`. */
  radiusPx(radius: number, depth: number): number {
    if (depth <= this.near) return 0
    return (radius * this.pixelsPerUnitAtUnitDepth) / depth
  }
}

export function createProjected(): Projected {
  return { x: 0, y: 0, depth: 0, onScreen: false }
}
