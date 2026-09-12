/**
 * The navigation contract's state machine, with the camera left abstract.
 *
 * Phase 0 shipped this logic inside `stub.ts`. Phase 2b needs the same logic driving a real camera
 * rig, and "the same" has to mean *the same code*, not a careful re-reading: every rule in
 * docs/navigation-contract.md §2 and §3a is a rule about focus, flight lifecycle and events, none
 * of which has anything to do with whether a camera actually moves. Re-implementing them beside the
 * rig would have produced two state machines that agree today and drift on the first bug fix.
 *
 * So the machine lives here and takes a `NavigationTransport`: "start moving to this focus, tell me
 * when you arrive". The stub's transport is a `setTimeout`; the scene's is the camera rig. Both
 * pass `web/test/navigation.test.ts` — one suite, two transports, which is what makes the Phase 4
 * swap a swap rather than a rewrite.
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

import { BLIND_ETERNITIES_SLUG } from '../data/types'

/** PRD 5.7.3 default; PRD 5.9 drops it to 300 ms under reduced motion. */
export const DEFAULT_DURATION_MS = 1200
export const REDUCED_MOTION_DURATION_MS = 300
/** PRD 6.2.3's cap on the combined two-stage fly-to. */
export const TWO_STAGE_CAP_MS = 3500
/** PRD 6.8.2. */
export const INTRO_DURATION_MS = 4000

/** What the machine hands a transport when a flight starts. */
export interface TransportRequest {
  readonly id: number
  readonly reason: NavigationReason
  /** The focus the camera is leaving. The scene needs it to decide one stage or two (PRD 6.2.3). */
  readonly from: Focus
  /**
   * A live view of the destination. `resolveCard` refines the focus in place without superseding
   * (contract invariant 5), so a transport that cached the value would fly at a stale target.
   */
  readonly target: () => Focus
  readonly durationMs: number
  /** PRD `FlyOptions.immediate`: arrive now, no tween. Deep links that must not animate. */
  readonly immediate: boolean
  /**
   * True when the *caller* named `durationMs`. The stub's `instant` option collapses its own
   * timings but must still honour an explicit duration, or hand-over and supersede stop being
   * exercisable in tests — and only the machine knows which of the two produced `durationMs`.
   */
  readonly explicitDuration: boolean
  /** Called exactly once, unless `stop` got there first. */
  readonly settle: (status: 'completed' | 'cancelled') => void
}

/**
 * Everything the machine needs a camera to do. Deliberately small: the machine owns focus, history
 * semantics and events; the transport owns pixels.
 */
export interface NavigationTransport {
  begin: (request: TransportRequest) => void
  /**
   * Stop the flight in progress. `handover` is PRD 5.7.3's "hands over control at the current
   * camera state without a jump"; `false` is a supersede or a dispose, where a new flight (or
   * nothing) takes the camera immediately.
   */
  stop: (handover: boolean, cause: HandoverCause) => void
  /** Contract invariant 5: refine the destination in place, without restarting (PRD 6.7.1). */
  retarget: (target: Focus) => void
  /**
   * Land on `focus` with the camera exactly where it is — `failCardResolution`'s "the camera stops
   * where it is; no new tween".
   */
  settleAt: (focus: Focus) => void
  cameraState: () => CameraState
  /** PRD 5.7.3: the scene picks the duration, not the caller. */
  baseDurationMs: (target: Focus, from: Focus) => number
  setReducedMotion: (enabled: boolean) => void
  /** PRD 5.3.22–23. Neither may touch focus or the route. */
  enterAttract: () => void
  /**
   * `focus` is the one attract mode never changed, and it is passed because the transport has to
   * put the camera back on it: PRD 5.7.1 tethers the camera to the focus, and an attract tour
   * leaves it tethered to whichever plane the tour was flying to. Read, never written.
   */
  exitAttract: (cause: HandoverCause, focus: Focus) => void
  dispose: () => void
}

export interface MachineOptions {
  readonly initialFocus?: Focus
  readonly reducedMotion?: boolean
}

interface PendingFlight {
  readonly id: number
  /** Mutable: `resolveCard` refines the target in place rather than superseding the flight. */
  target: Focus
  resolve: (result: FlightResult) => void
  /** Set the moment the machine settles it, so a late transport callback is ignored. */
  settled: boolean
  /**
   * Set just *before* the machine asks the transport to stop, when the machine already knows the
   * status it wants. `stop` makes a real rig cancel its flight, and the rig reports that back
   * through `settle` — which would otherwise land as `'cancelled'` a moment before the machine
   * settles the same flight `'failed'`. The stub has no such callback, which is exactly why this
   * had to be found by running the suite against the rig.
   */
  stale: boolean
  detachAbort: (() => void) | null
}

export function createNavigationMachine(
  transport: NavigationTransport,
  options: MachineOptions = {},
): NavigationApi {
  let focus: Focus = options.initialFocus ?? { kind: 'multiverse' }
  let reducedMotion = options.reducedMotion ?? false
  let attract = false
  let introPlayed = false
  let nextFlightId = 1
  let pending: PendingFlight | null = null
  let disposed = false

  if (reducedMotion) transport.setReducedMotion(true)

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
    if (flight.settled) return
    flight.settled = true
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

  /**
   * PRD 5.7.3 and 5.9. `baseMs` is the caller-independent default for this *kind* of flight — the
   * intro's 4 s (PRD 6.8.2) — and is only reached when neither `immediate`, an explicit duration,
   * nor reduced motion has already decided.
   */
  const durationFor = (
    opts: FlyOptions | undefined,
    target: Focus,
    from: Focus,
    baseMs: number | undefined,
  ): number => {
    if (opts?.immediate) return 0
    if (opts?.durationMs !== undefined) return opts.durationMs
    if (reducedMotion) return REDUCED_MOTION_DURATION_MS
    return baseMs ?? transport.baseDurationMs(target, from)
  }

  const start = (target: Focus, opts: FlyOptions | undefined, baseMs?: number): Flight => {
    if (disposed) throw new Error('navigation is disposed')

    const reason: NavigationReason = opts?.reason ?? 'programmatic'
    const id = nextFlightId++
    let resolve!: (result: FlightResult) => void
    const done = new Promise<FlightResult>((r) => {
      resolve = r
    })
    const flight: PendingFlight = {
      id,
      target,
      resolve,
      settled: false,
      stale: false,
      detachAbort: null,
    }
    const from = focus

    // Focus updates at the *start* of the flight so the URL is never a frame behind (PRD 6.7.1).
    // It is assigned *before* the superseded flight settles, so `settle`'s `notify()` never
    // publishes the phantom snapshot of "old focus, no flight" — a state the real rig never has.
    const superseded = pending
    focus = target
    pending = flight
    // A new fly-to supersedes the one in flight, and the old promise resolves 'superseded'. The
    // transport is *not* stopped here: `begin` below replaces the flight in one step, and stopping
    // first would hand the camera back to the orbit for an instant.
    if (superseded) settle(superseded, 'superseded', target)

    emit('focuschange', { focus, reason })
    emit('flightstart', { id, target, reason })
    notify()

    const durationMs = durationFor(opts, target, from, baseMs)
    const immediate = opts?.immediate === true || durationMs <= 0

    const signal = opts?.signal
    if (signal && !immediate) {
      const onAbort = (): void => {
        if (pending?.id === id) {
          flight.stale = true
          transport.stop(false, 'programmatic')
          settle(flight, 'cancelled', flight.target)
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      flight.detachAbort = () => {
        signal.removeEventListener('abort', onAbort)
      }
    }

    transport.begin({
      id,
      reason,
      from,
      target: () => flight.target,
      durationMs,
      immediate,
      explicitDuration: opts?.durationMs !== undefined,
      settle: (status) => {
        // A transport callback for a flight the machine has already settled, or is in the middle of
        // settling itself, is stale: it is the old flight's cancellation arriving after the fact.
        if (flight.settled || flight.stale) return
        settle(flight, status, flight.target)
      },
    })

    return {
      id,
      // A getter, not a snapshot: `resolveCard` refines the target in place (PRD 6.7.1).
      get target() {
        return flight.target
      },
      done,
      cancel: (cause: HandoverCause = 'programmatic') => {
        if (pending?.id !== id) return
        flight.stale = true
        transport.stop(true, cause)
        emit('handover', { id, cause, camera: transport.cameraState() })
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

  // Every member is a free-standing `const` that closes over this factory's state, and the returned
  // object only references them. Nothing uses `this`: React callers destructure, and a
  // `this`-dependent method throws a `TypeError` the moment it leaves the object.

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
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  const flyToMultiverse = (opts?: FlyOptions): Flight => start({ kind: 'multiverse' }, opts)

  const flyToBlindEternities = (anchor?: Vec3, opts?: FlyOptions): Flight => {
    const target: Focus = { kind: 'plane', slug: BLIND_ETERNITIES_SLUG, ...(anchor && { anchor }) }
    // PRD 5.3.4: re-anchoring while already focused is an anchor change, not a navigation.
    //
    // "Already focused" means *settled* there. `focus` is assigned at flight start (invariant 2),
    // so a flight still in the air to the Blind Eternities also reads as focused — and taking the
    // anchor path then would emit `anchorchange`, hand back a fake completed flight, and leave the
    // real flight heading at the un-anchored target. A re-anchor mid-flight is therefore a
    // re-target, which is what `start`'s supersede already is.
    const settledHere =
      pending === null && focus.kind === 'plane' && focus.slug === BLIND_ETERNITIES_SLUG
    if (settledHere && anchor) {
      focus = target
      // The camera re-tethers to the new anchor. No route change, no history entry — but the dust
      // under the camera did move, so the transport hears about it.
      transport.settleAt(target)
      emit('anchorchange', { anchor })
      notify()
      return resolvedFlight(target)
    }
    return start(target, opts)
  }

  const flyToPlane = (slug: PlaneSlug, opts?: FlyOptions): Flight => {
    if (slug === BLIND_ETERNITIES_SLUG) return flyToBlindEternities(undefined, opts)
    return start({ kind: 'plane', slug }, opts)
  }

  const flyToCard: NavigationApi['flyToCard'] = (target, opts) => {
    const next: Focus = {
      kind: 'card',
      planeSlug: target.planeSlug,
      oracleId: target.oracleId,
      ...(target.starIndex !== undefined && { starIndex: target.starIndex }),
      ...(target.anchor && { anchor: target.anchor }),
    }
    return start(next, opts)
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
    transport.retarget(next)
    emit('focuschange', { focus, reason: 'correction' })
    notify()
  }

  const failCardResolution = (oracleId: string, fallback?: Focus): void => {
    if (focus.kind !== 'card' || focus.oracleId !== oracleId) return

    // The URL's plane slug is real even when its oracle id is not, so it is the honest fallback.
    // A Blind Eternities card keeps its anchor: `anchor: undefined` there *means* the multiverse
    // centre, and dropping it would claim a multiverse-wide move the camera never made.
    const next: Focus =
      fallback ??
      ({
        kind: 'plane',
        slug: focus.planeSlug,
        ...(focus.anchor && { anchor: focus.anchor }),
      } satisfies Focus)
    focus = next
    // `focuschange` before `flightend`, matching `start()`: the URL is the source of truth
    // (PRD 6.7.1), so the router must have corrected it before anyone reacts to the failure.
    emit('focuschange', { focus, reason: 'correction' })
    // The camera stops where it is — it is already framing the plane after stage one of PRD 6.2.3.
    if (pending) {
      const flight = pending
      flight.stale = true
      transport.stop(false, 'programmatic')
      transport.settleAt(next)
      settle(flight, 'failed', next)
    } else {
      transport.settleAt(next)
    }
    notify()
  }

  const playIntro = (target: Focus, opts?: FlyOptions): Flight => {
    if (introPlayed) return resolvedFlight(focus)
    introPlayed = true
    return start(target, { reason: 'intro', ...opts }, INTRO_DURATION_MS)
  }

  const enterAttract = (): void => {
    // PRD 5.9: attract mode is disabled under reduced motion. The UI's idle timer does not know
    // that, so the refusal belongs here rather than at every call site.
    if (attract || reducedMotion || disposed) return
    attract = true
    transport.enterAttract()
    emit('attractenter', {})
    notify()
  }

  const exitAttract = (cause: HandoverCause): void => {
    if (!attract) return
    attract = false
    // PRD 5.3.23: "returns control without a jump" — the transport hands the camera back at its
    // current position and velocity, exactly as it does for a fly-to, and re-tethers it to the
    // focus the tour left alone.
    transport.exitAttract(cause, focus)
    emit('attractexit', { cause })
    notify()
  }

  const setReducedMotion = (enabled: boolean): void => {
    if (reducedMotion === enabled) return
    reducedMotion = enabled
    transport.setReducedMotion(enabled)
    // PRD 5.9 disables attract mode; turning the setting on while it runs must therefore end it.
    if (enabled && attract) exitAttract('programmatic')
    notify()
  }

  const handOver = (cause: HandoverCause): void => {
    // PRD 5.3.23: any input cancels attract mode immediately, without a jump.
    if (attract) exitAttract(cause)
    if (!pending) return
    const flight = pending
    flight.stale = true
    transport.stop(true, cause)
    emit('handover', { id: flight.id, cause, camera: transport.cameraState() })
    settle(flight, 'cancelled', focus)
  }

  const dispose = (): void => {
    if (pending) {
      const flight = pending
      flight.stale = true
      transport.stop(false, 'programmatic')
      settle(flight, 'cancelled', focus)
    }
    subscribers.clear()
    listeners.clear()
    disposed = true
    transport.dispose()
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
