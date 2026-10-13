"""Placement of a site's stands, its chapter stones and the trim of its path (PRD v4 5.4.10).

The work is done in the site's frame, after every site has capacity and the trail is reserved.
Each candidate takes its jitter, is displaced, faces its path vertex, and its footprint, apron
and corridor are tested on that final geometry with the 2 mm margin.

**What the code defines where 5.4.10 leaves a choice** (5.4.18 (12)):

- A candidate takes its two jitter draws when it is considered: in a cluster, candidates are
  considered in their fixed order until the cluster's capacity is used or the site's stand count
  is reached, and the candidates after that take no draw. A candidate that becomes a chapter
  stone takes its draws and does not use them.
- Two corridors **meet** when their strips intersect. The angle between them is the difference
  of their stands' yaws, between 0 and 180 degrees, and it must be 30 degrees or more.
- A chapter stone lies inside the blob and inside its cluster's disc, as a footprint does.
- A cluster closes under three when it holds fewer than three **stands**; a chapter stone is not
  a stand.
- A stone's yaw and a pad's yaw are set at emission, not here.
- Other sites' stands, stones, paths and pads are not tested: every site's bounding disc lies
  10 m from every other's (5.4.6), and the independent checker asserts the pairs all the same.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from dataclasses import dataclass

from .capacity import (
    APRON_FRONT,
    APRON_HALF,
    FOOT_BACK,
    FOOT_HALF,
    Candidate,
    Capacity,
    Slot,
    path_end,
)
from .constants import (
    CLUSTER_RADIUS,
    CORRIDOR_ARC_WINDOW,
    CORRIDOR_HALF_WIDTH,
    CORRIDOR_MIN_CROSSING,
    COUNTS_PER_TURN,
    JITTER_RADIUS,
    MARGIN,
    MICRO_PER_COUNT,
    MICRO_PER_TURN,
    MIN_CLUSTER,
    PATH_HALF_WIDTH,
    STONE_RADIUS,
)
from .exact import SCALE, Directions, Prng
from .geometry import Box, Shape, boxes_apart, clear, disc, inside, rectangle, strip
from .local import Local

_CELL = 8_000
_MIN_CROSSING = CORRIDOR_MIN_CROSSING // MICRO_PER_COUNT


@dataclass(frozen=True, slots=True)
class Stand:
    slot: int
    """Index of the stand's cluster among the site's kept slots."""
    row: int
    column: int
    x: int
    """The displaced position, numerators over 2^30, in the site's frame."""
    z: int
    yaw: int
    """The direction the image surface faces, in counts of the trig table."""
    vertex: int
    footprint: Shape
    apron: Shape
    corridor: Shape


@dataclass(frozen=True, slots=True)
class ChapterStone:
    slot: int
    chapter: int
    """Index of the chapter this stone opens, 1 or more."""
    x: int
    """The lattice point, whole millimetres, in the site's frame."""
    z: int
    vertex: int
    disc: Shape


@dataclass(frozen=True, slots=True)
class Placement:
    stands: tuple[Stand, ...]
    """In acceptance order: the site's cards, in their 5.4.3 order, take these positions."""
    stones: tuple[ChapterStone, ...]
    end: int
    """Index of the path's last vertex after the trim."""
    exhausted: int | None
    """None when every card has a stand. Else the number of the slot that closed under three
    stands, or 0 when the kept slots ran out."""
    considered: int
    """Candidates that took a jitter draw."""
    rejected: tuple[int, ...]
    """Candidates rejected, by cause, in the order of :data:`CAUSES`."""


@dataclass(frozen=True, slots=True)
class Foreign:
    """Reservations of the world near this site, in the site's frame (5.4.11)."""

    solid: tuple[Shape, ...] = ()
    """What a footprint, an apron and a chapter stone must clear: trail legs, the plaza
    approach, the plaza with its edge path, hero volumes."""
    corridor: tuple[Shape, ...] = ()
    """What a corridor must clear: the plaza and hero volumes."""


CAUSES: tuple[str, ...] = (
    "the footprint is not inside the blob and the cluster's disc",
    "the footprint or the apron meets a path, a pad, an approach, a stone or a reservation",
    "the corridor meets a stone, the plaza or a hero volume",
    "the footprint or the apron meets another stand's footprint or apron",
    "the footprint or the apron lies in another stand's corridor",
    "the corridor meets another stand's footprint or apron",
    "the corridor meets another corridor at under 30 degrees",
    "a chapter stone does not fit at the lattice point",
)


class _Index:
    """Accepted stands in a hash grid, to find those near a box."""

    __slots__ = ("_cells", "stands")

    def __init__(self) -> None:
        self.stands: list[Stand] = []
        self._cells: dict[tuple[int, int], list[int]] = {}

    def add(self, stand: Stand) -> None:
        position = len(self.stands)
        self.stands.append(stand)
        for key in self._keys(_box(stand)):
            self._cells.setdefault(key, []).append(position)

    def truncate(self, count: int) -> None:
        """Withdraw every stand added after the first ``count``."""
        del self.stands[count:]
        for held in self._cells.values():
            while held and held[-1] >= count:
                held.pop()

    def near(self, box: Box) -> list[Stand]:
        found: set[int] = set()
        for key in self._keys(box):
            found.update(self._cells.get(key, ()))
        return [self.stands[position] for position in sorted(found)]

    @staticmethod
    def _keys(box: Box) -> list[tuple[int, int]]:
        return [
            (cx, cz)
            for cx in range(box[0] // _CELL, box[2] // _CELL + 1)
            for cz in range(box[1] // _CELL, box[3] // _CELL + 1)
        ]


def _union(a: Box, b: Box) -> Box:
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def _grow(box: Box, by: int) -> Box:
    return box[0] - by, box[1] - by, box[2] + by, box[3] + by


def _box(stand: Stand) -> Box:
    corridor = _grow(stand.corridor.box, CORRIDOR_HALF_WIDTH)
    return _union(_union(stand.footprint.box, stand.apron.box), corridor)


def yaw_gap(a: int, b: int) -> int:
    """The angle between two yaws, in counts, between 0 and half a turn."""
    gap = abs(a - b) % COUNTS_PER_TURN
    return min(gap, COUNTS_PER_TURN - gap)


VERTEX_TRIES: int = 1  # experiment: how many vertices of the window a candidate may face
UNDER_THREE: str = "exhaust"  # experiment: "void" withdraws a cluster under three; "keep" keeps it


def place_site(
    local: Local,
    capacity: Capacity,
    chapters: Sequence[int],
    directions: Directions,
    foreign: Foreign | None = None,
) -> Placement:
    """5.4.10 for one site. ``chapters`` is the stand count of each chapter, in order.

    A site with no chapters of its own (a regional site, a set site) passes one count.
    """
    foreign = foreign or Foreign()
    prng = Prng(0)
    prng.state = capacity.state
    total = sum(chapters)
    small = total < MIN_CLUSTER
    index = _Index()
    stones: list[ChapterStone] = []
    stone_discs: list[Shape] = [local.stone_disc]
    chapter, in_chapter, stone_due = 0, 0, False
    exhausted: int | None = None
    considered = 0
    rejected = [0] * len(CAUSES)
    path_reach = PATH_HALF_WIDTH + MARGIN + 1
    path, arcs = local.path, local.arcs

    def off_reservations(shape: Shape) -> bool:
        near = local.index.near(shape.box, path_reach)
        return (
            clear(local.path_strip, shape, MARGIN, near)
            and clear(local.pad_disc, shape, MARGIN)
            and clear(local.approach_strip, shape, MARGIN)
            and all(clear(shape, stone, MARGIN) for stone in stone_discs)
            and all(clear(shape, other, MARGIN) for other in foreign.solid)
        )

    def within(shape: Shape, slot: Slot) -> bool:
        return inside(shape, local.blob, MARGIN) and inside(shape, slot.disc, MARGIN)

    def attempt(
        position: int, slot: Slot, candidate: Candidate, px: int, pz: int, vertex: int
    ) -> Stand | int:
        """The stand at (px, pz) / 2^30 facing ``vertex``, or the cause that rejects it."""
        vx, vz = path[vertex]
        yaw = directions.count_of(vx * SCALE - px, vz * SCALE - pz)
        facing = directions.at(yaw)
        footprint = rectangle(px, pz, facing, -FOOT_BACK, FOOT_BACK, FOOT_HALF)
        if not within(footprint, slot):
            return 0
        apron = rectangle(px, pz, facing, FOOT_BACK, APRON_FRONT, APRON_HALF)
        if not (off_reservations(footprint) and off_reservations(apron)):
            return 1
        start = (px + APRON_FRONT * facing[0], pz + APRON_FRONT * facing[1])
        corridor = strip([start, (vx * SCALE, vz * SCALE)], CORRIDOR_HALF_WIDTH, SCALE)
        if not (
            all(clear(corridor, stone, MARGIN) for stone in stone_discs)
            and all(clear(corridor, other, MARGIN) for other in foreign.corridor)
            and (vertex == candidate.vertex or inside(corridor, local.blob, MARGIN))
        ):
            return 2
        stand = Stand(
            slot=position,
            row=candidate.row,
            column=candidate.column,
            x=px,
            z=pz,
            yaw=yaw,
            vertex=vertex,
            footprint=footprint,
            apron=apron,
            corridor=corridor,
        )
        return _stand_conflict(stand, index) or stand

    def vertices(slot: Slot, candidate: Candidate) -> list[int]:
        if VERTEX_TRIES == 1:
            return [candidate.vertex]
        window = range(
            bisect_left(arcs, slot.arc - CORRIDOR_ARC_WINDOW),
            bisect_right(arcs, slot.arc + CORRIDOR_ARC_WINDOW),
        )
        ordered = sorted(
            window,
            key=lambda i: ((path[i][0] - candidate.x) ** 2 + (path[i][1] - candidate.z) ** 2, i),
        )
        return ordered[:VERTEX_TRIES]

    void_run = 0
    previous = 0
    for position, slot in enumerate(capacity.slots):
        if len(index.stands) == total:
            break
        if slot.number == previous + 2:
            # The slot between was void at capacity.
            if void_run == 1:
                exhausted = previous + 1
                break
            void_run = 1
        previous = slot.number
        units = 0
        stands_here = 0
        mark = (len(index.stands), len(stones), chapter, in_chapter, stone_due)
        for candidate in slot.candidates:
            if units == slot.capacity or len(index.stands) == total:
                break
            considered += 1
            angle = prng.randint(0, MICRO_PER_TURN - 1)
            radius = prng.randint(0, JITTER_RADIUS)
            if stone_due:
                stone = disc(directions.disc, candidate.x, candidate.z, 1, STONE_RADIUS)
                if not (
                    within(stone, slot)
                    and off_reservations(stone)
                    and all(
                        clear(stone, other.footprint, MARGIN)
                        and clear(stone, other.apron, MARGIN)
                        and clear(other.corridor, stone, MARGIN)
                        for other in index.near(_grow(stone.box, MARGIN + 1))
                    )
                ):
                    rejected[7] += 1
                    continue
                stones.append(
                    ChapterStone(
                        slot=position,
                        chapter=chapter,
                        x=candidate.x,
                        z=candidate.z,
                        vertex=candidate.vertex,
                        disc=stone,
                    )
                )
                stone_discs.append(stone)
                stone_due = False
                units += 1
                continue
            jc, js = directions.of_micro(angle)
            px = candidate.x * SCALE + radius * jc
            pz = candidate.z * SCALE + radius * js
            first: int | None = None
            found: Stand | None = None
            for vertex in vertices(slot, candidate):
                tried = attempt(position, slot, candidate, px, pz, vertex)
                if isinstance(tried, Stand):
                    found = tried
                    break
                if first is None:
                    first = tried
            if found is None:
                rejected[first or 0] += 1
                continue
            index.add(found)
            units += 1
            stands_here += 1
            in_chapter += 1
            if in_chapter == chapters[chapter] and chapter + 1 < len(chapters):
                chapter += 1
                in_chapter = 0
                stone_due = True
        if len(index.stands) < total and stands_here < MIN_CLUSTER and not small:
            if UNDER_THREE == "exhaust":
                exhausted = slot.number
                break
            if UNDER_THREE == "keep":
                void_run = 0
                continue
            # The cluster is withdrawn and its slot is void; a second void in a row cuts the path.
            index.truncate(mark[0])
            del stones[mark[1] :]
            del stone_discs[mark[1] + 1 :]
            chapter, in_chapter, stone_due = mark[2], mark[3], mark[4]
            void_run += 1
            if void_run == 2:
                exhausted = slot.number
                break
        else:
            void_run = 0
    if exhausted is None and len(index.stands) < total:
        exhausted = 0

    stands = tuple(index.stands)
    end = capacity.end
    if exhausted is None:
        # Stands are accepted in slot order, so the last stand's slot is the last occupied one.
        reach = 0
        if stands:
            reach = capacity.slots[stands[-1].slot].arc + CLUSTER_RADIUS
            reach = max(reach, max(arcs[stand.vertex] for stand in stands))
        end = max(1, path_end(arcs, min(reach, arcs[capacity.end])))
    return Placement(
        stands=stands,
        stones=tuple(stones),
        end=end,
        exhausted=exhausted,
        considered=considered,
        rejected=tuple(rejected),
    )


def _stand_conflict(stand: Stand, index: _Index) -> int:
    """The stand's three shapes against every accepted stand near it (invariant 9).

    Returns 0 when nothing is met, or the index in :data:`CAUSES` of the first rule broken.
    """
    box = _box(stand)
    for other in index.near(box):
        if boxes_apart(box, _box(other), MARGIN + 1):
            continue
        if not (
            clear(stand.footprint, other.footprint, MARGIN)
            and clear(stand.footprint, other.apron, MARGIN)
            and clear(stand.apron, other.footprint, MARGIN)
            and clear(stand.apron, other.apron, MARGIN)
        ):
            return 3
        if not (
            clear(other.corridor, stand.footprint, MARGIN)
            and clear(other.corridor, stand.apron, MARGIN)
        ):
            return 4
        if not (
            clear(stand.corridor, other.footprint, MARGIN)
            and clear(stand.corridor, other.apron, MARGIN)
        ):
            return 5
        if yaw_gap(stand.yaw, other.yaw) < _MIN_CROSSING and not clear(
            stand.corridor, other.corridor, MARGIN
        ):
            return 6
    return 0
