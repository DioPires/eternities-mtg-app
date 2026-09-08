/**
 * PRD 9.1.4's forced-degradation check.
 *
 * > adaptive quality verified by forced degradation
 *
 * PRD 8.5.11 specifies the ladder as an ordered list — "pixel ratio cap 1.5 → 1.0, bloom
 * resolution, thumbnail capacity. Geometry and motion are never degraded." Phase 2a built the state
 * machine that decides when to step, and `starfield.test.ts` has tested that decision since. What
 * had never been observed is the other half: that a step *does anything to the frame*. Every rung
 * runs through a different subsystem — the `dpr` prop into react-three-fiber, `resolutionScale`
 * into the bloom's constructor, `setCapacity` into the atlas — and each of those could have been
 * dropped on the floor with the whole unit suite still green.
 *
 * So this pins each tier in turn and reads the effect back off the live renderer, the live bloom
 * passes and the live atlas (`ProbeState.quality`, never `QUALITY_TIERS`).
 *
 * **Rewritten for DEC-692 (T5).** The version this replaces was vacuous in two places and said so
 * about neither:
 *
 *  - it asserted rung 1 as a *delta* ("tier 1's buffer is smaller than tier 0's") while recording
 *    in its own header that the rung had no deterministic writer — the `dpr` prop's value was inert
 *    and `StarScene`'s `setDpr` decided it, so a wrong value in the prop survived the check and a
 *    removed prop was red on only 2 of 3 runs. R2 made the prop the single writer, so the caps are
 *    now asserted as the *exact* drawing buffer each one produces. A prop naming the wrong tier is
 *    a deterministic failure.
 *  - it asserted rung 2 by reading `BloomEffect.resolution`, which with `mipmapBlur` on sizes only
 *    `BloomEffect.renderTarget` — a target nothing samples. The chain the frame actually runs is
 *    `mipmapBlurPass`, and `BloomEffect.setSize` hands it the *full* drawing buffer whatever the
 *    scale says (`postprocessing/build/index.js:3896-3899`). So the old assertion watched a number
 *    move while the frame's cost did not. Both are read here, and the inert one is asserted as
 *    inert against {@link BLOOM_RUNG_KNOWN_INERT} rather than left to look like coverage.
 *
 * **It asserts values where a value is deterministic and deltas where only a delta is.** Tier N and
 * tier N+1 differ in exactly one rung, so the adjacent comparisons still isolate each rung from the
 * ones above it.
 *
 * **Why `deviceScaleFactor: 2`.** The cap is `min(cap, devicePixelRatio)`, so on a ratio-1 display
 * — which is every CI runner — tiers 0 and 1 both render at 1.0 and the first rung is invisible. At
 * 2 the caps come through as themselves.
 *
 * **Still not covered here.** A rung reached by a runtime tier *change* rather than by a pin. R2
 * bound the `dpr` prop to the live tier, so that path now exists, but provoking a sustained frame
 * drop in a software-rendered browser is not a repeatable trigger; `starfield.test.ts` covers the
 * monitor's decision and this covers the wire from a tier to the frame.
 *
 * **Why there is no HUD here.** `?probe=1` selects Phase 3's harness (`App.tsx`'s
 * `sceneRequested`), because the probe seam is that scene's. The harness is the shipped scene plus
 * a status panel — same `StarScene`, same `Effects`, same `CardTier` — so it is the same three
 * rungs. It is `routes.spec.ts` that owns the shell's chrome; nothing about the ladder lives there.
 */

import { expect, test, type Page } from '@playwright/test'

import type { ProbeState } from '../src/scene/probe'
import { QUALITY_TIERS } from '../src/scene/quality/adaptiveQuality'

/** Both because the pixel-ratio rung needs headroom, and small so SwiftShader can fill it. */
const VIEWPORT = { width: 640, height: 360 }
const DEVICE_SCALE = 2
test.use({ deviceScaleFactor: DEVICE_SCALE, viewport: VIEWPORT })

// `window.__eternitiesProbe` is declared globally by `src/scene/probe.ts`, which this imports from.
type Quality = ProbeState['quality']

/**
 * The drawing buffer a pixel-ratio cap must produce, from three's own arithmetic: `setSize` ×
 * `setPixelRatio` floors the product, and R3F resolves the range prop `[0.5, cap]` to
 * `min(max(0.5, devicePixelRatio), cap)`.
 */
function expectedBuffer(cap: number): { width: number; height: number } {
  const ratio = Math.min(Math.max(0.5, DEVICE_SCALE), cap)
  return {
    width: Math.floor(VIEWPORT.width * ratio),
    height: Math.floor(VIEWPORT.height * ratio),
  }
}

/**
 * Load the multiverse with tier `index` pinned and read the ladder's effects back.
 *
 * `motion=1` forces reduced motion *off* whatever the runner prefers, so `motion` below is the
 * exact 1 the shader gets rather than a value that depends on the machine — which is what makes
 * "motion is never degraded" checkable as an equality.
 */
async function pinnedTier(page: Page, index: number): Promise<Quality> {
  await page.goto(`/?probe=1&quality=${index}&motion=1`)
  await waitForField(page)

  const quality = await readQuality(page)
  expect(quality.tier, `tier ${index} did not take`).toBe(TIER_LABELS[index])
  expect(quality.pinned).toBe(index)
  expect(quality.tierIndex).toBe(index)
  return quality
}

/**
 * Wait until `stars.bin` is fully decoded and the composer has sized the bloom.
 *
 * The harness panel's own words for the stream, not a sleep. `starsDrawn` has to be *final* before
 * it can be compared across tiers, or the invariant would be reading the stream's progress rather
 * than the ladder's effect on it. Both bloom sizes are waited for, because the mipmap chain is
 * sized by the same `setSize` and a `null` there would make the rung-2 comparison read as equal.
 */
async function waitForField(page: Page): Promise<void> {
  await expect(page.getByTestId('eternities-status')).toContainText('(complete)', {
    timeout: 120_000,
  })
  // The bloom's render targets are sized on the composer's first render, a frame or two later.
  await expect
    .poll(
      async () => {
        const quality = await readQuality(page)
        return quality.bloom !== null && quality.bloomBlur !== null
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function readQuality(page: Page): Promise<Quality> {
  return page.evaluate(() => {
    const probe = window.__eternitiesProbe
    if (!probe) throw new Error('?probe=1 did not install the probe')
    return probe.state().quality
  })
}

const TIER_LABELS = ['full', 'pixel-ratio', 'bloom', 'thumbnails'] as const

/**
 * Defect R3, asserted rather than skirted: `resolutionScale` does not move the resolution the
 * mipmap blur chain runs at, so rung 2 changes a constructor option and not the frame's cost.
 *
 * When W2.1 replaces the post chain with an owned half-resolution bloom, this flips to `false` and
 * the assertion under it becomes a real inequality. Leaving it out would leave rung 2 looking
 * covered by a number nothing samples, which is what T5 objected to.
 */
const BLOOM_RUNG_KNOWN_INERT = true

test('every rung of the quality ladder lands, and only its own rung (PRD 8.5.11, 9.1.4)', async ({
  page,
}) => {
  const tiers: Quality[] = []
  for (let index = 0; index < TIER_LABELS.length; index += 1) {
    tiers.push(await pinnedTier(page, index))
  }
  const [full, pixelRatio, bloom, thumbnails] = tiers as [Quality, Quality, Quality, Quality]

  // Rung 1 — the pixel-ratio cap, 1.5 → 1.0. Asserted as the exact ratio and the exact drawing
  // buffer each cap produces, at every tier, because the `dpr` range prop is now the only writer.
  for (let index = 0; index < tiers.length; index += 1) {
    const cap = QUALITY_TIERS[index]!.pixelRatioCap
    const quality = tiers[index]!
    expect(quality.pixelRatio, `tier ${index} pixel ratio`).toBeCloseTo(
      Math.min(cap, DEVICE_SCALE),
      5,
    )
    expect(quality.drawingBuffer, `tier ${index} drawing buffer`).toEqual(expectedBuffer(cap))
  }
  // And it is a real shrink at the rung that owns it, held by the two rungs below.
  expect(pixelRatio.drawingBuffer.width).toBeLessThan(full.drawingBuffer.width)
  expect(pixelRatio.drawingBuffer.height).toBeLessThan(full.drawingBuffer.height)

  // Rung 1 also shrinks the post chain, which is the point of it. `BloomEffect.setSize` is handed
  // the drawing buffer and the mipmap pass halves it for its first level, so the target the
  // composite samples tracks the cap — a consequence no assertion here used to reach.
  for (const tier of tiers) {
    expect(tier.bloomBlur, `${tier.tier} blur chain`).toEqual({
      width: Math.round(tier.drawingBuffer.width / 2),
      height: Math.round(tier.drawingBuffer.height / 2),
    })
  }

  // Rung 2 — `resolutionScale` 0.5 → 0.25, with the pixel ratio held at 1.0 so the buffer it is a
  // fraction of has not moved. Both facts are needed: a bloom that shrank only because the frame
  // shrank would not be this rung.
  expect(bloom.pixelRatio).toBeCloseTo(pixelRatio.pixelRatio, 5)
  expect(bloom.drawingBuffer).toEqual(pixelRatio.drawingBuffer)
  expect(bloom.bloom).not.toBeNull()
  expect(pixelRatio.bloom).not.toBeNull()
  // The option reached the effect's constructor: 0.5 → 0.25 of the same buffer. Rounding is why
  // this is a range and not an equality.
  expect(pixelRatio.bloom!.width / bloom.bloom!.width).toBeGreaterThan(1.8)
  expect(pixelRatio.bloom!.width / bloom.bloom!.width).toBeLessThan(2.2)
  if (BLOOM_RUNG_KNOWN_INERT) {
    // ...and did nothing to the chain the frame runs. This is defect R3, not a passing rung.
    expect(bloom.bloomBlur, 'R3: resolutionScale is inert under mipmapBlur').toEqual(
      pixelRatio.bloomBlur,
    )
  } else {
    expect(bloom.bloomBlur!.width).toBeLessThan(pixelRatio.bloomBlur!.width)
  }

  // Rung 3 — the atlas capacity, with the two rungs above it held.
  expect(thumbnails.drawingBuffer).toEqual(bloom.drawingBuffer)
  expect(thumbnails.bloom).toEqual(bloom.bloom)
  expect(thumbnails.bloomBlur).toEqual(bloom.bloomBlur)
  expect(thumbnails.thumbnailCapacity).toBeLessThan(bloom.thumbnailCapacity)
  // ...and nothing below rung 3 touches it.
  expect(bloom.thumbnailCapacity).toBe(full.thumbnailCapacity)
  expect(pixelRatio.thumbnailCapacity).toBe(full.thumbnailCapacity)

  // The structural promise: "geometry and motion are never degraded". Same stars drawn, same
  // `uMotion`, at every rung including the bottom one.
  expect(full.starsDrawn).toBeGreaterThan(0)
  for (const tier of tiers) {
    expect(tier.starsDrawn, `${tier.tier} changed the star count`).toBe(full.starsDrawn)
    expect(tier.motion, `${tier.tier} changed the motion`).toBe(1)
  }
})

test('the monitor judges against the display, not against a constant (DEC-692 R5)', async ({
  page,
}) => {
  // Nothing here asserts a frame budget — a software rasteriser has no representative one. What is
  // checkable is that the band exists, came from a measured refresh interval, and is ordered:
  // absolute thresholds were what made a healthy 60 Hz frame unable to restore and an unhealthy
  // 120 Hz one look fine.
  await page.goto('/?probe=1&motion=1')
  await waitForField(page)
  const quality = await readQuality(page)

  expect(quality.refreshMs).toBeGreaterThan(0)
  // No panel in scope is slower than 60 Hz, and the estimate is capped there.
  expect(quality.refreshMs).toBeLessThanOrEqual(1000 / 60 + 1e-6)
  // A frame that hits the display's cadence exactly must count as headroom, and the two thresholds
  // must not cross — the two ways the shipped constants were wrong.
  expect(quality.restoreMs).toBeGreaterThan(quality.refreshMs)
  expect(quality.degradeMs).toBeGreaterThan(quality.restoreMs)
})

test('an unpinned scene starts at full quality and reports no pin', async ({ page }) => {
  await page.goto('/?probe=1&motion=1')
  await waitForField(page)
  const quality = await readQuality(page)
  expect(quality.pinned).toBeNull()
  expect(quality.tier).toBe('full')
  // The free ladder honours the cap too. This is the case the old `dpr` prop got wrong: with
  // nothing pinned it re-applied tier 0's 1.5 on every render whatever tier the monitor was in.
  expect(quality.drawingBuffer).toEqual(expectedBuffer(QUALITY_TIERS[0]!.pixelRatioCap))
})
