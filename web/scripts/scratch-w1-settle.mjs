/**
 * SCRATCH (DEC-752 leg G). Throwaway.
 *
 * The LIVE arm of relay `03bfa906` items 2/3/5: what does W1 read at the pose the product now
 * arrives at, after DEC-818's framing law moved dominaria and ravnica?
 *
 * The offline harness says the settle is 2.260705 / 3.080104 radii and the shipped-arm median is
 * 28.74-28.81 / 30.19-30.45 px at `HOME_POLAR`, 28.10 / 29.92 at the measured arrival polars. This
 * asks the running product the same question, and reads the POSE off the payload rather than
 * assuming `HOME_POLAR` — `WorldsProbe` publishes `centre` and `cameraPosition` in the world's own
 * frame and the pole is world `+Y`, so the polar is a reading (item 5).
 *
 * Sampling is over a window because the settle is eased and the multiverse turns: one read cannot
 * tell "this is the pose" from "this is a frame on the way to it".
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
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const SLUGS = String(argOf('--worlds', 'dominaria,ravnica')).split(',')
const WINDOW_S = Number(argOf('--window', 120))
const STEP_S = Number(argOf('--step', 8))
const OUT = resolve(argOf('--out', resolve(WEB_ROOT, 'worlds-gate/w1-settle.json')))

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

/** PRD 5.3.23's cheapest input: a bare pointermove cancels attract and leaves the rig alone. */
const heartbeat = (page) =>
  page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  })

async function waitFor(page, describe, predicate, timeout = 180_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await page.evaluate(() => window.__eternitiesProbe?.state?.() ?? null)
    if (state !== null && predicate(state)) return state
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${describe}`)
    await heartbeat(page)
    await sleep(250)
  }
}

async function hold(page, seconds) {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    await heartbeat(page)
    await sleep(Math.min(1000, Math.max(0, until - Date.now())))
  }
}

const median = (xs) => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Ask BY SLUG — a bare read describes whichever world the camera is nearest (DEC-785 F1). */
const read = (page, slug) =>
  page.evaluate((s) => {
    const probe = window.__eternitiesProbe
    const p = probe?.worlds?.(s)
    const state = probe?.state?.()
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
      // The pose, READ. `HOME_POLAR` is where the fly-to aims, not where it lands.
      polarDeg: (Math.acos(d[1] / len) * 180) / Math.PI,
      azimuthDeg: (Math.atan2(d[0], d[2]) * 180) / Math.PI,
      multiverseAngle: typeof state?.multiverseAngle === 'number' ? state.multiverseAngle : null,
      heights: p.cells.filter((c) => c.frontFacing).map((c) => c.height),
      frontFacingIds: p.cells.flatMap((c, i) => (c.frontFacing ? [i] : [])),
      cells: p.cells.length,
    }
  }, slug)

async function main() {
  const { url, stop } = await startPreview('worlds')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--hide-scrollbars'],
  })
  const report = { window: WINDOW_S, step: STEP_S, worlds: [] }
  try {
    for (const slug of SLUGS) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
      await page.goto(`${url}/?probe=shell`, { waitUntil: 'load', timeout: 180_000 })
      await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 180_000 })
      await waitFor(page, 'the intro flight', (s) => !s.flying)
      const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
      if (!ok) throw new Error(`focusPlane(${slug}) refused`)
      await waitFor(page, `${slug} to settle`, (s) => s.planeSlug === slug && !s.flying)
      await hold(page, 5)

      const samples = []
      const started = Date.now()
      for (;;) {
        const r = await read(page, slug)
        if (r === null) throw new Error(`no payload for ${slug}`)
        // The payload's identity field, on every read (DEC-785 F1).
        if (r.planeSlug !== slug) throw new Error(`asked ${slug}, payload is ${r.planeSlug}`)
        const first = samples[0]
        const turnover =
          first === undefined
            ? 0
            : 1 -
              r.frontFacingIds.filter((id) => first.set.has(id)).length /
                Math.max(1, r.frontFacingIds.length)
        const s = {
          t: (Date.now() - started) / 1000,
          radii: r.radii,
          polarDeg: r.polarDeg,
          azimuthDeg: r.azimuthDeg,
          multiverseAngle: r.multiverseAngle,
          frontFacing: r.heights.length,
          turnoverVsFirst: turnover,
          set: new Set(r.frontFacingIds),
          median: median(r.heights),
        }
        samples.push(s)
        console.log(
          `  ${slug} t=${s.t.toFixed(0)}s radii=${s.radii.toFixed(4)} polar=${s.polarDeg.toFixed(3)}deg ` +
            `azim=${s.azimuthDeg.toFixed(2)}deg front=${s.frontFacing} turnover=${(turnover * 100).toFixed(1)}% ` +
            `median=${s.median.toFixed(4)}px`,
        )
        if ((Date.now() - started) / 1000 >= WINDOW_S) break
        await hold(page, STEP_S)
      }
      await page.close()

      const medians = samples.map((s) => s.median).filter(Number.isFinite)
      const polars = samples.map((s) => s.polarDeg)
      const radii = samples.map((s) => s.radii)
      const world = {
        slug,
        n: medians.length,
        radii: { min: Math.min(...radii), max: Math.max(...radii) },
        polarDeg: { min: Math.min(...polars), max: Math.max(...polars) },
        median: { min: Math.min(...medians), max: Math.max(...medians) },
        maxTurnover: Math.max(...samples.map((s) => s.turnoverVsFirst)),
        samples: samples.map((s) => {
          const rest = { ...s }
          delete rest.set
          return rest
        }),
      }
      report.worlds.push(world)
      console.log(
        `\n${slug}: ${world.n} samples — radii ${world.radii.min.toFixed(4)}-${world.radii.max.toFixed(4)}, ` +
          `polar ${world.polarDeg.min.toFixed(3)}-${world.polarDeg.max.toFixed(3)} deg, ` +
          `W1 median ${world.median.min.toFixed(4)}-${world.median.max.toFixed(4)} px, ` +
          `turnover up to ${(world.maxTurnover * 100).toFixed(1)}%` +
          (world.maxTurnover < 0.01 ? '  — THE MOSAIC DID NOT TURN' : ''),
        '\n',
      )
    }
  } finally {
    await browser.close()
    stop()
  }
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`wrote ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
