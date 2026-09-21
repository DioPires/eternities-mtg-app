#!/usr/bin/env node
/**
 * Negative controls for DEC-861: the one-card sweep's four selection rules, W4's own worst phase,
 * the pixel witness, and the two roster-fold fixes.
 *
 * The sweep's rules lived in `worlds-gate.mjs` until DEC-861, where no test could reach them — the
 * gate runs `main()` on import. They are in `lib/worlds-metrics.mjs` now, and each has one unit row
 * in `test/worlds-metrics.test.ts` and one mutant here. A rule whose mutant survives is a rule the
 * suite only describes.
 *
 * Rule 4's two mutants (first, best) are the ones the live row cannot kill: on segovia the worst
 * and best counted phases are 0.23 px apart, so a sweep that picked either reads the same colour
 * on the rig. The unit fixture straddles the 24 px floor instead.
 *
 * The restored tree is re-run at both ends, and restoration is from an in-memory snapshot rather
 * than `git checkout`, which would delete the leg's own uncommitted work.
 *
 * **Never run this beside `worlds-gate.mjs` on the same tree.** Mutants are written into the real
 * library files for as long as each vitest run takes, and a gate process that starts in that window
 * imports the mutant and scores with it, silently. The snapshot is restored on exit and on
 * SIGINT/SIGTERM/SIGHUP; a SIGKILL cannot be caught, so check `git diff` after one.
 *
 *   node scripts/mutate-spin-sweep.mjs
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const METRICS = resolve(web, 'scripts/lib/worlds-metrics.mjs')
const PROBE_READ = resolve(web, 'scripts/lib/worlds-probe-read.mjs')

const MUTANTS = [
  {
    name: 'rule 4a: W1 scores the FIRST counted phase',
    file: METRICS,
    from: '  const w1Phase = lowest(counted, "medianHeightPx");',
    to: '  const w1Phase = counted[0];',
  },
  {
    name: 'rule 4b: W1 scores the BEST counted phase',
    file: METRICS,
    from: '  const w1Phase = lowest(counted, "medianHeightPx");',
    to: '  const w1Phase = counted.reduce((a, b) => (phases[b].medianHeightPx > phases[a].medianHeightPx ? b : a));',
  },
  {
    name: 'rule 3: a phase counts without its predecessor presenting (the leading edge is scored)',
    file: METRICS,
    from: '  const counted = presenting.filter((i) => i > 0 && phases[i - 1].presented > 0);',
    to: '  const counted = presenting;',
  },
  {
    name: 'rule 2: zero presenting phases is not named — it falls through to the harness reason',
    file: METRICS,
    from: '  if (presenting.length === 0) {',
    to: '  if (false) {',
  },
  {
    name: 'rule 1: no travel check — a frozen sweep is believed',
    file: METRICS,
    from: '  if (travelPx < minTravelPx) {',
    to: '  if (false) {',
  },
  {
    name: 'item 3: W4 is read on W1\'s phase again',
    file: METRICS,
    from: '  const w4Phase = withArt.length === 0 ? w1Phase : lowest(withArt, "artFraction");',
    to: '  const w4Phase = w1Phase;',
  },
  {
    name: 'item 4: the witness counts the leading edge, like rule 3 in reverse',
    file: METRICS,
    from: '  const drawPhase = witnessed && !unreadable ? lowest(counted, "contrastDeltaE") : null;',
    to: '  const drawPhase = witnessed && !unreadable ? lowest(presenting, "contrastDeltaE") : null;',
  },
  {
    name: 'item 4: an unreadable counted phase is stepped over instead of failing the witness',
    file: METRICS,
    from:
      '  const unreadable =\n    witnessed && counted.some((i) => typeof phases[i].contrastDeltaE !== "number");',
    to: '  const unreadable = false;',
  },
  {
    name: 'item 4: the draw-blank control loses its anchor and also blanks WorldCellPick',
    file: PROBE_READ,
    from: "  const define = new RegExp(`^#define SHADER_NAME ${program}$`, 'm').source",
    to: "  const define = new RegExp(`#define SHADER_NAME ${program}`, 'm').source",
  },
  {
    // Equivalent on the verdict — `null` coerces to 0 and still wins the reduce, so the measure fails
    // either way — and killed only by the reason it prints. That is the branch's whole job.
    name: 'item 4: an unreadable witness plane is folded as the worst reading instead of being named',
    file: METRICS,
    from: '  const unreadable = witnessed.filter((p) => p.contrastDeltaE === null);\n  if (unreadable.length > 0) {',
    to: '  const unreadable = witnessed.filter((p) => p.contrastDeltaE === null);\n  if (false) {',
  },
  {
    name: 'item 10: the drift band is printed beside an out-of-domain rate',
    file: METRICS,
    from: '  return measured.status === "insufficient" || measured.value === null\n    ? measured',
    to: '  return false\n    ? measured',
  },
  {
    name: 'item 10: the matrix line stops printing the drift band',
    file: METRICS,
    from: '        : ` (value ${subject.value}, bound ${subject.bound}${drift})`;',
    to: '        : ` (value ${subject.value}, bound ${subject.bound})`;',
  },
  {
    name: 'item 5: a fail with no value is dropped with the out-of-domain planes again',
    file: METRICS,
    from: '    if (failedWithoutValue.length > 0) {',
    to: '    if (false) {',
  },
  {
    name: 'item 6: the fold passes a criterion unless EVERY measure is out of domain again',
    file: METRICS,
    from: '  const status = criterionStatus(measures);\n  return {\n    id: first.id,',
    to:
      '  const scored = scoredMeasures(measures);\n' +
      '  const status = scored.some((m) => m.status === "fail") ? "fail" : ' +
      'scored.every((m) => m.status === "insufficient") ? "insufficient" : "pass";\n' +
      '  return {\n    id: first.id,',
  },
]

function run() {
  try {
    const out = execFileSync(
      'npx',
      [
        'vitest',
        'run',
        'test/worlds-metrics.test.ts',
        'test/worlds-probe-read.test.ts',
        '--coverage.enabled=false',
      ],
      { cwd: web, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return { failed: 0, rows: [], out }
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const match = out.match(/Tests\s+(\d+) failed/)
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
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restore()
    process.exit(130)
  })
}

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
