#!/bin/sh
# Runs the editor this project is pinned to, in batchmode, on this project, logging to stdout.
# The pin is ProjectSettings/ProjectVersion.txt; the editor is where the Unity Hub installs it.
# Arguments are passed through: `-quit`, `-runTests ...`, `-executeMethod ...` (README.md).
set -eu
project=$(cd "$(dirname "$0")" && pwd)
version=$(awk '/^m_EditorVersion:/ { print $2 }' "$project/ProjectSettings/ProjectVersion.txt")
unity="/Applications/Unity/Hub/Editor/$version/Unity.app/Contents/MacOS/Unity"
if [ ! -x "$unity" ]; then
    echo "Unity $version is not installed at $unity (docs/ci-runner.md)" >&2
    exit 1
fi
# The editor's script compiler listens on a Unix socket under $TMPDIR, and a socket path holds 104
# bytes. With a longer TMPDIR (an agent run's scratch directory is one) every compile ends in "is of
# an invalid length for use with domain sockets" and "Scripts have compiler errors". The account's
# own temporary directory is short, and is what a launchd agent, so the CI runner, has anyway.
tmp=${TMPDIR:-}
if [ "${#tmp}" -gt 64 ]; then
    TMPDIR=$(getconf DARWIN_USER_TEMP_DIR)
    export TMPDIR
fi
exec "$unity" -batchmode -projectPath "$project" -logFile - "$@"
