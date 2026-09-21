/**
 * A world's orientation: the pole axis, the spin about it, and the plane's tilt (spec §1.3, §2.4).
 *
 * §4 gives R2 §1.7–§1.9 and none of those sections mentions spin — but every one of them needs an
 * *orientation*. §1.8's system instance samples the equirect layer by object-space direction, so a
 * world that carries no rotation is a world frozen at system distance while its cell sheet turns
 * (or the reverse). One law, in one file, read by the sheet, the instance and the atmosphere alike.
 *
 * ---
 *
 * > **Normative — the spin axis is the pole axis, `±Y` (CEO ruling, DEC-750, on DEC-749's open
 * > flag).** §1.3's surface law is stated about `±Y`: `rowOfUnitY` matches a cell to its row by the
 * > `y` of its unit normal, `eastOf` builds the tangent frame as `cross(Y, n)`, and §1.3's thirteen
 * > latitude bands are equal-area in `cos θ` measured from `+Y`. A world spun about any other axis
 * > carries its ice caps around the sky: the bands stop being latitudes, and W3 — "latitude reads as
 * > colour" — stops being a statement about a fixed thing.
 *
 * **`starfield/motion.ts` disagreed, and the measurement said it was the one that was wrong — so it
 * moved (DEC-774).** The galaxy path rotated a plane's stars in `(x, y)` — about plane-local **Z** —
 * and took its shear radius as `length(p.xy)`; its vertex twin (`starfield/shaders.ts`) and the
 * camera's mirror (`camera/motion.ts`) did the same, and a third site read the disc normal as
 * `quatRotate(tilt, vec3(0,0,1))`. The CEO's default ruling anticipated a conflict between that
 * convention and this one. There was no conflict to trade off, because plane-local Z is not the
 * galaxy's own disc normal either:
 *
 * | measurement | result |
 * |---|---|
 * | v2 generator (`layout.py` at `9feab8f~1`, lines 265–270) | `x = r·cos θ`, `z = r·sin θ`, `y = gaussian·thickness` |
 * | v2 `stars.bin` (`dabe2c9a68b4d799`), dominaria, 3,000 stars | `sd(x) 0.3375`, `sd(z) 0.3368`, **`sd(y) 0.0504`** |
 * | v3 `stars.bin` (`c9468f1125bcddff`), dominaria, 3,000 cells | `\|p\| = 1.0000 ± 1.4e-4` — the unit sphere |
 *
 * The v2 spiral disc lies in the **XZ plane** with its normal along plane-local **+Y**, and the arm
 * angle `θ` it is generated from is `atan2(z, x)`. So the shipped rotation is about an axis lying
 * *in* the disc: over `spinPeriodS` (138–205 s on the roster) it turns the disc end over end rather
 * than in its own plane. That is a pre-existing galaxy defect, not a convention this leg must
 * respect — and on both contract versions the pole axis is the same `+Y` §1.3 names.
 *
 * **It was deliberately not fixed here**, because `visual-gate.mjs` was the shipped instrument
 * until §3.2's cutover and the galaxy's spin axis sat inside every one of its baselines. Reported
 * to the CEO as its own leg instead (DEC-750 hand-back) and carried out there, after the cutover,
 * on DEC-774: the disc-normal site retired with the plane-glow program at the cutover, and the
 * three that survive — the CPU mirror, its vertex twin and `camera/motion.ts` — now spin about
 * plane-local **+Y**, the axis this file names.
 *
 * **Two further differences between that mirror and this law were closed on DEC-873.** The mirror
 * applied `tilt` unconditionally where {@link planeOrientation} gates it on
 * {@link APPLY_PLANE_TILT}, and it carried PRD 5.3.13's multiverse rotation into the plane-local
 * offset where `WorldSurface` applies that rotation only to the centre. Measured over the v3
 * roster — 87 worlds × 64 cell directions, cell-to-cell chord in units of the world's own radius —
 * the tilt term was worth up to **0.86 radii** at every instant, and the multiverse term grew with
 * the angle: 0.05 radii at t=10 s, 0.31 at 60 s, 1.41 at 300 s, 2.00 at the half turn. They
 * mattered because on a v3 dataset a star record *is* a cell centre (§2.1), so the focused card,
 * its tether and the fly-to target are all points meant to sit on the drawn globe. The mirror now
 * reads {@link appliedTilt} and rotates only the centre — **except for the dust plane**, whose
 * drawn twin is §1.8's belt, which DEC-814 turns *as an object*: there the rotation still carries
 * the offset, because that is what is drawn.
 *
 * ---
 *
 * **Order is `tilt ∘ spin`, not `spin ∘ tilt`.** The spin turns the world about *its own* pole and
 * the tilt then carries that pole wherever the plane's quaternion points it — which is what makes
 * `tilt` mean "this world's axis leans" rather than "this world precesses". Composed the other way
 * the pole axis stays world-`+Y` for every plane and `tilt` becomes a per-frame wobble; the
 * silhouette is identical, because a sphere is a sphere, and only the mosaic moves.
 */

import { Quaternion, Vector3 } from 'three'

import type { PlaneRecord } from '../../data/types'

/**
 * The pole axis, in a world's own frame — §1.3's `Y`.
 *
 * Exported so that the sheet, the system instance and `surface-law-check.py`'s twin all name the
 * same axis rather than each spelling `(0, 1, 0)` inline. A constant that is spelled three times is
 * a constant that can drift twice.
 */
export const WORLD_POLE_AXIS = new Vector3(0, 1, 0)

/** Scratch, so the composition allocates nothing per world per frame (PRD 7.3.2). */
const spinQuaternion = new Quaternion()

/**
 * Compose a world's orientation from its tilt and its accumulated spin angle.
 *
 * @param tilt       `planes.json`'s quaternion, `[x, y, z, w]` (§2.4 keeps it under v3)
 * @param spinAngle  the accumulated angle in radians — **the plane table's, never a second clock**.
 *                   `PlaneTable.advance` already integrates `2π/spinPeriodS · spinDirection ·
 *                   spinScale · motion` and mirrors it into the camera rig, so a worlds path that
 *                   integrated its own would put the cell under the reticle in a different place
 *                   from the one PRD 8.5.7's CPU mirror flies the camera to.
 * @param out        written in place; returned for chaining
 */
export function worldOrientation(
  tilt: readonly [number, number, number, number],
  spinAngle: number,
  out: Quaternion,
): Quaternion {
  spinQuaternion.setFromAxisAngle(WORLD_POLE_AXIS, spinAngle)
  return out.set(tilt[0], tilt[1], tilt[2], tilt[3]).multiply(spinQuaternion)
}

/** The spin angle of every plane this frame, by `PlaneRecord.index`. See {@link worldOrientation}. */
export type SpinAngleSource = (planeIndex: number) => number

/** A world that never turns — the honest default before the plane table has been handed over. */
export const NO_SPIN: SpinAngleSource = () => 0

/** An unrotated tilt, so {@link planeOrientation} has one code path under either answer below. */
const NO_TILT: readonly [number, number, number, number] = [0, 0, 0, 1]

/**
 * Whether a world's `tilt` quaternion is applied — **open, and deliberately off (DEC-750)**.
 *
 * §2.4's retirement table keeps `tilt` under v3, the prototype applied it to its system instances,
 * and leaving it off means all 45 worlds carry their ice caps at world `+Y`, which is an
 * artificiality §1.3's banded surface makes very visible. So the case for turning it on is real.
 *
 * It is off because **no section asks R2 to turn it on and turning it on is not free.** §1.7–§1.9
 * are this leg's scope and none of them mentions tilt; §1.3's surface law is stated in the world's
 * own frame and is indifferent to it. What tilt *does* move is which cells face the camera at a
 * given pose — and that is the input to §1.6's admission quantile, so it shifts R1's measured
 * threshold poses (`worlds-attach.test.ts`'s swept overshoot and wobble rows, both derived by
 * search rather than guessed) and every baseline leg G is capturing right now, mid-cutover.
 *
 * A one-line change with a ruling behind it is cheaper than an unasked-for one that lands in three
 * other legs' numbers. Flagged on DEC-750's hand-back. `worlds-spin.test.ts` drives both settings,
 * so the answer costs a constant either way.
 */
export const APPLY_PLANE_TILT = false

/**
 * {@link worldOrientation} for a `PlaneRecord`, reading the frame's spin angle for its index.
 *
 * **The one call site for a world's orientation, and that is the point.** The cell sheet (§1.4) and
 * the system icosphere (§1.8) are two representations of the same globe that cross-fade into each
 * other over §1.5's band, so an orientation either of them derives on its own is an orientation the
 * two can disagree about — and inside the band that disagreement is drawn twice, at once, as a
 * smear. Both go through here.
 */
export function planeOrientation(
  plane: PlaneRecord,
  spinAngleOf: SpinAngleSource,
  out: Quaternion,
): Quaternion {
  return worldOrientation(appliedTilt(plane), spinAngleOf(plane.index), out)
}

/**
 * The tilt a plane is actually drawn with: `plane.tilt` when {@link APPLY_PLANE_TILT} is set, the
 * identity otherwise.
 *
 * Exported for the camera's mirror (`camera/motion.ts`), which places the focused card and the
 * fly-to target on the drawn globe and so has to read the same gate (DEC-873). One predicate,
 * read by both, rather than two spellings of the flag that agree only until one of them moves.
 */
export function appliedTilt(plane: PlaneRecord): readonly [number, number, number, number] {
  return APPLY_PLANE_TILT ? plane.tilt : NO_TILT
}
