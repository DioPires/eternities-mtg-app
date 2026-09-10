/**
 * DEC-697 diagnostic: correlate the 128x178 texture churn with the tier's own counters.
 *
 * It answers one question `alloc-probe.mjs` structurally cannot, because that one reports a single
 * average over its whole window: are the ~18 createTexture/s at card level genuine thumbnail
 * fetches completing (a fetch/eviction thrash), or the same texture re-uploaded (a `needsUpdate` /
 * disposed-properties path)? This prints allocations *per second* alongside the tier's own
 * requested/loaded counters and a `returning` column — cells the atlas drew, threw away, and had to
 * fetch again, which is what a thrash would look like.
 *
 * Committed rather than thrown away because it is what showed the headline number to be measured
 * over the wrong window: on the unfixed build `returning` is ~0, so the churn was the per-upload
 * `Texture` allocation and not a thrash — and the per-second rate falls away as the initial fill
 * completes rather than holding at the ~18/s that `alloc-probe`'s 30 s average reported. Sampled
 * far enough out it reaches exactly 0/s (second 35 onwards over a 110 s window), which is the
 * shape of a finite fetch-bound burst and not of a rate. Keep it for the next time a rate needs
 * separating from a burst.
 *
 *   node scripts/dec697-diag.mjs --url http://localhost:4173 --samples 15
 */

import { createRequire } from 'node:module'
import { argv } from 'node:process'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const URL_BASE = arg('url', 'http://127.0.0.1:4173')
const SAMPLES = Number(arg('samples', '15'))

const HOOKS = `
(() => {
  const state = { created: 0, deleted: 0, storage: 0, subImage: 0, image: 0, sizes: {} }
  window.__alloc = state
  const patch = (proto) => {
    if (!proto || proto.__allocPatched) return
    proto.__allocPatched = true
    const create = proto.createTexture
    proto.createTexture = function () { state.created += 1; return create.apply(this, arguments) }
    const remove = proto.deleteTexture
    proto.deleteTexture = function () { state.deleted += 1; return remove.apply(this, arguments) }
    const storage = proto.texStorage2D
    proto.texStorage2D = function (target, levels, internalFormat, width, height) {
      state.storage += 1
      const k = width + 'x' + height
      state.sizes[k] = (state.sizes[k] || 0) + 1
      return storage.apply(this, arguments)
    }
    const sub = proto.texSubImage2D
    proto.texSubImage2D = function () { state.subImage += 1; return sub.apply(this, arguments) }
    const image = proto.texImage2D
    proto.texImage2D = function () { state.image += 1; return image.apply(this, arguments) }
  }
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype)
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype)
})()
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const read = (page) =>
  page.evaluate(() => {
    const s = window.__eternitiesProbe.state()
    return {
      alloc: { ...window.__alloc, sizes: { ...window.__alloc.sizes } },
      thumbs: s.thumbnails,
      images: s.images,
      level: s.level,
      distance: s.cameraDistance,
      flying: s.flying,
      drawn: window.__eternitiesProbe.thumbnailStars(),
    }
  })

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
    () =>
      typeof window.__eternitiesProbe !== 'undefined' &&
      window.__eternitiesProbe.state().level !== 'none',
    { timeout: 120_000, polling: 250 },
  )
  await sleep(8000)

  const planes = await page.evaluate(() => window.__eternitiesProbe.planes())
  await page.evaluate((slug) => window.__eternitiesProbe.focusPlane(slug), planes[0].slug)
  await sleep(4000)
  await page.evaluate(() => window.__eternitiesProbe.focusCard({}))
  await sleep(3000)

  let prev = await read(page)
  console.log(
    'plane=' + planes[0].slug + ' cards=' + planes[0].cardCount + ' level=' + prev.level,
  )
  console.log(
    ' t created storage | requested dLoaded cells/cap | drawn entered  left returning | everSeen',
  )
  const everSeen = new Set(prev.drawn)
  const t0 = Date.now()
  let created0 = prev.alloc.created
  for (let i = 0; i < SAMPLES; i += 1) {
    await sleep(1000)
    const now = await read(page)
    const d = (a, b) => String(a - b).padStart(6)
    const prevSet = new Set(prev.drawn)
    const nowSet = new Set(now.drawn)
    let entered = 0
    let returning = 0
    for (const s of nowSet) {
      if (prevSet.has(s)) continue
      entered += 1
      // Already drawn at some earlier sample: the atlas had this cell and threw it away.
      if (everSeen.has(s)) returning += 1
    }
    let left = 0
    for (const s of prevSet) if (!nowSet.has(s)) left += 1
    for (const s of nowSet) everSeen.add(s)
    console.log(
      [
        String(i + 1).padStart(2),
        d(now.alloc.created, prev.alloc.created),
        d(now.alloc.storage, prev.alloc.storage),
        '|',
        d(now.thumbs.requested, prev.thumbs.requested),
        d(now.thumbs.loaded, prev.thumbs.loaded),
        (now.thumbs.cells + '/' + now.thumbs.capacity).padStart(9),
        '|',
        String(now.drawn.length).padStart(5),
        String(entered).padStart(7),
        String(left).padStart(5),
        String(returning).padStart(9),
        '|',
        String(everSeen.size).padStart(8),
      ].join(' '),
    )
    prev = now
  }
  const total = prev.alloc.created - created0
  const secs = (Date.now() - t0) / 1000
  console.log(`AVERAGE createTexture/s over ${secs.toFixed(1)}s = ${(total / secs).toFixed(2)}`)
  const sizes = (await read(page)).alloc.sizes
  const top = Object.entries(sizes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  console.log('cumulative texStorage2D by size:', JSON.stringify(Object.fromEntries(top)))
} finally {
  await browser.close()
}
