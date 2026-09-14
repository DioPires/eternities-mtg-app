#!/usr/bin/env node
/**
 * Payload budget check — PRD 7.2 and 9.1.1, plus amendment A1's plane-shard row.
 *
 * Measures **encoded transferred size**, not disk size. `.bin` artefacts are not text, and a CDN
 * may or may not compress them; the browser's cost is what the edge actually sends, so this
 * compresses with brotli at the quality Vercel's edge uses and reports that.
 *
 * Ceilings fail the build. Targets are reported, matching PRD 9.1.2's split between what is a
 * commitment and what is an aspiration. A row within 10% of its target is warned about, so the
 * run before the one that misses is visible rather than reading like any other pass.
 *
 *   node scripts/check-budget.mjs [--dataset small|scale|<hash>] [--dist dist]
 */

import { brotliCompressSync, constants } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const KB = 1024
const MB = 1024 * 1024

/**
 * How close to a target counts as worth saying out loud. Without a band, `668.5 KB / target
 * 700.0 KB` prints exactly like `280 KB / target 700 KB`, so the run that is one set away from
 * missing a target reads as comfortable. Warning-only: PRD 9.1.2 makes ceilings the commitment.
 */
const NEAR_TARGET_FRACTION = 0.9

/** PRD 7.2, with the A1 row appended. `null` means the row is not automatable here. */
const BUDGETS = [
  {
    id: 'first-frame',
    label: 'Transferred before the first rendered frame (shell, manifest.json, planes.json)',
    target: 500 * KB,
    ceiling: 1 * MB,
  },
  {
    id: 'intro',
    label: 'Transferred before the intro starts (adds stars.bin)',
    target: 3 * MB,
    ceiling: 6 * MB,
  },
  {
    id: 'search-pair',
    label: 'search.json plus sets.bin, loaded after the first frame',
    target: 700 * KB,
    ceiling: 1.5 * MB,
  },
  {
    id: 'plane-shard',
    label: 'Largest single plane detail shard (amendment A1)',
    target: 1.5 * MB,
    ceiling: 2.5 * MB,
  },
]

function encodedSize(path) {
  return brotliCompressSync(readFileSync(path), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength
}

function human(bytes) {
  return bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${(bytes / KB).toFixed(1)} KB`
}

function parseArgs(argv) {
  const args = { dataset: process.env.ETERNITIES_DATASET ?? null, dist: 'dist' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = argv[++i]
    else if (argv[i] === '--dist') args.dist = argv[++i]
  }
  return args
}

function resolveDataDir(dataset) {
  const registry = JSON.parse(readFileSync(join(WEB_ROOT, 'datasets.json'), 'utf8'))
  const hash = dataset ? (registry.fixtures[dataset] ?? dataset) : registry.active
  return { hash, dir: join(WEB_ROOT, 'public', 'data', hash) }
}

/**
 * Every emitted file one entry of the build can reach, as relative `dist/` paths.
 *
 * Follows static `imports` *and* `dynamicImports`, plus each chunk's `css` and `assets`. Dynamic
 * imports are included deliberately: a `lazy()` chunk is not transferred before the first frame,
 * but it is code this entry chose to ship, and the walk this function replaces counted it. Keeping
 * it counted means the only thing that changes about the budget is the harness coming off it.
 *
 * Returns `null` if the manifest is missing — an older `dist/`, or a build run before
 * `build.manifest` was turned on.
 */
function entryFiles(distDir, entryKey) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(distDir, '.vite', 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
  if (!manifest[entryKey]) return null

  const files = new Set()
  const seen = new Set()
  const visit = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) return
    if (chunk.file) files.add(chunk.file)
    for (const asset of chunk.css ?? []) files.add(asset)
    for (const asset of chunk.assets ?? []) files.add(asset)
    for (const next of chunk.imports ?? []) visit(next)
    for (const next of chunk.dynamicImports ?? []) visit(next)
  }
  visit(entryKey)
  return files
}

/**
 * The built shell: index.html plus every JS, CSS and font asset it can pull in before the first
 * frame.
 *
 * Fonts count from Phase 5, when the site stopped using the system stack (PRD 7.6.1). A self-
 * hosted face is transferred before the first *readable* text, so leaving the row out would have
 * moved bytes off the budget simply by moving them into a `.woff2`.
 *
 * They are counted conservatively: both subsets are added, even though `unicode-range` means a
 * session that never renders a `latin-ext` glyph never fetches the second file. Over-counting
 * against a ceiling is safe; under-counting is not.
 *
 * **The harness does not count** (review §3.6 phase 3, item 4). `harness.html` is a second Vite
 * input holding the bench, the GPU self-check and the `?probe=1` scene; it builds into the same
 * `dist/`, so a walk of the directory would put its bytes on a budget whose label reads
 * "transferred before the first rendered frame" — which they are not, by construction, since
 * nothing the product entry imports can reach them.
 *
 * The exclusion is deliberately the narrowest one that is true: files reachable from `harness.html`
 * and *not* from `index.html`. Rollup shares modules across inputs, so the scene, three.js and
 * React are reachable from both and stay counted. Only what is harness-only comes off, and if the
 * manifest is missing the walk falls back to counting everything — over-counting against a ceiling
 * is safe.
 */
function shellSize(distDir) {
  try {
    statSync(distDir)
  } catch {
    return null
  }

  const product = entryFiles(distDir, 'index.html')
  const harness = entryFiles(distDir, 'harness.html')
  const harnessOnly = new Set()
  if (product && harness) {
    for (const file of harness) if (!product.has(file)) harnessOnly.add(file)
  }
  // The HTML is not a chunk, so it is not in either set. It is still harness-only.
  harnessOnly.add('harness.html')

  let total = 0
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === 'data') continue // data is budgeted separately
        if (entry.name === '.vite') continue // the manifest itself is not served
        walk(path, relative)
        continue
      }
      if (harnessOnly.has(relative)) continue
      if (/\.(js|css|html|woff2)$/.test(entry.name)) total += encodedSize(path)
    }
  }
  walk(distDir, '')
  return total
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const { hash, dir } = resolveDataDir(args.dataset)
  const distDir = resolve(WEB_ROOT, args.dist)

  const file = (name) => encodedSize(join(dir, name))
  const shell = shellSize(distDir)

  const shards = readdirSync(join(dir, 'planes'))
  let largestShard = 0
  let largestShardName = ''
  for (const name of shards) {
    const size = encodedSize(join(dir, 'planes', name))
    if (size > largestShard) {
      largestShard = size
      largestShardName = name
    }
  }

  const firstFrameData = file('manifest.json') + file('planes.json')
  const measured = {
    'first-frame': (shell ?? 0) + firstFrameData,
    intro: (shell ?? 0) + firstFrameData + file('stars.bin'),
    'search-pair': file('search.json') + file('sets.bin'),
    'plane-shard': largestShard,
  }

  console.log(`payload budget — dataset ${hash}, brotli quality 11 (encoded transferred size)`)
  if (shell === null) {
    console.log('  note: no dist/ build found, shell size counted as 0 — run `pnpm build` first')
  } else {
    console.log(`  built shell: ${human(shell)}`)
  }
  console.log(`  largest plane shard: ${largestShardName}`)
  console.log('')

  let failed = false
  let missedTarget = false
  const nearTarget = []
  for (const budget of BUDGETS) {
    const value = measured[budget.id]
    const overCeiling = value > budget.ceiling
    const overTarget = value > budget.target
    const near = !overTarget && value >= budget.target * NEAR_TARGET_FRACTION
    if (overCeiling) failed = true
    if (overTarget && !overCeiling) missedTarget = true
    if (near) nearTarget.push({ budget, value })
    const verdict = overCeiling ? 'FAIL' : overTarget ? 'over target' : near ? 'near target' : 'ok'
    console.log(
      `  [${verdict.padEnd(11)}] ${human(value).padStart(9)}  ` +
        `target ${human(budget.target).padStart(9)}  ceiling ${human(budget.ceiling).padStart(9)}  ` +
        `${((value / budget.target) * 100).toFixed(0).padStart(3)}% of target  ` +
        budget.label,
    )
  }

  console.log('')
  for (const { budget, value } of nearTarget) {
    console.warn(
      `warning: ${budget.id} is at ${((value / budget.target) * 100).toFixed(1)}% of its ` +
        `${human(budget.target)} target (${human(value)}) — ` +
        `${human(budget.target - value)} of headroom left`,
    )
  }
  if (failed) {
    console.error('a PRD 7.2 ceiling was exceeded — this is a commitment, not an aspiration')
    process.exit(1)
  }
  if (missedTarget) {
    console.log('every ceiling holds; one or more targets were missed (reported, not enforced)')
  } else if (nearTarget.length > 0) {
    console.log(
      `every target and ceiling holds; ${nearTarget.length} within ` +
        `${((1 - NEAR_TARGET_FRACTION) * 100).toFixed(0)}% of a target (warned, not enforced)`,
    )
  } else {
    console.log('every target and ceiling holds')
  }
}

main()
