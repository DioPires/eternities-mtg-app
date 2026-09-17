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

- **`glslFloat` — done.** It moved from `starfield/shaders.ts` to `scene/glsl.ts`, with all seven
  consumers re-pointed (the five worlds shader modules, `cards/cardShaders.ts`, and `shaders.ts`
  itself) plus `test/cards.test.ts`, which `tsc` caught. Suite 1,393/66 unchanged, tsc 0, eslint 0.
  That is one entanglement out of the irreversible commit, taken reversibly and verified.
- Still to relocate before the deletion, on the same pattern: `curlNoise` (+ its `valueNoise3`
  dependency), `planeWorldPosition`/`PlaneKindCode`, `ATLAS_BYTES`, and whatever of `PlaneTable` and
  `starGeometry` the split of `useSceneData.ts` decides to keep.

### The split of `useSceneData.ts`, resolved field by field

`SceneResources` has four fields and the cutover has a different answer for each. Traced at head
`2ed5a6a`; this is the map the deletion follows, so it does not have to be rediscovered mid-commit.

| field | verdict | why |
|---|---|---|
| `table: PlaneTable` | **RETAIN** | the worlds scene's spin comes from it (`sceneHost.ts:338` → `setSpinAngles`), and the probe's `multiverseAngle` — the parameter W5's whole sweep is read against — is `PlaneTable`'s own getter |
| `positionMode: PositionMode` | **RETAIN** | it is part of the shipped probe surface: `ProbeState` publishes it, and `probeSeam`, `benchSeam`, `capabilities`, `selfCheck` and `BenchRunner` all read it |
| `geometry: StarGeometry` | **DELETE** | no surviving consumer once the galaxy goes — see below |
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
