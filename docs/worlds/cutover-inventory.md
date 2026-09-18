# The cutover's file-level inventory (leg G, DEC-752)

Spec §3.2 names what the cutover PR deletes — "the galaxy scene, the spiral laws, the star shaders,
the thumbnail atlas and the card-sheet tier" — and §3.3 names four scripts to archive under
`galaxy-cutover`. Both are lists of **concepts**. This file is the same list at **file** level,
measured on the composed cutover head `3824f78` (leg G + `main` `eef5c9c`), because four of those
modules have live consumers on the worlds path and a directory-level delete takes working code with
it.

Nothing here changes what §3.2 requires. It exists so the cutover PR is mechanical rather than a
discovery process, and so the first `tsc` after the delete is a confirmation rather than a surprise.

> **Re-derive before you cut.** Every table below is `grep -rl "/<module>'"` over `web/src` at one
> commit. A module that gains a worlds-side importer after this was written will not announce
> itself — the commands are given so the inventory can be re-taken rather than trusted.

## 1. Four modules the worlds path imports out of galaxy-side directories

| module | symbol the worlds path needs | importers |
| --- | --- | --- |
| `scene/starfield/shaders.ts` | **`glslFloat`** | `worlds/cellShaders.ts`, `beltShaders.ts`, `tetherShaders.ts`, `systemShaders.ts`, `atmosphereShaders.ts` |
| `scene/starfield/motion.ts` | **`curlNoise`** | `camera/motion.ts` — the plane drift every world's position goes through |
| `scene/starfield/starGeometry.ts` | types **`PositionMode`**, **`StarGeometry`** | `scene/platform/capabilities.ts`, `app/filterMask.ts` |
| `scene/cards/imageQueue.ts` | the fetch queue itself | `worlds/attachWorlds.ts`, `worlds/artStream.ts` |

The first three are **fragments of modules that otherwise go**: `shaders.ts` is the star and glow
shaders around a six-line GLSL number formatter; `motion.ts` is the spiral's own motion around the
drift noise; `starGeometry.ts` is the star buffer around two type declarations. So the cut is
"move the surviving symbol, then delete the file", not "delete the file".

`imageQueue.ts` is not a fragment — it is the art fetch queue §1.6 runs on, and it lives under
`cards/` only because that is where the thumbnail tier used to need it. It **stays**.

Two of these are type-only imports (`PositionMode`, `StarGeometry`), so they erase at runtime and a
deletion fails at `tsc` rather than in the browser. That is the good case; note it anyway, because a
green dev server is not evidence here.

## 2. `scene/cards/` is mixed, and half of it is a shipped worlds surface

§1.10's flat printing ring lives in this directory, next to the thumbnail tier the cutover deletes.
A directory-level delete takes the ring, and the ring is one of §3.2 condition 4's nine surfaces.

| stays | goes |
| --- | --- |
| `focusedCard.ts` (§1.10's ring + the focused card), `planets.ts`, `roundedRect.ts`, `cardShaders.ts`, `imageQueue.ts`, `pickCard.ts`, `gpuMemory.ts` | `atlas.ts`, `thumbnailTier.ts`, `thumbnailSelector.ts`, `cardTier.ts` |

`cardShaders.ts` has importers on both sides (`focusedCard.ts` and `thumbnailTier.ts`), so it stays
and loses whatever only the thumbnail tier used.

**`planets.ts` is the trap in that table, and its own header is what sets it.** The header says
"PRD 5.6.7-9: a card's printings, as planets orbiting it" — the presentation §6 **amends away** in
this very PR ("printings as 72 orbiting spheres" → "a flat ring (§1.10)"), so read cold it looks
like galaxy-era code to delete. It is not: §1.10's ring **reuses its arithmetic**.
`focusedCard.ts:78` imports `planetLayout` and `planetPosition`, and `:834` says so in as many
words — "PRD 5.6.7's orbiting printing, as §1.10's flat quad". The ring-per-24 layout, the 72 cap
and the overflow count are all still that module's. **Cut by header text and the flat ring loses its
layout.**

## 3. Shared files the delete **edits** rather than removes

Each of these imports something on the "goes" list while also being on the worlds path, so the
cutover PR touches them:

- `scene/renderer/sceneHost.ts` — imports `cards/cardTier`, and is the host that attaches worlds
- `scene/probeSeam.ts`, `scene/benchSeam.ts`, `scene/SceneReadout.tsx` — `cards/gpuMemory`, `cards/pickCard`
- `scene/picking/scenePicker.ts` — `cards/focusedCard`, `starfield/planeTable`
- `scene/platform/capabilities.ts`, `app/filterMask.ts` — `starfield/starGeometry` (types, §1)
- **`scene/useSceneData.ts` — `starfield/starGeometry`, and this one is a VALUE import.** Added on a
  re-take of this table by import edge rather than by symbol name (DEC-752). It was missed because
  the first pass looked for `PositionMode`/`StarGeometry` as bare names and this file is the only
  consumer that also pulls the **class and a function**:
  `import { StarGeometry, resolvePositionMode, type PositionMode }`. Every other surviving consumer
  — `capabilities.ts`, `filterMask.ts`, `selfCheck.ts` — is `import type`, so a wrong delete there
  fails at `tsc`. **Here it would fail at runtime**, and `useSceneData.ts` is squarely on the worlds
  path: `App.tsx`, `scene/renderer/sceneHost.ts`, `scene/probeSeam.ts` and `scene/benchSeam.ts` all
  import it. This is the one row in this table where the good case — a build error — does not apply.
- `scene/usePlaneDetail.ts`, `scene/PlanetHoverLabel.tsx` — `cards/cardTier`
- `camera/motion.ts` — `starfield/motion` (§1)

> **Re-taken by import edge, not by symbol name (DEC-752, at head `9ff1d81`).** The first pass
> grepped for the surviving symbols. That over-counts — `grep imageQueue` returns `worldSurface.ts`
> and `artPool.ts`, which only *mention* it, where the real edges are `artStream.ts` and
> `attachWorlds.ts` — and, worse, it under-counts a file that imports under a different name, which
> is how `useSceneData.ts` was missed. `grep -rn "from '[^']*/<module>'"` is the reading that
> matches what the bundler resolves. The counts above are that reading.

## 4. What is actually galaxy-only — RE-TAKEN, and the old list was wrong five times

> **Do not use the previous version of this section. It is reproduced at the end for the record and
> it would have broken the worlds build (DEC-752).** It read: "`scene/EternitiesScene.tsx`'s galaxy
> branch, `scene/starScene.ts`, and under `scene/starfield/`: `starStream.ts`,
> `starFieldObjects.ts`, `nebulaTexture.ts`, `noise.ts`, `planeTable.ts` — plus the non-`glslFloat`
> half of `shaders.ts`, the non-`curlNoise` half of `motion.ts`, and the geometry half of
> `starGeometry.ts`."
>
> Every error in it runs the same way — a module that *looks* galaxy-only because it sits under
> `scene/starfield/` and is named for stars, while the worlds scene imports it. The directory name
> is not the boundary.

Measured at head `796f93a` by import edge (`grep -rn "from '[^']*/<module>'"`), scanning each doomed
file for importers **outside** the doomed set, and recording whether the import is a value or a type
— because a wrong delete of a type fails at `tsc` and a wrong delete of a value fails at runtime:

| doomed module | surviving importer | symbol | kind |
|---|---|---|---|
| `starfield/planeTable.ts` | **`scene/useSceneData.ts`** | `PlaneTable` | **VALUE** |
| | `scene/motionSync.ts`, `picking/scenePicker.ts`, `selfCheck.ts`, `bench/BenchRunner.tsx` | `PlaneTable` | type |
| `starfield/starGeometry.ts` | **`scene/useSceneData.ts`** | `StarGeometry`, `resolvePositionMode` | **VALUE** |
| | `app/filterMask.ts`, `platform/capabilities.ts`, `selfCheck.ts` | types | type |
| `starfield/starFieldObjects.ts` | **`scene/useSceneData.ts`** | `createStarField` | **VALUE** |
| | `platform/attachProgramWarmup.ts`, `selfCheck.ts` | `StarField` | type |
| `starfield/nebulaTexture.ts` | **`scene/useSceneData.ts`** | `createNebulaTexture` | **VALUE** |
| `starfield/starStream.ts` | **`scene/useSceneData.ts`** | `streamStarsIntoScene` | **VALUE** |
| `starfield/motion.ts` | `camera/motion.ts` | `curlNoise` | VALUE |
| | `picking/scenePicker.ts` | `PlaneKindCode`, `planeWorldPosition` | VALUE |
| | `bench/BenchRunner.tsx` | `planeWorldPosition` | VALUE |
| | `selfCheck.ts` | `starWorldPosition` | VALUE |
| `starfield/noise.ts` | *(none directly)* | `valueNoise3`, reached from `curlNoise` | **transitive** |
| `starfield/shaders.ts` | `cards/cardShaders.ts` | `DEFINE_BLOCK`, `MOTION_GLSL` | VALUE |
| `cards/atlas.ts` | `cards/gpuMemory.ts` | `ATLAS_BYTES` | VALUE |
| `cards/cardTier.ts` | `renderer/sceneHost.ts` | `attachCardTier` + types | VALUE |
| | `PlanetHoverLabel.tsx`, `usePlaneDetail.ts` | label/cards types | type |
| `starScene.ts` | `renderer/sceneHost.ts` | `attachStarScene` | VALUE |

**The five the old list got wrong:**

1. **`planeTable.ts` is not galaxy-only, and this is the one that would have hurt most.** The worlds
   scene's spin comes from it — `sceneHost.ts:338` feeds `setSpinAngles` from the plane table, and
   the probe's `multiverseAngle` (which W5's whole sweep is read against) is `PlaneTable`'s own
   getter. `useSceneData.ts` constructs it. Deleting it stops the worlds from turning.
2. **`noise.ts` is not galaxy-only**, transitively: `curlNoise` survives in `camera/motion.ts` and is
   built on `valueNoise3` from `noise.ts`. An import-edge scan shows no consumer outside
   `starfield/`, which is exactly how it reads as safe and is not.
3. **`motion.ts` has three surviving symbols, not one.** `curlNoise` was the only one named;
   `planeWorldPosition` and `PlaneKindCode` also survive, through `picking/scenePicker.ts` — a file
   §3 already lists as surviving, without this edge.
4. **`starFieldObjects.ts` has a surviving type consumer nobody listed**:
   `platform/attachProgramWarmup.ts`.
5. **`atlas.ts` has one too**: `cards/gpuMemory.ts` takes `ATLAS_BYTES`, and `gpuMemory.ts` is in §3's
   own survivor list.

### The structural finding: the cutover is "split `useSceneData.ts`", not "delete `starfield/`"

`scene/useSceneData.ts` **value**-imports five of the doomed modules and is itself squarely on the
worlds path — `App.tsx`, `renderer/sceneHost.ts`, `probeSeam.ts` and `benchSeam.ts` all import it.
It is the hub every one of the errors above runs through. So the deletion is not a directory
removal with a few edits around it: the load-bearing move is separating that file's galaxy half
(`StarGeometry`, `PlaneTable`, `createStarField`, `createNebulaTexture`, `streamStarsIntoScene`)
from the half the worlds scene needs, and deciding for each whether it is retained, relocated or
deleted. `PlaneTable` is retained — the worlds scene cannot spin without it.

### Resolved ahead of the cutover

- **`PositionMode`, `resolvePositionMode`, `POSITION_MODE_STORAGE_KEY` — done.** Moved from
  `starfield/starGeometry.ts` to **`scene/platform/positionMode.ts`**, beside `capabilities.ts`,
  which owns the `bootPositionMode` probe they resolve against. `capabilities.ts`'s side of the pair
  is deliberately `import type`, so the two modules reference each other with **no runtime cycle**.
  Four consumers re-pointed; tsc 0, eslint 0, suite 1,393/66 unchanged.
- **`glslFloat` — done.** It moved from `starfield/shaders.ts` to `scene/glsl.ts`, with all seven
  consumers re-pointed (the five worlds shader modules, `cards/cardShaders.ts`, and `shaders.ts`
  itself) plus `test/cards.test.ts`, which `tsc` caught. Suite 1,393/66 unchanged, tsc 0, eslint 0.
  That is one entanglement out of the irreversible commit, taken reversibly and verified.
- Still to relocate before the deletion, on the same pattern: `curlNoise` (+ its `valueNoise3`
  dependency), `planeWorldPosition`/`PlaneKindCode`, `ATLAS_BYTES`, and whatever of `PlaneTable` and
  `starGeometry` the split of `useSceneData.ts` decides to keep.

### The sixth error, and the only one that would have shipped BROKEN rather than red

The five above are build failures: delete the module and `tsc` or the app stops. This one is
different, and it is the reason §3.2's one-line deletion list cannot be followed literally.

**`scene/cards/cardTier.ts` is the only writer of the hover label's state.** `labelState` is owned by
`SceneHost` (`sceneHost.ts:144`, typed `PlanetLabelState`), rendered **unconditionally** by
`EternitiesScene.tsx:555` — the shipped scene that hosts worlds, not a galaxy branch — and populated
**only** at `cardTier.ts:202-210`. The drive chain is `sceneHost:222` → `cardTierHandle
.setHoveredPlanet` → `focusedCard.setHoveredPlanet`, and `focusedCard.ts` **survives** (§1.10's
printing ring). So the card tier is the middle link of a chain whose two ends both outlive it.

Delete `cardTier.ts` as "the card-sheet tier" and the type re-points cleanly, the build stays green,
the app still renders `<PlanetHoverLabel>` — and it is **permanently `visible: false`**. A shipped
surface stops working with nothing to report it:

- **W1–W5 cannot see it.** The gate measures cell height, colour, art and labels-at-home. Nothing in
  §3.1 reads the hover label.
- **§3.2 condition 4's parity evidence did not cover it either.** That run checked the plane index,
  search, card focus, deep links, filters, attract, reduced motion and a11y. The hover label was not
  among them, so "8 of 9 surfaces evidenced" would not have caught this.

That is the **same failure shape §3.2.1 already names for the `active` move** — split it and the
galaxy renders on, wrong, with no instrument watching — one feature over, and unlisted.

**So the cutover is a migration, not a deletion.** Before `cardTier.ts` can go, the hover-label drive
has to be re-hosted: `sceneHost` calling `focusedCard.setHoveredPlanet` directly and owning the
projection at `cardTier.ts:202-205`, or the equivalent on the worlds attachment. `usePlaneDetail.ts`
and `PlanetHoverLabel.tsx` are both on the worlds path and both take their types from `cardTier`.

**Whatever replaces it needs a test, because the defect is invisible.** A label that never becomes
visible is indistinguishable from a label nobody hovered.

### The split of `useSceneData.ts`, resolved field by field

`SceneResources` has four fields and the cutover has a different answer for each. Traced at head
`2ed5a6a`; this is the map the deletion follows, so it does not have to be rediscovered mid-commit.

| field | verdict | why |
|---|---|---|
| `table: PlaneTable` | **RETAIN** | the worlds scene's spin comes from it (`sceneHost.ts:338` → `setSpinAngles`), and the probe's `multiverseAngle` — the parameter W5's whole sweep is read against — is `PlaneTable`'s own getter |
| `positionMode: PositionMode` | **RETAIN** | it is part of the shipped probe surface: `ProbeState` publishes it, and `probeSeam`, `benchSeam`, `capabilities`, `selfCheck` and `BenchRunner` all read it |
| `geometry: StarGeometry` | **RETRACTED — see §6** | I published "no surviving consumer"; `cardTier.ts` uses `geometry.hueClassOf` to show the printing ring, and the ring is a worlds surface |
| `field: StarField` | **DELETE** | the star point cloud itself |

**`StarGeometry`'s three apparent survivors all resolve to the galaxy**, which is what makes the
delete safe, and it is worth writing down because the import edges suggest otherwise:

- `app/filterMask.ts` — `bindFilterMask`/`useFilterMask` take a `StarGeometry`, **but the worlds
  path has its own separate binding in the same file** (§1.11, DEC-751), which pushes the mask
  straight at the worlds attachment and never touches the star buffer. The file's own header says
  why they are two: the star geometry is built once with `planes.json` while the worlds attachment
  outlives every roster it composes. So the cutover deletes the galaxy binding and keeps the worlds
  one; both subscribe to the same `filterEvaluation`, so filters keep working.
- `scene/probeSeam.ts` — reads `resources.field.points.material`'s `uMotion`, i.e. the star shader.
  Galaxy-only.
- `scene/benchSeam.ts` — `focusCard` uses `geometry.planeRowOf` with `focusStar`. Galaxy-only.

**Where the retained pieces go.** `PositionMode`, `resolvePositionMode` and
`POSITION_MODE_STORAGE_KEY` move out of `starfield/starGeometry.ts` into `scene/platform/`, beside
`capabilities.ts` — which already owns `bootPositionMode` and is where the rest of the capability
surface lives. `PlaneTable` is retained as a module; it is not galaxy furniture, it is the plane
motion table the worlds scene runs on, and only its name and address suggest otherwise.

## 6. The printing ring is hosted inside the card tier — and that retracts a verdict above

**Correction to §4's own table, published here rather than quietly edited.** I wrote that
`StarGeometry` has no surviving consumer and could be deleted, having traced its three apparent
survivors (`filterMask`, `probeSeam`, `benchSeam`) to the galaxy. That trace was right and the
conclusion was wrong, because it missed a fourth consumer inside the doomed set itself.

**`scene/cards/cardTier.ts:97` is the only place a `FocusedCard` is ever constructed**, anywhere in
the app. §1.10's flat printing ring *is* `FocusedCard`. So the ring — **an explicit §3.2 condition-4
parity surface** — exists only because the module §3.2 names for deletion creates, shows and ticks
it:

- `EternitiesScene.tsx:356` (the shipped worlds scene) → `sceneHost.setFocusedStar`
- → `cardTier.setFocusedStar` → `applyFocus()`
- → `card.show(record, focusedStar, resources.geometry.hueClassOf(focusedStar))`

That last call is why `StarGeometry`'s delete is not safe: the ring's hue comes out of the star
buffer. And the hover label of §5 hangs off the same block — `if (card.visible && focusedStar >= 0)`
— so it is not an independent finding, it is the same one a level down.

**And the tier is attached on a worlds build, so this is live rather than latent.**
`sceneHost.buildCardTier()` is called at line **341, immediately after `worldsAttachment
.setSpinAngles`**, and again at 400 — **with no galaxy/worlds condition on either**. So on the
shipped worlds build the card tier is constructed, the `FocusedCard` with it, and both surfaces
work today. The deletion would take working features, not dead code.

**What this means for the cutover, stated plainly.** §3.2's list reads as though `cards/` splits
cleanly into "the thumbnail atlas and the card-sheet tier" (goes) and §1.10's ring (stays). It does
not. The ring's own module survives; **its host does not**, and no worlds-side host exists. Deleting
the card tier deletes the printing ring and the hover label with it.

So **condition 4's printing-ring item is not merely "unverified by a headless instrument"** — which
is how this leg has been recording it. Structurally, the ring is galaxy-hosted, in both builds, and
has never been re-hosted onto the worlds path. The v2 control reading identically is consistent with
exactly that.

**This is a product decision, not a deletion detail**, and it is not leg G's to take: either the ring
and the hover label are re-hosted onto the worlds attachment before the galaxy goes — a feature leg,
with tests, since a ring that never appears and a ring nobody focused are the same reading — or the
owner accepts that they stop shipping at the cutover.

## 5. The two things §3.2 makes atomic with all of the above

1. **`datasets.json`'s `active` moves to the v3 directory in the same commit that deletes the galaxy
   scene** (§3.2.1). Split, it fails *silently*: v3 drops the spiral shear triple, all three live
   readers take it through `?? 0`, and `READABLE_CONTRACT_VERSIONS` is `{2, 3}` — so the galaxy keeps
   rendering, flat, with no instrument watching.
2. **Tag `galaxy-cutover` on the last commit where the galaxy scene and `visual-gate.mjs` both still
   exist, then delete in the next commit** (§3.3). Present on `3824f78` and all still maintained:
   `scripts/visual-gate.mjs` (1,187 lines), `scripts/lib/status-panel.mjs` (148),
   `scripts/alloc-probe.mjs` (404), `scripts/dec697-diag.mjs` (164). Staying:
   `check-budget.mjs`, `bench.mjs`, `write-vercel-json.mjs`, `worlds-gate.mjs` (1,671), the e2e suite,
   and `puppeteer-core`.
