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
import { Texture, Vector3, type WebGLRenderer } from 'three'

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
function mount(scene: SceneHost, worlds = true): void {
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
    // §1.6's de-duplication: one request per key, however many frames want it.
    expect(new Set(requested).size).toBe(requested.length)

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
    await settleUntil(() => true, 'the tick must run')

    const payload = window.__eternitiesProbe!.worlds()!
    expect(payload.cells.some((cell) => cell.frontFacing && cell.onScreen && cell.wantsArt)).toBe(
      true,
    )
    expect(shardsServed).toBe(0)
    expect(artRequests).toHaveLength(0)
    expect(payload.pool.resident).toBe(0)
  })
})
