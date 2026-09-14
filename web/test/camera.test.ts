/**
 * The camera rig's behavioural checks, against fixture-scale's Appendix A roster.
 *
 * PRD 9.1.3 is the headline — "the motion function is run at simulated 30, 60 and 120 fps for a
 * fixed elapsed time and must yield identical positions within float tolerance" — and it is a real
 * check here rather than a formality, because the rig has three places where the lazy spelling
 * would have failed it: the spin accumulator, the orbit's inertia decay, and the tween's clock.
 */

import { describe, expect, it } from 'vitest'

import { AttractDirector } from '../src/camera/attract'
import { CLEARANCE_FACTOR, emptyTether } from '../src/camera/framing'
import { SceneMotion } from '../src/camera/motion'
import { CameraRig, TWO_STAGE_CAP_MS } from '../src/camera/rig'
import { distance, vec, type MutVec3 } from '../src/camera/vec'
import { BLIND_ETERNITIES_SLUG, type PlaneRecord, type PlanesFile } from '../src/data/types'

import { loadFixturePlanes } from './fixtures'

const planes: PlanesFile = loadFixturePlanes('scale')
const RATES = [30, 60, 120] as const
/** Six full seconds is long enough for drift, shear and spin to have gone somewhere. */
const ELAPSED_S = 6

function planeNamed(slug: string): PlaneRecord {
  const plane = planes.planes.find((p) => p.slug === slug)
  if (!plane) throw new Error(`fixture-scale has no plane ${slug}`)
  return plane
}

function step(update: (dt: number) => void, fps: number, seconds: number): void {
  const dt = 1 / fps
  for (let i = 0; i < fps * seconds; i += 1) update(dt)
}

describe('frame-rate independence (PRD 9.1.3, 5.3.17)', () => {
  it('puts every star in the same place at 30, 60 and 120 fps', () => {
    const sampled = RATES.map((fps) => {
      const motion = new SceneMotion(planes)
      step((dt) => {
        motion.advance(dt)
      }, fps, ELAPSED_S)

      const out: number[] = []
      const point = vec()
      for (const plane of planes.planes) {
        motion.planePosition(point, plane)
        out.push(point.x, point.y, point.z)
        // A star well out on the disc, where spin, shear and tilt all contribute.
        motion.starPosition(point, plane, 0.83, 0.04, -0.51)
        out.push(point.x, point.y, point.z)
      }
      return out
    })

    const [at30, at60, at120] = sampled as [number[], number[], number[]]
    expect(at30).toHaveLength(planes.planes.length * 6)
    for (let i = 0; i < at30.length; i += 1) {
      // The only accumulated quantity is the spin angle, and at a constant rate its sum is exact
      // to within the float error of the additions themselves.
      expect(at60[i]!).toBeCloseTo(at30[i]!, 9)
      expect(at120[i]!).toBeCloseTo(at30[i]!, 9)
    }
  })

  it('flies the camera along the same path at 30, 60 and 120 fps', () => {
    const sampled = RATES.map((fps) => {
      const rig = new CameraRig(planes)
      rig.fly(
        [{ tether: rig.framing.plane(emptyTether(), planeNamed('ravnica')), durationS: 3, holdS: 0 }],
        () => {},
      )
      step((dt) => {
        rig.update(dt)
      }, fps, 2)
      return [rig.position.x, rig.position.y, rig.position.z, rig.distanceToTether]
    })

    const [at30, at60, at120] = sampled as [number[], number[], number[]]
    for (let i = 0; i < at30.length; i += 1) {
      expect(at60[i]!).toBeCloseTo(at30[i]!, 6)
      expect(at120[i]!).toBeCloseTo(at30[i]!, 6)
    }
  })

  it('holds the same path at 30, 60 and 120 fps while the distance-limit spring runs', () => {
    // The other checks never leave the tether's distance limits, so they never engage the spring
    // that PRD 5.7.1's limits are applied through. A hand-over mid-flight does: it lands the camera
    // well outside the destination's `maxDistance` and lets the spring pull it back in over the
    // following seconds. Integrating that acceleration per frame — `rate += excess · k · dt` — put
    // 0.022 units between 30 and 120 fps here, two decimal places short of what this asserts.
    const sampled = RATES.map((fps) => {
      const rig = new CameraRig(planes)
      const target = rig.framing.plane(emptyTether(), planeNamed('ravnica'))
      rig.fly([{ tether: target, durationS: 3, holdS: 0 }], () => {})
      step((dt) => {
        rig.update(dt)
      }, fps, 0.6)
      rig.handOver()
      // The spring is what is being measured, so fail loudly if the setup stopped engaging it.
      expect(rig.distanceToTether).toBeGreaterThan(target.maxDistance)
      step((dt) => {
        rig.update(dt)
      }, fps, ELAPSED_S)
      expect(rig.distanceToTether).toBeGreaterThan(target.maxDistance)
      return [rig.position.x, rig.position.y, rig.position.z, rig.distanceToTether]
    })

    const [at30, at60, at120] = sampled as [number[], number[], number[]]
    for (let i = 0; i < at30.length; i += 1) {
      expect(at60[i]!).toBeCloseTo(at30[i]!, 6)
      expect(at120[i]!).toBeCloseTo(at30[i]!, 6)
    }
  })

  it('coasts the same distance after a drag at 30, 60 and 120 fps', () => {
    // Inertia is the classic place a rig stops being frame-rate independent: `angle += rate * dt`
    // with `rate *= decay` is a Riemann sum. `decayIntegral` integrates it exactly instead.
    const sampled = RATES.map((fps) => {
      const rig = new CameraRig(planes)
      rig.orbitBy(0.2, 0, 1.4, 0.3)
      step((dt) => {
        rig.update(dt)
      }, fps, 2)
      return rig.currentAzimuth
    })
    const [at30, at60, at120] = sampled as [number, number, number]
    expect(at60).toBeCloseTo(at30, 9)
    expect(at120).toBeCloseTo(at30, 9)
  })

  it('freezes every motion under reduced motion (PRD 5.9)', () => {
    const motion = new SceneMotion(planes, { reducedMotion: true })
    const before = vec()
    const after = vec()
    const plane = planeNamed('dominaria')
    motion.starPosition(before, plane, 0.5, 0, 0.5)
    step((dt) => {
      motion.advance(dt)
    }, 60, 30)
    motion.starPosition(after, plane, 0.5, 0, 0.5)
    expect(distance(before, after)).toBe(0)
    expect(motion.time).toBe(0)
  })
})

describe('the tethered orbit (PRD 5.7.1)', () => {
  it('keeps the camera inside the level distance limits', () => {
    const rig = new CameraRig(planes)
    const tether = rig.framing.plane(emptyTether(), planeNamed('ravnica'))
    rig.snapTo({ tether, durationS: 0, holdS: 0 })

    // PRD 6.1.1 zooms "within the focus's distance limits", so input is clamped hard.
    rig.zoomBy(0.05)
    expect(rig.distanceToTether).toBe(tether.minDistance)
    rig.zoomBy(40)
    expect(rig.distanceToTether).toBe(tether.maxDistance)

    // And it stays inside them frame after frame.
    step((dt) => {
      rig.update(dt)
    }, 60, 3)
    expect(rig.distanceToTether).toBeGreaterThanOrEqual(tether.minDistance - 1e-6)
    expect(rig.distanceToTether).toBeLessThanOrEqual(tether.maxDistance + 1e-6)
  })

  it('eases back inside the limits after a hand-over instead of snapping', () => {
    // A hand-over mid-flight lands the camera far outside the destination's limits. PRD 5.7.3
    // forbids a jump, so the return is a force, not a correction — and it does arrive.
    const rig = new CameraRig(planes)
    const target = rig.framing.plane(emptyTether(), planeNamed('ravnica'))
    rig.fly([{ tether: target, durationS: 3, holdS: 0 }], () => {})
    step((dt) => {
      rig.update(dt)
    }, 60, 0.6)
    rig.handOver()
    expect(rig.distanceToTether).toBeGreaterThan(target.maxDistance)

    let previous = vec(rig.position.x, rig.position.y, rig.position.z)
    let worstStep = 0
    for (let i = 0; i < 60 * 12; i += 1) {
      rig.update(1 / 60)
      worstStep = Math.max(worstStep, distance(previous, rig.position))
      previous = vec(rig.position.x, rig.position.y, rig.position.z)
    }
    // No frame moves the camera more than a fly-to would have.
    expect(worstStep).toBeLessThan(rig.framing.multiverseRadius * 0.05)
    expect(rig.distanceToTether).toBeLessThan(target.maxDistance * 1.02)
  })

  it('never lets the camera enter a galaxy disc (PRD 5.7.5)', () => {
    // A cross-multiverse flight between two planes on opposite rims: the straight line between
    // them goes through the middle of the disc, where the other 80 planes are.
    const rig = new CameraRig(planes)
    const from = rig.framing.plane(emptyTether(), planeNamed('ravnica'))
    rig.snapTo({ tether: from, durationS: 0, holdS: 0 })
    rig.fly(
      [{ tether: rig.framing.plane(emptyTether(), planeNamed('zendikar')), durationS: 3, holdS: 0 }],
      () => {},
    )

    const centre: MutVec3 = vec()
    let worstPenetration = 0
    for (let i = 0; i < 60 * 4; i += 1) {
      rig.update(1 / 60)
      for (const plane of planes.planes) {
        if (plane.slug === BLIND_ETERNITIES_SLUG) continue
        if (plane.index === rig.currentTether.planeIndex) continue
        rig.motion.planePosition(centre, plane)
        const gap = plane.radius * CLEARANCE_FACTOR - distance(rig.position, centre)
        if (gap > worstPenetration) worstPenetration = gap
      }
    }
    expect(worstPenetration).toBeLessThan(1e-6)
  })
})

describe('fly-to hand-over (PRD 5.7.3, 7.3.6)', () => {
  it('is continuous in position', () => {
    const rig = new CameraRig(planes)
    rig.fly(
      [{ tether: rig.framing.plane(emptyTether(), planeNamed('ravnica')), durationS: 3, holdS: 0 }],
      () => {},
    )
    step((dt) => {
      rig.update(dt)
    }, 60, 1.2)

    const before = vec(rig.position.x, rig.position.y, rig.position.z)
    rig.handOver()
    // Not "close to": the rebase re-derives the spherical pose *from* this position, so the camera
    // has not moved at all. A jump here is the one thing PRD 5.7.3 names.
    expect(distance(before, rig.position)).toBeLessThan(1e-9)
  })

  it('is continuous in velocity', () => {
    const dt = 1 / 240
    const measure = (handOverMidway: boolean): MutVec3 => {
      const rig = new CameraRig(planes)
      rig.fly(
        [
          {
            tether: rig.framing.plane(emptyTether(), planeNamed('ravnica')),
            durationS: 3,
            holdS: 0,
          },
        ],
        () => {},
      )
      step((d) => {
        rig.update(d)
      }, 240, 1.2)
      const a = vec(rig.position.x, rig.position.y, rig.position.z)
      if (handOverMidway) rig.handOver()
      rig.update(dt)
      return vec((rig.position.x - a.x) / dt, (rig.position.y - a.y) / dt, (rig.position.z - a.z) / dt)
    }

    const flying = measure(false)
    const handed = measure(true)
    const speed = Math.hypot(flying.x, flying.y, flying.z)
    expect(speed).toBeGreaterThan(1) // the tween really is moving at this point
    // The orbit picks the tween's velocity up and then starts bleeding it off, so the two agree to
    // within one frame of damping rather than exactly.
    expect(distance(flying, handed) / speed).toBeLessThan(0.05)
  })

  it('leaves the camera tethered to the destination, not the origin', () => {
    const rig = new CameraRig(planes)
    const target = planeNamed('kaldheim')
    rig.fly(
      [{ tether: rig.framing.plane(emptyTether(), target), durationS: 3, holdS: 0 }],
      () => {},
    )
    step((dt) => {
      rig.update(dt)
    }, 60, 0.5)
    rig.handOver()
    // PRD 5.7.3 hands over control; it does not undo the navigation.
    expect(rig.currentTether.planeIndex).toBe(target.index)
  })
})

describe('the two-stage card fly-to (PRD 6.2.3)', () => {
  it('frames the plane, holds, then closes on the card, within the 3.5 s cap', () => {
    const rig = new CameraRig(planes)
    const plane = planeNamed('innistrad')
    const planeTether = rig.framing.plane(emptyTether(), plane)
    const cardTether = rig.framing.card(emptyTether(), plane, vec(0.6, 0.02, 0.3))

    let status = ''
    const flyS = (TWO_STAGE_CAP_MS - 400) / 1000
    rig.fly(
      [
        { tether: planeTether, durationS: flyS * 0.55, holdS: 0 },
        { tether: cardTether, durationS: flyS * 0.45, holdS: 0.4 },
      ],
      (s) => {
        status = s
      },
    )

    // At the end of stage one plus the hold, the camera is framing the *plane*.
    step((dt) => {
      rig.update(dt)
    }, 120, flyS * 0.55 + 0.2)
    expect(rig.currentTether.planeIndex).toBe(plane.index)
    // Further out than the *card* it is about to close on, which is what "framing the plane" means
    // here. Compared against the card tether's own framing distance rather than its `maxDistance`:
    // contract v3's radius law (worlds spec §1.3) is `0.126*sqrt(N)` with no `r_min`, so a fixture
    // plane is up to 5.5x smaller than under PRD 5.3.2's `log N` and framing one now sits *inside*
    // `cardTether.maxDistance` — which made the old bound a statement about the radius law rather
    // than about the two stages being distinct.
    const framedPlane = rig.distanceToTether
    expect(framedPlane).toBeGreaterThan(cardTether.minDistance)

    step((dt) => {
      rig.update(dt)
    }, 120, flyS * 0.45 + 0.3)
    expect(status).toBe('completed')
    expect(rig.currentTether.kind).toBe('card')
    expect(rig.distanceToTether).toBeCloseTo(cardTether.frameDistance, 3)
  })
})

describe('attract mode (PRD 5.3.22-23)', () => {
  it('drifts between planes and never reaches card level', () => {
    const rig = new CameraRig(planes)
    const director = new AttractDirector(rig, rig.framing, { seed: 7 })
    director.start()

    const visited = new Set<number>()
    let closest = Number.POSITIVE_INFINITY
    for (let i = 0; i < 60 * 90; i += 1) {
      rig.update(1 / 60)
      visited.add(rig.currentTether.planeIndex)
      closest = Math.min(closest, rig.distanceToTether)
      expect(rig.currentTether.kind).not.toBe('card')
    }
    // 90 seconds is several stops, including at least one of PRD 5.3.22's dips.
    expect(visited.size).toBeGreaterThan(2)
    expect(closest).toBeLessThan(rig.framing.multiverseRadius)
  })

  it('gives control back without a jump (PRD 5.3.23)', () => {
    const rig = new CameraRig(planes)
    const director = new AttractDirector(rig, rig.framing, { seed: 3 })
    director.start()
    step((dt) => {
      rig.update(dt)
    }, 60, 5)

    const before = vec(rig.position.x, rig.position.y, rig.position.z)
    director.stop()
    rig.handOver()
    expect(distance(before, rig.position)).toBeLessThan(1e-9)

    // And the following second is a drift, not a snap back to a legal distance.
    let worstStep = 0
    let previous = vec(rig.position.x, rig.position.y, rig.position.z)
    for (let i = 0; i < 60; i += 1) {
      rig.update(1 / 60)
      worstStep = Math.max(worstStep, distance(previous, rig.position))
      previous = vec(rig.position.x, rig.position.y, rig.position.z)
    }
    expect(worstStep).toBeLessThan(rig.framing.multiverseRadius * 0.1)
  })
})
