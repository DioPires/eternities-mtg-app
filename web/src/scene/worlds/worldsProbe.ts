/**
 * `window.__eternitiesProbe.worlds()` — the served `?probe=` payload (spec §3.1).
 *
 * `probePayload.ts` holds the geometry primitives; this is the thing leg G actually calls. The split
 * is the same one `probe.ts`/`probeSeam.ts` already make: what the seam *offers* is separate from
 * what fills it, so the payload's shape can be tested with no renderer and no GL.
 *
 * > **Normative — this is R1's surface and leg G may not re-derive any of it (DEC-744 B1, DEC-746
 * > D5).** A gate that recomputed these numbers would be asserting against its own model of the
 * > renderer rather than against the shipped one, and would stay green on a renderer that had
 * > drifted away from the model. The corollary is that a *missing* seam must be loud: `worlds()`
 * > returns `undefined` when no world is composed, which leg G reports as a setup failure — a
 * > different verdict from a criterion going red.
 *
 * The shape is `docs/worlds/gate-seam-contract.md`'s, written by leg G before this leg started and
 * reconciled here. Two deliberate differences from that document, both additive:
 *
 * 1. **`rect` survives alongside `x`/`y`/`height`.** §3.1 says the probe reports a cell's
 *    screen-space *rect*; the contract only asks for the centre and the height. Both ship, and
 *    `height === rect.height` by construction rather than by coincidence.
 * 2. **`seams` is present.** DEC-752 established that every control seam must report a value the
 *    gate can check moved, or a seam that silently fails to parse its own query parameter runs the
 *    unmodified policy and the matrix records a *passing* control.
 */

import { Matrix4, Vector3 } from 'three'

import type { ArtPoolReport } from './artPool'
import type { Subdivision } from './cellGeometry'
import type { ThresholdReport } from './adaptiveThreshold'
import type { WorldsSeams } from './seams'
import { facesCamera, withinFrustum } from './cellSelection'
import { cellGridPoint, cellScreenRect, shadeOf, type ScreenRect } from './probePayload'
import {
  bandBoundaries,
  bandOfCosTheta,
  bandShares,
  cellDrawAngles,
  drawRadius,
  rowColatitude,
  rowOfUnitY,
} from './surfaceLaw'

/**
 * The cross-fade value at which a cell is **showing** art (§1.6).
 *
 * > **Normative — this is the fade landing, not a layer being claimed (DEC-752).** A cell that has
 * > been handed a pool layer but is still fading is showing its *swatch*, and W4's numerator is what
 * > the frame shows. Reading residency instead is the bookkeeping-for-picture substitution that the
 * > prototype's impossible "1,031 resident in a 1,024-layer pool" hid behind for a whole phase.
 */
export const ART_SHOWN_AT = 1

/** One cell, as leg G reads it. */
export interface WorldsProbeCell {
  /** The card's index within its world — the instance id, and the art pool's key. */
  readonly cell: number
  /** §3.1's screen-space rect: the bound of the projected sphere-following vertex grid. */
  readonly rect: ScreenRect
  /**
   * The cell **centre** in CSS px — the projected centre point, *not* the centre of {@link rect}.
   *
   * > The two are not the same and the difference is not rounding: measured over v3 at 1920x1080 the
   * > rect's centre sits a mean 1.3–10.3% of a cell height away from the projected centre and as far
   * > as **27.8%** (Ravnica, row 42 of 49, 3.5 radii), because a spherical patch projects to a
   * > *curved* outline whose bounding box is not centred on it.
   *
   * > It is the projected centre that ships, for a reason that is not about which pixel is "more
   * > correct": {@link shade} is evaluated at exactly this point, and leg G samples the captured PNG
   * > at `(x, y)` to get the cell's colour. W2's lightness half pairs those two readings per cell
   * > over the iso-shade subset, so they have to be readings of the *same point* or the pairing is
   * > between a shade here and a colour somewhere else.
   *
   * > **What this is not.** The rect's centre was checked against the alternative and it does not
   * > land off its own cell: point-in-polygon against the projected patch outline over Dominaria,
   * > Ravnica, Alara and Rabiah at 2.2 and 3.5 radii is **0 of 4,803 samples** outside, with a
   * > negative control — the same point pushed down one cell height — reading outside **4,803 of
   * > 4,803**. So this is a consistency fix, not a repair of a wrong sample, and it is recorded that
   * > way rather than as a bug that was never demonstrated.
   */
  readonly x: number
  readonly y: number
  /** On-screen height in CSS px — W1's statistic and W2's >= 6 px cut. Always `rect.height`. */
  readonly height: number
  /** Index into {@link BAND_ORDER}'s 13-band chain. **Not** a colour class — see that constant. */
  readonly band: number
  /** §1.4's shade term at this cell's centre, as the renderer computes it. */
  readonly shade: number
  /** `dot(normal, toCamera) > 0.12` — §1.6's own facing test, not a re-derivation of it. */
  readonly frontFacing: boolean
  /** Passed §1.6's frustum test. **Reported, not filtered**: W4's denominator needs it explicitly. */
  readonly onScreen: boolean
  /** Above the **effective** threshold this frame, which under §1.6's quantile is not 24 px. */
  readonly wantsArt: boolean
  /** Resolved to art and cross-faded in. See {@link ART_SHOWN_AT}. */
  readonly showingArt: boolean
}

/** The pool, flattened to the four numbers §3.1's W4 row and §1.12's ladder read. */
export interface WorldsProbePool {
  /**
   * The **clamped** layer count — `max(0, min(tierLayers, maxLayers − 32))`, never the tier constant.
   *
   * The outer `max(0, ...)` is load-bearing: `capabilities.ts` reports `maxArrayTextureLayers` as
   * **0** on a non-WebGL2 or lost context, which makes the inner expression −32 at every tier. `0`
   * is a legal value and means a swatch-only world, which the gate treats as a measurement rather
   * than as a setup failure.
   */
  readonly layers: number
  /** Asserted `<= layers` in `artPool`'s own test — the 1,031-in-1,024 bug this catches. */
  readonly resident: number
  /** CSS px. Reads exactly 24 under `?artThreshold=fixed24`, which is how the gate proves the seam took. */
  readonly effectiveThresholdPx: number
  /** Cumulative since page load, monotonic. The gate **differences** it; it never resets. */
  readonly evictions: number
}

/** What `?probe=` publishes for the focused world. */
export interface WorldsProbe {
  /** The plane in focus, or `null` at the home view. */
  readonly planeSlug: string | null
  /** Camera distance in units of the plane's radius — W1 and W4 are both specified at a pose. */
  readonly radii: number
  /** CSS px. Must match the screenshot's dimensions at dpr 1, or every colour sample is off. */
  readonly viewport: { readonly width: number; readonly height: number }
  /**
   * **Cells are reported for the focused plane only**, one entry per **card**.
   *
   * W1 flies to each world in turn and takes its statistic per plane; a single pooled array across
   * the system would make the per-plane median unrecoverable, and W1's verdict is the *worst* plane
   * rather than the pooled one. One entry per card — never one per sub-quad — because §1.4
   * subdivides the *base* geometry, so a payload that walked facets would multiply W1's sample
   * count by `k²` and divide its median height, on 32 of v3's 45 worlds at once.
   */
  readonly cells: readonly WorldsProbeCell[]
  readonly pool: WorldsProbePool
  /** Per band index, that band's share of the plane's cards. Gates W3's 5% rule. */
  readonly bandShares: readonly number[]
  /** The control-seam read-backs, so the gate can check each control actually engaged (§1.6). */
  readonly seams: WorldsSeams
}

/** The camera, as data — so the payload can be assembled on a machine with no GPU. */
export interface ProbeCamera {
  readonly matrixWorldInverse: Matrix4
  readonly projectionMatrix: Matrix4
  readonly position: Vector3
  readonly near: number
}

/**
 * Everything the payload needs from a composed world.
 *
 * This is the seam **world composition** fills. It is deliberately the smallest set that cannot be
 * derived from the rest: the cell's colatitude, longitude, row and band all fall out of its decoded
 * normal plus the published `rowCells`, so none of them are accessors here. In particular `rowOf` is
 * absent on purpose — {@link rowOfUnitY} is the client's own nearest-row match, and a source that
 * supplied its own row would be a second model of §2.1 sitting next to the first.
 */
export interface WorldsProbeSource {
  readonly planeSlug: string | null
  readonly cardCount: number
  /** The world's **published** `rowCells` (§2.4), never one recomputed on the client. */
  readonly rowCells: readonly number[]
  /** Write cell `i`'s decoded unit-sphere centre into `out`. */
  readonly normalOf: (cell: number, out: Vector3) => Vector3
  /** Per {@link HueClass}, the plane's card count in that class — {@link bandShares}' input. */
  readonly hueCounts: readonly number[]
  readonly subdivision: Subdivision
  readonly centre: Vector3
  /** The world's radius in scene units, **before** §1.4's lift. */
  readonly radius: number
  /** §1.7's key light, as a unit vector in world space. */
  readonly lightDirection: Vector3
  readonly camera: ProbeCamera
  readonly viewport: { readonly width: number; readonly height: number }
  readonly pool: ArtPoolReport
  readonly threshold: ThresholdReport
  readonly seams: WorldsSeams
  /** Cell `i`'s `iArt` cross-fade, 0 = swatch, 1 = art. */
  readonly artOf: (cell: number) => number
}

/**
 * The seam's whole contract in one place: a composed world yields a payload, nothing yields
 * `undefined`.
 *
 * Extracted from the install so it can be asserted without a renderer. The distinction it carries is
 * the one leg G branches on — **`undefined` is a setup failure, an empty `cells` array is a world
 * that drew nothing** — and collapsing the two is how a page with no worlds on it would score a
 * green matrix.
 */
export function worldsProbeOf(
  source: WorldsProbeSource | null | undefined,
): WorldsProbe | undefined {
  return source ? buildWorldsProbe(source) : undefined
}

const normal = new Vector3()
const worldPoint = new Vector3()
const toCamera = new Vector3()
const centrePoint = new Vector3()

/**
 * Assemble the payload for one composed world.
 *
 * > **Normative — the arcs and radius are the ones the sheet DRAWS at (DEC-749).** This reads
 * > {@link cellDrawAngles} and {@link drawRadius}, never the cell's nominal extents or the world's
 * > unlifted radius. The un-inset angles over-report every cell by **7.5%** and the unlifted radius
 * > under-reports by 0.6%, and both land on exactly the two numbers that are scored — W1's pixel
 * > floor and §1.11's 24 px proxy. Neither shows up as a wrong picture, because the picture is drawn
 * > by the shader and only the *measurement* moves.
 */
export function buildWorldsProbe(source: WorldsProbeSource): WorldsProbe {
  const { rowCells, subdivision, camera, viewport, radius } = source
  const rows = rowCells.length
  const lifted = drawRadius(radius)
  const edges = bandBoundaries(source.hueCounts)
  const threshold = source.threshold.effectiveThresholdPx

  const cells: WorldsProbeCell[] = []
  for (let cell = 0; cell < source.cardCount; cell += 1) {
    source.normalOf(cell, normal)
    const row = rowOfUnitY(normal.y, rows)
    const angles = cellDrawAngles(rowCells, row)
    // The row's colatitude, not `acos(n.y)`: §2.1 matches a cell to its row by NEAREST, and the
    // decoded float16 centre sits a little off the row's exact latitude. Drawing from the row is
    // what keeps the probe's parameterisation identical to the shader's.
    const colatitude = rowColatitude(row, rows)
    // `atan2(x, z)`, the convention `eastOf` runs along. The other spelling mirrors the world
    // between its two LOD representations (§1.4).
    const longitude = Math.atan2(normal.x, normal.z)

    const rect = cellScreenRect(
      colatitude,
      longitude,
      angles.lon,
      angles.lat,
      subdivision,
      source.centre,
      lifted,
      camera.matrixWorldInverse,
      camera.projectionMatrix,
      camera.near,
      viewport.width,
      viewport.height,
    )
    if (rect === null) continue

    worldPoint.copy(normal).multiplyScalar(lifted).add(source.centre)
    toCamera.copy(camera.position).sub(worldPoint)
    const frontFacing = facesCamera(
      normal.x,
      normal.y,
      normal.z,
      toCamera.x,
      toCamera.y,
      toCamera.z,
    )
    const onScreen = withinFrustum(
      worldPoint.x,
      worldPoint.y,
      worldPoint.z,
      camera.matrixWorldInverse,
      camera.projectionMatrix,
      camera.near,
    )

    // The projected centre, not the rect's — see `WorldsProbeCell.x`. Same two-transform discipline
    // as `cellScreenRect`: the view-space rejection happens before the projection, or a point behind
    // the eye folds back into the frame and reads as an ordinary on-screen cell.
    cellGridPoint(colatitude, longitude, angles.lon, angles.lat, 0, 0, centrePoint)
    centrePoint.multiplyScalar(lifted).add(source.centre).applyMatrix4(camera.matrixWorldInverse)
    if (centrePoint.z > -camera.near) continue
    centrePoint.applyMatrix4(camera.projectionMatrix)

    const art = source.artOf(cell)
    cells.push({
      cell,
      rect,
      x: (centrePoint.x * 0.5 + 0.5) * viewport.width,
      // NDC +y is up and the screen's +y is down, so this flips rather than merely scaling.
      y: (0.5 - centrePoint.y * 0.5) * viewport.height,
      height: rect.height,
      band: bandOfCosTheta(Math.cos(colatitude), edges),
      shade: shadeOf(normal.dot(source.lightDirection)),
      frontFacing,
      onScreen,
      wantsArt: rect.height >= threshold,
      showingArt: art >= ART_SHOWN_AT,
    })
  }

  return {
    planeSlug: source.planeSlug,
    radii: radius > 0 ? camera.position.distanceTo(source.centre) / radius : 0,
    viewport: { width: viewport.width, height: viewport.height },
    cells,
    pool: {
      layers: source.pool.layers,
      resident: source.pool.resident,
      effectiveThresholdPx: threshold,
      evictions: source.pool.evictions,
    },
    bandShares: bandShares(source.hueCounts),
    seams: source.seams,
  }
}
