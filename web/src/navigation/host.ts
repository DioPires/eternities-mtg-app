/**
 * The navigation host: one page-lifetime `NavigationApi` that starts as the stub and becomes the
 * scene's.
 *
 * This is the seam Phase 0 promised and Phase 6 finally uses. `app/services.tsx` says the whole
 * shell reaches the scene through `createNavigation()` and that swapping the stub for the real rig
 * is "a one-line change here and nowhere else". That was true of the *type*, but not of the
 * *lifetime*: the shell's services are built once in `main.tsx`, before React, because `StrictMode`
 * remounts components while keeping their state; the real rig cannot exist that early, because
 * `createSceneNavigation()` needs `planes.json`, which is a network round trip away. One object has
 * to span both, and this is it.
 *
 * What it guarantees, and why each one is load-bearing:
 *
 *  - **Listener survival.** `boot()` runs on the shell's first effect and immediately binds the
 *    router to `focuschange` (PRD 6.7.1 makes the URL the source of truth). That is minutes of
 *    wall-clock before the rig exists. The host owns the listener sets and forwards from whichever
 *    delegate is current, so a listener registered against the stub keeps firing against the rig.
 *    Forwarding one level like this is also why `subscribe`/`on` return the *host's* unsubscribe:
 *    a caller must never hold a handle to a delegate that is about to be replaced.
 *  - **State continuity.** Reduced motion is read from settings before the first render (PRD 6.10.2)
 *    and lands on the stub. It is replayed onto the rig at attach, so the swap cannot silently
 *    re-enable full motion on a user who turned it off.
 *  - **No second implementation.** Every method forwards. The host holds no focus, no flight and no
 *    attract flag of its own, so there is nothing here that can disagree with the machine.
 *
 * Per the contract header in `types.ts`, every member is a function-typed property that closes over
 * its own state and never touches `this` — callers destructure these constantly, and the detachment
 * tests in `web/test/navigation.test.ts` run over this implementation too.
 */

import { createNavigationStub, type StubOptions } from './stub'
import {
  type NavigationApi,
  type NavigationEventName,
  type NavigationEvents,
  type NavigationSnapshot,
  type Unsubscribe,
} from './types'

/**
 * Every event in the contract.
 *
 * Keyed by name rather than written as a `NavigationEventName[]`, because that is what makes the
 * claim in this comment true: `Record<NavigationEventName, true>` is exhaustiveness-checked, so
 * adding an event to `NavigationEvents` without forwarding it is a type error **here**, at the
 * list, instead of silence at runtime.
 *
 * A `readonly NavigationEventName[]` — which this was — is not checked that way: removing
 * `'anchorchange'` from it left `pnpm typecheck` clean (DEC-667 N4). The mutant was caught, by six
 * unit tests and a lint error, so the behaviour was covered; but the comment named the type system,
 * and a future author would have trusted it. Now it is the type system.
 */
const EVENT_NAMES_BY_NAME: Record<NavigationEventName, true> = {
  focuschange: true,
  flightstart: true,
  flightend: true,
  handover: true,
  attractenter: true,
  attractexit: true,
  anchorchange: true,
}
const EVENT_NAMES = Object.keys(EVENT_NAMES_BY_NAME) as readonly NavigationEventName[]

export interface NavigationHost extends NavigationApi {
  /**
   * Hand the host the real implementation. The stub is disposed, which settles anything it had in
   * the air, and every listener the shell registered against the stub is re-pointed at `next`.
   *
   * Idempotent for the same delegate, and a no-op after `dispose()` — a scene that unmounts during
   * a `StrictMode` double-invoke must not resurrect a disposed host.
   */
  readonly attach: (next: NavigationApi) => void
  /** The delegate in force. `false` until a scene has attached; the shell shows no rig before that. */
  readonly attached: () => boolean
}

export function createNavigationHost(options: StubOptions = {}): NavigationHost {
  let delegate: NavigationApi = createNavigationStub(options)
  let disposed = false
  let realAttached = false

  const snapshotListeners = new Set<(snapshot: NavigationSnapshot) => void>()
  const eventListeners = new Map<NavigationEventName, Set<(payload: never) => void>>()
  for (const name of EVENT_NAMES) eventListeners.set(name, new Set())

  /** Unsubscribes from the *current* delegate, drained and refilled on every swap. */
  const bridges: Unsubscribe[] = []

  const bridge = (target: NavigationApi): void => {
    bridges.push(
      target.subscribe((snapshot) => {
        for (const listener of [...snapshotListeners]) listener(snapshot)
      }),
    )
    for (const name of EVENT_NAMES) {
      bridges.push(
        target.on(name, (payload) => {
          const set = eventListeners.get(name)
          if (!set) return
          for (const listener of [...set]) (listener as (value: typeof payload) => void)(payload)
        }),
      )
    }
  }

  const unbridge = (): void => {
    for (const off of bridges.splice(0)) off()
  }

  bridge(delegate)

  const attach = (next: NavigationApi): void => {
    if (disposed || next === delegate) return
    const previous = delegate
    const carried = previous.snapshot()

    unbridge()
    delegate = next
    realAttached = true
    bridge(next)
    // The stub may still be counting down a `setTimeout` flight. Disposing it settles that flight
    // and releases its listeners; the host's own listeners live here and are untouched.
    previous.dispose()

    // PRD 5.9 / 6.10.2: the preference was applied to the stub before the first render. Replay it
    // rather than trusting the scene's constructor to have been handed the same value.
    if (carried.reducedMotion !== next.snapshot().reducedMotion) {
      next.setReducedMotion(carried.reducedMotion)
    }

    // Nothing has told the shell that the world changed underneath it. `useSyncExternalStore`
    // compares snapshot identity, so one push is enough and one push is required.
    const now = next.snapshot()
    for (const listener of [...snapshotListeners]) listener(now)
  }

  return {
    attach,
    attached: () => realAttached,

    snapshot: () => delegate.snapshot(),

    subscribe: (listener) => {
      snapshotListeners.add(listener)
      return () => {
        snapshotListeners.delete(listener)
      }
    },

    on: <K extends NavigationEventName>(
      event: K,
      listener: (payload: NavigationEvents[K]) => void,
    ): Unsubscribe => {
      const set = eventListeners.get(event)
      if (!set) return () => {}
      set.add(listener as (payload: never) => void)
      return () => {
        set.delete(listener as (payload: never) => void)
      }
    },

    flyToMultiverse: (opts) => delegate.flyToMultiverse(opts),
    flyToPlane: (slug, opts) => delegate.flyToPlane(slug, opts),
    flyToBlindEternities: (anchor, opts) => delegate.flyToBlindEternities(anchor, opts),
    flyToCard: (target, opts) => delegate.flyToCard(target, opts),
    focusParent: (opts) => delegate.focusParent(opts),
    resolveCard: (oracleId, resolution) => delegate.resolveCard(oracleId, resolution),
    failCardResolution: (oracleId, fallback) => delegate.failCardResolution(oracleId, fallback),
    playIntro: (target, opts) => delegate.playIntro(target, opts),
    enterAttract: () => delegate.enterAttract(),
    exitAttract: (cause) => delegate.exitAttract(cause),
    setReducedMotion: (enabled) => delegate.setReducedMotion(enabled),
    handOver: (cause) => delegate.handOver(cause),

    dispose: () => {
      if (disposed) return
      disposed = true
      unbridge()
      snapshotListeners.clear()
      for (const set of eventListeners.values()) set.clear()
      delegate.dispose()
    },
  }
}
