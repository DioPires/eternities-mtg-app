/**
 * The `?probe=` payload (spec §3.1) — the surface leg G's gate reads and may not re-derive.
 *
 * Two of these assertions exist because a *weaker* wording of the same pin turned out to be
 * vacuous. The rect contract is "the projected sphere-following vertex grid, never a tangent quad's
 * four corners"; stated as "the patch's extent rather than the quad's" it says nothing at all,
 * because `iSize` is arc length and the two models have identical arc length by construction. The
 * quantity that separates them is the projection, and it is measured here rather than quoted.
 */

import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import {
  SHADE_AMBIENT,
  SHADE_GAIN,
  buildProbeCells,
  cellGridPoint,
  cellScreenRect,
  shadeOf,
} from '../src/scene/worlds/probePayload'

const VIEWPORT = 1000
/** Orthographic, so a projected width is directly proportional to a world-space x extent. */
const PROJECTION = new Matrix4().makeOrthographic(-2, 2, 2, -2, 0.1, 100)
/** The eye at +z looking down -z: the sub-camera point is `(0, 0, 1)` on a unit world. */
const VIEW = new Matrix4().makeTranslation(0, 0, -5)
const ORIGIN = new Vector3(0, 0, 0)

/** The screen width a flat tangent quad of half-angle `gamma` would report, under the same camera. */
function tangentQuadWidth(gamma: number): number {
  // Laid flat, the quad's half-extent IS its arc length — that is what `iSize` carries (§2.1).
  const half = gamma
  const ndc = half / 2
  return 2 * ndc * 0.5 * VIEWPORT
}

describe('§1.4 the shade term the probe reports', () => {
  it('is the wrapped-lambert scalar, squared after the clamp', () => {
    // Exact, at the three points that define it. The gate may not re-derive this, so a drift here
    // is a drift in what W2's iso-shade subset means.
    expect(shadeOf(0)).toBeCloseTo(SHADE_AMBIENT + SHADE_GAIN * 0.25, 12)
    expect(shadeOf(1)).toBeCloseTo(SHADE_AMBIENT + SHADE_GAIN, 12)
    expect(shadeOf(-1)).toBeCloseTo(SHADE_AMBIENT, 12)
  })

  it('wraps rather than clamps, which is what keeps the limb legible', () => {
    // A clamped lambert is 0 for every dot <= 0, so the whole night side would be one value and the
    // iso-shade subset would swallow half the disc. Wrapped, the terminator sits at 0.25.
    expect(shadeOf(-0.5)).toBeGreaterThan(shadeOf(-1))
    expect(shadeOf(-0.5)).toBeCloseTo(SHADE_AMBIENT + SHADE_GAIN * 0.0625, 12)
    // Squaring AFTER the clamp, not before: squaring first would make -0.5 and +0.5 identical.
    expect(shadeOf(-0.5)).not.toBeCloseTo(shadeOf(0.5), 6)
  })

  it('clamps outside the unit range instead of running away', () => {
    expect(shadeOf(-4)).toBe(SHADE_AMBIENT)
    expect(shadeOf(4)).toBe(SHADE_AMBIENT + SHADE_GAIN)
  })
})

describe('§3.1 the rect is the projected vertex grid, not a tangent quad', () => {
  it('projects to the chord, and the gap from the flat quad is gamma/sin(gamma)', () => {
    // The whole-hemisphere case, which is the N = 1 world §1.3's floor exists for.
    const gamma = Math.PI / 2
    const rect = cellScreenRect(
      Math.PI / 2,
      0,
      gamma,
      0.2,
      { kLon: 8, kLat: 8, subQuads: 64 },
      ORIGIN,
      1,
      VIEW,
      PROJECTION,
      0.1,
      VIEWPORT,
      VIEWPORT,
    )
    expect(rect).not.toBeNull()
    const ratio = tangentQuadWidth(gamma) / rect!.width
    // Measured, not quoted: the flat model overstates the extent by exactly gamma/sin(gamma).
    expect(ratio).toBeCloseTo(gamma / Math.sin(gamma), 6)
    expect(ratio).toBeCloseTo(1.5708, 4)
  })

  it('collapses to no difference at a small cell, which is why the pin needed the big one', () => {
    // At Dominaria-scale half-angles the two models agree to four decimals. A contract tested only
    // here would pass against a tangent-quad implementation — the vacuity this file's header is
    // about — so the discriminating row above is the one that carries the pin.
    const gamma = 0.02
    const rect = cellScreenRect(
      Math.PI / 2,
      0,
      gamma,
      0.01,
      { kLon: 4, kLat: 4, subQuads: 16 },
      ORIGIN,
      1,
      VIEW,
      PROJECTION,
      0.1,
      VIEWPORT,
      VIEWPORT,
    )
    const ratio = tangentQuadWidth(gamma) / rect!.width
    expect(ratio).toBeCloseTo(gamma / Math.sin(gamma), 8)
    expect(ratio).toBeLessThan(1.0001)
  })

  it('is NOT bounded by the cell corners — the widest row is the one nearest the equator', () => {
    const at = (kLon: number, kLat: number): number =>
      cellScreenRect(
        Math.PI / 2,
        0,
        0.4,
        0.2,
        { kLon, kLat, subQuads: kLon * kLat },
        ORIGIN,
        1,
        VIEW,
        PROJECTION,
        0.1,
        VIEWPORT,
        VIEWPORT,
      )!.width

    // `k = (1, 1)` IS the four corners. A spherical patch's half-width is `cos(theta) * sin(gamma)`,
    // maximised where `|cos theta|` is — the row nearest the equator — so for a cell straddling it
    // the extreme lies in the INTERIOR and the corners under-report. This is the mirror image of
    // the tangent-quad error above and points the other way, so an implementation carrying both
    // would partially cancel and look almost right.
    expect(at(1, 1)).toBeLessThan(at(2, 2))
    expect(at(2, 2) / at(1, 1)).toBeCloseTo(1.0203, 4)

    // Once that row is sampled the bound is exact and refining further moves nothing: every vertex
    // already sits ON the sphere, so there is no sag left to discover.
    expect(at(2, 2)).toBeCloseTo(at(64, 64), 9)
    expect(at(16, 16)).toBeCloseTo(at(64, 64), 9)

    // Not monotone in k, which is why "just use a big k" is not the rule: an ODD kLat never samples
    // v = 0 and lands slightly short however fine it is.
    expect(at(3, 3)).toBeLessThan(at(2, 2))
    expect(at(65, 65)).toBeLessThan(at(64, 64))
  })

  it('uses the renderer own subdivision, so the rect matches the geometry drawn', () => {
    // The consequence of the row above: there is no k-independent "true" rect to report. The probe
    // reports the bound of the vertex grid the frame actually rasterises, which is consistent with
    // the picture by construction — and is why `cellScreenRect` takes the Subdivision rather than
    // choosing one.
    const drawn = { kLon: 4, kLat: 4, subQuads: 16 }
    const rect = cellScreenRect(
      Math.PI / 2,
      0,
      0.4,
      0.2,
      drawn,
      ORIGIN,
      1,
      VIEW,
      PROJECTION,
      0.1,
      VIEWPORT,
      VIEWPORT,
    )!
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })

  it('rejects behind the eye before projecting, not after', () => {
    // The eye AT the world centre looking down -z, and the cell on the +z side: every grid point is
    // behind the near plane. It must produce no rect, rather than a folded-back one that reads as
    // an ordinary on-screen cell, asks for art, and is never drawn.
    const inside = new Matrix4().makeTranslation(0, 0, 0)
    const rect = cellScreenRect(
      Math.PI / 2,
      0,
      0.2,
      0.2,
      { kLon: 4, kLat: 4, subQuads: 16 },
      ORIGIN,
      1,
      inside,
      PROJECTION,
      0.1,
      VIEWPORT,
      VIEWPORT,
    )
    expect(rect).toBeNull()
  })

  it('flips y, because NDC is up and the screen is down', () => {
    // A cell in the northern hemisphere must land in the TOP half of the frame. Without the flip
    // every rect is mirrored about the horizon and W1's per-band geometry is inverted.
    const north = cellScreenRect(
      Math.PI / 4,
      0,
      0.1,
      0.1,
      { kLon: 2, kLat: 2, subQuads: 4 },
      ORIGIN,
      1,
      VIEW,
      PROJECTION,
      0.1,
      VIEWPORT,
      VIEWPORT,
    )!
    expect(north.y + north.height / 2).toBeLessThan(VIEWPORT / 2)
  })
})

describe('§1.4 the grid parameterisation', () => {
  it('puts every vertex on the unit sphere at every (u, v)', () => {
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [-1, -0.5, 0, 0.5, 1]) {
        expect(cellGridPoint(1.1, 0.7, 0.3, 0.2, u, v).length()).toBeCloseTo(1, 12)
      }
    }
  })

  it('runs longitude along atan2(x, z), the direction east points', () => {
    // The other spelling mirrors the world east-west between its two LOD representations, and does
    // not announce itself: inside the crossover band both passes draw and cross-fade.
    const at = cellGridPoint(Math.PI / 2, 0.3, 0.2, 0.1, 1, 0)
    expect(Math.atan2(at.x, at.z)).toBeCloseTo(0.5, 12)
    expect(Math.atan2(at.x, at.z)).toBeGreaterThan(0.3)
  })
})

describe('§3.1 one probe cell per card, never one per sub-quad', () => {
  it('reports cardCount entries whatever the subdivision is', () => {
    const record = { rect: { x: 0, y: 0, width: 1, height: 1 }, band: 2, shade: 0.5, showingArt: false }
    // §1.4 subdivides the BASE GEOMETRY of the instanced draw, so the instance count survives the
    // re-mesh untouched. A payload that grew with k would let W1's floor pass by counting one card
    // up to 512 times.
    expect(buildProbeCells(37, () => record)).toHaveLength(37)
    expect(buildProbeCells(37, () => record).map((c) => c.cell)).toEqual(
      Array.from({ length: 37 }, (_, i) => i),
    )
  })

  it('drops a cell the frame does not show, and keeps the ids of the rest', () => {
    const cells = buildProbeCells(6, (cell) =>
      cell % 2 === 0
        ? { rect: { x: cell, y: 0, width: 1, height: 1 }, band: 0, shade: 0.5, showingArt: cell === 4 }
        : null,
    )
    // The id is the instance id and the art pool's key, so it must survive the compaction — a
    // payload that renumbered survivors would mis-attribute every per-cell criterion.
    expect(cells.map((c) => c.cell)).toEqual([0, 2, 4])
    expect(cells.filter((c) => c.showingArt).map((c) => c.cell)).toEqual([4])
  })
})
