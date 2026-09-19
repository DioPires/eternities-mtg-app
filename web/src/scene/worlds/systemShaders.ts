/**
 * The system pass's GLSL (spec §1.2 step 2, §1.8) — undetailed worlds and dark moons in one program.
 *
 * The GLSL lives beside its constants for the same reason `cellShaders.ts` does: every number the
 * shader branches on is written from the TypeScript below it, so a tuning change cannot land on one
 * side only. `systemMesh.ts` is the three.js binding.
 *
 * **One program, two subjects.** A world samples its baked equirect layer (§1.5) and mixes toward
 * §1.8's stretched palette tint as it shrinks; a moon carries `iLayer = -1`, takes a flat near-black
 * and is **unlit**. Splitting them into two materials would double the program count to express a
 * branch that costs one compare on a draw of 87 dots — and would put the two on different code
 * paths for the lighting they are supposed to differ in.
 */

import { SHADE_AMBIENT, SHADE_GAIN } from './probePayload'
import { glslFloat } from '../glsl'

/**
 * §1.8: undetailed worlds are dimmed so a neighbour does not outshine the world being looked at.
 *
 * > *"Undetailed worlds are additionally dimmed to 0.3 so a neighbour does not outshine the world
 * > being looked at."* They carry no cells, so at full value a blank ball beside a mosaic is the
 * > brightest thing in frame — a framing accident, not a property of the concept.
 *
 * Applied to the **world** branch only. A moon's colour below is already its final value: dimming
 * it again would put §1.8's two subjects on one multiplier, and the next change to this constant
 * would silently move the moons too.
 */
export const UNDETAILED_DIM = 0.3

/**
 * §1.8's dark moons: *"a near-black colour (0.035, 0.038, 0.05) with no palette tint"*.
 *
 * Linear RGB, the same working space `iSwatch` and {@link import('./paletteTint').paletteTint} are
 * in. Not black: a moon at `(0,0,0)` is a hole in the backdrop rather than an object, and §1.8's
 * claim is that they are *"present, unlit, and unlabelled until hover"* — present being the first
 * word of it.
 */
export const MOON_COLOUR: readonly [number, number, number] = [0.035, 0.038, 0.05]

/** `iLayer` for a plane with no equirect layer — §1.2 step 2's own spelling for "this is a moon". */
export const MOON_LAYER = -1

const DEFINES = [
  ['SHADE_AMBIENT', SHADE_AMBIENT],
  ['SHADE_GAIN', SHADE_GAIN],
  ['UNDETAILED_DIM', UNDETAILED_DIM],
  // GLSL has no PI. Written at float precision from the same source as the TypeScript inverse in
  // `equirectUv`, so the shader and its CPU twin cannot round differently.
  ['PI', Math.PI],
  ['TAU', Math.PI * 2],
] as const

export const SYSTEM_DEFINE_BLOCK = DEFINES.map(
  ([name, value]) => `#define ${name} ${glslFloat(value)}`,
).join('\n')

/**
 * The vertex shader.
 *
 * **Two normals, and they are not interchangeable.** `vLocal` is the icosphere's own object-space
 * normal, which is the direction the equirect layer is indexed by — the layer is baked in the
 * world's *own* frame, so a world that has spun must be sampled before its rotation, not after.
 * `vNormal` is the same direction taken through `instanceMatrix` into world space, which is what
 * §1.7's key light is in. Sampling with the world-space normal instead is the failure mode that
 * looks right on a still frame and makes the mosaic slide over the globe as it turns.
 *
 * `instanceMatrix` is three's own attribute — it declares one for any material on an `InstancedMesh`
 * — and the instance scale is uniform (a world is a sphere), so the rotation survives the transform
 * without an inverse-transpose and a `normalize` is enough.
 */
export const SYSTEM_VERTEX_SHADER = /* glsl */ `
${SYSTEM_DEFINE_BLOCK}

attribute float iLayer;    // equirect layer, or MOON_LAYER for a dark moon
attribute vec3 iTint;      // §1.8's stretched palette deviation, or the flat moon colour
attribute float iTintMix;  // §1.5's tintMix(worldRadiusPx) -- R1 owns this factor

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vTint;
varying float vLayer;
varying float vTintMix;

void main() {
  vLocal = normalize(normal);
  vNormal = normalize((instanceMatrix * vec4(normal, 0.0)).xyz);
  vTint = iTint;
  vLayer = iLayer;
  vTintMix = iTintMix;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`

/**
 * The fragment shader.
 *
 * > **Normative — the equirect's `u` runs with `atan(n.x, n.z)` (§1.5, DEC-749).** `bakeEquirectLayer`
 * > writes texel `u` at longitude `((u + 0.5)/W)·2π − π` with longitude read as `atan2(x, z)`, so the
 * > inverse is `(lon + π)/2π`. The other spelling — `atan(n.z, n.x)` — mirrors the world east-west
 * > against its own cell sheet, and inside §1.5's crossover band both representations draw at once,
 * > so it reads as a smear rather than as an obvious flip.
 *
 * `v` is colatitude over `π`, north pole at `v = 0`, matching the bake's own row order — and
 * therefore **not** flipped here. §1.6's `UNPACK_FLIP_Y_WEBGL` note is about the art pool, which is a
 * different texture written a different way; applying that flip to this one stands every world on
 * its head with its colours still plausibly banded.
 *
 * The shade term is `shadeOf`'s, character for character with `cellShaders.ts`, so a world does not
 * change brightness as it crosses §1.5's band. A moon skips it entirely: §1.8 says *unlit*, and a
 * lambert on a near-black sphere is the difference between "an object you have to go and look for"
 * and "a dim glow the app is then obliged to label".
 */
export const SYSTEM_FRAGMENT_SHADER = /* glsl */ `
${SYSTEM_DEFINE_BLOCK}

precision highp sampler2DArray;

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vTint;
varying float vLayer;
varying float vTintMix;

uniform sampler2DArray uEquirect;
uniform vec3 uLight;

void main() {
  if (vLayer < 0.0) {
    // §1.8's dark moon: flat, unlit, no palette tint. Emptiness is a colour, not a size.
    gl_FragColor = vec4(vTint, 1.0);
    return;
  }

  vec3 n = normalize(vLocal);
  float lon = atan(n.x, n.z);
  float theta = acos(clamp(n.y, -1.0, 1.0));
  vec2 uv = vec2((lon + PI) / TAU, theta / PI);

  vec3 sampled = texture(uEquirect, vec3(uv, vLayer)).rgb;
  // §1.5: below 6 px of on-screen radius the layer converges on its own mean -- and a mean over a
  // balanced colour pie is the same grey for every plane -- so the world mixes toward §1.8's
  // stretched deviation from the multiverse mean. R1 owns the factor, §1.8 owns the colour.
  vec3 base = mix(sampled, vTint, clamp(vTintMix, 0.0, 1.0));

  float lambert = dot(normalize(vNormal), normalize(uLight));
  float shade = clamp(lambert * 0.5 + 0.5, 0.0, 1.0);
  shade = SHADE_AMBIENT + SHADE_GAIN * shade * shade;

  gl_FragColor = vec4(base * shade * UNDETAILED_DIM, 1.0);
}
`
