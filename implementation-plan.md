# Eternities — Implementation Plan

**Contract:** `prd_v3.md` (verified clean, see `prd-review.md`), plus the two PRD amendments proposed in §8 below — they need board approval together with this plan.
**Plan revision:** v2, 2026-09-04. Revision v1 failed an adversarial soundness review; the findings and their dispositions are in `implementation-plan-review.md`. v2 fixes every accepted finding.
**Repository:** this repository (`eternities-mtg-app`), deployed as a standalone app on Vercel.
**Issue:** DEC-584. Author: CEO.

## 1. Strategy

Three facts shape the plan:

1. **The interfaces are the freeze points.** The pipeline (Python) and the web app (TypeScript) meet at the artefact formats in PRD 8.3. The UI layer and the 3D scene meet at a navigation API (fly-to, focus, input hand-over). Both interfaces get frozen in Phase 0 — a schema doc, a shared test vector for the data contract, and a typed stub for the navigation contract — so the parallel workstreams build against contracts, not against each other's unfinished code.
2. **The rendering core is the risk.** One draw call for ~30k stars, motion in the vertex shader, id-buffer picking, and the 60 fps budget are where the product succeeds or fails. That work starts as early as possible, against a full-scale synthetic fixture, and gets the first visual review gate.
3. **The critical path must not run through one person.** The old Phase 2 is split: the star-field renderer and the camera/navigation rig are separate workstreams with separate owners.

So the plan is: scaffold and freeze both contracts, then run the pipeline, the star renderer, the camera rig, and the UI shell as four parallel workstreams; add the card tier; close with quality gates and launch.

## 2. Phases

### Phase 0 — Scaffold and contracts (blocks everything; contract design work, not just scaffolding)

**Owner: Founding Engineer. Reviewer: Frontend Engineer (contracts also reviewed by Interactive Tools Engineer).**

- Repository layout per PRD 8.1: `pipeline/` (Python 3.13, uv, Ruff, basedpyright, pre-commit) and `web/` (Vite, React, TypeScript strict, react-three-fiber, drei, @react-three/postprocessing, Zustand, pnpm, committed lockfile). Pinned dependencies (7.7.3).
- **Data contract module**: the artefact formats of PRD 8.3 (star record layout, `manifest.json`, `planes.json`, `search.json`, `sets.bin`, plane shards) written down as a schema doc plus a TypeScript decoder and a Python encoder, with a shared byte-level test vector. `sets.bin` and `search.json` are only sketched in the PRD; their concrete layout is design work here, and the 7.2 row (≤ 700 KB target for the pair) decides it — 30k `oracle_id`s must be 16-byte binary, not strings, or the budget fails. Includes the plane-shard budget row and all-planes sharding rule from amendment A1 (§8). This is the freeze point; any later format change is a reviewed contract change.
- **Navigation contract module**: a typed API for everything the UI asks of the scene — `flyToPlane`, `flyToCard` (two-stage, 6.2.3), `focus` state, input-hand-over events, intro flight, attract-mode enter/exit — with a no-op stub implementation. Phase 4 builds against the stub; Phase 2b implements it. Any change is a reviewed contract change.
- **Fixture datasets**, committed under hash-style directories (so the immutable `/data/**` cache rule of 8.8.2 stays honest): `fixture-small` (3–4 planes, ~500 cards, one Blind Eternities shard) for semantic and decoder tests, and `fixture-scale` (all 82 Appendix A planes including zero-card planes, ~30k synthetic stars, sharded Blind Eternities) generated with the seeded layout rules of 8.6, for performance and label-collision work. Web work never waits on the pipeline, and bench numbers mean something from the first shader commit.
- **Scryfall policy and CORS verification** (risk 1, open question 5): read the current Scryfall imagery/API policy, and confirm the image CDN sends CORS headers that allow `createImageBitmap` + WebGL texture upload with `crossOrigin` set. This is a zero-cost check that the whole card tier depends on; it happens before any dependent code, and is re-confirmed at Phase 6. If it fails, the PRD's 4.11.3/8.10 constraints leave no compliant fallback — the board hears about it now, not at launch.
- CI skeleton (GitHub Actions): pipeline tests, web type-check, build, payload-budget check wired to the PRD 7.2 table (plus the A1 shard row) from day one, measuring **encoded transferred size**, not disk size (`.bin` may not be edge-compressed; the check must see what the browser sees).
- Vercel project connected: production from `main`, preview per PR, `vercel.json` with SPA rewrites, immutable caching for `/data/**` (8.8), **and the CSP headers of 7.6.1 from day one** — `connect-src` must include Scryfall's image CDN because 8.5.8 fetches images rather than using `<img>`. All later work develops under the real policy; Phase 5 only audits it.
- Build step that injects the current data-directory hash into `index.html` (8.3).

**Exit:** a hello-scene (sky + background starfield) deploys to a Vercel preview under the real CSP; both fixture datasets decode in the browser; the navigation stub type-checks against a demo caller; CI is green; Scryfall policy/CORS verdict recorded.

### Phase 1 — Data pipeline (parallel with 2a/2b/4)

**Owner: Simulation Engineer. Reviewer: Founding Engineer.**

- Stages per PRD 8.2 as pure, unit-tested functions: fetch, filter printings (4.3), exclude cards (4.4), first printing (4.5), assign plane (4.6, fail-loud), layout (8.6), emit (8.3 as amended by A1 + report 4.9.2).
- **The `eternities build` CLI** (8.1.2) as a named deliverable: one command that runs every stage and writes artefacts plus a report to `pipeline/reports/<date>.md`, which is committed alongside the data per 8.8.3.
- Fail loudly on unknown Scryfall enum values — `set_type`, `layout`, `rarity`, `security_stamp` — per 7.7.2, in addition to unmapped sets (4.6).
- Determinism throughout: seeded hashing, `--as-of` run date, byte-identical reruns (8.2, 4.9.1).
- Plane fixtures (9.1.5, ≥ 25 cards) and invariant tests (8.9.1), including no-plane-overlap-under-drift.
- **First-run verification duties** (PRD open questions): `security_stamp: triangle` semantics (Q4), the "verify"-flagged 2026 set codes (Q10), Universes Within `oracle_id` identity (Q12), and the Appendix A roster diff against the MTG wiki. Findings go in the run report; spec-affecting answers come back to the CEO, not silently into code.
- First real run: artefacts committed under `web/public/data/<hash>/` with the report, reviewed by the owner (Blind Eternities baseline recorded per 9.2.2).

**Exit:** deterministic pipeline behind one CLI, all fixtures and invariants green, first real dataset and report committed and reviewed.

### Phase 2a — Star-field renderer (parallel with 1/2b/4, on fixture-scale data)

**Owner: Interactive Tools Engineer. Reviewer: Frontend Engineer.**

- Single-`Points` star renderer with the custom shader: per-plane DataTexture, in-shader rotation + bounded shear (5.4.13), tilt, drift, multiverse rotation, twinkle, filter dimming (8.5.1–5).
- **Float32 position fallback path** alongside the float16 default (PRD risk 6's named mitigation), switchable for GPU/driver variance.
- Streaming `stars.bin` loader with growing draw range; planes fade in one by one (8.3, 6.8.1); failed data chunks retry with exponential backoff, three attempts, then surface one non-blocking error event for the shell's toast (7.4.1).
- Blind Eternities dust as full participants: curl-noise turbulence, focus brightening (5.3.4, 5.3.16, 8.6.3). Zero-card planes render as small dim elliptical glows with no stars (5.3.6), appearing as soon as `planes.json` lands (8.7.2).
- GPU id-buffer picking plus CPU sphere-raycast for planes; CPU motion mirror for the focused star only (8.5.6–7).
- Selective bloom, three-layer parallax background, nebula tint, vignette (5.3.18–21).
- **Adaptive quality core** (8.5.11): the frame-time monitor and the first two degradation steps — pixel-ratio cap 1.5 → 1.0 and bloom resolution — plus step-back-up. (Thumbnail-capacity step lands in Phase 3; the store slot in Phase 4.) This also bounds 4K cost per 7.1.3.
- Per-frame discipline as a review-checklist item, not an afterthought: no allocations in the frame path, overlay updates via `transform` only (7.3.2–3).

**Exit:** fixture-scale (30k stars, 82 planes) renders at 60 fps target / 50 fps ceiling on the reference machine, with bench evidence.

### Phase 2b — Camera, navigation, labels (parallel with 1/2a/4; implements the Phase 0 navigation contract)

**Owner: Founding Engineer. Reviewer: Interactive Tools Engineer.**

- Camera rig: tethered orbit with per-level limits, fly-to tween with velocity-continuous input hand-over, two-stage card fly-to, Blind Eternities anchor semantics (5.7, 6.2, 5.3.4).
- **Intro flight** (6.8.2) and **attract mode** (5.3.22–23): eased drift between planes, dips to plane level, any input cancels without a jump — this is camera work and lives here, not in the UI phase; Phase 4 only triggers it.
- Plane labels as HTML billboards with collision rules (5.3.8–12), **and chronology-band set labels** with the ≥ 120 px visibility rule and below-star priority (5.4.5), exercised against fixture-scale's 82 planes.
- Runtime plane-detail loading per 8.7: `planes/<slug>.json` fetched on focus, Blind Eternities shard-by-shard, **parsed off the main thread in a worker** so a multi-MB shard never blocks the fly-to it arrives during (7.2 frame budget, amendment A1).
- Reduced motion (5.9); frame-rate-independence test (9.1.3).

**Exit:** the navigation contract is fully implemented against the real scene; multiverse and plane levels navigable end to end on fixture-scale, then real data. **Visual review gate #1** with Phase 2a (PRD 9.3 checkpoints 1, 2, 6, 7 — all four are genuinely built by 2a+2b: home view, plane level, Blind Eternities, attract mode).

### Phase 3 — Card tier: thumbnails, card, planets (after 2a; uses 2b's navigation)

**Owner: Interactive Tools Engineer. Reviewer: Design System Engineer.**

- Thumbnail atlas (base level only, no mipmaps), InstancedMesh quads, LRU loader, nearest-first fetch, star↔thumbnail cross-fade at the 24 px threshold (5.5, 8.5.8). Dust participates exactly as stars (8.6.3).
- Focused card: rounded-box mesh, `large` front / Scryfall back, spring tilt, sheen, flip for double-faced cards (5.6.1–6).
- Planets: ≤ 72 spheres, 256 px art-crop textures, ring progression, hover labels, click-to-activate printing (5.6.7–9, 8.5.10).
- Scryfall image loading discipline: 6-concurrent cap, fade-in, failed image leaves the glow or previous image in place — no broken rectangles (7.2, 7.4.2–3, 7.3.5); `crossOrigin` set on every fetch so texture upload is never tainted (verified in Phase 0).
- Adaptive quality's thumbnail-capacity degradation step (8.5.11).
- GPU memory verified against the 96 MB target / 160 MB ceiling on the worst case (a 72-printing card).

**Exit:** full multiverse → card journey works end to end. **Visual review gate #2** (9.3 checkpoints 3, 4).

### Phase 4 — App shell and UI (starts on the Phase 0 stubs; camera-dependent flows integrate as 2b lands)

**Owner: Frontend Engineer. Reviewer: Interactive Tools Engineer.**

Genuinely parallel from day one (against the navigation stub): URL parse/serialise, Zustand store (transient view state + adaptive-quality tier slot, 8.4.2), panel/drawer markup (6.4), search index and result grouping (6.5.1–3), settings, keyboard map (6.10–6.11), WebGL2 detection with the plain-explanation fallback page (7.1.2). Camera-dependent flows (breadcrumb fly-to 6.3.1, history-as-Esc/forward-replay 6.2.2, search fly-to 6.5.4, random 6.9.1, deep-link intro 6.7.3) wire up as Phase 2b delivers the real contract implementation.

- Router with URL as source of truth: routes, filter query params, history-as-Esc, deep-link intro, URL rewrite when a card moved planes (6.7, 6.2.2, 6.8.2, 8.4.1); a dead card link falls back to the multiverse with a toast (PRD risk 9).
- HUD: breadcrumb, filter chips with live exact count, control cluster (6.3).
- Panels: plane and card drawers per 6.4; external links carry `rel="noopener noreferrer"` (7.6.2).
- Search: client-side fuzzy index from `search.json`, grouped results, keyboard navigation, reprint-only-set behaviour, filter-blind results with inline clear (6.5).
- Filters: colour/rarity/type against the star record from first frame; set facet against `sets.bin` with fade-in settle (6.6); rendering per 5.8 comes from 2a's shader dimming.
- First-visit hint, attract-mode trigger/settings surface, random, settings, share toast, keyboard map (6.8–6.11, 6.7.4).
- Non-blocking toast surface for data-chunk failures (7.4.1) wired to the 2a loader's error events.
- Touch input must not break the page (6.1.5) — no gesture support, but no crashes, no stuck states.

**Exit:** every interaction requirement in PRD section 6 works against the real dataset (this exit joins on Phases 1, 2a, 2b).

### Phase 5 — Design polish and accessibility (after Phase 4 core)

**Owner: Design System Engineer. Reviewer: Frontend Engineer.**

- Visual design of HUD, panels, search, hint, toasts: one coherent system over the canvas, self-hosted fonts (7.6.1).
- CSP audit (the policy itself has been live since Phase 0).
- Accessibility pass: 4.5:1 contrast, full keyboard operability with visible focus states, encoding-as-text in panels, reduced-motion audit (7.5).
- About view: Fan Content Policy notice and Scryfall credit (4.11).

**Exit:** accessibility checklist green; owner accepts the UI look.

### Phase 6 — Quality gates, refresh rehearsal, launch (closes everything)

**Owner: Founding Engineer. Reviewer: Simulation Engineer (pipeline side) + Interactive Tools Engineer (bench side).**

- `/bench` route with the scripted camera path and JSON metrics; Playwright smoke in CI; local `pnpm bench` protocol on the reference machine (9.1.2).
- Route smoke tests, payload budgets enforced in CI at ceilings on encoded size (9.1.1, 9.1.6).
- Adaptive quality verified by forced degradation (8.5.11) — implementation landed in 2a/3/4; this is verification only.
- **Cross-browser pass** (7.1.2): current Chrome, Safari, Firefox on this machine; Windows/Linux via whatever real hardware or remote browser service is available, logged honestly as tested-or-not per combination; WebGL2 fallback page verified; float32 fallback exercised. Touch no-break check (6.1.5).
- **Refresh rehearsal**: run the full 8.8.3 flow once end to end — `eternities build`, new `web/public/data/<hash>/` + `pipeline/reports/<date>.md` in a PR titled with the Scryfall bulk timestamp, report diff review, merge, stale hash directory deleted — and commit the resulting **refresh runbook** to the repo. Post-launch refresh owner: Simulation Engineer, roughly once per set release (4.10.1).
- Scryfall image policy and rate-limit re-confirmation (risk 1, open question 5) — first verified in Phase 0; re-checked here before launch.
- Full visual review (all 7 checkpoints of 9.3) presented to the owner; production deploy on acceptance.

**Exit:** PRD 9.4 definition of done holds for the whole product; production is live on Vercel; a refresh has been rehearsed and documented.

## 3. Dependency graph

```
Phase 0 ──┬── Phase 1 (pipeline) ───────────────────────┐
          ├── Phase 2a (star renderer) ──── Phase 3 ────┤
          ├── Phase 2b (camera/nav) ──┬─────────────────┼── real-data join ── Phase 6 ── launch
          └── Phase 4 (UI shell) ─────┘     Phase 5 ────┘
                    (4 starts on stubs; its camera-dependent flows need 2b)
```

Phases 1, 2a, 2b, and 4 all start after Phase 0. Phase 4 is parallel-in-start only: its scaffolding runs on the Phase 0 navigation stub, and its camera-dependent flows block on 2b (the edge v1 of this plan omitted). Phase 3 needs 2a's scene core and uses 2b's navigation. Phase 5 needs Phase 4's components. Phase 2a/2b/4 exit criteria join on Phase 1's real dataset — the **real-data join** is coordinated by the Founding Engineer as part of gate M2. Phase 6 needs everything, but its CI hooks exist from Phase 0.

## 4. Delegation and review

| Phase | Owner | Reviewer |
|---|---|---|
| 0 Scaffold + contracts | Founding Engineer | Frontend Engineer (+ Interactive Tools Eng on contracts) |
| 1 Pipeline | Simulation Engineer | Founding Engineer |
| 2a Star renderer | Interactive Tools Engineer | Frontend Engineer |
| 2b Camera + navigation | Founding Engineer | Interactive Tools Engineer |
| 3 Card tier | Interactive Tools Engineer | Design System Engineer |
| 4 App shell + UI | Frontend Engineer | Interactive Tools Engineer |
| 5 Polish + a11y | Design System Engineer | Frontend Engineer |
| 6 Quality + launch | Founding Engineer | Sim. Eng + Interactive Tools Eng |

Rules, per the issue-routing protocol: reviewer is never the implementer; each phase is a child issue of DEC-584 with a Handoff section; every hand-back routes through the CEO. Eight issues, created only after the board approves this plan. The critical path no longer runs through one person: the Interactive Tools Engineer owns 2a → 3 while the Founding Engineer owns 2b in parallel — and 2b is exactly what Phase 4 blocks on.

## 5. Milestones and owner touchpoints

| Milestone | What the owner sees | Gate |
|---|---|---|
| M0 | Hello-scene on a Vercel preview URL; Scryfall policy/CORS verdict | none |
| M1 | First pipeline report: counts, Blind Eternities baseline, verification answers (Q4/Q10/Q12, roster diff) | owner reviews report |
| M2 | Multiverse + plane levels, real data, motion, attract mode | visual review gate #1 |
| M3 | Full journey to card level | visual review gate #2 |
| M4 | Search, filters, deep links, panels working | owner plays with it |
| M5 | Full visual review + bench numbers + refresh runbook | launch acceptance |

Visual tunables (PRD open question 11) get decided at M2/M3/M5, not before; the PRD defaults ship until the owner overrides them.

## 6. The reference machine and the bench gate

PRD 7.1.1 says only "an Apple Silicon MacBook"; PRD open question 7 leaves the exact thresholds to be confirmed after the first `/bench` run. This plan makes that concrete: **the reference machine is the development machine this team runs on** (the owner's Apple Silicon Mac). The first `/bench` run on it records the machine's spec and the baseline numbers in the repo, closing open question 7. The per-PR bench required by 9.1.2 for rendering changes runs locally on this machine (headed Chrome), which the agent team can do — no headless-CI substitute is pretended. Visual gates (9.3 screenshots + recording from the `/bench` path) are captured the same way.

## 7. Risks the plan actively manages

1. **60 fps is won or lost in 2a.** Mitigation: earliest start, **fixture-scale data (30k stars, 82 planes) so bench numbers are real from the first shader commit**, adaptive quality implemented in 2a/3 rather than bolted on, bench gate per §6.
2. **Contract drift between workstreams.** Mitigation: Phase 0 freezes both the data contract (byte-level test vector) and the navigation contract (typed stub); any change to either is a reviewed contract change.
3. **First-run data surprises** (oracle_id identity, set codes, security stamp semantics, unmapped sets, unknown enums). Mitigation: Phase 1 verification duties and 7.7.2 fail-loud route findings back through the CEO with the report; fixtures lock each answer.
4. **Scope creep via "beautiful".** Mitigation: PRD 9.3's list is the whole judged surface; anything beyond it is logged for v2, not built.
5. **Scryfall dependency.** Mitigation: policy and CORS verified in Phase 0 before any dependent code, re-confirmed at Phase 6; concurrency caps and graceful degradation are Phase 3 acceptance criteria. There is no compliant proxy/mirror fallback (4.11.3, 8.10) — if Phase 0 verification fails, the board decides before the card tier is built.
6. **GPU and browser variance** (PRD risk 6). Mitigation: float32 position fallback in 2a, adaptive quality, cross-browser pass in Phase 6, WebGL2 fallback page in Phase 4.
7. **Plane-shard payload** (the largest artefact class). Mitigation: amendment A1's budget row and all-planes sharding rule, worker-side parsing in 2b, CI measuring encoded size.
8. **Repo growth.** Git history growth at ~6 refreshes/year is modest, but PRD 8.1.4's Git LFS escape hatch is **not usable** under Vercel's git integration (LFS files deploy as pointer files) — amendment A2 corrects the PRD so nobody follows it blindly.

## 8. Proposed PRD amendments (need board approval with this plan)

- **A1 — Shard every large plane, and budget the shards.** PRD 8.3 shards only the Blind Eternities at 2,000 cards/file, but Appendix B routes ~35 sets to `dominaria` — a single shard of several MB, parsed (per 8.7.6) during the fly-to, against a 16.7 ms frame budget. Amendment: shard **any** plane's detail file at 2,000 cards per file, and add a 7.2 budget row for plane detail shards (proposed: largest single shard ≤ 1.5 MB target / 2.5 MB ceiling, encoded). The web app parses shards in a worker regardless (plan-level, 2b).
- **A2 — Replace the Git LFS escape hatch.** PRD 8.1.4 says "move `web/public/data/**` to Git LFS; nothing else changes." Under Vercel's git integration LFS objects arrive as pointer files, so this breaks the deployed site. Amendment: if the repository outgrows comfort, move the data directory to external object storage fetched at build time (or a Vercel build command that materialises it); "nothing else changes" is deleted.
- **A3 — Carry the card's colour identity in the star record.** *Approved by the board on 2026-09-04 (`dec589:phase4:open-decisions:v1` on DEC-589); implemented under DEC-622.* PRD 8.3's star record carries only a hue class, and 5.4.8 gives that class one value for *every* multicolour card. So the 6.6.2 colour filter cannot do what 6.6.2 asks: selecting "white" admits every gold card in the game, because they all share hue class 5. No other artefact carries colour per star, so the filter has nothing better to consult and the gap is not fixable in the app alone. Amendment: the star record also carries the card's **five-bit WUBRG colour identity**, and 8.3's record description gains it.

  The record **stays 12 bytes** and no 7.2 budget row moves. `hueClass` is a uint8 holding seven values, so the identity packs into the five bits it was already spending on zeroes: byte 7 becomes `hueClass` in bits 0-2 and `colourIdentity` in bits 3-7. Growing the record was the alternative and is rejected — float16 alignment forbids 13 bytes, so it would have meant 14, a 16.7% rise in `stars.bin` for a field that fits in bits already being paid for.

  Both fields stay; they are not redundant. `hueClass` is what the renderer indexes its hue palette by, and it is the only thing that separates "colourless" from "never written". The identity is what an exact filter needs. This bumps `contractVersion` to 2, because a reader that takes byte 7 whole gets a hue class of up to 253 and fails *silently*. Exact colour filtering against the new field is deliberately **not** in this amendment: it is a separate Phase 4 leg, and filter behaviour is unchanged until that lands.

## 9. Out of scope

Everything in PRD 2.2 (non-goals) — with one explicit carve-out: 6.1.5's "touch must not break the page" survives the mobile non-goal and is assigned (Phase 4, verified Phase 6). Also out of scope: roadmap dates (phases are dependency-ordered, not calendar-ordered); CI enforcement of GPU-dependent budgets (local bench protocol per §6 and PRD 9.1.2).
