"""Unit tests for the stages of PRD 8.2, one rule at a time (PRD 8.9.1).

Each test builds the table it needs by hand and asserts a single rule from PRD 4.3 to 4.6, so a
failure names the rule that broke rather than "the pipeline".
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import appendices, printing, scry_set, set_entry

from eternities.pipeline.appendices import Appendices
from eternities.pipeline.records import (
    RawPrinting,
    ScrySet,
    UnknownEnumError,
    assert_known_enums,
    parse_detail,
)
from eternities.pipeline.stages import (
    PrintingFilterResult,
    UnmappedSetError,
    assign_planes,
    choose_first_printings,
    exclude_cards,
    filter_printings,
)

AS_OF = "2026-09-04"


def _filter(
    rows: list[RawPrinting],
    sets: dict[str, ScrySet] | None = None,
    apx: Appendices | None = None,
    as_of: str = AS_OF,
) -> PrintingFilterResult:
    sets = sets or {"tst": scry_set()}
    return filter_printings(rows, sets, apx or appendices(), as_of)


# --- PRD 4.3 printing inclusion ---------------------------------------------------------------


def test_a_plain_in_universe_printing_survives():
    result = _filter([printing()])
    assert [p.id for p in result.kept] == ["card-1-tst-1"]
    assert not result.dropped_by_rule


@pytest.mark.parametrize(
    ("kwargs", "rule"),
    [
        ({"layout": "token"}, "4.3.3 layout token"),
        ({"layout": "art_series"}, "4.3.3 layout art_series"),
        ({"layout": "reversible_card"}, "4.3.3 layout reversible_card"),
        ({"promo": True}, "4.3.4 promo"),
        ({"digital": True}, "4.3.4 digital"),
        ({"oversized": True}, "4.3.4 oversized"),
        ({"security_stamp": "triangle"}, "4.3.5 security_stamp triangle"),
        ({"lang": "de"}, "4.3.6 non-English"),
        ({"flavor_name": "Godzilla, King of the Monsters"}, "4.3.7 flavor_name"),
    ],
)
def test_printing_level_rules_each_fire(kwargs: dict[str, Any], rule: str):
    result = _filter([printing(**kwargs)])
    assert result.kept == []
    assert result.dropped_by_rule[rule] == 1


def test_an_oval_stamp_is_not_a_triangle():
    """4.3.5 names one stamp value; the others are ordinary in-universe printings."""
    assert len(_filter([printing(security_stamp="oval")]).kept) == 1


@pytest.mark.parametrize(
    "set_type", ["promo", "token", "memorabilia", "minigame", "funny", "alchemy", "vanguard"]
)
def test_excluded_set_types(set_type: str):
    result = _filter([printing()], sets={"tst": scry_set(set_type=set_type)})
    assert result.dropped_by_rule[f"4.3.2 set_type {set_type}"] == 1


def test_universes_beyond_row_drops_every_printing_in_the_set():
    apx = appendices(sets=[set_entry("40k", universes_beyond=True)])
    result = _filter(
        [printing(set_code="40k")],
        sets={"40k": scry_set("40k")},
        apx=apx,
    )
    assert result.dropped_by_rule["4.3.1 Appendix B universes_beyond or excluded"] == 1


def test_secret_lair_is_a_rule_not_a_row():
    """Appendix B.4 states a predicate; new drop codes must not need an appendix edit."""
    result = _filter(
        [printing(set_code="sld"), printing(oracle_id="c2", set_code="slu")],
        sets={
            "sld": scry_set("sld", name="Secret Lair Drop"),
            "slu": scry_set("slu", name="Secret Lair: Ultimate Edition"),
        },
    )
    assert result.dropped_by_rule["4.3.2 Secret Lair"] == 2


def test_universes_within_is_exempt_from_the_secret_lair_rule():
    """PRD Appendix B.4 exempts `slx`; it is an in-universe rework, not a Secret Lair drop."""
    result = _filter(
        [printing(set_code="slx")], sets={"slx": scry_set("slx", name="Universes Within")}
    )
    assert len(result.kept) == 1


def test_unreleased_sets_are_kept_out_and_reported():
    result = _filter(
        [printing(set_code="trk")],
        sets={"trk": scry_set("trk", released_at="2026-11-13")},
    )
    assert result.dropped_by_rule["4.3.8 set unreleased on the run date"] == 1
    assert result.unreleased_sets == ["trk"]


def test_a_set_released_on_the_run_date_is_in():
    result = _filter([printing()], sets={"tst": scry_set(released_at=AS_OF)})
    assert len(result.kept) == 1


# --- PRD 4.4 card exclusion -------------------------------------------------------------------


def test_a_card_with_no_included_printing_is_excluded():
    rows = [printing(promo=True)]
    result = exclude_cards(rows, [], appendices())
    assert result.included == set()
    assert result.excluded_by_rule["4.4.1 no included printing"] == 1


def test_content_warning_excludes_regardless_of_printings():
    rows = [printing(content_warning=True)]
    result = exclude_cards(rows, rows, appendices())
    assert result.included == set()
    assert result.excluded_by_rule["4.4.2 content_warning"] == 1


def test_meld_results_are_not_cards_of_their_own():
    rows = [printing(oracle_id="brisela", is_meld_result=True)]
    result = exclude_cards(rows, rows, appendices())
    assert result.excluded_by_rule["4.4.6 meld result"] == 1


def test_universes_beyond_origin_uses_the_earliest_printing_not_any_printing():
    """PRD 4.4.3's whole point, in two cards.

    Sol Ring is first printed in-universe and reprinted inside a Universes Beyond product: it
    stays. The One Ring is first printed in a Universes Beyond set and reprinted in a mixed
    product: it goes. An any-printing test would get both backwards.
    """
    apx = appendices(
        sets=[set_entry("lea"), set_entry("ltr", universes_beyond=True), set_entry("plst")]
    )
    sol_ring = [
        printing(oracle_id="sol-ring", set_code="lea", released_at="1993-08-05"),
        printing(oracle_id="sol-ring", set_code="40k", released_at="2022-10-07"),
    ]
    one_ring = [
        printing(oracle_id="one-ring", set_code="ltr", released_at="2023-06-23"),
        printing(oracle_id="one-ring", set_code="plst", released_at="2024-01-01"),
    ]
    rows = sol_ring + one_ring
    included = [rows[0], rows[3]]  # what 4.3 would leave: the in-universe printings
    result = exclude_cards(rows, included, apx)
    assert "sol-ring" in result.included
    assert "one-ring" not in result.included
    assert result.excluded_by_rule["4.4.3 Universes Beyond origin"] == 1


def test_a_triangle_stamped_earliest_printing_marks_a_universes_beyond_card():
    rows = [printing(oracle_id="ub", security_stamp="triangle", set_code="mix")]
    apx = appendices(sets=[set_entry("mix")])
    result = exclude_cards(rows, rows, apx)
    assert result.included == set()


def test_a_flavor_named_triangle_printing_does_not_condemn_the_card():
    """4.4.3's stamp clause spares flavour-named printings: those are skins on in-universe cards."""
    rows = [printing(oracle_id="ikoria", security_stamp="triangle", flavor_name="Godzilla")]
    apx = appendices(sets=[set_entry("tst")])
    assert exclude_cards(rows, rows, apx).included == {"ikoria"}


def test_universes_within_exemption_overrides_the_origin_test():
    """PRD 4.4.5: an `slx` printing rescues a card whose earliest printing is Universes Beyond."""
    apx = appendices(
        sets=[set_entry("ltr", universes_beyond=True), set_entry("slx", plane="blind-eternities")]
    )
    rows = [
        printing(oracle_id="within", set_code="ltr", released_at="2023-06-23"),
        printing(oracle_id="within", set_code="slx", released_at="2024-03-01"),
    ]
    result = exclude_cards(rows, [rows[1]], apx)
    assert result.included == {"within"}


# --- PRD 4.5 first printing -------------------------------------------------------------------


def test_first_printing_is_the_earliest_release_date():
    sets = {
        "old": scry_set("old", released_at="1994-01-01"),
        "new": scry_set("new", released_at="2020-01-01"),
    }
    rows = [
        printing(set_code="new", released_at="2020-01-01"),
        printing(set_code="old", released_at="1994-01-01"),
    ]
    chosen = choose_first_printings(rows, {"card-1"}, sets)
    assert chosen["card-1"].set_code == "old"


def test_first_printing_uses_the_printings_date_not_the_sets():
    """The List keeps adding printings years after its single set date (see the stage docstring).

    Ordering by the set date made The List the first printing of 706 cards on the first real run,
    including cards plainly printed elsewhere first. This is the regression test for that.
    """
    sets = {
        "mh2": scry_set("mh2", released_at="2021-06-18"),
        "plst": scry_set("plst", released_at="2020-09-26", set_type="masters"),
    }
    rows = [
        printing(set_code="plst", released_at="2023-09-08"),
        printing(set_code="mh2", released_at="2021-06-18"),
    ]
    assert choose_first_printings(rows, {"card-1"}, sets)["card-1"].set_code == "mh2"


def test_first_printing_ties_break_on_set_type_then_code():
    """PRD 4.5.1: expansion and core outrank everything else on the same day."""
    sets = {
        "cmd": scry_set("cmd", released_at="2018-04-27", set_type="commander"),
        "dom": scry_set("dom", released_at="2018-04-27", set_type="expansion"),
        "aaa": scry_set("aaa", released_at="2018-04-27", set_type="masters"),
    }
    rows = [printing(set_code="cmd"), printing(set_code="aaa"), printing(set_code="dom")]
    assert choose_first_printings(rows, {"card-1"}, sets)["card-1"].set_code == "dom"

    del sets["dom"]
    rows = [r for r in rows if r.set_code != "dom"]
    assert choose_first_printings(rows, {"card-1"}, sets)["card-1"].set_code == "aaa"


def test_first_printing_is_independent_of_input_order():
    """PRD 8.9.1: ties resolve deterministically, whatever order the rows arrived in.

    Collector numbers are compared as strings because Scryfall's are strings - `266`, `266*`,
    `DDJ-45`. Which of two printings inside one set wins is arbitrary; that it is always the same
    one is not.
    """
    sets = {"tst": scry_set()}
    rows = [
        printing(collector_number="10", printing_id="b"),
        printing(collector_number="2", printing_id="a"),
    ]
    forward = choose_first_printings(rows, {"card-1"}, sets)["card-1"].id
    backward = choose_first_printings(list(reversed(rows)), {"card-1"}, sets)["card-1"].id
    assert forward == backward


# --- PRD 4.6 plane assignment -----------------------------------------------------------------


def test_rules_are_evaluated_in_order_and_the_override_wins():
    apx = appendices(sets=[set_entry("tst", plane="dominaria")], overrides={"Test Card": "ravnica"})
    result = assign_planes({"card-1": printing()}, {"tst": scry_set()}, apx)
    assert result.by_oracle_id == {"card-1": "ravnica"}
    assert result.via_override == ["Test Card"]


def test_a_child_set_inherits_its_parents_plane_and_the_inheritance_is_reported():
    apx = appendices(sets=[set_entry("dom", plane="dominaria")])
    sets = {"dom": scry_set("dom"), "dmr": scry_set("dmr", parent_set_code="dom")}
    result = assign_planes({"card-1": printing(set_code="dmr")}, sets, apx)
    assert result.by_oracle_id == {"card-1": "dominaria"}
    assert result.via_parent == {"dmr": "dom"}


def test_an_unmapped_set_fails_the_run_and_names_itself():
    """PRD 4.6.4: new sets are added to Appendix B deliberately, never bucketed silently."""
    apx = appendices(sets=[set_entry("dom", plane="dominaria")])
    with pytest.raises(UnmappedSetError, match="xyz"):
        assign_planes({"card-1": printing(set_code="xyz")}, {"xyz": scry_set("xyz")}, apx)


def test_a_universes_beyond_row_is_not_a_plane_mapping():
    """Its printings are already gone by 4.3.1; reaching 4.6 with one is a bug, not a fallback."""
    apx = appendices(sets=[set_entry("ltr", universes_beyond=True)])
    with pytest.raises(UnmappedSetError, match="ltr"):
        assign_planes({"card-1": printing(set_code="ltr")}, {"ltr": scry_set("ltr")}, apx)


# --- PRD 7.7.2 fail-loud on unknown enums -----------------------------------------------------


@pytest.mark.parametrize(
    ("kwargs", "needle"),
    [
        ({"rarity": "legendary"}, "rarity"),
        ({"layout": "hypercube"}, "layout"),
        ({"security_stamp": "square"}, "security_stamp"),
    ],
)
def test_unknown_printing_enums_fail_the_run(kwargs: dict[str, Any], needle: str):
    with pytest.raises(UnknownEnumError, match=needle):
        assert_known_enums([printing(**kwargs)], [scry_set()])


def test_an_unknown_set_type_fails_the_run():
    with pytest.raises(UnknownEnumError, match="set_type"):
        assert_known_enums([printing()], [scry_set(set_type="holofoil_bonanza")])


def test_every_offending_value_is_reported_at_once():
    """One run should tell the owner about all of them, not one per re-run."""
    with pytest.raises(UnknownEnumError) as error:
        assert_known_enums(
            [printing(rarity="legendary"), printing(layout="hypercube")],
            [scry_set(set_type="holofoil_bonanza")],
        )
    message = str(error.value)
    assert "legendary" in message and "hypercube" in message and "holofoil_bonanza" in message


# --- oracle detail parsing --------------------------------------------------------------------


def test_a_split_cards_text_is_read_from_its_faces():
    """Scryfall gives a split card no top-level oracle_text at all (data contract §9)."""
    detail = parse_detail(
        {
            "id": "p1",
            "oracle_id": "fire-ice",
            "layout": "split",
            "color_identity": ["U", "R"],
            "type_line": "Instant // Instant",
            "card_faces": [
                {"name": "Fire", "mana_cost": "{1}{R}", "type_line": "Instant", "oracle_text": "…"},
                {"name": "Ice", "mana_cost": "{1}{U}", "type_line": "Instant", "oracle_text": "…"},
            ],
        }
    )
    assert detail.front.name == "Fire"
    assert detail.back is not None
    assert detail.back.name == "Ice"
    assert detail.colour_identity == "UR"


def test_a_meld_component_links_to_its_result():
    detail = parse_detail(
        {
            "id": "bruna",
            "oracle_id": "bruna",
            "layout": "meld",
            "color_identity": ["W"],
            "name": "Bruna, the Fading Light",
            "type_line": "Legendary Creature — Angel Horror",
            "oracle_text": "…",
            "all_parts": [
                {"id": "bruna", "component": "meld_part"},
                {"id": "brisela", "component": "meld_result"},
            ],
        }
    )
    assert detail.meld_result_id == "brisela"
    assert detail.back is None  # the result is a separate object, not a card face
