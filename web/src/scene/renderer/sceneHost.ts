/**
 * The whole scene, assembled outside React (review §3.5, §3.6 phase 3).
 *
 * {@link SceneRenderer} owns the canvas, the `WebGLRenderer`, the camera and the tick.
 * `sceneHost` owns everything that subscribes to that tick, and it is the object `app/` and `ui/`
 * hold: one created in `createServices()` next to the navigation host and the router, with the same
 * lifetime as the page.
 *
 * **What this replaces.** `EternitiesScene` was a React component that rendered a `<Canvas>` with
 * seven children, and the seven children *were* the architecture: their mount order was the frame
 * order, their props were the quality ladder's rungs, and the values they sent back up were
 * `useState` calls on the component that owned the canvas — so the ladder changing tier twice a
 * second re-rendered the canvas owner twice a second, with every scene child underneath it (review
 * finding R1). Here the children are seven `attach*` calls whose order is {@link TICK_PHASES}, the
 * rungs are {@link applyTier}, and what goes back out is the mutable `FrameStats` record that
 * `SceneStats`, in `scene/SceneReadout.tsx`, polls at 2 Hz.
 *
 * That poller is a *measurement* surface, not shipped chrome: `SceneReadout` renders only under
 * `EternitiesScene`'s `chrome` prop, which the shell sets to `false` (`App.tsx`) and so does the
 * bench (`bench/BenchScene.tsx`) — it defaults to `true`, so what reaches it is the `?probe=`
 * and self-check compositions. Nothing in `src/ui/` reads `stats` at all. The polled-snapshot
 * *shape* is still what review §3.6 phase 3 item 3 asks for; only the reader is not the HUD.
 *
 * **The inbound direction is five imperative calls**, driven by store subscriptions rather than by
 * props: `focusStar`, `setFilterMask` (through `bindWorldsFilterMask`), `setReducedMotion`,
 * `setQualityCap` and `setLabelsEnabled`. None of them renders anything.
 *
 * **The ladder has exactly one application point.** {@link applyTier} is called by the quality
 * monitor's own subscription, which fires on every *runtime* tier change as well as once for the
 * starting tier. That distinction is the whole of DEC-747's blocking finding: under the previous
 * arrangement the pixel-ratio rung had two sufficient writers, a boot-time one and a mount effect,
 * so a suite that only ever ran under a `?quality=` pin could not tell "the renderer applies the
 * tier" from "something set it once at boot". There is one writer now, it is reached only through a
 * tier announcement, and `test/scene-host.test.ts` drives a tier change through it with no remount.
 */

import type { CameraRig } from '../../camera/rig'
import { attachCameraRig } from '../../camera/attachRig'
import { printingImageKey } from '../../data/images'
import type { SceneNavigation } from '../../navigation/scene'
import {
  attachFocusedCard,
  type FocusedCardHandle,
  type PlaneCards,
  type PlanetLabelState,
} from '../cards/focusedCardHost'
import { attachMotionSync } from '../motionSync'
import type { PickResult } from '../picking/scenePicker'
import { attachProgramWarmup } from '../platform/attachProgramWarmup'
import type { ProgramWarmupResult } from '../platform/programWarmup'
import { attachPostChain, type PostChainAttachment } from '../post/attachPostChain'
import { QUALITY_TIERS, type QualityTier } from '../quality/adaptiveQuality'
import { attachScenePicking, type ScenePickingHandle } from '../input/attachScenePicking'
import type { IdPicker } from '../picking/idPicker'
import { attachSceneFrame, type SceneFrameHandle } from '../sceneFrame'
import { BLOOM_INTENSITY } from '../tuning'
import type { SceneResources } from '../useSceneData'
import { attachWorlds, type WorldsAttachment, type WorldsData } from '../worlds/attachWorlds'
import type { WorldPlane } from '../worlds/worldSource'
import type { WorldCard } from '../worlds/worldSurface'
import type { WorldsProbeSource } from '../worlds/worldsProbe'

import type { FrameStatsFields, FrameStatsSnapshot } from './frameStats'
import { SceneRenderer, type SceneRendererOptions } from './sceneRenderer'

export interface SceneHostOptions extends SceneRendererOptions {
  /** The boot-time program warm-up's result, for the `?probe=1` seam and the bench (DEC-739). */
  readonly onWarmup?: (result: ProgramWarmupResult) => void
  /**
   * Injected by the tests, for the same reason and on the same terms as `createRenderer` above it:
   * a pick is a render pass, so the whole of the input layer's routing — hover to §1.10's label,
   * click to the selection card focus runs on — was reachable only from e2e (DEC-852).
   *
   * That is not a hypothetical gap. It is how `starScene.ts` came to own every pointer listener in
   * the app while worlds spec §3.2 listed it for deletion, with nothing in the unit suite able to
   * notice. `test/scene-host-picking.test.tsx` is what this seam is for.
   */
  readonly createPicker?: () => IdPicker
}

/**
 * The four rungs of PRD 8.5.11, as an interface over whatever applies them.
 *
 * Named and exported so the fan-out can be driven by a test without a GL context. The ladder's
 * invariant — established in DEC-739 and corrected in DEC-756 — is **one knob per rung**, and rung 2
 * moves two fields that belong to the same knob (the bloom chain's resolution and its mip count).
 * `test/scene-host.test.ts` walks all four rungs over a recorder and asserts each one moves what it
 * names and nothing else.
 */
export interface QualityRungTargets {
  /** Rung 1. */
  setPixelRatioCap: (cap: number) => void
  /** Rung 2, both halves. */
  setBloomScale: (scale: number) => void
  setBloomLevels: (levels: number) => void
  /**
   * Rung 3 — the resident card-image budget (`QUALITY_KNOBS`, DEC-753), which worlds spends on
   * §1.12's art pool. The galaxy's half of this knob, PRD 8.5.8's thumbnail atlas, retired at the
   * cutover (DEC-752) and its no-op target with DEC-868: the field went and the knob did not move.
   */
  setArtPoolLayers: (layers: number) => void
  /** Rung 4. */
  setGlowQuality: (quality: QualityTier['glow']) => void
}

/**
 * Apply one tier to the four rungs.
 *
 * There is exactly one call site, {@link SceneHost.applyTier}, and it is reached only from a tier
 * announcement. That is DEC-747's blocking finding answered at the shape level: the previous
 * arrangement had a boot-time writer and a mount-effect writer for rung 1, each alone sufficient
 * under a `?quality=` pin, so no single mutation could turn the suite red.
 */
export function applyQualityTier(tier: QualityTier, targets: QualityRungTargets): void {
  targets.setPixelRatioCap(tier.pixelRatioCap)
  targets.setBloomScale(tier.bloomScale)
  targets.setBloomLevels(tier.bloomLevels)
  targets.setArtPoolLayers(tier.artPoolLayers)
  targets.setGlowQuality(tier.glow)
}

/** A listener list that never allocates on notify and returns its own removal. */
function listeners<T>(): {
  add: (listener: (value: T) => void) => () => void
  emit: (value: T) => void
} {
  const set = new Set<(value: T) => void>()
  return {
    add: (listener) => {
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    emit: (value) => {
      for (const listener of set) listener(value)
    },
  }
}

/**
 * The scene, as one object.
 *
 * Every member is either a plain-data getter or an imperative setter. Nothing here returns a
 * three.js type except {@link renderer}, which the modules under `scene/` legitimately need and
 * which `eslint.config.js` stops `ui/` and `app/` from unwrapping.
 */
export class SceneHost {
  readonly renderer: SceneRenderer
  /** The mutable record the tick writes and `SceneStats` polls at 2 Hz. See `./frameStats`. */
  readonly stats: FrameStatsFields
  /** PRD 5.6.9's hover label position, written by the `cards` phase and read by the overlay. */
  readonly labelState: PlanetLabelState = { visible: false, x: 0, y: 0, printing: -1 }

  /**
   * PRD 5.4.12 hover, PRD 5.7.2 click and PRD 8.5.11's tier, published outwards.
   *
   * Listener lists rather than constructor callbacks because the host is built in
   * `createServices()`, before React exists, and the things that want to hear about a hover are
   * React components that mount later. Subscribing is how a later arrival reaches an earlier owner
   * without the owner having to be re-created — the same argument `navigation/host.ts` makes.
   */
  readonly hovered = listeners<PickResult>()
  readonly selected = listeners<PickResult>()
  readonly quality = listeners<{ tier: QualityTier; index: number; changes: number }>()

  private readonly options: SceneHostOptions
  private readonly post: PostChainAttachment
  private readonly pickingHandle: ScenePickingHandle
  private readonly sceneFrameHandle: SceneFrameHandle
  private readonly worldsAttachment: WorldsAttachment
  private focusedCardHandle: FocusedCardHandle | null = null
  private readonly teardown: Array<() => void> = []

  private navigation: SceneNavigation | null = null
  private resources: SceneResources | null = null
  /**
   * The focused plane's cards, as {@link setCards} last supplied them.
   *
   * **Two readers, one load.** PRD 8.7.6 fetches a plane's shards the moment it becomes focus, and
   * on the worlds path that is the same moment its world is the one filling the frame — so §1.6's
   * art stream reads the printing ids off the load that already exists rather than opening a second
   * one. The card tier draws the same records as thumbnails on the galaxy path.
   *
   * Empty until the first shard lands, which is the cold start {@link worldCardOf} answers `null`
   * for: a world at system distance is swatch-only, and that is exactly §1.5's far rung.
   */
  private worldCards: PlaneCards = { get: () => null }
  /** The last `drive` the caller asked for. See {@link attachDrive}. */
  private driveRig = true
  /** {@link attachDrive}'s one-shot guard, the same shape as `focusedCardHandle` is for the tier. */
  private driveAttached = false
  private starsComplete = false
  /**
   * PRD 5.9's setting, held so {@link buildFocusedCard} can replay it (DEC-751).
   *
   * The same reason {@link tier}'s thumbnail capacity is held and replayed: the card tier is built
   * late, and every `setX` that arrives before it exists hits a `?.` and is gone.
   */
  private reducedMotion = false
  private warmupStarted = false
  private warmupResult: ProgramWarmupResult | null = null
  private tier: QualityTier = QUALITY_TIERS[0]!
  private tierChanges = -1
  private labelsEnabled = true

  constructor(options: SceneHostOptions = {}) {
    this.options = options
    this.renderer = new SceneRenderer(options)
    this.stats = this.renderer.stats

    const { renderer: gl, scene, camera, loop } = {
      renderer: this.renderer.renderer,
      scene: this.renderer.scene,
      camera: this.renderer.camera,
      loop: this.renderer.loop,
    }

    // `draw` — subscribed before the star field so that a `draw` step exists from the first tick.
    // Phase order is the list, not the subscription order, so this is presentation only.
    this.post = attachPostChain(gl, scene, camera, loop)

    /**
     * The pointer input layer (DEC-852), attached **before** the frame below and disposed after it.
     *
     * The order is a **construction dependency**, and the type is what enforces it: this handle is
     * a required argument of `attachSceneFrame`, which holds it for PRD 8.5.7's mirror and for its
     * own `focusedIndex` getter, so it has to exist by the time that call runs. That is the whole
     * of the reason.
     *
     * The `pick` phase's subscription order between the two is *not* load-bearing (DEC-853): that
     * phase only issues `runPick(false)` (`input/attachScenePicking.ts:273`), `focused` is written
     * only under `if (select)` (`:199-200`), which is reached only from `pointerup` (`:236`), and
     * `runPick` is `async` — so the mirror cannot observe the frame's own pick in either order.
     * `renderer/frameLoop.ts` says the same thing in general: `TICK_PHASES` is the order, so a
     * subscription order is not one.
     *
     * This is the half of the old `starScene.ts` that worlds spec §3.2 did *not* delete: every
     * pointer listener in the app is here, and so is the only emitter of the hover the printing
     * ring's label reads and the selection card focus runs on.
     */
    this.pickingHandle = attachScenePicking({
      gl,
      scene,
      camera,
      loop,
      // Spread rather than assigned: under `exactOptionalPropertyTypes` an explicit `undefined`
      // is not the same as an absent key, and absent is what selects the product's own picker.
      ...(options.createPicker ? { picker: options.createPicker() } : {}),
      onHover: (pick) => {
        // PRD 5.6.9's planet hover reaches the card tier here rather than through React: a hover
        // changes several times a second while the pointer moves, and routing it through a render
        // is the per-frame re-render review finding R1 is about.
        this.focusedCardHandle?.setHoveredPlanet(pick?.kind === 'planet' ? pick.index : -1)
        this.hovered.emit(pick)
      },
      onSelect: (pick) => this.selected.emit(pick),
    })

    // The frame's shared machinery — the plane table's clock, the quality monitor, PRD 8.5.7's
    // mirror and the sky (DEC-752). After the picker because it takes the handle as an argument,
    // not because of the `pick` phase's order between them: that order is not load-bearing, for
    // the reason given above.
    this.sceneFrameHandle = attachSceneFrame({
      gl,
      scene,
      loop,
      picking: this.pickingHandle,
      onQualityChange: (tier) => this.applyTier(tier),
    })
    // The `worlds` phase (spec §1.2). Attached unconditionally and empty until `setWorldData`: a
    // phase whose subscriber arrives with the data is a phase that can end up with none at all,
    // which is DEC-761's F1 in miniature. Nothing is allocated here beyond the art pool, and on a
    // v2 dataset nothing ever composes — §3.2's "the two coexist at zero cost".
    //
    // **Before the announcement below, for the same reason the star field is assigned before it**
    // (DEC-751): rung 3 now reaches the worlds art pool (§1.12), so an announcement that ran first
    // would reach a `worldsAttachment` that does not exist. Ordering it here rather than guarding
    // the setter with `?.` is deliberate — a dropped starting rung is not a crash, it is a page
    // pinned to `?quality=4` that quietly allocates rung 0's 48 MiB pool, which is precisely the
    // silent-wiring class DEC-761's F1 and DEC-747's two-writer finding are both about.
    //
    // **`cardOf` is not optional in the product, whatever its type says.** It is the only thing that
    // turns §1.6's admission into a fetch: without it `buildWorldSource` defaults the lookup to
    // `() => null`, `WorldSurface` finds no printing for any cell, and the art stream is never
    // *asked* — a globe of swatches that draws correctly, errors nowhere and scores W4 at 0.0% on
    // every world in every configuration (DEC-772). The default exists for the cold start, where a
    // world's shards have genuinely not landed; omitting the argument makes the cold start permanent.
    this.worldsAttachment = attachWorlds({
      gl,
      scene,
      camera,
      loop,
      cardOf: (plane, card) => this.worldCardOf(plane, card),
    })

    // **After the assignments above, never inside them.** `applyTier` pushes the tier at the star
    // field, so a starting announcement that fired from inside `attachStarScene` would reach a
    // handle that does not exist yet. See `SceneFrameHandle.announceStartingTier`.
    this.sceneFrameHandle.announceStartingTier()

    // The stats the tick reports outwards, gathered last. `frameMs` and `cpuMs` are the loop's own
    // and are written by `SceneRenderer`'s `onTickEnd` hook, which by construction runs after every
    // phase — including this one.
    this.teardown.push(
      loop.subscribe('quality', () => {
        // The star field's drawable count retired with it (DEC-752); the stars.bin records that
        // still load are the worlds' data layer, and the field stays at its structural 0.
        const bloom = this.post.chain.bloomSourceSize
        this.stats.bloomWidth = bloom?.width ?? 0
        this.stats.bloomHeight = bloom?.height ?? 0
        const cards = this.focusedCardHandle
        if (cards) {
          // The four thumbnail counters and `atlasBytes` keep their zero defaults: the tier and its
          // atlas retired at the cutover (DEC-752). The FIELDS stay because `ProbeState` and
          // `SceneReadout` read them, and a real 0 is honest where dropping the keys would be a
          // probe-surface change no criterion asked for.
          this.stats.imagesInFlight = cards.imageStats.inFlight
          this.stats.cardBytes = cards.gpuBytes.card
        }
      }),
    )
  }

  /** The live post chain, for the `?probe=1` seam (PRD 9.1.4's forced-degradation check). */
  get postChain(): PostChainAttachment['chain'] {
    return this.post.chain
  }

  /** The frame's shared machinery: clock, quality monitor, focused-star mirror (DEC-752). */
  get sceneFrame(): SceneFrameHandle {
    return this.sceneFrameHandle
  }

  get focusedCard(): FocusedCardHandle | null {
    return this.focusedCardHandle
  }

  get statsSnapshot(): FrameStatsSnapshot {
    return this.stats
  }

  get qualityTier(): QualityTier {
    return this.tier
  }

  /** How many times the monitor has changed tier this session. The starting announcement is not one. */
  get qualityChanges(): number {
    return Math.max(0, this.tierChanges)
  }

  get programWarmup(): ProgramWarmupResult | null {
    return this.warmupResult
  }

  /** Put the canvas in the page and start the tick. */
  mount(container: HTMLElement): void {
    this.renderer.mount(container)
  }

  unmount(): void {
    this.renderer.unmount()
  }

  /**
   * `planes.json` and `stars.bin` have landed.
   *
   * The star field's objects go into the scene here; the card tier waits for the navigation too,
   * because it reads the rig's motion mirror every tick.
   */
  setResources(resources: SceneResources | null): void {
    if (resources === this.resources) return
    this.resources = resources
    // The star **data** layer, straight to the input layer rather than through the field: a pick
    // resolves against the buffer and the plane table, both of which outlive §3.2's deletion of the
    // field's objects (DEC-852).
    this.pickingHandle.setSources(resources)
    this.sceneFrameHandle.setResources(resources)
    // §1.3's spin, from the **plane table's** clock (DEC-750). `PlaneTable.advance` integrates it in
    // the `planeTable` phase and `motionSync` mirrors it into the camera rig, and the `worlds` phase
    // runs after both — so a world's orientation and the position PRD 8.5.7's CPU mirror flies the
    // camera to are the same frame's. A second integrator here would put the cell under the reticle
    // somewhere the camera never goes, and the drift would grow with session length.
    this.worldsAttachment.setSpinAngles(
      resources ? (index) => resources.table.planes[index]?.spinAngle ?? 0 : null,
    )
    this.buildFocusedCard()
    this.attachDrive()
    this.maybeWarm()
  }

  /**
   * The worlds roster (spec §1.2), or `null` to tear it down.
   *
   * All three artefacts at once — `planes.json`'s records, the decoded `stars.bin` and
   * `swatches.bin` — because two of them arrive in an order `useSceneData` does not control and a
   * partially-composed roster is not a state worth representing. The caller passes non-`null` only
   * once it holds all three; on a v2 dataset it never does, and nothing is allocated.
   */
  setWorldData(data: WorldsData | null): void {
    this.worldsAttachment.setData(data)
  }

  /**
   * The composed world's `?probe=` source (spec §3.1), or `null`.
   *
   * A method rather than a value: the world the payload describes changes as the camera flies, and
   * the seam installs this as a getter so a driver is never holding a stale one mid-assertion.
   *
   * `slug` names the world to report, which is how §3.1's per-plane tour gets the plane it flew to
   * rather than the one that happens to be nearest in its own radii (DEC-785 F1); `undefined` comes
   * back when the roster has no such world. See {@link WorldsAttachment.probeSource}.
   */
  worldsProbeSource(slug?: string): WorldsProbeSource | null | undefined {
    return this.worldsAttachment.probeSource(slug)
  }

  /** The worlds pass itself, for the tests and for the legs that add passes beside it. */
  get worlds(): WorldsAttachment {
    return this.worldsAttachment
  }

  /** Every record of `stars.bin` is drawable (PRD 8.7.3). Gates the warm-up and the self-check. */
  setStarsComplete(complete: boolean): void {
    if (complete === this.starsComplete) return
    this.starsComplete = complete
    this.maybeWarm()
  }

  /**
   * The real navigation, built from `planes.json` and living for the session (PRD 8.7.2).
   *
   * This is where the camera rig arrives, so the attaching happens in {@link attachDrive} — which
   * this calls unconditionally, because the navigation and the resources arrive in an order this
   * method does not get to choose. See that method's header; it is DEC-761's F1.
   */
  setNavigation(navigation: SceneNavigation | null, options: { readonly drive?: boolean } = {}): void {
    // Recorded before the identity check rather than after it. `drive` is a property of the
    // *caller's intent*, not of the navigation object: `EternitiesScene` passes the same `scene`
    // with `drive: bench === null`, and the bench's own prop is an object literal, so that effect
    // re-fires with an unchanged `navigation` on every render of `BenchScene`.
    this.driveRig = options.drive !== false
    if (navigation !== this.navigation) {
      this.navigation = navigation
      this.buildFocusedCard()
    }
    this.attachDrive()
  }

  /**
   * Subscribe the `motionSync` and `rig` phases, once, as soon as both inputs exist.
   *
   * **This is idempotent and called from both setters on purpose, and that is the whole finding.**
   * It used to live inline in `setNavigation`, which latched `this.navigation` and *then* returned
   * early if the resources had not landed yet — so the identity guard at the top of that method
   * blocked every later retry, and the `rig` phase ended up with no subscriber at all. The camera
   * then never moves: `attachCameraRig` is the only thing that writes the camera's position and
   * calls `updateMatrixWorld`, so the view sits at its construction distance for the whole session.
   *
   * It worked only by coincidence of two unrelated facts — `useSceneData` publishes `planes` and
   * `resources` in one atomic `patch`, and `EternitiesScene` happens to declare its `setResources`
   * effect above its `setNavigation` one. Swapping those two adjacent effects froze the camera with
   * the entire suite still green, because nothing tested this at all.
   * `test/scene-host-drive.test.tsx` now drives both arrival orders.
   *
   * The guard is `driveAttached` rather than `navigation && resources`, matching
   * {@link buildFocusedCard} two methods down: both are one-shot gates over the same pair of inputs,
   * and the pair completes in whichever setter is called second. A consequence worth stating: the
   * `drive` mode is fixed at the moment the pair completes. Nothing re-attaches the rig if a caller
   * later flips `drive`, and no caller does — since item 4 the bench lives in its own Vite entry,
   * so a single page is either the product (always `drive: true`) or the bench (always `false`).
   */
  private attachDrive(): void {
    if (this.driveAttached || !this.resources || !this.navigation) return
    this.driveAttached = true
    const navigation = this.navigation
    this.teardown.push(
      attachMotionSync(this.renderer.loop, this.resources.table, navigation.rig.motion),
    )
    // §1.2's centre, from the rig's own motion mirror (DEC-804). `SceneMotion.planePosition` is PRD
    // 5.7.1's definition of a plane's tether point — `home`, plus PRD 5.3.15's drift, rotated by
    // PRD 8.5.3's multiverse angle — and the line above has just made that mirror the plane table's.
    // So the worlds scene and the camera now read one position from one clock.
    //
    // **Here, with `attachMotionSync`, and not in `setResources` beside `setSpinAngles`.** The spin
    // angles come off the table directly; this needs the mirror, which belongs to the navigation, and
    // this method is the one place both inputs are known to exist. The bench takes it too: `driveRig`
    // gates the rig, not the clock, and a bench flying its own camera against unrotated worlds would
    // be measuring a scene the product never draws.
    //
    // A dropped write here is DEC-804 restored in full silence — see `centre.ts` on `PLANE_HOME`.
    // `worlds-centre.test.ts` drives this method rather than `attachWorlds`, so the wiring is what
    // is under test and not the setter.
    const motion = navigation.rig.motion
    this.worldsAttachment.setPlaneCentres((plane, out) => {
      // `planePosition` writes into `out` and returns it as the rig's allocation-free `MutVec3`
      // (PRD 7.3.2), which is structurally a `Vector3`'s `{x, y, z}` but not one. The write is the
      // contract; `out` is returned so callers can chain.
      motion.planePosition(out, plane)
      return out
    })
    // PRD 5.3.13/8.5.3's rotation for §1.8's belt, off the **same mirror and the same field** the
    // line above rotates every world by (DEC-814). A getter rather than a pushed number because the
    // `worlds` phase runs after `motionSync` in the same frame: read at subscription time this would
    // be the constant zero, and read by a second accumulator it would be a second copy of the motion
    // function. See `centre.ts`.
    //
    // A dropped write here is DEC-813 restored in full silence — the belt reverts to
    // `NO_MULTIVERSE_ROTATION` and shears a full turn against the roster every 20 minutes.
    this.worldsAttachment.setMultiverseAngle(() => motion.multiverseRotation)
    // The bench flies the camera itself. Attaching the rig as well would put two writers on one
    // camera and the path would stop being the path.
    if (this.driveRig) {
      this.teardown.push(
        attachCameraRig({
          rig: navigation.rig,
          nav: navigation.api,
          camera: this.renderer.camera,
          domElement: this.renderer.canvas,
          loop: this.renderer.loop,
        }),
      )
    }
  }

  /** The rig, for the label overlay's projector. `null` until `planes.json` lands. */
  get rig(): CameraRig | null {
    return this.navigation?.rig ?? null
  }

  // --- The five inbound calls of review §3.6 phase 3, item 3 -----------------------------------

  /** PRD 5.9, from the settings store laid over the OS preference. */
  setReducedMotion(reduced: boolean): void {
    // Recorded before it is forwarded, because the card tier may not exist yet. See
    // {@link reducedMotion} and {@link buildFocusedCard}.
    this.reducedMotion = reduced
    // PRD 5.9 reaches the pick too: §1.11's plane radius grows with motion, so a frozen table has a
    // different pick target from a turning one.
    this.pickingHandle.setReducedMotion(reduced)
    this.sceneFrameHandle.setReducedMotion(reduced)
    this.focusedCardHandle?.setReducedMotion(reduced)
    this.navigation?.api.setReducedMotion(reduced)
  }

  /** PRD 6.10.1's labels toggle. Read by the `labels` phase; see `labels/attachPlaneLabels`. */
  setLabelsEnabled(enabled: boolean): void {
    this.labelsEnabled = enabled
  }

  get labelsOn(): boolean {
    return this.labelsEnabled
  }

  /** PRD 6.10.1's bloom setting, resolved to an intensity by `BLOOM_INTENSITY_STEPS`. */
  setBloomIntensity(intensity: number = BLOOM_INTENSITY): void {
    this.post.setBloomIntensity(intensity)
  }

  /** PRD 5.6.1: the star the card level is focused on, or -1. */
  setFocusedStar(star: number): void {
    this.focusedCardHandle?.setFocusedStar(star)
  }

  setCards(cards: PlaneCards): void {
    // Latched before the delegation, and unconditionally: the card tier does not exist until the
    // navigation and the resources have both landed, and a worlds page whose art stream waited on
    // the *thumbnail* tier's construction would be a second ordering hazard of the kind DEC-761's
    // F1 already cost a frozen camera.
    this.worldCards = cards
    this.focusedCardHandle?.setCards(cards)
  }

  /**
   * §1.6's printing for one cell of one world, or `null` while that world's shards have not landed.
   *
   * **The two indices meet at `starOffset`.** A shard is keyed by *global* star index and a world's
   * `card` is local to it, so the join is `plane.starOffset + card` — the same multiverse-wide
   * identity `swatches.bin` is encoded in star order against (§2.2) and the same one the art pool
   * keys on (`WorldSurfaceSource.artKeyBase`). That is also what makes holding a single plane's
   * cards safe for a roster of 45: the windows into `stars.bin` do not overlap, so a lookup for a
   * world whose shards are not loaded **misses** rather than answering some other world's card.
   *
   * **Printing index 0, deliberately, and it is not "the debut printing".** `p` is sorted by the
   * *printing's* set release date (data contract §8.3), so `p[0]` is the earliest-*released*
   * printing and a promo or a list reprint whose set shipped earlier sorts ahead of the set the card
   * first appeared in. The reason to take it is not chronology: the pipeline's swatch stage and the
   * shard writer share one `printing_order`, so `p[0]` is the printing whose `art_crop` §2.2's 2x2
   * statistic was computed from, and `p[0][5]` is the credit the cell carries (contract §5.1, §9).
   * Any other index would cross-fade a cell out of one printing's swatch and into another
   * printing's art, and would credit an artist who did not paint what is on screen.
   */
  private worldCardOf(plane: WorldPlane, card: number): WorldCard | null {
    const record = this.worldCards.get(plane.starOffset + card)
    const printing = record?.p[0]
    // `printingImageKey`, not `printing[0]`/`printing[3]` by hand (DEC-777 N5): indices 0, 2 and 4
    // are all `string`, so a slot swap here is invisible to `tsc` and would surface only as a 404.
    // `data/images` owns that pair, and it is the same pair `printingImageUri` reads.
    return printing ? printingImageKey(printing) : null
  }

  /**
   * PRD 8.5.11, applied. One knob per rung, all four from one announcement.
   *
   * Called by the quality monitor's subscription — once for the starting tier, and again on every
   * runtime change. Nothing else may call it: two authorities for the tier is how a caller ends up
   * rendering tier 0's `bloomScale` into tier 2's targets.
   */
  private applyTier(tier: QualityTier): void {
    this.tier = tier
    this.tierChanges += 1
    applyQualityTier(tier, {
      // The renderer resolves the cap against `devicePixelRatio` and re-resolves it on a monitor
      // change; see `SceneRenderer.setPixelRatioCap`.
      setPixelRatioCap: (cap) => this.renderer.setPixelRatioCap(cap),
      setBloomScale: (scale) => this.post.setBloomScale(scale),
      setBloomLevels: (levels) => this.post.setBloomLevels(levels),
      // §1.12's art pool: the worlds spend of rung 3, held by the attachment until a roster composes.
      setArtPoolLayers: (layers) => this.worldsAttachment.setArtLayers(layers),
      // §1.12 row 4: *"cheap rim, **on the same knob**"*. The rim's knob was built (R2) and its
      // docblock left the line here to R3, which never landed it — so on every worlds page tier 4
      // cheapened the galaxy's glow and left the rim at full cost (DEC-752). One knob, fanned out
      // here, keeps `applyQualityTier` the ladder's single application point (DEC-747).
      setGlowQuality: (glow) => this.worldsAttachment.setRimQuality(glow),
    })

    this.stats.qualityTier = tier.label
    this.stats.qualityChanges = this.qualityChanges
    this.quality.emit({
      tier,
      index: QUALITY_TIERS.indexOf(tier),
      changes: this.qualityChanges,
    })
  }

  private buildFocusedCard(): void {
    if (this.focusedCardHandle || !this.resources || !this.navigation) return
    this.focusedCardHandle = attachFocusedCard({
      gl: this.renderer.renderer,
      scene: this.renderer.scene,
      camera: this.renderer.camera,
      loop: this.renderer.loop,
      resources: this.resources,
      labelState: this.labelState,
    })
    /*
     * And PRD 5.9's setting, for exactly the same reason (DEC-751).
     *
     * `setReducedMotion` runs from a mount effect, long before `planes.json` lands and this tier
     * is built, so its `this.focusedCardHandle?.` was a no-op for every user whose preference was
     * already set when the page loaded — which is every user who has the preference at all. The
     * tier then kept its own `reducedMotion = false` default for the rest of the session, and the
     * card went on tilting and the ring went on orbiting.
     *
     * **It could only ever come right by accident**: the value is re-sent on *change*, so the one
     * way to get a correct scene was to toggle the OS setting after the scene had loaded. That is
     * why a browser check could confirm the setting "works" and the shipped path still be wrong —
     * measured both ways in DEC-751, frozen = false before load and true after.
     */
    this.focusedCardHandle.setReducedMotion(this.reducedMotion)
  }

  private maybeWarm(): void {
    if (this.warmupStarted || !this.resources || !this.starsComplete) return
    this.warmupStarted = true
    this.teardown.push(
      attachProgramWarmup({
        gl: this.renderer.renderer,
        scene: this.renderer.scene,
        camera: this.renderer.camera,
        chain: this.post.chain,
        extraSpecs: () => this.focusedCardHandle?.card.warmupSpecs ?? [],
        onComplete: (result) => {
          this.warmupResult = result
          this.options.onWarmup?.(result)
        },
      }),
    )
  }

  dispose(): void {
    for (const undo of this.teardown.splice(0)) undo()
    this.focusedCardHandle?.dispose()
    this.focusedCardHandle = null
    this.worldsAttachment.dispose()
    this.sceneFrameHandle.dispose()
    this.pickingHandle.dispose()
    this.post.dispose()
    this.renderer.dispose()
  }
}
