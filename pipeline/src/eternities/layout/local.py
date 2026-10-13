"""A site's local geometry (PRD v4 5.4.7, 5.4.8): the blob, the path, the pad, approach and stone.

Everything here is built in the site's own frame, the site centre at the origin, from the site's
radius and its PRNG alone; nothing depends on where the site lands (5.4.6). A site centre is a
whole number of millimetres, so the world's geometry is this geometry moved by integers.

**What the code defines where 5.4.8 leaves a choice** (5.4.18 (12)); each is pinned by the
fixtures:

- A sweep line is the set of points ``o + tau x d_s`` with ``o`` on ``n_s``; a position along a
  line is its ``tau``, a multiplier of the table direction (5.4.18 (7)). Shortening, trimming and
  a run's length are sums and differences of ``tau``.
- A blob edge crosses a sweep line when exactly one of its ends lies strictly below the line.
- A chord end that a half-turn joins is shortened by 15 m, so the half-turn lies inside the blob
  (CEO ruling of 2026-10-13 on DEC-1004, rule 1). With ``m`` the sweep count before any drop:
  the head end of sweep 0 by 1.5 m, the head end of every later sweep and the far end of every
  sweep but the last by 15 m, the far end of sweep ``m - 1`` by 4.5 m.
- Every chord is shortened, then every join trims its two chords, and only then is the first
  chord shorter than ``s`` dropped with every sweep after it. A sweep that a drop leaves last
  keeps its shortened and trimmed far end.
- The wobble's two draws are taken for the sweeps that are kept, in sweep order.
- The head ``H`` is the first vertex of the rounded path. The pad's centre is the first vertex of
  the rounded approach, and the approach point is its second.
- The stone stands on the side whose centre is farther from the first run's polyline.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from fractions import Fraction
from math import isqrt

from .constants import (
    APPROACH_LENGTH,
    BLOB_AMPLITUDE,
    BLOB_DEFORMATION_DIVISOR,
    BLOB_FLOOR,
    BLOB_STEP,
    BLOB_VERTICES,
    BOUNDING_EXTRA,
    CHORD_SHORTENING,
    COUNTS_PER_DEGREE,
    HALF_TURN_SEGMENTS,
    HALF_TURN_STEP,
    HEAD_SHORTENING,
    JOINED_SHORTENING,
    K_SITE,
    MARGIN,
    MICRO_PER_COUNT,
    MICRO_PER_TURN,
    OBSTACLE_EXPANSION,
    PAD_RADIUS,
    PATH_HALF_WIDTH,
    SAMPLE_STEP,
    SLOT_SPACING,
    STONE_ACROSS,
    STONE_ALONG,
    STONE_CLEARANCE,
    STONE_RADIUS,
    SWEEP_SPACING,
    SWEEP_TAPER,
    SWEEP_TRIES,
    SWEEP_TRY_STEP,
    SWEEP_WAVELENGTH,
    SWEEP_WOBBLE,
)
from .exact import SCALE, Directions, Prng, Pt, cell_square, grid_cell, round_half_away
from .geometry import (
    SegmentIndex,
    Shape,
    clear,
    disc,
    polygon,
    squared_distance_to_polyline,
    strip,
)


def base_radius(stands: int) -> int:
    """r_s = max(9,000 mm, isqrt(K_site x n)) (5.4.1)."""
    return max(BLOB_FLOOR, isqrt(K_SITE * stands))


def widened(radius: int) -> int:
    """A widening replaces r_s by floor(11 r_s / 10) (5.4.1)."""
    return 11 * radius // 10


def bounding_radius(radius: int) -> int:
    """b_s = ceil(6 r_s / 5) + 15,000 mm (5.4.1)."""
    return -(-6 * radius // 5) + BOUNDING_EXTRA


@dataclass(frozen=True, slots=True)
class Local:
    """One site's local geometry at one radius. A pure function of the site key and the radius."""

    radius: int
    bounding: int
    blob: Shape
    path: tuple[Pt, ...]
    """The rounded centreline, from the head."""
    arcs: tuple[int, ...]
    """The integer arc length to each vertex (5.4.18 (5))."""
    turn: tuple[int, ...]
    """Per segment: 0 on a run, +1 on a half-turn that turns left, -1 on one that turns right."""
    first_run: int
    """The number of vertices of sweep 0's run."""
    head_count: int
    """The head ray's direction, in counts of the trig table."""
    pad: Pt
    approach_point: Pt
    stone: Pt
    """The stone's centre, numerators over 2^30."""
    stone_side: int
    """+1 when the stone stands left of the head ray, -1 right."""
    sweep_count: int
    """The sweep direction that passed, in counts."""
    tries: int
    """Sweep-direction tries used, 1 to 18."""
    failures: tuple[str, ...]
    """Why each earlier try failed, in try order: one of :data:`TRY_FAILURES`."""
    sweeps: int
    """Sweeps kept."""
    state: int
    """The site PRNG's state after this geometry's draws; 5.4.9 continues from it."""
    index: SegmentIndex
    path_strip: Shape
    pad_disc: Shape
    approach_strip: Shape
    stone_disc: Shape
    blocked_cells: dict[tuple[int, int], bool] = field(
        default_factory=dict, compare=False, repr=False
    )
    """Routing cells within 5 m of the blob, in the site's frame, filled as routes ask (5.4.11)."""
    near_cells: dict[tuple[int, int], bool] = field(default_factory=dict, compare=False, repr=False)
    """Routing cells whose centre is less than 10 m from the blob, in the site's frame."""


EMPTY_PATH = "the path is empty"
APPROACH_MEETS_BLOB = "the approach meets the blob"
SQUARE_NEAR_BLOB = "the attachment square lies within 5 m of the blob"
STONE_TEST = "the stone test fails"
TRY_FAILURES: tuple[str, ...] = (EMPTY_PATH, APPROACH_MEETS_BLOB, SQUARE_NEAR_BLOB, STONE_TEST)


def blob_of(radius: int, prng: Prng, directions: Directions) -> Shape:
    """5.4.7: the star-shaped 72-gon r(theta), exact, over one denominator."""
    lo, hi = BLOB_AMPLITUDE
    harmonics: list[tuple[int, int, int]] = []
    for order in (2, 3, 4):
        amplitude = prng.randint(lo, hi)
        phase = prng.randint(0, MICRO_PER_TURN - 1)
        harmonics.append((order, amplitude, phase))
    total = sum(amplitude for _, amplitude, _ in harmonics)
    unit = BLOB_DEFORMATION_DIVISOR * total * SCALE
    pts: list[Pt] = []
    for vertex in range(BLOB_VERTICES):
        theta = vertex * BLOB_STEP
        weight = unit + sum(
            amplitude * directions.of_micro(order * theta + phase)[0]
            for order, amplitude, phase in harmonics
        )
        c, s = directions.of_micro(theta)
        pts.append((radius * weight * c, radius * weight * s))
    return polygon(pts, unit * SCALE)


@dataclass(slots=True)
class _Sweep:
    offset: Fraction
    """The line's offset c_k along n_s."""
    head: Fraction
    """tau of the end travel enters by."""
    far: Fraction
    sign: int
    """+1 when the sweep runs along d_s, -1 against it."""

    @property
    def length(self) -> Fraction:
        return self.sign * (self.far - self.head)


def _chords(blob: Shape, direction: Pt) -> list[_Sweep] | None:
    """The sweeps of 5.4.8 after shortening and trimming, or None when a line has no chord."""
    c, s = direction
    norm = c * c + s * s
    den = blob.den
    # z(v) = <v, n_s> and tau(v) = <v, d_s> / |d_s|^2, both exact.
    heights = [Fraction(-vx * s + vz * c, den * SCALE) for vx, vz in blob.pts]
    lowest, highest = min(heights), max(heights)
    extent = highest - lowest
    count = max(1, int(extent // SWEEP_SPACING))
    first = lowest + (extent - (count - 1) * SWEEP_SPACING) * Fraction(1, 2)
    sweeps: list[_Sweep] = []
    vertices = len(blob.pts)
    for k in range(count):
        offset = first + k * SWEEP_SPACING
        crossings: list[Fraction] = []
        for i in range(vertices):
            j = (i + 1) % vertices
            hp, hq = heights[i], heights[j]
            if (hp < offset) == (hq < offset):
                continue
            t = Fraction(offset - hp, hq - hp)
            (px, pz), (qx, qz) = blob.pts[i], blob.pts[j]
            x = Fraction(px, den) + t * Fraction(qx - px, den)
            z = Fraction(pz, den) + t * Fraction(qz - pz, den)
            crossings.append((x * c + z * s) * Fraction(SCALE, norm))
        crossings.sort()
        best: tuple[Fraction, Fraction] | None = None
        for i in range(0, len(crossings) - 1, 2):
            a, b = crossings[i], crossings[i + 1]
            if best is None or b - a > best[1] - best[0]:
                best = (a, b)
        if best is None:
            return None
        sign = 1 if k % 2 == 0 else -1
        head_cut = HEAD_SHORTENING if k == 0 else JOINED_SHORTENING
        far_cut = JOINED_SHORTENING if k < count - 1 else CHORD_SHORTENING
        if sign > 0:
            sweeps.append(_Sweep(offset, best[0] + head_cut, best[1] - far_cut, sign))
        else:
            sweeps.append(_Sweep(offset, best[1] - head_cut, best[0] + far_cut, sign))
    for k in range(count - 1):
        here, there = sweeps[k], sweeps[k + 1]
        trim = min(here.far, there.head) if here.sign > 0 else max(here.far, there.head)
        here.far = trim
        there.head = trim
    kept: list[_Sweep] = []
    for sweep in sweeps:
        if sweep.length < SLOT_SPACING:
            break
        kept.append(sweep)
    return kept


def _line_point(offset: Fraction, tau: Fraction, direction: Pt) -> tuple[Fraction, Fraction]:
    """The point of the sweep line at ``offset`` whose position along the line is ``tau``."""
    c, s = direction
    norm = c * c + s * s
    base = offset * Fraction(SCALE, norm)
    return base * -s + tau * Fraction(c, SCALE), base * c + tau * Fraction(s, SCALE)


def _round_point(x: Fraction, z: Fraction) -> Pt:
    return (
        round_half_away(x.numerator, x.denominator),
        round_half_away(z.numerator, z.denominator),
    )


def _run(
    sweep: _Sweep, direction: Pt, wavelength: int, phase: int, directions: Directions
) -> list[Pt]:
    """One sweep's run: sampled every 0.5 m and at its end, wobbled along n_s, rounded."""
    c, s = direction
    length = sweep.length
    hx, hz = _line_point(sweep.offset, sweep.head, direction)
    pts: list[Pt] = []
    # The head and the end are not displaced: the taper is zero there.
    step_count = int(length // SAMPLE_STEP)
    if length == step_count * SAMPLE_STEP:
        step_count -= 1
    # x = hx + (sign u c) / SCALE + (amp sin (-s)) / SCALE^2 with amp = taper / 2.
    hx_num, hx_den = hx.numerator, hx.denominator
    hz_num, hz_den = hz.numerator, hz.denominator
    turn = MICRO_PER_TURN * wavelength
    for index in range(step_count + 1):
        u = index * SAMPLE_STEP
        rest = length - u
        if u <= rest and u <= SWEEP_TAPER:
            taper_num, taper_den = u, 1
        elif rest <= SWEEP_TAPER:
            taper_num, taper_den = rest.numerator, rest.denominator
        else:
            taper_num, taper_den = SWEEP_TAPER, 1
        # A(u) = 3 m x taper / 6 m.
        amp_num = SWEEP_WOBBLE * taper_num
        amp_den = SWEEP_TAPER * taper_den
        count = ((MICRO_PER_TURN * u + phase * wavelength) % turn) // (MICRO_PER_COUNT * wavelength)
        sine = directions.at(count)[1]
        common = SCALE * SCALE * amp_den
        along = sweep.sign * u * SCALE * amp_den
        across = amp_num * sine
        pts.append(
            (
                round_half_away(
                    hx_num * common + hx_den * (along * c - across * s), hx_den * common
                ),
                round_half_away(
                    hz_num * common + hz_den * (along * s + across * c), hz_den * common
                ),
            )
        )
    pts.append(_round_point(*_line_point(sweep.offset, sweep.far, direction)))
    return pts


def _half_turn(
    here: _Sweep, there: _Sweep, direction: Pt, count: int, directions: Directions
) -> list[Pt]:
    """The eleven inner vertices of the 180 degree arc that joins two sweeps (5.4.8)."""
    ax, az = _line_point(here.offset, here.far, direction)
    bx, bz = _line_point(there.offset, there.head, direction)
    mx, mz = (ax + bx) * Fraction(1, 2), (az + bz) * Fraction(1, 2)
    radius = SWEEP_SPACING // 2
    step = HALF_TURN_STEP // MICRO_PER_COUNT
    pts: list[Pt] = []
    for index in range(1, HALF_TURN_SEGMENTS):
        c, s = directions.at(count - 90 * COUNTS_PER_DEGREE + here.sign * step * index)
        pts.append(_round_point(mx + Fraction(radius * c, SCALE), mz + Fraction(radius * s, SCALE)))
    return pts


def arc_lengths(path: tuple[Pt, ...]) -> tuple[int, ...]:
    """5.4.18 (5): the arc length to a vertex is the sum of the integer segment lengths."""
    arcs = [0]
    for (ax, az), (bx, bz) in itertools.pairwise(path):
        arcs.append(arcs[-1] + isqrt((bx - ax) ** 2 + (bz - az) ** 2))
    return tuple(arcs)


def _dedupe(pts: list[Pt]) -> list[Pt]:
    out: list[Pt] = []
    for point in pts:
        if not out or out[-1] != point:
            out.append(point)
    return out


def build(radius: int, seed: str, directions: Directions) -> Local | None:
    """The local geometry of a site at ``radius``, or None when all eighteen tries fail."""
    prng = Prng.of(seed)
    blob = blob_of(radius, prng, directions)
    drawn = prng.randint(0, MICRO_PER_TURN // 2 - 1)
    after_direction = prng.state
    failures: list[str] = []
    for attempt in range(SWEEP_TRIES):
        prng.state = after_direction
        count = ((drawn + attempt * SWEEP_TRY_STEP) % MICRO_PER_TURN) // MICRO_PER_COUNT
        found = _try(radius, blob, count, tuple(failures), prng, directions)
        if isinstance(found, Local):
            return found
        failures.append(found)
    return None


def _try(
    radius: int,
    blob: Shape,
    count: int,
    failures: tuple[str, ...],
    prng: Prng,
    directions: Directions,
) -> Local | str:
    """One sweep direction: the local geometry, or the reason the try fails (5.4.8)."""
    direction = directions.at(count)
    sweeps = _chords(blob, direction)
    if not sweeps:
        return EMPTY_PATH
    path: list[Pt] = []
    turn: list[int] = []
    first_run = 0
    for k, sweep in enumerate(sweeps):
        wavelength = prng.randint(*SWEEP_WAVELENGTH)
        phase = prng.randint(0, MICRO_PER_TURN - 1)
        run = _run(sweep, direction, wavelength, phase, directions)
        if k > 0:
            arc = _half_turn(sweeps[k - 1], sweep, direction, count, directions)
            joined = _dedupe([path[-1], *arc, run[0]])
            path.extend(joined[1:])
            turn.extend([sweeps[k - 1].sign] * (len(joined) - 1))
            run = _dedupe(run)
            path.extend(run[1:])
            turn.extend([0] * (len(run) - 1))
        else:
            run = _dedupe(run)
            path.extend(run)
            turn.extend([0] * (len(run) - 1))
            first_run = len(run)
    if len(path) < 2:
        return EMPTY_PATH

    hx, hz = path[0]
    head_count = directions.count_of(hx, hz)
    uc, us = directions.at(head_count)
    pad = (
        round_half_away(hx * SCALE + PAD_RADIUS * uc, SCALE),
        round_half_away(hz * SCALE + PAD_RADIUS * us, SCALE),
    )
    reach = PAD_RADIUS + APPROACH_LENGTH
    approach_point = (
        round_half_away(hx * SCALE + reach * uc, SCALE),
        round_half_away(hz * SCALE + reach * us, SCALE),
    )

    # The approach test: the strip's axis past the pad meets the blob nowhere, and the cell of
    # the routing grid that holds the approach point is 5 m clear of the blob.
    far_edge = (hx * SCALE + 2 * PAD_RADIUS * uc, hz * SCALE + 2 * PAD_RADIUS * us)
    axis = strip([far_edge, (approach_point[0] * SCALE, approach_point[1] * SCALE)], 0, SCALE)
    if not clear(axis, blob, MARGIN):
        return APPROACH_MEETS_BLOB
    square = polygon(cell_square(*grid_cell(*approach_point)))
    if not clear(square, blob, OBSTACLE_EXPANSION + MARGIN):
        return SQUARE_NEAR_BLOB

    # The stone: the side whose centre is farther from the first run, ties left.
    along_x = hx * SCALE + STONE_ALONG * uc
    along_z = hz * SCALE + STONE_ALONG * us
    left = (along_x - STONE_ACROSS * us, along_z + STONE_ACROSS * uc)
    right = (along_x + STONE_ACROSS * us, along_z - STONE_ACROSS * uc)
    run_pts = path[:first_run]
    left_num, left_div = squared_distance_to_polyline(left[0], left[1], SCALE, run_pts)
    right_num, right_div = squared_distance_to_polyline(right[0], right[1], SCALE, run_pts)
    side = -1 if right_num * left_div > left_num * right_div else 1
    stone = left if side > 0 else right
    stone_disc = disc(directions.disc, stone[0], stone[1], SCALE, STONE_RADIUS)
    pad_disc = disc(directions.disc, pad[0], pad[1], 1, PAD_RADIUS)
    approach_strip = strip([pad, approach_point], PATH_HALF_WIDTH)
    frozen = tuple(path)
    index = SegmentIndex(frozen)
    path_strip = strip(frozen, PATH_HALF_WIDTH)
    spacing = STONE_CLEARANCE + MARGIN
    near = index.near(stone_disc.box, PATH_HALF_WIDTH + spacing + 1)
    if not (
        clear(stone_disc, blob, spacing)
        and clear(stone_disc, pad_disc, spacing)
        and clear(approach_strip, stone_disc, spacing)
        and clear(path_strip, stone_disc, spacing, near)
    ):
        return STONE_TEST

    return Local(
        radius=radius,
        bounding=bounding_radius(radius),
        blob=blob,
        path=frozen,
        arcs=arc_lengths(frozen),
        turn=tuple(turn),
        first_run=first_run,
        head_count=head_count,
        pad=pad,
        approach_point=approach_point,
        stone=stone,
        stone_side=side,
        sweep_count=count,
        tries=len(failures) + 1,
        failures=failures,
        sweeps=len(sweeps),
        state=prng.state,
        index=index,
        path_strip=path_strip,
        pad_disc=pad_disc,
        approach_strip=approach_strip,
        stone_disc=stone_disc,
    )
