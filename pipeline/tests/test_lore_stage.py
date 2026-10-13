"""The lore stage of a pipeline run: every hero entry, the acceptance status, ``--distribution``.

PRD v4 4.16.5 separates two questions. Do the tables validate? A failure stops the build in both
modes. Has the owner accepted exactly these tables? That is the acceptance status (F.2): reported
on every run, and fatal only under ``--distribution``, which fails naming the entry. The first
test runs the stage on the committed inputs and the production dataset, as a build does; the rest
use ``lore_kit``'s two hero entries.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
import lore_kit as kit

from eternities.contract import write_dataset
from eternities.fixtures import SMALL, build
from eternities.lore import example
from eternities.lore.digest import AcceptanceStatus
from eternities.lore.index import LoreIndex, LoreIndexError
from eternities.lore.stage import (
    LORE_ROOT,
    LoreStageError,
    LoreStageResult,
    report_section,
    run_stage,
)
from eternities.lore.vocabulary import HeroEntriesError, load_hero_entries

# PRD v4 Appendix C.1, in the appendix's order.
THE_TWENTY = (
    "dominaria",
    "blind-eternities",
    "ravnica",
    "innistrad",
    "new-phyrexia",
    "zendikar",
    "lorwyn",
    "tarkir",
    "kamigawa",
    "theros",
    "ixalan",
    "rath",
    "arcavios",
    "forgotten-realms",
    "eldraine",
    "alara",
    "avishkar",
    "amonkhet",
    "capenna",
    "thunder-junction",
)


def _stage(root: Path, **options: Any) -> LoreStageResult:
    """The stage on the kit's dataset: two hero entries, and no schema example."""
    return run_stage(
        kit.INDEX, lore_root=root, example_dir=None, hero_entries=kit.HEROES, **options
    )


def _accept(directory: Path, digest: str | None = None) -> str:
    """Write an `accepted` record naming ``digest``, or the files' own digest. Returns it."""
    eras = json.loads((directory / "eras.json").read_text(encoding="utf-8"))
    eras.pop("accepted", None)
    (directory / "eras.json").write_text(json.dumps(eras), encoding="utf-8")
    named = digest or kit.validate(directory).digest
    eras["accepted"] = {"by": "owner", "on": "2026-10-20", "issue": "DEC-1002", "digest": named}
    (directory / "eras.json").write_text(json.dumps(eras), encoding="utf-8")
    return named


def _product(root: Path) -> Path:
    """A valid product table set for the kit's Blind Eternities."""
    regions = kit.regions()
    regions["plane"] = "blind-eternities"
    for row, codes in zip(regions["regions"], [["pr1"], ["pr2"], ["pr3", "pr4"], []], strict=True):
        row["sets"] = codes
    eras = {
        "plane": "blind-eternities",
        "kind": "product",
        "eras": [
            kit.era("first", "north", ["pr1"]),
            kit.era("second", "east", ["pr2"]),
            kit.era("third", "south", ["pr3", "pr4"]),
        ],
    }
    return kit.write(
        root,
        regions_table=regions,
        eras_table=eras,
        keywords_table={"plane": "blind-eternities", "keywords": []},
        slug="blind-eternities",
    )


# --- the committed inputs, on the production dataset ----------------------------------------


def test_the_committed_lore_inputs_pass_on_the_production_dataset(production_index: LoreIndex):
    """What `eternities build` runs: every hero entry directory, the example and the sidecars."""
    result = run_stage(production_index)

    assert [entry.slug for entry in result.entries] == list(THE_TWENTY)
    assert result.example is not None
    assert result.example.directory == "contract/test-vectors/v4/layout/dominaria-example/dominaria"
    assert result.distribution is False
    dominaria = result.entries[0]
    assert len(dominaria.expected_sets) == 37
    assert dominaria.sidecar is not None
    # Every entry is reported with the set codes its tables must map, tables or none.
    assert all(entry.expected_sets for entry in result.entries)


def test_the_hero_entries_are_the_twenty_of_appendix_c1(production_index: LoreIndex):
    """4.16.5: "exactly the twenty of Appendix C.1, asserted". Read from a committed list until
    Appendix C ingestion (4.12) is in the pipeline."""
    assert load_hero_entries() == THE_TWENTY
    # Each is a plane of Appendix A's roster, and of the dataset, which holds the whole roster.
    assert load_hero_entries(plane_slugs=production_index.plane_slugs) == THE_TWENTY


@pytest.mark.parametrize(
    ("entries", "says"),
    [
        (list(THE_TWENTY[:19]), "lists 19 hero entries"),
        ([*THE_TWENTY[:19], "dominaria"], "19 distinct"),
        ([*THE_TWENTY, "segovia"], "lists 21 hero entries"),
        ([*THE_TWENTY[:19], "dominara"], "does not list as a plane"),
    ],
)
def test_a_list_that_is_not_the_twenty_is_refused(tmp_path: Path, entries: list[str], says: str):
    listed = tmp_path / "appendix_c_heroes.json"
    listed.write_text(json.dumps({"heroEntries": entries}), encoding="utf-8")

    with pytest.raises(HeroEntriesError, match=says):
        load_hero_entries(listed, plane_slugs=(*THE_TWENTY, "segovia"))


# --- the three states of a hero entry's directory (4.16.5) ----------------------------------


def test_an_entry_with_no_directory_has_no_tables_and_a_development_build_proceeds(
    tmp_path: Path,
):
    result = _stage(tmp_path / "lore")

    assert result.without_tables == kit.HEROES
    assert [entry.tables for entry in result.entries] == [None, None]
    assert result.entries[0].expected_sets == ("aaa", "bbb", "ccc", "ddd")


def test_a_directory_with_none_of_the_three_files_has_no_tables(tmp_path: Path):
    """`test_lore_spotlight` covers the directory that holds a sidecar and nothing else."""
    directory = tmp_path / "dominaria"
    directory.mkdir()
    (directory / "notes.md").write_text("not a table", encoding="utf-8")

    result = _stage(tmp_path)

    assert result.without_tables == kit.HEROES


def test_valid_tables_are_reported_with_their_status_whatever_it_is(tmp_path: Path):
    """A development build "proceeds in every status" (F.2)."""
    directory = kit.write(tmp_path)
    absent = _stage(tmp_path).entries[0].tables
    assert absent is not None and absent.status is AcceptanceStatus.ABSENT

    digest = _accept(directory)
    accepted = _stage(tmp_path).entries[0].tables
    assert accepted is not None and accepted.status is AcceptanceStatus.ACCEPTED
    assert accepted.digest == digest

    _accept(directory, "sha256:" + "0" * 64)
    stale = _stage(tmp_path).entries[0].tables
    assert stale is not None and stale.status is AcceptanceStatus.STALE


def test_tables_that_break_a_rule_fail_the_build_in_development_too(tmp_path: Path):
    """4.16.5: "tables that fail validation fail the build in either mode"."""
    regions = kit.regions()
    regions["regions"][0]["weight"] = 100
    kit.write(tmp_path, regions_table=regions)

    for distribution in (False, True):
        with pytest.raises(LoreStageError) as raised:
            _stage(tmp_path, distribution=distribution)
        assert 'dominaria/regions.json: regions[0] "north": weight: is 100' in str(raised.value)


def test_one_or_two_of_the_three_files_fail_the_build_naming_the_missing_one(tmp_path: Path):
    directory = kit.write(tmp_path)
    (directory / "keywords.json").unlink()

    with pytest.raises(LoreStageError, match=r"keywords\.json: the file does not exist"):
        _stage(tmp_path)


def test_every_failing_entry_is_named_in_one_error(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][0]["water"] = "ocean"
    kit.write(tmp_path, regions_table=regions)
    product = _product(tmp_path)
    (product / "eras.json").write_text("{", encoding="utf-8")

    with pytest.raises(LoreStageError) as raised:
        _stage(tmp_path)

    assert "dominaria/regions.json" in str(raised.value)
    assert "blind-eternities/eras.json: not valid JSON" in str(raised.value)


def test_a_directory_that_is_not_named_for_a_hero_entry_fails_the_build(tmp_path: Path):
    """A misspelt directory would otherwise be an entry silently left without tables."""
    kit.write(tmp_path, slug="dominara")
    (tmp_path / "README.md").write_text("files beside the directories are ignored", "utf-8")

    with pytest.raises(LoreStageError, match="dominara is not named for a hero entry"):
        _stage(tmp_path)


# --- the distribution flag (4.16.5) ---------------------------------------------------------


def test_distribution_fails_naming_every_entry_that_is_not_accepted(tmp_path: Path):
    """No directory, no tables, no record and a stale record: each named, with its reason."""
    kit.write(tmp_path)  # dominaria: valid, no record
    (tmp_path / "blind-eternities").mkdir()  # a directory with no tables

    with pytest.raises(LoreStageError) as raised:
        _stage(tmp_path, distribution=True)

    text = str(raised.value)
    assert "--distribution: 2 hero entries are not accepted (PRD v4 4.16.5)" in text
    assert "dominaria: " in text and "eras.json carries no `accepted` record" in text
    assert "blind-eternities: no tables at " in text

    shutil.rmtree(tmp_path / "blind-eternities")
    _accept(tmp_path / "dominaria", "sha256:" + "0" * 64)
    with pytest.raises(LoreStageError) as raised:
        _stage(tmp_path, distribution=True)

    text = str(raised.value)
    assert "blind-eternities: no lore directory at " in text
    assert "dominaria: the `accepted` record" in text and "is stale" in text
    assert "sha256:" + "0" * 64 in text


def test_distribution_fails_on_one_stale_entry_among_accepted_ones(tmp_path: Path):
    _accept(kit.write(tmp_path))
    product = _product(tmp_path)
    _accept(product)
    _stage(tmp_path, distribution=True)  # both accepted: passes

    eras = json.loads((product / "eras.json").read_text(encoding="utf-8"))
    eras["eras"][0]["name"] = "Renamed after acceptance"
    (product / "eras.json").write_text(json.dumps(eras), encoding="utf-8")

    with pytest.raises(LoreStageError) as raised:
        _stage(tmp_path, distribution=True)
    assert "--distribution: 1 hero entry is not accepted" in str(raised.value)
    assert "blind-eternities: the `accepted` record" in str(raised.value)
    assert "dominaria:" not in str(raised.value)

    # The same tables build in development, with the status reported.
    assert _stage(tmp_path).entries[1].tables is not None


def test_distribution_passes_when_every_hero_entry_is_accepted(tmp_path: Path):
    _accept(kit.write(tmp_path))
    _accept(_product(tmp_path))

    result = _stage(tmp_path, distribution=True)

    assert result.distribution is True
    assert result.without_tables == ()
    assert [entry.tables.status for entry in result.entries if entry.tables] == [
        AcceptanceStatus.ACCEPTED,
        AcceptanceStatus.ACCEPTED,
    ]


# --- the schema example inside the stage (F.5) ----------------------------------------------


def _example_copy(tmp_path: Path) -> Path:
    copy = tmp_path / "dominaria-example"
    shutil.copytree(example.EXAMPLE_DIR, copy)
    return copy


def test_an_example_that_is_no_longer_what_the_rule_generates_fails_the_build(
    tmp_path: Path, production_index: LoreIndex
):
    """Still valid, and not the generated bytes: one placeholder reworded by hand."""
    copy = _example_copy(tmp_path)
    eras = copy / "dominaria" / "eras.json"
    eras.write_text(
        eras.read_text(encoding="utf-8").replace(
            "Placeholder for the drafter.", "To be drafted.", 1
        ),
        encoding="utf-8",
    )

    with pytest.raises(LoreStageError) as raised:
        run_stage(production_index, lore_root=tmp_path / "lore", example_dir=copy)

    assert "eras.json are not what the expansion rule of Appendix F.5 generates" in str(
        raised.value
    )


def test_an_example_that_breaks_a_rule_fails_the_build(tmp_path: Path, production_index: LoreIndex):
    """No exception for the example: it is validated under the ordinary rules."""
    copy = _example_copy(tmp_path)
    regions = copy / "dominaria" / "regions.json"
    regions.write_text(
        regions.read_text(encoding="utf-8").replace('"weight": 1000', '"weight": 100', 1),
        encoding="utf-8",
    )

    with pytest.raises(LoreStageError, match=r"regions\.json: regions\[0\] \"terisiare\": weight"):
        run_stage(production_index, lore_root=tmp_path / "lore", example_dir=copy)


def test_the_example_is_never_the_entrys_tables(tmp_path: Path, production_index: LoreIndex):
    """F.5: "as a fixture input and never as the entry's tables". With the example present and no
    directory under the lore root, Dominaria has no tables, and a distribution build says so."""
    result = run_stage(production_index, lore_root=tmp_path / "lore")

    assert result.example is not None
    assert "dominaria" in result.without_tables
    with pytest.raises(LoreStageError, match="dominaria: no lore directory"):
        run_stage(production_index, lore_root=tmp_path / "lore", distribution=True)


# --- the report (issue item 8) --------------------------------------------------------------


def test_the_report_lists_per_entry_its_set_codes_status_and_digest(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][2]["variant"] = "basalt-steppe"
    digest = _accept(kit.write(tmp_path, regions_table=regions))

    text = "\n".join(report_section(_stage(tmp_path)))

    assert "## Lore tables (PRD v4 4.16)" in text
    assert "Checked against dataset `synthetic`" in text
    assert (
        f"| `dominaria` | lore | **accepted** | `{digest}` | 4: `aaa`, `bbb`, `ccc`, `ddd` |"
        in text
    )
    assert "| `blind-eternities` | none | n/a | n/a | 4: `pr1`, `pr2`, `pr3`, `pr4` |" in text
    assert "### Hero entries without tables (1)\n\n`blind-eternities`" in text
    assert "Not requested. 1 of 2 hero entries are accepted" in text
    assert "`south: volcanic/basalt-steppe`" in text
    assert "### Schema example (Appendix F.5)\n\nNot checked on this run." in text
    assert "was not checked for: `dominaria`" in text


def test_the_report_says_when_every_entry_has_tables_and_the_build_is_a_distribution(
    tmp_path: Path,
):
    _accept(kit.write(tmp_path))
    _accept(_product(tmp_path))

    text = "\n".join(report_section(_stage(tmp_path, distribution=True)))

    assert "### Hero entries without tables (0)\n\nNone." in text
    assert "The manifest records `distribution: true`." in text
    assert "| `blind-eternities` | product | **accepted** |" in text


def test_the_report_of_the_committed_inputs_names_the_example_and_the_sidecar_count(
    production_index: LoreIndex,
):
    text = "\n".join(report_section(run_stage(production_index)))

    assert "| `dominaria` |" in text and "37: `lea`, `leb`, `atq`" in text
    assert "| `blind-eternities` |" in text and "50: `por`, `ptk`, `s99`" in text
    assert "validates under the ordinary rules with no flag" in text
    assert "`dominaria`: **74** printings" in text
    assert "Fetched on 2026-10-12 by `pipeline/scripts/spotlight_sidecar.py`" in text


def test_a_report_rendered_without_the_stage_says_so():
    assert report_section(None) == ["## Lore tables (PRD v4 4.16)", "", "Not run."]


# --- the two readers of the dataset agree ---------------------------------------------------


def test_the_index_of_a_dataset_and_of_its_pack_on_disk_are_the_same(tmp_path: Path):
    """`eternities build` reads the dataset in memory and the tests read a pack on disk. A rule
    checked against two different datasets would be two rules."""
    dataset = build(SMALL)
    pack = write_dataset(dataset, tmp_path)

    in_memory = LoreIndex.from_dataset(dataset, label=pack.name)
    on_disk = LoreIndex.from_pack(pack)

    assert in_memory == on_disk
    assert on_disk.label == pack.name
    assert len(on_disk.cards) == len(dataset.cards) > 0
    assert sum(len(card.printings) for card in dataset.cards) >= len(on_disk.printings) > 0


def test_the_production_pack_reads_as_the_dataset_the_prd_names(production_index: LoreIndex):
    """PRD v4 5.4.14: Dominaria has 37 set codes with first printings, the Blind Eternities 50."""
    assert len(production_index.expected_sets("dominaria")) == 37
    assert len(production_index.expected_sets("blind-eternities")) == 50
    assert production_index.expected_sets("no-such-plane") == ()
    # A name is not an identifier, so a name resolves to a list of cards.
    (lotus,) = production_index.names["Black Lotus"]
    assert production_index.cards[lotus].plane == "dominaria"
    assert production_index.cards[lotus].first_set == "lea"


def test_a_directory_that_is_not_a_pack_is_refused(tmp_path: Path):
    with pytest.raises(LoreIndexError, match=r"has no planes\.json"):
        LoreIndex.from_pack(tmp_path)


def test_a_pack_whose_set_list_and_first_printings_disagree_is_refused(tmp_path: Path):
    """The tables are checked against "the set codes with first printings on the plane", and the
    pack states that twice. A pack where the two differ is refused, not read one way."""
    pack = write_dataset(build(SMALL), tmp_path)
    planes = json.loads((pack / "planes.json").read_text(encoding="utf-8"))
    plane = next(row for row in planes["planes"] if len(row["sets"]) > 1)
    dropped = plane["sets"].pop()
    (pack / "planes.json").write_text(json.dumps(planes), encoding="utf-8")

    with pytest.raises(LoreIndexError, match=f"plane {plane['slug']} lists the sets") as raised:
        LoreIndex.from_pack(pack)
    assert dropped["code"] in str(raised.value)


def test_a_pack_with_a_missing_shard_or_an_unknown_set_is_refused(tmp_path: Path):
    pack = write_dataset(build(SMALL), tmp_path)
    planes = json.loads((pack / "planes.json").read_text(encoding="utf-8"))["planes"]
    slug = next(row["slug"] for row in planes if row["cardCount"] > 0)
    shard = pack / "planes" / f"{slug}.0.json"
    document = json.loads(shard.read_text(encoding="utf-8"))
    document["cards"][0]["p"][0][1] = 65_000
    shard.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(LoreIndexError, match=r"set id 65000, which search\.json does not list"):
        LoreIndex.from_pack(pack)

    shard.unlink()
    with pytest.raises(LoreIndexError, match=f"missing {slug}.0.json"):
        LoreIndex.from_pack(pack)


def test_a_dataset_with_a_card_twice_or_a_card_with_no_printing_is_refused():
    from eternities.lore.index import _Builder

    builder = _Builder("broken")
    builder.plane("dominaria", ["aaa"])
    with pytest.raises(LoreIndexError, match="has no printing"):
        builder.card("dominaria", oracle_id=kit.oracle(1), name="One", back_name=None, printings=[])
    printings = [(kit.printing_id(1), "aaa", "1")]
    builder.card(
        "dominaria", oracle_id=kit.oracle(1), name="One", back_name=None, printings=printings
    )
    with pytest.raises(LoreIndexError, match="appears twice"):
        builder.card(
            "dominaria", oracle_id=kit.oracle(1), name="One", back_name=None, printings=printings
        )


def test_the_committed_lore_root_is_where_4_16_1_puts_it():
    assert Path(__file__).resolve().parents[2] / "pipeline" / "data" / "lore" == LORE_ROOT
