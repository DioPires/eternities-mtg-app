# The editor bridge for the Unity work: evaluation

**Recommendation: go, as a trial on one issue. No-go as a standing tool.** The bridge is Unity's own
command-line bridge, run in batchmode on a project copy of its own, with 69 of its 160 tools
allowed. No session opens before the runner closes a session ahead of every job
(`docs/ci-runner.md` section 9) and a control run proves it. Coplay's "MCP for Unity", Unity's AI
Assistant server and `blender-mcp` are each a no-go.

DEC-960, the owner's pick 4 on DEC-950 (plan 12.11, finding 9; plan 12.12). Evaluated on 2026-10-12
on the reference machine (PRD v4 7.1.1), on `main` at `e79a195`, in a scratch clone outside the
agents' checkout and outside the runner's directories. The clone is deleted (section 8). Nothing
from a bridge is committed, and nothing under `unity/` changes.

A bridge here is a Model Context Protocol (MCP) server: a program an agent calls as tools, to ask a
running Unity editor for its scene, its Console and a picture, and to enter Play Mode.

Every fact below carries one of three marks.

- **Tested**: I ran it on 2026-10-12 and saw the result. Section 8 lists the versions and commands.
- **Read**: the named document or source file says so. I did not run it.
- **Not tested**: nobody here has run it. The note says why.

## 1. Which bridge

There are three candidates, not two. The Unity CLI that the agents already use for project work
(PRD v4 8.8.6) carries an MCP server of its own, and it is not the AI Assistant's.

### 1.1 Unity's AI Assistant server

- **What it is.** An MCP server inside the package `com.unity.ai.assistant`, reached through a relay
  binary under `~/.unity/relay/`. (Read: Unity's post of 2026-05-11.)
- **Version.** `2.20.0-pre.2`, published 2026-10-06, a pre-release. (Tested: the Unity registry.)
- **Pinned editor.** The registry entry asks for `6000.0.60f1` or later, which `6000.6.5f1` is.
  (Tested: the registry field, and one batchmode import on `6000.6.5f1`: exit code 0, no compiler
  error, 41 s.)
- **Licence and cost.** Unity's post lists, for this server, "A Unity project connected to Unity
  Cloud" and "An active trial or subscription to Unity's AI tools beta". Unity's product page, on
  2026-10-12, says of the Assistant on Unity Personal: a free trial "which converts to a $10/month
  subscription". The same page says "MCP server is free, with no concurrency limits and you do not
  need to purchase Unity's AI credits to use it. Install MCP server through CLI". That sentence is
  about the server of 1.2, not this one. (Read, both pages, checked word for word.)
- **What it exposes.** Scene management, script editing, Console access, GameObject inspection and
  build settings. The post names one tool, `Unity_ReadConsole`. (Read.)
- **A gate a person must pass.** The editor shows each new client as a pending connection, and a
  user accepts it in the editor's window. (Read.)
- **How far the test went.** One batchmode import of the package on the scratch copy. It compiled.
  It put a relay binary of 66 MB, signed by Unity, into the owner's `~/.unity/relay/`; the
  clean-up removed it. The licensing client logged three errors, "Found 0 entitlement groups and 0
  free entitlements matching requested entitlement ids", which the three editor logs without this
  package do not have. Started alone with `--mcp`, the relay answered as `unity-mcp-server 1.0.0`
  and listed no tool. (Tested, all four.) A live session is not tested. It needs a person to accept
  the client in the editor's window, and settling the entitlement means linking the owner's project
  to Unity Cloud or starting a trial on the owner's account. Both are the owner's to decide.

### 1.2 Unity's CLI bridge

- **What it is.** `unity mcp`, a stdio MCP server built into the `unity` binary, and the editor
  package `com.unity.pipeline`, which serves the editor's commands to it. The same commands answer
  to `unity command <name>` from a shell. (Tested: both forms.)
- **Version.** CLI `1.0.0-beta.12`, a beta; `1.0.0-beta.13` was offered during the test. Package
  `0.8.0-exp.1`, published 2026-09-25, marked experimental: its eighth version since `0.2.0-exp.2`
  on 2026-06-25. (Tested: `unity --version`, the registry.)
- **Pinned editor.** The package imports, compiles and serves on `6000.6.5f1` with the slice on
  `main`. The Console held no error: three warnings, none from the package. (Tested.)
- **Licence and cost.** The package's `LICENSE.md` puts it under the Unity Terms of Service, as the
  editor is. It ran under the Personal licence this machine holds (`unity license`: "Unity
  Personal, Assigned"), on a project with no Unity Cloud link (`cloudProjectId` empty,
  `cloudEnabled: 0`), with no AI package, no trial and no subscription. There is nothing to buy.
  (Tested.) Whether it needs the CLI's sign-in is not tested: the CLI here is signed in.
- **What it exposes.** 160 tools, each one action (section 2). (Tested: `tools/list`.)
- **How it runs.** In a resident batchmode editor: no window, no screen taken. Ready 69 s after a
  cold start on a fresh clone, package download and first import included; 4 s after a warm start.
  A call answers in 0.02 to 0.3 s. By the editor's own count, one resident editor reserves 1.3 GB in
  Play Mode and 1.8 GB once a camera renders. (Tested.)

### 1.3 Coplay's "MCP for Unity"

- **What it is.** The editor package `com.coplaydev.unity-mcp` and a Python server,
  `mcpforunityserver`, that an MCP client starts with `uvx`. (Read: the repository at `v10.3.0`.)
- **Version.** `v10.3.0`, released 2026-10-04. (Tested: the GitHub release list.)
- **Pinned editor.** `package.json` asks for Unity 2021.3 or later. The package imports and
  compiles on `6000.6.5f1` in one batchmode run: exit code 0, no compiler error, 33 s. (Tested.)
- **Licence and cost.** MIT, in the repository and in the server's `pyproject.toml`. No Unity
  account is involved, so the Personal licence is not in question. Nothing to buy. It adds a Python
  process, and its packages from PyPI (FastMCP, FastAPI, Uvicorn, HTTPX, Pydantic and what they
  need) run as the owner's user. (Tested: the server started from those packages.)
- **What it exposes.** 48 tools (Tested: `tools/list` on the server, started alone). Most hold
  several actions under one name. `manage_scene` holds `get_hierarchy` and `save`. `manage_editor`
  holds `play` and `stop`, and also `add_tag`, `deploy_package` and `undo`. `read_console` holds
  `get` and `clear`. Three tools run what the caller supplies: `execute_code`, `execute_menu_item`
  and `batch_execute`. One, `blender_bridge`, has an action `run_python`: the Unity bridge carries
  a Blender code path of its own. Four fetch or generate binary assets from outside services:
  `generate_audio`, `generate_image`, `generate_model` and `import_model`.
- **Telemetry.** On by default, to Coplay; `DISABLE_TELEMETRY=true` turns it off. (Read:
  `website/docs/architecture/telemetry.md`. The test ran with it off.)
- **How it is reached.** Over HTTP on `localhost:8080`, or over stdio with a bridge inside the
  editor that listens on the loopback address, port 6400 by default. The file that opens that
  listener greets a client and holds no check of a token or a password. (Read:
  `website/docs/architecture/transports.md` and `StdioBridgeHost.cs` at `v10.3.0`. Not tested.)
- **How far the test went.** The import above, and the server alone. A session in batchmode is not
  tested. The package's source starts no bridge in batchmode unless `UNITY_MCP_ALLOW_BATCH` is set,
  and its HTTP side then starts only if a preference of the editor, `AutoStartOnLoad`, is on.
  (Read: `HttpAutoStartHandler.cs`.) With the variable set and the owner's preferences as they
  are, the import started no bridge and left nothing in the owner's preferences or home directory.
  (Tested.) Turning that preference on changes the owner's editor, for a candidate that 1.5 rules
  out on other grounds.

### 1.4 The sources' claims

The four sources are in the CEO's comment of 2026-10-10 20:36Z on DEC-950.

| Claim | What the test found |
|---|---|
| Unity's own server needs the AI Assistant package, a Unity Cloud link and a Unity AI subscription or trial. | Unity's post says so of the Assistant's server (1.1). **Read**; a live session of that server is not tested. Unity's CLI bridge needs none of the three. **Tested.** |
| Unity has since moved its server into a command-line tool. | The command-line tool has a server: `unity mcp`, which the CLI's own reference dates to `0.1.0-beta.8`. **Tested.** Unity's product page now says "Install MCP server through CLI". **Read.** That the Assistant's server is gone is not shown: its package was published again on 2026-10-06 and still installs its relay. **Tested.** |
| Coplay's bridge is the likely fit for a Personal licence. | It fits, and so does Unity's CLI bridge, which was tested under Personal. |
| `blender-mcp` runs arbitrary Python as the owner's user. | Its own README says so (section 5). **Read**; it was not run. |

### 1.5 The choice

Unity's CLI bridge. Three reasons, in order of weight.

1. **One tool is one action.** Section 2 allows `get_scene_hierarchy` and denies `save_scene` by
   name. In Coplay's bridge both are actions of `manage_scene`, and Play Mode shares `manage_editor`
   with `deploy_package`. A list of tool names cannot allow the one and deny the other.
2. **It adds no second supplier.** The CLI and the editor are already on this machine, signed in and
   licensed. Coplay's bridge adds a Python server, its PyPI packages and a telemetry default to
   turn off.
3. **Its port asks for a token.** Section 5 has the test. Coplay's stdio bridge opens a loopback
   port with no credential in the file that opens it (1.3; read, not tested).

What speaks against it: it is a beta driving an experimental package, and both move. The CLI told
the agent to update it on the first call (section 5). One tool, `quit`, failed with a defect of the
package (section 2). The trial pins the package version and re-tests after any change of either.

## 2. Tool allowlist

The table covers every tool `unity mcp` listed against the scratch editor: 160 tools, 69 allowed and
91 denied. A script built it from the saved `tools/list` answer and stops if a tool has no row or
two. (Tested.) The tools carry no read-only mark of their own (`annotations` is empty on all 160),
so each verdict below is mine, from the tool's description, and from a call where section 8 lists
one.

The frame is the issue's. Reads: the scene and its components, the Console, pictures, Play Mode.
Writes: the issue allows them only to assets an engineer already authors by hand as text, never to
a generated scene. The smallest adoption allows no write at all, for the reason in row 14.

| # | Verdict | Tools | Reason |
|---|---|---|---|
| 1 | Allowed (6) | `find_gameobjects`, `get_component_properties`, `get_scene_hierarchy`, `get_selection`, `get_serialized_fields`, `list_open_scenes` | Reads the open scene or its objects; changes nothing. |
| 2 | Allowed (13) | `find_assets`, `get_animation_clip`, `get_animator_controller`, `get_import_settings`, `get_material_properties`, `get_shader_properties`, `get_timeline`, `list_shaders`, `package_list`, `package_search`, `package_status`, `read_text_file`, `search` | Reads an asset or the package list; changes nothing. |
| 3 | Allowed (15) | `get_audio_settings`, `get_authoring_root`, `get_build_settings`, `get_graphics_settings`, `get_input_settings`, `get_lighting_settings`, `get_navmesh_settings`, `get_physics_settings`, `get_player_settings`, `get_quality_settings`, `get_runtime_pipeline_settings`, `get_tags_layers`, `get_time_settings`, `list_build_profiles`, `list_build_targets` | Reads a project setting; changes nothing. |
| 4 | Allowed (17) | `audit_status`, `build_status`, `codereload_status`, `console`, `console_status`, `editor_status`, `get_performance_stats`, `lighting_bake_status`, `list_tests`, `navmesh_bake_status`, `occlusion_bake_status`, `recompile_status`, `report_evals`, `runtime_status`, `switch_build_target_status`, `test_status`, `wait_status` | Reads the Console or a status; changes nothing. |
| 5 | Allowed (3) | `editor_pause`, `editor_play`, `editor_stop` | Enters, pauses or leaves Play Mode. Play Mode runs the project's code as the owner's user (section 5). |
| 6 | Allowed (3) | `capture_game_view`, `capture_scene_view`, `screenshot` | Writes a picture and nothing else. The output path stays outside every git checkout. |
| 7 | Allowed (7) | `clear_console`, `log`, `open_scene`, `recompile`, `set_autotick`, `wait_cancel`, `wait_for` | Changes the session only: what is loaded, what the Console buffer holds, how the editor ticks. Nothing reaches a file under `Assets/`, `Packages/` or `ProjectSettings/`. |
| 8 | Allowed (2) | `simulate_key`, `simulate_pointer` | Sends input to the game in Play Mode; it runs the project's own code and writes nothing. |
| 9 | Allowed (2) | `cancel_tests`, `run_tests` | Runs or cancels the project's tests in the copy: the code an agent already runs through `batchmode.sh`. A result from the copy is not a proof; CI is. |
| 10 | Allowed (1) | `quit` | Closes the editor. Closing is always allowed. |
| 11 | Denied (7) | `cleanup_codereload`, `eval`, `eval_file`, `reload_file`, `reload_file_editor_interpreter`, `reload_file_player_interpreter`, `run_script` | Runs code the caller supplies, as the owner's user. An allowlist by tool name means nothing beside it. |
| 12 | Denied (2) | `batch`, `menu` | Reaches every other tool or every editor menu item, the save and delete items included, so it passes any tool that is denied. |
| 13 | Denied (25) | `add_component`, `add_scene_to_build`, `apply_prefab_overrides`, `attach_script`, `create_gameobject`, `create_gameobjects`, `create_scene`, `delete_gameobject`, `instantiate_prefab`, `remove_component`, `remove_scene_from_build`, `rename_gameobject`, `revert_prefab_overrides`, `save_all`, `save_scene`, `set_active`, `set_active_scene`, `set_component_properties`, `set_layer`, `set_parent`, `set_selection`, `set_serialized_field`, `set_tag`, `set_transform`, `unpack_prefab` | Writes a scene or its objects. A generated scene is never edited by hand (PRD v4 8.2.5), and the scene is what the generation entry point reproduces for the reviewer. |
| 14 | Denied (25) | `add_animator_layer`, `add_animator_parameter`, `add_animator_state`, `add_animator_transition`, `add_timeline_clip`, `add_timeline_track`, `copy_asset`, `create_animation_clip`, `create_animator_controller`, `create_asset`, `create_folder`, `create_prefab`, `create_prefab_variant`, `create_script`, `create_timeline`, `delete_asset`, `import_asset`, `move_asset`, `remove_animation_curve`, `rename_asset`, `save_prefab_contents`, `set_animation_curve`, `set_import_settings`, `set_material_properties`, `write_text_file` | Writes an asset file at a path the caller gives. The tool cannot tell a hand-authored asset from a generated one, and its only guard is a `confirm` flag the caller sets. An engineer writes text in the worktree. |
| 15 | Denied (15) | `set_audio_settings`, `set_authoring_root`, `set_build_settings`, `set_graphics_settings`, `set_input_settings`, `set_lighting_settings`, `set_navmesh_settings`, `set_physics_settings`, `set_player_settings`, `set_quality_settings`, `set_runtime_pipeline_settings`, `set_tags_layers`, `set_target_framerate`, `set_time_settings`, `set_timescale` | Writes a project setting under `ProjectSettings/`, or moves the folder the write tools are confined to. A settings change is a reviewed text change (PRD v4 7.6.3, 7.6.4). |
| 16 | Denied (3) | `package_add`, `package_remove`, `package_resolve` | Changes the package set. Every package is pinned in the manifest and changes by a reviewed pull request (PRD v4 7.6.3). |
| 17 | Denied (13) | `audit`, `bake_lighting`, `bake_navmesh`, `bake_navmesh_surfaces`, `bake_occlusion_culling`, `build`, `cancel_lighting_bake`, `cancel_navmesh_bake`, `cancel_occlusion_bake`, `clear_baked_lighting`, `clear_navmesh`, `clear_occlusion_culling`, `switch_build_target` | Starts a build, a bake, a target switch or a scan: minutes of the machine's processor and GPU that a job on the runner may need, and baked data is a binary asset (PRD v4 7.6.4). |
| 18 | Denied (1) | `editor_focus` | Brings the editor window to the front of the owner's screen. A session has no window (section 3). |

Four things the table does not say by itself.

- **The four purposes map to rows 1, 4, 5 and 6.** Rows 2, 3 and 7 to 10 are what those need in
  practice: a scene has to be opened before it is read, and a batchmode editor has to be told to
  keep ticking.
- **Pictures need one thing no allowed tool gives.** In a batchmode editor nothing draws the game
  view. `capture_game_view` then fails with "No Game view render target to capture", and with
  `source: "camera"` it returns a picture that is white from edge to edge. Six pictures were
  white: five from it and one from `screenshot`. After the main camera was given an off-screen
  target, as the project's bench harness does in `BenchRunner.cs`, the next picture showed the
  hub: the sky, the avatar and a portal. The first camera picture took 25 s and each later one
  under 0.1 s. (Tested.) The test set that target with `eval`, which row 11 denies. The trial
  needs it without `eval`: two lines in the project, behind a command-line switch, as a reviewed
  change of its own.
- **`quit` is allowed and does not work.** In Edit Mode it failed with "DontDestroyOnLoad can only
  be used in play mode", an error of the package. (Tested.) `unity close <project>` closes the
  editor in 3.8 s, and `kill` in under one. (Tested, both.)
- **The list is a rule, not a wall.** An agent with a shell can call any of the 160 with
  `unity command`. Two things make the rule hold. The workspace (section 3): nothing in the copy is
  ever committed, so a denied write that happens anyway reaches no branch. And the client: Claude
  Code denies a named MCP tool by a rule in `.claude/settings.json`, a text file a reviewer reads.
  (Not tested: this run could not add a server to its own session.) The trial commits that file
  with the 91 names.

A later decision may open writes inside the issue's frame. The candidates are in row 14 and 15:
`write_text_file`, `create_script`, `save_prefab_contents`, `set_material_properties` and the
`set_*_settings` tools. Each takes a path, and the bridge confines it only to `Assets` (Tested:
`get_authoring_root` answers "Assets"), which holds the generated scene and the generated materials
too. `write_text_file` on `Scenes/Hub.unity`, the generated scene, was refused only for want of
the caller's flag: "A file already exists at 'Assets/Scenes/Hub.unity'. Pass confirm=true to
overwrite it." (Tested; the file was not changed.) Until a tool can tell the two apart, a write
stays a text change in the worktree.

## 3. Workspace isolation

A session opens a clone of its own. It is never the runner's workspace, never an agent's worktree
and never a project the owner opens, so no `Library` lock is shared with any of them.

- **The path.** `~/eternities-bridge/eternities-mtg-app/`, with the project at `unity/Eternities/`
  inside it, beside the runner's `~/actions-runner` and `~/actions-work`. `~` is the home directory
  of the account the runner runs in.
- **How it is made.** Once, with `git clone file://<the agents' checkout>`. The clone reads Git LFS
  objects from the checkout it was cloned from. (Tested at the evaluation's path: the 24 LFS files
  present, and the project imported.)
- **How it is refreshed.** At the start of every session, from the last local commit of the branch
  under work: `git fetch origin <branch>`, `git checkout --force --detach FETCH_HEAD`, then
  `unity pipeline install --project-path <project> --package-version <pin>`. (Tested at the
  evaluation's path: a refresh to another agent's local branch took 1.2 s, and the editor was
  serving about 9 s after its start.)
- **The package stays in the copy.** `unity pipeline install` changes `Packages/manifest.json` and
  `Packages/packages-lock.json` in the copy and nothing else that git tracks. (Tested: `git status`
  after a whole session, the generation entry point included, showed those two files only.) `main`
  never carries the package, so no build of the product can hold a bridge.
- **Nothing leaves the copy.** No commit and no push is made from it. Text an engineer changes is
  changed in the worktree and reaches the copy at the next refresh.
- **One session on the machine.** A lock directory, `~/eternities-bridge/session/`, made with
  `mkdir`. (Not tested as a lock; the evaluation ran one session at a time by hand.)

The generation entry point (PRD v4 8.2.5) is not replaced. A session runs it from the command line
before the editor starts. The test ran it through the bridge's `menu` tool, which worked and which
row 12 denies.

## 4. Lock protocol with the runner

The protocol is `docs/ci-runner.md` section 9, added by the same pull request and marked there as
not applied. Its three parts, in short:

- **The trigger.** A session is closed before its agent pushes anything, before its agent hands
  back, when the issue thread names a reviewer's bench or an editor slot of the owner's, and after
  thirty minutes at most. A reviewer or the owner who finds a session in the way closes it without
  asking.
- **The check.** Before a session starts: `pgrep -x Unity` prints nothing, `pgrep -x Runner.Worker`
  prints nothing, the Actions queue has no run that is not completed, and the lock directory can be
  made. A watch repeats the second and third while the session lives.
- **The failure path.** If a job starts while a session is open, the runner closes the session
  before the job's first step; if that fails the watch closes it; if that fails the bench job fails
  on its own check, and the session's agent closes the session and re-runs the job.

PRD v4 8.8.6 is not weakened. The job's check is untouched and no job waits for a session. Only
the session changes: it is built to be closed. The runner's script closes editors under
`~/eternities-bridge/` and no other, so an editor of the owner's or a batchmode run of an agent's
still fails the bench as it does today.

What the evaluation measured for it. (Tested, all five.)

1. **The window is seven seconds.** During the test another agent pushed to its pull request. Run
   [38262725056](https://github.com/DioPires/eternities-mtg-app/actions/runs/38262725056) was
   created at 14:24:51Z. `unity-bench-smoke` was the first of the four jobs the runner took, at
   14:25:02Z, and its check for a Unity process ran at 14:25:09Z.
2. **The evaluation missed that push by 21 seconds.** Its editor closed at 14:24:30Z. Had it been
   open, with no watch, that pull request's bench job would have failed. No rule an agent keeps by
   itself covers another agent's push.
3. **A watch closes a session inside the window.** A two-second watch on the runner's worker
   process closed the editor in the same second it fired, with `kill`.
4. **The watch's first form was wrong.** It matched `Runner.Worker` against whole command lines
   and closed the session when a shell of mine held those words. `pgrep -x`, which matches the
   process name, is the form in section 9.
5. **The runner's script closes a session and nothing else.** With a session open and the script
   pointed at another directory, it closed nothing: the editor and its import worker stayed alive.
   Pointed at the session's directory, it closed both and returned in 0.1 s. A `kill` leaves the
   token file behind; the next start rewrites it. The script was run by hand, not by the runner.

Not tested: the runner calling that script before a job (the adoption's control run proves it),
the lock directory, the watch's rule for an editor of the owner's, and two sessions at once.

## 5. Security

The repository is public and the runner is this machine. A job on the runner, an agent's shell and
a bridge session all run as the owner's user. The bridge therefore gives an agent no reach it lacks:
an agent already runs project code as the owner with `batchmode.sh`. What the bridge adds is a
listening port and a faster way to do it. Each point below is about one of those two.

- **How it is reached.** The editor listens on `127.0.0.1:7800` and on no other address for the
  bridge. A plain batchmode editor with no bridge already listens on `*:55504` and `*:34999`, the
  editor's own ports; the bridge adds only the loopback one. (Tested: `lsof` on both editors.)
- **The token.** A request with no token gets 401, with a wrong token 401, with the token 200, and
  with the token and an `Origin` header 403, which shuts out a web page. The token is 256 bits,
  made at start, kept in `Library/Pipeline/.unity-pipeline-port` with mode 0600, and the file is
  removed when the editor closes. (Tested: the four answers, the mode and the removal. Read: the
  size, in the package's `connectivity.md`.)
- **A CI job.** A job runs as the owner's user on this machine, so it can read that file. The token
  does not keep a job out; the lock protocol does. No session is alive while a job runs, so there
  is no port to reach and no file to read. A job cannot start a bridge of its own either: the
  package is in no manifest that a job checks out. A pull request that adds `com.unity.pipeline` to
  `Packages/manifest.json` is refused in review, and a fork's pull request runs nothing here until
  the owner approves it (`docs/ci-runner.md` section 1).
- **What a Play Mode entry executes.** The project's code, in the editor's process, as the owner's
  user: an `eval` call in the test answered with the owner's user name. (Tested.) That is the code
  of the branch the copy was refreshed from, the same code `unity-playmode` runs. A session is
  never refreshed from a fork's branch.
- **What the bridge can execute beyond that.** Anything: `eval`, `eval_file` and `run_script`
  compile and run C# the caller supplies. Rows 11 and 12 deny them. I found no switch in the
  package that turns them off at the server. (Read: its documents and settings, searched for one.)
- **Instructions that arrive through the bridge.** The server's first answer told the client to
  update the CLI: "Always use the latest version of the Unity CLI", then "run unity self-update
  once they approve". The CLI's own guide tells an agent to drive a live editor "instead of
  hand-editing scene or asset files", which is the opposite of PRD v4 7.6.4 and 8.2.5. (Tested:
  both texts were returned to this run, which followed neither.) An agent treats what a bridge
  returns as data. It does not update the CLI or install its skill or plugin; a CLI update is an
  issue of its own, because PRD v4 8.8.6 keeps the CLI out of the required jobs for being unpinned.
- **Analytics.** The package reports command names, durations and failures through the editor's own
  analytics, with no parameters, code or paths, and the editor's opt-out applies. (Read: the
  package's `analytics.md`.) On this machine `unity analytics status` prints `true`. (Tested.)
  Whether to turn either off is the owner's choice.

### `blender-mcp`

Off. It is not installed, not configured for any agent and was not run. Its own README gives the
reasons. (Read: `ahujasid/blender-mcp`, default branch, 2026-10-12.)

- Its tool `execute_blender_code` "allows running arbitrary Python code in Blender".
- Its socket, on `localhost:9876`, "has no authentication or encryption, so anyone who can reach
  that port can run Python inside Blender". Any process of the owner's user can reach it, a job on
  the runner included. The Unity bridge's port asks for a token; this one asks for nothing.
- A safe mode that checks each script exists and is off unless `BLENDER_MCP_SAFE_MODE=1` is set.
- It fetches models and textures from Poly Haven, Sketchfab and Poly Pizza and from generation
  services. Each such file is a binary asset that enters only with its `CREDITS.md` row (PRD v4
  8.12.2).

No engineer has a use for it: engineers do not author binary assets (PRD v4 7.6.4), and whether one
may script a model in Blender is a decision the plan left open (12.11, finding 4), not this note's.
Coplay's bridge would bring the same thing in by another door, its `blender_bridge` tool with
`run_python`, which is one more reason against it.

It could be turned on under these conditions, all of them, and only by the owner, for the owner's
own modelling (PRD v4 8.12.3):

1. the runner is stopped for the length of the Blender session
   (`launchctl bootout gui/$(id -u)/com.eternities.actions-runner`), so no job runs beside the open
   port, and started again after Blender is closed;
2. `BLENDER_MCP_SAFE_MODE=1` and `DISABLE_TELEMETRY=true` are set;
3. it is configured in the owner's own client, never in an agent's;
4. anything it downloads gets its `CREDITS.md` row before it is committed.

An engineer's use needs an amendment of PRD v4 7.6.4 first.

## 6. Cost and benefit

The record is DEC-953: the slice engineer's twelve notes for DEC-960 in its day logs, and its
hand-back of 2026-10-12 09:09Z ("56 commits, 277 files, 25,283 lines added", "30 hours into the
five days"). The notes are the engineer's; the last column is this evaluation's.

| Log (UTC) | What the engineer lacked | Would this bridge have given it? |
|---|---|---|
| 10-10 22:50 | "A top-down image of the 824 m wheel" | No. No allowed tool places a camera; the picture comes from a camera the scene has. A capture from above in the bench harness gives it with no bridge. |
| 10-10 23:17 | "nothing blocking today"; a scene view "would have shortened the search for the 8,500 fps bug" | Yes. The live hierarchy and a component's values in Play Mode answer in 0.02 to 0.3 s (Tested). The engineer found the bug without, from a test's message. |
| 10-11 01:12 | "a frame debugger" for a magenta first frame | No. None of the 160 tools is a frame debugger. |
| 10-11 02:52 | "a view from above" of the prop scatter | No, as the first row. |
| 10-11 04:09 | "the frame debugger and the profiler": "four commits and three runs of six minutes" | No. `get_performance_stats` gives the editor's draw counts and frame times (Tested), not a GPU profile, and the figures were the player's. |
| 10-11 09:34 | "the Inspector", to check a label or a menu for the owner's task list; moving water | In part. Property names can be read; the Inspector's labels were not tested. A picture is a still. |
| 10-11 11:34 | "nothing a bridge gives. The ground was missing in the player, and the editor is where it was present." | No. A bridge shows the editor. |
| 10-11 18:08 | "a pointer"; a build's frame without taking the screen | Not shown. One `simulate_key` press did not move the avatar in batchmode (Tested); `simulate_pointer` was not tested. The build's frame: no. |
| 10-11 20:23 | "a profiler": "Three builds and four runs, about half an hour, to name one frame"; moving pictures | No. |
| 10-11 21:20, 21:21 | "a material inspector and a viewport": leaves almost black, "seven minutes and one wrong fix"; "Each look at a change of shading was a build and a two-minute run on the locked screen" | Yes. `get_material_properties` returns a material's shader, keywords and every property in 0.1 s, and a picture from the editor takes under a second with no window and no locked screen (Tested, both, on the slice's materials, not on that fault). |
| 10-12 03:09 | "a profiler, again"; "the editor's Player Settings in front of me" | In part. `get_player_settings` reads them (Tested); the fault was in a preferences file of the player. |

**What the slice engineer would have saved.** Two of the eleven rows are a yes and two are in part.
The record puts a figure on one of them, seven minutes, and names one wrong task for the owner and
one commit behind the Inspector row. The second yes is the one that grows: every look at a shading
change cost a build and a two-minute run on the locked screen, and the locked screen is the owner's
to give. The record does not count those looks.

**What it would not have saved.** The three costly episodes were about the player's frame and the
profiler: the builds with no ground voided "trials 1 to 5, both price lists, the fog by quality
level"; the profiler rows cost four commits and three runs, then three builds and four runs. A
bridge reaches none of them. Six of the twelve notes name pictures as a thing the engineer did not
lack: the capture artefact of the bench job and the frames its tests write already gave them. The
Console came from the batchmode logs. After the builds with no ground the engineer wrote "I now look
at every build's pictures" (2026-10-11 18:08Z), and the README states why: "CI's captures are the
editor's and say nothing about what a player draws". A bridge's pictures are the editor's too.

**What it costs.**

- **Setup:** one issue of about half a day. The runner's script and its control run; the session
  script with the watch; the two lines that give a batchmode editor its picture; the committed
  permission file. Each is a reviewed change, and the picture switch is a change under `unity/`.
- **Each session:** the check, a refresh and a start: about ten seconds warm and seventy cold
  (Tested), and the same again after every close. A push by any agent closes it, and the four
  Unity jobs then hold the machine for about twelve minutes (DEC-953, 2026-10-11 08:26Z).
- **The risk:** a session that outlives its window turns another agent's pull request red until the
  job is re-run. The evaluation came within seconds of it (section 4). The runner's script is what
  removes that risk, which is why it comes first.
- **The upkeep:** a beta and an experimental package. An update of either can change the tool
  list, and the allowlist is then re-made from `tools/list` and reviewed again.

**The balance.** For the slice as it ran, the bridge would have paid back little: minutes that the
record counts, against half a day of setup. The case for it is ahead, not behind. The slice ended on
an artistic miss, and the kits of Wave 5 are shading and dressing work, the one kind of work where
the record shows a look costing a build and the owner's locked screen. That is a reason to try it
on one such issue and count, and not a reason to give it to every issue.

## 7. Recommendation

**Go, as a trial of the smallest adoption. No-go as a standing tool.**

1. **Before any session:** one adoption issue installs `docs/ci-runner.md` section 9 on the runner
   and passes its control run (9.5), pins the package version, adds the picture switch and commits
   the permission file. The CEO assigns it and its reviewer. If the control cannot show the runner
   closing a session before the bench job's check, the answer becomes no-go and the script is
   removed.
2. **Which agents:** the implementer of the trial issue, one session at a time. Never a reviewer:
   the reviewer's draw is a bench (PRD v4 8.8.7), and a session is what a bench must not meet.
3. **Which issues:** one, named by the CEO: the first Wave 5 issue that changes how a world looks
   (a kit's dressing or its shading). Not layout or allocator work, which the slice engineer
   iterated "in two seconds a round, with no Unity process".
4. **Which tools:** rows 1 to 10 of section 2 and no write. Through `unity mcp`, so that the
   permission file applies; `unity command` is the same list for a client with no MCP.
5. **How it ends:** the trial issue's day logs keep the slice's "editor bridge" note, now with
   counts: sessions, looks, what a look showed that the capture artefact did not, and minutes lost
   to closes. At its hand-back the CEO keeps the bridge for the next such issue or removes the
   script and the directory. Without those counts the default is to remove it.

**The case against, so it can be weighed.** The record shows no need that only a bridge meets. A
capture from above in the bench harness answers two of the eleven rows with no resident editor and
no protocol. The machine's one GPU and one session are already shared by the runner, the owner and
the agents, and DEC-953 logs waits and overlaps without a bridge (2026-10-11 08:05Z and 11:33Z, for
two). The software is a beta whose own guide argues against this project's text-first rule.
"No-go, and add the capture from above" is a sound answer too. The trial is recommended over it
for one reason: the look work is still ahead, and half a day is a small price to learn whether a
one-second look changes it.

Three more answers are no-go:

- **Coplay's "MCP for Unity":** its tools cannot be allowed by name (1.5), and it brings a Blender
  code path with it.
- **Unity's AI Assistant server:** the CLI bridge covers the four reads with no cloud link, no
  subscription to settle and no click in a window.
- **`blender-mcp`:** off (section 5).

## 8. What was run, and the clean-up

Versions: editor `6000.6.5f1`, Unity Personal; Unity CLI `1.0.0-beta.12`; `com.unity.pipeline`
`0.8.0-exp.1`; Coplay `v10.3.0` (`mcpforunityserver` 10.3.0 on Python 3.13, telemetry off);
`com.unity.ai.assistant` `2.20.0-pre.2`. The MCP client was a script that speaks the stdio
protocol: `initialize`, `tools/list`, `tools/call`.

| What | Result |
|---|---|
| Scratch clone at `/Users/dpires/eternities-bridge-eval-dec960`, `main` at `e79a195`, by `git clone file://` | 24 LFS files real; project 40 MB before import |
| `unity pipeline install --package-version 0.8.0-exp.1` on the clone | manifest and lock file changed, in the clone only |
| Pinned editor, `-batchmode`, no `-quit`, on the clone | serving 69 s after a cold start, 4 s after a warm one; `127.0.0.1:7800` |
| `tools/list` through `unity mcp` | 160 tools, `annotations` empty on each |
| `menu` (Eternities/Generate), `open_scene`, `get_scene_hierarchy`, `console`, `console_status`, `editor_status`, `list_open_scenes`, `get_authoring_root` | each answered; the generation logged Dominaria at 824.18 m across, as DEC-953 has it |
| `editor_play`, `editor_stop`, `set_autotick`, `find_gameobjects`, `get_component_properties`, `get_serialized_fields`, `get_performance_stats`, `simulate_key` | each answered; nine scene roots in Play Mode; the key press moved nothing |
| `capture_game_view`, `capture_scene_view`, `screenshot` | no game view and no Scene view in batchmode; six camera pictures white; one correct after `eval` gave the camera a target |
| `eval`, once | ran C# as the owner's user; the package logged the call in `Library/Pipeline/eval-usage.jsonl` |
| `quit`; `unity close`; `kill` from the watch | failed with a package error; closed in 3.8 s; closed in under 1 s |
| The port with no token, a wrong token, the token, the token and an `Origin` header | 401, 401, 200, 403 |
| Coplay's server alone, `tools/list` over stdio | 48 tools |
| One batchmode import with `com.coplaydev.unity-mcp` at `v10.3.0`, `UNITY_MCP_ALLOW_BATCH=1` | exit code 0, no compiler error, 33 s; no bridge started; nothing left in the owner's preferences or home |
| One batchmode import with `com.unity.ai.assistant` `2.20.0-pre.2` | exit code 0, no compiler error, 41 s; a relay binary installed in `~/.unity/relay/`; three licensing errors |
| The relay binary alone, `--mcp`, `tools/list` | `unity-mcp-server 1.0.0`, no tool |
| A refresh of the clone to another local branch, the package added again, the editor started | 1.2 s; serving about 9 s after the start |
| `get_material_properties`, `get_player_settings`, `write_text_file` on `Scenes/Hub.unity` without `confirm` | the two reads answered; the write was refused and the file unchanged |
| The runner's script by hand, with another root and with the session's | closed nothing; closed the editor and its import worker in 0.1 s |

Two things the evaluation did while another Unity process was alive. Another agent's batchmode
test run started in the same seconds as the first session, and both ran side by side for about two
minutes; neither was a bench. And the next session was held back for 16 minutes, until 14:40:50Z,
while run 38262725056 held the runner: no bridge ran beside a self-hosted job.

Clean-up, checked at the end:

- The scratch clone, `/Users/dpires/eternities-bridge-eval-dec960` (2.5 GB with its `Library/`):
  removed. No `~/eternities-bridge*` exists.
- The relay binary that the Assistant package put in `~/.unity/relay/`: removed. `~/.unity` holds
  what it held before: `bin`, `env`, `env.fish` and `run`.
- Coplay's package left no key in the editor's preferences and no directory in the owner's home.
  Its server's packages were kept in the run's own scratch directory and removed with it.
- No Unity process of the evaluation is alive, and nothing listens on port 7800.
- Nothing was installed on the runner. `~/actions-runner` was read (its file list and the names in
  `.env`), not changed.
- One trace stays. The editor's own "last project" preferences (`LastUsedProjectPath`,
  `kProjectBasePath`, `kWorkspacePath`) name the removed clone until the next Unity start on this
  machine rewrites them, as every start does.
- `main` has no change under `unity/`: the pull request changes `docs/mcp-evaluation.md` and
  `docs/ci-runner.md` and nothing else.
