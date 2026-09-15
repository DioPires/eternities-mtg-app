/**
 * PRD 5.8's dimming, end to end on the CPU side: real `stars.bin`, real `evaluateFilters`, real
 * store, real `StarGeometry`.
 *
 * **Why this file exists rather than more cases in `filters.test.ts`.** The filter *rules* were
 * never broken — `filters.test.ts` has proved them since Phase 4. What was broken is that nothing
 * carried the result to the GPU: `setFilterMask` and `clearFilter` had test callers only, so
 * `FILTER_DIM` and the star shader's `vPickable` gate were dead code and a filter changed the chip
 * count and nothing on screen (review §5.2 F1). A test that evaluates a filter and inspects the
 * evaluation cannot see that. So this one drives the *seam*: `bindFilterMask`, the real store, and
 * a geometry it then reads back through `passesFilter` and through the `aFilter` attribute itself.
 *
 * `bindFilterMask` is a plain function for exactly this reason (`src/app/filterMask.ts` says so):
 * the vitest environment here is `node` and only `.test.ts` is collected, so there is no React
 * renderer to reach for, and a hook-shaped fix would have been untestable at the level the bug
 * lived at.
 *
 * Three things are asserted, and they are different things:
 *
 *  1. **the byte.** `aFilter` is a *normalised* uint8 attribute, so a passing star has to be
 *     `FILTER_MASK_PASS`, not merely non-zero. The two halves shipped disagreeing — the producer
 *     wrote `1`, the buffer initialised to `255` — and `passesFilter`'s `!== 0` cannot tell them
 *     apart. Uploaded as it stood, every passing star would have read `1/255` in the shader:
 *     dimmed to `FILTER_DIM` and discarded by the pickable gate. `passesFilter` alone would have
 *     called that a pass. The byte assertion is the one that catches it.
 *  2. **the subscription**, including the bind-time apply a deep link with filters needs, and the
 *     unsubscribe.
 *  3. **the call site.** A source scan, because the defect *was* an absent call site and nothing
 *     about the behaviour above requires the app to contain the call. Blind spots named below.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { InterleavedBufferAttribute } from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyFilterMask, bindFilterMask } from '../src/app/filterMask'
import {
  BINARY_HEADER_BYTES,
  COLOUR_LETTER_BIT,
  FILTER_MASK_PASS,
  decodeStars,
  type Stars,
} from '../src/data'
import { evaluateFilters, type FilterEvaluation } from '../src/filters/evaluate'
import { EMPTY_FILTERS, type FilterState } from '../src/filters/types'
import { STAR_VERTEX_SHADER } from '../src/scene/starfield/shaders'
import { StarGeometry } from '../src/scene/starfield/starGeometry'
import { useStore } from '../src/store/store'
import { fixturePath } from './fixtures'

const FILE = new Uint8Array(readFileSync(fixturePath('small', 'stars.bin')))
const BODY = FILE.subarray(BINARY_HEADER_BYTES)
const STARS: Stars = decodeStars(
  FILE.buffer.slice(FILE.byteOffset, FILE.byteOffset + FILE.byteLength),
)

const NO_SETS = { setIds: [] as number[], sets: null }
const WHITE = 1 << COLOUR_LETTER_BIT.W

function filters(patch: Partial<FilterState>): FilterState {
  return { ...EMPTY_FILTERS, ...patch }
}

/** A geometry holding the whole fixture, as the scene has it once `stars.bin` lands. */
function loadedGeometry(): StarGeometry {
  const geometry = new StarGeometry(STARS.count)
  geometry.append(BODY, STARS.count)
  return geometry
}

/**
 * The attribute the filter mask travels in.
 *
 * **`aClass.w` since DEC-739, where it used to be an `aFilter` attribute of its own.** The mask is
 * now the fourth lane of the repacked class vector — review §3.5's 16-byte aligned repack folded
 * the two stride-1 mask attributes into the spare lanes of the two `u8x4` vectors, because a stride
 * of one is the worst-aligned thing in the old layout and ANGLE repacks the buffer on the CPU for
 * it. The *contract* this file is about is unchanged: a passing star is `FILTER_MASK_PASS` and a
 * dimmed one is 0, wherever the byte sits.
 */
function filterAttribute(geometry: StarGeometry): InterleavedBufferAttribute {
  return geometry.geometry.getAttribute('aClass') as InterleavedBufferAttribute
}

/**
 * The filter bytes as the GPU would see them: the `w` lane of every `aClass`, gathered.
 *
 * A gather rather than a view, so every assertion below stays written as `bytes[i]` and keeps
 * reading as "star i's mask byte". The stride arithmetic is done once, here, against the attribute
 * three itself would upload — not against `PACKED_*` constants — so a layout change that moved the
 * lane without moving the constants would still be caught.
 */
function filterBytes(geometry: StarGeometry): Uint8Array {
  const attribute = filterAttribute(geometry)
  const array = attribute.data.array as Uint8Array
  const stride = attribute.data.stride
  const lane = attribute.offset + 3
  const bytes = new Uint8Array(STARS.count)
  for (let i = 0; i < STARS.count; i += 1) bytes[i] = array[i * stride + lane]!
  return bytes
}

function whiteOnly(): FilterEvaluation {
  return evaluateFilters(STARS, filters({ colours: ['W'] }), NO_SETS)
}

beforeEach(() => {
  useStore.getState().setFilterEvaluation(null)
})

describe('the filter mask reaches the geometry (PRD 5.8, review F1)', () => {
  /**
   * If the fixture ever became uniform in colour every assertion below would still pass while
   * proving nothing, so the partition is asserted first rather than assumed.
   */
  it('the fixture partitions under the filter under test', () => {
    const evaluation = whiteOnly()
    expect(evaluation.total).toBe(STARS.count)
    expect(evaluation.matching).toBeGreaterThan(0)
    expect(evaluation.matching).toBeLessThan(evaluation.total)
  })

  it('dims exactly the stars the filter rejects, and passes them as FILTER_MASK_PASS', () => {
    const geometry = loadedGeometry()
    const evaluation = whiteOnly()

    applyFilterMask(geometry, evaluation)

    const bytes = filterBytes(geometry)
    let passed = 0
    for (let i = 0; i < STARS.count; i += 1) {
      // The rule, restated against the record rather than against the mask, so this is a check on
      // the filter and not a tautology: PRD 6.6.2's colour facet is an identity intersection.
      const white = (STARS.colourIdentity(i) & WHITE) !== 0
      expect(geometry.passesFilter(i)).toBe(white)
      // The byte, not just its truthiness. See the header: `!== 0` cannot see the encoding bug.
      expect(bytes[i]).toBe(white ? FILTER_MASK_PASS : 0)
      if (white) passed += 1
    }
    expect(passed).toBe(evaluation.matching)
  })

  /**
   * Something has to turn 255 into 1.0 for {@link FILTER_MASK_PASS} to be the right value at all.
   * If nothing does, 255 stays 255.0 in the shader and PRD 5.8.1's dimming inverts into a 255x
   * brightening — so the constant and whatever divides it are one decision, pinned together.
   *
   * **That job moved in DEC-739 and this test moved with it.** It used to be the attribute's
   * `normalized` flag; the mask now shares a `u8x4` vector with the plane row, the colour byte and
   * the size class, all of which are read as *raw* byte values, and a buffer is normalised or it is
   * not. So the vertex shader divides, and this asserts the division rather than the flag —
   * including asserting the flag is **off**, because a normalised buffer plus the shader's own
   * divide would dim every passing star to 1/255 of itself, which is the original F1 bug rebuilt
   * from the other side.
   */
  it('turns 255 into 1.0 exactly once, in the shader (DEC-739)', () => {
    const attribute = filterAttribute(loadedGeometry())
    expect(attribute.itemSize).toBe(4)
    expect(attribute.normalized).toBe(false)
    // The divide, in the one line of GLSL that reads the lane.
    expect(STAR_VERTEX_SHADER).toContain('float pass = aClass.w * (1.0 / 255.0);')
    // ...and PRD 5.5.3's thumbnail byte, which rides the other vector's spare lane and needs the
    // same treatment for the same reason.
    expect(STAR_VERTEX_SHADER).toContain('(aStyle.w * (1.0 / 255.0))')
    // No *declaration* of either old mask attribute survives. A leftover one would compile to an
    // attribute the geometry no longer supplies, which reads as zeros — every star dimmed to
    // `FILTER_DIM` and unpickable, which is precisely the shape of the F1 bug. Matched as a
    // declaration rather than as a substring because the shader's comments still name the old
    // attributes, and they should: the comment is the record of where the lane came from.
    expect(STAR_VERTEX_SHADER).not.toMatch(/\battribute\s+\w+\s+aFilter\b/)
    expect(STAR_VERTEX_SHADER).not.toMatch(/\battribute\s+\w+\s+aThumb\b/)
  })

  it('a null evaluation clears the filter rather than dimming everything', () => {
    const geometry = loadedGeometry()
    applyFilterMask(geometry, whiteOnly())
    expect(geometry.passesFilter(indexOfDimmed())).toBe(false)

    applyFilterMask(geometry, null)

    const bytes = filterBytes(geometry)
    for (let i = 0; i < STARS.count; i += 1) expect(bytes[i]).toBe(FILTER_MASK_PASS)
  })

  it('an inactive filter passes every star (PRD 6.6: no facets, no dimming)', () => {
    const geometry = loadedGeometry()
    applyFilterMask(geometry, evaluateFilters(STARS, EMPTY_FILTERS, NO_SETS))
    const bytes = filterBytes(geometry)
    for (let i = 0; i < STARS.count; i += 1) expect(bytes[i]).toBe(FILTER_MASK_PASS)
  })

  it('marks the buffer for upload, or the bytes never leave the CPU', () => {
    const geometry = loadedGeometry()
    // The `InterleavedBuffer`, not the attribute: an `InterleavedBufferAttribute` owns no array and
    // no version, and three reads `needsUpdate` off the buffer it is a view into. Setting the flag
    // on the attribute would be writing to an object three never consults — a silent no-upload.
    const buffer = filterAttribute(geometry).data
    buffer.needsUpdate = false
    applyFilterMask(geometry, whiteOnly())
    // three resets `needsUpdate` to false as it uploads and exposes the write as `version`.
    expect(buffer.version).toBeGreaterThan(0)
  })
})

describe('bindFilterMask subscribes the geometry to the store', () => {
  let unbind: (() => void) | null = null

  afterEach(() => {
    unbind?.()
    unbind = null
  })

  it('applies the evaluation the store already holds, for a deep link that carries filters', () => {
    const geometry = loadedGeometry()
    // The order the shell has it in: the URL is parsed and evaluated before the geometry exists.
    useStore.getState().setFilterEvaluation(whiteOnly())

    unbind = bindFilterMask(geometry)

    expect(geometry.passesFilter(indexOfDimmed())).toBe(false)
  })

  it('follows a later filter change, then stops when unbound', () => {
    const geometry = loadedGeometry()
    const dimmed = indexOfDimmed()
    unbind = bindFilterMask(geometry)
    // Nothing evaluated yet: everything is lit.
    expect(geometry.passesFilter(dimmed)).toBe(true)

    useStore.getState().setFilterEvaluation(whiteOnly())
    expect(geometry.passesFilter(dimmed)).toBe(false)

    useStore.getState().setFilterEvaluation(null)
    expect(geometry.passesFilter(dimmed)).toBe(true)

    unbind()
    unbind = null
    useStore.getState().setFilterEvaluation(whiteOnly())
    expect(geometry.passesFilter(dimmed)).toBe(true)
  })

  /**
   * `evaluateFilters` reuses its output buffer, so two evaluations share one `Uint8Array` and only
   * the wrapper object is new. Two things have to hold for that to be safe, and both are here:
   * `bindFilterMask` must compare the wrapper (not the array, which never changes identity), and
   * `setFilterMask` must copy (or the geometry would silently follow the next evaluation).
   */
  it('survives the shared mask buffer: copies on upload, and still sees the change', () => {
    const geometry = loadedGeometry()
    const dimmed = indexOfDimmed()
    unbind = bindFilterMask(geometry)

    const first = whiteOnly()
    useStore.getState().setFilterEvaluation(first)
    expect(geometry.passesFilter(dimmed)).toBe(false)

    const second = evaluateFilters(STARS, EMPTY_FILTERS, NO_SETS, first.mask)
    expect(second.mask).toBe(first.mask) // the buffer really is reused
    useStore.getState().setFilterEvaluation(second)
    expect(geometry.passesFilter(dimmed)).toBe(true)
  })
})

/**
 * The call site, pinned by source scan.
 *
 * Everything above would pass just as green with the `useFilterMask` call deleted from `App.tsx` —
 * which is the exact state the review found the repo in, and no amount of unit testing of
 * `applyFilterMask` can see it. So the two structural facts are asserted directly:
 *
 *  1. `app/filterMask.ts` is the only module that writes to the mask, so there is one path to pin;
 *  2. that path has a caller in `src/` outside its own module.
 *
 * **Named blind spots**, so widening this later shows up as a failing test rather than as a
 * paragraph nobody reread (DEC-654 M1): the scan is textual, so it cannot tell a call inside a
 * live component from one inside a branch that never runs, it would accept a caller in any module
 * rather than specifically `App.tsx`, and an indirect call through an alias is invisible to it.
 * What it does catch is deletion, which is the failure that actually happened.
 */
describe('the call site (review F1: it had test callers only)', () => {
  const sources = sourceFiles()

  it('has exactly one production writer of the filter mask', () => {
    // Two owners of the method name now, and they are not two writers (spec §1.11, DEC-751):
    // `attachWorlds` *forwards* the mask to the surfaces it composed, which is the only way a
    // world built after the last push can arrive dimmed. The producer is still `app/filterMask.ts`
    // alone, and that is what this row is about — anything else appearing here is a second
    // authority for the dimming, which is the defect the file's header describes.
    const writers = sources
      .filter(
        ({ path, text }) =>
          path !== 'scene/starfield/starGeometry.ts' &&
          path !== 'scene/worlds/worldSurface.ts' &&
          path !== 'scene/worlds/attachWorlds.ts' &&
          /\.(setFilterMask|clearFilter)\s*\(/.test(text),
      )
      .map(({ path }) => path)
    expect(writers).toEqual(['app/filterMask.ts'])
  })

  it('and that writer is called from the app', () => {
    const callers = sources
      .filter(
        ({ path, text }) =>
          path !== 'app/filterMask.ts' && /\b(useFilterMask|bindFilterMask)\s*\(/.test(text),
      )
      .map(({ path }) => path)
    expect(callers).not.toHaveLength(0)
    expect(callers).toContain('App.tsx')
  })

  it('and the worlds half is called from the scene', () => {
    // The same deletion guard for §1.11's half, and it is not hypothetical here: DEC-768's F3
    // found that either of `EternitiesScene`'s two worlds wiring lines could be deleted with the
    // whole suite and tsc still green. This is a third line in the same component.
    const callers = sources
      .filter(
        ({ path, text }) =>
          path !== 'app/filterMask.ts' &&
          /\b(useWorldsFilterMask|bindWorldsFilterMask)\s*\(/.test(text),
      )
      .map(({ path }) => path)
    expect(callers).toContain('scene/EternitiesScene.tsx')
  })

  function sourceFiles(): Array<{ path: string; text: string }> {
    const root = fileURLToPath(new URL('../src/', import.meta.url))
    const out: Array<{ path: string; text: string }> = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) {
          out.push({
            path: relative(root, full).replaceAll('\\', '/'),
            text: readFileSync(full, 'utf8'),
          })
        }
      }
    }
    walk(root)
    return out
  }
})

/** A star the white-only filter dims, so the assertions have a definite subject. */
function indexOfDimmed(): number {
  for (let i = 0; i < STARS.count; i += 1) {
    if ((STARS.colourIdentity(i) & WHITE) === 0) return i
  }
  throw new Error('the small fixture has no non-white star; this suite needs one')
}
