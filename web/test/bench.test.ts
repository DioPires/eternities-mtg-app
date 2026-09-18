/**
 * The bench path and its sampling rule (PRD 9.1.2).
 *
 * Everything here is the part of `/bench` that can be reasoned about without a GPU: which segments
 * the path is made of, how long each lasts, and which frames count towards a segment's numbers.
 * The measuring itself needs a canvas and belongs to `pnpm bench` and `e2e/bench.spec.ts`.
 */

import { describe, expect, it } from 'vitest'

import { benchRouteWanted, harnessHref } from '../src/app/harnessRoute'
import { stillSettling } from '../src/bench/BenchRunner'
import { benchRouteRequested } from '../src/bench/BenchScene'
import {
  BENCH_DURATION_S,
  BENCH_PATH,
  segmentEndTime,
  segmentSeconds,
} from '../src/bench/benchPath'

describe('the bench path (PRD 9.1.2)', () => {
  it('contains every move PRD 9.1.2 names, in order', () => {
    // "one multiverse orbit, fly-to a large plane, fly-to a small plane, card-sheet approach, card
    // focus with planets, Esc back to multiverse". `dust` is the one addition, and it is deliberate:
    // the curl-noise branch is the most expensive vertex path in the scene and omitting it would
    // flatter the numbers.
    expect(BENCH_PATH.map((key) => key.name)).toEqual([
      'home',
      'approach',
      'plane',
      'small-plane',
      'sheet',
      'card',
      'dust',
      'sweep',
      'home-return',
    ])
  })

  it('agrees with itself about how long it is', () => {
    expect(BENCH_DURATION_S).toBe(BENCH_PATH.reduce((total, key) => total + key.seconds, 0))
    expect(segmentEndTime('home-return')).toBe(BENCH_DURATION_S)
    expect(segmentEndTime('home')).toBe(BENCH_PATH[0]!.seconds)
  })

  it('reports a segment length for every segment, and null for anything else', () => {
    for (const key of BENCH_PATH) expect(segmentSeconds(key.name)).toBe(key.seconds)
    expect(segmentSeconds('not-a-segment')).toBeNull()
    expect(segmentEndTime('not-a-segment')).toBeNull()
  })
})

describe('bench settling (PRD 9.1.2)', () => {
  // Four seconds is the length of most of the path's segments, so it is the case to reason about.
  const SEGMENT_S = 4

  it('discards the first frames of a segment, so its numbers are its own', () => {
    // On the reference machine a frame is 1.5–8 ms, so six of them are far inside the fraction cap
    // and the frame count is what binds — exactly as the baseline was recorded.
    expect(stillSettling(6, 0.008, SEGMENT_S)).toBe(true)
    expect(stillSettling(1, 0.05, SEGMENT_S)).toBe(true)
  })

  it('stops discarding once the frame allowance is spent', () => {
    expect(stillSettling(0, 0.05, SEGMENT_S)).toBe(false)
  })

  it('stops discarding once the segment is 20% gone, however few frames that took', () => {
    // The CI failure this rule exists for: a software rasteriser managing about a frame a second
    // spends its whole four-second segment inside a six-frame allowance, and the bench then reports
    // a completed run with zero samples and an empty `segments` array.
    expect(stillSettling(6, 0.79, SEGMENT_S)).toBe(true)
    expect(stillSettling(6, 0.8, SEGMENT_S)).toBe(false)
    expect(stillSettling(6, 1.0, SEGMENT_S)).toBe(false)
  })

  it('never settles through a segment of zero length', () => {
    // `segmentSeconds` returns null for an unknown name and the runner substitutes 0. Settling
    // forever on a segment the path does not know about would be the wrong failure.
    expect(stillSettling(6, 0, 0)).toBe(false)
  })
})

/**
 * `harnessRoute.benchRouteWanted` is a copy of `BenchScene.benchRouteRequested`, and it exists so
 * that asking the question does not import the bench (review §6.3). A copy can drift, so it is
 * pinned to the original over every spelling that decides the route — including the ones that must
 * say no, because a copy that answered `true` too often would route real visitors to the bench.
 *
 * The two copies are further apart than they were: since review §3.6 phase 3 item 4 they are in
 * different *builds*, `benchRouteWanted` in the product entry and `benchRouteRequested` in the
 * harness entry. This test is the only thing that still sees both, which makes it the only place
 * the drift can be caught.
 */
describe("the URL test the product inlines so it doesn't import the bench", () => {
  const CASES: readonly (readonly [string, string])[] = [
    ['/bench', ''],
    ['/bench/', ''],
    ['/benchmark', ''],
    ['/', '?bench'],
    ['/', '?bench=1'],
    ['/', '?bench=0'],
    ['/', '?hold=card'],
    ['/', '?hold='],
    ['/', '?held=card'],
    ['/', '?probe=shell'],
    ['/', ''],
    ['/', '?quality=2&bench=1'],
  ]

  it('answers exactly what the bench module answers, for every spelling', () => {
    for (const [pathname, search] of CASES) {
      expect([pathname, search, benchRouteWanted(pathname, search)]).toEqual([
        pathname,
        search,
        benchRouteRequested(pathname, search),
      ])
    }
  })

  it('says no to the shell, which is the answer that matters', () => {
    expect(benchRouteWanted('/', '')).toBe(false)
    expect(benchRouteWanted('/', '?probe=shell')).toBe(false)
    expect(benchRouteWanted('/', '?bench=0')).toBe(false)
  })
})

/**
 * The redirect that keeps the harness URLs working after item 4 moved the harness (review §3.6
 * phase 3).
 *
 * This is the whole compatibility surface. `scripts/bench.mjs`, `scripts/warmup-probe.mjs`,
 * `scripts/visual-gate.mjs` and four `e2e/` specs drive these spellings and were not changed, so if
 * `harnessHref` is wrong they do not fail loudly — they land on the product shell and measure the
 * wrong page. Hence the two directions are tested separately: what must leave, and what must stay.
 */
describe('where a harness URL goes', () => {
  it('sends every harness spelling to the harness entry, query intact', () => {
    // `/bench` said it with the path, and nothing but the query survives a redirect.
    expect(harnessHref('/bench', '')).toBe('/harness.html?bench=1')
    expect(harnessHref('/bench/', '')).toBe('/harness.html?bench=1')
    // ...but a query that already carries the request is passed through unchanged.
    expect(harnessHref('/', '?bench=1')).toBe('/harness.html?bench=1')
    expect(harnessHref('/', '?hold=sheet')).toBe('/harness.html?hold=sheet')
    expect(harnessHref('/bench', '?hold=card')).toBe('/harness.html?hold=card')
    expect(harnessHref('/', '?probe=1')).toBe('/harness.html?probe=1')
  })

  it('keeps ?selfcheck on the product shell, now that the GPU self-check has retired', () => {
    // The self-check compared the star field's id buffer against the CPU mirror, and went with the
    // star field at the cutover (DEC-752); it is archived under the \`galaxy-cutover\` tag. A
    // redirect to a harness route that no longer exists would be a blank page.
    expect(harnessHref('/', '?selfcheck=1')).toBeNull()
  })

  it('carries the parameters the harness routes are steered by', () => {
    // Real call sites: `e2e/quality.spec.ts` drives `?probe=1&quality=<i>&motion=1`, and dropping
    // the tail would silently measure the default tier instead of the one under test.
    expect(harnessHref('/', '?probe=1&quality=3&motion=1')).toBe(
      '/harness.html?probe=1&quality=3&motion=1',
    )
    expect(harnessHref('/', '?bench=1&dataset=small')).toBe('/harness.html?bench=1&dataset=small')
  })

  it('leaves the product alone — including ?probe=shell, which is the product', () => {
    expect(harnessHref('/', '')).toBe(null)
    // PRD 9.3's visual review is of the shipped composition. Redirecting this one would point
    // `scripts/visual-gate.mjs` at the scene alone and quietly change what it judges.
    expect(harnessHref('/', '?probe=shell')).toBe(null)
    expect(harnessHref('/', '?probe=0')).toBe(null)
    expect(harnessHref('/', '?bench=0')).toBe(null)
    expect(harnessHref('/', '?selfcheck=0')).toBe(null)
    expect(harnessHref('/benchmark', '')).toBe(null)
    expect(harnessHref('/plane/dominaria', '?focus=abc')).toBe(null)
  })
})
