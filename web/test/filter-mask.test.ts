/**
 * PRD 5.8's dimming, end to end on the CPU side: real `stars.bin`, real `evaluateFilters`, real
 * store, and the worlds binding that carries the result to the cell sheets.
 *
 * **Why this file exists rather than more cases in `filters.test.ts`.** The filter *rules* were
 * never broken — `filters.test.ts` has proved them since Phase 4. What was broken is that nothing
 * carried the result to the GPU: a filter changed the chip count and nothing on screen (review §5.2
 * F1). A test that evaluates a filter and inspects the evaluation cannot see that. So this one
 * drives the *seam*: `bindWorldsFilterMask`, the real store, and a target that records what the
 * worlds attachment would be handed. What the attachment does with it — a cell dims when its
 * card's byte is 0 — is `worlds-attach.test.ts`'s subject.
 *
 * **The star field's half is gone (DEC-868).** These rows used to drive `bindFilterMask` into a
 * `StarGeometry` and read the bytes back off its `aClass.w` lane. No mesh has uploaded that lane
 * since the cutover (DEC-752), so the binding and its lane were deleted, and each row that guarded
 * them now guards the same property on the binding that ships.
 *
 * Three things are asserted, and they are different things:
 *
 *  1. **the byte.** A passing card is `FILTER_MASK_PASS`, not merely non-zero, and a dimmed one is
 *     0 — against the rule restated from the record, so this is not the mask checking itself.
 *  2. **the subscription**, including the bind-time apply a deep link with filters needs, the clear,
 *     the shared-buffer change test and the unsubscribe.
 *  3. **the call site.** A source scan, because the defect *was* an absent call site and nothing
 *     about the behaviour above requires the app to contain the call. Blind spots named below.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { bindWorldsFilterMask, type WorldsFilterTarget } from '../src/app/filterMask'
import { COLOUR_LETTER_BIT, FILTER_MASK_PASS, decodeStars, type Stars } from '../src/data'
import { evaluateFilters, type FilterEvaluation } from '../src/filters/evaluate'
import { EMPTY_FILTERS, type FilterState } from '../src/filters/types'
import { useStore } from '../src/store/store'
import { fixturePath } from './fixtures'

const FILE = new Uint8Array(readFileSync(fixturePath('small', 'stars.bin')))
const STARS: Stars = decodeStars(
  FILE.buffer.slice(FILE.byteOffset, FILE.byteOffset + FILE.byteLength),
)

const NO_SETS = { setIds: [] as number[], sets: null }
const WHITE = 1 << COLOUR_LETTER_BIT.W

function filters(patch: Partial<FilterState>): FilterState {
  return { ...EMPTY_FILTERS, ...patch }
}

function whiteOnly(): FilterEvaluation {
  return evaluateFilters(STARS, filters({ colours: ['W'] }), NO_SETS)
}

/**
 * The worlds attachment's filter seam, as a recorder.
 *
 * Each push is **copied** as it lands: `evaluateFilters` reuses its output buffer, so a recorder
 * that kept the reference would see every earlier push rewritten by the latest evaluation and could
 * not tell one push from the next.
 */
function worldsTarget(): WorldsFilterTarget & { pushes: Array<Uint8Array | null> } {
  const pushes: Array<Uint8Array | null> = []
  return {
    pushes,
    setFilterMask: (mask) => pushes.push(mask === null ? null : mask.slice()),
  }
}

/** Whether the latest push leaves star `index` lit: no mask, or a non-zero byte. */
function lit(target: ReturnType<typeof worldsTarget>, index: number): boolean {
  const mask = target.pushes.at(-1)
  if (mask === undefined) throw new Error('nothing was pushed at the worlds attachment')
  return mask === null || mask[index] !== 0
}

let unbind: (() => void) | null = null

beforeEach(() => {
  useStore.getState().setFilterEvaluation(null)
})

afterEach(() => {
  unbind?.()
  unbind = null
})

describe('the filter mask reaches the worlds attachment (PRD 5.8, review F1)', () => {
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

  it('dims exactly the cards the filter rejects, and passes them as FILTER_MASK_PASS', () => {
    const target = worldsTarget()
    unbind = bindWorldsFilterMask(target)
    const evaluation = whiteOnly()
    useStore.getState().setFilterEvaluation(evaluation)

    const bytes = target.pushes.at(-1)
    expect(bytes, 'a filter is a mask, not a clear').toBeInstanceOf(Uint8Array)
    expect(bytes).toHaveLength(STARS.count)
    let passed = 0
    for (let i = 0; i < STARS.count; i += 1) {
      // The rule, restated against the record rather than against the mask, so this is a check on
      // the binding and not a tautology: PRD 6.6.2's colour facet is an identity intersection.
      const white = (STARS.colourIdentity(i) & WHITE) !== 0
      expect(bytes![i]).toBe(white ? FILTER_MASK_PASS : 0)
      if (white) passed += 1
    }
    expect(passed).toBe(evaluation.matching)
  })

  it('a null evaluation clears the filter rather than dimming everything', () => {
    const target = worldsTarget()
    unbind = bindWorldsFilterMask(target)
    useStore.getState().setFilterEvaluation(whiteOnly())
    expect(lit(target, indexOfDimmed())).toBe(false)

    useStore.getState().setFilterEvaluation(null)

    // `null`, not an all-zero mask: the attachment reads a 0 byte as "dimmed", so a clear that
    // arrived as zeros would dim every card on every world.
    expect(target.pushes.at(-1)).toBeNull()
  })

  it('an inactive filter passes every card (PRD 6.6: no facets, no dimming)', () => {
    const target = worldsTarget()
    unbind = bindWorldsFilterMask(target)
    useStore.getState().setFilterEvaluation(evaluateFilters(STARS, EMPTY_FILTERS, NO_SETS))
    const bytes = target.pushes.at(-1)!
    for (let i = 0; i < STARS.count; i += 1) expect(bytes[i]).toBe(FILTER_MASK_PASS)
  })
})

describe('bindWorldsFilterMask subscribes the attachment to the store', () => {
  it('applies the evaluation the store already holds, for a deep link that carries filters', () => {
    const target = worldsTarget()
    // The order the shell has it in: the URL is parsed and evaluated before the scene attaches.
    useStore.getState().setFilterEvaluation(whiteOnly())

    unbind = bindWorldsFilterMask(target)

    expect(target.pushes, 'one push, at bind time').toHaveLength(1)
    expect(lit(target, indexOfDimmed())).toBe(false)
  })

  it('follows a later filter change, then stops when unbound', () => {
    const target = worldsTarget()
    const dimmed = indexOfDimmed()
    unbind = bindWorldsFilterMask(target)
    // Nothing evaluated yet: everything is lit.
    expect(lit(target, dimmed)).toBe(true)

    useStore.getState().setFilterEvaluation(whiteOnly())
    expect(lit(target, dimmed)).toBe(false)

    useStore.getState().setFilterEvaluation(null)
    expect(lit(target, dimmed)).toBe(true)

    unbind()
    unbind = null
    const before = target.pushes.length
    useStore.getState().setFilterEvaluation(whiteOnly())
    expect(target.pushes, 'unbound, so nothing more arrives').toHaveLength(before)
  })

  /**
   * `evaluateFilters` reuses its output buffer, so two evaluations share one `Uint8Array` and only
   * the wrapper object is new. The binding must compare the wrapper — comparing the array would
   * never see the second evaluation, and the cells would stay dimmed after the filter was relaxed.
   */
  it('survives the shared mask buffer: still sees the change', () => {
    const target = worldsTarget()
    const dimmed = indexOfDimmed()
    unbind = bindWorldsFilterMask(target)

    const first = whiteOnly()
    useStore.getState().setFilterEvaluation(first)
    expect(lit(target, dimmed)).toBe(false)

    const second = evaluateFilters(STARS, EMPTY_FILTERS, NO_SETS, first.mask)
    expect(second.mask).toBe(first.mask) // the buffer really is reused
    useStore.getState().setFilterEvaluation(second)
    expect(lit(target, dimmed)).toBe(true)
  })
})

/**
 * The call site, pinned by source scan.
 *
 * Everything above would pass just as green with the `useWorldsFilterMask` call deleted from
 * `EternitiesScene.tsx` — the shape of the state the review found the repo in, and no amount of
 * unit testing of the binding can see it. So the two structural facts are asserted directly:
 *
 *  1. `app/filterMask.ts` is the only module that writes to the mask, so there is one path to pin;
 *  2. that path has a caller in `src/` outside its own module.
 *
 * **Named blind spots**, so widening this later shows up as a failing test rather than as a
 * paragraph nobody reread (DEC-654 M1): the scan is textual, so it cannot tell a call inside a
 * live component from one inside a branch that never runs, and an indirect call through an alias is
 * invisible to it. What it does catch is deletion, which is the failure that actually happened.
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
          path !== 'scene/worlds/worldSurface.ts' &&
          path !== 'scene/worlds/attachWorlds.ts' &&
          /\.(setFilterMask|clearFilter)\s*\(/.test(text),
      )
      .map(({ path }) => path)
    expect(writers).toEqual(['app/filterMask.ts'])
  })

  it('and that writer is called from the scene', () => {
    // Not hypothetical: DEC-768's F3 found that either of `EternitiesScene`'s two worlds wiring
    // lines could be deleted with the whole suite and tsc still green. This is a third line in the
    // same component — and since DEC-868 the only one that carries the dimming anywhere.
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
