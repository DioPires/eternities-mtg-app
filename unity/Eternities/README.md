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
That includes the player settings no build has needed yet: the company name, the bundle identifier
and the minimum macOS version are the template's, not decisions.

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

Only the names are ours. What each level sets is still what the template set; the slice tunes them
against the budgets (PRD v4 8.1.1, 7.2). `RenderPipelineTests` holds the names, the order and one
HDRP asset per level.

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
| `Assets/Settings/` | The HDRP assets: one per quality level, the global settings and the default volume profiles. |
| `Assets/Scenes/Hub.unity` | The persistent scene (PRD v4 8.4.1): the template's camera, sun and sky, and the `Eternities` object. Kit worlds have no scene; they are built at run time from the pack and the layout. |
| `Assets/Kits/core/` | What every world shares. `Materials/` holds the slice's plain materials (plinths by rarity, the mannequin, the hub, the portal), made by the generation entry point. |
| `Assets/Kits/temperate/` | The `temperate` kit's slice subset. `Terrain/`, `Props/` and `Audio/` hold the 24 files `sources.yaml` pins, in Git LFS, with a `CREDITS.md` row each; `fetch.sh` verifies them and fails on an unlisted file in those three folders, so what is made from them lives beside them. `Assets/Editor/KitMaskImport.cs` repacks each `_arm_` texture into HDRP's mask map layout as it is imported. |
| `Assets/StreamingAssets/data/manifest.json` | Names the pinned pack hash. The pack itself is `data/<hash>/` beside it: written by the generation entry point, not committed. |
| `batchmode.sh` | Starts the pinned editor on this project in batchmode, logging to stdout, and passes its arguments through. It replaces a `TMPDIR` too long for the compiler's socket. |

## Batchmode commands

Run from the repository root. `batchmode.sh` reads the editor version from `ProjectVersion.txt` and
fails if that editor is not installed. The editor opens a project once: close it in the Unity editor
before running any of these on the same clone. Output paths must be absolute, because the editor
changes its working directory to the project.

Scene generation entry point (PRD v4 8.2.5). It writes what a world needs and git does not hold,
under `Assets/StreamingAssets/data/<hash>/`:

- the files of the pack that the slice reads, copied from `web/public/data/<hash>/` and checked
  against the pack's manifest: `manifest.json`, `planes.json`, Dominaria's shards and `swatches.bin`;
- `layout/dominaria.txt`, Dominaria's layout from the C# allocator (PRD v4 5.4), written only if the
  independent checker passes it. The slice has no contract v4 pack, so this file stands where the
  pack's positions will.

It also completes what is committed, and changes nothing there on a second run: the slice's plain
materials under `Assets/Kits/core/Materials/`, and in `Assets/Scenes/Hub.unity` the one object,
`Eternities`, that builds the hub and the world at run time. It assigns the kit's terrain layers to
that object once `Assets/Kits/temperate/TerrainLayers/` holds `meadow`, `path` and `gravel`; until
then the ground is painted in plain colours. Generated assets are not edited by hand.

With the project open in the editor, the menu item Eternities > Generate does the same. To walk the
world, generate, open `Assets/Scenes/Hub.unity` and press Play: WASD walks, Shift runs, the right
mouse button orbits the camera, the wheel zooms, and Esc in a world returns to the hub.

It logs the world's figures (PRD v4 5.4.14), and writes them to `-reportOut` if that is given:

```sh
unity/Eternities/batchmode.sh -quit -executeMethod Eternities.EditorTools.Generate.Run \
  -packHash a5846bec28d1447e -reportOut "$PWD/dominaria-layout.txt"
```

Bench runner (PRD v4 8.8.4), the editor host, as CI runs it. It makes the world's files, opens
`Assets/Scenes/Hub.unity`, enters play mode and renders off screen at `-benchSize`. No `-quit`: the
run ends the editor itself, with exit code 0 only if the path completed, and a watchdog ends it
with 1 after fifteen minutes. It writes `eternities.bench.v1` JSON to `-benchOut` and, if
`-benchCaptures` is given, the checkpoints as PNG files into that directory. The path so far: the
hub, the walk into Dominaria's portal, the arrival, and Esc back to the hub:

```sh
unity/Eternities/batchmode.sh -executeMethod Eternities.EditorTools.Bench.Run \
  -bench warm -benchSize 3456x2234 -benchOut "$PWD/bench.json" -benchCaptures "$PWD/captures"
```

A figure from the editor host fills no row of the acceptance matrix (PRD v4 9.5): with no swap
chain an off-screen frame time can read short. The figures of record come from a player build
started with the same `-bench` arguments; the build command arrives with the first build.

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
