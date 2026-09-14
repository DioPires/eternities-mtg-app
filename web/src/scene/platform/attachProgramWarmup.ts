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
 * This was `ProgramWarmupHost.tsx`, which said it was "a component only because that is where a
 * hook into the r3f scene has to live until Wave 3 takes the loop out of React" (review §3.6
 * phase 3). The ordering its JSX position encoded — after `PostEffects`, so the post chain exists
 * to be asked for its four programs — is now an explicit argument: {@link ProgramWarmupOptions.chain}
 * is passed in by a caller that has already built it.
 */

import type { Camera, Scene, WebGLRenderer } from 'three'

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

export interface ProgramWarmupOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly camera: Camera
  /**
   * The star field, whose five programs include two that no traversal can reach — the bloom
   * source's copy and the ladder's cheap glow.
   */
  readonly field: StarField
  /** The post chain, whose four passes share one quad and so are also unreachable by traversal. */
  readonly chain: PostChain | null
  /**
   * Programs belonging to objects that are built lazily — the focused card's two planet programs.
   * A getter rather than an array so the caller can hand over something that fills in later.
   */
  readonly extraSpecs?: () => readonly ProgramWarmupSpec[]
  /** Reported to the bench and the `?probe=1` seam. */
  readonly onComplete?: (result: ProgramWarmupResult) => void
}

/**
 * Start the warm-up. Returns a cancel; calling it stops the result being reported, not the compile
 * already handed to the driver.
 *
 * The caller gates on `starsComplete` — see the header. `?warmup=0` turns it off, read here rather
 * than latched by the caller because this runs once and never again.
 */
export function attachProgramWarmup({
  gl,
  scene,
  camera,
  field,
  chain,
  extraSpecs,
  onComplete,
}: ProgramWarmupOptions): () => void {
  if (!programWarmupRequested()) return () => {}
  let cancelled = false

  // Everything mounted — the background shells, the star points, the glow quads, the thumbnail
  // tier, the focused card's faces and edge — plus the three sets that a traversal cannot see.
  // Deduped so the count reported is a count of programs rather than of scene-graph nodes.
  const specs = dedupeSpecs([
    ...specsFromObject(scene),
    ...field.warmupSpecs,
    ...(chain ? chain.warmupSpecs : []),
    ...(extraSpecs?.() ?? []),
  ])

  void warmPrograms(gl, camera, specs, detectPlatformCapabilities(gl).parallelShaderCompile).then(
    (result) => {
      if (!cancelled) onComplete?.(result)
    },
  )

  return () => {
    cancelled = true
  }
}
