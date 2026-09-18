/**
 * The quality ladder's fan-out: one announcement, four rungs (PRD 8.5.11, DEC-739, DEC-756).
 *
 * `applyQualityTier` is the *only* place a tier becomes a change to the scene, and `SceneHost` calls
 * it from one place: the quality monitor's subscription, which fires once for the starting tier and
 * again on every runtime change. That shape is DEC-747's blocking finding answered — the previous
 * arrangement had two writers for rung 1, each alone sufficient under a `?quality=` pin, so no
 * single mutation could turn the suite red.
 *
 * This file drives the fan-out over a recorder, without a GL context. What it cannot see is the
 * wire from the monitor to `applyTier`; that is one line in `SceneHost`'s constructor and it is
 * covered by `e2e/quality.spec.ts` reading the live scene. What it *can* see, and what no test
 * previously could, is whether each rung moves what it names.
 *
 * **Adjacent tiers, not tiers in isolation.** The ladder's stated invariant is one knob per rung —
 * each tier differs from the one above it in exactly one quantity, where rung 2's quantity is the
 * bloom chain and moves two fields together (DEC-756's correction to DEC-747 N3). Asserting that
 * means comparing *pairs*, which is why the walk below is over adjacent pairs rather than over
 * tiers. A per-tier test would pass on a ladder whose rungs all moved everything.
 */

import { describe, expect, it } from 'vitest'

import {
  applyQualityTier,
  type QualityRungTargets,
} from '../src/scene/renderer/sceneHost'
import { QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'

/** Every call the fan-out makes, in order, as `knob=value` strings. */
function record(): { calls: string[]; targets: QualityRungTargets } {
  const calls: string[] = []
  return {
    calls,
    targets: {
      setPixelRatioCap: (v) => calls.push(`pixelRatioCap=${v}`),
      setBloomScale: (v) => calls.push(`bloomScale=${v}`),
      setBloomLevels: (v) => calls.push(`bloomLevels=${v}`),
      setThumbnailCapacity: (v) => calls.push(`thumbnailCapacity=${v}`),
      setArtPoolLayers: (v) => calls.push(`artPoolLayers=${v}`),
      setGlowQuality: (v) => calls.push(`glowQuality=${v}`),
    },
  }
}

function appliedFor(tierIndex: number): string[] {
  const { calls, targets } = record()
  applyQualityTier(QUALITY_TIERS[tierIndex]!, targets)
  return calls
}

describe('applyQualityTier (PRD 8.5.11: one announcement, every rung)', () => {
  it('writes every rung, so a tier can never be half-applied', () => {
    // The failure this rules out is a tier that reaches three of its four consumers. Nothing about
    // the ladder is observable from outside the scene except by measuring a frame, so a rung that
    // silently did not land would look exactly like a rung that did not help.
    const calls = appliedFor(0)
    expect(calls.map((call) => call.split('=')[0])).toEqual([
      'pixelRatioCap',
      'bloomScale',
      'bloomLevels',
      'thumbnailCapacity',
      'artPoolLayers',
      'glowQuality',
    ])
  })

  it('moves exactly one knob between adjacent tiers', () => {
    // The ladder's invariant, stated as a comparison rather than as prose. `bloomScale` and
    // `bloomLevels` are one knob — the bloom chain — because §3.5 asks for that rung as a single
    // step ("bloom source half → quarter res and 8 → 7 mip levels"), and `starBloomScale` is the
    // same number reaching a second consumer.
    const KNOB_OF: Record<string, string> = {
      pixelRatioCap: 'pixel ratio',
      bloomScale: 'bloom chain',
      bloomLevels: 'bloom chain',
      starBloomScale: 'bloom chain',
      // One knob, two consumers, for the same reason the bloom chain is one: rung 3 is the
      // resident card-image budget, and which of the two reaches the picture depends on whether
      // the page is on the galaxy's atlas or worlds' art pool (DEC-753, worlds §1.12).
      thumbnailCapacity: 'card imagery',
      artPoolLayers: 'card imagery',
      glowQuality: 'glow',
    }

    const moved: string[][] = []
    for (let index = 1; index < QUALITY_TIERS.length; index += 1) {
      const above = appliedFor(index - 1)
      const here = appliedFor(index)
      const knobs = new Set<string>()
      for (let i = 0; i < here.length; i += 1) {
        if (here[i] === above[i]) continue
        knobs.add(KNOB_OF[here[i]!.split('=')[0]!]!)
      }
      moved.push([...knobs])
    }

    // Four tiers, three steps, one knob each and no knob twice — which is the part prose cannot
    // assert: a ladder that moved 'bloom chain' on two different rungs would satisfy "exactly one
    // knob per step" and still not be a ladder.
    for (const knobs of moved) expect(knobs).toHaveLength(1)
    const flat = moved.flat()
    expect(new Set(flat).size, 'no knob may be the rung for two different steps').toBe(flat.length)
  })
})
