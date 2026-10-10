#!/bin/sh
# Registers the account it runs in as the reference machine's GitHub Actions runner and starts the
# runner as a launchd agent in that account's GUI session. docs/ci-runner.md is the procedure this
# belongs to. Run it in a shell of the logged-in account (the owner's, PRD v4 8.8.6), from a clone
# of this repository:
#
#     docs/ci-runner/register-runner.sh
#
# It creates the registration token itself through `gh`. Pass a token as the only argument when the
# `gh` identity cannot create one (docs/ci-runner.md step 4).
#
# Run again, it leaves an existing registration alone and only reinstalls and reloads the agent,
# which stops a job in flight: run it when the runner is idle. To register from scratch, remove the
# runner first (docs/ci-runner.md section 7).
set -eu
# Byte-wise character classes: the check on $HOME below means the ASCII ranges it names.
LC_ALL=C
export LC_ALL

REPO=DioPires/eternities-mtg-app
RUNNER_NAME=reference-machine
RUNNER_VERSION=2.338.0
RUNNER_SHA256=df4cebda25c86a886ed204e49fee63f5c2e7cec5f447b5c98440a826bbdf9df2
AGENT=com.eternities.actions-runner

fail() {
    echo "register-runner: $1" >&2
    exit 1
}

[ $# -le 1 ] || fail "usage: register-runner.sh [registration token]"
token=${1:-}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

[ "$(uname -m)" = arm64 ] || fail "this is not an Apple Silicon machine"
[ "$(id -u)" -ne 0 ] || fail "run this as the account the runner belongs to, not with sudo"
launchctl print "gui/$(id -u)" > /dev/null 2>&1 \
    || fail "no GUI session for $(id -un): log in at the login window, not over ssh or su"
# The home directory is written into the agent's plist by `sed`.
case "$HOME" in
    /*) ;;
    *) fail "home is '$HOME', expected an absolute path" ;;
esac
case "$HOME" in
    *[!A-Za-z0-9._/-]*) fail "home is '$HOME'; a path with characters outside A-Z a-z 0-9 . _ / - is not supported" ;;
esac

PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
plist="$HOME/Library/LaunchAgents/$AGENT.plist"
# The licence probe below starts the editor, whose script compiler needs a short TMPDIR
# (unity/Eternities/batchmode.sh has the reason). An agent's shell has a long one.
tmp=${TMPDIR:-}
if [ "${#tmp}" -gt 64 ]; then
    TMPDIR=$(getconf DARWIN_USER_TEMP_DIR)
    export TMPDIR
fi

# The repository is public. A pull request from a fork runs the workflow file from the fork, so
# this setting is the only thing between a stranger's pull request and this account. Checked on
# every run, before the agent is started or restarted (docs/ci-runner.md section 1). A runner that
# is already installed would go on taking jobs under the wrong setting, now and at every login, so
# it is stopped and its agent removed; the registration is kept for the next run of this script.
command -v gh > /dev/null || fail "gh is not installed"
policy=$(gh api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy) \
    || fail "could not read the fork pull request approval policy of $REPO"
if [ "$policy" != all_external_contributors ]; then
    if launchctl print "gui/$(id -u)/$AGENT" > /dev/null 2>&1; then
        launchctl bootout "gui/$(id -u)/$AGENT" || true
        echo "register-runner: stopped the runner" >&2
    fi
    rm -f "$plist"
    fail "fork pull request approval policy is '$policy', expected 'all_external_contributors' (docs/ci-runner.md step 3)"
fi

# Git LFS, with nothing excluded from fetch (PRD v4 8.8.6).
command -v git-lfs > /dev/null || fail "git-lfs is not installed (docs/ci-runner.md step 2)"
git lfs install --skip-repo
[ -z "$(git config --get-all lfs.fetchexclude || true)" ] || fail "lfs.fetchexclude is set; unset it"

# The editor the project is pinned to.
version=$(awk '/^m_EditorVersion:/ { print $2 }' "$repo/unity/Eternities/ProjectSettings/ProjectVersion.txt")
unity="/Applications/Unity/Hub/Editor/$version/Unity.app/Contents/MacOS/Unity"
[ -x "$unity" ] || fail "Unity $version is not installed at $unity (docs/ci-runner.md step 1)"

# The runner. A directory that is already registered is left exactly as it is: a runner that has
# updated itself is no longer the pinned release, and a registration is not something to drop on
# the way to a step that can fail.
runner="$HOME/actions-runner"
if [ -f "$runner/.runner" ] || [ -f "$runner/.runner_migrated" ]; then
    echo "register-runner: $runner is already registered; reloading the agent only"
else
    # One runner for the repository is what makes its concurrency 1, and registering over a name
    # that is taken would drop the registration that holds it.
    existing=$(gh api "repos/$REPO/actions/runners" --jq '[.runners[].name] | join(", ")') \
        || fail "could not list the runners of $REPO"
    [ -z "$existing" ] \
        || fail "$REPO already has a runner registered ($existing); remove it first (docs/ci-runner.md section 7)"

    # A licence this account can use. Opening an empty project is the cheapest thing that needs
    # one. Only here: the probe is a Unity process, and a registered runner may be in a bench.
    probe=$(mktemp -d)
    echo "register-runner: opening an empty project with Unity $version to check the licence"
    "$unity" -batchmode -quit -createProject "$probe/probe" -logFile "$probe/probe.log" \
        || fail "Unity $version did not start in batchmode; sign this account in to the Unity Hub (docs/ci-runner.md step 1). Log: $probe/probe.log"
    rm -rf "$probe"

    if [ -z "$token" ]; then
        # Valid for one hour. `gh` prints the API's own error, a 403 included, when it cannot.
        token=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token) \
            || fail "could not create a registration token; create one in the repository settings and pass it as the argument (docs/ci-runner.md step 4)"
    fi
    mkdir -p "$runner" "$HOME/actions-work"
    cd "$runner"
    tarball="actions-runner-osx-arm64-$RUNNER_VERSION.tar.gz"
    curl -fsSL -o "$tarball" "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$tarball"
    echo "$RUNNER_SHA256  $tarball" | shasum -a 256 -c -
    tar xzf "$tarball"
    rm "$tarball"
    ./config.sh --unattended \
        --url "https://github.com/$REPO" --token "$token" \
        --name "$RUNNER_NAME" --labels reference-machine \
        --work "$HOME/actions-work"
fi

# The agent. Reloading it stops the runner, and with it a job in flight.
mkdir -p "$HOME/Library/Logs/actions-runner" "$HOME/Library/LaunchAgents"
sed "s|__HOME__|$HOME|g" "$here/$AGENT.plist" > "$plist.new"
plutil -lint "$plist.new" > /dev/null || fail "$plist.new is not a valid property list"
mv "$plist.new" "$plist"
if launchctl print "gui/$(id -u)/$AGENT" > /dev/null 2>&1; then
    # A non-zero exit here can mean "in progress"; the loop below is what decides.
    launchctl bootout "gui/$(id -u)/$AGENT" || true
    # `bootstrap` fails with an I/O error while the old instance is still being torn down.
    waited=0
    while launchctl print "gui/$(id -u)/$AGENT" > /dev/null 2>&1; do
        waited=$((waited + 1))
        [ "$waited" -le 60 ] || fail "the old agent did not stop within a minute; run this again"
        sleep 1
    done
fi
launchctl bootstrap "gui/$(id -u)" "$plist"
# One tab: the agent's own lines. Deeper ones belong to its endpoints.
launchctl print "gui/$(id -u)/$AGENT" | grep -E '^	(state|pid) = '
echo "register-runner: done. Verify with docs/ci-runner.md step 5."
