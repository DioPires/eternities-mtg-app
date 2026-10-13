"""The exact primitives of PRD v4 5.4.18: rounding, draws, the trig lookup and the lattices."""

from __future__ import annotations

from fractions import Fraction
from math import isqrt

import pytest

from eternities.layout import trig
from eternities.layout.constants import (
    COUNTS_PER_TURN,
    JITTER_RADIUS,
    LATTICE_PITCH,
    MIN_STAND_SPACING,
    site_seed,
    world_seed,
)
from eternities.layout.exact import (
    SCALE,
    Prng,
    ceil_div,
    cell_centre,
    cell_square,
    fnv1a64,
    grid_cell,
    lattice_point,
    lattice_within,
    left_normal,
    round_fraction,
    round_half_away,
)

from layout_kit import directions


@pytest.mark.parametrize(
    ("num", "den", "rounded"),
    [
        (1, 2, 1),
        (-1, 2, -1),
        (3, 2, 2),
        (-3, 2, -2),
        (5, 2, 3),
        (-5, 2, -3),
        (49, 100, 0),
        (-49, 100, 0),
        (51, 100, 1),
        (-51, 100, -1),
        (0, 7, 0),
        (7, 1, 7),
        (-7, 1, -7),
    ],
)
def test_rounding_is_half_away_from_zero(num: int, den: int, rounded: int):
    # 5.4.18 (3): sign(q) x floor(|q| + 1/2), so -0.5 becomes -1.
    assert round_half_away(num, den) == rounded
    assert round_fraction(Fraction(num, den)) == rounded


def test_ceil_div_rounds_toward_plus_infinity():
    assert [ceil_div(n, 10) for n in (-11, -10, -1, 0, 1, 10, 11)] == [-1, -1, 0, 0, 1, 1, 2]


def test_fnv_1a_64_of_known_strings():
    assert fnv1a64("") == 0xCBF29CE484222325
    assert fnv1a64("a") == 0xAF63DC4C8601EC8C
    assert fnv1a64("foobar") == 0x85944171F73967E8


def test_splitmix64_gives_the_reference_stream():
    prng = Prng(0)
    assert [prng.bits() for _ in range(3)] == [
        0xE220A8397B1DCDAF,
        0x6E789E6AA1B965F4,
        0x06C45D188009454F,
    ]


def test_a_draw_is_lo_plus_the_bits_modulo_the_span():
    first, second = Prng(42), Prng(42)
    bits = first.bits()
    assert second.randint(3, 8) == 3 + bits % 6
    assert all(3 <= Prng(seed).randint(3, 8) <= 8 for seed in range(200))
    assert {Prng(seed).randint(3, 8) for seed in range(200)} == {3, 4, 5, 6, 7, 8}


def test_the_seed_strings_of_5_4_1():
    assert site_seed("dominaria", "era:ice-age") == "eternities-v4|dominaria|era:ice-age"
    assert world_seed("rabiah") == "eternities-v4|rabiah|world"
    assert Prng.of("eternities-v4|rabiah|world").state == fnv1a64("eternities-v4|rabiah|world")


def test_the_trig_table_is_read_as_cos_and_sin_over_two_to_the_thirty():
    held = directions()
    assert held.sha256 == trig.TRIG_SHA256
    assert held.at(0) == (SCALE, 0)
    assert held.at(90_000) == (0, SCALE)
    assert held.at(30_000) == (929_887_697, SCALE // 2)
    assert held.at(180_000) == (-SCALE, 0)
    # A count is reduced to one turn; a negative count too.
    assert held.at(COUNTS_PER_TURN + 30_000) == held.at(30_000)
    assert held.at(-90_000) == (0, -SCALE)


def test_an_angle_is_reduced_then_truncated_to_a_thousandth_of_a_degree():
    held = directions()
    assert held.of_micro(30_000_999) == held.at(30_000)
    assert held.of_micro(360_000_000 + 30_000_000) == held.at(30_000)
    # Reduced modulo one turn first, so -1 micro-degree is the last count of the turn.
    assert held.of_micro(-1) == held.at(COUNTS_PER_TURN - 1)
    assert held.sin_of_fraction(Fraction(30_000_999, 1)) == SCALE // 2
    assert held.sin_of_fraction(Fraction(90_000_001, 3)) == SCALE // 2


def test_the_angle_of_a_vector_is_the_nearest_count_ties_to_the_lower():
    held = directions()
    assert held.count_of(1, 0) == 0
    assert held.count_of(0, 5) == 90_000
    assert held.count_of(-3, 0) == 180_000
    assert held.count_of(0, -1) == 270_000
    assert held.count_of(1, 1) == 45_000
    assert held.count_of(-7, -7) == 225_000
    for count in (1, 12_345, 89_999, 90_001, 200_000, 359_999):
        c, s = held.at(count)
        assert held.count_of(c, s) == count
    # The sum of two neighbouring directions lies midway between them: the lower count wins.
    (ac, a_s), (bc, bs) = held.at(1_000), held.at(1_001)
    assert held.count_of(ac + bc, a_s + bs) == 1_000
    (ac, a_s), (bc, bs) = held.at(359_999), held.at(0)
    assert held.count_of(ac + bc, a_s + bs) == 0
    with pytest.raises(ValueError, match="zero vector"):
        held.count_of(0, 0)


def test_the_left_normal_is_the_direction_turned_a_quarter_turn():
    held = directions()
    assert left_normal(held.at(0)) == held.at(90_000)
    assert left_normal(held.at(30_000)) == held.at(120_000)


def test_the_hexagonal_lattice_keeps_two_stands_more_than_two_and_a_half_metres_apart():
    # 5.4.18 (8): x = 3,000 i + 1,500 k, z = 2,599 k.
    assert lattice_point(0, 0) == (0, 0)
    assert lattice_point(2, 3) == (10_500, 7_797)
    origin = lattice_point(0, 0)
    neighbours = [
        lattice_point(i, k) for i, k in ((1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1))
    ]
    distances = [isqrt((x - origin[0]) ** 2 + (z - origin[1]) ** 2) for x, z in neighbours]
    assert min(distances) == LATTICE_PITCH
    assert sorted(set(distances)) == [3_000]
    # Two jittered stands are at least 2,504 mm apart before rounding.
    assert min(distances) - 2 * JITTER_RADIUS == 2_504 > MIN_STAND_SPACING


def test_lattice_points_within_a_radius_come_in_row_then_column_order():
    # A neighbour in the next row is 3,000.8 mm away, so 3,001 mm holds all six.
    assert len(lattice_within(0, 0, 1, 3_000)) == 3
    found = lattice_within(0, 0, 1, 3_001)
    assert [(k, i) for k, i, _, _ in found] == [
        (-1, 0),
        (-1, 1),
        (0, -1),
        (0, 0),
        (0, 1),
        (1, -1),
        (1, 0),
    ]
    assert all((x, z) == lattice_point(i, k) for k, i, x, z in found)
    # The centre may be a rational point: (1,500, 0) over 2 is (750, 0).
    near = lattice_within(1_500, 0, 2, 800)
    assert [(x, z) for _, _, x, z in near] == [(0, 0)]


def test_a_point_on_a_cell_edge_belongs_to_the_lower_row_then_the_lower_column():
    assert grid_cell(1, 1) == (0, 0)
    assert grid_cell(5_000, 5_000) == (0, 0)
    assert grid_cell(5_001, 5_000) == (0, 1)
    assert grid_cell(5_000, 5_001) == (1, 0)
    assert grid_cell(0, 0) == (-1, -1)
    assert grid_cell(-1, -4_999) == (-1, -1)
    assert grid_cell(-5_000, -5_000) == (-2, -2)
    # A rational point: (10,001, 3) over 2 is (5,000.5, 1.5).
    assert grid_cell(10_001, 3, 2) == (0, 1)
    assert cell_centre(0, 1) == (7_500, 2_500)
    assert cell_square(-1, 0) == ((0, -5_000), (5_000, -5_000), (5_000, 0), (0, 0))
