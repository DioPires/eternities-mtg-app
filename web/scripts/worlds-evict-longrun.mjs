/**
 * Does dominaria's eviction rate decay? Extend the gate's 3 s observation to 150 s and watch.
 *
 * **Result (DEC-752): it does not — 2,523 evictions over 150 s at the 2.2-radii pose, early rate
 * 15.03/s against a late rate of 17.63/s. The rate *rose*.** `artFraction` sits at ~99.7%
 * throughout, so none of this is visible in the frame, which is why only W4's eviction half catches
 * it.
 *
 * > **CORRECTION (DEC-833). The cause DEC-752 named is wrong, because its control was dead.**
 * >
 * > DEC-752 read the flat `--motion0` arm as "motion is not the cause" and concluded the stream
 * > "never stops requesting cells the pool already holds". **`?motion=0` is inert on this route.**
 * > `scene/motionOverride.ts`'s own header records it: the seam is laid over `?probe=1`, `/bench`
 * > and `?selfcheck`, and "the shell deliberately does not [read it], so a query string cannot
 * > change what a user sees". This script pins `?probe=shell` — the shell — whose `App.tsx`
 * > resolves reduced motion from `useReducedMotion()`: the settings toggle and the OS preference,
 * > never the query string. So both DEC-752 arms ran the **same build**, which is why they agreed to
 * > two decimal places. That is a control that never took, not evidence about motion.
 * >
 * > `--reduced` is the arm that does take — it emulates the OS preference, which is the input the
 * > shell reads. Measured on `fec45c9` at the same pose, 45 s: **`requested` flat at 1,151, want-set
 * > turnover 0 cells/sample, `evictions` 0, `resident` 967/1,024, `showing == wanting == 967`.**
 * > The stream stops dead the moment the want set is satisfied.
 * >
 * > So the baseline's ~17.7 req/s is **the world's spin carrying new cells across the admission
 * > boundary**, one fetch each — the want set turns over at ~18 cells/s (`entered`, below) against
 * > an eviction rate of 17.8–18.5/s, and over 60 s 1,689 of 1,946 distinct keys were asked for
 * > exactly once, none more than three times. Eviction rate == admission rate == turnover rate, on a
 * > saturated pool, which is the floor for a 1,024-layer cache over a 6,271-card world that rotates.
 * > The standing unit guard on that property is `worlds-art-fetch.test.ts`'s
 * > "§1.6 a satisfied want set stops asking (DEC-833)".
 * >
 * > What the baseline arm does cost, and what a bound on the eviction rate is really defending:
 * > **147.8 MiB over 60.1 s = 2,518 KiB/s, sustained for as long as the page is open.**
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
 * Run: `node scripts/worlds-evict-longrun.mjs [--seconds 150] [--reduced] [--motion0]`
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
/**
 * DEC-752's control arm. **Kept only so the dead control stays reproducible** — see the CORRECTION
 * in the header. It sets a query string this route does not read, so it changes nothing.
 */
const motionOff = process.argv.includes('--motion0')
/**
 * The control that actually takes on this route — see the CORRECTION in the header.
 *
 * `?motion=0` is **inert under `?probe=shell`**. `motionOverride`'s own header says so — the seam is
 * laid over `?probe=1`, `/bench` and `?selfcheck`, and "the shell deliberately does not [read it],
 * so a query string cannot change what a user sees". `?probe=shell` keeps the app shell, whose
 * `App.tsx` resolves reduced motion from `useReducedMotion()` — settings plus the OS preference, and
 * no query string. So DEC-752's `--motion0` arm re-ran the SAME build, which is why it agreed to two
 * decimal places; that is a dead control, not evidence that motion is not the cause.
 *
 * This arm emulates the OS preference instead, which is the input the shell actually reads.
 */
const reduced = process.argv.includes('--reduced')

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
    // The MEMBERSHIP of the want set, not just its size. The size is flat at ~942 in every arm; what
    // separates a frozen scene from a spinning one is WHICH cells are in it.
    members: wanting.map((c) => c.cell),
    showing: wanting.filter((c) => c.showingArt).length,
    layers: payload.pool.layers,
    resident: payload.pool.resident,
    evictions: payload.pool.evictions,
    requested: payload.stream?.requested ?? null,
    resolved: payload.stream?.resolved ?? null,
    bytesFetched: payload.stream?.bytesFetched ?? null,
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
  // The OS preference, which is the input `App.tsx`'s `useReducedMotion` actually reads.
  // Set BEFORE `goto`, so the first composition already has it.
  if (reduced) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  }
  // `probe=shell` is the GATE's composition. `probe=1` would redirect to the harness scene route
  // (`harnessRoute.ts:67`) and measure a different build, which is the confound this run exists to
  // remove. Motion is on unless the control arm asked for it off.
  const query = `?probe=shell${motionOff ? '&motion=0' : ''}`
  console.log(
    `composition ${query} (gate parity: probe=shell), ?motion=0 ${motionOff ? 'SET (INERT on this route)' : 'unset'}, ` +
      `prefers-reduced-motion ${reduced ? 'REDUCE (the control that takes)' : 'no-preference'}`,
  )
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
  /** The previous sample's want-set membership, so the turnover can be differenced. */
  let prevMembers = null
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
      // How much of the want set turned over since the last sample — the demand the stream serves.
      const now = new Set(s.members)
      const entered = prevMembers === null ? null : [...now].filter((c) => !prevMembers.has(c)).length
      const left = prevMembers === null ? null : [...prevMembers].filter((c) => !now.has(c)).length
      prevMembers = now
      delete s.members
      rows.push({ t: Number(elapsed.toFixed(1)), entered, left, ...s })
      console.log(
        `  t=${String(rows[rows.length - 1].t).padStart(6)}s radii=${s.radii.toFixed(3)} ` +
          `entered=${String(entered).padStart(4)} left=${String(left).padStart(4)} ` +
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
  // The sustained wire cost of the steady state, which is what a bound on the eviction rate is
  // really defending. Differenced, not session-cumulative.
  const bytes = rows[rows.length - 1].bytesFetched - rows[0].bytesFetched
  const span = rows[rows.length - 1].t - rows[0].t
  console.log(
    `  streamed ${(bytes / 1024 / 1024).toFixed(1)} MiB over ${span.toFixed(1)}s = ` +
      `${(bytes / span / 1024).toFixed(0)} KiB/s sustained`,
  )
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

  // The demand side, differenced. `requested` is the number the verdict above is really about: a
  // stream that re-asked for what it holds would run far ahead of the want set's turnover, and one
  // that asks once per newly admitted cell tracks it.
  const asked = rows[rows.length - 1].requested - rows[0].requested
  const turnover = rows.slice(1).reduce((sum, r) => sum + r.entered, 0)
  console.log(
    `  requested +${asked} over ${span.toFixed(1)}s = ${(asked / span).toFixed(2)}/s, ` +
      `against a want-set turnover of ${turnover} cells = ${(turnover / span).toFixed(2)}/s`,
  )
} finally {
  await browser.close()
  preview.kill('SIGTERM')
}
