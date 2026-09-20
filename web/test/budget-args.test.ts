/**
 * `check-budget.mjs`'s command line.
 *
 * The payload gate's binding production row is spelled in CI as
 * `--dataset "$(node -p "require('./datasets.json').production")"`, so a failed read there hands the
 * script an empty string rather than nothing at all. Before DEC-892 that fell through to the
 * registry's active dataset, printed a clean pass and exited 0: a green budget job that measured a
 * dataset nobody asked about. `--dist ""` was worse — it resolved to `web/` itself and reported a
 * "built shell" assembled from the source tree.
 *
 * Both rejections are one falsy check, and a falsy check is exactly the kind of line a later
 * simplification deletes. This is the test that turns red when it does.
 */

import { describe, expect, it } from 'vitest'

import { UsageError, parseArgs } from '../scripts/lib/budget-args.mjs'

/** No `ETERNITIES_DATASET`, so the default is the registry's active dataset. */
const NO_ENV = {}

describe('parseArgs', () => {
  it('rejects --dataset with an empty value', () => {
    expect(() => parseArgs(['--dataset', ''], NO_ENV)).toThrow(UsageError)
    expect(() => parseArgs(['--dataset', ''], NO_ENV)).toThrow(/^--dataset needs a value/)
  })

  it('rejects --dataset as the last argument', () => {
    expect(() => parseArgs(['--dataset'], NO_ENV)).toThrow(UsageError)
    expect(() => parseArgs(['--dataset'], NO_ENV)).toThrow(/^--dataset needs a value/)
  })

  it('rejects --dist with an empty value', () => {
    expect(() => parseArgs(['--dist', ''], NO_ENV)).toThrow(UsageError)
    expect(() => parseArgs(['--dist', ''], NO_ENV)).toThrow(/^--dist needs a value/)
  })

  it('rejects --dist as the last argument', () => {
    expect(() => parseArgs(['--dataset', 'scale', '--dist'], NO_ENV)).toThrow(UsageError)
    expect(() => parseArgs(['--dataset', 'scale', '--dist'], NO_ENV)).toThrow(
      /^--dist needs a value/,
    )
  })

  it('passes a named dataset through untouched', () => {
    expect(parseArgs(['--dataset', 'scale'], NO_ENV)).toEqual({ dataset: 'scale', dist: 'dist' })
  })

  it('takes the default dataset when the flag is absent', () => {
    expect(parseArgs([], NO_ENV)).toEqual({ dataset: null, dist: 'dist' })
  })

  /**
   * The ruling of DEC-892, pinned: an *environment variable* that is set but empty falls through to
   * the default rather than erroring, because `vite.config.ts`'s `resolveDataHash` reads it the same
   * way and the build and the measurement of that build have to agree about what one environment
   * means. The flag is the opposite call, deliberately — see the two `--dataset` rows above.
   */
  it('treats an empty ETERNITIES_DATASET as unset, unlike an empty --dataset', () => {
    expect(parseArgs([], { ETERNITIES_DATASET: '' })).toEqual({ dataset: null, dist: 'dist' })
    expect(parseArgs([], { ETERNITIES_DATASET: 'scale' })).toEqual({
      dataset: 'scale',
      dist: 'dist',
    })
  })
})
