"""PRD 8.9.1 invariants and PRD 4.9.1 determinism, over an assembled dataset.

Three datasets are exercised, and the second one is here for a specific reason.

* ``synthetic`` — 5 planes and 240 cards. Small enough to read.
* ``dense`` — the whole Appendix A roster at 30 000 cards, production's shape.
* the committed production dataset — read from bytes, so it only moves after a rebuild.

Both of the first two go through the real :func:`~eternities.pipeline.assemble.build_dataset`,
which matters: two of these invariants are constraints on a *margin* the pipeline computes, and a
margin only binds when the data is dense enough to press against it.

On the synthetic fixture the tightest plane pair clears by 35.9 units and only 2 of its 240 stars
reach the frame clamp at all, so deleting the drift margin (``assemble.py``) or the float16 safety
margin (``layout.py``) left both tests green — the regressions surfaced only via
``test_committed_production_dataset_holds_the_invariants``, which reads already-committed bytes and
so cannot fail until after a rebuild and recommit. PRD 9.1.4 wants them on the pipeline change
itself.

``dense`` is where they live: the tightest pair clears by 2.6 units and 219 stars sit above 1.19,
against production's 2.76 and 155. Both mutations now fail. Note that ``fixture-scale`` would not
have done the job for the first one — it is laid out by the fixture generator, which computes its
own margin, so it cannot see a change to ``assemble.py``. ``test_fixtures.py`` covers that path.

The two margins are also asserted directly, below, so a mutation is caught by arithmetic as well as
by geometry. Building ``dense`` costs about eight seconds; the fixture is module-scoped.
"""

from __future__ import annotations

import itertools
import math
import struct
from pathlib import Path
from typing import Final

import pytest
from conftest import appendices, printing, read_json, scry_set, set_entry

from eternities.contract.binary import decode_stars
from eternities.contract.encode import encode_artefacts
from eternities.contract.enums import BLIND_ETERNITIES_SLUG, FRAME_RADIUS
from eternities.contract.models import Dataset
from eternities.fixtures import layout
from eternities.pipeline.appendices import Appendices, load_appendices
from eternities.pipeline.assemble import (
    MULTIVERSE_RADIUS,
    AssemblyStats,
    CardInput,
    build_dataset,
)
from eternities.pipeline.records import CardDetail, FaceDetail, ScrySet

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


def _float16(value: float) -> float:
    """``value`` as the encoder stores it: half precision, then back (data contract §3)."""
    return struct.unpack("<e", struct.pack("<e", value))[0]


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


def _build(
    cards: list[CardInput] | None = None,
    sets: dict[str, ScrySet] | None = None,
    apx: Appendices | None = None,
) -> tuple[Dataset, AssemblyStats]:
    return build_dataset(
        _cards() if cards is None else cards,
        SETS if sets is None else sets,
        APX if apx is None else apx,
        {},
        dataset_name="test",
        as_of="2026-09-04",
        generated_at="2026-09-04T00:00:00Z",
        scryfall_bulk_updated_at="2026-09-04T09:05:32.308+00:00",
    )


# --- the dense dataset (see the module docstring) ----------------------------------------------

DENSE_CARDS: Final = 30_000
DENSE_DUST_SHARE: Final = 0.22
"""PRD 9.2.2's expected band; production came in at 17.4%, which is denser dust, not sparser."""


def _dense_allocation(named: list[str]) -> dict[str, int]:
    """Production's plane-size distribution: big spirals, a tail of clouds, some empty planes.

    Deterministic on purpose — a seeded shuffle here would make a failure depend on which seed the
    test happened to draw, and the point is a constraint that binds every run.
    """
    zero, small = named[-6:], named[-24:-6]
    large = named[: -len(zero) - len(small)]
    counts = dict.fromkeys(zero, 0)
    counts.update(
        {slug: 1 + (i * 7) % (layout.SPIRAL_THRESHOLD - 1) for i, slug in enumerate(small)}
    )

    weights = [1.0 / (i + 1.6) ** 0.95 for i in range(len(large))]
    budget = DENSE_CARDS - round(DENSE_CARDS * DENSE_DUST_SHARE) - sum(counts.values())
    scale = budget / sum(weights)
    for slug, weight in zip(large, weights, strict=True):
        counts[slug] = max(layout.SPIRAL_THRESHOLD, int(weight * scale))
    return counts


def _dense_dataset() -> Dataset:
    """The whole Appendix A roster at roughly production's card count, through ``build_dataset``.

    Appendix A rather than a synthetic roster: the number of planes is what decides how tightly
    ``place_planes`` has to pack, and that is the quantity the drift margin is spent on.
    """
    roster = list(load_appendices().plane_slugs)
    named = [s for s in roster if s != BLIND_ETERNITIES_SLUG]
    counts = _dense_allocation(named)
    counts[BLIND_ETERNITIES_SLUG] = DENSE_CARDS - sum(counts.values())

    sets: dict[str, ScrySet] = {}
    rows: list[CardInput] = []
    index = 0
    for plane_index, slug in enumerate(roster):
        # One band per ~400 cards, so the chronology bands of 5.4.2 are exercised at scale too.
        bands = max(1, min(24, counts[slug] // 400))
        for band in range(bands):
            code = f"s{plane_index:03d}{band:02d}"
            sets[code] = scry_set(code, released_at=f"{1993 + band}-01-01")
        for i in range(counts[slug]):
            code = f"s{plane_index:03d}{i % bands:02d}"
            oracle_id = f"00000000-0000-4000-8000-{index:012d}"
            first = printing(
                oracle_id=oracle_id,
                printing_id=f"{oracle_id}-p",
                set_code=code,
                released_at=sets[code].released_at,
                collector_number=str(i),
            )
            rows.append(
                CardInput(
                    oracle_id=oracle_id,
                    plane_slug=slug,
                    first_printing=first,
                    printings=[first],
                    detail=_detail(oracle_id, index),
                )
            )
            index += 1

    apx = appendices(planes=roster, sets=[set_entry(code, plane="dominaria") for code in sets])
    return _build(rows, sets, apx)[0]


@pytest.fixture(scope="module", params=["synthetic", "dense"])
def dataset(request: pytest.FixtureRequest) -> Dataset:
    """Every 8.9.1 invariant runs against both, for the reason in the module docstring."""
    return _build()[0] if request.param == "synthetic" else _dense_dataset()


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
    worst = max(math.sqrt(s.x**2 + s.y**2 + s.z**2) for s in stars)
    assert worst <= FRAME_RADIUS, (
        f"a star decodes at {worst!r}, outside the frame radius of {FRAME_RADIUS} — "
        "layout.FRAME_CLAMP_SAFETY is what keeps the clamp inside float16's rounding"
    )


def test_the_frame_clamp_leaves_room_for_the_float16_round_trip():
    """PRD 8.9.1, asserted on the margin itself rather than on a sample of stars.

    ``layout._clamp_to_frame`` puts a star that overruns the frame *at* its limit, so the limit is
    the worst case the encoder ever sees. Clamping to the frame radius exactly would round up and
    break the invariant; this pins the safety factor that stops it.
    """
    assert _float16(FRAME_RADIUS) > FRAME_RADIUS, "float16(1.2) is 1.2001953125 — the reason for it"
    limit = FRAME_RADIUS * layout.FRAME_CLAMP_SAFETY
    assert _float16(limit) <= FRAME_RADIUS


def test_the_placement_margin_clears_twice_the_drift_amplitude():
    """PRD 5.3.3 and ``place_planes``'s contract, asserted on the margin the caller passes.

    Rejection sampling only guarantees the gap the margin asks for, so if the margin stops covering
    two planes drifting toward each other, the overlap invariant is broken by construction whatever
    a particular seed happens to produce.
    """
    mean_spacing = 1.0
    margin = layout.PLANE_MARGIN_FACTOR * mean_spacing
    drift = layout.plane_motion("dominaria", mean_spacing).drift_amplitude
    assert margin > 2.0 * drift, (
        f"margin {margin} does not clear two planes drifting {drift} toward each other"
    )


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
                f"{worst_case:.2f} <= {a.radius + b.radius:.2f} — the anti-overlap margin "
                "place_planes is given (layout.PLANE_MARGIN_FACTOR) is what buys this gap"
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


# --- PRD 8.6.2's arm width, and what changing it is allowed to touch (DEC-683 / DEC-684) --------


def test_the_arm_width_base_leaves_a_dark_lane_between_arms():
    """The regression DEC-683 found: at ``ARM_WIDTH_BASE == 0.5`` the arms tile the disc.

    An arm's full angular width is ``2 * (2*pi/ARMS) * base * scale``, against a spacing of exactly
    ``2*pi/ARMS``. At base 0.5 and ``scale == 1.0`` those are equal, so there is no gap — and
    :func:`layout.arm_width_scale` returns exactly 1.0 when a plane's colours are balanced, which
    is the *large* planes PRD 9.3 criterion 2 governs. The base has to leave room at scale 1.0.
    """
    spacing = 2.0 * math.pi / layout.ARMS
    full_width = 2.0 * spacing * layout.ARM_WIDTH_BASE * layout.arm_width_scale(100, 100.0)
    assert layout.arm_width_scale(100, 100.0) == 1.0, "balanced colours must give scale 1.0"
    assert full_width < spacing, (
        f"arms {math.degrees(full_width):.1f} deg wide at a spacing of "
        f"{math.degrees(spacing):.1f} deg leave no lane (PRD 9.3 criterion 2)"
    )
    lane = math.degrees(spacing - full_width)
    assert lane >= 15.0, f"only a {lane:.1f} deg lane; too narrow to read at the tether settle"


@pytest.mark.parametrize("hue", [layout.HueClass.MULTICOLOUR, layout.HueClass.COLOURLESS])
def test_the_arm_width_base_does_not_reach_the_bulge_or_the_halo(hue: layout.HueClass):
    """Those two branches never read the spread, so a re-cut must leave their cards untouched.

    This is the invariant the DEC-684 re-cut was verified against on the production diff, kept here
    so the next change to the constant does not have to re-derive it from a dataset that no longer
    exists (8.8.3 deletes the predecessor).
    """
    motion = layout.plane_motion("dominaria", 10.0)

    def place(oracle_id: str, width: float) -> tuple[float, float, float]:
        return layout.card_position(
            plane_slug="dominaria",
            oracle_id=oracle_id,
            hue=hue,
            band=3,
            band_count=8,
            motion=motion,
            arm_width_scale=width,
            spiral=True,
        )

    for oracle_id in ("a" * 36, "b" * 36, "c" * 36):
        assert place(oracle_id, 0.4) == place(oracle_id, 1.6), (
            f"{hue.name} moved with the arm width"
        )


def test_the_arm_width_base_moves_x_and_z_but_never_y():
    """``y`` is drawn from its own rng stream, so an arm re-cut must not disturb the disc thickness.

    Proven non-vacuous by the ``x``/``z`` assertion below it: if the width stopped reaching the arm
    branch at all, every coordinate would match and the first assertion would fail.
    """
    motion = layout.plane_motion("dominaria", 10.0)

    def place(oracle_id: str, band: int, width: float) -> tuple[float, float, float]:
        return layout.card_position(
            plane_slug="dominaria",
            oracle_id=oracle_id,
            hue=layout.HueClass.RED,
            band=band,
            band_count=8,
            motion=motion,
            arm_width_scale=width,
            spiral=True,
        )

    moved = 0
    for index in range(200):
        narrow = place(f"{index:036d}", index % 8, 0.4)
        wide = place(f"{index:036d}", index % 8, 1.6)
        assert narrow[1] == wide[1], f"card {index}: y moved with the arm width"
        if (narrow[0], narrow[2]) != (wide[0], wide[2]):
            moved += 1
    assert moved > 150, f"only {moved} of 200 arm cards moved; the width is not reaching the arm"
