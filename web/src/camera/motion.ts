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
 * **Frame-rate independence (PRD 5.3.17, 9.1.3).** Everything except the two accumulated angles is
 * a pure function of elapsed time, and the two accumulators are integrated exactly: at constant
 * rate `Σ rate·dtᵢ = rate·Σ dtᵢ`, so 30, 60 and 120 fps land on the same angle. The accumulators
 * exist because PRD 8.5.3 needs a focused plane to ease its spin to a stop without a discontinuity,
 * which a closed-form `rate · t` cannot express.
 */

import type { PlaneRecord, PlanesFile } from '../data/types'
import {
  applyQuat,
  copy,
  rotateY,
  set,
  type MutVec3,
  vec,
} from './vec'

/** PRD 5.3.13: the whole multiverse turns about its vertical axis once every 20 minutes. */
export const MULTIVERSE_PERIOD_S = 20 * 60

/**
 * PRD 5.4.13: the shear's phase varies with the star's radius, which is what makes the arms
 * *breathe* rather than rock as one rigid body. One radian of phase across the disc.
 */
const SHEAR_RADIAL_PHASE = Math.PI

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
   * PRD 5.6.6: while a card is focused its plane's rotation eases to a stop and eases back when
   * focus is released. `null` releases every plane.
   */
  setFocusedPlane(slug: string | null): void {
    for (let i = 0; i < this.states.length; i += 1) {
      const plane = this.planes[i]!
      this.states[i]!.spinTargetScale = slug !== null && plane.slug === slug ? 0 : 1
    }
  }

  /** Advance the scene clock. Call once per frame with the real delta (PRD 5.3.17). */
  advance(dt: number): void {
    if (this.reducedMotion || dt <= 0) return
    this.elapsed += dt
    this.multiverseAngle += ((2 * Math.PI) / MULTIVERSE_PERIOD_S) * dt

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
      if (plane.spinPeriodS > 0) {
        const rate = ((2 * Math.PI) / plane.spinPeriodS) * plane.spinDirection
        state.spinAngle += rate * state.spinScale * dt
      }
    }
  }

  /** PRD 5.3.15: the plane's small slow orbit around its home position, at the current time. */
  driftOffset(out: MutVec3, plane: PlaneRecord): MutVec3 {
    if (plane.driftAmplitude === 0 || plane.driftPeriodS === 0) return set(out, 0, 0, 0)
    const phase = (2 * Math.PI * this.elapsed) / plane.driftPeriodS + plane.driftPhase
    const a = plane.driftAmplitude
    return set(out, a * Math.cos(phase), 0.35 * a * Math.sin(2 * phase), a * Math.sin(phase))
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
    let shear = 0
    if (plane.shearAmplitude > 0 && plane.shearPeriodS > 0) {
      const r = Math.hypot(lx, lz)
      const phase =
        (2 * Math.PI * this.elapsed) / plane.shearPeriodS + plane.shearPhase + r * SHEAR_RADIAL_PHASE
      shear = plane.shearAmplitude * Math.sin(phase)
    }

    set(this.tmpB, lx, ly, lz)
    rotateY(this.tmpB, this.tmpB, spin + shear)
    applyQuat(this.tmpB, this.tmpB, plane.tilt)
    set(this.tmpB, this.tmpB.x * plane.radius, this.tmpB.y * plane.radius, this.tmpB.z * plane.radius)

    this.driftOffset(this.tmpA, plane)
    set(
      this.tmpB,
      this.tmpB.x + plane.home[0] + this.tmpA.x,
      this.tmpB.y + plane.home[1] + this.tmpA.y,
      this.tmpB.z + plane.home[2] + this.tmpA.z,
    )
    return rotateY(out, this.tmpB, this.multiverseAngle)
  }

  /**
   * Convert a world point into the plane's local frame — the inverse of `starPosition`'s
   * *placement* half (rotation and translation), without the shear, which is a per-star function
   * of the star's own radius and is not invertible from a bare point.
   *
   * The fly-to needs this for PRD 5.7.4: a framing offset is chosen in the destination's rotating
   * local frame so that a spinning plane is framed correctly on arrival, however long the flight
   * takes.
   */
  worldToPlaneLocal(out: MutVec3, plane: PlaneRecord, world: Readonly<MutVec3>): MutVec3 {
    rotateY(this.tmpA, world, -this.multiverseAngle)
    this.driftOffset(this.tmpB, plane)
    set(
      this.tmpA,
      this.tmpA.x - plane.home[0] - this.tmpB.x,
      this.tmpA.y - plane.home[1] - this.tmpB.y,
      this.tmpA.z - plane.home[2] - this.tmpB.z,
    )
    const inv = plane.radius === 0 ? 0 : 1 / plane.radius
    set(this.tmpA, this.tmpA.x * inv, this.tmpA.y * inv, this.tmpA.z * inv)
    // Inverse tilt: conjugate the unit quaternion.
    applyQuat(this.tmpA, this.tmpA, [-plane.tilt[0], -plane.tilt[1], -plane.tilt[2], plane.tilt[3]])
    const spin = this.states[plane.index]?.spinAngle ?? 0
    return rotateY(out, this.tmpA, -spin)
  }

  /** The forward direction of `worldToPlaneLocal`, so a local offset tracks the spinning plane. */
  planeLocalToWorld(out: MutVec3, plane: PlaneRecord, local: Readonly<MutVec3>): MutVec3 {
    const spin = this.states[plane.index]?.spinAngle ?? 0
    rotateY(this.tmpB, local, spin)
    applyQuat(this.tmpB, this.tmpB, plane.tilt)
    set(
      this.tmpB,
      this.tmpB.x * plane.radius,
      this.tmpB.y * plane.radius,
      this.tmpB.z * plane.radius,
    )
    this.driftOffset(this.tmpA, plane)
    set(
      this.tmpB,
      this.tmpB.x + plane.home[0] + this.tmpA.x,
      this.tmpB.y + plane.home[1] + this.tmpA.y,
      this.tmpB.z + plane.home[2] + this.tmpA.z,
    )
    return rotateY(out, this.tmpB, this.multiverseAngle)
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
    const spin = this.states[plane.index]?.spinAngle ?? 0
    rotateY(this.tmpB, local, spin)
    applyQuat(this.tmpB, this.tmpB, plane.tilt)
    return rotateY(out, this.tmpB, this.multiverseAngle)
  }

  worldDirToPlaneLocal(out: MutVec3, plane: PlaneRecord, world: Readonly<MutVec3>): MutVec3 {
    rotateY(this.tmpB, world, -this.multiverseAngle)
    applyQuat(this.tmpB, this.tmpB, [
      -plane.tilt[0],
      -plane.tilt[1],
      -plane.tilt[2],
      plane.tilt[3],
    ])
    const spin = this.states[plane.index]?.spinAngle ?? 0
    return rotateY(out, this.tmpB, -spin)
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
