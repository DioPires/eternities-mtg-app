/**
 * Does dominaria's eviction rate decay? Extend the gate's 3 s observation to 150 s and watch.
 *
 * **Result (DEC-752): it does not, and the W4 eviction red is real.** 2,523 evictions over 150 s at
 * the 2.2-radii pose, early rate 15.03/s against a late rate of 17.63/s — the rate *rose*. The
 * control arm with motion frozen reads 2,521, so **motion is not the cause.** What is: in the
 * shipped composition the art stream **never stops requesting**. `requested` climbs 1,153 -> 3,816
 * across the run, ~17.7/s, which is the eviction rate to two figures. The pool is doing correct LRU
 * on a full pool; the demand side keeps asking for cells it already holds.
 *
 * `artFraction` sits at ~99.7% throughout, so **none of this is visible in the frame** — which is
 * exactly why only W4's eviction half catches it.
 *
 * **Why this exists when `worlds-art-convergence.mjs` already samples the same counter.** That one
 * asks for `?probe=1`, and `harnessRoute.ts:67` redirects anything that is neither `shell` nor `0`
 * to the **harness scene route**; the gate asks for `?probe=shell`, which `probe.ts:315` documents
 * as the same seam *inside the shipped composition*. On the harness route `requested` stops at 972,
 * `resident` settles at 972/1024 and evictions stay at **0 for 150 s**. So the convergence probe's
 * reassuring "converged" verdict describes a build the user never sees, and the difference between
 * 0 and 2,500 evictions is the **composition**, not motion. This script holds `?probe=shell` fixed
 * across both arms so the only variable against the gate is observation length.
 *
 * Prediction, recorded before the run so the result discriminates rather than explains after it:
 *   - bounded fill  -> cumulative evictions asymptote near `requested - layers` (~254) and the rate
 *                      decays toward 0 well inside 150 s.
 *   - sustained churn -> the counter climbs ~linearly at ~18/s, reaching thousands.
 *
 * It came out on the churn side, by an order of magnitude.
 *
 * **Attract mode is the trap this has to dodge.** PRD 5.3.22 arms a 45 s idle timer that flies the
 * camera; PRD 5.9 disables it under reduced motion, which is exactly why the convergence probe sets
 * `?motion=0`. With motion on, the run must generate input or everything after ~45 s is taken at no
 * pose at all. PRD 5.3.23 cancels attract on any input and a bare pointermove is not a drag, so the
 * rig is untouched. The radii are asserted every sample as the detector: if attract fires anyway,
 * the camera recedes and the run fails loudly rather than reporting churn it did not measure.
 *
 * Run: `node scripts/worlds-evict-longrun.mjs [--seconds 150] [--motion0]`
 * Requires a built `dist/` for the worlds dataset; it starts its own `vite preview --port 0`.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }
const WORLD = 'dominaria'
const TARGET_RADII = 2.2

/** Well inside PRD 5.3.22's 45 s idle timer, so attract is never armed. */
const HEARTBEAT_S = 15
/** The pose the gate asserts to, and the tolerance it asserts with. */
const RADII_TOLERANCE = 0.05

const seconds = Number(process.argv[process.argv.indexOf('--seconds') + 1]) || 150
/** The control arm. Same composition, motion frozen — so motion is the only thing that changed. */
const motionOff = process.argv.includes('--motion0')

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find((p) => existsSync(p))
if (!CHROME) throw new Error('no Chrome found; set CHROME_PATH')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const READ = (world) => {
  const payload = window.__eternitiesProbe?.worlds?.()
  if (!payload) return null
  if (payload.planeSlug !== world) return { wrongWorld: payload.planeSlug }
  const wanting = payload.cells.filter((c) => c.frontFacing && c.onScreen && c.wantsArt)
  return {
    radii: payload.radii,
    wanting: wanting.length,
    showing: wanting.filter((c) => c.showingArt).length,
    layers: payload.pool.layers,
    resident: payload.pool.resident,
    evictions: payload.pool.evictions,
    requested: payload.stream?.requested ?? null,
    resolved: payload.stream?.resolved ?? null,
  }
}

const preview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
  cwd: WEB_ROOT,
  env: { ...process.env, ETERNITIES_DATASET: 'worlds' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
preview.stdout.setEncoding('utf8')
const base = await new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error('preview never printed a URL')), 60_000)
  preview.stdout.on('data', (chunk) => {
    const m = /(http:\/\/localhost:\d+)/.exec(chunk)
    if (m) {
      clearTimeout(timer)
      res(m[1])
    }
  })
})

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
})

try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  // `probe=shell` is the GATE's composition. `probe=1` would redirect to the harness scene route
  // (`harnessRoute.ts:67`) and measure a different build, which is the confound this run exists to
  // remove. Motion is on unless the control arm asked for it off.
  const query = `?probe=shell${motionOff ? '&motion=0' : ''}`
  console.log(`composition ${query} (gate parity: probe=shell), motion ${motionOff ? 'OFF' : 'ON'}`)
  await page.goto(`${base}/${query}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 30_000 })
  if (!(await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), WORLD))) {
    throw new Error(`focusPlane(${WORLD}) refused`)
  }

  // Settle, then dolly to the pose §3.1 names.
  for (let i = 0; i < 80; i += 1) {
    const s = await page.evaluate(READ, WORLD)
    if (s && !s.wrongWorld && !(await page.evaluate(() => window.__eternitiesProbe.state().flying))) break
    await sleep(250)
  }
  // **The pointer has to be over the canvas, and the zoom constant has to be measured, not assumed.**
  // Both are why the first version of this script never reached the pose under `?probe=shell`: that
  // route keeps the app shell, so a wheel at the default pointer position does not reach the scene,
  // and the multiplicative wheel's notch size is a property of the rig. This is `driveToRadii`'s
  // method from `worlds-gate.mjs` — probe one notch, solve for k, refine — so the pose this run
  // reports is reached the same way the gate reaches it.
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!box) throw new Error('no canvas to point at')
  await page.mouse.move(box.x, box.y)

  const radii = async () => {
    const s = await page.evaluate(READ, WORLD)
    if (!s || s.wrongWorld) throw new Error('lost the world while zooming')
    return s.radii
  }
  const notch = async (deltaY) => {
    await page.mouse.wheel({ deltaY })
    await sleep(400)
    return radii()
  }

  let current = await radii()
  let k = null
  for (const probe of [current > TARGET_RADII ? -60 : 60, current > TARGET_RADII ? 60 : -60]) {
    const before = current
    current = await notch(probe)
    if (Math.abs(current - TARGET_RADII) <= 0.02) break
    if (Math.abs(Math.log(current / before)) < 1e-6) continue // against a tether clamp that way
    k = Math.log(current / before) / probe
    break
  }
  for (let i = 0; i < 6 && k !== null && Math.abs(current - TARGET_RADII) > 0.02; i += 1) {
    const before = current
    current = await notch(Math.log(TARGET_RADII / before) / k)
    if (Math.abs(Math.log(current / before)) < 1e-6) break
  }
  if (Math.abs(current - TARGET_RADII) > 0.02) {
    throw new Error(`camera stopped at ${current.toFixed(3)} radii, not ${TARGET_RADII}`)
  }
  const settled = current
  // The arm is `query`'s to state, not this line's — a hardcoded "motion ON" here printed over the
  // control arm's own label and would have read as a failed control rather than a reporting bug.
  console.log(
    `settled at ${settled.toFixed(4)} radii, motion ${motionOff ? 'OFF' : 'ON'}, sampling ${seconds}s\n`,
  )

  const started = Date.now()
  let lastBeat = 0
  let x = 5
  const rows = []
  for (;;) {
    const elapsed = (Date.now() - started) / 1000
    // The attract heartbeat. A bare move, never a drag: no button, and the position barely changes.
    if (elapsed - lastBeat >= HEARTBEAT_S) {
      x = x === 0 ? 1 : 0
      await page.mouse.move(box.x + x, box.y)
      lastBeat = elapsed
    }
    const s = await page.evaluate(READ, WORLD)
    if (s && !s.wrongWorld) {
      // Attract's signature is the camera receding. Fail loudly rather than reporting a rate taken
      // at a pose the criterion does not name.
      if (Math.abs(s.radii - TARGET_RADII) > RADII_TOLERANCE) {
        throw new Error(
          `pose lost at t=${elapsed.toFixed(1)}s: radii ${s.radii.toFixed(3)} (attract mode?)`,
        )
      }
      rows.push({ t: Number(elapsed.toFixed(1)), ...s })
      console.log(
        `  t=${String(rows[rows.length - 1].t).padStart(6)}s radii=${s.radii.toFixed(3)} ` +
          `wanting=${String(s.wanting).padStart(4)} showing=${String(s.showing).padStart(4)} ` +
          `resident=${String(s.resident).padStart(4)}/${s.layers} ` +
          `evict=${String(s.evictions).padStart(6)} req=${String(s.requested).padStart(5)} ` +
          `resolved=${String(s.resolved).padStart(5)}`,
      )
    }
    if (elapsed >= seconds) break
    await sleep(3000)
  }

  // The verdict, from the shape of the tail: the rate over the last third against the rate over the
  // first third. A fill decays; churn does not.
  const third = Math.max(1, Math.floor(rows.length / 3))
  const rate = (a, b) => (b.evictions - a.evictions) / (b.t - a.t)
  const early = rate(rows[0], rows[third])
  const late = rate(rows[rows.length - 1 - third], rows[rows.length - 1])
  const total = rows[rows.length - 1].evictions - rows[0].evictions
  console.log(
    `\n  early rate ${early.toFixed(2)}/s   late rate ${late.toFixed(2)}/s   ` +
      `cumulative ${total} over ${rows[rows.length - 1].t}s`,
  )
  console.log(
    late < 1
      ? '  -> DECAYED: a bounded fill transient, not churn'
      : late > early * 0.5
        ? '  -> SUSTAINED: the rate did not decay — churn, driven by the rotating want set'
        : '  -> DECAYING but not settled within the run',
  )
} finally {
  await browser.close()
  preview.kill('SIGTERM')
}
