#!/usr/bin/env node
/**
 * Negative controls for W4's 2026-09-16 board rulings: `split_measures` + `floor_times_ceiling` (the
 * reachable bar and the reported-only demand measure), `exit_domain` (the eviction half's exit-side
 * domain), and `absolute_floor` (the 0.5 under the bar).
 *
 * The first two rulings *loosen* something — one replaces a flat floor with a lower bar, the other
 * moves a scored zero out of domain — so the risk they carry is the opposite of the usual one. A
 * loosening is not caught by the row it was meant to fix going green; it is caught by the rows it was
 * **not** meant to touch staying red. Most mutants below are therefore aimed at a guard that still
 * has to bind, not at the rows the rulings exist to move.
 *
 * `absolute_floor` is the exception, and the reason this file is worth more than its first draft:
 * it *tightens*, because the loosening it repairs got all the way to a shipped tree. Between the two
 * rulings the bar was a pure fraction of the ceiling, which on a saturated pool is the same number
 * the bar is scoring — so the half could not fail at any capacity, and §3.1's own `tether-surface`
 * control passed at 37% art. **M13 is that defect as a mutant, M16 is its value pinned rather than
 * its presence.**
 *
 * Three of them are the ones I would have got wrong without a matrix:
 *
 * - **M4 and M5** cross-wire the two stream reports. They are adjacent positionals of identical
 *   shape, so TypeScript cannot see the swap and neither can any fixture where the two ends agree —
 *   which, before this leg, was every fixture in the file. They die only on the rows that put
 *   `swatchOnly` into open disagreement across the visit. See
 *   `a-symmetry-makes-two-sources-indistinguishable`.
 * - **M7** gives `artFraction` the exit-side domain as well. That is the single most plausible
 *   "tidy-up" a later reader could make — the two halves would then share one rule instead of two —
 *   and it silently excuses dominaria's real W4 failure. The asymmetry is the design.
 * - **M9** scores `demandFitsCapacity`. It is the mutant that proves `reported_only` is a decision
 *   the tests can see rather than a comment, and it reds the tier-4 row the split was raised for.
 *
 * **M2 and M13 are the vacuity controls, and they are the ones worth reading the output of.** M2
 * restores the flat 0.9 floor — if the suite went green under it, nothing here would be testing the
 * ceiling term. M13 removes the absolute floor — if the suite went green under *that*, nothing would
 * be testing whether the bar can bind on the frames it most needs to.
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
    name: 'M1 the bar is the bare ceiling — the reading the board did NOT take',
    file: METRICS,
    from: '  return Math.max(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);',
    to: '  return ceiling;',
  },
  {
    name: 'M2 VACUITY CONTROL: the flat 0.9 floor is back, so the ceiling scores nothing',
    file: METRICS,
    from: '  if (ceiling === null) return FLOORS.artFraction;\n  return Math.max(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);',
    to: '  if (ceiling === null) return FLOORS.artFraction;\n  return FLOORS.artFraction;',
  },
  {
    // **The second vacuity control, and the one the leg actually shipped a defect into.** M2 asks
    // whether the ceiling scores anything; this asks whether the FLOOR does. Under the mutant the
    // bar is a pure fraction of the ceiling, `artFraction == ceiling` on a saturated pool, and the
    // half cannot fail at any capacity — which is not a hypothetical: it was the shipped behaviour
    // between rulings `floor_times_ceiling` and `absolute_floor`, and it greened §3.1's own
    // `tether-surface` control at 37% art.
    name: 'M13 VACUITY CONTROL: drop the absolute floor, so a saturated pool can never fail',
    file: METRICS,
    from: '  return Math.max(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);',
    to: '  return FLOORS.artFraction * ceiling;',
  },
  {
    // The other term. If only the floor survived, `floor_times_ceiling` would have been reverted
    // rather than repaired, and tier 4 would be scored against a bar its capacity cannot reach —
    // the defect the split was raised for in the first place.
    name: 'M14 the ceiling term is dropped, so the bar is a flat 0.5 everywhere',
    file: METRICS,
    from: '  return Math.max(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);',
    to: '  return FLOORS.artFractionAbsolute;',
  },
  {
    // A one-character slip with the sign of the whole ruling in it: `min` takes the *lower* of the
    // two terms everywhere, which is strictly weaker than either rule alone.
    name: 'M15 min instead of max — the bar takes whichever term binds least',
    file: METRICS,
    from: '  return Math.max(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);',
    to: '  return Math.min(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);',
  },
  {
    // **The constant's VALUE, not just its presence.** 0.371 is just under `tether-surface`'s
    // 0.37115, so this mutant leaves the floor in place, leaves every structural test green, and
    // re-greens the one control the floor was ruled in to red. It dies only on rows that pin the
    // number — the 2x sweep and the capture's own bound. See
    // `a-worked-example-can-satisfy-an-invariant-by-chance`.
    name: 'M16 the floor is lowered to 0.371, just under the control it exists to red',
    file: METRICS,
    from: '  artFractionAbsolute: 0.5,',
    to: '  artFractionAbsolute: 0.371,',
  },
  {
    name: 'M3 the bar is published but not scored — the report and the verdict disagree',
    file: METRICS,
    from: '        reachableBar(ceiling),\n        "min",',
    to: '        FLOORS.artFraction,\n        "min",',
  },
  {
    name: 'M4 CROSS-WIRE: the eviction half reads the ENTRY report',
    file: METRICS,
    from: '  const boundAtExit = budgetBoundAtExit(exitStream);',
    to: '  const boundAtExit = budgetBoundAtExit(entryStream);',
  },
  {
    name: 'M5 CROSS-WIRE, the other way: artFraction reads the EXIT report',
    file: METRICS,
    from: '  const bound = budgetBoundAtEntry(entryStream);',
    to: '  const bound = budgetBoundAtEntry(exitStream);',
  },
  {
    name: 'M6 THE DEFECT THE RULING FIXES: the eviction half loses its exit-side domain',
    file: METRICS,
    from: '  const evictionWhy =\n    noAdmission ??\n    (boundAtExit',
    to: '  const evictionWhy =\n    noAdmission ??\n    (false',
  },
  {
    name: 'M7 THE TIDY-UP: artFraction shares the exit-side domain, excusing a real failure',
    file: METRICS,
    from: '  const empty = noAdmission === null && wanting.length === 0;',
    to: '  const empty = (noAdmission ?? (boundAtExit ? "x" : null)) === null && wanting.length === 0;\n  if (boundAtExit) noAdmission ??= "budget exhausted during this visit";',
  },
  {
    name: 'M8 exitStream is defaulted, so the guard is off wherever a caller forgets it',
    file: METRICS,
    from: 'pool, entryStream, exitStream) {',
    to: 'pool, entryStream, exitStream = { swatchOnly: false, bytesOutstanding: 0, bytesReserved: 0, byteBudget: 0 }) {',
  },
  {
    name: 'M9 demandFitsCapacity is SCORED, which reds the tier-4 row the split exists to green',
    file: METRICS,
    from: '          scored: false,\n          insufficient: noAdmission !== null || wanting.length === 0,',
    to: '          scored: true,\n          insufficient: noAdmission !== null || wanting.length === 0,',
  },
  {
    name: 'M10 the criterion counts unscored measures again, so `reported_only` means nothing',
    file: METRICS,
    from: '  return measures.filter((m) => m.scored !== false);',
    to: '  return measures;',
  },
  {
    name: 'M11 the demand measure is reported as its reciprocal — a ratio that never exceeds 1',
    file: METRICS,
    from: '  return wanting / pool.layers;',
    to: '  return pool.layers / wanting;',
  },
  {
    // The fixture control. If the two stream doubles were the same object, M4 and M5 would both
    // survive — so the matrix has to prove the doubles differ, not just that the code reads them.
    name: 'M12 FIXTURE CONTROL: the exit double is the entry double, so no row can see a swap',
    file: TEST,
    from: '  const EXHAUSTED_DURING_VISIT = {\n    swatchOnly: true,',
    to: '  const EXHAUSTED_DURING_VISIT = {\n    swatchOnly: false,',
  },

  // ---- DEC-837: the eviction re-bound and the absolute no-starvation term --------------------
  // Board ruling on DEC-833 card `bd5c9aad`, option (a). The bound went UP, from 5/s to 21/s, and
  // that direction is the dangerous one here for the reason the file's header gives about
  // `floor_times_ceiling`: **a bound raised to green a live reading can as easily be raised past
  // the point where anything reds it**, and nothing in a green suite would say so. M18 and M25 are
  // the vacuity controls for that, and they are the two whose output is worth reading.
  {
    name: 'M17 the bound is back to 5/s — the unreachable number the ruling retired',
    file: METRICS,
    from: '  evictionsPerSecond: 21,',
    to: '  evictionsPerSecond: 5,',
  },
  {
    // The vacuity control for the re-bound. The floor is still present, still `max`-scored, still
    // reported beside every verdict — and no configuration on record can reach it. A suite that
    // stayed green here would be testing the bound's *presence* and never its value, which is the
    // M16 lesson one measure over: `a-bound-check-is-vacuous-when-the-bound-never-binds`.
    name: 'M18 VACUITY CONTROL: the bound is 1,000/s, so no turnover can ever red it',
    file: METRICS,
    from: '  evictionsPerSecond: 21,',
    to: '  evictionsPerSecond: 1_000,',
  },
  {
    // The scope half of the ruling, dropped. Without it a 128-layer pool's 6.73/s scores GREEN —
    // and it is 6.73 only because the pool refuses ~4,670 wants/s for exhaustion, so the gate would
    // be certifying the starvation the art half exists to forbid.
    name: 'M19 the capacity domain is dropped, so a starved tier-4 pool scores a comfortable GREEN',
    file: METRICS,
    from: '        pool.layers !== W4_EVICTION_POOL_LAYERS',
    to: '        false',
  },
  {
    // **The DEC-835 defect as a mutant.** "Resident stops climbing" is the obvious fill detector and
    // it is wrong on the only configuration that matters: a saturated pool churns 1023 -> 1024
    // forever, so the last upward tick lands in the final seconds and the "steady state" is two
    // samples. On a 60 s baseline this rule put the fill's end at t = 57.1 s.
    name: 'M20 the fill ends where resident last stopped climbing, not at saturation',
    file: METRICS,
    from: '  const tail = saturated\n    ? usable.slice(usable.findIndex((s) => s.resident >= s.layers))\n    : usable;',
    to: '  const tail = saturated\n    ? usable.slice(\n        usable.reduce((at, s, i) => (i > 0 && s.resident > usable[i - 1].resident ? i : at), 0),\n      )\n    : usable;',
  },
  {
    // Excluding the fill is necessary and not sufficient, and this is the mutant that says so: a
    // tail that is still decaying gets published as a steady state.
    name: 'M21 the tail is never scored for convergence, so a decaying window is a rate',
    file: METRICS,
    from: '  const converged = drift <= convergence;',
    to: '  const converged = true;',
  },
  {
    // The fill exclusion removed outright — the window is the whole observation again, which is the
    // instrument DEC-752 recorded as unable to tell a fill from churn by construction.
    name: 'M22 no fill exclusion at all: the tail is the whole timeline',
    file: METRICS,
    from: '  const tail = saturated\n    ? usable.slice(usable.findIndex((s) => s.resident >= s.layers))\n    : usable;',
    to: '  const tail = usable;',
  },
  {
    // **The rule this one replaced, and it is the defect the first live tour found.** Below
    // saturation nothing is ever evicted, so `resident` only climbs and `max(resident)` is the LAST
    // sample: alara was scored off a 2.0 s two-sample tail, one jitter from falling out of W4's
    // domain, and 44 of the 45 worlds have that shape.
    name: 'M28 the fill ends at max(resident) regardless of saturation — alara\'s two-sample tail',
    file: METRICS,
    from: '  const tail = saturated\n    ? usable.slice(usable.findIndex((s) => s.resident >= s.layers))\n    : usable;',
    to: '  const tail = usable.slice(usable.findIndex((s) => s.resident === peakResident));',
  },
  {
    // The capacity half of the readability check. Without it an unsaturated verdict is reached from
    // `undefined`, and a churning pool's whole window — fill included — gets published as a rate.
    name: 'M29 capacity is not required on a sample, so saturation is decided from undefined',
    file: METRICS,
    from: '      typeof s.resident === "number" &&\n      typeof s.layers === "number",',
    to: '      typeof s.resident === "number",',
  },
  {
    // A missing occupancy read as a settled zero. The comfortable wrong answer: a `0` sails through
    // the bound on every timeline that forgot to report `resident`, which is `streamNeverRan`'s
    // lesson — a structural zero wearing a passing verdict — arriving by a fourth route.
    name: 'M23 a timeline with no occupancy is scored as a settled zero rather than unreadable',
    file: METRICS,
    from: '      typeof s.resident === "number" &&\n      typeof s.layers === "number",',
    to: '      typeof s.layers === "number",',
  },
  {
    // The no-starvation term deleted. The frame `artFraction` scored 1.00 at fourteen cells of art
    // goes green again on every half.
    name: 'M24 THE DEFECT THE RULING FIXES: no absolute term, so a collapsed want set is invisible',
    file: METRICS,
    from: '        showing.length,\n        FLOORS.artCellsAbsolute,\n        "min",',
    to: '        showing.length,\n        0,\n        "min",',
  },
  {
    // The vacuity control for the floor's *value*, as distinct from its presence: 8 leaves the term
    // in place, leaves every structural row green, and sits below the 14-cell witness it exists to
    // red. A constant's presence is not its value.
    name: 'M25 VACUITY CONTROL: the absolute floor is 8, just under the witness it exists to red',
    file: METRICS,
    from: '  artCellsAbsolute: 32,',
    to: '  artCellsAbsolute: 8,',
  },
  {
    // **The defect the first 45-world acceptance tour found in this leg's own floor.** Set equal to
    // the domain cut-off, the domain admits a frame at the instant it reaches the bound, so the
    // worst in-domain reading is pinned just above the bound on every build — the tour read 65
    // against 64, a 1.5% margin on a correct renderer. It reds nothing today and reds the roster
    // tomorrow, which is the worst of both directions.
    name: 'M30 the floor is raised to the domain cut-off, so no in-domain frame has margin',
    file: METRICS,
    from: '  artCellsAbsolute: 32,',
    to: '  artCellsAbsolute: 128,',
  },
  {
    // The other way to collapse the same gap: pull the domain down onto the floor. Same defect,
    // and it also drags 20-odd small worlds into a domain where an absolute cell count says nothing.
    name: 'M31 the domain opens at the floor instead of four times above it',
    file: METRICS,
    from: 'export const W4_STARVATION_DOMAIN_CELLS = SMALLEST_SHIPPED_POOL_LAYERS;',
    to: 'export const W4_STARVATION_DOMAIN_CELLS = FLOORS.artCellsAbsolute;',
  },
  {
    // **The most plausible edit a later reader makes, and it switches the term off exactly where it
    // is needed.** Writing the domain off `wanting` reads as tidier — the two art measures would
    // share one denominator — and on the starved frame `wanting` is 14, so the term goes
    // `insufficient` on the collapse it exists to catch. Same defect, one level up.
    name: 'M26 THE TIDY-UP: the absolute term takes its domain from the want set, not the geometry',
    file: METRICS,
    from: '            presented.length < W4_STARVATION_DOMAIN_CELLS,',
    to: '            wanting.length < W4_STARVATION_DOMAIN_CELLS,',
  },
  {
    // `reported_only` applied to the wrong measure. The term would still print its red and colour
    // nothing, which is the shape `demandFitsCapacity` legitimately has and this one must not.
    name: 'M27 the absolute term is reported and not scored, so its RED cannot colour a row',
    file: METRICS,
    from: '        {\n          insufficient:\n            noAdmission !== null ||',
    to: '        {\n          scored: false,\n          insufficient:\n            noAdmission !== null ||',
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
