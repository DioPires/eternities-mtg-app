/**
 * Scratch diagnostic (NOT a deliverable): is the probe's `centre` stale, or is the camera not
 * following the world?
 *
 * Computes, in-page where the objects are real, the camera position, the probe's `centre`, their
 * separation, and the plane's live scene-graph position. If `|cam - centre|` moves while the rig's
 * `cameraDistance` does not, the two are measured to different points — and comparing `centre`
 * against the plane's live world position says which one moved.
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
    env: { ...process.env, ETERNITIES_DATASET: 'worlds' },
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
  // POSITIVE CONTROL: PRD 5.9 sets `motion` to 0, freezing the multiverse angle. If the drift is the
  // multiverse rotation, it must vanish here and only here.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
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

  console.log(`camera held still on ${SLUG} UNDER REDUCED MOTION (control)\n`)
  console.log(['t(s)', 'radii', 'camDist', 'mvAngle', '|cam-centre|', 'centre', 'camPos'].join('\t'))
  const t0 = Date.now()
  for (let i = 0; i < 8; i += 1) {
    const row = await page.evaluate((s) => {
      const p = window.__eternitiesProbe
      const w = p.worlds?.(s)
      const st = p.state()
      if (!w) return null
      const vec = (v) =>
        Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v && typeof v.x === 'number' ? v : null
      const c = vec(w.centre)
      const cam = vec(w.camera?.position ?? w.cameraPosition)
      const f = (v) => (v ? `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}` : 'n/a')
      return {
        radii: w.radii,
        camDist: st.cameraDistance,
        angle: st.multiverseAngle,
        sep: c && cam ? Math.hypot(cam.x - c.x, cam.y - c.y, cam.z - c.z) : NaN,
        centre: f(c),
        cam: f(cam),
        keys: Object.keys(w).join('|'),
      }
    }, SLUG)
    const t = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(
      row === null
        ? `${t}\t(no payload)`
        : [t, row.radii.toFixed(4), row.camDist.toFixed(4), row.angle.toFixed(5), String(row.sep), row.centre, row.cam, row.keys].join('\t'),
    )
    await sleep(2500)
  }
  await browser.close()
  stop()
}

await main()
