/**
 * PRD 9.1.2's bench, as a CI smoke test.
 *
 * > In cloud CI, Playwright runs it as a smoke test only (it completes and emits valid JSON),
 * > because a headless runner has no representative GPU. The 7.2 ceilings are enforced by a local
 * > `pnpm bench` on the reference machine.
 *
 * So this asserts exactly two things — the path completes, and what it logs is valid JSON of the
 * documented shape — and deliberately asserts **nothing** about frame time. That restraint is the
 * point. `result.meetsTarget` and `result.meetsCeiling` are present in the payload and are ignored
 * here; on SwiftShader they will read false, and a CI job that failed on them would be reporting
 * the runner's rasteriser, not the product. The reference-machine numbers live in
 * `web/bench/baseline-2026-09-05.json` and `pnpm bench` is what gates them.
 *
 * What the smoke does catch is the whole class of failure that makes the local bench impossible to
 * run at all: a scene that never reaches `ready`, a path that throws mid-flight, a summariser that
 * emits `NaN`, a segment that silently disappears from the schedule. Those are cheap to catch here
 * and expensive to discover on the reference machine.
 *
 * The renderer string is logged rather than asserted, so the record of *what drew this* is in the
 * CI output. A bench result and a smoke result are never confusable afterwards.
 */

import { expect, test } from '@playwright/test'

import { BENCH_PATH } from '../src/bench/benchPath'
import type { BenchResult } from '../src/bench/BenchRunner'

/** Every segment PRD 9.1.2's path is built from, in order. */
const SEGMENTS = BENCH_PATH.map((key) => key.name)

test('/bench completes and emits valid JSON', async ({ page }) => {
  // PRD 9.1.2 says the result goes "to the console in JSON". That is the contract a human with
  // devtools relies on, so it is the one asserted here — `window.__eternitiesBench` is read after,
  // as the structured copy, and the two must agree.
  const logged: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'log') logged.push(message.text())
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/bench')

  // The status line is the route's own progress report; waiting on "complete" is waiting on the
  // path, not on a clock. The path is 39 s by construction plus the dataset load and, on a software
  // rasteriser, a slow warm-up — hence the generous ceiling.
  await expect(page.getByTestId('bench-status')).toContainText('complete', { timeout: 200_000 })
  expect(errors, 'the bench route threw').toEqual([])

  const result = await page.evaluate(() => window.__eternitiesBench ?? null)
  expect(result, 'the run finished without publishing a result').not.toBeNull()
  const bench = result as BenchResult

  // Valid JSON on the console, and the same run.
  const parsed = logged
    .map((line) => {
      try {
        return JSON.parse(line) as BenchResult
      } catch {
        return null
      }
    })
    .filter((value): value is BenchResult => value !== null && 'segments' in value)
  expect(parsed, 'the bench logged no valid JSON to the console').toHaveLength(1)
  expect(parsed[0]?.frames).toBe(bench.frames)

  // The shape PRD 9.1.2 names: frame time percentiles, CPU time per frame, and the path it flew.
  expect(bench.frames, 'the run recorded no frames').toBeGreaterThan(0)
  expect(bench.durationS).toBeGreaterThan(0)
  for (const value of [bench.fps, bench.frameMsP50, bench.frameMsP95, bench.cpuMsP50, bench.cpuMsP95]) {
    expect(Number.isFinite(value), `bench summary carried a non-finite value: ${value}`).toBe(true)
  }
  expect(bench.frameMsP95).toBeGreaterThanOrEqual(bench.frameMsP50)
  // A saturated buffer means the tail of the path went unrecorded, so the percentiles describe a
  // prefix of the run — the one bench-internal failure that is real regardless of the GPU.
  expect(bench.saturated, 'the sample buffer filled and the tail of the path was dropped').toBe(false)

  // Every segment of PRD 9.1.2's path is present. A segment that stopped being scheduled would
  // otherwise vanish silently from the summary and from the baseline it is compared against.
  expect(bench.segments.map((segment) => segment.segment)).toEqual(SEGMENTS)
  expect(bench.stars).toBeGreaterThan(0)
  expect(bench.planes).toBeGreaterThan(0)

  // Not an assertion — the record of which rasteriser produced these numbers, so a smoke result in
  // the log can never be read as a bench result.
  console.log(
    `bench smoke: renderer "${bench.renderer}", dataset ${bench.dataset}, ` +
      `${bench.frames} frames over ${bench.durationS}s, p50 ${bench.frameMsP50}ms / ` +
      `p95 ${bench.frameMsP95}ms, quality tier ${bench.qualityTier} ` +
      `(${bench.qualityChanges} change(s)) — thresholds deliberately not checked (PRD 9.1.2)`,
  )
})
