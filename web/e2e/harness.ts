/**
 * What every spec in `e2e/` needs before it can assert anything: a page that reports its own
 * problems, and a way to know the scene finished loading.
 *
 * Both lived in `routes.spec.ts` until DEC-708 ported `verify-browser.mjs`'s accessibility and CSP
 * checklist into `a11y.spec.ts` (review T3). Two specs driving the same shell should agree on what
 * "the page is ready" and "the page complained" mean, so they share one definition rather than
 * drifting apart.
 */

import { expect, test as base } from '@playwright/test'

/**
 * Everything the page complained about while a test ran, asserted empty when it ends.
 *
 * Filtered exactly as `verify-browser.mjs` filtered it, and for the same two reasons. A bare
 * `Failed to load resource` is the console's blind duplicate of a 404 the response listener reports
 * with a URL, so counting both would double every miss. And Scryfall image requests are *expected*
 * to fail against the fixtures CI builds — the ids are synthetic — which is PRD 7.4.2's path, not a
 * defect: the assertion that matters there is that nothing renders as a broken rectangle, and that
 * is a visual judgement this suite does not make.
 */
export const test = base.extend<{ problems: string[] }>({
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

export { expect } from '@playwright/test'

/**
 * Wait until the shell is past PRD 8.7's loading order and the field is complete.
 *
 * Both signals are the page's own, not sleeps. The Random control is disabled until `search.json`
 * and `sets.bin` can answer it (PRD 6.9). `.hud-loading` is the "N of M stars" line, which the HUD
 * renders exactly while the manifest is in and `stars.bin` is not — so once the manifest has landed,
 * its absence *is* the streamed field being complete (PRD 6.8.1, 8.7.3).
 */
export async function waitForScene(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('button[aria-label="Random card"]')).toBeEnabled({ timeout: 120_000 })
  await expect(page.locator('.hud-loading')).toHaveCount(0, { timeout: 120_000 })
}
