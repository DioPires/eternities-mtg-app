/**
 * The app.
 *
 * Phase 0's decode/stub panel has done its job — `web/test/` now proves both fixtures decode and
 * the navigation contract holds against two implementations, which is a better place for it than a
 * list of strings on screen. What replaces it is the Phase 2b harness: the navigation contract
 * driving the real camera rig over fixture-scale's full Appendix A roster.
 *
 * Phase 4 (DEC-589) replaces this file with the router and the app shell.
 */

import type { ReactElement } from 'react'

import { Phase2bScene } from './harness/Phase2bScene'

export function App(): ReactElement {
  return <Phase2bScene />
}
