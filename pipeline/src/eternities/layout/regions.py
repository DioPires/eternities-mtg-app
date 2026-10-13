"""The world disc and its partition into regions (PRD v4 5.4.4, 5.4.5).

The world disc is the regular 72-gon of 5.4.1: the table directions of every 5 degrees times R. A
hero world's regions are the cells of the power diagram of the scaled anchors, each computed by
half-plane intersection in region-table order in exact rational arithmetic and clipped to the
world polygon. A kit world has one region: the whole polygon.

**What the code defines where 5.4.5 leaves a choice** (5.4.18 (12)):

- A cell starts as the world polygon and is cut by the half-plane of every other region, in
  table order. A vertex on a cutting line is kept; an edge that crosses it gives one new vertex.
- A cell is degenerate when fewer than three distinct vertices remain or its area is zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import isqrt, lcm

from .constants import (
    ANCHOR_SCALE,
    PLAZA_EDGE_RADIUS,
    SITE_SPACING,
    WEIGHT_SCALE,
    WORLD_FIT_TERM,
    WORLD_FLOOR,
    WORLD_PLAZA_TERM,
)
from .exact import SCALE, Directions, ceil_div
from .geometry import Shape, polygon

type Point = tuple[Fraction, Fraction]


class DegenerateCell(RuntimeError):
    """A region's cell is empty, a point or a segment: a data error no widening cures (5.4.5)."""

    def __init__(self, region: str) -> None:
        super().__init__(
            f"region {region!r}: degenerate cell; move the anchor or change the weight (5.4.5)"
        )
        self.region = region


@dataclass(frozen=True, slots=True)
class RegionRow:
    id: str
    anchor: tuple[int, int]
    """(u, v) in thousandths, inside the unit disc."""
    weight: int
    """In thousandths."""


def initial_radius(bounding: list[int]) -> int:
    """R0 = max(30 m, isqrt(2 x sum of b_s^2) + 25 m, 35 m + 2 b_max) (5.4.4)."""
    if not bounding:
        return WORLD_FLOOR
    return max(
        WORLD_FLOOR,
        isqrt(2 * sum(b * b for b in bounding)) + WORLD_PLAZA_TERM,
        WORLD_FIT_TERM + 2 * max(bounding),
    )


def widened_world(radius: int) -> int:
    """R becomes ceil(11 R / 10) mm (5.4.1)."""
    return ceil_div(11 * radius, 10)


def world_polygon(radius: int, directions: Directions) -> Shape:
    """The regular 72-gon of radius R about the origin, vertices over 2^30."""
    return polygon([(radius * c, radius * s) for c, s in directions.disc], SCALE)


def _clip(points: list[Point], a: Fraction, b: Fraction, c: Fraction) -> list[Point]:
    """The part of a convex polygon where a x + b z <= c."""
    kept: list[Point] = []
    count = len(points)
    for index in range(count):
        here, there = points[index], points[(index + 1) % count]
        side_here = a * here[0] + b * here[1] - c
        side_there = a * there[0] + b * there[1] - c
        if side_here <= 0:
            kept.append(here)
        if (side_here < 0 < side_there) or (side_there < 0 < side_here):
            t = side_here / (side_here - side_there)
            kept.append((here[0] + t * (there[0] - here[0]), here[1] + t * (there[1] - here[1])))
    return kept


def _distinct(points: list[Point]) -> list[Point]:
    out: list[Point] = []
    for point in points:
        if not out or out[-1] != point:
            out.append(point)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def _doubled_area(points: list[Point]) -> Fraction:
    total = Fraction(0)
    count = len(points)
    for index in range(count):
        (ax, az), (bx, bz) = points[index], points[(index + 1) % count]
        total += ax * bz - bx * az
    return total


def _shape(points: list[Point]) -> Shape:
    den = 1
    for x, z in points:
        den = lcm(den, x.denominator, z.denominator)
    return polygon(
        [
            (x.numerator * (den // x.denominator), z.numerator * (den // z.denominator))
            for x, z in points
        ],
        den,
    )


def partition(radius: int, rows: list[RegionRow], directions: Directions) -> list[Shape]:
    """The cell of every region, in table order, as exact rational polygons (5.4.5).

    Raises :class:`DegenerateCell` naming the first region, in table order, whose cell is empty
    or has no area.
    """
    world = [(Fraction(radius * c, SCALE), Fraction(radius * s, SCALE)) for c, s in directions.disc]
    num, den = ANCHOR_SCALE
    anchors = [
        (Fraction(num * radius * row.anchor[0], den), Fraction(num * radius * row.anchor[1], den))
        for row in rows
    ]
    weights = [Fraction(row.weight * radius * radius, WEIGHT_SCALE) for row in rows]
    cells: list[Shape] = []
    for i, row in enumerate(rows):
        points = world
        ax, az = anchors[i]
        own = ax * ax + az * az - weights[i]
        for j in range(len(rows)):
            if j == i:
                continue
            bx, bz = anchors[j]
            # |x - a_i|^2 - w_i <= |x - a_j|^2 - w_j, as a half-plane in x.
            points = _clip(
                points, 2 * (bx - ax), 2 * (bz - az), bx * bx + bz * bz - weights[j] - own
            )
            if not points:
                break
        points = _distinct(points)
        if len(points) < 3 or _doubled_area(points) == 0:
            raise DegenerateCell(row.id)
        cells.append(_shape(points))
    return cells


def doubled_area(cell: Shape) -> Fraction:
    """Twice the area of a cell, exact, in mm^2."""
    points = [(Fraction(x, cell.den), Fraction(z, cell.den)) for x, z in cell.pts]
    return abs(_doubled_area(points))


PLAZA_KEEP_OUT = PLAZA_EDGE_RADIUS + SITE_SPACING
"""A site's bounding disc stays 10 m from the plaza's edge path: 25 m from the origin."""
