"""Byte-level checks on the frozen binary layouts (docs/data-contract.md §2, §5, §6)."""

from __future__ import annotations

import struct

import pytest

from eternities.contract import (
    BINARY_HEADER_BYTES,
    STAR_RECORD_BYTES,
    ContractError,
    HueClass,
    SizeClass,
    StarRecord,
    decode_header,
    decode_sets,
    decode_stars,
    encode_sets,
    encode_stars,
)
from eternities.contract.enums import BinaryKind, SetsSection


def _star(**kwargs: object) -> StarRecord:
    base = {
        "x": 0.5,
        "y": -0.25,
        "z": 0.125,
        "plane_index": 3,
        "hue": HueClass.BLUE,
        "size": SizeClass.RARE,
        "brightness": 200,
        "twinkle_phase": 17,
        "type_mask": 0b0000_0101,
    }
    return StarRecord(**{**base, **kwargs})  # pyright: ignore[reportArgumentType]


def test_header_is_sixteen_bytes_and_self_describing():
    data = encode_stars([_star()])
    assert data[:4] == b"ETRN"
    kind, flags, count = decode_header(data)
    assert (kind, flags, count) == (BinaryKind.STARS, 0, 1)
    assert len(data) == BINARY_HEADER_BYTES + STAR_RECORD_BYTES


def test_star_record_field_offsets_are_frozen():
    data = encode_stars([_star()])
    body = data[BINARY_HEADER_BYTES:]
    assert len(body) == 12
    assert struct.unpack_from("<eee", body, 0) == (0.5, -0.25, 0.125)
    assert body[6] == 3  # planeIndex
    assert body[7] == int(HueClass.BLUE)
    assert body[8] == int(SizeClass.RARE)
    assert body[9] == 200  # brightness
    assert body[10] == 17  # twinklePhase
    assert body[11] == 0b0000_0101  # typeMask


def test_star_round_trip():
    stars = [_star(), _star(x=-1.194, plane_index=0, brightness=0, twinkle_phase=255)]
    decoded = decode_stars(encode_stars(stars))
    assert len(decoded) == 2
    assert decoded[0].x == 0.5, "0.5 is exact in float16"
    assert decoded[0].type_mask == 0b0000_0101
    assert abs(decoded[1].x - -1.194) < 1e-3
    assert decoded[1].brightness == 0
    assert decoded[1].twinkle_phase == 255


def test_star_rejects_out_of_range_uint8():
    with pytest.raises(ContractError, match="brightness"):
        encode_stars([_star(brightness=256)])
    with pytest.raises(ContractError, match="planeIndex"):
        encode_stars([_star(plane_index=300)])


def test_stars_truncated_buffer_is_rejected():
    data = encode_stars([_star(), _star()])
    with pytest.raises(ContractError, match="expected"):
        decode_stars(data[:-1])


def test_sets_round_trip():
    oracle_ids = [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
    ]
    per_star = [[0], [], [1, 4, 9]]
    ids, sets = decode_sets(encode_sets(oracle_ids, per_star))
    assert ids == oracle_ids
    assert sets == per_star


def test_sets_sections_are_four_byte_aligned_and_in_order():
    data = encode_sets(["00000000-0000-4000-8000-000000000001"], [[7]])
    section_count, reserved = struct.unpack_from("<II", data, BINARY_HEADER_BYTES)
    assert (section_count, reserved) == (3, 0)
    offsets: list[int] = []
    for i in range(section_count):
        sid, offset, length, _ = struct.unpack_from("<IIII", data, BINARY_HEADER_BYTES + 8 + i * 16)
        assert sid == i + 1, "sections are written in ascending id order"
        assert offset % 4 == 0, "a decoder must be able to create typed-array views in place"
        offsets.append(offset)
        assert offset + length <= len(data)
    assert offsets == sorted(offsets)
    assert SetsSection.ORACLE_IDS == 1


def test_sets_rejects_unsorted_or_duplicated_ids():
    oid = ["00000000-0000-4000-8000-000000000001"]
    with pytest.raises(ContractError, match="ascending"):
        encode_sets(oid, [[3, 1]])
    with pytest.raises(ContractError, match="ascending"):
        encode_sets(oid, [[1, 1]])


def test_sets_rejects_non_uuid_oracle_id():
    with pytest.raises(ContractError, match="not a UUID"):
        encode_sets(["not-a-uuid"], [[]])


def test_kind_mismatch_is_loud():
    with pytest.raises(ContractError, match="expected a stars file"):
        decode_stars(encode_sets([], []))
    with pytest.raises(ContractError, match="expected a sets file"):
        decode_sets(encode_stars([]))


def test_bad_magic_is_loud():
    data = bytearray(encode_stars([_star()]))
    data[0] = ord("X")
    with pytest.raises(ContractError, match="bad magic"):
        decode_stars(bytes(data))
