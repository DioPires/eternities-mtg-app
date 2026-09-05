#!/usr/bin/env node
/**
 * The local bench protocol of implementation-plan §6 and PRD 9.1.2.
 *
 * Builds the site against a fixture, serves it through `vite preview`, drives a real Chrome on
 * this machine along the scripted camera path of `src/bench/benchPath.ts`, and prints the JSON
 * summary the page computed.
 *
 * Headed by default, because that is the protocol: §6 fixes the reference machine as the
 * development machine and the bench as headed Chrome on it. Headless is available with
 * `--headless` for a smoke run, and the result records the GPU string either way — a number
 * produced by SwiftShader is not a bench result, and the report says which one it was.
 *
 *   node scripts/bench.mjs [--dataset scale|small] [--positions float16|float32]
 *                          [--headless] [--uncapped] [--out path.json] [--runs N]
 *                          [--shots dir] [--device-scale N]
 *
 * `--uncapped` unlocks the frame rate, which is the only way to see how much headroom is actually
 * left: with vsync on, a 120 Hz panel reports 8.3 ms whether the frame cost 2 ms or 8.
 * `--shots` parks the camera at the end of each path segment and photographs it, which is what the
 * visual checks of PRD 9.3 need — a reproducible frame rather than a screenshot of the fly-by.
 *
 * Exit code is non-zero when the run misses PRD 7.2's 50 fps ceiling, so this can gate a PR that
 * touches rendering.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error(`no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  return found
}

function parseArgs(argv) {
  const args = {
    dataset: 'scale',
    positions: null,
    headless: false,
    uncapped: false,
    out: null,
    shots: null,
    runs: 1,
    // 2, so the page sees `devicePixelRatio` 2 and the tier-0 cap of 1.5 actually binds — which
    // is what the Retina reference machine of implementation-plan §6 does. `--device-scale 1`
    // reproduces a non-Retina display, and the degradation ladder's top rung with it.
    deviceScaleFactor: 2,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--positions') args.positions = argv[++i]
    else if (argv[i] === '--headless') args.headless = true
    else if (argv[i] === '--uncapped') args.uncapped = true
    else if (argv[i] === '--out') args.out = argv[++i]
    else if (argv[i] === '--shots') args.shots = argv[++i]
    else if (argv[i] === '--runs') args.runs = Number(argv[++i])
    else if (argv[i] === '--device-scale') args.deviceScaleFactor = Number(argv[++i])
    else throw new Error(`unknown argument ${argv[i]}`)
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

function launch(args) {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: args.headless,
    // A fixed window, so the numbers are comparable between runs and machines. The reference
    // viewport of PRD 7.1.1 is 1920x1080.
    //
    // `deviceScaleFactor` is not optional here. Without it puppeteer pins `devicePixelRatio` to 1,
    // so `setDpr(min(1.5, 1))` yields 1 and the bench measures a quarter fewer fragments than the
    // Retina reference machine actually draws — and the first rung of the degradation ladder
    // (1.5 -> 1.0) cannot be exercised at all, because the run never starts above it.
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: args.deviceScaleFactor },
    args: [
      '--no-sandbox',
      '--window-size=1920,1140',
      '--hide-scrollbars',
      // Ask for the real GPU explicitly; a SwiftShader run is not a bench.
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      ...(args.uncapped
        ? ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-features=CalculateNativeWinOcclusion']
        : []),
      ...(args.headless ? ['--use-angle=metal', '--enable-unsafe-swiftshader'] : []),
    ],
  })
}

async function runOnce(url, args, run) {
  const browser = await launch(args)

  const problems = []
  try {
    const page = await browser.newPage()
    page.on('console', (message) => {
      const text = message.text()
      if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
        problems.push(`console error: ${text}`)
      }
    })
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))

    const query = new URLSearchParams({ bench: '1' })
    if (args.positions) query.set('positions', args.positions)
    await page.goto(`${url}/?${query.toString()}`, { waitUntil: 'load', timeout: 60_000 })

    // The path is 39 s plus the load and the warm-up; give it generous headroom.
    await page.waitForFunction(() => window.__eternitiesBench !== undefined, {
      timeout: 180_000,
      polling: 500,
    })
    const result = await page.evaluate(() => window.__eternitiesBench)
    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n  - ${problems.join('\n  - ')}`)
    }
    return { run, headless: args.headless, uncapped: args.uncapped, ...result }
  } finally {
    await browser.close()
  }
}

/**
 * One photograph per path segment, with the camera parked at the segment's end. Not a bench: the
 * page records nothing in this mode, and the shots are taken with the field still moving.
 */
async function captureShots(url, args, segments, directory) {
  const browser = await launch({ ...args, uncapped: false })
  try {
    const page = await browser.newPage()
    mkdirSync(resolve(WEB_ROOT, directory), { recursive: true })
    for (const segment of segments) {
      const query = new URLSearchParams({ hold: segment })
      if (args.positions) query.set('positions', args.positions)
      await page.goto(`${url}/?${query.toString()}`, { waitUntil: 'load', timeout: 60_000 })
      // `__eternitiesHold` says the page established the segment's focus; `__eternitiesHoldError`
      // says it gave up trying (DEC-667 B1). Photographing on mount is what produced an
      // empty-multiverse `card` shot, and failing here is the alternative to a plausible-looking
      // wrong picture.
      //
      // For `card` this is a genuine readiness gate — its focus cannot succeed until the anchor
      // plane's shards arrive, so the wait is real. For every other segment the focus cannot fail,
      // the flag arrives on the first frame, and the fixed settle below is what actually gives the
      // contents time to appear (DEC-677 N2). A `sheet` shot's thumbnails depend on that sleep, not
      // on this wait.
      await page.waitForFunction(
        () => window.__eternitiesHold !== undefined || window.__eternitiesHoldError !== undefined,
        { timeout: 120_000, polling: 250 },
      )
      const error = await page.evaluate(() => window.__eternitiesHoldError)
      if (error) throw new Error(`shot ${segment}: ${error}`)
      // Let every plane finish its fade-in (PRD 6.8.1) before photographing it.
      await new Promise((done) => setTimeout(done, 2000))
      const path = resolve(WEB_ROOT, directory, `${segment}.png`)
      await page.screenshot({ path })
      console.log(`  shot ${segment} -> ${path}`)
    }
  } finally {
    await browser.close()
  }
}

function report(result) {
  const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`)
  console.log(`\n=== bench: ${result.dataset}, ${result.stars} stars, ${result.planes} planes ===`)
  line('renderer', result.renderer)
  line('mode', result.headless ? 'headless' : 'headed')
  line('viewport', `${result.viewport.width}x${result.viewport.height} @ dpr ${result.viewport.dpr}`)
  line('positions', result.positionMode)
  line('frames', `${result.frames} over ${result.durationS}s`)
  line('fps', result.fps)
  line('frame ms p50 / p95 / max', `${result.frameMsP50} / ${result.frameMsP95} / ${result.frameMsMax}`)
  line('cpu ms p50 / p95', `${result.cpuMsP50} / ${result.cpuMsP95}`)
  line('quality tier', `${result.qualityTier} (${result.qualityChanges} changes)`)
  line('anchor plane', result.anchorPlane)
  if (result.saturated) line('WARNING', 'sample buffer filled; the tail of the path is missing')
  if (result.undrivenSegments?.length) {
    line('WARNING', `segments measured without their contents: ${result.undrivenSegments.join(', ')}`)
  }
  console.log('\n  segment        frames    fps   p50    p95    max   cpu p95')
  for (const segment of result.segments) {
    console.log(
      `  ${segment.segment.padEnd(13)} ${String(segment.frames).padStart(6)} ` +
        `${String(segment.fps).padStart(6)} ${String(segment.frameMsP50).padStart(5)} ` +
        `${String(segment.frameMsP95).padStart(6)} ${String(segment.frameMsMax).padStart(6)} ` +
        `${String(segment.cpuMsP95).padStart(9)}`,
    )
  }
  console.log(
    `\n  PRD 7.2: target (60 fps, p95 <= 16.7 ms) ${result.meetsTarget ? 'MET' : 'missed'}; ` +
      `ceiling (50 fps, p95 <= 33 ms) ${result.meetsCeiling ? 'MET' : 'MISSED'}`,
  )
}

const args = parseArgs(process.argv.slice(2))

execFileSync('pnpm', ['build'], {
  cwd: WEB_ROOT,
  env: { ...process.env, ETERNITIES_DATASET: args.dataset },
  stdio: 'inherit',
})

const { child, url } = await startPreview(args.dataset)
const results = []
try {
  for (let run = 1; run <= args.runs; run += 1) {
    results.push(await runOnce(url, args, run))
  }
  if (args.shots) {
    console.log('\ncapturing segment shots')
    await captureShots(url, args, results[0].segments.map((segment) => segment.segment), args.shots)
  }
} finally {
  child.kill('SIGTERM')
}

for (const result of results) report(result)

if (args.out) {
  const path = resolve(WEB_ROOT, args.out)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`)
  console.log(`\nwrote ${path}`)
}

// Before the thresholds, because a run whose `card` segment measured an empty sky can pass them
// comfortably and is not a baseline (DEC-667 N8). Reported after `--out` is written, so the
// evidence survives the failure.
const undriven = results.flatMap((result) => result.undrivenSegments ?? [])
if (undriven.length > 0) {
  console.error(
    `\nbench refused: ${[...new Set(undriven)].join(', ')} did not reach the scene state the ` +
      'segment is named after, so these numbers are not the product’s',
  )
  process.exit(1)
}

if (!results.every((result) => result.meetsCeiling)) {
  console.error('\nbench missed the PRD 7.2 ceiling')
  process.exit(1)
}
