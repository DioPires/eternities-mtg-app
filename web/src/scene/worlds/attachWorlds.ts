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
 *
 * **Except §1.6's hysteresis, which is per-world and lives on the surface.** The shared
 * {@link AdaptiveThreshold} below is the histogram and the quantile — per-frame scratch, and a
 * quantile taken against the one pool's capacity, so sharing it is right. "The boundary must not
 * oscillate" is not per-frame: it is a claim about *this world's previous frame*, and with 45
 * surfaces running through one bucket it silently became a claim about the previous *surface*,
 * which made the hold branch unreachable in the product (DEC-768 F2). See `ThresholdMemory` in
 * `adaptiveThreshold.ts`; `WorldSurface` owns one and hands it to `end()`.
 */

import {
  Group,
  Matrix4,
  NoColorSpace,
  Texture,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type Points,
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
import { AtmospherePass, type RimQuality } from './atmosphere'
import { buildBelt, disposeBelt, setBeltPixelRatio } from './belt'
import { keyLightDirection } from './keyLight'
import {
  RENDER_ORDER_BELT,
  RENDER_ORDER_SHEET,
  RENDER_ORDER_SYSTEM,
} from './passOrder'
import { readWorldsSeams, type WorldsSeams } from './seams'
import { planeOrientation, NO_SPIN, type SpinAngleSource } from './spin'
import { SystemPass } from './systemMesh'
import { TetherPass, type TetherEnd } from './tether'
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
  /**
   * `PlanesFile.multiverseRadius` — §1.8's belt sits at **1.12 ×** this (DEC-750).
   *
   * Carried on the roster rather than read off the dust plane's own `radius`, which happens to hold
   * the same 130.0 on every dataset so far. That coincidence is the pipeline writing the multiverse
   * radius into a per-plane field, not a contract: `PlanesFile` is where the number is defined, and
   * a belt scaled from the plane row would be silently wrong the first time the two diverge — at
   * 1.12 of the wrong radius, which still looks exactly like a belt.
   */
  readonly multiverseRadius: number
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
  /**
   * Every plane's accumulated spin angle this frame, by `PlaneRecord.index` (§1.3, DEC-750).
   *
   * **The plane table's, never a second clock.** `PlaneTable.advance` already integrates the spin
   * and `motionSync` mirrors it into the camera rig, which is what PRD 8.5.7's CPU mirror flies the
   * camera against — so a worlds path that integrated its own would put the cell under the reticle
   * somewhere the camera does not go. `null` restores {@link NO_SPIN}, which is the honest state
   * before `planes.json` and the table have landed.
   *
   * See `spin.ts` for the CEO's axis ruling and the measurement behind it.
   */
  setSpinAngles: (spinAngleOf: SpinAngleSource | null) => void
  /**
   * §1.9's two ends, or `null` to hide the tether.
   *
   * Imperative and unwired, deliberately. §1.9 specifies the tether's *geometry* between two worlds
   * and says nothing about which two or when; §4 puts the product surfaces (§1.10–§1.12) on leg R3.
   * See `tether.ts`'s header — flagged on DEC-750's hand-back rather than invented here.
   */
  setTether: (ends: readonly [string, string] | null) => void
  /**
   * §1.12's tier-4 rung: *"cheap rim (one tap, no dither)"* (§1.7).
   *
   * A knob, not a rung. §1.12 is leg R3's section and `applyQualityTier` is the ladder's **one**
   * application point (DEC-747's finding), so wiring this to the tier here would be a second writer
   * on the ladder — the exact shape that made the pixel-ratio rung untestable. R3 adds the field to
   * `QualityTier` and the line to `applyQualityTier`; R2 owes the knob and the two programs.
   */
  setRimQuality: (quality: RimQuality) => void
  /** The composed worlds, in roster order. For the tests and for R2's system pass. */
  readonly surfaces: readonly WorldSurface[]
  /** §1.5's far LOD: one baked 256x128 layer per world with cards. R2's step-2 pass samples it. */
  readonly equirectArray: DataArrayTextureType | null
  readonly pool: ArtPool
  /** §1.2 step 2 (§1.8). `null` until a roster composes. */
  readonly system: SystemPass | null
  /** §1.2 step 8 (§1.7). `null` until a roster composes. */
  readonly atmosphere: AtmospherePass | null
  /** §1.2 step 5 (§1.9). Lives for the attachment; hidden until {@link setTether}. */
  readonly tether: TetherPass
  /** How many instances §1.2's step 2 drew last frame — the count §1.5 warns not to derive. */
  readonly systemDrawn: number
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
  /** `worldPlanesOf`'s output, index-aligned with {@link surfaces} — and with the equirect layers. */
  let worldPlanes: WorldPlane[] = []
  let equirectArray: DataArrayTextureType | null = null
  let data: WorldsData | null = null
  /** The frame the last `update` was made against. See {@link WorldsAttachment.probeSource}. */
  let lastFrame: WorldFrame | null = null

  // §1.2's other three passes (R2). All three live beside the sheets in `group`, and all three are
  // composed from the same roster, so they are torn down with it.
  let system: SystemPass | null = null
  let atmosphere: AtmospherePass | null = null
  let belt: Points | null = null
  const tether = new TetherPass()
  group.add(tether.ribbon, tether.pads[0], tether.pads[1])

  /** By `PlaneRecord.index`, so §1.5's crossover can be asked about a plane rather than a surface. */
  let surfaceOfPlane = new Map<number, WorldSurface>()
  let spinAngleOf: SpinAngleSource = NO_SPIN
  let rimQuality: RimQuality = 'full'
  /** §1.9's flow pulse runs on wall time, so it is the one thing here that accumulates. */
  let elapsedSeconds = 0

  function teardownSurfaces(): void {
    for (const surface of surfaces) {
      group.remove(surface.mesh)
      surface.dispose()
    }
    surfaces = []
    worldPlanes = []
    surfaceOfPlane = new Map()
    equirectArray?.dispose()
    equirectArray = null
    lastFrame = null
    if (system) {
      group.remove(system.mesh)
      system.dispose()
      system = null
    }
    if (atmosphere) {
      group.remove(atmosphere.mesh)
      atmosphere.dispose()
      atmosphere = null
    }
    if (belt) {
      group.remove(belt)
      disposeBelt(belt)
      belt = null
    }
    tether.setEnds(null)
  }

  /**
   * §1.5's crossover for a plane that has a sheet.
   *
   * > **Not the complement of step 4 (§1.2, §1.5).** *"Step 2's instance count is a count of planes
   * > below the band's top"* — a world **inside** the band is in both passes — *"and a renderer that
   * > derives one from the other will be one instance short through every approach."* So this reads
   * > the surface's own `drawSystem`, which `crossoverState` sets independently of `drawSheet`.
   */
  function drawsSystem(plane: PlaneRecord): boolean {
    return surfaceOfPlane.get(plane.index)?.crossover.drawSystem ?? true
  }

  /** §1.7's *"every world that is drawn at all"* — which, for a world with a sheet, is always. */
  function isDrawn(plane: PlaneRecord): boolean {
    const surface = surfaceOfPlane.get(plane.index)
    if (!surface) return false
    return surface.crossover.drawSystem || surface.crossover.drawSheet
  }

  /** One end of §1.9's tether, from a composed world. `null` if that slug composed nothing. */
  function tetherEnd(slug: string): TetherEnd | null {
    const surface = surfaces.find((candidate) => candidate.planeSlug === slug)
    if (!surface) return null
    return {
      centre: surface.centre.clone(),
      radius: surface.radius,
      // Seeded on the pole rather than on a zero vector: the first frame's `advanceAnchor` lerps
      // from whatever is here, and a zero vector normalises to NaN and takes the whole ribbon with
      // it. Any unit direction does; this one is the axis §1.3 already names.
      anchor: new Vector3(0, 1, 0),
      exit: new Vector3(0, 1, 0),
    }
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
    elapsedSeconds += deltaSeconds

    for (const [index, surface] of surfaces.entries()) {
      // §1.3's orientation, before the surface measures anything: `update` folds it into the local
      // frame it projects in, and reading it afterwards would measure last frame's rotation against
      // this frame's camera. See `spin.ts` for the axis ruling.
      const plane = worldPlanes[index]
      if (plane) planeOrientation(plane, spinAngleOf, surface.orientation)
      surface.update(frame)
      // §1.2's partition, applied. A world below the band's floor draws only in step 2 — R2's
      // system instance — and one inside the band draws in **both**, which is why this reads the
      // sheet's own flag and is not the complement of anything the system pass counts.
      surface.mesh.visible = surface.crossover.drawSheet
    }

    // Steps 2, 8 and 5. After the sheets, because all three read the crossover state the loop above
    // just produced — and §1.2's *order* is `renderOrder`, not the order they are updated in.
    if (belt) setBeltPixelRatio(belt, gl.getPixelRatio())
    system?.update(frame, spinAngleOf, drawsSystem)
    atmosphere?.update(frame, isDrawn)
    tether.update(camera, viewport.y, elapsedSeconds, deltaSeconds)
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
    get system() {
      return system
    },
    get atmosphere() {
      return atmosphere
    },
    get tether() {
      return tether
    },
    get systemDrawn() {
      return system?.drawnCount ?? 0
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
      worldPlanes = worlds
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
        surfaceOfPlane.set(plane.index, surface)
        surface.mesh.renderOrder = RENDER_ORDER_SHEET
        group.add(surface.mesh)
        if (equirectArray) writeEquirectLayer(equirectArray, index, surface.equirect)
      }

      // --- §1.2's other three passes (R2) ------------------------------------------------------

      // The layer index is the world's position in `worlds`, which is the order the loop above wrote
      // the array in. Handed to the system pass rather than recomputed there: two derivations of one
      // ordering agree until the day a plane with cards fails to compose, and then the whole roster
      // is off by one layer with every world still drawing a plausible mosaic.
      const layerByPlane = new Map(worlds.map((plane, index) => [plane.index, index]))
      system = new SystemPass({
        planes: next.planes,
        equirect: equirectArray,
        layerOf: (plane) => layerByPlane.get(plane.index) ?? -1,
      })
      system.mesh.renderOrder = RENDER_ORDER_SYSTEM
      group.add(system.mesh)

      atmosphere = new AtmospherePass({ worlds, quality: rimQuality })
      group.add(atmosphere.mesh)

      // §1.8's belt is the dust plane's own records, laid out by the pipeline (§2.1). A dataset with
      // no dust plane is a fixture, not a roster — and the honest response is no belt rather than an
      // empty one, which would report a zero point count that reads as "the belt failed to load".
      const dust = next.planes.find((plane) => plane.kind === 'dust')
      if (dust && dust.starCount > 0) {
        belt = buildBelt({
          plane: dust,
          stars: next.stars,
          planes: next.planes,
          multiverseRadius: next.multiverseRadius,
          // `gl.getPixelRatio()`, read here and re-read every frame in `runFrame`, rather than
          // pushed in by a setter. The ratio changes when the quality ladder moves rung 1 and when
          // the window crosses monitors, and a cached copy is a copy that can be a rung behind --
          // on the one quantity whose whole job is to keep the belt at 2 CSS px.
          pixelRatio: gl.getPixelRatio(),
        })
        belt.renderOrder = RENDER_ORDER_BELT
        group.add(belt)
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

    setSpinAngles: (next) => {
      spinAngleOf = next ?? NO_SPIN
    },

    setTether: (slugs) => {
      if (!slugs) {
        tether.setEnds(null)
        return
      }
      const a = tetherEnd(slugs[0])
      const b = tetherEnd(slugs[1])
      // Both ends or neither. A tether with one composed end would run from a world to the origin,
      // which is the multiverse's centre and is a place — so it draws a plausible ribbon to nowhere.
      tether.setEnds(a && b ? [a, b] : null)
    },

    setRimQuality: (quality) => {
      rimQuality = quality
      atmosphere?.setRimQuality(quality)
    },

    dispose: () => {
      for (const undo of unsubscribes.splice(0)) undo()
      teardownSurfaces()
      releasePool()
      tether.dispose()
      group.remove(tether.ribbon, tether.pads[0], tether.pads[1])
      scene.remove(group)
      if (ownsQueue) queue.dispose()
    },
  }
}
