"""The lore stage inside the real orchestrator, and ``distribution: true`` in the manifest.

`test_lore_stage` runs the stage and `test_lore_cli` the parser. What neither shows is the join:
that `run.build` runs the stage on the dataset it has just assembled, before it writes anything,
and that the flag which passed the check is the flag the manifest records. `test_run_build` exists
because a join like that broke once with every unit test green (DEC-649), so this module runs
`build` end to end, over a bulk file of three cards on Dominaria and one hero entry.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import lore_kit as kit

from eternities.lore.digest import digest_of_directory
from eternities.lore.stage import LoreInputs, LoreStageError
from eternities.pipeline import run

AS_OF = "2026-09-04"
BULK_UPDATED_AT = "2026-09-04T09:05:32.308+00:00"
STAMP = "20260904T0905323080000"

# Three real Appendix B rows that map to Dominaria, so the appendices are the shipped ones and the
# plane has the three sets an era table needs under the ordinary rules.
SETS = [
    {"code": "lea", "name": "Limited Edition Alpha", "released_at": "1993-08-05"},
    {"code": "leb", "name": "Limited Edition Beta", "released_at": "1993-10-04"},
    {"code": "atq", "name": "Antiquities", "released_at": "1994-03-04"},
]


def _oracle(index: int) -> str:
    return f"00000000-0000-4000-8000-{index:012d}"


def _card(index: int, row: dict[str, str]) -> dict[str, object]:
    return {
        "id": f"11111111-0000-4000-8000-{index:012d}",
        "oracle_id": _oracle(index),
        "name": f"Card {index}",
        "set": row["code"],
        "released_at": row["released_at"],
        "rarity": "common",
        "layout": "normal",
        "lang": "en",
        "collector_number": str(index),
        "color_identity": ["G"],
        "mana_cost": "{1}{G}",
        "type_line": "Creature — Test",
        "oracle_text": "Text.",
        "image_uris": {
            "normal": f"https://cards.scryfall.io/normal/front/a/b/{index}.jpg?1700000000"
        },
    }


CARDS = [_card(index, row) for index, row in enumerate(SETS, start=1)]


def _quiet(*_: Any) -> None:
    """`build` narrates every stage; the tests read the artefacts, not the log."""


def _build(tmp_path: Path, **options: Any) -> run.BuildResult:
    cache = tmp_path / "cache"
    cache.mkdir(exist_ok=True)
    (cache / f"default_cards-{STAMP}.json").write_text(json.dumps(CARDS), encoding="utf-8")
    sets = [{**row, "set_type": "core", "digital": False} for row in SETS]
    (cache / f"sets-{STAMP}.json").write_text(json.dumps({"data": sets}), encoding="utf-8")
    swatches = tmp_path / "swatches.jsonl"
    swatches.write_text(
        "".join(
            json.dumps({"id": str(card["id"]), "ts": 1700000000, "s": [n, n, n, n]}) + "\n"
            for n, card in enumerate(CARDS)
        ),
        encoding="utf-8",
    )
    return run.build(
        as_of=AS_OF,
        data_root=tmp_path / "data",
        reports_dir=tmp_path / "reports",
        cache_dir=cache,
        roster_diff=False,
        bulk_updated_at=BULK_UPDATED_AT,
        swatch_cache_path=swatches,
        lore=LoreInputs(root=tmp_path / "lore", example_dir=None, hero_entries=("dominaria",)),
        log=_quiet,
        **options,
    )


def _tables(tmp_path: Path, *, accepted: str | None = None) -> Path:
    """Dominaria's tables for the three-card dataset: four regions, three eras, valid."""
    eras = kit.eras()
    for row, code, index in zip(eras["eras"], ["lea", "leb", "atq"], [1, 2, 3], strict=True):
        row["sets"] = [code]
        row["paragraphs"] = [
            [kit.sentence("The first people came by sea.", f"card:{_oracle(index)}")]
        ]
    eras["eras"][0]["headline"] = ["Card 1"]
    if accepted is not None:
        eras["accepted"] = {
            "by": "owner",
            "on": "2026-10-20",
            "issue": "DEC-1002",
            "digest": accepted,
        }
    return kit.write(tmp_path / "lore", eras_table=eras)


def _manifest(directory: Path) -> dict[str, Any]:
    return json.loads((directory / "manifest.json").read_text(encoding="utf-8"))


def test_a_development_build_validates_the_tables_and_reports_their_status(tmp_path: Path):
    """No flag: the tables validate against the run's own dataset, the status is reported, and
    the manifest carries no `distribution` key, so every committed manifest is unchanged."""
    directory = _tables(tmp_path)
    digest = digest_of_directory(directory)

    result = _build(tmp_path)

    assert "distribution" not in _manifest(result.data_dir)
    assert "## Lore tables (PRD v4 4.16)" in result.report_text
    assert f"Checked against dataset `{AS_OF} (bulk {BULK_UPDATED_AT})`" in result.report_text
    assert f"| `dominaria` | lore | **absent** | `{digest}` | 3: `lea`, `leb`, `atq` |" in (
        result.report_text
    )
    assert "Not requested. 0 of 1 hero entries are accepted" in result.report_text


def test_a_distribution_build_of_accepted_tables_records_it_in_the_manifest(tmp_path: Path):
    """4.16.5: the check passed at pack build, and the manifest says `distribution: true`."""
    digest = digest_of_directory(_tables(tmp_path))
    _tables(tmp_path, accepted=digest)

    result = _build(tmp_path, distribution=True)

    assert _manifest(result.data_dir)["distribution"] is True
    assert f"| `dominaria` | lore | **accepted** | `{digest}` |" in result.report_text
    assert "The manifest records `distribution: true`." in result.report_text


def test_the_flag_does_not_move_the_data_hash(tmp_path: Path):
    """The manifest is outside the hash (data contract section 1), so the same data is the same
    directory with the flag and without it."""
    digest = digest_of_directory(_tables(tmp_path))
    _tables(tmp_path, accepted=digest)

    development = _build(tmp_path)
    assert "distribution" not in _manifest(development.data_dir)
    distribution = _build(tmp_path, distribution=True)

    assert distribution.data_dir == development.data_dir
    assert _manifest(distribution.data_dir)["distribution"] is True


@pytest.mark.parametrize(
    ("accepted", "says"),
    [
        (None, "carries no `accepted` record"),
        ("sha256:" + "0" * 64, "is stale"),
    ],
    ids=["absent", "stale"],
)
def test_a_distribution_build_fails_naming_the_entry_and_writes_nothing(
    tmp_path: Path, accepted: str | None, says: str
):
    """4.16.5: "otherwise the build fails naming the entry". The stage runs before the write, so
    a refused build leaves no data directory and no report."""
    _tables(tmp_path, accepted=accepted)

    with pytest.raises(LoreStageError) as raised:
        _build(tmp_path, distribution=True)

    assert "--distribution: 1 hero entry is not accepted" in str(raised.value)
    assert "dominaria: " in str(raised.value) and says in str(raised.value)
    assert not (tmp_path / "data").exists()
    assert not (tmp_path / "reports").exists()

    # The same tables build in development, whatever their status.
    assert "## Lore tables" in _build(tmp_path).report_text


def test_a_distribution_build_fails_on_a_hero_entry_with_no_directory(tmp_path: Path):
    with pytest.raises(LoreStageError, match="dominaria: no lore directory"):
        _build(tmp_path, distribution=True)

    # In development the entry is laid out by the kit law and listed (4.16.5).
    report = _build(tmp_path).report_text
    assert "### Hero entries without tables (1)\n\n`dominaria`" in report


def test_tables_that_break_a_rule_fail_a_development_build_and_write_nothing(tmp_path: Path):
    """The headline card is first printed in `leb`; the era's set is `lea`. Resolved against the
    dataset of this run, which is what makes this the join and not the unit."""
    directory = _tables(tmp_path)
    eras = json.loads((directory / "eras.json").read_text(encoding="utf-8"))
    eras["eras"][0]["headline"] = ["Card 2"]
    (directory / "eras.json").write_text(json.dumps(eras), encoding="utf-8")

    with pytest.raises(LoreStageError) as raised:
        _build(tmp_path)

    assert 'eras.json: eras[0] "dawn": headline[0]' in str(raised.value)
    assert "first printed in 'leb' on dominaria" in str(raised.value)
    assert not (tmp_path / "data").exists()
