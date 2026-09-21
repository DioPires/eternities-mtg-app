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

| W4.2 tick step   | Under worlds                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| input            | unchanged                                                                                                |
| `rig.update(dt)` | unchanged — the camera rig imports nothing from three and is explicitly kept                             |
| plane table      | unchanged in shape; the per-plane `DataTexture` loses the retired layout fields (§2.4) and gains nothing |
| uniforms         | unchanged                                                                                                |
| async pick       | same id-buffer technique, new subject: cell instance ids, not star indices (§1.11)                       |
| main pass        | new content (§1.2)                                                                                       |
| **bloom source** | **deleted**                                                                                              |
| **mip chain**    | **deleted**                                                                                              |
| **composite**    | **reduced** to tonemap + vignette; no bloom tap                                                          |
| label tick       | unchanged mechanism, far fewer labels (§1.8)                                                             |
| quality sample   | unchanged; the ladder gains worlds-specific rungs (§1.12)                                                |

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
2. **System** — one `InstancedMesh` of icospheres, one instance per plane that is _below_ §1.5's
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
> world appears in step 2 _or_ step 4, except inside the crossover band where it appears in both and
> the two cross-fade (§1.5). More than one world can be above the crossover at once — a tether view
> with both ends near is the ordinary case — so nothing in the pass list may be written as "the
> focused world" versus "the rest".

**Population on production, as of today's roster** (`worldsWithCards` / `planesWithCards` per §3.1;
every count in this paragraph is a worked example, not a set of constants — derive them, §3.1 says
why). 87 planes: 57 empty, 1 dust, **29 worlds with cards**. At the home
view every world is far below the crossover, so step 2 draws **29 + 57 = 86 instances** and step 4
draws nothing; with one world fully above the band, step 2 draws 28 worlds + 57 moons — and with
that world _inside_ the band it is 29 + 57 again, because it draws in both passes. Step 2's instance
count is therefore not `29 − (sheets drawn)`; it is a count of planes below the band's top, and a
renderer that derives one from the other will be one instance short through every approach. (The
prototype's `captures.json` reports `system.worlds = 27` because it drew Dominaria and Rabiah in
detail and had no equirect rung at all; 27 is a prototype count and is not production's.)

> **Normative — the v3 roster is not "today's plus one" (DEC-745, DEC-751; measured on PR #46 head
> `311b87d`, dataset `dabe2c9a68b4d799`).** An earlier draft of this paragraph said Forgotten Realms
> "makes it 88 planes and 30 worlds, and every count moves by one". It does not. The refresh is the
> first dataset to bake in PR #41's plane overrides, so it moves the roster's **shape**, not its
> size: **88 planes = 45 worlds + 1 dust + 42 empty**, with **24,399 cards on worlds**. Worlds go
> 29 → **45**, moons 57 → **42**, and the instance arithmetic above reads `45 + 42 = 87` rather than
> `29 + 57 = 86`. Three second-order quantities move with it and are corrected where they are
> stated: the equirect array is one layer per world (§1.5, §1.12), `rowCells` is one array per world
> (§2.4), and W1 iterates all of them (§3.1). Every number in this spec written against the 87-plane
> roster is the **main** worked example and stays readable as such; nothing may be compiled in.
>
> The shape change is what makes §1.3's small-world floor load-bearing rather than hypothetical:
> the smallest world goes 30 cards → **1**, and **15 of the 45** carry four cards or fewer. At the
> other end the refresh is small: Dominaria 6,266 → **6,271** cells, the multiverse 28,587 →
> **28,603** cards, the belt 4,980 → **4,204**. Worked examples written against 6,266 stay readable;
> the ones that moved by more than rounding are called out where they are stated.

### 1.3 The surface law (normative)

**Latitude is colour. Longitude is time.** Both are per plane, never global.

- **Radius.** `radius = 0.126 · √cardCount`. Constant area per card, which is what makes Dominaria's
  22% share visible: r 9.97 against Rabiah's 1.09, a **9.1×** ratio where today's `log N` law gives
  **1.568×** for the same pair (`visual_radius` in `pipeline/src/eternities/fixtures/layout.py`:
  10.633 against 6.781). Review §4.1's oft-quoted 1.3× is a _different_ pair — Dominaria against
  Mercadia, 20× the cards, 10.633 / 8.008 = 1.328 — and is not the comparand for this sentence.
  **The law carries the same floor empty planes do: `radius = max(0.126·√cardCount, 0.55)`** (§1.8).
  Without it the law inverts below **19 cards** — `0.126·√19 = 0.549` — and a world is drawn
  _smaller_ than a plane with no cards at all. On the 87-plane roster nothing is: the smallest world
  is 30 cards (r 0.690). On the v3 roster **15 of 45 worlds** are under the floor and six carry one
  card, which the unfloored law draws at r 0.126 — **4.4× smaller in radius and 19× smaller in
  silhouette than a dark moon**, which is §1.8's sentence "emptiness becomes a colour and not a
  size" read backwards. Floored, that cohort is moon-sized and is told apart by colour, which is
  what §1.8 claims. Above 19 cards the constant-area law is untouched.

  > **Normative — the floor is a world-space floor, and it is not the pick target (DEC-751).** R3
  > measured leg P's shipping `3ce85aed` at 24 camera azimuths: **24–29 of 45 worlds** sit under
  > WCAG 2.5.8's 24 px pick diameter at *every* azimuth, and the six one-card worlds hold **3.8–9.2
  > px** and never reach 24 px at any azimuth (`dabe2c9a`: **0 of 45**, always). **This section is
  > the cause.** The two datasets carry the same 88/45/24,399 roster; what changed is the radius law.
  > `dabe2c9a` still carries the old `log N` law — its six one-card worlds sit at r **3.605** — and
  > `3ce85aed` is the first to carry this section's `max(0.126·√N, 0.55)`, which puts them at
  > **0.55**, a uniform **6.55× shrink**. So the WCAG regression is not leg P's pipeline; it is the
  > constant-area law arriving, and the ruling on it is §1.3's to make even though the fix is not.
  > (**24 px here is a measurement threshold, not a conformance claim.** §1.11 carries the
  > conformance basis and the limits of what the screen-space floor delivers; read it before quoting
  > WCAG 2.5.8 off this paragraph.)
  > (Homes also moved between the two datasets — median 4.4%, but `segovia` 69 → 19 — so px is not
  > the radius ratio alone. `radius/distance` predicts a worst case of **3.7 px** against R3's
  > measured **3.8**, and the home moves are what spread the cohort to 9.2.) **Do not fix this by
  > raising `0.55`.** On-screen diameter goes as `radius / distance`, so no world-space constant
  > pins a pixel floor across the camera's range at all — and the arithmetic disqualifies the lever
  > on its own. Raising the floor to `F` swallows the constant-area law for every world under
  > `(F/0.126)²` cards:
  >
  > | floor `F` | × moon | N swallowed | v3 worlds losing the law |
  > |---|---|---|---|
  > | 0.83 | 1.5× | 43 | 16 of 45 |
  > | 1.10 | 2.0× | 76 | 17 of 45 |
  > | 2.20 | 4.0× | 305 | 23 of 45 |
  > | 3.48 | 6.3× | 761 | **36 of 45** |
  >
  > The last row is what the worst one-card world needs to reach 24 px. It deletes the constant-area
  > law for **80% of the roster** and draws every small world **6.3× an empty moon**, inverting the
  > §1.8 relationship this floor exists to preserve. Even a 2× raise costs 17 worlds. The ruling does
  > not depend on the exact pixel figure — the lever is wrong in kind at every magnitude. **The pick
  > floor is screen-space and belongs to §1.11**, and the lever that reaches a real 24 px *target*
  > is neither of them: it is the `home` law's separation rule, landed on DEC-759 and normative at
  > the end of §1.11's picking bullet. Radius is not the lever; separation is.
- **Framing distance.** `frameDistance = radius · min(3.2, 1.006 + cellArc · focalPx / 30)`, where
  `cellArc` is the cell's drawn latitudinal extent in units of world radius — `π · 0.93 · 1.006 /
  rowCells.length` — and `focalPx` is the reference viewport's `1080 / (2·tan(55°/2))`. A plane with
  no `rowCells` is framed at the flat `3.2 · radius` this replaces. `surfaceLaw.framingRadii` is the
  law; `camera/framing.ts` is its only caller.

  > **Normative — a world is framed on its CELLS, a plane without a sheet on its silhouette
  > (board ruling on DEC-816 R1, DEC-818).** A sphere at `k · radius` subtends the same angle
  > whatever its radius, so the flat `3.2 · radius` this replaces drew **every** world's disc at the
  > same size and let every world's *cells* shrink as `1/rows ≈ 1/√N`. Dominaria's 81 rows put its
  > median front-facing cell at **17.48–17.58 px `[shipped]`** — 15.50–19.35 `[tilted]` — against §3.1's
  > W1 floor of 24, while a one-card world read 685. The floor and the pose are right — the board
  > ruled both stand — and the framing distance was framing the wrong thing. It is also the only term
  > in `cell px = f(cell arc, distance)` a renderer may choose: the arc is the pipeline's, and §1.4's
  > lift and inset are fixed by the picture.
  >
  > **Normative — every W1 figure in this section is labelled with the ORIENTATION ARM it was
  > measured in, and the two are not interchangeable (DEC-822).** `[shipped]` is the arm the running
  > build renders: `planeOrientation` is the single writer of `surface.orientation`
  > (`attachWorlds.ts`), and it gates the pole tilt on `APPLY_PLANE_TILT` — **`false`** since DEC-750.
  > `[tilted]` applies §1.3's `planes.json` quaternion unconditionally, which is what
  > `worlds-framing.test.ts` poses and therefore what every assertion in that file pins. **Keep both.**
  > The tilted arm is the correct — and more conservative — bound for the day the flag flips; the
  > shipped arm is what the build produces today. A number carried out of this section without its
  > arm is not reproducible.
  >
  > **W1's per-world median is a family over the approach azimuth whose WIDTH is arm-dependent.** The
  > rig arrives at `HOME_POLAR` at whatever azimuth the flight inherited. Under `[tilted]` the pole
  > swings in and out of the front-facing cap and brings a cohort of squat polar cells with it, and
  > the spread is **11% on dominaria and 15% on ravnica**. Under `[shipped]` the pole is upright, so
  > turning the azimuth *is* a spin about that pole — it maps each row-ring onto itself — and the
  > family collapses to **0.3% and 0.6%**. Measured through the shipped probe over 24 azimuths
  > (`worlds-framing.test.ts` re-derives the tilted column; DEC-822 re-measured both from an
  > independent harness).
  >
  > **One world sat under the floor `[shipped]`; two `[tilted]`.** At the old flat 3.2 radii the
  > worlds under 24 px are **dominaria alone (17.48) `[shipped]`** — ravnica is green at *every*
  > azimuth there, 28.64–28.99 — and **dominaria 15.50 *and* ravnica 23.88 `[tilted]`**. Leg G's
  > single-azimuth tour drew dominaria 17.14 and ravnica 28.49, and its ravnica draw sits inside the
  > shipped band: the draw was sound, not lucky. **Ravnica's 3.2 → 3.080 move is margin, not repair.**
  > Never re-pin a single-frame W1 number *once `APPLY_PLANE_TILT` is true* — the rule §3.1 already
  > states for W5 binds here the day the flag moves. It does not bind today, and leg G's single-draw
  > gate is sound for exactly that reason (DEC-822's ruling on DEC-752).
  >
  > **The constant is 30 px of *near* cell, and it is deliberately not W1's 24.** The law sizes the
  > cell at the sub-camera point, which sits well above the median: the front-facing cap runs out to
  > the limb, where a cell is foreshortened to a few px. **28 px is the falsifier in the `[tilted]`
  > arm only**, where it leaves ravnica at 23.88, still under; `[shipped]`, 28 px breaches nothing
  > (worst 27.04) and the first breach is at **24 px** (dominaria 23.63) — about 25% of headroom, not
  > one step. At 30 the worst-azimuth medians are **28.74 (dominaria, 3.2 → 2.261 radii) and 30.19
  > (ravnica, 3.2 → 3.080) `[shipped]`, a 20% margin**; 25.55 and 25.21 `[tilted]`, a 5% margin. Both
  > are worst-of-24 subsample minima and therefore upper bounds — at 240 azimuths tilted dominaria
  > drifts to 25.48 ([[a-subsample-minimum-drifts-with-sample-density]]). Dominaria's disc still sits
  > inside the reference frame at 1,023 px of 1,080. The two branches meet at **46.3 rows**, so on the
  > shipped roster exactly those two worlds move and the other 43 are framed at the distance they were
  > before, to the bit — which is what makes "no green world regresses" a property of the law rather
  > than a re-run.
  >
  > **The reference viewport is §3.1's own — 1920×1080 CSS at dpr 1, the camera's 55° vertical fov —
  > and a pixel floor has no world-space spelling without one.** Only the height and the vertical fov
  > enter; the aspect moves screen `x` alone. A shorter viewport therefore frames a world at the same
  > distance and reads fewer pixels per cell. That is a stated limit and not an oversight: `Framing`
  > is the headless camera layer and has no live viewport, so tracking the window would put a
  > render-loop dependency in the navigation layer. Priced here rather than left implicit.
- **Bands.** Seven classes — W, U, B, R, G, gold, colourless — laid out **mirrored about the
  equator**: colourless is split between the two ice caps, each mono colour is a matched pair of
  bands, gold is the single equatorial belt. North to south:
  `C G R B U W · Gold · W U B R G C`.
- **Bands are equal-_area_, not equal-angle.** A band's share of `sin(latitude)` is its share of the
  plane's cards, so the area a colour covers _is_ the fraction of the plane that colour is. Gold
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
over them, so assignment ran three passes — exact (colour _and_ set), colour only, anywhere — and
left Dominaria at 5,372 exact / 694 colour-only / 200 displaced / 0 bare, and Rabiah at 49 / 0 / 26
/ 3 bare of 75.

> **Normative, and a change from the prototype.** Production relaxes the grid _to the population_
> instead of displacing cards. Slice boundaries are chosen per row, so a row's cells are handed out
> to bands and sets in proportion to what that row's latitude range actually contains, and the row's
> cell count is chosen to match. The target is **100% exact, zero displaced, zero bare**, and the
> pipeline fails its own invariant test if any card is displaced (§2.1). A displaced card is a card
> in the wrong place on a map whose entire claim is that position means something.

> **Normative — what the relaxation does _not_ move.** Only the per-row **cell count** is
> population-derived. The **row latitudes stay equal-angle**: `rows` rows of constant `dφ = π/rows`,
> centres at `(i + ½)·dφ`, unchanged from the closed form. This matters twice. It is what lets the
> client match a cell to its row by nearest latitude at all (§2.1), and it is what keeps rows and
> bands independent: bands are equal-_area_ in `sin(lat)` and rows are equal-_angle_, so a band
> boundary generally falls **mid-row**. That is legal and intended — **a row straddling a band
> boundary splits its cells between the two bands in proportion to the area each band takes of that
> row**, which is the same proportional rule the paragraph above states, applied within a row rather
> than across rows. Band boundaries are never snapped to rows: snapping would quantise a colour's
> area to `1/rows` and break §1.3's central claim that a band's area _is_ that colour's share.

Because the counts move and the latitudes do not, the closed form is no longer a description of the
shipped grid. Rabiah is the proof that the difference bites: the closed form gives **78 slots for 75
cards** (the prototype's 78, with 3 bare); the relaxed invariant demands exactly 75. §2.1 and §2.4
carry the contract consequence.

> **Normative — the construction, and why the closed form cannot be it (DEC-752's finding, widened).**
> Leg G observed that `sum(rowCells) == cardCount` is "a Dominaria fact rather than a law". It is not
> even that. Rounding each row independently — `rowCells[r] = round(2π·sin θ_r / (aspect·dφ))` — hits
> `cardCount` exactly at **85 of the 7,000** card counts in `N = 1…7000`. Dominaria's 6,266 is one of
> the 85, which is the whole reason the spec's worked example reads as a law; **v3 moves Dominaria to
> 6,271, and at 6,271 the closed form yields 6,266 cells and five cards have nowhere to go.**
>
> The failure is two-sided, and the side the prototype never saw is the dangerous one. Rabiah
> over-allocates (78 slots, 75 cards → 3 bare cells, visible). But **3,487 of those 7,000 counts
> _under_-allocate**, and an under-allocated world drops cards silently. Of v3's 45 worlds, **18
> under-allocate, 15 over-allocate and only 12 are exact — 207 cards have no cell at all**, led by
> new-phyrexia (−27), rath (−23), thunder-junction (−20) and forgotten-realms (−18). "Zero bare"
> (§2.1) cannot detect this: a dropped card leaves no bare cell to count.
>
> So the per-row count is **apportioned, not rounded** — and the apportionment of record is the
> pipeline's, which is not a function of `cardCount` at all. `build_grid` (§2.1) apportions a row's
> cells **within each colour band** and then splits each band's share between sets, returning the
> counts *and* the placements from one pass; that pairing is what makes "zero displaced, zero bare"
> checkable, so the emitter stays in the pipeline and is not lifted into this section (leg P,
> DEC-748). The consequence is normative: **`rowCells` is not a function of `cardCount`.** The same
> N under different hue histograms yields different tables — leg P measured **three distinct tables
> from four compositions** at N = 306, 931 and 6,271, where varying the chronology-band count moved
> nothing and only colour did (pinned as `test_row_cells_is_not_a_function_of_card_count_alone`,
> `b2bf0b5`). DEC-744's B2 ruling already makes the **published table the contract**; the client
> reads it and derives no cell count of its own (§2.4).
>
> **What is normative about the counts** — and what the published v3 table satisfies on all 45
> worlds — is: `Σ rowCells == cardCount`; `rowCells[r] ≥ 1`; `rows = max(1, min(rows_closed, N))`,
> which is what makes that floor provable rather than hopeful; `dφ = π / rows`; centres at
> `(i + ½)·dφ`.
>
> **The N-only apportionment below is a check, not the construction.** Give row `r` the quota
> `q_r = N·sin θ_r / Σ sin θ`, floor it at 1, and hand out the residual `N − Σ⌊q⌋` by **largest
> fractional remainder**, ties broken by `min(r, rows−1−r)` then `r`; reclaim deficits the same way
> in reverse, never below 1. It holds `Σ = N` at **every** N in 1…7000, and against the published v3
> table (`c9468f11`, vendored at `docs/worlds/rowcells-v3.json`) it agrees on **rows and dφ 45 of
> 45** and on the counts **to ±1 cell per row, never more**: 579 of 777 rows match exactly, 99 run
> one cell high and 99 one cell low. Its aspect cost is a wash — 81 of its 777 rows fall outside
> ±10% of 4:3 against the published table's 87. Two limits on how far to trust it. It reproduces a
> published table exactly on only **15 of 45 worlds, and those are the six one-card worlds, the eight
> two-card worlds and one four-card world** — *every* world of 30 cards or more disagrees somewhere.
> But the ±1 slack is **derivation-safe for §1.4**: computing the subdivision from the N-only table
> instead of the published one gives the identical `(k_lon, k_lat)` on **45 of 45** worlds, the same
> 13 unsubdivided worlds holding 19,497 cells, the same 38,887-sub-quad roster total and the same
> 1,130 worst case. Use it to sanity-check a table or to size geometry; never to generate a table.
>
> **Normative — `round` here means half-to-EVEN, and `Math.round` is not it (DEC-749).** Every
> `round(...)` in this section is the pipeline's, and the pipeline is Python, whose `round` breaks a
> half toward the even integer. JavaScript's `Math.round` breaks it away from zero. The two readings
> of this one word disagree on **1,138 of the 7,000** card counts in N = 1…7000 — the TypeScript and
> Python halves of the same conformance check disagreed about what the emitter does until this was
> pinned. Nothing on the render path rounds at all, because the client reads the published table; but
> anything that *checks* the table has to round the way the emitter does or it is measuring itself.
>
> **Normative — the residual's tie-break needs mirrored weights, or it does not run (DEC-749).**
> The rule above breaks ties by `min(r, rows−1−r)`, which can only decide anything when two rows'
> fractional remainders are **equal**. `sin θ_r` and `sin θ_(rows−1−r)` are equal in exact arithmetic
> and *not* equal in doubles: the two arguments differ, so the results land up to ~1.5 ulp apart. On
> bloomburrow's 18 rows only **3 of the 9** mirrored pairs came out bit-identical, so the residual was
> being handed out by floating-point accident rather than by the stated rule — and not even
> reproducibly, since libm and V8 order that world's rows 4 and 13 oppositely. So the weights are
> computed once per mirrored pair and **assigned to both rows**, which makes every pair tie exactly
> and lets the documented tie-break decide. This is a sibling of the inert-rule failure in §1.3's own
> lever table: a tie-break is inert wherever its key never ties.
>
> One consequence is worth recording because an earlier revision of this spec recorded its opposite:
> at N = 3 the table is **`[2, 1]`**, the residual landing in the *northern* row as the tie-break
> says it should. The `[1, 2]` a previous draft quoted was the answer the unmirrored noise happened
> to give. No world on the v3 roster carries three cards — the counts step 2 → 4 → 30 — so nothing
> shipped moves either way, and every dataset-derived figure in this section is unchanged by the fix.

> > **Corrected.** An earlier revision of this block claimed the N-only form "reproduces Dominaria's
> > published `rowCells` verbatim" at 6,266. It does not, and there is nothing at 6,266 to reproduce:
> > the check behind that sentence compared the N-only form against the **closed form**, not against
> > any dataset, and no published dataset carries a `rowCells` table at that count — `rowCells` is a
> > v3 field, the v2 builds have none, and both the v2 and v3 builds of the 45-world roster put
> > Dominaria at **6,271**.
>
> **There is no symmetry bound on the shipped table, and the gate must assert none.** A closed
> surface's equator-symmetric partition has an even cell count in every mirrored pair, so it cannot
> sum to an arbitrary odd `N`: exact-N and strict symmetry are incompatible, and exact-N wins because
> the alternative is losing cards. The N-only form relaxes symmetry minimally — at most one mirrored
> pair differs, by at most one cell, over N = 1…8000 — but **that bound is a property of the N-only
> form and is false of the shipped grid**, because the pipeline apportions per band. Measured against
> v3: strict `rowCells == reversed(rowCells)` fails on **30 of 45** worlds (not the 14 an N-only
> reading predicts), the `≤ 1 pair` form fails on the same 30, **Dominaria differs in 15 mirrored
> pairs**, and eight worlds — innistrad, zendikar, theros, fiora, avishkar, amonkhet,
> thunder-junction, new-phyrexia — carry a pair differing by **two**. (The *count* of eight is stable
> across both v3 datasets; the *membership* is not — the `3ce85aed` → `c9468f11` move swapped
> arcavios and mercadia out for fiora and new-phyrexia. Which worlds land here is a property of the
> hue histogram, not of the law, which is one more reason to assert no bound.) This is correct
> behaviour: the
> pipeline's `_north_first` alternates a mirrored class's odd card by set-index parity on purpose, so
> that the north band does not accumulate ~20 extra cards across a large plane's odd-count groups
> (leg P, DEC-748; copied to DEC-752, where such an assertion would go RED on a correct renderer).
> The maxima above are **measurements over 45 worlds, not bounds** — nothing in this spec derives
> them, so a gate row asserting `≤ 2` would be as wrong as `≤ 1`, only less often.

> **Normative — the floor: n = 1 and n = 2 (DEC-751's finding, re-derived).** Six v3 worlds carry
> exactly one card and eight carry two (§1.2), so the bottom of the law ships. It is stated, not
> left to resolve:
>
> - `rows = max(1, round(π / √(4π / (aspect·N))))` and `rowCells[r] ≥ 1`. At N ≤ 2 the closed form
>   already gives `rows = 1, rowCells = [2]`; the relaxation's exact-N invariant makes that `[1]` at
>   N = 1 and leaves `[2]` at N = 2. **One row, whose centre is the equator, whose `dφ` is π.**
> - At N = 1 the single cell spans the whole sphere: half-extents `(π, π/2)` in arc. This is not a
>   degenerate case to special-case away — it is what constant area per card _means_. A cell's world
>   area is `4π·radius²/N = 4π·0.126² = 0.200` square units for every N, so one card on a one-card
>   world is the same physical size as one card on Dominaria. The cell wraps because the world is
>   small, not because the law failed. (With the §1.3 radius floor the drawn world is larger than
>   that; the floor is the compromise, not the wrap.)
> - **The 4:3 target is exempt at small N, and this costs nothing.** A closed surface cannot be tiled
>   by one or two 4:3 cells: the slot aspect is `2π·sin θ / (rowCells·dφ)`, which at `rows = 1` is
>   **2.00** for N = 1 and **1.00** for N = 2. Neither stretches any art — §1.4 letterboxes art into
>   the slot, so a non-4:3 slot costs slot _area_ and never geometry.
>
> **What actually breaks at small N is §1.4's tangent quad** — see §1.4's subdivision rule. A cell's
> corner sits `√(1.006² + α² + β²) − 1` above the unit sphere: **0.7%** of the radius on Dominaria,
> **5.7%** on Rabiah, **13.0%** on a 30-card world (shenmeng), **156%** at N = 3, **144%** at N = 2
> and **265%** at N = 1, where the "cell" is a flat billboard 2.6× the globe it is meant to tile.
> Reading the failure as an aspect-ratio problem points at the harmless half.
>
> > **Corrected by the exact-N apportionment above.** An earlier revision of this block argued the
> > lift was *monotone in N* — "a continuum, not a cliff" — and that N = 3–5 sat at a benign 1.41
> > aspect. Both were artefacts of the closed form's over-allocation. Under exact-N a small
> > world's residual lands in one row, so at N = 3 the table is `[2, 1]` (no three-card world is on
> > the v3 roster — its counts step 2 → 4 → 30 — so this is the check's reading, not a shipped
> > table): one of its two rows is a
> > single cell wrapping the full circumference, at aspect **2.83** and a lift of **156%** — *above*
> > N = 2's 144%. The lift is monotone in a cell's **solid angle**, not in N, and it is a sawtooth in
> > N (it rises at N = 2→3, 5→6, 11→12, 28→29, 38→39, 40→41 and 52→53). This does not change what
> > §1.4 must do — subdivision is sized per world from the cell's own extents, so it absorbs the
> > sawtooth without knowing about it — but a reviewer checking "does the lift fall as N rises"
> > against the shipped grid would be checking a false claim.

### 1.4 The cell sheet

One `InstancedBufferGeometry`, one unit quad, N instances, one draw per world. Review §4.2 costs
this at "~2,000 opaque textured quads ≈ 2–3 ms"; Dominaria puts 6,266 in the draw.

Per-instance attributes: `iNormal` (vec3, the unit-sphere point), `iSize` (vec2,
half-extents in units of world radius — **arc length, not angle**; the longitudinal component is
`(π / rowCells[r])·sin θ_r` and §2.1 carries the derivation and the 51.6× failure that drops the
`sin θ_r`), `iSwatch` (vec3, linear RGB), `iLayer` (float, dynamic),
`iArt` (float, dynamic cross-fade). **40 bytes per cell**; one cell per card **on a world**, so
**0.90 MiB** for the 87-plane roster's 23,607 and **0.93 MiB** for v3's 24,399 — not 28,587, which
is the multiverse total and includes the belt's dust, and the belt has no cell sheet (§1.8).

> **Normative — `iEast` is gone, and 52 bytes per cell is now 40 (DEC-749).** The attribute list
> above was written for the flat-quad era, where a quad needed an explicit tangent basis to orient
> it against the sphere. The sphere-following grid below does not: a cell's centre normal already
> carries its colatitude (`acos(n.y)`) and its longitude (`atan2(n.x, n.z)`), and a vertex is placed
> by re-walking the *same* parameterisation that placed the centre rather than by stepping along a
> stored basis. Dropping the vec3 takes the 87-plane roster from 1.17 MiB to **0.90 MiB** and v3
> from 1.21 MiB to **0.93 MiB**; §1.12's budget table carries the smaller figure. `eastOf` itself
> stays — §1.5 pins the bake's handedness on it and `buildRowIndex` needs it — but it no longer
> ships per cell. The client asserts the 40 from the geometry rather than restating it, so a
> re-added attribute moves the constant and the budget together.

The vertex shader recovers the cell's *angular* half-extents from `iSize` — dividing out the
`sin θ_r` that made it arc length — walks colatitude and longitude out from the centre to the grid
vertex's `(u, v)`, and places it at `n · radius · 1.006`, lifted just off the globe so it beats
depth precision at system distance, with the **angle** pulled in to 0.93 so the tiling reads as
masonry with grout rather than as a skin. Insetting the angle rather than a tangent offset is what
keeps every vertex on the sphere at every subdivision.

> **Normative — the probe must be handed the extents the sheet DRAWS at (§3.1, DEC-749).**
> `cellScreenRect` takes its arcs and its radius as parameters, so it will bound a rectangle nothing
> ever drew if it is handed a cell's nominal extents: the un-inset angles over-report every cell by
> **7.5%** and the unlifted radius under-reports it by 0.6%. The larger error lands directly on the
> two numbers that are scored — W1's pixel-height floor and §1.11's 24 px proxy — and neither shows
> up as a wrong picture, because the picture is drawn by the shader and only the *measurement*
> moves. `surfaceLaw.cellDrawAngles` and `surfaceLaw.drawRadius` are the single spelling of both,
> and the shader takes the same two constants as `#define`s written from them.

**Shading is flat across a cell.** `iNormal` is the *centre* normal and the fragment shader uses it
unmodified rather than interpolating a per-vertex one, so §3.1's `shade` is a statement about the
frame rather than an approximation of it — a smooth normal would leave W2's iso-shade subset not a
subset of anything.

> **Normative — the quad follows the sphere; below 574 cards it has to be subdivided (DEC-749, on
> DEC-751's n = 1 finding).** A flat quad tangent at the cell centre is only a surface patch while
> the cell is small. Its corner sits at `√(1.006² + α² + β²)` from the world centre against the
> surface's 1, where `(α, β)` are §1.4's `iSize` in radius units — **0.7% of the radius on
> Dominaria, 5.7% on Rabiah, 13.0% on a 30-card world, 265% at N = 1** (§1.3). Past a few percent
> the cell stops reading as masonry and starts reading as a billboard that parallaxes off its globe;
> at N ≤ 2 it is larger than the globe.
>
> So the base geometry is **not** a unit quad in general: it is a `(k_lon + 1) × (k_lat + 1)` vertex
> grid, **one `(k_lon, k_lat)` per world** (the sheet is already one draw per world), and a vertex at
> `(u, v) ∈ [−1, 1]²` is placed **on the sphere** at colatitude `θ_c + v·(dφ/2)` and longitude
> `λ_c + u·(π / rowCells[r])` — the cell's own _angular_ half-extents, the same parameterisation that
> placed its centre — then lifted by the same 1.006 and pulled in by the same 0.93. Every vertex now
> sits _on_ the lifted sphere at every `k`, so the residual error is the **sag** of each flat facet
> between its four vertices, `1.006·(1 − cos γ)`, and never the tangent plane's unbounded corner
> lift. `iSize` stays what it is (arc-length half-extents) and stays what the pixel tests and §2.1's
> contract are written against; it is `sin θ_r` times the longitudinal _angle_ used here, which is
> the whole reason the two must not be confused (§2.1's 51.6×).
>
> `k` is the smallest integer pair holding that sag within **1% of the radius**:
> `k_axis = ceil(arcHalfExtent / 0.0998)`, where `0.0998 = acos(1 − 0.01/1.006) / √2` and the `√2`
> is the two axes combining at a facet corner.
>
> **The cost is bounded by the sphere, not by the card count**, which is what makes this affordable
> at the bottom of the roster where every cell is huge. `k` is computed from the world's **published**
> `rowCells` (§2.4) like every other client-side derivation, though §1.3 records that the N-only
> check agrees on `k` for 45 of 45 worlds. It is `(1, 1)` — one quad per cell, today's
> geometry — for every world of **574 cards or more**: 13 of v3's 45 worlds, holding **19,497 of its
> 24,399 cells**. It is `(3, 2)` at Rabiah's 75, `(5, 3)` at 30 cards, and
> `(32, 16)` at N = 1, where the entire world is **512 sub-quads** against Dominaria's 6,271 cells at
> `(1, 1)`. Summed over the whole v3 roster it is **38,887 sub-quads for 24,399 cells** — and that
> total is hypothetical, since it assumes every world above the crossover at once. **No world that
> subdivides at all can exceed 1,146 sub-quads**: `k` reaches `(1, 1)` at 574 cards, so the largest
> subdivided world is a 573-card one at `(2, 1)`, and the sphere's own envelope
> (`4π / 0.0998² ≈ 1,262`, a world whose every cell sits at the tolerance) is never reached. The
> measured worst case is 1,124 on the 87-plane roster and 1,130 on v3. Assert the 1,262 envelope per
> world in the sheet's unit test, over the dataset under test — a subdivided world that exceeds it
> is a `k` computed from the wrong axis.
>
> > **Normative — the envelope binds on SUBDIVIDED worlds only, and dropping that qualifier sends
> > the gate RED on correct behaviour (DEC-749, measured on `c9468f11`).** At `k = (1, 1)` a cell
> > *is* one facet, so an unsubdivided world's facet total is simply its card count, and **four of
> > v3's 45 worlds exceed 1,263 legitimately**: dominaria (6,271), ravnica (2,304), innistrad
> > (1,655) and new-phyrexia (1,405). That is not over-subdivision — it is a large world drawn at
> > one quad per card, which is the geometry this whole section is trying to get back to. The
> > envelope is a statement about how finely the sphere can be cut, so it binds only where cutting
> > happens. `worlds-surface-law.test.ts` asserts both halves: no subdivided world over the
> > envelope, and exactly those four unsubdivided ones over it.
>
> **The winding rule below applies per sub-quad**, and the subdivision is where a "tidy" rewrite is
> most likely to reintroduce it: a grid generator that emits CCW triangles inverts every cell.

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
> planet shader for doing it. So the shade multiplies the _swatch_ only and a cell that has resolved
> to art is flat-lit on purpose. The art is letterboxed into its layer, never cropped or stretched.

### 1.5 LOD: baked equirect far, cells near

At system distance Dominaria's cells are **1.4 CSS px** (`captures.json`, `system`). 24,399 quads at
sub-pixel size is not a cost problem — it is an aliasing problem, and a sub-pixel quad sheet
shimmers under any camera motion.

So every world carries a **256×128 baked swatch texture**, one layer of a `DataArrayTexture` with
one layer per world with cards — **`worldsWithCards.length` layers, allocated from the dataset, not
a constant** (§3.1). That is 29 layers and 256·128·4·29 = 3,801,088 B = **3.62 MiB** (3.80 decimal
MB) on the 87-plane roster, review §4.2's "~4 MB for all worlds"; on v3 it is **45 layers = 5.62
MiB**, and §1.12's budget carries the larger figure. Units here and in §1.12 are **MiB**
throughout, because `gpuMemory.ts:29` sets `MEGABYTE = 1024 * 1024` and the budget these are checked
against is that one.

> **Normative — the bake is client-side, at load, in the worker.** It is a pure function of
> `swatches.bin` (§2.2) plus the surface law, which both sides already have; shipping it as a
> pipeline artefact would add a fourth binary and a fourth budget row to buy nothing. Rasterising
> every world's cells into its own layer — 23,607 into 29 on the 87-plane roster, 24,399 into 45 on
> v3 — is one pass over the swatch buffer.

> **Normative — longitude is `atan2(x, z)`, and the other spelling mirrors the world (DEC-749).**
> §1.4 places a cell vertex at "longitude `λ_c + u·(π / rowCells[r])`" and winds the quad with
> `east` as its `+u`. Those two sentences are consistent under exactly one convention:
> `east = normalize(cross(Y, n))` runs along **increasing `atan2(x, z)`**, and along *decreasing*
> `atan2(z, x)`. (Relatedly, `north = cross(east, n)` points toward increasing *colatitude* — south
> — which is what makes `v` agree with "colatitude `θ_c + v·(dφ/2)`".) A bake that indexes its
> columns by increasing `atan2(z, x)` — the spelling that looks natural — runs its texels opposite to
> the sheet's `u`, and the world is **mirrored east-west between its two LOD representations**. It
> does not announce itself: inside the crossover band both passes draw and cross-fade, so it reads as
> a smear rather than as an obvious flip, and outside the band each representation is
> self-consistent. Pin the handedness on `eastOf` directly, not on the bake.

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

> **Normative — R1 owns the tint *mix*, §1.8 owns the colour it mixes toward (§4, DEC-749).** §4's
> staffing table puts §1.3–§1.6 on R1 and §1.7–§1.9 on R2, and the boundary falls exactly on this
> paragraph, which is the one place the two sections meet. The blend factor is part of §1.5's LOD and
> ships with it as `tintMix(worldRadiusPx(...))`; the ×3.2 palette-deviation colour is §1.8's and
> ships with the step-2 instance mesh that samples it. Two legs each deriving their own blend factor
> is how the crossover and the tint end up disagreeing about where a world stops being itself — and
> because both representations are self-consistent on their own side of the disagreement, it reads
> as a world that dims at the wrong distance rather than as a defect in either leg.
>
> The mix is smoothstepped over `[0, 6 px]`, for the same reason §1.5's crossover is a band rather
> than a switch: a linear ramp has a slope discontinuity at the threshold, which on a slow approach
> reads as the moment the colour "catches". The two endpoints are fixed, so a world at exactly 6 px
> samples the equirect layer alone and the tint is reachable only below it.

### 1.6 The art stream

`art_crop` letterboxed into 128×96 layers of a `TEXTURE_2D_ARRAY`, uploaded one layer at a time with
`renderer.copyTextureToTexture(source, target, null, new Vector3(0, 0, layer))` — a `texSubImage3D`
of one layer, so streaming a card in never re-uploads the pool. That argument is the whole reason
the pool is an array texture and not an atlas canvas.

> **Normative — a `DataArrayTexture` ignores `UNPACK_FLIP_Y_WEBGL`.** Flip V in the fragment shader
> (`1.0 - vUv.y`), not on upload.

> **Normative — the layer pool needs three states, not two.** `key >= 0` resident, `FREE = -1`,
> **`RESERVED = -2`**. Without the third state a layer claimed by an in-flight fetch still reads
> free, two loads claim it, one silently overwrites the other, and the resident count climbs _past_
> the pool size. The prototype observed 1,031 resident in a 1,024-layer pool; that impossible number
> is the only tell. Assert `resident <= layers` in the pool's own unit test.

> **Normative — query `MAX_ARRAY_TEXTURE_LAYERS` and clamp.** WebGL 2's _specification minimum_ is
> **256**, not 1,024. W4.1's `capabilities.ts` asserts only `>= 72` (it was sized for the printing
> spheres, which concept B deletes, and it names W4.4 as its own successor). The worlds path must
> read the real limit and clamp the pool to `min(tierLayers, maxLayers − 32)`. A pool that silently
> fails to allocate is a black world.
>
> **Normative — the clamp needs a floor, because `maxLayers` can be 0 (DEC-749).** W4.1's
> `capabilities.ts` (PR #45) reports `maxArrayTextureLayers` as **0**, not as a large number, on two
> reachable paths: a non-WebGL2 context (`webgl2 ? getParameter(...) : 0`) and a context that has
> been lost, where `numberParameter`'s `try/catch` returns its `0` fallback. `min(tierLayers,
0 − 32)` is **−32 layers at every tier**, so the formula as written turns the one case it exists to
> protect into a negative allocation. The pool size is
> `max(0, min(tierLayers, maxLayers − 32))`, and a pool of 0 is a legal, swatch-only world — which is
> what §1.4's shading path already degrades to when no cell holds a layer — not a black one. R1 reads
> `arrayLayersAffordable` / `webgl2` to decide _whether_ to build the pool at all, and never
> subtracts from an unanswered limit. Assert the 0 case in the pool's unit test alongside
> `resident <= layers`; on this Mac the limit is slack and neither bound can bind, so an
> injected-limit test is the only thing that can fail here (DEC-739's vacuous-clamp finding).
>
> **The −32 is driver slack, not accounting.** `MAX_ARRAY_TEXTURE_LAYERS` is a **per-array-texture**
> limit, not a global layer pool: the equirect array (29 layers on the 87-plane roster, 45 on v3 —
> §1.5) is a separate texture object and takes nothing from the art pool's allowance. Sitting one
> notch below an implementation's stated maximum
> is cheap insurance (1.5 MiB at tier 0) against drivers that report a limit they will not actually
> allocate at 128×96×4; it is not headroom being reserved for anything. **Knock-on:** on a
> spec-minimum 256-layer device tiers 0, 1, 2 and 3 all clamp to 224, so §1.12's ladder assertion
> must be written against the _clamped_ value, not against the tier constant.

**Selection.** Each frame, for every cell on a world above the LOD crossover: reject if
`dot(normal, toCamera) <= 0.12`; reject if off-screen — transform by `camera.matrixWorldInverse`,
reject `z > -camera.near`, _then_ apply `camera.projectionMatrix` and require `|x| <= 2, |y| <= 2`.

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
> 256-bucket histogram of the on-screen pixel heights of wanting cells (one pass, no sort). If the
> count above 24 px exceeds the pool capacity, count down from the tallest bucket until admitting one
> more would carry the running total past capacity, and raise the effective threshold to the lower
> edge of the bucket **above** that crossing one — the last bucket that fit — with **7.88% of
> hysteresis**, a width in pixels rather than a count of buckets, so the boundary does not
> oscillate. The result is the same picture — a ring of art around the sub-camera point — reached by
> design rather than by exhaustion, with a bounded fetch count and near-zero steady-state eviction.
> Acceptance criterion **W4** (§3.1) measures exactly this.
>
> **Normative — the resolution is 256, and only the resolution changed (DEC-882).** This read 64,
> and a 64-bucket grid is ~7.88% per step. At `dominaria` 2.2 world-radii under tier 4 the 128th-
> and 208th-tallest cells are **0.77 px** apart, about a quarter of one such step, and a single old
> bucket laid on the capacity rank held **128** cells — the whole pool. There was no edge to place
> *inside* the pool, so the only admissions the quantile could reach were 16 cells (0.125x capacity)
> and 291 (2.27x); "admit about 128 here" was not on the grid, and the tier-4 rung read 14 cells of
> art against §3.1's floor of 32. 256 buckets is ~1.91% per step and the two grids **nest** — every
> 64-bucket edge is still an edge, 64-bucket *k* being 256-bucket *4k* — so this refines the
> boundary rather than moving it. Measured live at that pose: threshold **37.11 px** on every draw,
> and **77–84 of 128** layers admitted over DEC-882's five draws, of which 76–82 drew art (three
> later `main` draws of `layers-128` admitted 76–77, of which 75–76 drew art), against 37.82 px and
> 14–17 before; the frame's `showingArtAll` read 124–128 on both grids. **82 is also the offline rig's figure**:
> the committed height fixture (`web/test/worlds-tier4-heights.ts`) reads 37.1134 px and 82
> admitted, and it is a fixture, not a draw. The intent of this section is unchanged, and so is
> "one pass, no sort".
>
> **Normative — the hysteresis hold is a width in pixels (DEC-882).** The drift the hold absorbs is
> a property of the camera, and bucket indices are only how the implementation addresses pixels: a
> hold stated as "one bucket" quarters itself when the resolution is raised four-fold, re-opening
> the flicker DEC-768 F2 closed. The width is therefore pinned at the one that was measured to work,
> **7.88%** — one step of the grid it was measured on — which this grid spells as four buckets.
>
> **Normative — the one exception, and a pool with demand in front of it is never left idle (DEC-768
> F1, DEC-770 N3).** Where the crossing bucket is the **first non-empty** one, "the last bucket that
> fit" is a bucket nothing is in: the frame admits nothing at all and every layer of the pool sits
> idle in front of a world that wants art, which is strictly worse than the `fixed24` prototype this
> quantile replaces. So take the **crossing bucket itself** whenever the bucket above it would admit
> nothing, and leave the overshoot — at most that one bucket's own count — to the pool's LRU. A frame
> that asks for 1.2 pools is a frame with one round of eviction in it; a frame that asks for nothing
> is a world with no art on it at all. **A capacity of zero is excluded from the exception**, because
> a pool of no layers is a legal swatch-only world (§1.12) and must admit nothing.
>
> This paragraph is the rule, not a gloss on the one above it: taking the crossing bucket
> *unconditionally* overshoots capacity every frame, and the sentence above without this exception is
> the reading that produced the idle pool. Both halves are pinned at the unit — the exception and its
> control — in `worlds-art-stream.test.ts`.

> **Normative — ship the seam that turns the quantile off: `?artThreshold=fixed24`.** It restores
> the prototype's behaviour exactly — a constant 24 CSS px threshold, no histogram, no hysteresis,
> let the pool run out — and it is W4's negative control (§3.1). This has to be a seam in the
> shipped renderer rather than a patched build, for the reason §3.1 gives: W4's whole subject is the
> _absence_ of exhaustion, and the only frame known to exhaust is the prototype's `tether-surface`.
> Note what the control may **not** be: shrinking the pool does not work. The threshold is defined
> relative to pool capacity, so a smaller pool simply raises the threshold and the criterion passes.
> Starving the resource the policy adapts to makes the criterion GREEN; the control has to starve
> the **policy**.
>
> **Normative — anything measuring this policy must drive the pool at a capacity the renderer ships
> (DEC-749, answering DEC-752).** The same relative definition that disqualifies a shrunken pool as
> a *control* disqualifies an undersized pool as a *harness*, and it is the sharper of the two
> because it is silent. Measured over the 45-world roster at §3.1's 2.2-radii pose, the set
> `wantsArt && !frontFacing` — the only set that can distinguish demand from visibility — is
> non-empty on **18/45 worlds at 16 layers, 30/45 at 64, 37/45 at 128, 42/45 at 224 and 45/45 at
> 1,024**, and at 1,024 it is the *same 12,771 cells* `?artThreshold=fixed24` reaches, because the
> threshold never leaves the 24 px floor. §1.6's clamp puts tiers 0-3 at **224** on a device at
> WebGL 2's spec-minimum `MAX_ARRAY_TEXTURE_LAYERS` of 256 and tier 4 — the smallest rung — at
> **128**, so **any capacity below 128 is below every shipped configuration** and shrinks the
> testable set without failing anything. A harness at 64 layers leaves both of §1.6's visibility
> terms unpinned on the default path while every assertion about them still passes.
>
> The mechanism is not a property of any one world, and in particular it is **not** "the worlds whose
> threshold rises highest go empty": at 128 layers dominaria has the *lowest* risen threshold on the
> roster (**30.71 px** at 256 buckets, 30.13 before DEC-882 raised the grid, and 32.50 before DEC-769
> fixed F1 above) and goes empty, while at 64 layers bloomburrow sits **below** it at 25.40 px and
> does not — 232 excluded cells against dominaria's none. The threshold is quoted with its capacity
> because the quantile is defined relative to capacity; without one it is not a reading. A
> back-facing cell projects at most
> ~0.82x the height of the world's tallest front-facing cell at this pose — near-constant across the
> roster — so the exclusion binds exactly while the threshold sits below that fraction, and the
> threshold is set by **demand against capacity**, nothing else.
>
> **Normative — the seam reports itself engaged (DEC-752).** Under `?artThreshold=fixed24` the
> probe's `effectiveThresholdPx` reads **exactly 24**, and the gate asserts that before it reads
> W4's criterion. Under the quantile it reads the bucket edge the histogram chose, which is
> quantised and is not 24 except by coincidence. Without the read-back, a seam that silently fails
> to parse its own query parameter runs the _unmodified_ policy, W4 passes, and the matrix records
> a passing control — the `verify-browser --dataset all` shape of failure. The same applies to
> every control seam: `?swatch=mean`, `?bands=shuffle`, `?art=off` and `?layers=N` each report a
> value the gate can check moved.

> **Normative — `?art=off` is swatch-only, and it is not `?layers=0` (board ruling `art_off_seam`
> on DEC-752, answered 2026-09-16; built on DEC-821).** Under it every cell draws its swatch: no
> cell asks the stream for a printing, nothing becomes resident, and `artFraction` is 0 against a
> `wantsArt` denominator that is unchanged. **Everything else is unchanged too** — the pool is the
> tier's, the stream is composed, and the quantile, its hysteresis and the admitted set read
> bit-identically to the same pose with the seam absent. That is the seam's whole purpose: at
> §3.1's 2.2-radii pose `artFraction` measures **0.987–0.997** over four dominaria sessions, so
> essentially every cell draws **art**, and the two seams that perturb the **swatch** move nothing
> the capture can see — measured on DEC-816, `?swatch=mean` leaves `lightnessIqr` at 24.89 inside a
> no-seam sibling spread of 16.09–25.89, and `?bands=shuffle` moves `minAdjacentBandDeltaE` only
> 0.815 → 0.476. (This paragraph first said 0.61–0.76, "roughly seven cells in ten". That was taken
> before DEC-812 raised the art byte budget from 67,108,864 to 155,129,856, after which dominaria no
> longer starves mid-visit — the seam's case got **stronger**, which is why the stale figure never
> surfaced as a failure. Re-measured on DEC-752, main `28d4676`.) `?art=off&swatch=mean` and
> `?art=off&bands=shuffle` are the composed rows that discriminate, and measured they do: the first
> reads 0.954 / 4.673 against a `?art=off` sibling at 17.92 / 16.50. `?layers=0` is *also*
> swatch-only (§1.6's zero-layer pool) and is **not** a substitute: it moves `pool.layers` — the
> quantile's own divisor — and composes no `ArtStream` at all, so its payload reports `stream` as
> `null`, which would run W2's and W3's controls against a differently-configured renderer.

> **Normative — `showingArt` means the cross-fade has landed, not that a layer was claimed
> (DEC-752).** The probe reports a cell as showing art when its `iArt` has reached 1, not when the
> pool handed it a layer and not when the fetch resolved. W4's numerator is "what the frame shows",
> and a cell mid-fade is showing its swatch. After §3.1's 5 s settle no fade is in flight, so this
> is conservative by nothing at the measured pose — but it is the difference between W4 measuring
> the picture and W4 measuring the bookkeeping, which is exactly the distinction the prototype's
> 1,031-resident-in-1,024 bug hid behind.

> **Normative — the admission height is the *projected rect's*, and it is the same call §3.1's
> payload makes (DEC-749).** A cell's on-screen height has two plausible spellings: the small-angle
> extent `2·latArc·radius` over the cell's depth, and the height of the bounding box of the
> projected sphere-following vertex grid. They are not the same number — measured over the shipped
> roster at §3.1's 2.2-radii pose they differ by up to **79%** on the same cell, because the
> small-angle form carries no foreshortening and so sizes a cell at the limb as though it sat at the
> centre of the disc.
>
> §3.1 reports `wantsArt` as `rect.height >= effectiveThresholdPx`. If the renderer admits on the
> other spelling, **that field describes a predicate the renderer never evaluated**, and W4 scores a
> quantity nothing in the shipped path computes. The failure is silent in the worst way: the picture
> stays correct, because the sheet is drawn by the shader from its own attributes, and only the
> *measurement* moves. One quantity, one call site — renderer and probe reach the same
> `cellScreenRect`. The same reason keeps the stored height a double: narrowing it to `float32` puts
> the two a rounding step apart at the threshold boundary, which is exactly where W4's cells sit.

> **Normative — residency drives the picture, admission drives the asking (DEC-749).** A cell draws
> art when the pool holds its key *resolved*; a cell *asks* for art when it is above the frame's
> effective threshold **and** passes §1.6's facing and frustum tests. Deliberately two predicates:
>
> - **Fading toward a RESERVED layer shows the previous card's pixels.** A reserved layer holds no
>   art yet, so the fade may only advance once the fetch has landed. Keying it on what `reserve`
>   returned cross-fades every cell into whatever its layer held before it was claimed.
> - **Eviction has to pull the picture back, and only a per-frame re-read can.** A cell holding layer
>   `L` at `iArt = 1` whose key is evicted goes on sampling `L`, which now belongs to another card —
>   the **wrong card's art, at full opacity**, for as long as the cell is on screen. There is no
>   eviction callback, and adding one would put the invariant in two places.
>
> Tying the picture to admission instead would also flicker exactly the boundary cells the
> threshold's one-sided hysteresis exists to hold still. Note that the renderer's admission is
> strictly narrower than the reported `wantsArt`, which is the size test alone: §3.1 reports
> `frontFacing` and `onScreen` beside it so the gate can recover either predicate, and folding them
> into the reported field would leave it unable to tell a cell that was too small from one that was
> merely turned away.

Fetch discipline: `mode: 'cors'`, `credentials: 'omit'`, at most 6 concurrent (PRD 7.2's politeness
cap — the `*.scryfall.io` origins have no rate limit, `docs/scryfall-policy.md` §4, but the cap is
worth keeping), cache-busted by the contract's own `imageTs`, a failed key never retried in the same
session, and a byte budget on **outstanding art spend** that degrades to swatch-only while it is
exceeded. Eviction is LRU with a 30-frame grace: a layer wanted this frame is never evicted.

> **Normative — four of those five rules are the card tier's queue, and the worlds path reuses it
> rather than opening a second one (DEC-749).** PRD 7.2's "concurrent image requests to Scryfall: 6"
> is a budget against the *origin*: thumbnails, the focused card and the worlds surface share one
> queue, and three queues of six would be eighteen. `cors`/`omit`, the concurrency cap and the
> no-retry rule live in `scene/cards/imageQueue`; the `imageTs` cache-bust lives in `data/images`'
> `imageUri`. Only the **byte budget** is new, and it is the one rule that could not be inherited —
> a budget against the network cannot be read off a decoded `ImageBitmap`, whose footprint is a
> constant `128*96*4` whatever crossed the wire. The queue therefore reports `Blob.size` on its
> result, on the **failure** variant as well as the success one: a body that arrived and then failed
> to decode has been paid for, and a budget that charged only successes would under-count exactly
> the traffic it exists to bound.
>
> **Normative — the budget is charged when a request *issues*, and reconciled when it settles
> (DEC-780).** Charging `Blob.size` on completion and comparing the running total is the obvious
> reading, it is what shipped, and it **cannot bind on this workload**: the selection pass issues
> every want for a pose in one frame, so all 967 requests test the budget at `bytesFetched === 0`
> and all 967 pass; later frames return early on a resident or in-flight key and never re-consult
> it. Measured at §3.1's pose, that spent **88.7 MiB against a 64 MiB budget**. An issuing request
> therefore reserves an estimated body size up front and releases that estimate for the real
> `Blob.size` when the queue settles it — on *every* settlement, `dropped` and `cancelled`
> included, or a stream goes permanently swatch-only on bytes it never spent. `swatchOnly` is the
> sum of **outstanding and in-flight** bytes (amended by DEC-812: it read "landed and outstanding"
> while the landed total was the thing tested).
>
> > **What binds is a request count, and the overshoot is the estimate's error.** `byteBudget /
> > estimate` bodies may be outstanding at once, and each that settles hands its estimate back and
> > leaves the real body standing in `bytesOutstanding` instead. Measured, one harness across both
> > trees at §3.1's pose: **729 responses / 70.2 MiB, +9.7%** against **967 / 88.7 MiB, +38.6%**.
> > The admitted set is a nearest-first *prefix*, so its 100,996-byte mean runs ~5% above the
> > roster's 96,159-byte population mean; predicting the overshoot from the population mean
> > under-states it. **Both rows are one pose of one world**: while the budget was session-cumulative
> > the 729th body was also the last of the session, which is the DEC-812 defect and not a property
> > of the estimate. The figures survive as the provenance of the 100,996-byte admitted mean that
> > `defaultByteBudget` is sized from.
>
> > **Do not gate on `declinedBudget > 0`.** The unfixed stream declines too — 23,715 times in a
> > 32 s run — but only *after* the 88.7 MiB has landed, because the running total is over budget
> > by then. Both trees read "declines happen", so the signal separates nothing. What separates
> > them is the bytes that crossed the network. This is §3.1's W4 measure being carried by the
> > wrong signal, arising in the instrument rather than the renderer.
>
> **Normative — the budget bounds what is *outstanding*, and eviction reclaims (DEC-812).** The
> quantity tested is settled bytes standing behind **resident layers**, plus in-flight reservations;
> when the pool's LRU evicts a layer, the stream credits that key's own body size back. This
> paragraph used to say "a **per-session** byte budget", and the renderer implemented that literally
> — a running total nothing ever subtracted from. **That sentence is amended here, and the reason is
> a measurement.** Leg G's first clean 45-world acceptance tour (main `28ec706`, dataset `worlds`,
> real Chrome + Metal) found `bytesFetched` crossing 64 MiB at the **eighth** world and then freezing
> exactly, along with `requested` and `resolved`: `artFraction` ran 0.989–1.000 through the first
> eight worlds and **0.000 on all thirty-seven after them**, for the life of the page. The cut was a
> step function of *tour position* and not of demand — a 676-cell world early got full art, a
> 302-cell world late got none — and `pool.evictions` read **0 on all 45 worlds**, which is the tell:
> the budget refused before the pool was ever consulted, so the LRU never ran and never reclaimed.
> Swatch-only is a live condition a session comes back out of, not a terminal one.
>
> > **The default is derived from the pool, not typed in.** A budget below what a full pool costs in
> > settled bytes rebuilds the deadlock in residency spelling: the pool fills, the budget is at its
> > limit, nothing further is asked for, so nothing is evicted and nothing reclaimed. The retired
> > 64 MiB constant was exactly there — 1,024 layers at the measured 100,996-byte admitted mean is
> > **98.6 MiB**. So `defaultByteBudget(poolLayers)` sits a headroom factor above a full pool, which
> > makes the **pool and the threshold** the binding constraints and the budget a backstop behind
> > them; §1.12's ladder moves the pool rung and the budget follows it down. §1.12's `byteBudget`
> > knob remains, and a value set *below* a full pool is a deliberate spend cap that degrades the
> > way the paragraph below says.
>
> > **Nothing may hold charge that no eviction can release.** A body that arrived and would not
> > decode, and a body that landed after its reservation was taken away, are both charged to the
> > session ledger and **not** to the outstanding total: neither has a resident layer behind it, so
> > no eviction could ever credit them back. What bounds the decode-failure path instead is §1.6's
> > own no-retry rule — a failed key is never asked for again in the session.
>
> **Normative — degrading is not tearing down.** Over budget the stream stops *asking*. Layers
> already resident keep drawing their art and are not evicted; §1.4's shading path degrades to the
> swatch only for cells that never got one. **The reclaim above does not contradict this, and the
> direction is what separates them**: the pool's LRU decides what to evict, under demand for
> *layers*, and the budget follows it down; the budget never asks for an eviction to buy itself room. The probe reports `swatchOnly` so the gate can read it
> before it reads W4 — a session that went swatch-only part-way has a legitimate reason for a low
> art count, and scoring that as a threshold failure is W4 being carried by the wrong signal.
>
> **Normative — a dropped request is not a failed one, and conflating them is a session-long bug
> (DEC-749).** The pool needs a fourth transition beside `reserve`/`resolve`/`fail`: a **release**
> that hands a RESERVED layer back *without* entering the never-retry set. `imageQueue` already
> distinguishes `'failed'` from `'dropped'`/`'cancelled'` for this reason — a cell that drifted out
> of the admitted set while its request waited must be fetchable when the camera comes back. Marking
> it failed makes it unfetchable for the session; leaving the reservation in place leaks a layer per
> drop. Release only ever takes back a RESERVED layer, so a cancellation arriving after the fetch
> landed is inert and cannot evict a picture that already exists.

**Letterboxing is a decode-time decision, not a draw-time one (DEC-749).** `art_crop` is 626x457 and
a layer is 128x96 — `1.370` against `1.333`, a **2.7%** horizontal stretch, which reads as a subtly
fat card face repeated across a hemisphere. `createImageBitmap` scales to exactly the width and
height it is given and does not preserve aspect, so the fitted size (`128x93`, centred with a
one-texel bar) is what the decode must be *asked* for; handing it the full `128x96` bakes the
stretch in where nothing downstream can undo it. Fit to whole texels, so the residual aspect error
is **under 0.5%** rather than zero — that is the quantity to assert, since an exact-equality
assertion fails on the correct implementation.

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
cards. At the home view that is all of `worldsWithCards` (§3.1) — **29** on the 87-plane roster,
**45** on v3; with one world near enough for its cell sheet it is one fewer.

> Mixed straight, they come out the same grey, because Magic's colour pie is balanced — the same
> finding that makes the shipped arm-skew law inert (review §4.1). So the mix runs on the
> **deviation from the card-weighted multiverse mean**, amplified ×3.2: a plane at the average is
> grey, a plane that is unusual is unusual in the direction it is unusual in. Alara's 58% gold and
> Ravnica's 39% multicolour are what this exists to show. The stretch is a choice; the grey is the
> data. Undetailed worlds are additionally dimmed to 0.3 so a neighbour does not outshine the world
> being looked at.

**Dark moons.** `√0 = 0`, so the empty planes — **57** on the 87-plane roster, **42** on v3 — take
a floor radius of 0.55 and a near-black colour (0.035, 0.038, 0.05) with no palette tint.
**Present, unlit, and unlabelled until hover.** Today they
are dim glows that PRD 5.3.8 obliges the app to label, which is how the home view ends up as 82
labels over 30 real objects (review §4.1). Emptiness becomes a colour and not a size — which is true
only because §1.3's radius law carries the **same** 0.55 floor. Unfloored, v3's fifteen sub-20-card
worlds are drawn smaller than these moons and emptiness becomes the largest thing in that cohort.

> This needs a **PRD 5.3.8 amendment** (§6) and it is measured by acceptance criterion **W5** (§3.1).

**The belt.** The Blind Eternities — 4,980 cards and 17.4% of everything on the 87-plane roster,
**4,204 and 14.70%** on v3, the largest population after Dominaria on both — stops pretending to
have a shape and becomes a belt around the whole system at
**1.12 × `multiverseRadius`** (145.6 units on production). One arc per set, in chronological order,
each set taking its share of 360° with a 6% gap at each end so "one arc per set" is legible rather
than a continuous smear. Radial jitter ±6%, vertical jitter ±3.5% of the belt radius, both from a
deterministic hash — a mathematically clean ring reads as a UI element, not as debris. Colour is a
year ramp, HSL hue 0.62 → 0.0, cold at 1993 to warm at 2026.

> **Normative — the belt turns with the multiverse (DEC-814, ruling on DEC-813).** PRD 5.3.13's
> *"the entire multiverse rotates about its vertical axis"* covers the belt, and PRD 8.5.3's
> rotation applies to it for the ordinary reason: its points **are** star records, the dust plane's
> own, scaled by `multiverseRadius` (§2.1). PRD 5.3.13 names the background parallax as the fixed
> reference; the belt is data, 14.70% of everything on v3, and there is no exemption anywhere in
> this document or the PRD. The renderer takes the **same accumulated angle the worlds take** —
> `SceneMotion.multiverseRotation`, which is the number `planePosition` has already rotated every
> world by — and applies it as the belt object's own `+Y` rotation, because the belt is the one
> object in §1.2 centred on the system origin rather than at a plane position. The buffer stays at
> t=0; a second integration of the angle is the failure `docs/camera-and-labels.md` §2 records. It
> matters because the belt is clumped in azimuth by construction — one arc per set — so a fixed belt
> shears a full turn against every world per `MULTIVERSE_PERIOD_S` while every individual frame
> still looks like a belt.

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
`planets.ts:48` computes `const shown = Math.min(printings, PLANET_CAP)`, and the remainder is _not_
dropped: `planets.ts:35-37` declares `overflow` — "Printings past the 72 the rings can hold. PRD
5.6.8 sends these to the card panel" — `planetLayout` returns it, `focusedCard.ts:243` exposes it as
`printingOverflow`, and `ui/CardPanel.tsx:181` already renders `Printings ({printings.length})`, the
true count, with `:184` listing **every** printing uncapped. All 570 Swamp rows are in the panel
today. So "the card panel states the true count" is not a requirement this spec introduces; it
shipped.

Counted over all 93 production shards, the cap binds on **5 cards** — the five basic lands, Swamp
570, Mountain 565, Forest 563, Plains 537, Island 535 — and nothing else comes within 12 of it (next
is Sol Ring at 60). It is a five-card edge case, not a 669-card one; 669 is the count of cards with
more than **9** printings, a different predicate.

What is genuinely missing is the visual tie between the ring and the tail: nothing in the scene
marks _which_ printings the ring dropped, or that it dropped any. The ring inherits the cap for v1 —
this spec does not widen product scope — and adds only that: **when printings exceed the cap, the
ring shows the cap's worth as quads and the remainder as 1 px ticks at their own release angle.**
The ticks are the requirement; the panel already holds up its end. On production this draws on five
cards, so it is cheap to build and cheap to get wrong unnoticed — pin it with a unit test on the
tick positions, not with a capture. See §5, Q5.

> **Normative — "its own release angle" is its own fraction of the release *order* (DEC-751).** A
> tick for printing `i` of `n` sits at `2π · i / n`, measured like every other angle on the ring.
> It cannot be derived from a date: a `PrintingTuple` is
> `[id, setId, rarity, imageTs, collectorNumber, artist?]` and carries no release date at all. What
> it carries is its position, because the tuples arrive ordered by release (PRD 5.6.7, contract
> §7) — so the ring is a clock of that order and a tick marks where on it the dropped printing
> falls. Spacing the ticks over the *tail* instead (`i − 72` of `n − 72`) spreads Swamp's 498 marks
> evenly around the circle and says nothing about where in the card's history they sit, which is
> the one thing this section wants shown. The quads keep PRD 5.6.8's own spacing — even within the
> ring they landed in — so the two spacings differ on purpose.
>
> **Landed as one `Points` object per card, rotated on the orbit**, not one object per tick: 498
> marks would otherwise be 498 draw calls, and a single angle is what guarantees the tail cannot
> drift against the quads.

> **The sphere-to-quad conversion has landed (DEC-751).** `focusedCard.ts` builds one
> `PlaneGeometry` of 0.125 × 0.174 — the width **derived from the 146 × 204 of the `small` image it
> shows** and the height **derived from the ring**, so neither the undistorted claim nor the
> clearance claim is a number that has to stay in agreement with another number. It needs no
> billboarding: PRD 5.6.1's root already turns to face the camera each frame and the ring hangs off
> it. The pick mesh shares the geometry object, and the quad is larger than the 0.116 sphere it
> replaces in **both** dimensions, so no printing became harder to click.
>
> **The height a ring can hold is set by the quad's diagonal, and the first attempt got it wrong
> (DEC-776 F1, fixed in DEC-779).** The quads are axis-aligned in the card's frame and the ring
> turns underneath them, so two neighbours a chord `c` apart are offset by `(c·cos φ, c·sin φ)` for
> a `φ` that sweeps the whole revolution. Axis-aligned rects of equal size overlap exactly when
> *both* offsets fall inside the box, so they clear **at every phase of the turn** if and only if
>
> ```
>   c ≥ √(W² + H²) = H · √(1 + (146/204)²)
> ```
>
> The first conversion sized the quad by checking its width against the arc and its height against
> the 0.30 radial gap. That is the configuration at the *top* of the ring only: a quarter-revolution
> later the arc is spanned by the quad's height, and 0.24 exceeded the inner ring's 0.214 chord. It
> shipped a ring whose inner two circles overlapped — 16 simultaneous pairs, up to 10.8% of a quad's
> area, onset at exactly 18 printings and reaching 168 of the production roster's 28,603 cards —
> with every planet at `z = 0` and an opaque material, so which quad won was a depth tie. The height
> is now solved from the tightest full ring's chord at equality, which makes it the largest height
> §1.10's ring can hold; `test/cards.test.ts` sweeps a full revolution through the shipped
> `planetLayout` / `planetPosition` and carries the pre-fix height as a positive control, because
> the defective arrangement is green at `t = 0`.
>
> **Two things did not survive the conversion, and both would have failed silently.** The wrapped
> lambert collapses to a single constant on a flat quad — it would have dimmed every printing by
> 0.86 forever and read as a deliberate choice — and PRD 5.6.9's fresnel rim collapses to
> *identically zero*, because the quad faces the camera by construction. Carried across, `uActive`
> and `uHover` would still be bound and still be written, multiplying into nothing: the active and
> hovered printings would simply stop being marked, with no error and no unwritten uniform to
> catch it. The rim is therefore distance to the quad's **own edge**, scaled by both quad
> dimensions so the border is even on four sides rather than 1.4× thicker on the left and right.
>
> The conversion also retires PRD 8.5.10's decode-time downscale here: it existed because an
> `art_crop` arrives at 626 × 457, and a `small` arrives already below the 256 px it was aiming
> for. §1.12's printing-ring row falls from 13.15 MiB to the 8.18 it always priced.

### 1.11 Picking, labels, filters

- **Picking.** The id-buffer picker is kept wholesale; only its subject changes. The cell sheet
  renders `gl_InstanceID + 1` into the pick target, and the instance index maps to a card through
  the same instance-order array the sheet is built from. Cell picking replaces star picking at plane
  level; card focus and the printing ring pick as they do today.

  > **Normative — the plane-level pick proxy carries a screen-space floor (§1.3, DEC-751).** Below
  > the art threshold a world is picked as a *plane*, through a world-space `radius × 1.15` proxy,
  > and that proxy cannot express a pixel target (§1.3 rules out raising the radius floor to chase
  > one). The plane-level proxy is therefore floored **in screen space** at **24 CSS px of
  > diameter**, applied after projection, per frame, per world. It floors the *pick* proxy only — it
  > never scales the drawn world, so §1.3's radius law and §1.8's moon relationship are untouched.
  >
  > **What the floor guarantees, and what it does not.** It guarantees a 24 px *proxy*. It does
  > **not** guarantee a 24 px *target*, and this section must not be read as claiming one. Floored
  > proxies overlap each other and the nearer disk takes the pixels, so a world's *effective*
  > hittable area is smaller than its proxy wherever the crowd is dense. The two claims that survive
  > measurement (DEC-751 `628d9bc`, re-measured by R1 at a second sweep and under the picker's own
  > ordering rule) are:
  >
  > 1. **The floor never makes a world less pickable than it was as drawn.** Samples with zero
  >    effective target are strictly *fewer* with the floor on than with every world at its drawn
  >    `radius × 1.15`. The worlds that are dead anyway are genuinely behind `innistrad` /
  >    `new-phyrexia`, and no pick policy recovers those.
  > 2. **Nothing silently swallows a neighbour.** Total effective area is conserved; the floor
  >    redistributes it, it does not manufacture it.
  >
  > Everything else is residual exposure, and is recorded as a count rather than a guarantee:
  > **19 of the 33 worlds the floor lifts somewhere in the turn fall under 24 px of effective
  > diameter at some azimuth**, and some of those already cleared 24 px as drawn — the floor itself
  > is what pushes them under, to a worst of **~20.6 px**. Those counts move with the sweep and with
  > `home`; see the warning below.
  >
  > *Corrected on DEC-759 (review DEC-865, item 1).* This paragraph read "**2** worlds (`eldraine`,
  > `kamigawa`)", from R1's probe at 24 and 37 azimuths. Re-measured on the committed instrument —
  > `pick-floor-screen-space.test.ts` and `pick-target-separation.test.ts`, which now share
  > `web/test/effective-target.ts` — it is **7** at 24 azimuths and **6** at 36, 37, 48, 72 and 144,
  > and the ~20.6 px is **`kaldheim`** (20.60 at 24 azimuths, 20.55 above it), not either of the two
  > named. `eldraine`'s own worst floored effective diameter is 11.09 px, which is occlusion rather
  > than the floor. The **6** is the same 6 the next paragraph calls floor-on-floor: this sentence
  > and that one are two readings of one statistic, not two statistics. The figure survived the
  > re-measurement; the count and the names did not, which is exactly what the warning below says
  > will happen.
  >
  > **Most of that shortfall is not the floor's to fix, and that is why no overlap rule is adopted.**
  > Re-run with the neighbours' floors switched off, so only a disk something really draws can take a
  > pixel, and **13 of the 19 fall short anyway** — they are behind nearer geometry, which is
  > ordinary occlusion. Only the remaining **6** are floor-on-floor, so that is the entire budget any
  > tie-break, Voronoi or otherwise, could ever recover.
  >
  > **Conformance basis.** WCAG 2.5.8 is where the 24 px constant comes from, and it is not what
  > makes the product conform. Conformance rests on the criterion's **Equivalent** exception: every
  > plane is indexed in the search path as a `kind: 'plane'` hit (`web/src/search/index.ts`) and is
  > reachable by name through a full-size control that meets 2.5.8 on its own. **R3 pins that as a
  > test — every world slug in the roster is a reachable search hit — and the pin is a release
  > requirement, not a nicety**, because it is the only part of this section that is a conformance
  > argument. The proxy floor is a usability improvement layered on top of it.
  >
  > **Rejected alternatives (R1 ruling, DEC-749).** A nearest-proxy-centre (Voronoi) tie-break was
  > measured and is **not** adopted. Three reasons, in order of weight: it can reach only 6 of the 19
  > short worlds at all (above); it takes the under-24 count from 19 to 26 of 33 and regresses three
  > worlds, because screen area is conserved and a tie-break only moves it; and the plain floor
  > already regresses two worlds, so "it regresses worlds" is a cost both options carry rather than a
  > discriminator. Reaching a real 24 px target means separating worlds *on screen* — a layout change
  > to the `home` law in §1.3/§2, outside both R1 and R3, and landed separately on DEC-759 (the
  > normative block at the end of this bullet). Do not retune the tie-break to make this section's
  > wording true.
  >
  > The obvious objection does not hold: inflating the proxy does not make small worlds steal their
  > neighbours' picks. Over the 15 worlds that the *world-space* pass on `3ce85aed` found floored,
  > clearance to the nearest pickable neighbour admits **7.9× – 33×** inflation before the disks
  > touch, against the **6.3×** the worst one-card world needs — so nothing collides, but `karsus` at
  > 7.9× leaves only ~25% headroom.
  >
  > **That margin is not a durable constant, and must not be treated as one, and neither is any
  > count in this section.** The margin is a function of `home`, which moves on every dataset
  > refresh: the same 15 worlds on `dabe2c9a` clear at 17.6×, with a different world (`vryn`)
  > tightest. The counts are a function of azimuth: the world-space pass reports **15** worlds
  > floored, the screen-space pass **33**, because the scene turns (§1.2, `motion.ts`). **Carry no
  > single-azimuth number out of this section.** The invariant that survives a refresh is only *no
  > collision at the required inflation* — that is what `surface-law-check.py` asserts, and it
  > reports the headroom rather than pinning it. The screen-space check and the implementation are
  > R3's; the tie-break is ruled out above, so R3 implements the plain floor.

  > **Normative — the layout half, and what it delivers (DEC-759).** The sentence above sends the
  > 24 px *target* to the `home` law, and this is that law. `place_planes` now satisfies two rules
  > rather than one, and they are about different things:
  >
  > 1. PRD 5.3.3's world-space margin, unchanged: the **drawn discs** clear each other at maximum
  >    drift.
  > 2. **The home-view separation rule:** the **pick proxies** clear each other on screen, at every
  >    azimuth of the turn, for every pair with a card-bearing plane in it. In world units, for
  >    planes `a` and `b` whose in-plane centres are `d` apart,
  >    `(d − closureₐ − closure_b) · sin(30°) ≥ ρₐ + ρ_b`, where `ρ = max(1.15 · radius, 12 px at
  >    the disc's deepest point)` — the drawn proxy or **half** this section's floor, because `ρ`
  >    is a radius and the floor is 24 px of diameter. `sin(30°)` is the home view's own
  >    compression: PRD 8.6.1 puts the eye 30° above the disc, so in-plane distance projects at
  >    half its length, and that is what buries a world.
  >
  > **Three details in that formula are the difference between a rule and a wish**, and each was
  > caught by measuring rather than by reading:
  >
  > - **The floor is converted at the disc's far rim**, `(1.9 + cos 30°) · R`, not at the camera's
  >   distance to the origin. A pixel buys more world units the further away it is; converting at
  >   1.9 R under-sizes the floor by 46% out there, and the proxies of two far-side planes then
  >   overlap by up to 11 px while satisfying the rule. The `1.15 · radius` branch needs no such
  >   care — a drawn proxy and the gap to its neighbour shrink with depth together.
  > - **`closure` covers the vertical drift as well as the horizontal.** `home` being flat does not
  >   make the rendered plane flat: PRD 5.3.15's drift lifts it by `DRIFT_VERTICAL_RATIO = 0.35` of
  >   its amplitude (`web/src/scene/tuning.ts`), and a unit of height cancels `cot(30°)` units of
  >   in-plane distance. So `closure = a · (1 + 0.35 · cot 30°) = 1.606 a`, a bound rather than the
  >   true joint maximum of 1.393 a, chosen not to depend on the phase law the two terms share.
  > - **Moon-on-moon pairs are exempt.** It costs no world its target — the pair that can bury a
  >   world always has the world in it — and the 42 empty planes are all at the radius floor, so
  >   demanding it of them too asks 44% of the disc's area from a sequential sampler that jams near
  >   55%. The all-empty roster, which the pipeline's own tests build, cannot be placed at all
  >   under the unexempted rule. The exemption is not free, and the price is a moon's own target:
  >   over the 861 moon-on-moon pairs at 144 azimuths, overlapping floored proxies go **23 → 47**
  >   and the moons under 24 px of effective diameter **24 → 25 of 42**. The severity inverts
  >   though — the worst moon effective diameter goes **0.00 px (buried) → 14.62 px**, so under the
  >   law no moon is lost outright and more of them graze. Moons are unlabelled until hover (§1.8)
  >   and every plane stays reachable by name through the search path, which is why this is a price
  >   worth paying and not a regression to fix.
  >
  >   The attempt budget rises from 4,000 to **20,000** because the second rule is much harder to
  >   satisfy by rejection than the world-space margin alone was. That figure is
  >   measured, not estimated: counting `rng.unit(slug, "r", attempt)` per plane, the hardest plane
  >   needs **189** draws on the densest roster the tree builds, 165 on `fixture-scale`, **51** on
  >   the production roster and 1 on the two four-plane rosters; the median plane on the dense
  >   roster takes 3, and `place_planes` runs in 4.6 ms over the whole production roster. 20,000 is
  >   ~106× the worst of those. A roster with genuinely no room raises in 0.06 s at this budget.
  >   (An earlier draft of this section claimed "about 19,000 draws" and set the budget to 200,000
  >   on that basis. Nothing in the tree approaches 19,000 — DEC-865, item 9.)
  >
  > **The planes also sit flat in the disc plane now.** Over a turn a pair's worst screen
  > separation is `|d · sin(30°) − Δy · cos(30°)|`, so 8 units of height *cancels* 14 units of
  > in-plane distance: PRD 8.6.1's ±0.075 R scatter was manufacturing the coincidences rule 2
  > exists to prevent, and an in-plane rule cannot see it happen.
  >
  > **Measured** on the production roster at §1.3's reference viewport, 36 azimuths — the counts
  > are minima over the sweep, so they move with its density until it converges: the shipped arm
  > reads 12 occlusion-only at 24 azimuths and 13 at 36, 48, 72 and 144.
  >
  > | | shipped `home` | under this law |
  > |---|---|---|
  > | worlds the floor lifts somewhere in the turn | 33 | 32 |
  > | of those, under 24 px of effective diameter | 19 | **0** |
  > | **occlusion-only — the layout's half** | **13** | **0** |
  > | floor-on-floor — §1.11's own half | 6 | 0 |
  > | worst effective diameter, any lifted world, occlusion-only | **0 px** (buried) | 24 px (nothing lost) |
  > | worst effective diameter, any lifted world, floored | **0 px** (buried) | 24 px (nothing lost) |
  > | floored proxies that overlap at any of 144 azimuths (2,880 pairs with a world in them) | 68 | **0** |
  >
  > An earlier draft of this table carried a seventh row, "worlds pushed under 24 px that cleared it
  > as drawn: 3 → 0", with a rider about azimuth grids not nesting. It is **withdrawn**: no
  > instrument in the tree produces a 3, and under the definition the committed instrument can
  > express — short under the floored rule, clear under the as-drawn one — it is the *floor-on-floor*
  > row above, which reads **6**. One statistic, printed twice, with the second copy wrong
  > (DEC-865, item 9). The `→ 0` half held under every definition tried.
  >
  > **Seven seeded draws of each arm, not one**, because a layout is a draw and `home` moves on
  > every refresh (72 azimuths; `docs/worlds/dec759-separation-study.py` reproduces all 28):
  >
  > | arm | occlusion-only | worst occlusion-only px | under 24 px of effective diameter |
  > |---|---|---|---|
  > | PRD 8.6.1 as it was | 7–21 | **0 in every draw** | 11–22 |
  > | flat disc only | 3–9 | 0–22.4 | 9–20 |
  > | separation rule only | 0–5 | 21.4–24 | 1–6 |
  > | **both — this law** | **0–2** | **19.7–24** | **0–3** |
  >
  > Under the floored rule the same seven draws of this law run **19.68–24.00 px** at their worst,
  > and that range is what `pick-target-separation.test.ts`'s durable bound is set against. It also
  > says what that bound cannot do: converting the floor at `1.9 R` instead of the far rim lands at
  > **20.64 px**, *inside* the law's own range, so no bound on this number separates that regression
  > from a legitimate reseed. The committed layout's exact 24.00, and the far-rim cross-check in
  > `pipeline/tests/test_home_separation.py`, are what do (DEC-865, item 5).
  >
  > Read that honestly: **the separation rule is the lever, and the flat disc is a consistent
  > improvement on top of it rather than half the fix.** On the production draw the rule alone
  > already reaches zero; across the seven it roughly halves the residual (mean occlusion-only 2.1
  > against 0.6, mean short-under-floor 3.1 against 1.1). The flat disc's own arm is the weakest of
  > the three, which is the answer to "is the thickness the problem" — it is not, on its own.
  >
  > **Two limits.** The rule is written against the reference viewport and the floor is 24 CSS px on
  > *any* viewport, so it buys less on a shorter one: at 1280×720 the two layouts read **22** and
  > **1** occlusion-only, at 3840×2160 **5** and **0**. And **production only carries the law when a
  > dataset refresh re-lays it out** — until then `docs/worlds/dec759-home-law.json` carries the
  > candidate homes, `pipeline/tests/test_home_separation.py` pins that file to `place_planes`, and
  > `web/test/pick-target-separation.test.ts` measures both arms so the shipped one stays the
  > control. All three retire on that refresh, and say so where they fail.
  >
  > **Rider, not acceptance:** world-label coverage over 24 azimuths goes from a mean of **97.2%**
  > (min 93.3%) to **99.5%** (min 97.8%). Separating pick proxies separates label anchors too.

- **Labels.** The label solver is kept. Under worlds its home-view subject count is
  `worldsWithCards.length`, not the plane count, because the moons are unlabelled until hover
  (§1.8) and the belt is dropped before projection (PRD 5.3.4, and §3.1's W5): **29 of 87** on
  today's roster, **45 of 88** on v3. The label tick stays after the final camera matrices, per
  W4.2.

  > **Landed (DEC-751), derived from the data rather than from a version.** `PlaneLabels` narrows
  > its subject to the planes carrying `rowCells` — §2.4's field to test for — which is empty on a
  > v2 dataset, so a galaxy page keeps PRD 5.3.4's rule untouched until the cutover. The narrowing
  > is not cosmetic: the solver seats a bounded number of labels per frame and `priority` only
  > *orders* them, so the 42 moons were not competing for their own names, they were taking them
  > from the worlds.
  >
  > Plane labels also carry **`data-plane-slug`** (`gate-seam-contract.md` §2a, owed to leg G).
  > The `tier === 'plane'` guard on it is load-bearing: a band's key is `${slug}:${code}`, so
  > without it a W5 sweep would count a focused plane's set names as worlds.
- **Filters.** The GPU filter-mask subscription W1.2 landed (review F1) is kept and rebound: a
  filtered-out cell drops to its swatch and dims, and **never** dims its art.

  > **Landed (DEC-751), in two halves that fail differently.** Admission excludes a filtered cell,
  > so it never asks the stream for a printing and never holds a layer a visible cell could use;
  > and a cell filtered *while* it already held one releases it, because `claimLayer` refuses
  > eviction within `EVICTION_GRACE_FRAMES` and the card would otherwise stay at full art for as
  > long as the LRU left it resident. The dim multiplies the swatch term **before** the art mix, so
  > "never dims its art" is structural rather than a convention. The mask is read through the
  > cell's *card*, not its index, because `?bands=shuffle` permutes the two. Dimming a card image is
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
| Equirect swatch array, 45 × 256 × 128 × 4 | 5,898,240 | 5.62 |
| Cell instance attributes, 24,399 × 48 B | 1,171,152 | 1.12 |
| Printing ring, 72 × `small` (146×204×4) | 8,577,792 | 8.18 |
| Focused card, `large` (672×936×4), one face | 2,515,968 | 2.40 |
| **Total** | **68,494,800** | **65.32** |

Under target with **30.7 MiB** of headroom, and **lower than today's worst case** — which is the
first place concept B pays for itself rather than costing.

> **The cell row is 48 B, amending DEC-749's 40 (DEC-751).** §1.11 adds two floats to it, and they
> are separate attributes rather than sentinels packed into `iArt` for the same reason in both
> cases — different writers, and one array with two writers is the defect the pool's three states
> exist to prevent one level down.
>
> - **the filter's dim**, written by the store's evaluation on change where the art stream owns
>   `iArt` every frame;
> - **picking's `iStar`**, written once at build. Note that this one is *not* §1.11's
>   `gl_InstanceID`: that is 0-based per sheet, and §1.2 keeps all 45 sheets resident, so it would
>   alias every world's cell *n* onto every other world's cell *n* in a buffer that carries no way
>   to tell which mesh wrote the pixel. It carries `artKeyBase + cardOfCell[cell]` — the card's
>   star index — which is the same cure `artKeyBase` applies to the art pool one level down, and
>   which lands the pick in the id space `scenePicker.resolvePick` already resolves.
>
> `test/worlds-cell-sheet.test.ts` proves the figure from the geometry rather than restating it, so
> the next attribute moves this row automatically.

> **The printing-ring row is now what the ring allocates (DEC-751).** It priced §1.10's flat quads
> from the start, and while the ring still uploaded 72 `art_crop` textures at PRD 8.5.10's 256 px
> it cost **13.15 MiB** against this table's 8.18 — a 4.97 MiB gap the budget reported honestly
> rather than papering over. §1.10's conversion has landed, so the row and the table agree and the
> **65.32 MiB** total above is the real one. `test/worlds-budget.test.ts` asserts the allocation
> rather than this table, and pins the row's *provenance* — the cap times the bytes of the image
> `rebuildPlanets` actually requests — because this is the one row that takes no varying input and
> so is the one row a transcribed constant could sit in undetected.

> **The two dataset-dependent rows are v3's** (45 worlds, 24,399 cards on worlds — §1.2). On the
> 87-plane roster they are 29 layers / 3.62 MiB and 23,607 cells / 1.08 MiB, for **63.29 MiB**
> total. The refresh costs **+2.04 MiB**, almost all of it the equirect array — the only place in
> this spec where the roster's new shape moves a budget row. Both rows are `.length`s of §3.1's
> derived sets: a renderer that allocates either from a constant is wrong on one of the two datasets
> it is guaranteed to meet.

> The focused-card row counts one face. Today's worst case counts two, because a double-faced card
> uploads both (`focusedCard.ts:702`, and `worstCaseCardBytes` multiplies by 2). A DFC in focus adds
> 2.40 MiB for **67.72 MiB** and 28.28 MiB of headroom; the conclusion is untouched either way, but
> the DFC figure is the one to assert against, because it is the one `gpuMemory.ts` computes.
>
> **Every derived figure in these notes is computed from `worldsBudgetReport`, not carried by hand,
> and four of them were not (DEC-776 F2, fixed in DEC-779).** §1.11's `iStar` moved the cell row
> 44 B → 48 B; the table above was updated and these notes were not, so the DFC total, the DFC
> headroom, the 87-plane cell row, the 87-plane total and the refresh delta all went on reporting
> the 44 B arithmetic — including, on the line above, the one figure this section names as the one
> to assert against. `test/worlds-budget.test.ts` cannot catch this and deliberately so: it asserts
> the budget's *conclusions* rather than its digits, because a table of literals is exactly what
> went stale. The prose is the residual that choice leaves open, so it is re-derived rather than
> re-typed whenever a row moves.

The art pool is the worlds path's contribution to W4.1's quality ladder, and it is a real rung at
every step:

**Reconciled with W4.1's shipped ladder by DEC-753's ruling, and landed in DEC-751.** The table
below is a transcription of `web/src/scene/quality/adaptiveQuality.ts`, not a parallel design: the
first draft of it moved the art pool at three rungs and omitted tier 2's bloom, which broke the one
property the ladder's own tests rely on.

| Tier | Art pool layers | MiB | Shipped rung (W4.1's knob) | Worlds addition |
|---|---|---|---|---|
| 0 | 1,024 | 48.00 | dpr cap 1.5 | — |
| 1 | 1,024 | 48.00 | dpr cap 1.0 | — |
| 2 | 1,024 | 48.00 | bloom chain (`bloomScale` 0.5 → 0.25, `bloomLevels` 8 → 7) | — |
| 3 | 128 | 6.00 | resident card imagery (atlas 512 → 256) | **art pool 1,024 → 128** |
| 4 | 128 | 6.00 | plane glow → `cheap` (one tap, no dither) | cheap rim, **on the same knob** |

**The invariant is one *knob* per rung, not one field** (DEC-747 N3, restated by DEC-753). A knob
may move several fields — rung 2's bloom moves two, because the chain's cost is a source size times
a mip count — but **no two rungs may touch the same knob**. `QUALITY_KNOBS` publishes that grouping
as data and `web/test/quality-ladder.test.ts` holds the ladder to it, so a field bolted onto a rung
that already turns a knob goes red instead of passing quietly. Three consequences of the ruling are
load-bearing here:

- **the pool steps at exactly one rung, tier 3.** It cannot also step at 2 and 4;
- **the LOD crossover does not move at tier 3.** That would be a second knob on one rung. If
  measurement later justifies an LOD rung, it gets a tier of its own in a separate change;
- **tier 4's cheap rim and cheap glow are one quantity if and only if one knob drives both.** The
  rim shader reads the same `glow` field and swaps full/cheap with it. A rim that ever needs its own
  switch is a second knob and needs its own rung.

**Why the rung is 1,024 → 128 rather than the 512 → 256 the first draft implied.** All five tiers
are clamped by `max(0, min(tierLayers, MAX_ARRAY_TEXTURE_LAYERS − 32))` (§1.6 — the outer `max` is
load-bearing: an unanswered limit reports 0 and the inner expression is then −32). WebGL 2's
*specification minimum* for `MAX_ARRAY_TEXTURE_LAYERS` is **256, not 1,024**, so on a device at that
minimum every request at or above 256 comes back as **224**. Under the retired column that read
`[224, 224, 224, 224, 128]`: tier 3 — the rung that *owns* the pool — was the one rung the clamp
made inert, on exactly the hardware the clamp exists for. At 128 it reads `[224, 224, 224, 128,
128]` and the rung is live on a spec-minimum device and on a slack one alike.

`e2e/quality.spec.ts` must assert the pool size actually changes with the tier, the way W4.1 asserts
its own rungs — and it must assert against the **clamped** value the renderer reports, not against
the constant in this table, which is what `WorldsAttachment.setArtLayers` and the probe's
`pool.layers` read-back are for.

> **A rung change recomposes the roster (DEC-751).** Resizing an array texture is a new allocation
> and every surface's material holds the old one, so the pool cannot be resized in place. The cost
> is the resident art, which the stream re-fetches under its own discipline. A rung announced
> before the first world composes is *recorded* rather than dropped — the shipped boot order takes
> exactly that path — and `?layers=N` still overrides it, so a gate row measures the pool it asked
> for.

> **W4 at tier 4 is capped, and the cap is not a defect (DEC-770 note N1).** An admitted cell with
> no layer shows its swatch, and `ArtPool.claimLayer` refuses eviction within
> `EVICTION_GRACE_FRAMES`, so `artFraction ≤ layers / admitted`. On dominaria at 1920×1080 with 128
> layers that is **66.0%** at 1.8 radii (194 admitted) and **81.0%** at 2.2 radii (158 admitted);
> both reach 100% at 224 layers. Any tier-4 W4 expectation in §3.1 must be set against that
> measured ceiling rather than against 100%, and the ceiling is a property of the rung this table
> chose — it moves if the rung does.

### 1.13 The prototype's traps, as a checklist

Every one of these cost real time in the prototype and every one of them is silent:

| #   | Trap                                                                                                                  | Where it bites |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Quad winding `[0,2,1, 0,3,2]`; CCW faces inward and _both_ failure modes look like something else                     | §1.4           |
| 2   | `Vector3.applyMatrix4` already divides by w — view-space reject before projecting                                     | §1.6           |
| 3   | `PointsMaterial` with `sizeAttenuation: true` makes belt points 70 px squares on a fly-in                             | §1.8           |
| 4   | An LRU layer pool needs `RESERVED`; two states let two loads claim one layer and `resident` climbs past the pool size | §1.6           |
| 5   | A `DataArrayTexture` ignores `UNPACK_FLIP_Y_WEBGL` — flip V in the shader                                             | §1.6           |
| 6   | A fixed world-space light puts the subject on its night side half the time                                            | §1.7           |
| 7   | `MAX_ARRAY_TEXTURE_LAYERS` has a spec minimum of 256, not 1,024                                                       | §1.6           |
| 7b  | …and W4.1 reports it as **0** on a WebGL1 or lost context, so `maxLayers − 32` is −32 layers                          | §1.6           |
| 9   | `iSize` is arc length: drop `sin θ` from the longitudinal half-extent and the polar row is 51.6× too wide             | §2.1           |
| 10  | `θ` is colatitude everywhere; read as latitude the row formula sums to 0 cells                                        | §1.3           |
| 8   | `renderer.copyTextureToTexture` changed argument order at three r165                                                  | §1.6           |

---

## 2. Pipeline and data contract

**One contract bump, `contractVersion` 2 → 3, carrying all of it**: new `stars.bin` semantics, the
new `swatches.bin`, and the `artist` field. Review §4.5 notes that layout is baked into the
artefacts, so every concept is a pipeline re-run plus a data PR; only an artist field or a per-star
colour is a version bump. Both of those are here, so they ride together.

> **The dual-scene period is free, and this is why.** Data directories are content-hashed and
> immutable, and `web/datasets.json` names which one a build uses, with `active` already separate
> from `production`. A v3 dataset is a _new directory_. The galaxy build keeps pointing at the last
> v2 dataset and is not touched; the worlds build points at the v3 one. So the pipeline leg can land,
> run, and publish a full v3 dataset with **zero risk to what is deployed**, long before any renderer
> work exists. §4 sequences on this.

### 2.1 `stars.bin` — same bytes, new semantics

The 12-byte record and the 16-byte header are unchanged, and so is the interleaved stride-12 upload.
What changes is what bytes 0–5 mean.

| Offset | Field             | v2                                             | v3                                                                                   |
| ------ | ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0–5    | `x, y, z` float16 | plane-local position within frame radius 1.2   | **unit-sphere cell centre**, `                                                       | p   | = 1`, for a plane with cards; belt position for dust, normalised the same way |
| 6      | `planeIndex`      | unchanged                                      | unchanged                                                                            |
| 7      | `colour`          | `hueClass` bits 0–2, `colourIdentity` bits 3–7 | unchanged — and still the thing a reader must mask (`colourByte.ts` owns both masks) |
| 8      | `sizeClass`       | rarity                                         | unchanged, unread by the worlds renderer                                             |
| 9      | `brightness`      | quantised log printing count                   | unchanged, unread by the worlds renderer                                             |
| 10     | `twinklePhase`    | twinkle phase                                  | **reserved, written 0** — there is no twinkle                                        |
| 11     | `typeMask`        | card-type bits                                 | unchanged; the type facet still reads it                                             |

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
> uncorrected half-extent is `π/2 = 1.571` _world radii_, a quad wider than the globe it sits on,
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
> small plane. The extreme is §1.3's floor — **2.00 at `rowCells = 1`** (a one-card world, six of
> them on v3) and **1.00 at `rowCells = [2]`, `rows = 1`** — which the same letterbox handles, and
> which is therefore _not_ where small worlds break: §1.4's subdivision is.

> **Normative — the per-row cell counts are shipped, not derived.** §1.3's relaxation makes a row's
> cell count population-derived, so it is **not** a function of `cardCount` and a row count and the
> closed form `round(2π·sin θ / (aspect·dφ))` no longer describes the shipped grid (Rabiah: 78 slots
> from the closed form, 75 cells in fact). The v3 contract therefore carries a per-plane **`rowCells`
> table** — one `uint` cell count per row, in north-to-south order — in place of the scalar `rows`
> (§2.4). `rowCells.length` is the row count; row latitudes are equal-`dφ` with `dφ = π /
rowCells.length` and centres at `(i + ½)·dφ` (§1.3), so the client's only remaining derivation is
> matching a cell to its row by latitude.

Counting stars per row would also recover the counts, and would be sound — but only _because_ §1.3
mandates zero bare cells. The table is 734 numbers across the 87-plane roster's 29 worlds and 777
across v3's 45 (81 for Dominaria, 162 B as `uint16`, ≈ 3 KB raw as JSON against `planes.json`'s
11.6 KB brotli), which is
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
_radius_ mapping of PRD 5.4.2 (chronology becomes longitude), shear, bar and disc thickness. Review
§6.1 group D's dead pipeline code (`hue_of`, `iter_star_offsets`, the unread `AssemblyStats` fields)
should go in the same pass.

### 2.2 `swatches.bin` — the new artefact

The enabler for the whole concept: a per-card colour derived from the _art_. The contract carries
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
28,587 × 8 + 16 = **223.4 KB raw** (v3: 28,603 cards, 223.5 KB — the multiverse total, dust
included, which is _not_ the cell count; only cards on worlds get cells).

> **Normative — `swatches.bin` is a separate artefact and must not become a section of `sets.bin`.**
> `sets.bin` is a sectioned container and adding section id 4 would be the tidier-looking choice. It
> is the wrong one: PRD 7.2 budgets the pair `search.json` + `sets.bin` at ≤ 700 KB target, and that
> pair is at **668.5 KB — 95% of target** on production today (`docs/data-contract.md` §8). Another
> ~200 KB puts it at ~870 KB: 24% _over_ the reported target, though still well under the 1.5 MB
> ceiling, which is the only one of the two that fails the build (`docs/data-contract.md` §8:
> "Only the 1.5 MB ceiling fails the build; the target is reported"). So this would overshoot a
> reported target rather than break one — and that is still the wrong trade, because it spends the
> project's one genuinely tight row to save a file. As its own file fetched with `stars.bin`, it
> lands on the _before-intro_ row instead: 253.9 KB → ≈ 455 KB against a 3 MB target (§2.5).

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
copyright in the same interface, *or* the full card shown alongside. The galaxy satisfied the
alternative clause because `art_crop` only ever appeared on the printing planets orbiting a focused
card that was showing its full `large` image. Concept B shows tens of thousands of art crops with no
card in sight, so the alternative clause no longer applies and the artist must be in the contract.
Review §4.4 is explicit about this and the prototype's own footer states the gap.

> **§1.10 has since removed the ring from this argument entirely (DEC-751).** The printings are now
> flat quads showing the whole `small` card, so the ring does not display an `art_crop` at all and
> carries its attribution on each quad's own face. That does not weaken this section — it sharpens
> it. The **cell sheet is now the only `art_crop` surface in the app**, so the contract's artist
> field is the whole of the app's compliance rather than a second line of defence behind a
> ring that was already covered.

**Which printing's art a cell shows:** printing index 0 — the tuple list is ordered by release date,
so index 0 is the first printing, which is what the card's `r` size class already refers to. The
cell's caption therefore credits `p[0][5]`.

### 2.4 `planes.json` — what retires and what arrives

| Field                                                                                                                                                           | v3                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `home`, `radius`, `tilt`, `spinPeriodS`, `spinDirection`, `driftAmplitude/PeriodS/Phase`                                                                        | **keep**                                                                                                                                                                                                                                                                                                           |
| `palette`, `nebulaTint`, `firstYear`, `lastYear`, `sets`, `cardCount`, `starOffset`, `starCount`, `shardCount`, `index`, `slug`, `displayName`, `notes`, `kind` | **keep**                                                                                                                                                                                                                                                                                                           |
| `shearAmplitude`, `shearPeriodS`, `shearPhase`                                                                                                                  | **retire** — PRD 5.4.13 shear is a spiral-disc law                                                                                                                                                                                                                                                                 |
| `armPitch`, `bar`, per-plane `discThickness`                                                                                                                    | **retire** — PRD 8.6.2 seeded spiral params                                                                                                                                                                                                                                                                        |
| top-level `discThickness`                                                                                                                                       | **retire**                                                                                                                                                                                                                                                                                                         |
| `rowCells` _(new, `uint[]`)_                                                                                                                                    | the surface grid's per-row cell counts, north to south. `rowCells.length` is the row count; row latitudes are equal-`dφ`, `dφ = π / rowCells.length`, centres at `(i + ½)·dφ`. Shipped rather than derived because §1.3's relaxation makes the counts population-derived (§2.1). Empty planes and the belt omit it |

`radius` stays but changes meaning: it is now `max(0.126 · √cardCount, 0.55)` — the moon floor applies
to worlds too, and binds on 15 of v3's 45 (§1.3, §1.8) — and the Blind Eternities keeps `R` for the belt. Seven fields retire and one arrives;
the arriving one is an array, so `planes.json` grows rather than shrinks — 734 numbers across the 29
worlds of the 87-plane roster and 777 across v3's 45 (a one-card world contributes one: `[1]`), ≈ 3 KB raw against 11.6 KB brotli today. Either way it is noise in the budget and is listed
for completeness, not for savings.

### 2.5 Budget summary

| Row                                            | Target                  | v2 today       | v3 estimate                                |
| ---------------------------------------------- | ----------------------- | -------------- | ------------------------------------------ |
| `search.json` + `sets.bin`                     | 700 KB / 1.5 MB ceiling | 668.5 KB (95%) | **unchanged**                              |
| First frame (`manifest` + `planes`)            | —                       | 16.2 KB        | ≈ 16 KB                                    |
| Before intro (+ `stars.bin`, + `swatches.bin`) | 3 MB                    | 253.9 KB       | ≈ 455 KB (15%)                             |
| Largest plane shard                            | 1.5 MB / 2.5 MB ceiling | 339.8 KB       | ≈ 365 KB                                   |
| GPU resident (MiB)                             | 96 / 160 ceiling        | 83 worst case  | **63.6**, 66.0 with a DFC in focus (§1.12) |

**Basis.** Every KB figure in this table except the GPU row is **encoded transferred size at brotli
11**, which is what `docs/data-contract.md` §8 reports and what `check-budget` compares; the GPU row
is MiB (§1.12). That makes the before-intro estimate an assumption worth stating out loud:
`swatches.bin` is **223.4 KB raw**, and 455 − 253.9 = **201 KB** implies ~90% of it survives brotli.
That is the right expectation for 2×2 RGB565 art statistics — four uncorrelated 16-bit samples per
card, close to incompressible — but it is an estimate doing real work in a budget table, and it is
the estimate to replace with a measurement the moment leg P emits the first `swatches.bin`. The
worst case, zero compression, is 477 KB, still 16% of a 3 MB target, so the row's _conclusion_ does
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
**its shade term** and whether it resolved to art, plus the art pool's resident count, effective
threshold and eviction counter. Geometry comes from the probe; **colour is sampled from the captured
PNG**, so every criterion below measures the frame after tonemap and vignette at presentation
scale — which is the thing T7 said was missing.

> **Normative — what a probe "cell" is, and what its rect measures (DEC-749, on DEC-752's pin).**
> `cells[]` has **one entry per card**, never one per sub-quad: §1.4 subdivides the _base geometry_
> of the instanced draw, so N instances survive the re-mesh untouched. And the screen-space rect is
> the axis-aligned bound of the projected **sphere-following vertex grid** — the geometry §1.4
> actually renders — never of a tangent quad's four corners.
>
> > **The overstatement is `γ/sin γ`, and it is not §1.3's corner lift.** Leg G pinned this contract
> > with §1.3's lift figures (0.7% Dominaria, 5.7% Rabiah, 265% at N = 1). Those measure how far a
> > corner floats _radially_ off the globe, which is the right statistic for "does this read as a
> > billboard" and the wrong one for an extent. In **arc length** the two models are identical to
> > machine precision at every N in 1..7000 — `iSize` is arc length (§2.1's 51.6×), so a flat quad
> > built from it has exactly the patch's length, just laid flat. So a pin worded only as "the
> > patch's extent, not the quad's" is **vacuous**: both readings give the same number.
> >
> > What differs is the _projection_. A patch spanning half-angle γ projects to its chord
> > `2·sin γ`; the flat quad projects to `2γ`. The ratio is `γ/sin γ`: **1.0001 on Dominaria**,
> > 1.0051 on Rabiah, 1.0115 at 30 cards, and **1.5708 at N = 1** — smaller than the lift figures by
> > 106× on Dominaria, 11× on Rabiah and 4.6× at N = 1, and that is the direction that matters
> > **And the corners do not bound the patch either (DEC-749).** A spherical patch's projected
> > half-width is `cos(θ)·sin(γ)`, maximised where `|cos θ|` is — the cell row nearest the equator —
> > so for any cell straddling its own widest latitude the extreme lies in the grid's **interior**
> > and a rect taken from the four corners *under*-reports. Measured at `γ = 0.4`, `latArc = 0.2`:
> > **2.03% short**. That is the mirror image of the tangent-quad error and points the other way, so
> > an implementation carrying both partially cancels and looks almost right. Two consequences:
> > `k = (1,1)` **is** the four-corner case, and "just use a large k" is not the rule — an odd
> > `kLat` never samples `v = 0` and lands short however fine it is. There is therefore no
> > k-independent "true" rect to report: the probe reports the bound of the vertex grid the frame
> > actually rasterises, at the renderer's own subdivision, which is consistent with the picture by
> > construction.
> >
> > (G's 30-card figure, 11.6%, is additionally one commit stale: `55d3b15`'s exact-N
> > apportionment moved shenmeng to 13.0%.) W1's floor binds on the
> > *largest* world, and Dominaria's cell height moves by **0.012%** between the two models —
> > `γ/sin γ` is 1.0001 there, whatever the pose. (This clause used to quote Appendix A's prototype
> > 25.3 px as the base; the ratio is what carries the argument and it is pose-free, so the
> > superseded absolute is dropped rather than re-measured — DEC-818.) **No W1 row
> > can discriminate them at any N**, which is a stronger statement of G's "the gate is structurally
> > blind" than the lift figures support — so §1.4's 1,262-sub-quad envelope assertion is not
> > belt-and-braces, it is the only guard, and it stays in scope.

> **Normative — the probe reports §1.4's `shade` per cell (DEC-749).** It is the scalar
> `0.10 + 0.95·clamp(dot(n, light)·0.5 + 0.5, 0, 1)²` the renderer already computes, and W2's second
> half cannot be measured without it — see the note under the criteria table. Reporting it costs the
> renderer nothing and is the one probe field that is a _derived_ quantity rather than a state
> read; it is normative anyway, because the gate may not re-derive it (it would then be asserting
> against its own model of the light rather than against the shipped one).

> **Normative — how the payload is served, and the one thing `undefined` means (DEC-749).** The seam
> is `window.__eternitiesProbe.worlds()`, an addition to the existing `?probe=` seam rather than a
> second one, installed only when the URL asks. It returns **`undefined` when no world is composed**
> and a payload when one is. That distinction is load-bearing and the gate branches on it:
> `undefined` is *"the worlds probe is not installed on this page"*, a **setup failure**, while an
> empty `cells[]` is a world that drew nothing, which is a **measurement**. Collapsing the two lets a
> page with no worlds on it score a green matrix — the `verify-browser --dataset all` shape of
> failure, where two fixtures printed "all datasets verified" and neither had been read.

> **Normative — a per-plane reading passes the slug: `worlds(slug?)` (DEC-785 F1).** The per-world
> tour takes its statistic *for the focused plane only*, and the no-argument call cannot deliver
> that. With no argument the payload describes whichever world is nearest in units of **its own
> radius**, and that metric does not name the focused world: dividing each distance by that world's
> radius makes the minimum systematically the **largest neighbour**, so a big world far away
> outranks the small one the camera is parked at. Measured over the v3 roster at the gate's own
> navigation pose it named the focused world for **3 of 45** — and the failure is not confined to
> degenerate worlds, since Bloomburrow (299 cards), Edge (276) and Fiora (146) all misattribute.
>
> > The argument is **additive**, and deliberately: the no-argument path is unchanged for the
> > readouts and drivers already written against it, and the home view has no focused world to name.
> > `worlds(slug)` returns that world's composed surface, and **`undefined` — never a neighbour —
> > when the slug composed nothing**, which folds into the setup-failure branch above rather than
> > inventing a fourth state.
> >
> > **The misattribution is silent**, which is why the seam contract's per-plane rule is not enough
> > on its own: what comes back is a perfectly well-formed payload of the *wrong* world, with a
> > plausible `radii` and a plausible `cells[]`. A reader must check `planeSlug` against the slug it
> > asked for; the gate does, at the settle and again at the measurement pose.

> **Normative — `ProbeState.multiverseAngle` is the renderer's azimuth, and a frozen one is a real
> reading (DEC-785 F2).** An azimuth sweep needs the angle the frame was *drawn* at, and the gate may
> not derive it from its own clock. Two reasons, and neither is fastidiousness: under reduced motion
> `sceneFrame.ts` advances the plane table with `motion` 0, so a wall-clock sweep would report evenly
> spaced azimuths of a scene frozen at exactly **one** — this section's own named degeneracy, reached
> through the harness instead of through a short sweep, and still reading as the stronger claim; and
> even with motion live, an angle computed from elapsed time makes an even-spacing check a test of
> the gate's arithmetic against itself, passing by construction on a sweep the renderer never took.
>
> > The field is `PlaneTable.multiverseAngle` — the same integrated angle `sceneFrame.ts` mirrors into
> > the background, never a second clock — published **always and unsmoothed**. Under reduced motion
> > it therefore does not advance, and that is the specified behaviour rather than a gap: the gate
> > reports a non-advancing angle as a named **setup failure**, which it can only do if the seam
> > hands it the truth. Synthesising advancement here would convert the degeneracy above into a green
> > sweep. No `?? 0` spelling: a seam that defaults the field is indistinguishable from a frozen one.

> **Normative — the payload carries §1.6's stream report as `stream`, and `null` is not zeros
> (DEC-778).** §1.6 already says the probe reports `swatchOnly` "so the gate can read it before it
> reads W4"; until DEC-778 `ArtStreamReport` was computed and never published, so the sentence named
> a field no reader could reach. The published object is the report verbatim — `bytesFetched`,
> `bytesOutstanding` (DEC-812: settled bytes with a resident layer still standing behind them —
> **this, not `bytesFetched`, is what the budget is tested against**, and a reader who takes the
> ledger for the budget reproduces the defect DEC-812 fixed),
> `bytesReserved` (DEC-780: bytes committed to requests that have not settled, so a reader can see
> why `swatchOnly` can be true while `bytesOutstanding` is still under `byteBudget` — the difference
> is in flight; **not** monotonic and **not** a subset of `bytesFetched`),
> `byteBudget`, `swatchOnly`, `requested`, `resolved`, `failed`, and the three causes
> `declinedExhausted` / `declinedBudget` / `declinedFailedBefore`, which stay three numbers because
> W4's control has to tell them apart. Without it a budget-declined session and a threshold admitting
> nothing are the same payload: `showingArt` false on every cell and no way to say why — the DEC-772
> harness run that plateaued at **733 fetches** was separated from the other reading only by summing
> `content-length` from outside the page.
>
> > `stream` is **`null`** where the world composed with no `ArtStream` at all, which a zero-layer
> > pool is (§1.6's legal swatch-only world), and an **all-zero report** where a stream exists and
> > nothing has asked it for anything. The second is a live path that is idle — the shape DEC-772's
> > missing `cardOf` took — and a report synthesised for the first case would tell the gate a 64 MiB
> > budget is unspent on a session that has no budget and no possibility of art.
>
> > A reader must not rebuild this from the network side: the Resource Timing API reads **0 bytes**
> > for Scryfall, because `encodedBodySize` is zeroed cross-origin without `Timing-Allow-Origin`
> > (DEC-772). `bytesFetched` is the queue's own `Blob.size`, charged on the decode-failure path as
> > well as the success one, and it is the only byte count that is real.

> **Normative — the payload carries the terms `radii` is built from: `centre`, `cameraPosition`,
> `radius` (DEC-804).** A world's centre is PRD 5.7.1's `planePosition` — `home`, plus PRD 5.3.15's
> drift, rotated by PRD 8.5.3's multiverse angle — so "2.2 radii" is **world-relative**, and §3.1's
> wording is unchanged by this. What changed is that the pose is now checkable: until DEC-804 the
> payload carried `radii` and neither of its operands, and the gate was required to trust a number it
> had no way to audit.
>
> > **The check is `radii == |cameraPosition − centre| / radius`, to float precision and not to
> > equality.** It is not a tautology, because the two sides are taken in different frames:
> > `WorldSurface` measures in the world's own frame — centre at the origin, camera counter-rotated
> > by the orientation — while these three are the untransformed world-space pair. Agreement says the
> > local-frame substitution is a rigid motion, which is the one assumption that substitution rests
> > on. Measured on the shipped build, the worst residual over a 17.5 s hold on `dominaria` and
> > `azgol` is **4.4e-16**.
>
> > **What this was for.** Leg G's acceptance run could take no §3.1 reading at all: 1 of the first
> > 15 worlds scored and 14 failed setup, because `radii` drifted on a rig that was not moving. Leg
> > G's own tables read `dominaria` **2.9203 → 2.1687** over 17.5 s with `cameraDistance` constant at
> > 31.9293, and `azgol` **3.5140 → 17.4112** — a span of 13.90 radii. The worlds scene had
> > snapshotted `plane.home` at composition time and contained no reader of `multiverseAngle` at
> > all, so the camera orbited and the worlds did not. The visible half was a capture of the focused
> > world in the bottom-left corner of its own frame with empty dust centred.
> >
> > **Three instruments, and the numbers are not interchangeable — attribute each reading to the run
> > that took it (DEC-809 N7).** `scripts/worlds-centre-hold.mjs` is the fix leg's own harness, and
> > its unfixed-tree readings are a *different run* from leg G's: `dominaria` 2.9250 → 2.1723 and
> > `azgol` by 14.41 radii, with `alara`'s on-screen cells centred at **(342, 887)** of 1920×1080,
> > 379 of 510 visible, against **(960, 539)** and 510 of 510 after the fix. The review's independent
> > instrument (DEC-809) is a third: at that identical camera it found `alara`'s unfixed payload
> > carried **no cell table at all** — 0 of 0, not 379 of 510 — so the 379 figure is that harness's
> > and does not reproduce. All three agree on `cameraDistance` to four decimals and on the sign and
> > scale of the drift, which is the claim; none of them is a source for the others' digits.
> >
> > `worlds-centre-hold.mjs` is written to be run against an unfixed tree as well — the frozen
> > control passes on **both**, which is why a suite that measures only under `?motion=0` cannot see
> > this class of defect at all.
>
> > The fields are **additive**: `readWorldsProbe` has no unknown-key rule and no field the gate
> > already reads has moved. `radius` is §1.3's `worldRadius(cardCount)`, never `planes.json`'s
> > `radius` — the two agree to 4.7e-7, and a gate dividing by the published field would be dividing
> > by a number the renderer does not use.

> **Normative — a cell's `(x, y)` is the PROJECTED CENTRE, not the centre of its rect (DEC-749).**
> The payload carries both the rect above and the `(x, y, height)` triple the gate reads, with
> `height ≡ rect.height`. The two centres are not the same point: measured over v3 at 1920×1080 the
> rect's centre sits a mean **1.3–10.3%** of a cell height from the projected centre and as far as
> **27.8%** (Ravnica, row 42 of 49, at 3.5 radii), because a spherical patch projects to a *curved*
> outline whose bounding box is not centred on it.
>
> > The reason is not that one pixel is more correct in the abstract. **`shade` is evaluated at this
> > point and the gate samples the captured PNG at this point**, and W2's lightness half pairs those
> > two readings per cell over the iso-shade subset — so they have to be readings of the same place,
> > or the pairing is between a shade here and a colour somewhere else.
> >
> > **What this is not: a wrong sample.** The alternative was checked rather than assumed. Point-in-
> > polygon against the projected patch outline over Dominaria, Ravnica, Alara and Rabiah at 2.2 and
> > 3.5 radii puts the rect's centre outside its own cell in **0 of 4,803** samples, with a negative
> > control — the same point pushed down one cell height — reading outside **4,803 of 4,803**. So the
> > bounding-box centre would *not* have sampled a neighbouring cell, and this is recorded as a
> > consistency fix rather than as the repair of a defect that was never demonstrated.

> **Normative — §1.3's band index is published by the renderer, and it is not a colour class
> (DEC-749, on DEC-752's pin).** `bandShares[]` is the thirteen-band chain's share vector and each
> cell carries its `band` index into it. The chain is `C G R B U W · Gold · W U B R G C`, so every
> mono class appears **twice** and only gold appears once; reporting the class instead would merge
> the two ice caps — which sit at opposite poles and are the chain's two *ends* — into one group and
> invent an adjacency the sphere does not have. W3 walks this as a **chain, not a cycle**. The
> boundaries are equal-**area** in `cos θ`, which is what makes a colour's area *be* its share of the
> plane, and the client's implementation is asserted bit-for-bit against the pipeline's own
> `surface.py` rather than against arithmetic recomputed in TypeScript.

The gate also depends on **control seams** in the shipped renderer, which is why they are normative
in §1 rather than being a gate-side patch.

> **Normative — seam ownership, and there are six of them, not four (DEC-749, DEC-821).** The six
> are `?probe=`, `?swatch=mean`, `?bands=shuffle`, `?artThreshold=fixed24` (§1.6), `?layers=N` and
> `?art=off` (§1.6). `?probe=` is one of them: the paragraph above introduces it separately as the
> gate's geometry source, but it is the same kind of object — normative renderer surface the gate
> reads and does not build. **All six are owned by leg R1**, which builds them as part of §1.3–§1.6;
> `?art=off` arrived later, on DEC-821, under the same ownership and for the reason §1.6 records —
> without it the two swatch-perturbing seams do not reach the capture at all. **Leg G consumes them;
> it does not build them, and it may not patch the build to get them.** An earlier draft said "legs
> R1 and R3 own them" here while §4's R1 row already listed them all under R1; R1 is the ruling, and
> R3's row (§1.10–§1.12) carries none of them. This matters beyond tidiness: a seam built gate-side
> is a seam that is not in the shipped renderer, and §3.1's whole argument for W4's control is that
> the control must exercise the _shipped_ policy.

> **Normative — `?layers=N` pins the art pool and nothing else; it is not `?quality=N` (DEC-751).**
> The two are easy to conflate because §1.12 makes the pool a rung of the same ladder, and one of
> them already exists: W4.1 ships **`?quality=N`** (`pinnedQualityTier` in `web/src/scene/quality/adaptiveQuality.ts`)
> and there is no `?layers=` anywhere on `dec739-platform-layer` — this seam is genuinely new
> surface R1 builds.
>
> They must not be aliased. `?quality=4` selects a whole rung of `QUALITY_TIERS`, which moves
> **four** quantities at once — `pixelRatioCap` 1.0, `bloomScale` 0.25, `bloomLevels` REDUCED
> and `glow: 'cheap'` — where `?layers=128` must move the pool alone. The
> matrix row below is "`?layers=128` — tier 4's pool, **unmodified policy**", and it is one of only
> two expected-GREEN rows. Routed through the tier it would also be measuring dpr, bloom and glow,
> and would stop asserting what the paragraph under the matrix says it asserts.
>
> **The renderer reports the pool size back clamped**, `max(0, min(requested, MAX_ARRAY_TEXTURE_LAYERS − 32))`
> (§1.6), and §1.12's assertion is against that reported value rather than against the requested N
> or the tier constant — on a spec-minimum 256-layer device tiers 0–3 all clamp to 224 and only tier
> 4 is distinct. So `?layers=N` is a _request_, and the reported figure is the answer.
>
> What this note does **not** decide is whether a quality tier may set the pool size as its rung.
> That touches the ladder's one-quantity-per-rung invariant and is **DEC-753's** ruling, not R1's;
> R1 owes the seam and the clamped read-back either way.

> **Normative — the gate checks §1.3's table, and checks three things about it (DEC-752, measured).**
> The gate reads `planes.json` for its rosters anyway, so `rowCellsFaults` asserts the table there:
> `Σ rowCells == cardCount`, `rowCells[r] ≥ 1`, `rows == max(1, min(rows_closed, N))`, and that
> `rowCells` is **present on worlds and absent — not empty — everywhere else**. All hold on 45 of 45
> published worlds (`3ce85aed`). **It asserts no equatorial-symmetry bound in any form**, per §1.3.
>
> Two of these are weaker than they look, and are recorded as such rather than quietly counted:
>
> - The `≥ 1` floor cannot fail unless the exact-N check already has. The minimum cell count over
>   the 39 multi-card worlds is **2**; the six one-card worlds are the only place it binds, and
>   there `Σ == 1` already forces `[1]`.
> - **§1.3's `min(rows_closed, N)` clamp is unreachable.** `rows_closed ≈ √(1.047·N)`, which is
>   below `N` for every `N ≥ 2` and rounds to 1 at `N = 1`; swept over `N = 1…200,000` it never
>   binds. The assertion is `rows == rows_closed` on every input, and the clamp is decoration — a
>   reader must not score that clause as a tested guard. Routed to DEC-749 as a §1.3 wording matter.
>
> **Row centres are not the gate's to measure, and do not need to be.** `(i + ½)·dφ` is the one
> offered invariant with real content — it is what separates §1.3's colatitude placement from the
> degenerate `i·dφ` form — but neither `planes.json` nor the probe payload carries a `dφ` or a row
> index, so the gate's only reading of `dφ = π/rows` is `π/len(rowCells)` against itself. The
> centres live in the **emitted positions**: decoded straight out of `stars.bin` on `3ce85aed`, the
> per-row populations reproduce `rowCells` on **45 of 45** worlds and every star sits within
> **0.0004 rad** of `(i + ½)·π/rows`, while the same test against `i·dφ` fails on 44 of 45 — a live
> negative control, so the check is worth having where it can be taken at full precision, beside the
> pipeline's own. (The tolerance must scale with `dφ`: at a fixed 0.02 rad Dominaria's 81 rows put
> the two grids `dφ/2 = 0.019` apart and the degenerate form passes.) **No new seam is requested.**

Five criteria assert. The rest stay owner-judged, because they are about feel and 9.3 never asked for
an assertion there.

> **Normative — the roster counts are derived from `planes.json` at runtime, never hard-coded
> (DEC-751).** Two sets, and every count below is one of their sizes:
>
> ```
> worldsWithCards  = planes.filter(p => p.kind !== 'dust' && p.cardCount > 0)   // 45 on v3
> planesWithCards  = planes.filter(p => p.cardCount > 0)                        // 46 on v3
> ```
>
> W1 and W5 both iterate `worldsWithCards`, and for the same reason: the Blind Eternities has cards
> but is not a world, so it has neither a cell sheet for W1 to measure (§1.8) nor a label for W5 to
> count. `planesWithCards` is that set **plus the belt**, and it is carried here only so the two can
> be told apart — nothing is measured against it.
>
> > **Normative — W5's ceiling is `worldsWithCards.length`, not `planesWithCards.length`
> > (CEO ruling, DEC-768 F4).** `labels/PlaneLabels.tsx` filters `BLIND_ETERNITIES_SLUG` out of the
> > candidate list *before* projection (PRD 5.3.4: the dust spans the whole multiverse and has no
> > centre worth labelling), so the belt can never carry a label and `planesWithCards.length` is
> > unreachable **by one, by construction**. A ceiling with a permanent unit of slack is slack in
> > the direction a ceiling exists to refuse. On v3 the ruling reads **45**, and `worlds-metrics`'
> > `homeLabelCeiling` on leg G already ships it.
>
> The numbers written in this section are the 87-plane roster (verified against
> `web/public/data/6d4779695fde33ea/planes.json`: 87 planes = 29 worlds + 1 dust + 57 empty,
> 23,607 cards on worlds), not constants to compile in.
>
> **This is a gate threshold, so hard-coding it fails the gate on correct behaviour** — and the
> dataset this gate runs on is already measured. DEC-710's curation sign-off is answered and lands
> in the v3 dataset leg P publishes; measured on PR #46 head `311b87d` (`dabe2c9a68b4d799`) that
> dataset is **88 planes = 45 worlds + 1 dust + 42 empty, 24,399 cards on worlds**, so the two
> `.length`s become **45** and **46**. Forgotten Realms is not a `+1`: the refresh is the first
> dataset to bake in PR #41's plane overrides (§1.2). A W5 pinned at 29 — or re-pinned at 30 on the
> strength of "FR is one more world" — goes **RED the moment that data lands**, against a renderer
> doing exactly what this section asks, and the failure will be read as a renderer regression.
> Derived, the refresh is a data change and the gate stays honest. This is the whole argument for
> deriving: the spec's own prediction of the next dataset was off by 15 worlds.

| # | Criterion | Measurement | Floor |
|---|---|---|---|
| **W1** | **Cells are resolvable at framing distance.** | At the plane-level settle for each of `worldsWithCards` (**29** on the 87-plane roster, **45** on v3), the median on-screen height of front-facing cells; the verdict is the **worst** world, not the pooled median. Not the Blind Eternities: it has cards but no cell sheet (§1.8), so the statistic is undefined there — `planesWithCards` would be 30 / 46 and would include it. | **≥ 24 CSS px.** Binds on the largest plane: Dominaria **28.74** at its worst azimuth, at §1.3's framing distance — a **20% margin** (`[shipped]`, the arm the build renders; `[tilted]` it is Ravnica 25.21 and 5% — §1.3 on the two arms). |
| **W2** | **The mosaic reads as tiles, not as a wash.** This is T7's replacement. | Sample the captured frame at the centre of every front-facing cell ≥ 6 px tall, convert to CIELAB. Report the median ΔE to a cell's nearest on-screen neighbour, and the interquartile range of L\* **across the iso-shade subset** — the cells whose reported `shade` lies within ±2.5% of the median shade. | **median neighbour ΔE ≥ 6** and **iso-shade IQR(L\*) ≥ 8**. |
| **W3** | **Latitude reads as colour.** | Group the same samples by band. For every pair of bands adjacent **in §1.3's 13-band chain** (a chain, not a cycle: the two ice caps are its two ends and are the furthest apart of any pair) where the smaller holds ≥ 5% of the plane's cards, the ΔE between their mean a\*b\*. A world's own reading is the **closest** of its qualifying pairs; **the roster's is the mean of the per-world readings over W3's domain — 28 of the 45 worlds on `c9468f1125bcddff`** (board ruling `fold_mean`) — published with every reading and with the denominator beside it. | `FLOORS.bandDeltaE`, **derived on the mean and re-derivable** — see the amendment note below; the **≥ 10 for every such pair** this table published was never met by any build and is retired. A tour whose scored domain is **not exactly 28** is **RED on its denominator**, whatever its mean reads. |
| **W4** | **Art resolves without exhausting.** | At the surface view (2.2× radius), after a 5 s settle: the fraction of on-screen front-facing cells above the effective threshold that are showing art, **the absolute count of cells showing art**, and evictions per second **on a fill-excluded tail** whose own second half agrees with it. **Demand as a multiple of pool capacity is reported alongside them and is not scored.** | **`artFraction ≥ max(0.9 × capacityCeiling, 0.5)`**, **`artCellsShowing ≥ 32`** where the frame presents at least 128 front-facing on-screen cells, and **≤ 21 evictions/s at the 1,024-layer pool alone, and only where that pool actually filled** — see the amendment notes below. The published flat **≥ 90%** is the bar only where demand fits the pool, and the published **≤ 5 evictions/s over the last 2 s** was unreachable by construction and is retired. |
| **W5** | **The home view is not a wall of labels**, and every world is still reachable from it. | Two halves, both over a **sweep of ≥ 12 azimuths** — the home view is a family of frames, not a pose (see below). **Ceiling:** the worst-case count of plane labels **at opacity > 0.05** over the sweep; a node count is not a measurement here. **Reachability:** the number of `worldsWithCards` carrying no such label at **any** sampled azimuth, with those slugs named. | **Ceiling ≤ `worldsWithCards.length`** — **29** on the 87-plane roster and **45** on v3 (measured, not predicted — §1.2), derived from the dataset under test and never a literal. The belt is *not* added: it is in `planesWithCards` but `PlaneLabels.tsx:116` filters it by slug before projection (PRD 5.3.4), so it can never carry a label and `planesWithCards` would leave the ceiling one short of ever binding. **Reachability = 0 worlds.** Below 12 azimuths both halves report `insufficient`. |

> **Normative — W4's art floor is a bar derived from pool capacity, not the flat 90% this table
> published (DEC-752, three board rulings, 2026-09-16).** The flat floor was unreachable by
> construction on a small pool: a showing cell holds a layer, so `artFraction` cannot exceed
> `capacityCeiling = min(1, layers / wanting)`, and at quality tier 4 dominaria's ceiling is **0.624**
> — the row was scored against a bar its hardware could not reach. The amended criterion, and the
> order the three rulings landed in, because each repairs the one before it:
>
> 1. **`split_measures`** (card `62f32092`) — score `artFraction` against a **reachable** bar, and add
>    a separate `demandFitsCapacity` measure so the overshoot the bar forgives stays visible.
> 2. **`floor_times_ceiling`** (card `2e92df81`) — that bar is `0.9 × capacityCeiling`: *show 90% of
>    what your pool could show*. **`demand_measure_scored` = `reported_only`** on the same card, so
>    the new measure carries a verdict and no colour.
> 3. **`absolute_floor`** (card `74114193`) — floor the bar at **0.5**, because rule 2 alone **could
>    not fail on a saturated pool**. There `showing == layers`, so `artFraction == capacityCeiling`
>    *exactly* and the value clears a bar that is a fixed fraction of that same ceiling at **every**
>    capacity — 37%, 10%, 1%. This was not hypothetical: it greened Appendix A's `tether-surface`
>    capture, the frame §3.1 names as W4's own falsifier, at 37% art.
>
> **What the 0.5 says, in the terms the criterion is about:** on a saturated pool `artFraction` clears
> it iff `wanting / layers ≤ 2`, so the absolute floor **is** a scored 2× bound on demand-over-capacity
> for exactly the frames where the pool is the constraint. The board's admissible interval was
> (0.371, 0.610] — above the capture that must red, at or below tier 4's measured 0.610 that must
> green — which is [1.64×, 2.69×) in overshoot terms. Do not read the 0.5 as calibrated more finely.
>
> **The two frames §3.1 calls "the fixed24 control" are not the same row, and only one was ever at
> risk.** The *live* `?artThreshold=fixed24` row is **budget**-starved: its demand fits its pool, its
> ceiling is 1, its bar is the unmodified 0.9, and it stayed RED through all three rulings. Appendix
> A's capture is **pool**-starved. A control named once and measured twice is how the green went
> unnoticed for half a day.
>
> **Superseded on the live half, 2026-09-17: the bare `?artThreshold=fixed24` row is retired** (ask
> `f9e273fb`, board answer `replace_row`). It is no longer budget-starved and no longer starved at
> all — see the matrix note below. **W4's art falsifier is now `?artThreshold=fixed24&layers=128`**,
> the composition that restores what Appendix A actually captured.

> **Normative — W4's eviction half is re-bound to 21/s, scoped to the shipped pool, and measured on
> a fill-excluded tail (board ruling on DEC-833 card `bd5c9aad`, option (a), 2026-09-17).** The
> published **≤ 5 evictions/s over the last 2 s** was not a bound the renderer could meet, and the
> reason is structural rather than a matter of tuning. **There is no stream defect.** DEC-833 filed
> one and DEC-834 falsified the filing; what follows is the corrected record.
>
> ### `evictions == requested` is an identity, so this criterion bounds want-set turnover
>
> `pool.evictions` is incremented in exactly one place — `artPool.ts`'s `claimLayer` — whose only
> caller is `reserve`, and only on the `byKey.get(key) === undefined` path, which is the same path
> that reaches `requested += 1` in `artStream.ts`. **Every eviction carries exactly one request, by
> construction.** Measured equal *to the unit* over three nested windows of a 120 s dominaria
> baseline — 1,647/1,647, 1,064/1,064, 533/533 — and 405/405 at a 128-layer pool.
>
> So the number is not a measure of waste. For an LRU smaller than its working set, eviction rate ==
> admission rate == the rate at which the want set turns over, and dominaria's want set turns over
> because **the world spins**: 6,271 cards into 1,024 layers at `spinPeriodS` 262.592, so 4,750 cells
> — 75.8% of the roster — cross the admission boundary every revolution. Of 1,946 distinct keys asked
> over 60 s, 1,689 were asked exactly once and none more than three times: **no path re-asks for a
> resident cell.** Meeting 5/s would have needed a **3.6× slower spin**, a **72% roster cut**, or
> **~4,750 pool layers** against a GPU-bound 1,024 — three product changes, none of them a defect.
>
> ### The bound, its margin, and where it is scored
>
> Steady-state turnover measured **18.1–18.5/s** over six long runs plus DEC-834's two extra arms.
> **18.1 × 1.15 ≈ 21.** The margin is deliberately small: the identity above means a stream that
> began re-asking shows up here at once and much larger, and a spin speedup or a roster that grows
> moves the number by far more than 15%. **It is not derived from the run it scores** — the readings
> are `worlds-evict-longrun.mjs`'s, over 120–150 s on a parked page, and the gate scores its own
> tour's tail.
>
> **Scored at the 1,024-layer pool alone; every other capacity is `insufficient`, not green.** At
> `?layers=128` the rate is **6.73/s** — a third of the bound — and it gets there by refusing
> ~4,670 wants/s for exhaustion and dropping `artFraction` to **~0.617**. Shrinking the pool moves
> this number toward any bound you like by destroying the picture the other half of W4 measures, so
> **the two halves select disjoint configurations** and requiring both rungs to hold one bound asks
> for a configuration that does not exist. The 128-layer rung is therefore **not** required to hold
> this bound, and the gate records that as a domain rule rather than as a footnote.
>
> ### The fill is the climb to saturation, and the tail has to converge
>
> A cold pool's first 1,024 admissions are page load. **Two obvious detectors are wrong, in opposite
> directions, and each is the natural rule for one half of the roster:**
>
> - **"`resident` stops climbing"** is wrong on a pool that saturates. A saturated pool churns
>   1023 → 1024 → 1023 forever, so the last upward tick lands in the final seconds: on a 60 s
>   baseline it put the fill's end at **t = 57.1 s**, leaving a two-row "steady state" (DEC-835).
> - **"the first sample holding `max(resident)`"** is wrong on a pool that does not. Below saturation
>   `claimLayer` always finds a free layer, so nothing is ever evicted and nothing ever leaves:
>   `resident` only climbs, `max(resident)` is *the last sample*, and the tail collapses to whatever
>   run of equal values the window ended on. Measured on the first live tour to run it, **alara
>   plateaued at t = 42.5 s of a 45 s window and was scored off a 2.0 s two-sample tail** — the same
>   defect from the other side, and 44 of the 45 worlds have that shape.
>
> **The rule is therefore written from what the counter can physically do.** `pool.evictions` cannot
> move below saturation at all, so there is no fill transient *in that counter* to exclude on an
> unsaturated pool and the whole window is the tail. The fill excluded is specifically the **climb to
> saturation** — the one interval in which eviction goes from impossible to possible. This is
> deliberately not the rule `worlds-evict-longrun.mjs` uses: that instrument differences *bytes*,
> which keep flowing below saturation, so its fill really does end at the demand plateau. Two
> instruments, two fills.
>
> **Excluding the fill is necessary and not sufficient.** The same run read 1,461 KiB/s differenced
> from t = 6, 1,445 from t = 18 and 1,382 from t = 36 — a monotone decline *after* the pool held
> every layer it would hold. So the tail is scored against **its own second half**, and a tail that
> has not settled publishes no rate. **A 60 s run does not converge.** The gate's W4 window is
> therefore chosen by the pool rather than by the clock: it samples until the tail settles, up to a
> cap, which costs the 44 worlds that never saturate almost nothing.
>
> **What the 10% tolerance refuses, corrected and measured (DEC-843, rider 3 of the DEC-841
> review).** `W4_EVICTION_TAIL_CONVERGENCE`'s own docblock used to claim that the 5.4% monotone
> decline quoted above "would be caught by this". It would not, and the correction matters because
> the number is quoted as a settle bound. `drift` compares the tail's own second half against the
> **whole** tail, and on a linear decline those two means differ by about **a quarter** of the
> end-to-end trend — so a 10% tolerance on that statistic is roughly a **33%** tolerance on the
> trend. Swept: 5.4% end-to-end reads drift 1.41% and converges, 20% reads 5.69% and converges, 30%
> reads 8.80% and converges, 35% reads 10.57% and is refused. **DEC-835's 5.4% was caught by the
> long-run instrument's 2%, not by this** — recomputed from its published tail, 1,461 KiB/s over
> t = 6→60 against 1,395 over its own second half, a drift of 4.5%. The rule is still the right one
> for what it guards (a fill read as a steady state is a factor-of-several error) and it must not be
> quoted as catching a few-percent settle.
>
> **A known selection, recorded rather than removed.** The gate's sampling loop breaks on
> `elapsed >= MIN && evictionTail(timeline).converged` — it stops on the statistic it then scores, so
> the rate is read at the first moment the tail looks settled. It does not bite on dominaria today,
> where drift is 0.9% and the value is 17.9 against 21, near neither boundary; the alternative is
> burning the 45 s cap on every world, ~24 minutes a tour, to re-confirm settled zeros.
>
> **Normative — a rate is quoted with its drift, and two rates are compared only beyond both bands
> (DEC-861, from DEC-863).** The tolerance above decides whether a draw has a rate at all; it does
> not make two converged draws comparable. A converged draw can carry a drift up to 10%, and since
> `drift` reads about a quarter of the slide it summarises, the band it implies is a **lower bound**
> on the draw's own uncertainty. DEC-863's two acceptance draws of PR #85, one per
> tree, read **18.26/s at drift 3.8%** and **17.84/s at 0.5%**: the 0.42/s between them is inside the
> first draw's own ±0.69/s, so it was the tail and not the trees. The gate's matrix line now prints
> each rate as `value …, tail drift d% = ±band`, where the band is `value × drift`, and the rule for
> reading two lines is: **a difference smaller than the sum of the two bands is not a finding.** The
> rule is one-sided, because the band is a floor: a difference larger than both bands is not
> thereby a finding either — it still has to clear the ~4× wider slide the drift under-reads.
> Bounding the drift instead — a draw above some figure reads `N/A` — is what the 10% tolerance
> already does, and tightening it would move a board-ruled constant; so the band is printed and the
> constant stays. Re-measured on DEC-861's branch, three
> `baseline --tour-limit 9` draws reaching dominaria: **18.31/s at 3.6% (±0.67), 18.46/s at 2.3%
> (±0.42), 18.44/s at 2.3% (±0.43)** — a 0.15/s spread, well inside every band, taken while two
> other legs' gate runs shared the machine.
>
> ### Amendment — a pool that never filled is `insufficient`, not a passing 0 (DEC-842)
>
> Rider 1 of the DEC-841 review of PR #77, and it is the same argument as the capacity domain above
> arriving one level out. The three rules just stated are all about *which* reading is scored; none
> of them could see that **on 44 of the 45 worlds the reading cannot fail**. Below saturation
> `claimLayer` never reaches its victim search, so `pool.evictions` is pinned at 0 and the rate is a
> fact about occupancy rather than a reading of churn. Scored `pass`, it made the roster headline
> *"17.8969/s, worst of 45 worlds"* a fold over **44 readings that could not move and one that
> could** — measured, alara-shaped, 1,024-layer pool, `resident` creeping 100 → 283, `atEvictionPool`
> true, `insufficientReason` null.
>
> That GREEN was not wrong: the worst-of fold takes dominaria's colour. **What it could not do is go
> red when the bound stopped binding** — a roster change, a larger pool or a threshold change that
> stops dominaria saturating would have greened the half on 45 structural zeros with nothing in the
> summary saying so. `a-bound-check-is-vacuous-when-the-bound-never-binds`, reached through the
> domain instead of through the constant, which is the shape DEC-834 used to kill option (b).
>
> **An unsaturated session is therefore out of the eviction half's domain**, exactly as a 128-layer
> session already was. The half now folds to `N/A` rather than GREEN when nothing saturates, and the
> `no-seams` row's `expect: 'GREEN'` on `evictionsPerSecond` fails against an `N/A` — so the gate
> reds instead of going quiet. The eviction domain count printed beside the fold (`scoredPlanes`)
> reads **1 of 45** where it read 45 of 45, which is the honest denominator for a worst-of over a
> bound only dominaria can reach.
>
> **The rule is a conjunction, and the second half is what makes it safe to score.** `poolHighWater`
> is a *lower* bound on occupancy — `?probe=` publishes `resident` and not `reserved`, so a full pool
> with a layer in flight reads `layers - 1` — and on `saturated` alone this would mark a real reading
> absent, which is that function's own stated objection to promoting it to a domain rule. So a
> session is out of domain only when it never saturated **and** the counter provably never moved: a
> counter that moved is proof of saturation whatever occupancy was sampled at. A churning pool
> reading 1023/1024 is still scored, and still fails at 24.2/s.
>
> **Stated gap, because it is a decision and not an oversight.** The mirror case — a pool that *did*
> fill and then had no key left to admit — also reports a structural 0, and it stays scored.
> `saturated` is a necessary condition and never a sufficient one (DEC-834 measured 128/128 flat at 0
> for 150 s), and "it filled and did not churn" cannot be told from "it filled and churn stopped"
> without `pool.reserved` and an admission counter on the probe — R1's surface, DEC-744 B1.
>
> **The gate's patience is what decides the domain, and that is the cost of the rule.** The sampling
> loop stops as soon as the tail converges past `MIN`, so a world that would saturate at t = 30 s is
> filed out of domain at the break. Right on this roster — the unsaturated worlds are unsaturated
> because their whole demand *fits*, alara asks for 283 of 1,024 — and a full-patience tour would
> spend ~24 minutes re-confirming zeros. The symptom if a world ever lands near capacity is that it
> flickers between `n/a — unsaturated` and a rate across runs, and the driver prints the high-water
> mark on every world so that is visible in the log.
>
> ### Criterion 3's no-starvation clause becomes an absolute term
>
> `artFraction` is a ratio, and **a ratio is blind to its own denominator being chosen by the policy
> under test.** At `?layers=128` under reduced motion the adaptive threshold collapsed the want set
> to **14 cells**; all 14 showed art, so `artFraction` read **1.00** — better than the healthy
> baseline's 0.9968 — on a frame showing fourteen cells of art out of some two thousand on screen.
>
> The repair is **`artCellsShowing ≥ 32`**: the numerator, scored on its own against a fixed number.
> 32 is `SMALLEST_SHIPPED_POOL_LAYERS / 4`, fixed at write time and deliberately *not* re-derived per
> run from `pool.layers` or `wanting`, both of which are outputs of the policy being graded.
>
> **Its domain is the frame's geometry, not its want set** — the term is scored only where **128**
> cells are front-facing and on screen, 13 of the 45 worlds. A domain written off `wanting` would
> have gone `insufficient` on the starved frame, because `wanting` is 14 there: the collapse the term
> exists to catch would have switched the term off. The worlds below the cut-off are scored by W1 and
> `artFraction`, both of which are defined at n = 1 — and threshold starvation is a large-world
> phenomenon, so this is the coverage the term wants rather than a concession.
>
> **The floor and the domain cut-off are different numbers, and the first draft of this leg had them
> equal at 64.** Set equal, the domain admits a frame at the instant it reaches the floor, so the
> worst in-domain reading is pinned just above the bound **however healthy the build is** — and the
> roster offers no gap to hide the cut-off in, its `presented` counts running
> 0, 1, 7, 15, 18, 26, 33, 61, 65, 66, 68, 69, 75, 77, 95 … unbroken. Measured: the first full
> acceptance tour read **65 against 64**, a 1.5% margin on a correct renderer. With the cut-off at
> 128 and the floor at 32 the term sits clear on every side, every figure measured:
>
> | reading | value | vs 32 |
> |---|---|---|
> | the live witness that must RED, `?layers=24` (DEC-890), settled frozen frame, 10 of 10 draws | 14 | **2.3× below** |
> | the witness the floor was derived against (want set collapsed to 14) | 14 | **2.3× below** |
> | healthy tier-4 rung, `?layers=128` (wanted 76–77, drawn 75–77, admitted 76–84 over the live draws after DEC-882) | 75–77 drawn | 2.3–2.4× above |
> | worst in-domain world of the 45-world tour (forgotten-realms) | **141** | **4.4× above** |
> | shipped 1,024-layer baseline, dominaria (n = 1, DEC-837, before PR #85's pose and DEC-882's grid) | 941 | 29× above |
>
> The tier-4 rung read **124** † at the arrival pose PR #85 replaced and 75–77 drawn at the pose
> and grid shipped now: 76–82 over five draws (DEC-882), 75 (DEC-889), 76 (DEC-894), 76 on 3 of 3
> held draws (DEC-896), and 77 on `main` at DEC-868 (`d1039739`), DEC-907 (`d725e90`) and DEC-912
> (`ac7e357`). Quote it as wanted 76–77, drawn 75–77, admitted 76–84 over the live draws after DEC-882; not as a flat 76 and not as one 75–82 spread. Both are readings
> of a healthy build and the floor clears both; quoted here with their eras because the row is the
> tightest healthy margin on record and a stale figure there would flatter it.
>
> **The tour figure moved too, and it is 141 rather than 146 (DEC-890).** 146 was DEC-837's
> `dec837-accept2` reading, taken before PR #85 moved the arrival colatitude and before DEC-882
> raised the grid. The `--negative-controls` tour on DEC-890's head reads **141**, same world
> (forgotten-realms), same worst-of-13 fold — 4.4× the floor rather than 4.6×.
> `remeasure-before-repeating-a-recorded-number`.
>
> † **That 124 also belonged to the row's harness configuration and not to the build** — the frame
> is taken after DEC-843's 3 s `reducedMotion: false` read-back hold, and the adaptive threshold goes
> on rising through it: 128 with the hold removed, 127 on the tree that had no read-back at all, the
> renderer identical in all three. The full statement is at the matrix row itself.
>
> ### What this costs the matrix, stated rather than left to be discovered
>
> **The eviction half has no live expected-RED row.** Exceeding 21/s needs a faster spin or a bigger
> roster; `spinPeriodS` is dataset data (`src/data/types.ts:325`), so a live row there means a
> fixture corpus, and a corpus change can retire a sibling control. That falsifier is therefore a
> **unit row** in `worlds-metrics.test.ts` — *"still reds the same row when turnover climbs past the
> new bound"* — with its expected-GREEN partner live in the matrix. It is a real gap in
> `--negative-controls` and it is named here for the same reason W3's is: a control that exists only
> as a number in a comment is not a control.
>
> **The absolute term's gap was closed by `layers-128-reduced` (DEC-843), and the argument that said
> it could not be is worth keeping.** This section used to say the term's witness needed reduced
> motion and that **`?motion=0` is inert exactly on `?probe=shell`** (it is read on `?probe=1`,
> `/bench` and `?selfcheck`, never by the app shell — which is what cost DEC-752 its first
> conclusion), and concluded from that to *no live row*. The premise is still true; the conclusion
> never followed. **The matrix is not restricted to query seams** — `w5-narrow` moves a viewport and
> `one-card-world` moves a pose, neither of which reaches the URL — and the mechanism was already in
> this tree on this route: `worlds-evict-longrun.mjs` emulates the **OS preference** before `goto`,
> which is the input `App.tsx`'s `useReducedMotion()` actually reads. `?motion=0` was the wrong seam,
> not the only one. See the row below for what it measures.
>
> **Measured, and the reviewer's prediction was recorded before the row existed** (DEC-841 verdict
> comment `b64059df`): `artCellsShowing` **14 against 32, RED**, in domain because dominaria presents
> ~1,383 ≥ 128; `evictionsPerSecond` **N/A**, out of the capacity domain at 128 layers; `artFraction`
> **GREEN at 1.00**. The live row read **14 / N/A / 1.00** on a frame presenting **1,388** — all
> three as predicted, and the presented count 0.4% off. **The two halves of W4 disagreeing on that
> one frame is the whole of this section's argument, now on the gate instead of in a comment.**
>
> ### That row stopped being the falsifier at DEC-882, and `layers-24` is what replaced it (DEC-890)
>
> **The 14 was a property of the grid, not of the policy.** At `dominaria` 2.2 radii the 64-bucket
> quantile had no edge to place *inside* a 128-layer pool — it could admit ~14–17 cells or ~291, with
> nothing between — so the reduced-motion row landed on the low arm and read 14. DEC-882 raised the
> resolution to 256 buckets, the same row now admits **78**, and its `artCellsShowing` expectation
> flipped to **GREEN**. Nothing regressed; the witness evaporated. **A falsifier resting on a
> quantisation accident expires when the quantisation is repaired** —
> `a-corpus-change-can-retire-a-sibling-control`, arriving through the resolution.
>
> **The replacement rests on an inequality instead of on a reading.** A cell shows art by holding a
> layer, so `showing ≤ pool.layers` on **every** frame of **every** build. Put the pool below the
> floor and the measure cannot reach it: no bucket count, hysteresis width or camera pose lifts
> `showing` past a capacity that is not there. `layers-24` is that row — `?layers=24` at dominaria's
> 2.2-radii pose with `prefers-reduced-motion: reduce` emulated, **14 cells against 32 on a frame
> presenting ~1,388**, with `artFraction` at **1.0000** on the same frame because every cell the
> policy wants is served: 14 wanted, 14 drawn, on 10 of 10 frozen draws (DEC-896).
>
> **The row is frozen because the moving frame loses the disagreement to turnover** (DEC-896). With
> the scene turning over the 3 s motion read-back — the hold both tier-4 siblings take — the held
> sweep reads the same thing at every capacity below the floor, three draws each:
>
> | `?layers=` | n | wanting | `artCellsShowing` | `artFraction` vs 0.900 |
> |---|---|---|---|---|
> | 16, 20, 22, 24, 28, 30, 31 | 3 each | 16 | 14 | **0.875** on 21 of 21 |
> | 26 | 3 | 16 | 16, 14, 14 | 1.0000, **0.875**, **0.875** |
>
> The capacity does not move the reading — the pool is saturated at 31 with 16 cells asking — so
> the two undrawn cells are not waiting for room. They are cells the rotation carried over the
> 37.82 px threshold during the hold that have not drawn yet: freeze the scene and the want set is
> **14**, all drawn. The same turnover costs one cell at the 128 pool (76 drawn of 77, 0.9870, 3 of
> 3 held draws) and clears the bar there; a denominator of 16 cannot absorb it. **The frozen row
> cannot see turnover** — a freeze that stabilises also hides — so the moving reading (16 wanted,
> 14 drawn, 0.875) stays pinned as a unit row. The frozen reading also carries a margin of exactly
> **one cell**: with the ceiling at 1 and the bar at 0.9, `drawn − 0.9 × wanting` is 1.4 at 14 of
> 14, and two cells of margin would need a want set of 20, which this pose does not admit at any
> capacity the inequality allows. 24 keeps 8 layers of room above the moving want set of 16 and 8
> below the floor.
>
> ### What the new row does **not** cover, and why the split is forced rather than chosen
>
> **It falsifies the measure, not the policy.** No regression in the adaptive threshold can turn
> `layers-24` green, because the capacity bound holds whatever the threshold does. A reader must not
> score it as coverage for §1.6. The policy direction is `?layers=128` — the tightest healthy rung,
> **75–77 drawn against 32** after DEC-882 (wanted 76–77, admitted 76–84) — which reds the moment the quantile starves a shipped pool again.
>
> **And after DEC-882 there is no shipped configuration left that can starve this term.** The
> quantile now tracks capacity to within a bucket, so on any rung the renderer actually ships — 128
> at the smallest — it admits of the order of the pool's own size, and `showing` cannot fall below 32
> at a surface pose unless the frame has fewer than 32 cells over 24 px to begin with, which is a
> frame far from any surface. A pool **below the smallest shipped rung** is therefore the only live
> falsifier available. `belowShippedPool` rides the W4 record on that row so the reading cannot be
> mistaken for a claim about a configuration a browser can be in.
>
> **Both halves of its read-back were confirmed against their own defect.** Drop the
> `emulateMediaFeatures` call and the row reads **123** cells, well above the floor, and the guard
> reds it as `reduced-motion-did-not-take` rather than letting it report as a W4 regression; give
> *every* page the preference and the unseamed `?layers=128` sibling reds as
> `scene-frozen-without-the-seam`. `confirm-the-instrument-sees-the-defect`.
>
> **The gap is the two *bounds*, and since DEC-842 it is no longer the two domain rules.** Both of
> the eviction half's domain rules are falsifiable live: `?layers=128` asserts `N/A` on the capacity
> one, and `unsaturated-pool` asserts `N/A` on the occupancy one. Each was confirmed against its own
> defect rather than assumed — dropping the occupancy clause turns `unsaturated-pool` from `N/A` to
> `GREEN (value 0, bound 21)` and reds the gate, measured, while the row's two GREEN partners stay
> green on the same frame. `confirm-the-instrument-sees-the-defect`.
>
> **Normative — W1's pose is the *plane-level settle*, which §1.3 now makes per-world, and it is
> **not** W4's 2.2-radii surface view (DEC-818).** The two are one row apart in this table and were
> conflated once already: DEC-752's acceptance comment and the DEC-818 routing that followed it both
> record dominaria's 17.15 px "at the 2.2-radii pose". The gate itself is right — `evaluateW1` reads
> `settleCells` unless a row sets `w1At: 'pose'`, and 17.145 is exactly the median of the settle
> cells — but at 2.2 radii that same world reads **29.36** and clears the floor, so the mislabel
> makes a real defect look like an already-fixed one. **Quote W1 against the settle and W4 against
> 2.2, and name which when either number travels.**
>
> **And the settle is no longer one number.** Until DEC-818 it was a flat `3.2 · radius` for every
> plane, which is why "the plane-level settle" and "3.2 radii" were interchangeable; §1.3's framing
> law now returns 2.261 for dominaria and 3.080 for ravnica and 3.2 for the other 43. A gate row that
> hard-codes 3.2 for W1 is measuring a pose the product does not stop at. The Appendix A figure this
> row used to quote — *"Dominaria measured 25.3 px at 3× radius"* — is a **prototype** number and is
> superseded: it was taken before §1.3's 4:3 cell aspect, which puts 6,271 cards on 81 rows where the
> prototype's tiling implies ~60, and it is not reproducible on the shipped build at any pose.
>
> **A W1 number taken offline at `HOME_POLAR` reads ~2% HIGH against the rig, because the rig does
> not arrive at `HOME_POLAR` (DEC-822 N2).** `HOME_POLAR` is 60°; measured off the probe's own
> `centre` and `cameraPosition`, the settle arrives at **63.13° on dominaria and 61.82° on ravnica**,
> and the statistic falls **0.12–0.20 px per degree** there. The 29.36 above is a live-rig artefact
> value and is right; an offline `HOME_POLAR` sweep of that same pose reads 29.94, which is the same
> 2% gap. So `worlds-framing.test.ts`'s pinned numbers — all posed at `HOME_POLAR` — are an **offline
> approximation biased ~2% high**, deliberately, because the arrival polar is per-world and only two
> of the 45 have been read. The bias does not eat the margin: re-measured at the arrival polars the
> new law gives dominaria 25.56–31.15 and ravnica 26.63–34.52 `[tilted]`, both clear. **Do not
> compare an offline `HOME_POLAR` figure to a gate artefact without pricing the 2%.**

> **Normative — W5 counts labels by opacity, not by DOM node, and the literal reading is a
> constant (DEC-751's measurement, DEC-752).** This row used to say "count rendered plane labels in
> the DOM", which reads as `querySelectorAll('.label').length`. That number is **87 on v3 for every
> renderer**: `labels/layout.ts` gives _every_ candidate a placement and signals the drop through
> opacity alone — its own comment says "every candidate still gets a placement, faded or not" — so a
> label the solver gave up on after `MAX_SHIFTS` is still a node. Read literally, W5 would compare 87
> against 46 and fail forever, including on a correct render. **The predicate is `opacity > 0.05`.**
> It sits above 0 because the gate reads a float back through the DOM, and well below 0.4 because
> PRD 5.3.11 dims an occluded plane label to 40% and a dimmed label is still on screen and still
> readable. Do not "simplify" this to a node count.
>
> **Normative — W5 is measured over a sweep of azimuths, because the home view is not a pose
> (DEC-752, measured; DEC-751's finding).** `motion.ts:247` rotates every plane by `multiverseAngle`
> every tick, so the camera azimuth is not a harness setting — it is what the scene does
> continuously, and any number read off one frame is one draw from a distribution. Measured on
> `3ce85aed66e9dc3a` at 1920×1080, fov 55, over 360 azimuths:
>
> |                                           | v3 `3ce85aed` | v2 `dabe2c9a` |
> | ----------------------------------------- | ------------- | ------------- |
> | labels visible, post-suppression          | 33 – 42       | 33 – 43       |
> | worlds labelled                           | 33 – 42 of 45 | 33 – 43 of 45 |
> | worlds **never** labelled, at any azimuth | **0**         | **0**         |
>
> The gate therefore samples **≥ 12 azimuths** (`W5_MIN_AZIMUTHS`) and reports `insufficient` below
> that. One frame is not a sweep, and the degeneracy is silent in the dangerous direction: handed a
> single azimuth, reachability collapses into exactly the single-frame coverage count it replaces
> while still reading as the stronger claim.
>
> **The sweep parameter is the multiverse rotation, not a plane's own spin — so the spin-axis
> ruling does not reach W5 (DEC-752, measured at `613715f`).** R1 raised on DEC-749 that
> `motion.ts` spins a plane about plane-local **+z** (the disc normal, PRD 8.6.2) while the surface
> law's poles are **±y**, and noted it would move what a sweep over azimuth means here. It does not,
> and the reason is structural rather than numerical: `planePosition` (`camera/motion.ts:239-248`) is
> `home + drift`, rotated by `multiverseAngle` about **y** — it applies neither spin nor shear.
> W5 anchors every label at exactly that point (`labels/PlaneLabels.tsx:206`, `:217`). A plane's spin
> is a rotation about an axis **through its own centre**, and the centre is the local origin, which
> every such rotation fixes. So the spin axis cannot move a label by construction, at any azimuth and
> under either ruling. `motion.ts:14-19` records the same invariant from the other side: the axis
> error went undetected for a whole phase precisely because every tether then resolved to a plane
> centre or a dust anchor.
>
> This is scoped to W5. The ruling is still R1's to take and still matters on R1's own surface — an
> attached sheet is not at the origin, so a globe tumbling end-over-end through the bands is a real
> defect there. W5 simply does not depend on its outcome, and no gate row should be held for it.
>
> *Amended after the cutover (DEC-774).* The ruling was taken: PRD 8.6.2's prose was wrong about
> which axis is the disc normal, and `starfield/motion.ts`, its vertex twin and `camera/motion.ts`
> now spin about plane-local **+y** — the axis §1.3 names. The paragraph above is unchanged in
> substance: its argument is structural — a plane's spin fixes the plane's own centre, whatever the
> axis — so it holds on both sides of the change, which is why W5 was not re-derived for it.
>
> **Normative — the ceiling half is a regression check on §1.8's suppression, and is named as one
> (DEC-752).** Once the moons are unlabelled until hover, the candidate list is the 45 worlds and
> the belt is filtered by slug, so at most 45 labels can exist against a ceiling of 45: the half
> holds **360 of 360 azimuths, for every renderer, by construction**. A bound-check is vacuous when
> the bound never binds. It is kept because it does bind on the one renderer that matters — with
> suppression regressed the same sweep reads **66 – 77 and fails 360 of 360** — but a green
> `homeLabels` is evidence that the moons are quiet, **not** evidence that the home view is legible.
> Do not read it as the latter.
>
> **Normative — a label count quoted against this ceiling must name its candidate list (DEC-752,
> measured on DEC-751's branch).** DEC-751 read 66 – 75 visible plane labels today and 75 – 85 under
> their separation epsilon, against a ceiling of 45, and raised it as a ruling that the ceiling is
> unreachable. It is the same sweep over a different population — theirs the **pre-§1.8 list of 87
> planes**, the ceiling's the **post-§1.8 list of 45 worlds** — and §1.8 is exactly the transform
> between them. Measured at 1920×1080, 360 azimuths, both arms through the shipped solver:
>
> | candidates                  | pre-fix | with the epsilon |
> | --------------------------- | ------- | ---------------- |
> | 87 planes (today, pre-§1.8) | 64 – 78 | 75 – 85          |
> | 45 worlds (post-§1.8)       | 33 – 42 | 40 – 45          |
>
> There is no ruling to make: the ceiling is not violated on the tree the gate runs against. The
> epsilon does take its slack from 3 labels to **0** — 45 against 45 — which is tight but still
> unexceedable, since 45 candidates cannot make 46 labels. The bound stays non-binding.
>
> **Normative — the second half is reachability, not coverage-at-a-frame, and DEC-751's proposed
> coverage floor is not adopted (DEC-752, measured).** A ceiling is satisfied by rendering _fewer_
> labels and does not care which, so W5 needs a half that does. DEC-751 proposed ≥ 90% of worlds
> labelled (equivalently ≤ 4 missing). Over the sweep the shipping renderer meets that at **17 of
> 360 azimuths — 4.7%**: adopting it scores a renderer doing exactly what §1.8 and §2.4 ask as RED
> at 95% of the frames the harness might grab, and takes this section's expected-GREEN row with it.
>
> That is the **third instance of one defect** — the stale ceiling of 30, the 0.9 floor, and now the
> coverage proposal that replaced it — and the shape is always the same: a threshold read off a
> single measurement of a moving system, then written down as a law. The lesson is normative for
> this section: _a bar proposed alongside a measurement must be checked against that measurement's
> own spread before it is written down._
>
> Coverage also does not buy the stability it was proposed for. Its argument was that it does not
> care _which_ worlds win — but the **count** of winners swings 33 – 42 across azimuth, a band as
> wide as the label count's own. Changing which quantity is sampled does not stop it being a sample.
>
> What is invariant under the rotation is **reachability**: whether a world is labelled at _some_
> azimuth. It is the claim PRD 5.3.8 actually makes, it reads 0 never-labelled on both datasets, and
> unlike a count it distinguishes "hidden this frame" from "permanently lost" — which is the defect
> a coverage cap cannot see at all.
>
> **The open ruling is now the share, not the floor.** The gate reports how often each world is
> legible and sets no bar on it: v3's weakest is `karsus` at **20.3%** of azimuths, v2's is
> `avishkar` at **49.7%**, so v3 is a regression on a measure nobody has set a bar for. That is a
> product ruling about how often a world may be invisible, and it is routed to the CEO rather than
> retuned here — picking a number alongside the measurement is exactly how the 0.9 happened.
> `evaluateW5` takes `minAzimuths` as a **required argument with no default**, for the reason the
> 30 went stale.
>
> **Normative — the sweep must be evenly spaced around the turn, and the gate checks it (DEC-752,
> measured).** `minAzimuths` bounds how many samples a sweep has; this bounds _where they are_, and
> the second turns out to be load-bearing. Reachability survives a sweep as sparse as 12 only
> because the miss pattern has arc structure at the scale of the spiral's arms and an evenly-spaced
> comb crosses every arm. Against the 360-azimuth hit matrix on `3ce85aed66e9dc3a` — every strided
> sweep enumerated exactly, random ones over 2,000 trials:
>
> | sampling                   | N = 12      | N = 24  | N = 36  |
> | -------------------------- | ----------- | ------- | ------- |
> | evenly spaced (all phases) | **0 of 30** | 0 of 15 | 0 of 10 |
> | random                     | **2.5%**    | 0.1%    | 0.0%    |
>
> Every one of those is a **false RED** — the renderer reaches all 45 worlds and the sweep says
> otherwise. A gate that flakes 1 run in 40 gets its reds explained away, which costs more than the
> criterion is worth, so `azimuthSpacingFault` makes uniformity a precondition rather than a
> convention. It reports `insufficient`, never `fail`: a badly sampled sweep is the harness's defect
> and not the renderer's.
>
> **Normative — W5's 800×600 control expires when DEC-751's separation epsilon lands, and the row
> moves to 320×240 (DEC-752, measured).** The reachability half is falsifiable today at 800×600,
> where the sweep leaves `thunder-junction` unlabelled at all 360 azimuths. Applying DEC-751's
> 0.01 px epsilon to the shipped solver and re-running the same sweep takes that to **0 worlds never
> labelled** — the control goes green and the half is left with nothing that can turn it red. The
> replacement is the same seam pushed further: at **320×240** five worlds (`amonkhet`, `gobakhan`,
> `muraganda`, `shandalar`, `tolvada`) are unlabelled at every azimuth, while 640×480, 480×360 and
> 400×300 are all still 0 — so the row moves to 320×240 and not to the next size down.
>
> Switch the row **when the epsilon lands, not before**: on today's tree both viewports are red, and
> 800×600 is the honest one. A control row whose expiry is known and unrecorded is how a gate keeps
> a green it has stopped earning.
>
> **Normative — W2's IQR(L\*) half is measured on an iso-shade subset, and the un-subsetted version
> it replaces could not fail (DEC-749, on DEC-752's finding).** §1.4's shade runs
> `0.10 + 0.95·s²` with `s = clamp(dot(n, light)·0.5 + 0.5, 0, 1)`, and §1.7 puts the key light
> 0.798 rad off the camera axis, so over the front-facing cap (`dot(n, toCamera) > 0.12`) shade
> spans quartiles **0.363 / 0.611 / 0.852**. That gradient alone — _one swatch for the whole
> world_ — puts IQR(L\*) between **12.6 and 21.6** for every swatch luminance from Y = 0.10 to 0.50,
> against a floor of 8; the ≥ 6 px cut trims the limb and narrows the worst case only to 11.9.
> (`surface-law-check.py` re-derives all of it.) The lightness spread W2 was reading is the
> **sphere being lit**, not the mosaic
> being tiled: no arrangement of cells, and no collapse of the palette, can drive it under 8 while
> the globe is shaded and round. A criterion that cannot fail is not a criterion.
>
> Holding shade fixed removes the gradient and leaves swatch-to-swatch lightness, which is what W2's
> title claims to measure. **±2.5% of the median shade** is the band: it is an iso-shade _ring_
> around the sub-light point, so it crosses most of the 13 bands and samples the palette widely,
> while a tonemap — monotone and per-channel — maps every cell in the ring identically and so cannot
> reintroduce a gradient. This also repairs the control: under `?swatch=mean` every cell in the ring
> is the _same colour_, iso-shade IQR(L\*) goes to ≈ 0, and one control row now falsifies **both**
> halves of W2 instead of one.
>
> **The floor of 8 is provisional and is re-derived once leg P publishes `swatches.bin`**, because 8
> was set against a measure that could not go below ~12. R1's first full gate run records the
> observed iso-shade IQR per plane and the floor is set from the worst plane, in a spec amendment;
> until then the gate reports the measure and the matrix asserts its _direction_ (real build high,
> `?swatch=mean` ≈ 0), which is decisive wherever between ~2 and ~20 the floor lands.

> **Normative — a control row names the measure it aims at, not just the criterion (DEC-752).** W2
> and W4 are conjunctions, and a conjunction hides which half did the work: a row recorded as "W2
> went RED" reads as evidence for both halves when it may be evidence for one. Each row below
> carries the measure key it must move, and the runner asserts that measure, so a half with no
> control of its own is visible as a gap rather than borrowed from its partner.
> **Normative — the smallest worlds are below W2's and W3's domain, and a correct build goes RED
> without this (DEC-752, on DEC-751's finding).** The Forgotten Realms refresh introduces **six
> worlds holding exactly one card** (ergamon, muraganda, pyrulea, regatha, segovia, shandalar) and
> 15 holding ≤ 4; `minWorld` across tracked datasets was {41, 30, 6} and production now contributes
> **1**. W1 survives this — a one-cell world's cell is enormous and never becomes the worst plane —
> but W2 and W3 are **undefined** there, not merely noisy, and the gate's own module returns:
>
> | measure                 | value at n = 1 | why                                                         |
> | ----------------------- | -------------- | ----------------------------------------------------------- |
> | `medianNeighbourDeltaE` | `null`         | "nearest on-screen neighbour" has no referent with one cell |
> | iso-shade `IQR(L*)`     | `0`            | the interquartile range of a single sample                  |
> | `minAdjacentBandDeltaE` | `null`         | one populated band, so **zero** qualifying adjacent pairs   |
>
> Scored as ordinary failures — which is what a floor comparison does to a `null` — those six worlds
> turn the matrix's **expected-GREEN** row ("the unmodified build on the v3 production dataset")
> RED, on a renderer doing exactly what this section asks. That is W5's stale-30 failure again, one
> criterion over: unsatisfiable by construction on the dataset the gate exists to accept.
>
> So W2 and W3 carry a **sample-size precondition** and a third verdict. A plane with fewer than
> **4 sampled cells** for W2, or with no qualifying adjacent band pair for W3, reports
> `insufficientSamples` — not `pass`, not `fail` — and the gate prints the count of planes that
> landed there. A criterion may not be silently skipped: an `n/a` that is invisible is how a gate
> comes to measure nothing while printing green. The threshold is 4 because IQR needs two quartiles
> to be a spread rather than a gap, and because a 4-cell world measured 133.0 ΔE / 33.6 IQR in the
> module's own test — comfortably inside the domain — while 1 is outside it.
>
> **The degenerate worlds are still covered, by W1 and W4, which are defined at n = 1**, and by the
> dedicated matrix row below. What may not happen is a whole-multiverse aggregate quietly averaging
> over them: a single degenerate world is exactly what an aggregate seam measure does not catch.

> **Normative amendment — W2's lightness half carries its own, larger domain: 20 iso-shade cells
> (DEC-752, ruling `w2_ring` on DEC-816 R3; supersedes the "4 sampled cells" threshold for this half
> only).** The 4 above is the domain of the **sampled set**, which is what the neighbour half walks.
> The lightness half is an IQR over the **iso-shade ring**, and ±2.5% of the median shade selects a
> sliver of the disc by construction — so that half spends its life at the bottom of its domain and
> four cells is not enough to make it reproducible. Measured across two 45-world acceptance runs of
> the same head (`21737f3`) on the same dataset (`c9468f1125bcddff`):
>
> | ring ≥ | worlds scored | worst run-to-run move | worst world              | smallest IQR seen |
> | ------ | ------------- | --------------------- | ------------------------ | ----------------- |
> | 4      | 20            | 58.4%                 | capenna (16.04 → 38.54)  | 4.40              |
> | 6      | 15            | 56.6%                 | arcavios (5.87 → 13.55)  | 4.40              |
> | 8      | 11            | 55.4%                 | theros (32.23 → 14.38)   | 14.05             |
> | 14     | 6             | 18.9%                 | innistrad (27.73 → 22.48)| 14.46             |
> | 20     | 2             | **7.6%**              | dominaria (26.34 → 28.52)| 26.34             |
>
> **Both worlds that carried W2's RED were scored off six cells** — ixalan 4.40/4.53 and arcavios
> 5.87/13.55, the latter moving by 131% of the floor between two runs of one build. The verdict does
> not turn on the exact threshold: from ring ≥ 8 upward every world clears the floor of 8 on both
> runs and the smallest reading anywhere in that set is 14.05, so anywhere in 8…20 gives the same
> GREEN and only the stability of the surviving statistics changes. 20 is the conservative end of a
> range whose verdict is constant.
>
> **The cost, stated: at 20 the half scores 2 of the 45 worlds** (dominaria 64, ravnica 22) and the
> aggregate is the worse of two. **The subject of the `swatch-mean` control row is therefore no longer
> a free choice** — a control measured on a world below the domain reports `insufficient`, which is
> not RED, and the matrix would record a retired falsifier as a passing row. The gate refuses to score
> that row without a qualifying ring (`W2_CONTROL_SUBJECT_MIN_RING`) rather than reporting it.

> **Normative — a folded verdict is printed with the set it was folded over.** Every multi-world
> measure is the worst world *in domain*, so `checkControlRow` reports `worst of N worlds in domain
> (slug), M out of domain` beside the value. Without it this domain would have made the report most
> reassuring exactly where its evidence had thinned: `W2.lightnessIqr went GREEN as expected (value
> 20.2, bound 8)` reads identically whether it was folded over two worlds or forty-five. The
> denominator prints on a full-roster GREEN too — one that appeared only when the evidence was thin
> would be a warning, and its absence would come to be read as "fine".

**Owner-judged, carried over from 9.3 unchanged:** motion perceptible within 3 s of arriving at any
level; no aliasing shimmer on slow camera moves (recordings cast at the drawing buffer's own
resolution — half-size is the one scale that hides it, DEC-661); art fade-ins never noticed as
events; the focused card's tilt feels physical; and, new, **the tether reads as footed into ground**.

> **Normative — every criterion ships with a negative control, and `--negative-controls` runs the
> matrix.** A criterion that has never been seen to fail is not an instrument, it is a rubber stamp;
> the same discipline that caught `verify-browser --dataset all` printing "all datasets verified"
> while running two fixtures.

| Criterion | Measure asserted                       | Control                                                                                                                                                                     | Must go   |
| --------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| W1        | `minMedianCellHeightPx`                | capture at 6× radius instead of the settle (prototype measured 10.1 px there)                                                                                               | **RED**   |
| W2        | `medianNeighbourDeltaE`                | `?art=off&swatch=mean` — every cell takes the plane's mean swatch, **and draws it**                                                                                         | **RED**   |
| W2        | `lightnessIqr`                         | `?art=off&swatch=mean` — same row, second half: iso-shade cells become one colour                                                                                           | **RED**   |
| W3        | `minAdjacentBandDeltaE`                | `?art=off&bands=shuffle` **over the full tour** (`w3-floor-control`) — cards permuted across each plane's cells, grid and reported `band` unchanged. A roster mean can only be falsified by a roster; the one-world row that used to sit here now asserts **N/A** — see the fold amendment | **RED**   |
| W2        | both measures                          | `?art=off` **alone** — the sibling the composed rows are read against, not the bare build                                                                                   | **GREEN** |
| W3        | `minAdjacentBandDeltaE`                | `?art=off` **over the full tour** (`w3-floor-shipped`) — the shipped side of the same derivation, differing in the one seam                                                  | **GREEN** |
| W4        | `artFraction`                          | `?artThreshold=fixed24&layers=128` — §1.6's seam against a tier-4 pool: **a fixed threshold against a pool too small for it**, which is what Appendix A captured. 0.1342 against a bar of 0.5, a 7.39× overshoot. The **bare** `fixed24` row this replaces is retired — see the note | **RED**   |
| W4        | `demandFitsCapacity`                   | `?artThreshold=fixed24&layers=128`, same row — the overshoot itself, dominaria's full want set against 128 layers (7.39×). **Reported, not scored** (ruling `demand_measure_scored` = `reported_only`), so it cannot red a row on its own; the row asserts it so the overshoot the bar forgives stays falsifiable (DEC-861, from DEC-856) | **RED**   |
| W4        | `artCellsShowing`                      | `?artThreshold=fixed24&layers=128`, same row — the absolute term stays green on the frame `artFraction` reds: the fixed threshold keeps the want set full, so the pool is short of *layers*, not of wanting cells. The RED above is the fraction's alone, which is what makes it a reading of the pool and not of a page that drew nothing (DEC-861) | **GREEN** |
| W4        | `evictionsPerSecond`                   | **the bound has no live row.** Exceeding want-set turnover at the 1,024-layer pool needs a faster spin or a bigger roster; `spinPeriodS` is dataset data, so a live row means a fixture corpus. Falsified by unit row *"still reds the same row when turnover climbs past the new bound"*. **Its two domain rules do have live rows** — `?layers=128` for the capacity one and `unsaturated-pool` below for the occupancy one | **n/a**   |
| W4        | `evictionsPerSecond`                   | **`unsaturated-pool`** — kamigawa (917 cards) at the shipped pool, no seams: a world whose whole demand fits, high-water **265 of 1,024**, so `claimLayer` never reaches its victim search and the rate is a structural 0. The 45-world tour runs this rule on 44 worlds and cannot falsify it — the fold is a worst-of and dominaria saturates, so `baseline` passes with the rule and without it | **N/A**   |
| W4        | `artFraction`, `artCellsShowing`       | **`unsaturated-pool`**, same row, the half that says it rendered: an `N/A`-only row cannot tell a working domain rule from a page that failed to draw, and both report the same `n/a`. The art half going green on that frame is what makes the `N/A` above a reading | **GREEN** |
| W4        | `artCellsShowing`                      | **`layers-24`** (DEC-890) — `?layers=24`, a pool **below the floor of 32**. A cell shows art by holding a layer, so `showing ≤ pool.layers` on every frame of every build: the measure cannot reach 32 however the quantile is resolved, posed or held. Reads **14** against 32 on 10 of 10 frozen draws on a frame presenting **~1,388** ≥ 128. The row takes the 3 s motion read-back its tier-4 siblings take, with `prefers-reduced-motion: reduce` emulated so the frame it scores is settled *and* still (DEC-896; see the note for why frozen). It pins "the floor is above 14", not "the floor is 32": a floor of 16 leaves it RED. This replaces `layers-128-reduced`, whose 14 was an artefact of the 64-bucket grid and which reads 78 since DEC-882 — see the note. It falsifies the **measure**, not the policy: no threshold regression can green it, and `?layers=128` below is the policy's row | **RED**   |
| W4        | `artFraction`, `demandFitsCapacity`    | **`layers-24`**, same row, and the disagreement is the point: every cell the policy wants is served, so the ratio reads **1.0000** — 14 wanted, 14 drawn, 10 of 10 frozen draws — on the frame the absolute count reds. This is `a-ratio-is-blind-to-its-own-denominator` as a live control instead of a note. The margin is **one cell** (13 of 14 still clears 0.900). **Scored frozen, so it cannot see turnover**: with the scene moving the want set is 16, 14 draw, and the ratio reads 0.875 — pinned as a unit row; at the 128 pool the same turnover is 76 of 77 (0.9870). If the freeze does not take the read-back reds the row as `reduced-motion-did-not-take` before any cell is scored. `demandFitsCapacity` is asserted beside it — **0.5833**, 14 cells into 24 layers — so a future pose that pushed the want set past the pool reds *there* and names the reason | **GREEN** |
| W4        | `artCellsShowing`, `artFraction`       | **`layers-128-reduced`** (DEC-843, flipped at DEC-882) — the same row at `?layers=128` with `prefers-reduced-motion: reduce` emulated as the **OS preference** before `goto`. It read **14** cells and was the term's live RED until the quantile went to 256 buckets; it now reads **78** and is a partner rather than a falsifier. It still pins the **domain** (dominaria presents ~1,388 ≥ 128, so the measure is scored, not `N/A`) and still reds if the reduced-motion path ever starves the want set again. Its read-back is asserted **in both directions** — `multiverseAngle` frozen bit-identically here, and moving on the unseamed `?layers=128` sibling | **GREEN** |
| W4        | `evictionsPerSecond`                   | `?artThreshold=fixed24&layers=128`, `?layers=128`, `layers-128-reduced` and `layers-24` — the rows that pin the **capacity domain**: away from the 1,024-layer pool the eviction half must read `N/A` and not a comfortable green. A want set that stops asking is a pool that stops churning, and a pool too small to hold what the frame wants refuses rather than evicts, so both the frozen row and the starved one assert it | **N/A**   |
| W4        | `artCellsShowing`                      | `?layers=128` — the absolute term must stay **green on a healthy tier-4 frame** (**75–77** cells drawn against 32, 2.3–2.4× above — wanted 76–77, drawn 75–77, admitted 76–84 over the live draws after DEC-882, DEC-889/894/896; it read **124** at the arrival pose PR #85 replaced, DEC-845), which is the partner that keeps the row above from scoring an always-red instrument. **The figure belongs to this row's harness configuration and not to the build**: DEC-843 attached a 3 s `multiverseAngle` read-back to it, and the frame is taken after that hold — at the DEC-845 pose, 128 with the hold removed and 127 before the read-back existed. A number quoted from a sibling configuration of the same build would be wrong by 3% here | **GREEN** |
| W5        | `homeLabels`                           | labels forced on for empty planes — suppression regressed; **66 – 77 over the sweep, _above_ the unmodified build's 33 – 42; see the note**                                 | **RED**   |
| W5        | `worldsNeverLabelled`                  | **viewport 800×600** — collision pressure raised by the harness, not by a renderer seam; `thunder-junction` is labelled at **none** of 360 azimuths                         | **RED**   |
| W1, W4    | `minMedianCellHeightPx`, `artFraction` | a **one-card world** (`?plane=segovia`) at its own settle — the n = 1 extreme, never rendered in any tracked dataset before v3. **Does not assert its label**; see the note. Its `artCellsShowing` asserts **N/A**: a frame presenting one cell is far below the 128 that term needs before an absolute count means anything, and that is domain, not failure | **GREEN** |
| W1        | `centreContrastDeltaE`                 | the **one-card world**, same row — the pixel witness: its cell's centre against the sky around it, at the worst counted phase. The row's only pixel reading; every other measure it scores is computed before a fragment is shaded (DEC-861) | **GREEN** |
| W1        | `centreContrastDeltaE`                 | **`one-card-no-cell-draw`** — the same row with the `WorldCell` program's draws suppressed by a harness init script, refused if it suppressed none. Reads **12.8–13.5** against 28, three draws, while the shipped row reads 58.1–58.4 | **RED**   |
| W1, W4    | `minMedianCellHeightPx`, `artFraction` | **`one-card-no-cell-draw`**, same row — the blind spot as a live reading: the payload is the unmodified build's, so the height and the art fraction stay green on a frame with no cell on it | **GREEN** |
| W4        | `artFraction`, `artCellsShowing`       | `?layers=128` — tier 4's pool, unmodified policy. **`evictionsPerSecond` is N/A here, not GREEN** (ruling `bd5c9aad`): 6.73/s is inside 21 only because the pool refuses ~4,670 wants/s, and recording that as a pass would certify the starvation the art half forbids | **GREEN** |
| W4        | `demandFitsCapacity`                   | `?layers=128`, same row — the healthy tier-4 want set **fits** its pool since DEC-882's 256-bucket threshold: 76–77 cells wanting art against 128 layers. It read RED (207–209 against 128) until then, and DEC-861's brief, written at `de677cc`, still said RED; the live matrix is the authority and says GREEN. Reported, not scored | **GREEN** |
| W5        | `worldsNeverLabelled`                  | **viewport 1920×1080** — the non-binding partner to the row above, differing in that one parameter                                                                          | **GREEN** |
| all       | all                                    | the unmodified build on the v3 production dataset                                                                                                                           | **GREEN** |

> **Measured, diagnosed and repaired — the three RED rows that did not go RED now do (DEC-752,
> DEC-821, DEC-824).** The history is kept because it is the argument for the sixth seam, and because
> the diagnosis is the reusable part. On matrix run `controls1` (head `21737f3`, dominaria, one
> build), every seam **engaged** — requested, echoed, and where there was a policy witness the policy
> had moved — and three rows still failed to falsify anything:
>
> | row / measure                        | with the seam | siblings **without** it   | floor | verdict on the control |
> | ------------------------------------ | ------------- | ------------------------- | ----- | ---------------------- |
> | `?swatch=mean` → `lightnessIqr`      | 24.89         | 16.09 / 21.28 / 25.89     | ≥ 8   | **inert** — inside the sibling spread |
> | `?swatch=mean` → `medianNeighbourDeltaE` | 15.73     | 19.37 / 23.79 / 25.72     | ≥ 6   | moves, stays 2.6× above the floor |
> | `?bands=shuffle` → `minAdjacentBandDeltaE` | 0.476   | 0.815 / 1.116 / 1.121 / 1.450 | ≥ 10 | moves; both sides already RED |
>
> **One mechanism explained all three: at the 2.2-radii pose the sampled pixel is card _art_, and
> both seams perturb the _swatch_.** `artFraction` at that pose measures **0.987–0.997** — ten cells
> in ten — so the swatch is a layer the capture does not show. §3.1 defines W2 and W3 on the
> **swatch** and requires sampling the **capture**; at this pose those were not the same quantity,
> and a seam that moves only the swatch is inert by construction rather than by accident.
>
> **The repair is `?art=off` (DEC-821): drop every cell to its swatch, so the swatch _is_ the
> capture.** Composed, both W2 halves fall below their floors, measured on main `28d4676`:
>
> | row | `medianNeighbourDeltaE` (≥ 6) | `lightnessIqr` (≥ 8) | `minAdjacentBandDeltaE` |
> | --- | --- | --- | --- |
> | no seams | 27.41 – 27.86 | 24.42 – 28.84 | 2.354 – 3.050 |
> | `?art=off` — **the sibling** | 17.92 | 16.50 | 1.329 – 1.333 |
> | `?art=off&swatch=mean` | **0.954** | **4.673** | — |
> | `?art=off&bands=shuffle` | — | — | **0.422 – 0.423** |
>
> Read the composed rows against `?art=off` **alone**, never against the bare build: the seam moves
> W2 by itself, and scoring the composition against `baseline` would credit the seam under test with
> that move too.
>
> **W3's floor, re-derived rather than argued down (ruling `hold_pending_control`, now retired).**
> The impasse recorded here was that the shipped aggregate read **0.4253** (ravnica, worst of 28),
> *below* its own shuffled control at **0.4757** — a criterion that cannot fail. On main `28d4676`
> the shipped aggregate reads **0.7070**, so the impasse's figures have moved out from under it; the
> old pair predates DEC-804's centre fix, DEC-812's budget and DEC-814's belt rotation and must not
> be re-carried. The floor is now **0.55**, derived from three live readings — acceptance tour worst
> **0.7070** (n=1), the composed control **0.4195–0.4477** (n=4) and the sibling **1.2935–1.3327**
> (n=4) — which leaves the interval **(0.4477, 0.7070]**; 0.55 sits 23% above the control's
> worst-case reading and 29% below the build's. The lower bound is the **max** of four control
> sessions and not one of them: a single session would have given a floor that looked 31% clear of a
> control it is really 23% clear of. The upper bound is n=1 and is the less-tested half.
> `scripts/w3-floor.mjs` re-derives it; §4.3 of the runbook says when.
>
> **Three things that floor does not claim, each measured and none of them a defect.** A tour-wide
> `?art=off` row would go RED against it (that arm's worst world is avishkar at 0.4505; no shipped
> row asserts it). `?bands=shuffle` is **one permutation seeded by a constant**, so it reproduces
> exactly without being the statistic — on **8 of 28 worlds the shuffled frame scores _higher_ than
> the unshuffled one**, and the direction does not correlate with cell count, band count or band
> share. And the floor is a property of the shipped swatches, resting on one world (ravnica) from
> above, so a refresh can invalidate it without a line of rendering code changing.

> **Retraction — the interval `(0.4477, 0.7070]` does not exist, and 0.55 does not separate
> anything (DEC-752, routed from DEC-830).** The block above flags its own weakness in one line —
> "the upper bound is n=1 and is the less-tested half" — and that line turns out to carry the whole
> derivation. Re-read off the gate's own summaries rather than off this document, the upper bound is
> not a reading but a **draw from a distribution that straddles the floor**:
>
> | run | worlds visited | in W3's domain | `minAdjacentBandDeltaE` | worst plane | `artFraction` |
> | --- | --- | --- | --- | --- | --- |
> | `accept3` | 45 | 28 | **0.8005** | innistrad | 0.6956 |
> | `dec826-bare` | 45 | 28 | **0.7070** | ravnica | 0.7447 |
> | `accept4` | 45 | 28 | **0.4253** | ravnica | 0.6952 |
> | `acceptance2` | 45 | 28 | 0.5316 | forgotten-realms | 0.0000 |
> | `acceptance` | 45 | 28 | 0.2528 | eldraine | 0.0000 |
> | `order-fwd` | 8 | 5 | 1.3499 | avishkar | 0.9896 |
> | `order-rev` | 8 | 5 | 1.3926 | avishkar | 0.9896 |
>
> "In W3's domain" is 45 less the 17 planes the criterion reports `insufficientSamples` on — the
> six one-card worlds and their kin — and it is the population the fold minimises over. Read the top
> three rows alone. They are the same dataset (`c9468f1125bcddff`), the same 45-world roster, the
> same 28 worlds in domain, and the same 2.2-radii pose, and they span **0.4253 – 0.8005, a factor
> of 1.9, with 0.55 inside it**. The floor was set from the middle one. Two further draws on
> DEC-830's tree — 0.1632 and 1.2100/1.2259 — widen the same span without changing its verdict.
>
> **0.4253 was not a retired figure.** The block above dismisses it as predating DEC-804's centre
> fix, DEC-812's budget and DEC-814's belt rotation. It does not: `accept4` drew it on leg G, with
> all three in the tree, and DEC-830 re-drew it again. The impasse's figures did not move out from
> under the impasse — the impasse is reproducible, and the composed control's worst reading
> (**0.4477**, n=4) sits *above* the shipped arm's lowest (**0.4253**). The two intervals **overlap**,
> which is `w3-floor.mjs`'s documented "no separating floor exists" outcome rather than a floor to
> pick.
>
> **Why the fold moves this much, which is the part that generalises.** §3.1 folds W3 to the worst
> world, and each world's own reading is already the closest of its qualifying band pairs — so the
> tour value is a **minimum of minima over a population**, and its expected value falls as the
> population grows. The last two rows measure exactly that on the same dataset: truncated to the
> first 8 worlds alphabetically the fold reads 1.35 and 1.39 over 5 in-domain planes; over all 28 it
> reads 0.25 – 0.80. The worst plane's *identity* is not stable either — innistrad, ravnica,
> eldraine, forgotten-realms, avishkar across five draws — which is what a min over a fluctuating
> population looks like from the outside.
>
> **That it is the fold and not the renderer is measurable, and it was measured.** The three
> full-roster draws above put the same 28 worlds in W3's domain, and their per-world readings are on
> disk in each run's `baseline/visits.json`. Re-folded four ways over exactly those 28 values:
>
> | fold | `accept3` | `dec826-bare` | `accept4` | spread |
> | --- | --- | --- | --- | --- |
> | **min** (shipped) | 0.8005 | 0.7070 | 0.4253 | **1.88×** |
> | p10 | 1.3190 | 1.4626 | 0.8962 | 1.63× |
> | p25 | 2.1101 | 1.9939 | 1.9588 | **1.08×** |
> | median | 3.0965 | 3.0155 | 3.6764 | 1.22× |
> | mean | 4.0393 | 3.9835 | 4.1361 | **1.04×** |
>
> `scripts/w3-fold.mjs` prints this table from the run directories; it is not a figure to take on
> trust here. The underlying frames are the same frames — only the choice of fold decides whether the
> criterion reproduces. At p25 or the mean the three draws agree to within 8%; at the minimum they
> disagree by a factor of two. **"Use a quantile" is not by itself the fix**: p10 still swings 1.63×,
> because the low tail is where all of the movement lives. The volatility is not spread evenly
> either — ulgrotha reads 12.13 / 11.90 / 12.00 across the three (1.02×) while avishkar reads
> 1.39 / 2.03 / 5.74 (4.14×) — so the fold is sampling whichever world happens to draw badly that
> session, and 0.55 is a bet on which one that is.
>
> So a converging statistic exists in this data — p25 or the mean over in-domain worlds, with the
> worst plane and its value still reported as evidence rather than as the score. **Choosing one is a
> §3.1 amendment and belongs to the owner, not to this leg**; leg G records the measurement and does
> not move the criterion. Note what the change would *not* buy: it makes W3 reproducible, and it does
> not by itself re-establish separation from `?art=off&bands=shuffle`, which has to be re-derived
> under whichever fold is chosen — and re-derived from the arms' *distributions*, since that is the
> error this block exists to retract.
>
> Until that is settled, `FLOORS.bandDeltaE` stays at 0.55 **as a recorded non-separating value**,
> not as an accepted floor, and §3.2's condition 1 may not be read as cleared for W3 on the strength
> of a GREEN row — see the note there.

> **Normative — W3's roster fold is the MEAN, and this settles the retraction above (board ruling
> `fold_mean`, card `7d3653f6`, 2026-09-17; implemented DEC-836).** The worst-world fold is retired,
> and `0.55` retires with it: a floor derived against a statistic nobody uses any more is not a floor
> that was lowered, it is a floor whose subject no longer exists.
>
> **What changed, exactly.** A world's own reading is untouched — still the closest of its qualifying
> adjacent band pairs. Only the cross-world fold moves: from `min` over the in-domain worlds to their
> **arithmetic mean**. The board chose it on the table in the retraction above, re-checked at n=5
> before the choice was made rather than after: mean **1.09×** across five identical sessions, median
> 1.22×, p25 1.38×, min 1.88×, and **p10 2.37× — worse than the min it was offered to replace, having
> looked like the best quantile in the table at n=3**. A fold ranking taken at one n is not a ranking.
>
> **What a mean costs, said plainly.** One degenerate world can no longer red the roster by itself,
> and that is the property the worst-case fold had. The board took the trade knowingly, because the
> fold it replaces did not have that property *either* in any usable sense: across five sessions it
> scored **three different worlds**, so what it actually reported was whichever world happened to
> draw badly that session. Two things are owed in exchange, and §3.1 requires both.
>
> **1. The domain is scored, not reported.** A mean over a thinned domain is a different statistic in
> the same units, and thinning *flatters* it — drop the low worlds and the number goes up. So the
> gate carries the roster's expected denominator and a tour whose scored domain is not exactly that
> is **RED on its denominator**, with the shortfall named, whatever its mean reads. This is a real
> failure mode and not a hypothetical: the two truncated runs in the table above (`order-fwd` /
> `order-rev`, 5 in-domain worlds) printed a W3 line in exactly the same shape as a full tour's.
>
> **The record is two numbers, because W3's domain has two gates and they do not agree.**
> `W3_DOMAIN_SIZE` (beside `FLOORS`) carries, per dataset hash, the count of worlds whose **cards**
> put an adjacent band pair over the 5% share rule, and the count that then **present both of those
> bands in the sampled cells**. On `c9468f1125bcddff` those are **30 and 28**: `shenmeng` (30 cells)
> and `zhalfir` (4 cells) qualify on their card distribution and populate a single band on screen, so
> W3 has no pair to compare on them. The first draft of this amendment asserted the two counts were
> equal, and the first full tour that ran it went **RED on every roster row, including the acceptance
> row** — the by-share count is an **upper bound** on the scored one, never a second spelling of it.
>
> Neither number is redundant and neither is left alone with itself. The domain size is a **dataset
> property** not derivable from `planes.json` — band shares come from per-hue card counts in the
> shards — so both are recorded; the **scored** count catches a tour that visited too few worlds or a
> world that lost a band at the pose, which the run's own data cannot (eight worlds toured report
> eight of everything), and the **by-share** count is a pure function of the dataset, so it catches a
> refresh moving under the record even where the scored count lands on 28 again. An unrecorded
> dataset is a **RED**, never a skipped check.
>
> **2. The per-world readings are published.** `summary.json` carries every reading the mean was
> taken over, lowest first, beside `scoredPlanes` and the expected denominator, and the report prints
> `mean of 28 of 28 worlds in domain, lowest <slug>`. A roster mean that cannot be taken apart is a
> number asking to be trusted.
>
> **A one-world row cannot score this criterion, and the matrix says so.** W3's verdict is a roster
> statistic; measured on a single subject it is a different number, not a small version of the same
> one. The gate reports **N/A** for W3 on every subject row, and the three that named W3 —
> `art-off`, `artoff-bands-shuffle`, `no-seams` — now assert that N/A. **The consequence is that W3's
> live falsifier is a full tour**: the `w3-floor-control` row, which is also the control side of the
> floor derivation. `--negative-controls` does not run it (two tours, ~30 minutes), so exercising
> W3's control means running the derivation pair. That cost is the ruling's, not an omission:
> scoring dominaria's own ~1.3 reading against a roster mean would red the `?art=off` sibling every
> composed control row is read against, for arithmetic rather than for a defect.

> **Normative — `FLOORS.bandDeltaE` is 3.1, derived on the mean over seven sessions per arm
> (DEC-836).** Both arms are full 45-world tours at the 2.2-radii pose on leg G `f821ccd`, **28
> worlds in W3's domain in every one of the fourteen, 0 dropped**. The mean fold is computed offline
> from the tours' own per-world readings, so these numbers do not depend on the gate change they
> justify.
>
> | arm | seven session means | spread | binds |
> | --- | --- | --- | --- |
> | `?art=off` (`w3-floor-shipped`) | 3.3102 · 3.4558 · 3.4493 · 3.3982 · 3.3696 · 3.3359 · 3.3062 | **1.05×** | floor ≤ the **min**, 3.3062 |
> | `?art=off&bands=shuffle` (`w3-floor-control`) | 2.7835 · 2.8203 · 2.9467 · 2.9058 · 2.9587 · 2.8762 · 2.8013 | **1.06×** | floor > the **max**, 2.9587 |
>
> **The arms do not overlap**, which is the thing the retracted floor could not claim, and the
> interval is **(2.9587, 3.3062]**. **3.1** sits inside it — 4.8% above the control's worst reading,
> 6.2% below the build's — at two significant figures, because a third would claim precision a
> 0.35-wide interval does not support. The bare acceptance tour clears it with room: its own five
> sessions fold to **3.98 – 4.34**, ~20% above the `?art=off` arm the floor is derived from. The
> floor is taken on that sibling and not on the bare build because it is the arm the control differs
> from by exactly one seam.
>
> **Seven per arm rather than the five asked for, and the two extra were not a formality.** At n=5
> the control arm's three highest draws were its three most recent (2.9467 · 2.9058 · 2.9587), and a
> trend that would have walked through the floor is precisely what the retracted derivation was
> killed for not looking at. Passes 6 and 7 read 2.8762 and 2.8013: the trend was not there, and the
> shipped arm's minimum moved 3.3102 → 3.3062, so the interval is stable under the two draws that
> could have closed it.
>
> **The fold ranking was re-checked at the n the floor comes from, on arms it was never chosen
> from.** The board picked the mean off five *baseline* sessions; these are fourteen `?art=off` and
> `?art=off&bands=shuffle` tours, and the ranking holds — including the part that is a warning:
>
> | fold | `?art=off` spread | `+shuffle` spread |
> | --- | --- | --- |
> | min (retired) | 2.40× | **4.02×** (1.82× at n=5) |
> | p10 | 1.26× | 1.65× |
> | p25 | 1.16× | 1.29× |
> | median | 1.23× | 1.12× |
> | **mean (§3.1)** | **1.05×** | **1.06×** |
>
> The retired fold's control-arm spread more than doubled between n=5 and n=7. That is the same
> lesson that retired it — a fold's stability estimated at one n is not its stability — landing a
> second time, and it is the reason the mean has to be re-checked on every refresh rather than
> inherited.
>
> **Two things this floor does not claim.** First, **4.8% is thin**, and it is thin because of the
> control rather than the build: a permutation moves most worlds down and some up, and a mean dilutes
> it — 6 to 10 of the 28 worlds score *higher* shuffled, depending on the pass. Under the retired min
> fold the arms were further apart per world and still **overlapped** as aggregates; under the mean
> they sit closer together and **separate**, because both are now stable. Reproducibility is what
> bought the separation. Second, **the median would separate these arms by more** — 1.9713–2.4190
> against 1.3810–1.5529, a 1.27× gap where the mean's is 1.12× — at a spread of 1.23× against 1.05×.
> That is recorded as evidence for the next refresh, not as a re-litigation of the ruling.

> **Normative — the measure keys in this table are the keys the module emits.** `checkControlRow`
> resolves a row by `{criterion, measure}` and reports `W1 has no measure "…"` when the name is not
> one a criterion actually returned, so a typo here surfaces as a failing row with a confusing
> detail rather than as a silent pass — safe, but only once. The seven keys are
> `minMedianCellHeightPx`, `medianNeighbourDeltaE`, `lightnessIqr`, `minAdjacentBandDeltaE`,
> `artFraction`, `evictionsPerSecond`, `homeLabels`, `worldsNeverLabelled`. Two rows above named
> `medianCellHeightPx` and `worstBandPairDeltaE`, which no criterion emits; both are corrected.

> **On W5's control reading _higher_ than the build it is a control for.** Every other RED row in
> this table degrades a number downward, so a reviewer reads "control below baseline" as normal.
> This one goes the other way and it is not a regression. §1.3's worlds are **smaller spheres** than
> today's galaxy dots, and `layout.ts` anchors a label at `y + radiusPx + halfHeight + 6` — a
> smaller radius pulls each label _closer_ to the thing it names, fewer boxes collide, and **more**
> labels survive. Unsuppressed the sweep reads **66 – 77**; suppressed it reads **33 – 42**, so
> **moon suppression is the entire distance from RED to PASS**, not one contributor among several.
>
> **Two superseded digits, recorded so they are not re-carried.** DEC-751 first reported 77 visible
> labels under the worlds law, then retracted it to 72, then to 68 — the first substituted the
> radius law onto v2 positions, and leg P's build moves `home` too. All three are **interior points
> of the 65 – 77 band** the sweep measures, which is the whole reason this row asserts a worst case
> over a sweep and not a count at a frame. Do not re-pin any single number here.

> **Gap closed — W5's reachability half has a control row, and it needs nothing from R1
> (DEC-752).** This was a declared gap: the `labels forced on for empty planes` control _adds_ moon
> labels and cannot take a world label away, so it tested the ceiling and nothing else, and a
> coverage seam was routed to R1 as the only way out. It does not need one. The collision solver's
> pressure is set by the **viewport**, which the gate chooses — no renderer seam is involved, so
> DEC-744 B1 / DEC-746 D5's seam ownership does not bind here. Measured over 360 azimuths on
> `3ce85aed66e9dc3a`: at 1920×1080 every world is labelled at some azimuth, at 800×600
> `thunder-junction` is labelled at **none** (and `segovia` at 1.4%). That is a RED row with a
> non-binding GREEN partner differing in one harness parameter, aimed at the half the empty-planes
> row cannot reach. The **R1 control-seam request is withdrawn.** R3's separate `data-plane-slug`
> _readback_ ask is untouched and still required: the control decides what the renderer draws, but
> the gate still cannot tell _which_ world a label belongs to, and sweeping azimuths means resolving
> that identity once per sampled frame. See the seam contract, §2a.
>
> Note what the control does _not_ do: it does not starve the resource the solver adapts to, it
> raises the pressure the solver is solving against. A priority-flattening variant was measured too
> and leaves reachability at 0 never-labelled — it redistributes which worlds are weakest (`karsus`
> 20.3% → 47.2%, `vryn` 58% → 41%) without losing any — so reachability is carried by the rotation,
> not by `PlaneLabels.tsx:67`'s card-count priority tiering. A control that moved only the priority
> would have been a control for the wrong signal.

> **On the one-card-world row (DEC-752, raised by DEC-751).** It is an expected-**GREEN** row and it
> is not redundant with the last row: the whole-multiverse capture _averages over_ a degenerate
> world, and an aggregate that averages is precisely what cannot catch one. Pinning the row to a
> named one-card world makes the extreme a subject in its own right.
>
> It asserts the two criteria that are **defined** at n = 1 — W1's cell height and W4's art
> fraction — and asserts that W2 and W3 report `insufficientSamples` rather than either verdict.
> That second half is the one that matters: it is the guard against the precondition above being
> quietly widened later until it swallows real planes. A control that asserts an `n/a` is still a
> control, because the alternative readings (silently pass, silently skip) are both reachable and
> both wrong.
>
> **Normative — this row sweeps the world's own spin, and a single frame cannot score it (DEC-752,
> F3).** "Defined at n = 1" is true of the criteria and was false of the *frame*. A one-card world
> has exactly one cell and its normal is equatorial — all six store `(-1, 0, 0)` in `stars.bin` —
> so with `FACING_CUTOFF` at 0.12 it turns in and out of the facing cut once per `spinPeriodS`.
> Held live through the shipped probe, the cell is front-facing on **18 of 64 phases (28.1%) on
> `segovia`** over 260 s against its 175.8 s period, and **19 of 63 (30.2%) on `muraganda`** over
> its 246.6 s one. A row reading one instant therefore drew its verdict about seven times in ten
> red, which is how it behaved: it failed the `controls1` matrix and the cutover matrix alike, and
> would have passed on another draw. The width of the family, not the renderer, was the finding.
>
> The repair is the one W5 took two criteria over, and for the same reason: what is invariant under
> a rotation is **reachability**, never the instantaneous value. The gate's `sweepSpinPhase` samples
> a full period and `selectSpinPhases` (`lib/worlds-metrics.mjs`, moved out of the driver and
> unit-tested by DEC-861, one mutant per rule) scores the **worst counted phase** — never the first,
> and never the best, because a loop that stopped when the cell appeared would select on the
> statistic it then scores and green a floor by choosing its own sample. Three rules make that a
> measurement rather than a search, and a fourth says whose worst phase it is:
>
> 1. **A phase is scorable only if the previous phase was presenting too.** The leading edge of a
>    presenting run is mid cross-fade — `ART_SHOWN_AT` is the fade's *landing* — so `showingArt` is
>    false there by §1.6's design. Exactly one of segovia's 18 presenting phases read `wantsArt`
>    without `showingArt`, and it was the first sample of the run. Scoring it would red the row for
>    the renderer doing what it is specified to do; this is `W4_SETTLE_S`'s rule, not a new one.
> 2. **No presenting phase at all is a named failure (`never-presented`), not `N/A`.** A one-card
>    world whose only cell never faces the camera across a full turn has an unreachable card, and
>    that is the renderer defect this sweep was built to rule out. Filing it under the same word as
>    the domain rules would hide it.
> 3. **The sweep is refused unless the mosaic demonstrably turned.** A one-cell world has no
>    front-facing *set* whose turnover witnesses the rotation, so "never front-facing" and "the
>    scene never moved" are the same reading. The cell's own projected centre is the witness — it
>    travelled 680 px on segovia — and below `SPIN_SWEEP_MIN_TRAVEL_PX` the row reports a harness
>    fault rather than a verdict.
> 4. **Each criterion scores its own worst counted phase (DEC-861).** W1 reads the phase with the
>    lowest median height; **W4 reads the phase with the lowest `artFraction`**, not W1's. W1's
>    worst phase is the worst for *legibility* and says nothing about art — on segovia the two
>    readings are nearly flat, but a sweep whose one art-less counted phase was not W1's worst would
>    have scored W4 on a phase that showed art. Counted phases where nothing wants art carry no W4
>    reading and are stepped over; if none carries one, W4 is read on W1's phase and reports its own
>    `insufficient`. The pixel witness below takes its own worst phase the same way.
>
> The margin this buys is not marginal: at the worst *presenting* phase the cell measures **684.95
> px** against W1's 24 px floor, and the height varies by under 1 px across the whole family. The
> row was never close to failing W1 on the merits — it was failing on whether the frame contained
> the cell at all.
>
> **Normative — the row reads one pixel, and a control proves it can see a cell that is not drawn
> (DEC-861, from DEC-856).** At n = 1 the criteria that read pixels — W2 and W3 — are out of domain,
> so every measure this row scored was computed before a fragment was shaded: W1's height is a CPU
> projection and W4 is the art pool's account. The row went red on a world that stopped composing,
> turning, presenting or admitting art, and **stayed green on one that stopped drawing**. W1 now
> carries a second measure on a swept row, `centreContrastDeltaE`: the median ΔE76 from the cell's
> centre pixel to eight points just outside its screen rect, read off each counted phase's capture
> and scored at its own worst phase against `FLOORS.cellDrawnDeltaE`. It is W1's because a cell that
> is not drawn is not resolvable at any distance, and it rides only a swept visit, so W1 is still
> one measure everywhere else and `baseline`'s criterion-level `W1 GREEN` is unchanged.
>
> Its control is **`one-card-no-cell-draw`**: the same row with the `WorldCell` program's draw calls
> suppressed by an init script (`blankCellDrawScript`), a harness seam in the class of the
> reduced-motion row's media emulation — it perturbs what the GPU is asked to draw and nothing the
> row reads, so the payload still describes a healthy world. The row expects the witness **RED** and
> the height and art fraction **GREEN** on the same frame; the GREENs are the blind spot, stated as
> a live reading. It refuses to score a control that suppressed zero draws.
>
> The floor, **28**, is derived and not chosen: the geometric mean of the shipped arm's lowest
> scored reading and the control's highest, three draws each — shipped **58.36 / 58.11 / 58.25**,
> blanked **13.20 / 13.49 / 12.81**, so 2.08× either side (the control's read-backs: 18,571,
> 18,632 and 18,568 cell draw calls suppressed). The control's *best* counted phase reads 43.2–43.8, because the atmosphere shows
> through brighter towards the limb, and that is the reason the witness scores its worst phase: the
> control could green only if every counted phase sat above 28. The floor belongs to segovia's card
> art, so a refresh that changes that card expires it, and it asks whether the cell is drawn at all,
> not whether it is drawn right. The table is in `FLOORS.cellDrawnDeltaE`.
>
> **This row does not assert that its world carries a label**, and that is deliberate. DEC-751
> measured the six one-card worlds across azimuth: `muraganda` is labelled at 10 of 24, `shandalar`
> at 11 of 24, `segovia` at 17 of 24, because `PlaneLabels.tsx:67` sets `priority: plane.cardCount`
> and a one-card world is the lowest priority tier there is. An expected-GREEN row that asserted a
> label on a named one-card world would be red at roughly half the azimuths the harness might grab
> — the same defect as the coverage floor, in a row whose job is to be reliably green.
>
> The row was also the surface law's extreme, and that half is **resolved**: §1.3 now apportions by
> largest-remainder floored at 1 rather than rounding, so N = 1 returns one row of one cell and the
> sweep 1..7000 is exact at every N (DEC-749 `55d3b15`). The earlier reading here — 1→2 cells,
> half-extents 1.571 × 1.571, aspect 1.000 — was `closed_form()`, which R1's head renamed and
> demoted to the reference implementation; `grid()` is now the exact-N relaxation. Reproduce with
> `surface-law-check.py`'s `grid()`, not `closed_form()`.

> **Normative — what `?bands=shuffle` permutes, because three of the four readings pass
> (DEC-749, on DEC-752's finding).** The seam applies **one global permutation of the plane's cards
> across the plane's cells**. The grid, the row latitudes, the band boundaries and each cell's
> **reported `band`** are untouched; only which card — and therefore which swatch — sits in a cell
> moves. W3 then groups by a band index that still means its geometric band, every band holds a
> random draw from the whole plane, every band's mean a\*b\* converges on the plane's mean, and the
> pairwise ΔE collapses. That is the criterion failing for the reason W3 exists: latitude has
> stopped predicting colour.
>
> "Band assignment is permuted" — the wording this note replaces — admits three other readings, and
> **each one goes GREEN**:
>
> 1. **Permute the reported `band` alongside the card.** Every band is still internally uniform,
>    merely relabelled; every adjacent-pair ΔE stays large.
> 2. **Permute the band → colour-class map** (the north cap becomes red, and so on). Each band is
>    still one class, so adjacent bands are still different classes and still far apart in a\*b\*.
> 3. **Permute within each band.** The band's contents are unchanged as a set; its mean is
>    unchanged exactly.
>
> All three leave the mosaic band-structured and the criterion passing, which is the failure mode
> §3.1's whole matrix exists to prevent — a control that silently no-ops reads as a passing gate.
> The distinguishing test is cheap and belongs in R1's unit test for the seam: **under the seam,
> the multiset of swatches within any single band must change.** Under all three wrong readings it
> is invariant.
>
> On a small plane the collapse is noisy — Rabiah's 5%-share bands hold ~4 cells, so a pair's ΔE can
> clear 10 by chance. This does not threaten the control: W3 is "≥ 10 for **every** such pair", so
> one collapsed pair anywhere is RED, and on a plane the size of Dominaria (≥ 313 cells per
> qualifying band) every pair collapses. The matrix asserts the control on `worstBandPairDeltaE`,
> which is the pair that collapses hardest.

**On W4's control specifically.** `fixed24` is the control because it is the configuration the
prototype actually measured failing: at `tether-surface`, 1,024 drawn against 2,759 wanted is **37%
showing art** against W4's 90% floor, and the pose was reached by evicting 925 layers with no sign
of settling — both halves of W4 go red, and they go red for the reason W4 exists.

Shrinking the pool is **not** a control here, and the near-miss is worth writing down because it is
the shape of mistake that survives review. `?layers=128` reads like "pool pinned below demand", but
§1.6 defines demand _relative to pool capacity_: with 128 layers the effective threshold simply
rises until ~128 cells want art, ~128 resolve, and steady-state eviction goes to ~0. W4 measures the
fraction above the _effective_ threshold that resolved — ≈100% — and evictions/s — ≈0. The row
passes. **Starving the resource a policy adapts to makes the criterion green; only starving the
policy makes it red.** Worse, 128 layers is **§1.12's tier-4 allocation**, the configuration the
ladder exists to protect: a row that went red there would be condemning the exact low-end device.
So `?layers=128` stays in the matrix — as an **expected-GREEN** row asserting that a tier-4-sized
pool still passes W4.

> **Normative — this paragraph was right about the mechanism and wrong about the numbers, and board
> ruling `bd5c9aad` turned the mechanism into a domain rule (DEC-834, measured).** Measured in the
> shipped composition, `?layers=128` does **not** read ≈100% and ≈0/s. It reads **6.73 evictions/s**
> and `artFraction` **~0.617**, with ~4,670 wants/s refused for exhaustion. The threshold does rise
> and demand does fall, exactly as above — but not far enough to stop the churn, and far enough to
> cost the picture a third of its art.
>
> The conclusion the paragraph draws survives and is now enforced rather than argued: **starving the
> resource a policy adapts to makes the eviction number look good and the picture worse.** So the
> eviction half is scored at the 1,024-layer pool alone and this row asserts **N/A** on it, while
> keeping its expected-GREEN on `artFraction` and on the absolute `artCellsShowing` term. See the
> eviction amendment in §3.1.
>
> **The composed row `?artThreshold=fixed24&layers=128` is the one that restores what this appendix
> captured.** Appendix A's `tether-surface` was never "a fixed threshold"; it was **a fixed threshold
> against a pool too small for it**. Composing the two seams keeps dominaria's full ~945-cell want
> set against 128 layers — a 7.39× overshoot against `tether-surface`'s 2.69× — and `artFraction`
> reads **0.1342 against a bar of 0.5**. The **bare** `?artThreshold=fixed24` row is retired (ask
> `f9e273fb`, answer `replace_row`): on the shipped tree the adaptive quantile at a 1,024-layer pool
> already sits *at* the 24 px floor, so forcing 24 px moves nothing, and the byte budget is
> capacity-derived at 155 MB against ~95 MB outstanding, so nothing starves. The seam engages, reads
> its policy back, and moves no pixel.

> **Normative — name that row by its capacity, never by its tier (DEC-752, measured on main
> `f049dca`).** §1.12's rung is not implemented: `setArtLayers` (`attachWorlds.ts:135`, implemented
> at `:356`) has **zero callers** in `web/src`, `web/test` or `web/e2e`, and `tierArtLayers` is
> never passed, so the pool is always `DEFAULT_TIER_ART_LAYERS` = 1,024. Measured through
> `?quality=N` on dominaria at 1920×1080: tiers 0, 2, 3 and 4 **all report `pool.layers` = 1024**,
> where §1.12's table says 1,024 / 512 / 256 / 128. **No tier yields 128 layers today**; 128 is
> reachable only through `?layers=128`, which is R1's seam and does work. A row — or a DEC-770
> note N1 bar — written as "quality tier 4" therefore runs at 1,024 layers and measures nothing.
> Attach the bar to the **capacity**, which is the quantity §1.6's quantile is relative to anyway.
> Implementing the rung is R3's row (§1.10–§1.12), relayed on DEC-751; it is what would make the
> two spellings agree.

> **The effective threshold moves with capacity — live readings, and a one-bucket gap that is the
> gate's own problem to close (DEC-752, main `f049dca`, dominaria, 1920×1080).** Off the live
> renderer, `pool.layers` 1,024 → **24.00 px** (the `BASE_THRESHOLD_PX` floor), 128 → **27.93 px**,
> 0 → **30.13 px**.
>
> **Re-taken at DEC-882 off the worlds gate at the driven 2.2-radii pose**, which is the pose the
> discrepancy below asks for: 1,024 → **24.00 px** on both trees, unchanged and still the floor; 128
> → **37.82 px** on `a0eec54` and **37.11 px** at 256 buckets. The 128-layer reading is no longer
> one bucket *below* the offline sweep — it is well above it, because the arrival pose moved at PR
> #85 and cells at 2.2 radii are taller than the 2.14 the gate used to settle at. The offline rig
> and the driven gate are two instruments and both reproduce on `a0eec54`; quote each with its own.
>
> §1.6's note above gives dominaria **30.13 px at 16, 64 and 128 layers alike** at this same
> 2.2-radii pose, so the live 128-layer reading sits **one bucket low**. The likely cause is not a
> renderer disagreement but the gate's own camera: `focusPlane('dominaria')` settles at
> **`radii` ≈ 2.14**, not 2.2, and ~3% nearer makes every cell ~3% taller, which is enough to cross
> one bucket edge. **The driver must therefore drive the camera to the specified pose and assert
> `worlds().radii` before reading any threshold-dependent number, rather than accepting wherever
> `focusPlane` settles** — a criterion specified "at 2.2 radii" that is in fact measured at 2.14 is
> a number taken at a pose the spec does not name. Recorded as a discrepancy to close by
> re-measuring at a pinned pose, **not** as a defect in either figure: the offline sweep and this
> reading have not yet been taken at the same distance.

> **Normative — W4 is unmeasurable until the art stream is connected, and the matrix must not be
> read as passing before then (DEC-752 → DEC-772).** On main the worlds art stream is never asked:
> `renderer/sceneHost.ts:207` calls `attachWorlds` with no `cardOf`, so `worldSource.ts:149`
> defaults it to `() => null` and `worldSurface.ts:407-412`'s `stream.request(...)` is unreachable
> for every cell on every world. Measured at 2.2 radii after a 20 s settle: **`showingArt` false for
> all cells, `pool.resident` 0, artFraction 0.0%, and zero requests to the image origin** under
> `?probe=shell`, `?layers=128` and `?artThreshold=fixed24` alike — with the image queue reading
> `inFlight 0, waiting 0, completed 0, failed 0` and the network demonstrably reachable. A local
> positive control supplying one constant printing (reverted) takes the same three rows to 15.0% /
> **73.0%** / 13.8% with `resident` 686 / 128 / 686, so the pool, the LRU, the threshold, the
> cross-fade and the eviction counter are all correct — only the printing lookup is absent.
>
> The consequence is the one this section exists to forbid, in its mirror form: **both W4 rows are
> inert.** The `fixed24` expected-RED row is red for the wrong cause, and the `?layers=128`
> expected-GREEN row cannot go green, so neither falsifies anything. Per the rule below — only the
> green rows can falsify the instrument — a W4 verdict taken before DEC-772 lands is not a
> measurement. Score W4 `insufficient`, not `fail`, until `worlds()` reports art on the shipped path.
>
> No unit suite caught this: every `WorldSurface` test supplies `cardOf` directly, so the suite
> exercises the stream fully while the composition's call site is covered by nothing. The fix's
> acceptance must include a test that goes red when the *composition* stops supplying it.

> **The four control seams are verified live and leg G is routing nothing against them (DEC-752,
> main `f049dca`).** Read back off `worlds().seams` at 1920×1080 on dominaria: `?swatch=mean` →
> `swatchMean`, `?bands=shuffle` → `bandsShuffle`, `?artThreshold=fixed24` → `artThresholdFixed24`
> (with `effectiveThresholdPx` pinned to exactly 24), and `?layers=N` → `layersRequested` with
> `pool.layers` actually moving 1024 → 128 → 0. `?probe=` returns a full payload — 6,271 cells on
> dominaria, 13 band shares, per-cell `shade`, `frontFacing`, `onScreen`, `wantsArt`, `showingArt`.
> R1's seam surface (DEC-744 B1 / DEC-746 D5) is complete as specified.

The same relative definition has a second consequence, this one for the gate's own *readings* rather
than its rows, and §1.6 states it normatively: **how much of W4's subject is even reachable is a
function of the pool capacity the measurement runs at.** The set that separates demand from
visibility, `wantsArt && !frontFacing`, is non-empty on 30 of 45 worlds at 64 layers and on 45 of 45
at 1,024 — and 64 layers is below tier 4. A number taken at a capacity the renderer never ships is
a reading of the harness. Report `pool.layers` alongside any such count.

The green rows are the ones that matter most and the ones most often left out: in a matrix where
everything is red, a broken baseline scores identically to a perfect guard. **Only the rows expected
to stay green can falsify the instrument.**

> **How many of each there are is reported by the gate, not stated here (DEC-752).** This sentence
> said "the two green rows" and §3.2 said "four" while the shipped matrix had six; the count has gone
> stale every time a row was added, because prose is not attached to the row list. `worlds-gate.mjs`
> now prints a `matrix census` line — counted over the whole of `MATRIX` and not over the subset a
> `--only` run scores — and writes it to `summary.json`. Read the pair off a run.

The gate runs at 1920×1080 CSS, dpr 1 — true CSS scale, never an upscaled crop (DEC-683), and the
native resolution of the Iris Xe laptop review §9 targets, so a Windows re-capture is directly
comparable. It is added to `docs/refresh-runbook.md` as the per-refresh instrument in the same place
`visual-gate.mjs` occupies today.

### 3.2 When the galaxy retires

The galaxy ships until **all four** of these hold:

1. `worlds-gate.mjs` passes W1–W5 on the v3 production dataset, with every row of the
   negative-control matrix landing on the colour it expects — which the gate checks itself, and
   whose tally it prints as its `matrix census` line (§3.1);

   > **This condition no longer carries the counts, because they went stale twice (DEC-752).** It
   > read "five red and two green", written when the matrix had seven rows; that was corrected to
   > "four green" for `?layers=128` and the one-card world, and was stale again on arrival — DEC-821
   > had added the `?art=off` sibling rows, making six. It then went stale a third time, as "five
   > expected-RED, six expected-GREEN, two derivation rows", once the mean fold and the `MIXED` and
   > `N/A-only` buckets landed. What the gate printed on `de677cc` (DEC-856's matrix draw), quoted
   > rather than counted:
   >
   > ```
   > matrix census: 4 expected-RED rows, 7 expected-GREEN, 1 N/A-only, 2 of them derivation tours (excluded from --negative-controls), 3 MIXED — 13 of 15 scored this run
   > ```
   >
   > Read it off a run rather than off this block: a number in prose cannot testify that it still
   > describes the matrix.
   >
   > Nothing is lost by dropping the pair from the condition. The gate already fails a row that lands
   > on the wrong colour, so "shows the expected five and four" was never the thing being checked —
   > `GATE: GREEN` is.
   >
   > **§3.1's table lists one control the matrix does not carry.** It is `labels forced on for
   > empty planes`, the control for `homeLabels`, and `worlds-gate.mjs` does **not** run it: forcing labels on for suppressed planes is a renderer
   > behaviour and `web/src/scene/worlds/seams.ts` ships exactly five seams that perturb the build —
   > `?swatch=mean`, `?bands=shuffle`, `?art=off`, `?artThreshold=fixed24`, `?layers=N` (`?probe=` is
   > the sixth entry in that file's table, and it reports rather than perturbs). None of them reaches
   > §1.8's suppression, and leg G may not add one (DEC-744 B1 / DEC-746 D5). The 66–77 unsuppressed
   > reading that makes the row red was taken offline, through the shipped `layout.ts` and
   > `project.ts` against the pre-§1.8 candidate list — evidence that the measure *can* fail, but
   > not a row the gate can run against a shipped build.
   >
   > So `homeLabels` ships **measured and scored, with no live falsifier**. It is a suppression
   > regression check whose control is historical, which is weaker than every other row here and is
   > recorded as such rather than counted as though the gate exercised it. Routed to the CEO for a
   > ruling on whether §1.8 is owed a seam; it does not block the matrix's other expectations.
   >
   > **A GREEN W3 row does not clear this condition, and today it cannot (DEC-752, routed from
   > DEC-830).** `minAdjacentBandDeltaE` folds to a minimum of minima over the in-domain worlds, and
   > on one unchanged dataset at one pose it draws **0.4253 – 0.8005** with `FLOORS.bandDeltaE` at
   > **0.55** inside that span — so whether the row prints GREEN is settled by the draw, and the
   > shipped arm's lowest reading sits *below* the composed control's highest. The §3.1 retraction
   > block carries the seven-run table and the reason. Condition 1 therefore reads: `GATE: GREEN`
   > **plus** a W3 floor that separates the shipped arm from `?art=off&bands=shuffle` across
   > sessions, not at one. Until the owner rules on §3.1's fold, **a green W3 is evidence of a lucky
   > tour and nothing else** — re-running until one appears would be the failure this condition
   > exists to prevent.
   >
   > **Settled (board ruling `fold_mean`, 2026-09-17; DEC-836).** The fold is the mean, the floor is
   > re-derived on it over five sessions per arm, and the note above is history. What condition 1
   > requires of W3 now is **three** things, and a `GATE: GREEN` on its own is still not one of them:
   >
   > 1. the acceptance tour's W3 row GREEN **with `scoredPlanes` equal to the recorded domain size**
   >    — the gate reds a short denominator by itself, but the number is what a reader checks;
   > 2. the derivation pair run and separating — `w3-floor-shipped` GREEN and `w3-floor-control` RED
   >    on the same tree, since `--negative-controls` no longer carries a W3 falsifier;
   > 3. the floor re-derived on **the shipped swatches under test**. It is a property of the data, so
   >    a refresh can invalidate it with no rendering change (§4.3 of the runbook).
2. the owner accepts the judged criteria of §3.1 on the capture set;
3. the W0.1 Windows field reports confirm concept B's cost class on the Iris Xe and the 780M — or the
   owner explicitly waives the hardware gate. This is the outstanding item the W2.3 record names, and
   concept B's "A far / B near" is still an estimate from a Mac;

   > **Met by waiver (board ruling `hardware_gate` = `waive`, interaction `6d9da980`, DEC-752).**
   > The board took the second branch, and the record is `docs/decisions/w23-concept-and-stack.md`.
   > **A waiver is a decision to ship without the evidence, not evidence**: no Iris Xe or 780M has
   > run the worlds build, "A far / B near" is still the Mac estimate, and the field reports are
   > still owed. Do not cite this condition as confirming the cost class.
4. the worlds build reaches feature parity on the shipped surfaces: search, filters, deep links,
   plane index, card focus, printing ring, attract mode, reduced motion, a11y.

Until then the two coexisted at zero cost, on two dataset directories (§2), and dataset refreshes
ran `visual-gate.mjs`. Since the cutover (DEC-752) that script is archived under `galaxy-cutover`
and every refresh runs `worlds-gate.mjs` per `docs/refresh-runbook.md` §4.3.

At cutover, in one PR: `datasets.json`'s `active` moves to the v3 directory; the galaxy scene, the
spiral laws, the star shaders, the thumbnail atlas and the card-sheet tier are deleted; PRD §5 and §9
are amended (§6); and the v2 dataset directories are removed from `web/public/data/`.

#### 3.2.1 Which dataset the gate may measure, and why `active` is not it

Three facts about the shipped `datasets.json` roles, measured on the bytes at `613715f`. They are
constraints on *this runbook*, not defects in any leg.

**Only the `worlds`/`production` directory can build a surface.** `swatches.bin` exists in exactly one
of the four published datasets:

| role | directory | contract | `swatches.bin` | planes with `rowCells` |
| --- | --- | --- | --- | --- |
| `production`, `worlds` | `c9468f1125bcddff` | 3 | **yes** (228,840 B) | 45 |
| `fixtures.scale` | `f6f712c6e70a6a51` | 3 | no | 80 |
| `fixtures.small` | `2e6f120ee85a5b23` | 3 | no | 3 |
| `active` | `dabe2c9a68b4d799` | 2 | no | 0 |

Both v3 fixtures declare contract v3 and carry `rowCells`, but neither carries `swatches.bin`. **A gate
row written against a fixture therefore cannot construct a `WorldSurfaceSource` at all, and the failure
surfaces inside R1's loader — it will read as an R1 defect when it is a missing fixture artefact.** Gate
rows that build a surface bind to the `worlds` role only. Fixture-backed rows are limited to assertions
that need `planes.json` alone. Raised to leg P on DEC-749.

**`active` is contract v2 and cannot serve the worlds path** — 0 of its 88 planes carry `rowCells`. So
"the deployed app" and "the dataset the gate measures" are different *contracts*. They are **not**
different rosters: the world set is identical across the two — the same 45 ids (29 spiral + 16
irregular), matching on `kind` and `cardCount` for all 45, with zero ids on either side alone. The only
per-plane difference is `rowCells`, which v3 adds. Stating this precisely matters because a "different
roster" reading would imply the gate measures a different population than the app ships, and it does
not.

**The cutover's `active` move must stay atomic with the galaxy deletion, because splitting it fails
silently.** v3 also *drops* six v2-only fields (`shearAmplitude`/`PeriodS`/`Phase`, `armPitch`,
`discThickness`, `bar` — §2.4 retires them with the spiral disc). Of those, three have live readers
today: `camera/motion.ts:229-234` and `scene/starfield/planeTable.ts:149-152`, and **every one of them
reads through `?? 0`**. `READABLE_CONTRACT_VERSIONS` is `{2, 3}` by design for the dual-scene period, so
a v3 `planes.json` clears `assertContractVersion` unchanged. Repointing `active` at the v3 directory
*before* the galaxy is deleted therefore does not throw and does not warn — the spiral shear flattens to
zero and the galaxy keeps rendering, wrong. There is no instrument in the gate that would catch it,
because at that point the gate is measuring worlds. `armPitch`, `discThickness` and `bar` are already
declared-but-unread outside `data/types.ts`, so only the shear triple carries this risk.

> **Runbook rule.** Never repoint `active` to test the worlds path — use the `worlds` role, which
> already points at the v3 directory. `active` moves exactly once, in the cutover PR, in the same commit
> that deletes the galaxy scene.

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

> **Landed (DEC-752).** `galaxy-cutover` tags `107fdf8` — leg G at main `c91666c`, the last commit
> with the galaxy scene and `visual-gate.mjs` both in the tree — and the cutover commit deletes both.
>
> **The tag is the retrieval point for the files, not a tree on which the archived gate passes
> (DEC-861, from DEC-856).** Leg G moved the card-sheet tier out before the cutover
> (`split_cardtier`): at `107fdf8`, `visual-gate.mjs` and `scene/starScene.ts` are present and
> `scene/cards/cardTier.ts` and `thumbnailTier.ts` are not. `visual-gate.mjs`'s criterion 6 — the
> star → thumbnail cross-fade, PRD 5.5.1 — reads `state.thumbnails.*`, which on that tree has no
> tier behind it, so the criterion cannot pass there. **The last coherent galaxy-plus-gate pair is
> main `c91666c`** (an ancestor of the tag), where all four files exist. Check out `c91666c` to re-run
> the galaxy's gate; check out `galaxy-cutover` to read the scripts as they stood when they were
> deleted.
> What it had to *move* first, because the module graph named for the galaxy was also hosting the
> worlds build, is recorded in `docs/worlds/cutover-inventory.md`: the printing ring's host
> (`split_cardtier`, `cards/focusedCardHost.ts`), the input layer and the star data layer (DEC-852),
> and the plane table's clock, the quality monitor, the focused-star mirror and the sky
> (`scene/sceneFrame.ts`). Deleted with the field and not moved, because their subject went with
> it: the GPU self-check (`?selfcheck=1`) and the star field's sprite clamp. `?probe=`'s
> `quality.glowShader` now reads the worlds rim (§1.12 row 4, wired in the same leg — the rim's knob
> had never been connected to the ladder), `quality.motion` reads the frame's clock, and
> `platform.starMaxPixels` stays at a structural `-1`.

---

## 4. Sequencing and staffing

Five legs, ≈ **18 engineer-days**. The critical path is R1 → R2/R3 → G; leg P is entirely off it.

| Leg                           | Content                                                                                                                                                                                                                                                                                            | Days  | Starts                                               | Role                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------- | ---------------------------------------- |
| **P — pipeline and contract** | §2 in full: contract v3, `swatches.bin`, `artist`, the surface law in Python, the swatch fetch stage, invariants, report lines, a published v3 dataset                                                                                                                                             | **4** | **now — no renderer dependency at all**              | pipeline/data engineer                   |
| **R1 — renderer core**        | §1.3–§1.6: surface law on the client, the cell sheet, the equirect bake and LOD crossover, the art pool with the three-state LRU and the adaptive threshold — **including the `?probe=`, `?swatch=mean`, `?bands=shuffle`, `?artThreshold=fixed24`, `?layers=N` and `?art=off` (DEC-821) seams §3.1's gate is built on** | **5** | on W4.2's merge                                      | graphics engineer (prototype author)     |
| **R2 — system, belt, tether** | §1.7–§1.9: undetailed worlds, dark moons, the belt, the atmosphere rim, the surface-following tether                                                                                                                                                                                               | **3** | on R1's merge                                        | graphics engineer                        |
| **R3 — product surfaces**     | §1.10–§1.12: the flat printing ring, picking, labels, filters, GPU budget and the ladder rungs, feature parity                                                                                                                                                                                     | **3** | on R1's merge, parallel with R2                      | frontend engineer                        |
| **G — gate and cutover**      | §3: `worlds-gate.mjs`, the negative-control matrix, runbook and PRD amendments, the archival tag                                                                                                                                                                                                   | **3** | on R1's merge (needs the probe seam), lands after R3 | the engineer who built `visual-gate.mjs` |

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
card, so a 2×2 of it is dominated by frame and border colour — which _is_ the colour identity, which
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
that number at 669; 669 is the count of cards with more than _nine_ printings, and the two questions
have different answers. If you have already answered against the old number, please re-read against
this one.) The remainder is not lost today: the card panel already lists every printing (§1.10). The
only thing the scene hides is _which_ printings the ring dropped, and §1.10 fixes that with 1 px
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

| PRD            | Today                                                 | Under worlds                                                                                                      |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 5.1.1          | "photoreal space, not data visualisation"             | still satisfied — worlds are objects in space — but the surface _is_ an encoding and the wording should say so    |
| 5.3.4          | the Blind Eternities as dust                          | a belt, one arc per set (§1.8)                                                                                    |
| 5.3.6          | plane kinds `dust` / `spiral` / `irregular` / `empty` | `spiral` and `irregular` collapse into one `world` kind; `empty` becomes `moon`                                   |
| 5.3.8          | every plane is labelled                               | the empty planes are unlabelled until hover — 57 of 87 on today's roster, **42 of 88** on v3 (§1.8, criterion W5) |
| 5.4.2          | chronology bands map to radius                        | chronology maps to longitude (§1.3)                                                                               |
| 5.4.8 / 5.4.10 | hue class, brightness percentile                      | superseded by the art swatch (§2.2); `brightness` goes unread                                                     |
| 5.4.13         | shear                                                 | retired with the disc (§2.4)                                                                                      |
| 5.5.1          | the thumbnail cross-fade band                         | replaced by the swatch→art threshold (§1.6)                                                                       |
| 5.6.7–5.6.8    | printings as 72 orbiting spheres                      | a flat ring (§1.10)                                                                                               |
| 8.6.1–8.6.2    | seeded spiral parameters                              | retired (§2.4)                                                                                                    |
| 5.3.1 / 8.6.1  | the disc has thickness; planes scatter through ±0.075 R | plane *homes* sit flat in the disc plane, and `place_planes` also separates pick proxies in the home view (§1.11, DEC-759); the cards and the belt keep their thickness |
| 8.5.8 / 8.5.10 | the 128×178 thumbnail atlas, 256 px planet textures   | replaced by the 128×96 art array (§1.6, §1.12)                                                                    |
| 9.3            | seven checkpoints, criterion 2 on spiral arms         | the checkpoints and criteria of §3.1                                                                              |

---

## Appendix A — the prototype's measured numbers

From `captures.json`, production dataset `6d4779695fde33ea`, 1920×1080 CSS, dpr 1, art threshold
24 px, pool 1,024 layers, on an Apple Silicon Mac. **Not a Windows measurement.**

| View                   | Camera distance | In radii | Cell height | Art resident | Evicted | Drawn / wanted |
| ---------------------- | --------------- | -------- | ----------- | ------------ | ------- | -------------- |
| `system`               | 362.85          | 36.4     | 1.4 px      | 0            | 0       | 0 / 0          |
| `dominaria-far`        | 59.84           | 6.0      | 10.1 px     | 0            | 0       | 0 / 0          |
| `dominaria-frame`      | 29.92           | 3.0      | 25.3 px     | 333          | 0       | 333 / 333      |
| `dominaria-terminator` | 20.95           | 2.1      | 46.0 px     | 1,024        | 479     | 1,024 / 2,759  |
| `tether-surface`       | 21.94           | 2.2      | 42.1 px     | 1,024        | 925     | 1,024 / 2,759  |
| `dominaria-near`       | 13.17           | 1.32     | 158.0 px    | 1,024        | 63      | 1,024 / 1,766  |
| `rabiah`               | 3.71            | 3.4      | 189.6 px    | 1,024        | 514     | 35 / 35        |
| `rabiah-near`          | 1.64            | 1.5      | 910.1 px    | 1,024        | 515     | 33 / 33        |

Radii: Dominaria 9.97 (6,266 cells), Rabiah 1.09 (75 cells) — a 9.1× ratio where the shipped `log N`
law gives **1.568×** for that same pair (§1.3; review §4.1's 1.3× is Dominaria against Mercadia).
Cells cross the 24 px art threshold at ≈ 3× radius, which is about where a world fills the frame, so
the all-swatch state exists only _further out_ than framing distance. System: 27 undetailed worlds,
57 moons, 4,980 belt points — **27 because the prototype drew Dominaria and Rabiah in detail and had
no equirect rung; production's home view has 29 worlds (45 on v3) and no cell sheets at all** (§1.2).
The prototype's 57 moons and 4,980 belt points are likewise the roster it was built on: v3 has 42
moons, and the belt's population moves with the curation refresh (DEC-745).

The `drawn / wanted` column is the case for §1.6's adaptive threshold, and `tether-surface`'s 925
evictions — the one row above 900, the next being `rabiah-near` at 515 — are the case for criterion
W4. Note that this column is a **cumulative** counter, not a rate: W4's second half is specified as
evictions per second **on a fill-excluded tail** (§3.1, board ruling `bd5c9aad`), which is a
measurement the gate takes and not one this table can be read off. The 925 is in fact a *worked
example* of why: it is every eviction since the camera started moving, so most of it is the pool
filling, and the same 925 on a settled pool is 0/s.

Frames: branch `dec694-worlds-prototype` at `8c5fa25`, tag `worlds-prototype-dec694`, under
`review/dec694-worlds/`. They are not copied onto `main`: review §6.6 already counts 31 MB of review
PNGs in history as a repo-hygiene problem, and the tag makes them retrievable without adding 11 MB
more.

## Appendix B — what the prototype faked, and what replaces each fake

| #   | Fake                                                                                        | Replacement                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | The swatch — hue-class colour plus per-card hash noise                                      | `swatches.bin`, §2.2. **The one that matters**; everything the W2.3 captures show about colour is provisional until it lands |
| 2   | The set index, reconstructed as "the earliest of the plane's sets the card was printed in"  | baked by the pipeline, §2.1 — the position _is_ the answer, so the reconstruction disappears                                 |
| 3   | Mirrored bands as a refinement of review §4.2's sketch                                      | promoted to the normative surface law, §1.3                                                                                  |
| 4   | Three-pass assignment leaving 894 non-exact cells on Dominaria                              | per-row grid relaxation, zero displaced, pipeline-enforced, §1.3 / §2.1                                                      |
| 5   | Camera-relative key light                                                                   | kept, promoted to a product decision, §1.7 and Q6                                                                            |
| 6   | The art pool exhausting mid-frame                                                           | the adaptive threshold, §1.6, measured by W4                                                                                 |
| 7   | Undetailed worlds contrast-stretched ×3.2                                                   | kept as normative, §1.8                                                                                                      |
| 8   | No production wiring — no shell, store, filters, search, labels, picking, ladder, printings | legs R3 and G, §4                                                                                                            |
| 9   | Not measured on Windows                                                                     | W0.1 field reports, §3.2 condition 3                                                                                         |
