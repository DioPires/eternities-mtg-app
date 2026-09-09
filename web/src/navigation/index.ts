/**
 * The Eternities navigation contract. Frozen at Phase 0; see docs/navigation-contract.md.
 *
 * Two implementations, one state machine, one behavioural suite over both:
 *   - `createNavigationStub()` moves no camera, and is what Phase 4 builds against;
 *   - `createSceneNavigation()` flies the real rig, and is what ships.
 *
 * And one adapter over the pair: `createNavigationHost()` is a third `NavigationApi` that holds no
 * state of its own and forwards to whichever of the two is current. The shell needs a navigation
 * before `planes.json` has landed and the real one after; the host is how it gets both from one
 * object. See `./host`.
 */

export * from './types'
export { createNavigationStub, type StubOptions } from './stub'
export { createNavigationHost, type NavigationHost } from './host'
export {
  createSceneNavigation,
  starSourceFromStars,
  type SceneNavigation,
  type SceneNavigationOptions,
  type StarSource,
} from './scene'
