/**
 * The platform layer's pure half (DEC-739, review §3.5 and §3.7).
 *
 * Everything under `src/scene/platform/` exists to answer questions about a machine the team does
 * not own, so almost none of it can be *verified* here — a GPU that mishandles half-float attributes
 * is precisely what is not available. What can be checked in `node` is the arithmetic those answers
 * are built out of, and that is what this file does:
 *
 *  - the half-float probe's bit patterns and the texel indices it asserts on, against the decoder
 *    the data path already trusts;
 *  - `resolvePixelRatio`, which is the ladder's first rung as one expression;
 *  - the warm-up's dedupe, which decides the number the bench reports as "programs warmed".
 *
 * The DOM half — the re-armed `matchMedia` and the `device-pixel-content-box` observer — is in
 * `platform-dom.test.tsx`, because `.test.ts` runs in `node` by design (see `vitest.config.ts`).
 */

import { ShaderMaterial, Texture } from 'three'
import { describe, expect, it } from 'vitest'

import type { PlaneRecord } from '../src/data/types'
import { float16ToNumber } from '../src/data/decode'
import { resolvePixelRatio } from '../src/scene/platform/backingStore'
import { capabilitiesForBench } from '../src/scene/platform/capabilities'
import { HALF_FLOAT_PROBE_INTERNALS } from '../src/scene/platform/halfFloatProbe'
import { dedupeSpecs, type ProgramWarmupSpec } from '../src/scene/platform/programWarmup'
import { QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'
import { PlaneTable } from '../src/scene/starfield/planeTable'
import { createStarField } from '../src/scene/starfield/starFieldObjects'
import { StarGeometry } from '../src/scene/starfield/starGeometry'
import { PICK_MIN_PX, STAR_MAX_PX, STAR_MIN_PX } from '../src/scene/tuning'

/** The minimum a `PlaneTable` will accept; only its texture is read here. */
function plane(): PlaneRecord {
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
  }
}

describe('the half-float probe (review §3.7: "float16 is a manual switch")', () => {
  /**
   * The probe's bit patterns are written as constants rather than produced by an encoder, and this
   * is why: an encoder would be a second implementation of the thing under test, so a shared sign
   * or exponent bug would make probe and encoder agree and the check pass on a broken driver. They
   * are checked here against `float16ToNumber` instead — the *decoder*, which the star path has
   * relied on since Phase 0 and which the shared test vector pins against Python.
   */
  it('draws with the bit patterns it claims to', () => {
    const { HALF_ZERO, HALF_POS_HALF, HALF_NEG_HALF } = HALF_FLOAT_PROBE_INTERNALS
    expect(float16ToNumber(HALF_ZERO)).toBe(0)
    expect(float16ToNumber(HALF_POS_HALF)).toBe(0.5)
    expect(float16ToNumber(HALF_NEG_HALF)).toBe(-0.5)
  })

  /**
   * The four texels the probe reads back are derived from `PROBE_SIZE`, so that changing the target
   * size cannot leave the assertion sampling texels no point covers — which would answer "this
   * driver is broken" on every machine and silently cost every user the float32 path.
   */
  /**
   * The four texels the probe reads back must be *solidly interior* to the blocks the four points
   * cover — not on their edges.
   *
   * This is the assertion that would have caught the probe's first draft, which drew one-pixel
   * points at clip +-0.5. That lands on window coordinate 4.0 and 12.0, which are pixel *corners*:
   * a one-pixel square there straddles four pixels with every centre exactly on its boundary, and
   * the tie-break is not specified. Measured, it reported failure on a healthy M5 Pro through ANGLE
   * Metal — which would have moved every user everywhere onto the float32 path while looking like
   * a working mitigation.
   */
  it('samples texels that are solidly inside the blocks the points cover', () => {
    const { PROBE_SIZE, PROBE_POINT_PX, NEAR, FAR, EMPTY } = HALF_FLOAT_PROBE_INTERNALS
    // Clip space -0.5 and +0.5 into a PROBE_SIZE viewport, as window coordinates.
    const nearCorner = (-0.5 * 0.5 + 0.5) * PROBE_SIZE
    const farCorner = (0.5 * 0.5 + 0.5) * PROBE_SIZE
    const half = PROBE_POINT_PX / 2

    // A point three pixels wide covers [centre - 1.5, centre + 1.5]. The sampled texel's own
    // centre — index + 0.5 — has to be strictly inside that, with room to spare on both sides, or
    // the read is a rasterisation tie-break rather than a measurement.
    for (const [texel, corner] of [
      [NEAR, nearCorner],
      [FAR, farCorner],
    ] as const) {
      expect(texel + 0.5).toBeGreaterThan(corner - half)
      expect(texel + 0.5).toBeLessThan(corner + half)
      // ...and not merely inside: at least half a pixel clear of each edge.
      expect(Math.abs(texel + 0.5 - corner)).toBeLessThanOrEqual(half - 0.5)
    }

    // Distinct, inside the target, and the negative control is clear of both blocks — the assertion
    // that the target came back *empty* at `EMPTY` is what stops a driver passing by filling it.
    expect(NEAR).toBeLessThan(FAR)
    expect(NEAR).toBeGreaterThanOrEqual(0)
    expect(FAR).toBeLessThan(PROBE_SIZE)
    expect(Math.abs(EMPTY + 0.5 - nearCorner)).toBeGreaterThan(half)
    expect(Math.abs(EMPTY + 0.5 - farCorner)).toBeGreaterThan(half)
  })
})

describe('the pixel-ratio cap (PRD 7.1.3, review §3.5)', () => {
  it('is the lower of the tier cap and what the display gives', () => {
    // The cap binds on a high-density display: PRD 7.1.3's reason for having one at all.
    expect(resolvePixelRatio(1.5, 3)).toBe(1.5)
    expect(resolvePixelRatio(1, 3)).toBe(1)
    // The display binds on a 1x monitor, which is the half review §2.2 measured the shipped app
    // getting wrong — "2880x1620 in every phase ... i.e. dpr 1.5 on a dpr-1 viewport", 2.25x the
    // pixels drawn and two thirds of them thrown away in the blit.
    expect(resolvePixelRatio(1.5, 1)).toBe(1)
    // A fractional OS scale passes straight through when it is under the cap.
    expect(resolvePixelRatio(1.5, 1.25)).toBe(1.25)
  })

  it('never resolves to zero, whatever the document says', () => {
    // Reachable in a detached document and in a worker, and it would take the whole drawing buffer
    // to nothing rather than degrading anything.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolvePixelRatio(1.5, bad)).toBeGreaterThan(0)
      expect(resolvePixelRatio(bad, 2)).toBeGreaterThan(0)
    }
  })

  it('resolves every rung of the ladder against a 2x display', () => {
    // The ladder's first rung is the only one that moves this, which is what
    // `e2e/quality.spec.ts` asserts against a live renderer. Here it is the arithmetic alone.
    const resolved = QUALITY_TIERS.map((tier) => resolvePixelRatio(tier.pixelRatioCap, 2))
    expect(resolved).toEqual([1.5, 1, 1, 1, 1])
  })
})

describe('the ALIASED_POINT_SIZE_RANGE clamp (review §3.5, §3.7)', () => {
  /*
   * Why this is a unit test and not an e2e assertion.
   *
   * `e2e/quality.spec.ts` asserts `starMaxPixels <= pointSizeMax` off the live renderer, and that
   * assertion is **vacuous on every machine the team owns**: the app's own ceiling is
   * `STAR_MAX_PX` x dpr = 44 device pixels at dpr 2, and ANGLE reports 511 on this Mac and 1024 on
   * D3D11, so the clamp never binds and `<=` holds whether or not the clamp is there at all.
   * Deleting the `Math.min` in `starFieldObjects.update` was confirmed to leave all five e2e tests
   * green (DEC-739 mutant B).
   *
   * The clamp exists for the one platform in scope where it *does* bind — Firefox on Apple's native
   * GL reports 64, against the 88 the app asks for at dpr 4 — which is hardware no test runner has.
   * So the driver's limit is injected here instead, and the binding case is asserted directly.
   * Without this test the load-bearing half of review §3.5's "clamp `uMaxPixels` and the pick floor
   * to it" has no check that can fail.
   */
  const noise = new Texture()

  function sizesAt(maxPointSizePx: number, pixelRatio: number): Record<string, number> {
    const table = new PlaneTable([plane()], 130)
    const field = createStarField(table, new StarGeometry(4), noise)
    field.update(1, 1080, Math.PI / 4, pixelRatio, 0.5, maxPointSizePx)
    const uniforms = (field.points.material as ShaderMaterial).uniforms
    const sizes = {
      max: uniforms['uMaxPixels']!.value as number,
      min: uniforms['uMinPixels']!.value as number,
      // The pick program substitutes `uPickMinPixels` under the shared name `uMinPixels`
      // (`idMaterial`'s uniform block), so the pick floor is read off the pick material.
      pick: (field.pickPoints.material as ShaderMaterial).uniforms['uMinPixels']!.value as number,
    }
    field.dispose()
    return sizes
  }

  it('asks for the full sprite size when the driver can rasterise it', () => {
    // The non-binding case, which is every machine in scope but one. This row is the control: it
    // must stay green, or the two below would pass on a build that clamped everything to nothing.
    const sizes = sizesAt(511, 2)
    expect(sizes.max).toBe(STAR_MAX_PX * 2)
    expect(sizes.min).toBe(STAR_MIN_PX * 2)
    expect(sizes.pick).toBe(PICK_MIN_PX * 2)
  })

  it('never asks for a sprite larger than the driver will rasterise', () => {
    // Firefox on Apple's native GL, at the dpr where §3.7 measured the conflict: 22 x 4 = 88 asked
    // against a limit of 64. Unclamped, every mythic above 64 px draws at the same size silently.
    const sizes = sizesAt(64, 4)
    expect(STAR_MAX_PX * 4).toBeGreaterThan(64)
    expect(sizes.max).toBe(64)
  })

  it('clamps the pick floor and the size floor too, not just the ceiling', () => {
    // A floor above the driver's ceiling is a floor the driver ignores, so the pick pass would
    // believe its click targets were 7 CSS pixels wide while the driver drew them at 4.
    const sizes = sizesAt(4, 2)
    expect(sizes.max).toBe(4)
    expect(sizes.pick).toBe(4)
    expect(sizes.min).toBe(Math.min(STAR_MIN_PX * 2, 4))
  })
})

describe('the boot-time program warm-up (review §3.5, DEC-645)', () => {
  const geometryA = {} as ProgramWarmupSpec['geometry']
  const geometryB = {} as ProgramWarmupSpec['geometry']
  const materialA = {} as ProgramWarmupSpec['material']
  const materialB = {} as ProgramWarmupSpec['material']

  it('counts programs, not scene-graph nodes', () => {
    // The card's front and back faces are two meshes sharing one material and one geometry, so
    // they are one program; reporting two would make the bench's "programs warmed at boot" a
    // number about the scene graph rather than about the driver.
    const specs = dedupeSpecs([
      { geometry: geometryA, material: materialA },
      { geometry: geometryA, material: materialA },
    ])
    expect(specs).toHaveLength(1)
  })

  it('keeps a pair that differs in either half', () => {
    // Two materials over one geometry is genuinely two programs — the ladder's two glow variants
    // are exactly that — and so is one material over two geometries, because the parameter list
    // `getProgramCacheKey` reads is derived from the geometry as well.
    expect(
      dedupeSpecs([
        { geometry: geometryA, material: materialA },
        { geometry: geometryA, material: materialB },
        { geometry: geometryB, material: materialA },
      ]),
    ).toHaveLength(3)
  })

  it('preserves order and the points flag', () => {
    // Order so a failure names the program a reader can find; the flag because a `Points` draw
    // takes a different program from a `Mesh` draw and a stand-in that got it wrong would warm the
    // wrong one — leaving the real stall in place while reporting success.
    const specs = dedupeSpecs([
      { geometry: geometryA, material: materialA, points: true },
      { geometry: geometryB, material: materialB },
    ])
    expect(specs[0]!.points).toBe(true)
    expect(specs[1]!.points).toBeUndefined()
    expect(specs[0]!.material).toBe(materialA)
  })
})

describe('capabilitiesForBench (review §3.5: log it into bench JSON)', () => {
  it('flattens every answer into plain JSON values', () => {
    // Review §3.5 asks for `ALIASED_POINT_SIZE_RANGE` in the bench JSON specifically, and the
    // reason generalises to the rest: a run from a Windows laptop is only readable if it says which
    // GPU answers it was measured under. Flat, because a run's row has to be readable in a
    // spreadsheet.
    const row = capabilitiesForBench({
      webgl2: true,
      floatTargets: true,
      targetType: 1016,
      minTierIndex: 0,
      maxTextureSize: 16384,
      atlasAffordable: true,
      pointSizeRange: [1, 511],
      maxArrayTextureLayers: 2048,
      arrayLayersAffordable: true,
      parallelShaderCompile: true,
      positionMode: 'float16',
      halfFloatProbe: { ok: true, durationMs: 0.87654, detail: 'four points landed' },
    })

    expect(row['pointSizeMax']).toBe(511)
    expect(row['pointSizeMin']).toBe(1)
    expect(row['positionMode']).toBe('float16')
    expect(row['halfFloatProbeOk']).toBe(true)
    // Rounded, so a JSON diff between two runs is not noise in the seventh decimal place.
    expect(row['halfFloatProbeMs']).toBe(0.877)
    // Nothing nested, nothing that needs a custom serialiser.
    for (const value of Object.values(row)) {
      expect(['boolean', 'number', 'string']).toContain(typeof value)
    }
    expect(JSON.parse(JSON.stringify(row))).toEqual(row)
  })
})
