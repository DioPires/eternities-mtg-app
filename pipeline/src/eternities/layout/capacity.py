"""Slots, clusters, candidates and capacity of one site (PRD v4 5.4.9).

The work is done in the site's frame. The hexagonal lattice is global (5.4.18 (8)), so the site's
centre is an input: a lattice point's local position is its world position less the centre.

**What the code defines where 5.4.9 leaves a choice** (5.4.18 (12)):

- A slot lies on the first segment whose cumulative length reaches its arc length; the slot is on
  a half-turn when that segment is. The path's direction at a slot is that segment's table
  direction, and "across" is its left normal: a positive draw moves the centre to the left.
- A candidate's **path vertex** is the nearest vertex of the path among those whose arc length
  lies within 6 m of the slot's arc length, ties by the lower index (CEO ruling of 2026-10-13 on
  DEC-1004, rule 2). Test (e) of 5.4.9 holds by that definition and rejects no point.
- A lattice point that lies on its path vertex has no direction to face and is no candidate.
- A candidate's tests read the whole path as built. When two void slots cut the path, the path
  ends at the first vertex at or past the cut's arc length, the rule of the trim (5.4.10).
- The plaza approach is reserved at step (6) of 5.4.12, after this step, so test (b) cannot read
  it here; placement tests it (5.4.10).
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from dataclasses import dataclass

from .constants import (
    APRON_DEPTH,
    APRON_WIDTH,
    CAP_MAX,
    CAP_MIN,
    CLUSTER_ACROSS,
    CLUSTER_ALONG,
    CLUSTER_OFFSET,
    CLUSTER_RADIUS,
    CORRIDOR_ARC_WINDOW,
    CORRIDOR_HALF_WIDTH,
    FOOTPRINT_DEPTH,
    FOOTPRINT_WIDTH,
    JITTER_RADIUS,
    MARGIN,
    MIN_CLUSTER,
    PATH_HALF_WIDTH,
    SLOT_SPACING,
)
from .exact import SCALE, Directions, Prng, Pt, lattice_within
from .geometry import Shape, clear, disc, inside, rectangle, strip
from .local import Local

FOOT_BACK = FOOTPRINT_DEPTH // 2
FOOT_HALF = FOOTPRINT_WIDTH // 2
APRON_FRONT = FOOT_BACK + APRON_DEPTH
APRON_HALF = APRON_WIDTH // 2


@dataclass(frozen=True, slots=True)
class Candidate:
    row: int
    column: int
    x: int
    """Local position of the lattice point, whole millimetres."""
    z: int
    vertex: int
    """Index of the candidate's path vertex."""


@dataclass(frozen=True, slots=True)
class Slot:
    number: int
    """1 for the slot at arc length s, 2 for the one at 2 s, and so on."""
    arc: int
    centre: Pt
    """The cluster centre, numerators over ``den``, in the site's frame."""
    den: int
    cap: int
    on_turn: bool
    """The slot lies on a half-turn and its cluster stands on the turn's inner side."""
    candidates: tuple[Candidate, ...]
    disc: Shape

    @property
    def capacity(self) -> int:
        return min(self.cap, len(self.candidates))


@dataclass(frozen=True, slots=True)
class Capacity:
    slots: tuple[Slot, ...]
    """The kept slots, in slot order."""
    total: int
    """The sum of the kept clusters' capacities, before any chapter stone takes a unit."""
    void: int
    cut: int | None
    """The arc length at which two void slots cut the path, or None."""
    end: int
    """Index of the path's last vertex after the cut."""
    state: int
    """The site PRNG's state after the slots' draws; placement continues from it."""
    census: tuple[int, int, int, int, int, int] = (0, 0, 0, 0, 0, 0)
    """Slots on runs, then on half-turns: kept, void for the disc, void for under 3 candidates."""


def path_end(arcs: Sequence[int], arc: int) -> int:
    """The first vertex at or past ``arc``; the last vertex when the arc exceeds the path."""
    return min(bisect_left(arcs, arc), len(arcs) - 1)


def capacity_of(
    local: Local,
    centre: Pt,
    stands: int,
    directions: Directions,
    footprint_foreign: Sequence[Shape] = (),
    corridor_foreign: Sequence[Shape] = (),
) -> Capacity:
    """5.4.9 for a site whose centre is ``centre``. The foreign shapes are in the site's frame."""
    prng = Prng(0)
    prng.state = local.state
    path, arcs, blob = local.path, local.arcs, local.blob
    kept: list[Slot] = []
    census = [0, 0, 0, 0, 0, 0]
    void = 0
    run_of_void = 0
    cut: int | None = None
    number = 0
    while cut is None:
        number += 1
        arc = number * SLOT_SPACING
        if arc > arcs[-1]:
            break
        upper = bisect_left(arcs, arc)
        segment = upper - 1
        (ax, az), (bx, bz) = path[segment], path[upper]
        length = arcs[upper] - arcs[segment]
        along_segment = arc - arcs[segment]
        c, s = directions.at(directions.count_of(bx - ax, bz - az))
        on_turn = local.turn[segment]
        alternate = 1 if number % 2 == 1 else -1
        side = on_turn if on_turn != 0 else alternate
        along = prng.randint(-CLUSTER_ALONG, CLUSTER_ALONG)
        across = prng.randint(-CLUSTER_ACROSS, CLUSTER_ACROSS)
        cap = prng.randint(CAP_MIN, CAP_MAX)
        offset = side * CLUSTER_OFFSET + across
        den = length * SCALE
        cx = (ax * length + along_segment * (bx - ax)) * SCALE + length * (along * c - offset * s)
        cz = (az * length + along_segment * (bz - az)) * SCALE + length * (along * s + offset * c)
        cluster = disc(directions.disc, cx, cz, den, CLUSTER_RADIUS)
        candidates: list[Candidate] = []
        disc_inside = inside(cluster, blob, MARGIN)
        if disc_inside:
            candidates = _candidates(
                local,
                (cx, cz),
                den,
                centre,
                arc,
                directions,
                footprint_foreign,
                corridor_foreign,
            )
        small = stands < MIN_CLUSTER and not kept and len(candidates) >= stands
        is_kept = len(candidates) >= MIN_CLUSTER or (small and bool(candidates))
        census[(3 if on_turn else 0) + (0 if is_kept else 2 if disc_inside else 1)] += 1
        if is_kept:
            kept.append(
                Slot(number, arc, (cx, cz), den, cap, on_turn != 0, tuple(candidates), cluster)
            )
            run_of_void = 0
        else:
            void += 1
            run_of_void += 1
            if run_of_void == 2:
                cut = arc
    end = len(path) - 1 if cut is None else path_end(arcs, cut)
    return Capacity(
        slots=tuple(kept),
        total=sum(slot.capacity for slot in kept),
        void=void,
        cut=cut,
        end=end,
        state=prng.state,
        census=(census[0], census[1], census[2], census[3], census[4], census[5]),
    )


def _candidates(
    local: Local,
    centre: Pt,
    den: int,
    site: Pt,
    arc: int,
    directions: Directions,
    footprint_foreign: Sequence[Shape],
    corridor_foreign: Sequence[Shape],
) -> list[Candidate]:
    """The lattice points of one cluster that pass tests (a) to (d), in the fixed order."""
    path, arcs, blob = local.path, local.arcs, local.blob
    points = lattice_within(
        centre[0] + site[0] * den, centre[1] + site[1] * den, den, CLUSTER_RADIUS - JITTER_RADIUS
    )
    if not points:
        return []
    # The vertices within 6 m of the slot along the path: a point's path vertex is one of them.
    window = range(
        bisect_left(arcs, arc - CORRIDOR_ARC_WINDOW), bisect_right(arcs, arc + CORRIDOR_ARC_WINDOW)
    )
    inflate = JITTER_RADIUS
    path_reach = PATH_HALF_WIDTH + MARGIN + 1
    found: list[tuple[int, int, int, int, Candidate]] = []
    for row, column, wx, wz in points:
        x, z = wx - site[0], wz - site[1]
        best, vertex = -1, -1
        for index in window:
            vx, vz = path[index]
            distance = (vx - x) ** 2 + (vz - z) ** 2
            if best < 0 or distance < best:
                best, vertex = distance, index
        if best <= 0:
            continue
        # (a): the point's disc of radius j lies inside the blob.
        if not inside(disc(directions.disc, x, z, 1, inflate), blob, MARGIN):
            continue
        vx, vz = path[vertex]
        yaw = directions.at(directions.count_of(vx - x, vz - z))
        px, pz = x * SCALE, z * SCALE
        # (b) and (c): the footprint and the apron, inflated by j, outside the reservations.
        footprint = rectangle(
            px, pz, yaw, -FOOT_BACK - inflate, FOOT_BACK + inflate, FOOT_HALF + inflate
        )
        apron = rectangle(
            px, pz, yaw, FOOT_BACK - inflate, APRON_FRONT + inflate, APRON_HALF + inflate
        )
        if not (_off_site(local, footprint, path_reach) and _off_site(local, apron, path_reach)):
            continue
        if not all(
            clear(shape, other, MARGIN)
            for shape in (footprint, apron)
            for other in footprint_foreign
        ):
            continue
        # (d): the corridor, inflated by j, inside the blob and outside the hero volumes and
        # the plaza.
        start = (px + APRON_FRONT * yaw[0], pz + APRON_FRONT * yaw[1])
        corridor = strip([start, (vx * SCALE, vz * SCALE)], CORRIDOR_HALF_WIDTH + inflate, SCALE)
        if not inside(corridor, blob, MARGIN):
            continue
        if not all(clear(corridor, other, MARGIN) for other in corridor_foreign):
            continue
        found.append((vertex, best, row, column, Candidate(row, column, x, z, vertex)))
    found.sort(key=lambda item: item[:4])
    return [item[4] for item in found]


def _off_site(local: Local, shape: Shape, path_reach: int) -> bool:
    """A footprint or an apron lies outside this site's path, pad and approach."""
    near = local.index.near(shape.box, path_reach)
    return (
        clear(local.path_strip, shape, MARGIN, near)
        and clear(local.pad_disc, shape, MARGIN)
        and clear(local.approach_strip, shape, MARGIN)
    )
