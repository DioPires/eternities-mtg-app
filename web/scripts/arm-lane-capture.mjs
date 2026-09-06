#!/usr/bin/env node
/**
 * DEC-684's render gate: the three named planes at the tether settle, one dataset per run.
 *
 * `visual-gate.mjs --only planes` captures checkpoint 2's three planes chosen *by rank*, which
 * gives Dominaria (the largest) and two planes nobody named. DEC-684 asks about Dominaria, Ravnica
 * and one mid-size plane specifically, on two datasets, so this drives the same probe seam
 * (`?probe=shell` — the shipped composition, per DEC-661) at exactly those three slugs.
 *
 * It is a capture tool, not a check: it fails only if it cannot reach a plane.
 *
 *   node scripts/arm-lane-capture.mjs --dataset <hash> --out DIR [--no-build]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PLANES = ['dominaria', 'ravnica', 'thunder-junction']
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1.5 }
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean)

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const probeState = (page) => page.evaluate(() => window.__eternitiesProbe?.state() ?? null)

function args() {
  const out = { dataset: 'production', out: null, build: true }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') out.dataset = argv[++i]
    else if (argv[i] === '--out') out.out = argv[++i]
    else if (argv[i] === '--no-build') out.build = false
  }
  if (!out.out) throw new Error('--out is required')
  return out
}

function run(command, argv, env) {
  return new Promise((ok, fail) => {
    const child = spawn(command, argv, { cwd: WEB_ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${command} exited ${code}`))))
  })
}

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => process.stderr.write(`  [vite] ${c}`))
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const match = /(http:\/\/localhost:\d+)/.exec(chunk)
      if (match) {
        clearTimeout(timer)
        ok(match[1])
      }
    })
  })
  return { url, stop: () => child.kill('SIGTERM') }
}

async function waitFor(page, describe, predicate, timeout = 90_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await probeState(page)
    if (state !== null && predicate(state)) return state
    if (Date.now() > deadline) {
      const s = await probeState(page)
      throw new Error(
        `timed out waiting for ${describe}` +
          (s ? ` — focus ${s.level} ${s.planeSlug ?? ''}, d ${s.cameraDistance.toFixed(1)}, ${s.cardsLoaded} cards` : ' (no probe)'),
      )
    }
    await sleep(250)
  }
}

const settle = (page, frames) =>
  page.evaluate((n) => new Promise((ok) => {
    let left = n
    const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : ok(undefined))
    requestAnimationFrame(tick)
  }), frames)

async function withPanelHidden(page, capture) {
  const toggle = (hide) =>
    page.evaluate((h) => {
      for (const id of ['eternities-status', 'phase0-status']) {
        const node = document.querySelector(`[data-testid="${id}"]`)
        if (!node) continue
        if (h) node.style.setProperty('visibility', 'hidden', 'important')
        else node.style.removeProperty('visibility')
      }
    }, hide)
  await toggle(true)
  await settle(page, 1)
  try {
    return await capture()
  } finally {
    await toggle(false)
  }
}

async function main() {
  const a = args()
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = typeof registry[a.dataset] === 'string' ? registry[a.dataset] : a.dataset
  if (!existsSync(resolve(WEB_ROOT, 'public/data', hash))) {
    throw new Error(`dataset ${hash} is not in web/public/data`)
  }
  mkdirSync(a.out, { recursive: true })
  if (a.build) await run('pnpm', ['build'], { ETERNITIES_DATASET: hash })

  const { url, stop } = await startPreview(hash)
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) throw new Error('no Chrome found; set CHROME_PATH')
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  })

  const rows = []
  try {
    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    await page.goto(`${url}/?probe=shell`, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 60_000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('canvas')].some((c) => c.width > 300 && c.height > 150),
      { timeout: 60_000 },
    )
    const gpu = await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0]
      const ctx = canvas?.getContext('webgl2')
      const dbg = ctx?.getExtension('WEBGL_debug_renderer_info')
      return {
        size: canvas ? `${canvas.width}x${canvas.height}` : null,
        renderer: dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null,
      }
    })
    console.log(`dataset ${hash} · canvas ${gpu.size} · ${gpu.renderer}`)
    if (/swiftshader|llvmpipe|software/i.test(gpu.renderer ?? '')) {
      throw new Error(`software renderer (${gpu.renderer}) — the gate needs a real GPU`)
    }
    await sleep(6000) // let the intro finish before the first flight

    for (const slug of PLANES) {
      // `?quality=` does not survive the shell's router, so PRD 8.5.11's ladder is live. Shard
      // decoding stalls the render loop, the ladder reads the stall as a slow machine and steps
      // down, and left alone it climbs back after the restore window. Both datasets have to be
      // photographed by the same renderer or the tier difference reads as a change in the data.
      //
      // The wait for the top rung is short and retried rather than long: PRD 5.3.23's attract mode
      // starts on idle, and a single 90 s wait let it fly the camera from d 31 out to d 133 — the
      // shot then frames the multiverse, not the plane. Escape cancels attract (5.3.23) and the
      // flight is re-issued from rest.
      let state = null
      for (let attempt = 1; attempt <= 4 && state === null; attempt += 1) {
        await page.keyboard.press('Escape')
        await sleep(500)
        const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
        if (!ok) throw new Error(`focusPlane(${slug}) was refused`)
        await waitFor(page, `the rig to settle on ${slug}`, (s) => s.planeSlug === slug && !s.flying)
        await waitFor(page, `${slug}'s shards`, (s) => s.cardsLoaded > 0)
        await sleep(4000)
        const deadline = Date.now() + 12_000
        for (;;) {
          const s = await probeState(page)
          if (s !== null && s.quality.tierIndex === 0 && !s.flying && s.planeSlug === slug) {
            state = s
            break
          }
          if (Date.now() > deadline) {
            console.log(`  ${slug}: attempt ${attempt} ended at tier ${s?.quality.tier}, d ${s?.cameraDistance.toFixed(1)} — retrying`)
            break
          }
          await sleep(250)
        }
      }
      if (state === null) throw new Error(`${slug} never reached tier 0 at the tether settle`)
      await settle(page, 2)
      const name = `${slug}`
      await withPanelHidden(page, () => page.screenshot({ path: resolve(a.out, `${name}.png`) }))
      const line =
        `${slug}: d ${state.cameraDistance.toFixed(1)} · ${state.cardsLoaded} cards loaded · ` +
        `${state.quality.starsDrawn} stars drawn · tier ${state.quality.tier} · ` +
        `${state.quality.drawingBuffer.width}x${state.quality.drawingBuffer.height}`
      writeFileSync(resolve(a.out, `${name}.txt`), `dataset ${hash}\n${line}\n`)
      console.log(`  ${line}`)
      rows.push({ slug, dataset: hash, distance: state.cameraDistance, cards: state.cardsLoaded })
    }
    writeFileSync(resolve(a.out, 'capture.json'), `${JSON.stringify({ dataset: hash, gpu, rows }, null, 2)}\n`)
  } finally {
    await browser.close()
    stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
