/**
 * The post chain's own structural numbers (DEC-703, review §3.5).
 *
 * These live here rather than in `../tuning` on purpose. `../tuning` holds the numbers that
 * describe the *picture* — `BLOOM_THRESHOLD`, `BLOOM_SMOOTHING`, `BLOOM_INTENSITY`,
 * `VIGNETTE_OFFSET`, `VIGNETTE_DARKNESS` — and the chain reads every one of them from there, so
 * there is still exactly one copy of each. What is below is the *shape* of the chain: how many mip
 * levels it runs, how wide the upsample tent is, what the ladder's second rung does to it. A
 * reader tuning the look never wants these, and a reader changing the chain never wants the look.
 */

/**
 * Mip levels in the blur chain, by ladder rung (PRD 8.5.11's second rung, review §3.5: "bloom
 * source ½→¼ and 6→5 levels").
 *
 * The old chain ran `MipmapBlurPass`'s default eight levels off the *full* drawing buffer. Six off
 * a half-resolution source reaches the same angular radius — every level is one halving, and the
 * source is already one halving down — for two fewer passes.
 */
export const BLOOM_LEVELS_FULL = 6
export const BLOOM_LEVELS_REDUCED = 5

/**
 * How much of each upsampled level is mixed into the level below it.
 *
 * `postprocessing`'s `UpsamplingMaterial` ends with `mix(baseColor, c, radius)` and defaults
 * `radius` to 0.85; the chain here reproduces that mix exactly (see `POST_UPSAMPLE_FRAGMENT_SHADER`
 * and the blend it is paired with in `postChain.ts`), so the bloom's falloff is unchanged from the
 * shipped picture. A `mix` rather than a straight add is what keeps the total energy independent of
 * the level count — otherwise the 6→5 rung would visibly dim the bloom rather than just soften it.
 */
export const BLOOM_UPSAMPLE_RADIUS = 0.85

/**
 * PRD 5.3.20's bloom source is drawn at this fraction of the drawing buffer at the top of the
 * ladder, and the tier's `bloomScale` replaces it on the way down.
 *
 * Kept as a named constant only so the "half" in "half-resolution bloom" has one home; the value
 * the chain actually uses always comes from the live tier.
 */
export const BLOOM_SOURCE_SCALE_FULL = 0.5

/**
 * Strength of the filmic roll-off in the composite, 0 (off) to 1 (full).
 *
 * Review §3.5 asks the composite to apply "a filmic roll-off (hot cores stop clipping to white —
 * the cheapest beauty win available)". That is a change to the picture, and DEC-703's acceptance
 * asks for the picture to be unchanged from the user's side, so it ships at 0: the composite runs
 * the roll-off's code path with a strength that makes it an exact passthrough, which keeps the
 * branch live and measurable instead of dead. Flipping this to 1 is the whole of the change, and
 * it wants a before/after pair in front of the owner before it goes anywhere.
 */
export const TONEMAP_STRENGTH = 0
