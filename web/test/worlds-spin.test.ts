/**
 * The spin axis (spec §1.3, CEO ruling on DEC-750) and the local-frame substitution it needs.
 *
 * Two separate claims, and they fail in completely different ways:
 *
 *  1. **The axis is the pole axis.** A world spun about anything else carries §1.3's thirteen
 *     latitude bands around the sky, and W3 — "latitude reads as colour" — stops being a statement
 *     about a fixed thing. The mutant is not exotic: until DEC-774 `starfield/motion.ts`, its
 *     vertex twin and the camera's mirror all spun about plane-local **Z**, so "use the axis the
 *     rest of the app uses" was the natural wrong answer — and it is still measured against below,
 *     because a rotation about an axis lying in the disc is what the wrong answer looks like
 *     whoever writes it next.
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

import { SceneMotion } from '../src/camera/motion'
import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlaneRecord, PlanesFile } from '../src/data/types'
import { planeWorldPosition, starWorldPosition } from '../src/scene/starfield/motion'
import { PlaneTable } from '../src/scene/starfield/planeTable'
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
  artOff: false,
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
    // The negative control for the ruling, and it was the shipped behaviour until DEC-774:
    // `starWorldPosition`, its vertex twin and `camera/motion.ts` all rotated `(x, y)` — about
    // local Z. Under that axis the **north pole itself** sweeps through 0.9 rad, which is §1.3's
    // whole band structure tumbling. Nothing errors and every cell still carries its own swatch,
    // so the picture is a plausible banded globe at the wrong attitude.
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

/**
 * PRD 8.5.7's CPU mirror spins about the same pole this renderer does (DEC-774).
 *
 * **The cross-check the axis never had.** `starfield/motion.ts`, its vertex twin in
 * `starfield/shaders.ts` and `camera/motion.ts` are three implementations of one transform, and
 * `starfield.test.ts` already checks two of them against *each other* — which is a symmetry, not a
 * falsifier: moving all three onto the wrong axis together leaves that row green, and did, for the
 * whole life of the defect. The thing none of them was checked against is the law that decides
 * where the cell is actually drawn, `worldOrientation` above. So this compares the mirror with
 * that, and the negative row below fails on the axis the three of them used to share.
 *
 * **Identity tilt and a stopped multiverse, deliberately.** Two further differences between the
 * mirror and the renderer survive this leg and are not this row's subject: the mirror always
 * applies `tilt` where `planeOrientation` gates it on {@link APPLY_PLANE_TILT} (an owner decision,
 * see `spin.ts`), and the mirror carries PRD 5.3.13's multiverse rotation into the *local* offset
 * where `WorldSurface` applies it only to the centre. Pinning either here would freeze a defect as
 * an expectation. Reported on DEC-774's hand-back instead; the axis is what this row binds.
 */
describe('the CPU motion mirror spins about the pole axis too (DEC-774)', () => {
  /** A real roster row, stripped to the one motion under test. */
  function spinningPlane(): PlaneRecord {
    const source = WORLDS.find((plane) => plane.slug === 'dominaria')!
    return {
      ...source,
      index: 0,
      home: [0, 0, 0],
      tilt: [0, 0, 0, 1],
      driftAmplitude: 0,
      shearAmplitude: 0,
    }
  }

  /** A Fibonacci sphere: v3's cells are unit vectors, so sweep the domain rather than pick one. */
  function unitDirections(count: number): Vector3[] {
    const golden = Math.PI * (3 - Math.sqrt(5))
    const out: Vector3[] = []
    for (let i = 0; i < count; i += 1) {
      const y = 1 - (2 * (i + 0.5)) / count
      const ring = Math.sqrt(Math.max(0, 1 - y * y))
      out.push(new Vector3(Math.cos(golden * i) * ring, y, Math.sin(golden * i) * ring))
    }
    return out
  }

  /** The table, advanced on the frame clock to a spin angle that is nobody's round number. */
  function spunTable(plane: PlaneRecord, seconds: number): PlaneTable {
    const table = new PlaneTable([plane], 130)
    for (let frame = 0; frame < Math.round(seconds * 60); frame += 1) table.advance(1 / 60, 1)
    return table
  }

  it('puts a cell where the world it is drawn on would carry it', () => {
    const plane = spinningPlane()
    const table = spunTable(plane, 17)
    const spin = table.planes[0]!.spinAngle
    expect(Math.abs(spin)).toBeGreaterThan(0.1)

    const centre = { x: 0, y: 0, z: 0 }
    planeWorldPosition(table.raw, 0, table.time, 0, 1, centre)
    const orientation = worldOrientation([0, 0, 0, 1], spin, new Quaternion())
    const aboutZ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), spin)

    const mirror = { x: 0, y: 0, z: 0 }
    const drawn = new Vector3()
    let worst = 0
    for (const local of unitDirections(64)) {
      starWorldPosition(table.raw, 0, local.x, local.y, local.z, table.time, 0, 1, mirror)
      drawn.copy(local).multiplyScalar(plane.radius).applyQuaternion(orientation)
      drawn.x += centre.x
      drawn.y += centre.y
      drawn.z += centre.z
      worst = Math.max(worst, drawn.distanceTo(new Vector3(mirror.x, mirror.y, mirror.z)))
    }
    expect(worst).toBeLessThan(1e-6)

    // The negative control, stated where it has a closed form rather than as a floor over the
    // sweep. Two rotations by the same angle about different axes agree *somewhere* — over these
    // 64 cells the nearest pair is 0.072 radii apart — so a minimum over the sphere cannot be
    // floored honestly. The pole can: the correct axis leaves it exactly where it was, and the axis
    // the mirror used to spin about carries it a chord of `2R·sin(a/2)`, which is §1.3's whole band
    // structure tumbling.
    const polar = new Vector3(0, 1, 0).multiplyScalar(plane.radius)
    const tumbled = polar.clone().applyQuaternion(aboutZ)
    expect(tumbled.distanceTo(polar)).toBeCloseTo(2 * plane.radius * Math.sin(Math.abs(spin) / 2), 9)
    expect(polar.clone().applyQuaternion(orientation).distanceTo(polar)).toBeCloseTo(0, 9)
  })

  it('holds the pole still and carries the equator, in the mirror as in the renderer', () => {
    const plane = spinningPlane()
    const table = spunTable(plane, 17)
    const spin = table.planes[0]!.spinAngle

    const at = (x: number, y: number, z: number): Vector3 => {
      const out = { x: 0, y: 0, z: 0 }
      starWorldPosition(table.raw, 0, x, y, z, table.time, 0, 1, out)
      return new Vector3(out.x, out.y, out.z)
    }
    // The radius reaches the mirror through the plane table's `Float32Array`, so the pole's height
    // is the float32 of `plane.radius` and not its float64 — six decimals, not twelve.
    const pole = at(0, 1, 0)
    expect(pole.x).toBeCloseTo(0, 9)
    expect(pole.y).toBeCloseTo(Math.fround(plane.radius), 6)
    expect(pole.z).toBeCloseTo(0, 9)

    // ...and the equator moves by the whole spin angle, or "the pole is fixed" is satisfied by a
    // mirror that rotates nothing at all. Under half a turn at 17 s, so the unsigned `angleTo`
    // reads the angle itself rather than its reflection.
    expect(Math.abs(spin)).toBeLessThan(Math.PI)
    const equator = at(1, 0, 0)
    expect(equator.angleTo(new Vector3(1, 0, 0))).toBeCloseTo(Math.abs(spin), 6)
  })

  it('agrees with the camera mirror the card tether actually reads', () => {
    const plane = spinningPlane()
    const table = spunTable(plane, 17)
    const motion = new SceneMotion({
      contractVersion: 3,
      shardSize: 2000,
      multiverseRadius: 130,
      planes: [plane],
    })
    // The one clock: the table's, mirrored across exactly as `motionSync.ts` does it.
    motion.syncClock(table.time, table.multiverseAngle)
    motion.syncSpin(0, table.planes[0]!.spinAngle)

    const field = { x: 0, y: 0, z: 0 }
    const camera = { x: 0, y: 0, z: 0 }
    for (const local of unitDirections(32)) {
      starWorldPosition(
        table.raw, 0, local.x, local.y, local.z,
        table.time, table.multiverseAngle, 1, field,
      )
      motion.starPosition(camera, plane, local.x, local.y, local.z)
      expect(camera.x).toBeCloseTo(field.x, 6)
      expect(camera.y).toBeCloseTo(field.y, 6)
      expect(camera.z).toBeCloseTo(field.z, 6)
    }
  })

  it('inverts that placement, so a fly-to framing offset lands in the frame it was chosen in', () => {
    const plane = spinningPlane()
    const table = spunTable(plane, 17)
    const motion = new SceneMotion({
      contractVersion: 3,
      shardSize: 2000,
      multiverseRadius: 130,
      planes: [plane],
    })
    motion.syncClock(table.time, table.multiverseAngle)
    motion.syncSpin(0, table.planes[0]!.spinAngle)

    // `worldToPlaneLocal` is `starPosition`'s inverse without the shear; a forward half on one axis
    // and an inverse half on another is a round trip that quietly is not one.
    const world = { x: 0, y: 0, z: 0 }
    const back = { x: 0, y: 0, z: 0 }
    for (const local of unitDirections(16)) {
      motion.starPosition(world, plane, local.x, local.y, local.z)
      motion.worldToPlaneLocal(back, plane, world)
      expect(back.x).toBeCloseTo(local.x, 6)
      expect(back.y).toBeCloseTo(local.y, 6)
      expect(back.z).toBeCloseTo(local.z, 6)
    }
  })

  /**
   * The other three local-frame halves, each against something that is not its own twin
   * (DEC-863 claim 4).
   *
   * The row above binds `worldToPlaneLocal`, because it is the inverse in a round trip whose
   * forward leg is `starPosition`. The other three halves had nothing: the reviewer moved
   * `planeLocalToWorld` back to local Z on its own and the suite stayed 1378/1378 green, and the
   * same held for `planeLocalDirToWorld` and for `worldDirToPlaneLocal`. `rig.ts:739/746` steers
   * through the two direction halves, so that was a live consumer resting on unguarded code.
   *
   * Rows 1 and 2 are asymmetric on purpose: they bind a half to `starPosition`, which the rows
   * above bind to `worldOrientation` — the law that decides where the cell is drawn. So moving a
   * half *and* its natural twin together is still caught, which a half-against-half row would not
   * be. Rows 3 and 4 are the pair round trips, and those are what catch a half-applied change.
   *
   * Unlike {@link spinningPlane}, these run the roster row as it ships — real tilt, real home,
   * real drift, a live multiverse angle — with only the shear switched off, because that is the
   * one term `planeLocalToWorld` deliberately omits. Seven decimals: `planes.json` emits `tilt` to
   * four, so the conjugate `worldDirToPlaneLocal` applies is an inverse to about 4e-8, not to
   * machine epsilon.
   */
  function tiltedRig(): { plane: PlaneRecord; motion: SceneMotion } {
    const source = WORLDS.find((candidate) => candidate.slug === 'dominaria')!
    // A real tilt, or `applyQuat` and its conjugate are both the identity and rows 3 and 4 pass on
    // any axis at all.
    expect(Math.abs(source.tilt[3])).toBeLessThan(0.999)
    const plane: PlaneRecord = { ...source, index: 0, shearAmplitude: 0 }

    const table = spunTable(plane, 17)
    const motion = new SceneMotion({
      contractVersion: 3,
      shardSize: 2000,
      multiverseRadius: 130,
      planes: [plane],
    })
    motion.syncClock(table.time, table.multiverseAngle)
    motion.syncSpin(0, table.planes[0]!.spinAngle)

    // Both angles have to be off zero, or every row below is stated at the identity.
    expect(Math.abs(table.planes[0]!.spinAngle)).toBeGreaterThan(0.1)
    expect(Math.abs(table.multiverseAngle)).toBeGreaterThan(0.05)
    return { plane, motion }
  }

  /** Nothing on an axis, nothing on the pole alone, nothing symmetric about the local frame. */
  const LOCALS = [
    { x: 0.5, y: 0.2, z: -0.8 },
    { x: 0, y: 1, z: 0 },
    { x: -0.9, y: 0, z: 0.1 },
    { x: 0.4, y: -0.6, z: 0.7 },
  ] as const

  it('places a local offset exactly where `starPosition` places that star, shear aside', () => {
    const { plane, motion } = tiltedRig()
    const viaOffset = { x: 0, y: 0, z: 0 }
    const viaStar = { x: 0, y: 0, z: 0 }
    for (const local of LOCALS) {
      motion.planeLocalToWorld(viaOffset, plane, local)
      motion.starPosition(viaStar, plane, local.x, local.y, local.z)
      expect(viaOffset.x).toBeCloseTo(viaStar.x, 9)
      expect(viaOffset.y).toBeCloseTo(viaStar.y, 9)
      expect(viaOffset.z).toBeCloseTo(viaStar.z, 9)
    }
  })

  it('points a local direction along the bearing that placement puts it on', () => {
    // The direction half drops the radius scale, the home and the drift — PRD 5.7.5's framing
    // offset is a direction, not a point — so it is scored as a bearing from the plane's own
    // centre rather than against a position.
    const { plane, motion } = tiltedRig()
    const star = { x: 0, y: 0, z: 0 }
    const centre = { x: 0, y: 0, z: 0 }
    const dir = { x: 0, y: 0, z: 0 }
    for (const local of LOCALS) {
      motion.starPosition(star, plane, local.x, local.y, local.z)
      motion.planePosition(centre, plane)
      motion.planeLocalDirToWorld(dir, plane, local)

      const chord = new Vector3(star.x - centre.x, star.y - centre.y, star.z - centre.z)
      expect(chord.length()).toBeGreaterThan(1)
      expect(new Vector3(dir.x, dir.y, dir.z).normalize().angleTo(chord.normalize())).toBeCloseTo(
        0,
        7,
      )
    }
  })

  it('round-trips a position through `planeLocalToWorld` and back', () => {
    const { plane, motion } = tiltedRig()
    const world = { x: 0, y: 0, z: 0 }
    const back = { x: 0, y: 0, z: 0 }
    for (const local of LOCALS) {
      motion.planeLocalToWorld(world, plane, local)
      motion.worldToPlaneLocal(back, plane, world)
      expect(back.x).toBeCloseTo(local.x, 7)
      expect(back.y).toBeCloseTo(local.y, 7)
      expect(back.z).toBeCloseTo(local.z, 7)
    }
  })

  it('round-trips a direction through both halves, in both orders', () => {
    // Both orders, so neither half is allowed to be the definition of the other: one composition
    // alone is satisfied by a pair that agree on a wrong axis, and `rig.ts` calls both.
    const { plane, motion } = tiltedRig()
    const world = { x: 0, y: 0, z: 0 }
    const back = { x: 0, y: 0, z: 0 }
    for (const local of LOCALS) {
      motion.planeLocalDirToWorld(world, plane, local)
      motion.worldDirToPlaneLocal(back, plane, world)
      expect(back.x).toBeCloseTo(local.x, 7)
      expect(back.y).toBeCloseTo(local.y, 7)
      expect(back.z).toBeCloseTo(local.z, 7)

      motion.worldDirToPlaneLocal(world, plane, local)
      motion.planeLocalDirToWorld(back, plane, world)
      expect(back.x).toBeCloseTo(local.x, 7)
      expect(back.y).toBeCloseTo(local.y, 7)
      expect(back.z).toBeCloseTo(local.z, 7)
    }
  })
})

describe('the galaxys own axis, as the evidence behind the ruling', () => {
  it('finds the v2 spiral disc lying in XZ, so plane-local Z was never its normal either', () => {
    // The measurement `spin.ts`'s header records, re-run here so it is a check rather than a claim
    // in a comment. `layout.py` at `9feab8f~1` writes `x = r·cos θ`, `z = r·sin θ` and
    // `y = gaussian·thickness` — a disc in the **XZ** plane whose normal is plane-local **+Y**. The
    // `starWorldPosition` rotated `(x, y)` until DEC-774, which is an axis lying *in* that disc.
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
