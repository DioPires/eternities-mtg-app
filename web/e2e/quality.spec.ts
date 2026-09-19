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
import { artPoolSize } from '../src/scene/worlds/artPool'
import { composesWorldsRoster } from './dataset'

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

/**
 * How far `ProbeState.multiverseAngle` moved across ten animation frames, in radians.
 *
 * The frames are the point. A reading taken twice off a timer would advance on a page whose loop
 * had stopped entirely, because the angle is a number on the plane table and a stopped loop leaves
 * the last one there — so this waits on `requestAnimationFrame`, which is the same clock the frame
 * runs on. Ten of them, because one frame's step at 60 Hz is a few thousandths of a radian and the
 * reading has to survive a SwiftShader frame rate.
 *
 * Wrapped forward (`% TAU`), because the table wraps: a sweep that crosses the turn during the
 * sample must not read as a negative advance. The consequence to know about is that an exactly
 * frozen angle is the only reading that comes back 0, which is exactly the failure being watched.
 */
async function multiverseAdvance(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const probe = window.__eternitiesProbe
    if (!probe) throw new Error('?probe=1 did not install the probe')
    const nextFrame = async (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const first = probe.state().multiverseAngle
    for (let frame = 0; frame < 10; frame += 1) await nextFrame()
    const TAU = Math.PI * 2
    return (((probe.state().multiverseAngle - first) % TAU) + TAU) % TAU
  })
}

const TIER_LABELS = ['full', 'pixel-ratio', 'bloom', 'art-pool', 'glow'] as const

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
  // Read on the tier's own page, before the next `goto` takes it away — the spin is a live
  // reading, not a field of the snapshot `pinnedTier` returns.
  const advances: number[] = []
  for (let index = 0; index < TIER_LABELS.length; index += 1) {
    tiers.push(await pinnedTier(page, index))
    advances.push(await multiverseAdvance(page))
  }
  const [full, pixelRatio, bloom, cardImagery, glow] = tiers as [
    Quality,
    Quality,
    Quality,
    Quality,
    Quality,
  ]

  // Rung 1 — the pixel-ratio cap, 1.5 → 1.0. Asserted as the exact ratio and the exact drawing
  // buffer each cap produces, at every tier, because the ratio now has deterministic writers: the
  // `dpr` prop is off (`dpr={0}` makes r3f's own writer dead code) and the number is pushed into
  // `gl.setPixelRatio` from `SceneView`'s `onCreated` at boot and from `PixelRatioHost` thereafter.
  //
  // **Under a `?quality=N` pin those two writers are each alone sufficient, so nothing here can
  // distinguish them** (DEC-747). `PixelRatioHost` is the one that matters in production — it is the
  // only writer after boot — and it is pinned in jsdom by `test/platform-dom.test.tsx`, not here.
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

  // Rung 3 — the resident **card-imagery** budget, with the two rungs above it held.
  //
  // Renamed off `thumbnails` by DEC-751: the rung now moves two fields, the atlas capacity here and
  // the worlds art pool asserted in its own test below. That is one *knob* and two fields, which is
  // W4.1's actual ladder invariant (DEC-756) — the two are the same resource on the two datasets, so
  // stepping one without the other would degrade a galaxy page and leave a worlds page untouched.
  // The tier's own label moved with it, and this file's `TIER_LABELS` did not: that staleness is
  // what failed this spec on the first worlds build after the rung landed.
  expect(cardImagery.drawingBuffer).toEqual(bloom.drawingBuffer)
  expect(cardImagery.bloomSource).toEqual(bloom.bloomSource)
  expect(cardImagery.bloomLevels).toBe(bloom.bloomLevels)
  // **The atlas half of this rung retired at the cutover (DEC-752).** It read
  // `cardImagery.thumbnailCapacity < bloom.thumbnailCapacity`, which is unfalsifiable now that the
  // thumbnail tier is gone and the field is a structural 0 at every rung. The rung's *surviving*
  // field is the worlds art pool, and it has its own test below — so the knob is still asserted to
  // move; it is asserted in the one place it still moves.
  //
  // Pinned rather than deleted: 0 at every rung is what the retirement looks like from here, and a
  // capacity that came back to life without this spec noticing is exactly the regression the
  // original assertion existed to catch.
  expect(full.thumbnailCapacity).toBe(0)
  expect(bloom.thumbnailCapacity).toBe(0)
  expect(pixelRatio.thumbnailCapacity).toBe(0)
  expect(cardImagery.thumbnailCapacity).toBe(0)

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
  //
  // **The glow is the worlds rim since the cutover (§1.12 row 4, DEC-752).** The galaxy's plane
  // glow was this rung's other consumer and retired with the star field; `?probe=`'s `glowShader`
  // now reads the rim's live program, and the rim is driven off the same knob.
  expect(glow.glowShader, 'rung 4 draws the cheap rim program').not.toBe(cardImagery.glowShader)
  expect(glow.glowShader).toBe('WorldAtmosphereCheap')
  // ...and every rung above it draws the full one. Both directions, because a spec that only
  // checked the bottom rung would pass on a build where *every* tier drew the cheap glow.
  for (const tier of [full, pixelRatio, bloom, cardImagery]) {
    expect(tier.glowShader, `${tier.tier} must keep the full rim`).toBe('WorldAtmosphere')
  }
  // Rung 4 moves the glow and nothing else: the quantities the rungs above it own are held.
  //
  // The fourth line here was `glow.thumbnailCapacity` against `cardImagery`'s, which is `0 === 0`
  // since the thumbnail tier retired — both sides are pinned to the structural 0 twenty lines
  // above, so it could not fail (DEC-857 item 5). Dropped rather than re-pointed: the pin it would
  // duplicate is already there.
  expect(glow.drawingBuffer).toEqual(cardImagery.drawingBuffer)
  expect(glow.bloomSource).toEqual(cardImagery.bloomSource)
  expect(glow.bloomLevels).toBe(cardImagery.bloomLevels)

  // The structural promise: "geometry and motion are never degraded" (PRD 8.5.11), at every rung
  // including the bottom one.
  //
  // **The motion half used to be true by construction** (DEC-857 R2). It read `tier.motion`, which
  // is `sceneFrame.motionScale`, which is `reducedMotion ? 0 : 1` — and no rung of the ladder
  // writes `reducedMotion`. `applyQualityTier` has six targets and that is not one of them; the
  // only writer is PRD 5.9's setting, which `?motion=1` pins off before any of this runs. So the
  // row asserted `1 === 1` five times: it could not have gone red for a ladder that stopped the
  // multiverse, which is the degradation it existed to catch.
  //
  // What replaced it is the quantity that would actually stop: `ProbeState.multiverseAngle`, the
  // table's own integrated spin, sampled across ten animation frames on each pinned page and
  // required to have moved. A rung that froze the clock, or an `advance` that stopped reaching it,
  // reds this. See {@link multiverseAdvance} for why the reading is a live one.
  for (let index = 0; index < advances.length; index += 1) {
    expect(
      advances[index],
      `${TIER_LABELS[index]} stopped the multiverse: the spin angle did not move across ten frames`,
    ).toBeGreaterThan(0)
  }

  // **`starsDrawn` is the star *data* layer's drawable record count since the cutover** (DEC-752):
  // it reads `StarGeometry.drawCount`, which `useSceneData` still builds, and not a mesh — the mesh
  // that drew those records went with the star field. It is therefore no longer evidence for
  // "geometry is never degraded"; no rung has a writer for it, exactly as none has for the
  // thumbnail capacity above.
  //
  // Pinned rather than deleted, for the same reason that one is: a count that started moving with
  // the tier would be a regression this spec should be the one to see.
  expect(full.starsDrawn, 'the star data layer is loaded, or the pin below is vacuous').toBeGreaterThan(0)
  for (const tier of tiers) {
    expect(tier.starsDrawn, `${tier.tier} changed the star record count`).toBe(full.starsDrawn)
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
  // `starMaxPixels` was the star field's clamped sprite ceiling; the field retired at the cutover
  // (DEC-752), and the key stays at a structural -1 because `ProbeState` publishes it. The worlds
  // belt draws fixed 2 px points, well inside any driver's range.
  expect(state.platform.starMaxPixels).toBe(-1)

  // PRD 8.5.8's atlas is 4096 square, and `MAX_TEXTURE_SIZE` was assumed rather than asked.
  expect(state.platform.maxTextureSize).toBeGreaterThanOrEqual(4096)
  expect(state.platform.atlasAffordable).toBe(true)
  // Queried for W4.4 rather than consumed here; asserted only as "the query returned something",
  // because the WebGL2 minimum is 256 and every context in scope clears PRD 5.6.8's 72.
  expect(state.platform.maxArrayTextureLayers).toBeGreaterThanOrEqual(72)

  // The half-float probe ran, and — this is the wire — its verdict is the format the star buffer
  // was actually built in. Not asserted as `ok: true`: a software rasteriser is allowed to fail it,
  // and the app's job then is to fall back, which is what this equality checks in either direction.
  //
  // **`halfFloatProbeMs` is the draw-and-readback only** (DEC-747 N1). Its clock starts inside
  // `probeHalfFloatAttributes`, so the `getContext('webgl2')` that `bootPositionMode` pays to get
  // the probe a context is outside it — measured at 2.2 ms against the probe's 3.3 ms on an M5 Pro
  // through Chrome 141, so it is a real fraction of the boot cost and not a rounding error. This
  // bound is therefore a **ceiling on the readback**, generous because the e2e runs on a software
  // rasteriser, and it is *not* evidence that review §3.5's ~1 ms budget was met. See the note in
  // `useSceneData.ts` for the end-to-end figure and for why the 68 ms recorded there did not
  // reproduce.
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

/**
 * Rung 5 — the art pool, spec §1.12 (DEC-751).
 *
 * **Relayed from leg G (DEC-752) as a live measurement against main `f049dca`.** Before the rung
 * landed, `setArtLayers` had *zero callers*: the pool sat at `DEFAULT_TIER_ART_LAYERS = 1024` at
 * every tier while §1.12's table claimed it stepped, and this file mentioned neither `pool` nor
 * `layers` — so the rung was inert and nothing anywhere said so. That is the same class of defect
 * as R2's `dpr` prop and R3's `resolutionScale` above, and it is caught the same way: read the
 * effect off the **live pool**, never off `QUALITY_TIERS`.
 *
 * **Asserted against the CLAMPED value, which §1.12 requires and which is not a formality.**
 * `ArtPool` reports `artPoolSize(tierLayers, maxArrayTextureLayers)` — the WebGL2 spec minimum for
 * `MAX_ARRAY_TEXTURE_LAYERS` is 256, so on a spec-minimum device tiers 0-3 all clamp to the same
 * pool and the *requested* number is a number nothing pays. Comparing the request against the
 * report would pass on a driver that ignored the request entirely.
 *
 * **The shipped rung is 1024/1024/1024/128/128, not §1.12's earlier 1024/512/256/128.** Under the
 * clamp above, 1024, 512 and 256 are *the same pool* on W0.1's spec-minimum hardware, so a 512 or
 * 256 rung is inert on exactly the machine the ladder exists to serve — and W4.1's invariant is one
 * real knob per rung. This is also the correction leg G's note asks for: "quality tier 4" and
 * "`?layers=128`" name the same capacity once this rung exists, and tier 3 does too.
 */
test('the art pool steps with the ladder, at the size the driver grants (§1.12)', async ({
  page,
}) => {
  test.skip(
    !composesWorldsRoster(),
    'the art pool is a worlds-dataset object and this build cannot compose a roster — it is ' +
      'missing §2.4 rowCells or swatches.bin, both of which `worldData` requires (DEC-788). Since ' +
      'DEC-796 the fixtures carry a synthetic swatches.bin, so CI\'s ETERNITIES_DATASET=scale ' +
      'build composes and reaches this test; a v2 dataset still cannot. Build with ' +
      'ETERNITIES_DATASET=scale or =worlds to run this.',
  )

  /**
   * Wait for the roster to compose before reading the pool off it (DEC-779 X4).
   *
   * `pinnedTier` waits on the star field and the bloom chain — both galaxy-path readiness signals,
   * neither of which says anything about the worlds roster. `worlds()` is `null` until a surface
   * exists *and* a tick has run, so reading it straight after the field completes is a race the
   * page wins only when the shards happen to land first. It lost that race on this runner and the
   * failure reads as a flake rather than as "the test asked too early".
   *
   * Polled rather than slept, and still a **setup failure and never a skip** when the roster never
   * arrives: a page with no worlds on it must not score this green. That is why the poll ends in
   * the same throw it replaced instead of in a `test.skip`.
   */
  const readPool = async (): Promise<{ layers: number; maxLayers: number }> => {
    await expect
      .poll(async () => page.evaluate(() => window.__eternitiesProbe?.worlds() != null), {
        timeout: 30_000,
        message: 'the worlds roster never composed on this page',
      })
      .toBe(true)

    return page.evaluate(() => {
      const probe = window.__eternitiesProbe
      if (!probe) throw new Error('?probe=1 did not install the probe')
      const worlds = probe.worlds()
      // A setup failure, never a skip: a page with no worlds on it must not score this green.
      if (!worlds) throw new Error('the worlds probe is not installed on this page')
      return {
        layers: worlds.pool.layers,
        maxLayers: probe.state().platform.maxArrayTextureLayers,
      }
    })
  }

  const pools: { layers: number; maxLayers: number }[] = []
  for (let index = 0; index < TIER_LABELS.length; index += 1) {
    await pinnedTier(page, index)
    pools.push(await readPool())
  }

  const maxLayers = pools[0]!.maxLayers
  expect(maxLayers, 'the platform layer never reported MAX_ARRAY_TEXTURE_LAYERS').toBeGreaterThan(0)

  // Every tier reports exactly what the clamp grants for its request.
  for (let index = 0; index < pools.length; index += 1) {
    const requested = QUALITY_TIERS[index]!.artPoolLayers
    expect(pools[index]!.layers, `${TIER_LABELS[index]} pool`).toBe(
      artPoolSize(requested, maxLayers),
    )
  }

  // ...and the rung is not inert *on this runner*. Stated as a precondition with its own message,
  // in the idiom `expectAffordsLevels` sets above: on a driver generous enough that every tier
  // clamps to the same pool, the inequality below would be asserting the clamp rather than the
  // rung, and a future runner change should fail HERE with this explanation rather than quietly
  // hollowing the assertion out.
  const top = artPoolSize(QUALITY_TIERS[0]!.artPoolLayers, maxLayers)
  const bottom = artPoolSize(QUALITY_TIERS[TIER_LABELS.length - 1]!.artPoolLayers, maxLayers)
  expect(
    bottom,
    `a ${maxLayers}-layer driver clamps every tier to ${top}, so this rung is unobservable here`,
  ).toBeLessThan(top)
  expect(pools[pools.length - 1]!.layers).toBeLessThan(pools[0]!.layers)

  // The step is monotonic — a rung that went back *up* on the way down would still satisfy the
  // endpoints above.
  for (let index = 1; index < pools.length; index += 1) {
    expect(pools[index]!.layers, `${TIER_LABELS[index]} must not exceed the tier above`).toBeLessThanOrEqual(
      pools[index - 1]!.layers,
    )
  }
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
