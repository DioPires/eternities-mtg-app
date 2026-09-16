/**
 * SCRATCH (DEC-752 leg G). Throwaway.
 *
 * The live-rig arm of one question: is W1's per-world median a FAMILY in the shipped build, or is
 * leg G's single draw representative?
 *
 * DEC-818's `worlds-framing.test.ts` measures the family offline by sweeping the camera azimuth.
 * The live rig cannot be placed at a chosen azimuth, but it does not need to be: with the pole at
 * world `+Y` (`APPLY_PLANE_TILT` is false, so `planeOrientation` passes `NO_TILT`), a camera azimuth
 * sweep and the world's own spin about its pole are the SAME rotation of the mosaic relative to the
 * camera. The product spins every world (`sceneHost.ts:338` installs the plane table's angles), so
 * holding at the settle and re-reading samples the same family the offline sweep does.
 *
 * Sampling is by wall clock over a window, and the claim is an ENVELOPE — never "evenly spaced
 * azimuths", which would be deriving the parameter from my own clock (see `readAzimuth` in
 * `worlds-gate.mjs`). `multiverseAngle` is recorded per sample for provenance, and the run refuses
 * to report if nothing moved at all.
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

const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const SLUGS = String(argOf('--worlds', 'dominaria,ravnica')).split(',')
const WINDOW_S = Number(argOf('--window', 240))
const STEP_S = Number(argOf('--step', 10))
const OUT = resolve(argOf('--out', resolve(WEB_ROOT, 'worlds-gate/w1-family')) )

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

const probeState = (page) => page.evaluate(() => window.__eternitiesProbe?.state?.() ?? null)

/** Ask by slug — a bare read describes whichever world the camera is nearest (DEC-785). */
const readWorld = (page, slug) =>
  page.evaluate((s) => {
    const probe = window.__eternitiesProbe
    const payload = probe?.worlds?.(s)
    const state = probe?.state?.()
    if (payload === undefined || payload === null) return null
    // **The membership, not just the count.** A hemisphere is a hemisphere: the number of
    // front-facing cells is nearly constant whether the mosaic is turning relative to the camera or
    // co-rotating with it, so a narrow median family read off counts alone cannot tell "the family
    // is flat" from "the instrument never moved". The front-facing SET is the discriminator, and it
    // is recorded per sample so the rotation is a reading rather than an assumption.
    return {
      planeSlug: payload.planeSlug,
      radii: payload.radii,
      multiverseAngle: typeof state?.multiverseAngle === 'number' ? state.multiverseAngle : null,
      heights: payload.cells.filter((c) => c.frontFacing).map((c) => c.height),
      frontFacingIds: payload.cells.flatMap((c, i) => (c.frontFacing ? [i] : [])),
      cells: payload.cells.length,
    }
  }, slug)

const median = (xs) => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function waitFor(page, describe, predicate, timeout = 120_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await probeState(page)
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
      await page.setViewport(VIEWPORT)
      await page.goto(`${url}/?probe=shell`, { waitUntil: 'load', timeout: 120_000 })
      await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 120_000 })
      await waitFor(page, 'the intro flight', (s) => !s.flying)
      const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
      if (!ok) throw new Error(`focusPlane(${slug}) refused`)
      await waitFor(page, `${slug} to settle`, (s) => s.planeSlug === slug && !s.flying)
      await hold(page, 3)

      const samples = []
      const started = Date.now()
      for (;;) {
        const read = await readWorld(page, slug)
        if (read === null) throw new Error(`no payload for ${slug}`)
        if (read.planeSlug !== slug) throw new Error(`asked ${slug}, payload is ${read.planeSlug}`)
        const first = samples[0]
        const turnover =
          first === undefined
            ? 0
            : 1 -
              read.frontFacingIds.filter((id) => first.frontFacingSet.has(id)).length /
                Math.max(1, read.frontFacingIds.length)
        samples.push({
          t: (Date.now() - started) / 1000,
          radii: read.radii,
          multiverseAngle: read.multiverseAngle,
          frontFacing: read.heights.length,
          // The fraction of this sample's front-facing cells that were NOT front-facing at t=0.
          // Zero for every sample means the mosaic never turned relative to the camera, and the
          // median family below would then be a reading of a still frame repeated N times.
          turnoverVsFirst: turnover,
          frontFacingSet: new Set(read.frontFacingIds),
          median: median(read.heights),
        })
        const last = samples[samples.length - 1]
        console.log(
          `  ${slug} t=${last.t.toFixed(0)}s radii=${last.radii.toFixed(3)} ` +
            `front=${last.frontFacing} turnover=${(turnover * 100).toFixed(1)}% ` +
            `median=${last.median.toFixed(3)}px`,
        )
        if ((Date.now() - started) / 1000 >= WINDOW_S) break
        await hold(page, STEP_S)
      }
      await page.close()

      const medians = samples.map((s) => s.median).filter((m) => Number.isFinite(m))
      const min = Math.min(...medians)
      const max = Math.max(...medians)
      const radii = samples.map((s) => s.radii)
      const maxTurnover = Math.max(...samples.map((s) => s.turnoverVsFirst))
      report.worlds.push({
        slug,
        n: medians.length,
        settleRadii: { min: Math.min(...radii), max: Math.max(...radii) },
        min,
        max,
        mid: (min + max) / 2,
        halfWidthPct: ((max - min) / 2 / ((min + max) / 2)) * 100,
        maxTurnover,
        // The Set is the working value; the report carries the number it was computed for.
        samples: samples.map((s) => {
          const rest = { ...s }
          delete rest.frontFacingSet
          return rest
        }),
      })
      console.log(
        `\n${slug}: ${medians.length} samples over ${WINDOW_S}s — ` +
          `${min.toFixed(3)}–${max.toFixed(3)} px (±${(((max - min) / 2 / ((min + max) / 2)) * 100).toFixed(2)}%), ` +
          `front-facing turnover vs t=0 up to ${(maxTurnover * 100).toFixed(1)}%` +
          (maxTurnover < 0.01
            ? ' — THE MOSAIC DID NOT TURN; the spread above is a still frame sampled N times'
            : ''),
        '\n',
      )
    }
  } finally {
    await browser.close()
    stop()
  }
  writeFileSync(`${OUT}.json`, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nwrote ${OUT}.json`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
