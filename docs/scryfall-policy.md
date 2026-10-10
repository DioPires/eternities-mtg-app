# Scryfall policy and CORS verification

**Verdict: PASS.** The card tier can be built as the PRD specifies. No board decision is needed.

Checked 2026-09-04 as PRD risk 1 and open question 5 require, before any dependent code
(implementation-plan.md §2 Phase 0).

**Re-confirmed 2026-09-05 (Phase 6, DEC-592), before launch.** Nothing has moved. §8's checks were
re-run in full; the evidence is in §9. CORS headers identical, CSP guidance identical, rate limits
identical, the terms of use identical clause for clause, and §6's derived URI scheme still holding
for both faces of a transform card. The residual risks in §7 stand as written; none of them fired.

**Re-verified 2026-10-10 for the native client of PRD v4 (DEC-952): PASS**, with two amendments to
PRD 4.15 proposed and CORS and CSP no longer in play. The per-rule verdicts are in §11.

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

## 11. Desktop client re-verification, 2026-10-10 (DEC-952)

PRD v4 4.15 (read at Amendment 1, `main` `c4decf6`) moves the product from a browser to a native
client (Unity, macOS and Windows), and 9.5 makes this check a prerequisite of the Dominaria slice.
The pages below were fetched on **2026-10-10** between 17:58 and 18:10 UTC, and every quotation in
this section is the live text of that fetch. Section numbers written with a § are this document's;
bare numbers are PRD v4's.

| Short name | Page |
|---|---|
| API | `https://scryfall.com/docs/api` ("Required Headers", "Use of Scryfall Data and Images") |
| Rate limits | `https://scryfall.com/docs/api/rate-limits` |
| Imagery | `https://scryfall.com/docs/api/images` |
| CORS and CSP | `https://scryfall.com/docs/api/http-concerns` |
| Terms | `https://scryfall.com/docs/terms` |
| Access FAQ | `https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17` |
| Changelog | `https://scryfall.com/blog/category/api` |

**Verdict: PASS, with two amendments to PRD 4.15 and one clarifying sentence.** Nothing blocks the
slice. Both amendments correct wording the slice's image loader would otherwise implement literally.

| # | PRD 4.15 rule | Verdict |
|---|---|---|
| 1 | One host at runtime, no API calls | **Needs an amendment.** Two hostnames, not one: `cards.scryfall.io` and `backs.scryfall.io`. No API calls: holds. |
| 2 | `normal` for stands, `large` for card view | **Holds.** Watch item: the Imagery page now lists WEBP sizes that "replace" both. |
| 3 | On-disk cache capped at 2 GB, against bulk downloading and mirroring | **Holds**, with a clarifying sentence: the fill rule, not the cap, is what keeps it a cache. |
| 4 | `User-Agent` and `Accept` | **Holds.** |
| 5 | 6 requests in flight, against the request-rate guidance | **Holds.** |
| 6 | Backoff on 429 and 5xx; 4xx final for the session | **Needs an amendment.** A 429 or a 403 must pause every image request, not one URL, and for at least 30 s. |
| 7 | Attribution: the printed artist line plus the text credit | **Holds.** One constraint for the slice on the image surface's aspect. |

### 11.1 One host at runtime; no API calls (4.15.1)

> The direct file origins located at `*.scryfall.io` do not have rate limits. (Rate limits)

> `api.scryfall.com`, as well as all of the Scryfall image origins set CORS headers […] (CORS and CSP)

> If you need to rapidly look up card names, prices, or resolve a large number of card images, you
> must use the bulk data files. (Rate limits)

Scryfall speaks of image *origins*, plural, and the product uses two of them. Card faces are on
`cards.scryfall.io`. The card back that PRD 5.10.2 shows is on `backs.scryfall.io`
(`docs/data-contract.md` §9), and 4.15.2 forbids bundling it:

```
GET https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg
HTTP/2 200   content-type: image/jpeg   content-length: 131415
cache-control: public, max-age=31556952   server: cloudflare
```

Scryfall's text does not limit which image origins a client uses. "Exactly one host" is the PRD's
own privacy rule (7.5.1, 8.10), and it is what the 9.1.6 lint and the loader's allowlist will be
written from, so it has to name both. A loader built to one hostname shows no card back.

No API calls holds as written. The client resolves nothing at run time: every image URI comes from
the pack, which the pipeline builds from the bulk files, as the quoted sentence requires. The bulk
files have been JSONL only since 2026-07-20 (Changelog, 2026-07-01); the pipeline already reads
`jsonl_download_uri`.

**Proposed 4.15.1:** "At runtime the application contacts only Scryfall's image origins:
`cards.scryfall.io` for card faces and `backs.scryfall.io` for the card back. It never calls the
Scryfall API (`api.scryfall.com`); every card fact it shows is in the data pack. The pipeline, as in
v3, fetches bulk data at build time." Sections 7.5.1, 8.10 and 9.1.6 say "Scryfall's image CDN" and
read correctly once 4.15.1 names the two hostnames. The loader should also refuse a redirect to any
other host.

### 11.2 Image sizes (4.15.2)

The Imagery page's table, the four rows that matter:

| Image | Size | Format | Description |
|---|---|---|---|
| `normal` | 488 × 680 | JPG | "A medium-sized full card image" |
| `large` | 672 × 936 | JPG | "A large full card image" |
| `grid` | 488 × 680 | WEBP | "A medium-sized full card image, replaces `normal`" |
| `display` | 672 × 936 | WEBP | "A large full card image, replaces `large`" |

All four are served today (Sol Ring, `91fdb56b-…`: `normal` 71,336 B and `large` 108,034 B as
`image/jpeg`; `grid` 37,466 B and `display` 52,212 B as `image/webp`), and a live card object's
`image_uris` carries eleven keys, the five WEBP sizes among them. The rule holds: both sizes exist at
the dimensions the PRD states, and `small` and `art_crop` are not needed.

The word "replaces" is the watch item. The Changelog announces no retirement of the JPG sizes (its
latest entry, 2026-07-01, is about bulk files), and §§9 and 10 did not read this page, so when the
WEBP rows appeared is not recorded. JPG stays the right choice for now: it is what the engine
decodes without a plugin and what the v3 pack's derived URIs (§6) spell. If Scryfall retires the JPG
sizes every stand falls back to its swatch at once, so the size name and the extension belong in one
table in the loader, the slice should record whether the engine can decode WEBP, and the refresh
runbook's terms re-read should include this page.

### 11.3 The on-disk cache, against bulk downloading and mirroring (4.15.3)

> You may not simply repackage, republish, or proxy Scryfall data. Your software must create
> additional value for end-users. (API)

> We encourage you to cache the data you download from Scryfall or process it locally in your own
> system, at least for 24 hours. (Rate limits)

> […] if you need to download a large amount of images, please use one of our bulk data offerings.
> (Access FAQ, under "429 Too Many Requests")

> You may not place undue burden on Scryfall through the use of automated means (Terms)

The image origin itself answers with `cache-control: public, max-age=31556952`: one year, cacheable
by anyone. No live sentence forbids caching an image or sets a size for a cache, and none of the
policy pages above mentions mirroring. The one mention of hotlinking is the Changelog's "Can I still
hotlink to the new origins?", answered "Yes." (2022-09-28, still live). "Images are never bundled,
mirrored or bulk-downloaded" is the PRD's own rule and is stricter than Scryfall's text, which
objects to two things: republishing, and load.

A private cache does neither. It is never served to anyone, and it removes load (a warm run sends
no request at all). The FAQ sentence sits in the API's 429 section and is followed by "Other
domains, such as files on `*.scryfall.io`, do not have these limits": it tells a client not to look
images up through the API one card at a time, which this client cannot do.

The cap alone does not make this a cache, though. A sample of 40 cards from the set `dom` averaged
91,444 B per `normal` image and 146,013 B per `large`, so 2 GB holds about 21,900 `normal` images,
three quarters of the catalogue's 28,603 cards, and Dominaria's 6,271 stands are about 570 MB. What
keeps it a cache is the fill rule, which is already the design (5.5.5, 8.4.3) and is worth stating
as the compliance reason: an image is fetched only because a view asked for it, nearest-first, never
more than the 384 slots, plus the card in card view.

One PRD rule has to be read with this. The hub preloads the world whose portal the avatar is nearest
(5.3.3) and does not say what a preload contains. If it filled that world's image slots, a walk
round the ring of 88 portals would request up to 88 × 384 = 33,792 images, about 3.1 GB, for worlds
the visitor never entered: a bulk download by another name. A world is ready without its images
(a stand shows its swatch until its image arrives, 5.5.5), so the preload loses nothing by leaving
them out.

**Holds.** Proposed sentence to append to 4.15.3: "The cache is filled only by images a view
requested (5.5.5, 5.10.2): the hub's world preload (5.3.3) fetches no card image, nothing else
prefetches, warms or crawls ahead of the visitor, and the cache is never exported, shared or served
to another device."

Two things the browser did for free and the native cache must do itself: key an entry on the full
URL including the `?<timestamp>` query, so a re-scanned card is a new entry, and treat an entry
older than the origin's `max-age` as absent.

### 11.4 `User-Agent` and `Accept` (4.15.4)

> All HTTP requests to `api.scryfall.com` must include a `User-Agent` header and an `Accept` header.
> Your `User-Agent` header must be accurate to your usage context. If you are running a script or
> app, the header should be the name of your application, such as `MTGExampleApp/1.0` or the current
> relevant version. Do not allow HTTP libraries to choose the header for you. (API)

> The `Accept` header must be present, but you can provide a generic preference. (API)

> Please ensure you have set a relevant `User-Agent` header. Do not allow your HTTP library to
> choose this header for you, as default header values from HTTP libraries are often flagged as junk
> traffic. (Access FAQ, which opens: "[…] when trying to use the Scryfall API or download our static
> files.")

The requirement is written for the API, which the client never calls. The image origin does not
enforce it (a request with neither header returns 200; the same request to the API returns 400).
The FAQ extends the advice to static files, so the PRD is right to send both everywhere.
`Eternities/<version> (+<URL>)` is the form the page asks for, and `Accept: image/*` is a valid
generic preference; the origin sends no `Vary` header, so the format is chosen by the URL alone.

**Holds.** Two notes. An engine's HTTP stack sends its own default `User-Agent` unless one is set,
which is exactly what the page says not to send, so the slice's image-path tests should assert the
outgoing header rather than trust the setter. And the URL in the parenthesis is only useful to
Scryfall's operators while it resolves for a stranger: it does, because the repository is public
(7.7.2, Amendment 1), and it must be replaced if that ever changes.

### 11.5 Six requests in flight (4.15.4, 7.2)

> The direct file origins located at `*.scryfall.io` do not have rate limits. (Rate limits)

> No, only `api.scryfall.com` has a rate limit. (Changelog, 2022-09-28, still live, answering "Do
> the new origins have a rate limit?")

> You may not place undue burden on Scryfall through the use of automated means (Terms)

The API's limits (2 per second on four card endpoints, 10 per minute on `/cards/manifest`, 10 per
second elsewhere) are unchanged from §10 and bind only the pipeline. For the image origins there is
no number to meet; the binding text is "undue burden". Six in flight is the PRD's own limit and is
modest: a cold arrival in a world fills at most 384 slots, about 35 MB, and after that requests
follow walking pace. **Holds.**

One native-client point: a browser capped connections per host by itself. Here the limit is the
loader's own semaphore, and it should count requests to both hostnames of §11.1 together.

### 11.6 Backoff on 429 and 5xx; 4xx final for the session (4.15.4)

> Submitting excessive requests to API server may result in an HTTP 429 Too Many Requests status
> code. Recieving [sic] an HTTP 429 response will result in your access being limited for 30 seconds.
> Continuing to overload the API after this point may result in a temporary or permanent ban of your
> application. (Rate limits)

> It is not acceptable to ignore HTTP 429 responses. You must act to reduce your application’s
> overages. (Rate limits)

> It is not acceptable to ignore this error code or have your application retry the requests until
> you power through them. (Access FAQ)

> If you are seeing these status codes, you may have offended our API’s malicious traffic filtering
> tools or otherwise greatly overtaxed the API. (Access FAQ, under "400 Bad Request, or 403
> Forbidden")

These are written for the API. The image origins document no limit and therefore no 429, but the
FAQ's opening line names static files, and if an image origin ever answers 429 or 403 this is the
only guidance there is. Read against it, the PRD's rule has two faults in its 429 half:

1. **Scope.** "Responses with status 429 or 5xx trigger exponential backoff" reads as backoff for
   that URL. The other five requests in flight and the hundreds of stands queued behind them would
   carry on, which is what "ignore" describes.
2. **Duration.** Retries at 1 s, 4 s and 16 s land 1 s, 5 s and 21 s after the 429: all three inside
   the 30 seconds for which access is limited. That is retrying until it gets through.

A third fault is in the other half of the rule. A 403 is a statement about the client, not about
one image (a missing image is a 404; probed:
`…/normal/front/0/0/00000000-0000-0000-0000-000000000000.jpg` returns `404`, `text/html`), so
treating it as "final for that URL" leaves the loader asking for every other stand while it is
blocked. It belongs with 429.

The rest holds as written: the 5xx backoff, and every 4xx other than 429 and 403 being final for
that URL for the session.

**Proposed replacement for the backoff sentence of 4.15.4:** "A 5xx response or a network failure
retries that URL with exponential backoff (1 s, 4 s, 16 s) and then leaves it for the session. A 429
or a 403 from either image origin pauses every image request, not only that URL, for at least 30 s
(longer if `Retry-After` says so), doubles the pause on each repeat, and resumes with one request in
flight before returning to six. Any other 4xx is final for that URL for the session."

### 11.7 Attribution (4.15.5)

The six image guidelines of the API page read exactly as §5 quotes them. Against the native design:

| Guideline (API) | Native client |
|---|---|
| "Do not cover, crop, or clip off the copyright or artist name on card images." | Holds. Only complete card images are shown (4.15.5), and the screenshot is taken without the HUD (6.8). On a stand the image is 244 × 340, where the printed line is present but too small to read, as it is on Scryfall's own `small`; the hover label names the artist as text within 3 m (5.5.3) and card view names the artist beside the printings panel (5.10.3). §5's constraint carries over: nothing in card view may overlay the card's bottom strip. |
| "Do not distort, skew, or stretch card images." | Holds, with one constraint for the slice. The image surface must take its aspect from the image's pixels: `normal` is 488:680 (0.7176) and `large` 672:936 (0.7179), while a nominal 5:7 surface (5.5.1) is 0.7143, a 0.5 percent stretch if the image is mapped edge to edge. Perspective in a 3D world and the ±12° tilt of 5.10.2 are the presentation of a flat card, on the reading §5 already took for the web edition. |
| "Do not blur, sharpen, desaturate, or color-shift card images." | Holds by construction: the isolated image path (8.4.4) keeps lighting, exposure, fog, depth of field and post-processing off the image and tests it to 1 on 255, and a filtered-out stand shows its swatch, never a dimmed image (5.5.6). Halving `normal` for the stand array is resampling to display size, not a filter. |
| "Do not add your own watermarks, stamps, or logos to card images." | Holds. Nothing is drawn on an image, in the world or in a screenshot. |
| "Do not place card images in a way that implies someone other than Wizards of the Coast created the card or that it is from another game besides Magic: The Gathering." | Holds: the Fan Content Policy notice is on the start screen and the download page (Appendix E.2). See §11.9. |
| "When using the `art_crop`, list the artist name and copyright elsewhere in the same interface […]" | Does not apply. `art_crop` is not used (4.15.2). |

The text credit ("Card data and images are provided by Scryfall") is a plain source line with no
logo, which is what "You may not use Scryfall logos or use the Scryfall name in a way that implies
Scryfall has endorsed you, your work, or your product" allows. **Holds**, and it does more than the guidelines ask: Scryfall
requires an artist credit in text only beside an `art_crop`.

### 11.8 What does not apply to a native client

- **CORS (§2).** "[…] in order to receive CORS headers from our system, you must include the HTTP
  `Origin` header in your request and it must match the the [sic] domain and protocol of the
  current page." A native client has no page, sends no `Origin` and needs no CORS header: nothing taints a
  texture decoded from bytes the process downloaded itself.
- **CSP (§3).** A browser mechanism with no counterpart in a native process. Its job, bounding where
  the application may connect, passes to the loader's host allowlist and the 9.1.6 lint.
  `web/security-headers.mjs` and `web/e2e/a11y.spec.ts` 9f go on binding the web edition only.
- **"If you are accessing the API via on-page web browser JavaScript, keep the browser’s
  `User-Agent` intact."** The native client sets its own (§11.4).
- **The browser's HTTP cache (§2).** Replaced by the on-disk cache of §11.3.

Still binding, unchanged: the data and image guidelines of §5, and the URI derivation of §6, which
the slice re-implements in C# against the same shared test vector (§7.1's risk now has three
implementations to keep in step).

### 11.9 Beyond 4.15

One data guideline bears harder on the native edition than it did on the web one:

> You may not use Scryfall data to create new games, or to imply the information and images are
> from any other game besides Magic: The Gathering. (API)

A third-person avatar in a game engine looks more like a game than a star map did. The PRD's
controls are non-goal 1 (no mechanic of any kind), Appendix E.5 and the 9.1.6 lint. Whether the
whole product reads as a game is the owner's decision under PRD 11.1, before any distribution, and
is not settled by this document.

The Terms add a caution rather than a rule: Scryfall "may change, terminate, or restrict access to
any aspect of Scryfall, at any time, without notice", and is "the final arbiter" of acceptable use.
"No rate limits" is therefore not a promise, and an accurate `User-Agent` is what lets an operator
write to the project instead of blocking it.

### 11.10 How to re-run this check

```sh
UA="Eternities/0.1 (+https://github.com/DioPires/eternities-mtg-app)"

# The pages quoted above
for p in docs/api docs/api/rate-limits docs/api/images docs/api/http-concerns docs/terms \
  docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17 blog/category/api; do
  curl -sS -A "$UA" -H "Accept: text/html" "https://scryfall.com/$p"
done

# §11.1 and §11.2: both image origins and all four sizes, as a native client sends them (no Origin)
id=9/1/91fdb56b-54d5-4272-8319-505ff987fe9b
for u in normal/front/$id.jpg large/front/$id.jpg grid/front/$id.webp display/front/$id.webp; do
  curl -sS -o /dev/null -D- -A "$UA" -H "Accept: image/*" "https://cards.scryfall.io/$u"
done
curl -sS -o /dev/null -D- -A "$UA" -H "Accept: image/*" \
  "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg"

# §11.4: neither header. 200 from the image origin, 400 from the API
curl -sS -o /dev/null -D- -A "" -H "Accept:" "https://cards.scryfall.io/normal/front/$id.jpg"
curl -sS -o /dev/null -D- -A "" -H "Accept:" \
  "https://api.scryfall.com/cards/91fdb56b-54d5-4272-8319-505ff987fe9b"

# §11.6: a missing image is a 404, not a 403
curl -sS -o /dev/null -D- -A "$UA" -H "Accept: image/*" \
  "https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000000.jpg"
```
