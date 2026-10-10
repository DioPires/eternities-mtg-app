# Eternities — Product Requirements Document, v4

**Name:** Eternities (from the Blind Eternities, the space between planes)
**Document type:** Product requirements plus architecture for the overhaul decided on DEC-950. Deliberately excludes milestones and roadmap; Wave 5 is cut from this document after the vertical slice.
**Primary readers:** the five agent engineers (implementers) and Diogo (owner, level artist, reviewer).
**Status:** Accepted by the owner on 2026-10-10 (DEC-950 plan revision 7) as draft 5, after four Codex passes (plan §12.5, §12.6, §12.8 and §12.9). Amendment 1, 2026-10-10, after the owner's answers on DEC-950: 8.8.6 (the runner runs in the owner's own user session), 7.7.2, 8.9.1 and 11.7 (binaries are published from this repository's own GitHub Releases). Amendment 2, 2026-10-10, after the desktop-client re-verification of the Scryfall policy (DEC-952, `docs/scryfall-policy.md` §11): 4.15.1 names the two image hostnames, 4.15.3 states the cache fill rule, 4.15.4 rewrites the backoff rule, and 4.15.2 and 4.15.5 each carry one note. Amendment 2 erratum, 2026-10-10, after the DEC-954 review notes: 4.15.4 adds 400 to the pause rule, settles four readings of it and no longer leaves a URL for the session after network failures; 4.15.3 restores one word; 5.5.1, 11.4 and risk 9 catch up with Amendment 2. Amendment 2 erratum 2, 2026-10-10, after the DEC-955 review notes: 4.15.4 adds the idle retry after a network drop, the URL-builder test and four more readings. Nothing here is built.
**Date:** 2026-10-10
**Supersedes:** `prd_v3.md` for the product surface (sections 5 to 9 of v3). Sections 3 and 4 of v3 (domain model, data) and its Appendices A and B stay in force and are amended, not replaced, by sections 3 and 4 below. The committed pipeline tables under `pipeline/data/` are the canonical form of Appendices A and B; v3's text is the last full print and is already stale (it lacks the `forgotten-realms` plane).
**Basis:** the DEC-950 deep dive (plan document, revisions 1 to 5), the owner's decisions of 2026-10-10 (section 12), production dataset `a5846bec28d1447e` (88 planes, 28,603 cards, 72,811 printings, 42 planes with zero cards, 16 with 1 to 49), the Wizards of the Coast Fan Content Policy (fetched 2026-10-10), and two Codex reviews of this document (2026-10-10). Where this draft and the plan's sections 1 to 11 disagree, this draft is authoritative.

---

## 1. Summary

Eternities v4 is a free desktop application in which you walk the planes of the Magic: The Gathering multiverse as a planeswalker and look at the cards that were first printed there. You start in the hub, a dark space with one portal per plane. You step through a portal and arrive on a world: flat terrain built for that plane, with its own sky, light, weather, water, vegetation or metal or stone, ambient sound and music. The cards of that plane stand on the terrain as flat exhibits, laid out by a law you can learn: colour is the wedge you are in, time is how far you have walked from the centre, and each set is a site. Walk up to a card and the view changes: the card fills the frame, the world stays behind it, and a panel lists every printing to click through. Leave the view and keep walking. A travel menu opens a portal to any card by name.

It is a place you visit, not a game you play. There are no objectives, no score, no combat, no inventory, no progression and no winning state. Everything else about it, the environments, the third-person avatar, the lighting, the sky, the props, the sound and the feel of moving, is built to the standard of a modern 3D game.

Everything visible is still derived from data. The Python pipeline of v3 keeps every inclusion rule, the first-printing rule and the plane assignment. It gains one curated table (Appendix C: one theme row per plane) and emits a second data pack for the engine. The renderer moves from the browser to Unity 6 with the High Definition Render Pipeline. The shipped web application stays deployed as the web edition, refreshed with the same data, and remains the screen-reader path to the catalogue.

## 2. Goals and non-goals

### 2.1 Goals

1. **A place, not a game.** Eternities is an explorable gallery. Every feature must pass the test "would this still make sense in a museum?" Walking, looking, reading, travelling and listening pass. Points, quests, timers, rewards, enemies, unlocks and achievements fail. The Fan Content Policy forbids Wizards' IP in games or game components, free or not, and privacy of distribution is no exemption. This document cannot settle whether a walkable 3D gallery with a named avatar is a game in the policy's sense; section 10 risk 1 and open question 11.1 make that an owner decision, with a legal read, before the build is given to anyone outside the project, friends included. Until then every design choice is made to keep the product on the gallery side of the line.
2. **Game-grade feel.** Environments, avatar, lighting, sky, weather, water, props, sound and movement are built to the standard of a current 3D game. A plane with rivers and lakes shows and sounds like water; a plane of lava and ash shows and sounds like fire. This is the product's reason to exist after v3's "mesmerising by default", and it is a goal, not a polish item.
3. **Planes differ, in stages.** At every release a visitor can tell which **kit** they are on without reading a name, and two worlds on the same kit differ by their theme rows (sky, light, palette, weather, water, sound). The twenty largest entries of the roster (92.0 percent of all cards, including the Blind Eternities) additionally get hand-built hero set-pieces that make them unmistakable; those ship in stages, Dominaria first (8.12.4), and a hero entry without its set-piece is held to the kit standard until it has one. Pockets are identical by design: they hold nothing but a name.
4. **The picture is the data.** Where a card stands, which wedge and site it belongs to, how large a world is, which portals exist: all derived from real card data by one deterministic, terminating allocator (5.4). Nothing decorative is fabricated where a data-driven form is possible. The only curated visual input is Appendix C.
5. **Findable.** Any card, plane or set is reachable by search and by the travel menu without walking. Selecting a destination moves the avatar there through a portal without the visitor steering; the bench times it for same-world and cross-world destinations (7.2).
6. **Maintainable by one person.** Curated inputs are Appendices A, B and C, `overrides.json`, `avatar-overrides.json` and the hero volumes files. The pipeline fails loudly on anything it cannot place. Adding a set is one Appendix B row and one run; adding a plane is one row in each appendix. Hero set-pieces and avatars are the owner's own work and are additive to a working kit.
7. **Free, private, unofficial, compliant.** No accounts, no telemetry, no server. The Fan Content Policy notice is on the start screen. Scryfall is credited. Card images are shown as complete cards, flat, undistorted, untinted, with the artist line the card itself carries and a text credit beside it.

### 2.2 Non-goals (v4)

1. Any game mechanic: score, quests, objectives, timers, combat, inventory, collection meters, progression, unlocks, achievements, leaderboards, saving "progress" beyond settings and the recently-visited list.
2. Multiplayer or any online component beyond fetching images.
3. A web edition of v4. The v3 web application stays deployed and data-refreshed (8.11). A Unity web export is possible later and is not a goal.
4. Mobile, tablet, touch, VR.
5. Voice acting, licensed Wizards music or video, Wizards logos, set symbols, the planeswalker symbol or mana symbols as authored assets.
6. Steam or any store that frames the product as a game.
7. Universes Beyond and Secret Lair content, *Un*-sets, digital-only sets, tokens, emblems, art series, promos, oversized cards (as v3 2.2.3 and 2.2.4).
8. Gameplay data: prices, format legality, rulings, decklists, collection tracking.
9. Lore content beyond names and the plane's look: no plane descriptions, no story text, no character dialogue.
10. Automatic data refresh; the pipeline runs by hand.
11. Localisation; English only.
12. More than one avatar in v1 (Appendix D); no avatar selection screen in v1.
13. A second render pipeline (URP) in v1 (8.1.1).
14. Basic-land signposts, per-plane wedge dressing (Alara's shards, Lorwyn's two aspects), generative music, runtime texture compression, and screen-reader support in the native build. Each is recorded in section 11 with the reason it waits.

## 3. Domain model

Section 3 of `prd_v3.md` applies: entities (multiverse, plane, Blind Eternities, set, card, printing, face), relationships, invariants and the first-printing consequence. The following entities, invariants and vocabulary are added.

### 3.1 Added entities

| Entity | Definition | Identity |
|---|---|---|
| **World** | The rendered form of a plane with at least one card, the Blind Eternities included: one terrain, one sky, one sound set, the plane's cards standing on it. | plane slug |
| **Hub** | The arrival space: a compact void with the portal ring. It holds no stands. It is not the Blind Eternities' world; the Blind Eternities has a world of its own like any plane. | `hub` |
| **Pocket** | The rendered form of a plane with zero cards: a small void space that names the plane. All pockets share one theme row and are identical apart from the name. | plane slug |
| **Plaza** | The reserved centre of a world: arrival point, return portal, the hero landmark if any. No stands. | world |
| **Wedge** | A sector of a world holding one colour class: white, blue, black, red, green or gold (multicolour). | world + colour class |
| **Ring** | The outer annulus of a world holding the colourless cards, time running clockwise from north. | world |
| **Band** | The annulus of a world holding one set among the wedges: the plane's sets in release order from the plaza outward. Shared by all wedges. A set with no single- or multicolour cards on this plane has a band of zero width. | world + set code |
| **Site** | The exhibit area of one set and one colour class. A **wedge site** is one wedge crossed with one band. A **ring site** is the arc of the ring that holds one set's colourless cards. A site with five or more stands has a waystone; a smaller one has a marker stone. | world + set code + colour class |
| **Stand** | The exhibit of one card: an image surface on a plinth at a fixed position in a site, with a reserved apron in front of it and a corridor from the apron to a path. | `oracle_id` |
| **Path** | The reserved walkway network: a ring path at every band boundary and at the ring's inner edge, a radial path at every wedge boundary, and a spur from a path to every site centre. Water crosses a path only at a ford or bridge. | world |
| **Corridor** | The reserved 1.5 m wide strip from a stand's apron to the nearest point on the path network. Reserved against props and water, not against walking. | stand |
| **Portal** | A threshold between two spaces: hub to world, world to hub, or a travel portal that opens in front of the avatar and leads to a stand's apron or a site's pad. | source + destination |
| **Pad** | A reserved 3 m disc where a traveller arrives: one at every site centre, one in front of every waystone, one in front of every hub portal, and the return portal's. | world + owner |
| **Waystone** | A marker at a site of five or more stands and at every wedge boundary on every band boundary, naming the set and year or the colour. Usable for travel to neighbouring waystones. | world + site or boundary |
| **Avatar** | The planeswalker the visitor moves as. v1 ships one, Teferi (Appendix D). | planeswalker subtype |
| **Theme row** | The curated Appendix C row that selects a plane's kit and tunes it. | plane slug |
| **Kit** | A procedural biome: terrain layers, water, vegetation or structure props, sky, lighting rig, weather, particles and sound set. Twelve kits (5.6). | kit name |
| **Hero volume** | A simple shape (box or cylinder) exported from the editor by the owner, inside which the pipeline places no stand, apron, corridor or pad and the kit places no prop. | world + volume id |

### 3.2 Added invariants

6. Every plane in Appendix A is reachable from the hub through exactly one portal, the Blind Eternities included: 88 portals.
7. Every included card has exactly one stand, in the site of its first-printing set and the wedge or ring of its colour class, in the world of its plane.
8. Stand positions, wedge angles, band radii, ring arcs, site centres, aprons, corridors, paths, pads, world size and portal placement are a pure function of the input data, the appendices, the hero volumes files and the fixed seed, computed by the allocator of 5.4 in integer millimetres. A refresh may move them; a release never changes them under the user. Stands are fixed once the pack is emitted; no runtime system moves a stand.
9. **Exclusions by geometry type, checked on the final (jittered) positions.** No two stands are closer than 2.5 m. A stand's footprint and apron intersect nothing else: not a path, not a pad, not a corridor of another stand, not the plaza, not a hero volume, not another stand's footprint or apron. A corridor intersects no footprint or apron of another stand, no hero volume and no plaza, and ends on a path; corridors may cross each other and may cross a pad's edge. A pad lies on the path network by design (a site pad at the end of its spur, a waystone pad at a path junction, a hub portal pad on the ring path) or inside the plaza (the return portal's pad), and intersects no footprint, apron, hero volume or other pad. A hero volume may overlap the plaza but not the arrival point, the return pad or any path. The independent checker applies exactly these rules to the emitted geometry, lists violations in the report, and the build fails on any.
10. The path network is connected; every site pad touches it (the spur's end) and every waystone pad sits on it; every corridor reaches it; and the kit may not block a path or a corridor except with a ford or bridge prefab. The checker asserts connectivity on the emitted network.

### 3.3 Vocabulary

One term per concept throughout this document and the codebase. These replace the v3 star vocabulary; v3's data terms (plane, card, printing, first printing) are unchanged.

- **plane** for the domain object, **world** for its rendered form; never "level", "map" (except for the HUD map), "galaxy" or "setting".
- **hub** for the arrival space; never "lobby" or "menu".
- **stand** for a card's exhibit; **image surface** for the part that shows the card; never "pedestal" or "card object". **Panel** is used for exactly one thing: the card view's printings panel (5.10.3).
- **plaza**, **wedge**, **ring**, **band**, **site**, **path**, **corridor**, **pad**, **waystone**, **portal**, **apron**, **hero volume** as defined above.
- **avatar** for the planeswalker the visitor moves as; never "character" or "player model".
- **explore** for the third-person walking mode, **card view** for the focused mode, **map** for the top-down HUD overlay.
- **travel** for any movement that is not walking: portals, waystones, the travel menu.
- **kit** for a procedural biome, **theme row** for a plane's Appendix C row, **hero set-piece** for hand-built geometry on a hero entry.
- **internal evaluation** for use by the owner and the agents; **distribution** for giving the build to anyone else, friends included.

## 4. Data requirements

Section 4 of `prd_v3.md` applies in full: sources, identity, printing inclusion, card exclusion, first printing (as amended 2026-09-04), plane assignment, roster, retained fields, pipeline outputs, refresh, attribution. The following subsections are added.

### 4.12 Appendix C: plane theme table

1. **Source form.** Two YAML files under `pipeline/data/`: `kits.yaml` with one entry per kit (5.6.1) holding every field's default, and `themes.yaml` with one entry per plane in Appendix A that has at least one card, plus one `pocket` template entry. A theme entry names its `kit` and may set any field; a field it does not set is taken from the kit, and the report prints the resolved row so inheritance is explicit, never silent. A plane with cards and no entry fails the build. The 42 empty planes are not listed by hand: the pipeline generates their rows from the `pocket` template each run and lists them in the report.
2. **Fields and allowed values.** `kit` (one of the twelve kits); `hero` (true or false; true only for the twenty entries in Appendix C.1); `sky` in {clear, cumulus, overcast, storm, night, starfield, haze, dusk, dawn}; `light` as `{elevation: degrees, tone: warm | neutral | cold}`; `palette` as exactly three sRGB hex colours; `weather` in {none, fog, rain, snow, ash, sandstorm, fireflies, embers}; `water` in {none, river, lake, river+lake, sea, canals, marsh, lava, oil, waterfall}; `ambient` in {meadow, forest, surf, desert-wind, volcanic, alpine-wind, marsh, moor-wind, city, workshop, machinery, void, jungle, campus}; `music` in {heroic, grand, gothic, serene, epic, mythic, adventurous, whimsical, solemn, bright, industrial, ominous, swing, western, ambient}; `set_piece` (free text, a proposal for the owner, not validated beyond being a string); `hero_volumes` (path to the exported volumes file, hero rows only, may be absent until the owner exports one).
3. **Validation.** Unknown kit, unknown value, a `hero: true` outside C.1, a palette with other than three colours, or a hero volumes file that fails to parse, each fails the build.
4. **Emission.** The resolved rows are emitted into the engine data pack as `themes.json` (4.13). The kit defaults are emitted as `kits.json` so the engine never carries a second copy of the table.

### 4.13 Engine data pack (contract v4)

1. The pipeline emits a second artefact directory for the engine, content-hashed exactly as the web pack (data contract v3 §1), under `unity/Eternities/Assets/StreamingAssets/data/<hash>/`. This is **contract v4**, documented in `docs/data-contract-v4.md`, with byte-level test vectors under `contract/test-vectors/v4/` asserted by both the Python encoder and the C# decoder. The web pack and contract v3 stay frozen for the web edition (8.11).
2. **Files.** `manifest.json`; `planes.json`; `stands.bin`; `sets.bin`; `sets.json`; `search.json`; `themes.json`; `kits.json`; `avatars.json`; `planes/<slug>.<n>.json` card detail shards (as v3, including the `artist` field per printing) sharded at 2,000 cards in stand order.
3. **`stands.bin` record, 48 bytes, little-endian, one per included card, ordered by plane index, then class, then band index, then by `oracle_id` bytes.**

| Offset | Size | Type | Field |
|---|---|---|---|
| 0 | 16 | bytes | `oracle_id`, RFC 4122 network order (as contract v3 §6.1) |
| 16 | 1 | uint8 | plane index into `planes.json` |
| 17 | 1 | uint8 | colour identity mask: bit0 W, bit1 U, bit2 B, bit3 R, bit4 G; 0 means colourless |
| 18 | 1 | uint8 | class: 0 W, 1 U, 2 B, 3 R, 4 G, 5 gold, 6 colourless (derived from the mask; stored for the renderer; the decoder asserts agreement) |
| 19 | 1 | uint8 | rarity class: 0 common, 1 uncommon, 2 rare, 3 mythic (`special` as rare, `bonus` as mythic) |
| 20 | 1 | uint8 | card-type mask, the eight filterable types of v3 6.6.2 |
| 21 | 1 | uint8 | back-image flag: 1 if the first printing has a distinct back image under v3's face rules (transforming and modal double-faced cards, meld components), 0 otherwise (single-faced, split, adventure, flip and other layouts whose second face shares the front image). The flip control shows only when this is 1 |
| 22 | 2 | uint16 | band index: position of the first-printing set in the plane's release-ordered set list |
| 24 | 2 | uint16 | set id of the first printing, as in `sets.json` (the decoder asserts it is the set at the band index) |
| 26 | 2 | uint16 | included printing count, capped at 65,535 |
| 28 | 4 | float32 | `x` in metres, world frame, plaza centre at the origin, north is +z (the allocator's millimetre integer divided by 1,000) |
| 32 | 4 | float32 | `z` in metres |
| 36 | 2 | float16 | yaw in radians, the direction the image surface faces |
| 38 | 2 | uint16 | swatch, RGB565 (as contract v3 `swatches.bin`) |
| 40 | 2 | uint16 | shard index within the plane (`floor(local index / 2000)`) |
| 42 | 2 | uint16 | index of the card within its shard (the decoder asserts the shard record's `oracle_id` matches) |
| 44 | 4 | uint32 | reserved, zero |

The file begins with the 16-byte binary header of contract v3 §2 with version 4. 28,603 records are 1,372,944 bytes before compression. Decoder assertions on load: class agrees with mask; set id agrees with band index; shard and index resolve to the same `oracle_id`; plane index in range. Test vectors include a split card, an adventure card, a transforming card, a meld component, a card with 65,535 or more printings (synthetic) and a malformed join that must be rejected.

4. **`sets.bin`** keeps the v3 structure: per stand, in stand order, the list of included-printing set ids (uint16), so the set facet matches a card by any included printing at every level without loading a shard. **`sets.json`** carries set id, code, name, release date, set type, **effective plane slug** (the plane the set's first printings landed on through Appendix B directly or through a parent set under v3 4.6.3, or null when the set has no first printings), parent set code, and cards first printed there. A set has a site on a plane if and only if it has first printings there; the search and travel surfaces read that from the emitted site list, never from whether the set has its own Appendix B row.
5. **`planes.json`** carries per plane: slug, display name, kind (world, pocket), card count, release-ordered set list (id, code, name, year, cards first printed), plaza radius, wedge list (class, start angle, end angle), band list (inner radius, outer radius), ring inner radius and width, ring arc list (band index, start angle, end angle), site list (set id, class, kind wedge or ring, centre `x` `z`, stand count, waystone or marker, pad `x` `z` yaw), path network (polylines with ids), pads, return portal pose, world radius, terrain extent, theme row key, hero volume list. The hub's portal ring order and poses are carried under `hub`.
6. **`search.json`** as v3, plus for each card its plane index and stand index so a result resolves to a stand without a shard load, and for each set the list of (plane index, site index) pairs where it has sites. **`avatars.json`** per 4.14. **`themes.json`** and **`kits.json`** per 4.12.4.
7. The pipeline report gains: stands per world, world radius, plaza radius, band widths, ring arcs, the number of band or ring widenings the allocator needed per site, minimum spacing achieved, path connectivity result, hero volume intersections resolved, the Appendix C resolved rows, and the invariant-check results of 3.2.

### 4.14 Avatar roster derivation

1. The roster is the set of planeswalker subtypes that appear after the em dash in the type line of any face of any included card whose type line contains "Planeswalker" (`Legendary Planeswalker — Teferi` yields `Teferi`; a transforming planeswalker's back face counts). Multiple subtypes on one face each count. The subtype string is the display name; `avatar-overrides.json` may add aliases (a name the search also matches) and a display name.
2. `avatars.json` carries, per planeswalker: name, aliases, home plane, portrait printing id, colour identity union of their cards, and `modelled` (true only for an avatar with a model in the build). **Home plane** is the plane of the first printing of the earliest included card carrying the subtype, overridable. **Portrait** is the first printing of that same card, overridable. Ties between cards with the same release date break by set code then collector number, as v3 4.5.1.
3. Fixtures (asserted every run): the data-derived home plane of Teferi is the Blind Eternities, because the earliest included Teferi planeswalker card is Teferi, Temporal Archmage (Commander 2014); `avatar-overrides.json` sets Teferi's home plane to Dominaria and the fixture asserts both the raw and the overridden value. Jace's data-derived home is Lorwyn (Jace Beleren, Lorwyn 2007) and is left unoverridden in v1; his story origin is Vryn and that is not a home-plane rule.
4. "Your cards" for an avatar is every included card whose type line carries the subtype or whose name contains the planeswalker's name or an alias. It is a travel-menu section only. No count of it is shown anywhere; it is a lens, not a collection.

### 4.15 Scryfall on a native client

1. At runtime the application contacts only Scryfall's image CDN, which is two hostnames: `cards.scryfall.io` for card faces and `backs.scryfall.io` for the card back (5.10.2). Every other mention of "Scryfall's image CDN" in this document (7.5.1, 8.10, 9.1.6, Appendix E.8) means these two hostnames, and the loader refuses a redirect to any other host. It never calls the Scryfall API (`api.scryfall.com`); every card fact it shows is in the data pack. The pipeline, as in v3, fetches bulk data at build time. *Amendment 2 (2026-10-10, DEC-952): the first print said "exactly one host"; the card back is served from a second hostname, and a loader built to one shows no card back.*
2. Images are fetched at the size the view needs: `normal` (488 × 680) for stands, `large` (672 × 936) for card view. `small` and `art_crop` are not used. Images are never bundled, mirrored or bulk-downloaded. Scryfall's Imagery page (read 2026-10-10) lists WEBP sizes `grid` and `display` as replacing `normal` and `large` and announces no retirement, so the JPG sizes stay in use; the loader keeps each size's name and file extension in one table, and the refresh runbook's terms re-read includes that page. *(Amendment 2 note.)*
3. An on-disk cache under the OS application-support directory holds fetched images, capped (default 2 GB, least recently used eviction, user-adjustable). Clearing it is a settings action. The cache is filled only by images a view requested (5.5.5, 5.10.2): the hub's world preload (5.3.3) fetches no card image, nothing else prefetches, warms or crawls ahead of the visitor, and the cache is never exported, shared or served to another device. Each entry is keyed on the full image URL including its query string, and an entry older than the origin's `max-age` is treated as absent. *Amendment 2 (2026-10-10, DEC-952): the fill rule, not the cap, is what makes this a cache and not a mirror; 2 GB would hold about three quarters of the catalogue at `normal`.*
4. Requests carry an identifying `User-Agent` (`Eternities/<version> (+<repository URL>)`) and `Accept: image/*`; the image-path tests assert the outgoing `User-Agent`, because an engine's HTTP stack sends its own default unless one is set, and assert that the URL builder emits nothing outside the fixed path pattern over a validated UUID, because on the image hostnames a malformed path draws a 400 (probed 2026-10-10) and a 400 pauses every request. One concurrency limit applies: 6 in flight, counted across both hostnames. A 5xx response retries that URL with exponential backoff (1 s, 4 s, 16 s) and then leaves it for the session. A network failure retries the same way, but a URL left after network failures (every attempt a network failure; one 5xx among them leaves it for the session) becomes eligible again once any image request succeeds, so a dropped connection does not pin stands on their swatches until restart. While any URL is left after network failures, no pause is in force and no image request is in flight, the loader retries one such URL every 30 s, so a visitor who stands still gets images back without doing anything. A 429, a 403 or a 400 from either hostname pauses every image request, not only that URL, for at least 30 s (longer if `Retry-After` says so), queues that URL again, doubles the pause as served on each repeat (the next pause is the longer of twice the last and its own `Retry-After`), and resumes with one request in flight until a request succeeds, then returns to six. A 429, 403 or 400 that arrives while a pause is in force, including from a request already in flight when the pause began, belongs to that pause and is not a repeat; its URL is queued again. The third such pause in a session is not served: the loader stops fetching for the rest of the session and stands show their swatches (an image already resident or on disk still shows, 7.4.3). A redirect the loader refuses (4.15.1) is final for that URL for the session. Any other 4xx is final for that URL for the session. There is never a retry storm. The web edition's `docs/scryfall-policy.md` was re-verified for a desktop client on 2026-10-10 (DEC-952, §11 of that document), a 9.5 prerequisite. *Amendment 2 (2026-10-10, DEC-952): the first print backed off per URL, with retries at 1 s, 5 s and 21 s that all fall inside the 30 s for which Scryfall limits access after a 429, and treated a 403 as a missing image; a missing image is a 404.* *Amendment 2 erratum (2026-10-10, DEC-954 review notes N2 and N5 to N8): 400 joined the pause, because Scryfall's Access FAQ puts 400 beside 403 for its static files and a 400 is a statement about the client's request, not about one image; the pause, repeat and probe readings above are the ones the slice builds; a network failure no longer leaves a URL for the session.* *Amendment 2 erratum 2 (2026-10-10, DEC-955 review notes N10 to N12): the idle retry every 30 s, so a visitor who stands still recovers from a network drop; the URL-builder test, because on the image hostnames a 400 answers a malformed path (the first erratum's reason, rejected headers, describes the API host); and four readings the sentence left open are now in its text: the URL that drew the pause is queued again, the pause doubles as served, only a URL whose every attempt was a network failure returns, and a resident image stays after the stop.*
5. **Attribution.** Only complete card images are shown, and a complete card carries its artist line in the printed frame. In addition, card view shows the artist as text beside the printings panel (5.10.3) and the stand's hover label shows the artist (5.5.3). A screenshot therefore always contains the printed credit of every visible card image; a stand showing its swatch shows no image and needs no credit. The image surface, on a stand and in card view, takes its aspect from the image's pixel dimensions (488 × 680 and 672 × 936, about 5:7), never a nominal ratio, so the image is not stretched. *(Amendment 2 note: Scryfall's "do not distort, skew, or stretch" guideline; a 5:7 surface would stretch a `normal` image by 0.5 percent.)*

## 5. The world

### 5.1 Principles

1. **Game-grade place.** The reference is a current third-person 3D game's environment art, not data visualisation. Real terrain, real water, real sky, real sound.
2. **The cards are exhibits.** Every card image is shown as a complete card, flat, upright, undistorted, untinted by lighting, exposure, fog or post-processing, and sharp. The world is lit; the cards are not. 8.4.4 names the rendering path that makes this true and the tests that check it.
3. **Never static.** Water flows, grass and trees move, clouds drift, particles rise, the avatar idles. Stillness happens only where the user asks for it (card view, reduced motion).
4. **One law for every world.** Plaza, wedges, bands, sites, ring and paths follow 5.4 on every world, so a visitor who has learned one world can read them all.
5. **Constrained freedom.** The avatar can go anywhere on the terrain and nowhere off it. World edges are natural (sea, cliffs, mist, a void) and never an invisible wall at a visible edge.

### 5.2 Rendering vocabulary

| Domain object | Rendered as | Term |
|---|---|---|
| Arrival space | Hub: a compact void with the portal ring; no stands | hub |
| Plane with cards, Blind Eternities included | World: flat terrain, kit, optional hero set-piece | world |
| Plane with zero cards | Pocket: a small void that names the plane | pocket |
| Colour class W, U, B, R, G, gold | Wedge | wedge |
| Colourless | Ring at the rim | ring |
| Set | Band (annulus) among the wedges; an arc of the ring; crossed with a class, a site | band, arc, site |
| Card | Stand: an image surface on a plinth, `normal` image near, swatch far | stand |
| Printing | A row in the printings panel; the card face when active | printing |
| Avatar | Third-person planeswalker | avatar |

### 5.3 The hub

1. The application opens in the hub after the start screen. The hub is a compact void under a slow starfield, lit cold, on the `void` kit with its own hero set-piece: the **portal ring**.
2. **88 portals** stand on a ring of radius 56 m around the arrival point, 4.0 m apart centre to centre (circumference 352 m), one per plane in Appendix A including the Blind Eternities. Order: clockwise from north by the plane's first appearance year, ties by slug; empty planes last, alphabetical by slug. Each portal has a 3 m ring, a 0.5 m frame on each side (envelope 4 m, so neighbours touch at the frame and never overlap) and a 3 m pad in front of it toward the centre. Portal height scales with the log of the plane's card count in three steps; an empty plane's portal is small and dim but present (invariant 6). A waystone beside each pad shows the plane's name and card count.
3. **Preload.** At most one world preloads at a time: the one whose portal pad the avatar is nearest within 10 m. Changing the nearest portal cancels the previous preload after a 1 s hysteresis. Stepping into a portal whose world is not loaded uses the hold of 5.9.2.
4. The hub holds no stands. The Blind Eternities' 4,204 cards stand in the Blind Eternities' own world, reached through its portal like any plane; that world uses the `void` kit at world scale (Appendix C.1).
5. The hub has the travel menu (6.6), search and settings. The map in the hub shows the portal ring. Esc from any world returns to the hub through the return portal.

### 5.4 The world layout law and its allocator

The law a visitor learns: **colour is the wedge, time is the radius, each set is a site.** Walking a circle at one radius keeps you in one era across every colour. Walking outward moves forward in the plane's history. The allocator below makes the law a terminating, deterministic procedure; the pipeline runs it and the engine only reads the result. 5.4.14 states what has been computed so far and what has not.

**5.4.1 Constants.** Sizing heuristic A = 10 m² per stand. Lattice pitch p = 3.0 m; jitter radius j = 0.25 m, so any two stands are at least p − 2j = 2.5 m apart. Stand footprint 0.7 × 0.3 m; apron 1.0 m wide × 1.5 m deep on the side the image surface faces; corridor width 1.5 m. Path width 3 m. Pad: a 3 m disc. Plaza radius: max(12 m, 0.05 × world radius). Minimum band width 6 m; minimum ring width 6 m; minimum ring arc length 6 m at the ring's mid radius. Wedge angle bounds as in 5.4.4. Widening step 10 percent; at most 20 widenings per band or arc; at most 20 outer iterations. Prop clearance 1 m around paths, corridors, aprons and pads; water buffer 3 m around the same. All geometry is computed and stored in integer millimetres; angles in integer micro-degrees; the engine divides by 1,000 to get metres. PRNG: splitmix64, seeded per site with FNV-1a 64 of the string `eternities-v4|<plane slug>|<set code>|<class>`; the only random draws are the candidate shuffle (5.4.9) and the jitter (5.4.10). Python and C# implement the same integer procedure and are asserted against the same fixtures (5.4.13), and the invariant checks of 3.2 are run on the emitted positions regardless.

**5.4.2 Classes.** Single-colour cards go to the wedge of their colour; cards with two or more colours go to the gold wedge; colourless cards go to the ring. Let n be the number of wedge classes with at least one card on this plane (0 to 6). A class with zero cards has no wedge; the HUD legend lists the absent colours.

**5.4.3 Initial radius.** R₀ = √(A × N ⁄ π) + 12 m, where N is the plane's card count. The outer iteration (5.4.11) refines it.

**5.4.4 Wedge angles (bounded proportional allocation by a scale factor).** If n = 0 there are no wedges; the ring's inner edge is the plaza's edge plus a path (5.4.7) and the ring is the whole world outside the plaza. If n = 1 the wedge is 360°. Otherwise, with lo = min(30°, 360°⁄n) and hi = max(120°, 360°⁄n) (so n × lo ≤ 360° ≤ n × hi always holds), find the scale λ such that f(λ) = Σ_i clamp(λ × count_i, lo, hi) = 360°. f is continuous and non-decreasing in λ, f(0) = n × lo ≤ 360° and f(∞) = n × hi ≥ 360°, so a solution exists; λ is found by bisection over 64 fixed iterations in integer micro-degrees, taking the largest λ tested with f(λ) ≤ 360°. Each class's angle is then clamp(λ × count_i, lo, hi) rounded down to a micro-degree, and the shortfall to 360° (at most n micro-degrees plus the bisection residual, which is bounded by one micro-degree per class) is apportioned one micro-degree at a time to the classes strictly below hi in descending order of their discarded fraction, ties by class order; a class at hi receives nothing. Because f(λ) ≤ 360° at the chosen λ and every class is either below hi or the sum already meets 360°, the apportionment always completes, every angle lies within [lo, hi], and the angles sum to exactly 360°. Worked check: counts 100 : 1 : 1 give lo = 30°, hi = 120°; λ solves clamp(100λ) + 2 × clamp(λ) = 360°, so 120° is not enough for the largest class alone and the remaining 240° cannot come from two classes capped at 120° each unless they are also at hi: the solution is λ ≥ 120 (per unit count), giving 120°, 120°, 120°. The old clamp-and-renormalise loop is withdrawn. Wedges run clockwise from north in the order W, U, B, R, G, gold, omitting absent classes.

**5.4.5 Plaza and the first ring path.** The plaza is the disc of radius max(12 m, 0.05 × R) about the origin, holding the arrival point (facing north), the return portal (8 m south of the centre, facing it, with its pad), and the hero landmark volume if any. A ring path of width 3 m runs around the plaza's edge; r₀, the inner radius of band 0, is the plaza radius plus 3 m.

**5.4.6 Bands (sizing).** For k = 0 … S−1 in release order, the band's initial width w_k is 0 if no wedge class has a card in set k on this plane; otherwise the larger of 6 m and the smallest width such that, for every wedge class c with n_{c,k} > 0 cards in set k, the gross area of the sector between r_k and r_k + w_k across the wedge's angle is at least A × n_{c,k}. r_{k+1} = r_k + w_k, plus 3 m for a ring path whenever w_k > 0. Widening (5.4.9) may increase w_k later.

**5.4.7 Ring (sizing).** If the plane has colourless cards, the ring begins at r_ring ≥ r_S after the last ring path. Let m be the number of sets with n_{C,k} > 0 colourless cards; each gets an arc, sets with none get no arc. The ring's initial width w_ring is the larger of 6 m and the smallest width such that every arc's gross area at its proportional share is at least A × n_{C,k}. The minimum arc length is 6 m at the ring's mid radius r_mid = r_ring + w_ring ⁄ 2, so the minimum arc angle is lo = 360° × 6 m ⁄ (2π r_mid); feasibility requires m × lo ≤ 360°, that is 2π r_mid ≥ 6 m × m. If r_S + w_ring ⁄ 2 does not satisfy it, r_ring is pushed outward to the smallest value that does (r_ring = 6 m × m ⁄ (2π) − w_ring ⁄ 2), and the gap between r_S and r_ring is plain terrain the kit dresses. Arc angles are then allocated by the solver of 5.4.4 with lo as above and hi = 360°, proportional to n_{C,k}, running clockwise from north in release order. The world radius R is the ring's outer radius r_ring + w_ring; if there is no ring, R = r_S.

**5.4.8 Reservations.** Before any stand is placed, the following are reserved as polygons, in this order, and each later item is checked against the earlier ones under the rules of invariant 9: the plaza; every ring path (a 3 m annulus at each band boundary and at the ring's inner edge); every radial path (a 3 m strip along each wedge boundary from the plaza to R); the hero volumes from the owner's file (clipped to the world; a volume that covers the arrival point, the return pad or any path fails the build naming the volume); the waystone pads (a 3 m pad centred on the intersection of every radial path with every ring path; pads overlap paths by design); the return portal pad (inside the plaza by design). For every site, its **centre** is then defined: the point of the hexagonal lattice (5.4.9) inside the site's region minus reservations that is nearest to the region's area centroid (for a ring site whose arc is the full circle, the centroid is replaced by the arc's mid-angle point at the ring's mid radius; the same rule applies to any arc wider than 180°). A 3 m pad is reserved at the site centre, and a 3 m wide spur is reserved from the pad's edge to the nearest point on the nearest bounding path (ties broken by the lowest path id), so the pad touches the network. Spurs are added in site order (band, then class) and each is clipped against earlier reservations; a spur that cannot reach a path because a hero volume blocks every straight route makes the build fail naming the site and the volume.

**5.4.9 Candidates and capacity.** One hexagonal lattice of pitch p, anchored at the world origin with one lattice axis along +x, covers the world; because it is global, stands in adjacent sites and bands keep the pitch between them. For a site, a lattice point is a **candidate** if (a) it lies inside the site's region; (b) the stand footprint centred on it, oriented so the image surface faces the nearest point of the path network (ties by lowest path id), **inflated by the jitter radius j on every side**, lies outside every reservation that invariant 9 forbids a footprint to touch (paths, pads, the plaza, hero volumes); (c) its apron, inflated by j, lies outside the same reservations; (d) its corridor, the straight strip of width 1.5 m from the apron's front edge to that nearest path point, inflated by j, lies inside the site's region and outside every hero volume and the plaza. The inflation by j guarantees that the jittered final geometry (5.4.10) still satisfies invariant 9 against fixed reservations. Candidates are enumerated in a fixed order (by lattice row, then column). The site's **capacity** is its candidate count. If capacity < the site's stand count, the band (or, for a ring site, the ring) is widened by 10 percent of its current width and everything from 5.4.6 onward for that band and all bands outside it is recomputed; after 20 widenings of the same band or ring without reaching capacity, the build fails naming the site. Capacity counting treats candidates independently; conflicts between chosen stands are handled at placement (5.4.10) and the chosen set is validated afterwards, not assumed.

**5.4.10 Placement.** The site's candidates are shuffled by a Fisher–Yates pass driven by the site's PRNG. Candidates are then taken in shuffled order; a candidate is **accepted** unless its footprint, apron or corridor, each inflated by j, intersects the footprint or apron (inflated by j) of an already accepted stand in this or any earlier site, or its corridor crosses an accepted stand's corridor at an angle under 30° (corridors may cross each other; stands may not stand in a corridor). Acceptance stops when the site's stand count is reached. If the shuffled list is exhausted first, the band or ring is widened as in 5.4.9 and the site is recomputed. Each accepted position is then displaced by the PRNG within radius j; because every acceptance test used geometry inflated by j, the displaced footprints, aprons and corridors still satisfy invariant 9 against reservations and against each other, and the spacing of 2.5 m holds because two lattice points are at least p apart and each moves at most j. The site's cards, sorted by `oracle_id` bytes, are assigned to the accepted positions sorted by (x, z), so the same data always yields the same picture. The yaw is the direction to the corridor's path point. After all sites of a world are placed, the independent checker (3.2) runs on the final geometry; a checker failure is a build failure naming the first violating pair, never silently retried.

**5.4.11 Outer iteration and termination.** Steps 5.4.5 to 5.4.10 are run with R from the previous pass (R₀ first). If the resulting R differs from the input R by more than 0.1 m, run again with the new R, at most 20 times. If the twentieth pass still moves R, the twentieth result stands: the plaza radius is a reservation, not a correctness condition, and every invariant is checked on the result regardless. Every loop in this procedure has an explicit bound (64 bisection steps, 20 widenings per band, 20 outer passes), so the allocator terminates. Its failure modes are named and each fails the build with the site or volume named: a hero volume covering the arrival point, the return pad or a path (5.4.8); a spur that cannot reach a path (5.4.8); a site that cannot reach capacity after 20 widenings (5.4.9, 5.4.10); and an independent-checker violation on the final geometry (5.4.10), which should not occur if the procedure is implemented as written and is therefore treated as an implementation defect, not a data condition.

**5.4.12 Small worlds.** A world with few cards has a plaza of 12 m, one ring path, at least one 6 m band or a 6 m ring and R of at least 21 m, about 42 m across before the terrain margin. A one-card plane shows one stand in that clearing with its plaza and return portal; its waystone says "1 card". A two-card single-class plane (Vryn: two blue cards) has one 360° wedge, one band, one site with a waystone replaced by a marker stone (5.4.15).

**5.4.13 Fixtures.** `contract/test-vectors/v4/layout/` holds the allocator's complete output (angles, radii, arcs, reservations, every stand position and yaw) for: Dominaria (6,271 cards, 37 sets), the Blind Eternities (4,204, 50 sets), Alara (gold-heavy, 294 of 510), New Phyrexia (colourless-heavy, 385 of 1,405), Rabiah (75, one set), Zhalfir (4, three classes), Vryn (2, one class), Shandalar (1), a synthetic all-colourless plane, a synthetic plane whose only set has colourless cards and no coloured ones (zero-width band, non-empty arc), and Dominaria with a synthetic hero volumes file that blocks part of the plaza edge and one wedge boundary. The Python implementation produces them; the C# mirror must reproduce them exactly (integer millimetres); and the invariant checks of 3.2 are run on every fixture by a third, independent checker that knows nothing of the allocator.

**5.4.14 What has been computed, and what has not.** On 2026-10-10 the sizing steps 5.4.2 to 5.4.7 were run on dataset `a5846bec28d1447e` with an earlier angle rule and without reservations, lattice capacity or hero volumes. They are **preliminary estimates** of world size, not fixtures: Dominaria about 520 m across, 37 bands averaging about 7 m, 202 sites of which 23 have fewer than five stands, 753 gold cards, 564 colourless cards in a ring about 12 m wide, mean ground per stand about 34 m²; the Blind Eternities about 640 m across with 254 sites; Ravnica about 250 m; Innistrad about 210 m; New Phyrexia about 180 m with a ring about 19 m wide; Alara about 135 m with a 120° gold wedge; Rabiah about 48 m. Paths, pads, corridors and lattice capacity will enlarge these by an amount the fixtures will show. The slice (9.5) implements the full procedure in C# and reports the actual Dominaria figures; the pipeline implementation in Wave 5 must reproduce them.

**5.4.15 Site furniture.** A site with five or more stands has a waystone at its pad; a smaller site has a marker stone (set name and year, no travel). The travel menu and the map list every site, so a marker-stone site is reachable without its waystone.

**5.4.16 The chart risk.** From the air this is a wheel. On the ground it must be a place. The kit makes wedge boundaries natural (a stream along a radial path, a tree line, a wall, a change of ground), the map is the only view where the wheel is drawn, and the slice's third question (9.5) is whether Dominaria reads as a place from the avatar's height.

### 5.5 Stands

1. A stand is an image surface about 0.63 × 0.88 m (card aspect about 5:7; the surface takes the image's pixel aspect, 4.15.5) on a plinth about 1.1 m tall, facing its apron. It shows the first-printing `normal` image when the avatar is within 25 m, and the swatch colour beyond that. Rarity sets the plinth's material in four steps (stone, bronze, silver, gold-veined); the class sets a thin rim glow on the plinth edge at night and in dark kits. Rarity and class are metadata made visible, not tiers to earn.
2. The image surface is rendered on the isolated path of 8.4.4: unlit, exposure-independent, fog-free, excluded from post-processing, depth-tested against the world. Nothing about the image changes with the scene's lighting or weather. The plinth is lit normally and casts shadows; the image surface receives none.
3. Within 3 m the stand's hover label shows card name, set, year and artist. Interacting (6.1.3) enters card view.
4. Minimum stand spacing is 2.5 m (5.4.1). Each stand has a 1.5 m apron, the point a travel portal lands on, and a corridor to a path (5.4.9).
5. Image loading is nearest-first within the 25 m radius, bounded by the slot count of 8.4.3; the loader never requests more images than there are slots, so residency is a hard bound and 25 m is a radius within which images are preferred, not a promise. A stand whose image has not arrived or has no slot shows its swatch, never a placeholder rectangle. Images fade in over 200 ms.
6. Filtered-out stands (6.5) show their swatch, not a dimmed image, lose their rim glow and are not interactive. A filtered-out stand reached through search is un-filtered on arrival (6.4.6).

### 5.6 Environments: kits, theme rows, hero set-pieces

1. **Twelve kits** cover the roster: `temperate` (meadow, rivers, lakes), `forest`, `coast` (sea, islands, cliffs), `desert`, `volcanic` (lava, ash, basalt), `mountain` (steppe, snow line), `swamp`, `moor` (gothic, fog), `stone-city`, `filigree-city`, `phyrexian` (metal, oil), `void` (the hub, the Blind Eternities' world and the pockets). A kit is a terrain layer set, a water configuration, a vegetation or structure prop set, a sky and lighting rig, a weather set, particle effects and a sound set (5.12). The engineers own the kit code and prefabs; the kit assets are supplied as 8.12 says. Given a theme row, the layout from the pack and a seed, a kit dresses any world size.
2. **Theme rows** (Appendix C) tune a kit per plane: sky, light, palette, weather, water, ambient family, music mood. Two planes on the same kit with different rows read as siblings; two on different kits read as different worlds. A kit world whose row inherits every field from the kit reads as the kit's default; 11.8 schedules the curation.
3. **Wedge dressing.** The kit varies its ground layer, prop density and water by wedge class from a fixed per-kit table (not per plane in v1), so the terrain tells you which colour you are among: white highlands or plazas, blue coast or canals, black marsh or ruins, red badlands or forges, green forest or fields, gold at the gold wedge, colourless at the ring. Per-plane bespoke wedge dressing (Alara's shards, Lorwyn's two aspects) is deferred (11.9).
4. **Hero set-pieces.** The twenty entries in Appendix C.1 (nineteen planes and the Blind Eternities) carry hand-built geometry by the owner in the editor: a landmark in the plaza and up to one landmark per wedge boundary on the outermost ring path, each inside a hero volume the owner exports (4.12.2) so the pipeline can keep stands out. Hero set-pieces are additive and staged: a hero entry whose set-piece scene is missing ships on its kit. The first release carries the hub's portal ring (core content) and Dominaria's set-piece; the other nineteen entries follow release by release (8.12.4).
5. **Kit worlds.** The 26 planes with cards that are not hero entries ship on their kit and theme row alone.
6. **Pockets.** The 42 empty planes share the generated `pocket` row: a void space about 20 m across with a single waystone that reads the plane's name and "no cards first printed here", and a return portal.
7. Adding a plane is one Appendix A row, one Appendix B row and one `themes.yaml` entry. The pipeline fails if any is missing.

### 5.7 Sky, light and weather

1. Each world has one sky and one lighting rig from its theme row: time of day, sun or moon elevation and tone, cloud cover, fog colour and density, and optional weather (rain, snow, ash, sandstorm haze, fireflies, embers). HDRP's physically based sky, volumetric fog and volumetric clouds are the implementation; the HDRP low quality level (8.1.1) replaces volumetric clouds with a cloud layer and reduces fog quality.
2. Time of day is fixed per world; there is no day cycle in v4. Clouds and weather move.
3. Weather never obscures a stand within the 3 m interaction radius, and never touches the image surface (5.1.2).

### 5.8 The avatar

1. The visitor moves as a third-person avatar with a following camera (over the shoulder, with an orbit on right-drag or the right stick and a zoom range of 2 to 6 m). The avatar has idle, walk, run, turn-in-place, look-at-stand and portal-step animations, and foot IK on terrain.
2. v1 ships **one avatar: Teferi** (Appendix D). There is no avatar selection screen and no roster list in v1; the start screen says "You travel as Teferi." Adding avatars later adds the selection surface, which section 10 risk 1 treats as a game-read risk to be judged then.
3. The avatar is a camera subject. It has no stats, no abilities, no inventory, no health, no stamina bar and nothing to pick up. Walking is 3 m/s, running 6 m/s, with no cost.
4. The avatar's design is an original stylised interpretation of the character, made from the card art as reference, never a copy or projection of card art. The vertical slice uses a placeholder mannequin; Teferi's model is not commissioned before 11.1 is decided.
5. The avatar sets the home plane (Dominaria for Teferi): the visitor arrives in the hub facing that portal, and the travel menu has a "your cards" section (4.14.4).

### 5.9 Portals

1. A portal is a standing ring of about 3 m with a shader surface. Stepping into it plays a 1.5 s transition (surface fills the view, a sound, a cut). A hub portal's world begins loading per 5.3.3; a return portal's hub is always resident.
2. If the destination is not ready when the transition ends, the portal surface **holds** with input locked for up to the 6 s ceiling (7.2); beyond 6 s a loading indicator appears on the held surface. The transition never cuts to an unready world.
3. Every portal is two-way. A world's return portal stands in the plaza (5.4.5).
4. A **travel portal** opens 2 m in front of the avatar, facing it, wherever the avatar stands (a portal has no collision and needs no reserved ground); the avatar walks into it automatically over 1 s, with no steering by the visitor, and arrives on the destination stand's apron facing the stand, or on the destination pad facing the waystone. The portal closes behind the avatar. For a destination in another world, the travel portal leads straight to that world's destination: the world loads behind the transition with the hold rule, and the hub is not visited.
5. Reduced motion (5.11) replaces the transition with a 0.3 s fade; the hold rule and the automatic walk still apply.

### 5.10 Card view

1. Interacting with a stand enters card view: the camera moves over 0.6 s to frame the card at a fixed on-screen size (about 60 percent of viewport height), slightly off-centre to leave room for the printings panel; the world stays behind the card with a subtle depth-of-field on the world only (never on the card); the avatar steps out of frame. Nothing in the world can occlude the card in card view: the camera is placed inside the stand's apron looking at the image surface, and props keep the 1 m clearance from aprons (5.4.1).
2. The card is the first-printing `large` image on a thin rounded-rectangle solid with the Scryfall card back and a dark edge, as v3 5.6.2, rendered on the isolated path (8.4.4). It tilts toward the pointer with spring damping, ±12°, and settles when the pointer leaves. Cards with the back-image flag (4.13.3) show a flip control.
3. The **printings panel** lists every included printing: set name, year, rarity, artist, ordered by release date, the active printing highlighted. Clicking a row swaps the card face. Above the list: card name, mana cost, type line, oracle text per face, colour identity and rarity as text. Below: "Open on Scryfall" (opens the system browser) and the artist credit for the shown image as text.
4. Esc, the back control or walking input leaves card view and returns the camera to the avatar over 0.6 s. The stand is added to recently visited (6.6.4).
5. Card view pauses nothing in the world: water flows, clouds drift, sound continues.

### 5.11 Motion and reduced motion

1. All motion is delta-time based and must look identical at 30, 60 and 120 fps.
2. With the system reduced-motion setting, or the setting in 6.9: camera transitions drop to 0.3 s fades, the following camera's smoothing is disabled, card tilt is disabled, weather particles stop, vegetation wind stops, water keeps a flat animated surface. Walking is unchanged; the travel menu is the travel aid.

### 5.12 Sound

Three layers plus interface sounds, all original or CC0 licensed with provenance recorded (8.12.3), never Wizards' audio (Fan Content Policy).

1. **Ambient bed.** One loop per ambient family in Appendix C (fourteen families), crossfaded at wedge boundaries so the marsh gains frogs and the coast gains surf. Stereo, 1 to 2 MB each as Ogg Vorbis.
2. **Music.** One mood per plane from Appendix C (fifteen moods). v4 ships a small set of original or CC0 ambient loops, one per mood, 2 to 4 minutes each, looped with a crossfade, ducked under card view. Generative music is deferred (11.3).
3. **Spatial prop sound.** Every water body, lava flow, fire, forge, machine, wind-exposed tree line and waterfall emits positional sound with distance attenuation and reverb zones (a cave sounds like a cave). A river is heard before it is seen. Implementation is standard 3D audio sources and reverb zones (8.6); a spatialiser plugin is an upgrade, not a dependency.
4. **Interface sounds.** Portal open, portal step, card view enter, card view leave, waystone use, travel menu open. Six sounds.
5. Master, ambient, music, effects and interface volumes are separate settings. Sound starts on the first input after the start screen.

## 6. Interaction requirements

### 6.1 Controls

1. Keyboard and mouse, and a standard gamepad. Both are complete; nothing requires one or the other.
2. Explore: WASD or left stick to walk, Shift or a trigger to run, mouse or right stick to orbit the camera, scroll or a shoulder button to zoom.
3. Interact (E, a face button or a click on a stand within 3 m) enters card view or uses a portal or waystone.
4. Esc or the menu button: leave card view, close an overlay, or return to the hub through the return portal, in that order.
5. M opens the map; T opens the travel menu; `/` opens search; Tab shows the HUD legend; `?` opens help; F12 takes a screenshot.

### 6.2 Modes

1. Four modes: **start** (start screen), **hub**, **explore** (in a world or pocket) and **card view**. Overlays (map, travel menu, search, settings, help) sit over hub and explore.
2. Mode transitions are the portal transition (hub to world and back), the card view transition (0.6 s) and the travel portal. No cut is ever instantaneous except under reduced motion fades.

### 6.3 HUD

1. Top-left: plane name and the wedge and site you stand in (for example "Dominaria · Blue · Time Spiral, 2006"), updated as you cross a boundary. In the hub: "The Hub".
2. Filter chips beneath the plane name, as v3 6.3.2, with a live count of matching stands.
3. The HUD legend (Tab) lists the present colour classes and their wedge direction, and the absent ones.
4. **Map (M):** a top-down overlay of the current world: wedges as coloured sectors, bands as rings labelled with set and year at the radial paths, the ring's arcs, sites as points (waystone or marker), the avatar, waystones, the return portal, and the stands that match the active filter as dots. Clicking a site or waystone opens a travel portal to its pad. The map is a travel aid and shows nothing the world does not.
5. The HUD hides in card view except for the printings panel and the breadcrumb, and hides entirely for a screenshot (6.8).

### 6.4 Search

1. Opened by `/` or the search control. A text box over the scene; Esc or clicking outside dismisses it.
2. Matches card names, plane names and set names with fuzzy, prefix-favouring matching; double-faced cards match on either face name; avatar aliases match their cards.
3. Results are grouped Planes, Sets, Cards, up to 8 per group. Arrow keys move, Enter selects.
4. Selecting a plane opens a travel portal to its plaza. Selecting a card opens a travel portal to its stand's apron, in this world or another (5.9.4).
5. Selecting a set reads the set's site list from the pack (4.13.4, 4.13.6). If the set has sites, the travel portal leads to the pad of its largest site (most stands; ties by class order, then by plane index), and the travel menu, which opens on arrival, lists the set's other sites by plane and colour whether or not that site has a waystone. If the set has no sites (reprint-only), the set's filter chip is added, the avatar stays, and the map and a toast show how many stands match in this world and across worlds.
6. Search ignores active filters when matching. Selecting a filtered-out card clears exactly the facets that exclude it, with a toast "Filters cleared to show this card" and an undo chip, so the stand is interactive on arrival. There is no dead end.
7. The search index is in the data pack and is loaded before the start screen dismisses. No network per keystroke.

### 6.5 Filters

1. Facets, semantics and rarity mapping as v3 6.6.1 to 6.6.4, evaluated against `stands.bin` (colour mask, type mask, rarity) and `sets.bin` (set membership) so every facet is live in every world without a shard load. Filters apply to stands per 5.5.6 and to the map's dots.
2. Filter state persists for the session and is shown as chips. There are no URLs; a filter is cleared by its chip, by clear-all, or by 6.4.6.

### 6.6 Travel

1. **Travel menu (T).** A searchable list with sections: this world's sites by wedge and band; "your cards" for the avatar; recently visited; random. Choosing an entry opens a travel portal (5.9.4) to the site's pad or the stand's apron.
2. **Waystones.** Using a site waystone offers the previous and next band's site in the same wedge, and the same set's sites in the neighbouring wedges; a ring site's waystone offers the clockwise and anticlockwise neighbouring arcs and the same set's wedge sites. Using a wedge-boundary waystone offers the same boundary one band in and one band out, and the neighbouring boundaries on the same band. A travel portal opens to the chosen waystone's pad. Absent neighbours are not listed.
3. **Random** opens a travel portal to a random card: a plane with probability proportional to the square root of its card count, then a uniform card. Random ignores filters.
4. **Recently visited** is a list of the last 50 stands entered in card view, stored locally. It has no count against a total, no completion state and no reward. It is a bookmark list.

### 6.7 First launch and start screen

1. The start screen shows the title, "You travel as Teferi", the Fan Content Policy notice, the Scryfall credit and an "Enter" control. Loading of the hub happens behind it; "Enter" enables when the hub is ready.
2. The first launch shows a dismissible hint after arrival in the hub: move, run, orbit, interact, map, travel, Esc. Dismissal is remembered. Help reopens it.
3. The visitor arrives in the hub facing the avatar's home-plane portal.

### 6.8 Screenshot

F12 saves a screenshot without HUD to the OS pictures directory and confirms with a transient toast. Every card image in it carries its printed artist line (4.15.5). This is the visitor's share mechanism; there are no URLs.

### 6.9 Settings

1. HDRP quality level (automatic, high, medium, low), resolution scale, frame-rate cap, reduced motion (default follows the OS), five volumes, invert camera axes, gamepad sensitivity, text scale 100 to 150 percent, hint reset, image cache size and clear.
2. Settings persist locally. No accounts, no server, no telemetry.

### 6.10 Accessibility

1. Reduced motion per 5.11, honouring the OS preference by default.
2. Every overlay (map, travel menu, search, settings, help, printings panel) is fully keyboard- and gamepad-operable with visible focus states, built with UI Toolkit.
3. Colour identity and rarity are shown as text in the printings panel and the hover label, so the encoding never carries meaning alone.
4. HUD and panel text meets 4.5:1 contrast against any sky in Appendix C; the HUD draws on a scrim where needed. Text scale 100 to 150 percent.
5. The travel menu, search and the map are the paths to every card without walking (5.9.4), so the full catalogue is reachable without fine motor control.
6. **Screen readers.** Unity 6's accessibility module does not expose desktop UI to macOS VoiceOver or Windows Narrator. The native build therefore has no screen-reader path in v4. The web edition (8.11), which has one (its drawer's list mode reaches every card), stays deployed and is redeployed with every data refresh so it carries the same catalogue as the native build; it is linked from the download page and the help overlay. Open question 11.10 tracks a native path.

## 7. Non-functional requirements

### 7.1 Reference environment and operators

1. **Reference machine:** the owner's MacBook Pro with the M5 Pro, the machine the agent engineers run on. Render at native resolution, HDRP high. The reviewer agent runs the bench on it; no human is needed for a reference-machine figure.
2. **Light Mac:** an Apple Silicon MacBook Air (M1 or M2), 1440 × 900 or the display's default, HDRP low. Only the owner can run it; each gate that needs a light-Mac figure names the owner as operator and the figure is owed before merge, as the W0.1 field reports were.
3. **Windows:** the two W0.1 laptops (Intel Iris Xe class), HDRP low at 1920 × 1080, owner-operated, measured before the first distribution, not per gate. HDRP high on Windows requires a discrete GPU of GTX 1660 class or better; no such machine is owned, so Windows high figures are reported if a tester supplies them and are not a gate.
4. Supported: macOS 14 or later on Apple Silicon; Windows 10 or 11, 64-bit, DirectX 12. Intel Macs are not supported. Linux is not a target but is not blocked.

### 7.2 Performance budgets

| Measure | Target | Ceiling |
|---|---|---|
| Frame time p90, reference machine, HDRP high, native, any world, warm run | ≤ 16.7 ms | 20 ms |
| Frame time p99, same run | ≤ 25 ms | 40 ms |
| Longest frame, same run, excluding the first second after a portal | ≤ 60 ms | 100 ms |
| Frame time p90, light Mac, HDRP low, default display, warm run | ≤ 33 ms | 40 ms |
| Frame time p90, W0.1 laptops, HDRP low, 1920 × 1080, warm run | ≤ 40 ms | 66 ms |
| Launch to start screen interactive | ≤ 5 s | 10 s |
| Hub ready behind the start screen | ≤ 8 s | 15 s |
| Portal to world ready (the hold of 5.9.2 covers the gap after 1.5 s) | ≤ 3 s | 6 s |
| Travel menu open to card view, destination in this world (includes the automatic walk and the transition) | ≤ 6 s | 10 s |
| Travel menu open to card view, destination in another world, warm run (includes the load and any hold) | ≤ 10 s | 16 s |
| Resident card images (GPU): the stand texture array plus card view textures | ≤ 192 MB | 256 MB |
| Total GPU memory, reference machine, largest world | ≤ 4 GB | 6 GB |
| Process memory (RSS), largest world | ≤ 4 GB | 6 GB |
| Concurrent image requests to Scryfall | 6 | 6 |
| On-disk image cache (default) | 2 GB | user-set |
| Cooked content: core (hub including its portal ring, avatar, UI, shared runtime assets, every shared dependency counted here once) | ≤ 300 MB | 400 MB |
| Cooked content: each kit (its own assets only; shared assets live in core) | ≤ 40 MB | 60 MB |
| Cooked content: each hero set-piece scene (its own assets only) | ≤ 30 MB | 40 MB |
| Archive size (compressed cooked content), first release: core, twelve kits, Dominaria's set-piece | ≤ 1.0 GB | 1.5 GB |
| Archive size with all twenty set-pieces | ≤ 1.5 GB | 2 GB (the release host's per-file limit) |

The ceilings are what the owner has agreed to concede; the targets are what to aim for. 9.1 says which are checked where. Cooked budgets are measured on the build's content folders before archiving; the archive rows are the compressed artefact and are the only rows the release host sees. Frame-time measures are taken on the bench path (8.8.4) in a **warm run** (images cached on disk, world visited once in the session); a **cold run** (empty cache, first visit) is recorded alongside and is informational.

### 7.3 Smoothness rules

1. Delta-time motion (5.11.1).
2. No allocations in the per-frame path; pooled stands, labels and audio sources.
3. World streaming is by site: sites within 60 m of the avatar are resident with props and marker geometry; sites beyond hold stand plinths and swatches only. Images are a separate, smaller radius: 25 m (5.5.1), bounded by slots. Streaming never causes a hitch over 4 ms; loads are time-sliced.
4. No level-of-detail transition may pop; stands cross-fade between swatch and image, props fade or dither.
5. Image arrival never causes a visible jump (5.5.5).
6. Camera hand-over on input is continuous in position and velocity.

### 7.4 Reliability

1. A failed data pack file fails loudly at launch with a readable message; the pack is immutable and shipped with the build.
2. A failed image leaves the swatch or the previous image in place; nothing renders as a broken rectangle. Backoff per 4.15.4.
3. If Scryfall is unreachable, every mode, travel, search and filter still works; stands whose images are cached on disk show them; uncached stands show swatches; card view of an uncached card shows the swatch and a one-line notice.
4. The application writes only to: its settings directory and image cache under the OS application-support directory, a versioned terrain cache beside them (`terrain/<dataHash>/<kitVersion>/<slug>.bin`, invalidated by data hash and kit version), and the pictures directory for screenshots.

### 7.5 Security and privacy

1. The only network host is Scryfall's image CDN. No analytics, no error tracking, no update check in v4.
2. External links (Scryfall) open in the system browser.
3. Builds are signed and notarised on macOS and signed on Windows where the owner holds certificates; otherwise the download page documents the unsigned-app steps (open question 11.6).

### 7.6 Maintainability

1. Appendices A, B, C, `overrides.json`, `avatar-overrides.json` and the hero volumes files are the only curated data inputs; everything else is derived.
2. The pipeline fails loudly on unknown enum values and on any Appendix C violation (4.12.3).
3. Unity, HDRP and every package are pinned in the project manifest; upgrades are deliberate and reviewed.
4. Everything an engineer changes is text: C#, YAML scenes and prefabs, shader graphs serialised as text, ScriptableObjects, assembly definitions, editor scripts. Binary assets (models, textures, audio) are content supplied under 8.12 and committed through Git LFS; engineers do not author them.

### 7.7 Licence and distribution

1. **Internal evaluation** (the owner and the agents running the build) is not distribution and is not gated. **Distribution** is giving the build to anyone else, friends included, publicly or privately; every distribution waits for the owner's decision in 11.1, and privacy of a distribution is not compliance.
2. When distributed: a free download for macOS (Apple Silicon) and Windows, published as **GitHub Releases on this repository** (`DioPires/eternities-mtg-app`, public since 2026-09-21). One release per tag; each release names the data hash it was built from, and its notes carry the Fan Content Policy notice, the Scryfall credit and the link to the web edition, so the release page plus the README is the download page. An itch.io page is an optional landing page later (11.7). Not Steam (non-goal 6). *Amendment 1 (2026-10-10, owner decision on DEC-950): the first print said the source stayed private and named a separate `eternities-releases` repository; the source is public, so one repository keeps the tag, the built commit, the data hash and the archives together.*
3. Unity Personal licence (free below the revenue threshold; the product has no revenue). If the licence terms move, 8.1.3 names the fallback.

## 8. Architecture

### 8.1 Engine and stack

1. **Unity 6 LTS with HDRP only.** Quality is three HDRP quality levels (high, medium, low) that change resolution scale, shadow and reflection quality, volumetric clouds (high and medium only; a cloud layer on low), volumetric fog quality, water quality and vegetation density. There is **no URP rung in v1**: HDRP and URP are separate render pipelines with separate shaders, materials and features; a URP variant is a second renderer. If HDRP low fails the light Mac ceiling in the slice, Wave 5 decides between a URP build variant (separate materials and substitutions, costed then) and dropping the light Mac as a target (9.5 decision matrix).
2. **Systems used, with their nature stated honestly:** Unity Terrain (built in); HDRP Water System (built into HDRP: rivers, lakes, ocean); VFX Graph (package, lava, rain, ash, fireflies); HDRP volumetric fog and clouds (built into HDRP); Cinemachine (package, pinned) for the following camera, the card view camera and portal arrival; the Input System (package) for keyboard, mouse and gamepad; UI Toolkit for every overlay; Addressables (package) for per-world content; standard 3D audio sources with reverb zones (built in); Unity's `CharacterController` as the base of an **own** kinematic avatar controller (the Starter Assets package is a reference only; its Unity 6 HDRP compatibility is not assumed); Animation Rigging (package) and Adobe Mixamo (an external web service, free account) for the shared animation set retargeted onto the humanoid rig.
3. **Fallbacks and alternatives, recorded.** Unreal Engine 5 was declined because its Blueprints, materials, landscapes and procedural graphs are binary assets the agent engineers cannot write or review, and macOS is second-class. Godot 4 is the named fallback engine. It is considered only under the single row of the 9.5 decision matrix that names it, after bottleneck attribution shows the reference machine's miss lies in HDRP's fixed costs rather than in our content or code. A delivery miss, an artistic miss, or a light-Mac miss never invokes it, because Godot would rebuild the same controller, streaming and content integrations. three.js is withdrawn for this scope (8.11).

### 8.2 Repository layout

1. One repository, `eternities-mtg-app`: `pipeline/` (unchanged home), `web/` (the web edition), `contract/test-vectors/v3/` and `v4/`, `unity/Eternities/` (the Unity project), `docs/`.
2. Unity project conventions: `Assets/Scenes/Hub.unity`; `Assets/Scenes/Heroes/<slug>.unity` for hero set-pieces only (owner-authored, loaded additively); kit worlds have no scene and are instantiated from the kit at runtime; `Assets/Kits/<kit>/` (prefabs, terrain layers, materials, VFX, audio, `CREDITS.md`); `Assets/Scripts/` with assembly definitions per area (Data, Layout, Kits, Avatar, CardView, Travel, Audio, UI, Bench); `Assets/StreamingAssets/data/<hash>/` (the engine pack); `Assets/Tests/EditMode` and `PlayMode`; `Assets/Editor/` (hero volume exporter, scene generation entry point, batchmode build and bench runners).
3. Asset serialisation is Force Text; `.meta` files are committed; Git LFS holds `*.fbx`, `*.glb`, `*.png`, `*.exr`, `*.ogg`, `*.wav`, terrain data. `Library/`, `Temp/`, `Logs/`, `Build/` are ignored.
4. Engineers commit code, prefabs, scenes they generate, shader graphs and ScriptableObjects. Models, textures, audio and hero scenes are committed by the owner or by an engineer acting on a content task that names the source and licence (8.12).
5. A **text-driven scene generation entry point** (`Editor/Generate.cs`, runnable in batchmode) builds the hub scene and any kit world from the pack and the kit, so an engineer can regenerate every non-hero scene from the command line and the reviewer can reproduce a world without the editor open.

### 8.3 Data path

1. The pipeline emits the engine pack (4.13) next to the web pack; a build picks the hash from `manifest.json` in `StreamingAssets/data/`.
2. The C# decoder reads `stands.bin` into structure-of-arrays native collections once at launch (1.37 MB for 28,603 stands) and runs the 4.13.3 assertions; `planes.json`, `sets.json`, `themes.json`, `kits.json`, `avatars.json` and `search.json` are parsed at launch; `sets.bin` is read into a compact index at launch; `planes/<slug>.<n>.json` shards are loaded on world entry and unloaded on exit.
3. The allocator (5.4) lives in the pipeline (Python). A C# implementation of the same integer procedure exists for the slice and for tests; both are asserted against the fixtures of 5.4.13, and the independent invariant checker runs on both outputs. Production worlds always use the pack's positions.

### 8.4 Scene structure and rendering

1. One persistent scene holds systems (data, audio, UI, avatar, camera rigs, streaming) and the HUD. The hub, each kit world and each hero scene are loaded through Addressables behind the portal transition.
2. A world is: a terrain generated from the kit and the theme row at load (cached per world on disk, 7.4.4), a water configuration placed only in the kit's water zones (the world minus the 3 m water buffer around paths, corridors, aprons and pads, 5.4.1; water crosses a path only through a ford or bridge prefab), a prop scatter (seeded, instanced, run **after** the pack is read and excluding stands, aprons, corridors, paths, pads, hero volumes and the 1 m prop clearance around them), the hero scene if any, the stands, waystones and marker stones, the return portal, the sky and lighting rig, reverb zones and audio emitters. The following camera is a Cinemachine rig with a collider that pulls in on props; the 1 m clearance along paths and corridors is what keeps that rare.
3. **Stand images.** Per world one `Texture2DArray` of **384 slots** at 244 × 340 (the `normal` image downscaled by exactly one half, aspect preserved, no padding), RGBA8 with a full mip chain, trilinear sampling, so a stand 25 m away is minified without shimmer. 384 × 332 KB × 1.33 is about 170 MB; with card view's two uncompressed `large` textures (about 5 MB) the resident total is about 175 MB, inside the 192 MB target and the 256 MB ceiling. Decoding and downscaling happen off the main thread; the upload is one `Texture2D` to array-slice copy per image, time-sliced to at most two uploads per frame. No runtime texture compression in v1 (`Texture2D.Compress` yields DXT1 for RGB and DXT5 for RGBA input, is uninterruptible per call, and would change the pixels the colour test compares); it is an optimisation to revisit if GPU memory, not frame time, is the constraint (11.14). Residency: the loader fills slots nearest-first within 25 m and evicts the least-recently-near slot when a nearer stand needs one; the slot count is the hard bound and the 25 m radius is a preference (5.5.5). A world transition releases the old world's array before the new one allocates.
4. **The isolated image path.** Image surfaces (stands in the world and the card in card view) must be opaque to the world's rendering (so fog, exposure, depth-of-field and ambient occlusion treat them as solid objects and nothing renders behind them) and must reach the screen with their exact pixels (no lighting, exposure, fog, post-processing or temporal anti-aliasing). Two renders with matching, unjittered, output-resolution buffers achieve this:
   - **In the main camera**, every image surface is drawn in the opaque pass as an ordinary opaque object with a flat material in the stand's swatch colour. It writes depth and colour like any object, so occlusion, depth-of-field, fog and exposure are all consistent and the world behind it is correctly hidden. Its colour is a placeholder that the composite below replaces.
   - **An exhibit camera**, slaved to the main camera's pose and field of view, renders at output resolution with the **unjittered** projection and with post-processing, anti-aliasing and dynamic resolution disabled. It renders two things into its own targets: an **occluder depth** prepass of the world's opaque geometry within 60 m (terrain, props, hero geometry, avatar, plinths), and then the image surfaces with their exact texels (unlit, exposure-independent, fog-free), depth-tested against that occluder depth, into an RGBA **exhibit buffer** whose alpha is the image surfaces' **complete** coverage: the whole card rectangle as projected, not an inset. The composite must replace every pixel of the main camera's placeholder and lose no pixel of the card; whether the boundary is clean under temporal anti-aliasing, depth-of-field and resolution scaling is not assumed from the independent buffers but **measured** by test (f) below, and row I of the slice gates on it.
   - **Composite.** After the main camera's post-processing and upscaling, a final pass blends the exhibit buffer over the main output where its alpha is set. The exhibit camera's buffers are at output resolution and unjittered, so there is no mismatch with the main camera's jittered or upscaled depth; occlusion is decided by the exhibit camera's own occluder depth; TAA never sees the exhibit pixels; depth-of-field blurs the world (which is in the main camera's colour) and not the card (which is composited after).
   - **Cost and alternative.** The occluder prepass is a second depth-only draw of nearby opaque geometry; the slice measures it. If it costs more than 1.5 ms on the reference machine, the alternative is an HDRP custom pass at the after-post-processing injection point drawing the image surfaces with the unjittered projection against a depth buffer the pass itself re-renders unjittered at output resolution (HDRP documents that the camera's own depth at that point is jittered and may be at render resolution, so it must not be reused); the composite and the opaque placeholder draw stay the same. Row I of the slice's acceptance matrix (9.5) gates both.
   - **Tests** on the pinned HDRP version: (a) colour isolation: a known card rendered at exactly 244 × 340 screen pixels under a bright sky, a dark sky and dense fog, compared to the source image downscaled by the same half-step filter, per-channel tolerance 1 on 255; (b) occlusion: an occluder box placed between camera and stand hides exactly the pixels the main camera hides, to within the 0.5 px inset; (c) motion: twenty frames of camera motion with TAA on produce no frame-to-frame change on a static image surface beyond the tolerance; (d) depth-of-field on in card view leaves the card pixels within tolerance while the world behind it measurably blurs; (e) resolution scale 0.75 keeps (a) within tolerance 2 on 255; (f) boundary: along the entire perimeter of a composited card, with TAA on, with depth-of-field on, and at resolution scales 1.0 and 0.75, no pixel of the swatch placeholder survives and no pixel of the card is lost, to within one output pixel of the exact projected edge, for a static camera and across twenty frames of camera motion. The slice verifies (a) to (f) before anything else is built on the path.
5. **Terrain.** Unity Terrain per world, heightmap resolution from the world radius (513 for worlds under 100 m, 1,025 to 260 m, 2,049 beyond), layers from the kit, generated by the kit's noise with the seed, flattened under paths, corridors, pads, aprons and the plaza, and cached (7.4.4).

### 8.5 Avatar and camera

1. The avatar controller is an own kinematic controller on `CharacterController` with terrain-following, slope limits, no jumping and no falling (edges are natural and the terrain is closed by the kit).
2. Cinemachine: a third-person follow rig for explore, a composed rig for card view placed inside the apron, a dolly for portal arrival. Blends are 0.6 s unless reduced motion applies.
3. Avatar assets: one humanoid rig with the Mixamo animation set retargeted; the mannequin for the slice; Teferi for v1 (Appendix D).

### 8.6 Audio

Standard 3D audio sources with distance curves and reverb zones per kit, an ambient crossfade mixer by wedge class, a music player with per-mood loops and ducking, and an interface bus. Five mixer groups match the five volume settings. A spatialiser plugin (Steam Audio is free) is the upgrade if head-related spatialisation is wanted; it is not a dependency.

### 8.7 Pipeline additions

1. Appendix C ingestion, inheritance resolution and validation (4.12). Engine pack emission (4.13). Avatar roster derivation (4.14). The allocator (5.4) with reservations, paths, corridors, capacity, placement and the independent invariant checker (3.2). Hero volumes ingestion: the owner's editor exporter writes `pipeline/data/hero-volumes/<slug>.json` (a list of boxes and cylinders in world millimetres); the pipeline reads it as an input, so stands move only at pipeline time and the pack is the single source of positions.
2. Kit and hero cooked-size check: each kit's and each hero scene's own cooked assets are reported against 7.2 and fail the build over the ceiling; shared assets are attributed to core once.

### 8.8 Testing and CI

1. **Pipeline:** v3 tests plus Appendix C tests, allocator unit tests (angle allocation including n = 0, 1, 2 and 6; band sizing; arc sizing; widening; termination bounds), the 5.4.13 fixtures, the independent invariant checker on every fixture and every production run, and v4 contract test vectors.
2. **Unity EditMode tests:** decoder against test vectors including the malformed-join rejection; allocator against fixtures; theme row to kit parameter mapping; roster decode; scene generation entry point produces a world with the expected stand count.
3. **Unity PlayMode tests (batchmode with graphics, on the self-hosted runner):** hub loads and lists 88 portals in the specified order; a world loads and places the pack's stands; search fixtures including a parent-mapped set (`mul`) resolving to its site; filters swap the right stands to swatches; a filtered card found through search clears the excluding facets; travel portal performs the automatic walk and arrives on the apron; card view shows the right printings and the artist text; the isolated image path tests (a) to (e) of 8.4.4; reduced motion disables the listed effects; a world with one card and a pocket load; offline mode with a cached and an uncached card.
4. **Bench:** a scripted path per world class (hub, Dominaria, a mid-sized world, a one-set world, a pocket): arrive, walk from the plaza to the rim along one wedge on the radial path, cross one band on the ring path, enter and leave card view, open the travel menu and travel to a named card in this world (timed), travel to a named card in another world (timed), open and close the map, portal out. Logs p50, p90, p99 and longest frame, GPU and process memory, resident images, streaming hitches, and both travel times as JSON, for a warm run and a cold run.
5. **CI matrix (one, authoritative).**

| Where | Jobs | Required for merge |
|---|---|---|
| GitHub-hosted runner | pipeline tests, allocator fixtures and checker, contract test vectors (v3 and v4), C# compile check (no Unity: `dotnet build` of the assembly definitions through the generated solution) | yes, every PR |
| Self-hosted runner on the reference machine | Unity EditMode, Unity PlayMode (with graphics), bench on the five world classes with JSON archived | yes, every PR touching `unity/`; if the runner is down the PR **waits**, there is no bypass |
| Reviewer, by hand on the reference machine | the bench on the PR head merged with `main`, the checkpoint captures | yes, for the paths in 8.8.6 |
| Owner, by hand on the light Mac | the bench on HDRP low | when a gate names it |

6. **Self-hosted runner recipe.** The GitHub Actions runner runs as a launchd agent inside the **owner's own GUI session** on the reference machine, so Unity has a window server and the GPU; the Unity Hub is signed in with the owner's Unity ID (Unity 6 Personal licences activate through the Hub sign-in, not by licence file). One workspace per job in a runner directory of its own, never the agents' checkout and never the owner's editor project path, so a `Library` lock is never shared; `-batchmode` without `-nographics` for PlayMode and the bench; Git LFS installed and `lfs.fetchexclude` empty; runner concurrency 1 so a bench never shares the GPU with another job; the bench job fails if any other Unity process is running. The runner registration token is created by the agents through the repository's Actions API, which the `gh` identity on this Mac administers. A dedicated macOS user account for the runner is an optional hardening step recorded in `docs/ci-runner.md`, not a requirement: the agents already run every pull request's code as the owner's user, so a second account isolates nothing the project does not already expose. The recipe is checked in under `docs/ci-runner.md` and re-verified when Unity or the runner updates. *Amendment 1 (2026-10-10, owner decision on DEC-950): the first print required the dedicated account.*
7. **Review rule.** The reviewer-draws rule from `docs/decisions` continues: for any PR touching `Assets/Kits/**`, `Assets/Scripts/Layout/**`, `Assets/Scripts/Avatar/**`, `Assets/Scripts/CardView/**`, any shader graph or any HDRP settings asset, the reviewer (never the implementer) runs the bench on the reference machine from the PR head merged with `main` and captures the checkpoint screenshots, and the verdict quotes the p90, p99 and longest-frame figures and attaches the captures. No figures, no merge. Light Mac figures, when a gate requires them, are the owner's and are named as such in the verdict.

### 8.9 Deployment

1. Builds: macOS Apple Silicon `.app` in a `.dmg`; Windows x64 in a `.zip`, an installer later. Produced by a batchmode build script on the self-hosted runner on tag. Internal evaluation builds stay on the reference machine. Distribution builds, once 11.1 allows, are published as GitHub Releases on this repository, one per tag with the data hash in the notes (7.7.2), and optionally mirrored to itch.io.
2. Data refresh: run the pipeline, commit both packs and the report in a pull request titled with the Scryfall bulk timestamp, review the report diff, merge, build the native edition, and redeploy the web edition from the same commit (8.11.2).
3. The build carries one data pack; a release never changes its data under the user (7.4.1).

### 8.10 Privacy

No analytics, no crash reporting, no accounts, no update checks. Settings, the recently-visited list, the image cache and the terrain cache live in the OS application-support directory. The only third party the application contacts is Scryfall's image CDN.

### 8.11 The web edition

1. The v3 web application at the Wave 4 head (`main` `c1d6ef7`, production dataset `a5846bec28d1447e`) is tagged `web-edition-v1` and stays deployed on Vercel as the web edition. No further web feature waves are planned; security and dependency fixes only. It is the screen-reader path to the catalogue (6.10.6).
2. Contract v3 stays frozen for it. **Every data refresh redeploys the web edition** from the same commit as the native build, so the two editions always show the same catalogue; the pipeline already emits the web pack, so the cost is one Vercel deploy per refresh.
3. The three riders without issues from Wave 4 (collector-number string compare, same-day report overwrite, `worlds-centre` 2,905 vs 2,921) are closed as "web edition feature-frozen" unless the owner reopens them.

### 8.12 Content supply

Text serialisation does not make content free. This subsection says who supplies what.

1. **Kit code and prefabs:** the engineers. **Kit assets** (models, textures, terrain layers, audio): procured per kit from CC0 or owner-made sources. Named candidate sources: Kenney (models, CC0), Quaternius (models, CC0), Poly Haven (textures, HDRIs, models, CC0), ambientCG (textures, CC0), Freesound (audio, CC0 filter only), the owner's own Blender and field recordings. An engineer on a content task may fetch and commit a CC0 asset provided they record it.
2. **Per kit `CREDITS.md`:** every binary asset with source URL, author, licence and date fetched. Review checks the file against the LFS contents; an asset without a row blocks the merge.
3. **Hero set-pieces and the avatar:** the owner, in the editor and Blender, on their own schedule. Order of magnitude from the plan: one to two weeks per hero set-piece, a few days to four weeks for Teferi depending on the generation path; twenty set-pieces are twenty to forty owner-weeks and are **not** a release dependency.
4. **Staging.** First distribution (after 11.1): core (which includes the hub's portal ring), twelve kits, Dominaria's set-piece, the mannequin replaced by Teferi. Subsequent releases add set-pieces in Appendix C.1 order; nineteen remain after Dominaria. The archive rows in 7.2 are sized for this staging.
5. **Cooked budget accounting** (7.2): every asset is attributed to exactly one of core, one kit or one hero scene; anything used by more than one kit or scene moves to core. Twelve kits and twenty hero scenes at the ceiling are 1,920 MB cooked with core; compression brings the archive under the 2 GB file limit, and the targets keep the first release near 1 GB.

## 9. Quality and evaluation

### 9.1 Automated checks (CI)

1. Pipeline tests, allocator fixtures and the independent invariant checker (8.8.1) on every pipeline change.
2. Unity EditMode and PlayMode suites (8.8.2, 8.8.3) on every change under `unity/`, on the self-hosted runner.
3. Kit and hero cooked sizes (8.7.2) and archive size (7.2) on every build.
4. Bench (8.8.4) on the self-hosted runner and by the reviewer.
5. Appendix C validation (4.12.3), the avatar fixtures (4.14.3), the allocator fixtures (5.4.13) and the plane fixtures of v3 9.1.5 on every pipeline run.
6. **Presentation lint**, scoped to authored content only (interface strings, authored asset file names, kit and hero assets, the download page): no Wizards logo, set symbol, planeswalker symbol or mana symbol as an authored asset, and no use of the word "game" or "player" in authored interface text. Catalogue data is exempt: card names (Game of Chaos, Goblin Game), oracle text, set names and the marks printed on card images are shown unaltered. The lint also checks that no network host other than Scryfall's image CDN appears in the build's configuration and that every kit has a complete `CREDITS.md`. The lint is a presentation check; the whole-product classification is 11.1.

### 9.2 Data quality gates (reviewed per pipeline run)

As v3 9.2, plus: widenings per site, minimum spacing achieved per world, path connectivity, hero volume intersections resolved, Appendix C resolved rows changed since the last run, avatar roster changes, invariant checker results.

### 9.3 Visual review (manual, per milestone-sized change)

The reviewer captures a fixed set of checkpoints from the bench path and presents them for the owner. Checkpoints:

1. Start screen.
2. Hub arrival and the portal ring.
3. Dominaria arrival in the plaza; the view down one wedge to the rim.
4. A site at close range with images loaded; the hover label with artist.
5. Card view, one card with the back-image flag flipped, the printings panel.
6. A water body with its sound (a short clip).
7. A kit world (not hero), the Blind Eternities' world, and a pocket.
8. The map overlay with a filter active.
9. Reduced motion on, the same Dominaria arrival.
10. A one-card world.

Criteria the owner judges against, phrased so failures are nameable and matched to goal 3's staging:

- For every hero entry that has its set-piece: you can tell which plane you are on from the environment alone. For every other world: you can tell which kit you are on, and two visited worlds on the same kit are told apart by sky, light, palette, weather or water.
- A river or lake is heard before it is seen, and the sound comes from where it is.
- No card image is ever tinted, stretched, blurred, or shown without its printed artist line.
- Wedges are legible from the plaza: the ground under a wedge reads as its colour.
- From the avatar's height Dominaria reads as a place, not a chart.
- The avatar's footing, turn and stop feel physical: no sliding, no snapping.
- No streaming hitch is felt while walking a wedge from plaza to rim.
- Nothing on screen asks you to do anything.

### 9.4 Definition of done

A feature is done when its requirements in sections 4 to 8 are implemented, the automated checks in 9.1 pass, the pipeline report has been reviewed if data changed, the reviewer's bench figures are on the review issue, and the visual review has been accepted by the owner where the change is visible.

### 9.5 The vertical slice: scope, prerequisites, schedule, acceptance matrix

Before Wave 5 is cut, a slice on Dominaria proves the engine and the design. It is an experiment with a bounded re-scope, not a deadline with a penalty.

**Prerequisites, done before the week starts and not counted in it** (owned by the owner unless stated; tracked as a checklist on the slice issue):
- Unity 6 LTS and HDRP installed on the reference machine; the project skeleton created (HDRP template, Force Text, LFS, packages pinned: Cinemachine, Input System, Addressables, VFX Graph, Animation Rigging); the first commit of `unity/Eternities/`; **the self-hosted runner recipe (8.8.6) applied and green on the skeleton's empty test suites**. There is no deferral: the CI matrix of 8.8.5 applies to the slice's pull requests as to any other, and the reviewer's hand-run bench is in addition to it, never instead of it.
- The data pack hash pinned: `a5846bec28d1447e`, read through the v3 pack files (the slice has no contract v4 pack; its C# decoder reads the v3 `planes.json`, the `planes/dominaria.<n>.json` shards for colour identity, set and printings, and `swatches.bin`); the slice's own C# allocator (5.4) produces Dominaria's positions and runs the invariant checker; contract v4 emission is Wave 5 work.
- `docs/scryfall-policy.md` re-verified for a desktop client (4.15.4).
- Asset sources chosen for the `temperate` kit's slice subset (ground textures, a dozen props, one ambient loop, one river loop) with their `CREDITS.md` rows written, by an engineer on a content task.
- The bench harness design (JSON schema, path script) agreed in the slice issue.
- The owner's two editor days scheduled (which days, which hours).

**Scope (the week):**
- The allocator in C# for Dominaria with the invariant checker; a report of the actual figures (5.4.14).
- Dominaria terrain on a `temperate` kit subset with one river and one lake in the kit's water zones, flattened under the allocator's paths; plaza, radial and ring paths visible as ground.
- The mannequin avatar with the own controller and the Cinemachine follow rig.
- Stands for all 6,271 Dominaria cards with the image stream, the texture array, swatches, and the isolated image path with its five tests.
- Card view with the printings panel from the shard data.
- A plain hub with Dominaria's portal and the return portal, with the hold rule.
- A travel menu with this world's sites and a card list, so the travel row of 7.2 can be timed; search, filters, the map and waystone travel are out of scope.
- One ambient bed and the river's spatial sound.
- The bench path with JSON output, warm and cold runs, on HDRP high (reference) and HDRP low (light Mac, owner-run).
- Not in scope: theme table, hero set-pieces, music, Teferi, filters, the map, other worlds, pockets, contract v4 files, cross-world travel.

**Schedule sketch (five working days, one agent engineer; the owner at most two days in the editor):**
- Day 1: project opens from the skeleton; the v3 pack reads; the C# allocator places Dominaria's stands as plinths and the checker passes; bench harness skeleton. Owner: half a day setting HDRP quality levels and the terrain.
- Day 2: controller, follow camera, hub, portal, hold rule; terrain generation flattened under paths. Owner: half a day on the river and the lake with the HDRP water system.
- Day 3: image stream, texture array, isolated image path and its five tests.
- Day 4: card view and the printings panel; the slice travel menu; ambient bed and river sound; reviewer captures.
- Day 5: bench runs warm and cold on the reference machine; the owner runs the light Mac; fixes; the reviewer's verdict. Owner: up to one day across days 3 to 5 for judgement and the light Mac runs.

**Acceptance matrix.** One table decides the slice. Every row is evaluated; the outcome column says what each result means.

| Row | Check | Machine and settings | Run | Pass | On miss |
|---|---|---|---|---|---|
| D | Delivery: the scope above shipped in five days, owner editor time ≤ 2 days, reproducible by the reviewer through the scene generation entry point | — | — | required | **Delivery miss.** Re-scope once (drop the slice travel menu, then the lake, in that order; the 7.2 travel row is then untimed and question 4 is judged on the river alone) and continue for at most three more days. If the re-scoped slice still misses, the slice **stops**: the owner decides between a second slice with a changed scope or a halt. A delivery miss is never an engine trigger. |
| R1 | p90 ≤ 20 ms, p99 ≤ 40 ms, longest ≤ 100 ms, GPU ≤ 6 GB | reference, HDRP **high**, native | warm | required | Try R2. |
| R2 | same thresholds | reference, HDRP **medium**, native | warm | required if R1 missed | Pass here is **degraded pass 1**: the slice passes; Wave 5 makes HDRP medium the reference machine's ceiling setting and HDRP high a target; 7.2's first three rows are re-labelled accordingly. Miss: try R3. |
| R3 | same thresholds | reference, HDRP **low**, native, then resolution scale 0.75 | warm | required if R2 missed | Pass here is **degraded pass 2**: the slice passes; Wave 5 makes HDRP low (at the passing resolution scale) the reference machine's ceiling setting, medium and high targets, and 7.2 is amended the same way. Miss: **renderer miss**. Attribute the bottleneck first with the HDRP debug views, the Render Graph viewer and a profiler capture attached to the verdict. If the time is in our content or code (stand count, texture uploads, terrain detail, streaming, the exhibit prepass), fix and repeat R1 to R3 once. If it is in HDRP's fixed costs on this GPU, evaluate Godot 4 before PRD v4 is final. |
| L | p90 ≤ 40 ms | light Mac, HDRP low, default display | warm | required **while the light Mac is a gating target** | Miss: the light Mac is **suspended as a gating target for this slice**. The verdict records "light Mac: miss, target suspended pending Wave 5"; rows A and question 1 are then judged on the reference machine alone; Wave 5 decides between a URP build variant and dropping the target for good. Never an engine trigger. |
| C | the R and L rows re-run | as above | cold | informational | Recorded, not gated; the cold figures size the image cache and the hold rule. |
| I | the six image-path tests (8.4.4, (a) to (f), including the boundary test) pass with the exhibit-camera design, or with the custom-pass alternative if the prepass costs more than 1.5 ms | reference | — | required | Miss on both designs: the slice **stops** on this row and the image path is redesigned before anything else is built on it; this is a renderer-architecture miss, not an engine miss. |
| A | the five questions below answered yes by the owner, each read against the retained scope and the hardware targets in force after rows D, R and L | — | — | required | **Artistic miss.** Change the design, not the engine; record what failed. |

**What the slice must prove** (yes or no each, read against the matrix):
1. In the warm runs, does sustained Dominaria traversal pass on the reference machine at the level the matrix settled on (R1, or a degraded pass at R2 or R3), and, unless row L has suspended the light Mac as a gating target, row L on the light Mac?
2. Do all 6,271 stands satisfy spacing, chronology and site membership with every corridor reaching a path, as the checker and a walk confirm, and does the report state Dominaria's actual size?
3. From the avatar's height, does Dominaria read as a place rather than a radial chart?
4. Do third-person movement, the card view transition, the river (and the lake, if row D kept it), and the directional river sound meet the owner's standard?
5. With Scryfall unreachable, does a card whose image is cached show it with its printed artist line, does an uncached card show its swatch and the notice without a dead end, and does a card with the back-image flag flip?

## 10. Risks and dependencies

| # | Risk or dependency | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Whole-product classification under the Fan Content Policy.** A controllable named planeswalker in authored Magic worlds may be read as a game or game component even without objectives, and the avatar is derivative character content. The museum test, the notice, the vocabulary and staying off Steam reduce presentation risk and establish no exemption; neither does privacy of distribution. | Medium | High: takedown; wasted content work. | An **owner decision gate before any distribution, friends included** (11.1), with a legal read recommended. Until then: internal evaluation only; the slice and the kit work proceed because they are engine and layout work; Teferi's model is not commissioned; every feature keeps the gallery reading (non-goal 1, 9.1.6). |
| 2 | **Character likeness.** Teferi is a Wizards character; an avatar model is a derivative work. | Medium | Medium | Folded into 11.1's legal read; original stylised interpretation, no card art on the model (5.8.4); the roster is data-derived. |
| 3 | **Owner time.** Twenty hero set-pieces (twenty to forty owner-weeks) and one avatar are owner work. | High | Medium: schedule. | Staged releases (8.12.4); heroes are additive (5.6.4); the first distribution needs only Dominaria's set-piece; the slice has no hero work. |
| 4 | **Team skill.** Five engineers move from TypeScript to C# and the Unity editor through text. | High | Medium: the first wave is slower. | Text-first conventions (7.6.4, 8.2); the scene generation entry point (8.2.5); batchmode tests; the slice is the training wave; kit work is parallel by kit. |
| 5 | **HDRP on Apple Silicon** underperforms or has artefacts, or HDRP low cannot carry the light Mac. | Medium | High | The acceptance matrix (9.5) with bottleneck attribution before any engine decision; the URP build variant as a costed Wave 5 option (8.1.1). |
| 6 | **Unity licence or pricing changes** (as in 2023). | Low | Medium | Personal licence at zero revenue; Godot 4 named; the data layer and the allocator are engine-independent. |
| 7 | **Memory and image streaming.** Thousands of card images on open terrain. | Medium | Medium | 8.4.3's uncompressed array with a hard slot bound and mips; site streaming (7.3.3); the resident image ceiling (7.2); compression held in reserve (11.14). |
| 8 | **The isolated image path.** Mixing jittered, render-resolution main-camera buffers with exact image pixels has documented pitfalls. | Medium | Medium | The exhibit-camera design with its own unjittered, output-resolution occluder depth and coverage (8.4.4), a costed custom-pass alternative, five tests; matrix row I stops the slice on a double miss; verified before anything is built on it. |
| 9 | **Scryfall terms for a desktop client.** | Low | High | 4.15 (CDN only, one concurrency limit, HTTP-aware backoff, identifying headers); verified for a desktop client on 2026-10-10 (DEC-952, Amendment 2). |
| 10 | **Content provenance.** A kit asset or sound turns out not to be CC0. | Medium | Medium | Per-kit `CREDITS.md` checked in review (8.12.2); named CC0 sources; prefer owner-made assets. |
| 11 | **CI for Unity.** The self-hosted runner is one machine and is down when the owner's Mac is off. | High | Low | PRs touching `unity/` wait; no bypass (8.8.5); the reviewer's local bench is required in addition, never instead. |
| 12 | **Build size and hosting limits.** | Medium | Low | Cooked budgets per kit and scene with single attribution (7.2, 8.12.5); staged heroes; the archive rows are what the host sees. |
| 13 | **Code signing.** Unsigned macOS builds show Gatekeeper warnings. | High | Low | 7.5.3; a developer certificate is a one-time owner cost; document the workaround otherwise. |
| 14 | **"Beautiful" is unbounded.** | High | Medium: schedule. | 9.3 defines what is judged; Appendix C bounds per-plane work to one entry; hero set-pieces are capped at one landmark per wedge boundary plus the plaza. |
| 15 | **The layout reads as a chart, not a place.** | Medium | Medium | Kits make wedge boundaries natural (5.4.16); the map is the only drawn wheel; the slice's third question decides on Dominaria before Wave 5. |
| 16 | **Sparse sites.** The busiest site sets each band's width, so the mean ground per stand is about three times the minimum and about a tenth of Dominaria's sites have fewer than five stands. | High | Low to medium: emptiness. | The kit dresses sparse sites more densely (5.4.6); marker stones below five stands (5.4.15); the slice walk judges it. |
| 17 | **Allocator edge cases.** A site that cannot reach capacity after twenty widenings, or a spur blocked by a hero volume. | Low | Low: a failed build with the site named. | Both are explicit failure modes (5.4.9, 5.4.8) with fixtures (5.4.13); the owner moves the volume or the pipeline widens the bound; nothing silent. |
| 18 | **Reachability.** Water, props or a hero volume could cut a path or a corridor. | Medium | Medium | Paths, corridors and buffers are reserved before stands and props (5.4.8, 8.4.2); kits cross paths only with ford or bridge prefabs; the checker asserts connectivity (invariant 10); the bench's travel rows time the promise. |

## 11. Open questions

Decisions deliberately left open, each with a default so work is never blocked.

1. **Distribution gate (owner).** Whether, after a legal read of the Fan Content Policy against the whole product (a controllable named planeswalker in authored Magic worlds, with no objectives), the owner distributes the build at all, and to whom. Default: internal evaluation only; no distribution, public or to friends, until the decision is recorded on DEC-950 or its successor; Teferi's model is not commissioned before it. The slice does not wait on this.
2. **Hub scale.** Resolved in draft 2: the hub holds the portal ring only; the Blind Eternities has its own world (5.3.4).
3. **Music.** Generative music is deferred; v4 ships per-mood loops (5.12.2). Revisit after the first hero world ships.
4. **Scryfall desktop-client terms.** Resolved by Amendment 2 (2026-10-10, DEC-952): verified for a desktop client; see 4.15.4 and `docs/scryfall-policy.md` §11.
5. **HDRP low on the light Mac.** Whether it carries the light Mac at 40 ms. Matrix row L (9.5); if not, Wave 5 costs a URP build variant against dropping the target (8.1.1).
6. **Code signing.** Whether the owner buys an Apple Developer certificate and a Windows signing certificate for the first distribution. Default: unsigned with documented steps; sign when the product has users.
7. **Distribution host.** Resolved on 2026-10-10 by the owner (Amendment 1): this repository's own GitHub Releases (7.7.2). itch.io remains an optional landing page if one is wanted later.
8. **Appendix C curation order.** Hero entries are in this document; kit-world entries need the owner's eye. Default: kit assignment now (Appendix C.2), remaining fields during Wave 5 leg 3, inheriting kit defaults until then (explicitly, per 4.12.1).
9. **Per-plane wedge dressing** (Alara's five shards, Lorwyn's two aspects). Deferred to v2: needs a `wedges:` override schema in `themes.yaml` and kit support for per-wedge variants. Default: the kit's fixed per-class table (5.6.3).
10. **Native screen-reader path.** Unity 6 has no desktop screen-reader bridge; the web edition carries the path and is kept in step (6.10.6, 8.11.2). Revisit if Unity ships one or if a text export of the catalogue in the native build is wanted.
11. **Basic-land signposts.** Deferred: under the oracle-identity rule the five basic lands are one card each, first printed in Alpha, so "a plane's basic lands" are printings, not cards, and the product has no printing-level exhibit. Needs a printing-exhibit entity and a deterministic choice rule. Default: none in v1.
12. **Gamepad on macOS.** Verify the Input System handles the common pads on macOS 14 and 15. Default: assume yes; test in Wave 5 leg 1.
13. **Spatialiser.** Standard 3D audio in v1; Steam Audio if head-related spatialisation is wanted (8.6).
14. **Runtime texture compression.** Deferred; the uncompressed 384-slot array fits the budget (8.4.3). Revisit only if GPU memory, not frame time, binds.
15. **Sun by era.** v3's idea of tying time of day to the plane's history has no clean map form. Default: dropped; fixed time of day per world.
16. **Hero scene review.** Hero scenes are large YAML the agents cannot usefully diff. Default: review by captures and bench only; hero scenes are owner-only files, and their hero volumes file is the text contract between the owner and the pipeline.

## 12. Decision record

Owner decisions on DEC-950, 2026-10-10, that this document implements:

| Decision | Owner's choice | Where it lands |
|---|---|---|
| Game boundary | A gallery, not a game; no quests or battles; but environments, third-person player, lighting, sky, props, sounds and interaction must feel like a game | Goals 1 and 2; non-goal 1; 9.3's last criterion; risk 1 and 11.1 |
| Avatar | Third-person modelled avatars | 5.8; Appendix D |
| Ground | Flat terrain per plane; feel the world fully; planes must differ | 5.4; 5.6; goal 3 |
| Environments | Nature and water where a plane has them; lava and harshness where it has those | 5.6; Appendix C; kit list |
| Audio | Ambient and music, plus the sound of props: a river must be heard | 5.12 |
| Stack | Whatever makes a beautiful 3D game; shareable URLs not needed | 8.1 (Unity 6 HDRP); 8.11 (web edition feature-frozen, data-refreshed) |
| Sequence | PRD v4 first, then the slice | This document; 9.5 |
| Engine (round 2) | Unity | 8.1 |
| Hero planes (round 2) | Twenty | 5.6.4; Appendix C.1 (nineteen planes and the Blind Eternities) |
| Avatar roster (round 2) | One, Teferi, more later | 5.8.2; Appendix D |
| Review gate (board comment) | The PRD and the plan pass through Codex before building starts | DEC-950 plan §12; four Codex passes, the last reading GO WITH CHANGES with both changes applied (plan §12.5, §12.6, §12.8 and §12.9 have the triage) |
| Acceptance (2026-10-10 17:48Z) | PRD v4 draft 5 accepted as the product contract; the Dominaria slice authorised | Plan revision 7 confirmed; PR #106; plan §12.10 |
| Runner account (after acceptance) | The runner runs in the owner's own user session | 8.8.6, Amendment 1 |
| Distribution host (after acceptance) | This repository's own GitHub Releases | 7.7.2, 8.9.1, 11.7, Amendment 1 |
| Scryfall on a native client (after acceptance) | CEO ruling on DEC-952's re-verification, no owner choice needed: two image hostnames, the cache fill rule, a pause on 429 and 403 that covers every request. Erratum after the DEC-954 review: 400 joins the pause, and a URL dropped by a network failure returns once any request succeeds. Erratum 2 after the DEC-955 review: while any such URL is left and nothing is in flight, the loader retries one every 30 s, so a visitor who stands still recovers without doing anything. The owner may overrule on DEC-950 | 4.15, Amendment 2 and its errata |

What carries over from v3 unchanged: sections 3 and 4 (as amended here), Appendices A and B in their committed form, the pipeline, the first-printing rule, the plane assignment rules, the colour and time laws (re-expressed as wedges and bands), the search and filter semantics, the reduced-motion commitment, the privacy stance, the Fan Content Policy and Scryfall compliance rules, and the measurement discipline (reviewer draws, figures in the verdict, ceilings enforced on real hardware).

Superseded by this draft (the plan's sections 1 to 11 still show them): the first-person planeswalker frame (plan §5); walking on globes (plan §4.1); a URP quality rung (plan §11.4); an avatar roster screen listing unavailable planeswalkers (plan §11.2); ten hero planes (plan §11.3); Dominaria at 250 m across (plan §11.2).

## Appendix C — Plane theme table

Source form, fields, allowed values and validation are in 4.12. The tables below are the content of `themes.yaml` for the hero entries and the kit assignment for the kit worlds; omitted fields inherit from the kit explicitly.

### C.1 Hero entries (20): nineteen planes and the Blind Eternities

Ranked by card count on dataset `a5846bec28d1447e`. Together the twenty entries hold 26,322 cards, 92.0 percent of 28,603. `hero: true` for every row. Set-piece text is a proposal for the owner's editor work and may change without a document revision; kit, water and ambient are requirements the pipeline validates. Palettes are three sRGB colours; the names below are resolved to hex in `themes.yaml`.

| # | Slug | Cards | Kit | Sky | Light | Palette | Weather | Water | Ambient | Music | Set-piece proposal |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `dominaria` | 6,271 | temperate | cumulus | 35° warm | green, ochre, slate | none | river+lake | meadow | heroic | Tolarian ruin in the plaza; standing stones at the wedge boundaries |
| 2 | `blind-eternities` | 4,204 | void | starfield | 20° cold | indigo, violet, silver | none | none | void | ambient | Drifting motes; shards of other worlds at the wedge boundaries |
| 3 | `ravnica` | 2,304 | stone-city | overcast | 45° neutral | sandstone, verdigris, gold | none | canals | city | grand | Guild plaza; a bridge per wedge boundary |
| 4 | `innistrad` | 1,655 | moor | night | 20° cold | grey-green, black, bone | fog | marsh | moor-wind | gothic | Cathedral in the plaza; gallows and lanterns at the boundaries |
| 5 | `new-phyrexia` | 1,405 | phyrexian | haze | 30° cold | chrome, black, acid green | ash | oil | machinery | industrial | Mirrodin's metal plain; Phyrexian spires |
| 6 | `zendikar` | 1,256 | mountain | clear | 50° neutral | teal, white, stone | none | waterfall | alpine-wind | adventurous | Floating hedrons over the plaza |
| 7 | `lorwyn` | 1,161 | forest | dusk | 15° warm | gold, green, violet | fireflies | river | forest | whimsical | A great tree in the plaza (the two aspects wait for 11.9) |
| 8 | `tarkir` | 931 | mountain | clear | 40° cold | red, white, slate | snow | river | alpine-wind | epic | Dragon bones in the plaza; clan banners at the boundaries |
| 9 | `kamigawa` | 917 | forest | dawn | 25° warm | crimson, pink, jade | none | river+lake | forest | serene | Torii gate in the plaza; a neon tower at the blue boundary |
| 10 | `theros` | 790 | coast | clear | 55° warm | marble, aegean blue, gold | none | sea | surf | mythic | Temple on the shore in the plaza |
| 11 | `ixalan` | 750 | forest | haze | 50° warm | emerald, gold, teal | rain | river | jungle | adventurous | Orazca's golden city in the plaza; a cove at the blue boundary |
| 12 | `rath` | 717 | volcanic | overcast | 30° cold | rust, grey, violet | ash | lava | volcanic | ominous | The Stronghold in the plaza; flowstone ridges |
| 13 | `arcavios` | 676 | stone-city | clear | 45° neutral | ivory, sapphire, garnet | none | canals | campus | serene | The Biblioplex in the plaza; five college gates |
| 14 | `forgotten-realms` | 664 | temperate | overcast | 30° neutral | moss, stone, torchlight | fog | river | meadow | adventurous | A tavern in the plaza; a dungeon mouth at the black boundary |
| 15 | `eldraine` | 565 | forest | cumulus | 40° warm | rose, green, gold | none | lake | forest | whimsical | A castle in the plaza; the wilds at the green boundary |
| 16 | `alara` | 510 | temperate | clear | 45° warm | ivory, obsidian, jungle green | none | river | meadow | epic | Five shard markers at the boundaries (the per-shard dressing waits for 11.9) |
| 17 | `avishkar` | 437 | filigree-city | haze | 60° warm | copper, teal, cream | none | canals | workshop | bright | Aether spires in the plaza |
| 18 | `amonkhet` | 431 | desert | clear | 70° warm | sand, lapis, gold | sandstorm | river | desert-wind | solemn | Obelisks and a pyramid in the plaza; the Luxa as the river |
| 19 | `capenna` | 352 | stone-city | night | 10° warm | cream, gold, black | none | sea | city | swing | Art-deco skyline in the plaza; a harbour at the blue boundary |
| 20 | `thunder-junction` | 326 | desert | dusk | 15° warm | red rock, dust, sky blue | none | river | desert-wind | western | A frontier town in the plaza |

### C.2 Kit worlds (26)

`hero: false`. Kit assignment is a requirement; every other field inherits from the kit until curated (11.8).

| Slug | Cards | Kit | Slug | Cards | Kit |
|---|---|---|---|---|---|
| `mercadia` | 310 | mountain | `kaldheim` | 308 | mountain |
| `duskmourn` | 306 | moor | `ikoria` | 302 | forest |
| `bloomburrow` | 299 | temperate | `edge` | 276 | void |
| `fiora` | 146 | stone-city | `ulgrotha` | 116 | moor |
| `kylem` | 87 | stone-city | `rabiah` | 75 | desert |
| `shenmeng` | 30 | mountain | `zhalfir` | 4 | temperate |
| `xerex` | 2 | void | `vryn` | 2 | filigree-city |
| `tolvada` | 2 | moor | `moag` | 2 | forest |
| `karsus` | 2 | volcanic | `gobakhan` | 2 | desert |
| `belenon` | 2 | temperate | `azgol` | 2 | volcanic |
| `shandalar` | 1 | temperate | `segovia` | 1 | coast |
| `regatha` | 1 | volcanic | `pyrulea` | 1 | forest |
| `muraganda` | 1 | forest | `ergamon` | 1 | temperate |

### C.3 Pockets (42)

Generated each run from the `pocket` template: `kit` void, `sky` starfield, `light` 20° cold, `palette` indigo, violet, silver, `weather` none, `water` none, `ambient` void, `music` ambient, `hero` false, no set-piece. The pipeline derives the list from the data; it is not maintained by hand, and the report prints it.

## Appendix D — Avatar roster

1. **Derivation** (4.14): every planeswalker subtype on any face of an included planeswalker card. On dataset `a5846bec28d1447e` this is about eighty names; the exact list is `avatars.json`.
2. **v1 avatar:** Teferi. Data-derived home plane: the Blind Eternities (Teferi, Temporal Archmage, Commander 2014, is the earliest included Teferi planeswalker card). Override: `dominaria`. Portrait: the first printing of Teferi, Temporal Archmage unless overridden. "Your cards": every included card with the Teferi subtype or "Teferi" in its name (this includes the creature Teferi, Mage of Zhalfir).
3. **Production path:** concept from the character's card art as reference, never a copy; a stylised humanoid model (the owner in Blender, or AI mesh generation followed by clean-up); auto-rig to the shared humanoid rig; the shared Mixamo animation set (idle, walk, run, turn, look at a stand, portal step) retargeted; import as a prefab under `Assets/Avatars/<name>/`. One avatar by hand is two to four weeks of a 3D artist; AI generation plus retargeting brings a first acceptable version to a few days. The model is commissioned only after 11.1.
4. **Adding an avatar** is content plus one surface: a model and a prefab, `modelled: true` in the override file, and the avatar selection screen, which does not exist in v1 and is judged under risk 1 when it is proposed.
5. **The slice** uses a placeholder mannequin, not Teferi.

## Appendix E — Fan Content Policy checklist

Checked at every build the reviewer signs off, and the whole-product question in 11.1 decided by the owner before any distribution.

1. The product is free and non-commercial; no payment, donation link or advertising anywhere in it or on its download page.
2. The policy's required notice is on the start screen and the download page.
3. No Wizards logo, set symbol, planeswalker symbol, mana symbol or trademark appears as an authored asset or in the title (9.1.6). Plane names, card names and complete card images, with whatever marks they print, are the permitted material and are shown unaltered.
4. No Wizards music, video or voice is used.
5. No game mechanic exists (non-goal 1); authored interface text does not use the words "game" or "player"; catalogue data is shown as it is.
6. Card images are shown as complete cards, flat, undistorted, untinted and sharp, with the printed artist line visible and the artist named as text in card view and on the hover label.
7. Cards with `content_warning` are excluded (v3 4.4.2).
8. Scryfall is credited as the data and image source; images are fetched on demand from the image CDN only, never mirrored.
9. The build has not been distributed, publicly or privately, unless 11.1 is recorded as decided.
