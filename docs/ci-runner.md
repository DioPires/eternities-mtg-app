# The self-hosted runner on the reference machine

PRD v4 8.8.5 and 8.8.6. The Unity jobs of `.github/workflows/ci.yml` (`unity-compile`,
`unity-editmode`, `unity-playmode`, `unity-bench-smoke`) run on one GitHub Actions runner on the
reference machine (PRD v4 7.1.1), because they need a licensed editor, a window server and the GPU
the bench figures are quoted for. This is the procedure that builds that runner from a fresh macOS
account, and the procedure for checking it again after an update.

Files beside this document:

| File | What it is |
|---|---|
| `ci-runner/register-runner.sh` | Run once in the runner account. Checks the account, Git LFS, the editor and the licence; installs and registers the runner; installs and starts the launchd agent. |
| `ci-runner/com.eternities.actions-runner.plist` | The launchd agent. Installed by the script into `~/Library/LaunchAgents/`. |

## 1. This repository is public: read before registering

A workflow started by a pull request runs the workflow file **from that pull request**. On a public
repository that means a pull request from a fork can change `ci.yml` to run anything it likes on
`runs-on: [self-hosted, ...]`, which is this machine. No guard inside the workflow can prevent that,
because the fork controls the workflow. Two things contain it, and both are part of the recipe:

- **Fork pull requests do not run until the owner approves them** (step 3 below). Approving a run
  from a fork is approving its code to execute on the reference machine: read the diff first,
  `.github/` included.
- **The runner account is a Standard account**, not an administrator. A job can do what that
  account can do and no more. That is still two things worth having: the account is signed in to
  the Unity Hub with the owner's Unity ID (step 5) and holds the runner's registration credentials,
  and the runner is persistent, so a job can also leave files behind for the jobs after it. The
  account limits the damage; the approval is what prevents it.

## 2. Procedure

Each step says which account it is done in: the owner's, which is an administrator, or the runner's.

1. **Install the editor** (owner's account). Install the Unity Hub (<https://unity.com/download>,
   Apple silicon), open it and sign in with the owner's Unity ID. In the Hub's settings, under
   Licenses, a Personal licence must be listed; if none is, Add, then "Get a free personal
   license". Unity 6 Personal activates through this sign-in, not by a licence file. Then install
   the exact editor the project is pinned to, which is the first line of
   `unity/Eternities/ProjectSettings/ProjectVersion.txt`:

   ```sh
   open "unityhub://6000.3.26f1/de8167e7440c"
   ```

   The Hub opens on that version's install dialog. Tick **Mac Build Support (IL2CPP)** and
   **Windows Build Support (Mono)**, untick everything else, Install. The editor lands in
   `/Applications/Unity/Hub/Editor/<version>/`, which is where `unity/Eternities/batchmode.sh` and
   every job look for it. One install serves every account on the machine.

2. **Install Git LFS** (owner's account).

   ```sh
   HOMEBREW_NO_AUTO_UPDATE=1 brew install git-lfs
   git lfs install
   ```

3. **Require approval for every fork pull request** (owner's account; section 1). Repository
   Settings, Actions, General, "Approval for running fork pull request workflows from
   contributors", choose "Require approval for all external contributors", Save. Or:

   ```sh
   gh api -X PUT repos/DioPires/eternities-mtg-app/actions/permissions/fork-pr-contributor-approval \
     -f approval_policy=all_external_contributors
   ```

4. **Create the runner account** (owner's account) **and log in to it.** The short name is fixed:
   the launchd agent carries absolute paths under `/Users/eternities-ci`.

   ```sh
   sudo sysadminctl -addUser eternities-ci -fullName "Eternities CI" -password -
   ```

   It prompts for the new account's password. Without `-admin` the account is Standard, which is
   what section 1 wants. Then System Settings, Control Centre, Fast User Switching, "Show in Menu
   Bar", and switch to **Eternities CI** from the menu bar. This has to be a login at the login
   window. `su` and `ssh` give a shell with no GUI session; the agent is limited to that session
   type and the script refuses to go on without one.

5. **Sign in to the Hub** (runner account). Open the Unity Hub, sign in with the owner's Unity ID
   and check Licenses as in step 1. The sign-in is per account; the editor install is not, so there
   is nothing to install here.

6. **Register the runner.** Create a registration token in the owner's account (it expires after an
   hour, and it is a credential: do not paste it into an issue):

   ```sh
   gh api -X POST repos/DioPires/eternities-mtg-app/actions/runners/registration-token --jq .token
   ```

   or repository Settings, Actions, Runners, "New self-hosted runner", and copy the value after
   `--token`. Then, in the runner account, in Terminal:

   ```sh
   git clone --depth 1 https://github.com/DioPires/eternities-mtg-app ~/eternities-setup
   ~/eternities-setup/docs/ci-runner/register-runner.sh <token>
   ```

   The script stops with a one-line reason if the account, the GUI session, Git LFS, the editor or
   the licence is not as this procedure leaves them. Otherwise it downloads the pinned runner
   release and checks its SHA-256, registers it as `reference-machine` with the work directory
   `~/actions-work`, installs the launchd agent and starts it. Run again, it leaves an existing
   registration alone and only reinstalls and reloads the agent; to register from scratch, do
   section 7 first.

7. **Verify** (owner's account).

   ```sh
   gh api repos/DioPires/eternities-mtg-app/actions/runners \
     --jq '.runners[] | {name, status, labels: [.labels[].name]}'
   ```

   Exactly one runner, `"status": "online"`, labels `self-hosted`, `macOS`, `ARM64`,
   `reference-machine`. Then run the whole workflow by hand and wait for it. The first command
   prints the URL of the run it created; the run id is the number that URL ends in.

   ```sh
   gh workflow run CI --ref main
   gh run watch --exit-status <run id>
   ```

   All four `unity-*` jobs green is the runner verified. Record it in section 6.

## 3. What the jobs rely on

Each line is a property of the recipe that a job in `ci.yml` depends on. Change one here and the
workflow has to change with it.

- **A GUI session.** The agent is limited to the Aqua session type, so it runs only while
  `eternities-ci` is logged in at the login window. `batchmode.sh` starts the editor with
  `-batchmode` and never with `-nographics`. `unity-playmode` proves the result rather than assuming
  it: its test fails if the editor reports a Null graphics device.
- **No launchd throttle.** The agent's process type is Interactive. Without it launchd throttles
  the CPU and I/O of the agent and of the editor it starts.
- **Runner concurrency 1.** One runner takes one job at a time, and this machine has one runner.
  That is the whole mechanism: a bench never shares the GPU with another job. Do not register a
  second runner here.
- **No other editor during a bench.** `unity-bench-smoke` fails before it starts if any process
  named `Unity` is running under any account, the owner's included. Close the editor and re-run the
  job.
- **One workspace per job.** Each job checks out into its own directory under
  `~/actions-work/eternities-mtg-app/eternities-mtg-app/<job>/`, so a job that dies cannot leave a
  lock in another job's project. The checkout removes ignored files, `Library/` included, so every
  job imports the project from cold and nothing is carried from one run to the next.
- **Git LFS, nothing excluded.** The jobs check out with `lfs: true`. `lfs.fetchexclude` must stay
  unset in the account; the script refuses to register if it is set.
- **Labels.** The jobs ask for `[self-hosted, macOS, reference-machine]`.
- **No bypass.** If the runner is offline the jobs stay queued and the pull request waits (PRD v4
  8.8.5). Nothing in the workflow skips them for a pull request that touches `unity/`. GitHub fails
  a job that has waited 24 hours for a runner; re-run it once the runner is back.

## 4. Keeping it running

- The runner stops when `eternities-ci` is logged out. Switch back to the owner's account with Fast
  User Switching and leave the runner account logged in. After a restart, log in to your own
  account, then switch to `eternities-ci` once; the agent starts by itself.
- A sleeping machine runs nothing. Jobs queue and start when it wakes.
- Agent logs: `/Users/eternities-ci/Library/Logs/actions-runner/`. Runner diagnostics:
  `/Users/eternities-ci/actions-runner/_diag/`.
- State of the agent, from the runner account:
  `launchctl print gui/$(id -u)/com.eternities.actions-runner`.

## 5. Re-verifying after an update

- **Unity.** An editor upgrade is a pull request that changes `ProjectVersion.txt` (and the pin
  table in `unity/Eternities/README.md`). Install the new editor first (step 1, with the new
  version's `unityhub://` link); editors install side by side. The pull request's own `unity-*`
  jobs are the re-verification, and they fail with "is not installed" if the editor is missing.
  Remove the old editor in the Hub after the merge.
- **The runner.** The runner updates itself when GitHub requires it. The version in use is the
  first line of every job log ("Current runner version"). When it changes, repeat step 7 and record
  it below. To move the pinned version used for a fresh registration, change `RUNNER_VERSION` and
  `RUNNER_SHA256` in `register-runner.sh` from the release notes of `actions/runner`.
- **macOS.** A system upgrade can reset login items and privacy grants. Repeat step 7.

## 6. Verification record

| Date | Editor | Runner | Run | By |
|---|---|---|---|---|
| not yet applied | | | | |

## 7. Removing the runner

In the runner account:

```sh
launchctl bootout gui/$(id -u)/com.eternities.actions-runner
rm ~/Library/LaunchAgents/com.eternities.actions-runner.plist
```

Then repository Settings, Actions, Runners, `reference-machine`, Remove, and delete
`~/actions-runner` in the runner account. Pull requests that touch `unity/` wait from that moment
until a runner with the same labels is registered again.
