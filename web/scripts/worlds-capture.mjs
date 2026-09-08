#!/usr/bin/env node
/**
 * Captures the concept B prototype's named views for the W2.3 decision gate (DEC-694).
 *
 * The frames are `page.screenshot()` at **dpr 1**, so a capture's PNG pixel dimensions are its CSS
 * pixel dimensions and the owner is judging what the browser actually drew at 100%. DEC-683 is the
 * reason: a judgement made on an upscaled crop is a judgement about the upscaler. The default
 * viewport is 1920×1080, which is the native resolution of the Iris Xe laptop the review's §9
 * protocol targets, so a Mac capture and a later Windows re-capture are directly comparable.
 *
 * Art is streamed from Scryfall's CDN, so each view is held until the art pool goes quiet — no
 * fetches in flight and no new completions for a few consecutive samples — before the shutter.
 * A view whose demand exceeds the pool never fully settles; that case times out, and the deadline
 * plus the pool numbers are written into the JSON beside the frame rather than hidden.
 *
 *   node scripts/worlds-capture.mjs [--out DIR] [--views a,b,c] [--width N] [--height N]
 *                                   [--dpr N] [--layers N] [--artpx N] [--no-hud] [--port N]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

/** Every view the prototype defines, in the order the evidence comment reads them. */
const DEFAULT_VIEWS = [
  'system',
  'dominaria-far',
  'dominaria-frame',
  'dominaria-near',
  'dominaria-terminator',
  'rabiah',
  'rabiah-near',
  'tether-far',
  'tether-surface',
]

/** How long a single view may spend waiting for art before the shutter fires anyway. */
const SETTLE_TIMEOUT_MS = 45_000

/** Consecutive quiet samples (no in-flight fetches, no new completions) that count as settled. */
const QUIET_SAMPLES = 4
const SAMPLE_INTERVAL_MS = 250

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error(`no Chrome found; set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
}

function parseArgs(argv) {
  const args = {
    out: resolve(WEB_ROOT, '../review/dec694-worlds'),
    views: DEFAULT_VIEWS,
    width: 1920,
    height: 1080,
    dpr: 1,
    layers: 1024,
    artpx: 24,
    hud: true,
    port: 5199,
    extra: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    const takesValue = flag !== '--no-hud'
    if (flag === '--out') args.out = resolve(value)
    else if (flag === '--views') args.views = value.split(',').filter(Boolean)
    else if (flag === '--width') args.width = Number(value)
    else if (flag === '--height') args.height = Number(value)
    else if (flag === '--dpr') args.dpr = Number(value)
    else if (flag === '--layers') args.layers = Number(value)
    else if (flag === '--artpx') args.artpx = Number(value)
    else if (flag === '--port') args.port = Number(value)
    else if (flag === '--query') args.extra = value
    else if (flag === '--no-hud') args.hud = false
    else throw new Error(`unknown flag ${flag}`)
    if (takesValue) i += 1
  }
  return args
}

/**
 * The prototype runs under `vite dev` and not `vite preview`, because it is not in the production
 * build: `rollupOptions.input` is `index.html` alone, and adding a second entry to ship a
 * throwaway route would put it in the deploy and in the §8 budget. Dev serves the same security
 * headers (`vite.config.ts`'s `localSecurityHeaders`), so the CSP the art fetches run under is the
 * production one plus Vite's own two allowances.
 */
async function startDev(port) {
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: WEB_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = `http://localhost:${port}`
  const ready = await new Promise((done) => {
    const timer = setTimeout(() => done(false), 30_000)
    const watch = (chunk) => {
      if (String(chunk).includes('ready in')) {
        clearTimeout(timer)
        done(true)
      }
    }
    child.stdout.on('data', watch)
    child.stderr.on('data', watch)
  })
  if (!ready) {
    child.kill('SIGTERM')
    throw new Error('vite dev did not come up in 30 s')
  }
  return { url, stop: () => child.kill('SIGTERM') }
}

async function settle(page, deadlineMs) {
  const started = Date.now()
  let quiet = 0
  let lastCompleted = -1
  let state = null
  while (Date.now() - started < deadlineMs) {
    await new Promise((done) => setTimeout(done, SAMPLE_INTERVAL_MS))
    state = await page.evaluate(() => window.__worlds.state())
    const idle = state.art.inFlight === 0 && state.art.completed === lastCompleted
    quiet = idle ? quiet + 1 : 0
    lastCompleted = state.art.completed
    if (quiet >= QUIET_SAMPLES) return { state, settled: true, waitedMs: Date.now() - started }
  }
  return { state, settled: false, waitedMs: Date.now() - started }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(args.out, { recursive: true })

  const { url, stop } = await startDev(args.port)
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--use-angle=metal',
      '--enable-unsafe-swiftshader',
      `--window-size=${args.width},${args.height}`,
    ],
  })

  const notes = []
  const captures = []
  try {
    const page = await browser.newPage()
    await page.setViewport({
      width: args.width,
      height: args.height,
      deviceScaleFactor: args.dpr,
    })
    page.on('console', (message) => {
      if (message.type() === 'error') notes.push(`console: ${message.text().slice(0, 240)}`)
    })
    page.on('pageerror', (error) => notes.push(`pageerror: ${String(error).slice(0, 240)}`))

    const query = [
      `view=${args.views[0]}`,
      `dpr=${args.dpr}`,
      `layers=${args.layers}`,
      `artpx=${args.artpx}`,
      args.hud ? null : 'hud=0',
      args.extra === '' ? null : args.extra,
    ]
      .filter(Boolean)
      .join('&')
    const entry = `${url}/prototypes/worlds/?${query}`
    console.log(`→ ${entry}`)
    await page.goto(entry, { waitUntil: 'load', timeout: 120_000 })
    await page.waitForFunction(() => window.__worlds !== undefined, { timeout: 180_000 })

    const boot = await page.evaluate(() => window.__worlds.state())
    console.log(
      `  booted: Dominaria r=${boot.radii.dominaria.toFixed(2)} ${boot.dominaria.cells} cells, ` +
        `Rabiah r=${boot.radii.rabiah.toFixed(2)} ${boot.rabiah.cells} cells`,
    )

    for (const view of args.views) {
      await page.evaluate((name) => window.__worlds.view(name), view)
      const { state, settled, waitedMs } = await settle(page, SETTLE_TIMEOUT_MS)
      const file = resolve(args.out, `${view}.png`)
      await page.screenshot({ path: file, captureBeyondViewport: false })
      captures.push({
        view,
        file: `${view}.png`,
        settled,
        waitedMs,
        caption: state.caption,
        cssViewport: `${state.viewport.cssWidth}×${state.viewport.cssHeight}`,
        dpr: state.viewport.dpr,
        pngPixels: `${Math.round(state.viewport.cssWidth * state.viewport.dpr)}×${Math.round(state.viewport.cssHeight * state.viewport.dpr)}`,
        cameraDistance: Number(state.hud.distance.toFixed(2)),
        cameraRadii: Number(state.hud.cameraDistanceRadii.toFixed(3)),
        cellCssPixels: Number(state.hud.cellPixels.toFixed(1)),
        art: state.art,
        cells: { dominaria: state.dominaria, rabiah: state.rabiah },
      })
      console.log(
        `  ${view.padEnd(22)} ${settled ? 'settled' : 'TIMED OUT'} in ${(waitedMs / 1000).toFixed(1)} s · ` +
          `cell ${state.hud.cellPixels.toFixed(1)} css px · ` +
          `art ${state.dominaria.drawn + state.rabiah.drawn} showing / ${state.art.resident} resident`,
      )
    }

    const report = {
      tool: 'scripts/worlds-capture.mjs',
      note: 'Concept B prototype captures for DEC-694 / review §4.2. dpr is stated per capture; every PNG is at true CSS scale.',
      viewport: { width: args.width, height: args.height, dpr: args.dpr },
      artThresholdCssPx: args.artpx,
      artPoolLayers: args.layers,
      layout: (await page.evaluate(() => window.__worlds.state())).layout,
      system: (await page.evaluate(() => window.__worlds.state())).system,
      captures,
      notes,
    }
    writeFileSync(resolve(args.out, 'captures.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nwrote ${captures.length} frames + captures.json to ${args.out}`)
    if (notes.length > 0) console.log(`notes:\n  ${notes.join('\n  ')}`)
  } finally {
    await browser.close()
    stop()
  }
}

await main()
