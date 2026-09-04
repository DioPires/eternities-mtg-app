/**
 * The one claim in Phase 2a that cannot be checked without a GPU: that the CPU motion mirror of
 * PRD 8.5.7 agrees with the vertex shader of PRD 8.5.3.
 *
 * The two are written from the same constants and the same lattice hash, but "written from" is not
 * "agrees with", and the failure mode is quiet — Phase 2b's camera would frame a spot next to the
 * star it flew to, and nothing would throw.
 *
 * The check closes the loop through the id buffer, which is the only place the shader's own idea
 * of where a star is becomes readable:
 *
 *   1. take a star index;
 *   2. compute its world position on the CPU with `starWorldPosition`;
 *   3. project that with the camera to a device pixel;
 *   4. render the pick window around that pixel, and find *that star* in it.
 *
 * Step 4 is the whole thing, and it is deliberately not "ask what is under that pixel". What is
 * under the pixel is the answer to a click; it is the nearest star, which in a crowded field is
 * usually a different one, and judging it means comparing the sampled star's mirrored position
 * against the neighbour's mirrored position — the mirror on both sides of its own exam. An error
 * the two share cancels, and because the mirror is per plane row, sharing is exactly what a real
 * bug in it would do. Asking where one nominated star was rasterised puts the CPU on one side and
 * the GPU on the other and nothing in between.
 *
 * Two things follow, both worth knowing before reading a result. A star inside a galaxy core is
 * covered by a nearer sprite and cannot be found at all — that is `unmeasured`, and it is a fact
 * about the fixture, so the run samples widely and demands a floor of real measurements rather
 * than a share of them. And the resolution is the pixel grid: see `COINCIDENT_PX` for what size of
 * disagreement this does and does not catch, which was measured by injection rather than assumed.
 *
 * Nothing runs unless `?selfcheck=1` asks for it. `scripts/verify-browser.mjs` is the caller.
 */

import { Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import type { IdPicker } from './picking/idPicker'
import { starWorldPosition } from './starfield/motion'
import type { StarField } from './starfield/starFieldObjects'
import type { StarGeometry } from './starfield/starGeometry'
import type { PlaneTable } from './starfield/planeTable'
import { SELF_CHECK_PICK_MIN_PX } from './tuning'

export interface SelfCheckResult {
  readonly checked: number
  readonly agreed: number
  readonly offScreen: number
  /**
   * Stars where the picker returned a *different* star that the mirror also places on the same
   * pixel. Inside a galaxy's core several stars share a pixel and the id pass depth-sorts them, so
   * this is the id buffer working correctly, not the mirror being wrong — and the mirror still had
   * to be right about the other star for it to land there.
   */
  readonly occluded: number
  /**
   * Samples where the star was nowhere in its own pick window. Either the mirror is more than half
   * a window out or a nearer sprite covered it entirely; from inside the check the two look the
   * same, so these are counted rather than judged. A run made almost entirely of these has
   * measured nothing, which is what `ok` guards against.
   */
  readonly unmeasured: number
  /** `[planeRow, count]` for the unmeasurable samples, commonest first. */
  readonly unmeasuredRows: readonly (readonly [number, number])[]
  /**
   * Stars the shader drew further from the mirror's pixel than the tolerance allows. Real
   * disagreements, measured against the shader rather than against the mirror's own other answers.
   */
  readonly missed: readonly {
    readonly index: number
    readonly picked: number
    readonly planeRow: number
    readonly x: number
    readonly y: number
    /** NDC depth of the sample. Outside [-1, 1] means the projection was never on screen. */
    readonly z: number
    /** How far from the mirror's pixel the shader actually drew this star, in device pixels. */
    readonly drawnAtPx: number
  }[]
  /** The drawing buffer the check measured against, for diagnosing a stretched canvas. */
  readonly buffer: readonly [number, number]
  /**
   * Length of a PNG round-trip of the renderer's own canvas. A sky-only frame compresses to a
   * fraction of what a frame with thousands of additive points does, so this is the "did anything
   * actually draw" smoke check — taken here rather than from a DOM query, because the renderer
   * knows which canvas is its own.
   */
  readonly canvasBytes: number
  /**
   * Mean and worst distance, in device pixels, between the pixel the mirror predicted and where
   * the shader actually put a star — measured inside the pick window when the right star came
   * back, and against the neighbour's own mirrored position when a different one did.
   *
   * This, not the agreed/occluded split, is the check's real output. The counts are bucketed by a
   * tolerance; these are the underlying measurement, at pixel resolution.
   */
  readonly meanOffsetPx: number
  readonly maxOffsetPx: number
  /** How many samples the offsets above are over: `checked` minus `unmeasured`. */
  readonly measured: number
  /** The pick sprite floor the check ran at, in CSS pixels. What the numbers above are relative to. */
  readonly spriteFloorPx: number
  /** How far a neighbour could sit from the queried pixel and still count as sharing it. */
  readonly tolerancePx: number
  readonly positionMode: string
  readonly ok: boolean
}

declare global {
  interface Window {
    __eternitiesSelfCheck?: SelfCheckResult
  }
}

export function selfCheckRequested(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  const value = new URLSearchParams(search).get('selfcheck')
  return value !== null && value !== '0'
}

const world = new Vector3()

/**
 * How far the shader may draw a star from the pixel the mirror predicted, in device pixels.
 *
 * The bound has to be narrower than the disagreement it exists to detect, and the quantity it
 * bounds has to be the right one. Neither used to hold. The old check compared the sampled star's
 * mirrored pixel against *another star's mirrored pixel*, which puts the mirror on both sides of
 * the comparison: an error the two stars share — a whole plane row drifting together, which is the
 * shape a per-row mirror bug actually takes — cancels exactly and reads as agreement. And it
 * allowed 6 px, over half the pick window, while picking at an inflated 7 px sprite that made
 * almost every sample land on a neighbour in the first place.
 *
 * What is bounded now is `IdPicker.distanceTo`: the CPU's predicted pixel against the GPU's own
 * rasterisation of that same star, with nothing else in the comparison. Measured on Metal at the
 * 2 px self-check sprite, the worst disagreement is 1.0 px on both fixtures and the mean is 0.2–0.3
 * px, most of which is the window's own pixel quantisation.
 *
 * Sensitivity, stated plainly: a per-star error of 3 px or more fails, and a systematic drift
 * shows in `meanOffsetPx` from about 1.5 px. Below that the check passes — verified by injection,
 * not assumed. A 4 px error confined to the dust row fails and names the row.
 */
const COINCIDENT_PX = 3

/**
 * How many stars the run has to have actually located before its verdict counts.
 *
 * A star inside a galaxy core is covered by a nearer sprite and cannot be found in the id buffer
 * at all, so on a dense fixture much of the sample is unmeasurable however many are taken — 14 of
 * 24 on `fixture-scale`. That is a fact about the field, not about the mirror, and the honest
 * response is to sample more and require a real number of hits rather than a share of them.
 */
const MIN_MEASURED = 16

/** Where the CPU mirror says a star is, in device pixels. `null` when it is off screen. */
function mirrorPixel(
  index: number,
  table: PlaneTable,
  geometry: StarGeometry,
  camera: PerspectiveCamera,
  motion: number,
  width: number,
  height: number,
  out: Vector3,
): { x: number; y: number; z: number } | null {
  geometry.localPosition(index, out)
  starWorldPosition(
    table.raw,
    geometry.planeRowOf(index),
    out.x,
    out.y,
    out.z,
    table.time,
    table.multiverseAngle,
    motion,
    out,
  )
  out.project(camera)
  if (Math.abs(out.x) > 1 || Math.abs(out.y) > 1 || out.z > 1) return null
  return { x: ((out.x + 1) / 2) * width, y: ((1 - out.y) / 2) * height, z: out.z }
}

/**
 * Run the check over a spread of star indices. Slow by design — one render pass and one readback
 * per star — so it is a diagnostic, never something the frame loop does.
 */
export async function runSelfCheck(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  picker: IdPicker,
  table: PlaneTable,
  geometry: StarGeometry,
  field: StarField,
  reducedMotion: boolean,
  // 64, not 24. A star in a galaxy core is covered by a nearer sprite and cannot be measured
  // through the id buffer at all — on `fixture-scale` that is over half the samples — so the
  // sample count has to be large enough that what survives is still a real sample. One frame and
  // one readback each, so this costs about a second, once, under `?selfcheck=1`.
  sampleCount = 64,
): Promise<SelfCheckResult> {
  // Narrow the pick sprite for the duration, so what comes back is about position rather than
  // about how far a neighbour's inflated sprite reaches. Restored in the `finally` below — leaving
  // it set would shrink every click target in the app.
  const spriteFloorPx = SELF_CHECK_PICK_MIN_PX
  field.setPickSpriteFloorPx(spriteFloorPx)
  try {
    return await sample(
      renderer,
      scene,
      camera,
      picker,
      table,
      geometry,
      reducedMotion,
      sampleCount,
      spriteFloorPx,
    )
  } finally {
    field.setPickSpriteFloorPx(null)
  }
}

async function sample(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  picker: IdPicker,
  table: PlaneTable,
  geometry: StarGeometry,
  reducedMotion: boolean,
  sampleCount: number,
  // Passed rather than read back from the constant, so the result reports the floor the run
  // actually picked at rather than the one it was supposed to use.
  spriteFloorPx: number,
): Promise<SelfCheckResult> {
  const total = geometry.drawCount
  const missed: SelfCheckResult['missed'][number][] = []
  let agreed = 0
  let offScreen = 0
  let occluded = 0
  let checked = 0
  let unmeasured = 0
  const unmeasuredRows = new Map<number, number>()
  let offsetTotal = 0
  let offsetMax = 0
  // Every sample that contributed to `offsetTotal`, which is the occluded ones *and* the misses
  // where the picker returned an on-screen star. Dividing by `occluded` alone inflated the mean
  // exactly when there were misses to diagnose.
  let offsetSamples = 0

  const motion = reducedMotion ? 0 : 1

  // Taken before any pick pass runs, so it is a plain composed frame of the scene rather than
  // whatever the canvas held after two dozen render-target round trips.
  await new Promise((frame) => requestAnimationFrame(() => frame(null)))
  const canvasBytes = renderer.domElement.toDataURL('image/png').length

  for (let sample = 0; sample < sampleCount; sample += 1) {
    // Spread across the file, so dust (the curl-noise branch) and disc stars are both covered.
    const index = Math.floor((sample / sampleCount) * total)
    if (index >= total) continue
    if (!geometry.passesFilter(index)) continue
    // The plane has to have faded in, or the pick pass discards it (PRD 5.8.3's rule, reused).
    if ((table.planes[geometry.planeRowOf(index)]?.fade ?? 0) <= 0.5) continue

    // One pick per animation frame, which is how PRD 8.5.6 says the app picks ("throttled to the
    // frame") and therefore the only regime worth asserting about. Waiting *before* reading the
    // mirror matters: the frame that just ran advanced the clock the shader draws with, and a
    // position computed against the previous frame's clock would be a stale comparison.
    await new Promise((frame) => requestAnimationFrame(() => frame(null)))

    // Re-read every sample: the adaptive-quality monitor can change the pixel ratio between
    // frames (PRD 8.5.11), which resizes the drawing buffer under a cached value.
    const width = renderer.domElement.width
    const height = renderer.domElement.height

    const pixel = mirrorPixel(index, table, geometry, camera, motion, width, height, world)
    if (pixel === null) {
      offScreen += 1
      continue
    }

    checked += 1
    // `pickQueued`, not `pick`: a `PICK_BUSY` here would decode as "some other star" and be scored
    // as a disagreement. The check must compare answers, never the absence of one.
    const picked = await picker.pickQueued(renderer, scene, camera, pixel.x, pixel.y)

    // The measurement. Not "what did the pointer select" but "where did the shader actually draw
    // the star the mirror was asked about" — the one comparison that puts the CPU on one side and
    // the GPU on the other. Everything else compares the mirror with itself: `picked`'s position
    // comes from the same mirror, so an error the two stars share cancels and vanishes. A whole
    // plane row drifting together — the exact PRD 8.5.7 failure, since the mirror is per-row — is
    // invisible to that comparison and plain to this one.
    const drawn = picker.distanceTo(index)
    if (drawn < 0) {
      // Not in the window at all: either the mirror is more than half a window out, or a nearer
      // sprite covered every pixel this star had. The two are indistinguishable from here, so
      // count it rather than scoring it, and let the totals below decide whether the run measured
      // enough to mean anything. Broken down by plane row, because "every unmeasurable sample is
      // on one row" would mean something quite different from "they are spread across the field".
      unmeasured += 1
      const row = geometry.planeRowOf(index)
      unmeasuredRows.set(row, (unmeasuredRows.get(row) ?? 0) + 1)
    } else {
      offsetTotal += drawn
      offsetMax = Math.max(offsetMax, drawn)
      offsetSamples += 1
    }

    if (drawn > COINCIDENT_PX) {
      missed.push({
        index,
        picked,
        planeRow: geometry.planeRowOf(index),
        x: Math.round(pixel.x * 10) / 10,
        y: Math.round(pixel.y * 10) / 10,
        z: Math.round(pixel.z * 1000) / 1000,
        drawnAtPx: Math.round(drawn * 100) / 100,
      })
      continue
    }

    // The star is where the mirror said. What the *pointer* would have selected there is a
    // separate question — a nearer star legitimately wins the depth test in a crowded field — and
    // it is bookkeeping, not a verdict.
    if (picked === index) agreed += 1
    else occluded += 1
  }

  const maxOffsetPx = Math.round(offsetMax * 100) / 100
  return {
    checked,
    agreed,
    offScreen,
    occluded,
    unmeasured,
    unmeasuredRows: [...unmeasuredRows.entries()].sort((a, b) => b[1] - a[1]),
    missed,
    meanOffsetPx: offsetSamples > 0 ? Math.round((offsetTotal / offsetSamples) * 100) / 100 : 0,
    maxOffsetPx,
    measured: offsetSamples,
    spriteFloorPx,
    tolerancePx: COINCIDENT_PX,
    buffer: [renderer.domElement.width, renderer.domElement.height],
    canvasBytes,
    positionMode: geometry.positionMode,
    // Nothing may have missed, and the run must have located enough stars for that to mean
    // something. Without the second clause the check passes vacuously on a crowded field: no
    // misses, because nothing was ever compared. An absolute floor rather than a fraction, because
    // what fraction is measurable is a property of the fixture's density, not of the mirror.
    ok: missed.length === 0 && offsetSamples >= MIN_MEASURED,
  }
}
