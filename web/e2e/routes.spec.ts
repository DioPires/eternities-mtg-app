/**
 * PRD 8.9.2's route smoke.
 *
 * > a Playwright smoke test that loads each route kind (`/`, a plane, the Blind Eternities, a card,
 * > a filtered route) and asserts the canvas renders and the HUD shows the expected breadcrumb.
 *
 * Five route kinds, five tests. That is deliberately the whole scope: `scripts/verify-browser.mjs`
 * walks the shell end to end on a real GPU and owns everything richer than this — panels, search,
 * history, the WebGL2 fallback page, the accessibility checklist. What this adds is that the five
 * kinds keep working **in CI, on every pull request**, which the local browser check cannot do.
 *
 * **What "the canvas renders" can mean on a software rasteriser.** It means the page built a live
 * WebGL2 context with a non-zero drawing buffer, over a scene whose star field finished streaming.
 * It does not mean any particular pixel is any particular colour: reading pixels back needs
 * `preserveDrawingBuffer`, which the scene only turns on for `?probe=1`, and judging them is visual
 * regression, which PRD 8.9.3 puts out of scope for v1. Pixels are `verify-browser.mjs`'s job on a
 * real GPU and the owner's at PRD 9.3.
 *
 * The star-field check is the part worth having. A route that served its HTML, mounted React and
 * decoded nothing passes every WebGL assertion above and shows an empty sky; it does not get past
 * "`stars.bin` finished".
 */

import { expect, test as base, type Page } from '@playwright/test'

import { routeTargets } from './dataset'

const targets = routeTargets()

/**
 * Everything the page complained about while a test ran, asserted empty when it ends.
 *
 * Filtered exactly as `verify-browser.mjs` filters it, and for the same two reasons. A bare
 * `Failed to load resource` is the console's blind duplicate of a 404 the response listener reports
 * with a URL, so counting both would double every miss. And Scryfall image requests are *expected*
 * to fail against the fixtures CI builds — the ids are synthetic — which is PRD 7.4.2's path, not a
 * defect: the assertion that matters there is that nothing renders as a broken rectangle, and that
 * is a visual judgement this suite does not make.
 */
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      const upstream = (url: string): boolean => url.includes('scryfall.io')

      page.on('console', (message) => {
        const text = message.text()
        if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
          problems.push(`console error: ${text}`)
        }
      })
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
      page.on('response', (response) => {
        if (response.status() < 400 || upstream(response.url())) return
        problems.push(`HTTP ${response.status()}: ${response.url()}`)
      })
      page.on('requestfailed', (request) => {
        if (upstream(request.url())) return
        problems.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? '?'})`)
      })

      await use(problems)

      expect(problems, 'the page reported problems').toEqual([])
    },
    { auto: true },
  ],
})

/** The HUD's breadcrumb, joined the way PRD 6.3.1 writes it. */
async function breadcrumb(page: Page): Promise<string> {
  const items = await page.locator('nav[aria-label="Breadcrumb"] .crumb').allTextContents()
  return items.map((text) => text.trim()).join(' › ')
}

/**
 * Wait until the shell is past PRD 8.7's loading order and the field is complete.
 *
 * Both signals are the page's own, not sleeps. The Random control is disabled until `search.json`
 * and `sets.bin` can answer it (PRD 6.9). `.hud-loading` is the "N of M stars" line, which the HUD
 * renders exactly while the manifest is in and `stars.bin` is not — so once the manifest has landed,
 * its absence *is* the streamed field being complete (PRD 6.8.1, 8.7.3).
 */
async function waitForScene(page: Page): Promise<void> {
  await expect(page.locator('button[aria-label="Random card"]')).toBeEnabled({ timeout: 120_000 })
  await expect(page.locator('.hud-loading')).toHaveCount(0, { timeout: 120_000 })
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
