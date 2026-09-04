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
    header[5] = 1 // contract version
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
