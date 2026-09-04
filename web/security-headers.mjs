/**
 * The single definition of the site's security headers (PRD 7.6.1).
 *
 * Used three ways, so the policy can never drift between them:
 *   - `vite.config.ts` sends them from the dev server and from `pnpm preview`;
 *   - `scripts/write-vercel-json.mjs` writes them into `web/vercel.json`;
 *   - `scripts/check-vercel-json.mjs` fails CI if `vercel.json` has drifted.
 *
 * The policy is live from day one on purpose (implementation-plan.md §2 Phase 0): every later
 * phase develops under the real policy, and Phase 5 only audits it.
 */

/**
 * Scryfall's image origins. Verified in Phase 0 — see `docs/scryfall-policy.md`.
 *
 * `connect-src` matters more than `img-src` here: PRD 8.5.8 fetches images and decodes them with
 * `createImageBitmap` rather than using `<img>`, and a `fetch` is governed by `connect-src`.
 * Scryfall's own CSP guidance grantlists `*.scryfall.io` for assets.
 */
export const SCRYFALL_IMAGE_ORIGINS = 'https://*.scryfall.io'

/**
 * @param {{ dev?: boolean }} [options]
 * @returns {string} the `Content-Security-Policy` header value
 */
export function contentSecurityPolicy(options = {}) {
  const directives = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    // PRD 7.6.1: no third-party script CDN. Vite emits hashed module scripts from our own origin.
    'script-src': ["'self'"],
    // React writes inline `style` attributes and drei's HTML overlays do the same, so inline
    // styles have to be allowed. Phase 5's CSP audit revisits whether style-src-attr alone is
    // enough once the design system's stylesheet is the only <style> in the document.
    'style-src': ["'self'", "'unsafe-inline'"],
    // PRD 7.6.1: fonts are self-hosted.
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', SCRYFALL_IMAGE_ORIGINS],
    'connect-src': ["'self'", SCRYFALL_IMAGE_ORIGINS],
    // Phase 2b parses plane shards off the main thread (implementation-plan.md §2, amendment A1).
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  }

  if (options.dev) {
    // Vite's dev server and @vitejs/plugin-react's refresh preamble need an inline script and a
    // websocket. `pnpm preview` and production do NOT get these, and CI checks the built site
    // under the production policy.
    directives['script-src'].push("'unsafe-inline'")
    directives['connect-src'].push('ws:', 'wss:')
  }

  const rendered = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
  return options.dev ? rendered : `${rendered}; upgrade-insecure-requests`
}

/**
 * Headers applied to every response.
 * @param {{ dev?: boolean }} [options]
 * @returns {Array<{ key: string, value: string }>}
 */
export function securityHeaders(options = {}) {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // PRD 8.10: no analytics and no third parties, so leak as little as possible.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ]
}

/** PRD 8.8.2: the data directory is content-hashed, so it is immutable forever. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * The whole `vercel.json`, generated so it can never disagree with the values above.
 * @returns {object}
 */
export function vercelConfig() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: 'vite',
    buildCommand: 'pnpm build',
    outputDirectory: 'dist',
    installCommand: 'pnpm install --frozen-lockfile',
    github: { silent: true },
    // PRD 6.7.5 / 8.8.2: the site is static, so the host serves index.html for every route that
    // is not a real file. Anything with a dot in the last segment is an asset and falls through.
    rewrites: [{ source: '/((?!data/|assets/|.*\\.[^/]*$).*)', destination: '/index.html' }],
    headers: [
      { source: '/(.*)', headers: securityHeaders() },
      {
        source: '/data/(.*)',
        headers: [{ key: 'Cache-Control', value: IMMUTABLE_CACHE_CONTROL }],
      },
      {
        source: '/assets/(.*)',
        headers: [{ key: 'Cache-Control', value: IMMUTABLE_CACHE_CONTROL }],
      },
      {
        source: '/index.html',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ],
  }
}
