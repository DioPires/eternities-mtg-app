"""The Story Spotlight sidecar of PRD v4 9.6: ``pipeline/data/lore/dominaria/spotlight.json``.

9.6: "Leg A validates every id against the dataset's printings, maps each to its ``oracle_id`` and
face, and reports the count." The committed file is checked against the committed production
dataset first; the rules are then broken one at a time on ``lore_kit``'s dataset, and the fetch
script is run on a bulk file written here, because CI has no Scryfall download.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import pytest
import lore_kit as kit
from lore_kit import oracle, printing_id

from eternities.lore.index import LoreIndex
from eternities.lore.problems import LoreValidationError, Problem, Rule
from eternities.lore.spotlight import SIDECAR_NAME, SpotlightSidecar, validate_sidecar
from eternities.lore.stage import LORE_ROOT, report_section, run_stage
from eternities.lore.vocabulary import load_hero_entries

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "pipeline" / "scripts" / "spotlight_sidecar.py"
COMMITTED = LORE_ROOT / "dominaria" / SIDECAR_NAME

COMMITTED_COUNT = 74
"""What the fetch script wrote on 2026-10-12, and what the report prints."""


def _script() -> Any:
    spec = importlib.util.spec_from_file_location("spotlight_sidecar", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- the committed sidecar, on the production dataset ---------------------------------------


@pytest.fixture(scope="module")
def committed(production_index: LoreIndex) -> SpotlightSidecar:
    return validate_sidecar(COMMITTED, production_index, hero_entries=load_hero_entries())


def test_the_committed_sidecar_names_its_fetch_script_and_its_fetch_date():
    """9.6: "with the fetch script and the fetch date" inside the file."""
    document = json.loads(COMMITTED.read_text(encoding="utf-8"))

    assert document["plane"] == "dominaria"
    assert document["fetch_script"] == "pipeline/scripts/spotlight_sidecar.py"
    assert (REPO_ROOT / document["fetch_script"]).is_file()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", document["fetched_on"])
    assert document["bulk"]["type"] == "default_cards"


def test_every_committed_id_is_a_printing_of_the_dataset_and_the_count_is_reported(
    committed: SpotlightSidecar, production_index: LoreIndex
):
    """The count the report prints is the count the fetch script wrote into the file."""
    document = json.loads(COMMITTED.read_text(encoding="utf-8"))

    assert committed.count == document["count"] == len(document["printings"]) == COMMITTED_COUNT
    for printing in committed.printings:
        assert printing.printing_id in production_index.printings
    assert f"`dominaria`: **{COMMITTED_COUNT}** printings" in "\n".join(
        report_section(run_stage(production_index))
    )


def test_the_committed_ids_lie_in_the_planes_set_codes(
    committed: SpotlightSidecar, production_index: LoreIndex
):
    """9.6: "among Dominaria's 37 set codes with first printings"."""
    document = json.loads(COMMITTED.read_text(encoding="utf-8"))
    codes = production_index.expected_sets("dominaria")

    assert document["set_codes"] == list(codes)
    assert len(codes) == 37
    assert committed.by_set == {"dom": 4, "dmu": 10, "bro": 40, "mom": 20}
    assert set(committed.by_set) <= set(codes)


def test_each_committed_id_maps_to_its_oracle_id_and_its_faces(
    committed: SpotlightSidecar, production_index: LoreIndex
):
    """An id names a whole card: its `oracle_id`, its plane, its first face and its second."""
    for printing in committed.printings:
        card = production_index.cards[printing.oracle_id]
        assert (printing.name, printing.back_name, printing.card_plane) == (
            card.name,
            card.back_name,
            card.plane,
        )
    assert len({printing.oracle_id for printing in committed.printings}) == committed.count

    two_faced = [printing for printing in committed.printings if printing.back_name is not None]
    assert [(p.name, p.back_name) for p in two_faced] == [
        ("Invasion of New Phyrexia", "Teferi Akosa of Zhalfir")
    ]
    # A flagged printing in one of the plane's sets is not always a card of the plane: March of
    # the Machine's cards stand on other planes, and two reprints do too.
    elsewhere = [p for p in committed.printings if p.card_plane != "dominaria"]
    assert {p.set_code for p in elsewhere} == {"mom", "bro", "dmu"}
    assert len(committed.on_plane) == committed.count - len(elsewhere)
    assert committed.sets_with_cards == frozenset({"dom", "dmu", "bro"})


# --- the rules, broken one at a time --------------------------------------------------------

ROWS = [
    {"id": printing_id(1), "set": "aaa", "collector_number": "1", "name": "Alpha One"},
    {"id": printing_id(3), "set": "ccc", "collector_number": "3", "name": "Gamma One"},
    # Rho One stands on Ravnica; this is its reprint in one of Dominaria's sets.
    {"id": printing_id(105), "set": "ddd", "collector_number": "9", "name": "Rho One"},
]


def _document() -> dict[str, Any]:
    return {
        "plane": "dominaria",
        "fetched_on": "2026-10-12",
        "fetch_script": "pipeline/scripts/spotlight_sidecar.py",
        "bulk": {"type": "default_cards", "updated_at": "2026-10-12T09:05:45.962+00:00"},
        "dataset": "synthetic",
        "set_codes": ["aaa", "bbb", "ccc", "ddd"],
        "count": 3,
        "printings": [dict(row) for row in ROWS],
    }


def _write(root: Path, document: dict[str, Any] | str) -> Path:
    directory = root / "dominaria"
    directory.mkdir(parents=True, exist_ok=True)
    text = document if isinstance(document, str) else json.dumps(document)
    (directory / SIDECAR_NAME).write_text(text, encoding="utf-8")
    return directory / SIDECAR_NAME


def _validate(path: Path) -> SpotlightSidecar:
    return validate_sidecar(path, kit.INDEX, hero_entries=kit.HEROES)


def _problems(path: Path) -> list[Problem]:
    with pytest.raises(LoreValidationError) as raised:
        _validate(path)
    return raised.value.problems


def test_a_valid_sidecar_maps_each_id_to_its_card(tmp_path: Path):
    sidecar = _validate(_write(tmp_path, _document()))

    assert sidecar.count == 3
    assert sidecar.fetched_on == "2026-10-12"
    assert sidecar.bulk_updated_at == "2026-10-12T09:05:45.962+00:00"
    assert [(p.printing_id, p.oracle_id) for p in sidecar.printings] == [
        (printing_id(1), oracle(1)),
        (printing_id(3), oracle(3)),
        (printing_id(105), oracle(5)),
    ]
    assert [p.back_name for p in sidecar.printings] == [None, "Gamma Other", None]
    assert [p.card_plane for p in sidecar.printings] == ["dominaria", "dominaria", "ravnica"]
    assert [p.name for p in sidecar.on_plane] == ["Alpha One", "Gamma One"]
    # `ddd` carries a flagged printing, of a card that is not Dominaria's.
    assert sidecar.sets_with_cards == frozenset({"aaa", "ccc"})
    assert sidecar.by_set == {"aaa": 1, "ccc": 1, "ddd": 1}


@pytest.mark.parametrize(
    "unknown",
    [printing_id(999), oracle(1)],
    ids=["an id of no printing", "a card id, which is not a printing id"],
)
def test_an_id_that_is_not_a_printing_of_the_dataset_fails_naming_the_row(
    tmp_path: Path, unknown: str
):
    document = _document()
    document["printings"][1]["id"] = unknown

    problem = kit.only(_problems(_write(tmp_path, document)))

    assert problem.rule is Rule.SPOTLIGHT_NOT_IN_DATASET
    assert (problem.file, problem.row, problem.field) == ("spotlight.json", "printings[1]", "id")
    assert unknown in problem.message


@pytest.mark.parametrize(
    ("field", "value", "actual"),
    [
        ("name", "Alpha Won", "'Alpha One'"),
        ("set", "bbb", "'aaa'"),
        ("collector_number", "2", "'1'"),
    ],
)
def test_what_a_row_says_about_its_id_must_be_true(
    tmp_path: Path, field: str, value: str, actual: str
):
    """The set, the number and the name make the list reviewable, so each is an assertion."""
    document = _document()
    document["printings"][0][field] = value

    problem = kit.only(_problems(_write(tmp_path, document)))

    assert problem.rule is Rule.SPOTLIGHT
    assert (problem.row, problem.field) == ("printings[0]", field)
    assert actual in problem.message


def test_the_count_must_be_the_number_of_printings(tmp_path: Path):
    document = _document()
    document["count"] = 54

    problem = kit.only(_problems(_write(tmp_path, document)))

    assert (problem.rule, problem.field) == (Rule.SPOTLIGHT, "count")
    assert "is 54 and the file lists 3 printings" in problem.message


def test_an_id_listed_twice_fails(tmp_path: Path):
    document = _document()
    document["printings"].append(dict(ROWS[0]))
    document["count"] = 4

    problem = kit.only(_problems(_write(tmp_path, document)))

    assert (problem.rule, problem.row, problem.field) == (Rule.SPOTLIGHT, "printings[3]", "id")
    assert "printings[0]" in problem.message


@pytest.mark.parametrize(
    ("codes", "says"),
    [
        (["aaa", "bbb", "ccc"], "missing ['ddd']"),
        (["aaa", "bbb", "ccc", "ddd", "rrr"], "not on the plane ['rrr']"),
    ],
)
def test_the_set_codes_must_be_the_planes_for_the_current_dataset(
    tmp_path: Path, codes: list[str], says: str
):
    """A refresh that gives the plane a new set makes the sidecar out of date, and says so."""
    document = _document()
    document["set_codes"] = codes

    found = _problems(_write(tmp_path, document))

    assert found[0].rule is Rule.SPOTLIGHT
    assert found[0].field == "set_codes"
    assert says in found[0].message
    assert "run the fetch script again" in found[0].message


@pytest.mark.parametrize(
    ("path", "value", "rule", "field"),
    [
        (("fetched_on",), "12 October 2026", Rule.SPOTLIGHT, "fetched_on"),
        (("fetched_on",), "2026-13-01", Rule.SPOTLIGHT, "fetched_on"),
        (("fetched_on",), kit.DELETE, Rule.MISSING_FIELD, "fetched_on"),
        (("fetch_script",), "", Rule.SPOTLIGHT, "fetch_script"),
        (("fetch_script",), kit.DELETE, Rule.MISSING_FIELD, "fetch_script"),
        (("bulk", "updated_at"), kit.DELETE, Rule.MISSING_FIELD, "updated_at"),
        (("count",), "3", Rule.WRONG_TYPE, "count"),
        (("count",), 3.0, Rule.NUMBER, "count"),
        (("note",), "by hand", Rule.UNKNOWN_FIELD, "note"),
        (("plane",), "ravnica", Rule.PLANE_IDENTITY, "plane"),
        (("printings", 2, "id"), "NOT-AN-ID", Rule.SPOTLIGHT, "id"),
        (("printings", 2, "id"), kit.DELETE, Rule.MISSING_FIELD, "id"),
        (("printings", 2, "name"), kit.DELETE, Rule.MISSING_FIELD, "name"),
        (("printings", 2, "face"), "front", Rule.UNKNOWN_FIELD, "face"),
    ],
)
def test_the_sidecars_own_fields_are_checked(
    tmp_path: Path, path: tuple[kit.Step, ...], value: Any, rule: Rule, field: str
):
    document = _document()
    kit.edit(document, path, value)

    problem = kit.only(_problems(_write(tmp_path, document)))

    assert (problem.rule, problem.file, problem.field) == (rule, "spotlight.json", field)


def test_a_sidecar_that_is_not_json_fails(tmp_path: Path):
    problem = kit.only(_problems(_write(tmp_path, '{"plane": "dominaria"')))

    assert (problem.rule, problem.file) == (Rule.NOT_JSON, "spotlight.json")


# --- the sidecar inside the stage -----------------------------------------------------------


def test_a_directory_holding_only_a_sidecar_has_a_count_and_no_tables(tmp_path: Path):
    """The state `pipeline/data/lore/dominaria/` is in until its tables are drafted."""
    _write(tmp_path, _document())

    result = run_stage(kit.INDEX, lore_root=tmp_path, example_dir=None, hero_entries=kit.HEROES)

    assert result.without_tables == kit.HEROES
    assert result.entries[0].sidecar is not None
    text = "\n".join(report_section(result))
    assert "`dominaria`: **3** printings, every one a printing of the dataset, on 3 cards" in text
    assert "2 are cards of `dominaria`; the other 1 stand on another plane." in text
    assert "1 has a second face." in text


def test_a_sidecar_that_fails_stops_the_build(tmp_path: Path):
    from eternities.lore.stage import LoreStageError

    document = _document()
    document["printings"][0]["id"] = printing_id(999)
    _write(tmp_path, document)

    with pytest.raises(LoreStageError, match="is not a printing of dataset synthetic"):
        run_stage(kit.INDEX, lore_root=tmp_path, example_dir=None, hero_entries=kit.HEROES)


def test_the_stage_hands_the_sidecars_sets_to_the_headline_rule(tmp_path: Path):
    """F.0: ``headline`` is empty when the era's sets carry Story Spotlight cards. `ccc` carries
    one (Gamma One), so the era that lists `ccc` may not name headline cards of its own."""
    from eternities.lore.stage import LoreStageError

    _write(tmp_path, _document())
    eras = kit.eras()
    eras["eras"][2]["headline"] = ["Delta One"]  # `ddd`: its flagged printing is Ravnica's card
    kit.write(tmp_path, eras_table=eras)
    run_stage(kit.INDEX, lore_root=tmp_path, example_dir=None, hero_entries=kit.HEROES)

    eras["eras"][1]["headline"] = ["Beta One"]  # `bbb` and `ccc`
    kit.write(tmp_path, eras_table=eras)
    with pytest.raises(LoreStageError, match="headline: must be empty"):
        run_stage(kit.INDEX, lore_root=tmp_path, example_dir=None, hero_entries=kit.HEROES)


# --- the fetch script, on a bulk file written here ------------------------------------------

BULK_UPDATED_AT = "2026-10-12T09:05:45.962+00:00"
STAMP = "20261012T0905459620000"


def _bulk_card(n: int, set_code: str, number: str, **more: Any) -> dict[str, Any]:
    card: dict[str, Any] = {
        "id": printing_id(n),
        "oracle_id": oracle(n),
        "name": f"Card {n}",
        "set": set_code,
        "collector_number": number,
        "story_spotlight": True,
    }
    card.update(more)
    return card


def _bulk_cache(tmp_path: Path, cards: list[dict[str, Any]]) -> Path:
    cache = tmp_path / "cache"
    cache.mkdir()
    lines = "".join(json.dumps(card) + "\n" for card in cards)
    (cache / f"default_cards-{STAMP}.jsonl").write_text(lines, encoding="utf-8")
    (cache / f"sets-{STAMP}.json").write_text('{"data": []}', encoding="utf-8")
    return cache


CARDS = [
    _bulk_card(1, "dom", "10"),
    _bulk_card(2, "dom", "9"),
    _bulk_card(3, "bro", "12a"),
    _bulk_card(4, "lea", "1", story_spotlight=False),  # in the plane's sets, not flagged
    _bulk_card(5, "war", "1"),  # flagged, in a set that is not the plane's
    _bulk_card(6, "atq", "2"),  # `atq` comes before `dom` in the plane's order
    {key: value for key, value in _bulk_card(7, "dom", "1").items() if key != "story_spotlight"},
    _bulk_card(
        8,
        "mom",
        "239",
        name="Invasion of New Phyrexia // Teferi Akosa of Zhalfir",
        card_faces=[{"name": "Invasion of New Phyrexia"}, {"name": "Teferi Akosa of Zhalfir"}],
    ),
]


def test_the_fetch_script_keeps_the_flagged_printings_in_the_planes_sets(tmp_path: Path):
    script = _script()
    cache = _bulk_cache(tmp_path, CARDS)

    rows = script.flagged(
        cache / f"default_cards-{STAMP}.jsonl", ("lea", "atq", "dom", "bro", "mom")
    )

    # The plane's set order, then the collector number as a number (9 before 10), then the id.
    assert [(row["set"], row["collector_number"]) for row in rows] == [
        ("atq", "2"),
        ("dom", "9"),
        ("dom", "10"),
        ("bro", "12a"),
        ("mom", "239"),
    ]
    # A card with two faces is named by its first, which is its name in the dataset.
    assert rows[-1]["name"] == "Invasion of New Phyrexia"
    assert set(rows[0]) == {"id", "set", "collector_number", "name"}


def test_the_fetch_script_writes_the_sidecar_and_checks_it_against_the_bulk_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """`--check` is the comparison the hand-back quotes: the file's count against the script's."""
    script = _script()
    cache = _bulk_cache(tmp_path, CARDS)
    out = tmp_path / "spotlight.json"
    arguments = [
        "dominaria",
        "--cache",
        str(cache),
        "--bulk-updated-at",
        BULK_UPDATED_AT,
        "--out",
        str(out),
    ]

    assert script.main(arguments) == 0
    document = json.loads(out.read_text(encoding="utf-8"))
    assert document["count"] == len(document["printings"]) == 5
    assert document["plane"] == "dominaria"
    assert document["fetch_script"] == "pipeline/scripts/spotlight_sidecar.py"
    assert document["bulk"] == {"type": "default_cards", "updated_at": BULK_UPDATED_AT}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", document["fetched_on"])
    assert len(document["set_codes"]) == 37
    assert "5 printings (atq 1, dom 2, bro 1, mom 1)" in capsys.readouterr().out

    assert script.main([*arguments, "--check"]) == 0
    assert "matches bulk" in capsys.readouterr().out

    document["printings"].pop()
    out.write_text(json.dumps(document), encoding="utf-8")
    assert script.main([*arguments, "--check"]) == 1
    assert "lists 4 printings and bulk" in capsys.readouterr().err


def test_the_fetch_script_reads_the_cached_bulk_file_and_never_the_card_api(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """`docs/scryfall-policy.md` section 4. A pinned bulk file that is not cached is an error,
    not a reason to ask the API card by card."""
    script = _script()
    empty = tmp_path / "cache"
    empty.mkdir()
    # Every call here pins the bulk file and names `--out`, so a test can neither reach the
    # network nor write under `pipeline/data/lore/`.
    pinned = ["--cache", str(empty), "--bulk-updated-at", BULK_UPDATED_AT]
    out = ["--out", str(tmp_path / "spotlight.json")]

    assert script.main(["dominaria", *pinned, *out]) == 1
    assert "needs default_cards-" in capsys.readouterr().err
    source = SCRIPT.read_text(encoding="utf-8")
    assert "cards/search" not in source and "urllib" not in source and "requests" not in source

    # A plane that is not a hero entry gets no sidecar: its directory would fail the build.
    assert script.main(["segovia", *pinned, *out]) == 1
    assert "segovia is not a hero entry of Appendix C.1" in capsys.readouterr().err
    assert not (tmp_path / "spotlight.json").exists()
    assert not (LORE_ROOT / "segovia").exists()
