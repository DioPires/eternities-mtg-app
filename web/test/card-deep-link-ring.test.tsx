/**
 * A card reached from the **route** gets a printing ring, not just a sheet (DEC-858, DEC-857 R5).
 *
 * `focused-card-host.test.tsx` guards the ring's *host*: focus a star, hand it a record, the ring
 * appears. That file passes on a tree where no route can ever focus a star — its subject is
 * `setFocusedStar`, and it calls it itself. `EternitiesScene` is where the call has to come from,
 * and until this file there was nothing between the two: the attachment set `focusedStar` from
 * `focusStar` alone, which is a click (PRD 5.6.1) or the probe. A card focus that arrived from the
 * URL — PRD 6.7.1's deep link, PRD 6.5.4's search result, PRD 6.2.2's back button — set nothing, so
 * the sheet showed the card and the scene showed no ring. Measured live on a real GPU: `card` null
 * for 45 s at `focus: 'card'` (DEC-857 R5, comment `a600281a` item 4).
 *
 * So the subject is the **composition**: `SceneView` mounted for real over a real {@link SceneHost},
 * driven through the product's own route-to-navigation adapter, asserted through the same
 * `__eternitiesProbe.state().card` the live measurement read. The click row above it is the
 * control — it is what tells a red route row from a harness that could never see a ring at all.
 *
 * **No GL.** `SceneHost` takes a `createRenderer` seam; nothing here asserts a pixel. What it
 * asserts is which star the ring was built around, which is a number the host holds either way.
 */

import { readFileSync } from 'node:fs'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebGLRenderer } from 'three'

import { ServicesProvider, createNavStore, type Services } from '../src/app/services'
import { decodeSets, decodeStars } from '../src/data/decode'
import { createNavigationHost, type NavigationHost } from '../src/navigation'
import { navigateTo } from '../src/router/binding'
import { Router, browserHost } from '../src/router/router'
import { SceneView } from '../src/scene/EternitiesScene'
import { SceneHost } from '../src/scene/renderer/sceneHost'
import { createStarData } from '../src/scene/starfield/starData'
import type { SceneDataState } from '../src/scene/useSceneData'

import { fixturePath, loadFixturePlanes } from './fixtures'

const FIXTURE = 'scale' as const
const DATA_ROOT = '/data/fixture/'

function bufferOf(path: string): ArrayBuffer {
  const file = readFileSync(path)
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

const PLANES = loadFixturePlanes(FIXTURE)
const STARS = decodeStars(bufferOf(fixturePath(FIXTURE, 'stars.bin')))
// The sidecar, because it is what `boot.ts` resolves a deep link through: `starIndexOf` on the way
// in, `oracleId` on the way back out. A hard-coded pair here would be a fixture of this file's own.
const SETS = decodeSets(bufferOf(fixturePath(FIXTURE, 'sets.bin')))

/** A plane with one shard and real cards. `blind-eternities` shards four ways and is slower. */
const PLANE_SLUG = 'alara'

/** A `WebGLRenderer` stand-in covering construction and one tick. No context. See `worlds-scene-seam`. */
function fakeRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const context = {
    MAX_TEXTURE_SIZE: 0x0d33,
    ALIASED_POINT_SIZE_RANGE: 0x846d,
    getParameter: (name: number) => (name === 0x846d ? new Float32Array([1, 64]) : 8192),
  }
  const size = <T extends { set: (x: number, y: number) => unknown }>(target: T): T => {
    target.set(1280, 720)
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

function dataState(): SceneDataState {
  const { table, geometry, positionMode } = createStarData(PLANES, STARS.count)
  // The whole field, uploaded: `hueClassOf` and `planeRowOf` are reads off this buffer and
  // `drawCount` is what tells a star index from an out-of-range one.
  geometry.append(STARS.interleaved, STARS.count)
  return {
    manifest: null,
    planes: PLANES,
    resources: { table, geometry, positionMode },
    drawable: STARS.count,
    expected: STARS.count,
    starsComplete: true,
    // Worlds compose from `stars` + `swatches`; this file is about the card tier, which is built
    // from `resources` and `navigation` alone. Leaving them null keeps the roster out of the tick.
    stars: null,
    swatches: null,
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

/** Serve the committed fixture out of `public/data`; 404 everything else (card art, chiefly). */
function stubFetch(): () => void {
  const real = globalThis.fetch
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const at = url.indexOf(DATA_ROOT)
    if (at < 0) return Promise.resolve(new Response('not fixture data', { status: 404 }))
    try {
      return Promise.resolve(new Response(readFileSync(fixturePath(FIXTURE, url.slice(at + DATA_ROOT.length)))))
    } catch {
      return Promise.resolve(new Response('missing', { status: 404 }))
    }
  })
  return () => {
    globalThis.fetch = real
  }
}

function servicesWith(scene: SceneHost, nav: NavigationHost): Services {
  return { nav, navStore: createNavStore(nav), router: new Router(browserHost()), scene }
}

function mount(scene: SceneHost, nav: NavigationHost): void {
  act(() => {
    render(<SceneView data={dataState()} reducedMotion host={nav} chrome={false} />, {
      wrapper: ({ children }) => (
        <ServicesProvider services={servicesWith(scene, nav)}>{children}</ServicesProvider>
      ),
    })
  })
}

/** Let the shard fetch, its `json()` and the effects it re-renders through all land. */
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('§1.10 the printing ring follows the route, not only the pointer (DEC-858)', () => {
  let scene: SceneHost
  let nav: NavigationHost
  let restoreResizeObserver: () => void
  let restoreFetch: () => void
  let dataMeta: HTMLMetaElement | null = null

  beforeEach(() => {
    // `usePlaneDetail` resolves shard URLs through `dataRoot()`, which the build injects here.
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'eternities:data')
    meta.setAttribute('content', DATA_ROOT)
    document.head.appendChild(meta)
    dataMeta = meta
    restoreResizeObserver = installResizeObserver()
    restoreFetch = stubFetch()
    scene = new SceneHost({ createRenderer: fakeRenderer })
    nav = createNavigationHost()
  })

  afterEach(() => {
    dataMeta?.remove()
    dataMeta = null
    nav.dispose()
    scene.dispose()
    restoreFetch()
    restoreResizeObserver()
    delete window.__eternitiesProbe
    window.history.replaceState({}, '', '/')
  })

  /**
   * The control, and the only row here that passed before the fix.
   *
   * It is what stops a red route row being read as "this harness cannot see a ring": it focuses a
   * card through `focusStar` — the path a click takes, run here by the probe seam, which the
   * `Probe` contract says calls the caller's `focusStar` rather than a second implementation — and
   * reads the subject back off the same seam the live measurement used.
   *
   * It also names the star the row below deep-links to, rather than this file choosing one:
   * `pickLoadedCard` ranks by printing count, so this is the alara card with the most planets to
   * draw, and `SETS.oracleId` turns it back into the id a URL would carry.
   */
  it('a click sets the ring subject', async () => {
    window.history.replaceState({}, '', `/plane/${PLANE_SLUG}?probe=1`)
    mount(scene, nav)
    act(() => {
      nav.flyToPlane(PLANE_SLUG, { reason: 'user' })
    })
    await settle()

    const probe = window.__eternitiesProbe
    expect(probe, 'the `?probe=1` seam must be installed').toBeDefined()
    expect(probe!.state().cardsLoaded, 'alara shard 0 must have landed').toBeGreaterThan(0)
    expect(probe!.state().card, 'nothing is focused yet').toBeNull()

    const star = probe!.focusCard()
    expect(star, 'a loaded card to click').toBeGreaterThanOrEqual(0)
    await settle(2)

    const card = probe!.state().card
    expect(card, 'a click must build the ring').not.toBeNull()
    expect(card!.starIndex).toBe(star)
    expect(card!.planets, 'PRD 5.6.7: the ring is the planets').toBeGreaterThan(0)
  })

  /**
   * The subject. Nothing clicks; the focus arrives the way `app/boot.ts` delivers a deep link.
   *
   * Two product calls and no third: `navigateTo` is the route-to-contract adapter both arms of
   * `createRouterBinding` use (boot's first stage and the back button alike), and `resolveCard` is
   * what boot calls when `sets.bin` turns the URL's `oracle_id` into a star index (PRD 8.7.5). The
   * intro is deliberately absent — PRD 6.8.2's fly-to moves the camera and never touches which star
   * is focused, so a row that needed it would be asserting about the camera instead of the ring.
   */
  it('a card focus that arrives from the route sets the same subject', async () => {
    // The star a click lands on, named by the control above, addressed here as a URL would.
    window.history.replaceState({}, '', `/plane/${PLANE_SLUG}?probe=1`)
    mount(scene, nav)
    act(() => {
      nav.flyToPlane(PLANE_SLUG, { reason: 'user' })
    })
    await settle()
    const star = window.__eternitiesProbe!.focusCard()
    expect(star).toBeGreaterThanOrEqual(0)
    const oracleId = SETS.oracleId(star)
    expect(SETS.starIndexOf(oracleId), 'the sidecar round-trips the id the URL carries').toBe(star)

    // Back to the multiverse, so nothing a click did is still standing when the route arrives.
    act(() => {
      nav.flyToMultiverse({ reason: 'user' })
    })
    await settle(2)
    expect(window.__eternitiesProbe!.state().card, 'the ring must be down before the deep link').toBeNull()

    // 1. The address bar, parsed by the router and dispatched by the binding. A route carries no
    //    star index — only a plane slug and an `oracle_id` — which is the whole of the defect.
    window.history.replaceState({}, '', `/plane/${PLANE_SLUG}/card/${oracleId}?probe=1`)
    const route = new Router(browserHost()).snapshot()
    expect(route.focus.kind, 'the URL must parse as a card focus').toBe('card')
    act(() => {
      navigateTo(nav, route.focus, 'deep-link')
    })
    await settle()

    // 2. `sets.bin` lands and PRD 6.7.1's resolution refines the focus in place.
    act(() => {
      nav.resolveCard(oracleId, { starIndex: star })
    })
    await settle(2)

    const state = window.__eternitiesProbe!.state()
    expect(state.focus, 'the focus is the card the URL named').toBe('card')
    expect(state.planeSlug).toBe(PLANE_SLUG)
    // The assertion, and the live reading it reproduces: `card` was null here for 45 s.
    expect(state.card, 'a route-sourced card focus must build the ring').not.toBeNull()
    expect(state.card!.starIndex).toBe(star)
    expect(state.card!.planets).toBeGreaterThan(0)

    // And it comes down again when the route leaves. This half used to be an effect of its own —
    // "Esc leaves the card, so the card object has to go with it" — and the derivation above
    // subsumes it: `focusParent` moves focus to the plane, which carries no `starIndex`. Deleting
    // the effect without this row would have left the ring standing at plane level.
    act(() => {
      nav.focusParent({ reason: 'history' })
    })
    await settle(2)
    const left = window.__eternitiesProbe!.state()
    expect(left.focus, 'PRD 6.1.3: Esc goes up a level').toBe('plane')
    expect(left.card, 'the ring must not outlive the card focus').toBeNull()
  })
})
