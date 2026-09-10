/**
 * The rules `src/scene/shaderNames.ts` states about itself, and the sites that have to obey them.
 *
 * Every failure this guards is silent. A name with a space in it still compiles, still renders and
 * still shows up in a profiler — it just shows up truncated, and only in the tools that read it
 * with `\S+`, so one program ends up with two different names depending on who asked. A duplicated
 * name renders two source sites as one row, which reads exactly like the program cache correctly
 * sharing a program between them. A material built without a name at all is the original defect
 * (DEC-700): it links a program no report can attribute, which is what made a 91 ms link-status
 * stall on Brave unactionable.
 *
 * The site check reads `src/scene/**` as data. That is deliberate rather than lazy: the alternative
 * is constructing each material, and the ones that need a `WebGLRenderer` cannot be built in this
 * environment — so a test covering only the constructible ones would leave exactly the sites most
 * likely to be forgotten unpinned. Naming is a property of the source, so the source is asserted.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SHADER_NAMES } from '../src/scene/shaderNames'

const SCENE_ROOT = fileURLToPath(new URL('../src/scene', import.meta.url))

/** Every `.ts`/`.tsx` file under `src/scene`, recursively, as `[relative path, source]`. */
function sceneSources(directory = SCENE_ROOT, prefix = ''): [string, string][] {
  const found: [string, string][] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...sceneSources(`${directory}/${entry.name}`, relative))
    else if (/\.tsx?$/.test(entry.name)) {
      found.push([relative, readFileSync(`${directory}/${entry.name}`, 'utf8')])
    }
  }
  return found
}

interface Site {
  readonly file: string
  readonly kind: string
  readonly options: string
}

/**
 * Each `new <Something>Material({ … })` in the scene, with its own constructor options.
 *
 * The options are sliced by counting braces from the opening one, not by looking for the next
 * close at a guessed indentation. Brace counting costs three lines and does not care whether a
 * site is written on one line or twelve; the indentation heuristic silently swallows everything up
 * to the *next* material when a site is single-line, and a `name:` belonging to that next call
 * then satisfies the assertion for this one.
 */
function materialSites(sources: [string, string][]): Site[] {
  const sites: Site[] = []
  for (const [file, source] of sources) {
    const pattern = /new ([A-Za-z]*Material)\(\{/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const open = source.indexOf('{', match.index)
      let depth = 0
      let end = open
      for (; end < source.length; end += 1) {
        if (source[end] === '{') depth += 1
        else if (source[end] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      sites.push({ file, kind: match[1]!, options: source.slice(open, end + 1) })
    }
  }
  return sites
}

const SITES = materialSites(sceneSources())

describe('shader names (DEC-700)', () => {
  it('are single tokens, so every reader agrees on where the name ends', () => {
    // three.js emits `#define SHADER_NAME <name>`. The Windows kit reads it back with
    // `/#define[ \t]+SHADER_NAME[ \t]+(\S+)/` (`bench/windows/instrument.mjs`), which stops at the
    // first space — so a name containing one is reported as its first word.
    for (const name of SHADER_NAMES) {
      expect(name, `"${name}" must not contain whitespace`).toMatch(/^\S+$/)
    }
  })

  it('are identifier-shaped, which keeps them dull to a GLSL preprocessor', () => {
    // The name becomes preprocessor replacement text. FXC on ANGLE D3D11 is the reason these names
    // exist at all, and it is the last preprocessor to hand a surprise to.
    for (const name of SHADER_NAMES) {
      expect(name, `"${name}" must be an identifier`).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/)
    }
  })

  it('are unique, so one row in a program list means one source site', () => {
    expect([...new Set(SHADER_NAMES)]).toHaveLength(SHADER_NAMES.length)
  })

  it('finds the material sites it is about to check', () => {
    // Guards the parser, not the product: if `materialSites` silently matched nothing, every
    // assertion below would pass over an empty list and report the scene fully named.
    expect(SITES.length).toBeGreaterThanOrEqual(11)
    expect(new Set(SITES.map((site) => site.kind))).toEqual(
      new Set(['ShaderMaterial', 'MeshBasicMaterial', 'PointsMaterial']),
    )
  })

  it('slices each site\'s own options, not the next site\'s', () => {
    // The failure this pins is specific: a single-line site whose slice runs on into the following
    // material would inherit that one's `name:`. No site's options may contain a second
    // constructor call.
    for (const site of SITES) {
      expect(site.options, `${site.file} ${site.kind}`).not.toMatch(/new [A-Za-z]*Material\(/)
    }
  })

  it('is on every material the scene builds, built-ins included', () => {
    // Not only raw `ShaderMaterial`s: `getParameters` reads `shaderName` from `material.name` for
    // every material type (`three.module.js:20782`), with no fallback to the built-in shader id,
    // so a stock `PointsMaterial` is anonymous in a program list too.
    const unnamed = SITES.filter((site) => !/\bname:/.test(site.options))
    expect(unnamed.map((site) => `${site.file} ${site.kind}`)).toEqual([])
  })

  it('is the only thing those sites use as a name', () => {
    // A literal here instead of a `SHADER_NAME_*` constant would pass the check above while
    // escaping the whitespace and uniqueness rules entirely.
    for (const site of SITES) {
      const assigned = /\bname:\s*([^,\n}]+)/.exec(site.options)?.[1]?.trim()
      expect(assigned, `${site.file} ${site.kind}`).toMatch(/^SHADER_NAME_[A-Z0-9_]+$/)
    }
  })

  it('declares no name it does not use', () => {
    // A name left behind after its material is deleted would sit in the list forever, and the count
    // below would keep passing.
    const declared = [
      ...readFileSync(`${SCENE_ROOT}/shaderNames.ts`, 'utf8').matchAll(
        /^export const (SHADER_NAME_[A-Z0-9_]+)/gm,
      ),
    ].map((match) => match[1]!)
    const used = new Set(
      SITES.map((site) => /\bname:\s*([^,\n}]+)/.exec(site.options)?.[1]?.trim()).filter(Boolean),
    )
    expect(declared.filter((name) => !used.has(name))).toEqual([])
  })

  it('covers every material the scene builds, one name per program', () => {
    // A count, not a list: adding a material and leaving it out of `SHADER_NAMES` should be a
    // deliberate act. There are 11 sites and 11 names — the two `faceMaterial()` *calls* share one
    // name because they share one source, one set of defines, and therefore one program.
    expect(SHADER_NAMES).toHaveLength(11)
  })
})
