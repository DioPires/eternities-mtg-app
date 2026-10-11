| ID | Verdict | Draft-4 confirmation |
|---|---|---|
| F38 | RESOLVED | §5.4.4 replaces irreversible clamping with a common scale factor and apportions rounding shortfalls only below the ceiling, resolving the bounded-allocation counterexample. |
| F39 | RESOLVED | §3.2 invariant 9 now permits all four required relationships in §5.4.8—waystone pads on junctions, site pads touching spur ends, the return pad inside the plaza, and hero volumes overlapping the plaza—while retaining the required exclusions. |
| F40 | PARTLY RESOLVED | §8.4.4 supplies independent, matching exhibit depth and colour buffers, but drawing exhibit coverage **0.5 px inset** leaves the surrounding main-camera placeholder pixels unreplaced rather than eliminating their fringe. |
| F41 | PARTLY RESOLVED | §9.5 resolves the lake, R3-success and delivery-extension cases, but row L permits a slice pass while the light-Mac target is “under review,” whereas question 1 and required row A still demand its pass while it remains a target. |
| F42 | RESOLVED | §9.5 makes the self-hosted runner mandatory and green before the week starts, explicitly preserving §8.8.5’s no-bypass requirement. |

**F38 checks.** For **100 : 1 : 1**, lo = 30° and hi = 120°; λ ≥ 120 yields **120°, 120°, 120°**, summing to 360° without exceeding either bound. For **100 : 10 : 5 : 1 : 1**, λ = 12 yields **120°, 120°, 60°, 30°, 30°**, exercising both bounds and an interior allocation; the sum is 360°. Apportioning any micro-degree shortfall only to angles below hi preserves the ceiling.

**F39 exclusions.** The checker still rejects footprints/aprons intersecting paths, pads, the plaza, hero volumes or another stand’s protected geometry; corridors crossing another stand’s footprint/apron, hero volumes or the plaza; pads overlapping other pads or hero volumes; and hero volumes covering the arrival point, return pad or paths. Stand spacing remains ≥ 2.5 m, and invariant 10 requires connectivity. The previously required pad/path/plaza relationships are therefore no longer checker violations.

**Smallest remaining changes, one per finding:**

- **F40:** Replace §8.4.4’s inset prescription and fringe-elimination claim with an explicit row-I acceptance requirement: composite the complete card rectangle and demonstrate no surviving placeholder fringe at its boundary under TAA, depth-of-field and both resolution scales. Include those boundary pixels in the existing image-path tests; independent exhibit buffers alone do not establish that result.
- **F41:** Amend row L so a miss explicitly **suspends the light Mac as a gating target for this slice**, pending Wave 5’s decision; question 1 and row A then evaluate the reference-machine result without contradicting L.

In plan §§12.6/12.8, replace unconditional closure claims with this confirmation’s dispositions and make slice execution conditional on applying those two amendments.

**PRD v4 draft 4: GO WITH CHANGES.** F38–F39 lift the NO-GO; the remaining F40–F41 corrections can be made in-document without another review round, with rendering feasibility still gated by the slice.

**Plan rev 6: GO WITH CHANGES.** Update its closure record and execution condition to reflect the two remaining amendments; no further document-review round is required.