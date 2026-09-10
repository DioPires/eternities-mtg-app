#!/bin/zsh
# The injection ladder behind `docs/star-renderer.md` § "The off-screen hole, and how it was closed"
# and the tables in `web/src/scene/selfCheck.ts`.
#
# DOES NOT RUN AS OF DEC-708. Its driver, `verify-browser.mjs`, was archived under the
# `review-tooling-2026-09` tag (review §6.1 group C); this script and `selfcheck-control.sh` are
# group B and go with the phase harnesses in a later leg. To run the ladder today, restore the
# driver: `git show review-tooling-2026-09:web/scripts/verify-browser.mjs > web/scripts/verify-browser.mjs`.
#
# Patches the CPU motion mirror ONLY (`motion.ts`; the GLSL twin in `shaders.ts` is untouched), so
# the two sides of the self-check genuinely disagree, then rebuilds, runs `verify-browser`, and
# prints the self-check lines and the verdict. Every file it touches is restored before it exits,
# including on a build failure.
#
# This exists because the tallies it exercises — `unprojectable`, `unprojectableRows`,
# `nearestDepth`/`farthestDepth` and the `ok` composition — live in `sample()`, which needs a real
# GPU and so has no unit test. The ladder is the only regression proof they have, which is why it is
# committed rather than kept in a scratch directory.
#
#   usage: web/scripts/selfcheck-ladder.sh '<TS statement>' '<label>' [small|scale|production|all]
#
#   web/scripts/selfcheck-ladder.sh 'if (row === 0) py += 60'   'py += 60'    # was fail; still fail
#   web/scripts/selfcheck-ladder.sh 'if (row === 0) py += 400'  'py += 400'   # was pass; now row 0 dark
#   web/scripts/selfcheck-ladder.sh 'if (row === 0) py += 4000' 'py += 4000'  # was pass; now unprojectable
#   web/scripts/selfcheck-ladder.sh 'if (row === 0) pz += 400'  'pz += 400'   # was pass; now unprojectable
#   web/scripts/selfcheck-ladder.sh '' 'clean'                                # no injection
#
# The statement is spliced into `starWorldPosition` just before the PRD 5.3.13 multiverse rotation,
# where `px`/`py`/`pz` are world units and `row` is the plane row. Scope it to one row: an unscoped
# injection moves every star and the verdict stops naming a row. See `selfcheck-control.sh` for the
# case that must stay green.
#
# The run also skips every verify step before `verifyStarField` for the duration. Not because they
# are wrong — the shell, navigation and card-tier checks are downstream of the same motion mirror
# and catch these injections too, which is why on an unmodified `verify-browser` they fire *first*
# and abort the run before the star self-check is ever reached (`py += 400` dies at PRD 5.6.1's card
# framing, and with that muted, at 5.6.9's hover). The ladder's question is what the self-check
# *alone* can see, so the check under test has to be the one that reports.
#
# `-e` as well as `-u`: the patch steps below are `assert`-guarded, and without `-e` a failed assert
# only printed a traceback and the run carried on to build and measure a partly-patched tree — a
# result that looks like a rung rather than like a broken script. `trap ... EXIT` rather than
# `INT TERM`: those two cover a Ctrl-C but not the `-e` abort itself, nor any other signal, and what
# is left behind is a patched working tree plus `.orig` files. `restore` is idempotent so the
# explicit call on the normal path — which keeps the tree clean while the summary prints — and the
# trap firing afterwards do not fight.
set -eu

# The repo root, from this script's own location: web/scripts/<here> -> ../.. Overridable so the
# ladder can be pointed at a second worktree (running the "before" column against `origin/main`
# means restoring that commit's `selfCheck.ts`, `verify-browser.mjs` *and* `test/selfCheck.test.ts`
# — reverting only the first two fails `tsc --build`, since the current test imports `pixelForNdc`).
ROOT=${ETERNITIES_ROOT:-${0:A:h}/../..}
MOTION=$ROOT/web/src/scene/starfield/motion.ts
VERIFY=$ROOT/web/scripts/verify-browser.mjs
INJECT="$1"
LABEL="$2"
DATASET="${3:-small}"

# Guarded per file, not once for both: the two `cp`s below are separate statements, so "one backup
# exists and the other does not" is reachable. `return 0` because the last `[[ ]]` being false would
# otherwise make the function itself non-zero, which under `-e` turns a no-op restore into an abort.
restore() {
  [[ -f "$MOTION.orig" ]] && { cp "$MOTION.orig" "$MOTION"; rm -f "$MOTION.orig"; }
  [[ -f "$VERIFY.orig" ]] && { cp "$VERIFY.orig" "$VERIFY"; rm -f "$VERIFY.orig"; }
  return 0
}

trap restore EXIT INT TERM
cp "$MOTION" "$MOTION.orig"
cp "$VERIFY" "$VERIFY.orig"

python3 - "$VERIFY" <<'PY'
import sys
path = sys.argv[1]
src = open(path).read()
for anchor in (
    "    await verifyShell(page, url, log)",
    "    await verifyAccessibility(page, url, log)",
    "    await verifyWebGL2Fallback(browser, url, log)",
    "    await verifyNavigation(page, url, roster, problems)",
    "    await verifyCardTier(page, url, roster.realImages, shots, problems)",
):
    assert src.count(anchor) == 1, f"anchor not unique: {anchor}"
    src = src.replace(anchor, "    // LADDER SKIP:" + anchor.strip())
open(path, "w").write(src)
PY

if [[ -n "$INJECT" ]]; then
  python3 - "$MOTION" "$INJECT" <<'PY'
import sys
path, inject = sys.argv[1], sys.argv[2]
src = open(path).read()
anchor = "  // PRD 5.3.13: the whole multiverse turns about its vertical axis."
assert src.count(anchor) == 1, "anchor not unique"
src = src.replace(anchor, "  // LADDER INJECTION\n  " + inject + "\n" + anchor)
open(path, "w").write(src)
PY
fi

cd "$ROOT/web"
pnpm build >/dev/null 2>&1 || { echo "$LABEL: BUILD FAILED"; exit 1; }
# `|| CODE=$?` rather than a bare assignment then `$?`: under `-e` a failing verify run would abort
# here, and a failing run is most of what this script is for.
CODE=0
OUT=$(node scripts/verify-browser.mjs --dataset "$DATASET" 2>&1) || CODE=$?
restore

echo "=============== $LABEL [$DATASET] (exit $CODE) ==============="
echo "$OUT" | grep -E "id-buffer picking|of those|samples per plane row|off screen|not in window|unprojectable" | sed 's/^ */  /'
if [[ $CODE -ne 0 ]]; then
  echo "$OUT" | grep -E "^Error|self-check|motion mirror|could not locate|located only|behind the eye" | head -6 | sed 's/^/  FAIL: /'
else
  echo "$OUT" | grep -E "^OK|^all datasets" | head -2 | sed 's/^/  PASS: /'
fi
exit $CODE
