/**
 * §1.2 step 3 — the Blind Eternities belt (spec §1.8), against the shipped v3 dataset.
 *
 * The rows here are about the two things that can be silently wrong in a belt.
 *
 * **One: the ordering this renderer assumes is the pipeline's.** `belt.ts` reads positions straight
 * out of `stars.bin` and colours each card by looking its set up through the cumulative `cardCount`
 * of `plane.sets`. That mapping is an *assumption* about how `belt_position` laid the cards out, and
 * a wrong one produces a belt whose arcs are perfectly formed and whose colours run in the wrong
 * order — which looks like a year ramp, because it is one, just not of the years the arcs hold. So
 * the assumption is measured here against the artefact rather than asserted against the code.
 *
 * **Two: `sizeAttenuation`.** §1.13 lists it as trap 3 and the failure is spectacular but only on a
 * fly-in, which no unit test and no gate row reaches.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Color, type ShaderMaterial } from 'three'

import { decodeStars } from '../src/data/decode'
import type { PlanesFile } from '../src/data/types'
import {
  buildBelt,
  disposeBelt,
  multiverseYearSpan,
  setBeltPixelRatio,
  yearColour,
} from '../src/scene/worlds/belt'
import { BELT_POINT_SIZE_PX, BELT_VERTEX_SHADER } from '../src/scene/worlds/beltShaders'
import { SHADER_NAME_WORLD_BELT } from '../src/scene/shaderNames'

const DATA = resolve(__dirname, '../public/data')

function datasetDir(role: string): string {
  const roles = JSON.parse(readFileSync(resolve(__dirname, '../datasets.json'), 'utf8')) as Record<
    string,
    string
  >
  return resolve(DATA, roles[role]!)
}

function bufferOf(path: string): ArrayBuffer {
  const file = readFileSync(path)
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

const ROOT = datasetDir('worlds')
const PLANES = JSON.parse(readFileSync(resolve(ROOT, 'planes.json'), 'utf8')) as PlanesFile
const STARS = decodeStars(bufferOf(resolve(ROOT, 'stars.bin')))
const DUST = PLANES.planes.find((plane) => plane.kind === 'dust')!

/**
 * `layout.py`'s own constants, restated here so the rows below are a check of the *contract* rather
 * than a restatement of the implementation. If the pipeline retunes the belt these must be updated
 * deliberately — which is the point; a renderer that read them from the artefact could never notice
 * the day the artefact stopped being a belt.
 */
const BELT_RADIUS_FACTOR = 1.12
const BELT_RADIAL_JITTER = 0.06
const BELT_VERTICAL_JITTER = 0.035
const BELT_SET_GAP = 0.06

const belt = () =>
  buildBelt({
    plane: DUST,
    stars: STARS,
    planes: PLANES.planes,
    multiverseRadius: PLANES.multiverseRadius,
    pixelRatio: 1,
  })

describe('the belt reads the positions the pipeline shipped (§1.8, §2.1)', () => {
  it('draws one point per dust card, scaled out of the plane-local frame', () => {
    const points = belt()
    const position = points.geometry.getAttribute('position')
    expect(position.count).toBe(DUST.starCount)
    // Not a constant. On v3 it is 4,204 and on the 87-plane roster it was 4,980; §1.8 states both,
    // and the curation refresh moves it again (DEC-745).
    expect(DUST.starCount).toBeGreaterThan(1000)

    // The dust plane's local frame is multiverse coordinates over `multiverseRadius` (§2.1), which
    // is the same scale the galaxy's own vertex path applies through `PT_RADIUS`.
    const star = DUST.starOffset + 7
    expect(position.getX(7)).toBeCloseTo(STARS.x(star) * PLANES.multiverseRadius, 4)
    expect(position.getY(7)).toBeCloseTo(STARS.y(star) * PLANES.multiverseRadius, 4)
    expect(position.getZ(7)).toBeCloseTo(STARS.z(star) * PLANES.multiverseRadius, 4)
    disposeBelt(points)
  })

  it('lies inside §1.8s radial and vertical bounds, in world units', () => {
    const points = belt()
    const position = points.geometry.getAttribute('position')
    const R = PLANES.multiverseRadius

    let minRadial = Infinity
    let maxRadial = -Infinity
    let maxVertical = 0
    for (let i = 0; i < position.count; i += 1) {
      const radial = Math.hypot(position.getX(i), position.getZ(i))
      if (radial < minRadial) minRadial = radial
      if (radial > maxRadial) maxRadial = radial
      maxVertical = Math.max(maxVertical, Math.abs(position.getY(i)))
    }

    // The bound is the law's, **plus the encoding's own error**, and the second term is not slack.
    // `stars.bin` stores three float16s (§2.1), whose spacing on `[1, 2)` is `2^-10` — so a position
    // the pipeline generated exactly on the law's edge decodes up to `2^-11` outside it, in
    // plane-local units, which is `R * 2^-11` = 0.063 world units here. Measured, the worst card
    // lands 0.005 outside; a tolerance written as a round `1e-3` would fail on correct data and
    // would be "fixed" by loosening it to a number with no derivation behind it.
    const decodeSlack = R * 2 ** -11
    expect(minRadial).toBeGreaterThanOrEqual(
      R * BELT_RADIUS_FACTOR * (1 - BELT_RADIAL_JITTER) - decodeSlack,
    )
    expect(maxRadial).toBeLessThanOrEqual(
      R * BELT_RADIUS_FACTOR * (1 + BELT_RADIAL_JITTER) + decodeSlack,
    )
    expect(maxVertical).toBeLessThanOrEqual(
      R * BELT_RADIUS_FACTOR * BELT_VERTICAL_JITTER + decodeSlack,
    )

    // The jitter must actually be present. A belt with the jitter dropped is a mathematically clean
    // ring, which §1.8 says "reads as a UI element, not as debris" — and it would satisfy every
    // bound above, because a bound is satisfied hardest by a constant.
    expect(maxRadial - minRadial).toBeGreaterThan(R * BELT_RADIUS_FACTOR * BELT_RADIAL_JITTER)
    expect(maxVertical).toBeGreaterThan(R * BELT_RADIUS_FACTOR * BELT_VERTICAL_JITTER * 0.5)
    disposeBelt(points)
  })

  it('puts every card inside its own sets arc, which is what the colour lookup assumes', () => {
    // **The load-bearing row of this file.** `setOfCard` walks the cumulative `cardCount` of
    // `plane.sets`, which is only the right answer if the pipeline emitted the dust stars in that
    // same chronological, contiguous order. Nothing in the contract says it did — `PlaneSetRef`
    // says the array is chronological, and `belt_position` takes a `set_band` — so this is the
    // measurement that joins the two.
    const points = belt()
    const position = points.geometry.getAttribute('position')
    const bands = DUST.sets.length
    const span = (2 * Math.PI) / bands

    let inside = 0
    let card = 0
    for (const [band, set] of DUST.sets.entries()) {
      const low = band * span + BELT_SET_GAP * span
      const high = low + span * (1 - 2 * BELT_SET_GAP)
      for (let i = 0; i < set.cardCount; i += 1, card += 1) {
        const lambda = Math.atan2(position.getZ(card), position.getX(card))
        const wrapped = lambda < 0 ? lambda + 2 * Math.PI : lambda
        if (wrapped >= low - 1e-6 && wrapped <= high + 1e-6) inside += 1
      }
    }

    expect(card).toBe(DUST.starCount)
    expect(inside, `${inside} of ${card} cards inside their own set's arc`).toBe(card)
    disposeBelt(points)
  })

  it('colours a card by its own sets year, cold to warm', () => {
    const points = belt()
    const colour = points.geometry.getAttribute('aColour')
    const [first, last] = multiverseYearSpan(PLANES.planes)
    // Derived from the roster, and §1.8's stated pair is what it comes to on v3 — while the belt's
    // OWN range starts at 1997, which is why the span is not read off the dust plane.
    expect([first, last]).toEqual([1993, 2026])
    expect(DUST.firstYear).toBeGreaterThan(first)

    const expected = new Color()
    let card = 0
    for (const set of DUST.sets) {
      yearColour(set.year, first, last, expected)
      expect(colour.getX(card)).toBeCloseTo(expected.r, 5)
      expect(colour.getY(card)).toBeCloseTo(expected.g, 5)
      expect(colour.getZ(card)).toBeCloseTo(expected.b, 5)
      card += set.cardCount
    }

    // The ramp has to actually be a ramp. Cold at 1993 is blue-dominant, warm at 2026 is
    // red-dominant, and a ramp that ran the other way — or did not run at all — would still give
    // every card a plausible colour.
    const cold = yearColour(first, first, last, new Color())
    const warm = yearColour(last, first, last, new Color())
    expect(cold.b).toBeGreaterThan(cold.r)
    expect(warm.r).toBeGreaterThan(warm.b)
    disposeBelt(points)
  })
})

describe('trap 3: the belt is not size-attenuated (§1.8, §1.13)', () => {
  it('sizes its points from a uniform and never from view depth', () => {
    // A source-text guard, and it is exactly as complete as its own reading — so it is narrow on
    // purpose: `gl_PointSize` is assigned once, from `uSizePx`, and the shader mentions no
    // view-space depth at all. `PointsMaterial`'s own spelling is a `#ifdef USE_SIZEATTENUATION`
    // around a division by `-mvPosition.z`, and the whole trap is that the flag defaults to ON.
    const assignments = [...BELT_VERTEX_SHADER.matchAll(/gl_PointSize\s*=([^;]*);/g)]
    expect(assignments).toHaveLength(1)
    expect(assignments[0]![1]!.trim()).toBe('uSizePx')
    expect(BELT_VERTEX_SHADER).not.toMatch(/mvPosition|modelViewMatrix\s*\*\s*vec4\(position[^;]*\.z/)
  })

  it('resolves 2 CSS px against the device pixel ratio, both at build and on a monitor change', () => {
    // `gl_PointSize` is in **device** pixels and every threshold in this spec is CSS. At dpr 1 —
    // which is where §3.1's gate runs, exclusively — the two are equal, so no gate row can tell
    // them apart and only a retina display shows the belt at half size.
    const points = buildBelt({
      plane: DUST,
      stars: STARS,
      planes: PLANES.planes,
      multiverseRadius: PLANES.multiverseRadius,
      pixelRatio: 2,
    })
    const material = points.material as ShaderMaterial
    expect(material.name).toBe(SHADER_NAME_WORLD_BELT)
    expect(material.uniforms.uSizePx!.value).toBe(BELT_POINT_SIZE_PX * 2)

    setBeltPixelRatio(points, 1)
    expect(material.uniforms.uSizePx!.value).toBe(BELT_POINT_SIZE_PX)
    disposeBelt(points)
  })

  it('draws opaque and depth-tested, which is §1.2s step 3 and not the prototypes additive dust', () => {
    const points = belt()
    const material = points.material as ShaderMaterial
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.depthTest).toBe(true)
    disposeBelt(points)
  })
})
