/**
 * PRD 5.6.7-9: a card's printings, as planets orbiting it.
 *
 * The layout rules are all PRD text and all arithmetic, so they live here as pure functions and are
 * tested without a GPU:
 *
 *  - "ordered clockwise by release date starting at 12 o'clock, evenly spaced" (5.6.7). The
 *    printings arrive in release order already (`PrintingTuple`, contract §7), so ordering is the
 *    array's and this only has to place it;
 *  - "rings hold up to 24 planets each and are added as needed: one ring up to 24 printings, two up
 *    to 48, three up to 72" (5.6.8);
 *  - "beyond 72 the outermost ring is capped and the remainder is listed in the card panel" (5.6.8)
 *    — so this returns how many were dropped, and the panel (Phase 4) is told;
 *  - "cards with one printing show no planets" (5.6.8).
 *
 * Orbit is "one revolution per 60 s, independent of the plane's spin, so they keep moving while the
 * plane is paused" (5.6.7). Independence is why the angle below is a function of the scene clock and
 * of nothing in the plane table.
 */

import {
  PLANETS_PER_RING,
  PLANET_CAP,
  PLANET_PERIOD_S,
  PLANET_RING_RADII,
  PLANET_TICK_RADIUS,
} from '../tuning'

export interface PlanetSlot {
  /** Index into the card's printings array. */
  readonly printing: number
  readonly ring: number
  /** Angle at t = 0, in radians, measured clockwise on screen from 12 o'clock. */
  readonly phase: number
  readonly radius: number
}

/**
 * A dropped printing, marked at its own place in the release order (worlds spec §1.10).
 *
 * Structurally a {@link PlanetSlot} minus the ring, and deliberately so: {@link planetPosition}
 * takes both, because a tick orbits on exactly the same clock as the quads. One angular law, not
 * two — a tick drifting against the ring it belongs to would read as a bug.
 */
export interface PrintingTick {
  /** Index into the card's printings array. Always `>= PLANET_CAP`. */
  readonly printing: number
  readonly phase: number
  readonly radius: number
}

export interface PlanetLayout {
  readonly slots: readonly PlanetSlot[]
  /** Printings past the 72 the rings can hold. PRD 5.6.8 sends these to the card panel. */
  readonly overflow: number
  readonly rings: number
  /**
   * One tick per dropped printing (§1.10), on a ring outside the outermost planet ring.
   *
   * Empty whenever nothing is dropped, which is all but five cards on the production roster.
   */
  readonly ticks: readonly PrintingTick[]
}

/**
 * Where each printing's planet goes.
 *
 * A single-printing card gets nothing at all: PRD 5.6.8's last line, and it matters — a lone planet
 * orbiting a card would read as a second card rather than as "this printing is the only one".
 */
export function planetLayout(printings: number): PlanetLayout {
  if (printings <= 1) return { slots: [], overflow: 0, rings: 0, ticks: [] }

  const shown = Math.min(printings, PLANET_CAP)
  const rings = Math.ceil(shown / PLANETS_PER_RING)
  const slots: PlanetSlot[] = []

  for (let ring = 0; ring < rings; ring += 1) {
    const from = ring * PLANETS_PER_RING
    const count = Math.min(PLANETS_PER_RING, shown - from)
    const radius = PLANET_RING_RADII[ring] ?? PLANET_RING_RADII[PLANET_RING_RADII.length - 1]!
    for (let i = 0; i < count; i += 1) {
      slots.push({
        printing: from + i,
        ring,
        // Evenly spaced around the ring the printing landed in, from 12 o'clock.
        phase: (2 * Math.PI * i) / count,
        radius,
      })
    }
  }

  /*
   * §1.10's ticks: **the ring is a clock of the release order**, and a tick sits where its own
   * printing falls on it — `2π · i / printings` for printing `i` of `printings`.
   *
   * The angle cannot come from a date, and this is a fact about the contract rather than a
   * shortcut: a `PrintingTuple` is `[id, setId, rarity, imageTs, collectorNumber, artist?]` and
   * carries no release date at all. What it carries is its *position*, because the tuples arrive
   * ordered by release (PRD 5.6.7, contract §7). So the release order is the array order, and
   * "its own release angle" is its own fraction of that order.
   *
   * That makes the quads and the ticks two different spacings on purpose. A quad is evenly spaced
   * within the ring it landed in — PRD 5.6.8's rule, unchanged — while a tick is placed against
   * the *whole* uncapped sequence. Spacing the ticks by `i - PLANET_CAP` instead would spread 498
   * dropped Swamp printings evenly around the circle and say nothing about where in the card's
   * history they sit, which is the one thing §1.10 wants shown.
   */
  const ticks: PrintingTick[] = []
  for (let printing = shown; printing < printings; printing += 1) {
    ticks.push({
      printing,
      phase: (2 * Math.PI * printing) / printings,
      radius: PLANET_TICK_RADIUS,
    })
  }

  return { slots, overflow: printings - shown, rings, ticks }
}

/**
 * A planet's position in the card's own frame at scene time `t`.
 *
 * Clockwise on screen is +x from +y, which is why `sin` is the x term and `cos` the y term: at
 * angle 0 the planet is straight up, and as the angle grows it moves to the right.
 */
export function planetPosition(
  slot: Pick<PlanetSlot, 'phase' | 'radius'>,
  timeS: number,
  motionScale: number,
  out: { x: number; y: number; z: number },
): void {
  const angle = slot.phase + ((2 * Math.PI) / PLANET_PERIOD_S) * timeS * motionScale
  out.x = slot.radius * Math.sin(angle)
  out.y = slot.radius * Math.cos(angle)
  // Slightly proud of the card's own plane, so a planet passing "behind" the card is occluded by it
  // rather than z-fighting with it.
  out.z = 0
}
