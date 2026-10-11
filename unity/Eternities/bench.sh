#!/bin/sh
# Starts a bench run of the built player and answers its one question (README.md, Batchmode
# commands). It needs the player and nothing else: no checkout, no editor. The player names the
# commit it was built from. A player that is not a development build cannot count its own GPU memory, and cannot
# start a process to ask: before it leaves the world it writes its process id to
# `<benchOut>.footprint-request`, and this script answers with the output of `footprint`, which
# the run then reads into its JSON. Everything else is the player's.
#
#   unity/Eternities/bench.sh <path to Eternities.app> -bench warm -benchQuality high -benchScale 1 -benchOut <path>
#
# It refuses to start while a Unity editor is running on this machine (PRD v4 8.8.6), and exits
# with the player's exit code: 0 only if the path completed.
#
# With `--locked-only` before the player's path it runs only while this Mac's screen is locked: it
# refuses to start on an unlocked screen, and it ends the player, with exit code 3, as soon as the
# screen is unlocked. A run takes the whole screen for minutes. On the reference machine the owner
# allows an agent's run on the locked screen while the machine is idle (DEC-953), so an agent
# starts every run this way. The owner's own runs, the light Mac's among them, do not need it.
set -eu
locked_only=
if [ "${1:-}" = "--locked-only" ]; then
    locked_only=1
    shift
fi
screen_locked() {
    /usr/sbin/ioreg -n Root -d1 | grep -q '"IOConsoleLocked" = Yes'
}
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
if [ -n "$locked_only" ] && ! screen_locked; then
    echo "bench.sh: the screen is not locked, and --locked-only was asked for; nothing was started" >&2
    exit 3
fi
rm -f "$out.footprint-request" "$out.footprint"
"$app/Contents/MacOS/Eternities" "$@" &
player=$!
while kill -0 "$player" 2> /dev/null; do
    if [ -f "$out.footprint-request" ] && [ ! -f "$out.footprint" ]; then
        /usr/bin/footprint -p "$(cat "$out.footprint-request")" > "$out.footprint.tmp" 2> /dev/null || true
        mv "$out.footprint.tmp" "$out.footprint"
    fi
    if [ -n "$locked_only" ] && ! screen_locked; then
        kill "$player" 2> /dev/null || true
        wait "$player" 2> /dev/null || true
        echo "bench.sh: the screen was unlocked during the run; the player was ended and the run does not count" >&2
        exit 3
    fi
    perl -e 'select(undef, undef, undef, 0.2)'
done
wait "$player"
