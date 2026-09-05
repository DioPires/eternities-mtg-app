/**
 * PRD 7.2's GPU memory line: "thumbnails (atlas without mipmaps), planets, and card images —
 * ≤ 96 MB target, 160 MB ceiling".
 *
 * Three things live here rather than being worked out at the call site:
 *
 *  - the **worst case**, which PRD 7.2 and the phase brief both name as "a 72-printing card": the
 *    full atlas, both card faces at `large`, and 72 art crops at 256 px. That is a number the
 *    budget can be checked against without a browser, and `test/cards.test.ts` does exactly that;
 *  - the **live** figure, summed from what is actually uploaded, so the browser check measures
 *    rather than restates;
 *  - the arithmetic that turns a texture's dimensions into bytes, in one place, because the only
 *    interesting way to get this wrong is to count a mipmap chain that PRD 8.5.8 explicitly does
 *    not build.
 *
 * The atlas dominates and is fixed at 64 MB, so the honest reading of the budget is that it leaves
 * 32 MB for everything else at target and 96 MB at ceiling. The worst case uses 19 MB of that.
 */

import { ATLAS_BYTES } from './atlas'
import {
  CARD_IMAGE_HEIGHT,
  CARD_IMAGE_WIDTH,
  PLANET_TEXTURE_HEIGHT,
  worstCaseCardBytes,
} from './focusedCard'
import { PLANET_CAP, PLANET_TEXTURE_PX } from '../tuning'

export const MEGABYTE = 1024 * 1024

/** PRD 7.2, verbatim. */
export const GPU_TARGET_BYTES = 96 * MEGABYTE
export const GPU_CEILING_BYTES = 160 * MEGABYTE

/**
 * Bytes an RGBA8 texture of this size occupies.
 *
 * No mipmap term: PRD 8.5.8 builds no chain for the atlas, and neither the card faces nor the
 * planet art crops generate one either (`generateMipmaps = false` at every upload). A chain would
 * add a third, which is the arithmetic PRD 8.5.8 cites for leaving it out.
 */
export function textureBytes(width: number, height: number): number {
  return width * height * 4
}

export interface GpuMemoryReport {
  readonly atlasBytes: number
  readonly cardBytes: number
  readonly totalBytes: number
  readonly targetBytes: number
  readonly ceilingBytes: number
  readonly withinTarget: boolean
  readonly withinCeiling: boolean
}

/** The live figure. `cardBytes` is `FocusedCard.gpuBytes` — what is uploaded, not what could be. */
export function gpuMemoryReport(atlasBytes: number, cardBytes: number): GpuMemoryReport {
  const totalBytes = atlasBytes + cardBytes
  return {
    atlasBytes,
    cardBytes,
    totalBytes,
    targetBytes: GPU_TARGET_BYTES,
    ceilingBytes: GPU_CEILING_BYTES,
    withinTarget: totalBytes <= GPU_TARGET_BYTES,
    withinCeiling: totalBytes <= GPU_CEILING_BYTES,
  }
}

/**
 * The case PRD 7.2 is measured against: a full atlas plus a card with 72 printings, both faces
 * loaded and every planet textured.
 */
export function worstCaseReport(): GpuMemoryReport {
  return gpuMemoryReport(ATLAS_BYTES, worstCaseCardBytes())
}

/** The pieces of the worst case, for a report that has to be read by a person. */
export const WORST_CASE = {
  atlasBytes: ATLAS_BYTES,
  cardFaceBytes: textureBytes(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT) * 2,
  planetBytes: PLANET_CAP * textureBytes(PLANET_TEXTURE_PX, PLANET_TEXTURE_HEIGHT),
  planets: PLANET_CAP,
} as const

export function formatMb(bytes: number): string {
  return `${(bytes / MEGABYTE).toFixed(1)} MB`
}
