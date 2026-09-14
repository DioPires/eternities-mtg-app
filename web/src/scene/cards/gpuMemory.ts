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
import { ART_LAYER_HEIGHT, ART_LAYER_WIDTH } from '../worlds/artStream'
import { CELL_INSTANCE_BYTES } from '../worlds/cellSheet'
import { EQUIRECT_HEIGHT, EQUIRECT_WIDTH } from '../worlds/lod'

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

/**
 * Worlds spec §1.12's budget, as arithmetic over the things that are actually allocated.
 *
 * The galaxy's report above is dominated by a fixed 64 MiB atlas. Concept B **retires the atlas** —
 * the card-sheet tier it feeds is what the world surface replaces — and spends the room on the art
 * pool, so the two paths have different resident sets and the budget has to be able to say which
 * one it is describing.
 *
 * **Every row is computed from the constant the renderer allocates with, never transcribed from
 * the spec's table.** That is the difference between a budget and a restatement: §1.11's filter
 * added 4 bytes per cell while this was being written, and a table of literals would have gone on
 * reporting the old figure with the suite green. The two dataset-dependent rows — the equirect
 * array and the cell attributes — are `.length`s of §3.1's derived sets for the same reason §1.12
 * gives: a renderer that sizes either from a constant is wrong on one of the two datasets it is
 * guaranteed to meet.
 */
export interface WorldsBudgetInput {
  /** The **clamped** pool size the renderer reports, never a tier constant (§1.6, §1.12). */
  readonly artPoolLayers: number
  /** Worlds with cards — one baked equirect layer each (§1.5). 45 on v3, 29 on the 87-plane roster. */
  readonly worldsWithCards: number
  /** Cells on the roster: cards on worlds (§1.4). 24,399 on v3. */
  readonly cells: number
  /** PRD 7.2's worst case counts both faces of a double-faced card; one face otherwise. */
  readonly doubleFaced: boolean
}

export interface WorldsBudgetReport {
  readonly artPoolBytes: number
  readonly equirectBytes: number
  readonly cellBytes: number
  readonly printingRingBytes: number
  readonly focusedCardBytes: number
  readonly totalBytes: number
  readonly targetBytes: number
  readonly ceilingBytes: number
  readonly withinTarget: boolean
  readonly withinCeiling: boolean
}

export function worldsBudgetReport(input: WorldsBudgetInput): WorldsBudgetReport {
  const artPoolBytes = input.artPoolLayers * textureBytes(ART_LAYER_WIDTH, ART_LAYER_HEIGHT)
  const equirectBytes = input.worldsWithCards * textureBytes(EQUIRECT_WIDTH, EQUIRECT_HEIGHT)
  const cellBytes = input.cells * CELL_INSTANCE_BYTES
  // The ring as it is drawn **today**: 72 art crops at PRD 8.5.10's 256 px on the long side.
  // §1.10's flat `small` quads (146x204) would make this row 8.18 MiB instead of 13.15; the
  // conversion has not landed, so reporting 8.18 here would be reporting a plan.
  const printingRingBytes = PLANET_CAP * textureBytes(PLANET_TEXTURE_PX, PLANET_TEXTURE_HEIGHT)
  const focusedCardBytes =
    textureBytes(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT) * (input.doubleFaced ? 2 : 1)
  const totalBytes =
    artPoolBytes + equirectBytes + cellBytes + printingRingBytes + focusedCardBytes
  return {
    artPoolBytes,
    equirectBytes,
    cellBytes,
    printingRingBytes,
    focusedCardBytes,
    totalBytes,
    targetBytes: GPU_TARGET_BYTES,
    ceilingBytes: GPU_CEILING_BYTES,
    withinTarget: totalBytes <= GPU_TARGET_BYTES,
    withinCeiling: totalBytes <= GPU_CEILING_BYTES,
  }
}
