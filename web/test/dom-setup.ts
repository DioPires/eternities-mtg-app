/**
 * What jsdom does not have that the components assume.
 *
 * Deliberately short. Every stub here is a thing jsdom genuinely does not implement, not a thing
 * the component got wrong — a setup file that papers over the second kind turns a component suite
 * into a suite that tests the setup file.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// PRD 5.9's OS preference. jsdom has no `matchMedia` at all, and `useReducedMotion` calls it on
// mount. Reports "no preference", which is the default a test should start from.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

// jsdom implements no `ResizeObserver` at all, and `cards/focusedCardHost.ts` observes the canvas
// to keep its CSS box without a forced layout on the frame path (DEC-692 R11). The real one fires
// once on `observe()`, and the host relies on that for its initial size, so this one does too.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
      this.callback([], this)
    }
    unobserve(): void {}
    disconnect(): void {}
  }
}

// The label frame loop drives itself off rAF. jsdom's is a 16 ms timer, which makes "how many
// times did this run" untestable; the tests drive `requestAnimationFrame` by hand instead.
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0))
  window.cancelAnimationFrame = ((handle: number) =>
    window.clearTimeout(handle))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})
