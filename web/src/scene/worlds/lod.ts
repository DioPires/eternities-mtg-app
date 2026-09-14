/**
 * LOD: baked equirect far, cells near (spec §1.5).
 *
 * At system distance Dominaria's cells are **1.4 CSS px**. 24,399 quads at sub-pixel size is not a
 * cost problem — it is an aliasing problem, and a sub-pixel quad sheet shimmers under any camera
 * motion. So every world with cards also carries a 256x128 baked swatch texture, one layer of a
 * `DataArrayTexture`, and draws from that until its cells are worth drawing individually.
 *
 * > **Normative — the bake is client-side, at load, in the worker (§1.5).** It is a pure function
 * > of `swatches.bin` (§2.2) plus the surface law, which both sides already have; shipping it as a
 * > pipeline artefact would add a fourth binary and a fourth budget row to buy nothing. Everything
 * > in this file is therefore free of three and free of GL — {@link bakeEquirectLayer} returns the
 * > bytes and the caller uploads them.
 */

import { rowStep } from './surfaceLaw'

/** §1.5's bake dimensions. One layer per world **with cards**, allocated from the dataset (§3.1). */
export const EQUIRECT_WIDTH = 256
export const EQUIRECT_HEIGHT = 128

/**
 * Below this median cell height a world draws only as a system instance (§1.5).
 *
 * A tier knob: §1.12's tier 3 moves it to 8 px, which is the rung that makes the ladder's third
 * step a real one. Taken as a parameter everywhere rather than read as a constant, for the reason
 * §1.12 gives about asserting against reported values.
 */
export const CROSSOVER_LOW_PX = 4

/** Above this median cell height a world draws its full cell sheet (§1.5). */
export const CROSSOVER_HIGH_PX = 8

/**
 * Below this on-screen radius the equirect sample stops carrying information (§1.5).
 *
 * At the home view a world is a few pixels across, the sampler returns something close to the
 * layer's own mean, and **a mean over a balanced colour pie is grey for every plane** — every world
 * would read as the same dot. So a distant instance mixes from its equirect sample toward §1.8's
 * stretched palette-deviation tint below this radius. That is where §1.8's x3.2 stretch lives and
 * the only place it applies.
 */
export const TINT_RADIUS_PX = 6

/**
 * A world's on-screen **radius** in CSS px — the quantity {@link TINT_RADIUS_PX} is a threshold on.
 *
 * Distinct from {@link cellHeightPx}, which sizes one cell: the far LOD draws no cells, so the only
 * scale it has is the whole world's disc.
 */
export function worldRadiusPx(
  radius: number,
  distance: number,
  viewportHeightPx: number,
  fovRadians: number,
): number {
  if (distance <= 0) return Infinity
  return (radius * viewportHeightPx) / (2 * distance * Math.tan(fovRadians / 2))
}

/**
 * How far a distant world has moved from its equirect sample toward §1.8's palette tint (§1.5).
 *
 * `0` = the equirect sample alone, `1` = the tint alone. Far below the crossover the layer stops
 * carrying information — the sampler returns something close to the layer's own mean, and **a mean
 * over a balanced colour pie is grey for every plane** — so without this every world at the home
 * view reads as the same dot.
 *
 * > **Normative — R1 owns this factor and §1.8 owns the colour it mixes toward (§4).** The staffing
 * > table puts §1.3–§1.6 on R1 and §1.7–§1.9 on R2, and the boundary falls exactly here: the *mix*
 * > belongs to §1.5's LOD, while the x3.2 palette-deviation stretch it mixes toward is §1.8's and
 * > ships with the system instance mesh. Two legs each computing their own blend factor is how the
 * > crossover and the tint end up disagreeing about where a world stops being itself.
 *
 * Smoothstepped for the same reason §1.5's crossover is a band rather than a switch: a linear ramp
 * has a slope discontinuity at the threshold, which on a slow approach reads as the moment the
 * colour "catches".
 */
export function tintMix(radiusPx: number, tintRadiusPx = TINT_RADIUS_PX): number {
  if (!(tintRadiusPx > 0)) return 0
  if (!(radiusPx < tintRadiusPx)) return 0
  const t = radiusPx > 0 ? 1 - radiusPx / tintRadiusPx : 1
  return t * t * (3 - 2 * t)
}

/** Which passes a world draws in this frame, and how they blend (§1.2, §1.5). */
export interface CrossoverState {
  /** §1.2 step 2 — one instance of the system icosphere, textured from the world's equirect layer. */
  readonly drawSystem: boolean
  /** §1.2 step 4 — the globe shell and the cell sheet. */
  readonly drawSheet: boolean
  /** 0 at the band's floor, 1 at its ceiling. The sheet's opacity; the system instance takes `1 - mix`. */
  readonly sheetMix: number
}

/**
 * The crossover, from a world's median on-screen cell height.
 *
 * > **Normative — this is the scene's only LOD partition, and inside the band a world draws in
 * > BOTH passes (§1.2, §1.5; DEC-746's D4).** The band, not a hard switch, is what stops a pop on
 * > approach. Two consequences a renderer gets wrong by deriving one pass from the other:
 * >
 * > - **Any number of worlds may be above the crossover at once.** A tether view with both ends
 * >   near is the ordinary case, so nothing in the pass list may be written as "the focused world"
 * >   versus "the rest".
 * > - **Step 2's instance count is a count of planes below the band's *top*** — not
 * >   `worlds - sheetsDrawn`. A world inside the band is in both counts, so a renderer that
 * >   subtracts is one instance short through every approach.
 */
export function crossoverState(
  medianCellHeightPx: number,
  lowPx = CROSSOVER_LOW_PX,
  highPx = CROSSOVER_HIGH_PX,
): CrossoverState {
  if (!(medianCellHeightPx > lowPx)) return { drawSystem: true, drawSheet: false, sheetMix: 0 }
  if (medianCellHeightPx >= highPx) return { drawSystem: false, drawSheet: true, sheetMix: 1 }
  const mix = (medianCellHeightPx - lowPx) / (highPx - lowPx)
  return { drawSystem: true, drawSheet: true, sheetMix: mix }
}

/**
 * A cell's on-screen height in CSS px, from its latitudinal arc half-extent.
 *
 * The latitudinal half-extent is `dphi/2` on every row and carries no `sin(theta)` (§2.1), so this
 * is the one cell dimension that is the same at the pole and the equator — which is what makes a
 * *median cell height* a meaningful per-world scalar for the crossover, and why §3.1's W1 row is
 * written against height rather than area.
 *
 * @param latArc    half-extent in units of world radius
 * @param radius    the world's drawn radius (§1.3)
 * @param distance  eye-to-cell distance in world units
 * @param viewportHeightPx  CSS px, not device px — every threshold in §1.5 and §1.6 is CSS
 * @param fovRadians        the camera's vertical field of view
 */
export function cellHeightPx(
  latArc: number,
  radius: number,
  distance: number,
  viewportHeightPx: number,
  fovRadians: number,
): number {
  if (distance <= 0) return Infinity
  const worldHeight = 2 * latArc * radius
  return (worldHeight * viewportHeightPx) / (2 * distance * Math.tan(fovRadians / 2))
}

/**
 * Where each cell of a world sits in the grid, so the bake can answer "which card is at this
 * texel".
 *
 * **Derived from the decoded positions, never assumed.** The cells of a row are uniformly spaced —
 * their angular half-extent is `PI / rowCells[r]` on every one of them — but the *phase* is the
 * pipeline's: §1.3 staggers alternate rows by half a cell so the tiling reads as masonry rather
 * than as a graticule, and nothing in the contract states the stagger's sign. Reading the first
 * cell's longitude out of the data and stepping from there is correct under either convention, and
 * stays correct if the stagger changes. This is the same discipline as reading `rowCells` instead
 * of computing it.
 */
export interface RowIndex {
  /** `cells[row][column]` — an index into the world's own cell array. */
  readonly cells: readonly Int32Array[]
  /** The longitude of column 0 in each row, in radians. */
  readonly originLon: Float64Array
}

/**
 * Group a world's decoded cell centres into rows and columns.
 *
 * > **Normative — longitude is `atan2(x, z)`, and the other spelling mirrors the world (DEC-749).**
 * > §1.4 places a cell vertex at "longitude `lambda_c + u * (pi / rowCells[r])`" and winds the quad
 * > with `east` as its `+u`. Those two sentences are consistent under exactly one convention:
 * > `east = normalize(cross(Y, n))` runs along **increasing `atan2(x, z)`** and along *decreasing*
 * > `atan2(z, x)`. Indexing columns by the latter — which is the spelling that looks natural, and
 * > which an earlier revision of this file documented — runs the bake's texels opposite to the
 * > sheet's `u`. The result is a world mirrored east-west between its two LOD representations, and
 * > it does not announce itself: inside §1.5's crossover band both passes draw and cross-fade, so
 * > it reads as a smear rather than as an obvious flip, and outside the band each representation is
 * > self-consistent. `worlds-surface-law.test.ts` pins the handedness on `eastOf` directly.
 *
 * @param lon      per cell, `atan2(x, z)` of the decoded unit-sphere centre
 * @param row      per cell, the result of `rowOfUnitY` — matched by nearest row, never floored
 * @param rowCells the world's **published** table (§2.4)
 */
export function buildRowIndex(
  lon: Float64Array,
  row: Int32Array,
  rowCells: readonly number[],
): RowIndex {
  const cells = rowCells.map((count) => new Int32Array(count).fill(-1))
  const originLon = new Float64Array(rowCells.length).fill(Number.NaN)
  // First pass: the smallest longitude in each row is column 0's phase.
  for (let cell = 0; cell < lon.length; cell += 1) {
    const r = row[cell]!
    if (!(originLon[r]! <= lon[cell]!)) originLon[r] = lon[cell]!
  }
  for (let cell = 0; cell < lon.length; cell += 1) {
    const r = row[cell]!
    const column = columnOf(lon[cell]!, originLon[r]!, rowCells[r]!)
    cells[r]![column] = cell
  }
  return { cells, originLon }
}

/** The column a longitude falls in, given the row's phase and cell count. O(1), wraps at `2*PI`. */
export function columnOf(lon: number, originLon: number, count: number): number {
  const step = (2 * Math.PI) / count
  const offset = lon - originLon
  const wrapped = offset - 2 * Math.PI * Math.floor(offset / (2 * Math.PI))
  const column = Math.round(wrapped / step)
  return column >= count ? column - count : column
}

/**
 * Rasterise one world's cells into its 256x128 equirect layer: RGBA8, `EQUIRECT_WIDTH *
 * EQUIRECT_HEIGHT * 4` bytes.
 *
 * One pass over the texels — 32,768 of them, against Dominaria's 6,271 cells — so the whole roster
 * is 45 layers of a fixed cost rather than a cost that grows with the card count. Texel `v = 0` is
 * the **north pole**, matching `theta`'s direction (§1.3), so the caller must not flip on upload;
 * §1.6's note about `UNPACK_FLIP_Y_WEBGL` is about the *art* pool, which is a different texture with
 * a different orientation.
 *
 * @param swatch linear RGB per cell, three floats in 0..1 — `iSwatch`'s own values (§1.4)
 */
export function bakeEquirectLayer(
  index: RowIndex,
  rowCells: readonly number[],
  swatch: Float32Array,
): Uint8Array {
  const layer = new Uint8Array(EQUIRECT_WIDTH * EQUIRECT_HEIGHT * 4)
  const rows = rowCells.length
  const dphi = rowStep(rows)
  for (let v = 0; v < EQUIRECT_HEIGHT; v += 1) {
    const theta = ((v + 0.5) / EQUIRECT_HEIGHT) * Math.PI
    // Nearest row, for the same reason the decode matches nearest (§2.1): a texel centre is not a
    // row centre, and flooring biases every texel of a row toward one neighbour.
    let row = Math.round(theta / dphi - 0.5)
    if (row < 0) row = 0
    else if (row >= rows) row = rows - 1
    const count = rowCells[row]!
    const origin = index.originLon[row]!
    const columns = index.cells[row]!
    for (let u = 0; u < EQUIRECT_WIDTH; u += 1) {
      const lon = ((u + 0.5) / EQUIRECT_WIDTH) * 2 * Math.PI - Math.PI
      const cell = columns[columnOf(lon, origin, count)]!
      const at = (v * EQUIRECT_WIDTH + u) * 4
      if (cell < 0) {
        layer[at + 3] = 255
        continue
      }
      layer[at] = toByte(swatch[cell * 3]!)
      layer[at + 1] = toByte(swatch[cell * 3 + 1]!)
      layer[at + 2] = toByte(swatch[cell * 3 + 2]!)
      layer[at + 3] = 255
    }
  }
  return layer
}

function toByte(value: number): number {
  const scaled = Math.round(value * 255)
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled
}
