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

PRODUCTION_MULTIVERSE_RADIUS: Final = 130.0
"""§1.3's `multiverseRadius`, which every dataset in the tree carries."""
EXPECTED_FLOOR_PROXY_AT_130: Final = 4.159716
"""``12 px * (1.9 + cos 30 deg) * 130 / 1037.3303`` to six places, written out so that an
identical transcription error in both the law and the formula above still has a third opinion to
disagree with. Converting at `1.9 R` instead gives 2.857335."""


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
