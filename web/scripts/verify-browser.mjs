#!/usr/bin/env node
/**
 * Phase 0 exit-criteria check, in a real browser.
 *
 * Builds the site against a fixture, serves it through `vite preview` (which sends the *production*
 * PRD 7.6.1 headers, not the dev-server relaxation), drives a local Chrome at it, and asserts:
 *
 *   1. the page renders a WebGL2 canvas — the hello-scene of PRD 5.3.18 actually draws;
 *   2. the fixture decodes: manifest, planes.json, streamed stars.bin, search.json, sets.bin and
 *      a plane detail shard all come back through the contract decoders;
 *   3. nothing was blocked by the Content Security Policy;
 *   4. no console error and no failed request.
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
  const args = { dataset: 'small', keep: false }
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

    // `load`, not `networkidle0`: since Phase 2a the canvas animates continuously and the star
    // field keeps a software renderer busy, so "the network went quiet" is not a signal worth
    // waiting on. The assertions below wait on the page's own state instead.
    const response = await page.goto(`${url}/?selfcheck=1`, { waitUntil: 'load', timeout: 60_000 })
    const csp = response?.headers()['content-security-policy']
    if (!csp) throw new Error('the preview server sent no Content-Security-Policy header')
    if (csp.includes("'unsafe-inline'") && csp.includes('script-src')) {
      const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? ''
      if (scriptSrc.includes("'unsafe-inline'")) {
        throw new Error(`the production policy must not relax script-src: ${scriptSrc}`)
      }
    }
    console.log(`  CSP: ${csp}`)

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
      () => /plane shard |FAILED/.test(
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

    const canvas = await page.evaluate(() => {
      // Pick the largest canvas: postprocessing and some dev tooling add their own, and the first
      // one in the document is not necessarily the scene's.
      const all = Array.from(document.querySelectorAll('canvas'))
      const element = all.sort((a, b) => b.width * b.height - a.width * a.height)[0]
      if (!element) return null
      const context = element.getContext('webgl2')
      return {
        count: all.length,
        width: element.width,
        height: element.height,
        webgl2: context !== null,
        // A non-black pixel somewhere proves the background starfield actually drew.
        renderer: context?.getParameter(context.VERSION) ?? null,
      }
    })
    if (!canvas) throw new Error('no <canvas> in the document')
    if (!canvas.webgl2) throw new Error('the canvas has no WebGL2 context')
    console.log(`  canvas ${canvas.width}x${canvas.height} (${canvas.count} on the page), ${canvas.renderer}`)

    // --- Phase 2a ------------------------------------------------------------------------------

    // Every record drawable and every plane revealed: the streaming loader of PRD 8.7.3 reached
    // the end and the per-plane fade-in of PRD 6.8.1 fired for each one.
    await page.waitForFunction(
      () => /\(complete\)/.test(document.querySelector('[data-testid="scene-status"]')?.textContent ?? ''),
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
      `  id-buffer picking vs CPU motion mirror: ${selfCheck.agreed}/${selfCheck.checked} agreed, ` +
        `${selfCheck.occluded} shared a pixel with a nearer star` +
        `(${selfCheck.offScreen} off screen, ${selfCheck.positionMode} positions, ` +
        `buffer ${selfCheck.buffer.join('x')}); neighbour offset mean ` +
        `${selfCheck.meanOffsetPx}px, max ${selfCheck.maxOffsetPx}px`,
    )
    if (selfCheck.canvasBytes < 5000) {
      problems.push(`the canvas looks empty (${selfCheck.canvasBytes}-byte PNG) — nothing drew`)
    } else {
      console.log(`  star field drew (${selfCheck.canvasBytes}-byte PNG round-trip)`)
    }

    // A systematic error would move every star the same way and show up here even though each
    // individual sample landed on a plausible neighbour.
    if (selfCheck.meanOffsetPx > 3) {
      throw new Error(
        `the picker's stars sit a mean of ${selfCheck.meanOffsetPx}px from where the CPU motion ` +
          `mirror puts them — that is a systematic disagreement, not crowding`,
      )
    }

    if (!selfCheck.ok) {
      for (const miss of selfCheck.missed.slice(0, 8)) {
        console.log(
          `    star ${miss.index} (plane row ${miss.planeRow}) at ${miss.x},${miss.y} ` +
            `picked ${miss.picked}` +
            `${miss.pickedAt ? `, which the mirror puts at ${miss.pickedAt.join(',')}` : ''}`,
        )
      }
      throw new Error(
        `the CPU motion mirror disagrees with the vertex shader for ${selfCheck.missed.length} ` +
          `stars — PRD 8.5.7's camera tether would frame the wrong point`,
      )
    }

    if (problems.length > 0) {
      throw new Error(`browser reported problems:\n  - ${problems.join('\n  - ')}`)
    }
    console.log(`  OK — ${dataset} decodes in the browser under the production CSP`)
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
console.log('\nall datasets verified in the browser')
