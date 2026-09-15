/**
 * The shipped bytes, as the thing `WorldSurface` consumes (spec §2.1, §2.2, §1.3, §1.4).
 *
 * `WorldSurface` takes a `WorldSurfaceSource` — cell normals, each cell's row, a linear-RGB swatch
 * per card, the hue histogram the band boundaries come from, the radius and the centre — and until
 * this module existed the only thing that produced one was a test fixture. That is why
 * `__eternitiesProbe.worlds()` returns `undefined` in a browser while every unit test is green: the
 * composition is built and tested, and nothing hands it the dataset.
 *
 * **What this module decides, and what it deliberately does not.**
 *
 * - It decides the three derivations §2.1 leaves on the client: normalising the float16 centre,
 *   matching a cell to its row by nearest `y`, and reducing §2.2's 2x2 art statistic to the one
 *   `vec3` §1.4's `iSwatch` carries.
 * - It does **not** apply the control seams. `?swatch=mean` and `?bands=shuffle` are
 *   `WorldSurface`'s (`buildDrawSwatches`, `buildCardOfCell`), and they have to stay there: the
 *   seams are defined against the swatch a cell *draws*, so collapsing the palette here would make
 *   `?swatch=mean` a no-op that still turned the gate's W2 row green — a control that passes by
 *   being applied twice is indistinguishable from one that works.
 * - It does **not** derive `rowCells`, or a row count, or a cell count. §1.3's relaxation makes
 *   those population-derived and DEC-744's B2 ruling makes the published table the contract.
 */

import { Vector3 } from 'three'

import type { PlaneRecord, StarIndex } from '../../data/types'
import type { Stars, Swatches } from '../../data/decode'

import { rowOfUnitY, worldRadius } from './surfaceLaw'
import type { WorldCard, WorldSurfaceSource } from './worldSurface'

/** Seven hue classes, so seven buckets — `bandShares` indexes this by `HueClass` (§1.3). */
const HUE_CLASSES = 7

/**
 * A plane that has a surface: `rowCells` present, which §2.4 makes the field to test for.
 *
 * Defined in `data/types.ts` and re-exported here, because §1.11's label subject asks the same
 * question from a path that must not import three (DEC-751). One spelling of the predicate, two
 * callers — the alternative is two `rowCells` tests that can drift apart silently.
 */
export { isWorldPlane, type WorldPlane } from '../../data/types'
import { isWorldPlane, type WorldPlane } from '../../data/types'

export interface WorldSourceOptions {
  /**
   * The printing for a **card** index within this world, or `null` while its shard has not landed.
   *
   * Defaults to "nothing yet", which is the honest cold-start state rather than a stub: the
   * printing ids live in the per-plane shards of PRD 8.3 and are fetched on focus, so a world drawn
   * at system distance has swatches and no art, which is exactly what §1.5's far rung is.
   */
  readonly cardOf?: (card: number) => WorldCard | null
}

/**
 * Build one world's source from `planes.json`, `stars.bin` and `swatches.bin`.
 *
 * Throws rather than degrading. Each of the three checks below has a failure mode that draws a
 * plausible picture, which is the only kind worth a guard:
 *
 * - **`starCount` against `cardCount`.** These are separate fields and §1.3's whole invariant is
 *   `sum(rowCells) == cardCount`. If they disagree the sheet is sized from one and filled from the
 *   other, and the excess cells sit at the origin — a black dot on the globe, not a crash.
 * - **`starOffset + starCount` against the file.** `stars.bin` is one buffer for the multiverse and
 *   a plane is a window into it, so an offset that is stale by one plane paints a world in another
 *   world's colours and positions. `decodeSwatches` refuses an out-of-range index for this reason;
 *   this is the same refusal one level up, where the range is known.
 * - **The swatch file against the star file.** Star order *is* the swatch encoding (§2.2), so two
 *   artefacts from different runs are a silent off-by-N over the whole multiverse.
 */
export function buildWorldSource(
  plane: WorldPlane,
  stars: Stars,
  swatches: Swatches,
  options: WorldSourceOptions = {},
): WorldSurfaceSource {
  const { slug, cardCount, starOffset, starCount, rowCells } = plane

  if (starCount !== cardCount) {
    throw new Error(`${slug}: starCount ${starCount} != cardCount ${cardCount}`)
  }
  if (starOffset < 0 || starOffset + starCount > stars.count) {
    throw new Error(
      `${slug}: stars ${starOffset}..${starOffset + starCount} outside stars.bin (${stars.count})`,
    )
  }
  if (swatches.count !== stars.count) {
    throw new Error(
      `swatches.bin holds ${swatches.count} records against stars.bin's ${stars.count}; ` +
        'star order is the swatch encoding (§2.2), so these must be the same run',
    )
  }

  const rows = rowCells.length
  const normals = new Float32Array(cardCount * 3)
  const rowOf = new Int32Array(cardCount)
  const swatchOf = new Float32Array(cardCount * 3)
  const hueCounts = new Array<number>(HUE_CLASSES).fill(0)

  for (let card = 0; card < cardCount; card += 1) {
    const star: StarIndex = starOffset + card
    const x = stars.x(star)
    const y = stars.y(star)
    const z = stars.z(star)

    // v3 writes a unit-sphere cell centre (§2.1) — but it writes it as three float16s, so what
    // comes back has |p| off 1 by up to 3.6e-4 on the shipped roster. Normalise: the shader reads
    // `iNormal` as a unit normal for the flat per-cell shade (§1.4), and `rowOfUnitY` is written
    // against the `y` of a unit vector and measures its 3.08x polar margin in that metric.
    const length = Math.sqrt(x * x + y * y + z * z)
    const scale = length > 0 ? 1 / length : 0
    const nx = x * scale
    const ny = y * scale
    const nz = z * scale

    normals[card * 3] = nx
    normals[card * 3 + 1] = ny
    normals[card * 3 + 2] = nz
    rowOf[card] = rowOfUnitY(ny, rows)

    const swatch = meanSwatch(swatches, star)
    swatchOf[card * 3] = swatch[0]
    swatchOf[card * 3 + 1] = swatch[1]
    swatchOf[card * 3 + 2] = swatch[2]

    const hue = stars.hueClass(star)
    hueCounts[hue] = (hueCounts[hue] ?? 0) + 1
  }

  return {
    planeSlug: slug,
    cardCount,
    rowCells,
    normals,
    rows: rowOf,
    swatches: swatchOf,
    hueCounts,
    // §1.3's law, not `plane.radius`. The two agree on v3 to 4.7e-7 — the shipped field is emitted
    // to six decimals from the same formula — so this is not a correction, it is a refusal to let
    // the renderer's geometry depend on a field that is also written by the retiring galaxy path
    // and that carried `log N` as recently as `dabe2c9a`. Deriving it means a dataset cannot move
    // the surface law without moving §1.3.
    radius: worldRadius(cardCount),
    // `home`, and named `home` rather than `centre` because that is all it is (DEC-804). A world's
    // centre is PRD 5.7.1's `planePosition` — this, plus PRD 5.3.15's drift, rotated by the
    // multiverse angle — and it moves every frame. Composition time is exactly where that value
    // cannot be known, so this carries the fixture and `WorldSurface.centre` carries the position.
    // The two were one field until leg G measured `radii` drifting 2.92 → 2.17 on a motionless rig.
    home: new Vector3(plane.home[0], plane.home[1], plane.home[2]),
    cardOf: options.cardOf ?? (() => null),
    // The multiverse-wide art key (§1.6). `starOffset` is already the identity `swatches.bin` is
    // encoded in star order against, and the checks above have just proved this window lies inside
    // `stars.bin` — so the keys this world claims cannot overlap another world's.
    artKeyBase: starOffset,
  }
}

/**
 * §2.2's 2x2 art statistic, reduced to the one linear-RGB triple `iSwatch` carries (§1.4).
 *
 * **The mean is taken in linear light, and that is not a formality.** `Swatches.linear` already
 * puts each of the four RGB565 samples through sRGB's transfer function, so averaging them here is
 * an average of light. Averaging the four *encoded* values first and linearising once afterwards —
 * the spelling you get by reaching for the packed `samples()` view — is wrong by up to **0.104 per
 * channel** across v3's 24,399 cards on worlds, mean 0.0079, because the transfer function is
 * convex and a 2x2 of an art crop is frequently high-contrast. A tenth of the range is the
 * difference between a card reading as its art and reading as a wash, and nothing about the result
 * looks broken — it just looks like the swatches are duller than the art.
 *
 * Which of the four to keep is not a question the spec leaves open in the other direction: `iSwatch`
 * is a `vec3` and shading is flat across a cell (§1.4), so there is no per-cell gradient for the
 * four corners to feed. They are a 2x2 so that §2.2's artefact can outlive this decision.
 */
function meanSwatch(swatches: Swatches, star: StarIndex): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  for (const corner of [0, 1, 2, 3] as const) {
    const sample = swatches.linear(star, corner)
    r += sample[0]
    g += sample[1]
    b += sample[2]
  }
  return [r / 4, g / 4, b / 4]
}

/** Every plane with a surface, in roster order — the set §3.1 calls `worldsWithCards`. */
export function worldPlanesOf(planes: readonly PlaneRecord[]): WorldPlane[] {
  return planes.filter(isWorldPlane)
}
