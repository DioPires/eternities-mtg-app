# Eternities: data contract v4, first version (the layout files)

**Status:** first version, written by leg 1 of the second slice (PRD v4 9.6, DEC-1004). It covers the three files that carry one world's layout, their fixtures and the hero-volumes file. Every other file of contract v4 is Wave 5, and section 7 lists them.
**Authority:** `prd_v4.md` 4.13 (items 3 and 5), 4.16.3, 5.4, 5.4.14, 5.4.18 and 5.13.2. Where this note and the PRD disagree, the PRD wins.
**The frozen contract:** `docs/data-contract.md` is contract v3. It stays as it is, and the web edition reads nothing of this note.

| Side | Path |
|---|---|
| The allocator and the emission (Python) | `pipeline/src/eternities/layout/` |
| The independent checker (Python) | `pipeline/src/eternities/layout/check.py` |
| The fixtures | `contract/test-vectors/v4/layout/` |
| The decoder (C#) | `unity/Eternities/Assets/Scripts/Data/`: `StandsFile.cs` (`stands.bin` into structure-of-arrays native collections), `WorldDocument.cs` (the world and lore documents) and `WorldFiles.cs` (`WorldData`, with the assertions of PRD 4.13.3) |
| The second checker (C#) | `unity/Eternities/Assets/Scripts/Layout/Checker.cs`, with the predicates of `Predicates.cs`; the EditMode tests compare its document with every fixture's `check.json` |

The fixtures are the arbiter. `eternities layout fixtures --check` makes every fixture again and compares its bytes; the hosted `pipeline` job runs it on every pull request.

## 1. Where the files stand

`eternities layout build <slug>` writes one world's files into `unity/Eternities/Assets/StreamingAssets/data/<hash>/`, beside the copied v3 pack (4.13.1), and only when the independent checker passes: the files go first to a temporary folder beside that directory and are then moved into place, so a build that the checker fails leaves no file there. Git ignores that directory. The committed copy of a world's files is its fixture (section 6).

```
<out>/
  stands.bin            # the records of the worlds laid out; leg 1 writes one world's
  worlds/<slug>.json    # the world's geometry
  lore/<slug>.json      # a hero world's resolved lore tables; no file for a kit world
```

The Unity project's generation entry point fills the same directory without Python: it copies the committed fixture's three files beside the copied v3 pack and decodes them once (`unity/Eternities/README.md`).

The layout report and the checker's document are not part of the pack. The command writes them to `pipeline/.cache/layout/<slug>.md` and `<slug>.check.json`, or where `--report` says.

## 2. Shared conventions

- **Units.** Every length is a whole number of millimetres and every angle a whole number of micro-degrees (5.4.18 (1)). A position is `x`, `z` in the world frame: the plaza's centre is the origin and north is `+z`. A yaw is counter-clockwise from `+x`.
- **Rounding.** A coordinate is the allocator's exact world value rounded once, half away from zero (5.4.18 (3)). A site's shapes are built in the site's frame, so the exact value is moved by the site's centre first and then rounded: a local z of 6,519.5 mm at a centre z of −100,000 mm is emitted as −93,481, not as 6,520 − 100,000 = −93,480. A polyline's vertices were rounded when the polyline was built (5.4.18 (5)), and a whole coordinate (a polyline vertex, a pad's centre, a lattice point) is moved as it is.
- **Arc length.** A polyline segment has the integer length `isqrt(dx² + dz²)`. The arc length to a vertex is the sum of the lengths before it. A reader that needs an arc length computes it this way.
- **Discs.** A disc is the 72-gon of the trig table's directions of every 5 degrees times the radius (5.4.18 (13)). The files carry a disc as its centre; its radius is a constant of 5.4.1.
- **The canonical JSON form.** A JSON file is one line: the keys of every object sorted by code point, no white space, non-ASCII text as itself in UTF-8, and one line feed at the end. This is the serialisation of Appendix F.2 (`eternities.lore.digest.canonical`), so one rule gives the acceptance digest and the pack's bytes.
- **Byte order.** Little-endian, except the 16 `oracle_id` bytes, which are in RFC 4122 network order (contract v3, section 6.1).

## 3. `stands.bin`

The 16-byte header of contract v3, section 2, with `contractVersion` 4 and kind 1. Kind 1 was v3's star records and is v4's stand records: the version tells them apart. `recordCount` is the stand count. Then one 48-byte record a stand, as PRD 4.13.3 lists the fields:

| Offset | Size | Type | Field |
|---|---|---|---|
| 0 | 16 | bytes | `oracle_id` |
| 16 | 1 | uint8 | plane index |
| 17 | 1 | uint8 | colour identity mask |
| 18 | 1 | uint8 | class, derived from the mask |
| 19 | 1 | uint8 | rarity class |
| 20 | 1 | uint8 | card-type mask |
| 21 | 1 | uint8 | back-image flag |
| 22 | 2 | uint16 | site index into `sites` of `worlds/<slug>.json` |
| 24 | 2 | uint16 | set id of the first printing |
| 26 | 2 | uint16 | included printing count, capped at 65,535 |
| 28 | 4 | int32 | `x` |
| 32 | 4 | int32 | `z` |
| 36 | 4 | int32 | yaw: the direction the image surface faces |
| 40 | 2 | uint16 | swatch, RGB565 |
| 42 | 2 | uint16 | shard index within the plane |
| 44 | 2 | uint16 | index of the card within its shard |
| 46 | 2 | uint16 | cluster index within the site |

The records are sorted by plane index, site index, cluster index, then `oracle_id` bytes. The **stand index** is a record's position in the file. The order is not the placement order (4.13.3): join by stand index or by `oracle_id`.

A yaw is always a whole number of thousandths of a degree, so `yaw / 1000` is a count of the trig table. The stand's footprint, apron and corridor follow from `x`, `z`, the yaw and the constants of 5.4.1; the corridor ends on the site's path vertex that `worlds/<slug>.json` names for the stand.

## 4. `worlds/<slug>.json`

One object. Every coordinate pair is `[x, z]`. A pose is `{"x", "z", "yaw"}`.

| Key | Value |
|---|---|
| `contractVersion` | 4 |
| `slug`, `planeIndex`, `dataHash` | the plane, its index, and the name of the pack the cards were read from |
| `law` | `hero` when the world is laid out from lore tables, `kit` otherwise |
| `radius` | R. The world is the regular 72-gon of this radius about the origin |
| `standCount` | the number of the world's records in `stands.bin` |
| `arrival`, `returnPortal` | poses. The arrival point is the origin, facing north. The return portal stands 8 m south of it, facing it |
| `plaza` | `radius` (12,000), `edgeRadius` (15,000) and `approach`: the two ends `[near, far]` of the plaza approach's centreline, or null for a world with no site |
| `pads` | every pad: `owner` (`return` or a site key), `x`, `z`, `radius`. The return portal's pad is first |
| `heroVolumes` | every hero volume: `id` and `polygon` |
| `regions` | in region-table order: `id`, `name`, `kit`, `variant`, `water`, `ambient` (the region row's ambient family, or null when the row names none; the engine takes the theme row's family), `cell` (the cell's polygon) and `firstSite` (the index of the region's first site, or null). A kit world has one region, the whole world, and its `id`, `name`, `kit`, `variant`, `water` and `ambient` are null |
| `sites` | in site order; see below |
| `trail` | `legs` and `junctions`; see below |
| `stands` | two arrays indexed by stand index: `vertex`, the index of the corridor's vertex on the site's `path`, and `arc`, that vertex's arc length along the path |

A **site**:

| Key | Value |
|---|---|
| `key`, `kind` | `era:<id>`, `region:<id>` or `set:<code>`; `era`, `region` or `set` |
| `regionId`, `eraId` | the region the site stands in (null on a kit world) and, for an era site, its era |
| `setIds` | an era site's sets with first printings on the plane, in release order; a set site's one set; empty for a regional site |
| `centre`, `radius`, `boundingRadius` | c_s, the final r_s and b_s |
| `blob` | the blob's 72 vertices |
| `path` | the site path's centreline from the head, after the trim (5.4.10) |
| `pad` | the pad's pose: its centre, facing the site's centre along the head ray |
| `approachPoint` | where the trail attaches. The approach is the strip from the pad's centre to this point |
| `stone` | `kind` (`reading`, `way` or `marker`, 5.4.16) and its pose, facing the pad's centre |
| `clusters` | the occupied clusters in slot order: `centre`, `arc` (the slot's arc length) and `stands`. A cluster's index is its position in this list |
| `chapters` | an era site's non-empty chapters in release order: `setId`, `firstStand` (a stand index), `firstCluster`, `stone` (the chapter stone's pose, or null for the first chapter) and `destination` (the pose travel arrives at: the chapter stone's, or the pad's for the first chapter). Empty for the other kinds |

The **trail**: `legs` is every leg in leg order: `id`, `kind` (`trail` or `spur`), `from` (`plaza`, a site key, or `trail` for a spur), `to` (a site key), `polyline` (the centreline with its two attachment segments) and `startAttachment` and `endAttachment` (each attachment segment's two ends). `junctions` lists every end of a leg once: `point`, `owner` (`plaza` for the plaza approach's far end, a site key for an approach point, null for the vertex where a spur leaves the trail) and `legs`, the ids of the legs that have the point as a vertex.

## 5. `lore/<slug>.json`

One object, for a world laid out from lore tables (4.16.3).

| Key | Value |
|---|---|
| `contractVersion`, `slug` | 4 and the plane |
| `kind` | `lore` or `product`, as `eras.json` says |
| `digest` | the acceptance digest of the three tables (Appendix F.2) |
| `regions` | in table order: `id`, `name`, `sentence` (its text and source) and `sources` |
| `eras` | in table order: `id`, `name`, `years`, `region`, `sets` (the row's set codes), `setIds` (the ids of those sets that have first printings on the plane), `paragraphs` (each sentence with its text and source), `sources` (the paragraphs' sources, each once, in order of first use) and `headline` (stand indices, 5.13.2) |
| `keywords` | the keyword table's rows in table order: `word` and `region` |

## 6. The fixtures and the hero-volumes file

Each fixture is a directory under `contract/test-vectors/v4/layout/`. Its manifest `fixture.json` names its inputs; its outputs stand beside the manifest.

```
<name>/
  fixture.json          # slug, pack, tables, hero volumes, expect, purpose
  pack/                 # a synthetic contract v3 pack (text only), when the fixture has one
  <slug>/               # a synthetic plane's three lore tables, when the fixture has them
  volumes.json          # a hero-volumes file, when the fixture names one
  stands.bin  worlds/<slug>.json  lore/<slug>.json  report.md  check.json
  failure.txt           # instead of the five outputs, for a fixture that must fail
```

- `fixture.json`: `slug`; `productionPack` (a data hash under `web/public/data/`) or a `pack/` directory; `productTables` (true reads `pipeline/data/lore/<slug>/`) or `lore` (a directory inside the fixture); `tablesDigest` (the Appendix F.2 digest of the tables read; a fixture that reads the product tables records it, and a run compares it before the layout and fails naming both digests); `loreFixture` (validate under `--fixture`, 5.4.14); `heroVolumes`; `expect` (`layout` or `failure`); `purpose`.
- `check.json` is the independent checker's document: `result`, `violationCount`, `violations`, `assertions` (how many items each rule tested) and `figures` (the least distance between two stands, whether the path network is connected, and each site's three gaps and path length).
- `failure.txt` is the failure's class and message, and one line feed.
- `predicates/` holds three predicate documents: the two predicate fixtures of 5.4.14 (the notch, `strip-inside-polygon`; the nested squares, `polygons-intersect`) and the notch vertex (`polygon-inside-polygon`: a square whose top edge runs across a notch whose sides meet two of its vertices is not inside). Each is one document that states two shapes, `verticesInside`, `edgeCrossings` (the pairs of edges that share a point, touching included) and the verdict, in a form both checkers read.
- `pipeline/scripts/layout_fixture_inputs.py` writes the manifests and the synthetic inputs. `eternities layout fixtures` writes the outputs.

**The hero-volumes file** is the minimal form for the fixture and for `--hero-volumes`. The owner's exporter is Wave 5.

```json
{"plane": "dominaria", "volumes": [{"id": "fixture-keep", "polygon": [[180000, -150000], [300000, -150000], [300000, -30000], [180000, -30000]]}]}
```

`plane` is the slug. A volume has an `id`, a slug that no other volume of the file has, and a `polygon` of three vertices or more, each `[x, z]` in whole millimetres in the world frame. The file holds nothing else. A volume is used as it is given: no step clips it to the world polygon, because no test reads the ground outside the world.

## 7. Departures of leg 1 from the full contract v4, and what is Wave 5

Leg 1 lays one world out beside the slice's pinned v3 pack. Where a field of 4.13 refers to a v4 file that leg 1 does not emit, the v3 pack's equivalent stands in:

1. **The plane index** is the plane's position in v3 `planes.json`, not in a v4 `planes.json`.
2. **The set id** is v3's global set id, the one v3 `search.json` lists. v3 numbers sets by release date, ties by code, so the order of the ids is the release order of 5.4.2 and 5.4.3.
3. **`stands.bin` holds one world's records**, not all 28,603. The header's `recordCount` is that world's stand count. While the file holds one world, the decoder refuses a record of another plane at world entry; the Wave 5 file, which holds every world, drops that assertion.
4. **The swatch** is one RGB565 colour: the mean, channel by channel and rounded half up, of the four samples of the card's v3 `swatches.bin` record. A synthetic pack has no `swatches.bin`, and its stands have the swatch 0.
5. **The shard index and the index within the shard** are the card's position in the plane's v3 shards, which are in v3's star order and not in stand order.
6. **The mask, the class, the rarity class, the type mask and the back-image flag** are derived from the card's v3 shard row by the v3 contract's own functions. A meld component counts as having a back image (4.13.3).
7. **The cards are read from the pack on disk** (`eternities.layout.cards.read_plane`), the same pack that `LoreIndex.from_pack` reads for the tables' validation.
8. **`planes.json`, `sets.json`, `sets.bin`, `search.json`, `themes.json`, `kits.json`, `avatars.json`, `manifest.json` and the v4 shards** are Wave 5, with the other worlds and the content hash of the engine pack. Until then the pack's directory is named for the v3 pack's hash.
