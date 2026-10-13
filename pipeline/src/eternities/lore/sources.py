"""The source locators of PRD v4 Appendix F.4: five forms, and nothing else validates.

| Form | Validation |
|---|---|
| ``https://magic.wizards.com/<path>`` | scheme ``https``, the parsed host exactly that name |
| ``https://scryfall.com/<path>`` | the same |
| ``https://mtg.wiki/<path>`` | the same |
| ``card:<oracle_id>`` | the id is in the dataset |
| ``printing:<scryfall_id>#front`` or ``#back`` | the printing is in the dataset; the face exists |

"A host is validated by parsing the URL, never by a substring match." The parse here is
``urllib.parse.urlsplit``, and the whole authority must equal the host name: no user name, no
port, no upper case. That closes the two spellings where a parser and a browser disagree about the
host (``https://magic.wizards.com@example.org/`` and ``https://example.org\\@magic.wizards.com/``),
because in both the authority is longer than the host. White space, control characters and a
backslash are refused anywhere in a locator for the same reason.

``#front`` is a card's first face and ``#back`` its second. The second face exists when the
dataset's card row carries one (``LoreIndex``): a transforming card's back, and the second half of
a split or adventure card.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit

from .index import LoreIndex
from .problems import Rule

ALLOWED_HOSTS: Final = frozenset({"magic.wizards.com", "scryfall.com", "mtg.wiki"})

_UUID: Final = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_CARD: Final = re.compile(rf"card:({_UUID})")
_PRINTING: Final = re.compile(rf"printing:({_UUID})#(front|back)")
_FORBIDDEN: Final = re.compile(r"[\s\\\x00-\x1f\x7f]")

_FORMS: Final = (
    "https://magic.wizards.com/<path>, https://scryfall.com/<path>, https://mtg.wiki/<path>, "
    "card:<oracle_id>, printing:<scryfall_id>#front or #back"
)


@dataclass(frozen=True, slots=True)
class LocatorFlaw:
    rule: Rule
    message: str


def _off(locator: str, why: str) -> LocatorFlaw:
    return LocatorFlaw(
        Rule.SOURCE_OFF_ALLOWLIST,
        f"{locator!r} is not on the source allowlist: {why}. The five forms are {_FORMS} (F.4)",
    )


def locator_flaw(locator: str, index: LoreIndex) -> LocatorFlaw | None:
    """Why ``locator`` does not validate, or ``None`` when it does."""
    if _FORBIDDEN.search(locator):
        return _off(locator, "it holds white space, a control character or a backslash")

    card = _CARD.fullmatch(locator)
    if card:
        if card[1] not in index.cards:
            return LocatorFlaw(
                Rule.SOURCE_NOT_IN_DATASET,
                f"card {card[1]} is not a card of dataset {index.label} (F.4)",
            )
        return None

    printing = _PRINTING.fullmatch(locator)
    if printing:
        found = index.printings.get(printing[1])
        if found is None:
            return LocatorFlaw(
                Rule.SOURCE_NOT_IN_DATASET,
                f"printing {printing[1]} is not a printing of dataset {index.label} (F.4)",
            )
        owner = index.cards[found.oracle_id]
        if printing[2] == "back" and owner.back_name is None:
            return LocatorFlaw(
                Rule.SOURCE_FACE,
                f"printing {printing[1]} is {owner.name!r}, which has no second face, so #back "
                "names nothing (F.4)",
            )
        return None

    if locator.startswith(("card:", "printing:")):
        return _off(locator, "the id is not a lower-case UUID, or the face is missing")

    try:
        parts = urlsplit(locator)
    except ValueError:
        return _off(locator, "it does not parse as a URL")
    if not locator.startswith("https://") or parts.scheme != "https":
        return _off(locator, "the scheme is not https")
    if parts.netloc not in ALLOWED_HOSTS:
        return _off(locator, f"the host {parts.netloc!r} is not one of {sorted(ALLOWED_HOSTS)}")
    if len(parts.path) < 2:
        return _off(locator, "it names the site and no page")
    return None
