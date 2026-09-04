#!/usr/bin/env node
/**
 * Exit-criteria check, in a real browser.
 *
 * Builds the site against a fixture, serves it through `vite preview` (which sends the *production*
 * PRD 7.6.1 headers, not the dev-server relaxation), drives a local Chrome at it, and asserts:
 *
 *   1. the page renders a WebGL2 canvas — the hello-scene of PRD 5.3.18 actually draws;
 *   2. `planes.json` decodes and the camera rig comes up on it;
 *   3. the label overlay places plane names as HTML billboards (PRD 5.3.8);
 *   4. **navigation works end to end**: a keypress flies the camera to the Blind Eternities, the
 *      focus changes, the camera actually moves, and Esc brings it back (PRD 5.7.2, 6.1.3);
 *   5. plane detail loads through the worker, shard by shard, on focus (PRD 8.7.6, amendment A1) —
 *      the Blind Eternities is the sharded one, so it is the one this drives;
 *   6. nothing was blocked by the Content Security Policy, including `worker-src`;
 *   7. no console error and no failed request.
 *
 * Uses `puppeteer-core` against the browser already on the machine — nothing is downloaded. CI
 * runs the Node-side suites; this is the local gate the implementation plan §6 asks for, and it
 * is what Phase 6's Playwright smoke replaces.
 *
 *   node scripts/verify-browser.mjs [--dataset small|scale] [--keep]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  const args = { dataset: 'scale', keep: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--keep') args.keep = true
  }
  return args
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

async function verify(dataset) {
  console.log(`\n=== ${dataset} ===`)
  execFileSync('pnpm', ['build'], {
    cwd: WEB_ROOT,
    env: { ...process.env, ETERNITIES_DATASET: dataset },
    stdio: 'inherit',
  })

  const { child, url } = await startPreview(dataset)
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
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

    const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
    const csp = response?.headers()['content-security-policy']
    if (!csp) throw new Error('the preview server sent no Content-Security-Policy header')
    if (csp.includes("'unsafe-inline'") && csp.includes('script-src')) {
      const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? ''
      if (scriptSrc.includes("'unsafe-inline'")) {
        throw new Error(`the production policy must not relax script-src: ${scriptSrc}`)
      }
    }
    console.log(`  CSP: ${csp}`)

    const statusText = () =>
      page.evaluate(() => document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '')
    const cameraProbe = () =>
      page.evaluate(() => document.querySelector('[data-testid="camera"]')?.textContent ?? '')
    const cameraDistance = async () => Number.parseFloat((await cameraProbe()).split('· d ')[1] ?? 'NaN')
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

    // PRD 5.3.8: plane names as HTML overlay billboards, never 3D text. Wait for the layout solver
    // to have run at least one frame and made some of them visible.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.label')).filter(
          (node) => Number.parseFloat(node.style.opacity || '0') > 0.05,
        ).length > 10,
      { timeout: 30_000 },
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
      `  labels: ${labels.visible} of ${labels.total} visible, e.g. ${labels.sample.join(', ')}`,
    )
    if (labels.total < 40) throw new Error(`only ${labels.total} plane labels were created`)

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
    await page.waitForFunction(
      () =>
        /detail: blind-eternities \d+ cards over 4 shard\(s\) \(sharded, worker-parsed\)/.test(
          document.querySelector('[data-testid="phase2b-status"]')?.textContent ?? '',
        ),
      { timeout: 30_000 },
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
    void statusText

    const canvas = await page.evaluate(() => {
      const element = document.querySelector('canvas')
      if (!element) return null
      const context = element.getContext('webgl2')
      return {
        width: element.width,
        height: element.height,
        webgl2: context !== null,
        // A non-black pixel somewhere proves the background starfield actually drew.
        renderer: context?.getParameter(context.VERSION) ?? null,
      }
    })
    if (!canvas) throw new Error('no <canvas> in the document')
    if (!canvas.webgl2) throw new Error('the canvas has no WebGL2 context')
    console.log(`  canvas ${canvas.width}x${canvas.height}, ${canvas.renderer}`)

    const drew = await page.evaluate(() => {
      const element = document.querySelector('canvas')
      // toDataURL round-trips the drawing buffer; a scene of only the #05060a sky and no stars
      // compresses to a much shorter data URL than one with thousands of additive points.
      return (element?.toDataURL('image/png').length ?? 0) > 5000
    })
    if (!drew) problems.push('the canvas looks empty — the background starfield may not have drawn')
    else console.log('  background starfield drew')

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
  await verify(dataset)
}
console.log('\nall datasets navigable in the browser')
