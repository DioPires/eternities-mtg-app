/**
 * The CPU mirror of the scene's motion (PRD 8.5.3, 8.5.7).
 *
 * The vertex shader moves the stars; this moves the *camera's idea* of where things are. PRD 8.5.7
 * allows exactly one CPU-side star position — the focused one — and the camera tether needs it, so
 * this is that. It also supplies plane world positions for the tether, for label projection and for
 * the collision spheres the fly-to arcs around (PRD 5.7.5).
 *
 * Both sides must agree, so the transform order here is PRD 8.5.3's, verbatim:
 *
 *   local → spin + bounded shear about the plane axis → tilt → × radius → + drift → + home
 *         → multiverse rotation
 *
 * **Amended by the worlds law (DEC-873):** the tilt is `worlds/spin.ts`'s `appliedTilt`, gated on
 * `APPLY_PLANE_TILT`, and the multiverse rotation turns the plane's centre, not the offset from it
 * — `WorldSurface` draws a world that way — except on the dust plane, whose belt turns whole. See
 * `placeOffset`. The direction pair (`planeLocalDirToWorld` / `worldDirToPlaneLocal`) follows the
 * same law, so a fly-to's framing offset is held in the frame the destination is *drawn* in.
 *
 * **"The plane axis" is plane-local +Y, and the constants are `scene/tuning`'s.** Until Phase 3
 * this file rotated about world +Y with a shear phase gradient of its own, and nothing caught it:
 * every tether the rig had ever resolved was either a plane centre or a dust anchor, and the local
 * position of both is the origin, where the axis and the gradient cannot matter. The card tether is
 * the first one with a star's own local position in it, so the card tier is where the axis started
 * to matter at all.
 *
 * Phase 3 answered "plane-local +z" from PRD 8.6.2's prose. **It is +Y, measured (DEC-750, ruled on
 * DEC-774).** The generator writes `x = r·cos θ`, `z = r·sin θ`, `y = gaussian·thickness`, so the
 * disc lies in local xz and local Z is an axis *in* it; v3's cells are a unit sphere whose pole is
 * the same +Y `worlds/spin.ts` spins about. Both contract versions put the axis in one place, and
 * the plane-local frame is the frame the whole chain below is stated in, so this is `rotateY` on a
 * local vector, not the world-+Y rotation the multiverse turns by at the end.
 * `scene/starfield/motion.ts` and the vertex shader are the definition; this mirrors them, and
 * `test/starfield.test.ts` checks the two against each other on the same numbers rather than each
 * against itself.
 *
 * **Frame-rate independence (PRD 5.3.17, 9.1.3).** Everything except the two accumulated angles is
 * a pure function of elapsed time, and the two accumulators are integrated exactly: at constant
 * rate `Σ rate·dtᵢ = rate·Σ dtᵢ`, so 30, 60 and 120 fps land on the same angle. The accumulators
 * exist because PRD 8.5.3 needs a focused plane to ease its spin to a stop without a discontinuity,
 * which a closed-form `rate · t` cannot express.
 */

import type { PlaneRecord, PlanesFile } from '../data/types'
import { curlNoise } from '../scene/starfield/motion'
import {
  DRIFT_VERTICAL_RATIO,
  DUST_CURL_AMPLITUDE,
  DUST_CURL_SCALE,
  DUST_CURL_SPEED,
  SHEAR_RADIAL_PHASE,
} from '../scene/tuning'
import {
  applyQuat,
  copy,
  rotateY,
  set,
  type MutVec3,
  vec,
} from './vec'
import { MULTIVERSE_PERIOD_S } from '../scene/tuning'
import { appliedTilt } from '../scene/worlds/spin'

/** PRD 5.6.6: a focused plane's rotation eases to a stop over 1 s, and back over 1 s. */
export const SPIN_EASE_S = 1

interface PlaneMotionState {
  /** PRD 8.5.3's accumulated angle: integrated, not `rate · t`, so it can ease to a stop. */
  spinAngle: number
  /** 1 while the plane turns freely, 0 while it is focused. Eases over `SPIN_EASE_S`. */
  spinScale: number
  spinTargetScale: number
}

export interface MotionOptions {
  /**
   * PRD 5.9: rotation, drift, twinkle and turbulence all stop. Time simply does not advance, so
   * every derived quantity freezes together and nothing has to know about the setting.
   */
  readonly reducedMotion?: boolean
}

/**
 * The scene's clock and the per-plane accumulators. One instance per scene; the rig owns it.
 *
 * Allocation-free after construction (PRD 7.3.2): every query writes into a caller-supplied vector.
 */
export class SceneMotion {
  readonly planes: readonly PlaneRecord[]
  readonly multiverseRadius: number

  /** Seconds of *motion* elapsed — frozen, not merely ignored, under reduced motion. */
  private elapsed = 0
  private multiverseAngle = 0
  private reducedMotion: boolean
  /** See {@link setExternalClock}. False everywhere the star field is not the clock. */
  private externalClock = false
  private readonly states: PlaneMotionState[]
  private readonly bySlug = new Map<string, PlaneRecord>()

  // Preallocated scratch. Every method that returns a vector writes into the caller's `out`, and
  // uses these in between; nothing here escapes.
  private readonly tmpA: MutVec3 = vec()
  private readonly tmpB: MutVec3 = vec()

  constructor(planes: PlanesFile, options: MotionOptions = {}) {
    this.planes = planes.planes
    this.multiverseRadius = planes.multiverseRadius
    this.reducedMotion = options.reducedMotion ?? false
    this.states = this.planes.map(() => ({ spinAngle: 0, spinScale: 1, spinTargetScale: 1 }))
    for (const plane of this.planes) this.bySlug.set(plane.slug, plane)
  }

  get time(): number {
    return this.elapsed
  }

  get multiverseRotation(): number {
    return this.multiverseAngle
  }

  planeBySlug(slug: string): PlaneRecord | undefined {
    return this.bySlug.get(slug)
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled
  }

  /**
   * 1 while the scene moves, 0 under PRD 5.9's reduced motion.
   *
   * The star field's plane table applies exactly this factor to drift, shear and the accumulated
   * angles rather than stopping its clock, so mirroring the factor — instead of freezing `elapsed`
   * alone — is what keeps a frozen field and a frozen tether in the same place.
   */
  get motionScale(): number {
    return this.reducedMotion ? 0 : 1
  }

  /**
   * Take the clock from the star field's plane table (PRD 8.5.2), which is what the vertex shader
   * reads and therefore the only clock the drawn stars have.
   *
   * Without this there are two integrations of one angle — the table's and `advance`'s — that agree
   * only for as long as they are fed identical deltas and identical reduced-motion histories. They
   * are not obliged to be: the table advances its `time` under reduced motion and this does not, so
   * one toggle mid-session is enough to put the camera's idea of a star's shear phase somewhere the
   * shader's is not. The scene calls this once per frame, after the table has advanced and before
   * the rig reads a tether. Allocation-free.
   */
  syncClock(time: number, multiverseAngle: number): void {
    this.elapsed = time
    this.multiverseAngle = multiverseAngle
  }

  /** One plane's accumulated spin angle, from the same table. See {@link syncClock}. */
  syncSpin(index: number, spinAngle: number): void {
    const state = this.states[index]
    if (state) state.spinAngle = spinAngle
  }

  /** PRD 5.6.6's eased scale for a plane, so the star field can drive its table from one easing. */
  spinScaleOf(index: number): number {
    return this.states[index]?.spinScale ?? 1
  }

  /**
   * PRD 5.6.6: while a card is focused its plane's rotation eases to a stop and eases back when
   * focus is released. `null` releases every plane.
   */
  setFocusedPlane(slug: string | null): void {
    for (let i = 0; i < this.states.length; i += 1) {
      const plane = this.planes[i]!
      this.states[i]!.spinTargetScale = slug !== null && plane.slug === slug ? 0 : 1
    }
  }

  /**
   * Hand the clock over to the star field's plane table (PRD 8.5.2), which the vertex shader reads
   * and this only mirrors. See {@link syncClock}: with an external clock, `advance` still runs PRD
   * 5.6.6's spin easing — that is the camera's own state, and the table is *told* it — but stops
   * integrating the time, the multiverse angle and the spin angles, which now arrive from the table
   * instead of being computed a second time beside it.
   */
  setExternalClock(enabled: boolean): void {
    this.externalClock = enabled
  }

  /** Advance the scene clock. Call once per frame with the real delta (PRD 5.3.17). */
  advance(dt: number): void {
    if (this.reducedMotion || dt <= 0) return
    if (!this.externalClock) {
      this.elapsed += dt
      this.multiverseAngle += ((2 * Math.PI) / MULTIVERSE_PERIOD_S) * dt
    }

    const easeStep = dt / SPIN_EASE_S
    for (let i = 0; i < this.states.length; i += 1) {
      const state = this.states[i]!
      const plane = this.planes[i]!
      if (state.spinScale !== state.spinTargetScale) {
        // Linear over exactly SPIN_EASE_S in either direction, so 30 and 120 fps reach the stop at
        // the same wall-clock moment.
        const delta = state.spinTargetScale - state.spinScale
        const step = Math.sign(delta) * Math.min(Math.abs(delta), easeStep)
        state.spinScale += step
      }
      if (plane.spinPeriodS > 0 && !this.externalClock) {
        const rate = ((2 * Math.PI) / plane.spinPeriodS) * plane.spinDirection
        state.spinAngle += rate * state.spinScale * dt
      }
    }
  }

  /** PRD 5.3.15: the plane's small slow orbit around its home position, at the current time. */
  driftOffset(out: MutVec3, plane: PlaneRecord): MutVec3 {
    if (plane.driftAmplitude === 0 || plane.driftPeriodS === 0 || this.reducedMotion) {
      return set(out, 0, 0, 0)
    }
    const phase = (2 * Math.PI * this.elapsed) / plane.driftPeriodS + plane.driftPhase
    const a = plane.driftAmplitude
    return set(
      out,
      a * Math.cos(phase),
      DRIFT_VERTICAL_RATIO * a * Math.sin(2 * phase),
      a * Math.sin(phase),
    )
  }

  /**
   * PRD 5.4.13's bounded shear for one star, in radians about the plane's local +Y.
   *
   * The radius it is a function of is the star's radius *in the disc*, which is its local **xz**
   * distance from the plane's centre — the same `length(p.xz)` the vertex shader takes (DEC-774).
   * The shear shares the spin's axis, so it moved with it: a radius measured across the disc and a
   * rotation about its normal are the same disc, or neither is.
   */
  private shearAngle(plane: PlaneRecord, lx: number, lz: number): number {
    // PRD 5.4.13's shear is a spiral-disc law and retires in contract v3 (worlds spec §2.4), so a
    // v3 `planes.json` simply does not carry these three fields. This is the galaxy path, which is
    // pointed at a v2 dataset for the whole dual-scene period — but "absent" must mean "no shear"
    // rather than `NaN` propagating into a rotation, which is what reading them unguarded would do.
    const amplitude = plane.shearAmplitude ?? 0
    const periodS = plane.shearPeriodS ?? 0
    if (amplitude === 0 || periodS === 0 || this.reducedMotion) return 0
    const r = Math.hypot(lx, lz)
    const phase =
      (2 * Math.PI * this.elapsed) / periodS + (plane.shearPhase ?? 0) + r * SHEAR_RADIAL_PHASE
    return amplitude * Math.sin(phase)
  }

  /** World position of a plane's centre — its tether point (PRD 5.7.1). */
  planePosition(out: MutVec3, plane: PlaneRecord): MutVec3 {
    this.driftOffset(this.tmpA, plane)
    set(
      this.tmpA,
      plane.home[0] + this.tmpA.x,
      plane.home[1] + this.tmpA.y,
      plane.home[2] + this.tmpA.z,
    )
    return rotateY(out, this.tmpA, this.multiverseAngle)
  }

  /**
   * World position of one star, from its plane-local coordinates. PRD 8.5.7's single permitted
   * CPU-side star position: the focused one, for the tether and the fly-to target.
   */
  starPosition(
    out: MutVec3,
    plane: PlaneRecord,
    lx: number,
    ly: number,
    lz: number,
  ): MutVec3 {
    const state = this.states[plane.index]
    const spin = state?.spinAngle ?? 0

    // PRD 5.4.13: a bounded angular offset A·sin(2πt/T + φ(r)) on top of the rigid spin. Bounded is
    // the point — a true differential rotation would wind the arms up over a long session.
    const shear = this.shearAngle(plane, lx, lz)

    if (plane.kind === 'dust') {
      // PRD 8.6.3 / 5.3.16: the Blind Eternities does not spin — it turbulates. The dust's stored
      // position is in multiverse-normalised coordinates, so the curl is applied here, before the
      // radius scale, exactly as the field does it. Leaving it out is a tether up to
      // `DUST_CURL_AMPLITUDE × R` — half a world unit, against a card 0.63 wide — from the card it
      // is supposed to be framing, and every dust card focus would show it.
      const sample = this.elapsed * DUST_CURL_SPEED
      curlNoise(
        lx * DUST_CURL_SCALE + sample,
        ly * DUST_CURL_SCALE + sample,
        lz * DUST_CURL_SCALE + sample,
        this.tmpB,
      )
      const amplitude = DUST_CURL_AMPLITUDE * this.motionScale
      set(this.tmpB, lx + this.tmpB.x * amplitude, ly + this.tmpB.y * amplitude, lz + this.tmpB.z * amplitude)
    } else {
      set(this.tmpB, lx, ly, lz)
      rotateY(this.tmpB, this.tmpB, spin + shear)
    }
    applyQuat(this.tmpB, this.tmpB, appliedTilt(plane))
    set(this.tmpB, this.tmpB.x * plane.radius, this.tmpB.y * plane.radius, this.tmpB.z * plane.radius)
    return this.placeOffset(out, plane, this.tmpB)
  }

  /**
   * Put an offset from a plane's centre — already spun, tilted and scaled — into the world, the way
   * the scene draws it (DEC-873).
   *
   * A world is drawn by `WorldSurface` at `planePosition`, with an orientation that carries the spin
   * and nothing of PRD 5.3.13's multiverse angle; so the offset is added *after* the centre is
   * rotated, not rotated with it. On a v3 dataset a star record is a cell centre (§2.1), and doing
   * otherwise put the focused card and the fly-to target up to two radii round the globe from the
   * cell at the half turn. The dust plane is the exception: its drawn twin is §1.8's belt, which
   * DEC-814 turns as one object, and PRD 8.3 defines a dust anchor's frame as multiverse
   * coordinates over `R` so that it turns with it.
   */
  private placeOffset(out: MutVec3, plane: PlaneRecord, offset: Readonly<MutVec3>): MutVec3 {
    this.driftOffset(this.tmpA, plane)
    set(
      this.tmpA,
      plane.home[0] + this.tmpA.x,
      plane.home[1] + this.tmpA.y,
      plane.home[2] + this.tmpA.z,
    )
    if (plane.kind === 'dust') {
      set(this.tmpA, this.tmpA.x + offset.x, this.tmpA.y + offset.y, this.tmpA.z + offset.z)
      return rotateY(out, this.tmpA, this.multiverseAngle)
    }
    rotateY(this.tmpA, this.tmpA, this.multiverseAngle)
    return set(out, this.tmpA.x + offset.x, this.tmpA.y + offset.y, this.tmpA.z + offset.z)
  }

  /**
   * The spin a plane's local frame turns by — none on the dust plane, which turbulates instead
   * (PRD 8.6.3). `starPosition` has always skipped it there; the anchor transforms below read this
   * so the three cannot disagree the day a dust plane is given a spin period (DEC-873).
   */
  private frameSpin(plane: PlaneRecord): number {
    if (plane.kind === 'dust') return 0
    return this.states[plane.index]?.spinAngle ?? 0
  }

  /**
   * Convert a world point into the plane's local frame — the inverse of `starPosition`'s
   * *placement* half (rotation and translation), without the shear, which is a per-star function
   * of the star's own radius and is not invertible from a bare point, and without the dust
   * turbulence, which is a displacement field and not invertible at all.
   *
   * Neither omission costs anything at the call sites: this converts *anchors* — a clicked point, a
   * card's already-known world position — into the frame they will be tracked in, and an anchor is
   * a place in the volume rather than a star with a shear phase or a curl offset of its own.
   *
   * The fly-to needs this for PRD 5.7.4: a framing offset is chosen in the destination's rotating
   * local frame so that a spinning plane is framed correctly on arrival, however long the flight
   * takes.
   */
  worldToPlaneLocal(out: MutVec3, plane: PlaneRecord, world: Readonly<MutVec3>): MutVec3 {
    // The exact inverse of `placeOffset`: the centre is subtracted in whichever frame that added it.
    this.driftOffset(this.tmpB, plane)
    set(
      this.tmpB,
      plane.home[0] + this.tmpB.x,
      plane.home[1] + this.tmpB.y,
      plane.home[2] + this.tmpB.z,
    )
    if (plane.kind === 'dust') {
      rotateY(this.tmpA, world, -this.multiverseAngle)
    } else {
      rotateY(this.tmpB, this.tmpB, this.multiverseAngle)
      copy(this.tmpA, world)
    }
    set(this.tmpA, this.tmpA.x - this.tmpB.x, this.tmpA.y - this.tmpB.y, this.tmpA.z - this.tmpB.z)
    const inv = plane.radius === 0 ? 0 : 1 / plane.radius
    set(this.tmpA, this.tmpA.x * inv, this.tmpA.y * inv, this.tmpA.z * inv)
    // Inverse tilt: conjugate the unit quaternion.
    const tilt = appliedTilt(plane)
    applyQuat(this.tmpA, this.tmpA, [-tilt[0], -tilt[1], -tilt[2], tilt[3]])
    return rotateY(out, this.tmpA, -this.frameSpin(plane))
  }

  /** The forward direction of `worldToPlaneLocal`, so a local offset tracks the spinning plane. */
  planeLocalToWorld(out: MutVec3, plane: PlaneRecord, local: Readonly<MutVec3>): MutVec3 {
    rotateY(this.tmpB, local, this.frameSpin(plane))
    applyQuat(this.tmpB, this.tmpB, appliedTilt(plane))
    set(
      this.tmpB,
      this.tmpB.x * plane.radius,
      this.tmpB.y * plane.radius,
      this.tmpB.z * plane.radius,
    )
    return this.placeOffset(out, plane, this.tmpB)
  }

  /**
   * Direction-only halves of the two transforms above: rotation without the radius scaling or the
   * translation.
   *
   * PRD 5.7.4 wants a fly-to's *framing offset* held in the destination's rotating local frame, so
   * that a plane which spins through a quarter turn during a 3 s flight is still framed from the
   * same side of its spiral on arrival. Reusing `planeLocalToWorld` would scale the offset by the
   * plane radius and drag the drift offset in with it.
   */
  planeLocalDirToWorld(out: MutVec3, plane: PlaneRecord, local: Readonly<MutVec3>): MutVec3 {
    rotateY(this.tmpB, local, this.frameSpin(plane))
    applyQuat(this.tmpB, this.tmpB, appliedTilt(plane))
    // A direction has no centre to carry the multiverse angle, so it carries it only where
    // `placeOffset` rotates the offset itself: on the dust plane (DEC-873).
    if (plane.kind === 'dust') return rotateY(out, this.tmpB, this.multiverseAngle)
    return copy(out, this.tmpB)
  }

  worldDirToPlaneLocal(out: MutVec3, plane: PlaneRecord, world: Readonly<MutVec3>): MutVec3 {
    if (plane.kind === 'dust') rotateY(this.tmpB, world, -this.multiverseAngle)
    else copy(this.tmpB, world)
    const tilt = appliedTilt(plane)
    applyQuat(this.tmpB, this.tmpB, [-tilt[0], -tilt[1], -tilt[2], tilt[3]])
    return rotateY(out, this.tmpB, -this.frameSpin(plane))
  }

  spinAngleOf(index: number): number {
    return this.states[index]?.spinAngle ?? 0
  }

  /** Test seam for PRD 9.1.3: restore a clock so two runs can be compared from the same start. */
  resetTo(elapsed: number, multiverseAngle: number, spinAngles: readonly number[]): void {
    this.elapsed = elapsed
    this.multiverseAngle = multiverseAngle
    for (let i = 0; i < this.states.length; i += 1) {
      this.states[i]!.spinAngle = spinAngles[i] ?? 0
    }
  }

  spinAngles(): number[] {
    return this.states.map((s) => s.spinAngle)
  }

  /** Copy of a plane's current world position, for callers outside the frame path. */
  planePositionOf(slug: string, out: MutVec3 = vec()): MutVec3 | null {
    const plane = this.bySlug.get(slug)
    if (!plane) return null
    const scratch = vec()
    this.planePosition(scratch, plane)
    return copy(out, scratch)
  }
}
