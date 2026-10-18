"""The independent checker (PRD v4 3.2, 5.4.18 (10)): its predicates, then its rules on a world.

The world tests lay Rabiah out with the allocator (75 stands, one set site), check the emitted
files, and then change one thing at a time in the bytes or in the world document: each change
must be reported under its rule. An era site is made from the same world by hand, with a second
set and a chapter stone, so the rules of invariant 11 have something to read.
"""

from __future__ import annotations

import ast
import copy
import json
import shutil
import struct
import uuid
from fractions import Fraction
from functools import cache
from itertools import pairwise
from math import isqrt
from pathlib import Path
from typing import Any

import pytest

from eternities.layout import build, check, emit, fixtures, trig
from eternities.layout.cards import read_plane
from eternities.layout.check import CheckedCard, CheckResult
from eternities.layout.constants import (
    APRON_DEPTH,
    APRON_WIDTH,
    CLUSTER_RADIUS,
    CORRIDOR_ARC_WINDOW,
    FOOTPRINT_DEPTH,
    FOOTPRINT_WIDTH,
    GAP_BETWEEN,
    GAP_TO_END,
    GAP_TO_FIRST,
    JITTER_RADIUS,
    LATTICE_HALF_PITCH,
    LATTICE_PITCH,
    LATTICE_ROW,
    MIN_CLUSTER,
    MIN_STAND_SPACING,
    PATH_HALF_WIDTH,
    PLAZA_EDGE_RADIUS,
    PLAZA_RADIUS,
)
from eternities.lore.vocabulary import load_hero_entries

REPO = Path(__file__).resolve().parents[2]
PACK = REPO / "web" / "public" / "data" / "a5846bec28d1447e"
PREDICATES = REPO / "contract" / "test-vectors" / "v4" / "layout" / "predicates"
MODULE = Path(check.__file__)

HEADER = struct.Struct("<4sBBHII")
RECORD = struct.Struct("<16sBBBBBBHHHiiiHHHH")
ORACLE, MASK, CLASS, SITE, SET, X, Z, YAW, CLUSTER = 0, 2, 3, 7, 8, 10, 11, 12, 16
"""The fields of a 48-byte record that the tests change (4.13.3)."""

type Point = tuple[int, int]

SQUARE = [(0, 0), (10, 0), (10, 10), (0, 10)]
NOTCHED = [(0, 0), (20, 0), (20, 10), (12, 10), (10, 5), (8, 10), (0, 10)]
"""A 20 by 10 rectangle whose top edge has a notch down to (10, 5)."""


# The predicates of 5.4.18 (10).


def test_a_point_on_an_edge_or_a_vertex_is_inside():
    assert check.point_in_polygon((5, 5), SQUARE)
    assert check.point_in_polygon((10, 5), SQUARE)
    assert check.point_in_polygon((5, 0), SQUARE)
    assert check.point_in_polygon((0, 0), SQUARE)
    assert check.point_in_polygon((10, 10), SQUARE)
    assert not check.point_in_polygon((11, 5), SQUARE)
    assert not check.point_in_polygon((5, -1), SQUARE)
    # Level with a vertex and outside: the ray through the vertex is counted once or not at all.
    assert not check.point_in_polygon((-1, 10), SQUARE)
    assert not check.point_in_polygon((-1, 0), SQUARE)


def test_the_even_odd_rule_reads_a_notch():
    assert not check.point_in_polygon((10, 8), NOTCHED)
    assert check.point_in_polygon((10, 5), NOTCHED)
    assert check.point_in_polygon((10, 4), NOTCHED)
    assert check.point_in_polygon((9, 7), NOTCHED)
    assert check.point_in_polygon((4, 5), NOTCHED)
    assert not check.point_in_polygon((10, 10), NOTCHED)
    # Level with the notch's tip, on either side of it.
    assert check.point_in_polygon((1, 5), NOTCHED)
    assert check.point_in_polygon((19, 5), NOTCHED)
    assert not check.point_in_polygon((21, 5), NOTCHED)


def test_segments_intersect_by_the_signs_of_cross_products():
    assert check.segments_intersect((0, 0), (10, 10), (0, 10), (10, 0))
    assert not check.segments_intersect((0, 0), (10, 0), (0, 1), (10, 1))
    # One touches the other's interior with its end.
    assert check.segments_intersect((0, 0), (10, 0), (5, 0), (5, 7))
    assert not check.segments_intersect((0, 0), (10, 0), (5, 1), (5, 7))
    # The lines cross, the segments do not.
    assert not check.segments_intersect((0, 0), (10, 0), (12, -5), (12, 5))


def test_collinear_touching_segments_intersect():
    assert check.segments_intersect((0, 0), (5, 0), (5, 0), (9, 0))
    assert check.segments_intersect((0, 0), (5, 0), (3, 0), (9, 0))
    assert check.segments_intersect((0, 0), (9, 9), (3, 3), (4, 4))
    assert not check.segments_intersect((0, 0), (5, 0), (6, 0), (9, 0))
    # A segment of no length is a point.
    assert check.segments_intersect((3, 0), (3, 0), (0, 0), (5, 0))
    assert not check.segments_intersect((3, 1), (3, 1), (0, 0), (5, 0))


def test_polygons_intersect_when_edges_cross_or_one_is_nested():
    inner = [(4, 4), (6, 4), (6, 6), (4, 6)]
    assert check.polygons_intersect(SQUARE, inner)
    assert check.polygons_intersect(inner, SQUARE)
    assert check.polygons_intersect(SQUARE, [(8, 8), (12, 8), (12, 12), (8, 12)])
    assert not check.polygons_intersect(SQUARE, [(11, 0), (15, 0), (15, 10), (11, 10)])
    # Touching counts: a shared edge, and a shared corner.
    assert check.polygons_intersect(SQUARE, [(10, 0), (15, 0), (15, 10), (10, 10)])
    assert check.polygons_intersect(SQUARE, [(10, 10), (15, 10), (15, 15), (10, 15)])
    # In the notch and clear of its sides: boxes overlap, shapes do not.
    assert not check.polygons_intersect(NOTCHED, [(10, 8), (11, 10), (9, 10)])
    assert check.polygons_intersect(NOTCHED, [(10, 4), (11, 10), (9, 10)])


def test_a_strip_that_touches_does_not_intersect_and_one_millimetre_nearer_does():
    block = [(0, 0), (1_000, 0), (1_000, 1_000), (0, 1_000)]
    half = 1_500
    beside = [(-5_000, 1_000 + half), (5_000, 1_000 + half)]
    assert not check.strip_intersects_polygon(beside, half, block)
    nearer = [(x, z - 1) for x, z in beside]
    assert check.strip_intersects_polygon(nearer, half, block)
    # Past the strip's end the distance is to the end point: exactly the half width, then less.
    beyond = [(-5_000, 500), (-half, 500)]
    assert not check.strip_intersects_polygon(beyond, half, block)
    assert check.strip_intersects_polygon([(-5_000, 500), (-half + 1, 500)], half, block)
    # Diagonally off a corner: 900 and 1,200 make exactly 1,500.
    corner = [(-900, 2_200), (-900, 9_000)]
    assert not check.strip_intersects_polygon(corner, half, block)
    assert check.strip_intersects_polygon([(-900, 2_199), (-900, 9_000)], half, block)


def test_a_strip_catches_a_shape_wholly_inside_its_width_and_a_shape_it_runs_through():
    pebble = [(0, 100), (50, 100), (50, 150), (0, 150)]
    assert check.strip_intersects_polygon([(-5_000, 0), (5_000, 0)], 1_500, pebble)
    # A long segment through the middle of a large polygon: no vertex of either is near the other.
    field = [(-50_000, -50_000), (50_000, -50_000), (50_000, 50_000), (-50_000, 50_000)]
    assert check.strip_intersects_polygon([(-90_000, 0), (90_000, 0)], 10, field)
    assert check.strip_intersects_polygon([(-1_000, 0), (1_000, 0)], 10, field)
    assert not check.strip_intersects_polygon([(60_000, 0), (90_000, 0)], 10, field)


def reference_nearer(a: Point, b: Point, polygon: list[Point], limit: int) -> bool:
    """The filled-shape distance of 5.4.18 (10) with exact rationals and no shortcut."""
    edges = [(polygon[index - 1], polygon[index]) for index in range(len(polygon))]
    if (
        any(check.segments_intersect(a, b, p, q) for p, q in edges)
        or check.point_in_polygon(a, polygon)
        or check.point_in_polygon(b, polygon)
    ):
        return limit > 0

    def to_segment(point: Point, start: Point, end: Point) -> Fraction:
        dx, dz = end[0] - start[0], end[1] - start[1]
        length = dx * dx + dz * dz
        along = Fraction(0)
        if length:
            along = Fraction((point[0] - start[0]) * dx + (point[1] - start[1]) * dz, length)
            along = max(Fraction(0), min(Fraction(1), along))
        return (point[0] - start[0] - along * dx) ** 2 + (point[1] - start[1] - along * dz) ** 2

    least = min(
        [to_segment(vertex, a, b) for vertex in polygon]
        + [to_segment(end, p, q) for p, q in edges for end in (a, b)]
    )
    return least < limit


def test_the_distance_of_a_segment_to_a_polygon_agrees_with_the_rule_written_out():
    shapes = [
        [(10, 10), (16, 10), (16, 14), (10, 14)],
        [(12, 9), (19, 13), (11, 17)],
        [(x + 4, z + 8) for x, z in NOTCHED],
    ]
    state = 2_026
    drawn: list[int] = []
    for _ in range(4 * 4_000):
        state = (state * 6_364_136_223_846_793_005 + 1_442_695_040_888_963_407) % (1 << 64)
        drawn.append((state >> 33) % 31)
    near = far = 0
    for case in range(4_000):
        ax, az, bx, bz = drawn[4 * case : 4 * case + 4]
        a, b = (ax, az), (bx if case % 9 else ax, bz if case % 9 else az)
        polygon = shapes[case % 3]
        for limit in (0, 1, 4, 5, 9, 16, 25, 50):
            expected = reference_nearer(a, b, polygon, limit)
            assert check._segment_nearer(a, b, polygon, limit) is expected, (a, b, polygon, limit)
            near += expected
            far += not expected
    assert near > 2_000 and far > 2_000


def test_a_stands_shapes_are_built_from_its_position_and_its_yaw():
    scale = trig.SCALE
    half_depth, half_width, half_apron = (
        FOOTPRINT_DEPTH // 2,
        FOOTPRINT_WIDTH // 2,
        APRON_WIDTH // 2,
    )
    footprint, apron, front = check.stand_shapes(10_000, -20_000, 0, table())
    # Facing +x: the depth runs along x and the width along z.
    assert footprint == tuple(
        (x * scale, z * scale)
        for x, z in (
            (10_000 - half_depth, -20_000 - half_width),
            (10_000 + half_depth, -20_000 - half_width),
            (10_000 + half_depth, -20_000 + half_width),
            (10_000 - half_depth, -20_000 + half_width),
        )
    )
    assert apron == tuple(
        (x * scale, z * scale)
        for x, z in (
            (10_000 + half_depth, -20_000 - half_apron),
            (10_000 + half_depth + APRON_DEPTH, -20_000 - half_apron),
            (10_000 + half_depth + APRON_DEPTH, -20_000 + half_apron),
            (10_000 + half_depth, -20_000 + half_apron),
        )
    )
    assert front == ((10_000 + half_depth + APRON_DEPTH) * scale, -20_000 * scale)
    # Facing +z, counter-clockwise from +x (4.13.3): the depth runs along z.
    footprint, apron, front = check.stand_shapes(0, 0, 90_000_000, table())
    assert front == (0, (half_depth + APRON_DEPTH) * scale)
    assert {z for _, z in footprint} == {-half_depth * scale, half_depth * scale}
    assert {x for x, _ in apron} == {-half_apron * scale, half_apron * scale}
    # A yaw between two counts of the table is truncated to the lower one (5.4.18 (6)).
    assert check.stand_shapes(0, 0, 45_000_999, table()) == check.stand_shapes(
        0, 0, 45_000_000, table()
    )
    assert check.stand_shapes(0, 0, -90_000_000, table())[2] == (
        0,
        -(half_depth + APRON_DEPTH) * scale,
    )


def test_a_strip_inside_a_polygon_keeps_its_width_inside():
    hall = [(0, 0), (20_000, 0), (20_000, 10_000), (0, 10_000)]
    assert check.strip_inside_polygon([(2_000, 5_000), (18_000, 5_000)], 1_500, hall)
    # Exactly the half width from an edge is inside; one millimetre nearer is not.
    assert check.strip_inside_polygon([(1_500, 5_000), (18_000, 5_000)], 1_500, hall)
    assert not check.strip_inside_polygon([(1_499, 5_000), (18_000, 5_000)], 1_500, hall)
    assert not check.strip_inside_polygon([(2_000, 5_000), (21_000, 5_000)], 1_500, hall)
    assert not check.strip_inside_polygon([(2_000, 5_000), (18_000, 11_000)], 1_500, hall)


def test_a_strip_whose_width_enters_a_notch_is_not_inside():
    notched = [(x * 1_000, z * 1_000) for x, z in NOTCHED]
    polyline = [(2_000, 4_000), (18_000, 4_000)]
    assert all(check.point_in_polygon(point, notched) for point in polyline)
    assert not check.strip_inside_polygon(polyline, 1_500, notched)
    assert check.strip_inside_polygon(polyline, 1_000, notched)
    assert not check.strip_inside_polygon(polyline, 1_001, notched)


def test_a_polygon_inside_a_polygon():
    assert check.polygon_inside_polygon([(4, 4), (6, 4), (6, 6), (4, 6)], SQUARE)
    # The boundary is inside.
    assert check.polygon_inside_polygon([(0, 0), (10, 0), (10, 3), (0, 3)], SQUARE)
    assert check.polygon_inside_polygon(SQUARE, SQUARE)
    assert not check.polygon_inside_polygon([(4, 4), (11, 4), (11, 6), (4, 6)], SQUARE)
    # Every vertex inside, and the notch cuts through it.
    assert not check.polygon_inside_polygon([(2, 6), (18, 6), (18, 8), (2, 8)], NOTCHED)
    assert check.polygon_inside_polygon([(2, 1), (18, 1), (18, 4), (2, 4)], NOTCHED)
    # Every vertex inside, no edge crossed at an interior point, and the notch's tip is within.
    assert not check.polygon_inside_polygon(
        [(2, 1), (18, 1), (18, 6), (17, 6), (3, 6), (2, 6)], NOTCHED
    )


def test_a_polygon_inside_a_polygon_is_decided_on_the_filled_shapes():
    # 5.4.18 (10) and the CEO's ruling on DEC-1091, B6. The notch's sides meet the square at two
    # of its vertices and the notch takes the top of the square: (5, 8) lies in the square and
    # outside the outer polygon.
    assert not check.polygon_inside_polygon(
        SQUARE, [(-5, -5), (15, -5), (15, 15), (10, 15), (10, 5), (0, 5), (0, 15), (-5, 15)]
    )
    # The boundary counts inside: a square that shares an edge with the outer polygon, and one
    # with a vertex on an outer edge, lie inside it.
    assert check.polygon_inside_polygon(SQUARE, [(-5, 0), (15, 0), (15, 15), (-5, 15)])
    assert check.polygon_inside_polygon(SQUARE, [(-5, -5), (15, -5), (15, 5), (5, 15), (-5, 15)])
    # A notch whose tip touches the square's top edge from outside leaves the square inside.
    assert check.polygon_inside_polygon(
        SQUARE, [(-5, -5), (15, -5), (15, 15), (10, 15), (5, 10), (0, 15), (-5, 15)]
    )


def test_arc_lengths_are_sums_of_integer_roots():
    assert check.arc_lengths([(0, 0), (3, 4), (3, 14), (4, 15)]) == [0, 5, 15, 16]
    assert check.arc_lengths([(7, 7)]) == [0]


def test_the_least_spacing_is_the_least_over_every_pair():
    state = 12_345
    points: list[tuple[int, int]] = []
    for _ in range(300):
        state = (state * 6_364_136_223_846_793_005 + 1_442_695_040_888_963_407) % (1 << 64)
        points.append(((state >> 20) % 40_000, (state >> 40) % 40_000))
    brute = min(
        (ax - bx) ** 2 + (az - bz) ** 2
        for index, (ax, az) in enumerate(points)
        for bx, bz in points[index + 1 :]
    )
    assert check._least_squared(points) == brute
    assert check._least_squared(points[:1]) is None
    assert check._least_squared([(5, 5), (5, 5), (90, 90)]) == 0
    assert check._least_squared([(0, 0), (30_000, 40_000)]) == 50_000**2


def test_the_grid_offers_every_item_whose_box_meets_the_query():
    grid = check._Grid()
    boxes = [(0, 0, 100, 100), (9_000, 0, 9_500, 400), (-70_000, -70_000, 70_000, 70_000)]
    for item, box in enumerate(boxes):
        grid.add(item, box)
    assert grid.near((50, 50, 60, 60)) == [0, 2]
    assert grid.near((9_400, 300, 9_600, 900)) == [1, 2]
    assert grid.near((40_000, 40_000, 40_001, 40_001)) == [2]
    assert grid.near((-10_000_000, -10_000_000, 10_000_000, 10_000_000)) == [0, 1, 2]


def test_a_keyword_matches_a_whole_word_of_any_face():
    table = [("Shiv", "shiv"), ("Shivan", "shiv"), ("Urza", "tolaria"), ("Llanowar", "llanowar")]
    assert check.selected_keyword(("Shivan Dragon",), table) == ("Shivan", "shiv")
    assert check.selected_keyword(("Rivers of Shiv",), table) == ("Shiv", "shiv")
    assert check.selected_keyword(("URZA'S TOWER",), table) == ("Urza", "tolaria")
    assert check.selected_keyword(("Shivering Isles",), table) is None
    assert check.selected_keyword(("Elf", "Llanowar-Born"), table) == ("Llanowar", "llanowar")
    # The first keyword in table order, not the first in the name.
    assert check.selected_keyword(("Urza, Lord of Shiv",), table) == ("Shiv", "shiv")
    assert check.selected_keyword(("Shiv2",), table) is None


def test_a_word_boundary_is_a_separator_or_punctuation():
    # 5.4.3, by Unicode general category (the CEO's ruling on DEC-1091, B3). A combining acute
    # (U+0301) and a plus sign join the word; an apostrophe, an em dash (U+2014) and a no-break
    # space (U+00A0) end it.
    table = [("Benalia", "north")]
    for name in ("Benalia\u0301n Knight", "Benalia+n Knight"):
        assert check.selected_keyword((name,), table) is None
    for name in ("Benalia's Knight", "Benalia\u2014Knight", "Benalia\u00a0Knight"):
        assert check.selected_keyword((name,), table) == ("Benalia", "north")


def test_the_three_predicate_fixtures_hold_and_are_in_canonical_form():
    crossings = {"notch.json": 0, "nested-squares.json": 0, "notch-vertex.json": 6}
    for name, count in crossings.items():
        text = (PREDICATES / name).read_text(encoding="utf-8")
        document = json.loads(text)
        assert check.check_predicates(document) == []
        assert document["verticesInside"] is True
        assert document["edgeCrossings"] == count
        canonical = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        assert text == canonical + "\n"
    assert json.loads((PREDICATES / "notch.json").read_text())["expected"] is False
    assert json.loads((PREDICATES / "nested-squares.json").read_text())["expected"] is True
    vertex = json.loads((PREDICATES / "notch-vertex.json").read_text())
    assert (vertex["predicate"], vertex["expected"]) == ("polygon-inside-polygon", False)


def test_a_predicate_fixture_that_states_otherwise_is_reported():
    document = json.loads((PREDICATES / "notch.json").read_text(encoding="utf-8"))
    assert len(check.check_predicates({**document, "expected": True})) == 1
    assert len(check.check_predicates({**document, "edgeCrossings": 2})) == 1
    assert len(check.check_predicates({**document, "verticesInside": False})) == 1
    # With a width that fits under the notch the strip is inside, and the fixture is wrong.
    assert len(check.check_predicates({**document, "halfWidth": 1_000})) == 1
    assert len(check.check_predicates({**document, "predicate": "other"})) == 1
    assert len(check.check_predicates({"predicate": "polygons-intersect"})) == 1
    document = json.loads((PREDICATES / "notch-vertex.json").read_text(encoding="utf-8"))
    assert len(check.check_predicates({**document, "expected": True})) == 1
    # Without the notch the square is inside, and the fixture is wrong.
    whole = [[-5_000, -5_000], [15_000, -5_000], [15_000, 15_000], [-5_000, 15_000]]
    assert check.check_predicates({**document, "outer": whole}) == [
        "edgeCrossings is stated 6 and is 0",
        "polygon-inside-polygon is expected False and is True",
    ]


def test_the_checker_shares_only_the_constants_and_the_trig_table_with_the_allocator():
    # 8.3.3: the checker shares no code with the allocator. `test_layout_no_float.py` scans the
    # same source for floats.
    shared: set[str] = set()
    for node in ast.walk(ast.parse(MODULE.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            assert all(not alias.name.startswith("eternities") for alias in node.names)
        if isinstance(node, ast.ImportFrom):
            assert node.level in (0, 1)
            if node.level == 0:
                assert not (node.module or "").startswith("eternities")
            elif node.module is None:
                shared |= {alias.name for alias in node.names}
            else:
                shared.add(node.module)
    assert shared == {"constants", "trig"}


# The world: Rabiah, as the allocator lays it out.


@cache
def table() -> trig.TrigTable:
    return trig.load()


@cache
def rabiah() -> tuple[bytes, dict[str, Any], tuple[CheckedCard, ...]]:
    """Rabiah's emitted bytes, its world document as a reader reads it, and its card list."""
    built = build.build_world("rabiah", PACK, build.load_directions())
    cards = tuple(
        CheckedCard(
            c.oracle_id, c.set_id, (c.name,) if c.back_name is None else (c.name, c.back_name)
        )
        for c in built.plane.cards
    )
    assert built.emitted.lore is None
    return (built.emitted.stands_bin, json.loads(json.dumps(built.emitted.world)), cards)


@cache
def shandalar() -> tuple[bytes, dict[str, Any], tuple[CheckedCard, ...]]:
    """Shandalar's emitted bytes, its world document and its card list: one stand."""
    built = build.build_world("shandalar", PACK, build.load_directions())
    cards = tuple(CheckedCard(c.oracle_id, c.set_id, (c.name,)) for c in built.plane.cards)
    return (built.emitted.stands_bin, json.loads(json.dumps(built.emitted.world)), cards)


def rows_of(data: bytes) -> list[list[Any]]:
    count = HEADER.unpack_from(data)[4]
    return [list(RECORD.unpack_from(data, HEADER.size + RECORD.size * i)) for i in range(count)]


def packed(rows: list[list[Any]]) -> bytes:
    header = HEADER.pack(b"ETRN", 1, 4, 0, len(rows), 0)
    return header + b"".join(RECORD.pack(*row) for row in rows)


def fresh() -> tuple[list[list[Any]], dict[str, Any], list[CheckedCard]]:
    """Rabiah's records, world document and cards, free to change."""
    data, world, cards = rabiah()
    return (rows_of(data), copy.deepcopy(world), list(cards))


def in_order(rows: list[list[Any]], world: dict[str, Any]) -> list[list[Any]]:
    """The records sorted as 4.13.3 sorts them, with the per-stand arrays carried along."""
    order = sorted(
        range(len(rows)), key=lambda i: (rows[i][SITE], rows[i][CLUSTER], rows[i][ORACLE])
    )
    for name in ("vertex", "arc"):
        world["stands"][name] = [world["stands"][name][i] for i in order]
    return [rows[i] for i in order]


def run(
    rows: list[list[Any]],
    world: dict[str, Any],
    cards: list[CheckedCard],
    lore: dict[str, Any] | None = None,
) -> CheckResult:
    return check.check_world(packed(rows), world, lore, cards, table())


def rules(result: CheckResult) -> set[str]:
    return {line.split(":")[0] for line in result.violations}


def under(result: CheckResult, rule: str) -> list[str]:
    return [line for line in result.violations if line.startswith(rule + ":")]


def members(rows: list[list[Any]], cluster: int) -> list[int]:
    return [index for index, row in enumerate(rows) if row[CLUSTER] == cluster]


def test_rabiah_as_laid_out_passes():
    rows, world, cards = fresh()
    result = run(rows, world, cards)
    assert result.violations == ()
    assert result.ok and result.violation_count == 0
    figures = result.figures
    assert figures["connected"] is True
    assert figures["minimumStandSpacing"] >= MIN_STAND_SPACING
    (site,) = figures["sites"]
    assert site["key"] == world["sites"][0]["key"]
    assert 0 < site["toFirst"] <= GAP_TO_FIRST and 0 <= site["toEnd"] <= GAP_TO_END
    assert (
        site["pathLength"] == check.arc_lengths([(x, z) for x, z in world["sites"][0]["path"]])[-1]
    )
    assert set(result.assertions) == set(check.RULES)
    assert result.assertions["footprint-blob"] == len(rows) == 75
    assert result.assertions["card-site"] == 75
    document = result.document()
    assert document["result"] == "pass" and document["violationCount"] == 0
    assert json.loads(json.dumps(document)) == document
    assert run(rows, world, cards).document() == document


def test_the_checker_reads_the_bytes_of_the_header_and_the_records():
    rows, world, cards = fresh()
    data = packed(rows)
    wrong = check.check_world(b"ETRX" + data[4:], world, None, cards, table())
    assert rules(wrong) == {"header"}
    short = check.check_world(data[:-1], world, None, cards, table())
    assert rules(short) == {"record-count"} and short.figures["connected"] is False
    assert rules(check.check_world(data[:7], world, None, cards, table())) == {"header"}
    rows[3][CLASS] = (rows[3][CLASS] + 1) % 7
    assert rules(run(rows, world, cards)) == {"record-class"}
    rows, world, cards = fresh()
    rows[3][YAW] += 1
    assert "record-yaw" in rules(run(rows, world, cards))
    rows, world, cards = fresh()
    world["standCount"] += 1
    assert rules(run(rows, world, cards)) == {"stand-count"}
    rows, world, cards = fresh()
    rows[0], rows[1] = rows[1], rows[0]
    assert "record-order" in rules(run(rows, world, cards))
    rows, world, cards = fresh()
    del world["sites"][0]["blob"]
    assert rules(run(rows, world, cards)) == {"world-format"}
    rows, world, cards = fresh()
    world["sites"][0]["centre"][0] = 1.5
    assert rules(run(rows, world, cards)) == {"world-format"}


def test_an_integer_one_past_the_int32_range_is_refused_under_world_format():
    """Erratum 7 (4.13.5): every integer of the world document lies in the int32 range.

    The arrival's yaw is an integer that no rule reads, and a cluster's arc one that the rules
    read: both are refused one past either end of the range, and nothing else is tested.
    """
    rows, world, cards = fresh()
    world["arrival"]["yaw"] = 2**31
    result = run(rows, world, cards)
    assert rules(result) == {"world-format"}
    (line,) = under(result, "world-format")
    assert "2147483648 at arrival.yaw" in line
    rows, world, cards = fresh()
    world["sites"][0]["clusters"][0]["arc"] = -(2**31) - 1
    result = run(rows, world, cards)
    assert rules(result) == {"world-format"}
    (line,) = under(result, "world-format")
    assert "-2147483649 at sites[0].clusters[0].arc" in line


def test_an_integer_at_either_end_of_the_int32_range_passes_world_format():
    """The same document with 2^31 - 1 and -2^31 in the same places passes that rule."""
    rows, world, cards = fresh()
    world["arrival"]["yaw"] = 2**31 - 1
    assert rules(run(rows, world, cards)) == set()
    rows, world, cards = fresh()
    world["sites"][0]["clusters"][0]["arc"] = -(2**31)
    result = run(rows, world, cards)
    assert "world-format" not in rules(result)
    assert result.assertions["world-format"] == 1


def test_two_stands_nearer_than_the_minimum_spacing_are_named():
    rows, world, cards = fresh()
    # Stand 1 is put beside stand 0, at the spacing exactly and then one millimetre nearer.
    rows[1][X], rows[1][Z] = rows[0][X] + MIN_STAND_SPACING, rows[0][Z]
    exact = run(rows, world, cards)
    assert not [line for line in under(exact, "stand-spacing") if "stand 0 " in line]
    rows[1][X] -= 1
    nearer = run(rows, world, cards)
    (line,) = [line for line in under(nearer, "stand-spacing") if "stand 0 " in line]
    assert "stand 1 " in line and f"{MIN_STAND_SPACING - 1} mm apart" in line
    assert nearer.figures["minimumStandSpacing"] == MIN_STAND_SPACING - 1
    # On the same spot, the two stands' footprints and aprons intersect too.
    rows[1][X], rows[1][YAW] = rows[0][X], rows[0][YAW]
    same = run(rows, world, cards)
    assert {"stand-spacing", "footprint-footprint", "footprint-apron", "apron-apron"} <= rules(same)
    assert same.figures["minimumStandSpacing"] == 0


def test_a_stand_moved_one_millimetre_into_its_sites_path_is_reported():
    rows, world, cards = fresh()
    path = world["sites"][0]["path"]
    vertex = world["stands"]["vertex"]

    def reach(index: int) -> int:
        px, pz = path[vertex[index]]
        return (px - rows[index][X]) ** 2 + (pz - rows[index][Z]) ** 2

    # The stand with the shortest corridor, moved along one axis toward its path vertex.
    index = min(range(len(rows)), key=reach)
    px, pz = path[vertex[index]]
    dx, dz = px - rows[index][X], pz - rows[index][Z]
    step = ((1 if dx > 0 else -1), 0) if abs(dx) >= abs(dz) else (0, (1 if dz > 0 else -1))
    home = (rows[index][X], rows[index][Z])

    def meets_the_path(shift: int) -> bool:
        rows[index][X], rows[index][Z] = home[0] + shift * step[0], home[1] + shift * step[1]
        result = run(rows, world, cards)
        return any(
            f"stand {index} " in line
            for line in under(result, "apron-path") + under(result, "footprint-path")
        )

    assert not meets_the_path(0)
    low, high = 0, max(abs(dx), abs(dz))
    assert meets_the_path(high)
    while high - low > 1:
        middle = (low + high) // 2
        if meets_the_path(middle):
            high = middle
        else:
            low = middle
    # One millimetre apart: the last position clear of the path's strip and the first inside it.
    assert not meets_the_path(high - 1)
    assert meets_the_path(high)

    # The same two positions by the rule written out with exact rationals, on every segment of
    # the path: the checker's grid and its bounding boxes take no part in this.
    def by_the_rule(shift: int) -> bool:
        x, z = home[0] + shift * step[0], home[1] + shift * step[1]
        footprint, apron, _ = check.stand_shapes(x, z, rows[index][YAW], table())
        scaled = [(px * trig.SCALE, pz * trig.SCALE) for px, pz in path]
        limit = (PATH_HALF_WIDTH * trig.SCALE) ** 2
        return any(
            reference_nearer(a, b, list(shape), limit)
            for a, b in pairwise(scaled)
            for shape in (footprint, apron)
        )

    assert not by_the_rule(high - 1)
    assert by_the_rule(high)
    rows[index][X], rows[index][Z] = home[0] + high * step[0], home[1] + high * step[1]
    (line,) = [
        line for line in under(run(rows, world, cards), "apron-path") if f"stand {index} " in line
    ]
    assert f"the path of site {world['sites'][0]['key']}" in line


def test_the_other_exclusions_of_invariant_9_are_asserted():
    rows, world, cards = fresh()
    site = world["sites"][0]
    path, vertex = site["path"], world["stands"]["vertex"]

    def corridor(index: int) -> int:
        px, pz = path[vertex[index]]
        return (px - rows[index][X]) ** 2 + (pz - rows[index][Z]) ** 2

    # The stand with the longest corridor, and the middle of that corridor.
    owner = max(range(len(rows)), key=corridor)
    assert corridor(owner) > 6_000**2
    px, pz = path[vertex[owner]]
    middle = ((rows[owner][X] + px) // 2, (rows[owner][Z] + pz) // 2)
    other = next(
        index for index in range(len(rows)) if rows[index][CLUSTER] != rows[owner][CLUSTER]
    )

    def moved(index: int, x: int, z: int) -> CheckResult:
        changed = [list(row) for row in rows]
        changed[index][X], changed[index][Z] = x, z
        return run(changed, world, cards)

    result = moved(other, *middle)
    assert any(
        f"stand {other} " in line and f"the corridor of stand {owner} " in line
        for line in under(result, "footprint-corridor")
    )
    result = moved(other, site["pad"]["x"], site["pad"]["z"])
    assert {"footprint-pad", "apron-pad", "footprint-path", "footprint-blob"} <= rules(result)
    assert "the approach of site" in "".join(under(result, "footprint-path"))
    result = moved(other, site["stone"]["x"], site["stone"]["z"])
    assert "footprint-stone" in rules(result)
    # Inside the edge path's outer circle, 14.5 m from the origin.
    result = moved(other, 0, PLAZA_EDGE_RADIUS - 500)
    assert {"footprint-plaza", "footprint-blob", "footprint-cluster"} <= rules(result)
    # On the far side of the plaza from its path vertex: the corridor runs through the plaza.
    px, pz = path[vertex[other]]
    away = isqrt(px * px + pz * pz)
    result = moved(other, -px * 2 * PLAZA_RADIUS // away, -pz * 2 * PLAZA_RADIUS // away)
    assert any(f"stand {other} " in line for line in under(result, "corridor-plaza"))
    assert "footprint-plaza" not in rules(result)
    # The site's stone in the middle of a corridor, and inside the edge path's circle.
    rows, world, cards = fresh()
    world["sites"][0]["stone"].update(x=middle[0], z=middle[1])
    result = run(rows, world, cards)
    assert any(f"stand {owner} " in line for line in under(result, "corridor-stone"))
    world["sites"][0]["stone"].update(x=0, z=PLAZA_EDGE_RADIUS - 100)
    assert rules(run(rows, world, cards)) == {"stone-plaza", "site-bounds", "stone-place"}
    # The return pad across the plaza's edge, and a plaza of another size.
    rows, world, cards = fresh()
    world["pads"][0]["z"] = -(PLAZA_RADIUS - 1_000)
    assert rules(run(rows, world, cards)) == {"pad-plaza"}
    world["pads"][0]["z"] = -(PLAZA_RADIUS - 1_600)
    assert run(rows, world, cards).ok
    world["plaza"]["radius"] -= 1
    assert rules(run(rows, world, cards)) == {"plaza-figures"}
    # An approach point that is not 10 m from its pad is where no leg ends.
    rows, world, cards = fresh()
    world["sites"][0]["approachPoint"][0] += 5
    assert {"approach-length", "trail-leg", "site-reached"} <= rules(run(rows, world, cards))


def test_a_record_of_another_plane_is_reported():
    # Invariant 7: a stand stands in the world of its plane (DEC-1091, B5).
    rows, world, cards = fresh()
    assert {row[1] for row in rows} == {world["planeIndex"]} == {66}
    rows[0][1] = 255
    result = run(rows, world, cards)
    assert rules(result) == {"card-plane"}
    (line,) = under(result, "card-plane")
    assert line.startswith("card-plane: stand 0 (")
    assert "records plane index 255; the world file is the world of plane index 66" in line


def test_a_site_stone_moved_off_its_place_is_reported():
    # 5.4.8 and invariant 9 (DEC-1091, B7): the stone's centre lies 2,500 mm from the pad's centre
    # towards the approach point and 3,000 mm to one side, each within the 2 mm of rounding.
    data, document, cards = shandalar()
    rows = rows_of(data)
    world = copy.deepcopy(document)
    (site,) = world["sites"]
    stone = site["stone"]
    assert (stone["x"], stone["z"]) == (-24_274, -44_981)
    assert run(rows, world, list(cards)).ok
    stone["z"] = -39_981
    (line,) = under(run(rows, world, list(cards)), "stone-place")
    assert line == (
        f"stone-place: the stone of site {site['key']} at (-24274, -39981) does not stand 2500 mm "
        f"from its pad's centre ({site['pad']['x']}, {site['pad']['z']}) towards its approach "
        f"point {tuple(site['approachPoint'])} and 3000 mm to one side"
    )


def test_a_site_stone_mirrored_across_its_approach_is_in_its_place():
    # 5.4.8 and invariant 9 (DEC-1091, B7): either side of the approach is the stone's place.
    data, document, cards = shandalar()
    rows = rows_of(data)
    world = copy.deepcopy(document)
    (site,) = world["sites"]
    stone = site["stone"]
    # Mirrored across the approach's line, and rounded half away from zero: the other side.
    pad = (site["pad"]["x"], site["pad"]["z"])
    dx, dz = site["approachPoint"][0] - pad[0], site["approachPoint"][1] - pad[1]
    wx, wz = -24_274 - pad[0], -44_981 - pad[1]
    along = Fraction(wx * dx + wz * dz, dx * dx + dz * dz)
    mirrored = [pad[0] + 2 * along * dx - wx, pad[1] + 2 * along * dz - wz]
    stone["x"], stone["z"] = (
        int(value + (1 if value > 0 else -1) * Fraction(1, 2)) for value in mirrored
    )
    assert (stone["x"], stone["z"]) == (-27_095, -50_275)
    assert "stone-place" not in rules(run(rows, world, list(cards)))


def test_a_record_with_a_site_index_out_of_range_is_reported():
    rows, world, cards = fresh()
    rows[-1][SITE] = 1
    result = run(rows, world, cards)
    assert "record-site" in rules(result)
    assert "site 1, out of range" in under(result, "record-site")[0]
    assert result.figures["connected"] is False


def test_a_stand_in_a_site_that_5_4_3_does_not_assign_it_is_reported():
    rows, world, cards = fresh()
    # A second set site, with a set of its own, standing where the first does.
    twin = copy.deepcopy(world["sites"][0])
    twin["key"], twin["setIds"], twin["clusters"] = "set:twin", [60_000], twin["clusters"][:1]
    world["sites"].append(twin)
    world["pads"].append({**world["pads"][1], "owner": "set:twin"})
    doubled = rules(run(rows, world, cards))
    # The twin's pad and stone lie on the first site's, and its one cluster is empty. It has no
    # stand and keeps the first site's whole path, and no leg of the trail visits it.
    assert doubled == {
        "pad-pad",
        "stone-stone",
        "cluster-count",
        "gap-end",
        "path-empty",
        "trail-order",
    }
    moved = rows[0][ORACLE]
    rows[0][SITE] = 1
    rows = in_order(rows, world)
    result = run(rows, world, cards)
    (line,) = under(result, "card-site")
    assert rows[-1][ORACLE] == moved and f"stand {len(rows) - 1} " in line
    assert "site set:twin" in line and "assigns" in line and world["sites"][0]["key"] in line
    # And from the card list's side: a card whose first printing is in a set with no site.
    rows, world, cards = fresh()
    cards[5] = CheckedCard(cards[5].oracle_id, 60_000, cards[5].names)
    result = run(rows, world, cards)
    assert rules(result) == {"card-set", "card-site"}
    assert cards[5].oracle_id in under(result, "card-site")[0]


def test_a_corridor_vertex_moved_far_along_the_path_is_reported():
    rows, world, cards = fresh()
    site = world["sites"][0]
    arcs = check.arc_lengths([(x, z) for x, z in site["path"]])
    index = members(rows, 0)[0]
    far = len(site["path"]) - 1
    assert arcs[far] - site["clusters"][0]["arc"] > CORRIDOR_ARC_WINDOW
    # The vertex alone: the arc length the world file gives is no longer that vertex's.
    world["stands"]["vertex"][index] = far
    result = run(rows, world, cards)
    assert "corridor-end" in rules(result)
    assert f"stand {index} " in under(result, "corridor-end")[0]
    # The vertex with its arc length: the corridor ends outside its slot's window.
    world["stands"]["arc"][index] = arcs[far]
    result = run(rows, world, cards)
    assert "corridor-end" not in rules(result)
    (line,) = under(result, "corridor-window")
    assert f"stand {index} " in line and f"{arcs[far]} mm" in line
    # Past the path's last vertex there is nothing to end on.
    world["stands"]["vertex"][index] = far + 1
    result = run(rows, world, cards)
    assert "record-vertex" in rules(result) and result.figures["connected"] is False


def test_a_cluster_left_with_two_stands_is_reported():
    rows, world, cards = fresh()
    clusters = world["sites"][0]["clusters"]
    cluster = next(
        number for number in range(len(clusters) - 1) if clusters[number]["stands"] == MIN_CLUSTER
    )
    mover = members(rows, cluster)[0]
    rows[mover][CLUSTER] = cluster + 1
    rows = in_order(rows, world)
    assert len(members(rows, cluster)) == MIN_CLUSTER - 1
    result = run(rows, world, cards)
    (line,) = under(result, "cluster-size")
    assert f"cluster {cluster} of site" in line and "holds 2 stands" in line
    # The world file's counts no longer match, and the stand is outside its new cluster's disc.
    assert {"cluster-count", "footprint-cluster"} <= rules(result)
    # The same on the site's last cluster is no violation of the size rule.
    rows, world, cards = fresh()
    last = len(clusters) - 1
    assert len(members(rows, last - 1)) >= MIN_CLUSTER
    while len(members(rows, last)) > 1:
        rows[members(rows, last)[0]][CLUSTER] = last - 1
        rows = in_order(rows, world)
    assert "cluster-size" not in rules(run(rows, world, cards))


def test_a_path_vertex_removed_leaves_corridors_that_no_longer_end_on_it():
    rows, world, cards = fresh()
    path = world["sites"][0]["path"]
    removed = sorted(world["stands"]["vertex"])[0]
    del path[removed]
    result = run(rows, world, cards)
    # Every corridor that ended at or past the removed vertex now ends on another point, at
    # another arc length, or past the path's last vertex.
    shifted = [vertex for vertex in world["stands"]["vertex"] if vertex >= removed]
    assert len(shifted) == len(rows)
    on_path = sum(1 for vertex in shifted if vertex < len(path))
    assert len(under(result, "corridor-end")) == on_path > 0
    assert len(under(result, "record-vertex")) == len(shifted) - on_path
    index = world["stands"]["vertex"].index(removed)
    assert any(f"stand {index} " in line for line in under(result, "corridor-end"))


def test_a_duplicated_oracle_id_is_reported():
    rows, world, cards = fresh()
    lost, kept = str(uuid.UUID(bytes=rows[1][ORACLE])), str(uuid.UUID(bytes=rows[0][ORACLE]))
    rows[1][ORACLE] = rows[0][ORACLE]
    result = run(rows, world, cards)
    found = under(result, "card-stand")
    assert len(found) == 2
    assert any(f"card {kept} " in line and "has 2 stands: stand 0 " in line for line in found)
    assert any(f"card {lost} " in line and "has no stand" in line for line in found)


def test_a_missing_card_is_reported():
    rows, world, cards = fresh()
    gone = rows.pop()
    for name in ("vertex", "arc"):
        world["stands"][name].pop()
    world["standCount"] -= 1
    world["sites"][0]["clusters"][gone[CLUSTER]]["stands"] -= 1
    result = run(rows, world, cards)
    (line,) = under(result, "card-stand")
    assert str(uuid.UUID(bytes=gone[ORACLE])) in line and "has no stand" in line
    # A stand whose card the list does not hold.
    rows, world, cards = fresh()
    result = run(rows, world, cards[:-1])
    (line,) = under(result, "card-stand")
    assert cards[-1].oracle_id in line and "holds no card" in line


def test_the_path_network_must_reach_the_site():
    rows, world, cards = fresh()
    world["trail"]["legs"][0]["polyline"].pop()
    world["trail"]["legs"][0]["endAttachment"] = world["trail"]["legs"][0]["polyline"][-2:]
    result = run(rows, world, cards)
    assert {"trail-leg", "site-reached"} <= rules(result)
    assert result.figures["connected"] is False
    rows, world, cards = fresh()
    near = world["plaza"]["approach"][0]
    world["plaza"]["approach"][0] = [near[0] * 2, near[1] * 2]
    result = run(rows, world, cards)
    assert {"plaza-approach", "site-reached"} <= rules(result)
    rows, world, cards = fresh()
    world["sites"][0]["pad"]["x"] += 3
    world["pads"][1]["x"] += 3
    result = run(rows, world, cards)
    assert {"pad-head", "site-reached"} <= rules(result) and not result.figures["connected"]
    rows, world, cards = fresh()
    world["trail"]["legs"][0]["startAttachment"][1][0] += 1
    assert rules(run(rows, world, cards)) == {"leg-attachment"}
    rows, world, cards = fresh()
    world["trail"]["legs"][0]["kind"] = "spur"
    assert "spur" in rules(run(rows, world, cards))


def test_the_gap_bounds_and_the_bounding_disc_are_asserted():
    rows, world, cards = fresh()
    site = world["sites"][0]
    site["clusters"][0]["arc"] = GAP_TO_FIRST + 1
    assert "gap-first" in rules(run(rows, world, cards))
    rows, world, cards = fresh()
    site = world["sites"][0]
    (ax, az), (bx, bz) = site["path"][-2], site["path"][-1]
    site["path"].append([bx + (bx - ax) * 40, bz + (bz - az) * 40])
    result = run(rows, world, cards)
    assert "gap-end" in rules(result)
    assert result.figures["sites"][0]["toEnd"] > GAP_TO_END
    rows, world, cards = fresh()
    site = world["sites"][0]
    site["clusters"][2]["arc"] = site["clusters"][1]["arc"]
    assert "cluster-arcs" in rules(run(rows, world, cards))
    rows, world, cards = fresh()
    world["sites"][0]["boundingRadius"] = world["sites"][0]["radius"]
    assert "site-bounds" in rules(run(rows, world, cards))
    rows, world, cards = fresh()
    world["regions"][0]["cell"] = [[0, 0], [1_000, 0], [0, 1_000]]
    result = run(rows, world, cards)
    assert rules(result) == {"stand-region"} and result.violation_count == len(rows)


def test_the_bounding_disc_counts_the_points_it_tested():
    # DEC-1091, N15: a list of points stops at its first violation and counts only what it
    # tested. With no bounding radius the first point of each of the five lists fails: the blob,
    # the path, the pad, the approach point and the stone.
    rows, world, cards = fresh()
    site = world["sites"][0]
    tested = run(rows, world, cards).assertions["site-bounds"]
    assert tested == len(site["blob"]) + len(site["path"]) + 3
    site["boundingRadius"] = 0
    result = run(rows, world, cards)
    assert len(under(result, "site-bounds")) == 5
    assert result.assertions["site-bounds"] == 5


def test_at_most_the_limit_of_violations_is_kept_and_all_are_counted(
    monkeypatch: pytest.MonkeyPatch,
):
    rows, world, cards = fresh()
    world["regions"][0]["cell"] = [[0, 0], [1_000, 0], [0, 1_000]]
    monkeypatch.setattr(check, "VIOLATION_LIMIT", 3)
    result = run(rows, world, cards)
    assert len(result.violations) == 3 and result.violation_count == len(rows)
    assert result.document()["violationCount"] == len(rows)
    assert all("stand-region: stand " in line for line in result.violations)
    assert [line.split()[2] for line in result.violations] == ["0", "1", "2"]


def test_the_grid_and_the_boxes_skip_no_violation(monkeypatch: pytest.MonkeyPatch):
    # Several things wrong at once: a stand on another's corridor, a stand on the pad, the stone
    # on a third stand, and a hero volume over the head of the path.
    rows, world, cards = fresh()
    site = world["sites"][0]
    px, pz = site["path"][world["stands"]["vertex"][0]]
    rows[40][X], rows[40][Z] = (rows[0][X] + px) // 2, (rows[0][Z] + pz) // 2
    rows[41][X], rows[41][Z] = site["pad"]["x"], site["pad"]["z"]
    site["stone"].update(x=rows[20][X] + 300, z=rows[20][Z])
    hx, hz = site["path"][0]
    world["heroVolumes"] = [
        {"id": "keep", "polygon": [[hx - 900, hz - 900], [hx + 900, hz - 900], [hx, hz + 900]]}
    ]
    found = run(rows, world, cards)
    assert len(rules(found)) > 12 and found.violation_count < check.VIOLATION_LIMIT

    # Every pair of the world tested exactly: the grid offers everything and no box is consulted.
    def everything(grid: check._Grid, box: check.Box) -> list[int]:
        return sorted(set(grid.wide).union(*grid.cells.values()))

    def never(a: check.Box, b: check.Box, gap: int) -> bool:
        return False

    monkeypatch.setattr(check._Grid, "near", everything)
    monkeypatch.setattr(check, "_apart", never)
    exhaustive = run(rows, world, cards)
    assert exhaustive.violations == found.violations
    assert exhaustive.figures == found.figures
    stands = len(rows)
    assert exhaustive.assertions["footprint-path"] > stands * (len(site["path"]) - 1)
    assert exhaustive.assertions["footprint-footprint"] == stands * (stands - 1) // 2
    assert exhaustive.assertions["footprint-corridor"] == stands * (stands - 1)


def test_a_hero_volume_is_kept_off_everything_it_may_not_touch():
    rows, world, cards = fresh()

    def square(x: int, z: int, half: int) -> list[list[int]]:
        return [
            [x - half, z - half],
            [x + half, z - half],
            [x + half, z + half],
            [x - half, z + half],
        ]

    def with_volume(polygon: list[list[int]]) -> CheckResult:
        world["heroVolumes"] = [{"id": "keep", "polygon": polygon}]
        return run(rows, world, cards)

    site = world["sites"][0]
    # Far from everything, inside the plaza and off the arrival point: nothing to report.
    reach = site["boundingRadius"] + 50_000
    assert with_volume(square(site["centre"][0] + 2 * reach, site["centre"][1], 5_000)).ok
    assert with_volume(square(4_000, 4_000, 1_000)).ok
    assert rules(with_volume(square(0, 0, 1_000))) == {"volume-arrival"}
    assert "pad-volume" in rules(with_volume(square(0, -6_500, 500)))
    # Around one stand, and far smaller than the site: a nested shape still intersects.
    found = rules(with_volume(square(rows[0][X], rows[0][Z], 4_000)))
    assert {"footprint-volume", "apron-volume", "corridor-volume", "volume-site"} <= found
    middle = world["trail"]["legs"][0]["polyline"][len(world["trail"]["legs"][0]["polyline"]) // 2]
    assert "volume-path" in rules(with_volume(square(middle[0], middle[1], 200)))
    stone = site["stone"]
    assert "stone-volume" in rules(with_volume(square(stone["x"], stone["z"], 100)))


# An era site, made by hand from the same world.


def lattice_points(centre: tuple[int, int], radius: int) -> list[tuple[int, int]]:
    """The points of the hexagonal lattice of 5.4.18 (8) within a radius of a centre."""
    found: list[tuple[int, int]] = []
    for row in range((centre[1] - radius) // LATTICE_ROW, (centre[1] + radius) // LATTICE_ROW + 2):
        z = LATTICE_ROW * row
        low = (centre[0] - radius - LATTICE_HALF_PITCH * row) // LATTICE_PITCH
        for column in range(low, low + 2 * radius // LATTICE_PITCH + 3):
            x = LATTICE_PITCH * column + LATTICE_HALF_PITCH * row
            if (x - centre[0]) ** 2 + (z - centre[1]) ** 2 <= radius**2:
                found.append((x, z))
    return found


@cache
def era_world() -> tuple[bytes, dict[str, Any], dict[str, Any], tuple[CheckedCard, ...]]:
    """Rabiah as one era of two sets: the second chapter begins half way along the path.

    The chapter stone stands on the first lattice point that the checker finds clear of
    everything in the disc of the cluster before the chapter's first, or of the first (invariant
    11).
    """
    rows, world, cards = fresh()
    site = world["sites"][0]
    split = len(site["clusters"]) // 2
    first_set = rows[0][SET]
    second_set = first_set + 1
    later = {row[ORACLE] for row in rows if row[CLUSTER] >= split}
    for row in rows:
        if row[ORACLE] in later:
            row[SET] = second_set
    held = [
        CheckedCard(
            c.oracle_id, second_set if uuid.UUID(c.oracle_id).bytes in later else c.set_id, c.names
        )
        for c in cards
    ]
    site.update(
        kind="era", key="era:age", eraId="age", regionId="land", setIds=[first_set, second_set]
    )
    world["regions"][0]["id"] = "land"
    world["pads"][1]["owner"] = "era:age"
    world["trail"]["legs"][0]["to"] = "era:age"
    site["chapters"] = [
        {"setId": first_set, "firstStand": 0, "firstCluster": 0, "stone": None},
        {
            "setId": second_set,
            "firstStand": members(rows, split)[0],
            "firstCluster": split,
            "stone": None,
        },
    ]
    lore = {
        "eras": [{"id": "age", "region": "land", "setIds": [first_set, second_set]}],
        "regions": [{"id": "land"}, {"id": "far"}],
        "keywords": [],
    }
    for cluster in site["clusters"][split - 1 : split + 1]:
        centre = (cluster["centre"][0], cluster["centre"][1])
        for x, z in lattice_points(centre, CLUSTER_RADIUS - JITTER_RADIUS):
            site["chapters"][1]["stone"] = {"x": x, "z": z, "yaw": 0}
            if run(rows, world, held, lore).ok:
                return (packed(rows), world, lore, tuple(held))
    raise AssertionError("no lattice point of the chapter's clusters is free for a chapter stone")


def fresh_era() -> tuple[list[list[Any]], dict[str, Any], dict[str, Any], list[CheckedCard]]:
    data, world, lore, cards = era_world()
    return (rows_of(data), copy.deepcopy(world), copy.deepcopy(lore), list(cards))


def test_an_era_site_in_chapter_order_passes():
    rows, world, lore, cards = fresh_era()
    result = run(rows, world, cards, lore)
    assert result.ok
    assert result.assertions["chapter-order"] == len(world["sites"][0]["clusters"]) - 1
    assert result.assertions["chapter-stone"] == 2
    # The same files without the lore document are a kit world with an era site in it.
    assert "site-list" in rules(run(rows, world, cards))


def test_a_chapter_order_broken_across_clusters_is_reported():
    rows, world, lore, cards = fresh_era()
    chapters = world["sites"][0]["chapters"]
    second_set = chapters[1]["setId"]
    # A stand of the first cluster is given the second chapter's set, in the record and the card.
    index = members(rows, 0)[-1]
    oracle = str(uuid.UUID(bytes=rows[index][ORACLE]))
    rows[index][SET] = second_set
    cards = [
        CheckedCard(c.oracle_id, second_set, c.names) if c.oracle_id == oracle else c for c in cards
    ]
    result = run(rows, world, cards, lore)
    # The chapter's first stand now stands in cluster 0, far from the chapter's stone.
    assert rules(result) == {"chapter-order", "chapter-first", "chapter-cluster"}
    (line,) = under(result, "chapter-order")
    assert f"stand {index} " in line and "holds chapter 1" in line and "holds chapter 0" in line
    assert "names cluster" in under(result, "chapter-first")[0]
    assert "disc of cluster 0," in under(result, "chapter-cluster")[0]


def test_the_chapter_list_and_the_chapter_stones_are_asserted():
    rows, world, lore, cards = fresh_era()
    world["sites"][0]["chapters"][1]["stone"] = None
    assert rules(run(rows, world, cards, lore)) == {"chapter-stone"}
    rows, world, lore, cards = fresh_era()
    world["sites"][0]["chapters"][1]["stone"]["x"] += 1
    assert (
        "not a point of the hexagonal lattice"
        in under(run(rows, world, cards, lore), "chapter-stone")[0]
    )
    rows, world, lore, cards = fresh_era()
    chapters = world["sites"][0]["chapters"]
    chapters[0]["stone"] = dict(chapters[1]["stone"])
    assert "chapter-stone" in rules(run(rows, world, cards, lore))
    rows, world, lore, cards = fresh_era()
    world["sites"][0]["chapters"][1]["stone"]["z"] += 20 * LATTICE_ROW
    assert (
        "lies inside no cluster disc" in under(run(rows, world, cards, lore), "chapter-stone")[-1]
    )
    rows, world, lore, cards = fresh_era()
    world["sites"][0]["chapters"].reverse()
    assert "chapter-list" in rules(run(rows, world, cards, lore))
    rows, world, lore, cards = fresh_era()
    world["sites"][0]["chapters"][1]["firstStand"] = 0
    assert rules(run(rows, world, cards, lore)) == {"chapter-first"}
    rows, world, lore, cards = fresh_era()
    del world["sites"][0]["chapters"][1]
    assert "chapter-list" in rules(run(rows, world, cards, lore))


def test_a_chapter_stone_is_kept_off_the_stands_and_their_corridors():
    rows, world, lore, cards = fresh_era()
    stone = world["sites"][0]["chapters"][1]["stone"]
    index = members(rows, world["sites"][0]["chapters"][1]["firstCluster"])[0]
    # The stone is put on the stand's own lattice point, the one within the jitter of the stand.
    ((stone["x"], stone["z"]),) = lattice_points(
        (rows[index][X], rows[index][Z]), JITTER_RADIUS + 1
    )
    found = rules(run(rows, world, cards, lore))
    assert "footprint-stone" in found and "chapter-stone" not in found
    # On the site's path, a stone meets the path's strip.
    rows, world, lore, cards = fresh_era()
    site = world["sites"][0]
    head = site["path"][0]
    site["chapters"][1]["stone"].update(x=head[0], z=head[1] + PATH_HALF_WIDTH)
    assert "stone-path" in rules(run(rows, world, cards, lore))


def test_a_keyword_of_another_region_sends_a_card_to_that_regions_site():
    rows, world, lore, cards = fresh_era()
    name = cards[0].names[0]
    word = max(name.replace(",", " ").replace("'", " ").split(), key=len)
    lore["keywords"] = [{"word": word.upper(), "region": "far"}]
    result = run(rows, world, cards, lore)
    found = under(result, "card-site")
    assert found and all("no regional site of far" in line for line in found)
    assert any(cards[0].oracle_id in line for line in found)
    # A keyword of the era's own region moves nothing.
    lore["keywords"] = [{"word": word, "region": "land"}]
    assert run(rows, world, cards, lore).ok
    # The era's region is the lore document's.
    lore["eras"][0]["region"] = "far"
    assert "site-region" in rules(run(rows, world, cards, lore))


# --- DEC-1091 kill cases (C3, C5) -------------------------------------------------------------


def test_the_corridor_window_is_six_metres_to_the_millimetre():
    # 5.4.9 and 5.4.10: a path vertex 6,000 mm from its slot along the path is in the window, and
    # 6,001 mm is not, on either side of the slot.
    rows, world, cards = fresh()
    clusters = world["sites"][0]["clusters"]
    index = members(rows, 0)[0]
    arc = world["stands"]["arc"][index]

    def named() -> bool:
        lines = under(run(rows, world, cards), "corridor-window")
        return any(f"stand {index} " in line for line in lines)

    for slot, outside in (
        (arc - CORRIDOR_ARC_WINDOW, False),
        (arc - CORRIDOR_ARC_WINDOW - 1, True),
        (arc + CORRIDOR_ARC_WINDOW, False),
        (arc + CORRIDOR_ARC_WINDOW + 1, True),
    ):
        clusters[0]["arc"] = slot
        assert named() is outside


def test_two_clusters_more_than_eighteen_metres_apart_are_reported():
    # 5.4.10: at most 18,000 mm between consecutive occupied slots; 18,001 mm is a violation.
    rows, world, cards = fresh()
    clusters = world["sites"][0]["clusters"]
    clusters[1]["arc"] = clusters[0]["arc"] + GAP_BETWEEN
    assert "gap-between" not in rules(run(rows, world, cards))
    clusters[1]["arc"] = clusters[0]["arc"] + GAP_BETWEEN + 1
    (line,) = under(run(rows, world, cards), "gap-between")
    assert "clusters 0 and 1 of site" in line and f"{GAP_BETWEEN + 1} mm apart" in line


# --- DEC-1091 delta re-read 1, kill case (D3) --------------------------------------------------


def test_a_site_stone_on_its_approach_is_reported():
    # 5.4.8 and invariant 9: the stone's centre lies 3,000 mm to one side of the approach. A stone
    # on the approach's line, 2,500 mm from the pad's centre, keeps the distance along it and is
    # reported for the distance across.
    data, document, cards = shandalar()
    rows = rows_of(data)
    world = copy.deepcopy(document)
    (site,) = world["sites"]
    pad = (site["pad"]["x"], site["pad"]["z"])
    dx, dz = site["approachPoint"][0] - pad[0], site["approachPoint"][1] - pad[1]
    site["stone"]["x"], site["stone"]["z"] = pad[0] + dx // 4, pad[1] + dz // 4
    assert "stone-place" in rules(run(rows, world, list(cards)))


# --- DEC-1091 delta re-read 1, kill case (M2) --------------------------------------------------


def test_a_site_stone_behind_its_pad_is_reported():
    # 5.4.8: the stone stands 2,500 mm from the pad's centre towards the approach point. The stone
    # turned through the pad's centre lies 2,500 mm behind it, 3,000 mm to the other side, and is
    # reported.
    data, document, cards = shandalar()
    rows = rows_of(data)
    world = copy.deepcopy(document)
    (site,) = world["sites"]
    stone, pad = site["stone"], site["pad"]
    stone["x"], stone["z"] = 2 * pad["x"] - stone["x"], 2 * pad["z"] - stone["z"]
    assert "stone-place" in rules(run(rows, world, list(cards)))


# --- DEC-1091 delta re-read 1, kill case (D5) --------------------------------------------------


def test_an_outer_boundary_that_crosses_an_inner_edge_at_its_own_vertices_is_seen():
    # 5.4.18 (10): the inner edge is cut where an outer vertex lies on it. The notch's sides meet
    # the square's top edge at two of the notch's own vertices, (7, 10) and (3, 10), and the notch
    # takes the piece between them: (5, 9) lies in the square and outside the outer polygon.
    assert not check.polygon_inside_polygon(
        SQUARE,
        [(-5, -5), (15, -5), (15, 15), (7, 15), (7, 10), (5, 8), (3, 10), (3, 15), (-5, 15)],
    )


# The rules of erratum 5 (PRD v4 3.2, invariants 9 to 11, and 5.4.10): each fails on a world
# changed to break it.


def test_a_cluster_of_nine_stands_is_reported():
    rows, world, cards = fresh()
    clusters = world["sites"][0]["clusters"]
    target = max(range(len(clusters)), key=lambda number: clusters[number]["stands"])
    others = [index for index, row in enumerate(rows) if row[CLUSTER] != target]
    while len(members(rows, target)) < 8:
        rows[others.pop()][CLUSTER] = target
    assert "cluster-cap" not in rules(run(in_order(rows, world), world, cards))
    rows[others.pop()][CLUSTER] = target
    rows = in_order(rows, world)
    assert len(members(rows, target)) == 9
    result = run(rows, world, cards)
    (line,) = under(result, "cluster-cap")
    assert f"cluster {target} of site" in line and "holds 9 stands" in line


def test_a_stand_faces_its_path_vertex_within_a_tenth_of_a_degree():
    directions = table()
    # Along the table direction 100 counts either side of the yaw: on the boundary, and inside.
    for turn in (-100, 100):
        ahead = ((7_000 + turn) % 360_000, 0)
        target = (directions.cos(ahead[0]), directions.sin(ahead[0]))
        assert check.faces(7_000_000, (0, 0), target, directions)
    for turn in (-101, 101, 180_000):
        count = (7_000 + turn) % 360_000
        target = (directions.cos(count), directions.sin(count))
        assert not check.faces(7_000_000, (0, 0), target, directions)
    # The short way round the circle: a yaw of 50 counts faces 359,960 (90 apart), not 359,940.
    for count, facing in ((359_960, True), (359_950, True), (359_949, False)):
        target = (directions.cos(count), directions.sin(count))
        assert check.faces(50_000, (0, 0), target, directions) is facing
    # The count of a vector is the one that 5.4.18 (7) picks: of the two counts that bracket it,
    # the one on its side of their directions' sum, ties to the lower count. A table direction is
    # its own count, the four axes are exact, and a vector half way between two counts takes the
    # lower.
    for count in (0, 1, 44_999, 90_000, 179_999, 270_000, 359_999):
        assert check.count_of(directions.cos(count), directions.sin(count), directions) == count
    assert [check.count_of(*v, directions) for v in ((3, 0), (0, 3), (-3, 0), (0, -3))] == [
        0,
        90_000,
        180_000,
        270_000,
    ]
    between = (directions.cos(10) + directions.cos(11), directions.sin(10) + directions.sin(11))
    assert check.count_of(*between, directions) == 10
    with pytest.raises(ValueError, match="zero vector"):
        check.count_of(0, 0, directions)
    # A stand on its own vertex faces nothing.
    assert not check.faces(7_000_000, (5, 5), (5, 5), directions)
    # Stand 0 of Rabiah, turned a count at a time until it no longer faces its vertex.
    rows, world, cards = fresh()
    assert run(rows, world, cards).assertions["stand-yaw"] == len(rows)
    turned = 0
    while not under(run(rows, world, cards), "stand-yaw"):
        rows[0][YAW] = (rows[0][YAW] + 1_000) % 360_000_000
        turned += 1
    assert 1 <= turned <= 101
    (line,) = under(run(rows, world, cards), "stand-yaw")
    assert line.startswith("stand-yaw: stand 0 ") and "does not face its path vertex" in line


def test_a_trail_that_visits_a_site_out_of_order_is_reported():
    rows, world, cards = fresh()
    world["trail"]["legs"][0]["to"] = "set:elsewhere"
    assert "trail-order" in rules(run(rows, world, cards))
    # Dominaria's spurs, two of them swapped: every other rule still holds.
    data, world, lore, held = dominaria()
    legs = world["trail"]["legs"]
    spurs = [number for number, leg in enumerate(legs) if leg["kind"] == "spur"]
    assert len(spurs) == 11
    legs[spurs[0]], legs[spurs[1]] = legs[spurs[1]], legs[spurs[0]]
    result = check.check_world(data, world, lore, held, table())
    assert rules(result) == {"trail-order"}
    assert len(under(result, "trail-order")) == 2
    assert "spur 1 visits region:benalia" in under(result, "trail-order")[0]


def test_a_chapter_stone_far_from_its_chapters_first_cluster_is_reported():
    rows, world, lore, cards = fresh_era()
    site = world["sites"][0]
    chapter = site["chapters"][1]
    first = chapter["firstCluster"]
    assert run(rows, world, cards, lore).assertions["chapter-cluster"] == 1
    # A free lattice point of the next cluster's disc, outside the discs of the two before it.
    cluster = site["clusters"][first + 1]
    centre = (cluster["centre"][0], cluster["centre"][1])
    for x, z in lattice_points(centre, CLUSTER_RADIUS - JITTER_RADIUS):
        chapter["stone"] = {"x": x, "z": z, "yaw": 0}
        if rules(run(rows, world, cards, lore)) == {"chapter-cluster"}:
            (line,) = under(run(rows, world, cards, lore), "chapter-cluster")
            assert f"the disc of cluster {first}," in line
            return
    raise AssertionError("no free lattice point of the next cluster was found")


def test_a_chapter_stone_two_clusters_before_its_first_is_reported():
    rows, world, lore, cards = fresh_era()
    site = world["sites"][0]
    chapter = site["chapters"][1]
    first = chapter["firstCluster"]
    assert first >= 2

    def centre(number: int) -> tuple[int, int]:
        return (site["clusters"][number]["centre"][0], site["clusters"][number]["centre"][1])

    def near(point: tuple[int, int], number: int) -> bool:
        x, z = centre(number)
        return (point[0] - x) ** 2 + (point[1] - z) ** 2 <= (CLUSTER_RADIUS + 10) ** 2

    # A free lattice point of the disc two clusters before the chapter's first, outside the discs
    # of the first and of the one before it: the rule's lower edge (DEC-1130 B1).
    for point in lattice_points(centre(first - 2), CLUSTER_RADIUS - JITTER_RADIUS):
        if near(point, first - 1) or near(point, first):
            continue
        chapter["stone"] = {"x": point[0], "z": point[1], "yaw": 0}
        broken = rules(run(rows, world, cards, lore))
        assert "chapter-cluster" in broken, point
        if broken == {"chapter-cluster"}:
            (line,) = under(run(rows, world, cards, lore), "chapter-cluster")
            assert f"the disc of cluster {first}," in line
            return
    raise AssertionError("no free lattice point two clusters before the first was found")


def test_the_path_of_a_site_with_no_stand_has_two_vertices(tmp_path: Path):
    data, world, lore, held = empty_era(tmp_path)
    era = world["sites"][0]
    assert era["clusters"] == [] and len(era["path"]) == 2
    result = check.check_world(data, world, lore, held, table())
    assert result.ok and result.assertions["path-empty"] == 1
    (a, b) = era["path"]
    era["path"] = [a, [(a[0] + b[0]) // 2, (a[1] + b[1]) // 2], b]
    result = check.check_world(data, world, lore, held, table())
    assert rules(result) == {"path-empty"}
    assert "has no stand and its path has 3 vertices" in under(result, "path-empty")[0]


@cache
def dominaria() -> tuple[bytes, dict[str, Any], dict[str, Any], list[CheckedCard]]:
    """The committed Dominaria fixture's files and the plane's cards from the pinned pack."""
    data, world, lore, held = _dominaria()
    return (data, copy.deepcopy(world), copy.deepcopy(lore), list(held))


@cache
def _dominaria() -> tuple[bytes, dict[str, Any], dict[str, Any], tuple[CheckedCard, ...]]:
    directory = REPO / "contract" / "test-vectors" / "v4" / "layout" / "dominaria"
    plane = read_plane(PACK, "dominaria")
    held = tuple(
        CheckedCard(
            c.oracle_id, c.set_id, (c.name,) if c.back_name is None else (c.name, c.back_name)
        )
        for c in plane.cards
    )
    return (
        (directory / "stands.bin").read_bytes(),
        json.loads((directory / "worlds" / "dominaria.json").read_text(encoding="utf-8")),
        json.loads((directory / "lore" / "dominaria.json").read_text(encoding="utf-8")),
        held,
    )


def empty_era(tmp_path: Path) -> tuple[bytes, dict[str, Any], dict[str, Any], list[CheckedCard]]:
    """The fixture of the keyword that moves one card, cut down to that card: its era site keeps
    no stand (5.4.2, 5.4.10)."""
    fixture = next(found for found in fixtures.discover() if found.name == "keyword-moves-one-card")
    shutil.copytree(fixture.directory, tmp_path / "moved")
    shard = tmp_path / "moved" / "pack" / "planes" / "ixalan.0.json"
    rows = json.loads(shard.read_text(encoding="utf-8"))
    rows["cards"] = [card for card in rows["cards"] if card["n"] == "Sunspire Lookout"]
    shard.write_text(json.dumps(rows), encoding="utf-8")
    planes = tmp_path / "moved" / "pack" / "planes.json"
    listed = json.loads(planes.read_text(encoding="utf-8"))
    listed["planes"][0]["cardCount"] = listed["planes"][0]["starCount"] = 1
    planes.write_text(json.dumps(listed), encoding="utf-8")
    built = build.build_world(
        "ixalan",
        tmp_path / "moved" / "pack",
        build.load_directions(),
        lore_dir=tmp_path / "moved" / "ixalan",
        hero_entries=load_hero_entries(),
        fixture=True,
    )
    emitted = built.emitted
    held = [
        CheckedCard(
            c.oracle_id, c.set_id, (c.name,) if c.back_name is None else (c.name, c.back_name)
        )
        for c in built.plane.cards
    ]
    assert emitted.lore is not None
    return (
        emitted.stands_bin,
        json.loads(emit.to_json(emitted.world)),
        json.loads(emit.to_json(emitted.lore)),
        held,
    )
