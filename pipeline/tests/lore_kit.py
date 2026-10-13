"""A small dataset and a valid table set for the lore tests.

The lore rules are checked against a dataset (PRD v4 4.16.2), and the real one holds 28,603 cards.
The rules themselves need a handful: one card per set, one card with a second face, one reprint and
one card on another plane. ``INDEX`` is that dataset, built through the same builder both readers
use. ``regions()``, ``eras()`` and ``keywords()`` return a fresh, valid table each call, so a test
changes the one value its rule is about and writes the three files with ``write``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from eternities.lore.index import LoreIndex, _Builder
from eternities.lore.problems import LoreValidationError, Problem
from eternities.lore.tables import LoreTables, validate_directory

HEROES = ("dominaria", "blind-eternities")


def oracle(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def printing_id(n: int) -> str:
    return f"11111111-0000-4000-8000-{n:012d}"


def _index() -> LoreIndex:
    builder = _Builder("synthetic")
    builder.plane("blind-eternities", ["pr1", "pr2", "pr3", "pr4"])
    for n, code in enumerate(["pr1", "pr2", "pr3", "pr4"], start=11):
        builder.card(
            "blind-eternities",
            oracle_id=oracle(n),
            name=f"Product {n}",
            back_name=None,
            printings=[(printing_id(n), code, "1")],
        )
    builder.plane("dominaria", ["aaa", "bbb", "ccc", "ddd"])
    builder.card(
        "dominaria",
        oracle_id=oracle(1),
        name="Alpha One",
        back_name=None,
        # First printed in `aaa`, reprinted in `ddd`.
        printings=[(printing_id(1), "aaa", "1"), (printing_id(101), "ddd", "7")],
    )
    builder.card(
        "dominaria",
        oracle_id=oracle(2),
        name="Beta One",
        back_name=None,
        printings=[(printing_id(2), "bbb", "2")],
    )
    builder.card(
        "dominaria",
        oracle_id=oracle(3),
        name="Gamma One",
        back_name="Gamma Other",
        printings=[(printing_id(3), "ccc", "3")],
    )
    builder.card(
        "dominaria",
        oracle_id=oracle(4),
        name="Delta One",
        back_name=None,
        printings=[(printing_id(4), "ddd", "4")],
    )
    builder.plane("ravnica", ["rrr"])
    builder.card(
        "ravnica",
        oracle_id=oracle(5),
        name="Rho One",
        back_name=None,
        # A card of another plane, reprinted in one of Dominaria's sets.
        printings=[(printing_id(5), "rrr", "5"), (printing_id(105), "ddd", "9")],
    )
    return builder.build()


INDEX = _index()

WIZARDS = "https://magic.wizards.com/en/story/the-brothers-war"


def sentence(text: str = "A place of stone and wind.", source: str = WIZARDS) -> dict[str, Any]:
    return {"text": text, "source": source}


def region(ident: str, anchor: list[int], kit: str = "temperate", **more: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": ident,
        "name": ident.title(),
        "kit": kit,
        "anchor": anchor,
        "weight": 1000,
        "water": "river",
        "sentence": sentence(),
        "sources": [WIZARDS],
    }
    row.update(more)
    return row


def regions() -> dict[str, Any]:
    return {
        "plane": "dominaria",
        "regions": [
            region("north", [0, 500]),
            region("east", [500, 0], kit="coast"),
            region("south", [0, -500], kit="volcanic"),
            region("west", [-500, 0]),
        ],
    }


def era(ident: str, region_id: str, sets: list[str], **more: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": ident,
        "name": ident.title(),
        "years": "Long before the first war",
        "region": region_id,
        "sets": sets,
        "headline": [],
        "paragraphs": [[sentence("The first people came by sea.", f"card:{oracle(1)}")]],
    }
    row.update(more)
    return row


def eras() -> dict[str, Any]:
    return {
        "plane": "dominaria",
        "kind": "lore",
        "eras": [
            era("dawn", "north", ["aaa"]),
            era("noon", "east", ["bbb", "ccc"]),
            era("dusk", "south", ["ddd"]),
        ],
    }


def keywords() -> dict[str, Any]:
    return {"plane": "dominaria", "keywords": [{"word": "Alpha", "region": "north"}]}


def write(
    root: Path,
    *,
    regions_table: dict[str, Any] | None = None,
    eras_table: dict[str, Any] | None = None,
    keywords_table: dict[str, Any] | None = None,
    slug: str = "dominaria",
) -> Path:
    """Write the three files under ``root/<slug>/`` and return that directory."""
    directory = root / slug
    directory.mkdir(parents=True, exist_ok=True)
    tables = {
        "regions.json": regions() if regions_table is None else regions_table,
        "eras.json": eras() if eras_table is None else eras_table,
        "keywords.json": keywords() if keywords_table is None else keywords_table,
    }
    for name, table in tables.items():
        (directory / name).write_text(json.dumps(table, ensure_ascii=False), encoding="utf-8")
    return directory


class _Delete:
    """The value that makes :func:`edit` remove a member instead of setting it."""


DELETE = _Delete()

type Step = str | int
type Edit = tuple[tuple[Step, ...], Any]
"""One change to a table: the path to a member, and its new value or ``DELETE``."""


def edit(document: Any, path: tuple[Step, ...], value: Any) -> None:
    """Set, or with ``DELETE`` remove, the member of ``document`` at ``path``.

    A parametrised negative names its change as data, ``(("regions", 0, "weight"), 100)``, so the
    table of cases reads as a table and the type checker reads it too.
    """
    target = document
    for step in path[:-1]:
        target = target[step]
    if isinstance(value, _Delete):
        del target[path[-1]]
    else:
        target[path[-1]] = value


def validate(directory: Path, **options: Any) -> LoreTables:
    return validate_directory(directory, INDEX, hero_entries=HEROES, **options)


def problems(directory: Path, **options: Any) -> list[Problem]:
    """The problems a directory raises. Fails the test when it validates."""
    try:
        validate(directory, **options)
    except LoreValidationError as error:
        return error.problems
    raise AssertionError(f"{directory} validated; the test expected a rule to fail")


def only(found: list[Problem]) -> Problem:
    """The one problem. A negative test fails for its named reason and for no other."""
    assert len(found) == 1, [f"{p.rule}: {p.render('.')}" for p in found]
    return found[0]
