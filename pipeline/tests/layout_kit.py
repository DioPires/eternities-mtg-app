"""Shared helpers for the allocator's tests (PRD v4 5.4, 8.8.1)."""

from __future__ import annotations

from collections.abc import Sequence
from functools import cache

from eternities.layout import trig
from eternities.layout.capacity import Candidate, Capacity, Slot
from eternities.layout.constants import (
    APPROACH_LENGTH,
    CLUSTER_OFFSET,
    CLUSTER_RADIUS,
    CORRIDOR_ARC_WINDOW,
    PAD_RADIUS,
    PATH_HALF_WIDTH,
    SAMPLE_STEP,
    SLOT_SPACING,
    STONE_ACROSS,
    STONE_ALONG,
    STONE_RADIUS,
)
from eternities.layout.exact import SCALE, Directions, Pt
from eternities.layout.geometry import SegmentIndex, disc, polygon, strip
from eternities.layout.local import Local, arc_lengths, bounding_radius


@cache
def directions() -> Directions:
    """The committed trig table, read once for the whole test run."""
    return Directions(trig.load())


# A hand-made site for the placement tests: a straight path along +x, so every figure of a test
# can be read off its coordinates.

PATH_LENGTH = 60_000
SLOT_Z = 5_198
"""Two lattice rows from the path: a stand there has its apron clear of the path's strip."""


def straight_site(blob: Sequence[Pt] | None = None, state: int = 7) -> Local:
    """A site whose path runs from (0, 0) to (60 m, 0), sampled every 0.5 m, in a wide blob."""
    path = tuple((x, 0) for x in range(0, PATH_LENGTH + 1, SAMPLE_STEP))
    outline = blob or [(-1_500, -12_000), (62_000, -12_000), (62_000, 12_000), (-1_500, 12_000)]
    pad = (-PAD_RADIUS, 0)
    approach_point = (-PAD_RADIUS - APPROACH_LENGTH, 0)
    stone = (-STONE_ALONG * SCALE, STONE_ACROSS * SCALE)
    return Local(
        radius=40_000,
        bounding=bounding_radius(40_000),
        blob=polygon(outline),
        path=path,
        arcs=arc_lengths(path),
        turn=tuple(0 for _ in path[1:]),
        first_run=len(path),
        head_count=180_000,
        pad=pad,
        approach_point=approach_point,
        stone=stone,
        stone_side=1,
        sweep_count=0,
        tries=1,
        failures=(),
        sweeps=1,
        state=state,
        index=SegmentIndex(path),
        path_strip=strip(path, PATH_HALF_WIDTH),
        pad_disc=disc(directions().disc, pad[0], pad[1], 1, PAD_RADIUS),
        approach_strip=strip([pad, approach_point], PATH_HALF_WIDTH),
        stone_disc=disc(directions().disc, stone[0], stone[1], SCALE, STONE_RADIUS),
    )


def slot_at(number: int, points: Sequence[Pt], cap: int) -> Slot:
    """Slot ``number`` on the straight site's left side, with these points as its candidates.

    A candidate's path vertex is the nearest vertex of the slot's 6 m window (5.4.9).
    """
    arc = number * SLOT_SPACING
    centre = (arc, CLUSTER_OFFSET)
    window = range(
        (arc - CORRIDOR_ARC_WINDOW) // SAMPLE_STEP, (arc + CORRIDOR_ARC_WINDOW) // SAMPLE_STEP + 1
    )
    candidates = tuple(
        Candidate(
            row=number,
            column=column,
            x=x,
            z=z,
            vertex=min(window, key=lambda i: ((i * SAMPLE_STEP - x) ** 2, i)),
        )
        for column, (x, z) in enumerate(points)
    )
    return Slot(
        number=number,
        arc=arc,
        centre=centre,
        den=1,
        cap=cap,
        on_turn=False,
        candidates=candidates,
        disc=disc(directions().disc, centre[0], centre[1], 1, CLUSTER_RADIUS),
    )


def capacity_with(built: Local, slots: Sequence[Slot]) -> Capacity:
    """The capacity of 5.4.9 for hand-made kept slots; a missing number is a slot void there."""
    return Capacity(
        slots=tuple(slots),
        total=sum(slot.capacity for slot in slots),
        void=0,
        cut=None,
        end=len(built.path) - 1,
        state=built.state,
    )


def row(number: int, offsets: Sequence[int]) -> list[Pt]:
    """Points of one slot at the given offsets along the path from the slot, on the slot row."""
    return [(number * SLOT_SPACING + offset, SLOT_Z) for offset in offsets]
