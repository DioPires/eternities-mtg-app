/**
 * The ladder's own invariant, as a test (worlds spec §1.12; ordered by DEC-753's ruling).
 *
 * > "R3 should also add a small unit test that asserts every adjacent tier pair differs in exactly
 * > one knob. That test catches an inert rung automatically and goes red if anyone reintroduces
 * > one."
 *
 * The history this exists for is two rungs deep. `bloomScale` moved alone and the bloom rung was
 * inert for a phase (`adaptiveQuality.ts`'s finding R3). Then the worlds plan proposed retiring the
 * thumbnail atlas, which would have made rung 3 — whose only quantity was the atlas capacity —
 * inert in the same way, silently, with `e2e/quality.spec.ts`'s assertion still passing because it
 * compared two numbers that still differed while neither reached the picture.
 *
 * So the check is deliberately **structural** rather than a list of expected values: a test that
 * restates the constants cannot see a field that stops being read, and cannot see a new field
 * bolted onto a rung that already turns a knob. It reads {@link QUALITY_KNOBS} — the grouping the
 * module publishes — and holds it to four properties that together mean "each rung turns exactly
 * one knob, and no two rungs turn the same one".
 */

import { describe, expect, it } from 'vitest'

import {
  QUALITY_KNOBS,
  QUALITY_TIERS,
  type QualityTier,
} from '../src/scene/quality/adaptiveQuality'
import { artPoolSize } from '../src/scene/worlds/artPool'

/** Every field a tier carries except the one that only names it. */
const FIELDS = (Object.keys(QUALITY_TIERS[0]!) as (keyof QualityTier)[]).filter(
  (field) => field !== 'label',
)

/** The knobs whose fields differ between two adjacent rungs. */
function knobsMoved(above: QualityTier, below: QualityTier): string[] {
  return Object.entries(QUALITY_KNOBS)
    .filter(([, fields]) => fields.some((field) => above[field] !== below[field]))
    .map(([knob]) => knob)
}

describe('§1.12 the quality ladder turns one knob per rung', () => {
  it('assigns every field of a tier to exactly one knob', () => {
    // The property that keeps the rest of this file from going vacuous. Without it a new field
    // added to `QualityTier` — a second capacity, a geometry budget — belongs to no knob, moves
    // invisibly to `knobsMoved`, and every assertion below passes while the invariant is broken.
    const owners = new Map<string, string[]>()
    for (const [knob, fields] of Object.entries(QUALITY_KNOBS)) {
      for (const field of fields) {
        owners.set(field, [...(owners.get(field) ?? []), knob])
      }
    }
    expect([...owners.keys()].sort()).toEqual([...FIELDS].sort())
    for (const [field, knobs] of owners) expect(knobs, field).toHaveLength(1)
  })

  it('moves exactly one knob per rung', () => {
    const moved = QUALITY_TIERS.slice(1).map((tier, index) => knobsMoved(QUALITY_TIERS[index]!, tier))
    // Exactly one, in both directions: `>= 1` alone would pass an inert rung's neighbour absorbing
    // two knobs, and `<= 1` alone would pass a rung that moves nothing at all.
    for (const [index, knobs] of moved.entries()) {
      expect(knobs, `rung ${index + 1} (${QUALITY_TIERS[index + 1]!.label})`).toHaveLength(1)
    }
    // And no knob belongs to two rungs, which is the half that makes a rung *isolable*: it is what
    // lets `e2e/quality.spec.ts` attribute a measured change to the rung it stepped.
    const turned = moved.flat()
    expect(new Set(turned).size).toBe(turned.length)
    // Every declared knob is actually turned by some rung. A knob nothing moves is a rung that was
    // deleted without its grouping, and it would make the uniqueness check above weaker for free.
    expect(new Set(turned)).toEqual(new Set(Object.keys(QUALITY_KNOBS)))
  })

  it('keeps the art-pool rung live under the clamp a spec-minimum device imposes', () => {
    // The inert-rung trap in its §1.12 form, and the reason the rung is 1,024 -> 128 rather than
    // the 1,024 -> 256 the spec's first draft carried. WebGL 2's SPECIFICATION MINIMUM for
    // `MAX_ARRAY_TEXTURE_LAYERS` is 256, so `artPoolSize` answers 224 for every request at or
    // above it: a rung of 256 reads 224 -> 224 on exactly the hardware W0.1 is measuring, and the
    // rung moves nothing there while passing any assertion written against the constants.
    const clamped = QUALITY_TIERS.map((tier) => artPoolSize(tier.artPoolLayers, 256))
    expect(clamped).toEqual([224, 224, 224, 128, 128])
    expect(clamped[3]).toBeLessThan(clamped[2]!)
    // The non-binding control: on a device with slack, the rung is the tier's own request. Without
    // this row an `artPoolSize` that returned a constant 224/128 split would satisfy the above.
    expect(QUALITY_TIERS.map((tier) => artPoolSize(tier.artPoolLayers, 2048))).toEqual([
      1024, 1024, 1024, 128, 128,
    ])
  })

  it('spends the rung where §1.12 says the memory is', () => {
    // Not a restatement of the table: this is the one arithmetic claim §1.12 makes about the rung,
    // that stepping it is what buys the room the retired 64 MiB atlas used to occupy. 128 x 96
    // RGBA8, no mips (§1.6).
    const mib = (layers: number): number => (layers * 128 * 96 * 4) / (1024 * 1024)
    expect(mib(QUALITY_TIERS[0]!.artPoolLayers)).toBeCloseTo(48, 2)
    expect(mib(QUALITY_TIERS[4]!.artPoolLayers)).toBeCloseTo(6, 2)
  })
})
