/**
 * The card tier's browser test seam, behind `?probe=1`.
 *
 * Phase 3's exit criterion is "the full multiverse → card journey works end to end", and the middle
 * of that journey is not reachable by a script that can only click pixels: a star is one to four
 * pixels wide at plane level, and finding a *double-faced* one to satisfy PRD 9.3's checkpoint 4
 * means knowing which card is where. So this publishes the same calls the pointer makes —
 * `focusStar` is literally the click handler's callee — and the assertions in
 * `scripts/verify-browser.mjs` are made against the state that follows.
 *
 * The same shape as Phase 2a's `./selfCheck`: nothing is installed unless the URL asks, and what it
 * exposes is the product's own code path rather than a second implementation of it.
 */

import type { WorldsProbe } from './worlds/worldsProbe'

export interface ProbeCardState {
  readonly name: string
  readonly printings: number
  readonly planets: number
  readonly overflow: number
  readonly canFlip: boolean
  readonly flipped: boolean
  readonly activePrinting: number
  readonly starIndex: number
}

export interface ProbeState {
  readonly focus: string
  readonly level: string
  readonly flying: boolean
  readonly cameraDistance: number
  readonly planeSlug: string | null
  /** Cards of the focused plane whose shards have landed. */
  readonly cardsLoaded: number
  readonly thumbnails: {
    readonly drawn: number
    readonly cells: number
    readonly capacity: number
    readonly requested: number
    readonly loaded: number
    readonly failed: number
  }
  readonly images: {
    readonly inFlight: number
    readonly waiting: number
    readonly completed: number
    readonly failed: number
    readonly peakInFlight: number
  }
  readonly gpu: {
    readonly atlasBytes: number
    readonly cardBytes: number
    readonly totalBytes: number
    readonly targetBytes: number
    readonly ceilingBytes: number
    readonly withinTarget: boolean
    readonly withinCeiling: boolean
  }
  /**
   * What the quality ladder has actually done to the frame, for PRD 9.1.4's forced-degradation
   * check (`?quality=N`, see `scene/quality/adaptiveQuality`).
   *
   * Every field below `tier` is read back off a live object — the renderer, the bloom's render
   * target, the atlas, the geometry, the shader uniform — rather than off `QUALITY_TIERS`. That is
   * the whole point: a tier the scene *reports* proves nothing, and until Phase 6 no caller had ever
   * pinned one, so no rung of the ladder had been watched landing. `starsDrawn` and `motion` are
   * here for the other half of PRD 8.5.11 — that geometry and motion never degrade.
   */
  readonly quality: {
    readonly tier: string
    readonly tierIndex: number
    /** The tier `?quality=` pinned, or `null` when the ladder is free to move. */
    readonly pinned: number | null
    /** `WebGLRenderer.getPixelRatio()`, which the ladder's first rung caps. */
    readonly pixelRatio: number
    readonly drawingBuffer: { readonly width: number; readonly height: number }
    /**
     * The target the field draws its bloom source into, and that the blur chain runs from.
     * `null` before the chain's first `configure`, which is not the same as "no bloom".
     *
     * **One size, where there used to be two** (DEC-703, review finding R3). The old chain
     * reported a `bloom` and a `bloomBlur` because `resolutionScale` sized a target that nothing
     * sampled while the composite read a different one off `mipmapBlur`, so the rung the ladder
     * pulled and the pixels the frame paid for were two unrelated numbers. Here they are the same
     * number: `drawingBuffer * tier.bloomScale`, rounded, and everything downstream is a mip of
     * it. It moves with the bloom rung *and* the pixel-ratio rung, because both are real.
     */
    readonly bloomSource: { readonly width: number; readonly height: number } | null
    /**
     * Mip levels in the blur chain, from the tier (`postTuning.FULL` / `REDUCED`). `0` before the
     * first `configure`.
     *
     * The bloom rung moves this as well as {@link bloomSource}: reach is a function of both, and
     * a quarter-size source at the same level count would blur a *smaller* angular radius rather
     * than a cheaper one. See `scene/post/postTuning`.
     */
    readonly bloomLevels: number
    /**
     * Whether the chain got `EXT_color_buffer_float` and allocated half-float targets.
     *
     * `false` means an 8-bit bloom source, which is why `scene/post/capabilities` floors the free
     * ladder two rungs down on such a GPU (review §3.7). Reported so a bench run on hardware we
     * do not own says which of the two pictures it measured.
     */
    readonly bloomFloatTargets: boolean
    /** The atlas's live capacity, after `CardTier.setCapacity`. */
    readonly thumbnailCapacity: number
    readonly starsDrawn: number
    /** The `uMotion` uniform the star shader reads. */
    readonly motion: number
    /**
     * The frame-interval band the monitor is judging against, in milliseconds, and the display
     * period it derived them from (DEC-692 R5). Absolute thresholds measured the monitor rather
     * than the app; these are what replaced them.
     */
    readonly refreshMs: number
    readonly degradeMs: number
    readonly restoreMs: number
    /**
     * The name of the glow program the mesh is actually drawn with — the ladder's bottom rung
     * (DEC-739, review §3.5's "new tier 4 cheap glow variant").
     *
     * `material.name`, read off the live mesh, and not the tier's `glow` field. That distinction is
     * the whole reason this is here: the tier's field is what was *asked for*, and every previous
     * rung in this ladder has at some point reported an intention it did not deliver — the `dpr`
     * prop (R2), `resolutionScale` (R3), the selection mask (R4). `shaderNames.ts` gives the two
     * glow programs different names precisely so this can tell them apart.
     */
    readonly glowShader: string
  }
  /**
   * What the platform layer found when it asked the GPU, at boot (DEC-739, review §3.5, §3.7).
   *
   * Everything here describes hardware the team does not own, which is why it is on the probe at
   * all: a `?probe=1` run from a Windows laptop is only readable if it says which answers it was
   * measured under. The same object goes into the bench JSON through `capabilitiesForBench`.
   *
   * **Do not wait on a field of this object, and in particular not on `halfFloatProbeMs`**
   * (DEC-756 N8). Read before the boot probe has run, this block returns `halfFloatProbeMs: 0`,
   * `halfFloatProbeOk: false`, `positionMode: 'float16'` and `webgl2: false` — and every one of
   * those is a plausible value. `ok: false` with a duration of 0 is a real code path in
   * `probeOnThrowawayContext`, so the snapshot reads exactly like "the probe could not get a
   * context" rather than like "you read too early"; the only tell is `webgl2: false` contradicting
   * `positionMode: 'float16'`. It has cost one measurement round already.
   *
   * Gate on {@link ProbeState.programWarmup} being non-null, which is what `e2e/quality.spec.ts`
   * does, or on `platform.webgl2 === true`. Both go false-to-true exactly once and neither has a
   * plausible-looking initial value.
   */
  readonly platform: {
    readonly webgl2: boolean
    readonly maxTextureSize: number
    /** `MAX_TEXTURE_SIZE >= 4096`, which PRD 8.5.8's atlas needs. */
    readonly atlasAffordable: boolean
    /** `ALIASED_POINT_SIZE_RANGE`, which the star field clamps `uMaxPixels` and the pick floor to. */
    readonly pointSizeMax: number
    readonly maxArrayTextureLayers: number
    readonly parallelShaderCompile: boolean
    /** Chosen by the half-float probe, not by `?positions=`, unless the URL overrode it. */
    readonly positionMode: string
    readonly halfFloatProbeOk: boolean
    readonly halfFloatProbeMs: number
    /**
     * The largest sprite the star shader will ask for, in device pixels, after the clamp.
     *
     * The clamp is unobservable from outside — a driver silently clamps `gl_PointSize` and says
     * nothing — so the *app's* side of it is reported instead: this is `uMaxPixels` read off the
     * live material, and it must never exceed {@link pointSizeMax}.
     */
    readonly starMaxPixels: number
  }
  /**
   * The backing store the compositor is giving the canvas, from `device-pixel-content-box`
   * (DEC-739). `null` before the first `ResizeObserver` callback.
   *
   * `exact` says whether the numbers came from that box or were reconstructed from the CSS box and
   * `devicePixelRatio` — two different claims, and a fallback that pretended to be the first would
   * make this whole reading unverifiable.
   */
  readonly backingStore: {
    readonly cssWidth: number
    readonly cssHeight: number
    readonly devicePixelWidth: number
    readonly devicePixelHeight: number
    readonly ratio: number
    readonly exact: boolean
  } | null
  /**
   * What the boot-time program warm-up did (DEC-739, DEC-645). `null` until it has finished.
   *
   * `specs` is the number of distinct (geometry, material) pairs linked, deduped — so it counts
   * programs rather than scene-graph nodes. A run where this stays `null` after the intro is a run
   * where every program is still linking on its first draw, which is the 322-362 ms stall DEC-645
   * measured and this exists to move.
   */
  readonly programWarmup: {
    readonly specs: number
    readonly durationMs: number
    readonly parallel: boolean
    readonly error: string | null
  } | null
  readonly card: ProbeCardState | null
  /**
   * How far the focused card is drawn from the point the camera is looking at, in world units.
   *
   * PRD 5.6.1 flies the camera to *frame* the card, so this is the whole claim as one number. It is
   * not a formality: the card is drawn by the star field's motion function and the camera aims at
   * the rig's tether, and those were two different functions until Phase 3 made them one. A card
   * 0.63 units wide framed from 2.2 units away shows a tenth of a unit of disagreement plainly.
   */
  readonly cardFrameOffset: number
  /**
   * Where the focused card lands on screen, as a fraction of the viewport (0.5, 0.5 is the centre).
   *
   * The world-space offset above says the camera *aims* at the card. This says the projection
   * agrees, and only the pair of them is PRD 5.6.1's "the camera flies to frame it".
   */
  readonly cardScreen: { readonly x: number; readonly y: number } | null
  /**
   * The true eye-to-card distance, beside the rig's own `cameraDistance`.
   *
   * They are not the same quantity: the rig's is the spherical radius it maintains, and PRD 5.7.5's
   * collision avoidance moves the camera afterwards without revising it. What the card subtends on
   * screen follows this one.
   */
  readonly cardEyeDistance: number
}

export interface Probe {
  state: () => ProbeState
  /** Planes with cards, largest first — enough to choose one to fly to. */
  planes: () => Array<{ slug: string; index: number; cardCount: number }>
  focusPlane: (slug: string) => boolean
  /**
   * Focus a card of the currently focused plane. `dfc` picks one with a genuine back image, for
   * PRD 9.3's checkpoint 4; otherwise cards are ranked by printing count, most first, and `nth`
   * indexes that ranking — so the planets of PRD 5.6.7 have something to show, and a caller can
   * walk several distinct cards. Returns the star index, or -1 if there is no `nth` card.
   */
  focusCard: (options?: { dfc?: boolean; nth?: number }) => number
  flip: () => boolean
  activatePrinting: (index: number) => boolean
  /** Star indices the thumbnail tier is currently drawing. */
  thumbnailStars: () => number[]
  /**
   * Where a planet of the focused card is, as a fraction of the viewport. `null` if there is no
   * such planet or it is behind the camera.
   *
   * Deliberately **not** an assertion seam. It exists so the browser check can aim a real pointer
   * at a real planet: everything it then asserts — the hover label, the active printing — is read
   * back out of the DOM, having gone through the id buffer and the pick path the user's pointer
   * uses. PRD 5.6.9's hover shipped broken precisely because every planet assertion went through
   * `activatePrinting`, which bypasses the picker entirely.
   */
  planetScreen: (index: number) => { x: number; y: number } | null
  /**
   * The worlds payload (spec §3.1) — **R1's normative surface, consumed by leg G's gate**.
   *
   * `undefined` when no world is composed, and that is the contract rather than a gap: leg G
   * reports "the worlds probe is not installed on this page" as a **setup failure**, which is a
   * different verdict from a criterion going red. Returning an empty payload instead would let a
   * page with no worlds on it score a green matrix.
   *
   * Separate from {@link Probe.state} because the per-cell array runs to thousands of entries on
   * Dominaria and has no business in the object the readout panel renders from every frame.
   */
  worlds: () => WorldsProbe | undefined
}

declare global {
  interface Window {
    __eternitiesProbe?: Probe
  }
}

/**
 * Which page the seam is asked for on.
 *
 * `?probe=1` is Phase 3's scene with its readout panel, which is what `scripts/verify-browser.mjs`
 * drives the card tier through and what every review up to Phase 6 was captured against.
 *
 * `?probe=shell` is the same seam **inside the shipped composition** — the default route, scene and
 * HUD together. PRD 9.3's review is of what ships, and after Phase 6 joined the scene into the
 * shell the scene alone is no longer that. The alternative was to drive the shell entirely through
 * its own chrome, which reaches the checkpoints but cannot measure them: the shell mounts
 * `SceneView` with `chrome: false`, so there is no readout panel on it, and 9.3's thumbnail
 * cross-fade criterion is a question about `thumbnails.drawn` crossing PRD 5.5.1's 24 px band —
 * a number that exists nowhere else. `SceneView` installs the seam wherever it is mounted; only
 * the routing in `App.tsx` decided which page that was.
 */
export type ProbeTarget = 'scene' | 'shell'

export function probeTarget(
  search: string = typeof location === 'undefined' ? '' : location.search,
): ProbeTarget | null {
  const value = new URLSearchParams(search).get('probe')
  if (value === null || value === '0') return null
  return value === 'shell' ? 'shell' : 'scene'
}

export function probeRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  return probeTarget(search) !== null
}
