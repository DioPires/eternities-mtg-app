/**
 * The React attachment for {@link PostChain}, and the app's first owned frame step (DEC-703).
 *
 * This is what replaces `scene/Effects.tsx`. `Effects` was a tree of wrapper components that
 * *described* a chain, and the description was the defect: `@react-three/postprocessing` rebuilt a
 * ~150 MB effect whenever a rest object came out fresh from a render (DEC-692 R1, and the leak in
 * DEC-698 note N2 that the rebuild left behind), sized the chain from the wrong buffer (R2), ran a
 * rung that moved nothing (R3) and built a mask nobody read (R4). None of those are describable
 * here: there is no chain to describe, only a class that is constructed once per canvas and told
 * two numbers per frame.
 *
 * **This component owns the render.** `useFrame(cb, 1)` — any priority above zero — takes
 * react-three-fiber off the render path: its loop stops calling `gl.render` and only runs
 * subscribers, in ascending priority order. So a frame is `StarScene`'s priority-0 callback
 * (advance the plane table, push the uniforms, turn the background, pick) and then this one (main
 * pass, bloom source, blur, composite), in that order, by construction rather than by luck. Review
 * §3.5 asks for one tick owner; this is the first half of it, and Wave 3 moves the loop out of
 * React altogether.
 *
 * Nothing about it is React-shaped by choice: it renders `null`, it holds no state, and every prop
 * is a number. It is a component because that is where a `useFrame` subscription has to live until
 * Wave 3 lands.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, type MutableRefObject } from 'react'
import { Vector2 } from 'three'

import { BLOOM_INTENSITY } from '../tuning'

import { detectPlatformCapabilities } from '../platform/capabilities'

import { PostChain } from './postChain'

export interface PostEffectsProps {
  /**
   * The fraction of the drawing buffer the bloom source is drawn at, from the live quality tier
   * (PRD 8.5.11's second rung).
   *
   * Unlike `Effects.bloomScale` this is not a constructor option that a remount has to carry: the
   * chain re-sizes its targets when the number moves, in the same code path a window resize takes.
   */
  readonly bloomScale: number
  /** Mip levels in the blur chain, also from the tier. See `./postTuning`. */
  readonly bloomLevels: number
  /**
   * PRD 6.10.1's bloom setting, resolved to an intensity by `BLOOM_INTENSITY_STEPS`.
   *
   * A *setting*, not a tier: the ladder owns how many pixels the blur costs (`bloomScale`,
   * `bloomLevels`) and the user owns how much of it is mixed back in. Defaults to the tuned value
   * so the bench and the Phase 2a harness, which have no settings surface, keep the intensity
   * their baselines were measured at.
   */
  readonly bloomIntensity?: number
  /**
   * The live chain, for the `?probe=1` seam only (PRD 9.1.4's forced-degradation check).
   *
   * `Effects` had to expose *two* sizes here because the one the ladder set was not the one the
   * chain ran at — that was R3. The chain exposes `bloomSourceSize`, which is both.
   */
  readonly chainRef?: MutableRefObject<PostChain | null>
}

/** Scratch for the per-frame drawing-buffer read (PRD 7.3.2: no allocation in the frame path). */
const drawingBuffer = new Vector2()

export function PostEffects({
  bloomScale,
  bloomLevels,
  bloomIntensity = BLOOM_INTENSITY,
  chainRef,
}: PostEffectsProps): null {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  // Per renderer, not per render: the capabilities probe touches the GL context and the chain owns
  // GPU memory. A new canvas is the only thing that justifies either.
  const chain = useMemo(() => new PostChain(gl, detectPlatformCapabilities(gl)), [gl])

  useEffect(() => () => chain.dispose(), [chain])

  useEffect(() => {
    if (!chainRef) return
    chainRef.current = chain
    return () => {
      chainRef.current = null
    }
  }, [chain, chainRef])

  useFrame(() => {
    // The *drawing* buffer, every frame. This is the number the ladder's first rung moves and the
    // one `EffectComposer`'s wrapper read from the wrong place (R2): its size effect was keyed on
    // R3F's CSS-pixel `size`, which does not change when the pixel ratio does. Asking the renderer
    // each frame costs a `Vector2` write and cannot go stale.
    const size = gl.getDrawingBufferSize(drawingBuffer)
    chain.configure(size.x, size.y, bloomScale, bloomLevels)
    // A float write, from the closure this frame was scheduled with. Cheaper than an effect that
    // has to re-run, and it cannot be stale by a frame the way one would.
    chain.bloomIntensity = bloomIntensity
    chain.render(scene, camera)
  }, 1)

  return null
}
