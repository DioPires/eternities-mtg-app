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
review and the browser check below, both of which are cheap.

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

**The two numbers on the cache-buster line count different things** (DEC-673 N2). `N card(s)` is
the cards whose **only** symptom was cache-buster churn; `M printing tuple(s)` is **every**
cache-buster tuple in the diff, including tuples on cards that also changed in some other way and
are therefore reported in a louder bucket instead. So `M` can exceed what `N` accounts for, and the
two agreeing — as they nearly do above, 38 and 40 — is a coincidence of this particular diff, not
an invariant. Read `N` as "how many cards were pure noise" and `M` as "how much of this diff is
noise"; do not read `M` as belonging to those `N`.

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
churn alone puts a full copy of every touched shard into git history on every refresh. That is PRD
risk 8's growth, arriving for no product reason. Nothing to do about it today; worth watching, and
worth remembering that amendment A2 rules out Git LFS as the escape hatch (see `docs/deployment.md`).

---

## 4. Verify the built site

```sh
cd web
node scripts/check-budget.mjs --dataset <new-hash>
node scripts/verify-browser.mjs --dataset production
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

`verify-browser` drives the real dataset through the shell, the scene and the card tier on a real
GPU, under the production CSP. It is the check that the new data actually *loads* — a report can be
perfect over artefacts a browser cannot decode. On 2026-09-05 it passed with 0 failed Scryfall image
requests, which is the part only a real-id dataset can tell you.

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
after the CEO merges. On 2026-09-05, before the refresh merged, it returned:

```
    <meta name="eternities:data" content="/data/d5ee9661aaffafa3/" />
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
  The page renders blank with no error. Use `pnpm cross-browser`, which serves over real HTTPS, or a
  Vercel preview deployment. See `docs/cross-browser.md`.
- **Do not skip `verify-browser` because the report was clean.** They check different things: one
  reads the pipeline's own account of the run, the other decodes the artefacts in a browser.
