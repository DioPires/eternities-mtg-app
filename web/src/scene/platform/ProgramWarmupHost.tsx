/**
 * Runs {@link warmPrograms} once per scene, during PRD 6.8.2's four-second intro (DEC-739).
 *
 * Review §3.5: "Link every program at boot behind `KHR_parallel_shader_compile` ... and warm them
 * during the 4 s intro; never link on first draw." This is the "during the intro" half. The intro
 * is the right window for three reasons and they are all about *what the user is doing*: the camera
 * is flying a scripted path, so there is nothing to steer and a dropped frame costs no input; the
 * scene graph is fully built, so a traversal finds the real geometries the real draws will use; and
 * it is four seconds long, which is more than the whole program set costs even when the driver
 * refuses to compile in parallel.
 *
 * **Why it waits for `starsComplete`.** Not because the programs need the stars — they do not, and
 * an `InstancedBufferGeometry` with `instanceCount` 0 links perfectly well. Because `stars.bin` is
 * the largest transfer on the page and its decode is on the main thread; starting a compile beside
 * it would put the two in each other's way and, on a slow connection, move the compile *out* of the
 * intro rather than into it. The field completes in about half a second on this Mac.
 *
 * Renders `null` and holds no state. Like `../post/PostEffects`, it is a component only because
 * that is where a hook into the r3f scene has to live until Wave 3 takes the loop out of React.
 */

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'

import type { PostChain } from '../post/postChain'
import type { StarField } from '../starfield/starFieldObjects'

import { detectPlatformCapabilities } from './capabilities'
import {
  dedupeSpecs,
  specsFromObject,
  programWarmupRequested,
  warmPrograms,
  type ProgramWarmupResult,
  type ProgramWarmupSpec,
} from './programWarmup'

export interface ProgramWarmupHostProps {
  /**
   * The star field, whose five programs include two that no traversal can reach — the bloom
   * source's copy and the ladder's cheap glow.
   */
  readonly field: StarField | null
  /** The post chain, whose four passes share one quad and so are also unreachable by traversal. */
  readonly chainRef: MutableRefObject<PostChain | null>
  /**
   * Programs belonging to objects that are built lazily — the focused card's two planet programs.
   * A getter rather than an array so the caller can hand over a ref that fills in later.
   */
  readonly extraSpecs?: () => readonly ProgramWarmupSpec[]
  /** Gate: the field has finished streaming, so the main thread is free. See the header. */
  readonly ready: boolean
  /** Reported to the bench and the `?probe=1` seam. */
  readonly onComplete?: (result: ProgramWarmupResult) => void
}

export function ProgramWarmupHost({
  field,
  chainRef,
  extraSpecs,
  ready,
  onComplete,
}: ProgramWarmupHostProps): null {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  // The two callbacks live in a ref, the same shape `StarScene` uses and for the same reason: a
  // caller passing an inline arrow — which every React caller eventually does — would otherwise
  // put them in this effect's dependency list and re-run the entire warm-up on every render.
  const callbacks = useRef({ extraSpecs, onComplete })
  callbacks.current = { extraSpecs, onComplete }

  // `?warmup=0`, read once: a flag the page was *opened* with is not a value that may change under
  // it, and the frame callback-adjacent effect below must not re-parse `location.search`. Same
  // argument `EternitiesScene` makes for latching `?probe=` and `?quality=`.
  const wanted = useMemo(() => programWarmupRequested(), [])

  useEffect(() => {
    if (!wanted || !ready || !field) return
    const chain = chainRef.current
    let cancelled = false

    // Everything mounted — the background shells, the star points, the glow quads, the thumbnail
    // tier, the focused card's faces and edge — plus the three sets that a traversal cannot see.
    // Deduped so the count reported is a count of programs rather than of scene-graph nodes.
    const specs = dedupeSpecs([
      ...specsFromObject(scene),
      ...field.warmupSpecs,
      ...(chain ? chain.warmupSpecs : []),
      ...(callbacks.current.extraSpecs?.() ?? []),
    ])

    void warmPrograms(gl, camera, specs, detectPlatformCapabilities(gl).parallelShaderCompile).then(
      (result) => {
        if (!cancelled) callbacks.current.onComplete?.(result)
      },
    )

    return () => {
      cancelled = true
    }
  }, [wanted, ready, field, gl, scene, camera, chainRef])

  return null
}
