# Cross-browser pass (PRD 7.1.2)

Produced by `pnpm cross-browser` on 2026-09-05. **That script was archived by DEC-708** under the
`review-tooling-2026-09` tag (review §6.1 group C), so this file is now a dated record rather than
something you re-run. Review §9's Windows measurement kit (`web/bench/windows/`, `pnpm
windows-kit`) is what regenerates this evidence — and it is the one that matters, because every
row below is macOS and PRD 7.1.2 asks for Windows too. To reproduce the table as written:
`git show review-tooling-2026-09:web/scripts/cross-browser.mjs > web/scripts/cross-browser.mjs`.

> **This run is stale.** The dataset below is three refreshes behind what is committed
> (`dabe2c9a68b4d799` today), and no Windows or integrated-GPU engine has ever been driven —
> review §9 and DEC-691's measurement kit exist to close that. The engine results are still the
> record of what passed on 2026-09-05; do not read the dataset line as current.

- **Run:** 2026-09-05
- **Machine:** macOS 26.5, Apple M5 Pro
- **Dataset:** `production` (d5ee9661aaffafa3)
- **Viewport:** 1920×1080 (PRD 7.1.1)

## Engines driven on this machine

| Engine | Version | What it actually is | Result |
|---|---|---|---|
| Chrome | 152.0.7977.76 | Google Chrome, release channel, as installed on this machine | pass |
| Firefox | 132.0 | Playwright's pinned Gecko build | pass |
| WebKit | 18.2 | Playwright's pinned WebKit build — Safari's engine, not Safari | pass |
| Safari | — | Safari itself, driven through `safaridriver` | not tested — Remote Automation is off on this machine (Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers", then Develop ▸ "Allow Remote Automation") |

## What each engine was asked

| Engine | Shell + deep link (8.9.2) | GPU self-check, float16 (8.5.7) | float32 fallback (risk 6) | Touch (6.1.5) | WebGL2 fallback (7.1.2) | Console + network |
|---|---|---|---|---|---|---|
| Chrome | pass — 1920×1080 buffer on ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version) | pass — 426/720 located, mean 0.33px, max 1.41px (tol 3px) | pass — 427/720 located, mean 0.32px, max 1.41px (tol 3px) | pass — pinch raised nothing, `touch-action: none` | pass — plain explanation, 0 canvases | clean; 0 load(s) cancelled by navigation |
| Firefox | pass — 1920×1080 buffer on Apple M1, or similar | pass — 417/720 located, mean 0.31px, max 1.41px (tol 3px) | pass — 422/720 located, mean 0.32px, max 1.41px (tol 3px) | n/a — no constructible `Touch` on this desktop engine; `touch-action: none` verified | pass — plain explanation, 0 canvases | clean; 0 load(s) cancelled by navigation |
| WebKit | pass — 1920×1080 buffer on Apple GPU | pass — 426/720 located, mean 0.33px, max 1.41px (tol 3px) | pass — 426/720 located, mean 0.34px, max 1.41px (tol 3px) | n/a — no constructible `Touch` on this desktop engine; `touch-action: none` verified | pass — plain explanation, 0 canvases | clean; 1 load(s) cancelled by navigation |
| Safari | — | — | — | — | — | — |

## PRD 7.1.2 support matrix, tested or not

| Browser | Platform | Status |
|---|---|---|
| Chrome | macOS 26.5, Apple M5 Pro | tested, pass (152.0.7977.76) |
| Safari | macOS 26.5, Apple M5 Pro | not tested — Remote Automation is off on this machine (Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers", then Develop ▸ "Allow Remote Automation") |
| Firefox | macOS 26.5, Apple M5 Pro | tested, pass (132.0) |
| WebKit (Safari engine) | macOS 26.5, Apple M5 Pro | tested, pass (18.2) |
| Chrome | Windows | not tested — no Windows hardware or remote browser service available |
| Safari | Windows | n/a — Safari does not ship on Windows |
| Firefox | Windows | not tested — no Windows hardware or remote browser service available |
| Chromium | Linux (GitHub Actions) | tested on every push, SwiftShader — proves the routes, proves nothing about a driver |
| Firefox | Linux | not tested — no Linux hardware or remote browser service available |
| Safari | Linux | n/a — Safari does not ship on Linux |

## What the run found

**WebKit cannot load this site over `http://localhost`.** PRD 7.6.1's CSP ends in `upgrade-insecure-requests`, and WebKit applies it to loopback where Chrome and Firefox exempt loopback as already-trustworthy. Under `vite preview` — which is what `pnpm bench`, `pnpm verify-browser` and the Playwright suite all use — WebKit rewrites every subresource to `https://localhost:<port>`, the TLS handshake fails, and the page renders nothing: no canvas, no HUD, no error message. `127.0.0.1` upgrades identically, so it is the directive and not the host form.

This is a fact about local tooling, not about the product: production is HTTPS (PRD 8.8.1), where every subresource URL is already `https` and the directive is a no-op. The evidence for that claim is this table — `pnpm cross-browser` serves `dist/` over a real HTTPS origin with `securityHeaders({ dev: false })`, the same function that generates `vercel.json`, and WebKit passes every check. **The practical consequence is for anyone checking Safari locally:** `pnpm preview` will show them a blank page, and the reason will not be visible. Use a Vercel preview deployment, or this script.

**No engine differed on the GPU self-check.** Metal through ANGLE, Gecko and WebKit agree with the CPU motion mirror to well under half the tolerance, at both float16 and float32. PRD risk 6 anticipated float16 attribute and data-texture precision trouble; on this machine there is none to report.

**The self-check counts above are a sample, not an expectation.** The `N/720 located` figures and the mean/max pixel deltas vary from run to run on an unchanged tree — a re-run of this same head moved Chrome 422→427 and 421→429, WebKit 426→431 and 422→428, and Firefox’s max from 1.41 px to 2 px (DEC-667 N7). The star field is in motion and the sampling window follows it, so the population differs between runs. What is asserted is the **tolerance** — every located star within 3 px of where the CPU mirror predicts — not any particular count. Read a changed number here as a new sample, and a *failed* column as the regression.

## Reading this

The **GPU self-check** columns are the load-bearing ones. PRD risk 6 names float16 attributes, data-texture precision and Safari WebGL2 quirks; each is a claim about a driver, and the self-check of PRD 8.5.7 is the only thing in this repo that puts the CPU motion mirror on one side of a comparison and a real rasteriser on the other. CI proves the routes on SwiftShader and cannot speak to any of it.

The columns were checked against deliberate breakage rather than trusted for being green. Four mutations, each caught: displacing the CPU motion mirror by 0.06 local units fails the self-check on all three engines; making the call site drop the `?positions=` parameter fails the float32 column with `asked for float32 positions, the run used float16`; making the harness stop removing WebGL2 fails the fallback column with one canvas still mounted; and `touch-action: auto` fails the touch column. A column that cannot go red is not evidence.

A pass here is not the visual review. PRD 9.3 is seven checkpoints judged by the owner, and nothing in this file substitutes for it.
