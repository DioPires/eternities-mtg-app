/**
 * The dataset, as a `WorldSurfaceSource` (spec §2.1, §2.2, §1.3, §1.4).
 *
 * This is the file that closes the gap between "the composition is tested" and "the composition has
 * ever been handed a world". Everything here runs against the **shipped v3 bytes** — the published
 * `planes.json`, `stars.bin` and `swatches.bin` of the `worlds` role — because the three things
 * `buildWorldSource` decides are all agreements with an emitter, and an agreement cannot be checked
 * against a fixture this file wrote itself.
 *
 * Where a row cannot discriminate the mutant it looks like it discriminates, it says so. Two do not:
 * the row-count row (below) and the radius row (§D).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { decodeStars, decodeSwatches, type Stars, type Swatches } from '../src/data/decode'
import type { PlaneRecord, PlanesFile } from '../src/data/types'
import { buildWorldSource, isWorldPlane, worldPlanesOf } from '../src/scene/worlds/worldSource'
import { rowColatitude, rowOfUnitY, rowStep, worldRadius } from '../src/scene/worlds/surfaceLaw'
import { WorldSurface } from '../src/scene/worlds/worldSurface'
import { ArtPool } from '../src/scene/worlds/artPool'
import { AdaptiveThreshold } from '../src/scene/worlds/adaptiveThreshold'
import type { WorldsSeams } from '../src/scene/worlds/seams'

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
const SWATCHES = decodeSwatches(bufferOf(resolve(ROOT, 'swatches.bin')))
const WORLDS = worldPlanesOf(PLANES.planes)

const NO_SEAMS: WorldsSeams = {
  swatchMean: false,
  bandsShuffle: false,
  artThresholdFixed24: false,
  layersRequested: null,
}

const bySlug = (slug: string) => WORLDS.find((w) => w.slug === slug)!

/**
 * A `Stars` carrying exactly the five members `buildWorldSource` reads, and nothing else.
 *
 * A double is only used where the shipped bytes *cannot* express the case — here, a cell centre
 * placed adversarially between two row classifiers. Everything else in this file runs on the real
 * file, because the builder's job is agreeing with the emitter and a double agrees with whoever
 * wrote it. The positions are doubles rather than float16 round-trips on purpose: the point is the
 * classifier's decision boundary, not the decode's error, and quantising would blunt it.
 */
function fakeStars(normals: ReadonlyArray<readonly [number, number, number]>): Stars {
  return {
    count: normals.length,
    x: (i: number) => normals[i]![0],
    y: (i: number) => normals[i]![1],
    z: (i: number) => normals[i]![2],
    hueClass: () => 0,
  } as unknown as Stars
}

function fakeSwatches(count: number): Swatches {
  return {
    count,
    samples: () => new Uint16Array([0, 0, 0, 0]),
    linear: () => [0.5, 0.25, 0.125] as const,
  }
}

describe('§A the roster this file measures', () => {
  it('finds the worlds, and the two artefacts agree on their record count', () => {
    // The denominator, always: "no violations" and "I could not look" must not print the same.
    expect(PLANES.contractVersion).toBe(3)
    expect(PLANES.planes.length).toBe(88)
    expect(WORLDS.length).toBe(45)
    expect(STARS.count).toBe(28_603)
    expect(SWATCHES.count).toBe(STARS.count)
  })

  it('selects by rowCells, not by contract version — 43 planes on this v3 dataset have no grid', () => {
    // §2.4's own wording. The belt and every empty plane are v3 and carry no surface, so a version
    // test would hand 43 gridless planes to a builder whose first act is to read `rowCells.length`.
    const gridless = PLANES.planes.filter((p: PlaneRecord) => !isWorldPlane(p))
    expect(gridless.length).toBe(43)
    expect(gridless.some((p) => p.kind === 'dust')).toBe(true)
  })
})

describe('§B the three derivations §2.1 leaves on the client', () => {
  it('reproduces every published rowCells table exactly, on all 45 worlds', () => {
    // 777 rows across the roster. This is the strongest available statement that the nearest-row
    // match agrees with the emitter that wrote the table.
    let rows = 0
    for (const plane of WORLDS) {
      const source = buildWorldSource(plane, STARS, SWATCHES)
      const counts = new Array<number>(plane.rowCells.length).fill(0)
      for (let cell = 0; cell < source.cardCount; cell += 1) counts[source.rows[cell]!]! += 1
      expect(counts, `${plane.slug} row occupancy`).toEqual([...plane.rowCells])
      rows += plane.rowCells.length
    }
    expect(rows).toBe(777)
  })

  it('pins the row to rowOfUnitY at the call site, against the normal the source published', () => {
    // The row-count row above cannot do this. `floor(theta/dphi)`, `round(theta/dphi - 1/2)` and
    // the y-metric all reproduce all 777 published rows, so an inline classifier written straight
    // into the builder passes every count — and `worlds-surface-law.test.ts` cannot catch it
    // either, because that file tests the *function* and this would be a defect in the *binding*.
    // Same lesson as §1.4's admission height: give the quantity one spelling and assert the call
    // site against it, bit for bit, rather than asserting a consequence both spellings satisfy.
    for (const plane of WORLDS) {
      const source = buildWorldSource(plane, STARS, SWATCHES)
      const rows = plane.rowCells.length
      for (let cell = 0; cell < source.cardCount; cell += 1) {
        expect(source.rows[cell], `${plane.slug} cell ${cell}`).toBe(
          rowOfUnitY(source.normals[cell * 3 + 1]!, rows),
        )
      }
    }
  })

  it('uses the y metric at the call site, on the one input that can tell the two apart', () => {
    // Neither of the two rows above can do this, and the mutation matrix is how that was found:
    // `floor(theta/dphi)`, `round(theta/dphi - 1/2)` and the y metric agree on **every one of the
    // 24,399 shipped cells**, so no assertion over the dataset separates them and a bit-equality
    // pin against `rowOfUnitY` passes for a call site that never calls it.
    //
    // The separating input has to be constructed: a centre nudged just past its row's lower
    // boundary *in theta*, by less than the float16 error the decode can add. Nearest-in-y still
    // calls it row 0; the theta classifier has already handed it to row 1. That is the 3.08x margin
    // §2.1 buys, exercised through `buildWorldSource` rather than through `rowOfUnitY` alone.
    const rows = 81 // Dominaria's row count: the polar margin is the whole safety budget.
    const dphi = rowStep(rows)
    const nudged = Math.cos(rowColatitude(0, rows) + dphi / 2 + 1e-6)
    const thetaClassifier = Math.min(
      rows - 1,
      Math.max(0, Math.round(Math.acos(nudged) / dphi - 0.5)),
    )
    expect(thetaClassifier, 'the double must actually separate the two, or this row is theatre').toBe(1)

    const normals: Array<readonly [number, number, number]> = []
    for (let row = 0; row < rows; row += 1) {
      const y = row === 0 ? nudged : Math.cos(rowColatitude(row, rows))
      normals.push([Math.sqrt(Math.max(0, 1 - y * y)), y, 0])
    }
    const source = buildWorldSource(
      { ...bySlug('alara'), cardCount: rows, starCount: rows, starOffset: 0, rowCells: Array.from({ length: rows }, () => 1) },
      fakeStars(normals),
      fakeSwatches(rows),
    )
    expect(source.rows[0]).toBe(0)
  })

  it('records what the row-count row does NOT discriminate: the metric', () => {
    // §2.1 rejects matching in `theta` in favour of matching in `y` — 3.08x polar margin against
    // 2.31x. Both classify this roster correctly, so the row above cannot tell them apart and would
    // be false documentation if it claimed to. What *is* checkable is the margin itself, which is
    // the thing the choice buys, so that is what this row measures.
    let worstY = Infinity
    let worstTheta = Infinity
    for (const plane of WORLDS) {
      const rows = plane.rowCells.length
      if (rows < 2) continue
      const dphi = rowStep(rows)
      for (let row = 0; row + 1 < rows; row += 1) {
        const a = Math.cos(rowColatitude(row, rows))
        const b = Math.cos(rowColatitude(row + 1, rows))
        // Half the gap between two row centres is the error a classifier in that metric survives.
        worstY = Math.min(worstY, Math.abs(a - b) / 2)
        worstTheta = Math.min(worstTheta, Math.abs(a - Math.cos(rowColatitude(row, rows) + dphi / 2)))
      }
    }
    // float16 round-trip error on [0.5, 1) is 2^-12 = 2.44e-4 (§2.1).
    const float16Error = 2 ** -12
    expect(worstY / float16Error).toBeGreaterThan(3)
    expect(worstTheta / float16Error).toBeLessThan(worstY / float16Error)
  })

  it('normalises the float16 centre, and the normalisation is doing work', () => {
    // The negative control for the normalise step: if the shipped centres were already unit to
    // float64, dividing by |p| would be decoration and this row would be measuring nothing.
    let worstRaw = 0
    let worstNormalised = 0
    for (const plane of WORLDS) {
      const source = buildWorldSource(plane, STARS, SWATCHES)
      for (let cell = 0; cell < source.cardCount; cell += 1) {
        const star = plane.starOffset + cell
        const x = STARS.x(star)
        const y = STARS.y(star)
        const z = STARS.z(star)
        worstRaw = Math.max(worstRaw, Math.abs(Math.sqrt(x * x + y * y + z * z) - 1))
        const nx = source.normals[cell * 3]!
        const ny = source.normals[cell * 3 + 1]!
        const nz = source.normals[cell * 3 + 2]!
        worstNormalised = Math.max(
          worstNormalised,
          Math.abs(Math.sqrt(nx * nx + ny * ny + nz * nz) - 1),
        )
      }
    }
    expect(worstRaw).toBeGreaterThan(1e-4)
    // Float32Array storage, so the residual is the attribute's own precision and not the file's.
    expect(worstNormalised).toBeLessThan(1e-6)
  })

  it('sums rowCells to cardCount and fills every cell', () => {
    for (const plane of WORLDS) {
      const sum = plane.rowCells.reduce((a, b) => a + b, 0)
      expect(sum, `${plane.slug} sum(rowCells)`).toBe(plane.cardCount)
      expect(Math.min(...plane.rowCells), `${plane.slug} rowCells[r] >= 1`).toBeGreaterThanOrEqual(1)
    }
  })

  it('builds a seven-bucket hue histogram that matches planes.json’s own palette', () => {
    // Summing to `cardCount` is not enough and the matrix proved it: indexing the buckets by
    // `colourIdentity % 7` instead of `hueClass` also accounts for every card, and it draws every
    // band at the wrong latitude — §1.3's boundaries come straight off this histogram, so the
    // failure is a world whose colours are laid out plausibly and wrongly.
    //
    // `palette` (PRD 5.3.5) is the same seven weights written by the pipeline into a *different
    // artefact*, so checking one against the other is a genuine cross-check rather than a
    // restatement: it agrees to 5e-5 across the roster, which is `palette`'s four-decimal emission.
    for (const plane of WORLDS) {
      const source = buildWorldSource(plane, STARS, SWATCHES)
      expect(source.hueCounts.length).toBe(7)
      expect(source.hueCounts.reduce((a, b) => a + b, 0), `${plane.slug}`).toBe(plane.cardCount)
      for (let hue = 0; hue < 7; hue += 1) {
        expect(
          Math.abs(source.hueCounts[hue]! / plane.cardCount - plane.palette[hue]!),
          `${plane.slug} hue ${hue}`,
        ).toBeLessThan(1e-4)
      }
    }
  })
})

describe('§C the 2x2 swatch, reduced to iSwatch', () => {
  const linearMean = (star: number): [number, number, number] => {
    let r = 0
    let g = 0
    let b = 0
    for (const corner of [0, 1, 2, 3] as const) {
      const s = SWATCHES.linear(star, corner)
      r += s[0]
      g += s[1]
      b += s[2]
    }
    return [r / 4, g / 4, b / 4]
  }

  it('is the mean of the four corners in linear light, bit for bit', () => {
    const plane = bySlug('alara')
    const source = buildWorldSource(plane, STARS, SWATCHES)
    for (let card = 0; card < plane.cardCount; card += 1) {
      const expected = linearMean(plane.starOffset + card)
      // Float32Array storage, so compare against the same narrowing rather than to the double.
      expect(source.swatches[card * 3]).toBe(Math.fround(expected[0]))
      expect(source.swatches[card * 3 + 1]).toBe(Math.fround(expected[1]))
      expect(source.swatches[card * 3 + 2]).toBe(Math.fround(expected[2]))
    }
  })

  it('kills the convexity mutant: averaging the encoded values first is wrong by up to 0.10', () => {
    // sRGB's transfer function is convex, so mean(f(x)) != f(mean(x)) on a high-contrast 2x2 — and
    // an art crop is frequently high-contrast. This is the mutant that draws a correct-looking
    // picture: every world simply comes out duller than its art.
    const from5 = (v: number) => v / 31
    const from6 = (v: number) => v / 63
    const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    let worst = 0
    let total = 0
    let channels = 0
    for (const plane of WORLDS) {
      for (let card = 0; card < plane.cardCount; card += 1) {
        const star = plane.starOffset + card
        const packed = SWATCHES.samples(star)
        const encoded: [number, number, number] = [0, 0, 0]
        for (const value of packed) {
          encoded[0] += from5(value >> 11)
          encoded[1] += from6((value >> 5) & 0x3f)
          encoded[2] += from5(value & 0x1f)
        }
        const right = linearMean(star)
        for (let ch = 0; ch < 3; ch += 1) {
          const wrong = toLinear(encoded[ch]! / 4)
          const delta = Math.abs(right[ch]! - wrong)
          worst = Math.max(worst, delta)
          total += delta
          channels += 1
        }
      }
    }
    expect(channels).toBe(24_399 * 3)
    expect(worst).toBeGreaterThan(0.1)
    expect(total / channels).toBeGreaterThan(0.005)
  })

  it('leaves the palette varied, so ?swatch=mean still has something to collapse', () => {
    // The source must not pre-apply the seam. A constant array is its own mean, so a source that
    // collapsed the palette here would turn the gate's W2 control green while doing nothing.
    const source = buildWorldSource(bySlug('alara'), STARS, SWATCHES)
    const distinct = new Set<string>()
    for (let card = 0; card < source.cardCount; card += 1) {
      distinct.add(
        `${source.swatches[card * 3]},${source.swatches[card * 3 + 1]},${source.swatches[card * 3 + 2]}`,
      )
    }
    expect(distinct.size).toBeGreaterThan(source.cardCount / 2)
  })
})

describe('§D the radius is §1.3’s law, not the shipped field', () => {
  it('agrees with the emitter on all 45 worlds, and is pinned to the law rather than to the field', () => {
    // The two assertions are doing different jobs, and it is worth saying which is which.
    //
    // The second is the conformance check: leg P emits `plane.radius` from this same formula, so
    // the law and the field agree across the roster — worst gap 4.7e-7, which is the field's
    // six-decimal emission and nothing else. What that derivation protects against is historical
    // and measured: `dabe2c9a` — still the `active` dataset the deployed app fetches — carries the
    // old `log N` law, where the same six one-card worlds sit at r 3.605 against this law's 0.55,
    // a 6.55x difference (§1.3).
    //
    // The first is the control, and the mutation matrix is what established that it *is* one: it is
    // exact equality, so substituting `plane.radius` at the call site goes RED on that same 4.7e-7.
    // The discrimination comes from the field's emitted precision rather than from the law, which
    // is a thinner reason than it looks — an emitter that one day writes full doubles would take
    // this control with it silently. Recorded so that the next reader knows what is holding it up.
    for (const plane of WORLDS) {
      const source = buildWorldSource(plane, STARS, SWATCHES)
      expect(source.radius).toBe(worldRadius(plane.cardCount))
      expect(Math.abs(source.radius - plane.radius), `${plane.slug}`).toBeLessThan(1e-5)
    }
  })

  it('carries §1.3’s floor, which binds on 15 of the 45', () => {
    const floored = WORLDS.filter((p) => 0.126 * Math.sqrt(p.cardCount) < 0.55)
    expect(floored.length).toBe(15)
    for (const plane of floored) expect(worldRadius(plane.cardCount)).toBe(0.55)
  })
})

describe('§E the guards, each of which has a plausible-picture failure mode', () => {
  const plane = () => ({ ...bySlug('alara') })

  it('refuses a starCount that disagrees with cardCount', () => {
    expect(() => buildWorldSource({ ...plane(), starCount: 509 }, STARS, SWATCHES)).toThrow(
      /starCount 509 != cardCount 510/,
    )
  })

  it('refuses a star range outside the file', () => {
    expect(() =>
      buildWorldSource({ ...plane(), starOffset: STARS.count - 1 }, STARS, SWATCHES),
    ).toThrow(/outside stars.bin/)
  })

  it('refuses a swatches.bin from a different run', () => {
    const shorter = { ...SWATCHES, count: SWATCHES.count - 1 }
    expect(() => buildWorldSource(plane(), STARS, shorter)).toThrow(/star order is the swatch/)
  })
})

describe('§F end to end: the composition, from the shipped dataset', () => {
  it('builds a WorldSurface and runs a frame — the path that made worlds() undefined', () => {
    const plane = bySlug('alara')
    const source = buildWorldSource(plane, STARS, SWATCHES)
    const surface = new WorldSurface(source, {
      seams: NO_SEAMS,
      pool: new ArtPool(224),
      threshold: new AdaptiveThreshold(true),
      stream: null,
      artTexture: null,
    })
    expect(surface.sheet.geometry.instanceCount).toBe(plane.cardCount)
    surface.dispose()
  })

  it('?swatch=mean collapses the palette the source supplied', () => {
    const source = buildWorldSource(bySlug('alara'), STARS, SWATCHES)
    const surface = new WorldSurface(source, {
      seams: { ...NO_SEAMS, swatchMean: true },
      pool: new ArtPool(224),
      threshold: new AdaptiveThreshold(true),
      stream: null,
      artTexture: null,
    })
    const drawn = surface.sheet.geometry.getAttribute('iSwatch').array as Float32Array
    const first: [number, number, number] = [drawn[0]!, drawn[1]!, drawn[2]!]
    for (let cell = 1; cell < source.cardCount; cell += 1) {
      expect(drawn[cell * 3]).toBe(first[0])
      expect(drawn[cell * 3 + 1]).toBe(first[1])
      expect(drawn[cell * 3 + 2]).toBe(first[2])
    }
    // And it is the world's own mean, not black or a constant: the collapse must be a measurement.
    expect(first[0] + first[1] + first[2]).toBeGreaterThan(0)
    surface.dispose()
  })
})
