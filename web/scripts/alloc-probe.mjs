/**
 * Count GPU texture allocations per second at steady state, for DEC-692 R1's evidence.
 *
 * The review measured the shipped app at ~42 `createTexture` per second and ~308 MB/s of render
 * targets, in every phase, for the whole session (§2.1, §2.2). That is one `SelectiveBloomEffect`
 * rebuilt twice a second and never disposed. This is the instrument that reads it back, so the fix
 * is measured the same way the defect was.
 *
 *   node scripts/alloc-probe.mjs --url http://127.0.0.1:4173 --seconds 20 --out /tmp/run
 *
 * How it counts. `WebGL2RenderingContext.prototype` is wrapped through `evaluateOnNewDocument`, so
 * the hooks are installed before the app's first line: `createTexture`/`deleteTexture` for the
 * count, and `texImage2D`/`texStorage2D` for the bytes, sized from the arguments and the format.
 * Bytes are what matters — a 2880×1620 RGBA16F target is 37 MB and a 12×7 mip is nothing.
 *
 * `?probe=shell` gives `window.__eternitiesProbe`, whose `state()` reports the drawing buffer and
 * both bloom resolutions and whose `focusPlane`/`focusCard` drive the tour. The count is taken per
 * *phase*, after the phase has settled, because an allocation burst on entering a level is a real
 * cost that happens once and the defect being measured is the one that never stops.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { argv, exit } from 'node:process'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const URL_BASE = arg('url', 'http://127.0.0.1:4173')
const SECONDS = Number(arg('seconds', '20'))
const OUT = arg('out', null)
const LABEL = arg('label', 'run')

/**
 * Installed before any app code. Counts into `window.__alloc`, which the driver samples.
 *
 * Sizing a `texImage2D` needs the format and type; the table covers what this app uses (RGBA16F
 * and RGBA8 targets, RGB8/RGBA8 atlas pages, RGBA32F for the plane table) and falls back to 4
 * bytes per pixel, which under-counts float targets rather than inflating the result.
 */
const HOOKS = `
(() => {
  const state = { created: 0, deleted: 0, bytes: 0, uploads: 0 }
  window.__alloc = state
  const BYTES = {
    32856: 4, 32849: 4, 6408: 4, 6407: 3, 34842: 8, 34843: 6, 34836: 16, 34837: 12,
    33189: 2, 35056: 4, 36012: 4, 36208: 4, 36013: 4,
  }
  const size = (internalFormat, width, height) => {
    const per = BYTES[internalFormat] ?? 4
    return (width | 0) * (height | 0) * per
  }
  const patch = (proto) => {
    if (!proto || proto.__allocPatched) return
    proto.__allocPatched = true
    const create = proto.createTexture
    proto.createTexture = function () { state.created += 1; return create.apply(this, arguments) }
    const remove = proto.deleteTexture
    proto.deleteTexture = function () { state.deleted += 1; return remove.apply(this, arguments) }
    const storage = proto.texStorage2D
    if (storage) {
      proto.texStorage2D = function (target, levels, internalFormat, width, height) {
        state.uploads += 1
        state.bytes += size(internalFormat, width, height)
        return storage.apply(this, arguments)
      }
    }
    const image = proto.texImage2D
    proto.texImage2D = function (target, level, internalFormat, width, height) {
      // The 6-argument DOM-source overload has no width/height; those are atlas uploads, not
      // render targets, and they are counted by \`uploads\` without bytes.
      state.uploads += 1
      if (typeof width === 'number' && typeof height === 'number') {
        state.bytes += size(internalFormat, width, height)
      }
      return image.apply(this, arguments)
    }
  }
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype)
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype)
})()
`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readAlloc(page) {
  return page.evaluate(() => ({ ...window.__alloc }))
}

async function measure(page, name, seconds) {
  // Settle first: entering a level legitimately allocates once (a shard's thumbnails, a card's
  // textures). What is being measured is the steady state after that.
  await sleep(2500)
  const before = await readAlloc(page)
  const t0 = Date.now()
  await sleep(seconds * 1000)
  const after = await readAlloc(page)
  const elapsed = (Date.now() - t0) / 1000
  const state = await page.evaluate(() => window.__eternitiesProbe.state())
  return {
    phase: name,
    seconds: Number(elapsed.toFixed(2)),
    createdPerSecond: Number(((after.created - before.created) / elapsed).toFixed(2)),
    deletedPerSecond: Number(((after.deleted - before.deleted) / elapsed).toFixed(2)),
    uploadsPerSecond: Number(((after.uploads - before.uploads) / elapsed).toFixed(2)),
    megabytesPerSecond: Number(
      ((after.bytes - before.bytes) / elapsed / (1024 * 1024)).toFixed(3),
    ),
    drawingBuffer: state.quality.drawingBuffer,
    pixelRatio: state.quality.pixelRatio,
    bloomRequested: state.quality.bloom,
    bloomBlurChain: state.quality.bloomBlur,
    tier: state.quality.tier,
    level: state.level,
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--window-size=1920,1140', '--use-angle=metal', '--hide-scrollbars'],
})

try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(HOOKS)
  await page.goto(`${URL_BASE}/?probe=shell&motion=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => typeof window.__eternitiesProbe !== 'undefined' && window.__eternitiesProbe.state().level !== 'none',
    { timeout: 120_000, polling: 250 },
  )
  // Let the intro finish and the field complete before anything is claimed about steady state.
  await sleep(8000)

  const phases = []
  phases.push(await measure(page, 'multiverse', SECONDS))

  const planes = await page.evaluate(() => window.__eternitiesProbe.planes())
  const biggest = planes[0]
  await page.evaluate((slug) => window.__eternitiesProbe.focusPlane(slug), biggest.slug)
  phases.push(await measure(page, `plane:${biggest.slug}`, SECONDS))

  await page.evaluate(() => window.__eternitiesProbe.focusCard({}))
  phases.push(await measure(page, 'card', SECONDS))

  const report = { label: LABEL, url: URL_BASE, phases }
  console.log(JSON.stringify(report, null, 2))
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(`${OUT}/${LABEL}.json`, `${JSON.stringify(report, null, 2)}\n`)
    await page.screenshot({ path: `${OUT}/${LABEL}.png` })
  }
} catch (error) {
  console.error(error)
  exit(1)
} finally {
  await browser.close()
}
