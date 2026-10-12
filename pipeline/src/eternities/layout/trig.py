"""The committed trig table of PRD v4 5.4.18 (6), read with its SHA-256 asserted first.

``contract/test-vectors/v4/layout/trig.bin`` holds, for every integer ``k`` in ``[0, 360,000)``,
sin and cos of ``k`` thousandths of a degree as little-endian int32 scaled by 2^30: record ``k`` is
the 8 bytes at ``8 * k``, sin then cos, and the file is 2,880,000 bytes with no header.

The table's bytes are the contract. They were generated once by ``pipeline/scripts/trig_table.py``
and are never regenerated at build: :func:`load` reads the committed file and refuses it unless its
SHA-256 is :data:`TRIG_SHA256`. A change to the table is a change to every layout fixture, and goes
through PRD 5.4.18 (12) with the hash below edited in the same pull request.

A table value divided by 2^30 is used as an exact rational (5.4.18 (6)); nothing here makes a
float.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Final

TRIG_TABLE: Final = (
    Path(__file__).resolve().parents[4] / "contract" / "test-vectors" / "v4" / "layout" / "trig.bin"
)
TRIG_SHA256: Final = "fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777"

COUNTS: Final = 360_000
"""Thousandths of a degree in one turn: the number of records."""
SCALE: Final = 1 << 30
RECORD_BYTES: Final = 8
TABLE_BYTES: Final = COUNTS * RECORD_BYTES


class TrigTableError(RuntimeError):
    """The trig table is missing or is not the committed table. The build stops."""


@dataclass(frozen=True, slots=True)
class TrigTable:
    """sin and cos by count of thousandths of a degree, each an integer scaled by 2^30."""

    values: tuple[int, ...]
    sha256: str

    def sin(self, count: int) -> int:
        return self.values[2 * self._index(count)]

    def cos(self, count: int) -> int:
        return self.values[2 * self._index(count) + 1]

    @staticmethod
    def _index(count: int) -> int:
        # Reducing an angle to [0, 360,000) is the caller's rule (5.4.18 (6): modulo, then
        # truncation toward zero). A count outside the table is a defect there, not a wrap here.
        if not 0 <= count < COUNTS:
            raise IndexError(f"trig count {count} is outside [0, {COUNTS})")
        return count


def load(path: Path | None = None, *, expected_sha256: str | None = None) -> TrigTable:
    """Read the table, asserting its SHA-256 before a single value is used.

    Both arguments default to this module's constants, read when the call is made.
    """
    path = TRIG_TABLE if path is None else path
    expected_sha256 = TRIG_SHA256 if expected_sha256 is None else expected_sha256
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        raise TrigTableError(f"the trig table {path} does not exist (PRD v4 5.4.18 (6))") from None
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected_sha256:
        raise TrigTableError(
            f"the trig table {path} is not the committed table: its SHA-256 is {actual} "
            f"({len(data):,} bytes) and the pipeline expects {expected_sha256} "
            f"({TABLE_BYTES:,} bytes). The table is generated once and never at build "
            "(PRD v4 5.4.18 (6)); restore the file, or change it under 5.4.18 (12)."
        )
    return TrigTable(values=struct.unpack(f"<{2 * COUNTS}i", data), sha256=actual)
