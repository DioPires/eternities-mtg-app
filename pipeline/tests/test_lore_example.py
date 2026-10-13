"""The schema example of PRD v4 Appendix F.5: the validator's first real input.

F.5 prints three tables and an expansion rule, and says of the generated files: "the pipeline
validates that directory under the ordinary rules of 4.16.2 and F.0 on every run, with no flag and
no exception, as a fixture input ..., and asserts that re-running the script gives the same bytes."
This module is those two assertions, on the committed production dataset, plus the facts F.5
states about its own tables.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

import pytest
import lore_kit as kit

from eternities.lore import example
from eternities.lore.digest import AcceptanceStatus
from eternities.lore.index import LoreIndex
from eternities.lore.tables import validate_directory
from eternities.lore.vocabulary import load_hero_entries

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "pipeline" / "scripts" / "lore_example.py"
COMMITTED = example.EXAMPLE_DIR / "dominaria"

# The digest of the committed example. The bytes are committed, so this is a constant; a reviewer
# can recompute it from the three files with `json.dumps(..., sort_keys=True,
# separators=(",", ":"), ensure_ascii=False)` and `hashlib.sha256`, with none of this code.
EXAMPLE_DIGEST = "sha256:9c3e8af62db72675c17a2e5495109d6e870b658839fedc28775730306308d87a"


def _script() -> Any:
    spec = importlib.util.spec_from_file_location("lore_example", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_example_is_committed_under_the_entrys_slug():
    """F.5: "the leaf directory being the entry's slug and each file carrying ``"plane":
    "dominaria"``"."""
    assert COMMITTED == REPO_ROOT / "contract/test-vectors/v4/layout/dominaria-example/dominaria"
    for name in ("regions.json", "eras.json", "keywords.json"):
        document = json.loads((COMMITTED / name).read_text(encoding="utf-8"))
        assert document["plane"] == "dominaria"


def test_the_example_validates_under_the_ordinary_rules_with_no_flag(production_index: LoreIndex):
    """The positive run of PRD 8.8.1. No ``fixture``, no exception for the example."""
    tables = validate_directory(COMMITTED, production_index, hero_entries=load_hero_entries())

    assert tables.slug == "dominaria"
    assert tables.kind == "lore"
    # "there is no `accepted` record, so a distribution build fails on the example by design"
    assert tables.status is AcceptanceStatus.ABSENT
    assert tables.digest == EXAMPLE_DIGEST


def test_rerunning_the_expansion_rule_gives_the_committed_bytes(production_index: LoreIndex):
    generated = example.files(production_index)

    assert sorted(generated) == ["eras.json", "keywords.json", "regions.json"]
    for name, data in generated.items():
        assert (COMMITTED / name).read_bytes() == data, name
    assert example.differing_files(production_index) == []


def test_the_committed_script_reproduces_the_directory_byte_for_byte(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    """The script itself, as the pull request's reader will run it."""
    script = _script()

    assert script.main(["--check"]) == 0
    assert "is what the expansion rule generates" in capsys.readouterr().out

    assert script.main(["--out", str(tmp_path)]) == 0
    for name in ("regions.json", "eras.json", "keywords.json"):
        assert (tmp_path / "dominaria" / name).read_bytes() == (COMMITTED / name).read_bytes()


def test_the_script_says_which_file_is_not_what_the_rule_generates(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    shutil.copytree(example.EXAMPLE_DIR, tmp_path / "example")
    eras = tmp_path / "example" / "dominaria" / "eras.json"
    eras.write_text(
        eras.read_text(encoding="utf-8").replace("Legends", "Legend", 1), encoding="utf-8"
    )

    assert _script().main(["--check", "--out", str(tmp_path / "example")]) == 1
    assert "eras.json differ" in capsys.readouterr().err


def test_the_fifteen_groups_cover_the_planes_set_codes_once(production_index: LoreIndex):
    """F.5: "Fifteen groups cover all 37 codes once"."""
    listed = [code for _, _, sets in example.GROUPS for code in sets]

    assert len(example.GROUPS) == 15
    assert len(listed) == len(set(listed)) == 37
    assert set(listed) == set(production_index.expected_sets("dominaria"))


def test_the_region_and_keyword_tables_are_f5s():
    """Eleven regions on three kits, every weight 1000, and twenty-four keywords."""
    assert len(example.REGIONS) == 11
    assert {kit_name for _, _, kit_name, _, _ in example.REGIONS} == {
        "temperate",
        "coast",
        "volcanic",
    }
    assert len(example.KEYWORDS) == 24
    assert example.KEYWORDS[0] == ("Tolarian", "tolaria")
    assert example.KEYWORDS[-1] == ("Icatia", "sarpadia")
    region_ids = {ident for ident, *_ in example.REGIONS}
    assert set(example.ERA_REGION) == {ident for ident, _, _ in example.GROUPS}
    assert set(example.ERA_REGION.values()) <= region_ids
    assert {region for _, region in example.KEYWORDS} <= region_ids


def test_the_expansion_supplies_exactly_the_fields_f5_names():
    regions = json.loads((COMMITTED / "regions.json").read_text(encoding="utf-8"))["regions"]
    eras = json.loads((COMMITTED / "eras.json").read_text(encoding="utf-8"))

    shiv = next(row for row in regions if row["id"] == "shiv")
    assert shiv == {
        "id": "shiv",
        "name": "Shiv",
        "kit": "volcanic",
        "anchor": [750, 150],
        "weight": 1000,
        "water": "lava",
        "sentence": {
            "text": "Placeholder for the drafter: Shiv.",
            "source": "https://mtg.wiki/page/Shiv",
        },
        "sources": ["https://mtg.wiki/page/Shiv"],
    }
    assert "accepted" not in eras
    assert eras["kind"] == "lore"
    war = eras["eras"][1]
    assert war["id"] == "brothers-war"
    assert war["name"] == "The Brothers' War"
    assert war["years"] == "Placeholder for the drafter."
    assert war["region"] == "terisiare"
    assert war["sets"] == ["atq", "bro", "brc"]
    assert war["headline"] == []
    assert [len(paragraph) for paragraph in war["paragraphs"]] == [1]
    assert war["paragraphs"][0][0]["text"] == "Placeholder for the drafter."


def test_each_eras_source_is_the_first_oracle_id_by_bytes(production_index: LoreIndex):
    """F.5: "the oracle id that sorts first by bytes (the order of 4.13.3) among the cards first
    printed in the era's sets, resolved against the dataset"."""
    eras = json.loads((COMMITTED / "eras.json").read_text(encoding="utf-8"))["eras"]

    for era in eras:
        candidates = [
            uuid.UUID(card.oracle_id)
            for card in production_index.cards.values()
            if card.plane == "dominaria" and card.first_set in era["sets"]
        ]
        first = min(candidates, key=lambda candidate: candidate.bytes)
        assert era["paragraphs"][0][0]["source"] == f"card:{first}", era["id"]


def test_the_rule_fails_on_a_dataset_where_an_era_has_no_card():
    """The example names Dominaria's real set codes, and the kit's dataset has none of them."""
    with pytest.raises(example.ExampleError, match="first-cards"):
        example.tables(kit.INDEX)
