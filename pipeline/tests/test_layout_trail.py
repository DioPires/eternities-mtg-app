"""The routing grid, the plaza approach and a leg of the trail (PRD v4 5.4.11)."""

from __future__ import annotations

from math import isqrt
from typing import cast

from eternities.layout import regions, trail
from eternities.layout.constants import (
    GRID_PITCH,
    MARGIN,
    PATH_HALF_WIDTH,
    PLAZA_APPROACH_END,
    PLAZA_EDGE_RADIUS,
    SAMPLE_STEP,
    TRAIL_WOBBLE,
)
from eternities.layout.exact import Prng, cell_centre, grid_cell
from eternities.layout.geometry import clear, disc, polygon
from eternities.layout.trail import Leg, Obstacles

from layout_kit import directions

R = 300_000


def obstacles(volumes: list[list[tuple[int, int]]] | None = None) -> Obstacles:
    held = directions()
    return Obstacles(
        R,
        regions.world_polygon(R, held),
        disc(held.disc, 0, 0, 1, PLAZA_EDGE_RADIUS),
        [polygon(points) for points in volumes or []],
        [],
        {},
    )


class Grid:
    """A hand-made grid for the route's own rules: blocked cells, near cells and an edge."""

    def __init__(
        self, blocked: set[tuple[int, int]], near: set[tuple[int, int]], size: int = 8
    ) -> None:
        self.cells, self.near_cells, self.size = blocked, near, size

    def blocked(self, row: int, col: int) -> bool:
        return (row, col) in self.cells or not (0 <= row < self.size and 0 <= col < self.size)

    def near(self, row: int, col: int) -> bool:
        return (row, col) in self.near_cells


def route(
    grid: Grid, start: tuple[int, int], goal: tuple[int, int]
) -> list[tuple[int, int]] | None:
    return trail.route(cast("Obstacles", grid), start, goal)


def test_a_route_runs_straight_and_diagonal_at_costs_five_and_seven():
    grid = Grid(set(), set())
    assert route(grid, (0, 0), (0, 3)) == [(0, 0), (0, 1), (0, 2), (0, 3)]
    assert route(grid, (0, 0), (3, 3)) == [(0, 0), (1, 1), (2, 2), (3, 3)]
    assert route(grid, (2, 2), (2, 2)) == [(2, 2)]


def test_no_diagonal_move_passes_a_blocked_orthogonal_neighbour():
    found = route(Grid({(0, 1)}, set()), (0, 0), (1, 1))
    assert found == [(0, 0), (1, 0), (1, 1)]


def test_a_route_goes_round_a_wall_and_fails_when_the_grid_is_exhausted():
    wall = {(row, 3) for row in range(7)}
    found = route(Grid(wall, set()), (3, 0), (3, 6))
    assert found is not None
    assert found[0] == (3, 0) and found[-1] == (3, 6)
    assert not wall & set(found)
    assert (7, 3) in found
    # A wall from edge to edge leaves no route: A* expands every free cell once and stops.
    assert route(Grid({(row, 3) for row in range(8)}, set()), (3, 0), (3, 6)) is None


def test_a_cell_near_a_blob_costs_double_so_the_route_skirts_it():
    near = {(row, col) for row in range(2, 5) for col in range(2, 5)}
    found = route(Grid(set(), near), (3, 0), (3, 6))
    assert found is not None
    assert not near & set(found)
    # With no other way the route still crosses the near cells.
    band = {(row, 3) for row in range(8)}
    assert route(Grid(set(), band), (3, 0), (3, 6)) == [(3, col) for col in range(7)]


def test_smoothing_removes_a_vertex_whose_neighbours_see_each_other():
    cells = [(22, 10), (30, 20), (22, 30)]
    assert trail.smooth(obstacles(), cells) == [(22, 10), (22, 30)]
    assert trail.smooth(obstacles(), [(20, 20), (20, 21), (20, 22), (21, 23), (22, 24)]) == [
        (20, 20),
        (22, 24),
    ]
    # A wall between the two ends: the straight segment touches a blocked cell's square, so the
    # corner above the wall stays.
    wall = [(100_000, 100_000), (102_000, 100_000), (102_000, 120_000), (100_000, 120_000)]
    walled = obstacles([wall])
    assert walled.blocked(22, 20)
    assert not walled.blocked(30, 20)
    assert trail.smooth(walled, cells) == cells


def test_a_cell_is_blocked_by_the_worlds_edge_the_plaza_and_a_hero_volume_expanded_by_five_metres():
    held = obstacles(
        [[(100_000, 100_000), (110_000, 100_000), (110_000, 110_000), (100_000, 110_000)]]
    )
    # The plaza with its edge path: 15 m, expanded by 5 m.
    assert held.blocked(0, 0) and held.blocked(-1, 3)
    assert not held.blocked(0, 5)
    # The volume's own cells and the ring of cells within 5 m of it.
    assert held.blocked(20, 20) and held.blocked(19, 19) and held.blocked(22, 22)
    assert not held.blocked(23, 23) and not held.blocked(17, 20)
    # The world's edge: the cell must lie 5 m inside the 72-gon.
    assert held.blocked(0, 59) and held.blocked(70, 0)
    assert not held.blocked(0, 57)
    assert held.near(0, 0) is False


def test_the_plaza_approach_points_at_the_first_site_and_turns_past_a_hero_volume():
    toward = (100_000, 100_000)
    free = trail.plaza_approach(obstacles(), toward, directions())
    assert free is not None
    assert (free.tries, free.count) == (1, 45_000)
    assert (free.near, free.far) == ((10_607, 10_607), (17_678, 17_678))
    assert free.strip.half == PATH_HALF_WIDTH
    # A volume across the approach, north-east of the plaza: the approach turns clockwise by 10
    # degrees a try until its strip clears the volume and the cell at its far end is free.
    wall = [(12_000, 12_000), (40_000, 12_000), (40_000, 40_000), (12_000, 40_000)]
    held = obstacles([wall])
    turned = trail.plaza_approach(held, toward, directions())
    assert turned is not None
    assert turned.tries > 1
    assert turned.count == (45_000 - 10_000 * (turned.tries - 1)) % 360_000
    assert clear(turned.strip, held.volumes[0], MARGIN)
    assert not held.blocked(*grid_cell(*turned.far))
    assert turned.far[0] ** 2 + turned.far[1] ** 2 in range(24_999**2, 25_001**2)


def test_the_plaza_approach_turns_when_the_cell_at_its_far_end_touches_the_expanded_plaza():
    # Due east the far end (25 m, 0) lies on a grid line. Its cell reaches back to 20 m from
    # the origin, which is the plaza's edge path expanded by 5 m, so the cell is blocked. The
    # third try, 20 degrees clockwise, ends in a free cell.
    east = trail.plaza_approach(obstacles(), (100_000, 0), directions())
    assert east is not None
    assert (east.tries, east.count) == (3, 340_000)
    assert obstacles().blocked(*grid_cell(PLAZA_APPROACH_END, 0))


def test_the_plaza_approach_finds_no_angle_when_a_volume_rings_the_plaza():
    ring = [(-60_000, -60_000), (60_000, -60_000), (60_000, 60_000), (-60_000, 60_000)]
    assert trail.plaza_approach(obstacles([ring]), (100_000, 0), directions()) is None


def leg(held: Obstacles, start: tuple[int, int], end: tuple[int, int]) -> Leg | None:
    return trail.leg(
        held, 0, "trail", ("plaza", "set:x"), (start, end), Prng.of("leg"), directions()
    )


def test_a_leg_joins_its_two_anchor_points_by_attachment_segments():
    start, end = (17_678, 17_678), (203_211, 41_987)
    found = leg(obstacles(), start, end)
    assert found is not None
    assert (found.polyline[0], found.polyline[-1]) == (start, end)
    # Each attachment segment runs between the anchor and its cell's centre: 3.54 m at most.
    assert found.start_attachment == (start, cell_centre(*grid_cell(*start)))
    assert found.end_attachment == (cell_centre(*grid_cell(*end)), end)
    for (ax, az), (bx, bz) in (found.start_attachment, found.end_attachment):
        assert isqrt((bx - ax) ** 2 + (bz - az) ** 2) <= 3_536
    assert found.polyline[1] == found.start_attachment[1]
    assert found.polyline[-2] == found.end_attachment[0]
    assert found.length == trail.polyline_length(found.polyline)
    assert (found.kind, found.start, found.end, found.start_blocked) == (
        "trail",
        "plaza",
        "set:x",
        False,
    )
    assert 30_000 <= found.wavelength <= 50_000


def test_a_leg_is_sampled_every_half_metre_and_wobbles_three_metres_at_most():
    centres = [(2_500, 2_500), (102_500, 2_500)]
    wobbled = trail.wobble(centres, 40_000, 0, directions())
    assert (wobbled[0], wobbled[-1]) == (centres[0], centres[1])
    assert len(wobbled) == 100_000 // SAMPLE_STEP + 1
    assert all(x == 2_500 + SAMPLE_STEP * index for index, (x, _) in enumerate(wobbled))
    assert max(abs(z - 2_500) for _, z in wobbled) in range(2_900, TRAIL_WOBBLE + 1)
    # Tapered to zero over the 10 m nearest each end: a quarter of the way in, a quarter of 3 m.
    assert all(abs(z - 2_500) <= 3 * (x - 2_500) // 10 + 1 for x, z in wobbled[:20])
    assert trail.wobble([(0, 0)], 40_000, 0, directions()) == [(0, 0)]


def test_a_leg_routes_round_a_hero_volume():
    start, end = (-200_000, 102_500), (200_000, 102_500)
    free = leg(obstacles(), start, end)
    wall = [(-10_000, 40_000), (10_000, 40_000), (10_000, 160_000), (-10_000, 160_000)]
    held = obstacles([wall])
    blocked = leg(held, start, end)
    assert free is not None and blocked is not None
    assert blocked.length > free.length + 20_000
    # The reserved strip stays clear of the volume: its 5 m expansion exceeds 1.5 m + 3 m.
    assert clear(polygon(wall), trail.strip(blocked.polyline, PATH_HALF_WIDTH), MARGIN)
    assert not clear(polygon(wall), trail.strip(free.polyline, PATH_HALF_WIDTH), MARGIN)


def test_a_leg_with_no_route_is_none_and_still_takes_its_two_draws():
    ring = [
        (140_000, 40_000),
        (260_000, 40_000),
        (260_000, 160_000),
        (140_000, 160_000),
        (140_000, 40_000),
        (150_000, 50_000),
        (150_000, 150_000),
        (250_000, 150_000),
        (250_000, 50_000),
        (150_000, 50_000),
    ]
    prng = Prng.of("leg")
    found = trail.leg(
        obstacles([ring]),
        0,
        "trail",
        ("plaza", "set:x"),
        ((25_000, 0), (200_000, 100_000)),
        prng,
        directions(),
    )
    assert found is None
    again = Prng.of("leg")
    again.bits()
    again.bits()
    assert prng.state == again.state


def test_a_spur_starts_at_the_vertex_of_the_trail_nearest_its_site():
    def made(index: int, points: list[tuple[int, int]]) -> Leg:
        return Leg(
            index=index,
            kind="trail",
            start="a",
            end="b",
            polyline=tuple(points),
            start_attachment=(points[0], points[0]),
            end_attachment=(points[-1], points[-1]),
            length=0,
            wavelength=30_000,
            phase=0,
            cells=0,
            start_blocked=False,
        )

    legs = [made(0, [(0, 0), (10, 0), (20, 0)]), made(1, [(20, 0), (20, 10), (10, 10)])]
    assert trail.nearest_vertex(legs, (11, 1)) == (10, 0)
    assert trail.nearest_vertex(legs, (19, 9)) == (20, 10)
    # A tie goes to the lower leg, then to the lower vertex.
    assert trail.nearest_vertex(legs, (10, 5)) == (10, 0)
    assert trail.nearest_vertex(legs, (20, 0)) == (20, 0)
    assert GRID_PITCH == 5_000
