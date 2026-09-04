/**
 * The navigation stub.
 *
 * It moves no camera — that is `scene.ts`'s job — but it is a *faithful state machine*: focus,
 * flight lifecycle, supersede semantics, attract mode, reduced motion and every event fire exactly
 * as the contract says they will. Phase 4 can therefore build the whole app shell against it and
 * swap in the real implementation without touching a call site.
 *
 * Since Phase 2b that faithfulness is structural rather than merely careful: the state machine
 * lives in `machine.ts` and this file is only its *transport* — the part that would move a camera,
 * replaced by a `setTimeout`. The real rig is the same machine with a different transport, which is
 * why `web/test/navigation.test.ts` runs one suite over both and the swap is a swap.
 *
 * The only thing it fakes is time: `durationMs` is honoured through `setTimeout`, so a caller that
 * awaits `flight.done` behaves the same as it will against the real rig.
 */

import {
  createNavigationMachine,
  DEFAULT_DURATION_MS,
  TWO_STAGE_CAP_MS,
  type NavigationTransport,
} from './machine'
import { type CameraState, type Focus, type NavigationApi } from './types'

export interface StubOptions {
  readonly initialFocus?: Focus
  readonly reducedMotion?: boolean
  /**
   * Collapse the stub's own flight timings so a caller never waits on a timer. A flight given an
   * explicit `durationMs` still takes that long, so hand-over and supersede stay exercisable.
   */
  readonly instant?: boolean
}

const IDLE_CAMERA: CameraState = { position: [0, 0, 0], target: [0, 0, 0], distance: 0 }

export function createNavigationStub(options: StubOptions = {}): NavigationApi {
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const transport: NavigationTransport = {
    begin: (request) => {
      clear()
      // `instant` collapses the stub's *own* timings. An explicit `durationMs` is still honoured,
      // so callers can exercise hand-over and supersede against a flight that is in progress.
      if (request.immediate || (options.instant === true && !request.explicitDuration)) {
        request.settle('completed')
        return
      }
      timer = setTimeout(() => {
        clear()
        request.settle('completed')
      }, request.durationMs)
    },
    stop: () => {
      clear()
    },
    // Nothing to re-aim: the stub's camera is not anywhere. The machine has already refined the
    // focus and the live `Flight.target`, which is all a caller can observe here.
    retarget: () => {},
    settleAt: () => {},
    cameraState: () => IDLE_CAMERA,
    /**
     * PRD 6.2.3–4: two stages from outside the card's plane, one from inside it. The stub cannot
     * fly a path, but it can take the right amount of time not flying one, so a caller that races
     * a fetch against the fly-to races the same clock it will race in the real scene.
     */
    baseDurationMs: (target, from) => {
      if (target.kind !== 'card') return DEFAULT_DURATION_MS
      const insidePlane =
        (from.kind === 'plane' && from.slug === target.planeSlug) ||
        (from.kind === 'card' && from.planeSlug === target.planeSlug)
      return insidePlane ? DEFAULT_DURATION_MS : TWO_STAGE_CAP_MS
    },
    setReducedMotion: () => {},
    enterAttract: () => {},
    exitAttract: () => {},
    dispose: () => {
      clear()
    },
  }

  return createNavigationMachine(transport, {
    ...(options.initialFocus && { initialFocus: options.initialFocus }),
    ...(options.reducedMotion !== undefined && { reducedMotion: options.reducedMotion }),
  })
}
