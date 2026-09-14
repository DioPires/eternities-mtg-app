/**
 * §1.7's key light, as the one direction the sheet and the probe both read.
 *
 * > **Normative — the key light is camera-relative (§1.7).** Offset **+0.72 rad in azimuth and
 * > +0.38 rad in elevation from the view direction**, which puts it **0.798 rad off the camera
 * > axis**. A fixed world-space sun is more honest to a solar system and useless for looking at a
 * > map: with the camera free to orbit, the subject is on its own night side half the time and half
 * > of every capture set is black. §1.7 promotes the prototype's stated fake to a product decision;
 * > §5 Q6 is the owner's chance to take the other answer.
 *
 * **Why this is R1's file even though §4 gives §1.7 to R2.** R2 owns the *rim* — the additive
 * `BackSide` shell at 1.055x radius. What is needed here is the light **vector**, and §3.1 makes
 * the per-cell `shade` term computed from it a normative R1 probe field that the gate may not
 * re-derive. Leaving the vector to R2 would mean shipping a placeholder light through R1's
 * measured surface, and a placeholder that reads as a real answer is the failure mode `?probe=`
 * exists to prevent: the picture stays lit, `shade` stays plausible, and W2's lightness half is
 * then a pairing between a shade computed from a fiction and a colour sampled from the frame.
 *
 * **The basis is the camera's own, not the world's.** "Camera-relative" is the whole point of the
 * offset, so azimuth turns about the *camera's* up axis rather than about world +Y. The two agree
 * only while the camera is level, and the rig does not keep it level. The construction is the one
 * `docs/worlds/surface-law-check.py` derives its quartiles from: a camera-local frame whose `+z` is
 * the direction back towards the viewer — front-facing cells are the ones with `n.z > 0` there, and
 * that is three's camera basis exactly. The light's `z` component is `cos(el)cos(az)` in both, which
 * is the same 0.798 rad separation checked against the same figure on both sides.
 */

import { Vector3, type Matrix4 } from 'three'

/** §1.7's two offsets, in radians. */
export const KEY_LIGHT_AZIMUTH = 0.72
export const KEY_LIGHT_ELEVATION = 0.38

/**
 * The angle between the key light and the camera axis — §1.7's derived constant.
 *
 * Not `hypot(azimuth, elevation)`: composing a turn about `up` with a turn about `right` is not the
 * same as adding the angles, and the difference here is 0.814 against 0.798. Stated so that a
 * reader who reaches for the Euclidean sum finds the correction rather than a plausible number.
 */
export const KEY_LIGHT_OFF_AXIS = Math.acos(
  Math.cos(KEY_LIGHT_ELEVATION) * Math.cos(KEY_LIGHT_AZIMUTH),
)

/**
 * Write the key light's world-space direction into `out`.
 *
 * The vector points **from the surface toward the light**, which is the sense `cellShaders`' own
 * `dot(normalize(vNormal), normalize(uLight))` reads and the sense `worldsProbe`'s `shade` reads.
 * At zero offset it is the direction from the subject back to the camera, so a cell facing the
 * viewer is the brightest — invert it and the front-facing cap of every world goes dark while
 * nothing in the pipeline errors.
 *
 * @param cameraMatrixWorld the camera's world matrix; its three basis columns are the frame
 */
export function keyLightDirection(cameraMatrixWorld: Matrix4, out: Vector3): Vector3 {
  const e = cameraMatrixWorld.elements
  const cosElevation = Math.cos(KEY_LIGHT_ELEVATION)
  const right = cosElevation * Math.sin(KEY_LIGHT_AZIMUTH)
  const up = Math.sin(KEY_LIGHT_ELEVATION)
  // three's camera looks down its own **-z**, so `+z` — the third basis column — is the direction
  // from the subject back towards the viewer. This is the term that carries the "light sits behind
  // the camera" half of §1.7, and taking the forward column instead lights the far side.
  const back = cosElevation * Math.cos(KEY_LIGHT_AZIMUTH)
  out.set(
    right * (e[0] ?? 0) + up * (e[4] ?? 0) + back * (e[8] ?? 0),
    right * (e[1] ?? 0) + up * (e[5] ?? 0) + back * (e[9] ?? 0),
    right * (e[2] ?? 0) + up * (e[6] ?? 0) + back * (e[10] ?? 0),
  )
  // The basis is orthonormal on any camera the rig builds, so this is a no-op there — but a caller
  // that hands in a scaled matrix would otherwise get a light whose length scales the lambert term,
  // which is a brightness bug with no wrong geometry attached to it.
  const length = out.length()
  return length > 0 ? out.multiplyScalar(1 / length) : out.set(0, 0, 1)
}
