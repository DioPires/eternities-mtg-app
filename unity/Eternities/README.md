# Eternities — the Unity project

PRD v4 8.1 and 8.2. Unity 6.6 with HDRP, for macOS on Apple Silicon and Windows x64. Everything an
engineer commits here is text (PRD v4 7.6.4): C#, assembly definitions, and scenes, prefabs,
materials and settings serialised as Force Text with their `.meta` files. Models, textures and audio
are content and go through Git LFS (`.gitattributes` at the repository root).

The project was created from Unity's HDRP template and then changed in four places:

```sh
unity projects new Eternities --editor-version 6000.6.5f1 --template com.unity.template.hdrp-blank
```

- The template's tutorial is removed: `Assets/Readme.asset` and `Assets/TutorialInfo/`, which
  carried a PNG.
- The quality levels and their HDRP assets are renamed (Quality levels, below).
- Five packages are added to `Packages/manifest.json` (Pins, below).
- The scripts, tests and data manifest under Layout, below, are ours.

Everything else under `Assets/Settings/`, `Assets/InputSystem_Actions.inputactions` and
`ProjectSettings/` is as template 17.2.5 wrote it. So is `Assets/Scenes/Hub.unity`, the template's
`SampleScene.unity` renamed, but for the one object the generation entry point adds to it.
The player's identity (company, bundle identifier, minimum macOS) and the IL2CPP backend for
Standalone are ours, set with the first build (Batchmode commands, below).

## Pins

Upgrades are deliberate and reviewed (PRD v4 7.6.3). The editor pin is
`ProjectSettings/ProjectVersion.txt`; the package pins are `Packages/manifest.json`. This table
restates both and changes in the same pull request as either.

The editor is `6000.6.5f1`, Unity 6.6, by the owner's ruling on DEC-951. Unity's release API lists
it in the `SUPPORTED` stream, not `LTS`.

The package versions are read from `Packages/packages-lock.json`, which the editor writes when it
resolves the manifest; every version below is also the one the manifest asks for. "builtin" is the
lock's word for a package that ships inside the editor install and is versioned with it.

| What | Package | Version | Source in the lock |
|---|---|---|---|
| Unity editor | | `6000.6.5f1` (`3ff58d469c8a`) | Unity Hub: `unityhub://6000.6.5f1/3ff58d469c8a` |
| HDRP | `com.unity.render-pipelines.high-definition` | `17.6.0` | builtin |
| VFX Graph | `com.unity.visualeffectgraph` | `17.6.0` | builtin |
| Cinemachine | `com.unity.cinemachine` | `6.6.0` | builtin |
| Animation Rigging | `com.unity.animation.rigging` | `6.6.0` | builtin |
| Test Framework | `com.unity.test-framework` | `1.8.0` | builtin |
| Input System | `com.unity.inputsystem` | `1.20.0` | registry |
| Addressables | `com.unity.addressables` | `2.11.2` | registry |

The template's two IDE packages are pinned in the manifest too: `com.unity.ide.rider` `3.0.40` and
`com.unity.ide.visualstudio` `2.0.28` (registry). Its other two are removed: `com.unity.collab-proxy`
is Unity Version Control and the project uses Git, and `com.unity.ugui` has no user, because UI
Toolkit carries every overlay (PRD v4 8.1.2). To print every direct pin from the lock:

```sh
jq -r '.dependencies | to_entries[]
  | select(.value.depth == 0 and (.key | startswith("com.unity.modules.") | not))
  | "\(.key)\t\(.value.version)\t\(.value.source)"' unity/Eternities/Packages/packages-lock.json
```

## Quality levels

Three HDRP quality levels, named exactly `high`, `medium` and `low` (PRD v4 8.1.1), in that order
in `ProjectSettings/QualitySettings.asset`. `high` is the reference machine's setting and `low` the
light Mac's (PRD v4 7.1); `medium` is the first fallback of the slice's acceptance matrix (PRD v4
9.5, row R2). The bench and the settings screen select a level by these names.

| Level | HDRP asset | The template called it |
|---|---|---|
| `high` (the default) | `Assets/Settings/HDRP high.asset` | High Fidelity |
| `medium` | `Assets/Settings/HDRP medium.asset` | Balanced |
| `low` | `Assets/Settings/HDRP low.asset` | Performant |

The names are ours, and so are the four things PRD v4 8.1.1 and 5.7.1 fix about a level. The rest
of what a level sets is still what the template set, and is the owner's to tune by eye against the
budgets (PRD v4 7.2): shadows, reflections, and the quality of the fog, the clouds and the water.

| Fixed at each level | `high` | `medium` | `low` | Where |
|---|---|---|---|---|
| Water | on | on | on | `supportWater` in the HDRP asset |
| Clouds | volumetric | volumetric | a cloud layer | `supportVolumetricClouds` in the HDRP asset, and the kind of cloud in the level's volume profile |
| Volumetric fog | on | on | on, at the lowest quality | `supportVolumetrics` in the HDRP asset; in the low asset every fog tier has the budget of the lowest, 0.125 |
| Dynamic resolution | enabled | enabled | enabled | in the HDRP asset: not forced, from 75% to 100% |

A level renders at full resolution until something asks for less; the bench asks with
`-benchScale 0.75`. Each HDRP asset names a volume profile of its own, `Assets/Settings/HDRP <level>
volume.asset`, which HDRP lays over the project's defaults and under every volume of a scene. It
holds what a level sets that is a volume setting and not a switch of the asset; today that is the
kind of cloud. The generation entry point makes a missing one, and never writes one again.
`RenderPipelineTests` holds the names, the order, one HDRP asset per level and the four rows above.

## Target platforms

Standalone, for macOS on Apple Silicon and Windows x64 (PRD v4 7.1.4). The graphics APIs are the
template's: Metal on macOS, Direct3D 12 then 11 on Windows. The architecture of a build is not a
committed setting; the build script chooses it (PRD v4 8.9.1). The installed editor has Mac Build
Support (IL2CPP), Web Build Support and the Documentation module; no job uses the last two. Windows
Build Support (Mono) is added with the first Windows build; nothing in the project or its CI jobs
builds for Windows.

## Layout

| Path | What lives there |
|---|---|
| `Assets/Scripts/<Area>/` | One assembly per area, `Eternities.<Area>`: Data, Layout, Kits, Avatar, CardView, Travel, Audio, UI, Bench. The namespace follows the assembly, so inside any `Eternities.*` namespace the bare name `Avatar` is that namespace: write `UnityEngine.Avatar` for the type. |
| `Assets/Editor/` | `Eternities.Editor`, editor only: the batchmode entry points below. |
| `Assets/Tests/EditMode/`, `Assets/Tests/PlayMode/` | The two test assemblies, namespace `Eternities.Tests`. CI requires a passed test in that namespace, because a package's own test also runs. |
| `Assets/Settings/` | The HDRP assets: one per quality level with that level's volume profile, the global settings and the default volume profiles. |
| `Assets/Scenes/Hub.unity` | The persistent scene (PRD v4 8.4.1): the template's camera, sun and sky, and the `Eternities` object. Kit worlds have no scene; they are built at run time from the pack and the layout. |
| `Assets/Kits/core/` | What every world shares. `Materials/` holds the slice's plain materials (plinths by rarity, the mannequin, the hub, the portal, the image surface), and `UI/` the overlays' panel settings and theme; both are made by the generation entry point. `Shaders/` holds the two shaders of the isolated image path (PRD v4 8.4.4), written by hand. |
| `Assets/Kits/temperate/` | The `temperate` kit's slice subset. `Terrain/`, `Props/` and `Audio/` hold the 24 files `sources.yaml` pins, in Git LFS, with a `CREDITS.md` row each; `fetch.sh` verifies them and fails on an unlisted file in those three folders, so what is made from them lives beside them: `Materials/` holds the kit's plain materials for its props and `Water/` its two water prefabs, all made by the generation entry point. `Assets/Editor/KitMaskImport.cs` repacks each `_arm_` texture into HDRP's mask map layout as it is imported. |
| `Assets/StreamingAssets/data/manifest.json` | Names the pinned pack hash. The pack itself is `data/<hash>/` beside it: written by the generation entry point, not committed. |
| `bench.sh` | Starts a bench run of the built player (Batchmode commands, below). |
| `batchmode.sh` | Starts the pinned editor on this project in batchmode, logging to stdout, and passes its arguments through. It replaces a `TMPDIR` too long for the compiler's socket. |

## Batchmode commands

Run from the repository root. `batchmode.sh` reads the editor version from `ProjectVersion.txt` and
fails if that editor is not installed. The editor opens a project once: close it in the Unity editor
before running any of these on the same clone. Output paths must be absolute, because the editor
changes its working directory to the project.

Scene generation entry point (PRD v4 8.2.5). It writes what a world needs and git does not hold,
under `Assets/StreamingAssets/data/<hash>/`:

- the files of the pack that the slice reads, copied from `web/public/data/<hash>/` and checked
  against the pack's manifest: `manifest.json`, `planes.json`, Dominaria's shards, `swatches.bin`
  and `search.json`, which holds the set dictionary;
- `layout/dominaria.txt`, Dominaria's layout from the C# allocator (PRD v4 5.4), written only if the
  independent checker passes it. The slice has no contract v4 pack, so this file stands where the
  pack's positions will.

It also completes what is committed, and changes nothing there on a second run: the slice's plain
materials under `Assets/Kits/core/Materials/` and `Assets/Kits/temperate/Materials/`, and in
`Assets/Scenes/Hub.unity` the one object, `Eternities`, that builds the hub and the world at run
time. It names the mesh and the materials of each of the kit's props on that object: the world's
prop scatter (PRD v4 8.4.2) is worked out at load from the layout, seeded by the plane, and the
quality level in force sets how much of it is drawn (high all of it, medium 60%, low 35%; the
table of what grows in which wedge is `Temperate` in `Assets/Scripts/Kits/PropPlan.cs`). It makes
the kit's three terrain layers, `meadow`, `path` and `gravel` under
`Assets/Kits/temperate/TerrainLayers/`, once: each has its texture's colour, normal and mask maps and
a first tile size, and is tuned in its own file from then on. It names them on that object, and a
ground without all three is painted in plain colours. It also makes the kit's two water prefabs,
`Assets/Kits/temperate/Water/River.prefab` and `Lake.prefab`, once, from the water system's own
presets: its river, running along the bed at 1.5 km/h, and its open sea calmed to a lake's light
breeze, without foam. Those two are the owner's to tune and it never writes them again. They are
tuned with the game playing in the editor: select the prefab in the Project window and change its
Water Surface in the Inspector, and the world's river or lake takes the change within a quarter of
a second (`WaterTuning`), while the editor saves it in the prefab's file. Other generated assets
are not edited by hand. It makes each quality level's volume profile the same way (Quality levels,
above). The world has its river and its lake only where water is on in the HDRP asset of the quality
level in force, which it is at all three.

With the project open in the editor, the menu item Eternities > Generate does the same. To walk the
world, generate, open `Assets/Scenes/Hub.unity` and press Play: WASD walks, Shift runs, the right
mouse button orbits the camera, the wheel zooms. Within 3 m of a stand its label shows and E enters
card view; E there flips a card that has a back image, `[` and `]` step through its printings, and
Esc or walking leaves. T opens the travel menu. Esc in a world, outside card view, returns to the hub.

It logs the world's figures (PRD v4 5.4.14), and writes them to `-reportOut` if that is given:

```sh
unity/Eternities/batchmode.sh -quit -executeMethod Eternities.EditorTools.Generate.Run \
  -packHash a5846bec28d1447e -reportOut "$PWD/dominaria-layout.txt"
```

Bench runner (PRD v4 8.8.4), the editor host, as CI runs it. It makes the world's files, opens
`Assets/Scenes/Hub.unity`, enters play mode and renders off screen at `-benchSize`. No `-quit`: the
run ends the editor itself, with exit code 0 only if the path completed, and a watchdog ends it
with 1 after fifteen minutes. It writes `eternities.bench.v1` JSON to `-benchOut` and, if
`-benchCaptures` is given, the checkpoints as PNG files into that directory: 2, 3, 4, 5 and 9 of
PRD v4 9.3, and 6, the river from the end of the north radial path, with what the listener hears
there as `checkpoint-6-river.wav` (six seconds: the river ahead, then to one side, then to the
other) and each ear's level in the JSON's `sound`. The path so far: the
hub, the walk into Dominaria's portal, the arrival, the north radial path to the rim, 150 m of the
outermost ring path at a run, the nearest stand's apron and its card view, travel by the menu to
Invasion of Dominaria and its card view with the card flipped, Esc back to the hub, and the same
arrival with reduced motion; about five minutes. A warm run visits the world once before it measures,
and walks back to the hub's arrival point so that it stands there as a visitor arrives, facing the
portal; a cold run empties the image cache first. A run ends at its first step, saying so, if the
portal's ring is not in the middle of the view: the hub's capture of every warm run once looked the
other way. The stands along the path ask Scryfall for their images, once: they are kept in the
image cache under the application-support directory (PRD v4 4.15.3):

```sh
unity/Eternities/batchmode.sh -executeMethod Eternities.EditorTools.Bench.Run \
  -bench warm -benchSize 3456x2234 -benchOut "$PWD/bench.json" -benchCaptures "$PWD/captures"
```

A figure from the editor host fills no row of the acceptance matrix (PRD v4 9.5): with no swap
chain an off-screen frame time can read short. The figures of record come from a player build
started with the same `-bench` arguments, full screen at the display's native resolution, with no
Unity editor alive on the machine. `-benchQuality high|medium|low` and `-benchScale 1|0.75` choose
the row; a run of record is made without `-benchCaptures`. A player takes `-benchSize` too, and
ends at once, saying so, if the display does not take that size: a full-screen window on macOS
renders at the desktop's resolution, and on the reference machine 1920 x 1080 was not taken. So a
player's figure is at the display's own resolution, or at a scale of it by `-benchScale`:

```sh
unity/Eternities/batchmode.sh -quit -executeMethod Eternities.EditorTools.Build.Run -buildOut "$PWD/unity/Eternities/Build"
unity/Eternities/bench.sh "$PWD/unity/Eternities/Build/Eternities.app" -bench warm -benchQuality high -benchScale 1 -benchOut "$PWD/bench-warm.json"
unity/Eternities/bench.sh "$PWD/unity/Eternities/Build/Eternities.app" -bench cold -benchQuality high -benchScale 1 -benchOut "$PWD/bench-cold.json"
```

Two rules for an agent's runs on the reference machine (DEC-953):

- **Start every run with `--locked-only`**, before the player's path:
  `unity/Eternities/bench.sh --locked-only "$PWD/unity/Eternities/Build/Eternities.app" -bench warm ...`.
  A run takes the whole screen for minutes, and the owner allows it on the locked screen while the
  machine is idle. With the switch the script starts nothing on an unlocked screen, and ends the
  player with exit code 3 the moment the screen is unlocked. The owner's own runs do not need it.
- **Before a run of record, make one run with `-benchCaptures` and look at its pictures.** CI's
  captures are the editor's and say nothing about what a player draws: the first builds of the
  slice drew no ground, and no figure showed it.

`bench.sh` starts the player with those arguments, refuses to start while a Unity editor runs on
the machine, and exits with the player's exit code. It needs the player and nothing else, so it
runs on a machine with no checkout: the build writes the commit it was built from, and whether the
tree held uncommitted changes, into the player, and the run's JSON carries both. It also
answers the run's one question. A player that is not a development build has no counter for GPU
memory and cannot start a process, so before it leaves the world the run asks for its own
`footprint(1)`: the script runs the tool and the run writes the process's footprint, and the part
of it the graphics driver holds, into the JSON's `memory` block. A player started without the
script completes the path all the same and says in the JSON that nothing answered.

Beside the JSON the script writes `<benchOut>.others`: every process other than the player that
used half a core or more during the run, and the system's video encoder and decoder whenever they
ran at all, sampled every 5 s, each with the seconds at which it was first and last seen and its
highest %CPU, or the one word `none`. Read it before quoting a run. A locked, idle Mac is when
macOS does work of its own, and its media analysis decodes video on the GPU: a run it crossed
part-way had a p90 of 40 ms where the run before had 28, with the same median (DEC-953). Processor
use is what a script can read without privileges, so the file is a sign that a run had company and
not a measure of what the company cost. The other sign is in the JSON itself: `segments` whose p90
rises part-way through the run while the p50 holds.

The price list: what each thing in the frame is worth in milliseconds, at a quality level, on the
machine it runs on. A run started with `-bench prices` walks into the world and, at the arrival
point and on the apron of Invasion of Dominaria, draws the same view with one thing switched off
at a time: each kind of the world's content (props, stands, image surfaces, the isolated image
path, the ground, the water), each HDRP feature that is on, the anti-aliasing, and three quarters
of the width and height where the display takes that size. It writes the rows as `prices` in the JSON. A feature is switched on the
camera alone, so no settings file is written; the list says what a level is spending and fills
no row. About four minutes:

```sh
unity/Eternities/bench.sh "$PWD/unity/Eternities/Build/Eternities.app" -bench prices -benchQuality high -benchOut "$PWD/bench-prices.json"
```

A build rewrites five settings files in the working tree: the three `Assets/Settings/HDRP *.asset`
files, `Assets/Settings/HDRPDefaultResources/HDRenderPipelineGlobalSettings.asset` and
`ProjectSettings/QualitySettings.asset`. It saves them in the editor's current serialisation and
writes its own results into them. Do not commit that rewrite: the compile job fails on it, because
a cold import writes the global settings back. Discard it after a build:

```sh
git checkout -- unity/Eternities/Assets/Settings unity/Eternities/ProjectSettings/QualitySettings.asset
```

The build is the macOS player for Apple Silicon, IL2CPP, not a development build, with the pinned
pack and the world's files inside it. Its identity is in `ProjectSettings/ProjectSettings.asset`:
company `DioPires`, product `Eternities`, bundle identifier `com.diopires.eternities`, minimum macOS
14.0 (DEC-953). The image cache is under `~/Library/Application Support/DioPires/Eternities/images`.

Both exit 1 if a required argument is missing. The generation entry point also exits 1 if a pack
file does not match the manifest, if the allocator fails (PRD v4 5.4.11) or if the checker finds a
violation.

Tests, as CI runs them. No `-quit`: with `-runTests` the editor exits when the run ends, 0 only if
every test passed.

```sh
unity/Eternities/batchmode.sh -runTests -testPlatform EditMode -testResults "$PWD/editmode.xml"
unity/Eternities/batchmode.sh -runTests -testPlatform PlayMode -testResults "$PWD/playmode.xml"
```

Compile and console check, as CI runs it: open the project, then exit 1 if the editor's Console
holds an error. A compiler error ends the editor with exit 1 before the check runs. Without the
check, an import that logged errors (a shader that does not parse, a failed asset import) exits 0.

```sh
unity/Eternities/batchmode.sh -quit -executeMethod Eternities.EditorTools.ConsoleCheck.Run
```

The Console holds only what this run of the editor logged, and an asset already in `Library/` is not
imported again. So the check is complete on a cold import only: delete `Library/` first, as CI does
by checking out clean. A cold import takes about 45 seconds on the reference machine and leaves a
2.1 GB `Library/`.

## CI

`.github/workflows/ci.yml`, jobs `unity-compile`, `unity-editmode`, `unity-playmode` and
`unity-bench-smoke`, on the self-hosted runner on the reference machine. They run on every pull
request that touches `unity/`, `.github/workflows/ci.yml`, `.gitattributes`, `.gitignore` or
`.lfsconfig`.
`docs/ci-runner.md` is how that runner is built and re-verified.
