/**
 * DEC-714: does the reused face texture actually show the new printing?
 *
 * The allocation probe proves the fix stopped allocating. It cannot prove the upload still lands —
 * a `texSubImage2D` that silently no-ops would look identical to a win, and the face would simply
 * freeze on the first printing. This asserts the pixels.
 *
 * The trap is that the scene is animated, so two screenshots of the *same* printing never match
 * byte for byte. Each comparison is therefore run against its own noise floor: two signatures of
 * the same printing, the same interval apart, are the control, and a printing switch has to move
 * the face by far more than that to count.
 *
 * PNG decoding happens in the page — the browser already has a decoder, and the signature it
 * returns is an 8x8 grid of mean RGB so nothing large crosses the bridge.
 *
 * **The absolute threshold here is weak, and deliberately so.** Successive printings of a basic
 * land are all the same dark art, so the signal is small however the pixels get there: the first
 * version of this check demanded 3x the noise floor and red-lit the *unfixed* build, which
 * allocates a fresh texture every time and is known to display correctly. A criterion that fails on
 * the known-good build measures the criterion, not the code. The real instrument is the A/B — run
 * this on the unfixed build and on the fixed one and compare the deltas, which is what DEC-714's
 * evidence does. This threshold only catches a face that has frozen outright.
 *
 *   node scripts/dec714-face-visual.mjs --url http://localhost:4199
 */

import { createRequire } from 'node:module'
import { argv, exit } from 'node:process'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const URL_BASE = arg('url', 'http://localhost:4199')
/** Long enough for PRD 7.3.5's 200 ms fade and the fetch behind it to finish. */
const SETTLE_MS = Number(arg('settle', '4000'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const note = (message) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${message}`)

/** Mean RGB over an 8x8 grid of the clip, decoded by the browser. */
async function signature(page, clip) {
  const shot = await page.screenshot({ encoding: 'base64', clip })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const out = []
    for (let gy = 0; gy < 8; gy += 1) {
      for (let gx = 0; gx < 8; gx += 1) {
        const x0 = Math.floor((gx * canvas.width) / 8)
        const x1 = Math.floor(((gx + 1) * canvas.width) / 8)
        const y0 = Math.floor((gy * canvas.height) / 8)
        const y1 = Math.floor(((gy + 1) * canvas.height) / 8)
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * canvas.width + x) * 4
            r += data[i]
            g += data[i + 1]
            b += data[i + 2]
            n += 1
          }
        }
        out.push(r / n, g / n, b / n)
      }
    }
    return out
  }, shot)
}

/** Mean absolute difference, in 0-255 channel units. */
function mad(a, b) {
  let total = 0
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i])
  return Number((total / a.length).toFixed(3))
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--window-size=1920,1140', '--use-angle=metal', '--hide-scrollbars'],
})

try {
  const page = await browser.newPage()
  // `motion=0` holds the field still — the same override the cross-browser and self-check passes
  // use to compare two implementations of a moving thing. With the orbit and the tilt spring at
  // rest the only thing left that can move the face is the face image itself.
  await page.goto(`${URL_BASE}/?probe=shell&motion=0`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () =>
      typeof window.__eternitiesProbe !== 'undefined' &&
      window.__eternitiesProbe.state().level !== 'none',
    { timeout: 120_000, polling: 250 },
  )
  await sleep(8000)

  const planes = await page.evaluate(() => window.__eternitiesProbe.planes())
  await page.evaluate((slug) => window.__eternitiesProbe.focusPlane(slug), planes[0].slug)
  await sleep(6000)
  const star = await page.evaluate(() => window.__eternitiesProbe.focusCard({ nth: 0 }))
  await sleep(8000)

  const state = await page.evaluate(() => window.__eternitiesProbe.state())
  note(`card ${state.card.name} (${state.card.printings} printings), star ${star}`)

  // Centred on where the card actually projects, not on an assumption that it is mid-screen.
  const cx = state.cardScreen.x * 1920
  const cy = state.cardScreen.y * 1080
  const clip = { x: Math.round(cx - 110), y: Math.round(cy - 150), width: 220, height: 300 }
  note(`face clip ${JSON.stringify(clip)}`)

  await page.evaluate(() => window.__eternitiesProbe.activatePrinting(1))
  await sleep(SETTLE_MS)
  const a1 = await signature(page, clip)
  // Noise floor: same printing, same interval. Everything that moves on its own is in here.
  await sleep(SETTLE_MS)
  const a2 = await signature(page, clip)

  await page.evaluate(() => window.__eternitiesProbe.activatePrinting(2))
  await sleep(SETTLE_MS)
  const b1 = await signature(page, clip)

  await page.evaluate(() => window.__eternitiesProbe.activatePrinting(3))
  await sleep(SETTLE_MS)
  const c1 = await signature(page, clip)

  const noise = mad(a1, a2)
  const switch12 = mad(a1, b1)
  const switch23 = mad(b1, c1)
  const result = {
    card: state.card.name,
    noiseFloorSamePrinting: noise,
    printing1to2: switch12,
    printing2to3: switch23,
    ratio1to2: Number((switch12 / Math.max(noise, 0.001)).toFixed(1)),
    ratio2to3: Number((switch23 / Math.max(noise, 0.001)).toFixed(1)),
    verdict:
      switch12 > noise * 1.5 && switch23 > noise * 1.5
        ? 'FACE CHANGES ON PRINTING SWITCH'
        : 'FACE DID NOT CHANGE — reuse is not landing',
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.verdict !== 'FACE CHANGES ON PRINTING SWITCH') exit(2)
} catch (error) {
  console.error(error)
  exit(1)
} finally {
  await browser.close()
}
