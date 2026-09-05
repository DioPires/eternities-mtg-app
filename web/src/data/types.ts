/**
 * Shapes of the Eternities data artefacts. Frozen at Phase 0 — see `docs/data-contract.md`.
 * The Python twin is `pipeline/src/eternities/contract/models.py`.
 */

/**
 * Bumped for any byte-layout, section-id, enum-value or filename change.
 * v2 is amendment A3: star-record byte 7 packs the colour identity into the hue class's
 * spare bits, so a v1 reader of a v2 file sees hue classes as large as 253.
 */
export const CONTRACT_VERSION = 2

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

/**
 * Bit index in the star record's five-bit WUBRG colour identity (PRD 6.6.2, amendment A3).
 *
 * Deliberately the same indices as `HueClass`'s five mono values, so a mono-coloured card
 * satisfies `identity === 1 << hue` and the shader's `uHues` lookup and the filter agree.
 */
export const ColourBit = { White: 0, Blue: 1, Black: 2, Red: 3, Green: 4 } as const
export type ColourBit = (typeof ColourBit)[keyof typeof ColourBit]

/** Byte 7, bits 0-2: the `HueClass`. Seven values, so three bits. */
export const HUE_CLASS_MASK = 0b0000_0111
/** Byte 7, bits 3-7: the five-bit WUBRG identity, read after shifting down. */
export const COLOUR_IDENTITY_SHIFT = 3
export const COLOUR_IDENTITY_MASK = 0b0001_1111

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
  /**
   * Sparse `[starIndex, backFaceName]` pairs for **every** card with a second face, not only the
   * double-faced ones (PRD 4.2.2, 6.5.2): searching "Stomp" must find Bonecrusher Giant and "Ice"
   * must find Fire // Ice, and those are adventure and split cards. A row here says nothing about
   * whether the card has a back image.
   */
  readonly backNames: ReadonlyArray<readonly [StarIndex, string]>
}

/** `[id, setId, rarityChar, imageTs, collectorNumber]` — ordered by release date (PRD 5.6.7). */
export type PrintingTuple = readonly [string, SetId, string, number, string]

/**
 * Every Scryfall `layout` value. Closed on purpose: `l` is this union, and whether a printing
 * derives a back *image* from its own id is read off it — see `hasBackImage` in `./images`, and
 * note that meld's back comes from elsewhere, so layout alone is not the gate. The Python twin is
 * `LAYOUTS` in `pipeline/src/eternities/contract/enums.py`, and the encoder rejects any layout
 * outside this set rather than emitting a URI that would 404.
 *
 * A value list, with the union derived from it, rather than a bare union. The test vector reaches
 * TypeScript through a `JSON.parse(...) as Vector` cast, and a type alone is erased: a layout
 * added to `enums.py` and not here would have passed CI unnoticed, because `hasBackImage` answers
 * `false` for an unknown string and Python would answer `false` too. `test/test-vector.test.ts`
 * compares this array against the vector's `backImageChecks` as a set, so drift is visible in
 * either direction without a hand-maintained count to keep in step.
 */
export const CARD_LAYOUTS = [
  'normal',
  'split',
  'flip',
  'transform',
  'modal_dfc',
  'meld',
  'leveler',
  'class',
  'case',
  'saga',
  'adventure',
  'mutate',
  'prototype',
  'battle',
  'planar',
  'scheme',
  'vanguard',
  'token',
  'double_faced_token',
  'emblem',
  'augment',
  'host',
  'art_series',
  'reversible_card',
  // Added by the Phase 1 first run (2026-09-04), which failed loudly on both per PRD 7.7.2.
  // `prepare` is Secrets of Strixhaven's two-faces-on-one-side layout — like `split`, it has a
  // second face and no back image. `front_card` is a Jumpstart theme card; every set carrying one
  // is `memorabilia`, so 4.3.2 drops it before it can reach a shard.
  'prepare',
  'front_card',
] as const

export type CardLayout = (typeof CARD_LAYOUTS)[number]

/**
 * A card's second face — "there is another face", **not** "there is a back image". Split,
 * adventure and flip cards have one and not the other (contract §9), so `b !== null` is never the
 * test for whether a back image exists.
 *
 * The test is **`cardBackImageUri(card, printing, size) !== null`**, and only that.
 * `hasBackImage(card.l)` is *not* interchangeable with it: it answers the narrower question "does
 * this layout derive a back URI from the printing id", and it is `false` for **meld** (PRD line
 * 125), whose back is a separate Scryfall object reached through the `id`/`ts` below. Both
 * functions are correct; only one is the rendering gate. A card tier that gated the back face on
 * `hasBackImage` would drop every meld back silently — no 404, no error, just a missing face.
 */
export interface CardFaceRecord {
  readonly n: string
  readonly m: string
  readonly t: string
  readonly o: string
  /**
   * Present only on a **meld** back (PRD line 125). The meld result is a separate Scryfall object
   * with its own *front* image, so its URI cannot be derived from the component's printing; these
   * two fields are the only way to reach it. Absent on every other layout.
   */
  readonly id?: string
  /** Cache-busting timestamp for `id`. Present exactly when `id` is. */
  readonly ts?: number
}

export interface CardRecord {
  /** `oracle_id`. */
  readonly u: OracleId
  readonly n: string
  readonly m: string
  readonly t: string
  readonly o: string
  /** The second face, or `null`. See `CardFaceRecord`: this does not imply a back image. */
  readonly b: CardFaceRecord | null
  /** Colour identity letters; `''` is colourless. */
  readonly ci: string
  readonly r: SizeClass
  readonly l: CardLayout
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
