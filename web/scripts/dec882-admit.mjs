/** DEC-882 step 1: live admission at the layers-128 pose. Reports the product's own counts. */
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .filter(Boolean).find((p) => existsSync(p))
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1] }
const LABEL = String(argOf('--label', 'tree'))
const OUT = String(argOf('--out', `/tmp/dec882-admit-${LABEL}.json`))
const DRAWS = Number(argOf('--draws', '5'))
const LAYERS = String(argOf('--layers', '128'))
const RADII = Number(argOf('--radii', '2.2'))
const PLANE = String(argOf('--plane', 'dominaria'))

async function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'],
    { cwd: WEB_ROOT, env: { ...process.env, ETERNITIES_DATASET: 'worlds' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume()
  const url = await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('no preview')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => { const m = /(http:\/\/localhost:\d+)/.exec(c); if (m) { clearTimeout(t); ok(m[1]) } })
  })
  return { url, stop: () => child.kill('SIGTERM') }
}
const waitFor = async (page, pred) => {
  for (let i = 0; i < 480; i += 1) {
    const s = await page.evaluate(() => window.__eternitiesProbe?.state?.() ?? null)
    if (s !== null && pred(s)) return s
    await sleep(250)
  }
  throw new Error('timeout')
}
const poseOf = (page, plane) => page.evaluate((p) => window.__eternitiesProbe.worlds(p)?.radii ?? null, plane)

async function main() {
  const { url, stop } = await startPreview()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`] })
  try {
    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    await page.goto(`${url}/?probe=shell&layers=${LAYERS}`, { waitUntil: 'load', timeout: 120_000 })
    await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 120_000 })
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some((c) => c.width > 300), { timeout: 120_000 })
    await waitFor(page, (s) => !s.flying)
    await page.evaluate((p) => window.__eternitiesProbe.focusPlane(p), PLANE)
    await waitFor(page, (s) => s.planeSlug === PLANE && !s.flying)
    const box = await page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].find((e) => e.width > 300)
      const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    // Hold the 45 s idle attract off (PRD 5.3.22) for the whole window, not just at the start.
    await page.mouse.move(box.x, box.y)
    const heartbeat = setInterval(() => { page.mouse.move(box.x + 1, box.y).catch(() => {}) }, 20_000)
    let cur = await poseOf(page, PLANE)
    let k = null
    for (const d of [cur > RADII ? -60 : 60, cur > RADII ? 60 : -60]) {
      const before = cur
      await page.mouse.wheel({ deltaY: d }); await sleep(400); cur = await poseOf(page, PLANE)
      if (Math.abs(cur - RADII) <= 0.02) break
      if (Math.abs(Math.log(cur / before)) < 1e-6) continue
      k = Math.log(cur / before) / d; break
    }
    if (k !== null) for (let i = 0; i < 4 && Math.abs(cur - RADII) > 0.02; i += 1) {
      await page.mouse.wheel({ deltaY: Math.log(RADII / cur) / k }); await sleep(400); cur = await poseOf(page, PLANE)
    }
    await sleep(5000)
    const draws = []
    for (let i = 0; i < DRAWS; i += 1) {
      draws.push(await page.evaluate((p) => {
        const probe = window.__eternitiesProbe.worlds(p)
        const on = probe.cells.filter((c) => c.frontFacing && c.onScreen)
        const wanting = on.filter((c) => c.wantsArt)
        return {
          radii: probe.radii,
          threshold: probe.pool.effectiveThresholdPx,
          layers: probe.pool.layers,
          resident: probe.pool.resident,
          evictions: probe.pool.evictions,
          onScreen: on.length,
          wanting: wanting.length,
          artCellsShowing: wanting.filter((c) => c.showingArt).length,
          showingArtAll: on.filter((c) => c.showingArt).length,
          heights: on.map((c) => c.height).sort((a, b) => b - a),
        }
      }, PLANE))
      await sleep(3000)
    }
    clearInterval(heartbeat)
    writeFileSync(OUT, JSON.stringify({ label: LABEL, layers: LAYERS, plane: PLANE, draws }, null, 2))
    for (const d of draws) {
      const h = d.heights
      console.log(`${LABEL}: radii ${d.radii.toFixed(6)} thr ${d.threshold.toFixed(4)} layers ${d.layers} ` +
        `resident ${d.resident} | onScreen ${h.length} wanting ${d.wanting} artCellsShowing ${d.artCellsShowing} ` +
        `showingArtAll ${d.showingArtAll} | max ${h[0].toFixed(3)} h[127] ${(h[127] ?? NaN).toFixed(3)} h[207] ${(h[207] ?? NaN).toFixed(3)}`)
    }
    console.log(`written to ${OUT}`)
  } finally { await browser.close(); stop() }
}
main().catch((e) => { console.error(e); process.exit(1) })
