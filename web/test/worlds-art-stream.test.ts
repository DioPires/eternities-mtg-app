/**
 * The art stream (spec §1.6): the layer pool, the per-frame adaptive threshold, the selection pass
 * and the five control seams §3.1's acceptance gate drives the renderer through.
 *
 * Everything here is testable without a GL context on purpose, because **the two bugs this module
 * exists to prevent are both invisible on the machine it is written on**: one needs a driver that
 * reports a small `MAX_ARRAY_TEXTURE_LAYERS`, the other needs a fetch to be in flight at the moment
 * a second cell asks for the same key. On this Mac neither bound binds, so an injected-limit test
 * is the only thing that can fail (DEC-739's vacuous-clamp finding), and every clamp assertion
 * below carries a **non-binding control row** — otherwise a pool that always returned zero would
 * score identically to a correct one.
 *
 * §1.6 names two of these as unit tests in so many words: `resident <= layers`, and the
 * `maxLayers = 0` case beside it.
 */

import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'
import { ArtPool, LAYER_RESERVED, artPoolSize } from '../src/scene/worlds/artPool'
import {
  AdaptiveThreshold,
  BASE_THRESHOLD_PX,
  HOLD_BUCKETS,
  ThresholdMemory,
  bucketEdgePx,
  bucketOf,
} from '../src/scene/worlds/adaptiveThreshold'
import { CLIP_BOUND, FACING_CUTOFF, facesCamera, withinFrustum } from '../src/scene/worlds/cellSelection'
import { TIER4_HEIGHTS_PX, TIER4_SHAPE } from './worlds-tier4-heights'
import { readWorldsSeams, shufflePermutation } from '../src/scene/worlds/seams'

/**
 * §1.12's ladder, as the quality tiers state it before any clamp.
 *
 * Read from the shipped ladder rather than transcribed (DEC-751): this file's subject is what the
 * clamp does to the rung, and a local copy of the column measures the copy. The rung moved when
 * §1.12's ladder was reconciled with W4.1's — art pool 1,024 -> 128 at tier 3, once — and a
 * transcription would have gone on asserting the retired column while passing.
 */
const TIERS = QUALITY_TIERS.map((tier) => tier.artPoolLayers)

describe('§1.6 the art-pool clamp', () => {
  it('floors at zero, because maxLayers can BE zero (DEC-749 N1)', () => {
    // W4.1's `capabilities.ts` reports `maxArrayTextureLayers` as 0 — not as a large number — on
    // two reachable paths: a non-WebGL2 context (`webgl2 ? getParameter(...) : 0`) and a context
    // that has been lost, where `numberParameter`'s catch returns its 0 fallback. Without the outer
    // max, `min(tierLayers, 0 - 32)` is -32 layers at EVERY tier: the formula turns the one case
    // the clamp exists to protect into a negative allocation.
    expect(TIERS.map((t) => artPoolSize(t, 0))).toEqual([0, 0, 0, 0, 0])
    expect(Math.min(TIERS[0]!, 0 - 32)).toBe(-32)
    // A pool of 0 is LEGAL — a swatch-only world, which is what §1.4's shading path already
    // degrades to when no cell holds a layer — and is not a black one.
    const pool = new ArtPool(artPoolSize(TIERS[0]!, 0))
    expect(pool.layers).toBe(0)
    expect(pool.reserve(1, 0)).toBeNull()
    expect(pool.report()).toEqual({ layers: 0, resident: 0, reserved: 0, evictions: 0 })
  })

  it('clamps to the real limit, and leaves a slack limit alone', () => {
    // The binding row: WebGL 2's SPECIFICATION MINIMUM is 256, not 1,024. On a device at that
    // minimum, the three top rungs all clamp to 224 — so §1.12's ladder assertion must be written
    // against the value the renderer REPORTS, never against the tier constant. An assertion
    // against the constants passes here and fails on W0.1's hardware.
    //
    // This row is also why the art-pool rung is 1,024 -> 128: under the retired column it read
    // [224, 224, 224, 224, 128], i.e. tier 3 — the rung that *owns* the pool — was the one rung
    // the clamp made inert on the device the clamp exists for.
    expect(TIERS.map((t) => artPoolSize(t, 256))).toEqual([224, 224, 224, 128, 128])
    expect(new Set(TIERS.map((t) => artPoolSize(t, 256))).size).toBe(2)
    // The non-binding control. Without this row an `artPoolSize` that returned 0 unconditionally
    // would pass every assertion above.
    expect(TIERS.map((t) => artPoolSize(t, 2048))).toEqual(TIERS)
    expect(artPoolSize(128, 2048)).toBe(128)
  })
})

describe('§1.6 the three-state LRU', () => {
  it('never lets resident climb past the pool size', () => {
    // The prototype observed 1,031 resident in a 1,024-layer pool; that impossible number is the
    // only tell the two-state bug ever gave. Driven here with far more keys than layers and with
    // fetches deliberately interleaved.
    const pool = new ArtPool(8)
    let frame = 0
    for (let round = 0; round < 40; round += 1) {
      frame += 40 // past the 30-frame grace, so eviction is actually reachable
      for (let key = round; key < round + 12; key += 1) {
        const layer = pool.reserve(key, frame)
        if (layer !== null && key % 3 !== 0) pool.resolve(key)
        expect(pool.resident).toBeLessThanOrEqual(pool.layers)
        expect(pool.resident + pool.reserved).toBeLessThanOrEqual(pool.layers)
      }
    }
    expect(pool.resident).toBeLessThanOrEqual(8)
    expect(pool.evictions).toBeGreaterThan(0) // the instrument saw churn, so the bound was exercised
  })

  it('hands a second asker the SAME layer while a fetch is in flight', () => {
    // Without the third state a layer claimed by an in-flight fetch still reads free, two loads
    // claim it, and one silently overwrites the other.
    const pool = new ArtPool(4)
    const first = pool.reserve(7, 0)
    expect(first).not.toBeNull()
    expect(pool.reserved).toBe(1)
    expect(pool.resident).toBe(0)
    // Still in flight: nothing is resident, and `layerOf` must not claim it is.
    expect(pool.layerOf(7)).toBeNull()
    expect(pool.reserve(7, 0)).toBe(first)
    expect(pool.reserved).toBe(1)
    pool.resolve(7)
    expect(pool.resident).toBe(1)
    expect(pool.reserved).toBe(0)
    expect(pool.layerOf(7)).toBe(first)
  })

  it('never evicts a reserved layer, even under full pressure', () => {
    // Evicting one would leave a fetch in flight whose completion writes over a layer another key
    // now owns — the same silent overwrite, reached from the other direction.
    const pool = new ArtPool(2)
    const held = pool.reserve(1, 0)
    pool.reserve(2, 0)
    expect(pool.reserved).toBe(2)
    // The pool is full of reservations, so a third key gets nothing rather than stealing one.
    expect(pool.reserve(3, 100)).toBeNull()
    expect(pool.reserve(3, 100)).toBeNull()
    pool.resolve(1)
    expect(pool.layerOf(1)).toBe(held)
    expect(pool.evictions).toBe(0)
  })

  it('protects a layer wanted inside the 30-frame grace', () => {
    const pool = new ArtPool(1)
    pool.reserve(1, 0)
    pool.resolve(1)
    // Wanted this frame, so it is not a candidate however much another key would like it.
    pool.want(1, 100)
    expect(pool.reserve(2, 100)).toBeNull()
    expect(pool.evictions).toBe(0)
    // Left alone past the grace window, it becomes evictable. The control for the row above.
    expect(pool.reserve(2, 200)).not.toBeNull()
    expect(pool.evictions).toBe(1)
    expect(pool.layerOf(1)).toBeNull()
  })

  it('never asks for a failed key twice in a session', () => {
    // A key that 404s once would otherwise be re-requested every frame it is on screen — the churn
    // the adaptive threshold exists to remove, reintroduced through the error path.
    const pool = new ArtPool(4)
    pool.reserve(5, 0)
    pool.fail(5)
    expect(pool.hasFailed(5)).toBe(true)
    expect(pool.reserve(5, 1)).toBeNull()
    expect(pool.reserved).toBe(0)
    // ...and the layer went back, rather than being stranded.
    expect(pool.reserve(6, 1)).not.toBeNull()
  })
})

describe('§1.6 the per-frame adaptive threshold', () => {
  it('leaves the threshold at 24 px when capacity covers the demand', () => {
    // The ordinary case away from a surface, and the control that stops "always raise" from
    // scoring as well as the real policy.
    const threshold = new AdaptiveThreshold()
    threshold.begin()
    for (let i = 0; i < 50; i += 1) threshold.offer(30)
    const report = threshold.end(1024, new ThresholdMemory())
    expect(report.effectiveThresholdPx).toBeCloseTo(BASE_THRESHOLD_PX, 9)
    expect(report.wanting).toBe(50)
    expect(report.admitted).toBe(50)
    expect(report.adaptive).toBe(true)
  })

  it('raises the threshold until what the frame asks for fits the pool', () => {
    // The prototype's measured failure at `tether-surface` is 1,024 drawn against 2,759 wanted with
    // 925 evictions: the visible swatch/art boundary in that frame IS the budget being exhausted.
    // The quantile reaches the same picture by design instead.
    //
    // The NAME used to say "the bucket where the running count crosses capacity", which is the §1.6
    // sentence DEC-768 F1 was derived from and is not what this row asserts or what the code does: a
    // `24 + (i % 400)` fill spreads demand over a contiguous run of buckets, so the crossing bucket
    // is never the first non-empty one and the threshold lands on the bucket ABOVE it (DEC-770 N3).
    const threshold = new AdaptiveThreshold()
    threshold.begin()
    for (let i = 0; i < 2759; i += 1) threshold.offer(24 + (i % 400))
    const report = threshold.end(1024, new ThresholdMemory())
    expect(report.wanting).toBe(2759)
    expect(report.effectiveThresholdPx).toBeGreaterThan(BASE_THRESHOLD_PX)
    // The whole point: what the frame asks for now fits in the pool.
    expect(report.admitted).toBeLessThanOrEqual(1024)
    expect(report.admitted).toBeGreaterThan(0)
  })

  it('starves the POLICY, not the resource — a smaller pool is not the control', () => {
    // §1.6 is explicit that shrinking the pool does not work as W4's negative control: the
    // threshold is defined relative to pool capacity, so a smaller pool simply raises the threshold
    // and the criterion passes. This is that statement, measured.
    const offer = (t: AdaptiveThreshold) => {
      t.begin()
      for (let i = 0; i < 3000; i += 1) t.offer(24 + (i % 500))
    }
    const big = new AdaptiveThreshold()
    offer(big)
    const bigReport = big.end(1024, new ThresholdMemory())
    const small = new AdaptiveThreshold()
    offer(small)
    const smallReport = small.end(128, new ThresholdMemory())
    // Starving the resource: the threshold just rises and the demand is trimmed to something the
    // pool can nearly serve. W4 stays GREEN.
    expect(smallReport.effectiveThresholdPx).toBeGreaterThan(bigReport.effectiveThresholdPx)
    expect(bigReport.admitted).toBeLessThanOrEqual(1024)
    // "Nearly", not "exactly": the quantile is a bucket edge, so when the crossing bucket is the
    // topmost non-empty one the frame admits that whole bucket rather than nothing at all (F1, and
    // the block at the bottom of this file). The overshoot is one bucket's own count and nothing
    // more — orders of magnitude off the 3,000 the unstarved policy would ask for.
    expect(smallReport.admitted).toBeLessThan(2 * 128)
    expect(smallReport.admitted).toBeLessThan(bigReport.admitted)

    // Starving the POLICY: `?artThreshold=fixed24` asks for everything over 24 px and lets the pool
    // run out. That is exhaustion, and it is the only thing that falsifies W4.
    const fixed = new AdaptiveThreshold(false)
    offer(fixed)
    const fixedReport = fixed.end(1024, new ThresholdMemory())
    expect(fixedReport.admitted).toBe(3000)
    expect(fixedReport.admitted).toBeGreaterThan(1024)
  })

  it('reports itself engaged, so a seam that fails to parse cannot pass as a control', () => {
    // Without the read-back, a seam that silently fails to parse its own query parameter runs the
    // UNMODIFIED policy, W4 passes, and the matrix records a passing control.
    const fixed = new AdaptiveThreshold(false)
    fixed.begin()
    for (let i = 0; i < 5000; i += 1) fixed.offer(24 + (i % 900))
    const report = fixed.end(64, new ThresholdMemory())
    expect(report.adaptive).toBe(false)
    expect(report.effectiveThresholdPx).toBe(24)

    // Under the quantile the same frame reports a BUCKET EDGE, which is quantised and is not 24
    // except by coincidence — so the gate can tell the two apart.
    const adaptive = new AdaptiveThreshold()
    adaptive.begin()
    for (let i = 0; i < 5000; i += 1) adaptive.offer(24 + (i % 900))
    const quantile = adaptive.end(64, new ThresholdMemory())
    expect(quantile.adaptive).toBe(true)
    expect(quantile.effectiveThresholdPx).not.toBe(24)
  })

  it('buckets geometrically, with bucket 0 exactly on the floor', () => {
    expect(bucketEdgePx(0)).toBeCloseTo(BASE_THRESHOLD_PX, 12)
    expect(bucketOf(23.9)).toBe(-1) // below the floor is not a wanting cell at all
    expect(bucketOf(24)).toBe(0)
    // Constant ratio per step, which is what makes the quantisation error proportional to the
    // threshold. A linear span fine enough to separate 24 from 30 px saturates near a surface.
    const ratio = bucketEdgePx(1) / bucketEdgePx(0)
    for (let i = 1; i < 255; i += 1) {
      expect(bucketEdgePx(i + 1) / bucketEdgePx(i)).toBeCloseTo(ratio, 9)
    }
    // DEC-882 raised the resolution 64 -> 256. The step is the quantile's finest distinction, so
    // these two numbers are what the policy can and cannot separate: ~1.91% per step, not ~7.88%.
    expect(ratio).toBeCloseTo(1.019134, 6)
    expect(bucketOf(1e9)).toBe(255) // saturates rather than indexing out of the histogram
    expect(bucketEdgePx(256)).toBeCloseTo(3072, 6)
  })

  it('is one-sided: raises at once, lowers only past the hold', () => {
    // Raising is immediate because capacity is a hard bound. Lowering waits, so the boundary does
    // not oscillate between two adjacent edges as the camera drifts.
    const threshold = new AdaptiveThreshold()
    // One memory across both runs, because this row is one subject across two frames. Which subject
    // a frame belongs to is now something the caller has to say — see `ThresholdMemory`.
    const memory = new ThresholdMemory()
    const run = (count: number, capacity: number) => {
      threshold.begin()
      for (let i = 0; i < count; i += 1) threshold.offer(24 + (i % 300))
      return threshold.end(capacity, memory)
    }
    const raised = run(3000, 100)
    expect(raised.effectiveThresholdPx).toBeGreaterThan(BASE_THRESHOLD_PX)
    // Demand collapses, but one frame of slack does not drop the threshold all the way back.
    const settled = run(3000, 110)
    expect(settled.effectiveThresholdPx).toBeLessThanOrEqual(raised.effectiveThresholdPx)
  })
})

/**
 * §1.6's two mechanisms at the unit, for the cases the block above cannot reach (DEC-768 F1, F2).
 *
 * F1 needs the crossing bucket to be the **first non-empty** one, which a `24 + (i % N)` fill never
 * produces — it spreads demand over a contiguous run of buckets, so `running` is always positive at
 * the crossing and the discarded bucket is never the only one. F2 needs **two** subjects in one
 * frame, and every row above has exactly one.
 *
 * The histograms below are therefore built a bucket at a time from `bucketEdgePx` rather than from
 * a height fill: each row is about *which bucket* the demand sits in, and a fill says that only by
 * accident.
 */
describe('§1.6 the quantile and its hysteresis (DEC-768 F1, F2)', () => {
  /** Put `count` cells in each named bucket, just above its lower edge. */
  function fill(threshold: AdaptiveThreshold, histogram: Record<number, number>): void {
    threshold.begin()
    for (const [bucket, count] of Object.entries(histogram)) {
      for (let i = 0; i < count; i += 1) threshold.offer(bucketEdgePx(Number(bucket)) * 1.001)
    }
  }

  it('takes the crossing bucket when the bucket above it would admit nothing — F1', () => {
    // The shape DEC-770 N2 recorded for `dominaria` at 2.2 world-radii under tier 4: 922 wanting
    // cells piled into four buckets, the topmost of which (158) alone exceeds the 128-layer pool.
    // Before this row `chosen` was `3 + 1`, `countAtOrAbove(4)` was 0, and the frame admitted
    // NOTHING — 128 layers idle in front of a world asking for art, which is strictly worse than
    // the `fixed24` prototype §1.6 replaces, at the pose §3.1 states W4 at.
    //
    // **The bucket indices are the case, not a pose (DEC-882).** That histogram was recorded on
    // the 64-bucket grid, and at 256 `dominaria` no longer piles into four buckets at this pose —
    // it spreads over dozens and F1 does not fire there at all. What F1 is *for* is the shape
    // below, wherever it occurs, and it still occurs: re-measured across the 90-pose roster sweep,
    // F1 binds at capacity 16 on four poses (`dominaria` 41/16 and 27/16, `innistrad` 19/16,
    // `ravnica` 17/16) and on none at 64, 128 or 224. DEC-882 did not retire the branch; it moved
    // where the branch is reachable, and `worlds-attach.test.ts` carries that measurement.
    const threshold = new AdaptiveThreshold()
    fill(threshold, { 0: 185, 1: 299, 2: 280, 3: 158 })
    const report = threshold.end(128, new ThresholdMemory())

    expect(report.wanting).toBe(922)
    expect(report.admitted, 'the pool must not sit idle in front of demand').toBe(158)
    // §1.6's exception: the crossing bucket ITSELF, because the one above it is empty. Asserted
    // against `bucketEdgePx` rather than a pixel literal — the literal would be a claim about the
    // grid's resolution, which is not what this row is about, and DEC-882 moved it.
    expect(report.effectiveThresholdPx).toBeCloseTo(bucketEdgePx(3), 9)

    // The overshoot is real, and is bounded by that one bucket's own count. It goes to the pool's
    // LRU: a frame that asks for 1.2 pools evicts once; a frame that asks for nothing draws no art.
    expect(report.admitted).toBeGreaterThan(128)
  })

  it('keeps the bucket above the crossing whenever that one does fit — the F1 control', () => {
    // The normal case, unchanged, and the row that stops "always take `index`" scoring as well as
    // the fix: `running` is 60 at the crossing, so bucket 13 both fits and is non-empty, and
    // admitting bucket 12 as well would exceed capacity.
    const threshold = new AdaptiveThreshold()
    fill(threshold, { 12: 60, 13: 60 })
    const report = threshold.end(100, new ThresholdMemory())

    expect(report.wanting).toBe(120)
    expect(report.admitted).toBe(60)
    expect(report.admitted).toBeLessThanOrEqual(100)
    expect(report.effectiveThresholdPx).toBeCloseTo(bucketEdgePx(13), 9)
  })

  it('still admits nothing at zero capacity, which §1.6 makes a legal swatch-only world', () => {
    // The guard on the fix. `?layers=0` and a non-WebGL2 context both produce a real pool of no
    // layers, and "never leave the pool idle" must not turn that into a frame asking for art it has
    // nowhere to put.
    const threshold = new AdaptiveThreshold()
    fill(threshold, { 3: 158 })
    const report = threshold.end(0, new ThresholdMemory())
    expect(report.wanting).toBe(158)
    expect(report.admitted).toBe(0)
  })

  /**
   * A subject whose raw quantile alternates between two adjacent buckets, frame to frame.
   *
   * Frame A crosses in bucket 12 with bucket 13 fitting, so it picks 13. Frame B's extra 100 cells
   * in bucket 11 pull the crossing down one, so it picks 12. Unheld that is `13 12 13 12 …` — the
   * ring of art flickering one cell wide §1.6's hold branch is declared normative to remove.
   */
  const frameA = (t: AdaptiveThreshold, m: ThresholdMemory) => {
    t.begin()
    for (let i = 0; i < 60; i += 1) t.offer(bucketEdgePx(13) * 1.001)
    for (let i = 0; i < 60; i += 1) t.offer(bucketEdgePx(12) * 1.001)
    return t.end(100, m)
  }
  const frameB = (t: AdaptiveThreshold, m: ThresholdMemory) => {
    t.begin()
    for (let i = 0; i < 40; i += 1) t.offer(bucketEdgePx(13) * 1.001)
    for (let i = 0; i < 40; i += 1) t.offer(bucketEdgePx(12) * 1.001)
    for (let i = 0; i < 100; i += 1) t.offer(bucketEdgePx(11) * 1.001)
    return t.end(100, m)
  }
  /** Another world, wanting art well below the subject's boundary. Any of the other 44. */
  const otherWorld = (t: AdaptiveThreshold, m: ThresholdMemory) => {
    t.begin()
    for (let i = 0; i < 300; i += 1) t.offer(bucketEdgePx(2) * 1.001)
    return t.end(100, m)
  }

  const edges = (...buckets: number[]) => buckets.map((b) => bucketEdgePx(b).toFixed(2))

  function sequence(
    t: AdaptiveThreshold,
    subject: () => ThresholdMemory,
    before?: () => void,
  ): string[] {
    const seen: string[] = []
    for (let frame = 0; frame < 6; frame += 1) {
      before?.()
      const report = frame % 2 === 0 ? frameA(t, subject()) : frameB(t, subject())
      seen.push(report.effectiveThresholdPx.toFixed(2))
    }
    return seen
  }

  it('shows the boundary genuinely wobbles, so the hold branch has something to hold', () => {
    // The bound must bind. Run each frame against a FRESH memory — no hysteresis at all — and the
    // two adjacent edges alternate. Without this row the two below are assertions about a boundary
    // that never moved.
    const raw = sequence(new AdaptiveThreshold(), () => new ThresholdMemory())
    expect(raw).toEqual(edges(13, 12, 13, 12, 13, 12))
  })

  it('holds the raised boundary for a lone subject', () => {
    const memory = new ThresholdMemory()
    const held = sequence(new AdaptiveThreshold(), () => memory)
    // Frame 1 raises to 13; frame 2's drop to 12 is within one bucket and is refused, and so is
    // every later one.
    expect(held).toEqual(edges(13, 13, 13, 13, 13, 13))
  })

  it('holds it just the same when another world runs first in the same frame — F2', () => {
    // The finding. With the hysteresis living on the shared `AdaptiveThreshold`, the bucket the
    // hold branch compared against was the PREVIOUS SURFACE's — so any neighbour with a different
    // boundary reset it and the subject fell back to its raw quantile every frame. Against the
    // pre-fix tree these six frames read `64.30 59.61 64.30 59.61 64.30 59.61`, where the row above
    // reads `64.30` throughout. A roster of 45 always has a preceding world, so the hold branch
    // could not fire in the product at all; `worlds-attach.test.ts` runs the same pair on the real
    // roster, where the pre-fix reading is `44.02 47.48 44.02 47.48 …`.
    const threshold = new AdaptiveThreshold()
    const memory = new ThresholdMemory()
    const neighbour = new ThresholdMemory()
    const withNeighbour = sequence(
      threshold,
      () => memory,
      () => otherWorld(threshold, neighbour),
    )
    expect(withNeighbour).toEqual(edges(13, 13, 13, 13, 13, 13))
  })

  it('does not hold a boundary its own demand has left entirely below', () => {
    // The other half of F1, one frame later: the subject raised to bucket 13, then its demand moved
    // to bucket 12 and below. Holding at 13 would admit nothing — the idle pool again — so a hold
    // over an empty tail is refused.
    const threshold = new AdaptiveThreshold()
    const memory = new ThresholdMemory()
    fill(threshold, { 12: 60, 13: 60 })
    expect(threshold.end(100, memory).effectiveThresholdPx).toBeCloseTo(bucketEdgePx(13), 9)

    fill(threshold, { 11: 40, 12: 300 })
    const report = threshold.end(100, memory)
    expect(report.wanting).toBe(340)
    expect(report.admitted, 'nothing sits at or above bucket 13 any more').toBeGreaterThan(0)
    expect(report.effectiveThresholdPx).toBeCloseTo(bucketEdgePx(12), 9)
  })
})

describe('§1.6 the selection pass', () => {
  it('rejects a point behind the eye instead of folding it into the frame', () => {
    // `Vector3.applyMatrix4` already divides by w, so you cannot recover w from `.z` afterwards.
    // The view-space rejection MUST happen before the projection, or a point behind the eye divides
    // by a negative w and folds back into the frame — where it reads as a perfectly ordinary
    // on-screen cell, asks for art, and is never drawn.
    const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000)
    camera.position.set(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const view = camera.matrixWorldInverse
    const projection = camera.projectionMatrix

    expect(withinFrustum(0, 0, -10, view, projection, camera.near)).toBe(true)
    // Directly behind the eye, at the mirror image of a point that passes.
    expect(withinFrustum(0, 0, 10, view, projection, camera.near)).toBe(false)

    // The negative control: the single combined transform everyone writes first ACCEPTS it, which
    // is what makes this worth a test rather than a comment.
    const combined = new Matrix4().multiplyMatrices(projection, view)
    const folded = new Vector3(0, 0, 10).applyMatrix4(combined)
    expect(Math.abs(folded.x) <= CLIP_BOUND && Math.abs(folded.y) <= CLIP_BOUND).toBe(true)
  })

  it('keeps slack at the frame edge, because a cell centre is not a cell', () => {
    const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    // Well outside the frame in x, but inside the deliberately slack clip bound.
    expect(withinFrustum(6, 0, -10, camera.matrixWorldInverse, camera.projectionMatrix, camera.near)).toBe(true)
    expect(withinFrustum(60, 0, -10, camera.matrixWorldInverse, camera.projectionMatrix, camera.near)).toBe(false)
  })

  it('cuts the limb at 0.12 rather than at zero', () => {
    // A cell at the exact limb is edge-on, contributes almost no pixels, and would churn a layer in
    // and out as the world spins.
    expect(facesCamera(1, 0, 0, 1, 0, 0)).toBe(true)
    expect(facesCamera(1, 0, 0, 0, 0, 1)).toBe(false) // exactly edge-on
    const justInside = Math.acos(FACING_CUTOFF) - 1e-6
    expect(facesCamera(1, 0, 0, Math.cos(justInside), 0, Math.sin(justInside))).toBe(true)
    const justOutside = Math.acos(FACING_CUTOFF) + 1e-6
    expect(facesCamera(1, 0, 0, Math.cos(justOutside), 0, Math.sin(justOutside))).toBe(false)
    // Unnormalised input must not change the answer, and a zero vector must not divide by zero.
    expect(facesCamera(1, 0, 0, 500, 0, 0)).toBe(true)
    expect(facesCamera(1, 0, 0, 0, 0, 0)).toBe(false)
  })
})

describe('§3.1 the control seams, which R1 owns and leg G consumes', () => {
  it('parses each seam, and ignores a typo rather than half-engaging', () => {
    expect(readWorldsSeams('')).toEqual({
      swatchMean: false,
      bandsShuffle: false,
      artOff: false,
      artThresholdFixed24: false,
      layersRequested: null,
    })
    expect(readWorldsSeams('?swatch=mean').swatchMean).toBe(true)
    expect(readWorldsSeams('?bands=shuffle').bandsShuffle).toBe(true)
    expect(readWorldsSeams('?art=off').artOff).toBe(true)
    expect(readWorldsSeams('?artThreshold=fixed24').artThresholdFixed24).toBe(true)
    expect(readWorldsSeams('?layers=128').layersRequested).toBe(128)
    // The pair the gate actually runs (DEC-821): `?art=off` composes with the swatch-perturbing
    // seams, and reading one must not set the other.
    expect(readWorldsSeams('?art=off&swatch=mean')).toMatchObject({ artOff: true, swatchMean: true })
    expect(readWorldsSeams('?art=off&bands=shuffle')).toMatchObject({
      artOff: true,
      bandsShuffle: true,
    })
    // A control that half-parses is worse than one that does not parse at all, because the run
    // still produces numbers.
    expect(readWorldsSeams('?swatch=Mean').swatchMean).toBe(false)
    expect(readWorldsSeams('?art=Off').artOff).toBe(false)
    expect(readWorldsSeams('?art=0').artOff).toBe(false)
    expect(readWorldsSeams('?art=').artOff).toBe(false)
    expect(readWorldsSeams('?artThreshold=fixed24').artOff).toBe(false)
    expect(readWorldsSeams('?artThreshold=24').artThresholdFixed24).toBe(false)
    expect(readWorldsSeams('?layers=-8').layersRequested).toBeNull()
    expect(readWorldsSeams('?layers=abc').layersRequested).toBeNull()
    // 0 is meaningful, not absent: §1.6 makes a zero-layer pool a legal swatch-only world, and it
    // is the cheapest way to reach that state on hardware where the limit is slack.
    expect(readWorldsSeams('?layers=0').layersRequested).toBe(0)
  })

  it('keeps ?layers=N separate from ?quality=N', () => {
    // Tier 4 differs from tier 0 in FIVE quantities — pixelRatioCap, bloomScale, bloomLevels,
    // thumbnailCapacity and glow — so routing a pool-size request through the quality ladder would
    // make W4's expected-GREEN row measure four other things at once.
    const seams = readWorldsSeams('?quality=4')
    expect(seams.layersRequested).toBeNull()
    expect(readWorldsSeams('?layers=4&quality=0').layersRequested).toBe(4)
  })

  it('shuffles GLOBALLY, which is the only spelling that falsifies W3', () => {
    // Three spellings of this control are silently green and only the fourth works: relabelling the
    // reported `band` alongside the card, permuting the band-to-colour-class map, and permuting
    // WITHIN a band all leave every band internally uniform, so "the bands are separable" still
    // passes. The distinguishing assertion is that the multiset of swatches inside a single band
    // must CHANGE, which only a global permutation produces.
    const count = 600
    const order = shufflePermutation(count)
    expect(order.length).toBe(count)
    expect(new Set(order).size).toBe(count) // a permutation, not a resampling
    expect(Array.from(order).some((value, index) => value !== index)).toBe(true)

    // Deterministic, because a control whose effect differs between two runs cannot be compared
    // across them, and the gate reruns the shuffled pass against the unshuffled one.
    expect(Array.from(shufflePermutation(count))).toEqual(Array.from(order))
    expect(Array.from(shufflePermutation(count, 12345))).not.toEqual(Array.from(order))

    // The distinguishing property. Bands are contiguous runs of cells; a global permutation moves
    // cards ACROSS those runs, so a band's own multiset changes. A within-band permutation — the
    // silently-green spelling — would leave every one of these identical.
    const bandOf = (cell: number) => Math.floor((cell / count) * 13)
    const before = new Map<number, number[]>()
    const after = new Map<number, number[]>()
    for (let cell = 0; cell < count; cell += 1) {
      before.set(bandOf(cell), [...(before.get(bandOf(cell)) ?? []), cell])
      after.set(bandOf(cell), [...(after.get(bandOf(cell)) ?? []), order[cell]!])
    }
    let changed = 0
    for (const band of before.keys()) {
      const a = [...before.get(band)!].sort((x, y) => x - y).join()
      const b = [...after.get(band)!].sort((x, y) => x - y).join()
      if (a !== b) changed += 1
    }
    expect(changed).toBe(13)
  })

  it('exposes RESERVED as a distinct state the probe can report', () => {
    // §3.1 reads `pool.layers` post-clamp and differences `evictions` across frames; `showingArt`
    // is NOT read off this object, because a cell shows art when its `iArt` cross-fade reaches 1.
    expect(LAYER_RESERVED).toBe(-2)
    const pool = new ArtPool(2)
    pool.reserve(1, 0)
    expect(pool.report()).toEqual({ layers: 2, resident: 0, reserved: 1, evictions: 0 })
    pool.resolve(1)
    expect(pool.report()).toEqual({ layers: 2, resident: 1, reserved: 0, evictions: 0 })
  })
})


/**
 * §1.6's resolution, swept rather than posed (DEC-882).
 *
 * **Why a sweep and not a row at the pose.** The defect DEC-876 found was not that the quantile
 * chose wrongly at `dominaria` 2.2 radii — it chose exactly what §1.6 says, the last bucket that
 * fit. It was that at *that phase of the grid* the only two choices were 16 cells and 291 against a
 * capacity of 128. A row pinned at one pose cannot tell "the policy lands near capacity" from "the
 * policy happens to land near capacity here", and the pose is not a constant: PR #85 moved the
 * arrival colatitude 3.2° and that alone carried the tallest cells over a bucket edge. So the thing
 * to assert is the property across every phase the camera can present, which is what scaling the
 * recorded distribution by one full 64-bucket width does — at the far end the grid has slid exactly
 * one old bucket and the pattern repeats, so this covers the whole period and not a sample of it.
 */
describe('§1.6 lands near capacity at every phase of the grid (DEC-882)', () => {
  const CAPACITY = 128
  /** One full 64-bucket width: the period of the old grid, and so of the whole sweep. */
  const PERIOD = Math.pow(3072 / BASE_THRESHOLD_PX, 1 / 64)
  const STEPS = 80

  /**
   * The band, and where each end comes from — neither is fitted to the measurement.
   *
   * **The ceiling is structural.** The quantile admits the largest at-or-above count that does not
   * exceed capacity, so the only branch that can exceed it is DEC-768 F1, and F1 needs the crossing
   * bucket to be the first non-empty one. This distribution has ~950 cells spread over dozens of
   * buckets, so there is always a non-empty bucket above the crossing and F1 cannot fire. Asserting
   * `<= 1` therefore pins two things at once: that the frame never asks for more pool than exists,
   * and that F1 stays out of a regime it is not for.
   *
   * **The floor is the one bucket the quantile has to give up.** When admitting the crossing bucket
   * would exceed capacity the whole bucket is dropped, so the worst case is `capacity` minus that
   * bucket's own population. Swept over the period, the crossing bucket here holds at most **74**
   * cells, which puts the floor at (128 − 74) / 128 = **0.4219**. 0.40 sits just under that, so the
   * row is a statement about the mechanism's own bound rather than about the number this tree
   * happens to produce — the measured minimum is 0.4609, and a change that merely moved it would
   * not red this row, while one that re-opened the cliff would.
   */
  const FLOOR = 0.4
  const CEILING = 1.0

  /** The fixture is only evidence about the shape it actually has. */
  it('is sweeping the distribution it says it is', () => {
    const sorted = [...TIER4_HEIGHTS_PX].sort((a, b) => b - a)
    expect(TIER4_HEIGHTS_PX).toHaveLength(TIER4_SHAPE.wanting)
    expect(sorted[0]).toBeCloseTo(TIER4_SHAPE.tallestPx, 4)
    expect(sorted[127]).toBeCloseTo(TIER4_SHAPE.capacityRankPx, 4)
    expect(sorted[207]).toBeCloseTo(TIER4_SHAPE.rank208Px, 4)
    expect(sorted.every((h) => h >= BASE_THRESHOLD_PX)).toBe(true)
    // The property that makes this shape the hard case, stated at the height it is measured at —
    // the grid is geometric, so a width taken at the 24 px floor says nothing about 36 px.
    const span = TIER4_SHAPE.capacityRankPx - TIER4_SHAPE.rank208Px
    const step = bucketEdgePx(1) / bucketEdgePx(0) - 1
    const oneBucketHere = TIER4_SHAPE.capacityRankPx * step
    const oneOldBucketHere = TIER4_SHAPE.capacityRankPx * (Math.pow(3072 / BASE_THRESHOLD_PX, 1 / 64) - 1)
    // Eighty cells inside ~1.1 of this grid's steps, and ~0.27 of the old grid's.
    expect(span / oneBucketHere).toBeGreaterThan(1)
    expect(span / oneBucketHere).toBeLessThan(1.5)
    expect(span / oneOldBucketHere).toBeLessThan(0.35)
    expect(
      sorted.filter((h) => h <= TIER4_SHAPE.capacityRankPx && h >= TIER4_SHAPE.capacityRankPx - 0.78),
    ).toHaveLength(TIER4_SHAPE.denseBelowCapacityRank)
  })

  const admittedAt = (factor: number): number => {
    const threshold = new AdaptiveThreshold()
    threshold.begin()
    for (const height of TIER4_HEIGHTS_PX) threshold.offer(height * factor)
    return threshold.end(CAPACITY, new ThresholdMemory()).admitted
  }

  it('keeps admitted/capacity inside the band at every phase of the grid', () => {
    // Every step, not just the extremes: a band that held at both ends and collapsed in the middle
    // is exactly the shape of the defect this replaces.
    const outside: string[] = []
    let lowest = Infinity
    let highest = -Infinity
    for (let step = 0; step < STEPS; step += 1) {
      const factor = Math.pow(PERIOD, step / (STEPS - 1))
      const ratio = admittedAt(factor) / CAPACITY
      lowest = Math.min(lowest, ratio)
      highest = Math.max(highest, ratio)
      if (ratio < FLOOR || ratio > CEILING) outside.push(`${factor.toFixed(5)} -> ${ratio.toFixed(3)}`)
    }
    expect(outside, `factors outside [${FLOOR}, ${CEILING}]`).toEqual([])
    // The band must not be vacuous in the other direction either: if the sweep never came near
    // either end, it would pass against a grid far coarser than this one.
    expect(lowest).toBeLessThan(0.55)
    expect(highest).toBeGreaterThan(0.95)
  })

  /**
   * **The row above scores the raw quantile; the product runs one memory frame to frame (DEC-895).**
   * Each factor above gets a fresh {@link ThresholdMemory}, so the hysteresis never holds anything.
   * This row drives one `AdaptiveThreshold` and one shared memory outward — heights shrinking by
   * {@link OUTWARD_STEP} per frame from factor 1 for {@link OUTWARD_FRAMES} frames, the camera
   * pulling away — which is the direction the one-sided hold acts in.
   *
   * **The band does not hold on this path, and this row does not assert it.** Measured at 0.45% per
   * frame: 40 of 90 frames read under 0.40, and the minimum is **1 admitted of 128** on a frame
   * where the raw quantile admits 63. That is the hold doing its job — a ring one cell too small
   * rather than a flickering one — and what bounds it is asserted instead: the held threshold is
   * never below the raw one, a hold lasts at most {@link HOLD_LIMIT_FRAMES} consecutive frames at
   * this step, the frame never asks for more than capacity, and it never admits nothing while the
   * raw quantile admits something.
   *
   * **The mutant.** Delete the admit-nothing escape in `applyHysteresis`
   * (`countAtOrAbove(previous) === 0`) and this row reds: the longest hold becomes **17** frames and
   * **52** of the 90 admit 0 of 128.
   */
  const OUTWARD_STEP = 0.0045
  const OUTWARD_FRAMES = 90
  /** Measured, then pinned: the longest run of held frames at {@link OUTWARD_STEP}. */
  const HOLD_LIMIT_FRAMES = 4

  it('bounds the hold when one memory walks the sweep outward', () => {
    const threshold = new AdaptiveThreshold()
    const memory = new ThresholdMemory()
    const belowRaw: string[] = []
    const overCapacity: string[] = []
    const idle: string[] = []
    let run = 0
    let longestHold = 0
    let lowest = Infinity
    for (let frame = 0; frame < OUTWARD_FRAMES; frame += 1) {
      const factor = Math.pow(1 - OUTWARD_STEP, frame)
      threshold.begin()
      for (const height of TIER4_HEIGHTS_PX) threshold.offer(height * factor)
      const held = threshold.end(CAPACITY, memory)
      const raw = new AdaptiveThreshold()
      raw.begin()
      for (const height of TIER4_HEIGHTS_PX) raw.offer(height * factor)
      const fresh = raw.end(CAPACITY, new ThresholdMemory())

      const at = `frame ${frame} (${factor.toFixed(4)})`
      if (held.effectiveThresholdPx < fresh.effectiveThresholdPx) belowRaw.push(at)
      if (held.admitted > CAPACITY) overCapacity.push(`${at} -> ${held.admitted}`)
      if (fresh.admitted > 0 && held.admitted === 0) idle.push(at)
      run = held.effectiveThresholdPx > fresh.effectiveThresholdPx ? run + 1 : 0
      longestHold = Math.max(longestHold, run)
      lowest = Math.min(lowest, held.admitted)
    }
    expect(belowRaw, 'held threshold below the raw quantile').toEqual([])
    expect(overCapacity, 'frames asking for more than the pool').toEqual([])
    expect(idle, 'frames admitting nothing while the raw quantile admits something').toEqual([])
    // Pinned exactly, so the row is not vacuous: a sweep that never held would read 0 and red.
    expect(longestHold).toBe(HOLD_LIMIT_FRAMES)
    expect(lowest).toBeGreaterThanOrEqual(1)
  })

  /**
   * **The mutant, and the row's whole reason for existing.** Put `BUCKETS` back to 64 in
   * `adaptiveThreshold.ts` and the row above reds at **57 of these 80 factors** — every factor in
   * 1.0000–1.0096 and in 1.0332–1.0788, reading as low as **0.023** (3 cells of 128) and as high as
   * **2.148** (275 cells). The two green stretches in between are the phases where the old grid
   * happened to have an edge in a usable place, which is precisely why a row pinned at one pose
   * could not see this.
   *
   * This row states the mechanism behind that so the claim is checkable without editing the
   * product: at this distribution's density the old grid's step spans more than a whole pool, so
   * *no* choice of phase can land it near capacity.
   */
  it('shows why 64 buckets could not: one old bucket spans more than the pool', () => {
    const sorted = [...TIER4_HEIGHTS_PX].sort((a, b) => b - a)
    const oldStep = Math.pow(3072 / BASE_THRESHOLD_PX, 1 / 64)
    const step = bucketEdgePx(1) / bucketEdgePx(0)
    const within = (lower: number, ratio: number) =>
      sorted.filter((h) => h >= lower && h < lower * ratio).length

    // Lay one bucket of each grid on the cell a 128-layer pool just holds. The old one contains the
    // **entire pool** — 128 of 128 — so wherever its edges fall, one of them admits at most the
    // cells above the window and the next admits at least those plus a full pool more. There is no
    // edge *inside* the pool to choose, which is the defect in one line.
    expect(within(TIER4_SHAPE.capacityRankPx, oldStep)).toBeGreaterThanOrEqual(CAPACITY)
    // The widest any single old bucket gets over this distribution, for scale.
    expect(Math.max(...sorted.map((h) => within(h, oldStep)))).toBeGreaterThan(2 * CAPACITY)
    // The same window on this grid holds about half a pool, which is the resolution the quantile
    // needs to have a reachable choice near capacity at all.
    expect(within(TIER4_SHAPE.capacityRankPx, step)).toBeLessThan(CAPACITY / 1.5)
    expect(Math.max(...sorted.map((h) => within(h, step)))).toBeLessThan(CAPACITY)
  })
})

/**
 * The hysteresis hold is a **pixel** width, and at this resolution that is more than one bucket
 * (DEC-882 ruling 4).
 */
describe('§1.6 the hold keeps its width in pixels across the resolution raise (DEC-882)', () => {
  const CAPACITY = 100
  /** Put `count` cells just above bucket `index`'s lower edge. */
  const put = (t: AdaptiveThreshold, index: number, count: number) => {
    for (let i = 0; i < count; i += 1) t.offer(bucketEdgePx(index) * 1.001)
  }

  /**
   * Raise the boundary to `bucket`, then present a raw quantile exactly `drop` buckets below it,
   * and return the threshold the hysteresis settles on.
   *
   * Both frames put the crossing mass in the bucket **immediately** below the one they mean to
   * choose, because "the last bucket that fit" is only that bucket when the next one down is what
   * breaks capacity — a gap would hand the quantile a different answer and the row would be about
   * the gap. Frame two keeps cells at `bucket` itself so the `countAtOrAbove(previous) === 0`
   * escape in `applyHysteresis` cannot be what produces a hold.
   */
  function afterDrop(bucket: number, drop: number): number {
    const threshold = new AdaptiveThreshold()
    const memory = new ThresholdMemory()
    threshold.begin()
    put(threshold, bucket, CAPACITY)
    put(threshold, bucket - 1, 2 * CAPACITY)
    expect(threshold.end(CAPACITY, memory).effectiveThresholdPx).toBeCloseTo(bucketEdgePx(bucket), 9)
    expect(memory.bucket).toBe(bucket)

    threshold.begin()
    put(threshold, bucket, 40)
    put(threshold, bucket - drop, CAPACITY - 40)
    put(threshold, bucket - drop - 1, 2 * CAPACITY)
    const report = threshold.end(CAPACITY, memory)
    expect(report.admitted, 'the escape for a boundary with nothing above it must stay shut').toBeGreaterThan(0)
    return report.effectiveThresholdPx
  }

  it('presents the hold with a real drop — the bound must bind', () => {
    // Run the same second frame against a FRESH memory, so there is no hysteresis at all, and the
    // raw quantile really is `drop` buckets down. Without this the rows below could be asserting
    // that a boundary which never moved did not move.
    const raw = new AdaptiveThreshold()
    raw.begin()
    put(raw, 40, 40)
    put(raw, 38, CAPACITY - 40)
    put(raw, 37, 2 * CAPACITY)
    expect(raw.end(CAPACITY, new ThresholdMemory()).effectiveThresholdPx).toBeCloseTo(bucketEdgePx(38), 9)
  })

  it('is four buckets here, because four buckets is what 7.88% spells at 256', () => {
    // Not a literal in the product: `HOLD_FRACTION` is the width DEC-768 F2 measured, and this is
    // whatever the current grid spells it as. Stated here so a future change to `BUCKETS` that
    // forgot the conversion reds rather than quietly quartering the hold.
    expect(HOLD_BUCKETS).toBe(4)
    expect(bucketEdgePx(HOLD_BUCKETS) / bucketEdgePx(0)).toBeCloseTo(
      Math.pow(3072 / BASE_THRESHOLD_PX, 1 / 64),
      9,
    )
  })

  it('holds a two-bucket drop, which a one-bucket hold would release', () => {
    // **Measured on the shipped roster, and the reason the hold is not one bucket here.** Swept
    // over 2.10–2.30 world-radii in 0.005 steps at 224 layers, `zendikar`'s raw quantile moves by
    // **2 buckets** in a single 0.005-radii step at 2.105 → 2.110. A one-bucket hold releases on
    // that and the boundary follows the camera's jitter; this one does not.
    expect(afterDrop(40, 2)).toBeCloseTo(bucketEdgePx(40), 9)
  })

  it('holds a four-bucket drop — the full width, the old grid\'s single step', () => {
    expect(afterDrop(40, HOLD_BUCKETS)).toBeCloseTo(bucketEdgePx(40), 9)
  })

  it('releases once the drop exceeds the hold, so the hold is not simply a freeze', () => {
    // The control. Without it every row above would pass against an `applyHysteresis` that never
    // lowered the boundary at all — which is a ring of art that shrinks and never grows back.
    expect(afterDrop(40, HOLD_BUCKETS + 1)).toBeCloseTo(bucketEdgePx(40 - HOLD_BUCKETS - 1), 9)
  })
})
