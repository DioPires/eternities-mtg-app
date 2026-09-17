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
- `scene/usePlaneDetail.ts`, `scene/PlanetHoverLabel.tsx` — `cards/cardTier`
- `camera/motion.ts` — `starfield/motion` (§1)

## 4. Unambiguously galaxy-only

`scene/EternitiesScene.tsx`'s galaxy branch, `scene/starScene.ts`, and under `scene/starfield/`:
`starStream.ts`, `starFieldObjects.ts`, `nebulaTexture.ts`, `noise.ts`, `planeTable.ts` — plus the
non-`glslFloat` half of `shaders.ts`, the non-`curlNoise` half of `motion.ts`, and the geometry half
of `starGeometry.ts`. `scene/selfCheck.ts` and `bench/BenchRunner.tsx` import several of these and
have to be re-pointed or retired with them.

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
