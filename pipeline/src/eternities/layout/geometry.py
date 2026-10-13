"""The allocator's shapes and its exact predicates on filled shapes (PRD v4 5.4.18 (10)).

A shape is a polygon (closed, filled) or a strip (an open polyline with a half width). Its
vertices are exact rationals over **one denominator per shape**: a pair of integer numerators and
the shape's ``den``. Two shapes are compared after both are brought to the least common
denominator, so every predicate below runs on integers; a ``Fraction`` appears only where a
division makes a new point (5.4.18 (2)).

Distances are compared squared and never taken (5.4.18 (5)). A clearance ``c`` between two shapes
is the statement "the distance between the two filled shapes is at least ``c``"; the caller adds
the 2 mm margin of 5.4.18 (4). No offset polygon, join, cap or corner normal is constructed.

The integer ``box`` of a shape is its bounding box in whole millimetres, rounded outward. It only
ever proves two shapes far apart; no decision is made on it alone that the exact test would make
differently.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from math import gcd

from .exact import SCALE, Pt

type Box = tuple[int, int, int, int]
"""(x min, z min, x max, z max) in whole millimetres."""


class Shape:
    """A polygon or a strip with vertices ``pts[i] / den``."""

    __slots__ = ("_edge_boxes", "_scaled", "box", "closed", "den", "half", "pts")

    def __init__(self, pts: Sequence[Pt], den: int = 1, *, closed: bool, half: int = 0) -> None:
        self.pts: tuple[Pt, ...] = tuple(pts)
        self.den = den
        self.closed = closed
        self.half = half
        self.box: Box = box_of(self.pts, den)
        self._scaled: dict[int, tuple[Pt, ...]] = {}
        self._edge_boxes: list[Box] | None = None

    def scaled(self, den: int) -> tuple[Pt, ...]:
        """The numerators over ``den``, a multiple of this shape's own denominator."""
        if den == self.den:
            return self.pts
        found = self._scaled.get(den)
        if found is None:
            factor = den // self.den
            found = tuple((x * factor, z * factor) for x, z in self.pts)
            self._scaled[den] = found
        return found

    def edge_count(self) -> int:
        return len(self.pts) if self.closed else len(self.pts) - 1

    def edge_boxes(self) -> list[Box]:
        if self._edge_boxes is None:
            pts, den, count = self.pts, self.den, len(self.pts)
            self._edge_boxes = [
                box_of((pts[i], pts[(i + 1) % count]), den) for i in range(self.edge_count())
            ]
        return self._edge_boxes

    def edges_near(self, box: Box, reach: int) -> list[int]:
        """Indices of the edges whose box lies within ``reach`` of ``box``.

        Every other edge is farther than ``reach`` from anything inside ``box``.
        """
        x0, z0, x1, z1 = box[0] - reach, box[1] - reach, box[2] + reach, box[3] + reach
        return [
            index
            for index, (a, b, c, d) in enumerate(self.edge_boxes())
            if a <= x1 and c >= x0 and b <= z1 and d >= z0
        ]

    def translated(self, dx: int, dz: int) -> Shape:
        """This shape moved by a whole number of millimetres."""
        return Shape(
            [(x + dx * self.den, z + dz * self.den) for x, z in self.pts],
            self.den,
            closed=self.closed,
            half=self.half,
        )


def polygon(pts: Sequence[Pt], den: int = 1) -> Shape:
    return Shape(pts, den, closed=True)


def strip(pts: Sequence[Pt], half: int, den: int = 1) -> Shape:
    return Shape(pts, den, closed=False, half=half)


def box_of(pts: Iterable[Pt], den: int) -> Box:
    xs: list[int] = []
    zs: list[int] = []
    for x, z in pts:
        xs.append(x)
        zs.append(z)
    return min(xs) // den, min(zs) // den, -(-max(xs) // den), -(-max(zs) // den)


def boxes_apart(a: Box, b: Box, reach: int) -> bool:
    """True when the two boxes are more than ``reach`` apart along x or along z."""
    return a[0] - b[2] > reach or b[0] - a[2] > reach or a[1] - b[3] > reach or b[1] - a[3] > reach


def lcm(a: int, b: int) -> int:
    return a // gcd(a, b) * b


def disc(directions: Sequence[Pt], cx: int, cz: int, den: int, radius: int) -> Shape:
    """A disc as the 72-gon of 5.4.18 (13): the centre (cx, cz) / den plus radius x direction.

    The directions are (cos, sin) over 2^30, so the vertices are over the least common multiple of
    ``den`` and 2^30.
    """
    out = lcm(den, SCALE)
    centre, unit = out // den, out // SCALE
    bx, bz = cx * centre, cz * centre
    radial = radius * unit
    return polygon([(bx + radial * c, bz + radial * s) for c, s in directions], out)


def rectangle(
    px: int, pz: int, direction: Pt, back: int, front: int, half_width: int, den: int = SCALE
) -> Shape:
    """The rectangle from ``back`` to ``front`` along a table direction, ``half_width`` each side.

    The origin (px, pz) is over ``den`` = 2^30 and the direction is (cos, sin) over 2^30, so the
    corners are over 2^30 too. Counter-clockwise.
    """
    c, s = direction
    nx, nz = -s, c
    return polygon(
        [
            (px + back * c - half_width * nx, pz + back * s - half_width * nz),
            (px + front * c - half_width * nx, pz + front * s - half_width * nz),
            (px + front * c + half_width * nx, pz + front * s + half_width * nz),
            (px + back * c + half_width * nx, pz + back * s + half_width * nz),
        ],
        den,
    )


# Integer predicates. Every argument of one call is over the same denominator.


def point_in_polygon(px: int, pz: int, pts: Sequence[Pt]) -> bool:
    """Even-odd, the boundary counted inside (5.4.18 (10))."""
    inside = False
    ax, az = pts[-1]
    for bx, bz in pts:
        if (az > pz) != (bz > pz):
            # The edge straddles the horizontal line through the point.
            side = (bx - ax) * (pz - az) - (bz - az) * (px - ax)
            if side == 0:
                return True
            if (side > 0) == (bz > az):
                inside = not inside
        elif (az == pz and bz == pz and min(ax, bx) <= px <= max(ax, bx)) or (
            bz == pz and bx == px
        ):
            return True
        ax, az = bx, bz
    return inside


def _orient(ax: int, az: int, bx: int, bz: int, cx: int, cz: int) -> int:
    value = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    return (value > 0) - (value < 0)


def segments_intersect(a: Pt, b: Pt, c: Pt, d: Pt) -> bool:
    """Closed segments ab and cd share a point, by the signs of exact cross products."""
    ax, az = a
    bx, bz = b
    cx, cz = c
    dx, dz = d
    o1 = _orient(ax, az, bx, bz, cx, cz)
    o2 = _orient(ax, az, bx, bz, dx, dz)
    o3 = _orient(cx, cz, dx, dz, ax, az)
    o4 = _orient(cx, cz, dx, dz, bx, bz)
    if o1 != o2 and o3 != o4:
        return True
    return (
        (o1 == 0 and _within(ax, az, bx, bz, cx, cz))
        or (o2 == 0 and _within(ax, az, bx, bz, dx, dz))
        or (o3 == 0 and _within(cx, cz, dx, dz, ax, az))
        or (o4 == 0 and _within(cx, cz, dx, dz, bx, bz))
    )


def _within(ax: int, az: int, bx: int, bz: int, px: int, pz: int) -> bool:
    """A point collinear with ab lies on the closed segment."""
    return min(ax, bx) <= px <= max(ax, bx) and min(az, bz) <= pz <= max(az, bz)


def point_segment_clear(px: int, pz: int, a: Pt, b: Pt, limit: int) -> bool:
    """The squared distance from the point to the closed segment ab is at least ``limit``."""
    ax, az = a
    ex, ez = b[0] - ax, b[1] - az
    qx, qz = px - ax, pz - az
    along = qx * ex + qz * ez
    if along <= 0:
        return qx * qx + qz * qz >= limit
    length = ex * ex + ez * ez
    if along >= length:
        rx, rz = px - b[0], pz - b[1]
        return rx * rx + rz * rz >= limit
    across = ex * qz - ez * qx
    return across * across >= limit * length


def segments_clear(a: Pt, b: Pt, c: Pt, d: Pt, limit: int) -> bool:
    """The squared distance between the closed segments is at least ``limit`` (> 0)."""
    return (
        point_segment_clear(a[0], a[1], c, d, limit)
        and point_segment_clear(b[0], b[1], c, d, limit)
        and point_segment_clear(c[0], c[1], a, b, limit)
        and point_segment_clear(d[0], d[1], a, b, limit)
        and not segments_intersect(a, b, c, d)
    )


def _common(a: Shape, b: Shape) -> tuple[int, tuple[Pt, ...], tuple[Pt, ...]]:
    den = a.den if a.den == b.den else lcm(a.den, b.den)
    return den, a.scaled(den), b.scaled(den)


def _boundaries_clear(
    a: Shape,
    b: Shape,
    pa: Sequence[Pt],
    pb: Sequence[Pt],
    reach: int,
    limit: int,
    near_a: Sequence[int] | None = None,
) -> bool:
    edges_a = a.edges_near(b.box, reach + 1) if near_a is None else near_a
    if not edges_a:
        return True
    edges_b = b.edges_near(a.box, reach + 1)
    if not edges_b:
        return True
    count_a, count_b = len(pa), len(pb)
    boxes_a, boxes_b = a.edge_boxes(), b.edge_boxes()
    for i in edges_a:
        a0, a1 = pa[i], pa[(i + 1) % count_a]
        box = boxes_a[i]
        for j in edges_b:
            if boxes_apart(box, boxes_b[j], reach + 1):
                continue
            if not segments_clear(a0, a1, pb[j], pb[(j + 1) % count_b], limit):
                return False
    return True


def clear(a: Shape, b: Shape, clearance: int, near_a: Sequence[int] | None = None) -> bool:
    """The filled shapes ``a`` and ``b`` are at least ``clearance`` (> 0) apart.

    A strip's distance to a shape is its polyline's distance less the half width, so the
    polylines must be ``clearance`` plus the half widths apart. Two shapes whose boundaries are
    apart can still be nested; one vertex of each decides that, because the boundaries do not
    cross. ``near_a`` names the edges of ``a`` to test, when the caller has an index that finds
    them; every edge it leaves out is farther than the reach from ``b``.
    """
    reach = clearance + a.half + b.half
    if near_a is None and boxes_apart(a.box, b.box, reach + 1):
        return True
    den, pa, pb = _common(a, b)
    limit = (reach * den) ** 2
    if len(pb) == 1:
        # A point: its distance to each edge of ``a``.
        px, pz = pb[0]
        edges = a.edges_near(b.box, reach + 1) if near_a is None else near_a
        count = len(pa)
        for i in edges:
            if not point_segment_clear(px, pz, pa[i], pa[(i + 1) % count], limit):
                return False
    elif not _boundaries_clear(a, b, pa, pb, reach, limit, near_a):
        return False
    if a.closed and point_in_polygon(pb[0][0], pb[0][1], pa):
        return False
    return not (b.closed and point_in_polygon(pa[0][0], pa[0][1], pb))


def inside(a: Shape, b: Shape, clearance: int) -> bool:
    """``a`` lies inside the polygon ``b``, at least ``clearance`` (> 0) from its boundary.

    For a strip this is the rule of 5.4.18 (10): every vertex inside, every segment the half width
    plus the clearance from every edge. One vertex inside and the boundaries apart is the same
    statement, because a boundary that does not come near cannot be crossed.
    """
    reach = clearance + a.half
    den, pa, pb = _common(a, b)
    limit = (reach * den) ** 2
    if not point_in_polygon(pa[0][0], pa[0][1], pb):
        return False
    if len(pa) == 1:
        px, pz = pa[0]
        count = len(pb)
        for j in b.edges_near(a.box, reach + 1):
            if not point_segment_clear(px, pz, pb[j], pb[(j + 1) % count], limit):
                return False
        return True
    return _boundaries_clear(a, b, pa, pb, reach, limit)


def point_inside(px: int, pz: int, den: int, b: Shape, clearance: int) -> bool:
    """The point (px, pz) / den lies inside the polygon ``b``, ``clearance`` from its boundary."""
    return inside(Shape([(px, pz)], den, closed=False), b, clearance)


def touches(a: Shape, b: Shape) -> bool:
    """The filled shapes intersect: distance zero (5.4.18 (10)). Neither is a strip with width."""
    if boxes_apart(a.box, b.box, 0):
        return False
    _den, pa, pb = _common(a, b)
    count_a, count_b = len(pa), len(pb)
    for i in range(a.edge_count()):
        a0, a1 = pa[i], pa[(i + 1) % count_a]
        for j in range(b.edge_count()):
            if segments_intersect(a0, a1, pb[j], pb[(j + 1) % count_b]):
                return True
    if a.closed and any(point_in_polygon(x, z, pa) for x, z in pb):
        return True
    return b.closed and any(point_in_polygon(x, z, pb) for x, z in pa)


class PointIndex:
    """Integer points in a hash grid, to find those inside a box."""

    __slots__ = ("_cells", "_pitch", "pts")

    def __init__(self, pts: Sequence[Pt], pitch: int = 4_000) -> None:
        self.pts = tuple(pts)
        self._pitch = pitch
        cells: dict[tuple[int, int], list[int]] = {}
        for index, (x, z) in enumerate(self.pts):
            cells.setdefault((x // pitch, z // pitch), []).append(index)
        self._cells = cells

    def within(self, box: Box) -> list[int]:
        """Indices of every point inside ``box``, ascending, and perhaps a few just outside."""
        pitch = self._pitch
        found: list[int] = []
        for cx in range(box[0] // pitch, box[2] // pitch + 1):
            for cz in range(box[1] // pitch, box[3] // pitch + 1):
                found.extend(self._cells.get((cx, cz), ()))
        found.sort()
        return found


class SegmentIndex:
    """The segments of one integer polyline in a hash grid, to find those near a box."""

    __slots__ = ("_cells", "_pitch", "pts")

    def __init__(self, pts: Sequence[Pt], pitch: int = 4_000) -> None:
        self.pts = tuple(pts)
        self._pitch = pitch
        cells: dict[tuple[int, int], list[int]] = {}
        for index in range(len(self.pts) - 1):
            (ax, az), (bx, bz) = self.pts[index], self.pts[index + 1]
            for cx in range(min(ax, bx) // pitch, max(ax, bx) // pitch + 1):
                for cz in range(min(az, bz) // pitch, max(az, bz) // pitch + 1):
                    cells.setdefault((cx, cz), []).append(index)
        self._cells = cells

    def near(self, box: Box, reach: int) -> list[int]:
        """Indices of every segment within ``reach`` of ``box``, ascending; others are farther."""
        pitch = self._pitch
        found: set[int] = set()
        for cx in range((box[0] - reach) // pitch, (box[2] + reach) // pitch + 1):
            for cz in range((box[1] - reach) // pitch, (box[3] + reach) // pitch + 1):
                segments = self._cells.get((cx, cz))
                if segments:
                    found.update(segments)
        return sorted(found)


def squared_distance_to_polyline(px: int, pz: int, den: int, pts: Sequence[Pt]) -> tuple[int, int]:
    """The squared distance from (px, pz) / den to an integer polyline, as (numerator, divisor).

    The value is numerator / (divisor x den^2). The least of the segment distances is found by
    cross multiplication, so no division is made.
    """
    best_num, best_div = -1, 1
    for index in range(len(pts) - 1):
        ax, az = pts[index][0] * den, pts[index][1] * den
        bx, bz = pts[index + 1][0] * den, pts[index + 1][1] * den
        ex, ez = bx - ax, bz - az
        qx, qz = px - ax, pz - az
        along = qx * ex + qz * ez
        length = ex * ex + ez * ez
        if along <= 0 or length == 0:
            num, div = qx * qx + qz * qz, 1
        elif along >= length:
            num, div = (px - bx) ** 2 + (pz - bz) ** 2, 1
        else:
            across = ex * qz - ez * qx
            num, div = across * across, length
        if best_num < 0 or num * best_div < best_num * div:
            best_num, best_div = num, div
    return best_num, best_div
