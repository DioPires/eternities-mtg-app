# Eternities — data contract v1

**Status:** frozen at Phase 0. Any change is a reviewed contract change (implementation plan §2 Phase 0, risk 2).
**Authority:** PRD `prd_v3.md` §8.3, §7.2, §8.6, §8.7, §8.8, as amended by A1 (implementation-plan.md §8).
**Implementations that must stay in lockstep:**

| Side | Path |
|---|---|
| Python encoder | `pipeline/src/eternities/contract/` |
| TypeScript decoder | `web/src/data/` |
| Shared byte-level test vector | `contract/test-vectors/v1/` |

The test vector is the arbiter. `pipeline/tests/test_test_vector.py` and `web/test/test-vector.test.ts` both assert against the same committed bytes, so a one-sided change fails CI.

---

## 1. Directory and immutability

All artefacts of one pipeline run live in a single content-hashed directory:

```
web/public/data/<dataHash>/
  manifest.json
  planes.json
  stars.bin
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
| 4 | `uint8` | kind: `1` = stars, `2` = sets |
| 5 | `uint8` | `contractVersion` = `1` |
| 6 | `uint16` | flags (see per-file notes; `0` today) |
| 8 | `uint32` | `recordCount` |
| 12 | `uint32` | reserved, `0` |

  16 bytes keeps the first record 4-byte aligned, so a decoder may create typed-array views directly over the received `ArrayBuffer` with no copy.

- **Enumerations** (used by the star record, `search.json`, and plane detail files):

| Name | Values |
|---|---|
| hue class | `0` W, `1` U, `2` B, `3` R, `4` G, `5` multicolour, `6` colourless |
| size class (rarity) | `0` common, `1` uncommon, `2` rare, `3` mythic — PRD 4.8: `special` → rare, `bonus` → mythic |
| card-type bit | `0` creature, `1` instant, `2` sorcery, `3` artifact, `4` enchantment, `5` planeswalker, `6` land, `7` battle (PRD 6.6.2) |
| plane kind | `dust`, `spiral` (≥ 50 cards), `irregular` (1–49), `empty` (0) — PRD 5.3.6 |

- **Star index** is the global 0-based index of a card's record in `stars.bin`. It is the join key for every other artefact. Records are ordered by plane index, then chronology band, then arm (PRD 8.3), so each plane owns a **contiguous** range `[starOffset, starOffset + starCount)`. Nothing stores a per-card plane id; it is recovered from the range.

## 3. `manifest.json`

Loaded first (PRD 8.7.2). Small, human-diffable, the single source of truth for what a run produced.

```jsonc
{
  "contractVersion": 1,
  "pipelineVersion": "0.3.0",   // 0.3.0 is the first version in which `previousRun` may appear
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
  "contractVersion": 1,
  "shardSize": 2000,
  "multiverseRadius": 100.0,       // R of PRD 8.6.1
  "discThickness": 15.0,           // 0.15 R
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
    "shearAmplitude": 0.0, "shearPeriodS": 0.0, "shearPhase": 0.0,   // PRD 5.4.13, radians
    "armPitch": 0.0, "discThickness": 0.05, "bar": false,            // PRD 8.6.2 seeded params
    "palette": [0.14, 0.2, 0.17, 0.18, 0.16, 0.1, 0.05],             // W U B R G multi colourless weights, sums to 1
    "nebulaTint": [0.32, 0.38, 0.55],                                // linear RGB, PRD 5.3.5
    "firstYear": 1993, "lastYear": 2026,
    "sets": [{ "id": 12, "code": "lea", "name": "Limited Edition Alpha", "year": 1993, "cardCount": 295 }]
  }]
}
```

`sets[].id` indexes the global set dictionary of `search.json` §7, which is the same id space as `sets.bin` §6.3. The list is in chronological order and is the chronology-band order of PRD 5.4.2, so band `b` of a plane is `sets[b]`.

The Blind Eternities is row 0 with the identity transform, radius `R` and zero spin, so its stars' local coordinates are multiverse coordinates scaled by `1/R` and the shader path is identical for every star (PRD 8.3).

## 5. `stars.bin`

Header kind `1`, `recordCount` = star count. Flags bit `0` is reserved for a float32-position variant (PRD risk 6's fallback); the emitted file is always float16 today and the bit is `0`. The GPU-side float32 fallback decodes at load, it does not need a second file.

**Record — 12 bytes**, exactly PRD 8.3:

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | `float16` | `x` | plane-local, within the frame radius 1.2 (PRD 8.6.2) |
| 2 | `float16` | `y` | |
| 4 | `float16` | `z` | |
| 6 | `uint8` | `planeIndex` | row in `planes.json` and in the `DataTexture` |
| 7 | `uint8` | `hueClass` | |
| 8 | `uint8` | `sizeClass` | |
| 9 | `uint8` | `brightness` | quantised log printing count, capped at the plane's 98th percentile (PRD 5.4.10) |
| 10 | `uint8` | `twinklePhase` | phase = `v / 256 · 2π` |
| 11 | `uint8` | `typeMask` | |

30 000 records = 360 016 bytes on the wire before compression.

The record is laid out so the whole file is uploaded as **one interleaved WebGL buffer**, stride 12: a `HALF_FLOAT x3` attribute at offset 0, an `UNSIGNED_BYTE x4` attribute at offset 6 (`planeIndex, hueClass, sizeClass, brightness`), and an `UNSIGNED_BYTE x2` attribute at offset 10 (`twinklePhase, typeMask`). No repacking on load. The mutable `filterMask` attribute of PRD 8.5.1 is a separate, CPU-owned buffer.

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
  "contractVersion": 1,
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

PRD 7.2 budgets the pair `search.json` + `sets.bin` at ≤ 700 KB target / 1.5 MB ceiling, **encoded transferred size**. Both datasets below are measured at brotli quality 11 — the numbers `web/scripts/check-budget.mjs` reports, re-measured against the committed artefacts of `1b06048e8b670c21` (`fixture-scale`: 30 000 stars, 87 planes, 476 sets) and `fe74a34ff803574b` (production: 28 587 stars, 87 planes, 294 sets):

| Artefact | Scale raw | Scale brotli | Production raw | Production brotli |
|---|---|---|---|---|
| `manifest.json` | 16.8 KB | 4.7 KB | 16.9 KB | 4.7 KB |
| `planes.json` | 87.9 KB | 13.4 KB | 69.0 KB | 11.5 KB |
| `stars.bin` | 351.6 KB | 262.0 KB | 335.0 KB | 229.1 KB |
| `search.json` | 909.3 KB | 128.8 KB | 578.1 KB | 181.2 KB |
| `sets.bin` | 666.2 KB | 543.4 KB | 624.0 KB | 487.2 KB |
| **`search.json` + `sets.bin`** | 1 575.5 KB | **672.2 KB** | 1 202.1 KB | **668.4 KB** |
| First frame (`manifest` + `planes`) | 104.7 KB | 18.1 KB | 85.9 KB | 16.2 KB |
| Before intro (adds `stars.bin`) | 456.3 KB | 280.1 KB | 420.9 KB | 245.3 KB |
| Largest plane shard | 838.6 KB | 204.6 KB | 1 212.7 KB | 339.9 KB |

**The pair is under its target and not comfortably so.** 672.2 KB is **96%** of the 700 KB target on scale and 668.4 KB is **95%** on production — both inside the ≥ 90% band, so the budget check reports them `[near target]` with a headroom warning (27.8 KB and 31.6 KB), not a bare `ok`. Read the row that way: the target holds today and one more sizeable set is what moves it. Only the 1.5 MB ceiling fails the build; the target is reported, per PRD 9.1.1–2, so a target overshoot is visible without blocking a merge. The first frame, before-intro and A1 shard rows all sit at or under a quarter of their targets.

`sets.bin` is dominated by `ORACLE_IDS` — one 16-byte UUID per star, 469 KB on scale's 30 000 and 447 KB on production's 28 587, all of it incompressible entropy that no layout choice changes. It is why the ids are 16 raw bytes rather than JSON hex strings, which would cost ≈ 1 MB and break the budget on their own.

Two things to read the table with:

1. The two columns are close on the pair and far apart on its halves, which is not a coincidence. `fixture-scale`'s card names come from a 16×16 synthetic vocabulary, so its `search.json` compresses about 2.2× better per byte than real Magic card names do (7.05:1 against 3.19:1) — production's `search.json` is *smaller raw* (578 KB against 909 KB) and *larger brotli* (181 KB against 129 KB). Scale pays that back on `sets.bin`, having 1 413 more stars to carry ids for. So scale remains a fair proxy for the pair as a whole, and is not a proxy for `search.json` alone.
2. If a later run overshoots the target and the owner wants it back, the documented lever is: truncate `ORACLE_IDS` to the leading 8 bytes and keep the full id only in the plane detail shards, which a card focus always loads first. That saves 234 KiB ≈ 240 KB. It is *not* done now, because it makes the star → `oracle_id` direction depend on a shard fetch, and PRD 8.3 asks for a `star index ↔ oracle_id` table. Taking the lever is a contract change.

   The collision probability if it is ever taken is **≈ 3.9 × 10⁻¹⁰** at 30 000 ids, not the 2 × 10⁻¹¹ this document carried before. Oracle ids are UUIDv4 (Sol Ring is `6ad8011d-3471-…`, byte 6 = `0x43`), and the leading 8 bytes contain the 4 fixed version bits, so a truncated id holds **60** random bits rather than 64 — a factor of 16 the earlier number missed. Still negligible against a 30 000-row table, so the lever stays sound; the number is now the right one.

**Amendment A1 budget row** (implementation-plan.md §8), added to the 7.2 table:

| Measure | Target | Ceiling |
|---|---|---|
| Largest single plane detail shard, encoded | ≤ 1.5 MB | 2.5 MB |

## 9. Plane detail — `planes/<slug>.<n>.json`

**Amendment A1:** *every* plane shards at `shardSize` = 2000 cards per file, not only the Blind Eternities. The filename always carries the shard number, including for a one-shard plane, so the loader has one code path. A card's shard is `floor(localIndex / 2000)` and needs no lookup table (PRD 8.3), where `localIndex = starIndex - plane.starOffset`.

```jsonc
{
  "contractVersion": 1,
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
    "p": [["91fdb56b-…", 12, "u", 1783903215, "266"]]  // printings
  }]
}
```

A printing is a fixed tuple `[id, setId, rarityChar, imageTs, collectorNumber]`, ordered by release date — the planet order of PRD 5.6.7. `rarityChar` is one of `c u r m` (already normalised per PRD 4.8).

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

- `contract/test-vectors/v1/` holds a hand-checkable dataset: `vector.json` (the inputs and the expected derived URIs) plus the encoded `stars.bin`, `sets.bin`, `manifest.json`, `planes.json`, `search.json`, `planes/*.json`. Python re-encodes it and asserts byte equality; TypeScript decodes it and asserts the values round-trip. Both run in CI.
- `web/scripts/check-budget.mjs` measures **brotli-encoded** size of the built shell and of the data directory's files, and checks them against the PRD 7.2 table plus the A1 row. Ceilings fail the build; targets are reported, and a row at or above 90% of its target is warned about so the run before the miss is visible.
- Adding a field is a minor change and bumps `pipelineVersion`. Changing a byte layout, a section id, an enum value, or a filename bumps `contractVersion` and requires a review by the Frontend Engineer and the Interactive Tools Engineer.

## 11. Change log

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
