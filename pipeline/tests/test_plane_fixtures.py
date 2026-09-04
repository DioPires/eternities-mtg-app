"""PRD 9.1.5 — the plane fixture table, asserted against the committed production dataset.

"A table of at least 25 well-known cards with their expected plane is asserted on every pipeline
run. Adding a row is the standard way to lock in an override."

The table is checked against what is committed under ``web/public/data/<hash>/``, so it runs in
CI on every change without needing the 78 MB Scryfall bulk file. Each row names the rule it
locks; a row that starts failing means a rule changed, not that a test is flaky.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from conftest import read_json

# (card name, expected plane slug, the rule this row locks)
PLANE_FIXTURES: list[tuple[str, str, str]] = [
    # --- 4.6.2, the ordinary path: Appendix B row wins -----------------------------------------
    ("Black Lotus", "dominaria", "Alpha maps to Dominaria"),
    ("Ancestral Recall", "dominaria", "Alpha maps to Dominaria"),
    ("Time Walk", "dominaria", "Alpha maps to Dominaria"),
    ("Shivan Dragon", "dominaria", "Alpha maps to Dominaria"),
    ("Serra Angel", "dominaria", "Alpha maps to Dominaria"),
    # --- 4.5, first printing decides the plane -------------------------------------------------
    ("Sol Ring", "dominaria", "4.4.3: the Warhammer 40,000 reprint must not move or exclude it"),
    ("Lightning Bolt", "dominaria", "Alpha, despite reprints everywhere"),
    ("Llanowar Elves", "dominaria", "Alpha"),
    # --- Ravnica guild leaders (PRD 9.1.5 names them) ------------------------------------------
    ("Niv-Mizzet, Dracogenius", "ravnica", "Ravnica guild leader"),
    ("Isperia, Supreme Judge", "ravnica", "Ravnica guild leader"),
    ("Rakdos, Lord of Riots", "ravnica", "Ravnica guild leader"),
    ("Trostani, Selesnya's Voice", "ravnica", "Ravnica guild leader"),
    (
        "Jarad, Golgari Lich Lord",
        "ravnica",
        "4.5: his earliest printing is Duel Decks: Izzet vs. Golgari, a month before Return to "
        "Ravnica - the Appendix B row this run added for `ddj` is what keeps him on Ravnica",
    ),
    ("Aurelia, the Warleader", "ravnica", "Ravnica guild leader"),
    # --- other planes, one row each ------------------------------------------------------------
    ("Thalia, Guardian of Thraben", "innistrad", "Innistrad"),
    ("Griselbrand", "innistrad", "Innistrad"),
    ("Elesh Norn, Grand Cenobite", "new-phyrexia", "4.7.2: Mirrodin and New Phyrexia are one"),
    ("Wurmcoil Engine", "new-phyrexia", "Scars of Mirrodin block"),
    ("Ulamog, the Infinite Gyre", "zendikar", "Rise of the Eldrazi"),
    ("Scalding Tarn", "zendikar", "Zendikar"),
    ("Thassa, God of the Sea", "theros", "Theros"),
    ("Kroxa, Titan of Death's Hunger", "theros", "Theros Beyond Death"),
    ("Umezawa's Jitte", "kamigawa", "Betrayers of Kamigawa"),
    ("Anafenza, the Foremost", "tarkir", "Khans of Tarkir"),
    ("Oko, Thief of Crowns", "eldraine", "Throne of Eldraine"),
    ("Dark Confidant", "ravnica", "Ravnica: City of Guilds"),
    # --- the Blind Eternities (PRD 9.1.5 names a Modern Horizons original) ---------------------
    ("Force of Negation", "blind-eternities", "Modern Horizons has no single plane"),
    ("Wrenn and Six", "blind-eternities", "Modern Horizons has no single plane"),
    ("Ragavan, Nimble Pilferer", "blind-eternities", "Modern Horizons 2"),
    ("Sylvan Library", "dominaria", "Legends maps to Dominaria"),
]

EXCLUDED_CARDS: list[tuple[str, str]] = [
    ("The One Ring", "4.4.3: Universes Beyond by origin, despite its reprints"),
    ("Orcish Bowmasters", "4.4.3: Universes Beyond by origin"),
    ("Sauron, the Dark Lord", "4.4.3: Universes Beyond by origin"),
    ("Brisela, Voice of Nightmares", "4.4.6: a meld result is not a card of its own"),
]


@pytest.fixture(scope="module")
def plane_of_card(production_dir: Path) -> dict[str, str]:
    """``card name -> plane slug``, read from the committed artefacts alone."""
    search = read_json(production_dir / "search.json")
    planes = read_json(production_dir / "planes.json")["planes"]
    names: list[str] = search["cardNames"]
    mapping: dict[str, str] = {}
    for plane in planes:
        start = int(plane["starOffset"])
        for name in names[start : start + int(plane["starCount"])]:
            mapping[str(name)] = str(plane["slug"])
    return mapping


def test_the_table_has_at_least_25_rows():
    """PRD 9.1.5 sets the floor; this test is what stops the table quietly shrinking."""
    assert len(PLANE_FIXTURES) >= 25


@pytest.mark.parametrize(("name", "expected", "rule"), PLANE_FIXTURES, ids=lambda v: str(v)[:40])
def test_card_lands_on_its_expected_plane(
    plane_of_card: dict[str, str], name: str, expected: str, rule: str
):
    assert name in plane_of_card, f"{name!r} is not in the dataset at all ({rule})"
    assert plane_of_card[name] == expected, (
        f"{name!r} is on {plane_of_card[name]!r}, expected {expected!r} — {rule}"
    )


@pytest.mark.parametrize(("name", "rule"), EXCLUDED_CARDS, ids=lambda v: str(v)[:40])
def test_card_is_excluded(plane_of_card: dict[str, str], name: str, rule: str):
    assert name not in plane_of_card, f"{name!r} should have been excluded — {rule}"


def test_universes_within_card_is_reachable(plane_of_card: dict[str, str], production_dir: Path):
    """PRD 9.1.5 and 4.4.5: one Universes Within card, whatever its Secret Lair original carries.

    The exemption is the only reason these cards survive 4.4.3, so the fixture asserts that at
    least one card whose first printing is `slx` made it into the dataset — the concrete answer
    to open question 12 that the first run settled.
    """
    search = read_json(production_dir / "search.json")
    slx = next((s for s in search["sets"] if s["code"] == "slx"), None)
    assert slx is not None, "Universes Within is not even in the set dictionary"
    assert int(slx["cardCount"]) > 0, (
        "no card has `slx` as its first printing; 4.4.5's exemption is not being exercised"
    )
