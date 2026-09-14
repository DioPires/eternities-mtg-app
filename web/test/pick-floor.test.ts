/**
 * §1.11's screen-space pick floor, through `PlanePicker` itself (DEC-751).
 *
 * `test/pick-floor-screen-space.test.ts` measures what the floor *delivers* — the effective target
 * once floored proxies eat each other — against the shipped roster. It does that by reimplementing
 * the projection, because at the time it was written the floor did not exist. This file is the
 * other half: the shipped picker, driven through the shipped code path, so that the policy and the
 * measurement are not two descriptions of the same intention.
 *
 * That gap was real. The floor landed and all 902 tests stayed green, because **nothing in the
 * suite called `PlanePicker.pick` at all** — `test/picking.test.ts` is the id-buffer picker. A
 * change to the plane raycast was invisible in both directions.
 *
 * Geometry is synthetic and deliberately so: the floor is a boundary, and a boundary wants a
 * subject placed exactly astride it rather than wherever a dataset happens to put one. The last row
 * checks the shipped v3 roster, so the synthetic cases cannot drift away from the data the floor
 * exists for.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector2 } from 'three'

import type { PlaneRecord, PlanesFile, PlaneSlug, SearchFile } from '../src/data/types'
import { createProjected, Projector } from '../src/labels/project'
import { vec } from '../src/camera/vec'
import {
  PLANE_PICK_FLOOR_PX,
  PlanePicker,
  planePickFloorRadius,
} from '../src/scene/picking/scenePicker'
import { PlaneTable } from '../src/scene/starfield/planeTable'
import { buildSearchIndex, search } from '../src/search/index'

const WIDTH = 1920
const HEIGHT = 1080
const FOV = 55

/** A minimal spiral plane at `home` with `radius`. Only the fields the picker reads matter. */
function plane(
  index: number,
  slug: PlaneSlug,
  home: [number, number, number],
  radius: number,
): PlaneRecord {
  return {
    index,
    slug,
    displayName: slug,
    notes: '',
    kind: 'spiral',
    cardCount: 10,
    starOffset: 0,
    starCount: 0,
    shardCount: 1,
    home,
    radius,
    tilt: [0, 0, 0, 1],
    spinPeriodS: 100,
    spinDirection: 1,
    driftAmplitude: 0,
    driftPeriodS: 1,
    driftPhase: 0,
    palette: [1, 0, 0, 0, 0, 0, 0],
    nebulaTint: [1, 1, 1],
    firstYear: null,
    lastYear: null,
    sets: [],
  }
}

/** A table with every plane fully faded in — a fade below 0.5 is not clickable yet. */
function tableOf(planes: readonly PlaneRecord[]): PlaneTable {
  const table = new PlaneTable(planes, 200)
  for (const record of planes) table.revealPlane(record.index)
  // Long enough to clear PLANE_FADE_S with motion off, so `multiverseAngle` stays at zero and the
  // geometry below is the geometry asserted on.
  table.advance(10, 0)
  return table
}

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.1, 8000)
  cam.position.set(0, 0, 0)
  cam.lookAt(0, 0, -1)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/** The pointer, in NDC, `offsetPx` to the right of the screen centre. */
function ndcAtOffset(offsetPx: number): Vector2 {
  return new Vector2((offsetPx / (WIDTH / 2)) * 1, 0)
}

describe('§1.11 the plane pick proxy is floored in screen space', () => {
  it('agrees with the label projector about what 24 px of diameter is', () => {
    // The floor and the labels are two modules with their own spellings of the same projection, so
    // this checks one against the other rather than against a constant of its own. A sign error or
    // a half-angle slip in either shows up here as a disagreement; a shared constant would not.
    const projector = new Projector()
    projector.update({
      position: vec(0, 0, 0),
      target: vec(0, 0, -1),
      fov: (FOV * Math.PI) / 180,
      near: 0.1,
      viewportWidth: WIDTH,
      viewportHeight: HEIGHT,
    })
    for (const depth of [50, 247, 1000]) {
      const radius = planePickFloorRadius(depth, (FOV * Math.PI) / 180, HEIGHT)
      expect(projector.radiusPx(radius, depth) * 2).toBeCloseTo(PLANE_PICK_FLOOR_PX, 6)
    }
  })

  it('grows with depth, and vanishes behind the camera', () => {
    const fov = (FOV * Math.PI) / 180
    expect(planePickFloorRadius(500, fov, HEIGHT)).toBeGreaterThan(
      planePickFloorRadius(250, fov, HEIGHT),
    )
    expect(planePickFloorRadius(0, fov, HEIGHT)).toBe(0)
    expect(planePickFloorRadius(-10, fov, HEIGHT)).toBe(0)
  })

  it('picks a world whose drawn proxy is far under 24 px', () => {
    // A one-card world at §1.3's floor radius of 0.55, at the home view's distance. Its drawn pick
    // proxy is ~0.63 world units, which is about 4 px of diameter here — the cohort measured at
    // 3.8-9.2 px, never reaching 24 px at any azimuth.
    const small = plane(0, 'segovia', [0, 0, -247], 0.55)
    const table = tableOf([small])
    const picker = new PlanePicker()
    const cam = camera()

    const drawnPx = (0.55 * 1.15 * 2 * (HEIGHT / 2)) / (247 * Math.tan((FOV * Math.PI) / 360))
    expect(drawnPx).toBeLessThan(6)

    // Dead centre hits either way: this row is the control that the subject is pickable at all.
    expect(picker.pick(ndcAtOffset(0), cam, table, 0, HEIGHT)).toBe(0)
    // 10 px off centre is outside the drawn proxy and inside the 24 px floor (12 px of radius).
    expect(picker.pick(ndcAtOffset(10), cam, table, 0, HEIGHT)).toBe(0)
    // And 20 px off centre is outside the floor too, so the floor has an edge rather than being a
    // blanket "nearest plane wins" — without this row a floor of any size at all would pass.
    expect(picker.pick(ndcAtOffset(20), cam, table, 0, HEIGHT)).toBe(-1)
  })

  it('reads the viewport in CSS pixels, so a 2x buffer does not halve the target', () => {
    // The parameter is load-bearing and this is its positive control: the same pointer, the same
    // world, and only the height the caller passes differs. Handing it a drawing-buffer height of
    // 2160 on a 1080-px viewport halves the floor in world units and the pick is lost.
    const small = plane(0, 'segovia', [0, 0, -247], 0.55)
    const table = tableOf([small])
    const picker = new PlanePicker()
    const cam = camera()
    expect(picker.pick(ndcAtOffset(10), cam, table, 0, HEIGHT)).toBe(0)
    expect(picker.pick(ndcAtOffset(10), cam, table, 0, HEIGHT * 2)).toBe(-1)
  })

  it('leaves a world that already clears 24 px exactly as it was', () => {
    // Dominaria's radius under §1.3, at the same distance: ~880 px of drawn proxy. The floor must
    // be inert here, or it is not a floor. Asserted at the *edge* of the drawn proxy, which is
    // where an accidental `min` or an unconditional overwrite would change the answer.
    const big = plane(0, 'dominaria', [0, 0, -247], 9.977895)
    const table = tableOf([big])
    const picker = new PlanePicker()
    const cam = camera()
    const drawnRadiusPx = (9.977895 * 1.15 * (HEIGHT / 2)) / (247 * Math.tan((FOV * Math.PI) / 360))
    expect(drawnRadiusPx).toBeGreaterThan(PLANE_PICK_FLOOR_PX)
    expect(picker.pick(ndcAtOffset(drawnRadiusPx * 0.9), cam, table, 0, HEIGHT)).toBe(0)
    expect(picker.pick(ndcAtOffset(drawnRadiusPx * 1.1), cam, table, 0, HEIGHT)).toBe(-1)
  })

  it('still awards an overlapped pixel to the nearer world', () => {
    // The rule §1.11 says the floor cannot change: nearest hit wins. Two floored proxies on top of
    // one another, the nearer one 300 units closer — it takes the pixel, and that is why the floor
    // guarantees a proxy rather than a target.
    const near = plane(0, 'innistrad', [0, 0, -200], 0.55)
    const far = plane(1, 'segovia', [0, 0, -500], 0.55)
    const table = tableOf([near, far])
    const picker = new PlanePicker()
    const cam = camera()
    expect(picker.pick(ndcAtOffset(0), cam, table, 0, HEIGHT)).toBe(0)
  })

  it('binds on the shipped v3 roster, and on more than a handful of it', () => {
    // The floor is not a hypothetical: on the dataset that ships, most of the roster is under the
    // target at the home view. Counted rather than pinned — the exact count moves with `home` and
    // with azimuth (§1.11 says to carry no single-azimuth number out), so the assertion is that it
    // is a substantial share, and the *absence* row is what makes it a measurement.
    const root = JSON.parse(
      readFileSync(resolve(__dirname, '../datasets.json'), 'utf8'),
    ) as Record<string, string>
    const planes = JSON.parse(
      readFileSync(resolve(__dirname, '../public/data', root.worlds!, 'planes.json'), 'utf8'),
    ) as PlanesFile
    const worlds = planes.planes.filter((p) => p.kind === 'spiral' || p.kind === 'irregular')
    expect(worlds).toHaveLength(45)

    const projector = new Projector()
    projector.update({
      position: vec(0, 0, 400),
      target: vec(0, 0, 0),
      fov: (FOV * Math.PI) / 180,
      near: 0.1,
      viewportWidth: WIDTH,
      viewportHeight: HEIGHT,
    })
    const projected = createProjected()
    let floored = 0
    for (const world of worlds) {
      projector.project(projected, vec(world.home[0], world.home[1], world.home[2]))
      if (projected.depth <= 0) continue
      const drawn = projector.radiusPx(world.radius * 1.15, projected.depth) * 2
      if (drawn < PLANE_PICK_FLOOR_PX) floored += 1
    }
    expect(floored).toBeGreaterThan(10)
    expect(floored).toBeLessThan(worlds.length)
  })
})

/**
 * §1.11's conformance basis, which the floor does **not** supply (DEC-751).
 *
 * The 24 px constant comes from WCAG 2.5.8, and the section is explicit that the floor is not what
 * makes the product conform: it delivers a 24 px *proxy*, and 19 of the 33 worlds it lifts still
 * fall under 24 px of effective target somewhere in the turn. Conformance rests on the criterion's
 * **Equivalent** exception instead — every plane is reachable by name through a full-size control
 * that meets 2.5.8 on its own.
 *
 * So this is the row §1.11 calls "a release requirement, not a nicety". It is the only part of the
 * section that is a conformance argument rather than a usability improvement, and if it ever goes
 * red the floor does not cover for it.
 */
describe('§1.11 every world is reachable by name, whatever its pick target', () => {
  const root = JSON.parse(readFileSync(resolve(__dirname, '../datasets.json'), 'utf8')) as Record<
    string,
    string
  >
  const dir = resolve(__dirname, '../public/data', root.worlds!)
  const planes = JSON.parse(readFileSync(resolve(dir, 'planes.json'), 'utf8')) as PlanesFile
  const index = buildSearchIndex(
    JSON.parse(readFileSync(resolve(dir, 'search.json'), 'utf8')) as SearchFile,
  )

  it('answers every world in the shipped roster with its own plane hit', () => {
    const worlds = planes.planes.filter((p) => p.kind === 'spiral' || p.kind === 'irregular')
    expect(worlds).toHaveLength(45)

    const unreachable: string[] = []
    for (const world of worlds) {
      const hits = search(index, world.displayName).planes
      if (!hits.some((hit) => hit.slug === world.slug)) unreachable.push(world.slug)
    }
    // Every one, not most: this is the equivalent path for worlds whose pick target is ~4 px, and
    // a world missing from it has no accessible route at all.
    expect(unreachable).toEqual([])
  })

  it('reaches the one-card worlds, which are exactly the cohort the floor cannot save', () => {
    // Named rather than counted. These six are at §1.3's radius floor, measured at 3.8-9.2 px of
    // pick diameter and never reaching 24 px at any azimuth, and three of them are simultaneously
    // unlabelled at the worst azimuth. For this cohort the search path is not a fallback, it is
    // the primary route, so it gets its own row that cannot be satisfied by the other 39.
    for (const slug of ['ergamon', 'muraganda', 'pyrulea', 'regatha', 'segovia', 'shandalar']) {
      const world = planes.planes.find((p) => p.slug === slug)
      expect(world, slug).toBeDefined()
      const hits = search(index, world!.displayName).planes
      expect(
        hits.map((hit) => hit.slug),
        slug,
      ).toContain(slug)
    }
  })

  it('finds nothing for a name no plane has, so the rows above are not vacuous', () => {
    // The control. Without it a `search` that returned the whole roster for any query would pass
    // both rows above and prove nothing at all.
    expect(search(index, 'zzzzznotaplane').planes).toEqual([])
  })
})
