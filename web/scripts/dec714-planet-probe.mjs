/**
 * DEC-714: is the `new Texture(bitmap)` in `focusedCard.ts` an allocate/free CYCLE per planet
 * upload, or one live texture per planet?
 *
 * DEC-707 note N4 measured "`texStorage2D` at 256x187 exactly 72 times in one session" and read it
 * as "one allocate/free cycle per planet image", i.e. the same churn DEC-697 removed from
 * `ThumbnailAtlas.upload`. That reading only holds if the texture is a *staging* texture. This
 * instrument decides it by counting allocations and frees SEPARATELY, at a chosen size, and
 * correlating the allocation count with the number of planets actually on screen.
 *
 * How it attributes a free. `deleteTexture(tex)` carries no dimensions, so the hooks track the
 * texture bound to each target through `bindTexture` and stamp it when `texStorage2D`/`texImage2D`
 * sizes it. A `WeakMap` then lets `deleteTexture` say which size went away. Without that, a free
 * count is unattributable and "72 allocations" cannot be told apart from "72 allocate/free pairs".
 *
 * The windows are deliberately long. DEC-707's lesson from the thumbnail churn was that a window
 * shorter than the fill reports a burst as a rate; here every phase is sampled twice, once across
 * the fill and once across an equally long idle hold, so a burst and a steady state cannot be
 * confused.
 *
 *   node dec714-planet-probe.mjs --url http://127.0.0.1:4199 --out /tmp/out
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

const URL_BASE = arg('url', 'http://127.0.0.1:4199')
const OUT = arg('out', null)
const LABEL = arg('label', 'dec714')
/** Across the fill. Long enough that a six-wide image queue has drained 72 art crops. */
const FILL_S = Number(arg('fill', '25'))
/** Idle hold afterwards, same length, so a burst and a rate are distinguishable. */
const HOLD_S = Number(arg('hold', '25'))
const CARDS = Number(arg('cards', '4'))

/**
 * Counts allocations and frees per texture size. Installed before the app's first line.
 *
 * `sizes` is keyed "WxH", so the planet crop (256x187) and the card face (672x936) are read off the
 * same run — the face is the positive control, because switching printings genuinely disposes a
 * face texture and allocates its replacement.
 */
const HOOKS = `
(() => {
  const state = { sizes: {}, allocAll: 0, freeAll: 0 }
  window.__planetAlloc = state
  const bump = (key, field) => {
    const row = state.sizes[key] || (state.sizes[key] = { alloc: 0, free: 0 })
    row[field] += 1
  }
  const stamped = new WeakMap()
  const patch = (proto) => {
    if (!proto || proto.__planetPatched) return
    proto.__planetPatched = true
    const bound = new WeakMap()
    const bind = proto.bindTexture
    proto.bindTexture = function (target, texture) {
      let map = bound.get(this)
      if (!map) { map = new Map(); bound.set(this, map) }
      map.set(target, texture)
      return bind.apply(this, arguments)
    }
    const record = function (ctx, target, width, height) {
      state.allocAll += 1
      const key = (width | 0) + 'x' + (height | 0)
      bump(key, 'alloc')
      const map = bound.get(ctx)
      const tex = map && map.get(target)
      if (tex) stamped.set(tex, key)
    }
    const storage = proto.texStorage2D
    if (storage) {
      proto.texStorage2D = function (target, levels, internalFormat, width, height) {
        record(this, target, width, height)
        return storage.apply(this, arguments)
      }
    }
    const image = proto.texImage2D
    proto.texImage2D = function (target, level, internalFormat, width, height) {
      if (typeof width === 'number' && typeof height === 'number') {
        record(this, target, width, height)
      }
      return image.apply(this, arguments)
    }
    const del = proto.deleteTexture
    proto.deleteTexture = function (texture) {
      state.freeAll += 1
      const key = texture && stamped.get(texture)
      if (key) bump(key, 'free')
      return del.apply(this, arguments)
    }
  }
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype)
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype)
})()
`

const PLANET = '256x187'
const FACE = '672x936'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const read = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__planetAlloc)))
const cardState = (page) =>
  page.evaluate(() => {
    const s = window.__eternitiesProbe.state()
    return { card: s.card, gpu: s.gpu, images: s.images, level: s.level }
  })

const note = (message) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${message}`)

function delta(before, after, key) {
  const b = before.sizes[key] || { alloc: 0, free: 0 }
  const a = after.sizes[key] || { alloc: 0, free: 0 }
  return { alloc: a.alloc - b.alloc, free: a.free - b.free }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--window-size=1920,1140', '--use-angle=metal', '--hide-scrollbars'],
})

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => note(`pageerror: ${error.message}`))
  await page.evaluateOnNewDocument(HOOKS)
  note(`goto ${URL_BASE}`)
  await page.goto(`${URL_BASE}/?probe=shell&motion=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () =>
      typeof window.__eternitiesProbe !== 'undefined' &&
      window.__eternitiesProbe.state().level !== 'none',
    { timeout: 120_000, polling: 250 },
  )
  note('probe up, settling the field')
  await sleep(8000)

  const planes = await page.evaluate(() => window.__eternitiesProbe.planes())
  const biggest = planes[0]
  note(`focusPlane ${biggest.slug} (${biggest.cardCount} cards)`)
  await page.evaluate((slug) => window.__eternitiesProbe.focusPlane(slug), biggest.slug)
  await sleep(6000)

  const report = { label: LABEL, url: URL_BASE, plane: biggest.slug, cards: [], control: null }

  for (let nth = 0; nth < CARDS; nth += 1) {
    const before = await read(page)
    const star = await page.evaluate((n) => window.__eternitiesProbe.focusCard({ nth: n }), nth)
    if (star < 0) {
      note(`nth=${nth}: no such card, stopping the tour`)
      break
    }
    note(`nth=${nth}: star ${star}, filling for ${FILL_S}s`)
    await sleep(FILL_S * 1000)
    const afterFill = await read(page)
    const state = await cardState(page)
    note(
      `nth=${nth}: ${state.card ? state.card.name : '?'} — ${
        state.card ? state.card.planets : '?'
      } planets, planet alloc ${delta(before, afterFill, PLANET).alloc} / free ${
        delta(before, afterFill, PLANET).free
      }; holding idle ${HOLD_S}s`,
    )
    await sleep(HOLD_S * 1000)
    const afterHold = await read(page)
    note(
      `nth=${nth}: idle hold planet alloc ${delta(afterFill, afterHold, PLANET).alloc} / free ${
        delta(afterFill, afterHold, PLANET).free
      }`,
    )

    report.cards.push({
      nth,
      star,
      name: state.card ? state.card.name : null,
      printings: state.card ? state.card.printings : null,
      planetsOnScreen: state.card ? state.card.planets : null,
      overflow: state.card ? state.card.overflow : null,
      imagesCompleted: state.images.completed,
      cardBytes: state.gpu.cardBytes,
      fill: {
        seconds: FILL_S,
        planet: delta(before, afterFill, PLANET),
        face: delta(before, afterFill, FACE),
      },
      idleHold: {
        seconds: HOLD_S,
        planet: delta(afterFill, afterHold, PLANET),
        face: delta(afterFill, afterHold, FACE),
      },
    })
  }

  // Positive control, on the shipped build with no source change: `activatePrinting` reloads the
  // card FACE, and `loadFace` disposes the old texture before allocating its replacement. That is a
  // genuine allocate/free cycle. If the instrument reports it, the instrument is not blind to the
  // churn N4 claimed for the planets.
  const beforeControl = await read(page)
  const printings = await page.evaluate(() => {
    const card = window.__eternitiesProbe.state().card
    return card ? card.printings : 0
  })
  const switches = Math.min(6, printings)
  for (let i = 1; i <= switches; i += 1) {
    await page.evaluate((index) => window.__eternitiesProbe.activatePrinting(index), i % printings)
    await sleep(4000)
  }
  const afterControl = await read(page)
  report.control = {
    kind: 'activatePrinting face reload',
    switches,
    face: delta(beforeControl, afterControl, FACE),
    planet: delta(beforeControl, afterControl, PLANET),
  }

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
