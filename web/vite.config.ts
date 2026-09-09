import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
    // PRD 7.7.3: upgrades are deliberate, so keep the chunking legible rather than clever.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
