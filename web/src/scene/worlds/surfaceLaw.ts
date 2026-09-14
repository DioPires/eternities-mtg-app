/**
 * The surface law on the client (spec §1.3, §2.1).
 *
 * **Latitude is colour. Longitude is time.** The pipeline owns the law's *construction* — it
 * apportions a row's cells within each colour band and then splits each band's share between sets,
 * returning counts and placements from one pass, which is what makes "zero displaced, zero bare"
 * checkable at the artefact (§1.3, leg P). What crosses to the client is deliberately much less
 * than that: `stars.bin` carries every cell centre as a unit-sphere point, and `planes.json`
 * carries the per-plane `rowCells` table. So the client's *entire* remaining derivation is the four
 * functions below — match a point to its row, turn that row into half-extents, build the tangent
 * frame, and size the world.
 *
 * > **Normative — `rowCells` is not a function of `cardCount` (§1.3).** The same N under different
 * > hue histograms yields different tables, so nothing here may reconstruct a cell count. The
 * > closed form and the N-only apportionment live in `./surfaceCheck` and are checks; neither is
 * > reachable from the render path.
 *
 * The one thing this module is careful about beyond arithmetic is the **metric** the row match
 * uses. See {@link rowOfUnitY}.
 */

/**
 * Constant area per card: `radius = 0.126 * sqrt(cardCount)`.
 *
 * This is what makes Dominaria's 22% share visible — r 9.97 against Rabiah's 1.09, a 9.1x ratio
 * where the retired `log N` law gives 1.568x for the same pair.
 */
const RADIUS_PER_ROOT_CARD = 0.126

/**
 * The floor every plane carries, empty or not (§1.3, §1.8).
 *
 * Without it the law **inverts below 19 cards** — `0.126 * sqrt(19) = 0.549` — and a world is drawn
 * smaller than a plane with no cards at all. That is not hypothetical on the shipped roster: 15 of
 * v3's 45 worlds are under the floor and six carry a single card, which the unfloored law draws at
 * r 0.126, nineteen times smaller in silhouette than a dark moon. Floored, that cohort is
 * moon-sized and is told apart by colour, which is what §1.8 claims.
 *
 * > **Do not raise this to buy pick targets.** On-screen diameter goes as `radius / distance`, so
 * > no world-space constant pins a pixel floor at all, and raising it to what the worst one-card
 * > world needs (3.48) deletes the constant-area law for 36 of 45 worlds. The pick floor is
 * > screen-space and belongs to §1.11 (DEC-751, ruled on DEC-749).
 */
const MIN_WORLD_RADIUS = 0.55

/**
 * The tiling's target cell aspect, `4:3`, because that is what an `art_crop` letterboxes into.
 *
 * > **Exported to be quoted, never to be applied.** `rowCells` is a whole number, so the aspect a
 * > row actually achieves is `2*PI*sin(theta) / (rowCells * dphi)` and the polar rows cannot hit
 * > 4:3 at all: at `rowCells = 2` it is `PI/2` (18% high), at `rowCells = 1` it is 2.00. A shader
 * > that hard-codes this ratio mis-frames the ice caps of every small plane. Art is letterboxed
 * > into the cell's **own** rect (§1.4, §1.6, §2.1).
 */
export const CELL_ASPECT = 4 / 3

/** The world's drawn radius (§1.3). The floor applies on every plane, not only empty ones. */
export function worldRadius(cardCount: number): number {
  return Math.max(RADIUS_PER_ROOT_CARD * Math.sqrt(Math.max(0, cardCount)), MIN_WORLD_RADIUS)
}

/**
 * The row latitudes, which the relaxation does **not** move (§1.3).
 *
 * Rows stay equal-*angle* while cell counts go population-derived. That is what lets the client
 * match a cell to a row by latitude at all, and it is what keeps rows and bands independent: bands
 * are equal-*area* in `sin(lat)`, so a band boundary generally falls mid-row, which is legal and
 * intended.
 */
export function rowStep(rows: number): number {
  return Math.PI / rows
}

/**
 * Row `i`'s centre as a **colatitude**, `theta = (i + 1/2) * dphi`, measured from the north pole.
 *
 * > **One angle, defined once (§1.3).** `theta` is colatitude throughout this spec and this module;
 * > latitude is `PI/2 - theta`. An earlier spec draft used one symbol for both readings in a single
 * > paragraph, which made the cell count `round(2*PI*cos(...))` — running `+1 -> -1` down the
 * > sphere, so Dominaria's southern rows got *negative* counts and its 81 rows summed to zero. The
 * > circumference of a row is `2*PI*sin(theta)`, which is why every formula here carries `sin`.
 */
export function rowColatitude(row: number, rows: number): number {
  return (row + 0.5) * rowStep(rows)
}

/**
 * Match a cell centre to its row by **nearest** row centre, comparing in `y` (§2.1).
 *
 * > **Normative — nearest, never `floor()`.** `stars.bin` stores the centre as three float16s.
 * > Spacing on `[0.5, 1)` is `2^-11`, so the round-trip error is at most `2.44e-4`. Dominaria's two
 * > polar rows are `1.504e-3` apart in `y`, so nearest-row matching has a margin of **3.08x** and a
 * > `floor()` has half of that. At the equator the margin is 79x. The pole is the whole safety
 * > budget.
 *
 * **The metric is `y`, not `theta`, and the choice is not cosmetic.** Rows are equispaced in
 * `theta`, so `round(theta/dphi - 1/2)` looks like the natural classifier — but it puts the
 * decision boundary at `cos(dphi)` rather than at the midpoint of the two rows' `y`, and near the
 * pole those are `1.9e-4` apart, which is the same order as the float16 error they are supposed to
 * survive. Matching in `y` is the metric the 3.08x margin was measured in; matching in `theta`
 * leaves 2.31x on the same data. Both classify today's roster correctly. This one keeps the margin
 * the contract was written against, and `worlds-surface-law.test.ts` pins the difference.
 *
 * The `acos` seeds the search; the three-way compare is what decides, so the seed only has to be
 * within a row of the answer.
 *
 * @param y     the `y` component of the decoded unit-sphere cell centre
 * @param rows  `rowCells.length` — the row count, which the client never derives (§2.1)
 */
export function rowOfUnitY(y: number, rows: number): number {
  if (rows <= 1) return 0
  const dphi = rowStep(rows)
  const clamped = y < -1 ? -1 : y > 1 ? 1 : y
  const seed = Math.round(Math.acos(clamped) / dphi - 0.5)
  let best = 0
  let bestDistance = Infinity
  for (let row = seed - 1; row <= seed + 1; row += 1) {
    if (row < 0 || row >= rows) continue
    const distance = Math.abs(clamped - Math.cos(rowColatitude(row, rows)))
    if (distance < bestDistance) {
      bestDistance = distance
      best = row
    }
  }
  return best
}

/** A cell's half-extents in **angle**: `(PI / rowCells[r], dphi / 2)` (§2.1). */
export interface CellAngles {
  /** Half the cell's longitude span, in radians. */
  readonly lon: number
  /** Half the cell's colatitude span, in radians — `dphi / 2` on every row. */
  readonly lat: number
}

/** The angular half-extents of a cell in row `row` (§2.1). Both components are angles. */
export function cellHalfAngles(rowCells: readonly number[], row: number): CellAngles {
  return { lon: Math.PI / rowCells[row]!, lat: rowStep(rowCells.length) / 2 }
}

/**
 * `iSize` — the same cell in **arc length**, in units of world radius (§1.4, §2.1).
 *
 * > **Normative — the longitudinal component carries `sin(theta_r)`.** A row is a small circle of
 * > radius `sin(theta)`, not a great circle, so a longitude angle subtends `angle * sin(theta)` of
 * > surface while a colatitude angle subtends itself. **Dropping the factor draws Dominaria's polar
 * > row 51.6x too wide** — `rowCells[0] = 2` gives a half-extent of `PI/2 = 1.571` *world radii*, a
 * > quad wider than the globe it sits on, against a correct 0.0305.
 *
 * The same factor is what makes §1.3's 4:3 aspect true: a cell's width over its height is
 * `2*PI*sin(theta) / (rowCells * dphi)`, which is the aspect the grid was built at, at every
 * latitude. Without it the ratio is `aspect / sin(theta)` — **81.0 at the pole**. The two bugs are
 * one bug, which is why the conversion lives in one function.
 */
export function cellSizeArc(rowCells: readonly number[], row: number): CellAngles {
  const angles = cellHalfAngles(rowCells, row)
  return { lon: angles.lon * Math.sin(rowColatitude(row, rowCells.length)), lat: angles.lat }
}

/**
 * The cell's tangent frame: `east = normalize(cross(Y, n))` (§2.1).
 *
 * Written out rather than taken from `Vector3` because it is called once per cell per world at
 * build time — 24,399 times on the v3 roster — and because the degenerate case needs an answer.
 * A centre exactly at a pole has no east; no row centre is ever there (`theta_0 = dphi/2 > 0`), but
 * a lost or truncated decode can produce one, and a `NaN` east silently deletes a whole world's
 * sheet rather than failing. The fallback is the `+x` axis, which is as good as any other choice on
 * a point where longitude is undefined.
 *
 * `_ny` is taken and ignored on purpose: `cross(Y, n)` is `(n.z, 0, -n.x)`, so the normal's own `y`
 * never enters the answer. The parameter stays so that call sites pass a *normal* rather than two of
 * its components, which is what keeps the degenerate case above legible at the call site.
 *
 * @param out written in place; returned for chaining
 */
export function eastOf(nx: number, _ny: number, nz: number, out: [number, number, number]) {
  // cross(Y, n) = (n.z, 0, -n.x) with Y = (0, 1, 0).
  const x = nz
  const z = -nx
  const length = Math.sqrt(x * x + z * z)
  if (length < 1e-8) {
    out[0] = 1
    out[1] = 0
    out[2] = 0
    return out
  }
  out[0] = x / length
  out[1] = 0
  out[2] = z / length
  return out
}

/**
 * How far a cell's *centre* sits from the world centre, in units of world radius (§1.4).
 *
 * The sheet is lifted just off the globe so it beats depth precision at system distance. Exported
 * because §1.4's subdivision and the equirect bake both have to agree with the shader about it.
 */
export const CELL_LIFT = 1.006

/** The cell's inset, so the tiling reads as masonry with grout rather than as a skin (§1.4). */
export const CELL_INSET = 0.93

/**
 * The angular half-extents the sheet **actually draws** — {@link cellHalfAngles}, inset.
 *
 * > **Normative — the probe measures these, not the cell's full angles (§3.1, DEC-749).** The
 * > vertex shader insets the *angle* before it steps onto the sphere, so a cell covers 93% of its
 * > share of the surface and the remaining 7% is §1.4's grout. `cellScreenRect` takes its arcs as
 * > parameters and will happily bound a rectangle nothing ever drew: passing the un-inset angles
 * > over-reports every cell's extent by **1/0.93 = 7.5%**, which lands directly on W1's pixel-height
 * > floor and on §1.11's 24 px proxy. This function exists so the two sides cannot spell it
 * > differently — the shader gets `CELL_INSET` as a `#define` written from this same constant.
 *
 * Returns **angle**, like {@link cellHalfAngles} and unlike {@link cellSizeArc}: the probe's
 * parameterisation walks colatitude and longitude, so it wants the angle the shader walks.
 */
export function cellDrawAngles(rowCells: readonly number[], row: number): CellAngles {
  const angles = cellHalfAngles(rowCells, row)
  return { lon: angles.lon * CELL_INSET, lat: angles.lat * CELL_INSET }
}

/**
 * The radius the sheet is drawn at — the world's radius, lifted off the globe (§1.4).
 *
 * The other half of {@link cellDrawAngles}' contract. `cellScreenRect` takes a radius and the
 * world's own radius is the wrong one: the sheet sits at `1.006x` so it beats depth precision at
 * system distance, and a probe reading the unlifted radius under-reports every cell by 0.6%.
 */
export function drawRadius(radius: number): number {
  return radius * CELL_LIFT
}
