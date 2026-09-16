/**
 * Mutation matrix for §1.6's fetch discipline and §3.1's probe payload (DEC-749).
 *
 * A green suite proves nothing until the same suite goes red on the defect it claims to catch.
 * Each row patches one source site, runs the test file that owns it, and expects RED; the tree is
 * restored between rows, and the control rows at both ends expect GREEN — an always-red tree would
 * otherwise score identically to a perfect guard.
 *
 * This earned its keep on the first run: the "reset cancels by the card key" row survived, because
 * the test asserted the *pool* and `reset()` releases the reservation itself, so the assertion was
 * insensitive to whether the cancel found its target. The queue was the only witness.
 *
 * Run: `node scripts/mutate-art-fetch.mjs`
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const STREAM = 'src/scene/worlds/artStream.ts'
const POOL = 'src/scene/worlds/artPool.ts'
const QUEUE = 'src/scene/cards/imageQueue.ts'
const PROBE = 'src/scene/worlds/probePayload.ts'

const FETCH_TEST = 'test/worlds-art-fetch.test.ts'
const PROBE_TEST = 'test/worlds-probe.test.ts'

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
    // Re-pointed at DEC-812's spelling. The row carried `this.bytesFetched >= this.byteBudget`
    // long after DEC-780 replaced that line, so the site was not found and the matrix had been
    // scoring a SKIP where it read as a mutant — the anchor is the whole guard, and a stale one
    // fails open the moment the line it names is reworded.
    name: 'swatchOnly uses a strict > so a zero budget never engages',
    file: STREAM,
    from: '    return this.bytesOutstanding + this.bytesReserved >= this.byteBudget',
    to: '    return this.bytesOutstanding + this.bytesReserved > this.byteBudget',
  },
  {
    name: 'DEC-812: swatchOnly is hardcoded false (the bound never binds)',
    file: STREAM,
    from: '    return this.bytesOutstanding + this.bytesReserved >= this.byteBudget',
    to: '    return false',
  },
  {
    name: 'DEC-812: the retired session-cumulative predicate — THE UNFIXED TREE',
    file: STREAM,
    from: '    return this.bytesOutstanding + this.bytesReserved >= this.byteBudget',
    to: '    return this.bytesFetched + this.bytesReserved >= this.byteBudget',
  },
  {
    name: 'DEC-812: the reclaim on eviction is deleted',
    file: STREAM,
    from: '    const bytes = this.settledBytes.get(key)\n    if (bytes === undefined) return\n    this.settledBytes.delete(key)\n    this.bytesOutstanding -= bytes',
    to: '    void key',
  },
  {
    name: 'DEC-812: the reclaim credits a constant, not the evicted key\'s body',
    file: STREAM,
    from: '    const bytes = this.settledBytes.get(key)\n    if (bytes === undefined) return\n    this.settledBytes.delete(key)\n    this.bytesOutstanding -= bytes',
    to: '    if (!this.settledBytes.delete(key)) return\n    this.bytesOutstanding -= ART_CROP_ESTIMATED_BYTES',
  },
  {
    name: 'DEC-812: a settled body is never charged as outstanding',
    file: STREAM,
    from: '      this.settledBytes.set(key, result.bytes)\n      this.bytesOutstanding += result.bytes',
    to: '      this.settledBytes.set(key, result.bytes)',
  },
  {
    name: 'DEC-812: the default budget is a flat 64 MiB again, not derived from the pool',
    file: STREAM,
    from: '    this.byteBudget = Math.max(0, options.byteBudget ?? defaultByteBudget(this.pool.layers))',
    to: '    this.byteBudget = Math.max(0, options.byteBudget ?? 64 * 1024 * 1024)',
  },
  {
    name: 'DEC-812: the pool evicts silently, without naming the displaced key',
    file: POOL,
    from: '    this.evictionListener?.(displaced)',
    to: '    void this.evictionListener',
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
  {
    name: 'probe: shade squares BEFORE the clamp (night and day become identical)',
    file: PROBE,
    test: PROBE_TEST,
    from: '  const clamped = wrapped < 0 ? 0 : wrapped > 1 ? 1 : wrapped\n  return SHADE_AMBIENT + SHADE_GAIN * clamped * clamped',
    to: '  const squared = wrapped * wrapped\n  const clamped = squared < 0 ? 0 : squared > 1 ? 1 : squared\n  return SHADE_AMBIENT + SHADE_GAIN * clamped',
  },
  {
    name: 'probe: shade clamps lambert instead of wrapping it',
    file: PROBE,
    test: PROBE_TEST,
    from: '  const wrapped = dotNormalLight * 0.5 + 0.5',
    to: '  const wrapped = dotNormalLight',
  },
  {
    name: 'probe: rect from the four corners only',
    file: PROBE,
    test: PROBE_TEST,
    from: '  const { kLon, kLat } = subdivision',
    to: '  const { kLon, kLat } = { kLon: 1, kLat: 1 }\n  void subdivision',
  },
  {
    name: 'probe: rect projects before the near-plane rejection',
    file: PROBE,
    test: PROBE_TEST,
    from: '      if (point.z > -near) continue\n      point.applyMatrix4(projectionMatrix)',
    to: '      point.applyMatrix4(projectionMatrix)\n      if (point.z > -near) continue',
  },
  {
    name: 'probe: rect does not flip y for the screen',
    file: PROBE,
    test: PROBE_TEST,
    from: '      const sy = (0.5 - point.y * 0.5) * viewportHeightPx',
    to: '      const sy = (point.y * 0.5 + 0.5) * viewportHeightPx',
  },
  {
    name: 'probe: cells renumbered after compaction, losing the instance id',
    file: PROBE,
    test: PROBE_TEST,
    from: '    cells.push({ cell, ...record })',
    to: '    cells.push({ cell: cells.length, ...record })',
  },
  {
    name: 'probe: longitude spelled atan2(z, x), which mirrors the world',
    file: PROBE,
    test: PROBE_TEST,
    from: '  return out.set(sinTheta * Math.sin(lambda), Math.cos(theta), sinTheta * Math.cos(lambda))',
    to: '  return out.set(sinTheta * Math.cos(lambda), Math.cos(theta), sinTheta * Math.sin(lambda))',
  },
]

function run(test = FETCH_TEST) {
  try {
    execFileSync('npx', ['vitest', 'run', test], {
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
console.log(`control: ${run(FETCH_TEST)} / ${run(PROBE_TEST)} — both expected GREEN\n`)

for (const mutant of MUTANTS) {
  const source = originals.get(mutant.file)
  if (!source.includes(mutant.from)) {
    console.log(`SKIP  ${mutant.name}\n      site not found in ${mutant.file}`)
    failures += 1
    continue
  }
  writeFileSync(mutant.file, source.replace(mutant.from, mutant.to))
  const verdict = run(mutant.test ?? FETCH_TEST)
  restore()
  const ok = verdict === 'RED'
  if (!ok) failures += 1
  console.log(`${ok ? 'kill ' : 'LIVE '} ${verdict.padEnd(5)} ${mutant.name}`)
}

restore()
console.log(`\nrestored tree: ${run(FETCH_TEST)} / ${run(PROBE_TEST)} — both expected GREEN`)
console.log(failures === 0 ? '\nevery mutant killed' : `\n${failures} mutant(s) survived`)
process.exit(failures === 0 ? 0 : 1)
