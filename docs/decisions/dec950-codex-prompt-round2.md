You are the same independent senior reviewer who reviewed these documents once already. This is round 2. Be adversarial, specific and brief. Do not rewrite the documents. Do not run builds or modify any file.

Read, in this order, from the repository root:

1. `prd_v4.md` — draft 2 of the product requirements document, revised after your round-1 review.
2. `docs/decisions/dec950-overhaul-deep-dive.md` — the plan, revision 4. Section 12.5 is the author's triage of your nineteen round-1 findings (F1–F19), with where each landed in draft 2, and the record of the layout allocator computed on the real dataset.
3. `prd_v3.md` — the previous PRD that v4 amends (sections 3–4 and Appendices A–B carry over). Skim for contradictions.
4. `web/public/data/a5846bec28d1447e/planes.json` — the production dataset (a copy is at `wt-dec918-build/web/public/data/a5846bec28d1447e/planes.json` if the root copy is absent). Check any number you doubt.

Your round-1 verdicts were: PRD v4 draft 1 NO-GO; plan GO WITH CHANGES. Your round-1 findings, in short: F1 policy classification exceeds evidence; F2 layout law not an algorithm; F3 URP rung is a second renderer; F4 gold-centre and tiny-world geometry; F5 hub geometry and self-portal; F6 texture budgets and compression path; F7 the week is a stack integration and the gate misdiagnoses; F8 "built-in" overstated (spatialiser, Starter Assets, Mixamo, Godot trigger); F9 contract v4 not a record layout; F10 circular placement ownership; F11 image treatment vs compliance and HDRP post; F12 Appendix C cannot pass its validation; F13 Teferi/Jace fixtures, both-face parsing, the count, locked-content read; F14 basic lands are one card each, set destinations; F15 search dead end, portal hold, spawn positions; F16 Scryfall verification timing and headers; F17 content labour and cooked budgets; F18 screen reader, hardware operators, Personal licence activation; F19 editorial.

Context unchanged: the product is a free, unofficial fan work showing Magic: The Gathering card images under the Wizards of the Coast Fan Content Policy ("Don't use Wizards' IP in other games … regardless of whether it is distributed for free"). The team is one human owner plus five AI agent engineers that work only through text. The owner's decisions (Unity, twenty hero entries, one avatar Teferi, flat terrain, third-person, game-grade feel, no shareable URLs) are made; do not relitigate them.

Review in two parts:

Part 1 — **Resolution check.** For each of F1–F19, one row: ID, your verdict in {RESOLVED, PARTLY RESOLVED, NOT RESOLVED, RESOLVED BUT INTRODUCED A NEW PROBLEM}, one sentence of reason pointing at the draft-2 section. Judge the fix, not the triage prose. Where the author declined or changed your remedy, say whether the alternative is sound.

Part 2 — **New findings.** Anything draft 2 or plan revision 4 introduced or that you missed in round 1, in the same table form as round 1 (ID starting at F20, Severity in {blocker, major, minor, nit}, Document and section, Finding, Proposed fix). Pay particular attention to: the allocator in PRD 5.4 (determinism, convergence of the iterated plaza, the band-width rule, the path subtraction, the Poisson fallback, the colourless ring arcs, the fixtures); the 48-byte record in 4.13.3 (field widths, derived fields, ordering, joins); the isolated image path in 8.4.4 and whether a custom pass after post-processing can really coexist with depth-of-field on the world behind the card in card view; the BC3 compression path in 8.4.3; the slice's prerequisites, schedule and the three failure classes in 9.5; the hub's 88-portal ring geometry in 5.3; the content-supply subsection 8.12 and the cooked budgets in 7.2; the self-hosted runner recipe in 8.8.5; the open-question defaults in 11; the Appendix C source form in 4.12.1 (is explicit inheritance compatible with the "no silent fallback" principle?); anything still game-shaped.

Then:

3. One verdict line per document: `PRD v4 draft 2: GO | GO WITH CHANGES | NO-GO` and `Plan rev 4: GO | GO WITH CHANGES | NO-GO`, each with one sentence of reason. GO WITH CHANGES means the listed changes can be made in-document without another review round; NO-GO means at least one blocker remains.
4. "Must change before the owner confirms" — the shortest list that would move each verdict to GO.

At most 2,500 words. Your final message is the review itself, in Markdown, and nothing else. Do not write any file.
