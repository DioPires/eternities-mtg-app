"""§1.11's layout amendment: the `home` law separates pick proxies on screen (DEC-759).

Three things live here, and they fail for different reasons:

* the **vendored candidate homes** — what :func:`layout.place_planes` produces for the roster the
  shipped production dataset carries. The web sweep
  (`web/test/pick-target-separation.test.ts`) measures effective pick targets against them,
  because production itself is only re-laid out on a dataset refresh, and it re-hashes when it is.
  Pinning the file here is what stops the two sides drifting apart: the sweep would otherwise be
  measuring a layout no law produces.
* the **falsifier** — proof, on the shipped layout, that the home-view rule is not implied by the
  world-space margin that was already there. That layout clears PRD 5.3.3 at maximum drift and
  still puts pairs on top of each other in the home view, which is what DEC-751 measured and
  DEC-749 ruled the renderer cannot fix.
* the **pick-proxy cross-check** — the one assertion here that does not read
  :mod:`~eternities.fixtures.layout`'s constants. Every other test of the rule, in this file and
  in ``test_pipeline_invariants.py``, derives its expected value from the same
  :func:`layout.pick_proxy_radius` the generator calls, so it can see a change in the *shape* of
  the predicate and never a change in a constant inside it. That is not a hypothetical: converting
  the pixel floor at the eye's distance instead of the disc's far rim — the exact bug the second
  commit of DEC-759 exists to fix — left every one of those invariants green (DEC-865, item 5).
"""

from __future__ import annotations

import json
import math
import os
from typing import Any, Final

import pytest

from eternities.cli import DATASETS_FILE, REPO_ROOT, WEB_DATA_ROOT
from eternities.fixtures import layout

VENDORED = REPO_ROOT / "docs" / "worlds" / "dec759-home-law.json"

_COMMENT = [
    "GENERATED — `uv run pytest tests/test_home_separation.py` with UPDATE_HOME_LAW=1.",
    "The home positions `layout.place_planes` gives the roster of the production dataset named",
    "by web/datasets.json, under the home-view separation rule of spec.md §1.11 (DEC-759).",
    "Production still carries the pre-DEC-759 layout: `home` only moves on a dataset refresh,",
    "and a refresh re-hashes the directory. Until one lands this file is the candidate layout",
    "the acceptance sweep measures, and test_home_separation.py pins it to the law.",
    "DELETE ME at the next dataset refresh — scaffolding, not a record. The refresh bakes these",
    "homes into planes.json, which makes this file a second copy of them that can go stale.",
    "Delete it, delete the two scaffolding tests in test_home_separation.py (the vendored pin and",
    "the shipped-layout falsifier; the far-rim cross-check stays), and point",
    "web/test/pick-target-separation.test.ts at the shipped homes. Do NOT regenerate this file:",
    "regenerating is only right while production predates the law, which the refresh ends.",
]


def _production() -> tuple[str, dict[str, Any]]:
    registry = json.loads(DATASETS_FILE.read_text(encoding="utf-8"))
    name = str(registry["production"])
    return name, json.loads((WEB_DATA_ROOT / name / "planes.json").read_text(encoding="utf-8"))


def _homes_under_the_law() -> dict[str, Any]:
    name, planes_file = _production()
    radius = float(planes_file["multiverseRadius"])
    named = [p for p in planes_file["planes"] if p["slug"] != "blind-eternities"]
    mean_spacing = 2.0 * radius / math.sqrt(len(named))
    homes = layout.place_planes(
        [(p["slug"], float(p["radius"]), int(p["cardCount"]) == 0) for p in named],
        radius,
        layout.PLANE_MARGIN_FACTOR * mean_spacing,
        layout.DRIFT_FACTOR * mean_spacing,
    )
    return {
        "_comment": _COMMENT,
        "dataset": name,
        "multiverseRadius": radius,
        "elevationRad": layout.HOME_ELEVATION_RAD,
        "homeDistanceFactor": layout.HOME_DISTANCE_FACTOR,
        "referenceFocalPx": round(layout.REFERENCE_FOCAL_PX, 6),
        "pickFloorPx": layout.PICK_FLOOR_PX,
        "homes": {slug: [round(c, 6) for c in home] for slug, home in sorted(homes.items())},
    }


# --- the pick-proxy cross-check ----------------------------------------------------------------
#
# §1.11's formula, restated in literals. These deliberately do NOT come from `layout`: a check
# that imports the constant it is checking asserts `x == x`. Change one of these and the test
# reports that the law and the spec have parted company — which is the whole job.
SPEC_HOME_ELEVATION_DEG: Final = 30.0
"""§1.11 / PRD 8.6.1: the home view's elevation above the disc."""
SPEC_HOME_DISTANCE_FACTOR: Final = 1.9
"""§1.11 / PRD 8.6.1: the eye's distance from the origin, in multiverse radii."""
SPEC_PICK_FLOOR_PX: Final = 12.0
"""§1.11's floor is 24 CSS px of *diameter*; a proxy radius gets half of it."""
SPEC_PICK_PROXY_MARGIN: Final = 1.15
"""§1.11: a plane is picked through a proxy this much larger than the world it draws."""
SPEC_REFERENCE_FOCAL_PX: Final = 1080.0 / (2.0 * math.tan(math.radians(55.0) / 2.0))
"""§1.3's reference viewport: 1080 rows at a 55 degree vertical fov."""

SPEC_DRIFT_VERTICAL_RATIO: Final = 0.35
"""PRD 5.3.15: the drift orbit lifts a plane off the disc by this fraction of its amplitude."""

PRODUCTION_MULTIVERSE_RADIUS: Final = 130.0
"""§1.3's `multiverseRadius`, which every dataset in the tree carries."""
SECOND_MULTIVERSE_RADIUS: Final = 325.0
"""A second, deliberately non-production radius. 2.5x the first, and 2.5 is not a value any other
constant in this file carries, so a ratio of 2.5 cannot be read off anything but the parameter."""
EXPECTED_FLOOR_PROXY_AT_130: Final = 4.159716
"""``12 px * (1.9 + cos 30 deg) * 130 / 1037.3303`` to six places, written out so that an
identical transcription error in both the law and the formula above still has a third opinion to
disagree with. Converting at `1.9 R` instead gives 2.857335."""
EXPECTED_FLOOR_PROXY_AT_325: Final = 10.399290
"""The same conversion at :data:`SECOND_MULTIVERSE_RADIUS`.

**Why a second radius exists at all (DEC-865's re-read, gap 1).** With 130 as the only sample,
:func:`layout.pick_proxy_radius` could ignore its ``multiverse_radius`` parameter entirely —
``depth = (1.9 + cos 30 deg) * 130.0``, hardcoded — and all 376 tests still passed, because 130 is
the only radius any dataset in the tree carries. A floor that does not scale with the disc is
wrong everywhere except on today's data, and it is wrong silently: the picture stays correct while
the number drifts."""
EXPECTED_PER_PLANE_DRIFT_CLOSURE: Final = 1.6062177826491073
"""``1 + 0.35 / tan(30 deg)``: the amplitudes of screen separation one drifting plane can eat.

Written out for the same reason as the two above — :func:`layout.drift_closure` is the only place
the vertical half of PRD 5.3.15's drift enters the home-view rule, and until DEC-884 nothing
checked its *value*. The two neighbours it has to be told apart from are **1.0**, the bound a rule
that budgeted only the horizontal half would use, and **2.2124355652982146**, what doubling the
ratio to 0.7 gives — the exact mutant a reviewer ran through the whole web suite without a single
test noticing (DEC-865, item 3)."""


def test_the_pick_floor_is_converted_at_the_discs_far_rim():
    """The floor's conversion to world units, stated without reading the generator's constants.

    A pixel buys more world units the further away it is, so where the floor is converted decides
    how big it is. §1.11 converts it at the disc's *deepest* point, ``(1.9 + cos 30 deg) * R``,
    because that is where a pixel costs the most. Converting at the camera's distance to the
    origin, ``1.9 R``, gives 2.857 world units where the far rim gives 4.160 — the far-rim value
    is 46% larger — and two far-side proxies then overlap by up to 11 px while the rule reports
    itself satisfied.

    ``test_no_two_pick_proxies_overlap_in_the_home_view`` cannot catch that, and neither can the
    rule inside ``place_planes``: both call :func:`layout.pick_proxy_radius`, so a wrong constant
    inside it is wrong on both sides of their comparison and cancels. This is the assertion that
    does not cancel.
    """
    far_rim_depth = (
        SPEC_HOME_DISTANCE_FACTOR + math.cos(math.radians(SPEC_HOME_ELEVATION_DEG))
    ) * PRODUCTION_MULTIVERSE_RADIUS
    expected = SPEC_PICK_FLOOR_PX * far_rim_depth / SPEC_REFERENCE_FOCAL_PX
    assert math.isclose(expected, EXPECTED_FLOOR_PROXY_AT_130, abs_tol=5e-7)

    # A world small enough that the floor, not `1.15 * radius`, is what it is picked through.
    floored = layout.pick_proxy_radius(0.5, PRODUCTION_MULTIVERSE_RADIUS)
    assert math.isclose(floored, expected, rel_tol=1e-12), (
        "the pick floor is no longer 12 px converted at (1.9 + cos 30 deg) * R. If the camera or "
        "the floor really moved, update the SPEC_* literals above from spec.md §1.11 and PRD "
        "8.6.1 — and regenerate docs/worlds/dec759-home-law.json, because the separation the "
        "shipped fixtures were laid out for was measured against the old value"
    )

    # And it is not the eye-distance conversion. Stated as its own assertion because the two
    # differ by a factor, not by a shape: the message above would pass for either if the literal
    # were wrong in the same direction.
    at_eye_distance = (
        SPEC_PICK_FLOOR_PX
        * SPEC_HOME_DISTANCE_FACTOR
        * PRODUCTION_MULTIVERSE_RADIUS
        / SPEC_REFERENCE_FOCAL_PX
    )
    assert math.isclose(floored / at_eye_distance, 1.4558, abs_tol=5e-5), (
        "the floor is being converted at the camera's distance to the origin rather than at the "
        "disc's far rim; far-side proxies will overlap while place_planes reports the home-view "
        "rule satisfied (DEC-759, DEC-865 item 5)"
    )

    # The floor is a function of the disc, not of the number 130 (DEC-865's re-read, gap 1). Both
    # halves are needed: the second radius alone would pass a law that scaled by the wrong power,
    # and the ratio alone would pass one that scaled correctly from a wrong base.
    wider_depth = (
        SPEC_HOME_DISTANCE_FACTOR + math.cos(math.radians(SPEC_HOME_ELEVATION_DEG))
    ) * SECOND_MULTIVERSE_RADIUS
    wider_expected = SPEC_PICK_FLOOR_PX * wider_depth / SPEC_REFERENCE_FOCAL_PX
    assert math.isclose(wider_expected, EXPECTED_FLOOR_PROXY_AT_325, abs_tol=5e-7)

    wider = layout.pick_proxy_radius(0.5, SECOND_MULTIVERSE_RADIUS)
    assert math.isclose(wider, wider_expected, rel_tol=1e-12), (
        "the pick floor does not scale with `multiverse_radius`. It is right on production's 130 "
        "and wrong on every other disc, which no fixture in the tree has — so this is the only "
        "test that can see it (DEC-884)"
    )
    assert math.isclose(
        wider / floored, SECOND_MULTIVERSE_RADIUS / PRODUCTION_MULTIVERSE_RADIUS, rel_tol=1e-12
    ), (
        "the floor is not *linear* in `multiverse_radius`. Depth is proportional to the disc and "
        "a pixel converts linearly in depth, so 2.5x the radius is exactly 2.5x the floor"
    )

    # The other branch, so the `max` cannot quietly become a constant.
    assert math.isclose(
        layout.pick_proxy_radius(40.0, PRODUCTION_MULTIVERSE_RADIUS),
        SPEC_PICK_PROXY_MARGIN * 40.0,
        rel_tol=1e-12,
    )
    crossover = expected / SPEC_PICK_PROXY_MARGIN
    assert layout.pick_proxy_radius(crossover * 1.01, PRODUCTION_MULTIVERSE_RADIUS) > expected
    assert math.isclose(
        layout.pick_proxy_radius(crossover * 0.99, PRODUCTION_MULTIVERSE_RADIUS),
        expected,
        rel_tol=1e-12,
    )


def test_the_vendored_candidate_homes_are_what_the_law_produces():
    """The web sweep's input, pinned to its generator.

    A roster change, a radius-law change or a change to the rule itself all land here first, and
    the file is only evidence while it is output — so it is never edited by hand. *Which* fix is
    right depends on why it fired, and the two messages below are not interchangeable: a dataset
    refresh retires the whole scaffold, while a change to the law on today's dataset regenerates
    it. This test is the one that fires first at a refresh, because the dataset name moves before
    anything else does.
    """
    produced = _homes_under_the_law()
    if os.environ.get("UPDATE_HOME_LAW"):
        VENDORED.write_text(json.dumps(produced, indent=2) + "\n", encoding="utf-8")
        pytest.skip(f"rewrote {VENDORED.name}; re-run without UPDATE_HOME_LAW")
    committed = json.loads(VENDORED.read_text(encoding="utf-8"))
    assert committed["dataset"] == produced["dataset"], (
        f"production now names a different dataset, so the refresh DEC-759 was waiting for has "
        f"landed and {VENDORED.name} has served its purpose. DELETE it, DELETE this test and "
        "test_the_home_view_rule_is_not_implied_by_the_world_space_margin (the far-rim "
        "cross-check above stays — it is about the law, not the scaffolding), and point "
        "web/test/pick-target-separation.test.ts at the shipped homes, which now carry the law "
        "themselves. Do NOT regenerate: UPDATE_HOME_LAW=1 would rebuild scaffolding whose only "
        "reason to exist was that production predated the law"
    )
    assert committed == produced, (
        f"{VENDORED.name} is not what place_planes produces today, on the dataset production "
        "still names. The law or the roster moved under it: regenerate with UPDATE_HOME_LAW=1 "
        "and re-read the sweep's numbers, they are a property of this layout and not of the law"
    )


def test_the_home_view_rule_is_not_implied_by_the_world_space_margin():
    """The falsifier, on real data: the shipped layout clears PRD 5.3.3 and fails §1.11's rule.

    Both halves matter. Without the first, "the rule bites" could just mean the old margin was
    violated too and the new sentence adds nothing; without the second, the rule would be
    decoration. This is also the arm the web sweep reports as its control — it retires the day a
    refresh carries the law into production, and the message below says so rather than leaving a
    maintainer to guess.
    """
    _, planes_file = _production()
    radius = float(planes_file["multiverseRadius"])
    sin_elevation = math.sin(layout.HOME_ELEVATION_RAD)
    named = [p for p in planes_file["planes"] if p["slug"] != "blind-eternities"]
    violations = 0
    for i, a in enumerate(named):
        for b in named[i + 1 :]:
            centres = math.dist(a["home"], b["home"])
            drifting = centres - a["driftAmplitude"] - b["driftAmplitude"]
            assert drifting > a["radius"] + b["radius"], (
                f"{a['slug']} and {b['slug']} overlap in world space under drift — this dataset "
                "does not satisfy the rule the new one is being compared against"
            )
            if a["cardCount"] == 0 and b["cardCount"] == 0:
                continue  # exempt from the rule; see `place_planes`
            gap = math.hypot(a["home"][0] - b["home"][0], a["home"][2] - b["home"][2])
            need = layout.pick_proxy_radius(a["radius"], radius) + layout.pick_proxy_radius(
                b["radius"], radius
            )
            if gap * sin_elevation < need:
                violations += 1
    assert violations > 0, (
        "the shipped production layout already satisfies the home-view separation rule. If a "
        "dataset refresh has landed since DEC-759, that is the good outcome: delete this test, "
        "and point the web sweep at the shipped homes instead of docs/worlds/dec759-home-law.json"
    )


# --- the drift closure -------------------------------------------------------------------------


def test_the_drift_closure_budgets_the_vertical_half_of_the_orbit():
    """§1.11's drift term, stated in literals rather than pinned as a byte (DEC-865, gap 2).

    Before DEC-884 the only thing that noticed a change to `DRIFT_VERTICAL_RATIO` was a byte pin:
    the vendored homes and the committed fixtures are both output of :func:`layout.place_planes`,
    and the ratio enters the placement, so *any* edit moved them. A pin like that fires on a
    re-spelling exactly as loudly as on a sign error, which makes it useless for telling a
    reviewer which of the two happened — and it says nothing at all about whether the value is
    *right*. This does.

    The number is not arbitrary and it is not small. A drifting plane eats
    ``1 + 0.35 / tan(30 deg) = 1.606`` amplitudes of screen separation, so the vertical bob is
    worth 61% of what the horizontal swing is worth, under a camera that flattens the disc.
    """
    per_plane = 1.0 + SPEC_DRIFT_VERTICAL_RATIO / math.tan(math.radians(SPEC_HOME_ELEVATION_DEG))
    assert math.isclose(per_plane, EXPECTED_PER_PLANE_DRIFT_CLOSURE, rel_tol=1e-15)

    for amplitude in (1.0, 0.8362477771734799, 13.5):
        assert math.isclose(
            layout.drift_closure(amplitude), 2.0 * amplitude * per_plane, rel_tol=1e-12
        ), (
            "the home-view rule's drift budget is no longer `2a * (1 + 0.35 / tan 30 deg)`. If "
            "PRD 5.3.15's ratio or PRD 8.6.1's elevation really moved, update the SPEC_* "
            "literals above and regenerate docs/worlds/dec759-home-law.json — the separation the "
            "shipped fixtures were laid out for was measured against the old value"
        )

    # A pair, not a plane: both ends of a pair drift, and the rule compares one gap.
    assert math.isclose(layout.drift_closure(2.5) / layout.drift_closure(1.0), 2.5, rel_tol=1e-12)

    # The two wrong values this has to be told apart from, named so the failure message above is
    # not the only thing standing between a maintainer and a plausible-looking regression.
    horizontal_only = 2.0 * EXPECTED_PER_PLANE_DRIFT_CLOSURE / per_plane
    assert not math.isclose(layout.drift_closure(1.0), horizontal_only, rel_tol=0.01), (
        "the rule is budgeting only the horizontal half of the drift; it is short by 61% of one "
        "amplitude per plane, which is the term the flattening exists to remove"
    )
    doubled = 2.0 * (1.0 + 2.0 * SPEC_DRIFT_VERTICAL_RATIO / math.tan(math.radians(30.0)))
    assert not math.isclose(layout.drift_closure(1.0), doubled, rel_tol=0.01), (
        "the vertical ratio reads 0.7. That is the mutant DEC-865 item 3 ran through the entire "
        "web suite without a single test going red"
    )


def test_the_law_places_against_the_full_drift_closure():
    """The use site: what :func:`layout.place_planes` actually accepts, judged from the literals.

    The test above proves the helper computes §1.11's number. This proves the law *applies* it —
    otherwise the helper could be dead code and the whole budget still missing from the predicate.
    Every other check of the rule derives its expected value from ``layout``'s own constants, so a
    term dropped from both sides of the comparison cancels; this one restates the predicate from
    the SPEC_* literals, so it cannot cancel.

    **The instrument is confirmed to see the defect, and the last assertion is what confirms it.**
    The rule binds hard on this roster: the tightest world pair clears it by 0.003 world units,
    while the vertical half of the closure is worth 0.507 — two orders of magnitude more. A
    ``place_planes`` that budgeted only the horizontal half would accept pairs up to that much
    tighter, and the loop above would find one. Without the final assertion this test would be
    vacuous the day the roster loosened, and would not say so.
    """
    _, planes_file = _production()
    radius = float(planes_file["multiverseRadius"])
    named = [p for p in planes_file["planes"] if p["slug"] != "blind-eternities"]
    mean_spacing = 2.0 * radius / math.sqrt(len(named))
    amplitude = layout.DRIFT_FACTOR * mean_spacing
    homes = layout.place_planes(
        [(p["slug"], float(p["radius"]), int(p["cardCount"]) == 0) for p in named],
        radius,
        layout.PLANE_MARGIN_FACTOR * mean_spacing,
        amplitude,
    )

    sin_elevation = math.sin(math.radians(SPEC_HOME_ELEVATION_DEG))
    closure = 2.0 * amplitude * EXPECTED_PER_PLANE_DRIFT_CLOSURE
    worst = math.inf
    for i, a in enumerate(named):
        for b in named[i + 1 :]:
            if a["cardCount"] == 0 and b["cardCount"] == 0:
                continue  # moon-on-moon pairs are exempt; see `place_planes`
            home_a, home_b = homes[a["slug"]], homes[b["slug"]]
            gap = math.hypot(home_a[0] - home_b[0], home_a[2] - home_b[2])
            need = layout.pick_proxy_radius(a["radius"], radius) + layout.pick_proxy_radius(
                b["radius"], radius
            )
            slack = (gap - closure) * sin_elevation - need
            assert slack >= 0.0, (
                f"{a['slug']} and {b['slug']} are placed {-slack:.4f} world units closer than "
                "§1.11 allows once both ends drift. place_planes is budgeting less closure than "
                "PRD 5.3.15 costs — most likely the vertical term, which is the half no picture "
                "and no byte pin can distinguish from a tighter roster (DEC-884)"
            )
            worst = min(worst, slack)

    vertical_share = (
        2.0 * amplitude * (EXPECTED_PER_PLANE_DRIFT_CLOSURE - 1.0)
    ) * sin_elevation
    assert worst < vertical_share, (
        f"the tightest pair clears the rule by {worst:.4f} world units, more than the "
        f"{vertical_share:.4f} the vertical half of the drift closure is worth. The roster has "
        "loosened, so dropping that half would no longer red this test and the assertion above "
        "has stopped being a falsifier. Tighten the subject or retire this test — do not relax it"
    )
