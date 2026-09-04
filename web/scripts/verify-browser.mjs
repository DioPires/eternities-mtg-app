#!/usr/bin/env node
/**
 * Exit-criteria check, in a real browser.
 *
 * Builds the site against a dataset, serves it through `vite preview` (which sends the *production*
 * PRD 7.6.1 headers, not the dev-server relaxation), drives a local Chrome at it, and asserts three
 * phases' criteria over two page loads.
 *
 * The default page — the scene, which since Phase 3 is one scene rather than two harnesses:
 *
 *   1. `planes.json` decodes and the camera rig comes up on it;
 *   2. the label overlay places plane names as HTML billboards (PRD 5.3.8);
 *   3. **navigation works end to end**: a keypress flies the camera to the Blind Eternities, the
 *      focus changes, the camera actually moves, and Esc brings it back (PRD 5.7.2, 6.1.3);
 *   4. plane detail loads through the worker, shard by shard, on focus (PRD 8.7.6, amendment A1) —
 *      the Blind Eternities is the sharded one, so it is the one this drives;
 *   5. **the star field is in that same scene**: the rig now flies over the real field rather than
 *      over Phase 0's backdrop, which is the integration Phase 3 inherited.
 *
 * `?probe=1` — Phase 3's card tier, driven through the seam of `src/scene/probe.ts`:
 *
 *   6. the multiverse → plane → card journey, end to end: fly to a plane, its shards land, focus a
 *      card, the card object appears with its planets (PRD 5.6.1-8);
 *   7. the thumbnail tier fetches nearest-first under PRD 7.2's six-request cap, never exceeding it;
 *   8. a printing is activated (PRD 5.6.9) and a double-faced card is flipped (PRD 5.6.5);
 *   9. GPU memory stays inside PRD 7.2's 96 MB target, measured rather than estimated.
 *
 * `?selfcheck=1` — Phase 2a's instrumentation harness, which still owns the bench and the GPU
 * self-check because both drive the camera themselves:
 *
 *  10. the page renders a WebGL2 canvas — the star field of PRD 5.3.18 actually draws;
 *  11. the fixture decodes: manifest, planes.json, streamed stars.bin, search.json, sets.bin and
 *      a plane detail shard all come back through the contract decoders;
 *  12. the GPU self-check of PRD 8.5.7 — that the CPU motion mirror agrees with the vertex shader
 *      — passes on this machine's actual driver.
 *
 * And across all three: nothing blocked by the Content Security Policy (including `worker-src` and
 * the `connect-src` grant for Scryfall), no console error and no failed request from our own origin.
 *
 * **On Scryfall images.** Only the production dataset carries real Scryfall printing ids; the
 * fixtures are synthetic, so every image request against them 404s. That is not a gap in the check
 * — it is PRD 7.4.2's path, and asserting it is how "a failed image leaves the star glow or the
 * previous image in place; nothing renders as a broken rectangle" gets tested at all. Pass
 * `--dataset production` for the run where the images actually arrive.
 *
 * The roster-dependent thresholds are read from the fixture rather than hard-coded, because
 * `--dataset all` runs this against `fixture-small`'s 5 planes as well as `fixture-scale`'s 83.
 *
 * Uses `puppeteer-core` against the browser already on the machine — nothing is downloaded. CI
 * runs the Node-side suites; this is the local gate the implementation plan §6 asks for, and it
 * is what Phase 6's Playwright smoke replaces.
 *
 * Runs on the machine's real GPU, the way `bench.mjs` does, and fails if Chrome falls back to a
 * software rasteriser: the GPU self-check is cited as the mitigation for driver variance and
 * SwiftShader cannot answer for a driver. `--allow-software` downgrades that to a warning, for a
 * box that has no GPU at all.
 *
 *   node scripts/verify-browser.mjs [--dataset small|scale|production|all] [--keep] [--allow-software]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const BLIND_ETERNITIES_SLUG = 'blind-eternities'

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      `no Chrome found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`,
    )
  }
  return found
}

function parseArgs(argv) {
  const args = { dataset: 'scale', keep: false, allowSoftware: false, shots: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--keep') args.keep = true
    else if (argv[i] === '--allow-software') args.allowSoftware = true
    // PRD 9.3's visual review: write the checkpoint frames this run can reach to a directory.
    else if (argv[i] === '--shots') args.shots = argv[++i]
  }
  return args
}

/**
 * Frame times over `seconds`, sampled in the page.
 *
 * PRD 7.2 asks for the steady-state frame rate "at every level", and the bench of PRD 9.1.2 flies a
 * scripted path that predates the card tier — so at card level, with an atlas full of thumbnails
 * and 72 planets orbiting, this is the only measurement there is until Phase 6 rebuilds `/bench`
 * against the folded scene.
 */
async function sampleFrames(page, seconds) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const samples = []
        let last = performance.now()
        const stop = last + duration * 1000
        const tick = () => {
          const now = performance.now()
          samples.push(now - last)
          last = now
          if (now < stop) requestAnimationFrame(tick)
          else {
            const sorted = [...samples].sort((a, b) => a - b)
            const total = samples.reduce((sum, ms) => sum + ms, 0)
            resolve({
              frames: samples.length,
              fps: Math.round(((samples.length * 1000) / total) * 100) / 100,
              p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 100) / 100,
              p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
              max: Math.round(sorted[sorted.length - 1] * 100) / 100,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
    seconds,
  )
}

/** A software rasteriser answering as the GPU. `bench.mjs` refuses these; so does this. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|mesa offscreen/i

/**
 * A dataset name resolved the same way `vite.config.ts` resolves it: a fixture name, then any other
 * top-level key of `datasets.json` (`production`, `active`), then a raw hash. Keeping the two in
 * step is what lets `--dataset production` mean the same thing here and in the build.
 */
function resolveDataset(registry, name) {
  if (registry.fixtures?.[name]) return registry.fixtures[name]
  if (typeof registry[name] === 'string') return registry[name]
  return name
}

/**
 * What the build will point at. The assertions below are stated relative to this roster.
 */
function readRoster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = resolveDataset(registry, dataset)
  const root = resolve(WEB_ROOT, 'public/data', hash)
  const planes = JSON.parse(readFileSync(resolve(root, 'planes.json'), 'utf8')).planes
  // PRD 5.3.4: the dust is deliberately unlabelled, so it is not one of the billboards.
  const labelled = planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG).length
  const shards = readdirSync(resolve(root, 'planes')).filter((name) =>
    name.startsWith(`${BLIND_ETERNITIES_SLUG}.`),
  ).length
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
  // Only a real Scryfall run carries real printing ids; a fixture's are synthetic and every image
  // request against them 404s. `scryfallBulkUpdatedAt` is the pipeline's own record of which it is.
  const realImages = typeof manifest.scryfallBulkUpdatedAt === 'string'
  return { hash, planes: planes.length, labelled, shards, stars: manifest.counts.stars, realImages }
}

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const match = /(http:\/\/localhost:\d+)/.exec(chunk)
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`vite preview exited with ${code}`))
    })
  })
  return { child, url }
}

/**
 * The scene's canvas and the driver that drew it.
 *
 * R3F sizes the drawing buffer from a resize observer, which fires after `load`. Reading before it
 * does reports the 300x150 HTML default and asserts nothing about the renderer.
 */
async function readCanvas(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('canvas')).some(
        (element) => element.width > 300 && element.height > 150,
      ),
    { timeout: 30_000 },
  )
  const canvas = await page.evaluate(() => {
    // Pick the largest canvas: postprocessing and some dev tooling add their own, and the first
    // one in the document is not necessarily the scene's.
    const all = Array.from(document.querySelectorAll('canvas'))
    const element = all.sort((a, b) => b.width * b.height - a.width * a.height)[0]
    if (!element) return null
    const context = element.getContext('webgl2')
    const debug = context?.getExtension('WEBGL_debug_renderer_info')
    return {
      count: all.length,
      width: element.width,
      height: element.height,
      webgl2: context !== null,
      version: context?.getParameter(context.VERSION) ?? null,
      // Which driver actually drew this. The whole point of the self-check.
      gpu: context
        ? String(
            debug
              ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : context.getParameter(context.RENDERER),
          )
        : null,
    }
  })
  if (!canvas) throw new Error('no <canvas> in the document')
  if (!canvas.webgl2) throw new Error('the canvas has no WebGL2 context')
  console.log(
    `  canvas ${canvas.width}x${canvas.height} (${canvas.count} on the page), ${canvas.version}`,
  )
  console.log(`  GPU: ${canvas.gpu}`)
  return canvas
}

/** The scene: the navigation contract driving the real camera rig over the real star field. */
async function verifyNavigation(page, url, roster, problems) {
  console.log('  -- the scene: navigation, labels, plane detail, star field --')
  const response = await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
  const csp = response?.headers()['content-security-policy']
  if (!csp) throw new Error('the preview server sent no Content-Security-Policy header')
  if (csp.includes("'unsafe-inline'") && csp.includes('script-src')) {
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? ''
    if (scriptSrc.includes("'unsafe-inline'")) {
      throw new Error(`the production policy must not relax script-src: ${scriptSrc}`)
    }
  }
  console.log(`  CSP: ${csp}`)

  const cameraProbe = () =>
    page.evaluate(() => document.querySelector('[data-testid="camera"]')?.textContent ?? '')
  const cameraDistance = async () =>
    Number.parseFloat((await cameraProbe()).split('· d ')[1] ?? 'NaN')
  /** Wait for the status panel to match, i.e. for the rig to have got there. */
  const waitForStatus = (pattern, timeout = 30_000) =>
    page.waitForFunction(
      (source) =>
        new RegExp(source).test(
          document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
        ),
      { timeout },
      pattern.source,
    )

  // The rig is up, and PRD 6.8.2's intro has flown in and settled: `flight: idle` at the
  // multiverse focus is checkpoint 1 of PRD 9.3, the home view after the intro.
  await waitForStatus(/focus: multiverse/)
  await waitForStatus(/flight: idle/, 30_000)
  const homeDistance = await cameraDistance()
  console.log(`  intro settled at the home view, ${homeDistance.toFixed(1)} from the centre`)
  if (!(homeDistance > 0) || homeDistance > 600) {
    throw new Error(`the intro did not fly in: still ${homeDistance} from the centre`)
  }

  await readCanvas(page)

  // PRD 5.3.8: plane names as HTML overlay billboards, never 3D text. Wait for the layout solver to
  // have run at least one frame and made some of them visible. "Some" is relative to the roster:
  // `fixture-small` has four labelled planes in total, so a fixed floor of ten could only ever be
  // a fixture-scale assertion that silently failed everywhere else.
  const visibleFloor = Math.min(10, Math.max(1, Math.floor(roster.labelled / 2)))
  await page.waitForFunction(
    (floor) =>
      Array.from(document.querySelectorAll('.label')).filter(
        (node) => Number.parseFloat(node.style.opacity || '0') > 0.05,
      ).length >= floor,
    { timeout: 30_000 },
    visibleFloor,
  )
  const labels = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.label'))
    const visible = nodes.filter((n) => Number.parseFloat(n.style.opacity || '0') > 0.05)
    return {
      total: nodes.length,
      visible: visible.length,
      sample: visible.slice(0, 3).map((n) => n.textContent ?? ''),
    }
  })
  console.log(
    `  labels: ${labels.visible} of ${labels.total} visible (floor ${visibleFloor}), e.g. ${labels.sample.join(', ')}`,
  )
  // At multiverse focus there are no band labels, so the overlay is exactly the labelled planes.
  if (labels.total < roster.labelled) {
    throw new Error(
      `only ${labels.total} plane labels were created, expected ${roster.labelled} for this roster`,
    )
  }

  // PRD 5.7.2 / 6.1.3: fly to the Blind Eternities and back. The harness binds 'b' and Escape;
  // Phase 4 binds the real controls, and this is what proves the contract drives a real camera.
  const beforeFly = await cameraProbe()

  await page.keyboard.press('b')
  await waitForStatus(/focus: plane \(blind-eternities\)/, 15_000)
  await waitForStatus(/flight: idle/, 20_000)
  const dustDistance = await cameraDistance()
  console.log(`  flew to the Blind Eternities and settled ${dustDistance.toFixed(1)} out`)
  // PRD 5.3.4: the dust anchor tethers with *plane-level* distance limits, so arriving there
  // must leave the camera an order of magnitude closer than the multiverse home view.
  if (!(dustDistance < homeDistance / 2)) {
    throw new Error(
      `the Blind Eternities fly-to did not reach plane level: ${dustDistance} vs home ${homeDistance}`,
    )
  }

  // PRD 8.7.6 + amendment A1: every shard of the focused plane, fetched and parsed in the worker.
  // The shard count is the fixture's, not a constant — the dust is four shards at fixture-scale
  // and one at fixture-small.
  const detailPattern = new RegExp(
    `detail: ${BLIND_ETERNITIES_SLUG} \\d+ cards over ${roster.shards} shard\\(s\\) \\(sharded, worker-parsed\\)`,
  )
  await page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout: 30_000 },
    detailPattern.source,
  )
  const detail = await page.evaluate(
    () =>
      /detail: [^\n]*/.exec(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      )?.[0] ?? '',
  )
  console.log(`  ${detail}`)

  const afterFly = await cameraProbe()
  if (beforeFly === afterFly) {
    problems.push(`the camera did not move: still at ${afterFly}`)
  } else {
    console.log(`  the camera moved: ${beforeFly}  ->  ${afterFly}`)
  }

  await page.keyboard.press('Escape')
  await waitForStatus(/focus: multiverse/, 15_000)
  await waitForStatus(/flight: idle/, 20_000)
  const backDistance = await cameraDistance()
  console.log(`  Esc returned to the multiverse, ${backDistance.toFixed(1)} from the centre`)
  if (!(backDistance > dustDistance * 2)) {
    throw new Error(`Esc did not fly back out: ${backDistance} vs ${dustDistance}`)
  }

  // Phase 3's integration, stated as an assertion rather than as a screenshot: the rig above and
  // the star field are the *same scene*. Before the fold, this page had no `stars.bin` at all — it
  // flew over Phase 0's background starfield — so a complete streamed field on the page that just
  // answered the navigation assertions is what says the two are one.
  await page.waitForFunction(
    () =>
      /\(complete\)/.test(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout: 120_000 },
  )
  const stars = await page.evaluate(
    () =>
      /stars: [^\n]*/.exec(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      )?.[0] ?? '',
  )
  console.log(`  ${stars}`)
  const drawn = Number.parseInt(/stars: (\d+)/.exec(stars)?.[1] ?? '0', 10)
  if (drawn !== roster.stars) {
    throw new Error(
      `the scene drew ${drawn} of ${roster.stars} stars — the rig and the field are not one scene`,
    )
  }
}


/**
 * Phase 3's card tier, end to end (PRD 5.5, 5.6, 7.2, 7.4.2).
 *
 * Driven through `?probe=1` (`src/scene/probe.ts`), which calls the product's own click handler
 * rather than a second implementation of it. What is asserted here is everything a screenshot
 * cannot settle: that the journey completes, that the ring layout matches the printing count, that
 * the six-request cap held, and that GPU memory stayed inside the budget.
 *
 * `imagesLoad` says whether the dataset's printing ids are real Scryfall ids. On a fixture they are
 * not, so every image 404s — and the assertions then switch to PRD 7.4.2's promise, which is the
 * more interesting half: no broken rectangles, no console noise, the journey still completes.
 */
/**
 * The scene's own drawing buffer, written to a PNG. **Not** `page.screenshot`.
 *
 * The canvas runs at the adaptive-quality pixel ratio — 1.5 — so its drawing buffer is half again
 * the size of the CSS box, and the compositor's capture of that did not agree with what the page
 * had drawn: it put the focused card in the top right of the frame while the probe, twice over,
 * reported it at the exact centre of the viewport (0.0000 world units off the camera's look-at
 * point, projecting to 50%, 50%). Reading the buffer back is what the page actually rendered, at
 * the resolution it rendered it, and it is the same route Phase 2a's GPU self-check takes for the
 * same reason. It needs `preserveDrawingBuffer`, which the scene turns on only for `?probe=1`.
 */
async function shoot(page, path) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      }),
  )
  const data = await page.evaluate(() => {
    const canvas = Array.from(document.querySelectorAll('canvas')).sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0]
    return canvas ? canvas.toDataURL('image/png') : null
  })
  if (!data) throw new Error('no canvas to capture')
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'))
}

async function verifyCardTier(page, url, imagesLoad, shots, problems) {
  console.log('  -- Phase 3: thumbnails, card, planets --')
  await page.goto(`${url}/?probe=1`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => window.__eternitiesProbe !== undefined, { timeout: 60_000 })
  await page.waitForFunction(
    () =>
      /\(complete\)/.test(
        document.querySelector('[data-testid="eternities-status"]')?.textContent ?? '',
      ),
    { timeout: 120_000 },
  )

  const state = () => page.evaluate(() => window.__eternitiesProbe.state())

  // PRD 5.7.2: fly to the largest plane. The card tier only exists where the cards are.
  const target = await page.evaluate(() => {
    const plane = window.__eternitiesProbe.planes()[0]
    window.__eternitiesProbe.focusPlane(plane.slug)
    return plane
  })
  console.log(`  flying to ${target.slug} (${target.cardCount} cards)`)
  await page.waitForFunction(
    (slug, wanted) => {
      const probe = window.__eternitiesProbe.state()
      return probe.planeSlug === slug && probe.cardsLoaded >= Math.min(wanted, 2000)
    },
    { timeout: 60_000 },
    target.slug,
    target.cardCount,
  )
  const atPlane = await state()
  console.log(`  plane focused, ${atPlane.cardsLoaded} card records from its shards`)

  // PRD 5.6.1: focus a card. This is the click handler's own path.
  const star = await page.evaluate(() => window.__eternitiesProbe.focusCard())
  if (star < 0) throw new Error('no card on the focused plane could be focused')
  await page.waitForFunction(() => window.__eternitiesProbe.state().card !== null, {
    timeout: 30_000,
  })
  await page.waitForFunction(() => !window.__eternitiesProbe.state().flying, { timeout: 30_000 })
  const focused = await state()
  const card = focused.card
  console.log(
    `  card focused: ${card.name}, ${card.printings} printing(s) -> ${card.planets} planet(s)` +
      (card.overflow > 0 ? `, ${card.overflow} listed in the panel` : '') +
      `, camera ${focused.cameraDistance.toFixed(2)} out`,
  )
  if (focused.level !== 'card') throw new Error(`the level did not reach card: ${focused.level}`)

  // PRD 5.6.1: "the camera flies to frame it". One number rather than a judgement about a
  // screenshot — the card is placed by the star field's motion function and the camera aims at the
  // rig's tether, and this is what says those are the same point.
  console.log(`  card framed ${focused.cardFrameOffset.toFixed(4)} world units off centre`)
  // Where that lands on screen, as a fraction of the viewport. The world-space number says the
  // camera aims at the card; this says the projection agrees, and the two together are what PRD
  // 5.6.1's "flies to frame it" actually promises.
  const onScreen = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const rect = canvas.getBoundingClientRect()
    return { cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height) }
  })
  console.log(`  canvas css box ${onScreen.cssWidth}x${onScreen.cssHeight}`)
  const screen = focused.cardScreen
  console.log(
    `  card projects to ${(screen.x * 100).toFixed(1)}%, ${(screen.y * 100).toFixed(1)}% of the ` +
      `viewport; eye-to-card ${focused.cardEyeDistance.toFixed(3)} against a rig radius of ` +
      `${focused.cameraDistance.toFixed(3)}`,
  )
  if (Math.abs(screen.x - 0.5) > 0.08 || Math.abs(screen.y - 0.5) > 0.08) {
    throw new Error(
      `PRD 5.6.1: the focused card projects to ${(screen.x * 100).toFixed(1)}%, ` +
        `${(screen.y * 100).toFixed(1)}% of the viewport rather than to its centre`,
    )
  }
  if (focused.cardFrameOffset > 0.05) {
    throw new Error(
      `PRD 5.6.1: the camera is framing a point ${focused.cardFrameOffset.toFixed(3)} units from ` +
        `the card it flew to, against a card 0.63 units wide`,
    )
  }

  // PRD 5.6.8's ring progression, against the card that actually got focused.
  const expectedPlanets =
    card.printings <= 1 ? 0 : Math.min(card.printings, 72)
  if (card.planets !== expectedPlanets) {
    throw new Error(
      `PRD 5.6.8: ${card.printings} printings should show ${expectedPlanets} planets, showed ${card.planets}`,
    )
  }
  if (card.overflow !== Math.max(0, card.printings - 72)) {
    throw new Error(`PRD 5.6.8: overflow should be ${card.printings - 72}, was ${card.overflow}`)
  }

  // PRD 5.5: the thumbnail tier. At card level the neighbours are at the cross-fade distance, so
  // this is where the card sheet tier is; the selector should have asked for images either way.
  //
  // Waited on the *queue draining*, not on a fixed delay: the assertions below are about what the
  // tier settled on, and a snapshot taken mid-flight reports cells that are merely claimed. A tier
  // that kept re-requesting failures forever would never drain, which is a failure worth having.
  await page.waitForFunction(
    () => {
      const q = window.__eternitiesProbe.state().images
      return q.inFlight === 0 && q.waiting === 0 && q.completed + q.failed > 0
    },
    { timeout: 90_000, polling: 500 },
  )
  await new Promise((r) => setTimeout(r, 1500))
  const withThumbs = await state()
  const t = withThumbs.thumbnails
  const images = withThumbs.images
  console.log(
    `  thumbnails: ${t.drawn} drawn, ${t.cells}/${t.capacity} cells, ` +
      `${t.requested} requested, ${t.loaded} loaded, ${t.failed} failed`,
  )
  console.log(
    `  image queue: peak ${images.peakInFlight} in flight, ${images.completed} completed, ` +
      `${images.failed} failed`,
  )
  // PRD 7.2: 6 concurrent requests, ceiling 8. Measured, not asserted from the constant.
  if (images.peakInFlight > 6) {
    throw new Error(`PRD 7.2: ${images.peakInFlight} concurrent image requests, cap is 6`)
  }
  if (t.requested === 0) {
    throw new Error('the thumbnail tier never asked for an image at card level (PRD 5.5.1)')
  }

  if (imagesLoad) {
    await page.waitForFunction(() => window.__eternitiesProbe.state().thumbnails.loaded > 0, {
      timeout: 60_000,
    })
    const loaded = await state()
    console.log(`  thumbnails loaded: ${loaded.thumbnails.loaded} cells, ${loaded.thumbnails.drawn} drawn`)
    if (loaded.thumbnails.drawn === 0) {
      throw new Error('thumbnails loaded but none were drawn (PRD 5.5.1)')
    }
    const stars = await page.evaluate(() => window.__eternitiesProbe.thumbnailStars())
    console.log(`    e.g. star ${stars.slice(0, 5).join(', ')}`)
    // PRD 9.3 checkpoint 3: the card-sheet tier with thumbnails loaded.
    if (shots) await shoot(page, resolve(shots, '3-card-sheet.png'))
  } else {
    // PRD 7.4.2, which is the whole of what a synthetic fixture can establish: every image failed
    // and nothing broke. No cell is left claimed by a fetch that will never arrive, so the atlas is
    // free for a card that can be fetched, and the stars are still the stars.
    if (t.failed === 0) {
      throw new Error('the fixture has synthetic ids, so every image should have failed — none did')
    }
    if (t.drawn !== 0) {
      throw new Error(`PRD 7.4.2: ${t.drawn} thumbnails drawn with no image loaded`)
    }
    if (t.cells !== 0) {
      throw new Error(`PRD 7.4.2: ${t.cells} atlas cells still held by failed fetches`)
    }
    console.log(`  every image 404d (synthetic ids) and the star glow stayed: ${t.failed} failures, 0 drawn`)
  }

  // PRD 5.6.9: activate a printing. On a one-printing card there is nothing to activate.
  if (card.planets > 1) {
    const activated = await page.evaluate(() => window.__eternitiesProbe.activatePrinting(1))
    if (!activated) throw new Error('PRD 5.6.9: activating a printing did not take')
    const after = await state()
    if (after.card.activePrinting !== 1) {
      throw new Error(`PRD 5.6.9: active printing is ${after.card.activePrinting}, expected 1`)
    }
    console.log(`  printing 1 activated (PRD 5.6.9)`)
  }

  // PRD 5.6.5 and PRD 9.3 checkpoint 4: a double-faced card, flipped.
  const dfc = await page.evaluate(() => window.__eternitiesProbe.focusCard({ dfc: true }))
  if (dfc < 0) {
    console.log('  no double-faced card on this plane; PRD 5.6.5 flip not exercised here')
  } else {
    await page.waitForFunction(() => window.__eternitiesProbe.state().card?.canFlip === true, {
      timeout: 30_000,
    })
    // Settled, not mid-flight: PRD 9.3's checkpoints are of the view the user arrives at, and a
    // frame grabbed during the fly-to shows the card wherever the tween had got to.
    await page.waitForFunction(() => !window.__eternitiesProbe.state().flying, { timeout: 30_000 })
    await new Promise((r) => setTimeout(r, 2500))
    const framed = await state()
    console.log(
      `  the flipping card is framed ${framed.cardFrameOffset.toFixed(4)} world units off centre`,
    )
    // The front face, before the turn: the pair is what makes PRD 5.6.5's "shows the front face; a
    // flip control turns the card 180° to show the back" checkable rather than assertable.
    if (shots) await shoot(page, resolve(shots, '4a-card-focus-front.png'))
    const flipped = await page.evaluate(() => window.__eternitiesProbe.flip())
    if (!flipped) throw new Error('PRD 5.6.5: a card with a back image refused to flip')
    await new Promise((r) => setTimeout(r, 1200))
    const turned = await state()
    if (!turned.card.flipped) throw new Error('PRD 5.6.5: the flip did not take')
    console.log(`  double-faced card ${turned.card.name} flipped (PRD 5.6.5)`)
    // PRD 9.3 checkpoint 4: card focus with planets, one double-faced card flipped.
    if (shots) await shoot(page, resolve(shots, '4-card-focus-flipped.png'))
  }

  // PRD 7.2's "steady-state frame rate at every level", measured at the level this phase added.
  const frames = await sampleFrames(page, 4)
  console.log(
    `  card level, ${frames.frames} frames: ${frames.fps} fps, p50 ${frames.p50} ms, ` +
      `p95 ${frames.p95} ms, worst ${frames.max} ms`,
  )
  // Frame *rate* is vsync-capped, so the ceiling is the honest gate and the percentile is what says
  // how much headroom is left (the same reading `bench/BenchRunner` states).
  if (frames.fps < 50) {
    problems.push(`PRD 7.2: ${frames.fps} fps at card level is under the 50 fps ceiling`)
  }
  if (frames.p95 > 33) {
    problems.push(`PRD 7.2: p95 ${frames.p95} ms at card level is over the 33 ms ceiling`)
  }

  // PRD 7.2's GPU memory line, measured on what is actually uploaded.
  const memory = (await state()).gpu
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  console.log(
    `  GPU memory: ${mb(memory.totalBytes)} (atlas ${mb(memory.atlasBytes)}, card ` +
      `${mb(memory.cardBytes)}) against a ${mb(memory.targetBytes)} target / ` +
      `${mb(memory.ceilingBytes)} ceiling`,
  )
  if (!memory.withinCeiling) {
    throw new Error(`PRD 7.2: ${mb(memory.totalBytes)} exceeds the ${mb(memory.ceilingBytes)} ceiling`)
  }
  if (!memory.withinTarget) {
    problems.push(`PRD 7.2: ${mb(memory.totalBytes)} is over the ${mb(memory.targetBytes)} target`)
  }

  // PRD 6.1.3: Esc leaves the card, and the card object goes with it.
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__eternitiesProbe.state().card === null, {
    timeout: 30_000,
  })
  console.log('  Esc released the card focus and the card object went with it')
}

/** Phase 2a's harness: the contract decoders, the star field, and the GPU self-check. */
async function verifyStarField(page, url, allowSoftware, problems) {
  console.log('  -- Phase 2a: contract decode, star field, GPU self-check --')
  // `load`, not `networkidle0`: since Phase 2a the canvas animates continuously and the star
  // field keeps a software renderer busy, so "the network went quiet" is not a signal worth
  // waiting on. The assertions below wait on the page's own state instead.
  await page.goto(`${url}/?selfcheck=1`, { waitUntil: 'load', timeout: 60_000 })

  // Wait for the decode report to land (or fail loudly).
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="phase0-status"]')
      return panel !== null && /data directory|FAILED/.test(panel.textContent ?? '')
    },
    { timeout: 30_000 },
  )
  // The last line only appears once every artefact has decoded.
  await page.waitForFunction(
    () =>
      /plane shard |FAILED/.test(
        document.querySelector('[data-testid="phase0-status"]')?.textContent ?? '',
      ),
    { timeout: 60_000 },
  )

  const report = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="phase0-status"]')
    const list = panel?.querySelector('ul')
    return {
      ok: list?.classList.contains('ok') ?? false,
      lines: Array.from(list?.querySelectorAll('li') ?? []).map((li) => li.textContent ?? ''),
    }
  })
  for (const line of report.lines) console.log(`  ${line}`)
  if (!report.ok) throw new Error('the data contract decode report reported a failure')

  const canvas = await readCanvas(page)
  if (SOFTWARE_RENDERER.test(canvas.gpu ?? '')) {
    const message =
      `Chrome fell back to a software rasteriser (${canvas.gpu}). The GPU self-check below ` +
      `is cited as the mitigation for driver variance and cannot establish it from software.`
    if (!allowSoftware) {
      throw new Error(
        `${message}\n  Re-run on a machine with a working GPU, or pass --allow-software to accept a software run.`,
      )
    }
    console.log(`  WARNING: ${message} Continuing because --allow-software was passed.`)
  }

  // Every record drawable and every plane revealed: the streaming loader of PRD 8.7.3 reached
  // the end and the per-plane fade-in of PRD 6.8.1 fired for each one.
  await page.waitForFunction(
    () =>
      /\(complete\)/.test(document.querySelector('[data-testid="scene-status"]')?.textContent ?? ''),
    { timeout: 120_000 },
  )
  const scene = await page.evaluate(
    () => document.querySelector('[data-testid="scene-status"]')?.textContent ?? '',
  )
  console.log(`  scene: ${scene.replace(/\s+/g, ' ').trim().slice(0, 160)}`)

  // PRD 8.5.6 and 8.5.7 checked against each other on the GPU: the CPU motion mirror's world
  // position, projected to a pixel, has to pick the same star back out of the id buffer.
  await page.waitForFunction(() => window.__eternitiesSelfCheck !== undefined, {
    timeout: 120_000,
    polling: 250,
  })
  const selfCheck = await page.evaluate(() => window.__eternitiesSelfCheck)
  console.log(
    `  id-buffer picking vs CPU motion mirror: the shader drew ${selfCheck.measured}/` +
      `${selfCheck.checked} sampled stars a mean of ${selfCheck.meanOffsetPx}px ` +
      `(max ${selfCheck.maxOffsetPx}px, tolerance ${selfCheck.tolerancePx}px) from the pixel ` +
      `the mirror predicted; ${selfCheck.unmeasured} not in window` +
      (selfCheck.unmeasuredRows.length > 0
        ? ` (plane rows ${selfCheck.unmeasuredRows.map(([row, n]) => `${row}x${n}`).join(' ')})`
        : ''),
  )
  console.log(
    `    of those ${selfCheck.measured} the pointer would have selected ${selfCheck.agreed} ` +
      `exactly and ${selfCheck.occluded} via a nearer star (${selfCheck.offScreen} off screen, ` +
      `${selfCheck.positionMode} positions, buffer ${selfCheck.buffer.join('x')}, ` +
      `${selfCheck.spriteFloorPx}px pick sprite)`,
  )
  console.log(
    `    samples per plane row: ` + selfCheck.sampledRows.map(([row, n]) => `${row}x${n}`).join(' '),
  )
  if (selfCheck.canvasBytes < 5000) {
    problems.push(`the canvas looks empty (${selfCheck.canvasBytes}-byte PNG) — nothing drew`)
  } else {
    console.log(`  star field drew (${selfCheck.canvasBytes}-byte PNG round-trip)`)
  }

  // A drift too small to trip any single sample still moves the mean. Measured on Metal at the
  // 2px self-check sprite: 0.29-0.33px on fixture-small and 0.21px on fixture-scale, most of which is
  // the pixel quantisation of the window itself. 1.5px is a real bound, not a formality — it is
  // five times the observed figure, and a uniform 2 world-unit drift on one plane row of
  // `fixture-small` takes the mean to 1.61px.
  if (selfCheck.meanOffsetPx > 1.5) {
    throw new Error(
      `the shader draws stars a mean of ${selfCheck.meanOffsetPx}px from where the CPU motion ` +
        `mirror puts them — that is a systematic disagreement, not quantisation`,
    )
  }

  if (!selfCheck.ok) {
    for (const miss of selfCheck.missed.slice(0, 8)) {
      console.log(
        `    star ${miss.index} (plane row ${miss.planeRow}): mirror says ${miss.x},${miss.y} ` +
          `(z ${miss.z}), shader drew it ${miss.drawnAtPx}px away; pointer would pick ${miss.picked}`,
      )
    }
    // An error too large to measure looks like agreement: every star on the row is outside its
    // own pick window, so none of them lands in `missed` and the mean improves. The row going
    // dark is the only trace it leaves, and it is the trace of the worst version of the bug.
    //
    // Built before the miss throw rather than after it. Both conditions can hold in one run, and
    // the misses throw first, so a dark row reported only from its own throw would be lost in
    // exactly the runs that have the most wrong with them.
    const darkRows =
      selfCheck.darkRows.length > 0
        ? `the self-check could not locate the stars of plane ` +
          `${selfCheck.darkRows.length === 1 ? 'row' : 'rows'} ` +
          `${selfCheck.darkRows.map(([row, dark, n]) => `${row} (${dark} of ${n} samples missing from their own pick window)`).join(', ')} ` +
          `— a whole well-sampled row going dark is what a motion-mirror error too large to ` +
          `measure looks like, not what occlusion looks like`
        : ''

    if (selfCheck.missed.length > 0) {
      throw new Error(
        `the CPU motion mirror disagrees with the vertex shader for ${selfCheck.missed.length} ` +
          `stars — PRD 8.5.7's camera tether would frame the wrong point` +
          (darkRows === '' ? '' : `. And in the same run, ${darkRows}`),
      )
    }
    if (darkRows !== '') throw new Error(darkRows)
    throw new Error(
      `the self-check located only ${selfCheck.measured} of ${selfCheck.checked} sampled stars ` +
        `in their own pick window — too few to establish PRD 8.5.7 either way`,
    )
  }
}

async function verify(dataset, allowSoftware, shots) {
  console.log(`\n=== ${dataset} ===`)
  const roster = readRoster(dataset)
  console.log(
    `  roster ${roster.hash}: ${roster.planes} planes, ${roster.labelled} labelled, ` +
      `${roster.stars} stars, the dust over ${roster.shards} shard(s), ` +
      `${roster.realImages ? 'real' : 'synthetic'} Scryfall ids`,
  )

  execFileSync('pnpm', ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: 'inherit',
  })

  const { child, url } = await startPreview(dataset)
  // The same launch `bench.mjs` uses. This check is cited as the mitigation for PRD risk 6 and for
  // driver variance, and it cannot say anything about driver variance from a software rasteriser:
  // the GPU self-check has to run on a GPU. `--enable-unsafe-swiftshader` stays only so that a
  // fallback surfaces as the assertion below rather than as a crash with no explanation.
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--use-angle=metal',
      '--enable-unsafe-swiftshader',
    ],
  })

  const problems = []
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })

    /**
     * A failing request to *our own origin* is a defect. A failing request to Scryfall is not
     * necessarily one, and on a fixture it is guaranteed: the ids are synthetic, so every image
     * 404s by construction, and PRD 7.4.2's promise — the glow stays, nothing renders as a broken
     * rectangle — is exactly what those 404s are there to exercise. They are counted and reported
     * rather than treated as failures, and `verifyCardTier` asserts on the count.
     *
     * `net::ERR_ABORTED` on a Scryfall URL is this build's own `ImageQueue.cancel` working.
     */
    const scryfall = (url) => url.includes('scryfall.io')
    const upstream = { failed: 0, aborted: 0 }

    page.on('console', (message) => {
      // The browser reports a resource 404 as a console error with no URL; `response` below
      // reports the same failure with the URL, so keep that one and drop the blind duplicate.
      const text = message.text()
      if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
        problems.push(`console error: ${text}`)
      }
    })
    page.on('response', (response) => {
      if (response.status() < 400) return
      if (scryfall(response.url())) {
        upstream.failed += 1
        return
      }
      problems.push(`HTTP ${response.status()}: ${response.url()}`)
    })
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
    page.on('requestfailed', (request) => {
      if (scryfall(request.url())) {
        upstream.aborted += 1
        return
      }
      problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`)
    })

    await verifyNavigation(page, url, roster, problems)
    await verifyCardTier(page, url, roster.realImages, shots, problems)
    await verifyStarField(page, url, allowSoftware, problems)

    console.log(
      `  Scryfall: ${upstream.failed} image request(s) returned an error, ` +
        `${upstream.aborted} cancelled by the queue` +
        (roster.realImages ? '' : ' — expected, this dataset has synthetic ids'),
    )
    if (roster.realImages && upstream.failed > 0) {
      problems.push(`${upstream.failed} Scryfall image request(s) failed on a real-id dataset`)
    }

    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n  - ${problems.join('\n  - ')}`)
    }
    console.log(`  OK — ${dataset} is navigable in the browser under the production CSP`)
  } finally {
    await browser.close()
    child.kill('SIGTERM')
  }
}

const args = parseArgs(process.argv.slice(2))
// `all` stays the two fixtures: `production` is a 40 MB build and a live Scryfall round trip, so
// it is opted into rather than swept up.
const datasets = args.dataset === 'all' ? ['small', 'scale'] : [args.dataset]
if (args.shots) mkdirSync(args.shots, { recursive: true })
for (const dataset of datasets) {
  await verify(dataset, args.allowSoftware, args.shots)
}
console.log('\nall datasets navigable in the browser')
