/**
 * Does the worlds art fraction converge, and what is it bounded by? (DEC-772, spec §1.6, §3.1.)
 *
 * Leg G's positive control read **73%** showing art under `?layers=128` after a 20 s settle and
 * asked which of two things that number is: the policy's converged ceiling, or an artefact of how
 * many images 20 s at six concurrent requests can fetch. The two have opposite consequences —
 * DEC-770's note N1 and leg G's expected-GREEN gate row both turn on it — and the difference is
 * only visible in **time**, so this samples one pose repeatedly rather than reading it once.
 *
 * The distinguishing shape:
 *
 *  - **fetch-rate** — `showing` still climbing when the run ends, `pool.resident` below `layers`,
 *    and the curve's slope roughly `IMAGE_CONCURRENCY` images per round trip.
 *  - **capacity** — `showing` flat at `~layers` while `wanting` sits *above* it. §1.6's quantile
 *    picks a *bucket edge*, not an exact quantile, so the admitted set overshoots the pool by up to
 *    a bucket and the overshoot can never be resident at once. A pool that is full and a want set
 *    that is larger is a ceiling no amount of waiting moves.
 *  - **churn** — `evictions` climbing after the pool is full: the two above, fighting.
 *
 * Every row carries the pose it was taken at (`radii`) and the capacity it was taken under
 * (`pool.layers`), because neither is a constant of the criterion and a count without them is a
 * reading of the harness.
 *
 * Run: `node scripts/worlds-art-convergence.mjs [--dataset worlds] [--seconds 120]`
 * Requires a built `dist/` for the same dataset: `ETERNITIES_DATASET=worlds pnpm build`.
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
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

/** §3.1's pinned capture size (DEC-758). Every threshold in §1.5/§1.6 is CSS px at this size. */
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }

/** The world §3.1 states W4 against, and the one leg G measured. */
const WORLD = 'dominaria'

/**
 * The pose §3.1 states W4 at.
 *
 * **It is not where the product arrives.** `Framing.plane` frames a plane at `r * 3.2` and lets the
 * dolly run between `r * 1.4` and `r * 8`, so `focusPlane` settles at exactly **3.200 radii** and
 * 2.2 is a place the user zooms *to*. At 3.2 radii no cell of Dominaria clears §1.6's 24 px floor
 * at 1920x1080 — DEC-771 measured 30.13 px at 2.2, which scales to ~20.7 px at 3.2 — so W4's
 * denominator is empty there and a run that accepted the arrival pose would be measuring nothing.
 * This harness therefore drives the shipped wheel input to the named distance and asserts it,
 * rather than reading a criterion off wherever a flight happened to stop (leg G's `ea78d54`).
 */
const TARGET_RADII = 2.2

/** `attachRig`'s `ZOOM_PER_NOTCH`. `zoomBy(exp(deltaY * k))` is a hard set, so one notch suffices. */
const ZOOM_PER_NOTCH = 0.0016

/**
 * `?motion=0` is on every row, and it is not a convenience.
 *
 * PRD 5.9 disables **attract mode** under reduced motion, and without it the first run of this
 * script recorded a pose that was not one: `focusPlane` settled at 1.813 radii, the idle timer then
 * entered attract, and the camera receded monotonically to 6.7 radii over the next 110 s. Every
 * sample after the first was therefore a different criterion, and `wanting` fell to zero not
 * because the policy stopped admitting but because the world had shrunk below §1.6's 24 px floor.
 * It also shortens the flight to `REDUCED_MOTION_DURATION_MS`, so less of the byte budget is spent
 * flying *through* poses on the way to the one being measured.
 */
const CONFIGURATIONS = [
  { name: 'shipped policy', query: '?probe=1&motion=0' },
  { name: '?layers=128', query: '?probe=1&motion=0&layers=128' },
  { name: '?artThreshold=fixed24', query: '?probe=1&motion=0&artThreshold=fixed24' },
  // The pairing, and the only one in which W4's control can be red *for the art reason*. Fixing the
  // threshold at 24 px changes nothing unless the adaptive quantile would have risen above 24, and
  // it only rises when the admitted set would outrun the pool — so the control needs a pool small
  // enough to be outrun. Alone, `?artThreshold=fixed24` against a 1,024-layer pool is inert.
  { name: '?layers=128&artThreshold=fixed24', query: '?probe=1&motion=0&layers=128&artThreshold=fixed24' },
]

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error(`no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  return found
}

function parseArgs(argv) {
  const args = { dataset: 'worlds', seconds: 120, every: 4 }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    if (key && key in args) args[key] = key === 'dataset' ? argv[i + 1] : Number(argv[i + 1])
  }
  return args
}

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
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

const sleep = (ms) => new Promise((wake) => setTimeout(wake, ms))

/**
 * Bytes the page has taken off `cards.scryfall.io`, summed from the responses themselves.
 *
 * §1.6's per-session byte budget is the one refusal that does **not** appear in the `?probe=`
 * payload — `ArtStreamReport.swatchOnly` is computed and never published — so a session that has
 * stopped asking because it spent its budget is indistinguishable, from the payload alone, from one
 * whose threshold is admitting nothing. This is the outside measurement that tells them apart.
 *
 * **Not the Resource Timing API**, which was the first attempt and read a flat `0.0 MiB` for the
 * whole run: `encodedBodySize` and `transferSize` are zeroed for a cross-origin response without
 * `Timing-Allow-Origin`, and Scryfall does not send one. A zero that means "not allowed to tell
 * you" is indistinguishable from a zero that means "nothing was fetched", which is the shape of
 * failure this whole leg is about. `content-length` off the response is the honest reading.
 */
function trackBytes(page) {
  const seen = { count: 0, bytes: 0 }
  const onResponse = (response) => {
    if (!response.url().startsWith('https://cards.scryfall.io/')) return
    seen.count += 1
    seen.bytes += Number(response.headers()['content-length'] ?? 0)
  }
  page.on('response', onResponse)
  return { seen, stop: () => page.off('response', onResponse) }
}

/**
 * Hold until the fly-to has landed, so what follows is a pose and not a pass through one.
 *
 * PRD 6.2's flight is over a second long and this run's first reading was taken at **78.9 radii**
 * while the camera was still at the multiverse; sampling through a flight makes every row a
 * different criterion. Settled means `radii` unchanged to 1e-3 across two reads a second apart —
 * the world still spins under the camera, but the *distance* is what every threshold is stated in.
 */
async function settlePose(page, world, timeoutS = 90) {
  const recent = []
  for (let waited = 0; waited < timeoutS; waited += 1) {
    await sleep(1000)
    const sample = await page.evaluate(READ, world)
    const radii = sample && !sample.wrongWorld ? sample.radii : Number.POSITIVE_INFINITY
    recent.push(radii)
    if (recent.length > 3) recent.shift()
    // **Three** consecutive readings, not two. A fly-to that overshoots and comes back passes
    // through a stationary point, and a two-sample test accepted that turning point as the pose —
    // which is how the first run of this script "settled" at 1.813 radii mid-flight.
    if (recent.length === 3 && recent.every((r) => Number.isFinite(r) && Math.abs(r - recent[0]) < 1e-3)) {
      return recent[0]
    }
  }
  throw new Error(`the camera never settled over ${world}`)
}

/**
 * Zoom to `target` radii through the **shipped wheel path** — `attachRig`'s listener, `rig.zoomBy`,
 * the tether's own clamp — and prove the camera got there.
 *
 * Not a camera setter: there is none on the probe seam, and inventing one would be a second way to
 * pose the camera that the product does not have. `zoomBy` is a hard set rather than a spring, so
 * the notch that gets from here to there is `ln(target / here) / ZOOM_PER_NOTCH`; it is iterated
 * anyway, because the tether clamps and a target outside `[1.4r, 8r]` must be visible as a failure
 * to arrive rather than as a silently different pose.
 */
async function dollyTo(page, world, target) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const sample = await page.evaluate(READ, world)
    const radii = sample && !sample.wrongWorld ? sample.radii : null
    if (radii === null) throw new Error(`no payload for ${world} while zooming`)
    if (Math.abs(radii - target) < 0.005) return radii
    await page.mouse.wheel({ deltaY: Math.log(target / radii) / ZOOM_PER_NOTCH })
    await sleep(250)
  }
  const final = await page.evaluate(READ, world)
  throw new Error(
    `the camera would not reach ${target} radii; it stopped at ${final?.radii?.toFixed(3)} ` +
      '(the tether clamps a plane to [1.4r, 8r])',
  )
}

/**
 * One reading of the served payload, reduced to W4's terms.
 *
 * **The denominator is the visible admitted set**, not every cell: §3.1's W4 scores the cells the
 * renderer asked art for, and a back-facing or off-screen cell is not demand (`worldSurface`'s own
 * admission). Counting them would put a world's far hemisphere in the denominator of a criterion
 * about what the frame shows.
 */
const READ = (world) => {
  const probe = window.__eternitiesProbe
  const payload = probe?.worlds?.()
  if (!payload) return null
  if (payload.planeSlug !== world) return { wrongWorld: payload.planeSlug }
  const wanting = payload.cells.filter((c) => c.frontFacing && c.onScreen && c.wantsArt)
  const showing = wanting.filter((c) => c.showingArt)
  return {
    planeSlug: payload.planeSlug,
    radii: payload.radii,
    cells: payload.cells.length,
    wanting: wanting.length,
    showing: showing.length,
    artFraction: wanting.length === 0 ? 0 : showing.length / wanting.length,
    layers: payload.pool.layers,
    resident: payload.pool.resident,
    evictions: payload.pool.evictions,
    effectiveThresholdPx: payload.pool.effectiveThresholdPx,
    viewport: payload.viewport,
    seams: payload.seams,
  }
}

async function measure(page, base, configuration, seconds, every) {
  const tracker = trackBytes(page)

  await page.goto(`${base}/${configuration.query}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 30_000 })
  const focused = await page.evaluate((slug) => window.__eternitiesProbe.focusPlane(slug), WORLD)
  if (!focused) throw new Error(`focusPlane(${WORLD}) was refused`)
  // The clock starts at the pose, not at the click. Everything before this is a flight.
  const arrivedAt = await settlePose(page, WORLD)
  const settledAt = await dollyTo(page, WORLD, TARGET_RADII)
  // What getting here cost, so the budget spent *at the pose* can be told from the budget spent
  // reaching it. A fly-through admits cells at every distance it passes.
  const flight = { count: tracker.seen.count, bytes: tracker.seen.bytes }

  const samples = []
  const started = Date.now()
  for (;;) {
    const elapsed = (Date.now() - started) / 1000
    const sample = await page.evaluate(READ, WORLD)
    if (sample && !sample.wrongWorld) {
      samples.push({
        t: Number(elapsed.toFixed(1)),
        fetched: tracker.seen.count,
        bytes: tracker.seen.bytes,
        ...sample,
      })
    }
    if (elapsed >= seconds) break
    await sleep(every * 1000)
  }

  tracker.stop()
  return {
    configuration: configuration.name,
    query: configuration.query,
    arrivedAt,
    settledAt,
    flight,
    samples,
  }
}

/**
 * The verdict, from the shape of the tail rather than from its last value.
 *
 * "Converged" is `showing` unchanged across the last third of the run; a run that is still climbing
 * there has not converged whatever its final number is, and saying so is the point of the exercise.
 */
function verdictOf(samples) {
  if (samples.length < 3) return { verdict: 'too few samples' }
  const tail = samples.slice(-Math.max(3, Math.ceil(samples.length / 3)))
  const showings = tail.map((s) => s.showing)
  const spread = Math.max(...showings) - Math.min(...showings)
  const last = samples[samples.length - 1]
  const full = last.resident >= last.layers
  const overshoot = last.wanting - last.layers
  const climbing = showings[showings.length - 1] > showings[0]
  return {
    verdict: climbing
      ? 'still climbing — fetch-rate limited at this run length'
      : full && overshoot > 0
        ? 'converged, bounded by POOL CAPACITY (the admitted set overshoots the pool)'
        : 'converged',
    tailSpread: spread,
    poolFull: full,
    wantingOverPool: overshoot,
    ceilingIfCapacity: last.wanting === 0 ? null : Number((last.layers / last.wanting).toFixed(4)),
  }
}

const args = parseArgs(process.argv.slice(2))
const { url, stop } = await startPreview(args.dataset)
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  ],
})

const runs = []
const errors = []
try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200))
  })

  for (const configuration of CONFIGURATIONS) {
    process.stderr.write(`\n=== ${configuration.name} (${configuration.query}) ===\n`)
    const run = await measure(page, url, configuration, args.seconds, args.every)
    run.verdict = verdictOf(run.samples)
    runs.push(run)
    process.stderr.write(
      `  focusPlane arrived at ${run.arrivedAt.toFixed(3)} radii; zoomed to ` +
        `${run.settledAt.toFixed(3)}; getting here cost ${run.flight.count} fetches / ` +
        `${(run.flight.bytes / 1048576).toFixed(1)} MiB\n`,
    )
    for (const s of run.samples) {
      process.stderr.write(
        `  t=${String(s.t).padStart(5)}s radii=${s.radii.toFixed(3)} ` +
          `wanting=${String(s.wanting).padStart(5)} showing=${String(s.showing).padStart(5)} ` +
          `art=${(s.artFraction * 100).toFixed(1).padStart(5)}% ` +
          `resident=${String(s.resident).padStart(5)}/${s.layers} ` +
          `evict=${String(s.evictions).padStart(5)} thr=${s.effectiveThresholdPx.toFixed(2)} ` +
          `fetched=${String(s.fetched).padStart(5)} ` +
          `MiB=${(s.bytes / 1048576).toFixed(1).padStart(6)}\n`,
      )
    }
    process.stderr.write(`  -> ${run.verdict.verdict}\n`)
  }
  errors.push(...consoleErrors)
} finally {
  await browser.close()
  stop()
}

const out = resolve(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? '/tmp', 'worlds-art-convergence.json')
writeFileSync(out, JSON.stringify({ viewport: VIEWPORT, world: WORLD, runs, errors }, null, 2))
process.stderr.write(`\nwrote ${out}\n`)
if (errors.length > 0) process.stderr.write(`console errors: ${errors.length}\n`)
