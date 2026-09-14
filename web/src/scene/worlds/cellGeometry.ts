/**
 * The cell sheet's base geometry (spec §1.4): one `InstancedBufferGeometry` per world, one
 * subdivided quad, N instances.
 *
 * Two normative rules live here, and both of them fail *silently* when they are got wrong — which
 * is why each is pinned by a unit test rather than by a comment.
 *
 * **1. The quad follows the sphere.** A flat quad tangent at the cell centre is only a surface
 * patch while the cell is small. Its corner sits at `sqrt(lift^2 + alpha^2 + beta^2)` from the
 * world centre against the surface's 1 — 0.7% of the radius on Dominaria, 5.7% on Rabiah, 13.0% on
 * a 30-card world, and **265% at N = 1**, where the "cell" is a flat billboard 2.6x the globe it is
 * meant to tile. So the base geometry is a `(kLon + 1) x (kLat + 1)` vertex grid whose vertices are
 * placed *on* the sphere, and the residual error becomes each flat facet's **sag** between its four
 * vertices rather than the tangent plane's unbounded corner lift.
 *
 * **2. The winding is clockwise.** See {@link buildCellIndices}.
 *
 * The `(u, v)` grid is what this module emits; the spherical placement happens in the vertex
 * shader, because the base geometry is shared by every instance and only the instance knows its own
 * centre. The shader has everything it needs: `iNormal` gives `cos(theta_r)`, so the angular
 * half-extent is `iSize.lon / sin(theta_r)` and no attribute has to carry the angle twice.
 */

import { CELL_LIFT, cellSizeArc } from './surfaceLaw'

/**
 * The largest arc half-extent a single facet may span, in units of world radius.
 *
 * `acos(1 - 0.01/CELL_LIFT) / sqrt(2)`: the angle whose sag is 1% of the radius, divided by the
 * `sqrt(2)` that accounts for the two axes combining at a facet corner. Computed rather than
 * written as `0.0998` so that a change to {@link CELL_LIFT} cannot leave the tolerance behind.
 */
export const FACET_ARC_LIMIT = Math.acos(1 - 0.01 / CELL_LIFT) / Math.SQRT2

/**
 * The sphere's own envelope on a **subdivided** world's total facets: `4*PI / FACET_ARC_LIMIT^2`,
 * which is 1,262.08 and so **1,263** as an integer bound.
 *
 * The quantity it bounds is the world's whole sheet — `cardCount * kLon * kLat` — not one cell's
 * `kLon * kLat`. A world whose every cell sat exactly at the tolerance would reach it; the measured
 * worst case on the v3 roster is **1,130** (`ergamon` would be 512, `eldraine` 1,130), and the
 * roster's 45 worlds total 38,887 facets for 24,399 cells.
 *
 * > Assert this per world in the sheet's unit test, over the dataset under test. **A subdivided
 * > world that exceeds it is a `k` computed from the wrong axis** — which is the failure this bound
 * > exists to catch, since a `k` built from the *angular* rather than the arc half-extent
 * > over-subdivides the polar rows by `1/sin(theta)` and is otherwise invisible.
 *
 * > **Normative — the bound is over subdivided worlds only, and a gate that drops that qualifier
 * > goes RED on correct behaviour (DEC-749, measured on `c9468f1125bcddff`).** At `k = (1, 1)` a
 * > cell *is* one facet, so an unsubdivided world's total is its card count, and **four of v3's 45
 * > worlds exceed 1,263 legitimately**: dominaria (6,271), ravnica (2,304), innistrad (1,655) and
 * > new-phyrexia (1,405). That is not over-subdivision — it is a large world drawn at one quad per
 * > card, which is the geometry this whole section is trying to get back to. The envelope is a
 * > statement about how finely the sphere can be cut, and it binds only where cutting happens.
 */
export const SUB_QUAD_ENVELOPE = Math.ceil((4 * Math.PI) / (FACET_ARC_LIMIT * FACET_ARC_LIMIT))

/** One world's subdivision: the vertex grid is `(kLon + 1) x (kLat + 1)`. */
export interface Subdivision {
  readonly kLon: number
  readonly kLat: number
  /**
   * `kLon * kLat` — the facets **one cell** is drawn as.
   *
   * {@link SUB_QUAD_ENVELOPE} bounds `cardCount * subQuads`, the whole sheet, not this.
   */
  readonly subQuads: number
}

/** The facets a world's whole cell sheet is drawn as — the quantity {@link SUB_QUAD_ENVELOPE} bounds. */
export function worldFacets(rowCells: readonly number[], cardCount: number): number {
  return cardCount * subdivisionFor(rowCells).subQuads
}

/**
 * The subdivision for a world, from its **published** `rowCells` (§2.4) like every other
 * client-side derivation.
 *
 * `k` is the smallest integer pair holding every cell's facet sag within 1% of the radius, and it
 * is **one pair per world** because the sheet is already one draw per world. The longitudinal axis
 * takes the worst row — the arc half-extent `(PI / rowCells[r]) * sin(theta_r)` is not monotone in
 * `r`, so this is a scan and not a look at the equator. The latitudinal half-extent is `dphi / 2`
 * on every row, so that axis is a single division.
 *
 * **The cost is bounded by the sphere, not by the card count**, which is what makes this affordable
 * at the bottom of the roster where every cell is huge. It is `(1, 1)` — one quad per cell, the
 * geometry the prototype shipped — for every world of **574 cards or more**: 13 of v3's 45 worlds,
 * holding 19,497 of its 24,399 cells. It is `(3, 2)` at Rabiah's 75, `(5, 3)` at 30 cards, and
 * `(32, 16)` at N = 1, where the entire world is 512 sub-quads against Dominaria's 6,271 cells at
 * `(1, 1)`.
 */
export function subdivisionFor(rowCells: readonly number[]): Subdivision {
  let widest = 0
  for (let row = 0; row < rowCells.length; row += 1) {
    const arc = cellSizeArc(rowCells, row)
    if (arc.lon > widest) widest = arc.lon
  }
  const kLon = Math.max(1, Math.ceil(widest / FACET_ARC_LIMIT))
  const kLat = Math.max(1, Math.ceil(cellSizeArc(rowCells, 0).lat / FACET_ARC_LIMIT))
  return { kLon, kLat, subQuads: kLon * kLat }
}

/**
 * The base grid's vertices as `(u, v)` pairs in `[-1, 1]^2`, row-major: `v` outer, `u` inner.
 *
 * Parameter space, not position — the shader maps `(u, v)` onto the sphere at colatitude
 * `theta_c + v * latAngle` and longitude `lambda_c + u * lonAngle`, the same parameterisation that
 * placed the cell's centre, then applies the same lift and the same inset. Every vertex therefore
 * sits *on* the lifted sphere at every `k`.
 */
export function buildCellVertices({ kLon, kLat }: Subdivision): Float32Array {
  const uv = new Float32Array((kLon + 1) * (kLat + 1) * 2)
  let at = 0
  for (let j = 0; j <= kLat; j += 1) {
    const v = (j / kLat) * 2 - 1
    for (let i = 0; i <= kLon; i += 1) {
      uv[at] = (i / kLon) * 2 - 1
      uv[at + 1] = v
      at += 2
    }
  }
  return uv
}

/**
 * The index buffer — **clockwise, per sub-quad**.
 *
 * > **Normative (§1.4, DEC-694).** With `east` as the quad's +x and `north = cross(east, n)` as its
 * > +y, the geometric normal of the *counter-clockwise* order is `east x north = -n`: every
 * > front-facing cell is back-face culled, and the only survivors are the far hemisphere seen from
 * > inside. **Both of its failure modes lie.** With the globe hidden, the far hemisphere fills the
 * > silhouette and reads as a perfectly complete mosaic; with the globe drawn, it reads as a
 * > depth-precision fight between two shells at 1.004x. This cost an hour in the prototype and the
 * > subdivision is exactly where a "tidy" rewrite reintroduces it — a grid generator that emits CCW
 * > triangles inverts every cell on every world.
 *
 * Per sub-quad the corners are `a = (i, j)`, `b = (i+1, j)`, `c = (i+1, j+1)`, `d = (i, j+1)` and
 * the triangles are `[a, c, b]` and `[a, d, c]`, whose signed area in `(u, v)` is negative.
 *
 * **This is the spec's `[0, 2, 1, 0, 3, 2]`, relabelled.** That array numbers the corners in *ring*
 * order — `(-1,-1), (+1,-1), (+1,+1), (-1,+1)` — while the grid above is row-major, so at
 * `k = (1, 1)` ring vertex 2 is row-major vertex 3 and ring 3 is row-major 2. Applying that relabel
 * to `[0, 2, 1, 0, 3, 2]` gives `[0, 3, 1, 0, 2, 3]`, which is what this function emits at
 * `k = (1, 1)`: the same two triangles, split on the same diagonal, wound the same way. The test
 * asserts both spellings and the sign of the area, because a literal index-array check alone passes
 * a generator that renumbers vertices and fails a correct one that does.
 */
export function buildCellIndices({ kLon, kLat }: Subdivision): Uint16Array {
  const indices = new Uint16Array(kLon * kLat * 6)
  const stride = kLon + 1
  let at = 0
  for (let j = 0; j < kLat; j += 1) {
    for (let i = 0; i < kLon; i += 1) {
      const a = j * stride + i
      const b = a + 1
      const d = a + stride
      const c = d + 1
      indices[at] = a
      indices[at + 1] = c
      indices[at + 2] = b
      indices[at + 3] = a
      indices[at + 4] = d
      indices[at + 5] = c
      at += 6
    }
  }
  return indices
}

/**
 * The corner lift of a *flat tangent* quad, in units of world radius — the quantity §1.4's
 * subdivision exists to remove.
 *
 * `sqrt(lift^2 + alpha^2 + beta^2) - 1` for arc half-extents `(alpha, beta)`. Exported so the
 * tests can state the case the subdivision answers rather than restating its numbers as constants:
 * it is a **sawtooth in N, not monotone** (it rises at N = 2 -> 3, 5 -> 6, 11 -> 12, 28 -> 29 and
 * on), because under exact-N a small world's residual lands in one row. Reading the small-N failure
 * as an aspect-ratio problem points at the harmless half.
 */
export function tangentCornerLift(lonArc: number, latArc: number): number {
  return Math.sqrt(CELL_LIFT * CELL_LIFT + lonArc * lonArc + latArc * latArc) - 1
}

/**
 * The sag of one flat facet spanning `arc` radians, in units of world radius — what replaces
 * {@link tangentCornerLift} once the vertices sit on the sphere.
 *
 * `CELL_LIFT * (1 - cos(gamma))`, with `gamma` the half-angle the facet spans on each axis
 * combined. Bounded by construction at {@link FACET_ARC_LIMIT}, which is how `k` is chosen.
 */
export function facetSag(arc: number): number {
  return CELL_LIFT * (1 - Math.cos(arc * Math.SQRT2))
}
