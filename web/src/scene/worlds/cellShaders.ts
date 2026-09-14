/**
 * The cell sheet's GLSL (spec §1.4) — the GPU half of the surface law.
 *
 * Read `./surfaceLaw` and `./cellGeometry` first. Between them they hold the CPU mirror of
 * everything below: `cellSizeArc` produces the `iSize` this shader consumes, `buildCellVertices`
 * produces the `(u, v)` grid it maps onto the sphere, and `buildCellIndices` winds it. Every
 * constant arrives here as a `#define` written from the TypeScript constant, so there is no second
 * copy to forget — the discipline `starfield/shaders.ts` set and `cards/cardShaders.ts` follows.
 *
 * three.js compiles a `ShaderMaterial` as `#version 300 es` and defines `attribute`/`varying` for
 * backwards compatibility, so the classic keywords below still get GLSL ES 3.0 semantics — which is
 * what makes `sampler2DArray` and the two-argument `texture()` available at all.
 */

import { SHADE_AMBIENT, SHADE_GAIN } from './probePayload'
import { CELL_INSET, CELL_LIFT } from './surfaceLaw'
import { glslFloat } from '../starfield/shaders'
import { FILTER_DIM } from '../tuning'

/**
 * The floor under `sin(theta)` before it is divided into `iSize.x`.
 *
 * Pure `NaN` insurance, never reached in shipped data: a row centre sits at
 * `theta_r = (r + 1/2)·dphi`, so the smallest colatitude on the roster is `dphi/2 > 0` and the
 * smallest `sin(theta)` over v3's 45 worlds is Dominaria's `0.0224` — six orders of magnitude clear
 * of this. It exists because a truncated decode can produce a pole normal, and an unguarded divide
 * there deletes a whole world's sheet silently rather than drawing it wrong.
 */
export const SIN_THETA_FLOOR = 1e-6

const DEFINES = [
  ['CELL_LIFT', CELL_LIFT],
  ['CELL_INSET', CELL_INSET],
  ['SHADE_AMBIENT', SHADE_AMBIENT],
  ['SHADE_GAIN', SHADE_GAIN],
  ['SIN_THETA_FLOOR', SIN_THETA_FLOOR],
  // PRD 5.8's dimming, shared with the star field's shader rather than restated: one constant, so
  // a filtered star and a filtered cell dim by the same amount on the same page (spec 1.11).
  ['FILTER_DIM', FILTER_DIM],
] as const

/** The shared `#define` block, written from the TypeScript constants above. */
export const CELL_DEFINE_BLOCK = DEFINES.map(
  ([name, value]) => `#define ${name} ${glslFloat(value)}`,
).join('\n')

/**
 * The vertex shader: it places a parameter-space `(u, v)` **on the sphere**, never on a tangent
 * plane.
 *
 * > **Normative — the frame is derived from the centre, not carried alongside it (§1.4, DEC-749).**
 * > §1.4's attribute list was written for the flat-quad era, where a quad needed an explicit
 * > tangent basis to orient it. The sphere-following grid does not: the cell's centre normal
 * > already carries its colatitude (`acos(n.y)`) and its longitude (`atan2(n.x, n.z)`), and the
 * > vertex is placed by re-walking the *same* parameterisation that placed the centre. So `iEast` is
 * > gone — see `cellSheet.ts` for the byte budget that drops out of it — and the handedness it used
 * > to carry is pinned on `eastOf` instead, which is where `lod.ts` needs it anyway.
 *
 * > **Normative — `iSize` is arc length and this parameterisation wants angle (§2.1, D2).** The
 * > longitudinal attribute is `angle · sin(theta_r)`, because a row is a small circle of radius
 * > `sin(theta)` rather than a great circle. Dividing it back out is not a tidy-up: keeping the arc
 * > length here would draw Dominaria's polar row **51.6× too narrow**, the exact mirror of §2.1's
 * > 51.6×-too-wide failure, and neither direction announces itself on a world near the equator
 * > where the factor is ~1. `sin(theta_r)` is recovered from the normal itself — `length(n.xz)` —
 * > so the two can never disagree about which row this is.
 */
export const CELL_VERTEX_SHADER = /* glsl */ `
${CELL_DEFINE_BLOCK}

// three declares "attribute vec3 position" for every non-raw ShaderMaterial. The cell sheet has no
// such attribute: its base geometry is a parameter grid, not a position grid. The declaration is
// unused, the compiler drops it, and nothing binds it -- but cellSheet.ts must therefore set
// boundingSphere by hand, because three's would be computed from an attribute that is not there.
attribute vec2 aCell;    // (u, v) in [-1, 1]^2 -- the cell's own parameter grid

attribute vec3 iNormal;  // unit-sphere centre, straight out of stars.bin
attribute vec2 iSize;    // arc-length half-extents, units of world radius (NOT angle)
attribute vec3 iSwatch;  // linear RGB
attribute float iLayer;  // art pool layer, or < 0 for none
attribute float iArt;    // cross-fade, 0 = swatch, 1 = art
attribute float iFiltered; // PRD 5.8 / spec 1.11: 1 = excluded by the filter

uniform float uRadius;

varying vec2 vUv;
varying vec3 vSwatch;
varying vec3 vNormal;
varying float vLayer;
varying float vArt;
varying float vFiltered;

void main() {
  vec3 n = normalize(iNormal);

  // Arc length back to angle -- see the header. Exact, because this is the same sin(theta_r) that
  // cellSizeArc multiplied in.
  float sinTheta = max(length(n.xz), SIN_THETA_FLOOR);
  float lonAngle = iSize.x / sinTheta;
  float latAngle = iSize.y;

  // The same parameterisation that placed the centre, inset by the same 0.93 so the tiling reads as
  // masonry with grout rather than as a skin. Insetting the ANGLE, not a tangent offset, is what
  // keeps every vertex on the sphere at every subdivision.
  float theta = acos(clamp(n.y, -1.0, 1.0)) + aCell.y * latAngle * CELL_INSET;
  float lambda = atan(n.x, n.z) + aCell.x * lonAngle * CELL_INSET;

  float sinT = sin(theta);
  vec3 p = vec3(sinT * sin(lambda), cos(theta), sinT * cos(lambda));

  vUv = aCell * 0.5 + 0.5;
  vSwatch = iSwatch;
  // The CENTRE normal, not the vertex's own: §1.4 shades a cell flat, and probePayload.shadeOf
  // reports that one value per cell as a normative field. A smooth per-vertex normal would make the
  // probe's shade an approximation of the picture instead of a statement about it, and W2's
  // iso-shade subset would stop being a subset of anything.
  vNormal = n;
  vLayer = iLayer;
  vArt = iArt;
  vFiltered = iFiltered;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p * (uRadius * CELL_LIFT), 1.0);
}
`

/**
 * The fragment shader: `colour = swatch · shade + ambient`, then `mix(colour, art, iArt)`.
 *
 * > **Normative — compliance is in this shader, not in a follow-up (§1.4).** The lambert term is a
 * > brightness shift, which Scryfall's terms forbid applying to card images, and review §4.4 flags
 * > the shipped planet shader for doing exactly that. So `shade` multiplies the **swatch only**, and
 * > a cell that has resolved to art is flat-lit on purpose. `mix` takes the *unshaded* art as its
 * > second argument for that reason and must not be "fixed" to look consistent with its neighbours.
 */
export const CELL_FRAGMENT_SHADER = /* glsl */ `
${CELL_DEFINE_BLOCK}

precision highp sampler2DArray;

varying vec2 vUv;
varying vec3 vSwatch;
varying vec3 vNormal;
varying float vLayer;
varying float vArt;
varying float vFiltered;

uniform sampler2DArray uArt;
uniform vec3 uLight;
uniform vec3 uAmbient;

void main() {
  // Wrapped lambert: the *0.5 + 0.5 maps the terminator to 0.25 rather than to 0, which is what
  // keeps a mosaic legible around the limb. A hard terminator across a tiled surface reads as a
  // bug, not as night. Squaring AFTER the clamp, not before, makes the falloff perceptual.
  float lambert = dot(normalize(vNormal), normalize(uLight));
  float shade = clamp(lambert * 0.5 + 0.5, 0.0, 1.0);
  shade = SHADE_AMBIENT + SHADE_GAIN * shade * shade;

  vec3 colour = vSwatch * shade + uAmbient;

  // PRD 5.8 / spec 1.11: a filtered cell drops to its swatch and dims. The dim multiplies the
  // SWATCH term and is applied BEFORE the art mix, which is what makes "never dims its art"
  // structural rather than a convention -- at vArt = 1 the mix below returns the art unchanged
  // however dim this is. Dimming a card image is a colour shift, which Scryfall's terms forbid
  // (docs/scryfall-policy.md 5). The renderer also never admits a filtered cell to the art pool,
  // so the two paths agree: a filtered cell has no art to dim in the first place.
  colour *= mix(1.0, FILTER_DIM, clamp(vFiltered, 0.0, 1.0));

  if (vArt > 0.0 && vLayer >= 0.0) {
    // V is flipped here, not on upload: a DataArrayTexture ignores UNPACK_FLIP_Y_WEBGL, so the only
    // place the art's row order can be corrected is the sampler.
    vec3 art = texture(uArt, vec3(vUv.x, 1.0 - vUv.y, vLayer)).rgb;
    // Art enters at full value, unshaded -- see the header. This is a compliance boundary.
    colour = mix(colour, art, vArt);
  }

  gl_FragColor = vec4(colour, 1.0);
}
`
