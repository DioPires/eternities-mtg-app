#!/usr/bin/env node
/**
 * The Windows measurement kit: review §9's protocol as one command.
 *
 *   pnpm windows-kit --machine iris-xe --power plugged
 *
 * Review §9 is the missing evidence of the whole review — every GPU number in §3.3 is arithmetic
 * until someone runs the app on an Iris Xe and a Radeon 780M. This script is that run. It is
 * **not** a gate and it does not judge the product: it collects the six measurements §9 asks for,
 * writes them next to the existing macOS baselines, and prints the pass criteria with the measured
 * value beside each one.
 *
 * What it measures, per browser and per resolution (§9's list, in order):
 *
 *   1. **Frame timing**, vsync and uncapped, with the quality ladder pinned per tier. Uncapped is
 *      the only way to see headroom: with vsync on, a 60 Hz panel reports 16.7 ms whether the frame
 *      cost 3 ms or 16.
 *   2. **WebGL allocation rate** at steady state, as a timeseries across the bench path. This is
 *      the §2.2 finding — ~308 MB/s of render-target churn on this Mac — measured on the target.
 *   3. **Per-program compile and link timing.** Amendment A4: three.js caches programs by parameter
 *      hash, so expect ~13 `linkProgram` calls (15 on Firefox), not 72. Each program is timed at
 *      link, at the synchronous link-status read, and at its first draw, because on ANGLE D3D11 the
 *      real FXC cost can land in any of the three.
 *   4. **The point-size probe** — what the rasteriser did with `gl_PointSize`, against what the
 *      driver claims in `ALIASED_POINT_SIZE_RANGE`.
 *   5. **The GPU self-check** at float16 and float32 (PRD risk 6's mitigation).
 *   6. A written procedure — `PROCEDURE.md`, next to this file.
 *
 * **It measures the live site by default**, so the owner needs Node, this repo and `pnpm install`
 * and nothing else: no Python, no dataset build, no 500 MB of card images. The live site serves the
 * dataset `main` is on, carries PRD 7.6.1's real CSP — which is what §9's "zero console errors
 * under the production CSP" criterion is about — and, because the harness routes ship in the
 * production bundle (review §6.1, F7), exposes `?bench=`, `?selfcheck=` and `?probe=shell`. Use
 * `--build` to measure a local build instead.
 *
 * **Two traps this script is shaped around.** Neither is obvious and both silently produce
 * plausible wrong numbers:
 *
 *   - `page.waitForFunction` compiles a predicate in the page, which `script-src 'self'` refuses on
 *     any build carrying the real headers (`scripts/visual-gate.mjs:528`). Every wait here polls
 *     through `evaluate` and keeps the predicate in Node.
 *   - `?quality=N` is read once at the first render (`EternitiesScene.tsx:215`). On the shell the
 *     router canonicalises the address bar on boot and the parameter is gone by the time anything
 *     re-reads it; the bench route bypasses the shell, so the pin is safe *there*. Rather than trust
 *     that, every run reads the tier back off the result and **refuses** if the pin did not take —
 *     an unpinned sweep would compare four runs of the same renderer and read like four tiers.
 *
 * Options:
 *
 *   --machine <label>      required; names the laptop, e.g. `iris-xe` or `780m`
 *   --power plugged|battery  recorded in the output; §9 wants both, clocks roughly halve on battery
 *   --browsers <list>      chrome,brave,edge,firefox      (default chrome,brave,firefox)
 *   --resolutions <list>   1920x1080,2560x1440            (default 1920x1080)
 *   --tiers <list>         quality tiers to pin           (default 0,1)
 *   --angle <backend>      d3d11|vulkan, Chromium only    (default the browser's own)
 *   --url <base>           what to measure                (default the live site)
 *   --build                build and serve locally instead of using --url
 *   --window-position X,Y  place the window on a second display
 *   --out <dir>            default bench/windows/results
 *   --quick                one tier, vsync only, no self-check — a smoke test of the kit itself
 *   --keep-going           carry on after an individual run fails, and record the failure
 *
 * A browser that is missing or undrivable never aborts the pass: it is recorded as not run and the
 * others still produce a report. `--keep-going` is about failures of individual runs inside a
 * browser that otherwise works.
 *
 * `KIT_FAULT_DETACH=1` in the environment makes the *first* self-check attempt throw the detached
 * frame error that `PAGE_IS_GONE` is about. It exists because the real fault is a rare flake that
 * will not reproduce on demand, and a recovery path nobody has ever seen run is not a recovery
 * path: this is how you check that the retry fires, that it recovers, and that the report says it
 * happened. Nothing else reads it.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

import { CONSOLE_PROBE_SOURCE } from './console-probe.mjs'
import { INSTRUMENT_SOURCE } from './instrument.mjs'

const KIT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)))
const WEB_ROOT = resolve(KIT_DIR, '..', '..')

const LIVE_SITE = 'https://eternities-mtg-app.vercel.app'

/** `QUALITY_TIERS`' labels, in order (`src/scene/quality/adaptiveQuality.ts:31-36`). */
const TIER_LABELS = ['full', 'pixel-ratio', 'bloom', 'thumbnails']

/** A software rasteriser answering as the GPU. `bench.mjs` refuses these; so does this. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|mesa offscreen|basic render/i

// -------------------------------------------------------------------------------------------------
// Browsers.
//
// Real installed browsers, always — the point of §9 is what a driver does, and a bundled build
// carries its own. Chromium-family browsers are driven over CDP; Firefox over WebDriver BiDi, which
// is how puppeteer drives *release* Firefox (pointing it at a patched build does not work).
// -------------------------------------------------------------------------------------------------
const WINDOWS_PROGRAM_FILES = [
  process.env['PROGRAMFILES'] || 'C:\\Program Files',
  process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
  process.env['LOCALAPPDATA'] ? `${process.env['LOCALAPPDATA']}\\Programs` : null,
].filter(Boolean)

function candidates(windowsSuffixes, macPaths, linuxPaths, envVar) {
  const found = []
  if (process.env[envVar]) found.push(process.env[envVar])
  for (const root of WINDOWS_PROGRAM_FILES) {
    for (const suffix of windowsSuffixes) found.push(`${root}\\${suffix}`)
  }
  return [...found, ...macPaths, ...linuxPaths]
}

const BROWSERS = {
  chrome: {
    family: 'chromium',
    label: 'Google Chrome, release channel',
    paths: candidates(
      ['Google\\Chrome\\Application\\chrome.exe'],
      ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      ['/usr/bin/google-chrome'],
      'CHROME_PATH',
    ),
  },
  brave: {
    family: 'chromium',
    label: 'Brave, release channel, default shields',
    paths: candidates(
      ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
      ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
      ['/usr/bin/brave-browser'],
      'BRAVE_PATH',
    ),
  },
  edge: {
    family: 'chromium',
    label: 'Microsoft Edge, release channel',
    paths: candidates(
      ['Microsoft\\Edge\\Application\\msedge.exe'],
      ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      ['/usr/bin/microsoft-edge'],
      'EDGE_PATH',
    ),
  },
  firefox: {
    family: 'firefox',
    label: 'Mozilla Firefox, release channel',
    paths: candidates(
      ['Mozilla Firefox\\firefox.exe'],
      ['/Applications/Firefox.app/Contents/MacOS/firefox'],
      ['/usr/bin/firefox'],
      'FIREFOX_PATH',
    ),
  },
}

function findBrowser(name) {
  const spec = BROWSERS[name]
  if (!spec) throw new Error(`unknown browser ${name}; known: ${Object.keys(BROWSERS).join(', ')}`)
  const path = spec.paths.find((candidate) => existsSync(candidate))
  if (!path) {
    throw new Error(
      `${name} not found. Set ${name.toUpperCase()}_PATH to its executable. Tried:\n    ` +
        spec.paths.join('\n    '),
    )
  }
  return { ...spec, name, path }
}

// -------------------------------------------------------------------------------------------------
// Arguments.
// -------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    machine: null,
    power: 'plugged',
    browsers: ['chrome', 'brave', 'firefox'],
    resolutions: ['1920x1080'],
    tiers: [0, 1],
    angle: null,
    url: LIVE_SITE,
    build: false,
    windowPosition: null,
    out: resolve(KIT_DIR, 'results'),
    quick: false,
    keepGoing: false,
  }
  const list = (value) => value.split(',').map((entry) => entry.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') {
      // The header of this file is the manual; print the option block out of it rather than keeping
      // a second copy that can disagree with it.
      console.log(
        'Windows measurement kit (review §9)\n\n' +
          '  pnpm windows-kit --machine <label> [--power plugged|battery]\n' +
          '                   [--browsers chrome,brave,edge,firefox] [--resolutions 1920x1080,2560x1440]\n' +
          '                   [--tiers 0,1] [--angle d3d11|vulkan] [--url <base>] [--build]\n' +
          '                   [--window-position X,Y] [--out <dir>] [--quick] [--keep-going]\n\n' +
          'Read PROCEDURE.md next to this script first. --machine is required.\n',
      )
      process.exit(0)
    }
    if (flag === '--machine') args.machine = argv[++i]
    else if (flag === '--power') args.power = argv[++i]
    else if (flag === '--browsers') args.browsers = list(argv[++i])
    else if (flag === '--resolutions') args.resolutions = list(argv[++i])
    else if (flag === '--tiers') args.tiers = list(argv[++i]).map(Number)
    else if (flag === '--angle') args.angle = argv[++i]
    else if (flag === '--url') args.url = argv[++i].replace(/\/$/, '')
    else if (flag === '--build') args.build = true
    else if (flag === '--window-position') args.windowPosition = argv[++i]
    else if (flag === '--out') args.out = resolve(process.cwd(), argv[++i])
    else if (flag === '--quick') args.quick = true
    else if (flag === '--keep-going') args.keepGoing = true
    else throw new Error(`unknown argument ${flag}`)
  }
  if (!args.machine) throw new Error('--machine is required; it names the laptop in the output')
  if (args.power !== 'plugged' && args.power !== 'battery') {
    throw new Error('--power must be plugged or battery')
  }
  for (const tier of args.tiers) {
    if (!Number.isInteger(tier) || tier < 0 || tier >= TIER_LABELS.length) {
      throw new Error(`--tiers takes integers 0..${TIER_LABELS.length - 1}; got ${tier}`)
    }
  }
  for (const resolution of args.resolutions) {
    if (!/^\d+x\d+$/.test(resolution)) throw new Error(`--resolutions takes WxH; got ${resolution}`)
  }
  if (args.quick) {
    args.tiers = [args.tiers[0]]
  }
  return args
}

// -------------------------------------------------------------------------------------------------
// Serving, when `--build` asks for a local target rather than the live site.
// -------------------------------------------------------------------------------------------------
async function startPreview() {
  execFileSync('pnpm', ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: 'production' },
    stdio: 'inherit',
  })
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview did not start')), 60_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const match = /(http:\/\/localhost:\d+)/.exec(chunk)
      if (match) {
        clearTimeout(timer)
        ok(match[1])
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`vite preview exited with ${code}`))
    })
  })
  return { child, url }
}

// -------------------------------------------------------------------------------------------------
// Driving.
// -------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Errors that mean this page will never answer again, so polling on to the deadline is pointless.
 *
 * A main-frame swap that puppeteer fails to follow leaves the `Page` pointing at a frame that is
 * already detached, and *every* later `evaluate` throws the same thing — so a self-check that has
 * really gone wrong burns its full 600 s timeout before saying so. Observed once on Brave, on the
 * float32 self-check, on macOS.
 *
 * `Execution context was destroyed` is deliberately **not** here: that one is an ordinary
 * navigation racing a read, and the next poll succeeds. Treating it as fatal would abort healthy
 * runs.
 */
const PAGE_IS_GONE = /detached Frame|Target closed|Session closed|Target crashed/i

/**
 * Poll `read` until `ok` accepts it, or throw.
 *
 * The predicate stays in Node and only data crosses, so nothing is compiled in the page and this
 * behaves identically under PRD 7.6.1's CSP. See the header note on `waitForFunction`.
 */
async function pollFor(read, ok, describe, timeout, onSample) {
  const deadline = Date.now() + timeout
  let last
  for (;;) {
    try {
      last = await read()
      if (onSample) onSample(last)
      if (ok(last)) return last
    } catch (error) {
      if (PAGE_IS_GONE.test(error.message)) {
        const gone = new Error(`the page went away while waiting for ${describe}: ${error.message}`)
        gone.pageIsGone = true
        throw gone
      }
      last = `threw ${error.message}`
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${Math.round(timeout / 1000)}s waiting for ${describe} ` +
          `(last: ${JSON.stringify(last)?.slice(0, 300)})`,
      )
    }
    await sleep(1000)
  }
}

function launchArgs(browser, args, resolution, uncapped) {
  const [width, height] = resolution.split('x').map(Number)
  if (browser.family === 'firefox') {
    // Firefox has no equivalent of Chromium's vsync switches, so an uncapped Firefox run is not
    // offered rather than silently returning a vsync-locked number under an "uncapped" label.
    return [`--window-size=${width},${height}`]
  }
  return [
    `--window-size=${width},${height}`,
    ...(args.windowPosition ? [`--window-position=${args.windowPosition}`] : []),
    '--hide-scrollbars',
    // Ask for the real GPU. A SwiftShader run is not a measurement, and the result is refused
    // below either way.
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    ...(args.angle ? [`--use-angle=${args.angle}`] : []),
    ...(uncapped
      ? ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-features=CalculateNativeWinOcclusion']
      : []),
  ]
}

async function launch(browser, args, resolution, uncapped) {
  return puppeteer.launch({
    executablePath: browser.path,
    browser: browser.family === 'firefox' ? 'firefox' : 'chrome',
    headless: false,
    // `null`, so the page keeps the window's own size and the OS's own scaling. §9: "do not emulate
    // dpr". `bench.mjs` deliberately forces `deviceScaleFactor` 2 to reproduce the Retina reference
    // machine; that is exactly the wrong thing here, where the whole question is what the target's
    // real pixel ratio costs.
    defaultViewport: null,
    args: launchArgs(browser, args, resolution, uncapped),
  })
}

/** What the page is, physically: the numbers every measurement below has to be read against. */
async function readEnvironment(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: screen.width, height: screen.height },
      drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: navigator.deviceMemory ?? null,
    }
  })
}

const snapshot = (page) =>
  page.evaluate(() =>
    window.__eternitiesGpuProbe ? window.__eternitiesGpuProbe.snapshot() : null,
  )

async function newInstrumentedPage(browser, collect) {
  const page = await browser.newPage()
  // Before any of the app's script runs, so the prototype wrapping precedes the first context.
  await page.evaluateOnNewDocument(INSTRUMENT_SOURCE)
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
      collect.consoleErrors.push(text)
    } else if (message.type() === 'warning') {
      collect.consoleWarnings.push(text)
    }
  })
  page.on('pageerror', (error) => collect.pageErrors.push(error.message))
  return page
}

/**
 * Derive an allocation rate from the snapshot timeseries.
 *
 * The first seconds of a run are load — the atlas, the shard buffers, the render targets — and they
 * are not what §9's `< 1 MB/s` criterion is about. So the rate is measured from `skipMs` onwards,
 * which is steady state; what was allocated before that window is carried separately as
 * `estimatedMbBeforeWindow` rather than averaged in.
 */
function allocationRate(series, skipMs = 12_000) {
  const steady = series.filter((sample) => sample.atMs >= skipMs)
  if (steady.length < 2) return null
  const first = steady[0]
  const last = steady[steady.length - 1]
  const seconds = (last.atMs - first.atMs) / 1000
  if (seconds <= 0) return null
  const delta = (a, b) => b - a
  const bytes =
    delta(first.textures.estimatedBytes, last.textures.estimatedBytes) +
    delta(
      first.framebuffers.estimatedRenderbufferBytes,
      last.framebuffers.estimatedRenderbufferBytes,
    )
  return {
    windowS: Math.round(seconds * 10) / 10,
    texturesCreatedPerS: Math.round((delta(first.textures.created, last.textures.created) / seconds) * 10) / 10,
    texturesDeletedPerS: Math.round((delta(first.textures.deleted, last.textures.deleted) / seconds) * 10) / 10,
    estimatedMbPerS: Math.round((bytes / seconds / 1e6) * 10) / 10,
    liveTexturesAtEnd: last.textures.live,
    // Everything allocated before the steady-state window opened — load *and* the first `skipMs` of
    // churn together, not load alone. Named for what it is: at a few hundred MB/s the churn
    // dominates it within a second or two, so reading it as a loading cost would be wrong by an
    // order of magnitude.
    skippedMs: skipMs,
    estimatedMbBeforeWindow: Math.round((first.textures.estimatedBytes / 1e6) * 10) / 10,
  }
}

/**
 * One bench run: the shipped scene, flown along `src/bench/benchPath.ts`, with the ladder pinned.
 *
 * Returns the frame statistics the page computed, the allocation timeseries taken while it flew,
 * and, on the first run of each browser, the per-program shader timings.
 *
 * Every run is cold: a browser is launched per run and puppeteer gives each launch its own
 * temporary profile, so ANGLE's on-disk program cache is always empty. The shader timings are
 * recorded once per browser only to keep the report readable — not because the later runs are warm.
 */
async function benchRun(browserProcess, args, { resolution, tier, uncapped, cold }) {
  const collect = { consoleErrors: [], consoleWarnings: [], pageErrors: [] }
  const page = await newInstrumentedPage(browserProcess, collect)
  try {
    const query = new URLSearchParams({ bench: '1', quality: String(tier) })
    await page.goto(`${args.url}/?${query}`, { waitUntil: 'load', timeout: 120_000 })

    const series = []
    // The path is 39 s plus load and warm-up. Sampling the probe every second while waiting for the
    // result costs nothing and is where the allocation timeseries comes from.
    const result = await pollFor(
      () =>
        page.evaluate(() => ({
          bench: window.__eternitiesBench ?? null,
          probe: window.__eternitiesGpuProbe ? window.__eternitiesGpuProbe.snapshot() : null,
        })),
      (value) => value.bench !== null,
      `the bench result at tier ${tier}, ${resolution}, ${uncapped ? 'uncapped' : 'vsync'}`,
      300_000,
      (value) => {
        if (value.probe) series.push(value.probe)
      },
    )

    const environment = await readEnvironment(page)
    const final = result.probe ?? (await snapshot(page))
    // §9's sizes: 1, 7, 22x dpr and 33 px. 22x dpr is the star shader's own upper bound once the
    // pixel ratio is folded in, which is the size a geometry-shader emulation is most likely to
    // clamp.
    const pointSize =
      cold && final
        ? await page.evaluate(
            (dpr) => window.__eternitiesGpuProbe.pointSizeProbe([1, 7, 22 * dpr, 33]),
            environment.devicePixelRatio,
          )
        : null

    return {
      resolution,
      tier,
      tierLabel: TIER_LABELS[tier],
      frameCap: uncapped ? 'uncapped' : 'vsync',
      environment,
      bench: result.bench,
      gpu: final?.gpu ?? null,
      firstFrameMs: final?.firstFrameMs ?? null,
      parallelShaderCompile: final?.parallelShaderCompile ?? null,
      allocation: {
        rate: allocationRate(series),
        samples: series.length,
        totals: final
          ? { textures: final.textures, framebuffers: final.framebuffers, buffers: final.buffers }
          : null,
      },
      // Only meaningful on a cold profile: a warm shader cache answers in microseconds and would
      // report the ANGLE FXC path as free. See `PROCEDURE.md` on why each browser gets a fresh
      // profile.
      shaders: cold && final ? final.programs : null,
      pointSize,
      console: collect,
    }
  } finally {
    await page.close().catch(() => {})
  }
}

/** The GPU self-check (PRD 8.5.7) at one position mode. */
async function selfCheckRun(browserProcess, args, positions) {
  const collect = { consoleErrors: [], consoleWarnings: [], pageErrors: [] }
  const page = await newInstrumentedPage(browserProcess, collect)
  try {
    const query = new URLSearchParams({ selfcheck: '1' })
    if (positions) query.set('positions', positions)
    await page.goto(`${args.url}/?${query}`, { waitUntil: 'load', timeout: 120_000 })
    const result = await pollFor(
      () => {
        if (process.env['KIT_FAULT_DETACH'] === '1' && selfCheckAttempts === 1) {
          throw new Error("Attempted to use detached Frame 'FAULTINJECTED'.")
        }
        return page.evaluate(() => window.__eternitiesSelfCheck ?? null)
      },
      (value) => value !== null,
      `the self-check result (${positions ?? 'float16'})`,
      600_000,
    )
    return {
      requestedPositions: positions ?? 'float16',
      // Read back, never assumed: a URL parameter the engine ignored would otherwise report the
      // float16 path passing twice under two labels (`cross-browser.mjs` check 3).
      positionMode: result.positionMode,
      took: (positions ?? 'float16') === result.positionMode,
      ok: result.ok,
      checked: result.checked,
      measured: result.measured,
      agreed: result.agreed,
      occluded: result.occluded,
      missed: result.missed.length,
      meanOffsetPx: result.meanOffsetPx,
      maxOffsetPx: result.maxOffsetPx,
      tolerancePx: result.tolerancePx,
      buffer: result.buffer,
      console: collect,
    }
  } finally {
    await page.close().catch(() => {})
  }
}

/** How many times a self-check may be launched before its failure is recorded as the result. */
const SELF_CHECK_ATTEMPTS = 2

/** Which attempt is in flight; read only by the `KIT_FAULT_DETACH` fault injection. */
let selfCheckAttempts = 0

/**
 * One self-check, retried on a fresh browser if the page went away rather than answered.
 *
 * A self-check is a fresh load that computes its verdict from scratch, so re-running it is free of
 * consequence — unlike a bench run, which is a timed camera path and must not be silently repeated
 * until it looks good. The retry is bounded, it fires **only** for `PAGE_IS_GONE` (never for a
 * tolerance failure, which is the finding §9 is asking for), and the attempt count is recorded, so
 * a machine that needs the retry every time is visible in the report instead of hidden by it.
 */
async function selfCheckWithRetry(browser, args, positions) {
  const label = positions ?? 'float16'
  for (let attempt = 1; ; attempt += 1) {
    selfCheckAttempts = attempt
    process.stdout.write(`  self-check ${label}${attempt > 1 ? ` (attempt ${attempt})` : ''} ... `)
    const browserProcess = await launch(browser, args, args.resolutions[0], false)
    try {
      const check = await selfCheckRun(browserProcess, args, positions)
      console.log(
        `${check.ok ? 'ok' : 'FAILED'} — mode ${check.positionMode}` +
          `${check.took ? '' : ' (REQUESTED MODE DID NOT TAKE)'}, ` +
          `${check.missed} missed, max offset ${check.maxOffsetPx} px`,
      )
      return attempt > 1 ? { ...check, attempts: attempt } : check
    } catch (error) {
      const gone = error.pageIsGone || PAGE_IS_GONE.test(error.message)
      console.log(`FAILED: ${error.message.split('\n')[0]}`)
      if (gone && attempt < SELF_CHECK_ATTEMPTS) continue
      return { requestedPositions: label, attempts: attempt, error: error.message }
    } finally {
      await browserProcess.close().catch(() => {})
    }
  }
}

/**
 * The whole battery on one browser.
 *
 * A fresh profile per browser, because §9's compile timing is a question about a *cold* shader
 * cache: ANGLE writes linked program binaries into the user profile, so a second run on the same
 * profile reports the FXC path as free.
 */
async function runBrowser(name, args) {
  const browser = findBrowser(name)
  console.log(`\n=== ${name}: ${browser.label}\n    ${browser.path}`)
  const runs = []
  const selfChecks = []
  let cold = true

  for (const resolution of args.resolutions) {
    // vsync always; uncapped only where the browser can actually unlock the frame rate.
    const caps = args.quick || browser.family === 'firefox' ? [false] : [false, true]
    for (const uncapped of caps) {
      for (const tier of args.tiers) {
        const what = `${resolution} tier ${tier} (${TIER_LABELS[tier]}) ${uncapped ? 'uncapped' : 'vsync'}`
        process.stdout.write(`  bench ${what} ... `)
        const browserProcess = await launch(browser, args, resolution, uncapped)
        try {
          const run = await benchRun(browserProcess, args, { resolution, tier, uncapped, cold })
          cold = false
          runs.push(run)
          const bench = run.bench
          console.log(
            `${bench.fps} fps, p95 ${bench.frameMsP95} ms, ` +
              `buffer ${bench.viewport.width}x${bench.viewport.height} @ dpr ${bench.viewport.dpr}, ` +
              `alloc ${run.allocation.rate ? `${run.allocation.rate.estimatedMbPerS} MB/s` : 'n/a'}`,
          )
        } catch (error) {
          console.log(`FAILED: ${error.message.split('\n')[0]}`)
          runs.push({ resolution, tier, frameCap: uncapped ? 'uncapped' : 'vsync', error: error.message })
          if (!args.keepGoing) throw error
        } finally {
          await browserProcess.close().catch(() => {})
        }
      }
    }
  }

  if (!args.quick) {
    for (const positions of [null, 'float32']) {
      const check = await selfCheckWithRetry(browser, args, positions)
      selfChecks.push(check)
      if (!check.error) continue
      if (!args.keepGoing) throw new Error(check.error)
    }
  }

  return { browser: name, label: browser.label, executable: browser.path, runs, selfChecks }
}

// -------------------------------------------------------------------------------------------------
// Verdict.
//
// §9's pass criteria, each printed with the measured value beside it. Deliberately reported rather
// than enforced with an exit code: this is a measurement protocol whose job is to replace an
// estimate, and a red criterion is a finding to route, not a broken build. The one thing that *is*
// refused is a run that did not measure what it claims to — a software rasteriser, or a tier pin
// that did not take.
// -------------------------------------------------------------------------------------------------
function integrity(report) {
  const problems = []
  for (const engine of report.engines) {
    for (const run of engine.runs) {
      if (run.error) continue
      const renderer = run.gpu?.renderer ?? run.gpu?.glRenderer ?? ''
      if (SOFTWARE_RENDERER.test(renderer)) {
        problems.push(`${engine.browser} ${run.resolution} tier ${run.tier}: software rasteriser (${renderer})`)
      }
      // The pin, read back off the run. An unpinned sweep measures one renderer four times.
      if (run.bench && run.bench.qualityTier !== run.tierLabel) {
        problems.push(
          `${engine.browser} ${run.resolution}: ?quality=${run.tier} did not take — ` +
            `asked for ${run.tierLabel}, ran at ${run.bench.qualityTier}`,
        )
      }
      if (run.bench && run.bench.qualityChanges > 0) {
        problems.push(
          `${engine.browser} ${run.resolution} tier ${run.tier}: the ladder moved ` +
            `${run.bench.qualityChanges} times, so the run is not a single tier`,
        )
      }
      if (run.bench?.undrivenSegments?.length) {
        problems.push(
          `${engine.browser} ${run.resolution} tier ${run.tier}: segments measured empty — ` +
            run.bench.undrivenSegments.join(', '),
        )
      }
    }
    for (const check of engine.selfChecks) {
      if (!check.error && !check.took) {
        problems.push(
          `${engine.browser}: ?positions=${check.requestedPositions} did not take ` +
            `(ran ${check.positionMode}), so this row is not the mode it is labelled`,
        )
      }
    }
  }
  return problems
}

function criteria(report) {
  const rows = []
  const at = (resolution, tier, cap) =>
    report.engines.flatMap((engine) =>
      engine.runs
        .filter((run) => !run.error && run.resolution === resolution && run.tier === tier && run.frameCap === cap)
        .map((run) => ({ engine: engine.browser, run })),
    )

  const p95 = at('1920x1080', 0, 'vsync')
  rows.push({
    criterion: 'p95 frame interval <= 16.7 ms at tier 0, 1080p (vsync)',
    measured: p95.length
      ? p95.map(({ engine, run }) => `${engine} ${run.bench.frameMsP95} ms`).join(', ')
      : 'not run',
    pass: p95.length ? p95.every(({ run }) => run.bench.frameMsP95 <= 16.7) : null,
  })

  const wide = [...at('2560x1440', 0, 'vsync'), ...at('2560x1440', 1, 'vsync')]
  rows.push({
    criterion: 'tier <= 1 holds 60 fps at 1440p',
    measured: wide.length
      ? wide.map(({ engine, run }) => `${engine} t${run.tier} ${run.bench.fps} fps`).join(', ')
      : 'not run (needs --resolutions 2560x1440 on the external monitor)',
    pass: wide.length ? wide.some(({ run }) => run.bench.fps >= 59) : null,
  })

  const checks = report.engines.flatMap((engine) =>
    engine.selfChecks.filter((check) => !check.error).map((check) => ({ engine: engine.browser, check })),
  )
  rows.push({
    criterion: 'zero self-check tolerance failures (float16 and float32)',
    measured: checks.length
      ? checks.map(({ engine, check }) => `${engine} ${check.positionMode} ${check.missed} missed`).join(', ')
      : 'not run',
    pass: checks.length ? checks.every(({ check }) => check.ok && check.missed === 0) : null,
  })

  // Counted over the runs that actually happened, and `null` when none did: "no console errors
  // were seen" is not a pass when nothing was ever loaded.
  const completed = report.engines.flatMap((engine) =>
    engine.runs.filter((run) => !run.error).map((run) => ({ engine: engine.browser, run })),
  )
  const errors = completed.flatMap(({ engine, run }) =>
    run.console.consoleErrors.map((text) => `${engine}: ${text}`),
  )
  rows.push({
    criterion: 'zero console errors under the production CSP',
    measured:
      completed.length === 0
        ? 'not run'
        : errors.length === 0
          ? `none across ${completed.length} runs`
          : `${errors.length}: ${errors.slice(0, 3).join(' | ')}`,
    pass: completed.length === 0 ? null : errors.length === 0,
  })

  const rates = report.engines.flatMap((engine) =>
    engine.runs
      .filter((run) => !run.error && run.allocation.rate)
      .map((run) => ({ engine: engine.browser, rate: run.allocation.rate })),
  )
  rows.push({
    criterion: 'allocation rate at steady state < 1 MB/s',
    measured: rates.length
      ? rates.map(({ engine, rate }) => `${engine} ${rate.estimatedMbPerS} MB/s`).join(', ')
      : 'not measured',
    pass: rates.length ? rates.every(({ rate }) => rate.estimatedMbPerS < 1) : null,
  })

  return rows
}

function summarise(report) {
  const lines = []
  lines.push(`\n${'='.repeat(96)}`)
  lines.push(`Windows measurement kit — machine "${report.machine}", ${report.power}`)
  lines.push(`target ${report.url}${report.built ? ' (local build)' : ''}, host ${report.host.platform} ${report.host.release}`)
  lines.push('='.repeat(96))

  for (const engine of report.engines) {
    if (engine.error) {
      lines.push(`\n${engine.browser}: NOT RUN — ${engine.error}`)
      continue
    }
    const first = engine.runs.find((run) => !run.error)
    lines.push(`\n${engine.browser} — ${engine.label}`)
    if (first) {
      lines.push(`  GPU        ${first.gpu?.renderer ?? first.gpu?.glRenderer ?? 'unknown'}`)
      lines.push(`  viewport   ${first.environment.viewport.width}x${first.environment.viewport.height} CSS @ dpr ${first.environment.devicePixelRatio}`)
      lines.push(`  parallel shader compile: ${first.parallelShaderCompile === null ? 'unknown' : first.parallelShaderCompile}`)
    }
    lines.push('  res         tier         cap        fps   p50    p95    max   cpu95   buffer            alloc MB/s')
    for (const run of engine.runs) {
      if (run.error) {
        lines.push(`  ${run.resolution.padEnd(11)} tier ${run.tier}       ${String(run.frameCap).padEnd(9)}  FAILED`)
        continue
      }
      const bench = run.bench
      lines.push(
        `  ${run.resolution.padEnd(11)} ${`${run.tier} ${run.tierLabel}`.padEnd(12)} ${run.frameCap.padEnd(9)} ` +
          `${String(bench.fps).padStart(5)} ${String(bench.frameMsP50).padStart(5)} ` +
          `${String(bench.frameMsP95).padStart(6)} ${String(bench.frameMsMax).padStart(6)} ` +
          `${String(bench.cpuMsP95).padStart(7)}   ` +
          `${`${bench.viewport.width}x${bench.viewport.height}@${bench.viewport.dpr}`.padEnd(17)} ` +
          `${run.allocation.rate ? String(run.allocation.rate.estimatedMbPerS).padStart(10) : '       n/a'}`,
      )
    }

    const shaders = engine.runs.find((run) => run.shaders)?.shaders
    if (shaders) {
      lines.push(
        `\n  shader programs (cold profile): ${shaders.linkProgramCalls} linkProgram calls, ` +
          `${shaders.syncMsTotal} ms total in synchronous link-status reads`,
      )
      lines.push('    id  name                            link ms   sync ms   first draw ms')
      for (const program of shaders.each) {
        lines.push(
          `    ${String(program.id).padStart(2)}  ${String(program.name ?? '(unnamed)').padEnd(30)} ` +
            `${String(program.linkMs ?? '-').padStart(8)}  ${String(program.syncMs ?? '-').padStart(8)}  ` +
            `${String(program.firstDrawMs ?? '-').padStart(13)}`,
        )
      }
      // Amendment A4 expects ~13 programs (15 on Firefox) because three.js caches by parameter
      // hash. A *named* program appearing twice is not that cache missing — it is the same material
      // linked again, which is what the postprocessing wrapper does when it rebuilds the bloom
      // effect (review §2.2). Naming the repeats turns "more programs than expected" into the
      // reason for it.
      const seen = new Map()
      for (const program of shaders.each) {
        if (program.name) seen.set(program.name, (seen.get(program.name) ?? 0) + 1)
      }
      const rebuilt = [...seen.entries()].filter(([, count]) => count > 1)
      if (rebuilt.length > 0) {
        lines.push(
          `    relinked programs (same material, linked more than once): ` +
            rebuilt.map(([name, count]) => `${name} x${count}`).join(', '),
        )
      }
    }

    const pointSize = engine.runs.find((run) => run.pointSize)?.pointSize
    if (pointSize && !pointSize.error) {
      lines.push(
        `\n  point size — driver claims ALIASED_POINT_SIZE_RANGE ` +
          `[${pointSize.aliasedPointSizeRange.join(', ')}]`,
      )
      for (const size of pointSize.sizes) {
        lines.push(
          `    requested ${String(size.requestedPx).padStart(6)} px -> measured ` +
            `${String(size.measuredPx).padStart(6)} px (${size.coveredPixels} px covered)` +
            `${size.clamped ? '   CLAMPED' : ''}`,
        )
      }
    }

    for (const check of engine.selfChecks) {
      // A retried self-check says so on its own line. A machine where the page keeps going away is
      // a finding about that machine, and it must not be readable as a clean first-try pass.
      const retried = check.attempts > 1 ? ` [took ${check.attempts} attempts]` : ''
      if (check.error) {
        lines.push(
          `\n  self-check ${check.requestedPositions}: FAILED${retried} — ${check.error.split('\n')[0]}`,
        )
        continue
      }
      lines.push(
        `\n  self-check ${check.requestedPositions}: ${check.ok ? 'ok' : 'FAILED'}${retried} — ` +
          `mode ${check.positionMode}${check.took ? '' : ' (DID NOT TAKE)'}, ` +
          `${check.measured} measured, ${check.agreed} agreed, ${check.occluded} occluded, ` +
          `${check.missed} missed, mean ${check.meanOffsetPx} px, max ${check.maxOffsetPx} px ` +
          `(tolerance ${check.tolerancePx} px)`,
      )
    }
  }

  lines.push(`\n${'-'.repeat(96)}\nReview §9 pass criteria\n${'-'.repeat(96)}`)
  for (const row of report.criteria) {
    const mark = row.pass === null ? '   ?' : row.pass ? '  ok' : 'FAIL'
    lines.push(`  [${mark}] ${row.criterion}`)
    lines.push(`         ${row.measured}`)
  }

  if (report.integrity.length > 0) {
    lines.push(`\n${'-'.repeat(96)}\nTHESE RUNS DID NOT MEASURE WHAT THEY CLAIM\n${'-'.repeat(96)}`)
    for (const problem of report.integrity) lines.push(`  - ${problem}`)
  }

  lines.push(
    '\nStill to paste in by hand (§9): chrome://gpu and about:support, and a repeat of the whole ' +
      'run on battery.\n',
  )
  return lines.join('\n')
}

// -------------------------------------------------------------------------------------------------
// The run.
// -------------------------------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2))

mkdirSync(args.out, { recursive: true })
// Written on every run, so the snippet for a browser this kit could not drive is always generated
// from the same instrumentation the driven runs used and cannot drift from it.
writeFileSync(resolve(args.out, 'console-probe.js'), CONSOLE_PROBE_SOURCE)

let preview = null
if (args.build) {
  preview = await startPreview()
  args.url = preview.url
}

const report = {
  kit: 'windows-measurement-kit',
  source: 'REVIEW-2026-09-08.md revision 2, §9',
  machine: args.machine,
  power: args.power,
  url: args.url,
  built: args.build,
  angle: args.angle,
  requested: { browsers: args.browsers, resolutions: args.resolutions, tiers: args.tiers, quick: args.quick },
  host: { platform: platform(), release: process.report?.getReport?.()?.header?.osRelease ?? null },
  engines: [],
}

try {
  for (const name of args.browsers) {
    try {
      report.engines.push(await runBrowser(name, args))
    } catch (error) {
      // Never fatal, regardless of `--keep-going`. A browser that is not installed, or that this
      // kit cannot drive — Firefox over WebDriver BiDi is the likeliest, and is the case
      // `PROCEDURE.md` gives a by-hand path for — is an expected condition on the owner's machine,
      // not a reason to throw away the browsers that did run. `--keep-going` governs failures of
      // individual runs *within* a browser; this loop always carries on.
      console.log(`\n${name}: not run — ${error.message.split('\n')[0]}`)
      report.engines.push({ browser: name, error: error.message, runs: [], selfChecks: [] })
    }
  }
} finally {
  if (preview) preview.child.kill('SIGTERM')
}

report.integrity = integrity(report)
report.criteria = criteria(report)

const summary = summarise(report)
console.log(summary)

mkdirSync(args.out, { recursive: true })
// A machine-and-power-stamped name, because §9 wants four runs — two laptops, plugged and on
// battery — and they must not overwrite each other. No timestamp: a re-run of the same
// configuration replaces it, which is what you want while getting the setup right.
const stem = resolve(args.out, `${args.machine}-${args.power}`)
writeFileSync(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(`${stem}.txt`, `${summary}\n`)
console.log(`wrote ${stem}.json\nwrote ${stem}.txt`)

// Exit non-zero only when the evidence is not what it says it is. A failed §9 criterion is the
// finding this kit exists to produce, not an error.
if (report.integrity.length > 0) {
  console.error('\nrefusing: the runs above did not measure what they claim')
  process.exit(1)
}
