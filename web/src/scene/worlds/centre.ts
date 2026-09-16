/**
 * Where a world **is**, this frame (spec §1.2, §1.9, §3.1; PRD 5.3.15, 5.7.1; DEC-804).
 *
 * The companion to `spin.ts`. That file answers "which way is this world turned"; this one answers
 * "where is it", and both exist for the same reason: a quantity every pass in §1.2 needs, derived
 * once, so that two passes cannot disagree about one globe.
 *
 * ---
 *
 * > **Normative — a world's centre is PRD 5.7.1's `planePosition`, and the worlds scene never had
 * > it (DEC-804).** `planes.json`'s `home` is a **fixture**: PRD 5.3.15 drifts a plane in a small
 * > slow orbit around it and PRD 8.5.3 then rotates the whole multiverse about `+Y`, so `home` is
 * > where a world would be if the scene were stopped at t=0. The galaxy path has always known this
 * > — `starfield/shaders.ts` applies `uMultiverseAngle` in the vertex shader and
 * > `camera/motion.ts`'s `planePosition` is its CPU mirror, which is what the rig tethers to. The
 * > worlds scene did not: `worldSource.ts` snapshotted `home` at composition time, and
 * > `attachWorlds` contained **no reader of `multiverseAngle` at all**.
 * >
 * > So the camera orbited and the worlds stood still. Measured on the shipped build by leg G's
 * > acceptance run (DEC-804, evidence comment `3410ba98`; leg G's own tables land with leg G and
 * > are not on main): on a settled, motionless rig `cameraDistance` held at
 * > 31.9293 to four decimals while `radii` ran 2.9203 → 2.1687 over 17.5 s on `dominaria`, and
 * > 3.5140 → **17.4112** on `azgol`. The error scales with `|home| / radius`, which is what it must
 * > do when the camera is flying a circle the world is not on. The visible half is a capture of the
 * > focused world sitting in the corner of the frame with the camera aimed at empty space.
 *
 * **One law, not one copy of it per consumer.** The rotation is applied in exactly one place — the
 * {@link PlaneCentreSource} the scene host hands in, which is `SceneMotion.planePosition` itself.
 * Every pass that needs a centre (§1.4's cell sheet, §1.7's atmosphere, §1.8's system instance,
 * §1.9's tether, §3.1's probe) reads it through that one function. A second spelling of `rotateY`
 * inside the worlds scene would be a second integration of the same angle, and the two agree only
 * for as long as nobody edits either — the failure `motionSync.ts` exists to prevent one level up.
 *
 * ---
 *
 * > **Normative — §1.8's belt turns with the multiverse too (DEC-814, DEC-813).** PRD 5.3.13 —
 * > *"the entire multiverse rotates about its vertical axis"* — grants no exemption, and PRD 8.5.3
 * > applies that rotation to every star. The belt's points **are** star records: the dust plane's
 * > own 4,204, scaled by `multiverseRadius` (§1.8, §2.1). The old star renderer rotated them in the
 * > vertex shader along with everything else; the worlds rewrite left them in the t=0 frame, which
 * > is a regression and not a recorded decision.
 * >
 * > It is visible because the belt is heavily clumped in azimuth — one arc per set, 36-bin histogram
 * > min 6 / max 314, chi-square 1952.4 on df 35 (DEC-813) — so a fixed belt shears a **full turn**
 * > against every world per `MULTIVERSE_PERIOD_S`. PRD 5.3.13 names the background parallax as the
 * > fixed reference, not the belt: the belt is data, 14.70% of everything on v3.
 *
 * {@link MultiverseAngleSource} is the second spelling of the one law, and it exists because the
 * belt is the one object in §1.2 with **no centre to be placed at**. Its 4,204 points are positions
 * around the system origin rather than one position that moves, so there is nothing for a
 * `PlaneCentreSource` to write into — the rotation has to reach it as an angle, applied to the
 * object. What must not differ is the *number*: the host hands over
 * `SceneMotion.multiverseRotation`, the same field the `planePosition` above rotates by, read rather
 * than re-integrated. `docs/camera-and-labels.md` §2 exists because two copies of a motion function
 * drift apart.
 */

import type { Vector3 } from 'three'

import type { PlaneRecord } from '../../data/types'

/**
 * A plane's world-space centre this frame, written into `out`.
 *
 * Shaped like {@link SpinAngleSource} and pushed in the same way, for the same reason: the worlds
 * scene must not run a clock. `PlaneTable.advance` integrates the multiverse angle in the
 * `planeTable` phase, `motionSync` mirrors it into the rig's `SceneMotion`, and the `worlds` phase
 * runs after both — so a centre read through here is the same frame's as the position PRD 8.5.7's
 * CPU mirror flies the camera to.
 */
export type PlaneCentreSource = (plane: PlaneRecord, out: Vector3) => Vector3

/**
 * `planes.json`'s `home`, unrotated and undrifted — the honest state **before** the motion mirror
 * has been handed over, and a bug at any other time.
 *
 * This is the pre-DEC-804 behaviour, kept as the default for the same narrow reason `NO_SPIN` is:
 * a roster can compose before the navigation exists, and at t=0 with no drift `planePosition` *is*
 * `home`, so this is not a stub standing in for the law — it is the law's own value at the only
 * moment it can be read without the law.
 *
 * > **It is still the exact shape of a cold-start default made permanent (DEC-772's `cardOf`).** If
 * > nothing ever calls {@link WorldsAttachment.setPlaneCentres}, every world silently reverts to
 * > DEC-804 and the only symptom is a number drifting. That is why `worlds-centre.test.ts` drives
 * > the composition through the **scene host** rather than through `attachWorlds` directly, and why
 * > this constant is exported: the mutation control the CEO asked for is `setPlaneCentres(PLANE_HOME)`,
 * > and it has to be spellable.
 */
export const PLANE_HOME: PlaneCentreSource = (plane, out) =>
  out.set(plane.home[0], plane.home[1], plane.home[2])

/**
 * PRD 8.5.3's accumulated multiverse angle, in radians, this frame (DEC-814).
 *
 * The companion to {@link PlaneCentreSource} for the one object that has no centre — see this file's
 * header. Shaped as a getter and pushed in the same way, for the same reason: **the worlds scene
 * must not run a clock.** `PlaneTable.advance` integrates the angle in the `planeTable` phase,
 * `motionSync` mirrors it into the rig's `SceneMotion`, and the `worlds` phase runs after both, so
 * an angle read through here is the same frame's as the rotation `planePosition` has already applied
 * to every world.
 */
export type MultiverseAngleSource = () => number

/**
 * The multiverse stopped at t=0 — the honest state **before** the motion mirror has been handed
 * over, and a bug at any other time.
 *
 * The exact analogue of {@link PLANE_HOME}, including its hazard: this is also the pre-DEC-814
 * behaviour, so if nothing ever calls {@link WorldsAttachment.setMultiverseAngle} the belt silently
 * reverts to the fixed frame DEC-813 found and the only symptom is a belt that shears against the
 * worlds over twenty minutes. That is why the mutation control in `worlds-centre.test.ts` is spelled
 * `setMultiverseAngle(NO_MULTIVERSE_ROTATION)` and why `worlds-scene-seam.test.tsx` carries a
 * separate row for the host's call. [[a-cold-start-default-made-permanent]]
 */
export const NO_MULTIVERSE_ROTATION: MultiverseAngleSource = () => 0
