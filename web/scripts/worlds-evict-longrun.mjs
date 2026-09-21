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
 * > **≈1,380–1,415 KiB/s (~1.4 MiB/s), sustained for as long as the page is open** — 1,382 on
 * > DEC-834's 120 s run and 1,413 (converged, second half 1,392) on DEC-835's 150 s re-measurement,
 * > two independent runs. Quote the range, not either endpoint.
 * >
 * > **That figure is a CORRECTION of DEC-833's own 2,518 KiB/s (DEC-834 §5b).** 2,518 reproduces —
 * > it is what a 60 s window differenced *from page load* reads — but ~946 fill bodies are still in
 * > flight at t=0 and land inside it, so it is the page load amortised over the window, not the
 * > steady state. Differenced from the end of the fill instead, the same 120 s run reads 1,382 KiB/s
 * > over t=27→120 s, 1,364 over the last 60 s and 1,368 over the last 30 s — a tail stable to ~1%.
 * > The direction of the finding is untouched (a parked page still streams forever, and PRD 7.2
 * > still does not bound it); the number a ruling would quote is 82% smaller. The summary below now
 * > differences the tail, and labels the whole-window figure as the fill-contaminated one it is.
 * >
 * > **Excluding the fill is necessary and not sufficient, so the tail scores its own convergence.**
 * > The byte rate keeps settling well after the pool holds every layer it will hold: a 60 s baseline
 * > reads 1,461 KiB/s from t=6, 1,460 from t=12, 1,421 from t=24 and 1,382 from t=36 — all with the
 * > same end point. **A 60 s run cannot produce a converged figure and this script now says so
 * > rather than printing one.** Use `--seconds 150` (the default) or longer for a number to quote.
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
 * **Every arm asserts that it took (DEC-834 N3).** The first version of this script *printed*
 * `entered=0` under `--reduced` and asserted nothing — the same shape as the dead `--motion0` arm it
 * was written to replace, and a refactor that stopped the shell listening to the OS preference would
 * have produced another silently passing control. Both arms now fail loudly instead: see
 * `assertControlTook` below.
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

/**
 * Below this many differenced samples the arm is not scored — it is REFUSED. `entered` is null on
 * the first sample (nothing to difference against), so a run short enough to produce one or two rows
 * would satisfy "`entered` was 0 on every sample" by having no samples, which is the vacuity this
 * whole change exists to remove. At the 3 s cadence a 45 s run yields ~14.
 */
const MIN_CONTROL_SAMPLES = 4

/**
 * **The control read-back (DEC-834 N3).** `--reduced` is only a control if the run can be made to
 * FAIL when it does not take, and the first version of this script merely printed `entered=0` —
 * exactly the shape of the dead `--motion0` arm it replaced, where `emulateMediaFeatures` /
 * `?motion=0` was called and nothing ever read back that the scene had frozen.
 *
 * Two independent reads, because either alone is satisfiable by a broken instrument:
 *
 *  - **`entered`** — how many cells the want set newly admitted since the last sample. A frozen
 *    scene admits none. This is the quantity the verdict is about, so it is the one that matters.
 *  - **`multiverseAngle`** — the table's own integrated angle, the direct read-back of the
 *    mechanism. `planeTable.advance` scales the integration by `motion`, which PRD 5.9 pins to 0
 *    under reduced motion, so the angle is frozen *exactly* where it stood: `x + 0` is bit-identical
 *    and `% TAU` of an in-range value is a no-op. That exactness is why this asserts equality and
 *    not a tolerance — a tolerance would pass a scene that had merely slowed.
 *
 * **Both are asserted in BOTH directions, which is the part that stops this fix from becoming its
 * own tautology.** A `multiverseAngle` that had silently become a constant — a probe rewire, a table
 * that stopped being built — would score the `--reduced` arm green forever and no input could red
 * it. So the baseline arm has the matching obligation: the same two reads must MOVE. Three quiet
 * samples in a row is a failed run in whichever arm you are in.
 *
 * Throws on the first offending sample, naming it, so the failure is diagnosable from the last line.
 */
const assertControlTook = (sample, previous, first) => {
  const at = `t=${sample.t.toFixed(1)}s`
  if (reduced) {
    if (sample.entered !== 0) {
      throw new Error(
        `--reduced CONTROL FAILED at ${at}: the want set admitted ${sample.entered} new cells ` +
          `(expected 0). The scene is still moving, so this arm is not a control — check that ` +
          `prefers-reduced-motion still reaches App.tsx's useReducedMotion on this route.`,
      )
    }
    if (sample.multiverseAngle !== first.multiverseAngle) {
      throw new Error(
        `--reduced CONTROL FAILED at ${at}: multiverseAngle moved ` +
          `${first.multiverseAngle} -> ${sample.multiverseAngle}. PRD 5.9 pins the table's motion ` +
          `factor to 0 under reduced motion, so the angle cannot integrate; it did.`,
      )
    }
    return
  }
  if (sample.entered <= 0) {
    throw new Error(
      `BASELINE FAILED at ${at}: the want set admitted 0 new cells over ${(sample.t - previous.t).toFixed(1)}s. ` +
        `dominaria's 262.592 s spin carries ~18 cells/s across the admission boundary, so a quiet ` +
        `sample means the scene is frozen (throttled rAF?) and the --reduced arm's 0 would prove nothing.`,
    )
  }
  if (sample.multiverseAngle === previous.multiverseAngle) {
    throw new Error(
      `BASELINE FAILED at ${at}: multiverseAngle held at ${sample.multiverseAngle}. This read is ` +
        `the --reduced arm's evidence; if it cannot move here it is a constant, not a detector.`,
    )
  }
}

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
    // The table's own integrated angle (`probeSeam.ts:169` -> `planeTable.multiverseAngle`). This is
    // the DIRECT read-back of what `--reduced` is supposed to change, and it is read in the same
    // round trip as the want set so the two cannot disagree about which frame they describe.
    multiverseAngle: window.__eternitiesProbe.state().multiverseAngle,
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
  // NO_COLOR: hosted runners set `CI`, which turns vite's colours on even into a pipe, and the
  // port then arrives wrapped in bold escapes (`localhost:\e[1m4173\e[22m`) the URL match misses.
  env: { ...process.env, ETERNITIES_DATASET: 'worlds', NO_COLOR: '1' },
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
  // The seam answers before the scene is real, with a placeholder that reads as a genuine payload.
  // `programWarmup` is the standing gate on that (`warmup-probe.mjs:92`): until it is non-null the
  // numbers below describe a composition that has not finished coming up.
  await page.waitForFunction(
    () => window.__eternitiesProbe?.state().programWarmup != null,
    { timeout: 60_000 },
  )
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
  // **This line used to be wrong in both directions** (DEC-834 N3's second rider): it took `motionOff`
  // as the arm, so it printed "motion OFF" for `--motion0` — the arm where the seam is inert and the
  // scene is still spinning — and "motion ON" for `--reduced`, the arm where it is genuinely frozen.
  // `reduced` is the flag that changes what the scene does on this route, so it is the one that names
  // the arm; `--motion0` is reported as the inert passenger it is.
  console.log(
    `settled at ${settled.toFixed(4)} radii, motion ${reduced ? 'OFF (prefers-reduced-motion: reduce)' : 'ON'}` +
      `${motionOff ? ' [--motion0 also set: INERT on this route, changes nothing]' : ''}, ` +
      `sampling ${seconds}s\n`,
  )

  const started = Date.now()
  /** The previous sample's want-set membership, so the turnover can be differenced. */
  let prevMembers = null
  let lastBeat = 0
  let x = 5
  const rows = []
  /** Samples the control was actually scored on. See `MIN_CONTROL_SAMPLES`. */
  let scored = 0
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
      const previous = rows[rows.length - 1]
      const row = { t: Number(elapsed.toFixed(1)), entered, left, ...s }
      rows.push(row)
      console.log(
        `  t=${String(row.t).padStart(6)}s radii=${s.radii.toFixed(3)} ` +
          `entered=${String(entered).padStart(4)} left=${String(left).padStart(4)} ` +
          `wanting=${String(s.wanting).padStart(4)} showing=${String(s.showing).padStart(4)} ` +
          `resident=${String(s.resident).padStart(4)}/${s.layers} ` +
          `evict=${String(s.evictions).padStart(6)} req=${String(s.requested).padStart(5)} ` +
          `resolved=${String(s.resolved).padStart(5)} angle=${s.multiverseAngle.toFixed(6)} ` +
          // Per-sample, so the summary's sustained figure can be RE-DERIVED over any window from the
          // log rather than taken on trust. The whole reason that number was wrong for a wave is
          // that it only ever existed as one line nobody could difference a second way.
          `mib=${(s.bytesFetched / 1048576).toFixed(1)}`,
      )
      // The arm asserts it took, on every sample it can difference. `entered` is null on the first,
      // which is why `scored` is counted rather than inferred from `rows.length`.
      if (entered !== null) {
        assertControlTook(row, previous, rows[0])
        scored += 1
      }
    }
    if (elapsed >= seconds) break
    await sleep(3000)
  }

  // **Refuse to report before reporting anything.** "`entered` was 0 on every sample" is true of a
  // run with no samples, so a short or stalled run must not be allowed to print a verdict at all.
  if (scored < MIN_CONTROL_SAMPLES) {
    throw new Error(
      `REFUSING to score: only ${scored} differenced sample(s), need ${MIN_CONTROL_SAMPLES}. ` +
        `The control's assertions are vacuous on a window this short.`,
    )
  }
  const angleSpan = rows[rows.length - 1].multiverseAngle - rows[0].multiverseAngle
  console.log(
    `\n  CONTROL (${reduced ? '--reduced' : 'baseline'}): ${scored} samples asserted — ` +
      (reduced
        ? `want set admitted 0 new cells on every one, multiverseAngle constant at ` +
          `${rows[0].multiverseAngle.toFixed(6)} rad. The arm took.`
        : `want set admitted new cells on every one, multiverseAngle advanced (${rows[0].multiverseAngle.toFixed(6)} ` +
          `-> ${rows[rows.length - 1].multiverseAngle.toFixed(6)} rad, ${angleSpan >= 0 ? '' : 'wrapped, '}` +
          `TAU-modular). Both reads move here, so a 0 under --reduced is evidence.`),
  )

  // The verdict, from the shape of the tail: the rate over the last third against the rate over the
  // first third. A fill decays; churn does not.
  const third = Math.max(1, Math.floor(rows.length / 3))
  const rate = (a, b) => (b.evictions - a.evictions) / (b.t - a.t)
  const early = rate(rows[0], rows[third])
  const late = rate(rows[rows.length - 1 - third], rows[rows.length - 1])
  const total = rows[rows.length - 1].evictions - rows[0].evictions
  // The wire cost, which is what a bound on the eviction rate is really defending. Differenced, not
  // session-cumulative — but differencing from the FIRST row is not enough, and calling that figure
  // "sustained" is what produced DEC-833's 2,518 KiB/s (DEC-834 §5b). ~946 fill bodies are still in
  // flight when sampling opens and land inside the window, so a from-t0 rate is the page load
  // amortised over the run. It is reported, and labelled as the contaminated figure it is.
  const bytes = rows[rows.length - 1].bytesFetched - rows[0].bytesFetched
  const span = rows[rows.length - 1].t - rows[0].t
  console.log(
    `  WHOLE WINDOW (includes the fill — NOT the sustained cost): ` +
      `${(bytes / 1024 / 1024).toFixed(1)} MiB over ${span.toFixed(1)}s = ${(bytes / span / 1024).toFixed(0)} KiB/s`,
  )
  // **The fill ends when the pool PLATEAUS, not when `resident` stops climbing.** "Stops climbing"
  // is the obvious detector and it is wrong here: a saturated pool churns, so `resident` ticks
  // 1023 -> 1024 -> 1023 forever and the last upward tick lands in the final seconds. Measured on a
  // 60 s baseline it put the fill's end at t=57.1 s and left a 2-row, 3.0 s "steady state" — one
  // sample dressed as a rate, which is the same class of error as the label it replaced.
  //
  // The plateau is what the fill is really about: the first sample at which the pool holds every
  // layer it is ever going to hold. That is `max(resident)` — 1024 saturated with motion on, and 967
  // under `--reduced`, where the pool never saturates at all and the plateau is set by demand.
  const peakResident = Math.max(...rows.map((r) => r.resident))
  const fillEnd = rows.findIndex((r) => r.resident === peakResident)
  const tail = rows.slice(fillEnd)
  // A rate needs a window. Below this the fill and the steady state are not separable in this run,
  // and the honest thing is to report no sustained figure rather than a noisy one — mislabelling
  // this number is the defect being fixed, so a too-short window must not produce one.
  const MIN_TAIL_ROWS = 5
  if (tail.length < MIN_TAIL_ROWS) {
    console.log(
      `  STEADY STATE: UNAVAILABLE — the pool only plateaued at t=${rows[fillEnd].t}s, leaving ` +
        `${tail.length} row(s). Re-run with a longer --seconds; the whole-window figure above is ` +
        `the fill and must not be quoted as sustained.`,
    )
  } else {
    const over = (w) => {
      const bytes = w[w.length - 1].bytesFetched - w[0].bytesFetched
      const span = w[w.length - 1].t - w[0].t
      return { kib: bytes / span / 1024, mib: bytes / 1024 / 1024, span, asked: w[w.length - 1].requested - w[0].requested }
    }
    const whole = over(tail)
    // **The tail has to be shown to have CONVERGED, not just to start after the fill.** Excluding the
    // fill is necessary and it is not sufficient: measured on a 60 s baseline, the same run reads
    // 1,461 KiB/s from t=6, 1,460 from t=12, 1,445 from t=18, 1,421 from t=24 and 1,382 from t=36 —
    // a monotone 5.4% decline, because the byte rate keeps settling long after the pool has every
    // layer it will hold. Quoting the t=12 figure as "sustained" would be the same error as quoting
    // the whole window, one order smaller. So the tail is scored against its own second half, and a
    // run that has not settled reports that instead of a number.
    const half = over(tail.slice(Math.floor(tail.length / 2)))
    // A relative drift is undefined at zero, and zero is the `--reduced` arm's whole point: it
    // streams nothing at all once the want set is satisfied, so `0/0` would report the one arm that
    // HAS converged as unconverged. Two zeros agree exactly.
    const drift =
      whole.kib === 0 ? (half.kib === 0 ? 0 : 1) : Math.abs(half.kib - whole.kib) / whole.kib
    const TAIL_CONVERGENCE = 0.02
    console.log(
      `  STEADY STATE (pool plateaued at ${peakResident} layers, t=${rows[fillEnd].t}s; ${tail.length} rows): ` +
        `${whole.mib.toFixed(1)} MiB over ${whole.span.toFixed(1)}s = ${whole.kib.toFixed(0)} KiB/s, ` +
        `${whole.asked} requests = ${(whole.asked / whole.span).toFixed(2)}/s`,
    )
    console.log(
      drift <= TAIL_CONVERGENCE
        ? `  -> CONVERGED: the tail's own second half reads ${half.kib.toFixed(0)} KiB/s ` +
          `(${(drift * 100).toFixed(1)}% off). ${whole.kib.toFixed(0)} KiB/s is the sustained cost.`
        : `  -> NOT CONVERGED: the tail's second half reads ${half.kib.toFixed(0)} KiB/s, ` +
          `${(drift * 100).toFixed(1)}% off the ${whole.kib.toFixed(0)} above — the byte rate is still ` +
          `settling. Do NOT quote either as sustained; re-run with a longer --seconds.`,
    )
  }
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
