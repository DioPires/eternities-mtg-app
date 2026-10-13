"""``eternities lore`` and ``eternities build --distribution``, through the argument parser.

Three entry points for three readers. ``lore digest`` prints the digest the owner's acceptance
names (PRD v4 F.2). ``lore validate`` is the drafter's: one directory, with ``--fixture`` for a
synthetic fixture (5.4.14). ``lore check`` runs a build's lore stage on the committed pack, so CI
and a reviewer need no Scryfall download.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
import lore_kit as kit

from eternities import cli
from eternities.contract import write_dataset
from eternities.fixtures import SMALL, build
from eternities.lore import example
from eternities.lore.digest import FILES
from eternities.lore.problems import Rule
from eternities.lore.spotlight import SIDECAR_NAME
from eternities.lore.stage import LORE_ROOT, LoreStageError

EXAMPLE = str(example.EXAMPLE_DIR / "dominaria")
EXAMPLE_DIGEST = "sha256:9c3e8af62db72675c17a2e5495109d6e870b658839fedc28775730306308d87a"


# --- lore digest ----------------------------------------------------------------------------


def test_lore_digest_prints_the_digest_and_nothing_else(capsys: pytest.CaptureFixture[str]):
    """So the owner's acceptance can name it: one line, ready to paste."""
    assert cli.main(["lore", "digest", EXAMPLE]) == 0

    assert capsys.readouterr().out == EXAMPLE_DIGEST + "\n"


def test_lore_digest_needs_no_dataset_and_does_not_judge_validity(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """A digest names bytes. These tables break a rule (a weight of 100) and still have one."""
    regions = kit.regions()
    regions["regions"][0]["weight"] = 100
    directory = kit.write(tmp_path, regions_table=regions)

    assert cli.main(["lore", "digest", str(directory)]) == 0
    assert capsys.readouterr().out.startswith("sha256:")


def test_lore_digest_refuses_a_file_outside_f0(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    (directory / "regions.json").write_text(
        text.replace('"weight": 1000', '"weight": 1000.0', 1), encoding="utf-8"
    )

    assert cli.main(["lore", "digest", str(directory)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "lore digest failed" in captured.err and "regions[0].weight" in captured.err


# --- lore validate --------------------------------------------------------------------------


def test_lore_validate_passes_the_schema_example_with_no_flag(capsys: pytest.CaptureFixture[str]):
    assert cli.main(["lore", "validate", EXAMPLE]) == 0

    out = capsys.readouterr().out
    assert "valid under the ordinary rules of 4.16.2, against dataset" in out
    assert "set codes mapped: 37: lea, leb, atq" in out
    assert f"digest: {EXAMPLE_DIGEST}" in out
    assert "acceptance status: absent" in out


def test_lore_validate_fails_naming_the_file_the_row_and_the_field(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """The example with Benalia's anchor moved to 100 from Terisiare's, at [-600, 300]."""
    directory = tmp_path / "dominaria"
    directory.mkdir()
    for name in ("regions.json", "eras.json", "keywords.json"):
        document = json.loads((example.EXAMPLE_DIR / "dominaria" / name).read_text("utf-8"))
        if name == "regions.json":
            assert document["regions"][1]["id"] == "benalia"
            document["regions"][1]["anchor"] = [-600, 400]
        (directory / name).write_text(json.dumps(document), encoding="utf-8")

    assert cli.main(["lore", "validate", str(directory)]) == 1

    err = capsys.readouterr().err
    assert "lore validate failed" in err
    assert 'regions.json: regions[1] "benalia": anchor: [-600, 400]' in err
    assert 'of regions[0] "terisiare"; two anchors are at least 150 apart' in err


def test_lore_validate_names_a_forbidden_number_by_the_row_and_its_id(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """The reader finds the number before any rule reads its row, and the line still names the row
    as every other failure of that row does. The example with Terisiare's weight as ``1000.0``."""
    directory = tmp_path / "dominaria"
    directory.mkdir()
    for name in ("regions.json", "eras.json", "keywords.json"):
        document = json.loads((example.EXAMPLE_DIR / "dominaria" / name).read_text("utf-8"))
        if name == "regions.json":
            assert document["regions"][0]["id"] == "terisiare"
            document["regions"][0]["weight"] = 1000.0
        (directory / name).write_text(json.dumps(document), encoding="utf-8")

    assert cli.main(["lore", "validate", str(directory)]) == 1

    err = capsys.readouterr().err
    assert "breaks 1 lore table rule" in err
    assert 'regions.json: regions[0] "terisiare": weight: 1000.0 is not an integer' in err


def _pack(tmp_path: Path) -> Path:
    """A pack on disk for `--data`: the small fixture dataset."""
    return write_dataset(build(SMALL), tmp_path / "data")


def _one_region_one_era(root: Path, pack: Path) -> Path:
    """A synthetic fixture (5.4.14): a hero plane with one region and one era, on ``pack``."""
    planes = json.loads((pack / "planes.json").read_text(encoding="utf-8"))["planes"]
    plane = next(row for row in planes if row["slug"] == "dominaria")
    shard = json.loads((pack / "planes" / "dominaria.0.json").read_text(encoding="utf-8"))
    source = f"card:{shard['cards'][0]['u']}"
    regions = {"plane": "dominaria", "regions": [kit.region("only", [0, 0])]}
    eras: dict[str, Any] = {
        "plane": "dominaria",
        "kind": "lore",
        "eras": [kit.era("all", "only", [row["code"] for row in plane["sets"]])],
    }
    eras["eras"][0]["paragraphs"] = [[kit.sentence("One era holds every set.", source)]]
    return kit.write(
        root,
        regions_table=regions,
        eras_table=eras,
        keywords_table={"plane": "dominaria", "keywords": []},
    )


def test_fixture_relaxes_the_row_minimums(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    """5.4.14: "a synthetic hero plane with one region and one era"."""
    pack = _pack(tmp_path)
    directory = _one_region_one_era(tmp_path, pack)
    arguments = ["lore", "validate", str(directory), "--data", str(pack)]

    assert cli.main(arguments) == 1
    err = capsys.readouterr().err
    assert "regions.json: regions: has 1 rows; the table takes 4 to 12" in err
    assert "eras.json: eras: has 1 rows; the table takes 3 to 16" in err
    assert "breaks 2 lore table rules" in err

    assert cli.main([*arguments, "--fixture"]) == 0
    assert "the row minimums relaxed (--fixture)" in capsys.readouterr().out


def test_fixture_relaxes_the_accepted_requirement(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """5.4.14: "... and the ``accepted`` requirement". Without ``--fixture`` a valid table set
    with no record fails ``--distribution``; with it, no record is asked for."""
    pack = _pack(tmp_path)
    directory = _one_region_one_era(tmp_path, pack)
    arguments = ["lore", "validate", str(directory), "--data", str(pack), "--distribution"]

    assert cli.main([*arguments, "--fixture"]) == 0
    assert "a fixture needs no `accepted` record" in capsys.readouterr().out


def test_an_integer_too_long_for_python_fails_naming_the_file_and_the_field(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """``int`` refuses a string of more than 4,300 digits. Both commands that read a table answer
    with the file and the field (4.16.2, F.0), not with the traceback of that refusal."""
    pack = _pack(tmp_path)
    directory = _one_region_one_era(tmp_path, pack)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    assert text.count('"weight": 1000') == 1
    (directory / "regions.json").write_text(
        text.replace('"weight": 1000', '"weight": ' + "7" * 5000), encoding="utf-8"
    )
    says = "weight: an integer of more than 4300 digits is too long to read"

    assert cli.main(["lore", "validate", str(directory), "--data", str(pack), "--fixture"]) == 1
    err = capsys.readouterr().err
    assert "breaks 1 lore table rule" in err
    assert "dominaria/regions.json: regions[0]" in err
    assert f": {says}" in err
    assert "7" * 50 not in err

    assert cli.main(["lore", "digest", str(directory)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "lore digest failed" in captured.err
    assert f"dominaria/regions.json: regions[0].{says}" in captured.err


def _committed() -> dict[str, Path]:
    """The schema example's three tables and Dominaria's sidecar, as committed."""
    files = {name: example.EXAMPLE_DIR / "dominaria" / name for name in FILES}
    files[SIDECAR_NAME] = LORE_ROOT / "dominaria" / SIDECAR_NAME
    return files


def _example_with(root: Path, file: str, path: tuple[kit.Step, ...], value: Any) -> Path:
    """A copy of the example and the sidecar, valid together, with one member of ``file`` set."""
    directory = root / "dominaria"
    directory.mkdir()
    for name, source in _committed().items():
        document = json.loads(source.read_text("utf-8"))
        if name == file:
            kit.edit(document, path, value)
        (directory / name).write_text(json.dumps(document), encoding="utf-8")
    return directory


def test_lore_validate_answers_a_coordinate_too_long_to_square_with_the_rule_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """The example with Terisiare's first coordinate as 2,151 nines. Python does not print the
    square of that, and the command still answers with the row and the field (4.16.2). These two
    lines are all it prints: an exception would end the test at the call, and print a traceback."""
    nines = "9" * 2151
    directory = _example_with(tmp_path, "regions.json", ("regions", 0, "anchor", 0), int(nines))
    shown = cli._display(directory.resolve())

    assert cli.main(["lore", "validate", str(directory)]) == 1

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == (
        f"lore validate failed — {shown} breaks 1 lore table rule:\n"
        f'  {shown}/regions.json: regions[0] "terisiare": anchor: [{nines}, 300] lies outside the '
        "unit disc: a coordinate is an integer in thousandths in [-1000, 1000] (4.16.2)\n"
    )


# Every field of the three tables and the sidecar that holds an integer: its file, the path to the
# first row's, and how a failure there is named.
_INTEGER_FIELDS: list[tuple[str, tuple[kit.Step, ...], str]] = [
    ("regions.json", ("regions", 0, "anchor", 0), 'regions.json: regions[0] "terisiare": anchor: '),
    ("regions.json", ("regions", 0, "anchor", 1), 'regions.json: regions[0] "terisiare": anchor: '),
    ("regions.json", ("regions", 0, "weight"), 'regions.json: regions[0] "terisiare": weight: '),
    (SIDECAR_NAME, ("count",), "spotlight.json: count: "),
]

LONGEST = "9" * 4300
"""The longest integer the reader takes, at Python's default limit (``strict_json``)."""


def _integer_paths(value: Any, path: tuple[kit.Step, ...] = ()) -> set[tuple[kit.Step, ...]]:
    """Where a parsed file holds an integer, with every row of a table read as its first row."""
    if isinstance(value, bool):
        return set()
    if isinstance(value, int):
        return {path}
    members: list[tuple[kit.Step, Any]] = []
    if isinstance(value, dict):
        members = list(cast("dict[str, Any]", value).items())
    elif isinstance(value, list):
        # The array under a top-level field is a table. An anchor's two coordinates are two fields.
        table = len(path) == 1
        rows = cast("list[Any]", value)
        members = [(0 if table else position, row) for position, row in enumerate(rows)]
    return {found for step, member in members for found in _integer_paths(member, (*path, step))}


def test_the_integer_fields_are_every_one_the_committed_files_hold():
    """A field that F.0 or the sidecar gains fails here until the test below reads it too."""
    held = {
        (name, path)
        for name, source in _committed().items()
        for path in _integer_paths(json.loads(source.read_text("utf-8")))
    }

    assert held == {(file, path) for file, path, _ in _INTEGER_FIELDS}


@pytest.mark.parametrize(
    "spelling", [LONGEST, "-" + LONGEST], ids=["4300 nines", "a minus sign and 4300 nines"]
)
@pytest.mark.parametrize(
    ("file", "path", "named"),
    _INTEGER_FIELDS,
    ids=["anchor[0]", "anchor[1]", "weight", "the sidecar's count"],
)
def test_the_longest_integer_in_an_integer_field_fails_its_rule_and_has_a_digest(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    file: str,
    path: tuple[kit.Step, ...],
    named: str,
    spelling: str,
):
    """A message may print a number from a file. It prints no arithmetic on one that Python could
    refuse to convert, so ``lore validate`` answers with one line that names the field. ``lore
    digest`` does not judge validity, and prints a digest."""
    directory = _example_with(tmp_path, file, path, int(spelling))

    assert cli.main(["lore", "validate", str(directory)]) == 1
    failed, line = capsys.readouterr().err.splitlines()
    assert "breaks 1 lore table rule" in failed
    assert named in line

    assert cli.main(["lore", "digest", str(directory)]) == 0
    assert capsys.readouterr().out.startswith("sha256:")


def test_validate_distribution_fails_on_an_absent_or_stale_record(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
):
    """The owner's check on one entry: status accepted, or the command fails saying why."""
    assert cli.main(["lore", "validate", EXAMPLE, "--distribution"]) == 1
    assert "--distribution: " in capsys.readouterr().err

    directory = tmp_path / "dominaria"
    directory.mkdir()
    for name in ("regions.json", "keywords.json"):
        (directory / name).write_bytes((example.EXAMPLE_DIR / "dominaria" / name).read_bytes())
    eras = json.loads((example.EXAMPLE_DIR / "dominaria" / "eras.json").read_text("utf-8"))
    record = {"by": "owner", "on": "2026-10-20", "issue": "DEC-1002", "digest": EXAMPLE_DIGEST}
    eras["accepted"] = record
    (directory / "eras.json").write_text(json.dumps(eras, ensure_ascii=False), encoding="utf-8")

    assert cli.main(["lore", "validate", str(directory), "--distribution"]) == 0
    assert "acceptance status: accepted" in capsys.readouterr().out

    eras["accepted"] = {**record, "digest": "sha256:" + "f" * 64}
    (directory / "eras.json").write_text(json.dumps(eras, ensure_ascii=False), encoding="utf-8")
    assert cli.main(["lore", "validate", str(directory)]) == 0, "stale is valid in development"
    assert "acceptance status: stale" in capsys.readouterr().out
    assert cli.main(["lore", "validate", str(directory), "--distribution"]) == 1
    assert "is stale" in capsys.readouterr().err


# What `--fixture` must not relax. Each case breaks one rule on a table set that is otherwise a
# valid fixture: its name, the table it edits, the edits, and the rule that must still fail.
_NINE_MORE_REGIONS = [kit.region(f"extra-{n}", [-900 + 200 * n, -400]) for n in range(9)]
_STILL_ENFORCED: list[tuple[str, str, list[kit.Edit], Rule]] = [
    (
        "an anchor outside the unit disc",
        "regions",
        [(("regions", 0, "anchor"), [900, 900])],
        Rule.ANCHOR_OUTSIDE_DISC,
    ),
    (
        "anchors too close",
        "regions",
        [(("regions", 1, "anchor"), [100, 500])],
        Rule.ANCHORS_TOO_CLOSE,
    ),
    ("a fourth kit", "regions", [(("regions", 3, "kit"), "forest")], Rule.FOURTH_KIT),
    ("a weight out of range", "regions", [(("regions", 0, "weight"), 2001)], Rule.WEIGHT),
    (
        "an unmapped set",
        "eras",
        [(("eras", 1, "sets"), ["bbb"]), (("eras", 2, "sets"), ["ccc"])],
        Rule.SET_UNMAPPED,
    ),
    ("a set in two eras", "eras", [(("eras", 0, "sets"), ["aaa", "ddd"])], Rule.SET_IN_TWO_ERAS),
    (
        "a sentence without a source",
        "eras",
        [(("eras", 0, "paragraphs", 0, 0, "source"), kit.DELETE)],
        Rule.SENTENCE_WITHOUT_SOURCE,
    ),
    (
        "a source off the allowlist",
        "regions",
        [(("regions", 0, "sentence", "source"), "https://example.org/x")],
        Rule.SOURCE_OFF_ALLOWLIST,
    ),
    (
        "a card id not in the dataset",
        "eras",
        [(("eras", 0, "paragraphs", 0, 0, "source"), f"card:{kit.oracle(999)}")],
        Rule.SOURCE_NOT_IN_DATASET,
    ),
    (
        "a sentence of 41 words",
        "regions",
        [(("regions", 0, "sentence", "text"), "word " * 41)],
        Rule.WORD_LIMIT,
    ),
    (
        "the presentation lint",
        "eras",
        [(("eras", 0, "name"), "The Great Game")],
        Rule.PRESENTATION_LINT,
    ),
    (
        "four paragraphs",
        "eras",
        [(("eras", 0, "paragraphs"), [[kit.sentence()] for _ in range(4)])],
        Rule.PARAGRAPH_COUNT,
    ),
    ("a keyword of two characters", "keywords", [(("keywords", 0, "word"), "Al")], Rule.KEYWORD),
    (
        "a keyword in no region",
        "keywords",
        [(("keywords", 0, "region"), "nowhere")],
        Rule.KEYWORD_REGION,
    ),
    ("an unknown field", "regions", [(("regions", 0, "colour"), "red")], Rule.UNKNOWN_FIELD),
    ("the plane's identity", "keywords", [(("plane",), "ravnica")], Rule.PLANE_IDENTITY),
    (
        "a malformed accepted record",
        "eras",
        [(("accepted",), {"by": "owner"})],
        Rule.MISSING_FIELD,
    ),
    (
        "thirteen regions",
        "regions",
        [(("regions",), [*kit.regions()["regions"], *_NINE_MORE_REGIONS])],
        Rule.ROW_COUNT,
    ),
]


@pytest.mark.parametrize(
    ("table", "edits", "rule"),
    [(table, edits, rule) for _, table, edits, rule in _STILL_ENFORCED],
    ids=[name for name, _, _, _ in _STILL_ENFORCED],
)
def test_fixture_relaxes_nothing_else(
    tmp_path: Path, table: str, edits: list[kit.Edit], rule: Rule
):
    """5.4.14: the flag relaxes the row minimums and the ``accepted`` requirement "and nothing
    else". The row maximum is one of the things it leaves alone (thirteen regions)."""
    tables: dict[str, dict[str, Any]] = {
        "regions": kit.regions(),
        "eras": kit.eras(),
        "keywords": kit.keywords(),
    }
    for path, value in edits:
        kit.edit(tables[table], path, value)
    directory = kit.write(
        tmp_path,
        regions_table=tables["regions"],
        eras_table=tables["eras"],
        keywords_table=tables["keywords"],
    )

    without = {problem.rule for problem in kit.problems(directory)}
    with_fixture = {problem.rule for problem in kit.problems(directory, fixture=True)}

    assert rule in without
    assert with_fixture == without


def test_fixture_takes_one_row_and_not_zero(tmp_path: Path):
    """The minimum is relaxed to one row. An empty table is not a table."""
    empty_regions: dict[str, Any] = {"plane": "dominaria", "regions": []}
    directory = kit.write(tmp_path, regions_table=empty_regions)

    rules = [problem.rule for problem in kit.problems(directory, fixture=True)]

    assert Rule.ROW_COUNT in rules


# --- lore check -----------------------------------------------------------------------------


def test_lore_check_runs_the_stage_on_the_committed_pack(capsys: pytest.CaptureFixture[str]):
    assert cli.main(["lore", "check"]) == 0

    out = capsys.readouterr().out
    assert "## Lore tables (PRD v4 4.16)" in out
    assert "### Hero entries without tables" in out
    assert "### Schema example (Appendix F.5)" in out
    assert "`dominaria`: **74** printings" in out
    assert (
        "Trig table: sha256 fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777" in out
    )


def test_lore_check_distribution_fails_naming_the_entries(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """An empty lore root: all twenty hero entries are named, each with "no lore directory"."""
    code = cli.main(["lore", "check", "--distribution", "--lore-root", str(tmp_path / "lore")])

    assert code == 1
    err = capsys.readouterr().err
    assert "lore check failed — --distribution: 20 hero entries are not accepted" in err
    assert err.count("no lore directory at") == 20
    assert "dominaria: no lore directory" in err and "thunder-junction: no lore directory" in err


def test_a_lore_command_pointed_at_something_that_is_not_a_pack_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    assert cli.main(["lore", "check", "--data", str(tmp_path)]) == 1
    assert "has no planes.json" in capsys.readouterr().err
    assert cli.main(["lore", "validate", EXAMPLE, "--data", str(tmp_path)]) == 1
    assert "lore validate failed" in capsys.readouterr().err


def test_a_lore_command_with_no_production_pack_says_to_pass_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(cli, "DATASETS_FILE", tmp_path / "datasets.json")
    assert cli.main(["lore", "check"]) == 1
    assert "names no production pack; pass --data" in capsys.readouterr().err

    (tmp_path / "datasets.json").write_text('{"fixtures": {}}', encoding="utf-8")
    assert cli.main(["lore", "check"]) == 1
    assert "names no production pack; pass --data" in capsys.readouterr().err


# --- eternities build --distribution --------------------------------------------------------


class _Result:
    def __init__(self, root: Path) -> None:
        self.data_dir = root / "0123456789abcdef"
        self.report_path = root / "report.md"


def _build_arguments(tmp_path: Path) -> list[str]:
    return [
        "build",
        "--out",
        str(tmp_path / "data"),
        "--reports",
        str(tmp_path / "reports"),
        "--cache",
        str(tmp_path / "cache"),
        "--no-roster-diff",
    ]


@pytest.mark.parametrize(("flag", "expected"), [([], False), (["--distribution"], True)])
def test_build_hands_the_distribution_flag_to_the_pipeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, flag: list[str], expected: bool
):
    """`test_lore_build` runs the real orchestrator with the flag; this is the parser's half."""
    import eternities.pipeline as pipeline_pkg

    seen: dict[str, object] = {}

    def build_stub(**kwargs: object) -> _Result:
        seen.update(kwargs)
        return _Result(tmp_path)

    monkeypatch.setattr(pipeline_pkg, "build", build_stub)

    assert cli.main([*_build_arguments(tmp_path), *flag]) == 0
    assert seen["distribution"] is expected


def test_a_build_the_lore_stage_stops_exits_1_with_the_entry_named(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    """A lore failure is a message naming what to fix, never a traceback."""
    import eternities.pipeline as pipeline_pkg

    def build_stub(**_kwargs: object) -> _Result:
        raise LoreStageError(
            "--distribution: 1 hero entry is not accepted (PRD v4 4.16.5):\n"
            "  ravnica: no lore directory at pipeline/data/lore/ravnica"
        )

    monkeypatch.setattr(pipeline_pkg, "build", build_stub)

    assert cli.main([*_build_arguments(tmp_path), "--distribution"]) == 1
    err = capsys.readouterr().err
    assert "build failed — --distribution: 1 hero entry is not accepted" in err
    assert "ravnica: no lore directory" in err
