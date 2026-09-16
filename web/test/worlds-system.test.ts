/**
 * §1.2 step 2 and step 8 — the system pass and the atmosphere rim (spec §1.7, §1.8).
 *
 * Four claims, each with a plausible wrong answer beside it:
 *
 *  - **The instance count is a count of planes below the band's ceiling**, not `worlds − sheets`.
 *    §1.5 says a renderer that subtracts "will be one instance short through every approach", and
 *    one missing world out of 87 dots is not something a capture shows.
 *  - **The equirect is sampled along `atan2(x, z)`.** The other spelling mirrors each world
 *    east-west against its own cell sheet, and §1.5 records that it reads as a smear inside the
 *    crossover band rather than as a flip.
 *  - **§1.8's tint is the deviation from the multiverse mean, stretched.** Mixed straight it comes
 *    out the same grey for every plane, which is the finding the ×3.2 exists to answer — so the
 *    un-stretched mix is measured here rather than taken on trust.
 *  - **The rim uses `abs(dot(n, v))`.** Clamped, a `BackSide` shell is a solid tinted ball drawn
 *    additively over the world, which reads as bloom — the thing §1.1 deleted the post chain for.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene, Vector2, Vector3, type ShaderMaterial, type WebGLRenderer } from 'three'

import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlaneRecord, PlanesFile } from '../src/data/types'
import { FrameLoop } from '../src/scene/renderer/frameLoop'
import { attachWorlds } from '../src/scene/worlds/attachWorlds'
import { PLANE_HOME } from '../src/scene/worlds/centre'
import {
  SHADER_NAME_WORLD_ATMOSPHERE,
  SHADER_NAME_WORLD_ATMOSPHERE_CHEAP,
  SHADER_NAME_WORLD_SYSTEM,
} from '../src/scene/shaderNames'
import {
  ATMOSPHERE_DEFINE_BLOCK,
  ATMOSPHERE_FRAGMENT_SHADER,
  RIM_RADIUS_SCALE,
} from '../src/scene/worlds/atmosphereShaders'
import { EQUIRECT_HEIGHT, EQUIRECT_WIDTH } from '../src/scene/worlds/lod'
import { multiverseMeanPalette, PALETTE_GAIN, paletteTint } from '../src/scene/worlds/paletteTint'
import { RENDER_ORDER_ATMOSPHERE, RENDER_ORDER_TETHER } from '../src/scene/worlds/passOrder'
import { equirectUv, SystemPass } from '../src/scene/worlds/systemMesh'
import {
  MOON_COLOUR,
  MOON_LAYER,
  SYSTEM_FRAGMENT_SHADER,
  UNDETAILED_DIM,
} from '../src/scene/worlds/systemShaders'
import { worldRadius } from '../src/scene/worlds/surfaceLaw'
import { worldPlanesOf } from '../src/scene/worlds/worldSource'
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
const MOONS = PLANES.planes.filter((plane) => plane.cardCount === 0)

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

/** The home view: far enough out that every world is well below §1.5's crossover. */
function poseHome(camera: PerspectiveCamera): void {
  camera.position.set(0, 120, 380)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
}

function poseAt(camera: PerspectiveCamera, centre: Vector3, radius: number, radii: number): void {
  camera.position.copy(centre).add(new Vector3(0, 0, radius * radii))
  camera.lookAt(centre)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
}

describe('§1.2 step 2: the instance count is planes below the band, not worlds minus sheets', () => {
  it('draws every world and every moon at the home view', () => {
    const rig = build()
    poseHome(rig.camera)
    rig.tick()

    // 45 + 42 on v3 and 29 + 57 on the 87-plane roster (§1.2). Derived from the dataset, because
    // "a constant is right on exactly one of the two datasets this renderer is guaranteed to meet".
    expect(rig.worlds.systemDrawn).toBe(WORLDS.length + MOONS.length)
    expect(WORLDS.length).toBe(45)
    expect(MOONS.length).toBe(42)
    // The belt is step 3, never step 2 (§1.2). One dust plane on the roster, and it is not here.
    expect(rig.worlds.system!.planes.some((plane) => plane.kind === 'dust')).toBe(false)
    expect(rig.worlds.system!.planes).toHaveLength(WORLDS.length + MOONS.length)
    rig.worlds.dispose()
  })

  it('keeps a world in the count while it is INSIDE the band, and drops it only above', () => {
    // The row §1.5 warns about. At 2.2 radii dominaria is far above the band and leaves step 2; the
    // count must fall by exactly one, not by "the number of sheets drawn". A renderer deriving one
    // pass from the other agrees here and disagrees the moment a second world is near — which is
    // "a tether view with both ends near", the ordinary case (§1.2).
    const rig = build()
    const dominaria = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    poseAt(rig.camera, dominaria.centre, dominaria.radius, 2.2)
    rig.tick()

    expect(dominaria.crossover.drawSheet).toBe(true)
    expect(dominaria.crossover.drawSystem).toBe(false)

    // **The count is a count of `drawSystem`, and at this pose it is nowhere near `87 − 1`.**
    // Measured: 67. Nineteen other worlds are also above the band, because the camera sits 21.9
    // units from dominaria inside a 130-unit multiverse and several neighbours are a few of their
    // own radii away — which is §1.2's "any number of worlds may be above the crossover at once",
    // observed rather than assumed. An expectation of 86 here would have been a statement about
    // dominaria written as if it were a statement about the roster.
    const above = rig.worlds.surfaces.filter((s) => !s.crossover.drawSystem).length
    expect(above).toBeGreaterThan(1)
    expect(rig.worlds.systemDrawn).toBe(WORLDS.length + MOONS.length - above)
    rig.worlds.dispose()
  })

  it('counts a world in BOTH passes inside the band, which is where subtracting goes wrong', () => {
    // §1.5's warning, made falsifiable. The wrong answer — `planes − sheetsDrawn` — agrees with the
    // right one on every pose where no world is *inside* the band, and the two differ by exactly the
    // number that are. So the pose is found by search rather than guessed, and the row asserts the
    // gap is non-zero as well as asserting the count.
    const rig = build()
    const dominaria = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!

    let found = 0
    for (let radii = 8; radii <= 22; radii += 0.25) {
      poseAt(rig.camera, dominaria.centre, dominaria.radius, radii)
      rig.tick()
      const inBand = rig.worlds.surfaces.filter(
        (s) => s.crossover.drawSheet && s.crossover.drawSystem,
      )
      if (inBand.length === 0) continue
      found = inBand.length

      for (const surface of inBand) {
        expect(surface.crossover.sheetMix).toBeGreaterThan(0)
        expect(surface.crossover.sheetMix).toBeLessThan(1)
      }

      const sheets = rig.worlds.surfaces.filter((s) => s.crossover.drawSheet).length
      const naive = WORLDS.length - sheets + MOONS.length
      expect(rig.worlds.systemDrawn).toBe(naive + inBand.length)
      expect(rig.worlds.systemDrawn).toBeGreaterThan(naive)
      break
    }
    expect(found, 'no pose in the swept range put a world inside the crossover band').toBeGreaterThan(
      0,
    )
    rig.worlds.dispose()
  })

  it('gives every moon §1.8s flat colour and no equirect layer', () => {
    const rig = build()
    poseHome(rig.camera)
    rig.tick()

    const system = rig.worlds.system!
    const layers = system.mesh.geometry.getAttribute('iLayer')
    const tints = system.mesh.geometry.getAttribute('iTint')
    const reference = multiverseMeanPalette(PLANES.planes)

    let moons = 0
    for (const [at, plane] of system.planes.entries()) {
      if (plane.cardCount > 0) continue
      moons += 1
      expect(layers.getX(at)).toBe(MOON_LAYER)
      expect(tints.getX(at)).toBeCloseTo(MOON_COLOUR[0], 6)
      expect(tints.getY(at)).toBeCloseTo(MOON_COLOUR[1], 6)
      expect(tints.getZ(at)).toBeCloseTo(MOON_COLOUR[2], 6)
      // "with no palette tint" (§1.8). An empty plane still carries a `palette` in `planes.json`,
      // so a renderer that tinted by it would produce a perfectly ordinary-looking dim world.
      const tinted = paletteTint(plane, reference)
      expect(Math.abs(tinted[0] - MOON_COLOUR[0])).toBeGreaterThan(0.05)
    }
    expect(moons).toBe(MOONS.length)

    // Emptiness is a colour, not a size: the moon radius is §1.3's floor, which is the SAME floor a
    // world under 19 cards takes — so a moon is not the smallest thing in the scene (§1.8).
    expect(worldRadius(0)).toBeCloseTo(0.55, 12)
    const smallest = Math.min(...WORLDS.map((plane) => worldRadius(plane.cardCount)))
    expect(smallest).toBeCloseTo(0.55, 12)
    rig.worlds.dispose()
  })

  it('keys the flat colour on the LAYER, so a world whose layer never arrived is not tinted', () => {
    // **DEC-773's M20 note, given the fixture it was missing.** The branch reads `layer < 0` and not
    // `cardCount === 0`, with a stated reason: a plane that has cards but no equirect layer has
    // nothing to sample, and tinting it by its palette would ship `iLayer = -1` — §1.8's *moon*
    // spelling — alongside a world's colour. The shader takes the `vLayer < 0` branch and paints
    // `vTint` flat, so that plane would be drawn as a moon **in its own palette colour**: a small
    // coloured ball with no mosaic, which reads as a world that failed to load rather than as a
    // wiring fault. On every shipped roster `layerOf` answers for every plane with cards, so the two
    // spellings agree everywhere and only a constructed roster can tell them apart.
    //
    // `attachWorlds` itself can produce this: `layerOf` is `layerByPlane.get(plane.index) ?? -1`.
    const withCards = WORLDS.find((plane) => plane.cardCount > 0)!
    const reference = multiverseMeanPalette(PLANES.planes)
    const palette = paletteTint(withCards, reference)
    // The fixture is only discriminating if the two candidate colours differ.
    expect(Math.abs(palette[0] - MOON_COLOUR[0])).toBeGreaterThan(0.05)

    // A frame the pass can be driven with. `update` reads only the camera's position, the viewport
    // height, the fov and the light, and nothing below depends on the pose — every entry is written
    // because `drawsSystem` answers true and the layer branch does not consult it.
    const camera = new PerspectiveCamera(55, 1920 / 1080, 0.1, 8000)
    camera.position.set(0, 0, 400)
    camera.updateMatrixWorld(true)
    const frame = {
      camera,
      viewport: { width: 1920, height: 1080 },
      fovRadians: (55 * Math.PI) / 180,
      deltaSeconds: 1 / 60,
      lightDirection: new Vector3(0, 0, 1),
      // §1.8's instances are placed at this (DEC-804). `PLANE_HOME` keeps the pass at the t=0
      // positions these tint assertions were derived against; where the placement itself is the
      // subject, `worlds-centre.test.ts` sweeps the angle instead.
      centreOf: PLANE_HOME,
    }
    const tintOf = (pass: SystemPass, index: number): [number, number, number] => {
      pass.update(frame, () => 0, () => true)
      const attribute = pass.mesh.geometry.getAttribute('iTint')
      return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)]
    }

    // Every plane's layer withheld — the state `attachWorlds` produces for a plane missing from
    // `layerByPlane`.
    const stranded = new SystemPass({ planes: PLANES.planes, equirect: null, layerOf: () => -1 })
    const at = stranded.planes.findIndex((plane) => plane.index === withCards.index)
    expect(at).toBeGreaterThanOrEqual(0)
    const strandedTint = tintOf(stranded, at)
    expect(strandedTint[0]).toBeCloseTo(MOON_COLOUR[0], 6)
    expect(strandedTint[1]).toBeCloseTo(MOON_COLOUR[1], 6)
    expect(strandedTint[2]).toBeCloseTo(MOON_COLOUR[2], 6)
    stranded.dispose()

    // **The control.** The same plane, with its layer present, takes its palette tint — so the row
    // above is about the layer and not about the plane.
    const wired = new SystemPass({
      planes: PLANES.planes,
      equirect: null,
      layerOf: (plane) => WORLDS.findIndex((world) => world.index === plane.index),
    })
    const wiredTint = tintOf(wired, at)
    expect(wiredTint[0]).toBeCloseTo(palette[0], 6)
    expect(wiredTint[0]).not.toBeCloseTo(MOON_COLOUR[0], 6)
    wired.dispose()
  })
})

describe('§1.5: the equirect is indexed along atan2(x, z)', () => {
  it('round-trips a cells own direction back to that cells swatch', () => {
    // The bake writes texel `u` at longitude `((u + 0.5)/W)·2π − π` with longitude read as
    // `atan2(x, z)` (`bakeEquirectLayer`). `equirectUv` is the inverse the shader uses, so a cell's
    // own centre direction must land on a texel carrying that cell's own swatch.
    const rig = build()
    const surface = rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    const layer = surface.equirect
    const normals = (rig.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')! as unknown as {
      source: { normals: Float32Array; swatches: Float32Array }
    }).source

    let hits = 0
    let mirrored = 0
    const sampled = 400
    for (let i = 0; i < sampled; i += 1) {
      // Spread over the sheet rather than taken from the front: the mirror is an identity at
      // longitude 0 and at ±π, so a sample near either would agree under both spellings.
      const cell = Math.floor((i / sampled) * surface.cardCount)
      const nx = normals.normals[cell * 3]!
      const ny = normals.normals[cell * 3 + 1]!
      const nz = normals.normals[cell * 3 + 2]!

      const [u, v] = equirectUv(nx, ny, nz)
      const at = readTexel(layer, u, v)
      if (closeTo(at, normals.swatches, cell)) hits += 1

      // The natural wrong spelling: `atan2(z, x)`, which runs the columns the other way.
      const lonMirror = Math.atan2(nz, nx)
      const uMirror = (lonMirror + Math.PI) / (2 * Math.PI)
      if (closeTo(readTexel(layer, uMirror, v), normals.swatches, cell)) mirrored += 1
    }

    // Not 100%: a 256-wide layer holds fewer columns than Dominaria's equatorial rows hold cells, so
    // some texels legitimately carry a neighbour. The discriminating fact is the gap between the
    // two spellings, which is what a mirrored bake destroys.
    expect(hits / sampled).toBeGreaterThan(0.6)
    expect(mirrored / sampled).toBeLessThan(0.15)
    rig.worlds.dispose()
  })

  it('spells it that way in the SHIPPED GLSL, which the round trip above never reads', () => {
    // **DEC-773 F5.** The row above is a good measurement of `equirectUv` — real data, 400 samples,
    // a discriminating control against the mirror — and `equirectUv` is the **CPU twin**. The string
    // the GPU compiles is independent of it, so mirroring the GLSL alone left the whole suite green
    // while every world drew its mosaic backwards inside §1.5's band. Two implementations of one
    // law, inside one file: the same hazard `belt.ts`'s header refuses, and the same fix the rim's
    // own `abs(dot(...))` guard uses.
    //
    // Written to fail on an **unparseable** site rather than to look for a known-bad one: the
    // exact-count assertion means a second `atan` — or a longitude built some other way — is a red
    // row and not a silent pass, which a `not.toMatch(/atan\(n\.z/)` would have been.
    const calls = [...SYSTEM_FRAGMENT_SHADER.matchAll(/\batan\s*\(([^)]*)\)/g)]
    expect(calls, 'the shipped fragment shader must build longitude in exactly one place').toHaveLength(1)
    expect(calls[0]![1]!.replace(/\s+/g, '')).toBe('n.x,n.z')

    // And its inverse: `bakeEquirectLayer` writes texel `u` at `((u + 0.5)/W)·2π − π`, so `u` comes
    // back as `(lon + π)/2π`. A shader that read the longitude right and then mapped it to `u` the
    // other way round is the same flip with a different author.
    expect(SYSTEM_FRAGMENT_SHADER).toMatch(/\(\s*lon\s*\+\s*PI\s*\)\s*\/\s*TAU/)
    // Colatitude, north pole at v = 0 — **not** flipped (§1.6's `UNPACK_FLIP_Y_WEBGL` note is about
    // the art pool, and applying it here stands every world on its head).
    expect(SYSTEM_FRAGMENT_SHADER).toMatch(/theta\s*\/\s*PI/)
  })
})

describe('§1.8: the tint is the stretched deviation, because the straight mix is grey', () => {
  it('finds the un-stretched mix grey on the planes §1.8 is about, and the stretch widening it', () => {
    // §1.8: "Mixed straight, they come out the same grey, because Magic's colour pie is balanced —
    // the same finding that makes the shipped arm-skew law inert (review §4.1)." Measured, not
    // quoted: without this row the ×3.2 is a magic number with no demonstrated job.
    const reference = multiverseMeanPalette(PLANES.planes)
    const spreadOf = (planes: readonly PlaneRecord[], stretch: boolean) =>
      channelSpread(planes.map((plane) => paletteTint(plane, stretch ? reference : undefined)))

    // PRD 5.3.6 puts the spiral/irregular boundary at 50 cards, so this is the roster's own line
    // rather than one chosen to make the number come out.
    const substantial = WORLDS.filter((plane) => plane.cardCount >= 50)
    expect(substantial).toHaveLength(29)
    const straight = spreadOf(substantial, false)
    const stretched = spreadOf(substantial, true)

    expect(straight, `straight spread ${straight.toFixed(4)}`).toBeLessThan(0.05)
    expect(stretched / straight).toBeGreaterThan(2)
    expect(PALETTE_GAIN).toBe(3.2)
  })

  it('finds the stretch INERT on v3s sixteen tiny worlds, and records it', () => {
    // **A finding, not a bug in the stretch (DEC-750).** §1.8's argument is that a card-weighted
    // palette over a balanced colour pie averages to grey, so the *deviation* is the signal. A world
    // with one card has no average to be pulled away from: its palette is a delta function and its
    // straight mix is already a single hue at full saturation — `belenon` comes out at exactly
    // `HUE_COLOURS[0]`. So on this cohort the ×3.2 has nothing left to stretch.
    //
    //   >= 50 cards (29 worlds):  straight 0.0364 -> stretched 0.0861   (x2.36)
    //   <  50 cards (16 worlds):  straight 0.2233 -> stretched 0.2256   (x1.01)
    //   all 45 worlds:            straight 0.1382 -> stretched 0.1525   (x1.10)
    //
    // The third line is why this is worth pinning: the tiny cohort swamps the roster-wide statistic,
    // so a single spread over all 45 worlds shows the stretch doing almost nothing and reads as "the
    // ×3.2 is broken". It is not — it is inert where §1.2's refreshed roster shape put 15 of 45
    // worlds at four cards or fewer, which §1.8 was not written against.
    const reference = multiverseMeanPalette(PLANES.planes)
    const tiny = WORLDS.filter((plane) => plane.cardCount < 50)
    expect(tiny).toHaveLength(16)

    const straight = channelSpread(tiny.map((plane) => paletteTint(plane)))
    const stretched = channelSpread(tiny.map((plane) => paletteTint(plane, reference)))
    expect(straight).toBeGreaterThan(0.2)
    expect(stretched / straight).toBeLessThan(1.05)
  })

  it('leaves a plane at the multiverse mean grey, and moves an unusual one in its own direction', () => {
    const reference = multiverseMeanPalette(PLANES.planes)
    // A synthetic plane sitting exactly on the mean. §1.8: "a plane at the average is grey".
    const average = { ...WORLDS[0]!, palette: reference } as PlaneRecord
    const averageTint = paletteTint(average, reference)
    expect(paletteTint(average)).toEqual(averageTint)

    // Alara's gold share is what §1.8 names as the thing this exists to show.
    const alara = PLANES.planes.find((plane) => plane.slug === 'alara')
    if (alara) {
      const tint = paletteTint(alara, reference)
      const straight = paletteTint(alara)
      // Stretching moves it further from the multiverse's own colour, never nearer.
      expect(distance(tint, averageTint)).toBeGreaterThan(distance(straight, averageTint))
    }
  })

  it('takes the mean over every plane with cards, the belt included, and says what that costs', () => {
    // §1.8 says "the card-weighted multiverse mean" and the Blind Eternities is 14.70% of the
    // multiverse's cards on v3 — the largest population after Dominaria. The two readings are both
    // defensible; this row pins the one shipped and reports the size of the choice rather than
    // leaving it as an unexamined default.
    const withBelt = multiverseMeanPalette(PLANES.planes)
    const withoutBelt = multiverseMeanPalette(PLANES.planes.filter((p) => p.kind !== 'dust'))
    const shift = Math.max(...withBelt.map((value, hue) => Math.abs(value - (withoutBelt[hue] ?? 0))))

    // Small but not nil — and it is multiplied by 3.2 on its way into every world's colour.
    expect(shift).toBeGreaterThan(0)
    expect(shift, `belt shifts the reference by ${shift.toFixed(5)} per hue`).toBeLessThan(0.02)
  })

  it('dims undetailed worlds so a neighbour does not outshine the subject', () => {
    expect(UNDETAILED_DIM).toBe(0.3)
  })
})

describe('§1.7: the atmosphere rim', () => {
  it('is an additive BackSide shell at 1.055x, after the tether in the pass list', () => {
    const rig = build()
    poseHome(rig.camera)
    rig.tick()

    const atmosphere = rig.worlds.atmosphere!
    const material = atmosphere.mesh.material as ShaderMaterial
    expect(material.name).toBe(SHADER_NAME_WORLD_ATMOSPHERE)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(RIM_RADIUS_SCALE).toBe(1.055)
    // §1.2: "8 is last because an atmosphere must not depth-reject the tether passing in front of
    // it". three sorts the transparent list by distance, so this has to be pinned explicitly.
    expect(atmosphere.mesh.renderOrder).toBe(RENDER_ORDER_ATMOSPHERE)
    expect(RENDER_ORDER_ATMOSPHERE).toBeGreaterThan(RENDER_ORDER_TETHER)

    // "Every world that is drawn at all gets one" — and no moon does, because §1.8's moons are
    // unlit and a rim is light.
    expect(atmosphere.drawnCount).toBe(WORLDS.length)
    rig.worlds.dispose()
  })

  it('composites §1.7s falloff ONCE, at the 2.6 the spec writes and not at its square', () => {
    // **DEC-773 F1, and the thing no gate row can see.** `AdditiveBlending` at three's default
    // `premultipliedAlpha: false` is `blendFuncSeparate(SRC_ALPHA, ONE, ONE, ONE)`, so what reaches
    // the frame is `rgb × a` — and this shader writes `intensity * lit` into **both** channels.
    // The exponent §1.7 names then ships doubled and `RIM_NIGHT_FLOOR` ships squared, with a picture
    // that reads as a thin hard ring rather than as a wrong number. A linking shader links either
    // way, so the only place this is visible is the composite.
    //
    // The two constants below are read out of the **shipped define block**, not restated: they are
    // what the GLSL is compiled with, and a tuning edit that moved one would otherwise leave this
    // row asserting against a stale twin.
    const defineOf = (name: string): number => {
      const match = new RegExp(`^#define ${name} (\\S+)$`, 'm').exec(ATMOSPHERE_DEFINE_BLOCK)
      expect(match, `${name} is not in the shipped define block`).not.toBeNull()
      return Number(match![1])
    }
    const exponent = defineOf('RIM_FRESNEL_EXPONENT')
    const strength = defineOf('RIM_STRENGTH')
    const nightFloor = defineOf('RIM_NIGHT_FLOOR')

    const rig = build()
    poseHome(rig.camera)
    rig.tick()
    // The cheap rung, because it is §1.12's "one tap, no dither" — one lobe and no hash, so the
    // ramp below is `pow(1 - |n·v|, e)` exactly and its slope in log-log **is** `e`.
    rig.worlds.setRimQuality('cheap')
    const material = rig.worlds.atmosphere!.mesh.material as ShaderMaterial

    // The fragment shader's two writes, and then the blend three will issue for THIS material. The
    // flag is read off the shipped material rather than assumed, which is what makes flipping it
    // turn this row red.
    const composite = (facing: number, lit: number): number => {
      const intensity = (1 - facing) ** exponent
      const colour = intensity * lit * strength
      const alpha = Math.min(intensity * lit, 1)
      return material.premultipliedAlpha ? colour : colour * alpha
    }

    // §1.7's exponent, measured as the slope of the composited ramp rather than restated.
    const slope = (lit: number): number =>
      Math.log(composite(0.1, lit) / composite(0.5, lit)) / Math.log(0.9 / 0.5)
    expect(slope(1)).toBeCloseTo(exponent, 9)
    expect(slope(nightFloor)).toBeCloseTo(exponent, 9)

    // And `RIM_NIGHT_FLOOR` delivers itself, not its square: the night limb keeps 55% of the lit
    // limb's rim, which is the whole reason §1.7 has a floor at all.
    expect(composite(0.2, nightFloor) / composite(0.2, 1)).toBeCloseTo(nightFloor, 9)

    // **The control, which is also the defect.** The same model under three's default flag reports
    // the doubled exponent and the squared floor — so the two rows above are discriminating and not
    // arithmetic that comes out right either way.
    const straight = (facing: number, lit: number): number => {
      const intensity = (1 - facing) ** exponent
      return intensity * lit * strength * Math.min(intensity * lit, 1)
    }
    expect(
      Math.log(straight(0.1, 1) / straight(0.5, 1)) / Math.log(0.9 / 0.5),
    ).toBeCloseTo(exponent * 2, 9)
    expect(straight(0.2, nightFloor) / straight(0.2, 1)).toBeCloseTo(nightFloor ** 2, 9)

    rig.worlds.dispose()
  })

  it('sets premultipliedAlpha on both rim rungs, which is what makes the blend ONE, ONE', () => {
    // Asserted on the material because that is the input three's `WebGLState` reads: at `false` it
    // issues `blendFuncSeparate(SRC_ALPHA, ONE, ...)` and at `true` it issues `blendFunc(ONE, ONE)`.
    // Both rungs, because `setRimQuality` **rebuilds** the material and a flag set in one of the two
    // constructions would survive every test that never moves the rung.
    const rig = build()
    poseHome(rig.camera)
    rig.tick()
    expect((rig.worlds.atmosphere!.mesh.material as ShaderMaterial).premultipliedAlpha).toBe(true)
    rig.worlds.setRimQuality('cheap')
    expect((rig.worlds.atmosphere!.mesh.material as ShaderMaterial).premultipliedAlpha).toBe(true)
    rig.worlds.setRimQuality('full')
    expect((rig.worlds.atmosphere!.mesh.material as ShaderMaterial).premultipliedAlpha).toBe(true)
    rig.worlds.dispose()
  })

  it('uses abs(n·v), not a clamp, which is the difference between a rim and a ball', () => {
    // On a `BackSide` draw every surviving fragment has `dot(n, v) < 0`, so a clamp to [0,1] makes
    // the fresnel `pow(1 - 0, 2.6)` — one, everywhere. The shell becomes a solid tinted sphere drawn
    // additively over the world, which reads as bloom rather than as a wrong falloff.
    expect(ATMOSPHERE_FRAGMENT_SHADER).toMatch(/abs\(dot\(n, normalize\(vView\)\)\)/)
    expect(ATMOSPHERE_FRAGMENT_SHADER).not.toMatch(/clamp\(dot\(n, normalize\(vView\)\)/)
  })

  it('swaps to §1.12s tier-4 program, which is a different name and a different source', () => {
    const rig = build()
    poseHome(rig.camera)
    rig.tick()
    const atmosphere = rig.worlds.atmosphere!

    rig.worlds.setRimQuality('cheap')
    const cheap = atmosphere.mesh.material as ShaderMaterial
    expect(cheap.name).toBe(SHADER_NAME_WORLD_ATMOSPHERE_CHEAP)
    expect(cheap.defines).toHaveProperty('CHEAP_RIM')
    // The define must actually reach a branch, or "cheap rim" is a second name for one program and
    // the ladder's rung moves nothing (DEC-739's finding, in the small).
    expect(ATMOSPHERE_FRAGMENT_SHADER).toMatch(/#ifndef CHEAP_RIM/)

    rig.worlds.setRimQuality('full')
    expect((atmosphere.mesh.material as ShaderMaterial).name).toBe(SHADER_NAME_WORLD_ATMOSPHERE)
    rig.worlds.dispose()
  })

  it('names the system program too, so a profile can attribute step 2', () => {
    const rig = build()
    poseHome(rig.camera)
    rig.tick()
    expect((rig.worlds.system!.mesh.material as ShaderMaterial).name).toBe(SHADER_NAME_WORLD_SYSTEM)
    rig.worlds.dispose()
  })
})

/** RGB at a normalised `(u, v)` of a baked equirect layer, as floats in 0..1. */
function readTexel(layer: Uint8Array, u: number, v: number): [number, number, number] {
  const wrapped = u - Math.floor(u)
  const x = Math.min(EQUIRECT_WIDTH - 1, Math.floor(wrapped * EQUIRECT_WIDTH))
  const y = Math.min(EQUIRECT_HEIGHT - 1, Math.max(0, Math.floor(v * EQUIRECT_HEIGHT)))
  const at = (y * EQUIRECT_WIDTH + x) * 4
  return [layer[at]! / 255, layer[at + 1]! / 255, layer[at + 2]! / 255]
}

/** Whether a texel carries `cell`'s own swatch, within one 8-bit step per channel. */
function closeTo(texel: readonly number[], swatches: Float32Array, cell: number): boolean {
  for (let channel = 0; channel < 3; channel += 1) {
    if (Math.abs(texel[channel]! - swatches[cell * 3 + channel]!) > 1.5 / 255) return false
  }
  return true
}

/** The mean per-channel standard deviation of a set of colours. */
function channelSpread(colours: readonly (readonly [number, number, number])[]): number {
  let total = 0
  for (let channel = 0; channel < 3; channel += 1) {
    const values = colours.map((colour) => colour[channel]!)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    total += Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
    )
  }
  return total / 3
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}
