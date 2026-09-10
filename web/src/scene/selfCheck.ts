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
 * exists to catch: see `DARK_ROW_MIN_SAMPLES`, which tells the two apart both by what the pick
 * window held instead and by how they distribute across plane rows — and which also states the
 * limit that rule still has, a row of fewer than ten stars. And the resolution is the pixel grid: see `COINCIDENT_PX`
 * for what size of disagreement this does and does not catch, which was measured by injection
 * rather than assumed. What the check buys is bounded from below by injection and stated in
 * `docs/star-renderer.md`; neither that statement nor this one is a claim to be exhaustive.
 *
 * Nothing runs unless `?selfcheck=1` asks for it — and since DEC-708 archived
 * `scripts/verify-browser.mjs`, nothing asks for it automatically. Drive it by hand, or restore
 * the driver from the `review-tooling-2026-09` tag. See `docs/star-renderer.md` § 7.
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
   * View-space depth of the sampled stars closest to and furthest from the eye, in world units, or
   * `null` when nothing was sampled. `z > 1` is a two-sided test — behind the 0.1 near plane *or*
   * past the harness camera's 6000 far one — and these are the margin on each side, so the
   * `unprojectable === 0` clause of `ok` is checkable against numbers rather than against the
   * paragraph that argues for it. At the harness camera they measure 218.5-395.5 on
   * `fixture-small`, 188.5-411.3 on `fixture-scale` and 191.1-402.6 on production: three orders of
   * magnitude clear at the near end and a factor of 14 at the far one. Those are the *per-row*
   * sampler's spans, re-measured for DEC-665; the file-wide sampler read 285.2-402.0, 200.5-412.2
   * and 197.7-405.4. What changed is which stars are looked at, not where any star is —
   * `fixture-small` moved most because its dust row is now sampled across its whole extent rather
   * than from one contiguous stretch of the file.
   *
   * Both are taken over the *surviving* samples: a sample that trips the clause never reaches the
   * `Math.min`/`Math.max`, so a run that fails on `unprojectable` still reports healthy margins
   * here. These are the margin of the run that passed, not a diagnosis of the one that failed —
   * `unprojectableRows` is what says where a failure came from.
   */
  readonly nearestDepth: number | null
  readonly farthestDepth: number | null
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
  /**
   * The subset of `unmeasured` that occlusion does not account for: the pick window was empty, or
   * held a star the mirror does not put nearer the eye than the one asked about. This is what
   * {@link darkRowsOf} judges, and the reason it can be judged on a dataset where whole planes are
   * legitimately 96% occluded. See `DARK_ROW_MIN_SAMPLES`.
   */
  readonly unexplained: number
  /**
   * `[planeRow, count]` for the unexplained samples, commonest first. The rule's numerator — the
   * choice of *this* list over the one below is {@link darkRowsOf}'s, and is the whole of DEC-634.
   */
  readonly unexplainedRows: readonly (readonly [number, number])[]
  /**
   * `[planeRow, count]` for the unmeasurable samples, commonest first. Reported, never judged: this
   * is raw darkness, which on a dense dataset is mostly occlusion. It is the column the ladder
   * tables in `docs/star-renderer.md` are written in and the one that shows production's `dominaria`
   * going 96% dark, so `verify-browser` prints it beside the numerator rather than instead of it.
   */
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

export { selfCheckRequested } from './selfCheck.url'

/**
 * `?perrow=N`, the per-row sample budget, or `null` to use {@link SAMPLES_PER_ROW}.
 *
 * The floor and rate in `findDarkRows` are only meaningful against a particular budget, so the
 * budget has to be movable without a rebuild — otherwise re-deriving them means recompiling the
 * bundle once per candidate value, and nobody re-checks them again. Diagnostic only: it is read on
 * the `?selfcheck=1` path, which is the only path that runs the check at all.
 *
 * Rejects anything that is not a positive integer rather than letting it become `NaN`, which would
 * make `Math.min(perRow, total)` produce `NaN` and silently sample nothing.
 */
export function samplesPerRowRequested(
  search = typeof location === 'undefined' ? '' : location.search,
): number | null {
  const raw = new URLSearchParams(search).get('perrow')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

const world = new Vector3()
/** Scratch for the occluder projection in `sample`; see the dark-sample branch there. */
const occluderPixel = new Vector3()

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
 * there, off screen included: a row displaced clean out of the viewport is measured rather than
 * skipped, so that rule keeps working past the size of error this bound stops seeing. See that
 * constant for the reproduction and for the one limit the rule does still have.
 */
const COINCIDENT_PX = 3

/**
 * How many stars the run has to have actually located before its verdict counts.
 *
 * A star inside a galaxy core is covered by a nearer sprite and cannot be found in the id buffer
 * at all, so on a dense fixture much of the sample is unmeasurable however many are taken — 14 of
 * 24 on `fixture-scale`. That is a fact about the field, not about the mirror, and the honest
 * response is to require a real number of hits rather than a share of them.
 *
 * **Sixteen is a legacy figure and DEC-634 did not re-derive it.** It was chosen as a floor over the
 * file-wide sampler's 64 samples — a quarter of them — and the same 16 now stands over 1832 on
 * `fixture-scale` and 720 on production, so in relative terms it is some thirty times weaker than
 * when it was set. It is left alone deliberately rather than rescaled: vacuity is now covered far
 * better by {@link DARK_ROW_MIN_SAMPLES}, which judges every row of ten stars or more on *why* its
 * samples went dark, so a run that locates almost nothing fails as dozens of dark rows long before
 * this clause has an opinion. What is left for an absolute floor is the degenerate case that rule
 * cannot see — a run that took almost no samples at all — and for that any small number does. If
 * the dark-row rule is ever removed, this one has to be re-derived rather than kept.
 */
const MIN_MEASURED = 16

/**
 * The floor and rate that close `unmeasured`'s escape hatch (PRD 8.5.7).
 *
 * A star the mirror puts more than half a pick window out is not in its own window, comes back
 * `-1`, and is scored `unmeasured` — so a large enough error can read as agreement. What separates
 * that from ordinary occlusion is distribution: occlusion is scattered, a mirror error moves a
 * whole plane row at once. `findDarkRows` fails a row that went dark for a reason occlusion does
 * not account for, given enough samples of it to tell.
 *
 * Both numbers are measured, not chosen. `docs/star-renderer.md` § "How `DARK_ROW_MIN_SAMPLES`
 * and `DARK_ROW_RATE` were derived" has the ladder runs, the per-row counts and the gap they sit
 * in — including why the rate moved to 0.5 when the numerator became `unexplained`.
 */
const DARK_ROW_MIN_SAMPLES = 10
const DARK_ROW_RATE = 0.5

/**
 * How many stars to sample from each non-empty plane row.
 *
 * Twenty-four, measured. The budget buys two things and costs one, and the trade is linear.
 *
 * It buys rows: 24 is above the floor of 10 with room, so every plane holding ten or more stars is
 * judged — 77 of 87 on `fixture-scale`, 30 of 30 on production. It also buys resolution in the
 * rule's numerator: at 24 samples the gap between a clean row (at most 1 unexplained) and an
 * injected one (20 to 24) is wide enough for {@link DARK_ROW_RATE} to sit in the middle of it. At a
 * budget of 10 that gap is four samples wide and the rate has nowhere safe to stand.
 *
 * It costs wall-clock, one frame and one readback per sample: 1832 samples and 32.0 s on
 * `fixture-scale`, 720 and 13.5 s on production, against the old file-wide sampler's 64 samples and
 * about a second — per dataset, on every `verify-browser` run. Going to 40 would cost 2911 samples
 * and 50.0 s to judge the same 77 rows. The check is diagnostic and runs only under `?selfcheck=1`,
 * so this is a local gate's wall-clock, not anything a user waits for.
 *
 * `?perrow=N` overrides it without a rebuild; see {@link samplesPerRowRequested}. Rows holding
 * fewer than this many stars contribute all of them and no more — never the same star twice.
 */
const SAMPLES_PER_ROW = 24

/**
 * A maximal run of consecutive star indices belonging to one plane row.
 *
 * The pipeline writes `stars.bin` plane by plane, so in practice every row is exactly one run and
 * this is a `[start, start + count)` range per row. That is a property of the encoder rather than
 * anything enforced here, so what {@link planeRowRuns} returns is runs and {@link rowSampleIndices}
 * groups them by row — a row split into two runs is sampled across both rather than half of it
 * becoming invisible. Measured contiguous on all three datasets: `fixture-small` 4 non-empty rows,
 * `fixture-scale` 80 of 87, production 30 of 87.
 */
export interface PlaneRowRun {
  readonly row: number
  readonly start: number
  readonly count: number
}

/**
 * The row layout of the uploaded records, in one pass over the row byte.
 *
 * Takes the accessor rather than the `StarGeometry` so the sampler can be exercised without a GPU,
 * a fixture or a WebGL context — the same reason `findDarkRows` and `pixelForNdc` are separate
 * functions. One pass over ~30k records, once per run of the check.
 */
export function planeRowRuns(
  rowOf: (index: number) => number,
  drawCount: number,
): readonly PlaneRowRun[] {
  const runs: { row: number; start: number; count: number }[] = []
  let current: { row: number; start: number; count: number } | null = null
  for (let index = 0; index < drawCount; index += 1) {
    const row = rowOf(index)
    if (current !== null && current.row === row) current.count += 1
    else {
      current = { row, start: index, count: 1 }
      runs.push(current)
    }
  }
  return runs
}

/**
 * Which stars to sample: up to `perRow` from every non-empty plane row, round-robin across rows.
 *
 * This is the change DEC-634 is about. The old sampler walked `floor((s / 64) * drawCount)` — even
 * over the *file*, which is even over the stars and therefore wildly uneven over the rows, since a
 * row's share of the samples is its share of the stars. On `fixture-scale` that gave row 0 fifteen
 * samples and left most of the other 79 non-empty rows with one, and `findDarkRows` can only judge
 * a row it sampled at least {@link DARK_ROW_MIN_SAMPLES} times. So the rule that catches the PRD
 * 8.5.7 catastrophe was being applied to one row out of eighty, and an error scattered across rows
 * made the check *less* likely to fail rather than more.
 *
 * Even over rows instead. Two details are not free choices:
 *
 * A row's picks are centred in their strata — `floor((j + 0.5) * total / take)` rather than
 * `floor(j * total / take)` — so they are not pinned to the row's first star. Every row would
 * otherwise contribute its index 0 on every run, and one fixed star per row is a worse estimator of
 * that row than a spread of them.
 *
 * `take` is `min(perRow, total)`, so a row of six stars contributes six samples rather than six
 * copies of a smaller set. Sampling a row with replacement to reach a fixed floor would defeat the
 * floor's own purpose: ten reads of one occluded star are ten dark samples that establish exactly
 * what one established, and a clean fixture would report a dark row. Rows under the floor stay
 * unjudged — see {@link DARK_ROW_MIN_SAMPLES} for which rows those now are.
 */
export function rowSampleIndices(runs: readonly PlaneRowRun[], perRow: number): readonly number[] {
  const rows = new Map<number, { total: number; runs: PlaneRowRun[] }>()
  for (const run of runs) {
    const entry = rows.get(run.row) ?? { total: 0, runs: [] }
    entry.total += run.count
    entry.runs.push(run)
    rows.set(run.row, entry)
  }

  const perRowPicks: number[][] = []
  for (const entry of rows.values()) {
    const take = Math.min(perRow, entry.total)
    const picks: number[] = []
    for (let j = 0; j < take; j += 1) {
      // A position within the row's own stars, which the loop below turns into a file index by
      // walking that row's runs. With one run per row — every dataset today — it is `start + it`.
      let position = Math.min(Math.floor(((j + 0.5) * entry.total) / take), entry.total - 1)
      for (const run of entry.runs) {
        if (position < run.count) {
          picks.push(run.start + position)
          break
        }
        position -= run.count
      }
    }
    perRowPicks.push(picks)
  }

  // Round-robin rather than row after row. Every sample costs a frame, so the check runs for
  // seconds; interleaving means a run cut short by a reload has spread what it managed across all
  // the rows rather than having finished the first few. Nothing else depends on the order.
  const out: number[] = []
  const deepest = perRowPicks.reduce((max, picks) => Math.max(max, picks.length), 0)
  for (let j = 0; j < deepest; j += 1) {
    for (const picks of perRowPicks) {
      if (j < picks.length) out.push(picks[j]!)
    }
  }
  return out
}

/**
 * The dark-row rule of {@link DARK_ROW_MIN_SAMPLES}, as a function of a denominator and a numerator.
 *
 * Separated from `sample` so it can be tested without a GPU: the rule is the whole assertion, and
 * everything around it needs a driver, a fixture and a second of wall clock to exercise.
 *
 * *Which* numerator is not decided here — this function judges whatever it is handed, which is what
 * makes it testable against constructed tallies. The choice is {@link darkRowsOf}'s, and it is the
 * load-bearing one; see there.
 */
export function findDarkRows(
  sampledRows: ReadonlyMap<number, number>,
  darkRows: ReadonlyMap<number, number>,
): readonly (readonly [number, number, number])[] {
  return [...sampledRows.entries()]
    .map(([row, taken]) => [row, darkRows.get(row) ?? 0, taken] as const)
    .filter(([, dark, taken]) => taken >= DARK_ROW_MIN_SAMPLES && dark / taken >= DARK_ROW_RATE)
    .sort((a, b) => b[1] - a[1])
}

/**
 * The rule of {@link findDarkRows} applied to a finished run's own tallies: the call site, made
 * testable.
 *
 * `findDarkRows` pins the rule. This pins *which tally the rule is applied to*, which is the whole
 * of what DEC-634 discovered and was, until DEC-665, the one part of it no test covered. Swapping
 * `unexplainedRows` for `unmeasuredRows` at the old call site left every test green: the choice was
 * defended by a comment, and by a `verify-browser --dataset production` run that no CI job performs.
 * A comment is not a test.
 *
 * So the wrong choice is deliberately *expressible* here — `unmeasuredRows` is taken and not used —
 * and ruled out by the `darkRowsOf` case in `test/selfCheck.test.ts`, whose synthetic `dominaria`
 * row (24 sampled, 23 unmeasured, 0 unexplained) is empty on one tally and a dark row on the other.
 * `sample` then calls this with shorthand properties built from identically named locals, so the
 * decision exists in exactly one place and that place is covered.
 */
export function darkRowsOf(
  rows: Pick<SelfCheckResult, 'sampledRows' | 'unmeasuredRows' | 'unexplainedRows'>,
): readonly (readonly [number, number, number])[] {
  // `unexplainedRows`, not `unmeasuredRows`. Reading the latter reinstates the bug DEC-634 found:
  // production's `dominaria` is 96% occluded on a clean build and fails at any usable rate.
  return findDarkRows(new Map(rows.sampledRows), new Map(rows.unexplainedRows))
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
  // with a 0.1 near plane against the harness camera's 6000 far one, the whole 144.2-456.2 band a
  // star can occupy sits between 0.9986 and 0.9996, so an NDC margin says nothing about how close
  // to the eye a star got. The `ok` clause derives that band.
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
  // enough to be theoretical, but a NaN offset would reach `setViewOffset` and make that pick
  // meaningless: the window is aimed nowhere, the star is not in it, and the sample is scored as
  // unmeasured — the mirror's own degenerate arithmetic reported as a dark star. The damage stops
  // there rather than spreading, because `IdPicker.read` restores the view offset in a `finally`
  // (`picking/idPicker.ts`), so the poisoned projection matrix dies with the pick. Rejecting it
  // here costs the same one sample and puts it in the bucket that names the real cause.
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
  // Per plane row, not per file. See {@link rowSampleIndices} for why the budget is expressed this
  // way and {@link DARK_ROW_MIN_SAMPLES} for where the number comes from. One frame and one
  // readback each, so on `fixture-scale`'s 80 non-empty rows this costs about twelve seconds, once,
  // under `?selfcheck=1`.
  samplesPerRow = SAMPLES_PER_ROW,
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
      samplesPerRow,
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
  samplesPerRow: number,
  // Passed rather than read back from the constant, so the result reports the floor the run
  // actually picked at rather than the one it was supposed to use.
  spriteFloorPx: number,
): Promise<SelfCheckResult> {
  const missed: SelfCheckResult['missed'][number][] = []
  let agreed = 0
  let offScreen = 0
  let occluded = 0
  let checked = 0
  let unmeasured = 0
  let unprojectable = 0
  // The margins the `unprojectable` clause of `ok` rests on, in world units: the closest any
  // sampled star came to the 0.1 near plane and the furthest any got towards the 6000 far one. The
  // clause is two-sided, so a single margin would only argue for half of it. Reported so it is
  // checkable against numbers rather than against an argument — see the clause itself.
  let nearestDepth = Infinity
  let farthestDepth = -Infinity
  // Tallied as maps and reported as sorted entry lists. Named apart from the `...Rows` fields they
  // become so that the assembly below can hand `darkRowsOf` shorthand properties — the numerator
  // choice is defended by a unit test on that function, and shorthand leaves no second place to
  // make it. See {@link darkRowsOf}.
  const unmeasuredByRow = new Map<number, number>()
  let unexplained = 0
  const unexplainedByRow = new Map<number, number>()
  const unprojectableByRow = new Map<number, number>()
  const sampledByRow = new Map<number, number>()
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

  // Even over plane rows, not over the file: the whole of DEC-634. Built once, before the first
  // frame, from the row byte of the records already uploaded.
  const indices = rowSampleIndices(
    planeRowRuns((index) => geometry.planeRowOf(index), geometry.drawCount),
    samplesPerRow,
  )

  for (const index of indices) {
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
      unprojectableByRow.set(row, (unprojectableByRow.get(row) ?? 0) + 1)
      continue
    }
    // Recorded, not acted on. An off-screen sample is measured like any other from here down — it
    // enters `checked` and `sampledRows`, gets a pick window aimed at it, and is judged by the same
    // offset and the same dark-row rule. This counter exists so a reader can see how much of the
    // run was off screen, not so anything can branch on it.
    if (!pixel.onScreen) offScreen += 1
    nearestDepth = Math.min(nearestDepth, pixel.depth)
    farthestDepth = Math.max(farthestDepth, pixel.depth)

    checked += 1
    // The denominator for `unmeasuredRows`. Counted here, at the same point the sample enters
    // `checked`, so the two tallies are over exactly the same set of samples.
    sampledByRow.set(row, (sampledByRow.get(row) ?? 0) + 1)
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
      unmeasuredByRow.set(row, (unmeasuredByRow.get(row) ?? 0) + 1)
      // Which of the two causes it was — see {@link DARK_ROW_MIN_SAMPLES}. One sample cannot say
      // whether the star was covered or misplaced, but the pick window can be asked what it held
      // *instead*: if that is a star the mirror puts nearer the eye, the prediction was right and
      // something in front of it won the depth test. That is occlusion, and it explains this
      // sample. An empty window, or one holding a star no nearer than this one, explains nothing —
      // which is what a star that simply is not there leaves behind.
      //
      // `picked`'s depth comes from the same mirror, which is what makes this usable here and
      // useless as a measurement: an error the two stars share cancels. So it only decides which
      // tally a dark sample joins and never scores agreement. The offset comparison above remains
      // the only thing putting the CPU on one side and the GPU on the other.
      const occluder =
        picked >= 0
          ? mirrorPixel(picked, table, geometry, camera, motion, width, height, occluderPixel)
          : null
      if (occluder === null || occluder.depth >= pixel.depth) {
        unexplained += 1
        unexplainedByRow.set(row, (unexplainedByRow.get(row) ?? 0) + 1)
      }
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
  const commonestFirst = (
    counts: ReadonlyMap<number, number>,
  ): readonly (readonly [number, number])[] => [...counts.entries()].sort((a, b) => b[1] - a[1])
  const unprojectableRows = commonestFirst(unprojectableByRow)
  const unmeasuredRows = commonestFirst(unmeasuredByRow)
  const unexplainedRows = commonestFirst(unexplainedByRow)
  const sampledRows = commonestFirst(sampledByRow)
  // Rows the check looked at often enough to judge, and located nothing on. Read off the reported
  // tallies themselves rather than tracked separately, so it cannot disagree with what is printed —
  // and through {@link darkRowsOf} rather than {@link findDarkRows} directly, so that the choice of
  // numerator is made in a function a test can call. Shorthand properties, deliberately: this line
  // used to be where the choice lived and where a one-word swap went unnoticed by 437 tests.
  const darkRows = darkRowsOf({ sampledRows, unmeasuredRows, unexplainedRows })
  return {
    checked,
    agreed,
    offScreen,
    occluded,
    unmeasured,
    unprojectable,
    unprojectableRows,
    nearestDepth: Number.isFinite(nearestDepth) ? nearestDepth : null,
    farthestDepth: Number.isFinite(farthestDepth) ? farthestDepth : null,
    unmeasuredRows,
    unexplained,
    unexplainedRows,
    sampledRows,
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
    // Four clauses, for four ways the mirror can be wrong: nothing missed; enough located that
    // "nothing missed" means something; no plane row dark for a reason occlusion does not explain
    // (see `DARK_ROW_MIN_SAMPLES`); and nothing unprojectable.
    //
    // The fourth is a real assertion, not a formality — a sample the mirror puts behind the eye has
    // no pixel to aim a window at, so it would otherwise absorb an error silently. A flat zero is
    // safe because of one fact about the camera and one about the data; both are written out in
    // `docs/star-renderer.md` § "Why `ok` requires zero unprojectable samples".
    ok:
      missed.length === 0 &&
      offsetSamples >= MIN_MEASURED &&
      darkRows.length === 0 &&
      unprojectable === 0,
  }
}
