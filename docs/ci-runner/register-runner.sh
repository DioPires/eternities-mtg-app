#!/bin/sh
# Registers the `eternities-ci` account as the reference machine's GitHub Actions runner and starts
# it as a launchd agent in that account's GUI session. docs/ci-runner.md is the procedure this
# belongs to. Run it logged in as `eternities-ci`, in Terminal, from a clone of this repository:
#
#     docs/ci-runner/register-runner.sh <registration token>
#
# Run again, with or without a token, it leaves an existing registration alone and only reinstalls
# and reloads the agent. To register from scratch, remove the runner first (docs/ci-runner.md).
set -eu

ACCOUNT=eternities-ci
REPO_URL=https://github.com/DioPires/eternities-mtg-app
RUNNER_NAME=reference-machine
RUNNER_VERSION=2.338.0
RUNNER_SHA256=df4cebda25c86a886ed204e49fee63f5c2e7cec5f447b5c98440a826bbdf9df2
AGENT=com.eternities.actions-runner

fail() {
    echo "register-runner: $1" >&2
    exit 1
}

[ $# -le 1 ] || fail "usage: register-runner.sh <registration token>"
token=${1:-}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

# The plist carries absolute paths under /Users/eternities-ci.
[ "$(id -un)" = "$ACCOUNT" ] || fail "run this as $ACCOUNT, not $(id -un)"
[ "$HOME" = "/Users/$ACCOUNT" ] || fail "home is $HOME, expected /Users/$ACCOUNT"
[ "$(uname -m)" = arm64 ] || fail "this is not an Apple Silicon machine"
launchctl print "gui/$(id -u)" > /dev/null 2>&1 \
    || fail "no GUI session for $ACCOUNT: log in at the login window, not over ssh or su"

# Git LFS, with nothing excluded from fetch (PRD v4 8.8.6).
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v git-lfs > /dev/null || fail "git-lfs is not installed (docs/ci-runner.md step 2)"
git lfs install
[ -z "$(git config --get-all lfs.fetchexclude || true)" ] || fail "lfs.fetchexclude is set; unset it"

# The editor the project is pinned to, and a licence this account can use. Opening an empty project
# is the cheapest thing that needs both.
version=$(awk '/^m_EditorVersion:/ { print $2 }' "$repo/unity/Eternities/ProjectSettings/ProjectVersion.txt")
unity="/Applications/Unity/Hub/Editor/$version/Unity.app/Contents/MacOS/Unity"
[ -x "$unity" ] || fail "Unity $version is not installed at $unity (docs/ci-runner.md step 1)"
probe=$(mktemp -d)
echo "register-runner: opening an empty project with Unity $version to check the licence"
"$unity" -batchmode -quit -createProject "$probe/probe" -logFile "$probe/probe.log" \
    || fail "Unity $version did not start in batchmode; sign this account in to the Unity Hub (docs/ci-runner.md step 5). Log: $probe/probe.log"
rm -rf "$probe"

# The runner. One runner on the machine is what makes its concurrency 1. A directory that is
# already registered is left exactly as it is: a runner that has updated itself is no longer the
# pinned release, and a registration is not something to drop on the way to a step that can fail.
runner="$HOME/actions-runner"
if [ -f "$runner/.runner" ] || [ -f "$runner/.runner_migrated" ]; then
    echo "register-runner: $runner is already registered; reloading the agent only"
else
    [ -n "$token" ] || fail "usage: register-runner.sh <registration token>"
    mkdir -p "$runner" "$HOME/actions-work"
    cd "$runner"
    tarball="actions-runner-osx-arm64-$RUNNER_VERSION.tar.gz"
    curl -fsSL -o "$tarball" "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$tarball"
    echo "$RUNNER_SHA256  $tarball" | shasum -a 256 -c -
    tar xzf "$tarball"
    rm "$tarball"
    ./config.sh --unattended --replace \
        --url "$REPO_URL" --token "$token" \
        --name "$RUNNER_NAME" --labels reference-machine \
        --work "$HOME/actions-work"
fi

# The agent. Nothing above this line has touched a runner that was already working.
mkdir -p "$HOME/Library/Logs/actions-runner" "$HOME/Library/LaunchAgents"
cp "$here/$AGENT.plist" "$HOME/Library/LaunchAgents/$AGENT.plist"
if launchctl print "gui/$(id -u)/$AGENT" > /dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/$AGENT"
    # `bootstrap` fails with an I/O error while the old instance is still being torn down.
    while launchctl print "gui/$(id -u)/$AGENT" > /dev/null 2>&1; do sleep 1; done
fi
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$AGENT.plist"
launchctl print "gui/$(id -u)/$AGENT" | grep -E '^[[:space:]]*(state|pid) = '
echo "register-runner: done. Verify from the owner's account (docs/ci-runner.md step 7)."
