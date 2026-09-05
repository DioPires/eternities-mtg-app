# Eternities — camera, navigation and labels (Phase 2b)

**Authority:** PRD `prd_v3.md` §5.7, §5.3.4, §5.3.8–12, §5.3.22–23, §5.4.5, §5.4.15, §5.9, §6.1–6.2,
§6.8.2, §7.3, §8.5.3, §8.5.7, §8.7, §9.1.3; `implementation-plan.md` Phase 2b and amendment A1.

This is the design note for the camera rig, so the reviewer does not have to reconstruct it from the
code. The contract it implements is `docs/navigation-contract.md`; this is how.

| Piece | Path |
|---|---|
| Vector arithmetic, easing, exact integrators | `web/src/camera/vec.ts` |
| CPU mirror of the scene's motion (PRD 8.5.3, 8.5.7) | `web/src/camera/motion.ts` |
| Tethers, per-level limits, path clearance (PRD 5.7.1, 5.7.5) | `web/src/camera/framing.ts` |
| The rig: orbit, fly-to, hand-over | `web/src/camera/rig.ts` |
| Attract mode (PRD 5.3.22–23) | `web/src/camera/attract.ts` |
| R3F and pointer wiring | `web/src/camera/CameraRigController.tsx` |
| Label collision solver (PRD 5.3.8–12, 5.4.5) | `web/src/labels/layout.ts` |
| CPU projection (PRD 8.4.4) | `web/src/labels/project.ts` |
| The overlay | `web/src/labels/PlaneLabels.tsx` |
| Plane detail in a worker (PRD 8.7.6, A1) | `web/src/plane-detail/` |

---

## 1. One parameterisation

The camera is a **live tether point** plus `(azimuth, polar, distance)`. Orbit drives those three
numbers from input; the fly-to drives them from an eased path. Everything else follows from that
choice, and it is what makes PRD 5.7.3's hand-over exact rather than approximate.

A tether is a point **in a plane's local frame**, not a world point. That is PRD 5.7.4 — "fly-to
targets are computed in the destination's rotating local frame, so a spinning plane or card is
framed correctly on arrival" — and holding it that way means a flight that takes 3 s while the plane
turns still arrives on the same side of the spiral. The multiverse's frame is the world frame, on
purpose: co-rotating the home view with PRD 5.3.13's 20-minute turn would hide the rotation that
view exists to show.

The Blind Eternities needs no special case. PRD 8.3 gives it a normal plane row with the identity
transform and radius `R`, so a dust anchor (PRD 5.3.4) is a point in *that* row's local frame — and
it follows the multiverse rotation for free instead of sliding out from under the camera.

## 2. Hand-over (PRD 5.7.3, 7.3.6)

"Any input cancels the fly-to and hands over control at the current camera state without a jump",
and PRD 7.3.6 sharpens it: continuous in position **and velocity**. The rig does not stop the tween
and hope. It:

1. differentiates the tween analytically at the current instant — `easeInOutSlope`, not a
   frame-difference, which would be one frame stale and, at 30 fps, visibly so;
2. rebases onto the destination tether, deriving `(azimuth, polar, distance)` *from* the camera's
   current world position, so the position is bit-identical either side of the hand-over;
3. projects that velocity onto the orthonormal spherical basis at the rebased pose, and hands the
   three rates to the orbit's inertia.

`web/test/camera.test.ts` asserts both halves: the position moves by less than 1e-9, and the world
velocity one frame later matches the un-handed-over flight to within 5%.

The same three steps are how attract mode gives control back (PRD 5.3.23) and how a re-anchor of the
dust works (PRD 5.3.4) — one mechanism, three requirements.

**Distance limits are a force, not a correction.** A hand-over can leave the camera 140 units from a
tether whose limit is 63. Moving it back, however smoothly damped, puts a step in its velocity on
the exact frame that has to be continuous. So the error feeds `distanceRate` as a spring, overdamped
against the orbit's own damping so it never bounces. It is a slow return, not a snap: from 258 units
outside a 60-unit limit the camera is within 5% of the limit after 5.5 s and 0.1% after 10 s, and it
approaches asymptotically. Zoom *input* is still clamped hard, because PRD 6.1.1 says zoom is
"within the focus's distance limits".

**Attract mode re-tethers on the way out.** The hand-over rebases onto the leg the rig was flying,
and an attract leg is aimed at a plane the user never chose, so `exitAttract` follows it with a
`rebaseTo` onto the focus's own tether. `rebaseTo` keeps the world position and the orbit rates and
changes only the point being orbited, so PRD 5.3.23's "without a jump" survives and PRD 5.7.1's
"always tethered to a focus" holds after an attract exit as well as before one (DEC-606).

## 3. Frame-rate independence (PRD 5.3.17, 9.1.3)

Everything except two accumulated angles is a pure function of elapsed time. The accumulators — the
multiverse rotation and each plane's spin — exist because PRD 8.5.3 needs a focused plane to ease
its spin to a stop, which a closed-form `rate · t` cannot express; at a constant rate their sum is
exact.

The two places the lazy spelling would have failed:

- **Inertia.** `angle += rate · dt; rate *= decay` is a Riemann sum and depends on the frame rate.
  `decayIntegral` is the exact integral of `∫ r·e^(-λs) ds` instead.
- **Limit relaxation**, for the same reason. Because the limit is applied as a force and not as a
  position correction, `(distance, distanceRate)` is a damped oscillator rather than a first-order
  relaxation, so a first-order `approach` — the closed form of `ẋ = -λ(x - t)`, which earlier drafts
  of this note claimed was used here — is the wrong shape for it, and putting the correction in the
  position is the velocity step the paragraph above exists to avoid. `advanceDistance` solves the
  second-order `ẍ + λẋ + kx = 0` instead, from its two real roots, and splits
  the frame at the instant the camera crosses a limit so the regime changes at the same *time* at
  every frame rate. Stepping the acceleration per frame put 0.022 units between 30 and 120 fps
  (DEC-606).

PRD 9.1.3's check runs the motion function and the rig at 30, 60 and 120 fps for a fixed elapsed
time and compares positions to nine decimal places — six for the rig, whose flights and springs
carry float error through more arithmetic. `web/test/camera.test.ts` runs it over a plain flight and
over a path where the limit spring is engaged throughout.

## 4. Paths that arc (PRD 5.7.5)

"The camera never intersects a galaxy disc, a card, or a planet; approach paths arc around
geometry." Two mechanisms, in order of preference:

1. **A clearance bulge, computed once per flight.** The eased distance-from-tether gets a
   `sin(π·u)` hump sized so the whole path clears every plane's exclusion sphere (`1.3 × radius` —
   the disc plus the margin PRD 5.3.3 already reserves for drift). Sampled over the whole roster's spheres × 12
   points at flight start; nothing per frame.
2. **A per-frame projection**, as the safety net. A camera inside an exclusion sphere is pushed out
   along the surface normal. It is a continuous projection of a continuously moving point, so the
   path stays smooth. While orbiting, the pose absorbs the push, or the next frame would undo it.

A tether's own plane is exempt: its `minDistance` already keeps the camera outside it, and at card
level the camera is inside that plane by definition.

## 5. Labels

`layoutLabels` is pure screen-space arithmetic. Priority is card count descending, ties
alphabetical (PRD 5.3.10) — which is also what keeps the layout stable frame to frame instead of
flickering between two equal-count planes. A collision pushes the lower-priority label out along the
shallowest separating axis, up to three times, then fades it. Occlusion by a nearer plane dims to
40% (PRD 5.3.11). Chronology-band set labels (PRD 5.4.5) share the solver at lower priority and
appear only above 120 px of band width, so they can never displace a plane name.

Two constraints shaped the implementation:

- **PRD 7.3.2 forbids per-frame allocation.** The solver writes into caller-owned records and
  returns a count; the overlay reuses one candidate record per plane forever.
- **PRD 7.3.3 forbids layout-triggering style changes**, which rules out measuring real DOM boxes.
  Widths are estimated from the text and font size, deliberately one-sidedly: over-estimating
  separates labels that would have just fitted, which is invisible, while under-estimating leaves
  the overlap PRD 9.3 is judged on.

React renders one `<div>` per plane once and never re-renders; every frame writes `transform` and
`opacity` through refs, both of which are composited. `fontSize` is the one style here that
invalidates layout, and it tracks the plane's on-screen radius, so it changes on nearly every moving
frame: the overlay keeps the last value it wrote per node and skips the write when it has not
changed, which is what makes PRD 7.3.3's "no layout-triggering style changes per frame" true rather
than nearly true (DEC-606). The layer lives outside the canvas, per PRD 8.4.4.

`web/test/labels.test.ts` runs the home view of all 82 named planes and asserts no two visible
labels overlap — PRD 9.3's one criterion stated as a rule rather than a judgement.

## 6. Plane detail off the main thread (PRD 8.7.6, amendment A1)

Requested the moment a plane becomes focus, so it arrives during the ≥ 1.2 s fly-to. Fetched *and
parsed* in a worker, because `JSON.parse` on a multi-megabyte Blind Eternities shard is tens of
milliseconds of blocked main thread in the middle of a transition PRD 7.2 budgets at 16.7 ms p95.

Shard by shard and in order, so the first cards are usable while the rest are still coming and a
plane the user leaves after half a second has not queued four megabytes it will never read. A new
focus supersedes: the worker gets a `cancel` and aborts the fetch. A failed shard is one
non-blocking error (PRD 7.4.1) and the rest of the plane still arrives.

The retry policy is not reimplemented — it is the data contract's `loadPlaneShard`, unchanged. The
worker adds a thread, not a second implementation, which is also why the whole thing runs inline
where `Worker` is unavailable.

## 7. What is deliberately not here

- **The star renderer, the dust, bloom, picking** — Phase 2a (DEC-587). `web/src/harness/` holds a
  plane-glow placeholder and a screen-space plane pick so that Phase 2b could be built and reviewed
  against the real roster in parallel; both are deleted when 2a lands, and neither carries a
  requirement.
- **The HUD, router, search, panels, the 45 s attract timer** — Phase 4 (DEC-589). The harness binds
  three keys to fly the camera and shows a status panel, and nothing more.
- **The card object and planets** — Phase 3. Card-level framing exists (a tether, limits, a
  two-stage fly-to that lands on it); what it frames is a point in space until Phase 3 puts a card
  there.
