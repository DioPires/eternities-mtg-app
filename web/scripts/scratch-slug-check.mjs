/**
 * Scratch. Throwaway — never commit.
 *
 * One question: on the shipped build, does `worlds(slug)` report the world asked for where the bare
 * `worlds()` does not? That is DEC-785's fix and the premise of leg G's slug threading, and it is
 * worth one independent reading that does not depend on the gate's own machinery.
 *
 * Flies to a handful of worlds chosen because the pre-fix tour misattributed them (segovia,
 * muraganda, karsus, fiora, edge, bloomburrow) plus the three that agreed (gobakhan, innistrad,
 * ravnica), and prints both readings side by side. The bare column is expected to disagree — that
 * disagreement is the defect, still present by design on the no-arg path — and the slug column is
 * expected to agree on every row.
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
].filter(Boolean).find((p) => existsSync(p))

const SUBJECTS = [
  'segovia', 'muraganda', 'karsus', 'fiora', 'edge', 'bloomburrow',
  'gobakhan', 'innistrad', 'ravnica',
]

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: 'worlds' },
  })
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('preview did not start')), 60_000)
    child.stdout.on('data', (b) => {
      const m = /(http:\/\/[^\s]+)/.exec(String(b))
      if (m) { clearTimeout(timer); ok({ url: m[1].replace(/\/$/, ''), stop: () => child.kill() }) }
    })
    child.stderr.on('data', (b) => process.stderr.write(b))
  })
}

const { url, stop } = await startPreview()
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-swiftshader',
    '--window-size=1920,1080'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.goto(`${url}/?probe=shell`, { waitUntil: 'networkidle2', timeout: 120_000 })

  // Wait for the probe and a composed roster.
  for (let i = 0; i < 120; i += 1) {
    const ready = await page.evaluate(() => window.__eternitiesProbe?.worlds?.() !== undefined)
    if (ready) break
    await sleep(1000)
  }

  console.log('focused          bare worlds()     worlds(slug)      agree?')
  let bareMismatch = 0
  let slugMismatch = 0
  for (const slug of SUBJECTS) {
    const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
    if (!ok) { console.log(`${slug.padEnd(16)} focusPlane REFUSED`); continue }
    for (let i = 0; i < 90; i += 1) {
      const st = await page.evaluate(() => window.__eternitiesProbe.state())
      if (st && st.planeSlug === slug && !st.flying) break
      // PRD 5.3.22's attract timer: a bare move cancels it without touching the rig.
      await page.mouse.move(960 + (i % 2), 540)
      await sleep(500)
    }
    await sleep(1500)
    const pair = await page.evaluate((s) => {
      const p = window.__eternitiesProbe
      const bare = p.worlds()
      const named = p.worlds(s)
      return {
        bare: bare === undefined ? 'undefined' : bare.planeSlug,
        named: named === undefined ? 'undefined' : named.planeSlug,
      }
    }, slug)
    if (pair.bare !== slug) bareMismatch += 1
    if (pair.named !== slug) slugMismatch += 1
    console.log(
      `${slug.padEnd(16)} ${pair.bare.padEnd(17)} ${pair.named.padEnd(17)} ` +
      `${pair.named === slug ? 'yes' : 'NO'}`,
    )
  }
  console.log(`\nbare mismatches: ${bareMismatch}/${SUBJECTS.length}  (the defect, still on the no-arg path by design)`)
  console.log(`slug mismatches: ${slugMismatch}/${SUBJECTS.length}  (must be 0)`)
} finally {
  await browser.close()
  stop()
}
