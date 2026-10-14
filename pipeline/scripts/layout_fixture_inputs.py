"""Write the inputs of the layout fixtures of PRD v4 5.4.14 that leg 1 emits (9.6).

Each fixture is a directory under ``contract/test-vectors/v4/layout/``. This script writes what a
fixture reads: its manifest ``fixture.json``, and for a synthetic fixture a small contract v3 pack
(text only: ``planes.json``, ``search.json`` and one shard), the plane's three lore tables and a
hero-volumes file where the fixture names one. It writes no output: ``eternities layout fixtures``
makes every output from these inputs, and ``eternities layout fixtures --check`` compares them.

The inputs are committed. Run the script again only to change a fixture, and commit its output
with the fixture's new bytes (5.4.18 (12)). Run from ``pipeline/``:
``uv run python scripts/layout_fixture_inputs.py``.

A synthetic hero plane is named for one of the twenty hero entries and its pack holds that slug
(5.4.14, erratum 2). Three figures below were chosen by trial so that a fixture shows what
5.4.14 asks of it, and the fixture's ``purpose`` says which:

- ``elder-days``, the era id of ``era-three-sets-one-card``: with this seed the three stands and
  the two chapter stones stand in one cluster.
- ``ha1``, the set code of ``head-ray-lobe``: with this seed the first sweep direction fails the
  approach test at the site's final radius and the second passes.
- the square of ``dominaria-hero-volumes``: it covers the ground where ``era:the-dark`` stands
  in the ``dominaria`` fixture, so that site moves and the legs to and from it route elsewhere.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2] / "contract" / "test-vectors" / "v4" / "layout"
PRODUCTION = "a5846bec28d1447e"
SOURCE = "https://magic.wizards.com/en/story/fixture"


def _write(path: Path, document: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def oracle(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


def printing(number: int) -> str:
    return f"11111111-0000-4000-8000-{number:012d}"


def manifest(name: str, purpose: str, slug: str, expect: str = "layout", **more: Any) -> None:
    document: dict[str, Any] = {"purpose": purpose, "slug": slug, "expect": expect}
    document.update(more)
    _write(ROOT / name / "fixture.json", document)


def pack(name: str, slug: str, display: str, sets: list[tuple[str, list[str]]]) -> None:
    """A contract v3 pack of one plane: each set's code with the names of its cards.

    Set ids run from 1 in the order given, which is the release order. A card is a common white
    creature with one printing; its ``oracle_id`` is its number in the plane, from 1.
    """
    directory = ROOT / name / "pack"
    listed: list[dict[str, Any]] = []
    cards: list[dict[str, Any]] = []
    for set_id, (code, names) in enumerate(sets, start=1):
        listed.append(
            {
                "id": set_id,
                "code": code,
                "name": f"Fixture set {code}",
                "year": 2000 + set_id,
                "cardCount": len(names),
            }
        )
        for card_name in names:
            number = len(cards) + 1
            cards.append(
                {
                    "u": oracle(number),
                    "n": card_name,
                    "m": "{W}",
                    "t": "Creature — Fixture",
                    "o": "",
                    "b": None,
                    "ci": "W",
                    "r": 0,
                    "l": "normal",
                    "p": [[printing(number), set_id, "c", 0, str(number), "Fixture"]],
                }
            )
    _write(
        directory / "planes.json",
        {
            "contractVersion": 3,
            "shardSize": 2000,
            "planes": [
                {
                    "index": 0,
                    "slug": slug,
                    "displayName": display,
                    "cardCount": len(cards),
                    "starOffset": 0,
                    "starCount": len(cards),
                    "shardCount": 1,
                    "sets": listed,
                }
            ],
        },
    )
    _write(
        directory / "search.json",
        {
            "contractVersion": 3,
            "sets": [{key: row[key] for key in ("id", "code", "name", "year")} for row in listed],
        },
    )
    _write(
        directory / "planes" / f"{slug}.0.json",
        {
            "contractVersion": 3,
            "slug": slug,
            "shard": 0,
            "shardSize": 2000,
            "starOffset": 0,
            "cards": cards,
        },
    )


def region(ident: str, anchor: list[int], weight: int = 1000) -> dict[str, Any]:
    return {
        "id": ident,
        "name": ident.replace("-", " ").title(),
        "kit": "temperate",
        "anchor": anchor,
        "weight": weight,
        "water": "river",
        "sentence": {"text": "A place of stone and wind.", "source": SOURCE},
        "sources": [SOURCE],
    }


def era(ident: str, region_id: str, sets: list[str]) -> dict[str, Any]:
    return {
        "id": ident,
        "name": ident.replace("-", " ").title(),
        "years": "Long before the first war",
        "region": region_id,
        "sets": sets,
        "headline": [],
        "paragraphs": [[{"text": "The first people came by sea.", "source": SOURCE}]],
    }


def tables(
    name: str,
    slug: str,
    regions: list[dict[str, Any]],
    eras: list[dict[str, Any]],
    keywords: list[dict[str, str]],
) -> None:
    directory = ROOT / name / slug
    _write(directory / "regions.json", {"plane": slug, "regions": regions})
    _write(directory / "eras.json", {"plane": slug, "kind": "lore", "eras": eras})
    _write(directory / "keywords.json", {"plane": slug, "keywords": keywords})


def names(prefix: str, count: int) -> list[str]:
    return [f"{prefix} {number}" for number in range(1, count + 1)]


def production() -> None:
    manifest(
        "dominaria",
        "Dominaria from its accepted lore tables and the production pack (5.4.14, 9.6).",
        "dominaria",
        productionPack=PRODUCTION,
        productTables=True,
    )
    for slug, cards in (("rabiah", 75), ("zhalfir", 4), ("vryn", 2), ("shandalar", 1)):
        manifest(
            slug,
            f"{slug.title()} by the kit law from the production pack: {cards} "
            f"card{'s' if cards > 1 else ''}, one set site (5.4.13, 5.4.14).",
            slug,
            productionPack=PRODUCTION,
        )
    manifest(
        "dominaria-hero-volumes",
        "Dominaria with a hero volume over the ground where `era:the-dark` stands in the "
        "`dominaria` fixture: the site moves and the trail routes round the volume (5.4.14).",
        "dominaria",
        productionPack=PRODUCTION,
        productTables=True,
        heroVolumes="volumes.json",
    )


def synthetic() -> None:
    name = "hero-one-region-one-era"
    manifest(
        name,
        "A hero plane with one region and one era of one set: one era site, as the kit law's "
        "one set site (5.4.14).",
        "kamigawa",
        lore="kamigawa",
        loreFixture=True,
    )
    pack(name, "kamigawa", "Kamigawa", [("kx1", names("Shrine Keeper", 12))])
    tables(
        name, "kamigawa", [region("towabara", [0, 0])], [era("kami-war", "towabara", ["kx1"])], []
    )

    name = "era-unmapped-set"
    manifest(
        name,
        "The era table maps `ta1` and leaves `ta2` unmapped: validation fails naming the set "
        "(5.4.3, 5.4.14, F.2).",
        "theros",
        expect="failure",
        lore="theros",
        loreFixture=True,
    )
    pack(
        name,
        "theros",
        "Theros",
        [("ta1", names("Hoplite", 4)), ("ta2", names("Oracle", 3))],
    )
    tables(name, "theros", [region("meletis", [0, 0])], [era("heroes", "meletis", ["ta1"])], [])

    name = "keyword-moves-one-card"
    manifest(
        name,
        "The keyword `Sunspire` names the region `south`; one card of ten carries it and stands "
        "at the regional site `region:south` (5.4.3, 5.4.14).",
        "ixalan",
        lore="ixalan",
        loreFixture=True,
    )
    pack(
        name,
        "ixalan",
        "Ixalan",
        [("ix1", [*names("River Scout", 9), "Sunspire Lookout"])],
    )
    tables(
        name,
        "ixalan",
        [region("north", [0, 400]), region("south", [0, -400])],
        [era("landfall", "north", ["ix1"])],
        [{"word": "Sunspire", "region": "south"}],
    )

    name = "degenerate-cell"
    manifest(
        name,
        "Region `edge` has the least weight and stands at the unit disc's edge, 150 thousandths "
        "from the heaviest region: its cell is empty and the build fails naming it (5.4.5).",
        "tarkir",
        expect="failure",
        lore="tarkir",
        loreFixture=True,
    )
    pack(name, "tarkir", "Tarkir", [("tk1", names("Steppe Rider", 6))])
    tables(
        name,
        "tarkir",
        [region("edge", [1000, 0], 500), region("heavy", [850, 0], 2000)],
        [era("khans", "heavy", ["tk1"])],
        [],
    )

    name = "anchor-outside-unit-disc"
    manifest(
        name,
        "Region `far` has the anchor (800, 700), outside the unit disc: validation fails "
        "(4.16.2, 5.4.14).",
        "eldraine",
        expect="failure",
        lore="eldraine",
        loreFixture=True,
    )
    pack(name, "eldraine", "Eldraine", [("el1", names("Court Knight", 6))])
    tables(
        name,
        "eldraine",
        [region("near", [0, 0]), region("far", [800, 700])],
        [era("courts", "near", ["el1"])],
        [],
    )

    name = "era-three-sets-one-card"
    manifest(
        name,
        "One era of three sets of one card each: one cluster of three stands, and two chapter "
        "stones at two lattice points (5.4.10, 5.4.14). The era id `elder-days` was chosen by "
        "trial for that outcome.",
        "lorwyn",
        lore="lorwyn",
        loreFixture=True,
    )
    pack(
        name,
        "lorwyn",
        "Lorwyn",
        [("lw1", ["Glen Warden"]), ("lw2", ["Thorn Piper"]), ("lw3", ["Dusk Weaver"])],
    )
    tables(
        name,
        "lorwyn",
        [region("glen", [0, 0])],
        [era("elder-days", "glen", ["lw1", "lw2", "lw3"])],
        [],
    )

    name = "head-ray-lobe"
    manifest(
        name,
        "A kit world of one set of twelve cards whose first sweep direction fails the approach "
        "test at the site's final radius; the second try passes and the report names it "
        "(5.4.8, 5.4.14). The set code `ha1` was chosen by trial for that outcome.",
        "mercadia",
    )
    pack(name, "mercadia", "Mercadia", [("ha1", names("Market Guard", 12))])


def volumes() -> None:
    # A square of 120 m about the centre of `era:the-dark` in the `dominaria` fixture.
    centre = THE_DARK
    half = 60_000
    _write(
        ROOT / "dominaria-hero-volumes" / "volumes.json",
        {
            "plane": "dominaria",
            "volumes": [
                {
                    "id": "fixture-keep",
                    "polygon": [
                        [centre[0] - half, centre[1] - half],
                        [centre[0] + half, centre[1] - half],
                        [centre[0] + half, centre[1] + half],
                        [centre[0] - half, centre[1] + half],
                    ],
                }
            ],
        },
    )


THE_DARK = (240_000, -90_000)
"""The centre of ``era:the-dark`` in the ``dominaria`` fixture's ``worlds/dominaria.json``."""


def main() -> int:
    production()
    synthetic()
    volumes()
    print(f"wrote the fixture inputs under {ROOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
