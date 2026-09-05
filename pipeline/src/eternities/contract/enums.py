"""Enumerations shared by every artefact. Frozen: see docs/data-contract.md §2."""

from __future__ import annotations

from enum import IntEnum, StrEnum
from typing import Final

CONTRACT_VERSION: Final = 2
"""Bumped only for a byte-layout, section-id, enum-value or filename change.

v2 is amendment A3: star-record byte 7 packs the colour identity into the hue class's spare bits.
"""

PIPELINE_VERSION: Final = "0.4.0"
"""Bumped when a field is added, per docs/data-contract.md §10. 0.4.0 adds `colourIdentity`."""

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


class ColourBit(IntEnum):
    """Bit index in the star record's colour-identity mask (PRD 6.6.2, amendment A3).

    Deliberately the same indices as :class:`HueClass`'s five mono values, so a mono-coloured
    card satisfies ``identity == 1 << hue`` and the two fields can be cross-checked.
    """

    WHITE = 0
    BLUE = 1
    BLACK = 2
    RED = 3
    GREEN = 4


HUE_CLASS_MASK: Final = 0b0000_0111
"""Byte 7, bits 0-2: the :class:`HueClass`. Seven values, so three bits."""

COLOUR_IDENTITY_SHIFT: Final = 3
COLOUR_IDENTITY_MASK: Final = 0b0001_1111
"""Byte 7, bits 3-7: the five-bit WUBRG identity, read after shifting down."""


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


LAYOUTS: Final[frozenset[str]] = frozenset(
    {
        "normal",
        "split",
        "flip",
        "transform",
        "modal_dfc",
        "meld",
        "leveler",
        "class",
        "case",
        "saga",
        "adventure",
        "mutate",
        "prototype",
        "battle",
        "planar",
        "scheme",
        "vanguard",
        "token",
        "double_faced_token",
        "emblem",
        "augment",
        "host",
        "art_series",
        "reversible_card",
        # Added by the Phase 1 first run (2026-09-04), which failed loudly on both per PRD 7.7.2.
        # `prepare` is Secrets of Strixhaven's two-faces-on-one-side layout: like `split` it has a
        # second face and no back image, and Scryfall gives it no top-level oracle text at all.
        # `front_card` is a Jumpstart theme card; every set carrying one is `memorabilia`, so
        # 4.3.2 drops it long before it could reach a shard.
        "prepare",
        "front_card",
    }
)
"""Every Scryfall ``layout`` value. Closed on purpose: ``l`` in a plane shard is this union, and
which layouts have a *back image* is derived from it (``images.has_back_image``). An unknown
layout fails the run rather than guessing at a URI that would 404 (PRD 7.7.2)."""


def assert_known_layout(layout: str) -> str:
    """Fail loudly on a layout this contract has not classified (PRD 7.7.2)."""
    if layout not in LAYOUTS:
        raise ValueError(f"unknown Scryfall layout {layout!r}")
    return layout


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

_COLOUR_TO_BIT: Final[dict[str, ColourBit]] = {
    "W": ColourBit.WHITE,
    "U": ColourBit.BLUE,
    "B": ColourBit.BLACK,
    "R": ColourBit.RED,
    "G": ColourBit.GREEN,
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


def colour_identity_mask(colour_identity: str) -> int:
    """Map a colour-identity string such as ``"WU"`` to its five-bit WUBRG mask (PRD 6.6.2).

    Colourless is 0, which is why the filter needs the hue class as well: 0 is both "no colours"
    and "the field was never written", and only ``hueClass == COLOURLESS`` distinguishes them.
    """
    mask = 0
    for letter in colour_identity.upper():
        bit = _COLOUR_TO_BIT.get(letter)
        if bit is not None:
            mask |= 1 << bit
    return mask


def pack_colour_byte(hue: HueClass, identity: int) -> int:
    """Byte 7 of the star record: hue class in bits 0-2, colour identity in bits 3-7."""
    if not 0 <= int(hue) <= HUE_CLASS_MASK:
        raise ValueError(f"hue class {int(hue)} does not fit in three bits")
    if not 0 <= identity <= COLOUR_IDENTITY_MASK:
        raise ValueError(f"colour identity {identity} does not fit in five bits")
    return int(hue) | (identity << COLOUR_IDENTITY_SHIFT)


def unpack_colour_byte(value: int) -> tuple[HueClass, int]:
    """Inverse of :func:`pack_colour_byte`."""
    return (
        HueClass(value & HUE_CLASS_MASK),
        (value >> COLOUR_IDENTITY_SHIFT) & COLOUR_IDENTITY_MASK,
    )


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
