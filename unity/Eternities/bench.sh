#!/bin/sh
# Starts a bench run of the built player and answers its one question (README.md, Batchmode
# commands). A player that is not a development build cannot count its own GPU memory, and cannot
# start a process to ask: before it leaves the world it writes its process id to
# `<benchOut>.footprint-request`, and this script answers with the output of `footprint`, which
# the run then reads into its JSON. Everything else is the player's.
#
#   unity/Eternities/bench.sh <path to Eternities.app> -bench warm -benchQuality high -benchScale 1 -benchOut <path>
#
# It refuses to start while a Unity editor is running on this machine (PRD v4 8.8.6), and exits
# with the player's exit code: 0 only if the path completed.
set -eu
app=$1
shift
out=
previous=
for argument in "$@"; do
    if [ "$previous" = "-benchOut" ]; then
        out=$argument
    fi
    previous=$argument
done
if [ -z "$out" ]; then
    echo "bench.sh: -benchOut <path> is required" >&2
    exit 2
fi
if pgrep -x Unity > /dev/null; then
    echo "bench.sh: a Unity editor is running on this machine; close it first" >&2
    exit 2
fi
rm -f "$out.footprint-request" "$out.footprint"
"$app/Contents/MacOS/Eternities" "$@" -benchCommit "$(git -C "$(dirname "$0")" rev-parse HEAD 2> /dev/null || echo unknown)" &
player=$!
while kill -0 "$player" 2> /dev/null; do
    if [ -f "$out.footprint-request" ] && [ ! -f "$out.footprint" ]; then
        /usr/bin/footprint -p "$(cat "$out.footprint-request")" > "$out.footprint.tmp" 2> /dev/null || true
        mv "$out.footprint.tmp" "$out.footprint"
    fi
    perl -e 'select(undef, undef, undef, 0.2)'
done
wait "$player"
