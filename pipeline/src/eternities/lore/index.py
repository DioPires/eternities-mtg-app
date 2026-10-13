"""What the lore tables are checked against: the dataset's cards, printings and plane sets.

PRD v4 4.16.2 and Appendix F resolve four things "against the dataset": the set codes with first
printings on a plane, a headline card's name, a ``card:`` source and a ``printing:`` source. This
module is that dataset, reduced to those facts, and it has two readers that must agree:

- :meth:`LoreIndex.from_dataset` reads the dataset a build has just assembled, before it is
  written, so ``eternities build`` validates the tables against the run's own data.
- :meth:`LoreIndex.from_pack` reads a pack already on disk. The committed production pack under
  ``web/public/data/<hash>/`` is what the tests and ``eternities lore`` read, so the tables are
  checked on every change without the 78 MB Scryfall bulk file, as PRD 9.1.5's plane table is.

A card's first printing is printing 0 of its row (data contract section 9: the printing list is
sorted by the key PRD 4.5 picks the first printing with). A card's **second face** is the ``b``
member of its row: a transforming card's back, and also the second half of a split, adventure or
flip card.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from ..contract.models import Dataset


class LoreIndexError(RuntimeError):
    """The pack on disk does not hold together, so nothing can be resolved against it."""


@dataclass(frozen=True, slots=True)
class IndexedCard:
    oracle_id: str
    name: str
    """The front face's name, which is the card's name in the dataset."""
    back_name: str | None
    """The second face's name, or ``None`` for a card with one face."""
    plane: str
    first_set: str
    """Set code of the card's first printing."""


@dataclass(frozen=True, slots=True)
class IndexedPrinting:
    oracle_id: str
    set_code: str
    collector_number: str


@dataclass(frozen=True, slots=True)
class LoreIndex:
    label: str
    """The dataset's name for messages and the report: its data hash, or ``this run``."""
    plane_slugs: tuple[str, ...]
    plane_sets: dict[str, tuple[str, ...]]
    """Plane slug to the set codes with first printings there, in the pack's release order."""
    cards: dict[str, IndexedCard]
    printings: dict[str, IndexedPrinting]
    names: dict[str, tuple[str, ...]]
    """Card name (the front face's) to the oracle ids that carry it. A name is not an identifier:
    Scryfall reuses one across distinct cards, so a name resolves to a list."""

    def expected_sets(self, plane: str) -> tuple[str, ...]:
        """The set codes an entry's tables must map, each exactly once (Appendix F.0)."""
        return self.plane_sets.get(plane, ())

    def cards_on(self, plane: str) -> list[IndexedCard]:
        return [card for card in self.cards.values() if card.plane == plane]

    @classmethod
    def from_dataset(cls, dataset: Dataset, *, label: str = "this run") -> LoreIndex:
        set_code = {record.id: record.code for record in dataset.sets}
        builder = _Builder(label)
        for plane in dataset.planes:
            builder.plane(plane.slug, [ref.code for ref in plane.sets])
            start = plane.star_offset
            for card in dataset.cards[start : start + plane.star_count]:
                builder.card(
                    plane.slug,
                    oracle_id=card.oracle_id,
                    name=card.name,
                    back_name=None if card.back is None else card.back.name,
                    printings=[
                        (p.id, set_code[p.set_id], p.collector_number) for p in card.printings
                    ],
                )
        return builder.build()

    @classmethod
    def from_pack(cls, data_dir: Path) -> LoreIndex:
        planes_file = data_dir / "planes.json"
        if not planes_file.exists():
            raise LoreIndexError(f"{data_dir} is not a data pack: it has no planes.json")
        planes = cast("list[dict[str, Any]]", _read(planes_file)["planes"])
        # The set dictionary is `search.json`'s. A plane lists only the sets with first printings
        # there, and a reprint may sit in a set that has none anywhere.
        set_code = {
            int(record["id"]): str(record["code"])
            for record in cast("list[dict[str, Any]]", _read(data_dir / "search.json")["sets"])
        }
        builder = _Builder(data_dir.name)
        for plane in planes:
            slug = str(plane["slug"])
            builder.plane(slug, [str(ref["code"]) for ref in plane["sets"]])
            for shard in range(int(plane["shardCount"])):
                rows = _read(data_dir / "planes" / f"{slug}.{shard}.json")["cards"]
                for row in cast("list[dict[str, Any]]", rows):
                    back = cast("dict[str, Any] | None", row["b"])
                    try:
                        printings = [
                            (str(p[0]), set_code[int(p[1])], str(p[4]))
                            for p in cast("list[list[Any]]", row["p"])
                        ]
                    except KeyError as error:
                        raise LoreIndexError(
                            f"{data_dir.name}: card {row['u']} on {slug} has a printing in set id "
                            f"{error.args[0]}, which search.json does not list"
                        ) from None
                    builder.card(
                        slug,
                        oracle_id=str(row["u"]),
                        name=str(row["n"]),
                        back_name=None if back is None else str(back["n"]),
                        printings=printings,
                    )
        return builder.build()


class _Builder:
    """Both readers fill the index through this, so they cannot build two different ones."""

    def __init__(self, label: str) -> None:
        self._label = label
        self._slugs: list[str] = []
        self._listed: dict[str, list[str]] = {}
        self._cards: dict[str, IndexedCard] = {}
        self._printings: dict[str, IndexedPrinting] = {}

    def plane(self, slug: str, listed_sets: list[str]) -> None:
        self._slugs.append(slug)
        self._listed[slug] = listed_sets

    def card(
        self,
        plane: str,
        *,
        oracle_id: str,
        name: str,
        back_name: str | None,
        printings: list[tuple[str, str, str]],
    ) -> None:
        if not printings:
            raise LoreIndexError(f"{self._label}: card {oracle_id} on {plane} has no printing")
        if oracle_id in self._cards:
            raise LoreIndexError(f"{self._label}: card {oracle_id} appears twice")
        self._cards[oracle_id] = IndexedCard(
            oracle_id=oracle_id,
            name=name,
            back_name=back_name,
            plane=plane,
            first_set=printings[0][1],
        )
        for printing_id, set_code, collector_number in printings:
            self._printings[printing_id] = IndexedPrinting(
                oracle_id=oracle_id, set_code=set_code, collector_number=collector_number
            )

    def build(self) -> LoreIndex:
        computed: dict[str, set[str]] = {slug: set() for slug in self._slugs}
        for card in self._cards.values():
            computed[card.plane].add(card.first_set)
        for slug in self._slugs:
            # The plane's set list and the cards' first printings are two statements of one fact.
            # The tables are checked against it, so a pack where they differ is refused.
            if computed[slug] != set(self._listed[slug]):
                raise LoreIndexError(
                    f"{self._label}: plane {slug} lists the sets {sorted(self._listed[slug])} "
                    f"and its cards are first printed in {sorted(computed[slug])}"
                )
        names: dict[str, list[str]] = {}
        for card in self._cards.values():
            names.setdefault(card.name, []).append(card.oracle_id)
        return LoreIndex(
            label=self._label,
            plane_slugs=tuple(self._slugs),
            plane_sets={slug: tuple(self._listed[slug]) for slug in self._slugs},
            cards=self._cards,
            printings=self._printings,
            names={name: tuple(sorted(ids)) for name, ids in names.items()},
        )


def _read(path: Path) -> dict[str, Any]:
    try:
        return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        raise LoreIndexError(f"the data pack is missing {path.name}") from None
