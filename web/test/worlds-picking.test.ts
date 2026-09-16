/**
 * §1.11's picking, against the shipped roster (DEC-751).
 *
 * The one structural claim this file exists to defend: **a cell's pick id is multiverse-wide**.
 * §1.11's prose says the sheet renders `gl_InstanceID + 1`, and that is per-sheet — §1.2 keeps all
 * 45 sheets resident at once, so under instance ids every world's cell *n* writes the same pixel
 * value and the id buffer, which carries no record of which mesh wrote it, cannot tell them apart.
 * The shipped id is `artKeyBase + cardOfCell[cell]`, the card's star index, and the `no two cells
 * anywhere share an id` test below is what makes a regression to instance ids impossible to land
 * quietly. It is worth stating that the regression is *otherwise silent*: an instance id is a
 * perfectly valid star index, so the picker resolves it, the consumer focuses a real card, and
 * nothing anywhere reports an error — the wrong card simply opens.
 *
 * No GPU. The GLSL is covered here only for the two gates whose absence is silent (see the last
 * describe); what the shader *draws* is `e2e/`'s subject.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene, type WebGLRenderer } from 'three'

import { decodeStars, decodeSwatches } from '../src/data/decode'
import { type PlanesFile } from '../src/data/types'
import { ArtPool } from '../src/scene/worlds/artPool'
import { AdaptiveThreshold } from '../src/scene/worlds/adaptiveThreshold'
import { CELL_FRAGMENT_SHADER, CELL_VERTEX_SHADER } from '../src/scene/worlds/cellShaders'
import { IdPicker } from '../src/scene/picking/idPicker'
import { resolvePick } from '../src/scene/picking/scenePicker'
import { WorldSurface } from '../src/scene/worlds/worldSurface'
import { buildWorldSource, worldPlanesOf } from '../src/scene/worlds/worldSource'
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
  artOff: false,
  artThresholdFixed24: false,
  layersRequested: null,
}

function surfaceFor(slug: string, seams: WorldsSeams = NO_SEAMS): WorldSurface {
  const plane = WORLDS.find((w) => w.slug === slug)
  if (!plane) throw new Error(`no world ${slug} on the roster`)
  return new WorldSurface(buildWorldSource(plane, STARS, SWATCHES), {
    seams,
    pool: new ArtPool(0),
    threshold: new AdaptiveThreshold(),
    stream: null,
    artTexture: null,
  })
}

/** The `iStar` attribute a surface's sheet carries, as a plain array. */
function starsOf(surface: WorldSurface): Float32Array {
  return surface.sheet.geometry.getAttribute('iStar').array as Float32Array
}

describe("§1.11 a cell's pick id names its card, multiverse-wide", () => {
  it('finds the roster it is supposed to measure', () => {
    expect(WORLDS.length).toBe(45)
  })

  it('carries artKeyBase + cardOfCell[cell], not the cell index', () => {
    const surface = surfaceFor('dominaria')
    const stars = starsOf(surface)
    const base = surface.artKeyBase

    expect(stars).toHaveLength(surface.cardOfCell.length)
    for (let cell = 0; cell < stars.length; cell += 1) {
      expect(stars[cell]).toBe(base + surface.cardOfCell[cell]!)
    }
    // The base is what makes this a multiverse-wide name, so pin that it is not zero on a world
    // that is not first in the file. Without this row the assertion above is satisfied by the cell
    // index on the one world where `artKeyBase` happens to be 0.
    expect(base).toBeGreaterThan(0)
    expect(stars[0]).not.toBe(0)
  })

  it('follows the CARD under ?bands=shuffle, not the cell', () => {
    // The seam permutes which card a cell draws. A pick id built from the cell index would be
    // unchanged by it, so the page would draw one card and focus another — and only under a
    // control seam that nothing else on the page reacts to.
    const shuffled = surfaceFor('dominaria', { ...NO_SEAMS, bandsShuffle: true })
    const stars = starsOf(shuffled)
    const base = shuffled.artKeyBase

    for (let cell = 0; cell < stars.length; cell += 1) {
      expect(stars[cell]).toBe(base + shuffled.cardOfCell[cell]!)
    }

    // ...and the permutation is real, so the row above is not the identity in disguise.
    const plain = starsOf(surfaceFor('dominaria'))
    expect(Array.from(stars)).not.toEqual(Array.from(plain))
    // A permutation, though: the same multiset of cards, each exactly once.
    expect(Array.from(stars).sort((a, b) => a - b)).toEqual(
      Array.from(plain).sort((a, b) => a - b),
    )
  })

  it('gives no two cells anywhere on the roster the same id', () => {
    // THE test. Under `gl_InstanceID` this fails with 45 sheets numbering from 0; under
    // `artKeyBase + card` every cell on the roster is distinct because star order is the
    // multiverse's own identity (§2.2).
    const seen = new Set<number>()
    let cells = 0
    for (const plane of WORLDS) {
      const surface = surfaceFor(plane.slug)
      for (const star of starsOf(surface)) seen.add(star)
      cells += surface.cardOfCell.length
      surface.dispose()
    }
    expect(cells).toBe(24399)
    expect(seen.size).toBe(cells)
  })

  it('stays exact as a float32 across the whole roster', () => {
    // A float32 holds every integer below 2^24 exactly; the multiverse has 28,587 stars. This is
    // the row that would catch a dataset growing past the mantissa — at which point the ids would
    // start rounding to even and two cells would quietly share one.
    for (const plane of WORLDS) {
      const surface = surfaceFor(plane.slug)
      for (const star of starsOf(surface)) expect(Number.isInteger(star)).toBe(true)
      expect(surface.artKeyBase + surface.cardOfCell.length).toBeLessThan(2 ** 24)
      surface.dispose()
    }
  })
})

describe('§1.11 a picked cell arrives as its star, through the shipped decoder', () => {
  /**
   * The shader's own encoding, spelled as `cellShaders.ts` spells it — `mod`/`floor` arithmetic
   * over 256, not the bit shifts `picking.test.ts` uses.
   *
   * That difference is the point rather than an inconsistency: the two files are independent
   * spellings of the same 24-bit little-endian byte order, so a test that writes with this one and
   * reads through the real `IdPicker` proves the shader and the shipped decoder agree. Writing with
   * the decoder's own arithmetic would prove only that a function inverts itself.
   */
  function encodeAsShader(id: number): [number, number, number] {
    const v = id + 1
    return [
      Math.round((v % 256) / 255 * 255),
      Math.round((Math.floor(v / 256) % 256) / 255 * 255),
      Math.round(Math.floor(v / 65536) / 255 * 255),
    ]
  }

  function pickerReading(id: number): Promise<number> {
    const picker = new IdPicker()
    const [r, g, b] = encodeAsShader(id)
    const renderer = {
      domElement: { width: 1920, height: 1080 },
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: (target: unknown) => target,
      setClearColor: () => {},
      setRenderTarget: () => {},
      clear: () => {},
      render: () => {},
      readRenderTargetPixelsAsync: (
        _t: unknown,
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        pixels: Uint8Array,
      ) => {
        pixels.fill(0)
        // The centre pixel of the 11x11 window.
        const offset = (5 * 11 + 5) * 4
        pixels[offset] = r
        pixels[offset + 1] = g
        pixels[offset + 2] = b
        pixels[offset + 3] = 255
        return Promise.resolve()
      },
    } as unknown as WebGLRenderer
    return picker.pick(renderer, new Scene(), new PerspectiveCamera(), 100, 100)
  }

  it('round-trips every id the roster can produce', async () => {
    const ids = [0, 1, 255, 256, 257, 65535, 65536, 65537, 24398, 28586]
    for (const id of ids) {
      expect(await pickerReading(id), `id ${id}`).toBe(id)
    }
  })

  it("round-trips each world's first and last cell", async () => {
    for (const plane of WORLDS) {
      const surface = surfaceFor(plane.slug)
      const stars = starsOf(surface)
      const first = stars[0]!
      const last = stars[stars.length - 1]!
      expect(await pickerReading(first), `${plane.slug} first`).toBe(first)
      expect(await pickerReading(last), `${plane.slug} last`).toBe(last)
      surface.dispose()
    }
  })

  it('resolves as a star, so card focus needs no branch (§1.11 parity)', () => {
    // "Cell picking replaces star picking at plane level; card focus and the printing ring pick as
    // they do today." That sentence is only free if a cell's id lands in the star id space — which
    // is the second reason the id is `artKeyBase + card` rather than an instance index.
    const surface = surfaceFor('dominaria')
    const star = starsOf(surface)[7]!
    const planeRowOf = (index: number): number => (index === star ? 3 : -1)
    const pickPlane = (): number => {
      throw new Error('a cell hit must not fall through to the plane raycast')
    }

    expect(resolvePick(star, STARS.count, planeRowOf, pickPlane)).toEqual({
      kind: 'star',
      index: star,
      planeIndex: 3,
    })
    surface.dispose()
  })
})

describe('§1.11 the pick pass is the draw pass with ID_PASS', () => {
  it('writes an id only under ID_PASS, and a colour only without it', () => {
    // Both halves matter and they fail in opposite directions: a fragment shader that wrote
    // `vIdColour` unconditionally would paint flat id colours over the worlds, and one that never
    // wrote it would make the pick target uniformly empty — every world unpickable, picture intact.
    expect(CELL_FRAGMENT_SHADER).toContain('#ifdef ID_PASS')
    expect(CELL_FRAGMENT_SHADER).toContain('gl_FragColor = vec4(vIdColour, 1.0);')
    expect(CELL_FRAGMENT_SHADER).toContain('#else')
    expect(CELL_FRAGMENT_SHADER).toContain('gl_FragColor = vec4(colour, 1.0);')
  })

  it('gates the id on the filter, per PRD 5.8.3', () => {
    // A dimmed card does not respond to hover and is not focusable. `discard`, not a colour: a
    // filtered cell that wrote *anything* would still lay down depth in the pick target and
    // occlude the cell behind it, so filtering one card would silently remove its neighbour's
    // pick target too.
    expect(CELL_FRAGMENT_SHADER).toContain('if (vFiltered > 0.5) discard;')
  })

  it('encodes from iStar rather than from gl_InstanceID', () => {
    // The whole subject of this file. `gl_InstanceID` must not appear at all — see the header.
    expect(CELL_VERTEX_SHADER).toContain('float id = iStar + 1.0;')
    expect(CELL_VERTEX_SHADER).not.toContain('gl_InstanceID')
  })
})
