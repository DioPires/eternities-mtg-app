/**
 * Mutation matrix for the pass-list cutover (DEC-749, §1.1/§1.2).
 *
 * `worlds-attach.test.ts` went green on its first run, and this is the one leg where that is least
 * reassuring: the defect the whole file exists to catch — a composition that is built, tested and
 * never reached — is invisible to *every* test that does not go through the attachment. So the
 * matrix is the report, and it spans four files, because the cutover is four edits in four places
 * and a row that only mutates one of them cannot see the other three.
 *
 * Two mutants below were **LIVE on the first pass** and are recorded with what killed them, because
 * neither is a spelling anybody would call wrong on inspection:
 *
 *  - **The key light's two offsets transposed.** `acos(cos(el)·cos(az))` is symmetric in the pair,
 *    so the 0.798 rad row, the turns-with-the-camera row and the lights-the-near-face row all stay
 *    green while the terminator rotates 29 degrees across every world. Killed by splitting the
 *    light into its camera-right and camera-up components, which is the only reading that is not
 *    symmetric.
 *  - **The `worlds` phase moved before `rig`.** No behavioural row can see it in this file: the
 *    harness poses the camera by hand, so there is no `rig` subscriber to be run in the wrong
 *    order, and every number comes out identical. Killed by an assertion against `TICK_PHASES`
 *    itself — a source pin, and said so at the site.
 *
 * Run: `node scripts/mutate-attach.mjs`
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const TEST = 'test/worlds-attach.test.ts'

const ATTACH = 'src/scene/worlds/attachWorlds.ts'
const SURFACE = 'src/scene/worlds/worldSurface.ts'
const PROBE = 'src/scene/worlds/worldsProbe.ts'
const LIGHT = 'src/scene/worlds/keyLight.ts'
const LOOP = 'src/scene/renderer/frameLoop.ts'

const MUTANTS = [
  {
    file: SURFACE,
    name: '?art=off is inert — the seam parses, echoes, and every cell still draws art (DEC-821)',
    from: '      if (seams.artOff) {\n        layers[cell] = LAYER_FREE',
    to: '      if (false) {\n        layers[cell] = LAYER_FREE',
  },
  {
    file: SURFACE,
    name: '?art=off is permanently ON — the shipped build never draws art at all (DEC-821)',
    from: '      if (seams.artOff) {\n        layers[cell] = LAYER_FREE',
    to: '      if (true) {\n        layers[cell] = LAYER_FREE',
  },
  {
    file: SURFACE,
    name: '?art=off suppresses the DRAW but still asks, so the pool is not untouched (DEC-821)',
    from: '      if (seams.artOff) {\n        layers[cell] = LAYER_FREE\n        this.fade[cell] = 0\n        art[cell] = 0\n        continue\n      }\n\n      const card = this.cardOfCell[cell]!',
    to: '      const card = this.cardOfCell[cell]!',
    // The rest of the suppression, moved below the request: art still never draws, and only the
    // "asked for nothing" half of the seam's contract fails. A row scoring the picture alone lives.
    also: {
      from: '      layers[cell] = resident\n      const next = this.fade[cell]! + fadeStep',
      to: '      if (seams.artOff) {\n        layers[cell] = LAYER_FREE\n        this.fade[cell] = 0\n        art[cell] = 0\n        continue\n      }\n      layers[cell] = resident\n      const next = this.fade[cell]! + fadeStep',
    },
  },
  {
    file: PROBE,
    name: 'the payload hardcodes artOff: false, so the seam has no read-back (DEC-821)',
    from: '    seams: source.seams,',
    to: '    seams: { ...source.seams, artOff: false },',
  },
  {
    file: SURFACE,
    name: 'the art pool is keyed by the per-world card index (45 worlds alias onto one key space)',
    from: '      const key = source.artKeyBase + card',
    to: '      const key = card',
  },
  {
    file: ATTACH,
    name: 'the viewport is the drawing buffer, not the CSS box (every threshold doubles at dpr 2)',
    from: '    gl.getSize(viewport)',
    to: '    gl.getDrawingBufferSize(viewport)',
  },
  {
    file: ATTACH,
    name: 'the payload holds the live camera instead of the frame it was measured on',
    from: '      camera: frameCamera,',
    to: '      camera,',
  },
  {
    file: ATTACH,
    name: 'the sheet always draws, so §1.5s crossover never partitions anything',
    from: '      surface.mesh.visible = surface.crossover.drawSheet',
    to: '      surface.mesh.visible = true',
  },
  {
    file: ATTACH,
    name: 'the sheet is derived from the system pass (§1.5: both draw inside the band)',
    from: '      surface.mesh.visible = surface.crossover.drawSheet',
    to: '      surface.mesh.visible = !surface.crossover.drawSystem',
  },
  {
    file: ATTACH,
    name: 'the pool is allocated even when the roster has no worlds (48 MiB on every v2 page)',
    from: '      if (worlds.length === 0) return\n      allocatePool()',
    to: '      allocatePool()\n      if (worlds.length === 0) return',
  },
  {
    file: ATTACH,
    name: 'the equirect array is sized from a constant, not from the dataset',
    from: '      equirectArray = createEquirectArray(worlds.length)',
    to: '      equirectArray = createEquirectArray(45)',
  },
  {
    file: ATTACH,
    name: 'the reported world is the nearest in scene units, not in its own radii',
    from: '        if (surface.radii < nearest.radii) nearest = surface',
    to: '        if (surface.centre.distanceTo(camera.position) < nearest.centre.distanceTo(camera.position)) nearest = surface',
  },
  {
    file: ATTACH,
    name: 'the pool is not released when the roster is torn down',
    from: '      teardownSurfaces()\n      // Every in-flight fetch would land in a layer the new roster has since been given, and the\n      // pool itself is sized against a roster that is going away. See `ArtStream.reset`.\n      releasePool()',
    to: '      teardownSurfaces()',
  },
  {
    file: ATTACH,
    name: '?layers=N is ignored and the tier decides the pool',
    from: '    return artPoolSize(seams.layersRequested ?? tier, capabilities.maxArrayTextureLayers)',
    to: '    return artPoolSize(tier, capabilities.maxArrayTextureLayers)',
  },
  {
    file: ATTACH,
    name: 'the pool is the tier constant, unclamped by MAX_ARRAY_TEXTURE_LAYERS',
    from: '    return artPoolSize(seams.layersRequested ?? tier, capabilities.maxArrayTextureLayers)',
    to: '    return seams.layersRequested ?? tier',
  },
  {
    file: ATTACH,
    name: 'the probe answers before the first tick, from a camera that has never been read',
    from: '      if (!frame || surfaces.length === 0) return null',
    to: '      if (surfaces.length === 0) return null\n      if (!frame) return surfaces[0]!.probeSource({ camera: frameCamera, viewport: { width: 0, height: 0 }, fovRadians: 0, deltaSeconds: 0, lightDirection: light })',
  },
  {
    file: LIGHT,
    name: 'the key light is fixed in world space rather than camera-relative',
    from: '  const e = cameraMatrixWorld.elements',
    to: '  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]',
  },
  {
    file: LIGHT,
    name: 'the light points away from the viewer (front-facing cap goes dark)',
    from: '  const back = cosElevation * Math.cos(KEY_LIGHT_AZIMUTH)',
    to: '  const back = -cosElevation * Math.cos(KEY_LIGHT_AZIMUTH)',
  },
  {
    file: LIGHT,
    name: 'the two offsets are transposed (LIVE on the first pass — the off-axis angle is symmetric)',
    from: '  const right = cosElevation * Math.sin(KEY_LIGHT_AZIMUTH)\n  const up = Math.sin(KEY_LIGHT_ELEVATION)',
    to: '  const right = Math.cos(KEY_LIGHT_AZIMUTH) * Math.sin(KEY_LIGHT_ELEVATION)\n  const up = Math.sin(KEY_LIGHT_AZIMUTH)',
  },
  {
    file: LIGHT,
    name: 'the off-axis constant is the Euclidean sum of the offsets (0.814, not 0.798)',
    from: 'export const KEY_LIGHT_OFF_AXIS = Math.acos(\n  Math.cos(KEY_LIGHT_ELEVATION) * Math.cos(KEY_LIGHT_AZIMUTH),\n)',
    to: 'export const KEY_LIGHT_OFF_AXIS = Math.hypot(KEY_LIGHT_AZIMUTH, KEY_LIGHT_ELEVATION)',
  },
  {
    file: LOOP,
    name: 'the worlds phase runs before `rig` (LIVE on the first pass — no behavioural row can see it)',
    from: "  'rig',",
    to: "  'worlds',\n  'rig',",
    also: { from: "  'worlds',\n  /** At most one id-buffer read", to: '  /** At most one id-buffer read' },
  },
  {
    file: ATTACH,
    name: 'NEGATIVE CONTROL — the letterbox offset is dropped from the upload',
    from: '              uploadArtLayer(gl, artTexture, layer, source, box)',
    to: '              uploadArtLayer(gl, artTexture, layer, source)',
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
  if (!original.includes(mutant.from) || (mutant.also && !original.includes(mutant.also.from))) {
    console.log(`SKIP  ${mutant.name}\n      site not found in ${mutant.file}`)
    failures += 1
    continue
  }
  let mutated = original.replace(mutant.from, mutant.to)
  if (mutant.also) mutated = mutated.replace(mutant.also.from, mutant.also.to)
  writeFileSync(mutant.file, mutated)
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
