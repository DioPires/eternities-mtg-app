# Eternities

A 3D visualisation of every plane of the *Magic: The Gathering* multiverse. Each plane is a galaxy,
each unique card a star, each printing a planet. One continuous scene from the multiverse down to a
single card.

Free and non-commercial, under the Wizards of the Coast Fan Content Policy. Card data and images
come from [Scryfall](https://scryfall.com).

## The contract documents

In order of authority. Read the first two before changing anything.

| Document | What it is |
|---|---|
| [`prd_v3.md`](prd_v3.md) | The product contract, as amended by A1 and A2 (implementation-plan.md §8). |
| [`implementation-plan.md`](implementation-plan.md) | Board-approved plan, v2. Read your phase section fully before you start. |
| [`docs/data-contract.md`](docs/data-contract.md) | The pipeline ↔ web artefact formats. **Frozen.** |
| [`docs/navigation-contract.md`](docs/navigation-contract.md) | The UI ↔ scene navigation API. **Frozen.** |
| [`docs/camera-and-labels.md`](docs/camera-and-labels.md) | The Phase 2b camera rig, labels and plane-detail loading. |
| [`docs/scryfall-policy.md`](docs/scryfall-policy.md) | Scryfall CORS and terms verification. Verdict: PASS. |
| [`docs/deployment.md`](docs/deployment.md) | Vercel setup and the headers. |
| [`docs/app-shell.md`](docs/app-shell.md) | The Phase 4 UI shell: where state lives, the seams for 2a/2b/3/5, and the calls the PRD left open. |
| [`docs/design-system.md`](docs/design-system.md) | The Phase 5 visual system, the contrast proof, and the accessibility checklist. |
| [`docs/csp-audit.md`](docs/csp-audit.md) | The Phase 5 security-header audit: what changed, what was flagged and left alone. |

Both contracts are freeze points. Changing a byte layout, an enum value, a filename or a method
signature is a reviewed contract change, not an ordinary commit.

## Layout

```
pipeline/                 Python 3.13, uv. Scryfall bulk data to artefacts.
  src/eternities/
    contract/             The data contract, encoder side. Frozen.
    fixtures/             Seeded synthetic datasets and the PRD 8.6 layout rules.
    pipeline/             The PRD 8.2 stages: fetch, filter, exclude, first printing,
                          assign plane, layout, emit — plus the run report.
    cli.py                The `eternities` CLI.
  data/appendix_a.json    The plane roster (PRD Appendix A).
  data/appendix_b.json    The set to plane seed table (PRD Appendix B).
  data/overrides.json     Card-name to plane overrides (PRD 4.1.5). Starts empty.
  reports/<date>.md       One run report per pipeline run, committed with its data.
web/                      Vite, React, TypeScript strict, react-three-fiber, Zustand. pnpm.
  src/data/               The data contract, decoder side. Frozen.
  src/navigation/         The navigation contract. Frozen. One state machine, two transports:
                          the no-op stub and the camera rig.
  src/camera/             The camera rig: tethered orbit, fly-to, attract mode (Phase 2b).
  src/labels/             Plane and chronology-band labels, and the CPU projection they use.
  src/plane-detail/       Plane shards fetched and parsed in a worker (amendment A1).
  src/scene/              The shipped scene: the star field, the card tier, the post chain and
                          the GPU self-check.
  src/bench/              The in-page bench `scripts/bench.mjs` drives, behind `/bench`. Lazy.
  src/router/             PRD 6.7's URL: the source of truth for focus and filters.
  src/store/              PRD 8.4.2's transient view state, and the persisted settings.
  src/filters/            PRD 6.6's facets: the dimming mask and the exact count.
  src/search/             PRD 6.5's client-side fuzzy index over search.json.
  src/app/                Cold start, dataset loading, and the shell's hooks.
  src/ui/                 HUD, drawers, overlays, toasts, WebGL2 fallback.
  src/harness/            The still field the GPU self-check needs, behind `?selfcheck`. Lazy,
                          so none of it is in the product's chunk.
  public/data/<hash>/     Committed artefacts, immutable, content-hashed.
  scripts/                Budget check, vercel.json generation, browser verification, and
                          `visual-gate.mjs` — PRD 9.3's acceptance instrument.
  e2e/                    Playwright: PRD 8.9.2's route smoke and 9.1.2's bench smoke, in CI.
contract/test-vectors/v2/ The shared byte-level test vector. Both languages assert against it.
docs/                     The contract and policy documents above.
docs/archive/             Superseded PRDs and their reviews. Nothing current.
```

## Getting started

```sh
# Pipeline
cd pipeline
uv sync
uv run pytest
uv run eternities --help
uv run eternities fixtures all        # regenerate both fixture datasets
uv run eternities test-vector         # regenerate the shared test vector
uv run eternities build               # the real run: Scryfall -> artefacts + report

# Web
cd web
pnpm install
pnpm dev                              # http://localhost:5173, under the CSP
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm preview            # preview serves the *production* headers
pnpm test:e2e                         # Playwright route + bench smoke; needs a build first
node scripts/check-budget.mjs --dataset scale
node scripts/visual-gate.mjs --dataset production   # PRD 9.3 captures; needs a local Chrome
```

`pnpm test:e2e` needs Chromium once: `pnpm exec playwright install chromium`. It runs against
whatever `dist/` holds, so build the dataset you mean to smoke.

Optional, recommended: `uv run --directory pipeline pre-commit install`.

## Datasets

Two synthetic fixtures are committed, generated with the seeded rules of PRD 8.6, so web work never
waits on the pipeline and bench numbers mean something from the first shader commit:

| Fixture | Contents | Purpose |
|---|---|---|
| `fixture-small` | 4 planes + the Blind Eternities, 500 cards, one dust shard | Semantic and decoder tests |
| `fixture-scale` | all 87 Appendix A roster entries, 30 000 stars, 4 dust shards | Performance, label collision, budget |

Both draw colour identity from the proportions of the real Phase 1 dataset — mono colours ~15%
each, multicolour a 16.5% minority, colourless 8.5% — so a plane's five arms carry the stars and
the bulge stays a bulge. Judging the star field against a fixture is only meaningful because of
that; see `_COLOUR_IDENTITIES` in `pipeline/src/eternities/fixtures/generate.py`.

The real dataset is committed alongside them:

| Dataset | Contents |
|---|---|
| `production` | 28 587 cards across 87 planes, 93 plane shards, from the Scryfall bulk file of 2026-09-04 |

`fixture-scale` is generated *from* `pipeline/data/appendix_a.json`, so a roster change re-hashes it
along with the production dataset. `fixture-small` names its five planes explicitly and does not move.

`web/datasets.json` says which one the build points at — `active` is the production dataset.
`ETERNITIES_DATASET=scale pnpm build` overrides it with a fixture name or a raw hash.

## Refreshing the data (PRD 8.8.3, 4.10)

```sh
cd pipeline
uv run eternities build                       # --as-of defaults to today
uv run pytest                                 # invariants + the 9.1.5 plane fixtures
cd ../web && node scripts/check-budget.mjs --dataset "$(node -p "require('./datasets.json').production")"
```

`build` caches the Scryfall bulk file under `pipeline/.cache/` (git-ignored) keyed by Scryfall's
`updated_at`, writes `web/public/data/<hash>/`, deletes the superseded hash directory, points
`datasets.json` at the new one, and writes `pipeline/reports/<date>.md`. Commit the data directory
and the report together in a pull request titled with the Scryfall bulk timestamp, and review the
report diff — it is the reviewable artefact.

Two rules stop a run rather than guess, both by design:

- **An unknown Scryfall enum** (`set_type`, `layout`, `rarity`, `security_stamp`) — PRD 7.7.2.
  Classify it in `contract/enums.py` (and its TypeScript twin, if it is a layout).
- **A first-printing set with no Appendix B row** — PRD 4.6.4. Add the row to
  `pipeline/data/appendix_b.json`. The error names every offending set and its card count.

Determinism (PRD 4.9.1): the same bulk file, appendices and `--as-of` produce byte-identical
artefacts *and* an identical manifest, so a refresh reviews as a diff.

To hold the *first* of those three still, pin the cache key:

```sh
uv run eternities build --as-of 2026-09-04 --bulk-updated-at 2026-09-04T09:05:32.308+00:00
```

Scryfall republishes `default_cards` several times a day, so an unpinned re-run of an
appendix-only change quietly folds in a different card file and the 4.9.2 plane diff stops
separating the edit from the day's churn. Pinning makes no network call at all and fails if the
cache does not hold that key — it never falls back to today's file. `manifest.json` records the run
this one followed (`previousRun`), so the committed report stays reproducible after the superseded
directory is deleted.

## Where things stand

Phases 0 (scaffold and contracts), 1 (data pipeline), 2a (star field), 2b (camera, navigation,
labels), 3 (card tier), 4 (app shell and UI) and 5 (design polish) are complete. The navigation
contract has a real implementation, and `web/test/navigation.test.ts` runs the same suite over the
stub, the rig and the forwarding host the shell holds.

Phase 3 folded 2a's star field and 2b's camera rig into one scene —
`web/src/scene/EternitiesScene.tsx` — and added the card tier on top of it: thumbnails, the focused
card and its planets, one canvas with one camera and one picker. Phase 2b's harness, its projection
picker and the hello-scene proxies are gone.

**Phase 6 joined that scene to the shell**, so the default route shows the multiverse rather than
Phase 0's hello-scene. Three seams did it: `src/navigation/host.ts` forwards from the `NavigationApi`
built before React to the rig built when `planes.json` lands; `src/app/dataset.ts` stopped fetching,
because the shell and the scene each ran PRD 8.7's loading order and mounting one inside the other
doubled every transfer including `stars.bin`; and `SceneView` carries the canvas so the scene stays
reachable standalone (`?probe=1`) exactly as reviewed. `/bench` flies the shipped scene now, not
2a's harness, so `web/bench/baseline-2026-09-05.json` measures the product. Phase 6 is in progress —
the cross-browser pass, the refresh rehearsal and the visual review are outstanding.

Phase 2a's harness is gone (review §6.1 group B). What it hosted that is still needed — the GPU
self-check — lives at `?selfcheck` in `src/harness/SelfCheckScene.tsx`; `?harness=2a` and
`?harness=3` are not routes any more.

Two browser checks, with different jobs.

`pnpm test:e2e` is the CI gate, on every pull request: PRD 8.9.2's five route kinds, PRD 9.1.2's
`/bench` run, PRD 9.1.4's quality ladder, and Phase 5's accessibility checklist with the CSP/HSTS
self-check (`e2e/a11y.spec.ts`). It is narrower than a real-GPU run on purpose — a cloud runner has
no representative GPU, so it renders through SwiftShader and asserts nothing about frame time. PRD
7.2's ceilings are enforced by `pnpm bench` on the reference machine.

`node web/scripts/visual-gate.mjs --dataset production` is the local one, on this machine's real
GPU: PRD 9.3's seven capture checkpoints for the owner to judge. `docs/refresh-runbook.md` step 8
runs it on every dataset refresh.

DEC-708 archived the wider local gate — `verify-browser.mjs`, `cross-browser.mjs` and
`arm-lane-capture.mjs` — under the `review-tooling-2026-09` tag (review §6.1 group C). Its a11y and
CSP assertions moved into `e2e/a11y.spec.ts`, where CI runs them; the rest is retrievable with
`git show review-tooling-2026-09:web/scripts/<name>`.
