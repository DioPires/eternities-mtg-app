/**
 * §1.12's GPU budget, recomputed from what the renderer allocates (DEC-751).
 *
 * §1.12 claims concept B lands **under** PRD 7.2's 96 MiB target and lower than today's worst case
 * — "the first place concept B pays for itself rather than costing" — and that claim is the reason
 * the atlas can be retired. It is worth a test because every row of it moves: the pool moves with
 * the quality rung, two rows are `.length`s of the dataset, and the cell row moved by 4 bytes per
 * cell while §1.11's filter was being written.
 *
 * So the rows are derived here from the same constants the allocations use, and the dataset counts
 * are read off the shipped `planes.json` rather than typed in. What is asserted is the *conclusion*
 * — under target, under today's worst case, and by how much — not the table.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PlanesFile } from '../src/data/types'
import { PRINTING_IMAGE_HEIGHT, PRINTING_IMAGE_WIDTH } from '../src/scene/cards/focusedCard'
import {
  GPU_TARGET_BYTES,
  MEGABYTE,
  printingRingBytesFor,
  worldsBudgetReport,
  worstCaseReport,
} from '../src/scene/cards/gpuMemory'
import { PLANET_CAP } from '../src/scene/tuning'
import { QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'
import { isWorldPlane } from '../src/data/types'

const roles = JSON.parse(readFileSync(resolve(__dirname, '../datasets.json'), 'utf8')) as Record<
  string,
  string
>
const PLANES = JSON.parse(
  readFileSync(resolve(__dirname, '../public/data', roles.worlds!, 'planes.json'), 'utf8'),
) as PlanesFile
const WORLDS = PLANES.planes.filter(isWorldPlane)
const CELLS = WORLDS.reduce((n, world) => n + world.cardCount, 0)

const mib = (bytes: number): number => bytes / MEGABYTE

/** The shipped v3 dataset at rung 0, one card face. */
const v3 = () =>
  worldsBudgetReport({
    artPoolLayers: QUALITY_TIERS[0]!.artPoolLayers,
    worldsWithCards: WORLDS.length,
    cells: CELLS,
    doubleFaced: false,
  })

describe('§1.12 the worlds budget', () => {
  it('is measuring the dataset that ships', () => {
    // The two dataset-dependent rows are only meaningful if these are the real counts. A fixture
    // would let every figure below be self-consistent and wrong.
    expect(WORLDS).toHaveLength(45)
    expect(CELLS).toBe(24399)
  })

  it('lands under PRD 7.2s target with room to spare', () => {
    const report = v3()
    expect(report.withinTarget).toBe(true)
    expect(report.withinCeiling).toBe(true)
    // Headroom stated as a bound rather than a digit: the point is that there is a lot of it, and
    // an exact figure here would have to be edited by anyone who touches any row.
    expect(mib(GPU_TARGET_BYTES - report.totalBytes)).toBeGreaterThan(20)
  })

  it('costs less than the atlas-era worst case it replaces', () => {
    // §1.12's actual argument. The galaxy's worst case is dominated by a fixed 64 MiB atlas that
    // concept B retires; if this ever inverts, the case for retiring it goes with it.
    expect(v3().totalBytes).toBeLessThan(worstCaseReport().totalBytes)
  })

  it('still fits with a double-faced card in focus, which is the figure to assert against', () => {
    // `worstCaseCardBytes` multiplies the face by two, so a DFC is the case PRD 7.2 is measured at.
    const single = v3()
    const dfc = worldsBudgetReport({
      artPoolLayers: QUALITY_TIERS[0]!.artPoolLayers,
      worldsWithCards: WORLDS.length,
      cells: CELLS,
      doubleFaced: true,
    })
    expect(dfc.totalBytes).toBe(single.totalBytes + single.focusedCardBytes)
    expect(dfc.withinTarget).toBe(true)
  })

  it('moves with the quality rung, because the pool is most of it', () => {
    // The rung has to be visible in the budget or it is not buying anything. Bottom rung against
    // top: the pool goes 1,024 -> 128 layers, and that is 42 MiB of the total.
    const bottom = worldsBudgetReport({
      artPoolLayers: QUALITY_TIERS[QUALITY_TIERS.length - 1]!.artPoolLayers,
      worldsWithCards: WORLDS.length,
      cells: CELLS,
      doubleFaced: false,
    })
    expect(mib(v3().artPoolBytes - bottom.artPoolBytes)).toBeCloseTo(42, 1)
    expect(bottom.totalBytes).toBeLessThan(v3().totalBytes)
  })

  it('sizes its two dataset rows from the roster, not from a constant', () => {
    // §1.12 in terms: "a renderer that allocates either from a constant is wrong on one of the two
    // datasets it is guaranteed to meet." Both rows must respond to their input.
    const small = worldsBudgetReport({
      artPoolLayers: QUALITY_TIERS[0]!.artPoolLayers,
      worldsWithCards: 29,
      cells: 23607,
      doubleFaced: false,
    })
    expect(small.equirectBytes).toBeLessThan(v3().equirectBytes)
    expect(small.cellBytes).toBeLessThan(v3().cellBytes)
    // The 87-plane roster is the cheaper of the two, and the refresh's cost is almost all equirect.
    expect(mib(v3().totalBytes - small.totalBytes)).toBeCloseTo(2.03, 1)
  })

  it('prices the printing ring at §1.10s flat quads, which have now landed', () => {
    // 72 `small` images at 146 x 204 x 4 = 8.18 MiB. This row read 13.15 MiB while the ring still
    // uploaded `art_crop` at PRD 8.5.10's 256 px, and §1.12's table has always carried 8.18 — so
    // the row agreeing with the table is the conversion arriving, not the table being restated.
    expect(mib(v3().printingRingBytes)).toBeCloseTo(8.18, 2)
    expect(v3().withinTarget).toBe(true)
  })

  it('takes the ring row from the image the ring actually uploads', () => {
    /*
     * The row is 8.18 MiB either because it is computed from the quad's texture size or because
     * someone typed 8,577,792, and **the number alone cannot tell those apart**. The first version
     * of this row asserted `printingRingBytes === PLANET_CAP * W * H * 4` and called that
     * provenance; the mutant that replaced the row's body with its own literal value survived it,
     * because both sides of that equation are the same constant.
     *
     * So the row goes through `printingRingBytesFor`, and what is asserted is that the function
     * **responds to its dimensions** — with a non-binding control row, since a function that
     * returned a constant would satisfy any single call of it.
     */
    expect(v3().printingRingBytes).toBe(
      printingRingBytesFor(PRINTING_IMAGE_WIDTH, PRINTING_IMAGE_HEIGHT),
    )
    // Doubling both sides is 4x the texels. A row with a number typed into it does not move.
    expect(printingRingBytesFor(PRINTING_IMAGE_WIDTH * 2, PRINTING_IMAGE_HEIGHT * 2)).toBe(
      v3().printingRingBytes * 4,
    )
    // And the cap is in it: one 1x1 image per printing is 4 bytes each.
    expect(printingRingBytesFor(1, 1)).toBe(PLANET_CAP * 4)
    expect(PRINTING_IMAGE_WIDTH).toBe(146)
    expect(PRINTING_IMAGE_HEIGHT).toBe(204)
  })

  it('computes the ring row rather than carrying its value, which only the source can show', () => {
    /*
     * The residual exposure the row above cannot reach, closed lexically and knowingly.
     *
     * The rows above kill a helper that returns a constant, a helper that drops the cap, and a row
     * fed the wrong dimensions. What none of them can kill is the **call site** being replaced by
     * `8577792` while the helper stays correct: the report's row and the helper's return are then
     * the same number for the one set of dimensions that ships, and no value comparison separates
     * them. Measured, not assumed — that mutant survived the whole behavioural set.
     *
     * So this reads the source. **It is a lexical guard and its limits are the usual ones**: it
     * sees a renamed call, a re-spelled one or a computation moved inline as a failure, and it
     * cannot see a wrong value flowing *into* a correctly-spelled call — which is what the
     * dimension rows above are for. The two together are what make the row falsifiable.
     */
    const source = readFileSync(resolve(__dirname, '../src/scene/cards/gpuMemory.ts'), 'utf8')
    expect(source).toContain(
      'const printingRingBytes = printingRingBytesFor(PRINTING_IMAGE_WIDTH, PRINTING_IMAGE_HEIGHT)',
    )
  })

  it('got cheaper for the conversion, which is the saving §1.12 records', () => {
    // §1.10 sells the flat quad on the picture — undistorted, self-attributing — and §1.12 records
    // that it also pays. The ring it replaces was `PLANET_CAP` art crops at PRD 8.5.10's 256 px on
    // the long side; if a change to the printing image ever inverts this, that note stops holding.
    const artCropRingBytes = PLANET_CAP * 256 * Math.round((256 * 457) / 626) * 4
    expect(v3().printingRingBytes).toBeLessThan(artCropRingBytes)
    expect(mib(artCropRingBytes - v3().printingRingBytes)).toBeCloseTo(4.97, 2)
  })
})
