#!/usr/bin/env node
/**
 * Exit-criteria check, in a real browser.
 *
 * Builds the site against a fixture, serves it through `vite preview` (which sends the *production*
 * PRD 7.6.1 headers, not the dev-server relaxation), drives a local Chrome at it, and asserts both
 * phases' criteria. They live in two harnesses that `App` routes between, so this is two page
 * loads against the one preview server.
 *
 * The default page — Phase 2b's harness:
 *
 *   1. `planes.json` decodes and the camera rig comes up on it;
 *   2. the label overlay places plane names as HTML billboards (PRD 5.3.8);
 *   3. **navigation works end to end**: a keypress flies the camera to the Blind Eternities, the
 *      focus changes, the camera actually moves, and Esc brings it back (PRD 5.7.2, 6.1.3);
 *   4. plane detail loads through the worker, shard by shard, on focus (PRD 8.7.6, amendment A1) —
 *      the Blind Eternities is the sharded one, so it is the one this drives.
 *
 * `?selfcheck=1` — Phase 2a's harness:
 *
 *   5. the page renders a WebGL2 canvas — the star field of PRD 5.3.18 actually draws;
 *   6. the fixture decodes: manifest, planes.json, streamed stars.bin, search.json, sets.bin and
 *      a plane detail shard all come back through the contract decoders;
 *   7. the GPU self-check of PRD 8.5.7 — that the CPU motion mirror agrees with the vertex shader
 *      — passes on this machine's actual driver.
 *
 * And across both: nothing blocked by the Content Security Policy (including `worker-src`), no
 * console error and no failed request.
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
 *   node scripts/verify-browser.mjs [--dataset small|scale|all] [--keep] [--allow-software]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
  const args = { dataset: 'scale', keep: false, allowSoftware: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--keep') args.keep = true
    else if (argv[i] === '--allow-software') args.allowSoftware = true
  }
  return args
}

/** A software rasteriser answering as the GPU. `bench.mjs` refuses these; so does this. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|mesa offscreen/i

/**
 * What the build will point at, resolved the same way `vite.config.ts` resolves it — fixture name
 * first, then a raw hash. The assertions below are stated relative to this roster.
 */
function readRoster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = registry.fixtures[dataset] ?? dataset
  const root = resolve(WEB_ROOT, 'public/data', hash)
  const planes = JSON.parse(readFileSync(resolve(root, 'planes.json'), 'utf8')).planes
  // PRD 5.3.4: the dust is deliberately unlabelled, so it is not one of the billboards.
  const labelled = planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG).length
  const shards = readdirSync(resolve(root, 'planes')).filter((name) =>
    name.startsWith(`${BLIND_ETERNITIES_SLUG}.`),
  ).length
  return { hash, planes: planes.length, labelled, shards }
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

/** Phase 2b's harness: the navigation contract driving the real camera rig. */
async function verifyNavigation(page, url, roster, problems) {
  console.log('  -- Phase 2b: navigation, labels, plane detail --')
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
          document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
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
        document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
      ),
    { timeout: 30_000 },
    detailPattern.source,
  )
  const detail = await page.evaluate(
    () =>
      /detail: [^\n]*/.exec(
        document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
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

async function verify(dataset, allowSoftware) {
  console.log(`\n=== ${dataset} ===`)
  const roster = readRoster(dataset)
  console.log(
    `  roster ${roster.hash}: ${roster.planes} planes, ${roster.labelled} labelled, ` +
      `the dust over ${roster.shards} shard(s)`,
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
    page.on('console', (message) => {
      // The browser reports a resource 404 as a console error with no URL; `response` below
      // reports the same failure with the URL, so keep that one and drop the blind duplicate.
      const text = message.text()
      if (message.type() === 'error' && !text.startsWith('Failed to load resource')) {
        problems.push(`console error: ${text}`)
      }
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        problems.push(`HTTP ${response.status()}: ${response.url()}`)
      }
    })
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
    page.on('requestfailed', (request) =>
      problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`),
    )

    await verifyNavigation(page, url, roster, problems)
    await verifyStarField(page, url, allowSoftware, problems)

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
const datasets = args.dataset === 'all' ? ['small', 'scale'] : [args.dataset]
for (const dataset of datasets) {
  await verify(dataset, args.allowSoftware)
}
console.log('\nall datasets navigable in the browser')
