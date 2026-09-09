/**
 * The owned post chain's GLSL (DEC-703, review §3.5 and findings R3/R4).
 *
 * Three fullscreen programs — downsample, upsample, composite — plus one chunk that the *object*
 * shaders include when they draw themselves a second time into the bloom source. That second draw
 * is what makes the bloom selective for free: cards, thumbnails and planets never enable the bloom
 * layer, so there is no mask pass and no depth pass to be inert (R4), and the source is sized by
 * the ladder rather than by the drawing buffer, so rung 2 moves the pixels the frame pays for (R3).
 *
 * **Every number here comes from `../tuning`.** The look is meant to be unchanged from the shipped
 * picture, so each program below reproduces what `postprocessing` computes today, chunk for chunk:
 *
 *  - the threshold is `postprocessing`'s `LuminanceMaterial` in `COLOR` mode
 *    (`build/index.js:2767`): `l = smoothstep(threshold, threshold + smoothing, l) * l`, then
 *    `rgb * clamp(l, 0, 1)`. Note that it scales by the *mask times the luminance*, not by the mask
 *    alone — a detail worth keeping, because it is a third of the bloom's contrast;
 *  - the downsample is its `DownsamplingMaterial` (`:3086`), a 13-tap with the same
 *    0.125 / 0.0555555 weights and the same border clamp;
 *  - the upsample is its `UpsamplingMaterial` (`:3134`), a 9-tap tent mixed into the level below by
 *    `radius`;
 *  - the composite is `BloomEffect`'s `intensity` multiply (`:3637`) under the `SCREEN` blend
 *    (`:2215`, `x + y - min(x * y, 1)`), then `VignetteEffect`'s default technique (`:12635`).
 *
 * Written with GLSL ES 1.00 keywords because three compiles a `ShaderMaterial` as `#version 300 es`
 * and defines the compatibility aliases — the same arrangement `../starfield/shaders` documents at
 * its head, and the reason `texture2D` and `gl_FragColor` below get ES 3.0 semantics.
 *
 * No backticks inside the template literals below: one would end the literal (DEC-648).
 */

import {
  BLOOM_INTENSITY,
  BLOOM_SMOOTHING,
  BLOOM_THRESHOLD,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET,
} from '../tuning'

/** GLSL float literals: `1` is an int in GLSL and would fail to compile where a float is wanted. */
function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}

/**
 * PRD 5.3.20's luminance threshold, for the object shaders that draw the bloom source.
 *
 * Included by the star and glow fragment shaders under `BLOOM_PASS`, which is what puts the
 * threshold where PRD 8.5.5's "selective" actually is: a star dimmed to `FILTER_DIM` by a filter
 * (PRD 5.8.1) has already been multiplied by that `dim` term when it reaches here, so it falls
 * under the threshold and drops out of the bloom with no per-object bookkeeping — exactly the
 * reading `Effects.tsx` documented and the old chain then failed to implement.
 *
 * three's `<common>` defines `luminance()` with the same coefficients, but a `ShaderMaterial` only
 * gets that chunk if it asks for it, and these shaders do not otherwise want `<common>`.
 */
export const BLOOM_MASK_GLSL = /* glsl */ `
#define BLOOM_THRESHOLD ${glslFloat(BLOOM_THRESHOLD)}
#define BLOOM_SMOOTHING ${glslFloat(BLOOM_SMOOTHING)}

vec3 bloomMask(vec3 colour) {
  float l = dot(colour, vec3(0.2126729, 0.7151522, 0.0721750));
  l = smoothstep(BLOOM_THRESHOLD, BLOOM_THRESHOLD + BLOOM_SMOOTHING, l) * l;
  return colour * clamp(l, 0.0, 1.0);
}
`

/**
 * One fullscreen triangle, in clip space, for all three programs.
 *
 * A triangle rather than a quad: two fewer vertices, one primitive instead of two, and no index
 * buffer. The vertices sit at (-1,-1), (3,-1) and (-1,3), so the triangle covers the whole of clip
 * space and the rasteriser discards the rest; `vUv` runs past 1 out there and is never sampled.
 *
 * `position` is declared by three, not here — see the file header.
 */
export const POST_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

/**
 * The 13-tap downsample of `postprocessing`'s `DownsamplingMaterial`, tap for tap and weight for
 * weight.
 *
 * The taps are computed here rather than in the vertex shader. The original passes twelve of them
 * across as varyings, which is twelve interpolators for a program whose whole job is bandwidth;
 * review §2.2 measured this chain as 65–70% of the frame's *bytes* and recorded that "ALU is not
 * the limit", so the arithmetic is free and the varyings are not.
 *
 * `uTexelSize` is the texel size of the **input**, which is what makes the four inner taps land on
 * the corners of the source's 2x2 footprint.
 */
export const POST_DOWNSAMPLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

#define WEIGHT_INNER 0.125
#define WEIGHT_OUTER 0.0555555

uniform sampler2D uInput;
uniform vec2 uTexelSize;

varying vec2 vUv;

// Zero outside the source, so the outer ring of taps cannot smear the edge texel inwards. The
// original spells this out as a clampToBorder helper and folds it into the weight; folding it into
// the sample is the same arithmetic with one multiply fewer.
vec3 tap(vec2 offset) {
  vec2 uv = vUv + uTexelSize * offset;
  float inside = float(uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0);
  return texture2D(uInput, uv).rgb * inside;
}

void main() {
  vec3 c = vec3(0.0);

  // The inner 2x2, at half a source texel: the box that actually carries the signal.
  c += WEIGHT_INNER * tap(vec2(-1.0, 1.0));
  c += WEIGHT_INNER * tap(vec2(1.0, 1.0));
  c += WEIGHT_INNER * tap(vec2(-1.0, -1.0));
  c += WEIGHT_INNER * tap(vec2(1.0, -1.0));

  // The outer ring plus the centre — nine taps at 0.0555555, which with the four above sums to 1.
  c += WEIGHT_OUTER * tap(vec2(-2.0, 2.0));
  c += WEIGHT_OUTER * tap(vec2(0.0, 2.0));
  c += WEIGHT_OUTER * tap(vec2(2.0, 2.0));
  c += WEIGHT_OUTER * tap(vec2(-2.0, 0.0));
  c += WEIGHT_OUTER * tap(vec2(2.0, 0.0));
  c += WEIGHT_OUTER * tap(vec2(-2.0, -2.0));
  c += WEIGHT_OUTER * tap(vec2(0.0, -2.0));
  c += WEIGHT_OUTER * tap(vec2(2.0, -2.0));
  c += WEIGHT_OUTER * texture2D(uInput, vUv).rgb;

  gl_FragColor = vec4(c, 1.0);
}
`

/**
 * The 9-tap tent upsample of `postprocessing`'s `UpsamplingMaterial`.
 *
 * The original ends with `mix(baseColor, c, radius)`, sampling the level below as a second texture.
 * This one writes `c` with `radius` as its alpha and lets the blend equation do the mix — see
 * `postChain.ts` for the blend it is paired with. That is the same result with one texture fetch
 * fewer per fragment, and it means the chain never binds a target as both input and output.
 */
export const POST_UPSAMPLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D uInput;
uniform vec2 uTexelSize;
uniform float uRadius;

varying vec2 vUv;

vec3 tap(vec2 offset) {
  return texture2D(uInput, vUv + uTexelSize * offset).rgb;
}

void main() {
  vec3 c = vec3(0.0);
  c += tap(vec2(-1.0, 1.0)) * 0.0625;
  c += tap(vec2(0.0, 1.0)) * 0.125;
  c += tap(vec2(1.0, 1.0)) * 0.0625;
  c += tap(vec2(-1.0, 0.0)) * 0.125;
  c += texture2D(uInput, vUv).rgb * 0.25;
  c += tap(vec2(1.0, 0.0)) * 0.125;
  c += tap(vec2(-1.0, -1.0)) * 0.0625;
  c += tap(vec2(0.0, -1.0)) * 0.125;
  c += tap(vec2(1.0, -1.0)) * 0.0625;

  gl_FragColor = vec4(c, uRadius);
}
`

/**
 * Scene plus bloom, vignette, an optional filmic roll-off, and the output encode — one pass.
 *
 * PRD 5.3.21's vignette is `postprocessing`'s default technique, which reads
 * `smoothstep(0.8, offset * 0.799, d * (darkness + offset))`. That is `smoothstep` with
 * `edge0 > edge1`, which GLSL leaves *undefined* however reliably drivers happen to compute it —
 * the same trap `../starfield/shaders` calls out twice in its own falloffs. Written the defined way
 * round and inverted below, which is the identical curve: the cubic `3t² - 2t³` is symmetric about
 * `t = 0.5`, so `S(1 - u) = 1 - S(u)`, and the two forms differ only in which end of the ramp is
 * named first.
 *
 * The output encode is three's own `colorspace_fragment` chunk rather than a hand-written sRGB
 * transfer, so the composite follows `WebGLRenderer.outputColorSpace` instead of asserting it.
 */
export const POST_COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

#define BLOOM_INTENSITY ${glslFloat(BLOOM_INTENSITY)}
#define VIGNETTE_OFFSET ${glslFloat(VIGNETTE_OFFSET)}
#define VIGNETTE_DARKNESS ${glslFloat(VIGNETTE_DARKNESS)}

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uTonemapStrength;

varying vec2 vUv;

// Narkowicz's ACES fit. Review §3.5 wants hot cores to roll off instead of clipping to white;
// mixed by uTonemapStrength, which ships at 0 so the composite is an exact passthrough until
// someone has looked at a before/after pair. See postTuning.TONEMAP_STRENGTH.
vec3 rollOff(vec3 c) {
  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(uScene, vUv).rgb;
  vec3 bloom = texture2D(uBloom, vUv).rgb * BLOOM_INTENSITY;

  // Screen, exactly as the old chain blended the bloom effect over the scene.
  vec3 c = scene + bloom - min(scene * bloom, 1.0);

  c = mix(c, rollOff(c), uTonemapStrength);

  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - smoothstep(VIGNETTE_OFFSET * 0.799, 0.8, d * (VIGNETTE_DARKNESS + VIGNETTE_OFFSET));

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`
