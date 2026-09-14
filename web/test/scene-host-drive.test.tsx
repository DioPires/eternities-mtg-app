/**
 * The two inputs that move the camera, arriving in either order (DEC-761 F1, DEC-763).
 *
 * `SceneHost` learns about the world through two independent setters. `setResources` brings
 * `planes.json` and the star buffer; `setNavigation` brings the camera rig. The `motionSync` and
 * `rig` tick phases need *both*, so whichever setter is called second is the one that must do the
 * attaching — and before this file, neither did reliably. `setNavigation` latched `this.navigation`
 * and *then* bailed out if the resources had not landed, so the identity guard at the top of the
 * method rejected every subsequent call and the `rig` phase ended up permanently empty.
 *
 * **What that costs, and why nothing noticed.** `attachCameraRig` is the only writer of the
 * camera's position and the only caller of `updateMatrixWorld`, so an empty `rig` phase is a camera
 * frozen at its construction distance for the whole session — the scene still renders, still spins,
 * still picks. The order happened to be safe because of two facts in two other files:
 * `useSceneData` publishes `planes` and `resources` in a single atomic `patch`, and
 * `EternitiesScene` declares its `setResources` effect immediately above its `setNavigation` one.
 * Swapping those two adjacent effects froze the camera with all 643 unit tests and all 23 e2e
 * specs still green. `grep setNavigation test/` returned nothing at all.
 *
 * So the assertion here is the one nothing else in the suite can make: *the `rig` phase has a
 * subscriber*. `FrameLoop.stepCount(phase)` exists for it. An empty phase is legal — most of the
 * ten are empty until the thing that drives them arrives — which is precisely why no error, no
 * type and no other test could ever have caught this one staying empty.
 *
 * **No GL.** `SceneRenderer`'s `createRenderer` seam takes the fake below; the constructor path
 * through `attachPostChain`, `attachStarScene` and `attachCardTier` builds three.js objects and
 * subscribes to phases, none of which touches a context. Nothing here calls `loop.tick()`, because
 * the `draw` phase would render for real. Whether the attached rig then actually flies the camera
 * is `e2e/` and the `?probe=shell` seam's job; whether it is attached at all is this file's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Texture, type WebGLRenderer } from 'three'

import { PlaneTable } from '../src/scene/starfield/planeTable'
import { StarGeometry } from '../src/scene/starfield/starGeometry'
import { createStarField } from '../src/scene/starfield/starFieldObjects'
import { createSceneNavigation, type SceneNavigation } from '../src/navigation/scene'
import { SceneHost } from '../src/scene/renderer/sceneHost'
import type { SceneResources } from '../src/scene/useSceneData'

import { loadFixturePlanes } from './fixtures'

/**
 * A `WebGLRenderer` stand-in covering exactly the construction-time surface.
 *
 * `extensions.has` answers false and the context is a plain object, so `isWebGL2` is false — which
 * is what keeps `detectPlatformCapabilities` from reaching `runHalfFloatProbe` and its sixty GL
 * calls. The capability answers that follow (no float targets, so the ladder starts two rungs down)
 * are irrelevant here: this file asserts about phase subscriptions, not about tiers.
 */
function fakeRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const context = {
    MAX_TEXTURE_SIZE: 0x0d33,
    ALIASED_POINT_SIZE_RANGE: 0x846d,
    getParameter: (name: number) => (name === 0x846d ? new Float32Array([1, 64]) : 8192),
  }
  return {
    domElement: canvas,
    toneMapping: -1,
    extensions: { has: () => false },
    getContext: () => context,
    getPixelRatio: () => 1,
    getDrawingBufferSize: (target: { set: (x: number, y: number) => unknown }) => {
      target.set(1280, 720)
      return target
    },
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  } as unknown as WebGLRenderer
}

function resourcesFor(planes: ReturnType<typeof loadFixturePlanes>): SceneResources {
  const table = new PlaneTable(planes.planes, planes.multiverseRadius)
  // `float32`, not the `float16` default: nothing here reads a position, and the unpadded stride is
  // the simpler of the two to construct without a GL probe deciding for us.
  const geometry = new StarGeometry(planes.planes.length, 'float32')
  const field = createStarField(table, geometry, new Texture())
  return { table, geometry, field, positionMode: 'float32' }
}

/**
 * jsdom has no `ResizeObserver`, and the card tier observes the canvas to keep its pointer box.
 *
 * Inert on purpose: it never delivers an entry, so the tier keeps its initial box. Nothing here
 * reads that box — a delivering stub is `scene-renderer.test.tsx`'s business, where the box is the
 * subject rather than a prerequisite.
 */
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

describe('SceneHost drive attachment (DEC-761 F1: either arrival order)', () => {
  let host: SceneHost
  let resources: SceneResources
  let navigation: SceneNavigation
  let restoreResizeObserver: () => void

  beforeEach(() => {
    restoreResizeObserver = installResizeObserver()
    const planes = loadFixturePlanes('small')
    host = new SceneHost({ createRenderer: fakeRenderer })
    resources = resourcesFor(planes)
    navigation = createSceneNavigation(planes, { drive: 'manual' })
  })

  afterEach(() => {
    host.dispose()
    restoreResizeObserver()
  })

  /** The two phases `attachDrive` owns, plus the one `buildCardTier` owns as a companion check. */
  const phases = (): { rig: number; motionSync: number; cards: number } => ({
    rig: host.renderer.loop.stepCount('rig'),
    motionSync: host.renderer.loop.stepCount('motionSync'),
    cards: host.renderer.loop.stepCount('cards'),
  })

  it('has no rig subscriber before either input arrives', () => {
    // The control row. Without it, an implementation that subscribed the `rig` phase from the
    // constructor would pass every assertion below while attaching a rig to no navigation.
    expect(phases()).toEqual({ rig: 0, motionSync: 0, cards: 0 })
  })

  it('attaches when the resources arrive first (the order the product happens to use)', () => {
    host.setResources(resources)
    expect(phases()).toEqual({ rig: 0, motionSync: 0, cards: 0 })

    host.setNavigation(navigation)
    expect(phases()).toEqual({ rig: 1, motionSync: 1, cards: 1 })
    expect(host.rig).toBe(navigation.rig)
  })

  it('attaches when the navigation arrives first — the defect', () => {
    // This is the swap the reviewer made in `EternitiesScene` to measure F1. Before the fix the
    // first call latched `this.navigation` and returned, and the second call reached no attach at
    // all: `rig` stayed 0 here while every other test in the suite stayed green.
    host.setNavigation(navigation)
    expect(phases()).toEqual({ rig: 0, motionSync: 0, cards: 0 })

    host.setResources(resources)
    expect(phases()).toEqual({ rig: 1, motionSync: 1, cards: 1 })
    expect(host.rig).toBe(navigation.rig)
  })

  it('attaches exactly once however many times the setters repeat', () => {
    // `EternitiesScene`'s navigation effect depends on `[scene3d, scene, bench]` and `bench` is an
    // object literal prop, so it re-fires with an unchanged `navigation` on every render of
    // `BenchScene`. A gate keyed only on "both present" would stack a second `motionSync` step —
    // and two copies of a step that writes the same mirror is not visibly wrong, just wasteful and
    // ordering-dependent.
    host.setNavigation(navigation)
    host.setResources(resources)
    host.setNavigation(navigation)
    host.setNavigation(navigation)
    host.setResources(resources)

    expect(phases()).toEqual({ rig: 1, motionSync: 1, cards: 1 })
  })

  it('honours drive: false in either order, so the bench keeps sole ownership of the camera', () => {
    // PRD 9.1.2: the bench flies the camera itself. Two writers on one camera and the measured
    // path stops being the path — so `motionSync` must still attach (the card tier reads the
    // mirror) while `rig` must not.
    host.setNavigation(navigation, { drive: false })
    host.setResources(resources)
    expect(phases()).toEqual({ rig: 0, motionSync: 1, cards: 1 })
  })

  it('honours drive: false when the resources land first too', () => {
    host.setResources(resources)
    host.setNavigation(navigation, { drive: false })
    expect(phases()).toEqual({ rig: 0, motionSync: 1, cards: 1 })
  })

  it('attaches nothing while the navigation is null', () => {
    // `setNavigation(null)` is the pre-`planes.json` state, and it must not consume the one-shot
    // gate: the real navigation arrives afterwards and still has to attach.
    host.setResources(resources)
    host.setNavigation(null)
    expect(phases()).toEqual({ rig: 0, motionSync: 0, cards: 0 })

    host.setNavigation(navigation)
    expect(phases()).toEqual({ rig: 1, motionSync: 1, cards: 1 })
  })
})
