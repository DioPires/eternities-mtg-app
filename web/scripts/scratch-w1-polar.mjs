/**
 * SCRATCH (DEC-752 leg G). Throwaway.
 *
 * What polar does the rig actually settle at? The relay's §3 left a ~2% gap between leg G's live
 * dominaria reading (17.12–17.17) and an offline harness placed at `HOME_POLAR` (17.48–17.58), and
 * called it "two azimuths". It is not: the live family over a full relative turn is ±0.16% and the
 * offline shipped-orientation family ±0.3%, so neither spans 2%. The offline polar sweep says the
 * statistic falls 0.12 px per degree at `HOME_POLAR`, which makes a ~3 deg difference the size of
 * the whole gap.
 *
 * `WorldsProbe` publishes `centre` and `cameraPosition` in the world's own frame, so the polar is a
 * reading rather than an inference: the pole is world `+Y` (`spin.ts`'s `WORLD_POLE_AXIS`).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const SLUGS = (process.argv[2] ?? 'dominaria,ravnica').split(',')

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => {
      const m = /(http:\/\/localhost:\d+)/.exec(c)
      if (m) {
        clearTimeout(timer)
        ok(m[1])
      }
    })
  })
  return { url, stop: () => child.kill('SIGTERM') }
}

const heartbeat = (page) =>
  page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  })

async function waitFor(page, predicate, timeout = 120_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await page.evaluate(() => window.__eternitiesProbe?.state?.() ?? null)
    if (state !== null && predicate(state)) return state
    if (Date.now() > deadline) throw new Error('timed out')
    await heartbeat(page)
    await sleep(250)
  }
}

async function main() {
  const { url, stop } = await startPreview('worlds')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--hide-scrollbars'],
  })
  try {
    for (const slug of SLUGS) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
      await page.goto(`${url}/?probe=shell`, { waitUntil: 'load', timeout: 120_000 })
      await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 120_000 })
      await waitFor(page, (s) => !s.flying)
      await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
      await waitFor(page, (s) => s.planeSlug === slug && !s.flying)
      // Two reads 8 s apart: the settle is eased, so one read cannot tell "this is the pose" from
      // "this is a frame on the way to it".
      for (const wait of [3, 8]) {
        const until = Date.now() + wait * 1000
        while (Date.now() < until) {
          await heartbeat(page)
          await sleep(500)
        }
        const read = await page.evaluate((s) => {
          const p = window.__eternitiesProbe.worlds(s)
          if (p === null || p === undefined) return null
          const d = [
            p.cameraPosition[0] - p.centre[0],
            p.cameraPosition[1] - p.centre[1],
            p.cameraPosition[2] - p.centre[2],
          ]
          const len = Math.hypot(d[0], d[1], d[2])
          return {
            planeSlug: p.planeSlug,
            radii: p.radii,
            polarDeg: (Math.acos(d[1] / len) * 180) / Math.PI,
            azimuthDeg: (Math.atan2(d[0], d[2]) * 180) / Math.PI,
          }
        }, slug)
        console.log(
          `${slug}: radii ${read.radii.toFixed(4)}  polar ${read.polarDeg.toFixed(3)} deg  ` +
            `azimuth ${read.azimuthDeg.toFixed(3)} deg  (payload ${read.planeSlug})`,
        )
      }
      await page.close()
    }
  } finally {
    await browser.close()
    stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
