/**
 * Turning a TypeScript number into a GLSL float literal.
 *
 * > **Lives here, and not in `starfield/shaders.ts`, because it outlives the galaxy (DEC-752).**
 * > It was written for the star shaders and then picked up by the five worlds shader modules and by
 * > `cards/cardShaders.ts`, so §3.2's deletion of the star shaders would have taken a function six
 * > surviving modules compile against. Relocating it *before* the cutover keeps that commit a pure
 * > deletion rather than a deletion plus a rescue.
 */

/**
 * GLSL float literals: `1` is an int in GLSL and would fail to compile where a float is wanted.
 *
 * One spelling of "how a TypeScript number becomes a GLSL float" for every shader in the app —
 * the worlds cell, belt, tether, system and atmosphere programs, and the card programs, all write
 * `#define`s from the same `tuning.ts` constants (review §6.2).
 */
export function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value)
}
