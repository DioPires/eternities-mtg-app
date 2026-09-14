/**
 * The `?probe=` payload (spec §3.1) — **normative renderer surface, owned by R1**.
 *
 * `worlds-gate.mjs` drives the product route with this seam and reads geometry from it; colour it
 * samples from the captured PNG instead, so every criterion measures the frame after tonemap and
 * vignette at presentation scale. Leg G consumes what is here and may not re-derive it — a gate that
 * recomputed these numbers would be asserting against its own model of the renderer rather than
 * against the shipped one.
 *
 * Everything in this file is free of three's renderer and free of GL: it takes the camera matrices
 * as data and returns plain objects. That is what lets the two normative distinctions below be
 * tested on a machine with no GPU.
 */

import { Matrix4, Vector3 } from 'three'

import type { ArtPoolReport } from './artPool'
import type { ArtStreamReport } from './artStream'
import type { ThresholdReport } from './adaptiveThreshold'
import type { Subdivision } from './cellGeometry'
import type { WorldsSeams } from './seams'

/** §1.4's ambient floor: no cell is ever fully black, so the night side still reads as surface. */
export const SHADE_AMBIENT = 0.1
/** §1.4's gain on the wrapped-lambert term. */
export const SHADE_GAIN = 0.95

/**
 * §1.4's shade scalar: `0.10 + 0.95 * clamp(dot(n, light) * 0.5 + 0.5, 0, 1)^2`.
 *
 * > **Normative — the probe reports this per cell (§3.1, DEC-749).** W2's second half cannot be
 * > measured without it: the criterion is the spread of `L*` over the **iso-shade subset**, and a
 * > gate with no shade term can only measure spread over the whole visible disc — which §3.1 shows
 * > cannot fail, because the wrapped-lambert gradient alone puts `IQR(L*)` between 11.9 and 21.6
 * > whatever the swatches do. It is the one probe field that is a *derived* quantity rather than a
 * > state read, and it is normative anyway, because the gate may not re-derive it.
 *
 * **Wrapped**, not clamped lambert: the `*0.5 + 0.5` maps the terminator to 0.25 rather than to 0,
 * which is what keeps a mosaic legible around the limb. Squaring it after the clamp, not before,
 * is what makes the falloff perceptual rather than linear.
 */
export function shadeOf(dotNormalLight: number): number {
  const wrapped = dotNormalLight * 0.5 + 0.5
  const clamped = wrapped < 0 ? 0 : wrapped > 1 ? 1 : wrapped
  return SHADE_AMBIENT + SHADE_GAIN * clamped * clamped
}

/** A screen-space axis-aligned bound, in CSS px, origin top-left. */
export interface ScreenRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One probe cell. **One entry per card**, never one per sub-quad (§3.1). */
export interface ProbeCell {
  /** The card's index within its world — the instance id, and the art pool's key. */
  readonly cell: number
  /** The axis-aligned bound of the projected sphere-following vertex grid. */
  readonly rect: ScreenRect
  /** §1.3's latitude band, as the contract publishes it. The gate never re-derives this. */
  readonly band: number
  /** §1.4's shade term at this cell's centre. See {@link shadeOf}. */
  readonly shade: number
  /**
   * Whether the frame **shows** art here.
   *
   * > **Normative — this is the cross-fade landing, not a layer being claimed (§1.6, DEC-752).** A
   * > cell whose `iArt` is mid-fade is showing its swatch. W4's numerator is what the frame shows,
   * > and reading residency instead is the bookkeeping-for-picture substitution the prototype's
   * > 1,031-resident-in-1,024 bug hid behind.
   */
  readonly showingArt: boolean
}

/** What `?probe=` publishes each frame. */
export interface ProbePayload {
  readonly cells: readonly ProbeCell[]
  readonly pool: ArtPoolReport
  readonly threshold: ThresholdReport
  readonly stream: ArtStreamReport
  /**
   * The seam read-backs, so the gate can check each control actually engaged (§1.6, DEC-752).
   *
   * Without them a seam that silently fails to parse its own query parameter runs the *unmodified*
   * policy, its criterion passes, and the matrix records a passing control.
   */
  readonly seams: WorldsSeams
  /** The clamped pool size the renderer actually allocated — what §1.12's ladder asserts against. */
  readonly layersAllocated: number
}

/**
 * The unit-sphere position of a point on a cell's parameter grid.
 *
 * The same parameterisation that placed the cell's centre: colatitude `theta_c + v * latArc`,
 * longitude `lambda_c + u * lonArc`, with `u, v` in `[-1, 1]`. Longitude is `atan2(x, z)`, which is
 * the convention `east = normalize(cross(Y, n))` runs along — the other spelling mirrors the world
 * between its two LOD representations (§1.4, DEC-749).
 */
export function cellGridPoint(
  colatitude: number,
  longitude: number,
  lonArc: number,
  latArc: number,
  u: number,
  v: number,
  out = new Vector3(),
): Vector3 {
  const theta = colatitude + v * latArc
  const lambda = longitude + u * lonArc
  const sinTheta = Math.sin(theta)
  return out.set(sinTheta * Math.sin(lambda), Math.cos(theta), sinTheta * Math.cos(lambda))
}

const point = new Vector3()

/**
 * The axis-aligned screen bound of a cell's **sphere-following vertex grid**.
 *
 * > **Normative — never the tangent quad's four corners (§3.1, DEC-749 on DEC-752's pin).** §1.4
 * > renders a grid of vertices that each sit *on* the lifted sphere; the flat quad is not what is
 * > drawn. The difference is **not** §1.3's corner lift, which measures radial float and is the
 * > wrong statistic for an extent: in arc length the two models agree to machine precision, because
 * > `iSize` *is* arc length, so a pin worded only as "the patch's extent, not the quad's" is
 * > vacuous. What differs is the projection — a patch spanning half-angle `γ` projects to its chord
 * > `2·sin γ` while the flat quad projects to `2γ`, a ratio of `γ/sin γ`: 1.0001 on Dominaria,
 * > 1.0115 at 30 cards, and **1.5708 at N = 1**.
 *
 * Returns `null` when no grid point survives the near plane — the same two-transform discipline
 * `cellSelection.withinFrustum` documents, for the same reason: `applyMatrix4` has already divided
 * by `w`, so a point behind the eye folds back into the frame and reads as an ordinary on-screen
 * cell.
 */
export function cellScreenRect(
  colatitude: number,
  longitude: number,
  lonArc: number,
  latArc: number,
  subdivision: Subdivision,
  worldCentre: Vector3,
  radius: number,
  matrixWorldInverse: Matrix4,
  projectionMatrix: Matrix4,
  near: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): ScreenRect | null {
  const { kLon, kLat } = subdivision
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let seen = 0

  for (let j = 0; j <= kLat; j += 1) {
    const v = (j / kLat) * 2 - 1
    for (let i = 0; i <= kLon; i += 1) {
      const u = (i / kLon) * 2 - 1
      cellGridPoint(colatitude, longitude, lonArc, latArc, u, v, point)
      point.multiplyScalar(radius).add(worldCentre).applyMatrix4(matrixWorldInverse)
      // Before the projection, never after — see the header.
      if (point.z > -near) continue
      point.applyMatrix4(projectionMatrix)
      const sx = (point.x * 0.5 + 0.5) * viewportWidthPx
      // NDC +y is up and the screen's +y is down, so this flips rather than merely scaling.
      const sy = (0.5 - point.y * 0.5) * viewportHeightPx
      if (sx < minX) minX = sx
      if (sx > maxX) maxX = sx
      if (sy < minY) minY = sy
      if (sy > maxY) maxY = sy
      seen += 1
    }
  }

  if (seen === 0) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * The per-cell records, given everything the renderer already has.
 *
 * > **Normative — one entry per card (§3.1).** §1.4 subdivides the *base geometry* of the instanced
 * > draw, so the instance count survives the re-mesh untouched and `cells.length` is the world's
 * > `cardCount` whatever `k` is. A payload that grew with the subdivision would make every one of
 * > G's per-cell criteria measure sub-quads, and W1's floor — a count of cells above a pixel height
 * > — would pass by counting the same card up to 512 times.
 */
export function buildProbeCells(
  cardCount: number,
  read: (cell: number) => Omit<ProbeCell, 'cell'> | null,
): ProbeCell[] {
  const cells: ProbeCell[] = []
  for (let cell = 0; cell < cardCount; cell += 1) {
    const record = read(cell)
    if (record === null) continue
    cells.push({ cell, ...record })
  }
  return cells
}
