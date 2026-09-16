#!/usr/bin/env node
/**
 * Negative controls for the folded verdict's denominator (`checkControlRow`, `foldCriteria`).
 *
 * DEC-816's R3 gave W2's lightness half a 20-cell ring domain, which on the shipped roster leaves it
 * scored on **2 of 45 worlds**. The gate went on printing `W2.lightnessIqr went GREEN as expected
 * (value 20.2, bound 8)` — a line identical to the one a forty-five-world GREEN produces. The
 * report was at its most reassuring exactly where the evidence had thinned.
 *
 * Two of these mutants aim at the *printer* and two at the *fold*, because the pair only works if
 * both halves agree on a field name. Mutant 3 is the one that matters: before `foldCriteria` moved
 * into this library the only way to test the printer was to rebuild the fold's output by hand, and
 * that double would have gone on passing the day the fold stopped emitting `scoredPlanes` — the
 * printer falls back to silence, which is precisely the regression. It is testable now because the
 * fold is here rather than in the browser-driving script.
 *
 * Mutant 2 is the vacuity control. A denominator printed only when the evidence is thin is a
 * *warning*, and a reader learns to read its absence as "fine" — so the full-roster row has to red
 * too, or the pair has quietly become one-sided.
 *
 * The restored tree is re-run at both ends, and restoration is from an in-memory snapshot rather
 * than `git checkout`, which would delete the leg's own uncommitted work.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const METRICS = resolve(web, 'scripts/lib/worlds-metrics.mjs')
const TEST = resolve(web, 'test/worlds-metrics.test.ts')

const MUTANTS = [
  {
    name: 'THE REGRESSION: the printer drops the denominator, as it read before DEC-816',
    file: METRICS,
    from: '      ? `${what} went ${expect} as expected${value}${domain}`\n' +
      '      : `${what} was expected ${expect} but went ${went}${value}${domain}`,',
    to: '      ? `${what} went ${expect} as expected${value}`\n' +
      '      : `${what} was expected ${expect} but went ${went}${value}`,',
  },
  {
    name: 'the denominator is printed only when the evidence is thin — a warning, not a denominator',
    file: METRICS,
    from: '    went !== "N/A" && typeof subject.scoredPlanes === "number"',
    to: '    went !== "N/A" && subject.insufficientPlanes > 0',
  },
  {
    name: 'THE ONE THE HAND-BUILT DOUBLE COULD NOT SEE: the fold stops publishing scoredPlanes',
    file: METRICS,
    from: '      insufficientPlanes: all.length - real.length,\n      scoredPlanes: real.length,',
    to: '      insufficientPlanes: all.length - real.length,',
  },
  {
    name: 'the fold counts every world it was handed, not the ones in domain',
    file: METRICS,
    from: '      insufficientPlanes: all.length - real.length,\n      scoredPlanes: real.length,',
    to: '      insufficientPlanes: all.length - real.length,\n      scoredPlanes: all.length,',
  },
  {
    // Not a reversed reduce: reversing the input and keeping the comparison picks the same element,
    // so that mutant is a no-op wearing a defect's name. Inverting the comparison is the defect.
    name: 'the fold takes the BEST world under a min bound — §3.1 forbids anything but the worst',
    file: METRICS,
    from: '      template.direction === "min"\n        ? b.measure.value < a.measure.value',
    to: '      template.direction === "min"\n        ? b.measure.value > a.measure.value',
  },
  {
    name: "the roster's thin worlds clear the domain, so the fixture stops exercising it",
    file: TEST,
    from: '        criterion: evaluateW2(ringOf(RING - 1, WIDE)),',
    to: '        criterion: evaluateW2(ringOf(RING, WIDE)),',
  },
  {
    name: 'the roster is a set of clones, so "worst" stops being distinguishable from "any"',
    file: TEST,
    from: '        criterion: evaluateW2(ringOf(RING, i === scored - 1 ? NARROW : WIDE)),',
    to: '        criterion: evaluateW2(ringOf(RING, WIDE)),',
  },
]

function run() {
  try {
    const out = execFileSync(
      'npx',
      ['vitest', 'run', 'test/worlds-metrics.test.ts', '--coverage.enabled=false'],
      { cwd: web, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return { failed: 0, rows: [], out }
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const match = out.match(/Tests\s+(\d+) failed/)
    // The row names, so "which assertion carries the weight" is a reading and not an inference.
    const rows = [...out.matchAll(/^\s+×\s+(.+?)\s+\d+ms$/gm)].map((m) => m[1].trim())
    // An unparseable run is a harness failure, not a surviving mutant. Never report it as zero.
    return { failed: match ? Number(match[1]) : NaN, rows, out }
  }
}

const originals = new Map()
for (const file of new Set(MUTANTS.map((m) => m.file))) originals.set(file, readFileSync(file, 'utf8'))
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text)
}

process.on('exit', restore)

const before = run()
console.log(`restored tree, before: ${before.failed} failed`)
if (before.failed !== 0) {
  console.error('the tree is already red — every mutant below would be unreadable. Stopping.')
  process.exit(1)
}

let survivors = 0
for (const mutant of MUTANTS) {
  restore()
  const text = originals.get(mutant.file)
  if (!text.includes(mutant.from)) {
    console.error(`SKIPPED (site not found): ${mutant.name}`)
    survivors += 1
    continue
  }
  writeFileSync(mutant.file, text.replace(mutant.from, mutant.to))
  const { failed, rows } = run()
  const killed = Number.isFinite(failed) && failed > 0
  if (!killed) survivors += 1
  console.log(`${killed ? 'KILLED' : 'SURVIVED'} (${failed} red): ${mutant.name}`)
  for (const row of rows) console.log(`      red: ${row}`)
}

restore()
const after = run()
console.log(`restored tree, after: ${after.failed} failed`)
if (after.failed !== 0) {
  console.error('the tree did not restore cleanly')
  process.exit(1)
}
console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} killed`)
process.exit(survivors === 0 ? 0 : 1)
