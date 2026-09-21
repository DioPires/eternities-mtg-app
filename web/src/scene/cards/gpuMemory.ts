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

import {
  CARD_IMAGE_HEIGHT,
  CARD_IMAGE_WIDTH,
  PRINTING_IMAGE_HEIGHT,
  PRINTING_IMAGE_WIDTH,
  worstCaseCardBytes,
} from './focusedCard'
import { PLANET_CAP } from '../tuning'
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
 * The case PRD 7.2 is measured against: a card with 72 printings, both faces loaded and every
 * planet textured.
 *
 * > **The atlas term is 0 because the atlas no longer exists (DEC-752).** PRD 7.2 was written
 * > against a 64 MB thumbnail atlas that dominated the budget; the cutover deleted it with the rest
 * > of the thumbnail tier. The **field** is kept because `SceneReadout` still prints the split
 * > (`FrameStats.atlasBytes`, a structural 0) and `cards.test.ts` / `worlds-budget.test.ts` read
 * > this report. `ProbeState` no longer publishes an atlas term: DEC-861 dropped its
 * > `gpu.atlasBytes`, which nothing read.
 */
export function worstCaseReport(): GpuMemoryReport {
  return gpuMemoryReport(0, worstCaseCardBytes())
}

/** The pieces of the worst case, for a report that has to be read by a person. */
export const WORST_CASE = {
  /** 0 since the cutover retired the thumbnail atlas (DEC-752). */
  atlasBytes: 0,
  cardFaceBytes: textureBytes(CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT) * 2,
  planetBytes: PLANET_CAP * textureBytes(PRINTING_IMAGE_WIDTH, PRINTING_IMAGE_HEIGHT),
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

/**
 * §1.10's ring: the cap's worth of `small` quads, at whatever size that image is.
 *
 * **A function of its dimensions rather than an expression inlined below, so the row can be proved
 * to respond to them.** This row is the one row of the budget that takes no varying input — the
 * other four move with `artPoolLayers`, `worldsWithCards`, `cells` and `doubleFaced`, so a constant
 * transcribed into any of those shows up the moment a test varies one. Here `PLANET_CAP *
 * textureBytes(146, 204)` and a typed `8,577,792` are the same number, and no assertion comparing
 * the row against that product can tell them apart: it was tried, and the mutant that replaced the
 * row with its literal value survived. Giving the row an input is what makes the difference
 * observable.
 */
export function printingRingBytesFor(imageWidth: number, imageHeight: number): number {
  return PLANET_CAP * textureBytes(imageWidth, imageHeight)
}

export function worldsBudgetReport(input: WorldsBudgetInput): WorldsBudgetReport {
  const artPoolBytes = input.artPoolLayers * textureBytes(ART_LAYER_WIDTH, ART_LAYER_HEIGHT)
  const equirectBytes = input.worldsWithCards * textureBytes(EQUIRECT_WIDTH, EQUIRECT_HEIGHT)
  const cellBytes = input.cells * CELL_INSTANCE_BYTES
  const printingRingBytes = printingRingBytesFor(PRINTING_IMAGE_WIDTH, PRINTING_IMAGE_HEIGHT)
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
