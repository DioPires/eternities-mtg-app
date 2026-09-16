#!/usr/bin/env node
/**
 * W3's floor, derived from the two full-tour arms rather than asserted.
 *
 * §3.1 folds W3 to the **worst world**, so the floor has to sit between two worst-cases and not
 * between two dominaria readings: above the control tour's minimum and at or below the shipped
 * tour's. `FLOORS.bandDeltaE` has been held at 10 since DEC-816 precisely because on the *bare*
 * build no such gap exists — the shipped aggregate (0.4253, ravnica) scores below its own shuffled
 * falsifier (0.4757), so every floor that greens the build also greens the control.
 *
 * Usage:
 *   node scripts/w3-floor.mjs worlds-gate/dec826-w3floor
 *
 * Prints the per-world table for both arms, the two aggregates, and whether a separating floor
 * exists. It proposes nothing when the arms overlap: a floor that cannot be derived is a finding,
 * not a number to pick.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const KEY = 'minAdjacentBandDeltaE'

function arm(dir, id) {
  const { visits } = JSON.parse(readFileSync(resolve(dir, id, 'visits.json'), 'utf8'))
  const rows = []
  for (const visit of visits) {
    if (!visit.ok) {
      rows.push({ slug: visit.slug, value: null, why: visit.detail })
      continue
    }
    const measure = visit.w3?.measures?.find((m) => m.key === KEY)
    rows.push({
      slug: visit.slug,
      // `insufficient` is carried, never counted as a pass — a world out of W3's domain has no
      // reading, and a derivation that silently dropped it would set the floor off a subset.
      value: measure === undefined || measure.status === 'insufficient' ? null : measure.value,
      why: measure?.insufficientReason ?? null,
    })
  }
  return rows
}

const dir = resolve(process.argv[2] ?? 'worlds-gate/dec826-w3floor')
const shipped = arm(dir, 'w3-floor-shipped')
const control = arm(dir, 'w3-floor-control')

const byShipped = new Map(shipped.map((r) => [r.slug, r]))
const slugs = [...new Set([...shipped, ...control].map((r) => r.slug))].sort()

console.log(`W3 floor derivation — ${dir}\n`)
console.log('world'.padEnd(24) + '?art=off'.padStart(12) + '+shuffle'.padStart(12) + '   separates')
console.log('-'.repeat(62))
for (const slug of slugs) {
  const s = byShipped.get(slug)?.value ?? null
  const c = control.find((r) => r.slug === slug)?.value ?? null
  const sep = s !== null && c !== null ? (c < s ? `yes  (${(s - c).toFixed(4)})` : '**NO**') : '—'
  console.log(
    slug.padEnd(24) +
      (s === null ? 'n/a' : s.toFixed(4)).padStart(12) +
      (c === null ? 'n/a' : c.toFixed(4)).padStart(12) +
      '   ' +
      sep,
  )
}

const real = (rows) => rows.filter((r) => r.value !== null)
const worst = (rows) => real(rows).reduce((a, b) => (b.value < a.value ? b : a))

const ws = worst(shipped)
const wc = worst(control)
console.log('\n' + '='.repeat(62))
console.log(`measured worlds:   ?art=off ${real(shipped).length}/${shipped.length}`.padEnd(40) + `+shuffle ${real(control).length}/${control.length}`)
console.log(`AGGREGATE (worst): ?art=off ${ws.value.toFixed(4)} (${ws.slug})`)
console.log(`                   +shuffle ${wc.value.toFixed(4)} (${wc.slug})`)

// The two arms must be compared on the SAME set of worlds. A world measurable under one arm and not
// the other would let the two aggregates be minima over different populations — the shipped side
// could look higher only because the world that drags it down had no control reading.
const both = slugs.filter(
  (s) => byShipped.get(s)?.value != null && control.find((r) => r.slug === s)?.value != null,
)
const pairedShipped = Math.min(...both.map((s) => byShipped.get(s).value))
const pairedControl = Math.min(...both.map((s) => control.find((r) => r.slug === s).value))
console.log(`\npaired on the ${both.length} worlds measurable in BOTH arms:`)
console.log(`  ?art=off ${pairedShipped.toFixed(4)}   +shuffle ${pairedControl.toFixed(4)}`)

const inversions = both.filter((s) => control.find((r) => r.slug === s).value >= byShipped.get(s).value)
console.log(`\nworlds where the control does NOT separate: ${inversions.length}/${both.length}`)
if (inversions.length > 0) console.log(`  ${inversions.join(', ')}`)

console.log('\n' + '='.repeat(62))
if (pairedControl < pairedShipped) {
  console.log(`A separating floor EXISTS in (${pairedControl.toFixed(4)}, ${pairedShipped.toFixed(4)}]`)
  console.log(`  width ${(pairedShipped - pairedControl).toFixed(4)}, midpoint ${((pairedShipped + pairedControl) / 2).toFixed(4)}`)
} else {
  console.log('NO separating floor exists on these arms — the control aggregate is at or above the')
  console.log('shipped one, so every floor that greens the build also greens its own falsifier.')
}
