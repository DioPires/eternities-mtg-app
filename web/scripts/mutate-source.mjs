/**
 * Mutation matrix for the dataset-to-source builder (DEC-749, §2.1/§2.2).
 *
 * `worlds-source.test.ts` went green on its first run, which is when a suite is least trustworthy:
 * every row of it is an agreement with an emitter, and an agreement that holds for the wrong reason
 * looks exactly like one that holds. So each mutant below is a spelling this module could plausibly
 * have been written with, and the matrix asks which rows notice.
 *
 * Two rows are scored as `note` rather than as kills, because they were written to settle a claim
 * the test file makes about itself rather than to defend a behaviour. **Both came back RED**, and
 * both results are recorded in `worlds-source.test.ts`:
 *
 *  - `starOffset + card + 1` — the off-by-one-card window. Killed, by row occupancy: a window
 *    shifted by one card puts cells in the wrong rows on most worlds.
 *  - `plane.radius` for `worldRadius(cardCount)`. Killed — which **refuted** §D's first draft, which
 *    said this dataset could not tell the two spellings apart. It can, on the shipped field's
 *    six-decimal emission, and §D now says so along with how thin that reason is. A test file that
 *    understates its own coverage teaches the next reader to add a redundant row.
 *
 * The matrix also caught two live mutants on the first pass — `hueCounts` indexed by
 * `colourIdentity` (a histogram that still sums to `cardCount` and lays every band at the wrong
 * latitude) and the theta row classifier. Neither is separable from the shipped bytes; both needed
 * a new kind of row, an independent artefact and a constructed input respectively.
 *
 * Run: `node scripts/mutate-source.mjs`
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE = 'src/scene/worlds/worldSource.ts'
const TEST = 'test/worlds-source.test.ts'

const MUTANTS = [
  {
    name: 'the float16 centre is used unnormalised (|p| off 1 by 3.6e-4)',
    from: '    const length = Math.sqrt(x * x + y * y + z * z)\n    const scale = length > 0 ? 1 / length : 0',
    to: '    const scale = 1',
  },
  {
    name: 'the row is matched in theta, not in y (§2.1: 2.31x margin against 3.08x)',
    from: '    rowOf[card] = rowOfUnitY(ny, rows)',
    to: '    rowOf[card] = Math.max(0, Math.min(rows - 1, Math.round(Math.acos(Math.max(-1, Math.min(1, ny))) / (Math.PI / rows) - 0.5)))',
  },
  {
    name: 'the swatch is corner 0 alone, not the 2x2 mean',
    from: '  for (const corner of [0, 1, 2, 3] as const) {\n    const sample = swatches.linear(star, corner)\n    r += sample[0]\n    g += sample[1]\n    b += sample[2]\n  }\n  return [r / 4, g / 4, b / 4]',
    to: '  const sample = swatches.linear(star, 0)\n  r = sample[0]\n  g = sample[1]\n  b = sample[2]\n  return [r, g, b]',
  },
  {
    name: 'the 2x2 is averaged encoded and linearised once (the convexity mutant)',
    from: '  for (const corner of [0, 1, 2, 3] as const) {\n    const sample = swatches.linear(star, corner)\n    r += sample[0]\n    g += sample[1]\n    b += sample[2]\n  }\n  return [r / 4, g / 4, b / 4]',
    to: '  const toLinear = (v: number): number =>\n    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4\n  for (const value of swatches.samples(star)) {\n    r += (value >> 11) / 31\n    g += ((value >> 5) & 0x3f) / 63\n    b += (value & 0x1f) / 31\n  }\n  return [toLinear(r / 4), toLinear(g / 4), toLinear(b / 4)]',
  },
  {
    name: 'the source pre-applies ?swatch=mean, so the seam becomes a no-op that still scores green',
    from: '    const swatch = meanSwatch(swatches, star)',
    to: '    const swatch: [number, number, number] = [0.5, 0.5, 0.5]',
  },
  {
    name: 'hueCounts is indexed by colourIdentity, not hueClass',
    from: '    hueCounts[stars.hueClass(star)] += 1',
    to: '    hueCounts[stars.colourIdentity(star) % 7] += 1',
  },
  {
    name: 'the starCount/cardCount guard is dropped',
    from: '  if (starCount !== cardCount) {',
    to: '  if (false) {',
  },
  {
    name: 'the star-range guard is dropped',
    from: '  if (starOffset < 0 || starOffset + starCount > stars.count) {',
    to: '  if (false) {',
  },
  {
    name: 'the two artefacts are not checked against each other',
    from: '  if (swatches.count !== stars.count) {',
    to: '  if (false) {',
  },
  {
    name: 'NEGATIVE CONTROL — the star window is off by one card',
    from: '    const star: StarIndex = starOffset + card',
    to: '    const star: StarIndex = Math.min(starOffset + card + 1, stars.count - 1)',
    expect: 'either',
  },
  {
    name: 'NEGATIVE CONTROL — radius read from the shipped field, not derived from §1.3',
    from: '    radius: worldRadius(cardCount),',
    to: '    radius: plane.radius,',
    expect: 'either',
  },
]

function run() {
  try {
    execFileSync('npx', ['vitest', 'run', TEST, '--coverage.enabled=false'], {
      stdio: 'pipe',
      encoding: 'utf8',
    })
    return 'GREEN'
  } catch {
    return 'RED'
  }
}

const original = readFileSync(SOURCE, 'utf8')
const restore = () => writeFileSync(SOURCE, original)

let failures = 0
const control = run()
console.log(`control: ${control} — expected GREEN\n`)
if (control !== 'GREEN') failures += 1

for (const mutant of MUTANTS) {
  if (!original.includes(mutant.from)) {
    console.log(`SKIP  ${mutant.name}\n      site not found in ${SOURCE}`)
    failures += 1
    continue
  }
  writeFileSync(SOURCE, original.replace(mutant.from, mutant.to))
  const verdict = run()
  restore()
  if (mutant.expect === 'either') {
    console.log(`note  ${verdict.padEnd(5)} ${mutant.name}`)
    continue
  }
  const ok = verdict === 'RED'
  if (!ok) failures += 1
  console.log(`${ok ? 'kill ' : 'LIVE '} ${verdict.padEnd(5)} ${mutant.name}`)
}

restore()
const after = run()
console.log(`\nrestored tree: ${after} — expected GREEN`)
if (after !== 'GREEN') failures += 1
console.log(failures === 0 ? '\nevery scored mutant killed' : `\n${failures} mutant(s) survived`)
process.exit(failures === 0 ? 0 : 1)
