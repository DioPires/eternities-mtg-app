/**
 * The gate writes the control seams into a URL; the renderer parses them back out. This holds the
 * two spellings together.
 *
 * > **A rename cannot be a type error here.** `seamQuery` builds a string and `readWorldsSeams`
 * > reads one, with a page load in between — so if `seams.ts` renames `?art=off` to `?art=none`,
 * > nothing fails to compile and nothing fails to run. The gate loads its page, measures a frame,
 * > and records a control row that ran the *unmodified* build. That is the `verify-browser --dataset
 * > all` shape of failure: a green run that measured nothing.
 *
 * So this file round-trips through `readWorldsSeams` itself rather than restating the six spellings
 * in a table. A second copy of the table is a derived assertion, and a derived assertion cannot see
 * the rename it exists to catch — it would be renamed in the same edit.
 *
 * `seamEvidence`'s echo check is the run-time backstop for the same failure, and it is a good one,
 * but it only fires on a row that reached a live renderer. This fires in the suite.
 */

import { describe, expect, it } from 'vitest'

import { seamQuery } from '../scripts/lib/worlds-probe-read.mjs'
import { readWorldsSeams } from '../src/scene/worlds/seams'
import type { WorldsSeams } from '../src/scene/worlds/seams'

/** What the gate asks for, spelled as the renderer's own seam object. */
const NONE: WorldsSeams = {
  swatchMean: false,
  bandsShuffle: false,
  artOff: false,
  artThresholdFixed24: false,
  layersRequested: null,
}

/** `seamQuery` returns an `&`-prefixed tail; the gate appends it to `?probe=shell`. */
const roundTrip = (seams: Partial<WorldsSeams>): WorldsSeams =>
  readWorldsSeams(`?probe=shell${seamQuery({ ...NONE, ...seams })}`)

describe('seamQuery round-trips through the renderer parser', () => {
  it('asks for nothing when no seam is set', () => {
    expect(seamQuery(NONE)).toBe('')
    expect(roundTrip({})).toEqual(NONE)
  })

  // Every seam, one at a time. Driven off `NONE`'s own keys so a seventh seam added to `WorldsSeams`
  // arrives here as a missing case rather than as silence.
  const SINGLES: ReadonlyArray<[keyof WorldsSeams, Partial<WorldsSeams>]> = [
    ['swatchMean', { swatchMean: true }],
    ['bandsShuffle', { bandsShuffle: true }],
    ['artOff', { artOff: true }],
    ['artThresholdFixed24', { artThresholdFixed24: true }],
    ['layersRequested', { layersRequested: 128 }],
  ]

  it('covers every seam the renderer publishes', () => {
    expect(SINGLES.map(([key]) => key).sort()).toEqual(Object.keys(NONE).sort())
  })

  it.each(SINGLES)('writes %s so the renderer reads it back', (key, seams) => {
    const parsed = roundTrip(seams)
    expect(parsed[key]).toEqual({ ...NONE, ...seams }[key])
    // And moves nothing else: a query that sets two seams when the row asked for one is a matrix
    // measuring a composition it never approved.
    expect(parsed).toEqual({ ...NONE, ...seams })
  })

  it('composes the two rows DEC-824 measured, without either seam swallowing the other', () => {
    // `?art=off&swatch=mean` and `?art=off&bands=shuffle` are W2's and W3's real control rows: the
    // bare colour seams move the swatch, and at §3.1's pose `artFraction` reads 0.987-0.997, so
    // essentially every cell draws art over it.
    expect(roundTrip({ artOff: true, swatchMean: true })).toEqual({
      ...NONE,
      artOff: true,
      swatchMean: true,
    })
    expect(roundTrip({ artOff: true, bandsShuffle: true })).toEqual({
      ...NONE,
      artOff: true,
      bandsShuffle: true,
    })
  })

  it('survives every seam at once', () => {
    const all: WorldsSeams = {
      swatchMean: true,
      bandsShuffle: true,
      artOff: true,
      artThresholdFixed24: true,
      layersRequested: 224,
    }
    expect(roundTrip(all)).toEqual(all)
  })

  it('writes layers=N as the integer the renderer parses, not as a truthiness', () => {
    // `layersRequested` is the one seam that is not a boolean, and `0` is a legal request — a
    // swatch-only pool. A `if (seams.layersRequested)` would drop it and the row would silently run
    // the shipped 1,024.
    expect(seamQuery({ ...NONE, layersRequested: 0 })).toBe('&layers=0')
    expect(roundTrip({ layersRequested: 0 }).layersRequested).toBe(0)
  })
})
