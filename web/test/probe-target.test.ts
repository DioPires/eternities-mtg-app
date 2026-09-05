/**
 * Which page `?probe=` asks for.
 *
 * The predicate is small, and it is the whole of a routing decision `App.tsx` makes in one line —
 * so the test that matters is that `?probe=shell` and `?probe=1` are *different* answers, and that
 * every spelling reviewed before Phase 6 still resolves to Phase 3's scene. A gate capturing PRD
 * 9.3 against the shipped composition and a browser check driving the card tier through the harness
 * both read this, and they must not collapse into one another.
 */

import { describe, expect, it } from 'vitest'

import { probeRequested, probeTarget } from '../src/scene/probe'

describe('probeTarget', () => {
  it('does not ask for the seam at all without the flag', () => {
    expect(probeTarget('')).toBeNull()
    expect(probeTarget('?harness=3')).toBeNull()
    expect(probeRequested('?harness=3')).toBe(false)
  })

  it('reads `probe=0` as off, so the flag can be turned off in a URL rather than deleted', () => {
    expect(probeTarget('?probe=0')).toBeNull()
    expect(probeRequested('?probe=0')).toBe(false)
  })

  it('sends every spelling reviewed before Phase 6 to the scene', () => {
    // `verify-browser.mjs` drives `?probe=1`; the gate before this change drove it too. Anything
    // that is not `0` and not the new word must keep landing on Phase 3's harness — including the
    // empty value, which `?probe` alone produces and which has always counted as on.
    for (const search of ['?probe=1', '?probe=2', '?probe=true', '?probe=scene', '?probe=']) {
      expect(probeTarget(search)).toBe('scene')
      expect(probeRequested(search)).toBe(true)
    }
  })

  it('sends `probe=shell` to the shell', () => {
    expect(probeTarget('?probe=shell')).toBe('shell')
    // Still "requested": `SceneView` installs the seam on the strength of this, wherever it is
    // mounted. Only the routing differs.
    expect(probeRequested('?probe=shell')).toBe(true)
  })

  it('is not confused by other parameters', () => {
    expect(probeTarget('?dataset=production&probe=shell&quality=0')).toBe('shell')
    expect(probeTarget('?probe=1&harness=2a')).toBe('scene')
  })
})
