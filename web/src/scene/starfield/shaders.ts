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

/** GLSL float literals: `1` is an int in GLSL and would fail to compile where a float is wanted. */
function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}

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

/**
 * PRD 8.5.1: every star is one vertex of one `Points` object. Attributes come straight from the
 * star record — `aClass` and `aStyle` are views into the interleaved `stars.bin` bytes, so the
 * only thing repacked on the way to the GPU is the position (see `./starGeometry`).
 *
 * `ID_PASS` compiles the same motion into the picking material of PRD 8.5.6, which is the point:
 * the id buffer is exact precisely because it is the same vertex program.
 */
export const STAR_VERTEX_SHADER = /* glsl */ `
${DEFINE_BLOCK}
${MOTION_GLSL}

attribute vec3 aClass;   // planeIndex, hueClass, sizeClass  (0-255)
attribute vec3 aStyle;   // brightness, twinklePhase, typeMask (0-255)
attribute float aFilter; // PRD 8.5.1's uint8 filter mask, normalised: 1 passes, 0 fails
/** PRD 5.5.3: 1 once this star's thumbnail is in the atlas. Until then the star never fades out. */
attribute float aThumb;

uniform vec3 uHues[7];
uniform float uRaritySize[4];
uniform float uStarDiameter;
/** drawingBufferHeight / (2 tan(fov/2)): world units to device pixels at one unit of depth. */
uniform float uSizeScale;
uniform float uMinPixels;
uniform float uMaxPixels;
/** PRD 5.4.12: the hovered star brightens by 30%. -1 when nothing is hovered. */
uniform float uHoverIndex;
/** PRD 5.5.1's cross-fade band, in device pixels — the same numbers the thumbnail layer uses. */
uniform float uThumbStartPx;
uniform float uThumbFullPx;

varying vec3 vColour;
varying float vPickable;
#ifdef ID_PASS
varying vec3 vIdColour;
#endif

void main() {
  int row = int(aClass.x + 0.5);
  vec3 world = starWorldPosition(row, position);
  vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vec4 fade = planeTexel(row, PT_FADE_TEXEL);
  float pass = aFilter;

  // PRD 5.8.3: a dimmed card does not respond to hover and is not focusable, and a plane that has
  // not faded in has nothing to click yet.
  vPickable = (pass > 0.5 && fade.x > 0.5) ? 1.0 : 0.0;

  float size = uStarDiameter * uRaritySize[int(aClass.z + 0.5)];
  float pixels = size * uSizeScale / max(-mvPosition.z, 0.0001);
#ifdef ID_PASS
  // A one-pixel star still has to be clickable (PRD 8.5.6 picks under the pointer, not on the nose).
  gl_PointSize = clamp(pixels, uMinPixels, uMaxPixels);
  float id = float(gl_VertexID + 1);
  vIdColour = vec3(
    mod(id, 256.0),
    mod(floor(id / 256.0), 256.0),
    mod(floor(id / 65536.0), 256.0)
  ) / 255.0;
  vColour = vec3(1.0);
#else
  gl_PointSize = clamp(pixels, uMinPixels, uMaxPixels);

  // PRD 5.4.10 brightness, 5.4.11 twinkle, 5.8.1 filter dimming, 6.8.1 fade-in, 5.3.4 dust focus.
  float brightness = aStyle.x / 255.0;
  float twinkle = 1.0 + TWINKLE_AMPLITUDE
    * sin(uTime * TWINKLE_RATE + (aStyle.y / 255.0) * 6.2831853) * uMotion;
  float dim = mix(FILTER_DIM, 1.0, pass);
  float focus = mix(1.0, DUST_FOCUS_GAIN, fade.y);
  float hover = (uHoverIndex >= 0.0 && abs(float(gl_VertexID) - uHoverIndex) < 0.5) ? HOVER_GAIN : 1.0;

  // PRD 5.5.1 and 5.5.4: the star cross-fades into its thumbnail as it grows past the band, and
  // back out again on the way away. Timed by the drawn size above, which is camera distance and
  // rarity, so the transition is never keyed to when an image arrived (PRD 7.3.4, 7.3.5).
  float crossFade = smoothstep(uThumbStartPx, uThumbFullPx, pixels) * aThumb;

  vColour = uHues[int(aClass.y + 0.5)]
    * (brightness * twinkle * dim * fade.x * focus * hover * (1.0 - crossFade));
#endif
}
`

export const STAR_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vColour;
varying float vPickable;
#ifdef ID_PASS
varying vec3 vIdColour;
#endif

void main() {
  // A soft round sprite. Squaring the falloff keeps a bright core with a wide, cheap halo, which
  // is what the bloom threshold of PRD 5.3.20 then picks up.
  float d = length(gl_PointCoord - 0.5) * 2.0;
#ifdef ID_PASS
  // The pick sprite is a square where the drawn sprite is a disc, deliberately.
  //
  // A round pick target is worse in both directions. At the production floor it throws away the
  // corners of a target PRD 8.5.6 inflated on purpose so a one-pixel star stays clickable. Below
  // about two pixels it is outright wrong: a point that small covers one or two fragments, whose
  // gl_PointCoord lands wherever the rasteriser puts it, so a d > 1.0 test can discard the only
  // fragment the star has and the star becomes unpickable. Measured on Metal: at a one-pixel
  // floor three dust stars vanished from the id buffer entirely, and removing this test brought
  // all three back. Nothing here is visible; the drawn pass keeps its disc below.
  if (vPickable < 0.5) discard;
  gl_FragColor = vec4(vIdColour, 1.0);
#else
  // Defined-argument-order smoothstep, then inverted: edge0 >= edge1 is undefined in GLSL.
  float alpha = 1.0 - smoothstep(0.0, 1.0, d);
  alpha *= alpha;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColour, alpha);
#endif
}
`

/**
 * PRD 5.3.19's nebula and PRD 5.3.6's zero-card glow, as one instanced quad per plane.
 *
 * One draw call for both, because they are the same object with different numbers: a plane with
 * cards gets a wide faint tinted cloud, a plane without gets a small dim ellipse that *is* the
 * plane. The quad billboards and is then squashed in the fragment shader along the screen
 * projection of the plane's own normal, which is where "elliptical" comes from — a tilted disc,
 * not an arbitrary stretch.
 */
export const GLOW_VERTEX_SHADER = /* glsl */ `
${DEFINE_BLOCK}
${MOTION_GLSL}

attribute float aPlaneRow;

varying vec2 vQuad;
varying vec3 vTint;
varying float vFade;
varying float vEmpty;
/** xy: screen direction of the plane normal, z: the ellipse's minor-axis fraction. */
varying vec3 vEllipse;

void main() {
  int row = int(aPlaneRow + 0.5);
  vec4 glow = planeTexel(row, PT_FADE_TEXEL);
  vec4 tilt = planeTexel(row, PT_TILT_TEXEL);
  vec4 tint = planeTexel(row, PT_TINT_TEXEL);

  vec3 centre = planeWorldPosition(row);
  vec4 mv = modelViewMatrix * vec4(centre, 1.0);
  vQuad = position.xy * 2.0;
  mv.xy += position.xy * (glow.z * 2.0);
  // A billboard whose centre is behind the eye projects inside out. Collapse it instead: the
  // plane is behind the camera, so there is nothing to draw.
  if (mv.z > 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  } else {
    gl_Position = projectionMatrix * mv;
  }

  // The disc's normal, taken through the same tilt and multiverse rotation the stars get, then
  // into view space. Its z component is the cosine that squashes the circle into an ellipse.
  vec3 normalWorld = rotateY(quatRotate(tilt, vec3(0.0, 0.0, 1.0)), uMultiverseAngle);
  vec3 normalView = normalize((modelViewMatrix * vec4(normalWorld, 0.0)).xyz);
  vec2 screen = normalView.xy;
  float len = length(screen);
  vEllipse = vec3(len > 0.001 ? screen / len : vec2(1.0, 0.0),
                  max(abs(normalView.z), GLOW_MIN_ASPECT));

  vTint = tint.rgb;
  vFade = glow.x;
  vEmpty = glow.w;
}
`

export const GLOW_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${HASH_GLSL}

uniform sampler2D uNoise;
uniform float uTime;
uniform float uNebulaOpacity;
uniform float uEmptyOpacity;
uniform float uEmptyCore;
uniform float uMotion;

varying vec2 vQuad;
varying vec3 vTint;
varying float vFade;
varying float vEmpty;
varying vec3 vEllipse;

void main() {
  if (vFade <= 0.001) discard;

  // Squash along the normal's screen projection: that is the ellipse of PRD 5.3.6.
  vec2 axis = vEllipse.xy;
  float along = dot(vQuad, axis) / vEllipse.z;
  float across = dot(vQuad, vec2(-axis.y, axis.x));
  float r = length(vec2(along, across));
  if (r > 1.0) discard;

  // smoothstep(1.0, 0.0, x) is undefined in GLSL when edge0 >= edge1, however reliably drivers
  // happen to compute it. Written the defined way round and inverted.
  float base = 1.0 - smoothstep(0.0, 1.0, r);
  // PRD 5.3.19: low-frequency noise, two taps at different scales, drifting slowly.
  vec2 uv = vQuad * 0.5 + 0.5;
  float drift = uTime * 0.004 * uMotion;
  float noise = texture2D(uNoise, uv * 1.3 + vec2(drift, drift * 0.6)).r * 0.62
              + texture2D(uNoise, uv * 3.1 - vec2(drift * 0.7, drift)).r * 0.38;

  // Cubed rather than squared: the nebula has to stay a halo around its plane, not a disc that
  // reaches the quad's edge and meets its neighbour's in a visible seam.
  float falloff = base * base * base;
  float cloud = falloff * mix(uNebulaOpacity, uEmptyOpacity, vEmpty) * (0.45 + 1.1 * noise);
  // The zero-card glow needs a core, or it reads as haze rather than as a plane.
  cloud += pow(base, 6.0) * uEmptyCore * vEmpty;

  // Dither. Eighty-three of these overlap additively at very low alpha, and an 8-bit output
  // quantises the result into visible contour rings around every plane. A sub-quantum of noise
  // keyed to the pixel breaks the rings up; it is invisible at this amplitude.
  float dither = (hash01(ivec3(gl_FragCoord.xy, 0)) - 0.5) * (1.0 / 320.0);
  float alpha = cloud * vFade + dither;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(vTint, alpha);
}
`
