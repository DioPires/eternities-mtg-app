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

`verify-browser` runs the **GPU self-check** (`web/src/scene/selfCheck.ts`, `?selfcheck=1`), which
is the only way to test the one claim that cannot be tested without a GPU: that the CPU motion
mirror agrees with the vertex shader. It takes a star, computes its world position on the CPU,
projects it to a pixel, and asks the id buffer what is there. A returned neighbour is fine — inside
a galaxy core several stars share a pixel and the id pass depth-sorts them — but the mirror still
has to place *that* star on that pixel, and the mean displacement across all samples is asserted, so
a systematic offset cannot hide behind crowding.

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
