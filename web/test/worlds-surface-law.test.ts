/**
 * The surface law, the cell sheet and the LOD crossover on the client (spec §1.3–§1.5, §2.1).
 *
 * Almost everything here is measured against the **shipped** dataset rather than against a
 * constant, because §1.3's central consequence is that `rowCells` is *not* a function of
 * `cardCount`: the pipeline apportions a row's cells within each colour band and then splits each
 * band's share between sets, so the same N under different hue histograms yields a different table.
 * A test that reconstructs a cell count is testing a form the renderer is forbidden to use.
 *
 * The dataset is resolved by **role** (`datasets.json`'s `worlds`), never by hash. Three hashes
 * have already moved under this leg's instruments, and each move turned a live check into a dead
 * path — see `docs/worlds/surface-law-check.py`, which is this file's Python half and asserts the
 * same laws on the same bytes.
 *
 * Four of the assertions below exist because the spec names them as unit tests in so many words:
 * the index buffer's winding (§1.4), the sub-quad envelope per world (§1.4), the nearest-row match
 * (§2.1), and — in `worlds-art-stream.test.ts` — the pool's `resident <= layers` (§1.6).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CELL_ASPECT,
  CELL_INSET,
  CELL_LIFT,
  cellHalfAngles,
  cellSizeArc,
  eastOf,
  rowColatitude,
  rowOfUnitY,
  rowStep,
  worldRadius,
} from '../src/scene/worlds/surfaceLaw'
import {
  FACET_ARC_LIMIT,
  SUB_QUAD_ENVELOPE,
  buildCellIndices,
  buildCellVertices,
  facetSag,
  subdivisionFor,
  tangentCornerLift,
  worldFacets,
} from '../src/scene/worlds/cellGeometry'
import {
  CROSSOVER_HIGH_PX,
  CROSSOVER_LOW_PX,
  EQUIRECT_HEIGHT,
  EQUIRECT_WIDTH,
  bakeEquirectLayer,
  buildRowIndex,
  cellHeightPx,
  columnOf,
  crossoverState,
} from '../src/scene/worlds/lod'
import { apportionRowCells, closedFormRowCells, closedFormRows } from '../src/scene/worlds/surfaceCheck'

interface Plane {
  readonly slug: string
  readonly kind?: string
  readonly cardCount?: number
  readonly radius?: number
  readonly rowCells?: number[]
}

const DATA = resolve(__dirname, '../public/data')

function planesFor(role: string): Plane[] {
  const datasets = JSON.parse(
    readFileSync(resolve(__dirname, '../datasets.json'), 'utf8'),
  ) as Record<string, string>
  const name = datasets[role]!
  const file = JSON.parse(readFileSync(resolve(DATA, name, 'planes.json'), 'utf8')) as {
    planes: Plane[]
  }
  return file.planes
}

const PLANES = planesFor('worlds')
const WORLDS = PLANES.filter((p): p is Plane & { rowCells: number[]; cardCount: number } =>
  Array.isArray(p.rowCells),
)
const bySlug = (slug: string) => WORLDS.find((w) => w.slug === slug)!

describe('§1.3 the surface law, against the shipped roster', () => {
  it('finds the worlds it is supposed to measure', () => {
    // The denominator, always: "no violations" and "I could not look" must not print the same.
    expect(PLANES.length).toBe(88)
    expect(WORLDS.length).toBe(45)
    expect(WORLDS.reduce((n, w) => n + w.cardCount, 0)).toBe(24399)
  })

  it('sums every published table to its own cardCount', () => {
    // §1.3's exact-N invariant, and the reason the table is a contract field at all. Reported as
    // the list of offenders so a failure names the world.
    expect(WORLDS.filter((w) => w.rowCells.reduce((a, b) => a + b, 0) !== w.cardCount).map((w) => w.slug)).toEqual([])
    expect(WORLDS.filter((w) => Math.min(...w.rowCells) < 1).map((w) => w.slug)).toEqual([])
  })

  it('draws every non-dust plane at max(0.126*sqrt(N), 0.55)', () => {
    // §1.8/§2.4's amendment: the floor is on EVERY plane, not an empty-plane special case.
    // Implementing §2.4 literally is the bug c8edc5e fixed.
    const offenders = PLANES.filter((p) => p.kind !== 'dust').filter(
      (p) => Math.abs(p.radius! - worldRadius(p.cardCount ?? 0)) > 5e-6,
    )
    expect(offenders.map((p) => p.slug)).toEqual([])
    // The belt is the sole carve-out, and it is carved out by `kind`, not by a magic radius.
    expect(PLANES.filter((p) => p.kind === 'dust').map((p) => p.slug)).toEqual(['blind-eternities'])
  })

  it('floors 15 worlds, six of them one-card, and inverts without the floor', () => {
    const floored = WORLDS.filter((w) => worldRadius(w.cardCount) === 0.55)
    expect(floored.length).toBe(15)
    expect(WORLDS.filter((w) => w.cardCount === 1).length).toBe(6)
    // The inversion the floor exists to prevent: unfloored, a one-card world is drawn 4.4x smaller
    // in radius — 19x in silhouette — than a plane with no cards at all.
    const unfloored = 0.126 * Math.sqrt(1)
    expect(0.55 / unfloored).toBeCloseTo(4.365, 3)
    // ...and the law only inverts below 19 cards, so above that nothing is touched.
    expect(0.126 * Math.sqrt(19)).toBeLessThan(0.55)
    expect(0.126 * Math.sqrt(20)).toBeGreaterThan(0.55)
  })

  it('keeps the rows equal-angle even though the counts are population-derived', () => {
    // What the relaxation does NOT move (§1.3). It is what lets the client match a cell to a row.
    for (const world of WORLDS) {
      const rows = world.rowCells.length
      expect(rowStep(rows)).toBeCloseTo(Math.PI / rows, 12)
      expect(rowColatitude(0, rows)).toBeCloseTo(rowStep(rows) / 2, 12)
      expect(rowColatitude(rows - 1, rows)).toBeCloseTo(Math.PI - rowStep(rows) / 2, 12)
    }
  })
})

describe('§2.1 the cell size, and the 51.6x that hangs on one sin', () => {
  it('converts only the longitudinal component to arc length', () => {
    const dominaria = bySlug('dominaria')
    const rows = dominaria.rowCells.length
    expect([dominaria.cardCount, rows]).toEqual([6271, 81])

    const angles = cellHalfAngles(dominaria.rowCells, 0)
    const arc = cellSizeArc(dominaria.rowCells, 0)
    // The polar row holds two cells, so in ANGLE its half-extent is pi/2 — which, read as a length
    // in world radii, is a quad wider than the globe it sits on.
    expect(angles.lon).toBeCloseTo(Math.PI / 2, 12)
    expect(angles.lon).toBeGreaterThan(1)
    expect(arc.lon).toBeCloseTo(0.0305, 4)
    expect(angles.lon / arc.lon).toBeCloseTo(51.57, 2)
    // The latitudinal component is an angle that subtends itself, so it does NOT convert.
    expect(arc.lat).toBeCloseTo(angles.lat, 12)
    expect(arc.lat).toBeCloseTo(rowStep(rows) / 2, 12)
  })

  it('is the same factor that makes the 4:3 aspect true at every latitude', () => {
    // §1.3's two bugs are one bug: width/height is the aspect the grid was built at only when the
    // longitudinal component carries sin(theta). Without it the ratio is aspect/sin(theta) — 81x at
    // Dominaria's pole, which is the same 51.6x failure seen from the other side.
    const dominaria = bySlug('dominaria')
    const arc = cellSizeArc(dominaria.rowCells, 0)
    const angles = cellHalfAngles(dominaria.rowCells, 0)
    expect(angles.lon / angles.lat).toBeCloseTo(81.0, 1)
    expect(arc.lon / arc.lat).toBeCloseTo(1.571, 3)

    // At the equator the published grid sits essentially on 4:3...
    const middle = Math.floor(dominaria.rowCells.length / 2)
    const equator = cellSizeArc(dominaria.rowCells, middle)
    expect(equator.lon / equator.lat).toBeCloseTo(1.328, 3)
    expect(Math.abs(equator.lon / equator.lat - CELL_ASPECT) / CELL_ASPECT).toBeLessThan(0.01)
    // ...but 4:3 genuinely CANNOT hold at the poles, because rowCells is an integer. Two of
    // Dominaria's 81 rows are outside +-10% of it, so the renderer must letterbox into each cell's
    // OWN rect and may not hard-code the ratio anywhere.
    const offAspect = dominaria.rowCells.filter((_cells, row) => {
      const size = cellSizeArc(dominaria.rowCells, row)
      return Math.abs(size.lon / size.lat - CELL_ASPECT) / CELL_ASPECT > 0.1
    })
    expect(offAspect.length).toBe(2)
  })

  it('pins which way `east` runs, because two conventions are in play', () => {
    // The trap this exists for: §1.4 places a vertex at "longitude lambda_c + u * (pi/rowCells)"
    // and winds the quad with `east` as +u. Those two sentences are only consistent under ONE
    // longitude convention, and the natural-looking spelling is the wrong one.
    //
    // +east is DECREASING atan2(z, x) and INCREASING atan2(x, z). A bake that indexes its columns
    // by increasing atan2(z, x) therefore runs its texels opposite to the sheet's `u`, and a world
    // flips east-west as it crosses the §1.5 crossover — where BOTH passes draw at once and
    // cross-fade, so it reads as a smeared double image rather than as an obvious mirror.
    const out: [number, number, number] = [0, 0, 0]
    const n = [1, 0, 0] as const
    eastOf(n[0], n[1], n[2], out)
    const step = 1e-6
    const moved = [n[0] + step * out[0], n[1] + step * out[1], n[2] + step * out[2]]
    const length = Math.hypot(moved[0]!, moved[1]!, moved[2]!)
    const unit = moved.map((c) => c / length)
    expect(Math.atan2(unit[2]!, unit[0]!)).toBeLessThan(Math.atan2(n[2], n[0]))
    expect(Math.atan2(unit[0]!, unit[2]!)).toBeGreaterThan(Math.atan2(n[0], n[2]))

    // And `north = cross(east, n)` points toward INCREASING colatitude — southward — which is what
    // makes §1.4's "colatitude theta_c + v*(dphi/2)" agree with `v` being the quad's +y.
    const north = [
      out[1] * n[2] - out[2] * n[1],
      out[2] * n[0] - out[0] * n[2],
      out[0] * n[1] - out[1] * n[0],
    ]
    const southward = [n[0] + step * north[0]!, n[1] + step * north[1]!, n[2] + step * north[2]!]
    const southLength = Math.hypot(southward[0]!, southward[1]!, southward[2]!)
    expect(Math.acos(southward[1]! / southLength)).toBeGreaterThan(Math.acos(n[1]))
  })

  it('builds an east that survives a pole', () => {
    const out: [number, number, number] = [0, 0, 0]
    // A generic point: east is horizontal, unit, and perpendicular to the normal.
    const n = [0.6, 0.8, 0] as const
    eastOf(n[0], n[1], n[2], out)
    expect(Math.hypot(...out)).toBeCloseTo(1, 12)
    expect(out[1]).toBe(0)
    expect(out[0] * n[0] + out[1] * n[1] + out[2] * n[2]).toBeCloseTo(0, 12)
    // No row centre is ever at a pole (theta_0 = dphi/2 > 0), but a truncated decode can produce
    // one, and a NaN east deletes a whole world's sheet silently rather than failing.
    eastOf(0, 1, 0, out)
    expect(out).toEqual([1, 0, 0])
    expect(out.every(Number.isFinite)).toBe(true)
  })
})

describe('§2.1 matching a float16 centre to its row', () => {
  const dominaria = bySlug('dominaria')
  const rows = dominaria.rowCells.length

  // The round-trip a centre actually takes: `stars.bin` stores it as three float16s.
  const toFloat16 = (value: number) => {
    const buffer = new ArrayBuffer(2)
    new DataView(buffer).setUint16(0, packHalf(value), true)
    return unpackHalf(new DataView(buffer).getUint16(0, true))
  }

  it('classifies every row centre of every world after a float16 round trip', () => {
    let checked = 0
    for (const world of WORLDS) {
      const count = world.rowCells.length
      for (let row = 0; row < count; row += 1) {
        const y = Math.cos(rowColatitude(row, count))
        expect(rowOfUnitY(toFloat16(y), count)).toBe(row)
        checked += 1
      }
    }
    // 777 rows over 45 worlds — the denominator, so a silently empty loop cannot read as a pass.
    expect(checked).toBe(777)
  })

  it('keeps the margin the contract was written against, which floor() halves', () => {
    // Dominaria's two polar rows are 1.504e-3 apart in y and the float16 round-trip error is at
    // most 2^-12 on [0.5, 1). Nearest tolerates half the gap either side; floor() tolerates only
    // the distance to the boundary below, which is half as much. At the pole that IS the whole
    // safety budget — at the equator the same ratio is 79x and nothing can go wrong.
    const y = (row: number) => Math.cos(rowColatitude(row, rows))
    const polarGap = Math.abs(y(0) - y(1))
    const halfUlp = 2 ** -12
    expect(polarGap).toBeCloseTo(0.001503812, 9)
    // 3.0798, which §1.3 and the Python half both quote to two places as "3.08". Asserted the same
    // way rather than as `>= 3.08`, which the true value misses by 2e-4.
    expect(polarGap / 2 / halfUlp).toBeCloseTo(3.08, 2)
    expect(polarGap / 2 / halfUlp).toBeGreaterThan(3)
    expect(polarGap / 2 / halfUlp / 2).toBeLessThan(2)
  })

  it('is nearest, not floor — and a floor() classifier is wrong on the polar row', () => {
    // The negative control. `floor(theta/dphi)` is the obvious spelling and it misclassifies a
    // centre perturbed toward the row below by less than the float16 error the decode can add.
    const dphi = rowStep(rows)
    const floorOf = (yValue: number) => {
      const theta = Math.acos(Math.min(1, Math.max(-1, yValue)))
      return Math.min(rows - 1, Math.max(0, Math.floor(theta / dphi)))
    }
    const centre = rowColatitude(0, rows)
    // A centre nudged just past its row's lower boundary in theta: nearest still calls it row 0,
    // floor() has already handed it to row 1.
    const nudged = Math.cos(centre + dphi / 2 + 1e-6)
    expect(rowOfUnitY(nudged, rows)).toBe(0)
    expect(floorOf(nudged)).toBe(1)
  })

  it('answers a single-row world without dividing by anything', () => {
    // Six v3 worlds carry one card and eight carry two, so rows = 1 ships. Its centre is the
    // equator and dphi is pi.
    for (const world of WORLDS.filter((w) => w.rowCells.length === 1)) {
      expect(rowStep(1)).toBeCloseTo(Math.PI, 12)
      expect(rowColatitude(0, 1)).toBeCloseTo(Math.PI / 2, 12)
      expect(rowOfUnitY(0, 1)).toBe(0)
      expect(rowOfUnitY(1, 1)).toBe(0)
      expect(rowOfUnitY(-1, 1)).toBe(0)
      expect(world.rowCells.length).toBe(1)
    }
    expect(WORLDS.filter((w) => w.rowCells.length === 1).length).toBe(14)
  })
})

describe('§1.4 the cell sheet', () => {
  it('pins the winding clockwise, in the index buffer and not in a comment', () => {
    // DEC-694 trap 1. With `east` as +x and `north = cross(east, n)` as +y, the CCW order's
    // geometric normal is east x north = -n: every front-facing cell is back-face culled and the
    // only survivors are the far hemisphere, seen from inside. Both failure modes lie.
    const one = { kLon: 1, kLat: 1, subQuads: 1 }
    const uv = buildCellVertices(one)
    expect(Array.from(uv)).toEqual([-1, -1, 1, -1, -1, 1, 1, 1])

    // The spec writes `[0, 2, 1, 0, 3, 2]` in RING order; this generator is row-major, so ring
    // vertex 2 is row-major 3 and ring 3 is row-major 2. Both spellings are asserted, because a
    // literal index-array check alone passes a generator that renumbers vertices and fails a
    // correct one that does.
    const indices = Array.from(buildCellIndices(one))
    expect(indices).toEqual([0, 3, 1, 0, 2, 3])
    const ring = [0, 2, 1, 0, 3, 2]
    const ringToRowMajor = [0, 1, 3, 2]
    expect(ring.map((v) => ringToRowMajor[v])).toEqual(indices)
  })

  it('winds every sub-quad the same way, at every k', () => {
    // The subdivision is exactly where a "tidy" rewrite reintroduces the inversion: a grid
    // generator that emits CCW triangles inverts every cell on every world.
    const signedArea = (uv: Float32Array, a: number, b: number, c: number) => {
      const [ax, ay] = [uv[a * 2]!, uv[a * 2 + 1]!]
      const [bx, by] = [uv[b * 2]!, uv[b * 2 + 1]!]
      const [cx, cy] = [uv[c * 2]!, uv[c * 2 + 1]!]
      return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    }
    for (const [kLon, kLat] of [
      [1, 1],
      [2, 1],
      [3, 2],
      [5, 3],
      [32, 16],
    ] as const) {
      const sub = { kLon, kLat, subQuads: kLon * kLat }
      const uv = buildCellVertices(sub)
      const indices = buildCellIndices(sub)
      expect(uv.length).toBe((kLon + 1) * (kLat + 1) * 2)
      expect(indices.length).toBe(kLon * kLat * 6)
      for (let t = 0; t < indices.length; t += 3) {
        // Negative signed area in (u, v) is clockwise, which is what faces +n outward.
        expect(signedArea(uv, indices[t]!, indices[t + 1]!, indices[t + 2]!)).toBeLessThan(0)
      }
    }
  })

  it('faces the triangles outward once they are placed on the sphere', () => {
    // The 2D sign is only the proxy. This is the quantity that actually decides whether a cell is
    // culled: the facet normal in world space, built in the frame §1.4 names — `east` from
    // `eastOf`, `north = cross(east, n)`, `u` along east and `v` along north.
    //
    // Building it from an independent (colatitude, longitude) convention instead reads INWARD on
    // every facet, because `east` runs along DECREASING atan2(z, x) — see the handedness test
    // below. That mistake is this test's own history, and it is the same mistake the bake can make.
    const sub = { kLon: 2, kLat: 2, subQuads: 4 }
    const uv = buildCellVertices(sub)
    const indices = buildCellIndices(sub)
    const thetaC = 1.1
    const centre = [Math.sin(thetaC), Math.cos(thetaC), 0] as const
    const east = eastOf(centre[0], centre[1], centre[2], [0, 0, 0])
    const north = [
      east[1] * centre[2] - east[2] * centre[1],
      east[2] * centre[0] - east[0] * centre[2],
      east[0] * centre[1] - east[1] * centre[0],
    ]
    const place = (u: number, v: number) => {
      const p = [0, 1, 2].map((k) => centre[k]! + u * 0.3 * east[k]! + v * 0.2 * north[k]!)
      const length = Math.hypot(p[0]!, p[1]!, p[2]!)
      return [p[0]! / length, p[1]! / length, p[2]! / length] as const
    }
    const outwardFacing = (order: Uint16Array | number[]) => {
      let outward = 0
      let total = 0
      for (let t = 0; t < order.length; t += 3) {
        const p = [0, 1, 2].map((k) => {
          const vertex = order[t + k]!
          return place(uv[vertex * 2]!, uv[vertex * 2 + 1]!)
        })
        const e1 = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!)
        const e2 = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!)
        const normal = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ]
        const centre = place(0, 0)
        total += 1
        if (normal[0]! * centre[0] + normal[1]! * centre[1] + normal[2]! * centre[2] > 0) outward += 1
      }
      return { outward, total }
    }
    const shipped = outwardFacing(indices)
    expect(shipped.outward).toBe(shipped.total)
    expect(shipped.total).toBe(8)
    // The negative control: the "tidied" order every reviewer wants to write faces INWARD on every
    // facet, which is the state that reads as a perfectly complete mosaic with the globe hidden.
    const tidied: number[] = []
    for (let t = 0; t < indices.length; t += 3) tidied.push(indices[t]!, indices[t + 2]!, indices[t + 1]!)
    expect(outwardFacing(tidied).outward).toBe(0)
  })

  it('sizes k from the arc half-extent, so the sag stays inside 1% of the radius', () => {
    expect(FACET_ARC_LIMIT).toBeCloseTo(0.0998, 4)
    expect(SUB_QUAD_ENVELOPE).toBe(1263)
    // The tolerance is what FACET_ARC_LIMIT means, so it has to hold at the limit itself.
    expect(facetSag(FACET_ARC_LIMIT)).toBeCloseTo(0.01, 6)
    expect(facetSag(FACET_ARC_LIMIT * 1.001)).toBeGreaterThan(0.01)

    for (const world of WORLDS) {
      const { kLon, kLat } = subdivisionFor(world.rowCells)
      for (let row = 0; row < world.rowCells.length; row += 1) {
        const arc = cellSizeArc(world.rowCells, row)
        expect(facetSag(arc.lon / kLon)).toBeLessThanOrEqual(0.01 + 1e-12)
        expect(facetSag(arc.lat / kLat)).toBeLessThanOrEqual(0.01 + 1e-12)
      }
    }
  })

  it('reaches k = (1,1) on the large worlds and subdivides the small ones', () => {
    const unsubdivided = WORLDS.filter((w) => {
      const { kLon, kLat } = subdivisionFor(w.rowCells)
      return kLon === 1 && kLat === 1
    })
    expect(unsubdivided.length).toBe(13)
    expect(unsubdivided.reduce((n, w) => n + w.cardCount, 0)).toBe(19497)
    expect(WORLDS.reduce((n, w) => n + worldFacets(w.rowCells, w.cardCount), 0)).toBe(38887)

    const rabiah = bySlug('rabiah')
    expect(rabiah.cardCount).toBe(75)
    expect(subdivisionFor(rabiah.rowCells)).toMatchObject({ kLon: 3, kLat: 2 })
    const shenmeng = bySlug('shenmeng')
    expect(shenmeng.cardCount).toBe(30)
    expect(subdivisionFor(shenmeng.rowCells)).toMatchObject({ kLon: 5, kLat: 3 })
    // The bottom of the roster: one card, one cell wrapping the sphere, 512 sub-quads for the
    // whole world — against Dominaria's 6,271 cells at one quad each.
    expect(subdivisionFor([1])).toMatchObject({ kLon: 32, kLat: 16, subQuads: 512 })
  })

  it('holds every SUBDIVIDED world under the sphere envelope — and only subdivided ones', () => {
    // §1.4 says to assert the envelope per world in the sheet's unit test. Its bare wording drops
    // a qualifier that matters: at k = (1,1) a cell IS one facet, so an unsubdivided world's total
    // is just its card count, and four of v3's worlds exceed 1,263 legitimately. That is not
    // over-subdivision, it is a large world drawn at one quad per card — the geometry this whole
    // section is trying to get back to. A gate that drops the qualifier goes RED on correct
    // behaviour, so both halves are pinned here.
    const subdivided = WORLDS.filter((w) => subdivisionFor(w.rowCells).subQuads > 1)
    expect(subdivided.length).toBe(32)
    for (const world of subdivided) {
      expect(worldFacets(world.rowCells, world.cardCount)).toBeLessThanOrEqual(SUB_QUAD_ENVELOPE)
    }
    expect(Math.max(...subdivided.map((w) => worldFacets(w.rowCells, w.cardCount)))).toBe(1130)

    const overEnvelope = WORLDS.filter(
      (w) => worldFacets(w.rowCells, w.cardCount) > SUB_QUAD_ENVELOPE,
    )
    expect(overEnvelope.map((w) => w.slug).sort()).toEqual([
      'dominaria',
      'innistrad',
      'new-phyrexia',
      'ravnica',
    ])
    for (const world of overEnvelope) {
      expect(subdivisionFor(world.rowCells).subQuads).toBe(1)
    }
  })

  it('states the tangent-quad lift the subdivision exists to remove', () => {
    // The quantity, not a restatement of its numbers: a flat quad tangent at the cell centre sits
    // this far above the sphere at its corner. Reading the small-N failure as an aspect-ratio
    // problem points at the harmless half.
    const liftOf = (rowCells: number[]) => {
      const arc = cellSizeArc(rowCells, 0)
      return tangentCornerLift(arc.lon, arc.lat)
    }
    expect(liftOf(bySlug('dominaria').rowCells) * 100).toBeCloseTo(0.7, 1)
    expect(liftOf([1]) * 100).toBeCloseTo(265.4, 1)
    // It is NOT monotone in N — under exact-N a small world's residual lands in one row, so N = 3
    // ships a single-cell row that lifts ABOVE N = 2's. Which HEMISPHERE holds it is decided by a
    // tie-break and is not a durable fact, so the worst row is what is measured.
    expect(liftOf([2]) * 100).toBeCloseTo(144, 0)
    const three = apportionRowCells(3).cells as number[]
    expect([...three].sort()).toEqual([1, 2])
    const worstAtThree = Math.max(
      ...three.map((_cells, row) => {
        const arc = cellSizeArc(three, row)
        return tangentCornerLift(arc.lon, arc.lat)
      }),
    )
    expect(worstAtThree).toBeGreaterThan(liftOf([2]))
    expect(CELL_LIFT).toBe(1.006)
    expect(CELL_INSET).toBe(0.93)
  })
})

describe('§1.3 the N-only constructions are checks, never the emitter', () => {
  it('reproduces the closed form’s failure, which is why rowCells ships', () => {
    // §1.3 argues FROM this: per-row independent rounding hits cardCount at only 85 of the 7,000
    // counts in 1..7000, and the dangerous half is the 3,487 that UNDER-allocate — an
    // under-allocated world drops cards silently, and "zero bare" cannot detect it because a
    // dropped card leaves no bare cell to count.
    let exact = 0
    let under = 0
    let over = 0
    for (let n = 1; n <= 7000; n += 1) {
      const sum = closedFormRowCells(n).cells.reduce((a, b) => a + b, 0)
      if (sum === n) exact += 1
      else if (sum < n) under += 1
      else over += 1
    }
    expect([exact, under, over]).toEqual([85, 3487, 3428])
  })

  it('apportions exactly at every N, which the closed form does not', () => {
    for (let n = 1; n <= 7000; n += 1) {
      const table = apportionRowCells(n)
      expect(table.cells.reduce((a, b) => a + b, 0)).toBe(n)
      expect(Math.min(...table.cells)).toBeGreaterThanOrEqual(1)
      expect(table.cells.length).toBe(table.rows)
    }
    // The floor documented in §1.3 that never binds: rows_closed <= N for every N >= 1. Kept as
    // documentation, not as a load-bearing guard — and checked so the claim cannot rot.
    for (let n = 1; n <= 7000; n += 1) expect(closedFormRows(n)).toBeLessThanOrEqual(n)
  })

  it('agrees with the published table on rows and dphi, and on counts only to +-1', () => {
    // This is the whole licence for calling it a check. It is exact on rows 45/45 — so dphi and
    // every row latitude carry over — and within one cell per row, which §1.4 needs to be
    // derivation-safe. It reproduces a whole published table on only 15 of 45 worlds, and those 15
    // are the one-, two- and four-card worlds: every world at production size disagrees somewhere.
    let rowsAgree = 0
    let tablesAgree = 0
    let rowsExact = 0
    let rowsDiffering = 0
    let worstDelta = 0
    for (const world of WORLDS) {
      const table = apportionRowCells(world.cardCount)
      if (table.rows !== world.rowCells.length) continue
      rowsAgree += 1
      if (table.cells.every((c, r) => c === world.rowCells[r])) tablesAgree += 1
      for (let r = 0; r < table.rows; r += 1) {
        const delta = Math.abs(table.cells[r]! - world.rowCells[r]!)
        worstDelta = Math.max(worstDelta, delta)
        if (delta === 0) rowsExact += 1
        else rowsDiffering += 1
      }
    }
    expect(rowsAgree).toBe(45)
    expect(tablesAgree).toBe(15)
    expect(worstDelta).toBe(1)
    expect(rowsExact + rowsDiffering).toBe(777)
    expect(rowsDiffering).toBe(198)
    // Every world that the N-only form reproduces whole is tiny — nothing at production size.
    const reproduced = WORLDS.filter((w) =>
      apportionRowCells(w.cardCount).cells.every((c, r) => c === w.rowCells[r]),
    )
    expect(Math.max(...reproduced.map((w) => w.cardCount))).toBe(4)
  })

  it('gives the identical subdivision from either table, which is what makes ±1 safe', () => {
    // If a §1.4 derivation moved under ±1, the N-only form would stop being usable even as a check.
    for (const world of WORLDS) {
      const fromPublished = subdivisionFor(world.rowCells)
      const fromCheck = subdivisionFor(apportionRowCells(world.cardCount).cells)
      expect([fromCheck.kLon, fromCheck.kLat]).toEqual([fromPublished.kLon, fromPublished.kLat])
    }
  })

  it('asserts no symmetry bound, because the shipped grid obeys none', () => {
    // Exact-N and strict equatorial symmetry are arithmetically incompatible for odd N, and
    // exact-N wins because the alternative is losing cards. The N-only form relaxes symmetry
    // minimally; the SHIPPED table does not, breaking strict symmetry on 30 of 45 by design
    // (`_north_first` alternates a mirrored class's odd card by set-index parity). A gate row
    // asserting <= 1 — or <= 2 — would go RED on a correct renderer.
    const asymmetric = WORLDS.filter(
      (w) => w.rowCells.join() !== [...w.rowCells].reverse().join(),
    )
    expect(asymmetric.length).toBe(30)
    const nOnlyAsymmetric = WORLDS.filter((w) => {
      const cells = apportionRowCells(w.cardCount).cells
      return cells.join() !== [...cells].reverse().join()
    })
    expect(nOnlyAsymmetric.length).toBe(14)
    expect(nOnlyAsymmetric.length).not.toBe(asymmetric.length)
  })
})

describe('§1.5 the LOD crossover and the equirect bake', () => {
  it('draws in BOTH passes inside the band (DEC-746 D4)', () => {
    // §1.2 step 2's bullet contradicts its own Normative note; the Normative block wins. The band,
    // not a hard switch, is what stops a pop on approach.
    expect(crossoverState(2)).toEqual({ drawSystem: true, drawSheet: false, sheetMix: 0 })
    expect(crossoverState(12)).toEqual({ drawSystem: false, drawSheet: true, sheetMix: 1 })
    const inside = crossoverState(6)
    expect(inside.drawSystem).toBe(true)
    expect(inside.drawSheet).toBe(true)
    expect(inside.sheetMix).toBeCloseTo(0.5, 12)
    // The boundaries themselves: at the floor it is system-only, at the ceiling sheet-only.
    expect(crossoverState(CROSSOVER_LOW_PX).drawSheet).toBe(false)
    expect(crossoverState(CROSSOVER_HIGH_PX).drawSystem).toBe(false)
  })

  it('counts step 2 as planes below the band’s TOP, never as worlds minus sheets', () => {
    // A world inside the band is in both counts, so a renderer that subtracts is one instance
    // short through every approach. This is the arithmetic, stated as a test rather than as prose.
    const heights = [1, 3, 5, 6, 7, 9, 20]
    const states = heights.map((h) => crossoverState(h))
    const systemInstances = states.filter((s) => s.drawSystem).length
    const sheets = states.filter((s) => s.drawSheet).length
    expect(systemInstances).toBe(5)
    expect(sheets).toBe(5)
    expect(systemInstances).not.toBe(heights.length - sheets)
  })

  it('scales a cell’s on-screen height by radius over distance', () => {
    const height = (distance: number) => cellHeightPx(0.02, 10, distance, 1080, (55 * Math.PI) / 180)
    expect(height(100)).toBeGreaterThan(height(200))
    expect(height(100) / height(200)).toBeCloseTo(2, 9)
    // The tan(fov/2) term, checked against a hand-computed case rather than against itself.
    const fov = (55 * Math.PI) / 180
    expect(cellHeightPx(0.02, 10, 100, 1080, fov)).toBeCloseTo(
      (2 * 0.02 * 10 * 1080) / (2 * 100 * Math.tan(fov / 2)),
      9,
    )
  })

  it('bakes a layer whose texels all resolve to a cell', () => {
    // Rasterising a world's cells into its own 256x128 layer is one pass over 32,768 texels, so
    // the whole roster is 45 layers of a FIXED cost rather than a cost that grows with cards.
    const rowCells = [2, 5, 7, 8, 6, 2]
    const cells = rowCells.reduce((a, b) => a + b, 0)
    const lon = new Float64Array(cells)
    const row = new Int32Array(cells)
    const swatch = new Float32Array(cells * 3)
    let at = 0
    for (let r = 0; r < rowCells.length; r += 1) {
      for (let c = 0; c < rowCells[r]!; c += 1) {
        lon[at] = -Math.PI + (c * 2 * Math.PI) / rowCells[r]!
        row[at] = r
        swatch[at * 3] = (at + 1) / cells
        swatch[at * 3 + 1] = 0.5
        swatch[at * 3 + 2] = 1 - (at + 1) / cells
        at += 1
      }
    }
    const index = buildRowIndex(lon, row, rowCells)
    // Every cell found a distinct column — the index is a bijection, not a last-writer-wins map.
    for (let r = 0; r < rowCells.length; r += 1) {
      expect(new Set(index.cells[r]).size).toBe(rowCells[r]!)
      expect(Math.min(...index.cells[r]!)).toBeGreaterThanOrEqual(0)
    }

    const layer = bakeEquirectLayer(index, rowCells, swatch)
    expect(layer.length).toBe(EQUIRECT_WIDTH * EQUIRECT_HEIGHT * 4)
    // Opaque everywhere, and no texel fell through to the bare-cell path.
    for (let i = 3; i < layer.length; i += 4) expect(layer[i]).toBe(255)
    const distinct = new Set<number>()
    for (let i = 0; i < layer.length; i += 4) distinct.add(layer[i]!)
    expect(distinct.size).toBeGreaterThan(1)

    // v = 0 is the NORTH pole, matching theta's direction, so the caller must not flip on upload.
    // §1.6's UNPACK_FLIP_Y note is about the art pool, a different texture with a different
    // orientation. The northernmost texel row must come from row 0's cells.
    const northRow = new Set(Array.from(index.cells[0]!).map((c) => Math.round(swatch[c * 3]! * 255)))
    for (let u = 0; u < EQUIRECT_WIDTH; u += 1) expect(northRow.has(layer[u * 4]!)).toBe(true)
  })

  it('wraps columns at 2*pi without drifting off the end', () => {
    expect(columnOf(-Math.PI, -Math.PI, 8)).toBe(0)
    expect(columnOf(-Math.PI + (2 * Math.PI) / 8, -Math.PI, 8)).toBe(1)
    // One full turn returns to column 0 rather than to column 8.
    expect(columnOf(Math.PI, -Math.PI, 8)).toBe(0)
    expect(columnOf(-Math.PI - 1e-9, -Math.PI, 8)).toBe(0)
    for (let c = 0; c < 8; c += 1) {
      expect(columnOf(-Math.PI + (c * 2 * Math.PI) / 8, -Math.PI, 8)).toBe(c)
    }
  })
})

// A float16 round trip, written out because `stars.bin`'s decoder is the consumer and the test
// needs the encoder half too. Round-to-nearest-even, matching the pipeline's numpy `float16`.
function packHalf(value: number): number {
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  f32[0] = value
  const bits = u32[0]!
  const sign = (bits >>> 16) & 0x8000
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15
  let mantissa = bits & 0x7fffff
  if (exponent <= 0) return sign
  if (exponent >= 0x1f) return sign | 0x7c00
  const round = mantissa & 0x1fff
  mantissa >>>= 13
  if (round > 0x1000 || (round === 0x1000 && (mantissa & 1) === 1)) {
    mantissa += 1
    if (mantissa === 0x400) {
      mantissa = 0
      exponent += 1
    }
  }
  return sign | (exponent << 10) | mantissa
}

function unpackHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >>> 10) & 0x1f
  const mantissa = bits & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024)
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
}
