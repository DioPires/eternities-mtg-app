# What `worlds-gate.mjs` needs from the renderer

**Status:** leg G's consumption contract for leg R1's seams. Written before R1 starts, deliberately.

`docs/worlds/spec.md` §3.1 makes five seams normative renderer surface and assigns **all five to leg
R1**, and DEC-744 B1 / DEC-746 D5 confirm that ownership: **the gate consumes these seams and does
not build them.** The rule that follows from that — if a seam is missing when the gate is built,
that is an R1 defect routed via the CEO — is a good rule and an expensive one to exercise. R1 is
five engineer-days, and a seam that lands in a shape the gate cannot read costs a second round trip
through review to find out.

So this document states what the gate will read, in the shape it will read it, while R1 is still
unstarted. Nothing here adds a requirement to §3.1; it fixes the *spelling* of requirements §3.1
already makes, so that R1 can build against something checkable.

The machine-readable half is `web/scripts/lib/worlds-metrics.d.mts` — `CellSample`, `ArtCell` and
`EvictionSample` are the gate's actual input types, and `web/test/worlds-metrics.test.ts` runs the
criteria against them today.

---

## 1. The `?probe=` payload

The gate extends the existing seam rather than adding a second one: `window.__eternitiesProbe`,
installed only when the URL asks, exactly as `scene/probeSeam.ts` does today. `visual-gate.mjs`
reads `state()`; the worlds gate needs one more call, because per-cell data is far too big to belong
in the state object the status panel renders from.

```js
window.__eternitiesProbe.worlds() // → WorldsProbe, or undefined on a build without the seam
```

Returning `undefined` rather than throwing matters: the gate reports "the worlds probe is not
installed on this page" as a setup failure, which is a different verdict from a criterion going red.

```ts
interface WorldsProbe {
  /** The plane in focus, or null at the home view. */
  planeSlug: string | null
  /** Camera distance in units of the plane's radius — W1 and W4 are both specified at a pose. */
  radii: number
  /** CSS pixels. Must match the screenshot's dimensions at dpr 1, or every sample is off. */
  viewport: { width: number; height: number }
  cells: ProbeCell[]
  pool: ProbePool
  /** Per band index, that band's share of the plane's cards. Gates W3's 5% rule. */
  bandShares: number[]
}

interface ProbeCell {
  /** Cell centre in CSS pixels, origin at the viewport's top-left. */
  x: number
  y: number
  /** On-screen height in CSS pixels — the W1 statistic and the W2 ≥ 6 px cut. */
  height: number
  /** `dot(normal, toCamera) > 0.12`, §1.6's own facing test. */
  frontFacing: boolean
  /** Passed §1.6's frustum test. Reported, not filtered — W4's denominator needs it explicitly. */
  onScreen: boolean
  /** Index into `BAND_ORDER`, the 13-band north-to-south chain of §1.3. Not a colour class. */
  band: number
  /**
   * §1.4's shade term as the renderer computed it:
   * `0.10 + 0.95·clamp(dot(n, light)·0.5 + 0.5, 0, 1)²`.
   *
   * W2's lightness half is measured over the **iso-shade subset** (§3.1) and cannot be computed
   * without it. The gate deliberately does not re-derive it from the normal and the light
   * direction: a gate that recomputes shade asserts against its own model of the lighting rather
   * than against the shipped one, and would stay green on a renderer whose light had drifted.
   *
   * This is the one probe field that is a *derived* quantity rather than a state read, which is
   * why it is normative in §3.1 rather than being a gate-side convenience.
   */
  shade: number
  /** Above the *effective* threshold this frame. Under §1.6's quantile this is not "height ≥ 24". */
  wantsArt: boolean
  /** Resolved to art and cross-faded in — `iArt` at 1, not merely a layer having been claimed. */
  showingArt: boolean
}

interface ProbePool {
  /**
   * After §1.6's clamp, not the tier constant: `max(0, min(tierLayers, maxLayers − 32))`.
   *
   * **The outer `max(0, …)` is load-bearing and this document originally omitted it.** W4.1's
   * `capabilities.ts` reports `maxArrayTextureLayers` as **0** — not as a large number — on a
   * non-WebGL2 context and on a lost context, so the inner expression is **−32 at every tier**
   * there. `layers >= 0` always, and **0 is a legal value**: a swatch-only world, which is what
   * §1.4's shading path already degrades to when no cell holds a layer. The gate treats 0 as a
   * measurement, not as a setup failure.
   */
  layers: number
  /** Must satisfy `resident <= layers`; the prototype's 1,031-in-1,024 is the bug this catches. */
  resident: number
  /** CSS px. Equals 24 exactly under `?artThreshold=fixed24`. */
  effectiveThresholdPx: number
  /** Cumulative since page load, monotonic. The gate differences it; see §3 below. */
  evictions: number
}
```

**Cells are reported for the focused plane only.** W1 flies to each world in turn — 45 on the v3
roster after DEC-745, and read off `planes.json` rather than hardcoded — and
takes the statistic per plane; a single pooled array across the system would make the per-plane
median unrecoverable, and W1's verdict is the worst plane, not the pooled one.

**One entry per card, and `height` is the *subdivided* cell's extent (DEC-749's §1.4 amendment).**
§1.4 now makes the base geometry a `(k_lon + 1) × (k_lat + 1)` vertex grid with one `k` per world,
reaching `(1, 1)` only from 574 cards up — so **32 of v3's 45 worlds are subdivided**, and this is
the roster's common case, not its edge. Two things that amendment must not change:

- **Cardinality.** `cells` stays one entry per *card*. The sheet is still one instance per cell and
  `k` only re-tessellates the shared base geometry, so this falls out of the instancing for free —
  but a probe that walked sub-quads instead of instances would multiply W1's sample count by `k²`
  and divide its median height, and it would do so on 32 worlds at once while leaving Dominaria
  (already at `(1, 1)`) untouched. Report instances.
- **What `height` measures.** The cell's on-screen extent as *rendered* — the spherical patch whose
  vertices §1.4 places on the lifted sphere — not the tangent quad that patch replaced. The two
  differ by exactly the corner lift the amendment exists to remove: 0.7% on Dominaria, 5.7% on
  Rabiah, 11.6% at 30 cards, **265% at N = 1**.

**The gate cannot catch a `height` computed from the old tangent quad, and this is deliberate
routing, not an oversight.** The error is an over-statement, W1 is a floor, and it is largest exactly
where W1 has the most headroom: the subdivided worlds are the *small* ones, whose cells are enormous,
while W1's verdict binds on the largest world — Dominaria, at 25.3 px, which `k = (1, 1)` leaves
flat anyway. So every W1 row stays green under both models, including §3.1's one-card
`?plane=segovia` row, where the silhouette-sized cell clears 24 px whether it is measured as a patch
or as a quad 3.65× too big. **That row is an expected-GREEN control that is insensitive to this
defect** — it pins the gate's n = 1 *domain* handling and nothing about the geometry. The guard for
the geometry is R1's own: §1.4's 1,262-sub-quad envelope assertion in the sheet's unit test.

**`band` is the band index, not the colour class.** §1.3's layout is `C G R B U W · Gold · W U B R
G C`, thirteen bands over seven classes, and W3 compares bands adjacent *on the sphere*. Reporting a
class would merge the two ice caps — which sit at opposite poles — into one group and invent an
adjacency the sphere does not have.

## 2. The control seams — five owned by R1, plus one readback seam owed by R3

Straight from §3.1 and §1.6; restated only as what the gate asserts of each. `?probe=` is one of
them and not a separate kind of thing: it is renderer surface the gate reads and does not build.
**§3.1's ruling is that all five are R1's**; an earlier draft of this table put `?layers=N` on
"R1/R3", and R3's rows (§1.10–§1.12) carry none of them.

| Seam | Owner | What the gate needs to be true |
|---|---|---|
| `?probe=` | R1 | Installs `window.__eternitiesProbe.worlds()`, §1 above. Returns `undefined` on a build without the seam, which the gate reports as a setup failure rather than a red criterion. |
| `?swatch=mean` | R1 | Every cell takes the plane's mean swatch. **The grid and `band` are unchanged** — only the colour moves. With §3.1's iso-shade subset this one row now falsifies **both** halves of W2. |
| `?bands=shuffle` | R1 | **One global permutation of the plane's cards across the plane's cells.** The grid, the row latitudes, the band boundaries and each cell's reported `band` are all untouched; only which card sits in a cell moves. Three other readings all leave the criterion **green** — see below. |
| `?artThreshold=fixed24` | R1 | A constant 24 CSS px threshold: no histogram, no hysteresis, pool allowed to exhaust. `pool.effectiveThresholdPx` must read exactly 24 so the gate can prove the seam took effect rather than assuming it. |
| `?layers=N` | R1 | Pins the pool size alone, reported back **after** the `max(0, min(N, MAX_ARRAY_TEXTURE_LAYERS − 32))` clamp. **It is not `?quality=N`** — that one already exists (`adaptiveQuality.ts:360`) and moves five quantities at once (`pixelRatioCap`, `bloomScale`, `bloomLevels`, `thumbnailCapacity`, `glow`). Routed through the tier, the expected-GREEN `?layers=128` row would also be measuring dpr, bloom and glow. |

### 2a. One readback seam the gate is missing — `data-plane-slug` on a label node (R3)

Not a control seam: nothing about it degrades the renderer. W5's coverage half (§3.1, added on
DEC-751's measurement) has to answer *which* worlds carry a visible label, and **the DOM cannot say**.
`PlaneLabels.tsx:293` passes `key={candidate.key}`, and a React `key` is never written to the DOM; the
node ships `className="label"` and a `<span class="label-name">` holding the plane's **display name**.

Matching display text back to a slug is not a substitute. It inverts a mapping the gate does not own,
it breaks on any renaming or truncation, and `label-band` nodes share the class — the gate would be
re-deriving the renderer's own identity from its presentation, which is the kind of second model
§3.1 exists to avoid.

**The ask: one `data-plane-slug={candidate.slug}` attribute on the label element**, present for
`tier === 'plane'`. Nothing else changes; it is inert at runtime and `aria-hidden` already covers the
subtree.

**Owner is R3 (DEC-751), not R1** — `labels/` is R3's surface under §1.10–§1.12, and this is the one
seam in this document that does not sit behind a query parameter. Routed through the CEO per
DEC-744 B1, the same way a missing R1 seam would be. Until it lands, `evaluateW5`'s coverage half is
implemented and unit-tested but has nothing to feed it in a live run.

**What `?bands=shuffle` must not be.** The gate cannot distinguish these from the outside by reading
W3 alone, because all three go **green**:

1. **Permuting the reported `band` alongside the card** — every band stays internally uniform and is
   merely relabelled, so every adjacent-pair ΔE stays large.
2. **Permuting the band → colour-class map** — each band is still one class, so adjacent bands are
   still different classes and still far apart in a\*b\*.
3. **Permuting within each band** — the band's contents are unchanged *as a set*, so its mean is
   unchanged exactly.

The distinguishing assertion belongs in R1's unit test for the seam, not in the gate: **under the
seam, the multiset of swatches within any single band must change.** It is invariant under all three
wrong readings and it is the cheapest thing that separates them.

Every control run asserts the seam engaged before it reads a criterion. A control that silently
no-ops produces a green row and reads as a passing gate — the `verify-browser --dataset all` shape
of failure, where two fixtures printed "all datasets verified".

## 3. Two things the gate does that the seam list does not imply

**Evictions are differenced, not read.** `pool.evictions` is a cumulative counter; W4's floor is
"≤ 5 evictions per second over the last 2 s". The gate samples the counter across the settle and
takes the rate over §3.1's window. This is not pedantry: Appendix A's 925 at `tether-surface` is
cumulative, and the same 925 on a settled pool is 0/s and passes. W4's eviction half is red at that
pose only if a rate says so — the art half, 1,024 of 2,759, is red from the drawn/wanted column
directly and carries the row on its own.

**Criteria report per half, and the matrix scores per half.** W2 and W4 are conjunctions, and a
conjunction hides which half did the work. Under `?swatch=mean` the neighbour-ΔE half collapses to
≈ 1.2 against a floor of 6 and goes solidly red — but the **un-subsetted** IQR(L\*) measured 14.1
against its floor of 8 and stayed green, because it was reading the lit sphere's own gradient rather
than the mosaic. The row was still red, so a gate reporting only the row would have recorded
`?swatch=mean` as exercising both halves of W2 when it exercised exactly one, and IQR(L\*) would
have shipped with no negative control at all. `checkControlRow` names the measure a row targets for
this reason, and §3.1 now requires it of every row.

This document previously answered the finding with a sixth, gate-side row — a flat unshaded wash.
**DEC-749 repaired it in the renderer instead, and that is the better fix:** §3.1's lightness half
is now measured over the iso-shade subset, where `?swatch=mean` drives it to ≈ 0, so one real
control row falsifies both halves and the gate-side row is gone. R1's re-derivation also showed the
un-subsetted measure could not fail *at all* — 12.6–21.6 for any single swatch — which is a stronger
statement than "it stayed green on this control". The gate-side workaround did not survive its own
finding.

**A criterion may be out of its domain, and that is a third verdict.** W2 and W3 are undefined on a
one-card world — no nearest neighbour, no second quartile, no adjacent band pair — and the v3 roster
has six. They report `insufficient`, which is neither red nor green, and the gate prints how many
planes landed there. Scoring them as failures would take the matrix's expected-GREEN row down
against a correct renderer; skipping them silently is how a gate prints green while measuring
nothing. See §3.1's note and `W2_MIN_SAMPLES`.

None of these changes a floor or a criterion. They are recorded here because they are decisions a
reader of §3.1 alone would not arrive at, and the second and third are the reason the gate's output
shape is what it is.
