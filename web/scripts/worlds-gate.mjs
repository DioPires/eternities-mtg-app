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
 *   node scripts/worlds-gate.mjs --reverse             # the runbook's tour-order control
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

import { decodePng } from './lib/png-sample.mjs'
import {
  FLOORS,
  W2_CONTROL_SUBJECT_MIN_RING,
  W3_DOMAIN_SIZE,
  W5_MIN_AZIMUTHS,
  azimuthSpacingFault,
  checkControlRow,
  evaluateW1,
  evaluateW2,
  evaluateW3,
  evaluateW4,
  evaluateW5,
  evictionTail,
  foldCriteria,
  homeLabelCeiling,
  isLabelVisible,
  poolHighWater,
  rowCellsFaults,
  w3QualifiesByShares,
} from './lib/worlds-metrics.mjs'
import {
  artCells,
  cellCardinality,
  cellSamples,
  readWorldsProbe,
  seamEvidence,
  seamQuery,
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

/** §3.1: W4 is read "after a 5 s settle". */
const W4_SETTLE_S = 5

/**
 * W4's eviction window — **sampled until the pool plateaus and the tail settles, not for a fixed 3 s**
 * (board ruling on DEC-833 card `bd5c9aad`, option (a)).
 *
 * The old window was 3 s, and it could not have answered the question it was asked. Dominaria's fill
 * is ~1,024 admissions; at the rate the counter moves, the fill alone outlasts a 3 s observation, so
 * "a bounded fill transient" and "sustained churn" produced the same reading by construction — the
 * open question DEC-752 recorded and could not close with this instrument.
 *
 * **Why adaptive rather than simply longer.** 44 of the 45 worlds never saturate the pool: their
 * demand fits, `resident` plateaus at it within the settle, and both halves of their tail read 0/s.
 * They are converged the moment there are enough samples to say so, and a flat 45 s window would
 * spend half an hour of tour time re-confirming zeros. So the loop stops as soon as
 * `evictionTail` reports a settled tail past `MIN`, and only the world that actually churns pays for
 * the long observation.
 *
 * `MAX` is a ceiling on that patience, not a target. A world that has not settled by then reports
 * `insufficient` with the drift that disqualified it — see `evictionTail`. That is the honest
 * outcome: DEC-835 measured a 60 s baseline whose tail was still declining 5.4% monotonically, and a
 * gate that scored it anyway would be publishing the fill under a different name.
 *
 * **Measured on dominaria at this pose, and it is worth knowing which way it came out:** the pool is
 * already at 1,024/1,024 on the *first* sample, so the plateau lands at `t = 0.0` and the tail is
 * the whole window — 17.84/s over 12.2 s, its own second half 0.9% off. The camera approach and the
 * 5 s settle absorb the fill before sampling opens, so at *this* pose the exclusion has nothing to
 * exclude.
 *
 * That is not an argument for dropping it. It is the load-bearing rule the moment any of three
 * things changes — a shorter settle, a world whose pool fills more slowly, or a capture path that
 * opens sampling earlier — and none of those is visible from a green reading taken today. The rule
 * is exercised where it can be exercised: the unit rows in `worlds-metrics.test.ts` and the long-run
 * instrument, where the fill is inside the window by construction.
 */
const W4_EVICTION_MIN_S = 12
const W4_EVICTION_MAX_S = 45
const W4_EVICTION_SAMPLE_MS = 250

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

/**
 * The raw worlds payload for `slug`, or `undefined`. Read raw: `readWorldsProbe` owns every
 * judgement of it.
 *
 * **`slug` is required wherever the caller has one, and this is the whole of DEC-785's fix.** The
 * bare `worlds()` returns the surface with the smallest `radii` — the world the camera is nearest
 * in units of *its own* radius, which is systematically the largest world in the neighbourhood, not
 * the focused one. Measured over the 45-world roster before the fix: 42 mismatched at the driven
 * pose, so a driver calling the bare seam files one world's cells under another world's name and
 * only `dominaria` happens to agree, which is what makes a spot check look fine.
 *
 * `worlds(slug)` is additive and the no-arg path is byte-identical, so an *unchanged* driver keeps
 * reporting those ~42 setup failures against the fixed build. That is why this argument exists and
 * why it is threaded down from `visitWorld`, which already knows the slug.
 *
 * Omit it only where the reading is session-global (`pool`, `stream`, `seams`) and no world is in
 * view — see the baseline and seam-evidence reads, which say so at their call sites.
 */
const rawWorlds = (page, slug = null) =>
  page.evaluate((s) => {
    const probe = window.__eternitiesProbe
    if (probe === undefined || typeof probe.worlds !== 'function') return { missing: true }
    const payload = s === null ? probe.worlds() : probe.worlds(s)
    return payload === undefined ? { missing: true } : { missing: false, payload }
  }, slug)

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
 * **§3.1 requires this rather than accepting wherever `focusPlane` settles.** The settle is
 * `framing.ts`'s framing distance and the surface pose is 2.2 radii, and the two are not the same
 * number. A number specified "at 2.2 radii" and in fact taken at the settle is a number taken at a
 * pose the spec does not name, so the driver drives, and the caller asserts before it reads.
 *
 * **The settle is no longer one number across the roster, and nothing here may assume it is
 * (DEC-818).** It was `frame: r * 3.2` on every world, which is why "the settle" and "3.2 radii"
 * were interchangeable in this file's older comments and in leg G's earlier reports. §1.3's framing
 * law now returns `min(3.2, CELL_LIFT + cellArc · focalPx / 30)`: 2.261 on dominaria, 3.080 on
 * ravnica, 3.2 on the other 43. The gate absorbs that because it never drives to the settle — W1
 * *reads* whatever `focusPlane` reached and `settleRadii` records it — and a driver that took 3.2
 * as the settle would now measure a pose the product does not stop at, on exactly the two worlds
 * whose W1 is binding.
 *
 * **The notch is solved, not stepped, and that is forced by the arithmetic.** Zoom is
 * multiplicative (`rig.zoomBy(exp(deltaY · k))`), so a fixed ±120 notch moves `radii` by a fixed
 * *ratio* — about 21% on this build. `RADII_TOLERANCE` is ±0.02 at 2.2, a window of ±0.9%, so a
 * ladder of fixed notches lands inside it only if the two happen to commensurate: from 3.2 the
 * reachable poses are 2.64 and 2.18, and 2.18 clears by 0.0004. **A stepping driver is a coin flip
 * on a constant it does not read**, and the failure is the one this leg has already paid for once —
 * every threshold-dependent number taken at an unnamed pose. Per-world settles make a stepping
 * driver worse still: the ladder would start from a different rung on each of the two moved worlds.
 *
 * `k` is **measured, not copied from `attachRig.ts`**: one probe notch, then `deltaY =
 * ln(target/current) / k`. Copying the constant would make the drive agree with the product by
 * construction and go silently wrong the day someone retunes the wheel; measuring it also picks up
 * the *sign*, which is therefore never assumed. Two refinements follow the solve, for the rig's
 * own easing — not for the arithmetic, which is exact.
 */
async function driveToRadii(page, target, { slug = null, probeDeltaY = 60, refinements = 3 } = {}) {
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)

  const read = async () => {
    const pose = await poseOf(page, slug)
    return pose === null ? null : pose.radii
  }
  const notch = async (deltaY) => {
    await page.mouse.wheel({ deltaY })
    await sleep(400)
    return read()
  }

  let current = await read()
  if (current === null) return null
  if (Math.abs(current - target) <= RADII_TOLERANCE) return current

  // The probe notch. Its direction is the one that takes us toward the target *if* the sign
  // convention is the expected one; if it is not, `k` comes out negative and the solve below
  // simply turns around. Either way the constant is read off the rig, never asserted at it.
  let k = null
  for (const deltaY of [current > target ? -probeDeltaY : probeDeltaY, current > target ? probeDeltaY : -probeDeltaY]) {
    const before = current
    const after = await notch(deltaY)
    if (after === null) return null
    current = after
    if (Math.abs(current - target) <= RADII_TOLERANCE) return current
    // A notch that does not move the pose means the rig is against a tether clamp in that
    // direction, not that the loop needs more of them. Try the other way once, then give up and
    // let the caller fail the assertion with the real number.
    if (Math.abs(Math.log(after / before)) < 1e-6) continue
    k = Math.log(after / before) / deltaY
    break
  }
  if (k === null) return current

  for (let i = 0; i < refinements; i += 1) {
    const before = current
    const after = await notch(Math.log(target / before) / k)
    if (after === null) return null
    current = after
    if (Math.abs(current - target) <= RADII_TOLERANCE) return current
    if (Math.abs(Math.log(after / before)) < 1e-6) return current
  }
  return current
}

/**
 * The pose of `slug`, not of whichever world the camera happens to be nearest.
 *
 * **The slug is load-bearing here in a way it is not elsewhere: without it the drive targets the
 * wrong world's radii.** `driveToRadii` steers until this reports 2.2, so a bare read makes the rig
 * stop when the *neighbour* is at 2.2 — and every threshold-dependent number is then taken at an
 * unnamed pose on the focused world. The misattribution and the mis-pose are one defect, but the
 * second survives any amount of checking the first.
 */
const poseOf = (page, slug = null) =>
  page.evaluate((s) => {
    const probe = window.__eternitiesProbe
    const payload = s === null ? probe?.worlds?.() : probe?.worlds?.(s)
    return payload === undefined || payload === null
      ? null
      : { slug: payload.planeSlug, radii: payload.radii, cells: payload.cells.length }
  }, slug)

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
async function readProbe(page, slug = null) {
  const raw = await rawWorlds(page, slug)
  if (raw.missing) {
    return {
      ok: false,
      reason: 'absent',
      // The two spellings are different facts and the detail says which. Asked for a slug,
      // `undefined` means *that world* is not composed — `blind-eternities` is the live case, and a
      // world silently dropped from the roster would read the same way. Asked bare, it means no
      // world is composed on the page at all.
      detail:
        slug === null
          ? 'window.__eternitiesProbe.worlds() returned undefined — no world is composed on this page'
          : `window.__eternitiesProbe.worlds(${JSON.stringify(slug)}) returned undefined — ` +
            `${slug} is not a composed world on this page`,
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
async function captureFrame(page, dir, name, slug = null) {
  await settleFrames(page, 2)
  const before = await readProbe(page, slug)
  if (!before.ok) return { ok: false, ...before }
  const focusBefore = (await probeState(page))?.planeSlug ?? null
  const png = await page.screenshot({ path: dir === null ? undefined : resolve(dir, `${name}.png`) })
  const after = await readProbe(page, slug)
  if (!after.ok) return { ok: false, ...after }
  const focusAfter = (await probeState(page))?.planeSlug ?? null

  // **The subject half of this guard reads `state()`, not the payload, and that is a consequence of
  // threading the slug rather than a preference.** Once the payload is requested *by* slug it
  // reports that slug or nothing, so `before.probe.planeSlug !== after.probe.planeSlug` can no
  // longer fail — it became true by construction the moment the fix landed. The guard exists to
  // catch the rig drifting off the world mid-capture (attract mode, an unfinished flight, a stray
  // input), and after DEC-785 only the focus seam still carries that signal. Left on the payload it
  // would read as a maintained check while testing nothing.
  if (Math.abs(after.probe.radii - before.probe.radii) > 1e-3 || focusAfter !== focusBefore) {
    return {
      ok: false,
      reason: 'moved',
      detail:
        `the rig moved across the capture: focus ${focusBefore} at ${before.probe.radii.toFixed(3)} ` +
        `radii before, ${focusAfter} at ${after.probe.radii.toFixed(3)} after`,
    }
  }
  return { ok: true, probe: after.probe, image: decodePng(Buffer.from(png)), checked: after.checked }
}

// ---------------------------------------------------------------------------------------------
// Folding per-plane criteria into a roster verdict
// ---------------------------------------------------------------------------------------------
//
// `foldCriteria` lives in `lib/worlds-metrics.mjs` (DEC-816). It is pure — per-plane criteria in,
// one criterion out — and it is the half of the report that decides what a verdict *means*, so it
// belongs where the suite can drive it. Here it could not be: this module opens a browser at import
// time's reach, so the only way to assert the fold was to rebuild its output by hand in a test,
// which is a double that agrees with the bug the day the fold changes.

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

  // ---- the entry reading -----------------------------------------------------------------------
  // **Taken before the camera moves, and W4 is scored against it.** The art byte budget is a
  // session-lifetime backstop (`artStream.ts`: 729 bodies and then the stream stops asking), so a
  // world visited after the session hit that cap measures the tour rather than the world. See
  // `budgetBoundAtEntry`. This read is deliberately *bare*: the budget is a property of the session
  // and of no world, and at this instant the camera has not been asked for `slug` yet — a threaded
  // slug here would either fail on an uncomposed world or claim the reading is about one.
  const entry = await readProbe(page)
  if (!entry.ok) return { slug, ok: false, detail: `entry read: ${entry.reason}: ${entry.detail}` }
  const entryStream = entry.probe.stream
  if (entryStream === null) {
    // `null` is a build with no stream at all, and it is not an all-zero report (DEC-778). W4 is
    // unscorable without one, and defaulting the entry spend to zero is precisely the shape that
    // lets a spent budget read as a policy failure.
    return { slug, ok: false, detail: 'the payload reports no art stream, so W4 has no entry reading' }
  }

  await flyToPlane(page, slug)
  await hold(page, 2)

  // ---- the settle ------------------------------------------------------------------------------
  // W1 is specified "at the plane-level settle", so the settle is read on every visit whatever the
  // row's measurement pose is, and both readings are returned. The row decides which one W1 scores
  // against: `w1-far` is the control that moves it, and only that row moves it.
  //
  // **One reading, and that is a claim with a precondition rather than a convenience (DEC-818).**
  // W1's per-world median is a family over the rotation of the mosaic relative to the camera, and
  // this takes one draw from it. How wide the family is turns entirely on `spin.ts`'s
  // `APPLY_PLANE_TILT`, which is `false`: with the pole at world `+Y` the rotation maps each
  // row-ring onto itself and the median barely moves. Applying `plane.tilt` instead carries a
  // cohort of squat polar cells through the front-facing cap and the family opens to 11–16%.
  // **So the day that flag turns on — DEC-750 left it open — one draw stops being the statistic
  // and every W1 verdict here becomes a coin flip on the arrival azimuth.**
  //
  // > **THE GUARD IS `test/worlds-w1-single-draw.test.ts`, and it reds on a MEASUREMENT.** That
  // > file sweeps 24 azimuths through `planeOrientation` — the product's own orientation writer —
  // > so flipping the constant re-points the figures it measures and the width assertion fails by
  // > itself; the tilted arm rides alongside as the negative control that proves the sweep can see
  // > 11% when there is 11% to see. This script cannot read a compile-time constant, which is why
  // > the guard lives in the unit suite rather than here.
  //
  // Re-measured at §1.3's framing distances after DEC-818 (relay `03bfa906` items 2–3), at each
  // world's own **arrival polar** rather than at `HOME_POLAR` — 24 azimuths, shipped arm:
  // dominaria spans 28.099–28.213 px at 2.260705 radii (±0.20%) and ravnica 29.916–30.000 at
  // 3.080104 (±0.14%). Confirmed on the rig at the settle across a full relative turn of the
  // mosaic: 28.076–28.234 and 29.876–29.963. At `HOME_POLAR` the same offline sweep reads
  // 28.740–28.812 and 30.191–30.452, which is ~2% optimistic — `HOME_POLAR` is where the fly-to
  // aims, not where it lands. The tilted arm at the same distances spans 24.98–31.30 and
  // 25.57–34.72. **The previous figures here (17.48–17.58 / 28.64–28.99 shipped, 15.50–19.35 /
  // 23.88–32.66 tilted) were taken at the old flat 3.2 radii and are retired — do not re-quote
  // them.** `scratch-w1-family.mjs` measures the width through the rig and `scratch-w1-settle.mjs`
  // reads the arrival pose off the payload; the runbook says to re-run both before trusting W1
  // after any change to orientation or framing.
  const atSettle = await readProbe(page, slug)
  if (!atSettle.ok) return { slug, ok: false, detail: `${atSettle.reason}: ${atSettle.detail}` }

  // **This asserts the seam honours its own argument, and it is deliberately kept even though it
  // should now be unfailable.** Before DEC-785 the payload described whichever world the camera was
  // nearest in units of its own radius, so flying to `segovia` (1 card) landed a payload describing
  // `innistrad` while `state().planeSlug` still read `segovia` — 42 of 45 worlds misattributed, and
  // this check was the measurement that found it. Asking by slug removes the defect at the source,
  // which also turns this line into a restatement of `worlds(slug)`'s contract rather than a
  // discriminating reading of the renderer.
  //
  // It stays because it is one comparison against a contract a future refactor of the seam could
  // break silently, and because it is the assertion that would catch the argument being dropped on
  // the way down — the failure mode DEC-785's own relay warned about, where an unchanged driver
  // keeps calling the bare seam against a fixed build. It is no longer evidence of anything on a
  // passing run, and the matrix must not be read as though it were.
  if (atSettle.probe.planeSlug !== slug) {
    return {
      slug,
      ok: false,
      detail:
        `asked worlds(${slug}) and the payload describes ${atSettle.probe.planeSlug} at ` +
        `${atSettle.probe.radii.toFixed(3)} radii — the seam did not honour its argument`,
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
    const reached = await driveToRadii(page, pose, { slug })
    if (reached === null || Math.abs(reached - pose) > RADII_TOLERANCE) {
      return {
        slug,
        ok: false,
        detail: `could not reach ${pose} radii — stopped at ${reached === null ? 'no pose' : reached.toFixed(3)}`,
      }
    }
  }
  await hold(page, W4_SETTLE_S)

  const frame = await captureFrame(page, captures ? dir : null, `world-${slug}`, slug)
  if (!frame.ok) return { slug, ok: false, detail: `${frame.reason}: ${frame.detail}` }
  const { probe, image } = frame
  // The settle-time reasoning applies again at the measurement pose, for the same reason and with
  // the same force: the check is a contract restatement now, not a reading. What the drive really
  // needed was `poseOf(page, slug)` — steering on a bare read stops the rig when the *neighbour*
  // reaches 2.2, and no amount of checking the subject afterwards recovers the pose.
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
  //
  // **Each sample carries the pool's occupancy, because a rate of 0 has two very different causes
  // and the bare number cannot tell them apart.** `artPool.claimLayer` hands back any FREE layer
  // before it ever considers a victim, so the counter can only move once the pool has no free layer
  // left: a pool that never filled reads `0` *by construction*, exactly as a pool forbidden to admit
  // does. Dominaria's four recorded runs separate on nothing else — 701/1024 and 704/1024 occupancy
  // read `0`, 965/1024 read `0`, and only the run that reached 1020/1024 read 18.357/s. Without the
  // occupancy those four lines are byte-identical in the half that matters, which is the
  // fold-denominator defect one criterion over.
  //
  // `resident` is the only occupancy field `?probe=` publishes — `reserved` is on the pool's own
  // `report()` but not on the probe's — so this is a **lower bound** on occupancy, and the high-water
  // mark is therefore *reported* and not scored. Turning it into a domain rule needs `pool.reserved`
  // on the probe, which is R1's surface to add (DEC-744 B1) and is the live half of pending ask
  // `62f32092`.
  //
  // **The last read of this loop is also W4's exit reading** (DEC-752, ruling `exit_domain`). The
  // eviction half's domain is exit-side — a session that exhausted mid-visit was forbidden to admit
  // by the time this rate was taken, so the rate is 0 by construction — and the only honest place to
  // take "at exit" is *after* the window the rate is measured over, not at the settle before it.
  // Bare like the entry read and for the same reason: `stream` is session-global and belongs to no
  // world, so a threaded slug here would claim the reading is about one.
  //
  // **The window is chosen by the pool, not by the clock (DEC-837, ruling `bd5c9aad` option (a)).**
  // Sampling runs until `evictionTail` says the pool has plateaued and the tail has settled against
  // its own second half, then stops. See `W4_EVICTION_MIN_S` for why a fixed window could not have
  // separated a fill from churn, and why the adaptive form costs the tour almost nothing.
  const timeline = []
  let exitStream = probe.stream
  const started = Date.now()
  for (;;) {
    const now = await readProbe(page, slug)
    if (now.ok) {
      timeline.push({
        t: (Date.now() - started) / 1000,
        evictions: now.probe.pool.evictions,
        resident: now.probe.pool.resident,
        layers: now.probe.pool.layers,
      })
      exitStream = now.probe.stream
    }
    const elapsed = (Date.now() - started) / 1000
    if (elapsed >= W4_EVICTION_MAX_S) break
    // The floor is a floor on the *observation*, not on the tail: a pool that plateaued during the
    // settle would otherwise be scored off three samples taken in the first second.
    if (elapsed >= W4_EVICTION_MIN_S && evictionTail(timeline).converged) break
    await sleep(W4_EVICTION_SAMPLE_MS)
  }
  if (exitStream === null) {
    // Same rule as the entry read: `null` is a build with no stream at all and is not an all-zero
    // report (DEC-778). Defaulting the exit spend to zero would switch the eviction half's domain
    // off, which is the `fixed24` false GREEN restored.
    return { slug, ok: false, detail: 'the payload reports no art stream, so W4 has no exit reading' }
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
    // The denominator of the eviction reading: how close the pool came to having no free layer over
    // the window the rate was measured on. `null` when the timeline is empty, never 0 — a pool that
    // was never read and a pool that held nothing are different facts.
    poolHighWater: poolHighWater(timeline),
    // Three readings of one session-global object, and the names say which is which. R1's own note
    // on this field is that a single read is a session total and a world's own share exists only as
    // a difference of two — so the difference is taken here rather than left to a reader of the
    // report to remember not to attribute `stream` to `slug`.
    entryStream,
    exitStream,
    stream: probe.stream,
    streamDelta: streamDelta(entryStream, probe.stream),
    settleCells,
    poseCells: probe.cells.map((c) => ({ height: c.height, frontFacing: c.frontFacing })),
    // The samples W2 and W3 are computed from, kept so a verdict can be re-derived — and a floor or
    // a tolerance re-swept — without another GPU run. They are the expensive half of this gate:
    // every one is a pixel read out of a capture taken at an asserted pose.
    samples,
    // W3's domain membership, in the form that does not depend on the pose: the thirteen band
    // shares this plane's cards give it. The mean fold's denominator check re-derives "should have
    // been in domain" from these, so a world whose band simply went unsampled at the pose is a
    // thinned domain and not a smaller roster. Carried into `visits.json` so the check can be redone
    // offline against a run that has already been paid for.
    bandShares: probe.bandShares,
    w2: evaluateW2(samples),
    w3: evaluateW3(samples, probe.bandShares),
    w4: evaluateW4(artCells(probe), timeline, probe.pool, entryStream, exitStream),
    probeChecked: frame.checked,
  }
}

/**
 * A world's own share of the session-wide stream counters: the exit report minus the entry one.
 *
 * `null` where either end is missing, never a zero-filled object — an absent reading and a world
 * that asked for nothing are different facts, and only one of them is a measurement.
 */
function streamDelta(before, after) {
  if (before === null || after === null) return null
  const delta = {}
  for (const key of Object.keys(after)) {
    const a = after[key]
    const b = before[key]
    delta[key] = typeof a === 'number' && typeof b === 'number' ? a - b : a
  }
  return delta
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
      // **GREEN against 21/s, and the number it has to clear is 18.1–18.5** (board ruling
      // `bd5c9aad`, option (a)). This is the only row in the matrix that scores the eviction half at
      // all: every other W4 row runs a 128-layer pool, where the bound is out of domain by the same
      // ruling. That concentration is deliberate and it is also the row's risk — see the
      // `evictionsPerSecond` notes in `lib/worlds-metrics.mjs` and the unit rows that pin the bound's
      // ability to bind, which no live seam can produce.
      { criterion: 'W4', measure: 'evictionsPerSecond', expect: 'GREEN' },
      // The absolute no-starvation term (ruling `bd5c9aad`, N2). Baseline shows ~942 cells of art
      // against a floor of 64, so this row is nowhere near it — which is the point of asserting it
      // here: the term must be *green on a healthy build* or it is not a control, it is a tripwire.
      { criterion: 'W4', measure: 'artCellsShowing', expect: 'GREEN' },
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
  // ---- W2 and W3's controls, composed with ?art=off (DEC-821) ----------------------------------
  // Both colour seams perturb the **swatch**, and at this pose essentially every sampled cell draws
  // card art over its swatch — `artFraction` reads 0.9628 and 0.9968 on the two no-seam sessions
  // below. So the bare seams move a layer the capture almost never shows: measured on the same
  // build, `?swatch=mean` alone reads 25.8128 / 28.0085 against a no-seam spread of
  // 27.3439–27.7164 / 27.2260–30.7455 — *inside its own baseline's noise*, which is a control that
  // proves nothing. `?art=off` drops every cell to its swatch, and only then does a swatch seam
  // reach the pixels the criterion samples.
  //
  // `art-off` below is the sibling these two are read against — **never the bare build**. The seam
  // moves W2 on its own (27.3/30.7 → 17.8/16.8) because a swatch mosaic is genuinely flatter than
  // card art, so scoring the composition against the shipped baseline would be a two-variable
  // comparison crediting the seam under test with the whole of that move.
  {
    id: 'art-off',
    label: '?art=off alone — the sibling the two composed rows below are read against',
    seams: { artOff: true },
    subject: 'dominaria',
    requireRing: true,
    // Expected GREEN on every measure, and that is the point of the row: `?art=off` is not a
    // falsifier. It removes card art and leaves §1.4's swatch palette and §1.3's band chain exactly
    // as the build composes them, so a picture made only of swatches still has to clear all three
    // floors. If this row goes RED the composed rows below say nothing — their redness would be
    // the seam that is *common* to them, not the seam each is testing.
    expect: [
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'GREEN' },
      { criterion: 'W2', measure: 'lightnessIqr', expect: 'GREEN' },
      // **`N/A`, and this is where board ruling `fold_mean` is felt.** W3's verdict is now a mean
      // over the roster's twenty-eight in-domain worlds, and a single world's reading is not a
      // small version of that — dominaria reads ~1.3 under `?art=off` against a floor derived from
      // a roster mean of ~3.4, so scoring this row against the roster floor would red the sibling
      // every composed control row is read against, for arithmetic rather than for a defect.
      // W3's live falsifier is the `w3-floor-control` tour below, which is the same fold on the
      // same domain. Asserted as `N/A` rather than dropped, because "a roster statistic may not be
      // scored on one world" is a property worth a control of its own.
      { criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'N/A' },
    ],
  },
  {
    id: 'artoff-swatch-mean',
    label: '?art=off&swatch=mean — every cell takes the plane’s mean swatch, and draws it',
    seams: { artOff: true, swatchMean: true },
    // dominaria, and not for size alone: it is one of only two v3 worlds whose iso-shade ring
    // clears the lightness half's domain, so it is one of only two worlds on which this row can
    // return RED rather than `insufficient`. `requireRing` makes that a checked precondition.
    subject: 'dominaria',
    requireRing: true,
    expect: [
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'RED' },
      { criterion: 'W2', measure: 'lightnessIqr', expect: 'RED' },
    ],
  },
  {
    id: 'artoff-bands-shuffle',
    label: '?art=off&bands=shuffle — cards permuted across the plane’s cells, grid and band unchanged',
    seams: { artOff: true, bandsShuffle: true },
    subject: 'dominaria',
    // **This row stopped being W3's falsifier when the fold became the mean (ruling `fold_mean`).**
    // A one-world row cannot falsify a roster mean: dominaria's shuffled reading is ~0.42 and its
    // unshuffled one ~1.3, both far below a floor derived over twenty-eight worlds, so *every*
    // colour it could report would be red — including the sibling's. A control that must be red
    // whatever the build does is not a control.
    //
    // W3's falsifier moved to `w3-floor-control`, the full `?art=off&bands=shuffle` tour, which is
    // the fold the floor was derived on and the only thing the floor can be read against. The cost
    // is honest and is stated in §3.1: W3's live falsifier is a full tour, so `--negative-controls`
    // no longer carries one and the derivation pair has to be run to exercise it.
    //
    // The row is kept, because the seam still has to engage here and because pinning the `N/A`
    // stops a later edit from quietly scoring a roster statistic on one world again.
    expect: [{ criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'N/A' }],
  },
  {
    // **W4's art half has no other live falsifier, and this row is why it needs one.** The `fixed24`
    // row below was §3.1's, and on the shipped tree it no longer perturbs anything: the adaptive
    // quantile at a 1,024-layer pool already sits *at* the 24 px floor, so forcing 24 px changes the
    // threshold by nothing, and since the byte budget became capacity-derived it is 155 MB against
    // ~95 MB outstanding, so nothing is starved either. Measured both ways — see the comment on that
    // row. A seam can engage and still move no pixel; see `a-control-can-perturb-the-wrong-layer`.
    //
    // Composing the two seams restores the condition Appendix A actually captured, which was never
    // "a fixed threshold" on its own but **a fixed threshold against a pool too small for it**:
    // 24 px keeps demand at dominaria's full ~945 cells while the pool holds 128, a ~7.4x overshoot
    // against `tether-surface`'s 2.69x. That is *pool* starvation, the reading `fixed24` alone used
    // to deliver by exhausting a flat 64 MB budget and no longer can.
    //
    // **This row can only be RED because of ruling `absolute_floor`**, which is what makes it worth
    // having rather than merely a louder version of the old one. A pool-starved frame is saturated,
    // so `artFraction` equals its ceiling exactly; against `0.9 x ceiling` it passed at every
    // capacity, and this row would have been GREEN at ~13% art. It is the live counterpart of the
    // `tether-surface` fixture in `worlds-metrics.test.ts` — same defect, same arithmetic, measured
    // in the shipped composition rather than read off the prototype's capture.
    // **This row is now §3.1's named W4 falsifier, and the bare `?artThreshold=fixed24` row that
    // used to be is gone** (DEC-752 ask `f9e273fb`, board answer `replace_row`, 2026-09-17). The
    // bare seam was retired rather than re-fitted: it engages, it reads its policy back
    // (`effectiveThresholdPx = 24`), and it moves no pixel, because the adaptive quantile at a
    // 1,024-layer pool already sits at the 24 px floor and the capacity-derived byte budget — 155 MB
    // against ~95 MB outstanding — no longer starves it. Both of the things that made it a control
    // stopped being true, on the shipped tree, for reasons that are improvements. Re-fitting its
    // expectations to whatever it happens to read now would have kept a row and lost a control.
    id: 'fixed24-layers-128',
    label: '?artThreshold=fixed24&layers=128 — a prototype threshold against a tier-4 pool',
    seams: { artThresholdFixed24: true, layersRequested: 128 },
    subject: 'dominaria',
    expect: [
      { criterion: 'W4', measure: 'artFraction', expect: 'RED' },
      { criterion: 'W4', measure: 'demandFitsCapacity', expect: 'RED' },
      // **`N/A`, and it is `N/A` for a new reason since ruling `bd5c9aad`.** It used to be the exit
      // domain — a budget-exhausted pool cannot evict — and it is now the capacity domain: this row
      // runs 128 layers and the bound is derived at 1,024. Asserted rather than dropped, because the
      // row's job after the re-bound is to stay RED *against 21/s*, and "RED somewhere" is not the
      // same claim as "RED here". Its redness is `artFraction`'s (0.1342 against a bar of 0.5, a
      // 7.39× pool overshoot) and never the eviction half's, which is what this line pins: raising
      // the bound from 5 to 21 cannot have greened this row, because the bound was never what
      // coloured it.
      { criterion: 'W4', measure: 'evictionsPerSecond', expect: 'N/A' },
      // Pool-starved, not threshold-starved: the 24 px seam keeps dominaria's full ~945-cell want
      // set and the pool shows ~128 of them, which is above the absolute floor. The starvation term
      // aims at a *collapsed want set* and this row does not have one — asserted so the two failure
      // modes cannot be confused for each other on the one row that exhibits the other.
      { criterion: 'W4', measure: 'artCellsShowing', expect: 'GREEN' },
    ],
  },
  {
    id: 'layers-128',
    label: '?layers=128 — a tier-4-sized pool, unmodified policy',
    seams: { layersRequested: 128 },
    subject: 'dominaria',
    expect: [
      { criterion: 'W4', measure: 'artFraction', expect: 'GREEN' },
      // **`N/A`, not GREEN, and the demotion is the ruling's second half showing through
      // (`bd5c9aad`, option (a)).** This rung reads 6.73/s, comfortably inside 21 — and that number
      // is worthless as a pass. A 128-layer pool churns less *because it refuses the wants it cannot
      // hold*: ~4,670 wants/s declined for exhaustion, `artFraction` down to ~0.617. Recording that
      // as a green eviction half would let the gate certify, as good behaviour, the one thing the
      // other half of W4 exists to forbid. The bound is derived at 1,024 and is scored there alone.
      { criterion: 'W4', measure: 'evictionsPerSecond', expect: 'N/A' },
      // The tier-4 rung is where the absolute term is closest to binding on a *healthy* build —
      // ~126 cells of art against a floor of 64 — so this is the row that says the floor leaves the
      // smallest shipped pool room to pass. The witness it must red (14 cells, want set collapsed
      // under reduced motion) is unreachable from a query seam; it is pinned in the unit rows.
      { criterion: 'W4', measure: 'artCellsShowing', expect: 'GREEN' },
      // **The overshoot the reachable bar forgives, asserted so it cannot go quiet.** Ruling
      // `demand_measure_scored` is `reported_only`, so this measure cannot colour the row — which
      // makes it exactly the kind of number that stops being read. Naming it here keeps it
      // falsifiable: the policy admits ~205 cells into a 128-layer pool, 1.60× capacity, and the day
      // it stops doing that this row goes red and someone has to look.
      { criterion: 'W4', measure: 'demandFitsCapacity', expect: 'RED' },
    ],
  },
  {
    id: 'no-seams',
    label: 'dominaria at the 2.2-radii pose with no seams — the sibling every control row is read from',
    seams: {},
    subject: 'dominaria',
    requireRing: true,
    // The row that says what the *unseamed* capture is made of at the pose the criteria measure at.
    // Its `artFraction` is the number §1.6's argument for `?art=off` rests on: if almost every cell
    // draws art, a seam that only moves the swatch moves nothing the capture shows.
    expect: [
      { criterion: 'W2', measure: 'medianNeighbourDeltaE', expect: 'GREEN' },
      { criterion: 'W2', measure: 'lightnessIqr', expect: 'GREEN' },
      // `N/A` for the same reason as the two rows above: one world is not the mean fold's domain.
      { criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'N/A' },
      { criterion: 'W4', measure: 'artFraction', expect: 'GREEN' },
    ],
  },
  // ---- W3's floor, derivable rather than asserted ----------------------------------------------
  // `FLOORS.bandDeltaE` has to sit between two **roster means**, because §3.1 folds W3 to the mean
  // over its in-domain worlds and not to dominaria. These two rows are how that pair is measured:
  // same tour, same pose, differing in the one seam under test. `derivation: true` keeps them out of
  // `--negative-controls` — they are two full tours — while leaving them runnable:
  //
  //   node scripts/worlds-gate.mjs --only w3-floor-shipped,w3-floor-control --no-captures \
  //     --out worlds-gate/w3floor && node scripts/w3-floor.mjs worlds-gate/w3floor
  //
  // **These two rows are also W3's only live falsifier now (board ruling `fold_mean`, DEC-836).**
  // The fold is a mean over the roster's in-domain worlds, so the only thing that can be read
  // against its floor is another tour of the same domain — the one-world `artoff-bands-shuffle` row
  // above cannot, and says so. That makes the pair scored as well as derivational, and the cost is
  // real: exercising W3's falsifier is two full tours, so `--negative-controls` does not carry one.
  //
  // **On the derivation pass that *sets* the floor these two expectations are satisfied by
  // construction, and they are not evidence there.** Their value is on every later run: a build that
  // stops separating from its own shuffled control reds the pair, which is exactly the DEC-816
  // impasse (a criterion whose falsifier scores *above* it) turned into a check instead of a note.
  //
  // **One pair of tours is not enough to pick a floor, and the retired 0.55 is the proof (DEC-752,
  // from DEC-830).** Run each arm at least five times and read the shipped arm's *minimum* against
  // the control's *maximum*: 0.55 came from a single acceptance tour under the old min fold, and at
  // n=5 that fold spanned 0.4253–0.8005 while its control reached 0.4477, so it separated nothing.
  // `scripts/w3-floor.mjs` takes several runs per arm and does that arithmetic; `scripts/w3-fold.mjs`
  // re-scores the same readings five ways to check the fold still converges at the n you used.
  {
    id: 'w3-floor-shipped',
    label: 'W3 floor derivation: ?art=off over the full tour (the shipped side)',
    seams: { artOff: true },
    tour: 'all',
    derivation: true,
    expect: [{ criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'GREEN' }],
  },
  {
    id: 'w3-floor-control',
    label: 'W3 floor derivation: ?art=off&bands=shuffle over the full tour (the control side)',
    seams: { artOff: true, bandsShuffle: true },
    tour: 'all',
    derivation: true,
    expect: [{ criterion: 'W3', measure: 'minAdjacentBandDeltaE', expect: 'RED' }],
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
      // **The absolute no-starvation term's domain, asserted at the extreme that defines it.** A
      // floor of "64 cells must be showing art" is the one shape of bound a one-card world can never
      // clear, so the term is scored only where the frame is *geometrically* able to offer 64
      // front-facing on-screen cells. Segovia offers one. Asserting the `N/A` here is what stops the
      // domain from later being written off `wanting` — the want set is the adaptive threshold's
      // output, and a term whose domain the policy chooses is the collapse this term exists to
      // catch, one level up. `artFraction` above still scores this world, as it is defined at n = 1.
      { criterion: 'W4', measure: 'artCellsShowing', expect: 'N/A' },
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
    reverse: false,
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
    else if (argv[i] === '--reverse') args.reverse = true
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
  const dir = resolve(args.out, row.id)
  mkdirSync(dir, { recursive: true })

  // ---- W5 rows --------------------------------------------------------------------------------
  // The home view is one page: the sweep's parameter is the multiverse rotation and the criterion
  // is about the whole roster at once, so there is no per-world session to give it.
  if (row.w5) {
    const { page, errors } = await openPage(browser, url, { seams: row.seams, viewport })
    try {
      const swept = await sweepHomeView(page, { minAzimuths: args.minAzimuths })
      if (!swept.ok) return { row, setupFailure: swept, criteria: [], checks: [], errors }
      const w5 = evaluateW5(swept.sweep, roster.metricsRoster, {
        worldsWithCards: roster.worldsWithCards.map((p) => p.slug),
        minAzimuths: args.minAzimuths,
      })
      writeFileSync(resolve(dir, 'sweep.json'), `${JSON.stringify(swept, null, 2)}\n`)
      return { row, criteria: [w5], checks: scoreRow(row, [w5]), sweep: swept, errors }
    } finally {
      await page.close()
    }
  }

  // ---- W1–W4 rows -----------------------------------------------------------------------------
  // `--reverse` is the runbook's order control, and it takes the SAME set the forward run took
  // before reversing it — `slice` then `reverse`, never `reverse` then `slice`, which under
  // `--tour-limit` would tour a different set of worlds and compare two tours instead of two
  // orders. Per-world sessions are supposed to make a world's W4 independent of where in the tour
  // it sits; this is the reading that checks it rather than assuming it.
  const toured =
    row.tour === 'all'
      ? roster.worldsWithCards.slice(0, args.tourLimit ?? roster.worldsWithCards.length)
      : [roster.worldsWithCards.find((p) => p.slug === row.subject)]
  const subjects = args.reverse ? [...toured].reverse() : toured
  if (subjects.some((s) => s === undefined)) {
    throw new Error(`row ${row.id} names world ${row.subject}, which is not in this dataset`)
  }

  const errors = []
  const visits = []
  const evidencePerWorld = []
  let probeNow = null

  // **One session per world, and this is a correctness requirement rather than hygiene.** W1-W3 are
  // pose-and-pixel measurements that would survive a shared page, but W4 is not: the art stream and
  // its byte budget are session-global and cumulative (`worldsProbe.ts` says so of this very
  // field), so on a shared page a world's W4 is a function of *where in the tour it was visited*.
  // Measured before this changed, on the 45-world run at main `28ec706`: the budget bound at the
  // 8th world and the remaining 37 all read `artFraction` 0. Per-world sessions make the reading
  // order-independent, which is a property the reversed-order control in the runbook checks rather
  // than assumes. `budgetBoundAtEntry` is the backstop for anyone who tours a shared page anyway.
  for (const world of subjects) {
    const opened = await openPage(browser, url, { seams: row.seams, viewport })
    try {
      const visit = await visitWorld(opened.page, world, {
        dir,
        captures: args.captures,
        pose: row.pose ?? SURFACE_RADII,
      })
      visits.push(visit)
      if (!visit.ok) {
        console.log(`  ${world.slug}: SETUP FAILURE — ${visit.detail}`)
      } else {
        // The pool's high-water mark rides the W4 verdict because it is the eviction half's
        // denominator: `pool 1024` alone says what the pool *could* hold, and a `W4 pass` earned by
        // a pool that never filled is indistinguishable from one earned by a pool that filled and
        // did not churn. `hw` is `resident` only — see `poolHighWater` on why it is a lower bound.
        const hw = visit.poolHighWater
        // **W3 prints its reading, not a verdict, and that is the mean fold showing through.** Its
        // floor is derived on the roster mean, so on any correct tour roughly half the domain sits
        // below it — printing `W3 fail` on those worlds would be a report contradicting its own
        // GREEN. The number is what a reader of this line can actually use; the verdict is one line
        // in the matrix, taken once, over the whole domain.
        const w3 = visit.w3.measures[0]
        // **The eviction tail rides the line for the same reason the high-water mark does.** Its
        // rate is now `null` on three different domain outcomes — wrong pool capacity, too short a
        // tail, a tail that never settled — and `W4 insufficient` alone cannot say which. A domain
        // rule that can quietly swallow the one world that churns is the risk this change carries,
        // so the driver prints what the rule saw on every world, green ones included.
        const tail = visit.w4.evictionTail
        const ev = visit.w4.measures.find((m) => m.key === 'evictionsPerSecond')
        console.log(
          `  ${world.slug}: ${visit.cardinality.reported}/${visit.cardinality.cardCount} cells, ` +
            `pool ${visit.poolLayers}, threshold ${visit.effectiveThresholdPx.toFixed(2)}px, ` +
            `W2 ${visit.w2.status} W3 ${w3.value === null ? 'n/a' : w3.value.toFixed(4)} ` +
            `W4 ${visit.w4.status}` +
            (hw === null
              ? ''
              : ` (pool hw ${hw.resident}/${hw.layers}${hw.saturated ? ' SATURATED' : ''})`) +
            ` [art ${visit.w4.showing}/${visit.w4.presented} presented; ev ` +
            (ev.status === 'insufficient'
              ? `n/a — ${visit.w4.atEvictionPool ? 'tail' : `pool ${visit.poolLayers}`}`
              : `${tail.rate.toFixed(2)}/s over ${tail.spanS.toFixed(1)}s tail from ` +
                `t=${tail.plateauT.toFixed(1)}s @${tail.peakResident}, drift ` +
                `${(tail.drift * 100).toFixed(1)}%`) +
            `]`,
        )
      }

      // The seam is asserted to have *engaged* before any criterion of this row is read. A seam that
      // silently fails to parse runs the unmodified policy, its criterion passes, and the matrix
      // records a passing control — which reads as a passing gate.
      //
      // **Bare on purpose, and one of only two such reads left.** `seamEvidence` reads `seams` and
      // `pool`, both session-global; threading a slug would turn a whole-session reading into a
      // claim about one world. Taken once per session now that each world has its own, so the row's
      // seam evidence is 45 independent page loads agreeing rather than one read at the end.
      const read = await readProbe(opened.page)
      if (read.ok) {
        probeNow = read.probe
        evidencePerWorld.push({ slug: world.slug, evidence: seamEvidence(read.probe, row.seams, baselineProbe) })
      }
    } finally {
      errors.push(...opened.errors)
      await opened.page.close()
    }
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

  // One session's evidence stands for the row, and the others are checked against it rather than
  // discarded: with a page per world the same seam is now exercised on every load, so a seam that
  // engages on some loads and not others is a fact this row can see. Disagreement is a setup
  // failure, because a criterion folded over sessions that ran different policies is not a reading.
  const evidence = evidencePerWorld.length === 0 ? [] : evidencePerWorld[0].evidence
  const disagreeing = evidencePerWorld.filter(
    (e) =>
      e.evidence.length !== evidence.length ||
      e.evidence.some((row_, i) => row_.engaged !== evidence[i].engaged),
  )
  if (disagreeing.length > 0) {
    return {
      row,
      setupFailure: {
        reason: 'seam-disagreement',
        detail:
          `the row's seams engaged on ${evidencePerWorld.length - disagreeing.length} of ` +
          `${evidencePerWorld.length} sessions; they disagree on ` +
          `${disagreeing.map((e) => e.slug).join(', ')}`,
      },
      criteria: [],
      checks: [],
      evidence,
      visits,
      errors,
    }
  }

  // **A control that goes `insufficient` is not a control — it died on its precondition arm.**
  // W2's lightness half is scored over the iso-shade ring and its domain is `W2_MIN_RING_SAMPLES`
  // (ruling `w2_ring`), which on the v3 roster only dominaria (61–64) and ravnica (22) clear. So the
  // subject of `swatch-mean` — the half's only falsifier — is load-bearing, and moving it to any
  // other world would turn a RED expectation into a silent `n/a`. The row declares that it needs a
  // ring and the run refuses to score it without one, rather than reporting a retired falsifier as
  // a passing matrix.
  if (row.requireRing) {
    const rings = good.map((v) => ({ slug: v.slug, ring: v.w2?.isoShadeSampled ?? 0 }))
    const short = rings.filter((r) => r.ring < W2_CONTROL_SUBJECT_MIN_RING)
    if (short.length > 0) {
      return {
        row,
        setupFailure: {
          reason: 'control-subject-below-ring-domain',
          detail:
            `row ${row.id} must falsify W2.lightnessIqr, whose domain is ` +
            `${W2_CONTROL_SUBJECT_MIN_RING} iso-shade cells, but its subject offers ` +
            `${short.map((r) => `${r.slug}: ${r.ring}`).join(', ')} — the row would report ` +
            `insufficient, which is not RED`,
        },
        criteria: [],
        checks: [],
        evidence,
        visits,
        errors,
      }
    }
  }

  // **W3's fold is the mean (board ruling `fold_mean`), so it is the one criterion whose denominator
  // has to be an expectation rather than a count of itself.** A worst-case fold over a narrowed
  // domain can only move up and prints `scoredPlanes` beside itself; a *mean* over a narrowed domain
  // reads in the same units and is flattered by the narrowing. `rosterDomain` is `null` for a row
  // that toured one subject, which makes the fold report `insufficient` rather than score a
  // one-world "mean" against a floor derived over twenty-eight.
  const rosterDomain =
    row.tour === 'all'
      ? {
          expected: W3_DOMAIN_SIZE[roster.hash] ?? null,
          // Derived from this run's own probes, never from the readings the fold is about to take:
          // a world drops out of W3's domain either because its band shares do not qualify (a
          // dataset fact) or because a qualifying band went unsampled at the pose (a run fact), and
          // only the second is a thinning. `null` when a visit carried no shares at all, so an
          // older payload disables this half instead of asserting 0.
          qualifying: good.every((v) => Array.isArray(v.bandShares))
            ? good.filter((v) => w3QualifiesByShares(v.bandShares)).length
            : null,
          label: `dataset ${roster.hash}`,
        }
      : null

  const criteria = [
    evaluateW1(
      good.map((v) => ({ slug: v.slug, cells: row.w1At === 'pose' ? v.poseCells : v.settleCells })),
    ),
    foldCriteria(good.map((v) => ({ slug: v.slug, criterion: v.w2 }))),
    foldCriteria(good.map((v) => ({ slug: v.slug, criterion: v.w3 })), { rosterDomain }),
    foldCriteria(good.map((v) => ({ slug: v.slug, criterion: v.w4 }))),
  ].filter((c) => c !== null)

  writeFileSync(
    resolve(dir, 'visits.json'),
    `${JSON.stringify({ visits, evidence, evidencePerWorld, criteria }, null, 2)}\n`,
  )
  return { row, criteria, checks: scoreRow(row, criteria), evidence, visits, errors, probe: probeNow }
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
  // Said before the browser starts, because "this dataset has no recorded W3 domain" is a fault that
  // reds every roster tour in the run and there is no reason to spend the tour first. It is not a
  // substitute for the check inside the fold — that one scores it — this is the early warning.
  console.log(
    W3_DOMAIN_SIZE[roster.hash] === undefined
      ? `W3 domain: NO SIZE RECORDED for ${roster.hash} — every roster tour will red on its fold`
      : `W3 domain, recorded: ${W3_DOMAIN_SIZE[roster.hash].scored} worlds scored ` +
        `(the mean fold's denominator), ${W3_DOMAIN_SIZE[roster.hash].byShares} qualifying by band ` +
        `share — the gap is worlds whose cards qualify and whose sampled cells populate one band`,
  )

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
  // `derivation` rows are reachable by `--only` and never by `--negative-controls`. They are how a
  // floor gets re-derived rather than re-asserted — a constant cannot testify to its own provenance,
  // and a derivation nobody can re-run is a number with a story attached. They are excluded from the
  // matrix because they are full tours: two of them would add ninety world-visits to every controls
  // run, and a gate that takes two hours is a gate that stops being run.
  const selected =
    args.only !== null
      ? MATRIX.filter((row) => args.only.includes(row.id))
      : args.negativeControls
        ? MATRIX.filter((row) => row.derivation !== true)
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
    //
    // **`?art=off` needs it too, and for the opposite reading** — its third clause is `pool.layers`
    // *unmoved*, which is what separates the seam from `?layers=0`. Keying this on the layers rows
    // alone would silently drop that clause from every `--only` selection that happens not to
    // include one, leaving the strongest half of the witness unchecked on exactly the runs a
    // reviewer reaches for. The condition is per-seam because the need is.
    let baselineProbe = null
    if (
      selected.some(
        (row) => typeof row.seams.layersRequested === 'number' || row.seams.artOff === true,
      )
    ) {
      const { page } = await openPage(browser, url, { seams: {} })
      // Bare for the same reason as the seam-evidence read: the baseline exists to carry
      // `pool.layers`, which is session-global, and it is taken on a freshly opened page that has
      // flown to no world at all.
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

  // ---- the matrix census ------------------------------------------------------------------------
  // §3.2's condition 1 states the matrix's expected shape as a pair of counts, and that pair has gone
  // stale twice already: "five red and two green" was written when the matrix had seven rows, and the
  // "four green" that replaced it predates the two `?art=off` sibling rows (DEC-821). A count kept
  // only in prose has nothing holding it to the instrument, so the instrument reports its own and the
  // spec cites this line instead of carrying a number.
  //
  // Counted over the whole of `MATRIX`, never over `selected`. A `--only` or `--negative-controls`
  // run scores a subset, and a census that narrowed with the selection would print a smaller pair in
  // the same shape — reading as the full matrix while standing for a fraction of it.
  //
  // **`derivation` is a cost bucket, not an "unscored" one, since ruling `fold_mean` (DEC-836).**
  // The two W3 floor tours now carry expectations like any other row; what still separates them is
  // that they are full tours and so stay out of `--negative-controls`. They are counted in their
  // colour *and* reported as derivation, because a census that hid them would say W3 has no
  // expected-RED row anywhere — which, for a fifteen-minute-matrix reader, is exactly the wrong
  // conclusion to draw.
  const census = { RED: 0, GREEN: 0, na: 0, mixed: 0, derivation: 0 }
  for (const row of MATRIX) {
    if (row.derivation) census.derivation += 1
    // `?? []` because this runs after the tour: a row added without `expect` would otherwise throw
    // here and take a twenty-minute run's report with it, which is a bad trade for a census line.
    const expectations = row.expect ?? []
    const colours = new Set(expectations.map((e) => e.expect).filter((e) => e !== 'N/A'))
    // A row is named by the colour it expects. `mixed` is counted rather than folded into either
    // side, because a row expecting both is a row whose redness no longer says which measure failed
    // — and silently filing it under RED would hide that. It is **reached**: `layers-128` expects
    // GREEN on both W4 halves and RED on the overshoot `demandFitsCapacity` reports, which is what
    // ruling `demand_measure_scored` left the row looking like. The comment here said "not reachable
    // today" until DEC-836 read the census line it describes.
    //
    // A row whose every expectation is `N/A` gets its own bucket rather than falling through to
    // GREEN, which is where it used to land. `artoff-bands-shuffle` became such a row under the mean
    // fold, and counting an all-`N/A` row as expected-GREEN would have quietly kept the green count
    // intact while W3 lost its one-world control — the census line exists to make that visible.
    if (colours.has('RED') && colours.has('GREEN')) census.mixed += 1
    else if (colours.has('RED')) census.RED += 1
    else if (colours.size === 0 && expectations.length > 0) census.na += 1
    else census.GREEN += 1
  }
  console.log(
    `\nmatrix census: ${census.RED} expected-RED rows, ${census.GREEN} expected-GREEN, ` +
      `${census.na} N/A-only, ${census.derivation} of them derivation tours ` +
      `(excluded from --negative-controls)${census.mixed ? `, ${census.mixed} MIXED` : ''} ` +
      `— ${selected.length} of ${MATRIX.length} scored this run`,
  )

  writeFileSync(
    resolve(args.out, 'summary.json'),
    `${JSON.stringify(
      {
        dataset: args.dataset,
        hash: roster.hash,
        worldsWithCards: roster.worldsWithCards.length,
        ceiling: homeLabelCeiling(roster.metricsRoster),
        floors: FLOORS,
        census: { ...census, matrixRows: MATRIX.length, scoredThisRun: selected.length },
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
