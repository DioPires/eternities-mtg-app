"""The acceptance digest and the acceptance status of PRD v4 Appendix F.2.

The owner's acceptance names one digest, and the pipeline recomputes it on every run. So the
canonical form has to be exactly the one F.2 states, on every machine: keys sorted by code point,
no white space, non-ASCII written as itself in UTF-8, ``accepted`` taken out of ``eras.json``, the
three files concatenated in the order regions, eras, keywords. The first tests pin that form
against text written out by hand, with no call to the serialiser under test.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, cast

import pytest
import lore_kit as kit

from eternities.lore.digest import (
    AcceptanceStatus,
    DigestError,
    canonical,
    digest_of,
    digest_of_directory,
    status_of,
)

REGIONS: dict[str, Any] = {
    "regions": [{"name": "Æther Vale", "id": "aether", "anchor": [-600, 300]}],
    "plane": "dominaria",
}
ERAS: dict[str, Any] = {
    "plane": "dominaria",
    "kind": "lore",
    "accepted": {"by": "owner", "on": "2026-10-20", "issue": "DEC-1002", "digest": "sha256:00"},
    "eras": [{"sets": ["atq", "bro"], "id": "war", "name": "The Brothers’ War — 兄弟戦争"}],  # noqa: RUF001
}
KEYWORDS: dict[str, Any] = {
    "keywords": [{"word": "Suq'Ata", "region": "aether"}],
    "plane": "dominaria",
}

# The canonical form of the three tables above, written by hand: every object's keys in code-point
# order, no white space, the non-ASCII characters as themselves, and no `accepted` member.
CANONICAL = (
    '{"plane":"dominaria","regions":[{"anchor":[-600,300],"id":"aether","name":"Æther Vale"}]}'
    '{"eras":[{"id":"war","name":"The Brothers’ War — 兄弟戦争","sets":["atq","bro"]}],'  # noqa: RUF001
    '"kind":"lore","plane":"dominaria"}'
    '{"keywords":[{"region":"aether","word":"Suq\'Ata"}],"plane":"dominaria"}'
)
DIGEST = "sha256:" + hashlib.sha256(CANONICAL.encode("utf-8")).hexdigest()


def _write(directory: Path, **dump: Any) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name, table in [("regions", REGIONS), ("eras", ERAS), ("keywords", KEYWORDS)]:
        (directory / f"{name}.json").write_text(json.dumps(table, **dump), encoding="utf-8")
    return directory


def _reversed(value: Any) -> Any:
    """The same value with every object's keys in the opposite order."""
    if isinstance(value, dict):
        members = cast("dict[str, Any]", value)
        return {key: _reversed(members[key]) for key in reversed(list(members))}
    if isinstance(value, list):
        return [_reversed(member) for member in cast("list[Any]", value)]
    return value


def test_the_digest_is_the_sha256_of_the_canonical_form_f2_states():
    assert digest_of(REGIONS, ERAS, KEYWORDS) == DIGEST
    assert DIGEST.startswith("sha256:")
    assert len(DIGEST) == len("sha256:") + 64
    assert DIGEST.islower()


def test_the_canonical_form_writes_non_ascii_as_itself_with_only_the_escapes_json_requires():
    """A quote, a backslash, a newline and a tab are escaped, because JSON requires it. Nothing
    else is: not Latin-1, not CJK, not a character outside the BMP, not U+2028."""
    value = {"text": 'She said "no"\\\n\tÆ 兄 🜂 \u2028', "é": 1}

    assert canonical(value) == '{"text":"She said \\"no\\"\\\\\\n\\tÆ 兄 🜂 \u2028","é":1}'
    assert "\\u" not in canonical(value)
    # Code-point order, which is not alphabetical order: `Z` (U+005A) sorts before `a` (U+0061).
    assert canonical({"a": 1, "Z": 2, "é": 3, "b": 4}) == '{"Z":2,"a":1,"b":4,"é":3}'


def test_key_order_white_space_and_escapes_do_not_move_the_digest(tmp_path: Path):
    """The fixture of PRD 8.8.1: non-ASCII text and re-ordered keys, one digest."""
    plain = _write(tmp_path / "plain", ensure_ascii=False)
    spaced = _write(tmp_path / "spaced", ensure_ascii=False, indent=4, sort_keys=True)
    escaped = _write(tmp_path / "escaped", ensure_ascii=True, separators=(",", ":"))
    reordered = tmp_path / "reordered"
    reordered.mkdir()
    for name, table in [("regions", REGIONS), ("eras", ERAS), ("keywords", KEYWORDS)]:
        (reordered / f"{name}.json").write_text(
            json.dumps(_reversed(table), ensure_ascii=False), encoding="utf-8"
        )

    # The four spellings differ as bytes, so equal digests are not equal files.
    spellings = {(d / "eras.json").read_bytes() for d in (plain, spaced, escaped, reordered)}
    assert len(spellings) == 4
    assert "\\u00c6" in (escaped / "regions.json").read_text(encoding="utf-8")

    for directory in (plain, spaced, escaped, reordered):
        assert digest_of_directory(directory) == DIGEST


def test_the_accepted_record_is_not_part_of_the_digest():
    """The record holds the digest, so it cannot be hashed with the tables (F.2)."""
    without = {key: value for key, value in ERAS.items() if key != "accepted"}
    other = {**ERAS, "accepted": {"by": "someone else", "on": "2027-01-01"}}

    assert digest_of(REGIONS, without, KEYWORDS) == DIGEST
    assert digest_of(REGIONS, other, KEYWORDS) == DIGEST
    # Only the top-level member of `eras.json` is removed. A member of that name elsewhere is data.
    assert digest_of({**REGIONS, "accepted": 1}, ERAS, KEYWORDS) != DIGEST
    assert "accepted" in ERAS, "digest_of must not change the table it is handed"


@pytest.mark.parametrize(
    ("table", "path", "value"),
    [
        ("regions", ("regions", 0, "name"), "Aether Vale"),
        ("regions", ("regions", 0, "anchor"), [300, -600]),
        ("eras", ("eras", 0, "sets"), ["bro", "atq"]),
        ("eras", ("eras", 0, "name"), "The Brothers' War — 兄弟戦争"),
        ("eras", ("kind",), "product"),
        ("keywords", ("keywords", 0, "region"), "elsewhere"),
        ("keywords", ("keywords", 0, "word"), "Suq'ata"),
    ],
    ids=[
        "a value",
        "an array re-ordered (anchor)",
        "an array re-ordered (sets)",
        "one character (a typographic apostrophe)",
        "the kind",
        "a keyword's region",
        "one letter's case",
    ],
)
def test_any_edit_to_a_value_moves_the_digest(table: str, path: tuple[kit.Step, ...], value: Any):
    """F.2: "Any edit to any value, any re-ordering of an array ... changes the digest"."""
    tables: dict[str, Any] = {
        "regions": json.loads(json.dumps(REGIONS)),
        "eras": json.loads(json.dumps(ERAS)),
        "keywords": json.loads(json.dumps(KEYWORDS)),
    }
    assert digest_of(tables["regions"], tables["eras"], tables["keywords"]) == DIGEST
    kit.edit(tables[table], path, value)

    assert digest_of(tables["regions"], tables["eras"], tables["keywords"]) != DIGEST


def test_a_row_added_moves_the_digest():
    keywords = json.loads(json.dumps(KEYWORDS))
    keywords["keywords"].append({"word": "Shivan", "region": "aether"})

    assert digest_of(REGIONS, ERAS, keywords) != DIGEST


def test_a_value_moved_between_files_moves_the_digest():
    """The files are concatenated in a fixed order, so swapping two of them is an edit."""
    assert digest_of(KEYWORDS, ERAS, REGIONS) != DIGEST


def test_a_change_to_a_source_moves_the_digest(tmp_path: Path):
    before = kit.validate(kit.write(tmp_path / "before")).digest
    eras = kit.eras()
    eras["eras"][0]["paragraphs"][0][0]["source"] = "https://mtg.wiki/page/Dominaria"

    assert kit.validate(kit.write(tmp_path / "after", eras_table=eras)).digest != before


# --- the acceptance status ------------------------------------------------------------------


def test_the_status_is_accepted_stale_or_absent():
    assert status_of(None, DIGEST) is AcceptanceStatus.ABSENT
    assert status_of(DIGEST, DIGEST) is AcceptanceStatus.ACCEPTED
    assert status_of("sha256:" + "0" * 64, DIGEST) is AcceptanceStatus.STALE


def _accepted(digest: str) -> dict[str, str]:
    return {"by": "owner", "on": "2026-10-20", "issue": "DEC-1002", "digest": digest}


def test_tables_with_no_record_are_absent(tmp_path: Path):
    tables = kit.validate(kit.write(tmp_path))

    assert tables.status is AcceptanceStatus.ABSENT
    assert tables.recorded_digest is None


def test_tables_whose_record_names_their_digest_are_accepted(tmp_path: Path):
    """The owner's flow: validate, read the digest, record it, validate again."""
    digest = kit.validate(kit.write(tmp_path)).digest
    eras = kit.eras()
    eras["accepted"] = _accepted(digest)

    tables = kit.validate(kit.write(tmp_path, eras_table=eras))

    assert tables.status is AcceptanceStatus.ACCEPTED
    assert tables.digest == digest == tables.recorded_digest
    assert digest_of_directory(tmp_path / "dominaria") == digest


def test_tables_edited_after_acceptance_are_stale_and_still_valid(tmp_path: Path):
    """F.2: the status is distinct from validity. A stale record builds in development."""
    digest = kit.validate(kit.write(tmp_path)).digest
    eras = kit.eras()
    eras["accepted"] = _accepted(digest)
    eras["eras"][0]["name"] = "Daybreak"  # one word changed after the owner accepted

    tables = kit.validate(kit.write(tmp_path, eras_table=eras))

    assert tables.status is AcceptanceStatus.STALE
    assert tables.recorded_digest == digest
    assert tables.digest != digest


def test_an_edit_to_another_file_makes_the_record_stale(tmp_path: Path):
    """The record lives in `eras.json` and covers all three files."""
    digest = kit.validate(kit.write(tmp_path)).digest
    eras = kit.eras()
    eras["accepted"] = _accepted(digest)
    keywords = kit.keywords()
    keywords["keywords"].append({"word": "Delta", "region": "south"})

    tables = kit.validate(kit.write(tmp_path, eras_table=eras, keywords_table=keywords))

    assert tables.status is AcceptanceStatus.STALE


# --- a digest is defined only on the JSON of F.0 ---------------------------------------------


def test_the_digest_of_a_directory_with_a_missing_file_is_refused(tmp_path: Path):
    directory = _write(tmp_path)
    (directory / "keywords.json").unlink()

    with pytest.raises(DigestError, match=r"keywords\.json does not exist"):
        digest_of_directory(directory)


@pytest.mark.parametrize(
    ("text", "says"),
    [
        ('{"plane": "dominaria", "regions": [{"weight": 1000.0}]}', r"regions\[0\]\.weight"),
        ('{"plane": "dominaria", "regions": [{"weight": 1e3}]}', "no exponent"),
        ('{"plane": "dominaria", "regions": [{"weight": -0}]}', "negative zero"),
        ('{"plane": "dominaria", "regions": [{"weight": +1}]}', "leading plus"),
        ('{"plane": "dominaria", "plane": "ravnica"}', "written twice"),
        ('{"plane": "domin\\ud800aria"}', "surrogate"),
        ('{"plane": "dominaria"', "not valid JSON"),
    ],
)
def test_the_digest_of_a_file_outside_f0_is_refused(tmp_path: Path, text: str, says: str):
    """F.0 gives every value one spelling, and the canonical form is only defined there.

    `1000.0` and `1000` would otherwise be two files with two digests for one table.
    """
    directory = _write(tmp_path)
    (directory / "regions.json").write_text(text, encoding="utf-8")

    with pytest.raises(DigestError, match=says):
        digest_of_directory(directory)
