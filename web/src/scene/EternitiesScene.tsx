/**
 * The scene's React attachment (review §3.6 phase 3, item 3).
 *
 * There is no `<Canvas>` here any more, and that is the whole change. `SceneView` used to *be* the
 * scene: it rendered a canvas with seven children, and those children's mount order was the frame
 * order, their props were the quality ladder's rungs, and what they sent back came out as `useState`
 * on this component — so the monitor changing tier twice a second re-rendered the owner of the
 * canvas, and every scene child under it, twice a second for the life of the session (review
 * finding R1). The scene is now `scene/renderer/sceneHost`, built in `createServices()` and living
 * as long as the page.
 *
 * What is left is the attachment, in two directions and no others:
 *
 *  - **inbound**: imperative calls on the host, driven by store subscriptions and by the data load.
 *    `focusStar`, `setFilterMask` (through `app/filterMask`), `setReducedMotion`, `setQualityCap`
 *    — the pin, resolved once — and `setLabelsEnabled`.
 *  - **outbound**: the mutable `FrameStats` record, polled by one HUD leaf at 2 Hz. Nothing the
 *    scene reports arrives as a React state update; see `renderer/frameStats`.
 *
 * `SceneView` is the scene with nothing around it: the shell mounts it inside its own `.app`, and
 * `EternitiesScene` mounts it as its own application for `?probe=1`. Three things differ between
 * the two, all named on {@link SceneViewProps} — who loads the data, who starts PRD 6.8.2's intro,
 * and who owns the keyboard.
 *
 * The GPU self-check that used to live beside this retired with the star field at the cutover
 * (DEC-752); it is archived under the `galaxy-cutover` tag.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Vector3 } from 'three'

import { useReducedMotion } from '../app/hooks'
import { useWorldsFilterMask } from '../app/filterMask'
import { useSceneHost } from '../app/services'
import type { BenchResult, BenchRunnerProps } from '../bench/BenchRunner'
import { BLIND_ETERNITIES_SLUG, type PlaneRecord } from '../data'
import { PlaneLabels } from '../labels/PlaneLabels'
import type { NavigationHost } from '../navigation/host'
import { createSceneNavigation, type SceneNavigation } from '../navigation/scene'
import type { NavigationSnapshot } from '../navigation/types'
import { useStore } from '../store/store'

import { useBenchSeam } from './benchSeam'
import { sceneErrors, type SceneDataError } from './errors'
import { motionOverride } from './motionOverride'
import type { PickResult } from './picking/scenePicker'
import { PlanetHoverLabel } from './PlanetHoverLabel'
import { probeRequested } from './probe'
import { useProbeSeam } from './probeSeam'
import { pinnedQualityTier, type QualityTier } from './quality/adaptiveQuality'
import { FOV } from './renderer/sceneRenderer'
import { SceneReadout } from './SceneReadout'
import { BLOOM_INTENSITY_STEPS } from './tuning'
import { usePlaneDetail } from './usePlaneDetail'
import { useSceneData, type SceneDataState } from './useSceneData'

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
   * PRD 9.1.2's `/bench`. When present the bench owns the camera — the rig is not attached, because
   * two things cannot fly one camera — and drives focus from the scripted path so each segment
   * contains what it is named after. `hold` parks at a segment's end pose instead of recording,
   * which is how PRD 9.3's checkpoints get a reproducible frame.
   */
  readonly bench?: {
    readonly hold?: string | null
    readonly onComplete?: (result: BenchResult) => void
    /**
     * The runner itself, supplied by the caller (review §3.6 phase 3, item 4).
     *
     * This used to be a `lazy(() => import('../bench/BenchRunner'))` right here, which kept the
     * runner's 612 lines out of the product's *first chunk* (review §5.4 B1) but not out of the
     * product's *build*: this module is the shipped scene, so the import edge was in the product's
     * graph and rollup emitted `BenchRunner` from the product entry. Inverting it costs one prop
     * and takes the edge with it — the scene now knows the runner's shape and not its module.
     *
     * The caller is `bench/BenchScene`, which lives in the harness entry and was going to import
     * the runner anyway.
     */
    readonly renderRunner: (props: BenchRunnerProps) => ReactNode
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
  const scene3d = useSceneHost()
  /** Where the canvas goes. The host appends it; React never renders it. */
  const canvasSlot = useRef<HTMLDivElement>(null)

  const [snapshot, setSnapshot] = useState<NavigationSnapshot | null>(null)
  /**
   * PRD 6.10.1's two scene-facing settings, subscribed one field at a time.
   *
   * Selecting the fields rather than the whole `settings` object is what keeps this off the render
   * path (review §2.2). Both are pushed at the host imperatively below; neither is a prop of
   * anything.
   */
  const labelsEnabled = useStore((state) => state.settings.labels)
  const bloomIntensity = useStore((state) => BLOOM_INTENSITY_STEPS[state.settings.bloom])
  /**
   * `?quality=N` starts the scene at tier N and holds it there (PRD 9.1.4) — the scope's
   * `setQualityCap`, resolved once.
   *
   * The pin is applied by the quality monitor inside the star field, which is the ladder's one
   * authority; this read exists only so the probe seam can report what was asked for.
   */
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

  const [tier, setTier] = useState<{ tier: QualityTier; changes: number }>(() => ({
    tier: scene3d.qualityTier,
    changes: scene3d.qualityChanges,
  }))
  const [hover, setHover] = useState<PickResult>(null)
  const [toast, setToast] = useState<SceneDataError | null>(null)
  const [focusedStar, setFocusedStar] = useState(-1)
  // The three values the probe's `state()` reads that must not re-install it. See `ProbeSeamDeps`.
  const focusedStarRef = useRef(-1)
  const focusedSlugRef = useRef<string | null>(null)

  const anchorScratch = useRef(new Vector3()).current

  useEffect(() => sceneErrors.subscribe(setToast), [])

  // The canvas goes in the page here and comes back out if this unmounts. The renderer itself
  // survives: `StrictMode` mounts, unmounts and remounts, and a `WebGLRenderer` disposed on the
  // first unmount would come back disposed — which is the same argument `app/services` makes for
  // the navigation host.
  useEffect(() => {
    const slot = canvasSlot.current
    if (!slot) return
    scene3d.mount(slot)
    return () => {
      scene3d.unmount()
    }
  }, [scene3d])

  /**
   * PRD 8.5.11, outbound. The host announces a tier; this records it for the readout and the probe.
   *
   * Still React state, and deliberately: the readout panel *displays* the tier, so something has to
   * re-render when it moves. What changed is who re-renders — this component no longer owns a
   * canvas, so the cost is one small subtree rather than the entire scene.
   */
  useEffect(
    () => scene3d.quality.add(({ tier: next, changes }) => setTier({ tier: next, changes })),
    [scene3d],
  )

  useEffect(() => scene3d.hovered.add(setHover), [scene3d])

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

  // --- inbound: the data load and the store, pushed at the host ---------------------------------

  useEffect(() => {
    scene3d.setResources(data.resources)
  }, [scene3d, data.resources])

  useEffect(() => {
    scene3d.setStarsComplete(data.starsComplete)
  }, [scene3d, data.starsComplete])

  /*
   * The worlds roster (worlds spec §1.2), composed once all three of its artefacts are in hand.
   *
   * Assembled here rather than inside the host because `useSceneData` publishes `stars` and
   * `swatches` in separate patches, in an order it does not control — the swatch fetch is awaited
   * *after* `starsComplete` so that a failing one cannot hold up the program warm-up. A host that
   * latched whichever arrived first would be the two-effect ordering hazard DEC-761's F1 was, in a
   * second place; this way the host is handed a complete roster or nothing at all.
   *
   * `null` on a v2 dataset for the whole of §3.2's coexistence period: `swatches` is only ever
   * fetched when `planes.json` carries `rowCells`, so nothing here allocates on the shipped galaxy.
   */
  const worldData = useMemo(
    () =>
      data.planes && data.stars && data.swatches
        ? {
            planes: data.planes.planes,
            stars: data.stars,
            swatches: data.swatches,
            // §1.8's belt sits at 1.12x this (DEC-750). It is a `PlanesFile` field rather than a
            // plane's, so here is the only place it can be read — `WorldsData` carries it instead of
            // the attachment reaching for the dust plane's own `radius`, which holds the same
            // number by coincidence on every dataset published so far.
            multiverseRadius: data.planes.multiverseRadius,
          }
        : null,
    [data.planes, data.stars, data.swatches],
  )

  useEffect(() => {
    scene3d.setWorldData(worldData)
  }, [scene3d, worldData])

  // PRD 5.8's dimming (spec §1.11): `App`'s filter evaluation reaching the cell sheets, where a
  // filtered cell drops to its swatch and is never admitted to the art pool at all.
  useWorldsFilterMask(scene3d.worlds)

  useEffect(() => {
    // The bench flies the camera itself; the rig must not also be attached.
    scene3d.setNavigation(scene, { drive: bench === null })
  }, [scene3d, scene, bench])

  useEffect(() => {
    scene3d.setReducedMotion(reducedMotion)
  }, [scene3d, reducedMotion])

  useEffect(() => {
    scene3d.setLabelsEnabled(labelsEnabled)
  }, [scene3d, labelsEnabled])

  useEffect(() => {
    scene3d.setBloomIntensity(bloomIntensity)
  }, [scene3d, bloomIntensity])

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

  const { cards, cardsRef, cardVersion, detail } = usePlaneDetail(data.planes !== null, focusedPlane)

  useEffect(() => {
    scene3d.setCards(cards)
    // `cardVersion` moves when a shard lands and fills the same `cards` object, so it is a real
    // dependency even though `cards` is identical across it.
  }, [scene3d, cards, cardVersion])

  useEffect(() => {
    scene3d.setFocusedStar(focusedStar)
  }, [scene3d, focusedStar])

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
      const known = scene3d.sceneFrame.starPosition(index, anchorScratch)
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
    [data.planes, data.resources, anchorScratch, cardsRef, scene3d],
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
        // which before the dedupe fix in the star field it very often had not been.
        const slot = scene3d.focusedCard?.card
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
    [data.planes, focusStar, scene3d],
  )

  useEffect(() => scene3d.selected.add(onSelect), [scene3d, onSelect])

  // Esc leaves the card, so the card object has to go with it.
  useEffect(() => {
    if (focus?.kind !== 'card') setFocusedStar(-1)
  }, [focus])

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
        scene3d.focusedCard?.card.toggleFlip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [chrome, scene3d])

  useProbeSeam({
    enabled: probeWanted,
    planes: data.planes,
    resources: data.resources,
    focusStar,
    pinnedTier,
    scene: scene3d,
    sceneRef,
    focusedStarRef,
    focusedSlugRef,
    cardsRef,
    // A getter, not a value, and deliberately not a dep of the seam's effect: the world the payload
    // describes changes as the camera flies, and a seam that re-installed on each change would be
    // swapped out from under a driver mid-assertion. See `ProbeSeamDeps.worldsSource`.
    //
    // `slug` is forwarded, not dropped: this arrow is the whole join between `worlds(slug)` and the
    // attachment's per-slug lookup, and a `() => scene3d.worldsProbeSource()` here would type-check,
    // answer a payload for every call, and silently reinstate DEC-785 F1's 42-of-45 misattribution.
    worldsSource: (slug) => scene3d.worldsProbeSource(slug),
  })

  const benchContext = useBenchSeam({
    bench: bench !== null,
    data,
    focusStar,
    sceneRef,
    scene: scene3d,
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

  /*
   * PRD 5.3.20 and 9.3 — "the field blooms, the cards do not" — used to be an *array* here, handed
   * to `SelectiveBloom` as its selection. It is now a camera layer that the field's objects enable
   * for themselves (`post/bloomLayer`), which is review finding R4: the array was inert, and the
   * depth pass and mask pass built to honour it were pure cost. Nothing to assemble at this level.
   */

  const focusedCard = focusedStar >= 0 ? cardsRef.current.get(focusedStar) : undefined

  const body = (
    <>
      {/* The canvas's slot. Empty in the React tree on purpose: `SceneHost` appends the element it
          made in `createServices()`, so nothing about the canvas is a value a render can recompute. */}
      <div className="canvas-slot" ref={canvasSlot} />

      {benchContext &&
        bench &&
        bench.renderRunner({
          // The numbers mean nothing until the whole field is drawable (PRD 8.7.3).
          ready: data.starsComplete,
          context: benchContext,
          camera: scene3d.renderer.camera,
          gl: scene3d.renderer.renderer,
          loop: scene3d.renderer.loop,
          qualityTier: tier.tier.label,
          qualityChanges: tier.changes,
          hold: bench.hold ?? null,
          ...(bench.onComplete ? { onComplete: bench.onComplete } : {}),
        })}

      {scene && data.planes && (
        <PlaneLabels
          planes={data.planes}
          rig={scene.rig}
          loop={scene3d.renderer.loop}
          focusedPlaneSlug={focusedSlug}
          level={snapshot?.level ?? 'multiverse'}
          enabled={labelsEnabled}
          fov={FOV}
        />
      )}

      <div className="labels">
        <PlanetHoverLabel state={scene3d.labelState} text={setName} loop={scene3d.renderer.loop} />
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
        host={scene3d}
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
