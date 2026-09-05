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

import { PLANET_ID_BASE } from '../cards/focusedCard'
import { PlaneKindCode, planeWorldPosition } from '../starfield/motion'
import type { PlaneTable } from '../starfield/planeTable'
import { PICK_BUSY } from './idPicker'

export type PickResult =
  | { readonly kind: 'star'; readonly index: number; readonly planeIndex: number }
  | { readonly kind: 'plane'; readonly index: number }
  /** PRD 5.6.9: a printing's planet, orbiting the focused card. */
  | { readonly kind: 'planet'; readonly index: number }
  | null

/**
 * The precedence rule itself, as one function over an id-buffer answer.
 *
 * `undefined` — distinct from the `null` that means "empty space" — is "the id buffer was not
 * consulted". The plane raycast is deliberately a thunk so that this case cannot run it: a
 * `PICK_BUSY` treated as a miss is how a click on a star used to come back as its plane, and the
 * raycaster is the thing that must not be reached.
 *
 * Phase 3 added two writers to the same id buffer, and neither needs a branch here:
 *
 *  - a **thumbnail** writes its own star's id, because PRD 5.6.1 makes clicking a star and clicking
 *    the thumbnail it cross-faded into the same act. It arrives as a star and is one;
 *  - a **planet** writes an id above {@link PLANET_ID_BASE}, which no dataset's star count can
 *    reach, so the two ranges cannot be confused for one another.
 */
export function resolvePick(
  starIndex: number,
  drawCount: number,
  planeRowOf: (index: number) => number,
  pickPlane: () => number,
): PickResult | undefined {
  if (starIndex === PICK_BUSY) return undefined
  if (starIndex >= PLANET_ID_BASE) {
    return { kind: 'planet', index: starIndex - PLANET_ID_BASE }
  }
  if (starIndex >= 0 && starIndex < drawCount) {
    return { kind: 'star', index: starIndex, planeIndex: planeRowOf(starIndex) }
  }
  const planeIndex = pickPlane()
  return planeIndex >= 0 ? { kind: 'plane', index: planeIndex } : null
}

/**
 * Whether two picks are the same thing under the pointer — the whole of hover's change detection.
 *
 * It has to compare the **kind** as well as the index, and that is not a nicety. Phase 3 put three
 * kinds in this buffer and the scene deduplicated on the star index alone, mapping everything else
 * to `-1`: a planet and a plane and empty space were one state, so `onHover` fired for a planet
 * only if the previous pick happened to be a star. PRD 5.6.9's hover label then never appeared on
 * arrival from empty space, never changed between two planets, and never cleared on leaving — and
 * because the click path reads the label's planet, clicking one activated whatever printing the
 * stale label still named.
 */
export function samePick(a: PickResult, b: PickResult): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.index === b.index
}

/** The star index a pick names, or -1. Only a star has one; a thumbnail arrives *as* its star. */
export function pickedStarIndex(pick: PickResult): number {
  return pick?.kind === 'star' ? pick.index : -1
}

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
