"""§1.11's layout amendment: the `home` law separates pick proxies on screen (DEC-759).

Two things live here, and they fail for different reasons:

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
"""

from __future__ import annotations

import json
import math
import os
from typing import Any

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


def test_the_vendored_candidate_homes_are_what_the_law_produces():
    """The web sweep's input, pinned to its generator.

    A roster change, a radius-law change or a change to the rule itself all land here first, and
    the fix is to regenerate rather than to edit: the file is only evidence while it is output.
    """
    produced = _homes_under_the_law()
    if os.environ.get("UPDATE_HOME_LAW"):
        VENDORED.write_text(json.dumps(produced, indent=2) + "\n", encoding="utf-8")
        pytest.skip(f"rewrote {VENDORED.name}; re-run without UPDATE_HOME_LAW")
    committed = json.loads(VENDORED.read_text(encoding="utf-8"))
    assert committed["dataset"] == produced["dataset"], (
        "the vendored homes were cut from a dataset production no longer names; "
        "regenerate with UPDATE_HOME_LAW=1"
    )
    assert committed == produced, (
        f"{VENDORED.name} is not what place_planes produces today; "
        "regenerate with UPDATE_HOME_LAW=1"
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
