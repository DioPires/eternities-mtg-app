/**
 * Phase 5's accessibility checklist and the CSP/HSTS self-check, in CI (review T3, DEC-708).
 *
 * These assertions ran only in `scripts/verify-browser.mjs`, which was never in CI or pre-commit
 * and has now been archived under the `review-tooling-2026-09` tag. Review §5.5 T3 rated that S2 for
 * one specific reason: `style-src 'self'` with `style-src-attr` removed (`docs/csp-audit.md` F5) is
 * the directive most likely to break on a dependency bump, and nothing on the merge path would have
 * noticed. Now something does.
 *
 * What each test stands in for, using the checklist's own numbering:
 *
 *  - 9a  Inter loaded, from this origin, and in use (PRD 7.6.1)
 *  - 9b  the HUD paints with the tokens `test/design.test.ts` proves the contrast of (PRD 7.5.4)
 *  - 9c  a sheet opens focused, traps Tab, shows a focus ring and hands focus back on Esc; the
 *        search combobox holds focus on its input (PRD 7.5.2)
 *  - 9d  the About view carries the Fan Content notice verbatim and credits Scryfall, with every
 *        external link `rel`-safe (PRD 4.11, 7.6.2)
 *  - 9e  under `prefers-reduced-motion` the duration tokens collapse and nothing transitions
 *        (PRD 5.9, 7.5.1)
 *  - 9f  the audited headers arrive and the page does not violate its own policy (PRD 7.6.1)
 *
 * Plus one thing the original never had: an `@axe-core/playwright` scan (review §6.4). The hand
 * written checks above are the ones with a requirement behind them; axe is the net underneath, and
 * it catches the classes of defect nobody wrote a check for.
 *
 * **Why these need a browser at all.** `test/design.test.ts` proves the contrast arithmetic on the
 * token values and `test/dialog.test.ts` proves the tab-order arithmetic. Neither can say whether
 * the stylesheet actually *uses* those tokens, whether the focus trap holds against a real browser's
 * focus model, whether the self-hosted face loaded, or what headers the server sent. That is what
 * this file is for, and it is why it runs against `vite preview` — which serves the production
 * policy verbatim (`vite.config.ts` `localSecurityHeaders`) — rather than the dev server, whose
 * policy is relaxed for HMR.
 */

import AxeBuilder from '@axe-core/playwright'
import { test as raw, type Page } from '@playwright/test'

import { routeTargets } from './dataset'
import { expect, test, waitForScene } from './harness'

const targets = routeTargets()

/**
 * A plane route, not the root, and for two reasons — both inherited from the original.
 *
 * The breadcrumb only has an *ancestor* segment below the multiverse, and the ancestor and the
 * current segment are the two ends of the HUD's contrast range. At the root there is only one crumb
 * and it is the current one, so 9b's probe would compare `--ink` against itself and pass while
 * proving nothing.
 *
 * It also puts the drawer on screen, which makes the focus-trap check meaningfully harder: the
 * panel's set rows are focusable, outside the dialog, and behind the scrim. If the trap leaks, Tab
 * lands on one of them.
 */
const PLANE_ROUTE = `/plane/${targets.plane.slug}`

async function openPlaneWithDrawer(page: Page): Promise<void> {
  await page.goto(PLANE_ROUTE)
  await waitForScene(page)
  await expect(page.locator('.drawer-open .set-row').first()).toBeVisible({ timeout: 30_000 })
}

test('9a fonts: Inter loaded, in use, and served from this origin', async ({ page }) => {
  await openPlaneWithDrawer(page)

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    return {
      family: getComputedStyle(document.body).fontFamily,
      loaded: document.fonts.check('400 16px Inter') && document.fonts.check('600 16px Inter'),
      // Where the faces came from. Same-origin is the requirement; `font-src 'self'` is what
      // enforces it, and this is what proves the enforcement was never tested against nothing.
      origins: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.endsWith('.woff2'))
        .map((entry) => new URL(entry.name).origin),
    }
  })

  expect(fonts.family, `body font-family is ${fonts.family}`).toMatch(/^["']?Inter/)
  expect(fonts.loaded, 'the Inter faces did not load — the page is on the fallback stack').toBe(true)
  expect(fonts.origins, 'no .woff2 was fetched at all').not.toHaveLength(0)
  const pageOrigin = new URL(page.url()).origin
  expect(
    fonts.origins.filter((origin) => origin !== pageOrigin),
    'a font came from a third party',
  ).toEqual([])
})

/**
 * 9b. `test/design.test.ts` proves `--ink-muted` clears 4.5:1 on every surface. That proof is worth
 * nothing if a rule quietly paints with something else, so the computed colours are compared back
 * to the tokens here — the one seam the Node-side test cannot see across.
 */
test('9b contrast: the HUD paints with the tokens the contrast proof is about', async ({ page }) => {
  await openPlaneWithDrawer(page)

  const painted = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const token = (name: string): string => root.getPropertyValue(name).trim()
    const colourOf = (selector: string): string | null => {
      const element = document.querySelector(selector)
      return element === null ? null : getComputedStyle(element).color
    }
    // `getComputedStyle().color` is always `rgb(r, g, b)`; the tokens are hex. Normalise via a
    // throwaway element rather than by parsing, so the browser does the conversion.
    const asRgb = (value: string): string => {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.append(probe)
      const computed = getComputedStyle(probe).color
      probe.remove()
      return computed
    }
    return {
      ink: asRgb(token('--ink')),
      muted: asRgb(token('--ink-muted')),
      crumbCurrent: colourOf('.crumb-current'),
      crumb: colourOf('.crumb:not(.crumb-current)'),
      control: colourOf('.control'),
      setYear: colourOf('.drawer-open .set-year'),
      oracle: colourOf('.drawer-open .panel-title'),
    }
  })

  // Non-null first: every one of these is a "paints X" assertion, and a missing element would
  // otherwise make it pass by comparing `null` to `null`.
  for (const [name, value] of Object.entries(painted)) {
    expect(value, `the token probe found no element for ${name}`).not.toBeNull()
  }
  expect(
    { crumbCurrent: painted.crumbCurrent, planePanelTitle: painted.oracle },
    `these should paint --ink ${painted.ink}`,
  ).toEqual({ crumbCurrent: painted.ink, planePanelTitle: painted.ink })
  expect(
    { ancestorCrumb: painted.crumb, control: painted.control, setYear: painted.setYear },
    `these should paint --ink-muted ${painted.muted}`,
  ).toEqual({ ancestorCrumb: painted.muted, control: painted.muted, setYear: painted.muted })
})

/**
 * 9c, first half. Driven from the keyboard throughout: focusing the control and pressing Enter is
 * what a keyboard user does, and unlike a click it leaves no doubt about where focus started.
 */
test('9c keyboard: the sheet opens focused, traps Tab, shows a ring, and hands focus back', async ({
  page,
}) => {
  await openPlaneWithDrawer(page)

  await page.focus('[aria-label="Plane index"]')
  await page.keyboard.press('Enter')
  await expect(page.locator('.plane-list')).toBeVisible()

  const opened = await page.evaluate(() => ({
    inside: document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
    tag: document.activeElement?.className ?? '',
  }))
  expect(opened.inside, 'opening the plane index left focus outside the dialog').toBe(true)
  expect(opened.tag, 'the plane index did not open on the filter box').toContain('sheet-filter')

  // Tab far enough to pass the end of the sheet and wrap. `aria-modal="true"` promises everything
  // outside is inert; if Tab can reach the HUD, the promise is a lie and a keyboard user is tabbing
  // through controls their screen reader says do not exist.
  let escaped: string | null = null
  for (let step = 0; step < 40 && escaped === null; step += 1) {
    await page.keyboard.press('Tab')
    escaped = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const active = document.activeElement
      if (dialog === null) return 'the dialog closed while tabbing'
      if (active === null || active === document.body) return 'focus fell off the document'
      return dialog.contains(active) ? null : `focus escaped to ${active.outerHTML.slice(0, 90)}`
    })
  }
  expect(escaped, 'the plane index does not trap focus').toBeNull()

  // A visible focus state, and specifically the sandwich — a bare accent ring is only 1.99:1 on a
  // bloomed star, so "there is an outline" is not the assertion worth making.
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow)
  expect(ring, 'the focused element has no focus ring').not.toBe('none')
  expect(ring.split('rgb').length, `focus ring ${JSON.stringify(ring)} is not the two-layer sandwich`)
    .toBeGreaterThanOrEqual(3)

  await page.keyboard.press('Escape')
  await expect(page.locator('.plane-list')).toHaveCount(0)
  const restored = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? null,
  )
  expect(restored, 'closing the dialog did not hand focus back to the control that opened it').toBe(
    'Plane index',
  )
})

/**
 * 9c, second half. The search box is the other shape: one tabbable element, with
 * `aria-activedescendant` rows. Tab has nowhere to go, and "nowhere to go" must mean "stay", not
 * "leave".
 */
test('9c keyboard: the search combobox holds focus on its input', async ({ page }) => {
  await openPlaneWithDrawer(page)

  await page.keyboard.press('/')
  await expect(page.locator('.search-input')).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')

  const active = await page.evaluate(() => document.activeElement?.className ?? '')
  expect(active, 'Tab left the search box').toContain('search-input')

  await page.keyboard.press('Escape')
  await expect(page.locator('.search-input')).toHaveCount(0)
})

test('9d About: the Fan Content notice, the Scryfall credit, and rel-safe links', async ({
  page,
}) => {
  await openPlaneWithDrawer(page)

  await page.focus('[aria-label="Help"]')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sheet-foot button', { hasText: /about/i })).toBeVisible()
  await page.locator('.sheet-foot button', { hasText: /about/i }).click()
  await expect(page.locator('[aria-label="About"]')).toBeVisible()

  const about = await page.evaluate(() => {
    const dialog = document.querySelector('[aria-label="About"]')
    return {
      text: dialog?.textContent ?? '',
      links: [...(dialog?.querySelectorAll('a') ?? [])].map((a) => ({
        href: a.href,
        rel: a.rel,
        target: a.target,
      })),
    }
  })

  // PRD 4.11.1: the policy's required notice, not a paraphrase of it.
  for (const clause of [
    'unofficial Fan Content permitted under the',
    'Fan Content Policy',
    'Not approved/endorsed by Wizards',
    'Portions of the materials used are property of Wizards of the Coast',
    '©Wizards of the Coast LLC',
  ]) {
    expect(about.text, `the About view is missing a required Fan Content clause`).toContain(clause)
  }
  // PRD 4.11.2: Scryfall credited as the source of the data *and* the images.
  expect(about.text, 'the About view does not credit Scryfall').toMatch(/Scryfall/)
  expect(
    about.links.some((link) => link.href.startsWith('https://scryfall.com')),
    'the About view has no link to Scryfall',
  ).toBe(true)
  expect(about.links.length, 'the About view has too few links to check').toBeGreaterThanOrEqual(2)
  // PRD 7.6.2, on the only page in the product with external links on it.
  for (const link of about.links) {
    expect(link.rel, `${link.href} opens without noopener/noreferrer`).toContain('noopener')
    expect(link.rel, `${link.href} opens without noopener/noreferrer`).toContain('noreferrer')
    expect(link.target, `${link.href} does not open in a new tab`).toBe('_blank')
  }

  await page.keyboard.press('Escape')
})

/**
 * CSS time values in seconds, so an assertion is about duration rather than spelling.
 *
 * `0ms` and `0s` are the same duration, and which one `getComputedStyle` hands back is a property
 * of whoever last minified the stylesheet: Vite 8 moved CSS minification to lightningcss, which
 * normalises `0ms` to the shorter `0s`. A test that compared the literal token failed on that
 * rename while the behaviour it names — reduced motion collapsing every duration to zero — was
 * intact.
 *
 * Parsing also removes a unit blindness in the control below, which read `transitionDuration` with
 * `Number.parseFloat`: that yields `0.03` for `0.03s` and passes a `< 0.05` bound meant to mean
 * "under 50 ms", but yields `30` for the identical `30ms` and fails it. Same duration, opposite
 * verdicts, decided by the serialisation.
 */
function durationSeconds(value: string): number {
  const trimmed = value.trim()
  const scale = trimmed.endsWith('ms') ? 0.001 : 1
  return Number.parseFloat(trimmed) * scale
}

test('9e reduced motion: the duration tokens collapse to zero and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await waitForScene(page)

  const motion = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      tokens: ['--dur-fast', '--dur-base', '--dur-slow'].map((name) =>
        root.getPropertyValue(name).trim(),
      ),
      // The blanket rule is the belt to the tokens' braces: it catches anything that transitions
      // without reading a token, including a future dependency's stylesheet.
      control: getComputedStyle(document.querySelector('.control')!).transitionDuration,
    }
  })

  expect(
    motion.tokens.map(durationSeconds),
    `a duration token survived reduced motion (${motion.tokens.join(', ')})`,
  ).toEqual([0, 0, 0])
  expect(
    durationSeconds(motion.control),
    `a control still transitions for ${motion.control} under reduced motion`,
  ).toBeLessThan(0.05)
})

/**
 * 9f. The one this port exists for.
 *
 * `write-vercel-json.mjs --check` already proves `vercel.json` matches `security-headers.mjs`; what
 * it cannot prove is that the built page *loads clean* under the policy those files describe. A
 * dependency that starts injecting a `<style>` element or a literal `style` attribute passes every
 * check in the repo and fails here — as a `securitypolicyviolation` event, which is collected from
 * an init script so it is attributed to a directive instead of being lost in the console noise.
 */
test('9f headers: the audited CSP and HSTS arrive, and the page does not violate its own policy', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const collected: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = collected
    document.addEventListener('securitypolicyviolation', (event) => {
      collected.push(`${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'}`)
    })
  })

  const response = await page.goto(PLANE_ROUTE)
  await waitForScene(page)

  const headers = response?.headers() ?? {}
  const csp = headers['content-security-policy'] ?? ''

  expect(csp, 'no Content-Security-Policy header arrived at all').not.toBe('')
  expect(
    /(^|;\s*)style-src 'self'(;|$)/.test(csp),
    `style-src is not the audited value: ${JSON.stringify(/style-src[^;]*/.exec(csp)?.[0] ?? '')}`,
  ).toBe(true)
  // Phase 6 dropped it (csp-audit.md F5). Asserted absent rather than left unmentioned, so that
  // re-adding the relaxation has to argue with a failing check instead of sliding back in.
  expect(csp, 'style-src-attr came back').not.toContain('style-src-attr')
  expect(csp, 'font-src is missing from the policy').toContain("font-src 'self'")
  expect(
    headers['strict-transport-security'] ?? '',
    'the audit added HSTS, and it did not arrive',
  ).toContain('max-age=')

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  )
  expect(violations, 'the page violated its own policy').toEqual([])
})

/**
 * The control for the test above, and the reason it is worth trusting.
 *
 * "No violations were recorded" is the same observation as "the collector is broken" — an init
 * script that never attached, an event name that changed, a `page.evaluate` reading a field nobody
 * wrote. So a violation is provoked on purpose: injecting a `<style>` element is exactly the shape
 * `style-src 'self'` exists to refuse, and it must come back attributed to that directive.
 *
 * On the bare `test`, not the harness's: a refused style logs a console error by design, and the
 * `problems` fixture would correctly fail a test that expects one.
 */
raw('9f control: an injected <style> is refused and the collector records it', async ({ page }) => {
  await page.addInitScript(() => {
    const collected: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = collected
    document.addEventListener('securitypolicyviolation', (event) => {
      collected.push(`${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'}`)
    })
  })
  await page.goto(PLANE_ROUTE)

  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = '.injected-by-the-csp-control { color: red }'
    document.head.append(style)
  })

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  )
  // On the directive, not the whole string: Chrome spells the blocked URI of an inline style
  // `inline`, and that spelling is the browser's to change.
  expect(
    violations.filter((violation) => violation.startsWith('style-src-elem ')),
    'an injected <style> was not refused — either the policy is not being enforced or the ' +
      'collector in the test above is dead, and in both cases 9f proves nothing',
  ).not.toHaveLength(0)
})

/**
 * The net underneath the checklist (review §6.4).
 *
 * Scoped to serious and critical, which is the line between "a user cannot do this" and a
 * best-practice note. `canvas` is excluded: WebGL content is opaque to axe, and the scene's canvas
 * carries its accessible description on the shell around it, which the rest of this file checks.
 */
test('axe finds no serious or critical violations on the shipped shell', async ({ page }) => {
  await openPlaneWithDrawer(page)

  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )

  expect(
    serious.map((violation) => `${violation.id} (${violation.impact}) — ${violation.help}`),
    'axe found serious or critical accessibility violations',
  ).toEqual([])
})
