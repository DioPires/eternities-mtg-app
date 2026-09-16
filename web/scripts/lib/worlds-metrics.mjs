/**
 * The measurement core of `worlds-gate.mjs` — spec §3.1's criteria W1–W5 as pure functions.
 *
 * Everything here takes probe geometry plus colours already sampled out of the captured PNG and
 * returns numbers. Nothing here launches a browser, and nothing here knows what a seam is. That
 * split is deliberate and it is what lets the criteria be tested against the prototype's *measured*
 * numbers (Appendix A) rather than against a live renderer: the negative-control matrix of §3.1 can
 * be proven to go red on the frames it exists to forbid before the renderer that produces those
 * frames exists at all.
 *
 * ## Two decisions this module makes that §3.1 leaves open
 *
 * **1. ΔE is CIE76 — plain Euclidean distance in CIELAB.** §3.1 says "convert to CIELAB … the ΔE"
 * without naming a formula. W3 settles it: it asks for "the ΔE between their mean a\*b\*", a
 * distance in the chroma plane alone, and CIEDE2000 is not defined on a\*b\* without L\*. So the
 * only formula that can serve both criteria is the Euclidean one, and using CIEDE2000 for W2 while
 * W3 necessarily used CIE76 would put two different meanings behind one symbol in one table.
 *
 * **2. Every criterion reports each of its halves separately.** W2 and W4 are conjunctions, and a
 * conjunction hides which half is load-bearing. That is not a stylistic preference — it is forced
 * by the matrix. Under `?swatch=mean` every cell takes the plane's mean swatch, so neighbouring
 * cells differ only by `shade`, and adjacent cells have near-identical normals: the neighbour-ΔE
 * half collapses to ≈ 0 and goes solidly red. The matrix asserts per measure for this reason, and
 * §3.1 now requires each row to name the measure it aims at.
 *
 * This module first carried a sixth, gate-side control row — a flat unshaded wash — because the
 * un-subsetted IQR(L\*) survived `?swatch=mean` and so had no control of its own. **DEC-749 fixed
 * that in the renderer instead, which is the better repair**: §3.1's lightness half is now measured
 * over the iso-shade subset, where `?swatch=mean` drives it to ≈ 0, so one real control row
 * falsifies both halves of W2 and the gate-side row is gone. The finding stands; the workaround
 * does not survive it.
 *
 * **3. Three verdicts, not two.** See `criterion` — `insufficient` is the absence of a measurement
 * and is not a failure. The v3 roster's six one-card worlds are outside W2's and W3's domain.
 */

// ------------------------------------------------------------------------------------------------
// Floors — spec §3.1's table, in one place so the gate and its tests cannot drift apart
// ------------------------------------------------------------------------------------------------

export const FLOORS = {
  /**
   * W1: median on-screen height of front-facing cells, CSS px. Binds on Dominaria, 25.3 px.
   *
   * DEC-749's §1.4 subdivision does not move this number: `k` is `(1, 1)` from 574 cards up, so the
   * world the floor binds on is the one the amendment leaves flat. The 32 worlds it does re-mesh are
   * the small ones, whose cells clear 24 px by orders of magnitude — see the seam contract for why
   * that also makes the gate blind to a `height` still computed from the old tangent quad.
   */
  cellHeightPx: 24,
  /** W2: median ΔE from a cell to its nearest on-screen neighbour. */
  neighbourDeltaE: 6,
  /**
   * W2: interquartile range of L\* across the **iso-shade subset**.
   *
   * **Provisional (DEC-749).** The 8 was set against the un-subsetted measure, which could not go
   * below ~12 because it was reading the lit sphere's own gradient. The iso-shade measure is a
   * different quantity with a different scale, and its floor is re-derived from the worst plane on
   * R1's first full gate run once leg P publishes real swatches. Until then the matrix asserts the
   * measure's **direction** — real build high, `?swatch=mean` ≈ 0 — which is decisive wherever
   * between ~2 and ~20 the floor lands. Do not build a green expectation on the 8 itself.
   */
  lightnessIqr: 8,
  /**
   * W3: ΔE between the mean a\*b\* of two bands adjacent on the sphere.
   *
   * **Derived, not chosen — and the derivation is re-runnable (DEC-752, DEC-824).** The ruling
   * `hold_pending_control` held this at 10 while `?art=off` was built; it retires here. Measured at
   * the 2.2-radii pose on leg G over main `28d4676` and again over `7483cd6`, one build per arm.
   * `w3-floor-shipped` / `w3-floor-control` + `scripts/w3-floor.mjs` re-take them.
   *
   * | reading | sessions | binds |
   * |---|---|---|
   * | acceptance tour, unmodified build, worst of 28 worlds | **0.7070** (ravnica), n=1 | floor ≤ this |
   * | `?art=off&bands=shuffle` on dominaria — W3's control row | 0.4195 – **0.4477**, n=4 | floor > the **max** |
   * | `?art=off` on dominaria — the control's sibling | **1.2935** – 1.3327, n=4 | floor ≤ the **min** |
   *
   * So the floor may sit in **(0.4477, 0.7070]**, and 0.55 sits inside it: 23% above the control's
   * worst-case reading, 29% below the build's. Two significant figures on purpose — a third would
   * claim precision the session spread does not support.
   *
   * **The lower bound is the max of four control readings, not one of them.** A single session would
   * have given (0.4195, 0.7070] and a floor that looked 31% clear of a control it is really 23%
   * clear of. The same discipline is owed on the upper bound and is **not** paid: the acceptance tour
   * is n=1, because a 45-world tour is expensive enough that it stayed that way. Treat the 29% as the
   * less-tested half of this interval, and see `w3-floor.mjs` for how to pay it down.
   *
   * **The DEC-816 impasse is gone because its figures moved, not because it was argued away.** That
   * ruling recorded the shipped aggregate at 0.4253, *below* its own shuffled falsifier at 0.4757,
   * which is a criterion that cannot fail. On this tree the shipped aggregate reads **0.7070**. The
   * old pair was taken at head `21737f3`, before DEC-804's centre fix, DEC-812's budget and DEC-814's
   * belt rotation; do not carry either number forward. What is *not* re-measured here is the **bare**
   * `?bands=shuffle` tour, so the impasse is not disproved in its own terms — the shipped matrix's
   * W3 control is a dominaria row, and that row is what this floor is required to red.
   *
   * ### Three things this floor does not claim, each measured
   *
   * 1. **A tour-wide `?art=off` row would go RED against it.** That arm's worst world is avishkar at
   *    **0.4505**, under 0.55. No shipped row asserts it — `art-off` is a dominaria row at 1.2935 —
   *    but a tour-wide sibling added later will red, and that is the arithmetic and not a defect.
   *    Greening both would need a floor in (0.4234, 0.4505], a 0.027-wide window that is inside the
   *    session-to-session spread.
   * 2. **`?bands=shuffle` is one permutation, seeded by a constant** (`shufflePermutation`,
   *    `0x9e3779b9`). It reproduces exactly, which proves the route is deterministic and not that the
   *    value is the statistic. Measured consequence: on **8 of 28 worlds the shuffled frame scores
   *    *higher* than the unshuffled one** (amonkhet, avishkar, edge, fiora, ikoria, kaldheim, rabiah,
   *    ravnica). The control's direction is a property of the draw, per world — it does not correlate
   *    with cell count, band count or the smallest qualifying band share. The aggregate still reds
   *    because some world always draws badly, but a floor derived over several seeds would be a
   *    stronger object than this one.
   * 3. **It is a property of the shipped swatches, so a refresh can invalidate it** without a line of
   *    rendering code changing. The runbook's §4.3 says to re-derive on every refresh that rebuilds
   *    the v3 dataset, and one world — ravnica — is the whole of the upper bound.
   *
   * ### Retracted: this number separates nothing (DEC-752, routed from DEC-830)
   *
   * Everything above stands as the record of how 0.55 was picked. It is **not** a floor a verdict may
   * rest on. The upper bound it was derived from — the acceptance tour's 0.7070 — is flagged above as
   * n=1, and at n=3 on one unchanged dataset, one roster, one 26-world W3 domain and one pose the
   * same fold draws **0.4253 (`accept4`) / 0.7070 (`dec826-bare`) / 0.8005 (`accept3`)**. 0.55 is
   * inside that span, so the row's colour is settled by the draw. Worse for the derivation, the
   * shipped arm's lowest (0.4253) is *below* the composed control's highest (0.4477): the two arms
   * **overlap**, which is `w3-floor.mjs`'s "no separating floor exists" outcome.
   *
   * The DEC-816 impasse is therefore not gone. `accept4` re-drew 0.4253 on leg G with DEC-804,
   * DEC-812 and DEC-814 all in the tree, and DEC-830 re-drew it again — the figure did not move out
   * from under the impasse, it recurs.
   *
   * **The mechanism is the fold, not the renderer.** A minimum over the in-domain worlds of a
   * per-world minimum over band pairs falls as the population grows: truncated to the first 8 worlds
   * the same dataset reads 1.3499/1.3926 over 5 in-domain planes, and over the full 43 it reads
   * 0.25–0.80. The worst plane's identity drifts with it — innistrad, ravnica, eldraine,
   * forgotten-realms, avishkar over five draws. Replacing the fold with a statistic that converges is
   * a §3.1 amendment and the owner's call; this leg measures and does not move the criterion. Until
   * it is settled, **a GREEN W3 row is not evidence** (spec §3.2, condition 1).
   */
  bandDeltaE: 0.55,
  /** W4: fraction of cells above the effective threshold that are showing art. */
  artFraction: 0.9,
  /** W4: evictions per second, averaged over the last 2 s. A ceiling, not a floor. */
  evictionsPerSecond: 5,
};

/**
 * W5's ceiling — **derived from the roster, never written down as a number.**
 *
 * §3.1 published it as "≤ 30 (29 worlds plus the belt)", and the parenthesis is the real criterion:
 * what may carry a label at the home view is one per world plus the belt. The bare 30 went stale
 * the moment the roster moved. DEC-745 / PR #46 (Forgotten Realms) took the v3 production dataset
 * to **45 worlds — 29 spiral plus 16 irregular, which §6 collapses into one `world` kind — 1 belt
 * and 42 moons, 88 planes in total**, so the same derivation now gives 46. Left at 30, W5 would be
 * unsatisfiable by construction on the dataset it is supposed to accept, and §3.2 makes W1–W5
 * passing a condition for the galaxy's retirement.
 *
 * So the gate reads the roster and computes this. A refresh that adds a plane moves the ceiling by
 * itself, and the next Forgotten Realms does not silently turn the criterion into a tripwire.
 *
 * ## The belt is in the roster and can never carry a label (DEC-752, measured)
 *
 * `belts` is **not** added. §3.1's parenthesis says "one per world plus the belt", but
 * `labels/PlaneLabels.tsx:116` filters the candidate list by
 * `plane.slug !== BLIND_ETERNITIES_SLUG` before anything is projected, so the belt has no label
 * node at any camera, on any dataset. It is in `planesWithCards` — it carries 4,204 cards on
 * `3ce85aed66e9dc3a`, which is why the derivation picked it up — but card count is not what makes
 * a plane labellable here.
 *
 * Adding it buys the ceiling a permanent slack of exactly one: a renderer that labelled all 45
 * worlds *and* wrongly resurrected the belt's label would read 46 against a ceiling of 46 and
 * pass. The slack is small, but it is slack in the one direction a ceiling exists to refuse, so
 * the belt comes out. The parameter stays in the signature so a roster that does label its belt
 * can say so, and it is named for what it has to be rather than for what it is.
 */
export function homeLabelCeiling({ worlds, labellableBelts = 0 }) {
  return worlds + labellableBelts;
}

/**
 * The v3 production roster after DEC-745 / PR #46, for tests and for a default.
 *
 * The gate takes these off `planes.json` at run time — this is the provenance record, not the
 * source of truth.
 */
export const ROSTER_V3 = Object.freeze({
  worlds: 45,
  belts: 1,
  // The belt exists and is not labellable: `PlaneLabels.tsx:116` drops it by slug. Both numbers are
  // here so the roster stays a faithful description and the ceiling still comes out at 45.
  labellableBelts: 0,
  moons: 42,
  planes: 88,
});

/** The plane kinds §6 collapses into one `world`, and the only kinds that carry a `rowCells`. */
export const WORLD_KINDS = Object.freeze(["spiral", "irregular"]);

/**
 * §1.3's row count, the closed form — `max(1, round(π / √(4π / (aspect·N))))`.
 *
 * Here so `rowCellsFaults` can check the shipped table's row count without importing the pipeline.
 * This is the *only* part of §1.3's closed form the gate reproduces: the cell counts it derives are
 * not the shipped ones and must never be asserted (DEC-748, and see `rowCellsFaults`).
 */
export function rowsClosedForm(cardCount) {
  return Math.max(
    1,
    Math.round(Math.PI / Math.sqrt((4 * Math.PI) / ((4 / 3) * cardCount))),
  );
}

/**
 * **§1.3's `rowCells` table, checked against the three things that are actually true of it.**
 *
 * `planes` is `planes.json`'s array. Returns one fault string per violation, empty when clean.
 *
 * ## What is asserted, and what each one is worth
 *
 * Measured against the published v3 table (`c9468f1125bcddff`, vendored at
 * `docs/worlds/rowcells-v3.json`; re-measured after leg P moved the dataset off `3ce85aed`),
 * all three hold on 45 of 45 worlds — but they are not equally load-bearing and the gate should not
 * pretend otherwise:
 *
 * 1. **`Σ rowCells == cardCount`.** The real one. §1.3's exact-N law is what stops the grid dropping
 *    cards *silently*, and the closed form hits it at only 85 of 7,000 counts.
 * 2. **`rowCells[r] ≥ 1`.** Nearly vacuous, kept because it is free. The minimum cell count over the
 *    39 multi-card worlds is **2**; the only worlds where the floor binds are the six one-card
 *    worlds, where check 1 already forces `[1]`. It cannot fail unless check 1 does.
 * 3. **`rows == max(1, min(rows_closed, N))`.** The `min(·, N)` clamp — §1.3's "never more rows than
 *    cards" floor — is **unreachable**: `rows_closed ≈ √(1.047·N)`, which is below `N` for every
 *    `N ≥ 2` and rounds to 1 at `N = 1`. Swept over `N = 1…200,000`, `rows_closed > N` at **zero**
 *    of them, so on every input this is `rows == rows_closed` and the clamp is decoration. It is
 *    written in the spec's form anyway, and this note is why a reader must not score it as a tested
 *    guard (DEC-752, routed to DEC-749).
 *
 * Plus one structural check with real teeth: `rowCells` is present on exactly the world planes and
 * **absent** — not empty — on the belt and the moons, which is what §2.4 emits.
 *
 * ## What is deliberately NOT asserted
 *
 * - **Any equatorial-symmetry bound.** DEC-749's §1.3 ruling, reproduced here from the published
 *   table: strict `rowCells == reversed(rowCells)` fails on **30 of 45** worlds, the `≤ 1 mirrored
 *   pair by ≤ 1 cell` relaxation fails on the **same 30**, Dominaria differs in **15** pairs, and
 *   eight worlds carry a pair differing by two. The asymmetry is `_north_first` alternating a
 *   mirrored class's odd card by set-index parity, on purpose. Asserting any of these forms would
 *   go RED on a correct renderer, and `≤ 2` would only be wrong less often — 2 is the observed
 *   maximum over 45 worlds, not a derived bound.
 * - **`dφ == π / rows`.** It has no independent referent: `planes.json` carries no `dφ` field and
 *   neither does the probe payload, so the only available reading is `π/len(rowCells)` compared
 *   against itself.
 * - **Row centres at `(i + ½)·dφ`.** This one is real — it is what separates §1.3's colatitude
 *   placement from the degenerate `i·dφ` form — but it is **not the gate's to measure**. The centres
 *   live in the emitted positions, not in any field the gate reads: checked directly against
 *   `stars.bin` on **`c9468f1125bcddff`**, the per-row populations reproduce `rowCells` on **45 of
 *   45** worlds and every star sits within **0.000367 rad** of `(i + ½)·π/rows`, while the
 *   degenerate `i·dφ` grid fails on **45 of 45**. That is a dataset conformance check and belongs
 *   beside the pipeline's, where it can be taken at full float precision (DEC-752, measured).
 *
 *   Re-measured for DEC-749's warning that leg P redistributed 116 of 777 rows: the 45-of-45 half
 *   survives the move, but the old note's "44 of 45" for the degenerate grid does **not** — it is
 *   45 of 45 here, and `3ce85aed` is no longer on disk to re-run, so that figure is retracted
 *   rather than reconciled. Two traps cost real time and are worth leaving written down:
 *   `stars.bin` positions are **plane-local**, so subtracting `plane.home` (as a world-space
 *   reading would) puts every star ~`|home|` from the origin and the populations reproduce on only
 *   14 of 45; and `tilt` is a render-time transform that is **not** baked into the data, so
 *   un-rotating by it drops the same measure to 16 of 45. Both wrong readings are quietly
 *   *plausible* — they return a number rather than an error.
 */
export function rowCellsFaults(planes) {
  const faults = [];
  for (const plane of planes) {
    const isWorld = WORLD_KINDS.includes(plane.kind);
    const has = Object.hasOwn(plane, "rowCells");
    if (!isWorld) {
      // Absent, not empty: an empty array would read as "a world with no rows" downstream.
      if (has)
        faults.push(
          `${plane.slug}: kind ${plane.kind} carries a rowCells table`,
        );
      continue;
    }
    if (!has) {
      faults.push(`${plane.slug}: world with no rowCells table`);
      continue;
    }
    const cells = plane.rowCells;
    const total = cells.reduce((a, b) => a + b, 0);
    if (total !== plane.cardCount) {
      faults.push(
        `${plane.slug}: Σ rowCells is ${total} against ${plane.cardCount} cards — ` +
          `§1.3's exact-N law, and the direction that drops cards silently`,
      );
    }
    const empty = cells.findIndex((c) => c < 1);
    if (empty !== -1)
      faults.push(`${plane.slug}: row ${empty} holds ${cells[empty]} cells`);

    const want = Math.max(
      1,
      Math.min(rowsClosedForm(plane.cardCount), plane.cardCount),
    );
    if (cells.length !== want) {
      faults.push(
        `${plane.slug}: ${cells.length} rows against the closed form's ${want}`,
      );
    }
  }
  return faults;
}

/** W2 only samples cells this tall or taller (§3.1). */
export const W2_MIN_CELL_PX = 6;

/**
 * W2's iso-shade subset is the cells within ±2.5% of the median reported `shade` (§3.1).
 *
 * The un-subsetted IQR(L\*) could not fail: §1.7's key light sits 0.798 rad off the camera axis, so
 * shade alone spans 0.363/0.611/0.852 over the front-facing cap and puts IQR(L\*) at 12.6–21.6 for
 * *one* swatch — the sphere being lit, not the mosaic being tiled. Holding shade fixed leaves
 * swatch-to-swatch lightness, which is what W2 claims to measure.
 */
export const W2_ISO_SHADE_TOLERANCE = 0.025;

/**
 * W2 needs at least this many sampled cells before its statistics mean anything.
 *
 * Below it the criterion reports `insufficient`, not `fail`. The v3 roster has **six one-card
 * worlds** (ergamon, muraganda, pyrulea, regatha, segovia, shandalar) and 15 with ≤ 4 cards: at
 * n = 1 "nearest neighbour" has no referent and an IQR is the spread of a single sample, so a floor
 * comparison scores a correct render as RED and takes the matrix's expected-GREEN row down with it.
 * Four is the threshold because an IQR needs two quartiles to be a spread rather than a gap.
 */
export const W2_MIN_SAMPLES = 4;

/**
 * W2's **lightness** half needs a ring this large — a bigger domain than `W2_MIN_SAMPLES`, and the
 * difference is the point (ruling `w2_ring`, DEC-816 R3).
 *
 * Four cells is the floor below which an IQR is not a spread at all. It is not the floor above which
 * an IQR is *reproducible*, and the lightness half is the one measure here whose domain is a sliver
 * of the disc by construction, so it is the one that spends its life near that floor. Measured
 * across the two 45-world acceptance runs (`accept3`, `accept4`, same head `21737f3`, same dataset
 * hash `c9468f1125bcddff`), the worst run-to-run move of `lightnessIqr` against the smallest ring
 * admitted:
 *
 * | ring ≥ | worlds scored | worst run-to-run move | worst world | smallest IQR seen |
 * |---|---|---|---|---|
 * | 4 | 20 | 58.4% | capenna (16.04 → 38.54) | 4.40 |
 * | 6 | 15 | 56.6% | arcavios (5.87 → 13.55) | 4.40 |
 * | 8 | 11 | 55.4% | theros (32.23 → 14.38) | 14.05 |
 * | 14 | 6 | 18.9% | innistrad (27.73 → 22.48) | 14.46 |
 * | 20 | 2 | **7.6%** | dominaria (26.34 → 28.52) | 26.34 |
 *
 * The statistic does not settle until the ring is in the teens, which is what an IQR's ~1/√n
 * standard error predicts and what the table measures. **The two worlds that carried W2's RED were
 * both scored off six cells** — ixalan 4.40/4.53 and arcavios 5.87/13.55 — while arcavios moved by
 * 131% of the floor between two runs of the same build. A statistic that can do that is not evidence
 * about a renderer.
 *
 * ## Why the verdict does not turn on the exact number
 *
 * From ring ≥ 8 upward, **every world clears the floor of 8 on both runs**, and the smallest reading
 * anywhere in that set is 14.05 — 1.76× the floor. So anywhere in 8…20 the lightness half goes GREEN
 * on this dataset and only the stability of the surviving statistics changes. That is what makes 20
 * safe rather than tuned: it is the conservative end of a range whose verdict is constant, not a
 * number picked because it produced the answer. `W2_MIN_SAMPLES` is deliberately left at 4 — it
 * guards a different set, for a different reason, and merging them would put the neighbour half's
 * 20-cell worlds out of domain for no evidence at all.
 *
 * ## The cost, stated
 *
 * At 20 the lightness half scores **2 of 45 worlds** (dominaria 64, ravnica 22); the aggregate is the
 * worse of two. That is thin coverage and it is the price of the ruling. It does **not** cost the
 * measure its falsifier: `swatch-mean`, W2's only negative control, runs on dominaria, whose ring is
 * 61–64 — the control clears the new domain by 3×. See `W2_CONTROL_SUBJECT_MIN_RING`, which exists
 * so that a later edit moving the control to a smaller world fails a test instead of silently
 * turning the row `insufficient` and retiring the falsifier.
 */
export const W2_MIN_RING_SAMPLES = 20;

/**
 * The ring a world must offer to be a legal subject for W2's `swatch-mean` control row.
 *
 * A negative control that goes `insufficient` is not a control — it dies on the precondition arm and
 * reports nothing about the measure it exists to falsify. Raising the lightness half's domain to 20
 * put that failure one edit away, so the requirement is written down and tested rather than left as
 * a property of whichever world the matrix happens to name.
 */
export const W2_CONTROL_SUBJECT_MIN_RING = W2_MIN_RING_SAMPLES;

/** W3 only compares a band pair when the smaller band holds at least this share of the plane. */
export const W3_MIN_BAND_SHARE = 0.05;

/**
 * A label counts toward W5 only above this opacity — **the DOM node count is not the measurement.**
 *
 * §3.1 words W5 as "count rendered plane labels in the DOM", and read literally that is
 * `querySelectorAll('.label').length`, which is **87 on v3 no matter what the solver decides**.
 * `labels/layout.ts` gives *every* candidate a placement and signals the drop through opacity alone
 * — its own comment says so: "every candidate still gets a placement, faded or not". A label the
 * solver gave up on (`opacity = 0` after `MAX_SHIFTS`) is still a node, so the literal reading makes
 * W5 a constant: it would read 87 against 46 and fail forever, for every renderer, including a
 * correct one. A criterion that cannot vary with its subject is not measuring it.
 *
 * The threshold sits above 0 rather than at it because opacity is a float the solver writes and the
 * gate reads back through the DOM. It sits well below 0.4 deliberately: PRD 5.3.11 dims a plane
 * behind a nearer plane to 40%, and a dimmed label *is* on screen and *is* readable, so it counts.
 * Confirmed by DEC-751 against the shipped solver at `c83be44`.
 */
export const LABEL_VISIBLE_MIN_OPACITY = 0.05;

/**
 * The visible-label predicate, exported so the gate and its tests share one definition.
 *
 * `label` is `{ opacity }` as read off the rendered node.
 */
export function isLabelVisible(label) {
  return Number(label.opacity) > LABEL_VISIBLE_MIN_OPACITY;
}

/** W4's eviction rate is averaged over this window, in seconds (§3.1). */
export const W4_EVICTION_WINDOW_S = 2;

/**
 * The 13 bands north to south, from §1.3's `C G R B U W · Gold · W U B R G C`.
 *
 * Thirteen geometric bands over seven colour classes: colourless is split between the two ice caps,
 * each mono colour is a matched pair, gold is the single equatorial belt. `G` in that string is
 * green — gold is spelled out — and getting those two the wrong way round silently mirrors the
 * whole southern hemisphere.
 *
 * Adjacency for W3 is adjacency *in this list*: the pole-to-pole chain. The two colourless caps are
 * not adjacent to each other, and neither are the two white bands; they sit at opposite ends of the
 * sphere with the entire mosaic between them.
 */
export const BAND_ORDER = Object.freeze([
  "colourless",
  "green",
  "red",
  "black",
  "blue",
  "white",
  "gold",
  "white",
  "blue",
  "black",
  "red",
  "green",
  "colourless",
]);

/** The index pairs W3 walks: every consecutive pair in `BAND_ORDER`. */
export const BAND_ADJACENCY = Object.freeze(
  BAND_ORDER.slice(0, -1).map((_, i) => Object.freeze([i, i + 1])),
);

// ------------------------------------------------------------------------------------------------
// Colour
// ------------------------------------------------------------------------------------------------

const D65 = { x: 0.95047, y: 1.0, z: 1.08883 };
const DELTA = 6 / 29;

/** One sRGB channel, 0–255, to linear light. */
function toLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** CIELAB's cube-root companding, with the linear segment near black. */
function f(t) {
  return t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29;
}

/**
 * sRGB `[r, g, b]`, 0–255, to CIELAB under D65.
 *
 * The capture is what the browser wrote to a PNG with no colour profile, which for a page rendered
 * in sRGB is sRGB. This is the point at which the gate stops trusting the renderer and starts
 * trusting the file.
 */
export function srgbToLab([r, g, b]) {
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / D65.x;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) / D65.y;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / D65.z;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 ΔE — Euclidean distance in L\*a\*b\*. W2's distance. */
export function deltaE76(p, q) {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/**
 * Euclidean distance in the a\*b\* plane alone. W3's distance.
 *
 * Separate from `deltaE76` on purpose: §3.1 asks W3 for the distance "between their mean a\*b\*",
 * and dropping L\* is the whole point of that phrasing. Latitude has to read as *colour*, and a
 * band that differed from its neighbour only in lightness would satisfy a full ΔE while failing the
 * thing W3 is about — which is exactly what the lambert shade of §1.4 hands you for free.
 */
export function deltaEab(p, q) {
  return Math.hypot(p.a - q.a, p.b - q.b);
}

// ------------------------------------------------------------------------------------------------
// Statistics
// ------------------------------------------------------------------------------------------------

/** The median. Returns `null` for an empty sample rather than `NaN`, so callers must decide. */
export function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((p, q) => p - q);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The linear-interpolation quantile (the "type 7" definition, which is what NumPy and R default to).
 *
 * Named rather than inlined because W2's IQR is a floor a control has to be able to cross, and a
 * nearest-rank quantile and an interpolated one disagree by enough on small samples to move a
 * verdict.
 */
export function quantile(xs, q) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((p, r) => p - r);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** The interquartile range, Q3 − Q1. */
export function iqr(xs) {
  if (xs.length === 0) return null;
  return quantile(xs, 0.75) - quantile(xs, 0.25);
}

// ------------------------------------------------------------------------------------------------
// The criteria
// ------------------------------------------------------------------------------------------------

/**
 * One measured quantity with its floor and its verdict.
 *
 * `direction` is `'min'` when the floor is a lower bound and `'max'` when it is a ceiling. Spelling
 * it out beats inferring from the name: W4 carries one of each.
 */
function measure(
  key,
  label,
  value,
  bound,
  direction,
  { insufficient = false, why = null } = {},
) {
  const status = insufficient
    ? "insufficient"
    : value === null
      ? "fail"
      : (direction === "min" ? value >= bound : value <= bound)
        ? "pass"
        : "fail";
  return {
    key,
    label,
    value,
    bound,
    direction,
    status,
    pass: status === "pass",
    insufficientReason: why,
  };
}

/**
 * A criterion's verdict, over three values rather than two.
 *
 * `insufficient` is not a third flavour of failure, it is the absence of a measurement: the subject
 * was outside the criterion's domain. The distinction is load-bearing — the v3 roster's six
 * one-card worlds are outside W2's and W3's domain, and scoring them as `fail` turns the matrix's
 * expected-GREEN row red against a renderer doing exactly what §3.1 asks, which is W5's stale-30
 * failure one criterion over.
 *
 * It is reported rather than skipped, and the gate prints how many planes landed here, because a
 * criterion that is silently not measured is how a gate comes to print green while measuring
 * nothing — the `verify-browser --dataset all` shape of failure §3.1 exists to prevent.
 *
 * `pass` stays a boolean for callers that only branch on success, and it is `false` here: an
 * unmeasured criterion has not passed. Anything deciding the *run's* verdict must read `status`.
 */
function criterion(id, title, measures, extra = {}) {
  const status = measures.some((m) => m.status === "fail")
    ? "fail"
    : measures.some((m) => m.status === "insufficient")
      ? "insufficient"
      : "pass";
  return { id, title, measures, status, pass: status === "pass", ...extra };
}

/**
 * **W1 — cells are resolvable at framing distance.**
 *
 * `planes` is one entry per world: `{ slug, cells: [{ height, frontFacing }] }`, measured at that
 * plane's own plane-level settle.
 *
 * The verdict is taken on the *worst* plane, not on the pooled median: "cells are resolvable" is a
 * claim about every world, and pooling lets 28 comfortable worlds carry one that is not. The Blind
 * Eternities is not a world and must not be in `planes` — it has cards but no cell sheet (§1.8), so
 * the statistic is undefined there and "every plane with cards" would wrongly make this 30.
 *
 * ## W1 has a domain too, and a plane outside it is not the worst plane (DEC-752, measured)
 *
 * **A plane with no front-facing cell has no median front-facing cell height.** That is the absence
 * of a measurement, exactly as §3.1's normative note already says for W2's four-sample floor and
 * W3's qualifying-pair rule — and W1 was left out of that note on reasoning that was about
 * *magnitude*: a one-cell world's cell is enormous, so it can never be the smallest. True, and
 * beside the point. The case that bites is a world whose cells are all **turned away** at the
 * measured azimuth, where the statistic does not exist at any size.
 *
 * It is not hypothetical and it is not rare. On the 45-world acceptance tour **six worlds reported
 * zero front-facing cells at the pose** — belenon, ergamon, gobakhan, moag, pyrulea and shandalar,
 * each holding 1 or 2 cards — while muraganda, regatha and segovia, also one-card worlds, happened
 * to present theirs. Which side a world falls on is a property of the azimuth it was sampled at,
 * not of the build: [[one-frame-of-a-moving-system-is-a-sample]], on the one criterion that had no
 * third verdict to report it with.
 *
 * The old reduce treated a `null` median as *smaller than every number*, so such a world became the
 * worst plane, carried a `null` into the measure, and `measure()` scores a missing value as `fail`.
 * **That is a red gate reporting a world whose cells were merely facing away** — and it outranks
 * and hides the real reading underneath it, which on this run was dominaria genuinely below the
 * floor at 17.45 px. A criterion that fails for two unrelated reasons and names only one is how a
 * gate spends a phase pointing at the wrong defect.
 *
 * So the worst plane is taken over the planes W1 is *defined* on, the undefined ones are counted
 * and named rather than dropped, and the criterion reports `insufficient` only if **no** plane
 * offered a median — which would mean the tour never saw a front-facing cell anywhere, a harness
 * failure and not a product verdict.
 */
export function evaluateW1(planes) {
  const perPlane = planes.map(({ slug, cells }) => ({
    slug,
    medianHeightPx: median(
      cells.filter((c) => c.frontFacing).map((c) => c.height),
    ),
  }));

  const measured = perPlane.filter((p) => p.medianHeightPx !== null);
  const undefinedPlanes = perPlane
    .filter((p) => p.medianHeightPx === null)
    .map((p) => p.slug);

  const worst = measured.reduce(
    (acc, p) =>
      acc === null || p.medianHeightPx < acc.medianHeightPx ? p : acc,
    null,
  );

  return criterion(
    "W1",
    "Cells are resolvable at framing distance",
    [
      measure(
        "minMedianCellHeightPx",
        `median front-facing cell height, worst of ${measured.length} of ${planes.length} worlds`,
        worst === null ? null : worst.medianHeightPx,
        FLOORS.cellHeightPx,
        "min",
        {
          // Only when *nothing* was measurable. One unmeasurable world among 44 measurable ones is
          // reported and stepped over; forty-five of them is the tour having gone wrong, and the
          // gate should say so rather than score it.
          insufficient: measured.length === 0,
          why:
            measured.length === 0
              ? `no plane presented a front-facing cell (${planes.length} planes toured)`
              : null,
        },
      ),
    ],
    {
      perPlane,
      worstPlane: worst === null ? null : worst.slug,
      // Named, not merely counted: which worlds fell outside the domain is the difference between a
      // sampling artefact and a build that has stopped drawing cells, and a bare count cannot tell
      // those apart.
      undefinedPlanes,
    },
  );
}

/**
 * **W2 — the mosaic reads as tiles, not as a wash.** T7's replacement.
 *
 * `samples` is `{ x, y, height, frontFacing, rgb }` per cell, `rgb` sampled from the capture at the
 * cell's centre. Cells shorter than 6 px are dropped: below that the centre pixel is as much grout
 * and neighbour as it is cell.
 *
 * "Nearest on-screen neighbour" is nearest by screen-space centre distance among the sampled set —
 * so a cell whose neighbours all fell under the height cut is compared against the nearest cell
 * that survived, which is the honest reading of a statistic about what is visible.
 *
 * Each sample carries `shade`, the scalar §1.4 already computes, because the lightness half is
 * measured over the **iso-shade subset** — see `W2_ISO_SHADE_TOLERANCE`. The gate may not re-derive
 * shade from the normal: it would then be asserting against its own model of the light rather than
 * against the shipped one.
 *
 * Below its domain a half reports `insufficient` rather than failing — **each half against the set
 * it is itself computed over, and against its own domain size**. The neighbour half walks the
 * sampled set and needs `W2_MIN_SAMPLES`; the lightness half is an IQR over the iso-shade ring and
 * needs `W2_MIN_RING_SAMPLES`, which is five times larger because a sliver-sized ring gives an IQR
 * that moves by half its own value between two runs of one build. See `isoThin` below.
 */
export function evaluateW2(samples) {
  const kept = samples.filter(
    (s) => s.frontFacing && s.height >= W2_MIN_CELL_PX,
  );
  const labs = kept.map((s) => srgbToLab(s.rgb));
  const thin = kept.length < W2_MIN_SAMPLES;
  const why = thin
    ? `only ${kept.length} sampled cells, below W2's domain of ${W2_MIN_SAMPLES}`
    : null;

  const neighbourDeltas = [];
  for (let i = 0; i < kept.length; i += 1) {
    let best = Infinity;
    let bestAt = -1;
    for (let j = 0; j < kept.length; j += 1) {
      if (i === j) continue;
      const d = (kept[i].x - kept[j].x) ** 2 + (kept[i].y - kept[j].y) ** 2;
      if (d < best) {
        best = d;
        bestAt = j;
      }
    }
    if (bestAt >= 0) neighbourDeltas.push(deltaE76(labs[i], labs[bestAt]));
  }

  // The iso-shade ring: cells within ±2.5% of the median shade. A tonemap is monotone and
  // per-channel, so it maps every cell in the ring identically and cannot reintroduce a gradient.
  const shades = kept.map((s) => s.shade);
  const medianShade = median(shades);
  const isoShade =
    medianShade === null
      ? []
      : labs.filter(
          (_, i) =>
            Math.abs(shades[i] - medianShade) <=
            W2_ISO_SHADE_TOLERANCE * medianShade,
        );

  // **The lightness half's domain is the iso-shade subset, and only that subset.** `thin` above
  // counts `kept`, which is the set the *neighbour* half walks; the lightness half is an IQR over
  // the ring, and the ring is a small fraction of `kept` by construction — ±2.5% of the median
  // shade is about 7% of the shade range §1.7's light spans, so a plane with a hundred sampled
  // cells offers a handful. Guarding the IQR on `kept` is a bound that cannot bind for it:
  // measured on the 45-world acceptance run, `kylem` scored `lightnessIqr` **0.020 against a floor
  // of 8 from two cells**, and `capenna`, `fiora` and `shenmeng` were scored from two or three —
  // four planes reddening W2 on a statistic with no domain, under a guard that read 21, 76, 31 and
  // 7 sampled cells and waved all four through. An IQR over two points is the spread of two points.
  //
  // Giving the half its own domain was the first half of the repair; **four was still too small a
  // domain to be one**, which the two acceptance runs then showed directly — see
  // `W2_MIN_RING_SAMPLES` for the table. Both fixes are the same finding at two magnitudes.
  //
  // The domain is `W2_MIN_RING_SAMPLES`, not `W2_MIN_SAMPLES`: four is where an IQR stops being a
  // gap between two points, twenty is where it stops moving between two runs of the same build.
  // The ruling `w2_ring` (DEC-816 R3) settles which of those a criterion is entitled to assert on.
  const isoThin = isoShade.length < W2_MIN_RING_SAMPLES;
  const isoWhy = isoThin
    ? `only ${isoShade.length} of ${kept.length} sampled cells lie within ` +
      `±${W2_ISO_SHADE_TOLERANCE * 100}% of the median shade, below the lightness half's domain ` +
      `of ${W2_MIN_RING_SAMPLES}`
    : null;

  return criterion(
    "W2",
    "The mosaic reads as tiles, not as a wash",
    [
      measure(
        "medianNeighbourDeltaE",
        "median ΔE to nearest on-screen neighbour",
        median(neighbourDeltas),
        FLOORS.neighbourDeltaE,
        "min",
        { insufficient: thin, why },
      ),
      measure(
        "lightnessIqr",
        `IQR of L* across the iso-shade subset (${isoShade.length} of ${kept.length} cells)`,
        iqr(isoShade.map((l) => l.L)),
        FLOORS.lightnessIqr,
        "min",
        { insufficient: thin || isoThin, why: why ?? isoWhy },
      ),
    ],
    {
      sampled: kept.length,
      isoShadeSampled: isoShade.length,
      isoShadeThin: isoThin,
      medianShade,
    },
  );
}

/**
 * **W3 — latitude reads as colour.**
 *
 * `samples` carries a `band` index into `BAND_ORDER`; `bandShares` is the plane's card share per
 * band index, and gates which pairs are compared — a band holding under 5% is too thin a stripe to
 * hold the criterion to.
 *
 * The verdict is the *worst* qualifying adjacent pair, because §3.1 says "for every such pair".
 */
export function evaluateW3(samples, bandShares) {
  const byBand = new Map();
  for (const s of samples) {
    if (!s.frontFacing) continue;
    if (!byBand.has(s.band)) byBand.set(s.band, []);
    byBand.get(s.band).push(srgbToLab(s.rgb));
  }

  const meanAb = new Map();
  for (const [band, labs] of byBand) {
    meanAb.set(band, {
      a: labs.reduce((t, l) => t + l.a, 0) / labs.length,
      b: labs.reduce((t, l) => t + l.b, 0) / labs.length,
    });
  }

  const pairs = [];
  for (const [i, j] of BAND_ADJACENCY) {
    if (!meanAb.has(i) || !meanAb.has(j)) continue;
    const smaller = Math.min(bandShares[i] ?? 0, bandShares[j] ?? 0);
    if (smaller < W3_MIN_BAND_SHARE) continue;
    pairs.push({
      bands: [i, j],
      classes: [BAND_ORDER[i], BAND_ORDER[j]],
      smallerShare: smaller,
      deltaE: deltaEab(meanAb.get(i), meanAb.get(j)),
    });
  }

  const worst = pairs.reduce(
    (acc, p) => (acc === null || p.deltaE < acc.deltaE ? p : acc),
    null,
  );

  return criterion(
    "W3",
    "Latitude reads as colour",
    [
      measure(
        "minAdjacentBandDeltaE",
        `ΔE(a*b*) of the closest of ${pairs.length} qualifying adjacent band pairs`,
        worst === null ? null : worst.deltaE,
        FLOORS.bandDeltaE,
        "min",
        {
          // Zero qualifying pairs is the criterion having nothing to say, not the criterion failing.
          // A one-card world populates a single band, so no adjacent pair exists to compare — and
          // "≥ 10 for every such pair" over an empty set is vacuous, which is neither red nor green.
          insufficient: pairs.length === 0,
          why:
            pairs.length === 0
              ? `no adjacent band pair holds ≥ ${W3_MIN_BAND_SHARE * 100}% on both sides`
              : null,
        },
      ),
    ],
    { pairs, worstPair: worst },
  );
}

/**
 * Evictions per second over the trailing window, from a timeline of the pool's cumulative counter.
 *
 * Separated out and named because the number Appendix A reports is **cumulative to the pose**, not
 * a rate: `tether-surface`'s 925 is every eviction since the camera started moving. §3.1 infers the
 * rate from "no sign of settling", which is an inference and not a measurement. W4's eviction half
 * is only red when a rate measured over this window says so, and the gate measures it here.
 *
 * `samples` is `[{ t, evictions }]`, `t` in seconds, cumulative counter, ascending.
 */
export function evictionRate(samples, windowS = W4_EVICTION_WINDOW_S) {
  if (samples.length < 2) return null;
  const end = samples[samples.length - 1];
  const cutoff = end.t - windowS;
  // The last sample at or before the cutoff, so the window is fully covered rather than clipped.
  let start = samples[0];
  for (const s of samples) {
    if (s.t <= cutoff) start = s;
    else break;
  }
  const span = end.t - start.t;
  if (span <= 0) return null;
  return (end.evictions - start.evictions) / span;
}

/**
 * The smallest pool capacity the renderer ever ships (§1.6, DEC-749).
 *
 * §1.6's clamp is `max(0, min(tierLayers, maxLayers - 32))`: tier 4 — the smallest rung — is 128,
 * and tiers 0-3 land on 224 at WebGL 2's spec-minimum `MAX_ARRAY_TEXTURE_LAYERS` of 256. Anything
 * below 128 is a harness, not a configuration a browser can be in.
 */
export const SMALLEST_SHIPPED_POOL_LAYERS = 128;

/**
 * **W4 — art resolves without exhausting.** At the surface view, 2.2× radius, after a 5 s settle.
 *
 * `cells` is `{ frontFacing, onScreen, wantsArt, showingArt }` — `wantsArt` meaning above the
 * *effective* threshold, which under the adaptive quantile of §1.6 is not 24 px. That denominator
 * is the substance of the criterion and the reason `?layers=128` is an expected-GREEN row: shrink
 * the pool and the threshold rises until demand matches capacity, so the ratio stays ≈ 1. Only
 * `?artThreshold=fixed24` starves the policy instead of the resource, and only that goes red.
 *
 * > **Normative (§3.1, DEC-749).** `pool` is **required**, and the verdict carries `poolLayers`,
 * > because the adaptive quantile is taken *relative to capacity*: a W4 count is only a reading of
 * > the renderer if the capacity it was taken at is one the renderer ships. This is not a
 * > hypothetical — the gate's own seam contract recorded `wantsArt && !frontFacing` as non-empty on
 * > 30 of 45 worlds without saying that 64 was the pool, and the same sweep reads 37/45 at tier 4
 * > and 42/45 at 224. An optional parameter would default the provenance back off, which is the
 * > defect, so it is positional and required.
 *
 * `belowShippedPool` marks the count as a reading of the harness. It deliberately does **not** move
 * the status: at 64 layers the policy still works and `artFraction` is still a true measurement of
 * it, so scoring it `insufficient` would call a real measurement absent. What it forbids is sourcing
 * a *reachability* claim — "this row has a subject on N worlds" — from a sub-shipped capacity.
 *
 * > **Normative — a dead art stream is `insufficient`, not `fail` (§3.1, DEC-752 → DEC-772).** See
 * > {@link streamNeverRan}. Measured on main `f049dca`, the art half reads a flat **0%** on every
 * > world at every pose under every seam, because the composition never supplies `cardOf` and the
 * > fetch is therefore unreachable. Scored as `fail` that is indistinguishable from a policy that
 * > genuinely exhausts — and worse, it makes *both* W4 matrix rows inert: the `fixed24`
 * > expected-RED row goes red for the wrong cause, and the `?layers=128` expected-GREEN row can
 * > never go green, so neither row can falsify the instrument. An instrument that reports RED on a
 * > frame it never measured is the same defect as one that reports GREEN, pointed the other way.
 */
export function streamNeverRan(wanting, pool) {
  // Required, not defaulted, for the same reason `pool` itself is a required positional: a missing
  // `resident` would make the comparison below `undefined === 0`, silently switching the guard off
  // and restoring exactly the false-RED it exists to prevent. The probe always reports it.
  if (typeof pool.resident !== "number") {
    throw new TypeError(
      "W4 needs pool.resident: without it the dead-stream guard silently passes",
    );
  }
  return pool.layers > 0 && pool.resident === 0 && wanting > 0;
}

/**
 * **Was the session's byte budget already spent before this world was ever asked for anything?**
 *
 * `stream` is the {@link ArtStreamReport} read at the *entry* to a world's visit, before the camera
 * flies to it. The stream declines a request once its budget is committed, and that budget is a
 * **backstop against a pathological session, not a per-frame one**. A per-world criterion read
 * after the session hit that cap is a reading of the *tour*, not of the world.
 *
 * > **Measured, and it is why this guard exists (45-world acceptance run, main `28ec706`).** Toured
 * > in one page, `bytesFetched` crossed 64 MiB at **capenna, the 8th world**. From `dominaria`
 * > onward every one of the remaining 37 worlds reported `showing` = **0** of up to 967 wanting,
 * > `declinedBudget` climbing to **3,046,465**, and W4 scored each a flat `fail` at `artFraction`
 * > 0 — 37 false REDs on a renderer that was behaving exactly as specified.
 * >
 * > **{@link streamNeverRan} does not catch this, and the reason generalises.** That guard asks
 * > whether anything is *resident*; a session that has spent its budget is still holding the
 * > layers it bought on the first seven worlds, so `pool.resident` is large, the guard passes, and
 * > the row reds. Two different mechanisms produce the same zero numerator, and a guard written
 * > against one of them says nothing about the other.
 *
 * **Entry, not exit — and that is what keeps W4's falsifier alive.** A world whose *own* demand
 * exhausts the budget within its own fresh session is a genuine W4 failure and must stay RED; only
 * spend carried in from earlier worlds disqualifies the reading. `?artThreshold=fixed24` starves
 * the policy inside one world, so it is untouched by this.
 *
 * **The predicate is READ, not recomputed, and that is the whole of it (DEC-820 rider 2).** The
 * question is "was this stream allowed to fetch", and the only thing that answers it without
 * asserting the gate's model of the policy against the shipped one is the renderer's own
 * `swatchOnly` flag (DEC-744 B1 / DEC-746 D5, the rule {@link readStream} states from the reading
 * side).
 *
 * > **This function used to recompute it, and the spelling it copied has since been retired
 * > TWICE.** It carried `bytesFetched + bytesReserved >= byteBudget` — correct when written
 * > (DEC-780), a defect after DEC-812. `bytesFetched` is a lifetime total that never decreases, so
 * > on a session that has begun evicting, the copied form calls the budget spent while the shipped
 * > stream is still happily fetching, and W4 would disqualify **healthy** worlds as "budget already
 * > gone" — the guard swallowing exactly the readings it exists to protect. The shipped quantity is
 * > `bytesOutstanding + bytesReserved >= byteBudget`: what the session still *holds*.
 * >
 * > It was inert when caught, and that is the uncomfortable part rather than the reassuring one.
 * > Across all 111 entry readings on record (accept3, accept4, controls1, order-fwd/rev and the
 * > DEC-820 reclaim control) the entry spend is 0 and `swatchOnly` is false, so both spellings
 * > returned false and no landed number moved. A stale copy of a policy is not discovered by the
 * > numbers it produces on a tour built to avoid the condition it gets wrong.
 *
 * Presence is still required rather than defaulted ({@link readStream}'s reason, DEC-782), but note
 * what it now buys: the three byte counts no longer enter the verdict at all — they are what the
 * disqualification message quotes — so an omission can no longer switch the guard off near a
 * boundary. It can only produce a report that says `undefined`. `swatchOnly` is the one field whose
 * absence would be silent, and it is a boolean, so there is no "nearly" for it to sit next to.
 */
export function budgetBoundAtEntry(stream) {
  if (typeof stream?.swatchOnly !== "boolean") {
    throw new TypeError(
      "W4 needs the entry stream report's swatchOnly: it is the renderer's own answer to whether " +
        "the stream was allowed to fetch, and re-deriving it from the byte counts is the DEC-812 defect",
    );
  }
  for (const key of ["bytesOutstanding", "bytesReserved", "byteBudget"]) {
    if (typeof stream[key] !== "number") {
      throw new TypeError(
        `W4 needs the entry stream report's ${key}: the disqualification message quotes it, and a tour's carried-over spend must be reported in the numbers that produced it`,
      );
    }
  }
  return stream.swatchOnly;
}

/**
 * The cells W4 scores: front-facing, on screen, and asking for art.
 *
 * > **Exported so there is exactly one spelling of it.** `?art=off`'s policy witness
 * > ({@link seamEvidence}) has to say "the cells still wanted art and the stream was asked for
 * > none", and the *still wanted* half is this predicate. A second copy over in the probe reader
 * > would be a re-derivation of a policy the renderer already reports — the DEC-812 defect rider 2
 * > removed from {@link budgetBoundAtEntry}, re-introduced one module over. The witness and the
 * > criterion must agree on which cells count, or `art=off` could read `wanting > 0` on a frame W4
 * > scores as wanting nothing.
 */
export function cellsWantingArt(cells) {
  return cells.filter((c) => c.frontFacing && c.onScreen && c.wantsArt);
}

/**
 * `entryStream` is the stream report read **before** the visit began — see
 * {@link budgetBoundAtEntry}. It is a required positional for the same reason `pool` is: defaulted,
 * it would default the guard off, and the guard off is the defect.
 */
export function evaluateW4(cells, evictionTimeline, pool, entryStream) {
  const wanting = cellsWantingArt(cells);
  const showing = wanting.filter((c) => c.showingArt);
  const dead = streamNeverRan(wanting.length, pool);
  const bound = budgetBoundAtEntry(entryStream);

  // Both mechanisms forbid an *admission*, and an eviction is the far end of an admission: a pool
  // that cannot take a layer in cannot push one out, so `evictionsPerSecond` is 0 by construction
  // and passing it would be scoring a number the reading could not have moved. Named separately
  // from `artFraction`'s reason so the report says which of the two produced the zero.
  const noAdmission = dead
    ? `the art stream never ran: ${wanting.length} cells want art and the pool has ${pool.layers} ` +
      `layers, but nothing is resident, so no layer was ever handed out. This is a setup failure, ` +
      `not a policy failure — see DEC-772.`
    : bound
      ? `the session's ${entryStream.byteBudget}-byte art budget was already committed before this ` +
        `world was visited (${entryStream.bytesOutstanding} outstanding + ` +
        `${entryStream.bytesReserved} reserved at entry, the renderer reporting swatchOnly), so ` +
        `every request here was declined for budget. This measures the tour, not the world — give ` +
        `each world its own session.`
      : null;

  // **An empty denominator is W4's domain, the same way four samples are W2's (DEC-752).** "The
  // fraction of cells above the effective threshold that show art" over no such cells is 0/0, not
  // 1, and `measure()` scores a bare `null` as a *failure* — so nine worlds on the 45-world
  // acceptance run were scored RED for presenting no front-facing cell at the sampled azimuth:
  // belenon, ergamon, karsus, muraganda, pyrulea, regatha, segovia, shandalar, zhalfir, eight of
  // them the same worlds W1 reports undefined for the same reason. W1's domain rule landed a
  // commit ago on exactly this evidence; this is that rule one criterion over.
  //
  // `foldCriteria` in the driver already skipped null-valued measures, so the *aggregate* read
  // "9 out of domain, dominaria failing" while each of those nine worlds carried a `fail` in its
  // own record — the report contradicting itself in a direction where only the quiet half was
  // right. The domain belongs here, with the criterion, where it is unit-testable.
  const empty = noAdmission === null && wanting.length === 0;
  const why =
    noAdmission ??
    (empty
      ? `of ${cells.length} cells reported, none is front-facing, on screen and above the ` +
        `effective threshold, so there is no set of cells for a fraction of them to show art`
      : null);

  return criterion(
    "W4",
    "Art resolves without exhausting",
    [
      measure(
        "artFraction",
        `cells above the effective threshold showing art (${showing.length}/${wanting.length})`,
        wanting.length === 0 ? null : showing.length / wanting.length,
        FLOORS.artFraction,
        "min",
        why === null ? {} : { insufficient: true, why },
      ),
      measure(
        "evictionsPerSecond",
        `evictions/s over the last ${W4_EVICTION_WINDOW_S} s`,
        evictionRate(evictionTimeline),
        FLOORS.evictionsPerSecond,
        "max",
        // **The empty denominator is not carried over to this half, and the asymmetry is the
        // point.** No demand says nothing about whether the pool churns: a world presenting no
        // front-facing cell can still be evicting the layers a neighbour's demand bought, and that
        // rate is a real reading of the policy. Only the two no-admission cases force this zero.
        noAdmission === null ? {} : { insufficient: true, why: noAdmission },
      ),
    ],
    {
      wanting: wanting.length,
      showing: showing.length,
      poolLayers: pool.layers,
      belowShippedPool: pool.layers < SMALLEST_SHIPPED_POOL_LAYERS,
      streamNeverRan: dead,
      budgetBoundAtEntry: bound,
      capacityCeiling: capacityCeiling(wanting.length, pool),
    },
  );
}

/**
 * The highest `artFraction` the pool could show, whatever the policy does (DEC-770 N1).
 *
 * A showing cell holds a layer, so a pool of `L` layers cannot show art on more than `L` cells at
 * once: the ceiling is `min(1, L / wanting)`. This is arithmetic about the capacity rather than a
 * reading of a frame, which is why it is reported on **every** W4 row and not only on the rows that
 * look starved — a ceiling is evidence about what the row could have said.
 *
 * > **Reported, and deliberately NOT wired to the verdict.** §3.1's floor is 0.9, and where this
 * > ceiling falls below it the floor is unreachable and the row reds a renderer that did nothing
 * > wrong. Lowering the floor to match is *not* a safe local fix, for two reasons. First,
 * > `?artThreshold=fixed24` produces exhaustion **on purpose** — 1,024 drawn against 2,759 wanted —
 * > and it is W4's only falsifier, so a rule that excused a starved pool would silently retire the
 * > control. Second, under the *adaptive* policy the threshold's whole job is to fit demand to
 * > capacity, so a ceiling below 1 there is a claim about the policy, and may be the very failure W4
 * > exists to catch. Which of the two a given row is cannot be settled from the arithmetic: it needs
 * > a live reading on the shipped rung, and DEC-770 N1's figures predate that rung existing at all
 * > (`setArtLayers` had zero callers until DEC-751, so every tier ran at 1,024 layers). Printing the
 * > ceiling beside the fraction is what lets that reading be taken without re-plumbing a gate run.
 */
function capacityCeiling(wanting, pool) {
  if (wanting === 0) return null;
  return Math.min(1, pool.layers / wanting);
}

/**
 * W5 needs at least this many distinct azimuths before reachability means anything.
 *
 * One frame is not a sweep, and the failure is silent in the dangerous direction: handed a single
 * azimuth, `everUnlabelled` degenerates into exactly the single-frame coverage count this criterion
 * exists to replace, and it reads as a *stronger* claim than it is. Twelve is the floor because the
 * v3 miss pattern has structure at the scale of the spiral's arms — at eight samples `karsus`
 * (labelled at 20.3% of azimuths) can be missed or caught by luck of the phase.
 *
 * The gate reports `insufficient` below it, never `pass` and never `fail`.
 */
export const W5_MIN_AZIMUTHS = 12;

/**
 * How far a sweep's azimuth spacing may drift from uniform, as a fraction of the ideal spacing.
 *
 * See `azimuthSpacingFault`. One percent is far tighter than any real sampler's float error and far
 * looser than the clustering the guard exists to refuse, so nothing lands near the boundary.
 */
export const W5_AZIMUTH_UNIFORMITY_TOLERANCE = 0.01;

/**
 * **A sweep must be evenly spaced around the turn, or reachability is not measuring the renderer.**
 *
 * `W5_MIN_AZIMUTHS` bounds *how many* samples a sweep has; this bounds *where they are*, and the
 * second is load-bearing in a way that is easy to miss. Reachability survives a sweep as sparse as
 * 12 only because the miss pattern has arc structure at the scale of the spiral's arms, and an
 * evenly-spaced comb crosses every arm. Scatter the same 12 samples at random and it stops working.
 *
 * Measured on `3ce85aed66e9dc3a` at 1920×1080, §1.8 suppression on, against the 360-azimuth hit
 * matrix (DEC-752). A sweep of N evenly-spaced azimuths is one of the 360/N phase offsets of that
 * grid, so every possible strided sweep can be enumerated rather than sampled:
 *
 * | sampling                 | N = 12          | N = 24        | N = 36 |
 * |--------------------------|-----------------|---------------|--------|
 * | evenly spaced (all phases) | **0 of 30**   | 0 of 15       | 0 of 10 |
 * | random (2,000 trials)      | **2.5%**      | 0.1%          | 0.0%  |
 *
 * Every one of those is a **false RED**: the renderer reaches all 45 worlds, and the sweep says it
 * does not. A gate that flakes 1 run in 40 gets its reds explained away, which costs more than the
 * criterion is worth. So uniformity is a precondition the gate checks, not a convention it hopes
 * its caller followed — and the check reports `insufficient`, never `fail`, because a badly sampled
 * sweep is the harness's defect and not the renderer's.
 *
 * Holds on both push arithmetics: pre-fix (0 of 30 at N = 12) and under DEC-751's separation
 * epsilon (0 of 30, and the weakest world rises from 28.3% of azimuths to 71.7%).
 *
 * Returns `null` when the spacing is fine, or the reason it is not.
 */
export function azimuthSpacingFault(
  azimuths,
  tolerance = W5_AZIMUTH_UNIFORMITY_TOLERANCE,
) {
  const turn = Math.PI * 2;
  const n = azimuths.length;
  if (n < 2) return null;

  // Fold onto [0, 2π) first: a sampler that walks past a full turn is still uniform, and a sampler
  // that reports negative angles is too. `%` keeps the sign in JS, so add a turn before folding.
  const sorted = azimuths
    .map((a) => ((a % turn) + turn) % turn)
    .sort((x, y) => x - y);

  const ideal = turn / n;
  const slack = ideal * tolerance;
  for (let i = 0; i < n; i += 1) {
    // The last gap wraps: it is what makes a comb covering only half the turn fail rather than read
    // as n−1 perfect gaps.
    const gap =
      i === n - 1 ? sorted[0] + turn - sorted[i] : sorted[i + 1] - sorted[i];
    if (Math.abs(gap - ideal) > slack) {
      return (
        `azimuths are not evenly spaced around the turn (gap ${gap.toFixed(4)} rad against an ` +
        `ideal of ${ideal.toFixed(4)}): a clustered sweep reads as reachability but is not — ` +
        `random 12-azimuth sweeps report a false unreachable world 2.5% of the time`
      );
    }
  }
  return null;
}

/**
 * **W5 — the home view is not a wall of labels, and every world is reachable from it.**
 *
 * Both halves are measured over a **sweep of azimuths**, not at one frame. `motion.ts:247` rotates
 * every plane by `multiverseAngle` each tick, so the home view is not a pose the harness can choose
 * — it is a one-parameter family the scene is continuously moving through, and any measure read off
 * a single frame is one draw from a distribution. Measured on `3ce85aed66e9dc3a` at 1920×1080,
 * fov 55, over 360 azimuths (DEC-752):
 *
 * | | v3 `3ce85aed` | v2 `dabe2c9a` |
 * |---|---|---|
 * | labels visible (post-suppression) | 33 – 42 | 33 – 43 |
 * | worlds labelled | 33 – 42 of 45 | 33 – 43 of 45 |
 * | worlds **never** labelled, any azimuth | **0** | **0** |
 *
 * The v3 column was taken on `3ce85aed66e9dc3a`, which leg P has since superseded with
 * `c9468f1125bcddff`. The hash is left as provenance rather than restamped, because restamping
 * would claim a measurement that has not been re-run — the sweep needs R1's renderer, which has not
 * landed. It carries over: DEC-749 confirms `rows` and `Σ rowCells` are identical on all 45 worlds
 * and only 116 of 777 rows moved *within* their world, so world centres, radii and therefore label
 * anchors are unchanged. What the move does invalidate is per-row figures, which this table has
 * none of. Re-run it against `c9468f11` at the acceptance run regardless (DEC-752, DEC-749 §4a).
 *
 * ## Why the ceiling is a suppression check and nothing more
 *
 * §1.8 leaves the moons unlabelled until hover, so after it lands the candidate list is the 45
 * worlds — the belt is filtered by slug and can never be labelled (see `homeLabelCeiling`). The
 * ceiling is 45 and at most 45 labels can exist, so it holds **360 of 360 azimuths, for every
 * renderer, by construction**. Its bound does not bind: a bound-check is vacuous when the bound
 * never binds.
 *
 * It is kept anyway, because it does bind on the one renderer that matters — the one where §1.8
 * has regressed. Unsuppressed, the same sweep reads **66 – 77 labels and fails 360 of 360**. So
 * `homeLabels` is a *regression check on the suppression rule*, not a measure of legibility, and
 * this is the honest name for it. Do not read a green `homeLabels` as evidence that the home view
 * is legible; it is evidence that the moons are quiet.
 *
 * ## Why coverage-at-a-frame is not the other half, and reachability is
 *
 * A ceiling is satisfied by rendering *fewer* labels and does not care **which**, so W5 needs a
 * second half that does. DEC-751 proposed a coverage floor — ≥ 90% of worlds labelled, or ≤ 4
 * missing. Over the sweep that floor is met at **17 of 360 azimuths (4.7%)** on the shipping
 * dataset: it scores a renderer doing exactly what §1.8 and §2.4 ask as RED at 95% of the frames
 * the harness might grab, and takes the matrix's expected-GREEN row with it. That is the third
 * instance of one defect — the stale 30, the 0.9 floor, and now this — and the shape is always the
 * same: a threshold read off one measurement of a moving system, then written down as a law.
 *
 * Coverage also does not buy the stability it was proposed for. Its whole argument was that it does
 * not care which worlds win, but the *count* of winners swings 33 – 42 across azimuth, a band as
 * wide as the label count's own. Changing which quantity is sampled does not stop it being a
 * sample.
 *
 * What is invariant under the rotation is **reachability**: whether a world is labelled at *some*
 * azimuth. It is the claim PRD 5.3.8 actually makes — every world reachable from home — it is 0
 * never-labelled on both datasets, and unlike a count it distinguishes "hidden this frame" from
 * "permanently lost", which is the defect a coverage cap cannot see.
 *
 * It is also falsifiable, on a seam the harness already owns: at 800×600 the same sweep leaves
 * `thunder-junction` unlabelled at **all 360 azimuths**. That is W5's coverage control, and it
 * needs nothing from R1 — see §3.1's matrix, where it closes the declared gap.
 *
 * ## The 800×600 control does not survive DEC-751's separation epsilon (DEC-752, measured)
 *
 * **This control has a known expiry, and it is not a hypothetical.** DEC-751 found PRD 5.3.10's
 * shift budget inert — the push lands on exactly the separating distance and `overlaps`' strict `<`
 * reads the float residual — and proposes a 0.01 px separation epsilon. Applying that epsilon to
 * the shipped solver on `dec751-r3-surfaces` @ `85bec45` and re-running the same 360-azimuth sweep:
 *
 * | 1920×1080, §1.8 on      | pre-fix | with epsilon |
 * |-------------------------|---------|--------------|
 * | labels (ceiling 45)     | 33 – 42 | **40 – 45**  |
 * | worlds never labelled   | 0       | 0            |
 * | weakest world           | `karsus` 28.3% | `thunder-junction` 71.7% |
 *
 * | 800×600, §1.8 on — **the control**  | pre-fix | with epsilon |
 * |-------------------------------------|---------|--------------|
 * | worlds never labelled               | **1** (`thunder-junction`, 0.0% of 360) | **0** |
 *
 * So the epsilon takes W5's only falsifier green, and the reachability half would be left with no
 * control at all — a criterion nothing can turn red. The replacement is the same seam pushed
 * further: at **320×240** the post-fix sweep leaves **five** worlds unlabelled at every azimuth
 * (`amonkhet`, `gobakhan`, `muraganda`, `shandalar`, `tolvada`). 640×480, 480×360 and 400×300 are
 * all still 0, so the row moves to 320×240 and not to the next size down from 800×600.
 *
 * The matrix must switch rows **when the epsilon lands, not before** — on today's tree 320×240 and
 * 800×600 are both red, but 800×600 is the honest one. Tracked as the open item on DEC-751's fix.
 *
 * ## The ceiling's population is the post-§1.8 list, which is what DEC-751's 66 – 85 is not
 *
 * DEC-751 reads **66 – 75 visible plane labels today and 75 – 85 under the epsilon**, against a
 * ceiling of 45, and raised it as a ruling that the ceiling is unreachable. It is the same sweep
 * counting a different population: theirs is the **pre-§1.8 candidate list of 87 planes**, and the
 * ceiling scores the **post-§1.8 list of 45 worlds**. Both arms, measured here on their own branch
 * through the shipped solver, 360 azimuths at 1920×1080:
 *
 * | candidates                    | pre-fix | with epsilon |
 * |-------------------------------|---------|--------------|
 * | 87 planes (today, pre-§1.8)   | 64 – 78 | 75 – 85      |
 * | 45 worlds (post-§1.8)         | 33 – 42 | 40 – 45      |
 *
 * §1.8 *is* the transform between the two rows, so the ceiling is never violated on the tree the
 * gate runs against and there is no ruling to make. What the epsilon does do is take the ceiling
 * from 3 labels of slack to **0** — 45 against a ceiling of 45 — which is tight but still cannot be
 * exceeded, since 45 candidates cannot produce 46 labels. The bound stays non-binding, and
 * `homeLabels` stays what it is named: a regression check on the suppression rule.
 *
 * `roster` and `minAzimuths` are required rather than defaulted, for the reason the 30 went stale:
 * a threshold that matters does not get to arrive as a default.
 *
 * @param sweep - one entry per sampled azimuth:
 *   `{ azimuth: number, labelCount: number, labelledWorlds: Iterable<string> }`.
 */
export function evaluateW5(sweep, roster, options) {
  const { worldsWithCards, minAzimuths } = options;
  const wanted = [...worldsWithCards];
  const samples = [...sweep];

  // Below the floor this is not a sweep, and reporting it as one would let a single frame wear
  // reachability's much stronger claim. `null` is what `measure` renders as `insufficient`.
  // Count is necessary but not sufficient: 12 samples bunched into one arm of the spiral flake red
  // 2.5% of the time on a renderer that reaches everything, so the spacing is checked too.
  const spacingFault = azimuthSpacingFault(samples.map((s) => s.azimuth));
  const enough = samples.length >= minAzimuths && spacingFault === null;
  const why =
    samples.length < minAzimuths
      ? `${samples.length} azimuth${samples.length === 1 ? "" : "s"} sampled, below the floor of ` +
        `${minAzimuths}: one frame is not a sweep`
      : spacingFault;

  // A label on a world outside the dataset's own world set is not coverage of anything — intersect,
  // so a renderer cannot buy reachability by labelling moons.
  const labelledAt = samples.map((s) => {
    const set = new Set(s.labelledWorlds);
    return wanted.filter((slug) => set.has(slug));
  });

  const everLabelled = new Set(labelledAt.flat());
  const neverLabelled = wanted.filter((slug) => !everLabelled.has(slug));

  // The ceiling's worst case over the sweep, which is the only reading a ceiling can honestly take.
  const worstLabelCount =
    samples.length === 0 ? null : Math.max(...samples.map((s) => s.labelCount));

  // Evidence, not a criterion: how often each world is actually legible. The floor on *this* is the
  // open ruling (v3's weakest is karsus at 20.3%, v2's is avishkar at 49.7%) and it is routed, not
  // guessed — picking it here is how the 0.9 happened.
  const shareLabelled = wanted
    .map((slug) => ({
      slug,
      share:
        samples.length === 0
          ? null
          : labelledAt.filter((l) => l.includes(slug)).length / samples.length,
    }))
    .sort((a, b) => (a.share ?? 0) - (b.share ?? 0));

  return criterion(
    "W5",
    "The home view is not a wall of labels, and every world is reachable from it",
    [
      measure(
        "homeLabels",
        `worst-case plane labels over ${samples.length} azimuths — a regression check on §1.8's ` +
          `suppression, not a legibility measure (ceiling ${homeLabelCeiling(roster)})`,
        enough ? worstLabelCount : null,
        homeLabelCeiling(roster),
        "max",
        { insufficient: !enough, why },
      ),
      measure(
        "worldsNeverLabelled",
        `worlds with cards carrying no visible label at any of ${samples.length} azimuths ` +
          `(${neverLabelled.length} of ${wanted.length})`,
        enough && wanted.length > 0 ? neverLabelled.length : null,
        0,
        "max",
        {
          insufficient: !enough || wanted.length === 0,
          why:
            wanted.length === 0
              ? "the dataset under test has no world with cards"
              : why,
        },
      ),
    ],
    // The gate prints these: "three worlds unreachable" is a number to argue with,
    // `thunder-junction` is a defect to fix. DEC-751's finding was only legible because it named them.
    {
      neverLabelledWorlds: neverLabelled,
      wantedWorlds: wanted.length,
      azimuths: samples.length,
      minAzimuths,
      weakestWorlds: shareLabelled.slice(0, 5),
    },
  );
}

/**
 * Fold one criterion measured on many planes into the criterion for the roster.
 *
 * W1 aggregates itself — its verdict is the worst plane, and `evaluateW1` takes every plane at
 * once. W2, W3 and W4 are per-plane, and §3.1 is explicit that they must stay that way: "a whole-
 * multiverse aggregate quietly averaging over them" is exactly what cannot catch a single
 * degenerate world. So the fold is a worst-case over planes and never a mean, and `insufficient`
 * is carried rather than counted as a pass — an `n/a` that is invisible is how a gate comes to
 * measure nothing while printing green.
 *
 * **It publishes its own denominator** (`scoredPlanes`), which `checkControlRow` prints. Carrying
 * only `insufficientPlanes` was the wrong half: after the ring domain landed (DEC-816 R3) W2's
 * lightness half folds off 2 of the 45 worlds, and a GREEN taken over two worlds must not print the
 * same line as a GREEN taken over forty-five.
 */
export function foldCriteria(perPlane) {
  const measured = perPlane.filter((entry) => entry.criterion !== null);
  if (measured.length === 0) return null;
  const first = measured[0].criterion;
  const keys = first.measures.map((m) => m.key);
  const measures = keys.map((key) => {
    const all = measured
      .map((entry) => ({
        slug: entry.slug,
        measure: entry.criterion.measures.find((m) => m.key === key),
      }))
      .filter((entry) => entry.measure !== undefined);
    const real = all.filter(
      (entry) =>
        entry.measure.status !== "insufficient" && entry.measure.value !== null,
    );
    const template = all[0].measure;
    if (real.length === 0) {
      return {
        ...template,
        value: null,
        status: "insufficient",
        pass: false,
        insufficientReason: `every plane was out of domain (${all.length} planes)`,
        worstPlane: null,
        insufficientPlanes: all.length,
        scoredPlanes: 0,
      };
    }
    // "Worst" is the direction the floor binds in: the smallest value under a `min` bound, the
    // largest under a `max` one. A fold that took the mean would let 44 comfortable worlds carry
    // one failing world over the line.
    const worst = real.reduce((a, b) =>
      template.direction === "min"
        ? b.measure.value < a.measure.value
          ? b
          : a
        : b.measure.value > a.measure.value
          ? b
          : a,
    );
    const failed = real.filter((entry) => entry.measure.status === "fail");
    return {
      ...worst.measure,
      status: failed.length > 0 ? "fail" : "pass",
      pass: failed.length === 0,
      worstPlane: worst.slug,
      failingPlanes: failed.map((entry) => entry.slug),
      insufficientPlanes: all.length - real.length,
      scoredPlanes: real.length,
    };
  });
  const status = measures.some((m) => m.status === "fail")
    ? "fail"
    : measures.every((m) => m.status === "insufficient")
      ? "insufficient"
      : "pass";
  return {
    id: first.id,
    title: first.title,
    measures,
    status,
    pass: status === "pass",
  };
}

/**
 * Check a run of criteria against what the negative-control matrix expects of it.
 *
 * `expect` names the measure a control is aimed at — `{ criterion: 'W2', measure:
 * 'medianNeighbourDeltaE', expect: 'RED' }` — rather than only the row's verdict, because §3.1's
 * conjunctions can go red on one half while the other half quietly never fails. A row asserted only
 * at criterion level would have recorded `?swatch=mean` as a working control for both halves of W2.
 * See this module's header.
 *
 * `expect: 'GREEN'` on a criterion with no named measure asserts the whole criterion passed, which
 * is what the two green rows want.
 *
 * `expect: 'N/A'` asserts the criterion was **out of its domain** — the one-card-world row uses it
 * on W2 and W3. Asserting the `n/a` is the point: without it, the sample-size precondition could be
 * widened later until it swallowed real planes and no row would notice. `N/A` is a distinct
 * expectation from GREEN precisely so that "not measured" can never be recorded as "measured and
 * fine", which is the failure mode the whole matrix exists to prevent.
 */
export function checkControlRow(
  criteria,
  { criterion: id, measure: key, expect },
) {
  const found = criteria.find((c) => c.id === id);
  if (found === undefined)
    return { ok: false, detail: `criterion ${id} was not run` };

  const subject =
    key === undefined ? found : found.measures.find((m) => m.key === key);
  if (subject === undefined)
    return { ok: false, detail: `${id} has no measure "${key}"` };

  const went =
    subject.status === "insufficient"
      ? "N/A"
      : subject.status === "pass"
        ? "GREEN"
        : "RED";
  const ok = went === expect;
  const what = key === undefined ? id : `${id}.${key}`;
  const value =
    went === "N/A"
      ? ` (${subject.insufficientReason ?? "out of domain"})`
      : key === undefined
        ? ""
        : ` (value ${subject.value}, bound ${subject.bound})`;

  // **The denominator of a folded verdict, printed next to it (DEC-816).** A multi-world measure is
  // the worst of the worlds *in domain*, and after R3's ring domain W2's lightness half is in domain
  // on 2 of 45. Without this, `W2.lightnessIqr went GREEN as expected (value 20.2, bound 8)` reads
  // identically whether it was folded off two worlds or forty-five — the report would be at its most
  // reassuring exactly where the evidence had thinned. The clause is driven off `scoredPlanes`,
  // which only `foldCriteria` sets, so a per-world criterion (the unit tests' shape) is unaffected
  // rather than gaining a fictional "1 of 1".
  // Suppressed on `N/A`, where `insufficientReason` already spells out "every plane was out of
  // domain (N planes)" — two spellings of one fact read as two facts.
  const domain =
    went !== "N/A" && typeof subject.scoredPlanes === "number"
      ? `, worst of ${subject.scoredPlanes} world${subject.scoredPlanes === 1 ? "" : "s"} in domain` +
        `${subject.worstPlane === null ? "" : ` (${subject.worstPlane})`}` +
        `${subject.insufficientPlanes ? `, ${subject.insufficientPlanes} out of domain` : ""}`
      : "";

  return {
    ok,
    detail: ok
      ? `${what} went ${expect} as expected${value}${domain}`
      : `${what} was expected ${expect} but went ${went}${value}${domain}`,
  };
}
