You are an independent senior reviewer. You have not seen this project before. Review two planning documents before a team commits to building from them. Be adversarial, specific and brief. Do not rewrite the documents. Do not run builds or modify any file.

Read, in this order, from the repository root:

1. `prd_v4.md` — the product requirements document under review.
2. `docs/decisions/dec950-overhaul-deep-dive.md` — the plan under review (sections 1–10 are the first pass; sections 11 and 12 record the owner's decisions and revise the recommendation; where they disagree with 1–10, 11–12 win).
3. `prd_v3.md` — the previous PRD that v4 amends; sections 3–4 and Appendices A–B carry over. Skim it for what v4 silently drops or contradicts.
4. `docs/decisions/w23-concept-and-stack.md` — the prior stack decision v4 reverses.
5. `web/public/data/a5846bec28d1447e/planes.json` — the production dataset v4 quotes numbers from. Check any number you doubt against it.

Context you need: the product is a free, unofficial fan work showing Magic: The Gathering card images under the Wizards of the Coast Fan Content Policy. The policy says: "Don't use Wizards' IP in other games. This includes your own or other people's games or game components, regardless of whether it is distributed for free." The team is one human owner (level artist, reviewer) plus five AI agent engineers that work only through text (code, YAML, scripts); they cannot drive an editor. The engineers shipped the current three.js web app. The owner's decisions (engine Unity, twenty hero planes, one avatar Teferi, flat terrain, third-person, game-grade feel, no shareable URLs needed) are made; do not relitigate them. Review whether the documents implement those decisions well.

Review on these axes:

A. **Policy boundary.** Does anything in PRD v4 read as a game or a game component? Name each borderline feature and say whether its mitigation is enough.
B. **Internal consistency.** Numbers (world sizes from the formula in 5.4.4, percentages, counts, budgets), cross-references between sections, vocabulary rule violations (3.3), contradictions between the PRD and the plan, and between v4 and the parts of v3 it keeps.
C. **Feasibility.** The one-week vertical slice (PRD 9.5) with one agent engineer and the owner in the editor for at most two days; the kill criterion; the claims about Unity 6 HDRP on Apple Silicon and a URP rung from shared scenes; texture-array and streaming budgets in 7.2, 7.3 and 8.4.3.
D. **Engine choice reasoning.** Given the constraints (agents work in text, macOS first-class, owner is the level artist), is the Unity recommendation and its fallback sound? Is anything in 8.1.2's list of "built-in systems used, not rebuilt" wrong about what Unity 6 actually ships?
E. **Layout law.** Does "colour is the wedge, time is the radius, each set is a site" hold up on real data? Consider: a set with two cards of one colour; planes with 1–4 cards; the colourless ring; the gold centre when a plane has 37 sets; the hub with 4,204 cards and 50 sets; whether the result reads as a chart rather than a place.
F. **Gaps and cuts.** What is missing for an implementer to start the slice? What should be cut from v1 to protect the slice and Wave 5?
G. **Data and pipeline.** The contract v4 record layout (4.13.2), the avatar roster rule (4.14), Appendix C validation (4.12), the Scryfall native-client rules (4.15).
H. **Unlisted risks.** Anything section 10 misses.

Output, in Markdown, at most 3,000 words:

1. One verdict line per document: `PRD v4: GO | GO WITH CHANGES | NO-GO` and `Plan: GO | GO WITH CHANGES | NO-GO`, each with one sentence of reason.
2. A findings table with columns: ID (F1, F2, …), Severity (blocker, major, minor, nit), Document and section, Finding (one or two sentences), Proposed fix (one sentence). Rank blockers first. Every finding must point at a section number. Do not pad; ten sharp findings beat thirty soft ones.
3. "What to cut from v1" — a short list.
4. "What to add before the slice starts" — a short list.
5. "What the slice must prove" — the three to five questions the Dominaria slice must answer, phrased so a yes or no is possible.

Your final message is the review itself, in Markdown, and nothing else. Do not write any file.
