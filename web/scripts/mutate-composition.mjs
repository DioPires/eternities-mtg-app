/**
 * Mutation matrix for world composition and §1.5's far LOD (DEC-749).
 *
 * A green suite proves nothing until the same suite goes red on the defect it claims to catch.
 * Each row patches one source site, runs the test file that owns it, and expects RED; the tree is
 * restored between rows, and the control rows at both ends expect GREEN — an always-red tree would
 * otherwise score identically to a perfect guard.
 *
 * The row that matters most here is the first: **the admission height spelled as a small-angle
 * extent instead of the projected rect**. That is not a hypothetical — it is what this file was
 * written with, and the defect it produces is silent in the worst way, because the *picture* stays
 * correct (the shader draws from its own attributes) while the gate's W4 row scores a predicate the
 * renderer never evaluated.
 *
 * Run: `node scripts/mutate-composition.mjs`
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SURFACE = 'src/scene/worlds/worldSurface.ts'
const LOD = 'src/scene/worlds/lod.ts'

const TEST = 'test/worlds-composition.test.ts'

const MUTANTS = [
  {
    name: 'admission sized by the small-angle extent, not the projected rect (W4 scores a ghost)',
    file: SURFACE,
    from: '      const height = rect === null ? 0 : rect.height',
    to: '      const height =\n        rect === null\n          ? 0\n          : cellHeightPx(this.latArc, this.lifted, toCamera.length(), viewport.height, fovRadians)',
  },
  {
    name: 'admission height narrowed to float32, so the probe and the renderer round apart',
    file: SURFACE,
    from: '    this.heightPx = new Float64Array(cardCount)',
    to: '    this.heightPx = new Float32Array(cardCount)',
  },
  {
    name: 'the fade advances on a RESERVED layer (cross-fades into the previous card)',
    file: SURFACE,
    from: '      const resident = pool.layerOf(key)',
    to: '      const resident = pool.reserve(key, this.frameIndex)',
  },
  {
    name: 'residency read once and cached, so eviction never pulls the picture back',
    file: SURFACE,
    from: '      const resident = pool.layerOf(key)\n      if (resident === null) {',
    to: '      const resident = layers[cell] >= 0 ? layers[cell] : pool.layerOf(key)\n      if (resident === null || resident < 0) {',
  },
  {
    name: 'back-facing and off-screen cells counted as demand',
    file: SURFACE,
    from: '      if (front && on) threshold.offer(height)',
    to: '      threshold.offer(height)',
  },
  {
    name: 'admission drops the visibility terms it reports separately',
    file: SURFACE,
    from: '        this.frontFacing[cell] === 1 &&\n        this.onScreen[cell] === 1 &&\n        this.heightPx[cell]! >= effective',
    to: '        this.heightPx[cell]! >= effective',
  },
  {
    name: 'the bake reads the unpermuted swatches, so a control seam moves only one LOD',
    file: SURFACE,
    from: '      drawSwatches,\n    )',
    to: '      source.swatches,\n    )',
  },
  {
    name: '?swatch=mean averages nothing (the seam silently does not engage)',
    file: SURFACE,
    from: '  if (seams.swatchMean) {',
    to: '  if (false) {',
  },
  {
    name: '?bands=shuffle permutes the grid too, which is one of the silently-green spellings',
    file: SURFACE,
    from: "      normals: source.normals,\n      rows: source.rows,",
    to: "      normals: permuteTriples(source.normals, this.cardOfCell),\n      rows: source.rows,",
    // A helper the mutant needs; appended so the row patches one site.
    append:
      '\nfunction permuteTriples(values, order) {\n  const out = new Float32Array(values.length)\n  for (let i = 0; i < order.length; i += 1) {\n    out[i * 3] = values[order[i] * 3]\n    out[i * 3 + 1] = values[order[i] * 3 + 1]\n    out[i * 3 + 2] = values[order[i] * 3 + 2]\n  }\n  return out\n}\n',
  },
  {
    name: '?bands=shuffle is the identity (the seam parses but does nothing)',
    file: SURFACE,
    from: '  if (seams.bandsShuffle) return shufflePermutation(cardCount)',
    to: '  if (false) return shufflePermutation(cardCount)',
  },
  {
    name: 'the crossover is a hard switch rather than a band (D4: both passes inside it)',
    file: LOD,
    from: '  if (medianCellHeightPx >= highPx) return { drawSystem: false, drawSheet: true, sheetMix: 1 }\n  const mix = (medianCellHeightPx - lowPx) / (highPx - lowPx)\n  return { drawSystem: true, drawSheet: true, sheetMix: mix }',
    to: '  return { drawSystem: false, drawSheet: true, sheetMix: 1 }',
  },
  {
    name: 'the tint mix is a linear ramp, not a smoothstep',
    file: LOD,
    from: '  return t * t * (3 - 2 * t)\n}\n\n/** Which passes a world draws in this frame',
    to: '  return t\n}\n\n/** Which passes a world draws in this frame',
  },
  {
    name: 'the tint radius is treated as a floor rather than a ceiling (inverted)',
    file: LOD,
    from: '  if (!(radiusPx < tintRadiusPx)) return 0',
    to: '  if (!(radiusPx > tintRadiusPx)) return 0',
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

const originals = new Map()
for (const file of new Set(MUTANTS.map((m) => m.file))) {
  originals.set(file, readFileSync(file, 'utf8'))
}
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text)
}

let failures = 0
const control = run()
console.log(`control: ${control} — expected GREEN\n`)
if (control !== 'GREEN') failures += 1

for (const mutant of MUTANTS) {
  const source = originals.get(mutant.file)
  if (!source.includes(mutant.from)) {
    console.log(`SKIP  ${mutant.name}\n      site not found in ${mutant.file}`)
    failures += 1
    continue
  }
  let patched = source.replace(mutant.from, mutant.to)
  if (mutant.append) patched += mutant.append
  writeFileSync(mutant.file, patched)
  const verdict = run()
  restore()
  const ok = verdict === 'RED'
  if (!ok) failures += 1
  console.log(`${ok ? 'kill ' : 'LIVE '} ${verdict.padEnd(5)} ${mutant.name}`)
}

restore()
const after = run()
console.log(`\nrestored tree: ${after} — expected GREEN`)
if (after !== 'GREEN') failures += 1
console.log(failures === 0 ? '\nevery mutant killed' : `\n${failures} mutant(s) survived`)
process.exit(failures === 0 ? 0 : 1)
