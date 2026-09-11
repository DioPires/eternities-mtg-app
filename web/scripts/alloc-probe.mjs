/**
 * Count GPU texture allocations per second at steady state, for DEC-692 R1's evidence.
 *
 * The review measured the shipped app at ~42 `createTexture` per second and ~308 MB/s of render
 * targets, in every phase, for the whole session (§2.1, §2.2). That is one `SelectiveBloomEffect`
 * rebuilt twice a second and never disposed. This is the instrument that reads it back, so the fix
 * is measured the same way the defect was.
 *
 *   node scripts/alloc-probe.mjs --url http://127.0.0.1:4173 --seconds 20 --out /tmp/run
 *
 * Two modes. `--mode levels` (the default, and the one above) counts the steady state at each of
 * the three levels. `--mode tiers` counts the net across runtime *tier changes* for DEC-698 note
 * N2, driving them with CDP CPU throttling because nothing else moves the ladder at runtime:
 *
 *   node scripts/alloc-probe.mjs --mode tiers --url http://127.0.0.1:4173 --out /tmp/run
 *
 * See {@link sweepTiers} for why throttling, why an idle window first, and why multiverse level.
 *
 * How it counts. `WebGL2RenderingContext.prototype` is wrapped through `evaluateOnNewDocument`, so
 * the hooks are installed before the app's first line: `createTexture`/`deleteTexture` for the
 * count, and `texImage2D`/`texStorage2D` for the bytes, sized from the arguments and the format.
 * Bytes are what matters — a 2880×1620 RGBA16F target is 37 MB and a 12×7 mip is nothing.
 *
 * `?probe=shell` gives `window.__eternitiesProbe`, whose `state()` reports the drawing buffer and
 * both bloom resolutions and whose `focusPlane`/`focusCard` drive the tour. The count is taken per
 * *phase*, after the phase has settled, because an allocation burst on entering a level is a real
 * cost that happens once and the defect being measured is the one that never stops.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { argv, exit } from 'node:process'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const URL_BASE = arg('url', 'http://127.0.0.1:4173')
const SECONDS = Number(arg('seconds', '20'))
const OUT = arg('out', null)
const LABEL = arg('label', 'run')
/** `levels` — the original per-level sweep. `tiers` — DEC-698 note N2; see {@link sweepTiers}. */
const MODE = arg('mode', 'levels')
/**
 * CDP CPU throttling rates to walk the ladder with, in order. `1` is unthrottled.
 *
 * Chosen to cross the monitor's band in both directions more than once, so the sweep contains
 * degrades *and* restores and ends back where it started. Rates rather than tiers because there is
 * no tier setter — see {@link sweepTiers}.
 */
const RATES = arg('rates', '1,6,20,6,1,20,1')
  .split(',')
  .map((r) => Number(r.trim()))
/** How long to wait for the monitor to react to one throttling rate before moving on. */
const SETTLE_MS = Number(arg('settle', '12000'))
/**
 * Device pixel ratio for the page, because at 1 the ladder's `pixel-ratio` rung is unobservable.
 *
 * `QUALITY_TIERS` caps dpr at 1.5 for `full` and 1.0 for `pixel-ratio`, and the renderer takes the
 * `min` of the cap and the device's own ratio — so at `deviceScaleFactor: 1` both rungs clamp to 1,
 * the drawing buffer never changes across that transition, and nothing downstream of it resizes.
 * Measured: the drawing buffer held 1920x1080 across a full->pixel-ratio->full sweep on both the
 * shipped and the owned chain. At 2 the same transition moves it 2880x1620 <-> 1920x1080, which is
 * what makes the rung a real event and, on the shipped chain, the only ladder trigger that rebuilt
 * the effect chain at all (the bloom rung being inert is review finding R3).
 */
const DPR = Number(arg('dpr', '1'))

/**
 * Installed before any app code. Counts into `window.__alloc`, which the driver samples.
 *
 * Sizing a `texImage2D` needs the format and type; the table covers what this app uses (RGBA16F
 * and RGBA8 targets, RGB8/RGBA8 atlas pages, RGBA32F for the plane table) and falls back to 4
 * bytes per pixel, which under-counts float targets rather than inflating the result.
 */
const HOOKS = `
(() => {
  const state = { created: 0, deleted: 0, bytes: 0, uploads: 0, liveBytes: 0 }
  window.__alloc = state
  const BYTES = {
    32856: 4, 32849: 4, 6408: 4, 6407: 3, 34842: 8, 34843: 6, 34836: 16, 34837: 12,
    33189: 2, 35056: 4, 36012: 4, 36208: 4, 36013: 4,
  }
  const size = (internalFormat, width, height) => {
    const per = BYTES[internalFormat] ?? 4
    return (width | 0) * (height | 0) * per
  }
  /*
   * \`bytes\` is allocation *traffic* and \`liveBytes\` is what is still held (DEC-703).
   *
   * The difference is the whole of note N2. Rebuilding the post chain at a new size legitimately
   * uploads bytes — that is the cost of the rung, not a defect — so a bytes-per-second figure
   * cannot tell a chain that reallocates cleanly from one that reallocates and keeps the old
   * targets. Attributing each upload to the texture that was bound when it happened, and
   * subtracting on \`deleteTexture\`, makes "zero net render-target leak" a number rather than an
   * inference from the texture count.
   *
   * Uploads land on whatever is bound to the target, so the binding has to be tracked to know
   * whose bytes they are; \`held\` is keyed by the texture object's own identity.
   */
  const bound = new Map()
  const held = new Map()
  const attribute = (target, bytes) => {
    state.bytes += bytes
    state.liveBytes += bytes
    const texture = bound.get(target)
    if (texture) held.set(texture, (held.get(texture) ?? 0) + bytes)
  }
  const patch = (proto) => {
    if (!proto || proto.__allocPatched) return
    proto.__allocPatched = true
    const create = proto.createTexture
    proto.createTexture = function () { state.created += 1; return create.apply(this, arguments) }
    const remove = proto.deleteTexture
    proto.deleteTexture = function (texture) {
      state.deleted += 1
      const bytes = held.get(texture)
      if (bytes !== undefined) { state.liveBytes -= bytes; held.delete(texture) }
      return remove.apply(this, arguments)
    }
    const bind = proto.bindTexture
    proto.bindTexture = function (target, texture) {
      bound.set(target, texture)
      return bind.apply(this, arguments)
    }
    const storage = proto.texStorage2D
    if (storage) {
      proto.texStorage2D = function (target, levels, internalFormat, width, height) {
        state.uploads += 1
        attribute(target, size(internalFormat, width, height))
        return storage.apply(this, arguments)
      }
    }
    const image = proto.texImage2D
    proto.texImage2D = function (target, level, internalFormat, width, height) {
      // The 6-argument DOM-source overload has no width/height; those are atlas uploads, not
      // render targets, and they are counted by \`uploads\` without bytes.
      state.uploads += 1
      if (typeof width === 'number' && typeof height === 'number') {
        attribute(target, size(internalFormat, width, height))
      }
      return image.apply(this, arguments)
    }
  }
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype)
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype)
})()
`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readAlloc(page) {
  return page.evaluate(() => ({ ...window.__alloc }))
}

async function measure(page, name, seconds) {
  // Settle first: entering a level legitimately allocates once (a shard's thumbnails, a card's
  // textures). What is being measured is the steady state after that.
  await sleep(2500)
  const before = await readAlloc(page)
  const t0 = Date.now()
  await sleep(seconds * 1000)
  const after = await readAlloc(page)
  const elapsed = (Date.now() - t0) / 1000
  const state = await page.evaluate(() => window.__eternitiesProbe.state())
  return {
    phase: name,
    seconds: Number(elapsed.toFixed(2)),
    createdPerSecond: Number(((after.created - before.created) / elapsed).toFixed(2)),
    deletedPerSecond: Number(((after.deleted - before.deleted) / elapsed).toFixed(2)),
    uploadsPerSecond: Number(((after.uploads - before.uploads) / elapsed).toFixed(2)),
    megabytesPerSecond: Number(
      ((after.bytes - before.bytes) / elapsed / (1024 * 1024)).toFixed(3),
    ),
    drawingBuffer: state.quality.drawingBuffer,
    pixelRatio: state.quality.pixelRatio,
    bloomSource: state.quality.bloomSource,
    bloomLevels: state.quality.bloomLevels,
    tier: state.quality.tier,
    level: state.level,
  }
}

/** The ladder-relevant slice of `ProbeState.quality`, tolerant of either chain's field names. */
async function readTier(page) {
  return page.evaluate(() => {
    const q = window.__eternitiesProbe.state().quality
    return {
      tier: q.tier,
      tierIndex: q.tierIndex,
      pixelRatio: q.pixelRatio,
      drawingBuffer: q.drawingBuffer,
      // `bloomSource` is the owned chain's (DEC-703); `bloom`/`bloomBlur` were the old wrapper's.
      // Both are read so one script can measure both builds and the report says which it saw.
      bloomSource: q.bloomSource ?? null,
      bloomLevels: q.bloomLevels ?? null,
      bloomLegacy: q.bloom ?? null,
      bloomLegacyBlur: q.bloomBlur ?? null,
    }
  })
}

/**
 * DEC-698 note N2: count net texture allocations across *runtime tier changes*.
 *
 * N2 measured `Effects.tsx:181` leaking ~9 textures / ~33 MB net on every effect rebuild, because
 * the disposal path covered about half of what the rebuild allocated. A rebuild happens on a tier
 * change, so this drives tier changes and reads the net back.
 *
 * **Why CPU throttling and not `?quality=N`.** A pin is applied before the chain is ever built, so
 * a pinned load allocates once and proves nothing about disposal. The leak needs the *transition*,
 * and the only thing in the app that moves the ladder at runtime is the frame-time monitor. CDP's
 * `Emulation.setCPUThrottlingRate` makes frames genuinely slow enough to degrade and, released,
 * fast enough to restore (established on DEC-698). There is no tier setter on the probe seam.
 *
 * **Why an idle window first.** The scene allocates textures at steady state for reasons that have
 * nothing to do with the post chain, so a raw `created - deleted` across a 90-second sweep would
 * charge that drift to the ladder. `idle` measures the same quantity over the same kind of window
 * with the throttle untouched and no tier change, and the summary reports the sweep both raw and
 * with that drift subtracted.
 *
 * **Why multiverse level.** Rung 3 is the atlas capacity, and at plane or card level a tier change
 * would legitimately reallocate atlas pages — real cost, but not the post chain's. At multiverse
 * level the card tier is idle, so what moves across a transition is the chain and little else.
 */
async function sweepTiers(page) {
  const session = await page.createCDPSession()
  const setRate = async (rate) =>
    session.send('Emulation.setCPUThrottlingRate', { rate: Math.max(1, rate) })

  const baseline = { ...(await readTier(page)), alloc: await readAlloc(page) }

  // Drift: the same window, same level, no throttle change, no tier change.
  const idleBefore = await readAlloc(page)
  const idleT0 = Date.now()
  await sleep(SETTLE_MS)
  const idleAfter = await readAlloc(page)
  const idleSeconds = (Date.now() - idleT0) / 1000
  const idleTier = await readTier(page)
  const idle = {
    seconds: Number(idleSeconds.toFixed(2)),
    netTextures: idleAfter.created - idleAfter.deleted - (idleBefore.created - idleBefore.deleted),
    bytes: idleAfter.bytes - idleBefore.bytes,
    liveBytes: idleAfter.liveBytes - idleBefore.liveBytes,
    tierChanged: idleTier.tierIndex !== baseline.tierIndex,
    tier: idleTier.tier,
  }
  const driftPerSecond = idle.netTextures / idleSeconds
  const driftBytesPerSecond = idle.bytes / idleSeconds

  const steps = []
  let previous = await readTier(page)
  let previousAlloc = await readAlloc(page)
  let sweepSeconds = 0

  for (const rate of RATES) {
    await setRate(rate)
    const t0 = Date.now()
    // Poll for a tier change rather than assuming one: a rate that does not cross the band is a
    // legitimate outcome and must be recorded as "no change", not waited out as a failure.
    let current = previous
    while (Date.now() - t0 < SETTLE_MS) {
      await sleep(500)
      current = await readTier(page)
      if (current.tierIndex !== previous.tierIndex) break
    }
    // Let the new rung's allocation settle before the snapshot closes the step.
    await sleep(1500)
    current = await readTier(page)
    const alloc = await readAlloc(page)
    const seconds = (Date.now() - t0) / 1000
    sweepSeconds += seconds
    steps.push({
      throttleRate: rate,
      from: previous.tier,
      to: current.tier,
      changed: current.tierIndex !== previous.tierIndex,
      seconds: Number(seconds.toFixed(2)),
      created: alloc.created - previousAlloc.created,
      deleted: alloc.deleted - previousAlloc.deleted,
      netTextures: alloc.created - alloc.deleted - (previousAlloc.created - previousAlloc.deleted),
      megabytes: Number(((alloc.bytes - previousAlloc.bytes) / (1024 * 1024)).toFixed(3)),
      // The retained half: traffic minus what was disposed. This is the N2 number.
      liveMegabytes: Number(
        ((alloc.liveBytes - previousAlloc.liveBytes) / (1024 * 1024)).toFixed(3),
      ),
      drawingBuffer: current.drawingBuffer,
      bloomSource: current.bloomSource,
      bloomLevels: current.bloomLevels,
      bloomLegacy: current.bloomLegacy,
      bloomLegacyBlur: current.bloomLegacyBlur,
    })
    previous = current
    previousAlloc = alloc
  }

  await setRate(1)
  const finalAlloc = await readAlloc(page)
  const finalTier = await readTier(page)
  const changes = steps.filter((s) => s.changed).length
  const netAcross =
    finalAlloc.created - finalAlloc.deleted - (baseline.alloc.created - baseline.alloc.deleted)
  const bytesAcross = finalAlloc.bytes - baseline.alloc.bytes
  const liveAcross = finalAlloc.liveBytes - baseline.alloc.liveBytes
  const correctedNet = netAcross - driftPerSecond * sweepSeconds
  const correctedBytes = bytesAcross - driftBytesPerSecond * sweepSeconds
  const correctedLive = liveAcross - (idle.liveBytes / idle.seconds) * sweepSeconds

  return {
    idle,
    steps,
    summary: {
      tierChanges: changes,
      sweepSeconds: Number(sweepSeconds.toFixed(2)),
      baselineTier: baseline.tier,
      finalTier: finalTier.tier,
      returnedToBaselineTier: finalTier.tierIndex === baseline.tierIndex,
      netTexturesRaw: netAcross,
      // Allocation traffic: what the rebuilds uploaded, most of which is legitimate rung cost.
      megabytesRaw: Number((bytesAcross / (1024 * 1024)).toFixed(3)),
      // What is still held. Zero is the acceptance criterion; ~33 MB per rebuild was note N2.
      liveMegabytesRaw: Number((liveAcross / (1024 * 1024)).toFixed(3)),
      driftPerSecond: Number(driftPerSecond.toFixed(3)),
      netTexturesDriftCorrected: Number(correctedNet.toFixed(2)),
      megabytesDriftCorrected: Number((correctedBytes / (1024 * 1024)).toFixed(3)),
      liveMegabytesDriftCorrected: Number((correctedLive / (1024 * 1024)).toFixed(3)),
      // The headline N2 compares against: ~9 textures and ~33 MB retained per rebuild.
      netTexturesPerTierChange: changes > 0 ? Number((correctedNet / changes).toFixed(2)) : null,
      megabytesPerTierChange:
        changes > 0 ? Number((correctedBytes / changes / (1024 * 1024)).toFixed(3)) : null,
      liveMegabytesPerTierChange:
        changes > 0 ? Number((correctedLive / changes / (1024 * 1024)).toFixed(3)) : null,
    },
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: DPR },
  args: ['--window-size=1920,1140', '--use-angle=metal', '--hide-scrollbars'],
})

try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(HOOKS)
  await page.goto(`${URL_BASE}/?probe=shell&motion=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => typeof window.__eternitiesProbe !== 'undefined' && window.__eternitiesProbe.state().level !== 'none',
    { timeout: 120_000, polling: 250 },
  )
  // Let the intro finish and the field complete before anything is claimed about steady state.
  await sleep(8000)

  let report
  if (MODE === 'tiers') {
    report = {
      label: LABEL,
      url: URL_BASE,
      mode: MODE,
      rates: RATES,
      dpr: DPR,
      ...(await sweepTiers(page)),
    }
  } else {
    const phases = []
    phases.push(await measure(page, 'multiverse', SECONDS))

    const planes = await page.evaluate(() => window.__eternitiesProbe.planes())
    const biggest = planes[0]
    await page.evaluate((slug) => window.__eternitiesProbe.focusPlane(slug), biggest.slug)
    phases.push(await measure(page, `plane:${biggest.slug}`, SECONDS))

    await page.evaluate(() => window.__eternitiesProbe.focusCard({}))
    phases.push(await measure(page, 'card', SECONDS))

    report = { label: LABEL, url: URL_BASE, mode: MODE, phases }
  }
  console.log(JSON.stringify(report, null, 2))
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(`${OUT}/${LABEL}.json`, `${JSON.stringify(report, null, 2)}\n`)
    await page.screenshot({ path: `${OUT}/${LABEL}.png` })
  }
} catch (error) {
  console.error(error)
  exit(1)
} finally {
  await browser.close()
}
