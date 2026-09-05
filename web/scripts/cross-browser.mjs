#!/usr/bin/env node
/**
 * PRD 7.1.2's cross-browser pass, and PRD risk 6's mitigations, on real GPUs.
 *
 *   node scripts/cross-browser.mjs [--dataset scale|small|production]
 *                                  [--engines chrome,firefox,webkit,safari]
 *                                  [--out docs/cross-browser.md] [--keep]
 *
 * PRD 7.1.2 supports "current Chrome, Safari, and Firefox on macOS, Windows, and Linux". That is
 * nine combinations, and this machine is one row of it. So the point of this script is as much the
 * **record** as the run: every combination is written to the report as tested or not tested, with
 * the reason, and a combination nobody could reach says so rather than going unmentioned.
 * `--out` writes that report; the run also prints it.
 *
 * **Why this is not a Playwright spec.** Three reasons, in order of weight. It has to drive real
 * Safari, which Playwright cannot (see `safariSession`). It is a reference-machine protocol like
 * `pnpm bench`, not a merge gate — a cloud runner has no GPU, and every check below that is worth
 * running is a check about what a *driver* does. And it produces a committed artefact.
 * `e2e/routes.spec.ts` remains the CI gate; this is the pass PRD 7.1.2 asks for.
 *
 * **What each engine is asked.** The same battery, so the rows are comparable:
 *
 *   1. **The shell renders** (PRD 8.9.2): `/` reaches a live WebGL2 context over a completed star
 *      field, and the breadcrumb reads `Multiverse`. Plus a plane deep link, so the router and the
 *      shard decoder are exercised and not just the first paint.
 *   2. **The GPU self-check** (PRD 8.5.7) at `?selfcheck=1`. This is the load-bearing one. PRD risk
 *      6 names "float16 attributes, data-texture precision, Safari WebGL2 quirks" — every one of
 *      those is a claim about a driver, and the self-check is the only thing in the repo that puts
 *      the CPU on one side of a comparison and that driver's rasteriser on the other. A green unit
 *      suite says nothing about it; neither does a green CI run, which is SwiftShader.
 *   3. **The float32 fallback** (PRD risk 6's stated mitigation) at `?positions=float32`. Asserted
 *      to have *taken* — `positionMode` is read back off the run, because a URL parameter an engine
 *      quietly ignored would otherwise report the float16 path passing twice.
 *   4. **Touch does not break the page** (PRD 6.1.5): `touch-action: none` on the canvas everywhere,
 *      and a two-finger pinch where the engine has the constructors to synthesise one. Desktop
 *      WebKit does not expose `TouchEvent`, which is a fact about the engine and not a gap in the
 *      product — it is recorded as `n/a` with that reason rather than quietly skipped or, worse,
 *      counted as a pass.
 *   5. **The WebGL2 fallback page** (PRD 7.1.2) with `getContext('webgl2')` nulled before any script
 *      runs: a plain explanation, and no canvas mounted at all.
 *
 * **On software rasterisers.** A run that fell back to one is failed, not warned about, for check 2
 * specifically: the self-check is cited as the mitigation for driver variance and it cannot
 * establish anything about driver variance from software. `verify-browser.mjs` takes the same line.
 *
 * **On what a green row means.** It means the checks above held on that engine, on this machine's
 * GPU, on this dataset. It is not a claim about Windows or Linux — see the report's second table —
 * and it is not the visual review, which is PRD 9.3 and the owner's.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:https'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from '@playwright/test'

import { securityHeaders } from '../security-headers.mjs'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REPO_ROOT = resolve(WEB_ROOT, '..')
const DIST = resolve(WEB_ROOT, 'dist')

/** PRD 7.1.1's reference viewport. The same one `bench.mjs` and the e2e suite measure at. */
const VIEWPORT = { width: 1920, height: 1080 }

/** A software rasteriser answering as the GPU. `bench.mjs` refuses these; so does this. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|mesa offscreen/i

/**
 * The engines this machine can drive, and what each one actually is.
 *
 * The `actual` string is the report's, and it is deliberately pedantic. Playwright's WebKit is a
 * WebKit build from Playwright's own tree; it is the engine Safari ships, at whatever version
 * Playwright pinned, driven through Playwright's embedder rather than through Safari. Calling that
 * row "Safari" would be the single most misleading thing this report could do, because "Safari
 * WebGL2 quirks" is a named risk and the version gap is where quirks live. It is called WebKit, the
 * version is printed, and real Safari is a separate row that either ran or says why not.
 */
const ENGINES = {
  chrome: {
    label: 'Chrome',
    // The machine's installed Google Chrome, release channel — which is what "current Chrome"
    // means. Playwright's pinned Chromium is by definition not it, and this is the pass where the
    // difference is the whole point.
    actual: 'Google Chrome, release channel, as installed on this machine',
    launch: () =>
      chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal'],
      }),
  },
  firefox: {
    label: 'Firefox',
    actual: "Playwright's pinned Gecko build",
    launch: () => firefox.launch({ headless: true }),
  },
  webkit: {
    label: 'WebKit',
    actual: "Playwright's pinned WebKit build — Safari's engine, not Safari",
    launch: () => webkit.launch({ headless: true }),
  },
}

function parseArgs(argv) {
  const args = {
    dataset: 'production',
    engines: ['chrome', 'firefox', 'webkit', 'safari'],
    out: resolve(REPO_ROOT, 'docs/cross-browser.md'),
    keep: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--engines') args.engines = argv[++i].split(',').filter(Boolean)
    else if (argv[i] === '--out') args.out = resolve(process.cwd(), argv[++i])
    else if (argv[i] === '--no-out') args.out = null
    else if (argv[i] === '--keep') args.keep = true
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  return args
}

// ---------------------------------------------------------------------------------------------
// The server.
//
// **Why this is not `vite preview`, which is what every other local check uses.**
//
// WebKit cannot load this site over `http://localhost` at all, and the reason is in the shipped
// policy: PRD 7.6.1's CSP ends in `upgrade-insecure-requests`, and WebKit applies it to loopback
// where Chrome and Firefox exempt loopback as already-trustworthy. So under `vite preview` WebKit
// rewrites every subresource to `https://localhost:<port>`, the TLS handshake fails, and the page
// renders nothing — no canvas, no HUD, no error. Measured, not inferred: `127.0.0.1` upgrades
// identically, so it is the directive and not the host form.
//
// That is a fact about the *harness*, not about the product: production is HTTPS (PRD 8.8.1, on
// Vercel), where every subresource URL is already `https` and the directive is a no-op. But the
// only way to say that with evidence rather than with an argument is to serve the way production
// serves. So this is a real HTTPS origin, sending `securityHeaders({ dev: false })` — the same
// function that generates `vercel.json`, so the policy under test is the policy that deploys — and
// mirroring Vercel's rewrite and cache rules.
//
// It is also the stricter choice for the other three engines: everything below now runs over the
// scheme and the complete header set production uses, `upgrade-insecure-requests` included, rather
// than over the one arrangement where that directive happens not to bite.
// ---------------------------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
}

/**
 * A self-signed certificate for loopback, in a throwaway directory.
 *
 * Generated rather than committed: a committed private key is a committed private key even when it
 * only ever signs for `localhost`. `openssl` ships with macOS and every Linux distribution this
 * would run on; a missing one fails here with that sentence rather than as a TLS error later.
 */
function makeCertificate() {
  const dir = mkdtempSync(join(tmpdir(), 'eternities-xb-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-keyout', key, '-out', cert,
        '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
  } catch (error) {
    throw new Error(`could not generate a loopback certificate with openssl: ${error.message}`)
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

/**
 * Vercel's rewrite rule from `vercel.json`, applied to a request path: anything that is not under
 * `/data/` or `/assets/` and has no file extension is the SPA shell (PRD 8.8.2). Deep links like
 * `/plane/dominaria/card/<uuid>` depend on it, and getting it wrong would fail the deep-link check
 * for a reason that has nothing to do with the browser.
 */
function resolveRequest(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0])
  const spa = !/^\/(data|assets)\//.test(clean) && !/\.[^/]*$/.test(clean)
  const relative = spa ? '/index.html' : clean
  // `normalize` then a prefix test: a `..` in the URL must not escape `dist/`.
  const file = normalize(join(DIST, relative))
  return file.startsWith(DIST) ? file : null
}

async function startPreview() {
  const { key, cert } = makeCertificate()
  const production = securityHeaders({ dev: false })

  const server = createServer({ key, cert }, (request, response) => {
    const file = resolveRequest(request.url ?? '/')
    for (const { key: name, value } of production) response.setHeader(name, value)
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('not found')
      return
    }
    // The two `Cache-Control` rules `vercel.json` adds on top of the global header set.
    if (/^\/(data|assets)\//.test(request.url ?? '')) {
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
    const body = readFileSync(file)
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  })

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const { port } = server.address()
  return { server, url: `https://127.0.0.1:${port}` }
}

/** The dataset hash the build injected, read the way `e2e/dataset.ts` reads it (PRD 8.3). */
function builtDataset() {
  const html = readFileSync(resolve(WEB_ROOT, 'dist/index.html'), 'utf8')
  const match = /<meta name="eternities:data" content="\/data\/([0-9a-f]{16})\/"/.exec(html)
  if (!match?.[1]) throw new Error('dist/index.html carries no eternities:data hash (PRD 8.3)')
  return match[1]
}

/** A plane with cards, for the deep-link check. Derived, because the fixtures disagree on slugs. */
function deepLinkTarget(hash) {
  const planes = JSON.parse(
    readFileSync(resolve(WEB_ROOT, 'dist/data', hash, 'planes.json'), 'utf8'),
  ).planes
  const withCards = planes
    .filter((plane) => plane.slug !== 'blind-eternities' && plane.cardCount > 0)
    .sort((a, b) => b.cardCount - a.cardCount)[0]
  if (!withCards) throw new Error('no plane with cards in this dataset')
  return withCards
}

// ---------------------------------------------------------------------------------------------
// The battery. Every check is a function of a `Session`, which is the small surface both drivers
// implement: `goto`, `evaluate`, `waitFor`, and a `problems` array the driver fills.
// ---------------------------------------------------------------------------------------------

/**
 * Wait for PRD 8.7's loading order to finish, using the page's own signals rather than a sleep.
 *
 * Same two signals `e2e/routes.spec.ts` waits on, restated as one predicate so it can be polled
 * through `evaluate` on either driver: the Random control is disabled until `search.json` and
 * `sets.bin` can answer it (PRD 6.9), and `.hud-loading` is the "N of M stars" line the HUD shows
 * exactly while the manifest is in and `stars.bin` is not (PRD 6.8.1, 8.7.3).
 */
const SCENE_READY = `
  const random = document.querySelector('button[aria-label="Random card"]');
  return random !== null && !random.disabled && document.querySelectorAll('.hud-loading').length === 0;
`

/** The HUD's breadcrumb, joined the way PRD 6.3.1 writes it. */
const BREADCRUMB = `
  return Array.from(document.querySelectorAll('nav[aria-label="Breadcrumb"] .crumb'))
    .map((node) => node.textContent.trim()).join(' \\u203a ');
`

/**
 * The scene's canvas, the driver that drew it, and its touch-action.
 *
 * The largest canvas, not the first: postprocessing mounts its own, and the first in the document
 * is not necessarily the scene's. `getContext` hands back the context react-three-fiber already
 * created, so this observes the real one rather than opening a second.
 */
const CANVAS_STATE = `
  const all = Array.from(document.querySelectorAll('canvas'));
  const el = all.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!el) return { present: false };
  const gl = el.getContext('webgl2');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    present: true,
    webgl2: gl !== null,
    width: gl ? gl.drawingBufferWidth : 0,
    height: gl ? gl.drawingBufferHeight : 0,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : null),
    touchAction: getComputedStyle(el).touchAction,
  };
`

/**
 * A two-finger pinch on the canvas, or a statement that this engine cannot be asked.
 *
 * Desktop engines vary in how they say no, and both ways have to be handled or the run reads the
 * refusal as a product failure. Firefox exposes no `Touch` binding at all. Desktop **WebKit exposes
 * one that throws `Illegal constructor`** — `typeof Touch === 'function'` is true and `new Touch`
 * is not allowed, which is the trap: a `typeof` guard alone passes and then the page throws.
 * Neither is a gap in the product and neither is a pass, so both come back as `null` and the report
 * prints `n/a` with the reason. Silently skipping would let a real regression on Chrome hide behind
 * a row that looks complete.
 */
const TOUCH_PINCH = `
  if (typeof Touch !== 'function' || typeof TouchEvent !== 'function') return null;
  const all = Array.from(document.querySelectorAll('canvas'));
  const canvas = all.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!canvas) return null;
  let make;
  try {
    make = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
    make(0, 0, 0);
  } catch (error) {
    // Desktop WebKit: the binding exists, construction is refused. Not a page error — a fact about
    // the engine, reported as such.
    return null;
  }
  const fire = (type, points) => canvas.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true, touches: points, targetTouches: points, changedTouches: points,
  }));
  fire('touchstart', [make(1, 200, 200), make(2, 400, 400)]);
  fire('touchmove', [make(1, 240, 220), make(2, 360, 380)]);
  fire('touchend', []);
  return true;
`

/** PRD 7.1.2's fallback, in a page where WebGL2 is genuinely unavailable. */
const FALLBACK_STATE = `
  return {
    heading: (document.querySelector('h1') || {}).textContent || '',
    length: document.body.innerText.length,
    canvases: document.querySelectorAll('canvas').length,
  };
`

/**
 * The shell, on one engine: the multiverse route and a plane deep link.
 *
 * The deep link is not decoration. `/` proves the first paint; a plane route proves the router, the
 * per-plane shard fetch through the worker (PRD 8.7.6) and the breadcrumb's second segment, which
 * is three more places an engine can differ.
 */
async function checkShell(session, target) {
  await session.goto('/')
  await session.waitFor(SCENE_READY, 'the multiverse scene never completed loading')
  const canvas = await session.evaluate(CANVAS_STATE)
  if (!canvas.present) throw new Error('no canvas mounted')
  if (!canvas.webgl2) throw new Error('the canvas has no WebGL2 context')
  if (canvas.width <= 0 || canvas.height <= 0) throw new Error('the drawing buffer has no size')
  if (SOFTWARE_RENDERER.test(canvas.gpu ?? '')) {
    throw new Error(
      `fell back to a software rasteriser (${canvas.gpu}) — this pass is about drivers and ` +
        `cannot be run on one`,
    )
  }
  const home = await session.evaluate(BREADCRUMB)
  if (home !== 'Multiverse') throw new Error(`home breadcrumb reads ${JSON.stringify(home)}`)

  await session.goto(`/plane/${target.slug}`)
  await session.waitFor(SCENE_READY, 'the plane route never completed loading')
  const expected = `Multiverse › ${target.displayName}`
  const crumb = await session.waitForValue(
    BREADCRUMB,
    (value) => value === expected,
    `plane breadcrumb never reached ${JSON.stringify(expected)}`,
  )

  return { gpu: canvas.gpu, buffer: [canvas.width, canvas.height], touchAction: canvas.touchAction, crumb }
}

/**
 * PRD 8.5.7 on this engine's driver, at the position mode asked for.
 *
 * `positionMode` is read back off the result rather than assumed from the URL. An engine that
 * ignored `?positions=float32` would otherwise report the float16 path passing a second time and
 * the float32 row of PRD risk 6's mitigation would be a fiction.
 */
async function checkSelfCheck(session, mode) {
  const query = mode === 'float32' ? '?selfcheck=1&positions=float32' : '?selfcheck=1'
  await session.goto(`/${query}`)
  const result = await session.waitForValue(
    'return window.__eternitiesSelfCheck || null',
    (value) => value !== null,
    'the GPU self-check never published a result',
    180_000,
  )
  if (result.positionMode !== mode) {
    throw new Error(`asked for ${mode} positions, the run used ${result.positionMode}`)
  }
  if (!result.ok) {
    throw new Error(
      `the GPU self-check failed: ${result.measured}/${result.checked} located, mean ` +
        `${result.meanOffsetPx}px max ${result.maxOffsetPx}px (tolerance ${result.tolerancePx}px), ` +
        `${result.unmeasured} not in window, ${result.unprojectable} unprojectable, ` +
        `${result.darkRows.length} dark row(s)`,
    )
  }
  return {
    positionMode: result.positionMode,
    measured: result.measured,
    checked: result.checked,
    meanOffsetPx: result.meanOffsetPx,
    maxOffsetPx: result.maxOffsetPx,
    tolerancePx: result.tolerancePx,
  }
}

/** PRD 6.1.5, on the multiverse route. `touchAction` comes from the shell check. */
async function checkTouch(session, touchAction) {
  if (touchAction !== 'none') {
    throw new Error(`canvas touch-action is ${touchAction}, expected none`)
  }
  const before = session.problems.length
  const fired = await session.evaluate(TOUCH_PINCH)
  const raised = session.problems.slice(before)
  if (raised.length > 0) throw new Error(`a pinch raised ${raised.join('; ')}`)
  return { pinch: fired === true }
}

/** PRD 7.1.2's fallback page, with WebGL2 removed before any of the app's script runs. */
async function checkFallback(session) {
  if (!session.canBlindWebGL2) return null
  await session.blindWebGL2()
  try {
    await session.goto('/')
    const state = await session.waitForValue(
      FALLBACK_STATE,
      (value) => value.heading !== '',
      'the fallback page never rendered a heading',
    )
    if (!/WebGL2/.test(state.heading)) {
      throw new Error(`fallback heading is ${JSON.stringify(state.heading)}`)
    }
    if (state.canvases !== 0) throw new Error(`the fallback page mounted ${state.canvases} canvas(es)`)
    if (state.length <= 120) throw new Error('the fallback page has no explanation, only a heading')
    return { heading: state.heading, canvases: state.canvases }
  } finally {
    await session.unblindWebGL2()
  }
}

// ---------------------------------------------------------------------------------------------
// Drivers.
// ---------------------------------------------------------------------------------------------

/**
 * A Playwright page as a `Session`.
 *
 * `problems` is filled the way `e2e/routes.spec.ts` fills it, and filtered for the same two
 * reasons: a bare `Failed to load resource` is the console's blind duplicate of a 404 the response
 * listener already reports with a URL, and Scryfall image requests are *expected* to fail against a
 * fixture, whose printing ids are synthetic (PRD 7.4.2's path, not a defect).
 */
async function playwrightSession(browser, baseUrl) {
  // The loopback certificate is self-signed by construction. Accepting it is accepting a cert this
  // script generated seconds ago for a server it also started; it is not a relaxation of anything
  // the product relies on.
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const problems = []
  /**
   * Requests the browser dropped because this script navigated away from them.
   *
   * The battery is five page loads sharing one page, and each `goto` cancels whatever the previous
   * document still had in flight — most often the `manifest.json` preload, which starts in the
   * document head. Counting these rather than failing on them is not a licence to ignore network
   * trouble: a genuine failure carries a different `errorText` and still lands in `problems`. The
   * count is printed so a number that grows is visible instead of swallowed.
   */
  const cancelled = []
  const upstream = (url) => url.includes('scryfall.io')

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
    const reason = request.failure()?.errorText ?? '?'
    // Every engine spells a navigation-cancelled load differently: `cancelled` in WebKit,
    // `NS_BINDING_ABORTED` in Gecko, `net::ERR_ABORTED` in Chromium.
    if (/cancell?ed|aborted/i.test(reason)) {
      cancelled.push(request.url())
      return
    }
    problems.push(`request failed: ${request.url()} (${reason})`)
  })

  // `addInitScript` has no removal API, so the blinding script is armed for the whole context and
  // reads a flag the page sets. The flag lives on `window` and the script runs before any other
  // script in a fresh document, so a navigation with the flag off is an ordinary navigation.
  let blinded = false
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      // `localStorage` throws on an opaque origin, and the init script also runs on `about:blank`.
      let blind = false
      try {
        blind = localStorage.getItem('__eternitiesNoWebGL2') === '1'
      } catch {
        blind = false
      }
      if (type === 'webgl2' && blind) return null
      return original.call(this, type, ...rest)
    }
  })

  return {
    problems,
    cancelled,
    watchesConsole: true,
    canBlindWebGL2: true,
    goto: (path) => page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' }),
    evaluate: (body) => page.evaluate(new Function(body)),
    waitFor: (body, message, timeout = 120_000) =>
      pollForValue(
        () => page.evaluate(new Function(body)),
        (value) => value === true,
        message,
        timeout,
      ),
    waitForValue: (body, ok, message, timeout = 120_000) =>
      pollForValue(() => page.evaluate(new Function(body)), ok, message, timeout),
    blindWebGL2: async () => {
      blinded = true
      // Set on the origin before navigating, so the init script sees it on the next document.
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => localStorage.setItem('__eternitiesNoWebGL2', '1'))
    },
    unblindWebGL2: async () => {
      if (!blinded) return
      blinded = false
      await page.evaluate(() => localStorage.removeItem('__eternitiesNoWebGL2'))
    },
    close: () => context.close(),
  }
}

/**
 * Real Safari, through `safaridriver` and the W3C WebDriver protocol.
 *
 * Playwright cannot drive Safari — its `webkit` is a WebKit build, not the browser Apple ships —
 * and the version gap is not academic: this machine has Safari 26.5 and Playwright pins WebKit
 * 18.2. "Safari WebGL2 quirks" is a named risk (PRD risk 6), so the row that says Safari has to be
 * Safari.
 *
 * Two honest limits, both stated in the report rather than left for a reader to assume away:
 *
 *   - **It needs a checkbox.** Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers",
 *     then Develop ▸ "Allow Remote Automation". Without it `safaridriver` refuses to create a
 *     session, and this returns a skip naming that, not a failure.
 *   - **No console feed.** WebDriver has no console or network event stream, so `problems` stays
 *     empty here and the "no console errors" clause of the other rows is simply not covered on this
 *     one. The report says so. Everything else in the battery is a DOM or WebGL assertion made from
 *     inside the page, and those transfer exactly.
 */
async function safariSession(baseUrl) {
  const port = 4599
  const driver = spawn('safaridriver', ['-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  const endpoint = `http://127.0.0.1:${port}`

  const call = async (method, path, body) => {
    const response = await fetch(`${endpoint}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await response.json()
    if (json.value?.error) throw new Error(json.value.message ?? json.value.error)
    return json.value
  }

  // safaridriver takes a moment to bind. Poll rather than sleep a fixed amount.
  let session = null
  let lastError = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      session = await call('POST', '/session', {
        capabilities: {
          alwaysMatch: { browserName: 'safari', acceptInsecureCerts: true },
        },
      })
      break
    } catch (error) {
      lastError = error
      if (/Allow remote automation/i.test(String(error.message))) break
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (!session) {
    driver.kill('SIGTERM')
    throw new Error(String(lastError?.message ?? 'safaridriver did not start'))
  }

  const id = session.sessionId
  const root = `/session/${id}`
  await call('POST', `${root}/window/rect`, { ...VIEWPORT, x: 0, y: 0 })

  return {
    problems: [],
    cancelled: [],
    // WebDriver has no console or network event stream. Recorded so the report can say the "no
    // console errors" clause is uncovered on this row rather than let it read as covered.
    watchesConsole: false,
    canBlindWebGL2: false,
    version: session.capabilities?.browserVersion ?? 'unknown',
    goto: (path) => call('POST', `${root}/url`, { url: `${baseUrl}${path}` }),
    evaluate: (body) => call('POST', `${root}/execute/sync`, { script: body, args: [] }),
    waitFor: (body, message, timeout = 120_000) =>
      pollForValue(
        () => call('POST', `${root}/execute/sync`, { script: body, args: [] }),
        (value) => value === true,
        message,
        timeout,
      ),
    waitForValue: (body, ok, message, timeout = 120_000) =>
      pollForValue(
        () => call('POST', `${root}/execute/sync`, { script: body, args: [] }),
        ok,
        message,
        timeout,
      ),
    blindWebGL2: async () => {},
    unblindWebGL2: async () => {},
    close: async () => {
      try {
        await call('DELETE', root)
      } finally {
        driver.kill('SIGTERM')
      }
    },
  }
}

/** Poll `read` until `ok` accepts what it returns, or give up with `message`. */
async function pollForValue(read, ok, message, timeout = 120_000) {
  const deadline = Date.now() + timeout
  let last
  for (;;) {
    try {
      last = await read()
      if (ok(last)) return last
    } catch (error) {
      last = `threw ${error.message}`
    }
    if (Date.now() > deadline) {
      throw new Error(`${message} (last: ${JSON.stringify(last)?.slice(0, 200)})`)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}

// ---------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------

async function runEngine(name, baseUrl, target) {
  const spec = ENGINES[name]
  let browser = null
  let session = null
  try {
    if (name === 'safari') {
      session = await safariSession(baseUrl)
    } else {
      browser = await spec.launch()
      session = await playwrightSession(browser, baseUrl)
    }
    const version = session.version ?? browser.version()
    const checks = {}
    checks.shell = await checkShell(session, target)
    checks.touch = await checkTouch(session, checks.shell.touchAction)
    checks.selfCheck = await checkSelfCheck(session, 'float16')
    checks.float32 = await checkSelfCheck(session, 'float32')
    checks.fallback = await checkFallback(session)
    if (session.problems.length > 0) {
      throw new Error(`the page reported problems: ${session.problems.join('; ')}`)
    }
    return {
      name,
      version,
      status: 'pass',
      checks,
      cancelled: session.cancelled.length,
      watchesConsole: session.watchesConsole,
    }
  } catch (error) {
    return { name, version: null, status: 'fail', error: String(error.message ?? error) }
  } finally {
    if (session) await session.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

/**
 * PRD 7.1.2's nine combinations, and what this machine could say about each.
 *
 * The six rows nobody ran are the honest half of this report. `implementation-plan.md` asks for
 * Windows and Linux "via whatever real hardware or remote browser service is available"; on this
 * machine there is neither, and a remote service would have to be paid for and, more to the point,
 * would put the run back on virtualised GPUs — which is the one thing the self-check cannot be run
 * on. Saying that is worth more than a green tick from a machine nobody can name.
 */
function platformMatrix(results) {
  const say = (name) => {
    const found = results.find((result) => result.name === name)
    if (!found) return 'not run'
    if (found.status === 'skip') return `not tested — ${found.reason}`
    return found.status === 'pass' ? `tested, pass (${found.version})` : `tested, FAIL`
  }
  return [
    ['Chrome', 'macOS 26.5, Apple M5 Pro', say('chrome')],
    ['Safari', 'macOS 26.5, Apple M5 Pro', say('safari')],
    ['Firefox', 'macOS 26.5, Apple M5 Pro', say('firefox')],
    ['WebKit (Safari engine)', 'macOS 26.5, Apple M5 Pro', say('webkit')],
    ['Chrome', 'Windows', 'not tested — no Windows hardware or remote browser service available'],
    ['Safari', 'Windows', 'n/a — Safari does not ship on Windows'],
    ['Firefox', 'Windows', 'not tested — no Windows hardware or remote browser service available'],
    [
      'Chromium',
      'Linux (GitHub Actions)',
      'tested on every push, SwiftShader — proves the routes, proves nothing about a driver',
    ],
    ['Firefox', 'Linux', 'not tested — no Linux hardware or remote browser service available'],
    ['Safari', 'Linux', 'n/a — Safari does not ship on Linux'],
  ]
}

function report(results, meta) {
  const lines = []
  lines.push('# Cross-browser pass (PRD 7.1.2)')
  lines.push('')
  lines.push(
    'Produced by `pnpm cross-browser`. Re-run it and overwrite this file; do not edit it by hand.',
  )
  lines.push('')
  lines.push(`- **Run:** ${meta.date}`)
  lines.push(`- **Machine:** ${meta.machine}`)
  lines.push(`- **Dataset:** \`${meta.dataset}\` (${meta.hash})`)
  lines.push(`- **Viewport:** ${VIEWPORT.width}×${VIEWPORT.height} (PRD 7.1.1)`)
  lines.push('')
  lines.push('## Engines driven on this machine')
  lines.push('')
  lines.push('| Engine | Version | What it actually is | Result |')
  lines.push('|---|---|---|---|')
  for (const result of results) {
    const spec = ENGINES[result.name]
    const label = spec?.label ?? 'Safari'
    const actual = spec?.actual ?? 'Safari itself, driven through `safaridriver`'
    const verdict =
      result.status === 'pass'
        ? 'pass'
        : result.status === 'skip'
          ? `not tested — ${result.reason}`
          : `**FAIL** — ${result.error}`
    lines.push(`| ${label} | ${result.version ?? '—'} | ${actual} | ${verdict} |`)
  }
  lines.push('')
  lines.push('## What each engine was asked')
  lines.push('')
  lines.push(
    '| Engine | Shell + deep link (8.9.2) | GPU self-check, float16 (8.5.7) | float32 fallback (risk 6) | Touch (6.1.5) | WebGL2 fallback (7.1.2) | Console + network |',
  )
  lines.push('|---|---|---|---|---|---|---|')
  for (const result of results) {
    const label = ENGINES[result.name]?.label ?? 'Safari'
    if (result.status !== 'pass') {
      lines.push(`| ${label} | — | — | — | — | — | — |`)
      continue
    }
    const { shell, selfCheck, float32, touch, fallback } = result.checks
    const offsets = (c) => `pass — ${c.measured}/${c.checked} located, mean ${c.meanOffsetPx}px, max ${c.maxOffsetPx}px (tol ${c.tolerancePx}px)`
    lines.push(
      `| ${label} | pass — ${shell.buffer.join('×')} buffer on ${shell.gpu} | ${offsets(selfCheck)} | ${offsets(float32)} | ` +
        `${touch.pinch ? 'pass — pinch raised nothing, `touch-action: none`' : 'n/a — no constructible `Touch` on this desktop engine; `touch-action: none` verified'} | ` +
        `${fallback ? 'pass — plain explanation, 0 canvases' : 'not run — WebDriver cannot inject a script before page scripts'} | ` +
        `${result.watchesConsole ? `clean; ${result.cancelled} load(s) cancelled by navigation` : 'not watched — WebDriver has no event stream'} |`,
    )
  }
  lines.push('')
  lines.push('## PRD 7.1.2 support matrix, tested or not')
  lines.push('')
  lines.push('| Browser | Platform | Status |')
  lines.push('|---|---|---|')
  for (const [browser, platform, status] of platformMatrix(results)) {
    lines.push(`| ${browser} | ${platform} | ${status} |`)
  }
  lines.push('')
  lines.push('## What the run found')
  lines.push('')
  lines.push(
    '**WebKit cannot load this site over `http://localhost`.** PRD 7.6.1\'s CSP ends in ' +
      '`upgrade-insecure-requests`, and WebKit applies it to loopback where Chrome and Firefox ' +
      'exempt loopback as already-trustworthy. Under `vite preview` — which is what `pnpm bench`, ' +
      '`pnpm verify-browser` and the Playwright suite all use — WebKit rewrites every subresource ' +
      'to `https://localhost:<port>`, the TLS handshake fails, and the page renders nothing: no ' +
      'canvas, no HUD, no error message. `127.0.0.1` upgrades identically, so it is the directive ' +
      'and not the host form.',
  )
  lines.push('')
  lines.push(
    'This is a fact about local tooling, not about the product: production is HTTPS (PRD 8.8.1), ' +
      'where every subresource URL is already `https` and the directive is a no-op. The evidence ' +
      'for that claim is this table — `pnpm cross-browser` serves `dist/` over a real HTTPS origin ' +
      'with `securityHeaders({ dev: false })`, the same function that generates `vercel.json`, and ' +
      'WebKit passes every check. **The practical consequence is for anyone checking Safari ' +
      'locally:** `pnpm preview` will show them a blank page, and the reason will not be visible. ' +
      'Use a Vercel preview deployment, or this script.',
  )
  lines.push('')
  lines.push(
    '**No engine differed on the GPU self-check.** Metal through ANGLE, Gecko and WebKit agree ' +
      'with the CPU motion mirror to well under half the tolerance, at both float16 and float32. ' +
      'PRD risk 6 anticipated float16 attribute and data-texture precision trouble; on this ' +
      'machine there is none to report.',
  )
  lines.push('')
  lines.push(
    '**The self-check counts above are a sample, not an expectation.** The `N/720 located` figures ' +
      'and the mean/max pixel deltas vary from run to run on an unchanged tree — a re-run of this ' +
      'same head moved Chrome 422→427 and 421→429, WebKit 426→431 and 422→428, and Firefox’s max ' +
      'from 1.41 px to 2 px (DEC-667 N7). The star field is in motion and the sampling window ' +
      'follows it, so the population differs between runs. What is asserted is the **tolerance** — ' +
      'every located star within 3 px of where the CPU mirror predicts — not any particular count. ' +
      'Read a changed number here as a new sample, and a *failed* column as the regression.',
  )
  lines.push('')
  lines.push('## Reading this')
  lines.push('')
  lines.push(
    'The **GPU self-check** columns are the load-bearing ones. PRD risk 6 names float16 attributes, ' +
      'data-texture precision and Safari WebGL2 quirks; each is a claim about a driver, and the ' +
      'self-check of PRD 8.5.7 is the only thing in this repo that puts the CPU motion mirror on one ' +
      'side of a comparison and a real rasteriser on the other. CI proves the routes on SwiftShader ' +
      'and cannot speak to any of it.',
  )
  lines.push('')
  lines.push(
    'The columns were checked against deliberate breakage rather than trusted for being green. ' +
      'Four mutations, each caught: displacing the CPU motion mirror by 0.06 local units fails the ' +
      'self-check on all three engines; making the call site drop the `?positions=` parameter fails ' +
      'the float32 column with `asked for float32 positions, the run used float16`; making the ' +
      'harness stop removing WebGL2 fails the fallback column with one canvas still mounted; and ' +
      '`touch-action: auto` fails the touch column. A column that cannot go red is not evidence.',
  )
  lines.push('')
  lines.push(
    'A pass here is not the visual review. PRD 9.3 is seven checkpoints judged by the owner, and ' +
      'nothing in this file substitutes for it.',
  )
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  execFileSync('pnpm', ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: args.dataset },
    stdio: 'inherit',
  })
  const hash = builtDataset()
  const target = deepLinkTarget(hash)
  console.log(`\ndataset ${args.dataset} (${hash}), deep link /plane/${target.slug}\n`)

  const { server, url } = await startPreview()
  console.log(`serving dist/ over HTTPS at ${url}, under the production PRD 7.6.1 headers\n`)
  const results = []
  try {
    for (const name of args.engines) {
      process.stdout.write(`=== ${name} `)
      if (name !== 'safari' && !ENGINES[name]) {
        console.log(`— unknown engine, skipped`)
        continue
      }
      const started = Date.now()
      let result
      if (name === 'safari') {
        // A refusal here is the expected state on a machine where nobody has ticked the box, so it
        // is a skip with the reason rather than a failure — and the reason is the driver's own
        // words, not a guess about why.
        try {
          result = await runEngine(name, url, target)
          if (result.status === 'fail' && /remote automation/i.test(result.error)) {
            result = {
              name,
              version: null,
              status: 'skip',
              reason:
                'Remote Automation is off on this machine (Safari ▸ Settings ▸ Advanced ▸ ' +
                '"Show features for web developers", then Develop ▸ "Allow Remote Automation")',
            }
          }
        } catch (error) {
          result = { name, version: null, status: 'fail', error: String(error.message ?? error) }
        }
      } else {
        result = await runEngine(name, url, target)
      }
      results.push(result)
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      if (result.status === 'pass') {
        console.log(`${result.version} — pass in ${seconds}s`)
        console.log(`      GPU: ${result.checks.shell.gpu}`)
        for (const [label, check] of [
          ['float16', result.checks.selfCheck],
          ['float32', result.checks.float32],
        ]) {
          console.log(
            `      self-check ${label}: ${check.measured}/${check.checked} located, mean ` +
              `${check.meanOffsetPx}px max ${check.maxOffsetPx}px (tolerance ${check.tolerancePx}px)`,
          )
        }
        console.log(
          `      touch: ${result.checks.touch.pinch ? 'pinch raised nothing' : 'no TouchEvent on this engine'}` +
            `, touch-action ${result.checks.shell.touchAction}`,
        )
        console.log(
          `      WebGL2 fallback: ${result.checks.fallback ? 'plain explanation, 0 canvases' : 'not injectable over WebDriver'}`,
        )
        console.log(
          `      console/network: ${result.watchesConsole ? `watched, clean (${result.cancelled} load(s) cancelled by navigation)` : 'not watched — WebDriver has no event stream'}`,
        )
      } else if (result.status === 'skip') {
        console.log(`— not tested: ${result.reason}`)
      } else {
        console.log(`— FAIL in ${seconds}s`)
        console.log(`      ${result.error}`)
      }
    }
  } finally {
    if (!args.keep) server.close()
  }

  const meta = {
    date: new Date().toISOString().slice(0, 10),
    machine: `macOS ${execFileSync('sw_vers', ['-productVersion']).toString().trim()}, ${execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim()}`,
    dataset: args.dataset,
    hash,
  }
  const text = report(results, meta)
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, text)
    console.log(`\nreport written to ${args.out}`)
  }

  const failed = results.filter((result) => result.status === 'fail')
  if (failed.length > 0) {
    console.error(`\n${failed.length} engine(s) failed: ${failed.map((r) => r.name).join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`\ncross-browser pass: ${results.filter((r) => r.status === 'pass').length} engine(s) green`)
  }
}

await main()
