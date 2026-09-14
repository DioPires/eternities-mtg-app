"""Byte-level codecs for ``stars.bin``, ``sets.bin`` and ``swatches.bin``.

See docs/data-contract.md §2, §5, §6 and docs/worlds/spec.md §2.2.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from uuid import UUID

from .enums import (
    BINARY_HEADER_BYTES,
    BINARY_MAGIC,
    CONTRACT_VERSION,
    STAR_RECORD_BYTES,
    SWATCH_RECORD_BYTES,
    BinaryKind,
    SetsSection,
    SizeClass,
    pack_colour_byte,
    unpack_colour_byte,
)
from .models import StarRecord, Swatch

_HEADER = struct.Struct("<4sBBHII")
_STAR = struct.Struct("<eeeBBBBBB")
_SWATCH = struct.Struct("<HHHH")
_SECTION_TABLE_ENTRY = struct.Struct("<IIII")

assert _HEADER.size == BINARY_HEADER_BYTES
assert _STAR.size == STAR_RECORD_BYTES
assert _SWATCH.size == SWATCH_RECORD_BYTES


class ContractError(ValueError):
    """A byte stream does not match the frozen contract."""


def encode_header(kind: BinaryKind, record_count: int, flags: int = 0) -> bytes:
    return _HEADER.pack(BINARY_MAGIC, int(kind), CONTRACT_VERSION, flags, record_count, 0)


def decode_header(data: bytes | bytearray | memoryview) -> tuple[BinaryKind, int, int]:
    """Return ``(kind, flags, record_count)``, raising on anything unexpected."""
    if len(data) < BINARY_HEADER_BYTES:
        raise ContractError(f"buffer shorter than the {BINARY_HEADER_BYTES}-byte header")
    magic, kind, version, flags, record_count, reserved = _HEADER.unpack_from(data, 0)
    if magic != BINARY_MAGIC:
        raise ContractError(f"bad magic {bytes(magic)!r}, expected {BINARY_MAGIC!r}")
    if version != CONTRACT_VERSION:
        raise ContractError(f"contract version {version}, this build speaks {CONTRACT_VERSION}")
    if reserved != 0:
        raise ContractError("reserved header word is not zero")
    return BinaryKind(kind), flags, record_count


def _u8(value: int, field: str) -> int:
    if not 0 <= value <= 255:
        raise ContractError(f"{field} must fit in a uint8, got {value}")
    return value


def encode_stars(stars: Sequence[StarRecord]) -> bytes:
    """``stars.bin``: header then one 12-byte record per card, in plane order."""
    out = bytearray(encode_header(BinaryKind.STARS, len(stars)))
    for i, s in enumerate(stars):
        try:
            out += _STAR.pack(
                s.x,
                s.y,
                s.z,
                _u8(s.plane_index, "planeIndex"),
                _u8(pack_colour_byte(s.hue, s.colour_identity), "colour"),
                _u8(int(s.size), "sizeClass"),
                _u8(s.brightness, "brightness"),
                _u8(s.twinkle_phase, "twinklePhase"),
                _u8(s.type_mask, "typeMask"),
            )
        except (struct.error, ContractError) as exc:
            raise ContractError(f"star {i}: {exc}") from exc
    return bytes(out)


def decode_stars(data: bytes | bytearray | memoryview) -> list[StarRecord]:
    """Inverse of :func:`encode_stars`. Used by tests and by the report, not by the browser."""
    kind, _flags, count = decode_header(data)
    if kind is not BinaryKind.STARS:
        raise ContractError(f"expected a stars file, got kind {kind}")
    expected = BINARY_HEADER_BYTES + count * STAR_RECORD_BYTES
    if len(data) != expected:
        raise ContractError(f"stars.bin is {len(data)} bytes, expected {expected}")

    out: list[StarRecord] = []
    for i in range(count):
        x, y, z, plane, colour, size, brightness, phase, mask = _STAR.unpack_from(
            data, BINARY_HEADER_BYTES + i * STAR_RECORD_BYTES
        )
        hue, identity = unpack_colour_byte(colour)
        out.append(
            StarRecord(
                x=x,
                y=y,
                z=z,
                plane_index=plane,
                hue=hue,
                colour_identity=identity,
                size=SizeClass(size),
                brightness=brightness,
                twinkle_phase=phase,
                type_mask=mask,
            )
        )
    return out


def encode_swatches(swatches: Sequence[Swatch]) -> bytes:
    """``swatches.bin``: header then one 8-byte record per card, in **star order** (§2.2).

    Star order is the whole encoding: a swatch lookup is ``starIndex * 8 + 16``, with no map and no
    offset table. That is only true while this stays parallel to ``stars.bin``, which is why the
    caller passes a sequence the :class:`~eternities.contract.models.Dataset` has already checked
    against its own star count.
    """
    out = bytearray(encode_header(BinaryKind.SWATCHES, len(swatches)))
    for i, swatch in enumerate(swatches):
        if len(swatch) != 4:
            raise ContractError(f"swatch {i}: expected 4 RGB565 samples, got {len(swatch)}")
        for sample in swatch:
            if not 0 <= sample <= 0xFFFF:
                raise ContractError(f"swatch {i}: {sample} does not fit in a uint16 RGB565 sample")
        out += _SWATCH.pack(*swatch)
    return bytes(out)


def decode_swatches(data: bytes | bytearray | memoryview) -> list[Swatch]:
    """Inverse of :func:`encode_swatches`. Used by the tests and the report, not by the browser."""
    kind, _flags, count = decode_header(data)
    if kind is not BinaryKind.SWATCHES:
        raise ContractError(f"expected a swatches file, got kind {kind}")
    expected = BINARY_HEADER_BYTES + count * SWATCH_RECORD_BYTES
    if len(data) != expected:
        raise ContractError(f"swatches.bin is {len(data)} bytes, expected {expected}")
    return [
        _SWATCH.unpack_from(data, BINARY_HEADER_BYTES + i * SWATCH_RECORD_BYTES)
        for i in range(count)
    ]


def _pad4(buffer: bytearray) -> None:
    while len(buffer) % 4:
        buffer.append(0)


def encode_sets(oracle_ids: Sequence[str], set_ids_per_star: Sequence[Sequence[int]]) -> bytes:
    """``sets.bin``: the sectioned sidecar that loads with ``search.json``.

    ``set_ids_per_star[i]`` must be ascending and deduplicated; the decoder relies on it for a
    sorted membership test (PRD 6.6.3).
    """
    star_count = len(oracle_ids)
    if len(set_ids_per_star) != star_count:
        raise ContractError("oracle_ids and set_ids_per_star must be parallel")

    oracle_bytes = bytearray()
    for i, oid in enumerate(oracle_ids):
        try:
            oracle_bytes += UUID(oid).bytes
        except ValueError as exc:
            raise ContractError(f"star {i}: {oid!r} is not a UUID") from exc

    counts = bytearray()
    entries = bytearray()
    for i, ids in enumerate(set_ids_per_star):
        if list(ids) != sorted(set(ids)):
            raise ContractError(
                f"star {i}: set ids must be ascending and deduplicated, got {ids!r}"
            )
        if len(ids) > 0xFFFF:
            raise ContractError(f"star {i}: {len(ids)} sets exceeds the uint16 count field")
        counts += struct.pack("<H", len(ids))
        for sid in ids:
            if not 0 <= sid <= 0xFFFF:
                raise ContractError(f"star {i}: set id {sid} does not fit in a uint16")
            entries += struct.pack("<H", sid)

    sections: list[tuple[SetsSection, bytes]] = [
        (SetsSection.ORACLE_IDS, bytes(oracle_bytes)),
        (SetsSection.SET_COUNTS, bytes(counts)),
        (SetsSection.SET_ENTRIES, bytes(entries)),
    ]

    table_bytes = _SECTION_TABLE_ENTRY.size * len(sections)
    body_start = BINARY_HEADER_BYTES + 8 + table_bytes
    out = bytearray(encode_header(BinaryKind.SETS, star_count))
    out += struct.pack("<II", len(sections), 0)

    table = bytearray()
    body = bytearray()
    for section_id, payload in sections:
        table += _SECTION_TABLE_ENTRY.pack(int(section_id), body_start + len(body), len(payload), 0)
        body += payload
        _pad4(body)

    return bytes(out + table + body)


def decode_sets(
    data: bytes | bytearray | memoryview,
) -> tuple[list[str], list[list[int]]]:
    """Inverse of :func:`encode_sets`."""
    kind, _flags, star_count = decode_header(data)
    if kind is not BinaryKind.SETS:
        raise ContractError(f"expected a sets file, got kind {kind}")
    section_count, reserved = struct.unpack_from("<II", data, BINARY_HEADER_BYTES)
    if reserved != 0:
        raise ContractError("reserved section-table word is not zero")

    found: dict[int, tuple[int, int]] = {}
    for i in range(section_count):
        sid, offset, length, sec_reserved = _SECTION_TABLE_ENTRY.unpack_from(
            data, BINARY_HEADER_BYTES + 8 + i * _SECTION_TABLE_ENTRY.size
        )
        if sec_reserved != 0:
            raise ContractError(f"section {sid}: reserved word is not zero")
        if offset + length > len(data):
            raise ContractError(f"section {sid} runs past the end of the buffer")
        found[sid] = (offset, length)

    for required in SetsSection:
        if int(required) not in found:
            raise ContractError(f"sets.bin is missing section {required.name}")

    oid_offset, oid_length = found[int(SetsSection.ORACLE_IDS)]
    if oid_length != star_count * 16:
        raise ContractError(f"ORACLE_IDS is {oid_length} bytes, expected {star_count * 16}")
    view = memoryview(data)
    oracle_ids = [
        str(UUID(bytes=bytes(view[oid_offset + i * 16 : oid_offset + i * 16 + 16])))
        for i in range(star_count)
    ]

    cnt_offset, cnt_length = found[int(SetsSection.SET_COUNTS)]
    if cnt_length != star_count * 2:
        raise ContractError(f"SET_COUNTS is {cnt_length} bytes, expected {star_count * 2}")
    counts = list(struct.unpack_from(f"<{star_count}H", data, cnt_offset))

    ent_offset, ent_length = found[int(SetsSection.SET_ENTRIES)]
    total = sum(counts)
    if ent_length != total * 2:
        raise ContractError(f"SET_ENTRIES is {ent_length} bytes, expected {total * 2}")
    flat = struct.unpack_from(f"<{total}H", data, ent_offset) if total else ()

    per_star: list[list[int]] = []
    cursor = 0
    for c in counts:
        per_star.append(list(flat[cursor : cursor + c]))
        cursor += c
    return oracle_ids, per_star
