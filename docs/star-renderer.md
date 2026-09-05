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
| none | 0.25 px | 1.0 | `3x6 4x6 1x3 0x1` | pass |
| `py += 2` | 1.49 px | 5.1 | `3x6 4x5 0x3 1x3` | **fail** — 21 stars past tolerance |
| `py += 3` | 0.41 px | 1.41 | `0x24` `3x6 4x4 1x3` | **fail** — row 0 dark |
| `py += 4` | 0.34 px | 1.0 | `0x24` `3x7 4x6 1x3` | **fail** — row 0 dark |
| `py += 6` | 0.35 px | 1.0 | `0x24` `3x6 4x6 1x3` | **fail** — row 0 dark |

Note that `py += 2` now fails on its 21 individually out-of-tolerance stars alone: at 24 samples a
row its mean is 1.49 px, a hair under the 1.5 px drift clause that used to catch it as well. The
clause that fails it is the one that should, but the margin is thinner than it reads.

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
`fixture-scale`'s rows draw 24, 23, 21, 19, 18, 12, then 7, 7, 6, and nothing lands in between, so
any floor in that gap selects the same 77 rows. What it excludes now is *small* rows — three planes
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
clean fixture rather than catch anything. Six further `fixture-scale` planes hold no stars at all
and cannot be sampled by any means. So the denominator is 77 of 87, and the ten rows outside it are
named in the `samples per plane row` line of every run.

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
and runs only under `?selfcheck=1`, so this is CI time rather than anything a user waits for.
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
`web/src/harness/Phase2aScene.tsx`, so 300.2 units out. (Not the rig's home framing of `R * 1.9 =
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
watch rather than an argument to trust. Clean runs report sampled stars **285.2–402.0** units in
front of the eye on `fixture-small`, **200.5–412.2** on `fixture-scale` and **197.7–405.4** on the
87-plane production dataset — all inside the 144.2–456.2 band above, three orders of magnitude clear
of the 0.1 near plane and a factor of 14 clear of the harness camera's 6000 far one, against a 3 px
tolerance that fails at a few world units. The measured spans are narrower than the bound because no
star sits on the view axis at full extent. Note the far figure is the *widest* of the three and
barely moves between datasets: it is set by the camera's distance plus the star-offset bound, not by
how many planes there are, which is the shape you would expect if that bound is what limits it. Read
them knowing they are a min and a max
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

The two scripts that produce these tables are committed: `web/scripts/selfcheck-ladder.sh` injects
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
