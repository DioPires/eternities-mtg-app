"""Slots, clusters, candidates and capacity (PRD v4 5.4.9), on the hand-made straight site."""

from __future__ import annotations

from eternities.layout import capacity
from eternities.layout.constants import (
    CAP_MAX,
    CAP_MIN,
    CLUSTER_ACROSS,
    CLUSTER_ALONG,
    CLUSTER_OFFSET,
    CLUSTER_RADIUS,
    CORRIDOR_ARC_WINDOW,
    JITTER_RADIUS,
    SLOT_SPACING,
)
from eternities.layout.exact import SCALE, Prng
from eternities.layout.geometry import polygon

from layout_kit import directions, straight_site

SITE = (500_000, 300_000)
"""A site centre on the 10 m lattice; the hexagonal lattice is global, so the tests fix one."""

WAIST = [
    (-1_500, -12_000),
    (62_000, -12_000),
    (62_000, 12_000),
    (34_000, 12_000),
    (34_000, 4_000),
    (20_000, 4_000),
    (20_000, 12_000),
    (-1_500, 12_000),
]
"""The wide blob with its left side cut back to 4 m from the path between 20 m and 34 m: no
cluster disc on the left fits there. The right side is whole."""

NARROW = [(-1_500, -4_000), (62_000, -4_000), (62_000, 4_000), (-1_500, 4_000)]
"""A blob 4 m to either side of the path: no cluster disc fits anywhere."""


def draws(state: int, count: int) -> list[tuple[int, int, int]]:
    """The three draws of each of the first ``count`` slots: along, across, cap."""
    prng = Prng(0)
    prng.state = state
    return [
        (
            prng.randint(-CLUSTER_ALONG, CLUSTER_ALONG),
            prng.randint(-CLUSTER_ACROSS, CLUSTER_ACROSS),
            prng.randint(CAP_MIN, CAP_MAX),
        )
        for _ in range(count)
    ]


def state_with_first_cap(cap: int) -> int:
    return next(state for state in range(1, 500) if draws(state, 1)[0][2] == cap)


def test_slots_lie_every_nine_metres_and_alternate_from_the_left():
    built = straight_site()
    found = capacity.capacity_of(built, SITE, 30, directions())
    assert found.cut is None
    assert [slot.number for slot in found.slots] == [1, 2, 3, 4, 5, 6]
    assert [slot.arc for slot in found.slots] == [n * SLOT_SPACING for n in range(1, 7)]
    assert found.end == len(built.path) - 1
    drawn = draws(built.state, 6)
    for slot, (along, across, cap) in zip(found.slots, drawn, strict=True):
        side = 1 if slot.number % 2 == 1 else -1
        # The path runs along +x: "along" moves the centre in x and "across" to the left, in z.
        assert slot.centre[0] == (slot.arc + along) * slot.den
        assert slot.centre[1] == (side * CLUSTER_OFFSET + across) * slot.den
        assert slot.cap == cap
        assert not slot.on_turn
    # Three draws a slot, in slot order: placement continues from the state after them.
    prng = Prng(0)
    prng.state = built.state
    for _ in range(18):
        prng.bits()
    assert found.state == prng.state
    assert found.census == (6, 0, 0, 0, 0, 0)


def test_a_candidate_is_a_lattice_point_of_the_cluster_that_passes_the_tests():
    built = straight_site()
    found = capacity.capacity_of(built, SITE, 30, directions())
    for slot in found.slots:
        assert len(slot.candidates) >= 3
        keys: list[tuple[int, int, int, int]] = []
        for candidate in slot.candidates:
            # On the global lattice: z = 2,599 k and x = 3,000 i + 1,500 k in the world frame.
            wx, wz = candidate.x + SITE[0], candidate.z + SITE[1]
            assert wz == 2_599 * candidate.row
            assert wx == 3_000 * candidate.column + 1_500 * candidate.row
            # At most rho - j from the cluster's centre.
            dx = candidate.x * slot.den - slot.centre[0]
            dz = candidate.z * slot.den - slot.centre[1]
            assert dx * dx + dz * dz <= ((CLUSTER_RADIUS - JITTER_RADIUS) * slot.den) ** 2
            # Clear of the path's strip with its apron, and its path vertex inside the window.
            assert abs(candidate.z) > 3_000
            assert abs(built.arcs[candidate.vertex] - slot.arc) <= CORRIDOR_ARC_WINDOW
            vx, vz = built.path[candidate.vertex]
            distance = (vx - candidate.x) ** 2 + (vz - candidate.z) ** 2
            keys.append((candidate.vertex, distance, candidate.row, candidate.column))
        # The fixed order: by path vertex, then distance to it, then lattice row and column.
        assert keys == sorted(keys)


def test_a_clusters_capacity_is_the_lesser_of_its_cap_and_its_candidates():
    low = straight_site(state=state_with_first_cap(CAP_MIN))
    slot = capacity.capacity_of(low, SITE, 30, directions()).slots[0]
    assert slot.cap == 3 < len(slot.candidates)
    assert slot.capacity == 3
    high = straight_site(state=state_with_first_cap(CAP_MAX))
    slot = capacity.capacity_of(high, SITE, 30, directions()).slots[0]
    assert slot.cap == 8 > len(slot.candidates)
    assert slot.capacity == len(slot.candidates)
    found = capacity.capacity_of(high, SITE, 30, directions())
    assert found.total == sum(min(slot.cap, len(slot.candidates)) for slot in found.slots)


def test_a_cluster_whose_disc_leaves_the_blob_is_void_and_the_alternation_continues():
    built = straight_site(WAIST)
    found = capacity.capacity_of(built, SITE, 30, directions())
    # Slot 3 at 27 m stands on the left, where the blob is cut back. Slots 2 and 4 stand on the
    # right and are kept, so no two void slots come in a row.
    assert [slot.number for slot in found.slots] == [1, 2, 4, 5, 6]
    assert (found.void, found.cut) == (1, None)
    assert found.census == (5, 1, 0, 0, 0, 0)
    # The void slot took its three draws: slot 4 reads the fourth triple of the stream.
    assert found.slots[2].cap == draws(built.state, 4)[3][2]
    assert found.slots[2].centre[1] < 0 < found.slots[3].centre[1]


def test_two_void_slots_in_a_row_cut_the_path_at_the_second():
    built = straight_site(NARROW)
    found = capacity.capacity_of(built, SITE, 30, directions())
    assert found.slots == ()
    assert (found.void, found.cut, found.total) == (2, 2 * SLOT_SPACING, 0)
    # The path ends at the first vertex at or past the cut, and every later slot is dropped:
    # only the two void slots drew.
    assert built.arcs[found.end] == 2 * SLOT_SPACING
    prng = Prng(0)
    prng.state = built.state
    for _ in range(6):
        prng.bits()
    assert found.state == prng.state
    assert capacity.path_end(built.arcs, 18_250) == 37
    assert capacity.path_end(built.arcs, 10**9) == len(built.path) - 1


def test_a_slot_with_fewer_than_three_candidates_is_void_except_on_a_small_site():
    built = straight_site()
    free = capacity.capacity_of(built, SITE, 30, directions())
    first = free.slots[0]
    # A reservation over all of slot 1's candidates but two.
    keep = first.candidates[:2]
    blocks = [
        polygon(
            [
                (c.x * SCALE - 100 * SCALE, c.z * SCALE - 100 * SCALE),
                (c.x * SCALE + 100 * SCALE, c.z * SCALE - 100 * SCALE),
                (c.x * SCALE + 100 * SCALE, c.z * SCALE + 100 * SCALE),
                (c.x * SCALE - 100 * SCALE, c.z * SCALE + 100 * SCALE),
            ],
            SCALE,
        )
        for c in first.candidates[2:]
    ]
    crowded = capacity.capacity_of(built, SITE, 30, directions(), footprint_foreign=blocks)
    assert crowded.slots[0].number == 2
    assert crowded.census[2] == 1
    # On a site of two stands the first slot with two candidates is kept (5.4.9).
    small = capacity.capacity_of(built, SITE, 2, directions(), footprint_foreign=blocks)
    assert small.slots[0].number == 1
    assert small.slots[0].candidates == keep
    assert small.slots[0].capacity == 2
    # A corridor's reservation rejects a candidate the same way.
    walled = capacity.capacity_of(built, SITE, 30, directions(), corridor_foreign=blocks)
    assert len(walled.slots[0].candidates) <= len(first.candidates)


# --- DEC-1091 kill case (O6) ------------------------------------------------------------------


def test_the_window_holds_a_vertex_exactly_six_metres_past_the_slot():
    # 5.4.9 (b): the window holds every vertex whose arc length lies within 6 m of the slot's,
    # 6 m included. Slot 1 lies at 9,000 mm; the vertex at (12 m, 3 m) lies at 15,000 mm and is
    # the nearest vertex of the window for the lattice point 3.6 m north of it.
    from eternities.layout.geometry import SegmentIndex, disc, polygon, strip
    from eternities.layout.local import Local, arc_lengths, bounding_radius

    path = ((0, 0), (9_000, 0), (12_000, 0), (12_000, 3_000), (20_000, 3_000))
    held = directions()
    pad, approach = (-1_500, 0), (-11_500, 0)
    stone = (-4_000 * SCALE, 3_000 * SCALE)
    site = Local(
        radius=40_000,
        bounding=bounding_radius(40_000),
        blob=polygon([(-20_000, -20_000), (40_000, -20_000), (40_000, 30_000), (-20_000, 30_000)]),
        path=path,
        arcs=arc_lengths(path),
        turn=(0, 0, 0, 0),
        first_run=len(path),
        head_count=180_000,
        pad=pad,
        approach_point=approach,
        stone=stone,
        stone_side=1,
        sweep_count=0,
        tries=1,
        failures=(),
        sweeps=1,
        state=1,
        index=SegmentIndex(path),
        path_strip=strip(path, 1_500),
        pad_disc=disc(held.disc, pad[0], pad[1], 1, 1_500),
        approach_strip=strip([pad, approach], 1_500),
        stone_disc=disc(held.disc, stone[0], stone[1], SCALE, 500),
    )
    assert site.arcs == (0, 9_000, 12_000, 15_000, 23_000)
    # The global lattice point (10,500, 7,797) is (12,000, 6,600) in the site's frame.
    found = capacity.capacity_of(site, (-1_500, 1_197), 3, held)
    (slot,) = [slot for slot in found.slots if slot.number == 1]
    (point,) = [c for c in slot.candidates if (c.x, c.z) == (12_000, 6_600)]
    assert point.vertex == 3
