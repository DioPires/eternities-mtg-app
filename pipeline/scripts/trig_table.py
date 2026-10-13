#!/usr/bin/env python
"""Generate the trig table of PRD v4 5.4.18 (6): ``contract/test-vectors/v4/layout/trig.bin``.

The table is the allocator's only source of sin and cos. For every integer ``k`` in
``[0, 360,000)`` it holds sin and cos of ``k`` thousandths of a degree, each as a signed 32-bit
integer scaled by 2^30. A record is 8 bytes, sin then cos, little-endian like every other binary
file of the contract; record ``k`` starts at byte ``8 * k``; the file has no header and is
2,880,000 bytes.

The table is generated once and committed. No build regenerates it: the pipeline reads the
committed bytes and asserts their SHA-256 before use (``eternities.layout.trig``). Run this script
only to audit the table, or when PRD 5.4.18 (12) changes the table under review.

    uv run python scripts/trig_table.py --check     # compare the committed file, write nothing
    uv run python scripts/trig_table.py             # write the file and print its SHA-256

**Why every entry is correctly rounded.** Nothing here calls ``math.sin``. The argument is reduced
to the first octant in integer thousandths of a degree, so the reduction is exact and pi is used
once, to turn a count in ``[0, 45,000]`` into radians. sin and cos are then summed from their Taylor
series in ``decimal`` at ``PRECISION`` digits, where the error of a sum is below 10^-70 after
scaling. The rounded integer is therefore correct unless the scaled value lies within that error of
a half-integer, and ``_scaled`` refuses to emit an entry within 10^-40 of one. No entry can be an
exact tie: sin of a rational number of degrees is rational only at 0, 1/2 and 1 (Niven's theorem),
and those scale to integers.
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal, localcontext
from pathlib import Path

COUNTS = 360_000
"""Thousandths of a degree in one turn: the number of records."""

SCALE_BITS = 30
SCALE = 1 << SCALE_BITS

PRECISION = 80
"""Working digits. PRD 5.4.18 asks for 50 or better."""

_GUARD = Decimal(10) ** -40
_QUARTER = COUNTS // 4
_EIGHTH = COUNTS // 8

# The first 50 decimals of pi, to check the value this script computes.
_PI_50 = "3.14159265358979323846264338327950288419716939937510"

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "contract/test-vectors/v4/layout/trig.bin"


def _arctan_inverse(n: int) -> Decimal:
    """arctan(1/n) from its Taylor series, in the current decimal context."""
    power = Decimal(1) / n
    total = power
    square = n * n
    k = 1
    while True:
        power = -power / square
        term = power / (2 * k + 1)
        if term == 0 or abs(term) < Decimal(10) ** -(PRECISION + 10):
            return total
        total += term
        k += 1


def _pi() -> Decimal:
    """Machin's formula: pi = 16 arctan(1/5) - 4 arctan(1/239)."""
    pi = 16 * _arctan_inverse(5) - 4 * _arctan_inverse(239)
    if str(pi)[: len(_PI_50)] != _PI_50:
        raise AssertionError(f"pi came out as {pi}")
    return pi


def _sin_cos(x: Decimal) -> tuple[Decimal, Decimal]:
    """sin and cos of ``x`` radians, ``0 <= x <= pi/4``, from their Taylor series."""
    limit = Decimal(10) ** -(PRECISION + 5)
    square = x * x
    sin_total, cos_total = x, Decimal(1)
    sin_term, cos_term = x, Decimal(1)
    n = 1
    while True:
        cos_term = -cos_term * square / ((2 * n - 1) * (2 * n))
        sin_term = -sin_term * square / ((2 * n) * (2 * n + 1))
        cos_total += cos_term
        sin_total += sin_term
        if abs(cos_term) < limit and abs(sin_term) < limit:
            return sin_total, cos_total
        n += 1


def _scaled(value: Decimal, count: int) -> int:
    """``value`` times 2^30, rounded to the nearest integer, or an error when that is in doubt."""
    scaled = value * SCALE
    distance = abs(scaled - scaled.to_integral_value(ROUND_FLOOR) - Decimal("0.5"))
    if distance < _GUARD:
        raise ArithmeticError(
            f"count {count}: {scaled} is within {_GUARD} of a half-integer, so {PRECISION} digits "
            "do not decide its rounding; raise PRECISION"
        )
    return int(scaled.to_integral_value(ROUND_HALF_UP))


def first_octant() -> list[tuple[int, int]]:
    """``(sin, cos)`` scaled by 2^30 for every count in ``[0, 45,000]``, that is 0 to 45 degrees."""
    with localcontext() as context:
        context.prec = PRECISION + 10
        step = _pi() / (COUNTS // 2)
        context.prec = PRECISION
        octant: list[tuple[int, int]] = []
        for count in range(_EIGHTH + 1):
            sin_value, cos_value = _sin_cos(step * count)
            octant.append((_scaled(sin_value, count), _scaled(cos_value, count)))
        return octant


def entry(k: int, octant: list[tuple[int, int]]) -> tuple[int, int]:
    """``(sin, cos)`` scaled by 2^30 for ``k`` thousandths of a degree, ``0 <= k < 360,000``.

    The reduction is integer arithmetic on the count, so it is exact: a quarter turn swaps sin and
    cos and changes one sign, and an angle past 45 degrees reads the octant from the other end.
    """
    if not 0 <= k < COUNTS:
        raise ValueError(f"count {k} is outside [0, {COUNTS})")
    quadrant, rest = divmod(k, _QUARTER)
    if rest <= _EIGHTH:
        sin_value, cos_value = octant[rest]
    else:
        cos_value, sin_value = octant[_QUARTER - rest]
    if quadrant == 0:
        return sin_value, cos_value
    if quadrant == 1:
        return cos_value, -sin_value
    if quadrant == 2:
        return -sin_value, -cos_value
    return -cos_value, sin_value


def build_table() -> bytes:
    """The whole file: 360,000 records of two little-endian int32, sin then cos."""
    octant = first_octant()
    flat: list[int] = []
    for k in range(COUNTS):
        flat.extend(entry(k, octant))
    return struct.pack(f"<{2 * COUNTS}i", *flat)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n", 1)[0])
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="the table's path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare the file at --out with what this script generates, and write nothing",
    )
    args = parser.parse_args(argv)
    out = Path(args.out)

    table = build_table()
    digest = hashlib.sha256(table).hexdigest()
    if args.check:
        if not out.exists():
            print(f"{out} does not exist", file=sys.stderr)
            return 1
        committed = hashlib.sha256(out.read_bytes()).hexdigest()
        if committed != digest:
            print(
                f"{out} differs from the generated table\n"
                f"  file:      sha256 {committed}\n  generated: sha256 {digest}",
                file=sys.stderr,
            )
            return 1
        print(f"{out} is the generated table: {len(table):,} bytes, sha256 {digest}")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(table)
    print(f"wrote {out}: {len(table):,} bytes, sha256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
