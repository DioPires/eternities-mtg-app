#!/usr/bin/env node
/**
 * Concept C's one-hour still (DEC-694 / review §4.2, §4.3: "its one-hour still — a streamgraph
 * rendered from `planes.json` set counts — is worth making regardless").
 *
 * A streamgraph of every plane's card count per year, 1993→2026, built from `planes.json` alone:
 * `plane.sets[].year` and `plane.sets[].cardCount` are the only inputs. The Blind Eternities is
 * the grey bedrock underneath rather than a stratum, because review §4.1's finding is that its
 * 4,980 cards (17.4%) have no shape of their own; empty planes are absent and counted in the
 * caption, which is concept C's answer to the 57.
 *
 * Two honest things about the picture:
 *
 *   - **it is the real data, not a sketch.** No smoothing, no interpolation between years, no
 *     dropped strata: 30 planes with cards, every year they printed in, stacked.
 *   - **the colours are the same contrast-stretched `palette` mix the worlds prototype uses**, so
 *     a stratum's colour is a statistic of its own cards. Grey means "average colour balance",
 *     which is what almost every large plane is (review §4.1).
 *
 * Written as SVG and rasterised through the same headless Chrome the capture script uses, so the
 * PNG is at a stated resolution and dpr rather than at whatever an SVG viewer decides.
 *
 *   node scripts/strata-still.mjs [--out DIR] [--width N] [--height N] [--dpr N] [--dataset HASH]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** `HUE_COLOURS` from `src/scene/tuning.ts`, in `palette` order: W U B R G multi colourless. */
const BAND_COLOURS = [
  [1.0, 0.949, 0.827],
  [0.322, 0.639, 1.0],
  [0.616, 0.412, 0.949],
  [1.0, 0.451, 0.239],
  [0.322, 0.831, 0.494],
  [1.0, 0.812, 0.361],
  [0.812, 0.855, 0.898],
]

/** Same stretch as `prototypes/worlds/data.ts`; see the comment there for why it exists. */
const PALETTE_GAIN = 5.0

const MARGIN = { top: 96, right: 40, bottom: 74, left: 40 }

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error(`no Chrome found; set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`)
}

function parseArgs(argv) {
  const args = {
    out: resolve(WEB_ROOT, '../review/dec694-worlds'),
    width: 1920,
    height: 1080,
    dpr: 1,
    dataset: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--out') {
      args.out = resolve(value)
      i += 1
    } else if (flag === '--width') {
      args.width = Number(value)
      i += 1
    } else if (flag === '--height') {
      args.height = Number(value)
      i += 1
    } else if (flag === '--dpr') {
      args.dpr = Number(value)
      i += 1
    } else if (flag === '--dataset') {
      args.dataset = value
      i += 1
    } else {
      throw new Error(`unknown flag ${flag}`)
    }
  }
  return args
}

function dataHash(requested) {
  if (requested !== null) return requested
  const registry = JSON.parse(readFileSync(resolve(WEB_ROOT, 'datasets.json'), 'utf8'))
  return registry.production
}

function linearToSrgb(channel) {
  const c = Math.max(0, Math.min(1, channel))
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function planeColour(plane, reference) {
  const out = [0, 0, 0]
  let total = 0
  for (let i = 0; i < BAND_COLOURS.length; i += 1) {
    const raw = plane.palette[i] ?? 0
    const mean = reference[i] ?? 0
    const weight = Math.max(0, mean + (raw - mean) * PALETTE_GAIN)
    for (let c = 0; c < 3; c += 1) out[c] += BAND_COLOURS[i][c] * weight
    total += weight
  }
  if (total <= 0) return { fill: '#41465a', ink: '#e6e8ef' }
  const linear = out.map((channel) => (channel / total) * 0.74)
  const rgb = linear.map((channel) => Math.round(linearToSrgb(channel) * 255))
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  return {
    fill: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
    ink: luminance > 0.22 ? '#05060a' : '#e6e8ef',
  }
}

function meanPalette(planes) {
  const mean = new Array(BAND_COLOURS.length).fill(0)
  let cards = 0
  for (const plane of planes) {
    if (plane.cardCount === 0) continue
    cards += plane.cardCount
    for (let i = 0; i < BAND_COLOURS.length; i += 1) {
      mean[i] += (plane.palette[i] ?? 0) * plane.cardCount
    }
  }
  return cards === 0 ? mean.fill(1 / BAND_COLOURS.length) : mean.map((v) => v / cards)
}

function escapeXml(text) {
  return text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * The streamgraph. Strata are ordered by first year then by total, and stacked **wiggle-minimised
 * about the centre** — the standard streamgraph baseline — with the Blind Eternities pinned below
 * the axis as bedrock so it is never mistaken for a plane with a shape.
 */
function buildSvg(planesFile, args) {
  const planes = planesFile.planes
  const reference = meanPalette(planes)
  const dust = planes.find((plane) => plane.kind === 'dust') ?? null
  const strata = planes
    .filter((plane) => plane.kind !== 'dust' && plane.cardCount > 0)
    .map((plane) => {
      const byYear = new Map()
      for (const set of plane.sets) {
        byYear.set(set.year, (byYear.get(set.year) ?? 0) + set.cardCount)
      }
      return {
        name: plane.displayName,
        total: plane.cardCount,
        first: plane.firstYear ?? 1993,
        colour: planeColour(plane, reference),
        dust: false,
        byYear,
      }
    })
    .sort((a, b) => a.first - b.first || b.total - a.total)

  const empties = planes.filter((plane) => plane.kind !== 'dust' && plane.cardCount === 0).length

  const firstYear = Math.min(...strata.map((s) => s.first))
  const lastYear = Math.max(...planes.map((plane) => plane.lastYear ?? firstYear))
  const years = []
  for (let year = firstYear; year <= lastYear; year += 1) years.push(year)

  const dustByYear = new Map()
  if (dust !== null) {
    for (const set of dust.sets) {
      dustByYear.set(set.year, (dustByYear.get(set.year) ?? 0) + set.cardCount)
    }
  }

  const perYearTotal = years.map((year) =>
    strata.reduce((sum, stratum) => sum + (stratum.byYear.get(year) ?? 0), 0),
  )
  const dustPerYear = years.map((year) => dustByYear.get(year) ?? 0)
  const peak = Math.max(...perYearTotal)
  const dustPeak = Math.max(1, ...dustPerYear)

  const plotWidth = args.width - MARGIN.left - MARGIN.right
  const plotHeight = args.height - MARGIN.top - MARGIN.bottom
  // Bedrock takes a fixed slice of the plot, so the strata keep their vertical resolution.
  const bedrockHeight = Math.round(plotHeight * 0.16)
  const streamHeight = plotHeight - bedrockHeight
  const x = (year) =>
    MARGIN.left + ((year - firstYear) / Math.max(1, lastYear - firstYear)) * plotWidth
  const scale = streamHeight / (peak * 1.06)
  const centre = MARGIN.top + streamHeight / 2

  /* Centred stack: each year's total is centred on the axis, so the silhouette is symmetric. */
  const baseline = years.map((_year, i) => centre - (perYearTotal[i] * scale) / 2)
  const offsets = years.map((_year, i) => baseline[i])

  const bands = []
  for (const stratum of strata) {
    const top = []
    const bottom = []
    years.forEach((year, i) => {
      const value = (stratum.byYear.get(year) ?? 0) * scale
      bottom.push([x(year), offsets[i]])
      offsets[i] += value
      top.push([x(year), offsets[i]])
    })
    const path = [
      `M ${bottom.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' L ')}`,
      `L ${top
        .slice()
        .reverse()
        .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
        .join(' L ')}`,
      'Z',
    ].join(' ')
    bands.push({ stratum, path })
  }

  const bedrockTop = MARGIN.top + streamHeight + 26
  const bedrockScale = (bedrockHeight - 26) / dustPeak
  const bedrockPath = [
    `M ${years.map((year, i) => `${x(year).toFixed(1)},${(bedrockTop + dustPerYear[i] * bedrockScale).toFixed(1)}`).join(' L ')}`,
    `L ${x(lastYear).toFixed(1)},${bedrockTop.toFixed(1)}`,
    `L ${x(firstYear).toFixed(1)},${bedrockTop.toFixed(1)}`,
    'Z',
  ].join(' ')

  /*
   * Label the strata that are thick enough to carry a name at their thickest year, biggest first,
   * skipping any that would land on a label already placed. Overlapping labels were the whole
   * failure of the first pass: 29 names all wanted the middle of the picture.
   */
  const candidates = []
  for (const { stratum } of bands) {
    let bestYear = null
    let bestValue = 0
    for (const [year, value] of stratum.byYear) {
      if (value > bestValue) {
        bestValue = value
        bestYear = year
      }
    }
    if (bestYear === null || bestValue * scale < 16) continue
    const index = years.indexOf(bestYear)
    let below = baseline[index]
    for (const other of strata) {
      if (other === stratum) break
      below += (other.byYear.get(bestYear) ?? 0) * scale
    }
    const size = bestValue * scale > 34 ? 15 : 12
    // "Avishkar (formerly Kaladesh)" is 28 characters and does not fit any stratum; the
    // parenthetical is the part nobody needs on a chart.
    const name = stratum.name.replace(/\s*\(.*\)\s*$/, '')
    const text = `${name}${size > 13 ? ` · ${stratum.total.toLocaleString('en-GB')}` : ''}`
    const halfWidth = (text.length * size * 0.58) / 2
    candidates.push({
      text,
      ink: stratum.colour.ink,
      thickness: bestValue * scale,
      x: Math.min(
        Math.max(x(bestYear), MARGIN.left + halfWidth + 4),
        args.width - MARGIN.right - halfWidth - 4,
      ),
      y: below + (bestValue * scale) / 2,
      size,
      halfWidth,
    })
  }
  candidates.sort((a, b) => b.thickness - a.thickness)
  const labels = []
  for (const candidate of candidates) {
    const clash = labels.some(
      (placed) =>
        Math.abs(placed.x - candidate.x) < placed.halfWidth + candidate.halfWidth + 10 &&
        Math.abs(placed.y - candidate.y) < (placed.size + candidate.size) * 0.9,
    )
    if (!clash) labels.push(candidate)
  }

  const ticks = years.filter((year) => year % 5 === 0 || year === firstYear || year === lastYear)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${args.width}" height="${args.height}" viewBox="0 0 ${args.width} ${args.height}">
  <rect width="100%" height="100%" fill="#05060a"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#e6e8ef">
    <text x="${MARGIN.left}" y="42" font-size="24">Concept C — strata</text>
    <text x="${MARGIN.left}" y="68" font-size="13" fill="#8d97b0">One stratum per plane, thickness = cards printed that year. ${strata.length} planes with cards, ${firstYear}–${lastYear}. Blind Eternities (${dust === null ? 0 : dust.cardCount.toLocaleString('en-GB')} cards) is the bedrock; ${empties} empty planes are absent and indexed. Built from planes.json alone.</text>
  </g>
  <g>
${bands.map(({ stratum, path }) => `    <path d="${path}" fill="${stratum.colour.fill}" stroke="#05060a" stroke-width="0.6"/>`).join('\n')}
  </g>
  <path d="${bedrockPath}" fill="#2a2d38" stroke="#3a3e4c" stroke-width="0.8"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle">
${labels
  .map(
    ({ text, ink, x: lx, y: ly, size }) =>
      `    <text x="${lx.toFixed(1)}" y="${(ly + size * 0.35).toFixed(1)}" font-size="${size}" fill="${ink}" opacity="0.9">${escapeXml(text)}</text>`,
  )
  .join('\n')}
    <text x="${(MARGIN.left + 8).toFixed(1)}" y="${(bedrockTop + 18).toFixed(1)}" font-size="12" fill="#8d97b0" text-anchor="start">Blind Eternities — bedrock, ${dust === null ? 0 : dust.cardCount.toLocaleString('en-GB')} cards, no shape of its own</text>
  </g>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#8d97b0" font-size="12" text-anchor="middle">
${ticks
  .map(
    (year) =>
      `    <line x1="${x(year).toFixed(1)}" y1="${(args.height - MARGIN.bottom + 12).toFixed(1)}" x2="${x(year).toFixed(1)}" y2="${(args.height - MARGIN.bottom + 18).toFixed(1)}" stroke="#3a3e4c"/>\n    <text x="${x(year).toFixed(1)}" y="${(args.height - MARGIN.bottom + 34).toFixed(1)}">${year}</text>`,
  )
  .join('\n')}
  </g>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#6f7893" font-size="11">
    <text x="${MARGIN.left}" y="${args.height - 14}">DEC-694 · dataset ${escapeXml(args.hash)} · ${args.width}×${args.height} css @ dpr ${args.dpr} · stratum colour = plane palette, contrast-stretched ×${PALETTE_GAIN}</text>
    <text x="${args.width - MARGIN.right}" y="${args.height - 14}" text-anchor="end">Card data via Scryfall.</text>
  </g>
</svg>
`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(args.out, { recursive: true })
  args.hash = dataHash(args.dataset)

  const planesFile = JSON.parse(
    readFileSync(resolve(WEB_ROOT, 'public/data', args.hash, 'planes.json'), 'utf8'),
  )
  const svg = buildSvg(planesFile, args)
  const svgPath = resolve(args.out, 'concept-c-strata.svg')
  writeFileSync(svgPath, svg)

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', `--window-size=${args.width},${args.height}`],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: args.width, height: args.height, deviceScaleFactor: args.dpr })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#05060a">${svg}</body></html>`,
      { waitUntil: 'load' },
    )
    const png = resolve(args.out, 'concept-c-strata.png')
    await page.screenshot({ path: png })
    console.log(`wrote ${svgPath}\nwrote ${png} (${args.width}×${args.height} css @ dpr ${args.dpr})`)
  } finally {
    await browser.close()
  }
}

await main()
