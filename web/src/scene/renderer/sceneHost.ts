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
 * `ui/Hud` polls at 2 Hz.
 *
 * **The inbound direction is five imperative calls**, driven by store subscriptions rather than by
 * props: `focusStar`, `setFilterMask` (through `bindFilterMask`), `setReducedMotion`,
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
import type { PlaneRecord } from '../../data/types'
import type { SceneNavigation } from '../../navigation/scene'
import { attachCardTier, type CardTierHandle, type PlaneCards, type PlanetLabelState } from '../cards/cardTier'
import { attachMotionSync } from '../motionSync'
import type { PickResult } from '../picking/scenePicker'
import { attachProgramWarmup } from '../platform/attachProgramWarmup'
import type { ProgramWarmupResult } from '../platform/programWarmup'
import { attachPostChain, type PostChainAttachment } from '../post/attachPostChain'
import { QUALITY_TIERS, type QualityTier } from '../quality/adaptiveQuality'
import { attachStarScene, type StarSceneHandle } from '../starScene'
import { BLOOM_INTENSITY } from '../tuning'
import type { SceneResources } from '../useSceneData'

import type { FrameStatsFields, FrameStatsSnapshot } from './frameStats'
import { SceneRenderer, type SceneRendererOptions } from './sceneRenderer'

export interface SceneHostOptions extends SceneRendererOptions {
  /** The boot-time program warm-up's result, for the `?probe=1` seam and the bench (DEC-739). */
  readonly onWarmup?: (result: ProgramWarmupResult) => void
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
  /** Rung 2's third consumer: the field sizes its bloom-source sprites by the same fraction. */
  setStarBloomScale: (scale: number) => void
  /** Rung 3. */
  setThumbnailCapacity: (capacity: number) => void
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
  targets.setStarBloomScale(tier.bloomScale)
  targets.setThumbnailCapacity(tier.thumbnailCapacity)
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
  /** The mutable record the tick writes and one HUD leaf polls at 2 Hz. See `./frameStats`. */
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
  private readonly starSceneHandle: StarSceneHandle
  private cardTierHandle: CardTierHandle | null = null
  private readonly teardown: Array<() => void> = []

  private navigation: SceneNavigation | null = null
  private resources: SceneResources | null = null
  private starsComplete = false
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

    this.starSceneHandle = attachStarScene({
      gl,
      scene,
      camera,
      loop,
      onHover: (pick) => {
        // PRD 5.6.9's planet hover reaches the card tier here rather than through React: a hover
        // changes several times a second while the pointer moves, and routing it through a render
        // is the per-frame re-render review finding R1 is about.
        this.cardTierHandle?.setHoveredPlanet(pick?.kind === 'planet' ? pick.index : -1)
        this.hovered.emit(pick)
      },
      onSelect: (pick) => this.selected.emit(pick),
      onQualityChange: (tier) => this.applyTier(tier),
    })

    // The stats the tick reports outwards, gathered last. `frameMs` and `cpuMs` are the loop's own
    // and are written by `SceneRenderer`'s `onTickEnd` hook, which by construction runs after every
    // phase — including this one.
    this.teardown.push(
      loop.subscribe('quality', () => {
        this.stats.drawn = this.starSceneHandle.drawnStars
        const bloom = this.post.chain.bloomSourceSize
        this.stats.bloomWidth = bloom?.width ?? 0
        this.stats.bloomHeight = bloom?.height ?? 0
        const cards = this.cardTierHandle
        if (cards) {
          const thumbnails = cards.stats
          this.stats.thumbnails = thumbnails.drawn
          this.stats.thumbnailCells = thumbnails.cells
          this.stats.thumbnailCapacity = thumbnails.capacity
          this.stats.thumbnailsFailed = thumbnails.failed
          this.stats.imagesInFlight = cards.imageStats.inFlight
          const bytes = cards.gpuBytes
          this.stats.atlasBytes = bytes.atlas
          this.stats.cardBytes = bytes.card
        }
      }),
    )
  }

  /** The live post chain, for the `?probe=1` seam (PRD 9.1.4's forced-degradation check). */
  get postChain(): PostChainAttachment['chain'] {
    return this.post.chain
  }

  get starScene(): StarSceneHandle {
    return this.starSceneHandle
  }

  get cardTier(): CardTierHandle | null {
    return this.cardTierHandle
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
    this.starSceneHandle.setResources(resources)
    this.buildCardTier()
    this.maybeWarm()
  }

  /** Every record of `stars.bin` is drawable (PRD 8.7.3). Gates the warm-up and the self-check. */
  setStarsComplete(complete: boolean): void {
    if (complete === this.starsComplete) return
    this.starsComplete = complete
    this.starSceneHandle.setStarsComplete(complete)
    this.maybeWarm()
  }

  /**
   * The real navigation, built from `planes.json` and living for the session (PRD 8.7.2).
   *
   * This is where the camera rig arrives, so it is where `attachCameraRig` and `attachMotionSync`
   * happen — and the order they are written in is not the order they run in, which is the point of
   * {@link TICK_PHASES}.
   */
  setNavigation(navigation: SceneNavigation | null, options: { readonly drive?: boolean } = {}): void {
    if (navigation === this.navigation) return
    this.navigation = navigation
    this.buildCardTier()
    if (!navigation || !this.resources) return
    this.teardown.push(
      attachMotionSync(this.renderer.loop, this.resources.table, navigation.rig.motion),
    )
    // The bench flies the camera itself. Attaching the rig as well would put two writers on one
    // camera and the path would stop being the path.
    if (options.drive !== false) {
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
    this.starSceneHandle.setReducedMotion(reduced)
    this.cardTierHandle?.setReducedMotion(reduced)
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
    this.cardTierHandle?.setFocusedStar(star)
  }

  setPlane(plane: PlaneRecord | null): void {
    this.cardTierHandle?.setPlane(plane)
  }

  setCards(cards: PlaneCards): void {
    this.cardTierHandle?.setCards(cards)
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
      setStarBloomScale: (scale) => this.starSceneHandle.setBloomScale(scale),
      // The tier may be announced before the card tier exists; `buildCardTier` re-applies it.
      setThumbnailCapacity: (capacity) => this.cardTierHandle?.setThumbnailCapacity(capacity),
      setGlowQuality: (glow) => this.starSceneHandle.setGlowQuality(glow),
    })

    this.stats.qualityTier = tier.label
    this.stats.qualityChanges = this.qualityChanges
    this.quality.emit({
      tier,
      index: QUALITY_TIERS.indexOf(tier),
      changes: this.qualityChanges,
    })
  }

  private buildCardTier(): void {
    if (this.cardTierHandle || !this.resources || !this.navigation) return
    this.cardTierHandle = attachCardTier({
      gl: this.renderer.renderer,
      scene: this.renderer.scene,
      camera: this.renderer.camera,
      loop: this.renderer.loop,
      resources: this.resources,
      nav: this.navigation,
      labelState: this.labelState,
    })
    // The tier is built after the starting tier was announced, so the rung it missed is applied
    // here rather than waiting for the ladder to move.
    this.cardTierHandle.setThumbnailCapacity(this.tier.thumbnailCapacity)
  }

  private maybeWarm(): void {
    if (this.warmupStarted || !this.resources || !this.starsComplete) return
    this.warmupStarted = true
    this.teardown.push(
      attachProgramWarmup({
        gl: this.renderer.renderer,
        scene: this.renderer.scene,
        camera: this.renderer.camera,
        field: this.resources.field,
        chain: this.post.chain,
        extraSpecs: () => this.cardTierHandle?.card.warmupSpecs ?? [],
        onComplete: (result) => {
          this.warmupResult = result
          this.options.onWarmup?.(result)
        },
      }),
    )
  }

  dispose(): void {
    for (const undo of this.teardown.splice(0)) undo()
    this.cardTierHandle?.dispose()
    this.cardTierHandle = null
    this.starSceneHandle.dispose()
    this.post.dispose()
    this.renderer.dispose()
  }
}
