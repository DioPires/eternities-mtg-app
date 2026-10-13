"""Placement under the CEO's ruling 2 of 2026-10-13 on DEC-1004 (PRD v4 5.4.10, V and W).

V: a candidate faces the first vertex of its slot's 6 m window at which it fits. W: a cluster
that would close under three stands is withdrawn and its slot is void. The letter of 5.4.10 laid
out no era site of Dominaria; `a6049f0` on this branch holds the measurement.

Every test runs on a hand-made site with a straight path along +x (``layout_kit``), so a stand
that stands behind another has its direct corridor blocked and the figures can be read off.
"""

from __future__ import annotations

from dataclasses import replace

from eternities.layout.capacity import Candidate
from eternities.layout.constants import (
    CLUSTER_OFFSET,
    CORRIDOR_ARC_WINDOW,
    MICRO_PER_TURN,
    JITTER_RADIUS,
    SLOT_SPACING,
)
from eternities.layout.exact import SCALE, Prng
from eternities.layout.geometry import disc
from eternities.layout.placement import CAUSES, place_site

from layout_kit import SLOT_Z, capacity_with, directions, row, slot_at, straight_site

BEHIND = (SLOT_SPACING, 8_300)
"""A point 3.1 m behind the slot row's middle point: its direct corridor crosses that point."""

NOTCHED = [
    (-1_500, -12_000),
    (62_000, -12_000),
    (62_000, 2_500),
    (10_500, 2_500),
    (10_500, 7_000),
    (62_000, 7_000),
    (62_000, 12_000),
    (-1_500, 12_000),
    (-1_500, 7_000),
    (7_500, 7_000),
    (7_500, 2_500),
    (-1_500, 2_500),
]
"""The wide blob with a notch cut in from either side, 2.5 m to 7 m from the path. The ground
that is left between the notches is a column 3 m wide above the slot at 9 m."""


def test_a_candidate_that_fails_at_its_nearest_vertex_faces_a_later_vertex_of_the_window():
    built = straight_site()
    front = (SLOT_SPACING, SLOT_Z)
    alone = place_site(built, capacity_with(built, [slot_at(1, [BEHIND], 3)]), [1], directions())
    (free,) = alone.stands
    # Alone, the candidate faces its nearest vertex, straight below it.
    assert (free.rank, free.vertex, free.nearest) == (0, 18, 18)

    slot = slot_at(1, [front, BEHIND], 3)
    placed = place_site(built, capacity_with(built, [slot]), [2], directions())
    first, second = placed.stands
    assert (first.rank, first.vertex) == (0, 18)
    # Behind the first stand, its corridor to vertex 18 crosses that stand's footprint. It is
    # accepted at a later vertex of the window, and no candidate is counted as rejected.
    assert second.rank > 0
    assert second.nearest == 18 and second.vertex != 18
    assert abs(built.arcs[second.vertex] - slot.arc) <= CORRIDOR_ARC_WINDOW
    assert sum(placed.rejected) == 0
    # The yaw, the corridor and the vertex index read the vertex that fits.
    vx, vz = built.path[second.vertex]
    assert second.yaw == directions().count_of(vx * SCALE - second.x, vz * SCALE - second.z)
    assert second.corridor.pts[-1] == (vx * SCALE, vz * SCALE)
    assert second.yaw != directions().count_of(
        built.path[18][0] * SCALE - second.x, built.path[18][1] * SCALE - second.z
    )


def test_a_later_vertex_is_refused_when_the_corridor_to_it_leaves_the_blob():
    # The same two candidates. Now every corridor from the second to a vertex that clears the
    # first stand crosses a notch of the blob, so the candidate fits at no vertex.
    built = straight_site(NOTCHED)
    slot = slot_at(1, [(SLOT_SPACING, SLOT_Z), BEHIND], 3)
    placed = place_site(built, capacity_with(built, [slot]), [2], directions())
    (only,) = placed.stands
    assert (only.z // SCALE) < 6_000
    # It is counted once, under the cause of its first try: the nearest vertex.
    assert placed.rejected[CAUSES.index("the corridor meets another stand's footprint or apron")]
    assert sum(placed.rejected) == 1
    # In the wide blob the same candidate was accepted: the blob is what refuses the later tries.
    wide = straight_site()
    assert len(place_site(wide, capacity_with(wide, [slot]), [2], directions()).stands) == 2


THREE = (-3_000, 0, 3_000)
FOUR = (-3_750, -1_250, 1_250, 3_750)


def test_a_cluster_under_three_is_withdrawn_with_its_chapter_stone():
    built = straight_site()
    # Two chapters of three cards. Slot 1 holds the first chapter. Slot 2 has three units: the
    # second chapter's stone and two stands, so it would close under three.
    slots = [
        slot_at(1, row(1, THREE), 3),
        slot_at(2, row(2, THREE), 3),
        slot_at(3, row(3, FOUR), 8),
    ]
    placed = place_site(built, capacity_with(built, slots), [3, 3], directions())
    assert placed.exhausted is None
    assert placed.withdrawn == (2,)
    # Its stands and its stone are gone: the stone and the cards stand in the next kept cluster.
    assert [stand.slot for stand in placed.stands] == [0, 0, 0, 2, 2, 2]
    (stone,) = placed.stones
    assert (stone.slot, stone.chapter) == (2, 1)
    assert (stone.x, stone.z) == (3 * SLOT_SPACING + FOUR[0], SLOT_Z)
    # The draws that the withdrawn cluster took stay taken: ten candidates drew, and the first
    # stand of slot 3 reads the eighth pair of the stream (3 + 3 for the two slots before it, one
    # for the stone).
    assert placed.considered == 10
    stream = Prng(0)
    stream.state = built.state
    for _ in range(7):
        stream.randint(0, MICRO_PER_TURN - 1)
        stream.randint(0, JITTER_RADIUS)
    cosine, sine = directions().of_micro(stream.randint(0, MICRO_PER_TURN - 1))
    radius = stream.randint(0, JITTER_RADIUS)
    fourth = placed.stands[3]
    lattice = (3 * SLOT_SPACING + FOUR[1], SLOT_Z)
    assert fourth.x == lattice[0] * SCALE + radius * cosine
    assert fourth.z == lattice[1] * SCALE + radius * sine
    # The path is trimmed past the last occupied slot, and the withdrawn slot leaves no stand.
    assert built.arcs[placed.end] == 3 * SLOT_SPACING + 4_500
    assert all(abs(stand.z // SCALE - CLUSTER_OFFSET) < 1_500 for stand in placed.stands)


def test_a_withdrawn_slot_beside_a_slot_void_at_capacity_cuts_the_path():
    built = straight_site()
    # Slot 2 is void at capacity (it is not among the kept slots). Slot 1 would close with two
    # stands of seven and is withdrawn: two void slots in a row cut the path at slot 2.
    slots = [slot_at(1, row(1, (-1_500, 1_500)), 8), slot_at(3, row(3, FOUR), 8)]
    placed = place_site(built, capacity_with(built, slots), [7], directions())
    assert placed.withdrawn == (1,)
    assert placed.exhausted == 2
    assert placed.stands == ()

    # The other order: slot 1 is kept, slot 2 is void at capacity, slot 3 is withdrawn.
    slots = [slot_at(1, row(1, THREE), 8), slot_at(3, row(3, (-1_500, 1_500)), 8)]
    placed = place_site(built, capacity_with(built, slots), [7], directions())
    assert placed.withdrawn == (3,)
    assert placed.exhausted == 3
    assert len(placed.stands) == 3


def test_a_withdrawn_slot_between_two_kept_slots_cuts_nothing():
    built = straight_site()
    slots = [
        slot_at(1, row(1, THREE), 8),
        slot_at(2, row(2, (-1_500, 1_500)), 8),
        slot_at(3, row(3, FOUR), 8),
    ]
    placed = place_site(built, capacity_with(built, slots), [7], directions())
    assert placed.exhausted is None
    assert placed.withdrawn == (2,)
    assert [stand.slot for stand in placed.stands] == [0, 0, 0, 2, 2, 2, 2]


def test_the_last_cluster_of_a_site_is_kept_under_three():
    built = straight_site()
    slots = [slot_at(1, row(1, THREE), 3), slot_at(2, row(2, THREE), 8)]
    placed = place_site(built, capacity_with(built, slots), [5], directions())
    assert placed.exhausted is None
    assert placed.withdrawn == ()
    # The site's stand count is reached in slot 2 with two stands.
    assert [stand.slot for stand in placed.stands] == [0, 0, 0, 1, 1]


def test_a_site_of_fewer_than_three_stands_keeps_its_cluster():
    built = straight_site()
    one = place_site(built, capacity_with(built, [slot_at(1, row(1, (0,)), 3)]), [1], directions())
    assert (len(one.stands), one.exhausted, one.withdrawn) == (1, None, ())
    # Two cards and one candidate a slot: each cluster holds one stand, and both are kept.
    slots = [slot_at(1, row(1, (0,)), 3), slot_at(2, row(2, (0,)), 3)]
    two = place_site(built, capacity_with(built, slots), [2], directions())
    assert ([stand.slot for stand in two.stands], two.exhausted, two.withdrawn) == (
        [0, 1],
        None,
        (),
    )


def test_the_kept_slots_run_out_while_cards_remain():
    built = straight_site()
    placed = place_site(
        built, capacity_with(built, [slot_at(1, row(1, THREE), 8)]), [9], directions()
    )
    assert placed.exhausted == 0
    assert len(placed.stands) == 3


def test_a_lattice_point_holds_one_stand():
    built = straight_site()
    # Two slots whose discs overlap, as the discs of two neighbouring sweeps do. Both list the
    # lattice point between them. The first cluster takes it; the second may not.
    shared = Candidate(row=40, column=7, x=13_500, z=6_000, vertex=27)
    first = replace(slot_at(1, [], 8), centre=(10_500, CLUSTER_OFFSET), candidates=(shared,))
    second = replace(
        slot_at(2, [], 8),
        centre=(16_500, CLUSTER_OFFSET),
        candidates=(shared, *slot_at(2, row(2, (1_500,)), 8).candidates),
    )
    discs = [
        disc(directions().disc, slot.centre[0], slot.centre[1], 1, 4_500)
        for slot in (first, second)
    ]
    slots = [replace(first, disc=discs[0]), replace(second, disc=discs[1])]
    placed = place_site(built, capacity_with(built, slots), [2], directions())
    assert [(stand.slot, stand.row, stand.column) for stand in placed.stands] == [
        (0, 40, 7),
        (1, 2, 0),
    ]
    # The second cluster's copy of the point took its draws and is counted under its own cause.
    assert placed.considered == 3
    cause = CAUSES.index("the lattice point holds another stand or a chapter stone")
    assert placed.rejected[cause] == 1
    assert sum(placed.rejected) == 1


def test_a_withdrawn_cluster_gives_its_lattice_points_back():
    built = straight_site()
    shared = Candidate(row=40, column=7, x=13_500, z=6_000, vertex=27)
    # Slot 1 holds the shared point and one more, so it closes with two stands of five and is
    # withdrawn. Slot 2 may then take the shared point.
    first = replace(
        slot_at(1, [], 8),
        centre=(10_500, CLUSTER_OFFSET),
        candidates=(*slot_at(1, row(1, (0,)), 8).candidates, shared),
    )
    second = replace(
        slot_at(2, [], 8),
        centre=(16_500, CLUSTER_OFFSET),
        candidates=(shared, *slot_at(2, row(2, (-500, 2_000)), 8).candidates),
    )
    discs = [
        disc(directions().disc, slot.centre[0], slot.centre[1], 1, 4_500)
        for slot in (first, second)
    ]
    slots = [replace(first, disc=discs[0]), replace(second, disc=discs[1])]
    placed = place_site(built, capacity_with(built, slots), [3], directions())
    assert placed.withdrawn == (1,)
    assert [(stand.slot, stand.row, stand.column) for stand in placed.stands] == [
        (1, 40, 7),
        (1, 2, 0),
        (1, 2, 1),
    ]
    assert sum(placed.rejected) == 0
