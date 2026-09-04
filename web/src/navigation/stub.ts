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
  type CardResolution,
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
  /** Mutable: `resolveCard` refines the target in place rather than superseding the flight. */
  target: Focus
  resolve: (result: FlightResult) => void
  timer: ReturnType<typeof setTimeout> | null
  /** Detached on settle, so a long-lived shared `AbortSignal` does not accumulate listeners. */
  detachAbort: (() => void) | null
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
    if (flight.detachAbort !== null) {
      flight.detachAbort()
      flight.detachAbort = null
    }
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

    const reason: NavigationReason = opts?.reason ?? 'programmatic'
    const id = nextFlightId++
    let resolve!: (result: FlightResult) => void
    const done = new Promise<FlightResult>((r) => {
      resolve = r
    })
    const flight: PendingFlight = { id, target, resolve, timer: null, detachAbort: null }

    // Focus updates at the *start* of the flight so the URL is never a frame behind (PRD 6.7.1).
    // It is assigned *before* the superseded flight settles, so `settle`'s `notify()` never
    // publishes the phantom snapshot of "old focus, no flight" — a state the real rig never has.
    const superseded = pending
    focus = target
    pending = flight
    // A new fly-to supersedes the one in flight, and the old promise resolves 'superseded'.
    if (superseded) settle(superseded, 'superseded', target)

    emit('focuschange', { focus, reason })
    emit('flightstart', { id, target, reason })
    notify()

    const duration = durationFor(opts, base)
    // `instant` collapses the stub's *own* timings. An explicit `durationMs` is still honoured,
    // so callers can still exercise hand-over and supersede against a flight that is in progress.
    if ((options.instant && opts?.durationMs === undefined) || duration === 0) {
      settle(flight, 'completed', flight.target)
    } else {
      flight.timer = setTimeout(() => settle(flight, 'completed', flight.target), duration)
      const signal = opts?.signal
      if (signal) {
        const onAbort = (): void => {
          if (pending?.id === id) settle(flight, 'cancelled', flight.target)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        flight.detachAbort = () => {
          signal.removeEventListener('abort', onAbort)
        }
      }
    }

    return {
      id,
      // A getter, not a snapshot: `resolveCard` refines the target in place (PRD 6.7.1).
      get target() {
        return flight.target
      },
      done,
      cancel: (cause: HandoverCause = 'programmatic') => {
        if (pending?.id !== id) return
        emit('handover', { id, cause, camera: IDLE_CAMERA })
        settle(flight, 'cancelled', flight.target)
      },
    }
  }

  const resolvedFlight = (target: Focus): Flight => ({
    id: 0,
    target,
    done: Promise.resolve({ id: 0, status: 'completed', focus: target }),
    cancel: () => {},
  })

  // Every method is a free-standing `const` that closes over this factory's state, and the
  // returned object only references them. Nothing uses `this`: React callers destructure — the
  // natural spellings are `const { flyToPlane } = useNavigation()` and `onPointerDown={nav.handOver}`
  // — and a `this`-dependent method throws a `TypeError` the moment it leaves the object.

  const subscribe = (listener: (snapshot: NavigationSnapshot) => void): Unsubscribe => {
    subscribers.add(listener)
    return () => {
      subscribers.delete(listener)
    }
  }

  const on = <K extends NavigationEventName>(
    event: K,
    listener: (payload: NavigationEvents[K]) => void,
  ): Unsubscribe => {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(listener as (payload: never) => void)
    return () => {
      set.delete(listener as (payload: never) => void)
    }
  }

  const flyToMultiverse = (opts?: FlyOptions): Flight =>
    start({ kind: 'multiverse' }, opts, DEFAULT_DURATION_MS)

  const flyToBlindEternities = (anchor?: Vec3, opts?: FlyOptions): Flight => {
    const target: Focus = { kind: 'plane', slug: BLIND_ETERNITIES_SLUG, ...(anchor && { anchor }) }
    // PRD 5.3.4: re-anchoring while already focused is an anchor change, not a navigation.
    //
    // "Already focused" means *settled* there. `focus` is assigned at flight start (invariant 2),
    // so a flight still in the air to the Blind Eternities also reads as focused — and taking the
    // anchor path then would emit `anchorchange`, hand back a fake completed flight, and leave the
    // real flight heading at the un-anchored target. State would diverge: the UI would believe it
    // was flying at the clicked dust while the camera flew to the multiverse centre. A re-anchor
    // mid-flight is therefore a re-target, which is what `start`'s supersede already is.
    const settledHere =
      pending === null && focus.kind === 'plane' && focus.slug === BLIND_ETERNITIES_SLUG
    if (settledHere && anchor) {
      focus = target
      emit('anchorchange', { anchor })
      notify()
      return resolvedFlight(target)
    }
    return start(target, opts, DEFAULT_DURATION_MS)
  }

  const flyToPlane = (slug: PlaneSlug, opts?: FlyOptions): Flight => {
    if (slug === BLIND_ETERNITIES_SLUG) return flyToBlindEternities(undefined, opts)
    return start({ kind: 'plane', slug }, opts, DEFAULT_DURATION_MS)
  }

  const flyToCard: NavigationApi['flyToCard'] = (target, opts) => {
    const next: Focus = {
      kind: 'card',
      planeSlug: target.planeSlug,
      oracleId: target.oracleId,
      ...(target.starIndex !== undefined && { starIndex: target.starIndex }),
      ...(target.anchor && { anchor: target.anchor }),
    }
    // PRD 6.2.3-4: two stages from outside the plane, one from inside it.
    const insidePlane =
      (focus.kind === 'plane' && focus.slug === target.planeSlug) ||
      (focus.kind === 'card' && focus.planeSlug === target.planeSlug)
    const base = insidePlane ? DEFAULT_DURATION_MS : TWO_STAGE_CAP_MS
    return start(next, opts, base)
  }

  const focusParent = (opts?: FlyOptions): Flight | null => {
    if (focus.kind === 'card') {
      // PRD 6.2.3: a Blind Eternities card was framed against the dust around its own position,
      // and that position is the anchor of PRD 5.3.4. Carry it up, or Esc teleports the user to
      // the multiverse centre — `anchor: undefined` on the Blind Eternities *means* the centre.
      if (focus.planeSlug === BLIND_ETERNITIES_SLUG) return flyToBlindEternities(focus.anchor, opts)
      return flyToPlane(focus.planeSlug, opts)
    }
    if (focus.kind === 'plane') return flyToMultiverse(opts)
    return null // PRD 6.1.3: Esc does nothing at multiverse level.
  }

  const resolveCard = (oracleId: string, resolution: CardResolution): void => {
    // The user has moved on since the fetch started: nothing to refine, and nothing to correct.
    if (focus.kind !== 'card' || focus.oracleId !== oracleId) return

    const next: Focus = {
      kind: 'card',
      planeSlug: resolution.planeSlug ?? focus.planeSlug,
      oracleId,
      starIndex: resolution.starIndex,
      ...((resolution.anchor ?? focus.anchor) && { anchor: resolution.anchor ?? focus.anchor }),
    }
    const changed =
      focus.starIndex !== next.starIndex ||
      focus.planeSlug !== next.planeSlug ||
      focus.anchor !== next.anchor
    if (!changed) return

    focus = next
    // Refine the flight in place. No supersede, no `flightend`, no restart: the cold-start deep
    // link is the one path where a camera restart is most visible (PRD 5.7, 7.3.6).
    if (pending) pending.target = next
    emit('focuschange', { focus, reason: 'correction' })
    notify()
  }

  const failCardResolution = (oracleId: string, fallback?: Focus): void => {
    if (focus.kind !== 'card' || focus.oracleId !== oracleId) return

    // The URL's plane slug is real even when its oracle id is not, so it is the honest fallback.
    const next: Focus = fallback ?? { kind: 'plane', slug: focus.planeSlug }
    focus = next
    // `focuschange` before `flightend`, matching `start()`: the URL is the source of truth
    // (PRD 6.7.1), so the router must have corrected it before anyone reacts to the failure.
    emit('focuschange', { focus, reason: 'correction' })
    // The camera stops where it is — it is already framing the plane after stage one of PRD 6.2.3.
    if (pending) settle(pending, 'failed', next)
    notify()
  }

  const playIntro = (target: Focus, opts?: FlyOptions): Flight => {
    if (introPlayed) return resolvedFlight(focus)
    introPlayed = true
    return start(target, { reason: 'intro', ...opts }, INTRO_DURATION_MS)
  }

  const enterAttract = (): void => {
    if (attract) return
    attract = true
    emit('attractenter', {})
    notify()
  }

  const exitAttract = (cause: HandoverCause): void => {
    if (!attract) return
    attract = false
    emit('attractexit', { cause })
    notify()
  }

  const setReducedMotion = (enabled: boolean): void => {
    if (reducedMotion === enabled) return
    reducedMotion = enabled
    notify()
  }

  const handOver = (cause: HandoverCause): void => {
    // PRD 5.3.23: any input cancels attract mode immediately, without a jump.
    if (attract) exitAttract(cause)
    if (!pending) return
    emit('handover', { id: pending.id, cause, camera: IDLE_CAMERA })
    settle(pending, 'cancelled', focus)
  }

  const dispose = (): void => {
    if (pending) settle(pending, 'cancelled', focus)
    subscribers.clear()
    listeners.clear()
    disposed = true
  }

  return {
    snapshot,
    subscribe,
    on,
    flyToMultiverse,
    flyToPlane,
    flyToBlindEternities,
    flyToCard,
    focusParent,
    resolveCard,
    failCardResolution,
    playIntro,
    enterAttract,
    exitAttract,
    setReducedMotion,
    handOver,
    dispose,
  }
}
