/**
 * Types for `worlds-probe-read.mjs`.
 *
 * > **The payload types are imported from the renderer, not restated here (DEC-744 B1).** A gate
 * > with its own copy of `WorldsProbe` would keep compiling after R1 renamed a field, and the first
 * > thing to notice would be a criterion reading `undefined`. Importing the real declaration makes
 * > that drift a `tsc` error in this leg's own suite.
 *
 * `skipLibCheck` is on in `web/tsconfig.json`, so a mismatch *inside* this file is not reported —
 * only its use from a `.ts` file is. `test/worlds-probe-read.test.ts` therefore constructs a
 * `WorldsProbe` and passes it through every entry point here; that call is the pin, not this import.
 */

import type { WorldsProbe } from '../../src/scene/worlds/worldsProbe'
import type { DecodedPng } from './png-sample.d.mts'
import type { ArtCell, CellSample } from './worlds-metrics.d.mts'

export declare const FIXED24_PX: 24

/** `worlds()` returned `undefined`: no composed world, so no measurement was taken. */
export interface ProbeAbsent {
  readonly ok: false
  readonly reason: 'absent'
  readonly detail: string
  readonly checked: 0
  readonly faults: readonly string[]
}

/** Something came back and it is not the published shape — the two sides have drifted. */
export interface ProbeMalformed {
  readonly ok: false
  readonly reason: 'malformed'
  readonly detail: string
  /** How many checks ran. An audit that cannot state its denominator has not audited anything. */
  readonly checked: number
  readonly faults: readonly string[]
}

export interface ProbeOk {
  readonly ok: true
  readonly probe: WorldsProbe
  readonly checked: number
  readonly faults: readonly []
}

export type ProbeRead = ProbeOk | ProbeMalformed | ProbeAbsent

export interface ReadOptions {
  /** The capture's own dimensions. Mismatch puts every colour sample on the wrong pixel. */
  readonly expectedViewport?: { readonly width: number; readonly height: number } | null
}

export declare function readWorldsProbe(raw: unknown, options?: ReadOptions): ProbeRead

export interface CellCardinality {
  readonly cardCount: number
  readonly reported: number
  /** Cards the payload did not report — cells inside the near plane. Invisible without this count. */
  readonly dropped: number
  readonly inRange: boolean
  readonly complete: boolean
}

export declare function cellCardinality(probe: WorldsProbe, cardCount: number): CellCardinality

export interface CellSampling {
  readonly samples: readonly CellSample[]
  /** Cells whose projected centre fell outside the capture, excluded rather than clamped. */
  readonly offFrame: readonly number[]
}

export declare function cellSamples(
  probe: WorldsProbe,
  image: DecodedPng,
  options?: { readonly scale?: number },
): CellSampling

/** A cell's centre pixel and the ring just outside its rect. See the implementation. */
export interface CellContrastSamples {
  readonly centre: [number, number, number]
  readonly surround: ReadonlyArray<[number, number, number]>
}

export declare function cellContrastSamples(
  cell: WorldsProbe['cells'][number],
  image: DecodedPng,
  options?: { scale?: number },
): CellContrastSamples | null

/** The shader name the draw-blank control suppresses. Cross-checked against `shaderNames.ts`. */
export declare const BLANK_CELL_DRAW_PROGRAM: string

/** A page init script that suppresses one program's draws and counts them in `window.__blankedCellDraws`. */
export declare function blankCellDrawScript(program?: string): string

export declare function artCells(probe: WorldsProbe): readonly ArtCell[]

/**
 * How strongly the payload witnesses that a control seam engaged.
 *
 * `policy` is a read-back of what the renderer ran; `echo` only proves the query parameter parsed.
 */
export type SeamWitness = 'policy' | 'echo'

export interface SeamEvidence {
  readonly seam: string
  /** The criterion whose row this seam is the control for. */
  readonly criterion: string
  readonly requested: boolean | number | null
  /** The payload's `seams` read-back agrees with what was asked for. */
  readonly echoed: boolean
  readonly witness: SeamWitness
  /** `null` where no policy witness exists — not `false`, which would read as a failed control. */
  readonly policyMoved: boolean | null
  readonly detail: string
  readonly engaged: boolean
}

export declare function seamEvidence(
  probe: WorldsProbe,
  requested: Partial<WorldsProbe['seams']>,
  baseline?: WorldsProbe | null,
): readonly SeamEvidence[]

/**
 * The `&`-prefixed query tail for a row's seams, or `''` when none is set. The write half of the
 * contract {@link seamEvidence} reads back — see the implementation for why it lives beside it
 * rather than in `worlds-gate.mjs`.
 */
export declare function seamQuery(seams: Partial<WorldsProbe['seams']>): string
