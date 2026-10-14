"""The routing grid, the plaza approach and the trail's legs (PRD v4 5.4.11).

A leg is routed by A* on the 5 m grid between two attachment cells, smoothed once, joined to its
two anchor points by attachment segments, wobbled between them and rounded. A cell is blocked
when its square is less than 5 m (plus the 2 mm margin) from the outside of the world polygon,
from a hero volume, from the plaza with its edge path or from a site's blob.

**What the code defines where 5.4.11 leaves a choice** (5.4.18 (12)):

- A cell is **near** a blob, and costs double to enter, when its centre is less than 10 m from
  the blob as a filled shape.
- A move costs 5 (straight) or 7 (diagonal), doubled when the cell it enters is near a blob. The
  eight neighbours are tried in row order, then column order.
- A diagonal move needs both orthogonal neighbours free.
- The two attachment cells of a leg are never treated as blocked on that leg. A site's cell and
  the plaza approach's cell are free by construction; a spur starts at a vertex of the wobbled
  trail, and that vertex can lie in a blocked cell.
- Smoothing tests the closed squares of the cells that the straight segment touches. It is one
  pass from the start: a vertex is tested against the vertex kept before it and the vertex after
  it, and when it goes the next vertex is tested against the same kept vertex.
- A vertex of a leg that equals the vertex before it is dropped, so an attachment segment whose
  anchor point is its cell's centre has no length.
- Every leg is checked when it is reserved (:func:`meets`; the CEO's ruling 3 of 2026-10-14 on
  DEC-1004): its strip, attachment segments included, after the wobble and the rounding, with
  the 2 mm margin, against the hero volumes, then every site's pad, stone and blob in site order.
  Invariant 9 keeps a path from a stone and from a hero volume; the pad and the blob are tested
  because a leg that passes a site can meet its pad (law note 15), and a spur that starts in a
  blocked cell can meet a blob (law note 20). A leg that fails the check has no route, and the
  world is short. Other legs, the approaches and the site paths are not tested: a path may cross
  a path (invariant 9).
- A spur starts at the vertex of the legs reserved so far that is nearest the regional site's
  approach point: by squared distance, then by leg, then by vertex.
- The plaza approach runs from the rounded point 15 m from the origin to the rounded point 25 m
  from it, along one table direction.

A site's blob does not move against the grid when the site moves: centres lie on the 10 m lattice
and the grid's pitch is 5 m (5.4.8). So a blob's blocked cells and near cells are computed in the
site's frame and kept with its local geometry.
"""

from __future__ import annotations

import heapq
import itertools
from collections.abc import Sequence
from dataclasses import dataclass
from math import isqrt

from .constants import (
    COUNTS_PER_TURN,
    DIAGONAL_COST,
    GRID_PITCH,
    MARGIN,
    MICRO_PER_COUNT,
    MICRO_PER_TURN,
    NEAR_BLOB,
    OBSTACLE_EXPANSION,
    PATH_HALF_WIDTH,
    PLAZA_APPROACH_END,
    PLAZA_APPROACH_STEP,
    PLAZA_APPROACH_TRIES,
    PLAZA_EDGE_RADIUS,
    SAMPLE_STEP,
    STRAIGHT_COST,
    TRAIL_TAPER,
    TRAIL_WAVELENGTH,
    TRAIL_WOBBLE,
)
from .exact import (
    SCALE,
    Directions,
    Prng,
    Pt,
    ceil_div,
    cell_centre,
    cell_square,
    grid_cell,
    round_half_away,
)
from .geometry import SegmentIndex, Shape, boxes_apart, clear, inside, polygon, strip
from .local import Local

type Cell = tuple[int, int]

_HALF_DIAGONAL = 3_536
"""A cell's centre is at most 3,536 mm from any point of its square."""

_NEIGHBOURS: tuple[tuple[int, int, int], ...] = (
    (-1, -1, DIAGONAL_COST),
    (-1, 0, STRAIGHT_COST),
    (-1, 1, DIAGONAL_COST),
    (0, -1, STRAIGHT_COST),
    (0, 1, STRAIGHT_COST),
    (1, -1, DIAGONAL_COST),
    (1, 0, STRAIGHT_COST),
    (1, 1, DIAGONAL_COST),
)


def _inner(radius: int) -> int:
    return 999 * radius // 1000


def _outer(radius: int) -> int:
    return ceil_div(1001 * radius, 1000)


class Obstacles:
    """The blocked cells and the near cells of one pass, found when a route asks for them."""

    __slots__ = (
        "_blocked",
        "_near",
        "_world_cells",
        "limit",
        "plaza",
        "radius",
        "sites",
        "volumes",
        "world",
    )

    def __init__(
        self,
        radius: int,
        world: Shape,
        plaza: Shape,
        volumes: Sequence[Shape],
        sites: Sequence[tuple[Local, Pt]],
        world_cells: dict[Cell, bool],
    ) -> None:
        self.radius = radius
        self.world = world
        self.plaza = plaza
        self.volumes = tuple(volumes)
        self.sites = tuple(sites)
        self.limit = ceil_div(radius, GRID_PITCH) + 1
        self._world_cells = world_cells
        """Cells outside the world's 5 m inset, kept by the caller for as long as R holds."""
        self._blocked: dict[Cell, bool] = {}
        self._near: dict[Cell, bool] = {}

    def blocked(self, row: int, col: int) -> bool:
        key = (row, col)
        found = self._blocked.get(key)
        if found is None:
            found = (
                self._off_world(row, col)
                or self._on_plaza(row, col)
                or self._on_volume(row, col)
                or self._on_blob(row, col)
            )
            self._blocked[key] = found
        return found

    def near(self, row: int, col: int) -> bool:
        key = (row, col)
        found = self._near.get(key)
        if found is None:
            found = self._near_blob(row, col)
            self._near[key] = found
        return found

    def _off_world(self, row: int, col: int) -> bool:
        if abs(row) > self.limit or abs(col) > self.limit:
            return True
        key = (row, col)
        found = self._world_cells.get(key)
        if found is None:
            spacing = OBSTACLE_EXPANSION + MARGIN
            corners = cell_square(row, col)
            farthest = max(x * x + z * z for x, z in corners)
            if _inner(self.radius) > spacing and farthest <= (_inner(self.radius) - spacing) ** 2:
                found = False
            elif farthest > max(0, _outer(self.radius) - spacing) ** 2:
                found = True
            else:
                found = not inside(polygon(corners), self.world, spacing)
            self._world_cells[key] = found
        return found

    def _on_plaza(self, row: int, col: int) -> bool:
        spacing = OBSTACLE_EXPANSION + MARGIN
        x0, z0 = GRID_PITCH * col, GRID_PITCH * row
        nx = min(max(0, x0), x0 + GRID_PITCH)
        nz = min(max(0, z0), z0 + GRID_PITCH)
        nearest = nx * nx + nz * nz
        if nearest >= (spacing + _outer(PLAZA_EDGE_RADIUS)) ** 2:
            return False
        if nearest < (spacing + _inner(PLAZA_EDGE_RADIUS)) ** 2:
            return True
        return not clear(polygon(cell_square(row, col)), self.plaza, spacing)

    def _on_volume(self, row: int, col: int) -> bool:
        if not self.volumes:
            return False
        spacing = OBSTACLE_EXPANSION + MARGIN
        square = polygon(cell_square(row, col))
        return any(
            not boxes_apart(square.box, volume.box, spacing + 1)
            and not clear(square, volume, spacing)
            for volume in self.volumes
        )

    def _on_blob(self, row: int, col: int) -> bool:
        spacing = OBSTACLE_EXPANSION + MARGIN
        cx, cz = cell_centre(row, col)
        for local, (sx, sz) in self.sites:
            reach = _outer(ceil_div(6 * local.radius, 5)) + spacing + _HALF_DIAGONAL + 1
            dx, dz = cx - sx, cz - sz
            if dx * dx + dz * dz >= reach * reach:
                continue
            key = (row - sz // GRID_PITCH, col - sx // GRID_PITCH)
            found = local.blocked_cells.get(key)
            if found is None:
                found = not clear(polygon(cell_square(*key)), local.blob, spacing)
                local.blocked_cells[key] = found
            if found:
                return True
        return False

    def _near_blob(self, row: int, col: int) -> bool:
        cx, cz = cell_centre(row, col)
        for local, (sx, sz) in self.sites:
            reach = _outer(ceil_div(6 * local.radius, 5)) + NEAR_BLOB + 1
            dx, dz = cx - sx, cz - sz
            if dx * dx + dz * dz >= reach * reach:
                continue
            key = (row - sz // GRID_PITCH, col - sx // GRID_PITCH)
            found = local.near_cells.get(key)
            if found is None:
                point = Shape([cell_centre(*key)], 1, closed=False)
                found = not clear(local.blob, point, NEAR_BLOB)
                local.near_cells[key] = found
            if found:
                return True
        return False


def route(obstacles: Obstacles, start: Cell, goal: Cell) -> list[Cell] | None:
    """A* between two attachment cells (5.4.11), or None when the grid is exhausted."""

    def free(row: int, col: int) -> bool:
        cell = (row, col)
        return cell in (goal, start) or not obstacles.blocked(row, col)

    def estimate(row: int, col: int) -> int:
        dr, dc = abs(row - goal[0]), abs(col - goal[1])
        return DIAGONAL_COST * min(dr, dc) + STRAIGHT_COST * (max(dr, dc) - min(dr, dc))

    cost: dict[Cell, int] = {start: 0}
    came: dict[Cell, Cell] = {}
    done: set[Cell] = set()
    heap: list[tuple[int, int, int]] = [(estimate(*start), start[0], start[1])]
    while heap:
        _, row, col = heapq.heappop(heap)
        cell = (row, col)
        if cell in done:
            continue
        done.add(cell)
        if cell == goal:
            path = [cell]
            while cell in came:
                cell = came[cell]
                path.append(cell)
            path.reverse()
            return path
        here = cost[cell]
        for dr, dc, base in _NEIGHBOURS:
            nr, nc = row + dr, col + dc
            neighbour = (nr, nc)
            if neighbour in done or not free(nr, nc):
                continue
            if dr != 0 and dc != 0 and not (free(nr, col) and free(row, nc)):
                continue
            step = here + (2 * base if obstacles.near(nr, nc) else base)
            known = cost.get(neighbour)
            if known is None or step < known:
                cost[neighbour] = step
                came[neighbour] = cell
                heapq.heappush(heap, (step + estimate(nr, nc), nr, nc))
    return None


def _segment_free(obstacles: Obstacles, a: Cell, b: Cell, exempt: tuple[Cell, Cell]) -> bool:
    """The straight segment between two cell centres touches no blocked cell's square.

    In units of half a cell, a centre is the odd point (2 col + 1, 2 row + 1) and the square of
    cell (row, col) is [2 col, 2 col + 2] x [2 row, 2 row + 2].
    """
    x0, z0 = 2 * a[1] + 1, 2 * a[0] + 1
    x1, z1 = 2 * b[1] + 1, 2 * b[0] + 1
    if z0 > z1:
        x0, z0, x1, z1 = x1, z1, x0, z0
    dx, dz = x1 - x0, z1 - z0
    for row in range(z0 // 2, (z1 - 1) // 2 + 1) if dz else (z0 // 2,):
        if dz == 0:
            low, high, den = min(x0, x1), max(x0, x1), 1
        else:
            # x at height z is (x0 dz + (z - z0) dx) / dz, for z from the band's lower edge
            # to its upper edge, both cut to the segment.
            lower, upper = max(2 * row, z0), min(2 * row + 2, z1)
            first = x0 * dz + (lower - z0) * dx
            second = x0 * dz + (upper - z0) * dx
            low, high, den = min(first, second), max(first, second), dz
        for col in range(ceil_div(low, 2 * den) - 1, high // (2 * den) + 1):
            cell = (row, col)
            if cell not in exempt and obstacles.blocked(row, col):
                return False
    return True


def smooth(obstacles: Obstacles, cells: Sequence[Cell]) -> list[Cell]:
    """One pass from the start: a vertex goes when its neighbours see each other (5.4.11)."""
    kept = list(cells)
    exempt = (kept[0], kept[-1])
    index = 1
    while index < len(kept) - 1:
        if _segment_free(obstacles, kept[index - 1], kept[index + 1], exempt):
            del kept[index]
        else:
            index += 1
    return kept


def wobble(points: Sequence[Pt], wavelength: int, phase: int, directions: Directions) -> list[Pt]:
    """A route sampled every 0.5 m and at its end, displaced across its segments, rounded."""
    if len(points) < 2:
        return list(points)
    lengths = [
        isqrt((bx - ax) ** 2 + (bz - az) ** 2) for (ax, az), (bx, bz) in itertools.pairwise(points)
    ]
    total = sum(lengths)
    turn = MICRO_PER_TURN * wavelength
    out: list[Pt] = []
    segment, before = 0, 0
    u = 0
    while u < total:
        while before + lengths[segment] < u:
            before += lengths[segment]
            segment += 1
        (ax, az), (bx, bz) = points[segment], points[segment + 1]
        length = lengths[segment]
        along = u - before
        taper = min(u, total - u, TRAIL_TAPER)
        count = ((MICRO_PER_TURN * u + phase * wavelength) % turn) // (MICRO_PER_COUNT * wavelength)
        sine = directions.at(count)[1]
        c, s = directions.at(directions.count_of(bx - ax, bz - az))
        # The sample is a + (along / length)(b - a); the displacement is A(u) sin x the left
        # normal (-s, c) / 2^30, with A(u) = 3 m x taper / 10 m and sin = sine / 2^30.
        den = length * TRAIL_TAPER * SCALE * SCALE
        across = TRAIL_WOBBLE * taper * sine * length
        out.append(
            (
                round_half_away(
                    (ax * length + along * (bx - ax)) * TRAIL_TAPER * SCALE * SCALE - across * s,
                    den,
                ),
                round_half_away(
                    (az * length + along * (bz - az)) * TRAIL_TAPER * SCALE * SCALE + across * c,
                    den,
                ),
            )
        )
        u += SAMPLE_STEP
    out.append(points[-1])
    return out


@dataclass(frozen=True, slots=True)
class PlazaApproach:
    count: int
    """The approach's direction, in counts of the trig table."""
    tries: int
    near: Pt
    far: Pt
    strip: Shape


def plaza_approach(
    obstacles: Obstacles, toward: Pt, directions: Directions
) -> PlazaApproach | None:
    """The plaza approach (5.4.11): turned clockwise by 10 degrees until its far cell is free."""
    first = directions.count_of(toward[0], toward[1])
    step = PLAZA_APPROACH_STEP // MICRO_PER_COUNT
    for attempt in range(PLAZA_APPROACH_TRIES):
        count = (first - attempt * step) % COUNTS_PER_TURN
        c, s = directions.at(count)
        near = (
            round_half_away(PLAZA_EDGE_RADIUS * c, SCALE),
            round_half_away(PLAZA_EDGE_RADIUS * s, SCALE),
        )
        far = (
            round_half_away(PLAZA_APPROACH_END * c, SCALE),
            round_half_away(PLAZA_APPROACH_END * s, SCALE),
        )
        shape = strip([near, far], PATH_HALF_WIDTH)
        if any(not clear(shape, volume, MARGIN) for volume in obstacles.volumes):
            continue
        if obstacles.blocked(*grid_cell(*far)):
            continue
        return PlazaApproach(count=count, tries=attempt + 1, near=near, far=far, strip=shape)
    return None


@dataclass(frozen=True, slots=True)
class Leg:
    index: int
    kind: str
    """``trail`` for a leg of the trail, ``spur`` for a leg to a regional site."""
    start: str
    """``plaza``, a site key, or ``trail`` for a spur."""
    end: str
    polyline: tuple[Pt, ...]
    """The rounded centreline, attachment segments included."""
    start_attachment: tuple[Pt, Pt]
    """From the leg's anchor point to the centre of its attachment cell."""
    end_attachment: tuple[Pt, Pt]
    length: int
    """The integer arc length of the polyline (5.4.18 (5))."""
    wavelength: int
    phase: int
    cells: int
    """Cells on the A* route, before smoothing."""
    start_blocked: bool
    """The start's attachment cell was a blocked cell (a spur that starts on a wobbled vertex)."""


def _dedupe(points: Sequence[Pt]) -> list[Pt]:
    out: list[Pt] = []
    for point in points:
        if not out or out[-1] != point:
            out.append(point)
    return out


def polyline_length(points: Sequence[Pt]) -> int:
    return sum(
        isqrt((bx - ax) ** 2 + (bz - az) ** 2) for (ax, az), (bx, bz) in itertools.pairwise(points)
    )


def leg(
    obstacles: Obstacles,
    index: int,
    kind: str,
    names: tuple[str, str],
    anchors: tuple[Pt, Pt],
    prng: Prng,
    directions: Directions,
) -> Leg | None:
    """Route, smooth, attach and wobble one leg; None when A* finds no route.

    The leg's two draws are taken before the route is known, so the world stream does not depend
    on whether the route exists.
    """
    wavelength = prng.randint(*TRAIL_WAVELENGTH)
    phase = prng.randint(0, MICRO_PER_TURN - 1)
    start, goal = grid_cell(*anchors[0]), grid_cell(*anchors[1])
    cells = route(obstacles, start, goal)
    if cells is None:
        return None
    centres = [cell_centre(*cell) for cell in smooth(obstacles, cells)]
    middle = wobble(centres, wavelength, phase, directions)
    polyline = tuple(_dedupe([anchors[0], *middle, anchors[1]]))
    return Leg(
        index=index,
        kind=kind,
        start=names[0],
        end=names[1],
        polyline=polyline,
        start_attachment=(anchors[0], centres[0]),
        end_attachment=(centres[-1], anchors[1]),
        length=polyline_length(polyline),
        wavelength=wavelength,
        phase=phase,
        cells=len(cells),
        start_blocked=obstacles.blocked(*start),
    )


def nearest_vertex(legs: Sequence[Leg], target: Pt) -> Pt:
    """The vertex of the legs so far nearest ``target``: a spur's start (5.4.11)."""
    best: tuple[int, int, int] | None = None
    point = legs[0].polyline[0]
    for found in legs:
        for position, (x, z) in enumerate(found.polyline):
            key = ((x - target[0]) ** 2 + (z - target[1]) ** 2, found.index, position)
            if best is None or key < best:
                best, point = key, (x, z)
    return point


def meets(obstacles: Obstacles, polyline: Sequence[Pt]) -> tuple[str, int] | None:
    """The first earlier shape that a leg's strip meets when it is reserved, or None.

    The polyline is the leg as reserved: wobbled, rounded, its attachment segments included. The
    strip is tested with the 2 mm margin of 5.4.18 (4) against the hero volumes in file order,
    then against every site in site order: its pad, its stone and its blob. The answer is the
    kind of the shape met (``hero volume``, ``pad``, ``stone`` or ``blob``) and its index among
    the volumes or among the sites.
    """
    index = SegmentIndex(polyline)
    shape = strip(polyline, PATH_HALF_WIDTH)
    reach = PATH_HALF_WIDTH + MARGIN + 1

    def met(other: Shape) -> bool:
        near = index.near(other.box, reach)
        return bool(near) and not clear(shape, other, MARGIN, near)

    for number, volume in enumerate(obstacles.volumes):
        if met(volume):
            return "hero volume", number
    for number, (local, (cx, cz)) in enumerate(obstacles.sites):
        bounding = local.bounding
        if not index.near((cx - bounding, cz - bounding, cx + bounding, cz + bounding), reach):
            continue
        for kind, other in (
            ("pad", local.pad_disc),
            ("stone", local.stone_disc),
            ("blob", local.blob),
        ):
            if met(other.translated(cx, cz)):
                return kind, number
    return None
