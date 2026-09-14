/**
 * The local bench of implementation-plan §6, in the page.
 *
 * Flies the fixed path of `./benchPath`, records one sample per frame, and publishes a JSON
 * summary on `window.__eternitiesBench` for `scripts/bench.mjs` to read. Nothing here runs unless
 * the URL asks for it, and the recorder allocates its buffers up front (PRD 7.3.2).
 *
 * What it measures, against PRD 7.2:
 *   - steady-state frame rate at every level, per path segment (target 60 fps, ceiling 50);
 *   - p95 frame time (target ≤ 16.7 ms, ceiling 33 ms), the row that covers fly-to;
 *   - CPU time per frame in the render loop (target ≤ 2 ms, ceiling 4 ms), reported by the scene
 *     itself through `recordBenchCpu` rather than guessed at from the outside.
 *
 * Frame *rate* is capped by the display's refresh, so the honest reading of a 60 fps result on a
 * 60 Hz panel is "never missed a vsync"; the frame-time percentiles say how much headroom is left,
 * which is why they are reported alongside and not instead.
 */

import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { Vector3, type PerspectiveCamera, type WebGLRenderer } from 'three'

import { BLIND_ETERNITIES_SLUG } from '../data/types'
import type { FrameLoop } from '../scene/renderer/frameLoop'
import { planeWorldPosition } from '../scene/starfield/motion'
import type { PlaneTable } from '../scene/starfield/planeTable'
import {
  BENCH_DURATION_S,
  BENCH_PATH,
  anchorPlane,
  benchPose,
  segmentEndTime,
  segmentSeconds,
  smallPlane,
  type BenchAnchors,
  type BenchPose,
} from './benchPath'
import { benchCpuMs } from './cpuSamples'

/**
 * The path is 39 s (`BENCH_DURATION_S`, nine segments). An uncapped run on a fast GPU reaches
 * ~700 fps, so this holds a whole run with room to spare — 39 × 670 ≈ 26k — and `saturated` says so
 * plainly if a future machine ever exceeds it, rather than silently dropping the tail of the path
 * from the percentiles.
 */
const CAPACITY = 40000
/** Frames discarded at the start of each segment, so a segment's numbers are its own. */
const SETTLE_FRAMES = 6
/**
 * …but never for more than this share of the segment's own duration.
 *
 * A frame count is the right unit for settling — what is being waited out is the pipeline flushing
 * the previous segment's work, which is measured in frames, not seconds. It is the wrong unit for
 * *bounding* the wait. On the reference machine six frames is 9–50 ms out of a four-second segment
 * and this cap is nowhere near binding. On a software rasteriser managing about a frame a second it
 * is the entire segment, and the bench then reports a completed run with **zero** samples in it and
 * an empty `segments` array — a result that looks like a result and is not one. CI caught exactly
 * that on a two-core runner.
 *
 * 20% is chosen to be unreachable on any machine the numbers are meant for, so the reference
 * baseline is untouched, while still guaranteeing every segment contributes samples.
 */
const SETTLE_MAX_FRACTION = 0.2
/** The last chunk of `stars.bin` and its fade-in are not steady state. */
const WARMUP_MS = 800
/**
 * How long a `?hold=` will wait for its segment's contents before giving up and saying so.
 *
 * Only `card` ever waits: it needs the anchor plane's shards, which the recorded path budgets five
 * seconds for (the `approach` segment). Twenty is generously above that on a cold cache and a slow
 * link, and well under `bench.mjs --shots`'s 120 s page timeout, so the page reports the failure
 * itself instead of the harness reporting a timeout it cannot explain.
 */
const HOLD_TIMEOUT_S = 20

/**
 * Whether this frame is still settling into its segment, and so should not be recorded.
 *
 * Exported because it is the one part of the recording rule that can be reasoned about without a
 * GPU, and `test/starfield.test.ts` pins both halves of the `&&`.
 */
export function stillSettling(
  framesLeft: number,
  segmentElapsedS: number,
  segmentDurationS: number,
): boolean {
  return framesLeft > 0 && segmentElapsedS < SETTLE_MAX_FRACTION * segmentDurationS
}

export interface BenchSummary {
  readonly frames: number
  readonly fps: number
  readonly frameMsP50: number
  readonly frameMsP95: number
  readonly frameMsMax: number
  readonly cpuMsP50: number
  readonly cpuMsP95: number
}

export interface BenchSegmentResult extends BenchSummary {
  readonly segment: string
}

export interface BenchResult extends BenchSummary {
  readonly dataset: string
  readonly stars: number
  readonly planes: number
  readonly positionMode: string
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number }
  readonly renderer: string
  readonly durationS: number
  readonly qualityTier: string
  readonly qualityChanges: number
  readonly anchorPlane: string
  readonly segments: readonly BenchSegmentResult[]
  /** True if the sample buffer filled and the tail of the path went unrecorded. */
  readonly saturated: boolean
  /**
   * Segments whose scene state could not be established. In practice that is `card`, whose focus
   * fails until the anchor plane's shards have arrived; the plane segments can also land here, but
   * only on a dataset that offered no plane to aim at.
   *
   * Without this a run whose card never resolved would report a `card` segment measuring an empty
   * sky, with nothing in the result to tell it apart from a good one, and a baseline could be
   * recorded against the wrong contents. `bench.mjs` refuses to summarise when this is non-empty.
   */
  readonly undrivenSegments: readonly string[]
  /** PRD 7.2's two thresholds, evaluated here so the harness cannot disagree with the page. */
  readonly meetsTarget: boolean
  readonly meetsCeiling: boolean
}

declare global {
  interface Window {
    __eternitiesBench?: BenchResult
    __eternitiesBenchProgress?: { elapsed: number; total: number; frames: number }
    /**
     * Set once the camera has been parked at a named segment and `driveSegment` has reported that
     * segment's focus established, for a screenshot. `bench.mjs --shots` waits on this.
     *
     * **What that is worth depends on the segment, and only `card` gets a real wait.**
     * `focusCard` genuinely fails until the anchor plane's shards have arrived, so a `card` hold
     * retries and this stays undefined meanwhile, which is the gate. Every
     * other segment issues a focus that cannot fail, so this is set on the first frame and says
     * nothing about whether the segment's *contents* have loaded. A `sheet` hold signals with
     * `thumbnails.requested` still at 0; what actually gives its atlas time to fill is the fixed
     * 2 s sleep in `bench.mjs` after this resolves, not this flag. Do not read a signal here as
     * "the picture is ready" for anything but `card`.
     */
    __eternitiesHold?: string
    /**
     * Why a hold gave up, if it did. `bench.mjs --shots` fails on this rather than photographing
     * the right camera pose over the wrong contents.
     */
    __eternitiesHoldError?: string
  }
}

/**
 * What the bench needs from the scene it is flying over, beyond the geometry.
 *
 * Optional as a whole, and that is the difference between the two callers. Phase 2a's harness has
 * no navigation and no card tier, so it supplies none of this and the run measures the star field
 * alone — which is what the Phase 2a baseline was. `/bench` supplies all of it, so the segments PRD
 * 9.1.2 names actually contain what they are named after: the sheet segment has thumbnails in it
 * because a plane is focused, and the card segment has a card because one was asked for.
 *
 * Without this the card and sheet segments would photograph an empty sky and report a frame time
 * that no user will ever see.
 */
export interface BenchDrive {
  /** Focus a plane, so its shards load and the thumbnail tier fills (PRD 8.7.6). */
  readonly focusPlane: (slug: string) => void
  /** Focus the plane's most-printed card, for PRD 5.6.7's planets. Returns false if none is ready. */
  readonly focusCard: () => boolean
  /** PRD 9.1.2's "Esc back to multiverse". */
  readonly focusMultiverse: () => void
  /** The focused card's live world position, or false if no card is placed. */
  readonly cardPosition: (out: Vector3) => boolean
}

export interface BenchContext {
  readonly dataset: string
  readonly stars: number
  readonly planes: number
  readonly positionMode: string
  readonly multiverseRadius: number
  /** The live plane table, so the path can track a real plane as it drifts and turns. */
  readonly table: PlaneTable
  /** Present when the bench is flying the shipped scene rather than Phase 2a's harness. */
  readonly drive?: BenchDrive
}

export interface BenchRunnerProps {
  /** The bench only starts once the whole fixture is drawable, or the numbers mean nothing. */
  readonly ready: boolean
  readonly context: BenchContext
  /**
   * The camera the path flies, the renderer it reports, and the loop it steps on (review §3.6
   * phase 3).
   *
   * Arguments rather than `useThree` reads. The bench is the one caller that *owns* the camera for
   * the duration of a run — `SceneView` does not attach the rig when a bench is present, because two
   * things cannot fly one camera — and it says so by taking the camera rather than by reaching into
   * a store that would have handed it the same object either way.
   */
  readonly camera: PerspectiveCamera
  readonly gl: WebGLRenderer
  readonly loop: FrameLoop
  /** Live tier label from the quality monitor, and how many times it has changed. */
  readonly qualityTier: string
  readonly qualityChanges: number
  /**
   * Park the camera at the end of this named segment instead of flying and recording. This is how
   * the visual checks get a reproducible frame; nothing is measured in this mode.
   */
  readonly hold?: string | null
  readonly onComplete?: (result: BenchResult) => void
}

/** Whether the URL asked for a bench run. */
export function benchRequested(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  const value = new URLSearchParams(search).get('bench')
  return value !== null && value !== '0'
}

/** Which segment the URL asked the camera to be parked at, if any. */
export function benchHold(
  search = typeof location === 'undefined' ? '' : location.search,
): string | null {
  return new URLSearchParams(search).get('hold')
}

export function BenchRunner({
  ready,
  context,
  qualityTier,
  qualityChanges,
  camera,
  gl,
  loop,
  hold = null,
  onComplete,
}: BenchRunnerProps): ReactElement | null {

  const state = useRef({
    running: false,
    finished: false,
    elapsed: 0,
    count: 0,
    settle: SETTLE_FRAMES,
    segment: '',
    /** Time spent in the current segment, which bounds the settle above. */
    segmentElapsed: 0,
    segmentSeconds: BENCH_PATH[0]?.seconds ?? 0,
    /** Hold mode only: whether the held segment's scene state has been established yet. */
    holdDriven: false,
    /** Hold mode only: seconds spent retrying that, bounded by `HOLD_TIMEOUT_S`. */
    holdElapsed: 0,
    holdFailed: false,
    /** Recorded runs: segments whose `driveSegment` reported failure. Surfaced on `BenchResult`. */
    undriven: [] as string[],
    /**
     * Read once during warm-up rather than at teardown. `rendererName` is a synchronous round trip
     * to the GPU process, which cannot answer until the command buffer has drained — and uncapped
     * that buffer is hundreds of frames deep, so the same call cost 343 ms at the end of a run
     * It is the same mechanism as the three.js shader-link stall;
     * here it was the bench's own, and it produced a ~400 ms long-animation-frame that looked like
     * the scene's. During warm-up the queue is shallow and the answer is immediate.
     */
    renderer: 'unknown',
  }).current
  const frameMs = useMemo(() => new Float32Array(CAPACITY), [])
  const cpuMs = useMemo(() => new Float32Array(CAPACITY), [])
  const segmentIds = useMemo(() => new Uint8Array(CAPACITY), [])
  const pose = useRef<BenchPose>({
    segment: 'home',
    px: 0,
    py: 0,
    pz: 0,
    tx: 0,
    ty: 0,
    tz: 0,
  }).current
  const target = useRef(new Vector3()).current
  const centre = useRef(new Vector3()).current

  const records = useMemo(
    () => context.table.planes.map((state) => state.record),
    [context.table],
  )
  const anchor = useMemo(() => anchorPlane(records), [records])
  const small = useMemo(() => smallPlane(records), [records])
  const anchors = useRef<BenchAnchors>({
    multiverseRadius: context.multiverseRadius,
    planeRadius: anchor?.radius ?? context.multiverseRadius * 0.1,
    planeX: 0,
    planeY: 0,
    planeZ: 0,
    smallRadius: small?.radius ?? context.multiverseRadius * 0.02,
    smallX: 0,
    smallY: 0,
    smallZ: 0,
    dustX: 0,
    dustY: 0,
    dustZ: 0,
    cardX: 0,
    cardY: 0,
    cardZ: 0,
  }).current

  /** Re-read the live positions. PRD 5.7.4: targets live in the rotating frame. */
  const trackAnchors = (): void => {
    if (anchor) {
      planeWorldPosition(
        context.table.raw,
        anchor.index,
        context.table.time,
        context.table.multiverseAngle,
        1,
        centre,
      )
      anchors.planeX = centre.x
      anchors.planeY = centre.y
      anchors.planeZ = centre.z
      // A dust vantage point: the same direction from the centre, pulled well inside the plane, so
      // the camera sits in the connecting tissue rather than in a galaxy (PRD 8.6.3).
      anchors.dustX = centre.x * 0.45
      anchors.dustY = centre.y * 0.45
      anchors.dustZ = centre.z * 0.45
    }
    if (small) {
      planeWorldPosition(
        context.table.raw,
        small.index,
        context.table.time,
        context.table.multiverseAngle,
        1,
        centre,
      )
      anchors.smallX = centre.x
      anchors.smallY = centre.y
      anchors.smallZ = centre.z
    }
    // The card is placed by the card tier, so it is read rather than derived. Until one exists the
    // `card` keyframe resolves about the origin, which is why the runner does not enter that
    // segment's pose until `focusCard` has answered.
    if (context.drive?.cardPosition(centre) === true) {
      anchors.cardX = centre.x
      anchors.cardY = centre.y
      anchors.cardZ = centre.z
    }
  }
  const live = useRef({ onComplete, qualityTier, qualityChanges })
  live.current = { onComplete, qualityTier, qualityChanges }

  /**
   * Put the scene in the state a segment claims to measure, at the moment the camera enters it.
   *
   * The focus changes are `immediate` in effect — nothing tweens, because the bench owns the camera
   * and the rig is not mounted — so this only changes *what is drawn*, never where the camera is.
   * That separation is the whole point: the path stays byte-identical between runs while the scene
   * under it varies exactly as PRD 9.1.2 describes.
   *
   * The plane focus is issued a segment *early* where it can be. `sheet` needs the anchor plane's
   * shards, and those are a fetch and a worker parse away (PRD 8.7.6); asking for them as `approach`
   * begins gives them the five seconds of the fly-in to arrive, which is the same head start a real
   * user's fly-to gives them. Asking at the segment boundary instead would measure the loading, not
   * the drawing.
   *
   * Returns whether the scene is now in the segment's state. `card` answers `false` when the anchor
   * plane's shards have not arrived and there is no card to focus; the plane segments answer `false`
   * when the dataset yielded no plane to aim at, which only happens if every plane is dust or
   * starless. Every caller has to act on that — discarding it is what let `?hold=card` photograph an
   * empty multiverse. The plane cases must not skip their focus and report success anyway, which
   * would measure whatever the camera happened to be looking at.
   */
  const driveSegment = (segment: string): boolean => {
    const drive = context.drive
    if (!drive) return true
    switch (segment) {
      case 'approach':
      case 'sheet':
        if (anchor) drive.focusPlane(anchor.slug)
        return anchor !== null
      case 'small-plane':
        if (small) drive.focusPlane(small.slug)
        return small !== null
      case 'card':
        return drive.focusCard()
      case 'dust':
        drive.focusPlane(BLIND_ETERNITIES_SLUG)
        return true
      // PRD 9.1.2's "Esc back to multiverse".
      case 'sweep':
        drive.focusMultiverse()
        return true
      default:
        return true
    }
  }

  /**
   * What a held segment needs to have happened before it, in order.
   *
   * A recorded run gets this for free: by the time the camera reaches `card` at 24 s, `approach`
   * focused dominaria twenty seconds earlier and its shards are long since parsed. A hold drives
   * exactly one segment (`state.segment !== hold` fires once), so it has to establish the chain
   * itself — otherwise `focusCard` runs against an empty card map, returns false, and the camera
   * parks at the card keyframe about the world origin over an empty multiverse.
   */
  const holdPrerequisites = (segment: string): readonly string[] =>
    segment === 'card' ? ['sheet'] : []

  useEffect(() => {
    if (hold !== null || !ready || state.running || state.finished) return
    state.renderer = rendererName(gl.domElement)
    const timer = window.setTimeout(() => {
      state.elapsed = 0
      state.count = 0
      state.running = true
    }, WARMUP_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [ready, hold, state, gl])

  /**
   * The bench flies the camera, so it subscribes to the `rig` phase — the phase whose contract is
   * "the camera's matrices are final when this ends" ({@link TICK_PHASES}).
   *
   * That is a stronger statement than the arrangement it replaces. This used to be a default-priority
   * `useFrame`, chosen because a priority above zero would have taken R3F's render loop away from
   * the post chain — so the bench's position in the frame was defined by what it had to avoid rather
   * than by what depends on it. What depends on it is `cards`, which reads the camera's world
   * position, and `draw`, which renders through it; both run after `rig` by construction.
   *
   * `frameRef` is reassigned every render so the subscription is never rebuilt mid-run, which would
   * otherwise reset the segment the path is in.
   */
  const frameRef = useRef<(delta: number) => void>(() => {})
  useEffect(() => loop.subscribe('rig', ({ delta }) => frameRef.current(delta)), [loop])
  frameRef.current = (delta: number): void => {
    if (hold !== null) {
      // Parked: the camera sits at the segment's end pose while the field keeps moving, so a
      // screenshot shows a real frame of a live scene rather than a frozen one.
      const at = segmentEndTime(hold)
      if (at === null) return
      // The scene has to be in the segment's state too, or PRD 9.3's checkpoint photographs the
      // right camera pose over the wrong contents — the empty multiverse a `card` hold used to
      // photograph. Note the limit of what this establishes: it drives the segment's *focus*, and
      // only `card`'s focus can fail, so only `card` is really gated here. A `sheet` hold reports
      // driven on its first frame with an empty atlas; its thumbnails ride `bench.mjs`'s 2 s sleep.
      //
      // The prerequisites and the segment's own focus go once, on the first frame the hold is live,
      // because these are focus changes and repeating them every frame would restart the shard
      // load. `card` is the exception in both directions: it depends on a load it just started, so
      // it is retried — but only until it answers true, after which repeating it would re-focus the
      // same star every frame.
      if (ready && state.segment !== hold) {
        state.segment = hold
        for (const step of holdPrerequisites(hold)) driveSegment(step)
        state.holdDriven = driveSegment(hold)
      } else if (ready && !state.holdDriven && !state.holdFailed) {
        state.holdElapsed += delta
        state.holdDriven = driveSegment(hold)
        if (!state.holdDriven && state.holdElapsed > HOLD_TIMEOUT_S) {
          // Loudly, rather than a plausible-looking photograph of the wrong thing. `__eternitiesHold`
          // stays undefined, so `bench.mjs --shots` never takes the shot.
          window.__eternitiesHoldError =
            `hold "${hold}": the scene never reached this segment's state after ` +
            `${HOLD_TIMEOUT_S}s — no shot taken`
          state.holdFailed = true
        }
      }
      trackAnchors()
      benchPose(at, anchors, pose)
      camera.position.set(pose.px, pose.py, pose.pz)
      target.set(pose.tx, pose.ty, pose.tz)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      if (ready && state.holdDriven) window.__eternitiesHold = hold
      return
    }
    if (!state.running || state.finished) return
    state.elapsed += delta

    trackAnchors()
    benchPose(state.elapsed, anchors, pose)
    if (pose.segment !== state.segment) {
      state.segment = pose.segment
      state.settle = SETTLE_FRAMES
      state.segmentElapsed = 0
      state.segmentSeconds = segmentSeconds(pose.segment) ?? 0
      if (!driveSegment(pose.segment)) state.undriven.push(pose.segment)
    }
    state.segmentElapsed += delta
    camera.position.set(pose.px, pose.py, pose.pz)
    target.set(pose.tx, pose.ty, pose.tz)
    camera.lookAt(target)
    camera.updateMatrixWorld()

    if (stillSettling(state.settle, state.segmentElapsed, state.segmentSeconds)) {
      state.settle -= 1
    } else if (state.count < CAPACITY) {
      frameMs[state.count] = delta * 1000
      cpuMs[state.count] = benchCpuMs()
      segmentIds[state.count] = segmentIndex(state.segment)
      state.count += 1
    }
    window.__eternitiesBenchProgress = {
      elapsed: state.elapsed,
      total: BENCH_DURATION_S,
      frames: state.count,
    }

    if (state.elapsed >= BENCH_DURATION_S) {
      state.finished = true
      state.running = false
      const result = summarise(
        frameMs.subarray(0, state.count),
        cpuMs.subarray(0, state.count),
        segmentIds.subarray(0, state.count),
        context,
        gl.domElement,
        state.renderer,
        gl.getPixelRatio(),
        live.current,
        anchor?.slug ?? 'none',
        state.count >= CAPACITY,
        state.undriven,
      )
      window.__eternitiesBench = result
      live.current.onComplete?.(result)
    }
  }

  return null
}

function segmentIndex(name: string): number {
  const index = BENCH_PATH.findIndex((key) => key.name === name)
  return index < 0 ? 255 : index
}

function summarise(
  frames: Float32Array,
  cpu: Float32Array,
  segments: Uint8Array,
  context: BenchContext,
  canvas: HTMLCanvasElement,
  renderer: string,
  dpr: number,
  quality: { qualityTier: string; qualityChanges: number },
  anchor: string,
  saturated: boolean,
  undriven: readonly string[],
): BenchResult {
  const overall = summariseRange(frames, cpu)

  const perSegment: BenchSegmentResult[] = []
  for (let i = 0; i < BENCH_PATH.length; i += 1) {
    let count = 0
    for (let f = 0; f < frames.length; f += 1) if (segments[f] === i) count += 1
    if (count === 0) continue
    const picked = new Float32Array(count)
    const pickedCpu = new Float32Array(count)
    let at = 0
    for (let f = 0; f < frames.length; f += 1) {
      if (segments[f] !== i) continue
      picked[at] = frames[f]!
      pickedCpu[at] = cpu[f]!
      at += 1
    }
    perSegment.push({ segment: BENCH_PATH[i]!.name, ...summariseRange(picked, pickedCpu) })
  }

  return {
    dataset: context.dataset,
    stars: context.stars,
    planes: context.planes,
    positionMode: context.positionMode,
    viewport: {
      width: Math.round(canvas.clientWidth),
      height: Math.round(canvas.clientHeight),
      dpr,
    },
    renderer,
    durationS: BENCH_DURATION_S,
    qualityTier: quality.qualityTier,
    qualityChanges: quality.qualityChanges,
    anchorPlane: anchor,
    segments: perSegment,
    saturated,
    undrivenSegments: [...undriven],
    ...overall,
    // PRD 7.2: 60 fps target, 50 fps ceiling; p95 frame time 16.7 ms target, 33 ms ceiling. The
    // fps target allows one frame of slack, because a vsync-locked 60 Hz display samples at 59.9x.
    meetsTarget: overall.fps >= 59 && overall.frameMsP95 <= 16.7,
    meetsCeiling: overall.fps >= 50 && overall.frameMsP95 <= 33,
  }
}

/** Which GPU actually drew this, so a bench result can never be mistaken for a software render. */
function rendererName(canvas: HTMLCanvasElement): string {
  const gl = canvas.getContext('webgl2')
  if (!gl) return 'no webgl2'
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  if (debug) return String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
  return String(gl.getParameter(gl.RENDERER))
}

function summariseRange(frames: Float32Array, cpu: Float32Array): BenchSummary {
  const sorted = Float32Array.from(frames).sort()
  const sortedCpu = Float32Array.from(cpu).sort()
  let total = 0
  for (let i = 0; i < frames.length; i += 1) total += frames[i]!
  return {
    frames: frames.length,
    fps: total > 0 ? round((frames.length * 1000) / total) : 0,
    frameMsP50: round(percentile(sorted, 0.5)),
    frameMsP95: round(percentile(sorted, 0.95)),
    frameMsMax: round(sorted.length > 0 ? sorted[sorted.length - 1]! : 0),
    cpuMsP50: round(percentile(sortedCpu, 0.5)),
    cpuMsP95: round(percentile(sortedCpu, 0.95)),
  }
}

function percentile(sorted: Float32Array, quantile: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]!
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
