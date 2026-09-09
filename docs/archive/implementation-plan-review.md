# Implementation Plan — Soundness Review (v1 → v2)

**Reviewed:** `implementation-plan.md` revision v1, against contract `prd_v3.md`.
**Method:** two independent adversarial passes — (1) a section-by-section coverage audit of the PRD against the plan's phases and citations; (2) a refutation pass attacking the plan's technical assumptions (payload arithmetic, parallelism claims, staffing, Vercel platform behaviour, gate executability). Reviewer: CEO, 2026-09-04.
**Verdict on v1: not sound.** 1 blocker-class finding, ~12 major findings, ~10 minor. All accepted findings are fixed in revision v2. Nothing was rejected outright; two findings were accepted with narrowed scope (noted below).

## Blocker

| # | Finding | Disposition in v2 |
|---|---|---|
| B1 | The bench gate ("60 fps on the reference machine", required per rendering PR by PRD 9.1.2) named no machine, no owner, and no way for an agent team to run it; PRD 7.1.1 says only "an Apple Silicon MacBook" and open question 7 leaves thresholds unconfirmed. | §6 of v2: the reference machine is the development machine the team runs on; first `/bench` run records spec + baselines and closes open question 7; per-PR bench runs locally in headed Chrome. |

## Major findings

| # | Finding | Disposition in v2 |
|---|---|---|
| M1 | Missing dependency edge Phase 2 → Phase 4: breadcrumb fly-to (6.3.1), history replay (6.2.2), search fly-to (6.5.4), random (6.9.1), deep-link intro (6.7.3), filter rendering (6.6.5→5.8) all depend on camera/shader work. "Integrates continuously" named a cadence, not an interface — the plan froze the data boundary but not the far more coupled camera boundary. | Phase 0 now freezes a **navigation contract** (typed API + stub); Phase 4 builds on the stub; the graph shows the 2b → 4 edge explicitly. |
| M2 | One engineer (Interactive Tools) owned Phases 2 and 3 sequentially while reviewing Phase 4 — the whole critical path through one person, with the Founding Engineer idle mid-project. | Phase 2 split: 2a star renderer (Interactive Tools) ∥ 2b camera/navigation (Founding Engineer). 2b is exactly what Phase 4 blocks on. |
| M3 | The fixture (3–4 planes, ~500 cards) cannot validate the 60 fps/label-collision/82-plane envelope — the plan's #1 risk mitigation was inert. | Two fixtures: `fixture-small` (semantics) + `fixture-scale` (82 planes, ~30k synthetic stars, seeded layout) for bench and labels. |
| M4 | Plane detail shards — the largest artefact class, est. 40–55 MB uncompressed across planes — had no 7.2 budget row and sat outside the CI check's first-load scope. | Amendment **A1** (§8): budget row for shards; CI measures encoded size. |
| M5 | PRD 8.3 shards only the Blind Eternities; Appendix B routes ~35 sets to `dominaria`, giving a multi-MB single shard parsed on the main thread during the fly-to (8.7.6) against a 16.7 ms frame budget. | Amendment **A1**: shard any plane at 2,000 cards/file; worker-side parsing in 2b. |
| M6 | PRD 8.1.4's escape hatch ("move data to Git LFS; nothing else changes") breaks under Vercel's git integration — LFS files deploy as pointer files. | Amendment **A2** replaces the LFS hatch with external storage fetched at build time; risk §7.8 records it. |
| M7 | The post-launch refresh workflow (4.10, 8.8.3: `eternities build`, commit data + `pipeline/reports/<date>.md`, PR, review, merge) had no owner, no runbook, no rehearsal; the `eternities build` CLI (8.1.2) was never a named deliverable. | Phase 1 delivers the CLI + committed reports; Phase 6 rehearses the full refresh flow once and commits a runbook; Simulation Engineer named as post-launch refresh owner. |
| M8 | CSP (7.6.1) was scheduled in Phase 5 under the Design System Engineer — after Phase 3 wrote the image-fetching code it governs; 8.5.8's `fetch`+`createImageBitmap` path is governed by `connect-src`, so a late CSP would break imagery on application. | CSP headers land in Phase 0's `vercel.json`; all later work develops under the real policy; Phase 5 audits only. |
| M9 | Scryfall policy verification sat in Phase 6, after the entire card tier was built on hotlinking assumptions, with no compliant fallback (4.11.3 forbids mirroring, 8.10 forbids other third parties). CORS/`crossOrigin` for WebGL texture upload was mentioned nowhere. | Policy + CORS verification moved to Phase 0 (zero-cost check), re-confirmed in Phase 6; `crossOrigin` explicit in Phase 3. |
| M10 | Adaptive quality (8.5.11) had a Phase 6 verification step and no implementing phase — despite the risk register claiming it was "designed in". Its steps span three phases. | Implementation assigned: monitor + pixel-ratio + bloom steps in 2a; thumbnail-capacity step in 3; store slot in 4. Phase 6 verifies only. |
| M11 | Cross-browser support (7.1.2: Chrome/Safari/Firefox on macOS/Windows/Linux), the no-WebGL2 fallback page, and PRD risk 6's float32 position fallback were all unassigned; the plan's risk register listed 5 of the PRD's 13 risks and dropped risk 6 entirely. | WebGL2 fallback page in Phase 4; float32 fallback in 2a; cross-browser pass (honestly logged per combination) in Phase 6; risk added as §7.6. |
| M12 | Data-chunk retry with backoff + non-blocking toast (7.4.1) was silently retargeted to images (whose rule is actually 7.4.2) and the real requirement orphaned. | Loader retry/backoff in 2a, toast surface in Phase 4; Phase 3 citation corrected to 7.4.2–3. |

## Minor findings

| # | Finding | Disposition in v2 |
|---|---|---|
| m1 | Exit criteria of "parallel" phases require Phase 1's real dataset — parallel in start only; the "real-data integration" graph node had no owner. | Graph note: parallel-in-start; real-data join owned by Founding Engineer as part of gate M2. |
| m2 | Visual gate #1 cited 9.3 checkpoints 6 (Blind Eternities dust) and 7 (attract mode) which Phase 2 didn't build. | Dust rendering now in 2a, attract mode in 2b; the gate's checkpoints match its content. |
| m3 | Attract mode (5.3.22–23), intro flight (6.8.2) and share toast (6.7.4) were miscited to 6.8–6.11 and mis-assigned: attract/intro are camera work. | Camera legs to 2b; UI triggers stay in 4; citations corrected. |
| m4 | Fixture at mutable `web/public/data/fixture/` sat inside the immutably-cached, content-hashed `/data/**` scheme (8.3, 8.8.2). | Fixtures live under hash-style directory names. |
| m5 | `sets.bin`/`search.json` formats are one-clause sketches in the PRD; designing them against the tight 700 KB row (30k UUID strings ≈ 1.1 MB raw) is real design work, but Phase 0 was labelled "small". | Phase 0 relabelled; the format/budget interaction stated explicitly (16-byte binary oracle_ids). |
| m6 | CI budget check measured nothing meaningful against a 500-card fixture and could measure disk rather than transferred bytes (`.bin` may not be edge-compressed). | fixture-scale makes the check meaningful early; check specified as encoded transferred size. |
| m7 | Chronology-band set labels (5.4.5) — a third label system — were in no phase. | 2b, exercised against fixture-scale. |
| m8 | Runtime plane-detail/shard loading order (8.7) was cited nowhere. | 2b (loading + worker parse), panels consume in 4. |
| m9 | Zero-card plane glows (5.3.6, 8.7.2) had no owning phase. | 2a. |
| m10 | Dead-card-link fallback toast (risk 9), `rel="noopener noreferrer"` (7.6.2), touch-must-not-break (6.1.5), unknown-enum fail-loud (7.7.2), per-frame allocation rules (7.3.2–3), hash-injection build step + stale-dir cleanup (8.3) — all orphaned. | Assigned: risk-9 toast + noopener + touch in 4 (touch verified in 6); enums in 1; frame-path rules as 2a review checklist; hash injection in 0; cleanup in the Phase 6 refresh rehearsal. |
| m11 | Phase 2's exit said "60 fps" where 7.2 sets target 60 / ceiling 50. | Exit restated as target/ceiling pair. |

## Findings that did not survive, or survived narrowed

- **Thumbnail atlases as pipeline artefacts / repo bloat:** refuted — the PRD (4.1.6, 8.5.8) builds atlases at runtime from Scryfall `small` images; nothing image-shaped is committed. Repo growth at ~6 refreshes/year is modest; only the LFS hatch (M6) was wrong.
- **Vercel platform fit:** holds up apart from CSP placement (M8) and LFS (M6) — SPA rewrites, immutable caching, no-server image policy, and privacy posture (8.10) are all compatible with static hosting.
- **Plan citation accuracy:** the coverage audit verified ~60 PRD citations in v1; all were accurate except the three recorded in m2/m3/M12.
