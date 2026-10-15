"""The allocator's predicates on filled shapes (PRD v4 5.4.18 (4), (10)).

The checker has predicates of its own (``test_layout_check``). These are the allocator's, tested
on the same three traps as the predicate documents: the two predicate fixtures of 5.4.14 and the
notch vertex.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eternities.layout.constants import MARGIN
from eternities.layout.exact import SCALE
from eternities.layout.geometry import (
    SegmentIndex,
    Shape,
    boxes_apart,
    clear,
    disc,
    inside,
    point_in_polygon,
    point_inside,
    point_segment_clear,
    polygon,
    rectangle,
    segments_clear,
    segments_intersect,
    squared_distance_to_polyline,
    strip,
    touches,
)

from layout_kit import directions

SQUARE = [(0, 0), (10_000, 0), (10_000, 10_000), (0, 10_000)]


def square(x: int, z: int, side: int) -> Shape:
    return polygon([(x, z), (x + side, z), (x + side, z + side), (x, z + side)])


@pytest.mark.parametrize(
    ("point", "held"),
    [
        ((5_000, 5_000), True),
        ((0, 5_000), True),
        ((10_000, 10_000), True),
        ((5_000, 0), True),
        ((10_001, 5_000), False),
        ((-1, 0), False),
        ((5_000, 10_001), False),
    ],
)
def test_a_point_on_the_boundary_is_inside(point: tuple[int, int], held: bool):
    assert point_in_polygon(point[0], point[1], SQUARE) is held


def test_even_odd_holds_on_a_concave_polygon():
    notch = [(0, 0), (10, 0), (10, 10), (6, 10), (6, 4), (4, 4), (4, 10), (0, 10)]
    assert point_in_polygon(2, 8, notch)
    assert point_in_polygon(8, 8, notch)
    assert not point_in_polygon(5, 8, notch)
    assert point_in_polygon(5, 4, notch)
    assert point_in_polygon(5, 2, notch)


def test_segments_intersect_by_the_signs_of_cross_products():
    assert segments_intersect((0, 0), (10, 10), (0, 10), (10, 0))
    assert segments_intersect((0, 0), (10, 0), (10, 0), (20, 5))
    assert segments_intersect((0, 0), (10, 0), (5, 0), (15, 0))
    assert not segments_intersect((0, 0), (10, 0), (11, 0), (20, 0))
    assert not segments_intersect((0, 0), (10, 0), (0, 1), (10, 1))
    assert segments_intersect((0, 0), (10, 0), (5, 0), (5, 9))


def test_a_distance_is_compared_squared_and_never_taken():
    assert point_segment_clear(5, 3, (0, 0), (10, 0), 9)
    assert not point_segment_clear(5, 3, (0, 0), (10, 0), 10)
    # Past an end the distance is to the end point.
    assert point_segment_clear(13, 4, (0, 0), (10, 0), 25)
    assert not point_segment_clear(13, 4, (0, 0), (10, 0), 26)
    assert segments_clear((0, 0), (10, 0), (0, 3), (10, 3), 9)
    assert not segments_clear((0, 0), (10, 0), (0, 3), (10, 3), 10)
    assert not segments_clear((0, 0), (10, 10), (0, 10), (10, 0), 1)


def test_the_margin_a_clearance_of_c_is_tested_as_c_plus_two_millimetres():
    # Two squares 1,000 mm apart: clear by 1,000 mm, and not by the allocator's 1,000 mm + 2 mm.
    left, right = square(0, 0, 5_000), square(6_000, 0, 5_000)
    assert clear(left, right, 1_000)
    assert not clear(left, right, 1_000 + MARGIN)
    assert clear(left, square(6_002, 0, 5_000), 1_000 + MARGIN)
    # A point required inside a shape must lie 2 mm inside it.
    assert point_inside(2, 2_500, 1, left, MARGIN)
    assert not point_inside(1, 2_500, 1, left, MARGIN)


def test_two_nested_squares_with_no_edge_crossing_intersect():
    outer, inner = square(0, 0, 10_000), square(4_000, 4_000, 2_000)
    assert touches(outer, inner)
    assert touches(inner, outer)
    # Their boundaries are 4 m apart, and the filled shapes are at distance zero.
    assert not clear(outer, inner, 1)
    assert not clear(inner, outer, 1)
    assert not touches(outer, square(20_000, 0, 1_000))
    assert touches(outer, square(10_000, 10_000, 1_000))


NOTCHED = [
    (0, 0),
    (20_000, 0),
    (20_000, 10_000),
    (10_500, 10_000),
    (10_500, 4_000),
    (9_500, 4_000),
    (9_500, 10_000),
    (0, 10_000),
]
"""A 20 m by 10 m rectangle with a notch 1 m wide cut 6 m down from its top edge."""


def test_a_strip_whose_width_enters_a_notch_is_not_inside():
    blob = polygon(NOTCHED)
    # The polyline passes 0.5 m under the notch: its vertices are inside and it crosses no edge.
    line = [(2_000, 3_500), (18_000, 3_500)]
    assert all(point_in_polygon(x, z, NOTCHED) for x, z in line)
    assert inside(strip(line, 0), blob, 1)
    assert inside(strip(line, 498), blob, MARGIN)
    # At 1.5 m of half width, the strip's side enters the notch.
    assert not inside(strip(line, 1_500), blob, MARGIN)
    # Lower down the same strip fits.
    assert inside(strip([(2_000, 2_000), (18_000, 2_000)], 1_500), blob, MARGIN)


def test_a_strip_meets_a_shape_when_its_polyline_is_nearer_than_its_half_width():
    path = strip([(0, 0), (10_000, 0)], 1_500)
    assert clear(path, square(4_000, 2_500, 1_000), 1_000)
    assert not clear(path, square(4_000, 2_499, 1_000), 1_000)
    # A shape wholly inside the strip's width is caught.
    assert not clear(path, square(4_000, 200, 500), 1)
    # Two strips: the half widths add.
    assert clear(path, strip([(0, 4_000), (10_000, 4_000)], 1_500), 1_000)
    assert not clear(path, strip([(0, 3_999), (10_000, 3_999)], 1_500), 1_000)


def test_a_disc_is_the_72_gon_of_the_table_directions():
    held = disc(directions().disc, 1_000, -2_000, 1, 500)
    assert len(held.pts) == 72
    assert held.den == SCALE
    assert held.pts[0] == (1_500 * SCALE, -2_000 * SCALE)
    assert held.pts[18] == (1_000 * SCALE, -1_500 * SCALE)
    assert held.box == (500, -2_500, 1_500, -1_500)
    for x, z in held.pts:
        dx, dz = x - 1_000 * SCALE, z + 2_000 * SCALE
        # Each vertex is 500 mm from the centre, to the table's last bit.
        assert abs(dx * dx + dz * dz - (500 * SCALE) ** 2) < 500 * 500 * 4 * SCALE


def test_a_rectangle_runs_along_its_table_direction():
    north = directions().at(90_000)
    held = rectangle(0, 0, north, -150, 150, 350)
    assert [(x // SCALE, z // SCALE) for x, z in held.pts] == [
        (350, -150),
        (350, 150),
        (-350, 150),
        (-350, -150),
    ]


def test_shapes_over_two_denominators_are_compared_exactly():
    whole = square(0, 0, 1_000)
    halves = polygon([(4_001, 0), (6_000, 0), (6_000, 2_000), (4_001, 2_000)], 2)
    # The second square starts at x = 2,000.5 mm: 1,000.5 mm from the first.
    assert clear(whole, halves, 1_000)
    assert not clear(whole, halves, 1_001)
    assert whole.translated(5, -5).pts[0] == (5, -5)
    assert halves.translated(1, 0).pts[0] == (4_003, 0)


def test_boxes_and_the_segment_index_only_ever_prove_two_shapes_apart():
    assert boxes_apart((0, 0, 10, 10), (21, 0, 30, 10), 10)
    assert not boxes_apart((0, 0, 10, 10), (20, 0, 30, 10), 10)
    path = [(x, 0) for x in range(0, 40_001, 500)]
    index = SegmentIndex(path)
    near = index.near((20_000, 1_000, 20_500, 1_200), 600)
    assert near == sorted(near)
    assert 40 in near
    assert all(abs(path[i][0] - 20_000) < 10_000 for i in near)
    far = strip(path, 1_500)
    assert far.edges_near((20_000, 5_000, 20_500, 5_200), 100) == []
    assert far.edge_count() == len(path) - 1
    assert polygon(SQUARE).edge_count() == 4


def test_the_squared_distance_to_a_polyline_is_a_ratio_of_integers():
    path = [(0, 0), (10, 0), (10, 10)]
    assert squared_distance_to_polyline(5, 3, 1, path) == (9 * 100, 100)
    assert squared_distance_to_polyline(-3, 4, 1, path) == (25, 1)
    assert squared_distance_to_polyline(13, 14, 1, path) == (25, 1)
    # A point over a denominator of 2: (5, 3) over 2 is (2.5, 1.5); 1.5^2 x 2^2 = 9.
    num, div = squared_distance_to_polyline(5, 3, 2, path)
    assert num == 9 * div


PREDICATES = (
    Path(__file__).resolve().parents[2]
    / "contract"
    / "test-vectors"
    / "v4"
    / "layout"
    / "predicates"
)


@pytest.mark.parametrize("clearance", [1, MARGIN])
def test_the_allocators_predicates_judge_the_three_predicate_documents_as_the_checker_does(
    clearance: int,
):
    # 5.4.14 and DEC-1091 N19: the notch, the nested squares and the notch vertex. The documents
    # are for the two checkers; the allocator decides the same cases with predicates of its own,
    # at a clearance of 1 mm and at the margin of 2 mm.
    notch = json.loads((PREDICATES / "notch.json").read_text(encoding="utf-8"))
    blob = polygon([(x, z) for x, z in notch["polygon"]])
    line = [(x, z) for x, z in notch["polyline"]]
    assert notch["expected"] is False
    assert all(point_in_polygon(x, z, blob.pts) for x, z in line)
    assert not inside(strip(line, notch["halfWidth"]), blob, clearance)
    nested = json.loads((PREDICATES / "nested-squares.json").read_text(encoding="utf-8"))
    outer = polygon([(x, z) for x, z in nested["outer"]])
    inner = polygon([(x, z) for x, z in nested["inner"]])
    assert nested["expected"] is True
    assert touches(outer, inner) and touches(inner, outer)
    assert not clear(outer, inner, clearance) and not clear(inner, outer, clearance)
    vertex = json.loads((PREDICATES / "notch-vertex.json").read_text(encoding="utf-8"))
    notched = polygon([(x, z) for x, z in vertex["outer"]])
    held = polygon([(x, z) for x, z in vertex["inner"]])
    assert vertex["expected"] is False
    assert all(point_in_polygon(x, z, notched.pts) for x, z in held.pts)
    assert not inside(held, notched, clearance)
    assert touches(held, notched) and not clear(held, notched, clearance)
