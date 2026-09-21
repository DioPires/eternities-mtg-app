/**
 * Types for the one binding `worlds-gate.mjs` exports: §3.1's negative-control matrix.
 *
 * The driver is a program and nothing imports it to *run* it — importing the module does not run
 * the gate (see its `process.argv[1]` guard). This declaration exists so the unit suite can read
 * the live rows instead of a hand-written copy of them (DEC-847 item 2): the mirror in
 * `test/worlds-metrics.test.ts` used to guard only itself, so deleting a whole live gate row left
 * that suite green. Types only — no behaviour is described here.
 */

/** One expectation on a row: a criterion, optionally one of its measures, and the colour it must read. */
export interface GateExpectation {
  readonly criterion: string;
  /** Absent where the row asserts the criterion's folded colour rather than one half of it. */
  readonly measure?: string;
  readonly expect: "RED" | "GREEN" | "N/A";
}

/** One row of the matrix, as `--negative-controls` and `--only` select it. */
export interface GateRow {
  readonly id: string;
  readonly label: string;
  /** `true` on the W3 floor derivation pair, which `--negative-controls` excludes. */
  readonly derivation?: boolean;
  readonly expect: readonly GateExpectation[];
}

export const MATRIX: readonly GateRow[];
