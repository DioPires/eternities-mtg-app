/**
 * Who loads the GPU self-check, and from which build.
 *
 * `starScene.ts` used to reach it directly — `void import('./selfCheck')` inside the one branch
 * `?selfcheck=1` can take. That kept 993 lines out of the product's *first chunk* (review §5.4 B1),
 * which was the defect at the time and was genuinely fixed. It did not keep them out of the
 * product's *build*: `starScene` is the shipped field, so the dynamic-import edge was in the
 * product entry's graph and rollup emitted the self-check chunk from it. Review §3.6 phase 3 item 4
 * is about that second thing.
 *
 * So the edge moves to the caller. The harness entry registers a loader at module scope; the
 * product entry registers nothing, and with no edge to follow rollup emits the self-check as an
 * asset of `harness.html` alone.
 *
 * **Why a registry here and a prop for the bench.** The bench runner is mounted by `SceneView`,
 * which already takes a `bench` prop from its caller, so inverting it was one more field on an
 * object that existed. The self-check is started from inside `starScene`'s imperative frame
 * callbacks, six levels below any React prop and with no options object threaded that far. A
 * module-scope registration is the cheap seam there; threading a loader down would have touched
 * every layer in between to carry one function.
 *
 * Unregistered is the normal state, not an error: the product never registers, and `?selfcheck=1`
 * cannot reach the product entry — `app/harnessRoute.ts` redirects it before React starts.
 */

import type { runSelfCheck, samplesPerRowRequested } from './selfCheck'

/** The two exports `starScene` calls. Typed from the module so a rename cannot drift past this. */
export interface SelfCheckModule {
  readonly runSelfCheck: typeof runSelfCheck
  readonly samplesPerRowRequested: typeof samplesPerRowRequested
}

let loader: (() => Promise<SelfCheckModule>) | null = null

/**
 * Called once by the harness entry, before anything builds a scene.
 *
 * Type-only above, value-only here: the `import type` at the top of this file is erased, so this
 * module carries no edge to `selfCheck.ts` either. The only real edge is the one the caller passes
 * in.
 */
export function registerSelfCheck(next: () => Promise<SelfCheckModule>): void {
  loader = next
}

/** The registered loader, or `null` in a build that has none — which is every product build. */
export function selfCheckLoader(): (() => Promise<SelfCheckModule>) | null {
  return loader
}
