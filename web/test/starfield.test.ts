/**
 * Phase 2a's Node-side tests: the parts of the star field that are arithmetic rather than pixels.
 *
 * What is deliberately *not* here: whether the vertex shader agrees with the CPU motion mirror.
 * That needs a GPU, and `src/scene/selfCheck.ts` closes that loop through the id buffer under
 * `scripts/verify-browser.mjs`. Asserting it here against a hand-rolled reimplementation would
 * only prove that two copies of the same mistake match.
 */

import { describe, expect, it } from 'vitest'

import { StarStreamReader } from '../src/data/decode'
import { BINARY_HEADER_BYTES, STAR_RECORD_BYTES, type PlaneRecord } from '../src/data/types'
import { SceneErrorHub } from '../src/scene/errors'
import { QualityMonitor, QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'
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
    header[5] = 1 // contract version
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
