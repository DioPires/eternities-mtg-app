# The parked page's transfer is bounded by the HTTP cache, not by the product (DEC-848)

DEC-838 measured a dominaria page parked at one world for 660 s (2.5 spin revolutions) and found
that **transfer converges**: 287.0 MiB by t≈228 s, and 0.0 KiB/s on the wire from there to the end
of the run. That retracted the flag's "~1,380–1,415 KiB/s indefinitely" as a transfer figure — it is
`blob.size`, the volume handed to the decoder, and a 200 served from Chrome's HTTP cache reports it
identically to one that crossed the network.

The convergence rested on a premise DEC-838 stated but could not test: Chrome's cache held the whole
working set. One machine, one fresh profile, ample disk. This note is the arm that tests it.

## What was run

`web/scripts/dec838-wire-bytes.mjs` on `main` (`eef5c9c`), product code untouched, three arms on one
machine within 34 minutes of each other. Each arm: dominaria, `?probe=shell`, 2.2 radii, 15 s pose
heartbeat, pose-loss guard armed, 660 s, 221 samples. The arms differ in **one** parameter —
`--cache-mib`, which sets Chrome's `--disk-cache-size` against an explicit, freshly wiped profile.

Wire bytes are CDP `Network.loadingFinished.encodedDataLength`. Every sustained rate below is scored
against its own second half.

## The three arms

| Measure | Control (default quota) | 128 MiB quota | 32 MiB quota |
|---|---|---|---|
| wire MiB at t=240 | 287.0 | 353.9 | 425.2 |
| wire MiB at t=660 | **287.0** | **803.7** | **1,027.6** |
| wire KiB/s, t=240→660 | 0.0 | 1,094.3 | 1,465.4 |
| wire KiB/s, t=450→660 (own second half) | 0.0 | 1,112.7 | 1,488.5 |
| body MiB at t=660 | 1,024.7 | 1,025.1 | 1,025.1 |
| body KiB/s, t=450→660 | 1,484.9 | 1,484.5 | 1,484.8 |
| distinct URLs | 3,489 | 3,489 | 3,489 |
| repeat responses | 9,095 | 9,099 | 9,100 |
| `artFromCache` | **9,095** | **2,771** | **0** |
| network responses | 3,489 | 9,817 | 12,589 |
| refetches (network − distinct) | **0** | **6,328** | **9,100** |
| cache on disk after exit (MiB) | 302.3 | 117.1 | 30.1 |
| `artFraction` mean | 0.9909 | 0.9907 | 0.9907 |
| max radii departure | 2.5e-10 | 2.5e-10 | 2.5e-10 |

**The control reproduces DEC-838 to the digit** — 287.046 MiB, 3,489 distinct URLs, 221 samples,
`artFromCache == repeats` at every one, 0.0 KiB/s over both the whole tail and its second half. The
instrument did not move, so the two constrained arms are differences in the quota and nothing else.

**The quota took, read two independent ways.** The profile's own `Cache/` tree, walked after Chrome
exited, lands at 117.1 MiB under a 128 MiB quota and 30.1 MiB under a 32 MiB one, against the
control's 302.3 MiB. And the behaviour the flag exists to cause appears: `artFromCache` stops
tracking `repeats` — 9,095 of 9,095 in the control, 2,771 of 9,099 at 128 MiB, **0 of 9,100** at
32 MiB. Neither reading alone would be evidence; a flag Chrome silently ignored would show a normal
cache directory *and* a normal hit rate.

## What it says

**Transfer is not bounded on a cache-starved device. It is a sustained rate, and the rate does not
decay:** every constrained arm reads *higher* over its own second half than over the whole window
(1,112.7 vs 1,094.3 KiB/s at 128 MiB; 1,488.5 vs 1,465.4 at 32 MiB). By t=660 the 32 MiB arm has
transferred 1,027.6 MiB — 3.6× the control's total, still climbing, and on course for ~5.1 GiB in an
hour.

**The ceiling is the decode rate, and the 32 MiB arm is already at it.** Its wire (1,488.5 KiB/s)
and its body (1,484.8 KiB/s) agree to 0.25%: every byte the decoder consumes crossed the network,
because the cache contributes literally nothing. That is the structural bound — the page cannot
transfer faster than it decodes — and it means DEC-838's retracted "~4.9 GiB/hour" was not wrong so
much as **mis-attributed**. It is the correct figure for a device whose cache cannot hold the
working set, and the wrong one for the reference environment in PRD 7.1.

**The working set is a property of the pose, not of the cache.** All three arms close at exactly
3,489 distinct URLs with a maximum of 6 responses for any one of them. The quota changes how often
the page re-pays for those keys, not which keys it wants.

**Nothing in the product notices.** `artFraction` reads 0.9907–0.9909 across all three arms, and the
pose held to 2.5e-10 radii. The picture on a cache-starved device is indistinguishable from the
picture on the reference machine; the device simply pays 3.6× the bytes for it. There is no
self-correcting mechanism and no signal a user or an operator could act on — which is the case for
writing the device-class qualifier into PRD 7.2 rather than leaving the row to imply a bound it only
has on one class of machine.

## Recommended PRD 7.2 row

| Measure | Target | Ceiling |
|---|---|---|
| Art transferred by a page held at one world, to convergence (7.1's reference environment) | ≤ 320 MB | 500 MB |

- The control measures **287.0 MiB = 301.0 MB**, so a 300 MB target would fail on the number it was
  written from. 320 MB is the nearest round target above the measurement; 500 MB leaves 66% headroom.
- **The row needs the device-class qualifier, and the qualifier is a precondition, not a footnote.**
  "To convergence" is undefined on a device whose HTTP cache quota sits below the working set: there
  is no convergence there, only a rate. Both numbers above are conditional on the cache holding the
  working set — which 7.1's reference environment (Apple Silicon MacBook, ample disk) does, at a
  measured 302.3 MiB.
- The unqualified case cannot honestly be written as a byte total. If 7.2 is to say anything about
  it, say the rate: **a page parked at one world on a device that cannot cache its working set
  transfers at up to the decode rate, ~1,490 KiB/s (~5.1 GiB/hour), indefinitely.**
- **Not measured here:** whether 287 MiB is the largest working set the product has. It is
  dominaria's parked-pose roster — 3,489 of its 6,271 cards. A larger world, or a pose that presents
  more cells, moves the number, and no arm in this run varies either. A ceiling written from one
  world's one pose should be re-derived before it is treated as a bound over the roster.

## Reproducing

```
cd web && ETERNITIES_DATASET=worlds pnpm build
node scripts/dec838-wire-bytes.mjs --seconds 660 --out worlds-gate/dec848-control
node scripts/dec838-wire-bytes.mjs --seconds 660 --cache-mib 128 --out worlds-gate/dec848-q128
node scripts/dec838-wire-bytes.mjs --seconds 660 --cache-mib 32  --out worlds-gate/dec848-q32
```

Each arm writes `rows.json` (221 samples) and `summary.json`. The fixed windows (t=240, t=450,
t=660) are stated in wall clock rather than in the plateau's terms, because a cache-starved arm keeps
re-filling and its plateau does not begin where the control's does — the three arms are only
comparable over a window all three share.
