/**
 * The cell sheet (spec §1.4): one `InstancedBufferGeometry` per world, one instance per card.
 *
 * The base geometry is a `(k_lon + 1) x (k_lat + 1)` **parameter** grid, not a quad — see
 * `cellGeometry.ts` for how `k` is chosen and `cellShaders.ts` for how a `(u, v)` becomes a point on
 * the sphere. Everything here is free of GL: it builds typed arrays and three's buffer objects, and
 * is constructible under jsdom, which is what lets the invariants below be tested without a GPU.
 */

import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Sphere,
  Vector3,
} from 'three'

import { LAYER_FREE } from './artPool'
import { buildCellIndices, buildCellVertices, subdivisionFor, type Subdivision } from './cellGeometry'
import { CELL_LIFT, cellSizeArc } from './surfaceLaw'

/**
 * Bytes of per-instance attribute per cell: `iNormal` 12 + `iSize` 8 + `iSwatch` 12 + `iLayer` 4 +
 * `iArt` 4.
 *
 * > **Normative — 40, amending §1.4's 52 (DEC-749).** The figure in §1.4 counts an `iEast` the
 * > sphere-following grid does not need: the centre normal already carries the cell's colatitude and
 * > longitude, and the vertex shader re-walks the same parameterisation that placed the centre
 * > rather than stepping along a stored tangent basis. Dropping 12 bytes takes the 87-plane roster's
 * > 23,607 cells from 1.17 MiB to **0.90 MiB** and v3's 24,399 from 1.21 MiB to **0.93 MiB**.
 * > `eastOf` stays — `lod.ts` needs it to index the bake's columns, and it is where §1.5 pins the
 * > handedness — but no longer ships per cell.
 */
export const CELL_INSTANCE_BYTES = 40

/** What one world hands the sheet builder. All per-cell arrays are indexed by the card's cell id. */
export interface CellSheetSource {
  /** One cell per card on the world (§1.4) — the belt has no sheet (§1.8). */
  readonly cardCount: number
  /** The world's **published** `rowCells` (§2.4), never one recomputed on the client. */
  readonly rowCells: readonly number[]
  /** Decoded unit-sphere cell centres, three floats each. */
  readonly normals: Float32Array
  /** Per cell, the result of `rowOfUnitY` — matched by **nearest** row, never floored (§2.1). */
  readonly rows: Int32Array
  /** Linear RGB per cell, three floats in 0..1 (§2.2). */
  readonly swatches: Float32Array
  /** The world's radius in scene units — `worldRadius(cardCount)`, or §1.8's floor. */
  readonly radius: number
}

/** A built sheet, plus the two attributes the art stream writes every frame. */
export interface CellSheet {
  readonly geometry: InstancedBufferGeometry
  readonly subdivision: Subdivision
  /** `iLayer`, dynamic: the art pool layer showing in each cell, or {@link LAYER_FREE}. */
  readonly layers: InstancedBufferAttribute
  /** `iArt`, dynamic: the cross-fade, 0 = swatch, 1 = art. */
  readonly art: InstancedBufferAttribute
}

/**
 * Build one world's sheet.
 *
 * > **Normative — the instance count is the card count at every `k` (§3.1, DEC-749).** The
 * > subdivision re-meshes the *base* geometry; it never splits an instance. A sheet whose instance
 * > count grew with `k` would make every per-cell criterion in the gate measure sub-quads, and W1's
 * > floor — a count of cells above a pixel height — would pass by counting the same card up to 512
 * > times on a one-card world.
 */
export function buildCellSheet(source: CellSheetSource): CellSheet {
  const { cardCount, rowCells, normals, rows, swatches, radius } = source
  const subdivision = subdivisionFor(rowCells)

  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('aCell', new BufferAttribute(buildCellVertices(subdivision), 2))
  geometry.setIndex(new BufferAttribute(buildCellIndices(subdivision), 1))

  const iSize = new Float32Array(cardCount * 2)
  for (let cell = 0; cell < cardCount; cell += 1) {
    // Arc length, with the sin(theta_r) the shader divides back out. The two halves of that
    // conversion live in one function on purpose (§2.1): they are one bug, not two.
    const size = cellSizeArc(rowCells, rows[cell]!)
    iSize[cell * 2] = size.lon
    iSize[cell * 2 + 1] = size.lat
  }

  const layers = new InstancedBufferAttribute(new Float32Array(cardCount).fill(LAYER_FREE), 1)
  const art = new InstancedBufferAttribute(new Float32Array(cardCount), 1)
  // Rewritten every frame by the art stream; the rest of the sheet is written once at build.
  layers.setUsage(DynamicDrawUsage)
  art.setUsage(DynamicDrawUsage)

  geometry.setAttribute('iNormal', new InstancedBufferAttribute(normals, 3))
  geometry.setAttribute('iSize', new InstancedBufferAttribute(iSize, 2))
  geometry.setAttribute('iSwatch', new InstancedBufferAttribute(swatches, 3))
  geometry.setAttribute('iLayer', layers)
  geometry.setAttribute('iArt', art)
  geometry.instanceCount = cardCount

  // By hand, because three would compute it from a `position` attribute this geometry does not have
  // (see `cellShaders.ts`). The true bound is the lifted sphere the vertex shader writes onto, which
  // no attribute in this geometry describes: `aCell` is parameter space and spans [-1, 1]^2 whatever
  // the world's radius is. Leaving it null would have three cull worlds by a unit box.
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), radius * CELL_LIFT)

  return { geometry, subdivision, layers, art }
}
