/**
 * PRD 8.5.6's two halves, joined: "Planes at multiverse level are picked on the CPU by raycasting
 * against invisible bounding spheres (~80 objects), with the id buffer taking precedence when it
 * hits."
 *
 * A plane's bounding sphere is a target the size of a galaxy and a star is a target one pixel
 * across, so the two cannot be the same mechanism. The precedence rule is what makes them one
 * gesture: click anywhere on Dominaria and you get Dominaria, unless you clicked a star, in which
 * case you get the star.
 *
 * Every method here is allocation-free — this runs on pointer move (PRD 7.3.2).
 */

import { Ray, Sphere, Vector2, Vector3, type PerspectiveCamera } from 'three'

import { PlaneKindCode, planeWorldPosition } from '../starfield/motion'
import type { PlaneTable } from '../starfield/planeTable'

export type PickResult =
  | { readonly kind: 'star'; readonly index: number; readonly planeIndex: number }
  | { readonly kind: 'plane'; readonly index: number }
  | null

/**
 * How much bigger than its visual radius a plane's pick sphere is. A galaxy's outer stars are
 * faint, and a click just past them should still read as "that plane" rather than as empty space.
 */
const PLANE_PICK_MARGIN = 1.15

export class PlanePicker {
  private readonly ray = new Ray()
  private readonly sphere = new Sphere()
  private readonly hit = new Vector3()
  private readonly origin = new Vector3()
  private readonly direction = new Vector3()

  /**
   * The nearest plane whose bounding sphere the pointer ray enters, or `-1`.
   *
   * `ndc` is the pointer in normalised device coordinates. The Blind Eternities is skipped: its
   * radius is the whole multiverse, so a sphere test would swallow every click. Dust is picked as
   * stars are, through the id buffer, which is also what gives PRD 5.3.4 the anchor point.
   */
  pick(ndc: Vector2, camera: PerspectiveCamera, table: PlaneTable, motion: number): number {
    this.origin.setFromMatrixPosition(camera.matrixWorld)
    this.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(this.origin).normalize()
    this.ray.set(this.origin, this.direction)

    let best = -1
    let bestDistance = Infinity
    for (let row = 0; row < table.planes.length; row += 1) {
      const state = table.planes[row]!
      // Not yet faded in means not yet clickable, and the dust is not a sphere.
      if (state.fade <= 0.5 || state.kind === PlaneKindCode.Dust) continue

      // `Vector3` is a `MutableVec3`, so the mirror writes straight into the sphere.
      planeWorldPosition(
        table.raw,
        row,
        table.time,
        table.multiverseAngle,
        motion,
        this.sphere.center,
      )
      this.sphere.radius = state.record.radius * PLANE_PICK_MARGIN

      if (this.ray.intersectSphere(this.sphere, this.hit) === null) continue
      const distance = this.hit.distanceToSquared(this.origin)
      if (distance < bestDistance) {
        bestDistance = distance
        best = row
      }
    }
    return best
  }
}
