/**
 * The star motion function — the CPU half of it.
 *
 * PRD 8.5.3 puts motion in the vertex shader. PRD 8.5.7 then needs *one* star's position on the
 * CPU, for the camera tether and the fly-to target, and says so explicitly: "this is the only star
 * position ever computed on the CPU". That makes this file and the vertex shader in `./shaders`
 * two implementations of one formula, and any drift between them shows up as a camera that frames
 * a spot the star is not in.
 *
 * Three things keep them honest:
 *  1. the row layout below is the only definition of the plane table, shared by both;
 *  2. every constant comes from `../tuning`, injected into the GLSL as a `#define`;
 *  3. the dust turbulence uses a 32-bit integer hash, evaluated with `Math.imul` here and with
 *     `uint` arithmetic there, so the two agree exactly rather than approximately — a `sin`-based
 *     hash would diverge between the CPU's float64 and the GPU's float32 by more than the
 *     turbulence amplitude itself.
 *
 * `starfield.test.ts` asserts the shared invariants; `scripts/verify-browser.mjs` reads world
 * positions back off the GPU and compares them with this file.
 */

import {
  DRIFT_VERTICAL_RATIO,
  DUST_CURL_AMPLITUDE,
  DUST_CURL_SCALE,
  DUST_CURL_SPEED,
  SHEAR_RADIAL_PHASE,
} from '../tuning'

/** RGBA texels per plane row of the PRD 8.5.2 `DataTexture`. */
export const PLANE_TEXELS = 6
export const FLOATS_PER_PLANE = PLANE_TEXELS * 4

/*
 * Row layout, shared with the vertex shader:
 *   texel 0: home.x, home.y, home.z, radius
 *   texel 1: tilt quaternion x, y, z, w
 *   texel 2: driftAmplitude, driftAngularVelocity, driftPhase, spinAngle
 *   texel 3: shearAmplitude, shearAngularVelocity, shearPhase, kind
 *   texel 4: fade, focusBoost, glowRadius, glowOpacityScale
 *   texel 5: nebulaTint.r, nebulaTint.g, nebulaTint.b, spare
 */
export const PT_HOME = 0
export const PT_RADIUS = 3
export const PT_TILT = 4
export const PT_DRIFT_AMPLITUDE = 8
export const PT_DRIFT_VELOCITY = 9
export const PT_DRIFT_PHASE = 10
export const PT_SPIN_ANGLE = 11
export const PT_SHEAR_AMPLITUDE = 12
export const PT_SHEAR_VELOCITY = 13
export const PT_SHEAR_PHASE = 14
export const PT_KIND = 15
export const PT_FADE = 16
export const PT_FOCUS = 17
export const PT_GLOW_RADIUS = 18
export const PT_GLOW_OPACITY = 19
export const PT_TINT = 20

/** `kind` in texel 3.w. The star shader branches on dust; the glow pass branches on empty. */
export const PlaneKindCode = { Spiral: 0, Irregular: 1, Empty: 2, Dust: 3 } as const
export type PlaneKindCode = (typeof PlaneKindCode)[keyof typeof PlaneKindCode]

export const TAU = Math.PI * 2

/** A mutable xyz, so the whole file can run without allocating (PRD 7.3.2). */
export interface MutableVec3 {
  x: number
  y: number
  z: number
}

/**
 * PRD 5.3.15: a plane drifts on a small slow orbit around its home position. A flattened ellipse
 * — mostly in the disc plane, with a gentle vertical bob at twice the rate so the path is a figure
 * of eight rather than a circle and neighbouring planes never share a phase portrait.
 *
 * The amplitude is in world units: PRD 5.3.3 sizes the minimum spacing against it directly, so it
 * must not be scaled by the plane radius.
 */
export function driftOffset(
  table: Float32Array,
  row: number,
  time: number,
  out: MutableVec3,
): MutableVec3 {
  const base = row * FLOATS_PER_PLANE
  const amplitude = table[base + PT_DRIFT_AMPLITUDE]!
  const angle = table[base + PT_DRIFT_VELOCITY]! * time + table[base + PT_DRIFT_PHASE]!
  out.x = amplitude * Math.cos(angle)
  out.y = amplitude * Math.sin(angle * 2) * DRIFT_VERTICAL_RATIO
  out.z = amplitude * Math.sin(angle)
  return out
}

/**
 * PRD 5.4.13's bounded shear: `A · sin(2πt/T + φ(r))`, with `A ≤ 10°`. `φ(r)` adds a radial phase
 * gradient so the wave travels outward along the arms. Bounded by construction — the offset is a
 * sine, never an accumulator — which is exactly what the PRD forbids differential rotation to
 * protect: however long the session runs, the arms cannot wind up.
 */
export function shearAngle(table: Float32Array, row: number, radius: number, time: number): number {
  const base = row * FLOATS_PER_PLANE
  return (
    table[base + PT_SHEAR_AMPLITUDE]! *
    Math.sin(
      table[base + PT_SHEAR_VELOCITY]! * time +
        table[base + PT_SHEAR_PHASE]! +
        radius * SHEAR_RADIAL_PHASE,
    )
  )
}

/**
 * 32-bit integer hash (a Wang-style avalanche). Written with `Math.imul` so it is exactly the
 * `uint` arithmetic the GLSL twin performs — see the file header for why exactness matters.
 */
function hashU32(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 747796405) + Math.imul(y, 2891336453) + Math.imul(z, 3266489917)) >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  h = Math.imul(h, 2246822519) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 3266489917) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h
}

/** The hash as a float in [0, 1), using the top 24 bits so it is exact in float32. */
function hash01(x: number, y: number, z: number): number {
  return (hashU32(x, y, z) >>> 8) * (1 / 16777216)
}

/** Trilinear value noise on the integer lattice, smoothstep-interpolated. Range [0, 1). */
function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const c000 = hash01(ix, iy, iz)
  const c100 = hash01(ix + 1, iy, iz)
  const c010 = hash01(ix, iy + 1, iz)
  const c110 = hash01(ix + 1, iy + 1, iz)
  const c001 = hash01(ix, iy, iz + 1)
  const c101 = hash01(ix + 1, iy, iz + 1)
  const c011 = hash01(ix, iy + 1, iz + 1)
  const c111 = hash01(ix + 1, iy + 1, iz + 1)
  const x00 = c000 + (c100 - c000) * ux
  const x10 = c010 + (c110 - c010) * ux
  const x01 = c001 + (c101 - c001) * ux
  const x11 = c011 + (c111 - c011) * ux
  const y0 = x00 + (x10 - x00) * uy
  const y1 = x01 + (x11 - x01) * uy
  return y0 + (y1 - y0) * uz
}

/** The three offset noise fields whose curl becomes the turbulence. */
const POTENTIAL_OFFSET_X = 0
const POTENTIAL_OFFSET_Y = 137.13
const POTENTIAL_OFFSET_Z = 311.7
/**
 * The finite-difference step of the curl, exported because it is the scale at which the field is
 * actually divergence-free: `div(curl)` cancels exactly when the outer difference uses the same
 * step as the inner one, and not otherwise. Kept in step with `CURL_EPSILON` in the shader.
 */
export const CURL_EPSILON = 0.35

function potentialX(x: number, y: number, z: number): number {
  return valueNoise(x + POTENTIAL_OFFSET_X, y + POTENTIAL_OFFSET_X, z + POTENTIAL_OFFSET_X)
}
function potentialY(x: number, y: number, z: number): number {
  return valueNoise(x + POTENTIAL_OFFSET_Y, y + POTENTIAL_OFFSET_Y, z + POTENTIAL_OFFSET_Y)
}
function potentialZ(x: number, y: number, z: number): number {
  return valueNoise(x + POTENTIAL_OFFSET_Z, y + POTENTIAL_OFFSET_Z, z + POTENTIAL_OFFSET_Z)
}

/**
 * PRD 5.3.16 / 8.6.3: the Blind Eternities dust moves with slow curl-noise turbulence and never
 * settles. Curl of a vector potential is divergence-free, which is what keeps the dust from
 * pooling in sinks the way a plain noise displacement would.
 *
 * Central differences rather than analytic gradients: value noise has no cheap analytic gradient,
 * and six lattice evaluations is a fraction of the cost of the six texture fetches the same vertex
 * already does.
 */
export function curlNoise(x: number, y: number, z: number, out: MutableVec3): MutableVec3 {
  const e = CURL_EPSILON
  const inv = 1 / (2 * e)
  const dzdy = (potentialZ(x, y + e, z) - potentialZ(x, y - e, z)) * inv
  const dydz = (potentialY(x, y, z + e) - potentialY(x, y, z - e)) * inv
  const dxdz = (potentialX(x, y, z + e) - potentialX(x, y, z - e)) * inv
  const dzdx = (potentialZ(x + e, y, z) - potentialZ(x - e, y, z)) * inv
  const dydx = (potentialY(x + e, y, z) - potentialY(x - e, y, z)) * inv
  const dxdy = (potentialX(x, y + e, z) - potentialX(x, y - e, z)) * inv
  out.x = dzdy - dydz
  out.y = dxdz - dzdx
  out.z = dydx - dxdy
  return out
}

const curlScratch: MutableVec3 = { x: 0, y: 0, z: 0 }
const driftScratch: MutableVec3 = { x: 0, y: 0, z: 0 }

/**
 * The whole motion function, mirroring `starVertexMotion` in the shader step for step.
 *
 * PRD 8.5.3's order: rotate about the plane's axis by the accumulated angle plus the bounded
 * shear, apply the tilt, scale to the plane's radius, add the drift offset, translate to the
 * plane's position, then apply the multiverse rotation.
 *
 * `local` is the plane-local position straight out of the star record (PRD 8.6.2, inside the frame
 * radius of 1.2). Allocates nothing.
 */
export function starWorldPosition(
  table: Float32Array,
  row: number,
  localX: number,
  localY: number,
  localZ: number,
  time: number,
  multiverseAngle: number,
  motion: number,
  out: MutableVec3,
): MutableVec3 {
  const base = row * FLOATS_PER_PLANE
  let px = localX
  let py = localY
  let pz = localZ

  if (table[base + PT_KIND] === PlaneKindCode.Dust) {
    // PRD 8.6.3: the dust is stored in multiverse-normalised coordinates, so the turbulence is
    // applied here, before the radius scale, and its amplitude is in the same units.
    curlNoise(
      px * DUST_CURL_SCALE + time * DUST_CURL_SPEED,
      py * DUST_CURL_SCALE + time * DUST_CURL_SPEED,
      pz * DUST_CURL_SCALE + time * DUST_CURL_SPEED,
      curlScratch,
    )
    px += curlScratch.x * DUST_CURL_AMPLITUDE * motion
    py += curlScratch.y * DUST_CURL_AMPLITUDE * motion
    pz += curlScratch.z * DUST_CURL_AMPLITUDE * motion
  } else {
    const radial = Math.sqrt(px * px + py * py)
    const angle =
      table[base + PT_SPIN_ANGLE]! + shearAngle(table, row, radial, time) * motion
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const rx = px * c - py * s
    py = px * s + py * c
    px = rx
  }

  // Tilt: rotate by the plane's quaternion (PRD 8.6.2's seeded disc tilt).
  const qx = table[base + PT_TILT]!
  const qy = table[base + PT_TILT + 1]!
  const qz = table[base + PT_TILT + 2]!
  const qw = table[base + PT_TILT + 3]!
  const tx = 2 * (qy * pz - qz * py)
  const ty = 2 * (qz * px - qx * pz)
  const tz = 2 * (qx * py - qy * px)
  px += qw * tx + qy * tz - qz * ty
  py += qw * ty + qz * tx - qx * tz
  pz += qw * tz + qx * ty - qy * tx

  const radius = table[base + PT_RADIUS]!
  px *= radius
  py *= radius
  pz *= radius

  driftOffset(table, row, time, driftScratch)
  px += table[base + PT_HOME]! + driftScratch.x * motion
  py += table[base + PT_HOME + 1]! + driftScratch.y * motion
  pz += table[base + PT_HOME + 2]! + driftScratch.z * motion

  // PRD 5.3.13: the whole multiverse turns about its vertical axis.
  const mc = Math.cos(multiverseAngle)
  const ms = Math.sin(multiverseAngle)
  out.x = px * mc + pz * ms
  out.y = py
  out.z = -px * ms + pz * mc
  return out
}

/** {@link starWorldPosition} with the rotation dropped: where a plane's centre is (PRD 8.5.6). */
export function planeWorldPosition(
  table: Float32Array,
  row: number,
  time: number,
  multiverseAngle: number,
  motion: number,
  out: MutableVec3,
): MutableVec3 {
  const base = row * FLOATS_PER_PLANE
  driftOffset(table, row, time, driftScratch)
  const px = table[base + PT_HOME]! + driftScratch.x * motion
  const py = table[base + PT_HOME + 1]! + driftScratch.y * motion
  const pz = table[base + PT_HOME + 2]! + driftScratch.z * motion
  const mc = Math.cos(multiverseAngle)
  const ms = Math.sin(multiverseAngle)
  out.x = px * mc + pz * ms
  out.y = py
  out.z = -px * ms + pz * mc
  return out
}
