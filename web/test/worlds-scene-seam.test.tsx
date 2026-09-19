/**
 * `__eternitiesProbe.worlds()` answers, and the art stream **runs**, from the **mounted scene**
 * (spec §3.1, §1.6; DEC-768 F3, DEC-772).
 *
 * This file exists because of a defect that lived for four commits with the whole suite green:
 * `worlds()` returned `undefined` on every page. Every part was built and tested — the surfaces, the
 * attachment, the payload, `worldsProbeOf` — and the two lines that *join* them were not, so nothing
 * could see that the seam was unreachable.
 *
 * The reviewer measured the gap exactly (DEC-768 F3): two one-line mutants, each reproducing the
 * original bug, each leaving the suite at 867/867 and `tsc` at exit 0.
 *
 *  - **M1** — delete `worldsSource: () => scene3d.worldsProbeSource()` from `EternitiesScene.tsx`'s
 *    `useProbeSeam` call. Not even a type error: `ProbeSeamDeps.worldsSource` is optional, because a
 *    build with no worlds renderer is a real configuration.
 *  - **M2** — `scene3d.setWorldData(worldData)` -> `setWorldData(null)`. Nothing composes,
 *    `probeSource()` is `null`, and the seam turns that into `undefined`.
 *
 * **DEC-772 is the third of exactly the same shape, and it shipped.** `sceneHost` composed the
 * roster without passing `cardOf`, so `buildWorldSource` defaulted the printing lookup to
 * `() => null`, `WorldSurface` found no printing for any cell and the art stream was never *asked*:
 * `showing 0`, `artFraction 0.0%`, `pool.resident 0`, zero requests to Scryfall, on every world in
 * every configuration, with 882/882 green and four clean mutation matrices. Every `WorldSurface`
 * unit test supplies `cardOf` itself, so the suite exercised the stream fully and the one place that
 * omits it was covered by nothing. The second `describe` below is that gap closed — it is a
 * **wiring** row, not another surface row, and its subject is the fetch that leaves the page.
 *
 * So the subject here is the **composition**, not any part of it: `SceneView` is mounted for real,
 * over a real {@link SceneHost}, with the shipped v3 roster, and the assertion is made by calling
 * `window.__eternitiesProbe.worlds()` the way `scripts/verify-browser.mjs` does. `EternitiesScene`
 * is `SceneView` plus `useSceneData()` and nothing else — both mutant lines are inside `SceneView`,
 * and the loader is a prop precisely so a caller can supply one.
 *
 * **No GL.** `SceneHost` takes a `createRenderer` seam, and the tick runs every phase against the
 * stub below. Nothing here asserts a pixel; what it asserts is that a payload comes back at all and
 * that it describes the world the camera is at.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3, type WebGLRenderer } from 'three'

import { SceneMotion } from '../src/camera/motion'
import { ServicesProvider, createNavStore, type Services } from '../src/app/services'
import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { CardRecord, PlaneShardFile, PlanesFile } from '../src/data/types'
import { createNavigationHost } from '../src/navigation'
import { Router, browserHost } from '../src/router/router'
import { SceneView } from '../src/scene/EternitiesScene'
import { resetHalfFloatProbeForTests } from '../src/scene/platform/capabilities'
import { SceneHost } from '../src/scene/renderer/sceneHost'
import { PlaneTable } from '../src/scene/starfield/planeTable'
import { StarGeometry } from '../src/scene/starfield/starGeometry'
import type { SceneDataState } from '../src/scene/useSceneData'
import { worldPlanesOf } from '../src/scene/worlds/worldSource'

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

// The shipped worlds dataset, not a fixture: `swatches.bin` is only in the worlds/production roles,
// and a roster without it is one the scene declines to compose — which is M2's outcome, not a test.
const ROOT = datasetDir('worlds')
const PLANES = JSON.parse(readFileSync(resolve(ROOT, 'planes.json'), 'utf8')) as PlanesFile
const STARS = decodeStars(bufferOf(resolve(ROOT, 'stars.bin')))
const SWATCHES = decodeSwatches(bufferOf(resolve(ROOT, 'swatches.bin')))
const WORLDS = worldPlanesOf(PLANES.planes)

const CSS_WIDTH = 1280
const CSS_HEIGHT = 720

/**
 * The size {@link fakeRenderer} reports, in CSS px.
 *
 * A variable because §1.6's threshold has a **24 px floor** and the floor binds: at 1280x720 no cell
 * of Dominaria reaches 24 px at 2.2 radii, so nothing is admitted, nothing is fetched, and a suite
 * about the art stream would be asserting over an empty set. The art rows therefore run at §3.1's
 * pinned capture size (DEC-758), which is the size every W-criterion is stated at.
 */
let cssSize = { width: CSS_WIDTH, height: CSS_HEIGHT }

/**
 * A context that answers the three `getParameter`s `detectPlatformCapabilities` asks.
 *
 * A **class**, because `capabilities.ts` decides WebGL2 by `gl instanceof WebGL2RenderingContext`
 * and nothing else — never by a version string, which is review §3.7's rule. jsdom has no such
 * global, so a plain object reads as WebGL1 and the art pool clamps to zero layers. The suite that
 * needs a pool stubs the global with this constructor; see `withArtPool`.
 */
class FakeContext {
  readonly MAX_TEXTURE_SIZE = 0x0d33
  readonly ALIASED_POINT_SIZE_RANGE = 0x846d
  readonly MAX_ARRAY_TEXTURE_LAYERS = 0x88ff

  getParameter(name: number): unknown {
    if (name === this.ALIASED_POINT_SIZE_RANGE) return new Float32Array([1, 64])
    if (name === this.MAX_ARRAY_TEXTURE_LAYERS) return MAX_ARRAY_TEXTURE_LAYERS
    return 8192
  }
}

/** The WebGL2 spec minimum is 256; this is a plausible desktop answer and is above every rung. */
const MAX_ARRAY_TEXTURE_LAYERS = 2048

/** A `WebGLRenderer` stand-in covering the construction, tick and probe surface. No context. */
function fakeRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const context = new FakeContext()
  const size = <T extends { set: (x: number, y: number) => unknown }>(target: T): T => {
    target.set(cssSize.width, cssSize.height)
    return target
  }
  return {
    domElement: canvas,
    toneMapping: -1,
    autoClear: true,
    extensions: { has: () => false },
    getContext: () => context,
    getPixelRatio: () => 1,
    getSize: size,
    getDrawingBufferSize: size,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    // The `draw` phase runs like every other one: `PostChain.render` binds targets, saves and
    // restores the clear state, and draws four fullscreen quads. None of it needs a context here —
    // but all of it is called, which is the point of ticking the real loop rather than reaching
    // into the `worlds` phase on its own.
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    setScissorTest: vi.fn(),
    getClearAlpha: () => 1,
    getClearColor: (target: unknown) => target,
    setClearColor: vi.fn(),
    copyTextureToTexture: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels: vi.fn(),
    dispose: vi.fn(),
  } as unknown as WebGLRenderer
}

function dataState(worlds: boolean): SceneDataState {
  const table = new PlaneTable(PLANES.planes, PLANES.multiverseRadius)
  const geometry = new StarGeometry(PLANES.planes.length, 'float32')
  return {
    manifest: null,
    planes: PLANES,
    resources: { table, geometry, positionMode: 'float32' },
    drawable: 0,
    expected: 0,
    starsComplete: true,
    stars: worlds ? STARS : null,
    swatches: worlds ? SWATCHES : null,
    search: null,
    sets: null,
    report: [],
    ok: true,
  }
}

function installResizeObserver(): () => void {
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  return () => {
    globalThis.ResizeObserver = original
  }
}

function servicesWith(scene: SceneHost): Services {
  const nav = createNavigationHost()
  return { nav, navStore: createNavStore(nav), router: new Router(browserHost()), scene }
}

/**
 * Mount the shipped composition.
 *
 * `bench` is supplied, and that is the one deviation from the product's own page: PRD 9.1.2 makes
 * the bench the camera's sole owner, so `setNavigation(scene, { drive: false })` leaves the rig
 * unattached and the poses below stick. With the rig driving, every tick would overwrite the
 * camera with the rig's own and the rows would be asserting about whatever world it happened to
 * be nearest. Nothing else changes: every mutant line runs exactly as it does under `?probe=1`,
 * and `bench` is a shipped configuration rather than a hook opened for this file.
 */
function mount(scene: SceneHost, worlds = true, reducedMotion = true): SceneDataState {
  const data = dataState(worlds)
  act(() => {
    render(
      <SceneView
        data={data}
        reducedMotion={reducedMotion}
        chrome={false}
        bench={{ renderRunner: () => null }}
      />,
      {
        wrapper: ({ children }) => (
          <ServicesProvider services={servicesWith(scene)}>{children}</ServicesProvider>
        ),
      },
    )
  })
  // Returned so a row can read the **table** the page is running on. `multiverseAngle` is published
  // off `resources.table`, and a row that only read the angle back off the probe could not tell the
  // table's own integration from a number the seam invented. See the W5 rows at the end of the file.
  return data
}

/**
 * Step the loop by real 17 ms frames, starting from a timestamp it will accept as the future.
 *
 * **`FrameLoop.tick` takes an absolute timestamp, not a delta**, and `start()` seeds `lastNow` from
 * `performance.now()`. So the bare `tick(17)` every other row in this file uses computes
 * `max(0, (17 − performance.now()) / 1000)` — a delta of **0**. That is exactly right for those
 * rows, which want the phases to run and nothing to move, and exactly wrong for a row about
 * elapsed time: a frozen-angle assertion ticked that way passes on any tree at all, because no
 * time ever passes. This returns a stepper whose deltas are real, so "frozen" means `motion` is 0
 * rather than meaning the clock stood still.
 */
function frameStepper(scene: SceneHost): () => void {
  const base = performance.now() + 1_000
  let frame = 0
  // Primes `lastNow` to `base`, so every measured frame below is 17 ms rather than the distance
  // from whenever the loop happened to start.
  act(() => {
    scene.renderer.loop.tick(base)
  })
  return () => {
    frame += 1
    act(() => {
      scene.renderer.loop.tick(base + frame * 17)
    })
  }
}

/** Put the camera `radii` of a world's own radius out, then tick. See `worlds-attach.test.ts`. */
function poseAtWorld(scene: SceneHost, slug: string, radii: number): void {
  const surface = scene.worlds.surfaces.find((s) => s.planeSlug === slug)
  expect(surface, `${slug} must be composed before it can be posed at`).toBeDefined()
  const camera = scene.renderer.camera
  camera.position.copy(surface!.centre).add(new Vector3(0, 0, surface!.radius * radii))
  camera.lookAt(surface!.centre)
  camera.updateMatrixWorld(true)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  act(() => {
    scene.renderer.loop.tick(17)
  })
}

describe('the `?probe=` worlds seam, served from a mounted scene (§3.1, DEC-768 F3)', () => {
  let scene: SceneHost
  let restoreResizeObserver: () => void
  let dataMeta: HTMLMetaElement | null = null

  beforeEach(() => {
    // The seam is latched at first render off the URL, so this has to be set before mounting.
    window.history.replaceState({}, '', '/?probe=1')
    // `usePlaneDetail` resolves shard URLs through `dataRoot()`, which the build injects into
    // `index.html`. Nothing here fetches a shard, but the hook reads the root on mount.
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'eternities:data')
    meta.setAttribute('content', '/data/test/')
    document.head.appendChild(meta)
    dataMeta = meta
    restoreResizeObserver = installResizeObserver()
    scene = new SceneHost({ createRenderer: fakeRenderer })
  })

  afterEach(() => {
    dataMeta?.remove()
    dataMeta = null
    scene.dispose()
    restoreResizeObserver()
    delete window.__eternitiesProbe
    window.history.replaceState({}, '', '/')
  })

  it('installs the seam and answers `worlds()` with the world the camera is at', () => {
    mount(scene)
    const probe = window.__eternitiesProbe
    expect(probe, 'the `?probe=1` seam must be installed').toBeDefined()

    // Kills M2 at the composition: without `setWorldData(worldData)` there are no surfaces, so
    // there is nothing to pose at and `worlds()` can only be `undefined`.
    expect(scene.worlds.surfaces).toHaveLength(WORLDS.length)

    // Before the first tick the payload is deliberately absent — §3.1's setup-failure path — which
    // is also the control that stops this row passing on a seam that answers a placeholder.
    expect(probe!.worlds()).toBeUndefined()

    poseAtWorld(scene, 'dominaria', 2.2)

    // Kills M1: the seam has to have been handed a `worldsSource`. `ProbeSeamDeps.worldsSource` is
    // optional, so dropping it is not a type error — this call is the only thing that can see it.
    const payload = probe!.worlds()
    expect(payload, '`worlds()` must not be undefined on a page with a composed world').toBeDefined()
    expect(payload!.planeSlug).toBe('dominaria')
    expect(payload!.cells.length).toBeGreaterThan(0)
    // The pose this was measured at, in the unit §3.1 states its criteria in.
    expect(payload!.radii).toBeCloseTo(2.2, 6)
    // The payload is this frame's, measured at the size the renderer reports in CSS pixels.
    expect(payload!.viewport).toEqual({ width: CSS_WIDTH, height: CSS_HEIGHT })
    // The seams come back too, so leg G can check each control engaged before reading a criterion.
    expect(payload!.seams.artThresholdFixed24).toBe(false)
  })

  it('follows the camera between worlds, which is what makes the source a getter', () => {
    // `worldsSource` is a getter and deliberately not a dep of the seam's effect. A value captured
    // once would answer the first world for the rest of the session, and a dep would re-install the
    // probe under a driver mid-assertion.
    mount(scene)
    for (const slug of ['dominaria', 'alara']) {
      poseAtWorld(scene, slug, 2.2)
      expect(window.__eternitiesProbe!.worlds()?.planeSlug).toBe(slug)
    }
  })

  it('answers `undefined` on a dataset with no worlds, which §3.1 makes a setup failure', () => {
    // The negative control, and the reason the rows above are not scoring an always-defined seam:
    // on a v2 page `swatches` never arrives, `worldData` is null, nothing composes, and `worlds()`
    // is `undefined` — the state §3.1 tells leg G to branch on. A tree where M2 is permanent looks
    // exactly like this one, which is why it takes both kinds of row to tell them apart.
    mount(scene, false)
    expect(scene.worlds.surfaces).toHaveLength(0)
    act(() => {
      scene.renderer.loop.tick(17)
    })
    expect(window.__eternitiesProbe!.worlds()).toBeUndefined()
  })

  // --- §1's *"cells are reported for the focused plane only"* (DEC-785 F1) ---------------------

  /**
   * The pose the rows below sweep at, as a multiple of each world's **own** radius.
   *
   * **Not 2.2, and the reason is the whole finding.** `poseAtWorld` parks the camera at exactly
   * `radii` of the world it names, so at any single multiple that world's `radii` is the roster
   * *minimum* by construction and nearest-in-radii and focused-world agree for all 45 — which is
   * precisely why four passing rows above, and a whole green suite, never saw DEC-785 F1. The
   * harness could not express the disagreement it was supposed to be checking.
   *
   * At 8 the camera is far enough out in the target's own units that larger neighbours undercut it,
   * and the two selections disagree for 27 of 45 — the same shape leg G measured live at the gate's
   * navigation pose (42 of 45 there, where the rig's distance is not a multiple of anything).
   * {@link DISCRIMINATING_AT_LEAST} is what stops this constant silently drifting back to a value
   * where the rows are vacuous.
   */
  const SWEEP_RADII = 8

  /** The floor on that disagreement. A pose that discriminates for fewer than this scores nothing. */
  const DISCRIMINATING_AT_LEAST = 20

  it('reports the world it was asked for, at a pose where a different one is nearest in radii', () => {
    mount(scene)

    const asked: string[] = []
    const wrong: string[] = []
    const disagreed: string[] = []

    for (const target of scene.worlds.surfaces) {
      const slug = target.planeSlug!
      poseAtWorld(scene, slug, SWEEP_RADII)

      // The nearest-in-radii world, recomputed here from the live surfaces — an **independent
      // writer** of the no-argument path's answer, so the row below pins that path rather than
      // restating it. `radii` is `|camera − centre| / radius`, each world in its own units.
      let nearest = scene.worlds.surfaces[0]!
      for (const candidate of scene.worlds.surfaces) {
        if (candidate.radii < nearest.radii) nearest = candidate
      }
      if (nearest.planeSlug !== slug) disagreed.push(slug)

      // What §3.1's per-plane tour reads. Kills the drop-the-slug mutant: with the argument
      // ignored this is `nearest.planeSlug` for every world in `disagreed`.
      const payload = window.__eternitiesProbe!.worlds(slug)
      expect(payload, `worlds('${slug}') must answer at ${SWEEP_RADII} radii`).toBeDefined()
      asked.push(payload!.planeSlug!)
      if (payload!.planeSlug !== slug) wrong.push(`${slug} -> ${payload!.planeSlug}`)

      // The no-argument path, unchanged and still nearest-in-radii — the CEO's "byte-for-byte"
      // condition, checked rather than assumed. A fix that quietly rerouted this to navigation
      // would move every reader already written against it.
      expect(window.__eternitiesProbe!.worlds()!.planeSlug).toBe(nearest.planeSlug)
    }

    expect(wrong, 'every world must report itself').toEqual([])
    expect(asked).toHaveLength(scene.worlds.surfaces.length)

    // **The row above has to be able to fail.** Where the two selections agree, a seam that ignored
    // the slug entirely would answer correctly by coincidence — so the sweep is only evidence if it
    // contains worlds where they do not.
    expect(
      disagreed.length,
      `the pose must discriminate: at ${SWEEP_RADII} radii nearest-in-radii named the focused world ` +
        `for all ${scene.worlds.surfaces.length}, so these rows would pass on the unfixed tree too`,
    ).toBeGreaterThanOrEqual(DISCRIMINATING_AT_LEAST)
  })

  it('answers `undefined` for a slug this roster did not compose, never a neighbour', () => {
    mount(scene)
    poseAtWorld(scene, 'dominaria', SWEEP_RADII)
    const probe = window.__eternitiesProbe!

    // A plane that is real and on the roster but composed **nothing** — it has no cards, so
    // `worldPlanesOf` left it out. This is the case the gate hits on a mis-typed or retired slug,
    // and it is a stronger subject than an invented string because the slug itself is legitimate.
    const uncomposed = PLANES.planes.find(
      (plane) => !WORLDS.some((world) => world.slug === plane.slug),
    )
    expect(uncomposed, 'the roster must contain a plane that composes no world').toBeDefined()

    // Kills the fall-back-to-nearest mutant: at this pose `worlds()` is a *defined* payload for
    // some other world, so returning that instead of `undefined` is the easy wrong answer.
    expect(probe.worlds()).toBeDefined()
    expect(probe.worlds(uncomposed!.slug)).toBeUndefined()
    expect(probe.worlds('no-such-world-anywhere')).toBeUndefined()

    // The control that stops the two lines above passing on a seam that answers `undefined` to
    // everything — which is exactly what the pre-DEC-772 tree did.
    expect(probe.worlds('dominaria')?.planeSlug).toBe('dominaria')
  })

  it('keeps "the tick has not run" and "no such world" apart below the seam', () => {
    // Both collapse to `undefined` at `worlds()`, because leg G branches on the payload's absence
    // either way. Inside the app they are different facts, and `probeSource` is where the
    // distinction lives — so this is the only place it can be scored.
    mount(scene)

    // No tick yet: `lastFrame` is null. `null` is "nothing to report yet", for a slug that is
    // perfectly well composed.
    expect(scene.worlds.surfaces.some((s) => s.planeSlug === 'dominaria')).toBe(true)
    expect(scene.worlds.probeSource('dominaria')).toBeNull()
    expect(scene.worlds.probeSource()).toBeNull()

    poseAtWorld(scene, 'dominaria', SWEEP_RADII)

    // After a tick the same call answers, and only the unknown slug is `undefined` — so the two
    // states are told apart by the value and not by the timing.
    expect(scene.worlds.probeSource('dominaria')).not.toBeNull()
    expect(scene.worlds.probeSource('no-such-world-anywhere')).toBeUndefined()
  })

  // --- W5's azimuth: `ProbeState.multiverseAngle` (DEC-785 F2) --------------------------------

  it('publishes the table’s own multiverse angle, and it advances as the table advances', () => {
    // Motion **on**, which is the deviation from every other row in this file and the whole point:
    // `starScene` advances the table with `motion` 0 under reduced motion, so a frozen angle is the
    // default state here and a row that ran reduced could not tell a live seam from a dead one.
    const data = mount(scene, true, false)
    const table = data.resources!.table
    const step = frameStepper(scene)

    const readings: number[] = []
    for (let frame = 0; frame < 4; frame += 1) {
      step()
      // Against the **table**, not against the previous reading: this is what makes the field
      // testify to its provenance rather than merely to its existence. A `multiverseAngle: 0`
      // constant, a second clock, or `resources.table.time` by mistake all fail here — only the
      // getter the spec names passes, and it has to match on every frame, not once.
      expect(window.__eternitiesProbe!.state().multiverseAngle).toBe(table.multiverseAngle)
      readings.push(window.__eternitiesProbe!.state().multiverseAngle)
    }

    // And it has to have *moved*. `toBe(table.multiverseAngle)` alone would hold on a tree where
    // the table itself never advanced — the exact degeneracy §3.1 names, reported as a sweep.
    expect(readings[0], 'the first tick must have advanced the angle off zero').toBeGreaterThan(0)
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i], `frame ${i} must advance past frame ${i - 1}`).toBeGreaterThan(
        readings[i - 1]!,
      )
    }
  })

  it('publishes a frozen angle under reduced motion, which is the truth the gate must see', () => {
    // The negative control for the row above, and a **specification** rather than a limitation:
    // leg G's gate reports `frozen` as a named setup failure, so the seam has to hand it a genuinely
    // unmoving number. Synthesising advancement here would turn twelve samples of one frame into a
    // green W5 sweep that reads as the stronger claim.
    const data = mount(scene, true, true)
    const table = data.resources!.table
    // A **real** clock, for the reason in `frameStepper`'s header: ticked the way the other rows
    // tick, this row would read zero on a tree with reduced motion wired to nothing at all.
    const step = frameStepper(scene)

    for (let frame = 0; frame < 4; frame += 1) {
      step()
      expect(window.__eternitiesProbe!.state().multiverseAngle).toBe(0)
      expect(table.multiverseAngle).toBe(0)
    }
  })

  // --- The centre the worlds are drawn at (DEC-804) --------------------------------------------

  it('draws every world at the position the camera flies to, not at `plane.home`', () => {
    // **A wiring row, and the fourth of the shape this file was written for.** M1 dropped the probe
    // source, M2 dropped the world data, DEC-772 dropped `cardOf`; this one is
    // `sceneHost.attachDrive`'s `setPlaneCentres` call. Delete that one line and the worlds scene
    // silently reverts to `PLANE_HOME` — `worlds-centre.test.ts` stays green in full, because it
    // wires the law itself, and `radii` starts drifting again on a rig that never moved. There is
    // no type error to catch it: the setter has a default, for the cold start, exactly as
    // `cardOf` did.
    //
    // Motion **on**, for the same reason as the two rows above: under PRD 5.9's freeze
    // `planePosition` *is* `home` and the mutant is indistinguishable from the fix.
    const data = mount(scene, true, false)
    const table = data.resources!.table
    const step = frameStepper(scene)

    // An independent mirror of PRD 5.7.1's law, fed from the **page's own table** — the same
    // hand-over `motionSync` makes. Compared against the scene graph, not against another copy of
    // the arithmetic: `mesh.position` is where the GPU rasterises the sheet.
    const mirror = new SceneMotion(PLANES, {})
    mirror.setExternalClock(true)
    const expected = new Vector3()
    const home = new Vector3()

    let moved = 0
    for (let frame = 0; frame < 12; frame += 1) {
      step()
      mirror.syncClock(table.time, table.multiverseAngle)
      for (const plane of WORLDS) {
        const surface = scene.worlds.surfaces.find((s) => s.planeSlug === plane.slug)
        if (!surface) continue
        mirror.planePosition(expected, plane)
        expect(
          surface.mesh.position.distanceTo(expected),
          `${plane.slug} is drawn at ${surface.mesh.position.toArray().join()}, camera flies to ${expected.toArray().join()}`,
        ).toBeLessThan(1e-9)
        home.set(plane.home[0], plane.home[1], plane.home[2])
        if (expected.distanceTo(home) > 1e-6) moved += 1
      }
    }

    // The control: the roster has to have actually left `home` over those twelve frames, or the
    // equality above is two names for one unmoving number. 45 worlds x 12 frames, less the first
    // frame's zero angle.
    expect(moved, 'the multiverse must have turned for this row to mean anything').toBeGreaterThan(
      WORLDS.length * 8,
    )
  })

  // --- The angle §1.8's belt turns by (DEC-814) -------------------------------------------------

  it('turns the belt by the pages own multiverse angle, not by nothing', () => {
    // **A wiring row, and the fifth of the shape this file was written for.** M1 dropped the probe
    // source, M2 dropped the world data, DEC-772 dropped `cardOf`, DEC-804 dropped
    // `setPlaneCentres`; this one is `sceneHost.attachDrive`'s `setMultiverseAngle` call. Delete
    // that one line and §1.8's belt silently reverts to `NO_MULTIVERSE_ROTATION` — DEC-813 in full,
    // with `worlds-centre.test.ts` green throughout, because that file wires the law itself. There
    // is no type error to catch it: the setter has a default, for the cold start, exactly as
    // `cardOf` and `setPlaneCentres` did. [[a-cold-start-default-made-permanent]]
    //
    // Motion **on**, for the same reason as the rows above: under PRD 5.9's freeze the angle is 0
    // and the mutant is indistinguishable from the fix.
    const data = mount(scene, true, false)
    const table = data.resources!.table
    const step = frameStepper(scene)

    const belt = scene.worlds.belt
    expect(belt, 'the shipped roster carries a dust plane, so a belt composes').toBeTruthy()

    const readings: number[] = []
    for (let frame = 0; frame < 12; frame += 1) {
      step()
      // Against the **page's own** `PlaneTable` — the thing the star field's vertex shader reads and
      // that `motionSync` mirrors into the rig — rather than against a second integration here. If
      // the belt and the galaxy ever turned by different numbers, the belt would shear against the
      // stars as well as against the worlds.
      expect(belt!.rotation.y).toBe(table.multiverseAngle)
      readings.push(belt!.rotation.y)
    }

    // The control: the table has to have actually turned over those twelve frames, or the equality
    // above is two names for one unmoving zero — which is precisely the mutant's own state.
    expect(readings[0], 'the first tick must have advanced the angle off zero').toBeGreaterThan(0)
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i], `frame ${i} must advance past frame ${i - 1}`).toBeGreaterThan(
        readings[i - 1]!,
      )
    }
  })
})

// --- §1.6's art stream, on the shipped composition (DEC-772) -----------------------------------

const DOMINARIA = PLANES.planes.find((plane) => plane.slug === 'dominaria')!

/**
 * Dominaria's shards, by **global** star index — the key the contract writes them under.
 *
 * Read from disk here and served to the page by the `fetch` stub below, so the expectations and the
 * renderer are reading the same bytes by the same key. `starOffset + i` is the shard file's own
 * rule, and it is the join `sceneHost.worldCardOf` makes; spelling it twice, from opposite ends, is
 * what lets the `card`-instead-of-`starOffset + card` mutant be red rather than merely different.
 */
const DOMINARIA_CARDS = new Map<number, CardRecord>()
for (let shard = 0; shard < DOMINARIA.shardCount; shard += 1) {
  const file = JSON.parse(
    readFileSync(resolve(ROOT, 'planes', `dominaria.${shard}.json`), 'utf8'),
  ) as PlaneShardFile
  file.cards.forEach((card, index) => DOMINARIA_CARDS.set(file.starOffset + index, card))
}

/** `https://cards.scryfall.io/art_crop/front/a/b/<id>.jpg?<ts>` -> `<id>`. See `data/images`. */
function printingIdOf(url: string): string {
  return url.split('?')[0]!.split('/').pop()!.replace(/\.jpg$/, '')
}

describe('§1.6s art stream, asked by the shipped composition (DEC-772)', () => {
  let scene: SceneHost
  let restoreResizeObserver: () => void
  let dataMeta: HTMLMetaElement | null = null
  let shardsServed = 0
  let artRequests: string[] = []

  /**
   * Serve the shards from disk and record every Scryfall request instead of making one.
   *
   * The art fetch answers **404**, which is the honest stand-in: jsdom has no `createImageBitmap`,
   * so a 200 would fail at the decode instead and reach the same `pool.fail`. Nothing here asserts
   * on a resolved layer — `ArtPool.resident` only moves on `resolve()` — so what is scored is the
   * request that left the page, which is precisely the thing that read **zero** on main.
   */
  function installFetch(): () => void {
    const original = globalThis.fetch
    globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
      // `Request` and `URL` both stringify to the address; neither is ever passed here, and
      // `String(someObject)` would silently become `[object Object]` if one ever were.
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://cards.scryfall.io/')) {
        artRequests.push(url)
        return Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }))
      }
      const shard = /\/planes\/([a-z-]+)\.(\d+)\.json$/.exec(url)
      if (shard) {
        shardsServed += 1
        return Promise.resolve(
          new Response(readFileSync(resolve(ROOT, 'planes', `${shard[1]}.${shard[2]}.json`)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch in this suite: ${url}`))
    }
    return () => {
      globalThis.fetch = original
    }
  }

  let restoreFetch: () => void

  beforeEach(() => {
    // `?layers=64` rather than the tier's 1,024: §1.6's quantile admits against the pool's capacity,
    // so a small pool is a small admitted set and a 3.1 MiB array texture instead of a 48 MiB one.
    // The seam is read once, inside `attachWorlds`, so it has to be set before the host is built.
    window.history.replaceState({}, '', '/?probe=1&layers=64')
    // §3.1's pinned capture size. See `cssSize`: at 720p the 24 px floor admits nothing.
    cssSize = { width: 1920, height: 1080 }
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'eternities:data')
    meta.setAttribute('content', '/data/test/')
    document.head.appendChild(meta)
    dataMeta = meta
    restoreResizeObserver = installResizeObserver()
    // Without this the context reads as WebGL1, `resolveLayers` returns 0 and the stream is `null` —
    // a legal swatch-only session in which no wiring defect can show. See `FakeContext`.
    vi.stubGlobal('WebGL2RenderingContext', FakeContext)
    resetHalfFloatProbeForTests()
    shardsServed = 0
    artRequests = []
    restoreFetch = installFetch()
    scene = new SceneHost({ createRenderer: fakeRenderer })
  })

  afterEach(() => {
    dataMeta?.remove()
    dataMeta = null
    scene.dispose()
    restoreFetch()
    restoreResizeObserver()
    vi.unstubAllGlobals()
    resetHalfFloatProbeForTests()
    cssSize = { width: CSS_WIDTH, height: CSS_HEIGHT }
    delete window.__eternitiesProbe
    window.history.replaceState({}, '', '/')
  })

  /** Run the page until `done()`, or fail saying what never happened. */
  async function settleUntil(done: () => boolean, what: string): Promise<void> {
    for (let turn = 0; turn < 200 && !done(); turn += 1) {
      await act(async () => {
        await new Promise((wake) => setTimeout(wake, 0))
      })
    }
    expect(done(), what).toBe(true)
  }

  /**
   * Spin a fixed number of turns and assert nothing about them — for rows whose subject is an
   * **absence** (DEC-777 N4).
   *
   * `settleUntil` cannot express that: its loop exits the moment its predicate holds, so
   * `settleUntil(() => true, ...)` returns without awaiting a single turn and a row that used it to
   * "let the fetches happen" before asserting none did was asserting against zero elapsed time. The
   * absence was guaranteed by the harness, not by the code. This gives the code real turns to fail
   * in, so a fetch that *would* happen has somewhere to show up.
   */
  async function settleTurns(turns = 20): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) {
      await act(async () => {
        await new Promise((wake) => setTimeout(wake, 0))
      })
    }
  }

  it('asks Scryfall for the art of the cells it admits, through the shipped path', async () => {
    mount(scene)
    const probe = window.__eternitiesProbe!

    // A real pool, or the rest of this row is vacuous: with zero layers `attachWorlds` builds no
    // stream at all and `cardOf` is never consulted, so a missing wiring and a working one are
    // indistinguishable. This is the bound-must-bind control.
    expect(scene.worlds.pool.layers).toBe(64)

    // PRD 8.7.6, driven the way `scripts/visual-gate.mjs` drives it: focus is what fetches a plane's
    // shards, and on the worlds path it is also what puts that world in front of the camera.
    act(() => {
      expect(probe.focusPlane('dominaria')).toBe(true)
    })
    await settleUntil(() => shardsServed === DOMINARIA.shardCount, 'every dominaria shard must land')

    poseAtWorld(scene, 'dominaria', 2.2)
    await settleUntil(() => artRequests.length > 0, 'the art stream must reach the network')

    const payload = probe.worlds()!
    const surface = scene.worlds.surfaces.find((s) => s.planeSlug === 'dominaria')!
    const admitted = payload.cells.filter(
      (cell) => cell.frontFacing && cell.onScreen && cell.wantsArt,
    )
    expect(admitted.length).toBeGreaterThan(0)

    // What §1.6 says a cell fetches: printing **index 0** of the card that cell carries, which is
    // the printing `swatches.bin`'s own 2x2 statistic was taken from. Built here from the shard
    // bytes rather than from the renderer, so it is an independent writer of the same answer.
    const wanted = new Map<string, CardRecord>()
    for (const cell of admitted) {
      const card = surface.cardOfCell[cell.cell]!
      const record = DOMINARIA_CARDS.get(DOMINARIA.starOffset + card)!
      wanted.set(record.p[0]![0], record)
    }

    const requested = artRequests.map(printingIdOf)
    // The defect, scored: this read **0** on main at this pose, in this configuration, with nothing
    // erroring. `cardOf` is the only thing between admission and a request.
    expect(requested.length).toBeGreaterThan(0)
    for (const id of requested) {
      expect(wanted.has(id), `${id} is not printing 0 of any admitted cell's card`).toBe(true)
    }
    // **A floor, not just "more than zero" (DEC-777 N2).** `> 0` plus one-directional containment
    // detects the wiring being *absent* — DEC-772's exact shape — and nothing else: a
    // `cell % 8 === 0` regression drops 87.5% of the requests and both assertions above stay green.
    //
    // The floor cannot be tied to `artRequests`, which is what reached the *network*: the queue's
    // six-way concurrency bounds that at this instant, so it reads a dozen against 158 admitted
    // cells and any honest floor on it would be vacuous. The stream's own `requested` counts every
    // `request()` that issued, and DEC-778 published it, so it is readable from here now.
    //
    // What binds it is the pool, not the admitted set: 64 layers against far more admitted cells,
    // so the stream asks for exactly `layers` and records the rest as `declinedExhausted`. That
    // equality is stronger than a fraction — it says the stream asked for every layer it could get.
    const stream = payload.stream!
    expect(stream.requested).toBe(payload.pool.layers)
    expect(stream.declinedExhausted).toBeGreaterThan(0)
    expect(stream.declinedFailedBefore).toBe(0)
    // Not the budget: 64 bodies is far under 64 MiB, and a row where the budget bound here would be
    // scoring §1.6's byte rule where it means to score the wiring (DEC-780).
    expect(stream.declinedBudget).toBe(0)

    // §1.6's de-duplication: one request per key, however many frames want it.
    //
    // **That claim needs a second frame, and until DEC-777 N3 there was only ever one.** Within a
    // single frame every admitted cell already has a distinct key, so the assertion held by
    // construction and deleting `if (this.inFlight.has(key)) return layer` from `artStream.ts` left
    // this row green. Ticking again, with the same cells admitted and their requests still in
    // flight, is the state that guard exists for.
    poseAtWorld(scene, 'dominaria', 2.2)
    const afterSecondFrame = artRequests.map(printingIdOf)
    expect(new Set(afterSecondFrame).size).toBe(afterSecondFrame.length)
    // And the second frame must not have re-asked: `requested` counts keys, so a per-frame re-ask
    // inflates it past the pool that bounds it.
    expect(probe.worlds()!.stream!.requested).toBe(payload.pool.layers)

    // **The assertion above has to be able to fail.** A card with a single printing satisfies
    // "index 0" under every index rule, so if every requested card were single-printing the p[0]
    // rule would be pinned by nothing at all and a `p[p.length - 1]` mutant would stay green.
    const discriminating = requested.filter((id) => wanted.get(id)!.p.length > 1)
    expect(
      discriminating.length,
      'no requested card has a second printing, so the printing rule is untested here',
    ).toBeGreaterThan(0)
  })

  it('asks for nothing before a world’s shards land, which is the cold start §1.5 draws', async () => {
    // The negative control, and the reason the row above is not scoring an always-fetching page:
    // the same composition, the same pose, no focus — so no shard has been asked for, `cardOf`
    // answers `null` for every cell exactly as it does on the first frame of a real session, and
    // the world draws its swatches. A tree where the wiring is missing looks exactly like this one
    // at this point in the session, which is why it takes both rows to tell them apart.
    mount(scene)
    poseAtWorld(scene, 'dominaria', 2.2)
    // Real turns, not `settleUntil(() => true)` — see `settleTurns` (DEC-777 N4). This row's claim
    // is that nothing is asked for, and a wait that waits for nothing cannot support it.
    await settleTurns()

    const payload = window.__eternitiesProbe!.worlds()!
    expect(payload.cells.some((cell) => cell.frontFacing && cell.onScreen && cell.wantsArt)).toBe(
      true,
    )
    expect(shardsServed).toBe(0)
    expect(artRequests).toHaveLength(0)
    expect(payload.pool.resident).toBe(0)
  })
})
