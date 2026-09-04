/**
 * Types for `security-headers.mjs`.
 *
 * The policy lives in a plain `.mjs` module because `scripts/*.mjs` read it with no build step,
 * and `vite.config.ts` imports it too — so it needs a declaration to stay type-safe on both sides.
 */

export interface SecurityHeaderOptions {
  /** Allow Vite's inline refresh preamble and its websocket. Never true for a built site. */
  dev?: boolean
}

export interface HttpHeader {
  key: string
  value: string
}

export declare const SCRYFALL_IMAGE_ORIGINS: string
export declare const IMMUTABLE_CACHE_CONTROL: string
export declare function contentSecurityPolicy(options?: SecurityHeaderOptions): string
export declare function securityHeaders(options?: SecurityHeaderOptions): HttpHeader[]
export declare function vercelConfig(): Record<string, unknown>
