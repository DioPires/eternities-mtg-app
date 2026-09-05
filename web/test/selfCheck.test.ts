/**
 * The self-check's dark-row rule.
 *
 * The bug this covers: `distanceTo` searches an 11×11 window around the mirror's prediction, so a
 * star the mirror puts more than half a window out is not in its own window, comes back `-1` and
 * was scored `unmeasured` — dropped from the mean, from `missed` and from the verdict alike. The
 * check's sensitivity was therefore not monotone in the size of the error: injecting a 2 world-unit
 * offset into one plane row of `fixture-small` failed the check, and injecting 3, 4 or 6 — the same
 * bug, larger — passed it with a *better* mean than the clean run, because every sample on the
 * affected row went dark at once.
 *
 * The second tally is `unexplainedRows`, not `unmeasuredRows`: a dark sample counts against its row
 * only when the pick window held nothing nearer to account for it. That distinction is what lets the
 * rule judge production's `dominaria`, which is legitimately 96% occluded — see the test for it, and
 * `DARK_ROW_MIN_SAMPLES` for the measurements behind both constants.
 *
 * No GPU here. The rule is a function of the two per-row tallies, and those are what the numbers
 * below are: real counts from real runs on Metal, clean and injected.
 */

import { describe, expect, it } from 'vitest'

import {
  findDarkRows,
  pixelForNdc,
  planeRowRuns,
  rowSampleIndices,
} from '../src/scene/selfCheck'

const rows = (entries: readonly (readonly [number, number])[]): Map<number, number> =>
  new Map(entries.map(([row, count]) => [row, count]))

describe('findDarkRows', () => {
  it('passes a clean fixture-small run', () => {
    // Measured on Metal: 64 samples, 16 unmeasurable, worst judged row at 7 of 17. These are
    // `unmeasured` counts from the file-wide sampler, fed in where the rule now takes `unexplained`
    // — deliberately, as a worst case. Unexplained is a subset of unmeasured, and the real run has
    // 0 of these unexplained, so a rule that passes them passes anything that dataset produces.
    const sampled = rows([
      [4, 27],
      [3, 17],
      [0, 15],
      [1, 5],
    ])
    const unmeasured = rows([
      [4, 8],
      [3, 7],
      [1, 1],
    ])
    expect(findDarkRows(sampled, unmeasured)).toEqual([])
  })

  it('passes a clean fixture-scale run, where thin rows do go fully dark', () => {
    // Same worst-case reading as above: these are dark counts standing in for unexplained ones.
    // The reason the floor is ten and not four. On `fixture-scale` 37 of 64 samples are occluded,
    // and at that base rate rows drawing four or five samples come back entirely dark as a matter
    // of ordinary luck — rows 47 and 43 did, on a build with no injected error at all. Judging
    // them would fail every clean run on the dense fixture.
    const sampled = rows([
      [0, 15],
      [67, 7],
      [47, 5],
      [43, 4],
      [10, 2],
      [15, 2],
      [62, 2],
    ])
    const unmeasured = rows([
      [47, 5],
      [67, 5],
      [43, 4],
      [10, 2],
      [15, 2],
      [62, 2],
      [0, 1],
    ])
    expect(findDarkRows(sampled, unmeasured)).toEqual([])
  })

  it('passes the darkest row on the real dataset, which is 96% occluded', () => {
    // The case that forced the rule's numerator to change (DEC-634). `dominaria` is production row
    // 19: 6266 stars, 21.9% of the field, and at a 2px pick sprite 23 of its 24 samples come back
    // dark on a clean build — 23/24 on all three measured runs. On `unmeasured` there is no
    // threshold that passes this and still catches a displaced row: 0.9 and 0.95 both fail it, and
    // 1.0 sits one sample away while excusing any row that leaves a straggler.
    //
    // Nothing about it is unexplained, though. Every one of those 23 samples had a nearer star in
    // the window, which is what occlusion looks like and what a missing star does not.
    expect(findDarkRows(rows([[19, 24]]), rows([]))).toEqual([])
    // The same row with the mirror displaced 400 units: still 24 samples, still dark, but now
    // nothing nearer accounts for any of them. Measured, not constructed.
    expect(findDarkRows(rows([[19, 24]]), rows([[19, 24]]))).toEqual([[19, 24, 24]])
  })

  it('fails a row the mirror displaced out of its own pick windows, and names it', () => {
    // `py += 3` injected into row 0 of `fixture-small`: all 15 dust samples leave their windows.
    // The old rule scored this as 15 quiet `unmeasured` and reported a 0.41px mean — better than
    // the clean run's 0.29 — while the whole Blind Eternities dust row was in the wrong place.
    const sampled = rows([
      [4, 27],
      [3, 17],
      [0, 15],
      [1, 5],
    ])
    const unmeasured = rows([
      [0, 15],
      [4, 9],
      [3, 7],
      [1, 1],
    ])
    expect(findDarkRows(sampled, unmeasured)).toEqual([[0, 15, 15]])
  })

  it('does not let one measurable star buy a displaced row an exemption', () => {
    // Why the rate is well below 1.0. Two separate things leave a displaced row with samples that
    // do not count: perspective, since a uniform world-space offset is a larger pixel offset on
    // near stars than on far ones; and occlusion, which explains some of a displaced row's dark
    // samples exactly as it explains a clean row's. Measured, `py += 3` into `fixture-small`'s row
    // 0 leaves 4 of 24 explained and reads 0.833 — so at 0.9 the ladder's smallest rung passed
    // green, and this is the assertion that would have caught it.
    expect(findDarkRows(rows([[0, 24]]), rows([[0, 20]]))).toEqual([[0, 20, 24]])
    expect(findDarkRows(rows([[0, 24]]), rows([[0, 23]]))).toEqual([[0, 23, 24]])
    // The floor of the gap the rate sits in: clean rows reach 1 of 24 unexplained and no more, on
    // any of the three datasets. Half a row is twelve times that and well clear of it.
    expect(findDarkRows(rows([[0, 24]]), rows([[0, 12]]))).toEqual([[0, 12, 24]])
    expect(findDarkRows(rows([[0, 24]]), rows([[0, 11]]))).toEqual([])
    expect(findDarkRows(rows([[0, 24]]), rows([[0, 1]]))).toEqual([])
  })

  it('does not judge a row it barely sampled, however dark', () => {
    expect(findDarkRows(rows([[7, 9]]), rows([[7, 9]]))).toEqual([])
    expect(findDarkRows(rows([[7, 10]]), rows([[7, 10]]))).toEqual([[7, 10, 10]])
  })

  it('reports the worst row first when several go dark', () => {
    const sampled = rows([
      [0, 15],
      [3, 20],
      [4, 12],
    ])
    const unmeasured = rows([
      [0, 15],
      [3, 20],
      [4, 12],
    ])
    expect(findDarkRows(sampled, unmeasured).map(([row]) => row)).toEqual([3, 0, 4])
  })
})

/**
 * The per-row sampler (DEC-634).
 *
 * The hole this closes is in the *denominator* of the rule above, not in the rule. `findDarkRows`
 * cannot judge a row sampled below `DARK_ROW_MIN_SAMPLES`, and the old sampler spread its budget
 * evenly over the file — which is evenly over the *stars*, so a row's share of the samples was its
 * share of the stars. Measured against `origin/main`'s `planes.json`: on `fixture-scale` that gave
 * row 0 fifteen samples, the next best rows seven, five, four and two, and exactly **one row of
 * eighty** cleared the floor. The rule that exists to catch PRD 8.5.7's whole-row displacement was
 * being applied to one row, and an error scattered across rows lowered coverage rather than failing.
 *
 * No GPU here either: what the sampler picks is a function of the row layout alone.
 */
const runsOf = (rowSequence: readonly number[]) =>
  planeRowRuns((index) => rowSequence[index]!, rowSequence.length)

/** `[[row, starCount], ...]` laid out plane after plane, which is how the pipeline writes it. */
const layout = (rowCounts: readonly (readonly [number, number])[]): readonly number[] =>
  rowCounts.flatMap(([row, count]) => Array.from({ length: count }, () => row))

describe('planeRowRuns', () => {
  it('collapses each plane into one run, in file order', () => {
    expect(runsOf(layout([[0, 3], [1, 2]]))).toEqual([
      { row: 0, start: 0, count: 3 },
      { row: 1, start: 3, count: 2 },
    ])
  })

  it('splits a row that is not contiguous, rather than losing the second piece', () => {
    // Not a layout the encoder produces today. It is the one that would silently halve a row's
    // coverage if the sampler assumed `[start, start + count)`, so the runs carry it explicitly.
    expect(runsOf([0, 0, 1, 1, 0, 0])).toEqual([
      { row: 0, start: 0, count: 2 },
      { row: 1, start: 2, count: 2 },
      { row: 0, start: 4, count: 2 },
    ])
  })
})

describe('rowSampleIndices', () => {
  it('gives every non-empty row the same budget, whatever its size', () => {
    // The whole point. Row 0 holds 100 stars and row 1 holds 12; both get 8 samples, where the old
    // sampler would have given row 0 roughly eight times row 1's share.
    const picks = rowSampleIndices(runsOf(layout([[0, 100], [1, 12]])), 8)
    const perRow = new Map<number, number>()
    for (const index of picks) {
      const row = index < 100 ? 0 : 1
      perRow.set(row, (perRow.get(row) ?? 0) + 1)
    }
    expect(perRow.get(0)).toBe(8)
    expect(perRow.get(1)).toBe(8)
  })

  it('never samples a row twice over, however small the row', () => {
    // `lorwyn` has 6 stars and the floor is 10. Reaching the floor by re-reading stars would be
    // worse than not judging the row: ten reads of one occluded star are ten dark samples that
    // establish what one established, so a clean fixture would report a dark row.
    const picks = rowSampleIndices(runsOf(layout([[0, 6]])), 40)
    expect(picks).toHaveLength(6)
    expect(new Set(picks).size).toBe(6)
  })

  it('spreads a row across its stars instead of pinning it to the first', () => {
    // Centred in strata: `floor((j + 0.5) * total / take)`. Pinned picks would be [0, 2, 5, 7] and,
    // worse, would make every run of the check re-measure one fixed star per row.
    expect(rowSampleIndices(runsOf(layout([[0, 10]])), 4)).toEqual([1, 3, 6, 8])
  })

  it('interleaves rows, so a run cut short has covered all of them thinly', () => {
    expect(rowSampleIndices(runsOf(layout([[0, 3], [1, 3]])), 3)).toEqual([0, 3, 1, 4, 2, 5])
  })

  it('samples both halves of a split row', () => {
    // Every pick stays inside the row it belongs to: 0-1 and 4-5 are row 0, 2-3 are row 1.
    expect(rowSampleIndices(runsOf([0, 0, 1, 1, 0, 0]), 4)).toEqual([0, 2, 1, 3, 4, 5])
  })

  it('cannot reach a row with no stars, which is why the denominator is 80 and not 87', () => {
    // Six of `fixture-scale`'s planes hold no stars at all. They are absent from the runs, so they
    // are absent from the picks: no gate can ever judge them, at any budget.
    const picks = rowSampleIndices(runsOf(layout([[0, 2], [2, 2]])), 4)
    expect(picks).toEqual([0, 2, 1, 3])
  })
})

/**
 * The off-screen gate.
 *
 * The bug this covers is the one the dark-row rule above could not reach. `mirrorPixel` used to
 * return `null` for anything outside NDC, and it did so *before* the sample reached `checked` and
 * before the `sampledRows` tally — so an error big enough to project a whole row off screen removed
 * that row from the numerator and the denominator at once, and `findDarkRows` cannot judge a row it
 * never saw. Measured on `fixture-small`: `py += 60` into the mirror's row 0 failed and named the
 * row; the same bug at `py += 400` passed green, because all 15 dust samples became `off screen`
 * instead of `unmeasured`.
 *
 * The fix is that an off-screen projection still yields a pixel. `IdPicker` aims its 11×11 window
 * with `camera.setViewOffset`, which is arithmetic on the frustum's edges with no clamp to the
 * viewport, so a window can be aimed at a pixel that is off screen and the shader answers the same
 * question there as anywhere else. That makes an off-screen sample an ordinary sample rather than a
 * skipped one, and the dark-row rule then does the rest unchanged.
 *
 * Which is why these tests are about `null` and about `onScreen` never gating anything: the moment
 * a lateral off-screen point returns `null` again, the `py += 400` hole is back.
 */
describe('pixelForNdc', () => {
  it('places an on-screen point in the buffer, top-left origin', () => {
    expect(pixelForNdc(0, 0, 0.5, 1920, 1080)).toEqual({
      x: 960,
      y: 540,
      z: 0.5,
      onScreen: true,
      depth: 0,
    })
    // NDC y is up, device y is down.
    expect(pixelForNdc(-1, 1, 0, 1920, 1080)).toMatchObject({ x: 0, y: 0, onScreen: true })
    expect(pixelForNdc(1, -1, 0, 1920, 1080)).toMatchObject({ x: 1920, y: 1080, onScreen: true })
  })

  it('carries view-space depth through untouched', () => {
    // `depth` is the caller's measurement, not this function's: NDC z cannot recover it, which is
    // the whole reason `mirrorPixel` splits `project` in two to read it. Passed through verbatim
    // so the `unprojectable === 0` clause of `ok` has a number behind it — see `nearestDepth`.
    expect(pixelForNdc(0, 0, 0.5, 1920, 1080, 247.3)?.depth).toBe(247.3)
    // Negative depth is a star behind the eye. Not rejected here, because `z > 1` already is and
    // that is the test the pick window's reachability actually turns on.
    expect(pixelForNdc(0, 0, 0.5, 1920, 1080, -5)?.depth).toBe(-5)
  })

  it('still returns a pixel for a point off the side of the screen', () => {
    // This is the whole gate. A `null` here is the `py += 400` absorption.
    const far = pixelForNdc(5, 0, 0.5, 1920, 1080)
    expect(far).not.toBeNull()
    expect(far).toMatchObject({ x: 5760, y: 540, onScreen: false })

    // And behind the left edge, where the pixel — and so the view offset — goes negative.
    expect(pixelForNdc(-3, 0, 0.5, 1920, 1080)).toMatchObject({ x: -1920, onScreen: false })
    expect(pixelForNdc(0, 9, 0.5, 1920, 1080)).toMatchObject({ y: -4320, onScreen: false })
  })

  it('treats the frustum edge as on screen', () => {
    expect(pixelForNdc(1, 1, 0, 100, 100)?.onScreen).toBe(true)
    expect(pixelForNdc(1.0001, 1, 0, 100, 100)?.onScreen).toBe(false)
  })

  it('returns no pixel behind the eye or beyond the far plane', () => {
    // `z > 1` is the one projection a lateral view offset cannot reach: shifting the frustum
    // sideways never puts the eye behind itself. A point behind the camera divides by a negative
    // w and lands here rather than in front of the near plane, which is why one test covers both.
    expect(pixelForNdc(0, 0, 1.0001, 1920, 1080)).toBeNull()
    expect(pixelForNdc(5, 5, 40, 1920, 1080)).toBeNull()
    // The near plane is not a rejection: `z = -1` is in front of the eye and perfectly measurable.
    expect(pixelForNdc(0, 0, -1, 1920, 1080)).not.toBeNull()
    expect(pixelForNdc(0, 0, -8, 1920, 1080)).not.toBeNull()
  })

  it('returns no pixel for a degenerate projection', () => {
    // A divide by a w at or near zero. Guarded because a NaN reaches `setViewOffset` and poisons
    // the projection matrix for every sample after it, rather than failing this one.
    expect(pixelForNdc(NaN, 0, 0, 1920, 1080)).toBeNull()
    expect(pixelForNdc(0, Infinity, 0, 1920, 1080)).toBeNull()
    expect(pixelForNdc(0, 0, -Infinity, 1920, 1080)).toBeNull()
  })
})
