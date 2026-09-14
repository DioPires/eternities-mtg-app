/**
 * The `draw` phase: {@link PostChain} wired to the loop (DEC-703, review §3.6 phase 3).
 *
 * This was `PostEffects.tsx`, whose own header said it plainly — "it is a component because that is
 * where a `useFrame` subscription has to live until Wave 3 lands". Wave 3 landed. The component
 * rendered `null`, held no state and took three numbers; what is left once React goes is the three
 * numbers and one subscription.
 *
 * **It still owns the render.** Under R3F that took a `useFrame(cb, 1)` — any priority above zero
 * made the library stop calling `gl.render` itself and only run subscribers. There is no such
 * bargain to strike now: nothing else draws, because `draw` is the only phase that binds a
 * framebuffer and {@link TICK_PHASES} is the list of phases. The four passes the scope names
 * separately — main pass, bloom source, mip chain, composite — are `PostChain.render`'s own fixed
 * order, deliberately kept inside it rather than exposed as four subscribable phases.
 */

import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three'

import { detectPlatformCapabilities } from '../platform/capabilities'
import type { FrameLoop } from '../renderer/frameLoop'
import { BLOOM_INTENSITY } from '../tuning'

import { PostChain } from './postChain'

export interface PostChainAttachment {
  readonly chain: PostChain
  /** PRD 8.5.11's second rung: the fraction of the drawing buffer the bloom source is drawn at. */
  setBloomScale: (scale: number) => void
  /** Mip levels in the blur chain, also from the tier. See `./postTuning`. */
  setBloomLevels: (levels: number) => void
  /**
   * PRD 6.10.1's bloom *setting*, resolved to an intensity by `BLOOM_INTENSITY_STEPS`.
   *
   * Not a tier: the ladder owns how many pixels the blur costs (`bloomScale`, `bloomLevels`) and
   * the user owns how much of it is mixed back in.
   */
  setBloomIntensity: (intensity: number) => void
  dispose: () => void
}

/** Scratch for the per-tick drawing-buffer read (PRD 7.3.2: no allocation in the frame path). */
const drawingBuffer = new Vector2()

export function attachPostChain(
  gl: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  loop: FrameLoop,
): PostChainAttachment {
  // Per renderer, not per render: the capabilities probe touches the GL context and the chain owns
  // GPU memory. One renderer now lives as long as the page, so this happens exactly once.
  const chain = new PostChain(gl, detectPlatformCapabilities(gl))
  let bloomScale = 1
  let bloomLevels = 0
  let bloomIntensity = BLOOM_INTENSITY

  const unsubscribe = loop.subscribe('draw', () => {
    // The *drawing* buffer, every tick. This is the number the ladder's first rung moves and the
    // one `EffectComposer`'s wrapper read from the wrong place (DEC-692 R2): its size effect was
    // keyed on R3F's CSS-pixel `size`, which does not change when the pixel ratio does. Asking the
    // renderer each tick costs a `Vector2` write and cannot go stale.
    const size = gl.getDrawingBufferSize(drawingBuffer)
    chain.configure(size.x, size.y, bloomScale, bloomLevels)
    chain.bloomIntensity = bloomIntensity
    chain.render(scene, camera)
  })

  return {
    chain,
    setBloomScale: (scale) => {
      bloomScale = scale
    },
    setBloomLevels: (levels) => {
      bloomLevels = levels
    },
    setBloomIntensity: (intensity) => {
      bloomIntensity = intensity
    },
    dispose: () => {
      unsubscribe()
      chain.dispose()
    },
  }
}
