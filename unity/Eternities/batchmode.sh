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
exec "$unity" -batchmode -projectPath "$project" -logFile - "$@"
