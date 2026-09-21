/**
 * Command-line parsing for `check-budget.mjs`, factored out so it can be tested.
 *
 * The guard below protects the binding production row of the PRD 7.2 payload budget, and in
 * `check-budget.mjs` it sat in a file with no exports that calls `main()` at the top level — a
 * module you cannot import without running a budget measurement, and therefore a guard that could
 * be deleted without turning anything red (DEC-893, the review of PR #95). It lives here so
 * `test/budget-args.test.ts` can call it directly.
 *
 * Nothing in here exits. `parseArgs` throws `UsageError` and the caller owns the exit code, so a
 * test can observe the rejection and the script can still `process.exit(USAGE_EXIT)`.
 */

/**
 * Exit code for being *called* wrong, as opposed to a measurement that failed.
 *
 * 2 rather than 1 on purpose: exceeding a PRD 7.2 ceiling is `check-budget.mjs`'s verdict, and a
 * malformed command line is not a verdict at all. CI only asks whether the step was non-zero, but
 * a caller that wants to tell "the payload grew" from "the invocation was broken" now can.
 */
export const USAGE_EXIT = 2

/** The command line was malformed. Distinct from anything thrown while measuring. */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/**
 * A flag the caller typed must have come with a value.
 *
 * `--dataset ""` used to be falsy at `resolveDataDir`, fall through to `registry.active`, print a
 * clean pass and exit 0 — a green budget job measuring a dataset nobody asked for (DEC-892, from
 * the DEC-886 review of PR #91, claim 4). `--dataset` as the final argument took the same path.
 * CI's binding row spells the value `--dataset "$(node -p "require('./datasets.json').production")"`,
 * so a failed read there produces exactly the empty argument this rejects. The shell's `set -e` is
 * the first line of defence; this is the second, and until now there was no second.
 *
 * `--dist` had the same hole in a different shape: `--dist ""` resolved to `web/` itself, walked
 * the source tree and reported a "built shell" assembled from whatever `.js`/`.css`/`.html` sat
 * there — 145.5 KB of source against a real build, and exit 0. `--dist` with no value crashed with
 * an `ERR_INVALID_ARG_TYPE` stack instead of saying which flag was wrong.
 */
function requireValue(flag, value) {
  if (value === undefined || value === '') {
    throw new UsageError(
      `${flag} needs a value (got ${value === undefined ? 'no argument after it' : 'an empty string'}) — ` +
        'refusing to fall back to the default, which would report on something nobody asked about',
    )
  }
  return value
}

/**
 * `ETERNITIES_DATASET=""` is deliberately *not* an error, unlike an empty `--dataset`.
 *
 * Three reasons. `vite.config.ts`'s `resolveDataHash` already reads an empty value as unset, and
 * the build and the measurement of that build must agree about what one environment means — the
 * alternative is `ETERNITIES_DATASET= pnpm build` producing the active dataset and this script
 * then refusing to measure it. An environment variable is ambient rather than typed: empty is the
 * ordinary spelling of absent in shell and CI plumbing, where `unset` and `=""` are routinely
 * indistinguishable. And `ci.yml` only ever sets it to a literal (`ETERNITIES_DATASET: scale` on
 * the `web` job); nothing interpolates it, so no caller is protected by erroring here.
 *
 * `|| null` rather than `?? null` states that at the point of the decision instead of leaving it
 * to a falsy check three functions away.
 *
 * `env` is a parameter so the ruling is testable without mutating `process.env` under a suite that
 * runs files in one process.
 */
export function parseArgs(argv, env = process.env) {
  const args = { dataset: env.ETERNITIES_DATASET || null, dist: 'dist' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dataset') args.dataset = requireValue('--dataset', argv[++i])
    else if (argv[i] === '--dist') args.dist = requireValue('--dist', argv[++i])
  }
  return args
}
