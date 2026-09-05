#!/usr/bin/env node
/**
 * Exit-criteria check, in a real browser.
 *
 * Builds the site against a dataset, serves it through `vite preview` (which sends the *production*
 * PRD 7.6.1 headers, not the dev-server relaxation), drives a local Chrome at it, and asserts every
 * shipped phase's criteria. They live in the app shell, Phase 3's scene and Phase 2a's harness,
 * which `App` routes between, so this is several page loads against the one preview server, sharing
 * one problem collector.
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
 * `?harness=3` — Phase 3's scene, which replaces Phase 2b's harness: one canvas, one camera, one
 * picker, the star field and the camera rig folded together. Phase 4 took the default route, so it
 * sits behind a flag exactly as 2b's harness did:
 *
 *  10. `planes.json` decodes and the camera rig comes up on it;
 *  11. the label overlay places plane names as HTML billboards (PRD 5.3.8);
 *  12. **navigation works end to end**: a keypress flies the camera to the Blind Eternities, the
 *      focus changes, the camera actually moves, and Esc brings it back (PRD 5.7.2, 6.1.3);
 *  13. plane detail loads through the worker, shard by shard, on focus (PRD 8.7.6, amendment A1) —
 *      the Blind Eternities is the sharded one, so it is the one this drives;
 *  14. **the star field is in that same scene**: the rig now flies over the real field rather than
 *      over Phase 0's backdrop, which is the integration Phase 3 inherited.
 *
 * `?probe=1` — Phase 3's card tier, driven through the seam of `src/scene/probe.ts`:
 *
 *  15. the multiverse → plane → card journey, end to end: fly to a plane, its shards land, focus a
 *      card, the card object appears with its planets (PRD 5.6.1-8);
 *  16. the thumbnail tier fetches nearest-first under PRD 7.2's six-request cap, never exceeding it;
 *  17. a printing is activated (PRD 5.6.9) and a double-faced card is flipped (PRD 5.6.5);
 *  18. GPU memory stays inside PRD 7.2's 96 MB target, measured rather than estimated.
 *
 * `?selfcheck=1` — Phase 2a's instrumentation harness, which still owns the bench and the GPU
 * self-check because both drive the camera themselves:
 *
 *  19. the page renders a WebGL2 canvas — the star field of PRD 5.3.18 actually draws;
 *  20. the fixture decodes: manifest, planes.json, streamed stars.bin, search.json, sets.bin and
 *      a plane detail shard all come back through the contract decoders;
 *  21. the GPU self-check of PRD 8.5.7 — that the CPU motion mirror agrees with the vertex shader
 *      — passes on this machine's actual driver.
 *
 * The shell's canvas is still Phase 0's hello-scene: Phase 3 folded 2a's field into 2b's rig, but
 * mounting that folded scene *inside* the shell means giving the shell the real navigation instead
 * of the Phase 0 stub `app/services` still returns, which would re-point every assertion above at
 * behaviour no review has seen. That join is Phase 6's, and until it lands each phase's exit
 * criteria stay checkable exactly as reviewed.
 *
 * And across all of them: nothing blocked by the Content Security Policy (including `worker-src`
 * and the `connect-src` grant for Scryfall), no console error and no failed request from our own
 * origin.
 *
 * **On Scryfall images.** Only the production dataset carries real Scryfall printing ids; the
 * fixtures are synthetic, so every image request against them 404s. That is not a gap in the check
 * — it is PRD 7.4.2's path, and asserting it is how "a failed image leaves the star glow or the
 * previous image in place; nothing renders as a broken rectangle" gets tested at all. Pass
 * `--dataset production` for the run where the images actually arrive.
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
 *   node scripts/verify-browser.mjs [--dataset small|scale|production|all] [--keep] [--allow-software]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  const args = { dataset: 'scale', keep: false, allowSoftware: false, shots: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--keep') args.keep = true
    else if (argv[i] === '--allow-software') args.allowSoftware = true
    // PRD 9.3's visual review: write the checkpoint frames this run can reach to a directory.
    else if (argv[i] === '--shots') args.shots = argv[++i]
  }
  return args
}

/**
 * Frame times over `seconds`, sampled in the page.
 *
 * PRD 7.2 asks for the steady-state frame rate "at every level", and the bench of PRD 9.1.2 flies a
 * scripted path that predates the card tier — so at card level, with an atlas full of thumbnails
 * and 72 planets orbiting, this is the only measurement there is until Phase 6 rebuilds `/bench`
 * against the folded scene.
 */
async function sampleFrames(page, seconds) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const samples = []
        let last = performance.now()
        const stop = last + duration * 1000
        const tick = () => {
          const now = performance.now()
          samples.push(now - last)
          last = now
          if (now < stop) requestAnimationFrame(tick)
          else {
            const sorted = [...samples].sort((a, b) => a - b)
            const total = samples.reduce((sum, ms) => sum + ms, 0)
            resolve({
              frames: samples.length,
              fps: Math.round(((samples.length * 1000) / total) * 100) / 100,
              p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 100) / 100,
              p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
              max: Math.round(sorted[sorted.length - 1] * 100) / 100,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
    seconds,
  )
}

/** A software rasteriser answering as the GPU. `bench.mjs` refuses these; so does this. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|mesa offscreen/i

/**
 * A dataset name resolved the same way `vite.config.ts` resolves it: a fixture name, then any other
 * top-level key of `datasets.json` (`production`, `active`), then a raw hash. Keeping the two in
 * step is what lets `--dataset production` mean the same thing here and in the build.
 */
function resolveDataset(registry, name) {
  if (registry.fixtures?.[name]) return registry.fixtures[name]
  if (typeof registry[name] === 'string') return registry[name]
  return name
}

/**
 * What the build will point at. The assertions below are stated relative to this roster.
 */
function readRoster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = resolveDataset(registry, dataset)
  const root = resolve(WEB_ROOT, 'public/data', hash)
  const planes = JSON.parse(readFileSync(resolve(root, 'planes.json'), 'utf8')).planes
  // PRD 5.3.4: the dust is deliberately unlabelled, so it is not one of the billboards.
  const labelled = planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG).length
  const shards = readdirSync(resolve(root, 'planes')).filter((name) =>
    name.startsWith(`${BLIND_ETERNITIES_SLUG}.`),
  ).length
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
  // Only a real Scryfall run carries real printing ids; a fixture's are synthetic and every image
  // request against them 404s. `scryfallBulkUpdatedAt` is the pipeline's own record of which it is.
  const realImages = typeof manifest.scryfallBulkUpdatedAt === 'string'
  return { hash, planes: planes.length, labelled, shards, stars: manifest.counts.stars, realImages }
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

/**
 * Collects every console error, page error and failed request for one page, and counts the
 * Scryfall ones separately.
 *
 * A failing request to *our own origin* is a defect. A failing request to Scryfall is not
 * necessarily one, and on a fixture it is guaranteed: the ids are synthetic, so every image 404s by
 * construction, and PRD 7.4.2's promise — the glow stays, nothing renders as a broken rectangle —
 * is exactly what those 404s are there to exercise. They are counted and reported rather than
 * treated as failures, and `verifyCardTier` asserts on the count.
 *
 * `net::ERR_ABORTED` on a Scryfall URL is this build's own `ImageQueue.cancel` working.
 *
 * Returns the upstream tally, which is live — the caller reads it after the assertions have run.
 */
function watch(page, problems) {
  const scryfall = (url) => url.includes('scryfall.io')
  const upstream = { failed: 0, aborted: 0 }

  page.on('console', (message) => {
    const text = message.text()
    // A resource 404 is reported twice: once blind by the console, once with a URL by `response`.
    if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
      problems.push(`console error: ${text}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    if (scryfall(response.url())) {
      upstream.failed += 1
      return
    }
    problems.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('requestfailed', (request) => {
    if (scryfall(request.url())) {
      upstream.aborted += 1
      return
    }
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`)
  })

  return upstream
}

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const route = (page) => page.evaluate(() => location.pathname + location.search)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The development readout is on screen, not merely in the DOM.
 *
 * Every other assertion in this file reads the panel's `textContent`, and `textContent` is happy
 * with a node that never paints. It was: for two phases both scenes asked for `class="overlay"`,
 * Phase 5's stylesheet had no such rule, and the panel laid out `position: static` after a canvas
 * that already fills `.app` — a viewport below the fold, on a `body` with `overflow: hidden`. The
 * whole suite stayed green through it. That is the class of defect a text-only assertion cannot
 * see, so this one is deliberately not about text.
 *
 * Three things are asked, because each catches a different way to be invisible:
 *
 *  - `checkVisibility` for `display: none`, `visibility: hidden`, zero opacity and an unrendered
 *    subtree — the failures that leave a box behind;
 *  - the intersection with the viewport, for the failure that actually happened: a laid-out,
 *    perfectly visible box positioned somewhere nobody can see;
 *  - `position`, because `static` is what put it there, and naming it makes the diagnosis obvious
 *    from the message alone.
 *
 * Occlusion is out of scope here: `pointer-events: none` takes the panel out of hit testing on
 * purpose (the harness clicks stars through this corner), so `elementsFromPoint` would report the
 * canvas whatever the panel is doing. The check is geometry and computed style, as PRD 9.3's
 * follow-up asks.
 */
async function verifyStatusPanelPaints(page, testid, label) {
  const seen = await page.evaluate((id) => {
    const node = document.querySelector(`[data-testid="${id}"]`)
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0))
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0))
    return {
      rendered: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      onScreen: { width, height },
      position: style.position,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  }, testid)

  check(seen !== null, `${label}: the status panel [data-testid="${testid}"] is not in the DOM`)
  const where =
    `${Math.round(seen.box.width)}x${Math.round(seen.box.height)} at ` +
    `(${Math.round(seen.box.x)}, ${Math.round(seen.box.y)}) in a ` +
    `${seen.viewport.width}x${seen.viewport.height} viewport, position:${seen.position}`
  check(seen.rendered, `${label}: the status panel is in the DOM but does not render — ${where}`)
  check(
    seen.position !== 'static',
    `${label}: the status panel is statically positioned, so it lays out after the canvas that ` +
      `fills .app instead of over it — ${where}. Its textContent still reads, which is why only ` +
      `this assertion can see it. Check the .scene-status rule in styles.css.`,
  )
  // A tenth of the viewport in each axis: enough that a stray sliver poking in from off screen is
  // not mistaken for a panel that can be read, and far below anything the real rule produces.
  const floorW = seen.viewport.width / 10
  const floorH = seen.viewport.height / 10
  check(
    seen.onScreen.width >= floorW && seen.onScreen.height >= floorH,
    `${label}: the status panel is positioned off screen — only ${Math.round(seen.onScreen.width)}x` +
      `${Math.round(seen.onScreen.height)} of it is inside the viewport (${where})`,
  )
  console.log(
    `  the status panel paints: ${where}, ${Math.round(seen.onScreen.width)}x` +
      `${Math.round(seen.onScreen.height)} of it on screen`,
  )
}

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

  // --- 2b. a single colour excludes a multicolour card (PRD 6.6.2) -----------------------
  // The exact defect the board closed on 2026-09-04. Until contract v2 the colour facet evaluated
  // against the star record's *hue class*, so "multicolour" was one value and every coloured chip
  // admitted all of it — an Azorius card stayed lit under a red-only filter. Byte 7 now carries the
  // five-bit WUBRG identity (amendment A3) and the filter intersects against that.
  //
  // The expected count is computed here from `stars.bin` itself rather than hard-coded: the two
  // fixtures and the real dataset have different rosters, and a number that only holds on one of
  // them is not a check. The old semantics are computed alongside it, so the assertion fails both
  // when the filter over-matches and when the dataset has no multicolour card to exclude — which
  // would make the whole step vacuous.
  const colours = await page.evaluate(async () => {
    const base = document.querySelector('meta[name="eternities:data"]')?.getAttribute('content')
    const bytes = new Uint8Array(await (await fetch(`${base}stars.bin`)).arrayBuffer())
    // Contract §6: 16-byte header, then 12-byte records. Byte 7 packs the hue class in bits 0-2
    // and the colour identity in bits 3-7.
    const HEADER = 16
    const RECORD = 12
    const MULTICOLOUR = 5
    const total = (bytes.byteLength - HEADER) / RECORD
    const rows = ['W', 'U', 'B', 'R', 'G'].map((letter, bit) => ({
      letter,
      bit,
      identity: 0,
      hue: 0,
    }))
    for (let i = 0; i < total; i += 1) {
      const byte = bytes[HEADER + i * RECORD + 7]
      const hue = byte & 7
      const identity = (byte >> 3) & 31
      for (const row of rows) {
        if ((identity & (1 << row.bit)) !== 0) row.identity += 1
        // What the hue-class filter used to match: this class, plus all of multicolour.
        if (hue === row.bit || hue === MULTICOLOUR) row.hue += 1
      }
    }
    // The colour with the most gold cards to exclude, so the check bites as hard as the data allows.
    rows.sort((a, b) => b.hue - b.identity - (a.hue - a.identity))
    return { total, best: rows[0] }
  })
  check(
    colours.best.hue > colours.best.identity,
    `no colour in this dataset has a multicolour card to exclude — PRD 6.6.2's fix is untestable here`,
  )
  await page.goto(`${url}/?c=${colours.best.letter}`, { waitUntil: 'networkidle0' })
  await waitForDataset(page)
  const exact = await page.evaluate(() => document.querySelector('.chip-count')?.textContent ?? '')
  const exactCounts = /^([\d,]+) of ([\d,]+)/.exec(exact)
  const exactMatched = Number(exactCounts?.[1]?.replace(/,/g, '') ?? -1)
  check(
    Number(exactCounts?.[2]?.replace(/,/g, '') ?? -1) === colours.total,
    `the chip row counted against ${exact}, not the ${colours.total} stars in stars.bin`,
  )
  check(
    exactMatched === colours.best.identity,
    `?c=${colours.best.letter} matched ${exactMatched} cards; PRD 6.6.2's identity intersection is ` +
      `${colours.best.identity}. The old hue-class semantics gave ${colours.best.hue}.`,
  )
  log(
    `  exact colour: ?c=${colours.best.letter} → ${exactMatched} of ${colours.total}, ` +
      `${colours.best.hue - colours.best.identity} multicolour cards excluded (PRD 6.6.2)`,
  )

  // --- 3. plane panel set click adds a chip (PRD 6.4.3) ----------------------------------
  await page.goto(`${url}/plane/${roster.plane.slug}?c=W,U&r=rare`, { waitUntil: 'networkidle0' })
  await waitForDataset(page)
  await page.waitForSelector('.set-list .set-row', { timeout: 15_000 })
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
  // Phase 6 dropped it (csp-audit.md F5). Asserted absent rather than left unmentioned, so that
  // re-adding the relaxation has to argue with a failing check instead of sliding back in.
  check(
    !csp.includes('style-src-attr'),
    `style-src-attr came back: ${JSON.stringify(/style-src-attr[^;]*/.exec(csp)?.[0] ?? '')}`,
  )
  check(csp.includes("font-src 'self'"), 'font-src is missing from the policy')
  check(
    (headers['strict-transport-security'] ?? '').includes('max-age='),
    'the audit added HSTS, and it did not arrive',
  )
  check(
    violations.length === 0,
    `the page violated its own policy:\n  - ${violations.join('\n  - ')}`,
  )
  log("  CSP: style-src 'self' with no style-src-attr relaxation, no violations, HSTS present")
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
 * The scene: the navigation contract driving the real camera rig over the real star field.
 *
 * Behind `?harness=3` since Phase 4 took the default route — the same demotion main applied to
 * Phase 2b's harness, which this replaces. Phase 3 folded 2b's rig and 2a's field into one scene,
 * so every assertion 2b's harness answered is answered here, plus the one that says the rig and
 * the field really are the same scene.
 */
async function verifyNavigation(page, url, roster, problems) {
  console.log('  -- the scene: navigation, labels, plane detail, star field --')
  const response = await page.goto(`${url}/?harness=3`, { waitUntil: 'load', timeout: 60_000 })
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
          document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
        ),
      { timeout },
      pattern.source,
    )

  // The rig is up, and PRD 6.8.2's intro has flown in and settled: `flight: idle` at the
  // multiverse focus is checkpoint 1 of PRD 9.3, the home view after the intro.
  await waitForStatus(/focus: multiverse/)
  await waitForStatus(/flight: idle/, 30_000)
  // Before anything else reads this panel: it is on screen, and not just in the tree. See
  // `verifyStatusPanelPaints` — every assertion below is a `textContent` read and blind to it.
  await verifyStatusPanelPaints(page, 'eternities-status', '?harness=3')
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
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout: 30_000 },
    detailPattern.source,
  )
  const detail = await page.evaluate(
    () =>
      /detail: [^\n]*/.exec(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
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

  // Phase 3's integration, stated as an assertion rather than as a screenshot: the rig above and
  // the star field are the *same scene*. Before the fold, this page had no `stars.bin` at all — it
  // flew over Phase 0's background starfield — so a complete streamed field on the page that just
  // answered the navigation assertions is what says the two are one.
  await page.waitForFunction(
    () =>
      /\(complete\)/.test(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout: 120_000 },
  )
  const stars = await page.evaluate(
    () =>
      /stars: [^\n]*/.exec(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      )?.[0] ?? '',
  )
  console.log(`  ${stars}`)
  const drawn = Number.parseInt(/stars: (\d+)/.exec(stars)?.[1] ?? '0', 10)
  if (drawn !== roster.stars) {
    throw new Error(
      `the scene drew ${drawn} of ${roster.stars} stars — the rig and the field are not one scene`,
    )
  }
}


/**
 * Phase 3's card tier, end to end (PRD 5.5, 5.6, 7.2, 7.4.2).
 *
 * Driven through `?probe=1` (`src/scene/probe.ts`), which calls the product's own click handler
 * rather than a second implementation of it. What is asserted here is everything a screenshot
 * cannot settle: that the journey completes, that the ring layout matches the printing count, that
 * the six-request cap held, and that GPU memory stayed inside the budget.
 *
 * `imagesLoad` says whether the dataset's printing ids are real Scryfall ids. On a fixture they are
 * not, so every image 404s — and the assertions then switch to PRD 7.4.2's promise, which is the
 * more interesting half: no broken rectangles, no console noise, the journey still completes.
 */
/**
 * The scene's own drawing buffer, written to a PNG. **Not** `page.screenshot`.
 *
 * The canvas runs at the adaptive-quality pixel ratio — 1.5 — so its drawing buffer is half again
 * the size of the CSS box, and the compositor's capture of that did not agree with what the page
 * had drawn: it put the focused card in the top right of the frame while the probe, twice over,
 * reported it at the exact centre of the viewport (0.0000 world units off the camera's look-at
 * point, projecting to 50%, 50%). Reading the buffer back is what the page actually rendered, at
 * the resolution it rendered it, and it is the same route Phase 2a's GPU self-check takes for the
 * same reason. It needs `preserveDrawingBuffer`, which the scene turns on only for `?probe=1`.
 */
async function shoot(page, path) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      }),
  )
  const data = await page.evaluate(() => {
    const canvas = Array.from(document.querySelectorAll('canvas')).sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0]
    return canvas ? canvas.toDataURL('image/png') : null
  })
  if (!data) throw new Error('no canvas to capture')
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'))
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** PRD 7.2's GPU memory line, against whatever is focused when it is called. */
async function checkGpuMemory(state, what, problems) {
  const memory = (await state()).gpu
  console.log(
    `  GPU memory with ${what} focused: ${mb(memory.totalBytes)} (atlas ` +
      `${mb(memory.atlasBytes)}, card ${mb(memory.cardBytes)}) against a ` +
      `${mb(memory.targetBytes)} target / ${mb(memory.ceilingBytes)} ceiling`,
  )
  if (!memory.withinCeiling) {
    throw new Error(
      `PRD 7.2: ${mb(memory.totalBytes)} exceeds the ${mb(memory.ceilingBytes)} ceiling`,
    )
  }
  if (!memory.withinTarget) {
    problems.push(`PRD 7.2: ${mb(memory.totalBytes)} is over the ${mb(memory.targetBytes)} target`)
  }
  return memory
}

/** The HUD's hover line, which is what PRD 5.6.9's label is driven from. */
const readHover = (page) =>
  page.evaluate(() => document.querySelector('[data-testid="hover"]')?.textContent ?? '')

/** The canvas's CSS box, for turning a viewport fraction into a page coordinate. */
const canvasBox = (page) =>
  page.evaluate(() => {
    const canvas = Array.from(document.querySelectorAll('canvas')).sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0]
    const rect = canvas.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })

/**
 * PRD 5.6.9's planet hover and planet click, driven with a **real pointer**.
 *
 * Everything else about the planets in this file goes through `probe.activatePrinting()`, which
 * calls the card directly. That is how a picker that never reported a planet at all shipped: the
 * hover callback was deduplicated on the star index, a planet has none, and so the whole of PRD
 * 5.6.9 — the label on arrival, the label between two planets, the label clearing on leave, and the
 * click that reads the hovered printing — was dead in a way no assertion here could see.
 *
 * So the probe is used only to *aim*: it says where a planet is, the mouse is moved there, and
 * every assertion is read back out of the DOM, having gone through the id buffer and the same pick
 * path a user's pointer takes.
 */
async function verifyPlanetPointer(page, card, problems) {
  if (card.planets < 2) {
    console.log('  one planet or none on this card; PRD 5.6.9 pointer hover not exercised here')
    return
  }

  const box = await canvasBox(page)
  /** Move the pointer onto planet `index` and wait for the HUD to report it. Returns the HUD line. */
  const hoverPlanet = async (index) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      // Re-read each attempt: PRD 5.6.7's ring turns once a minute, so the target drifts.
      const at = await page.evaluate((i) => window.__eternitiesProbe.planetScreen(i), index)
      if (!at) return null
      await page.mouse.move(box.left + at.x * box.width, box.top + at.y * box.height)
      await new Promise((r) => setTimeout(r, 100))
      const hud = await readHover(page)
      if (hud.includes(`planet ${index}`)) return hud
    }
    return null
  }

  // Arriving from empty space. The pointer starts in the corner, which is sky.
  await page.mouse.move(box.left + 4, box.top + 4)
  await new Promise((r) => setTimeout(r, 200))
  const first = await hoverPlanet(0)
  if (!first) {
    throw new Error(
      'PRD 5.6.9: the pointer was moved onto planet 0 and the hover never reported a planet',
    )
  }
  console.log(`  pointer onto planet 0 from empty space: HUD reads "${first.trim()}"`)

  // Planet to planet: the label has to follow, not keep the first one.
  const second = await hoverPlanet(1)
  if (!second) {
    throw new Error('PRD 5.6.9: moving from planet 0 to planet 1 did not change the hover')
  }
  console.log(`  pointer onto planet 1: HUD reads "${second.trim()}"`)

  // PRD 5.6.9: clicking a planet activates *that* planet's printing. Read back through the probe
  // only after the click itself has gone through the picker.
  //
  // Confirmed under the pointer immediately before pressing: the ring turns, and a click that lands
  // a pixel off the planet is a click on empty space, which flies the camera to a plane and takes
  // the rest of this function with it.
  const before = await page.evaluate(() => window.__eternitiesProbe.state().card.activePrinting)
  const stillThere = (await readHover(page)).includes('planet 1')
  if (!stillThere) {
    problems.push('PRD 5.6.9: planet 1 drifted out from under the pointer before the click')
  } else {
    await page.mouse.down()
    await page.mouse.up()
    await new Promise((r) => setTimeout(r, 300))
    const level = await page.evaluate(() => window.__eternitiesProbe.state().level)
    if (level !== 'card') {
      throw new Error(
        `PRD 5.6.9: clicking a planet left the card and went to ${level} — the click did not ` +
          'resolve as a planet',
      )
    }
    const after = await page.evaluate(() => window.__eternitiesProbe.state().card.activePrinting)
    if (after === before) {
      problems.push(
        `PRD 5.6.9: clicking planet 1 left the active printing at ${before}; a click on a planet ` +
          'should activate its printing',
      )
    } else {
      console.log(`  clicking planet 1 activated printing ${after} (was ${before})`)
    }
  }

  // Leaving: the label must clear, or it hangs over empty sky.
  await page.mouse.move(box.left + 4, box.top + 4)
  let cleared = ''
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((r) => setTimeout(r, 100))
    cleared = await readHover(page)
    if (!cleared.includes('planet ')) break
  }
  if (cleared.includes('planet ')) {
    throw new Error(`PRD 5.6.9: leaving the planets left the hover reading "${cleared.trim()}"`)
  }
  console.log(`  pointer back to empty space: HUD reads "${cleared.trim()}"`)
}

async function verifyCardTier(page, url, imagesLoad, shots, problems) {
  console.log('  -- Phase 3: thumbnails, card, planets --')
  await page.goto(`${url}/?probe=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 60_000 })
  await page.waitForFunction(
    () =>
      /\(complete\)/.test(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout: 120_000 },
  )

  const state = () => page.evaluate(() => window.__eternitiesProbe.state())

  // PRD 5.7.2: fly to the largest plane. The card tier only exists where the cards are.
  const target = await page.evaluate(() => {
    const plane = window.__eternitiesProbe.planes()[0]
    window.__eternitiesProbe.focusPlane(plane.slug)
    return plane
  })
  console.log(`  flying to ${target.slug} (${target.cardCount} cards)`)
  await page.waitForFunction(
    (slug, wanted) => {
      const probe = window.__eternitiesProbe.state()
      return probe.planeSlug === slug && probe.cardsLoaded >= Math.min(wanted, 2000)
    },
    { timeout: 60_000 },
    target.slug,
    target.cardCount,
  )
  const atPlane = await state()
  console.log(`  plane focused, ${atPlane.cardsLoaded} card records from its shards`)

  // PRD 5.6.1: focus a card. This is the click handler's own path.
  const star = await page.evaluate(() => window.__eternitiesProbe.focusCard())
  if (star < 0) throw new Error('no card on the focused plane could be focused')
  await page.waitForFunction(() => window.__eternitiesProbe.state().card !== null, {
    timeout: 30_000,
  })
  await page.waitForFunction(() => !window.__eternitiesProbe.state().flying, { timeout: 30_000 })
  const focused = await state()
  const card = focused.card
  console.log(
    `  card focused: ${card.name}, ${card.printings} printing(s) -> ${card.planets} planet(s)` +
      (card.overflow > 0 ? `, ${card.overflow} listed in the panel` : '') +
      `, camera ${focused.cameraDistance.toFixed(2)} out`,
  )
  if (focused.level !== 'card') throw new Error(`the level did not reach card: ${focused.level}`)

  // PRD 5.6.1: "the camera flies to frame it". One number rather than a judgement about a
  // screenshot — the card is placed by the star field's motion function and the camera aims at the
  // rig's tether, and this is what says those are the same point.
  console.log(`  card framed ${focused.cardFrameOffset.toFixed(4)} world units off centre`)
  // Where that lands on screen, as a fraction of the viewport. The world-space number says the
  // camera aims at the card; this says the projection agrees, and the two together are what PRD
  // 5.6.1's "flies to frame it" actually promises.
  const onScreen = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const rect = canvas.getBoundingClientRect()
    return { cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height) }
  })
  console.log(`  canvas css box ${onScreen.cssWidth}x${onScreen.cssHeight}`)
  const screen = focused.cardScreen
  console.log(
    `  card projects to ${(screen.x * 100).toFixed(1)}%, ${(screen.y * 100).toFixed(1)}% of the ` +
      `viewport; eye-to-card ${focused.cardEyeDistance.toFixed(3)} against a rig radius of ` +
      `${focused.cameraDistance.toFixed(3)}`,
  )
  if (Math.abs(screen.x - 0.5) > 0.08 || Math.abs(screen.y - 0.5) > 0.08) {
    throw new Error(
      `PRD 5.6.1: the focused card projects to ${(screen.x * 100).toFixed(1)}%, ` +
        `${(screen.y * 100).toFixed(1)}% of the viewport rather than to its centre`,
    )
  }
  if (focused.cardFrameOffset > 0.05) {
    throw new Error(
      `PRD 5.6.1: the camera is framing a point ${focused.cardFrameOffset.toFixed(3)} units from ` +
        `the card it flew to, against a card 0.63 units wide`,
    )
  }

  // PRD 5.6.8's ring progression, against the card that actually got focused.
  const expectedPlanets =
    card.printings <= 1 ? 0 : Math.min(card.printings, 72)
  if (card.planets !== expectedPlanets) {
    throw new Error(
      `PRD 5.6.8: ${card.printings} printings should show ${expectedPlanets} planets, showed ${card.planets}`,
    )
  }
  if (card.overflow !== Math.max(0, card.printings - 72)) {
    throw new Error(`PRD 5.6.8: overflow should be ${card.printings - 72}, was ${card.overflow}`)
  }

  // PRD 5.5: the thumbnail tier. At card level the neighbours are at the cross-fade distance, so
  // this is where the card sheet tier is; the selector should have asked for images either way.
  //
  // Waited on the *queue draining*, not on a fixed delay: the assertions below are about what the
  // tier settled on, and a snapshot taken mid-flight reports cells that are merely claimed. A tier
  // that kept re-requesting failures forever would never drain, which is a failure worth having.
  await page.waitForFunction(
    () => {
      const q = window.__eternitiesProbe.state().images
      return q.inFlight === 0 && q.waiting === 0 && q.completed + q.failed > 0
    },
    { timeout: 90_000, polling: 500 },
  )
  await new Promise((r) => setTimeout(r, 1500))
  const withThumbs = await state()
  const t = withThumbs.thumbnails
  const images = withThumbs.images
  console.log(
    `  thumbnails: ${t.drawn} drawn, ${t.cells}/${t.capacity} cells, ` +
      `${t.requested} requested, ${t.loaded} loaded, ${t.failed} failed`,
  )
  console.log(
    `  image queue: peak ${images.peakInFlight} in flight, ${images.completed} completed, ` +
      `${images.failed} failed`,
  )
  // PRD 7.2: 6 concurrent requests, ceiling 8. Measured, not asserted from the constant.
  if (images.peakInFlight > 6) {
    throw new Error(`PRD 7.2: ${images.peakInFlight} concurrent image requests, cap is 6`)
  }
  if (t.requested === 0) {
    throw new Error('the thumbnail tier never asked for an image at card level (PRD 5.5.1)')
  }

  if (imagesLoad) {
    await page.waitForFunction(() => window.__eternitiesProbe.state().thumbnails.loaded > 0, {
      timeout: 60_000,
    })
    const loaded = await state()
    console.log(`  thumbnails loaded: ${loaded.thumbnails.loaded} cells, ${loaded.thumbnails.drawn} drawn`)
    if (loaded.thumbnails.drawn === 0) {
      throw new Error('thumbnails loaded but none were drawn (PRD 5.5.1)')
    }
    const stars = await page.evaluate(() => window.__eternitiesProbe.thumbnailStars())
    console.log(`    e.g. star ${stars.slice(0, 5).join(', ')}`)

    // The atlas blit is the only thing in the app that touches the renderer's viewport, and it only
    // runs once a real image lands — which is why the fixtures, whose images all 404, are blind to
    // this whole class of bug and why the assertion lives inside this branch.
    //
    // It shipped wrong once and nothing else here could see it: `setViewport` takes CSS pixels and
    // the blit passed drawing-buffer pixels, so the restore left a viewport 1.5× the buffer and
    // every frame after the first thumbnail drew the scene scaled about the bottom-left corner.
    // Every card-level assertion above is made against scene *state*, which was right the whole
    // time — the probe said 50%/50% while the renderer drew the card at 74%, 27%.
    const frame = await page.evaluate(() => {
      const canvas = Array.from(document.querySelectorAll('canvas')).sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0]
      const gl = canvas.getContext('webgl2')
      const viewport = Array.from(gl.getParameter(gl.VIEWPORT))
      return {
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        viewport,
      }
    })
    console.log(
      `  GL viewport ${frame.viewport.join(', ')} against a ${frame.buffer.join('x')} drawing buffer`,
    )
    if (
      frame.viewport[0] !== 0 ||
      frame.viewport[1] !== 0 ||
      frame.viewport[2] !== frame.buffer[0] ||
      frame.viewport[3] !== frame.buffer[1]
    ) {
      throw new Error(
        `the GL viewport is ${frame.viewport.join(', ')} on a ${frame.buffer.join('x')} drawing ` +
          `buffer after ${loaded.thumbnails.loaded} thumbnail blit(s): the scene is not drawing to ` +
          `the frame it thinks it is`,
      )
    }

    // PRD 9.3 checkpoint 3: the card-sheet tier with thumbnails loaded.
    if (shots) await shoot(page, resolve(shots, '3-card-sheet.png'))
  } else {
    // PRD 7.4.2, which is the whole of what a synthetic fixture can establish: every image failed
    // and nothing broke. No cell is left claimed by a fetch that will never arrive, so the atlas is
    // free for a card that can be fetched, and the stars are still the stars.
    if (t.failed === 0) {
      throw new Error('the fixture has synthetic ids, so every image should have failed — none did')
    }
    if (t.drawn !== 0) {
      throw new Error(`PRD 7.4.2: ${t.drawn} thumbnails drawn with no image loaded`)
    }
    if (t.cells !== 0) {
      throw new Error(`PRD 7.4.2: ${t.cells} atlas cells still held by failed fetches`)
    }
    console.log(`  every image 404d (synthetic ids) and the star glow stayed: ${t.failed} failures, 0 drawn`)
  }

  // PRD 7.2's GPU memory line, measured **here** — on the most-printings card of the largest plane,
  // with its art crops uploaded and the atlas full. That is the worst case the deliverable names,
  // and it is only the worst case while this card is the focused one. Read at the end of the run
  // instead, it lands on the double-faced card, which has no planets and so counts none of the 72
  // art crops: a number that is true and about nothing.
  await checkGpuMemory(state, `${card.name}, ${card.planets} planet(s)`, problems)

  await verifyPlanetPointer(page, card, problems)

  // PRD 9.3 checkpoint 4 asks for "card focus **with planets**", and this is the only moment in the
  // run that shows it. The two `4*.png` frames below are the double-faced card, which is a single
  // printing and therefore has no planets at all, so on their own they answer half the checkpoint
  // and the 72 planets appear only in checkpoint 3's sheet. Taken here, while the most-printings
  // card of the largest plane is still focused and its ring is still up.
  if (shots) await shoot(page, resolve(shots, '4b-card-focus-planets.png'))

  // The same act through the programmatic seam, which is what the search panel and a deep link use.
  if (card.planets > 1) {
    const activated = await page.evaluate(() => window.__eternitiesProbe.activatePrinting(1))
    if (!activated) throw new Error('PRD 5.6.9: activating a printing did not take')
    const after = await state()
    if (after.card.activePrinting !== 1) {
      throw new Error(`PRD 5.6.9: active printing is ${after.card.activePrinting}, expected 1`)
    }
    console.log(`  printing 1 activated through the programmatic seam (PRD 5.6.9)`)
  }

  // PRD 5.6.5 and PRD 9.3 checkpoint 4: a double-faced card, flipped.
  const dfc = await page.evaluate(() => window.__eternitiesProbe.focusCard({ dfc: true }))
  if (dfc < 0) {
    console.log('  no double-faced card on this plane; PRD 5.6.5 flip not exercised here')
  } else {
    await page.waitForFunction(() => window.__eternitiesProbe.state().card?.canFlip === true, {
      timeout: 30_000,
    })
    // Settled, not mid-flight: PRD 9.3's checkpoints are of the view the user arrives at, and a
    // frame grabbed during the fly-to shows the card wherever the tween had got to.
    await page.waitForFunction(() => !window.__eternitiesProbe.state().flying, { timeout: 30_000 })
    await new Promise((r) => setTimeout(r, 2500))
    const framed = await state()
    console.log(
      `  the flipping card is framed ${framed.cardFrameOffset.toFixed(4)} world units off centre`,
    )
    // The front face, before the turn: the pair is what makes PRD 5.6.5's "shows the front face; a
    // flip control turns the card 180° to show the back" checkable rather than assertable.
    if (shots) await shoot(page, resolve(shots, '4a-card-focus-front.png'))
    const flipped = await page.evaluate(() => window.__eternitiesProbe.flip())
    if (!flipped) throw new Error('PRD 5.6.5: a card with a back image refused to flip')
    await new Promise((r) => setTimeout(r, 1200))
    const turned = await state()
    if (!turned.card.flipped) throw new Error('PRD 5.6.5: the flip did not take')
    console.log(`  double-faced card ${turned.card.name} flipped (PRD 5.6.5)`)
    // PRD 9.3 checkpoint 4: card focus with planets, one double-faced card flipped.
    if (shots) await shoot(page, resolve(shots, '4-card-focus-flipped.png'))
  }

  // PRD 7.2's "steady-state frame rate at every level", measured at the level this phase added.
  const frames = await sampleFrames(page, 4)
  console.log(
    `  card level, ${frames.frames} frames: ${frames.fps} fps, p50 ${frames.p50} ms, ` +
      `p95 ${frames.p95} ms, worst ${frames.max} ms`,
  )
  // Frame *rate* is vsync-capped, so the ceiling is the honest gate and the percentile is what says
  // how much headroom is left (the same reading `bench/BenchRunner` states).
  if (frames.fps < 50) {
    problems.push(`PRD 7.2: ${frames.fps} fps at card level is under the 50 fps ceiling`)
  }
  if (frames.p95 > 33) {
    problems.push(`PRD 7.2: p95 ${frames.p95} ms at card level is over the 33 ms ceiling`)
  }

  // PRD 6.1.3: Esc leaves the card, and the card object goes with it.
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__eternitiesProbe.state().card === null, {
    timeout: 30_000,
  })
  console.log('  Esc released the card focus and the card object went with it')
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

  // `Phase2aScene` asked for the same missing `.overlay` rule, so it was invisible in the same way
  // and for the same reason. It gets the same check.
  await verifyStatusPanelPaints(page, 'phase0-status', '?selfcheck=1')

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
      `the mirror predicted; ${selfCheck.unmeasured} not in window, of which ` +
      `${selfCheck.unexplained} not explained by a nearer star` +
      (selfCheck.unexplainedRows.length > 0
        ? ` (plane rows ${selfCheck.unexplainedRows.map(([row, n]) => `${row}x${n}`).join(' ')})`
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
  // The one bucket still dropped before `checked` and `sampledRows`, so the one place the
  // absorption DEC-625 closed could re-open. Printed on every run, including green ones, because
  // a number that only appears on failure cannot be watched drifting upwards. Both margins, not
  // just the near one: `z > 1` is behind the eye *or* past the far plane, and a one-sided number
  // argues for one side of a two-sided test.
  const depths = (d) => (d === null ? 'n/a' : d.toFixed(1))
  console.log(
    `    ${selfCheck.unprojectable} unprojectable (behind the eye or past the far plane)` +
      (selfCheck.unprojectableRows.length > 0
        ? ` (plane rows ${selfCheck.unprojectableRows.map(([row, n]) => `${row}x${n}`).join(' ')})`
        : '') +
      `; sampled stars ${depths(selfCheck.nearestDepth)}-${depths(selfCheck.farthestDepth)} units ` +
      `in front of the eye (near plane 0.1, far plane 6000)`,
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
          `${selfCheck.darkRows.map(([row, dark, n]) => `${row} (${dark} of ${n} samples missing from their own pick window with nothing nearer to explain it)`).join(', ')} ` +
          `— a whole well-sampled row going dark is what a motion-mirror error too large to ` +
          `measure looks like, not what occlusion looks like`
        : ''

    // The other half of the off-screen fix, and the one failure the messages above cannot
    // describe: these samples never reached `checked` or `sampledRows`, so the dark-row rule has
    // no row to name and the "located only N of M" fallback below would report a shortfall in the
    // wrong denominator — it would say the run measured too little, when what happened is that
    // stars ended up behind the eye and the run quietly stopped counting them.
    //
    // The message names both causes rather than only the mirror. A plane the *data* places far
    // enough out trips this clause with the mirror and the shader in perfect agreement — a plane
    // table displaced to `home + 4000` does it — and `MULTIVERSE_RADIUS = 130.0` is the invariant
    // that keeps a real dataset from reaching there, not anything in this check.
    //
    // MANUAL LINK: the `130` in the message below is that constant, written out by hand. It lives
    // in `pipeline/src/eternities/pipeline/assemble.py` and is mirrored in
    // `pipeline/src/eternities/fixtures/generate.py`; both carry a comment pointing back here. A
    // cross-language export for one number in one diagnostic string is not worth the machinery, so
    // if the radius ever changes, change it here too — a stale figure here misdirects the reader of
    // a failure rather than failing anything, which is exactly the kind of wrong that survives.
    const unprojectable =
      selfCheck.unprojectable > 0
        ? `${selfCheck.unprojectable} sampled stars projected behind the eye or past the far plane` +
          (selfCheck.unprojectableRows.length > 0
            ? ` (plane ${selfCheck.unprojectableRows.length === 1 ? 'row' : 'rows'} ` +
              `${selfCheck.unprojectableRows.map(([row, n]) => `${row}x${n}`).join(' ')})`
            : '') +
          ` — these are the one kind of sample no pick window can be aimed at, so they are dropped ` +
          `before the tallies and this is the only place they can be reported. Either the CPU ` +
          `motion mirror is wrong about those rows, or the plane table puts them outside the ` +
          `130-unit multiverse radius the datasets are built to; check the rows above against the ` +
          `plane table before assuming the mirror. The ` +
          `${selfCheck.nearestDepth === null ? 'depth range' : `${selfCheck.nearestDepth.toFixed(1)}-unit near margin`} ` +
          `printed above is over the samples that survived and says nothing about these`
        : ''

    if (selfCheck.missed.length > 0) {
      throw new Error(
        `the CPU motion mirror disagrees with the vertex shader for ${selfCheck.missed.length} ` +
          `stars — PRD 8.5.7's camera tether would frame the wrong point` +
          (darkRows === '' ? '' : `. And in the same run, ${darkRows}`) +
          (unprojectable === '' ? '' : `. And in the same run, ${unprojectable}`),
      )
    }
    if (darkRows !== '') {
      throw new Error(
        darkRows + (unprojectable === '' ? '' : `. And in the same run, ${unprojectable}`),
      )
    }
    if (unprojectable !== '') throw new Error(unprojectable)
    throw new Error(
      `the self-check located only ${selfCheck.measured} of ${selfCheck.checked} sampled stars ` +
        `in their own pick window — too few to establish PRD 8.5.7 either way`,
    )
  }
}

async function verify(dataset, allowSoftware, shots) {
  console.log(`\n=== ${dataset} ===`)
  const roster = readRoster(dataset)
  console.log(
    `  roster ${roster.hash}: ${roster.planes} planes, ${roster.labelled} labelled, ` +
      `${roster.stars} stars, the dust over ${roster.shards} shard(s), ` +
      `${roster.realImages ? 'real' : 'synthetic'} Scryfall ids`,
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
    const upstream = watch(page, problems)

    const log = (line) => console.log(line)
    // Phase 4's shell first, on a fresh profile: its first-visit-hint assertions (PRD 6.8.3) only
    // mean something before anything has dismissed the hint.
    await verifyShell(page, url, log)
    // After the shell, because it needs the first-visit hint already dismissed — the hint takes
    // focus on purpose (PRD 6.8.3) and would answer every focus question below for itself.
    await verifyAccessibility(page, url, log)
    await verifyWebGL2Fallback(browser, url, log)
    await verifyNavigation(page, url, roster, problems)
    await verifyCardTier(page, url, roster.realImages, shots, problems)
    await verifyStarField(page, url, allowSoftware, problems)

    console.log(
      `  Scryfall: ${upstream.failed} image request(s) returned an error, ` +
        `${upstream.aborted} cancelled by the queue` +
        (roster.realImages ? '' : ' — expected, this dataset has synthetic ids'),
    )
    if (roster.realImages && upstream.failed > 0) {
      problems.push(`${upstream.failed} Scryfall image request(s) failed on a real-id dataset`)
    }

    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n  - ${problems.join('\n  - ')}`)
    }
    console.log(
      `  OK — ${dataset} drives PRD section 6 in the shell, and the scene, the card tier and ` +
        `Phase 2a's harness all hold, under the production CSP`,
    )
  } finally {
    await browser.close()
    child.kill('SIGTERM')
  }
}

const args = parseArgs(process.argv.slice(2))
// `all` stays the two fixtures: `production` is a 40 MB build and a live Scryfall round trip, so
// it is opted into rather than swept up.
const datasets = args.dataset === 'all' ? ['small', 'scale'] : [args.dataset]
if (args.shots) mkdirSync(args.shots, { recursive: true })
for (const dataset of datasets) {
  await verify(dataset, args.allowSoftware, args.shots)
}
console.log('\nall datasets verified in the browser')
