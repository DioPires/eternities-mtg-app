# What `worlds-gate.mjs` needs from the renderer

**Status:** leg G's consumption contract for leg R1's seams. Written before R1 starts, deliberately.

`docs/worlds/spec.md` §3.1 makes six seams normative renderer surface and assigns **all six to leg
R1**, and DEC-744 B1 / DEC-746 D5 confirm that ownership: **the gate consumes these seams and does
not build them.** (Five when this document was written; `?art=off` was added on DEC-821, and the
route it took — gate finds the need, R1 builds the seam — is the rule above working rather than an
exception to it.) The rule that follows from that — if a seam is missing when the gate is built,
that is an R1 defect routed via the CEO — is a good rule and an expensive one to exercise. R1 is
five engineer-days, and a seam that lands in a shape the gate cannot read costs a second round trip
through review to find out.

So this document states what the gate will read, in the shape it will read it, while R1 is still
unstarted. Nothing here adds a requirement to §3.1; it fixes the _spelling_ of requirements §3.1
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
window.__eternitiesProbe.worlds(); // → WorldsProbe, or undefined on a build without the seam
```

Returning `undefined` rather than throwing matters: the gate reports "the worlds probe is not
installed on this page" as a setup failure, which is a different verdict from a criterion going red.

```ts
interface WorldsProbe {
  /** The plane in focus, or null at the home view. */
  planeSlug: string | null;
  /** Camera distance in units of the plane's radius — W1 and W4 are both specified at a pose. */
  radii: number;
  /** CSS pixels. Must match the screenshot's dimensions at dpr 1, or every sample is off. */
  viewport: { width: number; height: number };
  cells: ProbeCell[];
  pool: ProbePool;
  /** Per band index, that band's share of the plane's cards. Gates W3's 5% rule. */
  bandShares: number[];
}

interface ProbeCell {
  /** Cell centre in CSS pixels, origin at the viewport's top-left. */
  x: number;
  y: number;
  /** On-screen height in CSS pixels — the W1 statistic and the W2 ≥ 6 px cut. */
  height: number;
  /** `dot(normal, toCamera) > 0.12`, §1.6's own facing test. */
  frontFacing: boolean;
  /** Passed §1.6's frustum test. Reported, not filtered — W4's denominator needs it explicitly. */
  onScreen: boolean;
  /** Index into `BAND_ORDER`, the 13-band north-to-south chain of §1.3. Not a colour class. */
  band: number;
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
  shade: number;
  /** Above the *effective* threshold this frame. Under §1.6's quantile this is not "height ≥ 24". */
  wantsArt: boolean;
  /** Resolved to art and cross-faded in — `iArt` at 1, not merely a layer having been claimed. */
  showingArt: boolean;
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
  layers: number;
  /** Must satisfy `resident <= layers`; the prototype's 1,031-in-1,024 is the bug this catches. */
  resident: number;
  /** CSS px. Equals 24 exactly under `?artThreshold=fixed24`. */
  effectiveThresholdPx: number;
  /** Cumulative since page load, monotonic. The gate differences it; see §3 below. */
  evictions: number;
}

/**
 * §1.6's stream report, published by DEC-778 and consumed here under DEC-782's ruling.
 *
 * **The key is REQUIRED and the gate reads the whole payload to find it.** `buildWorldsProbe` sets
 * `stream` unconditionally from a non-optional `WorldsProbeSource` field, so on a live payload the
 * key is always present, holding either this object or `null`. A payload missing the key is a
 * renderer that stopped publishing — not an old capture — so the gate fails that row rather than
 * coalescing. `readStream(raw.stream ?? null, c)` is the spelling this rules out, and it is the one
 * that would read the regression as the legal zero-layer world.
 */
interface ProbeStream {
  /** Bytes charged this session, successes and decode failures alike. Monotonic. */
  bytesFetched: number;
  /**
   * Bytes committed to requests that have not settled yet (DEC-780).
   *
   * **Neither monotonic nor a subset of `bytesFetched`.** It rises when a request issues and falls
   * when that request settles, whichever way it settles — so a gate asserting
   * `bytesReserved <= bytesFetched` would be asserting something a correct stream violates on every
   * frame that issues more than it has landed, which on this workload is the first frame of every
   * pose. The only invariant is `>= 0`.
   */
  bytesReserved: number;
  byteBudget: number;
  /**
   * The budget is spent — committed, not merely landed — and the stream has stopped asking.
   *
   * **The gate READS this and never recomputes it** (DEC-744 B1 / DEC-746 D5): re-deriving it
   * asserts against the gate's own model of the policy rather than the shipped one. The definition
   * is `bytesFetched + bytesReserved >= byteBudget`, and the older spelling
   * `bytesFetched >= byteBudget` **is the DEC-780 defect** — so a gate that recomputed the obvious
   * form would re-introduce the bug on the reading side after the renderer had been fixed.
   *
   * **The budget BINDS as of PR #57 (`1f58f3f`), and the earlier instruction not to assume it does
   * is withdrawn.** Before DEC-780 every want for a pose was tested at `bytesFetched === 0`, so all
   * 967 passed and the session spent 88.7 MiB against a 64 MiB budget. Today the admitted set is a
   * nearest-first prefix of about **729 responses / 70.2 MiB** (+9.7%) — the overshoot being the
   * 90 KiB estimate's error, since the prefix averages ~100,996 B against the roster's 96,159 B
   * population mean. A W4 row scored against 967 / 88.7 MiB is now scored against the unfixed tree.
   *
   * **Score what crossed the network — response count and bytes — and never `declinedBudget > 0`.**
   * The unfixed stream declines too (23,715 times in a 32 s run), just later, once the overspend has
   * already landed. Both trees read "declines happen", so that predicate separates nothing; it is
   * §3.1's W4 measure being carried by the wrong signal, arising in the instrument rather than in
   * the renderer.
   */
  swatchOnly: boolean;
  /** Requests handed to the queue — not the same as cells wanting art. */
  requested: number;
  resolved: number;
  failed: number;
  /** Wants refused, by cause. Exhaustion is what `?artThreshold=fixed24` exists to produce. */
  declinedExhausted: number;
  declinedBudget: number;
  declinedFailedBefore: number;
}
```

**`null` is not a zeroed report, and no criterion may collapse them.** `null` means the world
composed with **no `ArtStream` at all** — a zero-layer pool, which §1.6 makes a legal swatch-only
world — so nothing was ever going to be asked for. **All-zeros** means a stream exists and has asked
for nothing: a *live* path that is idle, which is exactly the shape DEC-772's missing `cardOf` took,
where the stream was wired and no cell ever reached it. One zeroed report for both would report the
never-installed case as the never-fired one, and W4 would score a broken composition as a legal
swatch-only world.

**These counters are session-GLOBAL and cumulative, not the focused world's, so no per-world
criterion may be written over them (DEC-782 N1).** W1's 45-world tour reads `requested`
113 → 207 → 224 → 224 → 224; at `azgol`, a world drawing 2 cells, the payload reports 224 requests,
none of which are azgol's, and the stop-to-stop delta is 0. Differencing does not rescue it — the
field answers a question about the session, and the gate must only ask it one.

**Cells are reported for the focused plane only.** W1 flies to each world in turn — 45 on the v3
roster after DEC-745, and read off `planes.json` rather than hardcoded — and
takes the statistic per plane; a single pooled array across the system would make the per-plane
median unrecoverable, and W1's verdict is the worst plane, not the pooled one.

**One entry per card, and `height` is the _subdivided_ cell's extent (DEC-749's §1.4 amendment).**
§1.4 now makes the base geometry a `(k_lon + 1) × (k_lat + 1)` vertex grid with one `k` per world,
reaching `(1, 1)` only from 574 cards up — so **32 of v3's 45 worlds are subdivided**, and this is
the roster's common case, not its edge. Two things that amendment must not change:

- **Cardinality.** `cells` stays one entry per _card_. The sheet is still one instance per cell and
  `k` only re-tessellates the shared base geometry, so this falls out of the instancing for free —
  but a probe that walked sub-quads instead of instances would multiply W1's sample count by `k²`
  and divide its median height, and it would do so on 32 worlds at once while leaving Dominaria
  (already at `(1, 1)`) untouched. Report instances.
- **What `height` measures.** The cell's on-screen extent as _rendered_ — the spherical patch whose
  vertices §1.4 places on the lifted sphere — not the tangent quad that patch replaced. The two
  differ by exactly the corner lift the amendment exists to remove: 0.7% on Dominaria, 5.7% on
  Rabiah, 11.6% at 30 cards, **265% at N = 1**.

**The gate cannot catch a `height` computed from the old tangent quad, and this is deliberate
routing, not an oversight.** The error is an over-statement, W1 is a floor, and it is largest exactly
where W1 has the most headroom: the subdivided worlds are the _small_ ones, whose cells are enormous,
while W1's verdict binds on the largest world — Dominaria, at 25.3 px, which `k = (1, 1)` leaves
flat anyway. So every W1 row stays green under both models, including §3.1's one-card
`?plane=segovia` row, where the silhouette-sized cell clears 24 px whether it is measured as a patch
or as a quad 3.65× too big. **That row is an expected-GREEN control that is insensitive to this
defect** — it pins the gate's n = 1 _domain_ handling and nothing about the geometry. The guard for
the geometry is R1's own: §1.4's 1,262-sub-quad envelope assertion in the sheet's unit test.

**`band` is the band index, not the colour class.** §1.3's layout is `C G R B U W · Gold · W U B R
G C`, thirteen bands over seven classes, and W3 compares bands adjacent _on the sphere_. Reporting a
class would merge the two ice caps — which sit at opposite poles — into one group and invent an
adjacency the sphere does not have.

### 1a. As served — the reconciliation with R1's `b267426`

The payload above is what this document *asked for*. R1 served it at `dec749-r1-spec-fixes`
`b267426`, and the shipped declaration is `web/src/scene/worlds/worldsProbe.ts` — `WorldsProbe`,
`WorldsProbeCell`, `WorldsProbePool`. **That declaration is normative and this section records where
it differs, so the two documents cannot quietly drift into disagreeing.**

The gate reads the payload through `web/scripts/lib/worlds-probe-read.mjs` and nowhere else, and
that module's declaration imports `WorldsProbe` from the renderer rather than restating it. A field
R1 renames is then a `tsc` error in this leg's own suite instead of an `undefined` arriving inside a
criterion — which would compare false against every floor and score the frame RED for the wrong
reason. `web/tsconfig.json` sets `skipLibCheck`, so the import alone proves nothing; the pin is
exercised from `test/worlds-probe-read.test.ts`, and it is verified by mutation — renaming
`bandShares` on R1's interface fails that file in four places.

**Two additive differences, both accepted.**

1. **`rect` survives alongside `x`/`y`/`height`.** §3.1 asks for a screen-space rect and this
   document asked only for the centre and the height. Both ship, `height === rect.height` by
   construction, and the reader checks it anyway: it is the one field the contract duplicates, so it
   is the one field where a payload assembled from two different frames would show a seam.
2. **`seams` is on the payload** — this leg's own ask, adopted. See the witness table in §2.

**One substantive difference, and the reason for it is not the obvious one.** `x`/`y` is the
*projected cell centre*, not the centre of `rect`. R1 measured the two a mean 1.3–10.3% of a cell
height apart, worst **27.8%** (Ravnica, row 42 of 49, at 3.5 radii), because a spherical patch
projects to a curved outline whose bounding box is not centred on it. The tempting justification —
that the rect's centre samples a *neighbouring* cell — was tested and **refuted**: point-in-polygon
against the projected outline over four worlds at two poses is 0 of 4,803 samples off-cell, with a
negative control (the same point pushed down one cell height) reading off-cell 4,803 of 4,803. The
reason that survives is W2's: `shade` is evaluated at `(x, y)` and the gate samples the capture at
`(x, y)`, and W2's lightness half pairs those two *per cell* over the iso-shade subset. They have to
be readings of the same point. The reader samples at `(x, y)` and a test pins it against a fixture
that paints a different colour at each of the two candidates.

**A correction to this document's own §1 cardinality claim.** "One entry per card" is exact about
the *subdivision* — `k` re-tessellates shared base geometry and never multiplies the instance count —
and it is not exact about the array's length. `buildWorldsProbe` skips any cell whose subdivided grid
is wholly inside the near plane and any cell whose centre is, so the invariant is
`cells.length <= cardCount` with ascending ids. It is an equality at both poses §3.1 measures at,
because the camera is outside the sphere at 2.2 and 3.5 radii. **The consequence is not the one it
looks like**: a dropped cell also fails `withinFrustum` on the same `z > -near` test, so it reads
`onScreen: false` and was never in W4's denominator. What it does move is W1, which filters on
`frontFacing` alone — the set loses the cells nearest the camera, the tallest there are, so the
median falls, which is toward RED and therefore the safe direction for a floor. The real cost is
blindness rather than bias: **the payload carries no `cardCount`**, so a run measuring 480 of a
world's 500 cards is indistinguishable from one measuring all 500. Until R1 publishes that one
field, `cellCardinality()` takes the count from the dataset — the same number §2.4 publishes — and
the gate refuses a frame that dropped anything.

**Two shapes the served payload settles that this document left open.** `bandShares` has exactly 13
entries and sums to **1, or to 0 on an empty plane** — the reader accepts those two and nothing
between them, because a single `≈ 1` check rejects the degenerate plane and a plain `≤ 1` accepts a
payload that silently dropped a band. And `pool.layers` of 0 is a measurement, not a setup failure.

### 1a. `wantsArt` is the size test alone, and the gate re-forms the admission itself

R1's `1edf715` settled two things this document had to take on trust.

**The admission height now has one spelling, and the probe reports it.** The renderer had been
admitting on a small-angle extent (`2·latArc·radius` over depth) while the probe reported
`rect.height >= effectiveThresholdPx`; the two disagree by up to 79% on the same cell at W4's own
2.2-radii pose, because the small-angle form carries no foreshortening and a limb cell measures as
tall as a face-on one. Both paths now reach one `cellScreenRect`. Checked rather than taken on
trust, because this is the shape where **the picture stays correct while only the measurement
moves** — `cellScreenRect` takes its geometry as parameters, so a wrong *binding* is invisible to
the shader. The binding holds: renderer and probe derive colatitude, longitude and the longitudinal
arc from the same `rowOfUnitY` nearest-row match, and `worldSurface`'s single `latArc` is row 0's
only because `cellDrawAngles` returns `dφ/2 · CELL_INSET` on every row. R1's test compares
`probe.cells[i].height` against `surface.admissionHeightPx(i)` across paths — not the probe against
itself — and carries both a negative control (the two spellings measurably differ) and an
assertion that both arms of the admission are exercised.

**`wantsArt` is deliberately wider than the renderer's admission**, which is
`wantsArt && frontFacing && onScreen`. The visibility terms stay beside it rather than folded into
it so the gate can still tell a cell that was too small from one that was merely turned away — the
position §1 of this document asked for, and R1 kept. The consequence is the gate's to honour: **W4
must re-form the conjunction.** Pairing `wantsArt` against `showingArt` alone puts cells the
renderer correctly never fetched into the denominator, and the criterion goes red on correct
behaviour. Measured at 2.2 radii over the shipped 45-world roster, dropping the terms inflates
alara's denominator from 111 to 499 under `?artThreshold=fixed24` — a 4.5× collapse in
`artFraction`, far below the 0.9 floor.

**How load-bearing each term is, measured, because it decides what the live matrix can assert.**
The adaptive quantile is taken *relative to pool capacity*, so **capacity is an axis of this table,
not a constant**, and a row without it is a reading of the harness. Measured over the shipped
45-world roster at W4's own 2.2-radii pose, on R1's `caa3c4f`:

| `pool.layers` | `wantsArt && !frontFacing` | `wantsArt && !onScreen` | threshold still at the 24 px floor |
|---|---|---|---|
| 16 | 18 of 45 worlds, 111 cells | empty on all 45 | 17 of 45 |
| 64 — *below every shipped rung* | 30 of 45, 1,768 | empty on all 45 | 21 of 45 |
| **128** — tier 4, the smallest shipped | **37 of 45, 4,313** | empty on all 45 | 32 of 45 |
| **224** — tiers 0–3 at WebGL 2's spec minimum | **42 of 45, 8,256** | empty on all 45 | 39 of 45 |
| 1,024 — tier 0 on this Mac | 45 of 45, 12,771 | empty on all 45 | 45 of 45 |
| `?artThreshold=fixed24` (capacity-independent) | 45 of 45, 12,771 | empty on all 45 | n/a |

**Re-measured at DEC-882, on the same offline roster rig at the same 2.2-radii pose**, because raising
§1.6's quantile from 64 buckets to 256 moves every threshold and therefore every `wantsArt`. The
shape of the table is unchanged and the `!onScreen` column is still **empty on all 45 at every
capacity**, which is the claim it exists to make:

| `pool.layers` | `wantsArt && !frontFacing`, `a0eec54` | same, at 256 buckets | at the floor, both |
|---|---|---|---|
| 16 | 18 of 45, 113 cells | 19 of 45, 118 | 17 of 45 |
| 64 | 30 of 45, 1,877 | 30 of 45, 1,897 | 21 of 45 |
| **128** | 38 of 45, 4,268 | 39 of 45, 4,363 | 32 of 45 |
| **224** | 42 of 45, 8,249 | 42 of 45, 8,343 | 39 of 45 |

The `caa3c4f` row above and the `a0eec54` column here differ by under 6% on every count, which is
what says the two measurements are of the same thing across three intervening renderer changes.

**An earlier revision of this table reported the 64-layer row alone, without saying 64 was the
pool** — and 64 is below every configuration the renderer ships. The correction is R1's (DEC-749),
independently re-measured here; §3.1 now requires `pool.layers` beside any such count, and
`evaluateW4` takes the pool as a **required** argument and records `poolLayers` so a count cannot be
written down without its provenance.

**The mechanism is capacity, and the mechanism this document previously gave was wrong on its own
evidence.** It claimed the excluded set goes empty on the worlds whose threshold rises highest —
"alara, arcavios, avishkar, eldraine, all at 93.9 px". That is refuted from inside its own 64-layer
reading: `amonkhet`, `avishkar` and `capenna` sit at *exactly* the same 93.94 px as alara and
eldraine and have 6, 8 and 16 excluded cells, so **avishkar was listed as empty while measuring 8**.
An identical threshold with opposite outcomes cannot be the threshold. It fails from the other end
too — at 64 layers `bloomburrow` has the **lowest** risen threshold on the roster and the **largest**
excluded set on it, which is the refuted mechanism running backwards. What actually moves the count
is the pool: the quantile is relative to capacity, so an undersized pool raises the threshold past
what any back-facing cell reaches. At 1,024 the policy meets `fixed24` exactly, because the
threshold never leaves the floor.

> **Those pixel figures are re-derived at DEC-882 and the pairing is now stated with its capacity**,
> because the quantile is relative to capacity and a threshold quoted without one is not a reading.
> At **64 layers**: `bloomburrow` **25.89 px with 232 excluded** against `dominaria` **30.13 px with
> 0** — lower threshold, larger excluded set. At **128 layers** `bloomburrow` is back at the 24 px
> floor entirely while `dominaria` reads 30.13 px and is still empty. Raising the grid to 256 moves
> the edges and not the argument: 25.40 / 232 against 30.71 / 0 at 64 and 128 respectively. The
> roster's highest risen threshold reads **93.94 px** on `a0eec54` — reproducing the figure above
> exactly — and **90.45 px** at 256, where `amonkhet` and `avishkar` sit together on it with 12
> excluded cells each while `alara` on the same edge has none.

**The two terms are therefore not the same kind of claim, and only one needed the qualifier.**
`AdaptiveThreshold` floors the quantile at `BASE_THRESHOLD_PX`: `offer()` drops anything under 24 px,
the chosen bucket is never negative, and `bucketEdgePx(0)` is 24. So `wantsArt` under the quantile,
at *any* capacity, is a subset of `wantsArt` under `fixed24` — verified across all five capacities
above, 39,254 adaptive-wanting cells, **zero** outside the fixed24 set. That makes the fixed24 column
the **envelope**, and it is capacity-independent:

- `wantsArt && !onScreen` is empty under fixed24, and fixed24 dominates every capacity, so it is
  empty at every pool size. Its unreachability is a **proof, not a reading**: at 2.2 radii the world
  subtends far less than the frustum, **no live control row can redden it at any capacity**, and the
  unit test in `worlds-metrics.test.ts` is its only guard. That row is not a duplicate of the live
  matrix and must not be retired as one.
- `wantsArt && !frontFacing` is bounded above by fixed24's 45/45 but is otherwise a function of
  `pool.layers`, and must be quoted with it.

**What this changes in the matrix: nothing that is asserted, only what is written down.** Checked
rather than assumed — no row, criterion or fixture was ever scoped to "the 30 worlds"; the number
appeared in this document's prose and one test block comment, both corrected. In particular the
`?layers=128` **expected-GREEN** row is unaffected and keeps its subject: 37 of 45 worlds have
back-facing wanters at tier 4. The two coincidental `30 of 45`s elsewhere in the spec are a
*different* quantity — `rowCells` mirror asymmetry, DEC-757's ruling — and are not this count.

**This block was vacuous in the gate's own suite until it was measured.** All three mutants of the
denominator — drop both terms, drop `frontFacing`, drop `onScreen` — survived 62/62 green, because
every W4 fixture built its population from a helper that hardcoded both terms to `true`. The
instrument was not inert: breaking the *numerator* reddened two tests, which is the positive control
that distinguishes a blind test file from a passing one. Two rows now bind the terms one at a time,
scored per term rather than per conjunction: control 64/64 green, drop-both fails 2,
drop-`frontFacing` fails 1, drop-`onScreen` fails 1 — neither row covering for the other.

## 2. The control seams — six owned by R1, plus one readback seam owed by R3

Straight from §3.1 and §1.6; restated only as what the gate asserts of each. `?probe=` is one of
them and not a separate kind of thing: it is renderer surface the gate reads and does not build.
**§3.1's ruling is that all six are R1's**; an earlier draft of this table put `?layers=N` on
"R1/R3", and R3's rows (§1.10–§1.12) carry none of them. The sixth, `?art=off`, arrived on DEC-821
after the first five and under the same ownership — it is not a gate-side addition.

| Seam                    | Owner | What the gate needs to be true                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?probe=`               | R1    | Installs `window.__eternitiesProbe.worlds()`, §1 above. Returns `undefined` on a build without the seam, which the gate reports as a setup failure rather than a red criterion.                                                                                                                                                                                                                                        |
| `?swatch=mean`          | R1    | Every cell takes the plane's mean swatch. **The grid and `band` are unchanged** — only the colour moves. With §3.1's iso-shade subset this one row now falsifies **both** halves of W2.                                                                                                                                                                                                                                |
| `?bands=shuffle`        | R1    | **One global permutation of the plane's cards across the plane's cells.** The grid, the row latitudes, the band boundaries and each cell's reported `band` are all untouched; only which card sits in a cell moves. Three other readings all leave the criterion **green** — see below.                                                                                                                                |
| `?artThreshold=fixed24` | R1    | A constant 24 CSS px threshold: no histogram, no hysteresis, pool allowed to exhaust. `pool.effectiveThresholdPx` must read exactly 24 so the gate can prove the seam took effect rather than assuming it.                                                                                                                                                                                                             |
| `?layers=N`             | R1    | Pins the pool size alone, reported back **after** the `max(0, min(N, MAX_ARRAY_TEXTURE_LAYERS − 32))` clamp. **It is not `?quality=N`** — that one already exists (`adaptiveQuality.ts:360`) and moves five quantities at once (`pixelRatioCap`, `bloomScale`, `bloomLevels`, `thumbnailCapacity`, `glow`). Routed through the tier, the expected-GREEN `?layers=128` row would also be measuring dpr, bloom and glow. |
| `?art=off`              | R1    | Every cell drops to its swatch: no cell asks the stream and no cell draws art. Cut **after** admission and **before** the request, so `wantsArt`, `heightPx` and the quantile read exactly as with the seam absent — the picture moves and nothing else does. **Not a substitute for `?layers=0`, and not substitutable by it**: that one moves `pool.layers`, the quantile's own divisor, and composes no `ArtStream` at all. |

**The read-backs are not equally strong, and the gate records which kind each row got.** `seams` on
the payload is R1's adoption of this leg's finding — a seam that silently fails to parse its own
query parameter runs the *unmodified* policy, its criterion passes, and the matrix records a
*passing control*. But `seams` is a read of the URL: it witnesses that the parameter **parsed**, not
that the policy **engaged**. Three of the five have a second, stronger witness in the payload:

| Seam                    | Witness                                     | Strength                            |
| ----------------------- | ------------------------------------------- | ----------------------------------- |
| `?artThreshold=fixed24` | `pool.effectiveThresholdPx === 24`          | **policy** — the renderer ran it    |
| `?layers=N`             | `pool.layers` moved off the baseline run's  | **policy**, given a baseline run    |
| `?art=off`              | `stream.requested === 0` against `wanting > 0`, `pool.layers` unmoved | **policy** — all three clauses, see below |
| `?swatch=mean`          | `seams.swatchMean`                          | echo — the parameter parsed         |
| `?bands=shuffle`        | `seams.bandsShuffle`                        | echo                                |

`?art=off`'s witness is a conjunction because no single clause of it is discriminating.
`requested === 0` on its own is the empty world; `wanting > 0` on its own is true of every unseamed
run; and the pair without the third clause is exactly what `?layers=0` also produces — by taking the
capacity away. Three frames carry no witness at all and the gate reports that rather than scoring
them failed: a `null` stream (no `ArtStream` was composed, which is not an all-zero report), a frame
where no cell wants art (the precondition arm), and an unset seam. `mutate-artoff.mjs` is the
matrix — one mutant per clause and per guard, all killed.

An echo separates "the parameter did not parse" from the other two failures, and it cannot separate
"the policy did not engage" from "the criterion is insensitive to it". **Nothing in the shipped
matrix rests on an echo alone**: both echo-only seams carry expected-RED rows, where the row going
red is itself evidence that the policy engaged. That argument is a property of *today's matrix*, not
of the seam, and it expires the moment a row is added — so `seamEvidence()` reports the strength per
row rather than a bare boolean, and the runbook prints it.

The `?layers=N` witness is conditional and the gate says so: without a no-seam baseline probe from
the same page there is no number for `pool.layers` to have moved *off*, and the row is downgraded to
an echo. The `?artThreshold=fixed24` witness holds in the set direction only — an unseamed run's
quantile may land on 24 px by coincidence, so `!== 24` is not something the baseline can promise.

### 2a. One readback seam the gate is missing — `data-plane-slug` on a label node (R3)

Not a control seam: nothing about it degrades the renderer. W5's reachability half (§3.1) has to
answer _which_ worlds carry a visible label, at **each** sampled azimuth, and **the DOM cannot say**.
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
DEC-744 B1, the same way a missing R1 seam would be. Until it lands, `evaluateW5`'s reachability
half is implemented and unit-tested but has nothing to feed it in a live run.

**This ask is unaffected by §3.1's control-seam withdrawal, and the two should not be confused.**
DEC-752 withdrew the request for a _control_ seam that would move world coverage — the viewport does
that, and it is the gate's own parameter. This is a _readback_ seam: it does not change what the
renderer draws, it lets the gate read which world a label belongs to. Sweeping 12+ azimuths makes it
more load-bearing, not less, because the identity has to be resolved per frame rather than once.

**What `?bands=shuffle` must not be.** The gate cannot distinguish these from the outside by reading
W3 alone, because all three go **green**:

1. **Permuting the reported `band` alongside the card** — every band stays internally uniform and is
   merely relabelled, so every adjacent-pair ΔE stays large.
2. **Permuting the band → colour-class map** — each band is still one class, so adjacent bands are
   still different classes and still far apart in a\*b\*.
3. **Permuting within each band** — the band's contents are unchanged _as a set_, so its mean is
   unchanged exactly.

The distinguishing assertion belongs in R1's unit test for the seam, not in the gate: **under the
seam, the multiset of swatches within any single band must change.** It is invariant under all three
wrong readings and it is the cheapest thing that separates them.

Every control run asserts the seam engaged before it reads a criterion. A control that silently
no-ops produces a green row and reads as a passing gate — the `verify-browser --dataset all` shape
of failure, where two fixtures printed "all datasets verified".

## 3. Two things the gate does that the seam list does not imply

**Evictions are differenced, not read — and the window is chosen by the pool, not by the clock.**
`pool.evictions` is a cumulative counter; W4's bound is **≤ 21 evictions/s on a fill-excluded tail,
at the shipped 1,024-layer pool alone** (board ruling on DEC-833 card `bd5c9aad`, option (a); it was
"≤ 5/s over the last 2 s", which was unreachable by construction — see §3.1's amendment). This is
not pedantry: Appendix A's 925 at `tether-surface` is cumulative, and the same 925 on a settled pool
is 0/s and passes. W4's eviction half is red at that pose only if a rate says so — the art half,
1,024 of 2,759, is red from the drawn/wanted column directly and carries the row on its own.

The gate therefore samples `{ t, evictions, resident, layers }` until the tail's own second half
agrees with the whole tail, then stops. The fill it excludes is the **climb to saturation**: below
`resident >= layers` the counter cannot move at all, so an unsaturated pool has no fill in *this*
counter and its whole window is the tail. **Both `resident` and `layers` are required on every
sample**, and a timeline missing either is scored as unreadable rather than as a settled zero — the
comfortable wrong answer here is a `0` that sails through the bound. Three outcomes now carry
`insufficient` rather than a number: a pool that saturated too late to leave a tail, a tail that
never settled, and a session at any capacity but 1,024.

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
un-subsetted measure could not fail _at all_ — 12.6–21.6 for any single swatch — which is a stronger
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
