"""A site's local geometry (PRD v4 5.4.1, 5.4.7, 5.4.8): the blob, the sweeps and half-turns,
the head ray, the pad, the approach and its test, the stone and the containment bound.

The seeds below are plain site keys. Which of them gives a second try, or a stone on the right,
was found by trial; each test states what it relies on and asserts it first.
"""

from __future__ import annotations

import itertools
from math import isqrt

import pytest

from eternities.layout import local
from eternities.layout.constants import (
    APPROACH_LENGTH,
    MARGIN,
    MICRO_PER_TURN,
    OBSTACLE_EXPANSION,
    PAD_RADIUS,
    PATH_HALF_WIDTH,
    SAMPLE_STEP,
    STONE_ACROSS,
    STONE_ALONG,
    STONE_CLEARANCE,
    STONE_RADIUS,
    SWEEP_SPACING,
    SWEEP_WOBBLE,
    site_seed,
)
from eternities.layout.exact import SCALE, Prng, cell_square, grid_cell
from eternities.layout.geometry import clear, polygon, strip

from layout_kit import directions

EAST = 0


def built(slug: str, key: str, radius: int) -> local.Local:
    found = local.build(radius, site_seed(slug, key), directions())
    assert found is not None
    return found


def test_the_radii_of_5_4_1_are_integers():
    assert local.base_radius(1) == 9_000
    assert local.base_radius(7) == 9_000
    assert local.base_radius(8) == isqrt(11_459_156 * 8) == 9_574
    assert local.base_radius(600) == 82_918
    # A widening is floor(11 r / 10); the bounding radius is ceil(6 r / 5) + 15 m.
    assert local.widened(9_000) == 9_900
    assert local.widened(9_999) == 10_998
    assert local.bounding_radius(9_000) == 25_800
    assert local.bounding_radius(9_001) == 25_802


@pytest.mark.parametrize("key", ["set:a", "set:b", "era:c", "region:d", "set:e"])
def test_a_blob_stays_within_twenty_percent_of_its_radius(key: str):
    radius = 40_000
    prng = Prng.of(site_seed("rath", key))
    blob = local.blob_of(radius, prng, directions())
    assert len(blob.pts) == 72
    for x, z in blob.pts:
        squared = x * x + z * z
        assert (4 * radius * blob.den) ** 2 <= 25 * squared <= (6 * radius * blob.den) ** 2
    # Six draws, in the order a2, phi2, a3, phi3, a4, phi4.
    again = Prng.of(site_seed("rath", key))
    for _ in range(3):
        assert 200 <= again.randint(200, 1_000) <= 1_000
        assert 0 <= again.randint(0, MICRO_PER_TURN - 1) < MICRO_PER_TURN
    assert again.state == prng.state


def test_a_floor_radius_blob_has_one_sweep_and_no_half_turn():
    site = built("rath", "set:x", 9_000)
    assert (site.sweeps, site.tries) == (1, 1)
    assert set(site.turn) == {0}
    assert site.first_run == len(site.path)
    assert site.bounding == 25_800
    # The run is sampled every 0.5 m and at its end, then wobbled by 3 m at most.
    assert len(site.path) == 28
    assert site.arcs[-1] == 14_101
    assert site.arcs == local.arc_lengths(site.path)


def test_a_large_blob_has_sweeps_joined_by_half_turns_of_thirteen_vertices():
    site = built("rath", "set:big", 150_000)
    assert site.sweeps == 16
    turns: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate([*site.turn, 0]):
        if value != 0 and start is None:
            start = index
        elif value == 0 and start is not None:
            turns.append((start, index))
            start = None
    assert len(turns) == 15
    for first, last in turns:
        # Twelve segments of 15 degrees: thirteen vertices, the two ends included.
        assert last - first == 12
        (ax, az), (bx, bz) = site.path[first], site.path[last]
        # The two ends lie one sweep spacing apart, and every vertex h / 2 from their midpoint.
        assert abs(isqrt((bx - ax) ** 2 + (bz - az) ** 2) - SWEEP_SPACING) <= 1
        for x, z in site.path[first : last + 1]:
            squared = (2 * x - ax - bx) ** 2 + (2 * z - az - bz) ** 2
            assert (SWEEP_SPACING - 3) ** 2 <= squared <= (SWEEP_SPACING + 3) ** 2
    # Consecutive half-turns turn opposite ways.
    signs = [site.turn[first] for first, _ in turns]
    assert signs == [(-1) ** k * signs[0] for k in range(15)]


def test_a_run_is_sampled_every_half_metre_and_wobbles_three_metres_at_most():
    site = built("rath", "set:x", 9_000)
    c, s = directions().at(site.sweep_count)
    (hx, hz), (ex, ez) = site.path[0], site.path[-1]
    # The run's two ends are not displaced: the taper is zero there. They lie along d_s.
    assert abs((ex - hx) * s - (ez - hz) * c) <= 2 * SCALE
    for x, z in site.path:
        across = (z - hz) * c - (x - hx) * s
        assert abs(across) <= (SWEEP_WOBBLE + 1) * SCALE
    along = [((x - hx) * c + (z - hz) * s) // SCALE for x, z in site.path]
    assert all(abs(b - a - SAMPLE_STEP) <= 1 for a, b in itertools.pairwise(along[:-1]))
    assert 0 < along[-1] - along[-2] <= SAMPLE_STEP + 1


def test_the_join_trims_both_chords_to_the_nearer_end():
    # A trapezoid whose right side leans in: the chord of sweep 0 ends at x = 35 m and the chord
    # of sweep 1 at x = 25 m.
    blob = polygon([(-40_000, 0), (40_000, 0), (20_000, 42_000), (-40_000, 42_000)])
    first, second = local._chords(blob, directions().at(EAST)) or []
    assert (first.offset, second.offset) == (10_500, 31_500)
    # Shortened by 15 m at the joined ends: 20 m and 10 m. Both are trimmed to 10 m.
    assert first.far == second.head == 10_000
    assert first.head == -40_000 + 1_500
    assert second.far == -40_000 + 4_500


def test_a_blob_too_small_for_a_slot_has_no_path_in_eighteen_tries():
    # Every chord of a 3 m blob is shorter than the slot spacing after its shortening.
    assert local.build(3_000, site_seed("rath", "set:x"), directions()) is None
    prng = Prng.of(site_seed("rath", "set:x"))
    blob = local.blob_of(3_000, prng, directions())
    assert local._try(3_000, blob, 0, (), prng, directions()) == local.EMPTY_PATH


def test_the_head_ray_carries_the_pad_and_the_approach():
    site = built("rath", "set:x", 9_000)
    hx, hz = site.path[0]
    assert site.head_count == directions().count_of(hx, hz)
    uc, us = directions().at(site.head_count)
    # The pad's centre is 1.5 m past the head, and the approach point 11.5 m past it.
    assert site.pad == (hx + round_div(PAD_RADIUS * uc), hz + round_div(PAD_RADIUS * us))
    reach = PAD_RADIUS + APPROACH_LENGTH
    assert site.approach_point == (hx + round_div(reach * uc), hz + round_div(reach * us))
    assert site.approach_strip.pts == (site.pad, site.approach_point)
    assert site.approach_strip.half == PATH_HALF_WIDTH
    assert site.path_strip.pts == site.path


def round_div(value: int) -> int:
    return (
        (2 * value + SCALE) // (2 * SCALE) if value >= 0 else -((-2 * value + SCALE) // (2 * SCALE))
    )


def test_the_approach_test_fails_a_sweep_direction_and_the_next_try_passes():
    seed = site_seed("rath", "set:y")
    site = built("rath", "set:y", 9_000)
    assert site.tries == 2
    assert site.failures == (local.SQUARE_NEAR_BLOB,)
    # One draw gives the first direction; each try advances it by 10 degrees and draws no more.
    prng = Prng.of(seed)
    blob = local.blob_of(9_000, prng, directions())
    drawn = prng.randint(0, MICRO_PER_TURN // 2 - 1) // 1_000
    assert site.sweep_count == drawn + 10_000
    state = prng.state
    assert local._try(9_000, blob, drawn, (), prng, directions()) == local.SQUARE_NEAR_BLOB
    # The try that passes clears the blob: the approach past the pad, and the attachment square.
    square = polygon(cell_square(*grid_cell(*site.approach_point)))
    assert clear(square, site.blob, OBSTACLE_EXPANSION + MARGIN)
    hx, hz = site.path[0]
    uc, us = directions().at(site.head_count)
    far_edge = (hx * SCALE + 2 * PAD_RADIUS * uc, hz * SCALE + 2 * PAD_RADIUS * us)
    point = (site.approach_point[0] * SCALE, site.approach_point[1] * SCALE)
    assert clear(strip([far_edge, point], 0, SCALE), site.blob, MARGIN)
    # The site's stream continues the same way whatever the try: two draws a sweep.
    prng.state = state
    prng.randint(24_000, 40_000)
    prng.randint(0, MICRO_PER_TURN - 1)
    assert site.state == prng.state


def test_the_tries_name_the_stone_test_when_it_fails():
    site = built("rath", "set:hd3", 38_388)
    assert (site.tries, site.failures) == (2, (local.STONE_TEST,))
    many = built("rath", "set:hc5", 22_845)
    assert many.tries == 5
    assert many.failures == (local.SQUARE_NEAR_BLOB, *[local.STONE_TEST] * 3)


@pytest.mark.parametrize(
    ("slug", "key", "radius", "side"),
    [("rath", "set:x", 9_000, 1), ("rabiah", "set:arn", 29_316, -1)],
    ids=["left", "right"],
)
def test_the_stone_stands_beside_the_approach_on_the_side_farther_from_the_first_run(
    slug: str, key: str, radius: int, side: int
):
    site = built(slug, key, radius)
    assert site.stone_side == side
    hx, hz = site.path[0]
    uc, us = directions().at(site.head_count)
    along = (hx * SCALE + STONE_ALONG * uc, hz * SCALE + STONE_ALONG * us)
    left = (along[0] - STONE_ACROSS * us, along[1] + STONE_ACROSS * uc)
    right = (along[0] + STONE_ACROSS * us, along[1] - STONE_ACROSS * uc)
    assert site.stone == (left if side > 0 else right)

    def squared_to_first_run(point: tuple[int, int]) -> int:
        return min(
            (x * SCALE - point[0]) ** 2 + (z * SCALE - point[1]) ** 2
            for x, z in site.path[: site.first_run]
        )

    taken, other = (left, right) if side > 0 else (right, left)
    assert squared_to_first_run(taken) >= squared_to_first_run(other)
    # The stone test: outside the blob and 0.5 m from the blob, the pad, the approach, the path.
    spacing = STONE_CLEARANCE + MARGIN
    assert len(site.stone_disc.pts) == 72
    assert clear(site.stone_disc, site.blob, spacing)
    assert clear(site.stone_disc, site.pad_disc, spacing)
    assert clear(site.approach_strip, site.stone_disc, spacing)
    assert clear(site.path_strip, site.stone_disc, spacing)
    # Its centre is 3.9 m from the pad's centre: within reach of the pad.
    px, pz = site.pad[0] * SCALE, site.pad[1] * SCALE
    reach = isqrt(((site.stone[0] - px) ** 2 + (site.stone[1] - pz) ** 2) // SCALE**2)
    assert 3_900 <= reach <= 3_906


@pytest.mark.parametrize(
    ("slug", "key", "radius"),
    [("rath", "set:x", 9_000), ("rabiah", "set:arn", 42_919), ("rath", "set:big", 150_000)],
)
def test_everything_a_site_owns_lies_within_its_bounding_radius(slug: str, key: str, radius: int):
    site = built(slug, key, radius)
    bound = site.bounding
    assert bound == -(-6 * radius // 5) + 15_000
    # The path's centreline lies within 1.2 r_s + 6 m; with its half width, inside b_s.
    for x, z in site.path:
        assert x * x + z * z <= (bound - PATH_HALF_WIDTH) ** 2
        assert 25 * (x * x + z * z) <= (6 * radius + 5 * 6_000) ** 2
    for x, z in (site.pad, site.approach_point):
        assert x * x + z * z <= (bound - PATH_HALF_WIDTH) ** 2
    sx, sz = site.stone
    assert sx * sx + sz * sz <= ((bound - STONE_RADIUS) * SCALE) ** 2
    # The blob itself lies within 1.2 r_s of the centre.
    den = site.blob.den
    assert all(25 * (x * x + z * z) <= (6 * radius * den) ** 2 for x, z in site.blob.pts)
