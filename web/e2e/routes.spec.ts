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
