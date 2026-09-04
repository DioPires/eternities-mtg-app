/**
 * The app.
 *
 * Since Phase 3 there is one scene — `scene/EternitiesScene` — and it is the product: the star
 * field, the camera rig, the labels, the thumbnails, the focused card and its planets, all in one
 * canvas with one camera and one picker. The two-scene arrangement Phase 2a's and Phase 2b's
 * harnesses left behind is gone, and so are `harness/Phase2bScene`, `harness/pick.ts`,
 * `harness/PlaneProxies` and `scene/HelloScene`, which existed only to stand in for the half each
 * phase did not build.
 *
 * What still routes elsewhere is instrumentation, not a second product. `?bench`, `?hold` and
 * `?selfcheck` mount Phase 2a's harness because each of those *drives the camera itself* — the
 * bench flies the scripted path of `bench/benchPath`, the self-check freezes the field and reads
 * pixels back — which cannot be done in a scene where the rig is also flying it. The committed
 * bench baseline in `web/bench/` was measured there too, so moving it would silently invalidate
 * the comparison. PRD 9.1.2's real `/bench` route is Phase 6's, and that is where the two rejoin.
 *
 * Phase 4 (DEC-589) replaces this file with the router and the app shell.
 */

import type { ReactElement } from 'react'

import { benchHold, benchRequested } from './bench/BenchRunner'
import { Phase2aScene } from './harness/Phase2aScene'
import { EternitiesScene } from './scene/EternitiesScene'
import { selfCheckRequested } from './scene/selfCheck'

function instrumentationRequested(): boolean {
  const search = typeof location === 'undefined' ? '' : location.search
  if (benchRequested(search) || benchHold(search) !== null || selfCheckRequested(search)) return true
  return new URLSearchParams(search).get('harness') === '2a'
}

export function App(): ReactElement {
  return instrumentationRequested() ? <Phase2aScene /> : <EternitiesScene />
}
