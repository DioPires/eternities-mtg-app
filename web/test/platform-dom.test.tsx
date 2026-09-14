/**
 * The DOM half of the platform layer: the re-armed `matchMedia` and the backing-store observer
 * (DEC-739, review §3.5).
 *
 * **`.test.tsx` for code with no JSX in it, deliberately.** `vitest.config.ts` routes `.test.ts` to
 * `node` and `.test.tsx` to `jsdom`, and the split is by *need for a DOM* rather than by need for
 * React — its own header says `node` "must keep running in `node`". This module needs `window`,
 * `matchMedia` and `ResizeObserver`, so this is where it goes.
 *
 * **What is worth testing here is the re-arm, and only the re-arm.** A `(resolution: Xdppx)` query
 * matches exactly one ratio, so the instant it reports a change it has stopped being the right
 * query — the ratio it names is the one just left, and it will never fire again. A listener that is
 * not rebuilt against the new ratio therefore catches the *first* monitor move of a session and no
 * others, which is worse than catching none because it looks like it works. No amount of testing
 * "does it fire once" would see that, so the test below moves the window twice.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { observeBackingStore, observeDevicePixelRatio } from '../src/scene/platform/backingStore'

/** A `matchMedia` that records every query it is handed and can fire each one on demand. */
function installMatchMedia(): {
  queries: Array<{ query: string; listeners: Set<() => void> }>
  fireLatest: () => void
  restore: () => void
} {
  // Bound rather than captured bare: `matchMedia` is a method on `window`, and restoring a
  // detached reference would hand jsdom a call with the wrong `this`.
  const original = window.matchMedia.bind(window)
  const queries: Array<{ query: string; listeners: Set<() => void> }> = []

  // Through `unknown`: the stub answers only the four members `observeDevicePixelRatio` touches,
  // and widening it to a full `MediaQueryList` would be pretending to implement an interface this
  // test has no use for.
  window.matchMedia = ((query: string) => {
    const entry = { query, listeners: new Set<() => void>() }
    queries.push(entry)
    return {
      media: query,
      matches: true,
      addEventListener: (_: string, listener: () => void) => {
        entry.listeners.add(listener)
      },
      removeEventListener: (_: string, listener: () => void) => {
        entry.listeners.delete(listener)
      },
      addListener: (listener: () => void) => {
        entry.listeners.add(listener)
      },
      removeListener: (listener: () => void) => {
        entry.listeners.delete(listener)
      },
      dispatchEvent: () => true,
      onchange: null,
    }
  }) as unknown as typeof window.matchMedia

  return {
    queries,
    fireLatest: () => {
      const entry = queries[queries.length - 1]
      // A copy, because the handler re-arms — which mutates the list this is iterating.
      for (const listener of [...(entry?.listeners ?? [])]) listener()
    },
    restore: () => {
      window.matchMedia = original
    },
  }
}

function setDevicePixelRatio(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
}

afterEach(() => {
  setDevicePixelRatio(1)
})

describe('observeDevicePixelRatio (review §3.5: catch window moves between monitors)', () => {
  it('re-arms against the new ratio, so the second monitor move is caught too', () => {
    const media = installMatchMedia()
    const seen: number[] = []
    setDevicePixelRatio(2)

    const stop = observeDevicePixelRatio((ratio) => seen.push(ratio))
    try {
      // Armed against the ratio it starts on.
      expect(media.queries).toHaveLength(1)
      expect(media.queries[0]!.query).toBe('(resolution: 2dppx)')

      // Drag to a 1x external monitor. Nothing fires a `resize` — the CSS box is unchanged — and
      // the only notification is this query going false.
      setDevicePixelRatio(1)
      media.fireLatest()
      expect(seen).toEqual([1])
      // The listener has been rebuilt against the ratio we are *now* on. This is the assertion the
      // whole file exists for.
      expect(media.queries).toHaveLength(2)
      expect(media.queries[1]!.query).toBe('(resolution: 1dppx)')
      // ...and the old query no longer holds a listener, or every move would notify N times.
      expect(media.queries[0]!.listeners.size).toBe(0)

      // Drag back. A listener that was not re-armed is silent from here on, and the app keeps
      // drawing at the wrong ratio indefinitely.
      setDevicePixelRatio(2)
      media.fireLatest()
      expect(seen).toEqual([1, 2])
      expect(media.queries).toHaveLength(3)
    } finally {
      stop()
      media.restore()
    }
  })

  it('re-arms before it notifies, so a throwing consumer cannot silence it', () => {
    // The handler re-arms first and calls back second. If it did the two the other way round, a
    // consumer that threw — and the consumer here re-enters the renderer — would leave the listener
    // pointing at the ratio just left, and the failure would be permanent and silent.
    const media = installMatchMedia()
    setDevicePixelRatio(2)
    const consumer = vi.fn(() => {
      throw new Error('the renderer threw')
    })
    const stop = observeDevicePixelRatio(consumer)
    try {
      setDevicePixelRatio(1)
      expect(() => media.fireLatest()).toThrow('the renderer threw')
      expect(consumer).toHaveBeenCalledTimes(1)
      // Re-armed despite the throw.
      expect(media.queries).toHaveLength(2)
      expect(media.queries[1]!.query).toBe('(resolution: 1dppx)')
    } finally {
      stop()
      media.restore()
    }
  })

  it('stops listening when disposed', () => {
    const media = installMatchMedia()
    setDevicePixelRatio(2)
    const seen: number[] = []
    const stop = observeDevicePixelRatio((ratio) => seen.push(ratio))
    stop()
    setDevicePixelRatio(1)
    media.fireLatest()
    expect(seen).toEqual([])
    media.restore()
  })
})

describe('observeBackingStore (review §3.5: device-pixel-content-box)', () => {
  /** A `ResizeObserver` stub that records the box it was asked for and can deliver one entry. */
  function installResizeObserver(supportsDevicePixelBox: boolean): {
    boxes: string[]
    deliver: (entry: ResizeObserverEntry) => void
    restore: () => void
  } {
    const original = globalThis.ResizeObserver
    const boxes: string[] = []
    let callback: ResizeObserverCallback | null = null

    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callback = cb
      }
      observe(_: Element, options?: ResizeObserverOptions): void {
        const box = options?.box ?? 'content-box'
        if (box === 'device-pixel-content-box' && !supportsDevicePixelBox) {
          // What a browser that does not know the value actually does: it throws, rather than
          // ignoring the option. That is why the feature test in `observeBackingStore` is a
          // try/catch and not a capability check.
          throw new TypeError('unsupported box option')
        }
        boxes.push(box)
      }
      unobserve(): void {}
      disconnect(): void {}
    }

    return {
      boxes,
      deliver: (entry) => callback?.([entry], {} as ResizeObserver),
      restore: () => {
        globalThis.ResizeObserver = original
      },
    }
  }

  function entry(css: [number, number], device: [number, number] | null): ResizeObserverEntry {
    return {
      contentRect: { width: css[0], height: css[1] } as DOMRectReadOnly,
      contentBoxSize: [{ inlineSize: css[0], blockSize: css[1] }],
      devicePixelContentBoxSize: device ? [{ inlineSize: device[0], blockSize: device[1] }] : [],
      borderBoxSize: [],
      target: document.createElement('div'),
    }
  }

  it('reports the exact device-pixel box, and the ratio the compositor actually chose', () => {
    const observer = installResizeObserver(true)
    const seen: Array<{ ratio: number; exact: boolean; devicePixelWidth: number }> = []
    setDevicePixelRatio(1.25)
    const stop = observeBackingStore(document.createElement('canvas'), (size) => seen.push(size))
    try {
      expect(observer.boxes).toEqual(['device-pixel-content-box'])
      // 1000 CSS px at an OS scale of 125%: the compositor allocates a whole number of device
      // pixels, and 1251 is not `floor(1000 * 1.25)`. Trusting `devicePixelRatio` here draws the
      // scene at one size and blits it to another — a resample of the whole frame for nothing.
      observer.deliver(entry([1000, 600], [1251, 750]))
      expect(seen).toHaveLength(1)
      expect(seen[0]!.devicePixelWidth).toBe(1251)
      expect(seen[0]!.exact).toBe(true)
      expect(seen[0]!.ratio).toBeCloseTo(1.251, 6)
    } finally {
      stop()
      observer.restore()
    }
  })

  it('falls back to the CSS box and says so, rather than claiming to be exact', () => {
    // The fallback is honest about being one. A silently-approximate answer would make the whole
    // point of this module unverifiable — `?probe=1` reports `exact` for that reason.
    const observer = installResizeObserver(false)
    const seen: Array<{ ratio: number; exact: boolean; devicePixelWidth: number }> = []
    setDevicePixelRatio(2)
    const stop = observeBackingStore(document.createElement('canvas'), (size) => seen.push(size))
    try {
      expect(observer.boxes).toEqual(['content-box'])
      observer.deliver(entry([800, 600], null))
      expect(seen[0]!.exact).toBe(false)
      expect(seen[0]!.devicePixelWidth).toBe(1600)
      expect(seen[0]!.ratio).toBe(2)
    } finally {
      stop()
      observer.restore()
    }
  })
})
