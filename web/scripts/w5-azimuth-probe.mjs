/**
 * Scratch, round 3. Throwaway.
 *
 * Round 2's readings were taken inside attract mode (PRD 5.3.22's 45 s idle timer), which flies the
 * camera and fades the labels — so "visible 2" and a rig still drifting at +50 s were the attract
 * flight, not the home view, and its W4 reading was not at any pose. This round defeats attract
 * with a `pointermove` heartbeat (PRD 5.3.23 cancels on any input; a bare move is not a drag) and
 * checks, rather than assumes, that the heartbeat leaves the camera alone.
 *
 *  A. Does the heartbeat hold the home view, and is the camera still?
 *  B. The real visible-plane-label band over an evenly-spaced wall-clock comb.
 *  C. W4 at a pose the spec names: drive to 2.2 radii and assert it before reading.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => existsSync(p))

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

function roster(dataset) {
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = registry.fixtures?.[dataset] ?? registry[dataset] ?? dataset
  const planes = JSON.parse(
    readFileSync(resolve(WEB_ROOT, 'public/data', hash, 'planes.json'), 'utf8'),
  ).planes
  return { hash, planes }
}

async function startPreview(dataset) {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '0', '--strictPort', 'false'], {
    cwd: WEB_ROOT,
    // NO_COLOR: hosted runners set `CI`, which turns vite's colours on even into a pipe, and the
    // port then arrives wrapped in bold escapes (`localhost:\e[1m4173\e[22m`) the URL match misses.
    env: { ...process.env, ETERNITIES_DATASET: dataset, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => process.stderr.write(`  [vite] ${c}`))
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => {
      const m = /(http:\/\/localhost:\d+)/.exec(c)
      if (m) { clearTimeout(timer); ok(m[1]) }
    })
  })
  return { url, stop: () => child.kill('SIGTERM') }
}

const readLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.label')].map((node) => ({
      text: (node.querySelector('.label-name')?.textContent ?? '').trim(),
      slug: node.getAttribute('data-plane-slug'),
      opacity: Number(getComputedStyle(node).opacity),
    })),
  )

const probeState = (page) => page.evaluate(() => window.__eternitiesProbe?.state?.() ?? null)

/**
 * PRD 5.3.23's cheapest input: a bare `pointermove` cancels attract and re-arms the timer, and
 * unlike `pointerdown` it is not the start of a drag, so the rig is untouched. Dispatched on
 * `window` because that is where `useAttractMode` listens.
 */
const heartbeat = (page) =>
  page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  })

async function main() {
  const { hash, planes } = roster('worlds')
  const worlds = planes.filter((p) => p.kind !== 'dust' && p.cardCount > 0)
  const slugOfName = new Map(planes.map((p) => [p.displayName, p.slug]))
  const worldSlugs = new Set(worlds.map((p) => p.slug))
  console.log(`dataset ${hash}: ${planes.length} planes, ${worlds.length} worlds with cards`)

  const { url, stop } = await startPreview('worlds')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.error(`  [page error] ${e.message}`))
    let scryfall = 0
    page.on('request', (r) => { if (r.url().includes('scryfall')) scryfall += 1 })
    await page.goto(`${url}/?probe=shell&motion=1`, { waitUntil: 'networkidle2', timeout: 120_000 })
    for (let i = 0; i < 40; i += 1) {
      const s = await probeState(page)
      if (s && !s.flying) break
      await sleep(1000)
    }

    // --- A + B: the home view, heartbeat every 20 s, sampled every 40 s -------------------------
    console.log('\n--- home view with an attract heartbeat, 6 samples 40 s apart ---')
    const seen = new Map()
    const configs = new Set()
    let unresolved = 0
    for (let i = 0; i < 6; i += 1) {
      if (i > 0) {
        // Two heartbeats inside the 45 s window, so the timer never reaches the end of it.
        for (let k = 0; k < 2; k += 1) { await heartbeat(page); await sleep(20_000) }
      }
      const state = await probeState(page)
      const labels = await readLabels(page)
      const visible = labels.filter((l) => l.opacity > 0.05)
      const resolved = visible.map((l) => l.slug ?? slugOfName.get(l.text) ?? null)
      unresolved += resolved.filter((s) => s === null).length
      const hereWorlds = resolved.filter((s) => s !== null && worldSlugs.has(s))
      for (const s of hereWorlds) seen.set(s, (seen.get(s) ?? 0) + 1)
      configs.add([...hereWorlds].sort().join('|'))
      console.log(
        `t+${i * 40}s  level ${state?.level} ${state?.flying ? 'FLYING' : 'idle'} d ${state?.cameraDistance?.toFixed(1)}  ` +
          `.label ${labels.length}  visible ${visible.length}  worlds ${hereWorlds.length}`,
      )
    }
    console.log(`labels whose world could not be resolved: ${unresolved}`)
    console.log(`distinct world configurations over 6 samples: ${configs.size}`)
    const never = worlds.filter((p) => !seen.has(p.slug)).map((p) => p.slug)
    console.log(`worlds never labelled over this 6-sample comb: ${never.length} ${JSON.stringify(never.slice(0, 12))}`)

    // --- C: W4 at 2.2 radii ---------------------------------------------------------------------
    console.log('\n--- dominaria, driven to 2.2 radii ---')
    await page.evaluate(() => window.__eternitiesProbe.focusPlane('dominaria'))
    for (let i = 0; i < 90; i += 1) {
      const s = await probeState(page)
      if (s && s.planeSlug === 'dominaria' && !s.flying) break
      await heartbeat(page)
      await sleep(1000)
    }
    const poseOf = (page) =>
      page.evaluate(() => {
        const p = window.__eternitiesProbe.worlds()
        return p ? { slug: p.planeSlug, radii: p.radii, cells: p.cells.length } : null
      })
    console.log(`  at settle: ${JSON.stringify(await poseOf(page))}`)

    // Wheel toward 2.2. Sign is unknown here, so try one notch and see which way radii moved.
    const centre = await page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
      const r = c.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await page.mouse.move(centre.x, centre.y)
    for (let i = 0; i < 40; i += 1) {
      const before = await poseOf(page)
      if (before === null) break
      if (Math.abs(before.radii - 2.2) < 0.02) break
      await page.mouse.wheel({ deltaY: before.radii > 2.2 ? -120 : 120 })
      await sleep(400)
      const after = await poseOf(page)
      if (i === 0) console.log(`  one notch: radii ${before.radii.toFixed(3)} -> ${after?.radii?.toFixed(3)}`)
    }
    console.log(`  after driving: ${JSON.stringify(await poseOf(page))}`)

    for (const waited of [5, 15, 30]) {
      const t0 = Date.now()
      while (Date.now() - t0 < waited * 1000) { await heartbeat(page); await sleep(5000) }
      const w = await page.evaluate(() => {
        const p = window.__eternitiesProbe.worlds()
        if (!p) return null
        const wanting = p.cells.filter((c) => c.wantsArt && c.frontFacing && c.onScreen)
        return {
          slug: p.planeSlug,
          radii: Number(p.radii.toFixed(3)),
          cells: p.cells.length,
          pool: p.pool,
          wanting: wanting.length,
          showing: wanting.filter((c) => c.showingArt).length,
        }
      })
      console.log(`  +${waited}s  ${JSON.stringify(w)}  scryfall ${scryfall}`)
    }
  } finally {
    await browser.close()
    stop()
  }
}

await main()
