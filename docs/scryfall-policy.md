# Scryfall policy and CORS verification

**Verdict: PASS.** The card tier can be built as the PRD specifies. No board decision is needed.

Checked 2026-09-04 as PRD risk 1 and open question 5 require, before any dependent code
(implementation-plan.md §2 Phase 0).

**Re-confirmed 2026-09-05 (Phase 6, DEC-592), before launch.** Nothing has moved. §8's checks were
re-run in full; the evidence is in §9. CORS headers identical, CSP guidance identical, rate limits
identical, the terms of use identical clause for clause, and §6's derived URI scheme still holding
for both faces of a transform card. The residual risks in §7 stand as written; none of them fired.

---

## 1. What had to be true

PRD 8.5.8 loads thumbnails with `fetch` + `createImageBitmap` rather than `<img>`, and uploads the
result as a WebGL texture. That needs three things, and PRD 4.11.3 / 8.10 leave no compliant
fallback if any of them fails — no proxy, no mirror, no server-side resize:

1. Scryfall's image CDN must send CORS headers, so a cross-origin `fetch` succeeds.
2. The texture upload must not be tainted, so `crossOrigin` / `mode: 'cors'` must be honoured.
3. Hotlinking must be permitted by Scryfall's terms, with attribution we can actually satisfy.

## 2. CORS — verified against the live CDN

`GET https://cards.scryfall.io/small/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215`
with `Origin: https://eternities-mtg-app.vercel.app`:

```
HTTP/2 200
content-type: image/jpeg
cache-control: public, max-age=31556952
server: ScryfallEdgeCDN (scryfall.io)
access-control-allow-origin: *
access-control-allow-methods: GET, OPTIONS
access-control-allow-headers: Accept, Accept-Charset, Accept-Language, Cache-Control,
  Content-Language, Content-Type, DNT, Host, If-Modified-Since, Keep-Alive, Origin, Referer,
  User-Agent, X-Requested-With
```

`https://backs.scryfall.io/...` (the card back of PRD 5.6.2) returns the same
`access-control-allow-origin: *`. `https://api.scryfall.com/sets` does too, though the browser
never calls the API — PRD 4.1.1 keeps that in the pipeline.

`access-control-allow-origin: *` on a `GET` is exactly what `createImageBitmap` on a
`fetch(..., { mode: 'cors' })` response needs, and what keeps a WebGL texture untainted. The
one-year `cache-control` also means the LRU thumbnail loader of PRD 8.5.8 mostly hits the browser
cache after a first visit.

Scryfall's own documentation (`https://scryfall.com/docs/api/http-concerns`) confirms it:

> `api.scryfall.com`, as well as all of the Scryfall image origins set CORS headers for `GET`,
> `HEAD`, `POST`, `OPTIONS` requests. **Please note**, that in order to receive CORS headers from
> our system, you must include the HTTP `Origin` header in your request and it must match the
> domain and protocol of the current page. […] Using HTTP `Referer` or URL parameters will not work.

A browser sets `Origin` on a cross-origin `fetch` automatically, so this is satisfied by
construction. It does mean an image must never be loaded through a mechanism that omits `Origin`.

## 3. CSP — what Scryfall asks for, and what we ship

Scryfall's guidance, same page:

> For CSP, you can grantlist `*.scryfall.com` to use our API and our assets. […] `img-src`
> `*.scryfall.io`

Our policy (`web/security-headers.mjs`, live from day one) grantlists `https://*.scryfall.io` in
**both** `img-src` and `connect-src`. `connect-src` is the one that matters: a `fetch()` is
governed by `connect-src`, not `img-src`, and PRD 8.5.8 fetches. `api.scryfall.com` is deliberately
*not* grantlisted — the browser never talks to the API.

The policy is verified by `web/e2e/a11y.spec.ts` 9f, which drives the built site under the
production headers and fails on any `securitypolicyviolation` — with a control that injects a
`<style>` element, so "no violations" cannot mean "the listener is dead".

## 4. Rate limits

From `https://scryfall.com/docs/api/rate-limits`:

> The direct file origins located at `*.scryfall.io` **do not have rate limits.**

The API's limits (2/second on card endpoints, 10/second elsewhere) apply only to the pipeline, and
PRD 4.1.1 already has it using the bulk file rather than per-card calls. PRD 7.2's 6-concurrent
image cap is therefore a politeness and bandwidth measure, not a compliance requirement — worth
keeping either way.

Scryfall also asks that bulk data be re-fetched no more than daily, and notes gameplay data changes
far less often than that. PRD 4.10.1's "roughly once per set release" is well inside it.

## 5. Terms of use — the parts that bind Eternities

From `https://scryfall.com/docs/api` ("Use of Scryfall Data and Images"). Each is followed by where
the PRD already satisfies it, or what it obliges us to do.

**Data**

| Requirement | Status |
|---|---|
| No use of Scryfall logos or implied endorsement | Satisfied — no Scryfall assets are used. |
| No paywall, no surveys, subscriptions, ratings, chat-server joins, or follows for access | Satisfied — PRD 4.11.1 is free and non-commercial; PRD 8.10 has no accounts. |
| Must not imply the data is from a game other than Magic | Satisfied. |
| Must not simply repackage, republish or proxy Scryfall data; must add value | Satisfied — a 3D spatial visualisation is not a repackaging. Note this also *forbids* the mirror/proxy fallback PRD 4.11.3 already rules out. |

**Images**

| Requirement | Status |
|---|---|
| Do not cover, crop or clip the copyright line or artist name | Satisfied — PRD 5.6.2 shows the full `large` card image. **Constraint for Phase 3:** nothing in the HUD or the card panel may overlay the bottom strip of the focused card. |
| Do not distort, skew or stretch | **Constraint for Phase 3:** the card mesh and the thumbnail quads must keep the printing's aspect ratio. PRD 8.5.8's 128×178 atlas cells are 1:1.39, which matches a Magic card. |
| Do not blur, sharpen, desaturate or colour-shift | **Constraint for Phase 2a/3:** filter dimming (PRD 5.8.1) applies to *stars*. A dimmed card that has crossed into thumbnail tier must not be a desaturated or darkened card image; dim the rim glow and drop the thumbnail back to the star representation instead. This is a real design consequence and belongs in Phase 3's acceptance criteria. |
| Do not add watermarks, stamps or logos to card images | Satisfied. |
| Do not imply someone other than Wizards created the card | Satisfied. |
| When using `art_crop`, list the artist name and copyright in the same interface, **or** show the full card image in the same interface | Satisfied by construction — PRD 5.6.7's planets (`art_crop`) only ever appear orbiting the focused card, which is showing its full `large` image at the same time. Worth stating in the About view anyway. |

**Attribution.** PRD 4.11.1–2 already require the Wizards Fan Content Policy notice and a Scryfall
credit in the About view (Phase 5). Scryfall does not mandate a specific wording; the standard
notice Scryfall itself carries is the model:

> Portions of Eternities are unofficial Fan Content permitted under the Wizards of the Coast Fan
> Content Policy. The literal and graphical information presented about Magic: The Gathering,
> including card images and mana symbols, is copyright Wizards of the Coast, LLC. Eternities is not
> produced by or endorsed by Wizards of the Coast. Card data and images are provided by Scryfall.

## 6. URI derivation, verified

`docs/data-contract.md` §9 derives image and page URIs rather than storing three ~90-character URIs
per printing. Checked against live Scryfall responses:

| Card | Observed |
|---|---|
| Sol Ring (`91fdb56b-…`) | `https://cards.scryfall.io/small/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215` |
| Delver of Secrets (`6904ea20-…`, transform) | front `…/small/front/6/9/6904ea20-….jpg?1783908173`, back `…/small/back/6/9/6904ea20-….jpg?1783908173` |
| Delver of Secrets page | `https://scryfall.com/card/inr/60/delver-of-secrets-insectile-aberration` — the slug is optional, `https://scryfall.com/card/<set>/<collector_number>` resolves |

So `https://cards.scryfall.io/<size>/<face>/<id[0]>/<id[1]>/<id>.jpg?<ts>` holds for both faces and
every size the product uses. The derivation lives in exactly two files
(`pipeline/src/eternities/contract/images.py`, `web/src/data/images.ts`) and is pinned by the shared
test vector, so if Scryfall ever changes the scheme it is a two-line fix plus a re-run, not a hunt.

This still satisfies PRD 4.11.3: images are loaded from Scryfall's URIs at the size the view needs,
never mirrored and never resized server-side.

## 7. Residual risks

1. **The URI scheme is derived, not stored.** If Scryfall changes it, images break — but stored
   URIs would 404 just the same, so this is no worse, and it is cheaper to fix. Phase 6's
   re-confirmation should re-run the checks in §6.
2. **`security_stamp: triangle`** (PRD open question 4) was *not* settled here; it is a pipeline
   data question and stays with Phase 1's first-run verification duties.
3. **Policy drift.** Scryfall can change its terms. Phase 6 re-checks §2–§5 before launch, and the
   refresh runbook should carry a "re-read the terms" line for the Simulation Engineer's periodic
   refresh.

## 8. How to re-run this check

```sh
# CORS on the image CDN
curl -sS -o /dev/null -D- -H "Origin: https://eternities-mtg-app.vercel.app" \
  "https://cards.scryfall.io/small/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215" \
  | grep -i access-control

# The policy pages
curl -sS -A "Eternities/0.1 (contact)" https://scryfall.com/docs/api
curl -sS -A "Eternities/0.1 (contact)" https://scryfall.com/docs/api/rate-limits
curl -sS -A "Eternities/0.1 (contact)" https://scryfall.com/docs/api/http-concerns

# §6's URI derivation, against live API responses
curl -sS -A "Eternities/0.1 (contact)" \
  "https://api.scryfall.com/cards/91fdb56b-54d5-4272-8319-505ff987fe9b"     # single-faced
curl -sS -A "Eternities/0.1 (contact)" \
  'https://api.scryfall.com/cards/search?q=%21%22Delver+of+Secrets%22&unique=prints'   # transform

# The CSP as the browser sees it
cd web && pnpm build && pnpm exec playwright test e2e/a11y.spec.ts
```

## 9. Phase 6 re-confirmation, 2026-09-05

Every check in §8 re-run. Verdict unchanged: **PASS**, no drift, nothing to escalate.

| Check | Result |
|---|---|
| §2 CORS, `cards.scryfall.io` | `HTTP/2 200`, `access-control-allow-origin: *`, `access-control-allow-methods: GET, OPTIONS`, `cache-control: public, max-age=31556952`, `server: ScryfallEdgeCDN`. Byte-for-byte what §2 records, plus an `x-content-type-options: nosniff` that changes nothing for us. |
| §2 CORS, `backs.scryfall.io` | `HTTP/2 200`, `access-control-allow-origin: *`. |
| §3 CSP guidance (`/docs/api/http-concerns`) | Unchanged, including the `Origin`-header requirement and the exhaustive spec `connect-src api.scryfall.com embed.scryfall.com; img-src *.scryfall.io …`. Our policy still grantlists `https://*.scryfall.io` in both `img-src` and `connect-src`, which is what PRD 8.5.8's `fetch` needs. |
| §4 rate limits (`/docs/api/rate-limits`) | Unchanged: `*.scryfall.io` still has **no** rate limits; API limits still 2/second on the card endpoints and 10/second elsewhere, neither of which the browser touches. The "cache for at least 24 hours, use bulk data" guidance is unchanged, and PRD 4.10.1's per-set-release refresh stays well inside it. A `/cards/manifest — 10/minute` row is new since 2026-09-04; the pipeline does not call it. |
| §5 terms of use (`/docs/api`) | Unchanged clause for clause — all four data guidelines and all six image guidelines, including the `art_crop` attribution rule, read exactly as §5 quotes them. |
| §6 URI derivation | Still holds. Sol Ring returns `…/small/front/9/1/91fdb56b-….jpg?1783903215` and the same for `large` and `art_crop`. Delver of Secrets (`6904ea20-e504-47da-95a0-08739fdde260`, `layout: transform`) returns `…/small/front/6/9/….jpg?1783908173` and `…/small/back/6/9/….jpg?1783908173`, and its page is `https://scryfall.com/card/inr/60/…`. |

Two notes for the record.

**The Delver id in §6 was abbreviated to its first block.** The full printing id is
`6904ea20-e504-47da-95a0-08739fdde260`; §6's `6904ea20-…` matched the *wrong* full id when expanded
naively, which is worth knowing before anyone re-runs that row by hand. The scheme it demonstrates is
unaffected.

**§7.3's ask is discharged into the runbook, not here.** "Re-read the terms" belongs in the periodic
refresh the Simulation Engineer owns, so it goes in the refresh runbook rather than being re-promised
in this document.

## 10. Refresh re-confirmation, 2026-09-21 (DEC-885)

Every check in §8 re-run before the DEC-885 production refresh, except the last (the CSP as the
browser sees it), which that refresh's own `pnpm test:e2e` covers. Verdict: **PASS**, no drift,
nothing to escalate.

| Check | Result |
|---|---|
| §2 CORS, `cards.scryfall.io` | `HTTP/2 200`, `access-control-allow-origin: *`, `access-control-allow-methods: GET, OPTIONS`, `cache-control: public, max-age=31556952`. |
| §2 CORS, `backs.scryfall.io` | `HTTP/2 200`, `access-control-allow-origin: *`. |
| §3 CSP guidance (`/docs/api/http-concerns`) | Unchanged, including the exhaustive spec `connect-src api.scryfall.com embed.scryfall.com; img-src *.scryfall.io …`. |
| §4 rate limits (`/docs/api/rate-limits`) | Unchanged from §9: `*.scryfall.io` has no rate limits; 2/second on `/cards/search`, `/named`, `/random`, `/collection`; `/cards/manifest` 10/minute; 10/second elsewhere; "cache … at least for 24 hours" and "must use the bulk data files" unchanged. |
| §5 terms of use (`/docs/api`) | Unchanged clause for clause — the four data guidelines and the six image guidelines, including the `art_crop` rule. The page closes with "Repeated mishandling or misrepresentation of data or images in your project may result in Scryfall restricting or blocking your API access": a consequence clause, not a new obligation, and §5's table already satisfies everything it could be invoked over. |
| §6 URI derivation | Still holds. Sol Ring returns `…/small/front/9/1/91fdb56b-….jpg?1783903215` and the same for `art_crop`; Delver of Secrets (`6904ea20-e504-47da-95a0-08739fdde260`, `layout: transform`) returns `…/small/front/6/9/….jpg?1783908173` and `…/small/back/6/9/….jpg?1783908173`. |
