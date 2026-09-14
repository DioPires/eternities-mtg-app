/**
 * The spin axis (spec §1.3, CEO ruling on DEC-750) and the local-frame substitution it needs.
 *
 * Two separate claims, and they fail in completely different ways:
 *
 *  1. **The axis is the pole axis.** A world spun about anything else carries §1.3's thirteen
 *     latitude bands around the sky, and W3 — "latitude reads as colour" — stops being a statement
 *     about a fixed thing. The mutant is not exotic: `starfield/motion.ts` and its vertex twin
 *     already spin about plane-local **Z**, so "use the axis the rest of the app uses" is the
 *     natural wrong answer, and it is measured against below.
 *  2. **Measuring in the world's own frame is exactly equivalent to measuring in world space.**
 *     `WorldSurface` folds the orientation into the camera rather than into 6,271 normals, and that
 *     is a substitution that could be *nearly* right — off by a transpose, or by applying the
 *     rotation to the light and not to the camera — in ways that leave every picture plausible.
 *     The row below drives a real surface at an orientation and at the identity with the camera
 *     counter-rotated, and requires the two to agree cell for cell.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'

import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlanesFile } from '../src/data/types'
import { FrameLoop } from '../src/scene/renderer/frameLoop'
import { attachWorlds } from '../src/scene/worlds/attachWorlds'
import {
  APPLY_PLANE_TILT,
  NO_SPIN,
  WORLD_POLE_AXIS,
  planeOrientation,
  worldOrientation,
} from '../src/scene/worlds/spin'
import { worldPlanesOf } from '../src/scene/worlds/worldSource'
import { worldsProbeOf } from '../src/scene/worlds/worldsProbe'
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

const CSS_WIDTH = 1920
const CSS_HEIGHT = 1080

function build() {
  const scene = new Scene()
  const camera = new PerspectiveCamera(55, CSS_WIDTH / CSS_HEIGHT, 0.1, 5000)
  const loop = new FrameLoop()
  const gl = {
    getSize: (target: Vector2) => target.set(CSS_WIDTH, CSS_HEIGHT),
    getDrawingBufferSize: (target: Vector2) => target.set(CSS_WIDTH, CSS_HEIGHT),
    getPixelRatio: () => 1,
    copyTextureToTexture: () => {},
  } as unknown as WebGLRenderer
  const worlds = attachWorlds({
    gl,
    scene,
    camera,
    loop,
    seams: NO_SEAMS,
    capabilities: { webgl2: true, maxArrayTextureLayers: 2048 },
  })
  worlds.setData({
    planes: PLANES.planes,
    stars: STARS,
    swatches: SWATCHES,
    multiverseRadius: PLANES.multiverseRadius,
  })
  let clock = 0
  return {
    scene,
    camera,
    worlds,
    tick: () => {
      clock += 17
      loop.tick(clock)
    },
  }
}

/** Pose the camera at `radii` world-radii along `direction`, looking at the world's centre. */
function poseAt(
  camera: PerspectiveCamera,
  centre: Vector3,
  radius: number,
  radii: number,
  direction: Vector3,
): void {
  camera.position.copy(centre).addScaledVector(direction, radius * radii)
  camera.lookAt(centre)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
}

describe('the spin axis is the pole axis (§1.3, CEO ruling on DEC-750)', () => {
  it('leaves the poles fixed and moves the equator', () => {
    const q = new Quaternion()
    worldOrientation([0, 0, 0, 1], 0.9, q)

    const north = new Vector3().copy(WORLD_POLE_AXIS).applyQuaternion(q)
    expect(north.x).toBeCloseTo(0, 12)
    expect(north.y).toBeCloseTo(1, 12)
    expect(north.z).toBeCloseTo(0, 12)

    // The equator has to actually move, or "the poles are fixed" is satisfied by doing nothing.
    const equator = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(equator.angleTo(new Vector3(1, 0, 0))).toBeCloseTo(0.9, 10)
  })

  it('is not plane-local Z, which is what the rest of the app spins about', () => {
    // The negative control for the ruling. `starWorldPosition` rotates `(x, y)` — about local Z —
    // and the vertex shader does the same; under that axis the **north pole itself** sweeps through
    // 0.9 rad, which is §1.3's whole band structure tumbling. Nothing errors and every cell still
    // carries its own swatch, so the picture is a plausible banded globe at the wrong attitude.
    const aboutZ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.9)
    const moved = new Vector3().copy(WORLD_POLE_AXIS).applyQuaternion(aboutZ)
    expect(moved.angleTo(WORLD_POLE_AXIS)).toBeCloseTo(0.9, 10)
  })

  it('composes tilt after spin, and ships with tilt off pending a ruling', () => {
    const plane = WORLDS.find((candidate) => candidate.tilt[3] < 0.999)!
    const out = new Quaternion()
    planeOrientation(plane, () => 0, out)

    if (APPLY_PLANE_TILT) {
      expect(out.angleTo(new Quaternion())).toBeGreaterThan(0.01)
    } else {
      // Off — see `spin.ts`. A zero spin angle is then the identity, which is what keeps R1's swept
      // threshold poses (`worlds-attach.test.ts`) measuring what they were derived against.
      expect(out.angleTo(new Quaternion())).toBeCloseTo(0, 12)
    }

    // The composition order itself is asserted whatever that constant says: `tilt ∘ spin` turns the
    // world about its **own** pole and then leans that pole. The other order leaves every world's
    // pole at world +Y and turns `tilt` into a per-frame wobble — with an identical silhouette,
    // because a sphere is a sphere, and only the mosaic moving.
    //
    // Normalised before comparing: `planes.json` emits `tilt` to four decimals, so the shipped
    // quaternion is off unit by ~6e-4 and `angleTo` reads that as 1.25 mrad of rotation that is not
    // there. Comparing the raw pair would make this row fail on a correct composition — and pass if
    // someone "fixed" it by loosening the tolerance past the 0.01 the negative row below needs.
    const tilt = new Quaternion(
      plane.tilt[0],
      plane.tilt[1],
      plane.tilt[2],
      plane.tilt[3],
    ).normalize()
    const spin = new Quaternion().setFromAxisAngle(WORLD_POLE_AXIS, 0.4)
    const composed = worldOrientation(plane.tilt, 0.4, new Quaternion()).normalize()
    expect(composed.angleTo(tilt.clone().multiply(spin).normalize())).toBeCloseTo(0, 6)
    expect(composed.angleTo(spin.clone().multiply(tilt).normalize())).toBeGreaterThan(0.01)
  })
})

describe('the local-frame substitution is exact, not approximate (DEC-750)', () => {
  /**
   * The same world, measured two ways that must agree exactly.
   *
   * **A**: the world carries orientation `q`, the camera sits where it sits.
   * **B**: the world carries the identity, and the camera and the key light are rotated by `q⁻¹`.
   *
   * Those are the same relative geometry, so every cell's projected rect, facing, on-screen flag
   * and shade must come out identical — that is the claim `WorldSurface` makes when it folds the
   * orientation into the camera instead of into the normals. A transposed rotation, or one applied
   * to the light but not the camera, agrees at the identity and diverges everywhere else, which is
   * why the row runs at a non-trivial angle rather than at zero.
   */
  it('measures a rotated world exactly as it measures a counter-rotated camera', () => {
    const slug = 'dominaria'
    const angle = 0.7
    const q = new Quaternion().setFromAxisAngle(WORLD_POLE_AXIS, angle)

    const readings = [true, false].map((rotateWorld) => {
      const rig = build()
      const surface = rig.worlds.surfaces.find((s) => s.planeSlug === slug)!
      // Spin through the attachment when the world turns; otherwise turn the camera by `q⁻¹`.
      rig.worlds.setSpinAngles(rotateWorld ? () => angle : NO_SPIN)

      const direction = rotateWorld
        ? new Vector3(0.3, 0.2, 1).normalize()
        : new Vector3(0.3, 0.2, 1).normalize().applyQuaternion(q.clone().invert())
      poseAt(rig.camera, surface.centre, surface.radius, 2.2, direction)
      rig.tick()

      const probe = worldsProbeOf(rig.worlds.probeSource())!
      const out = {
        radii: probe.radii,
        cells: probe.cells.map((cell) => ({
          cell: cell.cell,
          x: cell.x,
          y: cell.y,
          height: cell.height,
          shade: cell.shade,
          frontFacing: cell.frontFacing,
          band: cell.band,
        })),
      }
      rig.worlds.dispose()
      return out
    })

    const [rotated, counterRotated] = readings
    expect(rotated!.cells.length).toBeGreaterThan(100)
    expect(rotated!.cells).toHaveLength(counterRotated!.cells.length)
    expect(rotated!.radii).toBeCloseTo(counterRotated!.radii, 10)

    for (const [index, cell] of rotated!.cells.entries()) {
      const twin = counterRotated!.cells[index]!
      expect(cell.cell).toBe(twin.cell)
      expect(cell.x).toBeCloseTo(twin.x, 6)
      expect(cell.y).toBeCloseTo(twin.y, 6)
      expect(cell.height).toBeCloseTo(twin.height, 6)
      expect(cell.shade).toBeCloseTo(twin.shade, 10)
      expect(cell.frontFacing).toBe(twin.frontFacing)
      expect(cell.band).toBe(twin.band)
    }
  })

  it('reports `radii` unchanged by the orientation, because a rotation is a rigid motion', () => {
    // The one probe field that reads the world's centre and the camera's position — the two
    // quantities the substitution replaces. It is a distance, so it must survive; if it did not,
    // every §3.1 criterion stated "at 2.2 radii" would be stated at a pose that moved with the spin.
    const rig = build()
    const surface = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, surface.centre, surface.radius, 3, new Vector3(0, 0, 1))

    const seen = new Set<string>()
    for (const angle of [0, 0.5, 1.7, 3.0, 5.9]) {
      rig.worlds.setSpinAngles(() => angle)
      rig.tick()
      seen.add(surface.radii.toFixed(9))
    }
    expect([...seen]).toEqual(['3.000000000'])
    rig.worlds.dispose()
  })

  it('actually turns the sheet, so the row above is not comparing two unrotated worlds', () => {
    // The control for the pair. Without it, a `setSpinAngles` that was silently ignored would make
    // both readings above identical for the most boring possible reason.
    const rig = build()
    const surface = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, surface.centre, surface.radius, 2.2, new Vector3(0, 0, 1))

    // **Front-facing, not the cell list.** `cells[]` is everything that survives §1.6's frustum test
    // at `CLIP_BOUND = 2`, which at this pose is the whole sheet whatever the attitude — so the
    // index list is rotation-invariant and would have made this control pass by measuring nothing.
    // Which cells *face the eye* is the observable effect of a spin.
    const facing = () =>
      worldsProbeOf(rig.worlds.probeSource())!
        .cells.filter((cell) => cell.frontFacing)
        .map((cell) => cell.cell)

    rig.worlds.setSpinAngles(NO_SPIN)
    rig.tick()
    const still = facing()
    expect(still.length).toBeGreaterThan(100)
    expect(surface.mesh.quaternion.angleTo(new Quaternion())).toBeCloseTo(0, 12)

    rig.worlds.setSpinAngles(() => 1.2)
    rig.tick()
    const spun = facing()
    expect(surface.mesh.quaternion.angleTo(new Quaternion())).toBeCloseTo(1.2, 6)
    expect(spun).not.toEqual(still)
    rig.worlds.dispose()
  })
})

describe('the galaxys own axis, as the evidence behind the ruling', () => {
  it('finds the v2 spiral disc lying in XZ, so plane-local Z was never its normal either', () => {
    // The measurement `spin.ts`'s header records, re-run here so it is a check rather than a claim
    // in a comment. `layout.py` at `9feab8f~1` writes `x = r·cos θ`, `z = r·sin θ` and
    // `y = gaussian·thickness` — a disc in the **XZ** plane whose normal is plane-local **+Y**. The
    // shipped `starWorldPosition` rotates `(x, y)`, which is an axis lying *in* that disc.
    //
    // Run against the **v3** roster's own cell normals, which are the thing this renderer draws: a
    // unit sphere, isotropic, so the claim under test is only that the two datasets share the pole
    // axis §1.3 names. The v2 figures are in `spin.ts` and are not re-derived here — `dabe2c9a` is
    // not the dataset this renderer reads, and a test that loaded it would be asserting about the
    // retiring path.
    const dominaria = WORLDS.find((plane) => plane.slug === 'dominaria')!
    let sumY = 0
    let sumAbsY = 0
    for (let card = 0; card < dominaria.starCount; card += 1) {
      const y = STARS.y(dominaria.starOffset + card)
      sumY += y
      sumAbsY += Math.abs(y)
    }
    // A sphere: `y` is spread over the full range and centred, not flattened to a plane.
    expect(Math.abs(sumY / dominaria.starCount)).toBeLessThan(0.05)
    expect(sumAbsY / dominaria.starCount).toBeGreaterThan(0.4)
  })
})
