/**
 * The Eternities navigation contract. Frozen at Phase 0; see docs/navigation-contract.md.
 *
 * Two implementations, one state machine, one behavioural suite over both:
 *   - `createNavigationStub()` moves no camera, and is what Phase 4 builds against;
 *   - `createSceneNavigation()` flies the real rig, and is what ships.
 */

export * from './types'
export { createNavigationStub, type StubOptions } from './stub'
export {
  createSceneNavigation,
  starSourceFromStars,
  type SceneNavigation,
  type SceneNavigationOptions,
  type StarSource,
} from './scene'
export { runNavigationDemo, type DemoLog } from './demo'
