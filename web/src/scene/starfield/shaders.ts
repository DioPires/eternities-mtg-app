/**
 * The star field's GLSL, and the GPU half of the motion function.
 *
 * Read `./motion` first: it holds the plane-table row layout and the CPU mirror of everything
 * below, and the two must stay in step (PRD 8.5.3, 8.5.7). Every tunable arrives here as a
 * `#define` generated from `../tuning`, so there is no second copy of a constant to forget.
 *
 * three.js compiles a `ShaderMaterial` as `#version 300 es` and defines `attribute`/`varying` for
 * backwards compatibility, so the classic keywords below still get GLSL ES 3.0 semantics — which
 * is what makes `texelFetch`, `gl_VertexID` and `uint` available in the first place.
 */

import {
  DRIFT_VERTICAL_RATIO,
  DUST_CURL_AMPLITUDE,
  DUST_CURL_SCALE,
  DUST_CURL_SPEED,
  DUST_FOCUS_GAIN,
  FILTER_DIM,
  GLOW_MIN_ASPECT,
  HOVER_GAIN,
  SHEAR_RADIAL_PHASE,
  TWINKLE_AMPLITUDE,
  TWINKLE_RATE,
} from '../tuning'
import {
  PT_DRIFT_AMPLITUDE,
  PT_FADE,
  PT_HOME,
  PT_KIND,
  PT_SPIN_ANGLE,
  PlaneKindCode,
} from './motion'
import { glslFloat } from '../glsl'


const DEFINES = [
  ['DRIFT_VERTICAL_RATIO', DRIFT_VERTICAL_RATIO],
  ['SHEAR_RADIAL_PHASE', SHEAR_RADIAL_PHASE],
  ['DUST_CURL_AMPLITUDE', DUST_CURL_AMPLITUDE],
  ['DUST_CURL_SCALE', DUST_CURL_SCALE],
  ['DUST_CURL_SPEED', DUST_CURL_SPEED],
  ['DUST_FOCUS_GAIN', DUST_FOCUS_GAIN],
  ['TWINKLE_AMPLITUDE', TWINKLE_AMPLITUDE],
  ['TWINKLE_RATE', TWINKLE_RATE],
  ['FILTER_DIM', FILTER_DIM],
  ['HOVER_GAIN', HOVER_GAIN],
  ['GLOW_MIN_ASPECT', GLOW_MIN_ASPECT],
  ['KIND_DUST', PlaneKindCode.Dust],
  ['KIND_EMPTY', PlaneKindCode.Empty],
  ['PT_HOME_TEXEL', PT_HOME / 4],
  ['PT_TILT_TEXEL', 1],
  ['PT_DRIFT_TEXEL', PT_DRIFT_AMPLITUDE / 4],
  ['PT_SHEAR_TEXEL', 3],
  ['PT_FADE_TEXEL', PT_FADE / 4],
  ['PT_TINT_TEXEL', 5],
] as const

export const DEFINE_BLOCK = DEFINES.map(
  ([name, value]) =>
    `#define ${name} ${
      name.endsWith('_TEXEL') || name.startsWith('KIND_') ? String(value) : glslFloat(value)
    }`,
).join('\n')

// Sanity: the texel indices above are derived, so a row-layout edit that forgets one is caught at
// module load rather than as a silently wrong plane.
const EXPECTED_TEXELS: ReadonlyArray<readonly [number, number]> = [
  [PT_HOME / 4, 0],
  [PT_DRIFT_AMPLITUDE / 4, 2],
  [PT_SPIN_ANGLE, 11],
  [PT_KIND, 15],
  [PT_FADE / 4, 4],
]
for (const [actual, expected] of EXPECTED_TEXELS) {
  if (actual !== expected) {
    throw new Error(`plane-table layout moved: expected texel slot ${expected}, got ${actual}`)
  }
}

/*
 * The lattice hash, shared by the dust turbulence and the glow's dither.
 *
 * 32-bit integer arithmetic rather than the usual fract(sin(...)): the CPU mirror in ./motion has
 * to produce bit-identical lattice values, and a float hash would diverge between float64 and
 * float32 by more than the turbulence amplitude, putting the camera tether somewhere the dust card
 * is not.
 */
const HASH_GLSL = /* glsl */ `
uint hashU32(ivec3 c) {
  uint h = uint(c.x) * 747796405u + uint(c.y) * 2891336453u + uint(c.z) * 3266489917u;
  h ^= h >> 15u;
  h *= 2246822519u;
  h ^= h >> 13u;
  h *= 3266489917u;
  h ^= h >> 16u;
  return h;
}

float hash01(ivec3 c) {
  return float(hashU32(c) >> 8u) * (1.0 / 16777216.0);
}
`

/**
 * The shared motion chunk. It appears in the star vertex shader, in the glow vertex shader and —
 * since Phase 3 — in the thumbnail layer's, so a glow and a card thumbnail always sit exactly where
 * their plane's stars do. Exported for that third caller: a second copy of `starWorldPosition` is
 * precisely the drift the file header exists to forbid.
 */
export const MOTION_GLSL = /* glsl */ `
${HASH_GLSL}
uniform sampler2D uPlaneTable;
uniform float uTime;
uniform float uMultiverseAngle;
/** PRD 5.9: 0 freezes rotation, drift, twinkle and turbulence where they stand. */
uniform float uMotion;

vec4 planeTexel(int row, int texel) {
  return texelFetch(uPlaneTable, ivec2(texel, row), 0);
}

vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

vec3 rotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

/** PRD 5.3.15. Amplitude is in world units — PRD 5.3.3 sizes plane spacing against it directly. */
vec3 driftOffset(vec4 drift, float time) {
  float a = drift.y * time + drift.z;
  return vec3(drift.x * cos(a), drift.x * sin(a * 2.0) * DRIFT_VERTICAL_RATIO, drift.x * sin(a));
}

/**
 * PRD 5.4.13's bounded shear: A·sin(2πt/T + φ(r)), A ≤ 10°, with a radial phase gradient so the
 * wave travels outward along the arms. A sine, never an accumulator — so however long the session
 * runs the arms cannot wind up, which is exactly what the PRD forbids differential rotation for.
 */
float shearAngle(vec4 shear, float radius, float time) {
  return shear.x * sin(shear.y * time + shear.z + radius * SHEAR_RADIAL_PHASE);
}

/* PRD 5.3.16 / 8.6.3 — curl-noise turbulence for the Blind Eternities dust. */
float valueNoise(vec3 p) {
  ivec3 i = ivec3(floor(p));
  vec3 f = p - floor(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float c000 = hash01(i);
  float c100 = hash01(i + ivec3(1, 0, 0));
  float c010 = hash01(i + ivec3(0, 1, 0));
  float c110 = hash01(i + ivec3(1, 1, 0));
  float c001 = hash01(i + ivec3(0, 0, 1));
  float c101 = hash01(i + ivec3(1, 0, 1));
  float c011 = hash01(i + ivec3(0, 1, 1));
  float c111 = hash01(i + ivec3(1, 1, 1));
  float x00 = mix(c000, c100, u.x);
  float x10 = mix(c010, c110, u.x);
  float x01 = mix(c001, c101, u.x);
  float x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

#define CURL_EPSILON 0.35
#define POTENTIAL_OFFSET_Y 137.13
#define POTENTIAL_OFFSET_Z 311.7

/** Curl of a vector potential: divergence-free, so the dust never pools in a sink. */
vec3 curlNoise(vec3 p) {
  float e = CURL_EPSILON;
  float inv = 1.0 / (2.0 * e);
  vec3 oy = vec3(POTENTIAL_OFFSET_Y);
  vec3 oz = vec3(POTENTIAL_OFFSET_Z);
  float dzdy = (valueNoise(p + vec3(0.0, e, 0.0) + oz) - valueNoise(p - vec3(0.0, e, 0.0) + oz)) * inv;
  float dydz = (valueNoise(p + vec3(0.0, 0.0, e) + oy) - valueNoise(p - vec3(0.0, 0.0, e) + oy)) * inv;
  float dxdz = (valueNoise(p + vec3(0.0, 0.0, e)) - valueNoise(p - vec3(0.0, 0.0, e))) * inv;
  float dzdx = (valueNoise(p + vec3(e, 0.0, 0.0) + oz) - valueNoise(p - vec3(e, 0.0, 0.0) + oz)) * inv;
  float dydx = (valueNoise(p + vec3(e, 0.0, 0.0) + oy) - valueNoise(p - vec3(e, 0.0, 0.0) + oy)) * inv;
  float dxdy = (valueNoise(p + vec3(0.0, e, 0.0)) - valueNoise(p - vec3(0.0, e, 0.0))) * inv;
  return vec3(dzdy - dydz, dxdz - dzdx, dydx - dxdy);
}

/**
 * PRD 8.5.3, in order: rotate about the plane's axis by the accumulated angle plus the bounded
 * shear, apply the tilt, scale to the plane's radius, add the drift offset, translate to the
 * plane's position, then apply the multiverse rotation.
 */
vec3 starWorldPosition(int row, vec3 local) {
  vec4 home = planeTexel(row, PT_HOME_TEXEL);
  vec4 tilt = planeTexel(row, PT_TILT_TEXEL);
  vec4 drift = planeTexel(row, PT_DRIFT_TEXEL);
  vec4 shear = planeTexel(row, PT_SHEAR_TEXEL);

  vec3 p = local;
  if (int(shear.w) == KIND_DUST) {
    vec3 sample_ = p * DUST_CURL_SCALE + vec3(uTime * DUST_CURL_SPEED);
    p += curlNoise(sample_) * DUST_CURL_AMPLITUDE * uMotion;
  } else {
    float radial = length(p.xy);
    float angle = drift.w + shearAngle(shear, radial, uTime) * uMotion;
    float c = cos(angle);
    float s = sin(angle);
    p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }

  p = quatRotate(tilt, p) * home.w;
  p += home.xyz + driftOffset(drift, uTime) * uMotion;
  return rotateY(p, uMultiverseAngle);
}

/** Where a plane's centre is: {@link starWorldPosition} with the local position dropped. */
vec3 planeWorldPosition(int row) {
  vec4 home = planeTexel(row, PT_HOME_TEXEL);
  vec4 drift = planeTexel(row, PT_DRIFT_TEXEL);
  return rotateY(home.xyz + driftOffset(drift, uTime) * uMotion, uMultiverseAngle);
}
`

// The star, star-pick and plane-glow programs (full and cheap) that used to follow retired with the
// star field at the cutover (worlds spec §3.2's "the star shaders", DEC-752). What is left here is
// the shared motion preamble, which `cards/cardShaders.ts` still compiles against.
