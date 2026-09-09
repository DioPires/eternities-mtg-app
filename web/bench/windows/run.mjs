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
 *   --power plugged|battery  §9 wants both, clocks roughly halve on battery; checked against
 *                          `navigator.getBattery()` where the engine has it
 *   --browsers <list>      chrome,brave,edge,firefox      (default chrome,brave,firefox)
 *   --resolutions <list>   1920x1080,2560x1440            (default 1920x1080); checked against the
 *                          window the browser actually opened, not taken as read
 *   --tiers <list>         quality tiers to pin           (default 0,1)
 *   --angle <backend>      d3d11|vulkan, Chromium only    (default the browser's own); checked
 *                          against the ANGLE renderer string
 *   --url <base>           what to measure                (default the live site)
 *   --build                build and serve locally instead of using --url
 *   --window-position X,Y  place the window on a second display
 *   --out <dir>            default bench/windows/results
 *   --quick                one tier, vsync only, no self-check — a smoke test of the kit itself
 *   --fail-fast            stop a browser's battery at its first failed run (debugging only)
 *
 * **Nothing measured is ever thrown away.** A browser that is missing or undrivable is recorded as
 * not run and the others still produce a report; a run that fails inside a browser that otherwise
 * works is recorded as failed and the battery carries on; a browser that stops answering part-way
 * — one that will no longer even start is the case seen in the field — ends that browser's battery
 * with every row it had already measured kept, printed under `DID NOT FINISH`, listed in
 * `incomplete`, and exited 2. That is the default, and it is the only
 * behaviour the owner should ever see: on their machines one invocation is ~10 bench runs and 6
 * self-checks, the self-check has a known flake (see `PAGE_IS_GONE`), and a late failure discarding
 * the earlier numbers would delete exactly the two results §9 exists to obtain. `--fail-fast` is for
 * debugging this script; it truncates the battery, so a `--fail-fast` run that fires exits non-zero
 * and says which browsers did not finish. `--keep-going` is accepted and ignored — it is now the
 * default.
 *
 * `KIT_FAULT_DETACH=1` in the environment makes the *first* self-check attempt throw the detached
 * frame error that `PAGE_IS_GONE` is about. It exists because the real fault is a rare flake that
 * will not reproduce on demand, and a recovery path nobody has ever seen run is not a recovery
 * path: this is how you check that the retry fires, that it recovers, and that the report says it
 * happened. `KIT_FAULT_LAUNCH=n` is the same idea for the other unreproducible fault: it makes the
 * nth browser launch of the process fail the way puppeteer's 30 s connect timeout does, which is
 * how you check that a battery cut short mid-way keeps the rows it had already measured. Both
 * inject a message that says it was injected. Nothing else reads either.
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
    failFast: false,
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
          '                   [--window-position X,Y] [--out <dir>] [--quick] [--fail-fast]\n\n' +
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
    else if (flag === '--fail-fast') args.failFast = true
    // Accepted and ignored: carrying on is now the default, and an owner following an older copy of
    // the procedure must not get `unknown argument` for asking for what already happens.
    else if (flag === '--keep-going') continue
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
  if (args.windowPosition && !/^-?\d+,-?\d+$/.test(args.windowPosition)) {
    throw new Error(`--window-position takes X,Y; got ${args.windowPosition}`)
  }
  // Refused rather than silently ignored. `--window-position` is a Chromium switch; Firefox has no
  // equivalent and no scriptable way to move a window it did not open, so a Firefox window asked to
  // sit on the external monitor opens on the primary display instead. Left alone, that produces a
  // row labelled with the external monitor's resolution off a run that never saw it — which is a
  // false green on the one criterion §3.3 calls "not plausible today". The run's own resolution
  // check would catch it now, but refusing up front costs the owner 40 minutes less than finding
  // out afterwards.
  if (args.windowPosition && args.browsers.includes('firefox')) {
    throw new Error(
      'firefox cannot be placed with --window-position (it is a Chromium switch, and Firefox has ' +
        'no equivalent), so a --window-position run must not include it.\n' +
        '    Add --browsers chrome,brave to this invocation, and get Firefox on that display by ' +
        'hand — PROCEDURE.md, "Firefox, if the automated run could not drive it".',
    )
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

/** How many browsers this process has launched; read only by the `KIT_FAULT_LAUNCH` injection. */
let launches = 0

async function launch(browser, args, resolution, uncapped) {
  launches += 1
  // `KIT_FAULT_LAUNCH=n` makes the nth launch of the process fail the way a real one does. See the
  // header: a launch timeout is the fault that used to delete a battery's completed runs, and it
  // cannot be provoked on demand on a machine where the browser starts fine.
  const faultAt = Number(process.env['KIT_FAULT_LAUNCH'] ?? 0)
  if (faultAt > 0 && launches === faultAt) {
    throw new Error(
      `Timed out after 30000 ms while trying to connect to the browser! ` +
        `(injected by KIT_FAULT_LAUNCH=${faultAt}; this is not a real launch failure)`,
    )
  }
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
  return page.evaluate(async () => {
    const canvas = document.querySelector('canvas')
    // Chromium only; Firefox removed the Battery Status API, so `null` here means "not knowable"
    // and never "plugged in". The caller must not read the absence as a pass.
    let battery = null
    try {
      if (navigator.getBattery) {
        const status = await navigator.getBattery()
        battery = { charging: status.charging, level: status.level }
      }
    } catch {
      battery = null
    }
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: screen.width, height: screen.height },
      drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: navigator.deviceMemory ?? null,
      battery,
    }
  })
}

/**
 * Did this run measure the resolution its row is labelled with?
 *
 * `--resolutions` is a *request*: it becomes `--window-size`, and from there the OS, the browser
 * chrome and the display all get a say. Nothing used to compare the request to the result, so the
 * table's resolution column, and the criteria that select on it, were reporting an intention. The
 * damage is specific and one-directional: on the 1440p leg a window that stayed on the 1080p laptop
 * panel still produces a row labelled `2560x1440`, and 60 fps there reads as an `ok` for the
 * criterion §3.3 calls "not plausible today".
 *
 * Two independent numbers, because they answer different questions:
 *
 *   - **The window**, in device pixels — `viewport * devicePixelRatio`. This is the pixel count the
 *     GPU actually filled, so it is what decides whether the *measurement* is what it claims, and
 *     it is the only one that refuses a run. The tolerance is asymmetric on purpose: width is
 *     within 10% on any correct run (browser chrome takes no width, and `--hide-scrollbars` takes
 *     the rest), while height loses the tab strip, the address bar and the title bar, which is
 *     130-plus CSS pixels on Firefox. A window that landed on a smaller display cannot pass the
 *     width test — the display it is on is too narrow to hold it — which is what makes this catch
 *     the wrong-display case without needing to identify the display.
 *   - **The display**, in device pixels — `screen * devicePixelRatio`. Reported, never refused: a
 *     1920x1080 window on a larger monitor is a legitimate measurement of a 1920x1080 window, and
 *     laptop panels that are 1920x**1200** are common enough that refusing on the display would
 *     brick the main run on hardware we cannot see. It exists so the owner can read placement off
 *     the output instead of doing arithmetic on a CSS-pixel line (which cannot be done: at the 150%
 *     scaling the 1440p leg prescribes, a correct 2560x1440 window reports ~1707x875 CSS).
 */
function checkResolution(requested, environment) {
  const [width, height] = requested.split('x').map(Number)
  const dpr = environment.devicePixelRatio || 1
  const device = {
    width: Math.round(environment.viewport.width * dpr),
    height: Math.round(environment.viewport.height * dpr),
  }
  const display = {
    width: Math.round(environment.screen.width * dpr),
    height: Math.round(environment.screen.height * dpr),
  }
  const widthRatio = Math.round((device.width / width) * 1000) / 1000
  const heightRatio = Math.round((device.height / height) * 1000) / 1000
  // The one thing the display *does* refuse: being shorter than the window asked for. The height
  // ratio has to tolerate 0.65 because browser chrome eats 130-plus CSS pixels, and that slack is
  // wide enough to swallow a whole missing display: a 1440p leg run on a 2560x1080 ultrawide fills
  // 2560x~1000, passes the width test outright, and lands at a height ratio of ~0.69 that is
  // indistinguishable from Firefox's title bar — 360 rows of the measurement simply absent, under
  // a green label. Refusing on 0.95 of the requested height closes that without touching the case
  // the display is deliberately *not* refused for: a 1920x1200 panel measuring a 1920x1080 window
  // (1200 >= 1026) still passes, which is why this is a height test and not `onRequestedDisplay`.
  const displayTallEnough = display.height >= height * 0.95
  const ok =
    widthRatio >= 0.9 && widthRatio <= 1.1 && heightRatio >= 0.65 && heightRatio <= 1.1 && displayTallEnough
  const onRequestedDisplay =
    Math.abs(display.width - width) <= width * 0.03 && Math.abs(display.height - height) <= height * 0.03
  return {
    requested,
    deviceViewport: device,
    display,
    widthRatio,
    heightRatio,
    displayTallEnough,
    ok,
    onRequestedDisplay,
    why: ok
      ? null
      : `asked for ${requested}, the window filled ${device.width}x${device.height} device px ` +
        `(${environment.viewport.width}x${environment.viewport.height} CSS @ dpr ${dpr}) ` +
        `on a ${display.width}x${display.height} display. ` +
        (displayTallEnough
          ? ''
          : `That display is only ${display.height} device px tall, so no window on it can measure ` +
            `${height}. `) +
        `Move the window to the ${requested} display, or — if this window IS the one you meant to ` +
        `measure — re-run with --resolutions ${display.width}x${display.height}`,
  }
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
      resolutionCheck: checkResolution(resolution, environment),
      // Whether the preload actually installed. Everything the probe provides — the allocation
      // rate, the shader timings, the GPU strings — is silently absent when it did not, and the
      // frame numbers are not, so an uninstrumented run looks like a thin but valid result. It is
      // the plausible failure for Firefox over BiDi, which no machine here has ever driven, and it
      // is why criterion 4 counts only instrumented runs: a "no console errors" vote from a browser
      // whose console may never have been observed is not evidence.
      instrumented: final !== null,
      bench: result.bench,
      gpu: final?.gpu ?? null,
      firstFrameMs: final?.firstFrameMs ?? null,
      firstDrawAtMs: final?.firstDrawAtMs ?? null,
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
    // The launch is inside the `try`, not before it. A browser that will not start — puppeteer
    // waits 30 s for the port, and a cold Iris Xe behind antivirus is where that happens — is a
    // failed self-check, recorded and returned like any other, rather than an exception thrown
    // past this function's caller with the whole battery's data still on the stack.
    let browserProcess
    try {
      browserProcess = await launch(browser, args, args.resolutions[0], false)
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
      // `?.` because the launch itself is now one of the things that can fail in here.
      await browserProcess?.close().catch(() => {})
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

  // Everything already collected travels with any error thrown out of here, so the outer handler
  // records it instead of replacing it with an empty array. Without this a failure at step 16 of 16
  // deletes the fifteen measurements that came before it from the file the owner sends back, and
  // the report reads `NOT RUN`, which is indistinguishable from a browser that never started.
  const abort = (error) => {
    error.partial = { runs, selfChecks }
    return error
  }

  // The whole body, so `abort` covers every throw site rather than the ones that happen to sit
  // inside a loop's own `try`. It previously did not: the browser was launched on the line *above*
  // the `try`, so a launch that timed out mid-battery threw straight past `abort`, and the outer
  // handler had no `error.partial` to keep — it filled in an empty array and the report said
  // `NOT RUN` for a browser that had just printed a dozen live measurements. One `try` around
  // everything means the claim "nothing measured is ever thrown away" needs no reader to check
  // which lines it holds for. `findBrowser` stays outside on purpose: a browser that is not
  // installed measured nothing, and `not run` is the honest word for it.
  try {
    for (const resolution of args.resolutions) {
      // vsync always; uncapped only where the browser can actually unlock the frame rate.
      const caps = args.quick || browser.family === 'firefox' ? [false] : [false, true]
      for (const uncapped of caps) {
        for (const tier of args.tiers) {
          const what = `${resolution} tier ${tier} (${TIER_LABELS[tier]}) ${uncapped ? 'uncapped' : 'vsync'}`
          process.stdout.write(`  bench ${what} ... `)
          let browserProcess
          try {
            browserProcess = await launch(browser, args, resolution, uncapped)
            const run = await benchRun(browserProcess, args, { resolution, tier, uncapped, cold })
            cold = false
            runs.push(run)
            const bench = run.bench
            const canvas = run.environment.drawingBuffer
            console.log(
              `${bench.fps} fps, p95 ${bench.frameMsP95} ms, ` +
                // Two different numbers, both wanted, and this line used to print the first under
                // the second's name: the viewport is CSS pixels, the drawing buffer is the device
                // pixels the GPU filled, and at tier 0 the app scales the buffer past dpr on top.
                `window ${bench.viewport.width}x${bench.viewport.height} CSS @ dpr ${bench.viewport.dpr}, ` +
                `canvas ${canvas ? `${canvas.width}x${canvas.height}` : 'unknown'} device px, ` +
                `alloc ${run.allocation.rate ? `${run.allocation.rate.estimatedMbPerS} MB/s` : 'n/a'}`,
            )
          } catch (error) {
            console.log(`FAILED: ${error.message.split('\n')[0]}`)
            runs.push({ resolution, tier, frameCap: uncapped ? 'uncapped' : 'vsync', error: error.message })
            // A run that failed *inside* a browser that works is one lost row and the battery goes
            // on — that is the common case and the default the owner should see. A browser that
            // would not start is a different fact about the machine: the next fifteen launches
            // will most likely spend 30 s each timing out the same way, so the battery ends here
            // and the truncation is reported. Either way the rows already collected are kept.
            if (args.failFast || !browserProcess) throw error
          } finally {
            // `?.` because the launch itself is now one of the things that can fail in here.
            await browserProcess?.close().catch(() => {})
          }
        }
      }
    }

    if (!args.quick) {
      for (const positions of [null, 'float32']) {
        const check = await selfCheckWithRetry(browser, args, positions)
        selfChecks.push(check)
        if (!check.error) continue
        if (args.failFast) throw new Error(check.error)
      }
    }
  } catch (error) {
    throw abort(error)
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
/** `--angle vulkan` asked for a backend; this is the backend the driver strings say it got. */
const ANGLE_BACKEND = { d3d11: /direct3d ?11|d3d11/i, vulkan: /vulkan/i }

function integrity(report) {
  const problems = []
  for (const engine of report.engines) {
    for (const run of engine.runs) {
      if (run.error) continue
      const renderer = run.gpu?.renderer ?? run.gpu?.glRenderer ?? ''
      if (SOFTWARE_RENDERER.test(renderer)) {
        problems.push(`${engine.browser} ${run.resolution} tier ${run.tier}: software rasteriser (${renderer})`)
      }
      // The resolution, read back off the window. `--resolutions` is a request; this is the result.
      if (run.resolutionCheck && !run.resolutionCheck.ok) {
        problems.push(
          `${engine.browser} tier ${run.tier} ${run.frameCap}: this row is labelled ` +
            `${run.resolution} but did not measure it — ${run.resolutionCheck.why}`,
        )
      }
      // `--angle` is a request too, and it is visible in the renderer string, so it is checkable.
      // An owner who gets "Direct3D11" back from `--angle vulkan` has two identical D3D11 runs
      // under two labels, and "the backends agree" would be the conclusion drawn from them.
      //
      // Chromium only, because `--use-angle` is Chromium only: `launchArgs` never passes it to
      // Firefox, so checking a Firefox renderer string against it refuses a run for not honouring
      // a flag it was never given — and the refusal exits 1 and voids a battery that measured
      // exactly what it claimed to.
      if (report.angle && renderer && BROWSERS[engine.browser]?.family !== 'firefox') {
        const expected = ANGLE_BACKEND[report.angle]
        if (expected && !expected.test(renderer)) {
          problems.push(
            `${engine.browser} ${run.resolution} tier ${run.tier}: --angle ${report.angle} did not ` +
              `take — the renderer string says "${renderer}"`,
          )
        }
      }
      // Same class again: `--power battery` is written into the filename and the report, and §9
      // wants both states. A second plugged run labelled `battery` makes "battery costs nothing on
      // this machine" unfalsifiable from the data that comes back. `charging` is null on engines
      // without the Battery Status API (Firefox), and null is never read as agreement.
      const charging = run.environment?.battery?.charging
      if (charging === true && report.power === 'battery') {
        problems.push(
          `${engine.browser} ${run.resolution} tier ${run.tier}: labelled --power battery, but the ` +
            `machine is plugged in and charging`,
        )
      }
      if (charging === false && report.power === 'plugged') {
        problems.push(
          `${engine.browser} ${run.resolution} tier ${run.tier}: labelled --power plugged, but the ` +
            `machine is on battery`,
        )
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
  // Only runs that measured what they claim feed a criterion. A run whose window was the wrong size
  // is excluded rather than counted, because the alternative is a green criterion sitting directly
  // above the line that says the run was refused.
  const at = (resolution, tier, cap) =>
    report.engines.flatMap((engine) =>
      engine.runs
        .filter(
          (run) =>
            !run.error &&
            run.resolution === resolution &&
            run.tier === tier &&
            run.frameCap === cap &&
            run.resolutionCheck?.ok !== false,
        )
        .map((run) => ({ engine: engine.browser, run })),
    )

  const p95 = at('1920x1080', 0, 'vsync')
  // §9's threshold is a vsync p95, and a vsync p95 is partly a statement about the panel: on a
  // 60 Hz display it sits at ~16.7 ms whether the frame cost 3 ms or 16, so an `ok` here is not
  // headroom and a 16.8 ms `FAIL` is not necessarily a GPU verdict. The refresh rate the run
  // actually saw and the uncapped p95 for the same tier are printed beside it so neither is read
  // that way. Both come from runs already in the report; nothing extra is measured.
  const refresh = p95
    .map(({ engine, run }) => `${engine} ~${Math.round(1000 / run.bench.frameMsP50)} Hz`)
    .join(', ')
  const uncapped = at('1920x1080', 0, 'uncapped')
    .map(({ engine, run }) => `${engine} ${run.bench.frameMsP95} ms`)
    .join(', ')
  rows.push({
    criterion: 'p95 frame interval <= 16.7 ms at tier 0, 1080p (vsync)',
    measured: p95.length
      ? p95.map(({ engine, run }) => `${engine} ${run.bench.frameMsP95} ms`).join(', ') +
        `\n         panel refresh, from the same runs: ${refresh}` +
        `\n         same tier uncapped p95 (the GPU number): ${uncapped || 'not run'}`
      : 'not run',
    pass: p95.length ? p95.every(({ run }) => run.bench.frameMsP95 <= 16.7) : null,
  })

  // Read as §9 writes it: the ladder should not have to drop *below* tier 1 to hold 60 fps. So
  // within one engine either tier 0 or tier 1 clearing 59 fps satisfies it — but the engines are
  // judged separately and all of them must satisfy it, which is what criterion 1 already does.
  // Pooling both tiers and all engines into one `.some()` meant a single fast row anywhere carried
  // the criterion for every browser, which on the 1440p leg is the review's headline claim decided
  // by whichever engine happened to be quickest.
  const wideEngines = report.engines
    .map((engine) => ({
      engine: engine.browser,
      runs: [...at('2560x1440', 0, 'vsync'), ...at('2560x1440', 1, 'vsync')].filter(
        (entry) => entry.engine === engine.browser,
      ),
    }))
    .filter((entry) => entry.runs.length > 0)
  rows.push({
    criterion: 'tier <= 1 holds 60 fps at 1440p (each engine, on its own)',
    measured: wideEngines.length
      ? wideEngines
          .map(({ engine, runs }) => {
            const held = runs.find(({ run }) => run.bench.fps >= 59)
            return (
              `${engine} ${runs.map(({ run }) => `t${run.tier} ${run.bench.fps} fps`).join(' / ')}` +
              ` -> ${held ? `ok (t${held.run.tier})` : 'FAIL'}`
            )
          })
          .join('; ')
      : 'not run (needs --resolutions 2560x1440 on the external monitor)',
    pass: wideEngines.length
      ? wideEngines.every(({ runs }) => runs.some(({ run }) => run.bench.fps >= 59))
      : null,
  })

  const checks = report.engines.flatMap((engine) =>
    engine.selfChecks.filter((check) => !check.error).map((check) => ({ engine: engine.browser, check })),
  )
  // A self-check that failed to run is not a tolerance failure and must not be counted as one — but
  // it must not disappear either. It is excluded from the verdict and named beside it, because
  // "zero tolerance failures" over one of the two modes is a narrower claim than the criterion
  // makes, and the difference is invisible unless the line says so.
  const notChecked = report.engines.flatMap((engine) =>
    engine.selfChecks
      .filter((check) => check.error)
      .map((check) => `${engine.browser} ${check.requestedPositions} did not run`),
  )
  rows.push({
    criterion: 'zero self-check tolerance failures (float16 and float32)',
    measured: checks.length
      ? [
          checks.map(({ engine, check }) => `${engine} ${check.positionMode} ${check.missed} missed`).join(', '),
          ...(notChecked.length > 0 ? [`not covered by this verdict: ${notChecked.join(', ')}`] : []),
        ].join('\n         ')
      : 'not run',
    pass: checks.length ? checks.every(({ check }) => check.ok && check.missed === 0) : null,
  })

  // Counted over the runs that actually happened, and `null` when none did: "no console errors
  // were seen" is not a pass when nothing was ever loaded. Uninstrumented runs are excluded for the
  // same reason one step further in — if the preload never installed, the console listener is the
  // one thing we cannot confirm was watching, and a silent vote from an unobserved console is
  // exactly the false green this criterion would produce on a Firefox run that half-worked.
  const completed = report.engines.flatMap((engine) =>
    engine.runs
      .filter((run) => !run.error && run.instrumented !== false)
      .map((run) => ({ engine: engine.browser, run })),
  )
  const skipped = report.engines.flatMap((engine) =>
    engine.runs.filter((run) => !run.error && run.instrumented === false),
  ).length
  const errors = completed.flatMap(({ engine, run }) =>
    run.console.consoleErrors.map((text) => `${engine}: ${text}`),
  )
  const notWatched = skipped > 0 ? ` (${skipped} uninstrumented run(s) not counted)` : ''
  rows.push({
    criterion: 'zero console errors under the production CSP',
    measured:
      completed.length === 0
        ? `not run${notWatched}`
        : errors.length === 0
          ? `none across ${completed.length} runs${notWatched}`
          : `${errors.length}: ${errors.slice(0, 3).join(' | ')}${notWatched}`,
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
  // Spelled out because the flag is Chromium-only and the label is global: without this line a
  // Firefox row in an `--angle vulkan` battery reads as a Vulkan measurement of Firefox.
  if (report.angle) lines.push(`--angle ${report.angle} requested (Chromium engines only; Firefox ignores it)`)
  lines.push('='.repeat(96))

  for (const engine of report.engines) {
    const measured = engine.runs.filter((run) => !run.error)
    if (engine.error && engine.runs.length === 0 && engine.selfChecks.length === 0) {
      lines.push(`\n${engine.browser}: NOT RUN — ${engine.error}`)
      continue
    }
    lines.push(`\n${engine.browser} — ${engine.label ?? '(did not start)'}`)
    if (engine.error) {
      // Not `NOT RUN`. The battery stopped early, and everything below this line is real data that
      // was collected before it did.
      lines.push(
        `  DID NOT FINISH — ${engine.error.split('\n')[0]}\n` +
          `  the ${measured.length} completed run(s) below are kept and are what this browser measured`,
      )
    }
    const first = measured[0]
    if (first) {
      lines.push(`  GPU        ${first.gpu?.renderer ?? first.gpu?.glRenderer ?? 'unknown'}`)
      // One block per requested resolution, not one for `measured[0]`. The placement question is
      // asked *per resolution* — run 3 of the procedure is the 1440p leg on a second display, and
      // it is the leg most likely to be measuring the wrong panel — so a header that described
      // only the first entry of `--resolutions 1920x1080,2560x1440` reported the window and the
      // display of the leg nobody was worried about, and said nothing at all about the other.
      for (const resolution of [...new Set(measured.map((run) => run.resolution))]) {
        const run = measured.find((entry) => entry.resolution === resolution)
        const check = run.resolutionCheck
        // The device-pixel numbers first, because they are the ones the owner is asked to judge and
        // the CSS line cannot be judged: at 150% scaling a correct 2560x1440 window reads 1707x875.
        lines.push(
          `  window     ${check.requested} asked, ` +
            `${check.deviceViewport.width}x${check.deviceViewport.height} device px measured ` +
            `(${run.environment.viewport.width}x${run.environment.viewport.height} CSS @ dpr ` +
            `${run.environment.devicePixelRatio})`,
        )
        lines.push(
          `  placement  on a ${check.display.width}x${check.display.height} display — ` +
            (check.onRequestedDisplay
              ? `the ${check.requested} display, as asked`
              : `NOT the ${check.requested} display you asked for`),
        )
        // The canvas's own backing store, which is the pixel count the GPU fills. It is not the
        // window: at tier 0 the app multiplies by its own pixel ratio on top of dpr (§3.2).
        if (run.environment.drawingBuffer) {
          lines.push(
            `  canvas     ${run.environment.drawingBuffer.width}x${run.environment.drawingBuffer.height} device px (drawing buffer at tier ${run.tier})`,
          )
        }
      }
      if (measured.some((run) => run.instrumented === false)) {
        lines.push(
          '  instrumentation: NOT INSTALLED on some runs — no allocation rate, no shader timing, ' +
            'no GPU strings, and their consoles are not counted by criterion 4',
        )
      }
      lines.push(`  parallel shader compile: ${first.parallelShaderCompile === null ? 'unknown' : first.parallelShaderCompile}`)
    }
    lines.push('  res         tier         cap        fps   p50    p95    max   cpu95   canvas px         alloc MB/s')
    for (const run of engine.runs) {
      if (run.error) {
        lines.push(`  ${run.resolution.padEnd(11)} tier ${run.tier}       ${String(run.frameCap).padEnd(9)}  FAILED`)
        continue
      }
      const bench = run.bench
      const canvas = run.environment.drawingBuffer
      lines.push(
        `  ${run.resolution.padEnd(11)} ${`${run.tier} ${run.tierLabel}`.padEnd(12)} ${run.frameCap.padEnd(9)} ` +
          `${String(bench.fps).padStart(5)} ${String(bench.frameMsP50).padStart(5)} ` +
          `${String(bench.frameMsP95).padStart(6)} ${String(bench.frameMsMax).padStart(6)} ` +
          `${String(bench.cpuMsP95).padStart(7)}   ` +
          `${(canvas ? `${canvas.width}x${canvas.height}` : 'unknown').padEnd(17)} ` +
          `${run.allocation.rate ? String(run.allocation.rate.estimatedMbPerS).padStart(10) : '       n/a'}` +
          `${run.resolutionCheck?.ok === false ? '   <- NOT THE RESOLUTION IT CLAIMS' : ''}`,
      )
    }
    const firstFrames = measured
      .filter((run) => run.firstFrameMs !== null)
      .map((run) => `t${run.tier} ${run.frameCap} ${run.firstFrameMs} ms`)
    if (firstFrames.length > 0) {
      lines.push(
        `\n  time to first frame (§9), from navigation to the frame presenting the first draw call:\n` +
          `    ${firstFrames.join(', ')}`,
      )
    }

    const shaders = engine.runs.find((run) => run.shaders)?.shaders
    if (shaders) {
      lines.push(
        `\n  shader programs (cold profile): ${shaders.linkProgramCalls} linkProgram calls, ` +
          `${shaders.syncMsTotal} ms total in synchronous link-status reads`,
      )
      lines.push('    id  source hash        name                            link ms   sync ms   first draw ms')
      for (const program of shaders.each) {
        lines.push(
          `    ${String(program.id).padStart(2)}  ${String(program.sourceHash).padEnd(18)} ` +
            `${String(program.name ?? '(unnamed)').padEnd(30)} ` +
            `${String(program.linkMs ?? '-').padStart(8)}  ${String(program.syncMs ?? '-').padStart(8)}  ` +
            `${String(program.firstDrawMs ?? '-').padStart(13)}`,
        )
      }
      // `id` is assignment order, and the order is not stable — the same page has linked 14
      // programs on one run and 18 on another. `source hash` is: it is the content of the vertex
      // and fragment source, which comes from the same bundle everywhere. A slow program in the
      // JSON that comes back from a Windows laptop is identified by that column and nothing else,
      // which is what lets the material-naming follow-up be applied to data already collected
      // instead of needing the laptops again.
      lines.push(
        '    (`(unnamed)` is a raw ShaderMaterial, which three.js gives no SHADER_NAME. Quote the ' +
          'source hash, not the id.)',
      )
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

  if (report.incomplete.length > 0) {
    lines.push(`\n${'-'.repeat(96)}\nTHESE BROWSERS DID NOT PRODUCE THE WHOLE BATTERY\n${'-'.repeat(96)}`)
    for (const entry of report.incomplete) lines.push(`  - ${entry}`)
    lines.push(
      '  Everything they had already measured is in this report and in the JSON. Send it anyway —\n' +
        '  the missing rows are the only thing missing.',
    )
  }

  lines.push(
    '\n§9 also asks for a 10 s performance trace, to tell a GPU-bound frame from a JS-bound one.\n' +
      'This kit does not collect one, deliberately: `cpu95` in the table above is the same question\n' +
      'answered directly and per segment, with no trace file for anyone to interpret.\n' +
      '\nStill to paste in by hand (§9): chrome://gpu and about:support, and a repeat of the whole ' +
      'run on battery.\n',
  )
  return lines.join('\n')
}

// -------------------------------------------------------------------------------------------------
// The run.
// -------------------------------------------------------------------------------------------------
// A bad argument is a message to the owner, not a stack trace. Every throw in `parseArgs` names
// what to do instead, and the whole point of the Firefox/`--window-position` refusal below is that
// somebody following an older copy of the procedure reads it and fixes the command.
let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(`\n${error.message}\n\nRun with --help for the options, and read PROCEDURE.md.\n`)
  process.exit(2)
}

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
      // Never fatal. A browser that is not installed, or that this kit cannot drive — Firefox over
      // WebDriver BiDi is the likeliest, and is the case `PROCEDURE.md` gives a by-hand path for —
      // is an expected condition on the owner's machine, not a reason to throw away the browsers
      // that did run.
      //
      // `error.partial` carries whatever that browser had already measured (see `abort`). It is
      // kept, never replaced by an empty array: those runs happened, they printed live to the
      // owner's console, and a file that omits them while saying `NOT RUN` is a report of a
      // measurement that was made and then deleted.
      const partial = error.partial ?? { runs: [], selfChecks: [] }
      const started = partial.runs.length > 0 || partial.selfChecks.length > 0
      const measured = partial.runs.filter((run) => !run.error).length
      console.log(
        `\n${name}: ${started ? 'did not finish' : 'not run'} — ${error.message.split('\n')[0]}` +
          (measured > 0 ? `\n    keeping the ${measured} completed run(s)` : ''),
      )
      report.engines.push({
        browser: name,
        label: BROWSERS[name]?.label ?? null,
        error: error.message,
        ...partial,
      })
    }
  }
} finally {
  if (preview) preview.child.kill('SIGTERM')
}

report.integrity = integrity(report)
// A browser that produced less than the battery asked for. It is separate from `integrity`: the
// data that survives is trustworthy, there is just less of it, and the two must not be reported as
// the same kind of problem.
report.incomplete = report.engines.flatMap((engine) => {
  const completed = engine.runs.filter((run) => !run.error).length
  if (engine.error && (engine.runs.length > 0 || engine.selfChecks.length > 0)) {
    return [
      `${engine.browser}: stopped after ${completed} of the battery's runs — ` +
        `${engine.error.split('\n')[0]}`,
    ]
  }
  // A battery that ran to the end and measured nothing. It reaches here with no `engine.error` at
  // all — every run failed on its own and the loop kept going, which is the right thing to do and
  // was reported by a silent exit 0 until now. Every row printing `FAILED` is not a result, and
  // the exit code is the only part of this output a script or a tired owner reads.
  if (engine.runs.length > 0 && completed === 0) {
    return [
      `${engine.browser}: all ${engine.runs.length} of the battery's runs failed — ` +
        `${engine.runs[0].error.split('\n')[0]}`,
    ]
  }
  return []
})
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

// Exit non-zero when the evidence is not what it says it is, or when there is less of it than was
// asked for. A failed §9 criterion is the finding this kit exists to produce, not an error — but a
// truncated battery is not a result either, and it must never be reported by a silent exit 0.
if (report.integrity.length > 0) {
  console.error('\nrefusing: the runs above did not measure what they claim')
  process.exit(1)
}
if (report.incomplete.length > 0) {
  console.error(
    '\nincomplete: the browsers above did not produce the whole battery. Whatever they did ' +
      'measure is kept.',
  )
  process.exit(2)
}
