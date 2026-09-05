/**
 * PRD 9.1.4's forced-degradation check.
 *
 * > adaptive quality verified by forced degradation
 *
 * PRD 8.5.11 specifies the ladder as an ordered list — "pixel ratio cap 1.5 → 1.0, bloom
 * resolution, thumbnail capacity. Geometry and motion are never degraded." Phase 2a built the state
 * machine that decides when to step, and `starfield.test.ts` has tested that decision since. What
 * had never been observed is the other half: that a step *does anything to the frame*. Every rung
 * runs through a different subsystem — `setDpr` into react-three-fiber, `resolutionScale` into the
 * bloom's constructor, `setCapacity` into the atlas — and each of those could have been dropped on
 * the floor with the whole unit suite still green, because until `?quality=` there was no way to
 * hold a tier still long enough to look at one.
 *
 * So this pins each tier in turn and reads the effect back off the live renderer, the live bloom
 * render target and the live atlas (`ProbeState.quality`, never `QUALITY_TIERS`).
 *
 * **It asserts the deltas, not the values.** Tier N and tier N+1 differ in exactly one rung, so
 * comparing adjacent tiers isolates that rung from the two below it: 0 → 1 moves the pixel ratio
 * with the bloom scale held, 1 → 2 moves the bloom with the pixel ratio held, 2 → 3 moves the
 * capacity with both held. A test that only compared tier 0 against tier 3 would pass with two of
 * the three rungs disconnected.
 *
 * **Why `deviceScaleFactor: 2`.** The cap is applied as `min(cap, devicePixelRatio)`, so on a
 * ratio-1 display — which is every CI runner — tiers 0 and 1 both render at 1.0 and the first rung
 * is invisible. At 2 the caps come through as themselves.
 *
 * **What the first rung's assertion does not cover, measured.** Mutation testing says rungs 2 and
 * 3 are covered — breaking the bloom's `resolutionScale` or the atlas's capacity turns this red,
 * every run. **Rung 1 is not covered, and the word was too generous** (DEC-677 N3). The pixel ratio
 * has one writer that decides it — `StarScene`'s `setDpr`, on mount and on every tier change — and
 * one that merely has to *exist*: the `Canvas` `dpr` prop, whose value is inert and whose presence
 * is what stops R3F managing dpr from its own resize path. `EternitiesScene` records that
 * measurement. Of the two mutants: the prop naming the **wrong tier** survives outright, and the
 * prop being **removed** was red on only 2 of 3 runs (DEC-667 N1). A kill that lands two times in
 * three is a flaky detector, not coverage — a real regression here would ship about a third of the
 * time, and a green run says nothing. Treat rung 1 as unguarded until something deterministic
 * replaces this, and do not cite the 2-of-3 result as protection.
 *
 * A pin never produces a tier *change*, so mutating the `setDpr` inside `quality.subscribe` alone
 * is not caught here either: nothing calls it. Covering that path needs a runtime tier change
 * rather than a pin, which `?quality=` deliberately is not. `starfield.test.ts` covers the
 * monitor's stepping; what is uncovered is the wire from a step to `setDpr`, and it is one line.
 *
 * **Why there is no HUD here.** `?probe=1` selects Phase 3's harness (`App.tsx`'s
 * `sceneRequested`), because the probe seam is that scene's. The harness is the shipped scene plus
 * a status panel — same `StarScene`, same `Effects`, same `CardTier` — so it is the same three
 * rungs. It is `routes.spec.ts` that owns the shell's chrome; nothing about the ladder lives there.
 */

import { expect, test, type Page } from '@playwright/test'

import type { ProbeState } from '../src/scene/probe'

/** Both because the pixel-ratio rung needs headroom, and small so SwiftShader can fill it. */
test.use({ deviceScaleFactor: 2, viewport: { width: 640, height: 360 } })

// `window.__eternitiesProbe` is declared globally by `src/scene/probe.ts`, which this imports from.
type Quality = ProbeState['quality']

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
 * than the ladder's effect on it.
 */
async function waitForField(page: Page): Promise<void> {
  await expect(page.getByTestId('eternities-status')).toContainText('(complete)', {
    timeout: 120_000,
  })
  // The bloom's render target is sized on the composer's first render, a frame or two later.
  await expect
    .poll(async () => (await readQuality(page)).bloom !== null, { timeout: 30_000 })
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

test('every rung of the quality ladder lands, and only its own rung (PRD 8.5.11, 9.1.4)', async ({
  page,
}) => {
  const tiers: Quality[] = []
  for (let index = 0; index < TIER_LABELS.length; index += 1) {
    tiers.push(await pinnedTier(page, index))
  }
  const [full, pixelRatio, bloom, thumbnails] = tiers as [Quality, Quality, Quality, Quality]

  // Rung 1 — the pixel-ratio cap, 1.5 → 1.0, which is the drawing buffer as well as the number.
  expect(full.pixelRatio).toBeCloseTo(1.5, 5)
  expect(pixelRatio.pixelRatio).toBeCloseTo(1.0, 5)
  expect(pixelRatio.drawingBuffer.width).toBeLessThan(full.drawingBuffer.width)
  expect(pixelRatio.drawingBuffer.height).toBeLessThan(full.drawingBuffer.height)

  // Rung 2 — the bloom's render target halves, with the pixel ratio held at 1.0 so that the buffer
  // it is a fraction of has not moved. Both facts are needed: a bloom that shrank only because the
  // frame shrank would not be this rung.
  expect(bloom.pixelRatio).toBeCloseTo(pixelRatio.pixelRatio, 5)
  expect(bloom.drawingBuffer).toEqual(pixelRatio.drawingBuffer)
  expect(bloom.bloom).not.toBeNull()
  expect(pixelRatio.bloom).not.toBeNull()
  expect(bloom.bloom!.width).toBeLessThan(pixelRatio.bloom!.width)
  // 0.5 → 0.25 of the same buffer. Rounding is why this is a range and not an equality.
  expect(pixelRatio.bloom!.width / bloom.bloom!.width).toBeGreaterThan(1.8)
  expect(pixelRatio.bloom!.width / bloom.bloom!.width).toBeLessThan(2.2)

  // Rung 3 — the atlas capacity, with the two rungs above it held.
  expect(thumbnails.drawingBuffer).toEqual(bloom.drawingBuffer)
  expect(thumbnails.bloom).toEqual(bloom.bloom)
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

test('an unpinned scene starts at full quality and reports no pin', async ({ page }) => {
  await page.goto('/?probe=1&motion=1')
  await waitForField(page)
  const quality = await readQuality(page)
  expect(quality.pinned).toBeNull()
  expect(quality.tier).toBe('full')
})
