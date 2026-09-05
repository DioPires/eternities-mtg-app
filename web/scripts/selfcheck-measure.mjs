/**
 * DEC-634 measurement harness: run the self-check on a real GPU and dump its raw per-row tallies.
 *
 * `verify-browser.mjs` renders a verdict; this prints the numbers the verdict is tuned from — the
 * per-row `(sampled, dark, unexplained)` tallies — as JSON, so `DARK_ROW_MIN_SAMPLES` and
 * `DARK_ROW_RATE` can be re-derived from measurement rather than ported across a change of sampler.
 * Committed for the same reason `selfcheck-ladder.sh` is: those constants are stated in
 * `selfCheck.ts` as measured, and this is what measures them.
 *
 *   node scripts/selfcheck-measure.mjs [--dataset small|scale|production]
 *                                      [--perrow N] [--repeat N] [--build]
 *
 * `--perrow` overrides `SAMPLES_PER_ROW` through `?perrow=N`, so a budget sweep costs one build
 * rather than one per value. `--repeat` reloads the page N times and emits an array; the rate a row
 * settles at across runs is the number the threshold has to clear, and one run does not show it.
 * `--build` rebuilds against the dataset first; without it the existing `dist/` is served, which is
 * what you want when sweeping a constant that lives in the bundle you just built.
 *
 * Stdout is the JSON and nothing else — the build's chatter goes to stderr — so `> run.json` parses.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = { dataset: 'scale', build: false, perRow: null, repeat: 1 }
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--dataset') args.dataset = process.argv[++i]
  else if (process.argv[i] === '--build') args.build = true
  else if (process.argv[i] === '--perrow') args.perRow = Number(process.argv[++i])
  else if (process.argv[i] === '--repeat') args.repeat = Number(process.argv[++i])
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean)
  for (const path of candidates) if (existsSync(path)) return path
  throw new Error('no Chrome found; set CHROME_PATH')
}

function run(command, argv, env) {
  return new Promise((ok, fail) => {
    // The build's own chatter goes to stderr (fd 2), not stdout: this script's stdout is the JSON
    // result and nothing else, so `> run.json` is parseable without slicing the build log off it.
    const child = spawn(command, argv, {
      cwd: WEB_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 2, 'inherit'],
    })
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${command} exited ${code}`))))
  })
}

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30_000)
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

if (args.build) await run('pnpm', ['build'], { ETERNITIES_DATASET: args.dataset })

const { child, url } = await startPreview(args.dataset)
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
// `?perrow=N` overrides the built-in budget without a rebuild; see `samplesPerRowRequested`.
const query = `?selfcheck=1${args.perRow ? `&perrow=${args.perRow}` : ''}`
const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
const runs = []
try {
  for (let attempt = 0; attempt < args.repeat; attempt += 1) {
    // A fresh page per repeat. The check runs once per page load, so repeats have to reload, and
    // reusing one page would just re-read the first run's `window.__eternitiesSelfCheck`.
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
    await page.goto(`${url}/${query}`, { waitUntil: 'load', timeout: 60_000 })
    const started = Date.now()
    await page.waitForFunction(() => window.__eternitiesSelfCheck !== undefined, {
      timeout: 600_000,
      polling: 500,
    })
    const result = await page.evaluate(() => window.__eternitiesSelfCheck)
    runs.push({
      dataset: args.dataset,
      hash: registry.fixtures?.[args.dataset] ?? registry[args.dataset] ?? args.dataset,
      perRow: args.perRow,
      attempt,
      wallClockMs: Date.now() - started,
      ...result,
      missed: result.missed.slice(0, 12),
    })
    await page.close()
  }
  console.log(JSON.stringify(args.repeat === 1 ? runs[0] : runs, null, 1))
} finally {
  await browser.close()
  child.kill('SIGTERM')
}
