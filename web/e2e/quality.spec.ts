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
 * So this pins each tier in turn and reads the effect back off the live renderer, the live post
 * chain and the live atlas (`ProbeState.quality`, never `QUALITY_TIERS`).
 *
 * **Rewritten for DEC-692 (T5).** The version that replaced was vacuous in two places and said so
 * about neither:
 *
 *  - it asserted rung 1 as a *delta* ("tier 1's buffer is smaller than tier 0's") while recording
 *    in its own header that the rung had no deterministic writer — the `dpr` prop's value was inert
 *    and `StarScene`'s `setDpr` decided it, so a wrong value in the prop survived the check and a
 *    removed prop was red on only 2 of 3 runs. R2 made the prop the single writer, so the caps are
 *    now asserted as the *exact* drawing buffer each one produces. A prop naming the wrong tier is
 *    a deterministic failure.
 *  - it asserted rung 2 by reading `BloomEffect.resolution`, which with `mipmapBlur` on sized only
 *    `BloomEffect.renderTarget` — a target nothing sampled. That was finding R3, and T5 pinned it
 *    as a known-inert rung rather than leaving it looking covered.
 *
 * **Rung 2 is real as of DEC-703 (W2.1).** The two postprocessing packages are gone and
 * `scene/post/PostChain` is the chain, so there is no longer a number the rung sets and a
 * different one the frame pays: `bloomSource` is both. The rung now moves *two* quantities — the
 * source's size and the mip-level count — and both are asserted below, as exact values off the
 * chain's own arithmetic rather than as a tolerance band. `BLOOM_RUNG_KNOWN_INERT` and the
 * two-number `bloom` / `bloomBlur` seam it guarded are deleted with it.
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
 * a status panel — same `StarScene`, same `PostEffects`, same `CardTier` — so it is the same three
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
 * The bloom source a rung must produce: `PostChain.configure`'s own `round(buffer * scale)`.
 *
 * Deliberately *not* a mirror of that method's level clamp as well — see
 * {@link expectAffordsLevels}. This one number is the whole of R3: under the old chain the rung's
 * scale and the size the frame paid were two unrelated values, and here there is one to predict.
 */
function expectedBloomSource(cap: number, bloomScale: number): { width: number; height: number } {
  const buffer = expectedBuffer(cap)
  return {
    width: Math.max(1, Math.round(buffer.width * bloomScale)),
    height: Math.max(1, Math.round(buffer.height * bloomScale)),
  }
}

/**
 * Assert this viewport can actually afford the level count the tier asks for, before asserting the
 * chain honoured it.
 *
 * `configure` clamps levels to what the source can be halved into, so on a small enough buffer
 * every tier would report the same clamped count and the rung-2 level assertion would pass without
 * the rung doing anything. Stating the precondition here means a future viewport change fails
 * *this* line, with this explanation, instead of quietly hollowing out the assertion below it.
 */
function expectAffordsLevels(
  source: { width: number; height: number },
  requested: number,
  label: string,
): void {
  const affordable = 1 + Math.floor(Math.log2(Math.max(1, Math.min(source.width, source.height))))
  expect(
    affordable,
    `${label}: a ${source.width}x${source.height} source affords only ${affordable} levels, so ` +
      `asserting ${requested} would be asserting the clamp — raise VIEWPORT or DEVICE_SCALE`,
  ).toBeGreaterThanOrEqual(requested)
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
 * than the ladder's effect on it. The bloom source is waited for too: it is `null` until the
 * chain's first `configure`, and a `null` would make the rung-2 comparisons read as equal.
 */
async function waitForField(page: Page): Promise<void> {
  await expect(page.getByTestId('eternities-status')).toContainText('(complete)', {
    timeout: 120_000,
  })
  // The chain's targets are allocated on its first frame, a tick or two after the field completes.
  await expect
    .poll(
      async () => {
        const quality = await readQuality(page)
        return quality.bloomSource !== null && quality.bloomLevels > 0
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

const TIER_LABELS = ['full', 'pixel-ratio', 'bloom', 'thumbnails', 'glow'] as const

/**
 * The ladder has exactly this many rungs, asserted before anything else uses `TIER_LABELS`.
 *
 * Without it, adding a tier and forgetting this list would silently shrink the test's coverage to
 * the tiers it still knew about — every assertion below would pass while the new rung went
 * unwatched, which is the failure mode PRD 9.1.4 exists to prevent in the first place.
 */
test('the spec covers every rung the ladder has', () => {
  expect(QUALITY_TIERS).toHaveLength(TIER_LABELS.length)
  expect(QUALITY_TIERS.map((tier) => tier.label)).toEqual([...TIER_LABELS])
})

test('every rung of the quality ladder lands, and only its own rung (PRD 8.5.11, 9.1.4)', async ({
  page,
}) => {
  const tiers: Quality[] = []
  for (let index = 0; index < TIER_LABELS.length; index += 1) {
    tiers.push(await pinnedTier(page, index))
  }
  const [full, pixelRatio, bloom, thumbnails, glow] = tiers as [
    Quality,
    Quality,
    Quality,
    Quality,
    Quality,
  ]

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

  // Rung 1 also shrinks the post chain, which is the point of it: the bloom source is a fraction of
  // the drawing buffer, so a cap that lands drags the whole chain down with it. Asserted at every
  // tier as the exact product, which is a consequence no assertion here used to reach.
  for (let index = 0; index < tiers.length; index += 1) {
    const spec = QUALITY_TIERS[index]!
    const quality = tiers[index]!
    expect(quality.bloomSource, `${quality.tier} bloom source`).toEqual(
      expectedBloomSource(spec.pixelRatioCap, spec.bloomScale),
    )
    // The level count the tier asked for reached the chain — but only assert that where the buffer
    // is big enough for the answer to mean something.
    expectAffordsLevels(quality.bloomSource!, spec.bloomLevels, quality.tier)
    expect(quality.bloomLevels, `${quality.tier} bloom levels`).toBe(spec.bloomLevels)
  }
  expect(pixelRatio.bloomSource!.width).toBeLessThan(full.bloomSource!.width)

  // Rung 2 — the bloom source 0.5 → 0.25 and 8 → 7 levels, with the pixel ratio held at 1.0 so the
  // buffer it is a fraction of has not moved. Both facts are needed: a bloom that shrank only
  // because the frame shrank would not be this rung.
  //
  // This is where R3 was. The assertion used to be that rung 2 changed *nothing* the frame paid
  // for, guarded by a `BLOOM_RUNG_KNOWN_INERT` flag; the chain is owned now, so it is a real
  // inequality in both quantities the blur's cost is made of.
  expect(bloom.pixelRatio).toBeCloseTo(pixelRatio.pixelRatio, 5)
  expect(bloom.drawingBuffer).toEqual(pixelRatio.drawingBuffer)
  expect(bloom.bloomSource!.width, 'R3: the bloom rung shrinks the source the frame pays for')
    .toBeLessThan(pixelRatio.bloomSource!.width)
  expect(bloom.bloomSource!.height).toBeLessThan(pixelRatio.bloomSource!.height)
  // 0.5 → 0.25 of an unmoved buffer, so half in each axis. An equality, not a tolerance band:
  // `expectedBloomSource` above already pinned both sides to the chain's own rounding.
  expect(pixelRatio.bloomSource!.width / bloom.bloomSource!.width).toBeCloseTo(2, 5)
  expect(bloom.bloomLevels, 'the bloom rung drops a mip level').toBeLessThan(pixelRatio.bloomLevels)

  // Rung 3 — the atlas capacity, with the two rungs above it held.
  expect(thumbnails.drawingBuffer).toEqual(bloom.drawingBuffer)
  expect(thumbnails.bloomSource).toEqual(bloom.bloomSource)
  expect(thumbnails.bloomLevels).toBe(bloom.bloomLevels)
  expect(thumbnails.thumbnailCapacity).toBeLessThan(bloom.thumbnailCapacity)
  // ...and nothing below rung 3 touches it.
  expect(bloom.thumbnailCapacity).toBe(full.thumbnailCapacity)
  expect(pixelRatio.thumbnailCapacity).toBe(full.thumbnailCapacity)

  // Rung 4 — the cheap glow program (DEC-739, review §3.5's "new tier 4 cheap glow variant, one
  // tap, no dither").
  //
  // Asserted as the name of the program the **live mesh** is drawn with, not as the tier's `glow`
  // field. That distinction is the point of the whole spec: every rung in this ladder has at some
  // stage reported an intention it did not deliver — the `dpr` prop was inert (R2),
  // `resolutionScale` was inert (R3), the selection mask was inert (R4) — and reading a tier's own
  // description back is how all three stayed hidden. `shaderNames.ts` gives the two glow programs
  // distinct names so that this comparison can exist.
  //
  // A material *swap* rather than a define flip is what makes this observable at all: flipping
  // `defines` on a live material re-links the program on the next draw, which is the several-hundred
  // millisecond first-use stall the boot warm-up exists to remove — so a rung meant to recover
  // frames would cost them.
  expect(glow.glowShader, 'rung 4 draws the cheap glow program').not.toBe(thumbnails.glowShader)
  expect(glow.glowShader).toBe('PlaneGlowCheap')
  // ...and every rung above it draws the full one. Both directions, because a spec that only
  // checked the bottom rung would pass on a build where *every* tier drew the cheap glow.
  for (const tier of [full, pixelRatio, bloom, thumbnails]) {
    expect(tier.glowShader, `${tier.tier} must keep the full glow`).toBe('PlaneGlow')
  }
  // Rung 4 moves the glow and nothing else: the three quantities the rungs above it own are held.
  expect(glow.drawingBuffer).toEqual(thumbnails.drawingBuffer)
  expect(glow.bloomSource).toEqual(thumbnails.bloomSource)
  expect(glow.bloomLevels).toBe(thumbnails.bloomLevels)
  expect(glow.thumbnailCapacity).toBe(thumbnails.thumbnailCapacity)

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

/**
 * The platform layer answered the GPU's questions, and the app acted on the answers (DEC-739,
 * review §3.5 and §3.7).
 *
 * **What this can and cannot assert, stated plainly.** The three capabilities this covers describe
 * a machine the team does not own, and the CI runner is not that machine — so an assertion that
 * `pointSizeMax` is 64 or that the half-float probe failed would be an assertion about the runner,
 * not about the app. What is checkable anywhere is the *relationship* between what the driver said
 * and what the app then did: the sprite ceiling never exceeds the reported range, the position
 * format is the one the probe chose, and the boot warm-up ran. Those are the wires, and a wire that
 * is not connected is exactly the class of defect review §3.7 is a list of.
 */
test('the platform layer asks the GPU and the app acts on the answer (review §3.5, §3.7)', async ({
  page,
}) => {
  await page.goto('/?probe=1&motion=1')
  await waitForField(page)

  /*
   * Wait for the warm-up rather than reading it the instant the field completes.
   *
   * It is asynchronous by construction — `compileAsync` resolves when the driver says the programs
   * are ready — so a bare read is a race that this test lost the first time it ran in a full-suite
   * pass and won when it ran alone. The wait is not a papering-over: "warmed during the 4 s intro"
   * is exactly the claim review §3.5 makes, and a bound of ten seconds from the field completing is
   * a genuine assertion that the warm-up finishes inside the window the intro gives it, on a
   * SwiftShader runner that compiles far slower than any machine in scope.
   */
  await expect
    .poll(
      // `!= null` rather than `!== null`: the optional chain yields `undefined` when the seam is
      // not installed, and `undefined !== null` is `true` — which would have declared the warm-up
      // finished on a page that never had a probe at all.
      async () => page.evaluate(() => window.__eternitiesProbe?.state().programWarmup != null),
      {
        timeout: 10_000,
        message: 'the boot-time program warm-up never completed',
      },
    )
    .toBe(true)

  const state = await page.evaluate(() => {
    const probe = window.__eternitiesProbe
    if (!probe) throw new Error('?probe=1 did not install the probe')
    const snapshot = probe.state()
    return {
      platform: snapshot.platform,
      backingStore: snapshot.backingStore,
      warmup: snapshot.programWarmup,
    }
  })

  // The scene's shaders are GLSL ES 3.0, so anything drawing at all is on WebGL2.
  expect(state.platform.webgl2).toBe(true)

  // `ALIASED_POINT_SIZE_RANGE` was never queried before this (review §3.7's "All" row). The
  // assertion is the *clamp*, not the value: a driver silently clamps `gl_PointSize` and says
  // nothing, so the only observable half is that the app stopped asking for more than it can get.
  expect(state.platform.pointSizeMax).toBeGreaterThanOrEqual(1)
  expect(state.platform.starMaxPixels).toBeGreaterThan(0)
  expect(
    state.platform.starMaxPixels,
    'the star shader must never ask for a sprite larger than the driver will rasterise',
  ).toBeLessThanOrEqual(state.platform.pointSizeMax)

  // PRD 8.5.8's atlas is 4096 square, and `MAX_TEXTURE_SIZE` was assumed rather than asked.
  expect(state.platform.maxTextureSize).toBeGreaterThanOrEqual(4096)
  expect(state.platform.atlasAffordable).toBe(true)
  // Queried for W4.4 rather than consumed here; asserted only as "the query returned something",
  // because the WebGL2 minimum is 256 and every context in scope clears PRD 5.6.8's 72.
  expect(state.platform.maxArrayTextureLayers).toBeGreaterThanOrEqual(72)

  // The half-float probe ran, took roughly the millisecond review §3.5 budgets for it, and — this
  // is the wire — its verdict is the format the star buffer was actually built in. Not asserted as
  // `ok: true`: a software rasteriser is allowed to fail it, and the app's job then is to fall back,
  // which is what this equality checks in either direction.
  expect(state.platform.halfFloatProbeMs).toBeLessThan(50)
  expect(state.platform.positionMode).toBe(
    state.platform.halfFloatProbeOk ? 'float16' : 'float32',
  )

  /*
   * The `device-pixel-content-box` observer fired and reported a box for the canvas.
   *
   * **Deliberately not asserted against `DEVICE_SCALE`, and this is a measured finding rather than
   * a softened assertion.** Under Chromium's device emulation — which is what Playwright's
   * `deviceScaleFactor` is, and what every CI run of this app uses — the canvas reports a
   * `devicePixelContentBoxSize` equal to its *CSS* box while `window.devicePixelRatio` reports 2.
   * The first draft of `PixelRatioHost` derived the ladder's cap from that box; it resolved every
   * tier to 1.0, halved the resolution and made rung 1 unobservable, and this assertion is what
   * caught it. The fix was to take the cap from `devicePixelRatio` — which is what review §3.5
   * specifies to the letter — and leave this box as the *size* signal it is.
   *
   * So what is checkable here is that the observer is wired and reporting a self-consistent box.
   * The cap's correctness is asserted by the drawing-buffer equalities in the rung test above,
   * which read the renderer rather than the observer.
   */
  expect(state.backingStore, 'the ResizeObserver never fired').not.toBeNull()
  expect(state.backingStore!.devicePixelWidth).toBeGreaterThan(0)
  expect(state.backingStore!.devicePixelHeight).toBeGreaterThan(0)
  expect(state.backingStore!.cssWidth).toBe(VIEWPORT.width)
  expect(state.backingStore!.ratio).toBeCloseTo(
    state.backingStore!.devicePixelWidth / state.backingStore!.cssWidth,
    5,
  )
  // Not `toBe(true)`: this records which of the two readings the run was measured under, and a
  // browser without the box would still size correctly through the CSS-pixel path. `true` is what
  // a modern Chromium gives, so a `false` here is worth investigating rather than failing on.
  expect(typeof state.backingStore!.exact).toBe('boolean')

  // The warm-up linked every program without error. A failure here means those programs are back
  // to linking on their first draw — the 322-362 ms stalls DEC-645 measured, in the middle of a
  // navigation.
  expect(state.warmup!.error).toBeNull()
  // At least the fifteen distinct programs the scene builds at boot: three star, two glow, two
  // thumbnail, two card face/edge, two planet, four post. A `>=` rather than an equality because
  // the count is a floor on coverage — but it must be a real floor, or a warm-up that silently
  // found nothing would pass.
  expect(state.warmup!.specs).toBeGreaterThanOrEqual(15)
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
