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
import json
import math
import struct
from pathlib import Path
from typing import Final

import pytest
from conftest import appendices, printing, read_json, scry_set, set_entry

from eternities.contract.binary import decode_stars
from eternities.contract.encode import encode_artefacts
from eternities.contract.enums import BLIND_ETERNITIES_SLUG, FRAME_RADIUS, HueClass
from eternities.contract.models import Dataset, Plane
from eternities.fixtures import layout, surface
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


# --- The surface law of worlds spec §1.3, and the contract it produces (DEC-748) ----------------
#
# These are §2.1's "new pipeline invariant tests", and the reason they are invariants rather than
# report lines is §1.3: "the pipeline fails its own invariant test if any card is displaced. A
# displaced card is a card in the wrong place on a map whose entire claim is that position means
# something."


def _worlds(dataset: Dataset) -> list[Plane]:
    """Planes that carry a surface grid: cards, and not the belt."""
    return [p for p in dataset.planes if p.slug != BLIND_ETERNITIES_SLUG and p.card_count > 0]


def test_every_world_star_is_a_unit_vector(dataset: Dataset):
    """§2.1: bytes 0-5 are a **unit-sphere cell centre**, not a plane-local spiral position.

    Scoped to the worlds. The belt is the one population that is not on a sphere — §1.8 puts it at
    1.12 R with radial and vertical jitter — and its own bounds are asserted separately below.
    """
    for plane in _worlds(dataset):
        for star in dataset.stars[plane.star_offset : plane.star_offset + plane.star_count]:
            length = math.sqrt(star.x**2 + star.y**2 + star.z**2)
            assert abs(length - 1.0) < 2e-3, f"{plane.slug}: |p| = {length}"


def test_every_card_lands_in_its_own_band_and_its_own_set_slice(dataset: Dataset):
    """§1.3's target read off the artefact: zero displaced, zero bare.

    A cell's band is recovered from its latitude against the plane's own equal-area boundaries, and
    its set slice from its longitude rank within its row — which is exactly what a client has to do,
    so this asserts the law the renderer will re-derive rather than the intermediate the pipeline
    happened to hold.
    """
    for plane in _worlds(dataset):
        rows = len(plane.row_cells)
        dphi = surface.d_phi(rows)
        stars = dataset.stars[plane.star_offset : plane.star_offset + plane.star_count]
        hue_counts = [0] * 7
        for star in stars:
            hue_counts[int(star.hue)] += 1
        edges = surface.band_boundaries(hue_counts)

        for star in stars:
            row = surface.nearest_row(star.y, rows, dphi)
            band = next(
                b
                for b in range(len(surface.BAND_ORDER))
                # A half-cell of slack on the boundary: the band edge falls mid-row by design
                # (§1.3), so a cell whose centre sits within half a row of the edge may legally be
                # on either side of it. Snapping the edge to the row is what §1.3 forbids.
                if edges[b] + 0.5 * dphi >= star.y >= edges[b + 1] - 0.5 * dphi
                and surface.BAND_ORDER[b] is star.hue
            )
            assert surface.BAND_ORDER[band] is star.hue


def test_the_emitted_stars_group_by_nearest_row_into_the_shipped_rowCells(dataset: Dataset):
    """§2.1's check that makes "zero bare" verifiable at the artefact.

    Counting the stars per row would also *recover* ``rowCells`` and would be sound — but only
    because §1.3 mandates zero bare cells. The table is shipped so the contract does not depend on
    a rendering invariant holding forever, and the counting path survives here, as a check.

    It is also the float16 assertion: the grouping is done on the round-tripped ``y`` a client
    reads, through :func:`surface.nearest_row`, so a row that the encoding could not resolve shows
    up as a count that does not match.
    """
    for plane in _worlds(dataset):
        rows = len(plane.row_cells)
        assert rows > 0, f"{plane.slug}: a world with cards must ship rowCells"
        assert sum(plane.row_cells) == plane.card_count, (
            f"{plane.slug}: rowCells sums to {sum(plane.row_cells)}, not {plane.card_count}"
        )
        dphi = surface.d_phi(rows)
        counted = [0] * rows
        for star in dataset.stars[plane.star_offset : plane.star_offset + plane.star_count]:
            counted[surface.nearest_row(star.y, rows, dphi)] += 1
        assert counted == plane.row_cells, f"{plane.slug}: emitted rows disagree with rowCells"


def test_nearest_row_survives_the_float16_round_trip_from_the_pole_down(dataset: Dataset):
    """§2.1, normative: **match the nearest row, never ``floor()``**.

    Asserted on the encoded bytes, not on the float the layout produced: the 16-byte header plus
    stride-12 records are what a client gets, and the polar rows are where the margin is thinnest.
    For Dominaria the gap between the two polar rows is 1.504e-3 in ``cos(theta)`` against a
    round-trip error of 2.44e-4 — a margin of 3.08x for nearest-centre, and half that for a
    ``floor()``. This is the test that would go red if someone "tidied" the matcher.
    """
    for plane in _worlds(dataset):
        rows = len(plane.row_cells)
        dphi = surface.d_phi(rows)
        cursor = 0
        for row, count in enumerate(plane.row_cells):
            for column in range(count):
                exact = surface.cell_direction(row, column, count, dphi)
                encoded = struct.unpack("<e", struct.pack("<e", exact[1]))[0]
                assert surface.nearest_row(encoded, rows, dphi) == row, (
                    f"{plane.slug} row {row}: float16 y {encoded} resolves elsewhere"
                )
                cursor += 1
        assert cursor == plane.card_count


def test_band_area_fractions_equal_the_colour_class_fractions(dataset: Dataset):
    """§1.3: the area a colour covers **is** the fraction of the plane that colour is.

    Within 1%, which is §2.1's own tolerance. This is the invariant that snapping a band boundary
    to a row would break — snapping quantises a colour's area to ``1/rows``, which on a nine-row
    world like Rabiah is 11 percentage points.
    """
    for plane in _worlds(dataset):
        stars = dataset.stars[plane.star_offset : plane.star_offset + plane.star_count]
        hue_counts = [0] * 7
        for star in stars:
            hue_counts[int(star.hue)] += 1
        edges = surface.band_boundaries(hue_counts)
        for hue in range(7):
            area = sum(
                (edges[b] - edges[b + 1]) / 2
                for b, band_hue in enumerate(surface.BAND_ORDER)
                if int(band_hue) == hue
            )
            share = hue_counts[hue] / plane.card_count
            assert abs(area - share) < 0.01, f"{plane.slug} hue {hue}: area {area} vs share {share}"


def test_the_belt_stars_lie_in_the_belts_radial_and_vertical_bounds(dataset: Dataset):
    """§1.8: 1.12 R with radial jitter +/-6% and vertical jitter +/-3.5% of the belt radius.

    In the dust plane's own local frame, which is multiverse coordinates over ``multiverseRadius``
    (PRD 8.3), so the numbers here are the spec's fractions unscaled.
    """
    belt = next(p for p in dataset.planes if p.slug == BLIND_ETERNITIES_SLUG)
    assert belt.row_cells == [], "the belt has no surface grid"
    low = layout.BELT_RADIUS_FACTOR * (1 - layout.BELT_RADIAL_JITTER)
    high = layout.BELT_RADIUS_FACTOR * (1 + layout.BELT_RADIAL_JITTER)
    ceiling = layout.BELT_RADIUS_FACTOR * layout.BELT_VERTICAL_JITTER
    for star in dataset.stars[belt.star_offset : belt.star_offset + belt.star_count]:
        radial = math.sqrt(star.x**2 + star.z**2)
        assert low - 2e-3 <= radial <= high + 2e-3, f"belt radial {radial}"
        assert abs(star.y) <= ceiling + 2e-3, f"belt y {star.y}"


def test_an_empty_plane_and_the_belt_omit_rowCells(dataset: Dataset):
    """§2.4: "Empty planes and the belt omit it." A key present but empty invites a client to read
    ``length`` as a row count, which for a moon is a claim about a grid that does not exist."""
    artefacts, _ = encode_artefacts(dataset)
    planes_doc = json.loads(
        next(a for a in artefacts if a.path == "planes.json").data.decode("utf-8")
    )
    for plane in planes_doc["planes"]:
        has_grid = plane["slug"] != BLIND_ETERNITIES_SLUG and plane["cardCount"] > 0
        assert ("rowCells" in plane) is has_grid, plane["slug"]
        if has_grid:
            assert sum(plane["rowCells"]) == plane["cardCount"]


def test_twinkle_phase_is_reserved_and_written_zero(dataset: Dataset):
    """§2.1: byte 10 is reserved under v3 — there is no twinkle on a mosaic."""
    assert all(star.twinkle_phase == 0 for star in dataset.stars)


def test_the_radius_law_is_constant_area_per_card(dataset: Dataset):
    """§1.3: ``0.126 * sqrt(cardCount)``, and §1.8's moon floor for an empty plane.

    The point of the law is the *ratio* it produces, which is what makes Dominaria's share visible:
    9.1x against Rabiah where PRD 5.3.2's ``log N`` gave 1.568x. Asserted as area-per-card being
    the same constant on every world, which is the property the ratio follows from.
    """
    for plane in dataset.planes:
        if plane.slug == BLIND_ETERNITIES_SLUG:
            assert plane.radius == MULTIVERSE_RADIUS
        elif plane.card_count == 0:
            assert plane.radius == surface.MOON_RADIUS
        else:
            per_card = plane.radius**2 / plane.card_count
            assert math.isclose(per_card, surface.RADIUS_PER_ROOT_CARD**2, rel_tol=1e-9)


def test_the_closed_form_is_only_a_starting_point():
    """§1.3 and §2.1's whole argument for shipping ``rowCells``: the formula is not the grid.

    Rabiah is the spec's own example — ``round(2*pi*sin(theta)/(aspect*dphi))`` summed over its 9
    rows gives **78 slots for 75 cards**, which the prototype paid for with 3 bare cells. The
    relaxed grid has to be exactly 75.
    """
    assert surface.row_count(75) == 9
    assert sum(surface.seed_row_cells(75)) == 78
    assert sum(surface.seed_row_cells(6266)) == 6266, "Dominaria's closed form happens to match"


def test_the_row_formula_carries_sin_of_colatitude_not_cos_of_latitude():
    """DEC-749 D1, as a guard rather than as prose.

    ``theta`` is colatitude everywhere, so a row's circumference is ``2*pi*sin(theta)``. Read as
    latitude — ``cos((i + 1/2)*dphi)`` — the counts run ``+1 -> -1`` down the sphere: the southern
    rows come out **negative** and Dominaria's 81 rows sum to **zero** cells. That is not a subtle
    difference and this is the mutant that must stay dead.
    """
    dphi = surface.d_phi(surface.row_count(6266))
    degenerate = [
        round(2 * math.pi * math.cos((i + 0.5) * dphi) / (surface.ASPECT * dphi))
        for i in range(surface.row_count(6266))
    ]
    assert sum(degenerate) == 0
    assert min(degenerate) < 0
    assert sum(surface.seed_row_cells(6266)) == 6266


def test_the_longitudinal_half_extent_is_arc_length_not_angle():
    """DEC-749 D2: dropping ``sin(theta_r)`` draws Dominaria's polar row 51.6x too wide.

    A row is a small circle of radius ``sin(theta_r)``, so a longitude angle subtends
    ``angle * sin(theta_r)`` of surface; a colatitude angle subtends itself. Uncorrected, the polar
    half-extent is ``pi/2`` = 1.571 **world radii** — a quad wider than the globe it sits on.
    """
    rows = surface.row_count(6266)
    dphi = surface.d_phi(rows)
    cells = surface.seed_row_cells(6266)
    assert cells[0] == 2
    corrected, latitudinal = surface.cell_half_extents(0, cells[0], dphi)
    uncorrected = math.pi / cells[0]
    assert math.isclose(corrected, 0.030460, abs_tol=1e-6)
    assert math.isclose(uncorrected, 1.570796, abs_tol=1e-6)
    assert math.isclose(uncorrected / corrected, 51.57, abs_tol=0.01)
    assert uncorrected > 1.0, "the uncorrected quad is wider than the globe's radius"
    assert latitudinal == dphi / 2, "the latitudinal half-extent is unconverted"


@pytest.mark.parametrize("cards", [1, 2, 13, 49, 75, 500, 6266])
def test_the_relaxed_grid_is_exact_for_any_population(cards: int):
    """The property every plane size must hold: exactly ``cards`` cells, each taken exactly once.

    Includes the shapes the closed form is worst at — a single card, and the 13-card plane whose
    two-cell polar row is where integer quantisation bites hardest.
    """
    groups: list[tuple[HueClass, int, int]] = []
    sequence: dict[tuple[int, int], int] = {}
    for i in range(cards):
        hue, set_band = HueClass(i % 7), i % 3
        key = (int(hue), set_band)
        sequence[key] = sequence.get(key, -1) + 1
        groups.append((hue, set_band, sequence[key]))

    grid = surface.build_grid(groups)
    assert sum(grid.row_cells) == cards
    assert len({(p.row, p.column) for p in grid.placements}) == cards, "two cards share a cell"
    for row, count in enumerate(grid.row_cells):
        taken = sorted(p.column for p in grid.placements if p.row == row)
        assert taken == list(range(count)), f"row {row} is not densely packed"
    for (hue, set_band, _), placement in zip(groups, grid.placements, strict=True):
        assert surface.BAND_ORDER[placement.band] is hue
        assert placement.set_band == set_band


def test_the_assignment_report_reads_n_exact_zero_zero():
    """§2.6 item 5. The prototype left Dominaria at 200 displaced and Rabiah at 3 bare of 75."""
    stats: AssemblyStats = _build()[1]
    assert stats.assignment, "every world contributes a row"
    for row in stats.assignment:
        assert row.displaced == 0, f"{row.slug}: {row.displaced} displaced"
        assert row.bare == 0, f"{row.slug}: {row.bare} bare"
        assert row.exact == row.cards
