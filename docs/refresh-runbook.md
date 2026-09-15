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
review and the automated browser checks (§4.1), both of which are cheap — **and it needs the PRD
9.3 visual gate (§4.2), which is not cheap and is not optional.** A refresh moves plane positions
(PRD 4.9.3), so it can change what the multiverse looks like without touching a line of rendering
code; that is the one thing only the gate can catch.

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
It renders through SwiftShader and says nothing about how the refresh **looks**; that is 4.2.

> **Changed since the 2026-09-05 rehearsal.** The rehearsal ran
> `node scripts/verify-browser.mjs --dataset production`, which passed with 0 failed Scryfall image
> requests — the part only a real-id dataset can tell you. DEC-708 archived that script under the
> `review-tooling-2026-09` tag and moved its a11y and CSP assertions into `e2e/a11y.spec.ts`.
> Its Scryfall-image count did not move with them, so watch the network panel during 4.2 instead:
> the gate loads real images on the production dataset and the card checkpoints are where a broken
> id shows up.

### 4.2 The visual gate — every refresh, without exception

```sh
cd web
node scripts/visual-gate.mjs --dataset production --out ../visual-gate-<new-hash>
```

**Run this on every refresh.** PRD 9.3 words its cadence as "per milestone-sized change", which
does not obviously include a data refresh — and it must, for a reason specific to refreshes: PRD
4.9.3 lets plane positions move between datasets, and the arm geometry every 9.3 criterion is
judged on is *computed from the data*. A refresh can therefore break "spiral arms are legible for
every plane with ≥ 2,000 cards" or "no label overlaps another at the home view" without a single
line of rendering code changing, and nothing in 4.1 would notice. This is review amendment A1's
note, written down here so the cadence has a home.

`visual-gate.mjs` is the acceptance instrument for PRD 9.3 — DEC-661, DEC-683 and DEC-684 were all
accepted on its output — so it is maintained tooling, not one-off review tooling, and it survived
the DEC-708 archival for exactly that reason. It captures the seven checkpoints against the
**shipped composition** (`?probe=shell`: the scene inside the HUD, which is what 9.3 judges), plus
the shimmer recordings and the cross-fade pass, and writes `capture.json` beside them.

It is a capture tool, not a check: it fails only if it cannot reach a checkpoint, never because of
what a checkpoint looks like. **The owner judges the frames** against 9.3's seven criteria, and PRD
9.4 makes that acceptance part of done. So:

- attach the output directory to the refresh pull request (§5), and
- if the arms on any plane over 2,000 cards read worse than the previous refresh, say so in the PR
  rather than leaving it for the owner to spot. The previous refresh's captures are the comparison;
  keep them until the new ones are accepted.

Two practical notes. It needs a **real GPU** and a local Chrome — a software rasteriser cannot
answer a question about bloom or shimmer — so it runs on the refresher's machine, not in CI. And it
builds the site itself unless you pass `--no-build`, so it will pick up the dataset you just made.

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

**Which dataset — and the one rule that matters.** Pass `--dataset worlds`, which is the role that
points at the v3 directory. **Never repoint `datasets.json`'s `active` to test the worlds path.**
`active` is contract v2, `READABLE_CONTRACT_VERSIONS` is `{2, 3}` for the dual-scene period, and v3
*drops* the shear triple that `camera/motion.ts:229-234` and `scene/starfield/planeTable.ts:149-152`
still read — through `?? 0`. So repointing it early does not throw and does not warn: the spiral
shear flattens to zero and the galaxy keeps rendering, wrong, with no instrument watching. `active`
moves exactly once, in the cutover PR, in the same commit that deletes the galaxy scene.

The two v3 *fixtures* are not a substitute either. Both declare contract v3 and carry `rowCells`,
but neither carries `swatches.bin`, so no `WorldSurfaceSource` can be constructed against them and
the failure surfaces inside the loader — where it reads as a renderer defect rather than as a
missing fixture artefact. Fixture-backed assertions are limited to what `planes.json` alone answers.

**Reading the output.** Every row prints the measure it aimed at, not just its criterion: W2 and W4
are conjunctions and a conjunction hides which half did the work. Three verdicts, and the third is
not a kind of failure — `insufficient` means the subject was outside the criterion's domain, which
on the v3 roster is the ordinary state of the six one-card worlds for W2 and W3. The run prints how
many planes landed there; a criterion that is silently skipped is how a gate prints green while
measuring nothing.

`--negative-controls` runs §3.1's matrix, and it is the run that says whether the instrument works
at all. Expect **five red rows and four green**. The green rows are the ones to read first: in a
matrix where everything is red, a broken baseline scores identically to a perfect guard, so only the
rows expected to stay green can falsify the instrument. A red row that has gone green means the
control stopped engaging, not that the renderer improved — the gate asserts each seam's read-back
before it scores the row, and prints whether the witness was the renderer's own policy or merely an
echo of the query parameter.

**One measure in that matrix has no live control, and it is `homeLabels`.** §3.1's table lists a
sixth red row — `labels forced on for empty planes` — which this gate does not run: forcing labels
on for suppressed planes is renderer behaviour, and the build ships exactly four seams
(`?swatch=mean`, `?bands=shuffle`, `?artThreshold=fixed24`, `?layers=N`), none of which reaches
§1.8's suppression. The unsuppressed 66–77 reading that makes the row red was taken offline through
the shipped layout code, so it shows the measure *can* fail without being a row the gate can run.
Read a green `homeLabels` as "the moons are still quiet", never as "the home view is legible" — the
second is what `worldsNeverLabelled` is for, and that one does have both its rows.

Same two practical notes as §4.2: a real GPU and a local Chrome, and it builds the site itself
unless you pass `--no-build`.

**At the cutover this section replaces §4.2**, which retires with the galaxy along with PRD 9.3's
criterion 2 and review T7.

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

**Attach §4.2's captures.** PRD 9.4 makes the owner's acceptance of the visual review part of done,
and the owner cannot accept frames that are sitting in a directory on your laptop. Say in the body
which dataset they were taken on and how the arms compare to the previous refresh.

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
- **Do not skip 4.2 because 4.1 was green.** A refresh moves plane positions (PRD 4.9.3), and the
  arm geometry PRD 9.3 is judged on comes out of the data. Green automated checks over a multiverse
  whose arms stopped reading is the exact failure 4.2 exists to catch.
