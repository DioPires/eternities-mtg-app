# Eternities — app shell (Phase 4)

**Status:** built against the Phase 0 navigation stub. Camera-dependent flows are wired through the
contract and become real when Phase 2b (DEC-588) swaps the implementation in.
**Authority:** `prd_v3.md` §6 in full, plus §7.1.2, §7.4.1, §7.5, §7.6.2, §8.4.
**Not this document's business:** the visual design, which is Phase 5's (implementation plan §2).

This is a map of the shell, the seams the other phases plug into, and the four places where the
implementation had to make a call the PRD did not spell out. Read the last section before
reviewing: those are the decisions worth arguing with.

---

## 1. Where the state lives

PRD 8.4.2 draws the line and the code follows it exactly:

| State | Home | Why |
|---|---|---|
| Focus, filters | **the URL** (`src/router/`) | PRD 6.7: the URL is the source of truth. Never stored twice. |
| Hover id, active printing, panel/overlay, attract, quality tier, settings, toasts, loaded artefacts | **Zustand** (`src/store/store.ts`) | PRD 8.4.2's list of transient view state. |
| Camera, flight, level, reduced motion, intro-played | **the navigation API** (`src/navigation/`) | The frozen Phase 0 contract. |

There is no `focus` and no `filters` slot in the store, and that omission is the enforcement. A
mirror can disagree with the address bar, and then a shared link ships a view the sharer never saw.

`useRoute()` is a `useSyncExternalStore` over `location`, memoised on `path + search`, so a
component that reads filters is reading the address bar, not a copy of it.

## 2. The files

```
src/router/route.ts      URL grammar: parse/format routes and filter params. Pure.
src/router/router.ts     history.pushState / replaceState / popstate, behind a `RouterHost`.
src/router/binding.ts    The two-way binding between the URL and the navigation contract.
src/filters/types.ts     PRD 6.6's vocabulary and its mapping onto star-record fields.
src/filters/evaluate.ts  One pass producing the dimming mask *and* the exact count.
src/search/fuzzy.ts      Prefix-favouring scorer + banded Damerau-Levenshtein.
src/search/index.ts      The index over search.json, and PRD 6.5.3's grouping.
src/store/store.ts       PRD 8.4.2's transient view state.
src/store/settings.ts    PRD 6.10's settings, persisted to localStorage.
src/app/services.tsx     The nav API, the nav snapshot store, and the router. Created once.
src/app/dataset.ts       PRD 8.7's loading order. Reports failures once (PRD 7.4.1).
src/app/boot.ts          Cold start: bind, canonicalise, intro, deep-link resolution.
src/app/cardDetail.ts    Plane shard fetch and the card row inside it.
src/app/hooks.ts         Filters, card detail, keyboard map, attract idle, share, random.
src/app/random.ts        PRD 6.9's weighted pick. Pure, injectable RNG.
src/ui/*.tsx             HUD, drawer, panels, overlays, hint, toasts, WebGL2 fallback.
```

Everything with real logic is pure and tested under Node: `web/test/route.test.ts`,
`router.test.ts`, `filters.test.ts`, `search.test.ts`, `shell.test.ts`. The surfaces are verified in
a real browser by `web/scripts/verify-browser.mjs`, which walks PRD section 6 end to end against
both fixtures under the production CSP.

## 3. Seams for the other phases

**Phase 2b (camera, navigation, labels).** `createNavigation()` in `src/app/services.tsx` is the
one line to change. Nothing else in the shell imports `createNavigationStub`. The shell already
calls `handOver` on canvas pointer-down and wheel, triggers `playIntro`, `enterAttract`/
`exitAttract` and `setReducedMotion`, and treats `'correction'` as a `replaceState`.

**Phase 2a (star renderer).**
- The dimming mask of PRD 5.8 is `useStore.getState().filterEvaluation?.mask` — one `Uint8Array`,
  one byte per star, index = star index, reused between evaluations. That is the `filterMask`
  attribute of PRD 8.5.1.
- Loader failures should call `reportDataError(artefact, error)` from `src/app/dataset.ts` rather
  than growing a second toast path. PRD 7.4.1 wants one report per failure and the store already
  de-duplicates by message.
- `setHoverId` is the picking layer's write point; it bails on an unchanged id so a pointer move
  never re-renders the HUD.
- The adaptive-quality slot is `qualityTier` / `setQualityTier` (PRD 8.5.11). Phase 4 owns the slot
  and the settings surface only; the ladder is 2a's.
- `stars.bin` is currently streamed by `src/app/dataset.ts`. When 2a takes it over, keep writing
  `stars` and `starsDrawable` into the store: the HUD's loading line and the filter evaluation both
  read them.

**Phase 3 (card tier).** The card panel already resolves the focused card's shard and highlights
the active printing; `activePrinting` in the store is the index the planets should follow, and it
changes no route (PRD 6.2.2).

**Phase 5 (design).** One stylesheet, `src/styles.css`, tokens at the top. Three rules in it are
behavioural rather than decorative and should survive the redesign: `.hud { pointer-events: none }`
with opt-in on controls (PRD 6.3), the `touch-action`/`overscroll-behavior` pair (PRD 6.1.5), and
the `prefers-reduced-motion` block (PRD 5.9).

## 4. Decisions the PRD did not make

These four are the review surface. Each is a place where two requirements met and something had to
give.

### 4.1 Colour identity is approximated, because the star record cannot express it

PRD 6.6.2 asks for "the card's identity intersects the selected colours". PRD 6.6.5 requires colour
to evaluate **against the star record** so it is live from the first frame. But the star record
(PRD 8.3) stores a *hue class* — W, U, B, R, G, multicolour, colourless — and PRD 5.4.8 is explicit
that this is a class and not a colour set: "every multicolour card is gold … the star record stores
a class, not a colour." No loaded artefact carries a multicolour card's actual identity.

So selecting any of W/U/B/R/G admits that hue class **and** the multicolour class. An Azorius card
stays lit under a red-only filter. That over-matches, and it is the safe direction: every card whose
identity really does intersect the selection is shown, and none is hidden. The alternative — gold
never matching a single-colour selection — would hide cards PRD 6.6.2 says must match, which is the
failure a user would actually notice. `C` is exact, per PRD 6.6.2's "matches only empty identity".

**Closing the gap needs a colour-identity field in the star record**, which is a data-contract change
and not Phase 4's to make. Flagged to the board with the Phase 4 hand-back.

### 4.2 A filter change replaces, a focus change pushes

PRD 6.2.2 scopes history to focus changes: "every focus change that changes the route pushes a
history entry, so browser back behaves like Esc". PRD 6.6.6 puts filters in the URL. If a chip
toggle also pushed, back would undo a filter instead of going up a level, and the two requirements
would contradict each other.

So filter writes are `replaceState`. Filters still survive reload and sharing (PRD 6.6.6) because
they are in the URL either way, and back stays Esc.

### 4.3 A dead card link falls back to the multiverse, not to its plane

The navigation contract's `failCardResolution` **defaults** to the card's plane, and §3a argues for
it well: the URL's slug is real even when its `oracle_id` is not, and the camera is already framing
that plane after stage one. PRD risk 9 says something different — "a dead card link falls back to
the multiverse with a toast" — and the implementation plan repeats it for this phase.

The PRD is the higher authority, so `boot()` passes `{ kind: 'multiverse' }` explicitly. The
contract anticipated the disagreement by making `fallback` a parameter; nothing about it changed.
Worth a board word if the gentler behaviour is preferred — it is a one-argument change.

### 4.4 The filter picker is on the chip row, not in the control cluster

PRD 6.3.3 lists exactly six cluster controls and none of them is "filters". PRD 6.6 describes four
facets and PRD 6.3.2 describes chips that *remove* values, but nothing in the PRD says where a user
**adds** one. Putting a seventh icon in the cluster would contradict 6.3.3 as written, so the picker
opens from a button on the chip row instead, next to the chips it manages. The cluster is exactly
the six controls the PRD names, in the order it names them — the browser check asserts that.

## 5. Known gaps at hand-back

Everything below is another phase's, not deferred work of this one.

- **No camera moves.** The stub runs the full state machine and fakes only time. Breadcrumb fly-to,
  history-as-Esc, search fly-to, random and the deep-link intro all issue the right contract calls
  and update focus, the URL and the panels correctly; the picture behind them arrives with 2b.
- **Nothing is picked from the scene.** `hoverId` has no writer until 2a's id buffer lands, so
  hover-to-focus (PRD 6.1.2, 6.1.4) has no producer yet. The consumer side is in place.
- **The Blind Eternities anchor** (PRD 5.3.4) is threaded through the router, the breadcrumb and
  `focusParent` — but nothing produces a clicked-dust anchor until 2a can pick dust.
- **PRD 5.8.3** ("dimmed cards are not focusable") and **PRD 6.5.6** ("selecting a filtered-out card
  focuses it even though it is dimmed") point opposite ways. 6.5.6 is the more specific rule and the
  shell follows it: search results are filter-blind and a dimmed card focuses, with the inline
  "clear filters" the PRD asks for in the card panel. 5.8.3 governs *scene* picking, which is 2a's.
