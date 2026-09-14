/**
 * The owned renderer: sizing, the pixel-ratio rung, and the mount/unmount lifetime (DEC-740).
 *
 * No WebGL here. `SceneRenderer` takes a `createRenderer` seam for exactly this reason — every line
 * in it except the three that touch a GL context is decidable in jsdom, and the three that do are
 * `setPixelRatio`, `setSize` and `dispose`, whose arguments are what these tests are about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebGLRenderer } from 'three'

import { SceneRenderer } from '../src/scene/renderer/sceneRenderer'

interface FakeGl {
  toneMapping: number
  setPixelRatio: ReturnType<typeof vi.fn>
  setSize: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

function fakeRenderer(): FakeGl {
  return {
    toneMapping: -1,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    dispose: vi.fn(),
  }
}

/** A container with a real CSS box, which jsdom does not compute on its own. */
function container(width: number, height: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true })
  document.body.appendChild(element)
  return element
}

/**
 * A `ResizeObserver` stub that hands back the entry the test chooses.
 *
 * `devicePixelContentBoxSize` is settable per entry because the one measurement this file most
 * needs to pin is the case where it *disagrees* with `devicePixelRatio` — see the emulation test.
 */
function installResizeObserver(): {
  restore: () => void
  deliver: (entry: Partial<ResizeObserverEntry>) => void
  observing: () => number
} {
  const original = globalThis.ResizeObserver
  let callback: ResizeObserverCallback | null = null
  let observed = 0
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      callback = cb
    }
    observe(): void {
      observed += 1
    }
    unobserve(): void {}
    disconnect(): void {
      observed -= 1
    }
  }
  return {
    restore: () => {
      globalThis.ResizeObserver = original
    },
    deliver: (entry) => callback?.([entry as ResizeObserverEntry], {} as ResizeObserver),
    observing: () => observed,
  }
}

function setDevicePixelRatio(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
}

describe('SceneRenderer pixel-ratio rung', () => {
  let gl: FakeGl
  let observer: ReturnType<typeof installResizeObserver>

  beforeEach(() => {
    gl = fakeRenderer()
    observer = installResizeObserver()
  })
  afterEach(() => {
    observer.restore()
    setDevicePixelRatio(1)
    document.body.innerHTML = ''
  })

  const build = (cap: number): SceneRenderer =>
    new SceneRenderer({ pixelRatioCap: cap, createRenderer: () => gl as unknown as WebGLRenderer })

  /**
   * The rung binds. `min(1.5, 2) === 1.5`.
   *
   * Paired with the non-binding row below on purpose: "requested <= limit" cannot fail on a machine
   * where the limit is slack, and a single row here would pass against a renderer that ignored the
   * cap entirely and always used `devicePixelRatio`.
   */
  it('caps the ratio at the tier when the tier is the smaller number', () => {
    setDevicePixelRatio(2)
    build(1.5).mount(container(800, 600))
    expect(gl.setPixelRatio).toHaveBeenCalledWith(1.5)
  })

  /** The control: the cap is slack, so the display's own ratio wins and the cap must not. */
  it('uses the device ratio when the tier cap is slack', () => {
    setDevicePixelRatio(1)
    build(2).mount(container(800, 600))
    expect(gl.setPixelRatio).toHaveBeenCalledWith(1)
  })

  /**
   * The CI trap, as a test rather than as a paragraph.
   *
   * Under Chromium's device emulation — Playwright's `deviceScaleFactor`, i.e. every CI run — the
   * canvas reports a `devicePixelContentBoxSize` equal to its **CSS** box while
   * `window.devicePixelRatio` reports 2. A renderer that derived the ratio from the observed box
   * would resolve every tier to 1.0 and make the ladder's first rung unobservable. The first draft
   * of `PixelRatioHost` did exactly that and `e2e/quality.spec.ts` caught it; this catches it
   * without needing a browser.
   */
  it('resolves the ratio from devicePixelRatio, not from the observed device-pixel box', () => {
    setDevicePixelRatio(2)
    build(2).mount(container(800, 600))
    gl.setPixelRatio.mockClear()

    observer.deliver({
      contentRect: { width: 800, height: 600 } as DOMRectReadOnly,
      contentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
      // Emulation's lie: the device-pixel box equals the CSS box.
      devicePixelContentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
    })

    // 2, from `devicePixelRatio` — not 1, which is what the observed box's ratio would give.
    expect(gl.setPixelRatio).toHaveBeenCalledWith(2)
  })

  it('re-resolves when the tier moves, and does nothing when it does not', () => {
    setDevicePixelRatio(3)
    const renderer = build(1)
    renderer.mount(container(800, 600))
    gl.setPixelRatio.mockClear()

    renderer.setPixelRatioCap(1)
    expect(gl.setPixelRatio).not.toHaveBeenCalled()

    renderer.setPixelRatioCap(2)
    expect(gl.setPixelRatio).toHaveBeenCalledWith(2)
  })

  it('publishes the backing-store observation for the probe', () => {
    const renderer = build(1)
    renderer.mount(container(800, 600))
    expect(renderer.backingStoreSize).toBeNull()

    observer.deliver({
      contentRect: { width: 800, height: 600 } as DOMRectReadOnly,
      contentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
      devicePixelContentBoxSize: [{ inlineSize: 1600, blockSize: 1200 }],
    })

    expect(renderer.backingStoreSize).toMatchObject({
      cssWidth: 800,
      devicePixelWidth: 1600,
      ratio: 2,
      exact: true,
    })
  })
})

describe('SceneRenderer sizing', () => {
  let gl: FakeGl
  let observer: ReturnType<typeof installResizeObserver>

  beforeEach(() => {
    gl = fakeRenderer()
    observer = installResizeObserver()
  })
  afterEach(() => {
    observer.restore()
    document.body.innerHTML = ''
  })

  const build = (): SceneRenderer =>
    new SceneRenderer({ createRenderer: () => gl as unknown as WebGLRenderer })

  it('sizes from the container box and never writes style back onto the canvas', () => {
    build().mount(container(1024, 512))
    // The third argument is `updateStyle`. `true` makes three write pixel values into
    // `canvas.style`, which stops the element tracking its container — a canvas that grows on
    // every resize and never shrinks.
    expect(gl.setSize).toHaveBeenCalledWith(1024, 512, false)
  })

  it('sets the camera aspect from the same box', () => {
    const renderer = build()
    renderer.mount(container(1024, 512))
    expect(renderer.camera.aspect).toBe(2)
  })

  it('ignores a zero-sized container rather than sizing the buffer to nothing', () => {
    build().mount(container(0, 0))
    expect(gl.setSize).not.toHaveBeenCalled()
  })

  /**
   * The size and the ratio are applied before the loop is started, not after.
   *
   * Asserted against `loop.start` rather than against a tick, and the difference is the whole
   * point: the first draft of this test cranked `loop.tick()` by hand after `mount()`, which put
   * the sizing first no matter where `start()` was called — so moving `start()` above the sizing
   * left it green. A hand-cranked tick cannot see a scheduling order. With no size applied the
   * renderer's default drawing buffer is 300x150 and the first *scheduled* frame is drawn at it.
   */
  it('applies the size and the ratio before it starts the loop', () => {
    const renderer = build()
    const order: string[] = []
    gl.setSize.mockImplementation(() => order.push('setSize'))
    gl.setPixelRatio.mockImplementation(() => order.push('setPixelRatio'))
    const start = renderer.loop.start.bind(renderer.loop)
    vi.spyOn(renderer.loop, 'start').mockImplementation(() => {
      order.push('start')
      start()
    })

    renderer.mount(container(800, 600))

    expect(order).toEqual(['setPixelRatio', 'setSize', 'start'])
  })
})

describe('SceneRenderer lifetime', () => {
  let gl: FakeGl
  let observer: ReturnType<typeof installResizeObserver>

  beforeEach(() => {
    gl = fakeRenderer()
    observer = installResizeObserver()
  })
  afterEach(() => {
    observer.restore()
    document.body.innerHTML = ''
  })

  const build = (): SceneRenderer =>
    new SceneRenderer({ createRenderer: () => gl as unknown as WebGLRenderer })

  it('puts the canvas in the container and takes it out again', () => {
    const host = container(800, 600)
    const renderer = build()

    renderer.mount(host)
    expect(host.contains(renderer.canvas)).toBe(true)
    expect(renderer.loop.running).toBe(true)

    renderer.unmount()
    expect(host.contains(renderer.canvas)).toBe(false)
    expect(renderer.loop.running).toBe(false)
  })

  it('disconnects its observers on unmount, so a remount does not double them', () => {
    const renderer = build()
    renderer.mount(container(800, 600))
    expect(observer.observing()).toBe(1)

    renderer.unmount()
    expect(observer.observing()).toBe(0)

    renderer.mount(container(800, 600))
    expect(observer.observing()).toBe(1)
  })

  it('disposes the GL renderer exactly once', () => {
    const renderer = build()
    renderer.mount(container(800, 600))
    renderer.dispose()
    expect(gl.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('SceneRenderer frame stats', () => {
  let gl: FakeGl
  let observer: ReturnType<typeof installResizeObserver>

  beforeEach(() => {
    gl = fakeRenderer()
    observer = installResizeObserver()
  })
  afterEach(() => {
    observer.restore()
    document.body.innerHTML = ''
  })

  it('records the frame interval in milliseconds', () => {
    const renderer = new SceneRenderer({
      createRenderer: () => gl as unknown as WebGLRenderer,
    })
    renderer.mount(container(800, 600))

    renderer.loop.tick(1000)
    renderer.loop.tick(1016)

    expect(renderer.stats.frameMs).toBeCloseTo(16, 5)
  })

  it('still records the tick that threw', () => {
    const renderer = new SceneRenderer({
      createRenderer: () => gl as unknown as WebGLRenderer,
    })
    renderer.mount(container(800, 600))
    // Ticked once before the throwing step joins, so the 32 ms below is measured across the frame
    // that broke rather than across the pair.
    renderer.loop.tick(1000)

    renderer.loop.subscribe('draw', () => {
      throw new Error('boom')
    })
    expect(() => renderer.loop.tick(1032)).toThrow('boom')

    // The broken frame is exactly the one worth having a number for.
    expect(renderer.stats.frameMs).toBeCloseTo(32, 5)
  })
})
