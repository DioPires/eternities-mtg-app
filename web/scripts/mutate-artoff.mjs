#!/usr/bin/env node
/**
 * Negative controls for `?art=off`'s policy witness (DEC-821 seam, leg G wiring).
 *
 * The witness is a conjunction — `stream.requested === 0`, `cellsWantingArt > 0`, `pool.layers`
 * unmoved — and a conjunction hides which half its control tests. Each mutant below removes exactly
 * one clause or one guard and the run records how many tests notice. A clause no row reds on is a
 * clause nothing is holding.
 *
 * The restored tree is re-run at the end: a mutation harness that leaves the tree dirty reports the
 * next leg's failures as its own.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const READ = resolve(web, 'scripts/lib/worlds-probe-read.mjs')
const METRICS = resolve(web, 'scripts/lib/worlds-metrics.mjs')

const MUTANTS = [
  {
    name: 'the witness ignores `requested` entirely — every art=off row reads engaged',
    file: READ,
    from: '    policyMoved: probe.stream.requested === 0 && (layersHeld === null || layersHeld),',
    to: '    policyMoved: layersHeld === null || layersHeld,',
  },
  {
    name: 'the `pool.layers` clause is dropped — ?layers=0 passes as ?art=off',
    file: READ,
    from: '    policyMoved: probe.stream.requested === 0 && (layersHeld === null || layersHeld),',
    to: '    policyMoved: probe.stream.requested === 0,',
  },
  {
    name: 'the `wanting > 0` precondition is dropped — the empty world claims a witness',
    file: READ,
    from: '  if (probe.stream === null || wanting === 0) {',
    to: '  if (probe.stream === null) {',
  },
  {
    name: 'a null stream is read as an all-zero report — no stream scores as the seam engaging',
    file: READ,
    from: '  if (probe.stream === null || wanting === 0) {',
    to: '  if (wanting === 0) {',
  },
  {
    name: 'the degenerate frames score `false` instead of "no witness" — a correct run reads broken',
    file: READ,
    from: "      witness: 'echo',\n      policyMoved: null,\n      detail: `${detail} — no policy witness on this frame`,",
    to: "      witness: 'policy',\n      policyMoved: false,\n      detail: `${detail} — no policy witness on this frame`,",
  },
  {
    name: 'the unset direction claims a witness — the shipped build reads as a failed control',
    file: READ,
    from: '  const want = requested.artOff === true\n  const echoed = probe.seams.artOff === want\n  if (!want) {',
    to: '  const want = requested.artOff === true\n  const echoed = probe.seams.artOff === want\n  if (false) {',
  },
  {
    name: 'the reader stops validating `seams.artOff` — a dropped field reads as a failed echo',
    file: READ,
    from: "  c.boolean(seams.artOff, 'probe.seams.artOff')",
    to: '',
  },
  {
    name: 'the witness counts cells W4 does not — off-screen and back-facing cells testify',
    file: METRICS,
    from: '  return cells.filter((c) => c.frontFacing && c.onScreen && c.wantsArt);',
    to: '  return cells.filter((c) => c.wantsArt);',
  },
  {
    name: 'the gate stops spelling the seam — every art=off row runs the unmodified build',
    file: READ,
    from: "  if (seams.artOff) parts.push('art=off')",
    to: '',
  },
  {
    name: 'the gate misspells the seam — `?art=none`, which the renderer reads as absent',
    file: READ,
    from: "  if (seams.artOff) parts.push('art=off')",
    to: "  if (seams.artOff) parts.push('art=none')",
  },
  {
    name: 'layers=0 is dropped by a truthiness test — the row runs the shipped 1,024',
    file: READ,
    from: "  if (typeof seams.layersRequested === 'number') parts.push(`layers=${seams.layersRequested}`)",
    to: '  if (seams.layersRequested) parts.push(`layers=${seams.layersRequested}`)',
  },
]

function run() {
  try {
    const out = execFileSync(
      'npx',
      ['vitest', 'run', 'test/worlds-probe-read.test.ts', 'test/worlds-metrics.test.ts', 'test/worlds-seam-query.test.ts', '--coverage.enabled=false'],
      { cwd: web, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return { failed: 0, out }
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const match = out.match(/Tests\s+(\d+) failed/)
    // An unparseable run is a harness failure, not a surviving mutant. Never report it as zero.
    return { failed: match ? Number(match[1]) : NaN, out }
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
  const { failed } = run()
  const killed = Number.isFinite(failed) && failed > 0
  if (!killed) survivors += 1
  console.log(`${killed ? 'KILLED' : 'SURVIVED'} (${failed} red): ${mutant.name}`)
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
