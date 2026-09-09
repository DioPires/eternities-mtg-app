/**
 * The one question about the self-check that the product is allowed to ask: is it wanted?
 *
 * Split out of `selfCheck.ts` so asking costs nothing. That module is 993 lines of GPU read-back
 * that only `?selfcheck=1` can reach, and while the URL test lived inside it every importer —
 * `StarScene` and `App`, both on the shipped path — pulled the whole thing into the first chunk
 * (review §5.4 B1). `selfCheck.ts` re-exports this so its own callers are unaffected.
 */

export function selfCheckRequested(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  const value = new URLSearchParams(search).get('selfcheck')
  return value !== null && value !== '0'
}
