# Cross-browser pass (PRD 7.1.2)

Run on 2026-09-14 against the migrated toolchain, for DEC-741 (W4.3). This is the evidence that
three r186, Vite 8 and React 19 did not cost us an engine — which is the only reason to re-run a
driver pass at a version bump, and the reason the toolchain is recorded below alongside the machine.

**The script that produces this file is archived.** DEC-708 retired
`web/scripts/cross-browser.mjs` under the `review-tooling-2026-09` tag (review §6.1 group C), so
`pnpm cross-browser` does not exist. This run restored it from the tag, ran it, and did not
re-commit it — the archival was a deliberate decision and reversing it is not this leg's to make.
To reproduce:

```sh
git show review-tooling-2026-09:web/scripts/cross-browser.mjs > web/scripts/cross-browser.mjs
pnpm exec playwright install firefox webkit     # only Chromium is installed by default
node web/scripts/cross-browser.mjs --dataset production --out docs/cross-browser.md
rm web/scripts/cross-browser.mjs
```

The generated file is a *template* as much as a report: parts of its prose are hardcoded in the
script and do not follow the run. Two of them were wrong on regeneration and are corrected here —
it tells the reader to `pnpm cross-browser`, which no longer resolves, and its sampling paragraph
quotes `N/720` while this run sampled 770. Read this file as edited-from-the-run, not as machine
output.

Review §9's Windows measurement kit (`web/bench/windows/`, `pnpm windows-kit`) remains what covers
the rows this machine cannot: every engine below is macOS, and PRD 7.1.2 asks for Windows too.

- **Run:** 2026-09-14
- **Machine:** macOS 26.5, Apple M5 Pro
- **Toolchain:** three 0.186.0, Vite 8.3.0, React 19.3.0, TypeScript 5.9.3 (DEC-741)
- **Dataset:** `production` (c9468f1125bcddff)
- **Viewport:** 1920×1080 (PRD 7.1.1)

## Engines driven on this machine

| Engine | Version | What it actually is | Result |
|---|---|---|---|
| Chrome | 153.0.8010.37 | Google Chrome, release channel, as installed on this machine | pass |
| Firefox | 155.0 | Playwright's pinned Gecko build | pass |
| WebKit | 26.6 | Playwright's pinned WebKit build — Safari's engine, not Safari | pass |
| Safari | — | Safari itself, driven through `safaridriver` | not tested — Remote Automation is off on this machine (Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers", then Develop ▸ "Allow Remote Automation") |

## What each engine was asked

| Engine | Shell + deep link (8.9.2) | GPU self-check, float16 (8.5.7) | float32 fallback (risk 6) | Touch (6.1.5) | WebGL2 fallback (7.1.2) | Console + network |
|---|---|---|---|---|---|---|
| Chrome | pass — 1920×1080 buffer on ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version) | pass — 433/770 located, mean 0.42px, max 1.41px (tol 3px) | pass — 433/770 located, mean 0.41px, max 2px (tol 3px) | pass — pinch raised nothing, `touch-action: none` | pass — plain explanation, 0 canvases | clean; 0 load(s) cancelled by navigation |
| Firefox | pass — 1920×1080 buffer on Apple M1, or similar | pass — 421/770 located, mean 0.42px, max 1.41px (tol 3px) | pass — 413/770 located, mean 0.42px, max 1.41px (tol 3px) | n/a — no constructible `Touch` on this desktop engine; `touch-action: none` verified | pass — plain explanation, 0 canvases | clean; 0 load(s) cancelled by navigation |
| WebKit | pass — 1920×1080 buffer on Apple GPU | pass — 433/770 located, mean 0.41px, max 1.41px (tol 3px) | pass — 433/770 located, mean 0.41px, max 1.41px (tol 3px) | n/a — no constructible `Touch` on this desktop engine; `touch-action: none` verified | pass — plain explanation, 0 canvases | clean; 1 load(s) cancelled by navigation |
| Safari | — | — | — | — | — | — |

## PRD 7.1.2 support matrix, tested or not

| Browser | Platform | Status |
|---|---|---|
| Chrome | macOS 26.5, Apple M5 Pro | tested, pass (153.0.8010.37) |
| Safari | macOS 26.5, Apple M5 Pro | not tested — Remote Automation is off on this machine (Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers", then Develop ▸ "Allow Remote Automation") |
| Firefox | macOS 26.5, Apple M5 Pro | tested, pass (155.0) |
| WebKit (Safari engine) | macOS 26.5, Apple M5 Pro | tested, pass (26.6) |
| Chrome | Windows | not tested — no Windows hardware or remote browser service available |
| Safari | Windows | n/a — Safari does not ship on Windows |
| Firefox | Windows | not tested — no Windows hardware or remote browser service available |
| Chromium | Linux (GitHub Actions) | tested on every push, SwiftShader — proves the routes, proves nothing about a driver |
| Firefox | Linux | not tested — no Linux hardware or remote browser service available |
| Safari | Linux | n/a — Safari does not ship on Linux |

## What the run found

**The toolchain bump cost nothing an engine can see.** All three drivable engines pass the same
battery they passed on 2026-09-05, on three r186 instead of r170 and a rolldown-built bundle
instead of a rollup one. This is the check that mattered: r170→r186 crosses the r177 colour-
management renames, r183's `Clock` deprecation, r184's pixel-storage routing and r185's
`updateWorldMatrix` change, and a source audit finding zero call sites is an argument, not a
measurement. The self-check is the measurement, and it is unmoved on Metal, Gecko and WebKit alike.

**WebKit cannot load this site over `http://localhost`.** PRD 7.6.1's CSP ends in
`upgrade-insecure-requests`, and WebKit applies it to loopback where Chrome and Firefox exempt
loopback as already-trustworthy. Under `vite preview` — which is what `pnpm bench` and the
Playwright suite both use — WebKit rewrites every subresource to `https://localhost:<port>`, the
TLS handshake fails, and the page renders nothing: no canvas, no HUD, no error message.
`127.0.0.1` upgrades identically, so it is the directive and not the host form.

This is a fact about local tooling, not about the product: production is HTTPS (PRD 8.8.1), where
every subresource URL is already `https` and the directive is a no-op. The evidence for that claim
is this table — the archived script serves `dist/` over a real HTTPS origin with
`securityHeaders({ dev: false })`, the same function that generates `vercel.json`, and WebKit
passes every check. **The practical consequence is for anyone checking Safari locally:**
`pnpm preview` will show them a blank page, and the reason will not be visible. Use a Vercel
preview deployment, or this script.

**No engine differed on the GPU self-check.** Metal through ANGLE, Gecko and WebKit agree with the
CPU motion mirror to well under half the tolerance, at both float16 and float32. PRD risk 6
anticipated float16 attribute and data-texture precision trouble; on this machine there is none to
report.

**The self-check counts above are a sample, not an expectation.** The `N/770 located` figures and
the mean/max pixel deltas vary from run to run on an unchanged tree (DEC-667 N7): the star field is
in motion and the sampling window follows it, so the population differs between runs. Chrome's
float32 row reading `max 2px` where its float16 row reads `1.41px` is that variance and not a
precision finding — the 2026-09-05 run saw the same spread land on Firefox instead. What is
asserted is the **tolerance** — every located star within 3 px of where the CPU mirror predicts —
not any particular count. Read a changed number here as a new sample, and a *failed* column as the
regression.

The denominator moved from 720 to 770 between the 2026-09-05 run and this one. That is the dataset
refresh (`production` is now `c9468f1125bcddff`), not the toolchain: the sampling window covers
more stars because there are more stars. It is why the located counts are not comparable
line-for-line with the previous edition of this file, and the tolerance is.

## Reading this

The **GPU self-check** columns are the load-bearing ones. PRD risk 6 names float16 attributes,
data-texture precision and Safari WebGL2 quirks; each is a claim about a driver, and the self-check
of PRD 8.5.7 is the only thing in this repo that puts the CPU motion mirror on one side of a
comparison and a real rasteriser on the other. CI proves the routes on SwiftShader and cannot speak
to any of it.

The columns were checked against deliberate breakage rather than trusted for being green, when the
script was live. Four mutations, each caught: displacing the CPU motion mirror by 0.06 local units
fails the self-check on all three engines; making the call site drop the `?positions=` parameter
fails the float32 column with `asked for float32 positions, the run used float16`; making the
harness stop removing WebGL2 fails the fallback column with one canvas still mounted; and
`touch-action: auto` fails the touch column. A column that cannot go red is not evidence. Those
mutations were not re-run for this pass — the battery is unchanged code from the tag, and what
DEC-741 re-measured is the engines under it.

A pass here is not the visual review. PRD 9.3 is seven checkpoints judged by the owner, and nothing
in this file substitutes for it.
