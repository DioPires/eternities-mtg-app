#!/usr/bin/env node
/**
 * Exit-criteria check, in a real browser.
 *
 * Builds the site against a fixture, serves it through `vite preview` (which sends the *production*
 * PRD 7.6.1 headers, not the dev-server relaxation), drives a local Chrome at it, and asserts every
 * shipped phase's criteria. They live in the app shell and two harnesses that `App` routes between,
 * so this is several page loads against the one preview server, sharing one problem collector.
 *
 * The default page — Phase 4's app shell, walking PRD section 6 end to end:
 *
 *   1. WebGL2 canvas draws, the HUD is up and click-through, and the control cluster is PRD
 *      6.3.3's six controls in order; the first-visit hint names the controls and stays dismissed.
 *   2. Deep link with filters (PRD 6.7.1-2): the route resolves, chips render, the count is exact.
 *   3. Plane panel (PRD 6.4): sets listed; clicking one adds a set chip; a zero-card plane says so.
 *   4. Search (PRD 6.5): `/` opens it, results group, arrows cross groups, Enter flies.
 *   5. Random (PRD 6.9) lands on a card; the card panel shows the encoding as text and a
 *      `rel`-safe Scryfall link (PRD 7.5.3, 7.6.2); activating a printing changes no route.
 *   6. Esc and browser back go up a level (PRD 6.1.3, 6.2.2); forward replays.
 *   7. Bad links toast and land somewhere sensible: a dead card id falls back to the multiverse
 *      (PRD risk 9), and a malformed id, slug or path is caught at boot (PRD 6.7.1). Separate
 *      cases because they are separate code paths.
 *   8. Touch does not break the page (PRD 6.1.5).
 *   9. The WebGL2 fallback renders a plain explanation with no canvas at all (PRD 7.1.2).
 *
 * Then Phase 5's accessibility checklist, on that same shell:
 *
 *  9a. Inter loaded, from this origin, and in use (PRD 7.6.1).
 *  9b. The HUD paints with the tokens `test/design.test.ts` proves the contrast of (PRD 7.5.4).
 *  9c. A sheet opens focused, traps Tab, shows a focus ring and hands focus back on Esc; the
 *      search combobox holds focus on its input (PRD 7.5.2).
 *  9d. The About view carries the Fan Content notice verbatim and credits Scryfall, with every
 *      external link `rel`-safe (PRD 4.11, 7.6.2).
 *  9e. Under `prefers-reduced-motion`, the duration tokens collapse and nothing transitions
 *      (PRD 5.9, 7.5.1).
 *  9f. The audited headers arrive and the page does not violate its own policy (PRD 7.6.1).
 *
 * `?harness=2b` — Phase 2b's harness:
 *
 *  10. `planes.json` decodes and the camera rig comes up on it;
 *  11. the label overlay places plane names as HTML billboards (PRD 5.3.8);
 *  12. **navigation works end to end**: a keypress flies the camera to the Blind Eternities, the
 *      focus changes, the camera actually moves, and Esc brings it back (PRD 5.7.2, 6.1.3);
 *  13. plane detail loads through the worker, shard by shard, on focus (PRD 8.7.6, amendment A1) —
 *      the Blind Eternities is the sharded one, so it is the one this drives.
 *
 * `?selfcheck=1` — Phase 2a's harness:
 *
 *  14. the page renders a WebGL2 canvas — the star field of PRD 5.3.18 actually draws;
 *  15. the fixture decodes: manifest, planes.json, streamed stars.bin, search.json, sets.bin and
 *      a plane detail shard all come back through the contract decoders;
 *  16. the GPU self-check of PRD 8.5.7 — that the CPU motion mirror agrees with the vertex shader
 *      — passes on this machine's actual driver.
 *
 * The shell and the two harnesses are still three separate scenes; Phase 3 (DEC-590) folds them
 * into one, and until it does each phase's exit criteria stay checkable exactly as reviewed.
 *
 * And across all of them: nothing blocked by the Content Security Policy (including `worker-src`),
 * no console error and no failed request.
 *
 * The roster-dependent thresholds are read from the fixture rather than hard-coded, because
 * `--dataset all` runs this against `fixture-small`'s 5 planes as well as `fixture-scale`'s 87.
 *
 * Uses `puppeteer-core` against the browser already on the machine — nothing is downloaded. CI
 * runs the Node-side suites; this is the local gate the implementation plan §6 asks for, and it
 * is what Phase 6's Playwright smoke replaces.
 *
 * Runs on the machine's real GPU, the way `bench.mjs` does, and fails if Chrome falls back to a
 * software rasteriser: the GPU self-check is cited as the mitigation for driver variance and
 * SwiftShader cannot answer for a driver. `--allow-software` downgrades that to a warning, for a
 * box that has no GPU at all.
 *
 *   node scripts/verify-browser.mjs [--dataset small|scale|all] [--keep] [--allow-software]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

const BLIND_ETERNITIES_SLUG = 'blind-eternities'

const ORACLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      `no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    )
  }
  return found
}

function parseArgs(argv) {
  const args = { dataset: 'scale', keep: false, allowSoftware: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--keep') args.keep = true
    else if (argv[i] === '--allow-software') args.allowSoftware = true
  }
  return args
}

/** A software rasteriser answering as the GPU. `bench.mjs` refuses these; so does this. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|mesa offscreen/i

/**
 * What the build will point at, resolved the same way `vite.config.ts` resolves it — fixture name
 * first, then a raw hash. The assertions below are stated relative to this roster.
 */
function readRoster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = registry.fixtures[dataset] ?? dataset
  const root = resolve(WEB_ROOT, 'public/data', hash)
  const planes = JSON.parse(readFileSync(resolve(root, 'planes.json'), 'utf8')).planes
  // PRD 5.3.4: the dust is deliberately unlabelled, so it is not one of the billboards.
  const labelled = planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG).length
  const shards = readdirSync(resolve(root, 'planes')).filter((name) =>
    name.startsWith(`${BLIND_ETERNITIES_SLUG}.`),
  ).length
  return { hash, planes: planes.length, labelled, shards }
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

/**
 * The scene's canvas and the driver that drew it.
 *
 * R3F sizes the drawing buffer from a resize observer, which fires after `load`. Reading before it
 * does reports the 300x150 HTML default and asserts nothing about the renderer.
 */
async function readCanvas(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('canvas')).some(
        (element) => element.width > 300 && element.height > 150,
      ),
    { timeout: 30_000 },
  )
  const canvas = await page.evaluate(() => {
    // Pick the largest canvas: postprocessing and some dev tooling add their own, and the first
    // one in the document is not necessarily the scene's.
    const all = Array.from(document.querySelectorAll('canvas'))
    const element = all.sort((a, b) => b.width * b.height - a.width * a.height)[0]
    if (!element) return null
    const context = element.getContext('webgl2')
    const debug = context?.getExtension('WEBGL_debug_renderer_info')
    return {
      count: all.length,
      width: element.width,
      height: element.height,
      webgl2: context !== null,
      version: context?.getParameter(context.VERSION) ?? null,
      // Which driver actually drew this. The whole point of the self-check.
      gpu: context
        ? String(
            debug
              ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : context.getParameter(context.RENDERER),
          )
        : null,
    }
  })
  if (!canvas) throw new Error('no <canvas> in the document')
  if (!canvas.webgl2) throw new Error('the canvas has no WebGL2 context')
  console.log(
    `  canvas ${canvas.width}x${canvas.height} (${canvas.count} on the page), ${canvas.version}`,
  )
  console.log(`  GPU: ${canvas.gpu}`)
  return canvas
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

/** Phase 4's app shell: PRD section 6's interaction requirements, end to end. */
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

/**
 * Phase 5's accessibility checklist, in the only place it can honestly be checked.
 *
 * `test/design.test.ts` proves the contrast arithmetic on the token values, and
 * `test/dialog.test.ts` proves the tab-order arithmetic. Neither can say whether the stylesheet
 * actually *uses* those tokens, whether the focus trap holds against a real browser's focus model,
 * or whether the self-hosted face loaded. That is what this is for. Each block below names the
 * requirement it is standing in for.
 */
async function verifyAccessibility(page, url, log) {
  console.log('  -- Phase 5: design system and accessibility --')

  // A CSP violation is a console error, which `watch` already collects — but the message is easy
  // to lose in a long run, so the report is made explicit and attributed to a directive.
  const violations = []
  await page.exposeFunction('reportCspViolation', (directive, blocked) => {
    violations.push(`${directive} blocked ${blocked}`)
  })
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      window.reportCspViolation(event.effectiveDirective, event.blockedURI || '(inline)')
    })
  })

  /*
   * A plane route, not the root, and for two reasons.
   *
   * The breadcrumb only has an *ancestor* segment below the multiverse, and the ancestor and the
   * current segment are the two ends of the HUD's contrast range — at the root there is only one
   * crumb and it is the current one, so the probe below would compare `--ink` against itself and
   * pass while proving nothing.
   *
   * It also puts the drawer on screen, which makes the focus-trap check meaningfully harder: the
   * panel's set rows are focusable, outside the dialog, and behind the scrim. If the trap leaks,
   * Tab lands on one of them.
   */
  // Which plane, read from the fixture rather than hard-coded — the two fixtures and the real
  // dataset each put cards somewhere different. Derived here rather than handed over, so this
  // verifier stands alone the way the others do.
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
  const slug = await page.evaluate(async () => {
    const base = document.querySelector('meta[name="eternities:data"]')?.getAttribute('content')
    const file = await (await fetch(`${base}planes.json`)).json()
    return file.planes.find(
      (plane) => plane.slug !== 'blind-eternities' && plane.cardCount > 0 && plane.sets.length > 0,
    )?.slug
  })
  check(slug, 'planes.json has no plane with cards and sets to open the drawer on')

  const response = await page.goto(`${url}/plane/${slug}`, {
    waitUntil: 'networkidle0',
    timeout: 60_000,
  })
  await waitForDataset(page)
  await page.waitForSelector('.drawer-open .set-row', { timeout: 30_000 })

  // --- fonts are self-hosted and actually in use (PRD 7.6.1) --------------------------------
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
  check(/^["']?Inter/.test(fonts.family), `body font-family is ${fonts.family}, expected Inter`)
  check(fonts.loaded, 'the Inter faces did not load — the page is on the fallback stack')
  check(fonts.origins.length > 0, 'no .woff2 was fetched at all')
  const foreign = fonts.origins.filter((origin) => origin !== new URL(url).origin)
  check(foreign.length === 0, `a font came from a third party: ${foreign.join(', ')}`)
  log(`  fonts: Inter loaded, ${String(fonts.origins.length)} face(s), all same-origin`)

  // --- the stylesheet uses the tokens the contrast proof is about (PRD 7.5.4) ---------------
  // `test/design.test.ts` proves `--ink-muted` clears 4.5:1 on every surface. That proof is worth
  // nothing if a rule quietly paints with something else, so the computed colours are compared
  // back to the tokens here — the one seam the Node-side test cannot see across.
  const painted = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const token = (name) => root.getPropertyValue(name).trim()
    const colourOf = (selector) => {
      const element = document.querySelector(selector)
      return element === null ? null : getComputedStyle(element).color
    }
    // `getComputedStyle().color` is always `rgb(r, g, b)`; the tokens are hex. Normalise via a
    // throwaway element rather than by parsing, so the browser does the conversion.
    const asRgb = (value) => {
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
    check(value !== null, `the token probe found no element for ${name}`)
  }
  for (const [name, value] of [
    ['the current breadcrumb', painted.crumbCurrent],
    ['the plane panel title', painted.oracle],
  ]) {
    check(value === painted.ink, `${name} paints ${value}, not --ink ${painted.ink}`)
  }
  for (const [name, value] of [
    ['an ancestor crumb', painted.crumb],
    ['a cluster control', painted.control],
    ['a set row year', painted.setYear],
  ]) {
    check(value === painted.muted, `${name} paints ${value}, not --ink-muted ${painted.muted}`)
  }
  log('  contrast: the HUD paints with the tokens the proof in test/design.test.ts is about')

  // --- modal focus behaviour (PRD 7.5.2) ----------------------------------------------------
  // Driven from the keyboard throughout: focusing the control and pressing Enter is what a
  // keyboard user does, and unlike a click it leaves no doubt about where focus started.
  await page.focus('[aria-label="Plane index"]')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.plane-list', { timeout: 5000 })

  const opened = await page.evaluate(() => ({
    inside: document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
    tag: document.activeElement?.className ?? '',
  }))
  check(opened.inside, 'opening the plane index left focus outside the dialog')
  check(
    opened.tag.includes('sheet-filter'),
    `the plane index opened on ${JSON.stringify(opened.tag)}, expected the filter box`,
  )

  // Tab far enough to pass the end of the sheet and wrap. `aria-modal="true"` promises everything
  // outside is inert; if Tab can reach the HUD, the promise is a lie and a keyboard user is
  // tabbing through controls their screen reader says do not exist.
  let escaped = null
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
  check(escaped === null, `the plane index does not trap focus: ${escaped}`)

  // A visible focus state, and specifically the sandwich — a bare accent ring is only 1.99:1 on a
  // bloomed star, so "there is an outline" is not the assertion worth making.
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow)
  check(ring !== 'none' && ring.split('rgb').length >= 3, `focus ring is ${JSON.stringify(ring)}`)

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.plane-list') === null, { timeout: 5000 })
  const restored = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? null,
  )
  check(
    restored === 'Plane index',
    `closing the dialog left focus on ${JSON.stringify(restored)}, not the control that opened it`,
  )
  log('  keyboard: the sheet opens focused, traps Tab, shows a ring, and hands focus back')

  // The search box is the other shape: one tabbable element, with `aria-activedescendant` rows.
  // Tab has nowhere to go, and "nowhere to go" must mean "stay", not "leave".
  await page.keyboard.press('/')
  await page.waitForSelector('.search-input', { timeout: 5000 })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const search = await page.evaluate(() => document.activeElement?.className ?? '')
  check(search.includes('search-input'), `Tab left the search box and landed on ${search}`)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.search-input') === null, {
    timeout: 5000,
  })
  log('  keyboard: the search combobox holds focus on its input')

  // --- the About view (PRD 4.11) ------------------------------------------------------------
  await page.focus('[aria-label="Help"]')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[aria-label="Help"][role="dialog"], .sheet', { timeout: 5000 })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.sheet-foot button')].find((element) =>
      /about/i.test(element.textContent ?? ''),
    )
    if (!button) throw new Error('the help sheet has no route to the About view')
    button.click()
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="About"]') !== null,
    { timeout: 5000 },
  )
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
    check(about.text.includes(clause), `the About view is missing the clause ${JSON.stringify(clause)}`)
  }
  // PRD 4.11.2: Scryfall credited as the source of the data *and* the images.
  check(/Scryfall/.test(about.text), 'the About view does not credit Scryfall')
  check(
    about.links.some((link) => link.href.startsWith('https://scryfall.com')),
    'the About view has no link to Scryfall',
  )
  check(about.links.length >= 2, `the About view has ${String(about.links.length)} link(s)`)
  // PRD 7.6.2, on the only page in the product with external links on it.
  for (const link of about.links) {
    check(
      link.rel.includes('noopener') && link.rel.includes('noreferrer'),
      `${link.href} opens with rel="${link.rel}"`,
    )
    check(link.target === '_blank', `${link.href} has target="${link.target}"`)
  }
  await page.keyboard.press('Escape')
  log(`  About: the Fan Content notice, the Scryfall credit, ${String(about.links.length)} safe links`)

  // --- reduced motion (PRD 5.9, 7.5.1) ------------------------------------------------------
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(`${url}/`, { waitUntil: 'networkidle0' })
  await waitForDataset(page)
  const motion = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      tokens: ['--dur-fast', '--dur-base', '--dur-slow'].map((name) =>
        root.getPropertyValue(name).trim(),
      ),
      // The blanket rule is the belt to the tokens' braces: it catches anything that transitions
      // without reading a token, including a future dependency's stylesheet.
      control: getComputedStyle(document.querySelector('.control')).transitionDuration,
    }
  })
  check(
    motion.tokens.every((value) => value === '0ms'),
    `the duration tokens are ${motion.tokens.join(', ')} under reduced motion`,
  )
  check(
    Number.parseFloat(motion.control) < 0.05,
    `a control still transitions for ${motion.control} under reduced motion`,
  )
  await page.emulateMediaFeatures([])
  log('  reduced motion: duration tokens collapse to 0ms and nothing animates')

  // --- the audited headers actually arrive (PRD 7.6.1) --------------------------------------
  const headers = response?.headers() ?? {}
  const csp = headers['content-security-policy'] ?? ''
  check(
    /(^|;\s*)style-src 'self'(;|$)/.test(csp),
    `style-src is not the audited value: ${JSON.stringify(/style-src[^;]*/.exec(csp)?.[0] ?? '')}`,
  )
  check(csp.includes("style-src-attr 'unsafe-inline'"), 'style-src-attr is missing from the policy')
  check(csp.includes("font-src 'self'"), 'font-src is missing from the policy')
  check(
    (headers['strict-transport-security'] ?? '').includes('max-age='),
    'the audit added HSTS, and it did not arrive',
  )
  check(
    violations.length === 0,
    `the page violated its own policy:\n  - ${violations.join('\n  - ')}`,
  )
  log('  CSP: style-src tightened to \'self\', no violations, HSTS present')
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

/**
 * Phase 2b's harness: the navigation contract driving the real camera rig.
 *
 * Behind `?harness=2b` since Phase 4 took the default route. The scene, and therefore every
 * assertion below, is unchanged — only the URL that reaches it is.
 */
async function verifyNavigation(page, url, roster, problems) {
  console.log('  -- Phase 2b: navigation, labels, plane detail --')
  const response = await page.goto(`${url}/?harness=2b`, { waitUntil: 'load', timeout: 60_000 })
  const csp = response?.headers()['content-security-policy']
  if (!csp) throw new Error('the preview server sent no Content-Security-Policy header')
  if (csp.includes("'unsafe-inline'") && csp.includes('script-src')) {
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? ''
    if (scriptSrc.includes("'unsafe-inline'")) {
      throw new Error(`the production policy must not relax script-src: ${scriptSrc}`)
    }
  }
  console.log(`  CSP: ${csp}`)

  const cameraProbe = () =>
    page.evaluate(() => document.querySelector('[data-testid="camera"]')?.textContent ?? '')
  const cameraDistance = async () =>
    Number.parseFloat((await cameraProbe()).split('· d ')[1] ?? 'NaN')
  /** Wait for the status panel to match, i.e. for the rig to have got there. */
  const waitForStatus = (pattern, timeout = 30_000) =>
    page.waitForFunction(
      (source) =>
        new RegExp(source).test(
          document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
        ),
      { timeout },
      pattern.source,
    )

  // The rig is up, and PRD 6.8.2's intro has flown in and settled: `flight: idle` at the
  // multiverse focus is checkpoint 1 of PRD 9.3, the home view after the intro.
  await waitForStatus(/focus: multiverse/)
  await waitForStatus(/flight: idle/, 30_000)
  const homeDistance = await cameraDistance()
  console.log(`  intro settled at the home view, ${homeDistance.toFixed(1)} from the centre`)
  if (!(homeDistance > 0) || homeDistance > 600) {
    throw new Error(`the intro did not fly in: still ${homeDistance} from the centre`)
  }

  await readCanvas(page)

  // PRD 5.3.8: plane names as HTML overlay billboards, never 3D text. Wait for the layout solver to
  // have run at least one frame and made some of them visible. "Some" is relative to the roster:
  // `fixture-small` has four labelled planes in total, so a fixed floor of ten could only ever be
  // a fixture-scale assertion that silently failed everywhere else.
  const visibleFloor = Math.min(10, Math.max(1, Math.floor(roster.labelled / 2)))
  await page.waitForFunction(
    (floor) =>
      Array.from(document.querySelectorAll('.label')).filter(
        (node) => Number.parseFloat(node.style.opacity || '0') > 0.05,
      ).length >= floor,
    { timeout: 30_000 },
    visibleFloor,
  )
  const labels = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.label'))
    const visible = nodes.filter((n) => Number.parseFloat(n.style.opacity || '0') > 0.05)
    return {
      total: nodes.length,
      visible: visible.length,
      sample: visible.slice(0, 3).map((n) => n.textContent ?? ''),
    }
  })
  console.log(
    `  labels: ${labels.visible} of ${labels.total} visible (floor ${visibleFloor}), e.g. ${labels.sample.join(', ')}`,
  )
  // At multiverse focus there are no band labels, so the overlay is exactly the labelled planes.
  if (labels.total < roster.labelled) {
    throw new Error(
      `only ${labels.total} plane labels were created, expected ${roster.labelled} for this roster`,
    )
  }

  // PRD 5.7.2 / 6.1.3: fly to the Blind Eternities and back. The harness binds 'b' and Escape;
  // Phase 4 binds the real controls, and this is what proves the contract drives a real camera.
  const beforeFly = await cameraProbe()

  await page.keyboard.press('b')
  await waitForStatus(/focus: plane \(blind-eternities\)/, 15_000)
  await waitForStatus(/flight: idle/, 20_000)
  const dustDistance = await cameraDistance()
  console.log(`  flew to the Blind Eternities and settled ${dustDistance.toFixed(1)} out`)
  // PRD 5.3.4: the dust anchor tethers with *plane-level* distance limits, so arriving there
  // must leave the camera an order of magnitude closer than the multiverse home view.
  if (!(dustDistance < homeDistance / 2)) {
    throw new Error(
      `the Blind Eternities fly-to did not reach plane level: ${dustDistance} vs home ${homeDistance}`,
    )
  }

  // PRD 8.7.6 + amendment A1: every shard of the focused plane, fetched and parsed in the worker.
  // The shard count is the fixture's, not a constant — the dust is four shards at fixture-scale
  // and one at fixture-small.
  const detailPattern = new RegExp(
    `detail: ${BLIND_ETERNITIES_SLUG} \\d+ cards over ${roster.shards} shard\\(s\\) \\(sharded, worker-parsed\\)`,
  )
  await page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
      ),
    { timeout: 30_000 },
    detailPattern.source,
  )
  const detail = await page.evaluate(
    () =>
      /detail: [^\n]*/.exec(
        document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
      )?.[0] ?? '',
  )
  console.log(`  ${detail}`)

  const afterFly = await cameraProbe()
  if (beforeFly === afterFly) {
    problems.push(`the camera did not move: still at ${afterFly}`)
  } else {
    console.log(`  the camera moved: ${beforeFly}  ->  ${afterFly}`)
  }

  await page.keyboard.press('Escape')
  await waitForStatus(/focus: multiverse/, 15_000)
  await waitForStatus(/flight: idle/, 20_000)
  const backDistance = await cameraDistance()
  console.log(`  Esc returned to the multiverse, ${backDistance.toFixed(1)} from the centre`)
  if (!(backDistance > dustDistance * 2)) {
    throw new Error(`Esc did not fly back out: ${backDistance} vs ${dustDistance}`)
  }
}

/** Phase 2a's harness: the contract decoders, the star field, and the GPU self-check. */
async function verifyStarField(page, url, allowSoftware, problems) {
  console.log('  -- Phase 2a: contract decode, star field, GPU self-check --')
  // `load`, not `networkidle0`: since Phase 2a the canvas animates continuously and the star
  // field keeps a software renderer busy, so "the network went quiet" is not a signal worth
  // waiting on. The assertions below wait on the page's own state instead.
  await page.goto(`${url}/?selfcheck=1`, { waitUntil: 'load', timeout: 60_000 })

  // Wait for the decode report to land (or fail loudly).
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="phase0-status"]')
      return panel !== null && /data directory|FAILED/.test(panel.textContent ?? '')
    },
    { timeout: 30_000 },
  )
  // The last line only appears once every artefact has decoded.
  await page.waitForFunction(
    () =>
      /plane shard |FAILED/.test(
        document.querySelector('[data-testid="phase0-status"]')?.textContent ?? '',
      ),
    { timeout: 60_000 },
  )

  const report = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="phase0-status"]')
    const list = panel?.querySelector('ul')
    return {
      ok: list?.classList.contains('ok') ?? false,
      lines: Array.from(list?.querySelectorAll('li') ?? []).map((li) => li.textContent ?? ''),
    }
  })
  for (const line of report.lines) console.log(`  ${line}`)
  if (!report.ok) throw new Error('the data contract decode report reported a failure')

  const canvas = await readCanvas(page)
  if (SOFTWARE_RENDERER.test(canvas.gpu ?? '')) {
    const message =
      `Chrome fell back to a software rasteriser (${canvas.gpu}). The GPU self-check below ` +
      `is cited as the mitigation for driver variance and cannot establish it from software.`
    if (!allowSoftware) {
      throw new Error(
        `${message}\n  Re-run on a machine with a working GPU, or pass --allow-software to accept a software run.`,
      )
    }
    console.log(`  WARNING: ${message} Continuing because --allow-software was passed.`)
  }

  // Every record drawable and every plane revealed: the streaming loader of PRD 8.7.3 reached
  // the end and the per-plane fade-in of PRD 6.8.1 fired for each one.
  await page.waitForFunction(
    () =>
      /\(complete\)/.test(document.querySelector('[data-testid="scene-status"]')?.textContent ?? ''),
    { timeout: 120_000 },
  )
  const scene = await page.evaluate(
    () => document.querySelector('[data-testid="scene-status"]')?.textContent ?? '',
  )
  console.log(`  scene: ${scene.replace(/\s+/g, ' ').trim().slice(0, 160)}`)

  // PRD 8.5.6 and 8.5.7 checked against each other on the GPU: the CPU motion mirror's world
  // position, projected to a pixel, has to pick the same star back out of the id buffer.
  await page.waitForFunction(() => window.__eternitiesSelfCheck !== undefined, {
    timeout: 120_000,
    polling: 250,
  })
  const selfCheck = await page.evaluate(() => window.__eternitiesSelfCheck)
  console.log(
    `  id-buffer picking vs CPU motion mirror: the shader drew ${selfCheck.measured}/` +
      `${selfCheck.checked} sampled stars a mean of ${selfCheck.meanOffsetPx}px ` +
      `(max ${selfCheck.maxOffsetPx}px, tolerance ${selfCheck.tolerancePx}px) from the pixel ` +
      `the mirror predicted; ${selfCheck.unmeasured} not in window` +
      (selfCheck.unmeasuredRows.length > 0
        ? ` (plane rows ${selfCheck.unmeasuredRows.map(([row, n]) => `${row}x${n}`).join(' ')})`
        : ''),
  )
  console.log(
    `    of those ${selfCheck.measured} the pointer would have selected ${selfCheck.agreed} ` +
      `exactly and ${selfCheck.occluded} via a nearer star (${selfCheck.offScreen} off screen, ` +
      `${selfCheck.positionMode} positions, buffer ${selfCheck.buffer.join('x')}, ` +
      `${selfCheck.spriteFloorPx}px pick sprite)`,
  )
  console.log(
    `    samples per plane row: ` + selfCheck.sampledRows.map(([row, n]) => `${row}x${n}`).join(' '),
  )
  if (selfCheck.canvasBytes < 5000) {
    problems.push(`the canvas looks empty (${selfCheck.canvasBytes}-byte PNG) — nothing drew`)
  } else {
    console.log(`  star field drew (${selfCheck.canvasBytes}-byte PNG round-trip)`)
  }

  // A drift too small to trip any single sample still moves the mean. Measured on Metal at the
  // 2px self-check sprite: 0.29-0.33px on fixture-small and 0.21px on fixture-scale, most of which is
  // the pixel quantisation of the window itself. 1.5px is a real bound, not a formality — it is
  // five times the observed figure, and a uniform 2 world-unit drift on one plane row of
  // `fixture-small` takes the mean to 1.61px.
  if (selfCheck.meanOffsetPx > 1.5) {
    throw new Error(
      `the shader draws stars a mean of ${selfCheck.meanOffsetPx}px from where the CPU motion ` +
        `mirror puts them — that is a systematic disagreement, not quantisation`,
    )
  }

  if (!selfCheck.ok) {
    for (const miss of selfCheck.missed.slice(0, 8)) {
      console.log(
        `    star ${miss.index} (plane row ${miss.planeRow}): mirror says ${miss.x},${miss.y} ` +
          `(z ${miss.z}), shader drew it ${miss.drawnAtPx}px away; pointer would pick ${miss.picked}`,
      )
    }
    // An error too large to measure looks like agreement: every star on the row is outside its
    // own pick window, so none of them lands in `missed` and the mean improves. The row going
    // dark is the only trace it leaves, and it is the trace of the worst version of the bug.
    //
    // Built before the miss throw rather than after it. Both conditions can hold in one run, and
    // the misses throw first, so a dark row reported only from its own throw would be lost in
    // exactly the runs that have the most wrong with them.
    const darkRows =
      selfCheck.darkRows.length > 0
        ? `the self-check could not locate the stars of plane ` +
          `${selfCheck.darkRows.length === 1 ? 'row' : 'rows'} ` +
          `${selfCheck.darkRows.map(([row, dark, n]) => `${row} (${dark} of ${n} samples missing from their own pick window)`).join(', ')} ` +
          `— a whole well-sampled row going dark is what a motion-mirror error too large to ` +
          `measure looks like, not what occlusion looks like`
        : ''

    if (selfCheck.missed.length > 0) {
      throw new Error(
        `the CPU motion mirror disagrees with the vertex shader for ${selfCheck.missed.length} ` +
          `stars — PRD 8.5.7's camera tether would frame the wrong point` +
          (darkRows === '' ? '' : `. And in the same run, ${darkRows}`),
      )
    }
    if (darkRows !== '') throw new Error(darkRows)
    throw new Error(
      `the self-check located only ${selfCheck.measured} of ${selfCheck.checked} sampled stars ` +
        `in their own pick window — too few to establish PRD 8.5.7 either way`,
    )
  }
}

async function verify(dataset, allowSoftware) {
  console.log(`\n=== ${dataset} ===`)
  const roster = readRoster(dataset)
  console.log(
    `  roster ${roster.hash}: ${roster.planes} planes, ${roster.labelled} labelled, ` +
      `the dust over ${roster.shards} shard(s)`,
  )

  execFileSync('pnpm', ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: 'inherit',
  })

  const { child, url } = await startPreview(dataset)
  // The same launch `bench.mjs` uses. This check is cited as the mitigation for PRD risk 6 and for
  // driver variance, and it cannot say anything about driver variance from a software rasteriser:
  // the GPU self-check has to run on a GPU. `--enable-unsafe-swiftshader` stays only so that a
  // fallback surfaces as the assertion below rather than as a crash with no explanation.
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--use-angle=metal',
      '--enable-unsafe-swiftshader',
    ],
  })

  const problems = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    watch(page, problems)

    const log = (line) => console.log(line)
    // Phase 4's shell first, on a fresh profile: its first-visit-hint assertions (PRD 6.8.3) only
    // mean something before anything has dismissed the hint.
    await verifyShell(page, url, log)
    // After the shell, because it needs the first-visit hint already dismissed — the hint takes
    // focus on purpose (PRD 6.8.3) and would answer every focus question below for itself.
    await verifyAccessibility(page, url, log)
    await verifyWebGL2Fallback(browser, url, log)
    await verifyNavigation(page, url, roster, problems)
    await verifyStarField(page, url, allowSoftware, problems)

    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n  - ${problems.join('\n  - ')}`)
    }
    console.log(
      `  OK — ${dataset} drives PRD section 6 in the shell, and both harnesses hold, ` +
        `under the production CSP`,
    )
  } finally {
    await browser.close()
    child.kill('SIGTERM')
  }
}

const args = parseArgs(process.argv.slice(2))
const datasets = args.dataset === 'all' ? ['small', 'scale'] : [args.dataset]
for (const dataset of datasets) {
  await verify(dataset, args.allowSoftware)
}
console.log('\nall datasets verified in the browser')
