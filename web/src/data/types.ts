/**
 * Shapes of the Eternities data artefacts. Frozen at Phase 0 — see `docs/data-contract.md`.
 * The Python twin is `pipeline/src/eternities/contract/models.py`.
 */

/** Bumped for any byte-layout, section-id, enum-value or filename change. */
export const CONTRACT_VERSION = 1

export const BINARY_HEADER_BYTES = 16
export const STAR_RECORD_BYTES = 12
export const BINARY_MAGIC = 'ETRN'
/** Amendment A1: every plane's detail file shards at this many cards. */
export const SHARD_SIZE = 2000
/** PRD 8.6.2: plane-local positions live inside this radius. */
export const FRAME_RADIUS = 1.2
export const BLIND_ETERNITIES_SLUG = 'blind-eternities'

export const BinaryKind = { Stars: 1, Sets: 2 } as const
export type BinaryKind = (typeof BinaryKind)[keyof typeof BinaryKind]

/** PRD 5.4.8. A card carries exactly one class; hues are never mixed. */
export const HueClass = {
  White: 0,
  Blue: 1,
  Black: 2,
  Red: 3,
  Green: 4,
  Multicolour: 5,
  Colourless: 6,
} as const
export type HueClass = (typeof HueClass)[keyof typeof HueClass]

/** PRD 5.4.9 and 4.8: `special` maps to rare, `bonus` maps to mythic. */
export const SizeClass = { Common: 0, Uncommon: 1, Rare: 2, Mythic: 3 } as const
export type SizeClass = (typeof SizeClass)[keyof typeof SizeClass]

/** Bit index in the star record's type mask. PRD 6.6.2's eight filterable types. */
export const CardTypeBit = {
  Creature: 0,
  Instant: 1,
  Sorcery: 2,
  Artifact: 3,
  Enchantment: 4,
  Planeswalker: 5,
  Land: 6,
  Battle: 7,
} as const
export type CardTypeBit = (typeof CardTypeBit)[keyof typeof CardTypeBit]

/** Section ids inside `sets.bin`. */
export const SetsSection = { OracleIds: 1, SetCounts: 2, SetEntries: 3 } as const
export type SetsSection = (typeof SetsSection)[keyof typeof SetsSection]

/** PRD 5.3.6 morphology, decided by card count. */
export type PlaneKind = 'dust' | 'spiral' | 'irregular' | 'empty'

export type PlaneSlug = string
export type OracleId = string
export type SetId = number
/** Global 0-based index into `stars.bin` — the join key for every other artefact. */
export type StarIndex = number

export interface Manifest {
  readonly contractVersion: number
  readonly pipelineVersion: string
  readonly dataset: string
  readonly dataHash: string
  readonly asOf: string
  readonly generatedAt: string
  readonly scryfallBulkUpdatedAt: string | null
  readonly starRecordBytes: number
  readonly shardSize: number
  readonly counts: {
    readonly planes: number
    readonly stars: number
    readonly sets: number
    readonly printings: number
    readonly blindEternitiesStars: number
    readonly blindEternitiesShare: number
  }
  readonly planeShards: Readonly<Record<PlaneSlug, number>>
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly bytes: number
    readonly sha256: string
  }>
}

export interface PlaneSetRef {
  readonly id: SetId
  readonly code: string
  readonly name: string
  readonly year: number
  readonly cardCount: number
}

export interface PlaneRecord {
  /** Row in the per-plane `DataTexture` of PRD 8.5.2, and the star record's `planeIndex`. */
  readonly index: number
  readonly slug: PlaneSlug
  readonly displayName: string
  readonly notes: string
  readonly kind: PlaneKind
  readonly cardCount: number
  readonly starOffset: StarIndex
  readonly starCount: number
  readonly shardCount: number
  readonly home: readonly [number, number, number]
  readonly radius: number
  readonly tilt: readonly [number, number, number, number]
  readonly spinPeriodS: number
  readonly spinDirection: number
  readonly driftAmplitude: number
  readonly driftPeriodS: number
  readonly driftPhase: number
  readonly shearAmplitude: number
  readonly shearPeriodS: number
  readonly shearPhase: number
  readonly armPitch: number
  readonly discThickness: number
  readonly bar: boolean
  /** W U B R G multicolour colourless weights, summing to 1 (PRD 5.3.5). */
  readonly palette: readonly number[]
  readonly nebulaTint: readonly [number, number, number]
  readonly firstYear: number | null
  readonly lastYear: number | null
  /** Chronological, and therefore the chronology-band order of PRD 5.4.2. */
  readonly sets: readonly PlaneSetRef[]
}

export interface PlanesFile {
  readonly contractVersion: number
  readonly shardSize: number
  readonly multiverseRadius: number
  readonly discThickness: number
  readonly planes: readonly PlaneRecord[]
}

export interface SearchSetRecord {
  readonly id: SetId
  readonly code: string
  readonly name: string
  readonly year: number
  /** `null` for a reprint-only set: no Appendix B row, no plane (PRD 6.5.4, 6.6.3). */
  readonly planeSlug: PlaneSlug | null
  readonly cardCount: number
}

export interface SearchFile {
  readonly contractVersion: number
  readonly starCount: number
  readonly planes: ReadonlyArray<{
    readonly index: number
    readonly slug: PlaneSlug
    readonly name: string
    readonly cardCount: number
  }>
  readonly sets: readonly SearchSetRecord[]
  /** Index is the star index. */
  readonly cardNames: readonly string[]
  /** Sparse `[starIndex, backFaceName]` pairs for double-faced cards (PRD 4.2.2, 6.5.2). */
  readonly backNames: ReadonlyArray<readonly [StarIndex, string]>
}

/** `[id, setId, rarityChar, imageTs, collectorNumber]` — ordered by release date (PRD 5.6.7). */
export type PrintingTuple = readonly [string, SetId, string, number, string]

export interface CardFaceRecord {
  readonly n: string
  readonly m: string
  readonly t: string
  readonly o: string
}

export interface CardRecord {
  /** `oracle_id`. */
  readonly u: OracleId
  readonly n: string
  readonly m: string
  readonly t: string
  readonly o: string
  readonly b: CardFaceRecord | null
  /** Colour identity letters; `''` is colourless. */
  readonly ci: string
  readonly r: SizeClass
  readonly l: string
  readonly p: readonly PrintingTuple[]
}

export interface PlaneShardFile {
  readonly contractVersion: number
  readonly slug: PlaneSlug
  readonly shard: number
  readonly shardSize: number
  /** Global star index of this shard's local index 0. */
  readonly starOffset: StarIndex
  readonly cards: readonly CardRecord[]
}
