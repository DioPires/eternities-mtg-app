# Decision: concept B (worlds) and stack a′ (de-React the render loop)

**Decision: the presentation concept is B — worlds — and the stack end-state is a′: remove
`@react-three/fiber` and `@react-three/drei` from the render path, own the frame loop and the post
chain in imperative TypeScript, and upgrade to three r185 and Vite 8.** The owner made both choices
on 2026-09-14 at the W2.3 decision gate (DEC-690 interaction `70b32d1a`), after judging the DEC-694
prototype captures. This closes review REVIEW-2026-09-08 §4.3 (concept) and §3.5/§3.6 (stack).

Recorded 2026-09-14. The choices were posed and answered independently, per the gate.

## What was decided

1. **Concept B — worlds** (review §4.2). Planes become globes tiled with their cards' art: radius
   ∝ √N, latitude = colour, longitude = time, the 57 empty planes as dark moons, the Blind
   Eternities as a belt with one arc per set, printings as a flat ring of `small` cards. The
   DEC-694 prototype (branch `dec694-worlds-prototype`, commit `8c5fa25`) is the evidence base:
   Dominaria r 9.97 / 6,266 cells vs Rabiah r 1.09 / 75 on the production dataset.
2. **Stack a′ — de-React the loop** (review §3.6 phases 2–4, ~12 remaining engineer-days). Phase 1
   (own the post chain in-app) already landed as W2.1 / PR #42. React keeps the HUD, overlays and
   the `<canvas>` host; a `SceneRenderer` owns the canvas, the `WebGLRenderer`, one
   `requestAnimationFrame` and the pass order.

## Consequences

- **Wave 4 is cut** as DEC-690 child issues: the §3.6 phase 2 platform layer, the phase 3
  de-React, the phase 4 modernise + re-measure, and a worlds production spec that turns the
  prototype into an implementation plan (pipeline and renderer).
- **§3.6 phase 2 loses one item to concept B:** "instanced planets + texture array" rebuilt the 72
  printing spheres; under B printings are a flat ring, so that work is superseded and moves into
  the worlds implementation rather than the platform leg.
- **Review tooling group C (§6.1):** `visual-gate.mjs` stays maintained tooling — the galaxy is
  what production ships until the worlds cutover — and is archived under a tag at cutover. T7
  (§5.5, a render-side legibility measure for the gate) is required only while concept A stands,
  so it is retired at cutover, not built.
- **Data contract (§4.5):** `stars.bin` keeps its bytes but changes semantics (unit-sphere point
  per card; belt positions for dust); shards add an `artist` field (Scryfall compliance for art
  crops shown without the full card, §4.4); new `swatches.bin` (~230 KB, 8-byte RGB565 swatch per
  card). An artist field is a contract-version bump.
- **§10 Q3 (art distortion) resolves itself:** flat printings and flat tangent cells show art
  undistorted; the sphere-wrapped planet shader retires with the galaxy's card level.

## What this does not decide

- **Hardware validation is still owed.** The prototype was judged on the Mac; the Iris Xe / 780M
  cost class (A far / B near) stays an estimate until the owner runs the W0.1 kit and returns the
  field reports. Wave 4 phase 4 re-measures against whatever Wave 0 baseline exists by then.
- **Cutover timing.** The galaxy ships until the worlds implementation passes its own acceptance
  gate; dataset refreshes in the interim still run `visual-gate.mjs` per `docs/refresh-runbook.md`.
