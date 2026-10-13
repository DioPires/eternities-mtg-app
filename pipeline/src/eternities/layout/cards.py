"""The cards of one plane as the allocator and the emission read them, from a contract v3 pack.

Leg 1 of the second slice lays a world out beside the slice's pinned v3 pack (PRD v4 9.6): the
full contract v4 is Wave 5. Every field of a 48-byte stand record (4.13.3) that is not a position
is therefore taken from the v3 pack, and ``docs/data-contract-v4.md`` lists each as a departure:

- The **plane index** is the plane's position in v3 ``planes.json``.
- The **set id** is v3's global set id, the one ``search.json`` lists. The v3 pipeline numbers the
  sets by release date, ties by set code, so "release order, ties by code" (5.4.2, 5.4.3) is the
  order of the set ids.
- The colour identity mask, the rarity class and the type mask are derived from the card's shard
  row by the v3 contract's own functions; the class is derived from the mask (4.13.3).
- The **back-image flag** follows v3's face rules, with a meld component counted (4.13.3).
- The **swatch** is one RGB565 colour: the mean, channel by channel and rounded half up, of the
  four samples of the card's v3 ``swatches.bin`` record. A pack with no ``swatches.bin`` (a
  synthetic fixture pack, which is text only) gives every stand the swatch 0.
- The **shard index** and the index within the shard are the card's position in the plane's v3
  shards, which are in star order.

This module computes no position and is no part of the allocator's arithmetic.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

from ..contract.enums import colour_identity_mask, type_mask_for
from ..contract.images import has_back_image

SHARD_SIZE: Final = 2_000
_SWATCH_HEADER: Final = 16
_SWATCH_RECORD: Final = 8


class PackError(RuntimeError):
    """The pack on disk cannot give the allocator a plane's cards."""


@dataclass(frozen=True, slots=True)
class PlaneSet:
    id: int
    code: str
    name: str
    year: int


@dataclass(frozen=True, slots=True)
class PlaneCard:
    oracle_id: str
    name: str
    back_name: str | None
    type_line: str
    set_id: int
    """The v3 global set id of the card's first printing."""
    set_code: str
    identity: int
    rarity: int
    type_mask: int
    back_image: bool
    printings: int
    swatch: int
    local_index: int
    """The card's position in the plane's v3 star range: shard and index within it follow."""

    @property
    def colour_class(self) -> int:
        """0 W, 1 U, 2 B, 3 R, 4 G, 5 gold, 6 colourless, from the mask (4.13.3)."""
        if self.identity == 0:
            return 6
        if self.identity & (self.identity - 1):
            return 5
        return self.identity.bit_length() - 1

    @property
    def shard(self) -> int:
        return self.local_index // SHARD_SIZE

    @property
    def shard_slot(self) -> int:
        return self.local_index % SHARD_SIZE

    @property
    def order_key(self) -> bytes:
        """The ``oracle_id`` bytes, RFC 4122 network order (5.4.3, 4.13.3)."""
        return bytes.fromhex(self.oracle_id.replace("-", ""))


@dataclass(frozen=True, slots=True)
class PlaneCards:
    data_hash: str
    slug: str
    display_name: str
    plane_index: int
    sets: tuple[PlaneSet, ...]
    """The sets with first printings on the plane, in release order (ties by code)."""
    cards: tuple[PlaneCard, ...]

    def set_by_code(self) -> dict[str, PlaneSet]:
        return {record.code: record for record in self.sets}


def _read(path: Path) -> dict[str, Any]:
    try:
        return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        raise PackError(f"the data pack {path.parent.name} is missing {path.name}") from None


def mean_swatch(samples: tuple[int, int, int, int]) -> int:
    """One RGB565 colour for four: the mean of each channel, rounded half up."""
    red = sum(sample >> 11 for sample in samples)
    green = sum((sample >> 5) & 0x3F for sample in samples)
    blue = sum(sample & 0x1F for sample in samples)
    return ((red + 2) // 4) << 11 | ((green + 2) // 4) << 5 | ((blue + 2) // 4)


def _swatches(data_dir: Path, offset: int, count: int) -> list[int]:
    path = data_dir / "swatches.bin"
    if not path.exists():
        return [0] * count
    data = path.read_bytes()
    start = _SWATCH_HEADER + offset * _SWATCH_RECORD
    end = start + count * _SWATCH_RECORD
    if data[:4] != b"ETRN" or len(data) < end:
        raise PackError(f"swatches.bin of pack {data_dir.name} does not hold the plane's records")
    values = struct.unpack(f"<{4 * count}H", data[start:end])
    return [
        mean_swatch((values[4 * i], values[4 * i + 1], values[4 * i + 2], values[4 * i + 3]))
        for i in range(count)
    ]


def read_plane(data_dir: Path, slug: str) -> PlaneCards:
    """The cards of ``slug`` from the v3 pack at ``data_dir``, in the pack's star order."""
    planes = cast("list[dict[str, Any]]", _read(data_dir / "planes.json")["planes"])
    position = next((i for i, plane in enumerate(planes) if plane["slug"] == slug), None)
    if position is None:
        raise PackError(f"the data pack {data_dir.name} has no plane {slug!r}")
    plane = planes[position]
    listed = cast("list[dict[str, Any]]", _read(data_dir / "search.json")["sets"])
    code_of = {int(record["id"]): str(record["code"]) for record in listed}
    sets = tuple(
        PlaneSet(
            id=int(record["id"]),
            code=str(record["code"]),
            name=str(record["name"]),
            year=int(record["year"]),
        )
        for record in cast("list[dict[str, Any]]", plane["sets"])
    )
    if [record.id for record in sets] != sorted(record.id for record in sets):
        raise PackError(f"plane {slug} of pack {data_dir.name} lists its sets out of id order")
    count = int(plane["starCount"])
    swatches = _swatches(data_dir, int(plane["starOffset"]), count)
    cards: list[PlaneCard] = []
    for shard in range(int(plane["shardCount"])):
        rows = cast(
            "list[dict[str, Any]]", _read(data_dir / "planes" / f"{slug}.{shard}.json")["cards"]
        )
        for row in rows:
            printings = cast("list[list[Any]]", row["p"])
            back = cast("dict[str, Any] | None", row["b"])
            layout = str(row["l"])
            set_id = int(printings[0][1])
            local_index = len(cards)
            cards.append(
                PlaneCard(
                    oracle_id=str(row["u"]),
                    name=str(row["n"]),
                    back_name=None if back is None else str(back["n"]),
                    type_line=str(row["t"]),
                    set_id=set_id,
                    set_code=code_of[set_id],
                    identity=colour_identity_mask(str(row["ci"])),
                    rarity=int(row["r"]),
                    type_mask=type_mask_for(str(row["t"])),
                    back_image=has_back_image(layout)
                    or (layout == "meld" and back is not None and back.get("id") is not None),
                    printings=min(len(printings), 0xFFFF),
                    swatch=swatches[local_index] if local_index < count else 0,
                    local_index=local_index,
                )
            )
    if len(cards) != count:
        raise PackError(
            f"plane {slug} of pack {data_dir.name} holds {len(cards)} cards in its shards and "
            f"planes.json counts {count}"
        )
    return PlaneCards(
        data_hash=data_dir.name,
        slug=slug,
        display_name=str(plane["displayName"]),
        plane_index=position,
        sets=sets,
        cards=tuple(cards),
    )
