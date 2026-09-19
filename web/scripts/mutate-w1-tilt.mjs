#!/usr/bin/env node
/**
 * Negative controls for W1's single-draw guard (`test/worlds-w1-single-draw.test.ts`, DEC-752).
 *
 * The guard's whole claim is that it reds the day `APPLY_PLANE_TILT` flips, **on a measurement
 * rather than on a pin of the boolean**. That is a claim about which assertion carries the weight,
 * and a pass/fail count cannot answer it — so this harness records the *names* of the rows each
 * mutant reds, not just how many. Mutant 1 is the one the ruling owed: if it kills only
 * `names the flag ...`, the guard is a boolean pin wearing a measurement's clothes.
 *
 * Mutants 5-7 are aimed at this leg's own test file. That is deliberate: a control that cannot fail
 * is rubble, and the only way to tell the tilted arm apart from a second copy of the shipped one is
 * to make them identical and watch the row that should notice.
 *
 * The restored tree is re-run at both ends — a mutation harness that leaves the tree dirty reports
 * the next leg's failures as its own. Restoration is from an in-memory snapshot and never from
 * `git checkout`, which would delete the leg's own uncommitted work.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SPIN = resolve(web, 'src/scene/worlds/spin.ts')
const LAW = resolve(web, 'src/scene/worlds/surfaceLaw.ts')
const GUARD = resolve(web, 'test/worlds-w1-single-draw.test.ts')

const MUTANTS = [
  {
    name: 'THE RULING: APPLY_PLANE_TILT is turned on',
    file: SPIN,
    from: 'export const APPLY_PLANE_TILT = false',
    to: 'export const APPLY_PLANE_TILT = true',
  },
  {
    name: 'planeOrientation applies the tilt regardless of the flag — the same defect, other site',
    file: SPIN,
    from: 'return worldOrientation(APPLY_PLANE_TILT ? plane.tilt : NO_TILT, spinAngleOf(plane.index), out)',
    to: 'return worldOrientation(plane.tilt, spinAngleOf(plane.index), out)',
  },
  {
    name: 'the framing law returns the silhouette cap always — DEC-818 reverted',
    file: LAW,
    from: '  return Math.min(SILHOUETTE_FRAMING_RADII, CELL_LIFT + (cellArc * focalPx) / CELL_FRAMING_PX)',
    to: '  return SILHOUETTE_FRAMING_RADII',
  },
  {
    name: 'the framing constant is retuned 30 -> 24 — the distances move and the margins with them',
    file: LAW,
    from: 'export const CELL_FRAMING_PX = 30',
    to: 'export const CELL_FRAMING_PX = 24',
  },
  {
    name: 'the pose falls back to HOME_POLAR everywhere — the arrival reading is discarded',
    file: GUARD,
    from: "  slug in ARRIVAL_POLAR_DEG ? (ARRIVAL_POLAR_DEG[slug]! * Math.PI) / 180 : HOME_POLAR",
    to: '  HOME_POLAR',
  },
  {
    name: 'the tilted control is a second copy of the shipped arm — the control goes vacuous',
    file: GUARD,
    from: '    worldOrientation(p.tilt, 0, s.orientation)',
    to: '    planeOrientation(p, NO_SPIN, s.orientation)',
  },
  {
    name: 'the width bound is relaxed past the tilted arm — the guard admits an 11% family',
    file: GUARD,
    from: 'const SINGLE_DRAW_WIDTH_PCT = 1',
    to: 'const SINGLE_DRAW_WIDTH_PCT = 20',
  },
]

function run() {
  try {
    const out = execFileSync(
      'npx',
      ['vitest', 'run', 'test/worlds-w1-single-draw.test.ts', '--coverage.enabled=false', '--testTimeout=300000'],
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
