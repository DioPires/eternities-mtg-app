# Eternities: read this before you change anything

This file is a map. It names the documents that rule and the section where each rule is written, and it restates none of them. PRD v4 is `prd_v4.md`; the plan is `docs/decisions/dec950-overhaul-deep-dive.md`.

## What this repository is

- The product: PRD v4 sections 1 and 2.
- The web edition, under `web/`, is frozen at tag `web-edition-v1`. What may still change there: PRD v4 8.11.
- The native edition is the Unity project under `unity/Eternities/`. Its layout and conventions: PRD v4 8.2.

## Order of authority

The table "The contract documents" in `README.md` has the same order, with a line on each document.

1. `prd_v4.md`: the product contract. Its Status line lists the amendments in force.
2. `prd_v3.md`: only what the Supersedes line of `prd_v4.md` keeps in force.
3. `pipeline/data/appendix_a.json` and `pipeline/data/appendix_b.json`: the canonical form of Appendices A and B.
4. `docs/decisions/dec950-overhaul-deep-dive.md`: the plan. What PRD v4 supersedes in it: its section 12.7.
5. `docs/data-contract.md` and `docs/navigation-contract.md`: the web edition's two contracts, both frozen.
6. `docs/ci-runner.md`: the self-hosted runner.
7. `docs/scryfall-policy.md`: the Scryfall verification. Its section 11 is the desktop client.

`implementation-plan.md` is the web edition's plan, closed at tag `web-edition-v1`. It plans nothing in the native edition.

## Where each rule is written

- Text first, and what counts as content: PRD v4 7.6.4.
- The scene generation entry point: PRD v4 8.2.5. Its command: `unity/Eternities/README.md`.
- Engine and render pipeline: PRD v4 8.1.1. The pin rule: PRD v4 7.6.3. The pin table: `unity/Eternities/README.md`.
- The CI matrix and its no-bypass rule: PRD v4 8.8.5. The jobs as built: `.github/workflows/ci.yml`.
- The runner: whose session it runs in, and what the bench job does while another Unity process runs: PRD v4 8.8.6 and `docs/ci-runner.md`.
- The review rule: who runs the bench, on which tree, and what the verdict must quote: PRD v4 8.8.7. The command that builds that tree, and when: plan 12.11, finding 13.
- Content supply and credits: PRD v4 8.12.
- Scryfall on a native client: PRD v4 4.15. What is never done with card images: PRD v4 4.15.2.
- The Fan Content Policy checklist: PRD v4 Appendix E. The presentation lint on authored content: PRD v4 9.1.6.

## Where decisions are recorded

- `docs/decisions/`, PRD v4 section 12, and section 12 of the plan.
- There is no lessons file, by decision: finding 8 in section 12.11 of `docs/decisions/dec950-overhaul-deep-dive.md`.

## Two company rules with no other home in this repository

- The agent that builds never approves (DEC-488).
- Comments and documents lead with the outcome, in short plain sentences (DEC-475).
