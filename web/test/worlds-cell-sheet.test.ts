/**
 * The cell sheet's GPU surface (spec §1.4): the instanced geometry, the material, and the GLSL.
 *
 * **What this file can and cannot see.** The geometry and the material are three.js objects with no
 * GL context behind them, so everything structural below is a real measurement: attribute layout,
 * instance count, index buffer, bounding sphere, render state. The *shader* is a string here — no
 * GPU compiles it in CI — so its assertions are source pins, and they are marked as such. A source
 * pin catches the "tidy" rewrite this section keeps warning about; it does not catch a shader that
 * is wrong in a way the text still reads correctly. The one shader claim that is measured rather
 * than pinned is the placement law, and it is measured through `probePayload.cellGridPoint`, which
 * is the CPU mirror the probe already has to agree with.
 *
 * Measured against the **shipped** roster, resolved by role, for the reason
 * `worlds-surface-law.test.ts` gives at length: `rowCells` is not a function of `cardCount`, so a
 * test that reconstructs a table is testing a form the renderer is forbidden to use.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type BufferAttribute, DynamicDrawUsage, FrontSide, Vector3 } from 'three'

import { CELL_INSTANCE_BYTES, buildCellSheet } from '../src/scene/worlds/cellSheet'
import { createCellMaterial } from '../src/scene/worlds/cellMaterial'
import {
  CELL_FRAGMENT_SHADER,
  CELL_VERTEX_SHADER,
  SIN_THETA_FLOOR,
} from '../src/scene/worlds/cellShaders'
import { buildCellIndices, subdivisionFor } from '../src/scene/worlds/cellGeometry'
import {
  CELL_INSET,
  CELL_LIFT,
  cellDrawAngles,
  cellHalfAngles,
  cellSizeArc,
  drawRadius,
  rowColatitude,
  worldRadius,
} from '../src/scene/worlds/surfaceLaw'
import { cellGridPoint } from '../src/scene/worlds/probePayload'
import { LAYER_FREE } from '../src/scene/worlds/artPool'
import { SHADER_NAME_WORLD_CELL } from '../src/scene/shaderNames'

interface Plane {
  readonly slug: string
  readonly cardCount?: number
  readonly rowCells?: number[]
}

const DATA = resolve(__dirname, '../public/data')

function planesFor(role: string): Plane[] {
  const datasets = JSON.parse(
    readFileSync(resolve(__dirname, '../datasets.json'), 'utf8'),
  ) as Record<string, string>
  const file = JSON.parse(readFileSync(resolve(DATA, datasets[role]!, 'planes.json'), 'utf8')) as {
    planes: Plane[]
  }
  return file.planes
}

const WORLDS = planesFor('worlds').filter(
  (p): p is Plane & { rowCells: number[]; cardCount: number } => Array.isArray(p.rowCells),
)
const bySlug = (slug: string) => WORLDS.find((w) => w.slug === slug)!

/**
 * A sheet for a shipped world, with synthetic centres.
 *
 * The centres are synthesised rather than decoded because `stars.bin`'s cell positions are leg P's
 * artefact and this file is about what the sheet does with them, not about the decode: the row
 * assignment is what `iSize` reads, and it is passed in directly. `worlds-surface-law.test.ts`
 * measures the decode against the shipped bytes.
 */
function sheetFor(world: Plane & { rowCells: number[]; cardCount: number }) {
  const { rowCells, cardCount } = world
  const normals = new Float32Array(cardCount * 3)
  const rows = new Int32Array(cardCount)
  let cell = 0
  for (let row = 0; row < rowCells.length; row += 1) {
    const theta = rowColatitude(row, rowCells.length)
    for (let column = 0; column < rowCells[row]!; column += 1) {
      const lambda = (column / rowCells[row]!) * 2 * Math.PI - Math.PI
      normals[cell * 3] = Math.sin(theta) * Math.sin(lambda)
      normals[cell * 3 + 1] = Math.cos(theta)
      normals[cell * 3 + 2] = Math.sin(theta) * Math.cos(lambda)
      rows[cell] = row
      cell += 1
    }
  }
  expect(cell, `${world.slug} rowCells must sum to cardCount`).toBe(cardCount)
  return buildCellSheet({
    cardCount,
    rowCells,
    normals,
    rows,
    swatches: new Float32Array(cardCount * 3).fill(0.5),
    radius: worldRadius(cardCount),
  })
}

describe('§1.4 the sheet is one instance per card, at every subdivision', () => {
  it('finds the worlds it is supposed to measure', () => {
    // The denominator, always: "no violations" and "I could not look" must not print the same.
    expect(WORLDS.length).toBe(45)
  })

  it('keeps instanceCount at cardCount while the base grid moves under it', () => {
    // §3.1's normative claim. The negative control is the second expectation: if every world on the
    // roster subdivided to the same `k`, the invariance would hold for free and this test would be
    // measuring nothing. Dominaria is at (1, 1) — 6,271 cells, one quad each — and the smallest
    // world on the roster is not, so the base grid genuinely differs between the two rows.
    const grids = new Set<number>()
    for (const world of WORLDS) {
      const sheet = sheetFor(world)
      expect(sheet.geometry.instanceCount, world.slug).toBe(world.cardCount)
      expect(sheet.geometry.getAttribute('iNormal').count, world.slug).toBe(world.cardCount)
      grids.add(sheet.geometry.getAttribute('aCell').count)
    }
    expect(grids.size, 'the roster must span more than one subdivision, or this proves nothing')
      .toBeGreaterThan(1)
  })

  it('carries the index buffer cellGeometry wound, unreordered', () => {
    // The winding rule is asserted on `buildCellIndices` in `worlds-surface-law.test.ts`; what is
    // new here is that the sheet does not quietly renumber it on the way into the geometry.
    const world = bySlug('dominaria')
    const sheet = sheetFor(world)
    expect(Array.from(sheet.geometry.getIndex()!.array)).toEqual(
      Array.from(buildCellIndices(subdivisionFor(world.rowCells))),
    )
  })
})

describe('§1.4 every vertex sits on the lifted sphere', () => {
  it('places the four corners of a polar cell at exactly the drawn radius', () => {
    // The claim the subdivision exists to make, and the one that falsifies a tangent-plane
    // implementation outright: a flat quad's corner sits at sqrt(lift^2 + a^2 + b^2), which on
    // Dominaria's polar row is 0.7% off and at N = 1 is 265% off. Measured through
    // `cellGridPoint`, the CPU mirror the probe is required to agree with.
    const world = bySlug('dominaria')
    const radius = drawRadius(worldRadius(world.cardCount))
    const angles = cellDrawAngles(world.rowCells, 0)
    const theta = rowColatitude(0, world.rowCells.length)
    for (const u of [-1, 0, 1]) {
      for (const v of [-1, 0, 1]) {
        const p = cellGridPoint(theta, 0.4, angles.lon, angles.lat, u, v)
        expect(p.length() * radius).toBeCloseTo(radius, 10)
      }
    }
  })

  it('insets the angle, so the probe bounds 93% of the cell and not 100%', () => {
    // The 7.5% the probe over-reports if a caller passes `cellHalfAngles` instead. It lands on W1's
    // pixel floor and on §1.11's 24 px proxy, and it never shows up as a wrong picture.
    const world = bySlug('dominaria')
    const nominal = cellHalfAngles(world.rowCells, 0)
    const drawn = cellDrawAngles(world.rowCells, 0)
    expect(drawn.lon / nominal.lon).toBeCloseTo(CELL_INSET, 12)
    expect(drawn.lat / nominal.lat).toBeCloseTo(CELL_INSET, 12)
    expect(nominal.lon / drawn.lon).toBeCloseTo(1.0752688, 6)
  })

  it('lifts the radius, so the probe is not 0.6% short', () => {
    expect(drawRadius(1)).toBeCloseTo(CELL_LIFT, 12)
  })
})

describe('§2.1 iSize is arc length, and the shader divides sin(theta_r) back out', () => {
  it('writes the sin(theta_r) factor into every polar cell', () => {
    // Dropping it draws Dominaria's polar row 51.6x too wide; the shader dropping the inverse draws
    // it 51.6x too narrow. Both are silent near the equator, where the factor is ~1 — which is why
    // this is measured on row 0 and checked for a ratio far from 1.
    const world = bySlug('dominaria')
    const sheet = sheetFor(world)
    const size = sheet.geometry.getAttribute('iSize')
    const arc = cellSizeArc(world.rowCells, 0)
    // 8 places, not 12: `iSize` is a Float32Array, so the attribute carries ~7 significant digits
    // and a tighter bound would be measuring the storage rather than the law. The failure this
    // guards against is a factor of 51.6, which is 11 orders of magnitude clear of the bound.
    expect(size.getX(0)).toBeCloseTo(arc.lon, 8)
    expect(size.getY(0)).toBeCloseTo(arc.lat, 8)

    const ratio = cellHalfAngles(world.rowCells, 0).lon / arc.lon
    expect(ratio, 'row 0 must be far enough from the equator for this to bind').toBeGreaterThan(20)
  })

  it('recovers the angle from the normal, not from a second attribute', () => {
    // A SOURCE PIN (see this file's header). `length(n.xz)` is sin(theta) for a unit normal, so the
    // shader's divisor and the attribute's multiplier are the same number by construction and cannot
    // drift. A shader that carried sin(theta) as its own attribute could.
    expect(CELL_VERTEX_SHADER).toContain('length(n.xz)')
    expect(CELL_VERTEX_SHADER).toContain('iSize.x / sinTheta')
    expect(SIN_THETA_FLOOR).toBeLessThan(0.0224)
  })

  it('no longer ships iEast, and the byte budget says so', () => {
    // §1.4's 52 bytes counted a tangent basis the sphere-following grid derives instead. The budget
    // is PROVED from the geometry rather than restated: a re-added attribute moves both sides.
    const sheet = sheetFor(bySlug('dominaria'))
    const names = ['iNormal', 'iSize', 'iSwatch', 'iLayer', 'iArt']
    expect(Object.keys(sheet.geometry.attributes).sort()).toEqual([...names, 'aCell'].sort())
    const bytes = names.reduce((n, key) => n + sheet.geometry.getAttribute(key).itemSize * 4, 0)
    expect(bytes).toBe(CELL_INSTANCE_BYTES)

    const rosterCells = WORLDS.reduce((n, w) => n + w.cardCount, 0)
    expect(rosterCells).toBe(24399)
    expect(rosterCells * CELL_INSTANCE_BYTES).toBe(975960)
    expect((rosterCells * CELL_INSTANCE_BYTES) / 1024 / 1024).toBeCloseTo(0.931, 3)
  })
})

describe('§1.4 the sheet is bounded by the sphere it draws onto', () => {
  it('sets boundingSphere by hand, because there is no position attribute to compute it from', () => {
    // Both halves matter. Without the explicit sphere three computes one lazily on first frustum
    // test — and this geometry has no `position`, so what it would compute is not the world's
    // extent. `aCell` spans [-1, 1]^2 whatever the radius is, so a world 40 units across would be
    // culled by a unit box the moment it left the centre of the view.
    const world = bySlug('dominaria')
    const sheet = sheetFor(world)
    expect(sheet.geometry.attributes.position).toBeUndefined()
    expect(sheet.geometry.boundingSphere).not.toBeNull()
    expect(sheet.geometry.boundingSphere!.radius).toBeCloseTo(
      drawRadius(worldRadius(world.cardCount)),
      12,
    )
    expect(sheet.geometry.boundingSphere!.center.equals(new Vector3(0, 0, 0))).toBe(true)
  })
})

describe('§1.6 the two attributes the art stream writes', () => {
  it('starts every cell on its swatch, with no layer claimed', () => {
    const sheet = sheetFor(bySlug('dominaria'))
    expect(new Set(Array.from(sheet.layers.array))).toEqual(new Set([LAYER_FREE]))
    expect(new Set(Array.from(sheet.art.array))).toEqual(new Set([0]))
  })

  it('marks only those two dynamic', () => {
    // A static `iArt` is uploaded once and every cross-fade after the first frame is dropped, which
    // reads as art that never arrives rather than as an error.
    const sheet = sheetFor(bySlug('dominaria'))
    expect(sheet.layers.usage).toBe(DynamicDrawUsage)
    expect(sheet.art.usage).toBe(DynamicDrawUsage)
    expect((sheet.geometry.attributes.iSwatch as BufferAttribute).usage).not.toBe(DynamicDrawUsage)
  })
})

describe('§1.4 the material', () => {
  it('is named, so its program can be attributed', () => {
    expect(createCellMaterial(1, null).name).toBe(SHADER_NAME_WORLD_CELL)
  })

  it('keeps back-face culling on, because the winding rule depends on it', () => {
    // DoubleSide here would hide an inverted index order exactly as well as the inverted order hides
    // itself. The cull and the winding are one contract.
    const material = createCellMaterial(1, null)
    expect(material.side).toBe(FrontSide)
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.depthTest).toBe(true)
  })

  it('accepts a null art pool — a swatch-only world is legal (§1.6)', () => {
    const material = createCellMaterial(2.5, null)
    expect(material.uniforms.uArt!.value).toBeNull()
    expect(material.uniforms.uRadius!.value).toBe(2.5)
  })
})

describe('§1.4 the shading law, as source pins', () => {
  it('shades the swatch and leaves the art alone', () => {
    // A SOURCE PIN, and a compliance boundary: the lambert term is a brightness shift, which
    // Scryfall's terms forbid applying to card images. `mix(colour, art, vArt)` takes the art
    // unshaded; `mix(colour, art * shade, vArt)` would be the violation and would look *better*.
    expect(CELL_FRAGMENT_SHADER).toContain('vec3 colour = vSwatch * shade + uAmbient;')
    expect(CELL_FRAGMENT_SHADER).toContain('colour = mix(colour, art, vArt);')
    expect(CELL_FRAGMENT_SHADER).not.toMatch(/art\s*\*\s*shade|shade\s*\*\s*art/)
  })

  it('wraps the lambert and squares after the clamp', () => {
    expect(CELL_FRAGMENT_SHADER).toContain('clamp(lambert * 0.5 + 0.5, 0.0, 1.0)')
    expect(CELL_FRAGMENT_SHADER).toContain('SHADE_AMBIENT + SHADE_GAIN * shade * shade')
  })

  it('flips V in the sampler, because a DataArrayTexture ignores UNPACK_FLIP_Y_WEBGL', () => {
    expect(CELL_FRAGMENT_SHADER).toContain('vec3(vUv.x, 1.0 - vUv.y, vLayer)')
  })

  it('writes its constants from the TypeScript ones, so there is no second copy', () => {
    // The whole point of the `#define` block. A literal 0.93 in the GLSL would drift from
    // `cellDrawAngles` silently, and the drift would only be visible as a 7.5% disagreement between
    // the picture and the probe.
    expect(CELL_VERTEX_SHADER).toContain(`#define CELL_INSET ${CELL_INSET}`)
    expect(CELL_VERTEX_SHADER).toContain(`#define CELL_LIFT ${CELL_LIFT}`)
    expect(CELL_VERTEX_SHADER).toContain('aCell.y * latAngle * CELL_INSET')
    expect(CELL_VERTEX_SHADER).toContain('aCell.x * lonAngle * CELL_INSET')
  })

  it('shades from the centre normal, so the probe’s shade is the picture', () => {
    // vNormal = n, not the vertex's own direction. A smooth normal would make `probePayload.shadeOf`
    // an approximation of the frame rather than a statement about it, and W2's iso-shade subset
    // would stop being a subset of anything.
    expect(CELL_VERTEX_SHADER).toMatch(/vNormal = n;/)
  })
})
