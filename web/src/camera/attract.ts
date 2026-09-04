/**
 * Attract mode (PRD 5.3.22–23).
 *
 * "After 45 s without input, the camera drifts cinematically between planes on eased paths,
 * occasionally dipping to plane level. Any input cancels it immediately and returns control without
 * a jump." The 45 s timer is the UI's (navigation contract §6); everything below the timer is here.
 *
 * Two rules shape the whole design:
 *
 * - **It never enters card level and never changes the URL** (PRD 5.3.23). So attract drives the
 *   *camera* and not the focus: the rig flies attract legs with `attract = true`, the navigation
 *   layer emits no `focuschange`, and the route the user arrived on is still the route they have
 *   when they touch the mouse again.
 * - **Any input cancels it without a jump.** That is the rig's ordinary hand-over — rebase onto the
 *   leg's tether, project the tween velocity onto the orbit rates — so leaving attract mode is
 *   continuous in position and velocity for free. The hand-over alone would leave the camera
 *   tethered to the *tour's* plane, though, so `scene.ts`'s `exitAttract` follows it with a
 *   `rebaseTo` onto the focus (PRD 5.7.1), after which the focus's own distance limits draw the
 *   camera back in softly rather than snapping (`LIMIT_SPRING` in `rig.ts`).
 *
 * The tour is seeded, not random: the same build shows the same tour, which is the promise PRD
 * 5.3.1 already makes about the multiverse itself. No `Math.random` anywhere in the scene.
 */

import type { PlaneRecord } from '../data/types'
import { BLIND_ETERNITIES_SLUG } from '../data/types'

import { emptyTether, type Framing, type Tether } from './framing'
import type { CameraRig, FlightLeg } from './rig'

/** A long, slow leg between planes. */
const CRUISE_S = 9
/** PRD 5.3.22's "dipping to plane level", and the climb back out. */
const DIP_S = 5.5
const CLIMB_S = 6
const DIP_HOLD_S = 0.8
/** Every third plane is dipped into, so the tour has a rhythm rather than a pattern. */
const DIP_EVERY = 3
/** How far out the cruise sits, as a multiple of the plane's own framing distance. */
const CRUISE_FACTOR = 4.5
/** How far the azimuth swings per leg, so the camera is always turning as well as travelling. */
const AZIMUTH_STEP = 2.1

/** Deterministic, seeded, and identical for every user of a build. */
function seededOrder(planes: readonly PlaneRecord[], seed: number): PlaneRecord[] {
  const tour = planes.filter((p) => p.slug !== BLIND_ETERNITIES_SLUG && p.cardCount > 0)
  // A stable sort by a hash of the slug: a shuffle that needs no PRNG state.
  return tour
    .map((plane) => {
      let h = seed >>> 0
      for (let i = 0; i < plane.slug.length; i += 1) {
        h = (Math.imul(h ^ plane.slug.charCodeAt(i), 0x01000193) + 0x9e3779b9) >>> 0
      }
      return { plane, key: h }
    })
    .sort((a, b) => a.key - b.key || a.plane.slug.localeCompare(b.plane.slug))
    .map((entry) => entry.plane)
}

export interface AttractOptions {
  readonly seed?: number
}

/**
 * Drives the endless attract tour, one rig flight at a time. The rig takes a finite list of legs
 * and settles; the director hears the settle and issues the next stop. Cancelling is therefore one
 * flag plus the rig's own hand-over.
 */
export class AttractDirector {
  private readonly rig: CameraRig
  private readonly framing: Framing
  private readonly tour: PlaneRecord[]
  private cursor = 0
  private running = false
  private readonly tether: Tether = emptyTether()

  constructor(rig: CameraRig, framing: Framing, options: AttractOptions = {}) {
    this.rig = rig
    this.framing = framing
    this.tour = seededOrder(rig.motion.planes, options.seed ?? 0x5eed)
  }

  get active(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    if (this.tour.length === 0) return
    this.running = true
    this.next()
  }

  /**
   * Stop issuing legs. The *camera* is stopped by the caller's `handOver`, which is what makes the
   * exit continuous; this only prevents the next stop from being scheduled.
   */
  stop(): void {
    this.running = false
  }

  private next(): void {
    if (!this.running) return
    const plane = this.tour[this.cursor % this.tour.length]!
    const dip = this.cursor % DIP_EVERY === DIP_EVERY - 1
    this.cursor += 1

    this.framing.plane(this.tether, plane)
    const cruise = this.tether.frameDistance * CRUISE_FACTOR
    const azimuth = this.rig.currentAzimuth + AZIMUTH_STEP

    const legs: FlightLeg[] = [
      {
        tether: { ...this.tether, local: { ...this.tether.local } },
        durationS: CRUISE_S,
        holdS: 0,
        distance: cruise,
        // A shallower angle than the home view: the tour reads as flying *through* the disc.
        polar: this.tether.framePolar + 0.22,
        azimuth,
      },
    ]

    if (dip) {
      // PRD 5.3.22's dip to plane level. `frameDistance` is the plane level, and the tether's own
      // `minDistance` is never crossed, so PRD 5.3.23's "never enters card level" holds by
      // construction rather than by a check.
      legs.push({
        tether: { ...this.tether, local: { ...this.tether.local } },
        durationS: DIP_S,
        holdS: 0,
        distance: this.tether.frameDistance,
        polar: this.tether.framePolar,
        azimuth: azimuth + 0.7,
      })
      legs.push({
        tether: { ...this.tether, local: { ...this.tether.local } },
        durationS: CLIMB_S,
        holdS: DIP_HOLD_S,
        distance: cruise,
        polar: this.tether.framePolar + 0.3,
        azimuth: azimuth + 1.5,
      })
    }

    this.rig.fly(
      legs,
      (status) => {
        // A cancelled leg is either the user's hand-over or a real navigation taking over. Either
        // way the tour is over; only a completed leg asks for the next stop.
        if (status === 'completed') this.next()
      },
      true,
    )
  }
}
