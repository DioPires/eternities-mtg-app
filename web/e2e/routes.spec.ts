/**
 * PRD 8.9.2's route smoke.
 *
 * > a Playwright smoke test that loads each route kind (`/`, a plane, the Blind Eternities, a card,
 * > a filtered route) and asserts the canvas renders and the HUD shows the expected breadcrumb.
 *
 * Five route kinds, five tests. That is deliberately the whole scope; `a11y.spec.ts` holds Phase 5's
 * accessibility checklist and the CSP/HSTS self-check, which used to live in
 * `scripts/verify-browser.mjs` and moved here when that script was archived (review T3, DEC-708).
 *
 * **What "the canvas renders" can mean on a software rasteriser.** It means the page built a live
 * WebGL2 context with a non-zero drawing buffer, over a scene whose star field finished streaming.
 * It does not mean any particular pixel is any particular colour: reading pixels back needs
 * `preserveDrawingBuffer`, which the scene only turns on for `?probe=1`, and judging them is visual
 * regression, which PRD 8.9.3 puts out of scope for v1. Pixels are `scripts/visual-gate.mjs`'s job
 * on a real GPU and the owner's at PRD 9.3.
 *
 * The star-field check is the part worth having. A route that served its HTML, mounted React and
 * decoded nothing passes every WebGL assertion above and shows an empty sky; it does not get past
 * "`stars.bin` finished".
 */

import { type Page } from '@playwright/test'

import { publishesSwatches } from '../src/data/types'
import { builtDataset, readJson, routeTargets } from './dataset'
import { expect, test, waitForScene } from './harness'

const targets = routeTargets()

/** The HUD's breadcrumb, joined the way PRD 6.3.1 writes it. */
async function breadcrumb(page: Page): Promise<string> {
  const items = await page.locator('nav[aria-label="Breadcrumb"] .crumb').allTextContents()
  return items.map((text) => text.trim()).join(' › ')
}

/** The canvas is live: a WebGL2 context sized to a real drawing buffer. */
async function expectCanvasRenders(page: Page): Promise<void> {
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()

  const state = await canvas.evaluate((node: HTMLCanvasElement) => {
    // `getContext` hands back the context react-three-fiber already created, so this observes the
    // real one rather than opening a second.
    const gl = node.getContext('webgl2')
    return {
      webgl2: gl !== null,
      width: gl?.drawingBufferWidth ?? 0,
      height: gl?.drawingBufferHeight ?? 0,
    }
  })
  expect(state.webgl2, 'the page did not get a WebGL2 context').toBe(true)
  expect(state.width, 'the drawing buffer has no width').toBeGreaterThan(0)
  expect(state.height, 'the drawing buffer has no height').toBeGreaterThan(0)
}

/**
 * How many of the multiverse's plane labels the overlay is actually showing.
 *
 * `PlaneLabels` writes `opacity` on every label every frame — `0` for the ones the solver dropped,
 * the solved value for the rest — so this counts what a viewer would see. It is read from the
 * inline style rather than from `getComputedStyle` because that is where the value is written
 * (PRD 7.3.3 keeps the overlay off the layout path).
 */
async function visiblePlaneLabels(page: Page): Promise<number> {
  return page
    .locator('.labels .label')
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => Number((node as HTMLElement).style.opacity || '0') > 0.01).length,
    )
}

/**
 * The shell's navigation is the *scene's* navigation (PRD 5.4.15, and the whole point of the fold).
 *
 * Every other test in this file passes with `host.attach(scene.api)` deleted, and so does the whole
 * unit suite: the host keeps forwarding to the navigation stub, and the stub implements the entire
 * contract without moving a camera. The breadcrumb resolves, the URL tracks, the canvas gets its
 * context and `stars.bin` completes — over a scene sitting at the multiverse, untouched (DEC-667
 * B2).
 *
 * The discriminator has to be something only the scene's own camera can produce. PRD 5.4.15 —
 * "at plane level and below, the multiverse's plane labels are gone" — is that, and it is a shipped
 * requirement rather than an internal wire: `PlaneLabels` fades them on the *scene rig's* level,
 * which only changes if the rig was told to fly. Measured on production, 1920×1080:
 *
 * | | `/` | `/plane/<slug>` |
 * |---|---|---|
 * | attached (shipped) | 67 of 86 labels shown | **0 of 90** |
 * | `host.attach` deleted | 66 of 86 | **66 of 86** |
 *
 * Both legs are asserted, and that pairing is load-bearing: "no labels at plane level" alone would
 * also pass if the overlay stopped rendering altogether, which is a different defect and not one
 * this test should call navigation.
 *
 * Deliberately not a screenshot difference — the field is in motion on every frame (PRD 5.3.13,
 * 5.3.15), so pixels differ between two captures of the same route.
 */
test('the shell drives the scene: plane labels are gone at plane level', async ({ page }) => {
  await page.goto('/')
  await waitForScene(page)
  await expect
    .poll(() => visiblePlaneLabels(page), {
      message: 'the multiverse shows no plane labels at all, so the check below proves nothing',
    })
    .toBeGreaterThan(0)

  await page.goto(`/plane/${targets.plane.slug}`)
  await waitForScene(page)
  await expect
    .poll(() => visiblePlaneLabels(page), {
      message:
        'plane labels are still lit at plane level — the scene never left the multiverse, so the ' +
        'shell is driving the navigation stub rather than the scene (is `host.attach` still there?)',
    })
    .toBe(0)
})

/**
 * One loader, not one per consumer (PRD 7.2's 3 MB `stars.bin` row).
 *
 * The fold left `app/dataset.ts` as the only thing that fetches the dataset, and `startDatasetLoad`
 * is gone from `src/` entirely. Nothing asserted it (DEC-667 N2): if a second fetch ever
 * reappeared, `stars.bin` would transfer twice — the artefact the intro waits on and the largest
 * row in the budget — and every existing gate would stay green, because `check-budget.mjs` counts
 * bytes on disk, not requests.
 *
 * Exactly-once rather than at-most-twice on purpose. A legitimate re-request only happens after a
 * failure, and the `problems` fixture already fails the test on that, so the two rules agree.
 */
test('the dataset is fetched once, not once per consumer', async ({ page }) => {
  const requested: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.includes('/data/')) requested.push(pathname)
  })

  await page.goto('/')
  await waitForScene(page)

  const counts = new Map<string, number>()
  for (const pathname of requested) counts.set(pathname, (counts.get(pathname) ?? 0) + 1)

  expect(
    [...counts].filter(([, n]) => n > 1),
    'a dataset artefact was transferred more than once — is there a second loader?',
  ).toEqual([])
  // Guards the guard: with no requests at all the check above passes vacuously.
  expect(
    requested.filter((pathname) => pathname.endsWith('stars.bin')),
    'stars.bin was never requested, so the count above proves nothing',
  ).toHaveLength(1)
})

/**
 * `swatches.bin` is asked for **if and only if** the dataset published one (§2.2, DEC-794).
 *
 * This is the call site of `useSceneData`'s swatch gate, and it is the half of DEC-788 that lives
 * in the product. The gate used to be the `rowCells` test alone; both committed fixtures carried
 * `rowCells` and published no `swatches.bin`, so on a fixture build — which is what CI smokes and
 * what a local fixture run serves — every page load fetched a file that cannot exist and ended at
 * `sceneErrors.report('swatches.bin', …)`. Measured on main `4daa6ab`, `ETERNITIES_DATASET=scale`:
 * one request, answered **HTTP 200 `text/html`, 1,358 bytes** by the preview server's SPA fallback,
 * decoded as far as the magic and reported as a broken artefact.
 *
 * **Nothing already here could see that**, which is why it survived. The `problems` fixture watches
 * for console errors and for statuses >= 400; this failure produces neither, because the fallback
 * is a 200 and the loader reports through the toast queue rather than the console. So the
 * assertions are the request count and the toast, directly.
 *
 * **One direction, on every build CI produces — and DEC-796 is what took the other away**
 * (DEC-805 F1, DEC-807). The expectation is derived from the built dataset's own manifest, so the
 * assertion reads whichever way that dataset points. What decides whether it can *fail* is a
 * different question: the defect above is a gate answering from `rowCells` instead of from the
 * manifest, and only a dataset carrying §2.4 geometry with **no** `swatches.bin` makes those two
 * answers differ. Both fixtures were that dataset. DEC-796 gave them a synthetic swatch column so
 * CI's `ETERNITIES_DATASET=scale` build can compose a worlds roster at all (DEC-788, DEC-793), and
 * no checked-out dataset is that shape any more. Measured, one harness against both trees: restore
 * the `rowCells`-only gate and this test **fails on main `a697a93`** (1 failed / 8 passed) and
 * **passes 9/9** here.
 *
 * So what this runs on `scale`, on `small` and on a worlds build is the **fetched** direction:
 * exactly one request, and no complaint about it, which together mean the bytes decoded. The
 * unfetched direction is still *reached* — an unset `ETERNITIES_DATASET` builds v2 `production`,
 * which publishes no swatches — but it no longer *discriminates*, because that dataset carries no
 * `rowCells` either, so the old gate declines the fetch too, for the wrong reason. Do not read the
 * `toHaveLength(0)` branch as a live negative control.
 *
 * The falsifier for the gate's conjunction lives in `web/test/swatch-gate.test.ts` instead, against
 * the named `shouldLoadSwatches` (DEC-807): it strikes each half off a real manifest in turn, which
 * is exactly the separation the corpus can no longer supply. What stays here is the half no unit
 * test can reach — that the product itself issues, or does not issue, the request.
 */
test('swatches.bin is fetched if and only if the dataset published one (§2.2)', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/swatches.bin')) asked.push(request.url())
  })

  await page.goto('/')
  await waitForScene(page)

  // Issued *before* `stars.bin` starts streaming (`useSceneData`), so a scene that is ready has
  // either made this request already or is never going to — there is nothing to wait for here.
  const manifest = readJson<{ files: { path: string }[] }>('data', builtDataset(), 'manifest.json')
  const published = publishesSwatches(manifest)
  expect(
    asked,
    published
      ? `${builtDataset()} publishes swatches.bin and the page did not ask for exactly one — a ` +
          'worlds dataset whose colour never arrives composes no roster at all'
      : `${builtDataset()} publishes no swatches.bin, and the page asked for it anyway — the gate ` +
          'in `useSceneData` is testing something other than the manifest again (DEC-794)',
  ).toHaveLength(published ? 1 : 0)

  // The user-visible half, and unconditional: published or not, no page load should end with the
  // scene complaining about this artefact. Error toasts do not expire (`ui/Toasts.tsx`), so one
  // raised during the load is still on screen here.
  const toasts = await page.locator('.toasts .toast').allTextContents()
  expect(
    toasts.filter((text) => text.includes('swatches.bin')),
    'the page reported a scene error about swatches.bin',
  ).toEqual([])
})

test('/ renders and the breadcrumb reads Multiverse', async ({ page }) => {
  await page.goto('/')
  await waitForScene(page)
  await expectCanvasRenders(page)
  expect(await breadcrumb(page)).toBe('Multiverse')
})

test('a plane route renders and the breadcrumb reaches the plane', async ({ page }) => {
  await page.goto(`/plane/${targets.plane.slug}`)
  await waitForScene(page)
  await expectCanvasRenders(page)
  await expect.poll(() => breadcrumb(page)).toBe(`Multiverse › ${targets.plane.displayName}`)
})

test('the Blind Eternities route renders and the breadcrumb names it', async ({ page }) => {
  await page.goto(`/plane/${targets.blindEternities.slug}`)
  await waitForScene(page)
  await expectCanvasRenders(page)
  await expect
    .poll(() => breadcrumb(page))
    .toBe(`Multiverse › ${targets.blindEternities.displayName}`)
})

test('a card route renders and the breadcrumb reaches the card', async ({ page }) => {
  await page.goto(`/plane/${targets.plane.slug}/card/${targets.card.oracleId}`)
  await waitForScene(page)
  await expectCanvasRenders(page)
  // The card segment's label comes from `search.json`, which loads after the first frame (PRD
  // 8.7.4), so this is the one breadcrumb that genuinely arrives in two steps.
  await expect
    .poll(() => breadcrumb(page))
    .toBe(`Multiverse › ${targets.plane.displayName} › ${targets.card.name}`)
})

/**
 * A card reached from the **URL** gets §1.10's printing ring, not just a breadcrumb (DEC-858).
 *
 * The row above proves the shell agrees the route is a card. It cannot see what the *scene* did
 * with that, and for the whole of the galaxy era and the first week after the cutover the answer was
 * nothing: `focusedStar` was written by `focusStar` alone, so only a click built a card. Measured
 * here, headless, on this exact page — `card` null at t=7/17/27/42 s before the fix, the card and
 * its 72 planets after it.
 *
 * `?probe=shell` and not `?probe=1`: `App` routes the latter to `harness.html`, a page with no
 * router, which parks at the multiverse and can never answer a question about a deep link at all.
 *
 * **What this instrument sees.** SwiftShader draws no representative pixels and nothing here reads
 * one. `ProbeState.card` is `record && card.visible` — which star the ring was built around and how
 * many planets it laid out — so this confirms the ring was *constructed and shown*, and says
 * nothing about how it looks. The visual half is `scripts/visual-gate.mjs` on a real GPU.
 */
test('a card deep link builds the printing ring, not only the breadcrumb (DEC-858)', async ({
  page,
}) => {
  await page.goto(`/plane/${targets.plane.slug}/card/${targets.card.oracleId}?probe=shell`)
  await waitForScene(page)
  await expect
    .poll(() => page.evaluate(() => window.__eternitiesProbe !== undefined), { timeout: 30_000 })
    .toBe(true)

  // The precondition, asserted so a null `card` below cannot be a route that never arrived.
  await expect
    .poll(() => page.evaluate(() => window.__eternitiesProbe?.state().focus ?? null))
    .toBe('card')

  await expect
    .poll(() => page.evaluate(() => window.__eternitiesProbe?.state().card?.name ?? null), {
      timeout: 30_000,
    })
    .toBe(targets.card.name)

  const planets = await page.evaluate(() => window.__eternitiesProbe?.state().card?.planets ?? 0)
  expect(planets, 'PRD 5.6.7: the ring is the planets').toBeGreaterThan(0)
})

test('a filtered route renders, reaches its plane, and shows one chip per facet value', async ({
  page,
}) => {
  await page.goto(`/plane/${targets.plane.slug}?c=W,U&r=rare`)
  await waitForScene(page)
  await expectCanvasRenders(page)
  await expect.poll(() => breadcrumb(page)).toBe(`Multiverse › ${targets.plane.displayName}`)
  // PRD 6.3.2: one chip per active facet value, in the canonical order `route.ts` sorts to.
  await expect(page.locator('.chip .chip-label')).toHaveText(['White', 'Blue', 'Rare'])
})

/**
 * `?probe=shell` keeps the shell and installs the seam in it — the page PRD 9.3 is judged on.
 *
 * `scripts/visual-gate.mjs` captures the visual review against the *shipped composition*, and to do
 * that it needs two things at once: the HUD around the scene, and the probe to drive it with. The
 * scene installs the seam wherever it is mounted, so this is one line of routing in `App.tsx` — and
 * one latch in `SceneView`, which is the part that needs a test.
 *
 * The seam is installed from an effect that re-runs when `planes.json` and the GPU resources land,
 * a second or two after mount. By then PRD 6.7's router has canonicalised the address bar and the
 * flag is *gone from `location.search`* — so a `probeRequested()` read at effect time says no, and
 * `window.__eternitiesProbe` never appears. The harness has no router, which is why `?probe=1` never
 * showed this and why a test that only checks `?probe=1` proves nothing about the shell.
 *
 * Both halves are asserted, because either alone is satisfied by the wrong page: the harness has the
 * probe and no HUD, and a plain `/` has the HUD and no probe.
 */
test('?probe=shell gets the probe and the HUD together, after the router rewrites the URL', async ({
  page,
}) => {
  await page.goto('/?probe=shell')
  await waitForScene(page)
  await expectCanvasRenders(page)

  // The router has canonicalised the flag away by now. That is the state the latch has to survive,
  // so it is asserted rather than assumed — without it this test could pass for the wrong reason.
  await expect.poll(() => page.evaluate(() => location.search)).toBe('')

  await expect
    .poll(() => page.evaluate(() => window.__eternitiesProbe !== undefined), { timeout: 30_000 })
    .toBe(true)
  await expect(page.locator('.hud')).toBeVisible()

  // And it is the shell's scene the seam is holding, not a second one: the probe's own view of the
  // focus agrees with the breadcrumb the HUD is drawing.
  const level = await page.evaluate(() => window.__eternitiesProbe?.state().focus ?? null)
  expect(level).toBe('multiverse')
  expect(await breadcrumb(page)).toBe('Multiverse')
})
