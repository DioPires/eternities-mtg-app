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
  | { kind: 'card'; planeSlug: PlaneSlug; oracleId: OracleId; starIndex?: number }
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
  able to start without it, which is exactly why PRD 6.7.1 puts the slug in the URL.

`levelOf(focus)` gives the camera-distance band. PRD 5.1.3: levels are distances, not views.

## 2. Flights

Every fly-to returns a `Flight`: an id, the target, a `done` promise and `cancel()`. Awaiting is
optional — the UI usually fires and forgets, and the router reacts to `focuschange`.

Four invariants an implementation must hold. They are the contract's real content:

1. **A new fly-to supersedes the one in flight.** The old `done` resolves `'superseded'`. There is
   never more than one flight.
2. **`focus` updates synchronously at the *start* of a flight**, not on arrival. PRD 6.7.1 makes the
   URL the source of truth, so the breadcrumb, the router and the panels must never be a frame
   behind the camera.
3. **A cancelled flight leaves `focus` at the target.** PRD 5.7.3 hands control over at the current
   camera state without a jump; it does not undo the navigation. The user asked to go to Kaldheim
   and then grabbed the camera — they are on Kaldheim, flying manually.
4. **Attract mode exits on any input and never changes the route** (PRD 5.3.23).

Durations come from the scene, not the caller: PRD 5.7.3's 1.2 s one-level hop scaled with distance
to a 3 s cap, PRD 6.2.3's 3.5 s cap on the combined two-stage card fly-to, PRD 6.8.2's 4 s intro,
and PRD 5.9's 0.3 s under reduced motion. `FlyOptions.durationMs` overrides it, `immediate` skips
the tween — that one is for deep links that must not animate.

## 3. The methods

| Method | PRD | Note |
|---|---|---|
| `flyToMultiverse` | 6.3.1, 6.1.3 | Breadcrumb root, and Esc from a plane. |
| `flyToPlane(slug)` | 5.7.2 | Delegates to `flyToBlindEternities` for that slug, so a caller never has to special-case it. |
| `flyToBlindEternities(anchor?)` | 5.3.4 | Re-anchoring **while already focused** emits `anchorchange` and returns a resolved flight — no route change, no history entry. |
| `flyToCard({ planeSlug, oracleId, starIndex? })` | 6.2.3–4 | The scene decides one stage or two, from where the camera is. The caller never picks. |
| `focusParent()` | 6.1.3 | Card → plane → multiverse. Returns `null` at multiverse level, which is how Esc knows to do nothing. |
| `playIntro(target)` | 6.8.2 | Once per session; a second call is a resolved no-op that does not move focus. |
| `enterAttract` / `exitAttract(cause)` | 5.3.22–23 | The idle timer is the UI's (PRD 5.3.22's 45 s); the drift is the camera's. |
| `setReducedMotion(enabled)` | 5.9, 6.10.1 | The OS preference and the settings toggle both land here. |
| `handOver(cause)` | 5.7.3, 6.1 | What the input layer calls the moment the user touches the camera. Cancels the flight *and* exits attract mode. |

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

`web/test/navigation.test.ts` pins all four invariants of §2 plus every PRD rule in §3. Phase 2b's
implementation should pass the same suite against the real rig — that is the acceptance test for
the swap.

## 6. Deliberately out of scope

- **Orbit and zoom** (PRD 6.1.1). Direct manipulation is the camera rig's own input handling; the
  UI's only involvement is `handOver`.
- **Picking** (PRD 8.5.6). Hover and click ids come from the scene's picking layer, not from here.
  The UI receives an id and calls `flyToCard`.
- **The 45 s idle timer** (PRD 5.3.22). The UI owns it and calls `enterAttract`, because it is the
  UI that knows what counts as input across the HUD, the panels and the search box.
- **History** (PRD 6.2.2). `history.pushState` is the router's, driven by `focuschange`. The
  navigation API never touches the URL.
