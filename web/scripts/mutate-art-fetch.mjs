/**
 * Mutation matrix for §1.6's fetch discipline (DEC-749).
 *
 * A green suite proves nothing until the same suite goes red on the defect it claims to catch.
 * Each row patches one source site, runs `test/worlds-art-fetch.test.ts`, and expects RED; the tree
 * is restored between rows and a final control row expects GREEN.
 *
 * Run: `node scripts/mutate-art-fetch.mjs`
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const STREAM = 'src/scene/worlds/artStream.ts'
const POOL = 'src/scene/worlds/artPool.ts'
const QUEUE = 'src/scene/cards/imageQueue.ts'

const MUTANTS = [
  {
    name: 'letterbox fills the layer (the stretch nothing downstream can undo)',
    file: STREAM,
    from: '  const scale = Math.min(layerWidth / sourceWidth, layerHeight / sourceHeight)',
    to: '  const scale = Math.max(layerWidth / sourceWidth, layerHeight / sourceHeight)',
  },
  {
    name: 'letterbox does not centre its bars',
    file: STREAM,
    from: '    x: Math.floor((layerWidth - width) / 2),\n    y: Math.floor((layerHeight - height) / 2),',
    to: '    x: 0,\n    y: 0,',
  },
  {
    name: 'decode at the layer size instead of the letterboxed size',
    file: STREAM,
    from: '      resize: { width: this.box.width, height: this.box.height },',
    to: '      resize: { width: ART_LAYER_WIDTH, height: ART_LAYER_HEIGHT },',
  },
  {
    name: 'a dropped request is treated as a failure (poisons the key for the session)',
    file: STREAM,
    from: '    this.pool.release(key)',
    to: '    this.pool.fail(key)',
  },
  {
    name: 'reset cancels by the card key rather than the queue key',
    file: STREAM,
    from: '      this.queue.cancel(queueKey)',
    to: '      this.queue.cancel(`worlds-art:${key}`)',
  },
  {
    name: 'no per-key de-duplication of in-flight requests',
    file: STREAM,
    from: '    if (this.inFlight.has(key)) return layer',
    to: '    if (false) return layer',
  },
  {
    name: 'the byte budget charges the decoded footprint, not the body',
    file: STREAM,
    from: '      this.bytesFetched += result.bytes\n      const layer = this.pool.resolve(key)',
    to: '      this.bytesFetched += ART_LAYER_WIDTH * ART_LAYER_HEIGHT * 4\n      const layer = this.pool.resolve(key)',
  },
  {
    name: 'a failed decode is not charged',
    file: STREAM,
    from: '      this.bytesFetched += result.bytes\n      this.failed += 1',
    to: '      this.failed += 1',
  },
  {
    name: 'swatchOnly uses a strict > so a zero budget never engages',
    file: STREAM,
    from: '    return this.bytesFetched >= this.byteBudget',
    to: '    return this.bytesFetched > this.byteBudget',
  },
  {
    name: 'release also takes back a RESIDENT layer (evicts a landed picture)',
    file: POOL,
    from: "    if (layer === undefined || this.state[layer] !== LAYER_RESERVED) return\n    this.state[layer] = LAYER_FREE\n    this.byKey.delete(key)\n    this.reservedCount -= 1\n  }\n\n  /** The fetch failed:",
    to: "    if (layer === undefined) return\n    this.state[layer] = LAYER_FREE\n    this.byKey.delete(key)\n    this.reservedCount -= 1\n  }\n\n  /** The fetch failed:",
  },
  {
    name: 'the queue reports no byte count',
    file: QUEUE,
    from: '      bytes = Number.isFinite(blob.size) ? blob.size : 0',
    to: '      bytes = 0',
  },
  {
    name: 'the queue drops its concurrency cap',
    file: QUEUE,
    from: '    while (!this.disposed && this.inFlightCount < this.concurrency && this.waiting.length > 0) {',
    to: '    while (!this.disposed && this.waiting.length > 0) {',
  },
]

function run() {
  try {
    execFileSync('npx', ['vitest', 'run', 'test/worlds-art-fetch.test.ts'], {
      stdio: 'pipe',
      encoding: 'utf8',
    })
    return 'GREEN'
  } catch {
    return 'RED'
  }
}

const originals = new Map()
for (const file of new Set(MUTANTS.map((m) => m.file))) {
  originals.set(file, readFileSync(file, 'utf8'))
}
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text)
}

let failures = 0
console.log(`control (unmutated tree): ${run()} — expected GREEN\n`)

for (const mutant of MUTANTS) {
  const source = originals.get(mutant.file)
  if (!source.includes(mutant.from)) {
    console.log(`SKIP  ${mutant.name}\n      site not found in ${mutant.file}`)
    failures += 1
    continue
  }
  writeFileSync(mutant.file, source.replace(mutant.from, mutant.to))
  const verdict = run()
  restore()
  const ok = verdict === 'RED'
  if (!ok) failures += 1
  console.log(`${ok ? 'kill ' : 'LIVE '} ${verdict.padEnd(5)} ${mutant.name}`)
}

restore()
console.log(`\nrestored tree: ${run()} — expected GREEN`)
console.log(failures === 0 ? '\nevery mutant killed' : `\n${failures} mutant(s) survived`)
process.exit(failures === 0 ? 0 : 1)
