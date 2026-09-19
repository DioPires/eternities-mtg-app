#!/usr/bin/env node
/**
 * W3's **fold**, re-scored across sessions — the companion to `w3-floor.mjs`.
 *
 * `w3-floor.mjs` asks where a floor may sit given two arms. This asks the question underneath it:
 * does the arm reproduce at all? Re-folding the *same* per-world readings five ways is what
 * separates "the renderer moved" from "the fold sampled a different world".
 *
 * **§3.1's fold is now the mean (board ruling `fold_mean`, card `7d3653f6`), and this script is how
 * that was decided — so it keeps every fold, including the retired one.** The shipped fold was the
 * worst world, which made the tour value a minimum over the in-domain worlds of a per-world minimum
 * over band pairs: a min of minima, the least stable statistic available over a population that
 * moves. Over five identical sessions it spanned 1.88× and scored three different worlds; the mean
 * spanned 1.09×. Run this at the n a floor is derived from — at n=3 the p10 looked like the best
 * quantile on offer and at n=5 it was the worst fold in the table, worse than the min it would have
 * replaced. A ranking taken at one n is not a ranking.
 *
 * Usage — two or more gate run directories, each holding `<row>/visits.json`:
 *
 *   node scripts/w3-fold.mjs worlds-gate/accept3 worlds-gate/dec826-bare worlds-gate/accept4
 *   node scripts/w3-fold.mjs --row w3-floor-shipped worlds-gate/a worlds-gate/b
 *
 * Every fold is computed over the worlds **in W3's domain in every run given**, never over each
 * run's own domain: a world measurable in one session and not another would let two aggregates be
 * minima over different populations, and the run with fewer worlds would score higher for a reason
 * that has nothing to do with the build. The script prints how many worlds it dropped for that
 * reason, because a silently narrowed domain reads as agreement.
 *
 * It proposes nothing. Which fold §3.1 uses was the owner's call and is settled; this reports how
 * each one behaves on the sessions handed to it, which is what a later refresh has to re-check.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const KEY = 'minAdjacentBandDeltaE'

const argv = process.argv.slice(2)
let row = null
const dirs = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--row') row = argv[(i += 1)]
  else dirs.push(argv[i])
}
if (dirs.length < 2) {
  console.error('usage: node scripts/w3-fold.mjs [--row <id>] <run-dir> <run-dir> [...]')
  console.error('       a fold cannot be shown to converge from one session')
  process.exit(2)
}

/**
 * Resolve the row inside a run directory. `--row` names it; otherwise the single row present is
 * taken and an ambiguous directory is an error rather than a guess — folding one run's `baseline`
 * against another's `art-off` would compare two different builds and print a spread for it.
 */
function visitsOf(dir) {
  const base = resolve(dir)
  if (row !== null) return JSON.parse(readFileSync(join(base, row, 'visits.json'), 'utf8')).visits
  const rows = readdirSync(base).filter((d) => existsSync(join(base, d, 'visits.json')))
  if (rows.length !== 1) {
    throw new Error(`${dir}: ${rows.length} rows (${rows.join(', ') || 'none'}) — pass --row`)
  }
  return JSON.parse(readFileSync(join(base, rows[0], 'visits.json'), 'utf8')).visits
}

/** Per-world W3 readings for one run. `insufficient` carries as absent, never as a value. */
function readingsOf(dir) {
  const out = new Map()
  for (const visit of visitsOf(dir)) {
    if (!visit.ok) continue
    const measure = visit.w3?.measures?.find((m) => m.key === KEY)
    if (measure === undefined || measure.status === 'insufficient' || measure.value == null) continue
    out.set(visit.slug, measure.value)
  }
  return out
}

const runs = dirs.map((dir) => ({ dir, readings: readingsOf(dir) }))

const everywhere = [...runs[0].readings.keys()]
  .filter((slug) => runs.every((r) => r.readings.has(slug)))
  .sort()
const anywhere = new Set(runs.flatMap((r) => [...r.readings.keys()]))
if (everywhere.length === 0) {
  console.error('no world is in W3\'s domain in every run given — nothing is comparable')
  process.exit(1)
}

const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length

const FOLDS = [
  { name: 'min (retired)', of: (v) => quantile(v, 0) },
  { name: 'p10', of: (v) => quantile(v, 0.1) },
  { name: 'p25', of: (v) => quantile(v, 0.25) },
  { name: 'median', of: (v) => quantile(v, 0.5) },
  { name: 'mean (§3.1)', of: (v) => mean(v) },
]

console.log(`W3 fold stability — ${runs.length} sessions, key ${KEY}\n`)
console.log(`worlds in W3's domain in every run: ${everywhere.length}`)
console.log(`worlds dropped (in some runs only): ${anywhere.size - everywhere.length}`)
if (anywhere.size !== everywhere.length) {
  console.log(`  ${[...anywhere].filter((s) => !everywhere.includes(s)).sort().join(', ')}`)
}

const width = Math.max(14, ...dirs.map((d) => d.length)) + 2
console.log('\n' + 'fold'.padEnd(16) + dirs.map((d) => d.padStart(width)).join('') + 'spread'.padStart(10))
console.log('-'.repeat(16 + width * dirs.length + 10))
for (const fold of FOLDS) {
  const values = runs.map((r) => fold.of(everywhere.map((s) => r.readings.get(s))))
  const spread = Math.max(...values) / Math.min(...values)
  console.log(
    fold.name.padEnd(16) +
      values.map((v) => v.toFixed(4).padStart(width)).join('') +
      `${spread.toFixed(2)}x`.padStart(10),
  )
}

// Which worlds carry the movement. A fold that swings while most worlds hold still is sampling the
// low tail, and naming the tail is what tells the next reader whether a refresh moved the build or
// moved one plane's swatches.
const volatility = everywhere
  .map((slug) => {
    const values = runs.map((r) => r.readings.get(slug))
    return { slug, values, ratio: Math.max(...values) / Math.min(...values) }
  })
  .sort((a, b) => b.ratio - a.ratio)

console.log('\nper-world spread across the sessions, worst first')
console.log('-'.repeat(16 + width * dirs.length + 10))
for (const v of volatility) {
  console.log(
    v.slug.padEnd(16) +
      v.values.map((x) => x.toFixed(4).padStart(width)).join('') +
      `${v.ratio.toFixed(2)}x`.padStart(10),
  )
}

const shippedFold = runs.map((r) => Math.min(...everywhere.map((s) => r.readings.get(s))))
const worstOf = (r) =>
  everywhere.reduce((a, b) => (r.readings.get(b) < r.readings.get(a) ? b : a))
console.log('\nthe world the RETIRED min fold scored, per session — its subject, and why it went:')
for (const [i, r] of runs.entries()) {
  console.log(`  ${r.dir.padEnd(width)} ${shippedFold[i].toFixed(4)}  ${worstOf(r)}`)
}
const identities = new Set(runs.map(worstOf))
console.log(
  identities.size === 1
    ? `\nthe same world scored every session (${[...identities][0]}).`
    : `\n${identities.size} different worlds scored across ${runs.length} sessions — the fold is not` +
        ' measuring a fixed subject.',
)
