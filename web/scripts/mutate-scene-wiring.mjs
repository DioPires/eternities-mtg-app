/**
 * Mutation matrix for the scene's **worlds wiring** (DEC-772, DEC-768 F3).
 *
 * Every other matrix in this directory mutates a part. This one mutates the *joins*, because that
 * is where both of this leg's shipped defects lived:
 *
 *  - `worlds()` returned `undefined` on every page for four commits (DEC-768 F3), with 867/867
 *    green, because the two lines that hand the payload out were tested by nothing.
 *  - The art stream was never *asked* on any world in any configuration (DEC-772), with 882/882
 *    green and four clean matrices, because `sceneHost` composed the roster without `cardOf` and
 *    every `WorldSurface` test supplies its own.
 *
 * Both are one-argument omissions at a call site, neither is a type error, and neither changes a
 * picture into an obviously broken one — the first draws a correct globe of swatches and the second
 * draws the same globe for the rest of the session. A matrix over the composition is the only
 * instrument that can see either.
 *
 * The control rows at both ends expect GREEN: an always-red tree would otherwise score identically
 * to a perfect guard.
 *
 * Run: `node scripts/mutate-scene-wiring.mjs`
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const TEST = 'test/worlds-scene-seam.test.tsx'

const HOST = 'src/scene/renderer/sceneHost.ts'
const VIEW = 'src/scene/EternitiesScene.tsx'

const MUTANTS = [
  {
    file: HOST,
    name: 'THE DEFECT — the composition supplies no `cardOf` (the art stream is never asked)',
    from: '      cardOf: (plane, card) => this.worldCardOf(plane, card),\n',
    to: '',
  },
  {
    file: HOST,
    name: 'the focused plane`s cards never reach the worlds path (only the thumbnail tier)',
    from: '    this.worldCards = cards\n',
    to: '',
  },
  {
    file: HOST,
    name: 'a world`s local card index is used as a global star index (every lookup misses)',
    from: '    const record = this.worldCards.get(plane.starOffset + card)',
    to: '    const record = this.worldCards.get(card)',
  },
  {
    file: HOST,
    name: 'the cell fetches the latest printing, not the one `swatches.bin` was computed from',
    from: '    const printing = record?.p[0]',
    to: '    const printing = record?.p[record.p.length - 1]',
  },
  {
    file: VIEW,
    name: 'DEC-768 M1 — the probe seam is handed no `worldsSource` (optional, so not a type error)',
    from: '    worldsSource: () => scene3d.worldsProbeSource(),\n',
    to: '',
  },
  {
    file: VIEW,
    name: 'DEC-768 M2 — the roster is never published, so nothing composes',
    from: '    scene3d.setWorldData(worldData)',
    to: '    scene3d.setWorldData(null)',
  },
  {
    file: HOST,
    // Shard loading is driven by focus (PRD 8.7.6) and the worlds path adds no reader of the
    // *plane*, so this one is expected to survive and is recorded rather than scored. It is here to
    // stop a later reader assuming `setPlane` is part of the art wiring: it is not.
    name: 'NEGATIVE CONTROL — `setPlane` is not part of the art wiring',
    from: '    this.cardTierHandle?.setPlane(plane)',
    to: '    this.cardTierHandle?.setPlane(plane ?? null)',
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

const FILES = [...new Set(MUTANTS.map((m) => m.file))]
const originals = new Map(FILES.map((file) => [file, readFileSync(file, 'utf8')]))
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text)
}

let failures = 0
const control = run()
console.log(`control: ${control} — expected GREEN\n`)
if (control !== 'GREEN') failures += 1

for (const mutant of MUTANTS) {
  const original = originals.get(mutant.file)
  if (!original.includes(mutant.from)) {
    console.log(`SKIP  ${mutant.name}\n      site not found in ${mutant.file}`)
    failures += 1
    continue
  }
  writeFileSync(mutant.file, original.replace(mutant.from, mutant.to))
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
