/**
 * Does `radii` hold on a settled, motionless rig? (DEC-804; spec §3.1; PRD 5.7.1, 5.9.)
 *
 * The browser half of DEC-804's acceptance. `worlds-centre.test.ts` proves the scene consumes PRD
 * 5.7.1's law, deterministically and in milliseconds — but it poses the camera by hand. The claim
 * this script makes is the one leg G's gate actually depends on and no unit test can reach: fly the
 * **product's** camera to a world with `flyToPlane`, let it settle, take your hands off, and the
 * pose the spec names is still the pose you are at 17.5 seconds later.
 *
 * ## What it prints, and what each column is for
 *
 * | column | why it is here |
 * |---|---|
 * | `radii` | the criterion. §3.1 states W1 and W4 at a pose, in these units |
 * | `cameraDistance` | the rig's own distance to its tether. **Constant means the camera did not move** — without it a drifting `radii` is indistinguishable from a camera that wandered |
 * | `multiverseAngle` | the renderer's azimuth (DEC-785 F2). The x-axis of the defect |
 * | `recomputed` | `\|cameraPosition − centre\| / radius` from the payload's own exposed terms (DEC-804 ask 3). Must equal `radii` |
 * | `level` / `focus` / `flying` | the attract-mode guard — see below |
 *
 * ## Three traps this script is written against
 *
 *  1. **Attract mode (PRD 5.3.22) makes every long sample a different criterion.** Left alone under
 *     normal motion the camera can enter attract and recede monotonically — DEC-772 measured 1.8 →
 *     6.7 radii over 110 s — which looks exactly like this defect and is not. Every row carries
 *     `level`, `focus` and `flying`, and a hold in which any of them leaves the settled state is
 *     reported as a **fault**, not as a measurement.
 *  2. **A two-sample settle accepts an overshooting flight's turning point** (DEC-772). The settle
 *     below requires **three** consecutive `cameraDistance` readings within 1e-3 *and* `flying`
 *     false, which is what makes "the rig is motionless" a fact rather than a hope.
 *  3. **A preview server on a busy port serves another leg's `dist/`.** `--port 0` lets the OS
 *     choose, so there is nothing to squat; and the page's own `meta[name="eternities:data"]` is
 *     asserted against the dataset this tree built, because a printed identity that cannot fail is
 *     not a check.
 *
 * ## The frozen control
 *
 * The same worlds under `prefers-reduced-motion: reduce`, which PRD 5.9 makes freeze the multiverse.
 * It is a **negative** control and it is expected identical on the fixed and the unfixed tree: with
 * the angle frozen, PRD 5.7.1's `planePosition` *is* `plane.home` and the defect cannot express
 * itself. That is precisely why it is worth printing — it is the regime in which this bug is
 * invisible, and most of this repo's worlds instrumentation runs in it.
 *
 * Run: `ETERNITIES_DATASET=worlds pnpm build && node scripts/worlds-centre-hold.mjs`
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/** §3.1's pinned capture size (DEC-758). */
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }

/**
 * The two worlds DEC-804 was measured on.
 *
 * The error scales with `|home| / radius`, so `azgol` (2 cards, radius 0.55, `|home|` 94.56) is the
 * envelope at a ratio of 172 against `dominaria`'s 11. A hold that passed on `dominaria` alone would
 * have been taken at 6% of the exposure.
 */
const SUBJECTS = ['dominaria', 'azgol']

/** Leg G's hold and its sample interval, so these tables sit beside the ones in the defect doc. */
const HOLD_SECONDS = 17.5
const SAMPLE_SECONDS = 2.5

/** §3.1's tolerance on the pose, and this leg's acceptance criterion. */
const RADII_TOLERANCE = 0.02

/** `Framing.plane`'s `frame: r * 3.2` — where a settled flight lands, exactly. */
const FRAME_RADII = 3.2

const sleep = (ms) => new Promise((wake) => setTimeout(wake, ms))

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(`no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  }
  return found
}

/** The dataset hash this tree's `dist/` was built against — the identity the page must report. */
function builtDataset() {
  const roles = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  return roles[process.env.ETERNITIES_DATASET ?? 'worlds']
}

/**
 * A preview server on an **OS-assigned** port.
 *
 * `--port 0` rather than a chosen one: `playwright.config.ts` sets `reuseExistingServer`, and a
 * harness that picks a port can silently drive whatever is already listening on it (DEC-796 measured
 * exactly that — a branch run reporting main's dataset, three times, confidently).
 */
async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    // NO_COLOR: hosted runners set `CI`, which turns vite's colours on even into a pipe, and the
    // port then arrives wrapped in bold escapes (`localhost:\e[1m4173\e[22m`) the URL match misses.
    env: { ...process.env, ETERNITIES_DATASET: dataset, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => process.stderr.write(`  [vite] ${chunk}`))
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
  return { url, stop: () => child.kill() }
}

/**
 * One reading, taken through the shipped seam.
 *
 * `worlds(slug)` and not the no-argument call: with no slug the payload describes whichever world is
 * nearest in units of **its own** radius, which names the focused world for 3 of 45 (DEC-785 F1).
 * `planeSlug` is checked against what was asked for, because the misattribution is silent.
 */
const READ = (slug) => {
  const probe = window.__eternitiesProbe
  if (!probe) return { fault: 'no probe seam' }
  const state = probe.state()
  const worlds = probe.worlds(slug)
  if (!worlds) return { fault: `worlds(${slug}) is undefined` }
  if (worlds.planeSlug !== slug) return { fault: `asked ${slug}, got ${worlds.planeSlug}` }
  const [cx, cy, cz] = worlds.centre
  const [ex, ey, ez] = worlds.cameraPosition
  const recomputed =
    worlds.radius > 0
      ? Math.hypot(ex - cx, ey - cy, ez - cz) / worlds.radius
      : 0
  return {
    radii: worlds.radii,
    recomputed,
    radius: worlds.radius,
    centre: worlds.centre,
    cameraDistance: state.cameraDistance,
    multiverseAngle: state.multiverseAngle,
    level: state.level,
    focus: state.focus,
    flying: state.flying,
    cells: worlds.cells.length,
  }
}

/**
 * Fly to `slug` and wait until the rig is genuinely still.
 *
 * Three consecutive `cameraDistance` readings within 1e-3 **and** `flying` false. Two is not enough:
 * an overshooting flight's turning point holds still for one sample pair, and DEC-772 recorded a
 * "settle" at 1.813 radii that was mid-flight.
 */
async function settle(page, slug) {
  const flew = await page.evaluate((s) => window.__eternitiesProbe?.focusPlane(s) ?? false, slug)
  if (!flew) throw new Error(`focusPlane(${slug}) refused`)
  const recent = []
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(250)
    const reading = await page.evaluate(READ, slug)
    if (reading.fault) continue
    recent.push(reading)
    if (recent.length > 3) recent.shift()
    if (recent.length === 3 && !reading.flying) {
      const spread =
        Math.max(...recent.map((r) => r.cameraDistance)) -
        Math.min(...recent.map((r) => r.cameraDistance))
      if (spread < 1e-3) return reading
    }
  }
  throw new Error(`${slug} never settled`)
}

async function hold(page, slug) {
  const settled = await settle(page, slug)
  const rows = [{ t: 0, ...settled }]
  const samples = Math.round(HOLD_SECONDS / SAMPLE_SECONDS)
  for (let i = 1; i <= samples; i += 1) {
    await sleep(SAMPLE_SECONDS * 1000)
    const reading = await page.evaluate(READ, slug)
    if (reading.fault) throw new Error(`${slug} at t=${i * SAMPLE_SECONDS}: ${reading.fault}`)
    rows.push({ t: i * SAMPLE_SECONDS, ...reading })
  }
  return rows
}

function report(title, rows) {
  const radii = rows.map((r) => r.radii)
  const spread = Math.max(...radii) - Math.min(...radii)
  console.log(`\n### ${title}`)
  console.log('| t (s) | radii | cameraDistance | multiverseAngle | recomputed | level/focus/flying |')
  console.log('|---|---|---|---|---|---|')
  for (const r of rows) {
    console.log(
      `| ${r.t.toFixed(1)} | ${r.radii.toFixed(4)} | ${r.cameraDistance.toFixed(4)} | ` +
        `${r.multiverseAngle.toFixed(5)} | ${r.recomputed.toFixed(4)} | ` +
        `${r.level}/${r.focus}/${r.flying} | `,
    )
  }

  // The attract guard. A hold that changed level, focus or entered flight is not a hold, and
  // reporting its spread as a measurement is how PRD 5.3.22 gets mistaken for this defect.
  const first = rows[0]
  const drifted = rows.filter(
    (r) => r.level !== first.level || r.focus !== first.focus || r.flying,
  )
  const arithmetic = Math.max(...rows.map((r) => Math.abs(r.radii - r.recomputed)))

  console.log(`spread ${spread.toFixed(4)} radii over ${HOLD_SECONDS}s (tolerance ${RADII_TOLERANCE})`)
  console.log(`payload arithmetic: max |radii - recomputed| = ${arithmetic.toExponential(2)}`)
  if (drifted.length > 0) console.log(`FAULT: attract/flight changed state on ${drifted.length} rows`)
  return { spread, arithmetic, faulted: drifted.length > 0 }
}

async function main() {
  const dataset = process.env.ETERNITIES_DATASET ?? 'worlds'
  const expectedData = builtDataset()
  if (!existsSync(resolve(WEB_ROOT, 'dist/index.html'))) {
    throw new Error(`no dist/. Run: ETERNITIES_DATASET=${dataset} pnpm build`)
  }

  const preview = await startPreview(dataset)
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  })

  const results = []
  try {
    for (const frozen of [false, true]) {
      const page = await browser.newPage()
      await page.setViewport(VIEWPORT)
      if (frozen) {
        // PRD 5.9's own signal — `app/hooks.ts` reads exactly this media query — rather than the
        // `?motion=0` URL seam, so the control is the one the acceptance criterion names.
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
      }
      await page.goto(`${preview.url}/?probe=1`, { waitUntil: 'networkidle2', timeout: 120_000 })

      // **The served identity, asserted rather than printed.** A harness that logs which tree it
      // measured and carries on is a harness that can report another leg's dist as this one's.
      const served = await page.evaluate(
        () => document.querySelector('meta[name="eternities:data"]')?.getAttribute('content') ?? '',
      )
      if (!served.includes(expectedData)) {
        throw new Error(`served ${served}, this tree built ${expectedData}`)
      }

      await page.waitForFunction(() => Boolean(window.__eternitiesProbe), { timeout: 60_000 })

      for (const slug of SUBJECTS) {
        const rows = await hold(page, slug)
        const summary = report(
          `${slug} — ${frozen ? 'FROZEN CONTROL (prefers-reduced-motion: reduce)' : 'normal motion'}`,
          rows,
        )
        results.push({ slug, frozen, ...summary, settledRadii: rows[0].radii })
      }
      await page.close()
    }
  } finally {
    await browser.close()
    preview.stop()
  }

  console.log('\n## Verdict\n')
  let ok = true
  for (const r of results) {
    const within = r.spread <= RADII_TOLERANCE && !r.faulted && r.arithmetic < 1e-4
    // The frozen rows carry the extra claim §3.1 rests on: the settle is `r * 3.2` exactly, so any
    // number this spec recorded "at the settle" can be re-derived rather than re-measured.
    const framed = !r.frozen || Math.abs(r.settledRadii - FRAME_RADII) < 1e-3
    ok = ok && within && framed
    console.log(
      `${within && framed ? 'PASS' : 'FAIL'}  ${r.slug} ${r.frozen ? 'frozen' : 'normal'} — ` +
        `spread ${r.spread.toFixed(4)}, settle ${r.settledRadii.toFixed(4)}` +
        (r.frozen ? ` (framing law ${FRAME_RADII})` : ''),
    )
  }
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
