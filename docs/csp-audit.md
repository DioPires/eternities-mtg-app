# CSP and security-header audit

Phase 5 of `implementation-plan.md`: *"CSP audit (the policy itself has been live since Phase 0)."*

The policy has been enforced on every route since Phase 0, precisely so this audit would be a
review of something the whole product has already been developed under, rather than a new
constraint applied at the end. It is generated from one place — `web/security-headers.mjs` — and
served three ways: the dev server, `pnpm preview`, and `web/vercel.json`, which CI regenerates and
diffs (`node scripts/write-vercel-json.mjs --check`).

**Outcome: two changes made, five findings recorded and deliberately not acted on.**

**Phase 6 update (2026-09-05, DEC-674): F5 is now closed — `style-src-attr 'unsafe-inline'` has
been dropped.** Its precondition — Phase 3's card tier reachable from the shell route — is met.
The policy block below and §1 show what ships today; F5 carries the re-check that justified it.

## The policy as it now ships

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self'; script-src 'self'; style-src 'self';
font-src 'self'; img-src 'self' data: blob: https://*.scryfall.io;
connect-src 'self' https://*.scryfall.io; worker-src 'self' blob:; manifest-src 'self';
upgrade-insecure-requests
```

Plus `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy` and — new this pass — `Strict-Transport-Security`.

## Changes made

### 1. `style-src` split, and tightened to `'self'`

Was `style-src 'self' 'unsafe-inline'`, which allowed both inline `<style>` **elements** and inline
`style` **attributes**. Phase 0 left a note here saying Phase 5 should revisit it once the design
system's stylesheet was the only `<style>` in the document. It is, so:

```
style-src 'self'; style-src-attr 'unsafe-inline'
```

`style-src-elem` inherits from `style-src`, which is now `'self'` alone: an **injected `<style>`
block is refused**. That is the shape an XSS payload takes when it wants to restyle the page,
overlay a fake control, or hide something — and it is now blocked.

The attribute relaxation stayed at the time, scoped to attributes, where the payload surface is one
element's own box rather than the document.

**It was retained conservatively, not because anything needed it.** The original justification here
was that "React and drei write `style` attributes, and the label overlay writes a `transform` on
every label on every frame (PRD 7.3.3)". That reasoning does not hold — `style-src-attr` governs
only a literal `style` **attribute** being applied, and every inline style this app produces goes
through the CSSOM instead, which no CSP directive governs. F5 below records what is actually true
and handed the drop to Phase 6.

**Phase 6 completed that half.** `style-src-attr` is gone, so the shipped directive is now just:

```
style-src 'self'
```

which governs **both** halves — an injected `<style>` element and an injected `style` attribute are
each refused. See F5.

The dev server still gets `'unsafe-inline'` on `style-src`, because Vite injects CSS as `<style>`
elements so HMR can swap them. The built site ships one `<link>` and gets the strict policy.
`e2e/a11y.spec.ts` 9f loads the built site under exactly the production policy with a
`securitypolicyviolation` listener attached, so a future dependency that injects a `<style>` fails
that check rather than the user's page — and since DEC-708 it fails it *in CI, on every pull
request*, which is what review §5.5 T3 asked for.

### 2. `Strict-Transport-Security` added

`max-age=63072000; includeSubDomains`.

`upgrade-insecure-requests` in the CSP rewrites **sub-resource** URLs and says nothing about the
first navigation, which is the one request a network attacker gets to answer. HSTS closes that.

No `preload`: submitting to the browsers' preload list is a one-way commitment that outlives this
deployment, and it is the owner's call rather than an engineer's. Sent from the dev server too —
`localhost` is exempt from HSTS in every current browser, and a header that only exists in
production is a header nobody notices breaking.

## Verified, unchanged

| Directive | Finding |
| --- | --- |
| `script-src 'self'` | No `'unsafe-inline'`, no `'unsafe-eval'` in production. Vite emits hashed module scripts from our own origin. Asserted on every page load in `verify-browser.mjs`. |
| `font-src 'self'` | Was aspirational before this phase — the site used the system stack, so the directive protected nothing. It is now load-bearing: Inter ships from `/assets/`, and the browser confirms both faces are same-origin. |
| `connect-src` | `'self'` plus Scryfall. `connect-src`, not `img-src`, is the one that matters: PRD 8.5.8 `fetch`es card images and decodes them with `createImageBitmap`, and a `fetch` is governed by `connect-src`. |
| `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` | Correct and minimal. `frame-ancestors 'none'` supersedes `X-Frame-Options`, which is why that header is absent — deliberately, not by omission. |
| `Referrer-Policy`, `Permissions-Policy`, `COOP` | Unchanged. PRD 8.10 has no analytics and no third parties, so there is nothing to loosen them for. |

## Recorded, not acted on

### F1 — `img-src data: blob:` is not currently used

Nothing in the built bundle contains a `data:image` URI or calls `URL.createObjectURL`. On today's
code both keywords could be dropped.

**Not dropped, on purpose.** Phase 3 (DEC-590) is being written concurrently and is the phase that
introduces the card tier and its thumbnails. Tightening a directive whose only future consumer is
mid-flight in another branch trades a real merge conflict for a theoretical hardening.

Handed to Phase 6's pre-launch re-confirmation: once the card tier has landed, re-check whether
either keyword is reachable and drop what is not.

### F2 — `worker-src blob:` is not needed in production

The plane-detail worker is bundled by Vite as its own file and constructed with
`new Worker(new URL('./worker.ts', import.meta.url))` — a same-origin URL, covered by `'self'`.
`blob:` was added in Phase 2b as insurance.

Left in place: the benefit of removing it is small, the dev-server path is less predictable than
the production one, and `blob:` worker sources are same-origin by construction. Same Phase 6
re-check as F1.

### F3 — `manifest-src 'self'` guards a file that does not exist

There is no web app manifest. The directive restricts rather than permits, so it costs nothing and
is correct in advance if one is ever added. No change.

### F4 — considered and declined

- **`require-trusted-types-for 'script'`.** React 18 did not run clean under Trusted Types without
  a policy shim. Declined as disproportionate for a site with no user-generated content and no
  `innerHTML` of our own (PRD 7.6.3). DEC-741 moved the site to React 19 and did **not** re-test
  this: the decision never rested on the React version — the second clause is what carries it — so
  the outcome is unchanged, but read the first sentence as a statement about React 18 rather than
  as a current measurement.
- **`Cross-Origin-Embedder-Policy`.** Would break the Scryfall image fetches unless Scryfall sends
  `Cross-Origin-Resource-Policy` on its CDN, which is not ours to arrange. Declined.
- **CSP reporting (`report-to` / `report-uri`).** Needs an endpoint. PRD 8.10 is explicit that
  there is no server and no third party, and a reporting endpoint would be both. Declined; the
  browser check in `e2e/a11y.spec.ts` 9f is the substitute, and it fails the build rather than
  filing a report nobody reads.

### F5 — `style-src-attr 'unsafe-inline'` is very likely droppable — **DROPPED in Phase 6**

Raised by the Phase 5 review (DEC-632) against §1's original rationale, and it is right.

`style-src-attr` applies to a literal `style` **attribute** being applied to an element. It does
not apply to CSSOM writes. Everything this app does is a CSSOM write:

- `labels/PlaneLabels.tsx` sets `node.style.transform`, `node.style.opacity` and
  `node.style.fontSize` — property assignments, not attributes, so no directive governs them;
- the `style={{ background: SKY_COLOUR }}` props — two of them, in `EternitiesScene.tsx` and
  `harness/SelfCheckScene.tsx` — are React style objects, which React applies through the CSSOM as
  well;
- `index.html` contains no literal `style=`, and nothing in the tree uses
  `dangerouslySetInnerHTML`, `innerHTML` or `setAttribute('style', …)`.

*At the time of this audit*, the label overlay named in the old rationale was mounted **only in the
scene**, never on the shipped shell route, and the route the experiment below was run against was
`?harness=2b`. Both facts have since changed and the Resolution below turns on it: Phase 3 folded
Phase 2b's harness into `EternitiesScene`, so `SceneView` now renders the overlay on the shell as
well, and review §6.1 group B retired Phase 2a's harness along with the `?harness=` vocabulary
itself — the scene-alone route is `?probe=1` and no `?harness=` spelling is a route any more.

The reviewer tested it rather than reasoning about it: with `style-src-attr` removed entirely and
the built site served under `style-src 'self'` alone, all 82 labels received their `translate3d`
transform, with zero `securitypolicyviolation` events and zero console errors on both the shell
root and the overlay route.

**Not dropped in Phase 5, on purpose.** Phase 3 (DEC-590) was mid-flight and would add the card
tier — the one part of the product not exercised by that experiment. Removing a directive on the
strength of routes that do not yet include the largest new consumer is how a policy change gets
reverted in a hurry. The same Phase 6 pre-launch re-check as F1 and F2 owned it: once the card tier
had landed, re-run the experiment on the full shell and drop the directive if it stayed clean.

#### Resolution — 2026-09-05, Phase 6 (DEC-674)

**The precondition is met and the directive is dropped.** Phase 3's card tier has landed, and the
fold means the *shell* route now reaches both the card tier and the label overlay — so the gap in
the DEC-632 experiment (an overlay route that was not the shipped one) is closed by the product's
own shape rather than argued around.

Re-run on the built site under the new header, real Chrome, production dataset
(`d5ee9661aaffafa3`), ANGLE Metal on an M5 Pro:

- `node scripts/verify-browser.mjs --dataset production` (the script DEC-708 later archived under
  the `review-tooling-2026-09` tag; this is the record of the Phase 6 run) — **green, zero
  `securitypolicyviolation` events and zero console errors**, walking PRD section 6 end to end in
  the shell: the multiverse, a plane, the thumbnail sheet, a focused card with 72 planets, the
  planet hover and pick path, a double-faced flip, `Esc` back out, and Phase 2a's harness. That
  walk covers every route the old experiment could not.

An experiment that only reports "nothing broke" cannot tell a tightened policy from an unenforced
one, so the drop was also **A/B'd against the header it replaces**, rewriting the response header by
request interception and injecting the shape the directive governs — a literal `style` attribute:

| header served | injected `style="…"` | `securitypolicyviolation` | CSSOM write |
|---|---|---|---|
| **what ships now** (`style-src 'self'`, no `style-src-attr`) | **refused** | `style-src-attr <- inline` | applied |
| old (`style-src-attr 'unsafe-inline'`) | applied | none | applied |

So the removal is a real tightening, not a no-op: `style-src 'self'` now governs attributes as well
as elements, and an injected `style="…"` is refused where it previously was not. The app's own
inline styling is untouched, because all of it is CSSOM — the control column, which stays `applied`
under both headers, is what proves the two are different mechanisms rather than the probe being
inert.

`e2e/a11y.spec.ts` 9f asserts `style-src-attr` is **absent**, so re-adding the relaxation has to
argue with a failing check rather than sliding back in. DEC-708 moved that assertion here from
`verify-browser.mjs` and proved it bites: with `'style-src-attr': ["'unsafe-inline'"]` put back
into `security-headers.mjs`, 9f fails on "style-src-attr came back".

Note that this is not a regression. The policy as it ships is a **strict improvement** on the old
`style-src 'self' 'unsafe-inline'`, which permitted injected `<style>` elements. F5 is the
observation that the tightening did not go as far as it could have, not that it went too far.

## Related PRD 7.6 clauses

- **7.6.2, external links open with `rel="noopener noreferrer"`.** Two external links exist, both
  in the new About view. `test/design.test.ts` asserts the attribute on every anchor in that file
  and `e2e/a11y.spec.ts` 9d re-reads it from the rendered DOM.
- **7.6.3, no user-supplied content rendered as HTML.** Unchanged this phase. Search input reaches
  only the in-memory index; nothing in the shell writes `innerHTML`.
