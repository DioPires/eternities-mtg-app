"""Unit tests for the stages of PRD 8.2, one rule at a time (PRD 8.9.1).

Each test builds the table it needs by hand and asserts a single rule from PRD 4.3 to 4.6, so a
failure names the rule that broke rather than "the pipeline".
"""

from __future__ import annotations

from typing import Any

import pytest
from conftest import appendices, card_override, printing, scry_set, set_entry

from eternities.pipeline.appendices import Appendices
from eternities.pipeline.records import (
    RawPrinting,
    ScrySet,
    UnknownEnumError,
    assert_known_enums,
    parse_detail,
)
from eternities.pipeline.stages import (
    CardExclusionResult,
    OverrideDriftError,
    UNRELEASED_RULE,
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


def _exclude(
    rows: list[RawPrinting],
    included: list[RawPrinting],
    apx: Appendices,
    sets: dict[str, ScrySet] | None = None,
) -> CardExclusionResult:
    """4.4 needs the sets table for the same parent walk 4.3.1 uses; most rules do not exercise it.

    An empty table is not a shortcut: `governing_set_row` with no set to climb from resolves to the
    printing's own Appendix B row, which is what every test here that passes `None` is asserting.
    """
    return exclude_cards(rows, included, apx, sets or {})


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


def test_an_excluded_row_drops_every_printing_in_the_set():
    """4.3.1's other half. Appendix B has no `excluded` row today; the rule still has to work."""
    apx = appendices(sets=[set_entry("bad", excluded=True)])
    result = _filter([printing(set_code="bad")], sets={"bad": scry_set("bad")}, apx=apx)
    assert result.kept == []
    assert result.dropped_by_rule["4.3.1 Appendix B universes_beyond or excluded"] == 1


def test_a_child_of_a_universes_beyond_set_drops_through_its_parents_row():
    """4.3.1 through the parent chain, the way 4.6 rule 3 already reads Appendix B.

    Appendix B rows a product, not every code Scryfall splits it into. `pza` — TMNT Source
    Material, parent `tmt` — has no row of its own, and no other 4.3 rule catches it: its
    `set_type` is `masterpiece`, its stamp is `oval`, and it carries no `flavor_name`. Reading
    4.3.1 as "own row only" put 15 of its printings into the shipped artefacts and `pza` into
    `search.json` as a facet value.
    """
    apx = appendices(sets=[set_entry("tmt", universes_beyond=True)])
    sets = {
        "tmt": scry_set("tmt"),
        "pza": scry_set("pza", set_type="masterpiece", parent_set_code="tmt"),
    }
    result = _filter([printing(set_code="pza", security_stamp="oval")], sets=sets, apx=apx)
    assert result.kept == []
    assert (
        result.dropped_by_rule[
            "4.3.1 Appendix B universes_beyond or excluded (inherited from a parent)"
        ]
        == 1
    )
    assert result.dropped_via_parent == {"pza": "tmt"}, (
        "an inherited drop must be reported, not silent"
    )
    assert result.parent_rule_only == {"pza": 1}, "nothing else in 4.3 catches this printing"


def test_a_child_caught_by_another_rule_is_not_counted_as_load_bearing():
    """The parent-drop table is long and almost entirely over-determined.

    A Universes Beyond release's token set is dropped by 4.3.2 whichever Appendix B row is
    consulted, so listing it beside `pza` invites the reader to think the walk is doing dozens of
    sets' worth of work. `parent_rule_only` counts only the printings that no other 4.3 rule would
    have caught, and the report prints that number rather than asserting one in prose.
    """
    apx = appendices(sets=[set_entry("tmt", universes_beyond=True)])
    sets = {
        "tmt": scry_set("tmt"),
        "ttmt": scry_set("ttmt", set_type="token", parent_set_code="tmt"),
    }
    result = _filter([printing(set_code="ttmt")], sets=sets, apx=apx)
    assert result.kept == []
    assert result.dropped_via_parent == {"ttmt": "tmt"}
    assert result.parent_rule_only == {}, "4.3.2 would have dropped it anyway"


def test_the_parent_walk_climbs_more_than_one_level():
    """`tltc` reaches `ltr` through `ltc`; the chain is not always one hop."""
    apx = appendices(sets=[set_entry("ltr", universes_beyond=True)])
    sets = {
        "ltr": scry_set("ltr"),
        "ltc": scry_set("ltc", parent_set_code="ltr"),
        "tltc": scry_set("tltc", set_type="masterpiece", parent_set_code="ltc"),
    }
    result = _filter([printing(set_code="tltc")], sets=sets, apx=apx)
    assert result.kept == []
    assert result.dropped_via_parent == {"tltc": "ltr"}


def test_the_nearest_row_wins_so_an_in_universe_child_survives():
    """A child of an in-universe product is in-universe, whatever sits further up the chain."""
    apx = appendices(
        sets=[set_entry("ub", universes_beyond=True), set_entry("dom", plane="dominaria")]
    )
    sets = {
        "ub": scry_set("ub"),
        "dom": scry_set("dom", parent_set_code="ub"),
        "dmr": scry_set("dmr", parent_set_code="dom"),
    }
    result = _filter([printing(set_code="dmr")], sets=sets, apx=apx)
    assert len(result.kept) == 1
    assert not result.dropped_via_parent


def test_an_unrowed_set_with_no_rowed_ancestor_is_left_alone():
    """4.3.1 must not become "no row means drop": reprint-only products carry no row (PRD 4.6)."""
    sets = {"tst": scry_set(), "mma": scry_set("mma", set_type="masters")}
    result = _filter([printing(set_code="mma")], sets=sets)
    assert len(result.kept) == 1


def test_a_parent_cycle_terminates():
    """Scryfall would not publish one, but a parse of somebody else's data does not assume it."""
    apx = appendices(sets=[set_entry("dom", plane="dominaria")])
    sets = {"a": scry_set("a", parent_set_code="b"), "b": scry_set("b", parent_set_code="a")}
    assert len(_filter([printing(set_code="a")], sets=sets, apx=apx).kept) == 1


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
        [printing(set_code="trk", released_at="2026-11-13")],
        sets={"trk": scry_set("trk", released_at="2026-11-13")},
    )
    assert result.dropped_by_rule[UNRELEASED_RULE] == 1
    assert result.unreleased_by_set == {"trk": 1}


def test_an_unreleased_printing_in_a_released_set_is_kept_out():
    """PRD 4.3.8 as amended: the printing's own date decides, not the set's.

    The `fdc` shape: Scryfall dates the set 2024-11-15 but dates most of its printings after the run
    date. Reading the set date keeps both printings here; reading the printing's keeps one.
    """
    shipped = printing(oracle_id="shipped", set_code="fdc", released_at="2024-11-15")
    preview = printing(oracle_id="preview", set_code="fdc", released_at="2026-10-02")
    result = _filter([shipped, preview], sets={"fdc": scry_set("fdc", released_at="2024-11-15")})
    assert [p.oracle_id for p in result.kept] == ["shipped"]
    assert result.dropped_by_rule[UNRELEASED_RULE] == 1
    assert result.unreleased_by_set == {"fdc": 1}


def test_a_set_released_on_the_run_date_is_in():
    result = _filter([printing()], sets={"tst": scry_set(released_at=AS_OF)})
    assert len(result.kept) == 1


# --- PRD 4.4 card exclusion -------------------------------------------------------------------


def test_a_card_with_no_included_printing_is_excluded():
    rows = [printing(promo=True)]
    result = _exclude(rows, [], appendices())
    assert result.included == set()
    assert result.excluded_by_rule["4.4.1 no included printing"] == 1


def test_content_warning_excludes_regardless_of_printings():
    rows = [printing(content_warning=True)]
    result = _exclude(rows, rows, appendices())
    assert result.included == set()
    assert result.excluded_by_rule["4.4.2 content_warning"] == 1


def test_meld_results_are_not_cards_of_their_own():
    rows = [printing(oracle_id="brisela", is_meld_result=True)]
    result = _exclude(rows, rows, appendices())
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
    result = _exclude(rows, included, apx)
    assert "sol-ring" in result.included
    assert "one-ring" not in result.included
    assert result.excluded_by_rule["4.4.3 Universes Beyond origin"] == 1


def test_a_triangle_stamped_earliest_printing_marks_a_universes_beyond_card():
    rows = [printing(oracle_id="ub", security_stamp="triangle", set_code="mix")]
    apx = appendices(sets=[set_entry("mix")])
    result = _exclude(rows, rows, apx)
    assert result.included == set()


def test_a_flavor_named_triangle_printing_does_not_condemn_the_card():
    """4.4.3's stamp clause spares flavour-named printings: those are skins on in-universe cards."""
    rows = [printing(oracle_id="ikoria", security_stamp="triangle", flavor_name="Godzilla")]
    apx = appendices(sets=[set_entry("tst")])
    assert _exclude(rows, rows, apx).included == {"ikoria"}


def test_a_stamp_exempt_row_keeps_its_triangle_printings():
    """4.3.5 honours `stampExempt`: the stamp is a proxy and Appendix B may say it is wrong here."""
    rows = [printing(set_code="clu", security_stamp="triangle")]
    apx = appendices(sets=[set_entry("clu", plane="ravnica", stamp_exempt=True)])
    result = _filter(rows, sets={"clu": scry_set("clu")}, apx=apx)
    assert len(result.kept) == 1
    assert result.dropped_by_rule["4.3.5 security_stamp triangle"] == 0


def test_the_stamp_exemption_must_reach_the_origin_test_too():
    """The half of the `clu` fix that is easy to leave out — and the control that proves it.

    Exempting a set in 4.3.5 alone is not enough to ship a card. Its printings then clear stage 2
    and land in 4.4.3, whose stamp clause reads the *same* `triangle` on the *same* earliest
    printing and excludes the card instead. The set moves from "dropped by 4.3.5" to "dropped by
    4.4.3" and still ships nothing.

    Both halves are asserted here against one input, so the pair cannot pass vacuously: the
    `stamp_exempt=False` leg is the negative control, and it is what fails if the exemption is
    removed from `_originates_universes_beyond` while 4.3.5 keeps its own.
    """
    rows = [printing(oracle_id="scarlett", set_code="clu", security_stamp="triangle")]
    sets = {"clu": scry_set("clu")}

    # Control: without the exemption, 4.4.3 is what excludes the card once 4.3.5 has been passed.
    unexempt = appendices(sets=[set_entry("clu", plane="ravnica")])
    control = _exclude(rows, rows, unexempt, sets)
    assert control.included == set()
    assert control.excluded_by_rule["4.4.3 Universes Beyond origin"] == 1

    # Treatment: the exemption reaches 4.4.3, so the card ships.
    exempt = appendices(sets=[set_entry("clu", plane="ravnica", stamp_exempt=True)])
    treatment = _exclude(rows, rows, exempt, sets)
    assert treatment.included == {"scarlett"}
    assert treatment.excluded_by_rule["4.4.3 Universes Beyond origin"] == 0


def test_a_stamp_exemption_does_not_leak_to_other_sets():
    """The exemption is a statement about one set, not a change to what `triangle` means."""
    rows = [printing(oracle_id="ub", set_code="mix", security_stamp="triangle")]
    apx = appendices(sets=[set_entry("clu", plane="ravnica", stamp_exempt=True), set_entry("mix")])
    sets = {"clu": scry_set("clu"), "mix": scry_set("mix")}
    assert _filter(rows, sets=sets, apx=apx).dropped_by_rule["4.3.5 security_stamp triangle"] == 1
    assert _exclude(rows, rows, apx, sets).included == set()


def test_a_stamp_exempt_universes_beyond_row_is_a_contradiction():
    """The two flags assert opposite things, so the loader refuses rather than picking a winner."""
    with pytest.raises(ValueError, match="stampExempt"):
        appendices(sets=[set_entry("oops", universes_beyond=True, stamp_exempt=True)])


def test_a_stamp_exemption_inherits_to_a_child_set():
    """4.3.5 reads the governing row, so a child of an exempt product line is exempt too.

    Same walk as 4.3.1's drop. Reading the set's own row instead would let a child disagree with
    the parent whose exemption it was — the shape the `pza` leak had.
    """
    rows = [printing(set_code="pclu", security_stamp="triangle")]
    apx = appendices(sets=[set_entry("clu", plane="ravnica", stamp_exempt=True)])
    sets = {"clu": scry_set("clu"), "pclu": scry_set("pclu", parent_set_code="clu")}
    assert len(_filter(rows, sets=sets, apx=apx).kept) == 1


def test_universes_within_exemption_overrides_the_origin_test():
    """PRD 4.4.5: an `slx` printing rescues a card whose earliest printing is Universes Beyond."""
    apx = appendices(
        sets=[set_entry("ltr", universes_beyond=True), set_entry("slx", plane="blind-eternities")]
    )
    rows = [
        printing(oracle_id="within", set_code="ltr", released_at="2023-06-23"),
        printing(oracle_id="within", set_code="slx", released_at="2024-03-01"),
    ]
    result = _exclude(rows, [rows[1]], apx)
    assert result.included == {"within"}


def test_universes_beyond_origin_follows_the_parent_chain_like_4_3_1_does():
    """4.4.3 reads Appendix B through `governing_set_row`, not the earliest printing's own row.

    Appendix B rows a product, so a Universes Beyond release's children — promos, art series,
    bonus sheets — carry no row. Reading 4.4.3 as "own row only" made this file read one appendix
    two different ways, which is the shape the `pza` leak had in 4.3.1.

    The stamp clause is deliberately absent here: an unstamped printing in an unrowed child set is
    exactly the case the own-row reading gets wrong and the walk gets right.
    """
    apx = appendices(sets=[set_entry("ltr", universes_beyond=True), set_entry("plst")])
    sets = {
        "ltr": scry_set("ltr"),
        "pltr": scry_set("pltr", parent_set_code="ltr"),
        "plst": scry_set("plst"),
    }
    rows = [
        printing(oracle_id="one-ring", set_code="pltr", released_at="2023-06-23"),
        printing(oracle_id="one-ring", set_code="plst", released_at="2024-01-01"),
    ]
    result = _exclude(rows, [rows[1]], apx, sets)
    assert result.included == set()
    assert result.excluded_by_rule["4.4.3 Universes Beyond origin"] == 1


def test_basic_lands_are_included():
    """PRD 4.4.4, which is a positive rule: nothing in 4.3 or 4.4 may quietly take them out.

    Basic lands are the one card class where an over-eager set-type or layout rule would be easy
    to miss — every plane has hundreds of them and their absence would read as a data gap, not a
    rule change.
    """
    rows = [
        printing(oracle_id="island", name="Island", set_code="lea"),
        printing(oracle_id="wastes", name="Wastes", set_code="ogw"),
    ]
    apx = appendices(sets=[set_entry("lea"), set_entry("ogw")])
    sets = {"lea": scry_set("lea"), "ogw": scry_set("ogw")}
    assert len(_filter(rows, sets=sets, apx=apx).kept) == 2
    assert _exclude(rows, rows, apx).included == {"island", "wastes"}


def test_fiora_conspiracies_are_included():
    """PRD 4.4.7. Conspiracies are booster cards printed on a plane, unlike planes and schemes.

    The distinction is the layout: 4.3.3 drops `planar`, `scheme` and `vanguard`, and a conspiracy
    is `normal`. Nothing else in the pipeline names conspiracies, so this is the only thing
    stopping a future addition to `EXCLUDED_LAYOUTS` from emptying Fiora.
    """
    rows = [printing(oracle_id="backup-plan", name="Backup Plan", set_code="cns")]
    apx = appendices(planes=["blind-eternities", "fiora"], sets=[set_entry("cns", plane="fiora")])
    sets = {"cns": scry_set("cns", name="Conspiracy", set_type="draft_innovation")}
    result = _filter(rows, sets=sets, apx=apx)
    assert len(result.kept) == 1
    assert _exclude(rows, result.kept, apx, sets).included == {"backup-plan"}
    assert assign_planes(
        choose_first_printings(result.kept, {"backup-plan"}, sets), sets, apx
    ).by_oracle_id == {"backup-plan": "fiora"}


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
    apx = appendices(sets=[set_entry("tst", plane="dominaria")], overrides=[card_override()])
    result = assign_planes({"card-1": printing()}, {"tst": scry_set()}, apx)
    assert result.by_oracle_id == {"card-1": "ravnica"}
    assert result.via_override == ["Test Card -> ravnica"]
    assert result.unused_overrides == []


def test_an_override_moves_only_the_card_holding_its_oracle_id():
    """Review finding D1: the key is the ``oracle_id``, so a shared name is not a shared fate.

    Two distinct cards with the same front-face name is the case the old name key got wrong — it
    moved both, and the report named one line for what was two moves. Nothing in the roster
    depends on the pair being real; what matters is that the key discriminates.
    """
    apx = appendices(
        sets=[set_entry("tst", plane="dominaria")], overrides=[card_override("card-1")]
    )
    printings = {"card-1": printing("card-1"), "card-2": printing("card-2")}
    result = assign_planes(printings, {"tst": scry_set()}, apx)
    assert result.by_oracle_id == {"card-1": "ravnica", "card-2": "dominaria"}
    assert result.via_override == ["Test Card -> ravnica"]


def test_an_override_whose_name_no_longer_matches_fails_the_run():
    apx = appendices(
        sets=[set_entry("tst", plane="dominaria")],
        overrides=[card_override("card-1", name="Renamed Since Curation")],
    )
    with pytest.raises(OverrideDriftError, match="Renamed Since Curation"):
        assign_planes({"card-1": printing("card-1", name="Test Card")}, {"tst": scry_set()}, apx)


def test_an_override_matching_no_first_printing_is_reported_not_raised():
    """A curated line that does nothing is reported, never silent — and never fatal.

    An override for a card 4.3 or 4.4 excludes is a legitimate state: the record is correct and
    simply has nothing to act on. Failing the build on it would make the curated file a hostage of
    every exclusion rule, so the run succeeds and the report names the record.
    """
    apx = appendices(
        sets=[set_entry("tst", plane="dominaria")],
        overrides=[card_override("card-gone", name="Vanished Card")],
    )
    result = assign_planes({"card-1": printing("card-1")}, {"tst": scry_set()}, apx)
    assert result.by_oracle_id == {"card-1": "dominaria"}
    assert result.via_override == []
    assert result.unused_overrides == ["Vanished Card (card-gone) -> ravnica"]


def test_a_child_set_inherits_its_parents_plane_and_the_inheritance_is_reported():
    apx = appendices(sets=[set_entry("dom", plane="dominaria")])
    sets = {"dom": scry_set("dom"), "dmr": scry_set("dmr", parent_set_code="dom")}
    result = assign_planes({"card-1": printing(set_code="dmr")}, sets, apx)
    assert result.by_oracle_id == {"card-1": "dominaria"}
    assert result.via_parent == {"dmr": "dom"}


def test_a_grandchild_set_inherits_through_the_whole_parent_chain():
    """4.6 rule 3 is a walk, not a single hop.

    A one-level lookup — which is what this did — fails a grandchild under 4.6.4 instead of
    inheriting, and leaves 4.6 reading "parent" differently from 4.3.1 and the stamp check, which
    both use `governing_set_row`. The reported inheritance names the ancestor that actually
    supplied the row, not the immediate parent, so the report says where the plane came from.
    """
    apx = appendices(sets=[set_entry("dom", plane="dominaria")])
    sets = {
        "dom": scry_set("dom"),
        "dmr": scry_set("dmr", parent_set_code="dom"),
        "pdmr": scry_set("pdmr", parent_set_code="dmr"),
    }
    result = assign_planes({"card-1": printing(set_code="pdmr")}, sets, apx)
    assert result.by_oracle_id == {"card-1": "dominaria"}
    assert result.via_parent == {"pdmr": "dom"}


def test_the_nearest_appendix_row_wins_over_a_further_ancestor():
    """`governing_set_row`'s tie-break, read through 4.6: a child of an in-universe line is
    in-universe whatever sits further up the chain."""
    apx = appendices(
        sets=[set_entry("old", plane="dominaria"), set_entry("mid", plane="ravnica")],
        planes=["blind-eternities", "dominaria", "ravnica"],
    )
    sets = {
        "old": scry_set("old"),
        "mid": scry_set("mid", parent_set_code="old"),
        "new": scry_set("new", parent_set_code="mid"),
    }
    result = assign_planes({"card-1": printing(set_code="new")}, sets, apx)
    assert result.by_oracle_id == {"card-1": "ravnica"}
    assert result.via_parent == {"new": "mid"}


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
