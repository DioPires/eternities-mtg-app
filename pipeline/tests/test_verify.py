"""The first-run verification duties of ``pipeline/verify.py``.

These are report-only — nothing here can change a card's plane — which is exactly why they need
tests. A finding that quietly stops finding anything still renders as a confident verdict, and the
CEO reads the verdict, not the predicate.
"""

from __future__ import annotations

from dataclasses import replace

from conftest import appendices, printing, scry_set, set_entry

from eternities.pipeline.records import RawPrinting, ScrySet
from eternities.pipeline.verify import (
    verify_roster,
    verify_security_stamp,
    verify_set_codes,
    verify_universes_within,
)


def _secret_lair_world() -> tuple[list[RawPrinting], dict[str, ScrySet]]:
    """One card printed in Secret Lair and reprinted, in-universe, in Universes Within."""
    rows = [
        printing(oracle_id="shared", set_code="sld", released_at="2019-12-02"),
        printing(oracle_id="shared", set_code="slx", released_at="2022-03-03"),
    ]
    sets = {
        # The name matters: the B.4 predicate is a code prefix *and* a name substring.
        "sld": scry_set("sld", name="Secret Lair Drop", set_type="box"),
        "slx": scry_set("slx", name="Universes Within", set_type="masters"),
    }
    return rows, sets


def test_universes_within_reports_a_shared_oracle_id():
    """PRD 4.4.5 / Q12, and the A2 fix pinned in one assertion.

    `sld` carries no Appendix B row — B.4 is a rule, not a row list — so the only thing that can
    classify it is the Secret Lair predicate, and that predicate is a code prefix **and** a name
    substring. The bug this replaced passed the set *code* where the name belongs, which made the
    second clause dead: "Secret Lair" never appears in a three-letter code, so `matches("sld",
    "sld")` was `False` and this shared `oracle_id` went unreported. Reading the Scryfall set name
    is what flips it, and the verdict is what the CEO acts on.
    """
    rows, sets = _secret_lair_world()
    apx = appendices(sets=[set_entry("slx", plane="blind-eternities")])

    assert sets["sld"].code.startswith("sl") and "Secret Lair" not in sets["sld"].code
    finding = verify_universes_within(rows, apx, sets)

    assert finding.verdict.startswith("shared — 1 of 1")
    assert finding.action is not None, "a load-bearing exemption goes back to the CEO"


def test_a_code_prefix_alone_does_not_make_a_set_secret_lair():
    """The other clause of the same predicate, so the fix is not just "always true" in disguise.

    `slug` passes the prefix test and fails the name test; without the name clause every `sl…` set
    would be swept in and this verdict would read "shared" for cards that share nothing."""
    rows = [
        printing(oracle_id="shared", set_code="slug", released_at="2019-12-02"),
        printing(oracle_id="shared", set_code="slx", released_at="2022-03-03"),
    ]
    sets = {
        "slug": scry_set("slug", name="Sludge Masters", set_type="masters"),
        "slx": scry_set("slx", name="Universes Within", set_type="masters"),
    }
    apx = appendices(sets=[set_entry("slx", plane="blind-eternities")])

    finding = verify_universes_within(rows, apx, sets)

    assert finding.verdict.startswith("distinct — none of the 1")
    assert finding.action is None


def test_a_universes_beyond_reprint_also_counts_as_shared():
    """The predicate has two arms: the Secret Lair rule and the Appendix B Universes Beyond flag."""
    rows = [
        printing(oracle_id="shared", set_code="ltr", released_at="2023-06-23"),
        printing(oracle_id="shared", set_code="slx", released_at="2024-03-01"),
    ]
    sets = {"ltr": scry_set("ltr"), "slx": scry_set("slx", name="Universes Within")}
    apx = appendices(
        sets=[set_entry("ltr", universes_beyond=True), set_entry("slx", plane="blind-eternities")]
    )

    assert verify_universes_within(rows, apx, sets).verdict.startswith("shared — 1 of 1")


def test_no_slx_printings_is_a_distinct_verdict_not_a_crash():
    rows = [printing(oracle_id="ordinary")]
    finding = verify_universes_within(rows, appendices(), {"tst": scry_set()})
    assert finding.verdict.startswith("distinct — none of the 0")


def test_the_stamp_check_reads_universes_beyond_through_the_parent_chain():
    """Q4 / 4.3.5. A child set carries no Appendix B row, so an own-row-only reading would report
    its triangles as unexplained and make 4.3.5 look unsafe."""
    apx = appendices(sets=[set_entry("ltr", universes_beyond=True)])
    sets = {"ltr": scry_set("ltr"), "pltr": scry_set("pltr", parent_set_code="ltr")}
    rows = [printing(oracle_id="ring", set_code="pltr", security_stamp="triangle")]

    finding = verify_security_stamp(rows, apx, sets)

    assert finding.verdict.startswith("confirmed")
    assert finding.action is None


def test_a_ratified_candidate_stops_being_asked_about():
    """The four planes the board added on 2026-09-04 are on the roster now.

    The finding used to name open question 1's candidates whenever the wiki listed them, whether
    or not Appendix A already had them, and told the CEO to decide. That outlived the question:
    the report exists to surface what needs deciding, so an answered question in it is noise that
    reads like work.
    """
    wiki = ["Kandoka", "Foldaria", "Clamhattan", "Horsehead Nebula"]
    apx = appendices(planes=["blind-eternities", *(w.lower() for w in wiki[:3])], sets=[])
    apx_all = appendices(
        planes=["blind-eternities", "kandoka", "foldaria", "clamhattan", "horsehead-nebula"],
        sets=[],
    )

    partial = verify_roster(apx, wiki)
    assert "horsehead-nebula" in partial.detail[-1], "the one still missing is still asked about"
    assert partial.action is not None and "remaining candidates" in partial.action

    done = verify_roster(apx_all, wiki)
    assert done.verdict == "0 wiki entries absent from Appendix A"
    assert not any("open question 1" in line for line in done.detail)
    assert done.action is not None and "remaining candidates" not in done.action


def test_an_unreachable_wiki_is_reported_rather_than_failing_the_build():
    finding = verify_roster(appendices(), None)
    assert finding.verdict.startswith("not run")
    assert finding.action is not None


def test_a_ratified_set_correction_stops_asking_for_the_prd_edit():
    """Q10's half of the same problem the roster finding had.

    ``tlc`` → ``tle`` was corrected in the data file and then ratified into PRD Appendix B. The
    finding kept telling the CEO "the PRD itself still needs the same edit" in the commit that made
    the edit, and would have gone on saying it every run after. The correction is still worth
    printing as provenance; the *ask* is what has to stop.
    """
    row = set_entry(
        "tle",
        universes_beyond=True,
        prd_name="Avatar: The Last Airbender Commander",
        corrected_from="tlc",
    )
    sets = {"tle": scry_set("tle", name="Avatar: The Last Airbender Eternal")}

    outstanding = verify_set_codes(appendices(sets=[row]), sets)
    assert any("tlc → tle" in line for line in outstanding.detail), "provenance still printed"
    assert outstanding.action is not None
    assert "tle" in outstanding.action, "the ask names the row that needs the edit"

    ratified = verify_set_codes(appendices(sets=[replace(row, prd_ratified="2026-09-04")]), sets)
    assert any("tlc → tle" in line for line in ratified.detail), "provenance survives ratification"
    assert any("ratified into the PRD" in line for line in ratified.detail)
    assert ratified.action is None, "a ratified correction asks for nothing"


def test_an_unratified_correction_still_asks_even_beside_a_ratified_one():
    """The guard the ratification marker needs: one settled row must not silence the next one."""
    settled = set_entry(
        "tle", universes_beyond=True, corrected_from="tlc", prd_ratified="2026-09-04"
    )
    fresh = set_entry("new", universes_beyond=True, corrected_from="old")
    sets = {
        "tle": scry_set("tle", name="Avatar: The Last Airbender Eternal"),
        "new": scry_set("new", name="Some Later Set"),
    }

    finding = verify_set_codes(appendices(sets=[settled, fresh]), sets)
    assert finding.action is not None
    assert "new" in finding.action
    assert "tle" not in finding.action
