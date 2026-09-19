# Eternities — Product Requirements Document

**Name:** Eternities (from the Blind Eternities, the space between planes)
**Document type:** Product requirements plus architecture. Deliberately excludes milestones and roadmap.
**Primary reader:** Claude Code (implementer). Owner: Diogo.
**Status:** Draft for owner review
**Date:** 2026-09-04

---

## 1. Summary

Eternities is a free, browser-based 3D visualisation of the Magic: The Gathering multiverse. The multiverse is a field of slowly spinning galaxies, one per plane in Magic lore; each galaxy is made of stars, one per unique card first printed on that plane; each star, when focused, becomes a 3D card with its printings orbiting it as planets. Cards that belong to no single plane drift as dust in the Blind Eternities between the galaxies.

Everything visible is derived from data. A Python pipeline reads Scryfall's bulk card file, applies inclusion rules (no Universes Beyond, no Secret Lair, no *Un*-sets, no digital-only or promotional printings), assigns every card to a plane by the set of its first printing using a curated set→plane table and a per-card override file, lays out each plane as a five-arm spiral (arms by colour identity, radius by chronology), and emits compact static artefacts. A React and react-three-fiber frontend renders all stars in a single draw call with motion computed on the GPU, streams the data so galaxies appear one by one, loads card images only as the camera approaches, and exposes search, filters, and deep links to any plane or card.

The product has two commitments that shape every decision in this document: it is never static, at any zoom level, and it is smooth on an ordinary Apple Silicon laptop. Sections 5 through 8 specify the visual model, interaction, non-functional budgets, and architecture; section 9 turns "smooth and beautiful" into checks; the appendices hold the plane roster and set table the pipeline runs on. This document is written for Claude Code as implementer, with Diogo as owner and reviewer.

## 2. Goals and non-goals

### 2.1 Goals

1. **One continuous multiverse.** Every plane in Magic lore, every in-universe card, and every printing of every card, explorable as a single 3D space with no view boundaries.
2. **Mesmerising by default.** Photoreal space, never static at any level, smooth at 60 fps on the reference machine. This is the product's reason to exist; it is a goal, not a polish item.
3. **The picture is the data.** Galaxy shapes, arm density, star brightness, and dust are all derived from real card data, so what looks beautiful is also true.
4. **Findable and shareable.** Any card, plane, or set is reachable by search; any plane or card is a URL, with filters included.
5. **Maintainable by one person.** Three curated inputs (Appendices A and B, `overrides.json`), a pipeline that fails loudly on anything it cannot place, and a refresh that is one row plus one run.
6. **Free, static, private.** No accounts, no tracking, no server beyond static hosting, compliant with the Fan Content Policy.

### 2.2 Non-goals (v1)

1. Mobile and touch support.
2. Sound.
3. Universes Beyond and Secret Lair content, except Universes Within (Appendix B).
4. *Un*-sets, digital-only sets, tokens, emblems, art series, promos, oversized cards.
5. Gameplay data: prices, format legality, rulings, decklists, collection tracking.
6. Lore content beyond names: no plane descriptions, no story text.
7. Automatic data refresh; the pipeline runs by hand.
8. Deep links to a specific printing; links resolve to the card, which opens on its first printing.
9. Per-card plane assignment at scale; the override file exists but curating it is incremental, not a launch requirement.
10. Localisation; English only.
11. Visual regression testing.

## 3. Domain model

### 3.1 Entities

| Entity | Definition | Identity |
|---|---|---|
| **Multiverse** | The whole; the root of navigation. Exactly one. | — |
| **Plane** | A world in Magic lore. Every plane in Appendix A, whether or not any card is assigned to it. | slug (Appendix A) |
| **Blind Eternities** | The space between planes. A plane-like member of the roster that holds every included card not assigned to a specific plane. | slug `blind-eternities` |
| **Set** | A Scryfall set that contributed at least one included printing. A set with an Appendix B row belongs to exactly one plane (or the Blind Eternities); reprint-only sets have no row and no plane of their own. | Scryfall set code |
| **Card** | A unique Magic card as defined by its oracle identity, independent of printing. | Scryfall `oracle_id` |
| **Printing** | One physical release of a card in one set. | Scryfall card `id` |
| **Face** | One side of a card. Single-faced cards have one; double-faced cards have two. | position within card |

### 3.2 Relationships

1. Multiverse 1 → * Plane. The Blind Eternities is one member of that set.
2. Plane 1 → * Set, for sets with an Appendix B row. Multi-plane sets are assigned to the Blind Eternities unless Appendix B says otherwise.
3. Plane 1 → * Card. A card belongs to exactly one plane, determined by its first printing's set (4.5, 4.6) or by an override.
4. Card 1 → 1..* Printing. Every included card has at least one included printing; the earliest is its first printing.
5. Card 1 → 1..2 Face.
6. Set 1 → * Printing. A printing belongs to exactly one set.

The consequence that matters most: **a card's plane is fixed by where it was first printed, so reprints never move a card.** A Ravnica card reprinted in a Masters set is still a Ravnica card, and the Masters printing appears as a planet around it.

### 3.3 Invariants

1. Every card is in exactly one plane. No card is in two, none is in zero.
2. Every plane in Appendix A exists in the visualisation. Card count may be zero.
3. Every set that is some card's first printing has an Appendix B row (or a parent with one). Otherwise the pipeline fails.
4. First printing is a total order: ties are resolved deterministically (4.5.1), so the same input always yields the same first printing.
5. Positions are a pure function of the input data, the appendices, and the run date (4.9.1).

### 3.4 Vocabulary

One term per concept throughout this document and the codebase:

- **plane**, never "world" or "setting"; **galaxy** only for the rendered form of a plane (5.2).
- **card** for the oracle-level entity; **printing** for a specific release; never "version".
- **star**, **planet**, **dust** for the rendered forms of card, printing, and Blind Eternities cards.
- **focus** for the object the camera is tethered to; **fly-to** for an animated camera move between focus targets.
- **level** for the three camera distances: multiverse level, plane level, card level.
- **first printing** as defined in 4.5, never "original" or "earliest edition".

## 4. Data requirements

### 4.1 Sources

1. **Card and printing data:** Scryfall bulk data, `default_cards` file (every printing, in English wherever an English printing exists). Fetched by the preprocessing pipeline, never by the browser.
2. **Set metadata:** Scryfall `/sets` endpoint (code, name, type, release date, parent set, digital flag).
3. **Plane roster:** Appendix A, curated. Canonical list of planes, slugs, and display names.
4. **Set→plane assignments:** Appendix B, curated. One row per set that is some card's first printing; also carries the Universes Beyond flag and an explicit exclusion flag.
5. **Card-level overrides:** `overrides.json`, curated, mapping card name → plane slug. Starts empty; grows as misassignments are noticed.
6. **Images:** Scryfall image URIs (`small`, `large`, `art_crop`) and the Scryfall card back, loaded on demand by the browser. Never bundled, never bulk-downloaded by preprocessing.

### 4.2 Identity

1. A **card** is a Scryfall `oracle_id`. A **printing** is a Scryfall card `id`.
2. Card name, mana cost, type line, oracle text, and colour identity come from the oracle card; for double-faced cards both faces are retained.
3. A card is included if and only if it has at least one included printing (4.3) and is not excluded at card level (4.4).

### 4.3 Printing inclusion

A printing is excluded if any of the following hold:

1. Its set's Appendix B row is flagged Universes Beyond or excluded.
2. Its set code is a Secret Lair code (per Appendix B.4, which also lists the exemption) or its set `set_type` is `promo`, `token`, `memorabilia`, `minigame`, `funny`, `alchemy`, or `vanguard`.
3. Its `layout` is `token`, `double_faced_token`, `emblem`, `art_series`, `planar`, `scheme`, `vanguard`, `augment`, `host`, or `reversible_card`.
4. `promo` is true, `digital` is true, or `oversized` is true.
5. `security_stamp` is `triangle` (Universes Beyond stamp; secondary guard for UB cards inside otherwise included sets — verify this field's semantics against current Scryfall documentation at build time), **unless its Appendix B row (or the nearest one up its parent chain) is marked `stampExempt`**. The stamp is a proxy, and a set can carry it for a reason unrelated to Universes Beyond; the exemption is how Appendix B records that for one set, and it does not change what the stamp means anywhere else. A row marked both `stampExempt` and Universes Beyond is a contradiction the pipeline rejects. Added 2026-09-14 for `clu` by owner decision (DEC-710 sign-off 0dec0512).
6. `lang` is not `en`.
7. `flavor_name` is present. These are Universes Beyond skins printed on in-universe cards (the Godzilla series in Ikoria, the Dracula series in Crimson Vow); the card itself stays, the skinned printing goes.
8. Its set's release date is after the pipeline run date. Preview cards for unreleased sets never enter; a set is added to Appendix B once it has shipped.

### 4.4 Card exclusion

1. A card is excluded if it has no included printings after 4.3.
2. A card with `content_warning` true is excluded regardless of printings; Wizards has withdrawn these cards and asked that their images not be displayed.
3. A card is excluded as Universes Beyond if its earliest printing of any kind — every printing in the bulk file, before 4.3 is applied — belongs to a set flagged Universes Beyond in Appendix B, or carries a `triangle` security stamp on a printing without a `flavor_name`. **The stamp clause honours 4.3.5's `stampExempt` mark**: a set exempted in 4.3.5 alone would have its printings cleared by stage 2 only for this rule to exclude the same cards on the same stamp, so the exemption has to reach both or it ships nothing. This test uses the earliest printing rather than any printing for two reasons: Universes Beyond cards get reprinted in mixed products (The List, bonus sheets), where 4.3 alone would leave them with a mixed set as their first printing; and in-universe staples get reprinted inside Universes Beyond products (Sol Ring in the Warhammer 40,000 decks), where an any-printing test would wrongly exclude them.
4. Basic lands are included.
5. Exemption to rule 3: a card with an included printing in a set that Appendix B exempts from Secret Lair exclusion (`slx`, Universes Within) is never excluded by rule 3, whatever its earliest printing carries. Whether Universes Within cards share an `oracle_id` with their Secret Lair originals is unverified; the first pipeline run settles it, and a fixture (9.1.5) locks the answer either way.
6. Meld results (Scryfall objects whose `all_parts` component is `meld_result`, such as Brisela) are not cards of their own and are excluded; they remain reachable as the back faces of their component cards.
7. Conspiracy-type cards from the Fiora sets are included; they are normal-sized booster cards printed on a plane, unlike the plane, scheme, and vanguard objects excluded by layout.

### 4.5 First printing

1. A card's **first printing** is its included printing with the earliest release date **of that printing**; ties break by set type priority (`expansion`, `core` first, then all others) and then by set code.

   *Amended after the first pipeline run (2026-09-04).* This rule read "earliest **set** release date", which is wrong for rolling products. The List (`plst`) carries one set date of 2020-09-26 and keeps adding printings for years, so the set-date reading made The List the first printing of 706 cards that had plainly been printed elsewhere first — Academy Manufactor before Modern Horizons 2, A Killer Among Us before Murders at Karlov Manor — and would have moved every one of them onto the wrong plane. Scryfall sets `released_at` per printing, and it equals the set's date for every ordinary set, so the two readings differ only where the set date is a fiction. Tie-breaks are unchanged, and chronology bands (5.4.2) are unaffected: a band is a position in the plane's set list, not a date comparison.
2. The first printing determines the card's plane (4.6), chronology band (5.4.2), star size (rarity), and representative image at every level.

### 4.6 Plane assignment

Evaluated in order; the first matching rule wins.

1. `overrides.json` has an entry for the card name → that plane.
2. The first printing's set has an Appendix B row → that row's plane (a plane slug or `blind-eternities`).
3. The first printing's set has a Scryfall parent set with an Appendix B row → the parent's plane.
4. Otherwise the pipeline **fails** and reports the unmapped set codes. New sets are added to Appendix B deliberately, never bucketed silently.

The report lists every set mapped through rule 3, so a child set inheriting a plane it should not have (a bonus sheet under an in-universe parent, say) is visible rather than silent.

Only sets that are some card's first printing need a row. Reprint-only products (Masters, Remastered, duel decks, From the Vault, and similar) never trigger this rule; their printings still appear as planets and in panels using Scryfall's set metadata.

Every plane referenced by Appendix B or `overrides.json` must exist in Appendix A; violations fail the pipeline.

### 4.7 Plane roster

1. Every plane in Appendix A exists in the visualisation, including planes with zero cards.
2. Planes that lore treats as one world under two names (Lorwyn / Shadowmoor; Mirrodin / New Phyrexia) are one plane with one slug and a display name that carries both, as recorded in Appendix A.
3. The Blind Eternities is a member of the roster with slug `blind-eternities`, rendered per 5.3.4 rather than as a galaxy.

### 4.8 Retained fields

**Per card:** `oracle_id`, name, mana cost, type line, oracle text (per face), colour identity, layout, plane slug, first-printing id, first-printing release date, first-printing rarity (with `special` → rare and `bonus` → mythic), card-type bitmask for filtering (front face), included-printing set ids, number of included printings, layout position (section 8), and the printings list.

**Per printing:** `id`, set code, release date, rarity, image URIs (`small`, `large`, `art_crop`), Scryfall page URI.

**Per set:** code, name, release date, set type, parent set code, plane slug, Universes Beyond flag, excluded flag, count of cards first printed in the set, count of included printings.

**Per plane:** slug, display name, roster notes, card count, set list, layout parameters (section 8).

### 4.9 Pipeline outputs

1. Preprocessing is deterministic: the same inputs, the same appendices, and the same run date (an explicit argument that defaults to today and is recorded in the manifest) produce byte-identical outputs, so changes are reviewable as diffs.
2. Every run emits a report: cards and printings included and excluded per rule; cards per plane; Blind Eternities size and its top contributing sets; first-printing sets absent from Appendix B (a failure, per 4.6.4); sets excluded as unreleased (4.3.8); cards whose plane changed since the previous run.
3. Positions are recomputed each run. They are reproducible for a given input but are not required to be stable across data refreshes; deep links reference cards by `oracle_id` and resolve positions at runtime, so a refresh never breaks a link.

### 4.10 Refresh

1. Manual re-run of the pipeline, expected roughly once per set release.
2. Adding a set is a one-row change to Appendix B plus a re-run. If the run fails on an unmapped set, the report names it.

### 4.11 Attribution and use

1. Eternities is free and non-commercial, as required by the Wizards of the Coast Fan Content Policy, and displays the policy's required notice in an About view.
2. Scryfall is credited as the data and image source in the same view.
3. Images are always loaded from Scryfall's URIs at the size the view needs, never mirrored or resized server-side.

## 5. Visual model

### 5.1 Principles

1. **Photoreal space.** The reference is astrophotography, not data visualisation: bloom, dust, nebulae, a near-black sky. Every visual choice below serves that.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Still satisfied — worlds are objects in space — but the surface *is* an encoding: a card's cell sits at a longitude set by chronology and in a latitude band set by colour class (worlds spec §1.3), so this principle now coexists with a legible data layer rather than excluding one.
2. **Never static.** At every level something moves: planes spin and drift, stars orbit, ambient effects breathe. Stillness happens only where the user asks for it (focus, reduced motion).
3. **One continuous world.** There is a single scene from multiverse to card. Levels are camera distances, not separate views.
4. **The picture is the data.** Galaxy shapes, arm density, star brightness, and dust density are all derived from real card data. Nothing decorative is fabricated where a data-driven form is possible.
5. **Constrained freedom.** The camera can always be moved by hand, but it is tethered to a focus target with limits, so the user cannot get lost or clip through geometry.

### 5.2 Rendering vocabulary

| Domain object | Rendered as | Term used below |
|---|---|---|
| Multiverse | The whole scene | multiverse |
| Plane | A galaxy | plane (galaxy only when describing the visual form) |
| Blind Eternities | Diffuse dust between planes, also a selectable target | Blind Eternities |
| Unique card | A star | star |
| Printing | A planet orbiting a focused card | planet |
| Focus target | The object the camera is tethered to | focus |

### 5.3 Multiverse level

**Layout**
1. Planes are placed on a seeded flattened supercluster distribution (a thick disc, not a sphere), computed in preprocessing and stored, so every user of a given build sees the same multiverse (positions may move between data refreshes; see 4.9.3).
2. Plane visual radius ∝ log(card count), clamped to [r_min, r_max]. Planes with zero cards render at r_min.
3. Minimum spacing between planes must exceed the sum of their radii plus a margin of at least twice the drift amplitude (5.3.15), so galaxies never overlap from any angle, drift included.
4. Blind Eternities cards are scattered through the supercluster volume, avoiding plane interiors, with density highest between neighbouring planes. This dust is the Blind Eternities; it is also a selectable target (see 5.7). Focusing it brightens the dust and fades plane labels. Because the dust spans the whole multiverse, the Blind Eternities focus carries an **anchor point**: the clicked location when reached by clicking dust, the card's position when reached through a card, and the multiverse centre when reached from the plane index or search. The camera tethers to the anchor with plane-level distance limits, and clicking dust elsewhere re-anchors without a route change, so every region of dust is reachable at card-sheet tier (5.5), which applies to dust exactly as to stars.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* The Blind Eternities is no longer scattered dust. It renders as a belt around the multiverse, one arc per set (worlds spec §1.8).

**Plane signature**
5. Each plane derives a palette from its cards' colour identity distribution (W, U, B, R, G, multicolour, colourless), using the base hues in 5.4.8. The nebula tint is a weighted blend of the two dominant hues.
6. Galaxy morphology is data-driven with seeded variation:
   - Planes with ≥ 50 cards render as a five-arm spiral (5.4.1). Per-arm star density and angular width follow that colour's card count, so colour skew is visible from the multiverse level.
   - Planes with 1–49 cards render as an irregular cloud (no arm structure).
   - Planes with 0 cards render as a small, dim elliptical glow with no stars.
   - Seeded per plane: arm pitch angle, disc tilt (two axes), disc thickness, presence of a central bar.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Galaxy morphology is retired. `spiral` and `irregular` collapse into one `world` kind, drawn as a globe whose surface is the card mosaic; `empty` becomes `moon` (worlds spec §1.2, §2.4).
7. Stars are rendered at all levels as GL points with bloom, so a galaxy's shape from afar is literally its cards' positions. No pre-rendered galaxy sprites.

**Labels**
8. Plane names are always visible at multiverse level, as HTML overlay billboards anchored to the plane centre, never as 3D text.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Not every plane is labelled any more: the empty planes (moons) are unlabelled until hover — **42 of 88** on the v3 roster (worlds spec §1.8, criterion W5).
9. Label size scales with the plane's on-screen size, clamped to [min, max] pixel sizes.
10. Label collision: when two labels overlap, the plane with fewer cards yields (shifts along its screen-space normal, then fades if still overlapping). Priority ties resolve by alphabetical order.
11. Labels for planes occluded by a nearer plane are dimmed to 40%.
12. Card count appears beneath the plane name in a smaller size; zero-card planes show no count.

**Motion**
13. The entire multiverse rotates about its vertical axis. Default period: 20 minutes (barely perceptible, but the background parallax makes it felt).
14. Each plane spins about its own tilted axis at a seeded rate and direction. Default period range: 2–5 minutes.
15. Each plane drifts on a small slow orbit around its home position. Default amplitude: 3% of mean plane spacing; default period range: 60–120 s.
16. Blind Eternities dust moves with slow curl-noise turbulence, never settling.
17. All motion is delta-time based and must look identical at 30, 60, and 120 fps.

**Ambient effects**
18. Background: three-layer parallax starfield with distinct depths, over a near-black sky (default #05060a, never pure black).
19. Low-frequency nebula noise, tinted per plane signature, surrounds each plane at low opacity and extends into the surrounding dust.
20. Bloom is selective (luminance threshold), so only stars and glows bloom, never labels or UI.
21. A subtle vignette. No film grain, no chromatic aberration in v1.

**Attract mode**
22. After 45 s without input, the camera drifts cinematically between planes on eased paths, occasionally dipping to plane level. Any input cancels it immediately and returns control without a jump.
23. Attract mode never enters card level and never changes the URL.

### 5.4 Plane level

**Layout** (computed in preprocessing, stored per card as position in the plane's local frame)
1. Five spiral arms, one per colour: W, U, B, R, G. Multicolour cards occupy the central bulge. Colourless cards occupy a sparse halo around the disc.
2. Radius encodes chronology as ordinal set bands: the sets mapped to the plane in Appendix B are ordered by release date, and each set occupies one concentric band, oldest at the core, newest at the rim, with bands evenly spaced. Ordinal spacing (rather than linear dates) keeps a plane like Dominaria, with an 18-year gap in its history, a continuous spiral instead of a core with a detached outer ring.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Chronology maps to **longitude** on the world's surface, not to radius (worlds spec §1.3).
3. Angular position along an arm is deterministic per card (seeded by oracle id), with a small radial and angular jitter so arms read as organic rather than plotted.
4. Vertical spread is thin (default: 5% of disc radius), thicker in the bulge.
5. Cards within the same set therefore form a faint concentric band. Set name labels appear on these bands only when the camera is close enough that the band is ≥ 120 px wide on screen, at low priority beneath star labels.
6. Irregular-cloud planes (< 50 cards) keep the chronology-as-radius rule but distribute angle uniformly.
7. The Blind Eternities has no plane-level layout of its own; its cards are scattered through the multiverse volume per 5.3.4 and 8.6.3, and the rules in this subsection do not apply to it.

**Star encoding**
8. Hue = colour identity, seven classes: W warm ivory, U cerulean, B violet, R ember orange, G viridian, multicolour gold, colourless silver. Every multicolour card is gold; hues are never mixed per card, because a blue–red mix is indistinguishable from black's violet and the star record stores a class, not a colour.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Superseded by the art swatch (worlds spec §2.2): a cell's colour is its card art reduced to a swatch. The hue class survives only as the colour-class key the surface law bands by.
9. Size = rarity: common smallest, uncommon, rare, mythic largest. Default ratio common:mythic = 1:2.2.
10. Brightness = number of printings on a log scale, capped at the plane's 98th percentile so basic lands and staple reprints do not dominate the bloom.
    *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Superseded by the art swatch (worlds spec §2.2); `brightness` is still written by the pipeline and goes unread.
11. Each star twinkles with a subtle seeded phase and amplitude. Default amplitude: ±8% brightness.
12. On hover, a star brightens by 30% and its name appears as an HTML label; nothing else changes.

**Rotation**
13. Stars orbit the galactic centre as a rigid rotation of the plane's transform. On top of it, an oscillating shear in the vertex shader gives the arms a slow breathing motion: each star's angular offset is `A · sin(2π t / T + φ(r))`, with amplitude `A` ≤ 10° and period `T` in the 40–90 s range, seeded per plane. The offset is bounded, so arms never wind up however long the session runs. A true differential rotation (inner stars permanently faster) is forbidden: at a 1.3 speed ratio and a 3-minute spin it would wind the arms three full turns in half an hour.
    *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Retired with the disc (worlds spec §2.4). A globe has no radial shear.
14. Plane spin rate and direction are the same values as at multiverse level (5.3.14); entering a plane does not change its motion.

**Labels**
15. At plane level the current plane's name moves to the fixed HUD; other planes' labels fade out.
16. Star names appear on hover only, never persistently.

### 5.5 Card sheet tier

1. When the camera is close enough that a star would occupy ≥ 24 px on screen, the star cross-fades into a card thumbnail billboard showing that card's first-printing image (Scryfall `small` size). This is the moment the user "sees the cards".
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Replaced by the swatch→art threshold (worlds spec §1.6): a cell shows its swatch until it is large enough on screen to earn a pool layer, then cross-fades to art. The thumbnail tier is deleted.
2. Thumbnails keep their orbital motion and their hue as a rim glow, so encoding is not lost.
3. Thumbnails load lazily, nearest to the camera first, and fall back to the star glow until loaded. No thumbnail is ever a placeholder rectangle.
4. Moving away reverses the cross-fade. Thumbnails outside the frustum unload after a grace period.

### 5.6 Card level

1. Clicking a star (or thumbnail) focuses it: the star grows into a 3D card object at a fixed on-screen size, and the camera flies to frame it.
2. The card is a thin rounded-rectangle solid. Front: the first-printing image (Scryfall `large`). Back: the Scryfall-provided card back. Edge: dark neutral.
3. The card tilts toward the pointer with spring damping, ±12° on both axes, and settles to rest when the pointer leaves.
4. A subtle specular sheen moves with the tilt. No foil rainbow effect in v1.
5. Double-faced cards show the front face; a flip control turns the card 180° around its vertical axis to show the back face. Flipping never changes focus.
6. While a card is focused, its plane's rotation eases to a stop over 1 s and eases back over 1 s when focus is released; the bounded shear (5.4.13) keeps breathing, since it never displaces a star more than a few degrees. Other planes keep moving.
7. Printings appear as planets orbiting the card, ordered clockwise by release date starting at 12 o'clock, evenly spaced, each textured with that printing's art crop. Planets orbit at their own rate (default: one revolution per 60 s), independent of the plane's spin, so they keep moving while the plane is paused.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Printings are a **flat ring** around the focused card (worlds spec §1.10), not orbiting spheres.
8. Rings hold up to 24 planets each and are added as needed: one ring up to 24 printings, two up to 48, three up to 72. Beyond 72 the outermost ring is capped and the remainder is listed in the card panel. Cards with one printing show no planets.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* See 5.6.7: the ring is flat (worlds spec §1.10); the 24-per-ring capacity and the overflow tail are specified there.
9. Hovering a planet shows set name and year as an HTML label. Clicking a planet swaps the card front to that printing and marks the planet as active.
10. The card panel (2D overlay, see section 6) shows oracle text and the full printings list.

### 5.7 Camera and transitions

1. The camera is always tethered to a focus: multiverse centre, a plane centre, the Blind Eternities anchor (5.3.4), or a card. Orbit and zoom operate around the focus, within per-level distance limits.
2. Clicking a plane, the dust, or a star sets the new focus and triggers a fly-to. Esc (or a "back" control) sets focus to the parent and flies out.
3. Fly-to easing is ease-in-out. Duration: 1.2 s for a one-level hop, scaled with distance up to a 3 s cap for cross-multiverse jumps. Any input cancels the fly-to and hands over control at the current camera state without a jump.
4. Fly-to targets are computed in the destination's rotating local frame, so a spinning plane or card is framed correctly on arrival.
5. The camera never intersects a galaxy disc, a card, or a planet; approach paths arc around geometry.
6. Rendering level-of-detail transitions are tied to camera distance only and must be invisible to the user; no popping.

### 5.8 Filter dimming

1. Cards that fail the active filter dim to 10% brightness and are excluded from bloom, so they read as dust rather than stars.
2. Dimmed cards keep their position and motion; arm shapes remain visible through them.
3. Dimmed cards do not respond to hover and are not focusable.
4. Plane sizes and labels are unaffected by filters.

### 5.9 Reduced motion

When `prefers-reduced-motion` is set, or the user toggles it in settings: all rotation, drift, twinkle, and dust turbulence stop; fly-to durations drop to 0.3 s; attract mode is disabled; card tilt is disabled. Everything else renders identically.

### 5.10 Sound

None in v1.

## 6. Interaction requirements

### 6.1 Controls

1. Drag orbits the camera around the current focus. Scroll wheel or trackpad pinch zooms toward the pointer, within the focus's distance limits (5.7.1).
2. Single click on a plane, the Blind Eternities dust, a star, or a thumbnail sets focus to it. Clicking a planet activates that printing (5.6.9) without changing the focused card. No double-click behaviour anywhere.
3. Esc sets focus to the parent: card → plane, plane → multiverse. At multiverse level Esc does nothing.
4. Hovering a plane at multiverse level raises its glow by 30% and shows a pointer cursor. Hovering a star or planet follows 5.4.12 and 5.6.9.
5. Desktop pointer and trackpad only. Touch gestures are out of scope for v1 but must not break the page.

### 6.2 Focus and history

1. There are four focus kinds: multiverse, plane (including the Blind Eternities), card, and card with an active printing. The active printing is view state only and is not part of the URL.
2. Every focus change that changes the route pushes a history entry, so browser back behaves like Esc and browser forward replays the fly-to. Activating a printing changes no route and pushes nothing.
3. Focusing a card from outside its plane is a two-stage fly-to: fly to and frame the plane, hold 0.4 s, then fly to the card. For a Blind Eternities card the first stage frames the dust around the card's position, which becomes the anchor (5.3.4), not the multiverse centre. Combined duration is capped at 3.5 s. Any input cancels the remainder (5.7.3).
4. Focusing a card inside its own plane is a single-stage fly-to.

### 6.3 HUD

The HUD is a 2D HTML overlay. It never occludes the focused object and is hidden entirely during attract mode.

1. Breadcrumb, top-left: Multiverse › Plane › Card. Each ancestor segment is clickable and triggers the corresponding fly-to.
2. Filter chips, beneath the breadcrumb: one chip per active facet value, each individually removable, with a clear-all control and a live count of matching cards computed from the same data the filters use (6.6.5), so the count is exact wherever the filter is.
3. Control cluster, top-right: search, plane index, random, share, settings, help. Icon buttons with tooltips.
4. Reduced-motion and settings state persist across sessions in local storage.

### 6.4 Panels

Panels are a right-side drawer, collapsible, that opens automatically on plane or card focus and closes on Esc to multiverse.

**Plane panel**
1. Plane name.
2. Card count.
3. Sets mapped to the plane (Appendix B) in chronological order, each with release year and the number of cards first printed there. Clicking a set adds a set filter chip.
4. First and last appearance years, derived from the set list.
5. Zero-card planes show the name and "No cards assigned".
6. The Blind Eternities panel lists the sets whose cards landed there, same format.

**Card panel**
1. Card name, mana cost, type line, oracle text (both faces for double-faced cards).
2. Colour identity and rarity, as rendered in the star encoding, so the encoding is learnable.
3. Printings list: set name, year, rarity, ordered as the planets are (5.6.7). The active printing is highlighted; clicking a row activates that printing and its planet.
4. "Open on Scryfall" link to the active printing.

### 6.5 Search

1. Opened by the search control or `/`. A single text box over the scene, dismissed by Esc or clicking outside.
2. Matches card names, plane names, and set names with fuzzy matching (typo-tolerant, prefix-favouring). Double-faced cards match on either face name.
3. Results are grouped: Planes, Sets, Cards, in that order, up to 8 per group. Arrow keys move between results across groups; Enter selects.
4. Selecting a plane flies to it. Selecting a card performs the two-stage fly-to (6.2.3). Selecting a set with an Appendix B row flies to its plane and adds a set filter chip. Selecting a reprint-only set (no row, no plane) flies out to multiverse level and adds the chip, so its reprints light up across every plane they were first printed on.
5. The search index is client-side, loaded once right after the first frame (8.7), and complete before the search box can open; no network round trip per keystroke.
6. Search respects nothing about active filters: a filtered-out card still appears in results, and selecting it focuses it even though it is dimmed, then offers a one-click "clear filters" inline in the card panel.

### 6.6 Filters

1. Facets: colour identity, card type, rarity, set.
2. Semantics: OR within a facet, AND across facets. Colour identity matches when the card's identity intersects the selected colours; "colourless" is an explicit option that matches only empty identity. Card type matches on any type in the type line (creature, instant, sorcery, artifact, enchantment, planeswalker, land, battle) using the card's front face. Conspiracy cards carry none of the eight type bits, so they match only while no type facet is active and dim under any type filter.
3. Rarity values are common, uncommon, rare, mythic. Scryfall `special` maps to rare and `bonus` maps to mythic for both filtering and star size. The set facet matches a card when any of its included printings is in the selected set, so filtering by a reprint set lights the reprinted cards across whatever bands and planes they live in.
4. The set facet lists the current plane's sets when a plane or card is focused, and all sets at multiverse level.
5. Filters apply at every level and render per 5.8. Colour, rarity, and type evaluate against the star record (8.3) and are live from the first frame; the set facet evaluates against `sets.bin`, which arrives with `search.json` shortly after, and cards settle into their filtered state with a fade rather than a pop. Changing a filter never moves the camera.
6. Filter state lives in the URL query string (6.7) and survives navigation, reload, and sharing.

### 6.7 Deep links and sharing

1. Routes:
   - `/` — multiverse.
   - `/plane/<slug>` — a plane, where `<slug>` is a stable kebab-case identifier from Appendix A; the Blind Eternities is `/plane/blind-eternities`.
   - `/plane/<slug>/card/<oracle_id>` — a card, using Scryfall's oracle id so the link survives renames and reprints. The plane slug lets the first stage of the fly-to start before the card index has loaded; if a data refresh has moved the card to another plane, the card wins and the URL is rewritten.
2. Filters are query parameters on any route: `c` (colour letters, plus `C` for colourless), `t` (types), `r` (rarities), `s` (set codes), comma-separated within a parameter.
3. Loading a deep link plays the intro (6.8.2) into the target rather than into the multiverse home position. Colour, rarity, and type filters are applied before the first frame; a set filter applies with a fade as soon as `sets.bin` arrives (6.6.5).
4. The share control copies the current route with filters to the clipboard and confirms with a transient toast. No server-side link shortening.
5. The site is static; the host must serve `index.html` for all routes.

### 6.8 First load, intro, and hint

1. Loading: the sky and background starfield render immediately; stars fade in per plane as position data arrives (section 8 defines the streaming order). There is never a spinner over a black screen.
2. Intro: once per session, when all plane positions are present, the camera flies in from far outside the multiverse to the target (home position or deep-link target) over 4 s, eased. For a card target the intro ends framing the card's plane and the second stage of 6.2.3 follows once `search.json` has resolved the card. Any input cancels it. Subsequent navigations in the same session skip the intro.
3. First-visit hint: after the intro, a single dismissible overlay names the three controls (drag to orbit, scroll to zoom, click to fly; Esc to go back). Dismissal is remembered locally. The help control reopens it.

### 6.9 Random

1. The random control flies to a random card: choose a plane (Blind Eternities included, zero-card planes excluded) with probability proportional to the square root of its card count, then a uniform card within it. Uses the two-stage fly-to.
2. Random ignores active filters.

### 6.10 Settings

1. Reduced motion (default: follows the OS preference), bloom intensity (three steps), labels on/off, hint reset.
2. Persisted locally; no accounts, no server.

### 6.11 Keyboard

`/` search · Esc up one level or close overlay · Enter select · arrows navigate search results · `?` help. No other shortcuts in v1.

## 7. Non-functional requirements

### 7.1 Reference environment

1. Target: an Apple Silicon MacBook, 1920×1080 viewport, Safari and Chrome current versions, on a home broadband connection. All budgets below are measured there.
2. Supported: current Chrome, Safari, and Firefox on macOS, Windows, and Linux, viewport ≥ 1280×720, WebGL2 required. Without WebGL2 the page shows a plain explanation, not a broken canvas.
3. Scales up to 4K displays; the pixel ratio cap (8.5.11) bounds cost.
4. An HTTP cache that can hold a parked world's art working set: dominaria's parked pose
   occupies 302.3 MiB on disk (DEC-848). Chrome's default quota on the target machine clears
   this; below it the page re-fetches evicted keys instead of converging.

### 7.2 Performance budgets

| Measure | Target | Ceiling |
|---|---|---|
| Transferred before the first rendered frame (shell, `manifest.json`, `planes.json`) | ≤ 500 KB | 1 MB |
| Transferred before the intro starts (adds `stars.bin`) | ≤ 3 MB | 6 MB |
| Time to first rendered frame | ≤ 1.0 s | 2.0 s |
| Time to intro start | ≤ 3.0 s | 5.0 s |
| Steady-state frame rate at every level | 60 fps | 50 fps |
| Frame time during fly-to and cross-fades (p95) | ≤ 16.7 ms | 33 ms |
| CPU time per frame in the render loop | ≤ 2 ms | 4 ms |
| GPU memory for thumbnails (atlas without mipmaps), planets, and card images | ≤ 96 MB | 160 MB |
| Concurrent image requests to Scryfall | 6 | 8 |
| `search.json` plus `sets.bin`, loaded after the first frame | ≤ 700 KB | 1.5 MB |
| Art transferred by a page held at one world, to convergence, where the HTTP cache holds the working set (7.1) | ≤ 320 MB | 500 MB |
| Sustained art transfer after convergence | 0 | 0 |
| Art stream on an idle page (no input for 45 s, 5.3.22) | quiesces | quiesces |

The last three rows are measured parked at one world for 660 s (DEC-838, DEC-848). The convergence row's precondition carries weight: where the HTTP cache cannot hold the working set there is no convergence to bound, only a rate — a page parked at one world on such a device transfers at up to the decode rate, ~1,490 KiB/s (~5.1 GiB/hour), flat and indefinitely. The row does not score that case, so this sentence records it.

`ArtStreamReport.bytesFetched` is decode volume (`Blob.size`), not transfer. Do not read it as bandwidth. The stream re-asks for evicted keys as the world spins; where the cache holds the working set those are served from the HTTP cache and cost no transfer, because image URIs are stable per printing.

The convergence row's measurement is 287.0 MiB (301.0 MB) for dominaria's parked pose — 3,489 of its 6,271 cards. No measurement varied the world or the pose, and both move the working set.

The ceilings are what the owner has agreed to concede for a gorgeous initial view; the targets are what to aim for. Budgets are checked in CI where automatable (section 9).

### 7.3 Smoothness rules

1. All motion is delta-time based (5.3.17).
2. No allocations in the per-frame path: typed arrays and vectors are preallocated and reused.
3. The overlay updates only via `transform`; no layout-triggering style changes per frame.
4. No level-of-detail transition may pop; every change of representation is a cross-fade or a scale, and it must be timed by camera distance, not by asset arrival.
5. Image arrival never causes a visible jump; images fade in over 200 ms.
6. Fly-to hand-over on input is continuous in position and velocity.

### 7.4 Reliability

1. Any failed data chunk retries with exponential backoff (three attempts) and reports once via a non-blocking toast.
2. A failed image leaves the star glow or the previous image in place; nothing renders as a broken rectangle.
3. If Scryfall's image CDN is unreachable, navigation, search, filters, and panels still work.
4. Data artefacts are immutable; a deployed version never changes its data under the user.

### 7.5 Accessibility

1. Reduced motion per 5.9, honouring the OS preference by default.
2. Search, panels, and the control cluster are fully keyboard-operable with visible focus states.
3. Colour identity and rarity are shown as text in panels, so the encoding never carries meaning alone.
4. Label and HUD text meets 4.5:1 contrast against the sky.

### 7.6 Security

1. The only network origins are the site itself and Scryfall's image CDN; expressed as a Content Security Policy. Fonts are self-hosted; no third-party font or script CDN.
2. External links open with `rel="noopener noreferrer"`.
3. No user-supplied content is rendered as HTML; search input touches only the client-side index.

### 7.7 Maintainability

1. Appendix A, Appendix B, and `overrides.json` are the only curated inputs; everything else is derived.
2. The pipeline fails loudly on unknown Scryfall enum values (`set_type`, `layout`, `rarity`, `security_stamp`) rather than guessing.
3. Dependencies are pinned; three.js and react-three-fiber upgrades are deliberate, not automatic.

## 8. Architecture

### 8.1 Repository and tooling

1. Single private repository: `https://github.com/DioPires/eternities-mtg-app`, containing `pipeline/` and `web/`.
2. `pipeline/`: Python 3.13 managed with uv; Ruff, basedpyright, pre-commit. Exposes one CLI, `eternities build`, that runs every stage and writes artefacts plus a report.
3. `web/`: Vite, React, TypeScript in strict mode, react-three-fiber, drei, `@react-three/postprocessing`, Zustand. pnpm with a committed lockfile.
4. Pipeline outputs are committed to the repository under `web/public/data/<content-hash>/`, so a clone deploys without running the pipeline. If the repository grows beyond comfort, move `web/public/data/**` to Git LFS; nothing else changes.

### 8.2 Pipeline

Stages are pure functions over in-memory tables, each unit-tested in isolation:

1. **fetch** — download the Scryfall `default_cards` bulk file and `/sets`; cache locally by Scryfall's bulk `updated_at`.
2. **filter printings** — apply 4.3.
3. **exclude cards** — apply 4.4.
4. **first printing** — apply 4.5.
5. **assign plane** — apply 4.6; fail on unmapped sets.
6. **layout** — compute plane placement (8.6.1), per-card plane-local positions (8.6.2), and Blind Eternities scatter (8.6.3).
7. **emit** — write artefacts (8.3) and the report (4.9.2).

Determinism: every random choice is seeded by hashing a stable key (`oracle_id`, set code, plane slug) with a fixed salt; no global RNG, no iteration over unordered collections. The pipeline is a pure function of the bulk file, the appendices, `overrides.json`, and the run date (`--as-of`, default today), which 4.3.8 uses to keep unreleased sets out.

### 8.3 Data artefacts

All artefacts live in one content-hashed directory; `index.html` references the current hash at build time. Old directories can be deleted freely.

| File | Purpose | Loaded |
|---|---|---|
| `manifest.json` | Pipeline version, Scryfall bulk timestamp, counts, file list | First |
| `planes.json` | Roster with display names, layout parameters, card counts, set lists (name, code, year, count) | First |
| `stars.bin` | One fixed-size record per card, ordered by plane, then band, then arm | Streamed |
| `search.json` | Card, plane, and set names with ids; star index ↔ `oracle_id` table | After first frame |
| `sets.bin` | Per-star list of included-printing set ids (uint16), so the set facet works at every level | With `search.json` |
| `planes/<slug>.json` | Card details for one plane: oracle text per face, mana cost, type line, colour identity, rarity, printings with image URIs and Scryfall URI | On plane focus |
| `planes/blind-eternities.<n>.json` | The Blind Eternities sharded at 2,000 cards per file, cut in star-record order so a card's shard is `floor(local index / 2000)` and needs no lookup table | On focus, shard by shard |

**Star record (12 bytes):** plane-local `x, y, z` as float16, bounded by the plane's frame radius of 1.2 (8.6.2); plane index uint8; hue class uint8 (W, U, B, R, G, multicolour, colourless); size class uint8 (four rarities); brightness uint8 (quantised log printing count, capped per 5.4.10); twinkle phase uint8; card-type bitmask uint8 (creature, instant, sorcery, artifact, enchantment, planeswalker, land, battle — the eight filterable types of 6.6.2). 30k stars ≈ 360 KB before compression. Colour, rarity, and type filters therefore evaluate against the star record alone, at any level, from the first frame.

The Blind Eternities is one row of the plane table like any other, with the identity transform, radius `R`, and zero spin, so its stars' local coordinates are multiverse coordinates scaled by `1/R` and the shader path is the same for every star.

`stars.bin` is consumed with a streaming fetch; the star geometry's draw range grows as records arrive, and because records are ordered by plane, whole planes fade in one after another (6.8.1).

### 8.4 Frontend structure

1. **Router:** the URL is the source of truth for focus and filters (6.7). A small router parses the route into a focus target and filter set; navigation is `history.pushState` plus a fly-to.
2. **State:** Zustand store for transient view state — hover id, active printing, panel open, attract mode, adaptive quality tier, settings. Focus and filters are derived from the URL, never stored twice.
3. **Scene:** one R3F canvas; a scene graph of: background layers, stars (one object), Blind Eternities dust (part of the same star object, flagged by plane index), thumbnail layer, focused card object with its planets, and the camera rig.
4. **Overlay:** one HTML layer for HUD, panels, search, labels, and hints. Labels are positioned each frame by CPU-side projection of plane centres (~80 points), never by per-star work.
5. **Camera rig:** a tethered orbit controller around the current focus with per-level distance limits, and a fly-to tween that owns the camera during transitions and yields on any input.

### 8.5 Rendering

**Stars**
1. All stars are one `Points` object with a custom `ShaderMaterial`. Per-vertex attributes come straight from the star record, plus a uint8 `filterMask` attribute.
2. Per-plane parameters live in a float `DataTexture` (one row per plane): world position, home position, radius, tilt quaternion, drift phase and amplitude, current accumulated spin angle, shear amplitude, period, and phase (5.4.13), and palette. A data texture avoids uniform-array limits and updates in one call per frame.
3. **Motion is computed in the vertex shader.** For each star: rotate about the plane's axis by the plane's accumulated angle plus the bounded shear offset of 5.4.13 (a function of time and the star's radius), apply the tilt, add the drift offset, translate to the plane's position, then apply the multiverse rotation. The CPU updates only the per-plane accumulated angles (so a focused plane can ease to a stop without a discontinuity) and the global angle; ~80 floats per frame.
4. Twinkle is in-shader from phase and time. Filter dimming multiplies brightness by the mask and drops the fragment below the bloom threshold.
5. Bloom: selective by luminance threshold, half-resolution mipmap blur. Labels and UI are outside the canvas and never bloom.

**Picking**
6. GPU id-buffer picking for stars, thumbnails, and planets: a second pass renders ids as colour into a small scissored render target around the pointer; one pixel read per pointer move, throttled to the frame. This is exact and agrees with shader-side positions, which a CPU raycaster would not. Planes at multiverse level are picked on the CPU by raycasting against invisible bounding spheres (~80 objects), with the id buffer taking precedence when it hits.
7. For the camera tether and the fly-to target, the CPU mirrors the shader's motion function for the single focused star. This is the only star position ever computed on the CPU.

**Card sheet, card, planets**
8. Thumbnails: one `InstancedMesh` of quads with a fixed capacity (default 512) backed by a texture atlas (default 4096², 128 × 178 cells, base level only — no mipmap chain, since a full chain would add a third to the atlas's 64 MB and put the 7.2 target out of reach). An LRU loader fetches Scryfall `small` images nearest-first, decodes with `createImageBitmap`, and evicts least-recently-visible. Instances cross-fade with the star per 5.5.
   *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* The 128×178 thumbnail atlas is replaced by the 128×96 art array (worlds spec §1.6, §1.12), sized by the quality ladder.
9. Focused card: a rounded-box mesh with `large` front, Scryfall back, dark edge; pointer-driven tilt via a damped spring.
10. Planets: individual small sphere meshes (≤ 72), each with an `art_crop` texture downscaled on decode to 256 px on the long side (`createImageBitmap` with `resizeWidth`), roughly 190 KB each and under 14 MB for a 72-planet card. Native-size art crops (about 1 MB each) would exceed the 7.2 GPU budget on their own. Orbit per 5.6.7.
    *Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* The 256 px planet textures are replaced by the same art array (worlds spec §1.6, §1.12); printings draw as flat quads (§1.10).

**Adaptive quality**
11. A frame-time monitor steps quality down after sustained drops, in this order: pixel ratio cap 1.5 → 1.0, bloom resolution, thumbnail capacity. Geometry and motion are never degraded. Quality steps back up after sustained headroom.

### 8.6 Layout algorithms

**8.6.1 Plane placement (multiverse)**

*Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* The seeded spiral parameters this section and 8.6.2 define are retired (worlds spec §2.4). Plane homes are still placed by the pipeline, now as a function of each world's §1.3 radius.
- Domain: a disc of radius `R` and thickness `0.15 R`.
- Sort planes by visual radius descending. Place each with seeded rejection sampling subject to: distance to every placed plane ≥ `r_i + r_j + margin`; zero-card planes prefer the outer half of the disc.
- The home camera frames the whole disc at ~30° elevation.

**8.6.2 Card placement (plane-local frame; bands fill the unit disc, the halo extends to 1.2)**

*Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* Retired with the disc. A card's position is a cell centre on the unit sphere under the surface law (worlds spec §1.3, §2.1); `stars.bin` keeps its 12-byte record and changes what bytes 0–5 mean.
- Band: index of the card's first-printing set in the plane's chronological set list; `r = (band + 0.5 + j_r) / bands`, `j_r` hashed jitter within ±0.35 of a band.
- Arm: hue class W, U, B, R, G → arms 0–4. Angle follows a log spiral, `θ = 2π·arm/5 + pitch · ln(r / r₀) + j_θ`, with `j_θ` hashed jitter whose spread is the arm's angular width. Width scales with `sqrt(count_arm / mean_count)`, clamped, so dense colours make wider, brighter arms.
- Multicolour: bulge, `r` scaled by 0.3, uniform angle. Colourless: halo, `r` scaled to 1.05–1.2, uniform angle.
- `z`: hashed Gaussian × thickness (default 0.05, ×3 inside the bulge).
- Planes under 50 cards: uniform angle everywhere, bands as above.
- Seeded per plane: pitch, tilt quaternion, thickness, bar flag (a bar stretches the bulge along one axis).

**8.6.3 Blind Eternities scatter**
- Poisson scatter in the multiverse disc volume with exclusion spheres of 1.3 × radius around every plane.
- Sample weight rises toward the midpoint between each plane and its nearest neighbour, so dust reads as connecting tissue rather than uniform fog.
- Motion: curl noise in the shader over the star's position, small amplitude, per 5.3.16.

### 8.7 Loading order

1. Shell HTML and CSS; the sky and background starfield render on the first frame.
2. `manifest.json` and `planes.json`; plane glows and labels appear.
3. `stars.bin` streamed; planes fill in one by one.
4. Intro fly-to starts when `stars.bin` completes (6.8.2).
5. `search.json` and `sets.bin` in the background after the first frame; the set facet and card deep-link resolution wait for them.
6. `planes/<slug>.json` requested the moment a plane becomes focus, so it normally arrives during the ≥ 1.2 s fly-to, before the card sheet tier can trigger; thumbnails and card images on demand after that.

### 8.8 Deployment

1. Vercel with the GitHub integration: production from `main`, preview deployments for every pull request.
2. `vercel.json`: rewrite all non-asset routes to `/index.html`; `Cache-Control: public, max-age=31536000, immutable` for `/data/**` and Vite's hashed assets.
3. Data refresh flow: run `eternities build` locally; commit the new `web/public/data/<hash>/` and `pipeline/reports/<date>.md` in a pull request titled with the Scryfall bulk timestamp; review the report diff; merge.

### 8.9 Testing

1. Pipeline: unit tests per stage with fixture cards covering every inclusion and exclusion rule; invariant tests (every card exactly one plane, no plane overlaps including drift, plane-local positions within the frame radius of 1.2, first-printing ties resolved deterministically); a report snapshot test.
2. Web: type-check in CI; a Playwright smoke test that loads each route kind (`/`, a plane, the Blind Eternities, a card, a filtered route) and asserts the canvas renders and the HUD shows the expected breadcrumb.
3. Visual regression is out of scope for v1.

### 8.10 Privacy

No analytics, no error tracking, no cookies, no accounts. Settings and the hint flag live in local storage only. The only third party the browser contacts is Scryfall's image CDN.

## 9. Quality and evaluation

"Smooth" is measurable; "beautiful" is judged. This section separates the two so Claude Code can automate the first and present the second for review.

### 9.1 Automated checks (CI)

1. **Payload budget:** built shell size and the data directory's first-load files are compared against 7.2 targets; exceeding a ceiling fails the build.
2. **Benchmark route:** a hidden `/bench` route plays a fixed scripted camera path — one multiverse orbit, fly-to a large plane, fly-to a small plane, card-sheet approach, card focus with planets, Esc back to multiverse — and logs p50 and p95 frame time, CPU time per frame, and peak GPU memory to the console in JSON. In cloud CI, Playwright runs it as a smoke test only (it completes and emits valid JSON), because a headless runner has no representative GPU. The 7.2 ceilings are enforced by a local `pnpm bench` on the reference machine, required before merging any change that touches rendering; the targets are reported, not enforced.
3. **Frame-rate independence:** the motion function is run at simulated 30, 60, and 120 fps for a fixed elapsed time and must yield identical positions within float tolerance.
4. **Pipeline invariants:** section 8.9.1, run on every pipeline change.
5. **Plane fixtures:** a table of at least 25 well-known cards with their expected plane (for example, cards first printed in Alpha → Dominaria; the Ravnica guild leaders → Ravnica; a Modern Horizons original → Blind Eternities; Sol Ring → Dominaria despite its Warhammer 40,000 reprint; The One Ring → excluded despite its reprint in The List; one Universes Within card → Blind Eternities, whatever its Secret Lair original carries) is asserted on every pipeline run. Adding a row is the standard way to lock in an override.
6. **Route smoke:** section 8.9.2.

### 9.2 Data quality gates (reviewed per pipeline run)

1. Unmapped sets: zero, enforced (4.6.4).
2. Blind Eternities share of included cards: reported every run. The target is the recorded baseline minus what curating the three highest-contributing sets (11.9) recovers. The report always lists the top contributing sets so curation effort goes where it pays.

   **Baseline: 17.42%** — 4,980 of 28,587 cards, measured on the 2026-09-04 dataset and accepted by the board as the working baseline. It sits **below** the 20–25% this document expected, which is a better starting point than predicted rather than a defect: the expectation was reasoned from core sets, Modern Horizons, Commander products, Jumpstart and the D&D sets all landing in the dust, and they do. The gap is not explained here; if a later run moves the number materially, the explanation is owed then. The top three contributors at the baseline are Commander Legends: Battle for Baldur's Gate (345), March of the Machine (272) and Adventures in the Forgotten Realms (257) — 874 cards, 17.6% of the dust, which is what 11.9's curation target is measured against.

   **Measured since: 14.70%** (4,204 of 28,603 cards, 2026-09-14, DEC-745). All three of the named contributors have now been curated away — `mom` by the DEC-710 overrides, `clb` and `afr` by the Forgotten Realms set-level mapping — so the 874-card target above is spent and the sentence describes history, not a live goal. **17.42% remains the board-accepted baseline** until the board moves it; re-baselining is a board decision, not a pipeline one. The new top contributors are Aetherdrift (256), Modern Horizons 3 (256) and Modern Horizons 2 (255), none of which names one plane.
3. Cards whose plane changed since the last run: listed, each expected to trace to an appendix or override edit.
4. Planes with zero cards: listed, so roster errors (a plane that should have cards) stand out.

### 9.3 Visual review (manual, per milestone-sized change)

*Amended at the worlds cutover (2026-09-18, DEC-752; worlds spec §6).* The checkpoints and criteria below were written for the galaxy — criterion 2 is about spiral arms. The worlds build is held to the checkpoints and criteria of worlds spec §3.1 instead, and `web/scripts/worlds-gate.mjs` asserts them (W1–W5 plus the negative-control matrix). The galaxy-era `visual-gate.mjs` is archived under the `galaxy-cutover` tag.

Claude Code captures a fixed set of checkpoint screenshots and a short screen recording from the `/bench` path and presents them for the owner's review. Checkpoints:

1. Home view after the intro.
2. Plane level for three planes: the largest, a mid-sized one, and one under 50 cards.
3. Card-sheet tier with thumbnails loaded.
4. Card focus with planets, one double-faced card flipped.
5. A filter applied at plane level.
6. The Blind Eternities at plane level.
7. Attract mode mid-drift.

Criteria the owner judges against, phrased so failures are nameable:

- Motion is perceptible within 3 s of arriving at any level.
- Spiral arms are legible for every plane with ≥ 2,000 cards (threshold amended from 200 by board decision on DEC-683: the year-band mapping leaves smaller planes too few stars for arms to read at presentation scale, and arm-width tuning cannot add stars).
- Bloom never washes out a label or the focused card.
- No label overlaps another at the home view.
- No aliasing shimmer on stars during slow camera moves.
- Thumbnail cross-fades and image fade-ins are never noticed as events.
- The focused card's tilt feels physical: no overshoot, no lag.

### 9.4 Definition of done

A feature is done when its requirements in sections 4–8 are implemented, the automated checks in 9.1 pass, the pipeline report (9.2) has been reviewed if data changed, and the visual review (9.3) has been accepted by the owner where the change is visible.

## 10. Risks and dependencies

| # | Risk or dependency | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Scryfall image policy or rate limits** change, or hotlinking becomes restricted. | Low | High: card-sheet and card level lose images. | Verify the current image and API policy before first release; concurrency cap (7.2); graceful degradation (7.4); Scryfall credited (4.11). |
| 2 | **Scryfall field semantics drift** (`set_type`, `layout`, `security_stamp` values added or renamed). | Medium | Medium: silent misclassification. | Pipeline fails on unknown enum values (7.7.2); 4.3.5 explicitly flagged for verification. |
| 3 | **Plane assignment errors** in Appendix B or a lore-ambiguous set. | High (some) | Low per card, medium in aggregate. | Overrides file; plane fixtures (9.1.5); report review (9.2); Blind Eternities target keeps it visible. |
| 4 | **Roster drift:** new planes appear, or a plane is renamed or merged in lore. | Medium | Low | Appendix A is a one-row edit; slugs never change once published (deep links). |
| 5 | **Wizards Fan Content Policy** compliance. | Low | High: takedown. | Free and non-commercial; policy notice shown; withdrawn cards excluded (4.4.2); no Wizards logos or set symbols used as assets. |
| 6 | **GPU and browser variance:** float16 attributes, data-texture precision, Safari WebGL2 quirks, Intel integrated GPUs. | Medium | Medium: stutter or artefacts on some machines. | Adaptive quality (8.5.11); float32 fallback path for positions; reference-machine budgets are targets, ceilings are the promise. |
| 7 | **Bloom versus legibility:** photoreal glow fights label and card readability. | Medium | Medium | Selective bloom threshold; UI outside the canvas; visual review criteria (9.3). |
| 8 | **Repository growth** from committed artefacts on every refresh. | Medium | Low | Content-hashed directories, old ones deleted; move to Git LFS when needed (8.1.4). |
| 9 | **Deep link stability:** Scryfall occasionally merges or reissues an `oracle_id`. | Low | Low | Accepted; a dead card link falls back to the multiverse with a toast. |
| 10 | **"Beautiful" is unbounded** and invites endless polish. | High | Medium: schedule. | 9.3 defines what is judged; anything outside that list is a v2 conversation. |
| 11 | **three.js and react-three-fiber major releases** change APIs under the project. | Medium | Low | Pinned versions; deliberate upgrades (7.7.3). |
| 12 | **Sets released after this document** are missing from Appendix B. | Certain | Low | Pipeline fails on unmapped sets; the report names them; one-row fix. |
| 13 | **Cross-contamination between in-universe and Universes Beyond printings:** UB cards reprinted in mixed products, in-universe staples reprinted in UB decks, UB skins on in-universe cards. | High | Medium: wrong inclusions either way. | Earliest-printing test (4.4.3), `flavor_name` rule (4.3.7), fixtures for both directions (9.1.5). |

## 11. Open questions

Decisions deliberately left open, each with its default so work is never blocked.

1. **Roster completeness.** ~~Kandoka, Foldaria, Clamhattan, and Horsehead Nebula appear in the MTG wiki's planar-type category but were not canon-checked for this document.~~ **Resolved 2026-09-04:** the first run's roster diff found all four in the category and the board added them to Appendix A as zero-card planes. The diff runs every build, so roster drift (risk 4) stays visible.
2. **Portal (`por`).** Setting is unclear; may belong on Dominaria. Default: Blind Eternities.
3. **Reality Fracture.** On release, decide between Blind Eternities and an `echoverse` roster entry for the Echoverse. Default: Blind Eternities, revisited when the row is added.
4. **`security_stamp: triangle`.** Confirm against Scryfall documentation that the triangle stamp reliably marks Universes Beyond printings before relying on 4.3.5.
5. **Scryfall image terms.** Confirm hotlinking, rate limits, and the required attribution wording before first release (risk 1).
6. **Blind Eternities target.** **Baseline resolved 2026-09-04 at 17.42%** (9.2.2), below the expected 20–25%. The target derived from it — baseline minus what curating the top three sets recovers — is still open and belongs with the 11.9 curation work.
7. **Performance ceilings.** The 7.2 ceilings are commitments; the targets are aspirations. Confirm both after the first `/bench` run on the reference machine.
8. **Set search behaviour.** Selecting a set from search flies to its plane and adds a set filter chip (6.5.4). Alternative: fly only. Default: fly and filter.
9. **Override priority.** Which Blind Eternities sets to curate first with per-card overrides. Default order: March of the Machine, Aetherdrift, Magic Origins, core sets, Modern Horizons.
10. **2026 set codes marked "verify" in Appendix B.** **Resolved 2026-09-04:** fifteen codes confirmed against Scryfall, one corrected (`tlc` → `tle`, and it is an Eternal set, not a Commander one). Sixteen sets the appendix omitted were added under 4.10.2 and ratified; see B.2.
11. **Visual tunables.** Rarity size ratio, brightness percentile cap, twinkle amplitude, shear amplitude and period, bloom threshold, spin periods. All have defaults in section 5; the visual review (9.3) decides where they land.
12. **Universes Within identity.** **Resolved 2026-09-04: they do share.** All 30 `slx` `oracle_id`s also appear on a Secret Lair or Universes Beyond printing, so 4.4.5's exemption is load-bearing — without it those cards would be excluded as Universes Beyond by origin. The 9.1.5 fixture locks the result.

## Appendix A — Plane list

Canonical roster. Slugs are permanent once published (deep links). Display names may change. Sources: the MTG wiki plane category and a February 2026 compiled list of 82 named planes; verified September 2026. Universes Beyond worlds, the *Un*-iverse, and MagicCon convention "planes" are deliberately absent.

The roster diff against the MTG wiki plane category runs on every pipeline build and is reported (implementation plan §2). The first run (2026-09-04) confirmed all four of open question 1's candidates — Kandoka, Foldaria, Clamhattan and Horsehead Nebula — present in the category, and the board ratified them onto the roster on the same day. They carry no cards: no set is mapped to them in Appendix B, so each renders as a small dim glow per 5.3.6, exactly as the other zero-card entries do. Adding them re-hashes the dataset, because plane count drives plane placement (8.6).

The remaining 29 wiki entries the diff reports are Universes Beyond settings, convention "planes" or non-canon, which 2.2 keeps out.

| Slug | Display name | Notes |
|---|---|---|
| `blind-eternities` | Blind Eternities | Catch-all; rendered as dust (5.3.4) |
| `abyss` | The Abyss | Possibly the same as Hell or the Nether Void; kept separate as named |
| `alara` | Alara | Five shards, one plane |
| `alkabah` | Alkabah | |
| `amonkhet` | Amonkhet | |
| `antausia` | Antausia | *Duelist* magazine prototype plane |
| `aranzhur` | Aranzhur | |
| `arcavios` | Arcavios | Strixhaven |
| `arkhos` | Arkhos | Proto-Theros; distinct plane |
| `avishkar` | Avishkar (formerly Kaladesh) | Renamed in lore; slug uses the current name |
| `azgol` | Azgol | |
| `azoria` | Azoria | Shard of the Twelve Worlds |
| `belenon` | Belenon | |
| `bloomburrow` | Bloomburrow | |
| `cabralin` | Cabralin | |
| `capenna` | Capenna | New Capenna |
| `clamhattan` | Clamhattan | Ratified from the wiki roster diff, 2026-09-04 (open question 1); no set maps here yet |
| `cridhe` | Cridhe | |
| `diraden` | Diraden | |
| `dominaria` | Dominaria | |
| `duskmourn` | Duskmourn | |
| `echoir` | Echoir | |
| `edge` | The Edge | Region beyond the Chaos Wall; treated as a roster member so Edge of Eternities has a home |
| `eldraine` | Eldraine | |
| `equilor` | Equilor | |
| `ergamon` | Ergamon | |
| `fabacin` | Fabacin | |
| `fiora` | Fiora | Paliano |
| `foldaria` | Foldaria | Ratified from the wiki roster diff, 2026-09-04 (open question 1); no set maps here yet |
| `forgotten-realms` | Forgotten Realms | Added by owner decision 2026-09-14 (DEC-710 sign-off, interaction 0dec0512). The D&D crossover setting; `afr`, `afc` and `clb` map here (B.1). Not a page in the wiki's `Category:Planes`, so the roster diff lists it under "no wiki page of that name" — expected, not drift |
| `gargantikar` | Gargantikar | |
| `gastal` | Gastal | |
| `gobakhan` | Gobakhan | |
| `hell` | Hell | |
| `horsehead-nebula` | Horsehead Nebula | Ratified from the wiki roster diff, 2026-09-04 (open question 1); no set maps here yet |
| `ikoria` | Ikoria | |
| `ilcae` | Ilcae | |
| `innistrad` | Innistrad | |
| `iquatana` | Iquatana | |
| `ir` | Ir | |
| `ixalan` | Ixalan | |
| `kaldheim` | Kaldheim | |
| `kamigawa` | Kamigawa | |
| `kandoka` | Kandoka | Ratified from the wiki roster diff, 2026-09-04 (open question 1); no set maps here yet |
| `karsus` | Karsus | |
| `kephalai` | Kephalai | |
| `kinshala` | Kinshala | |
| `kodisha` | Kodisha | |
| `kolbahan` | Kolbahan | |
| `kylem` | Kylem | Battlebond |
| `kyneth` | Kyneth | |
| `lorwyn` | Lorwyn–Shadowmoor | One plane, two aspects |
| `luvion` | Luvion | |
| `meditation-realm` | Bolas's Meditation Realm | Also "Meditation Plane" |
| `mercadia` | Mercadia | |
| `metal-island` | Metal Island | Pocket plane off Esper |
| `mirrankkar` | Mirrankkar | |
| `moag` | Moag | |
| `mongseng` | Mongseng | |
| `muraganda` | Muraganda | Cards via overrides from Aetherdrift |
| `nether-void` | Nether Void | |
| `new-phyrexia` | New Phyrexia (formerly Mirrodin) | Argentum → Mirrodin → New Phyrexia; one plane |
| `obsidias` | Obsidias | |
| `phyrexia` | Phyrexia | The original nine-sphere artificial plane; distinct from New Phyrexia |
| `shenmeng` | Shenmeng | Formerly "the Plane of Mountains and Seas" |
| `pyrulea` | Pyrulea | |
| `rabiah` | Rabiah | |
| `rath` | Rath | Later overlaid onto Dominaria; kept as its own plane for its sets |
| `ravnica` | Ravnica | |
| `regatha` | Regatha | |
| `segovia` | Segovia | |
| `serras-realm` | Serra's Realm | Artificial, collapsed |
| `parnash` | Seven Planes of Parnash | A named collection; one roster entry |
| `shandalar` | Shandalar | |
| `skalla` | Skalla | Destroyed |
| `tarkir` | Tarkir | |
| `tavelia` | Tavelia | |
| `theros` | Theros | |
| `thunder-junction` | Thunder Junction | |
| `tolvada` | Tolvada | |
| `ulgrotha` | Ulgrotha | Homelands |
| `valla` | Valla | Split from Kaldheim |
| `vatraquaz` | Vatraquaz | |
| `vryn` | Vryn | |
| `wildfire` | Wildfire | |
| `xerex` | Xerex | |
| `zendikar` | Zendikar | |
| `zhalfir` | Zhalfir | Its own plane since March of the Machine; cards via overrides |

## Appendix B — Set→plane seed table

One row per set that is, or could be, some card's first printing (4.6). Reprint-only products are intentionally absent. Codes are Scryfall set codes; those marked **verify** were not confirmed against Scryfall for this document and must be checked on the first pipeline run, which will fail loudly on any mismatch. Dates are release month. Current through the sets announced for 2026 as of September 2026; the next in-universe set after Reality Fracture will need a row.

Row format: code · name · date · plane slug (or `blind-eternities`) · flags.

### B.1 In-universe sets mapped to a plane

**Dominaria**
- `lea` Limited Edition Alpha · 1993-08 · `dominaria`
- `leb` Limited Edition Beta · 1993-10 · `dominaria`
- `2ed` Unlimited Edition · 1993-12 · `dominaria`
- `atq` Antiquities · 1994-03 · `dominaria`
- `leg` Legends · 1994-06 · `dominaria`
- `drk` The Dark · 1994-08 · `dominaria`
- `fem` Fallen Empires · 1994-11 · `dominaria`
- `ice` Ice Age · 1995-06 · `dominaria`
- `all` Alliances · 1996-06 · `dominaria`
- `mir` Mirage · 1996-10 · `dominaria`
- `vis` Visions · 1997-02 · `dominaria`
- `wth` Weatherlight · 1997-06 · `dominaria`
- `p02` Portal Second Age · 1998-06 · `dominaria`
- `usg` Urza's Saga · 1998-10 · `dominaria` (Phyrexia and Serra's Realm cards via overrides)
- `ulg` Urza's Legacy · 1999-02 · `dominaria`
- `uds` Urza's Destiny · 1999-06 · `dominaria`
- `pcy` Prophecy · 2000-06 · `dominaria`
- `inv` Invasion · 2000-10 · `dominaria`
- `pls` Planeshift · 2001-02 · `dominaria`
- `apc` Apocalypse · 2001-06 · `dominaria`
- `ody` Odyssey · 2001-10 · `dominaria`
- `tor` Torment · 2002-02 · `dominaria`
- `jud` Judgment · 2002-05 · `dominaria`
- `ons` Onslaught · 2002-10 · `dominaria`
- `lgn` Legions · 2003-02 · `dominaria`
- `scg` Scourge · 2003-05 · `dominaria`
- `csp` Coldsnap · 2006-07 · `dominaria`
- `tsp` Time Spiral · 2006-10 · `dominaria`
- `plc` Planar Chaos · 2007-02 · `dominaria`
- `fut` Future Sight · 2007-05 · `dominaria`
- `dom` Dominaria · 2018-04 · `dominaria`
- `dmu` Dominaria United · 2022-09 · `dominaria`
- `dmc` Dominaria United Commander · 2022-09 · `dominaria`
- `bro` The Brothers' War · 2022-11 · `dominaria`
- `brc` The Brothers' War Commander · 2022-11 · `dominaria`

**Rabiah**
- `arn` Arabian Nights · 1993-12 · `rabiah`

**Ulgrotha**
- `hml` Homelands · 1995-10 · `ulgrotha`

**Rath**
- `tmp` Tempest · 1997-10 · `rath`
- `sth` Stronghold · 1998-03 · `rath`
- `exo` Exodus · 1998-06 · `rath`
- `nem` Nemesis · 2000-02 · `rath`

**Mercadia**
- `mmq` Mercadian Masques · 1999-10 · `mercadia`

**New Phyrexia (Mirrodin)**
- `mrd` Mirrodin · 2003-10 · `new-phyrexia`
- `dst` Darksteel · 2004-02 · `new-phyrexia`
- `5dn` Fifth Dawn · 2004-06 · `new-phyrexia`
- `som` Scars of Mirrodin · 2010-10 · `new-phyrexia`
- `mbs` Mirrodin Besieged · 2011-02 · `new-phyrexia`
- `nph` New Phyrexia · 2011-05 · `new-phyrexia`
- `one` Phyrexia: All Will Be One · 2023-02 · `new-phyrexia`
- `onc` Phyrexia: All Will Be One Commander · 2023-02 · `new-phyrexia`

**Kamigawa**
- `chk` Champions of Kamigawa · 2004-10 · `kamigawa`
- `bok` Betrayers of Kamigawa · 2005-02 · `kamigawa`
- `sok` Saviors of Kamigawa · 2005-06 · `kamigawa`
- `neo` Kamigawa: Neon Dynasty · 2022-02 · `kamigawa`
- `nec` Neon Dynasty Commander · 2022-02 · `kamigawa`

**Ravnica**
- `rav` Ravnica: City of Guilds · 2005-10 · `ravnica`
- `gpt` Guildpact · 2006-02 · `ravnica`
- `dis` Dissension · 2006-05 · `ravnica`
- `rtr` Return to Ravnica · 2012-10 · `ravnica`
- `gtc` Gatecrash · 2013-02 · `ravnica`
- `dgm` Dragon's Maze · 2013-05 · `ravnica`
- `grn` Guilds of Ravnica · 2018-10 · `ravnica`
- `rna` Ravnica Allegiance · 2019-01 · `ravnica`
- `war` War of the Spark · 2019-05 · `ravnica`
- `clu` Ravnica: Clue Edition · 2024-02 · `ravnica` · **stampExempt** (owner decision 2026-09-14, DEC-710 sign-off 0dec0512): an in-universe Ravnica product that carries the `triangle` stamp because it is sold through mass-market retail, not because it is Universes Beyond. Without the exemption its 16 cards were dropped by 4.3.5 and, once past it, again by 4.4.3's stamp clause
- `mkm` Murders at Karlov Manor · 2024-02 · `ravnica`
- `mkc` Murders at Karlov Manor Commander · 2024-02 · `ravnica`

**Lorwyn–Shadowmoor**
- `lrw` Lorwyn · 2007-10 · `lorwyn`
- `mor` Morningtide · 2008-02 · `lorwyn`
- `shm` Shadowmoor · 2008-05 · `lorwyn`
- `eve` Eventide · 2008-07 · `lorwyn`
- `ecl` Lorwyn Eclipsed · 2026-01 · `lorwyn`
- `ecc` Lorwyn Eclipsed Commander · 2026-01 · `lorwyn` · **verify**

**Alara**
- `ala` Shards of Alara · 2008-10 · `alara`
- `con` Conflux · 2009-02 · `alara`
- `arb` Alara Reborn · 2009-04 · `alara`

**Zendikar**
- `zen` Zendikar · 2009-10 · `zendikar`
- `wwk` Worldwake · 2010-02 · `zendikar`
- `roe` Rise of the Eldrazi · 2010-04 · `zendikar`
- `bfz` Battle for Zendikar · 2015-10 · `zendikar`
- `ogw` Oath of the Gatewatch · 2016-01 · `zendikar`
- `znr` Zendikar Rising · 2020-09 · `zendikar`
- `znc` Zendikar Rising Commander · 2020-09 · `zendikar`

**Innistrad**
- `isd` Innistrad · 2011-09 · `innistrad`
- `dka` Dark Ascension · 2012-02 · `innistrad`
- `avr` Avacyn Restored · 2012-05 · `innistrad`
- `soi` Shadows over Innistrad · 2016-04 · `innistrad`
- `emn` Eldritch Moon · 2016-07 · `innistrad`
- `mid` Innistrad: Midnight Hunt · 2021-09 · `innistrad`
- `mic` Midnight Hunt Commander · 2021-09 · `innistrad`
- `vow` Innistrad: Crimson Vow · 2021-11 · `innistrad`
- `voc` Crimson Vow Commander · 2021-11 · `innistrad`

**Theros**
- `ths` Theros · 2013-09 · `theros`
- `bng` Born of the Gods · 2014-02 · `theros`
- `jou` Journey into Nyx · 2014-05 · `theros`
- `thb` Theros Beyond Death · 2020-01 · `theros`

**Fiora**
- `cns` Conspiracy · 2014-06 · `fiora`
- `cn2` Conspiracy: Take the Crown · 2016-08 · `fiora`

**Tarkir**
- `ktk` Khans of Tarkir · 2014-09 · `tarkir`
- `frf` Fate Reforged · 2015-01 · `tarkir`
- `dtk` Dragons of Tarkir · 2015-03 · `tarkir`
- `tdm` Tarkir: Dragonstorm · 2025-04 · `tarkir`
- `tdc` Tarkir: Dragonstorm Commander · 2025-04 · `tarkir`

**Avishkar (Kaladesh)**
- `kld` Kaladesh · 2016-09 · `avishkar`
- `aer` Aether Revolt · 2017-01 · `avishkar`

**Amonkhet**
- `akh` Amonkhet · 2017-04 · `amonkhet`
- `hou` Hour of Devastation · 2017-07 · `amonkhet`

**Ixalan**
- `xln` Ixalan · 2017-09 · `ixalan`
- `rix` Rivals of Ixalan · 2018-01 · `ixalan`
- `lci` The Lost Caverns of Ixalan · 2023-11 · `ixalan`
- `lcc` The Lost Caverns of Ixalan Commander · 2023-11 · `ixalan`

**Kylem**
- `bbd` Battlebond · 2018-06 · `kylem`

**Shenmeng**
- `gs1` Global Series: Jiang Yanggu & Mu Yanling · 2018-06 · `shenmeng`

**Eldraine**
- `eld` Throne of Eldraine · 2019-10 · `eldraine`
- `woe` Wilds of Eldraine · 2023-09 · `eldraine`
- `woc` Wilds of Eldraine Commander · 2023-09 · `eldraine`

**Ikoria**
- `iko` Ikoria: Lair of Behemoths · 2020-04 · `ikoria` (Godzilla-series printings drop via 4.3.7)
- `c20` Commander 2020 · 2020-04 · `ikoria`

**Kaldheim**
- `khm` Kaldheim · 2021-02 · `kaldheim`
- `khc` Kaldheim Commander · 2021-02 · `kaldheim`

**Arcavios**
- `stx` Strixhaven: School of Mages · 2021-04 · `arcavios`
- `c21` Commander 2021 · 2021-04 · `arcavios`
- `sos` Secrets of Strixhaven · 2026-04 · `arcavios` · **verify**
- `soc` Secrets of Strixhaven Commander · 2026-04 · `arcavios` · **verify**

**Forgotten Realms** — moved here from B.2 on 2026-09-14 by owner decision (DEC-710 sign-off, interaction 0dec0512). Mapped at set level, not per card: each set is wall-to-wall Forgotten Realms, so the plane is a property of the product. DEC-745 scanned all 664 first printings for cross-setting evidence (oracle text, type lines and flavour text) and found none naming another Magic plane; `Ravenloft Adventurer` (`clb`) is the single card whose own name points at another D&D world and is mapped here anyway, because Ravenloft is not an Appendix A plane and Magic reaches the D&D cosmology as one plane.
- `afr` Adventures in the Forgotten Realms · 2021-07 · `forgotten-realms`
- `afc` Forgotten Realms Commander · 2021-07 · `forgotten-realms`
- `clb` Commander Legends: Battle for Baldur's Gate · 2022-06 · `forgotten-realms`

**Capenna**
- `snc` Streets of New Capenna · 2022-04 · `capenna`
- `ncc` New Capenna Commander · 2022-04 · `capenna`

**Thunder Junction**
- `otj` Outlaws of Thunder Junction · 2024-04 · `thunder-junction`
- `otc` Outlaws of Thunder Junction Commander · 2024-04 · `thunder-junction`
- `big` The Big Score · 2024-04 · `thunder-junction`

**Bloomburrow**
- `blb` Bloomburrow · 2024-08 · `bloomburrow`
- `blc` Bloomburrow Commander · 2024-08 · `bloomburrow`

**Duskmourn**
- `dsk` Duskmourn: House of Horror · 2024-09 · `duskmourn`
- `dsc` Duskmourn Commander · 2024-09 · `duskmourn`

**The Edge**
- `eoe` Edge of Eternities · 2025-08 · `edge`
- `eoc` Edge of Eternities Commander · 2025-08 · `edge`

### B.2 In-universe sets mapped to the Blind Eternities

Multi-plane by design, or products with no single setting. Overrides move individual cards out.

- `por` Portal · 1997-05 · `blind-eternities` (setting unclear; may belong on Dominaria)
- `ptk` Portal Three Kingdoms · 1999-05 · `blind-eternities` (alternate-history Earth, retconned as not a plane)
- `s99` Starter 1999 · 1999-07 · `blind-eternities`
- `m10` Magic 2010 · 2009-07 · `blind-eternities`
- `hop` Planechase · 2009-09 · `blind-eternities`
- `arc` Archenemy · 2010-06 · `blind-eternities`
- `m11` Magic 2011 · 2010-07 · `blind-eternities`
- `cmd` Commander 2011 · 2011-06 · `blind-eternities`
- `m12` Magic 2012 · 2011-07 · `blind-eternities`
- `pc2` Planechase 2012 · 2012-06 · `blind-eternities`
- `m13` Magic 2013 · 2012-07 · `blind-eternities`
- `m14` Magic 2014 · 2013-07 · `blind-eternities`
- `c13` Commander 2013 · 2013-11 · `blind-eternities`
- `m15` Magic 2015 · 2014-07 · `blind-eternities`
- `c14` Commander 2014 · 2014-11 · `blind-eternities`
- `ori` Magic Origins · 2015-07 · `blind-eternities`
- `c15` Commander 2015 · 2015-11 · `blind-eternities`
- `c16` Commander 2016 · 2016-11 · `blind-eternities`
- `e01` Archenemy: Nicol Bolas · 2017-06 · `blind-eternities`
- `c17` Commander 2017 · 2017-08 · `blind-eternities`
- `m19` Core Set 2019 · 2018-07 · `blind-eternities`
- `c18` Commander 2018 · 2018-08 · `blind-eternities`
- `gnt` Game Night · 2018-11 · `blind-eternities`
- `mh1` Modern Horizons · 2019-06 · `blind-eternities`
- `m20` Core Set 2020 · 2019-07 · `blind-eternities`
- `c19` Commander 2019 · 2019-08 · `blind-eternities`
- `gn2` Game Night 2019 · 2019-11 · `blind-eternities`
- `m21` Core Set 2021 · 2020-07 · `blind-eternities`
- `jmp` Jumpstart · 2020-07 · `blind-eternities`
- `cmr` Commander Legends · 2020-11 · `blind-eternities`
- `mh2` Modern Horizons 2 · 2021-06 · `blind-eternities`
- `gn3` Game Night: Free-for-All · 2022-11 · `blind-eternities`
- `j22` Jumpstart 2022 · 2022-12 · `blind-eternities`
- `mom` March of the Machine · 2023-04 · `blind-eternities` (Zhalfir, Muraganda, and other single-plane cards via overrides)
- `moc` March of the Machine Commander · 2023-04 · `blind-eternities`
- `mat` March of the Machine: The Aftermath · 2023-05 · `blind-eternities`
- `mh3` Modern Horizons 3 · 2024-06 · `blind-eternities`
- `m3c` Modern Horizons 3 Commander · 2024-06 · `blind-eternities`
- `fdn` Foundations · 2024-11 · `blind-eternities`
- `j25` Foundations Jumpstart · 2024-11 · `blind-eternities`
- `dft` Aetherdrift · 2025-02 · `blind-eternities` (Avishkar, Amonkhet, and Muraganda cards via overrides)
- `drc` Aetherdrift Commander · 2025-02 · `blind-eternities`

~~Dungeons & Dragons crossovers (Wizards-owned, not branded Universes Beyond, not on a Magic plane):~~ **Moved to B.1 on 2026-09-14** by owner decision (DEC-710 sign-off, interaction 0dec0512): Forgotten Realms joined Appendix A, so "not on a Magic plane" stopped being true and the three sets map there. See B.1 **Forgotten Realms**.

Universes Within (in-universe reworks of Universes Beyond cards, sold as Secret Lair; exempt from B.4):
- `slx` Universes Within · 2022-01 · `blind-eternities` · **verify** code and Scryfall set name

**First-run additions, ratified 2026-09-04.** Sixteen sets that are some card's first printing and that this appendix omitted. The first run failed on each per 4.6.4 — the rule working as designed — and they were added under 4.10.2. Two kinds; the second maps to a real plane rather than the dust, and is listed here for provenance, not because the Blind Eternities claims it.

Reprint-branded products with no single setting, which still carry first printings:
- `8ed` Eighth Edition · 2003-07 · `blind-eternities`
- `ema` Eternal Masters · 2016-06 · `blind-eternities`
- `plst` The List · 2020-09 · `blind-eternities` (a rolling product: its printings carry their own dates, which is what the 4.5.1 amendment turns on)
- `2x2` Double Masters 2022 · 2022-07 · `blind-eternities`
- `cmm` Commander Masters · 2023-08 · `blind-eternities`
- `mb2` Mystery Booster 2 · 2024-08 · `blind-eternities`
- `slz` The Zeta Set · 2026-09 · `blind-eternities`

Single-plane preview products, mapped to the plane they previewed. Each row names the card that establishes the mapping:
- `drb` From the Vault: Dragons · 2008-08 · `alara` (Hellkite Overlord, a Shards of Alara preview)
- `v10` From the Vault: Relics · 2010-08 · `new-phyrexia` (Sword of Body and Mind, a Scars of Mirrodin preview)
- `ddf` Duel Decks: Elspeth vs. Tezzeret · 2010-09 · `new-phyrexia` (Contagion Clasp, Kemba's Skyguard)
- `v11` From the Vault: Legends · 2011-08 · `innistrad` (Mikaeus, the Lunarch)
- `ddj` Duel Decks: Izzet vs. Golgari · 2012-09 · `ravnica` (Return to Ravnica previews, including Jarad — locked by a 9.1.5 fixture)
- `ddl` Duel Decks: Heroes vs. Monsters · 2013-09 · `theros` (Polukranos, Anax and Cymede)
- `ddn` Duel Decks: Speed vs. Cunning · 2014-09 · `tarkir` (Zurgo, Jeskai Elder, Mardu Heart-Piercer)
- `ddp` Duel Decks: Zendikar vs. Eldrazi · 2015-08 · `zendikar` (Oblivion Sower, Retreat to Kazandu)
- `ddq` Duel Decks: Blessed vs. Cursed · 2016-02 · `innistrad` (Mindwrack Demon, Topplegeist)

Not yet listed: Reality Fracture and the Foundations Commander decks (October 2026). Rule 4.3.8 keeps their preview cards out until release; add rows then, and decide whether the Echoverse warrants its own roster entry at that point.

### B.3 Excluded — Universes Beyond

Flag `universes_beyond`. The flag drives both the card-level test (4.4.3: a card originating here is excluded) and the printing-level rule (4.3.1: reprints of in-universe cards inside these products drop while the cards stay).

- `40k` Warhammer 40,000 Commander · 2022-10
- `bot` Transformers · 2022-11
- `ltr` The Lord of the Rings: Tales of Middle-earth · 2023-06
- `ltc` Tales of Middle-earth Commander · 2023-06
- `who` Doctor Who · 2023-10
- `rex` Jurassic World Collection · 2023-11
- `pip` Fallout · 2024-03
- `acr` Assassin's Creed · 2024-07
- `fin` Final Fantasy · 2025-06
- `fic` Final Fantasy Commander · 2025-06
- `fca` Final Fantasy: Through the Ages · 2025-06
- `mar` Marvel Universe · 2025-09
- `spm` Marvel's Spider-Man · 2025-09 · `spe` Marvel's Spider-Man Eternal (this document said "plus its Commander set"; Scryfall's companion set is `spe`, an *Eternal* set)
- `tla` Avatar: The Last Airbender · 2025-11
- `tle` Avatar: The Last Airbender Eternal · 2025-11 — *corrected 2026-09-04*: this document said `tlc` "Avatar: The Last Airbender Commander". Scryfall has no `tlc`; the set is `tle`, and it is an *Eternal* set, not a Commander one.
- `tmt` Teenage Mutant Ninja Turtles · 2026-03 · `tmc` Teenage Mutant Ninja Turtles Eternal
- `msh` Marvel Super Heroes · 2026-06 · `msc` Marvel Super Heroes Commander
- `hob` The Hobbit · 2026-08 · `hoc` The Hobbit Eternal
- `trk` Star Trek · 2026-11 · `trc` Star Trek Commander

The **verify** marks in this appendix are discharged. The first run (2026-09-04) confirmed all fifteen marked codes against Scryfall and corrected the one above — `ecc` (B.1), `slx` (B.2), and `hob`, `hoc`, `mar`, `msc`, `msh`, `soc`, `sos`, `spe`, `spm`, `tmc`, `tmt`, `trc`, `trk` here — which is what open question 10 asked for. The pipeline re-checks them on every run and fails loudly on a mismatch (4.6.4), so the marks are not needed to keep the list honest.

Universes Beyond cards sold through Secret Lair are covered by B.4.

### B.4 Excluded — Secret Lair

Flag `excluded`. Rule: any Scryfall set whose code begins with `sl` and whose name contains "Secret Lair", except `slx` (B.2). Known codes: `sld`, `slu`, `slp`, `slc`. Verify the full list on the first run.

### B.5 Handled by set-type rules, no row needed

*Un*-sets (`funny`), Alchemy and other digital-only sets, tokens, memorabilia, promos, and Mystery Booster playtest cards are excluded by 4.3 without appearing here. If any such set surfaces as an unmapped first printing, the run fails and the owner decides.
