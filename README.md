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
  src/scene/              The hello-scene, the star field, and the GPU self-check.
  src/bench/              The in-page bench harness `scripts/bench.mjs` drives.
  src/router/             PRD 6.7's URL: the source of truth for focus and filters.
  src/store/              PRD 8.4.2's transient view state, and the persisted settings.
  src/filters/            PRD 6.6's facets: the dimming mask and the exact count.
  src/search/             PRD 6.5's client-side fuzzy index over search.json.
  src/app/                Cold start, dataset loading, and the shell's hooks.
  src/ui/                 HUD, drawers, overlays, toasts, WebGL2 fallback.
  src/harness/            Phase 2a's and 2b's demo scenes, behind `?harness=`. Deleted when
                          Phase 3 folds them into the shell's scene.
  public/data/<hash>/     Committed artefacts, immutable, content-hashed.
  scripts/                Budget check, vercel.json generation, browser verification.
contract/test-vectors/v1/ The shared byte-level test vector. Both languages assert against it.
docs/                     The contract and policy documents above.
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
node scripts/check-budget.mjs --dataset scale
node scripts/verify-browser.mjs --dataset all   # needs a local Chrome
```

Optional, recommended: `uv run --directory pipeline pre-commit install`.

## Datasets

Two synthetic fixtures are committed, generated with the seeded rules of PRD 8.6, so web work never
waits on the pipeline and bench numbers mean something from the first shader commit:

| Fixture | Contents | Purpose |
|---|---|---|
| `fixture-small` | 4 planes + the Blind Eternities, 500 cards, one dust shard | Semantic and decoder tests |
| `fixture-scale` | all 83 Appendix A roster entries, 30 000 stars, 4 dust shards | Performance, label collision, budget |

Both draw colour identity from the proportions of the real Phase 1 dataset — mono colours ~15%
each, multicolour a 16.5% minority, colourless 8.5% — so a plane's five arms carry the stars and
the bulge stays a bulge. Judging the star field against a fixture is only meaningful because of
that; see `_COLOUR_IDENTITIES` in `pipeline/src/eternities/fixtures/generate.py`.

The real dataset is committed alongside them:

| Dataset | Contents |
|---|---|
| `production` | 28 587 cards across 83 planes, 89 plane shards, from the Scryfall bulk file of 2026-09-04 |

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

## Where things stand

Phases 0 (scaffold and contracts), 1 (data pipeline), 2a (star field), 2b (camera, navigation,
labels) and 4 (app shell and UI) are complete. The navigation contract has a real implementation,
and `web/test/navigation.test.ts` runs the same suite over both it and the stub.

What is *not* joined up yet is the scene. The shell — [`docs/app-shell.md`](docs/app-shell.md) — is
still built against the Phase 0 navigation stub over the hello-scene, and the star field and the
camera rig are still two separate harness scenes reached with `?harness=2a` and `?harness=2b`.
Folding all three into one scene, by swapping `createNavigation()` for the rig, is Phase 3. See
`implementation-plan.md` §3.

`node web/scripts/verify-browser.mjs --dataset all` drives a real browser through all three: PRD
section 6's interaction requirements on the shell, a fly-to the Blind Eternities with its
worker-parsed shards and Esc back out on 2b, and the GPU self-check on 2a — under the production
CSP.
