/**
 * PRD risk 6's position-precision mode, and where it comes from.
 *
 * > **Lives in `platform/`, and not in `starfield/starGeometry.ts`, because it outlives the galaxy
 * > (DEC-752).** The mode was written for the star position buffer, but it is a **capability**, not
 * > a piece of galaxy furniture: `ProbeState` publishes it, and `probeSeam`, `benchSeam`,
 * > `capabilities`, `selfCheck` and `BenchRunner` all read it. §3.2's deletion of the star geometry
 * > would have taken it with them. `capabilities.ts` next door already owns `bootPositionMode`,
 * > which is the probe this resolves against, so the two halves of one question now sit together.
 */

import { bootPositionMode } from './capabilities'

/**
 * PRD risk 6's named mitigation. `float16` is the default and halves the position buffer;
 * `float32` is the escape hatch for a GPU or driver that mishandles half-float attributes.
 */
export type PositionMode = 'float16' | 'float32'

/**
 * Where the mode comes from, in precedence order: an explicit `?positions=float32` in the URL,
 * then a stored setting, then **what the GPU answered when it was asked to draw four half-float
 * points** (DEC-739, `../platform/halfFloatProbe`).
 *
 * That last step is the change. The default used to be the literal `'float16'`, with the query
 * parameter as PRD risk 6's entire mitigation — review §3.7's "float16 is a manual switch". A user
 * on a driver that mishandles the format saw a field of stars in the wrong places and had no reason
 * to suspect a URL parameter existed. Now the probe decides and the parameter is what it should
 * always have been: an override, for PRD 7.1.2's cross-browser pass (which needs to exercise the
 * float32 path on hardware where the probe passes) and for a user the probe got wrong.
 *
 * `probe` is injected rather than imported so this stays a pure function of its inputs — the unit
 * suite drives both answers without a GL context, which is the only way the fallback path is
 * testable at all.
 */
export const POSITION_MODE_STORAGE_KEY = 'eternities:positions'

export function resolvePositionMode(
  search: string | undefined = typeof location === 'undefined' ? undefined : location.search,
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
  probe: () => PositionMode = bootPositionMode,
): PositionMode {
  const requested = search === undefined ? null : new URLSearchParams(search).get('positions')
  if (requested === 'float32' || requested === 'float16') return requested
  const stored = (() => {
    try {
      return storage?.getItem(POSITION_MODE_STORAGE_KEY) ?? null
    } catch {
      // Safari in private mode throws on localStorage access; a setting is not worth a crash.
      return null
    }
  })()
  if (stored === 'float32' || stored === 'float16') return stored
  return probe()
}
