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

The whole per-frame CPU cost of the field's motion is this table: one angle integration per plane
and two easings into a preallocated array, uploaded in one call (PRD 8.5.3's "~80 floats per
frame").

## 4. Loading, fading, failing

PRD 8.7's order, in `web/src/scene/useSceneData.ts`:

1. the shell renders the sky and the parallax background — no data involved;
2. `manifest.json` and `planes.json`; the scene is built and zero-card planes appear at once;
3. `stars.bin` streams, the draw range grows, and each plane fades in as its own slice completes;
4. `search.json` and `sets.bin` after the first frame.

Records are plane-ordered and `planes.json` carries `starOffset`/`starCount`, so "this plane is
complete" is a comparison against a moving cursor, not a scan. A partially arrived plane is inside
the draw range at fade 0 — invisible until every one of its stars has landed.

**Failure** (PRD 7.4.1): the loader retries three times with exponential backoff. After that the
scene emits exactly one event per artefact through `web/src/scene/errors.ts` and keeps rendering.
Phase 4 subscribes and shows the toast. A missing `search.json` costs the set facet, not the
multiverse.

Two failures skip the remaining attempts, because asking again cannot change the answer: an abort,
which is the failure the caller asked for, and a `ContractError` — bad magic, a contract version
this build does not speak, the wrong file kind. The backoff is abort-aware for the same reason.

For `stars.bin` the attempt covers the *whole transfer*, body included, and a second attempt asks
only for the bytes still missing (`Range: bytes=<received>-`). This matters because it is the
largest artefact in the contract and much the likeliest to fail after its response headers came
back fine — a failure that used to get no retries at all, the retry having sat around the response
while the rejection came out of `read()`. Two endings are treated alike: a body that rejects
mid-stream, and a body that *stops* mid-stream without rejecting, which the declared record count
makes detectable and which otherwise returns a short file as though it were whole. A server that
ignores `Range` costs bandwidth and nothing else — the duplicated prefix is dropped as it arrives,
so the draw range and the plane reveals built on it only ever move forward.

Because the reader now outlives an attempt, its header state is assigned as one block, after the
kind check: a header that fails validation leaves no trace for the next attempt to find. Skipping
that block would skip the kind check *and* the header-sized allocation with it, which is how a
`sets.bin` served at the `stars.bin` path could be rejected on one attempt and accepted on three.

One consequence worth knowing: the attempt boundary encloses the consumer callback, which for the
scene is GPU work. A lost WebGL context therefore costs an attempt and reports as a `stars.bin`
failure. Correctness survives it — the consumer is handed the whole body view and
`StarGeometry.append` is monotonic, so records missed by a throwing call are uploaded by the next
successful one.

## 5. Picking

PRD 8.5.6 is two mechanisms and a precedence rule, and the rule is what makes them one gesture:
click anywhere on a plane and you get the plane, unless you clicked a star.

- **Stars, thumbnails and planets: the id buffer.** A second pass renders ids as colour, using the
  *same vertex shader* with `ID_PASS` defined — which is why it is exact. The sub-window comes from
  `camera.setViewOffset` and an 11×11 render target rather than a full-size target plus a scissor:
  identical projection, 484 bytes of readback instead of 8 MB of VRAM.
- **Planes: a CPU sphere raycast** against one bounding sphere per plane, whose centres come from
  the same motion mirror. Allocation-free; it runs on pointer move.

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

### 6.1 The pixel-ratio rung, and why the prop is a range

`<Canvas dpr={[0.5, tier.pixelRatioCap]}>` in `EternitiesScene.tsx` is the **only** writer of the
pixel ratio (DEC-692 R2). It used to be a bare number naming tier 0's cap, with `StarScene` calling
`setDpr(min(cap, devicePixelRatio))` on mount and on every tier change — and a comment recording
the prop as inert.

It was not inert, and the ladder's first rung never landed because of it. Under a `?quality=` pin
the prop and the pin agree, so every measurement taken through a pin saw the pin win. Under the
free ladder they do not, and R3F re-reads the prop on every render (`configure()`: `if (dpr &&
state.viewport.dpr !== calculateDpr(dpr)) state.setDpr(dpr)`), so the readout panel's 2 Hz
re-render put 1.5 back twice a second. Measured on the live site: the canvas stayed at 2880×1620
through `full → pixel-ratio → bloom` on a `devicePixelRatio` 1 viewport, while the composer's scene
buffer sat at 1920×1080 — a 1× render upscaled through a 1.5× post chain (review §2.2, §3.2).

A *range* fixes it at the root rather than racing it: R3F resolves an array as `min(max(lo,
devicePixelRatio), hi)`, which is exactly `min(cap, devicePixelRatio)` for any display at or above
the floor. `configure()` re-applying it is then a no-op, binding `hi` to the live tier makes the
rung real, and `StarScene` no longer touches dpr at all. `e2e/quality.spec.ts` asserts the exact
drawing buffer each cap produces, so a wrong value is a deterministic failure rather than the
2-of-3 flake DEC-667 N1 recorded. The 0.5 floor is R3F's own minimum-sane ratio and never binds on
real hardware; it is there because a range needs two ends.

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
before its verdict counts, so it cannot pass vacuously. That floor is a legacy figure: 16 was a
quarter of the old file-wide sampler's 64 samples and is now 0.9% of `fixture-scale`'s 1832, so in
relative terms it barely bites. It has deliberately not been rescaled — vacuity is covered far
better by the dark-row rule below, which judges every row of ten stars or more, and all an absolute
floor is still for is the degenerate run that took almost no samples at all.

`unmeasured` has two causes and they are indistinguishable from a single sample: a nearer sprite
covered the star inside a galaxy core, or the mirror put it more than half a pick window out and it
is not in its own window at all. The second is the failure the check exists for, and it used to
escape through this gap — the search window is 11 px, so **sensitivity is not monotone in the size
of the error**. Injecting a uniform offset into the dust row of `fixture-small` and growing it:

| injected into row 0 | mean | max | unmeasured rows | verdict |
| --- | --- | --- | --- | --- |
| none | 0.25 px | 1.0 | `3x6 4x6 1x3 0x1` | pass |
| `py += 2` | 1.49–1.51 px | 5.1 | `3x6 4x5 0x3 1x3` | **fail** — 21 stars past tolerance |
| `py += 3` | 0.41 px | 1.41 | `0x24` `3x6 4x4 1x3` | **fail** — row 0 dark |
| `py += 4` | 0.34 px | 1.0 | `0x24` `3x7 4x6 1x3` | **fail** — row 0 dark |
| `py += 6` | 0.35 px | 1.0 | `0x24` `3x6 4x6 1x3` | **fail** — row 0 dark |

The `unmeasured rows` column is the `dark samples per plane row` line of a `verify-browser` run, and
the line under it splits out the part the verdict actually reads. Both are printed on every run,
green ones included: raw darkness is the number these tables are written in and the one that shows
production's `dominaria` going 96% dark, while `unexplained` is what decides pass or fail, and a run
that printed only the second could not be checked against the first.

Note that `py += 2` now fails on its 21 individually out-of-tolerance stars alone. At 24 samples a
row its mean lands on either side of the 1.5 px drift clause that used to catch it as well —
measured 1.49 px on one run and 1.51 px on another — so that clause fires about as often as not and
is no longer what carries the rung. The clause that fails it is the one that should, and it got
*stronger* when the sampler changed: 21 of row 0's 24 samples are individually past tolerance where
the file-wide sampler produced one, because it drew the row from a single contiguous stretch and
kept missing the stars where 2 world units exceed 3 px. Failing on 21 independent violations is a
better gate than failing on a mean sitting 1% from its threshold. Do not read the mean here as a
margin that was nearly lost; read it as a clause that no longer matters for this rung.

Before the dark-row rule, the last three passed — with a *better* mean than the clean run, because
all 24 dust samples left their windows at once and were dropped from the average. So the third
clause: **of a plane row's samples, at least ten of them, no more than half may go dark without a
nearer star to account for it.**

Two things do the separating, and the second one is newer than the rule. The first is distribution:
occlusion is a property of one star's neighbourhood and strikes scattered stars, while the mirror is
written per plane row, so an error in it moves the whole row together. The second is *why* a sample
went dark. A dark sample is one the picker could not find in its own window, and the window can be
asked what it held instead — if that is a star the mirror puts nearer the eye, the prediction was
right and something in front won the depth test. That sample is explained, and only the unexplained
ones count against the row.

That second test is not a refinement; without it the rule does not survive the real dataset. Once
every row is sampled (the section after next), production's row 19 — `dominaria`, 6266 stars, 21.9%
of the field — reads **23 of 24 samples dark on a clean build**, three runs out of three. On raw
darkness there is no threshold that passes that row and still catches a displaced one: 0.9 and 0.95
both fail it, and 1.0 sits one sample from failing while excusing any row that leaves a straggler.
Asking *why* collapses the problem — clean `dominaria` has **0** unexplained samples, and the same
row with a 400-unit mirror error has 24.

The two constants are set against that quantity, on all three datasets:

| | clean, worst row | injected row |
| --- | --- | --- |
| dark (`unmeasured`) | 23 of 24 — production row 19 | 24 of 24 |
| **unexplained** | **1 of 24** — anywhere, any dataset | **20 to 24 of 24** |

The floor of 10 no longer separates lucky rows from real ones: with a per-row budget
`fixture-scale`'s eighty non-empty rows draw 24 (seventy of them), 23, 21, 21, 19, 18, 18, 12, then
7, 7, 6 — 1832 samples in all — and nothing lands between 7 and 12, so any floor in that gap selects
the same 77 rows. What it excludes now is *small* rows — three planes
hold fewer than ten stars and cannot reach it at any budget without reading the same star twice. The
rate is 0.5 because that is the middle of the empty gap in the table above; it is not near 1.0
because occlusion explains some of a *displaced* row's samples too. The ladder's smallest rung,
`py += 3`, reads 20 of 24 unexplained, and a rate of 0.9 let it pass green until the ladder was
re-run against it.

Measured on Metal, both fixtures: worst disagreement **1.0–1.41 px**, mean 0.21 px on
`fixture-scale` and 0.29–0.33 px on `fixture-small`, against a 3 px tolerance. So what the check
buys, stated to match what it actually asserts:

- no star it located was drawn 3 px or more from where the mirror puts it;
- no systematic drift above about 1.5 px mean across everything it located;
- no plane row holding ten or more stars went dark in a way occlusion does not account for — on
  screen or off it, since an off-screen row is measured rather than skipped (see below) — checked on
  77 of `fixture-scale`'s 87 rows and all 30 of production's, not on one of them;
- no sampled star was put behind the eye or past the far plane, the one projection that cannot be
  measured at all.

And what it still does not buy. **This list is what is known, not a claim that it is complete** —
every entry on it was found by injecting a larger error than the round before had thought to try,
and that is the only method that has found any of them. The two sections that follow record entries
that have since been closed, and are kept because the way each was closed is the reason the third
and fourth bullets above can be stated at all.

*A row with fewer than ten stars is reported and never judged.* This one is structural rather than
budgetary and will not be closed by sampling harder: `lorwyn` holds 6 stars, `diraden` and `vryn` 7,
so no budget reaches a floor of 10 on them without reading the same star twice — and ten reads of
one occluded star are ten dark samples establishing exactly what one established, which would fail a
clean fixture rather than catch anything. Seven further `fixture-scale` planes hold no stars at all
and cannot be sampled by any means. So the denominator is 77 of 87 — 80 non-empty rows less those
three, against 7 empty ones — and the ten rows outside it are named in the `samples per plane row`
line of every run.

### The thin-sampling hole, and how it was closed

*A row too thinly sampled to judge could be displaced without failing.* The sampler walked
`floor((s / 64) * drawCount)` — even over the file, which is even over the *stars*, so a row's share
of the samples was its share of the stars rather than a share of the rows. On `fixture-scale` that
put row 0 on fifteen samples, the next rows on seven, five, four and two, and left **exactly one row
of eighty** above the floor. That row is the Blind Eternities dust, the one PRD 8.5.7 is named after
and the one Phase 2b's tether frames, so the coverage was aimed at the right place — but it was
coverage of one row and not of 87, and an error scattered across rows reduced coverage rather than
failing. Production was barely better at two rows (`19x14 0x12`).

`rowSampleIndices` samples per row instead: `SAMPLES_PER_ROW` stars from every non-empty row,
stratified within the row and interleaved across rows. Judged rows on `fixture-scale` go from 1 to
77. The rung that shows the difference is an injection confined to a row the old sampler never
touched at all — row 44 drew **zero** of its 64 samples, and 24 of the new sampler's:

| `if (row === 44) py += 400`, `fixture-scale` | before (file-wide) | now (per row) |
| --- | --- | --- |
| samples on row 44 | 0 | 24 |
| verdict | **pass, exit 0** | **fail** — row 44 dark 24 of 24 |

The cost is wall-clock, and it is not small: 1832 samples and about 32 s on `fixture-scale` against
64 samples and about a second, per dataset, on every `verify-browser` run. The check is diagnostic
and runs only under `?selfcheck=1`, so this is local-gate time rather than anything a user waits
for — and it is not CI time either: no workflow in `.github/workflows/` runs `verify-browser` at
all, because the check needs a real GPU. Everything the check asserts is asserted on the machine of
whoever runs the gate before a merge.
`?perrow=N` overrides the budget without a rebuild, which is how the constants above were
re-derived and how they should be re-derived again if the fixtures change.

### The off-screen hole, and how it was closed

*An error large enough to push the row off screen used to be absorbed, and the run passed green.*
`mirrorPixel` decided "off screen" from the mirror's **own** projected position and returned `null`
before the sample entered `checked` and before the `sampledRows` tally, so a row displaced clean out
of NDC left the numerator and the denominator at once — and the dark-row rule cannot judge a row it
never saw. Continuing the ladder above on `fixture-small`, with the injection scoped to row 0:

Re-measured under the per-row sampler (DEC-634), which is why the counts below are larger than the
`before` column was written against — that column's verdicts are what it asserts, and they are
unchanged. Row 0 now draws 24 samples rather than 15:

| injected into row 0 | measured (±1) | samples per plane row | before | now |
| --- | --- | --- | --- | --- |
| `py += 60` | 56/96 | `0x24 1x24 3x24 4x24` | **fail** — row 0 dark | **fail** — row 0 dark 24/24 |
| `py += 400` | 56/96 | `0x24 1x24 3x24 4x24` | **pass, exit 0** | **fail** — row 0 dark 24/24 |
| `py += 4000` | 56/72 | `1x24 3x24 4x24` — row 0 absent | **pass, exit 0** | **fail** — 24 unprojectable |
| `pz += 400` | 56/82 | `0x10 1x24 3x24 4x24` — row 0 thinned | **pass, exit 0** | **fail** — row 0 dark 10/10 *and* 14 unprojectable |

`pz += 400` is the rung the new sampler changed most, and it is worth reading closely. 14 of row 0's
24 samples project past the far plane and are dropped before both tallies, leaving 10 — which is
exactly `DARK_ROW_MIN_SAMPLES`, so the row is judged, goes 10 of 10 dark, and the run now fails on
the dark-row rule *and* the unprojectable clause at once. Under the file-wide sampler the same
injection left row 0 with 8 samples, under the floor and therefore unjudged, so only the
unprojectable clause fired. The floor is load-bearing in both directions here: one sample fewer and
this rung would report half of what it found.

Read the `measured` column as approximate: it varies by about one across machines and between runs
on the same machine, because whether a given star is occluded by a nearer sprite comes down to pixel
quantisation at the 2 px self-check sprite. An independent reproduction on the same commit read 33
on three of these four rungs. Nothing in the argument rests on it — the verdicts and the samples per
plane row are what carry it, and those reproduce exactly. `measured` is here only to show that the
denominator does not collapse, which is what would make a green run vacuous.

The fix is not a heuristic that tries to tell a displaced row from a distant one. It is that an
off-screen projection **still yields a pixel, and the sample is measured like any other**. `IdPicker`
aims its 11×11 window with `camera.setViewOffset`, which is arithmetic on the frustum's edges —
three adds `offsetX * width / fullWidth` to the left edge and does not clamp — so a window can be
aimed at a pixel outside the viewport and the shader answers the same question there, at the same
resolution, through the same vertex program. Object culling cannot interfere, because
`starFieldObjects` already sets `frustumCulled = false` and `boundingSphere = null` on the pick
points. So an off-screen sample enters `checked` and `sampledRows` and the dark-row rule does the
rest unchanged. `offScreen` is reported and **never judged**; nothing branches on it.

That is what makes the discriminator the earlier analysis went looking for unnecessary. The control
displaces row 0's home in the *plane table*, which backs the mirror and the GLSL twin alike, so the
row is genuinely and correctly 400 units off screen — the case a concentration rule on `offScreen`
would have failed. Both cases report exactly `24 off screen`; the verdicts are opposite, and they
are opposite on measurement rather than on a rule about frustums:

| row 0, 400 units up | off screen | row 0 located | verdict |
| --- | --- | --- | --- |
| mirror only (`py += 400`) | 24 | 0 of 24 | **fail** — row 0 dark, named |
| mirror *and* shader (plane table `home + 400`) | 24 | 24 of 24 | **pass, exit 0** |

The one projection left that no view offset can reach is `z > 1` — behind the eye, or past the far
plane — since shifting the frustum sideways never puts the eye behind itself. Those samples are
still dropped before both tallies, so they are counted as `unprojectable`, reported per row, and
`ok` requires zero of them. Both remaining rungs above land there, and the `pz += 400` one shows why
the count alone is not enough: it takes 7 of row 0's 15 samples out, the other 8 come back entirely
dark, and `findDarkRows` still will not judge the row because 8 is under its floor of 10. Dropping a
sample does not only lose that sample — it can drag the row it came from under the floor and take
the rest down with it.

Requiring a flat zero is safe because of two facts, one about the camera and one about the data.

The camera runs from outside the field looking in. `?selfcheck=1` routes to the Phase 2a harness,
which uses its own fixed dev camera rather than the rig — `[0, 150, 260]` in
`web/src/harness/SelfCheckScene.tsx`, so 300.2 units out. (Not the rig's home framing of `R * 1.9 =
247`: the self-check and the bench live in the harness precisely because they drive the camera
themselves.)

The data cannot reach round behind that eye, but the chain takes one more step than the radius
alone. `MULTIVERSE_RADIUS = 130.0` in `pipeline/src/eternities/pipeline/assemble.py` bounds where a
plane *centre* may be placed, and `fixtures/layout.py` places the fixture centres inside the same
radius — and a centre is not a star. `starWorldPosition` in `web/src/scene/starfield/motion.ts` adds
two further terms before the star lands: the local position scaled by the plane's visual radius
(`px *= radius`), and `drift * motion`. Spin, tilt, shear and the multiverse rotation are rotations
and move nothing further out, so

    |star| <= |centre| + FRAME_RADIUS * radius + driftAmplitude

with `FRAME_RADIUS = 1.2` from `contract/enums.py`. For a named plane that is `130 + 1.2 * 12 +
drift` ≈ 145, where `R_MAX = 12` is the largest visual radius `layout.py` emits and drift is 3% of
mean plane spacing (0.85 on an 87-plane dataset, 3.9 on five-plane `fixture-small`). The widest row
is the Blind Eternities dust row, which PRD 8.3 gives the identity transform and radius `R` itself:
`0 + 1.2 * 130 = 156`. Either way a star sits within **156** of the origin, so depth stays inside
`300.2 ± 156` — **144.2 to 456.2**. That invariant, not the camera alone, is why the real 87-plane
production dataset also comes back `0 unprojectable`.

Both margins are printed on every run, green ones included, so the clause is a pair of numbers to
watch rather than an argument to trust. Clean runs report sampled stars **218.5–395.5** units in
front of the eye on `fixture-small`, **188.5–411.3** on `fixture-scale` and **191.1–402.6** on the
87-plane production dataset — all inside the 144.2–456.2 band above, three orders of magnitude clear
of the 0.1 near plane and a factor of 14 clear of the harness camera's 6000 far one, against a 3 px
tolerance that fails at a few world units. The measured spans are narrower than the bound because no
star sits on the view axis at full extent. They are the per-row sampler's, re-measured after it
landed; the file-wide sampler read 285.2–402.0, 200.5–412.2 and 197.7–405.4, and the shift is a
change in which stars are looked at rather than in where any star is. Note the far figure is the
*widest* of the three and barely moves between datasets: it is set by the camera's distance plus the
star-offset bound, not by how many planes there are, which is the shape you would expect if that
bound is what limits it. Read them knowing they are a min and a max
over the samples that *survived*: a run that fails on `unprojectable` still prints a healthy near
margin, because the samples that tripped the clause never reached the `Math.min`. They are the
margin of a passing run, not a diagnosis of a failing one — `unprojectableRows` is what says where a
failure came from.

Two regimes would break the clause, and the second is the reason the radius above is worth naming.

A camera *inside* the field makes stars behind the eye ordinary, and this clause would fire on a
correct mirror. The near plane is the same regime by a quieter route: `pixelForNdc` accepts `z < -1`
as measurable, correctly — it is in front of the eye and a window can be aimed at it — but the
shader clips it at the 0.1 near plane and never draws it, so the sample is measured, comes back
unlocatable, and a correct mirror reads as a *dark row* rather than as an unprojectable one. Inside
the field both clauses go wrong at once and only one of them says so.

Data that legitimately places a plane far enough out fails the same way with the mirror and the
shader in perfect agreement. The plane-table control at `home + 4000` does it: 24 unprojectable, and
the message used to call it a mirror error. The same control at `home + 400` passes, so the
false-positive boundary sits between the two — a factor of 30 beyond the 130 a centre is allowed,
which is why no dataset the pipeline can emit reaches it. The failure message now names both
causes.

If either regime arrives the clause should be replaced rather than loosened, and the replacement is
a comparison against the shader — a star the mirror puts behind the eye that the id buffer still
shows on screen is a contradiction no legitimate camera produces.

Sensitivity is now monotone from 3 world units upward with no blind band above it, where before it
went blind again past roughly 400 — not an exotic regime for this failure, since a sign flip, a
wrong radius scale or a stale plane-table row lands there rather than at 4 px.

The two scripts that produced these tables were deleted with Phase 2a's harness (review §6.1 group
B); they are in history at the commit before it. What they did: `selfcheck-ladder.sh` injected
into the CPU mirror alone, `web/scripts/selfcheck-control.sh` into the plane table that backs both
sides. They take the injection as an argument, derive the repo root from their own location, and
restore every file they touch. That is deliberate rather than tidy-mindedness — `unprojectable`,
`unprojectableRows`, the depth margins and the `ok` composition live in `sample()`, which needs a
real GPU and therefore has no unit test, so these scripts are the only regression proof those four
have. Delete the `unprojectable === 0` clause and CI stays green; run the ladder and it does not.

Reproducing needs three caveats, each of which has cost someone a cycle:

- The shell, navigation and card-tier checks are downstream of the same motion mirror and catch
  these injections too, so on an unmodified `verify-browser` they fire *first* and abort before the
  star self-check is reached — `py += 400` dies at PRD 5.6.1's card framing. Isolating the check
  under test means skipping the verify steps before `verifyStarField`, which both scripts do.
- Write a plane-table injection as an assignment, not `d[...] += 400`. `noUncheckedIndexedAccess`
  types a `Float32Array` index as `number | undefined`, so a compound assignment fails `tsc` and the
  script reports `BUILD FAILED` rather than anything about the check.
- Running the "before" column against `origin/main` means restoring that commit's `selfCheck.ts`,
  `verify-browser.mjs` *and* `test/selfCheck.test.ts`. Reverting only the first two fails
  `tsc --build`, because the current test imports `pixelForNdc`.

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

### How `DARK_ROW_MIN_SAMPLES` and `DARK_ROW_RATE` were derived

Moved out of `web/src/scene/selfCheck.ts` (review §6.3's comment policy: measurements belong in
`docs/`, not beside the constant they produced). The constants are the code's; the derivation,
the ladder runs and the numbers behind them are here.

The assertion that closes `unmeasured`'s escape hatch.

`distanceTo` searches an 11×11 window centred on the mirror's prediction, so the check's
sensitivity is not monotone in the size of the error: a star the mirror puts more than half a
window out is not in its own window at all, comes back `-1`, and is scored `unmeasured` —
dropped from the mean, from `missed` and from `ok` alike. Injecting `py += 2` into the dust row
of `fixture-small` fails the check; injecting `py += 3`, `4` or `6` — the same bug, larger —
passed it, with a *better* mean than the clean run, because all 15 row-0 samples went dark. That
is the exact PRD 8.5.7 catastrophe reported as agreement.

What separates the two causes of `unmeasured` is not the individual sample — from inside one
sample they are identical — but how they distribute across plane rows. Occlusion is a property
of one star's neighbourhood: it strikes the stars inside a galaxy core and not the ones in its
halo, so it is scattered, and it leaves plenty of the same row measurable. The mirror is written
per plane row, so an error in it moves every star on that row together and takes the whole row
out at once. A row that went all but entirely dark is therefore the signature of the bug and not
of the field — provided enough of it was sampled to tell the difference, which is what the floor
below is for. Rows sampled fewer times than that are reported but not judged; on an 87-plane
fixture most rows draw one sample and can never be either.

Both numbers are set from measurement, and DEC-634 re-derived them against the per-row sampler.
**Neither moved. What moved is the numerator they are applied to**, and that is the whole of the
story — so read this as the record of a rule that had to change shape, not a pair of tuned knobs.

*The floor stays 10, for a new reason.* Its old job was to outrank luck: at 37 of 64 samples
occluded, a row drawing four or five samples goes entirely dark by chance, as rows 47 and 43 did
on a clean build. Under {@link rowSampleIndices} a row's sample count is no longer a draw from
the file; it is `min(SAMPLES_PER_ROW, that row's stars)`, and on `fixture-scale` those counts run
24 for 70 rows, then 23, 21, 21, 19, 18, 18, 12 — and then 7, 7, 6, which is all eighty non-empty
rows and sums to the 1832 samples a run takes. Nothing lands between 7 and 12, so every floor in
that gap selects the same 77 rows and the choice is insensitive. What the floor
now excludes is not unlucky rows but *small* ones: `lorwyn` (6 stars), `diraden` and `vryn` (7)
cannot reach ten samples at any budget without reading the same star twice, and ten reads of one
occluded star are ten dark samples establishing exactly what one established. They are reported
and never judged. Seven further planes hold no stars at all and cannot be sampled by any means, so
the denominator is 77 of 87: 80 non-empty rows, less those 3, against 7 empty ones.

*The rate stays 0.9 — but only because the numerator stopped being `unmeasured`.* Sampling every
row reaches rows the file-wide sampler never judged, and on a real dataset some of them are
legitimately almost entirely occluded. Measured on Metal, clean, three runs each:

    production   row 19 `dominaria`  23/24 23/24 23/24 dark   0.958
    production   row 67 `ravnica`    22/24 21/24 21/24        0.917
    production   rows 2, 60, 85      21/24                    0.875
    fixture-scale row 42             20/24 on all five runs   0.833

`dominaria` holds 6266 stars, 21.9% of the production field, and at a 2 px pick sprite almost
every one of them is behind a nearer one. So on `unmeasured` there is **no threshold that works**:
0.9 and 0.95 both fail that row on a clean build, and 1.0 sits one sample away from failing while
letting a single straggler exempt a genuinely displaced row. Raising the budget cannot separate
0.958 from 1.0 either. The old constants hid this because the old sampler judged `dominaria` on
14 samples drawn from one stretch of the file; sampling the row evenly is what revealed it.

The fix is not a number. A dark sample now records *why* it was dark — see the branch in `sample`
— by asking what the pick window held instead, and only samples that occlusion does not account
for reach {@link SelfCheckResult.unexplainedRows}, which is what this rule reads. That quantity
is density-independent, and the separation is total rather than marginal:

    production, clean            row 19: 23/24 dark, **0** unexplained; 1 unexplained in the run
    production, `py += 400`      row 19: 24/24 dark, **24** unexplained
    fixture-scale, clean         4 unexplained across 80 rows, 1122 of 1126 dark samples occluded
    fixture-scale, `py += 400`   row 44: 24/24 dark, **24** unexplained

*So the rate moves from 0.9 to 0.5, and the numerator change is what demands it.* Against
`unmeasured`, 0.9 meant "this row went essentially entirely dark". Against `unexplained` that
reading is wrong, because occlusion keeps some of a *displaced* row's samples explained too. The
smallest rung on the ladder, `py += 3` into `fixture-small`'s row 0, moves the row a few pixels,
and four of its 24 samples then find a genuinely nearer star at the predicted pixel. That rung
reads 20 of 24 unexplained — 0.833, under 0.9 — so a rate carried across unexamined would have
let the ladder's *smallest* injection pass green. Re-running the ladder is what caught it, which
is the only way any entry on that list has ever been caught.

What the measurements show is a gap with nothing in it. Clean rows reach at most 1 unexplained
sample of 24 (0.042), across all three datasets and every run measured; injected rows read 0.833
to 1.0. The rate goes in the middle of that gap rather than at either edge, so neither more
occlusion coincidence on a displaced row nor more noise on a clean one moves a verdict. Its old
job — denying a displaced row its exemption for one measurable straggler — is still done, with an
order of magnitude more room than 0.9 ever had.

One thing this rule does not do, and one it used to not do. The list is **not** offered as
exhaustive — each entry was found by pushing an injection further than the round before it had
thought to, and the next one would be found the same way.

It does not judge a row with fewer than ten stars, and it never can — see the floor above. What
it no longer does is fail to judge a row merely because the *file* was sampled evenly: that was
DEC-634's hole, and closing it took the judged count on `fixture-scale` from 1 row to 77.

It used to miss an error large enough to project the row off screen, and no longer does. Nothing
in this constant or in `findDarkRows` changed to fix it — the fix is upstream, in `mirrorPixel`,
which stopped returning `null` for a projection outside NDC. An off-screen sample now enters
`checked` and `sampledRows` like any other, gets a pick window aimed at it, and is judged by the
rule below unchanged. On `fixture-small` the rung that used to pass green, `py += 400` into row
0, now fails naming row 0 dark 24 of 24 while reporting `24 off screen`; the control that
displaces the same row in the *plane table* — mirror and shader agreeing, the row genuinely out
of frame — reports the identical `24 off screen` and passes, located 24 of 24. Opposite verdicts
on the same count, decided by measurement rather than by a rule about frustums, which is why the
discriminator the earlier analysis went looking for turned out to be unnecessary rather than
merely deferred. See `mirrorPixel` for the mechanism, and `docs/star-renderer.md`
§ "The off-screen hole, and how it was closed" for the ladder, the control and the caveats on
reproducing them.

The one projection that still escapes this rule is `z > 1` — behind the eye or past the far plane
— which no lateral view offset can aim a window at. Those samples are dropped before both
tallies, so they are not left to `findDarkRows` at all: they are counted as `unprojectable` and
`ok` requires zero of them. See that clause in `sample` for what makes a flat zero safe.

### Why `ok` requires zero unprojectable samples

Moved out of the `ok` clause in `web/src/scene/selfCheck.ts`, for the same reason.

Four clauses, for four ways the mirror can be wrong.

Nothing may have missed — the mirror agrees with the shader wherever the two were compared.
The run must have located enough stars for that to mean something, or the check passes
vacuously on a crowded field: no misses, because nothing was ever compared. An absolute
floor rather than a fraction, because what fraction is measurable is a property of the
fixture's density, not of the mirror. And no plane row may have gone dark, or an error too
large to measure passes as an error that was never there — see `DARK_ROW_MIN_SAMPLES`.

The fourth is the other half of the off-screen fix. Aiming the pick window off screen makes
a laterally displaced row measurable, but a star the mirror puts *behind the eye* has no
pixel to aim at, and such a sample is still dropped before both tallies — which absorbs an
error in two ways, both measured on `fixture-small` and both green before this clause.
`py += 4000` takes row 0 out of `sampledRows` entirely, the same disappearance the lateral
fix closes. `pz += 400` is quieter: it thins the row instead of removing it. Under the
file-wide sampler that was the worse of the two — row 0 fell from 15 samples to 8, all 8 came
back dark, and the row escaped `findDarkRows`, which does not judge below its floor of 10.
Dropping a sample does not just lose that sample; it can drag the row it came from under the
floor and take the others down with it.

Per-row sampling (DEC-634) does not remove that mechanism, it just moves where it bites: the
same rung now thins row 0 from 24 to 10, which is the floor exactly, so the row is judged,
goes 10 of 10 unexplained, and the run fails on this clause and the dark-row rule together.
One sample fewer and only this clause would fire. That margin is not a safety property of
anything — it is where this fixture's arithmetic happens to land.

Requiring zero is a real assertion here rather than a formality, and two separate facts are
what make it safe — one about the camera, one about the data. Both have to hold, because a
sample lands behind the eye either by the eye moving towards it or by the star being placed
out past the eye.

The camera: `?selfcheck=1` routes to the Phase 2a harness, and that harness runs its own
fixed dev camera rather than the rig — `[0, 150, 260]` in `harness/SelfCheckScene.tsx`, so
300.2 units out, the eye well outside the multiverse looking in. Not the rig's home framing
of `R * 1.9 = 247`; the self-check and the bench live in the harness precisely because they
drive the camera themselves.

The data: `MULTIVERSE_RADIUS = 130.0` (`pipeline/src/eternities/contract/enums.py`) bounds
where the pipeline may place a plane *centre*, and the fixture centres go inside the same
radius (`pipeline/src/eternities/fixtures/layout.py`). But a centre is not a star.
`starWorldPosition` (`starfield/motion.ts`) puts two further terms on top of it: the star's
local position scaled by the plane's visual radius (`px *= radius`), and `drift * motion`.
Spin, tilt, shear and the multiverse rotation are all rotations and move nothing further out,
so the bound is

  |star| <= |centre| + FRAME_RADIUS * radius + driftAmplitude

with `FRAME_RADIUS = 1.2` (`contract/enums.py`) bounding a local position. For a named plane
that is `130 + 1.2 * 12 + drift` ~ 145, `R_MAX = 12` being the largest visual radius
`layout.py` emits and drift being 3% of mean plane spacing (0.85 on an 87-plane dataset, 3.9
on five-plane `fixture-small`). The widest row is the Blind Eternities dust row, which PRD
8.3 gives the identity transform and radius `R` itself: `0 + 1.2 * 130 = 156`. Either way a
star sits within 156 of the origin, so depth stays inside `300.2 +/- 156` — 144.2 to 456.2.
That clears the 0.1 near plane by three orders of magnitude and sits inside the harness
camera's 6000 far plane by a factor of 13, which is why production comes back
`0 unprojectable` over 87 planes.

Those are bounds rather than measurements, and the measured spans are narrower because no
star sits on the view axis at full extent: 191.1-402.6 on production, 188.5-411.3 on
`fixture-scale`, the widest of the three. `nearestDepth` and `farthestDepth` report both
margins on every run so the claim is checkable against numbers — but read them knowing they
are taken over the surviving samples, so they cannot warn about the samples that trip this
clause. A failing run still prints a healthy nearest.

What would break the camera half is running the check from *inside* the field, where stars
behind the eye are ordinary and this clause fires on a correct mirror. The near plane is the
same regime by a quieter route: `pixelForNdc` accepts `z < -1` as measurable — correctly,
since it is in front of the eye and a window can be aimed at it — but the shader clips it at
the 0.1 near plane and never draws it, so the sample is measured, comes back unlocatable,
and a correct mirror reads as a dark row rather than as an unprojectable one. Inside the
field both clauses go wrong at once, and only one of them says so.

What would break the data half is a plane legitimately placed far enough out. Measured: the
plane-table control at `home + 4000` — mirror and shader in perfect agreement, the data
simply saying the plane is up there — fails with 24 unprojectable. The message used to call
that a mirror error; it now names both causes. The same control at `home + 400` passes, so
the boundary sits between the two, a factor of 30 beyond the 130 a centre is allowed.

It is a flat zero rather than a rate because neither regime exists today, and it should be
replaced rather than loosened if either arrives — the replacement is a comparison against
the shader, not a threshold: a star the mirror puts behind the eye that the id buffer still
shows on screen is a contradiction no legitimate camera produces.


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
