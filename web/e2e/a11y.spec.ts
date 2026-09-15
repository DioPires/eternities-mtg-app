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
 * 9e (scene). The CSS half above cannot see the scene, and the scene is where PRD 5.9 mostly lives.
 *
 * **This caught a shipped defect (DEC-751).** `SceneHost.setReducedMotion` forwards to the card
 * tier through `this.cardTierHandle?.`, and the card tier is built late — after `planes.json` lands.
 * The setting arrives from a mount effect, so for every user who already had the preference when
 * the page loaded, the forward hit a `null` and was gone; the tier kept its own `reducedMotion =
 * false` default for the whole session and PRD 5.6.3's tilt and PRD 5.6.7's orbit ran anyway. The
 * value is only re-sent on *change*, so the single way to get a correct scene was to toggle the OS
 * setting after load — which is exactly what a hand check does, and why this was invisible.
 *
 * So the media state is set **before `goto`**, which is the shipped order and the broken one.
 *
 * The negative control is doing real work rather than decorating: "the planets did not move" is
 * also what a page with no focused card, a dead probe or a stalled render loop reports, and all
 * three would score this green with the freeze removed. The unreduced run has to show the same
 * planets moving through the same seam before the reduced run's stillness means anything.
 */
test('9e reduced motion: the scene stops too, even when the preference precedes the page', async ({
  page,
}) => {
  /*
   * A frame counter the *test* owns, on its own `requestAnimationFrame` chain (DEC-799).
   *
   * **The one thing a position sample cannot say is whether a frame happened.** Read the same
   * quantity twice and get the same answer, and either nothing moved or nothing *ran* between the
   * reads — two different verdicts about two different subjects, and the original loop conflated
   * them. DEC-790 found the consequence: on the slow `ubuntu-latest` class (`bench smoke` p50
   * 116.7 ms vs the fast class's 66.7 ms) the control failed 9 tries in 13, including main's own
   * 4 in 5 with no PR code in the tree, because one 800 ms window contained zero animation frames
   * — positions byte-identical to sixteen digits, which `orbitElapsed += dt * motionScale` cannot
   * produce from even a single tick. In one trace a burst of 21 real-network `cards.scryfall.io`
   * 404s bracketed the frozen window exactly.
   *
   * So a window with no frame in it is *no evidence*, and is retried below rather than counted.
   *
   * Deliberately the page's rAF and not the scene's own tick count, because the two answer
   * different questions and this arm needs the environmental one. A scene loop that has died also
   * reports "no tick", and excusing that window would let a dead loop retry its way to a green
   * control — precisely the failure this test's negative control exists to catch. The browser
   * still services rAF on a dead loop, so such a window stays *live*, the ring reads at rest, and
   * the control goes red as it should. (DEC-797 is adding `ProbeState.ticks`, the scene-side
   * counter; it answers "did the loop run", which is a product assertion rather than this
   * instrument.)
   */
  await page.addInitScript(() => {
    const counted = window as unknown as { __eternitiesFrames: number }
    counted.__eternitiesFrames = 0
    const bump = (): void => {
      counted.__eternitiesFrames += 1
      requestAnimationFrame(bump)
    }
    requestAnimationFrame(bump)
  })

  /**
   * How far a planet must travel *relative to its card*, in a window, to count as orbiting.
   *
   * A fraction of the viewport, so 1e-2 is about 19 px across PRD 7.1.1's 1920. The number is the
   * middle of a measured gap rather than a guess — see the table on {@link ringMotion}, where the
   * slowest orbiting window is 2.50e-2 and the fastest frozen one 3.50e-3. It sits 2.5x under the
   * one and 2.9x over the other, which is as centred as a single constant can be for both arms.
   *
   * **The gap does not narrow on a slow runner, which is why one constant serves both classes.**
   * `orbitElapsed += dt * motionScale` accumulates wall-clock time with an unclamped `dt`, so a
   * window's turn is set by its 800 ms and not by how many frames fall inside it. Scaling the
   * drawing buffer — DEC-790's lever, and the only one that moves this scene, since CDP CPU
   * throttling is inert against SwiftShader — walked the frame rate from 22 fps at PRD 7.1.1's
   * viewport down to 1.3 fps at 5760x3240, and the travel did not follow it: 2.50–3.06e-2 at the
   * top, 2.06–5.80e-2 at the bottom. One window down there held a *single* frame and still turned
   * 3.40e-2, because that one tick carried the entire 800 ms.
   *
   * That is also why the failure being fixed here needs *exactly zero* frames rather than merely
   * few, and why the remedy is to detect and retry that window rather than to loosen this number.
   */
  const REST_EPSILON = 1e-2
  /** 800 ms is 4.8 degrees of PRD 5.6.7's 60 s revolution — about 56 px at these radii, measured. */
  const WINDOW_MS = 800
  /** Live windows to collect per arm. A median over eight is stable; 8 x 800 ms is 6.4 s. */
  const WINDOWS_WANTED = 8
  /** Enough attempts that a third of them can be vacuous or blind and the arm still reports. */
  const MAX_ATTEMPTS = 25
  /** Below this the arm has not been measured at all, and says so instead of scoring. */
  const WINDOWS_REQUIRED = 4

  /**
   * Positions, the card they orbit, and the frame count in **one** `evaluate`.
   *
   * One round trip so all three describe a single instant. Two `evaluate`s would let a frame land
   * between the planets and the card and put a real displacement into the difference of two
   * quantities that are supposed to be simultaneous.
   */
  const sample = (): Promise<{
    frames: number
    card: { x: number; y: number } | null
    points: Array<{ x: number; y: number } | null>
  }> =>
    page.evaluate(() => ({
      frames: (window as unknown as { __eternitiesFrames: number }).__eternitiesFrames,
      card: window.__eternitiesProbe!.state().cardScreen,
      points: [0, 1, 2].map((i) => window.__eternitiesProbe!.planetScreen(i)),
    }))

  interface RingReport {
    /**
     * Per-window travel of the fastest sampled planet relative to the card, viewport fractions.
     * One entry per *live* window, in order.
     */
    readonly travel: number[]
    /** Windows with no frame in them at all. Environmental; no evidence either way. */
    readonly vacuous: number
    /** Windows where the probe reported no planet, or no card to measure against. Also no evidence. */
    readonly blind: number
  }

  /**
   * Focus a card, then measure how far PRD 5.6.7's ring turns per window.
   *
   * **Relative to the card, and by magnitude, because the old pair of tests measured neither.**
   * The original asked whether two reads 800 ms apart were byte-identical, in absolute viewport
   * coordinates. Both halves of that are wrong, and DEC-799 measured both at `cc00cfe` on the built
   * fixture at PRD 7.1.1's viewport, ten 800 ms windows per arm, max over the three sampled planets
   * — with the card's own screen travel in the last column, because it turns out to be the whole
   * story:
   *
   * | tree                              | absolute    | relative to card | the card itself |
   * |-----------------------------------|-------------|------------------|-----------------|
   * | shipped, motion on                | 2.50–3.06e-2| 2.50–3.06e-2     | ~1e-9 (still)   |
   * | `cardTier` `motionScale = 0`      | 2.64–3.41e-2| 2.65–3.50e-3     | 2.34–3.27e-2    |
   * | shipped, `prefers-reduced-motion` | 0           | 0                | 0               |
   *
   * **Row 2 against row 1 in the first column is the finding: they do not separate at all.** With
   * PRD 5.6.7's orbit switched off the ring still swept 2.64e-2 of the viewport per window in
   * absolute terms — inside the shipped row's own range — because `motionScale` also threads into
   * `starWorldPosition`, so the card stops travelling with its star while the rig's motion mirror
   * keeps tethering to one that does, and the whole assembly slides across the screen. The last
   * column shows the substitution outright: the shipped card is nailed down (1e-9) and the broken
   * one carries 2.34e-2 of travel, which is very nearly the entire absolute reading next to it.
   *
   * So an absolute measure scores a frozen orbit green on the *card's* motion. Subtracting
   * `cardScreen` isolates the one motion this arm is about, and the same two rows then separate by
   * about eight times. The old control was sensitive — it moved — but to the wrong subject, which
   * is why it stayed green through a defect it was pointed straight at.
   *
   * Magnitude rather than bit-equality is the second change, and it is the weaker-motivated of the
   * two: row 3 came back at exactly 0, so `JSON.stringify(before) === JSON.stringify(after)` would
   * also have fired on this tree. It is not promised to. Bit-equality asks a float projection of a
   * stopped ring to agree to sixteen digits, and row 2 is the standing example of a ring that is
   * stopped without being still — a threshold states the property PRD 5.9 actually promises, and
   * does not have to be re-argued the next time something upstream of the projection changes.
   *
   * **Settle-based rather than two-point, because two points cannot tell an orbit from a camera.**
   * PRD 6.2.3's fly-to is still running when the ring is first laid out, so a pair of samples taken
   * across it differ whether or not the orbit is turning — that flaked exactly once, passing alone
   * and failing in a full run, which is the tell.
   */
  const ringMotion = async (): Promise<RingReport> => {
    await page.waitForFunction(() => Boolean(window.__eternitiesProbe), null, { timeout: 60_000 })
    const planes = await page.evaluate(() => window.__eternitiesProbe!.planes().slice(0, 1))
    await page.evaluate((slug) => window.__eternitiesProbe!.focusPlane(slug), planes[0]!.slug)
    // `focusCard` genuinely fails until the plane's shards are in, so this polls rather than sleeps.
    await page.waitForFunction(() => window.__eternitiesProbe!.focusCard() !== -1, null, {
      timeout: 90_000,
    })
    await page.evaluate(() => window.__eternitiesProbe!.focusCard())
    /*
     * Wait for the ring to be laid out, which is not the same as the card being focused, and not
     * the same as the camera having arrived either.
     *
     * `rebuildPlanets` adds the meshes at their constructed origin and the frame loop moves them to
     * their phases on the next tick, so an immediate read finds all 24 stacked on the card's
     * centre — a *stiller* scene than a frozen one, and one that would score this green either way.
     *
     * The older gate asked only that planets 0 and 1 be non-null and *distinct*, which every frame
     * of PRD 6.2.3's fly-to satisfies (DEC-790, defect 1). PR #58's attempt-3 trace took its first
     * sample right through that gate and read `{x: 14.315, y: 13.647}` — a planet projected
     * fourteen viewports off screen — and the read after it was `[null, null, null]`. So the gate
     * now asks for the three properties that separate a laid-out ring from mid-flight garbage:
     *
     *  1. the rig reports no flight in progress, which is the condition itself rather than a proxy;
     *  2. every planet this test samples projects somewhere near the viewport, which rules out both
     *     the 14× outlier and the far-plane `null`s; and
     *  3. both hold on three *consecutive* frames — `waitForFunction` polls on rAF — so a single
     *     frame that happens to look settled on the way past cannot open the sampling.
     *
     * The box is half a viewport of slack on each side rather than the unit square: a planet of
     * PRD 5.6.7's ring legitimately swings past the edge at these radii, and a gate that demanded
     * strict containment would be asserting a framing the PRD does not promise.
     */
    await page.waitForFunction(
      () => {
        const probe = window.__eternitiesProbe!
        const settling = window as unknown as { __eternitiesSettled?: number }
        const points = [0, 1, 2].map((index) => probe.planetScreen(index))
        const near = (value: number): boolean => value >= -0.5 && value <= 1.5
        const laidOut =
          !probe.state().flying &&
          points.every((point) => point !== null && near(point.x) && near(point.y)) &&
          (points[0]!.x !== points[1]!.x || points[0]!.y !== points[1]!.y)
        settling.__eternitiesSettled = laidOut ? (settling.__eternitiesSettled ?? 0) + 1 : 0
        return settling.__eternitiesSettled >= 3
      },
      null,
      { timeout: 30_000 },
    )

    const travel: number[] = []
    let vacuous = 0
    let blind = 0
    for (let attempt = 0; attempt < MAX_ATTEMPTS && travel.length < WINDOWS_WANTED; attempt += 1) {
      const before = await sample()
      await page.waitForTimeout(WINDOW_MS)
      const after = await sample()

      /*
       * A read with no planet in it retries the attempt (DEC-790, defect 2). It used to be
       * `expect(before).not.toEqual([null, null, null])` *inside* this loop, so a single frame with
       * every planet past the far plane — `planetScreen` returns `null` on `screen.z >= 1` — killed
       * the whole test, which is the 12.5 s failure mode DEC-790 traced. A read with no planet in
       * it is not an observation about the orbit. Whether enough real observations were made is
       * asserted once, by the caller, on `travel.length`.
       */
      const pairs = before.points
        .map((point, index) => ({ from: point, to: after.points[index] ?? null }))
        .filter((pair): pair is { from: { x: number; y: number }; to: { x: number; y: number } } =>
          Boolean(pair.from && pair.to),
        )
      if (pairs.length === 0 || !before.card || !after.card) {
        blind += 1
        continue
      }

      /*
       * No frame between the two reads, so the pair says nothing about whether anything moved, and
       * the window is retried rather than scored (DEC-790's failure mode, DEC-799's tolerance).
       * This is the whole reason the frame counter is sampled at all.
       */
      if (after.frames === before.frames) {
        vacuous += 1
        continue
      }

      // The fastest planet of the three. Displacement is taken in the card's frame, so the card's
      // own travel across the screen cancels and only PRD 5.6.7's turn is left.
      travel.push(
        Math.max(
          ...pairs.map((pair) =>
            Math.hypot(
              pair.to.x - after.card!.x - (pair.from.x - before.card!.x),
              pair.to.y - after.card!.y - (pair.from.y - before.card!.y),
            ),
          ),
        ),
      )
    }

    return { travel, vacuous, blind }
  }

  /**
   * Both arms need a denominator before either is allowed to score.
   *
   * Without this, a run in which the browser drew no frames at all would collect no windows, read
   * "nothing moved", and hand the *reduced* arm a green it did not earn — the same shape of hole
   * the old loop had in the other direction.
   */
  const describe = (report: RingReport, arm: string): string =>
    `${arm}: ${report.travel.length} live windows ` +
    `[${report.travel.map((value) => value.toExponential(2)).join(', ')}], ` +
    `${report.vacuous} vacuous, ${report.blind} with nothing to read`

  const assertMeasured = (report: RingReport, arm: string): void => {
    expect(
      report.travel.length,
      `${describe(report, arm)} — too few live windows to measure the ring at all`,
    ).toBeGreaterThanOrEqual(WINDOWS_REQUIRED)
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor((sorted.length - 1) / 2)]!
  }

  // The control, and it is doing real work: "the ring did not move" is also what a dead probe, an
  // unfocused card or a stalled loop reports, and all three would score the reduced arm green.
  await page.goto('/?probe=1')
  const moving = await ringMotion()
  assertMeasured(moving, 'motion on')
  /*
   * The median, not the minimum. One window in a run can lose its frames to the environment
   * without the orbit stopping — DEC-790 read a burst of 21 real-network `cards.scryfall.io` 404s
   * bracketing exactly such a window — and a statistic that a single outlier can drag to zero is
   * what made this arm fail 9 tries in 13 on the slow runner class. The median moves only if most
   * of the run is frozen, which is the thing this arm exists to notice.
   *
   * **And the frame counter alone would not have been enough, which is why both are here.** A
   * window's travel spans the gap between the tick that produced the first read's positions and
   * the tick that produced the second's — not the 800 ms itself — so when ticks are sparse and
   * bunched, a window can hold a frame and still under-report. Measured at 7680x4320 (1.3 fps,
   * about four times slower than the CI class this test kept failing on) one window of eight came
   * back at 6.10e-4 against its run's 3.3–13.5e-2. The counter cannot see that window; the median
   * absorbs it, and the run still scored 3.95e-2. Neither statistic covers the case alone.
   */
  expect(
    median(moving.travel),
    `${describe(moving, 'motion on')} — PRD 5.6.7s ring is not turning with motion on, ` +
      'so the reduced arm below proves nothing',
  ).toBeGreaterThanOrEqual(REST_EPSILON)

  // The shipped order, and the broken one: the preference is set before the page exists.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?probe=1')
  const reduced = await ringMotion()
  assertMeasured(reduced, 'reduced motion')
  // The maximum, and deliberately not the median: PRD 5.9 is absolute, so one turning window is a
  // defect and not an outlier. Nothing environmental can push this up — a starved window has no
  // frames in it and never became a reading.
  expect(
    Math.max(...reduced.travel),
    `${describe(reduced, 'reduced motion')} — PRD 5.6.7s ring kept orbiting under ` +
      'prefers-reduced-motion',
  ).toBeLessThan(REST_EPSILON)
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
