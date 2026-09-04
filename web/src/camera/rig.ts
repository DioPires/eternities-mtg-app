/**
 * The camera rig (PRD 5.7, 8.4.5): a tethered orbit controller with per-level distance limits and
 * a fly-to tween that owns the camera during transitions and yields on any input.
 *
 * The whole thing is one spherical parameterisation — a live tether point plus `(azimuth, polar,
 * distance)` — and both modes write the same three numbers:
 *
 * - **orbit** drives them from input, with exactly integrated inertia;
 * - **the tween** drives them from an eased path between two tethers.
 *
 * That is what makes PRD 5.7.3's hand-over honest rather than approximate. When input arrives
 * mid-flight the rig does not stop the tween and hope: it rebases onto the destination tether so
 * the world position is *identical*, projects the tween's analytic velocity onto the spherical
 * basis at that point, and hands those rates to the orbit's inertia. Position and velocity are both
 * continuous, which is PRD 7.3.6 stated as an algorithm.
 *
 * Nothing here touches three.js, the DOM, or `Date.now()`. It is a pure function of `update(dt)`,
 * so PRD 9.1.3's frame-rate-independence check runs it in Node at 30, 60 and 120 fps.
 */

import type { PlaneRecord, PlanesFile } from '../data/types'
import type { CameraState } from '../navigation/types'

import {
  clearanceBulge,
  copyTether,
  emptyTether,
  Framing,
  tetherPosition,
  type Tether,
} from './framing'
import { SceneMotion } from './motion'
import {
  addScaled,
  clamp,
  copy,
  decayIntegral,
  distance,
  dot,
  easeInOut,
  easeInOutSlope,
  length,
  normalise,
  set,
  shortestAngle,
  sub,
  toTuple,
  vec,
  type MutVec3,
} from './vec'

/** PRD 5.7.3: 1.2 s for a one-level hop. */
export const DEFAULT_DURATION_MS = 1200
/** PRD 5.7.3: scaled with distance, capped here. */
export const MAX_DURATION_MS = 3000
/** PRD 6.2.3: the combined two-stage card fly-to. */
export const TWO_STAGE_CAP_MS = 3500
/** PRD 6.2.3: the hold between the two stages. */
export const TWO_STAGE_HOLD_MS = 400
/** PRD 6.8.2. */
export const INTRO_DURATION_MS = 4000
/** PRD 5.9. */
export const REDUCED_MOTION_DURATION_MS = 300

/** How fast orbit inertia bleeds off after the user lets go, and after a hand-over. */
const ORBIT_DAMPING = 2.6
/**
 * How hard a distance outside the current level's limits is pulled back inside, as a spring
 * *acceleration* rather than a position correction.
 *
 * The distinction is the whole point. A hand-over mid-flight can leave the camera 140 units from a
 * tether whose limit is 63 — and correcting that by moving the camera, however smoothly damped,
 * puts a step in its velocity on the very frame PRD 5.7.3 requires to be continuous. Feeding the
 * error into `distanceRate` instead makes it a force: the camera keeps the velocity it had and
 * eases inwards over the following seconds — from 258 units outside a 60-unit limit it is within
 * 5% of it after 5.5 s and 0.1% after 10 s. Chosen overdamped against `ORBIT_DAMPING` (λ² > 4k),
 * so it never overshoots and bounces.
 */
const LIMIT_SPRING = 1.5

/**
 * The characteristic roots of the limit spring, `r = (-λ ± √(λ² - 4k)) / 2` for `ẍ + λẋ + kx = 0`
 * with `x = distance - limit`, `λ = ORBIT_DAMPING` and `k = LIMIT_SPRING`.
 *
 * Precomputed because `advanceDistance` solves that equation in closed form rather than stepping it
 * — see the comment there. The constants above are chosen overdamped, so the discriminant is real
 * and the two roots are distinct; the floor keeps them distinct (and the solution finite) if they
 * are ever retuned to critical damping.
 */
const SPRING_ROOT_GAP = Math.sqrt(Math.max(ORBIT_DAMPING * ORBIT_DAMPING - 4 * LIMIT_SPRING, 1e-6))
const SPRING_ROOT_SLOW = (-ORBIT_DAMPING + SPRING_ROOT_GAP) / 2
const SPRING_ROOT_FAST = (-ORBIT_DAMPING - SPRING_ROOT_GAP) / 2

/** Polar angle is clamped hard: the poles are a singularity in the spherical basis, not a view. */
const MIN_POLAR = 0.12
const MAX_POLAR = Math.PI - 0.12

export interface RigOptions {
  readonly reducedMotion?: boolean
}

export type RigFlightStatus = 'completed' | 'cancelled'

/** One eased leg of a flight. A two-stage card fly-to (PRD 6.2.3) is two of these. */
export interface FlightLeg {
  readonly tether: Tether
  readonly durationS: number
  /** PRD 6.2.3's 0.4 s pause before this leg starts. */
  readonly holdS: number
  /** Arrival distance from the tether; defaults to the tether's `frameDistance`. */
  readonly distance?: number
  readonly polar?: number
  /**
   * Arrival azimuth as a *world* angle at the moment the leg starts. It is converted into the
   * destination's local frame immediately and tracked from there (PRD 5.7.4). Omit to keep the
   * camera's current azimuth, which reads as moving in rather than swinging around.
   */
  readonly azimuth?: number
}

interface ActiveFlight {
  readonly legs: readonly FlightLeg[]
  index: number
  /** Seconds into the current leg; negative while the leg's hold runs. */
  elapsed: number
  /** True while this flight is attract mode's, which never changes focus (PRD 5.3.23). */
  readonly attract: boolean
  readonly settle: (status: RigFlightStatus) => void
  // Frozen start pose of the current leg.
  readonly startTether: Tether
  startAzimuth: number
  startPolar: number
  startDistance: number
  /** Arrival offset direction, held in the destination's local frame (PRD 5.7.4). */
  readonly endLocalDir: MutVec3
  endDistance: number
  /** PRD 5.7.5's arc: how far the path bulges away from the straight line. */
  bulge: number
}

export class CameraRig {
  readonly motion: SceneMotion
  readonly framing: Framing

  /** Where the camera is tethered *now* (PRD 5.7.1). Live: its plane keeps moving under it. */
  private readonly tether: Tether = emptyTether()
  private azimuth = 0
  private polar = 0
  private dist = 0

  private azimuthRate = 0
  private polarRate = 0
  private distanceRate = 0

  private flight: ActiveFlight | null = null
  private reducedMotion: boolean

  /** Outputs, rewritten in place every frame (PRD 7.3.2). */
  readonly position: MutVec3 = vec()
  readonly lookAt: MutVec3 = vec()

  // Preallocated scratch for `update` and `handOver`.
  private readonly sTetherA: MutVec3 = vec()
  private readonly sTetherB: MutVec3 = vec()
  private readonly sTetherNow: MutVec3 = vec()
  private readonly sOffset: MutVec3 = vec()
  private readonly sEndDir: MutVec3 = vec()
  private readonly sVelocity: MutVec3 = vec()
  private readonly sBasis: MutVec3 = vec()
  private readonly sScratch: MutVec3 = vec()
  private readonly sCentre: MutVec3 = vec()

  constructor(planes: PlanesFile, options: RigOptions = {}) {
    this.motion = new SceneMotion(planes, { reducedMotion: options.reducedMotion ?? false })
    this.framing = new Framing(planes)
    this.reducedMotion = options.reducedMotion ?? false
    this.framing.multiverse(this.tether)
    this.azimuth = Math.PI * 0.25
    this.polar = this.tether.framePolar
    this.dist = this.tether.frameDistance
    this.writeCamera()
  }

  get currentTether(): Readonly<Tether> {
    return this.tether
  }

  get flying(): boolean {
    return this.flight !== null
  }

  get inAttract(): boolean {
    return this.flight?.attract ?? false
  }

  get distanceToTether(): number {
    return this.dist
  }

  get currentAzimuth(): number {
    return this.azimuth
  }

  get currentPolar(): number {
    return this.polar
  }

  /**
   * Contract invariant 5 / PRD 6.7.1: `sets.bin` landed and the destination is now a real star
   * rather than the plane the deep link named. Refine the flight's last leg *in place* — a restart
   * is the discontinuity PRD 5.7 and 7.3.6 exist to prevent.
   *
   * The arrival direction is re-derived so it still means the same thing in the new tether's frame;
   * the eased path itself keeps running from where it is, and the destination simply slides.
   */
  retargetFinalLeg(tether: Readonly<Tether>): void {
    const flight = this.flight
    if (!flight) return
    const leg = flight.legs[flight.legs.length - 1]!
    copyTether(leg.tether, tether)
    if (flight.index !== flight.legs.length - 1) return
    flight.endDistance = leg.distance ?? tether.frameDistance
    this.fromLocalDir(this.sEndDir, leg.tether, flight.endLocalDir)
    // Re-express the same *world* arrival direction in the new frame, so the refinement does not
    // also swing the camera round to the other side of the plane.
    this.toLocalDir(flight.endLocalDir, leg.tether, this.sEndDir)
  }

  /**
   * Re-tether without moving: the camera keeps its exact world position and its orbit rates, and
   * only the point it turns around changes.
   *
   * This is `failCardResolution`'s "the camera stops where it is; no new tween" (PRD risk 9), and
   * it is also how a re-anchor of the dust works (PRD 5.3.4) and how attract mode gives control
   * back without a jump (PRD 5.3.23).
   */
  rebaseTo(tether: Readonly<Tether>): void {
    copyTether(this.tether, tether)
    tetherPosition(this.sTetherNow, this.tether, this.motion)
    sub(this.sOffset, this.position, this.sTetherNow)
    const d = length(this.sOffset)
    this.dist = d
    this.polar = clamp(Math.acos(clamp(this.sOffset.y / (d || 1), -1, 1)), MIN_POLAR, MAX_POLAR)
    this.azimuth = Math.atan2(this.sOffset.z, this.sOffset.x)
    this.writeCamera()
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled
    this.motion.setReducedMotion(enabled)
  }

  /** The plain `{position, target, distance}` the navigation contract's `handover` event carries. */
  cameraState(): CameraState {
    return { position: toTuple(this.position), target: toTuple(this.lookAt), distance: this.dist }
  }

  planeBySlug(slug: string): PlaneRecord | undefined {
    return this.motion.planeBySlug(slug)
  }

  /**
   * PRD 5.7.3: duration is 1.2 s for a one-level hop, scaled with distance up to a 3 s cap, and
   * 0.3 s flat under reduced motion (PRD 5.9).
   */
  durationMsFor(destination: Readonly<Tether>): number {
    if (this.reducedMotion) return REDUCED_MOTION_DURATION_MS
    tetherPosition(this.sTetherB, destination, this.motion)
    return this.durationMsForTravel(distance(this.position, this.sTetherB))
  }

  /**
   * The same rule, for a leg whose length the caller has worked out itself.
   *
   * `durationMsFor` measures from where the camera *is*, which is the wrong end of the second leg
   * of a two-stage card fly-to (PRD 6.2.3): that leg starts where the first one lands, somewhere
   * the camera has not been yet. PRD 5.7.3 scales both of them with their own distance all the
   * same, so the scene measures the leg and asks here.
   */
  durationMsForTravel(travel: number): number {
    if (this.reducedMotion) return REDUCED_MOTION_DURATION_MS
    // One multiverse radius of travel is "a one-level hop"; a cross-multiverse jump is several.
    const hops = travel / Math.max(this.framing.multiverseRadius, 1e-6)
    const scaled = DEFAULT_DURATION_MS * (1 + Math.max(0, hops - 0.35) * 1.1)
    return clamp(scaled, DEFAULT_DURATION_MS, MAX_DURATION_MS)
  }

  /**
   * Start a flight. Any flight in progress is dropped as `'cancelled'` — the navigation layer above
   * translates that into the contract's `'superseded'`, because only it knows whether the new
   * flight came from a new navigation or from the next leg of the same one.
   */
  fly(legs: readonly FlightLeg[], settle: (status: RigFlightStatus) => void, attract = false): void {
    this.cancelFlight('cancelled')
    if (legs.length === 0) {
      settle('completed')
      return
    }
    this.flight = {
      legs,
      index: -1,
      elapsed: 0,
      attract,
      settle,
      startTether: emptyTether(),
      startAzimuth: 0,
      startPolar: 0,
      startDistance: 0,
      endLocalDir: vec(),
      endDistance: 0,
      bulge: 0,
    }
    this.beginLeg(0)
  }

  /** Arrive immediately, with no tween. PRD's `FlyOptions.immediate` — deep links that must not animate. */
  snapTo(leg: FlightLeg): void {
    this.cancelFlight('cancelled')
    copyTether(this.tether, leg.tether)
    this.dist = leg.distance ?? leg.tether.frameDistance
    this.polar = clamp(leg.polar ?? leg.tether.framePolar, MIN_POLAR, MAX_POLAR)
    this.azimuth = leg.azimuth ?? this.azimuth
    this.azimuthRate = 0
    this.polarRate = 0
    this.distanceRate = 0
    this.writeCamera()
  }

  /**
   * PRD 5.7.3: input takes the camera back mid-flight, continuous in position *and* velocity
   * (PRD 7.3.6). Returns false when there was nothing to hand over.
   *
   * The `HandoverCause` is deliberately not a parameter: the rig does the same thing whatever
   * touched it, and the cause is the navigation layer's — it goes on the `handover` event so the
   * UI can tell a wheel from a route change (navigation contract §4).
   */
  handOver(): boolean {
    const flight = this.flight
    if (!flight) return false

    // 1. Where the camera is, and how fast it is moving, right now.
    this.tweenVelocity(flight, this.sVelocity)

    // 2. Rebase onto the destination tether. PRD 5.7.3 hands over control; it does not undo the
    //    navigation (navigation contract invariant 3), so the destination is where we stay.
    const leg = flight.legs[flight.index]!
    copyTether(this.tether, leg.tether)
    tetherPosition(this.sTetherNow, this.tether, this.motion)
    sub(this.sOffset, this.position, this.sTetherNow)

    const d = length(this.sOffset)
    this.dist = d
    this.polar = clamp(Math.acos(clamp(this.sOffset.y / (d || 1), -1, 1)), MIN_POLAR, MAX_POLAR)
    this.azimuth = Math.atan2(this.sOffset.z, this.sOffset.x)

    // 3. Project the tween's velocity onto the spherical basis at this exact point, so the orbit
    //    continues along the same world trajectory rather than merely from the same place.
    this.projectVelocityToRates(this.sVelocity, d)

    this.flight = null
    flight.settle('cancelled')
    this.writeCamera()
    return true
  }

  /** Drop the flight without a hand-over — the route changed underneath it. */
  cancelFlight(status: RigFlightStatus): void {
    const flight = this.flight
    if (!flight) return
    this.flight = null
    if (status === 'completed') {
      const leg = flight.legs[flight.legs.length - 1]!
      copyTether(this.tether, leg.tether)
    }
    flight.settle(status)
  }

  // --- Direct manipulation (PRD 6.1.1) -------------------------------------------------------

  /**
   * Drag orbits around the current focus. `dx`/`dy` are radians; the input layer converts pixels.
   * `rate` carries the drag's instantaneous speed so releasing the pointer coasts instead of
   * stopping dead.
   */
  orbitBy(dx: number, dy: number, dxRate = 0, dyRate = 0): void {
    this.azimuth += dx
    this.polar = clamp(this.polar + dy, MIN_POLAR, MAX_POLAR)
    this.azimuthRate = dxRate
    this.polarRate = dyRate
    this.writeCamera()
  }

  /**
   * PRD 6.1.1: scroll or pinch zooms, "within the focus's distance limits" (PRD 5.7.1) — so this
   * one is a hard clamp. The soft spring below exists for the case the user did not ask for: a
   * hand-over or an attract exit that left the camera outside the limits of the tether it landed
   * on.
   */
  zoomBy(factor: number): void {
    this.dist = clamp(this.dist * factor, this.tether.minDistance, this.tether.maxDistance)
    this.distanceRate = 0
    this.writeCamera()
  }

  // --- The frame -----------------------------------------------------------------------------

  update(dt: number): void {
    this.motion.advance(dt)
    if (this.flight) {
      // `applyTween` writes `position` and `lookAt` itself, from the *lerped* tether. Calling
      // `writeCamera` here as well would rebuild the position from the tether the flight started
      // at and throw the whole path away — the camera would orbit the origin at the tween's radius
      // instead of flying anywhere.
      this.advanceFlight(dt)
    } else {
      this.advanceOrbit(dt)
      this.writeCamera()
    }
    this.avoidGeometry()
  }

  // --- Internals -----------------------------------------------------------------------------

  private advanceOrbit(dt: number): void {
    // Exactly integrated decay, so the coast after a drag or a hand-over covers the same arc at
    // 30 fps as at 120 (PRD 5.3.17, 7.3.1).
    this.azimuth += decayIntegral(this.azimuthRate, ORBIT_DAMPING, dt)
    this.polar = clamp(
      this.polar + decayIntegral(this.polarRate, ORBIT_DAMPING, dt),
      MIN_POLAR,
      MAX_POLAR,
    )
    const decay = Math.exp(-ORBIT_DAMPING * dt)
    this.azimuthRate *= decay
    this.polarRate *= decay
    this.advanceDistance(dt)
  }

  /**
   * The distance channel, in closed form — PRD 5.7.1's limits without breaking PRD 9.1.3.
   *
   * Inside the limits the distance simply coasts, on the same exactly integrated decay the two
   * angles use. Outside them the limit pulls back as a *force* rather than a position correction
   * (see `LIMIT_SPRING`), which makes `(distance, distanceRate)` a damped oscillator. Stepping that
   * acceleration per frame — `distanceRate += excess · k · dt` — was a Riemann sum and therefore
   * frame-rate dependent: 0.022 units of spread between 30 and 120 fps over the same six seconds.
   * Both regimes are solved exactly here instead.
   *
   * The step is also split at the instant the camera crosses a limit, so the regime changes at the
   * same *time* at every frame rate rather than at whichever frame boundary comes next. Both
   * crossing times are closed forms too, which is what keeps this a fixed amount of work: an
   * overdamped spring cannot overshoot, so a step contains at most one crossing each way.
   */
  private advanceDistance(dt: number): void {
    let remaining = dt
    for (let guard = 0; guard < 4 && remaining > 1e-12; guard += 1) {
      const limit =
        this.dist < this.tether.minDistance
          ? this.tether.minDistance
          : this.dist > this.tether.maxDistance
            ? this.tether.maxDistance
            : null
      remaining -=
        limit === null ? this.coastDistance(remaining) : this.springDistance(limit, remaining)
    }
  }

  /**
   * A free coast inside the limits, cut short at the moment it would leave them. Returns the time
   * it consumed, which is less than `dt` only when the camera crossed out.
   */
  private coastDistance(dt: number): number {
    const rate = this.distanceRate
    let t = dt
    if (rate !== 0) {
      const limit = rate > 0 ? this.tether.maxDistance : this.tether.minDistance
      // `d(t) = d₀ + r₀(1 - e^(-λt))/λ`, solved for `d(t) = limit`. A share of 1 or more means the
      // coast decays to a halt before it ever gets there; a share at (or below) zero means the
      // camera is already sitting on the limit, where the spring has nothing to pull against.
      const share = ((limit - this.dist) * ORBIT_DAMPING) / rate
      if (share > 1e-9 && share < 1) t = Math.min(dt, -Math.log(1 - share) / ORBIT_DAMPING)
    }
    this.dist += decayIntegral(rate, ORBIT_DAMPING, t)
    this.distanceRate = rate * Math.exp(-ORBIT_DAMPING * t)
    return t
  }

  /**
   * The overdamped return to `limit`, solved exactly, cut short at the instant the camera gets back
   * inside. Returns the time it consumed.
   */
  private springDistance(limit: number, dt: number): number {
    const x0 = this.dist - limit
    const v0 = this.distanceRate
    // `x(t) = a·e^(slow·t) + b·e^(fast·t)`, fitted to `x(0) = x₀` and `ẋ(0) = v₀`.
    const a = (v0 - SPRING_ROOT_FAST * x0) / SPRING_ROOT_GAP
    const b = (SPRING_ROOT_SLOW * x0 - v0) / SPRING_ROOT_GAP

    let t = dt
    if (a !== 0) {
      // `x` reaches zero — the camera is back inside — where `e^((slow - fast)·t) = -b/a`. Two
      // decaying exponentials of the same sign never cancel, so there is at most this one root.
      const ratio = -b / a
      if (ratio > 0) {
        const crossing = Math.log(ratio) / SPRING_ROOT_GAP
        if (crossing > 0 && crossing < t) t = crossing
      }
    }

    const slow = Math.exp(SPRING_ROOT_SLOW * t)
    const fast = Math.exp(SPRING_ROOT_FAST * t)
    this.dist = limit + a * slow + b * fast
    this.distanceRate = a * SPRING_ROOT_SLOW * slow + b * SPRING_ROOT_FAST * fast
    return t
  }

  private advanceFlight(dt: number): void {
    const flight = this.flight!
    const leg = flight.legs[flight.index]!
    flight.elapsed += dt
    if (flight.elapsed < 0) return // still in PRD 6.2.3's hold

    const u = leg.durationS <= 0 ? 1 : clamp(flight.elapsed / leg.durationS, 0, 1)
    this.applyTween(flight, leg, u)

    if (u >= 1) {
      // The leg has landed, so the camera is now tethered to *its* destination. Doing this only at
      // the end of the last leg left a two-stage card fly-to (PRD 6.2.3) starting its second leg
      // from the tether the *first* one departed from, and arcing back out through the multiverse.
      copyTether(this.tether, leg.tether)
      if (flight.index + 1 < flight.legs.length) {
        this.beginLeg(flight.index + 1)
      } else {
        this.azimuthRate = 0
        this.polarRate = 0
        this.distanceRate = 0
        this.flight = null
        flight.settle('completed')
      }
    }
  }

  private beginLeg(index: number): void {
    const flight = this.flight!
    const leg = flight.legs[index]!
    flight.index = index
    flight.elapsed = -Math.max(0, leg.holdS)

    // Freeze the start pose. The start *tether* is copied rather than referenced: its plane goes on
    // moving during the flight, which is the point — the path follows both ends (PRD 5.7.4).
    copyTether(flight.startTether, this.tether)
    flight.startAzimuth = this.azimuth
    flight.startPolar = this.polar
    flight.startDistance = this.dist

    flight.endDistance = leg.distance ?? leg.tether.frameDistance
    const polar = clamp(leg.polar ?? leg.tether.framePolar, MIN_POLAR, MAX_POLAR)
    const azimuth = leg.azimuth ?? this.azimuth
    // The arrival offset, converted once into the destination's local frame and tracked there.
    set(
      this.sEndDir,
      Math.sin(polar) * Math.cos(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.sin(azimuth),
    )
    this.toLocalDir(flight.endLocalDir, leg.tether, this.sEndDir)

    // PRD 5.7.5: work out how far the path has to arc to clear every galaxy disc on the way.
    tetherPosition(this.sTetherB, leg.tether, this.motion)
    addScaled(this.sScratch, this.sTetherB, this.sEndDir, flight.endDistance)
    flight.bulge =
      leg.durationS <= 0
        ? 0
        : clearanceBulge(this.position, this.sScratch, this.motion.planes, this.motion)

    if (leg.durationS <= 0 && leg.holdS <= 0) {
      this.applyTween(flight, leg, 1)
      copyTether(this.tether, leg.tether)
      if (index + 1 < flight.legs.length) this.beginLeg(index + 1)
      else {
        this.flight = null
        flight.settle('completed')
      }
    }
  }

  /** Position the camera at parameter `u` of `leg`. Both tethers are read live. */
  private applyTween(flight: ActiveFlight, leg: FlightLeg, u: number): void {
    const e = easeInOut(u)
    tetherPosition(this.sTetherA, flight.startTether, this.motion)
    tetherPosition(this.sTetherB, leg.tether, this.motion)

    // The arrival direction, re-derived from the destination's local frame every frame, so a plane
    // that spins through a quarter turn during the flight is still framed from the same side.
    this.fromLocalDir(this.sEndDir, leg.tether, flight.endLocalDir)
    const endPolar = Math.acos(clamp(this.sEndDir.y, -1, 1))
    const endAzimuth = Math.atan2(this.sEndDir.z, this.sEndDir.x)

    this.azimuth = flight.startAzimuth + shortestAngle(flight.startAzimuth, endAzimuth) * e
    this.polar = clamp(flight.startPolar + (endPolar - flight.startPolar) * e, MIN_POLAR, MAX_POLAR)
    this.dist =
      flight.startDistance +
      (flight.endDistance - flight.startDistance) * e +
      flight.bulge * Math.sin(Math.PI * u)

    // The tether itself slides from one end to the other, which is what turns two orbits into one
    // continuous path rather than a cut.
    this.sTetherNow.x = this.sTetherA.x + (this.sTetherB.x - this.sTetherA.x) * e
    this.sTetherNow.y = this.sTetherA.y + (this.sTetherB.y - this.sTetherA.y) * e
    this.sTetherNow.z = this.sTetherA.z + (this.sTetherB.z - this.sTetherA.z) * e

    this.sphericalOffset(this.sOffset, this.azimuth, this.polar, this.dist)
    set(
      this.position,
      this.sTetherNow.x + this.sOffset.x,
      this.sTetherNow.y + this.sOffset.y,
      this.sTetherNow.z + this.sOffset.z,
    )
    copy(this.lookAt, this.sTetherNow)
  }

  /**
   * The tween's world velocity at this instant, differentiated analytically rather than by
   * differencing frames — a difference is one frame stale and, at 30 fps, visibly so.
   *
   * The live tethers are held fixed here: their own drift (PRD 5.3.15, ≲ 0.1 units/s) is carried by
   * the tether on both sides of the hand-over and so cancels out of the discontinuity this exists
   * to remove.
   */
  private tweenVelocity(flight: ActiveFlight, out: MutVec3): MutVec3 {
    const leg = flight.legs[flight.index]!
    if (leg.durationS <= 0 || flight.elapsed < 0) return set(out, 0, 0, 0)
    const u = clamp(flight.elapsed / leg.durationS, 0, 1)
    const slope = easeInOutSlope(u) / leg.durationS

    tetherPosition(this.sTetherA, flight.startTether, this.motion)
    tetherPosition(this.sTetherB, leg.tether, this.motion)
    this.fromLocalDir(this.sEndDir, leg.tether, flight.endLocalDir)
    const endPolar = Math.acos(clamp(this.sEndDir.y, -1, 1))
    const endAzimuth = Math.atan2(this.sEndDir.z, this.sEndDir.x)

    const dAzimuth = shortestAngle(flight.startAzimuth, endAzimuth) * slope
    const dPolar = (endPolar - flight.startPolar) * slope
    const dDistance =
      (flight.endDistance - flight.startDistance) * slope +
      (flight.bulge * Math.PI * Math.cos(Math.PI * u)) / leg.durationS

    // d/dt of the tether lerp.
    set(
      out,
      (this.sTetherB.x - this.sTetherA.x) * slope,
      (this.sTetherB.y - this.sTetherA.y) * slope,
      (this.sTetherB.z - this.sTetherA.z) * slope,
    )
    // Plus the spherical part, in the orthonormal basis at the current pose.
    const sp = Math.sin(this.polar)
    const cp = Math.cos(this.polar)
    const sa = Math.sin(this.azimuth)
    const ca = Math.cos(this.azimuth)
    // ê_r
    out.x += sp * ca * dDistance
    out.y += cp * dDistance
    out.z += sp * sa * dDistance
    // ê_θ · d·sinφ
    out.x += -sa * this.dist * sp * dAzimuth
    out.z += ca * this.dist * sp * dAzimuth
    // ê_φ · d
    out.x += cp * ca * this.dist * dPolar
    out.y += -sp * this.dist * dPolar
    out.z += cp * sa * this.dist * dPolar
    return out
  }

  /** The inverse of the above: a world velocity becomes the orbit's three rates. */
  private projectVelocityToRates(velocity: Readonly<MutVec3>, d: number): void {
    const sp = Math.sin(this.polar)
    const cp = Math.cos(this.polar)
    const sa = Math.sin(this.azimuth)
    const ca = Math.cos(this.azimuth)

    set(this.sBasis, sp * ca, cp, sp * sa) // ê_r
    this.distanceRate = dot(velocity, this.sBasis)

    set(this.sBasis, -sa, 0, ca) // ê_θ
    const tangential = d * sp
    this.azimuthRate = tangential > 1e-6 ? dot(velocity, this.sBasis) / tangential : 0

    set(this.sBasis, cp * ca, -sp, cp * sa) // ê_φ
    this.polarRate = d > 1e-6 ? dot(velocity, this.sBasis) / d : 0
  }

  private sphericalOffset(out: MutVec3, azimuth: number, polar: number, d: number): MutVec3 {
    const sp = Math.sin(polar)
    return set(out, d * sp * Math.cos(azimuth), d * Math.cos(polar), d * sp * Math.sin(azimuth))
  }

  private writeCamera(): void {
    tetherPosition(this.sTetherNow, this.tether, this.motion)
    this.sphericalOffset(this.sOffset, this.azimuth, this.polar, this.dist)
    set(
      this.position,
      this.sTetherNow.x + this.sOffset.x,
      this.sTetherNow.y + this.sOffset.y,
      this.sTetherNow.z + this.sOffset.z,
    )
    copy(this.lookAt, this.sTetherNow)
  }

  /**
   * PRD 5.7.5: the camera never intersects a galaxy disc. The tether's own plane is skipped — its
   * distance limits already keep the camera outside it, and at card level the camera is *inside*
   * that plane by definition.
   */
  private avoidGeometry(): void {
    let pushed = false
    const own = this.tether.planeIndex
    for (const plane of this.motion.planes) {
      if (plane.index === own) continue
      if (plane.radius >= this.framing.multiverseRadius) continue // the dust row spans everything
      const exclusion = plane.radius * 1.3
      this.motion.planePosition(this.sCentre, plane)
      const gap = distance(this.position, this.sCentre)
      if (gap >= exclusion || gap === 0) continue
      sub(this.sScratch, this.position, this.sCentre)
      normalise(this.sScratch, this.sScratch)
      addScaled(this.position, this.sCentre, this.sScratch, exclusion)
      pushed = true
    }
    // A push during a flight is a per-frame projection of a continuously moving point, so the path
    // stays continuous and the tween keeps its own parameters. While orbiting there is no tween to
    // recompute from, so the pose has to absorb the push or the next frame would simply undo it.
    if (pushed && !this.flight) this.rebaseTo(this.tether)
  }

  private toLocalDir(out: MutVec3, tether: Readonly<Tether>, world: Readonly<MutVec3>): MutVec3 {
    // The multiverse's frame *is* the world frame. Co-rotating the home view with PRD 5.3.13's
    // 20-minute turn would hide the very rotation that view exists to show.
    if (tether.planeIndex < 0) return copy(out, world)
    const plane = this.motion.planes[tether.planeIndex]
    if (!plane) return copy(out, world)
    return this.motion.worldDirToPlaneLocal(out, plane, world)
  }

  private fromLocalDir(out: MutVec3, tether: Readonly<Tether>, local: Readonly<MutVec3>): MutVec3 {
    if (tether.planeIndex < 0) return copy(out, local)
    const plane = this.motion.planes[tether.planeIndex]
    if (!plane) return copy(out, local)
    return this.motion.planeLocalDirToWorld(out, plane, local)
  }
}
