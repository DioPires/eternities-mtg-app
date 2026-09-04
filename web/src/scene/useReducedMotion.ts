/**
 * PRD 5.9 and 7.5.1: reduced motion, honouring the OS preference by default.
 *
 * Phase 2a only needs the *shader* half of it — "all rotation, drift, twinkle, and dust turbulence
 * stop" — which is one uniform and one multiplier on the plane table's integration. The fly-to
 * duration, attract mode and card tilt belong to Phases 2b and 3, and the settings toggle that
 * overrides the OS preference is Phase 4's (PRD 6.10.1); `override` is the seam for it.
 */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches
}

/**
 * `?motion=0` forces reduced motion on and `?motion=1` forces it off, whatever the OS says.
 *
 * This exists for the cross-browser and self-check passes, which need the field held still to
 * compare two implementations of a moving thing, and it is the same override Phase 4's settings
 * toggle (PRD 6.10.1) will drive.
 */
export function motionOverride(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean | undefined {
  const value = new URLSearchParams(search).get('motion')
  if (value === '0') return true
  if (value === '1') return false
  return undefined
}

/**
 * `true` when motion should stop. `override` wins when it is not `undefined`, which is how the
 * settings toggle will turn it on for a user whose OS says nothing.
 */
export function useReducedMotion(override = motionOverride()): boolean {
  const [system, setSystem] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia(QUERY)
    const listener = (): void => {
      setSystem(media.matches)
    }
    media.addEventListener('change', listener)
    return () => {
      media.removeEventListener('change', listener)
    }
  }, [])

  return override ?? system
}
