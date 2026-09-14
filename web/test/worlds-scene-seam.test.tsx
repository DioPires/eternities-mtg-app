/**
 * `__eternitiesProbe.worlds()` answers, from the **mounted scene** (spec §3.1, DEC-768 F3).
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
import { Texture, Vector3, type WebGLRenderer } from 'three'

import { ServicesProvider, createNavStore, type Services } from '../src/app/services'
import { decodeStars, decodeSwatches } from '../src/data/decode'
import type { PlanesFile } from '../src/data/types'
import { createNavigationHost } from '../src/navigation'
import { Router, browserHost } from '../src/router/router'
import { SceneView } from '../src/scene/EternitiesScene'
import { SceneHost } from '../src/scene/renderer/sceneHost'
import { PlaneTable } from '../src/scene/starfield/planeTable'
import { StarGeometry } from '../src/scene/starfield/starGeometry'
import { createStarField } from '../src/scene/starfield/starFieldObjects'
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

/** A `WebGLRenderer` stand-in covering the construction, tick and probe surface. No context. */
function fakeRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const context = {
    MAX_TEXTURE_SIZE: 0x0d33,
    ALIASED_POINT_SIZE_RANGE: 0x846d,
    getParameter: (name: number) => (name === 0x846d ? new Float32Array([1, 64]) : 8192),
  }
  const size = <T extends { set: (x: number, y: number) => unknown }>(target: T): T => {
    target.set(CSS_WIDTH, CSS_HEIGHT)
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
  const field = createStarField(table, geometry, new Texture())
  return {
    manifest: null,
    planes: PLANES,
    resources: { table, geometry, field, positionMode: 'float32' },
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

  /**
   * Mount the shipped composition.
   *
   * `bench` is supplied, and that is the one deviation from the product's own page: PRD 9.1.2 makes
   * the bench the camera's sole owner, so `setNavigation(scene, { drive: false })` leaves the rig
   * unattached and the poses below stick. With the rig driving, every tick would overwrite the
   * camera with the rig's own and the rows would be asserting about whatever world it happened to
   * be nearest. Nothing else changes: both mutant lines run exactly as they do under `?probe=1`,
   * and `bench` is a shipped configuration rather than a hook opened for this file.
   */
  function mount(worlds = true): void {
    act(() => {
      render(
        <SceneView
          data={dataState(worlds)}
          reducedMotion
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
  }

  /** Put the camera `radii` of a world's own radius out, then tick. See `worlds-attach.test.ts`. */
  function poseAtWorld(slug: string, radii: number): void {
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

  it('installs the seam and answers `worlds()` with the world the camera is at', () => {
    mount()
    const probe = window.__eternitiesProbe
    expect(probe, 'the `?probe=1` seam must be installed').toBeDefined()

    // Kills M2 at the composition: without `setWorldData(worldData)` there are no surfaces, so
    // there is nothing to pose at and `worlds()` can only be `undefined`.
    expect(scene.worlds.surfaces).toHaveLength(WORLDS.length)

    // Before the first tick the payload is deliberately absent — §3.1's setup-failure path — which
    // is also the control that stops this row passing on a seam that answers a placeholder.
    expect(probe!.worlds()).toBeUndefined()

    poseAtWorld('dominaria', 2.2)

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
    mount()
    for (const slug of ['dominaria', 'alara']) {
      poseAtWorld(slug, 2.2)
      expect(window.__eternitiesProbe!.worlds()?.planeSlug).toBe(slug)
    }
  })

  it('answers `undefined` on a dataset with no worlds, which §3.1 makes a setup failure', () => {
    // The negative control, and the reason the rows above are not scoring an always-defined seam:
    // on a v2 page `swatches` never arrives, `worldData` is null, nothing composes, and `worlds()`
    // is `undefined` — the state §3.1 tells leg G to branch on. A tree where M2 is permanent looks
    // exactly like this one, which is why it takes both kinds of row to tell them apart.
    mount(false)
    expect(scene.worlds.surfaces).toHaveLength(0)
    act(() => {
      scene.renderer.loop.tick(17)
    })
    expect(window.__eternitiesProbe!.worlds()).toBeUndefined()
  })
})
