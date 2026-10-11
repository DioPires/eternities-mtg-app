You are the same independent senior reviewer who reviewed these documents three times. This is a confirmation pass, scoped to your round-3 findings F38–F42 and nothing else. Do not look for new findings of any severity. Do not rewrite the documents. Do not run builds or modify any file.

Read, from the repository root:

1. `prd_v4.md` — draft 4. The sections that changed since draft 3 are: 3.2 (invariants 9 and 10), 5.4.4 (angle allocation by a scale factor), 5.4.7 (ring feasibility), 5.4.8 to 5.4.11 (reservations by geometry type, candidate inflation by the jitter radius, checker on final geometry, named failure modes), 8.4.4 (the exhibit-camera design), 9.5 (prerequisites: the runner is mandatory; the acceptance matrix rows D, R2, R3, L, I, A and questions 1 and 4), risk 8.
2. `docs/decisions/dec950-overhaul-deep-dive.md` — the plan, revision 6. Section 12.8 records your round-3 findings and their disposition.

Your round-3 verdicts were: PRD v4 draft 3 NO-GO on F38 (invalid bounded allocation; the 100 : 1 : 1 counterexample) and F39 (invariant 9 contradicted the required pad/path/plaza relationships), with F40 (image-path buffers), F41 (slice matrix contradictions) and F42 (runner deferral) as majors you said could close in-document once F38–F39 were fixed. You wrote: "Smallest coherent change lifting NO-GO: correct the allocator contract in §§3.2/5.4 to resolve F38–F39."

Answer, in Markdown, at most 900 words:

1. For each of F38, F39, F40, F41, F42: one row with ID, verdict in {RESOLVED, PARTLY RESOLVED, NOT RESOLVED, RESOLVED BUT INTRODUCED A NEW PROBLEM}, and one sentence pointing at the draft-4 section. For F38, check the 100 : 1 : 1 case and one more of your choosing against 5.4.4's procedure; for F39, check that the checker's rules in invariant 9 accept every reservation 5.4.8 requires (waystone pads on path junctions, site pads at spur ends, the return pad in the plaza, hero volumes overlapping the plaza) and still forbid what must be forbidden.
2. If any of the five is not RESOLVED, name the single smallest in-document change that would resolve it.
3. Verdicts: `PRD v4 draft 4: GO | GO WITH CHANGES | NO-GO` and `Plan rev 6: GO | GO WITH CHANGES | NO-GO`, each with one sentence. GO WITH CHANGES means every listed change can be made in-document without another review round.

Your final message is the review itself, in Markdown, and nothing else. Do not write any file.
