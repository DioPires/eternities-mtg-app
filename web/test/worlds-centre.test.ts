/**
 * A world is where the camera thinks it is (spec §1.2, §1.9, §3.1; PRD 5.3.15, 5.7.1; DEC-804).
 *
 * Leg G's acceptance run could not take a single §3.1 reading: of the first 15 worlds toured, **1
 * scored and 14 failed setup**, every one of them `could not reach 2.2 radii`. On a settled,
 * motionless rig `radii` drifted monotonically — `dominaria` 2.9203 → 2.1687 over 17.5 s while
 * `cameraDistance` held at 31.9293 to four decimals, and `azgol` 3.5140 → **17.4112**. Tables,
 * controls and the capture are DEC-804's, evidence comment `3410ba98`; leg G's own write-up of them
 * lands with leg G (it is not on main, so this file does not cite a path main does not carry).
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
 *
 * ---
 *
 * **The four consumer rows (DEC-811, closing DEC-809's N1–N3).** The rows above pin `radii` and
 * `mesh.position`. They are silent about the other four places the live centre is read, and each of
 * those survived the whole of DEC-809's ten-mutant matrix at 1060/1060 green:
 *
 *  - **`modelMatrix`** (`worldSurface.ts:464`) — the highest-value gap of the four, because it is
 *    the only one where the picture stays correct while the numbers the gate reads all move. The
 *    matrix defines the frame every cell quantity is measured in; point it back at `source.home` and
 *    the GPU still draws the sheet in the right place (that is `mesh.position`, which the row above
 *    pins) and `radii` is still right (that is `localCamera.position`, which the hold rows pin),
 *    while `onScreen`, `cellScreenRect`, `threshold.offer` and §1.6's `admit` are all computed as if
 *    the world were at its t=0 home. DEC-804's exact signature, in the one quantity §3.1 scores.
 *  - **§1.9's tether ends** (`attachWorlds.ts:449`), which share the vector by reference.
 *  - **§1.8's system instance** (`systemMesh.ts:199`) and **§1.7's atmosphere shell**
 *    (`atmosphere.ts:142`), the two consumers the `home` rename found at compile time.
 *
 * Each row below carries its **own** positive control, because for three of the four the wrong
 * answer is a *placement* and nothing about a placement is loud: the control is the reverted
 * expression's own value, measured in the same frame, and the row asserts the shipped value matches
 * the live centre *and* that the reverted one is outside the bound it just passed. A bound that the
 * defect would also satisfy is not a falsifier. [[a-bound-check-is-vacuous-when-the-bound-never-binds]]
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  Matrix4,
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
import { FrameLoop } from '../src/scene/renderer/frameLoop'
import { MULTIVERSE_PERIOD_S } from '../src/scene/tuning'
import { attachWorlds, type WorldsAttachment } from '../src/scene/worlds/attachWorlds'
import { PLANE_HOME, type PlaneCentreSource } from '../src/scene/worlds/centre'
import type { WorldsSeams } from '../src/scene/worlds/seams'
import { worldRadius } from '../src/scene/worlds/surfaceLaw'
import { worldPlanesOf } from '../src/scene/worlds/worldSource'
import { buildWorldsProbe, worldsProbeOf, type WorldsProbe } from '../src/scene/worlds/worldsProbe'

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

/** The orientation the world-space oracle below requires. See its precondition assertion. */
const IDENTITY = new Quaternion()

/**
 * `slug`'s payload, re-projected from **world space** about `centre`.
 *
 * The live source measures in the world's own frame: it reports `centre` as the origin and hands
 * over the orientation-folded `localCamera` (see `WorldSurface.orientation`). This swaps *both* for
 * the untransformed pair — the real camera, and a centre named by the caller — so it asks the
 * renderer's own `cellScreenRect` and `cellGridPoint` the same question in the frame the scene graph
 * is actually in. Every other field is the live source's, so the geometry, the arcs, the
 * subdivision and the threshold cannot differ; the only thing that moves the answer is **where the
 * composition put the world**, which is the quantity under test.
 *
 * That is also what makes `centre = plane.home` an exact model of the mutant rather than an
 * analogue: `cellScreenRect`'s only frame inputs are the folded `matrixWorldInverse`, the projection
 * and `near`, so `modelMatrix.compose(source.home, …)` publishes precisely this payload.
 */
function worldSpaceProbe(harness: Harness, slug: string, centre: Vector3): WorldsProbe {
  const live = harness.worlds.probeSource(slug)
  expect(live, `${slug} must be composed`).toBeTruthy()
  const camera = harness.camera
  return buildWorldsProbe({
    ...live!,
    centre,
    camera: {
      matrixWorldInverse: camera.matrixWorldInverse,
      projectionMatrix: camera.projectionMatrix,
      position: camera.position,
      near: camera.near,
    },
  })
}

/**
 * The share of `shipped`'s cells that `other` puts within a pixel of where `shipped` puts them.
 *
 * Keyed on the cell index rather than on array position, because `buildWorldsProbe` **drops** a cell
 * whose rect clips away or whose centre falls behind the near plane — so a wrong centre shows up as
 * much in the cells that vanish as in the ones that move, and a positional zip would pair a cell
 * with its neighbour and read the difference as sub-pixel agreement.
 */
/**
 * Far enough out that §1.5 puts **every** plane in step 2 and every world in step 8.
 *
 * Both passes *compact* their drawn instances to the front of the buffer with `mesh.count` set
 * behind them, so on a partial draw instance `i` and roster entry `i` would be different planes and
 * the whole comparison below would be between mismatched pairs. A full draw is what makes the slot
 * index the roster index, and `drawnCount` is asserted at every sample so the mapping is checked
 * rather than assumed.
 */
const SYSTEM_DISTANCE = 4000

/**
 * `Float32Array` instance buffers at multiverse scale — `|home|` runs to 110 — so this is a float32
 * tolerance and not a float64 one. Worst shipped offset observed over both passes and every sample
 * is **5.3e-6**; the defect it has to separate is 24 to 128 scene units, five orders the other way.
 */
const INSTANCE_TOLERANCE = 1e-3

const instanceMatrix = new Matrix4()
const instanceAt = new Vector3()
const instanceLive = new Vector3()
const instanceHome = new Vector3()

/**
 * Where an `InstancedMesh` put each of `planes`, against where the plane actually is.
 *
 * Returns both halves of the claim, because on their own neither is a falsifier:
 * `worstLiveOffset` says the shipped placement tracks `planePosition`, and `movedSinceHome` counts
 * the planes for which `home` and the live position are further apart than that bound — so the
 * reverted `plane.home` expression is outside it at **every** instance rather than on average.
 * [[a-total-is-invariant-under-misrouting]]
 */
function instancePlacement(
  harness: Harness,
  attribute: { readonly array: ArrayLike<number> },
  planes: readonly PlaneRecord[],
): { worstLiveOffset: number; movedSinceHome: number } {
  let worstLiveOffset = 0
  let movedSinceHome = 0
  for (const [index, plane] of planes.entries()) {
    instanceMatrix.fromArray(attribute.array, index * 16)
    instanceAt.setFromMatrixPosition(instanceMatrix)
    harness.motion.planePosition(instanceLive, plane)
    instanceHome.set(plane.home[0], plane.home[1], plane.home[2])
    worstLiveOffset = Math.max(worstLiveOffset, instanceAt.distanceTo(instanceLive))
    if (instanceHome.distanceTo(instanceLive) > INSTANCE_TOLERANCE) movedSinceHome += 1
  }
  return { worstLiveOffset, movedSinceHome }
}

function agreementShare(shipped: WorldsProbe, other: WorldsProbe): number {
  const byCell = new Map(other.cells.map((cell) => [cell.cell, cell]))
  let agreeing = 0
  for (const cell of shipped.cells) {
    const mate = byCell.get(cell.cell)
    if (mate && Math.hypot(cell.x - mate.x, cell.y - mate.y) <= 1) agreeing += 1
  }
  return agreeing / shipped.cells.length
}

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
    // this large survived a green suite. See DEC-804, evidence comment `3410ba98`.
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

  describe('the four other consumers of the live centre (DEC-811, DEC-809 N1-N3)', () => {
    // 60 s a sample: 0.3142 rad of PRD 8.5.3's rotation, so a four-sample sweep covers a fifth of
    // the 1,200 s period rather than a neighbourhood of t=0 — where `planePosition` *is* `home` and
    // every row here is vacuous by construction.
    const SAMPLE_SECONDS = 60
    const SAMPLES = 4

    for (const slug of ['alara', 'dominaria'] as const) {
      it(`${slug}: every cell's (x, y) is the projection about the LIVE centre, swept over the angle`, () => {
        const harness = build()
        try {
          const plane = planeFor(slug)
          const radius = worldRadius(plane.cardCount)
          const home = new Vector3(plane.home[0], plane.home[1], plane.home[2])
          const live = new Vector3()

          for (let sample = 0; sample <= SAMPLES; sample += 1) {
            harness.step(sample === 0 ? 0 : SAMPLE_SECONDS, plane, radius * 2.2)
            harness.motion.planePosition(live, plane)
            const surface = harness.worlds.surfaces.find((s) => s.planeSlug === slug)!

            // **The precondition the oracle rests on, asserted rather than assumed.** With
            // `APPLY_PLANE_TILT` off (`spin.ts`) and no spin source installed, the orientation is
            // the identity — so local-to-world is a pure *translation* and `cellScreenRect` gives
            // the same answer in either frame. Turn either on and this row goes red loudly, which
            // is the correct failure: `worldSpaceProbe` would no longer be an oracle, and a row
            // that quietly kept passing would be asserting nothing.
            expect(surface.orientation.angleTo(IDENTITY)).toBeLessThan(1e-12)

            const shipped = worldsProbeOf(harness.worlds.probeSource(slug))!
            // DEC-785 F1's trap: a well-formed payload of the wrong world reads as a measurement.
            expect(shipped.planeSlug).toBe(slug)
            expect(shipped.cells.length).toBeGreaterThan(0)

            // Cell for cell, and on the three fields the frame can move: the projected centre
            // §3.1's W2 samples the PNG at, the admission height W1 and W4 score, and the frustum
            // verdict W4's denominator needs.
            const atLive = worldSpaceProbe(harness, slug, live)
            const byCell = new Map(atLive.cells.map((cell) => [cell.cell, cell]))
            expect(byCell.size).toBe(shipped.cells.length)
            let worstPx = 0
            for (const cell of shipped.cells) {
              const mate = byCell.get(cell.cell)!
              expect(mate, `cell ${cell.cell} must survive in world space too`).toBeDefined()
              worstPx = Math.max(worstPx, Math.hypot(cell.x - mate.x, cell.y - mate.y))
              expect(cell.height).toBeCloseTo(mate.height, 6)
              expect(cell.onScreen).toBe(mate.onScreen)
            }
            // Worst observed over both worlds and all five samples: **2.3e-12 px**. The bound is
            // three orders looser than that and still eleven orders tighter than the defect, which
            // moves cells by hundreds of pixels or off the frame altogether.
            expect(worstPx).toBeLessThan(1e-9)
            expect(agreementShare(shipped, atLive)).toBe(1)

            // **The in-row positive control**, and it is the mutant's own payload rather than an
            // analogue — see `worldSpaceProbe`. Not one cell of it lands within a pixel of where
            // the shipped payload puts it, at **every** sample including the warm-up tick.
            //
            // > **The two worlds fail the mutant in two different shapes, which is why both are
            // > here.** Measured at these poses: on `dominaria` (radius 9.9779, `|home|` 109.5740)
            // > the wrong centre still publishes all **6,271** cells — the world is large enough to
            // > stay in frame — and every one of them is simply in the wrong place, a silent
            // > misplacement of exactly the kind §3.1 scores. On `alara` (radius 2.8455, `|home|`
            // > 77.8935) it publishes **0** cells from the first rotated sample on: the world has
            // > left the frame entirely, which reads as a *setup failure* rather than as a wrong
            // > number. DEC-809 measured the same asymmetry on the unfixed browser build, where
            // > `alara`'s payload carried no cell table at all.
            //
            // The warm-up tick is scored too, and the measurement behind it is worth banking: at
            // t=0 the rotation has not turned, so the whole separation is PRD 5.3.15's **drift** —
            // and that term alone is 0.8827 units on `alara` (0.3102 radii) and 0.8516 on
            // `dominaria` (0.0854 radii), which already moves every cell well past a pixel at 2.2
            // radii. So `home` is not the live position even at t=0 on the shipped roster. The
            // regime where the two genuinely coincide is PRD 5.9's reduced motion, which zeroes
            // *both* terms — that is the NEGATIVE CONTROL row above, and it is the one regime in
            // which this row could not discriminate.
            const atHome = worldSpaceProbe(harness, slug, home)
            expect(agreementShare(shipped, atHome)).toBe(0)
            // The separation the control just exploited, in radii — so the bound above is one the
            // defect fails rather than one it would also pass. 0.085 at the warm-up tick; 3.42 on
            // `dominaria` and 8.59 on `alara` one 60 s step later, rising to 12.87 and 32.14.
            expect(home.distanceTo(live) / radius).toBeGreaterThan(sample === 0 ? 0.08 : 3)
          }
        } finally {
          harness.dispose()
        }
      })
    }

    it('§1.9s tether ends SHARE the centre, so the ribbon cannot re-freeze at composition time', () => {
      const harness = build()
      try {
        const focus = planeFor('dominaria')
        // Named **before any frame has run**, which is the state a `.clone()` is worst in:
        // `surface.centre` is still the constructor's t=0 seed, so a cloned end is pinned to `home`
        // for the session. A clone taken later is pinned to whenever `setTether` ran, which this
        // row also catches — the assertion is that the pad tracks, at every sample.
        harness.worlds.setTether(['dominaria', 'azgol'])
        expect(harness.worlds.tether.active).toBe(true)

        const live = new Vector3()
        const home = new Vector3()
        // Per end, the pad's distance from its world's live centre in that world's own radii.
        // `placePad` puts the pad on `end.centre + anchor * radius * PAD_LIFT` and `anchor` is a
        // unit direction, so this ratio is a constant of the pass whatever the anchor is doing —
        // which is what makes its *constancy* an assertion and not a restatement of the pose.
        const lifts: [number[], number[]] = [[], []]
        for (let sample = 1; sample <= SAMPLES; sample += 1) {
          harness.step(SAMPLE_SECONDS, focus, worldRadius(focus.cardCount) * 2.2)
          const ends = [
            [harness.worlds.tether.pads[0], planeFor('dominaria')],
            [harness.worlds.tether.pads[1], planeFor('azgol')],
          ] as const
          for (const [index, [pad, plane]] of ends.entries()) {
            const radius = worldRadius(plane.cardCount)
            harness.motion.planePosition(live, plane)
            home.set(plane.home[0], plane.home[1], plane.home[2])
            lifts[index === 0 ? 0 : 1].push(pad.position.distanceTo(live) / radius)
            // The pad rides its world's surface, so it is inside a ball of just over one radius
            // about the live centre.
            expect(pad.position.distanceTo(live)).toBeLessThan(radius * 1.05)
            // **And the bound binds.** A cloned end would put the pad within a radius of `home`
            // instead, which is this far out — so the assertion above is one the defect fails
            // rather than one it would also pass.
            expect(home.distanceTo(live) / radius).toBeGreaterThan(2.05)
          }
        }
        // `PAD_LIFT` is private to `tether.ts` and is pinned there; what matters here is that the
        // ratio does not move, because a centre that had stopped tracking would show up as a pad
        // walking away from its world one sample at a time.
        for (const perEnd of lifts) {
          expect(perEnd.length).toBe(SAMPLES)
          expect(spread(perEnd)).toBeLessThan(1e-9)
          expect(perEnd[0]!).toBeGreaterThan(1)
        }
      } finally {
        harness.dispose()
      }
    })

    it('§1.8s system instances are placed at the LIVE centre, all 87 of them', () => {
      const harness = build()
      try {
        const focus = planeFor('dominaria')
        for (let sample = 1; sample <= SAMPLES; sample += 1) {
          harness.step(SAMPLE_SECONDS, focus, SYSTEM_DISTANCE)
          const system = harness.worlds.system!
          // The mapping from instance slot to plane, pinned rather than assumed — see
          // {@link instancePlacement}.
          expect(system.drawnCount).toBe(system.planes.length)
          const placement = instancePlacement(harness, system.mesh.instanceMatrix, system.planes)
          expect(placement.worstLiveOffset).toBeLessThan(INSTANCE_TOLERANCE)
          // Every instance, not the aggregate: the reverted expression is wrong at all **87** of
          // them — §1.8 draws every non-dust plane, moons included, and they orbit too.
          expect(placement.movedSinceHome).toBe(system.planes.length)
        }
      } finally {
        harness.dispose()
      }
    })

    it('§1.7s atmosphere shells are placed at the LIVE centre, all 45 of them', () => {
      const harness = build()
      try {
        const focus = planeFor('dominaria')
        for (let sample = 1; sample <= SAMPLES; sample += 1) {
          harness.step(SAMPLE_SECONDS, focus, SYSTEM_DISTANCE)
          const atmosphere = harness.worlds.atmosphere!
          // §1.7's *"every world that is drawn at all"*, which at this distance is all 45. The
          // pass holds `worldPlanesOf(planes)`, which is what `WORLDS` is — so the count is also
          // what pins slot `i` to `WORLDS[i]`.
          expect(atmosphere.drawnCount).toBe(WORLDS.length)
          const placement = instancePlacement(harness, atmosphere.mesh.instanceMatrix, WORLDS)
          expect(placement.worstLiveOffset).toBeLessThan(INSTANCE_TOLERANCE)
          expect(placement.movedSinceHome).toBe(WORLDS.length)
        }
      } finally {
        harness.dispose()
      }
    })
  })
})
