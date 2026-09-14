# Eternities pipeline run — 2026-09-04

`eternities build --as-of 2026-09-04`. Report format: PRD 4.9.2. Data quality gates: PRD 9.2.

## Run

| Field | Value |
|---|---|
| Dataset | production |
| Data hash | `51beadfbdedb3cca` |
| Run date (`--as-of`) | 2026-09-04 |
| Scryfall bulk `updated_at` | 2026-09-04T09:05:32.308+00:00 |
| Scryfall bulk file | `default-cards-20260904090532.json` |
| Pipeline version | 0.5.0 |
| Contract version | 3 |

## Counts

| Measure | Value |
|---|---|
| Printings in the bulk file | 40 |
| Distinct `oracle_id`s in the bulk file | 20 |
| Printings included (4.3) | 27 |
| Cards included (4.4) | 12 |
| Printings emitted | 12 |
| Planes | 4 |
| Sets in the dictionary | 4 |

## Printings excluded, per rule (PRD 4.3)

| Rule | Printings |
|---|---|
| 4.3.4 promo | 9 |
| 4.3.1 Appendix B universes_beyond | 4 |

## Cards excluded, per rule (PRD 4.4)

| Rule | Cards |
|---|---|
| 4.4.1 no included printing | 6 |
| 4.4.3 Universes Beyond | 2 |

## Data quality gates (PRD 9.2)

| Gate | Result |
|---|---|
| 9.2.1 Unmapped sets | **0** — enforced; the run fails otherwise (4.6.4) |
| 9.2.2 Blind Eternities share | **25.00%** (3 of 12 cards) — reported, not gated; PRD 9.2.2 records 17.42% (2026-09-04) as the board-accepted baseline |
| 9.2.3 Cards that changed plane | 1 (vs run `0123456789abcdef`) |

### Blind Eternities baseline (PRD 9.2.2)

**Baseline: 25.00%.** The top contributing sets are where curation pays (PRD 11.9); the target is this baseline minus what curating the top three recovers.

| Set | Code | Cards | Share of dust |
|---|---|---|---|
| Modern Horizons | `mh1` | 3 | 100.0% |

## Cards per plane (PRD 4.9.2)

| Plane | Slug | Cards | Bands | Kind |
|---|---|---|---|---|
| Dominaria | `dominaria` | 6 | 2 | irregular |
| Blind-Eternities | `blind-eternities` | 3 | 1 | dust |
| Ravnica | `ravnica` | 3 | 1 | irregular |
| Segovia | `segovia` | 0 | 0 | empty |

## Surface assignment (worlds spec §1.3)

9 cards over 2 worlds: **9 exact, 0 displaced, 0 bare.** The grid relaxes to the population — only the per-row *cell counts* move; the row latitudes stay equal-angle and the band boundaries stay equal-area and are never snapped to a row. `rowCells` in `planes.json` is the shipped table (§2.4).

| World | Cards | Exact | Displaced | Bare | Rows | Closed form | Aspect |
|---|---|---|---|---|---|---|---|
| `dominaria` | 6 | 6 | 0 | 0 | 3 | 9 x | 125.0% |
| `ravnica` | 3 | 3 | 0 | 0 | 2 | 4 x | 112.1% |

**Closed form differs from the card count on 2 of 2 worlds** (marked `x`). That column is what §1.3's relaxation exists for and why §2.4 ships `rowCells` rather than a formula: `round(2*pi*sin(theta) / (aspect*dphi))` summed over the rows is only approximately the card count, and the shipped grid has to be exactly it.

**Aspect** is the worst row's deviation from 4:3. It is bounded by integer `rowCells`, not by the surface law: a two-cell polar row has an aspect of pi/2. The renderer must letterbox art into the cell's own rect and may not assume 4:3 anywhere (§2.1).

## Swatch fetch (worlds spec §2.2)

This dataset carries no `swatches.bin`.

## Brightness cap per plane (PRD 5.4.10)

The cap is each plane's 98% percentile of printing count. 0 of 3 non-empty planes hold at least one card above their cap; those cards all encode the same maximum brightness. The cap is applied before encoding, so changing the curve means re-running the pipeline (finding D6).

## Sets mapped through a parent set (PRD 4.6 rule 3)

| Set | Inherited from |
|---|---|
| `dmr` | `lea` |

Listed so a child set inheriting a plane it should not have — a bonus sheet under an in-universe parent — is visible rather than silent (PRD 4.6).

## Sets dropped through an ancestor's Appendix B row (PRD 4.3.1)

| Set | Dropped by the row on |
|---|---|
| `pza` | `tmt` |
| `ttmt` | `tmt` |

Appendix B rows a product, not every set code Scryfall splits it into: a Universes Beyond release ships tokens, promos, art series and bonus sheets that carry no row of their own. 4.3.1 follows the Scryfall parent chain exactly as 4.6 rule 3 does, so those children drop with their parent instead of leaking through.

Only 1 of these 2 sets is load-bearing: `pza` (15 printings, inherited from `tmt`). Every printing in the rest is caught by another 4.3 rule anyway — a token or promo set falls to 4.3.2 whichever Appendix B row is consulted — so the length of the table is not a measure of how much the walk is doing.

## Sets excluded as unreleased (PRD 4.3.8)

`trk`

## Card-level overrides applied (PRD 4.6 rule 1)

Card 3 -> ravnica

**1 override record matched no first printing.** Each is either a card some 4.3/4.4 rule excludes, or a stale record whose `oracleId` no longer belongs to a card in the dataset. Fix or delete them.

- Card 99 (00000000-0000-4000-8000-000000000099) -> segovia

## Cards whose plane changed since the previous run (PRD 4.9.2)

| Card | Was | Now |
|---|---|---|
| Card 7 | `ravnica` | `dominaria` |

Each row should trace to an appendix or override edit (PRD 9.2.3).

## First-run verification duties

### Q4 — security_stamp: triangle semantics (PRD 4.3.5)

**Verdict:** confirmed — 4.3.5 is safe as a secondary guard

- triangle printings: 4 across 1 sets

### Q10 — Appendix B set codes marked “verify”

**Verdict:** resolved with corrections — see below

- confirmed: 1
-   lea “Limited Edition Alpha” (1993-08-05, expansion)

**For the CEO:** The PRD itself still needs the same edit.

## Artefacts

| File | Bytes |
|---|---|
| `planes.json` | 2,286 |
| `search.json` | 862 |
| `sets.bin` | 312 |
| `stars.bin` | 160 |
| `planes/*.json` (4 shards) | 3,079 |

Written to `web/public/data/51beadfbdedb3cca/` (PRD 8.8.3).

