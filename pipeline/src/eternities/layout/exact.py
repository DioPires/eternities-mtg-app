"""The exact primitives of PRD v4 5.4.18: rounding, the PRNG, the trig table and the lattices.

Every quantity here is an ``int`` or a ``fractions.Fraction``. A table direction is the pair
``(cos, sin)`` of integers scaled by 2^30; a point "over 2^30" is a pair of numerators with that
denominator. Nothing is ever normalised and no root but ``isqrt`` is taken.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Final

from . import trig
from .constants import (
    COUNTS_PER_TURN,
    DISC_STEP_COUNTS,
    DISC_VERTICES,
    GRID_PITCH,
    LATTICE_HALF_PITCH,
    LATTICE_PITCH,
    LATTICE_ROW,
    MICRO_PER_COUNT,
    MICRO_PER_TURN,
)

SCALE: Final = trig.SCALE
"""2^30: the denominator of every table direction."""

_MASK: Final = (1 << 64) - 1
_FNV_OFFSET: Final = 0xCBF29CE484222325
_FNV_PRIME: Final = 0x100000001B3

type Pt = tuple[int, int]


def fnv1a64(text: str) -> int:
    """FNV-1a 64 of the UTF-8 bytes of ``text`` (5.4.1)."""
    value = _FNV_OFFSET
    for byte in text.encode("utf-8"):
        value = ((value ^ byte) * _FNV_PRIME) & _MASK
    return value


class Prng:
    """splitmix64 (5.4.18 (9)): 64 bits a draw; an integer in [lo, hi] is lo + bits mod span."""

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = seed & _MASK

    @classmethod
    def of(cls, text: str) -> Prng:
        return cls(fnv1a64(text))

    def bits(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & _MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK
        return z ^ (z >> 31)

    def randint(self, lo: int, hi: int) -> int:
        return lo + self.bits() % (hi - lo + 1)


def round_half_away(num: int, den: int) -> int:
    """5.4.18 (3): sign(q) * floor(|q| + 1/2) for q = num / den, den > 0. -0.5 becomes -1."""
    if num >= 0:
        return (2 * num + den) // (2 * den)
    return -((-2 * num + den) // (2 * den))


def round_fraction(value: Fraction) -> int:
    return round_half_away(value.numerator, value.denominator)


def ceil_div(num: int, den: int) -> int:
    return -((-num) // den)


class Directions:
    """The committed trig table as exact directions (5.4.18 (6), (7))."""

    __slots__ = ("_values", "disc", "sha256")

    def __init__(self, table: trig.TrigTable) -> None:
        self._values = table.values
        self.sha256 = table.sha256
        self.disc: tuple[Pt, ...] = tuple(
            self.at(index * DISC_STEP_COUNTS) for index in range(DISC_VERTICES)
        )
        """The 72 directions of a disc (5.4.18 (13)), as (cos, sin) over 2^30."""

    def at(self, count: int) -> Pt:
        """(cos, sin) of ``count`` thousandths of a degree, reduced to one turn."""
        index = 2 * (count % COUNTS_PER_TURN)
        return self._values[index + 1], self._values[index]

    def of_micro(self, micro: int) -> Pt:
        """The direction of an angle in micro-degrees: reduced, then truncated (5.4.18 (6))."""
        return self.at((micro % MICRO_PER_TURN) // MICRO_PER_COUNT)

    def sin_of_fraction(self, micro: Fraction) -> int:
        """sin, scaled by 2^30, of a rational angle in micro-degrees (the wobble's phase)."""
        reduced = micro % MICRO_PER_TURN
        count = reduced.numerator // (reduced.denominator * MICRO_PER_COUNT)
        return self._values[2 * count]

    def count_of(self, vx: int, vz: int) -> int:
        """The count that 5.4.18 (7) picks: of the two counts that bracket the vector, the one on
        the vector's side of their directions' sum, ties to the lower count.

        A binary search over one quadrant of the table on the sign of the exact cross product,
        then a choice between the two counts that bracket the vector by the side of their sum on
        which the vector lies (5.4.18 (7)). The vector's components share any one positive scale.
        """
        if vx == 0 and vz == 0:
            raise ValueError("the zero vector has no direction")
        quarter = COUNTS_PER_TURN // 4
        if vx > 0 and vz >= 0:
            base = 0
        elif vx <= 0 and vz > 0:
            base = quarter
        elif vx < 0 and vz <= 0:
            base = 2 * quarter
        else:
            base = 3 * quarter
        values = self._values
        lo, hi = base, base + quarter
        # Invariant: cross(direction(lo), v) >= 0, and it is negative from hi + 1 on.
        while lo < hi:
            mid = (lo + hi + 1) // 2
            index = 2 * (mid % COUNTS_PER_TURN)
            if values[index + 1] * vz - values[index] * vx >= 0:
                lo = mid
            else:
                hi = mid - 1
        low = lo % COUNTS_PER_TURN
        high = (lo + 1) % COUNTS_PER_TURN
        lc, ls = self.at(low)
        hc, hs = self.at(high)
        side = (lc + hc) * vz - (ls + hs) * vx
        if side > 0:
            return high
        if side < 0:
            return low
        return min(low, high)


def left_normal(direction: Pt) -> Pt:
    """The left normal of a table direction: the same sin and cos, turned (5.4.18 (7))."""
    return -direction[1], direction[0]


def lattice_point(i: int, k: int) -> Pt:
    """The hexagonal lattice of 5.4.18 (8), axial (i, k), in millimetres."""
    return LATTICE_PITCH * i + LATTICE_HALF_PITCH * k, LATTICE_ROW * k


def lattice_within(cx: int, cz: int, den: int, radius: int) -> list[tuple[int, int, int, int]]:
    """Lattice points at most ``radius`` from the centre (cx, cz) / den.

    Returns ``(k, i, x, z)`` in (row, column) order: row is k, column is i.
    """
    found: list[tuple[int, int, int, int]] = []
    limit = radius * radius * den * den
    k_lo = ceil_div(cz - radius * den, LATTICE_ROW * den)
    k_hi = (cz + radius * den) // (LATTICE_ROW * den)
    for k in range(k_lo, k_hi + 1):
        z = LATTICE_ROW * k
        dz = z * den - cz
        offset = LATTICE_HALF_PITCH * k
        i_lo = ceil_div(cx - (radius + offset) * den, LATTICE_PITCH * den)
        i_hi = (cx + (radius - offset) * den) // (LATTICE_PITCH * den)
        for i in range(i_lo, i_hi + 1):
            x = LATTICE_PITCH * i + offset
            dx = x * den - cx
            if dx * dx + dz * dz <= limit:
                found.append((k, i, x, z))
    return found


def grid_cell(x: int, z: int, den: int = 1) -> tuple[int, int]:
    """The (row, column) of the 5 m routing cell that holds a point (5.4.11).

    A point on a cell edge belongs to the lower row, then the lower column, so a cell is the
    half-open square (5,000 c, 5,000 (c + 1)] x (5,000 r, 5,000 (r + 1)].
    """
    pitch = GRID_PITCH * den
    return ceil_div(z, pitch) - 1, ceil_div(x, pitch) - 1


def cell_centre(row: int, col: int) -> Pt:
    half = GRID_PITCH // 2
    return GRID_PITCH * col + half, GRID_PITCH * row + half


def cell_square(row: int, col: int) -> tuple[Pt, Pt, Pt, Pt]:
    x0, z0 = GRID_PITCH * col, GRID_PITCH * row
    x1, z1 = x0 + GRID_PITCH, z0 + GRID_PITCH
    return (x0, z0), (x1, z0), (x1, z1), (x0, z1)
