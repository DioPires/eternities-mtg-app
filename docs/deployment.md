# Deployment — Vercel

PRD 8.8. Everything the deployment needs is committed; connecting the project is the one step that
needs the repository owner's Vercel account, because this repository holds no Vercel credentials.

## 1. What is already in the repository

| Concern | Where | Note |
|---|---|---|
| SPA rewrites (PRD 6.7.5, 8.8.2) | `web/vercel.json` | Every route that is not a real file serves `index.html`. |
| Immutable `/data/**` caching (PRD 8.8.2) | `web/vercel.json` | `public, max-age=31536000, immutable`, safe because the directory is content-hashed. |
| CSP and the other security headers (PRD 7.6.1) | `web/security-headers.mjs` → `web/vercel.json` | One definition, three consumers. CI fails if `vercel.json` drifts. |
| Data-directory hash in `index.html` (PRD 8.3) | `web/vite.config.ts` | Injected at build time, plus preloads for the first-frame artefacts. |
| Build and install commands | `web/vercel.json` | `pnpm install --frozen-lockfile`, `pnpm build`. |

`vercel.json` is **generated**, never hand-edited:

```sh
cd web
node scripts/write-vercel-json.mjs          # write
node scripts/write-vercel-json.mjs --check  # what CI runs
```

## 2. Connecting the project (owner action, one time)

1. Vercel → **Add New… → Project** → import `DioPires/eternities-mtg-app`.
2. **Root Directory: `web`.** This is the only setting that is not in the repository, and it is the
   one that matters: with the root at the repository root, Vercel will not find `vercel.json`,
   `package.json` or the build.
3. Framework preset: **Vite** (it will detect this). Leave the build and install commands alone —
   `vercel.json` sets them.
4. Node.js version: **22.x**, matching `web/package.json`'s `engines` and CI.
5. Production branch: **`main`**. Preview deployments for every pull request are on by default.
6. Deploy.

Nothing else is needed: no environment variables, no secrets, no integrations. PRD 8.10 has no
analytics, no error tracking and no accounts, so there is nothing to configure.

## 3. Verifying a deployment

```sh
# Headers, as the browser sees them.
curl -sS -o /dev/null -D- https://<deployment>/ | grep -i -E 'content-security-policy|x-content-type'
curl -sS -o /dev/null -D- https://<deployment>/data/<hash>/stars.bin | grep -i cache-control

# SPA rewrite: a deep link must serve index.html, not 404.
curl -sS -o /dev/null -w '%{http_code}\n' https://<deployment>/plane/dominaria
```

Locally, `pnpm preview` serves the built site with the **production** headers, and
`node scripts/verify-browser.mjs --dataset all` drives a real Chrome at it and asserts the fixtures
decode with nothing blocked by the CSP. That is the same check, minus the CDN.

## 4. Data directories and repository size

`web/public/data/<hash>/` is committed (PRD 8.1.4) so a clone deploys without running the pipeline.
Two fixtures live there today: `fixture-small` (264 KB) and `fixture-scale` (14 MB). `eternities
fixtures` deletes the previous hash directory when it writes a new one, so the working tree never
accumulates.

**Amendment A2 (implementation-plan.md §8) applies here.** PRD 8.1.4's Git LFS escape hatch does
not work under Vercel's git integration: LFS objects arrive at the build as pointer files and the
site ships broken data. If the repository outgrows comfort, the move is to external object storage
fetched at build time, or a Vercel build command that materialises the directory — not LFS.

## 5. Refresh

**The flow is `docs/refresh-runbook.md`** — rehearsed end to end on 2026-09-05 and written from that
run. Owner: Simulation Engineer, roughly once per set release (PRD 4.10.1).

Phase 0's part is that `datasets.json` and the build-time injection make switching the active data
directory a one-line change:

```jsonc
// web/datasets.json — the pipeline maintains this
{ "active": "9d7ad20333ecc2fb", "fixtures": { "scale": "9d7ad20333ecc2fb", "small": "6b55f3f53a636887" } }
```

`ETERNITIES_DATASET=small pnpm build` overrides it without touching a committed file, which is how
the bench and the CI budget check switch datasets.
