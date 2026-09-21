"""Normalised rows the pipeline stages operate on, and the parser that produces them.

Scryfall's card object is large and the bulk file is over a gigabyte decompressed. The stages of
PRD 8.2 need only a narrow slice of it, so parsing happens once, here, into flat frozen rows —
which is also what makes every later stage a pure function over an in-memory table that a unit
test can build by hand.

The oracle-level detail (text, faces, mana cost) is deliberately *not* in
:class:`RawPrinting`: it is needed only for the printings that turn out to be first printings, so
it is read in a second pass over the same cached file (:func:`read_details`) rather than held for
half a million rows.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any, Final, cast

from ..contract.enums import UNRELEASED_DATE, assert_known_layout

SECURITY_STAMPS: Final[frozenset[str]] = frozenset(
    {"oval", "triangle", "acorn", "circle", "arena", "heart"}
)
"""Every Scryfall ``security_stamp`` value. PRD 7.7.2: an unknown one fails the run, because
4.3.5 makes a decision on this field and a silent miss would let a Universes Beyond printing in."""

SET_TYPES: Final[frozenset[str]] = frozenset(
    {
        "core",
        "expansion",
        "masters",
        "alchemy",
        "masterpiece",
        "arsenal",
        "from_the_vault",
        "spellbook",
        "premium_deck",
        "duel_deck",
        "draft_innovation",
        "treasure_chest",
        "commander",
        "planechase",
        "archenemy",
        "vanguard",
        "funny",
        "starter",
        "box",
        "promo",
        "token",
        "memorabilia",
        "minigame",
        "eternal",
    }
)
"""Every Scryfall ``set_type``. PRD 7.7.2 again: 4.3.2 excludes by this field, so an unrecognised
value must stop the run rather than fall through as "not excluded"."""

RARITIES: Final[frozenset[str]] = frozenset(
    {"common", "uncommon", "rare", "mythic", "special", "bonus"}
)

_WUBRG: Final = "WUBRG"


class UnknownEnumError(ValueError):
    """PRD 7.7.2. Raised with every offending value at once, so one run fixes them all."""


@dataclass(frozen=True, slots=True)
class ScrySet:
    """One row of Scryfall ``/sets`` (PRD 4.1.2)."""

    code: str
    name: str
    released_at: str
    set_type: str
    parent_set_code: str | None
    digital: bool

    @property
    def year(self) -> int:
        return int(self.released_at[:4])


@dataclass(frozen=True, slots=True)
class RawPrinting:
    """One Scryfall printing, reduced to the fields PRD 4.3 to 4.6 actually read."""

    id: str
    oracle_id: str
    card_name: str
    set_code: str
    released_at: str
    """The printing's own release date, which 4.3.8, 4.4.3, 4.5 and 5.6.7 all order by.

    4.5.1's literal wording says the *set*'s date; the pipeline deviates and uses this field
    instead, because rolling products such as The List keep adding printings for years under a
    single set date. See :func:`~eternities.pipeline.stages.first_printing_sort_key` — which
    :func:`~eternities.pipeline.assemble.printing_order` now sorts the planet order by too, so
    the whole pipeline reads one date (DEC-885, DEC-913).
    """
    rarity: str
    layout: str
    lang: str
    promo: bool
    digital: bool
    oversized: bool
    security_stamp: str | None
    flavor_name: str | None
    content_warning: bool
    collector_number: str
    image_ts: int
    artist: str
    """Contract v3, worlds spec §2.3. ``""`` where Scryfall has none.

    Read here rather than in the second detail pass because the artist is a property of the
    *printing*, and the second pass visits only first printings — while the shard carries an artist
    for every printing in ``p``. Scryfall gives it on the card object for a multi-artist printing as
    ``artist`` joined with ``&``, which is the credit line as printed and is what goes in the
    contract verbatim."""

    is_meld_result: bool

    @property
    def order_key(self) -> tuple[str, str, str, str]:
        """Total order over printings; used wherever "earliest" must be deterministic."""
        return (self.released_at, self.set_code, self.collector_number, self.id)


@dataclass(frozen=True, slots=True)
class FaceDetail:
    name: str
    mana_cost: str
    type_line: str
    oracle_text: str


@dataclass(frozen=True, slots=True)
class CardDetail:
    """The oracle-level fields of PRD 4.2.2, read in the second pass for first printings only."""

    printing_id: str
    oracle_id: str
    layout: str
    colour_identity: str
    front: FaceDetail
    back: FaceDetail | None
    meld_result_id: str | None
    """``all_parts`` id of this card's meld result, when it has one (PRD line 125)."""


@dataclass(frozen=True, slots=True)
class MeldResult:
    """A meld result object: its own card, excluded by 4.4.6, kept as a back face."""

    printing_id: str
    image_ts: int
    face: FaceDetail


def _as_dict(value: object) -> dict[str, Any] | None:
    """Narrow an untyped JSON value to an object, or ``None``.

    Scryfall's schema is not typed at the boundary, so every nested access goes through these two
    helpers rather than a bare ``isinstance``: the cast happens in one place and the callers stay
    readable under a strict type checker.
    """
    return cast("dict[str, Any]", value) if isinstance(value, dict) else None


def _as_list(value: object) -> list[Any] | None:
    return cast("list[Any]", value) if isinstance(value, list) else None


def _image_timestamp(card: dict[str, Any]) -> int:
    """The cache-busting integer Scryfall appends to every image URI (data contract §9).

    Read from whichever image URI the object carries - top level for a single-faced card, the
    front face for a double-faced one. A printing with no image at all gets ``0``; the derived URI
    is still well-formed and Scryfall answers it.
    """
    uris = _as_dict(card.get("image_uris"))
    if uris is None:
        faces = _as_list(card.get("card_faces"))
        if faces:
            front = _as_dict(faces[0])
            if front is not None:
                uris = _as_dict(front.get("image_uris"))
    if uris is None:
        return 0
    for value in uris.values():
        if isinstance(value, str) and "?" in value:
            tail = value.rsplit("?", 1)[1]
            if tail.isdigit():
                return int(tail)
    return 0


def _meld_parts(card: dict[str, Any]) -> list[dict[str, Any]]:
    parts = _as_list(card.get("all_parts")) or []
    rows = [_as_dict(part) for part in parts]
    return [row for row in rows if row is not None and row.get("component") == "meld_result"]


def _is_meld_result(card: dict[str, Any]) -> bool:
    own = card.get("id")
    return any(part.get("id") == own for part in _meld_parts(card))


def _meld_result_id(card: dict[str, Any]) -> str | None:
    own = card.get("id")
    for part in _meld_parts(card):
        if part.get("id") != own:
            return str(part.get("id"))
    return None


def parse_printing(card: dict[str, Any]) -> RawPrinting | None:
    """Reduce one Scryfall card object to a :class:`RawPrinting`.

    Returns ``None`` for an object with no ``oracle_id`` — Scryfall gives meld results and a few
    other non-card objects none, and 4.2.1 defines a card *as* an ``oracle_id``.
    """
    oracle_id = card.get("oracle_id")
    if not isinstance(oracle_id, str):
        return None
    stamp = card.get("security_stamp")
    flavor = card.get("flavor_name")
    artist = card.get("artist")
    return RawPrinting(
        id=str(card["id"]),
        oracle_id=oracle_id,
        card_name=_front_name(card),
        set_code=str(card["set"]),
        released_at=str(card["released_at"]),
        rarity=str(card["rarity"]),
        layout=str(card["layout"]),
        lang=str(card["lang"]),
        promo=bool(card.get("promo", False)),
        digital=bool(card.get("digital", False)),
        oversized=bool(card.get("oversized", False)),
        security_stamp=str(stamp) if isinstance(stamp, str) else None,
        flavor_name=str(flavor) if isinstance(flavor, str) else None,
        content_warning=bool(card.get("content_warning", False)),
        collector_number=str(card["collector_number"]),
        image_ts=_image_timestamp(card),
        artist=artist if isinstance(artist, str) else "",
        is_meld_result=_is_meld_result(card),
    )


def _front_name(card: dict[str, Any]) -> str:
    """PRD 6.5.2 indexes the front-face name; the top-level name is ``"Fire // Ice"``."""
    faces = _as_list(card.get("card_faces"))
    if faces:
        front = _as_dict(faces[0])
        if front is not None and isinstance(front.get("name"), str):
            return str(front["name"])
    return str(card["name"])


def _face(source: dict[str, Any]) -> FaceDetail:
    return FaceDetail(
        name=str(source.get("name", "")),
        mana_cost=str(source.get("mana_cost", "")),
        type_line=str(source.get("type_line", "")),
        oracle_text=str(source.get("oracle_text", "")),
    )


def parse_detail(card: dict[str, Any]) -> CardDetail:
    """Read the oracle-level fields of PRD 4.2.2 and 4.8 from a card object.

    Split, adventure and flip cards have no top-level ``oracle_text`` at all — the text lives only
    inside ``card_faces`` — which is why both faces are read here rather than at the top level
    (data contract §9).
    """
    raw_faces = _as_list(card.get("card_faces")) or []
    faces = [face for face in (_as_dict(f) for f in raw_faces) if face is not None]
    if faces:
        front = _face(faces[0])
        back = _face(faces[1]) if len(faces) > 1 else None
        # A face carries no colour identity of its own; it is a card-level property (PRD 4.2.2).
        if not front.type_line:
            front = FaceDetail(
                front.name,
                front.mana_cost,
                str(card.get("type_line", "")),
                front.oracle_text,
            )
    else:
        front = _face(card)
        back = None
    identity = _as_list(card.get("color_identity")) or []
    letters = {str(colour) for colour in identity}
    return CardDetail(
        printing_id=str(card["id"]),
        oracle_id=str(card["oracle_id"]),
        layout=str(card["layout"]),
        colour_identity="".join(c for c in _WUBRG if c in letters),
        front=front,
        back=back,
        meld_result_id=_meld_result_id(card),
    )


def parse_set(row: dict[str, Any]) -> ScrySet:
    parent = row.get("parent_set_code")
    return ScrySet(
        code=str(row["code"]),
        name=str(row["name"]),
        # A handful of announced sets carry no date; treat them as far-future so 4.3.8 keeps them
        # out rather than crashing on a missing key.
        released_at=str(row.get("released_at") or UNRELEASED_DATE),
        set_type=str(row["set_type"]),
        parent_set_code=str(parent) if isinstance(parent, str) else None,
        digital=bool(row.get("digital", False)),
    )


def assert_known_enums(printings: Iterable[RawPrinting], sets: Iterable[ScrySet]) -> None:
    """PRD 7.7.2: fail loudly on an unknown ``set_type``, ``layout``, ``rarity`` or stamp.

    Every offending value is collected before raising, so one run tells the owner about all of
    them instead of one per re-run.
    """
    unknown: dict[str, set[str]] = {}
    for printing in printings:
        if printing.rarity not in RARITIES:
            unknown.setdefault("rarity", set()).add(printing.rarity)
        try:
            assert_known_layout(printing.layout)
        except ValueError:
            unknown.setdefault("layout", set()).add(printing.layout)
        if printing.security_stamp is not None and printing.security_stamp not in SECURITY_STAMPS:
            unknown.setdefault("security_stamp", set()).add(printing.security_stamp)
    for entry in sets:
        if entry.set_type not in SET_TYPES:
            unknown.setdefault("set_type", set()).add(entry.set_type)
    if unknown:
        detail = "; ".join(f"{name}: {sorted(values)}" for name, values in sorted(unknown.items()))
        raise UnknownEnumError(f"unknown Scryfall enum values (PRD 7.7.2) — {detail}")


def read_printings(cards: Iterator[dict[str, Any]]) -> list[RawPrinting]:
    rows: list[RawPrinting] = []
    for card in cards:
        printing = parse_printing(card)
        if printing is not None:
            rows.append(printing)
    return rows


def read_details(
    cards: Iterator[dict[str, Any]], wanted: set[str], meld_ids: set[str]
) -> tuple[dict[str, CardDetail], dict[str, MeldResult]]:
    """Second pass: oracle detail for ``wanted`` printing ids, plus any meld results named.

    ``meld_ids`` is filled by the caller from the first pass's ``all_parts`` links; a meld result
    is its own Scryfall object with its own image and no ``card_faces``, so it cannot be derived
    from the component (data contract §9).
    """
    details: dict[str, CardDetail] = {}
    melds: dict[str, MeldResult] = {}
    for card in cards:
        card_id = str(card.get("id", ""))
        if card_id in wanted:
            details[card_id] = parse_detail(card)
        if card_id in meld_ids:
            melds[card_id] = MeldResult(
                printing_id=card_id, image_ts=_image_timestamp(card), face=_face(card)
            )
    return details, melds
