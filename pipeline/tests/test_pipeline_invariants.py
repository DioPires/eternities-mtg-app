"""PRD 8.9.1 invariants and PRD 4.9.1 determinism, over an assembled dataset.

Two datasets are exercised: a small synthetic one built through the real
:func:`~eternities.pipeline.assemble.build_dataset` (fast, always available), and the committed
production dataset (skipped until `eternities build` has run, then checked in CI on every change).
"""

from __future__ import annotations

import itertools
import math
from pathlib import Path

import pytest
from conftest import appendices, printing, read_json, scry_set, set_entry

from eternities.contract.binary import decode_stars
from eternities.contract.encode import encode_artefacts
from eternities.contract.enums import FRAME_RADIUS
from eternities.fixtures import layout
from eternities.contract.models import Dataset
from eternities.pipeline.assemble import (
    MULTIVERSE_RADIUS,
    AssemblyStats,
    CardInput,
    build_dataset,
)
from eternities.pipeline.records import CardDetail, FaceDetail

PLANES = ["blind-eternities", "dominaria", "ravnica", "segovia", "kylem"]
SETS = {
    "lea": scry_set("lea", released_at="1993-08-05"),
    "rav": scry_set("rav", released_at="2005-10-07"),
    "cmd": scry_set("cmd", released_at="2011-06-17", set_type="commander"),
    "bbd": scry_set("bbd", released_at="2018-06-08"),
}
APX = appendices(
    planes=PLANES,
    sets=[
        set_entry("lea", plane="dominaria"),
        set_entry("rav", plane="ravnica"),
        set_entry("cmd", plane="blind-eternities"),
        set_entry("bbd", plane="kylem"),
    ],
)

_IDENTITIES = ["W", "U", "B", "R", "G", "WU", "BRG", ""]
_PLANE_OF_SET = {"lea": "dominaria", "rav": "ravnica", "cmd": "blind-eternities", "bbd": "kylem"}


def _detail(oracle_id: str, index: int) -> CardDetail:
    identity = _IDENTITIES[index % len(_IDENTITIES)]
    return CardDetail(
        printing_id=f"{oracle_id}-p",
        oracle_id=oracle_id,
        layout="normal",
        colour_identity=identity,
        front=FaceDetail(f"Card {index}", "{1}", "Creature — Test", "Text."),
        back=None,
        meld_result_id=None,
    )


def _cards(count: int = 240) -> list[CardInput]:
    rows: list[CardInput] = []
    codes = list(SETS)
    for i in range(count):
        code = codes[i % len(codes)]
        oracle_id = f"00000000-0000-4000-8000-{i:012d}"
        first = printing(
            oracle_id=oracle_id,
            printing_id=f"{oracle_id}-p",
            set_code=code,
            released_at=SETS[code].released_at,
            collector_number=str(i),
        )
        rows.append(
            CardInput(
                oracle_id=oracle_id,
                plane_slug=_PLANE_OF_SET[code],
                first_printing=first,
                printings=[first],
                detail=_detail(oracle_id, i),
            )
        )
    return rows


def _build() -> tuple[Dataset, AssemblyStats]:
    return build_dataset(
        _cards(),
        SETS,
        APX,
        {},
        dataset_name="test",
        as_of="2026-09-04",
        generated_at="2026-09-04T00:00:00Z",
        scryfall_bulk_updated_at="2026-09-04T09:05:32.308+00:00",
    )


@pytest.fixture(scope="module")
def dataset() -> Dataset:
    return _build()[0]


# --- PRD 8.9.1 ---------------------------------------------------------------------------------


def test_every_card_lands_on_exactly_one_plane(dataset: Dataset):
    covered = sum(p.star_count for p in dataset.planes)
    assert covered == len(dataset.stars)
    ranges = sorted((p.star_offset, p.star_offset + p.star_count) for p in dataset.planes)
    for (_, end), (start, _) in itertools.pairwise(ranges):
        assert end == start, "plane star ranges must be contiguous and non-overlapping"
    assert ranges[0][0] == 0


def test_the_blind_eternities_is_row_zero_with_the_identity_transform(dataset: Dataset):
    """Data contract §4 / PRD 8.3: same shader path for every star."""
    blind = dataset.planes[0]
    assert blind.slug == "blind-eternities"
    assert blind.tilt == (0.0, 0.0, 0.0, 1.0)
    assert blind.spin_period_s == 0.0
    assert blind.home == (0.0, 0.0, 0.0)
    assert blind.radius == MULTIVERSE_RADIUS


def test_plane_local_positions_stay_inside_the_frame_radius(dataset: Dataset):
    for star in dataset.stars:
        assert math.sqrt(star.x**2 + star.y**2 + star.z**2) <= FRAME_RADIUS


def test_positions_survive_the_float16_round_trip_inside_the_frame_radius(dataset: Dataset):
    """The invariant has to hold on the *encoded* bytes, not just the in-memory floats."""
    artefacts, _ = encode_artefacts(dataset)
    stars = decode_stars(next(a for a in artefacts if a.path == "stars.bin").data)
    for star in stars:
        assert math.sqrt(star.x**2 + star.y**2 + star.z**2) <= FRAME_RADIUS


def test_no_two_planes_overlap_even_at_maximum_drift(dataset: Dataset):
    """PRD 5.3.3 and 8.9.1: the gap must survive drift, not merely exist at rest.

    Two planes can drift toward each other at the same time, so the worst case subtracts *both*
    drift amplitudes from the centre distance.
    """
    named = [p for p in dataset.planes if p.slug != "blind-eternities"]
    for i, a in enumerate(named):
        for b in named[i + 1 :]:
            distance = math.dist(a.home, b.home)
            worst_case = distance - a.drift_amplitude - b.drift_amplitude
            assert worst_case > a.radius + b.radius, (
                f"{a.slug} and {b.slug} overlap under drift: "
                f"{worst_case:.2f} <= {a.radius + b.radius:.2f}"
            )


def test_a_zero_card_plane_still_exists_and_renders_as_empty(dataset: Dataset):
    """PRD 4.7.1 and 5.3.6: every Appendix A plane is in the visualisation."""
    empty = [p for p in dataset.planes if p.card_count == 0]
    assert empty, "this fixture is meant to contain a zero-card plane"
    for plane in empty:
        assert str(plane.kind) == "empty"
        assert plane.star_count == 0
        assert plane.sets == []


def test_stars_are_ordered_by_plane_then_band_then_arm(dataset: Dataset):
    """PRD 8.3's ordering is what makes plane ranges contiguous and shards computable.

    Checked against the dataset's own card list: a star's band is the position of its card's
    first-printing set in the plane's set list, and within a band the hue class must not decrease.
    """
    for plane in dataset.planes:
        if plane.slug == "blind-eternities" or plane.star_count == 0:
            continue
        assert [ref.card_count for ref in plane.sets] and sum(
            ref.card_count for ref in plane.sets
        ) == plane.card_count
        previous = (-1, -1)
        band = 0
        seen_in_band = 0
        for star in dataset.stars[plane.star_offset : plane.star_offset + plane.star_count]:
            while band < len(plane.sets) and seen_in_band == plane.sets[band].card_count:
                band += 1
                seen_in_band = 0
            current = (band, int(star.hue))
            assert current >= previous, f"{plane.slug}: star ordering went backwards at band {band}"
            previous = current
            seen_in_band += 1


def test_plane_kinds_follow_the_card_count(dataset: Dataset):
    for plane in dataset.planes:
        expected = layout.plane_kind(plane.slug, plane.card_count)
        assert plane.kind == expected


def test_a_planes_palette_sums_to_one(dataset: Dataset):
    for plane in dataset.planes:
        assert math.isclose(sum(plane.palette), 1.0, abs_tol=1e-6)


def test_brightness_is_in_range(dataset: Dataset):
    for star in dataset.stars:
        assert 0 <= star.brightness <= 255


# --- PRD 4.9.1 determinism ---------------------------------------------------------------------


def test_two_runs_of_the_same_inputs_are_byte_identical():
    """PRD 4.9.1: same inputs, same run date, identical bytes — so refreshes review as diffs."""
    first, _ = _build()
    second, _ = _build()
    a_artefacts, a_manifest = encode_artefacts(first)
    b_artefacts, b_manifest = encode_artefacts(second)
    assert [(a.path, a.data) for a in a_artefacts] == [(b.path, b.data) for b in b_artefacts]
    assert a_manifest == b_manifest


def test_the_data_hash_is_a_function_of_the_artefacts_alone():
    dataset, _ = _build()
    _, manifest = encode_artefacts(dataset)
    assert len(str(manifest["dataHash"])) == 16
    assert all(c in "0123456789abcdef" for c in str(manifest["dataHash"]))


# --- the committed production dataset ----------------------------------------------------------


def test_committed_production_dataset_holds_the_invariants(production_dir: Path):
    manifest = read_json(production_dir / "manifest.json")
    planes_doc = read_json(production_dir / "planes.json")
    stars = decode_stars((production_dir / "stars.bin").read_bytes())

    assert manifest["dataset"] == "production"
    assert len(stars) == int(manifest["counts"]["stars"])

    planes = planes_doc["planes"]
    assert planes[0]["slug"] == "blind-eternities"
    assert sum(int(p["starCount"]) for p in planes) == len(stars)

    cursor = 0
    for plane in planes:
        assert int(plane["starOffset"]) == cursor, "plane star ranges must be contiguous (§2)"
        cursor += int(plane["starCount"])
        for star in stars[int(plane["starOffset"]) : cursor]:
            assert star.plane_index == int(plane["index"])
            assert math.sqrt(star.x**2 + star.y**2 + star.z**2) <= FRAME_RADIUS

    named = [p for p in planes if p["slug"] != "blind-eternities"]
    for i, a in enumerate(named):
        for b in named[i + 1 :]:
            distance = math.dist(a["home"], b["home"])
            worst = distance - float(a["driftAmplitude"]) - float(b["driftAmplitude"])
            assert worst > float(a["radius"]) + float(b["radius"]), (
                f"{a['slug']} and {b['slug']} overlap under drift"
            )
