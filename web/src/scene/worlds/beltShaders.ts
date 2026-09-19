/**
 * The belt's GLSL (spec §1.2 step 3, §1.8). `belt.ts` is the three.js binding.
 *
 * Two lines of shader, and both of them are the trap §1.13 lists as number 3.
 */

import { glslFloat } from '../glsl'

/**
 * §1.8's constant point size, in **CSS** pixels.
 *
 * > **Normative — `sizeAttenuation: false`, size 2 px (§1.8).** *"The belt sits at 1.12 R and
 * > Dominaria's `home` is 108.8 units out, so a fly-in puts belt points a few units from the eye.
 * > With attenuation on they become ~70 px squares, which looks exactly like 'the cells are drawn in
 * > the wrong place' and sent the prototype hunting the wrong bug for an afternoon. Constant 2 px is
 * > also what review §4.3 asks of stars generally: small and sharp, never bokeh."*
 *
 * **`gl_PointSize` is in device pixels, and this constant is not.** Every threshold in this spec is
 * CSS — §1.5's 4/8 px crossover band, §1.6's 24 px art threshold, §1.11's 24 px pick floor — and so
 * is this one, so `belt.ts` multiplies by the device pixel ratio on its way into `uSizePx`. Writing
 * `gl_PointSize = 2.0` instead is correct at dpr 1, which is exactly where §3.1's gate runs, and
 * draws a **half-size** belt on every retina display the owner will ever judge it on. The same
 * CSS-versus-device distinction `attachWorlds` makes for `getSize` against `getDrawingBufferSize`.
 */
export const BELT_POINT_SIZE_PX = 2

/**
 * The vertex shader.
 *
 * `gl_PointSize` is written unconditionally and `mvPosition.z` never enters it — that *is*
 * `sizeAttenuation: false`, spelled so that there is no flag anyone can flip. three's own
 * `PointsMaterial` expresses the same thing as a `#ifdef USE_SIZEATTENUATION` around a division, and
 * a default that has to stay off is a default that comes back on.
 */
export const BELT_VERTEX_SHADER = /* glsl */ `
attribute vec3 aColour;

uniform float uSizePx;

varying vec3 vColour;

void main() {
  vColour = aColour;
  gl_PointSize = uSizePx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The fragment shader: the year ramp, and a round point rather than a square one.
 *
 * At 2 px a disc and a square differ by the corner pixels alone, which is the whole difference
 * between "small and sharp" and a field of tiny tiles. `POINT_RADIUS` is the cut in `gl_PointCoord`
 * space; discarding outside it keeps the pass opaque (§1.2 puts step 3 among the depth-tested ones),
 * where an alpha falloff would need blending and would then need sorting against the worlds.
 */
export const BELT_FRAGMENT_SHADER = /* glsl */ `
#define POINT_RADIUS ${glslFloat(0.5)}

varying vec3 vColour;

void main() {
  vec2 offset = gl_PointCoord - vec2(0.5);
  if (dot(offset, offset) > POINT_RADIUS * POINT_RADIUS) discard;
  gl_FragColor = vec4(vColour, 1.0);
}
`
