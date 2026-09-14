/**
 * Which cells get asked for art this frame (spec §1.6).
 *
 * Facing alone is not enough to decide who gets a layer: at the prototype's near view **2,753 cells
 * face the camera, the pool holds 1,024**, and half of those are behind the viewer's shoulder or
 * over the horizon. So the pass is three tests in a fixed order — facing, then the frustum, then
 * the quantile — and the order is not an optimisation.
 */

import { Matrix4, Vector3 } from 'three'

/**
 * A cell must face the camera by more than this to be a candidate (§1.6).
 *
 * Not zero: a cell at the exact limb is edge-on, contributes almost no pixels, and would churn a
 * layer in and out as the world spins.
 */
export const FACING_CUTOFF = 0.12

/**
 * The clip-space bound the frustum test uses, deliberately slack at 2 rather than 1 (§1.6).
 *
 * A cell is a quad with extent, and its *centre* is what is being tested; a centre just outside the
 * frame can still put half the cell on screen. Slack here costs a few fetches at the frame edge,
 * and tightness costs art popping in along it.
 */
export const CLIP_BOUND = 2

/** Scratch: this runs once per cell per frame over thousands of cells and must not allocate. */
const viewPoint = new Vector3()

/**
 * Whether a cell centre survives the frustum test.
 *
 * > **Normative — `Vector3.applyMatrix4` already divides by w (§1.6).** You cannot recover `w` from
 * > `.z` afterwards, so a single combined transform gives you no way to tell a point in front of
 * > the eye from one behind it. **The view-space rejection must happen before the projection**, or
 * > a point behind the eye divides by a negative `w` and folds back into the frame — where it reads
 * > as a perfectly ordinary on-screen cell, asks for art, and is never drawn. The symptom is a pool
 * > full of layers for the hemisphere you are not looking at.
 *
 * Hence two transforms rather than one `projectionMatrixWorld`: `matrixWorldInverse` first, the
 * `z > -near` rejection between them, `projectionMatrix` second.
 */
export function withinFrustum(
  x: number,
  y: number,
  z: number,
  matrixWorldInverse: Matrix4,
  projectionMatrix: Matrix4,
  near: number,
): boolean {
  viewPoint.set(x, y, z).applyMatrix4(matrixWorldInverse)
  // View space is right-handed with the eye looking down -z, so everything visible has z < -near.
  if (viewPoint.z > -near) return false
  viewPoint.applyMatrix4(projectionMatrix)
  return Math.abs(viewPoint.x) <= CLIP_BOUND && Math.abs(viewPoint.y) <= CLIP_BOUND
}

/** Whether a cell's outward normal faces the eye (§1.6). `toCamera` need not be normalised. */
export function facesCamera(
  nx: number,
  ny: number,
  nz: number,
  toCameraX: number,
  toCameraY: number,
  toCameraZ: number,
): boolean {
  const length = Math.hypot(toCameraX, toCameraY, toCameraZ)
  if (length === 0) return false
  const dot = (nx * toCameraX + ny * toCameraY + nz * toCameraZ) / length
  return dot > FACING_CUTOFF
}
