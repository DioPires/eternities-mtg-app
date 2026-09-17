/**
 * SCRATCH (DEC-752 leg G). Throwaway.
 *
 * F3: the `one-card-world` matrix row expects W1 and W4 GREEN on `segovia` and both report N/A,
 * because the world presents NO front-facing cell. Every one-card world in the acceptance tour
 * reads the same — 1/1 cells reported, 0 presented.
 *
 * The question this answers is the only one that decides who owns it: is the single cell
 * PERMANENTLY back-facing, or was the read one unlucky phase of the world's own spin?
 *
 *   - a phase miss  -> the ROW is a single draw of a moving system, and the gate is mine to fix
 *   - permanent     -> a one-card world never shows its only card, and that is a renderer defect
 *
 * All six one-card worlds store the SAME cell normal, decoded off `stars.bin`: (-1, 0, 0), i.e.
 * equatorial at longitude -pi/2. `FACING_CUTOFF` is 0.12, so at the rig's ~63 deg arrival polar the
 * cell clears the cut over roughly 46% of a turn IF the mosaic turns. Worlds do spin
 * (`sceneHost.ts:338` installs the angles), so a hold longer than `spinPeriodS` sweeps the family.
 *
 * LIVENESS CONTROL, and it is the point: with one cell there is no front-facing SET to watch turn
 * over, so "never front-facing" and "the scene never moved" print identically. The run records the
 * cell's projected centre and its screen height per sample and REFUSES to report a verdict unless
 * they moved — a frozen scene is one sample, not a family.
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => existsSync(p))

const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1] }

const SLUGS = String(argOf('--worlds', 'segovia')).split(',')
const WINDOW_S = Number(argOf('--window', 200))
const STEP_S = Number(argOf('--step', 4))
const OUT = resolve(argOf('--out', resolve(WEB_ROOT, 'worlds-gate/onecard-facing.json')))

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  const url = await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => { const m = /(http:\/\/localhost:\d+)/.exec(c); if (m) { clearTimeout(t); ok(m[1]) } })
  })
  return { url, stop: () => child.kill('SIGTERM') }
}

const heartbeat = (page) => page.evaluate(() => { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })) })

const readCell = (page, slug) => page.evaluate((s) => {
  const probe = window.__eternitiesProbe
  const p = probe?.worlds?.(s)
  const st = probe?.state?.()
  if (!p) return null
  const c = p.cells?.[0] ?? null
  return {
    cells: p.cells?.length ?? 0,
    radii: p.radii,
    planeSlug: p.planeSlug,
    multiverseAngle: st?.multiverseAngle ?? null,
    stateSlug: st?.planeSlug ?? null,
    cell: c === null ? null : {
      frontFacing: c.frontFacing, onScreen: c.onScreen, height: c.height,
      x: c.x, y: c.y, shade: c.shade, wantsArt: c.wantsArt, showingArt: c.showingArt,
    },
  }
}, slug)

const main = async () => {
  const { url, stop } = await startPreview('worlds')
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--no-sandbox', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  })
  const results = {}
  try {
    for (const slug of SLUGS) {
      const page = await browser.newPage()
      await page.setViewport(VIEWPORT)
      await page.goto(`${url}/?probe=shell`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await page.waitForFunction(() => window.__eternitiesProbe?.state?.() != null, { timeout: 60_000 })
      await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
      await page.waitForFunction((s) => {
        const st = window.__eternitiesProbe?.state?.()
        return st?.planeSlug === s && st?.flying === false
      }, { timeout: 60_000 }, slug)
      await sleep(1500)

      const samples = []
      const t0 = Date.now()
      while ((Date.now() - t0) / 1000 < WINDOW_S) {
        await heartbeat(page)
        const r = await readCell(page, slug)
        samples.push({ t: +((Date.now() - t0) / 1000).toFixed(2), ...r })
        await sleep(STEP_S * 1000)
      }
      await page.close()

      const withCell = samples.filter((s) => s.cell)
      const front = withCell.filter((s) => s.cell.frontFacing)
      const onScr = withCell.filter((s) => s.cell.onScreen)
      const xs = withCell.map((s) => s.cell.x)
      const hs = withCell.map((s) => s.cell.height)
      const shades = withCell.map((s) => s.cell.shade)
      const moved = {
        x: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...hs) - Math.min(...hs),
        shade: Math.max(...shades) - Math.min(...shades),
        multiverseAngle: Math.max(...withCell.map((s) => s.multiverseAngle)) - Math.min(...withCell.map((s) => s.multiverseAngle)),
      }
      const live = moved.x > 1 || moved.height > 0.5 || moved.shade > 0.01
      results[slug] = { samples: samples.length, withCell: withCell.length, front: front.length, onScreen: onScr.length, moved, live }
      console.log(`${slug}: ${samples.length} samples, cell present ${withCell.length}, FRONT-FACING ${front.length}, onScreen ${onScr.length}`)
      console.log(`  liveness: x range ${moved.x.toFixed(2)}px, height range ${moved.height.toFixed(3)}px, shade range ${moved.shade.toFixed(4)}, multiverseAngle range ${moved.multiverseAngle.toFixed(4)} -> ${live ? 'SCENE MOVED' : '*** SCENE FROZEN — verdict refused ***'}`)
      if (live) {
        console.log(`  VERDICT: ${front.length === 0 ? 'NEVER front-facing over a full spin period' : `front-facing on ${front.length}/${withCell.length} samples (${(100 * front.length / withCell.length).toFixed(1)}%)`}`)
      }
      results[slug].allSamples = samples
      // Write after EVERY world: the first draft wrote once at the end and a page-load timeout on
      // the second world threw away the first world's samples entirely.
      writeFileSync(OUT, JSON.stringify(results, null, 1))
    }
  } finally {
    await browser.close()
    stop()
  }
  writeFileSync(OUT, JSON.stringify(results, null, 1))
  console.log(`\nwritten to ${OUT}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
