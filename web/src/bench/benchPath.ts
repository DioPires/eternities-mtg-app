/**
 * The scripted camera path the bench flies (PRD 9.1.2, implementation-plan §6).
 *
 * A frame-rate number means nothing without saying where the camera was, so the path is fixed,
 * deterministic and covers the shapes that actually cost something at this phase:
 *
 *   home        the whole disc in frame — every plane, every star, and every nebula quad
 *               overlapping at distance, which is the worst blend cost the scene can produce;
 *   approach    a long fly-in, the case PRD 7.2 budgets separately at p95 ≤ 16.7 ms;
 *   plane       plane level on the largest plane, where point sizes grow and fill rate dominates;
 *   sheet       close enough that stars are approaching the 24 px cross-fade of PRD 5.5.1 — the
 *               worst fill-rate case Phase 2a can produce;
 *   dust        inside the Blind Eternities, where the curl-noise branch runs for every vertex
 *               in view;
 *   sweep       a lateral pass across the multiverse, the attract-mode shape (PRD 5.3.22), and
 *               the one segment that never lets a frame's work repeat.
 *
 * The plane segments are anchored to a real plane, resolved from the roster and **tracked live**:
 * planes drift (PRD 5.3.15) and the multiverse turns (PRD 5.3.13), so a fixed world coordinate
 * would slide off the plane it was chosen to frame over a 31-second run. That is also what PRD
 * 5.7.4 asks of a real fly-to — targets are computed in the destination's rotating local frame.
 *
 * Phase 6 owns the `/bench` route and the cross-browser protocol; this is the local harness
 * implementation-plan §6 asks Phase 2a to bench against.
 */

import type { PlaneRecord } from '../data/types'

/** Which frame a keyframe's numbers are in. */
export type BenchFrame =
  /** Multiples of the multiverse radius, about the origin. */
  | 'multiverse'
  /** Multiples of the anchor plane's radius, about the anchor plane's live centre. */
  | 'plane'
  /** Multiples of the multiverse radius, about the anchor dust point's live position. */
  | 'dust'

export interface BenchKeyframe {
  readonly name: string
  readonly seconds: number
  readonly frame: BenchFrame
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
}

export const BENCH_PATH: readonly BenchKeyframe[] = [
  // PRD 8.6.1: the home camera frames the whole disc at ~30° elevation.
  { name: 'home', seconds: 4, frame: 'multiverse', position: [0, 1.15, 2.0], target: [0, 0, 0] },
  { name: 'approach', seconds: 5, frame: 'plane', position: [0, 1.6, 6.0], target: [0, 0, 0] },
  { name: 'plane', seconds: 4, frame: 'plane', position: [0, 0.55, 1.9], target: [0, 0, 0] },
  { name: 'sheet', seconds: 4, frame: 'plane', position: [0, 0.1, 0.34], target: [0, 0, 0] },
  { name: 'dust', seconds: 4, frame: 'dust', position: [0.06, 0.02, 0.1], target: [0, 0, 0] },
  { name: 'sweep', seconds: 6, frame: 'multiverse', position: [-0.9, 0.35, 0.55], target: [0, 0, 0] },
  {
    name: 'home-return',
    seconds: 4,
    frame: 'multiverse',
    position: [0, 1.15, 2.0],
    target: [0, 0, 0],
  },
]

export const BENCH_DURATION_S = BENCH_PATH.reduce((total, key) => total + key.seconds, 0)

/**
 * When a named segment ends. Parking the camera there is how the visual checks of PRD 9.3 get a
 * reproducible frame to photograph, rather than a screenshot of wherever the path happened to be.
 * Returns `null` for an unknown name.
 */
export function segmentEndTime(name: string): number | null {
  let elapsed = 0
  for (const key of BENCH_PATH) {
    elapsed += key.seconds
    if (key.name === name) return elapsed
  }
  return null
}

/** Ease-in-out, the same curve PRD 5.7.3 specifies for a fly-to. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * The plane the path flies to: the one with the most stars, which is the heaviest single draw and
 * the one a reviewer would look at first. Ties break on slug so the choice is deterministic.
 * The Blind Eternities is excluded — it has no plane level (PRD 5.4.7).
 */
export function anchorPlane(planes: readonly PlaneRecord[]): PlaneRecord | null {
  let best: PlaneRecord | null = null
  for (const plane of planes) {
    if (plane.kind === 'dust' || plane.starCount === 0) continue
    if (
      best === null ||
      plane.starCount > best.starCount ||
      (plane.starCount === best.starCount && plane.slug < best.slug)
    ) {
      best = plane
    }
  }
  return best
}

/** The live world-space anchors the path is expressed against. Filled in per frame by the runner. */
export interface BenchAnchors {
  readonly multiverseRadius: number
  readonly planeRadius: number
  /** The anchor plane's centre, right now. */
  planeX: number
  planeY: number
  planeZ: number
  /** A point inside the dust, right now — the anchor plane's neighbourhood, pulled inward. */
  dustX: number
  dustY: number
  dustZ: number
}

export interface BenchPose {
  segment: string
  px: number
  py: number
  pz: number
  tx: number
  ty: number
  tz: number
}

/** Resolve one keyframe's numbers into world space, given the live anchors. */
function resolve(
  key: BenchKeyframe,
  anchors: BenchAnchors,
  which: 'position' | 'target',
  axis: 0 | 1 | 2,
): number {
  const value = key[which][axis]
  switch (key.frame) {
    case 'multiverse':
      return value * anchors.multiverseRadius
    case 'plane':
      return (
        value * anchors.planeRadius +
        (axis === 0 ? anchors.planeX : axis === 1 ? anchors.planeY : anchors.planeZ)
      )
    case 'dust':
      return (
        value * anchors.multiverseRadius +
        (axis === 0 ? anchors.dustX : axis === 1 ? anchors.dustY : anchors.dustZ)
      )
  }
}

/**
 * Where the camera should be `elapsed` seconds in. Writes into `out` — the bench runs inside the
 * frame loop and allocates nothing there either.
 */
export function benchPose(elapsed: number, anchors: BenchAnchors, out: BenchPose): BenchPose {
  let start = 0
  for (let i = 0; i < BENCH_PATH.length; i += 1) {
    const key = BENCH_PATH[i]!
    if (elapsed <= start + key.seconds || i === BENCH_PATH.length - 1) {
      const previous = BENCH_PATH[Math.max(0, i - 1)]!
      const t = key.seconds <= 0 ? 1 : Math.min(1, Math.max(0, (elapsed - start) / key.seconds))
      const e = easeInOut(t)
      out.segment = key.name
      out.px = lerp(resolve(previous, anchors, 'position', 0), resolve(key, anchors, 'position', 0), e)
      out.py = lerp(resolve(previous, anchors, 'position', 1), resolve(key, anchors, 'position', 1), e)
      out.pz = lerp(resolve(previous, anchors, 'position', 2), resolve(key, anchors, 'position', 2), e)
      out.tx = lerp(resolve(previous, anchors, 'target', 0), resolve(key, anchors, 'target', 0), e)
      out.ty = lerp(resolve(previous, anchors, 'target', 1), resolve(key, anchors, 'target', 1), e)
      out.tz = lerp(resolve(previous, anchors, 'target', 2), resolve(key, anchors, 'target', 2), e)
      return out
    }
    start += key.seconds
  }
  return out
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
