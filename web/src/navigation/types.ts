/**
 * The navigation contract: everything the UI asks of the 3D scene.
 *
 * Frozen at Phase 0. Phase 4 (app shell) builds against the stub in `stub.ts`; Phase 2b
 * (camera, navigation, labels) implements it against the real scene. Any change to this file is
 * a reviewed contract change — see `docs/navigation-contract.md`.
 *
 * Authority: PRD 5.7 (camera and transitions), 6.1 (controls), 6.2 (focus and history),
 * 6.3.1 (breadcrumb), 6.5.4 (search), 6.7 (deep links), 6.8.2 (intro), 6.9 (random),
 * 5.3.4 (Blind Eternities anchor), 5.3.22-23 (attract mode), 5.9 (reduced motion).
 */

export type PlaneSlug = string
export type OracleId = string

export type Vec3 = readonly [number, number, number]

/**
 * PRD 6.2.1's focus kinds. The active printing is deliberately absent: it is view state, changes
 * no route, and belongs in the Zustand store (PRD 8.4.2), not in the camera's contract.
 */
export type Focus =
  | { readonly kind: 'multiverse' }
  | {
      readonly kind: 'plane'
      readonly slug: PlaneSlug
      /**
       * PRD 5.3.4: the Blind Eternities focus carries an anchor point, because the dust spans the
       * whole multiverse. `undefined` on every other plane, and on the Blind Eternities means the
       * multiverse centre (reached from the plane index or search).
       */
      readonly anchor?: Vec3
    }
  | {
      readonly kind: 'card'
      readonly planeSlug: PlaneSlug
      readonly oracleId: OracleId
      /** Known once `sets.bin` has resolved the id; the fly-to can start without it. */
      readonly starIndex?: number
    }

/** The camera-distance band a focus implies. PRD 5.1.3: levels are distances, not views. */
export type Level = 'multiverse' | 'plane' | 'card'

export function levelOf(focus: Focus): Level {
  return focus.kind === 'multiverse' ? 'multiverse' : focus.kind === 'plane' ? 'plane' : 'card'
}

/** Why a navigation happened. Drives history (PRD 6.2.2) and analytics-free telemetry: none. */
export type NavigationReason =
  | 'user'
  | 'breadcrumb'
  | 'search'
  | 'random'
  | 'deep-link'
  | 'history'
  | 'intro'
  | 'attract'
  | 'programmatic'

export interface FlyOptions {
  readonly reason?: NavigationReason
  /**
   * Override the PRD 5.7.3 easing duration. Omit to let the scene pick: 1.2 s for a one-level
   * hop, scaled with distance to a 3 s cap, or 0.3 s under reduced motion (PRD 5.9).
   */
  readonly durationMs?: number
  /** Skip the tween and arrive immediately. Used by deep links that must not animate. */
  readonly immediate?: boolean
  readonly signal?: AbortSignal
}

export type FlightStatus =
  /** Reached the target. */
  | 'completed'
  /** Input handed control back mid-flight (PRD 5.7.3). */
  | 'cancelled'
  /** A newer flight took over. */
  | 'superseded'

export interface FlightResult {
  readonly id: number
  readonly status: FlightStatus
  /** Where the camera ended up. On a cancel this is the focus the user is now tethered to. */
  readonly focus: Focus
}

/** What a caller gets back from a fly-to. Awaiting it is optional. */
export interface Flight {
  readonly id: number
  readonly target: Focus
  readonly done: Promise<FlightResult>
  /** Cancel without an input event, e.g. because the route changed underneath. */
  cancel(reason?: HandoverCause): void
}

/** PRD 5.7.3 / 6.1: what took the camera back from a tween. */
export type HandoverCause = 'pointer' | 'wheel' | 'keyboard' | 'route' | 'programmatic'

/** Enough camera state for the UI to reason about hand-over without importing three.js. */
export interface CameraState {
  readonly position: Vec3
  readonly target: Vec3
  readonly distance: number
}

export interface NavigationSnapshot {
  readonly focus: Focus
  readonly level: Level
  /** The flight in progress, or `null`. */
  readonly flight: { readonly id: number; readonly target: Focus } | null
  readonly attract: boolean
  readonly reducedMotion: boolean
  /** `false` until the intro has played once this session (PRD 6.8.2). */
  readonly introPlayed: boolean
}

export interface NavigationEvents {
  /** Fired after `focus` changes, before the fly-to resolves. */
  focuschange: { readonly focus: Focus; readonly reason: NavigationReason }
  flightstart: { readonly id: number; readonly target: Focus; readonly reason: NavigationReason }
  flightend: FlightResult
  /**
   * PRD 5.7.3: input cancelled the tween and the camera continues from here, continuous in
   * position and velocity. Phase 4 uses this to stop showing a "flying" affordance.
   */
  handover: { readonly id: number; readonly cause: HandoverCause; readonly camera: CameraState }
  attractenter: Record<string, never>
  attractexit: { readonly cause: HandoverCause }
  /** PRD 5.3.4: the Blind Eternities was re-anchored without a route change. */
  anchorchange: { readonly anchor: Vec3 }
}

export type NavigationEventName = keyof NavigationEvents
export type Unsubscribe = () => void

/**
 * The whole surface the UI may use. Nothing else about the scene is public.
 *
 * Implementations must hold these invariants:
 *  - a new fly-to supersedes the one in flight; the old `done` resolves `'superseded'`;
 *  - `focus` updates synchronously at the *start* of a flight, so the URL and the breadcrumb are
 *    never a frame behind (PRD 6.7.1 makes the URL the source of truth);
 *  - a cancelled flight leaves `focus` at the target it was flying to, tethered where the camera
 *    stopped — PRD 5.7.3 hands over control, it does not undo the navigation;
 *  - `attract` exits on any input and never changes the route (PRD 5.3.23).
 */
export interface NavigationApi {
  snapshot(): NavigationSnapshot
  subscribe(listener: (snapshot: NavigationSnapshot) => void): Unsubscribe
  on<K extends NavigationEventName>(
    event: K,
    listener: (payload: NavigationEvents[K]) => void,
  ): Unsubscribe

  /** PRD 6.3.1 breadcrumb root, and Esc from a plane (PRD 6.1.3). */
  flyToMultiverse(options?: FlyOptions): Flight
  /** PRD 5.7.2. */
  flyToPlane(slug: PlaneSlug, options?: FlyOptions): Flight
  /**
   * PRD 5.3.4. `anchor` is the clicked dust position, a card's position, or `undefined` for the
   * multiverse centre. Re-anchoring while already focused emits `anchorchange` and no route change.
   */
  flyToBlindEternities(anchor?: Vec3, options?: FlyOptions): Flight
  /**
   * PRD 6.2.3-4: two-stage from outside the card's plane (frame the plane, hold 0.4 s, then the
   * card, capped at 3.5 s combined), single-stage from inside it. The scene decides which.
   */
  flyToCard(
    target: { readonly planeSlug: PlaneSlug; readonly oracleId: OracleId; readonly starIndex?: number },
    options?: FlyOptions,
  ): Flight
  /** PRD 6.1.3: card to plane, plane to multiverse, nothing at multiverse level. */
  focusParent(options?: FlyOptions): Flight | null

  /** PRD 6.8.2. Plays once per session; a second call is a no-op that resolves immediately. */
  playIntro(target: Focus, options?: FlyOptions): Flight

  /** PRD 5.3.22-23. `exitAttract` is what any input handler calls. */
  enterAttract(): void
  exitAttract(cause: HandoverCause): void

  /** PRD 5.9, plus the settings toggle of PRD 6.10.1. */
  setReducedMotion(enabled: boolean): void

  /** PRD 5.7.3, called by the input layer the moment the user touches the camera. */
  handOver(cause: HandoverCause): void

  /** Release listeners and cancel anything in flight. */
  dispose(): void
}
