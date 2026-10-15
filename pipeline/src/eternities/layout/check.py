"""The independent checker of one laid-out world (PRD v4 3.2, invariants 7 to 11).

The checker reads what a reader of the pack reads: the bytes of ``stands.bin`` (4.13.3), the
world document (4.13.5) and, on a hero world, the lore document (4.16.3). It rebuilds every shape
from those integers and asserts the invariants on them against the nominal figures of 5.4.1, with
no margin (5.4.18 (4)). It shares two modules with the allocator, the constants and the trig
table, and no other: every predicate below is written from the text of 5.4.18 (10), and nothing
of the allocator is called, copied or read.

**Arithmetic.** Integers only. A rebuilt shape has its vertices over one denominator, the trig
table's 2^30, so an emitted millimetre is shifted left by 30 bits and a table direction is used as
it is stored. Every comparison is between cross-multiplied integers; a distance is compared
squared; a root is ``isqrt`` and is taken only for an arc length (5.4.18 (5)) or to print a
figure. Nothing is divided, and no offset polygon is built.

**Shapes.** A stand's footprint is the rectangle of 5.4.1 centred on the emitted position, its
depth along the emitted yaw, which is a count of the trig table. Its apron starts at the
footprint's front face and runs forward. Its corridor is the strip from the middle of the apron's
front edge to the vertex of its site's path that the world document names. A disc (a pad, a
stone, a cluster, the plaza, a site's bounding disc) is the 72-gon of 5.4.18 (13). A path, an
approach, a trail leg and the plaza approach are strips of half width 1.5 m along the emitted
polyline; a site's approach is the segment from its pad's centre to its approach point.

**Readings.** Where the PRD leaves a choice the checker takes these, and each is a definition:

- *Path vertex* (CEO ruling of 2026-10-13 on DEC-1004). A corridor ends on the path vertex the
  world document names, and that vertex's arc length lies within 6 m of the slot arc length of
  the stand's cluster, ahead or behind. It need not be the nearest vertex.
- *Withdrawn clusters* (the same ruling). No cluster has fewer than three stands, except a site's
  last cluster and a site of fewer than three stands.
- *A polygon lies inside a polygon* (the footprint in the blob and in the cluster's disc, the
  return pad in the plaza) by the exact rule of ``polygon_inside_polygon``: every vertex inside,
  and the midpoint of every piece of an inner edge between the points where it meets the outer
  boundary inside, boundary counted inside (CEO ruling on DEC-1004, 2026-10-14). 5.4.18 (10)
  gives the rule for a strip; this is the rule for two filled polygons.
- *The site stone's place* (5.4.8, invariant 9). The pad's centre is H + 1.5 m u_H, the approach
  point H + 11.5 m u_H and the stone's centre H + 4 m u_H ± 3 m n_H, so the stone's centre lies
  2,500 mm from the pad's centre along the direction to the approach point and 3,000 mm across
  it, on either side. The three emitted points are each rounded once, so each figure is tested
  within ``MARGIN``, as a point on a circle is.
- *A chapter stone lies inside a cluster* when its centre, a lattice point, lies inside the disc
  of one of its site's clusters. A candidate lies up to 4.252 m from the cluster's centre
  (5.4.9), so the stone's own disc may pass the cluster's edge.
- *The plaza.* A footprint, an apron and a stone avoid the plaza with its edge path, the disc of
  radius 15 m. A corridor avoids the plaza, the disc of radius 12 m. The edge path's ring is not
  rebuilt as a shape.
- *On a circle.* An emitted point is rounded once, so a point that 5.4 puts on a circle is
  tested to lie within 2 mm of it, the ``MARGIN`` that bounds what rounding moves (5.4.18 (4)):
  a path's head on its pad's edge, the plaza approach's near end on the edge path's outer circle,
  and the approach point 10 m from its pad's centre. Every other test has no tolerance.
- *The return pad* lies inside the plaza (invariant 9), as a polygon inside a polygon.
- *The path's tail* (5.4.10). The path's length less the last cluster's slot arc length is
  between 0 and 10 m: a slot past the path's end is a violation too.
- *The bounding disc* (5.4.8, containment). A site's path vertices, its pad's centre, the ends of
  its approach and its stones' centres lie within the bounding radius less the half width or the
  radius of the shape, compared squared; the blob's vertices lie within the bounding radius.
- *Whole words* (5.4.3). A keyword matches a face's name when the case-folded name holds the
  case-folded keyword with a boundary on each side; a boundary is the string's start or end, or a
  code point whose Unicode general category is a separator (``Z*``) or punctuation (``P*``). A
  letter, a digit, a combining mark, a symbol and a control character are not boundaries.
- *Kit or hero.* A world checked with a lore document is a hero world, with era and regional
  sites; one checked without is a kit world, with set sites. A record's set id is its card's,
  and its plane index is the world document's ``planeIndex`` (invariant 7: the stand stands in
  the world of its plane).
- *Regions* (invariant 11). A stand's centre lies inside the cell of its site's region, a site's
  region is a region of the world document, and an era site's region is its era's in the lore
  document. With invariant 7 this places every card in its keyword's region or its era's.
- *Attachment segments.* A leg's two attachment segments are its polyline's first and last
  segments, or have no length at the leg's end, so testing the polyline tests them (5.4.11).
- *Own shapes.* A stand's footprint, apron and corridor touch one another by construction and are
  never tested against each other. Corridors may cross each other, a pad's edge and a path.
- *Facing* (invariant 9, erratum 5). A stand faces its path vertex when its yaw lies within 0.1
  degree of the direction from its emitted position to that vertex. Both are read as counts of
  thousandths of a degree: the yaw's count is the emitted yaw divided by 1,000, and the
  direction's count is the one that 5.4.18 (7) finds for the vector, by the checker's own binary
  search over the table (``count_of``). The two counts differ by at most 100, the short way round
  the circle. The allocator's yaw is the count nearest the direction from the exact position, and
  rounding the two points moves that direction by less than 0.03 degree, so a laid-out stand
  passes with room.
- *The trail's order* (invariant 10, erratum 5). In leg order, the trail legs end at the era sites
  (a hero world) or the set sites (a kit world) in site order, and the spurs at the regional sites
  in site order, each site once.
- *A chapter stone's cluster* (invariant 11, erratum 5). The cluster that holds a chapter's first
  stand is the lowest cluster index among the chapter's stands; the stone's centre lies inside
  that cluster's disc or the disc of the cluster before it.

**Not asserted.** The acceptance order inside a cluster cannot be read from the files (a
cluster's records are sorted by ``oracle_id``), nor can the kit's props. The crossing angle of two
corridors and a corridor's lying inside its blob are rules of placement (5.4.9, 5.4.10) that
invariant 9 does not list.

**The report.** A violation is one line: the rule's name, then both subjects. Violations come in a
fixed order, so the first line names the first violating pair; the first ``VIOLATION_LIMIT`` are
kept and all are counted. ``assertions`` counts the tests made under each rule. For a rule on
pairs of shapes it counts the pairs whose bounding boxes do not prove them apart, a figure of the
geometry and not of the grid that finds them; a strip is tested segment by segment, and the count
is of segments. A bounding box only ever skips a pair that is provably apart.
"""

from __future__ import annotations

import copy
import struct
import unicodedata
import uuid
from bisect import bisect_left, bisect_right, insort
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from itertools import pairwise
from math import isqrt
from typing import Any, Final

from . import trig
from .constants import (
    APPROACH_LENGTH,
    APRON_DEPTH,
    APRON_WIDTH,
    CAP_MAX,
    CLUSTER_RADIUS,
    CORRIDOR_ARC_WINDOW,
    CORRIDOR_HALF_WIDTH,
    COUNTS_PER_TURN,
    DISC_STEP_COUNTS,
    DISC_VERTICES,
    FOOTPRINT_DEPTH,
    FOOTPRINT_WIDTH,
    GAP_BETWEEN,
    GAP_TO_END,
    GAP_TO_FIRST,
    LATTICE_HALF_PITCH,
    LATTICE_PITCH,
    LATTICE_ROW,
    MARGIN,
    MICRO_PER_COUNT,
    MICRO_PER_TURN,
    MIN_CLUSTER,
    MIN_STAND_SPACING,
    PAD_RADIUS,
    PATH_HALF_WIDTH,
    PLAZA_EDGE_RADIUS,
    PLAZA_RADIUS,
    STONE_ACROSS,
    STONE_ALONG,
    STONE_RADIUS,
)

type Pt = tuple[int, int]
type Box = tuple[int, int, int, int]
"""Least x, least z, greatest x, greatest z, in whole millimetres."""

VIOLATION_LIMIT: Final = 200
"""How many violation lines a result keeps. Every violation is counted."""

RULES: Final = (
    # The files as records (4.13.3, 4.13.5).
    "header",
    "record-count",
    "world-format",
    "stand-count",
    "record-order",
    "record-class",
    "record-yaw",
    "record-site",
    "record-cluster",
    "record-vertex",
    "site-list",
    "pad-list",
    "plaza-figures",
    # Invariant 7.
    "card-plane",
    "card-stand",
    "card-set",
    "card-site",
    # Invariant 9.
    "stand-spacing",
    "footprint-footprint",
    "footprint-apron",
    "apron-apron",
    "footprint-path",
    "apron-path",
    "footprint-corridor",
    "apron-corridor",
    "footprint-pad",
    "apron-pad",
    "footprint-stone",
    "apron-stone",
    "footprint-plaza",
    "apron-plaza",
    "footprint-volume",
    "apron-volume",
    "corridor-stone",
    "corridor-plaza",
    "corridor-volume",
    "corridor-end",
    "pad-head",
    "stone-place",
    "pad-plaza",
    "pad-pad",
    "pad-volume",
    "stone-path",
    "stone-pad",
    "stone-stone",
    "stone-plaza",
    "stone-volume",
    "volume-arrival",
    "volume-path",
    "volume-site",
    "footprint-blob",
    "footprint-cluster",
    "site-bounds",
    "cluster-cap",
    "stand-yaw",
    # Invariant 10.
    "plaza-approach",
    "trail-leg",
    "spur",
    "trail-order",
    "leg-attachment",
    "approach-length",
    "site-reached",
    # Invariant 11.
    "chapter-list",
    "chapter-order",
    "chapter-first",
    "chapter-stone",
    "chapter-cluster",
    "site-region",
    "stand-region",
    # The rulings on DEC-1004 and the gap bounds of 5.4.10.
    "corridor-window",
    "cluster-count",
    "cluster-size",
    "cluster-arcs",
    "gap-first",
    "gap-between",
    "gap-end",
    "path-empty",
)
"""Every rule's name, in the order the checker applies them."""

_SHIFT: Final = trig.SCALE.bit_length() - 1
"""A millimetre is shifted left by this to stand over the trig table's denominator."""
assert 1 << _SHIFT == trig.SCALE

_HEADER: Final = struct.Struct("<4sBBHII")
_RECORD: Final = struct.Struct("<16sBBBBBBHHHiiiHHHH")
_MAGIC: Final = b"ETRN"
_STANDS_KIND: Final = 1
_CONTRACT_VERSION: Final = 4
_COLOUR_BITS: Final = 5
_GOLD: Final = 5
_COLOURLESS: Final = 6

_CELL_SHIFT: Final = 12
"""The hash grid's cell is 2^12 mm, about 4.1 m."""
_WIDE: Final = 1_024
"""A shape over more cells than this is kept apart and offered to every query."""

_OUT: Final = 0
_ON: Final = 1
_IN: Final = 2


def _half(length: int) -> int:
    half, odd = divmod(length, 2)
    if odd:
        raise ValueError(f"{length} mm has no whole half")
    return half


_FOOT_ALONG: Final = _half(FOOTPRINT_DEPTH)
_FOOT_ACROSS: Final = _half(FOOTPRINT_WIDTH)
_APRON_ACROSS: Final = _half(APRON_WIDTH)
_APRON_FRONT: Final = _FOOT_ALONG + APRON_DEPTH
"""From the stand's centre to the apron's front edge, where the corridor starts."""
_FACING_COUNTS: Final = 100
"""0.1 degree in counts of the trig table: how far a stand's yaw may turn from its path vertex
(invariant 9)."""


# The predicates of 5.4.18 (10). Coordinates are integers in any one unit; a half width is in the
# same unit.


def _locate(point: Pt, polygon: Sequence[Pt]) -> int:
    """Where a point lies: outside, on the boundary, or strictly inside (the even-odd rule)."""
    px, pz = point
    ax, az = polygon[-1]
    inside = False
    for bx, bz in polygon:
        if bx == px and bz == pz:
            return _ON
        if (az > pz) != (bz > pz):
            cross = (bx - ax) * (pz - az) - (bz - az) * (px - ax)
            if cross == 0:
                return _ON
            if (cross > 0) == (bz > az):
                inside = not inside
        elif az == pz and bz == pz and (ax <= px <= bx or bx <= px <= ax):
            return _ON
        ax, az = bx, bz
    return _IN if inside else _OUT


def point_in_polygon(point: Pt, polygon: Sequence[Pt]) -> bool:
    """Even-odd, with the boundary counted inside."""
    return _locate(point, polygon) != _OUT


def segments_intersect(a: Pt, b: Pt, c: Pt, d: Pt) -> bool:
    """Whether segments ab and cd share a point, by the signs of exact cross products.

    Touching counts, and so do collinear segments that overlap or meet end to end.
    """
    ax, az = a
    bx, bz = b
    cx, cz = c
    dx, dz = d
    if (
        (ax if ax > bx else bx) < (cx if cx < dx else dx)
        or (cx if cx > dx else dx) < (ax if ax < bx else bx)
        or (az if az > bz else bz) < (cz if cz < dz else dz)
        or (cz if cz > dz else dz) < (az if az < bz else bz)
    ):
        return False
    ex = dx - cx
    ez = dz - cz
    side_a = ex * (az - cz) - ez * (ax - cx)
    side_b = ex * (bz - cz) - ez * (bx - cx)
    if (side_a > 0 and side_b > 0) or (side_a < 0 and side_b < 0):
        return False
    fx = bx - ax
    fz = bz - az
    side_c = fx * (cz - az) - fz * (cx - ax)
    side_d = fx * (dz - az) - fz * (dx - ax)
    # Neither segment lies strictly on one side of the other's line, and their boxes meet: they
    # cross, touch, or are collinear and overlap.
    return not ((side_c > 0 and side_d > 0) or (side_c < 0 and side_d < 0))


def _point_nearer(point: Pt, a: Pt, b: Pt, limit: int) -> bool:
    """Whether a point lies nearer to segment ab than the distance whose square is ``limit``."""
    ax, az = a
    dx = b[0] - ax
    dz = b[1] - az
    wx = point[0] - ax
    wz = point[1] - az
    along = dx * wx + dz * wz
    if along <= 0:
        return wx * wx + wz * wz < limit
    length = dx * dx + dz * dz
    if along >= length:
        ex = point[0] - b[0]
        ez = point[1] - b[1]
        return ex * ex + ez * ez < limit
    across = dx * wz - dz * wx
    return across * across < limit * length


def _segments_nearer(a: Pt, b: Pt, c: Pt, d: Pt, limit: int) -> bool:
    """Whether two segments lie nearer than the distance whose square is ``limit``.

    Their distance is zero when they intersect and otherwise the least of the four distances from
    an end of one to the other.
    """
    if segments_intersect(a, b, c, d):
        return limit > 0
    return (
        _point_nearer(a, c, d, limit)
        or _point_nearer(b, c, d, limit)
        or _point_nearer(c, a, b, limit)
        or _point_nearer(d, a, b, limit)
    )


def _segment_nearer(a: Pt, b: Pt, polygon: Sequence[Pt], limit: int) -> bool:
    """Whether segment ab lies nearer to a filled polygon than the distance squared ``limit``.

    The distance is zero when the segment crosses an edge or has an end inside the polygon, and
    otherwise the least vertex-to-segment distance between the two boundaries (5.4.18 (10)).
    """
    if limit <= 0:
        return False
    ax, az = a
    bx, bz = b
    dx = bx - ax
    dz = bz - az
    length = dx * dx + dz * dz
    if length:
        # The polygon's vertices against the segment. A polygon whose vertices all lie on one
        # side of the segment's line, or all beyond one of its ends, each by the distance or
        # more, is provably that far away, as its convex hull is.
        bound = limit * length
        left = right = before = after = 0
        for vx, vz in polygon:
            wx = vx - ax
            wz = vz - az
            along = dx * wx + dz * wz
            across = dx * wz - dz * wx
            if along <= 0:
                if wx * wx + wz * wz < limit:
                    return True
                if along * along >= bound:
                    before += 1
            elif along >= length:
                ex = vx - bx
                ez = vz - bz
                if ex * ex + ez * ez < limit:
                    return True
                past = along - length
                if past * past >= bound:
                    after += 1
            elif across * across < bound:
                return True
            if across * across >= bound:
                if across > 0:
                    left += 1
                else:
                    right += 1
        count = len(polygon)
        if count in (left, right, before, after):
            return False
    # The segment's ends against the polygon's edges, then the two cases of distance zero.
    p = polygon[-1]
    for q in polygon:
        if _point_nearer(a, p, q, limit) or _point_nearer(b, p, q, limit):
            return True
        p = q
    p = polygon[-1]
    for q in polygon:
        if segments_intersect(a, b, p, q):
            return True
        p = q
    return _locate(a, polygon) != _OUT or _locate(b, polygon) != _OUT


def _segments(polyline: Sequence[Pt]) -> list[tuple[Pt, Pt]]:
    """A polyline's segments. A polyline of one vertex is one segment of no length."""
    if len(polyline) == 1:
        return [(polyline[0], polyline[0])]
    return list(pairwise(polyline))


def _edges(polygon: Sequence[Pt]) -> list[tuple[Pt, Pt]]:
    """A polygon's edges, the closing edge first."""
    return [(polygon[index - 1], polygon[index]) for index in range(len(polygon))]


def polygons_intersect(a: Sequence[tuple[int, int]], b: Sequence[tuple[int, int]]) -> bool:
    """Two filled polygons intersect when an edge crosses an edge or a vertex of one lies inside
    the other, so a polygon nested in another intersects it (5.4.18 (10))."""
    if (
        max(x for x, _ in a) < min(x for x, _ in b)
        or max(x for x, _ in b) < min(x for x, _ in a)
        or max(z for _, z in a) < min(z for _, z in b)
        or max(z for _, z in b) < min(z for _, z in a)
    ):
        return False
    p = a[-1]
    for q in a:
        r = b[-1]
        for s in b:
            if segments_intersect(p, q, r, s):
                return True
            r = s
        p = q
    return any(_locate(point, b) != _OUT for point in a) or any(
        _locate(point, a) != _OUT for point in b
    )


def strip_intersects_polygon(
    polyline: Sequence[tuple[int, int]], half_width: int, polygon: Sequence[tuple[int, int]]
) -> bool:
    """A strip intersects a filled polygon when its polyline's distance to the polygon is below
    the half width. A strip that touches, at exactly the half width, does not (5.4.18 (10))."""
    limit = half_width * half_width
    return any(_segment_nearer(a, b, polygon, limit) for a, b in _segments(polyline))


def strip_inside_polygon(
    polyline: Sequence[tuple[int, int]], half_width: int, polygon: Sequence[tuple[int, int]]
) -> bool:
    """A strip lies inside a polygon when every vertex of its polyline lies inside the polygon
    and every segment lies at least the half width from every edge (5.4.18 (10)).

    No segment can then cross an edge, and the strip's sides stay inside along each segment: a
    polyline that clears a notch while its width enters it is not inside.
    """
    if any(_locate(point, polygon) == _OUT for point in polyline):
        return False
    limit = half_width * half_width
    for a, b in _segments(polyline):
        p = polygon[-1]
        for q in polygon:
            if _segments_nearer(a, b, p, q, limit):
                return False
            p = q
    return True


def _order(first: tuple[int, int], second: tuple[int, int]) -> int:
    """Compare two fractions (numerator, denominator), each denominator above zero."""
    left = first[0] * second[1]
    right = second[0] * first[1]
    return (left > right) - (left < right)


def _cuts(c: Pt, d: Pt, edges: Sequence[tuple[Pt, Pt]]) -> list[tuple[int, int]]:
    """Where segment cd meets the given edges, as fractions of the way from c to d.

    A crossing or a touch is one point. A shared stretch of two collinear segments gives its two
    ends. Each fraction is (numerator, denominator) with the denominator above zero.
    """
    ex = d[0] - c[0]
    ez = d[1] - c[1]
    length = ex * ex + ez * ez
    found: list[tuple[int, int]] = []
    for a, b in edges:
        if not segments_intersect(c, d, a, b):
            continue
        fx = b[0] - a[0]
        fz = b[1] - a[1]
        across = ex * fz - ez * fx
        if across:
            num = (a[0] - c[0]) * fz - (a[1] - c[1]) * fx
            found.append((num, across) if across > 0 else (-num, -across))
        else:
            for px, pz in (a, b):
                along = (px - c[0]) * ex + (pz - c[1]) * ez
                found.append((min(max(along, 0), length), length))
    return found


def polygon_inside_polygon(
    inner: Sequence[tuple[int, int]], outer: Sequence[tuple[int, int]]
) -> bool:
    """The filled polygon ``inner`` lies inside the filled polygon ``outer`` (5.4.18 (10)).

    The rule, with the boundary counted inside: every vertex of the inner polygon lies inside the
    outer polygon; each edge of the inner polygon is cut at every point where it meets the outer
    polygon's boundary (an outer vertex on the edge, a crossing point, the two ends of a shared
    stretch); and the midpoint of each piece lies inside the outer polygon. Each piece either runs
    along the outer boundary, between the two ends of a shared stretch, or meets the boundary at
    its ends at most and so lies wholly inside or wholly outside the outer polygon; in both cases
    its midpoint tells which, the boundary counted inside. The inner boundary then lies in the
    filled outer polygon. When the outer polygon is simple, as a blob, a 72-gon and the plaza are,
    the inner polygon's interior does too: the outside of a simple polygon is connected and
    unbounded, and it meets no point of the inner boundary. An edge that meets the outer boundary
    nowhere lies inside, because its ends do, and an edge of zero length is skipped: its point is
    a vertex, tested already. Exact: the cuts are fractions compared by cross-multiplication, and
    a midpoint is tested against the outer polygon scaled by its denominator.
    """
    if any(_locate(point, outer) == _OUT for point in inner):
        return False
    x0 = min(x for x, _ in inner)
    x1 = max(x for x, _ in inner)
    z0 = min(z for _, z in inner)
    z1 = max(z for _, z in inner)
    # An outer edge wholly to one side of the inner polygon's box meets none of its edges.
    near = [
        (a, b)
        for a, b in _edges(outer)
        if not (
            (a[0] < x0 and b[0] < x0)
            or (a[0] > x1 and b[0] > x1)
            or (a[1] < z0 and b[1] < z0)
            or (a[1] > z1 and b[1] > z1)
        )
    ]
    for c, d in _edges(inner):
        if c == d:
            continue
        cuts = _cuts(c, d, near)
        if not cuts:
            continue
        cuts.extend(((0, 1), (1, 1)))
        cuts.sort(key=cmp_to_key(_order))
        ex = d[0] - c[0]
        ez = d[1] - c[1]
        for first, second in pairwise(cuts):
            if _order(first, second) == 0:
                continue
            num = first[0] * second[1] + second[0] * first[1]
            den = 2 * first[1] * second[1]
            middle = (den * c[0] + num * ex, den * c[1] + num * ez)
            if _locate(middle, [(den * x, den * z) for x, z in outer]) == _OUT:
                return False
    return True


def arc_lengths(polyline: Sequence[tuple[int, int]]) -> list[int]:
    """The integer arc length to each vertex: the sum of ``isqrt`` segment lengths (5.4.18 (5))."""
    arcs = [0]
    for (ax, az), (bx, bz) in pairwise(polyline):
        dx = bx - ax
        dz = bz - az
        arcs.append(arcs[-1] + isqrt(dx * dx + dz * dz))
    return arcs


def _squared(a: Pt, b: Pt) -> int:
    dx = a[0] - b[0]
    dz = a[1] - b[1]
    return dx * dx + dz * dz


def _on_circle(point: Pt, centre: Pt, radius: int) -> bool:
    """Whether a rounded point lies within ``MARGIN`` of a circle (the module's docstring)."""
    apart = _squared(point, centre)
    low = max(radius - MARGIN, 0)
    high = radius + MARGIN
    return low * low <= apart <= high * high


_STONE_AHEAD: Final = STONE_ALONG - PAD_RADIUS
"""From the pad's centre to the site stone's centre along the approach (5.4.8): 2,500 mm."""


def _near_figure(product: int, figure: int, square: int) -> bool:
    """Whether ``product`` / sqrt(``square``) lies within ``MARGIN`` of ``figure``, compared
    squared; ``product`` must not be negative."""
    low = max(figure - MARGIN, 0)
    high = figure + MARGIN
    return product >= 0 and low * low * square <= product * product <= high * high * square


def _beside_approach(stone: Pt, pad: Pt, approach: Pt) -> bool:
    """Whether a site stone stands where 5.4.8 puts it beside its pad's approach (the module's
    docstring): the distance along the approach and across it, each within ``MARGIN``."""
    dx = approach[0] - pad[0]
    dz = approach[1] - pad[1]
    square = dx * dx + dz * dz
    if not square:
        return False
    wx = stone[0] - pad[0]
    wz = stone[1] - pad[1]
    along = wx * dx + wz * dz
    across = abs(dx * wz - dz * wx)
    return _near_figure(along, _STONE_AHEAD, square) and _near_figure(across, STONE_ACROSS, square)


def count_of(vx: int, vz: int, table: trig.TrigTable) -> int:
    """The table count whose direction is nearest the vector (vx, vz) (5.4.18 (7)).

    The vector's quadrant gives a quarter turn of counts. Inside it a binary search finds the last
    count whose direction lies at or clockwise of the vector, by the sign of the exact cross
    product; the vector then lies between that count and the next. Of the two, the nearer is the
    one on the vector's side of their sum, ties to the lower count. The zero vector has no
    direction.
    """
    if vx == 0 and vz == 0:
        raise ValueError("the zero vector has no direction")
    quarter = COUNTS_PER_TURN // 4
    # The quarter turn that holds the vector, its first direction included.
    if vx > 0 and vz >= 0:
        first = 0
    elif vx <= 0 and vz > 0:
        first = quarter
    elif vx < 0 and vz <= 0:
        first = 2 * quarter
    else:
        first = 3 * quarter
    low, high = first, first + quarter - 1
    while low < high:
        middle = (low + high + 1) // 2
        count = middle % COUNTS_PER_TURN
        if table.cos(count) * vz - table.sin(count) * vx >= 0:
            low = middle
        else:
            high = middle - 1
    below = low % COUNTS_PER_TURN
    above = (low + 1) % COUNTS_PER_TURN
    side = (table.cos(below) + table.cos(above)) * vz - (table.sin(below) + table.sin(above)) * vx
    if side > 0:
        return above
    if side < 0:
        return below
    return min(below, above)


def faces(yaw: int, centre: Pt, target: Pt, table: trig.TrigTable) -> bool:
    """Whether a stand at ``centre`` with ``yaw`` faces ``target`` within 0.1 degree (invariant 9).

    The yaw's count and the count of the vector from the centre to the target differ by at most
    ``_FACING_COUNTS``, the short way round the circle. A stand on its target faces nothing.
    """
    vx = target[0] - centre[0]
    vz = target[1] - centre[1]
    if vx == 0 and vz == 0:
        return False
    apart = (divmod(yaw % MICRO_PER_TURN, MICRO_PER_COUNT)[0] - count_of(vx, vz, table)) % (
        COUNTS_PER_TURN
    )
    return min(apart, COUNTS_PER_TURN - apart) <= _FACING_COUNTS


def _scaled(points: Sequence[Pt]) -> tuple[Pt, ...]:
    return tuple((x << _SHIFT, z << _SHIFT) for x, z in points)


def _scaled_square(length: int) -> int:
    """The square of a length in millimetres, over the square of the shapes' denominator."""
    return (length * length) << (2 * _SHIFT)


def _box(points: Sequence[Pt]) -> Box:
    """The whole-millimetre box that holds scaled points: floors below, ceilings above."""
    xs = [x for x, _ in points]
    zs = [z for _, z in points]
    return (
        min(xs) >> _SHIFT,
        min(zs) >> _SHIFT,
        -(-max(xs) >> _SHIFT),
        -(-max(zs) >> _SHIFT),
    )


def _plain_box(points: Sequence[Pt]) -> Box:
    xs = [x for x, _ in points]
    zs = [z for _, z in points]
    return (min(xs), min(zs), max(xs), max(zs))


def _grown(box: Box, by: int) -> Box:
    return (box[0] - by, box[1] - by, box[2] + by, box[3] + by)


def _apart(a: Box, b: Box, gap: int) -> bool:
    """Whether two boxes prove their shapes ``gap`` or more apart: they are along one axis."""
    return a[0] - b[2] >= gap or b[0] - a[2] >= gap or a[1] - b[3] >= gap or b[1] - a[3] >= gap


class _Grid:
    """A uniform hash grid over boxes. A query returns every item whose box may meet the query's.

    It only narrows a search: every pair it offers is tested again on its own boxes and then
    exactly, and a pair it does not offer has boxes in different cells, which are apart.
    """

    __slots__ = ("cells", "wide")

    def __init__(self) -> None:
        self.cells: dict[tuple[int, int], list[int]] = {}
        self.wide: list[int] = []

    def add(self, item: int, box: Box) -> None:
        columns = range(box[0] >> _CELL_SHIFT, (box[2] >> _CELL_SHIFT) + 1)
        rows = range(box[1] >> _CELL_SHIFT, (box[3] >> _CELL_SHIFT) + 1)
        if len(columns) * len(rows) > _WIDE:
            self.wide.append(item)
            return
        for column in columns:
            for row in rows:
                self.cells.setdefault((column, row), []).append(item)

    def near(self, box: Box) -> list[int]:
        """The items whose cells the box touches, in ascending order."""
        columns = range(box[0] >> _CELL_SHIFT, (box[2] >> _CELL_SHIFT) + 1)
        rows = range(box[1] >> _CELL_SHIFT, (box[3] >> _CELL_SHIFT) + 1)
        found: set[int] = set(self.wide)
        if len(columns) * len(rows) > len(self.cells):
            for (column, row), items in self.cells.items():
                if column in columns and row in rows:
                    found.update(items)
        else:
            for column in columns:
                for row in rows:
                    items = self.cells.get((column, row))
                    if items is not None:
                        found.update(items)
        return sorted(found)


def _least_squared(points: Sequence[Pt]) -> int | None:
    """The least squared distance between two of the points, by a sweep along x."""
    if len(points) < 2:
        return None
    order = sorted(points)
    best = _squared(order[0], order[1])
    # The points still within reach along x, as (z, x), sorted.
    active: list[Pt] = []
    oldest = 0
    for position, (x, z) in enumerate(order):
        # A pair nearer than the best so far is nearer than this along each axis.
        reach = isqrt(best) + 1
        while oldest < position and order[oldest][0] < x - reach:
            gone = (order[oldest][1], order[oldest][0])
            del active[bisect_left(active, gone)]
            oldest += 1
        low = bisect_left(active, z - reach, key=lambda item: item[0])
        high = bisect_right(active, z + reach, key=lambda item: item[0])
        for oz, ox in active[low:high]:
            apart = (ox - x) * (ox - x) + (oz - z) * (oz - z)
            if apart < best:
                best = apart
        insort(active, (z, x))
    return best


# The interface.


@dataclass(frozen=True, slots=True)
class CheckedCard:
    """One card of the plane as the checker needs it (5.4.3)."""

    oracle_id: str
    """Canonical UUID text."""
    set_id: int
    """The set id of the first printing."""
    names: tuple[str, ...]
    """Every face's name."""


@dataclass(frozen=True, slots=True)
class CheckResult:
    violations: tuple[str, ...]
    """In the checker's fixed order; at most ``VIOLATION_LIMIT`` are kept."""
    violation_count: int
    """The true total."""
    assertions: dict[str, int]
    """Rule name to the number of tests made under it."""
    figures: dict[str, Any]
    """``minimumStandSpacing`` (mm, or None under two stands), ``connected``, and ``sites``: per
    site its key, its three largest gaps (``toFirst``, ``between``, ``toEnd``) and its
    ``pathLength``."""

    @property
    def ok(self) -> bool:
        return self.violation_count == 0

    def document(self) -> dict[str, Any]:
        """The result as a JSON document: integers, strings, booleans, lists and objects."""
        return {
            "result": "pass" if self.ok else "fail",
            "violationCount": self.violation_count,
            "violations": list(self.violations),
            "assertions": dict(self.assertions),
            "figures": copy.deepcopy(self.figures),
        }


class _Report:
    """The violations found and the tests counted."""

    __slots__ = ("assertions", "kept", "total")

    def __init__(self) -> None:
        self.kept: list[str] = []
        self.total = 0
        self.assertions: dict[str, int] = dict.fromkeys(RULES, 0)

    def tested(self, rule: str, count: int = 1) -> None:
        self.assertions[rule] += count

    def fail(self, rule: str, message: str) -> None:
        self.total += 1
        if len(self.kept) < VIOLATION_LIMIT:
            self.kept.append(f"{rule}: {message}")

    def result(self, figures: dict[str, Any]) -> CheckResult:
        return CheckResult(
            violations=tuple(self.kept),
            violation_count=self.total,
            assertions=dict(self.assertions),
            figures=figures,
        )


# The files, read into records. A document that is not in the emitted form raises here, and
# ``check_world`` reports it as one violation.


@dataclass(frozen=True, slots=True)
class _Record:
    index: int
    """The stand index: the record's position in ``stands.bin``."""
    oracle: bytes
    plane: int
    mask: int
    colour_class: int
    site: int
    set_id: int
    x: int
    z: int
    yaw: int
    cluster: int


@dataclass(frozen=True, slots=True)
class _Cluster:
    centre: Pt
    arc: int
    stands: int


@dataclass(frozen=True, slots=True)
class _Chapter:
    set_id: int
    first_stand: int
    first_cluster: int
    stone: Pt | None


@dataclass(frozen=True, slots=True)
class _Site:
    index: int
    key: str
    kind: str
    region: str | None
    era: str | None
    set_ids: tuple[int, ...]
    centre: Pt
    bounding: int
    blob: tuple[Pt, ...]
    path: tuple[Pt, ...]
    arcs: tuple[int, ...]
    pad: Pt
    approach: Pt
    stone: Pt
    clusters: tuple[_Cluster, ...]
    chapters: tuple[_Chapter, ...]


@dataclass(frozen=True, slots=True)
class _Pad:
    owner: str
    centre: Pt
    radius: int


@dataclass(frozen=True, slots=True)
class _Leg:
    id: int
    kind: str
    start: str
    end: str
    polyline: tuple[Pt, ...]
    start_attachment: tuple[Pt, ...]
    end_attachment: tuple[Pt, ...]


@dataclass(frozen=True, slots=True)
class _World:
    plane_index: int
    stand_count: int
    plaza_radius: int
    plaza_edge: int
    plaza_approach: tuple[Pt, Pt] | None
    pads: tuple[_Pad, ...]
    volumes: tuple[tuple[str, tuple[Pt, ...]], ...]
    regions: tuple[tuple[str | None, tuple[Pt, ...]], ...]
    sites: tuple[_Site, ...]
    legs: tuple[_Leg, ...]
    vertex: tuple[int, ...]
    arc: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class _Era:
    id: str
    region: str
    set_ids: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class _Lore:
    eras: tuple[_Era, ...]
    regions: tuple[str, ...]
    keywords: tuple[tuple[str, str], ...]
    """Word and region, in table order."""


def _whole(value: Any) -> int:
    if type(value) is not int:
        raise ValueError(f"{value!r} is not a whole number")
    return value


def _text(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{value!r} is not a string")
    return value


def _text_or_none(value: Any) -> str | None:
    return None if value is None else _text(value)


def _point(value: Any) -> Pt:
    x, z = value
    return (_whole(x), _whole(z))


def _points(value: Any, least: int, what: str) -> tuple[Pt, ...]:
    found = tuple(_point(item) for item in value)
    if len(found) < least:
        raise ValueError(f"{what} holds {len(found)} points, fewer than {least}")
    return found


def _pose(value: Any) -> Pt:
    return (_whole(value["x"]), _whole(value["z"]))


def _read_site(index: int, row: dict[str, Any]) -> _Site:
    key = _text(row["key"])
    path = _points(row["path"], 1, f"the path of site {key}")
    return _Site(
        index=index,
        key=key,
        kind=_text(row["kind"]),
        region=_text_or_none(row["regionId"]),
        era=_text_or_none(row["eraId"]),
        set_ids=tuple(_whole(item) for item in row["setIds"]),
        centre=_point(row["centre"]),
        bounding=_whole(row["boundingRadius"]),
        blob=_points(row["blob"], 3, f"the blob of site {key}"),
        path=path,
        arcs=tuple(arc_lengths(path)),
        pad=_pose(row["pad"]),
        approach=_point(row["approachPoint"]),
        stone=_pose(row["stone"]),
        clusters=tuple(
            _Cluster(
                centre=_point(item["centre"]),
                arc=_whole(item["arc"]),
                stands=_whole(item["stands"]),
            )
            for item in row["clusters"]
        ),
        chapters=tuple(
            _Chapter(
                set_id=_whole(item["setId"]),
                first_stand=_whole(item["firstStand"]),
                first_cluster=_whole(item["firstCluster"]),
                stone=None if item["stone"] is None else _pose(item["stone"]),
            )
            for item in row["chapters"]
        ),
    )


def _read_leg(row: dict[str, Any]) -> _Leg:
    number = _whole(row["id"])
    return _Leg(
        id=number,
        kind=_text(row["kind"]),
        start=_text(row["from"]),
        end=_text(row["to"]),
        polyline=_points(row["polyline"], 1, f"the polyline of leg {number}"),
        start_attachment=_points(row["startAttachment"], 0, "an attachment"),
        end_attachment=_points(row["endAttachment"], 0, "an attachment"),
    )


def _read_world(world: dict[str, Any]) -> _World:
    plaza = world["plaza"]
    approach = plaza["approach"]
    stands = world["stands"]
    return _World(
        plane_index=_whole(world["planeIndex"]),
        stand_count=_whole(world["standCount"]),
        plaza_radius=_whole(plaza["radius"]),
        plaza_edge=_whole(plaza["edgeRadius"]),
        plaza_approach=(None if approach is None else (_point(approach[0]), _point(approach[1]))),
        pads=tuple(
            _Pad(owner=_text(row["owner"]), centre=_pose(row), radius=_whole(row["radius"]))
            for row in world["pads"]
        ),
        volumes=tuple(
            (
                _text(row["id"]),
                _points(row["polygon"], 3, f"the polygon of hero volume {row['id']}"),
            )
            for row in world["heroVolumes"]
        ),
        regions=tuple(
            (
                _text_or_none(row["id"]),
                _points(row["cell"], 3, f"the cell of region {row['id']}"),
            )
            for row in world["regions"]
        ),
        sites=tuple(_read_site(index, row) for index, row in enumerate(world["sites"])),
        legs=tuple(_read_leg(row) for row in world["trail"]["legs"]),
        vertex=tuple(_whole(item) for item in stands["vertex"]),
        arc=tuple(_whole(item) for item in stands["arc"]),
    )


def _read_lore(lore: dict[str, Any]) -> _Lore:
    return _Lore(
        eras=tuple(
            _Era(
                id=_text(row["id"]),
                region=_text(row["region"]),
                set_ids=tuple(_whole(item) for item in row["setIds"]),
            )
            for row in lore["eras"]
        ),
        regions=tuple(_text(row["id"]) for row in lore["regions"]),
        keywords=tuple((_text(row["word"]), _text(row["region"])) for row in lore["keywords"]),
    )


def _class_of(mask: int) -> int | None:
    """The class a colour identity mask gives (4.13.3), or None when the mask has a stray bit."""
    if mask >> _COLOUR_BITS:
        return None
    if mask == 0:
        return _COLOURLESS
    if mask & (mask - 1):
        return _GOLD
    return mask.bit_length() - 1


def _decode(data: bytes, report: _Report) -> list[_Record] | None:
    """The records of ``stands.bin``, or None when the file cannot be cut into records."""
    report.tested("header")
    if len(data) < _HEADER.size:
        report.fail(
            "header",
            f"stands.bin holds {len(data)} bytes, fewer than its {_HEADER.size}-byte header",
        )
        return None
    magic, kind, version, reserved, count, tail = _HEADER.unpack_from(data)
    if (magic, kind, version, reserved, tail) != (_MAGIC, _STANDS_KIND, _CONTRACT_VERSION, 0, 0):
        report.fail(
            "header",
            f"the header of stands.bin reads magic {magic!r}, kind {kind}, version {version}, "
            f"reserved {reserved} and {tail}; a stands file is {_MAGIC!r}, kind {_STANDS_KIND}, "
            f"version {_CONTRACT_VERSION}, with both reserved fields 0",
        )
    report.tested("record-count")
    body = len(data) - _HEADER.size
    if body != count * _RECORD.size:
        report.fail(
            "record-count",
            f"the header of stands.bin counts {count} records of {_RECORD.size} bytes and the "
            f"file holds {body} bytes after its header",
        )
        return None
    records: list[_Record] = []
    for index in range(count):
        fields = _RECORD.unpack_from(data, _HEADER.size + index * _RECORD.size)
        records.append(
            _Record(
                index=index,
                oracle=fields[0],
                plane=fields[1],
                mask=fields[2],
                colour_class=fields[3],
                site=fields[7],
                set_id=fields[8],
                x=fields[10],
                z=fields[11],
                yaw=fields[12],
                cluster=fields[16],
            )
        )
    return records


# The world as shapes.


@dataclass(frozen=True, slots=True)
class _Stand:
    record: _Record
    index: int
    oracle: str
    name: str
    """How a violation names the stand: its index, site, cluster and oracle id."""
    site: _Site | None
    cluster: int | None
    """The cluster index, when the site has that cluster."""
    vertex: int | None
    """The corridor's vertex on the site's path, when the path has it."""
    centre: Pt
    footprint: tuple[Pt, ...]
    apron: tuple[Pt, ...]
    front: Pt
    """The middle of the apron's front edge, where the corridor starts."""
    end: Pt | None
    """The corridor's end, the path vertex, on the shapes' denominator."""
    box: Box
    """Of the footprint and the apron together."""
    foot_box: Box
    apron_box: Box
    corridor_box: Box | None

    @property
    def parts(self) -> tuple[tuple[str, tuple[Pt, ...], Box], tuple[str, tuple[Pt, ...], Box]]:
        """The footprint and the apron, each with its name and its box."""
        return (
            ("footprint", self.footprint, self.foot_box),
            ("apron", self.apron, self.apron_box),
        )


@dataclass(frozen=True, slots=True)
class _Shape:
    """A polygon on the shapes' denominator, with its name and its box."""

    label: str
    polygon: tuple[Pt, ...]
    box: Box


@dataclass(frozen=True, slots=True)
class _Segment:
    strip: int
    index: int
    a: Pt
    b: Pt
    box: Box


class _Sets:
    """Disjoint sets of the network's points."""

    __slots__ = ("parent",)

    def __init__(self) -> None:
        self.parent: dict[tuple[str, int, int], tuple[str, int, int]] = {}

    def find(self, node: tuple[str, int, int]) -> tuple[str, int, int]:
        parent = self.parent
        root = node
        while True:
            above = parent.setdefault(root, root)
            if above == root:
                break
            root = above
        while node != root:
            node, parent[node] = parent[node], root
        return root

    def join(self, a: tuple[str, int, int], b: tuple[str, int, int]) -> None:
        self.parent[self.find(a)] = self.find(b)


def _splits_words(char: str) -> bool:
    """Whether a code point is a word boundary of 5.4.3: a separator or punctuation."""
    return unicodedata.category(char)[0] in "ZP"


def _holds_word(text: str, word: str) -> bool:
    """Whether case-folded ``text`` holds case-folded ``word`` as a whole word (5.4.3)."""
    if not word:
        return False
    start = text.find(word)
    while start >= 0:
        end = start + len(word)
        if (start == 0 or _splits_words(text[start - 1])) and (
            end == len(text) or _splits_words(text[end])
        ):
            return True
        start = text.find(word, start + 1)
    return False


def selected_keyword(
    names: Sequence[str], keywords: Sequence[tuple[str, str]]
) -> tuple[str, str] | None:
    """A card's selected keyword and its region: the first keyword in table order that any
    face's name holds as a whole word (5.4.3), or None."""
    folded = [name.casefold() for name in names]
    for word, region in keywords:
        sought = word.casefold()
        if any(_holds_word(name, sought) for name in folded):
            return (word, region)
    return None


def stand_shapes(
    x: int, z: int, yaw: int, table: trig.TrigTable
) -> tuple[tuple[Pt, ...], tuple[Pt, ...], Pt]:
    """A stand's footprint, its apron and the start of its corridor, over the table's 2^30.

    The footprint is centred on (x, z) with its depth along the yaw; the apron starts at the
    footprint's front face and runs forward; the corridor starts at the middle of the apron's
    front edge (5.4.1). Both polygons run counter-clockwise from the corner behind and to the
    right of the yaw.
    """
    # 5.4.18 (6): an angle is reduced to one turn and truncated to the table's count.
    count = divmod(yaw % MICRO_PER_TURN, MICRO_PER_COUNT)[0]
    cos = table.cos(count)
    sin = table.sin(count)
    cx = x << _SHIFT
    cz = z << _SHIFT

    def corner(along: int, across: int) -> Pt:
        # The yaw's direction is (cos, sin) and its left normal (-sin, cos).
        return (cx + along * cos - across * sin, cz + along * sin + across * cos)

    footprint = (
        corner(-_FOOT_ALONG, -_FOOT_ACROSS),
        corner(_FOOT_ALONG, -_FOOT_ACROSS),
        corner(_FOOT_ALONG, _FOOT_ACROSS),
        corner(-_FOOT_ALONG, _FOOT_ACROSS),
    )
    apron = (
        corner(_FOOT_ALONG, -_APRON_ACROSS),
        corner(_APRON_FRONT, -_APRON_ACROSS),
        corner(_APRON_FRONT, _APRON_ACROSS),
        corner(_FOOT_ALONG, _APRON_ACROSS),
    )
    return (footprint, apron, corner(_APRON_FRONT, 0))


class _Checker:
    """One world's shapes and the rules over them."""

    def __init__(
        self,
        report: _Report,
        world: _World,
        lore: _Lore | None,
        cards: Sequence[CheckedCard],
        table: trig.TrigTable,
        records: Sequence[_Record],
    ) -> None:
        self.report = report
        self.world = world
        self.lore = lore
        self.cards = cards
        self.table = table
        self.ring: list[Pt] = [
            (table.cos(step * DISC_STEP_COUNTS), table.sin(step * DISC_STEP_COUNTS))
            for step in range(DISC_VERTICES)
        ]
        self.stands: list[_Stand] = [self._stand(record) for record in records]
        self.members: list[list[list[_Stand]]] = [
            [[] for _ in site.clusters] for site in world.sites
        ]
        """Per site and cluster, the stands the records put there."""
        self.residents: list[list[_Stand]] = [[] for _ in world.sites]
        for stand in self.stands:
            if stand.site is not None:
                self.residents[stand.site.index].append(stand)
                if stand.cluster is not None:
                    self.members[stand.site.index][stand.cluster].append(stand)
        self.stand_grid = _Grid()
        self.corridor_grid = _Grid()
        for stand in self.stands:
            self.stand_grid.add(stand.index, stand.box)
            if stand.corridor_box is not None:
                self.corridor_grid.add(stand.index, stand.corridor_box)
        self.strips: list[str] = []
        self.segments: list[_Segment] = []
        self.strip_grid = _Grid()
        for site in world.sites:
            self._strip(f"the path of site {site.key}", site.path)
            self._strip(f"the approach of site {site.key}", (site.pad, site.approach))
        for leg in world.legs:
            self._strip(f"trail leg {leg.id} ({leg.start} to {leg.end})", leg.polyline)
        if world.plaza_approach is not None:
            self._strip("the plaza approach", world.plaza_approach)
        self.blobs: list[tuple[Pt, ...]] = [_scaled(site.blob) for site in world.sites]
        self.cluster_discs: list[list[_Shape]] = [
            [
                self._disc(f"cluster {number} of site {site.key}", cluster.centre, CLUSTER_RADIUS)
                for number, cluster in enumerate(site.clusters)
            ]
            for site in world.sites
        ]
        self.pads: list[_Shape] = [
            self._disc(
                "the return pad" if pad.owner == "return" else f"the pad of site {pad.owner}",
                pad.centre,
                PAD_RADIUS,
            )
            for pad in world.pads[:1]
        ] + [
            self._disc(f"the pad of site {site.key}", site.pad, PAD_RADIUS) for site in world.sites
        ]
        self.stones: list[_Shape] = []
        for site in world.sites:
            self.stones.append(
                self._disc(f"the stone of site {site.key}", site.stone, STONE_RADIUS)
            )
            for chapter in site.chapters:
                if chapter.stone is not None:
                    self.stones.append(
                        self._disc(
                            f"the chapter stone of set id {chapter.set_id} in site {site.key}",
                            chapter.stone,
                            STONE_RADIUS,
                        )
                    )
        self.volumes: list[_Shape] = []
        for name, outline in world.volumes:
            polygon = _scaled(outline)
            self.volumes.append(_Shape(f"hero volume {name}", polygon, _plain_box(outline)))
        self.sites_by_key: dict[str, _Site] = {}
        self.set_sites: dict[int, _Site] = {}
        self.era_sites: dict[str, _Site] = {}
        self.region_sites: dict[str, _Site] = {}
        self.era_of_set: dict[int, _Era] = {}
        self.headed: set[int] = set()
        """The sites whose path begins on its pad's edge."""
        self.connected = False

    def _disc(self, label: str, centre: Pt, radius: int) -> _Shape:
        """The 72-gon of 5.4.18 (13) about an emitted centre."""
        x = centre[0] << _SHIFT
        z = centre[1] << _SHIFT
        polygon = tuple((x + radius * cos, z + radius * sin) for cos, sin in self.ring)
        box = (centre[0] - radius, centre[1] - radius, centre[0] + radius, centre[1] + radius)
        return _Shape(label, polygon, box)

    def _strip(self, label: str, polyline: Sequence[Pt]) -> None:
        strip = len(self.strips)
        self.strips.append(label)
        for index, (a, b) in enumerate(_segments(polyline)):
            box = _plain_box((a, b))
            self.strip_grid.add(len(self.segments), box)
            self.segments.append(
                _Segment(
                    strip=strip,
                    index=index,
                    a=(a[0] << _SHIFT, a[1] << _SHIFT),
                    b=(b[0] << _SHIFT, b[1] << _SHIFT),
                    box=box,
                )
            )

    def _stand(self, record: _Record) -> _Stand:
        world = self.world
        site = world.sites[record.site] if record.site < len(world.sites) else None
        cluster: int | None = None
        vertex: int | None = None
        end: Pt | None = None
        if site is not None:
            if record.cluster < len(site.clusters):
                cluster = record.cluster
            if record.index < len(world.vertex) and 0 <= world.vertex[record.index] < len(
                site.path
            ):
                vertex = world.vertex[record.index]
                px, pz = site.path[vertex]
                end = (px << _SHIFT, pz << _SHIFT)
        footprint, apron, front = stand_shapes(record.x, record.z, record.yaw, self.table)
        oracle = str(uuid.UUID(bytes=record.oracle))
        where = f"site {record.site}, out of range" if site is None else f"site {site.key}"
        return _Stand(
            record=record,
            index=record.index,
            oracle=oracle,
            name=f"stand {record.index} ({where}, cluster {record.cluster}, oracle {oracle})",
            site=site,
            cluster=cluster,
            vertex=vertex,
            centre=(record.x, record.z),
            footprint=footprint,
            apron=apron,
            front=front,
            end=end,
            box=_box(footprint + apron),
            foot_box=_box(footprint),
            apron_box=_box(apron),
            corridor_box=None if end is None else _box((front, end)),
        )

    # The files as records.

    def records(self) -> None:
        report = self.report
        world = self.world
        stands = self.stands
        report.tested("stand-count")
        if not (world.stand_count == len(stands) == len(world.vertex) == len(world.arc)):
            report.fail(
                "stand-count",
                f"stands.bin holds {len(stands)} records; the world file counts "
                f"{world.stand_count} stands and lists {len(world.vertex)} corridor vertices and "
                f"{len(world.arc)} arc lengths",
            )
        before: _Stand | None = None
        for stand in stands:
            record = stand.record
            if before is not None:
                report.tested("record-order")
                earlier = before.record
                if (earlier.site, earlier.cluster, earlier.oracle) > (
                    record.site,
                    record.cluster,
                    record.oracle,
                ):
                    report.fail(
                        "record-order",
                        f"{before.name} stands before {stand.name}; the records are sorted by "
                        "site index, cluster index and oracle id",
                    )
            before = stand
            report.tested("record-class")
            if _class_of(record.mask) != record.colour_class:
                report.fail(
                    "record-class",
                    f"{stand.name} records class {record.colour_class} for the colour identity "
                    f"mask {record.mask}",
                )
            report.tested("record-yaw")
            if not 0 <= record.yaw < MICRO_PER_TURN or record.yaw % MICRO_PER_COUNT:
                report.fail(
                    "record-yaw",
                    f"{stand.name} records the yaw {record.yaw}, which is not a count of the "
                    f"trig table times {MICRO_PER_COUNT} within one turn",
                )
            report.tested("record-site")
            if stand.site is None:
                report.fail(
                    "record-site",
                    f"{stand.name} records site index {record.site}; the world file lists "
                    f"{len(world.sites)} sites",
                )
                continue
            report.tested("record-cluster")
            if stand.cluster is None:
                report.fail(
                    "record-cluster",
                    f"{stand.name} records cluster index {record.cluster}; its site has "
                    f"{len(stand.site.clusters)} clusters",
                )
            report.tested("record-vertex")
            if stand.vertex is None:
                given = world.vertex[stand.index] if stand.index < len(world.vertex) else None
                report.fail(
                    "record-vertex",
                    f"the corridor of {stand.name} ends on vertex {given}; its site's path has "
                    f"{len(stand.site.path)} vertices",
                )

    def lists(self) -> None:
        """The site list and the pad list agree with themselves and with each other."""
        report = self.report
        world = self.world
        kinds = ("set",) if self.lore is None else ("era", "region")
        for site in world.sites:
            report.tested("site-list")
            if site.key in self.sites_by_key:
                report.fail("site-list", f"two sites have the key {site.key}")
            self.sites_by_key.setdefault(site.key, site)
            if site.kind not in kinds:
                law = "kit" if self.lore is None else "hero"
                report.fail(
                    "site-list",
                    f"site {site.key} is of kind {site.kind}; a {law} world has sites of kind "
                    + " and ".join(kinds),
                )
            if site.kind == "set":
                for set_id in site.set_ids:
                    other = self.set_sites.setdefault(set_id, site)
                    if other is not site:
                        report.fail(
                            "site-list",
                            f"sites {other.key} and {site.key} both hold set id {set_id}",
                        )
            elif site.kind == "era" and site.era is not None:
                other = self.era_sites.setdefault(site.era, site)
                if other is not site:
                    report.fail(
                        "site-list", f"sites {other.key} and {site.key} both hold era {site.era}"
                    )
            elif site.kind == "region" and site.region is not None:
                other = self.region_sites.setdefault(site.region, site)
                if other is not site:
                    report.fail(
                        "site-list",
                        f"sites {other.key} and {site.key} are both the regional site of "
                        f"{site.region}",
                    )
            elif site.kind in ("era", "region"):
                report.fail(
                    "site-list", f"site {site.key} of kind {site.kind} names no {site.kind}"
                )
        if self.lore is not None:
            for era in self.lore.eras:
                for set_id in era.set_ids:
                    report.tested("site-list")
                    other_era = self.era_of_set.setdefault(set_id, era)
                    if other_era is not era:
                        report.fail(
                            "site-list",
                            f"eras {other_era.id} and {era.id} of the lore document both hold "
                            f"set id {set_id}",
                        )
        report.tested("pad-list", 1 + len(world.sites))
        expected = [("return", None)] + [(site.key, site.pad) for site in world.sites]
        if len(world.pads) != len(expected):
            report.fail(
                "pad-list",
                f"the world file lists {len(world.pads)} pads; the return pad and one pad a site "
                f"make {len(expected)}",
            )
        for pad, (owner, centre) in zip(world.pads, expected, strict=False):
            if pad.owner != owner or (centre is not None and pad.centre != centre):
                report.fail(
                    "pad-list",
                    f"the pad list holds the pad of {pad.owner} at {pad.centre} where the pad of "
                    f"{owner} stands" + ("" if centre is None else f" at {centre}"),
                )
            if pad.radius != PAD_RADIUS:
                report.fail(
                    "pad-list",
                    f"the pad of {pad.owner} has radius {pad.radius} mm; a pad's is {PAD_RADIUS}",
                )
        report.tested("plaza-figures")
        if (world.plaza_radius, world.plaza_edge) != (PLAZA_RADIUS, PLAZA_EDGE_RADIUS):
            report.fail(
                "plaza-figures",
                f"the plaza is emitted with radius {world.plaza_radius} mm and edge radius "
                f"{world.plaza_edge} mm; the plaza's are {PLAZA_RADIUS} and {PLAZA_EDGE_RADIUS}",
            )
        if world.pads:
            report.tested("pad-plaza")
            plaza = self._disc("the plaza", (0, 0), PLAZA_RADIUS)
            if not polygon_inside_polygon(self.pads[0].polygon, plaza.polygon):
                report.fail("pad-plaza", f"{self.pads[0].label} does not lie inside the plaza")

    # Invariant 7.

    def _assigned(self, card: CheckedCard) -> tuple[_Site | None, str]:
        """The site 5.4.3 assigns a card, and why; or None, and what is missing."""
        name = card.names[0] if card.names else card.oracle_id
        if self.lore is None:
            site = self.set_sites.get(card.set_id)
            if site is None:
                return (None, f"no set site holds set id {card.set_id}, the set of {name}")
            return (site, f"the site of set id {card.set_id}")
        era = self.era_of_set.get(card.set_id)
        if era is None:
            return (
                None,
                f"no era of the lore document holds set id {card.set_id}, the set of {name}",
            )
        keyword = selected_keyword(card.names, self.lore.keywords)
        if keyword is not None and keyword[1] != era.region:
            word, region = keyword
            why = f"keyword {word!r} of region {region}; era {era.id} of region {era.region}"
            site = self.region_sites.get(region)
            if site is None:
                return (None, f"the world has no regional site of {region} for {name} ({why})")
            return (site, why)
        site = self.era_sites.get(era.id)
        if site is None:
            return (None, f"the world has no site of era {era.id} for {name}")
        if keyword is None:
            return (site, f"era {era.id}, no keyword")
        return (site, f"era {era.id}; keyword {keyword[0]!r} is of the era's region")

    def cards_and_sites(self) -> None:
        report = self.report
        plane = self.world.plane_index
        for stand in self.stands:
            report.tested("card-plane")
            if stand.record.plane != plane:
                report.fail(
                    "card-plane",
                    f"{stand.name} records plane index {stand.record.plane}; the world file is "
                    f"the world of plane index {plane}",
                )
        held: dict[str, list[_Stand]] = {}
        for stand in self.stands:
            held.setdefault(stand.oracle, []).append(stand)
        listed: dict[str, CheckedCard] = {}
        for card in self.cards:
            key = card.oracle_id.lower()
            if key in listed:
                continue
            listed[key] = card
            report.tested("card-stand")
            found = held.get(key, [])
            name = card.names[0] if card.names else "no name"
            if not found:
                report.fail("card-stand", f"card {key} ({name}) has no stand")
            elif len(found) > 1:
                report.fail(
                    "card-stand",
                    f"card {key} ({name}) has {len(found)} stands: {found[0].name} and "
                    f"{found[1].name}",
                )
        for stand in self.stands:
            report.tested("card-stand")
            card = listed.get(stand.oracle)
            if card is None:
                report.fail("card-stand", f"{stand.name} holds no card of the plane's card list")
                continue
            name = card.names[0] if card.names else "no name"
            report.tested("card-set")
            if stand.record.set_id != card.set_id:
                report.fail(
                    "card-set",
                    f"{stand.name} records set id {stand.record.set_id}; the first printing of "
                    f"{name} is in set id {card.set_id}",
                )
            report.tested("card-site")
            site, why = self._assigned(card)
            if site is None:
                report.fail("card-site", f"{stand.name}: {why}")
            elif site is not stand.site:
                report.fail(
                    "card-site",
                    f"{stand.name} holds {name}, which 5.4.3 assigns to site {site.key} ({why})",
                )

    # The rules of one site: 5.4.8 containment, the rulings, the gap bounds, invariant 11.

    def sites(self) -> list[dict[str, Any]]:
        figures: list[dict[str, Any]] = []
        cells: dict[str | None, tuple[Pt, ...]] = {}
        for name, cell in self.world.regions:
            cells.setdefault(name, cell)
        eras = {} if self.lore is None else {era.id: era for era in self.lore.eras}
        for site in self.world.sites:
            self._bounds(site)
            self._pad(site)
            figures.append(self._gaps(site))
            self._clusters(site)
            self._chapters(site)
            self._stands_of(site, cells, eras)
        return figures

    def _bounds(self, site: _Site) -> None:
        report = self.report
        key = site.key

        def held(what: str, points: Sequence[Pt], less: int) -> None:
            bound = site.bounding - less
            for index, point in enumerate(points):
                report.tested("site-bounds")
                apart = _squared(point, site.centre)
                if bound < 0 or apart > bound * bound:
                    which = f" (vertex {index})" if len(points) > 1 else ""
                    report.fail(
                        "site-bounds",
                        f"{what} of site {key}{which} at {point} lies {isqrt(apart)} mm from the "
                        f"site's centre; its bounding radius {site.bounding} mm less {less} mm "
                        f"is {bound} mm",
                    )
                    return

        held("the blob", site.blob, 0)
        held("the path", site.path, PATH_HALF_WIDTH)
        held("the pad", (site.pad,), PAD_RADIUS)
        held("the approach point", (site.approach,), PATH_HALF_WIDTH)
        held("the stone", (site.stone,), STONE_RADIUS)
        for chapter in site.chapters:
            if chapter.stone is not None:
                held(
                    f"the chapter stone of set id {chapter.set_id}", (chapter.stone,), STONE_RADIUS
                )

    def _pad(self, site: _Site) -> None:
        report = self.report
        key = site.key
        report.tested("pad-head")
        if _on_circle(site.path[0], site.pad, PAD_RADIUS):
            self.headed.add(site.index)
        else:
            report.fail(
                "pad-head",
                f"the path of site {key} begins at {site.path[0]}, "
                f"{isqrt(_squared(site.path[0], site.pad))} mm from its pad's centre {site.pad}; "
                f"a path begins on its pad's edge, {PAD_RADIUS} mm from the centre",
            )
        report.tested("stone-place")
        if not _beside_approach(site.stone, site.pad, site.approach):
            report.fail(
                "stone-place",
                f"the stone of site {key} at {site.stone} does not stand {_STONE_AHEAD} mm from "
                f"its pad's centre {site.pad} towards its approach point {site.approach} and "
                f"{STONE_ACROSS} mm to one side",
            )
        report.tested("approach-length")
        if not _on_circle(site.approach, site.pad, APPROACH_LENGTH):
            report.fail(
                "approach-length",
                f"the approach point of site {key} at {site.approach} lies "
                f"{isqrt(_squared(site.approach, site.pad))} mm from its pad's centre {site.pad}; "
                f"an approach is {APPROACH_LENGTH} mm long",
            )

    def _gaps(self, site: _Site) -> dict[str, Any]:
        report = self.report
        key = site.key
        length = site.arcs[-1]
        arcs = [cluster.arc for cluster in site.clusters]
        if not self.residents[site.index]:
            report.tested("path-empty")
            if len(site.path) != 2:
                report.fail(
                    "path-empty",
                    f"site {key} has no stand and its path has {len(site.path)} vertices; the "
                    "path of a site with no stand ends at its second vertex",
                )
        if not arcs:
            return {
                "key": key,
                "toFirst": length,
                "between": 0,
                "toEnd": length,
                "pathLength": length,
            }
        report.tested("gap-first")
        if arcs[0] > GAP_TO_FIRST:
            report.fail(
                "gap-first",
                f"the first cluster of site {key} lies {arcs[0]} mm along the path from the "
                f"pad, over {GAP_TO_FIRST} mm",
            )
        between = 0
        for number in range(1, len(arcs)):
            gap = arcs[number] - arcs[number - 1]
            between = max(between, gap)
            report.tested("cluster-arcs")
            if gap <= 0:
                report.fail(
                    "cluster-arcs",
                    f"cluster {number} of site {key} lies at arc length {arcs[number]} mm, not "
                    f"past cluster {number - 1} at {arcs[number - 1]} mm",
                )
            report.tested("gap-between")
            if gap > GAP_BETWEEN:
                report.fail(
                    "gap-between",
                    f"clusters {number - 1} and {number} of site {key} lie {gap} mm apart along "
                    f"the path, over {GAP_BETWEEN} mm",
                )
        to_end = length - arcs[-1]
        report.tested("gap-end")
        if not 0 <= to_end <= GAP_TO_END:
            report.fail(
                "gap-end",
                f"the path of site {key} is {length} mm long and its last cluster lies at "
                f"{arcs[-1]} mm: the tail of {to_end} mm is not within 0 to {GAP_TO_END} mm",
            )
        return {
            "key": key,
            "toFirst": arcs[0],
            "between": between,
            "toEnd": to_end,
            "pathLength": length,
        }

    def _clusters(self, site: _Site) -> None:
        report = self.report
        members = self.members[site.index]
        total = len(self.residents[site.index])
        last = len(members) - 1
        for number, (cluster, held) in enumerate(zip(site.clusters, members, strict=True)):
            report.tested("cluster-count")
            if not held:
                report.fail("cluster-count", f"cluster {number} of site {site.key} holds no stand")
            elif len(held) != cluster.stands:
                report.fail(
                    "cluster-count",
                    f"the world file counts {cluster.stands} stands in cluster {number} of site "
                    f"{site.key} and stands.bin puts {len(held)} there",
                )
            report.tested("cluster-size")
            if len(held) < MIN_CLUSTER and number != last and total >= MIN_CLUSTER:
                report.fail(
                    "cluster-size",
                    f"cluster {number} of site {site.key} holds {len(held)} stands; a cluster "
                    f"under {MIN_CLUSTER} is the site's last or does not exist",
                )
            report.tested("cluster-cap")
            if len(held) > CAP_MAX:
                report.fail(
                    "cluster-cap",
                    f"cluster {number} of site {site.key} holds {len(held)} stands; a cluster "
                    f"holds at most {CAP_MAX}",
                )

    def _chapters(self, site: _Site) -> None:
        report = self.report
        key = site.key
        chapters = site.chapters
        residents = self.residents[site.index]
        if site.kind != "era":
            report.tested("chapter-list")
            if chapters:
                report.fail(
                    "chapter-list",
                    f"site {key} of kind {site.kind} lists {len(chapters)} chapters; only an era "
                    "site has chapters",
                )
            return
        number_of: dict[int, int] = {}
        for number, chapter in enumerate(chapters):
            report.tested("chapter-list")
            if chapter.set_id in number_of:
                report.fail("chapter-list", f"site {key} lists set id {chapter.set_id} twice")
            elif number and chapter.set_id <= chapters[number - 1].set_id:
                report.fail(
                    "chapter-list",
                    f"site {key} lists the chapter of set id {chapter.set_id} after that of set "
                    f"id {chapters[number - 1].set_id}; chapters run in release order",
                )
            if chapter.set_id not in site.set_ids:
                report.fail(
                    "chapter-list",
                    f"site {key} lists a chapter of set id {chapter.set_id}, which is not a set "
                    "of the site",
                )
            number_of.setdefault(chapter.set_id, number)
        held: list[list[_Stand]] = [[] for _ in chapters]
        for stand in residents:
            report.tested("chapter-list")
            number = number_of.get(stand.record.set_id)
            if number is None:
                report.fail(
                    "chapter-list",
                    f"{stand.name} records set id {stand.record.set_id}, which site {key} lists "
                    "no chapter for",
                )
            else:
                held[number].append(stand)
        # By cluster: the largest chapter of a cluster is at most the smallest of the next.
        earlier: tuple[int, _Stand] | None = None
        for members in self.members[site.index]:
            ranked = [
                (number_of[stand.record.set_id], stand)
                for stand in members
                if stand.record.set_id in number_of
            ]
            if not ranked:
                continue
            lowest = min(ranked, key=lambda item: (item[0], item[1].index))
            highest = max(ranked, key=lambda item: (item[0], -item[1].index))
            if earlier is not None:
                report.tested("chapter-order")
                if earlier[0] > lowest[0]:
                    report.fail(
                        "chapter-order",
                        f"{earlier[1].name} holds chapter {earlier[0]} (set id "
                        f"{earlier[1].record.set_id}) and {lowest[1].name}, in a later cluster, "
                        f"holds chapter {lowest[0]} (set id {lowest[1].record.set_id})",
                    )
            earlier = highest
        discs = self.cluster_discs[site.index]
        for number, chapter in enumerate(chapters):
            what = f"the chapter of set id {chapter.set_id} in site {key}"
            report.tested("chapter-list")
            if not held[number]:
                report.fail("chapter-list", f"{what} has no stand; an empty chapter is not listed")
            else:
                report.tested("chapter-first")
                first = min(stand.record.cluster for stand in held[number])
                if chapter.first_cluster != first:
                    report.fail(
                        "chapter-first",
                        f"{what} names cluster {chapter.first_cluster} as its first; its stands "
                        f"begin in cluster {first}",
                    )
                if not any(
                    stand.index == chapter.first_stand and stand.record.cluster == first
                    for stand in held[number]
                ):
                    report.fail(
                        "chapter-first",
                        f"{what} names stand {chapter.first_stand} as its first; that is not a "
                        f"stand of the chapter in cluster {first}",
                    )
            report.tested("chapter-stone")
            stone = chapter.stone
            if number == 0:
                if stone is not None:
                    report.fail("chapter-stone", f"{what}, the site's first, has a chapter stone")
                continue
            if stone is None:
                report.fail("chapter-stone", f"{what} has no chapter stone")
                continue
            row, off_row = divmod(stone[1], LATTICE_ROW)
            if off_row or (stone[0] - LATTICE_HALF_PITCH * row) % LATTICE_PITCH:
                report.fail(
                    "chapter-stone",
                    f"the stone of {what} at {stone} is not a point of the hexagonal lattice",
                )
            centre = (stone[0] << _SHIFT, stone[1] << _SHIFT)
            spot = (stone[0], stone[1], stone[0], stone[1])
            if not any(
                not _apart(disc.box, spot, 1) and point_in_polygon(centre, disc.polygon)
                for disc in discs
            ):
                report.fail(
                    "chapter-stone",
                    f"the stone of {what} at {stone} lies inside no cluster disc of the site",
                )
            if not held[number]:
                continue
            report.tested("chapter-cluster")
            first = min(stand.record.cluster for stand in held[number])
            near = [discs[other] for other in (first - 1, first) if 0 <= other < len(discs)]
            if not any(
                not _apart(disc.box, spot, 1) and point_in_polygon(centre, disc.polygon)
                for disc in near
            ):
                report.fail(
                    "chapter-cluster",
                    f"the stone of {what} at {stone} lies inside neither the disc of cluster "
                    f"{first}, which holds the chapter's first stand, nor the disc of the cluster "
                    "before it",
                )

    def _stands_of(
        self, site: _Site, cells: dict[str | None, tuple[Pt, ...]], eras: dict[str, _Era]
    ) -> None:
        report = self.report
        key = site.key
        report.tested("site-region")
        cell = cells.get(site.region)
        if cell is None:
            report.fail(
                "site-region", f"site {key} names region {site.region}, which the world file lacks"
            )
        elif sum(1 for name, _ in self.world.regions if name == site.region) > 1:
            report.fail("site-region", f"the world file lists region {site.region} twice")
        if self.lore is not None and site.kind == "era":
            era = None if site.era is None else eras.get(site.era)
            if era is None:
                report.fail("site-region", f"site {key} names era {site.era}, which the lore lacks")
            elif era.region != site.region:
                report.fail(
                    "site-region",
                    f"site {key} stands in region {site.region}; its era {era.id} is of region "
                    f"{era.region}",
                )
        blob = self.blobs[site.index]
        discs = self.cluster_discs[site.index]
        for stand in self.residents[site.index]:
            index = stand.index
            if stand.vertex is not None:
                report.tested("corridor-end")
                arc = self.world.arc[index] if index < len(self.world.arc) else None
                if arc != site.arcs[stand.vertex]:
                    report.fail(
                        "corridor-end",
                        f"the corridor of {stand.name} ends on vertex {stand.vertex} of its "
                        f"site's path, at arc length {site.arcs[stand.vertex]} mm; the world "
                        f"file gives {arc} mm",
                    )
                if arc is not None and stand.cluster is not None:
                    report.tested("corridor-window")
                    slot = site.clusters[stand.cluster].arc
                    if not -CORRIDOR_ARC_WINDOW <= arc - slot <= CORRIDOR_ARC_WINDOW:
                        report.fail(
                            "corridor-window",
                            f"the corridor of {stand.name} ends at arc length {arc} mm and its "
                            f"cluster's slot lies at {slot} mm, over {CORRIDOR_ARC_WINDOW} mm away",
                        )
                report.tested("stand-yaw")
                target = site.path[stand.vertex]
                if not faces(stand.record.yaw, stand.centre, target, self.table):
                    report.fail(
                        "stand-yaw",
                        f"{stand.name} at {stand.centre} has the yaw {stand.record.yaw} and does "
                        f"not face its path vertex {stand.vertex} at {target} within "
                        f"{_FACING_COUNTS * MICRO_PER_COUNT} micro-degrees",
                    )
            report.tested("footprint-blob")
            if not polygon_inside_polygon(stand.footprint, blob):
                report.fail(
                    "footprint-blob",
                    f"the footprint of {stand.name} does not lie inside the blob of site {key}",
                )
            if stand.cluster is not None:
                report.tested("footprint-cluster")
                disc = discs[stand.cluster]
                if _apart(stand.foot_box, disc.box, 1) or not polygon_inside_polygon(
                    stand.footprint, disc.polygon
                ):
                    report.fail(
                        "footprint-cluster",
                        f"the footprint of {stand.name} does not lie inside the disc of its "
                        f"cluster, centred at {site.clusters[stand.cluster].centre}",
                    )
            if cell is not None:
                report.tested("stand-region")
                if not point_in_polygon(stand.centre, cell):
                    report.fail(
                        "stand-region",
                        f"{stand.name} at {stand.centre} does not stand inside the cell of "
                        f"region {site.region}",
                    )

    # Invariant 9: the exclusions by geometry type.

    def stands_against_stands(self) -> None:
        report = self.report
        stands = self.stands
        least = MIN_STAND_SPACING * MIN_STAND_SPACING
        for stand in stands:
            x, z = stand.centre
            box = stand.box
            reach = (
                min(box[0], x - MIN_STAND_SPACING),
                min(box[1], z - MIN_STAND_SPACING),
                max(box[2], x + MIN_STAND_SPACING),
                max(box[3], z + MIN_STAND_SPACING),
            )
            for number in self.stand_grid.near(reach):
                if number <= stand.index:
                    continue
                other = stands[number]
                dx = other.centre[0] - x
                dz = other.centre[1] - z
                if -MIN_STAND_SPACING < dx < MIN_STAND_SPACING and (
                    -MIN_STAND_SPACING < dz < MIN_STAND_SPACING
                ):
                    report.tested("stand-spacing")
                    apart = dx * dx + dz * dz
                    if apart < least:
                        report.fail(
                            "stand-spacing",
                            f"{stand.name} and {other.name} stand {isqrt(apart)} mm apart, under "
                            f"{MIN_STAND_SPACING} mm",
                        )
                if _apart(box, other.box, 1):
                    continue
                for part, polygon, part_box in stand.parts:
                    for other_part, other_polygon, other_box in other.parts:
                        if _apart(part_box, other_box, 1):
                            continue
                        rule = f"{part}-{part}" if part == other_part else "footprint-apron"
                        report.tested(rule)
                        if polygons_intersect(polygon, other_polygon):
                            report.fail(
                                rule,
                                f"the {part} of {stand.name} intersects the {other_part} of "
                                f"{other.name}",
                            )

    def stands_against_strips(self) -> None:
        report = self.report
        segments = self.segments
        limit = _scaled_square(PATH_HALF_WIDTH)
        for stand in self.stands:
            parts = stand.parts
            met: set[tuple[str, int]] = set()
            for number in self.strip_grid.near(_grown(stand.box, PATH_HALF_WIDTH)):
                segment = segments[number]
                for part, polygon, box in parts:
                    if (part, segment.strip) in met or _apart(box, segment.box, PATH_HALF_WIDTH):
                        continue
                    rule = f"{part}-path"
                    report.tested(rule)
                    if _segment_nearer(segment.a, segment.b, polygon, limit):
                        met.add((part, segment.strip))
                        report.fail(
                            rule,
                            f"the {part} of {stand.name} intersects {self.strips[segment.strip]} "
                            f"at segment {segment.index}",
                        )

    def corridors_against_stands(self) -> None:
        report = self.report
        stands = self.stands
        limit = _scaled_square(CORRIDOR_HALF_WIDTH)
        for stand in stands:
            end = stand.end
            box = stand.corridor_box
            if end is None or box is None:
                continue
            for number in self.stand_grid.near(_grown(box, CORRIDOR_HALF_WIDTH)):
                if number == stand.index:
                    continue
                other = stands[number]
                for part, polygon, part_box in other.parts:
                    if _apart(part_box, box, CORRIDOR_HALF_WIDTH):
                        continue
                    rule = f"{part}-corridor"
                    report.tested(rule)
                    if _segment_nearer(stand.front, end, polygon, limit):
                        report.fail(
                            rule,
                            f"the {part} of {other.name} intersects the corridor of {stand.name}",
                        )

    def _against_stands(self, kind: str, shape: _Shape) -> None:
        """A pad, a stone, the plaza or a hero volume against every footprint and apron."""
        report = self.report
        for number in self.stand_grid.near(shape.box):
            stand = self.stands[number]
            for part, polygon, box in stand.parts:
                if _apart(box, shape.box, 1):
                    continue
                rule = f"{part}-{kind}"
                report.tested(rule)
                if polygons_intersect(polygon, shape.polygon):
                    report.fail(rule, f"the {part} of {stand.name} intersects {shape.label}")

    def _against_corridors(self, kind: str, shape: _Shape) -> None:
        """A stone, the plaza or a hero volume against every corridor."""
        report = self.report
        rule = f"corridor-{kind}"
        limit = _scaled_square(CORRIDOR_HALF_WIDTH)
        for number in self.corridor_grid.near(_grown(shape.box, CORRIDOR_HALF_WIDTH)):
            stand = self.stands[number]
            if stand.end is None or stand.corridor_box is None:
                continue
            if _apart(stand.corridor_box, shape.box, CORRIDOR_HALF_WIDTH):
                continue
            report.tested(rule)
            if _segment_nearer(stand.front, stand.end, shape.polygon, limit):
                report.fail(rule, f"the corridor of {stand.name} intersects {shape.label}")

    def _against_strips(self, rule: str, shape: _Shape) -> None:
        """A stone or a hero volume against every path, approach and leg."""
        report = self.report
        limit = _scaled_square(PATH_HALF_WIDTH)
        met: set[int] = set()
        for number in self.strip_grid.near(_grown(shape.box, PATH_HALF_WIDTH)):
            segment = self.segments[number]
            if segment.strip in met or _apart(segment.box, shape.box, PATH_HALF_WIDTH):
                continue
            report.tested(rule)
            if _segment_nearer(segment.a, segment.b, shape.polygon, limit):
                met.add(segment.strip)
                report.fail(
                    rule,
                    f"{shape.label} intersects {self.strips[segment.strip]} at segment "
                    f"{segment.index}",
                )

    def _pairs(self, rule: str, first: Sequence[_Shape], second: Sequence[_Shape] | None) -> None:
        """Every pair of two lists of shapes, or every pair within one list."""
        report = self.report
        for position, shape in enumerate(first):
            others = first[position + 1 :] if second is None else second
            for other in others:
                if _apart(shape.box, other.box, 1):
                    continue
                report.tested(rule)
                if polygons_intersect(shape.polygon, other.polygon):
                    report.fail(rule, f"{shape.label} intersects {other.label}")

    def pads_stones_plaza_volumes(self) -> None:
        report = self.report
        plaza = self._disc("the plaza", (0, 0), PLAZA_RADIUS)
        edged = self._disc("the plaza with its edge path", (0, 0), PLAZA_EDGE_RADIUS)
        for pad in self.pads:
            self._against_stands("pad", pad)
        self._pairs("pad-pad", self.pads, None)
        for stone in self.stones:
            self._against_stands("stone", stone)
            self._against_corridors("stone", stone)
            self._against_strips("stone-path", stone)
        self._pairs("stone-pad", self.stones, self.pads)
        self._pairs("stone-stone", self.stones, None)
        self._pairs("stone-plaza", self.stones, [edged])
        self._against_stands("plaza", edged)
        self._against_corridors("plaza", plaza)
        bounds = [
            self._disc(f"the bounding disc of site {site.key}", site.centre, site.bounding)
            for site in self.world.sites
        ]
        for volume in self.volumes:
            report.tested("volume-arrival")
            if point_in_polygon((0, 0), volume.polygon):
                report.fail("volume-arrival", f"{volume.label} holds the arrival point")
            self._against_stands("volume", volume)
            self._against_corridors("volume", volume)
            self._against_strips("volume-path", volume)
        self._pairs("pad-volume", self.pads, self.volumes)
        self._pairs("stone-volume", self.stones, self.volumes)
        self._pairs("volume-site", self.volumes, bounds)

    # Invariant 10: the path network.

    def network(self) -> None:
        report = self.report
        world = self.world
        sets = _Sets()
        plaza = ("plaza", 0, 0)

        def at(point: Pt) -> tuple[str, int, int]:
            return ("point", point[0], point[1])

        approach = world.plaza_approach
        if world.sites or approach is not None:
            report.tested("plaza-approach")
            if approach is None:
                report.fail("plaza-approach", "the world has sites and no plaza approach")
            else:
                sets.join(at(approach[0]), at(approach[1]))
                if _on_circle(approach[0], (0, 0), PLAZA_EDGE_RADIUS):
                    sets.join(plaza, at(approach[0]))
                else:
                    report.fail(
                        "plaza-approach",
                        f"the plaza approach starts at {approach[0]}, "
                        f"{isqrt(_squared(approach[0], (0, 0)))} mm from the origin; the edge "
                        f"path's outer circle has radius {PLAZA_EDGE_RADIUS} mm",
                    )
        before: Pt | None = None if approach is None else approach[1]
        before_name = "the far end of the plaza approach"
        before_key = "plaza"
        seen: set[Pt] = set()
        # The sites each kind of leg visits, in site order (invariant 10).
        visits = {
            "trail": [site for site in world.sites if site.kind in ("era", "set")],
            "spur": [site for site in world.sites if site.kind == "region"],
        }
        visited = {"trail": 0, "spur": 0}
        for leg in world.legs:
            name = f"leg {leg.id} ({leg.kind}, {leg.start} to {leg.end})"
            first = leg.polyline[0]
            last = leg.polyline[-1]
            for a, b in _segments(leg.polyline):
                sets.join(at(a), at(b))
            site = self.sites_by_key.get(leg.end)
            if leg.kind in visits:
                report.tested("trail-order")
                order = visited[leg.kind]
                targets = visits[leg.kind]
                visited[leg.kind] = order + 1
                if order >= len(targets):
                    report.fail(
                        "trail-order",
                        f"{name} is {leg.kind} {order + 1}, and the world has "
                        f"{len(targets)} sites for its {leg.kind}s to visit",
                    )
                elif leg.end != targets[order].key:
                    report.fail(
                        "trail-order",
                        f"{name} ends at {leg.end}; {leg.kind} {order + 1} visits "
                        f"{targets[order].key}, the next such site in site order",
                    )
            if leg.kind == "trail":
                report.tested("trail-leg")
                if leg.start != before_key:
                    report.fail(
                        "trail-leg", f"{name} is said to start from {leg.start}, not {before_key}"
                    )
                if first != before:
                    report.fail(
                        "trail-leg", f"{name} starts at {first}, not at {before_name} {before}"
                    )
                if site is None:
                    report.fail("trail-leg", f"{name} ends at a site the world file lacks")
                else:
                    if last != site.approach:
                        report.fail(
                            "trail-leg",
                            f"{name} ends at {last}, not at the approach point {site.approach} "
                            f"of site {site.key}",
                        )
                    before = site.approach
                    before_name = f"the approach point of site {site.key}"
                    before_key = site.key
            elif leg.kind == "spur":
                report.tested("spur")
                if first not in seen:
                    report.fail("spur", f"{name} starts at {first}, a vertex of no earlier leg")
                if site is None:
                    report.fail("spur", f"{name} ends at a site the world file lacks")
                elif last != site.approach:
                    report.fail(
                        "spur",
                        f"{name} ends at {last}, not at the approach point {site.approach} of "
                        f"site {site.key}",
                    )
            else:
                report.tested("trail-leg")
                report.fail("trail-leg", f"{name} is neither a trail leg nor a spur")
            report.tested("leg-attachment", 2)
            starts = [leg.polyline[:2], (first, first)]
            ends = [leg.polyline[-2:], (last, last)]
            if leg.start_attachment not in starts:
                report.fail(
                    "leg-attachment",
                    f"the start attachment of {name}, {list(leg.start_attachment)}, is not the "
                    "polyline's first segment",
                )
            if leg.end_attachment not in ends:
                report.fail(
                    "leg-attachment",
                    f"the end attachment of {name}, {list(leg.end_attachment)}, is not the "
                    "polyline's last segment",
                )
            seen.update(leg.polyline)
        report.tested("trail-order")
        for kind, what in (("trail", "era or set sites"), ("spur", "regional sites")):
            if visited[kind] < len(visits[kind]):
                report.fail(
                    "trail-order",
                    f"the trail's {kind}s visit {visited[kind]} of the world's "
                    f"{len(visits[kind])} {what}; the first not visited is "
                    f"{visits[kind][visited[kind]].key}",
                )
        reached = True
        for site in world.sites:
            pad = ("pad", site.index, 0)
            head = ("head", site.index, 0)
            sets.join(at(site.approach), pad)
            if site.index in self.headed:
                sets.join(pad, head)
            report.tested("site-reached")
            if sets.find(at(site.approach)) != sets.find(plaza):
                reached = False
                report.fail(
                    "site-reached",
                    f"no leg joins the approach point {site.approach} of site {site.key} to the "
                    "plaza's edge path",
                )
            elif sets.find(head) != sets.find(plaza):
                reached = False
                report.fail(
                    "site-reached",
                    f"the path of site {site.key} does not begin at its pad, so the trail does "
                    "not reach it",
                )
        self.connected = reached and all(stand.end is not None for stand in self.stands)


def _no_figures() -> dict[str, Any]:
    return {"minimumStandSpacing": None, "connected": False, "sites": []}


def check_world(
    stands_bin: bytes,
    world: dict[str, Any],
    lore: dict[str, Any] | None,
    cards: Sequence[CheckedCard],
    table: trig.TrigTable,
) -> CheckResult:
    """Check one world's emitted files against invariants 7 to 11 of PRD v4 3.2.

    ``lore`` is None on a kit world. ``cards`` is the plane's card list, from the pack and not
    from the allocator. The result holds every violation's count and the first of them in a
    fixed order.
    """
    report = _Report()
    records = _decode(stands_bin, report)
    if records is None:
        return report.result(_no_figures())
    report.tested("world-format")
    try:
        read = _read_world(world)
        tables = None if lore is None else _read_lore(lore)
    except (KeyError, IndexError, TypeError, ValueError) as error:
        report.fail(
            "world-format",
            "the world or lore document is not in the emitted form: "
            f"{type(error).__name__}: {error}",
        )
        return report.result(_no_figures())
    checker = _Checker(report, read, tables, cards, table, records)
    checker.records()
    checker.lists()
    checker.cards_and_sites()
    sites = checker.sites()
    checker.stands_against_stands()
    checker.stands_against_strips()
    checker.corridors_against_stands()
    checker.pads_stones_plaza_volumes()
    checker.network()
    least = _least_squared([stand.centre for stand in checker.stands])
    return report.result(
        {
            "minimumStandSpacing": None if least is None else isqrt(least),
            "connected": checker.connected,
            "sites": sites,
        }
    )


# The predicate fixtures of 5.4.14.

STRIP_INSIDE_POLYGON: Final = "strip-inside-polygon"
POLYGONS_INTERSECT: Final = "polygons-intersect"
POLYGON_INSIDE_POLYGON: Final = "polygon-inside-polygon"


def _crossings(first: Sequence[tuple[Pt, Pt]], second: Sequence[tuple[Pt, Pt]]) -> int:
    return sum(1 for a, b in first for c, d in second if segments_intersect(a, b, c, d))


def check_predicates(document: dict[str, Any]) -> list[str]:
    """What a predicate fixture states that this module's predicates find otherwise.

    A fixture is one object: ``predicate`` names the rule; ``polyline``, ``halfWidth`` and
    ``polygon`` (a strip in a polygon) or ``outer`` and ``inner`` (two polygons) are the shapes,
    in whole millimetres; ``verticesInside`` (every vertex of the polyline or of the inner polygon
    lies inside the other shape) and ``edgeCrossings`` (the pairs of edges that share a point,
    touching included) are the two facts that make it a trap; ``expected`` is the predicate's
    verdict. The list is empty when all three hold.
    """
    try:
        predicate = document["predicate"]
        if predicate == STRIP_INSIDE_POLYGON:
            polyline = _points(document["polyline"], 1, "the polyline")
            polygon = _points(document["polygon"], 3, "the polygon")
            inside = all(point_in_polygon(point, polygon) for point in polyline)
            crossings = _crossings(_segments(polyline), _edges(polygon))
            verdict = strip_inside_polygon(polyline, _whole(document["halfWidth"]), polygon)
        elif predicate == POLYGONS_INTERSECT:
            outer = _points(document["outer"], 3, "the outer polygon")
            inner = _points(document["inner"], 3, "the inner polygon")
            inside = all(point_in_polygon(point, outer) for point in inner)
            crossings = _crossings(_edges(outer), _edges(inner))
            verdict = polygons_intersect(outer, inner)
        elif predicate == POLYGON_INSIDE_POLYGON:
            outer = _points(document["outer"], 3, "the outer polygon")
            inner = _points(document["inner"], 3, "the inner polygon")
            inside = all(point_in_polygon(point, outer) for point in inner)
            crossings = _crossings(_edges(outer), _edges(inner))
            verdict = polygon_inside_polygon(inner, outer)
        else:
            return [f"the predicate {predicate!r} is not one this checker has"]
        stated = (document["verticesInside"], document["edgeCrossings"], document["expected"])
    except (KeyError, IndexError, TypeError, ValueError) as error:
        return [f"the fixture is not in the form of a predicate fixture: {error!r}"]
    found: list[str] = []
    if stated[0] is not inside:
        found.append(f"verticesInside is stated {stated[0]!r} and is {inside!r}")
    if type(stated[1]) is not int or stated[1] != crossings:
        found.append(f"edgeCrossings is stated {stated[1]!r} and is {crossings}")
    if stated[2] is not verdict:
        found.append(f"{predicate} is expected {stated[2]!r} and is {verdict!r}")
    return found
