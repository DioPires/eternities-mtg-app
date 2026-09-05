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
 *   - **the default route, with `?probe=shell`** for checkpoints 1, 2, 6 and 7. This is the whole
 *     point of the gate: 9.3 judges what ships, and since Phase 6 what ships is the scene *inside*
 *     the shell — one canvas with the HUD, the drawer and the toasts over it. Gate #1 (DEC-630) and
 *     the capture the owner accepted on DEC-592 were both taken on `?probe=1`, which is Phase 3's
 *     scene on its own, so neither judged the composite. `?probe=shell` keeps the shell and lets
 *     `SceneView` install the same seam in it (`src/scene/probe.ts`) — the product's own click
 *     handlers, driven from a script, on the page the user gets.
 *   - **`?probe=1`** (`--target scene`) still reaches Phase 3's scene, so a capture can be compared
 *     against the ones the earlier reviews were judged on.
 *   - **`?harness=2a`** for the star field on its own, under the development orbit control.
 *
 * Frames come from `page.screenshot()` and not from the canvas, because half of what 9.3 asks the
 * owner to judge is not in the canvas: PRD 5.3.8's plane names are HTML billboards over it, "no
 * label overlaps another at the home view" is a question about the composite, and on the shipped
 * composition the HUD is in the frame too. The scene state each frame was taken in is written
 * beside it as text — from the readout panel on `--target scene`, and from the probe on the shell,
 * which mounts `SceneView` with no panel at all.
 *
 * The recordings are APNG, assembled here from a CDP screencast. There is no ffmpeg on the machine
 * and none is worth adding for this: every frame Chrome pushes is already a PNG, and an APNG is
 * those frames' `IDAT`s re-emitted as `fdAT`s behind an `acTL`. Chrome, Safari, Firefox and macOS
 * Preview all play one.
 *
 * **Two criteria need more than a still, and gate #1 could not judge either.**
 *
 *   - *"No aliasing shimmer on stars during slow camera moves."* Gate #1 judged this on half-size
 *     recordings, which is the one resolution that hides it: downscaling averages the single-pixel
 *     stars whose flicker is the artefact. So the shimmer recordings are cast at the **drawing
 *     buffer's own resolution** — `scale: 1` — and written whole. An APNG of a star field at that
 *     size runs to tens of megabytes, so a thinned copy is written beside each one for anywhere
 *     with an attachment limit, and the thinning sums each dropped frame's delay into its survivor
 *     so playback speed is unchanged. Judge the full one.
 *   - *"Thumbnail cross-fades and image fade-ins are never noticed as events."* Gate #1 reported
 *     `0 drawn / 0 of 512 cells` at every plane level, so there was nothing to judge: PRD 5.5.1's
 *     band is crossed on the way **into a card**, not at plane level, and no capture went there.
 *     `--crossfade` flies plane → card and back with the probe sampled throughout, so the band is
 *     crossed in both directions and `crossfade.json` says by how much.
 *
 *   node scripts/visual-gate.mjs [--dataset production] [--out DIR] [--no-build]
 *                                [--target shell|scene] [--only home,planes,dust,attract,...]
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

/**
 * How large a thinned recording may be, in bytes.
 *
 * Nothing in the renderer cares; this is the limit of the place the frames end up. Paperclip
 * refuses an attachment over 10 MB outright, so the thinned copy aims under it with room for the
 * multipart envelope. The full-resolution original is written whole beside it and is what the
 * shimmer criterion is judged on.
 */
const ATTACHMENT_BUDGET_BYTES = 9_500_000

/**
 * Every stage, in the order `capture` runs them. `--only` names a subset.
 *
 * `attract` is second and not last, which looks wrong until you remember what triggers it on the
 * shipped composition: PRD 5.3.22's 45 s idle timer, cancelled by any input at all (5.3.23). Every
 * stage after it uses the wheel or the pointer, so reaching attract from the end of the run would
 * mean sitting still for another 45 s and hoping nothing else touched the page.
 */
const STAGES = ['home', 'attract', 'planes', 'crossfade', 'shimmer', 'dust', 'starfield']

function parseArgs(argv) {
  const args = {
    dataset: 'production',
    out: resolve(WEB_ROOT, 'visual-gate'),
    build: true,
    target: 'shell',
    only: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--out') args.out = resolve(argv[++i])
    else if (argv[i] === '--no-build') args.build = false
    else if (argv[i] === '--target') args.target = argv[++i]
    else if (argv[i] === '--only') args.only = argv[++i].split(',').map((s) => s.trim())
  }
  if (args.target !== 'shell' && args.target !== 'scene') {
    throw new Error(`--target must be shell or scene, not ${args.target}`)
  }
  for (const stage of args.only ?? []) {
    if (!STAGES.includes(stage)) throw new Error(`--only: unknown stage ${stage}. Known: ${STAGES.join(', ')}`)
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
 * Drop frames until the APNG fits `budget`, summing each dropped frame's delay into the frame
 * before it.
 *
 * Playback speed is therefore unchanged — which is only true because every frame here is a full
 * frame with `dispose: none` and `blend: source`, so any subset of them is still a valid animation
 * of the same length. Returns the frames, not the bytes, so the caller can report what it lost.
 */
function thinToBudget(frames, budget) {
  let kept = frames
  while (kept.length > 2 && apng(kept).length > budget) {
    const next = []
    for (let i = 0; i < kept.length; i += 1) {
      if (i % 2 === 0) next.push({ png: kept[i].png, delayMs: kept[i].delayMs + (kept[i + 1]?.delayMs ?? 0) })
    }
    kept = next
  }
  return kept
}

/**
 * A burst of `count` stills during `during()`, at the **drawing buffer's own resolution**.
 *
 * `Page.startScreencast` will not do this. Its `maxWidth`/`maxHeight` are honoured against the CSS
 * viewport rather than the device frame, so the largest cast this page can produce is 1440x900 —
 * two thirds of the 2160x1350 the renderer actually draws, and a resample of every star in it.
 * `page.screenshot()` has no such ceiling: it returns the device frame. So criterion 5's evidence is
 * a burst of real screenshots, kept as individual PNGs *and* assembled into an APNG, with each
 * frame's true wall-clock gap as its delay.
 *
 * What this buys and what it costs, because both matter to the judgement: the pixels are the ones
 * the GPU wrote, which is the whole point — aliasing shimmer is a per-pixel artefact and any
 * downscale averages it away. But a screenshot takes ~100–200 ms, so the burst samples the motion
 * far below frame rate. It is evidence about *what a star looks like*, not about cadence; the
 * recording beside it carries the cadence.
 */
async function burst(page, dir, name, { count, gapMs = 0, during }) {
  const frames = []
  const shots = (async () => {
    for (let i = 0; i < count; i += 1) {
      const at = Date.now()
      const png = await page.screenshot({ path: resolve(dir, `${name}-${String(i + 1).padStart(2, '0')}.png`) })
      frames.push({ png: Buffer.from(png), at })
      if (gapMs > 0) await sleep(gapMs)
    }
  })()
  await Promise.all([shots, during ? during() : Promise.resolve()])

  const withDelays = frames.map((frame, i) => ({
    png: frame.png,
    delayMs: i + 1 < frames.length ? frames[i + 1].at - frame.at : 120,
  }))
  const bytes = apng(withDelays)
  const path = resolve(dir, `${name}.png`)
  writeFileSync(path, bytes)
  const ihdr = chunksOf(frames[0].png).find((c) => c.type === 'IHDR')
  const size = `${ihdr.data.readUInt32BE(0)}x${ihdr.data.readUInt32BE(4)}`
  const cadence = withDelays.slice(0, -1).reduce((sum, f) => sum + f.delayMs, 0) / Math.max(1, frames.length - 1)
  console.log(
    `  burst ${frames.length} stills at ${size} (${cadence.toFixed(0)} ms apart) -> ${name}-NN.png + ${name}.png ${(bytes.length / 1e6).toFixed(1)} MB`,
  )
  return { path, frames: frames.length, bytes: bytes.length, size, meanGapMs: Math.round(cadence) }
}

/**
 * Record the page for `seconds` while `during()` runs, and write an APNG.
 *
 * `Page.startScreencast` pushes a PNG per compositor frame, which at 60 Hz is far more than a
 * review needs and more than an APNG should carry, so frames are kept at `fps` and the delay of
 * each is the real wall-clock gap to the next — a dropped frame lengthens its predecessor rather
 * than speeding the playback up.
 *
 * `scale` is the fraction of the *device* frame each PNG carries: 0.5 for a recording of a move,
 * where the subject is the motion, and 1 for the shimmer criterion, where the subject is what
 * happens to single-pixel stars and any downscale averages exactly that away. At 1 the file is
 * written whole and a thinned copy is written beside it; see `ATTACHMENT_BUDGET_BYTES`.
 *
 * The readout is hidden for the whole cast, for the reason `shoot` hides it for a still: a
 * recording of motion is not improved by a column of changing numbers pinned over it.
 */
const record = (page, path, options) => withPanelHidden(page, () => recordFrames(page, path, options))

async function recordFrames(page, path, { seconds, fps = 8, during, scale = 0.5 }) {
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

  // A star field of single-pixel stars compresses badly, so a device-resolution PNG per frame runs
  // to ~800 KB and a ten-second cast to over 100 MB. At `scale: 0.5` the subject is the motion and
  // half size costs nothing; at `scale: 1` the subject is the pixels themselves and the size is the
  // price of the criterion.
  const device = { width: VIEWPORT.width * VIEWPORT.deviceScaleFactor, height: VIEWPORT.height * VIEWPORT.deviceScaleFactor }
  await client.send('Page.startScreencast', {
    format: 'png',
    maxWidth: Math.round(device.width * scale),
    maxHeight: Math.round(device.height * scale),
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
  let line =
    `  recorded ${frames.length} frames (${counts.size > 1 ? `${kept.length - usable.length} odd-sized dropped, ` : ''}` +
    `${modal.split(':')[0]}) -> ${path.split('/').pop()} ${(bytes.length / 1e6).toFixed(1)} MB`

  // The original is the record; the thinned copy exists only so the same recording can be attached
  // somewhere with a size limit. Written beside it rather than in place of it, so the criterion is
  // never judged on the reduced one by accident — that is the mistake gate #1 made.
  let thinned = null
  if (bytes.length > ATTACHMENT_BUDGET_BYTES) {
    const reduced = thinToBudget(frames, ATTACHMENT_BUDGET_BYTES)
    thinned = path.replace(/\.png$/, '-thinned.png')
    const reducedBytes = apng(reduced)
    writeFileSync(thinned, reducedBytes)
    line += `\n  + ${thinned.split('/').pop()} ${(reducedBytes.length / 1e6).toFixed(1)} MB (${reduced.length} of ${frames.length} frames, same duration)`
  }
  console.log(line)
  return { path, thinned, frames: frames.length, bytes: bytes.length, size: modal.split(':')[0] }
}

// --------------------------------------------------------------------------------------------
// The scene, driven
// --------------------------------------------------------------------------------------------

const status = (page) =>
  page.evaluate(() => document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '')

/** The probe's own view of the scene. `null` before the seam is installed. */
const probeState = (page) => page.evaluate(() => window.__eternitiesProbe?.state() ?? null)

/**
 * The scene state a frame was taken in, as text, from whichever source this page has.
 *
 * `--target scene` has Phase 3's readout panel and the sidecars are what it says, unchanged from
 * gate #1 so the two captures can be read side by side. The shell mounts `SceneView` with
 * `chrome: false` and has no panel, so the same fields are formatted out of `ProbeState` — the
 * object the panel itself renders from.
 */
async function stateText(page) {
  const panel = (await status(page))
    .replace(/^.*?flip\s*/s, '')
    .split(/(?=focus:|flight:|camera:|stars:|detail:|thumbnails:|card:|gpu:|hover:)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (panel.length > 0) return panel

  const state = await probeState(page)
  if (state === null) return '(no readout panel and no probe on this page)'
  const t = state.thumbnails
  const lines = [
    `focus: ${state.level}${state.planeSlug === null ? '' : ` (${state.planeSlug})`}`,
    `flight: ${state.flying ? 'flying' : 'idle'}`,
    `camera: d ${state.cameraDistance.toFixed(1)}`,
    `detail: ${state.cardsLoaded} cards loaded`,
    `thumbnails: ${t.drawn} drawn / ${t.cells} of ${t.capacity} cells · ${t.loaded} loaded, ${t.requested} requested, ${t.failed} failed`,
    `images: ${state.images.completed} completed, ${state.images.inFlight} in flight, ${state.images.waiting} waiting, ${state.images.failed} failed`,
    `quality: ${state.quality.tier} · dpr ${state.quality.pixelRatio} · ${state.quality.drawingBuffer.width}x${state.quality.drawingBuffer.height} · ${state.quality.starsDrawn} stars drawn`,
    `gpu: ${(state.gpu.totalBytes / 1e6).toFixed(1)} MB of ${(state.gpu.targetBytes / 1e6).toFixed(0)} MB target`,
  ]
  if (state.card !== null) {
    lines.push(
      `card: ${state.card.name} · ${state.card.printings} printings · ${state.card.planets} planets` +
        `${state.card.canFlip ? ` · ${state.card.flipped ? 'flipped' : 'front'}` : ''}`,
    )
  }
  return lines.join('\n')
}

/**
 * Poll until `predicate` holds of the probe state, or throw.
 *
 * Polled through `evaluate` rather than `page.waitForFunction`, which injects a function the CSP
 * refuses on any build carrying PRD 7.6.1's real headers — the same reason `cross-browser.mjs`
 * polls. `describe` is what the timeout message says it was waiting for.
 */
async function waitForProbe(page, describe, predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout
  let last = null
  for (;;) {
    // The predicate stays in node and only the state crosses. Nothing is compiled in the page, and
    // the state is a plain object, so this works identically under any CSP.
    const state = await probeState(page)
    last = { ok: state !== null && predicate(state), state }
    if (last.ok) return last.state
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${(timeout / 1000).toFixed(0)}s waiting for ${describe}` +
          (last.state === null
            ? ' (the probe is not installed on this page)'
            : ` — last: focus ${last.state.level}${last.state.planeSlug ? ` ${last.state.planeSlug}` : ''}, ` +
              `${last.state.flying ? 'flying' : 'idle'}, d ${last.state.cameraDistance.toFixed(1)}, ` +
              `${last.state.cardsLoaded} cards, ${last.state.thumbnails.drawn} thumbnails`),
      )
    }
    await sleep(250)
  }
}

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
 * It is written through CSSOM rather than as a `style` attribute, and that now matters: Phase 6
 * dropped `style-src-attr 'unsafe-inline'` (the CSP audit's F5), so `style-src 'self'` governs
 * attributes too and a literal `style="visibility:hidden"` here would be refused. CSSOM is outside
 * CSP's reach, so this capture was unaffected by the tightening.
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
  const text = await stateText(page)
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

/** The centre of the largest canvas, in CSS pixels — where a pointer gesture should start. */
const canvasCentre = (page) =>
  page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    const r = canvas.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })

/**
 * `notches` wheel events over the canvas, `gapMs` apart.
 *
 * The gap is the tunable: at 120 ms this is a zoom, and at 700 ms it is the "slow camera move" 9.3's
 * shimmer criterion asks about — the rig eases between notches, so a long gap leaves it moving
 * slowly and continuously rather than in steps.
 */
async function wheel(page, notches, deltaY, gapMs) {
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)
  for (let i = 0; i < notches; i += 1) {
    await page.mouse.wheel({ deltaY })
    await sleep(gapMs)
  }
}

/** Drag across the canvas — PRD 6.1's orbit, through the pointer rather than through an API. */
async function drag(page, dx, dy) {
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  const steps = 24
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(centre.x + (dx * i) / steps, centre.y + (dy * i) / steps)
    await sleep(16)
  }
  await page.mouse.up()
}

/** Fly to a plane through the product's own click handler and wait for the rig to settle there. */
async function flyToPlane(page, slug) {
  const ok = await page.evaluate((s) => window.__eternitiesProbe.focusPlane(s), slug)
  if (!ok) throw new Error(`focusPlane(${slug}) was refused`)
  await waitForProbe(page, `the rig to settle on ${slug}`, (s) => s.planeSlug === slug && !s.flying, 60_000)
  // PRD 8.7.6: the plane's shards land after the camera does. Give the thumbnail tier its first
  // pass too, so the frame is the settled plane level and not the moment of arrival.
  await waitForProbe(page, `${slug}'s shards`, (s) => s.cardsLoaded > 0, 60_000)
  await sleep(4000)
}

/**
 * Sample the probe every `intervalMs` for `seconds`, and return the timeline.
 *
 * The cross-fade criterion is the one thing in 9.3 that a frame cannot answer on its own: "never
 * noticed as *events*" is a claim about a transition, and the transition is a number moving. So the
 * recording is taken beside a record of what the tier was doing while it ran.
 */
async function sampleProbe(page, seconds, intervalMs = 100) {
  const started = Date.now()
  const timeline = []
  while (Date.now() - started < seconds * 1000) {
    const state = await probeState(page)
    if (state !== null) {
      timeline.push({
        t: Math.round(Date.now() - started),
        level: state.level,
        flying: state.flying,
        d: Number(state.cameraDistance.toFixed(2)),
        eye: Number(state.cardEyeDistance.toFixed(2)),
        drawn: state.thumbnails.drawn,
        cells: state.thumbnails.cells,
        loaded: state.thumbnails.loaded,
        requested: state.thumbnails.requested,
        images: state.images.completed,
      })
    }
    await sleep(intervalMs)
  }
  return timeline
}

/** Run `work` and sample the probe at the same time, so the timeline covers the whole of it. */
async function withSampling(page, seconds, work) {
  const [timeline] = await Promise.all([sampleProbe(page, seconds), work()])
  return timeline
}

/**
 * Is the HUD in the tree?
 *
 * Two questions in one, and both are 9.3's. Before attract it is the check that this capture is of
 * the shipped composition at all and not of the scene alone; during attract it is PRD 5.3.22's
 * "the HUD hides entirely", which `Hud` implements by returning null.
 */
const hudPresent = (page) => page.evaluate(() => document.querySelector('.hud') !== null)

/**
 * Dismiss PRD 6.8.3's first-visit card, and say whether it was there.
 *
 * It mounts only after the intro flight settles, so a click sent earlier silently does nothing and
 * the card then photobombs every later frame. Waited for rather than raced: the checkpoint frames
 * are of the product at rest, and this card is not part of that.
 */
async function dismissHint(page) {
  const deadline = Date.now() + 20_000
  for (;;) {
    const clicked = await page.evaluate(() => {
      const hint = document.querySelector('.hint')
      const button = hint?.querySelector('button')
      if (!button) return false
      button.click()
      return true
    })
    if (clicked) {
      await settle(page, 2)
      return true
    }
    if (Date.now() > deadline) return false
    await sleep(500)
  }
}

async function capture(args) {
  const roster = readRoster(args.dataset)
  const isShell = args.target === 'shell'
  const wanted = (stage) => args.only === null || args.only.includes(stage)
  console.log(
    `dataset ${args.dataset} (${roster.hash}): ${roster.planes.length} planes, ` +
      `${roster.manifest.counts.stars} stars, ${roster.realImages ? 'real' : 'synthetic'} Scryfall ids`,
  )
  if (!roster.realImages) {
    console.log(
      '  ! this dataset carries synthetic Scryfall ids, so every card image 404s and the\n' +
        '    cross-fade criterion has nothing to fade *to*. Use --dataset production.',
    )
  }
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
  const recordings = []
  const summary = {}
  try {
    const page = await browser.newPage()
    await page.setViewport(VIEWPORT)
    page.on('console', (message) => {
      if (message.type() === 'error') notes.push(`console: ${message.text().slice(0, 200)}`)
    })

    // ---- the page under review -------------------------------------------------------------
    const entry = `${url}/${isShell ? '?probe=shell' : '?probe=1'}`
    console.log(
      isShell
        ? '\nthe default route, ?probe=shell — the shipped composition (checkpoints 1, 2, 6, 7)'
        : "\n?probe=1 — Phase 3's scene on its own (checkpoints 1, 2, 6, 7)",
    )
    await page.goto(entry, { waitUntil: 'load', timeout: 60_000 })
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

    // Which composition this is, measured rather than assumed. A gate that quietly captured the
    // scene alone would look exactly like this one and answer a different question — which is what
    // happened to gate #1 — so the frames are labelled by what was actually in the tree.
    const hudAtStart = await hudPresent(page)
    console.log(`  HUD in the tree: ${hudAtStart}`)
    if (isShell && !hudAtStart) {
      notes.push(
        'the HUD is not in the tree on the default route — these frames are NOT the shipped composition',
      )
    }
    if (!isShell && hudAtStart) notes.push('the HUD is in the tree on ?probe=1, which routes past the shell')

    // The readout, measured rather than assumed. `verify-browser.mjs` asserts the same four things
    // — the check is shared, in `lib/status-panel.mjs` — but a capture run is often the first
    // thing anyone points at a new build, so it carries the same strength here and reports it as a
    // note in `capture.json` saying which state the frames were taken beside. Every fault, not
    // just the first: nothing downstream stops on one, so the whole picture is more use.
    const panel = await measureStatusPanel(page, 'eternities-status')
    if (isShell) {
      // The shell mounts `SceneView` with `chrome: false`, so the panel should not exist here at
      // all and the sidecars come from the probe. If one turns up, the frames have a debug column
      // over them and the composition is not what ships.
      if (panel) notes.push('the shell is rendering the scene readout panel, which it should not')
    } else if (!panel) {
      notes.push('the ?probe=1 state panel is not in the DOM at all — the sidecars will be empty')
    } else {
      for (const fault of statusPanelFaults(panel)) notes.push(`?probe=1: ${fault}`)
    }

    // ---- checkpoint 1: the home view -------------------------------------------------------
    let labels = null
    let overlaps = []
    if (wanted('home')) {
      console.log('\ncheckpoint 1 — the home view after the intro')
      // A frame taken while the field is still streaming is a frame of a partial multiverse, and
      // 9.3's spiral-arm criterion would be judged against missing stars. `starsDrawn` is the
      // geometry's own draw count, read off the live object.
      await waitForProbe(page, 'the intro to settle at the multiverse', (s) => s.focus === 'multiverse' && !s.flying, 120_000)
      await waitForProbe(
        page,
        `all ${roster.manifest.counts.stars} stars to stream in`,
        (s) => s.quality.starsDrawn >= roster.manifest.counts.stars,
        180_000,
      )
      await page.waitForFunction(
        () => [...document.querySelectorAll('.label')].filter((n) => Number.parseFloat(n.style.opacity || '0') > 0.05).length >= 10,
        { timeout: 60_000 },
      )

      // PRD 6.8.3's first-visit card is part of the shipped composition and part of nothing 9.3
      // asks about, so it is dismissed the way a user dismisses it — and only after the intro has
      // settled, because that is when it mounts.
      if (isShell) {
        const dismissed = await dismissHint(page)
        summary.firstVisitHint = dismissed ? 'shown after the intro, dismissed' : 'never appeared'
        if (!dismissed) notes.push('PRD 6.8.3\'s first-visit card never appeared within 20 s of the intro settling')
      }

      await sleep(3000)
      await shoot(page, args.out, '1-home-view')

      labels = await page.evaluate(() => {
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
      recordings.push(await record(page, resolve(args.out, 'r1-home-view-motion.png'), { seconds: 6 }))
    }

    // ---- checkpoint 7: attract mode --------------------------------------------------------
    // Before the plane flights, because on the shipped composition attract is not a key: it is PRD
    // 5.3.22's 45 s idle timer, and the only way to reach it is to send the page no input at all.
    // Everything below this stage uses the wheel, which would re-arm it. Nothing here dispatches
    // an input event: `evaluate` does not, and a CDP screencast does not.
    if (wanted('attract')) {
      console.log('\ncheckpoint 7 — attract mode')
      if (isShell) {
        const idleFrom = Date.now()
        for (;;) {
          if (!(await hudPresent(page))) break
          if (Date.now() - idleFrom > 120_000) throw new Error('attract mode did not start within 120 s of idle')
          await sleep(1000)
        }
        const idleS = (Date.now() - idleFrom) / 1000
        summary.attract = { entered: 'by PRD 5.3.22\'s idle timer', afterIdleS: Number(idleS.toFixed(1)), hudHidden: true }
        console.log(`  attract started after ${idleS.toFixed(0)} s of idle; the HUD left the tree (PRD 5.3.22)`)
      } else {
        // The harness binds `a` to `enterAttract`; the shell's idle timer is Phase 4's and is not
        // wired into that page.
        await page.keyboard.press('Escape')
        await waitForProbe(page, 'the multiverse', (s) => s.focus === 'multiverse' && !s.flying, 60_000)
        await page.keyboard.press('a')
        await waitForStatus(page, /attract true/, 15_000)
        summary.attract = { entered: 'by the harness key', afterIdleS: 0, hudHidden: false }
      }
      await sleep(8000) // into the middle of the first leg, not at its start
      await shoot(page, args.out, '7a-attract-mid-drift')
      recordings.push(await record(page, resolve(args.out, 'r3-attract-drift.png'), { seconds: 12 }))

      // 9.3 criterion 5, at the resolution that can answer it. The attract drift is the slowest
      // camera move the product makes, so it is the best case the criterion has, and it is
      // uninterruptible by anything this script does. `scale: 1` is the drawing buffer 1:1 — gate
      // #1 judged this on half-size frames, which average away the single-pixel stars that shimmer.
      console.log('  criterion 5 — the slow drift, at both resolutions')
      recordings.push(
        await record(page, resolve(args.out, '5a-shimmer-attract-cast.png'), { seconds: 5, fps: 10, scale: 1 }),
      )
      // …and the same drift as real device-resolution frames, which the cast above cannot give:
      // see `burst`. This is the one that answers the criterion.
      recordings.push(await burst(page, args.out, '5a2-shimmer-attract-full', { count: 14 }))
      await shoot(page, args.out, '7b-attract-later')

      // PRD 5.3.23: any input cancels attract. Deliberate, so the stages below start from rest.
      await page.keyboard.press('Escape')
      await sleep(1500)
      if (isShell && !(await hudPresent(page))) notes.push('the HUD did not come back after attract was cancelled')
    }

    // ---- checkpoint 2: three planes by card count ------------------------------------------
    const planes = (await page.evaluate(() => window.__eternitiesProbe.planes())).filter(
      (plane) => plane.slug !== BLIND_ETERNITIES_SLUG,
    )
    const named = (plane) => `${plane.slug} (${plane.cardCount} cards)`
    const largest = planes[0]
    const mid = planes[Math.floor(planes.length / 2)]
    const small = planes.filter((plane) => plane.cardCount < 50 && plane.cardCount > 0).at(0)
    if (!small) throw new Error('no plane under 50 cards in this roster')
    console.log(`\ncheckpoint 2 — largest ${named(largest)} · mid ${named(mid)} · under 50 ${named(small)}`)

    if (wanted('planes')) {
      // The flight out to the largest plane, recorded: PRD 5.7's tether and 9.3's "motion is
      // perceptible" are both about the move, not about either end of it.
      recordings.push(
        await record(page, resolve(args.out, 'r2-flight-to-plane.png'), {
          seconds: 9,
          during: () => flyToPlane(page, largest.slug),
        }),
      )
      await shoot(page, args.out, `2a-plane-largest-${largest.slug}`)

      // 9.3 asks whether "spiral arms are legible for every plane with ≥ 200 cards", and the answer
      // depends on how far out the rig settles — which PRD 5.7's tether decides, not the reviewer.
      // So the arrival frame above is joined by two closer ones, and the sidecars carry the distance
      // each was taken at. A criterion that passes at one distance and fails at another is a
      // tunable, and PRD open question 11 is what this gate is meant to settle.
      for (const [index, notches] of [6, 6].entries()) {
        await wheel(page, notches, -120, 120)
        await sleep(3000)
        await shoot(page, args.out, `2a-plane-largest-${largest.slug}-closer-${index + 1}`)
      }

      await flyToPlane(page, mid.slug)
      await shoot(page, args.out, `2b-plane-mid-${mid.slug}`)

      await flyToPlane(page, small.slug)
      await shoot(page, args.out, `2c-plane-under-50-${small.slug}`)
    }

    // ---- criterion 6: the star → thumbnail cross-fade ---------------------------------------
    if (wanted('crossfade')) {
      console.log('\ncriterion 6 — the star → thumbnail cross-fade (PRD 5.5.1)')
      await flyToPlane(page, largest.slug)
      const atPlane = await probeState(page)
      console.log(
        `  at ${largest.slug}, plane level: d ${atPlane.cameraDistance.toFixed(1)}, ` +
          `thumbnails ${atPlane.thumbnails.drawn} drawn / ${atPlane.thumbnails.cells} of ${atPlane.thumbnails.capacity} cells`,
      )

      // The band is crossed on the way *into* a card, not at plane level — which is exactly what
      // gate #1 could not reach, and why it reported `0 drawn / 0 of 512 cells` at every plane it
      // captured and passed the criterion untested. Recorded at the drawing buffer's own
      // resolution, because "never noticed as an event" is a question about what a single fade
      // looks like and a half-size frame softens every edge in it.
      let inward = []
      recordings.push(
        await record(page, resolve(args.out, 'r4-crossfade-into-card.png'), {
          seconds: 14,
          fps: 10,
          scale: 1,
          during: async () => {
            const flight = (async () => {
              const star = await page.evaluate(() => window.__eternitiesProbe.focusCard({}))
              if (star < 0) throw new Error(`focusCard() found no card on ${largest.slug}`)
              summary.crossfadeStar = star
              await waitForProbe(page, 'the card to be framed', (s) => s.card !== null && !s.flying, 60_000)
            })()
            inward = await withSampling(page, 14, () => flight)
          },
        }),
      )
      await sleep(3000)
      await shoot(page, args.out, '3-card-sheet-thumbnails')
      const atCard = await probeState(page)
      console.log(
        `  at the card: d ${atCard.cameraDistance.toFixed(1)}, eye ${atCard.cardEyeDistance.toFixed(2)}, ` +
          `thumbnails ${atCard.thumbnails.drawn} drawn / ${atCard.thumbnails.cells} of ${atCard.thumbnails.capacity} cells, ` +
          `${atCard.thumbnails.loaded} images loaded`,
      )

      // And back out, because a fade that is invisible on the way in can still be an event on the
      // way out — the tier unloads on a grace timer (PRD 5.5.4) rather than on the same curve.
      let outward = []
      recordings.push(
        await record(page, resolve(args.out, 'r5-crossfade-back-out.png'), {
          seconds: 10,
          fps: 10,
          scale: 1,
          during: async () => {
            const back = (async () => {
              await page.keyboard.press('Escape')
              await waitForProbe(page, 'the plane again', (s) => s.card === null && !s.flying, 60_000)
            })()
            outward = await withSampling(page, 10, () => back)
          },
        }),
      )
      await shoot(page, args.out, '3b-back-at-plane-level')

      const peak = (rows) => rows.reduce((best, row) => Math.max(best, row.drawn), 0)
      const firstDrawn = inward.find((row) => row.drawn > 0) ?? null
      const lastDrawn = [...outward].reverse().find((row) => row.drawn > 0) ?? null
      summary.crossfade = {
        plane: largest.slug,
        cards: largest.cardCount,
        band: { fadeStartPx: 14, fadeFullPx: 24, source: 'src/scene/tuning.ts' },
        atPlaneLevel: { d: Number(atPlane.cameraDistance.toFixed(2)), drawn: atPlane.thumbnails.drawn },
        atCardLevel: {
          d: Number(atCard.cameraDistance.toFixed(2)),
          eye: Number(atCard.cardEyeDistance.toFixed(2)),
          drawn: atCard.thumbnails.drawn,
          cells: atCard.thumbnails.cells,
          loaded: atCard.thumbnails.loaded,
          requested: atCard.thumbnails.requested,
          failed: atCard.thumbnails.failed,
        },
        crossedInward: firstDrawn !== null,
        firstDrawnAt: firstDrawn,
        peakDrawnInward: peak(inward),
        lastDrawnOnTheWayOut: lastDrawn,
        samplingIntervalMs: 100,
      }
      writeFileSync(
        resolve(args.out, 'crossfade.json'),
        `${JSON.stringify({ ...summary.crossfade, inward, outward }, null, 2)}\n`,
      )
      if (!firstDrawn) {
        notes.push(
          'the thumbnail tier never drew a cell on the way into a card — criterion 6 is untested again',
        )
      }
      console.log(
        `  crossfade.json — ${firstDrawn ? `first cell drawn ${firstDrawn.t} ms in at d ${firstDrawn.d}` : 'NO CELL EVER DREW'}` +
          `, peak ${peak(inward)} cells`,
      )
    }

    // ---- criterion 5: a slow camera move at plane level -------------------------------------
    if (wanted('shimmer')) {
      console.log('\ncriterion 5 — a slow zoom at plane level')
      await flyToPlane(page, mid.slug)
      recordings.push(
        await record(page, resolve(args.out, '5b-shimmer-slow-zoom-cast.png'), {
          seconds: 9,
          fps: 10,
          scale: 1,
          during: () => wheel(page, 12, -120, 700),
        }),
      )
      // The same move again, as device-resolution stills. Re-flown rather than shot during the cast
      // above: a screenshot every ~150 ms while a screencast is running perturbs the cadence the
      // cast is there to record, and each is cheap enough to take separately.
      await flyToPlane(page, mid.slug)
      recordings.push(
        await burst(page, args.out, '5b2-shimmer-slow-zoom-full', {
          count: 14,
          during: () => wheel(page, 12, -120, 700),
        }),
      )
      await shoot(page, args.out, '5c-after-the-slow-zoom')
    }

    // ---- checkpoint 6: the Blind Eternities -------------------------------------------------
    if (wanted('dust')) {
      console.log('\ncheckpoint 6 — the Blind Eternities')
      // PRD 5.3.4 leaves the dust unlabelled, so this is the one plane level with no billboard.
      await flyToPlane(page, BLIND_ETERNITIES_SLUG)
      await shoot(page, args.out, '6-blind-eternities')
      // Gate #1's owner question (c) was about the *framing* here, so the frame is joined by one
      // taken a third of a turn around it: whether the dust composes to the top-left is a question
      // about where the rig sits, and one viewpoint cannot tell a framing from a coincidence.
      await drag(page, 380, 0)
      await sleep(2500)
      await shoot(page, args.out, '6b-blind-eternities-orbited')
    }

    // ---- the star field on its own ----------------------------------------------------------
    if (wanted('starfield')) {
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
    }

    writeFileSync(
      resolve(args.out, 'capture.json'),
      `${JSON.stringify(
        {
          target: args.target,
          composition: isShell ? 'the shipped composition: the default route, scene and HUD together' : "Phase 3's scene alone",
          entry: entry.replace(url, ''),
          hudInTheTree: hudAtStart,
          dataset: args.dataset,
          hash: roster.hash,
          stars: roster.manifest.counts.stars,
          planes: roster.planes.length,
          canvas: gpu.size,
          renderer: gpu.renderer,
          viewport: VIEWPORT,
          stages: args.only ?? STAGES,
          checkpoint2: { largest, mid, small },
          labelsVisible: labels?.visible ?? null,
          labelsTotal: labels?.total ?? null,
          labelOverlaps: overlaps,
          recordings,
          ...summary,
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
