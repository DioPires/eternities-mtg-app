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

export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null
  } catch {
    // Firefox with WebGL disabled throws rather than returning null.
    return false
  }
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
