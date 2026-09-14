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
import {
  GPU_TARGET_BYTES,
  MEGABYTE,
  worldsBudgetReport,
  worstCaseReport,
} from '../src/scene/cards/gpuMemory'
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

  it('reports the printing ring as it is drawn today, not as §1.10 plans it', () => {
    // §1.12's table prices the ring at 8.18 MiB, which is 72 flat `small` quads (146x204). The ring
    // still draws 72 art crops at PRD 8.5.10's 256 px, so today it costs 13.15 MiB. The budget
    // reports the allocation; the gap is the flat-quad conversion, which has not landed.
    expect(mib(v3().printingRingBytes)).toBeCloseTo(13.15, 2)
    // And the conclusion survives the difference, which is why the conversion is not urgent.
    expect(v3().withinTarget).toBe(true)
  })
})
