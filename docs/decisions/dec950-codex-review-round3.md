**Closing verdict: PRD remains NO-GO; plan remains GO WITH CHANGES.** F20’s allocation failure persists, and the placement invariants still contradict required reservations.

Pinned dataset checked through the fallback copy: 88 planes, 28,603 cards, 42 empty, 16 with 1–49 cards, and 26,322 cards in the top twenty.

**Part 1 — Resolution check**

| ID | Verdict | Draft-3 evidence |
|---|---|---|
| F20 | PARTLY RESOLVED | §5.4.4 fixes feasible bounds but simultaneously clamping both extremes can leave a substantial residual; see F38. |
| F21 | PARTLY RESOLVED | §§5.4.9–5.4.10 fix global spacing and bound retries, but reservations remain contradictory and jitter follows collision acceptance. |
| F22 | PARTLY RESOLVED | §§5.4.1–5.4.14 add seeds, ordering, bounds and honest estimates, but the allocation procedure still fails F38. |
| F23 | RESOLVED | §§5.4.7–5.4.8 and §6.6.2 define ring sites, full-circle centres, zero-width bands, pads, spurs and neighbours. |
| F24 | PARTLY RESOLVED | §8.4.4 adds useful tests and two draws, but unjittered colour still uses potentially mismatched depth and stencil. |
| F25 | RESOLVED | §8.4.3 replaces compression with a bounded RGBA8 array and full mip chain within budget. |
| F26 | RESOLVED | §4.13.3 specifies decoder assertions, image-back semantics and relevant vectors. |
| F27 | RESOLVED | §5.9.4 makes entry automatic and direct across worlds; §7.2 budgets both travel cases. |
| F28 | RESOLVED | §§5.3.2–5.3.3 specify envelopes, ordering and single-preload arbitration. |
| F29 | PARTLY RESOLVED | §9.5 separates failure classes, but questions still conflict with permitted scope and target changes. |
| F30 | PARTLY RESOLVED | §§8.8.5–8.8.6 prohibit outage bypass, while §9.5 still permits deferring the runner and substituting a hand-run bench. |
| F31 | RESOLVED | §7.7.2 names a separate public release repository or itch.io. |
| F32 | RESOLVED | §8.11.2 requires the web catalogue to refresh alongside native. |
| F33 | RESOLVED | §2.1.3 and §9.3 align staged hero identity, kit identity and identical pockets. |
| F34 | RESOLVED | §§4.13.4–4.13.6 and §6.4.5 resolve sets through emitted sites regardless of parent mapping or furniture. |
| F35 | RESOLVED | §9.1.6 and Appendix E.5 exempt catalogue content from presentation lint. |
| F36 | RESOLVED | §7.7.1 and §11.1 gate every external distribution, including friends. |
| F37 | RESOLVED | §§7.2, 8.12 and 12 correct accounting and staging; the plan expressly gives draft 3 precedence. |
| F1 | RESOLVED | §7.7.1 and §11.1 distinguish internal evaluation from all distribution without claiming a legal exemption. |
| F4 | PARTLY RESOLVED | §§5.4.2–5.4.12 repair gold, chronology and small-world treatment, but wedge allocation still fails F38. |
| F6 | RESOLVED | §§5.5.5 and 8.4.3 make residency slot-bounded with explicit uncompressed memory costs. |
| F7 | PARTLY RESOLVED | §9.5 improves prerequisites and failure attribution but retains conflicting acceptance conditions. |
| F10 | PARTLY RESOLVED | §8.4.2 establishes placement ownership and dressing exclusions, but §3.2 contradicts required pad/path/plaza relationships. |
| F11 | PARTLY RESOLVED | §§4.15.5 and 5.5.6 resolve credits and filtering; §8.4.4 still needs the rendering correction below. |
| F14 | RESOLVED | §11.11 defers printing exhibits, and §6.4.5 handles parent-mapped and reprint-only sets. |
| F15 | RESOLVED | §§5.9.2–5.9.4 and §6.4.6 resolve loading holds, automatic travel and filtered destinations. |
| F18 | PARTLY RESOLVED | §§6.10.6, 7.1 and 8.8 resolve accessibility, operators and activation, but §9.5 retains the runner exception. |
| F19 | RESOLVED | §§3.3, 5.4.14, 7.4.4 and 8.12 correct terminology, estimate status, cache rules and counts. |

**Part 2 — Remaining blockers and three slice-changing majors**

| ID | Severity | Document and section | Finding | Proposed fix |
|---|---|---|---|---|
| F38 | **Blocker** | PRD §5.4.4; inherited by §5.4.7 | Simultaneous irreversible lower/upper clamping is not valid bounded proportional allocation. For three counts **100:1:1**, initial shares clamp to **120°,30°,30°**. All classes are clamped, but **180° remains**. Giving it to the largest produces **300°,30°,30°**, violating the 120° ceiling; the claimed micro-degree residual is false. | Specify a valid bounded allocation, such as solving `Σ clamp(λ × count, lo, hi) = 360°`, then deterministic integer apportionment within bounds. Validate ring lower-bound feasibility before applying the same solver. |
| F39 | **Blocker** | PRD §3.2 invariants 9–10; §§5.4.5, 5.4.8 | Invariant 9 forbids **pads intersecting paths or the plaza**; invariant 10 requires pads on the path network; §5.4.8 places pads at path intersections, and §5.4.5 puts the return pad inside the plaza. The independent checker cannot accept the required layout. | Define exclusions by geometry type: permit designated pad/path junctions, corridor/path joins and the return pad within the plaza; preserve stand/apron exclusions. Apply these same rules to final, jittered geometry, with named validation failure or bounded retry. |
| F40 | Major | PRD §8.4.4; §9.5 row I | Unjittering the second draw does not unjitter the first draw’s depth/stencil coverage. Upscaling also does not establish matching coverage. Depth-only card writes affect depth-dependent processing and suppress background rendering behind the card; colour-write-off alone does not establish the claimed compositing behaviour. HDRP 17 still warns about after-post depth jitter. [Unity documentation](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Injection-Points.html) | Specify matching output-resolution, unjittered occluder depth and card visibility masks for final composition; preserve world colour/depth for its post-processing. The second-camera fallback must provide those buffers rather than reuse the unresolved stencil assumption. Keep row I as the experimental gate. |
| F41 | Major | PRD §9.5, rows D/R/L/A and questions 1/4 | Row D permits dropping the lake, but question 4 still requires it. Row L permits dropping the light-Mac target, but question 1 and mandatory row A still demand its pass. R3 success lacks R2’s explicit degraded-pass consequences. | Make question 4 conditional on retained scope, make question 1 follow the selected hardware target, and give R3 success an explicit degraded outcome and corresponding budget amendment. State the outcome after the delivery extension expires. |
| F42 | Major | PRD §§8.8.5–8.8.6 versus §9.5 prerequisites | The authoritative matrix requires self-hosted suites and bench for every Unity PR, but the slice prerequisite permits deferring that runner with only a hand-run bench standing in. | Remove the slice deferral and require the runner before the week starts, preserving the stated no-bypass policy. |

**Specific checks**

- **§5.4.4:** **No**—the loop can terminate, but valid bounded angles summing to 360° are not guaranteed; F38’s all-clamped counterexample disproves the residual claim.
- **§§5.4.9–5.4.10:** **Spacing yes**, across site and band boundaries, from one global lattice and displacement ≤0.25 m; retries are bounded, but post-jitter geometry is not reaccepted and §5.4.11’s two-failure list omits independent-checker failures.
- **§§5.4.7–5.4.8:** **Definitions yes**—including full-circle centres and colourless-only sets with zero-width bands; their executable reservation rules still require F39.
- **§8.4.4:** **Not established as written**—occlusion, sharp card colour and world DOF are plausible with consistent buffers; the second-camera fallback is sound only with matching occluder depth and visibility masks, as F40 specifies.
- **§8.4.3:** **Yes**—the array is **169,801,728 bytes**; two unmipped `large` textures bring it to **174,833,664 bytes**, below both budgets; the slot count hard-bounds stand-image residency.
- **§9.5:** **No**—rows D/L/A and questions 1/4 conflict, and R3 success needs an explicit outcome; see F41.
- **§§7.7 and 11.1:** **Yes**—friends count as distribution; owner/agent internal evaluation is excluded.
- **§§8.8.5–8.8.6:** **Locally yes, document-wide no**—the matrix forbids outage bypass, but §9.5 retains a slice exception; see F42.
- **§§6.4.5 and 4.13.4:** **Yes**—site-list lookup handles parent mappings; pinned `planes.json` places `mul`’s one first-printing card in the Blind Eternities.
- **§9.1.6 and Appendix E:** **Yes**—catalogue names such as “Goblin Game” pass; authored presentation remains linted.

**Part 3 — Verdicts**

**PRD v4 draft 3: NO-GO.** Smallest coherent change lifting NO-GO: correct the allocator contract in §§3.2/5.4 to resolve F38–F39; F40–F42 can then be closed in-document without another review round.

**Plan rev 5: GO WITH CHANGES.** Its precedence and sequence are adequate; amend §12.6’s closure claims to reflect this review and make slice execution conditional on the corrected PRD contract and gates.