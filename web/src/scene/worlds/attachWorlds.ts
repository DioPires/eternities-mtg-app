/**
 * §1.1 and §1.2, as the thing that puts worlds in the frame.
 *
 * Everything else under `worlds/` is a part or a composition of parts. This is the **cutover**: the
 * module that takes the shipped dataset, composes one {@link WorldSurface} per world, puts their
 * sheets in the scene graph as §1.2's step 4, runs them on the tick, and publishes the `?probe=`
 * source §3.1's gate is built against. Until it existed, `__eternitiesProbe.worlds()` returned
 * `undefined` on every page — the composition was built, tested and unreachable.
 *
 * **Who owns §1.1/§1.2.** §4's staffing table names R1 as §1.3–§1.6, R2 as §1.7–§1.9, R3 as
 * §1.10–§1.12 and G as §3; §1.1 and §1.2 are assigned to nobody. They fall to R1 by elimination and
 * by dependency — §4's own "why R1 cannot start early" is that R1 "lives inside the tick order and
 * the pass list", which is precisely these two sections. Flagged to the CEO rather than assumed
 * silently; no ruling had come back when this landed, so it is built here.
 *
 * **What this deliberately does not do.** §1.1 also deletes the bloom source, the mip chain and
 * half the composite. That is not deferred out of caution — §3.2 makes it part of the **cutover
 * PR**, gated on the gate passing, the owner accepting the capture set, the W0.1 field reports and
 * feature parity, and it says in terms that "until then the two coexist". Deleting the post chain
 * now would retire the galaxy before the instrument meant to judge its replacement has ever run.
 * Steps 2, 3, 5, 6 and 8 of §1.2's pass list — the system icospheres, the belt, the tether, the
 * printing ring and the atmosphere — are R2's and R3's, and each arrives as another node beside the
 * group below.
 *
 * **One pool, one threshold, one stream, for all worlds.** §1.12 budgets a single 1,024-layer art
 * pool and a single set of cell attributes across the roster, and §1.2 keeps every world's sheet
 * resident because any number of them may be above the crossover at once. The per-world objects are
 * the surfaces; everything with a byte budget attached to it is shared and lives here.
 */

import {
  Group,
  Matrix4,
  NoColorSpace,
  Texture,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three'

import type { Stars, Swatches } from '../../data/decode'
import type { PlaneRecord } from '../../data/types'
import { ImageQueue } from '../cards/imageQueue'
import { detectPlatformCapabilities, type PlatformCapabilities } from '../platform/capabilities'
import type { FrameLoop } from '../renderer/frameLoop'

import { AdaptiveThreshold } from './adaptiveThreshold'
import { ArtPool, artPoolSize } from './artPool'
import { ArtStream } from './artStream'
import { keyLightDirection } from './keyLight'
import { readWorldsSeams, type WorldsSeams } from './seams'
import { buildWorldSource, worldPlanesOf, type WorldPlane } from './worldSource'
import { WorldSurface, type WorldCard, type WorldFrame } from './worldSurface'
import {
  createArtPoolTexture,
  createEquirectArray,
  uploadArtLayer,
  writeEquirectLayer,
  type DataArrayTextureType,
} from './worldTextures'
import type { ProbeCamera, WorldsProbeSource } from './worldsProbe'

/**
 * Tier 0's art-pool layers (§1.12's table).
 *
 * The **starting** size only. §1.12's rung — 1,024 / 1,024 / 512 / 256 / 128 — belongs to R3 with
 * the rest of that section, and it reaches this module through {@link WorldsAttachment.setArtLayers}
 * rather than by this file reading `QUALITY_TIERS`. Two readers of the ladder is how a caller ends
 * up allocating tier 0's pool against tier 2's other four rungs (DEC-747's finding, in the small).
 */
export const DEFAULT_TIER_ART_LAYERS = 1024

/** The three artefacts a world is composed from. All three, or none — see {@link WorldsAttachment.setData}. */
export interface WorldsData {
  readonly planes: readonly PlaneRecord[]
  readonly stars: Stars
  readonly swatches: Swatches
}

export interface WorldsAttachmentOptions {
  readonly gl: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  /** Defaults to the URL's. Injected by the tests, which have no `location` worth reading. */
  readonly seams?: WorldsSeams
  /**
   * Injected by the tests. jsdom has no WebGL, and `detectPlatformCapabilities` reads a real
   * context — the same seam `SceneRendererOptions.createRenderer` is, for the same reason.
   *
   * Nothing in the product passes this. It is here so a test can name a `maxArrayTextureLayers`
   * and assert the **clamped** pool size that comes out, which is the one number §1.12 says
   * `e2e/quality.spec.ts` must read back rather than assume.
   */
  readonly capabilities?: Pick<PlatformCapabilities, 'webgl2' | 'maxArrayTextureLayers'>
  /** Injected by the tests; the product shares nothing with the card tier's queue by design. */
  readonly queue?: ImageQueue
  readonly byteBudget?: number
  /** §1.12's rung 0. See {@link DEFAULT_TIER_ART_LAYERS}. */
  readonly tierArtLayers?: number
  /**
   * The printing for a card of a given world, or `null` while its shard has not landed.
   *
   * Defaults to "nothing yet", which is the honest cold start: printing ids live in the per-plane
   * shards of PRD 8.3 and are fetched on focus, so a world at system distance is swatch-only —
   * which is exactly what §1.5's far rung draws.
   */
  readonly cardOf?: (plane: WorldPlane, card: number) => WorldCard | null
}

export interface WorldsAttachment {
  /** Compose the roster, or tear it down. Idempotent in the identity of `data`. */
  setData: (data: WorldsData | null) => void
  /**
   * The `?probe=` payload source (§3.1), or `null`.
   *
   * `null` — which the seam turns into `undefined` — on a page where **no world is composed**, and
   * *also* before the first tick has run: every field in the payload except the roster is frame
   * state, and assembling one from a camera that has never been read would publish a placeholder
   * that reads exactly like a measurement. §3.1 makes `undefined` a **setup failure** the gate
   * branches on, which is the correct reading of "the tick has not started".
   */
  probeSource: () => WorldsProbeSource | null
  /** §1.12's rung, for R3's ladder. See the method's note — it is not implemented here. */
  setArtLayers: (tierLayers: number) => void
  /** The composed worlds, in roster order. For the tests and for R2's system pass. */
  readonly surfaces: readonly WorldSurface[]
  /** §1.5's far LOD: one baked 256x128 layer per world with cards. R2's step-2 pass samples it. */
  readonly equirectArray: DataArrayTextureType | null
  readonly pool: ArtPool
  dispose: () => void
}

/**
 * Compose the roster and run it on the tick.
 *
 * The attachment exists from construction and is empty until {@link WorldsAttachment.setData}; the
 * subscription is taken **once, here**, so the `worlds` phase has a subscriber from the first tick
 * rather than acquiring one when the data lands. That is the ordering lesson DEC-761's F1 cost a
 * frozen camera: a phase whose subscriber arrives conditionally is a phase that can end up with
 * none at all, and nothing in a unit suite notices.
 */
export function attachWorlds(options: WorldsAttachmentOptions): WorldsAttachment {
  const { gl, scene, camera, loop } = options
  const seams = options.seams ?? readWorldsSeams()
  const capabilities = options.capabilities ?? detectPlatformCapabilities(gl)

  const group = new Group()
  group.name = 'worlds'
  scene.add(group)

  const threshold = new AdaptiveThreshold(!seams.artThresholdFixed24)
  const queue = options.queue ?? new ImageQueue()
  const ownsQueue = options.queue === undefined

  // Per-tick scratch, allocated once (PRD 7.3.2). `frameCamera` is a **copy** of the camera, not a
  // view of it; see `runFrame`.
  const viewport = new Vector2()
  const light = new Vector3()
  const frameCamera: { -readonly [K in keyof ProbeCamera]: ProbeCamera[K] } = {
    matrixWorldInverse: new Matrix4(),
    projectionMatrix: new Matrix4(),
    position: new Vector3(),
    near: 0,
  }

  /**
   * The pool size actually allocated: `?layers=N` if the URL asked, the tier otherwise, both put
   * through §1.6's clamp against this GPU's `MAX_ARRAY_TEXTURE_LAYERS`.
   *
   * `?layers=` wins over the tier and is **not** routed through the quality ladder — see
   * `seams.ts`. What the probe reports back is `pool.report().layers`, the number that was
   * allocated, never the number that was asked for: a seam with no read-back is a seam that can
   * silently fail to parse and still score its control green.
   */
  function resolveLayers(tier: number): number {
    // `webgl2` is the capability gate, the clamp is the size. A non-WebGL2 context reports
    // `maxArrayTextureLayers` as 0, and `artPoolSize`'s outer `max` floors that to a legal
    // zero-layer pool rather than to -32 (§1.6's N1).
    if (!capabilities.webgl2) return 0
    return artPoolSize(seams.layersRequested ?? tier, capabilities.maxArrayTextureLayers)
  }

  /**
   * The pool, the texture behind it and the stream that fills it — **allocated when the first world
   * composes, not at construction.**
   *
   * §1.12's pool is 48 MiB at tier 0. §3.2 says the galaxy and the worlds path "coexist at zero
   * cost" until cutover, and a v2 page that never composes a world is the common case for the whole
   * of that period — so allocating the array texture in the constructor would put the single largest
   * resident allocation in the app onto every page load of the shipped product, to be sampled by
   * nothing. The idle state is a real `ArtPool` of **zero** layers rather than `null`: §1.6 already
   * makes a zero-layer pool legal and swatch-only, so every reader downstream is on a path it
   * already has to support instead of a second one guarded by a null check.
   */
  let pool = new ArtPool(0)
  let artTexture: DataArrayTextureType | null = null
  let stream: ArtStream | null = null

  function allocatePool(): void {
    pool = new ArtPool(resolveLayers(options.tierArtLayers ?? DEFAULT_TIER_ART_LAYERS))
    artTexture = createArtPoolTexture(pool.layers)
    // `null` on a zero-layer pool, and that is §1.6's legal swatch-only world rather than a
    // fallback: every cell reads `layerOf` as `null` for the session and draws its swatch, which is
    // what §1.4's shading path already does when nothing is resident.
    stream =
      pool.layers > 0
        ? new ArtStream({
            pool,
            queue,
            ...(options.byteBudget === undefined ? {} : { byteBudget: options.byteBudget }),
            upload: (layer, bitmap, box) => {
              if (!artTexture) return
              const source = new Texture(bitmap)
              // Not a mistake, and the same call `cards/atlas` makes: Scryfall's bytes are sRGB and
              // the pool's internal format is SRGB8_ALPHA8, so three must not decode on the way in.
              source.colorSpace = NoColorSpace
              source.needsUpdate = true
              uploadArtLayer(gl, artTexture, layer, source, box)
              source.dispose()
            },
          })
        : null
  }

  function releasePool(): void {
    stream?.reset()
    stream = null
    artTexture?.dispose()
    artTexture = null
    pool = new ArtPool(0)
  }

  let surfaces: WorldSurface[] = []
  let equirectArray: DataArrayTextureType | null = null
  let data: WorldsData | null = null
  /** The frame the last `update` was made against. See {@link WorldsAttachment.probeSource}. */
  let lastFrame: WorldFrame | null = null

  function teardownSurfaces(): void {
    for (const surface of surfaces) {
      group.remove(surface.mesh)
      surface.dispose()
    }
    surfaces = []
    equirectArray?.dispose()
    equirectArray = null
    lastFrame = null
  }

  function runFrame(deltaSeconds: number): void {
    if (surfaces.length === 0) return
    // **CSS pixels, not device pixels.** Every threshold in §1.5 and §1.6 is CSS — the 4/8 px
    // crossover band and the 24 px art threshold alike — so `getSize` is the right call and
    // `getDrawingBufferSize` is not. On a 2x display the two differ by a factor of two, which would
    // put every world a full LOD rung out and hand the gate a `wantsArt` set the renderer never
    // used, with a picture that still looks entirely correct.
    gl.getSize(viewport)
    if (viewport.x === 0 || viewport.y === 0) return

    // Copied, not referenced: the camera's matrices are mutated in place every tick, so a payload
    // holding the live camera would report frame N+1's view against frame N's admission. The two
    // disagree exactly at the threshold boundary, which is the set W4 scores.
    frameCamera.matrixWorldInverse.copy(camera.matrixWorldInverse)
    frameCamera.projectionMatrix.copy(camera.projectionMatrix)
    frameCamera.position.setFromMatrixPosition(camera.matrixWorld)
    frameCamera.near = camera.near
    keyLightDirection(camera.matrixWorld, light)

    const frame: WorldFrame = {
      camera: frameCamera,
      viewport: { width: viewport.x, height: viewport.y },
      fovRadians: (camera.fov * Math.PI) / 180,
      deltaSeconds,
      lightDirection: light,
    }
    lastFrame = frame

    for (const surface of surfaces) {
      surface.update(frame)
      // §1.2's partition, applied. A world below the band's floor draws only in step 2 — R2's
      // system instance — and one inside the band draws in **both**, which is why this reads the
      // sheet's own flag and is not the complement of anything the system pass counts.
      surface.mesh.visible = surface.crossover.drawSheet
    }
  }

  const unsubscribes = [loop.subscribe('worlds', ({ delta }) => runFrame(delta))]

  return {
    get surfaces() {
      return surfaces
    },
    get equirectArray() {
      return equirectArray
    },
    get pool() {
      return pool
    },

    setData: (next) => {
      if (next === data) return
      data = next
      teardownSurfaces()
      // Every in-flight fetch would land in a layer the new roster has since been given, and the
      // pool itself is sized against a roster that is going away. See `ArtStream.reset`.
      releasePool()
      if (!next) return

      const worlds = worldPlanesOf(next.planes)
      if (worlds.length === 0) return
      allocatePool()
      // One layer per world with cards, from the dataset's own count — 29 on the 87-plane roster
      // and 45 on v3 (§1.5, §1.12). A constant is right on exactly one of the two.
      equirectArray = createEquirectArray(worlds.length)
      for (const [index, plane] of worlds.entries()) {
        const cardOf = options.cardOf
        const surface = new WorldSurface(
          buildWorldSource(
            plane,
            next.stars,
            next.swatches,
            cardOf ? { cardOf: (card) => cardOf(plane, card) } : {},
          ),
          { seams, pool, threshold, stream, artTexture },
        )
        surfaces.push(surface)
        group.add(surface.mesh)
        if (equirectArray) writeEquirectLayer(equirectArray, index, surface.equirect)
      }
    },

    probeSource: () => {
      const frame = lastFrame
      if (!frame || surfaces.length === 0) return null
      // The world the camera is at, in units of that world's **own** radius — the pose every §3.1
      // criterion is stated against. Nearest in radii rather than in scene units, because a small
      // world the camera is close to is the subject and a large one further away is not.
      let nearest = surfaces[0]!
      for (const surface of surfaces) {
        if (surface.radii < nearest.radii) nearest = surface
      }
      return nearest.probeSource(frame)
    },

    setArtLayers: (tierLayers) => {
      const resolved = resolveLayers(tierLayers)
      if (resolved === pool.layers) return
      // Deliberately not a live reallocation: resizing an array texture means a new allocation, a
      // re-upload of every resident layer and a rebind on every surface's material, and §1.12's
      // rung is R3's leg. Accepting the request without acting on it would be worse — the probe
      // would then report a pool size the renderer never allocated, which is exactly the
      // read-back failure `seams.ts` is written against. So it refuses until R3 lands the rung.
      throw new Error(
        `art pool is ${pool.layers} layers and cannot yet be resized to ${resolved} (spec §1.12, leg R3)`,
      )
    },

    dispose: () => {
      for (const undo of unsubscribes.splice(0)) undo()
      teardownSurfaces()
      releasePool()
      scene.remove(group)
      if (ownsQueue) queue.dispose()
    },
  }
}
