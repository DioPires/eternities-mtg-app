/**
 * The atmosphere rim's GLSL (spec §1.7, §1.12). `atmosphere.ts` is the three.js binding.
 */

import { glslFloat } from '../glsl'

/** §1.7: *"an additive `BackSide` sphere at **1.055× radius**"*. */
export const RIM_RADIUS_SCALE = 1.055

/** §1.7's fresnel exponent: `pow(1 - |n·v|, 2.6)`. */
export const RIM_FRESNEL_EXPONENT = 2.6

/**
 * The rim's overall strength, and the wrapped-lambert floor that keeps the night limb from vanishing.
 *
 * The night side keeps a fraction of the rim rather than going to zero: §1.7's shell is what
 * replaces full-scene bloom, and a world whose unlit limb has no rim at all loses its silhouette
 * against the backdrop entirely — which is the failure §1.8's moons are *supposed* to have and
 * worlds are not.
 */
const RIM_STRENGTH = 0.9
const RIM_NIGHT_FLOOR = 0.55
const RIM_LIGHT_GAIN = 0.6

/**
 * The second lobe of the full-quality rim — a tight bright core inside the wide halo.
 *
 * §1.12's tier 4 is *"cheap rim (**one tap**, no dither)"*, which reads the full rim as more than
 * one. This is the other one: a second, much sharper fresnel that puts a thin bright line exactly on
 * the limb, where the wide lobe alone is a soft wash. Dropping it is what "one tap" costs, and it is
 * the cheapest half to lose because the wide lobe carries the colour and the core carries the edge.
 *
 * **This reading of "one tap" is R2's, not the spec's** — §1.12 names the rung and not its two
 * halves. Flagged on DEC-750's hand-back rather than left as a silent interpretation.
 */
const RIM_CORE_EXPONENT = 9.0
const RIM_CORE_GAIN = 0.45

/**
 * The dither amplitude, in eighth-bit units of the output.
 *
 * §1.12's tier 4 is *"one tap, **no dither**"*. The rim is a smooth ramp over hundreds of pixels
 * into an 8-bit additive target, which is the textbook banding case: without a dither the falloff
 * lands as four or five visible contour rings around every world, and against a starfield those
 * read as an artefact of the *backdrop*, not of the shell. A screen-space ordered hash below 1 LSB
 * breaks them up and costs two instructions.
 */
const RIM_DITHER = 1.0 / 255.0

const DEFINES = [
  ['RIM_FRESNEL_EXPONENT', RIM_FRESNEL_EXPONENT],
  ['RIM_STRENGTH', RIM_STRENGTH],
  ['RIM_NIGHT_FLOOR', RIM_NIGHT_FLOOR],
  ['RIM_LIGHT_GAIN', RIM_LIGHT_GAIN],
  ['RIM_CORE_EXPONENT', RIM_CORE_EXPONENT],
  ['RIM_CORE_GAIN', RIM_CORE_GAIN],
  ['RIM_DITHER', RIM_DITHER],
] as const

export const ATMOSPHERE_DEFINE_BLOCK = DEFINES.map(
  ([name, value]) => `#define ${name} ${glslFloat(value)}`,
).join('\n')

/**
 * The vertex shader.
 *
 * The shell's scale is uniform, so the object-space normal survives `instanceMatrix` with a
 * `normalize` and no inverse-transpose. The view vector is built from the **world** position rather
 * than from `cameraPosition` minus the object's centre: a shell is 1.055 radii across and at the
 * surface view the camera is 2.2 radii out, so a per-object view direction would hold `|n·v|`
 * constant over the whole shell and draw a uniform wash instead of a limb.
 */
export const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
${ATMOSPHERE_DEFINE_BLOCK}

attribute vec3 iTint;

varying vec3 vNormal;
varying vec3 vView;
varying vec3 vTint;

void main() {
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vNormal = normalize((instanceMatrix * vec4(normal, 0.0)).xyz);
  vView = normalize(cameraPosition - world.xyz);
  vTint = iTint;
  gl_Position = projectionMatrix * modelViewMatrix * world;
}
`

/**
 * The fragment shader: `pow(1 - |n·v|, 2.6)`, tinted, lit, additive.
 *
 * > **`abs(dot(n, v))`, not `clamp(dot(n, v), 0, 1)` — and the difference is the whole shell.** This
 * > is a `BackSide` draw, so every fragment that survives the cull has its geometric normal pointing
 * > *away* from the eye and `dot(n, v)` is negative over the entire shell. Clamped, that is zero
 * > everywhere, `1 - 0` is one, and `pow(1, 2.6)` is one: the rim becomes a **solid tinted ball**
 * > drawn additively over the world. It does not read as a wrong falloff — it reads as a world that
 * > has been washed out by bloom, which is exactly the thing §1.1 deleted the post chain to stop.
 * > §1.7 writes the absolute value for this reason and this shader keeps it.
 *
 * > **Normative — `rgb` here is a *premultiplied* colour, and `atmosphere.ts` sets
 * > `premultipliedAlpha: true` to match (DEC-773 F1).** The shipped blend is then
 * > `blendFunc(ONE, ONE)` and the `colour` below is added to the frame verbatim, so §1.7's falloff
 * > is applied exactly **once**. Under three's default `premultipliedAlpha: false` the same
 * > `AdditiveBlending` is `blendFunc(SRC_ALPHA, ONE)`, which multiplies `colour` by `alpha` a second
 * > time — and because both channels carry `intensity * lit`, the 2.6 exponent composites as 5.2 and
 * > the night floor as `0.55² = 0.3025`. Nothing about the picture says which of the two is running;
 * > it reads as a thin hard ring at the silhouette rather than as a wrong exponent.
 * >
 * > So the two writes below are the premultiplied pair — `colour` is `alpha · (vTint ·
 * > RIM_STRENGTH)` — and the dither goes into **both**, which keeps that relation true and puts the
 * > de-banding noise in the channel that is actually composited.
 */
export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
${ATMOSPHERE_DEFINE_BLOCK}

varying vec3 vNormal;
varying vec3 vView;
varying vec3 vTint;

uniform vec3 uLight;

void main() {
  vec3 n = normalize(vNormal);
  float facing = abs(dot(n, normalize(vView)));
  float rim = pow(1.0 - facing, RIM_FRESNEL_EXPONENT);

  // The shell's normals point outward in object space and this is a BackSide draw, so -n is the
  // direction from the far surface toward the eye's side of the world; the key light dotted against
  // it is what makes the lit limb brighter than the night one without either going out.
  float lit = clamp(dot(-n, normalize(uLight)) * RIM_LIGHT_GAIN + RIM_NIGHT_FLOOR, 0.0, 1.0);

  float intensity = rim;
#ifndef CHEAP_RIM
  intensity += pow(1.0 - facing, RIM_CORE_EXPONENT) * RIM_CORE_GAIN;
#endif

  vec3 colour = vTint * intensity * lit * RIM_STRENGTH;
  float alpha = intensity * lit;

#ifndef CHEAP_RIM
  // Ordered screen-space hash under one LSB. Breaks the contour rings an 8-bit additive ramp
  // otherwise shows; at this amplitude it is invisible as noise and only visible as their absence.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  colour += dither * RIM_DITHER;
  alpha += dither * RIM_DITHER;
#endif

  gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
}
`
