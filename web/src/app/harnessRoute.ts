/**
 * Which URLs belong to the harness, and where the harness lives.
 *
 * The three measurement routes — the bench, the GPU self-check and the `?probe=1` scene — used to
 * be `lazy()` branches of `App`. That kept them out of the product's *first chunk*, but not out of
 * the product's *build*: `App` still named the modules, so every one of them was a chunk rollup
 * produced from the product entry, and a reviewer diffing `dist/` could not tell the product from
 * its instruments (review §3.6 phase 3, item 4). They now have their own Vite entry,
 * `harness.html` -> `src/harness/main.tsx`, and nothing on the product's module graph mentions
 * them.
 *
 * What is left on the product side is this file: three string tests and a URL to redirect to. It
 * imports nothing, which is the point — deciding that a visitor is *not* benching must not cost
 * them the bench.
 *
 * **Why redirect rather than move the URLs.** `/bench` is PRD 9.1.2's route and what a person
 * types; `?probe=1` and `?hold=<segment>` are what `scripts/bench.mjs`,
 * `scripts/warmup-probe.mjs`, `scripts/visual-gate.mjs` and the `e2e/` suite drive, and what the
 * committed bench baseline was recorded through. Repointing all of them would have made this
 * leg's own before/after bench numbers incomparable — the one measurement the leg has to produce.
 * So the spellings survive, and the product answers them with `location.replace`.
 *
 * `?probe=shell` is deliberately **not** here. That one keeps the shell and installs the probe seam
 * inside it, because PRD 9.3's visual review is of the shipped composition; it is served by the
 * product entry, from `SceneView`, exactly as before.
 */

/** The harness entry, as Vite emits it from `web/harness.html`. */
export const HARNESS_PATH = '/harness.html'

/**
 * Which URL asks for the bench.
 *
 * Both spellings: `/bench` is PRD 9.1.2's and what a person types; `?bench` and `?hold=<segment>`
 * are what `scripts/bench.mjs` drives and what the committed baseline was recorded through.
 *
 * `test/bench.test.ts` pins this against `BenchScene.benchRouteRequested`, which stays exported
 * there as the harness module's own answer to the same question. The two are deliberately separate
 * copies: importing the module to ask whether you want it is the defect (review §6.3), and that
 * matters more now than it did — `benchRouteRequested` lives in the harness build, and this file
 * lives in the product's.
 */
export function benchRouteWanted(pathname: string, search: string): boolean {
  if (pathname === '/bench' || pathname === '/bench/') return true
  const params = new URLSearchParams(search)
  const bench = params.get('bench')
  if (bench !== null && bench !== '0') return true
  return params.get('hold') !== null
}

/**
 * Whether `?probe=` asks for the scene on its own.
 *
 * Only `scene` redirects. `?probe=shell` is the shipped composition and stays on the product entry;
 * so does an absent or unrecognised value. Mirrors `probeTarget` in `scene/probe.ts`, which the
 * shell still uses to decide whether to install the seam in itself.
 */
function probeSceneWanted(search: string): boolean {
  const value = new URLSearchParams(search).get('probe')
  if (value === null) return false
  return value !== 'shell' && value !== '0'
}

/**
 * Where this URL should go, or `null` to stay on the product shell.
 *
 * The query string is carried over whole, because the harness routes are parameterised —
 * `?probe=1&quality=3&motion=1` and `?bench&hold=sheet` are both real call sites in `e2e/` and
 * `scripts/`, and dropping the tail would silently measure the wrong thing. `/bench` with no query
 * gains an explicit `bench=1`: the path carried the request, and after the redirect there is no
 * path left to carry it.
 */
export function harnessHref(pathname: string, search: string): string | null {
  const wantsBench = benchRouteWanted(pathname, search)
  if (!wantsBench && !probeSceneWanted(search)) return null

  const params = new URLSearchParams(search)
  // `/bench` said it with the path. Nothing but the query survives a redirect, so say it again.
  if (wantsBench && params.get('bench') === null && params.get('hold') === null) {
    params.set('bench', '1')
  }
  const query = params.toString()
  return query === '' ? HARNESS_PATH : `${HARNESS_PATH}?${query}`
}
