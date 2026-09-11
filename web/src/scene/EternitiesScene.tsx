/**
 * The scene. One canvas, one camera, one picker, every tier (PRD 5, 8.5).
 *
 * `SceneView` is the scene with nothing around it: the shell mounts it inside its own `.app`, and
 * `EternitiesScene` mounts it as its own application for `?probe=1`. Three things differ between
 * the two, all named on {@link SceneViewProps} — who loads the data, who starts PRD 6.8.2's intro,
 * and who owns the keyboard.
 *
 * The GPU self-check is not here: it holds the field still and reads pixels back, which it cannot
 * do in a scene where the rig is flying the camera. `App` routes `?selfcheck` to `harness/`.
 * Everything the review's §6.3 split moved out — the probe seam, the bench seam, plane detail, the
 * readout panel — is imported below and named after what it does.
 */

import { Canvas } from '@react-three/fiber'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  NoToneMapping,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three'

import { useReducedMotion } from '../app/hooks'
import type { BenchResult } from '../bench/BenchRunner'
import { recordBenchCpu } from '../bench/cpuSamples'
import { CameraRigController } from '../camera/CameraRigController'
import { BLIND_ETERNITIES_SLUG, type PlaneRecord } from '../data'
import { PlaneLabels } from '../labels/PlaneLabels'
import type { NavigationHost } from '../navigation/host'
import { createSceneNavigation, type SceneNavigation } from '../navigation/scene'
import type { NavigationSnapshot } from '../navigation/types'
import { useStore } from '../store/store'

import { useBenchSeam } from './benchSeam'
import { CardTier, type CardTierHandle, type PlanetLabelState } from './cards/CardTier'
import { Effects, type BloomProbe } from './Effects'
import { sceneErrors, type SceneDataError } from './errors'
import { motionOverride } from './motionOverride'
import { MotionSync } from './MotionSync'
import type { PickResult } from './picking/scenePicker'
import { PlanetHoverLabel } from './PlanetHoverLabel'
import { probeRequested } from './probe'
import { useProbeSeam } from './probeSeam'
import { QUALITY_TIERS, pinnedQualityTier, type QualityTier } from './quality/adaptiveQuality'
import { SceneReadout } from './SceneReadout'
import { StarScene, type StarSceneHandle } from './StarScene'
import { BLOOM_INTENSITY_STEPS, SKY_COLOUR } from './tuning'
import { usePlaneDetail } from './usePlaneDetail'
import { useSceneData, type SceneDataState } from './useSceneData'

const FOV = 55

/**
 * 622 lines that only `benchContext !== null` can reach, so they are not in the product's chunk
 * (review §5.4 B1). The per-frame `recordBenchCpu` writer stays static in `bench/cpuSamples` — it
 * is six lines and the runner reads through it, so the split costs no samples.
 */
const BenchRunner = lazy(async () => ({
  default: (await import('../bench/BenchRunner')).BenchRunner,
}))

export interface SceneViewProps {
  /**
   * The load, hoisted out so the shell can own it. There is exactly one loader on the page
   * (`app/dataset.ts` explains why), and whoever mounts this scene is it.
   */
  readonly data: SceneDataState
  /**
   * PRD 5.9. Passed in rather than read here, because the two callers resolve it from different
   * authorities: the harness from the OS and `?motion=`, the shell from PRD 6.10.1's settings
   * toggle layered over both.
   */
  readonly reducedMotion: boolean
  /**
   * Where to publish the real navigation once `planes.json` has built it.
   *
   * With a host, the shell is driving: it owns PRD 6.8.2's intro (`app/boot.ts` sequences it
   * against the deep link, which this scene cannot see), the keyboard map (PRD 6.11) and the
   * chrome. Without one, this scene is the whole application and owns all three itself.
   */
  readonly host?: NavigationHost | null
  /**
   * Render the harness readout and bind its shortcuts. True for `?probe=1`, whose assertions read
   * that panel; false in the shell, where PRD section 6's HUD is the real one.
   */
  readonly chrome?: boolean
  /**
   * PRD 9.1.2's `/bench`. When present the bench owns the camera — `CameraRigController` is not
   * mounted, because two things cannot fly one camera — and drives focus from the scripted path so
   * each segment contains what it is named after. `hold` parks at a segment's end pose instead of
   * recording, which is how PRD 9.3's checkpoints get a reproducible frame.
   */
  readonly bench?: {
    readonly hold?: string | null
    readonly onComplete?: (result: BenchResult) => void
  } | null
}

/**
 * The scene, with nothing around it. Mounted by the shell (inside its `.app`) and by
 * {@link EternitiesScene} (which supplies its own).
 */
export function SceneView({
  data,
  reducedMotion,
  host = null,
  chrome = true,
  bench = null,
}: SceneViewProps): ReactElement {
  const [snapshot, setSnapshot] = useState<NavigationSnapshot | null>(null)
  /**
   * PRD 6.10.1's two scene-facing settings, subscribed one field at a time.
   *
   * Selecting the fields rather than the whole `settings` object is what keeps this off the render
   * path: a hint dismissal or a reduced-motion change must not re-render the component that owns
   * the `<Canvas>` (review §2.2).
   */
  const labelsEnabled = useStore((state) => state.settings.labels)
  const bloomIntensity = useStore((state) => BLOOM_INTENSITY_STEPS[state.settings.bloom])
  // `?quality=N` starts the scene at tier N and holds it there (PRD 9.1.4). The monitor inside
  // `StarScene` is pinned to the same tier, so it never announces a change and this stays the tier
  // for the run — which is why the initial value has to be right rather than corrected later.
  const pinnedTier = useMemo(() => pinnedQualityTier(), [])
  /**
   * Whether the URL asked for the `./probe` seam — read **once**, at the first render.
   *
   * The effect that installs it re-runs when `planes.json` and the GPU resources land, and under
   * the shell that is long enough for the URL to have changed: PRD 6.7's router canonicalises the
   * address bar on boot, so a `location.search` read there would say the seam was never asked for.
   * A flag the page was *opened* with is not a value that may change under it.
   */
  const probeWanted = useMemo(() => probeRequested(), [])
  const [tier, setTier] = useState<{ tier: QualityTier; changes: number }>({
    tier: QUALITY_TIERS[pinnedTier ?? 0]!,
    changes: 0,
  })
  const [hover, setHover] = useState<PickResult>(null)
  const [toast, setToast] = useState<SceneDataError | null>(null)
  const [focusedStar, setFocusedStar] = useState(-1)
  // The three values the probe's `state()` reads that must not re-install it. See `ProbeSeamDeps`.
  const focusedStarRef = useRef(-1)
  const tierRef = useRef<QualityTier>(QUALITY_TIERS[pinnedTier ?? 0]!)
  const focusedSlugRef = useRef<string | null>(null)

  const starScene = useRef<StarSceneHandle>(null)
  const cardTier = useRef<CardTierHandle>(null)
  const labelState = useRef<PlanetLabelState>({ visible: false, x: 0, y: 0, printing: -1 }).current
  const anchorScratch = useRef(new Vector3()).current
  const probeScreen = useRef(new Vector3()).current
  const probeBuffer = useRef(new Vector2()).current
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  // Both for the `?probe=1` quality block only; see `ProbeState.quality`.
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const bloomRef = useRef<BloomProbe | null>(null)

  useEffect(() => sceneErrors.subscribe(setToast), [])

  // The scene is built once `planes.json` lands and lives for the session (PRD 8.7.2).
  const sceneRef = useRef<SceneNavigation | null>(null)
  const reducedAtBuild = useRef(reducedMotion)
  const hostRef = useRef(host)
  hostRef.current = host
  const scene = useMemo(() => {
    if (!data.planes) return null
    const built = createSceneNavigation(data.planes, {
      drive: 'manual',
      reducedMotion: reducedAtBuild.current,
      // Under the shell the host has been answering for the page since before the first paint. It
      // starts at the multiverse and `boot()` has not moved it — the deep link reaches the scene
      // through `playIntro`, not through the initial focus — but carrying it across is what makes
      // the swap a swap rather than a reset, and it is one field.
      ...(hostRef.current ? { initialFocus: hostRef.current.snapshot().focus } : {}),
    })
    sceneRef.current = built
    return built
  }, [data.planes])

  useEffect(() => () => sceneRef.current?.api.dispose(), [])

  // The moment the rig exists, the shell's navigation becomes it. Everything the shell has bound —
  // the router binding from `boot()`, the HUD's snapshot subscription — is re-pointed by the host
  // without re-registering. See `navigation/host.ts`.
  useEffect(() => {
    if (!scene || !host) return
    host.attach(scene.api)
  }, [scene, host])

  useEffect(() => {
    if (!scene) return
    const unsubscribe = scene.api.subscribe(setSnapshot)
    setSnapshot(scene.api.snapshot())
    // PRD 6.8.2: the intro plays once per session. Under the shell `app/boot.ts` starts it, because
    // it is the only place that knows the deep link the intro has to aim at and the second stage
    // that follows it. Standalone, the target is home.
    if (!host) scene.api.playIntro({ kind: 'multiverse' }, { reason: 'intro' })
    return unsubscribe
  }, [scene, host])

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
  tierRef.current = tier.tier
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

  const { cards, cardsRef, cardVersion, detail } = usePlaneDetail(data.planes !== null, focusedPlane)

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
    [data.planes, data.resources, anchorScratch, cardsRef],
  )

  // The shards for the plane a pending star sits on have landed; finish the focus.
  useEffect(() => {
    const index = pendingStar.current
    if (index < 0 || !data.resources) return
    if (!cardsRef.current.has(index)) return
    focusStar(index, data.resources.geometry.planeRowOf(index))
  }, [cardVersion, focusStar, data.resources, cardsRef])

  const onSelect = useCallback(
    (pick: PickResult) => {
      const built = sceneRef.current
      if (!built) return
      if (pick === null) return
      if (pick.kind === 'planet') {
        // PRD 5.6.9: clicking a planet swaps the front and marks it active. It is not a navigation:
        // "the active printing is view state, changes no route" (navigation contract, `Focus`).
        //
        // Resolved from the *clicked* planet, not from whichever one the hover label last named:
        // reaching for the hover state made the click depend on a hover having been reported first,
        // which before the dedupe fix in `StarScene` it very often had not been.
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

  // The harness's own shortcuts. Not bound under the shell: PRD 6.11's map is `useKeyboardMap`,
  // and two listeners on `window` for the same key would run Esc twice — once up the focus chain
  // and once through the router.
  useEffect(() => {
    if (!chrome) return
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
        // PRD 5.6.5's flip control; the shell's HUD calls the same handle.
        cardTier.current?.card.toggleFlip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [chrome])

  useProbeSeam({
    enabled: probeWanted,
    planes: data.planes,
    resources: data.resources,
    focusStar,
    pinnedTier,
    sceneRef,
    starScene,
    cardTier,
    cameraRef,
    rendererRef,
    bloomRef,
    tierRef,
    focusedStarRef,
    focusedSlugRef,
    cardsRef,
    screen: probeScreen,
    buffer: probeBuffer,
  })

  const benchContext = useBenchSeam({
    bench: bench !== null,
    data,
    focusStar,
    sceneRef,
    cardTier,
    cardsRef,
  })

  const setName = useCallback(
    (printing: number): string => {
      const record = focusedStar >= 0 ? cardsRef.current.get(focusedStar) : undefined
      const tuple = record?.p[printing]
      if (!tuple) return ''
      const set = data.search?.sets.find((entry) => entry.id === tuple[1])
      return set ? `${set.name} · ${set.year}` : `set ${tuple[1]}`
    },
    [data.search, focusedStar, cardsRef],
  )

  // PRD 5.3.20 and 9.3: the field blooms, the cards do not. See `Effects`.
  const bloomSelection = useMemo(
    () => (data.resources ? [data.resources.field.points, data.resources.field.glow] : []),
    [data.resources],
  )

  const hoveredPlanet = hover?.kind === 'planet' ? hover.index : -1
  const focusedCard = focusedStar >= 0 ? cardsRef.current.get(focusedStar) : undefined

  const body = (
    <>
      <Canvas
        camera={{ position: [0, 150, 260], fov: FOV, near: 0.1, far: 8000 }}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          // Only for the `?probe=1` verification pass: without a preserved buffer a screenshot of
          // the canvas is whatever frame the compositor last kept, which is not necessarily the
          // frame the assertions were made against. It cost PRD 9.3's checkpoint images their
          // credibility once already. Preserving every frame is a full-buffer copy nobody is
          // paying for in production.
          preserveDrawingBuffer: probeWanted,
        }}
        flat
        onCreated={({ gl, camera }) => {
          gl.toneMapping = NoToneMapping
          cameraRef.current = camera as PerspectiveCamera
          rendererRef.current = gl
        }}
        // **The pixel-ratio rung, and the only writer of it (DEC-692 R2).** A range rather than a
        // number on purpose: R3F re-reads this prop on every render, so a bare `cap` raced the
        // ladder and the first rung never landed. See `docs/star-renderer.md` §6.1.
        dpr={[0.5, tier.tier.pixelRatioCap]}
        style={{ background: SKY_COLOUR }}
      >
        <StarScene
          resources={data.resources}
          starsComplete={data.starsComplete}
          reducedMotion={reducedMotion}
          onHover={setHover}
          onSelect={onSelect}
          onQualityChange={onQualityChange}
          // PRD 7.2's "CPU time per frame in the render loop", reported by the scene rather than
          // guessed at from outside. It covers the star field's own frame work; the card tier's is
          // not in it, so the figure is a floor on a card segment, not the whole cost.
          {...(bench ? { onFrame: (_ms: number, cpuMs: number) => recordBenchCpu(cpuMs) } : {})}
          handleRef={starScene}
        />
        {benchContext && (
          <Suspense fallback={null}>
            <BenchRunner
              // The numbers mean nothing until the whole field is drawable (PRD 8.7.3).
              ready={data.starsComplete}
              context={benchContext}
              qualityTier={tier.tier.label}
              qualityChanges={tier.changes}
              hold={bench?.hold ?? null}
              {...(bench?.onComplete ? { onComplete: bench.onComplete } : {})}
            />
          </Suspense>
        )}
        {scene && data.resources && (
          <>
            <MotionSync table={data.resources.table} motion={scene.rig.motion} />
            {/* The bench flies the camera itself. Mounting the rig as well would put two writers on
                one camera and the path would stop being the path. */}
            {!bench && <CameraRigController rig={scene.rig} nav={scene.api} />}
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
        <Effects
          bloomScale={tier.tier.bloomScale}
          bloomSelection={bloomSelection}
          bloomRef={bloomRef}
          bloomIntensity={bloomIntensity}
        />
      </Canvas>

      {scene && data.planes && (
        <PlaneLabels
          planes={data.planes}
          rig={scene.rig}
          focusedPlaneSlug={focusedSlug}
          level={snapshot?.level ?? 'multiverse'}
          enabled={labelsEnabled}
          fov={FOV}
        />
      )}

      <div className="labels">
        <PlanetHoverLabel state={labelState} text={setName} />
      </div>
    </>
  )

  if (!chrome) return body

  return (
    <div className="app">
      {body}
      <SceneReadout
        scene={scene}
        snapshot={snapshot}
        planes={data.planes}
        focusedSlug={focusedSlug}
        focusedCardName={focusedCard?.n ?? null}
        focusedPrintings={focusedCard?.p.length ?? 0}
        cardTier={cardTier}
        detail={detail}
        hover={hover}
        reducedMotion={reducedMotion}
        quality={{ label: tier.tier.label, changes: tier.changes }}
        stars={{
          drawable: data.drawable,
          expected: data.expected,
          complete: data.starsComplete,
        }}
        decodeOk={data.ok}
        toast={toast}
      />
    </div>
  )
}

/**
 * The scene as its own application: its own load, its own reduced-motion resolution, its own intro
 * and its own readout panel.
 *
 * `App` routes `?probe=1` here. It exists because `scripts/verify-browser.mjs` was signed off
 * against this panel, and re-pointing it at the shell's HUD inside the same change that first
 * mounts the shell's HUD would leave nothing standing still to compare against. Same
 * {@link SceneView} the shell renders; only the surroundings differ.
 */
export function EternitiesScene(): ReactElement {
  const data = useSceneData()
  // One resolution (PRD 5.9, 6.10.1) with `?motion=` laid over it, which is what
  // `e2e/quality.spec.ts` drives to hold the field still. See `./motionOverride`.
  // The hook is called unconditionally and the override applied after: `??` around a hook call
  // would skip it whenever `?motion=` is set.
  const resolved = useReducedMotion()
  const reducedMotion = motionOverride() ?? resolved
  return <SceneView data={data} reducedMotion={reducedMotion} />
}
