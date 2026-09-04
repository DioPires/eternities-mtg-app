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
 * No GPU here. The rule is a function of the two per-row tallies, and those are what the numbers
 * below are: real counts from real runs on Metal, clean and injected. See `DARK_ROW_MIN_SAMPLES`
 * for why the sample floor is the load-bearing half of it.
 */

import { describe, expect, it } from 'vitest'

import { findDarkRows } from '../src/scene/selfCheck'

const rows = (entries: readonly (readonly [number, number])[]): Map<number, number> =>
  new Map(entries.map(([row, count]) => [row, count]))

describe('findDarkRows', () => {
  it('passes a clean fixture-small run', () => {
    // Measured on Metal: 64 samples, 16 unmeasurable, worst judged row at 7 of 17.
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
    // Why the rate is 0.9 rather than 1.0. A uniform world-space offset is not a uniform pixel
    // offset — perspective gives near stars more of it than far ones — so a row can be displaced
    // far enough to go dark and still leave a straggler inside its window.
    expect(findDarkRows(rows([[0, 15]]), rows([[0, 14]]))).toEqual([[0, 14, 15]])
    // Two stragglers out of 15 is 0.87 and is not judged dark. That band is left to `missed`:
    // a star measured further than the tolerance fails on its own offset, whatever its row did.
    expect(findDarkRows(rows([[0, 15]]), rows([[0, 13]]))).toEqual([])
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
