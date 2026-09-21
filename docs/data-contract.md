# Eternities — data contract v2

**Status:** frozen at Phase 0. Any change is a reviewed contract change (implementation plan §2 Phase 0, risk 2).
**Authority:** PRD `prd_v3.md` §8.3, §7.2, §8.6, §8.7, §8.8, as amended by A1 and A3 (implementation-plan.md §8).
**Implementations that must stay in lockstep:**

| Side | Path |
|---|---|
| Python encoder | `pipeline/src/eternities/contract/` |
| TypeScript decoder | `web/src/data/` |
| Shared byte-level test vector | `contract/test-vectors/v2/` |

The test vector is the arbiter. `pipeline/tests/test_test_vector.py` and `web/test/test-vector.test.ts` both assert against the same committed bytes, so a one-sided change fails CI.

---

## 1. Directory and immutability

All artefacts of one pipeline run live in a single content-hashed directory:

```
web/public/data/<dataHash>/
  manifest.json
  planes.json
  stars.bin
  swatches.bin          # contract v3 only (§5.1)
  search.json
  sets.bin
  planes/<slug>.<n>.json
```

- `dataHash` is 16 lowercase hex characters. It is `sha256` over the newline-joined, path-sorted list of `"<relative path> <sha256 of file>"` for every artefact **except** `manifest.json`, truncated to the first 8 bytes. `manifest.json` is excluded because it carries the hash.
- The directory is immutable (PRD 7.4.4, 8.8.2). `/data/**` is served `Cache-Control: public, max-age=31536000, immutable`.
- `index.html` learns the active directory at build time (§9).
- Every path inside `planes/` uses `/` and is relative to the data directory.

## 2. Shared conventions

- **Byte order:** little-endian everywhere, except raw UUID bytes (§6.1), which are stored in RFC 4122 network order — the order they are printed in.
- **Binary header:** every `.bin` artefact starts with the same 16-byte header.

| Offset | Type | Field |
|---|---|---|
| 0 | `uint8[4]` | magic `E T R N` (`0x45 0x54 0x52 0x4E`) |
| 4 | `uint8` | kind: `1` = stars, `2` = sets, `3` = swatches (v3, §5.1) |
| 5 | `uint8` | `contractVersion` = `3`. A build **writes** one version and **reads** a set of them: v3 readers accept v2 as well, for the reason in §11's v3 entry |
| 6 | `uint16` | flags (see per-file notes; `0` today) |
| 8 | `uint32` | `recordCount` |
| 12 | `uint32` | reserved, `0` |

  16 bytes keeps the first record 4-byte aligned, so a decoder may create typed-array views directly over the received `ArrayBuffer` with no copy.

- **Enumerations** (used by the star record, `search.json`, and plane detail files):

| Name | Values |
|---|---|
| hue class | `0` W, `1` U, `2` B, `3` R, `4` G, `5` multicolour, `6` colourless |
| colour identity bit | `0` W, `1` U, `2` B, `3` R, `4` G — a five-bit mask, so `WU` is `0b00011` (PRD 6.6.2, amendment A3). The same indices as the five mono hue classes, so a mono card satisfies `mask == 1 << hueClass`. In the star record it shares byte 7 with the hue class; see §5 |
| size class (rarity) | `0` common, `1` uncommon, `2` rare, `3` mythic — PRD 4.8: `special` → rare, `bonus` → mythic |
| card-type bit | `0` creature, `1` instant, `2` sorcery, `3` artifact, `4` enchantment, `5` planeswalker, `6` land, `7` battle (PRD 6.6.2) |
| plane kind | `dust`, `spiral` (≥ 50 cards), `irregular` (1–49), `empty` (0) — PRD 5.3.6 |

- **Star index** is the global 0-based index of a card's record in `stars.bin`. It is the join key for every other artefact. Records are ordered by plane index, then chronology band, then arm (PRD 8.3), so each plane owns a **contiguous** range `[starOffset, starOffset + starCount)`. Nothing stores a per-card plane id; it is recovered from the range.

## 3. `manifest.json`

Loaded first (PRD 8.7.2). Small, human-diffable, the single source of truth for what a run produced.

```jsonc
{
  "contractVersion": 2,
  "pipelineVersion": "0.4.0",   // 0.3.0 is the first version in which `previousRun` may appear
  "dataset": "production" | "fixture-small" | "fixture-scale",
  "dataHash": "b3f0c1d2e3f40506",
  "asOf": "2026-09-04",                    // PRD 4.9.1 run date
  "generatedAt": "2026-09-04T00:00:00Z",
  "scryfallBulkUpdatedAt": "2026-09-03T09:00:00Z" | null,
  "previousRun": "a1b2c3d4e5f60718",  // optional; absent when there is no predecessor
  "starRecordBytes": 12,
  "shardSize": 2000,                        // A1: every plane shards at this size
  "counts": {
    "planes": 82, "stars": 30000, "sets": 412, "printings": 74210,
    "blindEternitiesStars": 6400, "blindEternitiesShare": 0.2133
  },
  "planeShards": { "dominaria": 5, "blind-eternities": 4, "…": 1 },
  "files": [{ "path": "stars.bin", "bytes": 360016, "sha256": "…64 hex…" }]
}
```

`files` covers every artefact except `manifest.json`, sorted by path. `planeShards` gives the loader the shard count per plane without a probe request; a zero-card plane has `1` (an empty shard file is still emitted, so the loader has no special case).

`previousRun` is **optional** and carries the `dataHash` of the run this one's PRD 4.9.2 plane diff was taken against. It is omitted, not written as `null`, when there is no predecessor — a fixture, or a first production run — so a decoder must treat it as absent-by-default. Nothing in the app reads it; it is provenance, so the committed run report is still reproducible once PRD 8.8.3 deletes the superseded directory.

## 4. `planes.json`

Loaded first, with `manifest.json`. Drives plane glows, labels, and the per-plane `DataTexture` of PRD 8.5.2.

```jsonc
{
  "contractVersion": 3,
  "shardSize": 2000,
  "multiverseRadius": 100.0,       // R of PRD 8.6.1
  "planes": [{
    "index": 0,                     // == planeIndex in the star record; == row in the DataTexture
    "slug": "blind-eternities",
    "displayName": "Blind Eternities",
    "notes": "Catch-all; rendered as dust (5.3.4)",
    "kind": "dust",
    "cardCount": 6400,
    "starOffset": 0, "starCount": 6400,
    "shardCount": 4,
    "home": [0.0, 0.0, 0.0],        // home position, multiverse units (PRD 5.3.15 drifts around it)
    "radius": 100.0,                // visual radius; the Blind Eternities uses R (PRD 8.3)
    "tilt": [0.0, 0.0, 0.0, 1.0],   // quaternion x,y,z,w
    "spinPeriodS": 0.0,             // 0 = no spin (PRD 8.3: the Blind Eternities has zero spin)
    "spinDirection": 1,             // +1 or -1
    "driftAmplitude": 0.0, "driftPeriodS": 0.0, "driftPhase": 0.0,
    "rowCells": [2, 7, 12, 17],     // v3 only; absent on the belt and on an empty plane
    "palette": [0.14, 0.2, 0.17, 0.18, 0.16, 0.1, 0.05],             // W U B R G multi colourless weights, sums to 1
    "nebulaTint": [0.32, 0.38, 0.55],                                // linear RGB, PRD 5.3.5
    "firstYear": 1993, "lastYear": 2026,
    "sets": [{ "id": 12, "code": "lea", "name": "Limited Edition Alpha", "year": 1993, "cardCount": 295 }]
  }]
}
```

`sets[].id` indexes the global set dictionary of `search.json` §7, which is the same id space as `sets.bin` §6.3. The list is in chronological order and is the chronology-band order of PRD 5.4.2, so band `b` of a plane is `sets[b]`.

**`radius` changed meaning in v3** without changing type. It is now `max(0.126 · √cardCount, 0.55)` — constant *area* per card, under §1.8's moon floor; the Blind Eternities still carries `R` for the belt. **The floor binds on every plane, not only the empty ones**: `0.126 · √N` does not reach 0.55 until N = 20, so applied only where `cardCount == 0` the law inverts and a one-card world is drawn smaller than a plane holding nothing — which falsifies the one reading §1.8 asks for. On the v3 roster the floor binds on 15 of 45 worlds. PRD 5.3.2's `log N` curve and its `[r_min, r_max]` clamp are gone, and with them the run report's radius-headroom table: there is nothing left to saturate (worlds spec §1.3, §1.8).

**`rowCells` (v3)** is the surface grid's per-row cell count, north to south. `rowCells.length` is the row count, row latitudes are equal-angle with `dφ = π / rows` and centres at `(i + ½)·dφ`, and the counts sum to `cardCount`. A client matches a cell to its row by **nearest** colatitude and never by `floor()` — §5's float16 spacing leaves a margin of 3.08× at the pole for nearest-centre and half that for `floor()`. It is shipped rather than derived because the grid is relaxed to the *population*, so no closed form describes it. The key is **absent**, not empty, on the belt and on every empty plane: those have no grid, and a present-but-empty array invites a reader to take `length` as a row count.

**Seven fields retired in v3**: `shearAmplitude`/`PeriodS`/`Phase`, `armPitch`, the per-plane `discThickness`, `bar`, and the top-level `discThickness`. All seven are laws of a spiral disc (PRD 5.4.13, 8.6.2), and a world is a sphere. A v2 dataset still carries them and a v3 reader still reads v2, so a consumer of these must treat them as optional and default them — `undefined` written into a `Float32Array` is `NaN`, and a NaN in the plane table is a plane that vanishes rather than one that stops shearing.

The Blind Eternities is row 0 with the identity transform, radius `R` and zero spin, so its stars' local coordinates are multiverse coordinates scaled by `1/R` and the shader path is identical for every star (PRD 8.3).

## 5. `stars.bin`

Header kind `1`, `recordCount` = star count. Flags bit `0` is reserved for a float32-position variant (PRD risk 6's fallback); the emitted file is always float16 today and the bit is `0`. The GPU-side float32 fallback decodes at load, it does not need a second file.

**Record — 12 bytes**, exactly PRD 8.3:

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | `float16` | `x` | **v2:** plane-local, within the frame radius 1.2 (PRD 8.6.2). **v3:** the unit-sphere cell centre, `\|p\| = 1`, for a plane with cards; the belt position for dust, in the same local frame |
| 2 | `float16` | `y` | |
| 4 | `float16` | `z` | |
| 6 | `uint8` | `planeIndex` | row in `planes.json` and in the `DataTexture` |
| 7 | `uint8` | `colour` | packed: `hueClass` in bits 0-2, `colourIdentity` in bits 3-7 (amendment A3) |
| 8 | `uint8` | `sizeClass` | |
| 9 | `uint8` | `brightness` | quantised log printing count, capped at the plane's 98th percentile (PRD 5.4.10) |
| 10 | `uint8` | `twinklePhase` | **v2:** phase = `v / 256 · 2π`. **v3:** reserved, written `0` — there is no twinkle on a mosaic |
| 11 | `uint8` | `typeMask` | |

30 000 records = 360 016 bytes on the wire before compression.

**v3 keeps all twelve bytes and changes what six of them mean.** The 16-byte header, the stride-12 interleaved upload and every offset are unchanged. Bytes 8-9 (`sizeClass`, `brightness`) stay *written* even though the worlds renderer reads neither, so that a v3 dataset would still render on the galaxy path if the dual-scene period ever needs it; reclaiming them is a v4 conversation. Only `twinklePhase` becomes reserved.

The unit-sphere point gives a cell's centre and, through `east = normalize(cross(Y, n))`, its tangent frame. It does **not** give the cell's half-extents: those come from `planes.json`'s `rowCells` (§4), and the longitudinal one is an *arc length*, `(π / rowCells[r]) · sin θ_r`, not an angle. Dropping that `sin θ_r` draws the polar row of a 6 266-card world 51.6× too wide — a quad wider than the globe it sits on.

**float16 and the row match.** Spacing on `[0.5, 1)` is `2⁻¹¹` = 4.883 × 10⁻⁴, so the round-trip error is at most 2.44 × 10⁻⁴. On an 81-row world the gap between the two polar rows is 1.504 × 10⁻³ in `cos θ`: a margin of **3.08×** for nearest-centre matching and **1.54×** for a `floor()` against the boundary below. At the equator both are slack (79×), so the pole is the whole safety factor and the factor of two is not spare. The pipeline asserts, on the encoded bytes, that every star still resolves to the row it was generated from.

### 5.1 `swatches.bin` (v3)

Header kind `3`, `recordCount` = star count. One record per card, **in star order**, so a lookup is `starIndex · 8 + 16` — no map, no offset table.

```
16-byte standard header, then starCount × 8 bytes:
  4 × uint16 RGB565, the card's art downsampled to 2×2, in reading order:
  [top-left, top-right, bottom-left, bottom-right]
```

RGB565 is `(r & 0xF8) << 8 | (g & 0xFC) << 3 | b >> 3`; green is the six-bit field, which is the one an RGB555 packing gets wrong. The samples are **averaged in linear light** and re-encoded to sRGB — a byte-space average darkens every mixed quadrant, and a mosaic of tens of thousands of cells is where a systematic darkening reads as a bug rather than as art. The quadrant split is `width // 2` / `height // 2`, so an odd dimension gives the extra pixel to the right and bottom halves; arbitrary, but fixed, because a content hash needs *a* rule.

The source is Scryfall's `art_crop` of **printing index 0** — the card's earliest-released printing, which is the one a cell draws and credits (§9). `small` would be the whole card, frame included, and a 2×2 of that is dominated by frame colour, which *is* the colour identity, which is `hueClass` again.

It is its own file and deliberately **not** a fourth section of `sets.bin`: PRD 7.2 budgets `search.json` + `sets.bin` together at 700 KB and that pair is at 96% of it, which is the project's one genuinely tight row. Fetched with `stars.bin` instead, on the before-intro row, which has 3 MB (§8).

On production: 28 603 × 8 + 16 = **228 840 bytes raw, 191.9 KB brotli — 86% of it survives compression.** Four uncorrelated 16-bit samples per card are close to incompressible, which is the expected result and is why the file gets a budget row of its own rather than being assumed away.

### Byte 7 — the packed colour (amendment A3)

| Bits | Field | Values |
|---|---|---|
| 0-2 | `hueClass` | PRD 5.4.8's seven classes: W, U, B, R, G, multicolour, colourless |
| 3-7 | `colourIdentity` | the card's five-bit WUBRG mask (PRD 6.6.2) — `W=1, U=2, B=4, R=8, G=16` |

The record is still **12 bytes**. `hueClass` never exceeded 6 and so only ever needed three of its eight bits; the identity moves into the five that were already being written as zero. Nothing else in the layout moves, the file size is unchanged at 12 bytes per star, and the stride-12 interleaved upload below is untouched.

The identity's bit indices are deliberately the same as `hueClass`'s five mono values, so a mono-coloured card satisfies `identity == 1 << hueClass`. That is what keeps the two halves of the byte from disagreeing about which colour a star is.

Both fields are needed. `hueClass` is what the renderer indexes `uHues` by, and it is the only thing that distinguishes the two meanings of `colourIdentity == 0`: a genuinely colourless card, and a field that was never written. `colourIdentity` is what an exact colour filter needs, because `hueClass` collapses every multicolour card into a single value — the PRD 6.6.2 gap this amendment closes.

**A reader must mask.** Byte 7 now ranges over 0-253, so a consumer that reads it whole gets a hue class of 132 for a mono-green card and indexes `uHues` — a seven-element array — far past its end. This is why the change bumps `contractVersion`: the failure is silent, not loud.

Masking is not left to each reader. `web/src/data/colourByte.ts` owns the offset and both masks; `decode.ts`'s accessors and `starGeometry.hueClassOf` / `colourIdentityOf` — which read the record bytes directly rather than through the decoder, and feed the focused card's rim colour and the thumbnail glow's `aHue` — call into it, and `web/test/colour-byte.test.ts` fails if any other file under `web/src` addresses byte 7 or names its masks. Per-reader masking was the arrangement that failed: `starGeometry.hueClassOf` was added in PR #10 reading the byte raw, and review caught it on the merge rather than in the file. The one exemption is the shaders, which mask inline with `& 7` because GLSL cannot call a TypeScript helper; the tripwire asserts that mask is still there and `starfield.test.ts` pins it over all 256 byte values.

The record is laid out so the whole file is uploaded as **one interleaved WebGL buffer**, stride 12: a `HALF_FLOAT x3` attribute at offset 0, an `UNSIGNED_BYTE x4` attribute at offset 6 (`planeIndex, colour, sizeClass, brightness`), and an `UNSIGNED_BYTE x2` attribute at offset 10 (`twinklePhase, typeMask`). No repacking on load. The mutable `filterMask` attribute of PRD 8.5.1 is a separate, CPU-owned buffer.

`stars.bin` is consumed with a streaming fetch; the draw range grows as records arrive. Because records are plane-ordered, whole planes fade in one after another (PRD 6.8.1, 8.3). A partial read is always a whole number of records plus the 16-byte header; the decoder exposes an incremental reader for this.

## 6. `sets.bin`

Header kind `2`, `recordCount` = star count. `sets.bin` is a **sectioned container**: it is the binary sidecar that loads with `search.json` (PRD 8.7.5) and it carries everything about a star that must not be JSON. PRD 8.3 names the file for its primary payload; the oracle-id table lives here rather than in `search.json` because 30 000 ids as JSON hex strings cost ≈ 1 MB and would break the 7.2 budget on their own (§8).

```
16: uint32  sectionCount
20: uint32  reserved = 0
24: section table, sectionCount × 16 bytes:
      uint32 id, uint32 offset (from file start), uint32 byteLength, uint32 reserved = 0
    sections follow, each aligned to 4 bytes, in ascending id order
```

| Id | Section | Layout |
|---|---|---|
| 1 | `ORACLE_IDS` | `starCount × 16` raw UUID bytes, in star order |
| 2 | `SET_COUNTS` | `starCount × uint16` — number of distinct included-printing sets for that star |
| 3 | `SET_ENTRIES` | `sum(counts) × uint16` — set ids, concatenated in star order |

Within a star, entries are **ascending and deduplicated**, so the set-facet test (PRD 6.6.3) is a sorted membership check and needs no per-star `Set` allocation. Entry offsets are a prefix sum of `SET_COUNTS`, computed once at decode. Storing counts rather than offsets is deliberate: a monotone `uint32` offset array does not compress, a `uint16` count array of small values compresses to almost nothing.

`ORACLE_IDS` is the star index → `oracle_id` direction. The reverse — the deep-link direction of PRD 6.7.1 — is a map built once at decode from the same section.

## 7. `search.json`

Loaded in the background after the first frame, with `sets.bin` (PRD 8.7.5). Client-side fuzzy index (PRD 6.5).

```jsonc
{
  "contractVersion": 2,
  "starCount": 30000,
  "planes": [{ "index": 0, "slug": "…", "name": "…", "cardCount": 6400 }],
  "sets": [{
    "id": 0, "code": "lea", "name": "Limited Edition Alpha", "year": 1993,
    "planeSlug": "dominaria" | null,   // null = reprint-only set, no Appendix B row (PRD 6.5.4)
    "cardCount": 295                    // cards first printed here; 0 for reprint-only sets
  }],
  "cardNames": ["Sol Ring", "…"],       // index == star index; PRD 6.5.2 front-face name
  "backNames": [[1234, "Insectile Aberration"]]  // sparse; every card with a second face (§9)
}
```

`backNames` carries a row for **every** non-null `b`, not only the double-faced cards: PRD 6.5.2 wants "Stomp" to find Bonecrusher Giant and "Ice" to find Fire // Ice, and those are adventure and split cards. A row here says a card has a second *face*; it says nothing about whether it has a back *image*. See §9.

The set dictionary is global and includes reprint-only sets, because PRD 6.6.3–4 filter by them and PRD 6.5.4 searches them. Its ids are the ids used by `sets.bin` §6.3 and by `planes.json` §4. There is no per-card plane field: a star's plane is the `planes.json` range that contains its index (§2).

Card `oracle_id`s are **not** in `search.json`; they are in `sets.bin` section 1 (§6).

## 8. Payload budget

PRD 7.2 budgets the pair `search.json` + `sets.bin` at ≤ 700 KB target / 1.5 MB ceiling, **encoded transferred size**. Both datasets below are measured at brotli quality 11 — the numbers `web/scripts/check-budget.mjs` reports, re-measured against the committed artefacts of `3e9be89b4e3e9bdb` (`fixture-scale`: 30 000 stars, 88 planes, 480 sets) and `dabe2c9a68b4d799` (production: 28 603 stars, 88 planes, 294 sets), both at `contractVersion` 2:

| Artefact | Scale raw | Scale brotli | Production raw | Production brotli |
|---|---|---|---|---|
| `manifest.json` | 17.0 KB | 4.8 KB | 17.1 KB | 4.8 KB |
| `planes.json` | 89.1 KB | 13.7 KB | 72.6 KB | 12.1 KB |
| `stars.bin` | 351.6 KB | 261.2 KB | 335.2 KB | 237.7 KB |
| `search.json` | 909.6 KB | 129.5 KB | 578.4 KB | 181.4 KB |
| `sets.bin` | 666.2 KB | 543.5 KB | 624.4 KB | 487.6 KB |
| **`search.json` + `sets.bin`** | 1 575.7 KB | **673.1 KB** | 1 202.8 KB | **669.0 KB** |
| First frame (`manifest` + `planes`) | 106.1 KB | 18.5 KB | 89.7 KB | 16.9 KB |
| Before intro (adds `stars.bin`) | 457.7 KB | 279.7 KB | 424.9 KB | 254.6 KB |
| Largest plane shard | 838.3 KB | 204.5 KB | 1 213.1 KB | 339.9 KB |

**The pair is under its target and not comfortably so.** 673.1 KB is **96.2%** of the 700 KB target on scale and 669.0 KB is **95.6%** on production — both inside the ≥ 90% band, so the budget check reports them `[near target]` with a headroom warning (26.9 KB and 31.0 KB), not a bare `ok`. Read the row that way: the target holds today and one more sizeable set is what moves it. Only the 1.5 MB ceiling fails the build; the target is reported, per PRD 9.1.1–2, so a target overshoot is visible without blocking a merge. The first frame, before-intro and A1 shard rows all sit at or under a quarter of their targets.

**What amendment A3 cost.** Nothing raw: `planes.json`, `stars.bin`, `search.json` and `sets.bin` are byte-for-byte what they were at `contractVersion` 1, because the identity went into bits byte 7 was already spending on zeroes. (`manifest.json` necessarily changes — it records the contract version and the hashes of the files above — but its raw size is unmoved at 17 285 bytes, so every raw cell in the table is the number main measured too.) The cost is entirely in compression, and only on `stars.bin` — production goes 229.1 → **237.6 KB** brotli, **+8.5 KB (+3.7%)**, because byte 7 now takes 31 distinct values instead of 7 and the plane-ordered runs it used to compress into are shorter. Scale is flat (262.0 → 261.6 KB): its stars sort by band then hue, so its mono runs — 15% of cards per colour, one identity value each — survive the packing almost intact.

That lands entirely on the **before intro** row, 245.3 → 253.9 KB against a 3 MB target: 8% of it. **The constrained row does not move at all**, because the pair does not include `stars.bin` — production's 668.4 → 668.5 KB is measurement noise on `sets.bin`, not the amendment. So A3 is free in the budget that is actually tight, and 3.7% of one file in a budget with 12× headroom.

`sets.bin` is dominated by `ORACLE_IDS` — one 16-byte UUID per star, 469 KB on scale's 30 000 and 447 KB on production's 28 587, all of it incompressible entropy that no layout choice changes. It is why the ids are 16 raw bytes rather than JSON hex strings, which would cost ≈ 1 MB and break the budget on their own.

Two things to read the table with:

1. The two columns are close on the pair and far apart on its halves, which is not a coincidence. `fixture-scale`'s card names come from a 16×16 synthetic vocabulary, so its `search.json` compresses about 2.2× better per byte than real Magic card names do (7.05:1 against 3.19:1) — production's `search.json` is *smaller raw* (578 KB against 909 KB) and *larger brotli* (181 KB against 129 KB). Scale pays that back on `sets.bin`, having 1 413 more stars to carry ids for. So scale remains a fair proxy for the pair as a whole, and is not a proxy for `search.json` alone.
2. If a later run overshoots the target and the owner wants it back, the documented lever is: truncate `ORACLE_IDS` to the leading 8 bytes and keep the full id only in the plane detail shards, which a card focus always loads first. That saves 234 KiB ≈ 240 KB. It is *not* done now, because it makes the star → `oracle_id` direction depend on a shard fetch, and PRD 8.3 asks for a `star index ↔ oracle_id` table. Taking the lever is a contract change.

   The collision probability if it is ever taken is **≈ 3.9 × 10⁻¹⁰** at 30 000 ids, not the 2 × 10⁻¹¹ this document carried before. Oracle ids are UUIDv4 (Sol Ring is `6ad8011d-3471-…`, byte 6 = `0x43`), and the leading 8 bytes contain the 4 fixed version bits, so a truncated id holds **60** random bits rather than 64 — a factor of 16 the earlier number missed. Still negligible against a 30 000-row table, so the lever stays sound; the number is now the right one.

**Amendment A1 budget row** (implementation-plan.md §8), added to the 7.2 table:

| Measure | Target | Ceiling |
|---|---|---|
| Largest single plane detail shard, encoded | ≤ 1.5 MB | 2.5 MB |

### 8.1 What contract v3 cost, measured

The v3 production dataset is `c9468f1125bcddff` — the same 28 603 cards from the same pinned
2026-09-14 bulk file as `dabe2c9a68b4d799` above, so the two columns differ only by the contract.

| Row | Target | v2 `dabe2c9a…` | v3 `c9468f11…` |
|---|---|---|---|
| `search.json` + `sets.bin` | 700 KB / 1.5 MB ceiling | 669.0 KB (95.6%) | **669.0 KB — unchanged** |
| First frame (`manifest` + `planes`) | — | 16.9 KB | 15.9 KB |
| Before intro (+ `stars.bin`, + `swatches.bin`) | 3 MB | 254.6 KB | **347.2 KB (11%)** |
| Largest plane shard | 1.5 MB / 2.5 MB ceiling | 339.9 KB | 361.0 KB (24%) |

Four things a reviewer should read off it rather than take on trust.

1. **The constrained row does not move by a single byte — meant literally.** Both files are the
   same length in v2 and v3, and each differs at **exactly one byte**: `search.json` at offset 19,
   the `2` of `"contractVersion":2`, and `sets.bin` at offset 5, the contract version in the §6
   binary header (`02` → `03`). Every other one of their 1 231 673 bytes is equal. That is the
   stronger claim and the correct one — the search path is provably untouched, not merely the same
   size — and it is worth stating precisely because a previous draft of this section said
   "byte-identical", which the two version stamps make false (DEC-757 note 4). This is what §5.1's
   "its own file" decision buys: folding `swatches.bin` in as a section would have put the pair at
   ≈ 861 KB, 23% *over* a reported target, on the one row with 31 KB of headroom.
2. **`swatches.bin` compresses about as badly as expected**: 223.5 KB raw → 191.9 KB brotli, 86%
   surviving. The worlds spec estimated ~90% and budgeted 455 KB for the before-intro row; the
   measured figure is 347.2 KB, so the row comes in *under* the estimate and the conclusion — 11%
   of a 3 MB target — never depended on it.
3. **`stars.bin` got dramatically cheaper**: 237.7 → 139.6 KB brotli, −41%. Unit vectors on a
   regular grid have far less entropy than seeded spiral positions, and the file is the same 12
   bytes per star either way. That is where most of `swatches.bin`'s cost was already paid for.
4. **The largest shard grew 21.1 KB** (6.2%), which is the `artist` field arriving inline on
   16 042 printings of `dominaria.0.json`. Against a 1.5 MB target that is a 24% row.

### 8.2 Basis of record: local brotli against served bytes

Every number in §8 and §8.1 is local brotli q11. Production does not serve those bytes. The policy
below was settled by DEC-766 on DEC-741's evidence (comment `6e9487de`) and is repeated in the
header of `web/scripts/check-budget.mjs`, so that it is read rather than re-litigated.

- **The blocking gate stays on local brotli q11.** It is hermetic — no deployment and no
  credential — so it runs on every PR. That is why it is the basis, and not the served bytes.
- **The edge does not compress at q11.** On the search pair, local reads ~669 KB where production
  serves **724.2 KB** on the same dataset hash: local under-reported by 55.2 KB. This is one
  reading on one pair, recorded as an **observed divergence**. It is deliberately not applied to
  the gate as an offset or a correction — the gate keeps reporting what it measures.
- **Served bytes are the truth-instrument, and they are production-only.** The owner declined a
  Vercel Protection Bypass for Automation token, so there is no per-PR preview measurement. Served
  bytes are re-measured against production after merge, whenever a wave touches a budgeted payload.
- **The search-pair overage is deferred.** 724.2 KB served against the 700 KB target is documented
  and non-blocking. Raise-the-target versus diet-the-payload is ruled when a wave next touches the
  search pair; re-measure served bytes at that point.

## 9. Plane detail — `planes/<slug>.<n>.json`

**Amendment A1:** *every* plane shards at `shardSize` = 2000 cards per file, not only the Blind Eternities. The filename always carries the shard number, including for a one-shard plane, so the loader has one code path. A card's shard is `floor(localIndex / 2000)` and needs no lookup table (PRD 8.3), where `localIndex = starIndex - plane.starOffset`.

```jsonc
{
  "contractVersion": 2,
  "slug": "dominaria",
  "shard": 0,
  "shardSize": 2000,
  "starOffset": 12000,     // global star index of this shard's local index 0
  "cards": [{
    "u": "6ad8011d-3471-4369-9d68-b264cc027487",   // oracle_id
    "n": "Sol Ring",                                // name
    "m": "{1}",                                     // mana cost
    "t": "Artifact",                                // type line
    "o": "{T}: Add {C}{C}.",                        // oracle text, front face
    "b": null,                                      // second face { n, m, t, o, id?, ts? } or null
    "ci": "",                                       // colour identity letters, "" = colourless
    "r": 2,                                         // first-printing size class
    "l": "normal",                                  // Scryfall layout, a closed union (below)
    "p": [["91fdb56b-…", 12, "u", 1783903215, "266", "Mark Tedin"]]  // printings
  }]
}
```

A printing is a fixed tuple `[id, setId, rarityChar, imageTs, collectorNumber, artist]`, ordered by release date — the planet order of PRD 5.6.7. `rarityChar` is one of `c u r m` (already normalised per PRD 4.8).

**`artist` is v3 (worlds spec §2.3)** and is a five-element tuple in v2. It is per *printing*, not per card, because art differs between printings, and `""` where Scryfall has none — present and empty, never absent, so the tuple's length is fixed. It is an inline string rather than an id into a dictionary: a dictionary is the smaller encoding, but its only sensible home is `search.json`, which is half of the 96%-full pair, and the shards have 4.4× headroom. The cost goes where the headroom is. Across production it is ≈ 1.2 MB raw over 93 shards and +21 KB brotli on the largest.

It is in the contract because concept B shows tens of thousands of `art_crop`s with no card in sight. Scryfall's terms ask that an art crop be shown with the artist and copyright in the same interface *or* the full card alongside; the focused-card planets satisfy the alternative clause today and a mosaic of cells does not. **Printing index 0** is the one a cell draws (§5.1) and `p[0][5]` is therefore the credit.

**Ordering, and a trap.** `p` is sorted by the *printing's* set release date, so `p[0]` is the earliest-released printing and is **not** necessarily the card's debut printing — a promo or a list reprint whose set shipped earlier sorts ahead of the set the card first appeared in. The swatch stage and the shard writer share one function so the art and the credit cannot disagree.

`imageTs` moves on Scryfall's schedule rather than the product's, so a refresh that changes nothing
a user could see still rewrites the shards that contain those cards. That churn was measured and
deliberately left alone — see [`decisions/imagets-churn.md`](decisions/imagets-churn.md), which also
records the trigger for revisiting it and the rule that any replacement rides an existing contract
bump rather than causing one.

**Image and page URIs are derived, not stored.** Storing three ~90-character URIs per printing costs ~270 bytes against ~50 for the key, and the derivation was verified against live Scryfall data in Phase 0 (`docs/scryfall-policy.md`):

```
image:  https://cards.scryfall.io/<size>/<face>/<id[0]>/<id[1]>/<id>.jpg?<imageTs>
        size ∈ { small, normal, large, art_crop, border_crop }   face ∈ { front, back }
page:   https://scryfall.com/card/<setCode>/<collectorNumber>     both halves percent-encoded
back:   https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg
```

Both sides implement this in one place — `pipeline/src/eternities/contract/images.py` and `web/src/data/images.ts` — and the test vector covers it. This still satisfies PRD 4.11.3: images are loaded from Scryfall's URIs at the size the view needs, never mirrored or resized server-side.

The page URI percent-encodes both halves: Scryfall collector numbers carry `★` and `†` (`266★`). A browser papers over that inside an `href`, but not if the string is ever fetched or re-templated.

### A second face is not a back image

**`b` answers "is there another face". It does not answer "is there a back image".** These are different questions and conflating them derives URIs that 404. Verified against live Scryfall in Phase 0:

| Layout | `b` non-null | Back image | Derived `.../back/<id>.jpg` |
|---|---|---|---|
| `normal` | no | no | — |
| `split` (Fire // Ice) | **yes** | **no** | **404** |
| `adventure` (Bonecrusher Giant) | **yes** | **no** | **404** |
| `flip` (Erayo) | **yes** | **no** | **404** |
| `transform` (Delver of Secrets) | yes | yes | 200 |
| `modal_dfc` (Malakir Rebirth) | yes | yes | 200 |
| `meld` (Bruna) | yes | yes, *elsewhere* | n/a — see below |

Split, adventure and flip cards have two faces printed on one physical side. They carry no per-face `image_uris`, so there is no back image — but `b` **must** be populated for them, because PRD line 156 needs per-face oracle text and Scryfall gives a split card no top-level `oracle_text` at all. The text exists only inside `card_faces`.

So:

- **`l` is a closed union** of Scryfall's layout values — `LAYOUTS` in `contract/enums.py`, `CardLayout` in `data/types.ts`. The encoder rejects an unclassified layout and fails the run (PRD 7.7.2) rather than guessing at a URI.
- **One shared predicate decides**: `has_back_image(layout)` / `hasBackImage(layout)`, defined next to the URI derivation in both files. The back-image layouts are `transform`, `modal_dfc`, `double_faced_token`, `reversible_card` and `art_series`.
- **Consumers call `cardBackImageUri(card, printing, size)`** (`back_image_uri` in Python), which returns `null` when there is no back image. Never `printingImageUri(p, size, 'back')` directly — that signature cannot know whether a back exists.
- The test vector carries a `split`, an `adventure`, a `flip`, a `transform` and a `meld` card, pins `backLarge` as `null` wherever there is no back image, and pins `hasBackImage` for *every* layout in `backImageChecks` so the two languages cannot drift apart.

### Meld backs

PRD line 125 keeps meld results out of the card set but requires them to stay reachable as the back faces of their components. A meld result is a separate Scryfall object: its own id, its own top-level `image_uris`, and **no** `card_faces`. Its image therefore cannot be derived from the component's printing at all.

`CardFaceRecord` carries two optional fields for exactly this:

```jsonc
"b": { "n": "Brisela, Voice of Nightmares", "m": "", "t": "…", "o": "…",
       "id": "5a7a2a…",      // the meld result's own printing id
       "ts": 1783903215 }    // and its image timestamp
```

They are set together or not at all, and only on a meld back. The image is fetched with `face: 'front'`, because the meld result's own image *is* a front. This is the contract extension rather than the alternative — ruling meld backs text-only — because that would amend PRD 125, and the extension costs two optional keys on a few hundred cards.

The card's plane is not repeated in the shard; the URL's plane slug and the `planes.json` range agree, and PRD 6.7.1 makes the card win if a refresh moved it.

## 10. Enforcement

- `contract/test-vectors/v2/` holds a hand-checkable dataset: `vector.json` (the inputs and the expected derived URIs) plus the encoded `stars.bin`, `sets.bin`, `manifest.json`, `planes.json`, `search.json`, `planes/*.json`. Python re-encodes it and asserts byte equality; TypeScript decodes it and asserts the values round-trip. Both run in CI. The directory is named for the `contractVersion` it speaks; the v1 vector it replaced is in git history at `888f9f4`.
- `web/scripts/check-budget.mjs` measures **brotli-encoded** size of the built shell and of the data directory's files, and checks them against the PRD 7.2 table plus the A1 row. Ceilings fail the build; targets are reported, and a row at or above 90% of its target is warned about so the run before the miss is visible. The basis of that measure — local brotli q11, and how it relates to what production actually serves — is §8.2.
- Adding a field is a minor change and bumps `pipelineVersion`. Changing a byte layout, a section id, an enum value, or a filename bumps `contractVersion` and requires a review by the Frontend Engineer and the Interactive Tools Engineer.

## 11. Change log

### v3, `pipelineVersion` 0.5.0 — concept B "worlds", 2026-09-14

One bump carrying three changes, because all three are a pipeline re-run plus a data PR and there is
no reason to pay for that three times. `docs/worlds/spec.md` §2 is the spec; this is what shipped.

- **`stars.bin` keeps all twelve bytes and changes what six of them mean.** Bytes 0-5 are now a
  unit-sphere cell centre rather than a plane-local spiral position, and byte 10 (`twinklePhase`)
  is reserved, written `0`. Bytes 8-9 stay written. No offset moves and the stride-12 interleaved
  upload is untouched (§5).
- **`swatches.bin` arrives** (§5.1): a per-card 2×2 RGB565 statistic of the card's own art. The
  enabler for the whole concept — the contract carried `hueClass`, which is a seven-way
  classification of colour *identity* and not a pixel statistic.
- **`planes.json` trades seven spiral fields for `rowCells`** and `radius` changes meaning (§4);
  **the printing tuple gains `artist`** (§9).

**This bump is a break in one direction only, and that is deliberate.** A v2 decoder reading a v3
file would read spiral positions that are unit vectors and shear fields that are not there: silent,
which is what §10's rule exists for. But a **v3 decoder still reads v2**, by design and by test.
`web/src/data/types.ts` carries `CONTRACT_VERSION` — the version this build *writes* — beside
`READABLE_CONTRACT_VERSIONS`, the set it *accepts*, and both `decode.ts` and `load.ts` gate on the
set. The reason is the dual-scene period: a data directory is content-hashed and immutable and
`web/datasets.json` names which one a build uses, so the v3 dataset was published as a **new
directory** with `active` left on the v2 one. A build that refused v2 would have broken what is
deployed on the very first v3 commit. The pair closes when the galaxy retires; until then a
consumer that needs a v3-only field checks for the **field**, not the version — `rowCells` is
absent on exactly the planes that have no grid, which makes that check meaningful.

The test that guards the version gate had to change with it. `CONTRACT_VERSION - 1` is 2 and v2 is
now readable, so the mutant is version `1`, and a second case asserts the v2 row *loads* — a gate
that accepted everything and a gate that accepted only v3 would both have passed a test that only
ever mutated to v2. Those cases swap a version stamp on v3-shaped bytes, so they pin the *gate* and
not the *tolerance*; the committed v2 dataset is loaded directly by a fourth block of tests, which
is what asserts the shape this build has to keep reading — `rowCells` absent, five-element printing
tuples, the spiral fields present, no `swatches.bin` (DEC-757 note 2).

**Data.** The 88-plane roster of DEC-745, 28 603 cards, 45 worlds and 42 dark moons — not the 29/57
split the spec illustrates, which predates PR #41's overrides being baked into a dataset. Every
artefact re-hashes: the test vector moved from `contract/test-vectors/v2/` to `v3/`, the fixtures
were `2e6f120ee85a5b23` and `f6f712c6e70a6a51`, and production is `c9468f1125bcddff` with
`dabe2c9a68b4d799` kept on disk and still named by `active`. §8.1 has the measured budget.

**The fixture hashes moved again in DEC-796**, to `7588f66591d5900f` (small) and
`36e442aea0130106` (scale), when both fixtures gained a `swatches.bin`. A fixture has no art to
take §5.1's statistic from, so the column is *invented* from each card's own id: a base per card,
then a per-corner swing around it, with every component held off both ends of its channel so that
no sample can be mistaken for a cleared buffer or a saturated default. The reason is not tidiness.
`EternitiesScene`'s `worldData` memo is `planes && stars && swatches`, so a dataset without the
file can never compose a worlds roster — and CI smokes `ETERNITIES_DATASET=scale`, which left
every worlds surface, §1.12's art-pool rung included, skipping rather than running (DEC-788,
DEC-793). The base-then-swing shape is the part worth keeping: the browser reduces the four
samples to their **mean**, and the mean of four independent draws has a quarter of the variance of
one, so independent corners would have delivered 30 000 cards in much the same grey — a column
that cannot expose a misrouted star lookup, because reading the wrong card's swatch would return
nearly the same colour. `active` was left where it was. Production is untouched: its swatches are
still real pixel statistics, and §8.1's figures are unchanged.

**And once more in DEC-759**, to `8bf8a37fe3789b57` (small) and `03f9a15e268f3d05` (scale), when
`place_planes` gained the home-view separation rule of worlds spec §1.11 and stopped scattering
plane homes through the disc's thickness. `home` is the only *field* that moved, so `planes.json`
is the only artefact whose content changed — stars are plane-local, and `stars.bin`, `sets.bin`,
the per-plane shards, `search.json` and `swatches.bin` are byte-identical — but `manifest.json`
moves with it, since it carries that file's length, its sha256 and the `dataHash` over all of
them, and the directory name is that hash. 53 of the 88 fixture-scale planes changed position
in-plane; `fixture-small`'s four named planes kept their `(x, z)` exactly and lost only their
vertical offsets, which is the cheapest possible demonstration that a re-hash is not a reshuffle.
Production is untouched, which is the point: no gate baseline of DEC-752's moves with this change.
Until a refresh re-laid production out, the homes it would produce were vendored at
`docs/worlds/dec759-home-law.json` and pinned to the generator by
`pipeline/tests/test_home_separation.py`.

**Production carried the law from DEC-885**, the 2026-09-21 refresh: `c9468f1125bcddff` →
`f2be4a22ce639774` (Scryfall bulk `2026-09-21T09:05:30.034+00:00`). The shipped homes equal the
vendored candidate to its six-decimal rounding, so the vendored file, its pin and the web sweep's
shipped-arm control were deleted in the same commit. The refresh moved more than `home`, and none
of it is a contract change. The same refresh amended PRD 4.3.8 to read each printing's own
`released_at` rather than its set's (review finding DEC-910 F1), and that is most of what moved:
`c9468f1125bcddff` already carried 491 printings Scryfall dates after the run date — 482 on The
List (`plst`, set date 2020-09-26, printings dated 2026-11-09) and 9 Special Guests (`spg`, set
date 2023-11-17, printings dated 2026-10-02) — and 274 cards drew their cell art from one of them.
Counted against `c9468f1125bcddff`: `swatches.bin` moves on **127** cards, 125 because the card's
art source (printing index 0) was one of those unreleased printings and is now a released one (15
of them a different illustration, 110 a different scan of the same one; the other 149 of the 274
re-derive to the same 8 bytes), and 2 because Scryfall re-scanned the art on the same printing (The Many Deeds of Belzenlok, The
Antiquities War). `sets.bin` loses 442 card-set entries on 442 cards and gains none; `stars.bin`
moves only byte 9 (`brightness`, a quantised printing count the worlds renderer does not read) on
1,492 records; 34 of 94 plane detail shards change, in `cards[].p` only. `planes.json` is
byte-identical to the one the pre-amendment build of the same refresh produced.

Three things a reviewer should check rather than take on trust:

1. **The surface law is exact, not approximate** — but read the right evidence for it. The run
   report's assignment table reads `N / 0 / 0` for every world, and that is a **regression
   tripwire, not a measurement**: both counters are structurally zero under `build_grid` for every
   input, because it places each card in its own band and its own set's slice by construction
   (DEC-757 note 3). The checks that actually bind are `sum(rowCells) == cardCount`, the
   `nearest_row` recount of the emitted stars, and — since DEC-757 F1 — `min(rowCells) >= 1`, which
   is the one property none of the others can see: a row with *no* cells is not a bare *cell*, so
   `bare` cannot count it and the recount agrees `0 == 0`. `lorwyn` shipped `[3, 3, 0]` in a
   committed fixture for exactly that reason. It is now a `BareRowError` raised at construction, so
   a population that cannot reach every row fails the build instead of dividing §4's client-side
   `(π / rowCells[r])` by zero. The closed form `round(2π·sin θ / (aspect·dφ))` disagrees with the
   card count on 33 of the 45 worlds, which is why §4 ships `rowCells` rather than a formula.
2. **`θ` is colatitude and the row formula carries `sin`.** Read as latitude the counts run
   `+1 → −1` down the sphere and an 81-row world sums to **zero** cells. Pinned by a test that
   asserts the degenerate reading is degenerate, not only that the correct one is correct.
3. **The swatch is a statistic, not a copy.** 8 bytes per card, decoded at fetch time; no image is
   ever stored. The fetch is resumable and keyed by `(printing id, imageTs)`, so a refresh costs
   only what Scryfall actually changed — the first cold warm was 28 583 requests and 2.32 GB over
   24 minutes, and the second run of the same build made zero.

### v2, `pipelineVersion` 0.4.0 — colour identity in the star record, 2026-09-05

Amendment A3 (implementation-plan.md §8), on the board's DEC-589 decision. Each star now carries the card's **colour identity**, closing the PRD 6.6.2 gap where selecting one colour admitted every multicolour card because `hueClass` collapses them all into a single value.

**The record is still 12 bytes.** Byte 7 was a `hueClass` that never exceeded 6, so three of its eight bits carried the value and five carried zero; the five-bit WUBRG mask moves into those five. See §5 for the layout. No offset moves, no file grows, and the stride-12 interleaved upload is unchanged.

`contractVersion` goes to **2**, and this one is a genuine break in both directions:

- a **v1 decoder reading a v2 file** takes byte 7 whole and reads mono-green as hue class 132, indexing the seven-element `uHues` past its end;
- a **v2 decoder reading a v1 file** would read every identity as 0 — colourless — and dim every coloured card under a colour filter.

Both failures are silent, which is exactly the case §10's version rule exists for. Contrast the 0.2.0 entry above, where bumping would have been the *breaking* option: there the change was unobservable to any decoder, here it is observable to all of them. `pipelineVersion` moves 0.3.0 → **0.4.0** for the added field.

Every artefact re-hashes, so all three datasets were regenerated: `fixture-small` `a609e157836c79f0`, `fixture-scale` `7bd31529bcc71780`, production `d5ee9661aaffafa3` (the same 28 587 cards from the pinned 2026-09-04 bulk). Those four hashes are the record of *that* change and are deliberately not updated when a later refresh moves them; the committed hashes today are `1868a1c21c63f474`, `3e9be89b4e3e9bdb` and `dabe2c9a68b4d799`, and §8's table cites those. The test vector moved from `contract/test-vectors/v1/` to `v2/`.

Three things a reviewer should check rather than take on trust:

1. **Both halves of the byte agree.** The identity's bit indices are the same as `hueClass`'s five mono values, so `identity == 1 << hueClass` for every mono-coloured card. Pinned on both sides — `test_colour_byte_packs_every_identity_arity` and the vector's `colourChecks`, which records the packed byte itself because that is the only place the packing is observable.
2. **Nothing reads byte 7 unmasked.** Three consumers read it: `decode.ts`'s `hueClass` accessor (`& 0b111`), the star vertex shader (`int(aClass.y + 0.5) & 7`), and `starGeometry.hueClassOf`, which bypasses the decoder and reads the bytes directly — it feeds the focused card's rim colour and the thumbnail glow, and is the one a review is likely to miss. `filters/evaluate.ts` is unchanged and goes through the masked accessor, so **Phase 4 filter behaviour is byte-identical**; exact colour filtering is a separate leg.
3. **The budget.** Raw sizes are unchanged. `stars.bin` compresses 3.7% worse on production (229.1 → 237.6 KB brotli) because byte 7 now takes 31 values rather than 7. The constrained `search.json` + `sets.bin` row does not move at all — it does not include `stars.bin`. §8 has the table.

One operational note, found by running it. The PRD 4.9.2 run diff loads the previous production run's `sets.bin`, and `decode_header` tests the version for strict equality — so with a v1 dataset on disk the first v2 build **aborted before writing anything**. `report.load_previous_planes` now selects such a predecessor normally but does not decode it, returning it with no plane mapping. The run succeeds and loses **only the diff**: the predecessor is still the predecessor, so `previousRun` names it in the new manifest and the 4.9.2 chain stays unbroken, and 9.2.3 reads *"not computed — this run follows `…`, whose artefacts are still in the tree but record `contractVersion` 1"*. It must not read "no previous production run": that is a false claim about the data, distinct from both the real first run and the pruned-artefacts case of PRD 8.8.3, and `report.py` keeps the three apart as three states. Any future contract bump would have hit this too, which is why the version skip is pinned by tests rather than left to the next bump to rediscover.

### v1, `pipelineVersion` 0.2.0 — Phase 1 first run, 2026-09-04

Two values were **added** to the `l` layout union (§9). Both came from the first real run, which failed loudly on them per PRD 7.7.2 rather than guessing at a URI:

| Layout | What it is | Back image | Reaches a shard |
|---|---|---|---|
| `prepare` | Secrets of Strixhaven's two-faces-on-one-side layout. Like `split`, Scryfall gives it no top-level `oracle_text` at all — the text lives only in `card_faces` — so `b` **must** be populated | no | yes, `sos`/`soc`/`plst` |
| `front_card` | A Jumpstart theme card | no | no — every set carrying one is `set_type: memorabilia`, which PRD 4.3.2 drops |

`contractVersion` stays **1**. No byte layout, section id, filename, or numeric enum value changed. `pipelineVersion` moved to 0.2.0 to mark it.

What makes the addition safe is that a decoder never enumerates this union at runtime: its only consumer is the `BACK_IMAGE_LAYOUTS` allowlist behind `hasBackImage`, so a v1 decoder meeting a layout it has never heard of answers "no back image" — the correct answer for both new members, verified against the committed artefacts. It is **not** that the new values go unobserved; `prepare` does reach a shard, 46 cards of it in `planes/arcavios.0.json` of the production dataset. The distinction is load-bearing for the *next* addition: a future layout that does have a back image would be read wrongly by an un-widened decoder, silently, and must bump `contractVersion`.

**§10 review: complete.** Signed off independently from the web-decoder side and the tools/consumer side, both measuring compatibility rather than arguing it: the Phase 0 decoder was run verbatim over all 89 production shards of the 2026-09-04 first-run dataset and its 28,587 cards, and agreed with the Phase 1 decoder on every card and printing. (That count is the historical record of what was measured; the roster amendment below re-shards the same 28,587 cards into 93.) Note that bumping to 2 would have been the breaking option — `assertContractVersion` and `decodeHeader` test strict equality, so every deployed v1 decoder would throw on `stars.bin` and all 93 shards of the current dataset for a change no consumer can observe.

The union is closed over three sources that must agree: `LAYOUTS` in `contract/enums.py`, `CardLayout` in `data/types.ts`, and `backImageChecks` in the test vector, which pins `hasBackImage` for every member on both sides.

### v1, `pipelineVersion` 0.3.0 — Appendix A roster amendment, 2026-09-04

Four zero-card planes joined the PRD Appendix A roster (Kandoka, Foldaria, Clamhattan, Horsehead Nebula). That changes the plane count and every plane's layout position, so the dataset re-hashes, but **no contract surface moved**: no format, field, enum or filename changed.

`manifest.json` may now carry one optional key, **`previousRun`** (§3): the `dataHash` of the run whose plane assignments this run's 4.9.2 diff was taken against. It is absent when there is no predecessor — every fixture, and a first production run. Decoders ignore it; it exists so the committed run report stays reproducible after 8.8.3 deletes the superseded directory in the same commit.

Adding that key is a field addition, so `pipelineVersion` moves 0.2.0 → **0.3.0** per the §10 rule, and every manifest is regenerated at the new version — including the ones that do not carry `previousRun`, because the version names the encoder, not the key set of one file. `contractVersion` stays **1**. The bump is hash-neutral: `manifest.json` is excluded from `dataHash` (§3), so no directory is renamed and no fixture hash moves. Reconciling two manifests by `pipelineVersion` is therefore sound again — 0.2.0 means "no `previousRun` key exists", 0.3.0 means "the key may be present or absent by the rule above".
