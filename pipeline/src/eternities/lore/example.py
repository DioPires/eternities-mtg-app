"""The schema example of PRD v4 Appendix F.5: Dominaria's three tables, by the expansion rule.

F.5 prints three tables (fifteen groups of set codes, eleven regions, twenty-four keywords) and an
**expansion rule** that supplies every field the tables do not show. This module is the three
tables and the rule. ``pipeline/scripts/lore_example.py`` writes its output to
``contract/test-vectors/v4/layout/dominaria-example/dominaria/``, and every pipeline run re-runs
the rule and compares the bytes (``stage``).

Nothing in the generated files is a lore claim: the groups are release blocks, which is a product
fact, and every sentence is a placeholder for the drafter.

One reading is settled here. An era's placeholder sentence is sourced to "the oracle id that sorts
first by bytes among the cards first printed in the era's sets". The cards are the entry's own:
cards of Dominaria whose first printing is in one of the era's sets. March of the Machine (``mom``)
is why the plane matters: most of its cards stand on other planes.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Final

from .digest import FILES
from .index import LoreIndex

PLANE: Final = "dominaria"

EXAMPLE_DIR: Final = (
    Path(__file__).resolve().parents[4]
    / "contract"
    / "test-vectors"
    / "v4"
    / "layout"
    / "dominaria-example"
)
"""The fixture's directory. The tables are in its ``dominaria/`` leaf, the entry's slug (F.5)."""

# F.5, first table: (example era id, name, sets). Table order is the trail order.
GROUPS: Final[tuple[tuple[str, str, tuple[str, ...]], ...]] = (
    ("first-cards", "The first cards", ("lea", "leb")),
    ("brothers-war", "The Brothers' War", ("atq", "bro", "brc")),
    ("legends", "Legends", ("leg",)),
    ("dark-age", "The Dark Age", ("drk", "fem", "p02")),
    ("ice-age", "The Ice Age", ("ice", "all", "csp")),
    ("mirage", "Mirage", ("mir", "vis", "mgb")),
    ("weatherlight", "Weatherlight", ("wth",)),
    ("urza", "Urza's block", ("usg", "ulg", "uds")),
    ("prophecy", "Prophecy", ("pcy",)),
    ("invasion", "Invasion", ("inv", "pls", "apc")),
    ("otaria-odyssey", "Otaria, Odyssey", ("ody", "tor", "jud")),
    ("otaria-onslaught", "Otaria, Onslaught", ("ons", "lgn", "scg")),
    ("time-spiral", "Time Spiral", ("tsp", "tsb", "plc", "fut")),
    ("return", "Dominaria", ("dom",)),
    ("united", "Dominaria United", ("dmu", "dmc", "mom")),
)

# F.5, second table: (id, name, kit, anchor in thousandths, water). Every weight is 1000.
REGIONS: Final[tuple[tuple[str, str, str, tuple[int, int], str], ...]] = (
    ("terisiare", "Terisiare", "temperate", (-600, 300), "lake"),
    ("benalia", "Benalia", "temperate", (-200, 650), "river"),
    ("tolaria", "Tolaria", "coast", (350, 550), "sea"),
    ("shiv", "Shiv", "volcanic", (750, 150), "lava"),
    ("jamuraa", "Jamuraa", "volcanic", (800, -350), "none"),
    ("urborg", "Urborg", "coast", (350, -550), "sea"),
    ("otaria", "Otaria", "temperate", (50, 50), "river"),
    ("llanowar", "Llanowar", "temperate", (-150, -350), "river"),
    ("yavimaya", "Yavimaya", "temperate", (-550, -600), "river"),
    ("keld", "Keld", "temperate", (-800, -150), "none"),
    ("sarpadia", "Sarpadia", "temperate", (-300, -850), "lake"),
)
WEIGHT: Final = 1000

# F.5, "Era regions in the example".
ERA_REGION: Final[dict[str, str]] = {
    "first-cards": "benalia",
    "return": "benalia",
    "brothers-war": "terisiare",
    "ice-age": "terisiare",
    "legends": "tolaria",
    "urza": "tolaria",
    "dark-age": "sarpadia",
    "mirage": "jamuraa",
    "prophecy": "jamuraa",
    "weatherlight": "urborg",
    "invasion": "urborg",
    "otaria-odyssey": "otaria",
    "otaria-onslaught": "otaria",
    "time-spiral": "shiv",
    "united": "llanowar",
}

# F.5, "Keywords in the example, in this precedence".
KEYWORDS: Final[tuple[tuple[str, str], ...]] = (
    ("Tolarian", "tolaria"),
    ("Academy", "tolaria"),
    ("Vesuva", "tolaria"),
    ("Shivan", "shiv"),
    ("Urborg", "urborg"),
    ("Phyrexian", "urborg"),
    ("Benalish", "benalia"),
    ("Serra", "benalia"),
    ("Llanowar", "llanowar"),
    ("Keldon", "keld"),
    ("Yavimaya", "yavimaya"),
    ("Otaria", "otaria"),
    ("Zhalfir", "jamuraa"),
    ("Jamuraa", "jamuraa"),
    ("Femeref", "jamuraa"),
    ("Suq'Ata", "jamuraa"),
    ("Thran", "terisiare"),
    ("Argoth", "terisiare"),
    ("Koilos", "terisiare"),
    ("Kjeldor", "terisiare"),
    ("Balduvia", "terisiare"),
    ("Ice Age", "terisiare"),
    ("Sarpadia", "sarpadia"),
    ("Icatia", "sarpadia"),
)

PLACEHOLDER: Final = "Placeholder for the drafter."


class ExampleError(RuntimeError):
    """The example cannot be generated from this dataset, or the committed files are not it."""


def _first_card(index: LoreIndex, era: str, sets: tuple[str, ...]) -> str:
    """The oracle id that sorts first by its 16 bytes, the order of PRD 4.13.3."""
    cards = [card.oracle_id for card in index.cards_on(PLANE) if card.first_set in sets]
    if not cards:
        raise ExampleError(
            f"the schema example's era {era!r} lists {', '.join(sets)}, and no card of {PLANE} "
            f"in dataset {index.label} is first printed there (Appendix F.5)"
        )
    return min(cards, key=lambda oracle_id: uuid.UUID(oracle_id).bytes)


def tables(index: LoreIndex) -> dict[str, dict[str, Any]]:
    """The three tables, by file name, expanded against ``index``."""
    regions: list[dict[str, Any]] = []
    for ident, name, kit, anchor, water in REGIONS:
        source = f"https://mtg.wiki/page/{name}"
        regions.append(
            {
                "id": ident,
                "name": name,
                "kit": kit,
                "anchor": list(anchor),
                "weight": WEIGHT,
                "water": water,
                "sentence": {"text": f"Placeholder for the drafter: {name}.", "source": source},
                "sources": [source],
            }
        )
    eras: list[dict[str, Any]] = [
        {
            "id": ident,
            "name": name,
            "years": PLACEHOLDER,
            "region": ERA_REGION[ident],
            "sets": list(sets),
            "headline": [],
            "paragraphs": [
                [{"text": PLACEHOLDER, "source": f"card:{_first_card(index, ident, sets)}"}]
            ],
        }
        for ident, name, sets in GROUPS
    ]
    keywords = [{"word": word, "region": region} for word, region in KEYWORDS]
    regions_file, eras_file, keywords_file = FILES
    return {
        regions_file: {"plane": PLANE, "regions": regions},
        eras_file: {"plane": PLANE, "kind": "lore", "eras": eras},
        keywords_file: {"plane": PLANE, "keywords": keywords},
    }


def files(index: LoreIndex) -> dict[str, bytes]:
    """The committed bytes: each table as indented UTF-8 JSON with a final newline."""
    return {
        name: (json.dumps(table, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        for name, table in tables(index).items()
    }


def write(index: LoreIndex, example_dir: Path = EXAMPLE_DIR) -> Path:
    """Write the three files under ``example_dir/dominaria/`` and return that directory."""
    directory = example_dir / PLANE
    directory.mkdir(parents=True, exist_ok=True)
    for name, data in files(index).items():
        (directory / name).write_bytes(data)
    return directory


def differing_files(index: LoreIndex, example_dir: Path = EXAMPLE_DIR) -> list[str]:
    """The files under ``example_dir/dominaria/`` that are not what the rule generates."""
    directory = example_dir / PLANE
    return [
        name
        for name, data in files(index).items()
        if not (directory / name).exists() or (directory / name).read_bytes() != data
    ]
