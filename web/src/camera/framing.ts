/**
 * What "tethered to a focus" means in numbers (PRD 5.7.1).
 *
 * A tether is a point the camera orbits, a pair of distance limits, and the framing a fly-to should
 * arrive at. Every tether except the multiverse's is expressed as a point in a *plane's local
 * frame*, not in world space, which is PRD 5.7.4: the destination keeps spinning and drifting
 * during the flight, and a target computed in its local frame is still framed correctly on arrival
 * however long the flight took.
 *
 * The Blind Eternities makes this uniform rather than special. PRD 8.3 gives it a normal plane row
 * with the identity transform and radius `R`, so a dust anchor is just a point in that row's local
 * frame, and it follows the multiverse's own rotation for free (PRD 5.3.13) instead of sliding out
 * from under the camera.
 */

import type { PlaneRecord, PlanesFile } from '../data/types'
import { BLIND_ETERNITIES_SLUG } from '../data/types'
import type { Level } from '../navigation/types'

import type { SceneMotion } from './motion'
import { copy, distance, set, type MutVec3, vec } from './vec'

export type TetherKind = 'multiverse' | 'plane' | 'dust' | 'card'

/**
 * PRD 8.6.1: the home camera frames the whole disc at ~30° elevation. Stored as the polar angle
 * from +Y, which is what the spherical rig uses.
 */
export const HOME_POLAR = Math.PI / 2 - Math.PI / 6

/** PRD 5.6.1: the focused card sits at a fixed on-screen size, so its framing is a constant. */
export const CARD_RADIUS = 0.55

/**
 * PRD 5.3.4: the dust has no radius of its own — it spans the multiverse — but the camera tethers
 * to an anchor "with plane-level distance limits". This is the plane-sized radius those limits are
 * derived from, as a fraction of the multiverse radius; it lands near a typical plane's radius on
 * both fixtures.
 */
export const DUST_ANCHOR_RADIUS_FRACTION = 0.06

/**
 * PRD 5.7.5: the camera never intersects a galaxy disc. A plane's exclusion sphere is its radius
 * times this — the disc plus the margin PRD 5.3.3 already reserves for drift.
 */
export const CLEARANCE_FACTOR = 1.3

export interface Tether {
  readonly kind: TetherKind
  /** Row in `planes.json`, or -1 for the multiverse centre. */
  planeIndex: number
  /** The tether point in that plane's local frame (PRD 5.7.4). Unused when `planeIndex` is -1. */
  local: MutVec3
  /** PRD 5.7.1's per-level limits. */
  minDistance: number
  maxDistance: number
  /** Where a fly-to to this tether should arrive. */
  frameDistance: number
  framePolar: number
}

export function emptyTether(): Tether {
  return {
    kind: 'multiverse',
    planeIndex: -1,
    local: vec(),
    minDistance: 1,
    maxDistance: 10,
    frameDistance: 5,
    framePolar: HOME_POLAR,
  }
}

/** PRD 5.1.3: levels are distances. This is the level a tether kind sits at. */
export function levelOfTether(kind: TetherKind): Level {
  return kind === 'multiverse' ? 'multiverse' : kind === 'card' ? 'card' : 'plane'
}

/**
 * Distance limits and framing per level, all derived from data rather than hand-tuned per plane —
 * the roster is the whole of Appendix A and will not be curated by hand.
 */
export class Framing {
  readonly multiverseRadius: number
  readonly dustRadius: number
  readonly planes: readonly PlaneRecord[]

  constructor(planes: PlanesFile) {
    this.multiverseRadius = planes.multiverseRadius
    this.dustRadius = planes.multiverseRadius * DUST_ANCHOR_RADIUS_FRACTION
    this.planes = planes.planes
  }

  multiverse(out: Tether = emptyTether()): Tether {
    const r = this.multiverseRadius
    return this.write(out, 'multiverse', -1, 0, 0, 0, {
      min: r * 0.3,
      max: r * 3.2,
      frame: r * 1.9,
      polar: HOME_POLAR,
    })
  }

  plane(out: Tether, plane: PlaneRecord): Tether {
    const r = plane.radius
    return this.write(out, 'plane', plane.index, 0, 0, 0, {
      // Just outside `CLEARANCE_FACTOR`, so the closest legal zoom still satisfies PRD 5.7.5's
      // "the camera never intersects a galaxy disc" without the collision push ever engaging.
      min: r * 1.4,
      max: r * 8,
      frame: r * 3.2,
      polar: HOME_POLAR,
    })
  }

  /**
   * PRD 5.3.4. `local` is the anchor in the Blind Eternities row's local frame — multiverse
   * coordinates over `R`. `undefined` means the multiverse centre, which is that frame's origin.
   */
  dust(out: Tether, blindEternities: PlaneRecord, local?: Readonly<MutVec3>): Tether {
    const r = this.dustRadius
    return this.write(
      out,
      'dust',
      blindEternities.index,
      local?.x ?? 0,
      local?.y ?? 0,
      local?.z ?? 0,
      { min: r * 1.4, max: r * 8, frame: r * 3.2, polar: HOME_POLAR },
    )
  }

  card(out: Tether, plane: PlaneRecord, local: Readonly<MutVec3>): Tether {
    const r = CARD_RADIUS
    return this.write(out, 'card', plane.index, local.x, local.y, local.z, {
      min: r * 1.6,
      max: r * 11,
      frame: r * 4,
      // Nearly face-on to the card, tilted just enough that the plane behind it stays legible.
      polar: Math.PI / 2 - 0.12,
    })
  }

  private write(
    out: Tether,
    kind: TetherKind,
    planeIndex: number,
    lx: number,
    ly: number,
    lz: number,
    limits: { min: number; max: number; frame: number; polar: number },
  ): Tether {
    const mutable = out as {
      kind: TetherKind
      planeIndex: number
      local: MutVec3
      minDistance: number
      maxDistance: number
      frameDistance: number
      framePolar: number
    }
    mutable.kind = kind
    mutable.planeIndex = planeIndex
    set(mutable.local, lx, ly, lz)
    mutable.minDistance = limits.min
    mutable.maxDistance = limits.max
    mutable.frameDistance = limits.frame
    mutable.framePolar = limits.polar
    return out
  }
}

/**
 * Resolve a tether to its world point at the current instant.
 *
 * **A card tether resolves through the star transform, not the plane transform**, and the two are
 * not the same: `planeLocalToWorld` carries the spin, the tilt, the radius, the drift and the
 * multiverse rotation, but not PRD 5.4.13's bounded shear or PRD 8.6.3's dust turbulence, because
 * neither is a rigid motion of the plane — each is a function of the individual star. For every
 * other tether kind the local point is the origin, where that distinction cannot show. For a card
 * it is a star's own local position, and the shader draws that star *with* the shear: at a 10°
 * bound on a plane of radius 20 the two points are up to three world units apart, against a card
 * 0.63 wide. Phase 3's first browser run put the focused card off screen and 0.75 units nearer the
 * camera than the rig thought it was; this is why.
 */
export function tetherPosition(out: MutVec3, tether: Readonly<Tether>, motion: SceneMotion): MutVec3 {
  if (tether.planeIndex < 0) return set(out, 0, 0, 0)
  const plane = motion.planes[tether.planeIndex]
  if (!plane) return set(out, 0, 0, 0)
  if (tether.kind === 'card') {
    return motion.starPosition(out, plane, tether.local.x, tether.local.y, tether.local.z)
  }
  return motion.planeLocalToWorld(out, plane, tether.local)
}

export function copyTether(out: Tether, source: Readonly<Tether>): Tether {
  const mutable = out as {
    kind: TetherKind
    planeIndex: number
    minDistance: number
    maxDistance: number
    frameDistance: number
    framePolar: number
    local: MutVec3
  }
  mutable.kind = source.kind
  mutable.planeIndex = source.planeIndex
  mutable.minDistance = source.minDistance
  mutable.maxDistance = source.maxDistance
  mutable.frameDistance = source.frameDistance
  mutable.framePolar = source.framePolar
  copy(mutable.local, source.local)
  return out
}

/**
 * PRD 5.7.5: "approach paths arc around geometry".
 *
 * A straight line from the start camera position to the arrival position can pass through a plane
 * on the way, and on the multiverse disc it usually does — the planes sit between each other. The
 * fly-to therefore bulges its distance-from-tether outwards by a sine hump, and this returns how
 * big that hump has to be for the whole path to clear every plane's exclusion sphere.
 *
 * Computed once per flight, over one sphere per roster plane × 12 samples. Nothing here runs
 * per frame.
 */
export function clearanceBulge(
  from: Readonly<MutVec3>,
  to: Readonly<MutVec3>,
  planes: readonly PlaneRecord[],
  motion: SceneMotion,
  samples = 12,
): number {
  const point = vec()
  const centre = vec()
  let worst = 0
  for (const plane of planes) {
    // The Blind Eternities row spans the whole multiverse; treating it as a solid sphere would
    // forbid every path there is.
    if (plane.slug === BLIND_ETERNITIES_SLUG) continue
    const exclusion = plane.radius * CLEARANCE_FACTOR
    motion.planePosition(centre, plane)
    // Cheap reject: a sphere further from both ends than the segment is long cannot be hit.
    const span = distance(from, to)
    if (distance(from, centre) > span + exclusion && distance(to, centre) > span + exclusion) {
      continue
    }
    for (let i = 1; i < samples; i += 1) {
      const u = i / samples
      set(
        point,
        from.x + (to.x - from.x) * u,
        from.y + (to.y - from.y) * u,
        from.z + (to.z - from.z) * u,
      )
      const gap = exclusion - distance(point, centre)
      if (gap <= 0) continue
      // A sine hump peaks at u = 0.5; this is how much hump the sample needs at its own `u`.
      const shape = Math.sin(Math.PI * u)
      if (shape > 1e-3) worst = Math.max(worst, gap / shape)
    }
  }
  return worst
}
