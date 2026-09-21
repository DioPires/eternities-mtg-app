/**
 * Scratch diagnostic (NOT a deliverable): why does `driveToRadii` stop far from 2.2 radii?
 *
 * Flies to a world, then reports — per wheel notch — the rig state the gate's failure detail does
 * not currently carry: tether level, focus, flying, cameraDistance, the world-relative radii, and
 * what element is actually under the pointer when the wheel is dispatched.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)[0]

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const WORLDS = process.argv.slice(2).length ? process.argv.slice(2) : ['dominaria', 'alara', 'azgol']

function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    // NO_COLOR: hosted runners set `CI`, which turns vite's colours on even into a pipe, and the
    // port then arrives wrapped in bold escapes (`localhost:\e[1m4173\e[22m`) the URL match misses.
    env: { ...process.env, ETERNITIES_DATASET: 'worlds', NO_COLOR: '1' },
  })
  return new Promise((ok, err) => {
    let buf = ''
    const onData = (d) => {
      buf += d.toString()
      const m = buf.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/)
      if (m) ok({ url: m[0], stop: () => child.kill('SIGTERM') })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    setTimeout(() => err(new Error('preview did not start')), 30_000)
  })
}

const state = (page) => page.evaluate(() => window.__eternitiesProbe.state())
const poseOf = (page, slug) =>
  page.evaluate((s) => {
    const p = window.__eternitiesProbe.worlds?.(s)
    return p ? { slug: p.planeSlug, radii: p.radii } : null
  }, slug)

const main = async () => {
  const { url, stop } = await startPreview()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.goto(`${url}/?probe=shell`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 120_000 })
  await page.waitForFunction(
    () => [...document.querySelectorAll('canvas')].some((c) => c.width > 300 && c.height > 150),
    { timeout: 120_000 },
  )

  // What sits under the middle of the viewport — the point every wheel is dispatched at.
  const centre = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const r = c.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const el = document.elementFromPoint(x, y)
    return {
      x,
      y,
      rect: { w: r.width, h: r.height },
      under: el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/).join('.')}` : ''}` : null,
      isCanvas: el === c,
    }
  })
  console.log('viewport centre:', JSON.stringify(centre))

  for (const slug of WORLDS) {
    console.log(`\n=== ${slug} ===`)
    const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
    console.log('focusPlane ->', ok)
    // wait for settle
    for (let i = 0; i < 120; i += 1) {
      const s = await state(page)
      if (s.planeSlug === slug && !s.flying) break
      await sleep(250)
    }
    await sleep(1500)
    const s0 = await state(page)
    const p0 = await poseOf(page, slug)
    console.log(
      `settle: level=${s0.level} focus=${s0.focus} flying=${s0.flying} camDist=${s0.cameraDistance?.toFixed(3)} radii=${p0?.radii?.toFixed(3)}`,
    )
    await page.mouse.move(centre.x, centre.y)
    for (let n = 0; n < 6; n += 1) {
      await page.mouse.wheel({ deltaY: -120 })
      await sleep(400)
      const s1 = await state(page)
      const p1 = await poseOf(page, slug)
      console.log(
        `  notch ${n + 1}: level=${s1.level} focus=${s1.focus} flying=${s1.flying} ` +
          `camDist=${s1.cameraDistance?.toFixed(3)} radii=${p1?.radii?.toFixed(3)}`,
      )
    }
  }
  await browser.close()
  stop()
}

await main()
