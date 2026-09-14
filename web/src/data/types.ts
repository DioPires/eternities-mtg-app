/**
 * Shapes of the Eternities data artefacts. Frozen at Phase 0 — see `docs/data-contract.md`.
 * The Python twin is `pipeline/src/eternities/contract/models.py`.
 */

/**
 * Bumped for any byte-layout, section-id, enum-value or filename change. This is the version this
 * build *writes* and prefers; {@link READABLE_CONTRACT_VERSIONS} is what it accepts.
 *
 * v2 is amendment A3: star-record byte 7 packs the colour identity into the hue class's spare
 * bits, so a v1 reader of a v2 file sees hue classes as large as 253.
 *
 * v3 is concept B "worlds" (`docs/worlds/spec.md` §2): `stars.bin` keeps its 12 bytes and changes
 * what bytes 0-5 *mean* — a unit-sphere cell centre rather than a plane-local spiral position —
 * `swatches.bin` arrives, the printing tuple gains an `artist`, and `planes.json` trades seven
 * spiral fields for `rowCells`.
 */
export const CONTRACT_VERSION = 3

/**
 * Every contract version this build can decode.
 *
 * **Both, and this is load-bearing, not laxity.** Worlds spec §2 publishes a v3 dataset beside the
 * v2 one and deliberately does *not* move `datasets.json`'s `active`, so that the galaxy build
 * keeps fetching the dataset it already fetches and the v3 publish carries zero deploy risk. That
 * argument is only true if a build that speaks v3 still *reads* v2 — a single-version check would
 * make the very first v3 commit reject the dataset the deployed app is pointed at.
 *
 * The pair is not permanent: it closes when the galaxy retires (§3.2). Until then, a consumer that
 * needs a v3-only field must check for the field, not the version — `rowCells` is the one that
 * matters, and `planes.json` omits it on exactly the planes that have no grid.
 */
export const READABLE_CONTRACT_VERSIONS: ReadonlySet<number> = new Set([2, 3])

export const BINARY_HEADER_BYTES = 16
export const STAR_RECORD_BYTES = 12
/** `swatches.bin`: four uint16 RGB565 samples, the card's art downsampled to 2x2 (§2.2). */
export const SWATCH_RECORD_BYTES = 8
export const BINARY_MAGIC = 'ETRN'
/** Amendment A1: every plane's detail file shards at this many cards. */
export const SHARD_SIZE = 2000
/** PRD 8.6.2: plane-local positions live inside this radius. */
export const FRAME_RADIUS = 1.2
export const BLIND_ETERNITIES_SLUG = 'blind-eternities'

/**
 * A plane that has a surface: `rowCells` present, which §2.4 makes the field to test for.
 *
 * Testing `rowCells` rather than the contract version is deliberate and is the contract's own
 * wording: an empty plane and the belt carry no grid at all and are absent from this set on a v3
 * dataset, so a version check would admit 43 planes that have no surface to build. On a v2 dataset
 * the set is empty, which is what makes it usable as the "is this page on worlds" question
 * (`labels/PlaneLabels.tsx`, worlds spec §1.11) without a version constant anywhere.
 *
 * It lives here rather than with the renderer because two paths need it and one of them is
 * deliberately three-free: `scene/worlds/worldSource.ts` re-exports it for the renderer's callers.
 */
export type WorldPlane = PlaneRecord & { readonly rowCells: readonly number[] }

export function isWorldPlane(plane: PlaneRecord): plane is WorldPlane {
  return Array.isArray(plane.rowCells) && plane.rowCells.length > 0
}

/**
 * PRD 5.8/8.5.1's filter mask byte for a star that passes, on both sides of the GPU boundary.
 *
 * It lives here, in the contract module, because it is a contract between two files that never
 * import each other: `filters/evaluate.ts` writes the mask and `scene/starfield/starGeometry.ts`
 * uploads it as a **normalised** `uint8` vertex attribute, where the shader reads `1.0` for a pass
 * and gates picking on `aFilter > 0.5` (`starfield/shaders.ts`). The two halves shipped with
 * different encodings — the producer wrote `1`, the buffer was initialised to `255` — and because
 * the mask had no production consumer nothing ever compared them. Uploaded as it was, a passing
 * star would have read `1/255 = 0.004`: dimmed to `FILTER_DIM` and discarded by the pickable gate,
 * i.e. the whole field invisible and unclickable. One constant, so they cannot drift again.
 */
export const FILTER_MASK_PASS = 255

/*
 * ---------------------------------------------------------------------------------------------
 * The **client-side** repack of the star record (DEC-739, review §3.5).
 *
 * > Repack the star record client-side into a 16-byte aligned buffer (position 3x half + pad, class
 * > 3x u8, style 3x u8, filter u8, thumb u8) so ANGLE/D3D11 does not repack the current 12-byte
 * > record with byte attributes at offsets 6 and 9; the data contract does not change.
 *
 * **Nothing above this block moves.** `stars.bin` is still 12-byte records, `STAR_RECORD_BYTES` is
 * still 12, and `decodeStars` still reads them. What changes is only the layout
 * `scene/starfield/starGeometry.ts` uploads, which used to be the on-disk record *as-is* plus three
 * side buffers. The constants live here beside the record they are a repack of, so the two layouts
 * can be read against each other in one file.
 *
 * **Why alignment is the whole point.** D3D11 requires a vertex element's offset within its stride
 * to be a multiple of four, and the stride itself to be a multiple of four. The shipped layout
 * breaks that in four places at once: `aClass` at offset 6, `aStyle` at offset 9, the half-float
 * positions at a stride of 6, and the filter and thumbnail masks at a stride of 1. ANGLE's response
 * is not to fail but to **repack every buffer on the CPU** on its way to the GPU — and the star
 * buffer is `DynamicDrawUsage`, written by `bufferSubData` once per plane as `stars.bin` streams, so
 * that cost is paid 87 times during load on exactly the integrated-GPU Windows laptops review §9 is
 * about. It is invisible on Metal, which is where every measurement was taken.
 *
 * **The two buffers, and why it is two and not one.** three derives a vertex attribute's GL type
 * from the array backing its buffer, so one `InterleavedBuffer` is one type — there is no way to
 * express half-floats and bytes in a single three buffer. So the repack is two buffers whose
 * strides are both powers of two and whose every offset is a multiple of four:
 *
 *   - positions, 4 x half = **8 bytes** (xyz + one pad half, which is what makes the stride 8
 *     rather than an unaligned 6);
 *   - the byte attributes, 2 x u8x4 = **8 bytes** — `aClass` as (planeIndex, colourByte, sizeClass,
 *     filter) at offset 0 and `aStyle` as (brightness, twinklePhase, typeMask, thumb) at offset 4.
 *
 * Sixteen bytes a star in total, which is the review's number, and **less** than the 20 the shipped
 * layout uploads (12 + 6 + 1 + 1). The filter and thumbnail masks are folded into the spare fourth
 * component of the two byte attributes rather than kept as stride-1 attributes of their own: a
 * stride of one is the worst-aligned thing in the old layout, and the two vectors had a free lane
 * each.
 * ---------------------------------------------------------------------------------------------
 */

/** Bytes per star in the repacked **position** buffer: xyz as half floats, plus one pad half. */
export const PACKED_POSITION_HALVES = 4

/** Bytes per star in the repacked **byte-attribute** buffer: two `u8x4` vectors. */
export const PACKED_ATTRIBUTE_BYTES = 8

/** `aClass` — (planeIndex, colourByte, sizeClass, filter). Offset 0, so four-byte aligned. */
export const PACKED_CLASS_OFFSET = 0

/** `aStyle` — (brightness, twinklePhase, typeMask, thumbnailPresent). Offset 4, likewise aligned. */
export const PACKED_STYLE_OFFSET = 4

/** Where PRD 5.8's filter mask sits inside `aClass`: its `w` lane. */
export const PACKED_FILTER_LANE = PACKED_CLASS_OFFSET + 3

/** Where PRD 5.5.1's "thumbnail is in the atlas" byte sits inside `aStyle`: its `w` lane. */
export const PACKED_THUMB_LANE = PACKED_STYLE_OFFSET + 3

export const BinaryKind = { Stars: 1, Sets: 2, Swatches: 3 } as const
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
  /**
   * v2 only — `shearAmplitude`/`PeriodS`/`Phase`, `armPitch`, `discThickness` and `bar` are laws of
   * a spiral disc and retire with it (worlds spec §2.4). Optional rather than removed for the
   * length of the dual-scene period: the galaxy renderer reads them and is still pointed at a v2
   * dataset, and a v3 dataset simply does not carry them.
   */
  readonly shearAmplitude?: number
  readonly shearPeriodS?: number
  readonly shearPhase?: number
  readonly armPitch?: number
  readonly discThickness?: number
  readonly bar?: boolean
  /**
   * v3 (§2.4): the surface grid's per-row cell counts, north to south.
   *
   * `rowCells.length` is the row count; row latitudes are equal-angle with `dphi = PI / rows` and
   * centres at `(i + 1/2) * dphi`, so the only derivation left on this side is matching a cell to
   * its row by nearest colatitude — **nearest, never `floor()`** (§2.1).
   *
   * Shipped rather than derived because §1.3's relaxation makes the counts population-derived: the
   * closed form no longer describes the shipped grid. Absent on an empty plane and on the belt,
   * which have no grid at all — so this is the field to test for, not the contract version.
   */
  readonly rowCells?: readonly number[]
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
  /** v2 only: the top-level disc thickness retires with the spiral disc (§2.4). */
  readonly discThickness?: number
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

/**
 * `[id, setId, rarityChar, imageTs, collectorNumber, artist?]` — ordered by release date
 * (PRD 5.6.7), so index 0 is the earliest-released printing.
 *
 * The sixth element is contract v3 (§2.3) and is optional only because a v2 shard has five. It is
 * inline rather than an id into a dictionary because the only sensible home for a dictionary is
 * `search.json`, which is half of the 95%-full `search.json` + `sets.bin` pair, while the shards
 * have 4.4x headroom.
 *
 * It is in the contract at all because concept B shows tens of thousands of art crops with no card
 * in sight, so the app stops satisfying the alternative clause of Scryfall's terms that the
 * focused-card planets satisfy today: show the artist and the copyright, *or* show the full card
 * alongside. Index 0's artist is the credit for the art a cell draws.
 */
export type PrintingTuple =
  | readonly [string, SetId, string, number, string]
  | readonly [string, SetId, string, number, string, string]

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
