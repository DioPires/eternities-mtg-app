/**
 * The renderer: one canvas, one `WebGLRenderer`, one camera, one loop (review §3.5, §3.6 phase 3).
 *
 * > One `SceneRenderer` created in `createServices()` next to the navigation host and router,
 * > owning the canvas, the `WebGLRenderer`, one `requestAnimationFrame`, and a fixed order per tick.
 *
 * This is what `<Canvas>` was. The difference is not that it is a class — it is that **nothing here
 * is reachable from a render**. `<Canvas>` resolved its `gl` options, its camera and its pixel ratio
 * from props, which meant every one of them was a value React owned and could recompute; the three
 * long comments in `EternitiesScene` about refs-not-state, and the whole of
 * `platform/PixelRatioHost`'s header, are that fact being worked around one field at a time. Here
 * the renderer is constructed once, outside React, with the same lifetime as the page — the
 * argument `app/services.tsx` already makes for the navigation host and the router, now applied to
 * the thing those two were always talking to.
 *
 * **The public surface names no three.js type.** `app/` and `ui/` hold and drive this object, and
 * `eslint.config.js` forbids both from importing three (review §3.6, item 6). So `mount` takes an
 * `HTMLElement`, the quality rungs arrive as numbers, and what goes back out is
 * {@link FrameStatsFields} — plain data. The scene graph is reachable through {@link scene} and
 * {@link camera} for the modules under `scene/` that legitimately need it, and for nobody else.
 */

import { NoToneMapping, PerspectiveCamera, Scene, WebGLRenderer } from 'three'

import {
  observeBackingStore,
  observeDevicePixelRatio,
  resolvePixelRatio,
  type BackingStoreSize,
} from '../platform/backingStore'
import { SKY_COLOUR } from '../tuning'

import { FrameLoop, type FrameTiming } from './frameLoop'
import { createFrameStats, type FrameStatsFields, type FrameStatsSnapshot } from './frameStats'

/** PRD 5.2: the camera's vertical field of view. Was `EternitiesScene`'s `FOV` constant. */
export const FOV = 55
const NEAR = 0.1
const FAR = 8000
/** PRD 6.8.2's opening pose, before the intro takes over. Was the `<Canvas camera>` prop. */
const START_POSITION = [0, 150, 260] as const

export interface SceneRendererOptions {
  /**
   * `preserveDrawingBuffer`, for `?probe=1` only.
   *
   * Without it a screenshot of the canvas is whatever frame the compositor last kept, which is not
   * necessarily the frame the assertions were made against — it cost PRD 9.3's checkpoint images
   * their credibility once already. Preserving every frame is a full-buffer copy nobody is paying
   * for in production, so it stays off by default.
   */
  readonly preserveDrawingBuffer?: boolean
  /** The tier's `pixelRatioCap` at construction (PRD 8.5.11's first rung). */
  readonly pixelRatioCap?: number
  /**
   * Injected by the tests. jsdom has no WebGL, and the point of the seam is that everything in
   * this file except the three lines that touch the GL context is testable without one.
   */
  readonly createRenderer?: (canvas: HTMLCanvasElement) => WebGLRenderer
}

export class SceneRenderer {
  readonly canvas: HTMLCanvasElement
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly loop: FrameLoop
  /** The mutable record the loop writes and one HUD leaf polls. See `./frameStats`. */
  readonly stats: FrameStatsFields = createFrameStats()

  private readonly gl: WebGLRenderer
  /** Undone in {@link dispose}: the backing-store observer and the `matchMedia` re-arm. */
  private readonly teardown: Array<() => void> = []

  private container: HTMLElement | null = null
  private pixelRatioCap: number
  private backingStore: BackingStoreSize | null = null

  constructor(options: SceneRendererOptions = {}) {
    this.pixelRatioCap = options.pixelRatioCap ?? 1

    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.background = SKY_COLOUR

    const create =
      options.createRenderer ??
      ((canvas: HTMLCanvasElement) =>
        new WebGLRenderer({
          canvas,
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
        }))
    this.gl = create(this.canvas)
    // `flat` on the old `<Canvas>`: the post chain's composite does PRD 5.3.20's tone map itself,
    // so a second one in the renderer would apply it twice.
    this.gl.toneMapping = NoToneMapping

    this.camera = new PerspectiveCamera(FOV, 1, NEAR, FAR)
    this.camera.position.set(START_POSITION[0], START_POSITION[1], START_POSITION[2])

    this.loop = new FrameLoop({
      onTickEnd: (timing, cpuMs) => this.recordTick(timing, cpuMs),
    })
  }

  /** The `WebGLRenderer`, for the modules under `scene/` that draw with it. */
  get renderer(): WebGLRenderer {
    return this.gl
  }

  /** The last `device-pixel-content-box` observation, for the `?probe=1` seam and the bench. */
  get backingStoreSize(): BackingStoreSize | null {
    return this.backingStore
  }

  get statsSnapshot(): FrameStatsSnapshot {
    return this.stats
  }

  /**
   * Put the canvas in the page and start the loop.
   *
   * The observers are armed here rather than in the constructor because both of them measure the
   * canvas, and a canvas that is not in a document has no box to measure — `ResizeObserver` would
   * fire once with zeroes and `resolvePixelRatio` would size the drawing buffer to nothing.
   */
  mount(container: HTMLElement): void {
    if (this.container === container) return
    this.unmount()
    this.container = container
    container.appendChild(this.canvas)

    // Before the first frame, not after: with no size applied the renderer's default is 300x150 and
    // the first frame would be drawn at it. This is the ordering `PixelRatioHost`'s header is about
    // — it had to push the first write into `<Canvas onCreated>` to beat R3F's resize subscription,
    // and with no R3F there is no subscription to beat.
    this.applyPixelRatio()
    this.resize()

    this.teardown.push(
      observeBackingStore(this.canvas, (size) => {
        this.backingStore = size
        this.applyPixelRatio()
        this.resize()
      }),
    )
    // A window dragged to a monitor with a different `devicePixelRatio` fires no `resize` and no
    // `ResizeObserver` callback when the CSS box is unchanged, so this is the only notification of
    // that case — and it is the case a prop could never see, which is the whole argument for
    // owning the ratio here. See `platform/backingStore`.
    this.teardown.push(observeDevicePixelRatio(() => this.applyPixelRatio()))

    this.loop.start()
  }

  unmount(): void {
    this.loop.stop()
    for (const undo of this.teardown.splice(0)) undo()
    this.canvas.remove()
    this.container = null
  }

  /**
   * PRD 8.5.11's first rung. Called by the quality subscription, not by a render.
   *
   * Idempotent: an unchanged cap re-resolves to an unchanged ratio and three's `setPixelRatio`
   * short-circuits, so the tier subscription can call this on every announcement.
   */
  setPixelRatioCap(cap: number): void {
    if (cap === this.pixelRatioCap) return
    this.pixelRatioCap = cap
    this.applyPixelRatio()
    this.resize()
  }

  dispose(): void {
    this.unmount()
    this.gl.dispose()
  }

  /**
   * `min(tier cap, devicePixelRatio)`.
   *
   * **From `devicePixelRatio`, not from the observed device-pixel box**, and the distinction is
   * load-bearing: under Chromium's device emulation — which is what Playwright's
   * `deviceScaleFactor` uses, and therefore every CI run of this app — the canvas reports a
   * `devicePixelContentBoxSize` equal to its *CSS* box while `window.devicePixelRatio` reports 2.
   * Deriving the cap from that box resolves every tier to 1.0 and makes the ladder's first rung
   * unobservable. The box decides *when to re-ask* and is published for the probe; the ratio
   * decides the number. See `platform/PixelRatioHost`'s header, which this replaces.
   */
  private applyPixelRatio(): void {
    const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio
    this.gl.setPixelRatio(resolvePixelRatio(this.pixelRatioCap, device))
  }

  /** The canvas's CSS box drives the drawing buffer and the camera's aspect. */
  private resize(): void {
    const container = this.container
    if (!container) return
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return
    // `false`: three must not write `style.width`/`style.height` back onto the canvas. The canvas
    // is sized by CSS (100% of its container) and letting the renderer set pixel values there makes
    // the element stop tracking its container, which shows up as a canvas that grows on every
    // resize and never shrinks.
    this.gl.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  /** The two numbers the loop itself owns. Everything else in `stats` is written by a phase. */
  private recordTick(timing: FrameTiming, cpuMs: number): void {
    this.stats.frameMs = timing.delta * 1000
    this.stats.cpuMs = cpuMs
  }
}
