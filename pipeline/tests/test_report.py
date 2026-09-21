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
from dataclasses import replace
from pathlib import Path

import pytest
from conftest import appendices, printing, scry_set, set_entry

from eternities.contract import write_dataset
from eternities.contract.enums import CONTRACT_VERSION
from eternities.pipeline.assemble import CardInput, build_dataset
from eternities.pipeline.records import CardDetail, FaceDetail
from eternities.pipeline.assemble import PlaneAssignmentStats
from eternities.pipeline.swatches import SwatchStats
from eternities.pipeline.report import (
    PreviousRun,
    ReportInput,
    diff_planes,
    load_previous_planes,
    manifest_chain,
    recorded_previous_run,
    render,
)
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


def _report_input(data_root: Path, codes: list[str] | None = None) -> ReportInput:
    codes = ["lea", "rav", "mh1", "dmr"] if codes is None else codes
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
        unreleased_by_set={"fdc": 316, "trk": 3},
        cards_excluded=Counter({"4.4.1 no included printing": 6, "4.4.3 Universes Beyond": 2}),
        via_parent={"dmr": "lea"},
        via_override=["Card 3 -> ravnica"],
        unused_overrides=["Card 99 (00000000-0000-4000-8000-000000000099) -> segovia"],
        dropped_via_parent={"pza": "tmt", "ttmt": "tmt"},
        parent_rule_only={"pza": 15},
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


def test_the_9_2_2_row_records_the_baseline_rather_than_classifying_the_share(
    report_text: str, tmp_path: Path
):
    """DEC-675. 9.2.2 is reported, not enforced, and 17.42% is the baseline the board accepted.

    The row used to append "inside"/"**outside** the 20-25% range PRD 9.2.2 expected", so every
    production run read as a standing defect: prd_v3.md 9.2.2 records 17.42% as the accepted
    baseline and derives the curation target from it, and calls the gap to the originally expected
    20-25% a better starting point than predicted.

    A second report whose share sits *below* the old band is what pins this. Asserting only that
    the fixture's own row is clean would not: the fixture is at 25.00%, so it took the "inside"
    branch, and restoring just the "**outside**" branch would survive. With either branch back,
    these two rows differ.
    """

    def gate_row(text: str) -> str:
        return next(line for line in text.splitlines() if line.startswith("| 9.2.2 "))

    sparse = render(_report_input(tmp_path, codes=["lea", "rav", "lea", "dmr", "mh1"]))
    dense_row, sparse_row = gate_row(report_text), gate_row(sparse)

    assert "**25.00%** (3 of 12 cards)" in dense_row
    assert "**16.67%** (2 of 12 cards)" in sparse_row
    assert dense_row.split("cards) — ", 1)[1] == sparse_row.split("cards) — ", 1)[1]
    assert "17.42%" in dense_row
    assert "20-25%" not in dense_row


def test_a_reconstructed_bulk_uri_says_so_on_the_row(report_text: str, tmp_path: Path):
    """The "Scryfall bulk file" row promises an upstream file name.

    When the pinned cache entry predates the URI sidecar there is no upstream name to print, and
    the fallback puts a local path in its place — whose last segment is the *cache* filename, which
    differs from the upstream one only in punctuation. Unmarked, the row reads as if it meant what
    it says. Marked, it stays a run someone can reproduce and a claim someone can check.
    """
    assert f"`{BULK_URI.rsplit('/', 1)[-1]}`" in report_text
    assert "cache filename" not in report_text

    data = _report_input(tmp_path)
    data.bulk_uri = str(tmp_path / "default_cards-20260904T0905323080000.jsonl.gz")
    data.bulk_uri_reconstructed = True
    text = render(data)

    assert "`default_cards-20260904T0905323080000.jsonl.gz`" in text
    assert "cache filename" in text
    assert "predates the URI sidecar" in text


def test_an_absent_section_says_so_rather_than_vanishing(tmp_path: Path):
    """Every optional section renders a "None" line, so a gap is visible in the diff."""
    data = _report_input(tmp_path)
    data.via_parent = {}
    data.via_override = []
    data.dropped_via_parent = {}
    data.parent_rule_only = {}
    data.unreleased_by_set = {}
    data.findings = []
    data.plane_changes = []
    data.previous_run = None
    text = render(data)
    assert "None: every first-printing set has its own Appendix B row." in text
    assert "None: every dropped set carries its own row." in text
    assert "First production run: nothing to compare against." in text
    assert "Not run." in text


def test_the_parent_drop_table_says_how_much_of_it_is_load_bearing(report_text: str):
    """PRD 4.3.1's inherited-drop list is long and almost entirely over-determined.

    Without this line the table reads as though the parent walk were doing every row's work. The
    number is measured per run rather than asserted in prose, so it cannot go stale the next time
    a Universes Beyond product ships a new child set.
    """
    assert "Only 1 of these 2 sets is load-bearing: `pza` (15 printings" in report_text


def test_a_fully_over_determined_parent_drop_table_says_so(tmp_path: Path):
    """The other branch: every dropped child is caught by another 4.3 rule too."""
    data = _report_input(tmp_path)
    data.parent_rule_only = {}
    assert "None of these 2 sets needs the walk to be dropped" in render(data)


def test_the_manifest_records_the_run_the_plane_diff_was_taken_against(tmp_path: Path):
    """PRD 8.8.3 deletes the superseded directory in the same commit, and the report names it in
    prose only, so without this the committed report cannot be reproduced from the committed tree.

    Omitted rather than written as `null` when there is no predecessor, which is what keeps every
    already-committed manifest — the fixtures and the test vector — byte-identical.
    """
    data = _report_input(tmp_path)
    plain = json.loads((data.data_dir / "manifest.json").read_text(encoding="utf-8"))
    assert "previousRun" not in plain, "no predecessor means no key, not a null"

    # Same dataset, so the same content hash and the same directory: the field is provenance about
    # the run, and it is deliberately outside `dataHash`, which covers the artefacts only.
    with_previous = write_dataset(data.dataset, tmp_path, previous_runs=["0123456789abcdef"])
    assert with_previous == data.data_dir
    manifest = json.loads((with_previous / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["previousRun"] == "0123456789abcdef"
    assert manifest["dataHash"] == plain["dataHash"]


def test_a_rerun_in_a_pruned_tree_keeps_the_predecessor_and_stays_byte_identical(tmp_path: Path):
    """The case 8.8.3 creates and 4.9.1 has to survive.

    The first build supersedes `0123456789abcdef` and deletes it, so the second build finds only
    itself on disk. Naming itself would be wrong; dropping the key would make the second manifest
    differ from the first, which is determinism lost to a field added for provenance. The
    second candidate — what the run already recorded — is the answer that is both true and stable.
    """
    data = _report_input(tmp_path)
    first = write_dataset(data.dataset, tmp_path, previous_runs=["0123456789abcdef"])
    first_bytes = (first / "manifest.json").read_bytes()

    carried = recorded_previous_run(first)
    assert carried == "0123456789abcdef"

    # What `run.build` passes on the re-run: the only production directory on disk is this one.
    again = write_dataset(data.dataset, tmp_path, previous_runs=[first.name, carried])

    assert again == first
    assert (again / "manifest.json").read_bytes() == first_bytes


def test_a_run_with_no_surviving_candidate_omits_the_key(tmp_path: Path):
    data = _report_input(tmp_path)
    written = write_dataset(data.dataset, tmp_path, previous_runs=[data.data_dir.name, None])
    manifest = json.loads((written / "manifest.json").read_text(encoding="utf-8"))
    assert "previousRun" not in manifest, "a run may not name itself as its own predecessor"


def test_a_rebuilt_run_does_not_claim_to_be_the_first(tmp_path: Path):
    """PRD 9.2.3 read off a pruned tree used to say "no previous production run", which is a false
    statement about the data rather than a missing detail. The manifest knows better."""
    data = _report_input(tmp_path)
    data.previous_run = "0123456789abcdef"
    data.previous_run_pruned = True
    data.plane_changes = []

    text = render(data)

    assert "no previous production run to compare against" not in text
    assert "First production run" not in text
    assert "not computed — this run follows `0123456789abcdef`" in text


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

    found = load_previous_planes(tmp_path)
    assert found is not None
    assert found.name == only.name, "the lexicographically larger but older directory won"
    assert found.planes is not None
    assert diff_planes(data.dataset, found.planes) == []


def _rewrite_manifest(directory: Path, **fields: object) -> None:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    manifest.update(fields)
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_a_predecessor_under_an_older_contract_reads_as_unreadable_not_absent(tmp_path: Path):
    """DEC-647 B1. The version skip used to `continue`, so the loader returned `None` — the same
    answer as "no production run has ever been built". That dropped `previousRun` from the manifest
    and put "First production run" into a report for a run that was at least the third.

    The predecessor is still the predecessor. Only the diff is lost.
    """
    _report_input(tmp_path)  # writes the one production directory this reads back
    (only,) = [d for d in tmp_path.iterdir() if d.is_dir()]
    _rewrite_manifest(only, contractVersion=CONTRACT_VERSION - 1)
    # The v1 layout is not merely different, it is undecodable by this build: prove the loader
    # never reaches for the bytes by removing the file it would have had to read.
    (only / "sets.bin").unlink()

    found = load_previous_planes(tmp_path)

    assert found is not None, "an unreadable predecessor is not an absent one"
    assert found.name == only.name
    assert found.planes is None
    assert found.contract_version == str(CONTRACT_VERSION - 1)


def test_the_manifest_chain_names_a_predecessor_it_cannot_decode():
    """DEC-649's mutation, at the line it mutated.

    `load_previous_planes` returning `planes = None` says "the predecessor is there, this build
    just cannot read it". Reading that as "no predecessor" is DEC-647 B1 — a dropped `previousRun`
    and "First production run" in the report of a run that was at least the third — and it is one
    `and previous.planes is not None` away from being true again.
    """
    unreadable = PreviousRun("0123456789abcdef", planes=None, contract_version="1")

    assert manifest_chain(unreadable, None) == ["0123456789abcdef", None], (
        "the name goes in the chain whether or not this build can decode the artefacts"
    )


def test_the_manifest_chain_prefers_the_predecessor_on_disk_over_the_carried_one():
    """Order is the contract with `encode_artefacts`, which takes the first surviving candidate.

    The run on disk is the one this build actually followed; the carried name is a fallback for
    the pruned re-run, where the only directory present is this run's own and is rejected there.
    """
    found = PreviousRun("aaaaaaaaaaaaaaaa", planes={"card-1": "dominaria"})

    assert manifest_chain(found, "bbbbbbbbbbbbbbbb") == ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]


def test_the_manifest_chain_falls_back_to_the_carried_name_and_then_to_nothing():
    assert manifest_chain(None, "0123456789abcdef") == [None, "0123456789abcdef"]
    assert manifest_chain(None, None) == [None, None], "no candidate, and the encoder omits the key"


def test_a_same_version_predecessor_is_still_found_and_diffed(tmp_path: Path):
    """The other half of DEC-647 B2: the guard must not swallow the runs it is not about.

    Without this, a `contractVersion` written as a string — or the key renamed — would skip every
    predecessor forever, and nothing would fail.
    """
    data = _report_input(tmp_path)
    (only,) = [d for d in tmp_path.iterdir() if d.is_dir()]
    assert (
        json.loads((only / "manifest.json").read_text(encoding="utf-8"))["contractVersion"]
        == CONTRACT_VERSION
    )

    found = load_previous_planes(tmp_path)

    assert found is not None
    assert found.contract_version is None, "the current contract is not a mismatch"
    assert found.planes is not None
    assert diff_planes(data.dataset, found.planes) == []


def test_a_predecessor_under_an_older_contract_does_not_claim_to_be_the_first(tmp_path: Path):
    """The report half of DEC-647 B1: 9.2.3 and §4.9.2 both have to say what actually happened."""
    data = _report_input(tmp_path)
    data.previous_run = "fe74a34ff803574b"
    data.previous_run_contract_version = "1"
    data.plane_changes = []

    text = render(data)

    assert "no previous production run to compare against" not in text
    assert "First production run" not in text
    assert "8.8.3 removed" not in text, "the artefacts are present; this is not the pruned case"
    assert "`contractVersion` 1" in text
    assert "not computed — this run follows `fe74a34ff803574b`" in text


# --- review findings D2 and D6: the two silent normalisations, made visible --------------------


def test_the_assignment_section_reports_exact_displaced_bare(report_text: str):
    """Worlds spec §2.6 item 5, which replaces v2's radius-headroom table.

    That table watched PRD 5.3.2's ``log N`` clamp for the refresh that would reach it. §1.3's
    ``0.126 * sqrt(N)`` has no clamp — constant area per card is the invariant — so the row that
    matters now is whether any card was displaced.
    """
    assert "## Surface assignment (worlds spec §1.3)" in report_text
    assert "exact, 0 displaced, 0 bare" in report_text
    assert "rowCells" in report_text


def test_a_displaced_card_is_named_in_the_assignment_table(tmp_path: Path):
    """The failure the section exists for. The prototype left Dominaria at 200 displaced and
    Rabiah at 3 bare of 75; §1.3 makes that a build failure, and this is what it reads like.

    Driven through ``AssemblyStats`` rather than by building a broken grid, because what is under
    test is the report's reading of the numbers — ``test_pipeline_invariants`` pins the grid.
    """
    data = _report_input(tmp_path)
    data.stats = replace(
        data.stats,
        assignment=[
            PlaneAssignmentStats("dominaria", 6266, 6066, 200, 0, 81, 6266, 0.178),
            PlaneAssignmentStats("rabiah", 75, 72, 0, 3, 9, 78, 0.269),
        ],
    )

    text = render(data)

    assert "| `dominaria` | 6,266 | 6,066 | 200 | 0 | 81 | 6,266 | 17.8% |" in text
    assert "| `rabiah` | 75 | 72 | 0 | 3 | 9 | 78 x | 26.9% |" in text
    assert "6,138 exact, 200 displaced, 3 bare" in text
    assert "Closed form differs from the card count on 1 of 2 worlds" in text


def test_the_swatch_section_reports_the_fetch(tmp_path: Path):
    """Worlds spec §2.2's report line: cache hits, fetches and failures."""
    data = _report_input(tmp_path)
    data.swatches = SwatchStats(
        wanted=28_603,
        cache_hits=28_600,
        fetched=3,
        failures=[("abc-def", "HTTP 404")],
        bytes_downloaded=240_000,
        elapsed_s=90.0,
    )

    text = render(data)

    assert "## Swatch fetch (worlds spec §2.2)" in text
    assert "28,603 cards wanted a swatch from Scryfall `art_crop`" in text
    assert "28,600 already cached, 3 fetched, 1 failed" in text
    assert "| `abc-def` | HTTP 404 |" in text
    assert "A failed swatch is a black cell" in text


def test_the_brightness_cap_section_reports_the_cap_and_who_is_above_it(tmp_path: Path):
    """Finding D6. The cap is applied before encoding, so the report is where it is reviewable."""
    data = _report_input(tmp_path)
    data.stats = replace(
        data.stats,
        brightness_caps=[("dominaria", 12, 84, 37), ("ravnica", 9, 9, 1)],
    )

    text = render(data)

    assert "## Brightness cap per plane (PRD 5.4.10)" in text
    assert "The cap is each plane's 98% percentile of printing count." in text
    assert "1 of 2 non-empty planes" in text, "`ravnica` has nothing above its cap"
    assert "| `dominaria` | 12 | 84 | 37 |" in text
    assert "| `ravnica` | 9 | 9 |" not in text, "a plane with nothing above its cap adds no row"
    assert "re-running the pipeline" in text


def test_an_override_that_matched_nothing_is_named_in_the_report(report_text: str):
    """Finding D1's other half: a curated line doing nothing must not be invisible."""
    assert "**1 override record matched no first printing.**" in report_text
    assert "- Card 99 (00000000-0000-4000-8000-000000000099) -> segovia" in report_text
    assert "Card 3 -> ravnica" in report_text, "the applied override still reads as applied"
