/**
 * The card tier's GLSL: thumbnails (PRD 5.5), the focused card's faces (PRD 5.6.1-6) and the
 * printing planets (PRD 5.6.7-9).
 *
 * The thumbnail vertex program imports `MOTION_GLSL` from the star field rather than restating it.
 * That is the whole reason a thumbnail sits exactly on the star it replaces through a cross-fade
 * (PRD 5.5.1): both are the same function of the same plane table, evaluated on the same GPU in the
 * same frame. A second copy would drift, and the drift would be visible as a card sliding off its
 * star during the one moment the user is watching both.
 *
 * Every image these sample is stored sRGB-encoded and decoded here, because the scene is authored
 * in linear light and the composite encodes on output (`scene/post/postShaders`). See `./atlas`
 * for why the atlas holds sRGB bytes rather than linear ones.
 */

import { DEFINE_BLOCK, MOTION_GLSL } from '../starfield/shaders'
import {
  CARD_SHEEN_INTENSITY,
  CARD_SHEEN_WIDTH,
  PLANET_ACTIVE_GAIN,
  THUMBNAIL_RIM_GAIN,
  THUMBNAIL_RIM_WIDTH,
} from '../tuning'
import { glslFloat } from '../starfield/shaders'

/** The inverse of the sRGB transfer function, exactly — not a 2.2 power approximation. */
const SRGB_GLSL = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`

/**
 * PRD 5.5: one `InstancedMesh` of camera-facing quads, each placed by the star field's own motion
 * function and cross-faded against the star it stands in for.
 *
 * `ID_PASS` compiles the same program into the picking material, and it writes the *star's* id, not
 * an id of its own: clicking a thumbnail and clicking the star it grew out of are the same act
 * (PRD 5.6.1 says "clicking a star (or thumbnail)"), so they must resolve to the same focus.
 */
export const THUMBNAIL_VERTEX_SHADER = /* glsl */ `
${DEFINE_BLOCK}
${MOTION_GLSL}

attribute vec3 aLocal;   // the star's plane-local position, straight out of stars.bin
attribute float aRow;    // its plane row
attribute vec4 aCell;    // atlas cell: u, v, du, dv
attribute float aHue;    // PRD 5.4.8 hue class, for the rim glow of PRD 5.5.2
attribute float aSize;   // PRD 5.4.9 rarity size multiplier, so the fade band matches the star's
attribute float aStar;   // global star index, for the id pass
attribute float aFade;   // PRD 7.3.5's 200 ms image fade-in, 0 to 1

uniform vec3 uHues[7];
uniform float uStarDiameter;
uniform float uSizeScale;
uniform float uThumbStartPx;
uniform float uThumbFullPx;
uniform float uQuadHeight;
uniform float uQuadAspect;

varying vec2 vUv;
/** The quad's own 0-1 coordinates, so the fragment shader can find its border. */
varying vec2 vQuad;
varying vec3 vRim;
varying float vAlpha;
#ifdef ID_PASS
varying vec3 vIdColour;
#endif

void main() {
  vec3 world = starWorldPosition(int(aRow + 0.5), aLocal);
  vec4 centre = modelViewMatrix * vec4(world, 1.0);

  // A camera-facing quad: the offset is added in view space, so the billboard needs no basis of
  // its own and no per-instance matrix.
  float height = uQuadHeight;
  vec2 offset = vec2(position.x * height * uQuadAspect, position.y * height);
  vec4 mvPosition = centre;
  mvPosition.xy += offset;
  gl_Position = projectionMatrix * mvPosition;

  vQuad = position.xy + 0.5;
  vUv = aCell.xy + vQuad * aCell.zw;

  // The same drawn-size formula the star shader uses, on the star's own centre depth, so the two
  // halves of the cross-fade are complementary rather than merely similar (PRD 5.5.1, 7.3.4).
  float pixels = uStarDiameter * aSize * uSizeScale / max(-centre.z, 0.0001);
  float crossFade = smoothstep(uThumbStartPx, uThumbFullPx, pixels);

  vec4 fade = planeTexel(int(aRow + 0.5), PT_FADE_TEXEL);
  vAlpha = crossFade * aFade * fade.x;
  // Masked for the same reason the star shader masks (amendment A3): an unmasked byte 7 would
  // index uHues by up to 253 rather than by a hue class. aHue comes from the masked hueClassOf
  // today, so this is defence, not a fix -- but the two shaders read the same value and should
  // not differ on whether the read is safe by itself or safe by a mask two files away.
  vRim = uHues[int(aHue + 0.5) & 7];

#ifdef ID_PASS
  float id = aStar + 1.0;
  vIdColour = vec3(
    mod(id, 256.0),
    mod(floor(id / 256.0), 256.0),
    mod(floor(id / 65536.0), 256.0)
  ) / 255.0;
#endif
}
`

export const THUMBNAIL_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${SRGB_GLSL}

uniform sampler2D uAtlas;

varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vRim;
varying float vAlpha;
#ifdef ID_PASS
varying vec3 vIdColour;
#endif

#define RIM_WIDTH ${glslFloat(THUMBNAIL_RIM_WIDTH)}
#define RIM_GAIN ${glslFloat(THUMBNAIL_RIM_GAIN)}

void main() {
#ifdef ID_PASS
  // Only pickable once it is actually the thing on screen. Below half the cross-fade the star's own
  // sprite is what the pointer is over, and it writes the same id from the same pass.
  if (vAlpha < 0.5) discard;
  gl_FragColor = vec4(vIdColour, 1.0);
#else
  if (vAlpha < 0.004) discard;
  vec3 art = srgbToLinear(texture2D(uAtlas, vUv).rgb);

  // PRD 5.5.2: "thumbnails keep their hue as a rim glow, so encoding is not lost." Distance to the
  // nearer edge of the quad, on both axes, so the glow follows the card's whole border.
  vec2 fromEdge = min(vQuad, 1.0 - vQuad);
  float edge = min(fromEdge.x, fromEdge.y);
  float rim = 1.0 - smoothstep(0.0, RIM_WIDTH, edge);
  gl_FragColor = vec4(art + vRim * (rim * RIM_GAIN), vAlpha);
#endif
}
`

/**
 * PRD 5.6.1-4: the focused card's two faces.
 *
 * A face is a rounded-rectangle plane with the printing's image on it, a specular sheen that moves
 * with the pointer tilt, and — when the image has not arrived or never will (PRD 7.4.2) — the
 * card's own hue glow instead of a broken rectangle.
 */
export const CARD_FACE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vNormalView;

void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = mvPosition.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}
`

export const CARD_FACE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${SRGB_GLSL}

uniform sampler2D uImage;
/** 0 while there is no image: the face shows the card's hue glow instead (PRD 5.5.3, 7.4.2). */
uniform float uHasImage;
/** PRD 7.3.5's 200 ms fade-in, applied to the image over whatever was there before. */
uniform float uImageFade;
uniform vec3 uGlow;
uniform float uOpacity;
/** The sheen's travelling highlight, moved by the tilt spring (PRD 5.6.4). */
uniform float uSheenOffset;

varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vNormalView;

#define SHEEN_INTENSITY ${glslFloat(CARD_SHEEN_INTENSITY)}
#define SHEEN_WIDTH ${glslFloat(CARD_SHEEN_WIDTH)}

void main() {
  vec3 base = uGlow;
  if (uHasImage > 0.5) {
    vec3 art = srgbToLinear(texture2D(uImage, vUv).rgb);
    base = mix(uGlow, art, uImageFade);
  }

  // A band running diagonally across the face, positioned by the tilt. Not a foil rainbow: PRD
  // 5.6.4 asks for one moving specular highlight and explicitly rules the rainbow out for v1.
  float band = (vUv.x + vUv.y) * 0.5 - uSheenOffset;
  float sheen = exp(-(band * band) / (SHEEN_WIDTH * SHEEN_WIDTH));
  // Only where the face is turned towards the eye, so the sheen reads as a reflection.
  float facing = clamp(dot(normalize(vNormalView), normalize(-vViewPosition)), 0.0, 1.0);
  base += sheen * facing * SHEEN_INTENSITY;

  gl_FragColor = vec4(base, uOpacity);
}
`

/**
 * PRD 5.6.7-9: a printing, as a small sphere textured with that printing's art crop.
 *
 * Lit from the camera rather than from a scene light, because there is no scene light: the star
 * field is emissive and the multiverse has no sun. A hemispheric wrap keeps the terminator soft so
 * a planet reads as a sphere rather than as a disc with a hard edge.
 */
export const PLANET_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;

void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = mvPosition.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}
`

export const PLANET_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
${SRGB_GLSL}

uniform sampler2D uImage;
uniform float uHasImage;
uniform float uImageFade;
uniform vec3 uGlow;
/** PRD 5.6.9: the active printing's planet is marked. */
uniform float uActive;
uniform float uHover;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;

#define ACTIVE_GAIN ${glslFloat(PLANET_ACTIVE_GAIN)}

void main() {
  vec3 base = uGlow;
  if (uHasImage > 0.5) {
    base = mix(uGlow, srgbToLinear(texture2D(uImage, vUv).rgb), uImageFade);
  }

  vec3 normal = normalize(vNormalView);
  vec3 toEye = normalize(-vViewPosition);
  // Wrapped lambert: (n·l + 1) / 2, so the far limb is dim rather than black.
  float lambert = clamp((dot(normal, toEye) + 1.0) * 0.5, 0.0, 1.0);
  base *= mix(0.35, 1.15, lambert);

  // A fresnel rim, brightened while the planet is active or hovered.
  float rim = pow(1.0 - clamp(dot(normal, toEye), 0.0, 1.0), 3.0);
  float mark = 1.0 + uActive * (ACTIVE_GAIN - 1.0) + uHover * 0.6;
  base += rim * 0.35 * mark;

  gl_FragColor = vec4(base, 1.0);
}
`

/** A flat id, for anything in the pick pass that is one mesh rather than one instance. */
export const ID_VERTEX_SHADER = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ID_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform vec3 uIdColour;
void main() {
  gl_FragColor = vec4(uIdColour, 1.0);
}
`
