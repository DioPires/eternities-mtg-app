/**
 * A world is where the camera thinks it is (spec §1.2, §1.9, §3.1; PRD 5.3.15, 5.7.1; DEC-804).
 *
 * Leg G's acceptance run could not take a single §3.1 reading: of the first 15 worlds toured, **1
 * scored and 14 failed setup**, every one of them `could not reach 2.2 radii`. On a settled,
 * motionless rig `radii` drifted monotonically — `dominaria` 2.9203 → 2.1687 over 17.5 s while
 * `cameraDistance` held at 31.9293 to four decimals, and `azgol` 3.5140 → **17.4112**. Tables,
 * controls and the capture in `docs/worlds/gate-pose-defect.md`.
 *
 * **The cause was that the worlds scene had no idea the multiverse turns.** PRD 8.5.3 rotates every
 * plane about `+Y` and PRD 5.3.15 drifts it around its `home`; the galaxy path applies both in its
 * vertex shader and `camera/motion.ts`'s `planePosition` is the CPU mirror the rig tethers to. The
 * worlds scene read `plane.home` — a composition-time snapshot — and contained **no reader of
 * `multiverseAngle` at all**. So the camera flew a circle the worlds were not on, and `radii`, the
 * distance between the two, drifted at `|home| / radius` times the rotation.
 *
 * ---
 *
 * **What this file can and cannot discriminate, stated up front.**
 *
 * The pose below is built from `SceneMotion.planePosition` — the camera's own law, in
 * `src/camera/motion.ts` — and the reading comes out of `src/scene/worlds/`. Two modules, and the
 * claim is that they agree. Once they do, `radii` is `distance / radius` by construction, so the
 * hold rows on their own would stay green on a `radii` that had been replaced by a constant. They
 * are therefore not on their own:
 *
 *  - **The sensitivity control** sweeps the pose distance and requires `radii` to track it, so a
 *    dead number fails. [[a-measure-can-be-carried-by-the-wrong-signal]] in the small.
 *  - **The mutation control** re-points the scene at {@link PLANE_HOME} — the pre-DEC-804 spelling,
 *    exactly — and requires each hold row to go red, with the drift *measured* rather than merely
 *    non-zero. An instrument that cannot see the defect has not been shown to see the fix.
 *  - **The scene-graph row** involves no camera at all: it compares `mesh.position`, which is where
 *    the GPU draws the sheet, against `planePosition`. That is the visible half of the defect — the
 *    capture with the focused world in the corner of its own frame — and it can be stated without
 *    posing anything.
 *  - **The reduced-motion row** is the negative control and it is expected GREEN on both trees: with
 *    the multiverse frozen `planePosition` *is* `home`, so fixed and unfixed are indistinguishable.
 *    That is worth pinning, because it is why a suite run entirely under `?motion=0` — which most of
 *    this repo's worlds tests are — could not have caught this.
 *
 * The wiring itself is not tested here. `attachWorlds.setPlaneCentres` is called by `sceneHost`, and
 * a dropped call there would restore DEC-804 in full with every row below still green; that is
 * DEC-772's shape and it is covered where DEC-772's is, in `worlds-scene-seam.test.tsx`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Scene, Vector2, Vector3, type WebGLRenderer } from 'three'

import { SceneMotion } from '../src/camera/motion'
import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlaneRecord, PlanesFile } from '../src/data/types'
import { FrameLoop } from '../src/scene/renderer/frameLoop'
import { MULTIVERSE_PERIOD_S } from '../src/scene/tuning'
import { attachWorlds, type WorldsAttachment } from '../src/scene/worlds/attachWorlds'
import { PLANE_HOME, type PlaneCentreSource } from '../src/scene/worlds/centre'
import type { WorldsSeams } from '../src/scene/worlds/seams'
import { worldRadius } from '../src/scene/worlds/surfaceLaw'
import { worldPlanesOf } from '../src/scene/worlds/worldSource'
import { worldsProbeOf } from '../src/scene/worlds/worldsProbe'

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

// The shipped worlds dataset. The defect scales with `|home| / radius`, which is a property of the
// real roster's layout — a fixture at the origin has `|home| = 0` and cannot express it at all.
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

/** §3.1's tolerance on the pose. The acceptance criterion for this leg is stated against it. */
const RADII_TOLERANCE = 0.02

/** Leg G's hold. Long enough that the unfixed tree is off by 40x the tolerance on `azgol`. */
const HOLD_SECONDS = 17.5

/**
 * The two worlds the defect was measured on.
 *
 * `azgol` is not decoration: the error scales with `|home| / radius`, and at 2 cards and radius 0.55
 * it is the worst ratio on the roster (94.56 / 0.55 = 172) against `dominaria`'s 11. A fix validated
 * on `dominaria` alone would be validated at 6% of the exposure. [[prove-it-against-the-envelope]]
 */
const SUBJECTS = ['dominaria', 'azgol'] as const

function planeFor(slug: string): PlaneRecord {
  const plane = WORLDS.find((candidate) => candidate.slug === slug)
  expect(plane, `${slug} must be a world on the shipped roster`).toBeDefined()
  return plane!
}

interface Harness {
  readonly worlds: WorldsAttachment
  readonly camera: PerspectiveCamera
  readonly motion: SceneMotion
  /**
   * Advance the scene clock by `deltaSeconds`, put the camera where a rig holding `plane`'s tether
   * at `distance` would be, and run one tick.
   *
   * The order is the product's: the clock moves first (`planeTable`, then `motionSync`), the camera
   * is placed against the clock the rig has just been handed (`rig`), and only then does the
   * `worlds` phase read a centre. Reversed, every row would be comparing this frame's camera against
   * last frame's position — which is DEC-804 one frame deep, and just as invisible.
   */
  readonly step: (deltaSeconds: number, plane: PlaneRecord, distance: number) => void
  readonly dispose: () => void
}

/**
 * The shipped composition, driven by hand.
 *
 * `centreOf` is a parameter so the mutation control can supply {@link PLANE_HOME}, which is
 * precisely the expression `worldSource.ts` carried before this leg.
 */
function build(options: { centreOf?: PlaneCentreSource; reducedMotion?: boolean } = {}): Harness {
  const scene = new Scene()
  const camera = new PerspectiveCamera(55, CSS_WIDTH / CSS_HEIGHT, 0.1, 5000)
  const loop = new FrameLoop()
  const gl = {
    getSize: (target: Vector2) => target.set(CSS_WIDTH, CSS_HEIGHT),
    getDrawingBufferSize: (target: Vector2) => target.set(CSS_WIDTH, CSS_HEIGHT),
    getPixelRatio: () => 1,
    copyTextureToTexture: () => {},
  } as unknown as WebGLRenderer

  // The rig's own motion mirror, built from the same `planes.json` the scene composes from. This is
  // the oracle: an independent instance of `camera/motion.ts`, which is where PRD 5.7.1's law lives
  // and which knows nothing about `scene/worlds/`.
  const motion = new SceneMotion(PLANES, { reducedMotion: options.reducedMotion ?? false })
  // `syncClock` is the product's path (`motionSync.ts`), so the mirror must be told not to run a
  // clock of its own — otherwise `advance` would integrate the angle a second time and the two
  // readings below would differ by whatever the test's tick count happened to be.
  motion.setExternalClock(true)

  const worlds = attachWorlds({
    gl,
    scene,
    camera,
    loop,
    seams: NO_SEAMS,
    capabilities: { webgl2: true, maxArrayTextureLayers: 2048 },
  })
  worlds.setPlaneCentres(
    options.centreOf ??
      ((plane, out) => {
        motion.planePosition(out, plane)
        return out
      }),
  )
  worlds.setData({
    planes: PLANES.planes,
    stars: STARS,
    swatches: SWATCHES,
    multiverseRadius: PLANES.multiverseRadius,
  })

  let elapsed = 0
  let clockMs = 0
  const rate = (2 * Math.PI) / MULTIVERSE_PERIOD_S
  const tether = new Vector3()

  return {
    worlds,
    camera,
    motion,
    step: (deltaSeconds, plane, distance) => {
      elapsed += deltaSeconds
      // What `PlaneTable.advance` would have integrated by now, handed over the way `motionSync`
      // hands it over. `motion` 0 under reduced motion (PRD 5.9), which freezes the angle where it
      // stands rather than resetting it — the table's own behaviour.
      const scale = options.reducedMotion ? 0 : 1
      motion.syncClock(elapsed * scale, rate * elapsed * scale)

      motion.planePosition(tether, plane)
      camera.position.set(tether.x, tether.y, tether.z + distance)
      camera.lookAt(tether.x, tether.y, tether.z)
      camera.updateMatrixWorld(true)
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

      clockMs += deltaSeconds * 1000
      loop.tick(clockMs)
    },
    dispose: () => {
      worlds.dispose()
    },
  }
}

/** The payload's `radii` for `slug`, read the way the gate reads it. */
function radiiOf(harness: Harness, slug: string): number {
  const probe = worldsProbeOf(harness.worlds.probeSource(slug))
  expect(probe, `the payload for ${slug} must exist once the scene has ticked`).toBeDefined()
  // DEC-785 F1's trap: a well-formed payload of the wrong world reads as a measurement.
  expect(probe!.planeSlug).toBe(slug)
  return probe!.radii
}

/**
 * Hold `slug` at 2.2 radii for {@link HOLD_SECONDS} and return every reading.
 *
 * Sampled every 2.5 s, which is leg G's own interval, over 0.25 s frames — so the rows below measure
 * a scene that has actually run 70 frames rather than one that jumped. `radii` is a per-frame
 * quantity and a 17.5 s single step would hide anything that accumulates.
 */
function hold(harness: Harness, slug: string, radii = 2.2): number[] {
  const plane = planeFor(slug)
  const distance = worldRadius(plane.cardCount) * radii
  const readings: number[] = []
  const frames = Math.round(HOLD_SECONDS / 0.25)
  for (let frame = 0; frame <= frames; frame += 1) {
    harness.step(frame === 0 ? 0 : 0.25, plane, distance)
    if (frame % 10 === 0) readings.push(radiiOf(harness, slug))
  }
  return readings
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values)

describe('a world is where the camera thinks it is (DEC-804)', () => {
  describe('`radii` holds under normal motion', () => {
    for (const slug of SUBJECTS) {
      it(`${slug}: constant to +-${RADII_TOLERANCE} over a ${HOLD_SECONDS}s hold`, () => {
        const harness = build()
        try {
          const readings = hold(harness, slug)

          // **The clock must have moved**, or "constant" means "nothing happened". A hold row that
          // passes because time stood still is the failure `frameStepper` exists to prevent one
          // file over. 17.5 s at 2pi/1200 rad/s is 0.0916 rad.
          expect(harness.motion.multiverseRotation).toBeCloseTo(
            ((2 * Math.PI) / MULTIVERSE_PERIOD_S) * HOLD_SECONDS,
            6,
          )
          expect(readings.length).toBeGreaterThan(4)
          expect(spread(readings)).toBeLessThanOrEqual(RADII_TOLERANCE)
          for (const reading of readings) expect(reading).toBeCloseTo(2.2, 2)
        } finally {
          harness.dispose()
        }
      })

      it(`${slug}: MUTATION CONTROL — the static \`plane.home\` snapshot turns that row red`, () => {
        const harness = build({ centreOf: PLANE_HOME })
        try {
          const readings = hold(harness, slug)
          // Not merely "outside tolerance": the magnitude is the finding. `dominaria` drifts about
          // three quarters of a radius over the hold and `azgol` about fourteen, which is what
          // `|home| / radius` predicts (11 against 172) and what leg G measured on the browser.
          expect(spread(readings)).toBeGreaterThan(10 * RADII_TOLERANCE)
        } finally {
          harness.dispose()
        }
      })
    }
  })

  it('SENSITIVITY CONTROL — `radii` tracks the pose, so a constant would fail the hold rows', () => {
    const harness = build()
    try {
      const plane = planeFor('dominaria')
      const radius = worldRadius(plane.cardCount)
      for (const target of [1.6, 2.2, 3.2, 5.0]) {
        harness.step(0.25, plane, radius * target)
        expect(radiiOf(harness, 'dominaria')).toBeCloseTo(target, 3)
      }
    } finally {
      harness.dispose()
    }
  })

  it('the sheet is DRAWN at the plane position, camera or no camera', () => {
    // The visible half, with nothing posed: `mesh.position` is where the GPU rasterises the cell
    // sheet, and `planePosition` is where PRD 5.7.1 says the world is. The capture leg G banked
    // showed `alara` in the bottom-left corner with empty dust centred, which is this equality
    // failing by `|home| x 2 sin(angle/2)`.
    const harness = build()
    try {
      const plane = planeFor('alara')
      const expected = new Vector3()
      for (let frame = 0; frame < 30; frame += 1) {
        harness.step(0.5, plane, 20)
        const surface = harness.worlds.surfaces.find((s) => s.planeSlug === 'alara')!
        harness.motion.planePosition(expected, plane)
        expect(surface.mesh.position.distanceTo(expected)).toBeLessThan(1e-9)
        // The pick sheet shares the geometry; it must not be left behind at the composition-time
        // home, or §1.11 selects a cell the draw pass put somewhere else.
        expect(surface.pickMesh.position.distanceTo(expected)).toBeLessThan(1e-9)
      }
      // The control for the row: the world genuinely moved, so the equality above is not holding
      // because both sides are still sitting on `home`.
      const home = new Vector3(plane.home[0], plane.home[1], plane.home[2])
      expect(expected.distanceTo(home)).toBeGreaterThan(worldRadius(plane.cardCount))
    } finally {
      harness.dispose()
    }
  })

  it('the payload carries the terms `radii` is built from, and they reproduce it', () => {
    const harness = build()
    try {
      const plane = planeFor('dominaria')
      harness.step(4, plane, worldRadius(plane.cardCount) * 2.2)
      const probe = worldsProbeOf(harness.worlds.probeSource('dominaria'))!

      // The gate's check, on a live read. Not a tautology: `radii` is measured in the world's own
      // frame — centre at the origin, camera counter-rotated by the orientation — and these three
      // are the untransformed world-space terms. Agreement says the substitution is rigid.
      const centre = new Vector3(...probe.centre)
      const eye = new Vector3(...probe.cameraPosition)
      expect(probe.radius).toBeGreaterThan(0)
      expect(eye.distanceTo(centre) / probe.radius).toBeCloseTo(probe.radii, 6)

      // And the centre reported is the plane's position, not its home — the field would be useless
      // for auditing a drift if it were derived from the same snapshot that drifts.
      const expected = new Vector3()
      harness.motion.planePosition(expected, plane)
      expect(centre.distanceTo(expected)).toBeLessThan(1e-9)
      expect(centre.distanceTo(new Vector3(plane.home[0], plane.home[1], plane.home[2])))
        .toBeGreaterThan(0.5)
    } finally {
      harness.dispose()
    }
  })

  it('NEGATIVE CONTROL — under reduced motion the fix and the defect are indistinguishable', () => {
    // Expected GREEN on both trees, and that is the point. PRD 5.9 freezes the multiverse, so
    // `planePosition` is `home` and the two spellings coincide. Every worlds test in this repo that
    // runs under `?motion=0` was therefore blind to DEC-804 by construction, which is how a defect
    // this large survived a green suite. See `docs/worlds/gate-pose-defect.md`.
    const fixed = build({ reducedMotion: true })
    const unfixed = build({ reducedMotion: true, centreOf: PLANE_HOME })
    try {
      const a = hold(fixed, 'dominaria')
      const b = hold(unfixed, 'dominaria')
      expect(spread(a)).toBeLessThanOrEqual(RADII_TOLERANCE)
      expect(spread(b)).toBeLessThanOrEqual(RADII_TOLERANCE)
      for (let i = 0; i < a.length; i += 1) expect(a[i]!).toBeCloseTo(b[i]!, 9)
      expect(fixed.motion.multiverseRotation).toBe(0)
    } finally {
      fixed.dispose()
      unfixed.dispose()
    }
  })
})
