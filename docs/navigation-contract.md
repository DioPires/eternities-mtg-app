# Eternities — navigation contract v1

**Status:** frozen at Phase 0. Any change is a reviewed contract change (implementation plan §2
Phase 0, risk 2).
**Authority:** PRD `prd_v3.md` §5.7, §6.1–6.3, §6.5.4, §6.7–6.9, §5.3.4, §5.3.22–23, §5.9.

| Piece | Path |
|---|---|
| The typed API | `web/src/navigation/types.ts` |
| No-op stub (Phase 0) | `web/src/navigation/stub.ts` |
| Demo caller (type-checks and runs) | `web/src/navigation/demo.ts` |
| Behavioural tests | `web/test/navigation.test.ts` |
| Real implementation | Phase 2b |

This is everything the UI is allowed to ask of the 3D scene. Phase 4 builds the whole app shell
against `createNavigationStub()`; Phase 2b swaps in the real rig without a single call site
changing. If that swap needs a call site to change, the contract was wrong and the change is
reviewed.

---

## 1. Focus

```ts
type Focus =
  | { kind: 'multiverse' }
  | { kind: 'plane'; slug: PlaneSlug; anchor?: Vec3 }
  | { kind: 'card'; planeSlug: PlaneSlug; oracleId: OracleId; starIndex?: number; anchor?: Vec3 }
```

Three deliberate shapes, against PRD 6.2.1's four "focus kinds":

- **The Blind Eternities is a plane, not a fourth kind.** PRD 4.7.3 puts it in the roster and
  PRD 8.3 gives it a normal plane row; the only difference is `anchor`, which PRD 5.3.4 requires
  because the dust spans the whole multiverse. `anchor` is `undefined` on every other plane, and
  `undefined` on the Blind Eternities means the multiverse centre.
- **"Card with an active printing" is not a focus.** PRD 6.2.1 says the active printing is view
  state and PRD 6.2.2 says activating one changes no route and pushes no history. It therefore
  belongs in the Zustand store (PRD 8.4.2), not in the camera's contract. Keeping it out is what
  makes `Focus` and the URL the same information.
- **`starIndex` is optional.** A deep link carries an `oracleId` and a plane slug (PRD 6.7.1); the
  star index only exists once `sets.bin` has resolved it. The first stage of the fly-to must be
  able to start without it, which is exactly why PRD 6.7.1 puts the slug in the URL. It is
  delivered afterwards by `resolveCard` (§3a), not by a second `flyToCard`.
- **A card focus carries an `anchor` too.** PRD 6.2.3 says a Blind Eternities card's first stage
  frames the dust *around the card's position*, and PRD 5.3.4 makes that position the anchor. Without
  it on the card focus there is nothing for `focusParent()` to hand back up, so Esc from a dust card
  would land on `{ kind: 'plane', slug: 'blind-eternities' }` — which *means* the multiverse centre,
  and would teleport the user across the whole multiverse against PRD 6.2.3. `undefined` on every
  other plane. On the deep-link path it arrives with `starIndex` through `resolveCard`.

`levelOf(focus)` gives the camera-distance band. PRD 5.1.3: levels are distances, not views.

**The `planeIndex` cap.** A star record's `planeIndex` is a `uint8` (data contract §5), so the
roster is capped at 256 planes. Appendix A has 83 and the encoder fails loudly rather than
truncating. Recorded here because it is a contract limit that is not otherwise written down.

## 2. Flights

Every fly-to returns a `Flight`: an id, a live `target`, a `done` promise and `cancel()`. Awaiting is
optional — the UI usually fires and forgets, and the router reacts to `focuschange`.

`FlightStatus` is `'completed' | 'cancelled' | 'superseded' | 'failed'`.

Six invariants an implementation must hold. They are the contract's real content:

1. **A new fly-to supersedes the one in flight.** The old `done` resolves `'superseded'`. There is
   never more than one flight.
2. **`focus` updates synchronously at the *start* of a flight**, not on arrival. PRD 6.7.1 makes the
   URL the source of truth, so the breadcrumb, the router and the panels must never be a frame
   behind the camera. A corollary that bit us: "already focused somewhere" is not the same as
   "settled there". `flyToBlindEternities` takes its anchor-only path only when no flight is in the
   air; re-anchoring mid-flight is a re-target, or the camera and the UI disagree about where the
   camera is going.
3. **A cancelled flight leaves `focus` at the target.** PRD 5.7.3 hands control over at the current
   camera state without a jump; it does not undo the navigation. The user asked to go to Kaldheim
   and then grabbed the camera — they are on Kaldheim, flying manually.
4. **Attract mode exits on any input and never changes the route** (PRD 5.3.23).
5. **A flight target is refined in place, never by restarting.** `resolveCard` (§3a) mutates the
   focus and the pending flight's `target`; it starts no flight and ends none. `Flight.target` is
   therefore a live view, not the value passed in — read it, do not cache it.
6. **No flight resolves `'completed'` at a focus that does not exist.** An `oracle_id` a data
   refresh dropped resolves `'failed'` at a fallback focus (§3a), never `'completed'`.

**`NavigationApi` members are function-typed properties, not methods.** That is load-bearing, not
style: method syntax tells TypeScript the implementation may depend on `this`, and callers
destructure constantly (`const { flyToPlane } = useNavigation()`, `onPointerDown={nav.handOver}`).
Written as properties, an implementation that reaches for `this` fails to type-check. Close over
your state.

Durations come from the scene, not the caller: PRD 5.7.3's 1.2 s one-level hop scaled with distance
to a 3 s cap, PRD 6.2.3's 3.5 s cap on the combined two-stage card fly-to, PRD 6.8.2's 4 s intro,
and PRD 5.9's 0.3 s under reduced motion. `FlyOptions.durationMs` overrides it, `immediate` skips
the tween — that one is for deep links that must not animate.

## 3. The methods

| Method | PRD | Note |
|---|---|---|
| `flyToMultiverse` | 6.3.1, 6.1.3 | Breadcrumb root, and Esc from a plane. |
| `flyToPlane(slug)` | 5.7.2 | Delegates to `flyToBlindEternities` for that slug, so a caller never has to special-case it. |
| `flyToBlindEternities(anchor?)` | 5.3.4 | Re-anchoring **while settled there** emits `anchorchange` and returns a resolved flight — no route change, no history entry. With a flight in the air it re-targets instead (invariant 2). |
| `flyToCard({ planeSlug, oracleId, starIndex?, anchor? })` | 6.2.3–4 | The scene decides one stage or two, from where the camera is. The caller never picks. `anchor` is the card's position when the caller already knows it. |
| `focusParent()` | 6.1.3 | Card → plane → multiverse. Returns `null` at multiverse level, which is how Esc knows to do nothing. From a **Blind Eternities card** it carries the card's `anchor` up into the plane focus (PRD 6.2.3), so Esc returns to the dust around the card. |
| `resolveCard(oracleId, resolution)` | 6.7.1 | See §3a. |
| `failCardResolution(oracleId, fallback?)` | 6.7.1, risk 9 | See §3a. |
| `playIntro(target)` | 6.8.2 | Once per session; a second call is a resolved no-op that does not move focus. |
| `enterAttract` / `exitAttract(cause)` | 5.3.22–23 | The idle timer is the UI's (PRD 5.3.22's 45 s); the drift is the camera's. |
| `setReducedMotion(enabled)` | 5.9, 6.10.1 | The OS preference and the settings toggle both land here. |
| `handOver(cause)` | 5.7.3, 6.1 | What the input layer calls the moment the user touches the camera. Cancels the flight *and* exits attract mode. |

## 3a. Resolving a card after `sets.bin` lands

The cold-start deep link is the single most important path in the product and the one where a
camera restart is most visible. It runs like this:

1. The router parses `oracleId` and a plane slug out of the URL (PRD 6.7.1).
2. It calls `flyToCard({ planeSlug, oracleId })` **immediately** — no `starIndex` yet, and the first
   stage of PRD 6.2.3 does not need one.
3. A second or so later `sets.bin` lands and `starIndexOf(oracleId)` answers.

A second `flyToCard` at step 3 would route through supersede: the first flight resolves
`'superseded'` and the camera restarts, which is the discontinuity PRD 5.7 and 7.3.6 exist to
prevent. So step 3 is not a navigation, and two methods cover its two outcomes.

```ts
resolveCard(oracleId, { starIndex, planeSlug?, anchor? }): void
failCardResolution(oracleId, fallback?): void
```

**`resolveCard`** refines the current `Focus` and the pending `Flight.target` *in place*. It starts
no flight and ends none; `snapshot().flight` keeps its id. It emits `focuschange` with reason
`'correction'` if anything actually changed, and is a no-op if the current focus is not that card —
by then the user has moved on and there is nothing to correct.

- `starIndex` is the resolved index, and the flight can refine its target mid-flight.
- `planeSlug` is **PRD 6.7.1's "the card wins and the URL is rewritten"**: set it only when the data
  put the card on a different plane from the one the deep link named.
- `anchor` is the card's resolved position, which is what anchors a Blind Eternities card (§1).

**`failCardResolution`** is the case `starIndexOf` answers `-1`: a bookmark that survived a data
refresh which dropped the card. Previously this had no expression at all, and such a flight resolved
`'completed'` at a focus that does not exist. It now settles the flight `'failed'`, drops focus to
`fallback` — defaulting to the card's plane, since the URL's slug is real even when its `oracle_id`
is not — and emits `focuschange` with reason `'correction'`. The camera stops where it is; it is
already framing the plane after stage one. PRD risk 9's toast fires on the `'failed'` result.

### `'correction'` is a `replaceState`

`NavigationReason` gains `'correction'`, and **the router must treat it as `replaceState`, never
`pushState`**. A correction rewrites the URL the user already has; it is not a place they navigated
to, and pushing it would put a dead card id in their back history. This is the one rule Phase 4
would otherwise have to guess, and it would guess `pushState`.

`'correction'` is also the reason a re-issued but unchanged focus carries, which is how PRD 6.8.2's
deferred second stage stays expressible: `playIntro(cardFocus)` ends framing the card's *plane*, and
the caller follows with `flyToCard` for the same card once `search.json` resolves. That second
`focuschange` names the focus the URL already holds, so the router dedupes it rather than
double-pushing history.

## 4. Events

`focuschange`, `flightstart`, `flightend`, `handover`, `attractenter`, `attractexit`,
`anchorchange` — all typed by `NavigationEvents`, all subscribed with `on()` which returns an
unsubscribe. `subscribe()` additionally gives whole-snapshot updates, which is what a Zustand
bridge wants.

`handover` carries a `CameraState` so the UI can stop showing a "flying" affordance and, later,
so Phase 4 can persist camera state if it ever needs to. It is intentionally a plain `{position,
target, distance}` — the UI never imports three.js.

## 5. What the stub does and does not do

It moves no camera. It **does** run the full state machine: focus transitions, flight lifecycle,
supersede, hand-over, attract, reduced motion, intro-once, and every event. That is deliberate —
a stub that only returns `undefined` would let Phase 4 build something that cannot work, and the
integration cost would land at the worst moment.

The one thing it fakes is time: `durationMs` is honoured with `setTimeout`. `StubOptions.instant`
collapses the stub's own timings so tests never wait, while an *explicit* `durationMs` is still
honoured, so hand-over and supersede stay exercisable.

`web/test/navigation.test.ts` pins all six invariants of §2 plus every PRD rule in §3 and §3a.
Phase 2b's implementation should pass the same suite against the real rig — that is the acceptance
test for the swap. It also pins that every method survives being pulled off the object, which is a
requirement of the contract (§2) and not just of the stub.

## 6. Deliberately out of scope

- **Orbit and zoom** (PRD 6.1.1). Direct manipulation is the camera rig's own input handling; the
  UI's only involvement is `handOver`.
- **Picking** (PRD 8.5.6). Hover and click ids come from the scene's picking layer, not from here.
  The UI receives an id and calls `flyToCard`.
- **The 45 s idle timer** (PRD 5.3.22). The UI owns it and calls `enterAttract`, because it is the
  UI that knows what counts as input across the HUD, the panels and the search box.
- **History** (PRD 6.2.2). `history.pushState` is the router's, driven by `focuschange`. The
  navigation API never touches the URL. The one rule the API does impose: reason `'correction'`
  is a `replaceState` (§3a).

## 7. Known open question, for Phase 2b

**Manual zoom after hand-over does not move `focus`.** PRD 5.1.3 makes levels distances, and
invariant 3 makes `focus` sticky through a hand-over. So a user who hands over at a card and then
manually zooms out to multiverse distance still has a card focus and a card URL. No invariant covers
it and no method expresses it, because deciding it needs the real rig: the answer is either "focus
is sticky until the next explicit navigation, and the breadcrumb is what the user clicks to change
it" or "the rig emits a distance-driven `focuschange`", and the second needs hysteresis thresholds
that only exist once the camera does. Phase 2b (DEC-588) owns the decision. If it lands as
distance-driven, the event already exists and only §2 changes; that is why this is a question and
not a contract gap.
