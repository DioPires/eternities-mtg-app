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
 * The site check reads `src/**` as data. That is deliberate rather than lazy: the alternative is
 * constructing each material, and the ones that need a `WebGLRenderer` cannot be built in this
 * environment — so a test covering only the constructible ones would leave exactly the sites most
 * likely to be forgotten unpinned. Naming is a property of the source, so the source is asserted.
 *
 * The scan root is the whole of `src`, not `src/scene`. Every material today is under `src/scene`,
 * but "the scene directory is where materials live" is a convention, not a rule the compiler
 * enforces, and a root that stops at it would report a material added one directory over as no
 * material at all — a pass, not a failure.
 *
 * Because this reads source text rather than objects, the parser is the guard: any site it cannot
 * read is a site it cannot vouch for. So an unreadable site fails, and fails loudly, rather than
 * dropping out of the list. A test that skips what it does not understand reports a scene as fully
 * named when the one material it could not parse is the anonymous one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as shaderNames from '../src/scene/shaderNames'
import { SHADER_NAMES } from '../src/scene/shaderNames'

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url))
const SHADER_NAMES_FILE = `${SRC_ROOT}/scene/shaderNames.ts`
const SHADER_NAMES_SOURCE = readFileSync(SHADER_NAMES_FILE, 'utf8')

/** Every `.ts`/`.tsx` file under `src`, recursively, as `[relative path, source]`. */
function sources(directory = SRC_ROOT, prefix = ''): [string, string][] {
  const found: [string, string][] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...sources(`${directory}/${entry.name}`, relative))
    else if (/\.tsx?$/.test(entry.name)) {
      found.push([relative, readFileSync(`${directory}/${entry.name}`, 'utf8')])
    }
  }
  return found
}

interface Site {
  readonly file: string
  readonly kind: string
  /**
   * The site's own `{ … }` argument, or `null` when the construction's argument is not an inline
   * object literal — `new PointsMaterial()`, `new PointsMaterial(opts)`, or `new PointsMaterial`
   * with no argument list at all. A `null` here is a test failure, never a skip.
   */
  readonly options: string | null
}

type ParsedSite = Site & { readonly options: string }

/**
 * Each `new <Something>Material(…)` in `src`, with its own constructor options.
 *
 * The match deliberately stops at the *construction* — tolerating any whitespace after `new`, an
 * optional namespace qualifier, and an optional parenthesised callee — and treats the argument list
 * as optional, rather than requiring `({`. Every character the *regex* insists on is a filter, and
 * each one exempts a spelling that constructs the material just as anonymously:
 *
 * - requiring `{` makes `new PointsMaterial()` and `new PointsMaterial(opts)` no site at all;
 * - requiring even the paren does the same for `new PointsMaterial`;
 * - requiring one literal space exempts `new··PointsMaterial`, a tab, and a line wrap after `new`;
 * - requiring an unqualified callee exempts `new THREE.PointsMaterial`;
 * - requiring no parenthesis around the callee exempts `new (PointsMaterial)(…)`;
 * - requiring a letters-only class name exempts `new My2Material`.
 *
 * All of those are legal TypeScript, and nothing else in this repo rejects any of them: there is no
 * Prettier to normalise them, and `no-multi-spaces`, `no-tabs` and `new-parens` are all absent from
 * `eslint.config.js`. The guard is the only thing that can, so the regex insists on as little as it
 * can. Matching the construction and recording an unreadable argument as `null` moves the decision
 * to an assertion, where it is visible.
 *
 * `\bnew\b` rather than `new\s+` is what makes the whitespace optional without inventing sites: a
 * variable named `newPointsMaterial` is not a construction and must not match, while `new(X)` with
 * no space at all must.
 *
 * The cost is that a `new SomethingMaterial` written in prose in a comment under `src` would now be
 * a phantom site, and would fail. That is the safe direction for this guard, and there are none
 * today.
 *
 * The options are sliced by counting braces from the opening one, not by looking for the next
 * close at a guessed indentation. Brace counting costs three lines and does not care whether a
 * site is written on one line or twelve; the indentation heuristic silently swallows everything up
 * to the *next* material when a site is single-line, and a `name:` belonging to that next call
 * then satisfies the assertion for this one.
 */
function materialSites(files: [string, string][]): Site[] {
  const sites: Site[] = []
  for (const [file, source] of files) {
    const pattern = /\bnew\b\s*\(?\s*(?:[A-Za-z0-9_$]+\s*\.\s*)*([A-Za-z0-9_$]*Material)\b/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      let open = match.index + match[0].length
      const skip = (): void => {
        while (open < source.length && /\s/.test(source[open]!)) open += 1
      }
      skip()
      // A parenthesised callee — `new (PointsMaterial)({ … })` — leaves its close paren between the
      // class name and the argument list. Consuming it is what keeps that spelling a site.
      if (source[open] === ')') {
        open += 1
        skip()
      }
      if (source[open] === '(') {
        open += 1
        skip()
      }
      if (source[open] !== '{') {
        sites.push({ file, kind: match[1]!, options: null })
        continue
      }
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

const SITES = materialSites(sources())
const PARSED: readonly ParsedSite[] = SITES.filter(
  (site): site is ParsedSite => site.options !== null,
)

/** The `SHADER_NAME_*` constants `shaderNames.ts` declares, in declaration order. */
const DECLARED = [
  ...SHADER_NAMES_SOURCE.matchAll(/^export const (SHADER_NAME_[A-Z0-9_]+)/gm),
].map((match) => match[1]!)

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

  it('puts every declared name on the list the rules are enforced against', () => {
    // The three checks above iterate `SHADER_NAMES`, which is hand-maintained. A name declared in
    // `shaderNames.ts`, used at a real site, and left out of that array is subject to none of them:
    // `SHADER_NAME_TWELFTH = 'Two Words'` ships, and the kit reports that program as `Two`.
    //
    // Checked twice, because the two checks miss different things. By value, against the imported
    // module — no parser, so it holds however the file is written. By identifier, against the array
    // literal — which additionally catches a name left off the list whose *value* duplicates one
    // already on it, the case the uniqueness check above cannot see.
    const listed: readonly string[] = SHADER_NAMES
    const unlistedValues = Object.entries(shaderNames)
      .filter(([key]) => /^SHADER_NAME_[A-Z0-9_]+$/.test(key))
      .filter(([, value]) => !listed.includes(String(value)))
      .map(([key, value]) => `${key} = ${String(value)}`)
    expect(unlistedValues, 'declared but missing from SHADER_NAMES').toEqual([])

    const roster = /export const SHADER_NAMES = \[([^\]]*)\]/.exec(SHADER_NAMES_SOURCE)?.[1]
    expect(roster, 'the SHADER_NAMES array literal must stay parseable by this test').toBeDefined()
    const rosterNames = new Set([...roster!.matchAll(/SHADER_NAME_[A-Z0-9_]+/g)].map((m) => m[0]))
    expect(DECLARED.filter((name) => !rosterNames.has(name))).toEqual([])
  })

  it('finds the material sites it is about to check', () => {
    // Guards the parser, not the product: if `materialSites` silently matched nothing, every
    // assertion below would pass over an empty list and report the scene fully named.
    // 17 since DEC-739 added the ladder's cheap glow variant. A `>=` because the number this
    // guards is "the scanner found the sites", not "the scene has exactly this many materials" —
    // but raise it whenever a site is added, or a *replacement* that removed one and added another
    // would leave the total unmoved and this backstop would report nothing (DEC-731).
    expect(SITES.length).toBeGreaterThanOrEqual(17)
    expect(
      new Set(SITES.map((site) => site.kind)),
      'a material class this test has not seen before. If the new class is meant to be here, add ' +
        'it to this set deliberately — that edit is the record that its sites were considered.',
    ).toEqual(new Set(['ShaderMaterial', 'MeshBasicMaterial', 'PointsMaterial']))
  })

  it('can read the options of every site it found', () => {
    // The parser is the guard (see the file header). A call whose argument is not an inline object
    // literal cannot be checked for a name, and the one outcome this test cannot afford is to say
    // nothing about it.
    expect(
      SITES.filter((site) => site.options === null).map((site) => `${site.file} ${site.kind}`),
      'this material is built from a variable or from no arguments, so its name cannot be read ' +
        'here. Give the site an inline `{ name: SHADER_NAME_*, … }` literal, or teach this parser ' +
        'to follow the indirection — do not relax the match to let the site through unchecked.',
    ).toEqual([])
  })

  it("slices each site's own options, not the next site's", () => {
    // The failure this pins is specific: a single-line site whose slice runs on into the following
    // material would inherit that one's `name:`. No site's options may contain a second
    // constructor call.
    for (const site of PARSED) {
      // Kept as wide as the site scanner above deliberately. A slice that overran into a following
      // construction written in any of the spellings the scanner accepts must be reported here too;
      // a narrower regex here would re-create exactly the asymmetry that let those spellings past
      // the scanner in the first place.
      expect(site.options, `${site.file} ${site.kind}`).not.toMatch(
        /\bnew\b[\s(]*(?:[A-Za-z0-9_$]+\s*\.\s*)*[A-Za-z0-9_$]*Material\b/,
      )
    }
  })

  it('is on every material the scene builds, built-ins included', () => {
    // Not only raw `ShaderMaterial`s: `getParameters` reads `shaderName` from `material.name` for
    // every material type (`three.module.js:20782`), with no fallback to the built-in shader id,
    // so a stock `PointsMaterial` is anonymous in a program list too.
    //
    // An unreadable site counts as unnamed here as well as failing the parser check above. It has
    // not been shown to carry a name, and that is the whole question this test asks.
    const unnamed = SITES.filter((site) => site.options === null || !/\bname:/.test(site.options))
    expect(unnamed.map((site) => `${site.file} ${site.kind}`)).toEqual([])
  })

  it('is the only thing those sites use as a name', () => {
    // A literal here instead of a `SHADER_NAME_*` constant would pass the check above while
    // escaping the whitespace and uniqueness rules entirely.
    for (const site of PARSED) {
      const assigned = /\bname:\s*([^,\n}]+)/.exec(site.options)?.[1]?.trim()
      expect(assigned, `${site.file} ${site.kind}`).toMatch(/^SHADER_NAME_[A-Z0-9_]+$/)
    }
  })

  it('declares no name it does not use', () => {
    // A name left behind after its material is deleted would sit in the list forever, and the count
    // below would keep passing.
    const used = new Set(
      PARSED.map((site) => /\bname:\s*([^,\n}]+)/.exec(site.options)?.[1]?.trim()).filter(Boolean),
    )
    expect(DECLARED.filter((name) => !used.has(name))).toEqual([])
  })

  it('covers every material the scene builds, one name per program', () => {
    // A count, not a list: adding a material and leaving it out of `SHADER_NAMES` should be a
    // deliberate act. There are 18 sites and 17 names, and the gap is the point of this test.
    //
    // Two *sites* share `SHADER_NAME_STAR_FIELD`: the drawn star field and the bloom source's copy
    // of it differ only in the values bound to five uniforms, which are not in the program cache
    // key, so three.js links one program for both (DEC-703). A seventeenth name would be a roster
    // row for a program that never exists.
    //
    // The two `faceMaterial()` *calls* also share one name for the same underlying reason, but they
    // do not widen this gap — they are one source site, so the scanner counts them once.
    //
    // **The seventeenth site and sixteenth name are DEC-739's.** The quality ladder's new bottom
    // rung swaps the plane glow for a one-tap, no-dither variant. That variant is a different
    // *fragment source*, so `getProgramCacheKey` gives it a program of its own — unlike the bloom
    // copy above — and it therefore earns a name of its own. A shared name would put one roster row
    // in front of the Windows kit for two programs, reporting whichever linked first.
    //
    // **The eighteenth site and seventeenth name are DEC-749's**: the worlds cell sheet. It is one
    // site and one name for all 45 worlds — two sheets differ only in per-instance attributes and in
    // the value bound to `uRadius`, neither of which is in the program cache key — so it moves both
    // counts by one and leaves the gap where it was.
    expect(SHADER_NAMES).toHaveLength(17)
  })
})
