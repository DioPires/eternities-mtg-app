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
| [`docs/scryfall-policy.md`](docs/scryfall-policy.md) | Scryfall CORS and terms verification. Verdict: PASS. |
| [`docs/deployment.md`](docs/deployment.md) | Vercel setup and the headers. |

Both contracts are freeze points. Changing a byte layout, an enum value, a filename or a method
signature is a reviewed contract change, not an ordinary commit.

## Layout

```
pipeline/                 Python 3.13, uv. Scryfall bulk data to artefacts.
  src/eternities/
    contract/             The data contract, encoder side. Frozen.
    fixtures/             Seeded synthetic datasets and the PRD 8.6 layout rules.
    cli.py                The `eternities` CLI.
  data/appendix_a.json    The plane roster (PRD Appendix A).
web/                      Vite, React, TypeScript strict, react-three-fiber, Zustand. pnpm.
  src/data/               The data contract, decoder side. Frozen.
  src/navigation/         The navigation contract, plus its Phase 0 stub. Frozen.
  src/scene/              The hello-scene.
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

`web/datasets.json` says which one the build points at. `ETERNITIES_DATASET=scale pnpm build`
overrides it. The real dataset arrives in Phase 1.

## Where things stand

Phase 0 (scaffold and contracts) is complete. Phases 1, 2a, 2b and 4 run in parallel from here —
see `implementation-plan.md` §3.
