/**
 * Does linking every program at boot actually take the stalls off the navigations? (DEC-739.)
 *
 * DEC-645 measured 322 ms and 362 ms of frozen main thread from three's synchronous
 * `getProgramInfoLog` on a program's first draw, on Metal, uncapped. Review §3.7 expects the effect
 * to be markedly larger on Windows, where every browser compiles through ANGLE's D3D11/FXC path,
 * and names the two moments it lands in: the first plane focus and the first card focus.
 *
 * This drives the app's own `?probe=1` seam through exactly those two moments, twice — once with
 * the boot-time warm-up on and once with `?warmup=0` — and reports the worst frame in each. The
 * comparison is the evidence; a single run with the warm-up on proves nothing, because a fast
 * number is also what a machine with no stalls to remove produces.
 *
 *   node scripts/warmup-probe.mjs [--url http://localhost:4173] [--runs 3]
 *
 * Serve a built `dist/` first (`npm run build && npm run preview`). The dataset is baked into
 * `index.html` at build time, so `--url` selects the deployment, not the data.
 */

import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}

const URL_BASE = option('url', 'http://localhost:4173')
const RUNS = Number(option('runs', '3'))
/** How long the positive control blocks the main thread for. See its use in `once`. */
const CONTROL_MS = 300

/**
 * A rAF sampler installed before the app boots.
 *
 * The frame *interval* is the only instrument available from inside the page for a stall of this
 * kind: a synchronous `getProgramInfoLog` blocks the main thread, so the rAF that would have run
 * during it simply arrives late. `performance.now()` around the focus call would miss it entirely —
 * the link happens on the next frame's draw, not inside the call.
 */
const SAMPLER = `
window.__frameSamples = []
;(function sample(previous) {
  requestAnimationFrame((now) => {
    if (previous) window.__frameSamples.push(now - previous)
    sample(now)
  })
})(0)
window.__mark = (label) => { window.__marks = window.__marks || {}; window.__marks[label] = window.__frameSamples.length }
`

/** Poll a page predicate from Node. See the CSP note at the call site. */
async function poll(page, predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await page.evaluate(predicate)) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await page.waitForTimeout(250)
  }
}

/** The worst frame interval between two marks, in milliseconds. */
function worstBetween(samples, from, to) {
  const slice = samples.slice(from, to)
  return slice.length === 0 ? 0 : Math.max(...slice)
}

async function once(browser, warmup) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.addInitScript(SAMPLER)
  // `motion=1` holds reduced motion off so the two runs draw the same thing; `warmup=0` is the
  // only difference between them.
  const url = `${URL_BASE}/?probe=1&motion=1${warmup ? '' : '&warmup=0'}`
  await page.goto(url, { waitUntil: 'load' })

  // The field has to be complete before anything is focused, or the first plane focus would be
  // measuring the stream rather than a compile.
  //
  // Polled from Node rather than through `page.waitForFunction`, and that is not a style choice:
  // this app serves `script-src 'self'` with no `'unsafe-eval'`, and `waitForFunction` installs a
  // polling *script* in the page, which the CSP blocks — it times out with an empty log and looks
  // exactly like an app that never booted (DEC-667). `page.evaluate` goes through CDP's
  // `Runtime.evaluate` and is unaffected.
  await poll(page, () => document.body.innerText.includes('(complete)'), 120_000, 'field complete')

  // With the warm-up on, wait for it — that is the whole point of the run. Without it, there is
  // nothing to wait for and the intro's four seconds pass either way, so both runs reach the
  // focuses at the same point in the app's life.
  if (warmup) {
    await poll(
      page,
      () => window.__eternitiesProbe?.state().programWarmup != null,
      30_000,
      'program warm-up',
    )
  }
  const warmupResult = await page.evaluate(
    () => window.__eternitiesProbe.state().programWarmup,
  )
  await page.waitForTimeout(4000)

  const platform = await page.evaluate(() => window.__eternitiesProbe.state().platform)

  // First plane focus — review §3.7's first named hitch.
  await page.evaluate(() => window.__mark('beforePlane'))
  const slug = await page.evaluate(() => {
    const planes = window.__eternitiesProbe.planes()
    const target = planes.find((plane) => plane.cardCount > 500) ?? planes[0]
    window.__eternitiesProbe.focusPlane(target.slug)
    return target.slug
  })
  await page.waitForTimeout(3000)

  /*
   * **Positive control.** Before believing a small number, make the instrument report a large one.
   *
   * A frame-interval sampler that reported 16.8 ms through a 300 ms stall and 16.8 ms through a
   * clean run would be indistinguishable from a perfect result, and the second of those is what
   * this script is hoping to measure. So it blocks the main thread for a known duration and checks
   * the sampler notices — the same argument as `confirm the instrument sees the defect`.
   */
  await page.evaluate(() => window.__mark('beforeControl'))
  await page.evaluate((ms) => {
    const until = performance.now() + ms
    while (performance.now() < until) {
      /* deliberately spinning: this is the control */
    }
  }, CONTROL_MS)
  await page.waitForTimeout(1000)

  // First card focus — the second, and the one that reaches the planet programs.
  await page.evaluate(() => window.__mark('beforeCard'))
  const starIndex = await page.evaluate(() => window.__eternitiesProbe.focusCard({ nth: 0 }))
  await page.waitForTimeout(3000)
  await page.evaluate(() => window.__mark('end'))

  const { samples, marks } = await page.evaluate(() => ({
    samples: window.__frameSamples,
    marks: window.__marks,
  }))
  await page.close()

  return {
    warmupResult,
    platform,
    slug,
    starIndex,
    worstPlaneFocusMs: worstBetween(samples, marks.beforePlane, marks.beforeControl),
    controlMs: worstBetween(samples, marks.beforeControl, marks.beforeCard),
    worstCardFocusMs: worstBetween(samples, marks.beforeCard, marks.end),
    worstOverallMs: Math.max(...samples),
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  // ANGLE Metal is what Chrome and Brave use on this Mac; pinning it keeps the run comparable with
  // every other measurement in this repo.
  args: ['--use-angle=metal'],
})

const rows = []
for (let run = 0; run < RUNS; run += 1) {
  for (const warmup of [true, false]) {
    const result = await once(browser, warmup)
    rows.push({ run, warmup, ...result })
    console.log(
      `run ${run} warmup=${warmup ? 'on ' : 'off'}  ` +
        `plane ${result.worstPlaneFocusMs.toFixed(1)} ms  ` +
        `card ${result.worstCardFocusMs.toFixed(1)} ms  ` +
        `control ${result.controlMs.toFixed(1)} ms  ` +
        `worst ${result.worstOverallMs.toFixed(1)} ms` +
        (result.warmupResult
          ? `  (${result.warmupResult.specs} programs in ` +
            `${result.warmupResult.durationMs.toFixed(1)} ms, ` +
            `parallel=${result.warmupResult.parallel})`
          : ''),
    )
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
for (const warmup of [true, false]) {
  const set = rows.filter((row) => row.warmup === warmup)
  console.log(
    `\nwarmup=${warmup ? 'on' : 'off'}  median worst plane-focus frame ` +
      `${median(set.map((r) => r.worstPlaneFocusMs)).toFixed(1)} ms, ` +
      `card-focus frame ${median(set.map((r) => r.worstCardFocusMs)).toFixed(1)} ms`,
  )
}
console.log('\nplatform:', JSON.stringify(rows[0].platform, null, 2))

await browser.close()
