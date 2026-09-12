/**
 * `?motion=` — the reduced-motion override the measurement passes drive.
 *
 * `?motion=0` forces reduced motion on and `?motion=1` forces it off, whatever the OS preference
 * and PRD 6.10.1's settings toggle say. It exists for the cross-browser, quality and self-check
 * passes, which need the field held still to compare two implementations of a moving thing.
 *
 * *Resolving* reduced motion is not here. It happens once, in `app/hooks.ts`'s `useReducedMotion`,
 * over the settings toggle and the OS preference (PRD 5.9, 6.10.1). This module used to export a
 * second hook of that name over `matchMedia` alone, which is the duplication review §6.2 named;
 * what is left is the seam the three instrument routes — `?probe=1`, `/bench` and `?selfcheck` —
 * lay over the one resolution. The shell deliberately does not, so a query string cannot change
 * what a user sees.
 */

export function motionOverride(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean | undefined {
  const value = new URLSearchParams(search).get('motion')
  if (value === '0') return true
  if (value === '1') return false
  return undefined
}
