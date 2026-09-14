/**
 * The **served** `?probe=` payload (spec §3.1) and §1.3's band law on the client.
 *
 * `worlds-probe.test.ts` covers the geometry primitives; this covers the object leg G actually
 * calls and the two things about it that a weaker test would leave vacuous:
 *
 * - `x`/`y` is the **projected centre**, not the rect's centre. Asserted by *separation* on a cell
 *   where the two differ and by *agreement* at the sub-camera point, because an assertion that only
 *   checked the second row would pass on either implementation.
 * - `wantsArt` reads the **effective** threshold. Asserted with the threshold injected away from 24,
 *   because at 24 the quantile and the constant agree and the bound never binds.
 *
 * The band law is checked against `pipeline/src/eternities/fixtures/surface.py`'s own output rather
 * than against re-derived arithmetic: it is one law with two implementations, and the failure that
 * matters is the two drifting apart.
 */

import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { ART_SHOWN_AT, buildWorldsProbe, worldsProbeOf } from '../src/scene/worlds/worldsProbe'
import type { WorldsProbeSource } from '../src/scene/worlds/worldsProbe'
import {
  BAND_ORDER,
  GOLD_BAND,
  bandBoundaries,
  bandOfCosTheta,
  bandShares,
  cellDrawAngles,
  cellHalfAngles,
  drawRadius,
  rowColatitude,
  rowOfUnitY,
  worldRadius,
} from '../src/scene/worlds/surfaceLaw'
import { cellScreenRect } from '../src/scene/worlds/probePayload'
import { subdivisionFor } from '../src/scene/worlds/cellGeometry'
import { HueClass } from '../src/data/types'

import rowCellsV3 from '../../docs/worlds/rowcells-v3.json'

const WORLDS = (
  rowCellsV3 as unknown as {
    worlds: Record<string, { cardCount: number; rowCells: number[] }>
  }
).worlds

const VIEWPORT = { width: 1920, height: 1080 }

/**
 * `surface.py`'s output for five histograms, transcribed verbatim.
 *
 * Not re-derived here. The point of the fixture is that the Python and the TypeScript are two
 * implementations of §1.3 and must agree to the bit; arithmetic recomputed in the test language
 * would only prove the test agrees with itself.
 */
const PYTHON_BANDS = {
  'dominaria-like': {
    hueCounts: [1200, 1100, 1000, 980, 1400, 480, 111],
    shares: [
      0.008850263115930474, 0.1116249402009249, 0.07813745814064743, 0.07973210014351778,
      0.08770531015786956, 0.09567852017222134, 0.07654281613777707, 0.09567852017222134,
      0.08770531015786956, 0.07973210014351778, 0.07813745814064743, 0.1116249402009249,
      0.008850263115930474,
    ],
    edges: [
      1.0, 0.9822994737681391, 0.7590495933662893, 0.6027746770849944, 0.4433104767979589,
      0.26789985648221976, 0.07654281613777708, -0.07654281613777705, -0.2678998564822197,
      -0.4433104767979588, -0.6027746770849944, -0.7590495933662893, -0.9822994737681391, -1.0,
    ],
  },
  'mono-white-only': {
    hueCounts: [50, 0, 0, 0, 0, 0, 0],
    shares: [0, 0, 0, 0, 0, 0.5, 0, 0.5, 0, 0, 0, 0, 0],
    edges: [1, 1, 1, 1, 1, 1, 0, 0, -1, -1, -1, -1, -1, -1],
  },
  'gold-heavy': {
    hueCounts: [10, 10, 10, 10, 10, 200, 0],
    shares: [0, 0.02, 0.02, 0.02, 0.02, 0.02, 0.8, 0.02, 0.02, 0.02, 0.02, 0.02, 0],
    edges: [
      1.0, 1.0, 0.96, 0.9199999999999999, 0.8799999999999999, 0.8399999999999999,
      0.7999999999999998, -0.8000000000000003, -0.8400000000000003, -0.8800000000000003,
      -0.9200000000000004, -0.9600000000000004, -1.0000000000000004, -1.0,
    ],
  },
  'one-card': {
    hueCounts: [0, 0, 0, 0, 0, 0, 1],
    shares: [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
    edges: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1],
  },
  empty: {
    hueCounts: [0, 0, 0, 0, 0, 0, 0],
    shares: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    edges: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1],
  },
} as const

describe('§1.3 the band law on the client', () => {
  it('is the thirteen-band mirrored chain, with gold alone at the equator', () => {
    expect(BAND_ORDER).toHaveLength(13)
    expect(GOLD_BAND).toBe(6)
    // Mirrored about the equator: band i and band 12 - i are the same class.
    for (let i = 0; i < BAND_ORDER.length; i += 1) {
      expect(BAND_ORDER[i]).toBe(BAND_ORDER[BAND_ORDER.length - 1 - i])
    }
    // Gold is the one class that is NOT a matched pair — it appears exactly once.
    expect(BAND_ORDER.filter((h) => h === HueClass.Multicolour)).toHaveLength(1)
    // Every other class appears exactly twice, which is what halving its share pays for.
    for (const hue of [
      HueClass.White,
      HueClass.Blue,
      HueClass.Black,
      HueClass.Red,
      HueClass.Green,
      HueClass.Colourless,
    ]) {
      expect(BAND_ORDER.filter((h) => h === hue)).toHaveLength(2)
    }
  })

  it('is a chain and not a cycle: the two ice caps are its ends, not neighbours', () => {
    // The pin that stops W3 inventing an adjacency the sphere does not have. Both ends are
    // colourless and they sit at OPPOSITE poles; a cycle would make them adjacent and make the
    // single most-distant pair on the sphere read as the closest.
    expect(BAND_ORDER[0]).toBe(HueClass.Colourless)
    expect(BAND_ORDER[BAND_ORDER.length - 1]).toBe(HueClass.Colourless)
    const edges = bandBoundaries(PYTHON_BANDS['dominaria-like'].hueCounts)
    // North cap's centre is near +1 in cos(theta); south cap's near -1. Furthest apart of any pair.
    expect(bandOfCosTheta(0.99, edges)).toBe(0)
    expect(bandOfCosTheta(-0.99, edges)).toBe(12)
  })

  it.each(Object.entries(PYTHON_BANDS))(
    'agrees with surface.py bit for bit on %s',
    (_name, fixture) => {
      const shares = bandShares(fixture.hueCounts)
      const edges = bandBoundaries(fixture.hueCounts)
      expect(shares).toHaveLength(13)
      expect(edges).toHaveLength(14)
      for (let i = 0; i < shares.length; i += 1) {
        expect(shares[i]).toBeCloseTo(fixture.shares[i]!, 15)
      }
      for (let i = 0; i < edges.length; i += 1) {
        expect(edges[i]).toBeCloseTo(fixture.edges[i]!, 15)
      }
    },
  )

  it('sums the thirteen shares to exactly 1 on any non-empty plane', () => {
    // This is what makes the boundaries cover the whole sphere. A half-share bug on the mirrored
    // classes would sum to 0.5 or 2 and leave a gap or an overlap at the equator.
    for (const [name, fixture] of Object.entries(PYTHON_BANDS)) {
      if (name === 'empty') continue
      const total = bandShares(fixture.hueCounts).reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(1, 12)
    }
  })

  it('returns zeros rather than NaN on an empty plane', () => {
    // §1.8's moons have no sheet; a caller that reached here with one gets a degenerate answer
    // instead of a NaN that would propagate silently into every boundary and every band index.
    expect(bandShares([0, 0, 0, 0, 0, 0, 0]).every((s) => s === 0)).toBe(true)
    expect(bandBoundaries([0, 0, 0, 0, 0, 0, 0]).every(Number.isFinite)).toBe(true)
  })

  it('sends a point on a boundary to the northern band, deterministically', () => {
    // 'one-card' puts eleven zero-width bands at cos(theta) = 0 exactly. A scan that resolved ties
    // southward would land the card in a band the plane holds no cards of.
    const edges = bandBoundaries(PYTHON_BANDS['one-card'].hueCounts)
    expect(bandOfCosTheta(0, edges)).toBe(0)
    expect(bandOfCosTheta(-1e-12, edges)).toBe(12)
  })
})

/**
 * Round-trip a float through **float16**, the precision `stars.bin` stores a cell centre at.
 *
 * Without this the synthetic normals sit exactly on their row's latitude, and a fixture that clean
 * is a test double that agrees with the bug: deriving a cell's colatitude from `acos(n.y)` instead
 * of from its matched row is then indistinguishable from the law, because the two inputs are equal
 * by construction. They are not equal on the shipped artefact, which is the whole reason §2.1
 * matches a decoded centre to its NEAREST row.
 */
function f16(value: number): number {
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  f32[0] = value
  const bits = u32[0]!
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff
  let half: number
  if (exponent <= 0) half = sign
  else if (exponent >= 31) half = sign | 0x7c00
  else half = sign | (exponent << 10) | (mantissa >>> 13)
  // Back to a float32 value, which is what the decoder hands the sheet.
  const s = half & 0x8000 ? -1 : 1
  const e = (half >>> 10) & 0x1f
  const m = half & 0x3ff
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024)
  if (e === 31) return s * Infinity
  return s * Math.pow(2, e - 15) * (1 + m / 1024)
}

/** A synthetic world: cells at the centre of each slot of the published `rowCells`. */
function sourceFor(
  slug: string,
  overrides: Partial<WorldsProbeSource> & { radiiDistance?: number; quantise?: boolean } = {},
): WorldsProbeSource {
  const entry = WORLDS[slug]!
  const rowCells = entry.rowCells
  const rows = rowCells.length
  const radius = worldRadius(entry.cardCount)
  const radiiDistance = overrides.radiiDistance ?? 2.6

  const normals: Array<[number, number, number]> = []
  for (let r = 0; r < rows; r += 1) {
    const theta = rowColatitude(r, rows)
    const n = rowCells[r]!
    for (let c = 0; c < n; c += 1) {
      const lambda = ((c + 0.5) / n) * Math.PI * 2 - Math.PI
      const sin = Math.sin(theta)
      const point: [number, number, number] = [
        sin * Math.sin(lambda),
        Math.cos(theta),
        sin * Math.cos(lambda),
      ]
      normals.push(overrides.quantise ? [f16(point[0]), f16(point[1]), f16(point[2])] : point)
    }
  }

  const camera = new PerspectiveCamera(50, VIEWPORT.width / VIEWPORT.height, 0.1, 1000)
  camera.position.set(0, 0, radius * radiiDistance)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()

  return {
    planeSlug: slug,
    cardCount: normals.length,
    rowCells,
    normalOf: (cell, out) => out.set(...normals[cell]!),
    hueCounts: [...PYTHON_BANDS['dominaria-like'].hueCounts],
    subdivision: subdivisionFor(rowCells),
    centre: new Vector3(0, 0, 0),
    radius,
    lightDirection: new Vector3(0, 0, 1),
    camera: {
      matrixWorldInverse: new Matrix4().copy(camera.matrixWorldInverse),
      projectionMatrix: new Matrix4().copy(camera.projectionMatrix),
      position: camera.position.clone(),
      near: camera.near,
    },
    viewport: VIEWPORT,
    pool: { layers: 224, resident: 100, reserved: 3, evictions: 17 },
    threshold: { effectiveThresholdPx: 24, wanting: 0, admitted: 0, adaptive: true },
    seams: {
      swatchMean: false,
      bandsShuffle: false,
      artThresholdFixed24: false,
      layersRequested: null,
    },
    artOf: () => 0,
    ...overrides,
  }
}

describe('§3.1 the served worlds payload', () => {
  it('is undefined with no composed world, and a payload with one', () => {
    // The distinction leg G branches on. `undefined` is "the seam is not installed on this page",
    // a SETUP failure; an empty `cells` is a world that drew nothing, which is a measurement.
    expect(worldsProbeOf(null)).toBeUndefined()
    expect(worldsProbeOf(undefined)).toBeUndefined()
    expect(worldsProbeOf(sourceFor('ravnica'))).toBeDefined()
  })

  it('reports one entry per card, never one per sub-quad', () => {
    // On a subdivided world a payload that walked facets would multiply W1's sample count by k^2
    // and divide its median height. 32 of v3's 45 worlds are subdivided, so this is the common case.
    // Alara, not Ravnica: §1.4 reaches k = (1, 1) from 574 cards up, so a 2,304-card world is NOT
    // subdivided and would make this row vacuous. The defect only exists where k > 1.
    const source = sourceFor('alara')
    expect(source.subdivision.subQuads).toBeGreaterThan(1)
    const probe = buildWorldsProbe(source)
    expect(probe.cells.length).toBeLessThanOrEqual(source.cardCount)
    // Every reported cell id is a distinct card index in range — not a facet index.
    const ids = new Set(probe.cells.map((c) => c.cell))
    expect(ids.size).toBe(probe.cells.length)
    for (const id of ids) expect(id).toBeLessThan(source.cardCount)
  })

  it('pins height to the rect it reports, so the two cannot drift', () => {
    for (const cell of buildWorldsProbe(sourceFor('ravnica')).cells) {
      expect(cell.height).toBe(cell.rect.height)
    }
  })

  it('reports the PROJECTED centre, which is not the rect centre', () => {
    const probe = buildWorldsProbe(sourceFor('ravnica'))
    const offsets = probe.cells.map((c) =>
      Math.hypot(c.x - (c.rect.x + c.rect.width / 2), c.y - (c.rect.y + c.rect.height / 2)),
    )
    // SEPARATION: on a curved patch the two disagree by a real distance. Without this row the pin
    // would pass on an implementation that simply returned the rect's centre.
    expect(Math.max(...offsets)).toBeGreaterThan(1)
    // AGREEMENT: approaching the sub-camera point the patch becomes symmetric about its centre and
    // the two converge. This is the control — it fails on an implementation that offsets by
    // anything fixed. Bounded in px rather than asserted exact, because the cell NEAREST the screen
    // centre is not exactly centred on it; the claim is convergence, and 1 px against a 0.05 px
    // residual is the separation that carries it.
    const subCamera = probe.cells.reduce((best, c) =>
      Math.hypot(c.x - VIEWPORT.width / 2, c.y - VIEWPORT.height / 2) <
      Math.hypot(best.x - VIEWPORT.width / 2, best.y - VIEWPORT.height / 2)
        ? c
        : best,
    )
    expect(
      Math.hypot(
        subCamera.x - (subCamera.rect.x + subCamera.rect.width / 2),
        subCamera.y - (subCamera.rect.y + subCamera.rect.height / 2),
      ),
    ).toBeLessThan(0.05)
  })

  it('measures the arcs and radius the sheet DRAWS at, not the cell nominal ones', () => {
    // `cellScreenRect` takes its geometry as PARAMETERS, so it reports whatever the call site hands
    // it and will happily bound a rectangle nothing ever drew. Both wrong bindings leave the picture
    // correct and move only the number — and both land on W1's pixel floor and §1.11's 24 px proxy.
    // Mutating each of them passed every other assertion in this file, which is why this row exists.
    const source = sourceFor('ravnica')
    const probe = buildWorldsProbe(source)
    const rows = source.rowCells.length
    const centre = new Vector3()

    let checked = 0
    for (const cell of probe.cells) {
      source.normalOf(cell.cell, centre)
      const row = rowOfUnitY(centre.y, rows)
      const colatitude = rowColatitude(row, rows)
      const longitude = Math.atan2(centre.x, centre.z)
      const args = [
        source.subdivision,
        source.centre,
        source.camera.matrixWorldInverse,
        source.camera.projectionMatrix,
        source.camera.near,
        VIEWPORT.width,
        VIEWPORT.height,
      ] as const

      const drawn = cellDrawAngles(source.rowCells, row)
      const right = cellScreenRect(
        colatitude,
        longitude,
        drawn.lon,
        drawn.lat,
        args[0],
        args[1],
        drawRadius(source.radius),
        args[2],
        args[3],
        args[4],
        args[5],
        args[6],
      )
      expect(cell.height).toBeCloseTo(right!.height, 9)

      // The un-inset binding, which over-reports every cell by 1/0.93 = 7.5%.
      const nominal = cellHalfAngles(source.rowCells, row)
      const inflated = cellScreenRect(
        colatitude,
        longitude,
        nominal.lon,
        nominal.lat,
        args[0],
        args[1],
        drawRadius(source.radius),
        args[2],
        args[3],
        args[4],
        args[5],
        args[6],
      )
      expect(inflated!.height).toBeGreaterThan(right!.height)
      checked += 1
    }
    // No silent empty loop: an assertion that never ran is not an assertion.
    expect(checked).toBeGreaterThan(100)
  })

  it('parameterises from the MATCHED ROW, not from the decoded normal', () => {
    // `stars.bin` stores a cell centre at float16, so a decoded centre sits a little off its row's
    // exact latitude. §2.1 matches it to the NEAREST row and the shader draws from the ROW; a probe
    // that took `acos(n.y)` instead would walk a parameterisation the shader never used, and would
    // do it silently — the picture stays right and only the measurement moves.
    const source = sourceFor('ravnica', { quantise: true })
    const rows = source.rowCells.length
    const centre = new Vector3()
    let offLattice = 0

    for (const cell of buildWorldsProbe(source).cells) {
      source.normalOf(cell.cell, centre)
      const row = rowOfUnitY(centre.y, rows)
      const fromRow = rowColatitude(row, rows)
      const fromNormal = Math.acos(Math.max(-1, Math.min(1, centre.y)))
      if (Math.abs(fromRow - fromNormal) > 1e-6) offLattice += 1

      const drawn = cellDrawAngles(source.rowCells, row)
      const expected = cellScreenRect(
        fromRow,
        Math.atan2(centre.x, centre.z),
        drawn.lon,
        drawn.lat,
        source.subdivision,
        source.centre,
        drawRadius(source.radius),
        source.camera.matrixWorldInverse,
        source.camera.projectionMatrix,
        source.camera.near,
        VIEWPORT.width,
        VIEWPORT.height,
      )
      expect(cell.height).toBeCloseTo(expected!.height, 9)
    }
    // The fixture must actually BE off-lattice, or the row above proves nothing: at float16 the two
    // colatitudes would agree by construction and the assertion would hold under either reading.
    expect(offLattice).toBeGreaterThan(100)
  })

  it('reads wantsArt off the EFFECTIVE threshold, not off 24', () => {
    // Injected away from 24 in both directions, because at 24 the quantile and the constant agree
    // and a test run only there cannot tell which one the code read.
    const high = buildWorldsProbe(
      sourceFor('ravnica', {
        threshold: { effectiveThresholdPx: 80, wanting: 0, admitted: 0, adaptive: true },
      }),
    )
    const low = buildWorldsProbe(
      sourceFor('ravnica', {
        threshold: { effectiveThresholdPx: 4, wanting: 0, admitted: 0, adaptive: true },
      }),
    )
    for (const cell of high.cells) expect(cell.wantsArt).toBe(cell.height >= 80)
    for (const cell of low.cells) expect(cell.wantsArt).toBe(cell.height >= 4)
    // And the two must actually differ, or the rows above are both vacuous.
    expect(high.cells.filter((c) => c.wantsArt).length).toBeLessThan(
      low.cells.filter((c) => c.wantsArt).length,
    )
    expect(high.pool.effectiveThresholdPx).toBe(80)
  })

  it('treats showingArt as the fade landing, not a layer being claimed', () => {
    // A cell mid-fade is showing its SWATCH. Reading residency instead is the substitution the
    // prototype's 1,031-resident-in-1,024 bug hid behind.
    const mid = buildWorldsProbe(sourceFor('ravnica', { artOf: () => ART_SHOWN_AT - 0.01 }))
    const landed = buildWorldsProbe(sourceFor('ravnica', { artOf: () => ART_SHOWN_AT }))
    expect(mid.cells.every((c) => !c.showingArt)).toBe(true)
    expect(landed.cells.every((c) => c.showingArt)).toBe(true)
  })

  it('reports onScreen and frontFacing rather than filtering on them', () => {
    // W4's denominator needs them explicitly. A payload that silently dropped back-facing cells
    // would make "art is chosen, not exhausted" measure a set the gate cannot reconstruct.
    const probe = buildWorldsProbe(sourceFor('ravnica'))
    expect(probe.cells.some((c) => !c.frontFacing)).toBe(true)
    expect(probe.cells.every((c) => typeof c.onScreen === 'boolean')).toBe(true)
  })

  it('passes the pool through after the clamp, and the seams through unchanged', () => {
    const probe = buildWorldsProbe(
      sourceFor('ravnica', {
        pool: { layers: 0, resident: 0, reserved: 0, evictions: 925 },
        seams: {
          swatchMean: true,
          bandsShuffle: false,
          artThresholdFixed24: true,
          layersRequested: 128,
        },
      }),
    )
    // 0 is a legal pool — a swatch-only world — and the gate treats it as a measurement.
    expect(probe.pool.layers).toBe(0)
    expect(probe.pool.evictions).toBe(925)
    expect(probe.seams.swatchMean).toBe(true)
    expect(probe.seams.layersRequested).toBe(128)
  })

  it('reports the pose in radii, which is what W1 and W4 are specified at', () => {
    for (const radiiDistance of [2.2, 3.5]) {
      const probe = buildWorldsProbe(sourceFor('ravnica', { radiiDistance }))
      expect(probe.radii).toBeCloseTo(radiiDistance, 9)
    }
  })

  it('publishes bandShares so the gate never re-derives W3 5% rule', () => {
    const probe = buildWorldsProbe(sourceFor('ravnica'))
    expect(probe.bandShares).toHaveLength(13)
    expect(probe.bandShares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('keeps every band index inside the published chain', () => {
    for (const cell of buildWorldsProbe(sourceFor('ravnica')).cells) {
      expect(cell.band).toBeGreaterThanOrEqual(0)
      expect(cell.band).toBeLessThan(BAND_ORDER.length)
    }
  })

  it('survives the one-card world the v3 roster has six of', () => {
    // W2 and W3 are undefined at n = 1, but the PAYLOAD must still be well formed — the gate's
    // `insufficient` verdict is reached by measuring, not by the probe throwing.
    const probe = buildWorldsProbe(sourceFor('segovia'))
    expect(probe.cells.length).toBeLessThanOrEqual(1)
    expect(probe.bandShares).toHaveLength(13)
    expect(Number.isFinite(probe.radii)).toBe(true)
  })
})
