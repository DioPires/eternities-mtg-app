/**
 * The navigation contract, implemented against the real camera rig (Phase 2b, DEC-588).
 *
 * This is the transport half of `machine.ts`: the machine owns focus, flights and events, and this
 * turns a `Focus` into a tether and a list of eased legs for `CameraRig` to fly. Phase 4's call
 * sites do not change — `createSceneNavigation()` returns the same `NavigationApi` that
 * `createNavigationStub()` does, and `web/test/navigation.test.ts` runs over both.
 *
 * The PRD rules that live *here* rather than in the machine are the ones that need to know where
 * things are:
 *
 * - **PRD 6.2.3–4**: two stages from outside the card's plane, one from inside it. The scene
 *   decides, because only the scene knows the camera is outside.
 * - **PRD 5.3.4**: a Blind Eternities focus is a tether at its anchor with plane-level limits, and
 *   the anchor is held in the dust row's local frame so it turns with the multiverse rather than
 *   sliding out from under the camera.
 * - **PRD 6.8.2**: the intro comes in from far outside, and for a card target it ends framing the
 *   card's *plane* — the second stage follows when `search.json` resolves the card.
 * - **PRD 5.7.3**: the duration is the scene's to choose, from the distance it is about to fly.
 */

import type { Stars } from '../data/decode'
import type { PlaneRecord, PlanesFile } from '../data/types'
import { BLIND_ETERNITIES_SLUG } from '../data/types'
import { AttractDirector } from '../camera/attract'
import { emptyTether, tetherPosition, type Framing, type Tether } from '../camera/framing'
import {
  CameraRig,
  DEFAULT_DURATION_MS,
  INTRO_DURATION_MS,
  TWO_STAGE_CAP_MS,
  TWO_STAGE_HOLD_MS,
  type FlightLeg,
} from '../camera/rig'
import { distance, fromTuple, set, vec, type MutVec3 } from '../camera/vec'

import { createNavigationMachine, type NavigationTransport } from './machine'
import type { Focus, NavigationApi } from './types'

/**
 * Where a star is, in its plane's local frame. PRD 8.5.7 permits exactly one CPU-side star
 * position — the focused one — which is what the camera tether needs and all this ever supplies.
 */
export interface StarSource {
  /** Returns the star's plane index, or `null` while `stars.bin` has not delivered that record. */
  readonly starLocal: (starIndex: number, out: MutVec3) => number | null
}

/** Adapt a decoded (or still-streaming) `stars.bin` into a `StarSource`. */
export function starSourceFromStars(stars: Stars): StarSource {
  return {
    starLocal: (index, out) => {
      if (!Number.isInteger(index) || index < 0 || index >= stars.count) return null
      set(out, stars.x(index), stars.y(index), stars.z(index))
      return stars.planeIndex(index)
    },
  }
}

export interface SceneNavigationOptions {
  readonly initialFocus?: Focus
  readonly reducedMotion?: boolean
  /** Resolves `starIndex` to a position. Absent until `stars.bin` lands; the rig copes (PRD 6.7.1). */
  readonly stars?: StarSource
  /**
   * `'auto'` runs an internal frame loop — `requestAnimationFrame` in a browser, a timer elsewhere.
   * `'manual'` means the caller drives `update(dt)`, which is what the R3F component does from
   * `useFrame` so the rig shares the renderer's clock.
   */
  readonly drive?: 'auto' | 'manual'
  /** Collapse every flight the caller did not time explicitly. The stub's `instant`, for tests. */
  readonly instant?: boolean
  readonly attractSeed?: number
}

export interface SceneNavigation {
  readonly api: NavigationApi
  readonly rig: CameraRig
  /** Advance the rig by `dt` seconds. Only used with `drive: 'manual'`. */
  readonly update: (dt: number) => void
  /**
   * `stars.bin` arrives after the first frame (PRD 8.7.3), so a scene built at load time has no
   * way to resolve a `starIndex` yet. This hands the source over later without rebuilding anything
   * — and without disturbing a flight in progress, which is the same promise `resolveCard` makes.
   */
  readonly setStarSource: (source: StarSource) => void
}

interface FrameLoop {
  ensureRunning: () => void
  stop: () => void
}

function createFrameLoop(step: (dt: number) => void): FrameLoop {
  const raf = typeof globalThis.requestAnimationFrame === 'function'
  let handle: number | ReturnType<typeof setInterval> | null = null
  let last = 0

  const now = (): number =>
    typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : 0

  const tick = (): void => {
    const t = now()
    // Clamp the delta: a backgrounded tab or a breakpoint would otherwise deliver one enormous
    // step and teleport the camera through half the multiverse.
    const dt = last === 0 ? 1 / 60 : Math.min((t - last) / 1000, 0.1)
    last = t
    step(dt)
    if (raf && handle !== null) handle = globalThis.requestAnimationFrame(tick)
  }

  return {
    ensureRunning: () => {
      if (handle !== null) return
      last = 0
      handle = raf ? globalThis.requestAnimationFrame(tick) : setInterval(tick, 16)
    },
    stop: () => {
      if (handle === null) return
      if (raf) globalThis.cancelAnimationFrame(handle as number)
      else clearInterval(handle as ReturnType<typeof setInterval>)
      handle = null
    },
  }
}

export function createSceneNavigation(
  planes: PlanesFile,
  options: SceneNavigationOptions = {},
): SceneNavigation {
  const rig = new CameraRig(planes, {
    ...(options.reducedMotion !== undefined && { reducedMotion: options.reducedMotion }),
  })
  const framing: Framing = rig.framing
  const attract = new AttractDirector(rig, framing, {
    ...(options.attractSeed !== undefined && { seed: options.attractSeed }),
  })
  const blindEternities = rig.planeBySlug(BLIND_ETERNITIES_SLUG)

  let stars = options.stars ?? null
  let disposed = false

  // Preallocated: `begin` runs on navigation, not per frame, but the scratch is shared with helpers
  // that a `retarget` can reach during a flight.
  const scratchLocal: MutVec3 = vec()
  const scratchWorld: MutVec3 = vec()
  const scratchLegFrom: MutVec3 = vec()
  const scratchLegTo: MutVec3 = vec()

  const loop = createFrameLoop((dt) => {
    if (disposed) return
    rig.update(dt)
    // Nothing is moving and nothing is being flown: stop burning frames until something happens.
    if (!rig.flying) loop.stop()
  })

  const wake = (): void => {
    if (options.drive === 'manual' || disposed) return
    loop.ensureRunning()
  }

  // --- Focus → tether -------------------------------------------------------------------------

  /**
   * PRD 5.3.4: a dust anchor is a *world* point from a click, a card or a search. It is stored in
   * the Blind Eternities row's local frame, which PRD 8.3 defines as the identity transform at
   * radius `R` — so multiverse coordinates over `R`, and it turns with PRD 5.3.13's rotation for
   * free instead of drifting away from the dust it was pointing at.
   */
  const dustTether = (out: Tether, anchor: readonly number[] | undefined): Tether => {
    if (!blindEternities) return framing.multiverse(out)
    if (!anchor) return framing.dust(out, blindEternities)
    fromTuple(scratchWorld, anchor)
    rig.motion.worldToPlaneLocal(scratchLocal, blindEternities, scratchWorld)
    return framing.dust(out, blindEternities, scratchLocal)
  }

  const planeTether = (out: Tether, slug: string, anchor?: readonly number[]): Tether => {
    if (slug === BLIND_ETERNITIES_SLUG) return dustTether(out, anchor)
    const plane = rig.planeBySlug(slug)
    // An unknown slug is a dead link, not a crash: the machine keeps the focus the caller asked for
    // (the router will correct it) and the camera goes somewhere sane.
    if (!plane) return framing.multiverse(out)
    return framing.plane(out, plane)
  }

  /**
   * The tether for a card focus, or `null` while its position is unknown — no `starIndex` yet on
   * the cold-start deep-link path (PRD 6.7.1), or `stars.bin` still streaming.
   */
  const cardTether = (out: Tether, focus: Focus): Tether | null => {
    if (focus.kind !== 'card') return null
    if (focus.planeSlug === BLIND_ETERNITIES_SLUG) {
      // A dust card is at its anchor, and PRD 6.2.3 makes that anchor the focus's own.
      if (!blindEternities || !focus.anchor) return null
      fromTuple(scratchWorld, focus.anchor)
      rig.motion.worldToPlaneLocal(scratchLocal, blindEternities, scratchWorld)
      return framing.card(out, blindEternities, scratchLocal)
    }
    if (focus.starIndex === undefined || !stars) return null
    const planeIndex = stars.starLocal(focus.starIndex, scratchLocal)
    if (planeIndex === null) return null
    const plane: PlaneRecord | undefined = rig.motion.planes[planeIndex]
    if (!plane) return null
    return framing.card(out, plane, scratchLocal)
  }

  const tetherFor = (out: Tether, focus: Focus): Tether => {
    if (focus.kind === 'multiverse') return framing.multiverse(out)
    if (focus.kind === 'plane') return planeTether(out, focus.slug, focus.anchor)
    return cardTether(out, focus) ?? planeTether(out, focus.planeSlug, focus.anchor)
  }

  // --- Focus → legs ---------------------------------------------------------------------------

  const insideTargetPlane = (from: Focus, target: Focus): boolean => {
    if (target.kind !== 'card') return false
    return (
      (from.kind === 'plane' && from.slug === target.planeSlug) ||
      (from.kind === 'card' && from.planeSlug === target.planeSlug)
    )
  }

  /**
   * PRD 6.2.3's two stages, and how long each of them takes on its own distance (PRD 5.7.3).
   *
   * Shared by `legsFor` and `baseDurationMs` so the flight the rig is given and the duration the
   * machine publishes are the same arithmetic rather than two guesses that happen to agree.
   */
  interface TwoStage {
    readonly stage1: Tether
    readonly stage2: Tether
    /** Arrival distance for stage two when the card's position is not known yet; see below. */
    readonly stage2Distance: number | undefined
    readonly leg1Ms: number
    readonly leg2Ms: number
  }

  const twoStageFor = (target: Extract<Focus, { kind: 'card' }>): TwoStage => {
    const stage1 = planeTether(emptyTether(), target.planeSlug, target.anchor)
    const card = cardTether(emptyTether(), target)
    // Without a resolved position the second stage still has somewhere to go: closer in on the same
    // plane. `resolveCard` re-aims it in place when `sets.bin` lands, with no restart (PRD 6.7.1).
    const stage2 = card ?? { ...stage1, local: { ...stage1.local } }
    const stage2Distance = card ? undefined : stage1.minDistance * 1.05

    // Stage two starts where stage one lands, which is nowhere the camera has been, so its length
    // is measured rather than asked for: the two tether points, plus the change in framing radius.
    // Both stages arrive from the same direction — the camera closes in, it does not swing round —
    // so the triangle inequality collapses to that sum.
    tetherPosition(scratchLegFrom, stage1, rig.motion)
    tetherPosition(scratchLegTo, stage2, rig.motion)
    const leg2Travel =
      distance(scratchLegFrom, scratchLegTo) +
      Math.abs(stage1.frameDistance - (stage2Distance ?? stage2.frameDistance))

    return {
      stage1,
      stage2,
      stage2Distance,
      leg1Ms: rig.durationMsFor(stage1),
      leg2Ms: rig.durationMsForTravel(leg2Travel),
    }
  }

  const legsFor = (target: Focus, from: Focus, durationMs: number, intro: boolean): FlightLeg[] => {
    const total = durationMs / 1000

    if (target.kind !== 'card' || intro) {
      // PRD 6.8.2: for a card target the intro ends framing the card's *plane*; the second stage
      // follows once `search.json` resolves the card, as a separate `flyToCard`.
      const focusForFrame: Focus =
        intro && target.kind === 'card'
          ? { kind: 'plane', slug: target.planeSlug, ...(target.anchor && { anchor: target.anchor }) }
          : target
      const tether = tetherFor(emptyTether(), focusForFrame)
      return [{ tether, durationS: total, holdS: 0 }]
    }

    if (insideTargetPlane(from, target)) {
      // PRD 6.2.4: a single stage, because the plane is already framed.
      const card = cardTether(emptyTether(), target)
      const tether = card ?? planeTether(emptyTether(), target.planeSlug, target.anchor)
      return [{ tether, durationS: total, holdS: 0 }]
    }

    // PRD 6.2.3: frame the plane, hold 0.4 s, then the card, capped at 3.5 s combined.
    const { stage1, stage2, stage2Distance, leg1Ms, leg2Ms } = twoStageFor(target)
    const capped = Math.min(durationMs, TWO_STAGE_CAP_MS)
    const holdS = Math.min(TWO_STAGE_HOLD_MS, capped * 0.2) / 1000
    const flyS = Math.max(capped / 1000 - holdS, 0)
    // PRD 5.7.3: each stage gets the share of the budget its own distance earns, so the long haul
    // across the multiverse is not given the same time as the short close-in on the card.
    const share = leg1Ms / Math.max(leg1Ms + leg2Ms, 1e-6)

    return [
      { tether: stage1, durationS: flyS * share, holdS: 0 },
      {
        tether: stage2,
        durationS: flyS * (1 - share),
        holdS,
        ...(stage2Distance !== undefined && { distance: stage2Distance }),
      },
    ]
  }

  /** PRD 6.8.2: the intro comes in from far outside the multiverse, over 4 s, eased. */
  const introLeg = (legs: FlightLeg[]): FlightLeg[] => {
    const first = legs[0]
    if (!first) return legs
    rig.snapTo({
      tether: first.tether,
      durationS: 0,
      holdS: 0,
      distance: framing.multiverseRadius * 6,
      polar: first.tether.framePolar - 0.35,
      azimuth: rig.currentAzimuth,
    })
    return legs
  }

  // --- The transport --------------------------------------------------------------------------

  const transport: NavigationTransport = {
    begin: (request) => {
      const target = request.target()
      const intro = request.reason === 'intro'
      const legs = legsFor(target, request.from, request.durationMs, intro)

      if (request.immediate || (options.instant === true && !request.explicitDuration)) {
        const last = legs[legs.length - 1]
        if (last) rig.snapTo(last)
        request.settle('completed')
        return
      }

      if (intro) introLeg(legs)
      attract.stop()
      rig.fly(legs, request.settle)
      wake()
    },

    stop: (handover) => {
      attract.stop()
      // The machine settles the flight itself; the rig must not settle it a second time, and its
      // own callback is already guarded by the machine's `settled` flag.
      if (handover) rig.handOver()
      else rig.cancelFlight('cancelled')
    },

    retarget: (target) => {
      const tether = tetherFor(emptyTether(), target)
      if (rig.flying) rig.retargetFinalLeg(tether)
      else rig.rebaseTo(tether)
    },

    settleAt: (focus) => {
      rig.rebaseTo(tetherFor(emptyTether(), focus))
      wake()
    },

    cameraState: () => rig.cameraState(),

    /**
     * PRD 5.7.3: 1.2 s for a one-level hop, scaled with distance to a 3 s cap. PRD 6.2.3's 3.5 s is
     * a *cap* on the two-stage card fly-to and not its duration — it is more than a single hop
     * because it is two of them plus a hold — so both legs are scaled and their sum is clamped.
     */
    baseDurationMs: (target, from) => {
      if (target.kind === 'card' && !insideTargetPlane(from, target)) {
        const { leg1Ms, leg2Ms } = twoStageFor(target)
        return Math.min(leg1Ms + leg2Ms + TWO_STAGE_HOLD_MS, TWO_STAGE_CAP_MS)
      }
      const tether = tetherFor(emptyTether(), target)
      return Math.max(rig.durationMsFor(tether), DEFAULT_DURATION_MS * 0.25)
    },

    setReducedMotion: (enabled) => {
      rig.setReducedMotion(enabled)
    },

    enterAttract: () => {
      attract.start()
      wake()
    },

    exitAttract: (_cause, focus) => {
      attract.stop()
      // PRD 5.3.23: "returns control without a jump". The rig's ordinary hand-over does that half —
      // position preserved exactly, the tween's velocity handed to the orbit's inertia — but it
      // rebases onto the leg it was flying, and an attract leg is aimed at a plane the user never
      // chose. PRD 5.7.1 says the camera is tethered to the *focus*, so put it back on the focus:
      // `rebaseTo` keeps the world position and the orbit rates and moves only the point being
      // orbited, so the no-jump promise survives and the focus's own limits take over.
      rig.handOver()
      rig.rebaseTo(tetherFor(emptyTether(), focus))
      wake()
    },

    dispose: () => {
      disposed = true
      attract.stop()
      loop.stop()
    },
  }

  const api = createNavigationMachine(transport, {
    ...(options.initialFocus && { initialFocus: options.initialFocus }),
    ...(options.reducedMotion !== undefined && { reducedMotion: options.reducedMotion }),
  })

  // Park the camera on the initial focus rather than on the constructor's default home view, so a
  // deep link that opens on a plane does not start by looking at the multiverse.
  if (options.initialFocus) {
    rig.snapTo({ tether: tetherFor(emptyTether(), options.initialFocus), durationS: 0, holdS: 0 })
  }

  return {
    api,
    rig,
    update: (dt: number) => {
      if (!disposed) rig.update(dt)
    },
    setStarSource: (source: StarSource) => {
      stars = source
    },
  }
}

export { INTRO_DURATION_MS }
