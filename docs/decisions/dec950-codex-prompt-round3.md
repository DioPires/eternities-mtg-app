You are the same independent senior reviewer who reviewed these documents twice already. This is round 3, and it is a closing round: confirm or deny resolution, name any remaining blocker, and give a verdict. Do not hunt for new minor or nit findings. Do not rewrite the documents. Do not run builds or modify any file.

Read, in this order, from the repository root:

1. `prd_v4.md` — draft 3, revised after your round-2 review.
2. `docs/decisions/dec950-overhaul-deep-dive.md` — the plan, revision 5. Section 12.6 is the author's triage of your round-2 findings F20–F37 and the residuals of F1–F19; section 12.7 lists the statements in the plan's sections 1–11 that draft 3 supersedes.
3. `web/public/data/a5846bec28d1447e/planes.json` — the production dataset (a copy is at `wt-dec918-build/web/public/data/a5846bec28d1447e/planes.json` if the root copy is absent). Check any number you doubt.

Your round-2 verdicts were: PRD v4 draft 2 NO-GO (blockers F20 angle infeasibility, F21 placement guarantee); plan rev 4 GO WITH CHANGES. The owner's decisions (Unity, twenty hero entries, one avatar Teferi, flat terrain, third-person, game-grade feel, no shareable URLs) are made; do not relitigate them.

Part 1 — **Resolution check of F20–F37 and of the round-1 residuals** (F1, F4, F6, F7, F10, F11, F14, F15, F18, F19; F2 is covered by F20–F22). One row each: ID, verdict in {RESOLVED, PARTLY RESOLVED, NOT RESOLVED, RESOLVED BUT INTRODUCED A NEW PROBLEM}, one sentence pointing at the draft-3 section. Judge the fix, not the triage prose.

Part 2 — **Remaining blockers only.** List anything in draft 3 or plan rev 5 that you would call a blocker (a contradiction an implementer must resolve by inventing a product decision, an infeasible requirement, or a claim that is false on the pinned facts). Same table form as before (ID from F38, Severity, Document and section, Finding, Proposed fix). If there are none, say so in one line. You may add at most three majors if they would change what the slice builds; do not list minors or nits.

Specific checks requested, each answered in one line with a section reference:
- 5.4.4: does the water-filling allocation always terminate and sum to exactly 360° for n = 1 … 6, including the all-clamped case?
- 5.4.9–5.4.10: is the lattice-plus-jitter scheme sufficient for the 2.5 m spacing invariant across site and band boundaries, given one global lattice? Is the capacity-then-placement-then-widen loop bounded and are its failure modes named?
- 5.4.7–5.4.8: are ring sites now fully defined (centre, pad, spur, neighbours) including the full-circle and zero-width-band cases?
- 8.4.4: does the two-draw design (depth and stencil in the opaque pass with colour write off, colour after post-processing with the unjittered projection and upscaled depth) plausibly give occlusion, no TAA smear, no depth-of-field on the card and depth-of-field on the world behind it in card view, on HDRP 17? Is the stated fallback (a second camera with post-processing off, stencil composite) sound?
- 8.4.3: does 384 RGBA8 slots at 244 × 340 with a full mip chain plus two `large` textures fit the 192 MB target and 256 MB ceiling, and does the slot bound make residency a hard limit?
- 9.5: is the acceptance matrix now a single, non-contradictory decision procedure (rows D, R1–R3, L, C, I, A), and are the five questions consistent with it?
- 7.7 and 11.1: is the distribution gate now applied to every distribution including friends, with internal evaluation excluded?
- 8.8.5–8.8.6: is the CI matrix now single and non-contradictory, with no bypass when the self-hosted runner is down?
- 6.4.5 and 4.13.4: do parent-mapped sets such as `mul` resolve to their sites?
- 9.1.6 and Appendix E: is the presentation lint now scoped so that catalogue content such as "Goblin Game" passes?

Part 3 — Verdicts: `PRD v4 draft 3: GO | GO WITH CHANGES | NO-GO` and `Plan rev 5: GO | GO WITH CHANGES | NO-GO`, each with one sentence. GO WITH CHANGES means every listed change can be made in-document without another review round. If NO-GO, name the single smallest change that would lift it.

At most 1,800 words. Your final message is the review itself, in Markdown, and nothing else. Do not write any file.
