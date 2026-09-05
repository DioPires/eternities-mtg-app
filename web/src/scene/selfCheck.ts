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
 * than a share of them. But `unmeasured` is *also* what a mirror error too large to fit the search
 * window looks like, which made it an escape hatch for the worst version of the very bug this
 * exists to catch: see `DARK_ROW_MIN_SAMPLES`, which tells the two apart by how they distribute
 * across plane rows — and which also states the hole that rule does *not* close, an error big
 * enough to project the row off screen. And the resolution is the pixel grid: see `COINCIDENT_PX`
 * for what size of disagreement this does and does not catch, which was measured by injection
 * rather than assumed. What the check buys is bounded from below by injection and stated in
 * `docs/star-renderer.md`; neither that statement nor this one is a claim to be exhaustive.
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
  /**
   * Measured samples where the star the mirror asked about is also the one the pointer would have
   * selected there. `agreed + occluded + missed.length === measured`, not `checked`: an unmeasured
   * sample established nothing and is bucketed nowhere. It used to fall through into this bucket
   * and `occluded` — `drawn < 0` is not `> COINCIDENT_PX` — so the two of them summed to all 64
   * samples and reported coverage the run had only over the measured ones.
   */
  readonly agreed: number
  /**
   * Samples the mirror projected outside the viewport. **Reported, never judged** — these are a
   * subset of `checked`, not an alternative to it. The pick window is aimed at the off-screen pixel
   * and the sample is measured like any other; see `mirrorPixel` for why that is possible and why
   * it is the whole of the off-screen gate. A row legitimately outside the frustum lands here in
   * bulk and passes on its measurements; a row displaced off screen by a mirror error lands here in
   * bulk too and goes dark. Nothing branches on this number, which is exactly the point — a gate
   * that did would fail the first case to catch the second.
   */
  readonly offScreen: number
  /**
   * Samples whose projection has no pixel to aim at: `z > 1`, meaning behind the eye or beyond the
   * far plane, plus the theoretical non-finite divide. A view offset shifts the frustum sideways
   * and never puts the eye behind itself, so unlike an off-screen pixel these cannot be probed, and
   * they are the one kind of sample still dropped before `checked` and `sampledRows`. Counted and
   * reported by row so that the absorption the off-screen gate closes cannot re-open here unnoticed
   * — see {@link SelfCheckResult.unprojectableRows} and the ladder in `docs/star-renderer.md`.
   */
  readonly unprojectable: number
  /** `[planeRow, count]` for the unprojectable samples, commonest first. */
  readonly unprojectableRows: readonly (readonly [number, number])[]
  /**
   * View-space depth of the sampled star that came closest to the eye, in world units, or `null`
   * when nothing was sampled. This is the margin the `unprojectable === 0` clause of `ok` rests
   * on: that clause is only safe while the check runs from a camera outside the field, and this
   * number is how a reader checks that rather than taking the comment's word for it. At the home
   * view it sits far in front of the 0.1 near plane and nowhere near the 8000 far one.
   */
  readonly nearestDepth: number | null
  /**
   * Measured samples where the picker returned a *different* star that the mirror also places on
   * the same pixel. Inside a galaxy's core several stars share a pixel and the id pass depth-sorts
   * them, so this is the id buffer working correctly, not the mirror being wrong — and the mirror
   * still had to be right about the other star for it to land there. Only samples whose own star
   * was located reach this bucket, which is what makes the second half of that sentence true.
   */
  readonly occluded: number
  /**
   * Samples where the star was nowhere in its own pick window. Either the mirror is more than half
   * a window out or a nearer sprite covered it entirely; from inside a single sample the two look
   * the same, so these are counted rather than judged. Two things then judge them in aggregate: a
   * run made almost entirely of these has measured nothing, and a run where they concentrate on
   * one well-sampled plane row has found a mirror error too large to measure. See `ok`.
   */
  readonly unmeasured: number
  /** `[planeRow, count]` for the unmeasurable samples, commonest first. */
  readonly unmeasuredRows: readonly (readonly [number, number])[]
  /** `[planeRow, count]` for *every* sample taken — the denominator of the line above. */
  readonly sampledRows: readonly (readonly [number, number])[]
  /**
   * `[planeRow, unmeasured, sampled]` for rows the check sampled often enough to judge and then
   * located essentially nothing on. See {@link DARK_ROW_MIN_SAMPLES}: this is the assertion that a
   * mirror error big enough to push a whole row out of its own pick windows fails rather than
   * passing quietly, which is the one thing the offset measurement cannot see.
   */
  readonly darkRows: readonly (readonly [number, number, number])[]
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
 * Sensitivity, stated plainly: an error of 3 px or more *on a star the check located* fails, and a
 * systematic drift shows in `meanOffsetPx` from about 1.5 px. Below that the check passes —
 * verified by injection, not assumed.
 *
 * The qualification is load-bearing and is why this constant is not the whole story. Beyond about
 * half the 11 px search window the star is not in its own window to be measured, so this bound
 * goes blind exactly as the error grows past it. {@link DARK_ROW_MIN_SAMPLES} is what catches it
 * there — up to the point the row projects off screen entirely, which nothing here catches. See
 * that constant for the reproduction and for why the remaining hole is deferred rather than closed.
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

/**
 * The assertion that closes `unmeasured`'s escape hatch.
 *
 * `distanceTo` searches an 11×11 window centred on the mirror's prediction, so the check's
 * sensitivity is not monotone in the size of the error: a star the mirror puts more than half a
 * window out is not in its own window at all, comes back `-1`, and is scored `unmeasured` —
 * dropped from the mean, from `missed` and from `ok` alike. Injecting `py += 2` into the dust row
 * of `fixture-small` fails the check; injecting `py += 3`, `4` or `6` — the same bug, larger —
 * passed it, with a *better* mean than the clean run, because all 15 row-0 samples went dark. That
 * is the exact PRD 8.5.7 catastrophe reported as agreement.
 *
 * What separates the two causes of `unmeasured` is not the individual sample — from inside one
 * sample they are identical — but how they distribute across plane rows. Occlusion is a property
 * of one star's neighbourhood: it strikes the stars inside a galaxy core and not the ones in its
 * halo, so it is scattered, and it leaves plenty of the same row measurable. The mirror is written
 * per plane row, so an error in it moves every star on that row together and takes the whole row
 * out at once. A row that went all but entirely dark is therefore the signature of the bug and not
 * of the field — provided enough of it was sampled to tell the difference, which is what the floor
 * below is for. Rows sampled fewer times than that are reported but not judged; on an 87-plane
 * fixture most rows draw one sample and can never be either.
 *
 * Both numbers are set from measurement, and the floor is the load-bearing one. A first attempt
 * used four samples and failed the *clean* `fixture-scale` run: rows 47 and 43 drew five and four
 * samples and every one of them was occluded. With 37 of 64 samples unmeasurable on that fixture,
 * a run of four or five dark in a row is ordinary luck, not evidence. Ten is above every row that
 * behaved that way — the largest was seven — and below the rows that carry a real sample:
 *
 *     fixture-small, clean    row 4: 8/27 dark    row 3: 7/17    row 0: 0/15    row 1: 1/5
 *     fixture-scale, clean    row 0: 1/15 dark    row 67: 5/7    row 47: 5/5    row 43: 4/4
 *     fixture-small, py += 3 injected into row 0  row 0: 15/15 dark
 *
 * So the judged rows sit at 0.0–0.41 clean against 1.0 injected, and 0.9 divides them with two
 * orders of magnitude of room: reaching it from a 0.41 base rate over 17 samples is a 1-in-10⁶
 * event. It is 0.9 rather than 1.0 so that one measurable star on an otherwise displaced row does
 * not buy the whole row an exemption.
 *
 * Two things this does not do. The list is **not** offered as exhaustive — each of them was found
 * by pushing an injection further than the round before it had thought to, and the next one would
 * be found the same way.
 *
 * It does not judge a thinly sampled row. Sixty-four samples over `fixture-scale`'s 87 planes leave
 * most rows with one sample each, and the only row there that clears the floor is row 0 — which is
 * the Blind Eternities dust, the row PRD 8.5.7's failure is named after and the one Phase 2b's
 * tether frames. The draw-range fix deferred to Phase 2b is what removes that one.
 *
 * And it does not see an error large enough to project the row off screen, because such a row never
 * reaches either tally. `mirrorPixel` decides "off screen" from the mirror's *own* projected
 * position and returns `null` before `checked += 1` and before `sampledRows`, so the row leaves the
 * numerator and the denominator at once and `findDarkRows` cannot judge a row it never saw. The
 * ladder above continues, on `fixture-small`:
 *
 *     py += 60     35/64 measured   rows `4x27 3x17 0x15 1x5`      fail, names row 0
 *     py += 400    35/49 measured   rows `4x27 3x17 1x5`           **pass, exit 0** — row 0 is gone
 *
 * The 15 dust samples are reported as `15 off screen`, `measured` stays above {@link MIN_MEASURED},
 * and the run prints `OK`. So sensitivity is monotone from 3 up to about 60 world units and blind
 * again past roughly 400 — which is not an exotic regime for this failure: a sign flip, a wrong
 * radius scale or a stale plane-table row lands there rather than at 4 px.
 *
 * That hole is left open deliberately rather than overlooked. The obvious gate — this same
 * concentration rule applied to `offScreen` — would fail a plane row that is *legitimately* outside
 * the view frustum, which is 100% off screen for reasons that have nothing to do with the mirror.
 * Both fixtures report `0 off screen` at this camera, so today the gate would be free, but that is
 * not a property of the real 89-shard dataset. Telling the two apart needs a discriminator and
 * therefore a design decision — `planeWorldPosition` already has the plane centre, and "centre on
 * screen, every sampled star off screen" is the bug's signature, but that path shares drift and
 * home with the mirror and so would not catch an error injected there. It is deferred to Phase 2b
 * alongside the draw-range work. `docs/star-renderer.md` states both limits rather than papering
 * over them.
 */
const DARK_ROW_MIN_SAMPLES = 10
const DARK_ROW_RATE = 0.9

/**
 * The dark-row rule of {@link DARK_ROW_MIN_SAMPLES}, as a function of the two tallies alone.
 *
 * Separated from `sample` so it can be tested without a GPU: the rule is the whole assertion, and
 * everything around it needs a driver, a fixture and a second of wall clock to exercise.
 */
export function findDarkRows(
  sampledRows: ReadonlyMap<number, number>,
  unmeasuredRows: ReadonlyMap<number, number>,
): readonly (readonly [number, number, number])[] {
  return [...sampledRows.entries()]
    .map(([row, taken]) => [row, unmeasuredRows.get(row) ?? 0, taken] as const)
    .filter(([, dark, taken]) => taken >= DARK_ROW_MIN_SAMPLES && dark / taken >= DARK_ROW_RATE)
    .sort((a, b) => b[1] - a[1])
}

/**
 * Where the CPU mirror says a star is, in device pixels, and whether that pixel is on screen.
 *
 * The pixel is returned whether or not it is on screen, and that is the whole of the off-screen
 * gate. It used to return `null` for anything outside NDC, which deleted the sample before it
 * reached `checked` or `sampledRows` — so a mirror error big enough to project a row clean off
 * screen took the row out of the numerator and the denominator at once, and the dark-row rule
 * cannot judge a row it never saw. That was the ladder's `py += 400` passing green.
 *
 * It can be measured instead of skipped because the pick window is a *view offset*, not a scissor:
 * `IdPicker` renders an 11×11 sub-rectangle of the full frustum via `camera.setViewOffset`, and
 * nothing in that arithmetic requires the sub-rectangle to lie inside the viewport — three adds
 * `offsetX * width / fullWidth` to the frustum's left edge and does not clamp. Aiming the window at
 * an off-screen pixel therefore asks the shader the same question it is asked on screen, at the
 * same resolution and through the same vertex program: *did you draw this star here?* Object-level
 * culling cannot interfere, because `starFieldObjects` already sets `frustumCulled = false` and
 * `boundingSphere = null` on the pick points.
 *
 * That is why there is no concentration rule on `offScreen` and no plane-centre discriminator. A
 * row legitimately outside the frustum is not *excused* by a heuristic that tries to tell it apart
 * from a displaced one — it is measured, agrees, and passes on the same evidence as any other row.
 * A displaced row is not in the window the mirror points at and goes dark exactly as it does on
 * screen. The distinction the naive gate could not draw is not drawn at all; it stops mattering.
 *
 * `null` is left for the one projection that cannot be aimed at: `z > 1` — behind the eye, or
 * beyond the far plane — which no lateral view offset reaches, since shifting the frustum sideways
 * never puts the eye behind itself. See `unprojectable`, which is where those samples are counted.
 */
function mirrorPixel(
  index: number,
  table: PlaneTable,
  geometry: StarGeometry,
  camera: PerspectiveCamera,
  motion: number,
  width: number,
  height: number,
  out: Vector3,
): MirrorPixel | null {
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
  // `project` is exactly these two applies. Split so the view-space depth is readable between
  // them: it is the quantity the `unprojectable` clause is actually about, and NDC z hides it —
  // with a 0.1 near plane against an 8000 far one, everything from 117 units out to 377 sits
  // between 0.9983 and 0.9995, so an NDC margin says nothing about how close to the eye a star got.
  out.applyMatrix4(camera.matrixWorldInverse)
  const depth = -out.z
  out.applyMatrix4(camera.projectionMatrix)
  return pixelForNdc(out.x, out.y, out.z, width, height, depth)
}

export interface MirrorPixel {
  /** Device pixels, top-left origin. Outside `[0, width] × [0, height]` when `onScreen` is false. */
  readonly x: number
  readonly y: number
  readonly z: number
  readonly onScreen: boolean
  /** View-space depth in world units: how far in front of the eye the mirror puts the star. */
  readonly depth: number
}

/**
 * The off-screen gate's whole decision, as a function of a projected point alone.
 *
 * Separated from {@link mirrorPixel} for the reason `findDarkRows` is separated from `sample`: the
 * rule is the assertion, and everything around it needs a driver, a fixture and a second of wall
 * clock. What is asserted here is narrow and load-bearing — that a point outside NDC still yields a
 * pixel, because a pixel is all the pick window needs to be aimed at, and that `z > 1` is the only
 * projection that yields none.
 */
export function pixelForNdc(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth = 0,
): MirrorPixel | null {
  // A perspective divide by a w at or near zero, which `Vector3.project` does not guard. Rare
  // enough to be theoretical, but a NaN offset would reach `setViewOffset` and poison the
  // projection matrix for every sample after it rather than failing this one.
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  // Behind the eye or beyond the far plane, which are one test because a point behind the eye
  // divides by a negative w and lands past the far plane in NDC rather than in front of the near
  // one. Either way no lateral view offset reaches it, so there is no pixel to aim a window at.
  if (z > 1) return null
  return {
    x: ((x + 1) / 2) * width,
    y: ((1 - y) / 2) * height,
    z,
    onScreen: Math.abs(x) <= 1 && Math.abs(y) <= 1,
    depth,
  }
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
  let unprojectable = 0
  // The margin the `unprojectable` clause of `ok` rests on: the closest any sampled star came to
  // the eye, in world units. Reported so the clause is checkable against a number rather than
  // against an argument — see the clause itself for what it does with it.
  let nearestDepth = Infinity
  const unmeasuredRows = new Map<number, number>()
  const unprojectableRows = new Map<number, number>()
  const sampledRows = new Map<number, number>()
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
    const row = geometry.planeRowOf(index)
    // The plane has to have faded in, or the pick pass discards it (PRD 5.8.3's rule, reused).
    if ((table.planes[row]?.fade ?? 0) <= 0.5) continue

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
      // Behind the eye or beyond the far plane. The only projection the pick window cannot be
      // aimed at, and therefore the only sample still dropped before the tallies below.
      unprojectable += 1
      unprojectableRows.set(row, (unprojectableRows.get(row) ?? 0) + 1)
      continue
    }
    // Recorded, not acted on. An off-screen sample is measured like any other from here down — it
    // enters `checked` and `sampledRows`, gets a pick window aimed at it, and is judged by the same
    // offset and the same dark-row rule. This counter exists so a reader can see how much of the
    // run was off screen, not so anything can branch on it.
    if (!pixel.onScreen) offScreen += 1
    nearestDepth = Math.min(nearestDepth, pixel.depth)

    checked += 1
    // The denominator for `unmeasuredRows`. Counted here, at the same point the sample enters
    // `checked`, so the two tallies are over exactly the same set of samples.
    sampledRows.set(row, (sampledRows.get(row) ?? 0) + 1)
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
      // sprite covered every pixel this star had. The two are indistinguishable from *this* sample,
      // so count it rather than scoring it — and count it against its plane row, because the two
      // causes do not distribute the same way across rows. Occlusion is a property of one star's
      // neighbourhood; a mirror error is a property of a whole row. `darkRows` below is what turns
      // that difference into a verdict.
      unmeasured += 1
      unmeasuredRows.set(row, (unmeasuredRows.get(row) ?? 0) + 1)
      // Not scored as agreement either. An unmeasured sample established nothing about the mirror,
      // and letting it fall through into `agreed`/`occluded` reported coverage the run never had.
      continue
    }

    offsetTotal += drawn
    offsetMax = Math.max(offsetMax, drawn)
    offsetSamples += 1

    if (drawn > COINCIDENT_PX) {
      missed.push({
        index,
        picked,
        planeRow: row,
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
  // Rows the check looked at often enough to judge, and located nothing on. Read off the two
  // tallies above rather than tracked separately, so it cannot disagree with what is reported.
  const darkRows = findDarkRows(sampledRows, unmeasuredRows)
  return {
    checked,
    agreed,
    offScreen,
    occluded,
    unmeasured,
    unprojectable,
    unprojectableRows: [...unprojectableRows.entries()].sort((a, b) => b[1] - a[1]),
    nearestDepth: Number.isFinite(nearestDepth) ? nearestDepth : null,
    unmeasuredRows: [...unmeasuredRows.entries()].sort((a, b) => b[1] - a[1]),
    sampledRows: [...sampledRows.entries()].sort((a, b) => b[1] - a[1]),
    darkRows,
    missed,
    meanOffsetPx: offsetSamples > 0 ? Math.round((offsetTotal / offsetSamples) * 100) / 100 : 0,
    maxOffsetPx,
    measured: offsetSamples,
    spriteFloorPx,
    tolerancePx: COINCIDENT_PX,
    buffer: [renderer.domElement.width, renderer.domElement.height],
    canvasBytes,
    positionMode: geometry.positionMode,
    // Four clauses, for four ways the mirror can be wrong.
    //
    // Nothing may have missed — the mirror agrees with the shader wherever the two were compared.
    // The run must have located enough stars for that to mean something, or the check passes
    // vacuously on a crowded field: no misses, because nothing was ever compared. An absolute
    // floor rather than a fraction, because what fraction is measurable is a property of the
    // fixture's density, not of the mirror. And no plane row may have gone dark, or an error too
    // large to measure passes as an error that was never there — see `DARK_ROW_MIN_SAMPLES`.
    //
    // The fourth is the other half of the off-screen fix. Aiming the pick window off screen makes
    // a laterally displaced row measurable, but a star the mirror puts *behind the eye* has no
    // pixel to aim at, and such a sample is still dropped before both tallies — which absorbs an
    // error in two ways, both measured on `fixture-small` and both green before this clause.
    // `py += 4000` takes row 0 out of `sampledRows` entirely, the same disappearance the lateral
    // fix closes. `pz += 400` is quieter and worse: it thins row 0 from 15 samples to 8, all 8
    // come back dark, and the row still escapes `findDarkRows` — which does not judge a row below
    // its floor of 10. Dropping a sample does not just lose that sample; it can drag the row it
    // came from under the floor and take the other seven down with it.
    //
    // Requiring zero is a real assertion here rather than a formality, because at the camera this
    // check runs from the eye sits outside the multiverse looking in: `?selfcheck=1` measures at
    // the home view, ~247 units out against a multiverse radius of 130, so every star is in front
    // of the eye by a wide margin and nothing approaches the 8000 far plane. `nearestDepth` reports
    // that margin so the claim is checkable against a number rather than against this paragraph.
    //
    // What would break it is running the check from a camera *inside* the field, where stars
    // behind the eye are ordinary and this clause would fire on a correct mirror. It is a flat
    // zero rather than a rate because that regime does not exist today, and it should be replaced
    // rather than loosened if it ever does — the replacement is a comparison against the shader,
    // not a threshold: a star the mirror puts behind the eye that the id buffer still shows on
    // screen is a contradiction no legitimate camera produces.
    ok:
      missed.length === 0 &&
      offsetSamples >= MIN_MEASURED &&
      darkRows.length === 0 &&
      unprojectable === 0,
  }
}
