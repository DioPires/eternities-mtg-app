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
# It refuses to start while a Unity editor is running on this machine (PRD v4 8.8.6), or a process
# named Blender in any letter case (`docs/ci-runner.md` section 3). It exits with the player's exit
# code: 0 only if the path completed.
#
# It also writes `<benchOut>.others`: what else was busy on the machine during the run, sampled
# every 5 s. A locked, idle Mac is when macOS does its own work, and its media analysis decodes
# video on the GPU: a run it crossed had a p90 of 40 ms where the run before had 28 (DEC-953).
# Processor use is what can be read without privileges, so the file is a sign, not a measure.
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
if pgrep -ix Blender > /dev/null; then
    echo "bench.sh: Blender is running on this machine; nothing was started" >&2
    exit 2
fi
if [ -n "$locked_only" ] && ! screen_locked; then
    echo "bench.sh: the screen is not locked, and --locked-only was asked for; nothing was started" >&2
    exit 3
fi
rm -f "$out.footprint-request" "$out.footprint" "$out.others" "$out.others.tmp"
"$app/Contents/MacOS/Eternities" "$@" &
player=$!
started=$(date +%s)
ticks=0
# What else was busy, as `<benchOut>.others`: one line a process, the seconds from the run's start
# at which it was first and last seen busy, its highest %CPU and its name.
others() {
    {
        echo "# Processes other than the player that were busy during the run, sampled every 5 s: 50% of a"
        echo "# core or more, or the system's video encoder or decoder at all. From second, to second,"
        echo "# highest %CPU, name."
        if [ -s "$out.others.tmp" ]; then
            awk '{
                name = $3
                for (i = 4; i <= NF; i++) name = name " " $i
                if (!(name in first)) { first[name] = $1; order[++n] = name }
                last[name] = $1
                if ($2 + 0 > peak[name]) peak[name] = $2 + 0
            }
            END { for (i = 1; i <= n; i++) printf "%d %d %.0f %s\n", first[order[i]], last[order[i]], peak[order[i]], order[i] }' "$out.others.tmp"
        else
            echo "none"
        fi
    } > "$out.others"
    rm -f "$out.others.tmp"
    if ! grep -q '^none$' "$out.others"; then
        echo "bench.sh: other processes were busy during the run, which may have disturbed it: $out.others" >&2
    fi
}
while kill -0 "$player" 2> /dev/null; do
    ticks=$((ticks + 1))
    if [ $((ticks % 25)) -eq 0 ]; then
        # The window server draws the player's own frames, so it is not another's work.
        /bin/ps -Ao pcpu=,pid=,comm= | awk -v player="$player" -v at="$(($(date +%s) - started))" '
            $2 != player {
                name = $0
                sub(/^[ ]*[0-9.]+[ ]+[0-9]+[ ]+/, "", name)
                sub(/.*\//, "", name)
                if (name == "WindowServer" || name == "ps" || name == "awk") next
                if ($1 + 0 >= 50 || (name ~ /^VT(En|De)coderXPCService$/ && $1 + 0 >= 1)) print at, $1, name
            }' >> "$out.others.tmp"
    fi
    if [ -f "$out.footprint-request" ] && [ ! -f "$out.footprint" ]; then
        /usr/bin/footprint -p "$(cat "$out.footprint-request")" > "$out.footprint.tmp" 2> /dev/null || true
        mv "$out.footprint.tmp" "$out.footprint"
    fi
    if [ -n "$locked_only" ] && ! screen_locked; then
        kill "$player" 2> /dev/null || true
        wait "$player" 2> /dev/null || true
        rm -f "$out.others.tmp"
        echo "bench.sh: the screen was unlocked during the run; the player was ended and the run does not count" >&2
        exit 3
    fi
    perl -e 'select(undef, undef, undef, 0.2)'
done
others
wait "$player"
