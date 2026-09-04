"""Enumerations shared by every artefact. Frozen: see docs/data-contract.md §2."""

from __future__ import annotations

from enum import IntEnum, StrEnum
from typing import Final

CONTRACT_VERSION: Final = 1
"""Bumped only for a byte-layout, section-id, enum-value or filename change."""

PIPELINE_VERSION: Final = "0.1.0"

STAR_RECORD_BYTES: Final = 12
BINARY_HEADER_BYTES: Final = 16
BINARY_MAGIC: Final = b"ETRN"

SHARD_SIZE: Final = 2000
"""Amendment A1: every plane's detail file shards at this many cards."""

BLIND_ETERNITIES_SLUG: Final = "blind-eternities"

FRAME_RADIUS: Final = 1.2
"""PRD 8.6.2: plane-local positions live inside this radius."""


class BinaryKind(IntEnum):
    STARS = 1
    SETS = 2


class HueClass(IntEnum):
    """PRD 5.4.8. A card carries exactly one class; hues are never mixed."""

    WHITE = 0
    BLUE = 1
    BLACK = 2
    RED = 3
    GREEN = 4
    MULTICOLOUR = 5
    COLOURLESS = 6


class SizeClass(IntEnum):
    """PRD 5.4.9 and 4.8: ``special`` maps to rare, ``bonus`` maps to mythic."""

    COMMON = 0
    UNCOMMON = 1
    RARE = 2
    MYTHIC = 3


class CardType(IntEnum):
    """Bit index in the star record's type mask. PRD 6.6.2's eight filterable types."""

    CREATURE = 0
    INSTANT = 1
    SORCERY = 2
    ARTIFACT = 3
    ENCHANTMENT = 4
    PLANESWALKER = 5
    LAND = 6
    BATTLE = 7


class PlaneKind(StrEnum):
    """PRD 5.3.6 morphology, decided by card count."""

    DUST = "dust"
    SPIRAL = "spiral"
    IRREGULAR = "irregular"
    EMPTY = "empty"


class SetsSection(IntEnum):
    """Section ids inside ``sets.bin``. See docs/data-contract.md §6."""

    ORACLE_IDS = 1
    SET_COUNTS = 2
    SET_ENTRIES = 3


RARITY_TO_SIZE_CLASS: Final[dict[str, SizeClass]] = {
    "common": SizeClass.COMMON,
    "uncommon": SizeClass.UNCOMMON,
    "rare": SizeClass.RARE,
    "mythic": SizeClass.MYTHIC,
    "special": SizeClass.RARE,
    "bonus": SizeClass.MYTHIC,
}

SIZE_CLASS_TO_RARITY_CHAR: Final[dict[SizeClass, str]] = {
    SizeClass.COMMON: "c",
    SizeClass.UNCOMMON: "u",
    SizeClass.RARE: "r",
    SizeClass.MYTHIC: "m",
}

_COLOUR_TO_HUE: Final[dict[str, HueClass]] = {
    "W": HueClass.WHITE,
    "U": HueClass.BLUE,
    "B": HueClass.BLACK,
    "R": HueClass.RED,
    "G": HueClass.GREEN,
}

TYPE_KEYWORDS: Final[tuple[tuple[str, CardType], ...]] = (
    ("creature", CardType.CREATURE),
    ("instant", CardType.INSTANT),
    ("sorcery", CardType.SORCERY),
    ("artifact", CardType.ARTIFACT),
    ("enchantment", CardType.ENCHANTMENT),
    ("planeswalker", CardType.PLANESWALKER),
    ("land", CardType.LAND),
    ("battle", CardType.BATTLE),
)


def hue_class_for(colour_identity: str) -> HueClass:
    """Map a colour-identity string such as ``"WU"`` to its hue class (PRD 5.4.8)."""
    letters = [c for c in colour_identity.upper() if c in _COLOUR_TO_HUE]
    if not letters:
        return HueClass.COLOURLESS
    if len(set(letters)) > 1:
        return HueClass.MULTICOLOUR
    return _COLOUR_TO_HUE[letters[0]]


def size_class_for(rarity: str) -> SizeClass:
    """Map a Scryfall rarity to a size class, failing loudly on unknown values (PRD 7.7.2)."""
    try:
        return RARITY_TO_SIZE_CLASS[rarity]
    except KeyError:
        raise ValueError(f"unknown Scryfall rarity {rarity!r}") from None


def type_mask_for(type_line: str) -> int:
    """Bitmask of PRD 6.6.2 types present in a front-face type line.

    Conspiracy cards carry no bit, so they match only while no type facet is active (PRD 6.6.2).
    """
    # Only the part before the em dash carries card types; subtypes ("Island", "Wall") must not
    # set a bit, so match whole words rather than substrings.
    head = type_line.split("—")[0].split("//")[0]
    words = {w.strip().lower() for w in head.replace("-", " ").split()}
    mask = 0
    for keyword, bit in TYPE_KEYWORDS:
        if keyword in words or f"{keyword}s" in words:
            mask |= 1 << bit
    return mask
