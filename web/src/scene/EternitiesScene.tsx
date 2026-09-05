/**
 * The scene. One canvas, one camera, one picker, every tier.
 *
 * Phases 2a and 2b each shipped a harness that stood in for the other's half — 2a flew a
 * development orbit control over a real star field, 2b flew the real camera rig over Phase 0's
 * backdrop — and each phase's documentation said the other would replace it. Neither did, so the
 * merge that brought them together left `App` routing between two scenes and recorded the join as
 * Phase 3's (DEC-628's carry-forward on DEC-590). This is that join, and Phase 3's exit criterion —
 * "the full multiverse → card journey works end to end" — is not reachable without it.
 *
 * What the fold actually resolved, since each of these was a real fork:
 *
 *  - **The camera.** 2a's `OrbitControls` was a development stand-in; the rig wins, driven from
 *    `CameraRigController` on the renderer's own clock (PRD 5.7, 8.4.5).
 *  - **The picker.** 2b's `harness/pick.ts` projected plane centres and could not see a star; 2a's
 *    id buffer is exact and picks stars, thumbnails, planets and — through the plane raycast it
 *    falls back to — planes (PRD 8.5.6). The id buffer wins, and the projection picker is gone.
 *  - **The backdrop.** `HelloScene` is gone; the star field is the scene.
 *  - **Reduced motion.** One hook (`scene/useReducedMotion`), feeding both the shader's `uMotion`
 *    and the navigation contract's `setReducedMotion`.
 *  - **The clock.** The plane table and the camera's motion mirror were integrating the same angles
 *    separately. The table is now the single clock and `MotionSync` mirrors it into the rig every
 *    frame, before the rig reads a tether. See `camera/motion.ts`.
 *
 * What is deliberately *not* folded in is Phase 2a's bench and GPU self-check harness. Both drive
 * the camera themselves — the bench flies a scripted path, the self-check holds the field still and
 * reads pixels back — so they cannot share a scene with a rig that is also flying it, and the
 * committed bench baseline was measured against that harness. `App` still routes `?bench`, `?hold`
 * and `?selfcheck` there, and PRD 9.1.2's real `/bench` route is Phase 6's.
 *
 * The overlay here is the two or three controls needed to fly the scene and read its state, exactly
 * as the two harnesses were. PRD section 6's HUD, panels and search are Phase 4's (DEC-589).
 */

import { Canvas, useFrame } from '@react-three/fiber'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { NoToneMapping, Vector3, type PerspectiveCamera } from 'three'

import { CameraRigController } from '../camera/CameraRigController'
import type { SceneMotion } from '../camera/motion'
import {
  BLIND_ETERNITIES_SLUG,
  cardBackImageUri,
  dataRoot,
  type CardRecord,
  type PlaneRecord,
  type PlaneShardFile,
} from '../data'
import { PlaneLabels } from '../labels/PlaneLabels'
import { createSceneNavigation, type SceneNavigation } from '../navigation/scene'
import type { NavigationSnapshot } from '../navigation/types'
import { createPlaneDetailLoader } from '../plane-detail/client'

import { CameraReadout } from './CameraReadout'
import { CardTier, type CardTierHandle, type PlaneCards, type PlanetLabelState } from './cards/CardTier'
import { formatMb, gpuMemoryReport } from './cards/gpuMemory'
import { Effects } from './Effects'
import { sceneErrors, type SceneDataError } from './errors'
import type { PickResult } from './picking/scenePicker'
import { probeRequested, type Probe, type ProbeState } from './probe'
import { QUALITY_TIERS, type QualityTier } from './quality/adaptiveQuality'
import { StarScene, type StarSceneHandle } from './StarScene'
import type { PlaneTable } from './starfield/planeTable'
import { SKY_COLOUR } from './tuning'
import { useReducedMotion } from './useReducedMotion'
import { useSceneData } from './useSceneData'

const FOV = 55

/**
 * The one place the two clocks are reconciled, mounted between the star field and the camera rig so
 * that R3F runs it in exactly that order.
 *
 * Per frame: the table has already advanced (`StarScene`), so its time, its multiverse angle and
 * its per-plane spin angles are copied into the rig's motion mirror; and PRD 5.6.6's eased spin
 * scale, which the rig owns because it knows what is focused, is pushed the other way into the
 * table so the shader stops the same plane the tether does.
 */
function MotionSync({ table, motion }: { table: PlaneTable; motion: SceneMotion }): null {
  useEffect(() => {
    motion.setExternalClock(true)
    return () => {
      motion.setExternalClock(false)
    }
  }, [motion])

  useFrame(() => {
    motion.syncClock(table.time, table.multiverseAngle)
    for (let row = 0; row < table.planes.length; row += 1) {
      const state = table.planes[row]!
      motion.syncSpin(row, state.spinAngle)
      table.setSpinScale(row, motion.spinScaleOf(row))
    }
  })
  return null
}

/** PRD 5.6.9's hover label: written by the frame loop, read by its own rAF (PRD 7.3.3). */
function PlanetHoverLabel({
  state,
  text,
}: {
  state: PlanetLabelState
  text: (printing: number) => string
}): ReactElement {
  const node = useRef<HTMLDivElement>(null)
  const shown = useRef(-1)

  useEffect(() => {
    let handle = 0
    const tick = (): void => {
      handle = requestAnimationFrame(tick)
      const element = node.current
      if (!element) return
      if (!state.visible) {
        if (shown.current !== -1) {
          element.style.opacity = '0'
          shown.current = -1
        }
        return
      }
      element.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`
      if (shown.current !== state.printing) {
        element.textContent = text(state.printing)
        element.style.opacity = '1'
        shown.current = state.printing
      }
    }
    handle = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(handle)
    }
  }, [state, text])

  return <div ref={node} className="planet-label" data-testid="planet-label" />
}

export function EternitiesScene(): ReactElement {
  const data = useSceneData()
  const reducedMotion = useReducedMotion()

  const [snapshot, setSnapshot] = useState<NavigationSnapshot | null>(null)
  const [tier, setTier] = useState<{ tier: QualityTier; changes: number }>({
    tier: QUALITY_TIERS[0]!,
    changes: 0,
  })
  const [hover, setHover] = useState<PickResult>(null)
  const [toast, setToast] = useState<SceneDataError | null>(null)
  const [detail, setDetail] = useState<{ slug: string; cards: number; shards: number } | null>(null)
  const [focusedStar, setFocusedStar] = useState(-1)
  // Read by the `?probe=1` seam, which must not be reinstalled on every focus change.
  const focusedStarRef = useRef(-1)
  const focusedSlugRef = useRef<string | null>(null)
  const [cardVersion, setCardVersion] = useState(0)
  const [gpu, setGpu] = useState({ atlas: 0, card: 0 })
  const [thumbnails, setThumbnails] = useState({ drawn: 0, cells: 0, capacity: 0, failed: 0 })

  const starScene = useRef<StarSceneHandle>(null)
  const cardTier = useRef<CardTierHandle>(null)
  const labelState = useRef<PlanetLabelState>({ visible: false, x: 0, y: 0, printing: -1 }).current
  const anchorScratch = useRef(new Vector3()).current
  const probeScreen = useRef(new Vector3()).current
  const cameraRef = useRef<PerspectiveCamera | null>(null)

  /**
   * The focused plane's cards, by global star index.
   *
   * A plain `Map` behind a stable object: the thumbnail tier asks per star per pass and the focused
   * card asks once, so lookup has to be O(1), and the identity has to change when shards land or
   * the memo in `CardTier` would never see them.
   */
  const cardsRef = useRef(new Map<number, CardRecord>())
  const cards: PlaneCards = useMemo(
    () => ({ get: (star: number) => cardsRef.current.get(star) ?? null }),
    // `cardVersion` is the whole dependency, on purpose: the map is a ref, so its identity never
    // changes and nothing downstream would ever re-read it. The counter ticks once per shard.
    [cardVersion],
  )

  useEffect(() => sceneErrors.subscribe(setToast), [])

  // The scene is built once `planes.json` lands and lives for the session (PRD 8.7.2).
  const sceneRef = useRef<SceneNavigation | null>(null)
  const reducedAtBuild = useRef(reducedMotion)
  const scene = useMemo(() => {
    if (!data.planes) return null
    const built = createSceneNavigation(data.planes, {
      drive: 'manual',
      reducedMotion: reducedAtBuild.current,
    })
    sceneRef.current = built
    return built
  }, [data.planes])

  useEffect(() => () => sceneRef.current?.api.dispose(), [])

  useEffect(() => {
    if (!scene) return
    const unsubscribe = scene.api.subscribe(setSnapshot)
    setSnapshot(scene.api.snapshot())
    // PRD 6.8.2: the intro plays once per session. With no router yet (Phase 4) the target is home.
    scene.api.playIntro({ kind: 'multiverse' }, { reason: 'intro' })
    return unsubscribe
  }, [scene])

  useEffect(() => {
    scene?.api.setReducedMotion(reducedMotion)
  }, [scene, reducedMotion])

  // PRD 6.7.1's `starIndex` → position resolution, now that `stars.bin` has landed. The geometry is
  // the source: it holds the same locals the shader draws from.
  useEffect(() => {
    if (!scene || !data.resources) return
    const geometry = data.resources.geometry
    scene.setStarSource({
      starLocal: (index, out) => {
        if (!Number.isInteger(index) || index < 0 || index >= geometry.drawCount) return null
        geometry.localPosition(index, out)
        return geometry.planeRowOf(index)
      },
    })
  }, [scene, data.resources])

  focusedStarRef.current = focusedStar
  const focus = snapshot?.focus
  const focusedSlug =
    focus === undefined
      ? null
      : focus.kind === 'plane'
        ? focus.slug
        : focus.kind === 'card'
          ? focus.planeSlug
          : null

  focusedSlugRef.current = focusedSlug
  const focusedPlane: PlaneRecord | null = useMemo(
    () => data.planes?.planes.find((plane) => plane.slug === focusedSlug) ?? null,
    [data.planes, focusedSlug],
  )

  // PRD 5.6.6: a focused *card* stops its plane's rotation. A focused plane does not.
  useEffect(() => {
    if (!scene) return
    scene.rig.motion.setFocusedPlane(focus?.kind === 'card' ? focus.planeSlug : null)
  }, [scene, focus])

  // PRD 8.7.6 / amendment A1: plane detail on focus, parsed in a worker, shard by shard.
  const loaderRef = useRef<ReturnType<typeof createPlaneDetailLoader> | null>(null)
  useEffect(() => {
    if (!data.planes) return
    const loader = createPlaneDetailLoader({ root: dataRoot() })
    loaderRef.current = loader
    return () => {
      loader.dispose()
      loaderRef.current = null
    }
  }, [data.planes])

  useEffect(() => {
    const loader = loaderRef.current
    if (!loader || !focusedPlane) return
    cardsRef.current.clear()
    setCardVersion((v) => v + 1)
    let cardCount = 0
    let shards = 0
    setDetail({ slug: focusedPlane.slug, cards: 0, shards: 0 })
    loader.load(focusedPlane.slug, focusedPlane.shardCount, {
      onShard: (file: PlaneShardFile) => {
        // Contract §: `starOffset` is the global star index of this shard's local index 0.
        for (let i = 0; i < file.cards.length; i += 1) {
          cardsRef.current.set(file.starOffset + i, file.cards[i]!)
        }
        cardCount += file.cards.length
        shards += 1
        setDetail({ slug: focusedPlane.slug, cards: cardCount, shards })
        setCardVersion((v) => v + 1)
      },
      onError: (message) => {
        // PRD 7.4.1's single non-blocking report. Phase 4 owns the toast.
        console.warn(`plane detail: ${message}`)
      },
    })
    return () => {
      loader.cancel()
    }
  }, [focusedPlane])

  /**
   * A star was clicked. PRD 5.6.1 focuses it; PRD 6.2.3's two-stage fly-to is the scene's own.
   *
   * The `oracleId` the navigation contract wants lives in the plane's shards, which arrive on plane
   * focus (PRD 8.7.6). A star clicked from the multiverse — before any shard has been asked for —
   * therefore has no id yet, and rather than invent one this flies to the plane and remembers the
   * star, which is the first stage of PRD 6.2.3's two-stage flight either way.
   */
  const pendingStar = useRef(-1)
  const focusStar = useCallback(
    (index: number, planeIndex: number): void => {
      const built = sceneRef.current
      if (!built || !data.planes || !data.resources) return
      const plane = data.planes.planes[planeIndex]
      if (!plane) return
      const record = cardsRef.current.get(index)
      if (!record) {
        pendingStar.current = index
        built.api.flyToPlane(plane.slug, { reason: 'user' })
        return
      }
      pendingStar.current = -1
      const known = starScene.current?.starPosition(index, anchorScratch) ?? false
      built.api.flyToCard(
        {
          planeSlug: plane.slug,
          oracleId: record.u,
          starIndex: index,
          // PRD 6.2.3: a Blind Eternities card carries its own position as the dust anchor.
          ...(plane.slug === BLIND_ETERNITIES_SLUG && known
            ? { anchor: [anchorScratch.x, anchorScratch.y, anchorScratch.z] as const }
            : {}),
        },
        { reason: 'user' },
      )
      setFocusedStar(index)
    },
    [data.planes, data.resources, anchorScratch],
  )

  // The shards for the plane a pending star sits on have landed; finish the focus.
  useEffect(() => {
    const index = pendingStar.current
    if (index < 0 || !data.resources) return
    if (!cardsRef.current.has(index)) return
    focusStar(index, data.resources.geometry.planeRowOf(index))
  }, [cardVersion, focusStar, data.resources])

  const onSelect = useCallback(
    (pick: PickResult) => {
      const built = sceneRef.current
      if (!built) return
      if (pick === null) return
      if (pick.kind === 'planet') {
        // PRD 5.6.9: clicking a planet swaps the front and marks it active. It is not a navigation:
        // "the active printing is view state, changes no route" (navigation contract, `Focus`).
        //
        // Resolved from the *clicked* planet, not from whichever one the hover label last named.
        // The click carries its own id out of the same id buffer, and reaching for the hover state
        // instead made the click depend on a hover having been reported first — which, before the
        // dedupe fix in `StarScene`, it very often had not been.
        const slot = cardTier.current?.card
        if (slot) {
          const printing = slot.printingOfPlanet(pick.index)
          if (printing !== null) slot.setActivePrinting(printing)
        }
        return
      }
      if (pick.kind === 'plane') {
        const plane = data.planes?.planes[pick.index]
        if (plane) built.api.flyToPlane(plane.slug, { reason: 'user' })
        setFocusedStar(-1)
        return
      }
      focusStar(pick.index, pick.planeIndex)
    },
    [data.planes, focusStar],
  )

  // Esc leaves the card, so the card object has to go with it.
  useEffect(() => {
    if (focus?.kind !== 'card') setFocusedStar(-1)
  }, [focus])

  const onQualityChange = useCallback((next: QualityTier) => {
    setTier((previous) => ({ tier: next, changes: previous.changes + 1 }))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const handle = cardTier.current
      if (!handle) return
      setGpu(handle.gpuBytes)
      const stats = handle.stats
      setThumbnails({
        drawn: stats.drawn,
        cells: stats.cells,
        capacity: stats.capacity,
        failed: stats.failed,
      })
    }, 500)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const built = sceneRef.current
      if (!built) return
      if (event.key === 'Escape') {
        built.api.focusParent({ reason: 'history' })
      } else if (event.key === 'a' || event.key === 'A') {
        const state = built.api.snapshot()
        if (state.attract) built.api.exitAttract('keyboard')
        else built.api.enterAttract()
      } else if (event.key === 'b' || event.key === 'B') {
        built.api.flyToBlindEternities(undefined, { reason: 'user' })
      } else if (event.key === 'f' || event.key === 'F') {
        // PRD 5.6.5's flip control. Phase 4 gives it a button; this is the same call.
        cardTier.current?.card.toggleFlip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // The `?probe=1` seam of `./probe`. Installed only when the URL asks, and it calls the same
  // `focusStar` the pointer does rather than a second implementation of it.
  useEffect(() => {
    if (!probeRequested() || !data.planes || !data.resources) return
    const planes = data.planes
    const geometry = data.resources.geometry

    const state = (): ProbeState => {
      const built = sceneRef.current
      const snap = built?.api.snapshot()
      const handle = cardTier.current
      const memoryNow = gpuMemoryReport(
        handle?.gpuBytes.atlas ?? 0,
        handle?.gpuBytes.card ?? 0,
      )
      const focused = focusedStarRef.current
      const record = focused >= 0 ? cardsRef.current.get(focused) : undefined
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
        planeSlug: focusedSlugRef.current,
        cardsLoaded: cardsRef.current.size,
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
          cardState?.visible && cameraRef.current
            ? cameraRef.current.position.distanceTo(cardState.root.position)
            : 0,
        cardScreen: cardState?.visible
          ? (() => {
              probeScreen.copy(cardState.root.position).project(cameraRef.current!)
              return { x: (probeScreen.x + 1) / 2, y: (1 - probeScreen.y) / 2 }
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
        const built = sceneRef.current
        const plane = planes.planes.find((p) => p.slug === slug)
        if (!built || !plane) return false
        built.api.flyToPlane(slug, { reason: 'user' })
        return true
      },
      focusCard: (options = {}) => {
        const wanted = options.dfc === true
        let nth = options.nth ?? 0
        let best = -1
        let bestPrintings = -1
        for (const [star, record] of cardsRef.current) {
          const printing = record.p[0]
          if (!printing) continue
          if (wanted) {
            if (cardBackImageUri(record, printing, 'large') === null) continue
            if (nth > 0) {
              nth -= 1
              continue
            }
            best = star
            break
          }
          // Most printings first, so PRD 5.6.7's planets have something to draw.
          if (record.p.length > bestPrintings) {
            bestPrintings = record.p.length
            best = star
          }
        }
        if (best < 0) return -1
        focusStar(best, geometry.planeRowOf(best))
        return best
      },
      flip: () => {
        const handle = cardTier.current?.card
        if (!handle?.canFlip) return false
        handle.toggleFlip()
        return true
      },
      activatePrinting: (index) => {
        const handle = cardTier.current?.card
        if (!handle?.visible) return false
        handle.setActivePrinting(index)
        return handle.activePrinting === index
      },
      thumbnailStars: () => [...(cardTier.current?.drawnStars ?? [])],
      planetScreen: (index) => {
        const handle = cardTier.current?.card
        const camera = cameraRef.current
        if (!handle?.visible || !camera) return null
        if (!handle.planetWorldPosition(index, probeScreen)) return null
        probeScreen.project(camera)
        if (probeScreen.z >= 1) return null
        return { x: (probeScreen.x + 1) / 2, y: (1 - probeScreen.y) / 2 }
      },
    }
    window.__eternitiesProbe = probe
    return () => {
      delete window.__eternitiesProbe
    }
  }, [data.planes, data.resources, focusStar, probeScreen])

  const setName = useCallback(
    (printing: number): string => {
      const record = focusedStar >= 0 ? cardsRef.current.get(focusedStar) : undefined
      const tuple = record?.p[printing]
      if (!tuple) return ''
      const set = data.search?.sets.find((entry) => entry.id === tuple[1])
      return set ? `${set.name} · ${set.year}` : `set ${tuple[1]}`
    },
    [data.search, focusedStar],
  )

  // PRD 5.3.20 and 9.3: the field blooms, the cards do not. See `Effects`.
  const bloomSelection = useMemo(
    () => (data.resources ? [data.resources.field.points, data.resources.field.glow] : []),
    [data.resources],
  )

  const hoveredPlanet = hover?.kind === 'planet' ? hover.index : -1
  const focusedCard = focusedStar >= 0 ? cardsRef.current.get(focusedStar) : undefined
  const memory = gpuMemoryReport(gpu.atlas, gpu.card)

  return (
    <div className="app">
      <Canvas
        camera={{ position: [0, 150, 260], fov: FOV, near: 0.1, far: 8000 }}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          // Only for the `?probe=1` verification pass, and for the same reason Phase 2a's harness
          // does it: without a preserved buffer a screenshot of the canvas is whatever frame the
          // compositor last kept, which is not necessarily the frame the assertions were made
          // against. It cost PRD 9.3's checkpoint images their credibility once already — they
          // showed a card mid-fly-to while the probe reported it dead centre. Preserving on every
          // frame is a full-buffer copy nobody is paying for in production.
          preserveDrawingBuffer: probeRequested(),
        }}
        flat
        onCreated={({ gl, camera }) => {
          gl.toneMapping = NoToneMapping
          cameraRef.current = camera as PerspectiveCamera
        }}
        dpr={QUALITY_TIERS[0]!.pixelRatioCap}
        style={{ background: SKY_COLOUR }}
      >
        <StarScene
          resources={data.resources}
          starsComplete={data.starsComplete}
          reducedMotion={reducedMotion}
          onHover={setHover}
          onSelect={onSelect}
          onQualityChange={onQualityChange}
          handleRef={starScene}
        />
        {scene && data.resources && (
          <>
            <MotionSync table={data.resources.table} motion={scene.rig.motion} />
            <CameraRigController rig={scene.rig} nav={scene.api} />
            <CardTier
              resources={data.resources}
              nav={scene}
              plane={focusedPlane}
              cards={cards}
              focusedStar={focusedStar}
              reducedMotion={reducedMotion}
              thumbnailCapacity={tier.tier.thumbnailCapacity}
              hoveredPlanet={hoveredPlanet}
              labelState={labelState}
              handleRef={cardTier}
            />
          </>
        )}
        <Effects bloomScale={tier.tier.bloomScale} bloomSelection={bloomSelection} />
      </Canvas>

      {scene && data.planes && (
        <PlaneLabels
          planes={data.planes}
          rig={scene.rig}
          focusedPlaneSlug={focusedSlug}
          level={snapshot?.level ?? 'multiverse'}
          fov={FOV}
        />
      )}

      <div className="labels">
        <PlanetHoverLabel state={labelState} text={setName} />
      </div>

      <div className="overlay" data-testid="eternities-status">
        <h1>Eternities</h1>
        <p className="muted">
          Drag to orbit · scroll to zoom · click a plane, a star or a thumbnail · Esc to go back ·{' '}
          <kbd>b</kbd> the Blind Eternities · <kbd>a</kbd> attract mode · <kbd>f</kbd> flip
        </p>
        <ul>
          <li data-testid="focus">
            focus: {snapshot?.focus.kind ?? '—'}
            {focusedSlug !== null ? ` (${focusedSlug})` : ''} · level {snapshot?.level ?? '—'}
          </li>
          <li data-testid="flight">
            flight: {snapshot?.flight ? `#${snapshot.flight.id}` : 'idle'} · attract{' '}
            {String(snapshot?.attract ?? false)} · reduced motion {String(reducedMotion)}
          </li>
          {scene && <CameraReadout rig={scene.rig} />}
          <li data-testid="stars">
            stars: {data.drawable} / {data.expected}
            {data.starsComplete ? ' (complete)' : ' (streaming)'} · quality {tier.tier.label} ·{' '}
            {tier.changes} change{tier.changes === 1 ? '' : 's'}
          </li>
          <li data-testid="detail">
            detail:{' '}
            {detail === null
              ? '—'
              : `${detail.slug} ${detail.cards} cards over ${detail.shards} shard(s)` +
                (detail.slug === BLIND_ETERNITIES_SLUG ? ' (sharded, worker-parsed)' : '')}
          </li>
          <li data-testid="thumbnails">
            thumbnails: {thumbnails.drawn} drawn · {thumbnails.cells} / {thumbnails.capacity} cells ·{' '}
            {thumbnails.failed} failed
          </li>
          <li data-testid="card">
            card:{' '}
            {focusedCard === undefined
              ? '—'
              : `${focusedCard.n} · ${cardTier.current?.card.planetCount ?? 0} planet(s)` +
                ` of ${focusedCard.p.length} printing(s)` +
                (cardTier.current?.card.canFlip ? ' · flippable' : '')}
          </li>
          <li data-testid="gpu">
            gpu: {formatMb(memory.totalBytes)} of {formatMb(memory.targetBytes)} target (atlas{' '}
            {formatMb(memory.atlasBytes)}, card {formatMb(memory.cardBytes)}) ·{' '}
            {memory.withinTarget ? 'within target' : memory.withinCeiling ? 'over target' : 'OVER CEILING'}
          </li>
          <li data-testid="hover">
            hover:{' '}
            {hover === null
              ? '—'
              : hover.kind === 'star'
                ? `star ${hover.index}`
                : hover.kind === 'planet'
                  ? `planet ${hover.index}`
                  : `plane ${data.planes?.planes[hover.index]?.displayName ?? hover.index}`}
          </li>
        </ul>
        {!data.ok && <p className="bad">the data contract decode failed — see the console</p>}
        {toast && (
          <p className="bad" data-testid="data-error">
            {toast.message}
          </p>
        )}
      </div>
    </div>
  )
}
