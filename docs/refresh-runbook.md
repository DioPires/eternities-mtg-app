# Refresh runbook

**Owner: Simulation Engineer. Cadence: roughly once per set release (PRD 4.10.1).**

This is PRD 8.8.3's flow, written from running it. **Every command and every number in §§0–5 came
from the 2026-09-05 rehearsal**, which took the production dataset from `d5ee9661aaffafa3` to
`97984b20156c63f0`. Where the rehearsal found something surprising, it is called out rather than
smoothed over — the surprises are the reason this document exists.

**§6 is the exception and is marked as such.** The merge, the deploy and the rollback have not been
exercised by anyone, for one reason: **you do not merge your own refresh — the CEO does**, so the
2026-09-05 rehearsal stopped at step 5 and could not go further. The production host itself is real
and live — `https://eternities-mtg-app.vercel.app`, deployed automatically on every merge to `main`
— so §6's verification commands do run today; they simply were not run *as part of a refresh*. Read
§6 as the intended flow, not as a rehearsed one.

A refresh is a **data** change. It does not touch rendering, so it does not need `pnpm bench`
(PRD 9.1.2's rule is "before merging any change that touches rendering"). It does need the report
review and the automated browser checks (§4.1), both of which are cheap — **and it needs the
worlds gate (§4.3), which is not cheap and is not optional.** A refresh rebuilds every world's cell
sheet and swatches, so it can change what the multiverse looks like without touching a line of
rendering code; that is the one thing only the gate can catch.

---

## 0. Before you start

- `uv` on the path. The first `uv run` builds `pipeline/.venv` itself; nothing to set up by hand.
- Network access to Scryfall. The bulk file is ~400 MB compressed and downloads in seconds.
- A clean working tree. The build **deletes the previous production data directory**, and you want
  that deletion to be the only one in your diff.
- **Re-read Scryfall's terms before you build.** `docs/scryfall-policy.md` is the record of what we
  rely on; its §9 is the worked example of what a re-confirmation looks like, and its §8 is the
  command to re-run. This is that document's residual risk 3 (policy drift), which it hands to this
  runbook and this cadence — so it lives here or nowhere. If a clause moved, record it in
  `docs/scryfall-policy.md` in the same shape as §9 before you refresh; catching drift while it is
  still a data question is the whole point.

The download cache lives at `pipeline/.cache/scryfall/` and is gitignored, so it is per-worktree and
nobody else's copy exists. Keep the entry for a run you may need to reproduce: `--bulk-updated-at`
(§1) **fails** rather than falling back to a newer file — the right behaviour — and Scryfall does not
serve superseded bulk files, so once the cached file is gone that run is no longer reproducible.

---

## 1. Build

```sh
cd pipeline
uv run eternities build --as-of $(date +%F)
```

`--as-of` fixes which sets count as released (PRD 4.3.8) and is recorded in the manifest. The same
date and the same bulk file give byte-identical artefacts, so it is also how you reproduce a run.

The tail of a good run:

```
data:   web/public/data/97984b20156c63f0
report: pipeline/reports/2026-09-05.md
datasets.json active = 97984b20156c63f0
  removed stale d5ee9661aaffafa3/
```

Three things happen automatically and none of them need doing by hand: the new data directory is
written, `web/datasets.json` is repointed (`active` **and** `production`), and the previous
production directory is deleted from the working tree. That last line is why `git status` will show
a few hundred deletions next to a few hundred additions. It is the flow working, not a mistake.

**Check the `datasets.json` diff: it is exactly two lines**, `active` and `production`. The fixture
hashes must not move — a `build` reads the registry and writes only those two keys, so if a fixture
hash changed, you ran something other than `build` and the diff is telling you so.

**Re-running.** A second run on the same day against the same bulk file produces the same hash and
an empty diff. To re-run after editing an appendix without picking up a newer card file, pin the
cache key:

```sh
uv run eternities build --as-of 2026-09-05 --bulk-updated-at 2026-09-05T09:05:28.871+00:00
```

Without that pin, an appendix-only re-run silently gets whatever Scryfall published since (PRD
4.9.1). The timestamp is in the report's Run table and in `manifest.json`.

---

## 2. Read the report

`pipeline/reports/<date>.md`. Diff it against the previous one — that is the review, and it is the
step the gates of PRD 9.2 actually live in.

```sh
diff -u pipeline/reports/2026-09-04.md pipeline/reports/2026-09-05.md
```

**The four gates, and what each one failing looks like.**

| Gate | Where | Pass |
|---|---|---|
| 9.2.1 Unmapped sets | Data quality gates table | `0`. Enforced — the run *fails* otherwise (4.6.4), so you will not see this in a report at all. |
| 9.2.2 Blind Eternities share | Data quality gates table | Compare against the accepted **17.42%** baseline. A material move is owed an explanation (9.2.2). |
| 9.2.3 Cards that changed plane | Data quality gates table, and its own section | Every entry should trace to an appendix or override edit **you made**. Entries you cannot explain are the finding. |
| 9.2.4 Planes with zero cards | "Cards per plane", rows marked `empty` | Expected to be stable. A plane that *gained* its first cards, or lost its last, is worth a look — it usually means an Appendix B set mapping moved. |

The 2026-09-05 run: unmapped `0`, share `17.42%` unchanged, cards changed plane `0`, empty planes
unchanged. Two new printings arrived in the bulk file and both were correctly dropped as unreleased
(4.3.8), so included cards stayed at 28,587 and the roster stayed at 87 planes.

> **9.2.3 needs a decodable predecessor.** The run before this one could not compute it: its
> predecessor was written under contract v1, and the binary decoders test the header for strict
> equality rather than guess at an older layout. The report said so in place of a number. If you
> ever bump the data contract, expect exactly one run with no plane-change diff, and expect it to
> resume by itself on the run after.

---

## 3. Reconcile the report against the file diff

**This is the step the rehearsal added, and the one that is easy to skip.**

The report answers "which cards changed *plane*". On 2026-09-05 that answer was `None`, truthfully —
and thirteen plane shards were in the diff anyway. Nothing in the report explains that, because the
report was never asked to.

```sh
python3 pipeline/scripts/classify-refresh-diff.py \
  <previous-data-dir> web/public/data/<new-hash>
```

The previous directory is already deleted from the working tree by step 1, so get it out of git —
`git archive` reads it from `HEAD`, where it is still committed:

```sh
mkdir -p /tmp/prev
git archive HEAD web/public/data/d5ee9661aaffafa3 | tar -x -C /tmp/prev
python3 pipeline/scripts/classify-refresh-diff.py \
  /tmp/prev/web/public/data/d5ee9661aaffafa3 web/public/data/97984b20156c63f0
```

**Run this before you commit (step 5).** `git archive HEAD` finds the old directory only while
`HEAD` still holds it; after the refresh commit the same command fails with `fatal: pathspec … did
not match any files`, and piped into `tar -x` **that failure is silent** — `tar` succeeds on an
empty stream and you get an empty directory. Use `HEAD~1` afterwards. The classifier refuses a
directory with no `planes/`, which is what catches you if you forget.

What it printed on 2026-09-05:

```
cards added:   0
cards removed: 0
cards changed: 38

  image cache-buster only:         38 card(s), 40 printing tuple(s)
  printing added or removed:        0 card(s)
  non-printing field changed:       0 card(s)
  printing changed otherwise:       0 card(s)  <-- read these
  card changed plane:               0 card(s)  <-- read these
```

All thirty-eight were `imageTs` — the cache-buster in Scryfall's image URI, which they re-stamp when
a card is re-scanned (`docs/data-contract.md`). No product-visible change at all.

**The two numbers on the cache-buster line count different things** (DEC-673 N2, corrected by
DEC-676). `N card(s)` counts **cards**; `M printing tuple(s)` counts **printing tuples**. That alone
explains the gap, because one card can be re-stamped on several of its printings: the 38 and 40
above are 37 cards re-stamped on one printing each plus **Baleful Strix re-stamped on three**. So
`M >= N` is structural, not a coincidence of this diff.

**`M` is a floor on cache-buster churn, not a total.** The classifier reports each card in its
loudest bucket, and two of those buckets `continue` out of the loop *before* the per-printing
comparison ever runs: a card that changed plane, and a card that gained or lost a printing. Any
cache-buster churn on such a card is never counted, so `M` undercounts the true total whenever
either of those rows is non-zero. A card with a non-printing field change is the exception — it
deliberately falls through and does contribute its tuples, which is why that row and this one can
both be non-zero for the same card. Read `N` as "how many cards were pure noise" and `M` as "at
least this much of the diff is noise".

**How to read the buckets.** The first two are routine: cache-buster churn is noise, and a new
printing of an existing card is what a set release looks like. The last three are not. A
non-printing field moving (name, type line, oracle text, colour identity, layout, size class) means
Scryfall changed something about the card itself, and each one deserves a read. A printing changing
anything other than its cache-buster — same printing id, different set, rarity or collector number —
should not happen; find out why before merging.

**`card changed plane` is the loudest row, and the one to cross-check against the report.** It
should agree with 9.2.3, and every entry should trace to an appendix or override edit you made.
It earns its place because a card can move between shards with **every byte of the card itself
unchanged** — two shard files move in the diff and nothing else in this output would say why. It
matters most in the one run where 9.2.3 prints no number at all (a contract bump, see §2): there
this row is the only account of a plane move that exists.

**Consequence worth knowing:** because data directories are committed (PRD 8.1.4), cache-buster
churn alone rewrites every touched shard on every refresh, for no product reason — which is what
made it look like PRD risk 8 arriving early. **It is much cheaper than that reads.** Git packs the
new shards as deltas against their predecessors, so the 2026-09-05 no-product-change refresh cost
**4,342 bytes**, not the megabytes a per-shard copy would imply. The decision to leave `imageTs`
alone, the measurement behind that number and the trigger for revisiting it are recorded in
[`docs/decisions/imagets-churn.md`](decisions/imagets-churn.md). Read it before treating this
paragraph as a reason to act. Amendment A2 rules out Git LFS as the escape hatch either way (see
`docs/deployment.md`).

---

## 4. Verify the built site

### 4.1 The automated checks

```sh
cd web
pnpm build
node scripts/check-budget.mjs --dataset <new-hash>
pnpm test:e2e
```

`check-budget` enforces PRD 7.2 at the encoded-size ceilings. On 2026-09-05 every target and ceiling
held, with one warning worth carrying forward:

```
[near target]  668.5 KB  target 700.0 KB  ceiling 1.50 MB   95% of target
               search.json plus sets.bin, loaded after the first frame
```

**The search pair is the budget that will trip first.** It grows with the card set, so it is the one
to watch each refresh. 31.5 KB of headroom against the target; the ceiling is far away.

**What to do when it crosses.** Crossing the 700 KB *target* is a reported miss, not a build
failure, and not a reason to stop a refresh: the commitment in PRD 7.2 is the **1.5 MB ceiling**,
which is 2.2× away. Report the crossing in the pull request and carry on; a ceiling breach is the
one that blocks.

`pnpm test:e2e` drives the built site under the production CSP: PRD 8.9.2's five route kinds, the
quality ladder, and Phase 5's accessibility checklist with the CSP/HSTS self-check. It is the check
that the new data actually *loads* — a report can be perfect over artefacts a browser cannot decode.
It renders through SwiftShader and says nothing about how the refresh **looks**; that is 4.3.

> **Changed since the 2026-09-05 rehearsal.** The rehearsal ran
> `node scripts/verify-browser.mjs --dataset production`, which passed with 0 failed Scryfall image
> requests — the part only a real-id dataset can tell you. DEC-708 archived that script under the
> `review-tooling-2026-09` tag and moved its a11y and CSP assertions into `e2e/a11y.spec.ts`.
> Its Scryfall-image count did not move with them. The rehearsal's stand-in was watching the
> network panel during the galaxy's visual gate, which retired at the cutover (§4.2), so **nothing
> in this runbook counts failed Scryfall image requests today**. Until something does, open the
> built site on the production dataset in a local Chrome and watch the network panel while focusing
> a few cards: that is where a broken id shows up.

### 4.2 The visual gate — retired at the worlds cutover

`visual-gate.mjs` captured PRD 9.3's seven checkpoints for the **galaxy** and was the instrument
DEC-661, DEC-683 and DEC-684 were accepted on. The galaxy retired at the worlds cutover (worlds spec
§3.2, DEC-752), and PRD 9.3 was amended in the same commit to hold the worlds build to worlds spec
§3.1 instead. The script, `lib/status-panel.mjs`, `alloc-probe.mjs` and `dec697-diag.mjs` are
archived under the **`galaxy-cutover`** tag — the last commit on which the galaxy scene and the
visual gate both existed — and are no longer in the tree.

**Every refresh now runs §4.3.** Its reason for running on every refresh is the one this section
used to give: the criteria are computed from the data, so a refresh can move them without a line of
rendering code changing.

### 4.3 The worlds gate — every refresh that touches the v3 dataset

```sh
cd web
node scripts/worlds-gate.mjs --dataset worlds --out ../worlds-gate-<new-hash>
node scripts/worlds-gate.mjs --dataset worlds --negative-controls --out ../worlds-gate-<new-hash>-controls
```

`worlds-gate.mjs` is the acceptance instrument for the worlds spec's §3.1 — W1 through W5 — and it
is **a check, not a capture tool**. That is the whole difference from §4.2: `visual-gate.mjs` fails
only if it cannot reach a checkpoint and leaves the judging to the owner, while this one compares
measured values against floors and exits non-zero when one is missed. The frames it writes are
evidence for a verdict it has already reached, not the verdict itself.

Run it on every refresh that rebuilds the v3 dataset, and for the same reason §4.2 gives: the
criteria are computed from the data. §1.3's cell sheet is laid out from `rowCells` and the surface's
colour comes from `swatches.bin`, so a refresh can move W1's worst plane or collapse a W3 band pair
without a line of rendering code changing.

**Which dataset.** `--dataset worlds` or `--dataset production`; since the cutover `active` names
the same v3 directory, so a default build measures it too.

> **History, kept because the rule it records was load-bearing.** Until the cutover this paragraph
> said *never repoint `active` to test the worlds path*: `active` was contract v2,
> `READABLE_CONTRACT_VERSIONS` was `{2, 3}`, and v3 drops the shear triple whose readers go through
> `?? 0`, so an early repoint flattened the galaxy's shear without a warning. `active` moved exactly
> once, in the commit that deleted the galaxy scene (DEC-752), and the same commit closed the
> readable set to `{3}` — so a v2 dataset is now refused at load instead of silently misdrawn.

The two v3 *fixtures* carry `swatches.bin` since DEC-796, so a fixture build composes worlds and the
CI smoke build exercises the worlds path. They remain fixtures: the gate's criteria are specified on
the production roster, and only the `worlds`/`production` role answers them.

**Reading the output.** Every row prints the measure it aimed at, not just its criterion: W2 and W4
are conjunctions and a conjunction hides which half did the work. Three verdicts, and the third is
not a kind of failure — `insufficient` means the subject was outside the criterion's domain, which
on the v3 roster is the ordinary state of the six one-card worlds for W2 and W3. The run prints how
many planes landed there; a criterion that is silently skipped is how a gate prints green while
measuring nothing.

`--negative-controls` runs §3.1's matrix, and it is the run that says whether the instrument works
at all. The run prints its own census — `N expected-RED rows, M expected-GREEN, … — K of T scored
this run` — and that line, not a count written down here, is what to read: a number in this file is a
claim about a matrix that keeps growing, and it goes stale silently. At the cutover's
confirmation run (`9ff1d81`) it read **4 expected-RED, 7 expected-GREEN, 1 N/A-only, 2 derivation
(unscored), 3 MIXED — 13 of 15 scored**, and every one of 39 expectations landed on its colour. **`--only` scores a
subset, so check `K of T` before reading a GREEN summary as a full matrix run.** The green rows are
the ones to read first: in a
matrix where everything is red, a broken baseline scores identically to a perfect guard, so only the
rows expected to stay green can falsify the instrument. A red row that has gone green means the
control stopped engaging, not that the renderer improved — the gate asserts each seam's read-back
before it scores the row, and prints whether the witness was the renderer's own policy or merely an
echo of the query parameter.

**`?artThreshold=fixed24` alone no longer perturbs anything, and its rows are now RETIRED** (DEC-752
ask `f9e273fb`, board answer `replace_row`, 2026-09-17). Measured on `fec45c9`: the adaptive quantile
at a 1,024-layer pool already sits *at* the 24 px floor, so forcing 24 px moves the threshold by
nothing — `fixed24` read `artFraction` 0.9979 against `no-seams`' 0.9968, at the same 24.00 px. The
budget no longer starves it either, now that it is capacity-derived: 155 MB against ~95 MB
outstanding, `declinedBudget` 0 and `swatchOnly` false at exit. The seam does engage and does read
back its policy; it simply has no pixel to move.

**They were left unfitted until the owner ruled, and then retired rather than re-fitted.** That
order is the point: a matrix edited to agree with the build is not a matrix, and retiring a control
§3.1 publishes is the owner's call. The seam itself stays in the renderer — the replacement row
composes it.

**W4's live art falsifier is `fixed24-layers-128`**, which composes the fixed threshold with a tier-4
pool: 24 px holds demand at dominaria's full ~946 cells while the pool holds 128, a **7.39×**
overshoot, and `artFraction` reads **0.1342 against a bar of 0.5**. That is the condition Appendix A
actually captured — a fixed threshold against a pool too small for it, not a fixed threshold on its
own. It is also the row that proves the absolute floor does work: at the same frame on the previous
bar (`0.9 × ceiling`, no floor) it read 0.1341 against 0.1216 and went **GREEN**, because a
pool-starved frame is saturated and `artFraction` equals its ceiling exactly.

**W4's eviction half has two live rows and both assert `N/A`, because what they falsify is its
domain and not its bound** (DEC-842). `layers-128` covers the capacity rule; `unsaturated-pool`
(kamigawa, high-water 265 of 1,024) covers the occupancy one — below saturation `claimLayer` never
reaches its victim search, so the rate is a structural 0 the bound cannot fail. **The 45-world
`baseline` tour cannot stand in for either**: its fold is a worst-of and dominaria saturates, so it
passes with the occupancy rule and without it, and the only thing that changes is the denominator it
prints (`worst of 1 world in domain, 44 out of domain` where it read `worst of 45`). Read that
denominator on every refresh. **If it ever climbs back toward 45 without dominaria's rate moving, the
rule has stopped firing** — and a green eviction half taken over 45 readings that cannot fail is what
this row exists to prevent.

> **The climb-back baseline, written down so the comparison has a fixed end** (DEC-844 rider, recorded
> by DEC-847). The number to compare each refresh against is:
>
> | `baseline` tour, `W4.evictionsPerSecond` | denominator |
> |---|---|
> | the reading this rule was landed on (DEC-842) | **worst of 1 world in domain, 44 out of domain** |
>
> One world in domain is the healthy state, not a degraded one: dominaria is the only world on the v3
> roster whose demand saturates the shipped pool, so it is the only world whose rate the bound can
> fail. A refresh that adds a saturating world moves this legitimately — **so the check is the pair,
> not the number**: a denominator that climbs while dominaria's rate stands still is the rule going
> quiet, and a denominator that climbs alongside a second world's non-zero rate is the roster
> growing. Carried from the DEC-842 tour rather than re-measured here; re-measuring it costs a
> 45-world tour, which is what the refresh already runs.

**W2's and W3's controls are composed with `?art=off`, and their sibling is `?art=off` alone.** Read
`artoff-swatch-mean` and `artoff-bands-shuffle` against the `art-off` row, never against `baseline`.
Both colour seams perturb the *swatch*, and at the 2.2-radii pose essentially every sampled cell
draws card **art** over its swatch, so the bare seams move a layer the capture almost never shows —
measured on one build, `?swatch=mean` alone lands inside its own no-seam spread, which is a control
that proves nothing. `?art=off` drops every cell to its swatch so that a swatch seam can reach the
pixels. It also moves W2 on its own, and that is exactly why it is the sibling: scoring a composed
row against the bare build would credit the seam under test with the whole of `?art=off`'s move.

**Re-deriving W3's floor.** `FLOORS.bandDeltaE` has to sit between two **roster means**, because §3.1
folds W3 to the mean over its in-domain worlds (board ruling `fold_mean`) — not between two dominaria
readings, and no longer between two worst worlds. The two rows that measure that pair are marked
`derivation: true` — runnable by name, kept out of `--negative-controls` because they are two full
tours and a gate that takes two hours is a gate that stops being run. **They are also W3's only live
falsifier now**, so this is no longer an optional step of a refresh:

```sh
# five times, into five directories — one pass is not a derivation
node scripts/worlds-gate.mjs --dataset worlds --no-captures \
  --only w3-floor-shipped,w3-floor-control --out ../w3floor-<new-hash>-1
node scripts/w3-floor.mjs ../w3floor-<new-hash>-1 ../w3floor-<new-hash>-2 ...
```

It prints each arm's per-session means, each arm's spread, the per-world table and the interval a
floor may sit in — or reports that no separating floor exists, which is a finding rather than a
number to pick. Re-run it whenever the swatch palette moves: the floor is a property of the shipped
swatches, so a refresh can invalidate it without a line of rendering code changing.

**The domain size moves with the dataset, and the gate reds until the new one is recorded.**
`W3_DOMAIN_SIZE` in `scripts/lib/worlds-metrics.mjs` maps a dataset hash to **two** counts: the
worlds whose cards put an adjacent band pair over the 5% share rule (`byShares`, **30** on
`c9468f1125bcddff`) and the worlds that then present both of those bands in the sampled cells
(`scored`, **28**). They differ, and they are meant to — `shenmeng` and `zhalfir` qualify on their
cards and populate one band on screen. A mean over a thinned domain reads in the same units and is
*flattered* by the thinning, so `scored` is a scored expectation rather than a report: an unrecorded
hash reds every roster tour, and so does a tour whose scored domain is not exactly the record.

Take both numbers off the first full tour on the new dataset — the gate's startup line prints the
record, and each W3 row prints `mean of N of M worlds in domain` beside the `qualifying` count it
derived from that run's own band shares — then record them. Do **not** set `byShares` equal to
`scored`: that reds every correct roster tour, which is how this pair came to be recorded separately.

**Run each arm at least five times, and read the shipped arm's _minimum_ against the control's
_maximum_.** The retired 0.55 is the argument for this rule: it was derived from a single pair of
tours under the old worst-world fold, and at n=5 that fold spanned 0.4253 – 0.8005 while its control
reached 0.4477 — the arms overlapped, so the row's colour was the draw. A single tour per arm cannot
see any of that, and neither can three: at n=3 the p10 fold looked like the best statistic on offer,
and at n=5 it was the worst in the table.

`scripts/w3-fold.mjs` is the instrument for that half. Point it at two or more gate run directories
and it re-scores W3 five ways over the worlds in the domain of *all* of them:

```sh
node scripts/w3-fold.mjs --row baseline worlds-gate/accept3 worlds-gate/dec826-bare worlds-gate/accept4
```

It reports the spread of each fold, the per-world spread worst-first, and whether the same world
scored the retired min fold every session — on the three runs above, two different worlds did, and on
five, three did. Use it before quoting any W3 aggregate: one tour cannot tell a build that moved from
a fold that sampled a different plane. It still carries every fold, including the retired one, so a
refresh can confirm the mean is still the convergent choice on the *new* swatches rather than
inheriting a ranking taken on the old ones.

**One measure in that matrix has no live control, and it is `homeLabels`.** §3.1's table lists a
sixth red row — `labels forced on for empty planes` — which this gate does not run: forcing labels
on for suppressed planes is renderer behaviour, and none of the six shipped seams (`?probe=`,
`?swatch=mean`, `?bands=shuffle`, `?art=off`, `?artThreshold=fixed24`, `?layers=N`) reaches
§1.8's suppression. The unsuppressed 66–77 reading that makes the row red was taken offline through
the shipped layout code, so it shows the measure *can* fail without being a row the gate can run.
Read a green `homeLabels` as "the moons are still quiet", never as "the home view is legible" — the
second is what `worldsNeverLabelled` is for, and that one does have both its rows.

**Each world is toured in its own browser session, and sharing one is not an optimisation you may
take back.** The art stream and its byte budget are *session-wide and cumulative* — `artStream.ts`
sizes the budget as a backstop against a pathological session, and a 45-world tour is one by that
definition: it admits about 729 bodies and then stops asking. Measured on a shared page, the budget
was spent by the **8th** world, and each of the remaining 37 reported zero cells showing art, so W4
scored a false RED on every one of them. A per-world criterion read out of a shared session is a
reading of where in the tour its subject sat. Two consequences when reading the output:

- **Never attribute a session-global counter to a world.** `stream` in `visits.json` is the session
  total at that world's exit; the world's own share is `streamDelta`, differenced against the entry
  read. `pool.evictions` is cumulative in the same way, which is why W4's eviction half is a rate
  taken from a timeline and never off the counter.
- **Order-independence is checked, not assumed.** Run the tour a second time with the roster
  reversed and compare per-world numbers. If a world's W4 moves with its position in the tour, some
  session state is crossing worlds again and every W4 number in the run is suspect. The gate's own
  backstop is `budgetBoundAtEntry`, which reports `insufficient` rather than `fail` for a world
  entered with the budget already spent — but a run that trips it has measured nothing, so it is a
  guard against a silent false RED, not a way to keep touring on one page.

It needs a real GPU and a local Chrome, and it builds the site itself unless you pass
`--no-build`.

This section replaced §4.2 at the cutover (DEC-752), which retired it with the galaxy along with
PRD 9.3's criterion 2 and review T7.

---

## 5. Open the pull request

Title it with the Scryfall bulk timestamp (PRD 8.8.3), so the PR names the input it came from:

```sh
git checkout -b refresh-2026-09-05
git add web/datasets.json web/public/data pipeline/reports
git commit -m "Data refresh — Scryfall bulk 2026-09-05T09:05:28.871+00:00"
gh pr create --title "Data refresh — Scryfall bulk 2026-09-05T09:05:28.871+00:00" --body ...
```

Put the report diff summary and the classifier output in the body. A reviewer should not have to
re-derive what you already ran.

**Attach §4.3's evidence.** PRD 9.4 makes the owner's acceptance of the visual review part of done,
and the owner cannot accept frames that are sitting in a directory on your laptop. Paste the run's
`GATE:` and `matrix census` lines into the body, attach the frames it wrote, and say which dataset
they were taken on and how W1–W3 compare to the previous refresh.

---

## 6. Merge, and what happens next — NOT REHEARSED

> **Everything in this section is unexercised *by a refresh*.** The 2026-09-05 rehearsal stopped at
> step 5, and it could not have gone further, for exactly one reason: **you do not merge your own
> refresh — the CEO does.** The deploy itself is not an owner gate and never was — the Vercel project
> is connected and Production deploys automatically on every merge to `main`. What has not been done
> is walking a *data* change through that machinery and watching the live hash move. The commands
> below are written from the configuration in the repository and from a live check of the site, not
> from a refresh. The first operator to reach this section is exercising it for the first time:
> expect to correct it, and do correct it.

**Your step is step 5.** Hand the pull request over — the merge is the CEO's call and the deploy
follows from it.

Merging to `main` triggers Vercel's production deployment from the GitHub integration (PRD 8.8.1).
The new data directory is immutable and content-hashed, and `Cache-Control: max-age=31536000,
immutable` covers `/data/**` — so no cache purge is needed and no user gets a mixed dataset: the
shell that references the new hash and the files under it ship together.

After the deploy, confirm the live site is on the new hash. The host is
**`eternities-mtg-app.vercel.app`** and this command runs verbatim today:

```sh
curl -s https://eternities-mtg-app.vercel.app/ | grep 'eternities:data'
```

Run it **before** you hand the pull request over, so you know what the old hash looks like, and again
after the CEO merges. On 2026-09-05, before the refresh merged, it returned **two** lines:

```
      The build injects <meta name="eternities:data" content="/data/<hash>/"> here, plus preload
    <meta name="eternities:data" content="/data/d5ee9661aaffafa3/" />
```

The first is a placeholder comment left in `index.html` that names the tag it describes, so it
matches the grep too. Read the **second** line — the one that is really a `<meta>` element. If you
would rather not have to, this variant prints the live hash and nothing else, because the
placeholder spells its hash `<hash>` and so cannot match sixteen hex digits:

```sh
curl -s https://eternities-mtg-app.vercel.app/ | grep -o 'content="/data/[0-9a-f]\{16\}/"'
```

`d5ee9661aaffafa3` is the hash this refresh replaces. When the value changes to the hash in your
`web/datasets.json`, the deploy has shipped. Vercel takes a couple of minutes; if the old hash is
still there after five, check the deployment in the Vercel dashboard before assuming anything is
wrong with the data.

This is the only live-site check in this runbook, and it is the one that distinguishes "the merge
landed" from "the users have it".

**Rollback** is a revert of the merge commit and a redeploy. Because the previous data directory was
deleted in the same commit, reverting restores it — there is no separate step, and nothing to
un-publish. That is a true statement about git; it has never been run against a deployment.

---

## Traps found while rehearsing

- **The build deletes the old data directory for you.** A diff full of deletions is correct. Do not
  `git checkout` them back; that would ship two datasets and double the repository growth.
- **`git status` is not the review.** Thirteen changed files and a report saying "nothing changed"
  were both true at once. Step 3 is what reconciles them.
- **A same-day re-run is a no-op**, and looks alarmingly like a failed build. Check the hash.
- **Safari cannot load `pnpm preview`.** PRD 7.6.1's CSP ends in `upgrade-insecure-requests` and
  WebKit applies it to loopback, so every subresource is upgraded to `https://localhost` and fails.
  The page renders blank with no error. `pnpm cross-browser` used to serve it over real HTTPS, but
  DEC-708 archived that script under the `review-tooling-2026-09` tag — use a Vercel preview
  deployment instead. See `docs/cross-browser.md`.
- **Do not skip step 4 because the report was clean.** They check different things: one reads the
  pipeline's own account of the run, the other decodes the artefacts in a browser.
- **Do not skip 4.3 because 4.1 was green.** A refresh rebuilds the cell sheets and swatches, and
  W1–W3 are computed from them. Green automated checks over worlds whose band pairs collapsed is the
  exact failure 4.3 exists to catch.
