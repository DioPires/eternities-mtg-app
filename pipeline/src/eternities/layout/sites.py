"""Sites, their order and the assignment of cards to them (PRD v4 5.4.2, 5.4.3, 5.13.2).

A hero world with lore tables has one era site per era row, then one regional site per region
that the keyword rule sends a card to. A world without tables is laid out by the kit law: one set
site per set with first printings on the plane, in release order.

**What the code defines where the PRD leaves a choice** (5.4.18 (12)):

- A keyword matches a face's name when the case-folded keyword occurs in the case-folded name
  with no letter or digit beside it at either end. So ``Benalia`` matches ``Benalia's Knight``.
- An era site lists the era's sets that have first printings on the plane, in release order.
- A headline name of the era row (F.2) resolves to the card of that name first printed in one of
  the era's sets, the lowest ``oracle_id`` when the name is shared.

This module computes no position.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Final, cast

from .cards import PlaneCard, PlaneCards, PlaneSet

HEADLINE_LIMIT: Final = 6
HEADLINE_LEGENDS: Final = 3


class AssignmentError(RuntimeError):
    """The tables do not assign the plane's cards: the build fails naming the row (5.4.12)."""


@dataclass(frozen=True, slots=True)
class Chapter:
    """The cards of one set in an era site, in ``oracle_id`` order. Never empty."""

    set: PlaneSet
    cards: tuple[PlaneCard, ...]


@dataclass(frozen=True, slots=True)
class SitePlan:
    key: str
    """``era:<id>``, ``region:<id>`` or ``set:<code>``: the key seeds the site's PRNG."""
    kind: str
    """``era``, ``region`` or ``set``."""
    region: str | None
    """The region the site stands in; None on a kit world, whose one region has no name."""
    era: str | None
    sets: tuple[PlaneSet, ...]
    """An era site's sets with first printings, in release order; a set site's one set."""
    cards: tuple[PlaneCard, ...]
    """The site's cards in the order of 5.4.3."""
    chapters: tuple[Chapter, ...]
    """An era site's non-empty chapters in release order; empty for the other kinds."""

    @property
    def stands(self) -> int:
        return len(self.cards)

    @property
    def chapter_stones(self) -> int:
        """One per non-empty chapter after the first (5.4.10)."""
        return max(0, len(self.chapters) - 1)


@dataclass(frozen=True, slots=True)
class KeywordMove:
    card: PlaneCard
    keyword: str
    region: str
    era: str
    moved: bool
    """False when the keyword's region is the era's own: the card stays at its era site."""


@dataclass(frozen=True, slots=True)
class Assignment:
    law: str
    """``hero`` when the plane is laid out from lore tables, ``kit`` otherwise."""
    sites: tuple[SitePlan, ...]
    keyword_matches: tuple[KeywordMove, ...]
    """Every card with a selected keyword, in the pack's order."""
    two_regions: tuple[tuple[PlaneCard, tuple[str, ...]], ...]
    """Every card whose name matches keywords of two regions or more, with the regions."""
    empty_chapters: tuple[tuple[str, str], ...]
    """(era id, set code) of every chapter whose cards all stand at regional sites."""
    selected: dict[str, str]
    """``oracle_id`` to the selected keyword, for the cards that have one."""


def matches(keyword: str, name: str) -> bool:
    """The keyword occurs in the name as a whole word (5.4.3 (b))."""
    word = keyword.casefold()
    text = name.casefold()
    start = text.find(word)
    while start >= 0:
        end = start + len(word)
        before = start == 0 or not text[start - 1].isalnum()
        after = end == len(text) or not text[end].isalnum()
        if before and after:
            return True
        start = text.find(word, start + 1)
    return False


def selected_keyword(
    card: PlaneCard, keywords: Sequence[tuple[str, str]]
) -> tuple[str, str] | None:
    """The first keyword in table order that a face's name carries, with its region."""
    names = [card.name] if card.back_name is None else [card.name, card.back_name]
    for word, region in keywords:
        if any(matches(word, name) for name in names):
            return word, region
    return None


def _by_oracle(cards: Iterable[PlaneCard]) -> list[PlaneCard]:
    return sorted(cards, key=lambda card: card.order_key)


def kit_assignment(plane: PlaneCards) -> Assignment:
    """The kit law: one set site per set with first printings, in release order (5.4.2)."""
    by_set: dict[int, list[PlaneCard]] = {}
    for card in plane.cards:
        by_set.setdefault(card.set_id, []).append(card)
    sites = tuple(
        SitePlan(
            key=f"set:{record.code}",
            kind="set",
            region=None,
            era=None,
            sets=(record,),
            cards=tuple(_by_oracle(by_set[record.id])),
            chapters=(),
        )
        for record in plane.sets
        if record.id in by_set
    )
    return Assignment(
        law="kit", sites=sites, keyword_matches=(), two_regions=(), empty_chapters=(), selected={}
    )


def hero_assignment(
    plane: PlaneCards, regions: dict[str, Any], eras: dict[str, Any], keywords: dict[str, Any]
) -> Assignment:
    """5.4.2 and 5.4.3 for a hero world, from its three validated tables."""
    region_rows = cast("list[dict[str, Any]]", regions["regions"])
    era_rows = cast("list[dict[str, Any]]", eras["eras"])
    words = [
        (str(row["word"]), str(row["region"]))
        for row in cast("list[dict[str, Any]]", keywords["keywords"])
    ]
    region_ids = [str(row["id"]) for row in region_rows]
    for word, region in words:
        if region not in region_ids:
            raise AssignmentError(f"keyword {word!r} names the unknown region {region!r} (F.3)")

    era_of_set: dict[str, dict[str, Any]] = {}
    for era in era_rows:
        for code in cast("list[str]", era["sets"]):
            if code in era_of_set:
                raise AssignmentError(
                    f"set {code!r} is in two eras, {era_of_set[code]['id']!r} and "
                    f"{era['id']!r} (5.4.3, F.2)"
                )
            era_of_set[code] = era
    by_code = plane.set_by_code()
    for record in plane.sets:
        if record.code not in era_of_set:
            raise AssignmentError(
                f"set {record.code!r} has first printings on {plane.slug} and no era (5.4.3, F.2)"
            )

    at_era: dict[str, list[PlaneCard]] = {str(era["id"]): [] for era in era_rows}
    at_region: dict[str, list[PlaneCard]] = {}
    moves: list[KeywordMove] = []
    two: list[tuple[PlaneCard, tuple[str, ...]]] = []
    selected: dict[str, str] = {}
    for card in plane.cards:
        era = era_of_set[card.set_code]
        era_id, era_region = str(era["id"]), str(era["region"])
        names = [card.name] if card.back_name is None else [card.name, card.back_name]
        matched = [(word, region) for word, region in words if any(matches(word, n) for n in names)]
        if not matched:
            at_era[era_id].append(card)
            continue
        word, region = matched[0]
        selected[card.oracle_id] = word
        distinct = tuple(dict.fromkeys(found for _, found in matched))
        if len(distinct) > 1:
            two.append((card, distinct))
        moved = region != era_region
        moves.append(KeywordMove(card=card, keyword=word, region=region, era=era_id, moved=moved))
        if moved:
            at_region.setdefault(region, []).append(card)
        else:
            at_era[era_id].append(card)

    sites: list[SitePlan] = []
    empty: list[tuple[str, str]] = []
    for era in era_rows:
        era_id = str(era["id"])
        records = sorted(
            (by_code[code] for code in cast("list[str]", era["sets"]) if code in by_code),
            key=lambda record: record.id,
        )
        chapters: list[Chapter] = []
        for record in records:
            cards = _by_oracle(card for card in at_era[era_id] if card.set_id == record.id)
            if cards:
                chapters.append(Chapter(set=record, cards=tuple(cards)))
            else:
                empty.append((era_id, record.code))
        sites.append(
            SitePlan(
                key=f"era:{era_id}",
                kind="era",
                region=str(era["region"]),
                era=era_id,
                sets=tuple(records),
                cards=tuple(card for chapter in chapters for card in chapter.cards),
                chapters=tuple(chapters),
            )
        )
    for region in region_ids:
        if region in at_region:
            cards = sorted(at_region[region], key=lambda card: (card.set_id, card.order_key))
            sites.append(
                SitePlan(
                    key=f"region:{region}",
                    kind="region",
                    region=region,
                    era=None,
                    sets=(),
                    cards=tuple(cards),
                    chapters=(),
                )
            )
    return Assignment(
        law="hero",
        sites=tuple(sites),
        keyword_matches=tuple(moves),
        two_regions=tuple(two),
        empty_chapters=tuple(empty),
        selected=selected,
    )


def collector_key(number: str) -> tuple[int, int, str] | tuple[int, str]:
    """The order of two collector numbers (5.13.2, erratum 2).

    By the integer that the leading ASCII digits make, then as whole strings by code point. A
    number that starts with no digit comes after every number that starts with one.
    """
    digits = 0
    while digits < len(number) and number[digits] in "0123456789":
        digits += 1
    if digits == 0:
        return (1, number)
    return (0, int(number[:digits]), number)


@dataclass(frozen=True, slots=True)
class Flagged:
    """One Story Spotlight printing: the card, the printing's set code and collector number."""

    oracle_id: str
    set_code: str
    collector_number: str


def headline_cards(
    era: dict[str, Any], plane: PlaneCards, flagged: Sequence[Flagged]
) -> tuple[list[PlaneCard], str]:
    """An era's headline cards and the rule that chose them (5.13.2).

    The Story Spotlight cards of the era's sets, up to six; else the era row's ``headline`` list;
    else the first three legendary creatures of the era's sets by release date then name. A
    flagged printing counts for a card of this plane when its set is the card's first set.
    """
    codes = set(cast("list[str]", era["sets"]))
    in_era = [card for card in plane.cards if card.set_code in codes]
    by_id = {card.oracle_id: card for card in in_era}
    lowest: dict[str, str] = {}
    for printing in flagged:
        card = by_id.get(printing.oracle_id)
        if card is None or printing.set_code != card.set_code:
            continue
        held = lowest.get(card.oracle_id)
        if held is None or collector_key(printing.collector_number) < collector_key(held):
            lowest[card.oracle_id] = printing.collector_number
    if lowest:
        ordered = sorted(
            lowest, key=lambda ident: (by_id[ident].set_id, collector_key(lowest[ident]), ident)
        )
        return [by_id[ident] for ident in ordered[:HEADLINE_LIMIT]], "story spotlight"
    named: list[PlaneCard] = []
    for name in cast("list[str]", era.get("headline", [])):
        found = _by_oracle(card for card in in_era if card.name == name)
        if found and found[0] not in named:
            named.append(found[0])
    if named:
        return named[:HEADLINE_LIMIT], "the era row's list"
    legends = [
        card
        for card in in_era
        if "legendary" in _types(card.type_line) and "creature" in _types(card.type_line)
    ]
    legends.sort(key=lambda card: (card.set_id, card.name, card.oracle_id))
    return legends[:HEADLINE_LEGENDS], "legendary creatures"


def _types(type_line: str) -> set[str]:
    head = type_line.split("—")[0].split("//")[0]
    return {word.lower() for word in head.split()}
