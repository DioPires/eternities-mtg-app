"""Sites, assignment and the headline rule (PRD v4 5.4.2, 5.4.3, 5.13.2).

A plane of a few hand-made cards: each test names the one rule it is about. The last tests read
the production pack and Dominaria's committed sidecar, because 5.13.2's order was settled on
that data (DEC-1037).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest

from eternities.layout import cards
from eternities.layout.cards import PlaneCard, PlaneCards, PlaneSet
from eternities.layout.sites import (
    AssignmentError,
    Flagged,
    collector_key,
    headline_cards,
    hero_assignment,
    kit_assignment,
    matches,
    selected_keyword,
)
from eternities.lore.index import LoreIndex
from eternities.lore.spotlight import SIDECAR_NAME, validate_sidecar
from eternities.lore.stage import LORE_ROOT
from eternities.lore.vocabulary import load_hero_entries

REPO_ROOT = Path(__file__).resolve().parents[2]
PACK = REPO_ROOT / "web" / "public" / "data" / "a5846bec28d1447e"

SETS = (
    PlaneSet(1, "aaa", "First", 1994),
    PlaneSet(2, "bbb", "Second", 1995),
    PlaneSet(3, "ccc", "Third", 1996),
)


def oracle(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


def card(
    number: int, name: str, code: str, *, back: str | None = None, type_line: str = "Creature"
) -> PlaneCard:
    record = next(record for record in SETS if record.code == code)
    return PlaneCard(
        oracle_id=oracle(number),
        name=name,
        back_name=back,
        type_line=type_line,
        set_id=record.id,
        set_code=code,
        identity=1,
        rarity=0,
        type_mask=1,
        back_image=back is not None,
        printings=1,
        swatch=0,
        local_index=number,
    )


def plane(*held: PlaneCard) -> PlaneCards:
    codes = {found.set_code for found in held}
    return PlaneCards(
        data_hash="synthetic",
        slug="dominaria",
        display_name="Dominaria",
        plane_index=0,
        sets=tuple(record for record in SETS if record.code in codes),
        cards=tuple(held),
    )


REGIONS = {"regions": [{"id": "north"}, {"id": "east"}, {"id": "south"}]}


def eras(*rows: tuple[str, str, list[str]]) -> dict[str, Any]:
    return {"eras": [{"id": ident, "region": region, "sets": sets} for ident, region, sets in rows]}


def keywords(*rows: tuple[str, str]) -> dict[str, Any]:
    return {"keywords": [{"word": word, "region": region} for word, region in rows]}


# --- the keyword rule of 5.4.3 (b) ----------------------------------------------------------


@pytest.mark.parametrize(
    ("keyword", "name", "found"),
    [
        ("Benalia", "Benalia", True),
        ("Benalia", "Knight of New Benalia", True),
        ("Benalia", "Benalia's Knight", True),
        ("benalia", "BENALIA, the Capital", True),
        ("Benalia", "Benalian Trapper", False),
        ("Shiv", "Shivan Dragon", False),
        ("Shiv", "Fires of Shiv-Keld", True),
        ("Urza", "Urza's Tower", True),
        ("Urza", "Kurza", False),
        ("Keld", "Keldon Warlord // Keld", True),
        ("STRASSE", "Straße", True),
        # The boundary of 5.4.3 is a separator or punctuation, by Unicode general category (the
        # CEO's ruling on DEC-1091, B3): a combining mark and a symbol join the word.
        ("Benalia", "Benalia\u0301n Knight", False),
        ("Benalia", "Benalia+n Knight", False),
        ("Benalia", "Benalia's Knight", True),
        ("Benalia", "Benalia\u2014Knight", True),
        ("Benalia", "Benalia\u00a0Knight", True),
    ],
)
def test_a_keyword_matches_a_whole_word_whatever_the_case(keyword: str, name: str, found: bool):
    assert matches(keyword, name) is found


def test_the_selected_keyword_is_the_first_in_table_order_on_any_face():
    table = [("Shiv", "south"), ("Benalia", "north")]
    both = card(1, "Benalia Burns", "aaa", back="Ash of Shiv")
    assert selected_keyword(both, table) == ("Shiv", "south")
    assert selected_keyword(card(2, "Benalia Stands", "aaa"), table) == ("Benalia", "north")
    assert selected_keyword(card(3, "Plain Soldier", "aaa"), table) is None


# --- sites and assignment --------------------------------------------------------------------


def test_the_kit_law_gives_one_set_site_a_set_in_release_order():
    found = kit_assignment(
        plane(card(3, "Gamma", "ccc"), card(2, "Beta", "aaa"), card(1, "Alpha", "aaa"))
    )
    assert found.law == "kit"
    assert [site.key for site in found.sites] == ["set:aaa", "set:ccc"]
    assert [site.kind for site in found.sites] == ["set", "set"]
    # Within a set site: by `oracle_id` bytes.
    assert [held.name for held in found.sites[0].cards] == ["Alpha", "Beta"]
    assert found.sites[0].chapters == ()
    assert found.sites[0].chapter_stones == 0


def test_a_card_stands_at_its_eras_site_unless_a_keyword_names_another_region():
    held = plane(
        card(1, "Plain Soldier", "aaa"),
        card(2, "Shiv Raider", "aaa"),
        card(3, "Northern Scout of the North", "aaa"),
        card(4, "Second Soldier", "bbb"),
    )
    found = hero_assignment(
        held,
        REGIONS,
        eras(("dawn", "north", ["aaa"]), ("noon", "east", ["bbb"])),
        keywords(("Shiv", "south"), ("North", "north")),
    )
    assert found.law == "hero"
    # Era sites in table order, then regional sites in region-table order.
    assert [site.key for site in found.sites] == ["era:dawn", "era:noon", "region:south"]
    assert [site.region for site in found.sites] == ["north", "east", "south"]
    assert [c.name for c in found.sites[0].cards] == [
        "Plain Soldier",
        "Northern Scout of the North",
    ]
    assert [c.name for c in found.sites[2].cards] == ["Shiv Raider"]
    # The keyword `North` names the era's own region: the card keeps its era site.
    moves = {
        move.card.name: (move.keyword, move.region, move.moved) for move in found.keyword_matches
    }
    assert moves == {
        "Shiv Raider": ("Shiv", "south", True),
        "Northern Scout of the North": ("North", "north", False),
    }
    assert found.selected == {oracle(2): "Shiv", oracle(3): "North"}


def test_the_first_keyword_in_table_order_wins_and_the_two_regions_are_reported():
    held = plane(card(1, "Shiv Envoy to Benalia", "aaa"))
    table = eras(("dawn", "east", ["aaa"]))
    first = hero_assignment(held, REGIONS, table, keywords(("Benalia", "north"), ("Shiv", "south")))
    assert [site.key for site in first.sites] == ["era:dawn", "region:north"]
    assert [(c.name, regions) for c, regions in first.two_regions] == [
        ("Shiv Envoy to Benalia", ("north", "south"))
    ]
    second = hero_assignment(
        held, REGIONS, table, keywords(("Shiv", "south"), ("Benalia", "north"))
    )
    assert [site.key for site in second.sites] == ["era:dawn", "region:south"]


def test_an_era_site_orders_its_cards_by_chapter_then_by_oracle_id():
    held = plane(
        card(5, "Late B", "bbb"),
        card(2, "Early B", "bbb"),
        card(9, "Only A", "aaa"),
        card(1, "Only C", "ccc"),
    )
    found = hero_assignment(
        held, REGIONS, eras(("long", "north", ["ccc", "aaa", "bbb"])), keywords()
    )
    (site,) = found.sites
    # The era's sets in release order, whatever the row's order; then `oracle_id` bytes.
    assert [record.code for record in site.sets] == ["aaa", "bbb", "ccc"]
    assert [c.name for c in site.cards] == ["Only A", "Early B", "Late B", "Only C"]
    assert [(chapter.set.code, len(chapter.cards)) for chapter in site.chapters] == [
        ("aaa", 1),
        ("bbb", 2),
        ("ccc", 1),
    ]
    assert site.chapter_stones == 2


def test_a_chapter_whose_cards_all_moved_is_empty_and_has_no_stone():
    held = plane(card(1, "Plain Soldier", "aaa"), card(2, "Shiv Raider", "bbb"))
    found = hero_assignment(
        held, REGIONS, eras(("long", "north", ["aaa", "bbb"])), keywords(("Shiv", "south"))
    )
    era_site = found.sites[0]
    assert [chapter.set.code for chapter in era_site.chapters] == ["aaa"]
    assert era_site.chapter_stones == 0
    assert found.empty_chapters == (("long", "bbb"),)
    # The era site still lists the set: a stand's set id is in its site's list (4.13.3).
    assert [record.code for record in era_site.sets] == ["aaa", "bbb"]


def test_a_regional_site_orders_its_cards_by_release_then_by_oracle_id():
    held = plane(
        card(1, "Shiv Third", "ccc"), card(7, "Shiv First", "aaa"), card(3, "Shiv Second", "aaa")
    )
    found = hero_assignment(
        held, REGIONS, eras(("long", "north", ["aaa", "ccc"])), keywords(("Shiv", "south"))
    )
    regional = found.sites[1]
    assert (regional.key, regional.kind, regional.era, regional.sets) == (
        "region:south",
        "region",
        None,
        (),
    )
    assert [c.name for c in regional.cards] == ["Shiv Second", "Shiv First", "Shiv Third"]


def test_a_set_with_no_era_fails_naming_the_set():
    held = plane(card(1, "Alpha", "aaa"), card(2, "Beta", "bbb"))
    with pytest.raises(AssignmentError, match="set 'bbb' has first printings on dominaria"):
        hero_assignment(held, REGIONS, eras(("dawn", "north", ["aaa"])), keywords())


def test_a_set_in_two_eras_fails_naming_the_set_and_both_eras():
    held = plane(card(1, "Alpha", "aaa"))
    table = eras(("dawn", "north", ["aaa"]), ("noon", "east", ["aaa"]))
    with pytest.raises(AssignmentError, match="set 'aaa' is in two eras, 'dawn' and 'noon'"):
        hero_assignment(held, REGIONS, table, keywords())


def test_a_keyword_that_names_an_unknown_region_fails_naming_both():
    held = plane(card(1, "Alpha", "aaa"))
    with pytest.raises(AssignmentError, match="keyword 'Shiv' names the unknown region 'west'"):
        hero_assignment(held, REGIONS, eras(("dawn", "north", ["aaa"])), keywords(("Shiv", "west")))


# --- the headline rule of 5.13.2 --------------------------------------------------------------


def _fetch_script_key() -> Any:
    script = REPO_ROOT / "pipeline" / "scripts" / "spotlight_sidecar.py"
    spec = importlib.util.spec_from_file_location("spotlight_sidecar", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._collector_key


def test_collector_numbers_order_by_their_leading_digits_and_a_number_with_none_comes_last():
    numbers = ["VOW-232", "300", "10", "4"]
    assert sorted(numbers, key=collector_key) == ["4", "10", "300", "VOW-232"]
    # Three orders that the code must not reuse (erratum 2, DEC-1037). As text, 10 comes before
    # 4. The fetch script's key reads every digit, so it puts VOW-232 between 10 and 300.
    assert sorted(numbers) != ["4", "10", "300", "VOW-232"]
    assert sorted(numbers, key=_fetch_script_key()) == ["4", "10", "VOW-232", "300"]


def test_collector_numbers_with_one_leading_integer_order_as_strings():
    assert sorted(["10b", "10", "10a", "9"], key=collector_key) == ["9", "10", "10a", "10b"]
    assert collector_key("007") < collector_key("7") < collector_key("7a")


def test_a_headline_counts_a_flagged_printing_in_the_cards_first_set_only():
    held = plane(card(1, "First", "aaa"), card(2, "Second", "aaa"), card(3, "Third", "bbb"))
    era = {"sets": ["aaa", "bbb"], "headline": ["Third"]}
    flagged = [
        Flagged(oracle(2), "aaa", "40"),
        # A flagged reprint of `First` in `bbb`: its first set is `aaa`, so it does not count.
        Flagged(oracle(1), "bbb", "1"),
        # A card of another plane.
        Flagged(oracle(99), "aaa", "2"),
    ]
    found, rule = headline_cards(era, held, flagged)
    assert ([c.name for c in found], rule) == (["Second"], "story spotlight")


def test_headlines_order_by_set_then_by_the_lowest_flagged_number():
    held = plane(
        card(1, "Late Set", "bbb"),
        card(2, "High Number", "aaa"),
        card(3, "Two Printings", "aaa"),
        card(4, "No Digit", "aaa"),
    )
    era = {"sets": ["aaa", "bbb"], "headline": []}
    flagged = [
        Flagged(oracle(1), "bbb", "1"),
        Flagged(oracle(2), "aaa", "300"),
        Flagged(oracle(3), "aaa", "250"),
        # More than one flagged printing in the first set: the card stands under the lowest.
        Flagged(oracle(3), "aaa", "10"),
        Flagged(oracle(4), "aaa", "VOW-232"),
    ]
    found, _ = headline_cards(era, held, flagged)
    assert [c.name for c in found] == ["Two Printings", "High Number", "No Digit", "Late Set"]


def test_at_most_six_headline_cards():
    held = plane(*(card(n, f"Card {n}", "aaa") for n in range(1, 9)))
    flagged = [Flagged(oracle(n), "aaa", str(n)) for n in range(1, 9)]
    found, _ = headline_cards({"sets": ["aaa"], "headline": []}, held, flagged)
    assert [c.name for c in found] == [f"Card {n}" for n in range(1, 7)]


def test_an_era_with_no_flagged_card_reads_its_rows_list_then_its_legendary_creatures():
    held = plane(
        card(1, "Zed the Late", "bbb", type_line="Legendary Creature — Human"),
        card(2, "Abe the Early", "aaa", type_line="Legendary Creature — Elf"),
        card(3, "Bea the Early", "aaa", type_line="Legendary Creature — Elf"),
        card(4, "Cal the Early", "aaa", type_line="Legendary Creature — Elf"),
        card(5, "A Legendary Sword", "aaa", type_line="Legendary Artifact"),
        card(6, "Named", "aaa"),
    )
    listed, rule = headline_cards({"sets": ["aaa", "bbb"], "headline": ["Named"]}, held, [])
    assert ([c.name for c in listed], rule) == (["Named"], "the era row's list")
    legends, rule = headline_cards({"sets": ["aaa", "bbb"], "headline": []}, held, [])
    # The first three legendary creatures by release date, then by name.
    assert ([c.name for c in legends], rule) == (
        ["Abe the Early", "Bea the Early", "Cal the Early"],
        "legendary creatures",
    )


# --- the production pack ----------------------------------------------------------------------

REFERENCE = {
    "dom": ["54", "93", "103", "157"],
    "dmu": ["20", "36", "48", "62", "65", "94"],
    "bro": ["4", "10", "14", "16", "26", "30"],
}
"""The flagged numbers of each set's headline cards, in order (DEC-1037, verdict of 09:59Z)."""


def test_the_headline_cards_of_dominarias_three_flagged_sets(production_index: LoreIndex):
    held = cards.read_plane(PACK, "dominaria")
    sidecar = validate_sidecar(
        LORE_ROOT / "dominaria" / SIDECAR_NAME, production_index, hero_entries=load_hero_entries()
    )
    flagged = [Flagged(p.oracle_id, p.set_code, p.collector_number) for p in sidecar.headline]
    number = {(p.oracle_id, p.set_code): p.collector_number for p in sidecar.headline}
    for code, expected in REFERENCE.items():
        found, rule = headline_cards({"sets": [code], "headline": []}, held, flagged)
        assert rule == "story spotlight"
        assert [number[(c.oracle_id, code)] for c in found] == expected
