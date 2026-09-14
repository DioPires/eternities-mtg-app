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

/**
 * PRD 6.10.1's "bloom intensity (three steps)", indexed by `Settings.bloom` (0 subtle, 1 default,
 * 2 strong).
 *
 * Step 1 *is* {@link BLOOM_INTENSITY} rather than a number near it, so the default settings state
 * and the tuned value cannot drift apart: whatever PRD 5.3.20 is tuned to is what a user who never
 * opens the panel sees. The other two are that value scaled, which keeps the threshold and the
 * smoothing — the terms PRD 9.3 cares about when it says "bloom never washes out a label or the
 * focused card" — out of the setting entirely. 1.5× is deliberately the ceiling: it is the most
 * this can lift a star core while a near-white card frame stays below the wash-out the selection
 * exists to prevent.
 */
export const BLOOM_INTENSITY_STEPS: readonly [number, number, number] = [
  BLOOM_INTENSITY * 0.6,
  BLOOM_INTENSITY,
  BLOOM_INTENSITY * 1.5,
]

/** PRD 5.3.21: a subtle vignette. No grain, no chromatic aberration. */
export const VIGNETTE_OFFSET = 0.28
export const VIGNETTE_DARKNESS = 0.72

/*
 * ---------------------------------------------------------------------------------------------
 * The card tier (PRD 5.5, 5.6, 8.5.8-10). Phase 3.
 * ---------------------------------------------------------------------------------------------
 */

/**
 * PRD 5.5.1: a star cross-fades into a thumbnail once it "would occupy ≥ 24 px on screen".
 *
 * A single threshold would pop, which PRD 7.3.4 forbids, so the 24 px is the *end* of a band the
 * fade runs across. It is the end rather than the middle because the PRD's sentence is a promise
 * about when the thumbnail is fully there, and a band that straddled it would leave the card half
 * transparent at exactly the size the PRD says it should be a card.
 *
 * The size measured is the star's own drawn diameter — `STAR_WORLD_DIAMETER × rarity`, projected —
 * so the trigger is camera distance and rarity, never asset arrival (PRD 7.3.4 again).
 */
export const THUMBNAIL_FADE_START_PX = 14.0
export const THUMBNAIL_FADE_FULL_PX = 24.0

/**
 * A thumbnail's height in world units, as a multiple of the star diameter it replaces.
 *
 * At the fade-full distance a common star is 24 px across, and a card at this multiple is then
 * about 130 px tall — legible as a card rather than as a stamp, which is the point of the tier.
 */
export const THUMBNAIL_WORLD_HEIGHT = STAR_WORLD_DIAMETER * 5.4

/** PRD 5.5.2: "thumbnails keep their hue as a rim glow, so encoding is not lost." */
export const THUMBNAIL_RIM_WIDTH = 0.055
export const THUMBNAIL_RIM_GAIN = 1.35

/** PRD 8.5.8's atlas: 4096², 128 × 178 cells, base level only. */
export const ATLAS_SIZE = 4096
export const ATLAS_CELL_WIDTH = 128
export const ATLAS_CELL_HEIGHT = 178

/**
 * PRD 5.5.4: "thumbnails outside the frustum unload after a grace period." Seconds a cell may go
 * unseen before the LRU is allowed to take it, so a camera swinging past a shelf and back does not
 * re-fetch what it just had.
 */
export const THUMBNAIL_GRACE_S = 6

/** How often the nearest-first selector re-ranks candidates. PRD 5.5.3 wants nearest, not instant. */
export const THUMBNAIL_SELECT_INTERVAL_S = 0.2

/** PRD 7.2: 6 concurrent image requests to Scryfall, ceiling 8. The target is what ships. */
export const IMAGE_CONCURRENCY = 6

/** PRD 7.3.5: "images fade in over 200 ms". */
export const IMAGE_FADE_MS = 200

/**
 * PRD 5.6.1-2: the card is a thin rounded-rectangle solid at a fixed on-screen size.
 *
 * A Magic card is 63 × 88 mm. The half-diagonal is `CARD_RADIUS` in `camera/framing`, which is what
 * the card tether frames against, so these two follow from it rather than being chosen beside it.
 */
export const CARD_WIDTH = 0.63
export const CARD_HEIGHT = 0.88
export const CARD_THICKNESS = 0.014
export const CARD_CORNER_RADIUS = 0.032

/** PRD 5.6.3: "±12° on both axes, with spring damping". */
export const CARD_TILT_MAX_RAD = (12 * Math.PI) / 180
/** Undamped angular frequency and damping ratio of that spring. 0.85 settles without overshoot. */
export const CARD_TILT_FREQUENCY = 13.0
export const CARD_TILT_DAMPING = 0.85

/** PRD 5.6.4: "a subtle specular sheen moves with the tilt. No foil rainbow effect in v1." */
export const CARD_SHEEN_INTENSITY = 0.22
export const CARD_SHEEN_WIDTH = 0.42

/** PRD 5.6.5: the flip turns the card 180° about its vertical axis. Seconds for the turn. */
export const CARD_FLIP_S = 0.7

/** PRD 5.6.8: up to 24 planets per ring, three rings, 72 planets. */
export const PLANETS_PER_RING = 24
export const PLANET_RING_COUNT = 3
export const PLANET_CAP = PLANETS_PER_RING * PLANET_RING_COUNT

/** PRD 5.6.7: "one revolution per 60 s", independent of the plane's spin. */
export const PLANET_PERIOD_S = 60

/** Ring radii, in the card's own units. The first ring clears the card's corner. */
export const PLANET_RING_RADII: readonly number[] = [0.82, 1.12, 1.42]

/**
 * Worlds spec §1.10: a printing is a flat quad showing its own `small` image, not a sphere.
 *
 * Scryfall's `small` is 146 × 204 and is uploaded **at its own size**. That is the point of the
 * conversion rather than an incidental detail: PRD 8.5.10's 256 px `art_crop` exists because an
 * `art_crop` arrives at 626 × 457 and has to be cut down, and `small` arrives already smaller than
 * the size that downscale was aiming for. So the quad both retires the decode-time resize and
 * shows the whole card instead of a crop of its art — which is what lets §1.10 satisfy Scryfall's
 * alternative attribution clause without an artist credit beside each planet.
 */
export const PLANET_SMALL_WIDTH = 146
export const PLANET_SMALL_HEIGHT = 204

/**
 * The chord between neighbours on the tightest ring a full complement of printings can land on.
 *
 * A ring seating `n` printings puts neighbours `2π/n` apart in angle, so the chord is
 * `2r · sin(π/n)` — and a partial ring is always *wider* spaced than a full one, so the binding
 * case is every ring at {@link PLANETS_PER_RING}. Taken as a minimum over the radii rather than
 * from `PLANET_RING_RADII[0]` so that reordering or adding a radius cannot quietly stop this being
 * the tightest one.
 */
const PLANET_RING_CHORD = Math.min(
  ...PLANET_RING_RADII.map((radius) => 2 * radius * Math.sin(Math.PI / PLANETS_PER_RING)),
)

/**
 * The quad's height in the card's own units, and its width **derived from the image it shows**.
 *
 * Derived rather than written as its own literal, because "undistorted" is §1.10's entire claim
 * for the flat quad and a literal width can drift from the image's aspect while the picture stays
 * completely plausible — a card squashed by a few percent still reads as a card, and nothing
 * errors. Deriving makes the distortion unrepresentable instead of merely untested.
 *
 * **The height that fits is the one whose diagonal fits the chord, and the height is derived from
 * that too.** The quads are axis-aligned and the ring turns underneath them, so two neighbours at
 * chord `c` are offset by `(c·cos φ, c·sin φ)` where `φ` sweeps the whole turn. Axis-aligned rects
 * of equal size overlap exactly when *both* offsets are inside the box, so they clear **at every
 * phase of the turn** if and only if
 *
 * ```
 *   c ≥ √(W² + H²) = H · √(1 + (146/204)²)
 * ```
 *
 * i.e. the quad's **diagonal** fits the chord — not its width, and not its height. Checking width
 * against the arc and height against the radial gap is the configuration at the *top* of the ring
 * only; a quarter-revolution later the arc is spanned by the quad's height, and a height picked
 * against the radial gap overlaps its neighbour. (That was the previous rule here, and it shipped a
 * ring whose inner two circles overlapped by up to 10.8% of a quad's area — DEC-776 F1.)
 *
 * Solving that at equality on the tightest chord is what sizes the quad, so the constant below is
 * the largest height §1.10's ring can hold. It is **smaller** than the height that shipped and the
 * quad is still the larger pick target: at `0.174 × 0.125` both dimensions clear the retired
 * sphere's 0.116 diameter, so the conversion still costs nothing in pickability — which is the
 * claim the old comment here was making for the bigger quad.
 */
export const PLANET_QUAD_HEIGHT =
  PLANET_RING_CHORD / Math.hypot(1, PLANET_SMALL_WIDTH / PLANET_SMALL_HEIGHT)
export const PLANET_QUAD_WIDTH = (PLANET_QUAD_HEIGHT * PLANET_SMALL_WIDTH) / PLANET_SMALL_HEIGHT

/**
 * Width of the quad's rim, **in the card's units and not in UV** (§1.10, PRD 5.6.9).
 *
 * A sphere's rim came free from its own curvature: the fresnel term fell off towards the limb, so
 * the mark was the same width all the way round whatever the silhouette was. A flat quad has a
 * constant normal — the fresnel term is uniform across it — so the rim has to be drawn as a border
 * in the surface's own coordinates, and those coordinates are not square. Insetting by a fraction
 * of UV would make the left and right edges 204/146 = 1.4× thicker than the top and bottom.
 */
export const PLANET_RIM_WIDTH = 0.014

/**
 * Worlds spec §1.10: the ring's overflow, as 1 px ticks on a ring of their own.
 *
 * PRD 5.6.8 caps the ring at 72 and sends the remainder to the card panel, which
 * `ui/CardPanel.tsx` has always done — it renders the true count and lists every printing
 * uncapped. What has never existed is the *visual* tie: nothing in the scene says the ring dropped
 * any, or which. §1.10 adds exactly that and widens nothing else.
 *
 * On production this draws on **five cards** — Swamp 570, Mountain 565, Forest 563, Plains 537,
 * Island 535, with the next card at 60 printings — so it is cheap to build and cheap to get wrong
 * unnoticed, which is why §1.10 asks for a unit test on the tick positions rather than a capture.
 */
export const PLANET_TICK_RADIUS = 1.62
/** One CSS pixel, per §1.10. Not scaled by distance: a tick is a mark, not an object. */
export const PLANET_TICK_PX = 1

/** PRD 5.6.9: the active printing's planet is marked. A brighter rim, not a different shape. */
export const PLANET_ACTIVE_GAIN = 1.8

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
