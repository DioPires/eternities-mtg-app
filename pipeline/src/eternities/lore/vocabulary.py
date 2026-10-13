"""The Appendix C values a lore table may name, and the twenty hero entries.

Appendix C ingestion (PRD v4 4.12: ``kits.yaml`` and ``themes.yaml``) is not in the pipeline yet.
Until it is, the three value lists a region row is checked against are the constants below, copied
from PRD v4 5.6.1 and 4.12.2, and the hero entries are read from one committed list,
``pipeline/data/appendix_c_heroes.json``. A region's ``variant`` must be "a variant ``kits.yaml``
lists for that kit" (F.0); with no ``kits.yaml`` there is no list, so the validator checks its form
only and the report says so. All of this moves to the Appendix C loader when 4.12 lands.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final, cast

_DATA_DIR: Final = Path(__file__).resolve().parents[3] / "data"
HERO_ENTRIES_FILE: Final = _DATA_DIR / "appendix_c_heroes.json"
ROSTER_FILE: Final = _DATA_DIR / "appendix_a.json"

HERO_ENTRY_COUNT: Final = 20
"""PRD v4 4.16.5: "exactly the twenty of Appendix C.1, asserted"."""

BLIND_ETERNITIES: Final = "blind-eternities"
"""The one entry whose tables are ``kind: product`` (F.0, 5.13.8)."""

KITS: Final = frozenset(
    {
        "temperate",
        "forest",
        "coast",
        "desert",
        "volcanic",
        "mountain",
        "swamp",
        "moor",
        "stone-city",
        "filigree-city",
        "phyrexian",
        "void",
    }
)
"""The twelve kits of PRD v4 5.6.1."""

MAX_KITS_PER_ENTRY: Final = 3
"""PRD v4 4.16.2 and 11.18."""

WATER: Final = frozenset(
    {
        "none",
        "river",
        "lake",
        "river+lake",
        "sea",
        "canals",
        "marsh",
        "lava",
        "oil",
        "waterfall",
    }
)
"""PRD v4 4.12.2."""

AMBIENT: Final = frozenset(
    {
        "meadow",
        "forest",
        "surf",
        "desert-wind",
        "volcanic",
        "alpine-wind",
        "marsh",
        "moor-wind",
        "city",
        "workshop",
        "machinery",
        "void",
        "jungle",
        "campus",
    }
)
"""PRD v4 4.12.2."""


class HeroEntriesError(RuntimeError):
    """The committed list is not the twenty hero entries of Appendix C.1."""


def load_hero_entries(
    path: Path = HERO_ENTRIES_FILE, *, plane_slugs: tuple[str, ...] | None = None
) -> tuple[str, ...]:
    """The hero entries, in Appendix C.1's order.

    Every entry must be a plane of the roster: a hero entry that is not one is a typing error in
    the list, and it fails here. ``plane_slugs`` is the roster; ``None`` reads Appendix A's
    committed table. The roster is not a pack's plane list on purpose: a synthetic fixture pack
    (5.4.14) holds a few planes, and the twenty hero entries stay the twenty.
    """
    document = cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))
    entries = tuple(str(slug) for slug in cast("list[Any]", document["heroEntries"]))
    if len(entries) != HERO_ENTRY_COUNT or len(set(entries)) != len(entries):
        raise HeroEntriesError(
            f"{path.name} lists {len(entries)} hero entries ({len(set(entries))} distinct); "
            f"Appendix C.1 has exactly {HERO_ENTRY_COUNT} (PRD v4 4.16.5)"
        )
    if plane_slugs is None:
        roster = cast("dict[str, Any]", json.loads(ROSTER_FILE.read_text(encoding="utf-8")))
        plane_slugs = tuple(str(row["slug"]) for row in cast("list[Any]", roster["planes"]))
    unknown = [slug for slug in entries if slug not in plane_slugs]
    if unknown:
        raise HeroEntriesError(
            f"{path.name} names {unknown}, which Appendix A does not list as a plane"
        )
    return entries
