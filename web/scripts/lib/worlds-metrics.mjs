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
   * W3: the **roster mean** of the per-world closest adjacent-band ΔE(a\*b\*).
   *
   * **Derived on the mean fold, five sessions per arm (DEC-836, board ruling `fold_mean`).** The
   * fold this floor is taken over is {@link foldMean}'s, not the worst world's — the previous number
   * (0.55) was derived against a fold the board retired, and the retraction that killed it is kept
   * below because its lesson is the reason this one is measured the way it is.
   *
   * Both arms are full 45-world tours at the 2.2-radii pose, 28 worlds in W3's domain in every one of
   * the **fourteen**, **0 dropped**, measured on leg G `f821ccd` (the mean fold is gate-side and
   * offline, so these readings do not depend on it). Seven passes per arm, not five: at n=5 the
   * control's three highest draws were its three most recent, and a trend that would have swallowed
   * the floor is exactly the kind of thing the retracted 0.55 was killed for not checking. Passes 6
   * and 7 read 2.8762 and 2.8013 — the trend was not there.
   *
   * | arm | seven session means | binds |
   * |---|---|---|
   * | `?art=off` — `w3-floor-shipped` | 3.3102 / 3.4558 / 3.4493 / 3.3982 / 3.3696 / 3.3359 / 3.3062, spread **1.05x** | floor <= the **min**, 3.3062 |
   * | `?art=off&bands=shuffle` — `w3-floor-control` | 2.7835 / 2.8203 / 2.9467 / 2.9058 / 2.9587 / 2.8762 / 2.8013, spread **1.06x** | floor > the **max**, 2.9587 |
   *
   * The interval is **(2.9587, 3.3062]** and **3.1** sits inside it: 4.8% above the control's
   * worst-case reading, 6.2% below the build's. Two significant figures on purpose — a third would
   * claim precision the session spread does not support, and the interval is only 0.35 wide.
   *
   * **The bounds are the arms' extremes across five sessions, not any single session's pair.** That
   * is the discipline the retracted floor lacked: pass 1 alone would have read (2.7835, 3.3102] and
   * a floor that looked 11% clear of a control it is really 4.8% clear of.
   *
   * ### What this floor does not claim, each measured
   *
   * 1. **4.8% is thin, and it is thin because of the control rather than the build.** A permutation
   *    moves most worlds down and some up, and a *mean* dilutes it — 6 to 10 of the 28 worlds score
   *    **higher** shuffled, depending on the pass. Under the retired min fold the arms were further
   *    apart per world and still **overlapped** as aggregates; under the mean they sit closer and
   *    **separate**, because both are now stable. Reproducibility is what bought the separation.
   * 2. **The median would separate these arms by more** — 1.9713–2.4190 against 1.3810–1.5529, a
   *    1.27x gap where the mean's is 1.12x — at a spread of 1.23x against the mean's 1.05x. Recorded
   *    as evidence for the next refresh, not as a re-litigation: the board ruled the mean on
   *    stability and this leg implements the ruling.
   * 3. **`?bands=shuffle` is one permutation, seeded by a constant** (`shufflePermutation`,
   *    `0x9e3779b9`). It reproduces exactly, which proves the route is deterministic and not that the
   *    value is the statistic. A floor derived over several seeds would be a stronger object.
   * 4. **It is a property of the shipped swatches, so a refresh can invalidate it** without a line of
   *    rendering code changing — and so can a change to W3's domain, which is why
   *    {@link W3_DOMAIN_SIZE} is scored rather than reported. The runbook's §4.3 says when to
   *    re-derive, and that five passes per arm is the minimum.
   *
   * The unmodified build clears this comfortably: the bare acceptance tour's mean reads **3.98–4.34**
   * over its own five sessions, ~20% above the `?art=off` arm the floor is derived from. The floor is
   * derived on that sibling rather than on the bare build because it is the arm the control differs
   * from by exactly one seam.
   *
   * ### The retracted floor, kept because its lesson is why this one is measured over sessions
   *
   * 0.55 was derived on the **worst-world** fold from one acceptance tour (0.7070, ravnica) against a
   * four-session dominaria control (0.4195–0.4477). At n=5 that fold drew
   * **0.4253 / 0.4358 / 0.5375 / 0.7070 / 0.8005** on one unchanged dataset, one roster, one domain
   * and one pose — a **1.88x** spread with 0.55 inside it, scoring **three different worlds**
   * (innistrad, ravnica, avishkar). The shipped arm's lowest sat *below* the control's highest: the
   * arms **overlapped**, which is `w3-floor.mjs`'s "no separating floor exists" outcome, and the
   * DEC-816 impasse reproducing rather than retiring.
   *
   * **The mechanism was the fold, not the renderer.** A minimum over the in-domain worlds of a
   * per-world minimum falls as the population grows: truncated to the first 8 worlds the same dataset
   * reads 1.3499/1.3926 over 5 in-domain planes, and over all 28 it reads 0.25–0.80. Re-scoring those
   * same per-world readings gave mean 1.09x, median 1.22x, p25 1.38x, p10 2.37x. Re-checked here on
   * two arms it was never chosen from, at n=7: mean **1.05x** and **1.06x**, min **2.40x** and
   * **4.02x** — and the control arm's min was 1.82x at n=5, which is the "a ranking taken at one n is
   * not a ranking" lesson landing a second time, on the fold that was retired for it.
   */
  bandDeltaE: 3.1,
  /** W4: fraction of cells above the effective threshold that are showing art. */
  artFraction: 0.9,
  /**
   * W4: the floor `artFraction` must clear **however small the pool's ceiling is** — the second
   * term of `max(FLOORS.artFraction × ceiling, this)`. See {@link reachableBar}.
   *
   * **Ruling `absolute_floor`** (board card `74114193`, 2026-09-16), closing the vacuity
   * `floor_times_ceiling` opened: without it, a saturated pool passes at every capacity, because
   * `artFraction == ceiling` exactly there and the bar is a fixed fraction of that same ceiling.
   *
   * ## What the 0.5 means, stated as the claim it makes rather than as a number
   *
   * On a saturated pool `artFraction == ceiling == 1 / (wanting / layers)`, so the row passes iff
   * `wanting / layers <= 1 / 0.5`. **The absolute floor is exactly the rule "demand may exceed pool
   * capacity by at most 2×"** — it gives `demandFitsCapacity`, which ruling `demand_measure_scored`
   * left `reported_only`, a scored bound of 2× on the frames where the pool is the constraint. That
   * equivalence is the reason this number is defensible and not a taste, and it is pinned by a test.
   *
   * The board's interval was (0.371, 0.610]: above Appendix A's `tether-surface` capture, which must
   * red, and at or below tier 4's measured 0.610, which must green. In overshoot terms that is
   * [1.64×, 2.69×), and 2× is the round number inside it — 21% clear of the control below, 25% clear
   * of the shipped rung above. Do not read the 0.5 as calibrated more finely than that.
   */
  artFractionAbsolute: 0.5,
  /**
   * W4: evictions per second on the **fill-excluded tail**, at the shipped 1,024-layer pool alone.
   * A ceiling, not a floor.
   *
   * **Ruling on DEC-833 card `bd5c9aad`, option (a), accepted 2026-09-17.** The published 5/s was
   * not a bound the shipped renderer could ever meet, and the reason is structural rather than a
   * matter of tuning.
   *
   * ## `evictions == requested` is an identity, so this bounds want-set turnover
   *
   * `pool.evictions` is incremented in exactly one place — `artPool.ts`'s `claimLayer` — whose only
   * caller is `reserve`, and only on the `byKey.get(key) === undefined` path, which is the same path
   * that reaches `requested += 1` in `artStream.ts`. **Every eviction therefore carries exactly one
   * request, by construction.** Measured equal *to the unit* over three nested windows of a 120 s
   * dominaria baseline — 1,647/1,647, 1,064/1,064, 533/533 — and 405/405 at a 128-layer pool
   * (DEC-834).
   *
   * What follows is that this number is not a measure of waste. For an LRU smaller than its working
   * set, eviction rate == admission rate == the rate at which the want set turns over, and on
   * dominaria the want set turns over because **the world spins**: 6,271 cards into 1,024 layers,
   * `spinPeriodS` 262.592, so 4,750 cells — 75.8% of the roster — cross the admission boundary every
   * revolution. Of 1,946 distinct keys asked over 60 s, 1,689 were asked exactly once and none more
   * than three times: no path re-asks for a resident cell (DEC-833's `?probe=shell` measurement,
   * confirmed by DEC-834).
   *
   * **So 5/s was unreachable from the request loop.** Meeting it needed a 3.6× slower spin, a 72%
   * roster cut, or a pool of ~4,750 layers against a GPU-bound 1,024 — three product changes, none of
   * them a defect in the stream.
   *
   * ## Where 21 comes from, and what still trips it
   *
   * Steady-state turnover measured **18.1–18.5/s** over six long runs plus DEC-834's two extra arms.
   * 18.1 × 1.15 ≈ 21. The 1.15 margin is deliberate and it is small: a real regression — a spin
   * speedup, a roster that grows, a stream that starts re-asking — moves this number by much more
   * than 15%, and the identity above means a re-asking stream shows up here at once.
   *
   * **It is not derived from the run it scores.** The 18.1–18.5 readings are
   * `worlds-evict-longrun.mjs`'s, taken over 120–150 s on a parked page; the gate scores its own
   * tour's tail. A bound fitted to the tour it grades is not a bound.
   *
   * ## Two things the ruling scoped, which are domain and not arithmetic
   *
   * - **The 1,024-layer pool alone** — see {@link W4_EVICTION_POOL_LAYERS}. At `?layers=128` the rate
   *   is 6.73/s, and it gets there only by destroying the picture: `artFraction` falls to ~0.617 with
   *   ~4,670 wants/s refused for exhaustion. Shrinking the pool moves this number toward any bound
   *   you like, so requiring both rungs to hold it selects **disjoint configurations** and the two
   *   halves of W4 could never be green together.
   * - **The fill-excluded tail** — see {@link evictionTail}. A cold pool's first 1,024 admissions are
   *   not churn, and a window that contains them is measuring page load.
   */
  evictionsPerSecond: 21,
  /**
   * W4: the **absolute** number of cells showing art a frame must reach, where the frame has that
   * many front-facing on-screen cells to offer at all.
   *
   * **This is the no-starvation term ruling `bd5c9aad` (N2) put in place of a fraction, and the
   * witness is why.** At `?layers=128` under reduced motion the adaptive threshold rose until the
   * want set held **14 cells**; all 14 showed art, so `showing == wanting` and `artFraction` read
   * **1.00** — *better* than the healthy baseline's 0.9968 — on a frame showing fourteen cells of art
   * out of some two thousand on screen. A ratio cannot see its own denominator collapse, and
   * `artFraction`'s denominator is chosen by the very policy W4 is grading. See
   * `a-ratio-is-blind-to-its-own-denominator`.
   *
   * ## Why 64, and why it is a constant rather than a function of the pool
   *
   * 64 is `SMALLEST_SHIPPED_POOL_LAYERS / 2`, fixed here at write time: *a frame with enough cells to
   * fill the smallest pool the renderer ships must be drawing art in at least half that many.* It is
   * deliberately **not** re-derived per run from `pool.layers` or from `wanting`, because both are
   * outputs of the policy under test — a bound computed from the measured quantity passes at every
   * input, which is the vacuity `absolute_floor` was raised to close one measure over
   * (`a-bound-derived-from-the-measured-quantity-cannot-bind`).
   *
   * It sits between the two readings it has to separate, with room on both sides: **4.6× above** the
   * 14-cell witness that must red, and **~2× below** the healthy tier-4 rung (≈126 of 205 cells
   * showing art at 128 layers with motion on, DEC-834) that must stay green. The shipped 1,024-layer
   * baseline reads ~942 and is nowhere near it.
   *
   * The domain is the frame's **geometry** — how many cells are front-facing and on screen — and
   * geometry is not something the art policy gets a vote on. A one-card world offers one cell and is
   * out of domain; it is scored by W1 and by `artFraction`, both of which are defined at n = 1.
   */
  artCellsAbsolute: 64,
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
 * How many worlds a dataset puts in W3's domain — **the denominator its mean fold is taken over.**
 *
 * Board ruling `fold_mean` makes W3 a roster statistic, and a mean is the one fold that a narrowed
 * domain moves in the flattering direction: drop the worst worlds and it rises. So the denominator
 * has to be an expectation the run is scored against, not a count the run reports about itself.
 *
 * **It is a dataset property and it is not derivable from `planes.json`.** A world is in W3's domain
 * when some adjacent band pair holds ≥ {@link W3_MIN_BAND_SHARE} on both sides, and band shares come
 * from the plane's per-hue card counts, which live in the shards rather than the roster file. So
 * this is recorded per dataset hash and carries its provenance with it:
 *
 * **Two numbers, because the domain has two gates and they do not agree** — which is a measured fact
 * and was very nearly a shipped defect. `byShares` counts the worlds whose *cards* give some adjacent
 * band pair ≥ {@link W3_MIN_BAND_SHARE} on both sides; `scored` counts the worlds that then present
 * **both of those bands in the sampled cells** at the pose. On `c9468f1125bcddff` those are **30 and
 * 28**: `shenmeng` (30 cells) and `zhalfir` (4 cells) qualify on their card distribution and populate
 * a single band on screen, so W3 has no pair to compare and reports `insufficient`. A first draft of
 * this record asserted the two counts were equal; the first full tour that ran it went RED on every
 * roster row, including the acceptance row. `byShares` is an **upper bound** on `scored`, never a
 * substitute for it.
 *
 * - **`c9468f1125bcddff` — `scored` 28 of 45, `byShares` 30 of 45.** 28 in domain on five full-roster
 *   baseline sessions (`accept3`, `dec826-bare`, `accept4`, `rebase-w3b`, `rebase-w3c`) and on all
 *   fourteen arms of the DEC-836 floor derivation — **0 dropped, the same 28 slugs every time.**
 *
 * A constant cannot testify to its own provenance, so neither of these is left alone with itself.
 * `scored` catches a tour that visited too few worlds, or a world that lost a band at the pose —
 * which the run's own data cannot, because eight worlds toured would report eight of everything.
 * `byShares` is a **pure function of the dataset** ({@link w3QualifiesByShares} reads band shares and
 * nothing else), so it is deterministic per refresh and catches the dataset moving under the record
 * even where the scored count happens to land on 28 again. Neither is redundant.
 *
 * An unrecorded dataset is **not** a skipped check: `foldMean` fails, because a floor derived on one
 * roster says nothing about a mean taken over another.
 */
export const W3_DOMAIN_SIZE = Object.freeze({
  c9468f1125bcddff: Object.freeze({ scored: 28, byShares: 30 }),
});

/**
 * Whether a plane's band shares alone put it in W3's domain, before a single pixel is sampled.
 *
 * The domain has two conditions — the pair must qualify by share, and both its bands must actually
 * turn up in the samples — and only the first is a property of the dataset. Separating them is what
 * lets the gate tell "this world has no comparable band pair" (a dataset fact, stable) from "this
 * world's band was not sampled at this pose" (a run fact, and a thinning of the mean's domain).
 *
 * `bandShares` is the thirteen-entry table the probe publishes, indexed like {@link BAND_ORDER}.
 */
export function w3QualifiesByShares(bandShares) {
  return BAND_ADJACENCY.some(
    ([i, j]) =>
      Math.min(bandShares?.[i] ?? 0, bandShares?.[j] ?? 0) >=
      W3_MIN_BAND_SHARE,
  );
}

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

/**
 * The shortest span, in seconds, W4's eviction rate may be differenced over.
 *
 * §3.1 published this as "evictions per second over the last 2 s" — the *whole* window, taken at the
 * pose. Ruling `bd5c9aad` (option (a)) moved the measurement to a fill-excluded tail
 * ({@link evictionTail}), so 2 s is no longer the window: it is the floor below which a tail is too
 * short for a rate to mean anything, and a run that cannot clear it reports `insufficient` rather
 * than a number. One sample dressed as a rate is the error DEC-835 found in the long-run's own
 * fill detector, and it must not be reintroduced here.
 */
export const W4_EVICTION_WINDOW_S = 2;

/**
 * The pool capacity W4's eviction half is scored at — **the shipped one, and only it**.
 *
 * Board ruling on DEC-833 card `bd5c9aad`, option (a): the bound is "turnover-derived at the shipped
 * pool", and the scope is half of the ruling rather than a footnote to it. At `?layers=128` the rate
 * is 6.73/s against the 21/s written here, so a naive reading says tier 4 passes comfortably — but it
 * gets there by refusing ~4,670 wants/s for exhaustion and dropping `artFraction` to ~0.617
 * (DEC-834). **The two halves of W4 select disjoint configurations:** every pool small enough to make
 * the eviction number look good is too small to show the art the other half requires. Scoring both
 * rungs against one bound asks for a configuration that does not exist.
 *
 * Any other capacity is `insufficient`, not green. A rate measured at a capacity the bound was not
 * derived at is a real reading of a different question, and recording it as a pass is how a bound
 * stops binding (`narrowing-a-domain-silently-thins-an-unchanged-verdict` in its mirror form).
 */
export const W4_EVICTION_POOL_LAYERS = 1024;

/** A tail shorter than this many samples cannot be split into halves and scored for convergence. */
export const W4_EVICTION_MIN_TAIL_SAMPLES = 5;

/**
 * How far the tail's own second half may sit from the whole tail before the tail is called settled.
 *
 * The long-run instrument uses 2% on a byte rate differenced over 150 s. This is looser on purpose:
 * it scores an integer counter over a tail measured in tens of seconds, where one sample of
 * quantisation is already worth more than 2%. 10% is well inside the margin the bound itself carries
 * (18.1 → 21 is 15%) and well outside the drift a fill leaves behind — the 60 s baseline DEC-835
 * measured declined 5.4% *monotonically* across its tail and would be caught by this.
 */
export const W4_EVICTION_TAIL_CONVERGENCE = 0.1;

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
 *
 * ## `scored: false` — a measure that is reported and does not decide a colour (DEC-752)
 *
 * The board's `demand_measure_scored` ruling (`reported_only`, card `2e92df81`) asks for a measure
 * that carries a value, a bound and a verdict into the report while leaving the row's colour to its
 * siblings. That is a third thing, and it is deliberately *not* spelled as `insufficient`:
 * `insufficient` says "this was not measured", and the whole point of a reported-only measure is
 * that it **was** measured and is being shown.
 *
 * It is a property of the measure rather than a filter at the call site so that the fold
 * ({@link foldCriteria}) and the matrix ({@link checkControlRow}) cannot disagree with the
 * per-plane verdict about which measures count — one flag, read in all three places. A control row
 * may still name an unscored measure explicitly in `expect`, which is how the overshoot it reports
 * stays falsifiable even though it cannot red a row on its own.
 */
function measure(
  key,
  label,
  value,
  bound,
  direction,
  { insufficient = false, why = null, scored = true, fold = "worst" } = {},
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
    scored,
    // How {@link foldCriteria} aggregates this measure across planes. `'worst'` everywhere but W3,
    // whose board-ruled mean lives in {@link foldMean}. It is a property of the measure rather than
    // a branch in the fold so that the one place that decides W3 is the one place that says so, and
    // a second mean-folded measure needs no second branch.
    fold,
    pass: status === "pass",
    insufficientReason: why,
  };
}

/**
 * The measures that decide a verdict: everything but the reported-only ones.
 *
 * One spelling, used by both {@link criterion} and {@link foldCriteria}, because a per-plane row and
 * the roster fold disagreeing about which measures count is a report that contradicts itself — the
 * shape the W4 domain rule was landed to fix one criterion over.
 */
function scoredMeasures(measures) {
  return measures.filter((m) => m.scored !== false);
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
  const scored = scoredMeasures(measures);
  const status = scored.some((m) => m.status === "fail")
    ? "fail"
    : scored.some((m) => m.status === "insufficient")
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
          // **The roster fold is the mean, by board ruling `fold_mean`** — see {@link foldMean}.
          // This plane's own reading is unchanged by that ruling: still the closest of its
          // qualifying adjacent pairs. What changed is one level up.
          fold: "mean",
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
 * How close the pool came to having no free layer, over the window {@link evictionRate} scored.
 *
 * **This is the eviction rate's denominator, and without it a `0` is not a reading.**
 * `artPool.claimLayer` walks the pool for a FREE layer and only looks for a victim when it finds
 * none, so `pool.evictions` cannot move until occupancy reaches `layers`. A pool that never filled
 * therefore reports `0` evictions *by construction* — the same structural zero the criterion already
 * names for `streamNeverRan` and `budgetBoundAtEntry`, arriving by a third route that nothing was
 * reporting. Dominaria's four recorded runs separate on this and on nothing else:
 *
 * | occupancy at read | `evictionsPerSecond` |
 * | --- | --- |
 * | 701 / 1024, 704 / 1024 | 0 |
 * | 965 / 1024 | 0 |
 * | **1020 / 1024** | **18.357** |
 *
 * **`saturated` is a NECESSARY condition, never a sufficient one — it says the reading *could* have
 * moved, not that it should have.** `claimLayer` runs only on an admission, so a full pool with no
 * new key to admit evicts nothing. Measured, not argued: at `?layers=128` the adaptive threshold
 * rises to 37.82 px, demand collapses to 14 cells that are already resident, and the pool sits at
 * **128/128 with `evictions` flat at 0 for 150 s**. Reading `saturated` as "should have churned"
 * would score that row backwards.
 *
 * **It is a lower bound, deliberately, and that is why it is reported and not scored.** Occupancy is
 * `resident + reserved`; `?probe=` publishes only `resident`, so a pool sitting at `layers` with a
 * reserved layer in flight reads below `layers` here. Scoring an `insufficient` off a bound that can
 * read low would mark a real reading absent. Promoting it to a domain rule needs `pool.reserved` on
 * the probe, which is R1's surface (DEC-744 B1) and the live half of ask `62f32092`.
 *
 * `samples` is {@link evictionRate}'s timeline with `resident` and `layers` alongside. Returns
 * `null` for an empty timeline — a pool never read and a pool holding nothing are different facts.
 */
export function poolHighWater(samples) {
  const usable = samples.filter(
    (s) => typeof s.resident === "number" && typeof s.layers === "number",
  );
  if (usable.length === 0) return null;
  const resident = Math.max(...usable.map((s) => s.resident));
  // The capacity is a property of the GPU tier and does not move within a visit; the max is taken
  // for the same reason the resident one is, so a timeline that somehow straddles a change reports
  // the larger denominator rather than silently picking the first sample's.
  const layers = Math.max(...usable.map((s) => s.layers));
  return { resident, layers, saturated: layers > 0 && resident >= layers };
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
 * W4's eviction rate, measured on the **fill-excluded tail** and scored for its own convergence.
 *
 * Board ruling on DEC-833 card `bd5c9aad`, option (a). A cold pool's first `layers` admissions are
 * page load, not churn, and a window containing them reports the two added together. The shape of
 * the repair is lifted from `worlds-evict-longrun.mjs`, which DEC-835 had to fix for the same reason.
 *
 * ## The fill is the climb to SATURATION, and below saturation there is nothing to exclude
 *
 * Two wrong detectors were written before this one, in opposite directions, and both are worth
 * keeping because each is the obvious rule for one half of the roster.
 *
 * **"Resident stops climbing" is wrong on a pool that saturates.** A saturated pool churns, so
 * `resident` ticks 1023 → 1024 → 1023 forever and the last upward tick lands in the final seconds.
 * On a 60 s baseline that put the fill's end at **t = 57.1 s**, leaving a two-row "steady state" —
 * one sample dressed as a rate (DEC-835).
 *
 * **"The first sample holding `max(resident)`" is wrong on a pool that does not.** Below saturation
 * `claimLayer` always finds a free layer, so nothing is ever evicted and nothing ever leaves the
 * pool: `resident` is monotonically non-decreasing, `max(resident)` is simply *the last sample*, and
 * the tail collapses to whatever run of equal values the window happened to end on. Measured on the
 * first live tour that ran it: **alara plateaued at t = 42.5 s of a 45 s window and was scored off a
 * 2.0 s, two-sample tail** — the identical defect as the rule it replaced, arriving from the other
 * side, and one sample of jitter from dropping the world out of W4's domain entirely.
 *
 * The rule that is right on both is written from what the counter can physically do. **`claimLayer`
 * walks the pool for a FREE layer and only looks for a victim when it finds none, so below
 * saturation `pool.evictions` cannot move at all.** There is therefore no fill transient *in this
 * counter* to exclude on an unsaturated pool — the zero is structural for the whole window, and the
 * whole window is the tail. The fill this function excludes is specifically the **climb to
 * saturation**: the one interval during which eviction goes from impossible to possible.
 *
 * > **This is deliberately not the same rule as `worlds-evict-longrun.mjs`'s, and the difference is
 * > the subject.** That script differences *bytes*, which keep flowing on an unsaturated pool, so
 * > its fill really does end at the demand plateau and `max(resident)` is right there. This one
 * > differences a counter that is pinned to zero until the pool is full. Two instruments, two fills.
 *
 * ## Excluding the fill is necessary and it is not sufficient
 *
 * The same 60 s run read 1,461 KiB/s differenced from t = 6, 1,445 from t = 18 and 1,382 from t = 36:
 * a monotone decline *after* the pool had every layer it would hold. Quoting the earliest of those as
 * "sustained" is the same error as quoting the whole window, one order smaller. So the tail is scored
 * against **its own second half**, and a tail that has not settled reports that instead of a number.
 *
 * Returns `{ rate, halfRate, drift, converged, peakResident, plateauT, tailSamples, spanS, why }`.
 * `rate` is `null` — with `why` saying which condition failed — when the timeline is too short, when
 * the plateau leaves too few samples behind it, when the tail spans less than
 * {@link W4_EVICTION_WINDOW_S}, or when it has not converged. **A `null` here is a domain fact and
 * never a zero:** a pool that was never read and a pool that churned nothing are different findings,
 * and the criterion reports them differently.
 *
 * `samples` is {@link evictionRate}'s timeline: `[{ t, evictions, resident }]`, `t` in seconds,
 * `evictions` cumulative, ascending.
 */
export function evictionTail(
  samples,
  {
    minTailSamples = W4_EVICTION_MIN_TAIL_SAMPLES,
    minSpanS = W4_EVICTION_WINDOW_S,
    convergence = W4_EVICTION_TAIL_CONVERGENCE,
  } = {},
) {
  const empty = {
    rate: null,
    halfRate: null,
    drift: null,
    converged: false,
    peakResident: null,
    plateauT: null,
    tailSamples: 0,
    spanS: 0,
  };
  const usable = samples.filter(
    (s) =>
      typeof s.t === "number" &&
      typeof s.evictions === "number" &&
      typeof s.resident === "number" &&
      typeof s.layers === "number",
  );
  if (usable.length < minTailSamples) {
    return {
      ...empty,
      why:
        `the eviction timeline holds ${usable.length} usable sample(s) and a fill-excluded tail ` +
        `needs at least ${minTailSamples}: each sample must carry t, evictions and resident and ` +
        `layers, because the fill is the climb to saturation and is read off occupancy against ` +
        `capacity, never off the counter`,
    };
  }

  // `poolHighWater` already answers "did this pool ever have no free layer", and it is the same
  // question the fill rule turns on — so it is read here rather than re-derived. A second spelling
  // of `saturated` in this file is a second thing to keep in step.
  const { resident: peakResident, saturated } = poolHighWater(usable);
  // Saturated: the fill is the climb, so the tail opens at the first sample with no free layer.
  // Unsaturated: `claimLayer` never reached its victim search, the counter is pinned at 0 for the
  // whole window, and there is no fill *in this counter* to exclude.
  const tail = saturated
    ? usable.slice(usable.findIndex((s) => s.resident >= s.layers))
    : usable;
  const spanS = tail.length === 0 ? 0 : tail[tail.length - 1].t - tail[0].t;
  if (tail.length < minTailSamples || spanS < minSpanS) {
    return {
      ...empty,
      peakResident,
      plateauT: tail.length === 0 ? null : tail[0].t,
      tailSamples: tail.length,
      spanS,
      why:
        `the pool only saturated at ${peakResident} resident layers at t=${tail[0]?.t?.toFixed(1)}s, ` +
        `leaving ${tail.length} sample(s) over ${spanS.toFixed(1)}s — below the ${minTailSamples} ` +
        `samples and ${minSpanS}s a rate needs. The window is mostly the fill and must not be scored`,
    };
  }

  // The whole tail, and the tail's own second half. `Infinity` asks `evictionRate` for the rate over
  // everything it is handed rather than over a trailing sub-window — the sub-window is what this
  // function has just finished choosing.
  const rate = evictionRate(tail, Infinity);
  const halfRate = evictionRate(tail.slice(Math.floor(tail.length / 2)), Infinity);
  if (rate === null || halfRate === null) {
    return { ...empty, peakResident, plateauT: tail[0].t, tailSamples: tail.length, spanS, why: "the tail's samples share a timestamp, so neither half spans a measurable interval" };
  }

  // A relative drift is undefined at zero, and zero is the common case here rather than an edge: 44
  // of the 45 worlds never saturate the pool, so they churn nothing and both halves read 0. `0/0`
  // would report the arms that have most obviously converged as unconverged. Two zeros agree exactly.
  const drift = rate === 0 ? (halfRate === 0 ? 0 : 1) : Math.abs(halfRate - rate) / rate;
  const converged = drift <= convergence;
  return {
    rate: converged ? rate : null,
    halfRate,
    drift,
    converged,
    peakResident,
    plateauT: tail[0].t,
    tailSamples: tail.length,
    spanS,
    why: converged
      ? null
      : `the tail has not settled: over ${spanS.toFixed(1)}s after the pool plateaued at ` +
        `${peakResident} layers it reads ${rate.toFixed(2)}/s, and its own second half reads ` +
        `${halfRate.toFixed(2)}/s — ${(drift * 100).toFixed(1)}% off, against a tolerance of ` +
        `${(convergence * 100).toFixed(0)}%. Excluding the fill is necessary and not sufficient; ` +
        `neither figure is a steady state and neither may be scored`,
  };
}

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
  return budgetBound(stream, "entry");
}

/**
 * The same read, taken at the **exit** of a world's visit — the eviction half's own domain
 * (DEC-752, board ruling `exit_domain` on card `62f32092`).
 *
 * ## Why the eviction half needs a domain its sibling must not have
 *
 * `?artThreshold=fixed24` entered its session clean and exhausted the budget **during** the visit:
 * 71.6 MB fetched against a 67.1 MB budget, `swatchOnly` true at exit. Its eviction half then read
 * **0/s and PASSED** — on a row whose whole purpose is to be red. That zero is not a settled pool,
 * it is an absent measurement: `artPool.claimLayer` only evicts when it cannot find a free layer,
 * and a stream forbidden to fetch never asks for one. **A pool forbidden to admit cannot evict.**
 *
 * So the predicate is exit-side here and entry-side in {@link budgetBoundAtEntry}, and the asymmetry
 * is the design rather than an oversight:
 *
 * | half | side | why the other side is wrong |
 * |---|---|---|
 * | `artFraction` | **entry** | exit-side would excuse a world whose *own* demand exhausted the budget — dominaria's real W4 failure, and `fixed24`'s — by calling the failure its own domain |
 * | `evictionsPerSecond` | **exit** | entry-side cannot see an exhaustion that happened mid-visit, which is exactly when the counter stops being able to move |
 *
 * `artFraction` measures the picture: a starved frame is a true reading of a starved frame however
 * it got that way. `evictionsPerSecond` measures a *rate of change of a counter*, and a counter that
 * has been forbidden to move reports a number that is not about the policy at all.
 *
 * **This does not touch the baseline red, and that was checked rather than assumed.** On the
 * `baseline` row dominaria reads `declinedBudget` 0 and `swatchOnly` **false** at exit, so it sits
 * inside this domain and its ~18.4/s stands.
 */
export function budgetBoundAtExit(stream) {
  return budgetBound(stream, "exit");
}

/**
 * Both sides of the same read, with `side` naming which report went missing.
 *
 * Shared so the two cannot drift into different spellings of "was this stream allowed to fetch" —
 * the DEC-812 defect is that a *copy* of the renderer's condition goes stale, and two copies go
 * stale independently.
 */
function budgetBound(stream, side) {
  if (typeof stream?.swatchOnly !== "boolean") {
    throw new TypeError(
      `W4 needs the ${side} stream report's swatchOnly: it is the renderer's own answer to whether ` +
        "the stream was allowed to fetch, and re-deriving it from the byte counts is the DEC-812 defect",
    );
  }
  for (const key of ["bytesOutstanding", "bytesReserved", "byteBudget"]) {
    if (typeof stream[key] !== "number") {
      throw new TypeError(
        `W4 needs the ${side} stream report's ${key}: the disqualification message quotes it, and a tour's carried-over spend must be reported in the numbers that produced it`,
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
 * {@link budgetBoundAtEntry}. `exitStream` is the one read **after** it — see
 * {@link budgetBoundAtExit}. Both are required positionals for the same reason `pool` is:
 * defaulted, they would default their guards off, and the guard off is the defect.
 *
 * ## The two halves are scored against different things (DEC-752, board card `2e92df81`)
 *
 * `artFraction` is scored against a **reachable bar** rather than §3.1's flat 0.9 — ruling
 * `split_measures`, disambiguated to `bar = FLOORS.artFraction × capacityCeiling` by ruling
 * `floor_times_ceiling`, then floored at `FLOORS.artFractionAbsolute` by ruling `absolute_floor`
 * (board card `74114193`) because the product of the first two could not bind on a saturated pool.
 * See {@link reachableBar} for the arithmetic, which is not a detail.
 *
 * `demandFitsCapacity` is the second half of `split_measures`: the overshoot the bar now forgives,
 * reported so it is visible. Ruling `demand_measure_scored` = `reported_only`, so it carries a
 * verdict and no colour.
 *
 * ## The eviction half, re-bound (board ruling on DEC-833 card `bd5c9aad`, option (a), 2026-09-17)
 *
 * Three changes, and none of them is a loosening even though the number went up:
 *
 * 1. **The bound is 21/s, not 5/s** — {@link FLOORS}`.evictionsPerSecond` carries the derivation.
 *    `evictions == requested` is a structural identity, so this criterion bounds **want-set
 *    turnover**, and turnover on a spinning 6,271-card world into a 1,024-layer pool is 18.1–18.5/s
 *    at the floor. 5/s was not reachable from the request loop at all.
 * 2. **It is scored at the shipped 1,024-layer pool alone** — {@link W4_EVICTION_POOL_LAYERS}.
 *    Everywhere else the measure is `insufficient`, because a smaller pool buys a smaller rate by
 *    refusing wants, and the two halves of W4 would then have no configuration that satisfies both.
 * 3. **It is measured on a fill-excluded tail that has to converge** — {@link evictionTail}. A cold
 *    pool's first 1,024 admissions are page load.
 *
 * ## `artCellsShowing` — the no-starvation term, absolute because the fraction could not see it
 *
 * `artFraction` read **1.00** on a frame showing fourteen cells of art, because the adaptive
 * threshold had collapsed its denominator to fourteen (DEC-834, `?layers=128` under reduced motion).
 * The ratio was not wrong; it was answering a question about a want set the policy had chosen. The
 * absolute term scores the numerator against a fixed floor, in a domain written from the frame's
 * geometry so the policy cannot narrow its way out of being graded. See
 * {@link FLOORS}`.artCellsAbsolute` for the floor and the two readings it separates.
 */
export function evaluateW4(cells, evictionTimeline, pool, entryStream, exitStream) {
  const wanting = cellsWantingArt(cells);
  const showing = wanting.filter((c) => c.showingArt);
  const dead = streamNeverRan(wanting.length, pool);
  const bound = budgetBoundAtEntry(entryStream);
  const boundAtExit = budgetBoundAtExit(exitStream);

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

  // The eviction half's own domain, on top of the two it shares with `artFraction`. A session that
  // exhausted *during* the visit is forbidden to admit by the time the rate is read, and a pool that
  // cannot admit cannot evict — see `budgetBoundAtExit` for why this is exit-side where its sibling
  // is entry-side, and why giving `artFraction` the same rule would excuse the failure W4 exists to
  // catch.
  const tail = evictionTail(evictionTimeline);
  const evictionWhy =
    noAdmission ??
    (boundAtExit
      ? `the session's ${exitStream.byteBudget}-byte art budget was exhausted during this world's ` +
        `visit (${exitStream.bytesOutstanding} outstanding + ${exitStream.bytesReserved} reserved ` +
        `at exit, the renderer reporting swatchOnly), so the pool was forbidden to admit a layer ` +
        `and could not evict one. This rate is 0 by construction, not by policy.`
      : // **The capacity domain, board ruling `bd5c9aad` option (a)** — see
        // {@link W4_EVICTION_POOL_LAYERS}. Checked before the tail, because a rate taken at the
        // wrong capacity is out of domain however beautifully it converged.
        pool.layers !== W4_EVICTION_POOL_LAYERS
        ? `the bound is turnover-derived at the shipped ${W4_EVICTION_POOL_LAYERS}-layer pool and ` +
          `this session ran ${pool.layers} layers. A smaller pool churns less only by refusing the ` +
          `wants it cannot hold — at 128 layers the rate is 6.73/s and artFraction falls to ~0.617 ` +
          `— so the two halves of W4 would select disjoint configurations. Out of domain, not green.`
        : tail.why);

  const ceiling = capacityCeiling(wanting.length, pool);
  // The no-starvation term's domain is the frame's **geometry**, not its want set. `wantsArt` is the
  // adaptive threshold's output and `showingArt` is the pool's, so a domain written from either would
  // be the policy under test choosing whether to be graded — which is precisely the collapse this
  // term exists to catch, re-introduced one level up. Front-facing and on-screen are facts about
  // where the camera is.
  const presented = cells.filter((c) => c.frontFacing && c.onScreen);

  return criterion(
    "W4",
    "Art resolves without exhausting",
    [
      measure(
        "artFraction",
        `cells above the effective threshold showing art (${showing.length}/${wanting.length})`,
        wanting.length === 0 ? null : showing.length / wanting.length,
        reachableBar(ceiling),
        "min",
        why === null ? {} : { insufficient: true, why },
      ),
      measure(
        "evictionsPerSecond",
        tail.rate === null
          ? "evictions/s on the fill-excluded tail"
          : `evictions/s over the ${tail.spanS.toFixed(1)} s tail after the pool plateaued at ` +
            `${tail.peakResident} resident layers (${tail.tailSamples} samples, second half ` +
            `${tail.halfRate.toFixed(2)}/s)`,
        tail.rate,
        FLOORS.evictionsPerSecond,
        "max",
        // **The empty denominator is not carried over to this half, and the asymmetry is the
        // point.** No demand says nothing about whether the pool churns: a world presenting no
        // front-facing cell can still be evicting the layers a neighbour's demand bought, and that
        // rate is a real reading of the policy. Only the no-admission cases force this zero.
        evictionWhy === null ? {} : { insufficient: true, why: evictionWhy },
      ),
      measure(
        "artCellsShowing",
        `cells showing art, absolutely (${showing.length} of ${presented.length} front-facing on screen)`,
        // Deliberately the same numerator `artFraction` divides. The finding this term answers is
        // that the *denominator* moved: 14 of 14 and 942 of 945 are the same ratio and are not the
        // same picture, so the repair is to score the numerator on its own against a fixed number.
        showing.length,
        FLOORS.artCellsAbsolute,
        "min",
        {
          insufficient:
            noAdmission !== null || presented.length < FLOORS.artCellsAbsolute,
          why:
            noAdmission ??
            (presented.length < FLOORS.artCellsAbsolute
              ? `only ${presented.length} cells are front-facing and on screen, fewer than the ` +
                `${FLOORS.artCellsAbsolute} this term requires to be showing art, so the frame ` +
                `cannot clear it however the policy behaves. A one-card world is the extreme of ` +
                `this and is scored by W1 and artFraction, which are defined at n = 1.`
              : null),
        },
      ),
      measure(
        "demandFitsCapacity",
        `cells wanting art per pool layer (${wanting.length}/${pool.layers})`,
        demandPerLayer(wanting.length, pool),
        1,
        "max",
        {
          // **Reported, not scored** — ruling `demand_measure_scored` = `reported_only`. This is the
          // measure that sees what `reachableBar` forgives: at tier 4 the policy admitted 205 cells
          // into a 128-layer pool, a 1.60× overshoot, and `artFraction` against its reachable bar
          // cannot say so. Scored, it would have kept `?layers=128` red and the split would not have
          // fixed the row it was raised for; unreported, the overshoot would be invisible in both
          // halves at once.
          scored: false,
          insufficient: noAdmission !== null || wanting.length === 0,
          why:
            noAdmission ??
            (wanting.length === 0
              ? "no cell wants art, so there is no demand to fit into the pool"
              : null),
        },
      ),
    ],
    {
      wanting: wanting.length,
      showing: showing.length,
      presented: presented.length,
      poolLayers: pool.layers,
      belowShippedPool: pool.layers < SMALLEST_SHIPPED_POOL_LAYERS,
      // The capacity the eviction bound is derived at, and whether this session is at it. Reported
      // beside the verdict so an `insufficient` eviction half can be read off the record without
      // re-deriving why — the domain rule's whole risk is that it goes quiet.
      evictionPoolLayers: W4_EVICTION_POOL_LAYERS,
      atEvictionPool: pool.layers === W4_EVICTION_POOL_LAYERS,
      // The tail's own shape: where the fill ended, how much was left, and how far the second half
      // sat from the whole. `rate` is `null` on an unconverged tail and the diagnostics are not, so
      // a run that failed to settle can still be inspected rather than merely disqualified.
      evictionTail: tail,
      streamNeverRan: dead,
      budgetBoundAtEntry: bound,
      budgetBoundAtExit: boundAtExit,
      capacityCeiling: ceiling,
      artFractionBar: reachableBar(ceiling),
    },
  );
}

/**
 * The bar `artFraction` is scored against:
 * `max(FLOORS.artFraction × capacityCeiling, FLOORS.artFractionAbsolute)`.
 *
 * Two rulings, and the second exists because the first had a hole in it:
 *
 * - **`floor_times_ceiling`** (board card `2e92df81`) made the bar a fraction of what the pool could
 *   show, rather than §3.1's flat 0.9. Read it as "show 90% of what your pool could show".
 * - **`absolute_floor`** (board card `74114193`) added the `max(…, 0.5)`, because the first rule
 *   alone **could not bind on a saturated pool at all**. See below.
 *
 * `null` ceiling — nothing wants art — leaves the flat 0.9, because there is no capacity claim to
 * make and the measure is out of domain there anyway.
 *
 * ## Why the second term is load-bearing, and it is arithmetic (DEC-752, measured)
 *
 * A showing cell holds a layer. When the pool is the binding constraint and every layer is in use,
 * `showing == layers`, so `artFraction == layers / wanting == capacityCeiling` **exactly**. Against
 * a bar that is a fixed *fraction* of that same ceiling, the ratio of value to bar is `1 / 0.9` for
 * **any** capacity and **any** demand: a fully-utilised pool passed at every rung — 37%, 10%, 1% —
 * and the measure had stopped being a claim about how much art the picture shows.
 *
 * The consequence landed on §3.1's own named control. Appendix A's `tether-surface` capture is 1,024
 * drawn of 2,759 wanted into a 1,024-layer pool: ceiling 0.37115, and under `floor_times_ceiling`
 * alone the bar was 0.33403 against a value of 0.37115 — `pass`. The prototype capture the spec
 * cites as W4's falsifier went GREEN, and green on **both** halves once its pool settles. The card
 * that carried `floor_times_ceiling` to the board said "`fixed24` stays RED because its ceiling is
 * 1", which is true of the **live** `?artThreshold=fixed24` row — *budget*-starved, so its demand
 * fits its pool, its ceiling is 1 and its bar is the unmodified 0.9 — and false of the prototype's
 * *pool*-starved capture. §3.1 calls both of them "the fixed24 control".
 *
 * The 0.5 closes exactly that: `tether-surface` scores 0.37115 against a bar of **0.5** and is RED
 * again, on the art half, for showing too little art.
 *
 * ## The floor's real content: demand may overshoot capacity by at most 2×
 *
 * Because `artFraction == ceiling` on a saturated pool, `value >= 0.5` iff `wanting / layers <= 2`.
 * So on the frames where the pool is the constraint, the absolute floor **is** a scored bound of 2×
 * on `demandFitsCapacity` — the measure ruling `demand_measure_scored` left `reported_only`. It is
 * worth knowing that the two are the same claim on those frames, because it means the unscored
 * measure is not the only thing standing between a starved pool and a green row.
 *
 * Where the pool is *not* the constraint the two terms come apart, and both still do work: the live
 * `fixed24` row's demand fits its pool (ceiling 1, bar 0.9) and it fails at 0.37 on the first term,
 * having never been near the second.
 *
 * See `a-bound-check-is-vacuous-when-the-bound-never-binds` — this function is now that note's
 * worked example in both directions.
 */
function reachableBar(ceiling) {
  if (ceiling === null) return FLOORS.artFraction;
  return Math.max(FLOORS.artFraction * ceiling, FLOORS.artFractionAbsolute);
}

/**
 * Demand as a multiple of capacity: `wanting / layers`, the reciprocal of the uncapped ceiling.
 *
 * `null` on a zero-layer pool — §1.6's legal swatch-only world — where "does demand fit" has no
 * answer rather than an infinite one, and `null` on no demand.
 */
function demandPerLayer(wanting, pool) {
  if (wanting === 0 || pool.layers === 0) return null;
  return wanting / pool.layers;
}

/**
 * The highest `artFraction` the pool could show, whatever the policy does (DEC-770 N1).
 *
 * A showing cell holds a layer, so a pool of `L` layers cannot show art on more than `L` cells at
 * once: the ceiling is `min(1, L / wanting)`. This is arithmetic about the capacity rather than a
 * reading of a frame, which is why it is reported on **every** W4 row and not only on the rows that
 * look starved — a ceiling is evidence about what the row could have said.
 *
 * > **WIRED TO THE VERDICT SINCE 2026-09-16 — the paragraph below is the argument the board
 * > overruled, kept because it is the record of what the ruling cost and of what it took to repair.**
 * > `artFraction` is scored against `FLOORS.artFraction ×` this ceiling, floored at
 * > `FLOORS.artFractionAbsolute` ({@link reachableBar}; rulings `split_measures` +
 * > `floor_times_ceiling`, then `absolute_floor`). The second worry below — that this hides a policy
 * > overshooting — is answered twice over: by `demandFitsCapacity`, which reports the overshoot and
 * > is not scored, and by the absolute floor, which on a saturated pool *is* a 2× bound on that same
 * > overshoot. **The first worry below was right, and it took a second ruling to settle**: under
 * > `floor_times_ceiling` alone, Appendix A's pool-starved `tether-surface` capture went GREEN on
 * > this half — the control retiring exactly as feared — while the *live* `fixed24` row, which is
 * > budget-starved and keeps a ceiling of 1, stayed RED throughout. The floor reds the capture again.
 * >
 * > **(Superseded)** Reported, and deliberately NOT wired to the verdict. §3.1's floor is 0.9, and
 * > where this ceiling falls below it the floor is unreachable and the row reds a renderer that did
 * > nothing wrong. Lowering the floor to match is *not* a safe local fix, for two reasons. First,
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
 * The mean fold — W3's, and W3's alone (board ruling `fold_mean`, card `7d3653f6`).
 *
 * ## Why W3 folds differently from every other criterion
 *
 * A worst-case fold is the right one wherever the per-plane reading is stable, because "every world
 * clears the floor" is the claim §3.1 wants. W3's is not stable: a world's reading is already a
 * **minimum over its band pairs**, so the roster fold was a minimum of minima, and a min of minima
 * over a population that moves samples its own low tail. Measured over five identical full-roster
 * sessions on one unchanged dataset (DEC-832): the fold spanned 0.4253–0.8005, a **1.88×** spread,
 * and it scored **three different worlds** — so the criterion had no fixed subject and its colour
 * was settled by the draw. Re-scoring the same per-world readings: mean **1.09×**, median 1.22×,
 * p25 1.38×, p10 2.37× (worse than the min it would replace).
 *
 * ## What a mean costs, stated rather than glossed
 *
 * It buys reproducibility with exactly the property the worst-case fold had: **one degenerate world
 * can no longer red the roster on its own.** That is a real loss and the board took it knowingly.
 * Two things are owed in return, and both are here:
 *
 * 1. **The domain cannot be allowed to thin silently.** A mean over a subset is a different
 *    statistic that reads in the same units — narrow the domain to the comfortable worlds and the
 *    number goes *up*. So the fold takes the roster's expected denominator and **fails** when it
 *    scores fewer worlds than that, rather than folding what it has. (A worst-case fold needed no
 *    such rule: narrowing it can only raise it, and `scoredPlanes` is printed beside it.)
 * 2. **The per-world readings are published** (`readings`), lowest first, so a roster mean can
 *    always be taken apart by the next reader instead of being taken on trust.
 *
 * ## The verdict lives here, not on the plane
 *
 * A per-plane W3 measure still carries its own `status` against `FLOORS.bandDeltaE`, and on a floor
 * derived from a **mean** roughly half the domain sits below it by construction. That per-plane
 * verdict is not the criterion and this fold does not read it: `status` here comes from the mean
 * against the bound, never from counting failing planes. A world below the roster floor is a world
 * below the roster mean, not a failing world — see spec §3.1.
 *
 * `rosterDomain` is `{ expected, qualifying, label }` or `null` for a row that toured one subject.
 * `null` reports `insufficient`: a roster statistic measured on one world is not a small version of
 * itself, it is a different number, and scoring it against the roster's floor would red the
 * `?art=off` sibling every composed control row is read against.
 */
function foldMean(template, all, real, rosterDomain) {
  const readings = real
    .map((entry) => ({ slug: entry.slug, value: entry.measure.value }))
    .sort((a, b) => a.value - b.value);
  const value =
    readings.reduce((total, r) => total + r.value, 0) / readings.length;
  const shared = {
    ...template,
    value,
    foldKind: "mean",
    readings,
    worstPlane: readings[0].slug,
    scoredPlanes: real.length,
    insufficientPlanes: all.length - real.length,
    expectedPlanes: rosterDomain?.expected?.scored ?? null,
    expectedQualifyingPlanes: rosterDomain?.expected?.byShares ?? null,
  };

  if (rosterDomain === null) {
    return {
      ...shared,
      status: "insufficient",
      pass: false,
      insufficientReason:
        `${template.key} folds to the mean over the roster's domain; this row scored ` +
        `${real.length} world${real.length === 1 ? "" : "s"} and is not a roster tour`,
    };
  }

  // Both halves of the denominator, checked separately, because they fail for different reasons and
  // a message naming the wrong one costs a tour. `expected.scored` is the dataset's recorded domain
  // size — it catches a tour that visited fewer worlds (a crash, `--tour-limit`, a truncated order)
  // or a world that lost a band at the pose, neither of which the run's own data can see: eight
  // worlds toured would report eight of everything. `expected.byShares` is a pure function of the
  // dataset, so it catches the dataset moving under the record even when the scored count lands on
  // the same number again.
  //
  // **A mismatch in either direction is a fault, and `scored` above the record is not good news.**
  // The floor was derived over a domain of a stated size; a mean over a larger one is a different
  // statistic in the same units, exactly as a mean over a smaller one is.
  const faults = [];
  if (rosterDomain.expected === null) {
    faults.push(
      `no W3 domain size is recorded for ${rosterDomain.label} — a roster mean may not be scored ` +
        `against a floor derived on a roster nobody wrote down`,
    );
  } else if (real.length !== rosterDomain.expected.scored) {
    faults.push(
      `scored ${real.length} of the ${rosterDomain.expected.scored} worlds ${rosterDomain.label} ` +
        `puts in domain — a mean over a domain that is not the one the floor was derived on is a ` +
        `different statistic in the same units`,
    );
  }
  if (
    rosterDomain.qualifying !== null &&
    rosterDomain.expected !== null &&
    rosterDomain.qualifying !== rosterDomain.expected.byShares
  ) {
    faults.push(
      `${rosterDomain.qualifying} worlds qualify by band share against the ` +
        `${rosterDomain.expected.byShares} recorded for ${rosterDomain.label} — the dataset has ` +
        `moved under the record; re-derive the floor before trusting this number`,
    );
  }

  const status =
    faults.length > 0
      ? "fail"
      : (
            template.direction === "min"
              ? value >= template.bound
              : value <= template.bound
          )
        ? "pass"
        : "fail";
  return {
    ...shared,
    status,
    pass: status === "pass",
    qualifyingPlanes: rosterDomain.qualifying,
    domainFaults: faults,
  };
}

/**
 * Fold one criterion measured on many planes into the criterion for the roster.
 *
 * W1 aggregates itself — its verdict is the worst plane, and `evaluateW1` takes every plane at
 * once. W2 and W4 are per-plane, and §3.1 is explicit that they must stay that way: "a whole-
 * multiverse aggregate quietly averaging over them" is exactly what cannot catch a single
 * degenerate world. So their fold is a worst-case over planes and never a mean, and `insufficient`
 * is carried rather than counted as a pass — an `n/a` that is invisible is how a gate comes to
 * measure nothing while printing green.
 *
 * **W3 is the exception, by board ruling `fold_mean` (card `7d3653f6`, 2026-09-17).** Its measure
 * carries `fold: 'mean'` and is folded by {@link foldMean}; everything above is why that is a
 * deliberate exception and not a relaxation of the rule. See {@link foldMean} for the argument the
 * board ruled on and for what a mean costs.
 *
 * `rosterDomain` is the roster tour's own denominator, or `null` when the row toured a subject
 * rather than the roster. It is only read by mean-folded measures, because only they have a
 * denominator that can be silently thinned: a worst-case fold over a narrowed domain can only move
 * *up*, and `checkControlRow` already prints `scoredPlanes` beside it.
 *
 * **It publishes its own denominator** (`scoredPlanes`), which `checkControlRow` prints. Carrying
 * only `insufficientPlanes` was the wrong half: after the ring domain landed (DEC-816 R3) W2's
 * lightness half folds off 2 of the 45 worlds, and a GREEN taken over two worlds must not print the
 * same line as a GREEN taken over forty-five.
 */
export function foldCriteria(perPlane, { rosterDomain = null } = {}) {
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
    if (template.fold === "mean") return foldMean(template, all, real, rosterDomain);
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
  // Reported-only measures are folded and printed like any other — their value over the worst plane
  // is the number the ruling asked to see — but they are held out of the roster verdict by the same
  // predicate the per-plane rows use, so the fold cannot contradict them.
  const scored = scoredMeasures(measures);
  const status = scored.some((m) => m.status === "fail")
    ? "fail"
    : scored.every((m) => m.status === "insufficient")
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
  //
  // A mean-folded measure says so and prints its **expected** denominator beside its actual one.
  // "worst of 28 worlds" and "mean of 28 worlds" are different claims about the same number, and a
  // mean that is one world short is the failure mode the expectation exists to catch — so the line
  // carries both counts even when they agree, and names the world holding the low end rather than
  // calling it "worst", which under a mean it is not.
  const domain =
    went !== "N/A" && typeof subject.scoredPlanes === "number"
      ? subject.foldKind === "mean"
        ? `, mean of ${subject.scoredPlanes} of ${subject.expectedPlanes ?? "?"} worlds in domain` +
          `${subject.worstPlane === null ? "" : `, lowest ${subject.worstPlane}`}` +
          `${subject.insufficientPlanes ? `, ${subject.insufficientPlanes} out of domain` : ""}` +
          `${subject.domainFaults?.length ? ` — ${subject.domainFaults.join("; ")}` : ""}`
        : `, worst of ${subject.scoredPlanes} world${subject.scoredPlanes === 1 ? "" : "s"} in domain` +
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
