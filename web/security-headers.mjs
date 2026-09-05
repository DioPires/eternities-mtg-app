/**
 * The single definition of the site's security headers (PRD 7.6.1).
 *
 * Used three ways, so the policy can never drift between them:
 *   - `vite.config.ts` sends them from the dev server and from `pnpm preview`;
 *   - `scripts/write-vercel-json.mjs` writes them into `web/vercel.json`;
 *   - the same script with `--check` fails CI if `vercel.json` has drifted.
 *
 * The policy is live from day one on purpose (implementation-plan.md §2 Phase 0): every later
 * phase develops under the real policy, and Phase 5 audits it. That audit is written up in
 * `docs/csp-audit.md`; two of its findings landed here, on `style-src` and on HSTS.
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
    /*
     * Phase 5's CSP audit answered the question Phase 0 left open here — see
     * `docs/csp-audit.md`. The old value was `style-src 'self' 'unsafe-inline'`, which allowed
     * both inline `<style>` elements and inline `style` attributes. Since the design system
     * landed, the built site has exactly one stylesheet and it arrives as a `<link>`, so the
     * element half buys nothing and the two are split.
     *
     * `style-src-elem` inherits `style-src`, which is now `'self'` alone: an injected `<style>`
     * block — the shape an XSS payload takes when it wants to restyle or overlay the page — is
     * refused. `style-src-attr` keeps the relaxation, scoped to attributes, where the payload
     * surface is one element's own box rather than the document.
     *
     * The attribute relaxation is kept **conservatively, not because anything needs it**, and
     * dropping it is a Phase 6 item (csp-audit.md F5). `style-src-attr` governs only a literal
     * `style` *attribute* being applied; every inline style this app writes — the label overlay's
     * per-frame `node.style.transform` of PRD 7.3.3 included — goes through the CSSOM, which no
     * CSP directive governs. Removing the directive was tested clean in review (DEC-632); it is
     * held until Phase 3's card tier lands, because that is the one route the test did not cover.
     *
     * `verify-browser.mjs` asserts the built site loads clean under exactly this policy, so a
     * future dependency that injects a `<style>` fails the check rather than the user's page.
     */
    'style-src': ["'self'"],
    'style-src-attr': ["'unsafe-inline'"],
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
    // Vite's dev server injects CSS as `<style>` elements so HMR can swap them. The built site
    // does not — it ships one `<link>` — which is why the production policy above can be strict.
    directives['style-src'].push("'unsafe-inline'")
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
    /*
     * Added by Phase 5's audit. `upgrade-insecure-requests` in the CSP rewrites sub-resource URLs
     * but says nothing about the *first* request, which is the one a network attacker gets to
     * answer. Two years, subdomains included; no `preload`, because submitting to the browsers'
     * preload list is a commitment that outlives this deployment and is the owner's to make.
     *
     * Sent on the dev server too. It is scoped to a host, `localhost` is exempt from HSTS in
     * every current browser, and a policy that only exists in production is a policy nobody
     * notices breaking.
     */
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
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
