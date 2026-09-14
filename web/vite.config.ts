import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Typed by `security-headers.d.ts`. The policy itself is a plain ESM module because the CI
// scripts read it with no build step.
import { securityHeaders } from './security-headers.mjs'

interface DatasetRegistry {
  active: string
  fixtures: Record<string, string>
  /** `production`, and anything else the pipeline records beside it. */
  [key: string]: string | Record<string, string>
}

/**
 * Resolves which data directory this build points at.
 *
 * `web/datasets.json` records the hashes the pipeline last wrote. `ETERNITIES_DATASET` overrides
 * it with a fixture name (`small`, `scale`), any other top-level key (`production`), or a raw
 * hash — which is how the bench, the CI budget check and `verify-browser` switch datasets without
 * editing a committed file.
 */
function resolveDataHash(root: string): string {
  const registry = JSON.parse(
    readFileSync(resolve(root, 'datasets.json'), 'utf8'),
  ) as DatasetRegistry
  const requested = process.env.ETERNITIES_DATASET
  if (!requested) return registry.active
  const fixture = registry.fixtures[requested]
  if (fixture) return fixture
  const named = registry[requested]
  return typeof named === 'string' ? named : requested
}

/**
 * PRD 8.3: `index.html` references the current data hash at build time.
 *
 * Injects the `<meta>` the loader reads plus preload hints for the two first-frame artefacts of
 * PRD 8.7.2, so the browser starts fetching them before the module graph has parsed.
 */
function injectDataHash(): Plugin {
  let dataHash = ''
  return {
    name: 'eternities:inject-data-hash',
    configResolved(config) {
      dataHash = resolveDataHash(config.root)
      config.logger.info(`  eternities data directory: /data/${dataHash}/`)
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const base = `/data/${dataHash}/`
        return html.replace(
          '<!-- eternities:data -->',
          [
            `<meta name="eternities:data" content="${base}" />`,
            `<link rel="preload" href="${base}manifest.json" as="fetch" crossorigin="anonymous" />`,
            `<link rel="preload" href="${base}planes.json" as="fetch" crossorigin="anonymous" />`,
          ].join('\n    '),
        )
      },
    },
  }
}

/**
 * Serves the PRD 7.6.1 headers locally, so development and `pnpm preview` run under the same
 * policy Vercel enforces. `pnpm preview` gets the production policy verbatim; the dev server
 * additionally allows Vite's inline refresh preamble and its websocket.
 */
function localSecurityHeaders(): Plugin {
  const apply = (dev: boolean) => (_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    for (const { key, value } of securityHeaders({ dev })) res.setHeader(key, value)
    next()
  }
  return {
    name: 'eternities:security-headers',
    configureServer(server) {
      server.middlewares.use(apply(true))
    },
    configurePreviewServer(server) {
      server.middlewares.use(apply(false))
    },
  }
}

export default defineConfig({
  plugins: [react(), injectDataHash(), localSecurityHeaders()],
  build: {
    target: 'es2022',
    /**
     * Off, per the board's answer to review §8 Q7 (B3).
     *
     * The maps were built and never served: 2.2 MB of `.map` for the three chunks, which Vercel
     * answers with HTTP 403 (measured against the deployment, review §2.1). They were also
     * invisible to `scripts/check-budget.mjs`, which counts JS, CSS and fonts — so 3 MB of `dist/`
     * sat outside every budget the repo checks. Nothing debugs production off this deployment;
     * `'hidden'` would keep the build cost for a file nobody can fetch.
     */
    sourcemap: false,
    /**
     * Emitted so `scripts/check-budget.mjs` can tell the product's bytes from the harness's.
     *
     * It is the only way to know: both entries build into one `dist/`, so a walk of the directory
     * cannot say which files `index.html` can reach. Written to `dist/.vite/manifest.json`, which
     * is not served (the leading dot is not why — nothing links it, and PRD 7.6.1's policy does not
     * matter for a file no page references). It costs a few kB in `dist/` and is not counted.
     */
    manifest: true,
    // PRD 7.7.3: upgrades are deliberate, so keep the chunking legible rather than clever.
    rollupOptions: {
      /**
       * Two entries (review §3.6 phase 3, item 4).
       *
       * `harness.html` is the bench, the GPU self-check and the `?probe=1` scene. They were
       * `lazy()` branches of the product entry, which kept them out of its first chunk but not out
       * of its build — `App` named the modules, so rollup emitted them from `index.html` and a
       * `dist/` diff could not separate the product from its instruments.
       *
       * Rollup shares modules across inputs rather than duplicating them, so the scene, three.js
       * and React stay one copy each; what the second input adds is a small entry chunk and the
       * boundary itself. `scripts/check-budget.mjs` knows which emitted files belong to which
       * entry — it reads the build manifest below rather than walking `dist/`, because the harness
       * is not transferred before the product's first frame and must not be budgeted as if it were.
       */
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        harness: fileURLToPath(new URL('./harness.html', import.meta.url)),
      },
      output: {
        /**
         * Vite 8 replaced rollup with rolldown, and rolldown does not accept the object form of
         * `manualChunks` at all — only a function, and that spelling is deprecated on arrival in
         * favour of `codeSplitting.groups`. So this is the same two chunks re-expressed, not a
         * change of policy: PRD 7.7.3 still wants the chunking legible rather than clever.
         *
         * The one thing worth knowing is what carries the *unnamed* members of these chunks. The
         * old object form listed package entry points and rollup pulled each one's non-shared
         * dependencies in behind it — which is how react-dom's `scheduler` sat in the react chunk
         * without ever being mentioned here. A group `test` matches module ids, so the natural
         * worry is that it captures only what it literally names and strands `scheduler` in the
         * product entry, moving bytes across the very boundary `scripts/check-budget.mjs` budgets
         * against. It does not: rolldown's `includeDependenciesRecursively` defaults to `true`, so
         * a captured module drags its dependency graph into the group with it, and the old
         * behaviour is preserved for the same reason it existed before.
         *
         * That is measured, not assumed — building with `scheduler` added to the react pattern and
         * without it produces a byte-identical chunk (same content hash), and `scheduler`'s
         * markers appear in the react chunk and in neither the product entry nor the styles chunk.
         * Naming it here would therefore be decoration; the pattern stays the two packages the
         * object form named.
         *
         * `[\\/]` rather than `/` per rolldown's own guidance, so the pattern still anchors on a
         * path separator under Windows; the `node_modules[\\/]<pkg>[\\/]` shape also keeps these
         * anchored to the package root, so pnpm's `.pnpm/<pkg>@<version>/node_modules/<pkg>/`
         * layout matches on the final segment rather than on the version-stamped one.
         */
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom)[\\/]/ },
          ],
        },
      },
    },
  },
})
