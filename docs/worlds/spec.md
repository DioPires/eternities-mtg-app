# Eternities — concept B "worlds" production spec

**Status:** proposed, for review. Nothing here has been built.
**Authority:** the W2.3 decision ([`docs/decisions/w23-concept-and-stack.md`](../decisions/w23-concept-and-stack.md),
`8e07515`) chose concept B. This document turns the DEC-694 prototype into an implementation plan.
**Evidence base:** review `REVIEW-2026-09-08.md` §4.2, §4.4, §4.5; the DEC-694 prototype, branch
`dec694-worlds-prototype` at `8c5fa25`, tagged **`worlds-prototype-dec694`**; the prototype's own
measurements, carried into [`captures.json`](captures.json) beside this file.
**Renderer baseline:** the `SceneRenderer` that W4.2 (DEC-740) builds, on the platform layer W4.1
(DEC-739) builds. This spec assumes both have merged, and says explicitly where it does not.

---

## 0. What this document is, and what it is not

It is the plan for four things: the renderer (§1), the pipeline and data contract (§2), the cutover
and the acceptance gate that replaces `visual-gate.mjs` (§3), and the sequencing and staffing of the
implementation legs (§4). §5 is the batch of design questions that need the owner, and §6 is the
list of PRD amendments concept B forces.

It is **not** a re-argument of the concept. That was settled at W2.3. Where this spec differs from
review §4.2's sketch it says so and says why; the two places that happen are the band layout (§1.3)
and the art threshold's behaviour under pool pressure (§1.6).

Every number attributed to "the prototype" is from `captures.json`, measured at 1920×1080 CSS,
dpr 1, on the production dataset `6d4779695fde33ea`, on an Apple Silicon Mac. **None of it is a
Windows measurement.** Review §3.3's cost class for concept B (A far, B near) is still an estimate
and stays one until the W0.1 field reports land; §4.5 of this document says what that gates.

---

## 1. Renderer plan

### 1.1 Where worlds sits in the post-W4.2 `SceneRenderer`

W4.2 gives one `SceneRenderer` owning the canvas, the `WebGLRenderer`, one `requestAnimationFrame`,
and a fixed order per tick. Concept B changes what four of those steps do and deletes three:

| W4.2 tick step | Under worlds |
|---|---|
| input | unchanged |
| `rig.update(dt)` | unchanged — the camera rig imports nothing from three and is explicitly kept |
| plane table | unchanged in shape; the per-plane `DataTexture` loses the retired layout fields (§2.4) and gains nothing |
| uniforms | unchanged |
| async pick | same id-buffer technique, new subject: cell instance ids, not star indices (§1.11) |
| main pass | new content (§1.2) |
| **bloom source** | **deleted** |
| **mip chain** | **deleted** |
| **composite** | **reduced** to tonemap + vignette; no bloom tap |
| label tick | unchanged mechanism, far fewer labels (§1.8) |
| quality sample | unchanged; the ladder gains worlds-specific rungs (§1.12) |

Deleting the bloom chain is not an optimisation that can be deferred. Review §4.2 costs concept B
**assuming there is no post chain**, and §4.1 finds that the current 0.28-threshold bloom is what
makes stars read as out-of-focus bokeh. The rim glow that replaces it lives in the atmosphere shell
(§1.7), which is one additive back-face sphere per visible world and costs a fraction of a mip
chain.

> **Normative.** The worlds path must not add a full-scene post pass. Any glow is in-shader. If a
> future change wants one, it re-opens review §4.2's cost estimate and needs a re-measure.

### 1.2 Scene graph and pass order

Drawn in this order, every frame:

1. **Backdrop** — the existing three-layer parallax background, unchanged.
2. **System** — one `InstancedMesh` of icospheres, one instance per plane that is *below* §1.5's
   upper crossover threshold, which includes every plane inside the crossover band — those draw here
   **and** in step 4 and the two cross-fade (§1.5). Only a plane fully above the band is absent from
   this pass. Dust is excluded; it is step 3. A world instance samples its baked equirect swatch
   layer through a per-instance `iLayer`; a dark moon carries `iLayer = -1` and the flat moon colour
   (§1.8).
3. **Belt** — the Blind Eternities, one `Points` draw, one arc per set (§1.8).
4. **Worlds with sheets** — for each world above the LOD crossover: the globe shell, then the cell
   sheet — one `InstancedBufferGeometry`, one quad, N instances (§1.4).
5. **Tether** — the ribbon and its two anchor pads (§1.9).
6. **Printing ring** — at card focus only: flat `small` quads (§1.10).
7. **Focused card** — the existing card mesh, unchanged.
8. **Atmosphere** — every visible world's air shell, additive, `depthWrite: false`, `BackSide`,
   drawn after all opaque geometry (§1.7).
9. **Composite** — tonemap + vignette.

Steps 2–4 are opaque and depth-tested. Steps 5, 6, 8 are transparent; 8 is last because an
atmosphere must not depth-reject the tether passing in front of it.

> **Normative — there is one partition, and it is §1.5's crossover, not "the focused world".** A
> world appears in step 2 *or* step 4, except inside the crossover band where it appears in both and
> the two cross-fade (§1.5). More than one world can be above the crossover at once — a tether view
> with both ends near is the ordinary case — so nothing in the pass list may be written as "the
> focused world" versus "the rest".

**Population on production.** 87 planes: 57 empty, 1 dust, **29 worlds with cards**. At the home
view every world is far below the crossover, so step 2 draws **29 + 57 = 86 instances** and step 4
draws nothing; with one world fully above the band, step 2 draws 28 worlds + 57 moons — and with
that world *inside* the band it is 29 + 57 again, because it draws in both passes. Step 2's instance
count is therefore not `29 − (sheets drawn)`; it is a count of planes below the band's top, and a
renderer that derives one from the other will be one instance short through every approach. (The
prototype's `captures.json` reports `system.worlds = 27` because it drew Dominaria and Rabiah in
detail and had no equirect rung at all; 27 is a prototype count and is not production's.)

### 1.3 The surface law (normative)

**Latitude is colour. Longitude is time.** Both are per plane, never global.

- **Radius.** `radius = 0.126 · √cardCount`. Constant area per card, which is what makes Dominaria's
  22% share visible: r 9.97 against Rabiah's 1.09, a **9.1×** ratio where today's `log N` law gives
  **1.568×** for the same pair (`visual_radius` in `pipeline/src/eternities/fixtures/layout.py`:
  10.633 against 6.781). Review §4.1's oft-quoted 1.3× is a *different* pair — Dominaria against
  Mercadia, 20× the cards, 10.633 / 8.008 = 1.328 — and is not the comparand for this sentence.
  Empty planes take a floor radius instead (§1.8).
- **Bands.** Seven classes — W, U, B, R, G, gold, colourless — laid out **mirrored about the
  equator**: colourless is split between the two ice caps, each mono colour is a matched pair of
  bands, gold is the single equatorial belt. North to south:
  `C G R B U W · Gold · W U B R G C`.
- **Bands are equal-*area*, not equal-angle.** A band's share of `sin(latitude)` is its share of the
  plane's cards, so the area a colour covers *is* the fraction of the plane that colour is. Gold
  takes its whole share in one belt; every other class takes half its share per band.
- **Longitude** is sliced per plane by the plane's own `sets` array in chronological order, each set
  taking its share of 360°. A single-set plane is one slice covering the whole sphere and looks
  complete, not 97% missing.
- **The grid** starts from the standard equal-area sphere tiling:
  `rows = round(π / √(4π / (aspect · N)))`, each row at constant angular height `dφ = π/rows`,
  holding `round(2π·sin θ / (aspect·dφ))` cells, alternate rows staggered by half a cell so the
  tiling reads as masonry and not as a graticule. **The row count and the row latitudes are final;
  the per-row cell counts are only a starting point** — the relaxation below replaces them, which is
  why the client is shipped the counts rather than this formula (§2.1).

  > **Normative — one angle, defined once: `θ` is COLATITUDE.** `θ ∈ [0, π]` measured from the north
  > pole, so row `i`'s centre is `θ_i = (i + ½)·dφ` and latitude is `π/2 − θ`. Every angular formula
  > in this spec — here, §1.4's `iSize`, §2.1's half-extents and nearest-row match — is written in
  > `θ`. The circumference of a row is `2π·sin θ`, which is why the cell count carries **`sin`** and
  > not `cos`. An earlier draft used the single symbol `φ` for both readings in this one paragraph:
  > as latitude in `round(2π·cos φ / (aspect·dφ))` and as colatitude in "centres at `(i + ½)·dφ`".
  > Taken literally that pair is not merely ambiguous, it is degenerate — `cos((i + ½)·dφ)` runs
  > `+1 → −1` down the sphere, so Dominaria's southern rows get **negative** cell counts and the
  > 81 rows sum to **0 cells**. Read as `sin θ` they sum to exactly 6,266, which is `cardCount`.
- **Cell aspect is 4:3**, because that is what an `art_crop` letterboxes into without being
  stretched. Scryfall's terms forbid stretching card art and review §4.4 flags the current planet
  shader for exactly this class of problem; 4:3 is how concept B avoids inheriting it.

> **This differs from review §4.2's sketch, deliberately.** §4.2 says "five bands, gold as an
> equatorial belt, colourless as ice caps", which is five plus a belt plus two caps and does not fit
> one hemisphere. Mirroring makes all three named readings literally true and makes a world
> symmetric, which is what stops the mosaic reading as a bar chart wrapped round a ball. The
> prototype captures the owner accepted at W2.3 are of the mirrored layout.

**Assignment.** In the prototype the grid holds ≈ N slots and the population does not spread evenly
over them, so assignment ran three passes — exact (colour *and* set), colour only, anywhere — and
left Dominaria at 5,372 exact / 694 colour-only / 200 displaced / 0 bare, and Rabiah at 49 / 0 / 26
/ 3 bare of 75.

> **Normative, and a change from the prototype.** Production relaxes the grid *to the population*
> instead of displacing cards. Slice boundaries are chosen per row, so a row's cells are handed out
> to bands and sets in proportion to what that row's latitude range actually contains, and the row's
> cell count is chosen to match. The target is **100% exact, zero displaced, zero bare**, and the
> pipeline fails its own invariant test if any card is displaced (§2.1). A displaced card is a card
> in the wrong place on a map whose entire claim is that position means something.

> **Normative — what the relaxation does *not* move.** Only the per-row **cell count** is
> population-derived. The **row latitudes stay equal-angle**: `rows` rows of constant `dφ = π/rows`,
> centres at `(i + ½)·dφ`, unchanged from the closed form. This matters twice. It is what lets the
> client match a cell to its row by nearest latitude at all (§2.1), and it is what keeps rows and
> bands independent: bands are equal-*area* in `sin(lat)` and rows are equal-*angle*, so a band
> boundary generally falls **mid-row**. That is legal and intended — **a row straddling a band
> boundary splits its cells between the two bands in proportion to the area each band takes of that
> row**, which is the same proportional rule the paragraph above states, applied within a row rather
> than across rows. Band boundaries are never snapped to rows: snapping would quantise a colour's
> area to `1/rows` and break §1.3's central claim that a band's area *is* that colour's share.

Because the counts move and the latitudes do not, the closed form is no longer a description of the
shipped grid. Rabiah is the proof that the difference bites: the closed form gives **78 slots for 75
cards** (the prototype's 78, with 3 bare); the relaxed invariant demands exactly 75. §2.1 and §2.4
carry the contract consequence.

### 1.4 The cell sheet

One `InstancedBufferGeometry`, one unit quad, N instances, one draw per world. Review §4.2 costs
this at "~2,000 opaque textured quads ≈ 2–3 ms"; Dominaria puts 6,266 in the draw.

Per-instance attributes: `iNormal` (vec3, the unit-sphere point), `iEast` (vec3), `iSize` (vec2,
half-extents in units of world radius — **arc length, not angle**; the longitudinal component is
`(π / rowCells[r])·sin θ_r` and §2.1 carries the derivation and the 51.6× failure that drops the
`sin θ_r`), `iSwatch` (vec3, linear RGB), `iLayer` (float, dynamic),
`iArt` (float, dynamic cross-fade). 52 bytes per cell; **1.42 MiB** for all 28,587 cards.

The vertex shader builds `north = cross(east, n)` and places the quad at `n · radius · 1.006`, lifted
just off the globe so it beats depth precision at system distance, with edges pulled in to 0.93 so
the tiling reads as masonry with grout rather than as a skin.

> **Normative — the winding.** The base quad's index order is **`[0, 2, 1, 0, 3, 2]`** — clockwise
> in the quad's own x-y plane. It is not a typo and must not be "tidied" to `[0, 1, 2, 0, 2, 3]`.
> With `east` as the quad's +x and `north = cross(east, n)` as its +y, the geometric normal of the
> counter-clockwise order is `east × north = −n`: every front-facing cell is back-face culled and
> the only survivors are the far hemisphere, seen from inside. **Both of its failure modes lie.**
> With the globe hidden, the far hemisphere fills the silhouette and reads as a perfectly complete
> mosaic. With the globe drawn, it reads as a depth-precision fight between two shells at 1.004×.
> This cost an hour in the prototype and will cost it again. Pin it with a unit test on the index
> buffer, not with a comment.

**Shading.** Swatches are shaded; art is not.

```
shade   = clamp(dot(n, light) · 0.5 + 0.5, 0, 1)      // wrapped lambert — a hard terminator
shade   = 0.10 + 0.95 · shade²                        //   across a mosaic reads as a bug
colour  = swatch · shade + ambient
colour  = mix(colour, art, iArt)                      // art enters at full value, unshaded
```

> **Normative — compliance is in this shader, not in a follow-up.** The lambert term is a brightness
> shift, which Scryfall's terms forbid applying to card images, and review §4.4 flags the shipped
> planet shader for doing it. So the shade multiplies the *swatch* only and a cell that has resolved
> to art is flat-lit on purpose. The art is letterboxed into its layer, never cropped or stretched.

### 1.5 LOD: baked equirect far, cells near

At system distance Dominaria's cells are **1.4 CSS px** (`captures.json`, `system`). 28,587 quads at
sub-pixel size is not a cost problem — it is an aliasing problem, and a sub-pixel quad sheet
shimmers under any camera motion.

So every world carries a **256×128 baked swatch texture**, one layer of a `DataArrayTexture` with
one layer per world with cards — 29 layers on production, 256·128·4·29 = 3,801,088 B = **3.62 MiB**
(3.80 decimal MB), which is review §4.2's "~4 MB for all worlds". Units here and in §1.12 are **MiB**
throughout, because `gpuMemory.ts:29` sets `MEGABYTE = 1024 * 1024` and the budget these are checked
against is that one.

> **Normative — the bake is client-side, at load, in the worker.** It is a pure function of
> `swatches.bin` (§2.2) plus the surface law, which both sides already have; shipping it as a
> pipeline artefact would add a fourth binary and a fourth budget row to buy nothing. Rasterising
> 28,587 cells into 29 layers is one pass over the swatch buffer.

**Crossover.** Below **4 CSS px** median cell height a world draws as §1.2 step 2 — one instance of
the system icosphere mesh, textured from its equirect layer — and its cell sheet is skipped
entirely; above **8 px** it draws as the cell sheet (step 4); between the two both draw and
cross-fade on the same `iArt`-style mix. The band, not a hard switch, is what stops a pop on
approach. A world below the crossover costs one instance in an existing draw and no per-cell CPU
work. **This crossover is the scene's only LOD partition** (§1.2): any number of worlds may be above
it at once.

Far below the crossover the equirect layer stops carrying information — at the home view a world is
a few pixels across, the sampler returns something close to the layer's own mean, and a mean over a
balanced colour pie is grey for every plane (§1.8). So a distant instance mixes from its equirect
sample toward §1.8's stretched palette-deviation tint as its on-screen radius falls below **6 px**.
That is where §1.8's ×3.2 stretch lives and the only place it applies.

### 1.6 The art stream

`art_crop` letterboxed into 128×96 layers of a `TEXTURE_2D_ARRAY`, uploaded one layer at a time with
`renderer.copyTextureToTexture(source, target, null, new Vector3(0, 0, layer))` — a `texSubImage3D`
of one layer, so streaming a card in never re-uploads the pool. That argument is the whole reason
the pool is an array texture and not an atlas canvas.

> **Normative — a `DataArrayTexture` ignores `UNPACK_FLIP_Y_WEBGL`.** Flip V in the fragment shader
> (`1.0 - vUv.y`), not on upload.

> **Normative — the layer pool needs three states, not two.** `key >= 0` resident, `FREE = -1`,
> **`RESERVED = -2`**. Without the third state a layer claimed by an in-flight fetch still reads
> free, two loads claim it, one silently overwrites the other, and the resident count climbs *past*
> the pool size. The prototype observed 1,031 resident in a 1,024-layer pool; that impossible number
> is the only tell. Assert `resident <= layers` in the pool's own unit test.

> **Normative — query `MAX_ARRAY_TEXTURE_LAYERS` and clamp.** WebGL 2's *specification minimum* is
> **256**, not 1,024. W4.1's `capabilities.ts` asserts only `>= 72` (it was sized for the printing
> spheres, which concept B deletes, and it names W4.4 as its own successor). The worlds path must
> read the real limit and clamp the pool to `min(tierLayers, maxLayers − 32)`. A pool that silently
> fails to allocate is a black world.
>
> **Normative — the clamp needs a floor, because `maxLayers` can be 0 (DEC-749).** W4.1's
> `capabilities.ts` (PR #45) reports `maxArrayTextureLayers` as **0**, not as a large number, on two
> reachable paths: a non-WebGL2 context (`webgl2 ? getParameter(...) : 0`) and a context that has
> been lost, where `numberParameter`'s `try/catch` returns its `0` fallback. `min(tierLayers,
> 0 − 32)` is **−32 layers at every tier**, so the formula as written turns the one case it exists to
> protect into a negative allocation. The pool size is
> `max(0, min(tierLayers, maxLayers − 32))`, and a pool of 0 is a legal, swatch-only world — which is
> what §1.4's shading path already degrades to when no cell holds a layer — not a black one. R1 reads
> `arrayLayersAffordable` / `webgl2` to decide *whether* to build the pool at all, and never
> subtracts from an unanswered limit. Assert the 0 case in the pool's unit test alongside
> `resident <= layers`; on this Mac the limit is slack and neither bound can bind, so an
> injected-limit test is the only thing that can fail here (DEC-739's vacuous-clamp finding).
>
> **The −32 is driver slack, not accounting.** `MAX_ARRAY_TEXTURE_LAYERS` is a **per-array-texture**
> limit, not a global layer pool: the 29-layer equirect array is a separate texture object and takes
> nothing from the art pool's allowance. Sitting one notch below an implementation's stated maximum
> is cheap insurance (1.5 MiB at tier 0) against drivers that report a limit they will not actually
> allocate at 128×96×4; it is not headroom being reserved for anything. **Knock-on:** on a
> spec-minimum 256-layer device tiers 0, 1, 2 and 3 all clamp to 224, so §1.12's ladder assertion
> must be written against the *clamped* value, not against the tier constant.

**Selection.** Each frame, for every cell on a world above the LOD crossover: reject if
`dot(normal, toCamera) <= 0.12`; reject if off-screen — transform by `camera.matrixWorldInverse`,
reject `z > -camera.near`, *then* apply `camera.projectionMatrix` and require `|x| <= 2, |y| <= 2`.

> **Normative — `Vector3.applyMatrix4` already divides by w.** You cannot recover w from `.z` for a
> frustum test. The view-space rejection must happen before the projection, or a point behind the
> eye divides by a negative w and folds back into the frame.

Facing alone is not enough to decide who gets a layer: at the prototype's near view 2,753 cells face
the camera, the pool holds 1,024, and half of those are behind the viewer's shoulder or over the
horizon.

**The adaptive threshold — this spec's one substantive change to the prototype.** The prototype asks
for art whenever a cell exceeds 24 CSS px and lets the pool run out. The measured consequence at
`tether-surface` is **1,024 drawn against 2,759 wanted, with 925 evictions**: the visible swatch/art
boundary in that frame is the budget being exhausted, and the churn behind it is ~1,900 `art_crop`
fetches (≈ 170 MB) for one camera pose.

> **Normative.** The effective art threshold is a **per-frame quantile**, not a constant. Maintain a
> 64-bucket histogram of the on-screen pixel heights of wanting cells (one pass, no sort). If the
> count above 24 px exceeds the pool capacity, raise the effective threshold to the bucket at which
> the running count crosses capacity, with one bucket of hysteresis so the boundary does not
> oscillate. The result is the same picture — a ring of art around the sub-camera point — reached by
> design rather than by exhaustion, with a bounded fetch count and near-zero steady-state eviction.
> Acceptance criterion **W4** (§3.1) measures exactly this.

> **Normative — ship the seam that turns the quantile off: `?artThreshold=fixed24`.** It restores
> the prototype's behaviour exactly — a constant 24 CSS px threshold, no histogram, no hysteresis,
> let the pool run out — and it is W4's negative control (§3.1). This has to be a seam in the
> shipped renderer rather than a patched build, for the reason §3.1 gives: W4's whole subject is the
> *absence* of exhaustion, and the only frame known to exhaust is the prototype's `tether-surface`.
> Note what the control may **not** be: shrinking the pool does not work. The threshold is defined
> relative to pool capacity, so a smaller pool simply raises the threshold and the criterion passes.
> Starving the resource the policy adapts to makes the criterion GREEN; the control has to starve
> the **policy**.

Fetch discipline: `mode: 'cors'`, `credentials: 'omit'`, at most 6 concurrent (PRD 7.2's politeness
cap — the `*.scryfall.io` origins have no rate limit, `docs/scryfall-policy.md` §4, but the cap is
worth keeping), cache-busted by the contract's own `imageTs`, a failed key never retried in the same
session, and a per-session byte budget that degrades to swatch-only when exceeded. Eviction is LRU
with a 30-frame grace: a layer wanted this frame is never evicted.

### 1.7 Lighting and the atmosphere rim

> **Normative — the key light is camera-relative**, offset +0.72 rad in azimuth and +0.38 rad in
> elevation from the view direction. A fixed world-space sun is more honest to a solar system and
> useless for looking at a map: with the camera free to orbit, the subject is on its own night side
> half the time and half of every capture set is black. This is a stated fake in the prototype and
> it is **promoted to a product decision here** — see §5, Q6, because it is the one place where the
> spec chooses legibility over the space metaphor and the owner may want the other answer.

The rim is an additive `BackSide` sphere at 1.055× radius with a fresnel falloff (`pow(1 - |n·v|,
2.6)`), tinted by the plane's `nebulaTint`, `depthWrite: false`. Every world that is drawn at all
gets one; it is what replaces full-scene bloom.

### 1.8 The system: undetailed worlds, dark moons, the belt

**Undetailed worlds.** The step-2 `InstancedMesh` of icospheres, one instance per plane below the
LOD crossover, scaled by the same `0.126·√N` law. Its colour comes from the world's equirect layer
(§1.5) and, below 6 px of on-screen radius, from `planes.json`'s own `palette` — a real
WUBRG-multi-colourless weight vector, so the colour at system distance is a statistic of the plane's
cards. At the home view that is all **29** worlds; with one world near enough for its cell sheet it
is 28.

> Mixed straight, all 29 come out the same grey, because Magic's colour pie is balanced — the same
> finding that makes the shipped arm-skew law inert (review §4.1). So the mix runs on the
> **deviation from the card-weighted multiverse mean**, amplified ×3.2: a plane at the average is
> grey, a plane that is unusual is unusual in the direction it is unusual in. Alara's 58% gold and
> Ravnica's 39% multicolour are what this exists to show. The stretch is a choice; the grey is the
> data. Undetailed worlds are additionally dimmed to 0.3 so a neighbour does not outshine the world
> being looked at.

**Dark moons.** `√0 = 0`, so the 57 empty planes take a floor radius of 0.55 and a near-black colour
(0.035, 0.038, 0.05) with no palette tint. **Present, unlit, and unlabelled until hover.** Today they
are dim glows that PRD 5.3.8 obliges the app to label, which is how the home view ends up as 82
labels over 30 real objects (review §4.1). Emptiness becomes a colour and not a size.

> This needs a **PRD 5.3.8 amendment** (§6) and it is measured by acceptance criterion **W5** (§3.1).

**The belt.** The Blind Eternities — 4,980 cards, 17.4% of everything, the largest population after
Dominaria — stops pretending to have a shape and becomes a belt around the whole system at
**1.12 × `multiverseRadius`** (145.6 units on production). One arc per set, in chronological order,
each set taking its share of 360° with a 6% gap at each end so "one arc per set" is legible rather
than a continuous smear. Radial jitter ±6%, vertical jitter ±3.5% of the belt radius, both from a
deterministic hash — a mathematically clean ring reads as a UI element, not as debris. Colour is a
year ramp, HSL hue 0.62 → 0.0, cold at 1993 to warm at 2026.

> **Normative — `sizeAttenuation: false`, size 2 px.** The belt sits at 1.12 R and Dominaria's
> `home` is 108.8 units out, so a fly-in puts belt points a few units from the eye. With attenuation
> on they become ~70 px squares, which looks exactly like "the cells are drawn in the wrong place"
> and sent the prototype hunting the wrong bug for an afternoon. Constant 2 px is also what review
> §4.3 asks of stars generally: small and sharp, never bokeh.

### 1.9 The surface-following tether

The claim is that the tether stops being a line between two dots and becomes a thing anchored to
ground. Each end has two directions: the **anchor**, wherever the reticle points when the camera is
close, and the **exit**, the sub-point facing the other world. The curve is a great-circle run across
the surface from anchor to exit, a Bézier through space to the far world's exit, then its surface run
in reverse. When the camera is far the anchor relaxes onto the exit and the surface runs collapse to
nothing — the far-field behaviour you want, at no special case.

Geometry: 24 samples per surface run, 96 across the span, 144 total. Drawn as a **camera-facing
ribbon of constant CSS-pixel width** (2.1 px half-width, flaring ×2.0 at the two anchors), not as
`LineSegments`: line width is the one primitive parameter WebGL is allowed to ignore, and at constant
width the tether is invisible over a surface of card art — the flare and the two glowing anchor pads
are what make it read as footed into ground rather than laid across a photograph.

### 1.10 The flat printing ring

Replaces the 72 printing spheres (PRD 5.6.7–5.6.8, `web/src/scene/cards/planets.ts`,
`web/src/scene/tuning.ts:236-247`). Printings orbit the focused card as flat `small` quads at their own aspect
ratio, ordered by release date, one revolution per 60 s, the active printing marked by a brighter rim.

This resolves review §10 Q3 and the §4.4 distortion finding in one move: a flat quad showing a full
`small` card is undistorted, unshaded, and satisfies Scryfall's alternative attribution clause
without needing the artist beside it.

**The cap, and the one thing it actually hides.** PRD 5.6.8 caps at 72 (three rings of 24).
`planets.ts:48` computes `const shown = Math.min(printings, PLANET_CAP)`, and the remainder is *not*
dropped: `planets.ts:35-37` declares `overflow` — "Printings past the 72 the rings can hold. PRD
5.6.8 sends these to the card panel" — `planetLayout` returns it, `focusedCard.ts:261` exposes it as
`printingOverflow`, and `ui/CardPanel.tsx:181` already renders `Printings ({printings.length})`, the
true count, with `:184` listing **every** printing uncapped. All 570 Swamp rows are in the panel
today. So "the card panel states the true count" is not a requirement this spec introduces; it
shipped.

Counted over all 93 production shards, the cap binds on **5 cards** — the five basic lands, Swamp
570, Mountain 565, Forest 563, Plains 537, Island 535 — and nothing else comes within 12 of it (next
is Sol Ring at 60). It is a five-card edge case, not a 669-card one; 669 is the count of cards with
more than **9** printings, a different predicate.

What is genuinely missing is the visual tie between the ring and the tail: nothing in the scene
marks *which* printings the ring dropped, or that it dropped any. The ring inherits the cap for v1 —
this spec does not widen product scope — and adds only that: **when printings exceed the cap, the
ring shows the cap's worth as quads and the remainder as 1 px ticks at their own release angle.**
The ticks are the requirement; the panel already holds up its end. On production this draws on five
cards, so it is cheap to build and cheap to get wrong unnoticed — pin it with a unit test on the
tick positions, not with a capture. See §5, Q5.

### 1.11 Picking, labels, filters

- **Picking.** The id-buffer picker is kept wholesale; only its subject changes. The cell sheet
  renders `gl_InstanceID + 1` into the pick target, and the instance index maps to a card through
  the same instance-order array the sheet is built from. Cell picking replaces star picking at plane
  level; card focus and the printing ring pick as they do today.
- **Labels.** The label solver is kept. Under worlds it has 30 subjects at the home view instead of
  87, because the 57 moons are unlabelled until hover (§1.8). The label tick stays after the final
  camera matrices, per W4.2.
- **Filters.** The GPU filter-mask subscription W1.2 landed (review F1) is kept and rebound: a
  filtered-out cell drops to its swatch and dims, and **never** dims its art. Dimming a card image is
  a colour shift, which Scryfall's terms forbid and `docs/scryfall-policy.md` §5 already calls out as
  a Phase 2a/3 constraint. Under worlds the rule is simpler than it was for thumbnails: a filtered
  cell never resolves to art at all.

### 1.12 GPU memory and the quality ladder

PRD 7.2's GPU budget is ≤ 96 MB target / 160 MB ceiling (`web/src/scene/cards/gpuMemory.ts`). Today
the 64 MB thumbnail atlas dominates it. Concept B **retires the atlas** — the card-sheet tier it
feeds is what the world surface replaces — and spends the room on the art pool instead:

**Units are MiB.** `gpuMemory.ts:29` sets `MEGABYTE = 1024 * 1024`, so 96/160 are MiB and so is the
83 MB worst case this is compared against; a table that mixed decimal MB into it would not be
comparable to the thing it is being compared to.

| Resident texture | Bytes | MiB |
|---|---|---|
| Art pool, 1,024 × 128 × 96 × 4, no mips | 50,331,648 | 48.00 |
| Equirect swatch array, 29 × 256 × 128 × 4 | 3,801,088 | 3.62 |
| Cell instance attributes, 28,587 × 52 B | 1,486,524 | 1.42 |
| Printing ring, 72 × `small` (146×204×4) | 8,577,792 | 8.18 |
| Focused card, `large` (672×936×4), one face | 2,515,968 | 2.40 |
| **Total** | **66,713,020** | **63.62** |

Under target with **32.4 MiB** of headroom, and **lower than today's worst case** — which is the
first place concept B pays for itself rather than costing.

> The focused-card row counts one face. Today's worst case counts two, because a double-faced card
> uploads both (`focusedCard.ts:752`, and `worstCaseCardBytes` multiplies by 2). A DFC in focus adds
> 2.40 MiB for **66.02 MiB** and 30.0 MiB of headroom; the conclusion is untouched either way, but
> the DFC figure is the one to assert against, because it is the one `gpuMemory.ts` computes.

The art pool is the worlds path's contribution to W4.1's quality ladder, and it is a real rung at
every step:

| Tier | Art pool layers | MiB | Other |
|---|---|---|---|
| 0 | 1,024 | 48.00 | dpr cap 1.5 |
| 1 | 1,024 | 48.00 | dpr cap 1.0 |
| 2 | 512 | 24.00 | — |
| 3 | 256 | 12.00 | LOD crossover 4 px → 8 px |
| 4 | 128 | 6.00 | cheap rim (one tap, no dither) |

All five are clamped by `max(0, min(tierLayers, MAX_ARRAY_TEXTURE_LAYERS − 32))` (§1.6 — the outer
`max` is load-bearing: an unanswered limit reports 0 and the inner expression is then −32). `e2e/quality.spec.ts`
must assert the pool size actually changes with the tier, the way W4.1 asserts its own rungs — and
it must assert against the **clamped** value the renderer reports, not against the constant in this
table. On a spec-minimum 256-layer device tiers 0–3 all clamp to 224 and only tier 4 is distinct, so
an assertion written against the tier constants passes on this Mac and fails on the hardware W0.1 is
about to measure.

### 1.13 The prototype's traps, as a checklist

Every one of these cost real time in the prototype and every one of them is silent:

| # | Trap | Where it bites |
|---|---|---|
| 1 | Quad winding `[0,2,1, 0,3,2]`; CCW faces inward and *both* failure modes look like something else | §1.4 |
| 2 | `Vector3.applyMatrix4` already divides by w — view-space reject before projecting | §1.6 |
| 3 | `PointsMaterial` with `sizeAttenuation: true` makes belt points 70 px squares on a fly-in | §1.8 |
| 4 | An LRU layer pool needs `RESERVED`; two states let two loads claim one layer and `resident` climbs past the pool size | §1.6 |
| 5 | A `DataArrayTexture` ignores `UNPACK_FLIP_Y_WEBGL` — flip V in the shader | §1.6 |
| 6 | A fixed world-space light puts the subject on its night side half the time | §1.7 |
| 7 | `MAX_ARRAY_TEXTURE_LAYERS` has a spec minimum of 256, not 1,024 | §1.6 |
| 7b | …and W4.1 reports it as **0** on a WebGL1 or lost context, so `maxLayers − 32` is −32 layers | §1.6 |
| 9 | `iSize` is arc length: drop `sin θ` from the longitudinal half-extent and the polar row is 51.6× too wide | §2.1 |
| 10 | `θ` is colatitude everywhere; read as latitude the row formula sums to 0 cells | §1.3 |
| 8 | `renderer.copyTextureToTexture` changed argument order at three r165 | §1.6 |

---

## 2. Pipeline and data contract

**One contract bump, `contractVersion` 2 → 3, carrying all of it**: new `stars.bin` semantics, the
new `swatches.bin`, and the `artist` field. Review §4.5 notes that layout is baked into the
artefacts, so every concept is a pipeline re-run plus a data PR; only an artist field or a per-star
colour is a version bump. Both of those are here, so they ride together.

> **The dual-scene period is free, and this is why.** Data directories are content-hashed and
> immutable, and `web/datasets.json` names which one a build uses, with `active` already separate
> from `production`. A v3 dataset is a *new directory*. The galaxy build keeps pointing at the last
> v2 dataset and is not touched; the worlds build points at the v3 one. So the pipeline leg can land,
> run, and publish a full v3 dataset with **zero risk to what is deployed**, long before any renderer
> work exists. §4 sequences on this.

### 2.1 `stars.bin` — same bytes, new semantics

The 12-byte record and the 16-byte header are unchanged, and so is the interleaved stride-12 upload.
What changes is what bytes 0–5 mean.

| Offset | Field | v2 | v3 |
|---|---|---|---|
| 0–5 | `x, y, z` float16 | plane-local position within frame radius 1.2 | **unit-sphere cell centre**, `|p| = 1`, for a plane with cards; belt position for dust, normalised the same way |
| 6 | `planeIndex` | unchanged | unchanged |
| 7 | `colour` | `hueClass` bits 0–2, `colourIdentity` bits 3–7 | unchanged — and still the thing a reader must mask (`colourByte.ts` owns both masks) |
| 8 | `sizeClass` | rarity | unchanged, unread by the worlds renderer |
| 9 | `brightness` | quantised log printing count | unchanged, unread by the worlds renderer |
| 10 | `twinklePhase` | twinkle phase | **reserved, written 0** — there is no twinkle |
| 11 | `typeMask` | card-type bits | unchanged; the type facet still reads it |

Bytes 8–9 stay written rather than being reclaimed, so that a v3 dataset would still render on the
galaxy path if the dual-scene period ever needs it. Reclaiming them is a v4 conversation.

**Derivation on the client.** The unit-sphere point gives the cell centre and, through
`east = normalize(cross(Y, n))`, its tangent frame. It does **not** give the cell's half-extents.
In **angle**, for a cell in row `r`, they are `(π / rowCells[r], dφ / 2)`.

> **Normative — `iSize` is arc length, not angle, and the longitudinal component carries `sin θ_r`.**
> §1.4's `iSize` is in **units of world radius**; the pair above is in **angle**. The two differ by
> the conversion from an angle to the arc it subtends, and that conversion is not the same on both
> axes. A row is a small circle of radius `sin θ_r`, not a great circle, so a longitude angle `Δλ`
> subtends `Δλ·sin θ_r` of surface; a colatitude angle subtends itself. Therefore
>
> ```
> iSize = vec2( (π / rowCells[r]) · sin θ_r ,   dφ / 2 )
> //                               ^^^^^^^^^ dropping this is the bug below
> ```
>
> **Dropping the factor draws Dominaria's polar row 51.6× too wide** — `rowCells[0] = 2`, so the
> uncorrected half-extent is `π/2 = 1.571` *world radii*, a quad wider than the globe it sits on,
> against a correct `0.0305`. The tell is geometric and total, not a subtle stretch.
>
> The conversion is also exactly what makes §1.3's **4:3 cell aspect** true. A cell's full width over
> its full height is `2π·sin θ_r / (rowCells[r]·dφ)`, and since `rowCells[r] ≈ 2π·sin θ_r/(aspect·dφ)`
> that ratio is `aspect` at every latitude — measured 1.31–1.35 across Dominaria's 81 rows. Without
> the factor the same ratio is `aspect / sin θ_r`: **81.0 at the pole**. The two bugs are one bug.
>
> **Where the aspect law genuinely cannot hold** is the polar rows, and it is integer quantisation
> rather than this conversion: `rowCells` is a whole number, and at `rowCells = 2` the aspect is
> `π/2 = 1.571`, 18% above 4:3. That is **4 cells of Dominaria's 6,266** (0.1%) and 4 of Rabiah's
> (5.1%). The renderer must therefore letterbox art into the cell's **own** rect (§1.4, §1.6) and
> may not assume 4:3 anywhere; a shader that hard-codes the ratio mis-frames the ice caps of every
> small plane.

> **Normative — the per-row cell counts are shipped, not derived.** §1.3's relaxation makes a row's
> cell count population-derived, so it is **not** a function of `cardCount` and a row count and the
> closed form `round(2π·cos φ / (aspect·dφ))` no longer describes the shipped grid (Rabiah: 78 slots
> from the closed form, 75 cells in fact). The v3 contract therefore carries a per-plane **`rowCells`
> table** — one `uint` cell count per row, in north-to-south order — in place of the scalar `rows`
> (§2.4). `rowCells.length` is the row count; row latitudes are equal-`dφ` with `dφ = π /
> rowCells.length` and centres at `(i + ½)·dφ` (§1.3), so the client's only remaining derivation is
> matching a cell to its row by latitude.

Counting stars per row would also recover the counts, and would be sound — but only *because* §1.3
mandates zero bare cells. The table is 734 numbers across all 29 production worlds (81 for
Dominaria, 162 B as `uint16`, ≈ 3 KB raw as JSON against `planes.json`'s 11.6 KB brotli), which is
too cheap to buy a contract whose correctness depends on a rendering invariant holding forever. The
counting path is kept as a **check** rather than as the mechanism: the pipeline asserts per plane
that the stars it emitted group into exactly `rowCells`, which is what makes "zero bare" verifiable
at the artefact rather than load-bearing and invisible.

> **Normative — match the nearest row, never `floor()`.** float16 spacing on `[0.5, 1)` is
> 2⁻¹¹ = **4.883 × 10⁻⁴** (round-trip error ≤ 2.44 × 10⁻⁴). For Dominaria — `dφ = √(4π/((4/3)·6266))`
> = 0.038783, 81 rows — the latitude gap between the two polar rows is
> `cos(½dφ) − cos(³⁄₂dφ)` = **1.504 × 10⁻³** in `sin φ`, a margin of **3.08×**; at the equator the
> gap is ≈ `dφ` = **0.0388**, a margin of 79×. Nearest-row matching tolerates twice the error a
> `floor()` does, and at 3.08× at the pole that factor of two is the whole safety margin — this is
> 23% tighter than an earlier draft of this section claimed, which is more reason to forbid
> `floor()`, not less. The pipeline asserts on every emitted star that the float16 round-trip of `y`
> still resolves to the row it was generated from. The contract test vector pins one complete small
> world — every slot, every band, every set slice, and its `rowCells`.

**New pipeline invariant tests** (`pipeline/tests/test_pipeline_invariants.py`):

- every star's position is unit length within float16 tolerance;
- every card lands on a cell whose band matches its colour class and whose longitude falls in its own
  set's slice — **zero displaced, zero bare** (§1.3);
- cell count equals card count per plane, and the emitted stars group by nearest row into exactly
  the plane's shipped `rowCells` (§2.4) — the check that makes "zero bare" verifiable at the
  artefact;
- the band area fractions equal the plane's colour-class fractions within 1%;
- the dust plane's stars lie in the belt's radial and vertical bounds.

**Retired laws.** `layout.py`'s spiral machinery goes with the galaxy: arm generation and
`arm_width_scale` (inert on every plane over 500 cards — review §4.1), `BULGE_SCALE`, the chronology
*radius* mapping of PRD 5.4.2 (chronology becomes longitude), shear, bar and disc thickness. Review
§6.1 group D's dead pipeline code (`hue_of`, `iter_star_offsets`, the unread `AssemblyStats` fields)
should go in the same pass.

### 2.2 `swatches.bin` — the new artefact

The enabler for the whole concept: a per-card colour derived from the *art*. The contract carries
`hueClass` today, which is a seven-way classification of colour identity, not a pixel statistic —
which is why the prototype had to fake it, and why the fake is the thing to be most sceptical of in
the W2.3 captures.

```
16-byte standard header: magic ETRN, kind = 3, contractVersion = 3, flags = 0,
                         recordCount = starCount, reserved = 0
then: starCount × 8 bytes, in star order (the same order as ORACLE_IDS)
      4 × uint16 RGB565, the card's art downsampled to 2×2:
      [top-left, top-right, bottom-left, bottom-right]
```

Star order means a swatch lookup is `starIndex × 8 + 16` with no map and no table. Size on production:
28,587 × 8 + 16 = **223.4 KB raw**.

> **Normative — `swatches.bin` is a separate artefact and must not become a section of `sets.bin`.**
> `sets.bin` is a sectioned container and adding section id 4 would be the tidier-looking choice. It
> is the wrong one: PRD 7.2 budgets the pair `search.json` + `sets.bin` at ≤ 700 KB target, and that
> pair is at **668.5 KB — 95% of target** on production today (`docs/data-contract.md` §8). Another
> ~200 KB puts it at ~870 KB: 24% *over* the reported target, though still well under the 1.5 MB
> ceiling, which is the only one of the two that fails the build (`docs/data-contract.md` §8:
> "Only the 1.5 MB ceiling fails the build; the target is reported"). So this would overshoot a
> reported target rather than break one — and that is still the wrong trade, because it spends the
> project's one genuinely tight row to save a file. As its own file fetched with `stars.bin`, it
> lands on the *before-intro* row instead: 253.9 KB → ≈ 455 KB against a 3 MB target (§2.5).

**Which image the swatch comes from is an open question (§5, Q1).** Review §4.2 says fetch each
card's `small`. `small` is the whole card — frame, border, text box — so a 2×2 of it is dominated by
frame colour, which is the colour identity, which is `hueClass` again: the statistic would be nearly
as inert as the one it replaces. `art_crop` is the honest source and costs ~9× the bytes. §5 carries
the trade-off and this spec's recommendation.

Fetch discipline either way: **once per card, cached by `imageTs`**, 6 concurrent, resumable, and
stored in a pipeline-side cache keyed by `(id, imageTs)` so a refresh re-fetches only what Scryfall
actually changed. An 8-byte colour statistic is not a repackaging, a republication or a proxy of
Scryfall data (review §4.4).

### 2.3 `artist` on the printing tuple

The printing tuple gains a sixth element:

```jsonc
"p": [["91fdb56b-…", 12, "u", 1783903215, "266", "Mark Tedin"]]
//     id            setId rarity imageTs  collector artist
```

`""` where Scryfall has no artist. Per printing, not per card, because art differs between printings.

> **Normative — the artist is an inline string, not an id into a dictionary.** A global artist
> dictionary is the smaller encoding, but the only sensible home for it is `search.json`, which is
> half of the 95%-full pair above. The shards have 4.4× headroom: the largest production shard is
> 1,212.7 KB raw / 339.8 KB brotli against a 1.5 MB target and a 2.5 MB ceiling. Put the cost where
> the headroom is.

Cost: 73,193 printings across the production dataset, ≈ 17 bytes each ≈ **1.2 MB raw across all 93
shards**, ≈ 87 KB raw on the largest — an estimated +20–25 KB brotli on a row with a megabyte of
room.

**Why it is needed at all.** Scryfall asks that an `art_crop` be shown with the artist name and
copyright in the same interface, *or* the full card shown alongside. Today the app satisfies the
alternative clause, because `art_crop` only ever appears on the printing planets orbiting a focused
card that is showing its full `large` image. Concept B shows tens of thousands of art crops with no
card in sight, so the alternative clause no longer applies and the artist must be in the contract.
Review §4.4 is explicit about this and the prototype's own footer states the gap.

**Which printing's art a cell shows:** printing index 0 — the tuple list is ordered by release date,
so index 0 is the first printing, which is what the card's `r` size class already refers to. The
cell's caption therefore credits `p[0][5]`.

### 2.4 `planes.json` — what retires and what arrives

| Field | v3 |
|---|---|
| `home`, `radius`, `tilt`, `spinPeriodS`, `spinDirection`, `driftAmplitude/PeriodS/Phase` | **keep** |
| `palette`, `nebulaTint`, `firstYear`, `lastYear`, `sets`, `cardCount`, `starOffset`, `starCount`, `shardCount`, `index`, `slug`, `displayName`, `notes`, `kind` | **keep** |
| `shearAmplitude`, `shearPeriodS`, `shearPhase` | **retire** — PRD 5.4.13 shear is a spiral-disc law |
| `armPitch`, `bar`, per-plane `discThickness` | **retire** — PRD 8.6.2 seeded spiral params |
| top-level `discThickness` | **retire** |
| `rowCells` *(new, `uint[]`)* | the surface grid's per-row cell counts, north to south. `rowCells.length` is the row count; row latitudes are equal-`dφ`, `dφ = π / rowCells.length`, centres at `(i + ½)·dφ`. Shipped rather than derived because §1.3's relaxation makes the counts population-derived (§2.1). Empty planes and the belt omit it |

`radius` stays but changes meaning: it is now `0.126 · √cardCount`, or the moon floor 0.55 for an
empty plane, and the Blind Eternities keeps `R` for the belt. Seven fields retire and one arrives;
the arriving one is an array, so `planes.json` grows rather than shrinks — 734 numbers across the 29
worlds, ≈ 3 KB raw against 11.6 KB brotli today. Either way it is noise in the budget and is listed
for completeness, not for savings.

### 2.5 Budget summary

| Row | Target | v2 today | v3 estimate |
|---|---|---|---|
| `search.json` + `sets.bin` | 700 KB / 1.5 MB ceiling | 668.5 KB (95%) | **unchanged** |
| First frame (`manifest` + `planes`) | — | 16.2 KB | ≈ 16 KB |
| Before intro (+ `stars.bin`, + `swatches.bin`) | 3 MB | 253.9 KB | ≈ 455 KB (15%) |
| Largest plane shard | 1.5 MB / 2.5 MB ceiling | 339.8 KB | ≈ 365 KB |
| GPU resident (MiB) | 96 / 160 ceiling | 83 worst case | **63.6**, 66.0 with a DFC in focus (§1.12) |

**Basis.** Every KB figure in this table except the GPU row is **encoded transferred size at brotli
11**, which is what `docs/data-contract.md` §8 reports and what `check-budget` compares; the GPU row
is MiB (§1.12). That makes the before-intro estimate an assumption worth stating out loud:
`swatches.bin` is **223.4 KB raw**, and 455 − 253.9 = **201 KB** implies ~90% of it survives brotli.
That is the right expectation for 2×2 RGB565 art statistics — four uncorrelated 16-bit samples per
card, close to incompressible — but it is an estimate doing real work in a budget table, and it is
the estimate to replace with a measurement the moment leg P emits the first `swatches.bin`. The
worst case, zero compression, is 477 KB, still 16% of a 3 MB target, so the row's *conclusion* does
not depend on the assumption. Nothing here needs a budget amendment.

### 2.6 Pipeline work, concretely

1. `contract/` — bump `CONTRACT_VERSION` to 3; add the `swatches.bin` encoder/decoder pair and the
   artist field to the printing tuple on both sides; regenerate `contract/test-vectors/v3/`. The
   byte-level Python↔TypeScript freeze stays the strongest thing in the repo and must stay green.
2. `pipeline/src/eternities/fixtures/layout.py` — replace the spiral generator with the surface law of §1.3,
   including the per-row relaxation that gets displaced to zero.
3. A new image-fetch stage for swatches, with a `(id, imageTs)`-keyed disk cache, resumable, 6
   concurrent, and a report line for cache hits / fetches / failures.
4. `assemble.py` — emit unit-sphere positions and the per-plane `rowCells` table (§2.4); drop the
   retired fields; drop review §6.1 group D's dead code.
5. `report.py` — add the assignment report (exact / displaced / bare per plane, which must read
   `N / 0 / 0`) and the swatch-fetch summary. PRD 9.2's pipeline report is where a data regression
   should be visible.
6. Publish a v3 dataset directory beside the v2 one and add it to `datasets.json` under a new key.
   **Do not move `active`.**

---

## 3. Cutover plan

### 3.1 The acceptance gate that replaces `visual-gate.mjs`

PRD 9.3's criterion 2 — "spiral arms are legible for every plane with ≥ 2,000 cards" — has no meaning
under worlds, and review T7 (§5.5) found that even under concept A it measured geometry rather than
legibility: a lane-width invariant on arm centrelines plus owner-judged captures, with **nothing**
measuring contrast in the rendered frame. The W2.3 decision retires T7 with the galaxy rather than
building it.

So concept B owes a definition of "legible" for a mosaic, and a measurement. This is it:
**`web/scripts/worlds-gate.mjs`**, same puppeteer-core stack as `visual-gate.mjs`, driving the
product route with a `?probe=` seam that reports, per visible cell, its screen-space rect, its band,
and whether it resolved to art, plus the art pool's resident count, effective threshold and eviction
counter. Geometry comes from the probe; **colour is sampled from the captured PNG**, so every
criterion below measures the frame after tonemap and vignette at presentation scale — which is the
thing T7 said was missing.

The gate also depends on **control seams** in the shipped renderer, which is why they are normative
in §1 rather than being a gate-side patch.

> **Normative — seam ownership, and there are five of them, not four (DEC-749).** The five are
> `?probe=`, `?swatch=mean`, `?bands=shuffle`, `?artThreshold=fixed24` (§1.6) and `?layers=N`.
> `?probe=` is one of them: the paragraph above introduces it separately as the gate's geometry
> source, but it is the same kind of object — normative renderer surface the gate reads and does not
> build. **All five are owned by leg R1**, which builds them as part of §1.3–§1.6. **Leg G consumes
> them; it does not build them, and it may not patch the build to get them.** An earlier draft said
> "legs R1 and R3 own them" here while §4's R1 row already listed all five under R1; R1 is the
> ruling, and R3's row (§1.10–§1.12) carries none of them. This matters beyond tidiness: a seam
> built gate-side is a seam that is not in the shipped renderer, and §3.1's whole argument for W4's
> control is that the control must exercise the *shipped* policy.

Five criteria assert. The rest stay owner-judged, because they are about feel and 9.3 never asked for
an assertion there.

| # | Criterion | Measurement | Floor |
|---|---|---|---|
| **W1** | **Cells are resolvable at framing distance.** | At the plane-level settle for each of the **29 worlds**, the median on-screen height of front-facing cells. Not the Blind Eternities: it has cards but no cell sheet (§1.8), so the statistic is undefined there — "every plane with cards" would be 30 and would include it. | **≥ 24 CSS px.** Binds on the largest plane: Dominaria measured 25.3 px at 3× radius. |
| **W2** | **The mosaic reads as tiles, not as a wash.** This is T7's replacement. | Sample the captured frame at the centre of every front-facing cell ≥ 6 px tall, convert to CIELAB. Report the median ΔE to a cell's nearest on-screen neighbour, and the interquartile range of L\*. | **median neighbour ΔE ≥ 6** and **IQR(L\*) ≥ 8**. |
| **W3** | **Latitude reads as colour.** | Group the same samples by band. For every pair of bands adjacent on the sphere where the smaller holds ≥ 5% of the plane's cards, the ΔE between their mean a\*b\*. | **≥ 10** for every such pair. |
| **W4** | **Art resolves without exhausting.** | At the surface view (2.2× radius), after a 5 s settle: the fraction of on-screen front-facing cells above the effective threshold that are showing art, and evictions per second over the last 2 s. | **≥ 90%** showing art, **≤ 5 evictions/s**. |
| **W5** | **The home view is not a wall of labels.** | Count rendered plane labels in the DOM at the home view. | **≤ 30** (29 worlds plus the belt; today it is 82). |

**Owner-judged, carried over from 9.3 unchanged:** motion perceptible within 3 s of arriving at any
level; no aliasing shimmer on slow camera moves (recordings cast at the drawing buffer's own
resolution — half-size is the one scale that hides it, DEC-661); art fade-ins never noticed as
events; the focused card's tilt feels physical; and, new, **the tether reads as footed into ground**.

> **Normative — every criterion ships with a negative control, and `--negative-controls` runs the
> matrix.** A criterion that has never been seen to fail is not an instrument, it is a rubber stamp;
> the same discipline that caught `verify-browser --dataset all` printing "all datasets verified"
> while running two fixtures.

| Criterion | Control | Must go |
|---|---|---|
| W1 | capture at 6× radius instead of the settle (prototype measured 10.1 px there) | **RED** |
| W2 | `?swatch=mean` — every cell takes the plane's mean swatch | **RED** |
| W3 | `?bands=shuffle` — band assignment permuted, grid unchanged | **RED** |
| W4 | `?artThreshold=fixed24` — §1.6's seam: the prototype's constant threshold, no quantile | **RED** |
| W5 | labels forced on for empty planes | **RED** |
| W4 | `?layers=128` — tier 4's pool, unmodified policy | **GREEN** |
| all | the unmodified build on the v3 production dataset | **GREEN** |

**On W4's control specifically.** `fixed24` is the control because it is the configuration the
prototype actually measured failing: at `tether-surface`, 1,024 drawn against 2,759 wanted is **37%
showing art** against W4's 90% floor, and the pose was reached by evicting 925 layers with no sign
of settling — both halves of W4 go red, and they go red for the reason W4 exists.

Shrinking the pool is **not** a control here, and the near-miss is worth writing down because it is
the shape of mistake that survives review. `?layers=128` reads like "pool pinned below demand", but
§1.6 defines demand *relative to pool capacity*: with 128 layers the effective threshold simply
rises until ~128 cells want art, ~128 resolve, and steady-state eviction goes to ~0. W4 measures the
fraction above the *effective* threshold that resolved — ≈100% — and evictions/s — ≈0. The row
passes. **Starving the resource a policy adapts to makes the criterion green; only starving the
policy makes it red.** Worse, 128 layers is **tier 4 of §1.12's ladder**, a shipped configuration: a
row that went red there would be condemning the exact low-end device the ladder exists to protect.
So `?layers=128` stays in the matrix — as an **expected-GREEN** row asserting that tier 4 still
passes W4.

The two green rows are the ones that matter most and the ones most often left out: in a matrix where
everything is red, a broken baseline scores identically to a perfect guard. **Only the rows expected
to stay green can falsify the instrument.**

The gate runs at 1920×1080 CSS, dpr 1 — true CSS scale, never an upscaled crop (DEC-683), and the
native resolution of the Iris Xe laptop review §9 targets, so a Windows re-capture is directly
comparable. It is added to `docs/refresh-runbook.md` as the per-refresh instrument in the same place
`visual-gate.mjs` occupies today.

### 3.2 When the galaxy retires

The galaxy ships until **all four** of these hold:

1. `worlds-gate.mjs` passes W1–W5 on the v3 production dataset, with the negative-control matrix
   showing the expected **five red and two green** (§3.1);
2. the owner accepts the judged criteria of §3.1 on the capture set;
3. the W0.1 Windows field reports confirm concept B's cost class on the Iris Xe and the 780M — or the
   owner explicitly waives the hardware gate. This is the outstanding item the W2.3 record names, and
   concept B's "A far / B near" is still an estimate from a Mac;
4. the worlds build reaches feature parity on the shipped surfaces: search, filters, deep links,
   plane index, card focus, printing ring, attract mode, reduced motion, a11y.

Until then the two coexist at zero cost, on two dataset directories (§2). Dataset refreshes in the
interim keep running `visual-gate.mjs` per `docs/refresh-runbook.md`.

At cutover, in one PR: `datasets.json`'s `active` moves to the v3 directory; the galaxy scene, the
spiral laws, the star shaders, the thumbnail atlas and the card-sheet tier are deleted; PRD §5 and §9
are amended (§6); and the v2 dataset directories are removed from `web/public/data/`.

### 3.3 The archival tag

Review §6.1 group C left `visual-gate.mjs` (1,195 LOC) and `lib/status-panel.mjs` (147) as maintained
tooling for as long as the galaxy stands — `verify-browser.mjs`, `cross-browser.mjs` and
`arm-lane-capture.mjs` were archived by DEC-708 under **`review-tooling-2026-09`**, and the DEC-714
diagnostics under **`review-tooling-2026-09-dec714`**.

> **At cutover, tag the last commit on which the galaxy scene and `visual-gate.mjs` both still exist
> as `galaxy-cutover`, then delete in the next commit.** What goes: `scripts/visual-gate.mjs`,
> `scripts/lib/status-panel.mjs`, `scripts/alloc-probe.mjs`, `scripts/dec697-diag.mjs`. What stays:
> `check-budget.mjs`, `bench.mjs`, `write-vercel-json.mjs`, the e2e suite, and the new
> `worlds-gate.mjs`. `puppeteer-core` stays for `bench.mjs` and the new gate.

Tag the commit, do not keep the code: the scripts stay retrievable, and a dead 1,195-line script in
the tree is read as maintained tooling by the next person.

---

## 4. Sequencing and staffing

Five legs, ≈ **18 engineer-days**. The critical path is R1 → R2/R3 → G; leg P is entirely off it.

| Leg | Content | Days | Starts | Role |
|---|---|---|---|---|
| **P — pipeline and contract** | §2 in full: contract v3, `swatches.bin`, `artist`, the surface law in Python, the swatch fetch stage, invariants, report lines, a published v3 dataset | **4** | **now — no renderer dependency at all** | pipeline/data engineer |
| **R1 — renderer core** | §1.3–§1.6: surface law on the client, the cell sheet, the equirect bake and LOD crossover, the art pool with the three-state LRU and the adaptive threshold — **including the `?probe=`, `?swatch=mean`, `?bands=shuffle`, `?artThreshold=fixed24` and `?layers=N` seams §3.1's gate is built on** | **5** | on W4.2's merge | graphics engineer (prototype author) |
| **R2 — system, belt, tether** | §1.7–§1.9: undetailed worlds, dark moons, the belt, the atmosphere rim, the surface-following tether | **3** | on R1's merge | graphics engineer |
| **R3 — product surfaces** | §1.10–§1.12: the flat printing ring, picking, labels, filters, GPU budget and the ladder rungs, feature parity | **3** | on R1's merge, parallel with R2 | frontend engineer |
| **G — gate and cutover** | §3: `worlds-gate.mjs`, the negative-control matrix, runbook and PRD amendments, the archival tag | **3** | on R1's merge (needs the probe seam), lands after R3 | the engineer who built `visual-gate.mjs` |

**What can start before W4.2 merges: all of leg P, and nothing else.** That is 4 of the 18 days, and
it is the leg with the longest wall-clock tail — the swatch fetch is tens of thousands of HTTP
requests — so starting it now is worth more than its day count suggests. It also de-risks everything
downstream: R1 cannot be honestly built against faked swatches, and the prototype's own README names
the fake swatch as the thing to be most sceptical of.

**Why R1 cannot start early.** It is the leg that lives inside the tick order, the pass list and the
platform layer, all three of which W4.1 and W4.2 are actively rewriting. Starting it against today's
r3f loop would mean building it twice.

Reviewer assignments are the CEO's to make; the only constraint this spec asserts is the standing one
— **the reviewer is never the implementer**, so leg G is not reviewed by whoever writes it and legs
R1/R2 are not reviewed by the prototype author.

---

## 5. Open design questions for the owner

Six, batched. Each carries a recommendation, so none of them blocks: if no answer comes, the
recommendation is what gets built.

**Q1 — Which image is the swatch computed from?** Review §4.2 says `small`. But `small` is the whole
card, so a 2×2 of it is dominated by frame and border colour — which *is* the colour identity, which
is `hueClass`, the statistic the swatch exists to replace. `art_crop` is the honest source at ~9× the
bytes: ≈ 2.5 GB of one-time pipeline fetch against ≈ 290 MB, a few hours at 6 concurrent, cached by
`imageTs` so a refresh re-fetches only what changed. It is a pipeline cost, not a user cost — the
shipped artefact is 223 KB either way. **Recommendation: `art_crop`.** This is the single highest-
value question in the batch, because the swatch is the concept.

**Q2 — What does the worlds view do about art in reduced-motion and data-saver conditions?** The art
stream is the product's first meaningful network cost after boot (a bounded few hundred fetches per
pose under §1.6, uncapped in the prototype). **Recommendation: honour `prefers-reduced-data` by
staying swatch-only, with an explicit control in Settings, and treat the swatch-only state as a
first-class look rather than a degraded one** — it is what `dominaria-far` shows and it is legible.

**Q3 — Does the galaxy stay behind a flag after cutover, or is it deleted?** §3.2 assumes deleted, in
one PR, with `galaxy-cutover` as the retrieval point. Keeping it behind a flag means maintaining two
renderers, two gates and two dataset generations indefinitely. **Recommendation: delete.**

**Q4 — Where does the artist credit appear?** Scryfall asks for the artist name and copyright "in the
same interface" as an `art_crop`. With up to 1,024 art cells on screen, listing all of them is
absurd. **Recommendation: the reticle caption names the card and its artist whenever the cell under
the reticle is showing art, plus a persistent Wizards/Scryfall attribution line in the HUD and the
About view.** This is a compliance judgement rather than an engineering one, which is why it is here
rather than decided in §2.3.

**Q5 — Does the printing ring keep PRD 5.6.8's cap of 72?** On the production dataset the cap binds
on **five cards** — the basic lands, Swamp 570 down to Island 535 — and the next card down is Sol
Ring at 60, so there is nothing in between to trade off against. (An earlier draft of this batch put
that number at 669; 669 is the count of cards with more than *nine* printings, and the two questions
have different answers. If you have already answered against the old number, please re-read against
this one.) The remainder is not lost today: the card panel already lists every printing (§1.10). The
only thing the scene hides is *which* printings the ring dropped, and §1.10 fixes that with 1 px
ticks whatever this answer is. Raising the cap has a real texture cost — 570 `small` quads is
64.8 MiB, two thirds of the whole GPU target on its own — and buys a readable ring for nobody, because 570
quads on one orbit is not readable either. **Recommendation: keep 72 for v1, revisit after the
cutover.** This is now a much smaller question than it looked.

**Q6 — Camera-relative key light, or a real sun?** §1.7 chooses camera-relative, which is why the
prototype captures are all lit. A fixed star is more honest to a solar system and puts half the
multiverse on its night side at any moment. There is a middle answer — a fixed sun plus a weak
camera-relative fill that never lets the subject go fully black. **Recommendation: camera-relative
for v1, because a map you cannot read is not a map; revisit with the fill variant once the surface
law is settled.**

---

## 6. PRD amendments concept B forces

None of these are optional and all of them are the owner's to accept. Listed here so the cutover PR
has a checklist rather than a discovery process.

| PRD | Today | Under worlds |
|---|---|---|
| 5.1.1 | "photoreal space, not data visualisation" | still satisfied — worlds are objects in space — but the surface *is* an encoding and the wording should say so |
| 5.3.4 | the Blind Eternities as dust | a belt, one arc per set (§1.8) |
| 5.3.6 | plane kinds `dust` / `spiral` / `irregular` / `empty` | `spiral` and `irregular` collapse into one `world` kind; `empty` becomes `moon` |
| 5.3.8 | every plane is labelled | the 57 empty planes are unlabelled until hover (§1.8, criterion W5) |
| 5.4.2 | chronology bands map to radius | chronology maps to longitude (§1.3) |
| 5.4.8 / 5.4.10 | hue class, brightness percentile | superseded by the art swatch (§2.2); `brightness` goes unread |
| 5.4.13 | shear | retired with the disc (§2.4) |
| 5.5.1 | the thumbnail cross-fade band | replaced by the swatch→art threshold (§1.6) |
| 5.6.7–5.6.8 | printings as 72 orbiting spheres | a flat ring (§1.10) |
| 8.6.1–8.6.2 | seeded spiral parameters | retired (§2.4) |
| 8.5.8 / 8.5.10 | the 128×178 thumbnail atlas, 256 px planet textures | replaced by the 128×96 art array (§1.6, §1.12) |
| 9.3 | seven checkpoints, criterion 2 on spiral arms | the checkpoints and criteria of §3.1 |

---

## Appendix A — the prototype's measured numbers

From `captures.json`, production dataset `6d4779695fde33ea`, 1920×1080 CSS, dpr 1, art threshold
24 px, pool 1,024 layers, on an Apple Silicon Mac. **Not a Windows measurement.**

| View | Camera distance | In radii | Cell height | Art resident | Evicted | Drawn / wanted |
|---|---|---|---|---|---|---|
| `system` | 362.85 | 36.4 | 1.4 px | 0 | 0 | 0 / 0 |
| `dominaria-far` | 59.84 | 6.0 | 10.1 px | 0 | 0 | 0 / 0 |
| `dominaria-frame` | 29.92 | 3.0 | 25.3 px | 333 | 0 | 333 / 333 |
| `dominaria-terminator` | 20.95 | 2.1 | 46.0 px | 1,024 | 479 | 1,024 / 2,759 |
| `tether-surface` | 21.94 | 2.2 | 42.1 px | 1,024 | 925 | 1,024 / 2,759 |
| `dominaria-near` | 13.17 | 1.32 | 158.0 px | 1,024 | 63 | 1,024 / 1,766 |
| `rabiah` | 3.71 | 3.4 | 189.6 px | 1,024 | 514 | 35 / 35 |
| `rabiah-near` | 1.64 | 1.5 | 910.1 px | 1,024 | 515 | 33 / 33 |

Radii: Dominaria 9.97 (6,266 cells), Rabiah 1.09 (75 cells) — a 9.1× ratio where the shipped `log N`
law gives **1.568×** for that same pair (§1.3; review §4.1's 1.3× is Dominaria against Mercadia).
Cells cross the 24 px art threshold at ≈ 3× radius, which is about where a world fills the frame, so
the all-swatch state exists only *further out* than framing distance. System: 27 undetailed worlds,
57 moons, 4,980 belt points — **27 because the prototype drew Dominaria and Rabiah in detail and had
no equirect rung; production's home view has 29 worlds and no cell sheets at all** (§1.2).

The `drawn / wanted` column is the case for §1.6's adaptive threshold, and the two 900+ eviction rows
are the case for criterion W4.

Frames: branch `dec694-worlds-prototype` at `8c5fa25`, tag `worlds-prototype-dec694`, under
`review/dec694-worlds/`. They are not copied onto `main`: review §6.6 already counts 31 MB of review
PNGs in history as a repo-hygiene problem, and the tag makes them retrievable without adding 11 MB
more.

## Appendix B — what the prototype faked, and what replaces each fake

| # | Fake | Replacement |
|---|---|---|
| 1 | The swatch — hue-class colour plus per-card hash noise | `swatches.bin`, §2.2. **The one that matters**; everything the W2.3 captures show about colour is provisional until it lands |
| 2 | The set index, reconstructed as "the earliest of the plane's sets the card was printed in" | baked by the pipeline, §2.1 — the position *is* the answer, so the reconstruction disappears |
| 3 | Mirrored bands as a refinement of review §4.2's sketch | promoted to the normative surface law, §1.3 |
| 4 | Three-pass assignment leaving 894 non-exact cells on Dominaria | per-row grid relaxation, zero displaced, pipeline-enforced, §1.3 / §2.1 |
| 5 | Camera-relative key light | kept, promoted to a product decision, §1.7 and Q6 |
| 6 | The art pool exhausting mid-frame | the adaptive threshold, §1.6, measured by W4 |
| 7 | Undetailed worlds contrast-stretched ×3.2 | kept as normative, §1.8 |
| 8 | No production wiring — no shell, store, filters, search, labels, picking, ladder, printings | legs R3 and G, §4 |
| 9 | Not measured on Windows | W0.1 field reports, §3.2 condition 3 |
