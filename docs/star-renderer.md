# The star renderer (Phase 2a)

**Authority:** PRD 8.5.1–7 and 8.5.11 (rendering), 5.3 (multiverse level), 5.4 (plane level), 5.8
(filter dimming), 5.9 (reduced motion), 7.2–7.4 (budgets, smoothness, reliability), 8.7 (loading
order). Where this document and the PRD disagree, the PRD wins.

Phase 2a builds the star field and nothing else moves the camera. PRD 5.7's tethered orbit, the
fly-to tween and the input hand-over are Phase 2b's, behind the navigation contract frozen in Phase
0; the scene here exposes what a camera rig needs and stops there.

## 1. One object, one draw call

Every star in the multiverse — including the Blind Eternities dust — is one vertex of one
`Points` object with one `ShaderMaterial` (PRD 8.5.1). There is no per-plane object, no instancing
and no CPU-side transform. Two GPU buffers back it:

| Buffer | Contents | Notes |
|---|---|---|
| records | `stars.bin` byte for byte, stride 12 | `aClass` (plane, hue, rarity) and `aStyle` (brightness, twinkle phase, type mask) are interleaved views at offsets 6 and 9. Nothing is repacked. |
| positions | 3 × float16, or float32 on the fallback path | The one thing that *is* repacked: a vertex attribute must be one GL type, and the record interleaves halves with bytes. |

Both are allocated at the manifest's star count when `planes.json` lands and filled in as chunks
arrive, so a chunk never reallocates. See `web/src/scene/starfield/starGeometry.ts`.

**Float32 fallback** (PRD risk 6). `?positions=float32` — or the same value in local storage —
switches the position buffer to `Float32Array`. Same code path, different destination array.
`pnpm bench --positions float32` benches it; Phase 6's cross-browser pass exercises it.

## 2. Motion is a function, written twice

PRD 8.5.3 puts motion in the vertex shader; PRD 8.5.7 needs exactly one star's position on the CPU
for the camera tether. So the motion function exists twice, and the two must agree.

The order, both sides: **rotate** about the plane's axis by the accumulated spin angle plus the
bounded shear of PRD 5.4.13 → **tilt** by the plane's quaternion → **scale** to the plane's radius
→ **drift** (PRD 5.3.15) → **translate** to the plane's home → **multiverse rotation** (PRD 5.3.13).

Three things keep the two copies honest:

1. `web/src/scene/starfield/motion.ts` holds the plane-table row layout, and the shader reads the
   same offsets through generated `#define`s. A layout edit that forgets one throws at module load.
2. Every constant lives in `web/src/scene/tuning.ts` and is injected into the GLSL. There is no
   second copy of a number.
3. The dust turbulence hashes with 32-bit integer arithmetic — `Math.imul` on one side, `uint` on
   the other — so the lattice values are bit-identical. A `fract(sin(…))` hash would diverge between
   float64 and float32 by more than the turbulence amplitude, and the camera would tether to a point
   the dust card is not at.

**The shear is bounded by construction.** It is `A·sin(2πt/T + φ + r·k)`, a sine and never an
accumulator, so however long the session runs the arms cannot wind up — which is exactly what PRD
5.4.13 forbids differential rotation to prevent.

## 3. The per-plane data texture

PRD 8.5.2: one row of an `RGBA32F` `DataTexture` per plane, six texels wide.

```
texel 0  home.x   home.y   home.z    radius
texel 1  tilt.x   tilt.y   tilt.z    tilt.w
texel 2  driftAmp driftVel driftPhase spinAngle     <- spinAngle accumulates on the CPU
texel 3  shearAmp shearVel shearPhase kind
texel 4  fade     focusBoost glowRadius glowOpacity
texel 5  tint.r   tint.g   tint.b    (spare)
```

Read with `texelFetch`, so there is no filtering and no half-texel arithmetic to get wrong.

The whole per-frame CPU cost of the field's motion is this table: ~83 angle integrations and two
easings into a preallocated array, uploaded in one call (PRD 8.5.3's "~80 floats per frame").

## 4. Loading, fading, failing

PRD 8.7's order, in `web/src/scene/useSceneData.ts`:

1. the shell renders the sky and the parallax background — no data involved;
2. `manifest.json` and `planes.json`; the scene is built and zero-card planes appear at once;
3. `stars.bin` streams, the draw range grows, and each plane fades in as its own slice completes;
4. `search.json` and `sets.bin` after the first frame.

Records are plane-ordered and `planes.json` carries `starOffset`/`starCount`, so "this plane is
complete" is a comparison against a moving cursor, not a scan. A partially arrived plane is inside
the draw range at fade 0 — invisible until every one of its stars has landed.

**Failure** (PRD 7.4.1): Phase 0's loader retries three times with exponential backoff. After that
the scene emits exactly one event per artefact through `web/src/scene/errors.ts` and keeps
rendering. Phase 4 subscribes and shows the toast. A missing `search.json` costs the set facet, not
the multiverse.

## 5. Picking

PRD 8.5.6 is two mechanisms and a precedence rule, and the rule is what makes them one gesture:
click anywhere on a plane and you get the plane, unless you clicked a star.

- **Stars, thumbnails and planets: the id buffer.** A second pass renders ids as colour, using the
  *same vertex shader* with `ID_PASS` defined — which is why it is exact. The sub-window comes from
  `camera.setViewOffset` and an 11×11 render target rather than a full-size target plus a scissor:
  identical projection, 484 bytes of readback instead of 8 MB of VRAM.
- **Planes: a CPU sphere raycast** against ~83 bounding spheres whose centres come from the same
  motion mirror. Allocation-free; it runs on pointer move.

The readback is `readRenderTargetPixelsAsync`, and the renderer, camera and scene state are restored
**before** awaiting the fence. `readPixels` into the pixel buffer happens synchronously, so the
pixels are already captured; awaiting first would leave the camera on the pick layer and the scene
without its sky for however many frames the fence takes, and the frame loop renders during those.

**What is clickable is deliberately not what is drawn.** The draw pass rounds a star to a disc; the
id pass leaves its sprite square. Below about 2 px a round sprite's `discard` can reject every
covered pixel and the star becomes unclickable altogether, so the id pass keeps the corners — which
strictly enlarges a target PRD 8.5.6 already inflates on purpose. The cost, stated rather than left
to be discovered: at the 7 px production floor the corner reach goes from 3.5 px to ~4.95 px, so a
click on visibly empty sky up to ~1.5 px diagonally past a small star's disc selects the star instead
of falling through to its plane. That is the right trade for keeping a one-pixel star reachable, but
it is a real divergence and it lives in `ID_PASS`.

Because the fence resolves a frame or two later, a pick can be in flight when the next one is asked
for, and **"busy" is not "miss"** — `PICK_BUSY`, not `-1`. Conflating them cost clicks: a hover pick
runs on every frame the pointer moved, so a click made while the pointer was still moving fell
through to the plane raycast and selected the star's *plane*. Hover calls `pick`, which returns
`PICK_BUSY` rather than waiting, because it has a next frame to retry on. A click calls `pickQueued`,
which takes a turn in the queue and always gets a real answer, because it does not. `resolvePick`
holds the precedence rule and takes the plane raycast as a thunk, so a busy pick structurally cannot
reach it.

## 6. Adaptive quality

PRD 8.5.11's ladder, in `web/src/scene/quality/adaptiveQuality.ts`:

| Tier | Pixel ratio cap | Bloom scale | Thumbnail capacity |
|---|---|---|---|
| full | 1.5 | 0.5 | 512 |
| pixel-ratio | 1.0 | 0.5 | 512 |
| bloom | 1.0 | 0.25 | 512 |
| thumbnails | 1.0 | 0.25 | 256 |

Phase 2a implements the monitor and the first two steps; the thumbnail step is Phase 3's to consume
and the store slot is Phase 4's (PRD 8.4.2). Decisions come from a p90 over a window, not from
single frames; stepping up needs a longer, calmer window than stepping down; every change starts a
cooldown. **Nothing in the ladder can reach the star count, the draw range or the motion** — PRD
8.5.11's "geometry and motion are never degraded" is structural, not a promise.

## 7. Verifying it

```
pnpm test                       # the arithmetic: motion, plane table, geometry, quality, errors
pnpm verify-browser --dataset all
pnpm bench --dataset scale --uncapped --shots ../shots
```

`verify-browser` runs on the machine's **real GPU** — the same launch flags as `bench` — and fails
if Chrome falls back to SwiftShader. That matters because the check below is cited as the mitigation
for driver variance, and a software rasteriser cannot answer for a driver. `--allow-software`
downgrades it to a warning, for a box with no GPU at all.

It runs the **GPU self-check** (`web/src/scene/selfCheck.ts`, `?selfcheck=1`), the only way to test
the one claim that cannot be tested without a GPU: that the CPU motion mirror agrees with the vertex
shader. It takes a star, computes its world position on the CPU, projects it to a pixel, renders the
pick window there, and finds *that same star* in the window — the CPU on one side, the GPU on the
other, nothing in between. It deliberately does not ask what is nearest the pixel: that is the
answer to a click, and scoring it means comparing one mirrored position against another, which
cancels any error the two stars share. The mirror is per plane row, so sharing is exactly what a
real bug in it looks like.

The check picks at a 2 px sprite rather than the production 7 px (`SELF_CHECK_PICK_MIN_PX`), because
an inflated sprite is 7 px of some *nearer* star covering the one being measured. Stars it cannot
locate at all are counted as `unmeasured` rather than judged, and the run must locate a floor of 16
before its verdict counts, so it cannot pass vacuously.

`unmeasured` has two causes and they are indistinguishable from a single sample: a nearer sprite
covered the star inside a galaxy core, or the mirror put it more than half a pick window out and it
is not in its own window at all. The second is the failure the check exists for, and it used to
escape through this gap — the search window is 11 px, so **sensitivity is not monotone in the size
of the error**. Injecting a uniform offset into the dust row of `fixture-small` and growing it:

| injected into row 0 | mean | max | unmeasured rows | verdict |
| --- | --- | --- | --- | --- |
| none | 0.29 px | 1.0 | `4x8 3x7 1x1` | pass |
| `py += 2` | 1.65 px | 5.1 | `4x8 3x7 0x1 1x1` | **fail** — mean, and one star past tolerance |
| `py += 3` | 0.47 px | 1.41 | `0x15` `3x7 4x7` | **fail** — row 0 dark |
| `py += 4` | 0.47 px | 1.0 | `0x15` `3x7 4x7 1x1` | **fail** — row 0 dark |
| `py += 6` | 0.44 px | 1.41 | `0x15` `3x7 4x7` | **fail** — row 0 dark |

Before the dark-row rule, the last three passed — with a *better* mean than the clean run, because
all 15 dust samples left their windows at once and were dropped from the average. So the third
clause: no plane row sampled at least 10 times may come back 90% unlocatable. What separates the two
causes is not the sample but the distribution. Occlusion is a property of one star's neighbourhood
and strikes scattered stars; the mirror is written per plane row, so an error in it moves the whole
row together. The floor of 10 is measured, not chosen — on `fixture-scale` 37 of 64 samples are
occluded, and at that base rate rows drawing four or five samples come back *entirely* dark in a
clean run (rows 47 and 43 do). Judged rows sit at 0.0–0.41 clean against 1.0 injected.

Measured on Metal, both fixtures: worst disagreement **1.0–1.41 px**, mean 0.21 px on
`fixture-scale` and 0.29–0.33 px on `fixture-small`, against a 3 px tolerance. So what the check
buys, stated to match what it actually asserts:

- no star it located was drawn 3 px or more from where the mirror puts it;
- no systematic drift above about 1.5 px mean across everything it located;
- no well-sampled plane row that still projects on screen was displaced far enough to vanish from
  its own pick windows.

And what it still does not buy. **This list is what is known, not a claim that it is complete** —
every entry on it was found by injecting a larger error than the round before had thought to try,
and that is the only method that has found any of them.

*A row too thinly sampled to judge can be displaced without failing.* Sixty-four samples over
`fixture-scale`'s 83 planes leave most rows with one sample, and row 0 is the only one there that
clears the floor — that is the Blind Eternities dust, the row PRD 8.5.7 is named after and the one
Phase 2b's tether frames, so the coverage is aimed at the right place, but it is coverage of one row
and not of 83. An error scattered across rows rather than confined to one would likewise reduce
coverage rather than fail. The deferred draw-range fix closes this one.

*An error large enough to push the row off screen is absorbed, and the run passes green.*
`mirrorPixel` decides "off screen" from the mirror's **own** projected position and returns `null`
before the sample enters `checked` and before the `sampledRows` tally, so a row displaced clean out
of NDC leaves the numerator and the denominator at once — and the dark-row rule cannot judge a row
it never saw. Continuing the ladder above on `fixture-small`:

| injected into row 0 | measured | samples per plane row | verdict |
| --- | --- | --- | --- |
| `py += 60` | 35/64 | `4x27 3x17 0x15 1x5` | **fail** — row 0 dark, named |
| `py += 400` | 35/49 | `4x27 3x17 1x5` — row 0 absent | **pass, exit 0** |

The 15 dust samples are reported as `15 off screen`, `measured` stays above the floor of 16, and the
run prints `OK — small decodes …`. So sensitivity is monotone from 3 up to about 60 world units and
goes blind again past roughly 400 — not an exotic regime for this failure, since a sign flip, a
wrong radius scale or a stale plane-table row lands there rather than at 4 px.

That second hole is left open on purpose. Applying the same concentration rule to `offScreen` would
fail a plane row that is *legitimately* outside the view frustum: it is 100% off screen for reasons
that have nothing to do with the mirror. Both fixtures report `0 off screen` at this camera, so the
gate would cost nothing today, but that is not a property of the real 89-shard dataset.
Discriminating the two needs a design decision rather than a threshold — `planeWorldPosition` has
the plane centre, and "centre on screen, every sampled star off screen" is the bug's signature, but
that path shares drift and home with the mirror and so would miss an error injected there. It is
deferred to Phase 2b with the draw-range work.

The `--use-angle=metal` flag that gets `verify-browser` onto a real driver is **macOS-specific**. On
Linux CI it would be wrong, and the `SOFTWARE_RENDERER` regex would then be the only thing between
the suite and a green SwiftShader run that establishes nothing about a driver.

Two things the bench output does **not** say. The `cpu ms` row is only `StarScene`'s own callback
duration — it excludes three.js's draw submission and the effect composer — so PRD 7.2's "CPU time
per frame in the render loop" is *not* measured by it and the near-zero figure should not be read as
satisfying that row. The frame-time percentiles carry the real evidence. And the run is at
`deviceScaleFactor` 2 by default so the tier-0 cap of 1.5 actually binds, which is what the Retina
reference machine does; `--device-scale 1` reproduces a non-Retina display.

`bench` is the local protocol of implementation-plan §6: headed Chrome on the reference machine,
along a fixed camera path anchored to the largest real plane and tracked live as it drifts. Use
`--uncapped` to see the real headroom — with vsync on, a 120 Hz panel reports 8.3 ms whether the
frame cost 2 ms or 8. `--shots` parks the camera at each segment and photographs it.

## 8. Per-frame discipline (PRD 7.3.2–3)

One `useFrame` callback owns the frame (`web/src/scene/StarScene.tsx`): advance the table, push the
uniforms, turn the background, pick under the pointer, mirror the focused star, sample the monitor.
One callback rather than six is what makes "no allocations in the per-frame path" something a
reviewer can read off the page instead of auditing across a component tree. Pointer state lives on
the canvas rather than in React, so a pointer move costs no render.

## 9. What Phase 2a deliberately leaves alone

Plane labels and the chronology bands (2b), the camera rig, intro and attract mode (2b), runtime
plane-detail loading (2b), thumbnails, the focused card and planets (3), the HUD, filters and the
toast surface (4). The filter mask attribute and `StarGeometry.setFilterMask` exist and are wired
into the shader; the rules that populate them are Phase 4's.
