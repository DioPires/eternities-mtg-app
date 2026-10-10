# Eternities — the Unity project

PRD v4 8.1 and 8.2. Unity 6 LTS with HDRP, for macOS on Apple Silicon and Windows x64. Everything an
engineer commits here is text (PRD v4 7.6.4): C#, assembly definitions, and scenes, prefabs,
materials and settings serialised as Force Text with their `.meta` files. Models, textures and audio
are content and go through Git LFS (`.gitattributes` at the repository root).

## Pins

Upgrades are deliberate and reviewed (PRD v4 7.6.3). The editor pin is
`ProjectSettings/ProjectVersion.txt`; the package pins are `Packages/manifest.json`. This table
restates both and changes in the same pull request as either.

| What | Package | Version | Source |
|---|---|---|---|
| Unity editor | | `6000.3.26f1` (`de8167e7440c`), Unity 6.3 LTS | Unity Hub: `unityhub://6000.3.26f1/de8167e7440c` |
| HDRP | `com.unity.render-pipelines.high-definition` | `17.3.0` | core package, versioned with the editor |
| VFX Graph | `com.unity.visualeffectgraph` | `17.3.0` | core package, versioned with the editor |
| Test Framework | `com.unity.test-framework` | `1.6.0` | core package, versioned with the editor |
| Cinemachine | `com.unity.cinemachine` | `3.1.7` | Unity registry |
| Input System | `com.unity.inputsystem` | `1.20.1` | Unity registry |
| Addressables | `com.unity.addressables` | `4.1.1` | Unity registry |
| Animation Rigging | `com.unity.animation.rigging` | `1.4.1` | Unity registry |

Editor modules: Mac Build Support (IL2CPP) and Windows Build Support (Mono).

## Quality levels

Three HDRP quality levels, named exactly `high`, `medium` and `low` (PRD v4 8.1.1). `high` is the
reference machine's setting and `low` the light Mac's (PRD v4 7.1); `medium` is the first fallback of
the slice's acceptance matrix (PRD v4 9.5, row R2). The bench and the settings screen select a level
by these names.

## Layout

| Path | What lives there |
|---|---|
| `Assets/Scripts/<Area>/` | One assembly per area, `Eternities.<Area>`: Data, Layout, Kits, Avatar, CardView, Travel, Audio, UI, Bench. The namespace follows the assembly, so inside any `Eternities.*` namespace the bare name `Avatar` is that namespace: write `UnityEngine.Avatar` for the type. |
| `Assets/Editor/` | `Eternities.Editor`, editor only: the batchmode entry points below. |
| `Assets/Tests/EditMode/`, `Assets/Tests/PlayMode/` | The two test assemblies. |
| `Assets/StreamingAssets/data/manifest.json` | Names the pinned pack hash. The pack itself is `data/<hash>/` beside it. |
| `batchmode.sh` | Starts the pinned editor on this project in batchmode, logging to stdout, and passes its arguments through. |

## Batchmode commands

Run from the repository root. `batchmode.sh` reads the editor version from `ProjectVersion.txt` and
fails if that editor is not installed. The editor opens a project once: close it in the Unity editor
before running any of these on the same clone. Output paths must be absolute, because the editor
changes its working directory to the project.

Scene generation entry point (PRD v4 8.2.5). The skeleton logs the pack hash it was given:

```sh
unity/Eternities/batchmode.sh -quit -executeMethod Eternities.EditorTools.Generate.Run -packHash a5846bec28d1447e
```

Bench runner (PRD v4 8.8.4). The skeleton writes an empty JSON object to the path:

```sh
unity/Eternities/batchmode.sh -quit -executeMethod Eternities.EditorTools.Bench.Run -benchOut "$PWD/bench.json"
```

Both exit 0 on success and 1 if their argument is missing.

Tests, as CI runs them. No `-quit`: with `-runTests` the editor exits when the run ends, 0 only if
every test passed.

```sh
unity/Eternities/batchmode.sh -runTests -testPlatform EditMode -testResults "$PWD/editmode.xml"
unity/Eternities/batchmode.sh -runTests -testPlatform PlayMode -testResults "$PWD/playmode.xml"
```

Compile check, as CI runs it: open the project and quit. A compiler error is a non-zero exit.

```sh
unity/Eternities/batchmode.sh -quit
```

## CI

`.github/workflows/ci.yml`, jobs `unity-compile`, `unity-editmode`, `unity-playmode` and
`unity-bench-smoke`, on the self-hosted runner on the reference machine. They run on every pull
request that touches `unity/`. `docs/ci-runner.md` is how that runner is built and re-verified.
