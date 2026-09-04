/**
 * The app.
 *
 * Phase 0's decode/stub panel has done its job — `web/test/` now proves both fixtures decode and
 * the navigation contract holds against two implementations, which is a better place for it than a
 * list of strings on screen. What replaced it is the Phase 2b harness: the navigation contract
 * driving the real camera rig over fixture-scale's 83 planes.
 *
 * Phase 2a then landed a second harness — the star field, the bench and the GPU self-check — and
 * the two are still two scenes. Each phase's doc anticipates the other replacing it (2a's orbit
 * control by 2b's rig; 2b's Phase 0 backdrop by 2a's field), but neither built that integration,
 * and doing it inside the merge would have shipped a scene no review had seen. So this routes:
 * `?bench`, `?hold` and `?selfcheck` — the three flags `bench.mjs` and `verify-browser.mjs` drive
 * the star field with — get Phase 2a's harness, `?harness=2a` gets it by hand, and everything else
 * gets Phase 2b's. Both phases' exit criteria stay checkable exactly as they were reviewed.
 *
 * Phase 3 owns folding them into one scene, and Phase 4 (DEC-589) replaces this file with the
 * router and the app shell.
 */

import type { ReactElement } from 'react'

import { benchHold, benchRequested } from './bench/BenchRunner'
import { Phase2aScene } from './harness/Phase2aScene'
import { Phase2bScene } from './harness/Phase2bScene'
import { selfCheckRequested } from './scene/selfCheck'

function phase2aRequested(): boolean {
  const search = typeof location === 'undefined' ? '' : location.search
  if (benchRequested(search) || benchHold(search) !== null || selfCheckRequested(search)) return true
  return new URLSearchParams(search).get('harness') === '2a'
}

export function App(): ReactElement {
  return phase2aRequested() ? <Phase2aScene /> : <Phase2bScene />
}
