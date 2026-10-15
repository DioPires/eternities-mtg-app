# The self-hosted runner on the reference machine

PRD v4 8.8.5 and 8.8.6. The Unity jobs of `.github/workflows/ci.yml` (`unity-compile`,
`unity-editmode`, `unity-playmode`, `unity-bench-smoke`) run on one GitHub Actions runner on the
reference machine (PRD v4 7.1.1), because they need a licensed editor, a window server and the GPU
the bench figures are quoted for. The runner is a launchd agent in the owner's own GUI session (PRD
v4 8.8.6, Amendment 1). This is the procedure that builds it, and the procedure for checking it
again after an update.

Files beside this document:

| File | What it is |
|---|---|
| `ci-runner/register-runner.sh` | Run once in the owner's session. Checks the fork approval policy, Git LFS, the editor and the licence; creates the registration token; installs and registers the runner; installs and starts the launchd agent. |
| `ci-runner/com.eternities.actions-runner.plist` | The launchd agent, as a template. The script writes the account's home directory into it and installs the result into `~/Library/LaunchAgents/`. |

## 1. This repository is public: read before registering

A workflow started by a pull request runs the workflow file **from that pull request**. On a public
repository that means a pull request from a fork can change `ci.yml` to run anything it likes on
`runs-on: [self-hosted, ...]`, which is this machine. No guard inside the workflow can prevent that,
because the fork controls the workflow.

A job on this runner runs as the account that registered it. In the owner's session that is the
owner, with the owner's files and credentials in reach. One thing contains it:

- **Fork pull requests do not run until the owner approves them** (step 3 below).
  `register-runner.sh` reads the setting on every run. While it is anything else the script
  registers nothing and starts nothing, and it stops a runner that is already installed. Nothing
  watches the setting between runs of the script: changing it back leaves the runner serving.
  Approving a run from a fork is approving its code to execute as the owner on the reference
  machine: read the diff first, `.github/` included.

Pull requests from branches of this repository are not held for approval. Whoever can push a branch
here can run code on the runner; today that is the owner and the agents, which already run every
pull request's code as the owner. A runner account of its own narrows what a job can reach and is
an optional step (section 8).

## 2. Procedure

Everything is done in the owner's account, logged in at the login window. Steps 1 and 3 are the
owner's. Steps 2, 4 and 5 need a shell in that session and a `gh` login that can read the
repository's Actions settings, so an agent can do them.

1. **Install the editor.** Install the Unity Hub (<https://unity.com/download>, Apple silicon),
   open it and sign in with the owner's Unity ID. In the Hub's settings, under Licenses, a Personal
   licence must be listed; if none is, Add, then "Get a free personal license". Unity 6 Personal
   activates through this sign-in, not by a licence file. Then install the exact editor the project
   is pinned to, which is the first line of `unity/Eternities/ProjectSettings/ProjectVersion.txt`:

   ```sh
   open "unityhub://6000.6.5f1/3ff58d469c8a"
   ```

   The Hub opens on that version's install dialog. Tick **Mac Build Support (IL2CPP)**, untick
   everything else, Install. Or, with the Unity CLI and no dialog (`--accept-eula` accepts the
   module's licence agreement):

   ```sh
   ~/.unity/bin/unity install 6000.6.5f1 --module mac-il2cpp --yes --accept-eula
   ```

   Either way the editor lands in `/Applications/Unity/Hub/Editor/<version>/`, which is where
   `unity/Eternities/batchmode.sh` and every job look for it. Windows Build Support (Mono) is not
   part of this recipe: the jobs build nothing for Windows, and the module is added with the first
   Windows build (PRD v4 8.9.1).

2. **Install Git LFS.**

   ```sh
   HOMEBREW_NO_AUTO_UPDATE=1 brew install git-lfs
   git lfs install
   ```

   Keep the variable. Without it Homebrew refreshes its formula index first and may then upgrade
   formulae that are already installed; an upgrade of `node` on this machine once stopped every
   agent run until its path was relinked.

3. **Require approval for every fork pull request** (section 1). Repository Settings, Actions,
   General, "Approval for running fork pull request workflows from contributors", choose "Require
   approval for all external contributors", Save. Or:

   ```sh
   gh api -X PUT repos/DioPires/eternities-mtg-app/actions/permissions/fork-pr-contributor-approval \
     -f approval_policy=all_external_contributors
   ```

4. **Register the runner.** From a clone of this repository:

   ```sh
   docs/ci-runner/register-runner.sh
   ```

   The script stops with a one-line reason if the fork approval policy, the GUI session, Git LFS,
   the editor or the licence is not as this procedure leaves them, or if the repository already
   has a runner registered. Otherwise it creates a registration token through `gh`, downloads the
   pinned runner release and checks its SHA-256, registers it as `reference-machine` in
   `~/actions-runner` with the work directory `~/actions-work`, installs the launchd agent and
   starts it. The clone is only read from; the runner does not depend on it afterwards.

   Creating the token needs a `gh` identity that administers the repository. If the script reports
   that it could not create one (the API answers 403), create it in repository Settings, Actions,
   Runners, "New self-hosted runner", copy the value after `--token`, and pass it as the script's
   argument. A token is valid for an hour and is a credential: do not paste it into an issue.

   Run again, the script leaves an existing registration alone and only reinstalls and reloads the
   agent. The reload stops a job in flight, so run it when the runner is idle. To register from
   scratch, do section 7 first.

5. **Verify.**

   ```sh
   gh api repos/DioPires/eternities-mtg-app/actions/runners \
     --jq '.runners[] | {name, status, labels: [.labels[].name]}'
   ```

   Exactly one runner, `"status": "online"`, labels `self-hosted`, `macOS`, `ARM64`,
   `reference-machine`. Then run the whole workflow by hand and wait for it. The ref has to be one
   whose `ci.yml` has the four `unity-*` jobs: `main`, once they have merged. The first command
   prints the URL of the run it created; the run id is the number that URL ends in.

   ```sh
   gh workflow run CI --ref main
   gh run watch --exit-status <run id>
   gh run view <run id> --json jobs \
     --jq '.jobs[] | select(.name | startswith("unity-")) | {name, conclusion}'
   ```

   The last command must print four rows, `unity-compile`, `unity-editmode`, `unity-playmode` and
   `unity-bench-smoke`, each with `"conclusion": "success"`. A run that exits 0 without them, or
   with one of them `skipped`, has verified nothing. Record the run in section 6. Each job imports
   the project from cold and takes a little over a minute; they run one after another.

## 3. What the jobs rely on

Each line is a property of the recipe that a job in `ci.yml` depends on. Change one here and the
workflow has to change with it.

- **A GUI session.** The agent is limited to the Aqua session type, so it runs only while the
  owner is logged in at the login window. `batchmode.sh` starts the editor with `-batchmode` and
  never with `-nographics`. `unity-playmode` proves the result rather than assuming it: its test
  fails if the editor reports a Null graphics device.
- **No launchd throttle.** The agent's process type is Interactive. Without it launchd throttles
  the CPU and I/O of the agent and of the editor it starts.
- **Runner concurrency 1.** One runner takes one job at a time, and this machine has one runner.
  That is the whole mechanism: a bench never shares the GPU with another job. Do not register a
  second runner here.
- **No other editor, player or Blender during a bench.** Before the bench, `unity-bench-smoke`
  waits while a process named `Unity` (the owner's editor, or an agent's batchmode run), a built
  player or a process named `Blender` is running. It looks every 15 s for up to 15 minutes, and
  each wait line names what it saw by pid and executable. If one is still running at the limit,
  the job fails: close it and re-run the job. A `pgrep` error fails the job too. The wait has three
  gaps. `unity-compile`, `unity-editmode` and `unity-playmode` have no gate. Nothing looks again
  after the gate passes. The gate does not see a player started by a relative path such as
  `./Eternities`, or by a path in another letter case, so a player starts through `bench.sh`. The
  gate sees Blender in any letter case: a Blender started by a lower-case path is named `blender`.
  `bench.sh` refuses to start while a process named `Unity` runs, or Blender in any letter case,
  or when `pgrep` fails.
- **Blender only when no job runs.** Make a derived binary again (PRD v4 8.12) only when no runner
  job runs. `unity/Eternities/Assets/Kits/temperate/derive.sh` waits for the runner before each
  Blender start, and the bench gate waits for Blender. A first look that falls in the gap between
  two jobs of one run finds no job, and Blender starts at once; the bench gate then waits for that
  Blender if the next job is `unity-bench-smoke`.
- **One workspace per job, in a directory of the runner's own.** Each job checks out into
  `~/actions-work/eternities-mtg-app/eternities-mtg-app/<job>/`. That is never an agent's checkout
  and never a project the owner has open in the editor, so a `Library` lock is never shared, and a
  job that dies cannot leave a lock in another job's project. The checkout removes ignored files,
  `Library/` included, so every job imports the project from cold and nothing is carried from one
  run to the next.
- **Git LFS, nothing excluded.** The jobs check out with `lfs: true`. `lfs.fetchexclude` must stay
  unset in the owner's git configuration; the script stops if it is set.
- **Labels.** The jobs ask for `[self-hosted, macOS, reference-machine]`.
- **No bypass.** If the runner is offline the jobs stay queued and the pull request waits (PRD v4
  8.8.5). Nothing in the workflow skips them for a pull request that touches `unity/` or one of the
  files its path filter names (`unity-changes` in `ci.yml`). The required checks on `main` bind
  administrators too: `enforce_admins` has been on since 2026-10-11 (DEC-966). A merge with the
  owner's token waits like any other, and agents merge with that token. GitHub fails a job that
  has waited 24 hours for a runner; re-run it once the runner is back.

## 4. Keeping it running

- The runner runs while the owner is logged in and the machine is awake. Logged out, it stops.
  After a restart, log in; the agent starts by itself.
- A sleeping machine runs nothing. Jobs queue and start when it wakes.
- Agent logs: `~/Library/Logs/actions-runner/`. Runner diagnostics: `~/actions-runner/_diag/`.
- Disk: a job's workspace keeps its `Library/` (2.1 GB for the skeleton) until that job's next
  checkout removes it, so the four workspaces hold about 9 GB under `~/actions-work` between runs.
- State of the agent: `launchctl print gui/$(id -u)/com.eternities.actions-runner`.

## 5. Re-verifying after an update

- **Unity.** An editor upgrade is a pull request that changes `ProjectVersion.txt` (and the pin
  table in `unity/Eternities/README.md`). Install the new editor first (step 1, with the new
  version); editors install side by side. The pull request's own `unity-*` jobs are the
  re-verification, and they fail with "is not installed" if the editor is missing. Remove the old
  editor in the Hub after the merge.
- **The runner.** The runner updates itself when GitHub requires it. The version in use is the
  first line of every job log ("Current runner version"). When it changes, repeat step 5 and record
  it below. To move the pinned version used for a fresh registration, change `RUNNER_VERSION` and
  `RUNNER_SHA256` in `register-runner.sh` from the release notes of `actions/runner`.
- **macOS.** A system upgrade can reset login items and privacy grants. Repeat step 5.

## 6. Verification record

| Date | Editor | Runner | Run | By |
|---|---|---|---|---|
| 2026-10-10 | `6000.6.5f1` | `2.338.0` | [38080691046](https://github.com/DioPires/eternities-mtg-app/actions/runs/38080691046), pull request #111: the four jobs `success`, 63 to 67 s each | Interactive Tools Engineer (agent), first registration |

Controls run the same day, each on a branch made for it and deleted afterwards:

| Control | Run | Result |
|---|---|---|
| A compile error | [38081132592](https://github.com/DioPires/eternities-mtg-app/actions/runs/38081132592) | `unity-compile` fails with `error CS1525`; the other three fail with it |
| A shader that does not parse, and `-nographics` on PlayMode | [38081134299](https://github.com/DioPires/eternities-mtg-app/actions/runs/38081134299) | `unity-compile` fails on `ConsoleCheck: 1 errors`; `unity-playmode` fails; `unity-editmode` and `unity-bench-smoke` pass |
| The run cancelled while `unity-changes` is in progress | [38081091826](https://github.com/DioPires/eternities-mtg-app/actions/runs/38081091826) | the four jobs end `cancelled`, not `skipped`, so a cancelled run does not read as passed |

## 7. Removing the runner

```sh
launchctl bootout gui/$(id -u)/com.eternities.actions-runner
rm ~/Library/LaunchAgents/com.eternities.actions-runner.plist
```

Then repository Settings, Actions, Runners, `reference-machine`, Remove, and delete
`~/actions-runner` and `~/actions-work`. Pull requests that need the `unity-*` jobs wait from that
moment until a runner with the same labels is registered again.

## 8. Optional hardening: a runner account of its own

Not applied, and not tried on this machine. PRD v4 8.8.6 first required it; Amendment 1 made it
optional.

- **What it buys.** A Standard (non-administrator) account cannot read the owner's files or use the
  owner's credentials. A fork run approved by mistake, or a compromised action, reaches that
  account and no further.
- **What it does not buy.** Isolation from the agents. They run every pull request's code as the
  owner already, so for the project's own pull requests the second account protects nothing that
  is not exposed without it.
- **What it costs.** The account has to stay logged in beside the owner's, and it needs a Hub
  sign-in of its own.

How it differs from section 2:

1. Remove the runner from the owner's account first (section 7). One runner on the machine.
2. Create the account and log in to it at the login window. `su` and `ssh` give no GUI session.

   ```sh
   sudo sysadminctl -addUser eternities-ci -fullName "Eternities CI" -password -
   ```

   Without `-admin` the account is Standard. To keep both accounts logged in: System Settings,
   Control Centre, Fast User Switching, "Show in Menu Bar".
3. In that account, sign in to the Unity Hub with the owner's Unity ID. The sign-in is per
   account; the editor install is not.
4. In that account, run `register-runner.sh` from a clone, with a token created in the owner's
   account as its argument. The script reads the fork approval policy through `gh`, so the account
   needs a `gh` login that can read the repository's Actions settings.
5. Step 5 of section 2, then confirm in the `unity-playmode` log that the editor got a graphics
   device: whether a session behind Fast User Switching gives it one is not known.
