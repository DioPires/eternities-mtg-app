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

import { HueClass } from '../../data/types'

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

/**
 * The silhouette framing a fly-to used to arrive at, unconditionally: `3.2 x radius` (PRD 5.7.1).
 *
 * Kept, as the **far** cap. It is the composition rule — a world's disc fills 63% of a 1080 px
 * frame here — and for 43 of the 45 worlds it is still what {@link framingRadii} returns. What it
 * cannot do on its own is what DEC-818 found: see that function's header.
 */
export const SILHOUETTE_FRAMING_RADII = 3.2

/**
 * §3.1's reference viewport — 1920x1080 CSS at dpr 1, the camera's own 55 deg vertical fov.
 *
 * > **Normative — a pixel floor has no world-space spelling without a viewport, and this names the
 * > one it is stated at (§3.1, DEC-818).** W1's 24 px is a CSS-pixel bound measured at §3.1's
 * > closing paragraph's viewport, so a framing distance derived from it is well defined exactly
 * > where that bound is. Only the *height* and the *vertical* fov enter: {@link cellHeightPx} and
 * > `cellScreenRect` both take screen `y` from `viewportHeightPx` and the projection's vertical
 * > half-angle, and the aspect ratio moves screen `x` alone.
 *
 * A shorter viewport therefore frames a world at the same distance and reads fewer pixels per cell.
 * That is a deliberate limit and not an oversight: `Framing` is the headless camera layer and has
 * no live viewport (`sceneRenderer` owns the `PerspectiveCamera`), so making the arrival distance
 * track the window would put a render-loop dependency in the navigation layer. It is written down
 * rather than left implicit so the next reader can price the change.
 */
export const FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX = 1080
/** {@link FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX}' other half — `sceneRenderer`'s `FOV`, in radians. */
export const FRAMING_REFERENCE_FOV_RADIANS = (55 * Math.PI) / 180

/**
 * The height the cell at the sub-camera point is framed to, in CSS px at the reference viewport.
 *
 * > **Normative — this is NOT W1's 24 px floor, and the gap is measured (§3.1, DEC-818).** W1 scores
 * > the **median** front-facing cell, and the median sits well below the cell nearest the eye: the
 * > front-facing cap runs out to the limb, where a cell is foreshortened to a few px. Worse, the
 * > ratio is not a constant — it moves with the approach azimuth, because §1.3's pole is tilted by
 * > `planes.json`'s quaternion and a pole swinging into view brings a cohort of squat polar cells
 * > with it. Measured through the shipped probe over the 45-world roster at `HOME_POLAR`
 * > (`worlds-framing.test.ts` re-derives every number below), the **worst-azimuth** median at the
 * > old flat 3.2 radii is **15.50 px on dominaria** and **23.88 px on ravnica** — two worlds under
 * > the floor, not one. Leg G's single-azimuth tour saw 17.14 and 28.49 and reported ravnica green:
 * > one draw from a family with an 11-14% spread.
 *
 * **28 px is the falsifier and it is one step away.** At 28 the law leaves dominaria at 23.95 and
 * never pulls ravnica in at all (23.88): both still under. At 30 they read 25.55 and 25.21 — a 5%
 * margin on the worst world — while dominaria's disc still fits the reference frame at 1,023 px of
 * 1,080. 31 buys 9% of margin for 97% of the frame height, which is a different composition, not a
 * safer one. This is deliberately the only tuned constant in the law: the rest — {@link CELL_LIFT},
 * {@link CELL_INSET}, the reference viewport — are quoted from elsewhere.
 */
export const CELL_FRAMING_PX = 30

/**
 * §1.3's framing distance for a world, in units of its own radius (DEC-818).
 *
 * > **Normative — the framing distance frames the world's CELLS, not its silhouette (§3.1,
 * > board ruling on DEC-816 R1).** A sphere at `k x radius` subtends the same angle whatever its
 * > radius, so under the old flat `3.2 x radius` every world's disc was the same size on screen and
 * > every world's **cells** shrank as `1/rows` — which is `~sqrt(N)`. Dominaria's 81 rows put its
 * > median front-facing cell at 15.5-17.1 px against W1's 24 px floor while a one-card world read
 * > 685. The floor and the criterion are right and the framing distance was measuring the wrong
 * > thing: it is the one term in `cell px = f(cell arc, distance)` that a renderer may choose.
 *
 * The cell arc is row-invariant — {@link cellDrawAngles}' `lat` carries no `sin(theta)` (§2.1) — so
 * one cell height stands for the world and this needs nothing from the data but `rowCells.length`.
 * Below the cap the returned distance is **exactly** the distance at which a cell at the sub-camera
 * point is {@link CELL_FRAMING_PX} tall, by inverting `cellHeightPx` at the near point: the sheet's
 * nearest surface sits {@link CELL_LIFT} radii from the centre, which is why the lift is a term here
 * and not a rounding.
 *
 * > **The cap is what keeps this from being absurd at the small end.** `rowCells.length` is 1 on the
 * > six one-card worlds, so the unbounded form would frame them at 103 radii — a dark speck. A world
 * > whose cells already clear the floor at silhouette framing keeps silhouette framing; the two
 * > branches meet continuously at **46.3 rows**, so on the shipped roster exactly two worlds are
 * > pulled in — ravnica (49 rows, 3.2 -> 3.080) and dominaria (81 rows, 3.2 -> 2.261) — and the
 * > other 43 are framed at the same distance as before, to the bit.
 *
 * @param rowCells the world's **published** table (§2.4); `rowCells.length` is the row count
 */
export function framingRadii(rowCells: readonly number[]): number {
  // The cell's drawn latitudinal extent, in units of world radius: the full angle (twice the
  // half-extent `cellDrawAngles` returns) on the lifted sphere the sheet is actually drawn at.
  const cellArc = 2 * cellDrawAngles(rowCells, 0).lat * CELL_LIFT
  const focalPx =
    FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX / (2 * Math.tan(FRAMING_REFERENCE_FOV_RADIANS / 2))
  return Math.min(SILHOUETTE_FRAMING_RADII, CELL_LIFT + (cellArc * focalPx) / CELL_FRAMING_PX)
}

/**
 * §1.3's thirteen latitude bands, north to south: `C G R B U W · Gold · W U B R G C`.
 *
 * > **Normative — a band index is not a colour class (§3.1, DEC-752's pin).** Seven classes are laid
 * > out **mirrored about the equator**, so every mono class appears **twice** and only gold appears
 * > once. Reporting the class instead of the index would merge the two ice caps — which sit at
 * > opposite poles and are the two *ends* of the chain — into one group, and invent an adjacency the
 * > sphere does not have. W3 compares bands adjacent **on the sphere**, so it walks this array as a
 * > **chain, not a cycle**: index 0 and index 12 are the furthest apart of any pair, not neighbours.
 */
export const BAND_ORDER: readonly HueClass[] = [
  HueClass.Colourless,
  HueClass.Green,
  HueClass.Red,
  HueClass.Black,
  HueClass.Blue,
  HueClass.White,
  HueClass.Multicolour,
  HueClass.White,
  HueClass.Blue,
  HueClass.Black,
  HueClass.Red,
  HueClass.Green,
  HueClass.Colourless,
]

/** The one class that is **not** mirrored: gold takes its whole share in the equatorial belt. */
export const GOLD_BAND = BAND_ORDER.indexOf(HueClass.Multicolour)

/**
 * Each band's share of the plane's cards. Thirteen values summing to 1.
 *
 * A mono class's count is **halved** across its matched pair; gold's is not. `hueCounts` is indexed
 * by {@link HueClass}, so it has seven entries however many bands there are.
 *
 * Returns thirteen zeros on an empty plane rather than dividing by zero — §1.8's moons have no
 * sheet at all, and a caller that reached here with one should get a degenerate answer, not a NaN
 * that propagates silently into every boundary below.
 */
export function bandShares(hueCounts: readonly number[]): number[] {
  let total = 0
  for (const count of hueCounts) total += count
  if (!(total > 0)) return BAND_ORDER.map(() => 0)
  return BAND_ORDER.map((hue) => {
    const share = (hueCounts[hue] ?? 0) / total
    return hue === HueClass.Multicolour ? share : share / 2
  })
}

/**
 * The band edges in `cos θ`, north (`+1`) to south (`−1`). Fourteen values for thirteen bands.
 *
 * > **Equal-*area*, not equal-angle (§1.3).** A spherical zone between two colatitudes has area
 * > `2π·(cos a − cos b)`, so a band's share of the `cos θ` range — which spans 2 — *is* its share of
 * > the plane's cards. That is the whole point of the law: the area a colour covers is the fraction
 * > of the plane that colour is. Equal-*angle* bands would make a polar class look as big as an
 * > equatorial one holding six times the cards.
 *
 * The last edge is written as `−1` rather than accumulated, so the south pole is exact however the
 * thirteen shares rounded on the way down.
 */
export function bandBoundaries(hueCounts: readonly number[]): number[] {
  const edges = [1]
  for (const share of bandShares(hueCounts)) edges.push(edges[edges.length - 1]! - 2 * share)
  edges[edges.length - 1] = -1
  return edges
}

/**
 * The band a point at colatitude `θ` falls in, given the plane's edges.
 *
 * Takes `cos θ` rather than `θ` because the boundaries are in `cos θ` and converting at the call
 * site is where a `sin`/`cos` slip would hide (§1.3's D1 defect was exactly that substitution).
 *
 * A zero-width band — a class the plane holds none of — can never be entered, which is correct:
 * `cosTheta` cannot be strictly inside an empty interval. The scan is north-to-south and returns
 * the **first** band whose lower edge it clears, so a point landing exactly on a boundary goes to
 * the northern band, deterministically.
 */
export function bandOfCosTheta(cosTheta: number, edges: readonly number[]): number {
  for (let band = 0; band < edges.length - 1; band += 1) {
    if (cosTheta >= edges[band + 1]!) return band
  }
  return edges.length - 2
}
