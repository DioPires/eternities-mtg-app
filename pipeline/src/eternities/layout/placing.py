"""Site placement in a region (PRD v4 5.4.6).

Sites are placed in site order. A candidate centre is a point of the square lattice of pitch 10 m
anchored at the origin. It is admissible when the site's bounding disc lies inside the region's
usable cell and 10 m from the plaza's edge path, from every hero volume and from every placed
site's bounding disc. The allocator takes the admissible candidate nearest the previous site's
centre.

A bounding disc is the 72-gon of 5.4.18 (13). Every test is the exact predicate on that polygon
with the 2 mm margin. Two integer bounds only save the exact test where it cannot decide
otherwise: the polygon contains the disc of 0.999 of its radius about its centre and lies inside
the disc of 1.001 of it, so a centre farther than the clearance plus 1.001 radii from a shape is
clear of it, and a centre nearer than the clearance plus 0.999 radii is not.

**What the code defines where 5.4.6 leaves a choice** (5.4.18 (12)):

- "Nearest the plaza's edge path", for the first site, is nearest the origin.
- Candidates are compared by squared distance, then by lattice row (z), then column (x).
- A region's candidates are the lattice points inside the bounding box of its cell.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .constants import CELL_MARGIN, MARGIN, PLAZA_EDGE_RADIUS, SITE_PITCH, SITE_SPACING
from .exact import Directions, Pt, ceil_div
from .geometry import Shape, boxes_apart, clear, disc, inside, point_in_polygon, point_segment_clear


def _inner(radius: int) -> int:
    return 999 * radius // 1000


def _outer(radius: int) -> int:
    return ceil_div(1001 * radius, 1000)


@dataclass(frozen=True, slots=True)
class Placed:
    centre: Pt
    bounding: int


class Ground:
    """What a bounding disc must keep clear of in one pass: the plaza and the hero volumes."""

    __slots__ = ("directions", "plaza", "volumes")

    def __init__(self, directions: Directions, volumes: Sequence[Shape]) -> None:
        self.directions = directions
        self.plaza = disc(directions.disc, 0, 0, 1, PLAZA_EDGE_RADIUS)
        self.volumes = tuple(volumes)

    def bounding_disc(self, centre: Pt, bounding: int) -> Shape:
        return disc(self.directions.disc, centre[0], centre[1], 1, bounding)


def _discs_clear(ground: Ground, centre: Pt, bounding: int, other: Placed) -> bool:
    spacing = SITE_SPACING + MARGIN
    dx, dz = centre[0] - other.centre[0], centre[1] - other.centre[1]
    squared = dx * dx + dz * dz
    if squared >= (spacing + _outer(bounding) + _outer(other.bounding)) ** 2:
        return True
    if squared < (spacing + _inner(bounding) + _inner(other.bounding)) ** 2:
        return False
    return clear(
        ground.bounding_disc(centre, bounding),
        ground.bounding_disc(other.centre, other.bounding),
        spacing,
    )


def _plaza_clear(ground: Ground, centre: Pt, bounding: int) -> bool:
    spacing = SITE_SPACING + MARGIN
    squared = centre[0] * centre[0] + centre[1] * centre[1]
    if squared >= (spacing + _outer(bounding) + _outer(PLAZA_EDGE_RADIUS)) ** 2:
        return True
    if squared < (spacing + _inner(bounding) + _inner(PLAZA_EDGE_RADIUS)) ** 2:
        return False
    return clear(ground.bounding_disc(centre, bounding), ground.plaza, spacing)


def _in_cell(ground: Ground, centre: Pt, bounding: int, cell: Shape) -> bool:
    """The bounding disc lies inside the usable cell: 10 m inside the cell (5.4.5)."""
    margin = CELL_MARGIN + MARGIN
    den = cell.den
    px, pz = centre[0] * den, centre[1] * den
    if not point_in_polygon(px, pz, cell.pts):
        return False
    near = ((margin + _inner(bounding)) * den) ** 2
    far = ((margin + _outer(bounding)) * den) ** 2
    count = len(cell.pts)
    decided = True
    for index in range(count):
        a, b = cell.pts[index], cell.pts[(index + 1) % count]
        if not point_segment_clear(px, pz, a, b, near):
            return False
        if decided and not point_segment_clear(px, pz, a, b, far):
            decided = False
    if decided:
        return True
    return inside(ground.bounding_disc(centre, bounding), cell, margin)


def _volumes_clear(ground: Ground, centre: Pt, bounding: int) -> bool:
    if not ground.volumes:
        return True
    spacing = SITE_SPACING + MARGIN
    reach = spacing + _outer(bounding)
    box = (centre[0], centre[1], centre[0], centre[1])
    shape: Shape | None = None
    for volume in ground.volumes:
        if boxes_apart(box, volume.box, reach + 1):
            continue
        if shape is None:
            shape = ground.bounding_disc(centre, bounding)
        if not clear(shape, volume, spacing):
            return False
    return True


def admissible(
    ground: Ground, centre: Pt, bounding: int, cell: Shape, others: Sequence[Placed]
) -> bool:
    """5.4.6: the bounding disc at ``centre`` fits its cell and keeps its 10 m from the rest."""
    return (
        _plaza_clear(ground, centre, bounding)
        and all(_discs_clear(ground, centre, bounding, other) for other in others)
        and _in_cell(ground, centre, bounding, cell)
        and _volumes_clear(ground, centre, bounding)
    )


def place(
    ground: Ground, bounding: int, cell: Shape, reference: Pt, placed: Sequence[Placed]
) -> Pt | None:
    """The admissible lattice point nearest ``reference``, or None when the region is short."""
    x0, z0, x1, z1 = cell.box
    candidates: list[tuple[int, int, int]] = []
    for row in range(ceil_div(z0, SITE_PITCH), z1 // SITE_PITCH + 1):
        z = row * SITE_PITCH
        dz = z - reference[1]
        for column in range(ceil_div(x0, SITE_PITCH), x1 // SITE_PITCH + 1):
            dx = column * SITE_PITCH - reference[0]
            candidates.append((dx * dx + dz * dz, row, column))
    candidates.sort()
    for _, row, column in candidates:
        centre = (column * SITE_PITCH, row * SITE_PITCH)
        if admissible(ground, centre, bounding, cell, placed):
            return centre
    return None
