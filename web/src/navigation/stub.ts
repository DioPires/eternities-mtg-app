/**
 * The Phase 0 navigation stub.
 *
 * It moves no camera — that is Phase 2b's job — but it is a *faithful state machine*: focus,
 * flight lifecycle, supersede semantics, attract mode, reduced motion and every event fire
 * exactly as the contract says they will. Phase 4 can therefore build the whole app shell
 * against it and swap in the real implementation without touching a call site.
 *
 * The only thing it fakes is time: `durationMs` is honoured through `setTimeout`, so a caller
 * that awaits `flight.done` behaves the same as it will against the real rig.
 */

import {
  levelOf,
  type CameraState,
  type Flight,
  type FlightResult,
  type FlightStatus,
  type Focus,
  type FlyOptions,
  type HandoverCause,
  type NavigationApi,
  type NavigationEventName,
  type NavigationEvents,
  type NavigationReason,
  type NavigationSnapshot,
  type PlaneSlug,
  type Unsubscribe,
  type Vec3,
} from './types'

const BLIND_ETERNITIES_SLUG = 'blind-eternities'
/** PRD 5.7.3 default; PRD 5.9 drops it to 300 ms under reduced motion. */
const DEFAULT_DURATION_MS = 1200
const REDUCED_MOTION_DURATION_MS = 300
/** PRD 6.2.3's cap on the combined two-stage fly-to. */
const TWO_STAGE_CAP_MS = 3500
/** PRD 6.8.2. */
const INTRO_DURATION_MS = 4000

export interface StubOptions {
  readonly initialFocus?: Focus
  readonly reducedMotion?: boolean
  /**
   * Collapse the stub's own flight timings so a caller never waits on a timer. A flight given an
   * explicit `durationMs` still takes that long, so hand-over and supersede stay exercisable.
   */
  readonly instant?: boolean
}

interface PendingFlight {
  readonly id: number
  readonly target: Focus
  resolve: (result: FlightResult) => void
  timer: ReturnType<typeof setTimeout> | null
}

const IDLE_CAMERA: CameraState = { position: [0, 0, 0], target: [0, 0, 0], distance: 0 }

export function createNavigationStub(options: StubOptions = {}): NavigationApi {
  let focus: Focus = options.initialFocus ?? { kind: 'multiverse' }
  let reducedMotion = options.reducedMotion ?? false
  let attract = false
  let introPlayed = false
  let nextFlightId = 1
  let pending: PendingFlight | null = null
  let disposed = false

  const subscribers = new Set<(snapshot: NavigationSnapshot) => void>()
  const listeners = new Map<NavigationEventName, Set<(payload: never) => void>>()

  const snapshot = (): NavigationSnapshot => ({
    focus,
    level: levelOf(focus),
    flight: pending ? { id: pending.id, target: pending.target } : null,
    attract,
    reducedMotion,
    introPlayed,
  })

  const notify = (): void => {
    const current = snapshot()
    for (const subscriber of subscribers) subscriber(current)
  }

  function emit<K extends NavigationEventName>(event: K, payload: NavigationEvents[K]): void {
    const set = listeners.get(event)
    if (!set) return
    for (const listener of set) (listener as (p: NavigationEvents[K]) => void)(payload)
  }

  const settle = (flight: PendingFlight, status: FlightStatus, resultFocus: Focus): void => {
    if (flight.timer !== null) clearTimeout(flight.timer)
    if (pending?.id === flight.id) pending = null
    const result: FlightResult = { id: flight.id, status, focus: resultFocus }
    flight.resolve(result)
    emit('flightend', result)
    notify()
  }

  const durationFor = (options: FlyOptions | undefined, base: number): number => {
    if (options?.immediate) return 0
    if (options?.durationMs !== undefined) return options.durationMs
    return reducedMotion ? REDUCED_MOTION_DURATION_MS : base
  }

  const start = (target: Focus, opts: FlyOptions | undefined, base: number): Flight => {
    if (disposed) throw new Error('navigation stub is disposed')

    // A new fly-to supersedes the one in flight, and the old promise resolves 'superseded'.
    if (pending) settle(pending, 'superseded', target)

    const reason: NavigationReason = opts?.reason ?? 'programmatic'
    const id = nextFlightId++
    let resolve!: (result: FlightResult) => void
    const done = new Promise<FlightResult>((r) => {
      resolve = r
    })
    const flight: PendingFlight = { id, target, resolve, timer: null }
    pending = flight

    // Focus updates at the *start* of the flight so the URL is never a frame behind (PRD 6.7.1).
    focus = target
    emit('focuschange', { focus, reason })
    emit('flightstart', { id, target, reason })
    notify()

    const duration = durationFor(opts, base)
    // `instant` collapses the stub's *own* timings. An explicit `durationMs` is still honoured,
    // so callers can still exercise hand-over and supersede against a flight that is in progress.
    if ((options.instant && opts?.durationMs === undefined) || duration === 0) {
      settle(flight, 'completed', target)
    } else {
      flight.timer = setTimeout(() => settle(flight, 'completed', target), duration)
      if (opts?.signal) {
        opts.signal.addEventListener(
          'abort',
          () => {
            if (pending?.id === id) settle(flight, 'cancelled', target)
          },
          { once: true },
        )
      }
    }

    return {
      id,
      target,
      done,
      cancel: (cause: HandoverCause = 'programmatic') => {
        if (pending?.id !== id) return
        emit('handover', { id, cause, camera: IDLE_CAMERA })
        settle(flight, 'cancelled', target)
      },
    }
  }

  const resolvedFlight = (target: Focus): Flight => ({
    id: 0,
    target,
    done: Promise.resolve({ id: 0, status: 'completed', focus: target }),
    cancel: () => {},
  })

  return {
    snapshot,

    subscribe(listener) {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    },

    on<K extends NavigationEventName>(
      event: K,
      listener: (payload: NavigationEvents[K]) => void,
    ): Unsubscribe {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener as (payload: never) => void)
      return () => {
        set.delete(listener as (payload: never) => void)
      }
    },

    flyToMultiverse(opts) {
      return start({ kind: 'multiverse' }, opts, DEFAULT_DURATION_MS)
    },

    flyToPlane(slug: PlaneSlug, opts) {
      if (slug === BLIND_ETERNITIES_SLUG) return this.flyToBlindEternities(undefined, opts)
      return start({ kind: 'plane', slug }, opts, DEFAULT_DURATION_MS)
    },

    flyToBlindEternities(anchor?: Vec3, opts?: FlyOptions) {
      const target: Focus = { kind: 'plane', slug: BLIND_ETERNITIES_SLUG, ...(anchor && { anchor }) }
      // PRD 5.3.4: re-anchoring while already focused is an anchor change, not a navigation.
      if (focus.kind === 'plane' && focus.slug === BLIND_ETERNITIES_SLUG && anchor) {
        focus = target
        emit('anchorchange', { anchor })
        notify()
        return resolvedFlight(target)
      }
      return start(target, opts, DEFAULT_DURATION_MS)
    },

    flyToCard(target, opts) {
      const next: Focus = {
        kind: 'card',
        planeSlug: target.planeSlug,
        oracleId: target.oracleId,
        ...(target.starIndex !== undefined && { starIndex: target.starIndex }),
      }
      // PRD 6.2.3-4: two stages from outside the plane, one from inside it.
      const insidePlane =
        (focus.kind === 'plane' && focus.slug === target.planeSlug) ||
        (focus.kind === 'card' && focus.planeSlug === target.planeSlug)
      const base = insidePlane ? DEFAULT_DURATION_MS : TWO_STAGE_CAP_MS
      return start(next, opts, base)
    },

    focusParent(opts) {
      if (focus.kind === 'card') return this.flyToPlane(focus.planeSlug, opts)
      if (focus.kind === 'plane') return this.flyToMultiverse(opts)
      return null // PRD 6.1.3: Esc does nothing at multiverse level.
    },

    playIntro(target, opts) {
      if (introPlayed) return resolvedFlight(focus)
      introPlayed = true
      return start(target, { reason: 'intro', ...opts }, INTRO_DURATION_MS)
    },

    enterAttract() {
      if (attract) return
      attract = true
      emit('attractenter', {})
      notify()
    },

    exitAttract(cause) {
      if (!attract) return
      attract = false
      emit('attractexit', { cause })
      notify()
    },

    setReducedMotion(enabled) {
      if (reducedMotion === enabled) return
      reducedMotion = enabled
      notify()
    },

    handOver(cause) {
      // PRD 5.3.23: any input cancels attract mode immediately, without a jump.
      if (attract) this.exitAttract(cause)
      if (!pending) return
      emit('handover', { id: pending.id, cause, camera: IDLE_CAMERA })
      settle(pending, 'cancelled', focus)
    },

    dispose() {
      if (pending) settle(pending, 'cancelled', focus)
      subscribers.clear()
      listeners.clear()
      disposed = true
    },
  }
}
