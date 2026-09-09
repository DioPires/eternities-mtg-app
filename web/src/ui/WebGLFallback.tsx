/**
 * PRD 7.1.2: "Without WebGL2 the page shows a plain explanation, not a broken canvas."
 *
 * A plain explanation means plain: what the page needs, why, and what to do about it, in a
 * paragraph a non-technical reader can act on. No stack trace, no diagnostic dump, and — the part
 * that matters — no `<canvas>` mounted anywhere, so there is nothing left to render black.
 *
 * The detection is a one-off probe rather than a React error boundary because it has to run before
 * the R3F canvas mounts; a boundary would catch the failure after the browser had already shown
 * the broken rectangle the requirement is about.
 */

import type { ReactElement } from 'react'

/**
 * Cached, because the answer cannot change within a page and the probe is not free: it costs a real
 * GL context, and browsers cap how many a document may hold at once (Chrome evicts the oldest at
 * 16). The scene's own context is the one that matters, so the probe must not be able to compete
 * with it.
 */
let webgl2: boolean | null = null

export function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    // Released explicitly rather than left to the collector. A throwaway context that is still
    // alive is a context the browser has to reclaim on its own terms, and Firefox says so out loud:
    // it logs "WebGL context was lost" at start-up when this one is finally collected — a warning
    // that reads, to anyone debugging, as the *scene's* context dying (review §5.3 P8). Losing it
    // deliberately answers the question and takes the warning with it.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    webgl2 = gl !== null
  } catch {
    // Firefox with WebGL disabled throws rather than returning null.
    webgl2 = false
  }
  return webgl2
}

export function WebGLFallback(): ReactElement {
  return (
    <main className="fallback">
      <h1>Eternities needs WebGL2</h1>
      <p>
        This page draws every card in Magic as a star, and it needs a graphics feature called WebGL2
        to do it. This browser did not offer one.
      </p>
      <p className="muted">
        A current version of Chrome, Safari or Firefox will work, as long as hardware acceleration
        is switched on in the browser&rsquo;s settings. Some remote desktops and virtual machines
        cannot provide it at all.
      </p>
    </main>
  )
}
