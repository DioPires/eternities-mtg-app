/**
 * The `?probe=1` seam's installation, next to the interface it fills (review §6.3).
 *
 * `probe.ts` declares what the seam offers; this puts it over the live scene objects. It sits here
 * rather than in `EternitiesScene` because only a URL flag reaches it, and because every line is a
 * read off a ref — none of it belongs near the render path.
 *
 * Every action runs the same code a pointer would: `focusCard` calls the caller's `focusStar`
 * rather than a second implementation of it.
 */

import { useEffect, type MutableRefObject, type RefObject } from 'react'
import type { PerspectiveCamera, ShaderMaterial, Vector2, Vector3, WebGLRenderer } from 'three'

import type { CardRecord } from '../data'

import type { CardTierHandle } from './cards/CardTier'
import { gpuMemoryReport } from './cards/gpuMemory'
import { pickLoadedCard } from './cards/pickCard'
import type { BackingStoreSize } from './platform/backingStore'
import { detectPlatformCapabilities } from './platform/capabilities'
import type { ProgramWarmupResult } from './platform/programWarmup'
import type { PostChain } from './post/postChain'
import { QUALITY_TIERS, type QualityTier } from './quality/adaptiveQuality'
import type { Probe, ProbeState } from './probe'
import type { SceneNavigation } from '../navigation/scene'
import type { StarSceneHandle } from './StarScene'
import type { SceneDataState } from './useSceneData'

/**
 * Everything the seam reads, all of it by reference.
 *
 * Refs rather than values throughout, and that is the contract: the effect below must not
 * re-install when the focused star, the quality tier or the focused plane changes, or the probe
 * would be swapped out from under a driver mid-assertion.
 */
export interface ProbeSeamDeps {
  /** Whether the URL asked for the seam, latched at first render. See `probeRequested`. */
  readonly enabled: boolean
  readonly planes: SceneDataState['planes']
  readonly resources: SceneDataState['resources']
  readonly focusStar: (index: number, planeIndex: number) => void
  /** `?quality=N`, or null on the free ladder. Reported as-is. */
  readonly pinnedTier: number | null
  readonly sceneRef: RefObject<SceneNavigation | null>
  readonly starScene: RefObject<StarSceneHandle | null>
  readonly cardTier: RefObject<CardTierHandle | null>
  readonly cameraRef: RefObject<PerspectiveCamera | null>
  readonly rendererRef: RefObject<WebGLRenderer | null>
  readonly chainRef: RefObject<PostChain | null>
  /** The last `device-pixel-content-box` observation, from `platform/PixelRatioHost` (DEC-739). */
  readonly backingStoreRef: MutableRefObject<BackingStoreSize | null>
  /** What the boot-time program warm-up did, from `platform/ProgramWarmupHost` (DEC-739). */
  readonly warmupRef: MutableRefObject<ProgramWarmupResult | null>
  readonly tierRef: MutableRefObject<QualityTier>
  readonly focusedStarRef: MutableRefObject<number>
  readonly focusedSlugRef: MutableRefObject<string | null>
  readonly cardsRef: MutableRefObject<Map<number, CardRecord>>
  /** Scratch vectors owned by the caller, so this allocates nothing per call. */
  readonly screen: Vector3
  readonly buffer: Vector2
}

export function useProbeSeam(deps: ProbeSeamDeps): void {
  const { enabled, planes, resources, focusStar, screen } = deps

  useEffect(() => {
    if (!enabled || !planes || !resources) return
    const geometry = resources.geometry
    // The uniform the star shader actually samples, not the `motion` argument passed to `update`.
    const motionUniform = (resources.field.points.material as ShaderMaterial).uniforms['uMotion']

    // Read back off the live objects, never off QUALITY_TIERS. See `ProbeState.quality`.
    const qualityState = (): ProbeState['quality'] => {
      const renderer = deps.rendererRef.current
      const size = renderer?.getDrawingBufferSize(deps.buffer)
      const chain = deps.chainRef.current
      // One size, where `Effects.BloomProbe` had to report two — see `ProbeState.bloomSource`.
      const source = chain?.bloomSourceSize
      const band = deps.starScene.current?.qualityThresholds
      const tier = deps.tierRef.current
      return {
        tier: tier.label,
        tierIndex: QUALITY_TIERS.indexOf(tier),
        pinned: deps.pinnedTier,
        pixelRatio: renderer?.getPixelRatio() ?? 0,
        drawingBuffer: { width: size?.x ?? 0, height: size?.y ?? 0 },
        // Null until the chain's first `configure`, which is not the same as "no bloom".
        bloomSource:
          source && source.width > 0 ? { width: source.width, height: source.height } : null,
        bloomLevels: chain?.bloomLevels ?? 0,
        bloomFloatTargets: chain?.floatTargets ?? false,
        thumbnailCapacity: deps.cardTier.current?.stats.capacity ?? 0,
        starsDrawn: geometry.drawCount,
        motion: typeof motionUniform?.value === 'number' ? motionUniform.value : -1,
        refreshMs: band?.refreshMs ?? 0,
        degradeMs: band?.degradeMs ?? 0,
        restoreMs: band?.restoreMs ?? 0,
        // Off the live mesh, so this reports the program that is drawn rather than the one the
        // tier asked for. See `ProbeState.quality.glowShader`.
        glowShader: (resources.field.glow.material as ShaderMaterial).name,
      }
    }

    /** What the GPU answered at boot, plus the one number the app clamped because of it. */
    const platformState = (): ProbeState['platform'] => {
      const renderer = deps.rendererRef.current
      // `detectPlatformCapabilities` caches per renderer, so this is a map lookup — the probe seam
      // is polled by the browser checks and must not re-run a half-float probe each time.
      const capabilities = renderer ? detectPlatformCapabilities(renderer) : null
      const maxPixels = (resources.field.points.material as ShaderMaterial).uniforms['uMaxPixels']
      return {
        webgl2: capabilities?.webgl2 ?? false,
        maxTextureSize: capabilities?.maxTextureSize ?? 0,
        atlasAffordable: capabilities?.atlasAffordable ?? false,
        pointSizeMax: capabilities?.pointSizeRange[1] ?? 0,
        maxArrayTextureLayers: capabilities?.maxArrayTextureLayers ?? 0,
        parallelShaderCompile: capabilities?.parallelShaderCompile ?? false,
        positionMode: resources.positionMode,
        halfFloatProbeOk: capabilities?.halfFloatProbe.ok ?? false,
        halfFloatProbeMs: capabilities?.halfFloatProbe.durationMs ?? 0,
        starMaxPixels: typeof maxPixels?.value === 'number' ? maxPixels.value : -1,
      }
    }

    const state = (): ProbeState => {
      const built = deps.sceneRef.current
      const snap = built?.api.snapshot()
      const handle = deps.cardTier.current
      const memoryNow = gpuMemoryReport(handle?.gpuBytes.atlas ?? 0, handle?.gpuBytes.card ?? 0)
      const focused = deps.focusedStarRef.current
      const record = focused >= 0 ? deps.cardsRef.current.get(focused) : undefined
      const cardState = handle?.card
      const lookAt = built?.rig.lookAt
      const frameOffset =
        cardState?.visible && lookAt
          ? Math.hypot(
              cardState.root.position.x - lookAt.x,
              cardState.root.position.y - lookAt.y,
              cardState.root.position.z - lookAt.z,
            )
          : 0
      return {
        focus: snap?.focus.kind ?? 'none',
        level: snap?.level ?? 'none',
        flying: snap?.flight !== null && snap?.flight !== undefined,
        cameraDistance: built?.rig.distanceToTether ?? 0,
        planeSlug: deps.focusedSlugRef.current,
        cardsLoaded: deps.cardsRef.current.size,
        thumbnails: {
          drawn: handle?.stats.drawn ?? 0,
          cells: handle?.stats.cells ?? 0,
          capacity: handle?.stats.capacity ?? 0,
          requested: handle?.stats.requested ?? 0,
          loaded: handle?.stats.loaded ?? 0,
          failed: handle?.stats.failed ?? 0,
        },
        images: handle?.imageStats ?? {
          inFlight: 0,
          waiting: 0,
          completed: 0,
          failed: 0,
          peakInFlight: 0,
        },
        gpu: {
          atlasBytes: memoryNow.atlasBytes,
          cardBytes: memoryNow.cardBytes,
          totalBytes: memoryNow.totalBytes,
          targetBytes: memoryNow.targetBytes,
          ceilingBytes: memoryNow.ceilingBytes,
          withinTarget: memoryNow.withinTarget,
          withinCeiling: memoryNow.withinCeiling,
        },
        quality: qualityState(),
        platform: platformState(),
        backingStore: deps.backingStoreRef.current,
        programWarmup: deps.warmupRef.current,
        card:
          record && cardState && cardState.visible
            ? {
                name: record.n,
                printings: record.p.length,
                planets: cardState.planetCount,
                overflow: cardState.printingOverflow,
                canFlip: cardState.canFlip,
                flipped: cardState.flipped,
                activePrinting: cardState.activePrinting,
                starIndex: cardState.starIndex,
              }
            : null,
        cardFrameOffset: frameOffset,
        cardEyeDistance:
          cardState?.visible && deps.cameraRef.current
            ? deps.cameraRef.current.position.distanceTo(cardState.root.position)
            : 0,
        cardScreen: cardState?.visible
          ? (() => {
              screen.copy(cardState.root.position).project(deps.cameraRef.current!)
              return { x: (screen.x + 1) / 2, y: (1 - screen.y) / 2 }
            })()
          : null,
      }
    }

    const probe: Probe = {
      state,
      planes: () =>
        planes.planes
          .filter((p) => p.cardCount > 0)
          .sort((a, b) => b.cardCount - a.cardCount)
          .map((p) => ({ slug: p.slug, index: p.index, cardCount: p.cardCount })),
      focusPlane: (slug) => {
        const built = deps.sceneRef.current
        const plane = planes.planes.find((p) => p.slug === slug)
        if (!built || !plane) return false
        built.api.flyToPlane(slug, { reason: 'user' })
        return true
      },
      focusCard: (options = {}) => {
        const best = pickLoadedCard(deps.cardsRef.current, options)
        if (best < 0) return -1
        focusStar(best, geometry.planeRowOf(best))
        return best
      },
      flip: () => {
        const handle = deps.cardTier.current?.card
        if (!handle?.canFlip) return false
        handle.toggleFlip()
        return true
      },
      activatePrinting: (index) => {
        const handle = deps.cardTier.current?.card
        if (!handle?.visible) return false
        handle.setActivePrinting(index)
        return handle.activePrinting === index
      },
      thumbnailStars: () => [...(deps.cardTier.current?.drawnStars ?? [])],
      planetScreen: (index) => {
        const handle = deps.cardTier.current?.card
        const camera = deps.cameraRef.current
        if (!handle?.visible || !camera) return null
        if (!handle.planetWorldPosition(index, screen)) return null
        screen.project(camera)
        if (screen.z >= 1) return null
        return { x: (screen.x + 1) / 2, y: (1 - screen.y) / 2 }
      },
    }
    window.__eternitiesProbe = probe
    return () => {
      delete window.__eternitiesProbe
    }
    // The refs and scratch vectors are stable for the component's life and deliberately absent:
    // see `ProbeSeamDeps`. Only the four values that decide *what* the probe closes over are here.
  }, [enabled, planes, resources, focusStar, screen])
}
