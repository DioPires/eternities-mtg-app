# Decision: keep `imageTs`, and stop calling its churn a repository risk

**Decision: keep `imageTs` as it is. Do nothing now.** Re-measurement at the point of writing this
record contradicts the number that made the churn look expensive, so this is a decision to leave it
alone with a trigger attached, not a decision to defer a known cost.

Recorded 2026-09-05 as the follow-up the Phase 6 pipeline review (DEC-592) asked for, so that
"worth watching" does not quietly become permanent. This record implements nothing.

---

## 1. What the churn is

Every plane shard carries, for each printing, a Scryfall image timestamp:

```
p: [ [ printingId, setIndex, rarity, imageTs, collectorNumber ], ... ]
```

`imageTs` is the cache-buster in the image URL that `web/src/data/images.ts` builds:

```
https://cards.scryfall.io/{size}/{face}/{id[0]}/{id[1]}/{id}.jpg?{imageTs}
```

Scryfall moves that timestamp on its own schedule. When it moves, the shard containing the card is
rewritten, and git stores a new blob for the whole file — so a refresh that changes nothing a user
could see still produces a diff.

The 2026-09-05 refresh is the worked example. Against the previous production dataset
(`d5ee9661aaffafa3` → `97984b20156c63f0`), 84 of 98 files were byte-identical and **14 changed:
13 plane shards plus `manifest.json`**, totalling **9,078,849 bytes (8.66 MB) of raw JSON**.

Inside those 14, the change is as small as it gets. In `planes/kaldheim.0.json` — 148,389 bytes,
303 cards, identical in length before and after — exactly **one card differs, in exactly one field**:

| | printing | `imageTs` | as a date |
|---|---|---|---|
| before | `ea164381…6285dd` | `1783916585` | 2026-07-13 |
| after | `ea164381…6285dd` | `1788503469` | 2026-09-04 |

One integer moved by 53 days, and a 148 KB file was rewritten.

## 2. The cost, measured properly

The Phase 6 review recorded **3.42 MB added to the pack per no-change refresh**. That figure is an
artefact of how it was measured, and it overstates the real cost by roughly three orders of
magnitude. Recording the correction is the main reason this document exists.

Packing *only* the objects the refresh introduces reproduces a megabyte-scale number, because that
pack is forbidden from referencing the predecessor shards it should be delta-ing against:

```
$ git rev-list --objects origin/refresh-2026-09-05 ^origin/main | git pack-objects --stdout | wc -c
3058218          # 2.92 MB — 25 objects, no delta base available
```

Packing the repository as it will actually be stored — old and new datasets in one pack, which is
what `git gc` and every server-side repack produce — gives the true marginal cost:

```
$ git rev-list --objects origin/main | git pack-objects --stdout | wc -c
47672848         # 45.46 MB
$ git rev-list --objects origin/main origin/refresh-2026-09-05 | git pack-objects --stdout | wc -c
47677190         # 45.47 MB
```

**One no-product-change refresh costs 4,342 bytes — about 4.2 KB — not 3.42 MB.**

`git verify-pack` on that union pack shows why. Because each new shard differs from its predecessor
by a few integers, git stores it as a delta:

| shard | raw size | stored in pack |
|---|---|---|
| `kaldheim.0.json` | 148,389 | **25 bytes** |
| `capenna.0.json` | 175,968 | **29 bytes** |
| `ravnica.0.json` | 960,053 | **93 bytes** |
| `dominaria.0.json` | 1,241,841 | **118 bytes** |
| `blind-eternities.0.json` | 1,000,375 | **241 bytes** |

Five shards, 3.5 MB of raw JSON, 506 bytes on disk. The 8.66 MB is real as raw JSON and irrelevant
as storage.

### The 91 MB `.git` is a different problem

`.git` did measure 91 MB on 2026-09-05, but that is not refresh churn:

```
$ git count-objects -v
count: 2385
size: 91748
in-pack: 0
packs: 0
```

**The repository has no packfile at all** — all 2,385 objects are loose. A full repack is 45.46 MB,
so roughly half of the 91 MB is unpacked slack that a single `git gc` reclaims. Attributing it to
`imageTs` would be a misdiagnosis, and shrinking the payload would not have fixed it.

## 3. Why the cache-buster is not load-bearing

Checked against the live CDN on 2026-09-05, using the one printing whose `imageTs` actually moved.
Four requests for the same image, differing only in query string:

| request | status | bytes | sha256 (16) |
|---|---|---|---|
| `?1788503469` (current) | 200 | 14123 | `2fb4562cefa19e3a` |
| `?1783916585` (previous) | 200 | 14123 | `2fb4562cefa19e3a` |
| no query string at all | 200 | 14123 | `2fb4562cefa19e3a` |
| `?1` (bogus) | 200 | 14123 | `2fb4562cefa19e3a` |

All four are byte-identical, and the response carries:

```
cache-control: public, max-age=31556952      # 365.2 days
last-modified: Mon, 29 Jun 2026 15:49:05 GMT
```

Two conclusions. First, **`imageTs` is an invalidation hint, not addressing** — the CDN ignores the
query entirely, so a wrong or missing value still returns the correct image. Nothing breaks without
it; the only exposure is serving art from a client or intermediary cache that a `max-age` of about
one year would otherwise hold. Second, `last-modified` (2026-06-29) *predates both* `imageTs`
values, so the timestamp is not the image's modification time — it moves without the bytes moving.
Much of this churn is not tracking a real image change at all.

## 4. Revisit trigger

Leave `imageTs` alone until **`.git` passes 500 MB, or ten refreshes have landed, whichever comes
first.** At that point, work through §5.

The trigger is kept as the review specified it, but note what §2 does to the arithmetic: at 4.2 KB
per refresh, the 500 MB limb is unreachable — it is about 100,000 refreshes away, and the dataset
baseline plus a `git gc` dominate it completely. **The ten-refresh limb is the one that will fire**,
and it will fire on a schedule rather than in response to a cost. Treat it as a scheduled review,
and if the numbers still look like §2 when it fires, the right outcome may be to raise the trigger
rather than to adopt an option.

## 5. The three options to evaluate at the trigger

1. **Drop `imageTs`.** Cheapest to build; removes the churn at its source and shrinks every shard.
   Costs correctness at the edges: a card whose art is re-scanned can serve stale art from cache for
   up to the ~1-year `max-age` measured in §3.
2. **Quantise to the month.** Round the timestamp down to a month boundary. Collapses most of the
   churn — the 53-day move in §1 becomes at most one change instead of one per Scryfall touch —
   while keeping invalidation bounded to about 30 days. Middle cost, middle benefit.
3. **Move it to one side file keyed by printing id.** Churn then touches a single file per refresh
   instead of spreading across 13 shards, with no behaviour change and no staleness. Costs an extra
   fetch or a larger manifest on the client, and is the most work of the three.

No option is pre-favoured. §2 lowers the value of all three, so the option chosen at the trigger
must clear the bar of being worth more than the ~4 KB per refresh it saves.

## 6. The rule for landing the winner

**Whichever option wins rides along with the next contract bump. It never causes one.**

All three change the shard payload, so all three are contract changes
(`docs/data-contract.md`, `contractVersion`). A bump costs a full pipeline run whose §9.2.3 refresh
diff has no meaningful number to report, because everything moves for an unrelated reason. Spending
that on `imageTs` alone is not worth it at 4.2 KB per refresh. Park the winner until a bump is
happening for its own reasons, then include it.

---

## Provenance

Facts in §1–§3 were re-measured on 2026-09-05 against `origin/main` at `7a33354` and
`origin/refresh-2026-09-05` (PR #24). The 8.66 MB raw figure, the 91 MB `.git`, and the CDN
behaviour reproduce the Phase 6 review exactly. The 3.42 MB pack figure does not reproduce and is
corrected here to 4,342 bytes; see §2 for the measurement that distinguishes them.
