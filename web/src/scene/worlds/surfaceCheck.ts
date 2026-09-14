/**
 * The two N-only constructions of §1.3 — **checks on a published table, never the emitter**.
 *
 * Nothing in the render path may call this module. `rowCells` is shipped (§2.1, §2.4) because it is
 * **not a function of `cardCount`**: the pipeline apportions a row's cells within each colour band
 * and then splits each band's share between sets, so the same N under different hue histograms
 * yields different tables (leg P measured three distinct tables from four compositions at N = 306,
 * 931 and 6,271). A client that reconstructs a cell count is wrong on a dataset it is guaranteed to
 * meet.
 *
 * They are kept, and kept here, for two jobs a test can do and the renderer cannot:
 *
 * - {@link closedFormRowCells} is the form §1.3 argues *from*. It hits `cardCount` exactly at only
 *   **85 of the 7,000** counts in `N = 1...7000`, and **3,487 of them under-allocate** — which
 *   drops cards *silently*, because a dropped card leaves no bare cell for §2.1's "zero bare"
 *   invariant to count. Of v3's 45 worlds it under-allocates 18 and over-allocates 15; 207 cards
 *   would have no cell at all.
 * - {@link apportionRowCells} is the exact-N repair. It holds `sum == N` at every N, and against
 *   the published v3 table it agrees on **rows and dphi 45 of 45** and on counts **to +-1 cell per
 *   row, never more**. That slack is derivation-safe for §1.4 — it gives the identical
 *   `(kLon, kLat)` on 45 of 45 worlds — so it may be used to size geometry or to sanity-check a
 *   table, and never to generate one.
 *
 * This file is the TypeScript half of `docs/worlds/surface-law-check.py`; the two are pinned
 * against each other on the published table in `worlds-surface-law.test.ts`.
 */

import { CELL_ASPECT, rowColatitude, rowStep } from './surfaceLaw'

/**
 * `round()` as §1.3 writes it — **half to even**, which is not what `Math.round` does.
 *
 * > **The two halves of this check disagreed on 1,138 of 7,000 card counts until this existed.**
 * > `Math.round` rounds a half away from zero; Python's `round` — and therefore the pipeline that
 * > emits the table (`pipeline/src/eternities/fixtures/surface.py`), and therefore every figure
 * > §1.3 quotes — rounds a half to even. The spec writes one word, `round`, and the two languages
 * > read it differently on one input in six. Nothing in the render path rounds at all (the client
 * > reads the published table), so this is confined to the checks; but the checks are what license
 * > the claim that the table is right, so they have to agree with the emitter exactly.
 */
function roundHalfToEven(value: number): number {
  const lower = Math.floor(value)
  const excess = value - lower
  if (excess > 0.5) return lower + 1
  if (excess < 0.5) return lower
  return lower % 2 === 0 ? lower : lower + 1
}

/** `rows` and the per-row cell counts, north to south — the shape `rowCells` ships in. */
export interface RowTable {
  readonly rows: number
  readonly cells: readonly number[]
}

/**
 * The row count, which **is** a closed form and **is** normative: `rows = round(PI / sqrt(4*PI /
 * (aspect*N)))`, floored at 1 (§1.3).
 *
 * Only the per-row *counts* are population-derived. The row count and the row latitudes are final,
 * which is what lets the client match a cell to a row at all (§2.1).
 */
export function closedFormRows(cardCount: number): number {
  const seed = Math.sqrt((4 * Math.PI) / (CELL_ASPECT * cardCount))
  return Math.max(1, roundHalfToEven(Math.PI / seed))
}

/**
 * Per-row **independent rounding** — `round(2*PI*sin(theta_r) / (aspect*dphi))` (§1.3).
 *
 * Retained only so §1.3's case can be re-run: this is the construction whose failure is the reason
 * `rowCells` is a contract field. Do not use it for anything else.
 */
export function closedFormRowCells(cardCount: number): RowTable {
  const rows = closedFormRows(cardCount)
  const dphi = rowStep(rows)
  const cells: number[] = []
  for (let row = 0; row < rows; row += 1) {
    const circumference = 2 * Math.PI * Math.sin(rowColatitude(row, rows))
    cells.push(Math.max(1, roundHalfToEven(circumference / (CELL_ASPECT * dphi))))
  }
  return { rows, cells }
}

/**
 * The N-only apportionment: largest fractional remainder over the rows, weighted by row
 * circumference, floored at one cell per row (§1.3).
 *
 * > **There is no symmetry bound here to assert against the shipped table.** A closed surface's
 * > equator-symmetric partition has an even count in every mirrored pair, so it cannot sum to an
 * > arbitrary odd N: exact-N and strict symmetry are incompatible and exact-N wins, because the
 * > alternative is losing cards. *This* form relaxes symmetry minimally — at most one pair, by at
 * > most one cell — but that is a property of this form and is **false of the shipped grid**, which
 * > breaks it on 30 of 45 worlds by design (`_north_first` alternates a mirrored class's odd card
 * > by set-index parity so a large plane's north band does not accumulate ~20 extra cards). A gate
 * > row asserting `<= 2` would be as wrong as `<= 1`, only less often.
 *
 * The tie-break is `min(r, rows-1-r)` then `r` — deterministic, and symmetric about the equator so
 * that the residual does not drift to one hemisphere.
 */
export function apportionRowCells(cardCount: number): RowTable {
  // Never more rows than cards. The clamp documents the floor; it never binds, because
  // `closedFormRows(N) <= N` for every N >= 1.
  const rows = Math.max(1, Math.min(closedFormRows(cardCount), cardCount))
  const dphi = rowStep(rows)
  // The weights are MIRRORED, not computed per row, and that is load-bearing rather than tidy.
  //
  // `sin(theta_r)` and `sin(theta_(rows-1-r))` are equal in exact arithmetic and are NOT equal in
  // doubles: the two arguments differ, so the results land up to ~1.5 ulp apart. On bloomburrow's
  // 18 rows only 3 of the 9 mirrored pairs came out bit-identical. That silently disables the
  // tie-break below — `min(r, rows-1-r)` only ever runs when the fractional remainders TIE, and
  // noise in the last bit means they almost never do, so the residual was being handed out by
  // floating-point accident rather than by the stated rule. It is not even stable across
  // implementations: libm and V8 resolve bloomburrow's rows 4 and 13 in opposite orders, which is
  // exactly how this was found (the TypeScript and Python halves of this check disagreed on one
  // world). Computing each pair once and mirroring it makes every pair tie exactly, so the
  // documented tie-break decides, and both languages agree bit for bit.
  const quota: number[] = new Array<number>(rows)
  let total = 0
  for (let row = 0; row < Math.ceil(rows / 2); row += 1) {
    const weight = Math.sin((row + 0.5) * dphi)
    quota[row] = weight
    quota[rows - 1 - row] = weight
  }
  for (let row = 0; row < rows; row += 1) total += quota[row]!
  for (let row = 0; row < rows; row += 1) quota[row] = (cardCount * quota[row]!) / total

  const cells = quota.map((q) => Math.max(1, Math.floor(q)))
  let residual = cardCount - cells.reduce((sum, n) => sum + n, 0)
  const fraction = (row: number) => quota[row]! - Math.floor(quota[row]!)
  const distanceToEquator = (row: number) => Math.min(row, rows - 1 - row)

  if (residual > 0) {
    const order = rankRows(rows, (a, b) => fraction(b) - fraction(a), distanceToEquator)
    for (let i = 0; residual > 0; i += 1, residual -= 1) cells[order[i % rows]!]! += 1
  } else if (residual < 0) {
    // Reclaim in reverse — smallest remainder first — and never below the floor of one cell.
    const order = rankRows(rows, (a, b) => fraction(a) - fraction(b), distanceToEquator)
    for (let i = 0; residual < 0 && i < rows * cardCount; i += 1) {
      const row = order[i % rows]!
      if (cells[row]! > 1) {
        cells[row]! -= 1
        residual += 1
      }
    }
  }
  return { rows, cells }
}

/** Sort row indices by `primary`, then by distance to the equator, then by index. */
function rankRows(
  rows: number,
  primary: (a: number, b: number) => number,
  distanceToEquator: (row: number) => number,
): number[] {
  const order = Array.from({ length: rows }, (_unused, row) => row)
  order.sort((a, b) => {
    const byPrimary = primary(a, b)
    if (byPrimary !== 0) return byPrimary
    const byEquator = distanceToEquator(a) - distanceToEquator(b)
    return byEquator !== 0 ? byEquator : a - b
  })
  return order
}
