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

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { USAGE_EXIT, UsageError, parseArgs } from '../scripts/lib/budget-args.mjs'

/** No `ETERNITIES_DATASET`, so the default is the registry's active dataset. */
const NO_ENV = {}

describe('USAGE_EXIT', () => {
  it('is 2, so a broken invocation is distinguishable from a budget breach (exit 1)', () => {
    expect(USAGE_EXIT).toBe(2)
  })
})

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

const CHECK_BUDGET = fileURLToPath(new URL('../scripts/check-budget.mjs', import.meta.url))

/**
 * The wiring in `check-budget.mjs`'s `main()`: a `UsageError` from `parseArgs` must reach the
 * process as exit `USAGE_EXIT`, with the message on stderr and nothing measured. The `parseArgs`
 * rows above cannot see this — `process.exit(0)` in that `catch` left them all green while
 * `--dataset ""` exited 0 again (mutant D1, DEC-897).
 *
 * Limit of this pattern: spawn only rows that exit during argument parsing. A row that gets past
 * `parseArgs` runs a real budget measurement against whatever `dist/` and dataset are on disk,
 * which is slow and environment-dependent; measurement behaviour is not tested here.
 *
 * `env` is explicit and carries no `ETERNITIES_DATASET`, so the ambient environment cannot change
 * which dataset a row would resolve to.
 */
describe('check-budget.mjs exit code on a malformed command line', () => {
  function run(args: string[]) {
    return spawnSync(process.execPath, [CHECK_BUDGET, ...args], { encoding: 'utf8', env: {} })
  }

  it('exits USAGE_EXIT on --dataset with an empty value', () => {
    const result = run(['--dataset', ''])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/^--dataset needs a value/)
    expect(result.stdout).toBe('')
  })

  it('exits USAGE_EXIT on --dist as the last argument', () => {
    const result = run(['--dataset', 'scale', '--dist'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/^--dist needs a value/)
    expect(result.stdout).toBe('')
  })
})
