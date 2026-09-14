/**
 * The tether's GLSL (spec §1.2 step 5, §1.9). `tether.ts` is the three.js binding.
 *
 * The ribbon's width is built on the CPU — it needs the camera's position per sample and the
 * viewport's CSS height, and the strip's two vertices have to be *offset in opposite directions*
 * from one curve point, which is a topology a vertex shader cannot invent. So the vertex shader here
 * is a pass-through and the interesting half is `tether.ts`.
 */

import { glslFloat } from '../starfield/shaders'

/** How much of each end fades out, as a fraction of the curve. */
const END_FADE = 0.012

/** The travelling pulse along the ribbon: spatial frequency and speed. */
const FLOW_WAVES = 26.0
const FLOW_SPEED = 2.2

const DEFINES = [
  ['END_FADE', END_FADE],
  ['FLOW_WAVES', FLOW_WAVES],
  ['FLOW_SPEED', FLOW_SPEED],
] as const

export const TETHER_DEFINE_BLOCK = DEFINES.map(
  ([name, value]) => `#define ${name} ${glslFloat(value)}`,
).join('\n')

export const TETHER_VERTEX_SHADER = /* glsl */ `
attribute float aAlong;

varying float vAlong;

void main() {
  vAlong = aAlong;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The ribbon's fragment shader.
 *
 * **The end fade is 1.2%, not the 6% that reads as the obvious choice.** The anchors are at
 * `aAlong = 0` and `1`, and §1.9's whole claim is that the tether is *footed* there — a 6% fade
 * swallows the flare and both anchor pads, and the tether goes back to being a line that stops near
 * the ground. What the fade is for is only to stop the strip ending on a hard edge; 1.2% of 144
 * samples is under two of them.
 */
export const TETHER_FRAGMENT_SHADER = /* glsl */ `
${TETHER_DEFINE_BLOCK}

varying float vAlong;

uniform vec3 uColour;
uniform float uTime;

void main() {
  float ends = smoothstep(0.0, END_FADE, vAlong) * smoothstep(1.0, 1.0 - END_FADE, vAlong);
  float flow = 0.55 + 0.45 * sin((vAlong * FLOW_WAVES) - uTime * FLOW_SPEED);
  gl_FragColor = vec4(uColour * (0.45 + 0.7 * flow) * ends, ends * (0.4 + 0.4 * flow));
}
`

export const TETHER_PAD_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The anchor pad: a glowing ring with a soft core, on the ground where the tether meets it.
 *
 * A ring rather than a disc. A filled pad over a surface of card art reads as a sticker laid on top
 * of the photograph — which is the exact failure §1.9 says the pads exist to prevent — where a ring
 * lets the art show through its middle and reads as something the tether is standing in.
 */
export const TETHER_PAD_FRAGMENT_SHADER = /* glsl */ `
#define RING_OUTER ${glslFloat(1.0)}
#define RING_INNER ${glslFloat(0.72)}
#define RING_RISE_LO ${glslFloat(0.28)}
#define RING_RISE_HI ${glslFloat(0.55)}
#define CORE_RADIUS ${glslFloat(0.34)}

varying vec2 vUv;

uniform vec3 uColour;

void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(RING_OUTER, RING_INNER, r) * smoothstep(RING_RISE_LO, RING_RISE_HI, r);
  float core = smoothstep(CORE_RADIUS, 0.0, r);
  gl_FragColor = vec4(uColour * (ring * 0.85 + core * 0.55), ring * 0.7 + core * 0.35);
}
`
