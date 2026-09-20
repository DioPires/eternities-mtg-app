"""The committed test vector must be exactly what this encoder produces, byte for byte.

The TypeScript decoder asserts against the same files (``web/test/test-vector.test.ts``), so this
test failing means the contract moved on one side only.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eternities.contract.encode import encode_artefacts
from eternities.testvector import build_test_vector, vector_summary

VECTOR_DIR = Path(__file__).resolve().parents[2] / "contract" / "test-vectors" / "v3"


def test_vector_directory_is_committed():
    assert VECTOR_DIR.is_dir(), (
        f"{VECTOR_DIR} is missing; regenerate it with `uv run eternities test-vector`"
    )


@pytest.mark.parametrize("relative", ["stars.bin", "sets.bin", "planes.json", "search.json"])
def test_encoded_artefact_matches_committed_bytes(relative: str):
    artefacts, _ = encode_artefacts(build_test_vector())
    encoded = next(a for a in artefacts if a.path == relative)
    committed = (VECTOR_DIR / relative).read_bytes()
    assert encoded.data == committed, (
        f"{relative} drifted from the committed vector; if the change is intended, bump "
        "contractVersion, update docs/data-contract.md, and get the contract change reviewed"
    )


def test_every_artefact_is_committed_and_nothing_extra():
    artefacts, _ = encode_artefacts(build_test_vector())
    expected = {a.path for a in artefacts} | {"manifest.json", "vector.json"}
    found = {
        str(p.relative_to(VECTOR_DIR)).replace("\\", "/")
        for p in VECTOR_DIR.rglob("*")
        if p.is_file()
    }
    assert found == expected


def test_summary_matches_committed_vector_json():
    committed = json.loads((VECTOR_DIR / "vector.json").read_text(encoding="utf-8"))
    assert vector_summary() == committed


def test_manifest_hash_matches_the_directory_contents():
    artefacts, manifest = encode_artefacts(build_test_vector())
    committed = json.loads((VECTOR_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert committed["dataHash"] == manifest["dataHash"]
    assert committed["files"] == [
        {"path": a.path, "bytes": len(a.data), "sha256": a.sha256} for a in artefacts
    ]


def test_zero_card_plane_still_gets_one_empty_shard():
    """PRD 5.3.6's empty plane must not need a special case in the loader (contract §9)."""
    _, manifest = encode_artefacts(build_test_vector())
    assert manifest["planeShards"]["segovia"] == 1
    shard = json.loads((VECTOR_DIR / "planes" / "segovia.0.json").read_text(encoding="utf-8"))
    assert shard["cards"] == []


# --- the `home`-law camera mirror (DEC-884) -----------------------------------------------------
#
# `fixtures/layout.py` restates six constants that live in TypeScript. Publishing them into
# `vector.json` is what makes a one-sided move visible, and it is visible in three different ways
# depending on which side moved and whether the vector was regenerated:
#
#   * Python constant moves, vector not regenerated -> `test_summary_matches_committed_vector_json`
#     and `test_the_camera_law_mirror_is_published_from_the_law_itself` both red here;
#   * Python constant moves, vector regenerated -> green here, red in `web/test/test-vector.test.ts`
#     against the renderer's unchanged values;
#   * TypeScript constant moves -> green here, red in `web/test/test-vector.test.ts`.
#
# The pairs below are the mirror's index: `layout`'s spelling on the left, the vector's on the
# right. A constant that is in `layout`'s mirror block and not in this list is unguarded, which is
# the state the whole leg exists to leave.
CAMERA_LAW_MIRROR = [
    ("HOME_ELEVATION_RAD", "homeElevationRad", 1.0),
    ("HOME_DISTANCE_FACTOR", "homeDistanceFactor", 1.0),
    ("REFERENCE_FOV_DEG", "fovDegrees", 1.0),
    ("REFERENCE_VIEWPORT_HEIGHT_PX", "referenceViewportHeightPx", 1.0),
    ("REFERENCE_FOCAL_PX", "referenceFocalPx", 1.0),
    ("PICK_PROXY_MARGIN", "pickProxyMargin", 1.0),
    # `layout` keeps the floor as a radius; `scenePicker.ts` declares it as a diameter, and the
    # vector is spelled in the renderer's units so the web half compares without converting.
    ("PICK_FLOOR_PX", "pickFloorDiameterPx", 2.0),
    ("DRIFT_VERTICAL_RATIO", "driftVerticalRatio", 1.0),
]


def test_the_camera_law_mirror_is_published_from_the_law_itself():
    """Every mirrored constant reaches the committed vector, and reaches it unchanged."""
    from eternities.fixtures import layout

    committed = json.loads((VECTOR_DIR / "vector.json").read_text(encoding="utf-8"))["cameraLaw"]
    assert set(committed) == {key for _, key, _ in CAMERA_LAW_MIRROR}, (
        "the published camera law and the mirror index have parted company; a constant that is "
        "published but not listed here is not checked against `layout`, and one that is listed "
        "but not published is not seen by the web half at all"
    )
    for attribute, key, scale in CAMERA_LAW_MIRROR:
        assert committed[key] == pytest.approx(getattr(layout, attribute) * scale, rel=1e-15), (
            f"`layout.{attribute}` and the committed `cameraLaw.{key}` disagree. If the constant "
            "really moved, regenerate the vector with `uv run eternities test-vector` — and "
            "expect web/test/test-vector.test.ts to fail next, because the renderer's half of "
            "the mirror has not moved with it (DEC-884)"
        )
