# PRD review — Eternities (prd.md, 2026-09-04 draft)

Reviewer: CEO. Issue: DEC-584. Date: 2026-09-04.

## Verdict

The PRD is strong. It is precise, internally consistent in vocabulary, and implementable as written for roughly 90% of its content. The architecture (one GPU draw call for all stars, motion in the vertex shader, id-buffer picking, static hosting on Vercel) fits the stated budgets and matches the owner's Vercel requirement.

I found four problems that need a spec change or an owner decision before we plan implementation, plus a set of smaller gaps and two factual errors. None of them invalidates the design. All of them are cheaper to settle now than mid-build.

## Blocking findings (need a decision or a spec amendment)

### F1 — Type and set filters cannot work at multiverse level with the specified data

Sections 6.6.1 and 6.6.5 say all four facets (colour, type, rarity, set) apply at every level. Section 6.3.2 wants a live count of matching cards. Section 6.7.3 wants filters applied before the first frame on deep links.

But the only per-card data loaded globally is the 12-byte star record (8.3): position, plane, hue class, size class, brightness, twinkle. Colour and rarity filters can be evaluated from it. Card types and printing-set membership live only in `planes/<slug>.json`, which loads on plane focus (8.3). So at multiverse level the frontend has no data to evaluate a type or set filter, and no data to count matches.

**Options:**
- (a) Extend the global data. The star record's reserved byte can hold the eight filterable types as bit flags (eight types listed in 6.6.2 — exactly eight bits). Add a compact card→set-code index for the set facet (variable-length; roughly 100–200 KB compressed for ~27k cards), loaded with `search.json`. **Recommended.**
- (b) Restrict the type and set facets to plane and card level, and amend 6.6.5, 6.3.2, and 6.7.3 accordingly.

### F2 — The differential rotation rule defeats its own goal (5.4.13)

The spec bounds the inner/outer angular speed ratio at 1.3 "so arms remain readable over a 30-minute session". With spin periods of 2–5 minutes (5.3.14), a 1.3 rate ratio means inner stars gain one full extra revolution every ~7–17 minutes. Over 30 minutes the arms wind up by two to four turns and stop being readable. A constant rate ratio cannot deliver the stated outcome.

**Fix:** bound relative displacement, not rate. Either use an oscillating differential whose accumulated shear never exceeds a fixed angle (for example ±10° arm-relative), or drop the ratio to ~1.02, which reads as differential motion up close but keeps arms coherent for hours. This is a visual choice; the owner should pick the flavour during visual review, but the PRD text needs the correction now.

### F3 — Planet textures blow the GPU memory budget (7.2 vs 8.5.8, 8.5.10)

The thumbnail atlas alone is 4096×4096×4 bytes = 64 MB (more with mipmaps). Focusing a card adds two `large` textures (~2.5 MB each) plus up to 72 planet spheres each textured with a native-resolution `art_crop` (~1 MB+ each). A 72-printing card approaches or exceeds the 96 MB target by itself and threatens the 160 MB ceiling.

**Fix:** spec a planet texture size — downscale art crops on decode to, say, 256×256 (~0.25 MB each, ≤ 18 MB for 72 planets) — and state whether the atlas budget includes mipmap chains. Small spec addition; no design change.

### F4 — The earliest-printing Universes Beyond test can wrongly exclude Universes Within cards (4.4.3 vs B.2 `slx`)

Universes Within cards are in-universe reworks of Universes Beyond Secret Lair cards. If Scryfall gives a Universes Within card the same `oracle_id` as its UB original (must be verified), then the card's earliest printing of any kind is the UB Secret Lair printing. That printing carries a triangle security stamp and no `flavor_name`, so rule 4.4.3 excludes the card — contradicting the explicit intent to include Universes Within (2.2.3, B.2).

**Fix:** add an exemption to 4.4.3: a card is not excluded as Universes Beyond if it has an included printing in an explicitly exempted set (`slx`). Verify oracle identity behaviour on the first pipeline run and lock it with a 9.1.5 fixture (for example, the Universes Within version of a Stranger Things card).

Related, one tier down: cards that originate in Secret Lair (flag `excluded`, not `universes_beyond`) and later get reprinted in mixed products (The List, `plst`) will surface as unmapped first printings. The pipeline fails loudly, which is correct, but the PRD gives no rule for resolving them. Suggest a default: such cards map to the Blind Eternities via an override, or stay excluded, owner's call per card.

## Significant gaps (spec is silent or too thin)

### F5 — Blind Eternities navigation is underspecified

Three connected gaps:

1. **Reachability.** 5.3.4 tethers the Blind Eternities focus to the multiverse centre with plane-level distance limits. The dust spans the whole supercluster volume. Dust far from the centre can never reach the 24 px card-sheet threshold (5.5.1), so most Blind Eternities cards — likely the largest single population (see F7) — cannot be browsed visually, only reached via search or random. Suggest a movable tether: focusing dust tethers to the clicked region, not the multiverse centre.
2. **Deep links to a Blind Eternities card.** Card details are sharded at 2,000 cards per file (8.3), but no artefact maps `oracle_id` → shard. Add the mapping to `search.json` or the manifest.
3. **Two-stage fly-to.** For a Blind Eternities card, "fly to and frame the plane" (6.2.3) means framing the whole multiverse. Worth one explicit sentence so the implementer doesn't invent something.

### F6 — Two set codes in Appendix B are wrong (high confidence)

- Game Night 2018 is `gnt` on Scryfall, not `gn1` (B.2).
- Portal Three Kingdoms is `ptk`, not `p3k` (B.2).

The pipeline would fail loudly on both, so no silent damage, but fix them in the document now. Both should be re-verified on the first pipeline run like the other **verify** rows.

### F7 — The Blind Eternities will likely hold 20–25% of all cards, not ≤ 15%

Rough count of B.2 first printings: ten core sets (~2,300), Commander 2011–2021 (~550), Modern Horizons 1–3 (~750+), March of the Machine + Aftermath + Aetherdrift + Foundations (~900), Forgotten Realms + Baldur's Gate (~600), Jumpstart products (~120), Portal/P3K/Starter (~400). That is roughly 5,500–6,500 of ~25–27k included cards — 20–25%, against the 9.2.2 working target of ≤ 15%.

Open question 6 already plans to reset the target after the first run, so this is expectation-setting, not a defect: the Blind Eternities will be the single largest population in the product and it renders as unstructured dust. Confirm that is the wanted look, or raise the priority of override curation (open question 9).

### F8 — Selecting a reprint-only set from search is undefined

Search indexes all set names (6.5.2), including reprint-only sets, which have no plane. 6.5.4 says selecting a set "flies to the set's plane and adds a set filter chip" — undefined for Masters-style sets. Default proposal: add the filter chip, do not move the camera.

### F9 — Edge-case card objects need explicit rules

- **Meld results** (for example Brisela, Voice of Nightmares) exist in the Scryfall bulk file as separate card objects with their own `oracle_id`. Without a rule they become phantom stars. Exclude them (they are back faces, not cards) or fold them into their front cards; either way, name it in 4.3.3.
- **Conspiracy-type cards** (Conspiracy sets, mapped to Fiora) are draft-only objects with no mana cost. As written they become stars on Fiora and their type is outside the 6.6.2 type list. Confirm include or exclude.

## Minor notes (fix in passing, no decision needed)

1. **6.5.5 vs 8.3/8.7 wording.** "Ships with the initial payload" contradicts "loaded after the first frame". The intent (client-side index, no per-keystroke network) is clear; align the wording. Also `search.json` (~27k names + UUID table) will be roughly 0.5–1 MB compressed and has no budget line in 7.2 — add one.
2. **5.6.8 ring progression.** One ring up to 24 printings, then three rings for 25 — the two-ring case is skipped, and the cap for "beyond 72" is unspecified. Probably intentional aesthetics, but state the cap.
3. **CSP (7.6.1)** implies self-hosted fonts. Worth a sentence so nobody reaches for Google Fonts.
4. **Float16 positions (8.3)** need `Float16Array` (now in evergreen browsers) or a manual decode path; risk 6's float32 fallback already covers the GPU side. Fine, just noting the JS side.
5. **Happy coincidence worth making explicit:** the star record's reserved byte is exactly the eight type-flag bits F1 option (a) needs.

## What I checked and found sound

- Vocabulary discipline (3.4) is applied consistently through all 11 sections.
- The card/printing/first-printing model, the earliest-printing UB test's two stated directions (4.4.3), and the fail-loud unmapped-set rule form a coherent pipeline contract.
- Appendix B coverage is good. I walked the set history; everything absent is either reprint-only, excluded by set type (4.3.2), or covered by the fail-loud rule (B.5). The two wrong codes in F6 were the only errors I found.
- Budgets in 7.2 are tight but plausible: ~27k stars × 12 bytes ≈ 330 KB, within the 3 MB pre-intro budget alongside a Vite + three.js shell.
- The streaming order (8.7), deep-link intro behaviour (6.8.2), and URL-as-source-of-truth state model (8.4.1) are mutually consistent.
- Deployment (8.8) matches the owner's "standalone app on Vercel" requirement: static output, SPA rewrites, immutable data caching.

## Questions for the owner

1. F1: extend global data (recommended) or restrict type/set facets to plane level?
2. F2: accept displacement-bounded differential rotation in place of the 1.3 rate ratio?
3. F3: accept ~256 px planet textures to hold the GPU budget?
4. F5: accept a movable Blind Eternities tether so dust is browsable?
5. F8: reprint-only set in search — chip only, no camera move?
6. F9: exclude meld result objects; include conspiracies on Fiora — or exclude both?

---

# Addendum — verification of prd_v2.md (2026-09-04)

Verdict: **v2 fixes all four blocking findings and all the gaps. No question above still needs an owner answer.** I diffed v1 against v2 line by line and re-read every changed section in context.

## Findings, one by one

- **F1 fixed** (option a, as recommended). The reserved byte is now a card-type bitmask (8.3), and a new `sets.bin` artefact (per-star uint16 set ids) makes the set facet global. 6.6.5, 6.7.3, 8.7, and the 7.2 budget table (≤ 700 KB line) were all updated consistently. Set filters arrive a moment after first frame with a fade instead of "before first frame" — a sound relaxation.
- **F2 fixed.** 5.4.13 now specifies an oscillating shear, amplitude ≤ 10°, period 40–90 s, and explicitly forbids true differential rotation, citing the wind-up arithmetic. The DataTexture row (8.6.2) and vertex-shader path (8.6.3) match. Amplitude and period joined the visual tunables (open question 11).
- **F3 fixed.** 8.5.10 downscales planet art to 256 px on decode (`createImageBitmap` with `resizeWidth`), ≤ 14 MB for a 72-planet card.
- **F4 fixed.** New rule 4.4.5 exempts `slx` from the earliest-printing UB test; a Universes Within fixture joined 9.1.5; open question 12 tracks the `oracle_id` verification.
- **F5 fixed, better than my suggestion.** 5.3.4 defines an anchor point (clicked location / card position / multiverse centre) with re-anchoring on dust clicks. Deep links resolve via a star-index ↔ `oracle_id` table in `search.json` plus shards cut in star-record order (`floor(local index / 2000)`, no lookup table).
- **F6 fixed.** `ptk` and `gnt` corrected in B.2.
- **F7 fixed.** 9.2.2 now records a first-run baseline (expected 20–25%) and derives the target from it; open question 6 updated.
- **F8 fixed** (different default than mine, but defined and arguably better now that the set facet is global): a reprint-only set flies out to multiverse level and adds the chip.
- **F9 fixed.** 4.3.6 excludes meld results (reachable as back faces); 4.3.7 includes conspiracies with the rationale.
- **Minor notes 1–3 fixed** (search.json wording + budget line; ring progression "two up to 48"; self-hosted fonts in the CSP). Minor 4 (JS-side `Float16Array` decode) is unaddressed and needs nothing — it was informational.

## Residual nits (non-blocking, fold into the implementation plan)

1. 7.2 still does not say whether the 64 MB thumbnail atlas includes mipmap chains. With a full chain the worst case is ~104 MB — over the 96 MB target, under the 160 MB ceiling. Cheapest fix: no mipmaps on the atlas (thumbnails render near screen scale).
2. 6.2.3's first stage ("fly to and frame the plane") is still unglossed for a Blind Eternities card. The anchor rule (5.3.4) pins the end state; one sentence would close it.
3. Conspiracy cards set none of the eight type bits, so any active type filter dims them. Well-defined behaviour, just unstated.
4. Secret-Lair-original cards reprinted in The List remain a first-run triage item under the fail-loud rule (4.6.4) — expected, the report will name them.

---

# Addendum — verification of prd_v3.md (2026-09-04)

Verdict: **v3 is clean. It closes all three residual nits from the v2 addendum, changes nothing else, and is fit to serve as the implementation contract.**

I diffed v2 against v3 line by line. Exactly four lines changed, covering three edits:

1. **Nit 2 closed** (6.2.3): for a Blind Eternities card, the first fly-to stage now explicitly frames the dust around the card's position, which becomes the anchor per 5.3.4 — not the multiverse centre.
2. **Nit 3 closed** (6.6.2): conspiracy cards carry none of the eight type bits, so they match only while no type facet is active and dim under any type filter. Now stated, not just implied.
3. **Nit 1 closed** (7.2 + 8.5.8): the thumbnail atlas is base level only — no mipmap chain — with the rationale (a full chain adds a third to the 64 MB atlas and breaks the 96 MB target). The 7.2 budget row was reworded to match.

Nit 4 (Secret-Lair originals reprinted in The List) was always a first-run triage item, not a spec change; the fail-loud rule covers it. Nothing else in the document moved. prd_v3.md is the contract; the implementation plan references it exclusively.
