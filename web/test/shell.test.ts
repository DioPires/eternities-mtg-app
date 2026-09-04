/**
 * The remaining pure pieces of the shell: PRD 6.9's random, PRD 6.10's settings, and the
 * star-index-to-plane lookup the deep-link path depends on.
 */

import { describe, expect, it } from 'vitest'

import { planeOfStarIndex } from '../src/app/boot'
import { pickRandom } from '../src/app/random'
import type { PlaneRecord } from '../src/data'
import {
  DEFAULT_SETTINGS,
  parseSettings,
  resolveReducedMotion,
} from '../src/store/settings'

function plane(patch: Partial<PlaneRecord> & Pick<PlaneRecord, 'slug' | 'cardCount'>): PlaneRecord {
  return {
    index: 0,
    displayName: patch.slug,
    notes: '',
    kind: 'spiral',
    starOffset: 0,
    starCount: patch.cardCount,
    shardCount: 1,
    home: [0, 0, 0],
    radius: 1,
    tilt: [0, 0, 0, 1],
    spinPeriodS: 1,
    spinDirection: 1,
    driftAmplitude: 0,
    driftPeriodS: 0,
    driftPhase: 0,
    shearAmplitude: 0,
    shearPeriodS: 0,
    shearPhase: 0,
    armPitch: 0,
    discThickness: 0.05,
    bar: false,
    palette: [1, 0, 0, 0, 0, 0, 0],
    nebulaTint: [1, 1, 1],
    firstYear: null,
    lastYear: null,
    sets: [],
    ...patch,
  }
}

const ROSTER: PlaneRecord[] = [
  plane({ index: 0, slug: 'blind-eternities', cardCount: 6600, starOffset: 0, starCount: 6600 }),
  plane({ index: 1, slug: 'dominaria', cardCount: 2400, starOffset: 6600, starCount: 2400 }),
  plane({ index: 2, slug: 'segovia', cardCount: 9, starOffset: 9000, starCount: 9 }),
  plane({ index: 3, slug: 'antausia', cardCount: 0, starOffset: 9009, starCount: 0 }),
]

describe('planeOfStarIndex — the deep-link path (PRD 6.7.1)', () => {
  it('finds the plane a star belongs to from planes.json alone', () => {
    expect(planeOfStarIndex(ROSTER, 0)?.slug).toBe('blind-eternities')
    expect(planeOfStarIndex(ROSTER, 6599)?.slug).toBe('blind-eternities')
    expect(planeOfStarIndex(ROSTER, 6600)?.slug).toBe('dominaria')
    expect(planeOfStarIndex(ROSTER, 9008)?.slug).toBe('segovia')
  })

  it('returns null outside every range rather than guessing', () => {
    expect(planeOfStarIndex(ROSTER, 99_999)).toBeNull()
    expect(planeOfStarIndex(ROSTER, -1)).toBeNull()
  })
})

describe('random (PRD 6.9.1)', () => {
  it('excludes zero-card planes', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const pick = pickRandom(ROSTER, seededRandom(i))
      if (pick) seen.add(pick.plane.slug)
    }
    expect(seen.has('antausia')).toBe(false)
  })

  it('includes the Blind Eternities', () => {
    // Ticket 0 lands in the first eligible plane, which is the Blind Eternities.
    const pick = pickRandom(ROSTER, constant(0))
    expect(pick?.plane.slug).toBe('blind-eternities')
  })

  it('returns a star index inside the chosen plane', () => {
    for (let i = 0; i < 100; i += 1) {
      const pick = pickRandom(ROSTER, seededRandom(i))
      expect(pick).not.toBeNull()
      const { plane: chosen, starIndex } = pick!
      expect(starIndex).toBeGreaterThanOrEqual(chosen.starOffset)
      expect(starIndex).toBeLessThan(chosen.starOffset + chosen.starCount)
    }
  })

  it('weights by the square root of the card count, not by the count', () => {
    // Blind Eternities is 2.75× Dominaria by card count but only √2.75 ≈ 1.66× by weight, and the
    // whole point of PRD 6.9.1's square root is that the difference is visible.
    const counts = new Map<string, number>()
    const random = seededRandom(1234)
    for (let i = 0; i < 20_000; i += 1) {
      const pick = pickRandom(ROSTER, random)
      if (pick) counts.set(pick.plane.slug, (counts.get(pick.plane.slug) ?? 0) + 1)
    }
    const blind = counts.get('blind-eternities') ?? 0
    const dominaria = counts.get('dominaria') ?? 0
    const ratio = blind / dominaria
    expect(ratio).toBeGreaterThan(1.3)
    expect(ratio).toBeLessThan(2.1)
    // Segovia has nine cards and must still be reachable.
    expect(counts.get('segovia') ?? 0).toBeGreaterThan(0)
  })

  it('returns null when nothing is eligible', () => {
    expect(pickRandom([plane({ slug: 'empty', cardCount: 0, starCount: 0 })])).toBeNull()
  })

  it('never runs off the end when random() returns its supremum', () => {
    const pick = pickRandom(ROSTER, constant(0.999_999_999_999))
    expect(pick).not.toBeNull()
    expect(pick!.starIndex).toBeLessThan(pick!.plane.starOffset + pick!.plane.starCount)
  })
})

describe('settings (PRD 6.10.2)', () => {
  it('falls back to the defaults for missing storage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('survives a corrupt blob', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS)
  })

  it('validates field by field, so one bad value does not discard the rest', () => {
    expect(parseSettings(JSON.stringify({ bloom: 9, labels: false }))).toEqual({
      ...DEFAULT_SETTINGS,
      labels: false,
    })
  })

  it('defers to the OS by default and overrides it on request (PRD 6.10.1)', () => {
    expect(resolveReducedMotion('os', true)).toBe(true)
    expect(resolveReducedMotion('os', false)).toBe(false)
    expect(resolveReducedMotion('off', true)).toBe(false)
    expect(resolveReducedMotion('on', false)).toBe(true)
  })
})

/** A small LCG, so the distribution assertions above are reproducible run to run. */
function seededRandom(seed: number): () => number {
  let state = (seed | 0) === 0 ? 1 : seed | 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function constant(value: number): () => number {
  return () => value
}
