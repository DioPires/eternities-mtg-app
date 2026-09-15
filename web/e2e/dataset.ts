/**
 * Which routes the smoke should drive, read out of the built site.
 *
 * PRD 8.9.2 names the *kinds* of route to load — the multiverse, a plane, the Blind Eternities, a
 * card, a filtered route — not the slugs, and it could not: the two fixtures put cards on different
 * planes (`dominaria` has none in fixture-scale) and the production roster differs from both. So
 * the targets are derived from whatever dataset the build points at, the same way
 * `scripts/verify-browser.mjs` derives its walk. A smoke test that only passes on one dataset is
 * not a smoke test.
 *
 * Read from `dist/`, not `public/`: `dist/index.html` carries the injected `eternities:data` meta
 * tag (PRD 8.3), so this resolves the dataset the preview server will actually serve rather than
 * the one `datasets.json` happens to call active.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BLIND_ETERNITIES_SLUG } from '../src/data/types'

const WEB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = resolve(WEB_ROOT, 'dist')

interface PlaneSummary {
  readonly slug: string
  readonly displayName: string
  readonly cardCount: number
  readonly sets: readonly { readonly code: string; readonly name: string }[]
}

export interface RouteTargets {
  readonly hash: string
  /** A plane with cards and sets — the `/plane/<slug>` and filtered-route target. */
  readonly plane: PlaneSummary
  /** PRD 8.9.2 calls the Blind Eternities out separately; it is the sharded, unnamed one. */
  readonly blindEternities: PlaneSummary
  /** A real `oracle_id` from that plane's first shard, and the name the breadcrumb should show. */
  readonly card: { readonly oracleId: string; readonly name: string }
}

function readJson<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(resolve(DIST, ...parts), 'utf8')) as T
}

/**
 * The dataset hash the build injected. Fails loudly rather than falling back to `datasets.json`:
 * a missing `dist/` means nobody built, and silently smoking a stale tree is worse than stopping.
 */
export function builtDataset(): string {
  let html: string
  try {
    html = readFileSync(resolve(DIST, 'index.html'), 'utf8')
  } catch {
    throw new Error(`no built site at ${DIST} — run \`pnpm build\` before \`pnpm exec playwright test\``)
  }
  const match = /<meta name="eternities:data" content="\/data\/([0-9a-f]{16})\/"/.exec(html)
  if (!match?.[1]) throw new Error('dist/index.html carries no eternities:data hash (PRD 8.3)')
  return match[1]
}

/**
 * Whether the built dataset can actually **compose a worlds roster** in the browser (DEC-751,
 * DEC-788).
 *
 * Derived from the data rather than from `ETERNITIES_DATASET`, because that variable is consumed at
 * *build* time into `dist/index.html`'s meta tag and need not be set in the shell running the
 * tests. The one thing this must never do is answer "no" because it could not look: a missing
 * `dist/` throws out of `builtDataset` — and a missing `manifest.json` throws out of `readJson` —
 * rather than returning false, so "cannot compose" and "nobody built" stay distinguishable. A spec
 * that silently skipped its whole subject is the shape of defect §1.12's rung assertion exists to
 * prevent in the first place.
 *
 * **Two conditions, not one — this is DEC-788's fix.** The version this replaces tested only §2.4's
 * `rowCells` and called that "is a worlds dataset". `rowCells` is the *geometry* half. Composition
 * also needs `swatches.bin`: `EternitiesScene`'s `worldData` memo is `planes && stars && swatches`,
 * so without that file the roster is never handed to the host and `probe.worlds()` stays null
 * forever. The two halves come apart on exactly the dataset CI smokes — `ETERNITIES_DATASET=scale`,
 * per `.github/workflows/ci.yml` — whose `planes.json` carries `rowCells` on 80 planes while the
 * fixture ships no `swatches.bin` at all, by design: swatches are a per-card statistic computed
 * from real Scryfall art, and a synthetic fixture has no printings to compute one from
 * (`pipeline/src/eternities/pipeline/assemble.py`, where `swatches` is `| None` for this reason).
 *
 * So the old predicate answered "yes, worlds" for a build that provably cannot compose, §1.12's
 * rung test ran instead of skipping, and it spent a 30 s poll waiting for a roster that never
 * arrives. Measured on main `4daa6ab`: the `scale` build never composes inside **120 s**; the
 * `worlds` build composes at **3.4 s**. Same machine, same SwiftShader, same harness — which is
 * why raising the 30 s budget would have bought nothing but a slower red.
 *
 * Read from the manifest's own `files` list rather than by stat-ing `dist/`, because that list is
 * the dataset's declaration of what it published and it cannot be fooled by the preview server's
 * SPA fallback, which answers **200 with `index.html`** for a missing `.bin` rather than 404.
 */
export function composesWorldsRoster(): boolean {
  const hash = builtDataset()
  const planes = readJson<{ planes: { rowCells?: number[] }[] }>('data', hash, 'planes.json').planes
  const hasGeometry = planes.some(
    (plane) => Array.isArray(plane.rowCells) && plane.rowCells.length > 0,
  )
  if (!hasGeometry) return false

  const files = readJson<{ files: { path: string }[] }>('data', hash, 'manifest.json').files
  return files.some((file) => file.path === 'swatches.bin')
}

export function routeTargets(): RouteTargets {
  const hash = builtDataset()
  const planes = readJson<{ planes: PlaneSummary[] }>('data', hash, 'planes.json').planes

  const plane = planes.find(
    (p) => p.slug !== BLIND_ETERNITIES_SLUG && p.cardCount > 0 && p.sets.length > 0,
  )
  if (!plane) throw new Error(`dataset ${hash} has no plane with both cards and sets`)

  const blindEternities = planes.find((p) => p.slug === BLIND_ETERNITIES_SLUG)
  if (!blindEternities) throw new Error(`dataset ${hash} has no ${BLIND_ETERNITIES_SLUG} plane`)

  // Shard 0 of that plane, because a deep link to a card has to name one that exists — PRD risk 9's
  // dead-id fallback is a different check and `verify-browser.mjs` already owns it.
  const shard = readJson<{ cards: { u: string; n: string }[] }>(
    'data',
    hash,
    'planes',
    `${plane.slug}.0.json`,
  )
  const first = shard.cards[0]
  if (!first) throw new Error(`${plane.slug} shard 0 is empty despite cardCount ${plane.cardCount}`)

  return { hash, plane, blindEternities, card: { oracleId: first.u, name: first.n } }
}
