/**
 * The camera rig's arithmetic.
 *
 * Deliberately not three.js: PRD 7.3.2 forbids allocation in the per-frame path, and the rig runs
 * every frame. These are mutating operations on plain `{x, y, z}` records that the rig preallocates
 * once and reuses forever. `Vec3` tuples from the navigation contract are converted at the API
 * boundary only — the UI never imports three.js (docs/navigation-contract.md §4), and neither does
 * the part of the rig that has to be testable in Node.
 */

import type { Vec3 } from '../navigation/types'

export interface MutVec3 {
  x: number
  y: number
  z: number
}

export function vec(x = 0, y = 0, z = 0): MutVec3 {
  return { x, y, z }
}

export function set(out: MutVec3, x: number, y: number, z: number): MutVec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function copy(out: MutVec3, a: Readonly<MutVec3>): MutVec3 {
  out.x = a.x
  out.y = a.y
  out.z = a.z
  return out
}

export function fromTuple(out: MutVec3, a: Vec3 | readonly number[]): MutVec3 {
  out.x = a[0] ?? 0
  out.y = a[1] ?? 0
  out.z = a[2] ?? 0
  return out
}

export function toTuple(a: Readonly<MutVec3>): Vec3 {
  return [a.x, a.y, a.z]
}

export function add(out: MutVec3, a: Readonly<MutVec3>, b: Readonly<MutVec3>): MutVec3 {
  out.x = a.x + b.x
  out.y = a.y + b.y
  out.z = a.z + b.z
  return out
}

export function sub(out: MutVec3, a: Readonly<MutVec3>, b: Readonly<MutVec3>): MutVec3 {
  out.x = a.x - b.x
  out.y = a.y - b.y
  out.z = a.z - b.z
  return out
}

export function scale(out: MutVec3, a: Readonly<MutVec3>, k: number): MutVec3 {
  out.x = a.x * k
  out.y = a.y * k
  out.z = a.z * k
  return out
}

export function addScaled(
  out: MutVec3,
  a: Readonly<MutVec3>,
  b: Readonly<MutVec3>,
  k: number,
): MutVec3 {
  out.x = a.x + b.x * k
  out.y = a.y + b.y * k
  out.z = a.z + b.z * k
  return out
}

export function lerp(
  out: MutVec3,
  a: Readonly<MutVec3>,
  b: Readonly<MutVec3>,
  u: number,
): MutVec3 {
  out.x = a.x + (b.x - a.x) * u
  out.y = a.y + (b.y - a.y) * u
  out.z = a.z + (b.z - a.z) * u
  return out
}

export function length(a: Readonly<MutVec3>): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function distance(a: Readonly<MutVec3>, b: Readonly<MutVec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function dot(a: Readonly<MutVec3>, b: Readonly<MutVec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(out: MutVec3, a: Readonly<MutVec3>, b: Readonly<MutVec3>): MutVec3 {
  const x = a.y * b.z - a.z * b.y
  const y = a.z * b.x - a.x * b.z
  const z = a.x * b.y - a.y * b.x
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function normalise(out: MutVec3, a: Readonly<MutVec3>): MutVec3 {
  const l = length(a)
  if (l === 0) return set(out, 0, 0, 0)
  return scale(out, a, 1 / l)
}

/** Rotate about the world +Y axis. The multiverse's own rotation and a plane's spin are both this. */
export function rotateY(out: MutVec3, a: Readonly<MutVec3>, angle: number): MutVec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const { x, z } = a
  out.x = x * c + z * s
  out.y = a.y
  out.z = -x * s + z * c
  return out
}

/** Apply a unit quaternion `[x, y, z, w]` — the plane tilt of PRD 5.3.6. */
export function applyQuat(
  out: MutVec3,
  a: Readonly<MutVec3>,
  q: readonly number[],
): MutVec3 {
  const qx = q[0] ?? 0
  const qy = q[1] ?? 0
  const qz = q[2] ?? 0
  const qw = q[3] ?? 1
  const { x, y, z } = a
  // t = 2 · (q_vec × v); v' = v + q_w · t + q_vec × t
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  out.x = x + qw * tx + qy * tz - qz * ty
  out.y = y + qw * ty + qz * tx - qx * tz
  out.z = z + qw * tz + qx * ty - qy * tx
  return out
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * The shortest signed way from `from` to `to` around a circle, so an azimuth tween never takes the
 * long way round because the two angles happen to straddle ±π.
 */
export function shortestAngle(from: number, to: number): number {
  const twoPi = Math.PI * 2
  let delta = (to - from) % twoPi
  if (delta > Math.PI) delta -= twoPi
  if (delta < -Math.PI) delta += twoPi
  return delta
}

/**
 * PRD 5.7.3's ease-in-out, and its derivative.
 *
 * The derivative is not a nicety: PRD 7.3.6 requires hand-over to be continuous in *velocity*, so
 * the rig has to know how fast the tween was moving at the instant the user grabbed the camera.
 * Differencing successive frames would be one frame stale and noisy at low frame rates.
 */
export function easeInOut(u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2
}

/** d/du of `easeInOut`. Zero at both ends, 3 at the midpoint. */
export function easeInOutSlope(u: number): number {
  if (u <= 0 || u >= 1) return 0
  return u < 0.5 ? 12 * u * u : 12 * (1 - u) * (1 - u)
}

/**
 * Frame-rate-independent exponential approach: the exact solution of `ẋ = -λ(x - target)` over
 * `dt`, not a per-frame `x += (target - x) · k`. PRD 5.3.17 and 7.3.1 make this the difference
 * between a rig that behaves identically at 30 and 120 fps and one that only looks like it does.
 */
export function approach(current: number, target: number, lambda: number, dt: number): number {
  if (lambda <= 0) return current
  return target + (current - target) * Math.exp(-lambda * dt)
}

/**
 * The exact integral of a decaying rate over `dt`: `∫₀^dt r·e^(-λs) ds`. Stepping
 * `position += rate · dt; rate *= e^(-λ·dt)` is a Riemann sum and therefore depends on the frame
 * rate; this does not.
 */
export function decayIntegral(rate: number, lambda: number, dt: number): number {
  if (lambda <= 0) return rate * dt
  return (rate * (1 - Math.exp(-lambda * dt))) / lambda
}
