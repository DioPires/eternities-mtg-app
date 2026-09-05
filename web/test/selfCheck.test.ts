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

import { findDarkRows, pixelForNdc } from '../src/scene/selfCheck'

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
