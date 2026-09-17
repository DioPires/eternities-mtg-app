#!/usr/bin/env node
/**
 * W3's floor, derived from the two full-tour arms rather than asserted.
 *
 * §3.1 folds W3 to the **mean** over the roster's in-domain worlds (board ruling `fold_mean`, card
 * `7d3653f6`, 2026-09-17), so the floor has to sit between two roster means: above every reading the
 * `?art=off&bands=shuffle` control produced and at or below every reading the `?art=off` build
 * produced. The arms are compared *across sessions*, never one tour against one tour — the whole
 * reason the previous floor (0.55, on the retired worst-world fold) had to be retracted is that it
 * was derived from a single pair and the shipped arm's own spread swallowed it.
 *
 * Usage — one or more run directories, each holding both derivation rows:
 *
 *   node scripts/worlds-gate.mjs --only w3-floor-shipped,w3-floor-control --no-captures \
 *     --out worlds-gate/w3floor-1
 *   ... repeat, at least five times per arm ...
 *   node scripts/w3-floor.mjs worlds-gate/w3floor-1 worlds-gate/w3floor-2 ...
 *
 * Prints each arm's per-session means, each arm's spread, the per-world table of the last pass, and
 * whether a separating floor exists. It proposes an interval and never writes one: a floor that
 * cannot be derived is a finding, not a number to pick.
 *
 * ## Two rules this script exists to enforce, both learned the expensive way
 *
 * 1. **Read the shipped arm's MINIMUM against the control's MAXIMUM.** A floor set from one session
 *    per arm looks clear of a control it is really touching. At n=1 under the old fold the interval
 *    was (0.4195, 0.7070]; at n=5 the shipped arm reached 0.4253, *below* the control's worst.
 * 2. **Both arms must be folded over the SAME worlds.** A world in domain under one arm and not the
 *    other would make the two means denominators of different populations, and the arm missing its
 *    low world would score higher for a reason that has nothing to do with the build.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const KEY = 'minAdjacentBandDeltaE'
const ARMS = [
  { id: 'w3-floor-shipped', label: '?art=off' },
  { id: 'w3-floor-control', label: '+shuffle' },
]

const dirs = process.argv.slice(2)
if (dirs.length === 0) dirs.push('worlds-gate/dec826-w3floor')

/** Per-world W3 readings for one arm of one run. `insufficient` carries as absent, never as 0. */
function readingsOf(dir, id) {
  const path = join(resolve(dir), id, 'visits.json')
  if (!existsSync(path)) throw new Error(`${dir}: no ${id}/visits.json — was that arm run?`)
  const { visits } = JSON.parse(readFileSync(path, 'utf8'))
  const out = new Map()
  const failed = []
  for (const visit of visits) {
    if (!visit.ok) {
      failed.push(visit.slug)
      continue
    }
    const measure = visit.w3?.measures?.find((m) => m.key === KEY)
    if (measure === undefined || measure.status === 'insufficient' || measure.value == null) continue
    out.set(visit.slug, measure.value)
  }
  return { dir, id, readings: out, failed }
}

const passes = dirs.map((dir) => ({
  dir,
  arms: ARMS.map((arm) => readingsOf(dir, arm.id)),
}))

// The paired domain: the worlds in W3's domain in EVERY arm of EVERY pass. Anything else is a
// denominator that moves between the numbers being compared.
const every = passes.flatMap((p) => p.arms)
const domain = [...every[0].readings.keys()]
  .filter((slug) => every.every((a) => a.readings.has(slug)))
  .sort()
const anywhere = new Set(every.flatMap((a) => [...a.readings.keys()]))
if (domain.length === 0) {
  console.error('no world is in W3\'s domain in every arm of every pass — nothing is comparable')
  process.exit(1)
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const foldOf = (arm) => mean(domain.map((slug) => arm.readings.get(slug)))

console.log(`W3 floor derivation — ${passes.length} pass${passes.length === 1 ? '' : 'es'} per arm`)
console.log(`fold: MEAN over the paired domain (board ruling \`fold_mean\`)\n`)
console.log(`worlds in W3's domain in every arm of every pass: ${domain.length}`)
console.log(`worlds dropped (in some arms only): ${anywhere.size - domain.length}`)
if (anywhere.size !== domain.length) {
  console.log(`  ${[...anywhere].filter((s) => !domain.includes(s)).sort().join(', ')}`)
}
const anyFailed = every.filter((a) => a.failed.length > 0)
for (const arm of anyFailed) {
  console.log(`  ${arm.dir} ${arm.id}: ${arm.failed.length} world(s) failed setup — ${arm.failed.join(', ')}`)
}

// ---- the arms, session by session ---------------------------------------------------------------
const width = Math.max(12, ...dirs.map((d) => d.split('/').pop().length)) + 2
console.log('\n' + 'arm'.padEnd(12) + dirs.map((d) => d.split('/').pop().padStart(width)).join('') +
  'min'.padStart(10) + 'max'.padStart(10) + 'spread'.padStart(9))
console.log('-'.repeat(12 + width * dirs.length + 29))
const folds = {}
for (const [i, arm] of ARMS.entries()) {
  const values = passes.map((p) => foldOf(p.arms[i]))
  folds[arm.id] = values
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  console.log(
    arm.label.padEnd(12) +
      values.map((v) => v.toFixed(4).padStart(width)).join('') +
      lo.toFixed(4).padStart(10) +
      hi.toFixed(4).padStart(10) +
      `${(hi / lo).toFixed(2)}x`.padStart(9),
  )
}

// ---- the per-world table, from the last pass -----------------------------------------------------
const last = passes[passes.length - 1]
console.log(`\nper-world readings, ${last.dir} (lowest first) — the mean's own terms`)
console.log('world'.padEnd(20) + '?art=off'.padStart(12) + '+shuffle'.padStart(12) + '   separates')
console.log('-'.repeat(58))
for (const slug of [...domain].sort(
  (a, b) => last.arms[0].readings.get(a) - last.arms[0].readings.get(b),
)) {
  const s = last.arms[0].readings.get(slug)
  const c = last.arms[1].readings.get(slug)
  console.log(
    slug.padEnd(20) + s.toFixed(4).padStart(12) + c.toFixed(4).padStart(12) +
      '   ' + (c < s ? `yes  (${(s - c).toFixed(4)})` : '**NO**'),
  )
}
// Per-world inversions are expected and are NOT a defect of the control: `?bands=shuffle` is one
// permutation, and on a world whose bands already sit close together a permutation can land further
// apart. The claim the floor rests on is about the two *means*, which is why this count is reported
// rather than required to be zero.
const inversions = domain.filter((s) => last.arms[1].readings.get(s) >= last.arms[0].readings.get(s))
console.log(`\nworlds where the shuffle scored at or above the build: ${inversions.length}/${domain.length}`)
if (inversions.length > 0) console.log(`  ${inversions.join(', ')}`)

// ---- the interval --------------------------------------------------------------------------------
const shippedMin = Math.min(...folds['w3-floor-shipped'])
const controlMax = Math.max(...folds['w3-floor-control'])
console.log('\n' + '='.repeat(72))
console.log(`shipped arm MINIMUM over ${passes.length} pass(es): ${shippedMin.toFixed(4)}`)
console.log(`control arm MAXIMUM over ${passes.length} pass(es): ${controlMax.toFixed(4)}`)
if (controlMax < shippedMin) {
  const width2 = shippedMin - controlMax
  console.log(`\nA separating floor EXISTS in (${controlMax.toFixed(4)}, ${shippedMin.toFixed(4)}]`)
  console.log(
    `  width ${width2.toFixed(4)}, midpoint ${((shippedMin + controlMax) / 2).toFixed(4)}` +
      `, ${((width2 / controlMax) * 100).toFixed(1)}% of the control's worst`,
  )
  if (passes.length < 5) {
    console.log('\n  FEWER THAN FIVE PASSES PER ARM. The retracted 0.55 was defensible on one pass and')
    console.log('  false on five. Do not write this interval into `FLOORS` yet — run more passes and')
    console.log('  check the fold still converges with `node scripts/w3-fold.mjs`.')
  }
} else {
  console.log('\nNO separating floor exists on these arms — the control mean reaches at or above the')
  console.log('shipped one, so every floor that greens the build also greens its own falsifier.')
  process.exitCode = 1
}
