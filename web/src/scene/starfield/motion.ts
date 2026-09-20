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
 * `starfield.test.ts` asserts the shared invariants on this side. Nothing checks the GLSL twin
 * against it: `scripts/verify-browser.mjs` was the CPU-to-GPU read-back and it left the tree with
 * the star field at the cutover (DEC-752), so the agreement the three points above describe now
 * rests on the two being read side by side. The twin is still live — `cards/cardShaders.ts`
 * compiles `MOTION_GLSL` into the thumbnail program. Recorded on DEC-872.
 */

import {
  DRIFT_VERTICAL_RATIO,
  DUST_CURL_AMPLITUDE,
  DUST_CURL_SCALE,
  DUST_CURL_SPEED,
  SHEAR_RADIAL_PHASE,
} from '../tuning'
import { valueNoise3 } from './noise'

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
  return valueNoise3(x + POTENTIAL_OFFSET_X, y + POTENTIAL_OFFSET_X, z + POTENTIAL_OFFSET_X)
}
function potentialY(x: number, y: number, z: number): number {
  return valueNoise3(x + POTENTIAL_OFFSET_Y, y + POTENTIAL_OFFSET_Y, z + POTENTIAL_OFFSET_Y)
}
function potentialZ(x: number, y: number, z: number): number {
  return valueNoise3(x + POTENTIAL_OFFSET_Z, y + POTENTIAL_OFFSET_Z, z + POTENTIAL_OFFSET_Z)
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
    // The spin is about plane-local **+Y**, the disc's own normal — not local Z (DEC-750, DEC-774).
    // See `worlds/spin.ts`: the generator writes `x = r·cos θ`, `z = r·sin θ`, `y = thickness`, so
    // local Z lies *in* the disc and a rotation about it turns the disc end over end. The shear
    // radius is the same disc's radius and moves with it.
    const radial = Math.sqrt(px * px + pz * pz)
    const angle = table[base + PT_SPIN_ANGLE]! + shearAngle(table, row, radial, time) * motion
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const rx = px * c + pz * s
    pz = -px * s + pz * c
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
