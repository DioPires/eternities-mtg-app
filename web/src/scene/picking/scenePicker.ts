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

/**
 * Worlds spec §1.11, normative: the plane-level pick proxy is floored at **24 CSS px of diameter**,
 * after projection, per frame, per plane.
 *
 * **Why a screen-space floor rather than a bigger radius.** Under §1.3's radius law 26 of v3's 45
 * worlds project below 24 px of pick diameter at the home view — the smallest at 3.8 px, where the
 * galaxy today has none under 24. §1.3 rules out raising the world-space floor to chase a pixel
 * target, and is right to: the rescale is non-uniform (1.07× on Dominaria against 6.55× on a
 * one-card world), so no world-space constant absorbs it. A pixel target has to be spelled in
 * pixels.
 *
 * **What it guarantees, and what it does not.** A 24 px *proxy*, not a 24 px *target*. Floored
 * proxies overlap each other and {@link PlanePicker.pick} awards a pixel to the nearest disk, so a
 * world in a crowd keeps less than its proxy: measured over a turn, 19 of the 33 worlds the floor
 * lifts fall under 24 px of *effective* diameter somewhere, and the floor pushes two worlds that
 * already cleared 24 px below it. §1.11 records those as residual exposure rather than as a
 * guarantee, rules out the Voronoi tie-break that would only move the shortfall around (screen area
 * is conserved), and rests conformance on WCAG 2.5.8's **Equivalent** exception — every plane is
 * reachable by name through the search path. The floor is a usability improvement on top of that,
 * and what it is *not* allowed to do is bury a world that was pickable before, which is the
 * property `test/pick-floor-screen-space.test.ts` measures.
 *
 * Applied to every pickable plane rather than only to the 45 worlds: the empty planes and the moons
 * shrink under the same law, they are the same gesture, and it is the configuration the measurement
 * above was made in. On a v2 dataset it is inert — nothing there projects under 24 px — so it costs
 * the galaxy nothing before the cutover.
 */
export const PLANE_PICK_FLOOR_PX = 24

/**
 * The world-space radius that projects to {@link PLANE_PICK_FLOOR_PX} of diameter at `depth`.
 *
 * `labels/project.ts`'s projection, inverted: one world unit at one unit of depth covers
 * `halfHeight / tan(fov / 2)` pixels, so a pixel radius `r` needs `r · depth · tan(fov/2) /
 * halfHeight` world units. **CSS pixels** — which is why the caller passes the renderer's
 * `getSize` height and never its drawing-buffer height. On a 2× display the two differ by a factor
 * of two, and the wrong one halves or doubles the floor while every picture stays correct, which is
 * the same trap §1.5's crossover band carries (`attachWorlds`'s viewport note).
 *
 * A depth behind the camera has no projection, so it floors to nothing.
 */
export function planePickFloorRadius(
  depth: number,
  fovRadians: number,
  viewportHeightPx: number,
): number {
  if (depth <= 0 || viewportHeightPx <= 0) return 0
  return ((PLANE_PICK_FLOOR_PX / 2) * depth * Math.tan(fovRadians / 2)) / (viewportHeightPx / 2)
}

export class PlanePicker {
  private readonly ray = new Ray()
  private readonly sphere = new Sphere()
  private readonly hit = new Vector3()
  private readonly origin = new Vector3()
  private readonly direction = new Vector3()
  private readonly forward = new Vector3()
  private readonly toCentre = new Vector3()

  /**
   * The nearest plane whose bounding sphere the pointer ray enters, or `-1`.
   *
   * `ndc` is the pointer in normalised device coordinates. The Blind Eternities is skipped: its
   * radius is the whole multiverse, so a sphere test would swallow every click. Dust is picked as
   * stars are, through the id buffer, which is also what gives PRD 5.3.4 the anchor point.
   *
   * `viewportHeightPx` is the viewport in **CSS** pixels, and it is required rather than optional
   * because it is what §1.11's floor is expressed in: a default would let a caller silently switch
   * the floor off, and a pick target that is quietly 3.8 px looks exactly like one that is 24.
   */
  pick(
    ndc: Vector2,
    camera: PerspectiveCamera,
    table: PlaneTable,
    motion: number,
    viewportHeightPx: number,
  ): number {
    this.origin.setFromMatrixPosition(camera.matrixWorld)
    this.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(this.origin).normalize()
    this.ray.set(this.origin, this.direction)
    // The view axis, for the depth §1.11's floor is a function of. Column 2 of the camera's world
    // matrix is its +Z, and a camera looks down its own -Z.
    this.forward.setFromMatrixColumn(camera.matrixWorld, 2).negate()
    const fovRadians = (camera.fov * Math.PI) / 180

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
      // §1.11's floor, applied to the proxy and to nothing else: the drawn world is untouched, so
      // §1.3's radius law and §1.8's moon relationship are exactly as they were.
      const depth = this.toCentre.subVectors(this.sphere.center, this.origin).dot(this.forward)
      this.sphere.radius = Math.max(
        state.record.radius * PLANE_PICK_MARGIN,
        planePickFloorRadius(depth, fovRadians, viewportHeightPx),
      )

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
