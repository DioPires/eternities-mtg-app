/**
 * The pass-list cutover (spec §1.1, §1.2): worlds reaching the frame.
 *
 * Every other file under `worlds/` had a test before this one, and the whole suite was green while
 * `__eternitiesProbe.worlds()` returned `undefined` in a browser — because nothing composed a world
 * and nothing ran one on the tick. That is the class of defect this file exists for, so its rows are
 * deliberately about *reachability and wiring* rather than about arithmetic: the phase has a
 * subscriber, the roster composes from the shipped bytes, the payload is the frame it was measured
 * on, and the coexistence §3.2 promises actually costs nothing.
 *
 * **Measured on the shipped v3 dataset**, for the reason `worlds-source.test.ts` gives at length:
 * the attachment's job is agreeing with an emitter, and a fixture it wrote itself cannot check that.
 * The renderer is a stub — jsdom has no WebGL — and everything asserted below is CPU state the
 * shipped path computes, never a pixel.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  type Points,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three'

import { decodeStars, decodeSwatches } from '../src/data/decode'
import { FILTER_MASK_PASS, type PlaneRecord, type PlanesFile } from '../src/data/types'
import { FrameLoop, TICK_PHASES } from '../src/scene/renderer/frameLoop'
import { ImageQueue } from '../src/scene/cards/imageQueue'
import { QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'
import { attachWorlds, DEFAULT_TIER_ART_LAYERS } from '../src/scene/worlds/attachWorlds'
import { KEY_LIGHT_OFF_AXIS, keyLightDirection } from '../src/scene/worlds/keyLight'
import { artPoolSize, LAYER_FREE } from '../src/scene/worlds/artPool'
import { PICK_LAYER } from '../src/scene/picking/idPicker'
import {
  ART_CROP_ADMITTED_MEAN_BYTES,
  ART_CROP_ESTIMATED_BYTES,
  defaultByteBudget,
} from '../src/scene/worlds/artStream'
import { BELT_POINT_SIZE_PX } from '../src/scene/worlds/beltShaders'
import { CROSSOVER_HIGH_PX } from '../src/scene/worlds/lod'
import { isWorldPlane, worldPlanesOf } from '../src/scene/worlds/worldSource'
import { worldsProbeOf } from '../src/scene/worlds/worldsProbe'
import type { WorldsSeams } from '../src/scene/worlds/seams'

/** three's default layer — what the frame camera renders. Named so the asserts below read. */
const DRAW_LAYER = 0

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

/** A spec-minimum WebGL2 device: 256 layers, so §1.6's clamp actually binds at tier 0. */
const SPEC_MINIMUM = { webgl2: true, maxArrayTextureLayers: 256 }

/** CSS pixels. The drawing buffer below is deliberately **twice** this — see the viewport row. */
const CSS_WIDTH = 1920
const CSS_HEIGHT = 1080

interface Harness {
  readonly gl: WebGLRenderer
  readonly getSize: ReturnType<typeof vi.fn>
  readonly getDrawingBufferSize: ReturnType<typeof vi.fn>
  readonly copyTextureToTexture: ReturnType<typeof vi.fn>
  readonly getPixelRatio: ReturnType<typeof vi.fn>
}

/**
 * A renderer stub offering exactly the three members the attachment touches.
 *
 * `getDrawingBufferSize` reports 2x `getSize`, which is a real 2x display and is what makes the
 * CSS-versus-device row below a measurement rather than a restatement: under the wrong call every
 * cell measures twice as tall and the crossover moves a full rung, with a picture that still looks
 * right because the shader never reads either number.
 */
function harness(): Harness {
  const getSize = vi.fn((target: Vector2) => target.set(CSS_WIDTH, CSS_HEIGHT))
  const getDrawingBufferSize = vi.fn((target: Vector2) =>
    target.set(CSS_WIDTH * 2, CSS_HEIGHT * 2),
  )
  const copyTextureToTexture = vi.fn()
  // 2, matching `getDrawingBufferSize`'s 2x above rather than defaulting to 1: §1.8's belt is sized
  // in CSS px and `gl_PointSize` is in device px, so a stub that reported 1 would let the two
  // spellings agree and the CSS-versus-device row below would stop discriminating them.
  const getPixelRatio = vi.fn(() => 2)
  return {
    gl: {
      getSize,
      getDrawingBufferSize,
      copyTextureToTexture,
      getPixelRatio,
    } as unknown as WebGLRenderer,
    getSize,
    getDrawingBufferSize,
    copyTextureToTexture,
    getPixelRatio,
  }
}

function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(55, CSS_WIDTH / CSS_HEIGHT, 0.1, 8000)
  camera.position.set(0, 0, 400)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  return camera
}

/** Put the camera `radii` of a world's own radius away from it, looking at it. */
function poseAt(camera: PerspectiveCamera, centre: Vector3, radius: number, radii: number): void {
  camera.position.copy(centre).add(new Vector3(0, 0, radius * radii))
  camera.lookAt(centre)
  camera.updateMatrixWorld(true)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
}

interface Rig {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  readonly gl: Harness
  readonly worlds: ReturnType<typeof attachWorlds>
  tick: () => void
}

let clock = 0

function build(
  options: Partial<Parameters<typeof attachWorlds>[0]> & { capabilities?: typeof SPEC_MINIMUM } = {},
  /**
   * Omit the `seams` option entirely, so the attachment falls back to reading `location` itself.
   *
   * A flag rather than `seams: undefined`, which `exactOptionalPropertyTypes` rejects — and the
   * distinction is the point of the row that uses it: what is under test is the *absence* of the
   * option, which is how every browser composition is built.
   */
  { seamsFromUrl = false } = {},
): Rig {
  const gl = harness()
  const scene = new Scene()
  const camera = makeCamera()
  const loop = new FrameLoop({ requestFrame: () => 0, cancelFrame: () => {}, now: () => 0 })
  const worlds = attachWorlds({
    gl: gl.gl,
    scene,
    camera,
    loop,
    ...(seamsFromUrl ? {} : { seams: NO_SEAMS }),
    capabilities: SPEC_MINIMUM,
    ...options,
  })
  return {
    scene,
    camera,
    loop,
    gl,
    worlds,
    tick: () => {
      clock += 17
      loop.tick(clock)
    },
  }
}

beforeEach(() => {
  clock = 0
})

const roster = () => ({
  planes: PLANES.planes,
  stars: STARS,
  swatches: SWATCHES,
  multiverseRadius: PLANES.multiverseRadius,
})

describe('the worlds pass reaches the frame (§1.1, §1.2)', () => {
  it('composes one surface per world in the shipped roster, and puts each sheet in the scene', () => {
    const rig = build()
    rig.worlds.setData(roster())

    // Not a literal 45: §1.5 and §1.12 both make the count the dataset's, and a constant is right
    // on exactly one of the two datasets this renderer is guaranteed to meet.
    expect(rig.worlds.surfaces).toHaveLength(WORLDS.length)
    expect(WORLDS.length).toBeGreaterThan(1)

    const group = rig.scene.getObjectByName('worlds')
    expect(group).toBeDefined()
    // Two meshes per world since DEC-751: the drawn sheet and §1.11's pick sheet.
    for (const surface of rig.worlds.surfaces) {
      expect(surface.mesh.parent).toBe(group)
      expect(surface.pickMesh.parent).toBe(group)
      // The layer assignment is the whole of the draw/pick split, and it is silent in BOTH
      // directions: a pick mesh left on layer 0 draws a flat id-coloured shell over the world, and
      // a drawn mesh moved to PICK_LAYER vanishes from the frame while every test that only counts
      // children stays green. Assert each mesh is on its own layer and NOT on the other's.
      expect(surface.pickMesh.layers.isEnabled(PICK_LAYER)).toBe(true)
      expect(surface.pickMesh.layers.isEnabled(DRAW_LAYER)).toBe(false)
      expect(surface.mesh.layers.isEnabled(DRAW_LAYER)).toBe(true)
      expect(surface.mesh.layers.isEnabled(PICK_LAYER)).toBe(false)
      // Same geometry, so the pick target cannot drift from the picture; different material, so
      // one of them can carry ID_PASS.
      expect(surface.pickMesh.geometry).toBe(surface.mesh.geometry)
      expect(surface.pickMesh.material).not.toBe(surface.mesh.material)
      // ...and the SAME uniforms object, not a copy: `uRadius` is an input to where the shader puts
      // a cell, so a copy would leave the pick target correct on frame one and silently wrong after
      // any writer moved it — the picture stays right and only the clicks land on the wrong card.
      expect((surface.pickMesh.material as ShaderMaterial).uniforms).toBe(
        (surface.mesh.material as ShaderMaterial).uniforms,
      )
    }

    // §1.2's other passes share the group (DEC-750), so the sheets are counted by identity rather
    // than by the group's size. Stated as an exact partition rather than as `>= WORLDS.length`: a
    // pass that quietly added a second node per world -- one sheet plus one shell, say -- would
    // satisfy an inequality and would double the scene graph.
    const sheets = new Set(rig.worlds.surfaces.map((surface) => surface.mesh))
    expect(group!.children.filter((child) => sheets.has(child as never))).toHaveLength(
      WORLDS.length,
    )
    // Step 2, step 3, step 8, and §1.9's ribbon with its two pads: six nodes beside the two
    // sheets each world contributes since DEC-751 (drawn + §1.11 pick).
    expect(group!.children).toHaveLength(WORLDS.length * 2 + 6)
    rig.worlds.dispose()
  })

  it('puts the `worlds` phase after `rig` and before `draw`', () => {
    // The selection pass projects every cell, so it needs the camera matrices `rig` made final, and
    // it has to have finished before anything binds a framebuffer. Asserted against the list rather
    // than against behaviour because **behaviour cannot see it here**: this file poses the camera by
    // hand, so no `rig` subscriber exists to be run in the wrong order. A harness that drives the
    // real rig would notice; one that does not would score a reordered list green.
    expect(TICK_PHASES.indexOf('worlds')).toBeGreaterThan(TICK_PHASES.indexOf('rig'))
    expect(TICK_PHASES.indexOf('worlds')).toBeLessThan(TICK_PHASES.indexOf('draw'))
  })

  it('subscribes the `worlds` phase at construction, before any data exists', () => {
    // The subscriber must not arrive with the roster. A phase whose subscription is conditional on
    // data is a phase that can end up with none at all, which is the shape DEC-761's F1 took — and
    // there, the entire suite stayed green while the camera never moved.
    const rig = build()
    expect(rig.loop.stepCount('worlds')).toBe(1)
    rig.worlds.dispose()
    expect(rig.loop.stepCount('worlds')).toBe(0)
  })

  it('runs every composed world on the tick, and nothing before it', () => {
    const rig = build()
    rig.worlds.setData(roster())
    const dominaria = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!

    // Before the first tick the surface has never been measured: its crossover is the constructed
    // default and the probe declines to answer at all.
    expect(rig.worlds.probeSource()).toBeNull()
    expect(worldsProbeOf(rig.worlds.probeSource())).toBeUndefined()

    poseAt(rig.camera, dominaria.centre, dominaria.radius, 2.2)
    rig.tick()

    expect(dominaria.medianCellHeightPx).toBeGreaterThan(0)
    expect(rig.worlds.probeSource()).not.toBeNull()
    rig.worlds.dispose()
  })

  it('reports the world the camera is nearest in its own radii, not in scene units', () => {
    const rig = build()
    rig.worlds.setData(roster())
    // Two worlds far apart in size: the pose sits close to the smaller one in scene units while a
    // larger world is nearer in absolute distance only if the roster happens to place it so. The
    // claim under test is the *metric*, so it is asserted by posing at each in turn.
    for (const slug of ['dominaria', 'alara']) {
      const target = rig.worlds.surfaces.find((s) => s.planeSlug === slug)!
      poseAt(rig.camera, target.centre, target.radius, 2.2)
      rig.tick()
      expect(worldsProbeOf(rig.worlds.probeSource())?.planeSlug).toBe(slug)
    }
    rig.worlds.dispose()
  })

  it('draws a sheet only above §1.5s crossover, and both passes inside the band', () => {
    const rig = build()
    rig.worlds.setData(roster())
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!

    poseAt(rig.camera, world.centre, world.radius, 2.2)
    rig.tick()
    expect(world.medianCellHeightPx).toBeGreaterThanOrEqual(CROSSOVER_HIGH_PX)
    expect(world.crossover).toEqual({ drawSystem: false, drawSheet: true, sheetMix: 1 })
    expect(world.mesh.visible).toBe(true)

    // Far enough that the median cell falls below the band's floor. The sheet stops drawing and
    // R2's step-2 instance takes over; `visible` is the flag that carries it.
    poseAt(rig.camera, world.centre, world.radius, 400)
    rig.tick()
    expect(world.crossover.drawSheet).toBe(false)
    expect(world.mesh.visible).toBe(false)

    // **Inside the band, where both passes draw.** The two poses above cannot see the difference
    // between `drawSheet` and `!drawSystem` — outside the band they are complements, and §1.5 says
    // in terms that a renderer deriving one pass from the other "will be one instance short through
    // every approach". Only a pose in the band separates them, so the band is searched for rather
    // than guessed at: the crossover is a function of distance, so bisection finds it exactly.
    let near = 2.2
    let far = 400
    for (let i = 0; i < 60; i += 1) {
      const mid = (near + far) / 2
      poseAt(rig.camera, world.centre, world.radius, mid)
      rig.tick()
      if (world.crossover.sheetMix > 0 && world.crossover.sheetMix < 1) break
      if (world.crossover.drawSheet) near = mid
      else far = mid
    }
    expect(world.crossover).toMatchObject({ drawSystem: true, drawSheet: true })
    expect(world.crossover.sheetMix).toBeGreaterThan(0)
    expect(world.crossover.sheetMix).toBeLessThan(1)
    expect(world.mesh.visible).toBe(true)
    rig.worlds.dispose()
  })
})

describe('the frame the payload is measured on (§3.1)', () => {
  it('sizes cells in CSS pixels, never in device pixels', () => {
    const rig = build()
    rig.worlds.setData(roster())
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, world.centre, world.radius, 2.2)
    rig.tick()

    // Every threshold in §1.5 and §1.6 is CSS. The stub reports a 2x drawing buffer, so the wrong
    // call is not a rounding difference — it doubles every cell height and the viewport the probe
    // publishes, moving the crossover a full rung with the picture unchanged.
    expect(rig.gl.getSize).toHaveBeenCalled()
    expect(rig.gl.getDrawingBufferSize).not.toHaveBeenCalled()
    expect(worldsProbeOf(rig.worlds.probeSource())?.viewport).toEqual({
      width: CSS_WIDTH,
      height: CSS_HEIGHT,
    })
    rig.worlds.dispose()
  })

  /**
   * **This row was inert until DEC-825, and it read as the tightest one in the file.**
   *
   * It used to assert `probeSource()!.camera` — which is `WorldSurface.localCamera`, scratch the
   * *surface* writes inside `update` and nothing else touches. Two reads taken without a tick
   * between them return that same object in that same state no matter what `runFrame` put in
   * `frame.camera`, so the row scored green against an `attachWorlds` publishing the **live**
   * camera; `mutate-attach.mjs` recorded it LIVE. Its positive control was vacuous for the same
   * reason: it compared the world-space `rig.camera.position` against the *local-frame* camera, a
   * fixed `|centre|` apart at every pose, so `> 1` held with the camera standing still.
   *
   * What actually carries the frame's camera into the payload is `worldCameraPosition`, which is
   * `frame.camera.position` **by reference** — so that is what this asserts now, together with
   * DEC-804's cross-frame invariant, which is the claim §3.1 depends on. See
   * `WorldsProbe.cameraPosition`.
   *
   * **And there is deliberately no assertion on `source.camera` left here**, rather than a weaker
   * one: `localCamera` is written only by `update`, so *every* spelling of it — the shipped one,
   * `frame.camera`, a spread — is stable across two reads taken without a tick between them. A row
   * pinning it cannot go red for any mutation of this file, which is what the old one was. The
   * local frame is checked where it can fail, against `radii`, by the invariant below.
   */
  it('publishes the camera the measurement was made with, not the live one', () => {
    const rig = build()
    rig.worlds.setData(roster())
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, world.centre, world.radius, 2.2)
    rig.tick()

    const measured = worldsProbeOf(rig.worlds.probeSource())!

    // The rig moves the camera every tick and three mutates its matrices **in place**. A payload
    // that held the live camera would report this new pose against the admission state measured at
    // the old one — and the two disagree exactly at the threshold boundary, which is the set W4
    // scores. Nothing about the resulting table looks wrong.
    poseAt(rig.camera, world.centre, world.radius, 9)
    const after = worldsProbeOf(rig.worlds.probeSource())!

    // Positive control, in the frame the claim is made in: the live camera really did move, by four
    // times the world's own radius rather than by float noise.
    expect(rig.camera.position.distanceTo(new Vector3(...measured.cameraPosition))).toBeGreaterThan(
      world.radius * 4,
    )

    expect(after.cameraPosition).toEqual(measured.cameraPosition)
    // DEC-804's invariant, and **not** a tautology: `radii` comes out of the local frame the
    // surface measures in and these two come out of world space, so a payload that paired frame
    // N's admission with frame N+1's camera fails it — here by the same factor of four.
    const published =
      new Vector3(...after.cameraPosition).distanceTo(new Vector3(...after.centre)) / after.radius
    expect(published).toBeCloseTo(after.radii, 6)
    rig.worlds.dispose()
  })
})

/**
 * The three §1.2 passes R2 added are wired through `runFrame`, and each takes a quantity the pass
 * itself cannot check (DEC-773 F2, F3, M3).
 *
 * All three are the same shape: a pass that reports whatever the call site hands it, a unit test
 * that hands it the right thing directly, and a call site nothing asserts. `worlds-tether` proves
 * the ribbon halves nothing on a retina display *given a CSS height*; `worlds-surface-law` proves
 * the crossover computes a `sheetMix`; `worlds-belt` proves `setBeltPixelRatio` multiplies. None of
 * them can see the argument `attachWorlds` actually passes, and the stub here reports a **2x**
 * display precisely so the CSS and device spellings are different numbers.
 */
describe('what runFrame hands R2s three passes (§1.7-§1.9)', () => {
  it('hands the tether the CSS viewport height and never the drawing buffers', () => {
    // **DEC-773 F3.** The prototype's defect was `viewport.y * gl.getPixelRatio()` at this call
    // site — a half-width ribbon on every retina display, identical to a correct one at the dpr 1
    // §3.1's gate runs at. `TetherPass.update` takes the height as a parameter and every row in
    // `worlds-tether.test.ts` supplies it by hand, so the parameter was pinned and the argument was
    // not.
    const rig = build()
    rig.worlds.setData(roster())
    const update = vi.spyOn(rig.worlds.tether, 'update')
    rig.tick()

    expect(update).toHaveBeenCalled()
    // Non-vacuous by construction: the stub's device height is twice its CSS height, so the two
    // candidate arguments are 1080 and 2160 and the assertion separates them.
    const ratio = rig.gl.gl.getPixelRatio()
    expect(ratio).toBe(2)
    expect(CSS_HEIGHT * ratio).not.toBe(CSS_HEIGHT)
    for (const call of update.mock.calls) expect(call[1]).toBe(CSS_HEIGHT)
    rig.worlds.dispose()
  })

  it('re-resolves the belts point size from the live ratio on every frame', () => {
    // **DEC-773 M3.** `runFrame`'s in-source comment says a cached ratio "can be a rung behind" —
    // the quality ladder moves rung 1, and the window crosses monitors — but commenting the call out
    // entirely left the whole suite green, because the only thing that ever read the uniform was the
    // build path. Driven here by *changing* the stub between ticks, which is the monitor change.
    const rig = build()
    rig.worlds.setData(roster())
    const belt = rig.scene.getObjectByName('worlds-belt') as Points
    expect(belt, 'the shipped roster has a dust plane, so there is a belt to measure').toBeDefined()
    const uniforms = (belt.material as ShaderMaterial).uniforms

    rig.tick()
    expect(uniforms.uSizePx!.value).toBe(BELT_POINT_SIZE_PX * 2)

    // The window moves to a 1x monitor. Nothing calls a setter; the next frame re-reads.
    rig.gl.getPixelRatio.mockReturnValue(1)
    rig.tick()
    expect(uniforms.uSizePx!.value).toBe(BELT_POINT_SIZE_PX)

    // And back up, so a write that only ever *lowered* the value fails too.
    rig.gl.getPixelRatio.mockReturnValue(3)
    rig.tick()
    expect(uniforms.uSizePx!.value).toBe(BELT_POINT_SIZE_PX * 3)
    rig.worlds.dispose()
  })

  it('writes §1.5s sheetMix into the uniform the shader reads, not just into the crossover', () => {
    // **DEC-773 F2, and it is the R1 defect this leg exists to fix, one level up.** R1 computed
    // `sheetMix` and nothing consumed it, so the sheet popped on at the band floor. Every assertion
    // in the suite reads `surface.crossover.sheetMix` — the computed value — so replacing the
    // uniform write with a constant `1` restores the pre-fix behaviour exactly and stays green.
    // This row reads `material.uniforms.uSheetMix`, which is what `cellShaders.ts` dissolves by.
    const rig = build()
    rig.worlds.setData(roster())
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    const mixAt = (): number =>
      (world.material.uniforms as { uSheetMix: { value: number } }).uSheetMix.value

    // Above the band the sheet is fully opaque — and the uniform's constructed default is also 1, so
    // this pose alone proves nothing. It is here as the endpoint, not as the measurement.
    poseAt(rig.camera, world.centre, world.radius, 2.2)
    rig.tick()
    expect(world.crossover.sheetMix).toBe(1)
    expect(mixAt()).toBe(1)

    // Inside the band, found by bisection because the crossover is a function of distance: this is
    // the only pose where `sheetMix` is neither 0 nor 1 and the uniform can be told from a constant.
    let near = 2.2
    let far = 400
    for (let i = 0; i < 60; i += 1) {
      const mid = (near + far) / 2
      poseAt(rig.camera, world.centre, world.radius, mid)
      rig.tick()
      if (world.crossover.sheetMix > 0 && world.crossover.sheetMix < 1) break
      if (world.crossover.drawSheet) near = mid
      else far = mid
    }
    expect(world.crossover.sheetMix).toBeGreaterThan(0)
    expect(world.crossover.sheetMix).toBeLessThan(1)
    expect(mixAt()).toBe(world.crossover.sheetMix)
    // Stated against the constants too, so "the uniform equals the field" cannot be satisfied by a
    // build that wrote the same constant into both.
    expect(mixAt()).not.toBe(1)
    expect(mixAt()).not.toBe(0)
    rig.worlds.dispose()
  })
})

describe('§1.7s key light, which the shade term is computed from', () => {
  it('sits 0.798 rad off the camera axis', () => {
    const camera = makeCamera()
    const light = keyLightDirection(camera.matrixWorld, new Vector3())
    // The camera's own +z is the direction back towards the viewer. Not `hypot(0.72, 0.38)`, which
    // is 0.814: composing a turn about `up` with one about `right` is not adding the angles.
    const axis = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2)
    expect(light.dot(axis)).toBeCloseTo(Math.cos(KEY_LIGHT_OFF_AXIS), 12)
    expect(KEY_LIGHT_OFF_AXIS).toBeCloseTo(0.798, 3)
  })

  it('puts 0.72 in azimuth and 0.38 in elevation, and not the other way round', () => {
    // **The off-axis angle cannot see this.** It is `acos(cos(el)·cos(az))`, which is symmetric in
    // the two offsets — so a build with the pair transposed sits at the same 0.798 rad, turns with
    // the camera identically, and still lights the near face. Every row above stays green. What
    // moves is *where* around the axis the light sits: 0.612 right / 0.371 up becomes 0.278 right
    // / 0.659 up, which tilts the terminator across every world by 29 degrees.
    const camera = makeCamera()
    const light = keyLightDirection(camera.matrixWorld, new Vector3())
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    expect(light.dot(right)).toBeCloseTo(Math.cos(0.38) * Math.sin(0.72), 12)
    expect(light.dot(up)).toBeCloseTo(Math.sin(0.38), 12)
    // Stated as an inequality too, so the intent survives a future change of the two constants.
    expect(light.dot(right)).toBeGreaterThan(light.dot(up))
  })

  it('turns with the camera, and lights the face the camera can see', () => {
    const camera = makeCamera()
    const atHome = keyLightDirection(camera.matrixWorld, new Vector3()).clone()

    // Camera-relative is the whole content of §1.7: orbit the camera and the light must follow. A
    // world-space sun would leave this unchanged, and half of every capture set would be black.
    camera.position.set(400, 0, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const orbited = keyLightDirection(camera.matrixWorld, new Vector3())
    expect(orbited.dot(atHome)).toBeLessThan(0.9)

    // ...and the offset is preserved through the orbit, which is what makes it the *same* light.
    const axis = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2)
    expect(orbited.dot(axis)).toBeCloseTo(Math.cos(KEY_LIGHT_OFF_AXIS), 12)

    // A cell facing the viewer must be lit. Inverting the vector is the mutation that passes every
    // magnitude assertion above and darkens the front of every world in the product.
    expect(orbited.dot(axis)).toBeGreaterThan(0)
  })
})

describe('the shared art pool (§1.6, §1.12)', () => {
  it('keys the pool by star index, so a second world still asks for its own art', () => {
    // **Asserted against what the surface hands the stream, never against `artKeyBase` itself.** A
    // row that recomputed `base + card` from the field and checked the set was distinct passed
    // every mutant, including the one that keys `update` by the bare card index — it was pinning a
    // value the call site does not call, which is the shape `worlds-source.test.ts` §B is about.
    const asked: string[] = []
    const queue = {
      request: (request: { key: string }) => {
        asked.push(request.key)
        // Never resolves: this measures which requests are *made*, and letting them land would
        // start filling layers and bring the LRU into a row that is not about eviction.
        return new Promise<never>(() => {})
      },
      cancel: () => {},
      dispose: () => {},
    } as unknown as ImageQueue

    /*
     * **Two one-card worlds, not two big ones, and that is what makes this exact.**
     *
     * On a full roster the collision is only statistical: the pool holds 224 layers against
     * Dominaria's 6,271 cards, so which keys are reserved depends on which cells the pose admits,
     * and a second world's admitted indices may simply miss them. The row then passes under both
     * spellings and reports nothing. Two worlds of **one card each** remove every degree of
     * freedom: each has exactly one cell, index 0, and under the aliased spelling both are pool key
     * **0** — so the second world's request is de-duplicated against the first's and is never filed.
     * Correct keying makes them `starOffset + 0`, two numbers 6,307 apart.
     */
    const tiny = [...WORLDS].sort((a, b) => a.cardCount - b.cardCount).slice(0, 2)
    expect(tiny.map((p) => p.cardCount)).toEqual([1, 1])
    expect(tiny[0]!.starOffset).not.toBe(tiny[1]!.starOffset)

    const rig = build({
      queue,
      cardOf: (plane, card) => ({ printingId: `${plane.slug}:${card}`, imageTs: 1 }),
    })
    rig.worlds.setData({
      planes: [...tiny, ...PLANES.planes.filter((p) => !isWorldPlane(p))],
      stars: STARS,
      swatches: SWATCHES,
      multiverseRadius: PLANES.multiverseRadius,
    })

    /*
     * Posed along the cell's **own normal**, in two steps.
     *
     * A one-card world has a single cell sitting at an arbitrary longitude on the equator (row 0 of
     * `[1]`, centre colatitude pi/2), so a fixed `+z` approach faces the back of it as often as the
     * front — and a back-facing cell is never admitted, which would make this row pass by drawing
     * nothing. The normal is read off the payload rather than recomputed here, for the reason
     * `WorldsProbeSource` exists: a second model of §2.1 beside the renderer's is a second thing to
     * keep in agreement. One tick to get a payload, then the real pose.
     */
    const normal = new Vector3()
    for (const surface of rig.worlds.surfaces) {
      poseAt(rig.camera, surface.centre, surface.radius, 2.2)
      rig.tick()
      rig.worlds.probeSource()!.normalOf(0, normal)
      rig.camera.position.copy(normal).multiplyScalar(surface.radius * 2.2).add(surface.centre)
      rig.camera.lookAt(surface.centre)
      rig.camera.updateMatrixWorld(true)
      rig.camera.matrixWorldInverse.copy(rig.camera.matrixWorld).invert()
      rig.tick()
      expect(surface.wasAdmitted(0)).toBe(true)
    }

    // One pool serves the whole multiverse (§1.12 budgets exactly one). Under a 0-based per-world
    // card index the second world's only cell shows the **first world's art**, at full opacity, for
    // the session: no fetch fails, no counter moves, and the pool's own resident invariant still
    // holds. The only symptom is a card wearing another plane's picture.
    expect(asked).toEqual([
      `worlds-art:${tiny[0]!.slug}:0`,
      `worlds-art:${tiny[1]!.slug}:0`,
    ])
    rig.worlds.dispose()
  })

  it('allocates the clamped pool size, and reports the number it allocated', () => {
    const rig = build()
    rig.worlds.setData(roster())
    // §1.12: tier 0 asks for 1,024 and a spec-minimum device gives 224. The gate must read this
    // back rather than assume the constant — an assertion written against 1,024 passes on this Mac
    // and fails on the hardware W0.1 is about to measure.
    expect(rig.worlds.pool.layers).toBe(artPoolSize(DEFAULT_TIER_ART_LAYERS, 256))
    expect(rig.worlds.pool.layers).toBe(224)
    expect(rig.worlds.pool.layers).not.toBe(DEFAULT_TIER_ART_LAYERS)
    rig.worlds.dispose()
  })

  it('gives `?layers=N` the pool, without routing it through the quality ladder', () => {
    const rig = build({ seams: { ...NO_SEAMS, layersRequested: 8 } })
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers).toBe(8)
    rig.worlds.dispose()
  })

  it('resizes the pool when the ladder steps the rung, and rebinds the surfaces to it', () => {
    // §1.12's rung, landed (DEC-751). R1 left this throwing, so the ladder could not reach the
    // pool at all; the sheets hold the array texture the pool was allocated with, which is why the
    // rung recomposes rather than patching a size in place.
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setData(roster())
    const before = rig.worlds.pool
    expect(before.layers).toBe(QUALITY_TIERS[0]!.artPoolLayers)

    rig.worlds.setArtLayers(QUALITY_TIERS[3]!.artPoolLayers)
    expect(rig.worlds.pool.layers).toBe(QUALITY_TIERS[3]!.artPoolLayers)
    // A different pool object, and a roster still composed against it. Asserting the number alone
    // would pass an implementation that resized the pool and left every sheet sampling the old,
    // disposed array texture — which draws a plausible picture until the driver reclaims it.
    expect(rig.worlds.pool).not.toBe(before)
    expect(rig.worlds.surfaces).toHaveLength(WORLDS.length)
    // Two per world: the drawn sheet and §1.11's pick sheet, beside §1.2's six pass nodes
    // (DEC-750). A rung step recomposes the roster, so this also catches a rebuild that forgot to
    // re-add the pick mesh — which would leave the worlds unpickable from the first quality step
    // onward, with the picture unchanged — and one that leaked or dropped a pass node.
    expect(rig.scene.getObjectByName('worlds')!.children).toHaveLength(WORLDS.length * 2 + 6)

    // And back up: the rung is not one-way, and PRD 8.5.11's restore step walks it.
    rig.worlds.setArtLayers(QUALITY_TIERS[0]!.artPoolLayers)
    expect(rig.worlds.pool.layers).toBe(QUALITY_TIERS[0]!.artPoolLayers)
    rig.worlds.dispose()
  })

  it('remembers a rung announced before the first world composes', () => {
    // The half a throwing stub could not express, and the one the shipped boot order actually
    // takes: the tier is announced once at startup and the pool is not allocated until a roster
    // arrives. Dropping the rung there allocates tier 0's 48 MiB on a machine that asked for 6.
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setArtLayers(QUALITY_TIERS[4]!.artPoolLayers)
    expect(rig.worlds.pool.layers).toBe(0)
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers).toBe(QUALITY_TIERS[4]!.artPoolLayers)
    expect(rig.worlds.pool.layers).not.toBe(DEFAULT_TIER_ART_LAYERS)
    rig.worlds.dispose()
  })

  it('reports the clamped size after a rung, never the size the rung asked for', () => {
    // The rung goes through §1.6's clamp exactly as the initial allocation does. On a spec-minimum
    // device rung 0's 1,024 and rung 3's 128 read 224 and 128 — so the rung is still live here,
    // which is the property that picked 128 over the first draft's 256.
    const rig = build()
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers).toBe(224)
    rig.worlds.setArtLayers(QUALITY_TIERS[3]!.artPoolLayers)
    expect(rig.worlds.pool.layers).toBe(artPoolSize(QUALITY_TIERS[3]!.artPoolLayers, 256))
    expect(rig.worlds.pool.layers).toBe(128)
    rig.worlds.dispose()
  })

  it('lets `?layers=N` override the rung, so a gate row measures the pool it asked for', () => {
    // `?layers=` is not `?quality=` (`seams.ts`), and the ladder must not be able to take it back:
    // W4's expected-GREEN row pins the pool and leaves the policy alone, so a tier change during
    // the run would silently re-parameterise the criterion.
    const rig = build({
      seams: { ...NO_SEAMS, layersRequested: 8 },
      capabilities: { webgl2: true, maxArrayTextureLayers: 2048 },
    })
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers).toBe(8)
    rig.worlds.setArtLayers(QUALITY_TIERS[0]!.artPoolLayers)
    expect(rig.worlds.pool.layers).toBe(8)
    rig.worlds.dispose()
  })

  it('treats `?layers=0` as a legal swatch-only world rather than a black one', () => {
    const rig = build({ seams: { ...NO_SEAMS, layersRequested: 0 } })
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers).toBe(0)
    expect(rig.worlds.surfaces).toHaveLength(WORLDS.length)
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, world.centre, world.radius, 2.2)
    rig.tick()
    // Every cell draws its swatch, which is what §1.4's shading path already does with nothing
    // resident — and the payload is still a measurement, not a setup failure.
    expect(worldsProbeOf(rig.worlds.probeSource())?.pool.layers).toBe(0)
    rig.worlds.dispose()
  })
})

/**
 * §1.6's stream report, **on the shipped path** (DEC-778).
 *
 * `worlds-served-probe.test.ts` pins the payload's shape against a hand-built report; that proves
 * the field is carried and nothing about where its numbers come from. These rows drive the real
 * `ArtStream` through `attachWorlds` and read the counters back off `?probe=`, because the whole
 * purpose of the field is a claim about what the *renderer's* stream did — and a constant cannot
 * testify to its own provenance.
 *
 * Every assertion below is a **matrix**, never a single reading. §1.6 counts three decline causes
 * separately precisely so W4's control can tell them apart, so each cause is shown non-zero under
 * the input that produces it *and* zero under a control that differs in one thing: a row that only
 * showed `declinedBudget > 0` under a zero budget would score identically against a stream that
 * incremented all three counters together.
 */
/** A queue whose requests never land: rows using it measure what is *asked*, not what arrives. */
function pendingQueue(): ImageQueue {
  return {
    request: () => new Promise<never>(() => {}),
    cancel: () => {},
    dispose: () => {},
  } as unknown as ImageQueue
}

/** `printingId`s the stream can build a URL from — the wiring DEC-772 found missing. */
const CARD_OF = (plane: { slug: string }, card: number) => ({
  printingId: `${plane.slug}:${card}`,
  imageTs: 1,
})

/** Compose, pose at Dominaria and tick — the pose §3.1 states W4 at. */
function readAt(rig: Rig, ticks = 1) {
  const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
  poseAt(rig.camera, world.centre, world.radius, 2.2)
  for (let i = 0; i < ticks; i += 1) rig.tick()
  return worldsProbeOf(rig.worlds.probeSource())!
}

/**
 * A queue that actually delivers a body (DEC-782 N3).
 *
 * Every row that predates it uses {@link pendingQueue} or a failing queue, so until it existed **no
 * row in either touched file resolved a fetch on the shipped `attachWorlds` path** — and `report()`
 * could hardcode `resolved: 0` with both files staying green. The success path is also the only one
 * that charges `bytesFetched` from a body that *worked*, which the spec asserts and nothing
 * exercised through the probe.
 */
function resolvingQueue(bytes: number): ImageQueue {
  return {
    request: () =>
      Promise.resolve({
        ok: true,
        bytes,
        // `ArtStream` uploads this and then closes it; the stub only has to survive both.
        bitmap: { width: 128, height: 93, close: () => {} },
      }),
    cancel: () => {},
    dispose: () => {},
  } as unknown as ImageQueue
}

describe('§1.6 the stream report reaches the probe (DEC-778)', () => {
  it('publishes zeros for a wired stream that nothing asked — not `null`', () => {
    // The control every row below is read against, and a real state rather than a contrivance:
    // this is the composition DEC-772 found shipped, where the stream existed and no cell could
    // reach it because `sceneHost` supplied no `cardOf`. The payload has to be able to say that,
    // and it must not say it the way a world with no stream at all says it.
    const rig = build({ queue: pendingQueue() })
    rig.worlds.setData(roster())
    const probe = readAt(rig)
    expect(probe.stream).not.toBeNull()
    expect(probe.stream).toEqual({
      bytesFetched: 0,
      // Zero because nothing has been *asked*, not because nothing has landed (DEC-780). This world
      // has no `cardOf`, so no request ever issues and nothing is ever charged at issue time either
      // — the all-zero report stays exactly as true of the wired-but-idle state as it was.
      bytesReserved: 0,
      // Nothing resident either, which after DEC-812 is the field the budget is tested against.
      bytesOutstanding: 0,
      byteBudget: defaultByteBudget(probe.pool.layers),
      swatchOnly: false,
      requested: 0,
      resolved: 0,
      failed: 0,
      declinedExhausted: 0,
      declinedBudget: 0,
      declinedFailedBefore: 0,
    })
    rig.worlds.dispose()
  })

  it('publishes `null` where there is no stream, which `?layers=0` is', () => {
    // A zero-layer pool builds no `ArtStream` at all (§1.6's legal swatch-only world). That is a
    // different sentence from the row above and the payload keeps it different: a synthesised
    // zero report here would tell the gate a 64 MiB budget is unspent on a session that has no
    // budget, no queue and no possibility of art.
    const rig = build({ queue: pendingQueue(), cardOf: CARD_OF, seams: { ...NO_SEAMS, layersRequested: 0 } })
    rig.worlds.setData(roster())
    const probe = readAt(rig)
    expect(probe.pool.layers).toBe(0)
    expect(probe.stream).toBeNull()
    rig.worlds.dispose()
  })

  it('counts a budget decline as `declinedBudget`, and an unspent budget as none', () => {
    // **This row used to drive its decline with `byteBudget: 0`, and since DEC-819 that budget
    // reaches swatch-only without a single decline.** The threshold is now taken against the
    // smaller of the pool and what the budget can keep resident, so a budget of zero affords zero
    // cells, the frame admits nothing, and nothing is ever *asked* for the budget to refuse — see
    // the row below, which is that case asserted in its own terms. A budget of one body still
    // declines, because the quantile picks a bucket EDGE: where the crossing bucket is the first
    // non-empty one it admits that whole bucket rather than nothing at all (DEC-768 F1), and the
    // overshoot is what the budget refuses. That residual is the shipped behaviour, so it is what
    // this plumbing row is driven with rather than a contrivance.
    const declined = build({
      queue: pendingQueue(),
      cardOf: CARD_OF,
      byteBudget: ART_CROP_ADMITTED_MEAN_BYTES,
    })
    declined.worlds.setData(roster())
    const spent = readAt(declined)
    expect(spent.stream?.swatchOnly).toBe(true)
    expect(spent.stream?.declinedBudget).toBeGreaterThan(0)
    // A handful asked for and the rest refused — not the whole want set, which is what a threshold
    // blind to the budget would have asked for.
    expect(spent.stream?.requested).toBeGreaterThan(0)
    expect(spent.stream?.requested).toBeLessThan(spent.stream!.declinedBudget)
    // The cause is the budget and not the pool: this world's pool is 224 layers and untouched.
    expect(spent.stream?.declinedExhausted).toBe(0)
    expect(spent.stream?.declinedFailedBefore).toBe(0)
    declined.worlds.dispose()

    // **The non-binding control.** Same rig, same pose, same roster, one input changed. Without it
    // a stream that declined everything for any reason at all would score the row above green.
    const funded = build({ queue: pendingQueue(), cardOf: CARD_OF })
    funded.worlds.setData(roster())
    const asking = readAt(funded)
    expect(asking.stream?.swatchOnly).toBe(false)
    expect(asking.stream?.declinedBudget).toBe(0)
    expect(asking.stream?.requested).toBeGreaterThan(0)
    funded.worlds.dispose()
  })

  it('reaches swatch-only on a zero budget by POLICY, with nothing asked and nothing refused', () => {
    // §1.6's documented degenerate case, and what DEC-819 changed about it. A budget of zero
    // affords zero cells, so the threshold admits nothing and the world is swatch-only the way a
    // zero-layer pool is: by never asking. Before the threshold read bytes, the same rig admitted
    // every wanting cell and the stream refused them one at a time — swatch-only by *exhaustion*,
    // which is the state §1.6's quantile exists to remove, reached here on the smallest budget
    // there is.
    //
    // **`swatchOnly` is what still carries the cause, and the gate reads that one.** §3.1's W4
    // disqualification is `budgetBoundAtEntry`, which reads `swatchOnly` off the entry report and
    // never `declinedBudget` — DEC-812 rider 2 removed exactly that re-derivation. So a session
    // whose budget is spent is still legible as budget-bound with this counter at zero.
    const broke = build({ queue: pendingQueue(), cardOf: CARD_OF, byteBudget: 0 })
    broke.worlds.setData(roster())
    const quiet = readAt(broke)
    expect(quiet.stream?.swatchOnly).toBe(true)
    expect(quiet.stream?.requested).toBe(0)
    expect(quiet.stream?.declinedBudget).toBe(0)
    // Not exhaustion either: the pool is untouched and has every layer free. Neither counter rising
    // is the point — there was no want to refuse.
    expect(quiet.stream?.declinedExhausted).toBe(0)
    expect(quiet.pool.resident).toBe(0)
    expect(quiet.pool.layers).toBeGreaterThan(0)
    // The threshold is the thing that moved, and it says so: no cell is above it.
    expect(quiet.cells.some((c) => c.frontFacing && c.onScreen && c.wantsArt)).toBe(false)
    broke.worlds.dispose()

    // **The non-binding control for this row too.** The same rig at the shipped default admits
    // cells — so "nothing wanted art" above is the budget's doing and not a pose with no demand in
    // it, which would make every assertion here vacuous.
    const funded = build({ queue: pendingQueue(), cardOf: CARD_OF })
    funded.worlds.setData(roster())
    const asking = readAt(funded)
    expect(asking.cells.some((c) => c.frontFacing && c.onScreen && c.wantsArt)).toBe(true)
    funded.worlds.dispose()
  })

  it('counts a pool with nothing to give as `declinedExhausted`, and a full one as none', () => {
    // `?artThreshold=fixed24` is the seam §3.1's W4 control drives exhaustion with; here the pool
    // is pinned at one layer instead, which reaches the same refusal without also moving the
    // threshold — so the counter that rises is attributable to the pool alone.
    const starved = build({
      queue: pendingQueue(),
      cardOf: CARD_OF,
      seams: { ...NO_SEAMS, layersRequested: 1 },
    })
    starved.worlds.setData(roster())
    const short = readAt(starved)
    expect(short.pool.layers).toBe(1)
    expect(short.stream?.declinedExhausted).toBeGreaterThan(0)
    // One layer, so exactly one key is ever reserved and asked for. Every other want is refused by
    // the pool, and by the pool only — the budget is untouched.
    expect(short.stream?.requested).toBe(1)
    expect(short.stream?.declinedBudget).toBe(0)
    starved.worlds.dispose()

    // The control: the clamped 224-layer pool at the same pose declines nothing for exhaustion.
    const roomy = build({ queue: pendingQueue(), cardOf: CARD_OF })
    roomy.worlds.setData(roster())
    const ample = readAt(roomy)
    expect(ample.pool.layers).toBe(224)
    expect(ample.stream?.declinedExhausted).toBe(0)
    roomy.worlds.dispose()
  })

  it('charges the bytes of a body that failed to decode, and refuses that key after', async () => {
    // The third cause, and the one that carries `bytesFetched` with it. A body that arrived and
    // then failed to decode HAS been paid for (§1.6), so this row is the only place the published
    // byte count is non-zero — and it is the queue's own `Blob.size`, never the Resource Timing
    // API, which reads 0 for Scryfall cross-origin without `Timing-Allow-Origin` (DEC-772).
    const BYTES = 90_112
    const failing = {
      request: () => Promise.resolve({ ok: false, reason: 'failed', bytes: BYTES }),
      cancel: () => {},
      dispose: () => {},
    } as unknown as ImageQueue
    const rig = build({ queue: failing, cardOf: CARD_OF, seams: { ...NO_SEAMS, layersRequested: 1 } })
    rig.worlds.setData(roster())
    // One tick files the request; the settle is a microtask, so it lands before the second tick
    // asks again — and the second ask is the one that must be refused by the never-retry set.
    const first = readAt(rig)
    expect(first.stream?.requested).toBe(1)
    await Promise.resolve()
    const second = readAt(rig)
    expect(second.stream?.failed).toBe(1)
    expect(second.stream?.bytesFetched).toBe(BYTES)
    expect(second.stream?.declinedFailedBefore).toBeGreaterThan(0)
    // Charged, and still far under budget: `swatchOnly` must not trip on one failed body.
    expect(second.stream?.byteBudget).toBe(defaultByteBudget(second.pool.layers))
    expect(second.stream?.swatchOnly).toBe(false)
    rig.worlds.dispose()
  })

  it('counts a body that arrived as `resolved`, and charges its bytes (DEC-782 N3)', async () => {
    const BYTES = 96_159
    const rig = build({
      queue: resolvingQueue(BYTES),
      cardOf: CARD_OF,
      seams: { ...NO_SEAMS, layersRequested: 1 },
    })
    rig.worlds.setData(roster())
    const first = readAt(rig)
    expect(first.stream?.requested).toBe(1)
    // Still zero at this instant, which is the point: the request has issued and nothing has landed.
    expect(first.stream?.resolved).toBe(0)
    expect(first.stream?.bytesFetched).toBe(0)
    // ...and DEC-780's charge is already standing against the budget, before any byte exists.
    expect(first.stream?.bytesReserved).toBe(ART_CROP_ESTIMATED_BYTES)

    // Two microtasks: the queue's own settle, then the stream's continuation past its `await`.
    await Promise.resolve()
    await Promise.resolve()
    const second = readAt(rig)
    expect(second.stream?.resolved).toBe(1)
    expect(second.stream?.bytesFetched).toBe(BYTES)
    // Reconciled: the estimate is gone and the real body replaced it. Asserting the pair is what
    // separates "charged at issue and released" from "never charged at all" — both read
    // `bytesReserved === 0` here, and only this one also moved `bytesFetched`.
    expect(second.stream?.bytesReserved).toBe(0)
    expect(second.stream?.failed).toBe(0)
    expect(second.stream?.declinedFailedBefore).toBe(0)
    rig.worlds.dispose()
  })

  it('binds the byte budget mid-frame on the SHIPPED path, with a non-binding control (DEC-780)', () => {
    // The unit rows in `worlds-art-fetch.test.ts` prove this against `ArtStream` directly. This one
    // proves the composition has it: `attachWorlds` builds the stream, the selection pass issues
    // every want for the pose in ONE tick, and the budget has to refuse part-way through that tick.
    // A budget consulted on landed bytes cannot — nothing has landed inside a single tick.
    const ADMITS = 4
    const bound = build({
      queue: pendingQueue(),
      cardOf: CARD_OF,
      byteBudget: ART_CROP_ESTIMATED_BYTES * ADMITS,
      // Far more layers than the budget admits, so a refusal here cannot be exhaustion in disguise.
      seams: { ...NO_SEAMS, layersRequested: 256 },
    })
    bound.worlds.setData(roster())
    const capped = readAt(bound)
    expect(capped.stream?.requested).toBe(ADMITS)
    expect(capped.stream?.declinedBudget).toBeGreaterThan(0)
    expect(capped.stream?.declinedExhausted).toBe(0)
    expect(capped.stream?.swatchOnly).toBe(true)
    // Zero bytes have landed — the whole of the DEC-780 defect in one assertion.
    expect(capped.stream?.bytesFetched).toBe(0)
    expect(capped.stream?.bytesReserved).toBe(ART_CROP_ESTIMATED_BYTES * ADMITS)
    bound.worlds.dispose()

    // The control: same roster, same pose, same pool, same tick — only the budget moves. Without it
    // a stream that had simply capped outstanding requests at four would pass the row above.
    const slack = build({
      queue: pendingQueue(),
      cardOf: CARD_OF,
      seams: { ...NO_SEAMS, layersRequested: 256 },
    })
    slack.worlds.setData(roster())
    const free = readAt(slack)
    expect(free.stream?.requested).toBeGreaterThan(ADMITS)
    expect(free.stream?.declinedBudget).toBe(0)
    expect(free.stream?.swatchOnly).toBe(false)
    slack.worlds.dispose()
  })
})

/**
 * §1.6's swatch-only control seam, `?art=off` (DEC-821; board ruling `art_off_seam` on DEC-752).
 *
 * The seam exists because at §3.1's 2.2-radii pose the capture is almost entirely **art** —
 * `artFraction` measures **0.987–0.997** over four dominaria sessions (DEC-752, main `28d4676`;
 * the 0.61–0.76 recorded on DEC-816 predates DEC-812's budget rise) — so `?swatch=mean` and
 * `?bands=shuffle`, which perturb the *swatch*, move nothing a screenshot can see. Its whole
 * contract is therefore a **pair** of claims, and both are scored below: art is gone, and **nothing
 * else is**. A seam that also moved the pool, the threshold or the admitted set would hand W2 and
 * W3 a control whose readings differ from the build for a reason that has nothing to do with the
 * criterion.
 *
 * Every row is a matrix against a no-seam sibling built from the same roster at the same pose, for
 * the reason the block above gives: a rig that asked for nothing because its queue, its budget or
 * its `cardOf` was missing would score the seam green without the seam existing.
 */
describe('§1.6 `?art=off` — the swatch-only control seam (DEC-821)', () => {
  /** Enough ticks for a resolved layer to finish §1.6's 200 ms cross-fade at 17 ms a frame. */
  const TICKS = 14
  const BYTES = 96_159

  /** Pose at Dominaria, tick, and drain the two microtasks each landing body needs. */
  async function drawArtAt(rig: Rig, ticks: number) {
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, world.centre, world.radius, 2.2)
    for (let i = 0; i < ticks; i += 1) {
      rig.tick()
      // The queue's own settle, then the stream's continuation past its `await`.
      await Promise.resolve()
      await Promise.resolve()
    }
    return {
      probe: worldsProbeOf(rig.worlds.probeSource())!,
      /** The attribute the shader samples the pool with: `LAYER_FREE` is "draw the swatch". */
      layers: world.sheet.layers.array as Float32Array,
    }
  }

  it('asks for nothing and draws nothing, against a control that does both', async () => {
    const off = build({
      queue: resolvingQueue(BYTES),
      cardOf: CARD_OF,
      seams: { ...NO_SEAMS, artOff: true },
    })
    off.worlds.setData(roster())
    const dark = await drawArtAt(off, TICKS)
    // The pool is untouched, and untouched by the only thing that could touch it: a stream that
    // exists, is funded and has a `cardOf` to build URLs from. All three of those are true here.
    expect(dark.probe.stream).not.toBeNull()
    expect(dark.probe.stream?.requested).toBe(0)
    expect(dark.probe.stream?.bytesFetched).toBe(0)
    expect(dark.probe.stream?.bytesReserved).toBe(0)
    expect(dark.probe.pool.resident).toBe(0)
    expect(dark.probe.pool.evictions).toBe(0)
    // `artFraction` is `showing / wanting` (§3.1). Its numerator is zero...
    expect(dark.probe.cells.filter((c) => c.showingArt)).toEqual([])
    // ...and its denominator is **not**, which is what makes that a measurement rather than a pose
    // with nothing on screen: these cells asked, and every one of them drew its swatch instead.
    expect(dark.probe.cells.filter((c) => c.wantsArt).length).toBeGreaterThan(0)
    expect([...dark.layers].every((layer) => layer === LAYER_FREE)).toBe(true)
    off.worlds.dispose()

    // The control: same roster, same pose, same queue, same tick count, one input changed.
    const lit = build({ queue: resolvingQueue(BYTES), cardOf: CARD_OF })
    lit.worlds.setData(roster())
    const shown = await drawArtAt(lit, TICKS)
    expect(shown.probe.stream?.requested).toBeGreaterThan(0)
    expect(shown.probe.pool.resident).toBeGreaterThan(0)
    expect(shown.probe.cells.some((c) => c.showingArt)).toBe(true)
    expect([...shown.layers].some((layer) => layer !== LAYER_FREE)).toBe(true)
    lit.worlds.dispose()
  })

  it('moves the picture and NOTHING else — same threshold, same admitted set, same pool', () => {
    // `pendingQueue` on both sides so nothing lands: the subject here is what the frame *decided*,
    // and residency would only add a difference the seam is allowed to have.
    const off = build({
      queue: pendingQueue(),
      cardOf: CARD_OF,
      seams: { ...NO_SEAMS, artOff: true },
    })
    off.worlds.setData(roster())
    const dark = readAt(off)
    const darkThreshold = off.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!.threshold
    const on = build({ queue: pendingQueue(), cardOf: CARD_OF })
    on.worlds.setData(roster())
    const lit = readAt(on)
    const litThreshold = on.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!.threshold

    // Bit equality on §1.6's whole report — the quantile, its hysteresis, and the wanting and
    // admitted counts, which the payload folds down to one number. This is the assertion that makes
    // `?art=off&swatch=mean` a *control* for W2 rather than a second variable: the two runs measure
    // the same cells, want the same art and admit at the same height.
    expect(darkThreshold).toEqual(litThreshold)
    expect(darkThreshold.wanting).toBeGreaterThan(0)
    expect(dark.cells.filter((c) => c.wantsArt).map((c) => c.cell)).toEqual(
      lit.cells.filter((c) => c.wantsArt).map((c) => c.cell),
    )
    expect(dark.cells.map((c) => c.height)).toEqual(lit.cells.map((c) => c.height))

    // **Not `?layers=0`.** That seam is also swatch-only and it reaches it by composing no stream
    // against a zero-layer pool, which moves the quantile's own divisor and publishes `null` where
    // the report should be. This one leaves both standing; the payload is how the gate can tell.
    expect(dark.pool).toEqual(lit.pool)
    expect(dark.pool.layers).toBeGreaterThan(0)
    expect(dark.stream).not.toBeNull()

    // The one difference, in both directions.
    expect(dark.stream?.requested).toBe(0)
    expect(lit.stream?.requested).toBeGreaterThan(0)
    off.worlds.dispose()
    on.worlds.dispose()
  })

  it('reads the seam off the URL when the host passes none, with an absent-param control', () => {
    // **The join, not the parser** — `worlds-art-stream.test.ts` pins `readWorldsSeams('?art=off')`
    // and that is a claim about a string. Leg G drives a *URL*, so what has to be true is that the
    // attachment consults `location` at all when its host hands it no seams: a composition that
    // defaulted to an all-false record instead would run the unmodified policy under every seam on
    // the surface, with the whole matrix scoring controls it never applied. The row is written on
    // `?art=off` because it is this leg's, and it is the only test in the suite of that line.
    vi.stubGlobal('location', { search: '?art=off' })
    try {
      const rig = build({}, { seamsFromUrl: true })
      rig.worlds.setData(roster())
      expect(readAt(rig).seams.artOff).toBe(true)
      rig.worlds.dispose()

      vi.stubGlobal('location', { search: '?plane=dominaria' })
      const bare = build({}, { seamsFromUrl: true })
      bare.worlds.setData(roster())
      expect(readAt(bare).seams.artOff).toBe(false)
      bare.worlds.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('echoes the seam in `worlds().seams`, with a no-seam control that reads false', () => {
    // §1.6's read-back rule, on the sixth seam: without it a seam that silently failed to parse
    // would run the unmodified policy and hand the matrix a control it had scored green.
    const off = build({ seams: { ...NO_SEAMS, artOff: true } })
    off.worlds.setData(roster())
    expect(readAt(off).seams.artOff).toBe(true)
    off.worlds.dispose()

    const on = build()
    on.worlds.setData(roster())
    expect(readAt(on).seams.artOff).toBe(false)
    on.worlds.dispose()
  })
})

/**
 * §1.6's quantile and hysteresis **on the shipped path** (DEC-768 F1, F2).
 *
 * `worlds-art-stream.test.ts` pins both mechanisms at the unit, against hand-built histograms. This
 * block is the other half, and the half neither finding could be seen from: both defects are about
 * what happens when the shipped composition — the real v3 roster, one shared pool and one shared
 * threshold, forty-five surfaces running in roster order — meets a real pose. F1 needs a world
 * whose demand is concentrated enough that one bucket outruns the pool, which is a property of the
 * dataset. F2 needs a **neighbour**, which a one-surface harness does not have.
 */
describe('§1.6 on the shipped roster (DEC-768 F1, F2)', () => {
  /** The two poses §3.1 states W4 at, swept over every world. */
  const POSES = [1.8, 2.2]

  interface PoseReading {
    readonly slug: string | null
    readonly radii: number
    readonly wanting: number
    readonly admitted: number
  }

  function sweep(capacity: number): PoseReading[] {
    const rig = build({ seams: { ...NO_SEAMS, layersRequested: capacity } })
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers, 'the sweep must run at the capacity it names').toBe(capacity)
    const readings: PoseReading[] = []
    for (const surface of rig.worlds.surfaces) {
      for (const radii of POSES) {
        poseAt(rig.camera, surface.centre, surface.radius, radii)
        rig.tick()
        const report = surface.threshold
        readings.push({
          slug: surface.planeSlug,
          radii,
          wanting: report.wanting,
          admitted: report.admitted,
        })
      }
    }
    rig.worlds.dispose()
    return readings
  }

  it('never leaves the pool idle in front of a world that wants art — F1', () => {
    // 128 is tier 4, §1.12's smallest rung and the one this is reachable at today through R1's own
    // `?layers=` seam. Before the crossing-bucket branch, `dominaria` admitted **0 of 128** at both
    // poses — 961 and 922 wanting cells, every layer idle — which is strictly worse than the
    // `fixed24` prototype §1.6 replaces, and puts W4's `artFraction` at zero for a reason that is
    // not the renderer running out of pool, the one thing W4 exists to distinguish.
    const readings = sweep(128)

    // The denominator, always: "no idle poses" and "I measured no poses" must not print the same.
    expect(readings).toHaveLength(WORLDS.length * POSES.length)
    const withDemand = readings.filter((r) => r.wanting > 0)
    expect(withDemand.length, 'poses with any demand at all').toBeGreaterThan(40)

    const idle = withDemand.filter((r) => r.admitted === 0)
    expect(idle.map((r) => `${r.slug}@${r.radii}r (${r.wanting} wanting)`)).toEqual([])
  })

  it('bounds the overshoot at one bucket, and says where it binds', () => {
    // The branch admits a bucket that does not fit, so the row above is only half the claim: the
    // other half is that the overshoot is small and rare rather than the exhaustion §1.6 removes.
    // `ArtPool` absorbs it without churn — a key wanted this frame is not an eviction candidate, so
    // the excess requests simply fail to reserve rather than evicting cells that are on screen.
    const over = (capacity: number) =>
      sweep(capacity)
        .filter((r) => r.admitted > capacity)
        .map((r) => `${r.slug}@${r.radii}r ${r.admitted}/${capacity}`)

    // Tier 4, where it binds: two poses of ninety, and neither asks for more than 1.6 pools.
    const tier4 = over(128)
    expect(tier4).toHaveLength(2)
    expect(tier4.every((row) => row.startsWith('dominaria@'))).toBe(true)
    for (const reading of sweep(128)) expect(reading.admitted).toBeLessThan(2 * 128)

    // The control, and the reason the row above is a measurement of the dataset rather than of the
    // branch: at the capacity tiers 0-3 actually run at, no pose overshoots at all.
    expect(over(SPEC_MINIMUM.maxArrayTextureLayers - 32)).toEqual([])
  })

  /**
   * Zendikar between 2.18 and 2.20 world-radii at 224 layers: the raw quantile alternates between
   * two adjacent buckets, which is the drifting camera §1.6's hysteresis is written for.
   *
   * Found by sweeping radii, not guessed: on this roster most worlds move the boundary
   * monotonically with distance and never present the hold branch with anything to hold.
   */
  const WOBBLE = { slug: 'zendikar', capacity: 224, radii: [2.18, 2.2] } as const

  function thresholds(planes: readonly PlaneRecord[], freshRigPerFrame: boolean): string[] {
    const seen: string[] = []
    let rig = null as ReturnType<typeof build> | null
    for (let frame = 0; frame < 6; frame += 1) {
      if (!rig || freshRigPerFrame) {
        rig?.worlds.dispose()
        rig = build({ seams: { ...NO_SEAMS, layersRequested: WOBBLE.capacity } })
        rig.worlds.setData({ planes, stars: STARS, swatches: SWATCHES, multiverseRadius: PLANES.multiverseRadius })
      }
      const subject = rig.worlds.surfaces.find((s) => s.planeSlug === WOBBLE.slug)!
      poseAt(rig.camera, subject.centre, subject.radius, WOBBLE.radii[frame % 2]!)
      rig.tick()
      seen.push(subject.threshold.effectiveThresholdPx.toFixed(2))
    }
    rig?.worlds.dispose()
    return seen
  }

  /** The roster with one world on it. Non-world planes stay: `worldPlanesOf` filters them anyway. */
  const lone = (slug: string): readonly PlaneRecord[] =>
    PLANES.planes.filter((plane) => plane.slug === slug || !isWorldPlane(plane))

  it('shows the boundary genuinely wobbles at these poses, so the hold branch has work to do', () => {
    // The bound must bind. A fresh attachment per frame is a fresh `ThresholdMemory` per frame —
    // the raw quantile with no hysteresis at all — and it alternates. Without this row the two
    // below are assertions about a boundary that never moved.
    const raw = thresholds(lone(WOBBLE.slug), true)
    expect(new Set(raw).size, 'the raw quantile must move between these two poses').toBe(2)
    expect(raw[0]).not.toBe(raw[1])
    expect(raw[2]).toBe(raw[0])
  })

  it('holds the raised boundary for a world that is alone on the roster', () => {
    const held = thresholds(lone(WOBBLE.slug), false)
    // Frame 1 raises, and every later drop is within one bucket and is refused.
    expect(new Set(held.slice(1)).size, `held: ${held.join(' ')}`).toBe(1)
  })

  it('holds it identically with forty-four other worlds updating in the same frame — F2', () => {
    // The finding, on the shipped composition. §1.12's pool is shared and stays shared; before
    // `ThresholdMemory` the *hysteresis* was shared with it, so the bucket the hold branch compared
    // against was the previous SURFACE's, every preceding world reset it, and the subject fell back
    // to its raw quantile every frame. On a 45-world roster there is always a preceding world, so
    // the hold branch could not fire in the product at all — and `grep hysteresis test/` was empty,
    // which is why all four mutation matrices ran clean through it.
    expect(thresholds(roster().planes, false)).toEqual(thresholds(lone(WOBBLE.slug), false))
  })
})

describe('§3.2s coexistence, which has to actually cost nothing', () => {
  it('allocates no pool and no equirect array on a dataset with no worlds', () => {
    const rig = build()
    // v2's roster: `planes.json` carries no `rowCells`, which §2.4 makes the test for a surface.
    const v2 = PLANES.planes.map((plane) => {
      const copy = { ...plane }
      delete copy.rowCells
      return copy
    })
    rig.worlds.setData({ planes: v2, stars: STARS, swatches: SWATCHES, multiverseRadius: PLANES.multiverseRadius })

    expect(rig.worlds.surfaces).toHaveLength(0)
    expect(rig.worlds.equirectArray).toBeNull()
    // §1.12's pool is 48 MiB at tier 0 and §3.2 keeps the galaxy shipping until four separate
    // conditions clear. Allocating it at construction would put the single largest resident
    // allocation in the app on every page load of the shipped product, sampled by nothing.
    expect(rig.worlds.pool.layers).toBe(0)
    // And the tick must survive a roster it cannot draw.
    rig.tick()
    expect(worldsProbeOf(rig.worlds.probeSource())).toBeUndefined()
    rig.worlds.dispose()
  })

  it('sizes the equirect array from the dataset, one layer per world with cards', () => {
    const rig = build()
    rig.worlds.setData(roster())
    // 29 on the 87-plane roster and 45 on v3 (§1.5, §1.12). A constant is right on one of the two.
    expect(rig.worlds.equirectArray?.image.depth).toBe(WORLDS.length)

    // **And a second roster, because this one agrees with the wrong answer.** `WORLDS.length` is
    // 45 on the shipped dataset, so an allocator that hard-coded 45 satisfies the row above — the
    // worked example happens to equal the constant. A three-world roster is what makes the claim
    // a claim about the *dataset* rather than about this dataset.
    const three = [...WORLDS.slice(0, 3), ...PLANES.planes.filter((p) => !isWorldPlane(p))]
    rig.worlds.setData({ planes: three, stars: STARS, swatches: SWATCHES, multiverseRadius: PLANES.multiverseRadius })
    expect(rig.worlds.surfaces).toHaveLength(3)
    expect(rig.worlds.equirectArray?.image.depth).toBe(3)
    rig.worlds.dispose()
  })

  it('releases the pool and the sheets when the roster is torn down', () => {
    const rig = build()
    rig.worlds.setData(roster())
    expect(rig.worlds.pool.layers).toBeGreaterThan(0)

    rig.worlds.setData(null)
    expect(rig.worlds.surfaces).toHaveLength(0)
    expect(rig.worlds.equirectArray).toBeNull()
    expect(rig.worlds.pool.layers).toBe(0)
    // The roster's nodes all go. §1.9's tether does **not**: it has the attachment's lifetime
    // rather than the roster's -- `setEnds` is what shows it, and it is hidden until then -- so
    // three nodes are expected to survive a teardown and only these three.
    const after = rig.scene.getObjectByName('worlds')!.children
    expect(after).toHaveLength(3)
    expect(after.every((child) => child.name.startsWith('worlds-tether'))).toBe(true)
    expect(after.every((child) => child.visible)).toBe(false)
    // A payload assembled after a teardown would be one from the previous roster.
    expect(rig.worlds.probeSource()).toBeNull()
    rig.worlds.dispose()
  })
})

/**
 * PRD 5.8's dimming, under worlds (§1.11, DEC-751).
 *
 * The rule is simpler here than it was for thumbnails and the simplification is the requirement:
 * *a filtered cell never resolves to art at all*. So there are two halves to check and they fail
 * differently — admission (the cell never asks the stream and never holds a layer) and release (a
 * cell filtered while it already held one drops back to its swatch instead of waiting for the LRU).
 * The second is the one that looks fine in a screenshot taken a moment too early.
 *
 * Driven through the shipped composition against the shipped dataset, because the mask is indexed
 * by **star** and the cells are indexed by card: the two only line up through `artKeyBase`, which a
 * hand-built fixture would let us get wrong in agreement with the code.
 */
describe('§1.11 a filtered cell drops to its swatch, and never to art', () => {
  /** A mask that dims exactly the cards of `slug`, in the store's per-star encoding. */
  function maskExcluding(slug: string): Uint8Array {
    const mask = new Uint8Array(STARS.count).fill(FILTER_MASK_PASS)
    const plane = PLANES.planes.find((p) => p.slug === slug)!
    for (let i = 0; i < plane.starCount; i += 1) mask[plane.starOffset + i] = 0
    return mask
  }

  function surfaceOf(rig: Rig, slug: string) {
    return rig.worlds.surfaces.find((s) => s.planeSlug === slug)!
  }

  /** Put the camera on a world close enough that its cells clear the art threshold. */
  function focus(rig: Rig, slug: string): void {
    const world = surfaceOf(rig, slug)
    poseAt(rig.camera, world.centre, world.radius, 1.8)
    rig.tick()
  }

  it('marks the filtered world’s cells and leaves every other world alone', () => {
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setData(roster())
    rig.worlds.setFilterMask(maskExcluding('dominaria'))

    const dominaria = surfaceOf(rig, 'dominaria')
    const other = surfaceOf(rig, 'innistrad')
    const flags = dominaria.sheet.filtered.array as Float32Array
    expect(flags.length).toBe(dominaria.cardCount)
    expect([...flags].every((f) => f === 1)).toBe(true)
    // The other world is the control: a `setFilterMask` that ignored `artKeyBase` and dimmed by
    // cell index would light up every roster world's first N cells and pass the row above.
    expect([...(other.sheet.filtered.array as Float32Array)].every((f) => f === 0)).toBe(true)
    rig.worlds.dispose()
  })

  it('never admits a filtered cell, so it never asks the pool for a layer', () => {
    /*
     * **Asserted on the pool, not on the cell's attributes**, and that distinction is the whole
     * row. A filtered cell is cleared twice over — admission skips it *and* the release branch
     * below zeroes it — so an assertion on `iLayer`/`iArt` is satisfied by either half alone and
     * cannot tell which is working. Deleting the admission term left every such assertion green.
     * A reservation is produced by admission and by nothing else.
     */
    // A real Scryfall-shaped id: the URL builder rejects a short one, and a rejected fetch is a
    // rejection this test would then have to swallow rather than a reservation it can count.
    const printing = { printingId: '0000a1b2-3c4d-5e6f-7a8b-9c0d1e2f3a4b', imageTs: 1 }
    /*
     * A queue whose fetch never settles. The subject is the *reservation*, which `ArtStream.request`
     * makes synchronously before it fetches — so the network never needs to answer, and a queue
     * left to reach the real `fetch` fills the run with unhandled rejections instead.
     */
    const options = () => ({
      capabilities: { webgl2: true, maxArrayTextureLayers: 2048 },
      cardOf: () => printing,
      queue: new ImageQueue({ fetchImpl: () => new Promise<Response>(() => {}) }),
    })

    const control = build(options())
    control.worlds.setData(roster())
    focus(control, 'dominaria')
    const reservedUnfiltered = control.worlds.pool.report().reserved
    // The control row. Without it a build that reserved nothing at all — no `cardOf`, a
    // swatch-only stream, a pose too far for the threshold — passes the filtered row for free.
    expect(reservedUnfiltered).toBeGreaterThan(0)
    control.worlds.dispose()

    const rig = build(options())
    rig.worlds.setData(roster())
    rig.worlds.setFilterMask(maskExcluding('dominaria'))
    focus(rig, 'dominaria')
    expect(rig.worlds.pool.report().reserved).toBe(0)

    /*
     * And the probe agrees, which is a second observable rather than a restatement. `wasAdmitted`
     * is what §3.1's payload reports per cell, and the two halves of this section reach it by
     * different routes: the release branch below stops a filtered cell *requesting*, so the
     * reservation count above is satisfied by either half — only this line is produced by the
     * admission term alone. A probe that called a filtered cell admitted would put cells that can
     * never receive art into W4's numerator, and the gate would read the filter as a renderer
     * failure.
     */
    const world = surfaceOf(rig, 'dominaria')
    const admitted = Array.from({ length: world.cardCount }, (_, cell) => world.wasAdmitted(cell))
    expect(admitted.some(Boolean)).toBe(false)

    // The control for *that* field, on the unfiltered arm: without it, a `wasAdmitted` that is
    // false everywhere at this pose would satisfy the line above for the wrong reason.
    const control2 = build(options())
    control2.worlds.setData(roster())
    focus(control2, 'dominaria')
    const unfiltered = surfaceOf(control2, 'dominaria')
    expect(
      Array.from({ length: unfiltered.cardCount }, (_, cell) => unfiltered.wasAdmitted(cell)).some(
        Boolean,
      ),
    ).toBe(true)
    control2.worlds.dispose()
    rig.worlds.dispose()
  })

  it('releases a layer a cell was already holding when the filter arrives', () => {
    // The half admission cannot cover. `ArtPool.claimLayer` refuses eviction within
    // EVICTION_GRACE_FRAMES, so a cell that stopped being admitted keeps its RESIDENT layer for a
    // while — and without an explicit release it goes on drawing the card at full art.
    //
    // Residency is made through the pool's own `reserve` + `resolve`, which is what the stream
    // does when a fetch lands. Writing a layer index into the attribute by hand does not work and
    // is worth recording: the pool would still answer `layerOf` with `null`, the existing
    // not-resident branch would clear the cell, and the test would pass with the release deleted.
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setData(roster())
    focus(rig, 'dominaria')
    const world = surfaceOf(rig, 'dominaria')
    const key = world.artKeyBase + 0
    expect(rig.worlds.pool.reserve(key, 0)).not.toBeNull()
    expect(rig.worlds.pool.resolve(key)).not.toBeNull()
    expect(rig.worlds.pool.layerOf(key)).not.toBeNull()

    // Unfiltered, the resident layer reaches the cell — the control that makes the next lines a
    // measurement of the filter rather than of an empty pool.
    focus(rig, 'dominaria')
    const layers = world.sheet.layers.array as Float32Array
    const art = world.sheet.art.array as Float32Array
    expect(layers[0]).toBeGreaterThanOrEqual(0)
    expect(art[0]).toBeGreaterThan(0)

    rig.worlds.setFilterMask(maskExcluding('dominaria'))
    focus(rig, 'dominaria')
    expect(layers[0]).toBeLessThan(0)
    expect(art[0]).toBe(0)
    rig.worlds.dispose()
  })

  it('dims the cell drawing the card, not the cell at the card’s index', () => {
    /*
     * The two identities are the same number until `?bands=shuffle` permutes them (§3.1's W3
     * control), and under that seam a mask applied by cell index dims the wrong cards — a control
     * seam that quietly changes a second thing, which is the failure `seams.ts` exists to prevent.
     * Every row above passes under the wrong spelling, because `cardOfCell` is the identity.
     */
    const rig = build({
      seams: { ...NO_SEAMS, bandsShuffle: true },
      capabilities: { webgl2: true, maxArrayTextureLayers: 2048 },
    })
    rig.worlds.setData(roster())
    const world = surfaceOf(rig, 'dominaria')

    const mask = new Uint8Array(STARS.count).fill(FILTER_MASK_PASS)
    mask[world.artKeyBase] = 0 // exactly one card: this world's card 0
    rig.worlds.setFilterMask(mask)

    const flagged = [...(world.sheet.filtered.array as Float32Array)]
      .map((value, cell) => (value === 1 ? cell : -1))
      .filter((cell) => cell >= 0)
    expect(flagged).toHaveLength(1)
    // Under the wrong spelling this is cell 0. The permutation is seeded and deterministic, so
    // this is a fixed fact about the shipped shuffle rather than a probabilistic one.
    expect(flagged[0]).not.toBe(0)
    rig.worlds.dispose()
  })

  it('clears on a null mask, which is also "no filter"', () => {
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setData(roster())
    rig.worlds.setFilterMask(maskExcluding('dominaria'))
    rig.worlds.setFilterMask(null)
    const flags = surfaceOf(rig, 'dominaria').sheet.filtered.array as Float32Array
    expect([...flags].every((f) => f === 0)).toBe(true)
    rig.worlds.dispose()
  })

  it('dims a world composed after the filter was set', () => {
    // The ordering the shipped boot actually takes: a deep link carries filters in the URL and the
    // evaluation runs before `planes.json` lands. A push-only attachment would compose this world
    // undimmed and stay that way until the user touched a filter chip.
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setFilterMask(maskExcluding('dominaria'))
    rig.worlds.setData(roster())
    const flags = surfaceOf(rig, 'dominaria').sheet.filtered.array as Float32Array
    expect([...flags].every((f) => f === 1)).toBe(true)
    rig.worlds.dispose()
  })

  it('keeps the filter across a quality rung, which recomposes the roster', () => {
    const rig = build({ capabilities: { webgl2: true, maxArrayTextureLayers: 2048 } })
    rig.worlds.setData(roster())
    rig.worlds.setFilterMask(maskExcluding('dominaria'))
    rig.worlds.setArtLayers(QUALITY_TIERS[3]!.artPoolLayers)
    const flags = surfaceOf(rig, 'dominaria').sheet.filtered.array as Float32Array
    expect([...flags].every((f) => f === 1)).toBe(true)
    rig.worlds.dispose()
  })
})
