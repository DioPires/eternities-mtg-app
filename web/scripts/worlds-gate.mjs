/**
 * The worlds acceptance gate — spec §3.1's W1–W5 and its negative-control matrix.
 *
 * `visual-gate.mjs` answers PRD 9.3 for the galaxy. This answers §3.1 for worlds, and it replaces
 * rather than joins it: T7 retires at the cutover (§3.2) and this file is what the runbook points at
 * from then on.
 *
 * **The division of labour is deliberate and is the whole reason this file is thin.** Every
 * criterion, floor, domain rule and control-row check lives in `lib/worlds-metrics.mjs`, every read
 * of the payload in `lib/worlds-probe-read.mjs`, every pixel in `lib/png-sample.mjs` — all three
 * pure, all three unit-tested against constructed inputs. This file only *drives*: it starts a
 * preview, poses a camera, takes a frame, and hands the pair to the pure layer. A criterion
 * implemented here would be a criterion with no test, and §3.1's own history is the argument — the
 * measures that went wrong went wrong in arithmetic nobody could run twice.
 *
 * What the gate reads is **normative renderer surface owned by leg R1** (DEC-744 B1 / DEC-746 D5):
 * the `?probe=` payload and the four control seams. This file consumes them and may not patch the
 * build to get them. A seam that is missing is an R1 defect routed through the CEO, which is why
 * every seam here is asserted to have *engaged* before the row that depends on it is scored — see
 * `seamEvidence`, and §2 of `docs/worlds/gate-seam-contract.md`.
 *
 * Run:
 *   node scripts/worlds-gate.mjs                       # the full acceptance run
 *   node scripts/worlds-gate.mjs --negative-controls   # §3.1's matrix
 *   node scripts/worlds-gate.mjs --only baseline       # one row
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

import { decodePng } from './lib/png-sample.mjs'
import {
  FLOORS,
  W5_MIN_AZIMUTHS,
  azimuthSpacingFault,
  checkControlRow,
  evaluateW1,
  evaluateW2,
  evaluateW3,
  evaluateW4,
  evaluateW5,
  homeLabelCeiling,
  isLabelVisible,
  rowCellsFaults,
} from './lib/worlds-metrics.mjs'
import {
  artCells,
  cellCardinality,
  cellSamples,
  readWorldsProbe,
  seamEvidence,
} from './lib/worlds-probe-read.mjs'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

/**
 * The gate's viewport: 1920×1080 CSS at dpr 1 (§3.1's closing paragraph).
 *
 * `deviceScaleFactor` is 1 and not 1.5, unlike `visual-gate.mjs`. Colour is sampled out of the
 * captured PNG at the probe's CSS-pixel coordinates, so any other scale puts every W2 and W3 sample
 * on the wrong pixel unless the reader rescales — `cellSamples` takes a `scale` for exactly that,
 * and the safest scale is the one that is 1. It is also DEC-683's rule: true CSS scale, never an
 * upscaled crop, and the native resolution of the Iris Xe laptop review §9 targets.
 */
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }

/** §3.1's surface view. W4 is specified here, and W2/W3 are sampled on the same frame. */
const SURFACE_RADII = 2.2

/** How close to a named pose the driver must get before it will read a threshold-dependent number. */
const RADII_TOLERANCE = 0.02

/** §3.1: W4 is read "after a 5 s settle", and its eviction half is a rate over the last 2 s. */
const W4_SETTLE_S = 5
const W4_SAMPLE_S = 3

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

// ---------------------------------------------------------------------------------------------
// The roster, derived — never a literal
// ---------------------------------------------------------------------------------------------

/**
 * The two sets §3.1 names, read off `planes.json` under test.
 *
 * Hard-coding either is the defect §3.1 spends a page on: the spec's own prediction of the next
 * dataset was off by 15 worlds, so a gate pinned at 29 — or re-pinned at 30 — goes RED against a
 * correct renderer the moment the data lands, and the failure reads as a renderer regression.
 */
function readRoster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = registry.fixtures?.[dataset] ?? registry[dataset] ?? dataset
  const root = resolve(WEB_ROOT, 'public/data', hash)
  const planes = JSON.parse(readFileSync(resolve(root, 'planes.json'), 'utf8')).planes
  const worldsWithCards = planes.filter((p) => p.kind !== 'dust' && p.cardCount > 0)
  const planesWithCards = planes.filter((p) => p.cardCount > 0)
  return {
    hash,
    planes,
    worldsWithCards,
    planesWithCards,
    cardCountOf: new Map(planes.map((p) => [p.slug, p.cardCount])),
    /** What `evaluateW5` and `homeLabelCeiling` take. `labellableBelts` is 0 by construction. */
    metricsRoster: { worlds: worldsWithCards.length, labellableBelts: 0 },
  }
}

// ---------------------------------------------------------------------------------------------
// The preview server
// ---------------------------------------------------------------------------------------------

const TAIL_LIMIT = 4000

/** Lifted from `visual-gate.mjs`, including its reason for draining stderr: a server that dies
 *  mid-run makes the next step's failure look like that step's defect. */
async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let tail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    tail = (tail + chunk).slice(-TAIL_LIMIT)
  })

  let started = false
  let stopping = false
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const match = /(http:\/\/localhost:\d+)/.exec(chunk)
      if (match) {
        clearTimeout(timer)
        started = true
        ok(match[1])
      }
    })
    child.on('exit', (code, signal) => {
      if (started) return
      clearTimeout(timer)
      fail(new Error(`vite preview exited with ${code}${signal ? ` (${signal})` : ''}`))
    })
  })

  child.on('exit', (code, signal) => {
    if (stopping) return
    console.error(
      `\n  vite preview exited mid-run (code ${code}${signal ? `, signal ${signal}` : ''}). ` +
        `Everything after this is talking to a dead server.` +
        (tail.length > 0 ? `\n  Its last output:\n  ${tail.trimEnd().replace(/\n/g, '\n  ')}` : ''),
    )
  })

  return { url, stop: () => ((stopping = true), child.kill('SIGTERM')) }
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error(`no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  return found
}

// ---------------------------------------------------------------------------------------------
// The page, driven
// ---------------------------------------------------------------------------------------------

const probeState = (page) => page.evaluate(() => window.__eternitiesProbe?.state?.() ?? null)

/** The raw worlds payload, or `undefined`. Read raw: `readWorldsProbe` owns every judgement of it. */
const rawWorlds = (page) =>
  page.evaluate(() => {
    const probe = window.__eternitiesProbe
    if (probe === undefined || typeof probe.worlds !== 'function') return { missing: true }
    const payload = probe.worlds()
    return payload === undefined ? { missing: true } : { missing: false, payload }
  })

/**
 * PRD 5.3.23's cheapest input, and the reason every long loop here carries one.
 *
 * PRD 5.3.22 arms a 45 s idle timer that flies the camera and fades the labels. A run that sits
 * still — a 45-world tour, an azimuth sweep — drifts into attract mode and every number after that
 * is taken at no pose at all: an earlier scratch of this measurement read "2 labels visible" and a
 * rig still moving at +50 s, and both were the attract flight rather than the home view. A bare
 * `pointermove` cancels it and re-arms the timer, and unlike `pointerdown` it is not the start of a
 * drag, so the rig is untouched.
 */
const heartbeat = (page) =>
  page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  })

/** Wait `frames` animation frames, so what is captured is what the page has finished drawing. */
const settleFrames = (page, frames) =>
  page.evaluate(
    (n) =>
      new Promise((ok) => {
        let left = n
        const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : ok(undefined))
        requestAnimationFrame(tick)
      }),
    frames,
  )

/** Sleep, holding attract off. Any wait longer than a few seconds must go through this. */
async function hold(page, seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    await heartbeat(page)
    await sleep(Math.min(5000, Math.max(0, deadline - Date.now())))
  }
}

/**
 * Every plane label, as the gate reads it back off the DOM.
 *
 * `opacity` and not node presence: `layout.ts` gives *every* candidate a placement and signals the
 * drop through opacity alone, so `querySelectorAll('.label').length` is a constant for every
 * renderer and W5 read literally would fail forever (§3.1). `isLabelVisible` owns the predicate.
 *
 * `data-plane-slug` is R3's readback seam (seam contract §2a) and is the only thing that answers
 * *which* world a label belongs to. Matching the display text back to a slug is not a substitute —
 * it inverts a mapping the gate does not own — so a label without the attribute is counted as
 * visible and reported as unresolved, never guessed at.
 */
const readLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.label')].map((node) => ({
      slug: node.getAttribute('data-plane-slug'),
      opacity: Number(getComputedStyle(node).opacity),
    })),
  )

/**
 * The scene's `multiverseAngle`, or `null` where the build does not publish it.
 *
 * **W5's sweep parameter, and the gate may not compute it.** `motion.ts:247` rotates every plane by
 * this angle every tick; `planeTable.advance` moves it by `(TAU / MULTIVERSE_PERIOD_S) · motion · dt`.
 * A gate that derived the azimuth from its own wall clock would be asserting against its own model
 * of the rotation rather than against the shipped one, and `azimuthSpacingFault` — whose whole job
 * is to reject a badly spaced sweep — would then be checking the gate's arithmetic against itself.
 *
 * The failure is not hypothetical and it is silent in the dangerous direction:
 * `starScene.ts:332` passes `reducedMotion ? 0 : 1`, so under reduced motion the angle **never
 * advances**. A wall-clock sweep would report twelve evenly-spaced azimuths taken of a scene frozen
 * at exactly one, and reachability would collapse into the single-frame coverage count it exists to
 * replace while still reading as the stronger claim — §3.1's named degeneracy, reached by the
 * harness instead of by a short sweep.
 */
const readAzimuth = (page) =>
  page.evaluate(() => {
    const state = window.__eternitiesProbe?.state?.()
    return typeof state?.multiverseAngle === 'number' ? state.multiverseAngle : null
  })

async function waitForProbe(page, describe, predicate, timeout = 90_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const state = await probeState(page)
    if (state !== null && predicate(state)) return state
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${(timeout / 1000).toFixed(0)}s waiting for ${describe}` +
          (state === null
            ? ' (the probe is not installed on this page)'
            : ` — last: ${state.level}${state.planeSlug ? ` ${state.planeSlug}` : ''}, ` +
              `${state.flying ? 'flying' : 'idle'}, d ${state.cameraDistance?.toFixed?.(1)}`),
      )
    }
    await heartbeat(page)
    await sleep(250)
  }
}

/** The centre of the largest canvas, in CSS pixels. */
const canvasCentre = (page) =>
  page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0]
    const r = canvas.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })

/**
 * Drive the camera to `radii` and return what it actually reached.
 *
 * **§3.1 requires this rather than accepting wherever `focusPlane` settles.** The settle lands at
 * `radii ≈ 2.14`, ~3% nearer than the 2.2 the criteria name, which makes every cell ~3% taller —
 * enough to cross one bucket edge of §1.6's quantile and move the reported effective threshold.
 * A number specified "at 2.2 radii" and in fact taken at 2.14 is a number taken at a pose the spec
 * does not name, so the driver drives, and the caller asserts before it reads.
 *
 * The wheel's sign is not assumed: the first notch is a probe of which way `radii` moved.
 */
async function driveToRadii(page, target, { maxNotches = 60 } = {}) {
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)
  for (let i = 0; i < maxNotches; i += 1) {
    const before = await poseOf(page)
    if (before === null) return null
    if (Math.abs(before.radii - target) <= RADII_TOLERANCE) return before.radii
    await page.mouse.wheel({ deltaY: before.radii > target ? -120 : 120 })
    await sleep(400)
    const after = await poseOf(page)
    if (after === null) return null
    // A notch that did not move the pose at all means the rig is at a clamp, not that the loop
    // needs more of them. Stop and let the caller fail the assertion with the real number.
    if (Math.abs(after.radii - before.radii) < 1e-4) return after.radii
  }
  const final = await poseOf(page)
  return final?.radii ?? null
}

const poseOf = (page) =>
  page.evaluate(() => {
    const payload = window.__eternitiesProbe?.worlds?.()
    return payload === undefined || payload === null
      ? null
      : { slug: payload.planeSlug, radii: payload.radii, cells: payload.cells.length }
  })

/** Fly to a plane through the product's own handler, then wait for the rig and the sheet. */
async function flyToPlane(page, slug) {
  const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
  if (!ok) throw new Error(`focusPlane(${slug}) was refused`)
  await waitForProbe(page, `the rig to settle on ${slug}`, (s) => s.planeSlug === slug && !s.flying)
}

// ---------------------------------------------------------------------------------------------
// Reading one frame: the payload and the pixels, together
// ---------------------------------------------------------------------------------------------

/**
 * A validated payload, or a described setup failure.
 *
 * `undefined` and a malformed payload are different verdicts and neither is a red criterion —
 * §3.1's rule, and the reason `readWorldsProbe` returns a reason rather than throwing. Collapsing
 * "the probe is not installed" into "the criterion failed" lets a page with no worlds on it score a
 * green matrix, which is the `verify-browser --dataset all` shape of failure.
 */
async function readProbe(page) {
  const raw = await rawWorlds(page)
  if (raw.missing) {
    return {
      ok: false,
      reason: 'absent',
      detail: 'window.__eternitiesProbe.worlds() returned undefined — no world is composed on this page',
    }
  }
  return readWorldsProbe(raw.payload, { expectedViewport: { width: VIEWPORT.width, height: VIEWPORT.height } })
}

/**
 * The frame and the payload it belongs to.
 *
 * Taken payload-first-and-last around a single screenshot so a payload assembled from a *different*
 * frame than the pixels cannot pass unnoticed: `height === rect.height` is checked by the reader,
 * but the pose is checked here. W2 pairs a per-cell `shade` from the payload against a colour
 * sampled from the capture, so the two have to be readings of the same moment.
 */
async function captureFrame(page, dir, name) {
  await settleFrames(page, 2)
  const before = await readProbe(page)
  if (!before.ok) return { ok: false, ...before }
  const png = await page.screenshot({ path: dir === null ? undefined : resolve(dir, `${name}.png`) })
  const after = await readProbe(page)
  if (!after.ok) return { ok: false, ...after }
  if (Math.abs(after.probe.radii - before.probe.radii) > 1e-3 || after.probe.planeSlug !== before.probe.planeSlug) {
    return {
      ok: false,
      reason: 'moved',
      detail:
        `the rig moved across the capture: ${before.probe.planeSlug} at ${before.probe.radii.toFixed(3)} ` +
        `before, ${after.probe.planeSlug} at ${after.probe.radii.toFixed(3)} after`,
    }
  }
  return { ok: true, probe: after.probe, image: decodePng(Buffer.from(png)), checked: after.checked }
}

// ---------------------------------------------------------------------------------------------
// Folding per-plane criteria into a roster verdict
// ---------------------------------------------------------------------------------------------

/**
 * Fold one criterion measured on many planes into the criterion for the roster.
 *
 * W1 aggregates itself — its verdict is the worst plane, and `evaluateW1` takes every plane at
 * once. W2, W3 and W4 are per-plane, and §3.1 is explicit that they must stay that way: "a whole-
 * multiverse aggregate quietly averaging over them" is exactly what cannot catch a single
 * degenerate world. So the fold is a worst-case over planes and never a mean, and `insufficient`
 * is carried rather than counted as a pass — an `n/a` that is invisible is how a gate comes to
 * measure nothing while printing green.
 */
function foldCriteria(perPlane) {
  const measured = perPlane.filter((entry) => entry.criterion !== null)
  if (measured.length === 0) return null
  const first = measured[0].criterion
  const keys = first.measures.map((m) => m.key)
  const measures = keys.map((key) => {
    const all = measured
      .map((entry) => ({ slug: entry.slug, measure: entry.criterion.measures.find((m) => m.key === key) }))
      .filter((entry) => entry.measure !== undefined)
    const real = all.filter((entry) => entry.measure.status !== 'insufficient' && entry.measure.value !== null)
    const template = all[0].measure
    if (real.length === 0) {
      return {
        ...template,
        value: null,
        status: 'insufficient',
        pass: false,
        insufficientReason: `every plane was out of domain (${all.length} planes)`,
        worstPlane: null,
        insufficientPlanes: all.length,
      }
    }
    // "Worst" is the direction the floor binds in: the smallest value under a `min` bound, the
    // largest under a `max` one. A fold that took the mean would let 44 comfortable worlds carry
    // one failing world over the line.
    const worst = real.reduce((a, b) =>
      template.direction === 'min' ? (b.measure.value < a.measure.value ? b : a) : b.measure.value > a.measure.value ? b : a,
    )
    const failed = real.filter((entry) => entry.measure.status === 'fail')
    return {
      ...worst.measure,
      status: failed.length > 0 ? 'fail' : 'pass',
      pass: failed.length === 0,
      worstPlane: worst.slug,
      failingPlanes: failed.map((entry) => entry.slug),
      insufficientPlanes: all.length - real.length,
    }
  })
  const status = measures.some((m) => m.status === 'fail')
    ? 'fail'
    : measures.every((m) => m.status === 'insufficient')
      ? 'insufficient'
      : 'pass'
  return { id: first.id, title: first.title, measures, status, pass: status === 'pass' }
}

// ---------------------------------------------------------------------------------------------
// The per-world visit — W1 at the settle, W2/W3/W4 at the surface pose
// ---------------------------------------------------------------------------------------------

/**
 * One world, measured at the two poses §3.1 names.
 *
 * W1 is "at the plane-level settle"; W4 is "at the surface view (2.2× radius), after a 5 s settle";
 * W2 and W3 are sampled on W4's frame, because that is the frame whose pixels are captured and
 * because pairing `shade` with a colour requires both to come from one moment.
 */
async function visitWorld(page, world, { dir, captures, pose = SURFACE_RADII }) {
  const slug = world.slug
  await flyToPlane(page, slug)
  await hold(page, 2)

  // ---- the settle ------------------------------------------------------------------------------
  // W1 is specified "at the plane-level settle", so the settle is read on every visit whatever the
  // row's measurement pose is, and both readings are returned. The row decides which one W1 scores
  // against: `w1-far` is the control that moves it, and only that row moves it.
  const atSettle = await readProbe(page)
  if (!atSettle.ok) return { slug, ok: false, detail: `${atSettle.reason}: ${atSettle.detail}` }

  // **The payload is not necessarily about the world the gate flew to, and every per-world reading
  // is misattributed if this is not checked.** `attachWorlds.probeSource()` returns the surface with
  // the smallest `radii` — the world the camera is nearest in units of *its own* radius — which is
  // not the focused plane whenever a small world is focused next to a larger neighbour. Flying to
  // `segovia` (1 card) lands a payload describing `innistrad`, with `state().planeSlug` still
  // reading `segovia`, so the two seams disagree and only the worlds one knows what was measured.
  // A gate that trusted `focusPlane` would file innistrad's cells under segovia's name and its
  // one-card row would be measuring a 400-card world.
  if (atSettle.probe.planeSlug !== slug) {
    return {
      slug,
      ok: false,
      detail:
        `flew to ${slug}, but the worlds payload describes ${atSettle.probe.planeSlug} at ` +
        `${atSettle.probe.radii.toFixed(3)} radii — probeSource() returns the world nearest in ` +
        `radii, not the focused one`,
    }
  }
  const settleRadii = atSettle.probe.radii
  const settleCells = atSettle.probe.cells.map((c) => ({ height: c.height, frontFacing: c.frontFacing }))

  // ---- the measurement pose --------------------------------------------------------------------
  // `pose` is the row's, not a constant. Two reasons it may not be hard-coded to the surface view:
  // the `w1-far` control is "capture at 6× radius **instead of** the settle", and the one-card-world
  // row is specified "at its own settle" — a rig that drove every row to 2.2 would run the first at
  // the baseline pose (a control that never left the baseline) and fail the second outright, since
  // a one-card world's radius is small enough that the rig's own near clamp never reaches 2.2.
  if (pose !== 'settle') {
    const reached = await driveToRadii(page, pose)
    if (reached === null || Math.abs(reached - pose) > RADII_TOLERANCE) {
      return {
        slug,
        ok: false,
        detail: `could not reach ${pose} radii — stopped at ${reached === null ? 'no pose' : reached.toFixed(3)}`,
      }
    }
  }
  await hold(page, W4_SETTLE_S)

  const frame = await captureFrame(page, captures ? dir : null, `world-${slug}`)
  if (!frame.ok) return { slug, ok: false, detail: `${frame.reason}: ${frame.detail}` }
  const { probe, image } = frame
  // Re-checked at the measurement pose, not only at the settle: driving the camera changes every
  // world's `radii`, so the nearest-in-radii subject can change under the drive.
  if (probe.planeSlug !== slug) {
    return {
      slug,
      ok: false,
      detail: `drove to ${pose} radii on ${slug}, but the payload describes ${probe.planeSlug}`,
    }
  }

  // The payload must account for every card before any criterion reads it. A run measuring 480 of
  // a world's 500 cards is otherwise indistinguishable from one measuring all 500 — the payload
  // carries no `cardCount` of its own, so the dataset supplies it (seam contract §1a).
  const cardinality = cellCardinality(probe, world.cardCount)

  // ---- W4's eviction timeline ------------------------------------------------------------------
  // `pool.evictions` is cumulative, so the rate is differenced from a timeline and never read off
  // the counter: the prototype's 925 at `tether-surface` is a cumulative figure, and the same 925
  // on a settled pool is 0/s and passes.
  const timeline = []
  const started = Date.now()
  while ((Date.now() - started) / 1000 < W4_SAMPLE_S) {
    const now = await readProbe(page)
    if (now.ok) timeline.push({ t: (Date.now() - started) / 1000, evictions: now.probe.pool.evictions })
    await sleep(200)
  }

  const { samples, offFrame } = cellSamples(probe, image)
  return {
    slug,
    ok: true,
    settleRadii,
    radii: probe.radii,
    cardinality,
    offFrame: offFrame.length,
    poolLayers: probe.pool.layers,
    effectiveThresholdPx: probe.pool.effectiveThresholdPx,
    stream: probe.stream,
    settleCells,
    poseCells: probe.cells.map((c) => ({ height: c.height, frontFacing: c.frontFacing })),
    w2: evaluateW2(samples),
    w3: evaluateW3(samples, probe.bandShares),
    w4: evaluateW4(artCells(probe), timeline, probe.pool),
    probeChecked: frame.checked,
  }
}

// ---------------------------------------------------------------------------------------------
// W5 — the home view, over a sweep of azimuths
// ---------------------------------------------------------------------------------------------

/**
 * Sample the home view at `minAzimuths` azimuths, evenly spaced around the turn.
 *
 * The home view is a family of frames and not a pose: `motion.ts:247` rotates every plane by
 * `multiverseAngle` every tick, so any count read off one frame is one draw from a distribution.
 * The sweep is therefore driven by *waiting*, and the azimuth is **read back** at each sample
 * rather than computed from the wait — see `readAzimuth` for why that distinction is load-bearing
 * rather than fastidious.
 *
 * A full turn is `MULTIVERSE_PERIOD_S`, so an evenly-spaced comb of N samples is N waits of
 * `period / N`. The gate does not assume the period either: it measures the rate from the first two
 * samples and paces the rest off that, so a retuned period changes how long this takes and nothing
 * about what it means. `azimuthSpacingFault` then checks the azimuths that were actually reached,
 * which is a check with content precisely because the values came back from the page.
 */
async function sweepHomeView(page, { minAzimuths }) {
  const first = await readAzimuth(page)
  if (first === null) {
    return {
      ok: false,
      reason: 'no-azimuth-seam',
      detail:
        'the probe does not publish `multiverseAngle`, so the azimuth of a sample cannot be read ' +
        'back. W5 is measured over a sweep of azimuths and the gate may not derive one from its own ' +
        'clock (see readAzimuth). This is a missing readback seam, not a red criterion.',
    }
  }

  // Measure the rate rather than assuming `MULTIVERSE_PERIOD_S`, and use the same reading to prove
  // the scene is turning at all. A frozen multiverse (`reducedMotion`) is a setup failure: every
  // later sample would be the same frame, and reachability would read as a sweep while being one.
  const probeWaitS = 5
  await hold(page, probeWaitS)
  const second = await readAzimuth(page)
  const TAU = Math.PI * 2
  const advanced = ((second - first) % TAU + TAU) % TAU
  if (advanced < 1e-4) {
    return {
      ok: false,
      reason: 'frozen',
      detail:
        `multiverseAngle did not advance over ${probeWaitS}s (${first.toFixed(6)} → ${second.toFixed(6)}). ` +
        'The scene is not turning — `starScene.ts:332` passes 0 under reduced motion — so a sweep ' +
        'here would sample one azimuth twelve times.',
    }
  }
  const radPerS = advanced / probeWaitS
  const stepS = TAU / minAzimuths / radPerS
  console.log(
    `  sweeping ${minAzimuths} azimuths: ${radPerS.toFixed(6)} rad/s measured, ` +
      `${stepS.toFixed(1)}s per step, ~${((stepS * minAzimuths) / 60).toFixed(1)} min`,
  )

  const sweep = []
  const unresolved = []
  for (let i = 0; i < minAzimuths; i += 1) {
    if (i > 0) await hold(page, stepS)
    const azimuth = await readAzimuth(page)
    const labels = await readLabels(page)
    const visible = labels.filter((label) => isLabelVisible(label))
    // A visible label with no `data-plane-slug` is R3's readback seam missing on that node. It is
    // counted in `labelCount` — it is on screen — and reported, never guessed at from its text.
    const withSlug = visible.filter((label) => typeof label.slug === 'string' && label.slug.length > 0)
    if (withSlug.length !== visible.length) unresolved.push(visible.length - withSlug.length)
    sweep.push({
      azimuth,
      labelCount: visible.length,
      labelledWorlds: [...new Set(withSlug.map((label) => label.slug))],
    })
    console.log(
      `    azimuth ${i + 1}/${minAzimuths} @ ${azimuth.toFixed(4)} rad — ${visible.length} visible, ` +
        `${sweep[i].labelledWorlds.length} worlds`,
    )
  }
  const spacing = azimuthSpacingFault(sweep.map((s) => s.azimuth))
  return { ok: true, sweep, spacing, unresolvedLabels: unresolved.reduce((a, b) => a + b, 0) }
}

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

/**
 * §3.1's negative-control matrix.
 *
 * Every row names **the measure it aims at**, not just the criterion: W2 and W4 are conjunctions
 * and a conjunction hides which half did the work. Under `?swatch=mean` the neighbour-ΔE half
 * collapses to ≈1.2 while the un-subsetted lightness half stayed at 14.1 and green — a gate
 * reporting only the row would have recorded that seam as exercising both halves of W2 when it
 * exercised one, and IQR(L*) would have shipped with no negative control at all.
 *
 * `subject` is the world a row is measured on. Rows that are about the roster run the whole tour;
 * the rest name one world, because a control's job is to falsify a measure and 45 worlds of it is
 * 45× the runtime for the same evidence.
 */
const MATRIX = [
  {
    id: 'baseline',
    label: 'the unmodified build on the v3 production dataset',
    seams: {},
    tour: 'all',
    expect: [
      { criterion: 'W1', expect: 'GREEN' },
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'GREEN' },
      { criterion: 'W2', measure: 'lightnessIqr', expect: 'GREEN' },
      { criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'GREEN' },
      { criterion: 'W4', measure: 'artFraction', expect: 'GREEN' },
      { criterion: 'W4', measure: 'evictionsPerSecond', expect: 'GREEN' },
    ],
  },
  {
    id: 'w1-far',
    label: 'W1 at 6× radius instead of the settle (the prototype measured 10.1 px there)',
    seams: {},
    subject: 'dominaria',
    pose: 6,
    // The only row that scores W1 anywhere but the settle — that substitution *is* the control.
    w1At: 'pose',
    expect: [{ criterion: 'W1', measure: 'minMedianCellHeightPx', expect: 'RED' }],
  },
  {
    id: 'swatch-mean',
    label: '?swatch=mean — every cell takes the plane’s mean swatch',
    seams: { swatchMean: true },
    subject: 'dominaria',
    expect: [
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'RED' },
      { criterion: 'W2', measure: 'lightnessIqr', expect: 'RED' },
    ],
  },
  {
    id: 'bands-shuffle',
    label: '?bands=shuffle — cards permuted across the plane’s cells, grid and band unchanged',
    seams: { bandsShuffle: true },
    subject: 'dominaria',
    expect: [{ criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'RED' }],
  },
  {
    id: 'fixed24',
    label: '?artThreshold=fixed24 — the prototype’s constant threshold, no quantile',
    seams: { artThresholdFixed24: true },
    subject: 'dominaria',
    expect: [
      { criterion: 'W4', measure: 'artFraction', expect: 'RED' },
      { criterion: 'W4', measure: 'evictionsPerSecond', expect: 'RED' },
    ],
  },
  {
    id: 'layers-128',
    label: '?layers=128 — a tier-4-sized pool, unmodified policy',
    seams: { layersRequested: 128 },
    subject: 'dominaria',
    expect: [
      { criterion: 'W4', measure: 'artFraction', expect: 'GREEN' },
      { criterion: 'W4', measure: 'evictionsPerSecond', expect: 'GREEN' },
    ],
  },
  {
    id: 'one-card-world',
    label: 'a one-card world (segovia) at its own settle — the n = 1 extreme',
    seams: {},
    subject: 'segovia',
    // "At its own settle", per the matrix — and not merely as a convenience. A one-card world's
    // radius is small enough that the rig's near clamp bottoms out at ~3.9 radii, so 2.2 is
    // unreachable there and a row that insisted on it would report a setup failure for ever.
    pose: 'settle',
    expect: [
      { criterion: 'W1', measure: 'minMedianCellHeightPx', expect: 'GREEN' },
      { criterion: 'W4', measure: 'artFraction', expect: 'GREEN' },
      // The half that matters: the guard against the sample-size precondition being quietly
      // widened later until it swallows real planes. A control that asserts an `n/a` is still a
      // control, because both alternative readings — silently pass, silently skip — are wrong.
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'N/A' },
      { criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'N/A' },
    ],
  },
  {
    id: 'w5-narrow',
    label: 'W5 reachability at 800×600 — collision pressure raised by the harness, not by a seam',
    seams: {},
    w5: true,
    viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
    expect: [{ criterion: 'W5', measure: 'worldsNeverLabelled', expect: 'RED' }],
  },
  {
    id: 'w5-wide',
    label: 'W5 reachability at 1920×1080 — the non-binding partner, differing in one parameter',
    seams: {},
    w5: true,
    expect: [{ criterion: 'W5', measure: 'worldsNeverLabelled', expect: 'GREEN' }],
  },
]

/** The query string for a row's seams. Nothing here invents a seam: these are R1's four spellings. */
function seamQuery(seams) {
  const parts = []
  if (seams.swatchMean) parts.push('swatch=mean')
  if (seams.bandsShuffle) parts.push('bands=shuffle')
  if (seams.artThresholdFixed24) parts.push('artThreshold=fixed24')
  if (typeof seams.layersRequested === 'number') parts.push(`layers=${seams.layersRequested}`)
  return parts.length === 0 ? '' : `&${parts.join('&')}`
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dataset: 'worlds',
    out: resolve(WEB_ROOT, 'worlds-gate'),
    build: true,
    only: null,
    negativeControls: false,
    minAzimuths: W5_MIN_AZIMUTHS,
    captures: true,
    tourLimit: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--out') args.out = resolve(argv[++i])
    else if (argv[i] === '--no-build') args.build = false
    else if (argv[i] === '--no-captures') args.captures = false
    else if (argv[i] === '--negative-controls') args.negativeControls = true
    else if (argv[i] === '--only') args.only = argv[++i].split(',').map((s) => s.trim())
    else if (argv[i] === '--min-azimuths') args.minAzimuths = Number(argv[++i])
    else if (argv[i] === '--tour-limit') args.tourLimit = Number(argv[++i])
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  for (const id of args.only ?? []) {
    if (!MATRIX.some((row) => row.id === id)) {
      throw new Error(`--only: unknown row ${id}. Known: ${MATRIX.map((r) => r.id).join(', ')}`)
    }
  }
  if (args.minAzimuths < W5_MIN_AZIMUTHS) {
    // `evaluateW5` would report `insufficient` anyway; refusing here says why, once, instead of
    // spending the sweep first.
    throw new Error(`--min-azimuths must be at least ${W5_MIN_AZIMUTHS} (§3.1: one frame is not a sweep)`)
  }
  return args
}

async function openPage(browser, url, { seams = {}, viewport = VIEWPORT }) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)))
  await page.goto(`${url}/?probe=shell${seamQuery(seams)}`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 120_000 })
  await page.waitForFunction(
    () => [...document.querySelectorAll('canvas')].some((c) => c.width > 300 && c.height > 150),
    { timeout: 120_000 },
  )
  await waitForProbe(page, 'the intro flight to settle', (s) => !s.flying, 120_000)
  return { page, errors }
}

async function runRow(browser, url, row, { roster, args, baselineProbe }) {
  console.log(`\n── ${row.id}: ${row.label}`)
  const viewport = row.viewport ?? VIEWPORT
  const { page, errors } = await openPage(browser, url, { seams: row.seams, viewport })
  const dir = resolve(args.out, row.id)
  mkdirSync(dir, { recursive: true })
  try {
    // ---- W5 rows ------------------------------------------------------------------------------
    if (row.w5) {
      const swept = await sweepHomeView(page, { minAzimuths: args.minAzimuths })
      if (!swept.ok) return { row, setupFailure: swept, criteria: [], checks: [], errors }
      const w5 = evaluateW5(swept.sweep, roster.metricsRoster, {
        worldsWithCards: roster.worldsWithCards.map((p) => p.slug),
        minAzimuths: args.minAzimuths,
      })
      writeFileSync(resolve(dir, 'sweep.json'), `${JSON.stringify(swept, null, 2)}\n`)
      return { row, criteria: [w5], checks: scoreRow(row, [w5]), sweep: swept, errors }
    }

    // ---- W1–W4 rows ---------------------------------------------------------------------------
    const subjects =
      row.tour === 'all'
        ? roster.worldsWithCards.slice(0, args.tourLimit ?? roster.worldsWithCards.length)
        : [roster.worldsWithCards.find((p) => p.slug === row.subject)]
    if (subjects.some((s) => s === undefined)) {
      throw new Error(`row ${row.id} names world ${row.subject}, which is not in this dataset`)
    }

    const visits = []
    for (const world of subjects) {
      const visit = await visitWorld(page, world, {
        dir,
        captures: args.captures,
        pose: row.pose ?? SURFACE_RADII,
      })
      visits.push(visit)
      if (!visit.ok) {
        console.log(`  ${world.slug}: SETUP FAILURE — ${visit.detail}`)
        continue
      }
      console.log(
        `  ${world.slug}: ${visit.cardinality.reported}/${visit.cardinality.cardCount} cells, ` +
          `pool ${visit.poolLayers}, threshold ${visit.effectiveThresholdPx.toFixed(2)}px, ` +
          `W2 ${visit.w2.status} W3 ${visit.w3.status} W4 ${visit.w4.status}`,
      )
    }

    const good = visits.filter((v) => v.ok)
    if (good.length === 0) {
      return {
        row,
        setupFailure: { reason: 'no-visit', detail: visits.map((v) => `${v.slug}: ${v.detail}`).join('; ') },
        criteria: [],
        checks: [],
        errors,
      }
    }

    // The seam is asserted to have *engaged* before any criterion of this row is read. A seam that
    // silently fails to parse runs the unmodified policy, its criterion passes, and the matrix
    // records a passing control — which reads as a passing gate.
    const probeNow = await readProbe(page)
    const evidence = probeNow.ok ? seamEvidence(probeNow.probe, row.seams, baselineProbe) : []

    const criteria = [
      evaluateW1(
        good.map((v) => ({ slug: v.slug, cells: row.w1At === 'pose' ? v.poseCells : v.settleCells })),
      ),
      foldCriteria(good.map((v) => ({ slug: v.slug, criterion: v.w2 }))),
      foldCriteria(good.map((v) => ({ slug: v.slug, criterion: v.w3 }))),
      foldCriteria(good.map((v) => ({ slug: v.slug, criterion: v.w4 }))),
    ].filter((c) => c !== null)

    writeFileSync(
      resolve(dir, 'visits.json'),
      `${JSON.stringify({ visits, evidence, criteria }, null, 2)}\n`,
    )
    return { row, criteria, checks: scoreRow(row, criteria), evidence, visits, errors, probe: probeNow.ok ? probeNow.probe : null }
  } finally {
    await page.close()
  }
}

/** Score a row's expectations. `checkControlRow` owns the comparison; this only names the row. */
function scoreRow(row, criteria) {
  return row.expect.map((expectation) => ({
    ...expectation,
    ...checkControlRow(criteria, expectation),
  }))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const roster = readRoster(args.dataset)
  console.log(
    `dataset ${args.dataset} (${roster.hash}): ${roster.planes.length} planes, ` +
      `${roster.worldsWithCards.length} worlds with cards, ${roster.planesWithCards.length} planes with cards`,
  )
  console.log(`W5 ceiling, derived: ${homeLabelCeiling(roster.metricsRoster)} labels`)

  // §1.3's table, asserted off `planes.json` before a browser is started. It is a dataset property
  // and nothing about the run can change it, so a fault here should not cost a 45-world tour first.
  const faults = rowCellsFaults(roster.planes)
  console.log(
    faults.length === 0
      ? `rowCells: clean on ${roster.planes.length} planes`
      : `rowCells: ${faults.length} FAULTS\n  ${faults.join('\n  ')}`,
  )

  if (args.build) {
    execFileSync('pnpm', ['build'], {
      cwd: WEB_ROOT,
      env: { ...process.env, ETERNITIES_DATASET: args.dataset },
      stdio: 'inherit',
    })
  }
  mkdirSync(args.out, { recursive: true })

  // `--only` names rows explicitly; `--negative-controls` runs the whole matrix; a bare run is the
  // acceptance run, which is the baseline row over the full roster.
  const selected =
    args.only !== null
      ? MATRIX.filter((row) => args.only.includes(row.id))
      : args.negativeControls
        ? MATRIX
        : MATRIX.filter((row) => row.id === 'baseline')

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

  const results = []
  try {
    // A no-seam probe from the same page shape, so `?layers=N`'s witness has a baseline to have
    // moved *off*. Without one the row is downgraded to an echo, and the gate says so rather than
    // quietly scoring a weaker control as a strong one.
    let baselineProbe = null
    if (selected.some((row) => typeof row.seams.layersRequested === 'number')) {
      const { page } = await openPage(browser, url, { seams: {} })
      const read = await readProbe(page)
      baselineProbe = read.ok ? read.probe : null
      await page.close()
    }

    for (const row of selected) {
      results.push(await runRow(browser, url, row, { roster, args, baselineProbe }))
    }
  } finally {
    await browser.close()
    stop()
  }

  // ---- the report -------------------------------------------------------------------------------
  console.log('\n══ matrix ══')
  let failed = faults.length > 0
  for (const result of results) {
    if (result.setupFailure) {
      console.log(`  ${result.row.id.padEnd(16)} SETUP FAILURE — ${result.setupFailure.detail}`)
      failed = true
      continue
    }
    for (const check of result.checks) {
      const name = `${check.criterion}${check.measure ? `.${check.measure}` : ''}`
      console.log(
        `  ${result.row.id.padEnd(16)} ${name.padEnd(32)} expect ${check.expect.padEnd(5)} ` +
          `${check.ok ? 'ok  ' : 'FAIL'} ${check.detail}`,
      )
      if (!check.ok) failed = true
    }
    for (const seam of result.evidence ?? []) {
      console.log(`  ${''.padEnd(16)} seam ${seam.seam.padEnd(27)} ${seam.engaged ? 'engaged' : 'NOT ENGAGED'} (${seam.witness}) ${seam.detail}`)
      if (!seam.engaged) failed = true
    }
  }

  writeFileSync(
    resolve(args.out, 'summary.json'),
    `${JSON.stringify(
      {
        dataset: args.dataset,
        hash: roster.hash,
        worldsWithCards: roster.worldsWithCards.length,
        ceiling: homeLabelCeiling(roster.metricsRoster),
        floors: FLOORS,
        rowCellsFaults: faults,
        rows: results.map((r) => ({
          id: r.row.id,
          setupFailure: r.setupFailure ?? null,
          checks: r.checks,
          evidence: r.evidence ?? [],
          criteria: r.criteria,
        })),
      },
      null,
      2,
    )}\n`,
  )
  console.log(`\nevidence written to ${args.out}`)
  console.log(failed ? '\nGATE: RED' : '\nGATE: GREEN')
  process.exitCode = failed ? 1 : 0
}

await main()
