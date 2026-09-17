/**
 * DEC-838: is the parked page's ~1,400 KiB/s on the WIRE, and does it survive a full spin?
 *
 * Two questions `worlds-evict-longrun.mjs` cannot answer, both structural:
 *
 * 1. **`bytesFetched` is not a wire measure.** `imageQueue.ts:261` sets `bytes` from `blob.size` —
 *    the response *body* handed to the decoder. A 200 served from Chrome's HTTP cache reports the
 *    same `blob.size` as one that crossed the network, so the whole 1,380-1,415 KiB/s range is
 *    "bytes the decoder consumed per second", an UPPER bound on transfer and not transfer itself.
 *    PRD 7.2's budgets are all "Transferred", so the figure in the flag is not yet in the units the
 *    PRD row would be written in. This run reads `Network.loadingFinished.encodedDataLength` over
 *    CDP, which is the real on-the-wire count, and `Network.responseReceived.response.fromDiskCache`
 *    beside it.
 *
 * 2. **Every run on record is shorter than one revolution.** `spinPeriodS` is ~262.6 s and the want
 *    set turns over at ~18 cells/s, so a revolution carries ~4,750 of dominaria's 6,271 cards across
 *    the admission boundary. The 60 s, 120 s and 150 s runs all sit INSIDE the first revolution,
 *    where nearly every key is being asked for the first time. "Sustained indefinitely" is therefore
 *    an extrapolation from the one regime in which no key can repeat. The second revolution asks for
 *    the same ~4,750 keys again, against URLs that are stable per printing (`images.ts:31` —
 *    `imageTs` is a contract field, not a clock). Whether that is free depends on the HTTP cache,
 *    which is exactly what question 1's instrument reads.
 *
 * So: default 660 s = 2.5 revolutions, sampling body bytes and wire bytes together. Same pose, same
 * composition and the same pose-loss guard as the long-run script (`?probe=shell`, dominaria, 2.2
 * radii) so the arms are comparable; `--reduced` is kept for the same reason it exists there.
 *
 * Usage: node scripts/dec838-wire-bytes.mjs [--seconds 660] [--reduced] [--out DIR]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 }
const WORLD = 'dominaria'
const TARGET_RADII = 2.2
const SAMPLE_S = 3
const HEARTBEAT_S = 15
const RADII_TOLERANCE = 0.05
const ART_HOST = 'cards.scryfall.io'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const seconds = Number(arg('--seconds', 660))
const reduced = process.argv.includes('--reduced')
/**
 * Let the page go genuinely unattended: no heartbeat, no pose guard, no world pin.
 *
 * **The flagged figure is NOT measured on an unattended page.** The long-run script moves the
 * pointer every 15 s to hold the gate pose, and `hooks.ts:242`'s `ATTRACT_IDLE_MS` is 45 s — so the
 * heartbeat re-arms the idle timer twice over before it can fire, and attract mode is unreachable
 * BY CONSTRUCTION in every run on record. A page nobody touches enters attract at 45 s and tours
 * the multiverse (PRD 5.3.22), which is a different demand shape entirely: each new world is a
 * fresh roster with no cache history. This arm measures that instead.
 */
const attract = process.argv.includes('--attract')
const outDir = resolve(WEB_ROOT, arg('--out', 'worlds-gate/dec838-wire'))
mkdirSync(outDir, { recursive: true })

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
  // `world === null` is the attract arm: the focused plane changes by design, so pinning it would
  // throw on the first leg. The stream counters are session-global (`probe.ts`), so `bytesFetched`
  // and the wire totals keep accumulating across worlds either way — which is the measure wanted.
  if (world !== null && payload.planeSlug !== world) return { wrongWorld: payload.planeSlug }
  const wanting = payload.cells.filter((c) => c.frontFacing && c.onScreen && c.wantsArt)
  return {
    planeSlug: payload.planeSlug,
    radii: payload.radii,
    multiverseAngle: window.__eternitiesProbe.state().multiverseAngle,
    wanting: wanting.length,
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

// ---------------------------------------------------------------------------
// Wire accounting. Module-level counters the sampler reads; CDP events are
// delivered on this same process, so a sample is a consistent snapshot.
// ---------------------------------------------------------------------------
/** requestId -> { url, fromDiskCache, status } recorded at `responseReceived`. */
const pending = new Map()
/** url -> number of responses seen for it. The repeat distribution across revolutions. */
const perUrl = new Map()
const wire = {
  /** `encodedDataLength`: bytes on the wire, headers included. The PRD-7.2 unit. */
  artWireBytes: 0,
  artResponses: 0,
  /** Responses Chrome served from its own HTTP cache rather than the network. */
  artFromCache: 0,
  /** `Network.requestServedFromCache` — the memory-cache path, which never opens a connection. */
  artServedFromCache: 0,
  otherWireBytes: 0,
}
const isArt = (url) => typeof url === 'string' && url.includes(ART_HOST)

try {
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')
  cdp.on('Network.requestServedFromCache', (e) => {
    const m = pending.get(e.requestId)
    // Fires BEFORE responseReceived, so the url is usually not known yet; counted by requestId and
    // reconciled below. Kept separate from `fromDiskCache` because they are different caches.
    if (m) m.servedFromCache = true
    else pending.set(e.requestId, { servedFromCache: true })
  })
  cdp.on('Network.responseReceived', (e) => {
    const prior = pending.get(e.requestId)
    pending.set(e.requestId, {
      url: e.response.url,
      fromDiskCache: Boolean(e.response.fromDiskCache),
      servedFromCache: Boolean(prior?.servedFromCache),
      status: e.response.status,
      encodedBodySize: e.response.encodedDataLength ?? 0,
    })
  })
  cdp.on('Network.loadingFinished', (e) => {
    const m = pending.get(e.requestId)
    pending.delete(e.requestId)
    if (!m || !m.url) return
    if (!isArt(m.url)) {
      wire.otherWireBytes += e.encodedDataLength ?? 0
      return
    }
    wire.artResponses += 1
    wire.artWireBytes += e.encodedDataLength ?? 0
    if (m.fromDiskCache) wire.artFromCache += 1
    if (m.servedFromCache) wire.artServedFromCache += 1
    perUrl.set(m.url, (perUrl.get(m.url) ?? 0) + 1)
  })

  if (reduced) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  }
  const query = '?probe=shell'
  console.log(
    `composition ${query}, prefers-reduced-motion ${reduced ? 'REDUCE' : 'no-preference'}, ` +
      `${seconds}s (~${(seconds / 262.592).toFixed(2)} spin revolutions)`,
  )
  await page.goto(`${base}/${query}`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 30_000 })
  await page.waitForFunction(
    () => window.__eternitiesProbe?.state().programWarmup != null,
    { timeout: 60_000 },
  )
  if (!(await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), WORLD))) {
    throw new Error(`focusPlane(${WORLD}) refused`)
  }
  for (let i = 0; i < 80; i += 1) {
    const s = await page.evaluate(READ, WORLD)
    if (s && !s.wrongWorld && !(await page.evaluate(() => window.__eternitiesProbe.state().flying))) break
    await sleep(250)
  }
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
    if (Math.abs(Math.log(current / before)) < 1e-6) continue
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
  console.log(`settled at ${current.toFixed(4)} radii, motion ${reduced ? 'OFF' : 'ON'}, sampling ${seconds}s\n`)

  const started = Date.now()
  let prevMembers = null
  let lastBeat = 0
  let x = 5
  const rows = []
  for (;;) {
    const elapsed = (Date.now() - started) / 1000
    // The attract arm deliberately does NOT beat: the beat is what keeps attract unreachable.
    if (!attract && elapsed - lastBeat >= HEARTBEAT_S) {
      x = x === 0 ? 1 : 0
      await page.mouse.move(box.x + x, box.y)
      lastBeat = elapsed
    }
    const s = await page.evaluate(READ, attract ? null : WORLD)
    if (s && !s.wrongWorld) {
      // Under `--attract` the camera receding IS the subject, so the guard that exists to catch it
      // would abort the run it is measuring.
      if (!attract && Math.abs(s.radii - TARGET_RADII) > RADII_TOLERANCE) {
        throw new Error(`pose lost at t=${elapsed.toFixed(1)}s: radii ${s.radii.toFixed(3)} (attract mode?)`)
      }
      const now = new Set(s.members)
      const entered = prevMembers === null ? null : [...now].filter((c) => !prevMembers.has(c)).length
      prevMembers = now
      delete s.members
      let repeats = 0
      for (const n of perUrl.values()) if (n > 1) repeats += n - 1
      rows.push({
        t: Number(elapsed.toFixed(1)),
        entered,
        ...s,
        artWireBytes: wire.artWireBytes,
        artResponses: wire.artResponses,
        artFromCache: wire.artFromCache,
        artServedFromCache: wire.artServedFromCache,
        distinctUrls: perUrl.size,
        repeatResponses: repeats,
      })
      const r = rows[rows.length - 1]
      if (rows.length % 5 === 1) {
        console.log(
          `t=${String(r.t).padStart(6)}s  res=${String(r.resident).padStart(4)}/${r.layers}` +
            `  ev=${String(r.evictions).padStart(6)}  req=${String(r.requested).padStart(6)}` +
            `  body=${(r.bytesFetched / 1048576).toFixed(1)}MiB  wire=${(r.artWireBytes / 1048576).toFixed(1)}MiB` +
            `  resp=${r.artResponses}  cached=${r.artFromCache}  distinct=${r.distinctUrls}` +
            `  repeats=${r.repeatResponses}  show/want=${r.showing}/${r.wanting}`,
        )
      }
    }
    if (elapsed >= seconds) break
    await sleep(SAMPLE_S * 1000)
  }

  // -------------------------------------------------------------------------
  // Scoring. Plateau-detected fill exclusion (`max(resident)`, DEC-835), and
  // every sustained figure scored against its own second half.
  // -------------------------------------------------------------------------
  const plateau = Math.max(...rows.map((r) => r.resident))
  const fillEnd = rows.findIndex((r) => r.resident >= plateau)
  const tail = rows.slice(Math.max(fillEnd, 0))
  const rate = (slice, field) => {
    if (slice.length < 2) return null
    const a = slice[0]
    const b = slice[slice.length - 1]
    const dt = b.t - a.t
    return dt <= 0 ? null : (b[field] - a[field]) / dt / 1024
  }
  const half = tail.slice(Math.floor(tail.length / 2))
  // **The arm must assert it took** (DEC-835 N3). `--attract` claims the page went unattended and
  // toured; the read-back for that is the focused plane actually changing. Without this, a run where
  // attract silently never engaged would report a byte rate and read as a clean result.
  // `allocatePool` (`attachWorlds.ts:347`) builds a NEW `ArtStream`, so a quality-rung change or a
  // dataset swap resets `bytesFetched` to 0 mid-run. Differencing across that silently reports a
  // huge negative or a truncated rate as if it were steady state. The attract arm tours worlds and
  // is the arm most likely to trip it, so it is checked rather than assumed.
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1]
    const b = rows[i]
    if (b.bytesFetched < a.bytesFetched || b.requested < a.requested) {
      throw new Error(
        `stream counters reset between t=${a.t}s and t=${b.t}s ` +
          `(bytesFetched ${a.bytesFetched}->${b.bytesFetched}, requested ${a.requested}->${b.requested}): ` +
          `the pool was reallocated, so no rate across this run is differenceable.`,
      )
    }
  }
  const slugs = [...new Set(rows.map((r) => r.planeSlug).filter(Boolean))]
  // **The read-back is the CAMERA, not the focused plane.** `camera/attract.ts:10` is explicit that
  // attract "drives the *camera* and not the focus" and never changes the route (PRD 5.3.23), so a
  // slug that never moves is the EXPECTED reading and would make a focus-based assertion fire on
  // every healthy run. What attract does move is the rig: it flies legs away from the 2.2-radii pose.
  const departure = Math.max(...rows.map((r) => Math.abs(r.radii - TARGET_RADII)))
  const firstDepartureAt = rows.find((r) => Math.abs(r.radii - TARGET_RADII) > 0.5)?.t ?? null
  if (attract && departure <= 0.5) {
    throw new Error(
      `--attract never took: camera stayed within ${departure.toFixed(3)} radii of the pose for the ` +
        `whole run. ATTRACT_IDLE_MS is 45s — did something generate input?`,
    )
  }
  if (!attract && slugs.length !== 1) {
    throw new Error(`pinned arm drifted across worlds: ${slugs.join(', ')}`)
  }
  const summary = {
    seconds,
    reduced,
    attract,
    worldsVisited: slugs,
    maxRadiiDeparture: departure,
    firstDepartureAtS: firstDepartureAt,
    samples: rows.length,
    plateauResident: plateau,
    fillEndsAtS: tail[0]?.t ?? null,
    bodyKiBs: rate(tail, 'bytesFetched'),
    bodyKiBsSecondHalf: rate(half, 'bytesFetched'),
    wireKiBs: rate(tail, 'artWireBytes'),
    wireKiBsSecondHalf: rate(half, 'artWireBytes'),
    artResponses: wire.artResponses,
    artFromCache: wire.artFromCache,
    artServedFromCache: wire.artServedFromCache,
    distinctUrls: perUrl.size,
    repeatResponses: [...perUrl.values()].reduce((n, v) => n + (v > 1 ? v - 1 : 0), 0),
    maxRepeatsForOneUrl: Math.max(0, ...perUrl.values()),
  }
  const conv = (a, b) => (a && b ? Math.abs(a - b) / a : null)
  summary.bodyConvergencePct = conv(summary.bodyKiBs, summary.bodyKiBsSecondHalf) * 100
  summary.wireConvergencePct = conv(summary.wireKiBs, summary.wireKiBsSecondHalf) * 100
  writeFileSync(resolve(outDir, 'rows.json'), JSON.stringify(rows, null, 2))
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`\n--- summary (fill excluded from t=${summary.fillEndsAtS}s, plateau resident ${plateau}) ---`)
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nwrote ${outDir}/rows.json`)
} finally {
  await browser.close()
  preview.kill('SIGTERM')
}
