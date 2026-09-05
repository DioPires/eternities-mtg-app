#!/bin/zsh
# The control for `selfcheck-ladder.sh`, and the reason the off-screen gate needs no discriminator.
#
# It applies the SAME displacement as a ladder rung, but to the plane table instead of the mirror.
# `PlaneTable.data` is the one `Float32Array` behind both `get raw()` (which the CPU mirror reads)
# and the `DataTexture` the GLSL twin samples, so the row is genuinely, *correctly* off screen for
# both sides: the data simply says the plane is up there. This is the case a naive concentration
# rule on `offScreen` would have failed, and it must PASS.
#
#   usage: web/scripts/selfcheck-control.sh '<TS statement>' '<label>' [small|scale|production|all]
#
#   web/scripts/selfcheck-control.sh \
#     'if (record.index === 0) d[base + PT_HOME + 1] = record.home[1] + 400' 'home + 400'
#       -> pass, exit 0, `15 off screen`, row 0 located 15 of 15. Compare `py += 400` on the ladder,
#          which reports the identical `15 off screen` and fails. Opposite verdicts on the same
#          count is the proof that nothing branches on frustums.
#
#   web/scripts/selfcheck-control.sh \
#     'if (record.index === 0) d[base + PT_HOME + 1] = record.home[1] + 4000' 'home + 4000'
#       -> FAILS, with 15 unprojectable and a message naming both possible causes. This is the
#          false-positive boundary of the `unprojectable === 0` clause, and it sits a factor of 30
#          beyond the 130 `MULTIVERSE_RADIUS` allows a centre, so no real dataset can reach it. See
#          the clause in `selfCheck.ts`.
#
# Write the injection as an assignment, not `d[...] += 400`. `noUncheckedIndexedAccess` types a
# `Float32Array` index as `number | undefined`, so a compound assignment fails `tsc` with TS2532 and
# the script reports `BUILD FAILED` rather than anything about the check. The ladder's `py += 400`
# is fine because `py` there is a plain local.
#
# Skips the verify steps before `verifyStarField` for the same reason `selfcheck-ladder.sh` does:
# they are downstream of the same plane table and would report first. See that script's header.
#
# `set -eu` and an EXIT trap for the same reasons as the ladder — a failed `assert` in a patch step
# must not go on to measure a partly-patched tree, and INT/TERM alone leave `.orig` files behind on
# any other exit. See that script's header.
set -eu

# See `selfcheck-ladder.sh` for why this is derived rather than hard-coded, and what overriding it
# is for.
ROOT=${ETERNITIES_ROOT:-${0:A:h}/../..}
TABLE=$ROOT/web/src/scene/starfield/planeTable.ts
VERIFY=$ROOT/web/scripts/verify-browser.mjs
INJECT="$1"
LABEL="$2"
DATASET="${3:-small}"

# Guarded per file and returning 0 unconditionally; see `selfcheck-ladder.sh` for why both matter.
restore() {
  [[ -f "$TABLE.orig" ]] && { cp "$TABLE.orig" "$TABLE"; rm -f "$TABLE.orig"; }
  [[ -f "$VERIFY.orig" ]] && { cp "$VERIFY.orig" "$VERIFY"; rm -f "$VERIFY.orig"; }
  return 0
}

trap restore EXIT INT TERM
cp "$TABLE" "$TABLE.orig"
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
    src = src.replace(anchor, "    // CONTROL SKIP:" + anchor.strip())
open(path, "w").write(src)
PY

python3 - "$TABLE" "$INJECT" <<'PY'
import sys
path, inject = sys.argv[1], sys.argv[2]
src = open(path).read()
anchor = "    d[base + PT_RADIUS] = record.radius"
assert src.count(anchor) == 1, "anchor not unique"
src = src.replace(anchor, "    // CONTROL INJECTION\n    " + inject + "\n" + anchor)
open(path, "w").write(src)
PY

cd "$ROOT/web"
pnpm build >/dev/null 2>&1 || { echo "$LABEL: BUILD FAILED"; exit 1; }
# See `selfcheck-ladder.sh`: `|| CODE=$?` so that `-e` does not abort on the run this script exists
# to measure. Here the green case is the expected one, but the `home + 4000` rung fails by design.
CODE=0
OUT=$(node scripts/verify-browser.mjs --dataset "$DATASET" 2>&1) || CODE=$?
restore

echo "=============== CONTROL: $LABEL [$DATASET] (exit $CODE) ==============="
echo "$OUT" | grep -E "id-buffer picking|of those|samples per plane row|unprojectable" | sed 's/^ */  /'
if [[ $CODE -ne 0 ]]; then
  echo "$OUT" | grep -E "^Error|self-check|motion mirror|could not locate|located only|behind the eye" | head -6 | sed 's/^/  FAIL: /'
else
  echo "$OUT" | grep -E "^OK" | head -1 | sed 's/^/  PASS: /'
fi
exit $CODE
