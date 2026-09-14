/**
 * World composition (spec §1.4–§1.6): the object that holds a world's parts and runs a frame.
 *
 * **What this file can see.** `WorldSurface` builds three.js objects but its per-frame body touches
 * no GL, so every assertion below is a real measurement of the shipped code path rather than a
 * source pin: the crossover, the demand pass, the admission rule, the art fade and the two control
 * seams all run here exactly as they run in a browser. What it cannot see is the *picture* — the
 * shader is a string in CI — so where a claim is about pixels it is asserted on the attribute the
 * shader reads, and said so.
 *
 * Measured against the **shipped** roster resolved by role, for the reason
 * `worlds-surface-law.test.ts` gives at length: `rowCells` is not a function of `cardCount`, so a
 * test that reconstructs a table is testing a form the renderer is forbidden to use.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'

import { ArtPool, LAYER_FREE } from '../src/scene/worlds/artPool'
import { AdaptiveThreshold, BASE_THRESHOLD_PX } from '../src/scene/worlds/adaptiveThreshold'
import {
  CROSSOVER_HIGH_PX,
  CROSSOVER_LOW_PX,
  EQUIRECT_HEIGHT,
  EQUIRECT_WIDTH,
  TINT_RADIUS_PX,
  cellHeightPx,
  tintMix,
  worldRadiusPx,
} from '../src/scene/worlds/lod'
import { ART_FADE_S, WorldSurface, type WorldFrame } from '../src/scene/worlds/worldSurface'
import { buildWorldsProbe } from '../src/scene/worlds/worldsProbe'
import { bandBoundaries, bandOfCosTheta, cellDrawAngles, drawRadius, rowColatitude, worldRadius } from '../src/scene/worlds/surfaceLaw'
import type { WorldsSeams } from '../src/scene/worlds/seams'

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

type World = Plane & { rowCells: number[]; cardCount: number }

const WORLDS = planesFor('worlds').filter((p): p is World => Array.isArray(p.rowCells))
const bySlug = (slug: string) => WORLDS.find((w) => w.slug === slug)!

const NO_SEAMS: WorldsSeams = {
  swatchMean: false,
  bandsShuffle: false,
  artThresholdFixed24: false,
  layersRequested: null,
}

const CENTRE = new Vector3(0, 0, 0)
const LIGHT = new Vector3(0, 0, 1)

/**
 * Synthetic cell centres on the world's own lattice, and swatches that are all distinct.
 *
 * The centres are synthesised rather than decoded for the reason `worlds-cell-sheet.test.ts` gives:
 * `stars.bin` is leg P's artefact and this file is about what composition does with it. The
 * **swatches are deliberately all different** — a fill would make `?swatch=mean` pass by
 * construction, since a constant array is its own mean.
 */
function sourceFor(world: World) {
  const { rowCells, cardCount } = world
  const normals = new Float32Array(cardCount * 3)
  const rows = new Int32Array(cardCount)
  const swatches = new Float32Array(cardCount * 3)
  let cell = 0
  for (let row = 0; row < rowCells.length; row += 1) {
    const theta = rowColatitude(row, rowCells.length)
    for (let column = 0; column < rowCells[row]!; column += 1) {
      const lambda = (column / rowCells[row]!) * 2 * Math.PI - Math.PI
      normals[cell * 3] = Math.sin(theta) * Math.sin(lambda)
      normals[cell * 3 + 1] = Math.cos(theta)
      normals[cell * 3 + 2] = Math.sin(theta) * Math.cos(lambda)
      rows[cell] = row
      // Distinct per cell and not a ramp in one channel only, so a permutation is detectable
      // whichever channel a reader looks at.
      swatches[cell * 3] = ((cell * 37) % 251) / 251
      swatches[cell * 3 + 1] = ((cell * 53) % 241) / 241
      swatches[cell * 3 + 2] = ((cell * 71) % 239) / 239
      cell += 1
    }
  }
  expect(cell, `${world.slug} rowCells must sum to cardCount`).toBe(cardCount)
  return {
    planeSlug: world.slug,
    cardCount,
    rowCells,
    normals,
    rows,
    swatches,
    hueCounts: [cardCount, 0, 0, 0, 0, 0, 0],
    radius: worldRadius(cardCount),
    centre: CENTRE,
    cardOf: (card: number) => ({ printingId: `p${card}`, imageTs: 1 }),
    // This file composes **one** world at a time, so every base is as good as every other here and
    // nothing below can tell 0 from `starOffset`. The assertion that can is in
    // `worlds-attach.test.ts`, where two worlds share one pool — see `WorldSurfaceSource.artKeyBase`.
    artKeyBase: 0,
  }
}

const VIEWPORT = { width: 1920, height: 1080 }
const FOV = (55 * Math.PI) / 180

/** A camera looking at the origin from `distance` along +z. */
function frameAt(distance: number, deltaSeconds = 0): WorldFrame {
  const camera = new PerspectiveCamera(55, VIEWPORT.width / VIEWPORT.height, 0.1, 10_000)
  camera.position.set(0, 0, distance)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return {
    camera: {
      matrixWorldInverse: camera.matrixWorldInverse,
      projectionMatrix: camera.projectionMatrix,
      position: camera.position,
      near: camera.near,
    },
    viewport: VIEWPORT,
    fovRadians: FOV,
    deltaSeconds,
    lightDirection: LIGHT,
  }
}

/** The centre distance at which a world's cells are `px` tall. Inverts `cellHeightPx`. */
function distanceForCellHeight(world: World, px: number): number {
  const latArc = cellDrawAngles(world.rowCells, 0).lat
  const lifted = drawRadius(worldRadius(world.cardCount))
  return (2 * latArc * lifted * VIEWPORT.height) / (2 * px * Math.tan(FOV / 2))
}

/**
 * A pose stated in world radii, which is the unit §3.1 states W1 and W4 in.
 *
 * Distances derived from a target cell height are not usable as poses: Dominaria's cells are large
 * enough that 40 px of cell height puts the camera at 9.4 units against a 10.0-unit radius — inside
 * the world, where nothing faces the camera and every count reads zero.
 */
function frameAtRadii(world: World, radii: number, deltaSeconds = 0): WorldFrame {
  return frameAt(worldRadius(world.cardCount) * radii, deltaSeconds)
}

/** A camera at the same distance but pointed the other way, so the world is behind the eye. */
function frameLookingAway(world: World, radii: number): WorldFrame {
  const distance = worldRadius(world.cardCount) * radii
  const camera = new PerspectiveCamera(55, VIEWPORT.width / VIEWPORT.height, 0.1, 10_000)
  camera.position.set(0, 0, distance)
  camera.lookAt(0, 0, distance * 2)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return {
    camera: {
      matrixWorldInverse: camera.matrixWorldInverse,
      projectionMatrix: camera.projectionMatrix,
      position: camera.position,
      near: camera.near,
    },
    viewport: VIEWPORT,
    fovRadians: FOV,
    deltaSeconds: 0,
    lightDirection: LIGHT,
  }
}

/**
 * A pool capacity the renderer actually runs at.
 *
 * §1.6's clamp is `max(0, min(tierLayers, maxLayers - 32))`, so on a device at WebGL 2's *spec
 * minimum* `MAX_ARRAY_TEXTURE_LAYERS` of 256 every one of tiers 0-3 lands on 224, and tier 4 — the
 * smallest rung — is 128. **64 is below every shipped configuration**, and that matters here rather
 * than being a detail of the fixture: the adaptive threshold is a quantile taken *relative to
 * capacity*, so an undersized pool raises it, and a raised threshold is what makes §1.6's visibility
 * terms untestable. See the exclusion row below, which measures the whole curve.
 */
const SHIPPED_POOL_LAYERS = 224

function surfaceFor(
  world: World,
  options: { seams?: WorldsSeams; pool?: ArtPool; threshold?: AdaptiveThreshold } = {},
) {
  const pool = options.pool ?? new ArtPool(64)
  const threshold = options.threshold ?? new AdaptiveThreshold(true)
  return new WorldSurface(sourceFor(world), {
    seams: options.seams ?? NO_SEAMS,
    pool,
    threshold,
    stream: null,
    artTexture: null,
  })
}

describe('§1.5 the crossover is a band, and both passes draw inside it', () => {
  it('finds the worlds it is supposed to measure', () => {
    // The denominator, always: "no violations" and "I could not look" must not print the same.
    expect(WORLDS.length).toBe(45)
  })

  it('draws the system instance alone below the band and the sheet alone above it', () => {
    const world = bySlug('dominaria')
    const surface = surfaceFor(world)

    surface.update(frameAt(distanceForCellHeight(world, CROSSOVER_LOW_PX / 2)))
    expect(surface.crossover).toEqual({ drawSystem: true, drawSheet: false, sheetMix: 0 })

    surface.update(frameAt(distanceForCellHeight(world, CROSSOVER_HIGH_PX * 2)))
    expect(surface.crossover).toEqual({ drawSystem: false, drawSheet: true, sheetMix: 1 })
  })

  it('draws BOTH passes inside the band, which is D4 and is what a subtraction gets wrong', () => {
    const world = bySlug('dominaria')
    const surface = surfaceFor(world)
    const mid = (CROSSOVER_LOW_PX + CROSSOVER_HIGH_PX) / 2
    surface.update(frameAt(distanceForCellHeight(world, mid)))

    const state = surface.crossover
    expect(state.drawSystem, 'inside the band a world is in step 2 AND step 4').toBe(true)
    expect(state.drawSheet).toBe(true)
    expect(state.sheetMix).toBeGreaterThan(0)
    expect(state.sheetMix).toBeLessThan(1)
  })

  it('reaches every world on the roster, so the band is not a Dominaria-shaped claim', () => {
    // A negative control on the fixture rather than on the code: if the crossover were reachable on
    // only one world the three rows above would be a worked example, not a law.
    const inBand = WORLDS.filter((world) => {
      const surface = surfaceFor(world)
      const mid = (CROSSOVER_LOW_PX + CROSSOVER_HIGH_PX) / 2
      surface.update(frameAt(distanceForCellHeight(world, mid)))
      return surface.crossover.drawSystem && surface.crossover.drawSheet
    })
    expect(inBand.length).toBe(45)
  })
})

describe('§1.5 the per-world crossover scalar rests on a constant latitudinal extent', () => {
  it('gives every row of every world the same latitudinal half-extent', () => {
    // `WorldSurface` reads row 0's `lat` once and treats it as the world's. That is only sound
    // because the latitudinal component carries no `sin(theta)` (§2.1) — the longitudinal one does.
    // If this ever stops holding, a median over rows is needed and the scalar is not a scalar.
    let checked = 0
    const longitudinalSpread = new Set<number>()
    for (const world of WORLDS) {
      const first = cellDrawAngles(world.rowCells, 0).lat
      for (let row = 0; row < world.rowCells.length; row += 1) {
        const angles = cellDrawAngles(world.rowCells, row)
        expect(angles.lat, `${world.slug} row ${row}`).toBeCloseTo(first, 15)
        longitudinalSpread.add(angles.lon)
        checked += 1
      }
    }
    expect(checked, 'the denominator').toBe(777)
    // The control: the *longitudinal* extent genuinely varies, so "constant" above is a measurement
    // and not a property of `cellDrawAngles` returning the same object twice.
    expect(longitudinalSpread.size).toBeGreaterThan(1)
  })

  it('measures how far the centre-depth scalar sits from the true per-cell spread', () => {
    // The crossover is evaluated at the world's CENTRE depth while each cell's own admission uses
    // its own depth. The gap is bounded by radius/distance, and the claim that it does not matter
    // for the crossover is only worth making if it is measured at the distance the crossover
    // actually fires at. Reported, not silently assumed.
    let worstRelative = 0
    for (const world of WORLDS) {
      const source = sourceFor(world)
      const lifted = drawRadius(source.radius)
      const latArc = cellDrawAngles(world.rowCells, 0).lat
      const distance = distanceForCellHeight(world, CROSSOVER_HIGH_PX)
      const centreHeight = cellHeightPx(latArc, lifted, distance, VIEWPORT.height, FOV)
      for (let cell = 0; cell < source.cardCount; cell += 1) {
        const z = source.normals[cell * 3 + 2]! * lifted
        const x = source.normals[cell * 3]! * lifted
        const y = source.normals[cell * 3 + 1]! * lifted
        const d = Math.hypot(x, y, distance - z)
        const height = cellHeightPx(latArc, lifted, d, VIEWPORT.height, FOV)
        worstRelative = Math.max(worstRelative, Math.abs(height - centreHeight) / centreHeight)
      }
    }
    // At the top of the band a world is ~130 radii out, so the near cap and the limb differ by
    // well under the band's own 2x width. The assertion is that the scalar cannot move a world a
    // whole band-width, which is the only thing it has to be true for.
    expect(worstRelative).toBeLessThan(0.5)
    expect(worstRelative, 'a zero here would mean the sweep never varied the depth').toBeGreaterThan(0)
  })
})

describe('§1.5 the far tint mix', () => {
  it('is off at and above the tint radius and full at zero', () => {
    expect(tintMix(TINT_RADIUS_PX)).toBe(0)
    expect(tintMix(TINT_RADIUS_PX + 1)).toBe(0)
    expect(tintMix(0)).toBe(1)
  })

  it('rises monotonically as the world shrinks, with both endpoints fixed', () => {
    let previous = 0
    for (let px = TINT_RADIUS_PX; px >= 0; px -= 0.25) {
      const mix = tintMix(px)
      expect(mix).toBeGreaterThanOrEqual(previous)
      previous = mix
    }
    expect(previous).toBe(1)
    // Smoothstep, not a linear ramp: at the midpoint the two differ, which is the whole reason the
    // easing is here. A linear mix would read 0.5.
    expect(tintMix(TINT_RADIUS_PX / 2)).toBeCloseTo(0.5, 12)
    expect(tintMix(TINT_RADIUS_PX * 0.75)).toBeLessThan(0.25)
  })

  it('fires on the shipped roster at the home view rather than only in principle', () => {
    // If every world were larger than 6 px at every reachable pose, §1.8's tint would be dead code
    // and this function would be untestable in the only way that matters.
    const distance = 108.8 // Dominaria's `home` in scene units, per §1.2's worked example.
    const tinted = WORLDS.filter((world) => {
      const px = worldRadiusPx(worldRadius(world.cardCount), distance, VIEWPORT.height, FOV)
      return tintMix(px) > 0
    })
    expect(tinted.length).toBeGreaterThan(0)
  })
})

describe('§1.6 demand, admission and the threshold', () => {
  it('offers only front-facing on-screen cells to the histogram', () => {
    const world = bySlug('dominaria')
    const threshold = new AdaptiveThreshold(true)
    const surface = surfaceFor(world, { threshold })
    surface.update(frameAtRadii(world, 2.2))

    const report = surface.threshold
    // Roughly half a sphere faces the camera. The precise figure is `facesCamera`'s 0.12 cutoff,
    // which trims the limb — so the count must be under half, and must not be the whole world.
    expect(report.wanting).toBeGreaterThan(0)
    expect(report.wanting).toBeLessThan(world.cardCount / 2)
  })

  /**
   * The two configurations §1.6's visibility terms have to hold under.
   *
   * The row above is a range check and two mutants walked through it — offering every cell to the
   * histogram, and dropping the visibility terms from the admission rule — because **no hidden cell
   * ever cleared the threshold**, so both sides of the exclusion were empty and the assertions were
   * vacuous. The first entry here is the one that matters: it runs the **shipped** policy with no
   * control seam engaged, so §1.6's terms are pinned by the default configuration rather than by a
   * debug flag. The second keeps the seam covered.
   */
  const EXCLUSION_CASES = [
    {
      name: 'the shipped adaptive quantile, no seam engaged',
      seams: NO_SEAMS,
      adaptive: true,
    },
    {
      name: '?artThreshold=fixed24',
      seams: { ...NO_SEAMS, artThresholdFixed24: true },
      adaptive: false,
    },
  ] as const

  for (const useCase of EXCLUSION_CASES) {
    it(`counts exactly the visible cells over the floor, under ${useCase.name}`, () => {
      const world = bySlug('alara')
      const surface = surfaceFor(world, {
        seams: useCase.seams,
        pool: new ArtPool(SHIPPED_POOL_LAYERS),
        threshold: new AdaptiveThreshold(useCase.adaptive),
      })
      const frame = frameAtRadii(world, 2.2)
      surface.update(frame)
      const probe = buildWorldsProbe(surface.probeSource(frame))
      expect(probe.cells.length, 'no cell may be missing from the payload at this pose').toBe(
        world.cardCount,
      )

      const overFloor = probe.cells.filter((cell) => cell.height >= BASE_THRESHOLD_PX)
      const visible = overFloor.filter((cell) => cell.frontFacing && cell.onScreen)
      const hidden = overFloor.filter((cell) => !cell.frontFacing || !cell.onScreen)

      // The bound must bind, or the two assertions after it are vacuous again.
      expect(hidden.length, 'no hidden cell clears the floor: the exclusion is untestable here')
        .toBeGreaterThan(0)
      expect(visible.length, 'and neither side may be empty').toBeGreaterThan(0)

      expect(surface.threshold.wanting, 'demand is the visible cells alone').toBe(visible.length)
      for (const cell of hidden) {
        expect(surface.wasAdmitted(cell.cell), `hidden cell ${cell.cell} must not ask`).toBe(false)
      }
      for (const cell of visible) {
        expect(surface.wasAdmitted(cell.cell), `visible cell ${cell.cell} must ask`).toBe(true)
      }
    })
  }

  it('makes the exclusion reachable at every capacity the renderer ships, and says where it is not', () => {
    // Why the row above can drop the seam, and the guard against anyone restoring the 64-layer pool
    // that made it vacuous. The subject is the *harness knob*, not the policy: the quantile is taken
    // relative to capacity, so an undersized pool raises the threshold past the point where any
    // hidden cell can clear it. A back-facing cell is at most ~0.82x as tall as the world's tallest
    // front-facing one at this pose, so the exclusion binds exactly while the threshold sits below
    // that — which it does, on the whole roster, at any capacity the renderer actually uses.
    const reach = (capacity: number) => {
      let worlds = 0
      for (const world of WORLDS) {
        const surface = surfaceFor(world, { pool: new ArtPool(capacity) })
        const frame = frameAtRadii(world, 2.2)
        surface.update(frame)
        const probe = buildWorldsProbe(surface.probeSource(frame))
        if (probe.cells.some((cell) => cell.wantsArt && !cell.frontFacing)) worlds += 1
        surface.dispose()
      }
      return worlds
    }

    // Tier 4 is the smallest rung, and 224 is where tiers 0-3 land at WebGL 2's spec minimum.
    expect(reach(128), 'tier 4, the smallest shipped pool').toBeGreaterThanOrEqual(37)
    expect(reach(SHIPPED_POOL_LAYERS), 'tiers 0-3 at the spec minimum').toBeGreaterThanOrEqual(42)
    // The negative control, and the reason this row is not a tautology: below every shipped
    // capacity the exclusion genuinely does go unreachable on a third of the roster, so "it binds"
    // above is a measurement of the pool size and not a property of the sweep.
    expect(reach(16), 'an undersized pool starves the policy of its own subject').toBeLessThan(25)
  })

  it('reports exactly 24 px under ?artThreshold=fixed24, which is how the gate proves the seam took', () => {
    const world = bySlug('dominaria')
    const surface = surfaceFor(world, {
      seams: { ...NO_SEAMS, artThresholdFixed24: true },
      threshold: new AdaptiveThreshold(false),
    })
    surface.update(frameAt(distanceForCellHeight(world, 40)))
    expect(surface.threshold.effectiveThresholdPx).toBe(24)
    expect(surface.threshold.adaptive).toBe(false)
  })
})

describe('§1.6 the art fade tracks residency, not a claimed layer', () => {
  /**
   * A surface with a one-layer pool and a cell that is genuinely visible at the pose used.
   *
   * The subject cell is **found, not assumed to be cell 0**. Cell 0 is row 0 — the north pole — and
   * from the equatorial camera every pose below uses it is back-facing, so a harness that drove
   * cell 0 would be asserting the fade on a cell the renderer never admits. The fade is keyed on
   * residency rather than admission, so such a test would still pass: it would simply have stopped
   * measuring the case it names.
   */
  function fadeHarness() {
    // Alara, not Dominaria: at §3.1's 2.2-radii pose Dominaria's 6,271 cells are ~17 px, under
    // §1.6's 24 px floor, so nothing there is admitted and the harness could not mean what it says.
    const world = bySlug('alara')
    const pool = new ArtPool(1)
    const surface = surfaceFor(world, { pool })
    const frame = frameAtRadii(world, 2.2)

    // The cell whose centre points most directly at the camera, which sits on +z.
    const source = sourceFor(world)
    let subject = 0
    let best = -Infinity
    for (let cell = 0; cell < world.cardCount; cell += 1) {
      const z = source.normals[cell * 3 + 2]!
      if (z > best) {
        best = z
        subject = cell
      }
    }

    surface.update(frame)
    // The subject is genuinely a big, visible cell — this is what makes the harness realistic.
    expect(
      surface.admissionHeightPx(subject),
      'the subject must be a cell that would want art',
    ).toBeGreaterThan(BASE_THRESHOLD_PX)
    // But it is **not** admitted, and that is correct rather than a harness defect: the pool holds
    // one layer, and §1.6's threshold is defined relative to capacity, so a one-layer pool raises
    // the threshold above every bucket and admits nothing. It is exactly why these three rows drive
    // the pool by hand instead of through the stream — and it is the same property that makes
    // "shrink the pool" useless as W4's negative control.
    expect(surface.wasAdmitted(subject)).toBe(false)
    return { pool, surface, world, subject, frame }
  }

  function artOf(surface: WorldSurface, cell: number): number {
    return (surface.sheet.art.array as Float32Array)[cell]!
  }
  function layerOf(surface: WorldSurface, cell: number): number {
    return (surface.sheet.layers.array as Float32Array)[cell]!
  }

  it('does not advance toward a RESERVED layer, which holds the previous card s pixels', () => {
    const { pool, surface, subject, frame } = fadeHarness()
    // Reserved, not resolved: the fetch is in flight and the layer has no art in it yet.
    expect(pool.reserve(subject, 1)).toBe(0)
    surface.update({ ...frame, deltaSeconds: ART_FADE_S })
    expect(layerOf(surface, subject), 'a reserved layer must not be bound').toBe(LAYER_FREE)
    expect(artOf(surface, subject)).toBe(0)

    // The control: the same layer, now resolved, does bind and does fade.
    pool.resolve(subject)
    surface.update({ ...frame, deltaSeconds: ART_FADE_S })
    expect(layerOf(surface, subject)).toBe(0)
    expect(artOf(surface, subject)).toBe(1)
  })

  it('reaches full art over the PRD s fade, not instantly', () => {
    const { pool, surface, subject, frame } = fadeHarness()
    pool.reserve(subject, 1)
    pool.resolve(subject)

    surface.update({ ...frame, deltaSeconds: ART_FADE_S / 2 })
    const half = artOf(surface, subject)
    expect(half).toBeGreaterThan(0)
    expect(half, 'a fade that lands in one frame is not a fade').toBeLessThan(1)

    surface.update({ ...frame, deltaSeconds: ART_FADE_S / 2 })
    expect(artOf(surface, subject)).toBe(1)
  })

  it('pulls the picture back when the pool evicts the key out from under the cell', () => {
    const { pool, surface, subject, frame } = fadeHarness()
    pool.reserve(subject, 1)
    pool.resolve(subject)
    surface.update({ ...frame, deltaSeconds: ART_FADE_S })
    expect(artOf(surface, subject)).toBe(1)
    expect(layerOf(surface, subject)).toBe(0)

    // The control first: with nothing evicting, the cell keeps its art across a frame. Without this
    // row the assertion below would also pass on a surface that cleared `iArt` every frame.
    surface.update({ ...frame, deltaSeconds: ART_FADE_S })
    expect(artOf(surface, subject), 'control: an untouched resident cell keeps its art').toBe(1)

    // Now take the layer away. The grace window is 30 frames, so the claim has to be late enough
    // to be allowed to evict. Key 999999 is not a cell on this world.
    const stolen = pool.reserve(999_999, 40)
    expect(stolen, 'the single layer must have been taken from the subject').toBe(0)
    expect(pool.layerOf(subject)).toBeNull()

    surface.update({ ...frame, deltaSeconds: ART_FADE_S })
    // Without this repair the cell goes on sampling layer 0, which now belongs to another card: the
    // WRONG card's art, at full opacity, for as long as the cell is on screen.
    expect(layerOf(surface, subject)).toBe(LAYER_FREE)
    expect(artOf(surface, subject)).toBe(0)
  })
})

describe('§1.6 ?swatch=mean flattens BOTH LOD representations', () => {
  it('writes one colour into every cell of the sheet and every texel of the bake', () => {
    const world = bySlug('alara')
    const flat = surfaceFor(world, { seams: { ...NO_SEAMS, swatchMean: true } })
    const swatch = flat.sheet.geometry.getAttribute('iSwatch').array as Float32Array

    const first = [swatch[0], swatch[1], swatch[2]]
    for (let cell = 1; cell < world.cardCount; cell += 1) {
      expect(swatch[cell * 3], `cell ${cell}`).toBe(first[0])
      expect(swatch[cell * 3 + 1]).toBe(first[1])
      expect(swatch[cell * 3 + 2]).toBe(first[2])
    }

    // The bake must move with it. Baking the unpermuted swatches would leave the control visible
    // only above the crossover, and inside the band — where both passes draw and cross-fade — the
    // two representations would disagree cell for cell.
    const bakeColours = new Set<string>()
    for (let texel = 0; texel < EQUIRECT_WIDTH * EQUIRECT_HEIGHT; texel += 1) {
      const at = texel * 4
      bakeColours.add(`${flat.equirect[at]},${flat.equirect[at + 1]},${flat.equirect[at + 2]}`)
    }
    expect(bakeColours.size, 'the bake must be one colour under ?swatch=mean').toBe(1)
  })

  it('leaves both varied without the seam, so the row above measures the seam', () => {
    const world = bySlug('alara')
    const plain = surfaceFor(world)
    const swatch = plain.sheet.geometry.getAttribute('iSwatch').array as Float32Array
    const sheetColours = new Set<number>()
    for (let cell = 0; cell < world.cardCount; cell += 1) sheetColours.add(swatch[cell * 3]!)
    expect(sheetColours.size).toBeGreaterThan(1)

    const bakeColours = new Set<string>()
    for (let texel = 0; texel < EQUIRECT_WIDTH * EQUIRECT_HEIGHT; texel += 1) {
      const at = texel * 4
      bakeColours.add(`${plain.equirect[at]},${plain.equirect[at + 1]},${plain.equirect[at + 2]}`)
    }
    expect(bakeColours.size).toBeGreaterThan(1)
  })
})

describe('§1.6 ?bands=shuffle is a global permutation, and the grid does not move', () => {
  const world = () => bySlug('alara')

  it('permutes cards across cells without repeating or dropping one', () => {
    const shuffled = surfaceFor(world(), { seams: { ...NO_SEAMS, bandsShuffle: true } })
    const seen = new Set(shuffled.cardOfCell)
    expect(seen.size, 'a permutation is a bijection').toBe(world().cardCount)
    // The control: it is not the identity, or the seam does nothing.
    const moved = Array.from(shuffled.cardOfCell).filter((card, cell) => card !== cell)
    expect(moved.length).toBeGreaterThan(0)
  })

  it('leaves the grid and the reported band untouched', () => {
    const plain = surfaceFor(world())
    const shuffled = surfaceFor(world(), { seams: { ...NO_SEAMS, bandsShuffle: true } })
    // The three silently-green spellings of this control all move the grid or the labelling. This
    // row is what distinguishes the one that works from them.
    expect(shuffled.sheet.geometry.getAttribute('iNormal').array).toEqual(
      plain.sheet.geometry.getAttribute('iNormal').array,
    )
    expect(shuffled.sheet.geometry.getAttribute('iSize').array).toEqual(
      plain.sheet.geometry.getAttribute('iSize').array,
    )
  })

  it('changes the multiset of swatches inside a band, which is the distinguishing assertion', () => {
    // §1.6's normative note: relabelling the band, permuting the band-to-class map and permuting
    // WITHIN a band all leave every band internally uniform and W3 still passes. Only a global
    // permutation moves a band's own contents, so that is what is asserted.
    const target = world()
    const source = sourceFor(target)
    // Bands over a non-degenerate histogram, so there is more than one band to move cards between.
    const hueCounts = [3, 5, 7, 11, 13, 17, 19].map((n) => Math.max(1, Math.floor(target.cardCount / n)))
    const edges = bandBoundaries(hueCounts)

    const bandOfCell = (cell: number) => bandOfCosTheta(source.normals[cell * 3 + 1]!, edges)

    const plain = surfaceFor(target)
    const shuffled = surfaceFor(target, { seams: { ...NO_SEAMS, bandsShuffle: true } })
    const plainSwatch = plain.sheet.geometry.getAttribute('iSwatch').array as Float32Array
    const shuffledSwatch = shuffled.sheet.geometry.getAttribute('iSwatch').array as Float32Array

    const multisets = new Map<number, { before: number[]; after: number[] }>()
    for (let cell = 0; cell < target.cardCount; cell += 1) {
      const band = bandOfCell(cell)
      const entry = multisets.get(band) ?? { before: [], after: [] }
      entry.before.push(plainSwatch[cell * 3]!)
      entry.after.push(shuffledSwatch[cell * 3]!)
      multisets.set(band, entry)
    }

    expect(multisets.size, 'the histogram must span more than one band or this proves nothing')
      .toBeGreaterThan(1)
    const changed = Array.from(multisets.values()).filter(({ before, after }) => {
      const a = [...before].sort((x, y) => x - y)
      const b = [...after].sort((x, y) => x - y)
      return a.some((value, index) => value !== b[index])
    })
    expect(changed.length, 'at least one band s contents must have moved').toBeGreaterThan(0)
  })
})

describe('§3.1 composition fills the probe source the seam was written against', () => {
  it('produces a payload the probe builder accepts, with cells for the focused world', () => {
    const world = bySlug('alara')
    const surface = surfaceFor(world)
    const frame = frameAt(distanceForCellHeight(world, 40))
    surface.update(frame)

    const probe = buildWorldsProbe(surface.probeSource(frame))
    expect(probe.planeSlug).toBe('alara')
    expect(probe.cells.length, 'a composed world must report cells').toBeGreaterThan(0)
    expect(probe.cells.length).toBeLessThanOrEqual(world.cardCount)
    expect(probe.viewport).toEqual(VIEWPORT)
    expect(probe.pool.layers).toBe(64)
    // The threshold the payload reports is the one the frame actually ran, not a fresh reading.
    expect(probe.pool.effectiveThresholdPx).toBe(surface.threshold.effectiveThresholdPx)
    expect(probe.radii).toBeCloseTo(surface.radii, 12)
  })

  it('reports the EXACT height the renderer admitted on, so W4 scores the shipped predicate', () => {
    // §3.1 computes `wantsArt` as `rect.height >= effectiveThresholdPx`. That is only a statement
    // about the renderer if the renderer admitted on the same number — so this is bit equality, not
    // a tolerance. The two paths are one call to `cellScreenRect` reached from two places.
    const world = bySlug('alara')
    const surface = surfaceFor(world)
    const frame = frameAtRadii(world, 2.2)
    surface.update(frame)
    const probe = buildWorldsProbe(surface.probeSource(frame))

    const threshold = probe.pool.effectiveThresholdPx
    let compared = 0
    let admittedCount = 0
    for (const cell of probe.cells) {
      expect(cell.height, `cell ${cell.cell}`).toBe(surface.admissionHeightPx(cell.cell))
      // `wantsArt` is the size test alone; the renderer's admission adds §1.6's visibility terms,
      // which the payload reports separately so the gate can recover either predicate.
      expect(cell.wantsArt, `cell ${cell.cell} wantsArt`).toBe(cell.height >= threshold)
      expect(surface.wasAdmitted(cell.cell), `cell ${cell.cell} admitted`).toBe(
        cell.wantsArt && cell.frontFacing && cell.onScreen,
      )
      if (surface.wasAdmitted(cell.cell)) admittedCount += 1
      compared += 1
    }
    expect(compared, 'the denominator').toBeGreaterThan(0)
    // Both sides of the admission predicate must be exercised, or the equality above is vacuous.
    expect(admittedCount).toBeGreaterThan(0)
    expect(admittedCount).toBeLessThan(compared)
  })

  it('separates a small-angle height from the projected one, which is why the row above is exact', () => {
    // The negative control for the row above. If the foreshortened rect and the small-angle extent
    // happened to agree, "one call site" would be an unfalsifiable claim: both spellings would pass
    // every assertion and the defect would be invisible. They do not agree — measured here — so
    // choosing the wrong one is a real, scored difference.
    const world = bySlug('alara')
    const surface = surfaceFor(world)
    const frame = frameAtRadii(world, 2.2)
    surface.update(frame)

    const latArc = cellDrawAngles(world.rowCells, 0).lat
    const lifted = drawRadius(worldRadius(world.cardCount))
    const source = sourceFor(world)
    let worst = 0
    for (let cell = 0; cell < world.cardCount; cell += 1) {
      const admitted = surface.admissionHeightPx(cell)
      if (admitted <= 0) continue
      const n = new Vector3(
        source.normals[cell * 3],
        source.normals[cell * 3 + 1],
        source.normals[cell * 3 + 2],
      ).multiplyScalar(lifted)
      const smallAngle = cellHeightPx(
        latArc,
        lifted,
        frame.camera.position.distanceTo(n),
        VIEWPORT.height,
        FOV,
      )
      worst = Math.max(worst, Math.abs(admitted - smallAngle) / smallAngle)
    }
    // Recorded, not floored: this is the size of the mistake the unified spelling avoids, and it is
    // a property of this pose and this world rather than a constant to assert against.
    expect(worst).toBeGreaterThan(0.25)
  })

  it('returns no cells for a world entirely behind the camera', () => {
    // The empty-array case is a measurement — a world that drew nothing — and leg G branches on it
    // differently from `undefined`, which is a setup failure. Both have to be reachable.
    const world = bySlug('alara')
    const surface = surfaceFor(world)
    const frame = frameLookingAway(world, 2.2)
    surface.update(frame)
    const probe = buildWorldsProbe(surface.probeSource(frame))
    expect(probe.cells.length).toBe(0)
  })
})
