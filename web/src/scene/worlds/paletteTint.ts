/**
 * §1.8's palette-deviation tint — the colour a world reads as once it is too far away to be itself.
 *
 * > **Normative (§1.8).** *"Mixed straight, they come out the same grey, because Magic's colour pie
 * > is balanced — the same finding that makes the shipped arm-skew law inert (review §4.1). So the
 * > mix runs on the **deviation from the card-weighted multiverse mean**, amplified ×3.2: a plane at
 * > the average is grey, a plane that is unusual is unusual in the direction it is unusual in.
 * > Alara's 58% gold and Ravnica's 39% multicolour are what this exists to show. The stretch is a
 * > choice; the grey is the data."*
 *
 * **Where this applies, and only here (§1.5).** Below a world's 6 px on-screen radius the equirect
 * layer stops carrying information — the sampler converges on the layer's own mean, and a mean over
 * a balanced colour pie is the same grey for every plane — so the system instance mixes from its
 * equirect sample toward this colour. R1 owns the *mix* (`tintMix`); §1.8 owns the colour it mixes
 * toward, and that boundary is §1.5's normative note. This file is the second half of it.
 *
 * **The weights are `planes.json`'s own `palette`** — the seven WUBRG-multi-colourless weights of
 * PRD 5.3.5, summing to 1 — so the colour at system distance is a statistic of the plane's cards
 * rather than a stand-in. The seven colours it weights are {@link HUE_COLOURS}, the table the star
 * field already draws with: one table, so a world's far colour and its stars cannot drift apart.
 */

import type { PlaneRecord } from '../../data/types'
import { HUE_COLOURS } from '../tuning'

/** Seven weights, because seven hue classes (PRD 5.3.5, and {@link HUE_COLOURS}'s length). */
const HUE_CLASSES = 7

/**
 * §1.8's ×3.2 contrast stretch on the deviation from the multiverse mean.
 *
 * Appendix B row 7 promotes the prototype's stretch to normative unchanged. It is a **choice** and
 * the spec says so in terms — what is data is the deviation's *direction*, not its magnitude.
 */
export const PALETTE_GAIN = 3.2

/**
 * The colour an undetailed world with no palette signal falls back to.
 *
 * Reachable only when every stretched weight clamps to zero, which needs a plane whose palette is
 * below the multiverse mean in all seven classes at once — impossible for a vector that sums to 1,
 * but a `palette` shorter than seven entries (a truncated or hand-edited `planes.json`) gets there.
 * A neutral slate rather than black: a world drawn at `(0,0,0)` is indistinguishable from §1.8's
 * dark moon, which is the one confusion this whole section exists to prevent.
 */
const NEUTRAL: readonly [number, number, number] = [0.25, 0.26, 0.3]

/**
 * The card-weighted mean palette of the multiverse — the origin the deviation is measured from.
 *
 * > **The set is `planesWithCards`, the belt included (§3.1).** "The card-weighted multiverse mean"
 * > is read literally: every card in the multiverse gets one vote, and on v3 the Blind Eternities
 * > is 4,204 of 28,603 of them — 14.70%, the largest population after Dominaria (§1.8). Excluding it
 * > would make the reference "the mean of the worlds" and shift the origin every world is then
 * > measured against, which moves every tint on the roster rather than only the belt's (which has no
 * > tint at all: it is drawn as points, never as a system instance).
 * >
 * > This is the one place §1.8's wording admits two readings, so it is pinned by
 * > `worlds-system.test.ts` against both and the difference is reported rather than assumed.
 *
 * Empty planes carry `cardCount === 0` and so contribute nothing by weight — they are skipped
 * explicitly anyway, because a plane with no cards has no colour statistic to average and §1.8 gives
 * it a flat moon colour with **no palette tint at all**.
 */
export function multiverseMeanPalette(planes: readonly PlaneRecord[]): number[] {
  const mean = new Array<number>(HUE_CLASSES).fill(0)
  let cards = 0
  for (const plane of planes) {
    if (plane.cardCount <= 0) continue
    cards += plane.cardCount
    for (let hue = 0; hue < HUE_CLASSES; hue += 1) {
      mean[hue] = (mean[hue] ?? 0) + (plane.palette[hue] ?? 0) * plane.cardCount
    }
  }
  if (cards === 0) return mean.fill(1 / HUE_CLASSES)
  return mean.map((total) => total / cards)
}

/**
 * One world's stretched palette colour, in the same **linear** working space the swatches are in.
 *
 * The stretch is applied to the *weights* and the colour is mixed afterwards, which is not the same
 * as stretching the mixed colour: `HUE_COLOURS` are not an orthogonal basis — gold and colourless
 * both sit near the middle of the others — so a plane that is gold-heavy and a plane that is evenly
 * mixed have nearly the same mixed colour and very different weight vectors. Stretching the mix
 * would amplify the difference that survived the mixing, which is the one that is already gone.
 *
 * Weights clamp at zero rather than going negative: a negative weight on a hue is a subtraction of
 * that hue from the others, which produces colours no plane's cards can justify — and `total` is
 * the normaliser, so one negative weight also moves every channel of the result.
 *
 * @param reference {@link multiverseMeanPalette}'s output. Omit it to get the un-stretched mix,
 *   which is what §1.8 says comes out the same grey for every plane — kept reachable because
 *   `worlds-system.test.ts` asserts exactly that, and a control nobody can run is not a control.
 */
export function paletteTint(
  plane: PlaneRecord,
  reference?: readonly number[],
): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let hue = 0; hue < HUE_CLASSES; hue += 1) {
    const raw = plane.palette[hue] ?? 0
    const mean = reference?.[hue]
    const weight = mean === undefined ? raw : Math.max(0, mean + (raw - mean) * PALETTE_GAIN)
    const colour = HUE_COLOURS[hue] ?? NEUTRAL
    r += colour[0] * weight
    g += colour[1] * weight
    b += colour[2] * weight
    total += weight
  }
  if (!(total > 0)) return [NEUTRAL[0], NEUTRAL[1], NEUTRAL[2]]
  return [r / total, g / total, b / total]
}
