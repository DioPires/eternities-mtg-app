/**
 * The one question about the self-check that the product is allowed to ask: is it wanted?
 *
 * Split out of `selfCheck.ts` so asking costs nothing. That module is 993 lines of GPU read-back
 * that only `?selfcheck=1` can reach, and while the URL test lived inside it every importer —
 * the star field and `App`, both on the shipped path — pulled the whole thing into the first chunk
 * (review §5.4 B1). `selfCheck.ts` re-exports this so its own callers are unaffected.
 */

/**
 * The self-check camera's far plane (PRD 8.5.7).
 *
 * Load-bearing, like the rest of that camera's numbers: `selfCheck.ts` derives its star-depth band
 * from the pose `[0, 150, 260]` at `fov` 55, and the band was established against this far plane
 * rather than the product's 8000. It lives here, beside the URL test, because `createServices` has
 * to know it before any scene module is imported — and importing `selfCheck.ts` to learn one number
 * would pull all 993 lines into the product's first chunk, which is the defect this file exists to
 * prevent.
 */
export const SELF_CHECK_FAR = 6000

export function selfCheckRequested(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  const value = new URLSearchParams(search).get('selfcheck')
  return value !== null && value !== '0'
}
