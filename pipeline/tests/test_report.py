"""PRD 8.9.1's report snapshot test, over :mod:`eternities.pipeline.report`.

The report is not decoration. PRD 8.8.3 commits it beside the data so a refresh reviews as a diff,
and PRD 9.2 turns three of its sections into quality gates. That makes its *text* the artefact —
a section that quietly stops rendering is a gate that quietly stops existing — so this locks the
whole document against a committed snapshot and then asserts the three gate rows individually, so
a failure says which gate moved rather than "the report changed".

The fixture is deliberately small and hand-built: 12 cards over 3 planes, one of them empty, with
every optional section populated. Regenerate the snapshot with::

    UPDATE_REPORT_SNAPSHOT=1 uv run pytest tests/test_report.py

and read the diff before committing it.
"""

from __future__ import annotations

import difflib
import json
import os
from collections import Counter
from pathlib import Path

import pytest
from conftest import appendices, printing, scry_set, set_entry

from eternities.contract import write_dataset
from eternities.pipeline.assemble import CardInput, build_dataset
from eternities.pipeline.records import CardDetail, FaceDetail
from eternities.pipeline.report import ReportInput, diff_planes, load_previous_planes, render
from eternities.pipeline.verify import Finding

SNAPSHOT = Path(__file__).parent / "data" / "report-snapshot.md"

AS_OF = "2026-09-04"
BULK_UPDATED_AT = "2026-09-04T09:05:32.308+00:00"
BULK_URI = "https://data.scryfall.io/default-cards/default-cards-20260904090532.json"

PLANES = ["blind-eternities", "dominaria", "ravnica", "segovia"]
SETS = {
    "lea": scry_set("lea", name="Limited Edition Alpha", released_at="1993-08-05"),
    "rav": scry_set("rav", name="Ravnica: City of Guilds", released_at="2005-10-07"),
    "mh1": scry_set("mh1", name="Modern Horizons", released_at="2019-06-14", set_type="draft"),
    "dmr": scry_set(
        "dmr", name="Dominaria Remastered", released_at="2023-01-13", parent_set_code="lea"
    ),
}
APX = appendices(
    planes=PLANES,
    sets=[
        set_entry("lea", plane="dominaria"),
        set_entry("rav", plane="ravnica"),
        set_entry("mh1", plane="blind-eternities"),
    ],
)

_IDENTITIES = ["W", "U", "B", "R", "G", "WU", "", "BRG"]
_PLANE_OF_SET = {
    "lea": "dominaria",
    "rav": "ravnica",
    "mh1": "blind-eternities",
    "dmr": "dominaria",
}


def _card(index: int, code: str) -> CardInput:
    oracle_id = f"00000000-0000-4000-8000-{index:012d}"
    first = printing(
        oracle_id=oracle_id,
        printing_id=f"{oracle_id}-p",
        name=f"Card {index}",
        set_code=code,
        released_at=SETS[code].released_at,
        collector_number=str(index),
    )
    detail = CardDetail(
        printing_id=first.id,
        oracle_id=oracle_id,
        layout="normal",
        colour_identity=_IDENTITIES[index % len(_IDENTITIES)],
        front=FaceDetail(f"Card {index}", "{1}", "Creature — Test", "Text."),
        back=None,
        meld_result_id=None,
    )
    return CardInput(
        oracle_id=oracle_id,
        plane_slug=_PLANE_OF_SET[code],
        first_printing=first,
        printings=[first],
        detail=detail,
    )


def _report_input(data_root: Path) -> ReportInput:
    codes = ["lea", "rav", "mh1", "dmr"]
    cards = [_card(i, codes[i % len(codes)]) for i in range(12)]
    dataset, stats = build_dataset(
        cards,
        SETS,
        APX,
        {},
        dataset_name="production",
        as_of=AS_OF,
        generated_at=f"{AS_OF}T00:00:00Z",
        scryfall_bulk_updated_at=BULK_UPDATED_AT,
    )
    data_dir = write_dataset(dataset, data_root)
    return ReportInput(
        dataset=dataset,
        stats=stats,
        data_dir=data_dir,
        as_of=AS_OF,
        bulk_updated_at=BULK_UPDATED_AT,
        bulk_uri=BULK_URI,
        total_printings=40,
        total_oracle_ids=20,
        printings_dropped=Counter({"4.3.4 promo": 9, "4.3.1 Appendix B universes_beyond": 4}),
        unreleased_sets=["trk"],
        cards_excluded=Counter({"4.4.1 no included printing": 6, "4.4.3 Universes Beyond": 2}),
        via_parent={"dmr": "lea"},
        via_override=["Card 3"],
        dropped_via_parent={"pza": "tmt"},
        findings=[
            Finding(
                question="Q4",
                title="security_stamp: triangle semantics (PRD 4.3.5)",
                verdict="confirmed — 4.3.5 is safe as a secondary guard",
                detail=["triangle printings: 4 across 1 sets"],
            ),
            Finding(
                question="Q10",
                title="Appendix B set codes marked “verify”",
                verdict="resolved with corrections — see below",
                detail=["confirmed: 1", "  lea “Limited Edition Alpha” (1993-08-05, expansion)"],
                action="The PRD itself still needs the same edit.",
            ),
        ],
        plane_changes=[("Card 7", "ravnica", "dominaria")],
        previous_run="0123456789abcdef",
    )


@pytest.fixture(scope="module")
def report_text(tmp_path_factory: pytest.TempPathFactory) -> str:
    return render(_report_input(tmp_path_factory.mktemp("data")))


def test_the_report_matches_its_committed_snapshot(report_text: str):
    if os.environ.get("UPDATE_REPORT_SNAPSHOT"):
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(report_text, encoding="utf-8")
        pytest.skip(f"rewrote {SNAPSHOT.name}; re-run without UPDATE_REPORT_SNAPSHOT")
    expected = SNAPSHOT.read_text(encoding="utf-8")
    if report_text != expected:
        diff = "".join(
            difflib.unified_diff(
                expected.splitlines(keepends=True),
                report_text.splitlines(keepends=True),
                fromfile="committed snapshot",
                tofile="this run",
            )
        )
        pytest.fail(
            "the run report changed. Read the diff; if it is intended, regenerate with "
            f"UPDATE_REPORT_SNAPSHOT=1.\n\n{diff}"
        )


def test_the_report_is_deterministic(report_text: str, tmp_path: Path):
    """PRD 4.9.1 covers the report too: it is committed alongside the data (8.8.3)."""
    assert render(_report_input(tmp_path)) == report_text


@pytest.mark.parametrize(
    "row",
    [
        "| 9.2.1 Unmapped sets |",
        "| 9.2.2 Blind Eternities share |",
        "| 9.2.3 Cards that changed plane |",
    ],
)
def test_every_prd_9_2_quality_gate_has_a_row(report_text: str, row: str):
    """PRD 9.2's three gates are read out of this table; none may quietly stop rendering."""
    assert row in report_text


def test_the_blind_eternities_share_is_the_number_the_gate_is_read_from(report_text: str):
    """9.2.2's baseline is a share of stars, and the report is where the board reads it.

    Three of the twelve cards have `mh1` as their first printing, which Appendix B routes to the
    Blind Eternities. Spelling the arithmetic out here means a change to how the share is computed
    fails with the number, not just as a snapshot diff.
    """
    assert "**25.00%** (3 of 12 cards)" in report_text
    assert "**Baseline: 25.00%.**" in report_text


def test_an_absent_section_says_so_rather_than_vanishing(tmp_path: Path):
    """Every optional section renders a "None" line, so a gap is visible in the diff."""
    data = _report_input(tmp_path)
    data.via_parent = {}
    data.via_override = []
    data.dropped_via_parent = {}
    data.unreleased_sets = []
    data.findings = []
    data.plane_changes = []
    data.previous_run = None
    text = render(data)
    assert "None: every first-printing set has its own Appendix B row." in text
    assert "None: every dropped set carries its own row." in text
    assert "First production run: nothing to compare against." in text
    assert "Not run." in text


def test_the_previous_run_is_the_latest_one_not_the_largest_hash(tmp_path: Path):
    """`load_previous_planes` picks by run date; content hashes carry no ordering."""
    data = _report_input(tmp_path)
    (only,) = [d for d in tmp_path.iterdir() if d.is_dir()]

    older = tmp_path / "ffffffffffffffff"
    older.mkdir()
    for name in ("manifest.json", "planes.json", "sets.bin"):
        (older / name).write_bytes((only / name).read_bytes())
    manifest = json.loads((older / "manifest.json").read_text(encoding="utf-8"))
    manifest["asOf"] = "2020-01-01"
    manifest["generatedAt"] = "2020-01-01T00:00:00Z"
    (older / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    found = load_previous_planes(tmp_path, exclude="")
    assert found is not None
    assert found[0] == only.name, "the lexicographically larger but older directory won"
    assert diff_planes(data.dataset, found[1]) == []
