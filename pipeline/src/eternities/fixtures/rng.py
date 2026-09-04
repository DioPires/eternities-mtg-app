"""Seeded, stateless randomness.

PRD 8.2: every random choice hashes a stable key with a fixed salt. No global RNG, ever.
"""

from __future__ import annotations

import hashlib
import math
import struct
from typing import Final

SALT: Final = b"eternities/v1"


def _digest(*key: object) -> bytes:
    payload = b"\x1f".join(str(part).encode("utf-8") for part in key)
    return hashlib.blake2b(SALT + b"\x1e" + payload, digest_size=32).digest()


def unit(*key: object) -> float:
    """Uniform in ``[0, 1)``, derived from ``key``."""
    (value,) = struct.unpack_from("<Q", _digest(*key))
    return (value >> 11) / float(1 << 53)


def between(low: float, high: float, *key: object) -> float:
    return low + (high - low) * unit(*key)


def integer(low: int, high: int, *key: object) -> int:
    """Uniform integer in ``[low, high]``."""
    span = high - low + 1
    (value,) = struct.unpack_from("<Q", _digest(*key))
    return low + value % span


def choice[T](options: list[T], *key: object) -> T:
    return options[integer(0, len(options) - 1, *key)]


def flag(probability: float, *key: object) -> bool:
    return unit(*key) < probability


def gaussian(*key: object) -> float:
    """Standard normal via Box-Muller on two derived uniforms."""
    u1 = max(unit("g1", *key), 1e-12)
    u2 = unit("g2", *key)
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
