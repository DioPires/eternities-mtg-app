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
import { Matrix4, PerspectiveCamera, Scene, Vector2, Vector3, type WebGLRenderer } from 'three'

import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlaneRecord, PlanesFile } from '../src/data/types'
import { FrameLoop, TICK_PHASES } from '../src/scene/renderer/frameLoop'
import type { ImageQueue } from '../src/scene/cards/imageQueue'
import { attachWorlds, DEFAULT_TIER_ART_LAYERS } from '../src/scene/worlds/attachWorlds'
import { KEY_LIGHT_OFF_AXIS, keyLightDirection } from '../src/scene/worlds/keyLight'
import { artPoolSize } from '../src/scene/worlds/artPool'
import { DEFAULT_BYTE_BUDGET } from '../src/scene/worlds/artStream'
import { CROSSOVER_HIGH_PX } from '../src/scene/worlds/lod'
import { isWorldPlane, worldPlanesOf } from '../src/scene/worlds/worldSource'
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
  return {
    gl: { getSize, getDrawingBufferSize, copyTextureToTexture } as unknown as WebGLRenderer,
    getSize,
    getDrawingBufferSize,
    copyTextureToTexture,
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
    seams: NO_SEAMS,
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

const roster = () => ({ planes: PLANES.planes, stars: STARS, swatches: SWATCHES })

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
    expect(group!.children).toHaveLength(WORLDS.length)
    for (const surface of rig.worlds.surfaces) expect(surface.mesh.parent).toBe(group)
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

  it('publishes the camera the measurement was made with, not the live one', () => {
    const rig = build()
    rig.worlds.setData(roster())
    const world = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, world.centre, world.radius, 2.2)
    rig.tick()

    const measured = new Vector3().copy(rig.worlds.probeSource()!.camera.position)
    const measuredMatrix = new Matrix4().copy(
      rig.worlds.probeSource()!.camera.matrixWorldInverse,
    )

    // The rig moves the camera every tick and three mutates its matrices **in place**. A payload
    // that held the live camera would report this new pose against the admission state measured at
    // the old one — and the two disagree exactly at the threshold boundary, which is the set W4
    // scores. Nothing about the resulting table looks wrong.
    poseAt(rig.camera, world.centre, world.radius, 9)
    const after = rig.worlds.probeSource()!
    expect(after.camera.position).toEqual(measured)
    expect(after.camera.matrixWorldInverse).toEqual(measuredMatrix)
    expect(rig.camera.position.distanceTo(measured)).toBeGreaterThan(1)
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
describe('§1.6 the stream report reaches the probe (DEC-778)', () => {
  /** A queue whose requests never land: these rows measure what is *asked*, not what arrives. */
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
      byteBudget: DEFAULT_BYTE_BUDGET,
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
    // `byteBudget: 0` is swatch-only from frame one — §1.6's documented degenerate case — so every
    // admitted want is refused by the budget and nothing is ever requested.
    const declined = build({ queue: pendingQueue(), cardOf: CARD_OF, byteBudget: 0 })
    declined.worlds.setData(roster())
    const spent = readAt(declined)
    expect(spent.stream?.swatchOnly).toBe(true)
    expect(spent.stream?.declinedBudget).toBeGreaterThan(0)
    expect(spent.stream?.requested).toBe(0)
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
    expect(second.stream?.byteBudget).toBe(DEFAULT_BYTE_BUDGET)
    expect(second.stream?.swatchOnly).toBe(false)
    rig.worlds.dispose()
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
        rig.worlds.setData({ planes, stars: STARS, swatches: SWATCHES })
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
    rig.worlds.setData({ planes: v2, stars: STARS, swatches: SWATCHES })

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
    rig.worlds.setData({ planes: three, stars: STARS, swatches: SWATCHES })
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
    expect(rig.scene.getObjectByName('worlds')?.children).toHaveLength(0)
    // A payload assembled after a teardown would be one from the previous roster.
    expect(rig.worlds.probeSource()).toBeNull()
    rig.worlds.dispose()
  })
})
