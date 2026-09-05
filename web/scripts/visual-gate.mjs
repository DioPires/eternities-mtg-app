#!/usr/bin/env node
/**
 * PRD 9.3's visual review, captured.
 *
 * `verify-browser.mjs --shots` already writes checkpoints 3 and 4 — it has to fly the card journey
 * to assert on it, so the frames fall out of a pass it was making anyway. The other four cannot be
 * had that way: checkpoint 1 is the home view *held still*, checkpoint 2 is three named planes
 * chosen by card count, checkpoint 6 is the dust, and checkpoint 7 is attract mode caught in the
 * middle of a drift. None of them is an assertion, and 9.3 does not ask for one — the owner judges
 * the frames. So this is a capture tool and not a check: it fails only if it cannot reach a
 * checkpoint, never because of what a checkpoint looks like.
 *
 * What it drives, and why that page and not another:
 *
 *   - **`?harness=3`** for checkpoints 1, 2, 6 and 7. Phase 3 folded Phase 2a's star field into
 *     Phase 2b's camera rig, so this is the only page where the criteria on spiral arms, labels
 *     and bloom are judgeable at all. Phase 4 took the default route with the Phase 0 hello-scene
 *     still on its canvas (see `App.tsx`), so the shell is *not* where the scene is.
 *   - **the default route** for one shot of the shell, so the review sees the HUD that ships
 *     around the scene once Phase 6 joins the two.
 *   - **`?harness=2a`** for the star field on its own, under the development orbit control.
 *
 * Frames come from `page.screenshot()` and not from the canvas, because half of what 9.3 asks the
 * owner to judge is not in the canvas: PRD 5.3.8's plane names are HTML billboards over it, and
 * "no label overlaps another at the home view" is a question about the composite. The state readout
 * is hidden for every frame and captured beside it as text, as the state the frame was taken in —
 * see `withPanelHidden`.
 *
 * The recordings are APNG, assembled here from a CDP screencast. There is no ffmpeg on the machine
 * and none is worth adding for this: every frame Chrome pushes is already a PNG, and an APNG is
 * those frames' `IDAT`s re-emitted as `fdAT`s behind an `acTL`. Chrome, Safari, Firefox and macOS
 * Preview all play one.
 *
 *   node scripts/visual-gate.mjs [--dataset production] [--out DIR] [--no-build]
 */

import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

import { measureStatusPanel, statusPanelFaults } from './lib/status-panel.mjs'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const BLIND_ETERNITIES_SLUG = 'blind-eternities'

/** The CSS viewport. 1.5 is `QUALITY_TIERS[0].pixelRatioCap`, so the shot is the canvas 1:1. */
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1.5 }

function parseArgs(argv) {
  const args = { dataset: 'production', out: resolve(WEB_ROOT, 'visual-gate'), build: true }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--out') args.out = resolve(argv[++i])
    else if (argv[i] === '--no-build') args.build = false
  }
  return args
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error(`no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
  return found
}

function resolveDataset(registry, name) {
  if (registry.fixtures?.[name]) return registry.fixtures[name]
  if (typeof registry[name] === 'string') return registry[name]
  return name
}

function readRoster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = resolveDataset(registry, dataset)
  const root = resolve(WEB_ROOT, 'public/data', hash)
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
  const planes = JSON.parse(readFileSync(resolve(root, 'planes.json'), 'utf8')).planes
  return { hash, manifest, planes, realImages: typeof manifest.scryfallBulkUpdatedAt === 'string' }
}

/** How much stderr the death notice carries. Enough for a vite stack trace, not a whole log. */
const TAIL_LIMIT = 4000

/**
 * The preview server, plus the two things needed to diagnose it when it dies.
 *
 * `stdio` has always piped stderr and nothing has ever read it, so the server's own diagnostics
 * went nowhere and a mid-run exit was invisible at the layer that caused it: a capture carried on
 * against a dead port and surfaced as an opaque puppeteer error at whatever step came next. A gate
 * run is long and the steps are far apart, so that misreads as a regression in the step. Stderr is
 * drained and echoed, its tail is kept for the exit message, and the exit itself is announced.
 *
 * `stop()` rather than `child.kill()` at the call site, so the deliberate teardown at the end of a
 * run is not reported as the death this is watching for, and it is all the caller gets: the child
 * itself is not returned, so there is no second way to kill it. Mirrors `verify-browser.mjs`.
 */
async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // A rolling tail, so a server that has been chattering for the length of a capture still fits in
  // the message and the last words are the ones kept. Bounded in characters rather than chunks: a
  // chunk has no size limit, so a single vite stack trace arriving whole would have blown the
  // message out however few of them were kept.
  let tail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    tail = (tail + chunk).slice(-TAIL_LIMIT)
    process.stderr.write(`  [vite preview] ${chunk.replace(/\n(?=.)/g, '\n  [vite preview] ')}`)
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
        `Everything after this point is talking to a dead server, so the next failure is that ` +
        `and not the checkpoint it lands in.` +
        (tail.length > 0
          ? `\n  Its last output:\n  ${tail.trimEnd().replace(/\n/g, '\n  ')}`
          : ' It said nothing on stderr.'),
    )
  })

  return {
    url,
    stop: () => {
      stopping = true
      child.kill('SIGTERM')
    },
  }
}

// --------------------------------------------------------------------------------------------
// APNG
// --------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** One PNG chunk: length, type, data, CRC. */
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** Split a PNG into its chunks, in order. */
function chunksOf(png) {
  const out = []
  let at = 8
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return out
}

/**
 * An APNG from a list of `{ png, delayMs }`.
 *
 * Every frame must share the first frame's `IHDR` — same size, same colour type, same bit depth.
 * A screencast at a fixed viewport gives exactly that; a frame that does not match is dropped by
 * the caller rather than silently rescaled here.
 */
function apng(frames) {
  const first = chunksOf(frames[0].png)
  const ihdr = first.find((c) => c.type === 'IHDR')
  const width = ihdr.data.readUInt32BE(0)
  const height = ihdr.data.readUInt32BE(4)

  const actl = Buffer.alloc(8)
  actl.writeUInt32BE(frames.length, 0)
  actl.writeUInt32BE(0, 4) // play forever

  /** fcTL: which rectangle this frame covers, for how long, and how it composites. */
  let sequence = 0
  const fctl = (delayMs) => {
    const data = Buffer.alloc(26)
    data.writeUInt32BE(sequence++, 0)
    data.writeUInt32BE(width, 4)
    data.writeUInt32BE(height, 8)
    data.writeUInt32BE(0, 12) // x offset
    data.writeUInt32BE(0, 16) // y offset
    data.writeUInt16BE(Math.max(1, Math.round(delayMs)), 20) // delay numerator
    data.writeUInt16BE(1000, 22) // delay denominator: milliseconds
    data.writeUInt8(0, 24) // dispose: none
    data.writeUInt8(0, 25) // blend: source
    return chunk('fcTL', data)
  }

  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr.data)]
  // Carry the first frame's colour-space chunks; a viewer that honours them must honour them for
  // the whole animation, and every frame came out of the same encoder.
  for (const c of first) if (['sRGB', 'gAMA', 'cHRM', 'PLTE', 'tRNS'].includes(c.type)) parts.push(chunk(c.type, c.data))
  parts.push(chunk('acTL', actl))

  frames.forEach((frame, index) => {
    const idats = chunksOf(frame.png).filter((c) => c.type === 'IDAT')
    parts.push(fctl(frame.delayMs))
    for (const idat of idats) {
      if (index === 0) parts.push(chunk('IDAT', idat.data))
      else {
        const data = Buffer.alloc(4 + idat.data.length)
        data.writeUInt32BE(sequence++, 0)
        idat.data.copy(data, 4)
        parts.push(chunk('fdAT', data))
      }
    }
  })

  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/**
 * Record the page for `seconds` while `during()` runs, and write an APNG.
 *
 * `Page.startScreencast` pushes a PNG per compositor frame, which at 60 Hz is far more than a
 * review needs and more than an APNG should carry, so frames are kept at `fps` and the delay of
 * each is the real wall-clock gap to the next — a dropped frame lengthens its predecessor rather
 * than speeding the playback up.
 *
 * The readout is hidden for the whole cast, for the reason `shoot` hides it for a still: a
 * recording of motion is not improved by a column of changing numbers pinned over it.
 */
const record = (page, path, options) => withPanelHidden(page, () => recordFrames(page, path, options))

async function recordFrames(page, path, { seconds, fps = 8, during }) {
  const client = await page.createCDPSession()
  const kept = []
  let lastKeptAt = 0
  const minGap = 1000 / fps

  client.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    const at = metadata.timestamp * 1000
    if (kept.length === 0 || at - lastKeptAt >= minGap) {
      kept.push({ png: Buffer.from(data, 'base64'), at })
      lastKeptAt = at
    }
    try {
      await client.send('Page.screencastFrameAck', { sessionId })
    } catch {
      // The cast was stopped between the frame arriving and this ack; nothing to do.
    }
  })

  // Half the viewport's width. A star field of single-pixel stars compresses badly, so a full-size
  // PNG per frame runs to ~800 KB and a ten-second cast to over 100 MB — too large to attach and
  // no more legible for it. The stills carry the pixel-level criteria; a recording carries motion.
  await client.send('Page.startScreencast', {
    format: 'png',
    maxWidth: Math.round(VIEWPORT.width / 2),
    maxHeight: Math.round(VIEWPORT.height / 2),
    everyNthFrame: 1,
  })
  const work = during ? during() : new Promise((ok) => setTimeout(ok, seconds * 1000))
  await Promise.all([work, new Promise((ok) => setTimeout(ok, seconds * 1000))])
  await client.send('Page.stopScreencast')
  await client.detach()

  if (kept.length < 2) throw new Error(`the screencast produced ${kept.length} frame(s)`)
  // An APNG cannot mix frame sizes. Chrome pushes one odd-sized frame at cast start often enough
  // to be worth dropping rather than debugging.
  const size = (png) => {
    const ihdr = chunksOf(png).find((c) => c.type === 'IHDR')
    return `${ihdr.data.readUInt32BE(0)}x${ihdr.data.readUInt32BE(4)}:${ihdr.data[8]}:${ihdr.data[9]}`
  }
  const counts = new Map()
  for (const frame of kept) counts.set(size(frame.png), (counts.get(size(frame.png)) ?? 0) + 1)
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const usable = kept.filter((frame) => size(frame.png) === modal)

  const frames = usable.map((frame, i) => ({
    png: frame.png,
    delayMs: i + 1 < usable.length ? usable[i + 1].at - frame.at : minGap,
  }))
  const bytes = apng(frames)
  writeFileSync(path, bytes)
  console.log(
    `  recorded ${frames.length} frames (${counts.size > 1 ? `${kept.length - usable.length} odd-sized dropped, ` : ''}` +
      `${modal.split(':')[0]}) -> ${path.split('/').pop()} ${(bytes.length / 1e6).toFixed(1)} MB`,
  )
}

// --------------------------------------------------------------------------------------------
// The scene, driven
// --------------------------------------------------------------------------------------------

const status = (page) =>
  page.evaluate(() => document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '')

const waitForStatus = (page, pattern, timeout = 60_000) =>
  page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout },
    pattern.source,
  )

/**
 * Run `capture` with the development state readout out of frame, then put it back.
 *
 * This used to be free, and silently: the panel had no stylesheet rule, so it laid out below the
 * fold and no frame ever contained it. The fix that makes it paint (`.scene-status`) therefore
 * lands it in the middle of every checkpoint — 9.3's frames are meant to show the scene, not a
 * debug column over it — so the hiding this file always claimed to do now has to be real.
 *
 * `visibility`, not `display`, so the panel keeps its box and nothing reflows around the capture.
 * It is written through CSSOM rather than as a `style` attribute because the production policy
 * still carries `style-src-attr 'unsafe-inline'` only until Phase 6's pre-launch tightening (the
 * CSP audit's F5) — CSSOM is outside CSP's reach either way, so the capture survives that change.
 * `textContent` reads the same hidden or not, which is why the sidecar is written from a hidden
 * panel without a second thought.
 */
async function withPanelHidden(page, capture) {
  const toggle = (hidden) =>
    page.evaluate((hide) => {
      for (const id of ['eternities-status', 'phase0-status']) {
        const node = document.querySelector(`[data-testid="${id}"]`)
        if (!node) continue
        if (hide) node.style.setProperty('visibility', 'hidden', 'important')
        else node.style.removeProperty('visibility')
      }
    }, hidden)

  await toggle(true)
  // One frame for the compositor to drop it, or the shot is of the frame before the hide.
  await settle(page, 1)
  try {
    return await capture()
  } finally {
    await toggle(false)
  }
}

/** A frame with the readout out of it, and beside it the scene state it was taken in, as text. */
async function shoot(page, dir, name) {
  await settle(page, 2)
  await withPanelHidden(page, () => page.screenshot({ path: resolve(dir, `${name}.png`) }))
  const text = (await status(page))
    .replace(/^.*?flip\s*/s, '')
    .split(/(?=focus:|flight:|camera:|stars:|detail:|thumbnails:|card:|gpu:|hover:)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  writeFileSync(resolve(dir, `${name}.txt`), `${text}\n`)
  console.log(`  ${name}.png — ${/camera: [^\n]*/.exec(text)?.[0] ?? ''}`)
}

/** Wait `frames` animation frames, so what is captured is what the page has finished drawing. */
const settle = (page, frames) =>
  page.evaluate(
    (n) =>
      new Promise((ok) => {
        let left = n
        const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : ok(undefined))
        requestAnimationFrame(tick)
      }),
    frames,
  )

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** Fly to a plane through the product's own click handler and wait for the rig to settle there. */
async function flyToPlane(page, slug) {
  const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
  if (!ok) throw new Error(`focusPlane(${slug}) was refused`)
  await waitForStatus(page, new RegExp(`focus: plane \\(${slug}\\)`), 30_000)
  await waitForStatus(page, /flight: idle/, 60_000)
  // PRD 8.7.6: the plane's shards land after the camera does. Give the thumbnail tier its first
  // pass too, so the frame is the settled plane level and not the moment of arrival.
  await waitForStatus(page, new RegExp(`detail: ${slug} `), 60_000)
  await sleep(4000)
}

async function capture(args) {
  const roster = readRoster(args.dataset)
  console.log(
    `dataset ${args.dataset} (${roster.hash}): ${roster.planes.length} planes, ` +
      `${roster.manifest.counts.stars} stars, ${roster.realImages ? 'real' : 'synthetic'} Scryfall ids`,
  )
  if (args.build) {
    execFileSync('pnpm', ['build'], {
      cwd: WEB_ROOT,
      env: { ...process.env, ETERNITIES_DATASET: args.dataset },
      stdio: 'inherit',
    })
  }
  mkdirSync(args.out, { recursive: true })

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

  const notes = []
  try {
    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    page.on('console', (message) => {
      if (message.type() === 'error') notes.push(`console: ${message.text().slice(0, 200)}`)
    })

    // ---- the scene ------------------------------------------------------------------------
    console.log('\n?harness=3 — the folded scene (checkpoints 1, 2, 6, 7)')
    // `?probe=1` implies harness 3 and installs the seam that names the planes by card count.
    await page.goto(`${url}/?probe=1`, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 60_000 })
    // R3F sizes the drawing buffer from a resize observer, which fires after `load`; reading before
    // it does reports the 300x150 HTML default and says nothing about the renderer.
    await page.waitForFunction(
      () => [...document.querySelectorAll('canvas')].some((c) => c.width > 300 && c.height > 150),
      { timeout: 60_000 },
    )

    const gpu = await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
      const context = canvas?.getContext('webgl2')
      const debug = context?.getExtension('WEBGL_debug_renderer_info')
      return {
        size: canvas ? `${canvas.width}x${canvas.height}` : null,
        renderer: debug ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null,
      }
    })
    console.log(`  canvas ${gpu.size} on ${gpu.renderer}`)

    // The readout, measured rather than assumed. `verify-browser.mjs` asserts the same four things
    // — the check is shared, in `lib/status-panel.mjs` — but a capture run is often the first
    // thing anyone points at a new build, so it carries the same strength here and reports it as a
    // note in `capture.json` saying which state the frames were taken beside. Every fault, not
    // just the first: nothing downstream stops on one, so the whole picture is more use.
    const panel = await measureStatusPanel(page, 'eternities-status')
    if (!panel) {
      notes.push('the ?harness=3 state panel is not in the DOM at all — the sidecars will be empty')
    } else {
      for (const fault of statusPanelFaults(panel)) notes.push(`?harness=3: ${fault}`)
    }

    // Checkpoint 1: the home view, after PRD 6.8.2's intro has flown in and settled, with the
    // whole field streamed. A frame taken while `stars: … (streaming)` is a frame of a partial
    // multiverse, and 9.3's spiral-arm criterion would be judged against missing stars.
    await waitForStatus(page, /focus: multiverse/)
    await waitForStatus(page, /flight: idle/)
    await waitForStatus(page, /\(complete\)/, 180_000)
    await page.waitForFunction(
      () => [...document.querySelectorAll('.label')].filter((n) => Number.parseFloat(n.style.opacity || '0') > 0.05).length >= 10,
      { timeout: 60_000 },
    )
    await sleep(3000)
    await shoot(page, args.out, '1-home-view')

    const labels = await page.evaluate(() => {
      const visible = [...document.querySelectorAll('.label')].filter(
        (n) => Number.parseFloat(n.style.opacity || '0') > 0.05,
      )
      return {
        visible: visible.length,
        total: document.querySelectorAll('.label').length,
        boxes: visible.map((n) => {
          const r = n.getBoundingClientRect()
          return { text: n.textContent, x: r.x, y: r.y, w: r.width, h: r.height }
        }),
      }
    })
    // 9.3: "no label overlaps another at the home view" — measured, so the owner is judging a
    // claim rather than squinting at 87 billboards.
    const overlaps = []
    for (let i = 0; i < labels.boxes.length; i += 1) {
      for (let j = i + 1; j < labels.boxes.length; j += 1) {
        const a = labels.boxes[i]
        const b = labels.boxes[j]
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (dx > 0 && dy > 0) overlaps.push(`${a.text} / ${b.text} (${Math.round(dx)}x${Math.round(dy)} px)`)
      }
    }
    console.log(`  labels: ${labels.visible} of ${labels.total} visible, ${overlaps.length} overlapping pair(s)`)
    if (overlaps.length > 0) notes.push(`label overlaps at the home view: ${overlaps.join('; ')}`)

    // A recording of the home view holding still: 9.3's "motion is perceptible within 3 s of
    // arriving at any level" is a claim about a still camera over a moving field.
    await record(page, resolve(args.out, 'r1-home-view-motion.png'), { seconds: 6 })

    // Checkpoint 2: three planes by card count. The dust is excluded — it is checkpoint 6, and it
    // is not a plane in the sense this checkpoint means.
    const planes = (await page.evaluate(() => window.__eternitiesProbe.planes())).filter(
      (plane) => plane.slug !== BLIND_ETERNITIES_SLUG,
    )
    const named = (plane) => `${plane.slug} (${plane.cardCount} cards)`
    const largest = planes[0]
    const mid = planes[Math.floor(planes.length / 2)]
    const small = planes.filter((plane) => plane.cardCount < 50 && plane.cardCount > 0).at(0)
    if (!small) throw new Error('no plane under 50 cards in this roster')
    console.log(`  largest ${named(largest)} · mid ${named(mid)} · under 50 ${named(small)}`)

    // The flight out to the largest plane, recorded: PRD 5.7's tether and 9.3's "motion is
    // perceptible" are both about the move, not about either end of it.
    await record(page, resolve(args.out, 'r2-flight-to-plane.png'), {
      seconds: 9,
      during: () => flyToPlane(page, largest.slug),
    })
    await shoot(page, args.out, `2a-plane-largest-${largest.slug}`)

    // 9.3 asks whether "spiral arms are legible for every plane with ≥ 200 cards", and the answer
    // depends on how far out the rig settles — which PRD 5.7's tether decides, not the reviewer.
    // So the arrival frame above is joined by two closer ones, and the sidecars carry the distance
    // each was taken at. A criterion that passes at one distance and fails at another is a
    // tunable, and PRD open question 11 is what this gate is meant to settle.
    for (const [index, notches] of [6, 6].entries()) {
      const box = await page.evaluate(() => {
        const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
        const r = canvas.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.move(box.x, box.y)
      for (let i = 0; i < notches; i += 1) {
        await page.mouse.wheel({ deltaY: -120 })
        await sleep(120)
      }
      await sleep(3000)
      await shoot(page, args.out, `2a-plane-largest-${largest.slug}-closer-${index + 1}`)
    }

    await flyToPlane(page, mid.slug)
    await shoot(page, args.out, `2b-plane-mid-${mid.slug}`)

    await flyToPlane(page, small.slug)
    await shoot(page, args.out, `2c-plane-under-50-${small.slug}`)

    // Checkpoint 6: the Blind Eternities. PRD 5.3.4 leaves the dust unlabelled, so this is the one
    // plane level with no billboard of its own.
    await flyToPlane(page, BLIND_ETERNITIES_SLUG)
    await shoot(page, args.out, '6-blind-eternities')

    // Checkpoint 7: attract mode, mid-drift. The harness binds `a` to `enterAttract`; the shell's
    // 45 s idle timer (PRD 5.3.22) is Phase 4's and is not wired into this page. Nothing is typed
    // after this, because PRD 5.3.23 makes any input cancel it.
    await page.keyboard.press('Escape')
    await waitForStatus(page, /focus: multiverse/, 30_000)
    await waitForStatus(page, /flight: idle/, 60_000)
    await page.keyboard.press('a')
    await waitForStatus(page, /attract true/, 15_000)
    await sleep(8000) // into the middle of the first leg, not at its start
    await shoot(page, args.out, '7a-attract-mid-drift')
    await record(page, resolve(args.out, 'r3-attract-drift.png'), { seconds: 12 })
    await shoot(page, args.out, '7b-attract-later')
    console.log(`  ${(await status(page)).match(/flight: [^\n·]*/)?.[0] ?? ''}`.trim())

    // ---- the star field on its own --------------------------------------------------------
    console.log('\n?harness=2a — the star field under the development orbit control')
    await page.goto(`${url}/?harness=2a`, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('canvas')].some((c) => c.width > 300 && c.height > 150),
      { timeout: 60_000 },
    )
    await sleep(12_000)
    // `Phase2aScene` renders the same readout under `phase0-status`, and it paints now too.
    await withPanelHidden(page, () => page.screenshot({ path: resolve(args.out, '8-star-field-2a.png') }))
    console.log('  8-star-field-2a.png')

    // ---- the shell ------------------------------------------------------------------------
    console.log('\nthe default route — Phase 4\'s shell')
    await page.goto(`${url}/`, { waitUntil: 'load', timeout: 60_000 })
    await sleep(6000)
    await page.screenshot({ path: resolve(args.out, '9-app-shell.png') })
    console.log('  9-app-shell.png')

    writeFileSync(
      resolve(args.out, 'capture.json'),
      `${JSON.stringify(
        {
          dataset: args.dataset,
          hash: roster.hash,
          stars: roster.manifest.counts.stars,
          planes: roster.planes.length,
          canvas: gpu.size,
          renderer: gpu.renderer,
          viewport: VIEWPORT,
          checkpoint2: { largest, mid, small },
          labelsVisible: labels.visible,
          labelsTotal: labels.total,
          labelOverlaps: overlaps,
          notes,
        },
        null,
        2,
      )}\n`,
    )
    console.log(`\ncaptured to ${args.out}`)
    if (notes.length > 0) console.log(`notes:\n  - ${notes.join('\n  - ')}`)
  } finally {
    await browser.close()
    stop()
  }
}

await capture(parseArgs(process.argv.slice(2)))
