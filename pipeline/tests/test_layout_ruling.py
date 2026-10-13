"""The CEO ruling of 2026-10-13 on DEC-1004: the two rules that lay Dominaria out.

Rule 1 (5.4.1, 5.4.8): a chord end that a half-turn joins is shortened by 15 m, so the half-turn
lies inside the blob. Rule 2 (5.4.9): a candidate's path vertex is the nearest vertex within 6 m
of its slot along the path. The letter of 5.4.8 and 5.4.9 left 6 of 16 sites short after twenty
widenings; `f8aee5e` on this branch holds the measurement.
"""

from __future__ import annotations

from eternities.layout import capacity, local
from eternities.layout.constants import CORRIDOR_ARC_WINDOW, site_seed
from eternities.layout.geometry import polygon

from layout_kit import directions

EAST = 0
"""Sweep direction +x, in counts: a position along a sweep line is then its x in millimetres."""


def test_a_joined_chord_end_is_shortened_by_15_m():
    # A 60 m square: two sweeps, 21 m apart, each with a 60 m chord from x = -30 m to 30 m.
    square = polygon([(-30_000, -30_000), (30_000, -30_000), (30_000, 30_000), (-30_000, 30_000)])
    sweeps = local._chords(square, directions().at(EAST))
    assert sweeps is not None
    first, second = sweeps
    assert (first.offset, second.offset) == (-10_500, 10_500)
    # Sweep 0 runs along +x: its head end keeps 1.5 m, and its far end meets a half-turn.
    assert first.head == -30_000 + 1_500
    assert first.far == 30_000 - 15_000
    # Sweep 1 runs back: a half-turn joins its head end, and its far end is the path's last.
    assert second.head == 30_000 - 15_000
    assert second.far == -30_000 + 4_500


def test_a_site_of_one_sweep_is_unchanged():
    strip_blob = polygon(
        [(-30_000, -10_000), (30_000, -10_000), (30_000, 10_000), (-30_000, 10_000)]
    )
    sweeps = local._chords(strip_blob, directions().at(EAST))
    assert sweeps is not None
    (only,) = sweeps
    assert (only.head, only.far) == (-30_000 + 1_500, 30_000 - 4_500)


def test_a_sweep_that_a_drop_leaves_last_keeps_its_15_m_far_end():
    # 63 m across the sweeps, so three sweep lines at z = 10.5 m, 31.5 m and 52.5 m. The third
    # line's chord is 20 m: after 15 m at its head and 4.5 m at its far end it is 0.5 m, under
    # the slot spacing, and it is dropped.
    blob = polygon(
        [
            (-40_000, 0),
            (40_000, 0),
            (40_000, 42_000),
            (-20_000, 42_000),
            (-20_000, 63_000),
            (-40_000, 63_000),
            (-40_000, 42_000),
        ]
    )
    sweeps = local._chords(blob, directions().at(EAST))
    assert sweeps is not None
    assert [sweep.offset for sweep in sweeps] == [10_500, 31_500]
    last = sweeps[-1]
    # Sweep 1 runs against +x and was sweep 1 of 3: its far end was joined, so it keeps 15 m,
    # not the 4.5 m of a path's last far end.
    assert last.head == 40_000 - 15_000
    assert last.far == -40_000 + 15_000


RABIAH = (500_000, 300_000)
"""A site centre on the 10 m lattice; the hexagonal lattice is global, so the test fixes one."""


def _rabiah() -> tuple[local.Local, capacity.Capacity]:
    built = local.build(local.base_radius(75), site_seed("rabiah", "set:arn"), directions())
    assert built is not None
    return built, capacity.capacity_of(built, RABIAH, 75, directions())


def test_a_slot_on_a_half_turn_is_kept():
    built, found = _rabiah()
    assert built.sweeps == 3
    on_turns = [slot for slot in found.slots if slot.on_turn]
    assert len(on_turns) == 8
    assert found.cut is None
    # Each of them holds a cluster of three stands or more on the turn's inner side.
    assert all(slot.capacity >= 3 for slot in on_turns)
    for slot in on_turns:
        segment = next(i for i, arc in enumerate(built.arcs) if arc >= slot.arc) - 1
        assert built.turn[segment] != 0


def test_a_path_vertex_lies_inside_the_window_when_the_nearest_vertex_does_not():
    built, found = _rabiah()
    slot = next(slot for slot in found.slots if slot.number == 4)
    assert slot.on_turn and slot.arc == 36_000
    candidate = next(c for c in slot.candidates if (c.row, c.column) == (121, 108))

    def squared(index: int) -> int:
        x, z = built.path[index]
        return (x - candidate.x) ** 2 + (z - candidate.z) ** 2

    nearest = min(range(len(built.path)), key=lambda index: (squared(index), index))
    # In the plane the nearest vertex is the next one round the turn, 8.7 m ahead of the slot.
    assert nearest == 64
    assert abs(built.arcs[nearest] - slot.arc) > CORRIDOR_ARC_WINDOW
    # The path vertex is the nearest of those within 6 m of the slot along the path.
    assert candidate.vertex == 63
    assert abs(built.arcs[candidate.vertex] - slot.arc) <= CORRIDOR_ARC_WINDOW
    window = [
        index for index, arc in enumerate(built.arcs) if abs(arc - slot.arc) <= CORRIDOR_ARC_WINDOW
    ]
    assert candidate.vertex == min(window, key=lambda index: (squared(index), index))


def test_every_candidate_meets_test_e_by_definition():
    built, found = _rabiah()
    for slot in found.slots:
        for candidate in slot.candidates:
            assert abs(built.arcs[candidate.vertex] - slot.arc) <= CORRIDOR_ARC_WINDOW
