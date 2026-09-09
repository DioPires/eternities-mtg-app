/**
 * What the chain is allowed to allocate on this GPU, asked once per renderer.
 *
 * Review §3.7's "All" row: the shipped composer's buffers are RGBA16F with **no detection** —
 * `EffectComposer` is constructed with a half-float frame-buffer type and nothing ever asks whether
 * the context can render to a float target. On WebGL2 that needs `EXT_color_buffer_float`, which is
 * not core: it is universal on desktop GL and D3D11, and it is exactly the kind of thing a software
 * rasteriser, a locked-down driver or a headless CI browser drops. Without it the target allocation
 * fails and the frame is black, which is the worst failure mode available for a check nobody ran.
 *
 * So the chain asks, and falls back to eight bits per channel. That fallback is not a guess: the
 * glow shader already dithers its output against 8-bit quantisation ("Eighty-three of these overlap
 * additively at very low alpha, and an 8-bit output quantises the result into visible contour rings
 * around every plane", `../starfield/shaders`), which is the same defence an 8-bit bloom source
 * needs and the reason the fallback is a tier cap rather than a refusal.
 */

import { HalfFloatType, UnsignedByteType, type TextureDataType, type WebGLRenderer } from 'three'

export interface PostCapabilities {
  /** True when render targets may be RGBA16F. */
  readonly floatTargets: boolean
  /** The `type` every target in the chain is allocated with. */
  readonly targetType: TextureDataType
  /**
   * The highest quality tier the chain will honour, as an index into `QUALITY_TIERS`.
   *
   * `0` — no cap — whenever float targets are available. Without them the bloom source is
   * quantised, and review §3.5 caps the ladder at tier 2 rather than pretending the top rungs mean
   * the same thing.
   */
  readonly maxTierIndex: number
}

/** Without `EXT_color_buffer_float` the ladder cannot claim its top rungs. See {@link PostCapabilities}. */
const CAPPED_TIER_INDEX = 2

export function detectPostCapabilities(renderer: WebGLRenderer): PostCapabilities {
  // `WebGLRenderer.extensions.has` caches, and returns false rather than throwing on a context
  // that has been lost — which is the answer we want in that case anyway.
  const floatTargets = renderer.extensions.has('EXT_color_buffer_float')
  return {
    floatTargets,
    targetType: floatTargets ? HalfFloatType : UnsignedByteType,
    maxTierIndex: floatTargets ? 0 : CAPPED_TIER_INDEX,
  }
}
