# Decision: the six worlds-spec §5 questions — owner ratified every recommendation

**The owner answered all six open design questions in `docs/worlds/spec.md` §5 on 2026-09-14
(DEC-690 interaction `0eda5f77`, resolved 13:22 UTC). Every answer is the spec's own
recommendation.** The questions were posted as "recommendation stands on silence"; this record
upgrades them from defaults to owner decisions. No Wave 4 leg changes scope.

Recorded 2026-09-14.

## The six answers

| # | Question (spec §5) | Decision | Leg it lands in |
|---|--------------------|----------|-----------------|
| Q1 | Swatch source image | **`art_crop`** — the honest colour source; ~9× the one-time pipeline fetch, same 223 KB artefact | P (DEC-748) — already shipped this way in contract v3; the decision confirms it |
| Q2 | Art under reduced-motion / data-saver | **Honour `prefers-reduced-data`: stay swatch-only**, with an explicit Settings control; swatch-only is a first-class look | R3 (DEC-751) |
| Q3 | Galaxy renderer after cutover | **Delete at cutover, one PR**; tag `galaxy-cutover` is the retrieval point | G (DEC-752) — spec §3.2 assumption now ratified |
| Q4 | Artist credit placement | **Reticle caption (card + artist when the cell shows art) plus persistent HUD/About attribution** | R3 (DEC-751) |
| Q5 | Printing-ring cap of 72 (PRD 5.6.8) | **Keep 72 for v1, revisit after cutover.** The corrected premise stands: the cap binds on five cards (the basic lands, Swamp 570 → Island 535; next is Sol Ring at 60) | R2 (DEC-750); §1.10's 1 px ticks still required |
| Q6 | Lighting model | **Camera-relative key light for v1**; revisit the fixed-sun-plus-fill variant once the surface law is settled | R1 (DEC-749) |

## Consequences

- **Nothing rebuilds.** Each leg was already building the recommendation, per the batch's "silence
  builds the recommendation" rule. The value of this record is that the choices are now decisions,
  not defaults — a future "why does the ring cap at 72?" resolves here, not in a re-litigation.
- **Q3 makes the cutover deletion normative.** Leg G's acceptance includes deleting the galaxy
  renderer, its gate (`visual-gate.mjs`, archived under the tag) and the v2 dataset generation in
  the cutover PR.
- **Q4 is the compliance decision** for showing `art_crop` without the full card (Scryfall's
  attribution ask). R3's implementation must carry both halves: the reticle caption and the
  persistent attribution line.
