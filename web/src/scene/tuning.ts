/**
 * Every visual tunable the star field has, in one place.
 *
 * PRD open question 11 leaves the exact values to the owner, to be decided at the M2/M3/M5 visual
 * reviews; until then the PRD defaults ship. Keeping them here means a review comment like "the
 * twinkle is too strong" is a one-line change, not a hunt through four shaders.
 *
 * Anything a shader also needs is injected as a `#define` by `shaders.ts`, so there is exactly one
 * source of truth for a number that both the CPU motion mirror (PRD 8.5.7) and the vertex shader
 * must agree on.
 */

/** PRD 5.3.18: near-black, never pure black. */
export const SKY_COLOUR = '#05060a'

/** PRD 5.3.13. Default period: 20 minutes. */
export const MULTIVERSE_PERIOD_S = 20 * 60

/**
 * PRD 5.4.8's seven hue classes, indexed by {@link import('../data/types').HueClass}.
 * Linear-space RGB: the scene renders linear and the composer encodes on output.
 */
export const HUE_COLOURS: readonly (readonly [number, number, number])[] = [
  [1.0, 0.949, 0.827], // W warm ivory
  [0.322, 0.639, 1.0], // U cerulean
  [0.616, 0.412, 0.949], // B violet
  [1.0, 0.451, 0.239], // R ember orange
  [0.322, 0.831, 0.494], // G viridian
  [1.0, 0.812, 0.361], // multicolour gold
  [0.812, 0.855, 0.898], // colourless silver
]

/**
 * PRD 5.4.9: size is rarity, default ratio common:mythic = 1:2.2. Indexed by
 * {@link import('../data/types').SizeClass}.
 */
export const RARITY_SIZE: readonly [number, number, number, number] = [1.0, 1.35, 1.7, 2.2]

/**
 * A common star's diameter in world units. Sizes are physical rather than fixed in pixels so that
 * the star-to-thumbnail cross-fade of PRD 5.5.1 can key off a real on-screen size, and so a
 * level-of-detail change is timed by camera distance and never pops (PRD 7.3.4).
 */
export const STAR_WORLD_DIAMETER = 0.055

/** A star never vanishes and never becomes a disc. Diameters in CSS pixels. */
export const STAR_MIN_PX = 1.0
export const STAR_MAX_PX = 22.0

/** Below this the pick pass grows the sprite, so a one-pixel star is still clickable. */
export const PICK_MIN_PX = 7.0

/**
 * The sprite floor the GPU self-check picks with, in CSS pixels.
 *
 * `PICK_MIN_PX` is a *usability* number: it inflates the click target so that a one-pixel star can
 * still be hit. For the self-check that inflation is pure loss. The check has to find one specific
 * star in the pick window, and every sprite inflated to seven pixels is seven pixels of something
 * else covering it — the id pass depth-tests, so a nearer star simply wins. Measured on Metal, the
 * narrower sprite is what makes the samples measurable at all.
 *
 * Two, not one: below about two pixels a sprite covers so few fragments that rasterisation rather
 * than position decides what lands in the id buffer.
 */
export const SELF_CHECK_PICK_MIN_PX = 2.0

/** PRD 5.4.11: subtle seeded twinkle, default amplitude ±8% brightness. */
export const TWINKLE_AMPLITUDE = 0.08
/** Radians per second of the twinkle oscillator. ~2.4 s period, slow enough to read as breathing. */
export const TWINKLE_RATE = 2.6

/** PRD 5.4.12: hover brightens a star by 30%. */
export const HOVER_GAIN = 1.3

/** PRD 5.8.1: cards failing the filter dim to 10% and drop out of the bloom. */
export const FILTER_DIM = 0.1

/**
 * PRD 5.4.13's radial phase term `φ(r)`. The shear angle is
 * `A · sin(2πt/T + φ + r · SHEAR_RADIAL_PHASE)`, so the wave travels outward along the arms
 * instead of the whole disc shearing in lockstep. One and a bit turns across the disc.
 */
export const SHEAR_RADIAL_PHASE = 7.0

/** PRD 5.3.15: the drift orbit is a flattened ellipse, mostly in the disc plane. */
export const DRIFT_VERTICAL_RATIO = 0.35

/**
 * PRD 5.3.16 / 8.6.3: Blind Eternities curl-noise turbulence. Amplitude is in plane-local units
 * (dust is stored normalised to the multiverse radius), so 0.004 × 130 ≈ 0.5 world units.
 */
export const DUST_CURL_AMPLITUDE = 0.004
export const DUST_CURL_SCALE = 2.6
export const DUST_CURL_SPEED = 0.035

/** PRD 5.3.4: focusing the Blind Eternities brightens the dust. */
export const DUST_FOCUS_GAIN = 2.4
/** Seconds for the focus brightening to ease in or out. */
export const DUST_FOCUS_EASE_S = 0.6

/** PRD 6.8.1 / 8.7.3: a plane fades in over this many seconds once its stars have arrived. */
export const PLANE_FADE_S = 0.7

/**
 * PRD 5.3.19: the nebula extends this many plane radii, at this opacity.
 *
 * "Low opacity" is load-bearing and easy to get wrong. Eighty-three additive quads overlap at
 * multiverse level, so the visible brightness is several times whatever one of them contributes;
 * anything above about 0.04 turns PRD 5.1's "the stars are the subject" into a fog bank with
 * speckles in it.
 */
export const NEBULA_RADIUS_SCALE = 2.1
export const NEBULA_OPACITY = 0.028

/**
 * PRD 5.3.6: zero-card planes are a small dim elliptical glow with no stars. Their `radius` is
 * already r_min from the pipeline, so this only sets how far the glow spreads and how bright it
 * is. Dim, but it has to survive being the only thing marking a plane that has no stars at all.
 */
export const EMPTY_GLOW_RADIUS_SCALE = 1.6
export const EMPTY_GLOW_OPACITY = 0.16
/** The empty glow's core, which is what makes it read as an object rather than as haze. */
export const EMPTY_GLOW_CORE = 0.22

/**
 * A glow quad is billboarded and then squashed along the screen projection of its plane's normal,
 * which is what makes it read as an ellipse (PRD 5.3.6). Clamped so an edge-on disc never
 * collapses to a line.
 */
export const GLOW_MIN_ASPECT = 0.35

/** PRD 5.3.20: bloom is selective by luminance threshold, half-resolution blur (PRD 8.5.5). */
export const BLOOM_THRESHOLD = 0.28
export const BLOOM_SMOOTHING = 0.45
export const BLOOM_INTENSITY = 1.15

/** PRD 5.3.21: a subtle vignette. No grain, no chromatic aberration. */
export const VIGNETTE_OFFSET = 0.28
export const VIGNETTE_DARKNESS = 0.72

/** PRD 5.3.18: the three-layer parallax background. */
export interface BackgroundLayerSpec {
  readonly count: number
  readonly radius: number
  readonly size: number
  readonly opacity: number
  /** Relative rotation rate, so the three layers read as distinct depths. */
  readonly parallax: number
  readonly tint: string
}

export const BACKGROUND_LAYERS: readonly BackgroundLayerSpec[] = [
  { count: 2600, radius: 900, size: 1.7, opacity: 0.85, parallax: 1.0, tint: '#cfd8ff' },
  { count: 1800, radius: 1400, size: 1.3, opacity: 0.55, parallax: 0.55, tint: '#aab6e8' },
  { count: 1200, radius: 2000, size: 1.0, opacity: 0.32, parallax: 0.28, tint: '#8f9ac4' },
]
