/**
 * Types for `budget-args.mjs`.
 */

export interface BudgetArgs {
  /** The dataset the caller asked for: a fixture name, a hash, or `null` for the registry's active one. */
  readonly dataset: string | null
  /** The build directory to measure, relative to `web/`. */
  readonly dist: string
}

export declare const USAGE_EXIT: 2

export declare class UsageError extends Error {
  constructor(message: string)
}

export declare function parseArgs(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
): BudgetArgs
