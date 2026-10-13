"""The Story Spotlight sidecar of PRD v4 9.6: ``pipeline/data/lore/<slug>/spotlight.json``.

An era's headline cards are the Story Spotlight cards of its sets (5.13.2). The pinned pack does
not carry Scryfall's ``story_spotlight`` flag, so until the pipeline retains it per printing
(4.16.4) a sidecar lists the flagged **printing ids** among the plane's set codes with first
printings. ``pipeline/scripts/spotlight_sidecar.py`` writes the file from Scryfall's bulk data.

This module validates the file on every run: its fields and types, every id against the dataset's
printings, and the three things the file says about each id beside it (set code, collector number,
card name). Those three are assertions, not data. They make a list of UUIDs reviewable, and a row
whose assertion no longer holds fails here, as an ``overrides.json`` record's name does.

**How an id is mapped.** A printing id resolves to its card's ``oracle_id``, to the card's plane
and to its faces: the first face's name, which is the card's name in the dataset, and the second
face's name when the card has one. A printing id names a whole card, never one face of it.

**A flagged printing is not always a card of the plane.** A set code with first printings on a
plane also holds reprints, and cards that an override or a parent set put on another plane.
:attr:`SpotlightSidecar.on_plane` is the part a headline can travel to.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

from .index import LoreIndex
from .problems import LoreValidationError, Rule
from .tables import Check, is_date

SIDECAR_NAME: Final = "spotlight.json"

_UUID: Final = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


@dataclass(frozen=True, slots=True)
class SpotlightPrinting:
    printing_id: str
    oracle_id: str
    set_code: str
    collector_number: str
    name: str
    back_name: str | None
    card_plane: str
    """The plane the card stands on, which is not always the sidecar's plane."""


@dataclass(frozen=True, slots=True)
class SpotlightSidecar:
    plane: str
    fetched_on: str
    fetch_script: str
    bulk_updated_at: str
    printings: tuple[SpotlightPrinting, ...]

    @property
    def count(self) -> int:
        return len(self.printings)

    @property
    def on_plane(self) -> tuple[SpotlightPrinting, ...]:
        return tuple(p for p in self.printings if p.card_plane == self.plane)

    @property
    def by_set(self) -> dict[str, int]:
        return dict(Counter(p.set_code for p in self.printings))

    @property
    def sets_with_cards(self) -> frozenset[str]:
        """Set codes that carry a flagged printing of a card of the plane (F.0's headline rule)."""
        return frozenset(p.set_code for p in self.on_plane)


def validate_sidecar(
    path: Path, index: LoreIndex, *, hero_entries: tuple[str, ...], display: str | None = None
) -> SpotlightSidecar:
    """Validate ``<slug>/spotlight.json``; raise :class:`LoreValidationError` on any failure."""
    slug = path.parent.name
    file = path.name
    check = Check(slug, index, hero_entries, fixture=False, spotlight_sets=None)
    document = check.read(path, file)
    printings: list[SpotlightPrinting] = []
    top: dict[str, Any] = {}
    if document is not None:
        top = (
            check.shape(
                file,
                "",
                document,
                {
                    "plane": "string",
                    "fetched_on": "string",
                    "fetch_script": "string",
                    "bulk": "object",
                    "dataset": "string",
                    "set_codes": "array",
                    "count": "integer",
                    "printings": "array",
                },
            )
            or {}
        )
        check.plane(file, document)
        printings = _rows(check, file, top, index)

    if check.problems:
        raise LoreValidationError(display or str(path.parent), check.problems)
    bulk = cast("dict[str, Any]", top["bulk"])
    return SpotlightSidecar(
        plane=slug,
        fetched_on=str(top["fetched_on"]),
        fetch_script=str(top["fetch_script"]),
        bulk_updated_at=str(bulk["updated_at"]),
        printings=tuple(printings),
    )


def _rows(
    check: Check, file: str, top: dict[str, Any], index: LoreIndex
) -> list[SpotlightPrinting]:
    fetched_on = top.get("fetched_on")
    if fetched_on is not None and not is_date(fetched_on):
        check.add(
            Rule.SPOTLIGHT, file, "", "fetched_on", f"{fetched_on!r} is not a date YYYY-MM-DD"
        )
    if top.get("fetch_script") == "":
        check.add(Rule.SPOTLIGHT, file, "", "fetch_script", "is empty; it names the fetch script")
    if "bulk" in top:
        check.shape(
            file, "bulk", top["bulk"], {"type": "string", "updated_at": "string"}, prefix=""
        )

    codes: list[str] | None = None
    if "set_codes" in top:
        codes = check.strings(file, "", "set_codes", cast("list[Any]", top["set_codes"]))
    if codes is not None and set(codes) != set(check.expected):
        missing = sorted(set(check.expected) - set(codes))
        extra = sorted(set(codes) - set(check.expected))
        check.add(
            Rule.SPOTLIGHT,
            file,
            "",
            "set_codes",
            f"is not the set codes with first printings on {check.slug} in dataset {index.label} "
            f"(missing {missing or 'none'}, not on the plane {extra or 'none'}); run "
            "the fetch script again",
        )

    rows = cast("list[Any]", top.get("printings", []))
    if "count" in top and "printings" in top and top["count"] != len(rows):
        check.add(
            Rule.SPOTLIGHT,
            file,
            "",
            "count",
            f"is {top['count']} and the file lists {len(rows)} printings",
        )

    printings: list[SpotlightPrinting] = []
    seen: dict[str, str] = {}
    for position, raw in enumerate(rows):
        row = f"printings[{position}]"
        entry = check.shape(
            file,
            row,
            raw,
            {"id": "string", "set": "string", "collector_number": "string", "name": "string"},
        )
        if entry is None or "id" not in entry:
            continue
        ident = cast("str", entry["id"])
        if not _UUID.fullmatch(ident):
            check.add(Rule.SPOTLIGHT, file, row, "id", f"{ident!r} is not a lower-case UUID")
            continue
        if ident in seen:
            check.add(Rule.SPOTLIGHT, file, row, "id", f"{ident} is also the id of {seen[ident]}")
            continue
        seen[ident] = row
        found = index.printings.get(ident)
        if found is None:
            check.add(
                Rule.SPOTLIGHT_NOT_IN_DATASET,
                file,
                row,
                "id",
                f"printing {ident} is not a printing of dataset {index.label} (9.6)",
            )
            continue
        card = index.cards[found.oracle_id]
        stated = {
            "set": found.set_code,
            "collector_number": found.collector_number,
            "name": card.name,
        }
        for field, actual in stated.items():
            if field in entry and entry[field] != actual:
                check.add(
                    Rule.SPOTLIGHT,
                    file,
                    row,
                    field,
                    f"is {entry[field]!r}; printing {ident} is {actual!r} in dataset {index.label}",
                )
        if codes is not None and found.set_code not in codes:
            check.add(
                Rule.SPOTLIGHT,
                file,
                row,
                "set",
                f"{found.set_code!r} is not one of the file's set_codes",
            )
        printings.append(
            SpotlightPrinting(
                printing_id=ident,
                oracle_id=found.oracle_id,
                set_code=found.set_code,
                collector_number=found.collector_number,
                name=card.name,
                back_name=card.back_name,
                card_plane=card.plane,
            )
        )
    return printings
