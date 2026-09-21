/**
 * Scratch diagnostic (NOT a deliverable): is `radii` measured from a stale centre?
 *
 * Holds the camera perfectly still on one world and samples `radii`, the probe's `centre`, the
 * rig's `cameraDistance` and `multiverseAngle` over time. A `radii` that moves while the camera
 * does not is a centre that moves — and the multiverse angle is the thing that moves it.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const SLUG = process.argv[2] ?? 'dominaria'

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
  await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), SLUG)
  for (let i = 0; i < 120; i += 1) {
    const s = await page.evaluate(() => window.__eternitiesProbe.state())
    if (s.planeSlug === SLUG && !s.flying) break
    await sleep(250)
  }
  await sleep(1500)

  console.log(`holding the camera still on ${SLUG}; sampling every 2 s\n`)
  console.log(
    ['t(s)', 'radii', 'camDist', 'mvAngle', 'centre.x', 'centre.y', 'centre.z', 'camPos.x'].join('\t'),
  )
  const t0 = Date.now()
  for (let i = 0; i < 10; i += 1) {
    const row = await page.evaluate((s) => {
      const p = window.__eternitiesProbe
      const w = p.worlds?.(s)
      const st = p.state()
      const vec = (v) => (Array.isArray(v) ? v : v ? [v.x, v.y, v.z] : [NaN, NaN, NaN])
      return w
        ? {
            radii: w.radii,
            camDist: st.cameraDistance,
            angle: st.multiverseAngle,
            c: vec(w.centre),
            px: vec(w.camera?.position)[0],
          }
        : null
    }, SLUG)
    const t = ((Date.now() - t0) / 1000).toFixed(1)
    const n = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : String(v))
    console.log(
      row === null
        ? `${t}\t(no payload)`
        : [t, n(row.radii, 4), n(row.camDist, 4), n(row.angle, 5), n(row.c[0]), n(row.c[1]), n(row.c[2]), n(row.px)].join('\t'),
    )
    await sleep(2000)
  }
  await browser.close()
  stop()
}

await main()
