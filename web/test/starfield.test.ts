/**
 * Phase 2a's Node-side tests: the parts of the star field that are arithmetic rather than pixels.
 *
 * What is deliberately *not* here: whether the vertex shader agrees with the CPU motion mirror.
 * That needs a GPU, and `src/scene/selfCheck.ts` closes that loop through the id buffer under
 * `scripts/verify-browser.mjs`. Asserting it here against a hand-rolled reimplementation would
 * only prove that two copies of the same mistake match.
 */

import { describe, expect, it } from 'vitest'

import { SceneMotion } from '../src/camera/motion'
import { StarStreamReader } from '../src/data/decode'
import {
  BINARY_HEADER_BYTES,
  COLOUR_IDENTITY_MASK,
  COLOUR_IDENTITY_SHIFT,
  CONTRACT_VERSION,
  HUE_CLASS_MASK,
  HueClass,
  STAR_RECORD_BYTES,
  type PlaneRecord,
} from '../src/data/types'
import { SceneErrorHub } from '../src/scene/errors'
import {
  DEFAULT_REFRESH_MS,
  QualityMonitor,
  QUALITY_TIERS,
  degradeThresholdMs,
  pinnedQualityOptions,
  pinnedQualityTier,
  restoreThresholdMs,
} from '../src/scene/quality/adaptiveQuality'
import {
  CURL_EPSILON,
  FLOATS_PER_PLANE,
  PT_FADE,
  PT_KIND,
  PT_SPIN_ANGLE,
  PlaneKindCode,
  curlNoise,
  driftOffset,
  planeWorldPosition,
  shearAngle,
  starWorldPosition,
} from '../src/scene/starfield/motion'
import { PlaneTable } from '../src/scene/starfield/planeTable'
import { STAR_VERTEX_SHADER } from '../src/scene/starfield/shaders'
import { StarGeometry, resolvePositionMode } from '../src/scene/starfield/starGeometry'
import { SHEAR_RADIAL_PHASE, TWINKLE_AMPLITUDE } from '../src/scene/tuning'

function plane(overrides: Partial<PlaneRecord> = {}): PlaneRecord {
  return {
    index: 0,
    slug: 'test',
    displayName: 'Test',
    notes: '',
    kind: 'spiral',
    cardCount: 10,
    starOffset: 0,
    starCount: 10,
    shardCount: 1,
    home: [10, 2, -5],
    radius: 4,
    tilt: [0, 0, 0, 1],
    spinPeriodS: 120,
    spinDirection: 1,
    driftAmplitude: 0.5,
    driftPeriodS: 60,
    driftPhase: 0.3,
    shearAmplitude: 0.15,
    shearPeriodS: 50,
    shearPhase: 0.7,
    armPitch: 0.8,
    discThickness: 0.05,
    bar: false,
    palette: [1, 0, 0, 0, 0, 0, 0],
    nebulaTint: [0.5, 0.6, 0.7],
    firstYear: 2000,
    lastYear: 2020,
    sets: [],
    ...overrides,
  }
}

const vec = (): { x: number; y: number; z: number } => ({ x: 0, y: 0, z: 0 })

describe('plane table (PRD 8.5.2)', () => {
  it('lays one row per plane out at the shader-visible offsets', () => {
    const table = new PlaneTable([plane(), plane({ index: 1, slug: 'b', kind: 'dust' })], 130)
    expect(table.rows).toBe(2)
    expect(table.texture.image.width * 4).toBe(FLOATS_PER_PLANE)
    expect(table.raw[PT_KIND]).toBe(PlaneKindCode.Spiral)
    expect(table.raw[FLOATS_PER_PLANE + PT_KIND]).toBe(PlaneKindCode.Dust)
  })

  it('rejects a roster with a hole rather than inventing a row (PRD 7.7.2)', () => {
    expect(() => new PlaneTable([plane({ index: 1 })], 130)).toThrow(/no plane at index 0/)
  })

  it('accumulates the spin angle so easing it to a stop stays continuous (PRD 5.6.6)', () => {
    const table = new PlaneTable([plane()], 130)
    table.advance(1, 1)
    const after1s = table.planes[0]!.spinAngle
    // 120 s period, one direction: 2π/120 radians per second.
    expect(after1s).toBeCloseTo((2 * Math.PI) / 120, 10)

    table.setSpinScale(0, 0)
    table.advance(1, 1)
    // Stopped, and the angle held where it was — not reset.
    expect(table.planes[0]!.spinAngle).toBeCloseTo(after1s, 10)
  })

  it('freezes every angle where it stands under reduced motion (PRD 5.9)', () => {
    const table = new PlaneTable([plane()], 130)
    table.advance(2, 1)
    const angle = table.planes[0]!.spinAngle
    const multiverse = table.multiverseAngle
    table.advance(5, 0)
    expect(table.planes[0]!.spinAngle).toBe(angle)
    expect(table.multiverseAngle).toBe(multiverse)
  })

  it('fades a plane in over PLANE_FADE_S with a smoothstep, once revealed (PRD 6.8.1)', () => {
    const table = new PlaneTable([plane()], 130)
    table.advance(0.5, 1)
    expect(table.raw[PT_FADE]).toBe(0)

    table.revealPlane(0)
    table.advance(0.2, 1)
    expect(table.raw[PT_FADE]).toBeGreaterThan(0)
    expect(table.raw[PT_FADE]).toBeLessThan(1)
    table.advance(2, 1)
    expect(table.planes[0]!.fade).toBe(1)
  })

  it('reveals zero-card planes without waiting for stars (PRD 5.3.6, 8.7.2)', () => {
    const table = new PlaneTable(
      [plane({ kind: 'empty', cardCount: 0, starCount: 0 }), plane({ index: 1, slug: 'b' })],
      130,
    )
    table.revealEmptyPlanes()
    table.advance(0.1, 1)
    expect(table.planes[0]!.fade).toBeGreaterThan(0)
    expect(table.planes[1]!.fade).toBe(0)
  })

  it('eases the dust focus brightening rather than snapping it (PRD 5.3.4)', () => {
    const table = new PlaneTable([plane({ kind: 'dust' })], 130)
    table.setDustFocused(true)
    table.advance(0.1, 1)
    const partial = table.raw[16 + 1]!
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
    table.advance(2, 1)
    expect(table.raw[16 + 1]).toBe(1)
  })
})

describe('motion (PRD 8.5.3, 8.5.7)', () => {
  const table = new PlaneTable([plane()], 130)

  it('keeps the shear bounded by its amplitude however long the session runs (PRD 5.4.13)', () => {
    let max = 0
    for (let t = 0; t < 100_000; t += 37) {
      max = Math.max(max, Math.abs(shearAngle(table.raw, 0, 0.8, t)))
    }
    expect(max).toBeLessThanOrEqual(0.15 + 1e-9)
    // A ten-degree cap is the PRD's ceiling on the amplitude the pipeline may emit.
    expect(0.15).toBeLessThanOrEqual((10 * Math.PI) / 180)
  })

  it('gives the shear a radial phase gradient, so arms breathe rather than shear rigidly', () => {
    const inner = shearAngle(table.raw, 0, 0.1, 3)
    const outer = shearAngle(table.raw, 0, 1.0, 3)
    expect(inner).not.toBeCloseTo(outer, 3)
    expect(SHEAR_RADIAL_PHASE).toBeGreaterThan(0)
  })

  it('keeps the drift inside its amplitude, which PRD 5.3.3 sizes plane spacing against', () => {
    const out = vec()
    let max = 0
    for (let t = 0; t < 600; t += 0.5) {
      driftOffset(table.raw, 0, t, out)
      max = Math.max(max, Math.hypot(out.x, out.y, out.z))
    }
    // The orbit is a flattened ellipse of semi-axis `driftAmplitude`, so the excursion never
    // exceeds it by more than the vertical ratio allows.
    expect(max).toBeLessThanOrEqual(0.5 * Math.SQRT2)
  })

  it('places a star at home + tilt(spin(local)) * radius, then turns the multiverse', () => {
    const out = vec()
    // No motion at all: the star should be exactly home + local * radius.
    starWorldPosition(table.raw, 0, 1, 0, 0, 0, 0, 0, out)
    expect(out.x).toBeCloseTo(10 + 4, 10)
    expect(out.y).toBeCloseTo(2, 10)
    expect(out.z).toBeCloseTo(-5, 10)

    // A quarter turn of the multiverse maps +x to -z (PRD 5.3.13's vertical axis).
    starWorldPosition(table.raw, 0, 0, 0, 0, 0, Math.PI / 2, 0, out)
    expect(out.x).toBeCloseTo(-5, 6)
    expect(out.z).toBeCloseTo(-10, 6)
  })

  it('agrees with the plane-centre mirror the sphere raycast uses (PRD 8.5.6)', () => {
    const star = vec()
    const centre = vec()
    starWorldPosition(table.raw, 0, 0, 0, 0, 12.5, 0.4, 1, star)
    planeWorldPosition(table.raw, 0, 12.5, 0.4, 1, centre)
    expect(star.x).toBeCloseTo(centre.x, 10)
    expect(star.y).toBeCloseTo(centre.y, 10)
    expect(star.z).toBeCloseTo(centre.z, 10)
  })

  it('stops every component of the motion when motion is 0 (PRD 5.9)', () => {
    const moving = vec()
    const still = vec()
    starWorldPosition(table.raw, 0, 0.4, 0.2, 0.1, 30, 0.9, 1, moving)
    starWorldPosition(table.raw, 0, 0.4, 0.2, 0.1, 90, 0.9, 0, still)
    const other = vec()
    starWorldPosition(table.raw, 0, 0.4, 0.2, 0.1, 300, 0.9, 0, other)
    expect(still.x).toBeCloseTo(other.x, 12)
    expect(still.y).toBeCloseTo(other.y, 12)
    expect(still.z).toBeCloseTo(other.z, 12)
    expect(moving.x).not.toBeCloseTo(still.x, 6)
  })

  it('turbulates the dust and leaves disc stars to the spin path (PRD 5.3.16, 8.6.3)', () => {
    const dust = new PlaneTable(
      [plane({ kind: 'dust', spinPeriodS: 0, driftAmplitude: 0, shearAmplitude: 0, radius: 130 })],
      130,
    )
    const a = vec()
    const b = vec()
    starWorldPosition(dust.raw, 0, 0.3, 0.02, -0.4, 0, 0, 1, a)
    starWorldPosition(dust.raw, 0, 0.3, 0.02, -0.4, 400, 0, 1, b)
    // It moves...
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(1e-3)
    // ...and never settles into a sink: the displacement stays within the curl amplitude × radius.
    const still = vec()
    starWorldPosition(dust.raw, 0, 0.3, 0.02, -0.4, 400, 0, 0, still)
    expect(Math.hypot(b.x - still.x, b.y - still.y, b.z - still.z)).toBeLessThan(130 * 0.02)
  })

  it('uses a curl, which is divergence-free by construction', () => {
    // Divergence-free is what stops the dust pooling in sinks (PRD 5.3.16's "never settling").
    //
    // The cancellation is exact only when the divergence is measured with the *same* step the
    // curl differentiates with: the identity is `D_x D_y = D_y D_x` on the same stencil, and two
    // different steps do not commute. Measuring at a smaller step measures the value noise's
    // kinked derivatives at cell boundaries, not the curl.
    const e = CURL_EPSILON
    const px = vec()
    const nx = vec()
    const py = vec()
    const ny = vec()
    const pz = vec()
    const nz = vec()
    curlNoise(1.2 + e, 0.7, -0.3, px)
    curlNoise(1.2 - e, 0.7, -0.3, nx)
    curlNoise(1.2, 0.7 + e, -0.3, py)
    curlNoise(1.2, 0.7 - e, -0.3, ny)
    curlNoise(1.2, 0.7, -0.3 + e, pz)
    curlNoise(1.2, 0.7, -0.3 - e, nz)
    const divergence =
      (px.x - nx.x) / (2 * e) + (py.y - ny.y) / (2 * e) + (pz.z - nz.z) / (2 * e)
    expect(Math.abs(divergence)).toBeLessThan(1e-6)
  })

  it('is deterministic: the same time gives the same position, always (PRD 5.3.1)', () => {
    const first = vec()
    const second = vec()
    starWorldPosition(table.raw, 0, 0.4, 0.2, 0.1, 41.5, 0.25, 1, first)
    starWorldPosition(table.raw, 0, 0.4, 0.2, 0.1, 41.5, 0.25, 1, second)
    expect(second).toEqual(first)
  })
})

describe('star geometry (PRD 8.5.1, 8.7.3)', () => {
  function body(records: number, planeIndex = 0): Uint8Array {
    const bytes = new Uint8Array(records * STAR_RECORD_BYTES)
    for (let i = 0; i < records; i += 1) {
      const at = i * STAR_RECORD_BYTES
      // 1.0 as IEEE binary16 is 0x3C00; put it in x so the decode is checkable.
      bytes[at] = 0x00
      bytes[at + 1] = 0x3c
      bytes[at + 6] = planeIndex
      bytes[at + 7] = i % 7
      bytes[at + 8] = i % 4
      bytes[at + 9] = 200
      bytes[at + 10] = 7
      bytes[at + 11] = 1
    }
    return bytes
  }

  it('grows the draw range as records arrive and never shrinks it', () => {
    const geometry = new StarGeometry(10)
    geometry.append(body(10), 3)
    expect(geometry.drawCount).toBe(3)
    expect(geometry.geometry.drawRange.count).toBe(3)
    geometry.append(body(10), 7)
    expect(geometry.drawCount).toBe(7)
    geometry.append(body(10), 5)
    expect(geometry.drawCount).toBe(7)
  })

  it('never writes past the capacity the manifest declared', () => {
    const geometry = new StarGeometry(4)
    geometry.append(body(10), 10)
    expect(geometry.drawCount).toBe(4)
  })

  it('exposes the interleaved record fields the shader reads', () => {
    const geometry = new StarGeometry(4)
    geometry.append(body(4, 3), 4)
    expect(geometry.planeRowOf(0)).toBe(3)
    const local = vec()
    geometry.localPosition(0, local)
    expect(local.x).toBeCloseTo(1, 6)
  })

  it('decodes identical positions on the float32 fallback path (PRD risk 6)', () => {
    const half = new StarGeometry(4, 'float16')
    const full = new StarGeometry(4, 'float32')
    half.append(body(4), 4)
    full.append(body(4), 4)
    const a = vec()
    const b = vec()
    half.localPosition(2, a)
    full.localPosition(2, b)
    expect(b).toEqual(a)
    expect(full.positionMode).toBe('float32')
  })

  it('reads the position mode from the URL, then storage, then the default', () => {
    expect(resolvePositionMode('?positions=float32', undefined)).toBe('float32')
    expect(resolvePositionMode('', { getItem: () => 'float32' })).toBe('float32')
    expect(resolvePositionMode('?positions=nonsense', undefined)).toBe('float16')
    expect(resolvePositionMode('', undefined)).toBe('float16')
  })

  it('dims stars that fail the filter and leaves the rest alone (PRD 5.8.1)', () => {
    const geometry = new StarGeometry(4)
    geometry.append(body(4), 4)
    expect(geometry.passesFilter(1)).toBe(true)
    geometry.setFilterMask(Uint8Array.from([255, 0, 255, 0]))
    expect(geometry.passesFilter(1)).toBe(false)
    expect(geometry.passesFilter(2)).toBe(true)
    geometry.clearFilter()
    expect(geometry.passesFilter(1)).toBe(true)
  })

  it('refuses a filter mask longer than the star field (PRD 7.7.2)', () => {
    const geometry = new StarGeometry(4)
    expect(() => geometry.setFilterMask(new Uint8Array(9))).toThrow(RangeError)
  })
})

describe('stream reader body view (PRD 8.7.3)', () => {
  it('returns whole records only, as a view rather than a copy', () => {
    const header = new Uint8Array(BINARY_HEADER_BYTES)
    header.set([0x45, 0x54, 0x52, 0x4e], 0) // 'ETRN'
    header[4] = 1 // kind: stars
    header[5] = CONTRACT_VERSION
    new DataView(header.buffer).setUint32(8, 3, true)

    const reader = new StarStreamReader()
    reader.push(header)
    expect(reader.body().byteLength).toBe(0)

    reader.push(new Uint8Array(STAR_RECORD_BYTES + 5))
    expect(reader.completeRecords).toBe(1)
    expect(reader.body().byteLength).toBe(STAR_RECORD_BYTES)

    reader.push(new Uint8Array(STAR_RECORD_BYTES * 2))
    expect(reader.completeRecords).toBe(3)
    expect(reader.body().byteLength).toBe(STAR_RECORD_BYTES * 3)
    expect(reader.done).toBe(true)
  })

  /**
   * `push` now writes into a buffer sized from the header rather than merging a chunk list on
   * every call, so these cover the seams that introduces: the handover from the pre-header chunk
   * list to the buffer, and the bytes landing at the right offsets rather than merely adding up to
   * the right length. The old path was correct but quadratic; a sized buffer is linear and has
   * offsets to get wrong.
   */
  function starsHeader(records: number): Uint8Array {
    const header = new Uint8Array(BINARY_HEADER_BYTES)
    header.set([0x45, 0x54, 0x52, 0x4e], 0) // 'ETRN'
    header[4] = 1 // kind: stars
    header[5] = CONTRACT_VERSION
    new DataView(header.buffer).setUint32(8, records, true)
    return header
  }

  /** A record whose every byte is `fill`, so a misplaced write shows up rather than merely sizing. */
  function record(fill: number): Uint8Array {
    return new Uint8Array(STAR_RECORD_BYTES).fill(fill)
  }

  it('places every byte correctly when the header arrives split across chunks', () => {
    const header = starsHeader(2)
    const reader = new StarStreamReader()
    // The header straddles a chunk boundary, so the buffer cannot be sized on the first push.
    reader.push(header.subarray(0, 5))
    expect(reader.completeRecords).toBe(0)
    reader.push(header.subarray(5))
    expect(reader.expectedRecords).toBe(2)

    reader.push(record(0xa1))
    reader.push(record(0xb2))
    expect(reader.done).toBe(true)

    const body = reader.body()
    expect(body.byteLength).toBe(STAR_RECORD_BYTES * 2)
    expect([...body.subarray(0, STAR_RECORD_BYTES)].every((b) => b === 0xa1)).toBe(true)
    expect([...body.subarray(STAR_RECORD_BYTES)].every((b) => b === 0xb2)).toBe(true)
  })

  it('keeps every record at its own offset across many chunks', () => {
    const fills = [0x11, 0x22, 0x33, 0x44]
    const reader = new StarStreamReader()
    reader.push(starsHeader(fills.length))
    for (const fill of fills) reader.push(record(fill))

    const body = reader.body()
    expect(body.byteLength).toBe(STAR_RECORD_BYTES * fills.length)
    for (const [i, fill] of fills.entries()) {
      const slice = body.subarray(i * STAR_RECORD_BYTES, (i + 1) * STAR_RECORD_BYTES)
      expect([...slice].every((b) => b === fill)).toBe(true)
    }
  })

  it('tolerates a file longer than its own header says, ignoring the excess', () => {
    const reader = new StarStreamReader()
    reader.push(starsHeader(1))
    reader.push(record(0x77))
    // One record more than declared. `completeRecords` clamps, and this must not throw.
    reader.push(record(0x99))

    expect(reader.completeRecords).toBe(1)
    expect(reader.body().byteLength).toBe(STAR_RECORD_BYTES)
    expect([...reader.body()].every((b) => b === 0x77)).toBe(true)
  })
})

describe('adaptive quality (PRD 8.5.11)', () => {
  const feed = (monitor: QualityMonitor, ms: number, seconds: number): void => {
    for (let t = 0; t < (seconds * 1000) / ms; t += 1) monitor.sample(ms)
  }

  it('steps down in the PRD order and never touches geometry or motion', () => {
    expect(QUALITY_TIERS[0]!.pixelRatioCap).toBe(1.5)
    expect(QUALITY_TIERS[1]!.pixelRatioCap).toBe(1)
    expect(QUALITY_TIERS[1]!.bloomScale).toBe(QUALITY_TIERS[0]!.bloomScale)
    expect(QUALITY_TIERS[2]!.bloomScale).toBeLessThan(QUALITY_TIERS[1]!.bloomScale)
    expect(QUALITY_TIERS[3]!.thumbnailCapacity).toBeLessThan(QUALITY_TIERS[2]!.thumbnailCapacity)
    // Nothing in a tier can reach the star count or the motion.
    for (const tier of QUALITY_TIERS) {
      expect(Object.keys(tier).sort()).toEqual([
        'bloomScale',
        'label',
        'pixelRatioCap',
        'thumbnailCapacity',
      ])
    }
  })

  it('degrades only after a sustained drop, not on one slow frame', () => {
    const monitor = new QualityMonitor()
    for (let i = 0; i < 200; i += 1) monitor.sample(8)
    expect(monitor.sample(40)).toBeNull()
    expect(monitor.index).toBe(0)

    feed(monitor, 30, 3)
    expect(monitor.index).toBeGreaterThan(0)
  })

  it('steps back up after sustained headroom, and not before (PRD 8.5.11)', () => {
    const monitor = new QualityMonitor()
    feed(monitor, 30, 4)
    const degraded = monitor.index
    expect(degraded).toBeGreaterThan(0)

    // A short calm patch is not enough: the cooldown and the longer restore window both apply.
    feed(monitor, 8, 2)
    expect(monitor.index).toBe(degraded)
    feed(monitor, 8, 12)
    expect(monitor.index).toBeLessThan(degraded)
  })

  it('ignores outliers, so a tab returning to the foreground costs nothing', () => {
    const monitor = new QualityMonitor()
    for (let i = 0; i < 300; i += 1) monitor.sample(8)
    for (let i = 0; i < 60; i += 1) monitor.sample(4000)
    expect(monitor.index).toBe(0)
  })

  it('lets Phase 6 pin a tier for the forced-degradation check', () => {
    const monitor = new QualityMonitor()
    const seen: number[] = []
    monitor.subscribe((_tier, index) => seen.push(index))
    monitor.setTier(2)
    expect(monitor.tier.bloomScale).toBe(0.25)
    monitor.setTier(99)
    expect(monitor.index).toBe(QUALITY_TIERS.length - 1)
    expect(seen).toEqual([2, QUALITY_TIERS.length - 1])
  })

  it('holds a pinned tier against frames fast enough to restore it (PRD 9.1.4)', () => {
    // The reference machine runs the bench at ~2.9 ms p95. `setTier` alone would be undone within
    // `restoreWindowS`, and the forced-degradation check would then be looking at tier 0 output.
    const monitor = new QualityMonitor(pinnedQualityOptions(2))
    expect(monitor.index).toBe(2)

    feed(monitor, 3, 60)
    expect(monitor.index).toBe(2)
    // Nor does trouble move it the other way.
    feed(monitor, 40, 20)
    expect(monitor.index).toBe(2)
    // And an explicit set cannot escape the pin either.
    monitor.setTier(0)
    expect(monitor.index).toBe(2)
  })

  it('leaves the ladder free when nothing is pinned', () => {
    const monitor = new QualityMonitor(pinnedQualityOptions(null))
    expect(monitor.index).toBe(0)
    feed(monitor, 30, 4)
    expect(monitor.index).toBeGreaterThan(0)
  })

  it('reads the pin off the URL, and ignores anything that is not a tier', () => {
    expect(pinnedQualityTier('?quality=0')).toBe(0)
    expect(pinnedQualityTier('?quality=3')).toBe(3)
    // Out of the ladder, negative, fractional, empty, absent, or a word: all ignored, so a typo
    // degrades nothing rather than degrading to the floor.
    for (const search of ['?quality=4', '?quality=-1', '?quality=1.5', '?quality=', '', '?q=2', '?quality=full']) {
      expect(pinnedQualityTier(search)).toBeNull()
    }
  })
})

/**
 * The monitor is fed frame *intervals*, and on a vsync-locked page an interval is a multiple of the
 * display's refresh period whatever the frame costs. The two absolutes this shipped with therefore
 * measured the display: 13.5 ms to restore is below a healthy 60 Hz frame, and 20 ms to degrade is
 * above an unhealthy 120 Hz one. Both directions are pinned here (DEC-692 R5, review R5/§3.2).
 */
describe('adaptive quality thresholds follow the display (DEC-692 R5)', () => {
  const HZ_60 = DEFAULT_REFRESH_MS
  const HZ_120 = 1000 / 120

  const feed = (monitor: QualityMonitor, ms: number, seconds: number): void => {
    for (let t = 0; t < (seconds * 1000) / ms; t += 1) monitor.sample(ms)
  }

  it('keeps the two thresholds ordered at every display period it can learn', () => {
    // The review's wording — "fine at p90 ≤ one vsync + 0.5 ms, degrade above 1.05 vsync" — crosses
    // over below a 10 ms period. These must not, or one p90 would both degrade and restore.
    for (const hz of [60, 75, 90, 100, 120, 144, 240]) {
      const refresh = 1000 / hz
      expect(degradeThresholdMs(refresh)).toBeGreaterThan(restoreThresholdMs(refresh))
      // And a frame that hits the cadence exactly is always "fine".
      expect(restoreThresholdMs(refresh)).toBeGreaterThan(refresh)
    }
  })

  it('restores on a 60 Hz panel, where the 13.5 ms threshold made the ladder one-way', () => {
    const monitor = new QualityMonitor()
    expect(monitor.refreshIntervalMs).toBeCloseTo(HZ_60, 6)

    // Every other frame missed: 60 Hz vsync, 30 fps delivered.
    feed(monitor, HZ_60 * 2, 4)
    const degraded = monitor.index
    expect(degraded).toBeGreaterThan(0)

    // Now perfectly healthy *for this panel* — and 16.67 ms is above the old 13.5 ms restore
    // threshold, so this is the case that could never step back up.
    feed(monitor, HZ_60, 20)
    expect(monitor.index).toBeLessThan(degraded)

    // The control: the two absolutes this shipped with, fed exactly the same frames. It degrades
    // and then cannot come back, which is the defect — so the assertion above is not vacuous.
    const shipped = new QualityMonitor({ degradeMs: 20, restoreMs: 13.5 })
    feed(shipped, HZ_60 * 2, 4)
    expect(shipped.index).toBeGreaterThan(0)
    feed(shipped, HZ_60, 20)
    expect(shipped.index).toBeGreaterThan(0)
  })

  it('reacts when a 120 Hz panel halves, then settles once 60 fps is the sustained cadence', () => {
    const monitor = new QualityMonitor()
    // Let it see the panel's own cadence first.
    feed(monitor, HZ_120, 4)
    expect(monitor.refreshIntervalMs).toBeCloseTo(HZ_120, 6)
    expect(monitor.index).toBe(0)

    // Half the refresh rate. Under the shipped absolute this is 16.67 ms against a 20 ms trigger,
    // so the ladder sat at `full` while the app delivered half the frames the display could show.
    // Here it steps down, because the band in force is still the 120 Hz one.
    feed(monitor, HZ_120 * 2, 4)
    expect(monitor.index).toBeGreaterThan(0)

    // The control, with the shipped absolutes: 16.67 ms never reaches a 20 ms trigger at all.
    const shipped = new QualityMonitor({ degradeMs: 20, restoreMs: 13.5 })
    feed(shipped, HZ_120, 4)
    feed(shipped, HZ_120 * 2, 4)
    expect(shipped.index).toBe(0)

    // **And then it comes back, which is the honest end of this story.** Once 16.67 ms is the
    // cadence the page has sustained for a while, the estimate rises to the 60 Hz cap and the band
    // widens to match, so the monitor stops treating it as trouble. The review wanted this case
    // caught outright; catching it permanently needs the running-minimum estimate, which the test
    // below measures doing real harm. 60 fps is the floor the app is judged against, so this errs
    // towards leaving a machine that meets the floor alone. Asserted rather than left implicit:
    // the previous version of this test stopped at four seconds and read as though the step down
    // were permanent, which it is not.
    feed(monitor, HZ_120 * 2, 30)
    expect(monitor.index).toBe(0)
    expect(monitor.refreshIntervalMs).toBeCloseTo(HZ_60, 6)
  })

  it('does not ratchet down on an adaptive-refresh panel (the measured regression)', () => {
    // Real rAF intervals from the review machine (Chrome, `--use-angle=metal`, 1920×1080, idle):
    // min 11.4 ms, median 13.3, p90 13.8 — a panel with no single period, sustaining about 75 Hz.
    const observed = [11.4, 12.6, 13.1, 13.3, 13.3, 13.4, 13.5, 13.6, 13.8, 13.9]
    const monitor = new QualityMonitor()
    for (let i = 0; i < 6000; i += 1) monitor.sample(observed[i % observed.length]!)

    // The cadence, not the fastest frame it ever managed.
    expect(monitor.refreshIntervalMs).toBeCloseTo(1000 / 75, 6)
    // A healthy machine is left alone. This is what was red before the estimate stopped being a
    // running minimum: an idle probe run finished pinned at the bottom `thumbnails` tier.
    expect(monitor.index).toBe(0)
    // The p90 of that healthy run has to sit inside the band, or restoring is impossible.
    expect(monitor.thresholdsMs.restore).toBeGreaterThan(13.9)

    // The control: the period a running minimum would have latched from that 11.4 ms frame. The
    // band it produces puts `restore` under the p90 of a perfectly healthy run, so a monitor
    // knocked down once can never climb back — the one-way ladder R5 exists to remove.
    const latched = new QualityMonitor({ refreshMs: 1000 / 90 })
    expect(latched.thresholdsMs.restore).toBeLessThan(13.9)
    latched.setTier(2)
    for (let i = 0; i < 6000; i += 1) latched.sample(observed[i % observed.length]!)
    expect(latched.index).toBe(2)
  })

  it('will not learn a period slower than the 60 fps floor', () => {
    const monitor = new QualityMonitor()
    // A 30 Hz panel, or a page in trouble from its first frame — indistinguishable from intervals
    // alone. The monitor declines to relax, degrades, and that is the safe direction.
    feed(monitor, 33, 4)
    expect(monitor.refreshIntervalMs).toBeCloseTo(HZ_60, 6)
    expect(monitor.index).toBeGreaterThan(0)
  })

  it('does not degrade a healthy vsync-locked run on its jitter', () => {
    // The case that caught a first attempt at this: the e2e bench smoke on a SwiftShader runner
    // throttled to 60 Hz reports p50 16.9 ms and p95 19.1 ms while keeping up. Frame intervals are
    // not cleanly quantised to the refresh period, so a threshold sitting a millisecond or two
    // above it walks a machine that is fine all the way down the ladder.
    const monitor = new QualityMonitor()
    const jitter = [16.4, 16.7, 17.1, 16.6, 18.2, 16.9, 19.1, 16.5, 17.6, 16.8]
    for (let i = 0; i < 1200; i += 1) monitor.sample(jitter[i % jitter.length]!)
    expect(monitor.index).toBe(0)

    // And a tier that was pushed down by real trouble still comes back through that jitter.
    const recovering = new QualityMonitor()
    feed(recovering, HZ_60 * 2, 4)
    expect(recovering.index).toBeGreaterThan(0)
    for (let i = 0; i < 3000; i += 1) recovering.sample(jitter[i % jitter.length]!)
    expect(recovering.index).toBe(0)
  })

  it('cannot be made strict by one anomalously short interval', () => {
    const monitor = new QualityMonitor()
    feed(monitor, HZ_120, 2)
    // A 6 ms rAF callback on a 120 Hz panel. A raw running minimum would take it as the period and
    // put every threshold below the panel's own 8.33 ms, degrading the ladder to the floor.
    monitor.sample(6)
    expect(monitor.refreshIntervalMs).toBeCloseTo(HZ_120, 6)
    feed(monitor, HZ_120, 6)
    expect(monitor.index).toBe(0)
  })

  it('lets a caller state the period, and an absolute threshold still override it', () => {
    const stated = new QualityMonitor({ refreshMs: HZ_120 })
    expect(stated.refreshIntervalMs).toBeCloseTo(HZ_120, 6)
    expect(stated.thresholdsMs.degrade).toBeCloseTo(degradeThresholdMs(HZ_120), 6)

    // The bench and the unit suite measure against a budget of their own choosing.
    const absolute = new QualityMonitor({ degradeMs: 40, restoreMs: 5 })
    expect(absolute.thresholdsMs).toEqual({ degrade: 40, restore: 5 })
    feed(absolute, 30, 4)
    expect(absolute.index).toBe(0)
  })
})

describe('data error reporting (PRD 7.4.1)', () => {
  it('reports an artefact once, however often it fails', () => {
    const hub = new SceneErrorHub()
    const seen: string[] = []
    hub.subscribe((error) => seen.push(error.artefact))
    hub.report('stars.bin', 3, new Error('boom'))
    hub.report('stars.bin', 3, new Error('boom again'))
    hub.report('search.json', 3, new Error('also boom'))
    expect(seen).toEqual(['stars.bin', 'search.json'])
    expect(hub.hasReported('stars.bin')).toBe(true)
  })

  it('carries a sentence the shell can put in a toast without knowing the loader', () => {
    const hub = new SceneErrorHub()
    let message = ''
    hub.subscribe((error) => {
      message = error.message
    })
    hub.report('stars.bin', 3, new Error('nope'))
    expect(message).toContain('stars.bin')
    expect(message).toContain('3 attempts')
  })

  it('lets a listener unsubscribe', () => {
    const hub = new SceneErrorHub()
    let count = 0
    const off = hub.subscribe(() => (count += 1))
    off()
    hub.report('sets.bin', 3, new Error('x'))
    expect(count).toBe(0)
  })
})

describe('tuning defaults match the PRD', () => {
  it('twinkles at ±8% (PRD 5.4.11)', () => {
    expect(TWINKLE_AMPLITUDE).toBe(0.08)
  })
})

/** `PT_SPIN_ANGLE` is read by the shader as texel 2's w component; guard the arithmetic. */
describe('plane table layout', () => {
  it('keeps the spin angle in the slot the shader reads', () => {
    expect(PT_SPIN_ANGLE).toBe(11)
    expect(Math.floor(PT_SPIN_ANGLE / 4)).toBe(2)
    expect(PT_SPIN_ANGLE % 4).toBe(3)
  })
})

/**
 * The two CPU implementations of one motion function, checked against each other.
 *
 * `scene/starfield/motion.ts` is what the star field draws from and what the vertex shader mirrors;
 * `camera/motion.ts` is what the camera tethers to. Until Phase 3 they disagreed — the camera
 * rotated a star about world +Y where the field rotates it about the plane's local +z, and the two
 * used different shear phase gradients — and nothing caught it, because every tether the rig had
 * ever resolved had a local position of (0,0,0), where neither difference can show. The card tether
 * is the first with a star's own local position in it.
 *
 * This is not the same claim `scripts/verify-browser.mjs` makes. That one compares the CPU mirror
 * with the *GPU*; this compares the camera's copy with the field's, which is the pair a card tier
 * puts on screen together.
 */
describe('the camera mirror agrees with the star field (PRD 8.5.3, 8.5.7)', () => {
  const LOCALS: ReadonlyArray<readonly [number, number, number]> = [
    [0.83, 0.04, -0.51],
    [-0.62, 0.77, 0.03],
    [0.11, -0.94, 0.02],
    [1.15, 0.2, -0.04],
    [0, 0, 0],
  ]

  function agreeAt(record: PlaneRecord, seconds: number): void {
    const table = new PlaneTable([record], 130)
    const motion = new SceneMotion({
      contractVersion: 1,
      shardSize: 2000,
      multiverseRadius: 130,
      discThickness: 0.15,
      planes: [record],
    })
    const dt = 1 / 60
    for (let i = 0; i < Math.round(seconds * 60); i += 1) {
      table.advance(dt, 1)
      motion.advance(dt)
    }
    // The one clock: the field's. This is what `scene/EternitiesScene`'s `MotionSync` does, and
    // without it the two integrate the same angles separately.
    motion.syncClock(table.time, table.multiverseAngle)
    motion.syncSpin(0, table.planes[0]!.spinAngle)

    const field = vec()
    const camera = vec()
    for (const [x, y, z] of LOCALS) {
      starWorldPosition(table.raw, 0, x, y, z, table.time, table.multiverseAngle, 1, field)
      motion.starPosition(camera, record, x, y, z)
      expect(camera.x).toBeCloseTo(field.x, 6)
      expect(camera.y).toBeCloseTo(field.y, 6)
      expect(camera.z).toBeCloseTo(field.z, 6)
    }
  }

  it('puts a star in the same world place on an untilted plane', () => {
    agreeAt(plane(), 7)
  })

  it('puts a star in the same world place on a tilted, drifting, shearing plane', () => {
    // A tilt that actually rotates the disc out of the xy plane, which is where a rotation about
    // the wrong axis stops being a rotation about the right one by any amount.
    const half = Math.SQRT1_2
    agreeAt(
      plane({
        tilt: [0.31 * half, 0.52 * half, 0.19 * half, 0.9],
        shearAmplitude: 0.17,
        shearPeriodS: 43,
        driftAmplitude: 1.4,
        spinPeriodS: 71,
        spinDirection: -1,
        radius: 9,
      }),
      11,
    )
  })

  it('agrees on the dust row, where the turbulence and not the spin does the moving (PRD 8.6.3)', () => {
    // The Blind Eternities row: identity transform, radius R, curl noise instead of a spiral.
    agreeAt(
      plane({
        kind: 'dust',
        tilt: [0, 0, 0, 1],
        radius: 130,
        spinPeriodS: 0,
        driftAmplitude: 0,
        driftPeriodS: 0,
        shearAmplitude: 0,
        shearPeriodS: 0,
      }),
      5,
    )
  })

  it('agrees under reduced motion, where the field zeroes what the camera freezes (PRD 5.9)', () => {
    const record = plane({ shearAmplitude: 0.2, driftAmplitude: 2 })
    const table = new PlaneTable([record], 130)
    const motion = new SceneMotion(
      {
        contractVersion: 1,
        shardSize: 2000,
        multiverseRadius: 130,
        discThickness: 0.15,
        planes: [record],
      },
      { reducedMotion: true },
    )
    // The table keeps its clock running under reduced motion and multiplies the moving terms by
    // zero; the camera freezes its own. Syncing the clock is what makes the two land together, and
    // it is the reason `MotionSync` exists rather than two `advance` calls being enough.
    for (let i = 0; i < 300; i += 1) table.advance(1 / 60, 0)
    motion.syncClock(table.time, table.multiverseAngle)
    motion.syncSpin(0, table.planes[0]!.spinAngle)

    const field = vec()
    const camera = vec()
    starWorldPosition(table.raw, 0, 0.7, -0.3, 0.05, table.time, table.multiverseAngle, 0, field)
    motion.starPosition(camera, record, 0.7, -0.3, 0.05)
    expect(camera.x).toBeCloseTo(field.x, 9)
    expect(camera.y).toBeCloseTo(field.y, 9)
    expect(camera.z).toBeCloseTo(field.z, 9)
  })
})

/**
 * The star vertex shader reads the hue class out of the packed colour byte (contract §5,
 * amendment A3) with `int(aClass.y + 0.5) & 7`. Nothing else covers that expression, so pin it
 * here: it must agree with the contract's mask for every byte the encoder can emit, and `uHues`
 * has only seven elements.
 */
describe('packed colour byte (contract §5, amendment A3)', () => {
  it('recovers the hue class from every byte the encoder can emit', () => {
    const shaderHue = (byte: number) => Math.trunc(byte + 0.5) & 7
    for (let byte = 0; byte < 256; byte += 1) {
      expect(shaderHue(byte)).toBe(byte & HUE_CLASS_MASK)
    }
  })

  it('never indexes uHues past its seventh element for a real record', () => {
    const shaderHue = (byte: number) => Math.trunc(byte + 0.5) & 7
    for (let hue = 0; hue <= HueClass.Colourless; hue += 1) {
      for (let identity = 0; identity <= COLOUR_IDENTITY_MASK; identity += 1) {
        const byte = hue | (identity << COLOUR_IDENTITY_SHIFT)
        expect(shaderHue(byte)).toBe(hue)
        expect(shaderHue(byte)).toBeLessThanOrEqual(HueClass.Colourless)
      }
    }
    // The unmasked read this guards against: mono-green is byte 132, not hue class 4.
    expect(HueClass.Green | (1 << (HueClass.Green + COLOUR_IDENTITY_SHIFT))).toBe(132)
  })

  it('keeps the mask the shader hard-codes in step with the contract', () => {
    expect(HUE_CLASS_MASK).toBe(0b111)
    expect(COLOUR_IDENTITY_SHIFT).toBe(3)
    expect(STAR_VERTEX_SHADER).toContain('int(aClass.y + 0.5) & 7')
  })
})
