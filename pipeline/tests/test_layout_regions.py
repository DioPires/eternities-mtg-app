"""The world disc, its partition and site placement (PRD v4 5.4.4, 5.4.5, 5.4.6)."""

from __future__ import annotations

from fractions import Fraction
from math import isqrt

import pytest

from eternities.layout import placing, regions
from eternities.layout.constants import CELL_MARGIN, MARGIN, PLAZA_EDGE_RADIUS, SITE_SPACING
from eternities.layout.geometry import clear, inside, point_in_polygon, polygon
from eternities.layout.regions import DegenerateCell, RegionRow

from layout_kit import directions

R = 500_000


def row(ident: str, u: int, v: int, weight: int = 1_000) -> RegionRow:
    return RegionRow(ident, (u, v), weight)


def test_the_initial_radius_is_the_largest_of_its_three_terms():
    # 5.4.4: max(30 m, isqrt(2 x sum b^2) + 25 m, 35 m + 2 b_max).
    assert regions.initial_radius([]) == 30_000
    assert regions.initial_radius([25_800]) == 35_000 + 2 * 25_800
    many = [100_000] * 20
    assert regions.initial_radius(many) == isqrt(2 * 20 * 100_000**2) + 25_000
    assert regions.initial_radius(many) > 35_000 + 2 * 100_000


def test_a_widening_of_r_rounds_up_to_the_millimetre():
    assert regions.widened_world(86_600) == 95_260
    assert regions.widened_world(95_261) == 104_788
    assert regions.widened_world(10) == 11
    assert regions.widened_world(11) == 13


def test_the_world_disc_is_a_regular_72_gon():
    world = regions.world_polygon(R, directions())
    assert len(world.pts) == 72
    assert regions.doubled_area(world) < 2 * 355 * R * R // 113
    assert regions.doubled_area(world) > 2 * 314 * R * R // 100 * 998 // 1000


def test_one_region_has_the_whole_world_for_its_cell():
    (cell,) = regions.partition(R, [row("only", 300, -200)], directions())
    assert regions.doubled_area(cell) == regions.doubled_area(
        regions.world_polygon(R, directions())
    )


FOUR = [row("north", 0, 500), row("east", 500, 0), row("south", 0, -500), row("west", -500, 0)]
TWELVE = [
    row("centre", 0, 0, 500),
    row("a", 700, 0),
    row("b", 600, 350),
    row("c", 350, 600, 1_500),
    row("d", 0, 700),
    row("e", -350, 600),
    row("f", -600, 350, 2_000),
    row("g", -700, 0),
    row("h", -600, -350),
    row("i", -350, -600, 800),
    row("j", 0, -700),
    row("k", 450, -450),
]


@pytest.mark.parametrize("rows", [FOUR, TWELVE], ids=["four", "twelve"])
def test_the_cells_tile_the_disc_exactly(rows: list[RegionRow]):
    cells = regions.partition(R, rows, directions())
    assert len(cells) == len(rows)
    world = regions.doubled_area(regions.world_polygon(R, directions()))
    # Exact rational areas: the cells leave no gap and no overlap.
    assert sum((regions.doubled_area(cell) for cell in cells), Fraction(0)) == world
    for cell in cells:
        assert regions.doubled_area(cell) > 0


def test_a_cell_holds_the_points_nearer_its_anchor_in_the_power_distance():
    cells = regions.partition(R, FOUR, directions())
    # Equal weights: each anchor, scaled by 0.8 R, lies in its own cell and in no other.
    for position, held in enumerate(FOUR):
        x, z = 4 * R * held.anchor[0] // 5_000, 4 * R * held.anchor[1] // 5_000
        inside_of = [
            index
            for index, cell in enumerate(cells)
            if point_in_polygon(x * cell.den, z * cell.den, cell.pts)
        ]
        assert inside_of == [position]


def test_a_heavier_region_takes_ground_from_its_neighbour():
    even = regions.partition(R, [row("a", -300, 0), row("b", 300, 0)], directions())
    heavy = regions.partition(R, [row("a", -300, 0, 2_000), row("b", 300, 0, 500)], directions())
    assert regions.doubled_area(even[0]) == regions.doubled_area(even[1])
    assert regions.doubled_area(heavy[0]) > regions.doubled_area(even[0])
    assert regions.doubled_area(heavy[1]) < regions.doubled_area(even[1])


def test_the_partition_has_the_same_shape_at_every_r():
    small = regions.partition(R, TWELVE, directions())
    large = regions.partition(3 * R, TWELVE, directions())
    for a, b in zip(small, large, strict=True):
        assert 9 * regions.doubled_area(a) == regions.doubled_area(b)


def test_anchors_at_the_minimum_separation_give_two_cells_of_positive_area():
    # 150 thousandths apart (4.16.2), equal weights.
    cells = regions.partition(R, [row("a", 0, 0), row("b", 150, 0)], directions())
    assert all(regions.doubled_area(cell) > 0 for cell in cells)


def test_a_degenerate_cell_fails_naming_the_region():
    # The lightest region at the disc's edge, 150 thousandths from the heaviest: its half-plane
    # lies outside the world.
    rows = [row("edge", 1_000, 0, 500), row("heavy", 850, 0, 2_000)]
    with pytest.raises(DegenerateCell, match="region 'edge': degenerate cell") as raised:
        regions.partition(R, rows, directions())
    assert raised.value.region == "edge"
    # No widening cures it: the partition has the same shape at every R.
    with pytest.raises(DegenerateCell):
        regions.partition(7 * R, rows, directions())


# --- site placement (5.4.6) --------------------------------------------------------------------


def ground(volumes: list[list[tuple[int, int]]] | None = None) -> placing.Ground:
    return placing.Ground(directions(), [polygon(points) for points in volumes or []])


def test_the_first_site_stands_nearest_the_plaza_and_ten_metres_from_its_edge_path():
    world = regions.world_polygon(R, directions())
    held = ground()
    centre = placing.place(held, 40_000, world, (0, 0), [])
    assert centre is not None
    assert centre[0] % 10_000 == 0 and centre[1] % 10_000 == 0
    disc = held.bounding_disc(centre, 40_000)
    assert clear(disc, held.plaza, SITE_SPACING + MARGIN)
    # No admissible lattice point is nearer the origin; ties go to the lower row, then column.
    squared = centre[0] ** 2 + centre[1] ** 2
    assert squared >= (PLAZA_EDGE_RADIUS + SITE_SPACING + 40_000 * 999 // 1000) ** 2
    assert centre == (-30_000, -60_000)


def test_the_next_site_stands_nearest_the_one_before_and_ten_metres_from_it():
    world = regions.world_polygon(R, directions())
    held = ground()
    first = placing.place(held, 40_000, world, (0, 0), [])
    assert first is not None
    placed = [placing.Placed(first, 40_000)]
    second = placing.place(held, 30_000, world, first, placed)
    assert second is not None
    assert clear(
        held.bounding_disc(second, 30_000), held.bounding_disc(first, 40_000), SITE_SPACING + MARGIN
    )
    gap = isqrt((second[0] - first[0]) ** 2 + (second[1] - first[1]) ** 2)
    assert 80_000 <= gap < 90_000 + 15_000
    assert not placing.admissible(held, first, 30_000, world, placed)


def test_a_site_keeps_its_bounding_disc_ten_metres_inside_its_cell():
    cells = regions.partition(R, FOUR, directions())
    held = ground()
    centre = placing.place(held, 40_000, cells[1], (0, 0), [])
    assert centre is not None
    assert inside(held.bounding_disc(centre, 40_000), cells[1], CELL_MARGIN + MARGIN)
    # The same disc 10 m farther toward the cell's boundary no longer fits.
    assert placing.admissible(held, centre, 40_000, cells[1], [])
    assert not placing.admissible(held, centre, 40_000, cells[0], [])


def test_a_region_that_cannot_hold_its_site_is_short():
    cells = regions.partition(100_000, FOUR, directions())
    assert placing.place(ground(), 60_000, cells[0], (0, 0), []) is None
    # At a larger R the same site fits: the cell grows with R squared.
    wide = regions.partition(400_000, FOUR, directions())
    assert placing.place(ground(), 60_000, wide[0], (0, 0), []) is not None


def test_a_hero_volume_moves_a_site_and_does_not_clip_it():
    world = regions.world_polygon(R, directions())
    free = placing.place(ground(), 40_000, world, (0, 0), [])
    assert free is not None
    box = [
        (free[0] - 20_000, free[1] - 20_000),
        (free[0] + 20_000, free[1] - 20_000),
        (free[0] + 20_000, free[1] + 20_000),
        (free[0] - 20_000, free[1] + 20_000),
    ]
    held = ground([box])
    moved = placing.place(held, 40_000, world, (0, 0), [])
    assert moved is not None and moved != free
    assert clear(held.bounding_disc(moved, 40_000), held.volumes[0], SITE_SPACING + MARGIN)
    assert not placing.admissible(held, free, 40_000, world, [])
