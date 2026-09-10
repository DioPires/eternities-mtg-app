/**
 * PRD 8.9.2's route smoke, PRD 9.1.2's bench smoke and PRD 9.1.4's forced-degradation check, in a
 * real browser, in CI.
 *
 * These are the three checks the PRD asks a scripted browser for; `a11y.spec.ts` adds Phase 5's
 * accessibility checklist and the CSP/HSTS self-check, which DEC-708 moved here out of the
 * archived `verify-browser.mjs`. They run against the **built** site served by `vite preview`,
 * not the dev server: preview sends the production PRD 7.6.1 headers, and a check that passes only
 * under the dev server's relaxed policy has not checked the product. For `a11y.spec.ts` that is
 * not a preference but the whole point — the dev server allows the inline styles the production
 * policy refuses.
 *
 * **`dist/` must exist.** The config does not build, because CI builds once in the `web` job and
 * hands the artefact on (building again would measure a different tree than the one the budget
 * check measured). Locally: `pnpm build` first, or `pnpm test:e2e` which chains it.
 *
 * **On the GPU.** A cloud runner has no representative one, which PRD 9.1.2 says out loud. Chromium
 * is launched with SwiftShader explicitly so WebGL2 is *available* — otherwise every one of these
 * tests would fail for a reason that has nothing to do with the code. What that buys is a check
 * that the scene builds a live WebGL2 context and the shell puts the right breadcrumb over it. It
 * buys nothing about performance, and nothing here asserts a frame budget: PRD 7.2's ceilings are
 * enforced by `pnpm bench` on the reference machine, and `web/bench/baseline-*.json` is the record.
 */

import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.ETERNITIES_E2E_PORT ?? 4173)

/**
 * Which Chromium-family build to drive. `chromium` — Playwright's own pinned build — is the CI
 * default, because a check that gates merges must not change what it runs when someone updates a
 * browser on their laptop.
 *
 * `ETERNITIES_E2E_CHANNEL=chrome` points the same suite at the machine's installed Google Chrome.
 * That is PRD 7.1.2's cross-browser pass, not a convenience: "current Chrome" means the release
 * channel, and Playwright's pinned build is by definition not it.
 */
const CHANNEL = process.env.ETERNITIES_E2E_CHANNEL ?? 'chromium'

export default defineConfig({
  testDir: './e2e',
  // Serial. Every spec drives one WebGL2 context through SwiftShader, and a runner with two
  // software rasterisers competing for the same two cores produces timeouts, not signal.
  workers: 1,
  fullyParallel: false,
  // The bench path is 39 s of wall clock by construction (`benchPath.ts`), plus the dataset load
  // and the software-rendered warm-up. The route specs finish in a fraction of this.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // PRD 7.1.1's reference viewport.
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        // The full browser in `--headless=new`, not Playwright's `headless_shell`. The shell is a
        // separate, smaller binary whose GPU stack is not the browser's, and this suite exists to
        // load a WebGL2 scene — so it runs the browser people actually ship.
        channel: CHANNEL,
        launchOptions: {
          args: [
            '--no-sandbox',
            '--hide-scrollbars',
            // WebGL2 through SwiftShader. Chrome refuses software WebGL without the last flag, and
            // a headless cloud runner has nothing else to offer it.
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],

  webServer: {
    // `--host 127.0.0.1` is load-bearing. Vite's preview server defaults to binding `localhost`,
    // which on macOS resolves to `::1` and leaves nothing listening on IPv4 at all — so a
    // `http://127.0.0.1` baseURL times out waiting for a server that is already up. Pinning the
    // bind is more honest than pinning the resolution order.
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
