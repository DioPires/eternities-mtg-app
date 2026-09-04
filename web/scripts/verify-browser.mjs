#!/usr/bin/env node
/**
 * The local browser gate (implementation plan §6), driving the **Phase 4 app shell** against a
 * real fixture through `vite preview`, which sends the production PRD 7.6.1 headers rather than
 * the dev-server relaxation.
 *
 * Phase 0 used this to prove the fixtures decoded in a browser. Phase 4 replaced that decode panel
 * with the real shell, so the assertions moved with it: this now walks PRD section 6's interaction
 * requirements end to end and fails on the first one that does not hold.
 *
 *   1. WebGL2 canvas draws, the HUD is up and click-through, and the control cluster is PRD
 *      6.3.3's six controls in order.
 *   2. Deep link with filters (PRD 6.7.1-2): the route resolves, chips render, the count is exact.
 *   3. Plane panel (PRD 6.4): sets listed; clicking one adds a set chip.
 *   4. Search (PRD 6.5): `/` opens it, results group, arrows cross groups, Enter flies.
 *   5. Random (PRD 6.9) lands on a card; the card panel shows the encoding as text and a
 *      `rel`-safe Scryfall link (PRD 7.5.3, 7.6.2); activating a printing changes no route.
 *   6. Esc and browser back go up a level (PRD 6.1.3, 6.2.2); forward replays.
 *   7. Bad links toast and land somewhere sensible: a dead card id falls back to the multiverse
 *      (PRD risk 9), and a malformed id, slug or path is caught at boot (PRD 6.7.1). Separate
 *      cases because they are separate code paths.
 *   8. Touch does not break the page (PRD 6.1.5).
 *   9. The WebGL2 fallback renders a plain explanation with no canvas at all (PRD 7.1.2).
 *  10. Throughout: no console error, no failed request, nothing blocked by the CSP.
 *
 * Uses `puppeteer-core` against the browser already on the machine — nothing is downloaded. CI
 * runs the Node-side suites; this is the local gate, and Phase 6's Playwright smoke replaces it.
 *
 *   node scripts/verify-browser.mjs [--dataset small|scale|all] [--keep]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const ORACLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(`no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  }
  return found
}

function parseArgs(argv) {
  const args = { dataset: 'small', keep: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--keep') args.keep = true
  }
  return args
}

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const match = /(http:\/\/localhost:\d+)/.exec(chunk)
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`vite preview exited with ${code}`))
    })
  })
  return { child, url }
}

/** Collects every console error, page error and failed request for one page. */
function watch(page, problems) {
  page.on('console', (message) => {
    const text = message.text()
    // A resource 404 is reported twice: once blind by the console, once with a URL by `response`.
    if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
      problems.push(`console error: ${text}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('requestfailed', (request) =>
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`),
  )
}

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const route = (page) => page.evaluate(() => location.pathname + location.search)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** The shell is ready when `sets.bin` has landed, which is what enables the random control. */
async function waitForDataset(page) {
  await page.waitForFunction(
    () => {
      const random = document.querySelector('[aria-label="Random card"]')
      return random instanceof HTMLButtonElement && !random.disabled
    },
    { timeout: 60_000 },
  )
}

async function verifyShell(page, url, log) {
  // --- 1. first frame, canvas, HUD -------------------------------------------------------
  const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
  const csp = response?.headers()['content-security-policy']
  check(csp, 'the preview server sent no Content-Security-Policy header')
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? ''
  check(
    !scriptSrc.includes("'unsafe-inline'"),
    `the production policy must not relax script-src: ${scriptSrc}`,
  )
  log(`  CSP present, script-src is ${scriptSrc.trim() || '(default)'}`)

  const canvas = await page.evaluate(() => {
    const element = document.querySelector('canvas')
    if (!element) return null
    const context = element.getContext('webgl2')
    return {
      webgl2: context !== null,
      drew: (element.toDataURL('image/png').length ?? 0) > 5000,
      touchAction: getComputedStyle(element).touchAction,
    }
  })
  check(canvas, 'no <canvas> in the document')
  check(canvas.webgl2, 'the canvas has no WebGL2 context')
  check(canvas.drew, 'the canvas looks empty — the background starfield may not have drawn')
  // PRD 6.1.5, enforced in CSS rather than by a handler that could be removed.
  check(canvas.touchAction === 'none', `canvas touch-action is ${canvas.touchAction}, expected none`)
  log('  canvas: WebGL2, starfield drew, touch-action none')

  await waitForDataset(page)

  const hud = await page.evaluate(() => {
    const cluster = document.querySelector('[role="toolbar"]')
    const crumb = document.querySelector('nav[aria-label="Breadcrumb"]')
    return {
      controls: Array.from(cluster?.querySelectorAll('button') ?? []).map((b) =>
        b.getAttribute('aria-label'),
      ),
      crumb: crumb?.textContent?.trim() ?? null,
      // PRD 6.3: the HUD never occludes the focused object.
      pointerEvents: getComputedStyle(document.querySelector('.hud')).pointerEvents,
    }
  })
  check(
    JSON.stringify(hud.controls) ===
      JSON.stringify(['Search', 'Plane index', 'Random card', 'Copy link', 'Settings', 'Help']),
    `control cluster is ${JSON.stringify(hud.controls)} — PRD 6.3.3 lists six, in order`,
  )
  check(hud.crumb === 'Multiverse', `breadcrumb reads ${JSON.stringify(hud.crumb)} at the root`)
  check(hud.pointerEvents === 'none', `HUD pointer-events is ${hud.pointerEvents}, expected none`)
  log(`  HUD: breadcrumb "${hud.crumb}", six controls in order, click-through`)

  // --- 1b. first-visit hint (PRD 6.8.3) --------------------------------------------------
  // "After the intro, a single dismissible overlay names the three controls … dismissal is
  // remembered locally." Dismissed here so it does not sit over the rest of the walk — which is
  // also how the "remembered" half gets checked, since every later page load must come up without
  // it.
  await page.waitForSelector('.hint', { timeout: 30_000 })
  const hint = await page.evaluate(() => document.querySelector('.hint')?.textContent ?? '')
  check(
    /drag/i.test(hint) && /scroll/i.test(hint) && /click/i.test(hint) && /esc/i.test(hint),
    `the first-visit hint does not name the three controls and Esc: ${JSON.stringify(hint)}`,
  )
  await page.click('.hint .link-button')
  await page.waitForFunction(() => document.querySelector('.hint') === null, { timeout: 5000 })
  log('  first-visit hint: named drag/scroll/click/Esc, dismissed')

  // --- 2. deep link with filters (PRD 6.7.1-2, 6.3.2, 6.4) -------------------------------
  // Which plane to walk is read out of `planes.json` rather than hard-coded: the two fixtures put
  // cards on different planes (`dominaria` is a zero-card plane in `fixture-scale`), and the real
  // dataset will differ again. A browser check that only passes on one fixture is not a check.
  const roster = await page.evaluate(async () => {
    const base = document.querySelector('meta[name="eternities:data"]')?.getAttribute('content')
    const file = await (await fetch(`${base}planes.json`)).json()
    const populated = file.planes.find(
      (plane) => plane.slug !== 'blind-eternities' && plane.cardCount > 0 && plane.sets.length > 0,
    )
    const empty = file.planes.find((plane) => plane.cardCount === 0)
    return {
      plane: populated && {
        slug: populated.slug,
        name: populated.displayName,
        setCode: populated.sets[0].code,
        setName: populated.sets[0].name,
        sets: populated.sets.length,
      },
      empty: empty && { slug: empty.slug, name: empty.displayName },
    }
  })
  check(roster.plane, 'planes.json has no plane with cards and sets to walk')
  log(`  walking ${roster.plane.name} (${roster.plane.sets} sets)`)

  await page.goto(`${url}/plane/${roster.plane.slug}?c=W,U&r=rare`, { waitUntil: 'networkidle0' })
  await waitForDataset(page)
  check(
    (await page.$('.hint')) === null,
    'the first-visit hint came back after being dismissed — PRD 6.8.3 remembers it locally',
  )
  const deep = await page.evaluate(() => ({
    crumb: document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent?.trim() ?? '',
    title: document.querySelector('.panel-title')?.textContent ?? '',
    chips: Array.from(document.querySelectorAll('.chip .chip-label')).map((n) => n.textContent),
    count: document.querySelector('.chip-count')?.textContent ?? '',
    drawer: document.querySelector('aside.drawer')?.getAttribute('aria-label') ?? null,
    drawerOpen: document.querySelector('aside.drawer')?.classList.contains('drawer-open') ?? false,
    sets: document.querySelectorAll('.set-list .set-row').length,
  }))
  check(
    deep.crumb.includes(roster.plane.name),
    `breadcrumb did not reach ${roster.plane.name}: ${deep.crumb}`,
  )
  check(
    JSON.stringify(deep.chips) === JSON.stringify(['White', 'Blue', 'Rare']),
    `chips are ${JSON.stringify(deep.chips)} — PRD 6.3.2 wants one per active facet value`,
  )
  const counts = /^([\d,]+) of ([\d,]+)/.exec(deep.count)
  const matched = Number(counts?.[1]?.replace(/,/g, '') ?? -1)
  const total = Number(counts?.[2]?.replace(/,/g, '') ?? -1)
  check(matched >= 0 && matched < total, `filter count "${deep.count}" is not an exact subset`)
  check(deep.drawer === 'Plane details' && deep.drawerOpen, 'the plane drawer did not open on focus')
  check(deep.sets > 0, 'the plane panel listed no sets (PRD 6.4 plane panel item 3)')
  log(`  deep link: ${deep.crumb} · chips ${deep.chips.join(', ')} · ${deep.count} · ${deep.sets} sets`)

  // --- 3. plane panel set click adds a chip (PRD 6.4.3) ----------------------------------
  await page.click('.set-list .set-row')
  await page.waitForFunction(() => location.search.includes('s='), { timeout: 5000 })
  log(`  set click → ${await route(page)}`)

  // --- 3b. zero-card plane (PRD 6.4.5) ---------------------------------------------------
  if (roster.empty) {
    await page.goto(`${url}/plane/${roster.empty.slug}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.panel-empty', { timeout: 15_000 })
    const empty = await page.evaluate(() => ({
      title: document.querySelector('.panel-title')?.textContent ?? '',
      note: document.querySelector('.panel-empty')?.textContent ?? '',
      sets: document.querySelectorAll('.set-row').length,
    }))
    check(
      empty.title === roster.empty.name && empty.note === 'No cards assigned',
      `zero-card panel shows ${JSON.stringify(empty)} — PRD 6.4.5 wants the name and "No cards assigned"`,
    )
    log(`  zero-card plane: ${empty.title} — ${empty.note}`)
  }

  // --- 4. search (PRD 6.5) ---------------------------------------------------------------
  const openSearch = async (query) => {
    await page.goto(url, { waitUntil: 'networkidle0' })
    await waitForDataset(page)
    await page.keyboard.press('/')
    await page.waitForSelector('.search-input:not([disabled])', { timeout: 10_000 })
    // The box mounts and focuses itself in an effect; give React the frame before typing at it.
    await pause(200)
    await page.type('.search-input', query)
    await page
      .waitForFunction(() => document.querySelectorAll('.search-hit').length > 0, {
        timeout: 10_000,
      })
      .catch(async (error) => {
        const state = await page.evaluate(() => ({
          value: document.querySelector('.search-input')?.value ?? null,
          box: document.querySelector('.search-box') !== null,
          empty: document.querySelector('.search-empty')?.textContent ?? null,
        }))
        throw new Error(`${error.message} — search "${query}" state ${JSON.stringify(state)}`)
      })
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('.search-group')).map((n) => n.textContent),
    )
  }

  const groups = await openSearch(roster.plane.name)
  check(
    groups[0] === 'Planes',
    `search groups are ${JSON.stringify(groups)} — PRD 6.5.3 leads with Planes`,
  )
  // Arrows walk the flat list (PRD 6.5.3). Crossing a *group* boundary is asserted by the set
  // search below, which is the stronger case; a plane-name query can legitimately return one hit.
  await page.keyboard.press('ArrowDown')
  const cursor = await page.evaluate(() => {
    const hits = Array.from(document.querySelectorAll('.search-hit'))
    return {
      at: hits.findIndex((n) => n.getAttribute('aria-selected') === 'true'),
      count: hits.length,
    }
  })
  check(
    cursor.at === Math.min(1, cursor.count - 1),
    `ArrowDown selected row ${cursor.at} of ${cursor.count}`,
  )
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    (expected) => location.pathname === expected,
    { timeout: 10_000 },
    `/plane/${roster.plane.slug}`,
  )
  log(`  search: groups ${groups.join(' → ')} · Enter flew to ${await route(page)}`)

  // PRD 6.5.4: "selecting a set … flies to its plane and adds a set filter chip". Queried by set
  // code, which is exact and does not assume set names contain the plane name.
  const setGroups = await openSearch(roster.plane.setCode)
  check(setGroups.includes('Sets'), `no Sets group for code ${roster.plane.setCode}: ${setGroups}`)
  const setRow = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.search-results > li'))
    const at = nodes.findIndex((n) => n.classList.contains('search-group') && n.textContent === 'Sets')
    return at < 0 ? -1 : nodes.slice(0, at).filter((n) => n.classList.contains('search-hit')).length
  })
  check(setRow >= 0, 'could not locate the Sets group in the flat result list')
  // Walking `setRow` rows to reach the first Set is exactly PRD 6.5.3's "arrow keys move between
  // results across groups" whenever a group precedes Sets.
  for (let i = 0; i < setRow; i += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.search.includes('s='), { timeout: 10_000 })
  log(
    `  set search: "${roster.plane.setCode}" → ${await route(page)}` +
      (setRow > 0 ? ` (arrows crossed ${setRow} row(s) into the Sets group)` : ''),
  )

  // --- 5. random → card panel (PRD 6.9, 6.4, 7.5.3, 7.6.2, 6.2.2) ------------------------
  await page.click('[aria-label="Random card"]')
  await page.waitForFunction(() => /\/plane\/[^/]+\/card\/[0-9a-f-]{36}$/.test(location.pathname), {
    timeout: 15_000,
  })
  const cardRoute = await route(page)
  // The path, not the whole route: the set chip from the previous step is still in the query
  // string, which is PRD 6.6.6 working — "filter state survives navigation".
  const cardPath = await page.evaluate(() => location.pathname)
  check(ORACLE_PATTERN.test(cardPath.split('/card/')[1] ?? ''), `random produced ${cardRoute}`)
  check(cardRoute.includes('s='), 'the set filter did not survive the navigation (PRD 6.6.6)')
  await page.waitForSelector('.printing-list .printing-row', { timeout: 20_000 })
  const card = await page.evaluate(() => {
    const link = document.querySelector('.panel-external a')
    return {
      drawer: document.querySelector('aside.drawer')?.getAttribute('aria-label') ?? null,
      name: document.querySelector('.card-face-name')?.textContent ?? '',
      printings: document.querySelectorAll('.printing-row').length,
      active: document.querySelectorAll('.printing-row-active').length,
      encoding: Array.from(document.querySelectorAll('.card-encoding dt')).map((n) => n.textContent),
      href: link?.getAttribute('href') ?? null,
      rel: link?.getAttribute('rel') ?? null,
      target: link?.getAttribute('target') ?? null,
    }
  })
  check(card.drawer === 'Card details', 'the card drawer did not open on card focus')
  check(card.printings > 0 && card.active === 1, 'the printings list has no single active row')
  check(
    card.encoding.includes('Colour identity') && card.encoding.includes('Rarity'),
    `card panel encoding is ${JSON.stringify(card.encoding)} — PRD 7.5.3 wants both as text`,
  )
  check(card.href?.startsWith('https://scryfall.com/card/'), `Scryfall link is ${card.href}`)
  check(
    card.rel === 'noopener noreferrer' && card.target === '_blank',
    `external link carries rel="${card.rel}" target="${card.target}"`,
  )
  // PRD 6.2.2: activating a printing changes no route and pushes no history.
  const beforePrinting = await route(page)
  const rows = await page.$$('.printing-row')
  if (rows.length > 1) {
    await rows[1].click()
    await pause(150)
    check(
      (await route(page)) === beforePrinting,
      'activating a printing changed the route — PRD 6.2.2 says it must not',
    )
  }
  log(`  random: "${card.name}" · ${card.printings} printings · encoding as text · rel-safe link`)

  // Collapsing the drawer must not strand the keyboard (PRD 7.5.2). The toggle is the only way
  // back in, so it stays reachable; everything it hid goes out of the tab order with it, rather
  // than staying tabbable while translated off-screen.
  await page.click('.drawer-toggle')
  await pause(300)
  const collapsed = await page.evaluate(() => {
    const toggle = document.querySelector('.drawer-toggle')
    toggle.focus()
    const scroll = document.querySelector('.drawer-scroll')
    const inside = scroll.querySelector('a, button')
    inside?.focus()
    return {
      open: document.querySelector('aside.drawer').classList.contains('drawer-open'),
      toggleFocusable: document.activeElement === toggle || toggle.matches(':focus'),
      hidden: scroll.hasAttribute('inert'),
      insideFocusable: inside !== null && document.activeElement === inside,
      ariaHiddenOnContainer: document.querySelector('aside.drawer').hasAttribute('aria-hidden'),
    }
  })
  check(!collapsed.open, 'the drawer toggle did not collapse the panel')
  check(collapsed.hidden, 'the collapsed drawer contents are not inert')
  check(!collapsed.insideFocusable, 'an off-screen control inside the collapsed drawer took focus')
  check(
    !collapsed.ariaHiddenOnContainer,
    'the drawer container is aria-hidden, which hides its own reopen toggle from assistive tech',
  )
  await page.click('.drawer-toggle')
  await page.waitForFunction(
    () => document.querySelector('aside.drawer')?.classList.contains('drawer-open') === true,
    { timeout: 5_000 },
  )
  log('  drawer: collapses inert, the toggle stays reachable and reopens it')

  // --- 6. Esc and history (PRD 6.1.3, 6.2.2) ---------------------------------------------
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => /^\/plane\/[^/]+$/.test(location.pathname), { timeout: 10_000 })
  const planeRoute = await route(page)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10_000 })
  await page.keyboard.press('Escape') // PRD 6.1.3: nothing to do at multiverse level
  await pause(150)
  check(
    (await page.evaluate(() => location.pathname)) === '/',
    'Esc at multiverse level moved somewhere',
  )
  await page.goBack()
  await page.waitForFunction(
    (expected) => location.pathname + location.search === expected,
    { timeout: 10_000 },
    planeRoute,
  )
  const afterBack = await page.evaluate(
    () => document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent?.trim() ?? '',
  )
  check(afterBack.length > 0 && afterBack !== 'Multiverse', `back left the breadcrumb at ${afterBack}`)
  await page.goForward()
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10_000 })
  log(`  Esc walks card → ${planeRoute} → / ; back and forward replay it`)

  // --- 7. bad links: dead (PRD risk 9) and malformed (PRD 6.7.1) --------------------------
  // Two different code paths that both end in a toast, and they are checked separately because
  // the first version of this step only exercised the dead one — which let a bug where every
  // malformed-link toast was silently dropped pass a green run.
  //
  //  - dead: a *well-formed* oracle id that is not in this dataset. Resolution gets as far as
  //    `sets.bin` and fails there, so it is `failCardResolution` → the multiverse.
  //  - malformed: an id the router could not parse at all. Caught at cold start, before any
  //    resolution, and it keeps whatever part of the route did parse.
  const badLink = async (path, expectedRoute, expectedToast, label) => {
    // `domcontentloaded`, not `networkidle0`: the malformed-link toast is raised during boot and
    // self-dismisses after six seconds, so waiting for the dataset to go quiet first could outlast
    // the thing being checked. Polling starts immediately instead; the dead-link toast, which does
    // wait on `sets.bin`, is covered by the generous `waitForFunction` timeout below.
    await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('.toast-error') !== null, {
      timeout: 30_000,
    })
    const seen = await page.evaluate(() => ({
      route: location.pathname,
      toast: document.querySelector('.toast-error')?.textContent ?? '',
    }))
    check(seen.route === expectedRoute, `${label} landed on ${seen.route}, expected ${expectedRoute}`)
    check(
      seen.toast.includes(expectedToast),
      `${label} said ${JSON.stringify(seen.toast)}, expected it to mention ${JSON.stringify(expectedToast)}`,
    )
    log(`  ${label} → ${seen.route} with "${seen.toast.trim()}"`)
  }

  await badLink(
    `/plane/${roster.plane.slug}/card/00000000-0000-4000-8000-000000000000`,
    '/',
    'no longer in this dataset',
    'dead card link',
  )
  await badLink(
    `/plane/${roster.plane.slug}/card/not-a-uuid`,
    `/plane/${roster.plane.slug}`,
    'card link is malformed',
    'malformed card link',
  )
  await badLink('/plane/NOT_A_SLUG', '/', 'plane link is malformed', 'malformed plane link')
  await badLink('/wat', '/', 'does not exist', 'unknown route')

  // --- 8. touch does not break the page (PRD 6.1.5) --------------------------------------
  await page.goto(`${url}/plane/${roster.plane.slug}`, { waitUntil: 'networkidle0' })
  await waitForDataset(page)
  const touchProblems = []
  const onTouchError = (error) => touchProblems.push(error.message)
  page.on('pageerror', onTouchError)
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const make = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y })
    const fire = (type, points) => {
      canvas.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: points,
          targetTouches: points,
          changedTouches: points,
        }),
      )
    }
    fire('touchstart', [make(1, 200, 200), make(2, 400, 400)])
    fire('touchmove', [make(1, 240, 220), make(2, 360, 380)])
    fire('touchend', [])
  })
  await pause(250)
  page.off('pageerror', onTouchError)
  check(touchProblems.length === 0, `touch produced ${touchProblems.join('; ')}`)
  // Still usable afterwards: the control cluster must still respond and Esc must still close.
  await page.click('[aria-label="Plane index"]')
  await page.waitForSelector('.plane-list', { timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.plane-list') === null, { timeout: 5000 })
  log('  touch: a pinch on the canvas throws nothing and leaves the page usable')
}

/** PRD 7.1.2, in a page where WebGL2 is genuinely unavailable. */
async function verifyWebGL2Fallback(browser, url, log) {
  const page = await browser.newPage()
  const problems = []
  watch(page, problems)
  await page.evaluateOnNewDocument(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function patched(type, ...rest) {
      if (type === 'webgl2') return null
      return original.call(this, type, ...rest)
    }
  })
  await page.goto(url, { waitUntil: 'networkidle0' })
  const fallback = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent ?? '',
    canvases: document.querySelectorAll('canvas').length,
    length: (document.body.textContent ?? '').length,
  }))
  check(/WebGL2/.test(fallback.heading), `fallback heading is ${JSON.stringify(fallback.heading)}`)
  // "a plain explanation, not a broken canvas" — so there must be no canvas at all.
  check(fallback.canvases === 0, `the fallback page still mounted ${fallback.canvases} canvas(es)`)
  check(fallback.length > 120, 'the fallback page has no explanation, only a heading')
  check(problems.length === 0, `fallback page problems:\n  - ${problems.join('\n  - ')}`)
  await page.close()
  log('  WebGL2 fallback: plain explanation, no canvas mounted')
}

async function verify(dataset) {
  console.log(`\n=== ${dataset} ===`)
  execFileSync('pnpm', ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: 'inherit',
  })

  const { child, url } = await startPreview(dataset)
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  })

  const problems = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    watch(page, problems)

    await verifyShell(page, url, (line) => console.log(line))
    await verifyWebGL2Fallback(browser, url, (line) => console.log(line))

    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n  - ${problems.join('\n  - ')}`)
    }
    console.log(`  OK — ${dataset} drives PRD section 6 in the browser under the production CSP`)
  } finally {
    await browser.close()
    child.kill('SIGTERM')
  }
}

const args = parseArgs(process.argv.slice(2))
const datasets = args.dataset === 'all' ? ['small', 'scale'] : [args.dataset]
for (const dataset of datasets) {
  await verify(dataset)
}
console.log('\nall datasets verified in the browser')
