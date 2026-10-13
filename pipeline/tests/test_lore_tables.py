"""The lore table rules of PRD v4 4.16.2 and Appendix F.0 to F.4.

PRD 8.8.1 names six negatives: an unmapped set, a set in two eras, a sentence without a source, a
source off the allowlist, anchors too close, a fourth kit. They come first, and each asserts the
one problem it is about by its rule, its file, its row and its field, because 4.16.2 fails the
build "with the row named" and a negative that fails for a neighbouring reason proves nothing.

The dataset is ``lore_kit.INDEX``, a hand-built one. The positive run on the real tables is the
schema example of Appendix F.5, in ``test_lore_example``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import lore_kit as kit
from lore_kit import oracle, printing_id

from eternities.lore.digest import AcceptanceStatus
from eternities.lore.problems import LoreValidationError, Rule

# --- the tables validate before any of them is broken ---------------------------------------


def test_the_valid_tables_validate(tmp_path: Path):
    """The baseline every negative below changes by one value."""
    tables = kit.validate(kit.write(tmp_path))

    assert tables.slug == "dominaria"
    assert tables.kind == "lore"
    assert tables.status is AcceptanceStatus.ABSENT


# --- the six negatives of PRD 8.8.1 ---------------------------------------------------------


def test_an_unmapped_set_fails_naming_the_set(tmp_path: Path):
    """4.16.2: every set with first printings on the plane appears in exactly one era."""
    eras = kit.eras()
    eras["eras"][1]["sets"] = ["bbb"]
    eras["eras"][2]["sets"] = ["ccc"]  # `ddd` is now in no era

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.SET_UNMAPPED
    assert (problem.file, problem.row, problem.field) == ("eras.json", "", "eras")
    assert "'ddd'" in problem.message


def test_a_set_in_two_eras_fails_naming_the_set_and_both_eras(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][2]["sets"] = ["ddd", "aaa"]  # `aaa` is the first era's

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.SET_IN_TWO_ERAS
    assert (problem.file, problem.row, problem.field) == ("eras.json", 'eras[2] "dusk"', "sets")
    assert "'aaa'" in problem.message
    assert 'eras[0] "dawn"' in problem.message


@pytest.mark.parametrize(
    "broken",
    [
        {"text": "The first people came by sea."},
        {"text": "The first people came by sea.", "source": ""},
        {"text": "The first people came by sea.", "source": "   "},
        {"text": "The first people came by sea.", "source": None},
    ],
    ids=["no source field", "empty source", "blank source", "null source"],
)
def test_a_sentence_without_a_source_fails_naming_the_sentence(
    tmp_path: Path, broken: dict[str, Any]
):
    """4.16.2: "every sentence has a source"."""
    eras = kit.eras()
    eras["eras"][1]["paragraphs"] = [[kit.sentence(), broken]]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.SENTENCE_WITHOUT_SOURCE
    assert problem.file == "eras.json"
    assert problem.row == 'eras[1] "noon"'
    assert problem.field == "paragraphs[0][1].source"


def test_a_region_sentence_without_a_source_fails_too(tmp_path: Path):
    regions = kit.regions()
    del regions["regions"][3]["sentence"]["source"]

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.SENTENCE_WITHOUT_SOURCE
    assert (problem.file, problem.row) == ("regions.json", 'regions[3] "west"')
    assert problem.field == "sentence.source"


@pytest.mark.parametrize(
    "locator",
    [
        "https://en.wikipedia.org/wiki/Dominaria",
        "https://mtg.fandom.com/wiki/Dominaria",
        # A host is validated by parsing the URL, never by a substring match (F.4).
        "https://magic.wizards.com.example.org/en/story",
        "https://example.org/magic.wizards.com/en/story",
        "https://example.org/?next=https://mtg.wiki/page/Shiv",
        "https://notmtg.wiki/page/Shiv",
        "https://www.scryfall.com/sets/dom",
        # Spellings where a parser and a browser can disagree about the host.
        "https://magic.wizards.com@example.org/en/story",
        "https://example.org\\@magic.wizards.com/en/story",
        "https://magic.wizards.com:8443/en/story",
        "https://MAGIC.WIZARDS.COM/en/story",
        "https://scryfall.com /sets/dom",
        # The scheme is https and nothing else.
        "http://mtg.wiki/page/Shiv",
        "HTTPS://mtg.wiki/page/Shiv",
        "//mtg.wiki/page/Shiv",
        "mtg.wiki/page/Shiv",
        # The site and no page.
        "https://mtg.wiki",
        "https://mtg.wiki/",
        # Not one of the five forms.
        "the Dominaria story, part 3",
        "card:not-a-uuid",
        "card:0000000A-0000-4000-8000-000000000001",  # upper case is a second spelling
        f"printing:{printing_id(1)}",
        f"printing:{printing_id(1)}#side",
        "https://[mtg.wiki/page/Shiv",
    ],
)
def test_a_source_off_the_allowlist_fails_naming_the_source(tmp_path: Path, locator: str):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"][0][0]["source"] = locator

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.SOURCE_OFF_ALLOWLIST
    assert (problem.file, problem.row) == ("eras.json", 'eras[0] "dawn"')
    assert problem.field == "paragraphs[0][0].source"
    assert repr(locator) in problem.message


def test_a_source_off_the_allowlist_in_a_regions_sources_list_fails(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][0]["sources"] = [kit.WIZARDS, "https://example.org/dominaria"]

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.SOURCE_OFF_ALLOWLIST
    assert (problem.row, problem.field) == ('regions[0] "north"', "sources[1]")


def test_anchors_too_close_fail_naming_both_regions(tmp_path: Path):
    """4.16.2: anchors pairwise at least 150 apart. 149 apart fails."""
    regions = kit.regions()
    regions["regions"][1]["anchor"] = [149, 500]  # `north` is at [0, 500]

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.ANCHORS_TOO_CLOSE
    assert (problem.file, problem.row, problem.field) == (
        "regions.json",
        'regions[1] "east"',
        "anchor",
    )
    assert 'regions[0] "north"' in problem.message


def test_anchors_exactly_150_apart_pass(tmp_path: Path):
    """The bound is "at least 150": 150 passes, on an axis and on a 90-120-150 triangle."""
    regions = kit.regions()
    regions["regions"][1]["anchor"] = [150, 500]
    regions["regions"][3]["anchor"] = [-90, 380]  # (-90, -120) from `north`: exactly 150

    kit.validate(kit.write(tmp_path, regions_table=regions))


def test_a_fourth_kit_fails_naming_the_region_that_adds_it(tmp_path: Path):
    """4.16.2 and 11.18: at most three distinct kits across an entry's regions."""
    regions = kit.regions()  # temperate, coast, volcanic, temperate
    regions["regions"][3]["kit"] = "forest"

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.FOURTH_KIT
    assert (problem.file, problem.row, problem.field) == (
        "regions.json",
        'regions[3] "west"',
        "kit",
    )
    assert "'forest'" in problem.message
    assert "temperate, coast, volcanic" in problem.message


# --- F.0: exactly the fields, with their types ----------------------------------------------


def test_an_unknown_field_fails_naming_the_file_and_the_field(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][2]["colour"] = "red"

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.UNKNOWN_FIELD
    assert (problem.file, problem.row, problem.field) == (
        "regions.json",
        'regions[2] "south"',
        "colour",
    )


@pytest.mark.parametrize("field", ["id", "name", "kit", "anchor", "weight", "water", "sources"])
def test_a_missing_required_region_field_fails(tmp_path: Path, field: str):
    regions = kit.regions()
    del regions["regions"][1][field]

    found = kit.problems(kit.write(tmp_path, regions_table=regions))

    missing = [p for p in found if p.rule is Rule.MISSING_FIELD]
    assert [(p.file, p.field) for p in missing] == [("regions.json", field)]


@pytest.mark.parametrize(
    "field", ["id", "name", "years", "region", "sets", "headline", "paragraphs"]
)
def test_a_missing_required_era_field_fails(tmp_path: Path, field: str):
    eras = kit.eras()
    del eras["eras"][0][field]

    found = kit.problems(kit.write(tmp_path, eras_table=eras))

    # A row is named by its position and its id, and this row may have just lost its id.
    row = "eras[0]" if field == "id" else 'eras[0] "dawn"'
    missing = [p for p in found if p.rule is Rule.MISSING_FIELD]
    assert [(p.file, p.row, p.field) for p in missing] == [("eras.json", row, field)]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", 7),
        ("name", ["North"]),
        ("weight", "1000"),
        ("weight", True),
        ("anchor", "0,500"),
        ("anchor", [0, 500, 0]),
        ("anchor", [0, "500"]),
        ("anchor", [True, False]),
        ("sentence", "A sentence."),
        ("sources", kit.WIZARDS),
        ("sources", [7]),
        ("set_piece", 3),
    ],
)
def test_a_wrong_type_fails_naming_the_field(tmp_path: Path, field: str, value: Any):
    regions = kit.regions()
    regions["regions"][0][field] = value

    found = kit.problems(kit.write(tmp_path, regions_table=regions))

    assert Rule.WRONG_TYPE in {p.rule for p in found}
    wrong = next(p for p in found if p.rule is Rule.WRONG_TYPE)
    assert wrong.file == "regions.json"
    assert wrong.field.startswith(field)


def test_a_file_that_is_not_one_object_fails(tmp_path: Path):
    directory = kit.write(tmp_path)
    (directory / "keywords.json").write_text("[]", encoding="utf-8")

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.WRONG_TYPE, "keywords.json")


def test_a_row_that_is_not_an_object_fails(tmp_path: Path):
    regions = kit.regions()
    regions["regions"].append("a region")
    eras = kit.eras()
    eras["eras"].append("an era")
    keywords = kit.keywords()
    keywords["keywords"].append(["Shivan", "south"])

    found = kit.problems(
        kit.write(tmp_path, regions_table=regions, eras_table=eras, keywords_table=keywords)
    )

    assert sorted((p.rule, p.file, p.row) for p in found) == [
        (Rule.WRONG_TYPE, "eras.json", "eras[3]"),
        (Rule.WRONG_TYPE, "keywords.json", "keywords[1]"),
        (Rule.WRONG_TYPE, "regions.json", "regions[4]"),
    ]


def test_a_missing_file_fails_naming_the_file(tmp_path: Path):
    directory = kit.write(tmp_path)
    (directory / "keywords.json").unlink()

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.MISSING_FILE, "keywords.json")


def test_text_that_is_not_json_fails_with_the_line_and_the_column(tmp_path: Path):
    directory = kit.write(tmp_path)
    (directory / "eras.json").write_text('{"plane": "dominaria",\n "kind" "lore"}', "utf-8")

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.NOT_JSON, "eras.json")
    assert "line 2 column 9" in problem.message


def test_bytes_that_are_not_utf8_fail(tmp_path: Path):
    """F.0: "Every file is UTF-8 JSON"."""
    directory = kit.write(tmp_path)
    (directory / "regions.json").write_bytes('{"plane": "dominária"}'.encode("latin-1"))

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.NOT_JSON, "regions.json")
    assert "not UTF-8" in problem.message


@pytest.mark.parametrize(
    ("before", "after", "row", "field"),
    [
        ('"name": "North"', '"name": "Nor\\ud800th"', 'regions[0] "north"', "name"),
        # An id that is not text does not name its row: the message is text.
        ('"id": "north"', '"id": "nor\\ud800th"', "regions[0]", "id"),
    ],
)
def test_half_of_a_surrogate_pair_fails_naming_the_field(
    tmp_path: Path, before: str, after: str, row: str, field: str
):
    """``"\\ud800"`` is legal JSON and has no UTF-8 bytes, so the canonical form cannot hold it."""
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    assert before in text
    (directory / "regions.json").write_text(text.replace(before, after), encoding="utf-8")

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.NOT_JSON, "regions.json")
    assert (problem.row, problem.field) == (row, field)


# --- F.0: every number is an integer in plain decimal ---------------------------------------


@pytest.mark.parametrize(
    ("spelling", "says"),
    [
        ("1000.0", "no fraction"),
        ("1000.5", "no fraction"),
        ("1e3", "no exponent"),
        ("1E3", "no exponent"),
        ("10.0e2", "no exponent"),
        ("-0", "negative zero"),
        ("-0.0", "no fraction"),
        ("NaN", "not a JSON number"),
        ("Infinity", "not a JSON number"),
    ],
)
def test_a_number_that_is_not_a_plain_integer_fails_naming_the_field(
    tmp_path: Path, spelling: str, says: str
):
    """F.0: "a fraction, an exponent, a leading plus or a negative zero fails validation"."""
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    assert text.count('"weight": 1000') == 4
    (directory / "regions.json").write_text(
        text.replace('"weight": 1000', f'"weight": {spelling}', 1), encoding="utf-8"
    )

    problem = kit.only(kit.problems(directory))

    assert problem.rule is Rule.NUMBER
    assert (problem.file, problem.field) == ("regions.json", "weight")
    assert problem.row == 'regions[0] "north"'
    assert says in problem.message


def test_a_fraction_inside_an_anchor_fails_naming_the_coordinate(tmp_path: Path):
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    (directory / "regions.json").write_text(
        text.replace('"anchor": [500, 0]', '"anchor": [500.5, 0]'), encoding="utf-8"
    )

    problem = kit.only(kit.problems(directory))

    assert problem.rule is Rule.NUMBER
    assert (problem.row, problem.field) == ('regions[1] "east"', "anchor[0]")


@pytest.mark.parametrize(
    ("before", "after", "row", "field"),
    [
        ('"kind": "lore"', '"kind": 1.5', "", "kind"),
        ('"eras": [{', '"eras": [1.5, {', "", "eras[0]"),
        ('"sets": ["aaa"]', '"sets": ["aaa", 1.5]', 'eras[0] "dawn"', "sets[1]"),
        ('"headline": []', '"headline": [1.5]', 'eras[0] "dawn"', "headline[0]"),
        ('"paragraphs": [[', '"paragraphs": [1.5, [', 'eras[0] "dawn"', "paragraphs[0]"),
        ('"paragraphs": [[{', '"paragraphs": [[1.5, {', 'eras[0] "dawn"', "paragraphs[0][0]"),
        (
            '"text": "The first people came by sea."',
            '"text": 1.5',
            'eras[0] "dawn"',
            "paragraphs[0][0].text",
        ),
        (
            f'"source": "card:{oracle(1)}"',
            '"source": 1.5',
            'eras[0] "dawn"',
            "paragraphs[0][0].source",
        ),
    ],
)
def test_a_forbidden_number_is_reported_once_wherever_it_stands(
    tmp_path: Path, before: str, after: str, row: str, field: str
):
    """In place of a string, a row, a sentence or a paragraph: one message, with the path to the
    number, and no second message from the rule that would have read that member."""
    directory = kit.write(tmp_path)
    text = (directory / "eras.json").read_text(encoding="utf-8")
    assert before in text
    (directory / "eras.json").write_text(text.replace(before, after, 1), encoding="utf-8")

    numbers = [p for p in kit.problems(directory) if p.rule is Rule.NUMBER]

    assert [(p.file, p.row, p.field) for p in numbers] == [("eras.json", row, field)]
    assert not [p for p in kit.problems(directory) if p.rule is Rule.WRONG_TYPE]


def test_a_forbidden_number_in_place_of_a_region_sentence_is_reported_once(tmp_path: Path):
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    sentence = '"sentence": {"text": "A place of stone and wind.", "source": "' + kit.WIZARDS + '"}'
    assert sentence in text
    (directory / "regions.json").write_text(
        text.replace(sentence, '"sentence": -0', 1), encoding="utf-8"
    )

    problem = kit.only(kit.problems(directory))

    assert problem.rule is Rule.NUMBER
    assert (problem.row, problem.field) == ('regions[0] "north"', "sentence")


def test_a_leading_plus_fails_the_read_and_says_so(tmp_path: Path):
    """``+1000`` is not JSON at all, so it fails the read; the message names the plus."""
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    (directory / "regions.json").write_text(
        text.replace('"weight": 1000', '"weight": +1000', 1), encoding="utf-8"
    )

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.NOT_JSON, "regions.json")
    assert "leading plus" in problem.message


def test_a_leading_zero_fails_the_read(tmp_path: Path):
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    (directory / "regions.json").write_text(
        text.replace('"weight": 1000', '"weight": 01000', 1), encoding="utf-8"
    )

    problem = kit.only(kit.problems(directory))

    assert (problem.rule, problem.file) == (Rule.NOT_JSON, "regions.json")


def test_a_field_written_twice_fails_naming_the_field(tmp_path: Path):
    """The standard parser would keep the last and drop the first without a word."""
    directory = kit.write(tmp_path)
    text = (directory / "regions.json").read_text(encoding="utf-8")
    (directory / "regions.json").write_text(
        text.replace('"weight": 1000', '"weight": 1000, "weight": 900', 1), encoding="utf-8"
    )

    problem = kit.only(kit.problems(directory))

    assert problem.rule is Rule.DUPLICATE_FIELD
    assert (problem.row, problem.field) == ('regions[0] "north"', "weight")


# --- regions --------------------------------------------------------------------------------


@pytest.mark.parametrize("anchor", [[1000, 1], [708, 708], [-1001, 0], [0, -1001]])
def test_an_anchor_outside_the_unit_disc_fails(tmp_path: Path, anchor: list[int]):
    regions = kit.regions()
    regions["regions"][0]["anchor"] = anchor

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.ANCHOR_OUTSIDE_DISC
    assert (problem.row, problem.field) == ('regions[0] "north"', "anchor")


@pytest.mark.parametrize("anchor", [[1000, 0], [0, -1000], [600, 800], [-707, 707]])
def test_an_anchor_on_the_rim_of_the_disc_passes(tmp_path: Path, anchor: list[int]):
    """u^2 + v^2 <= 1,000,000: the rim is inside."""
    regions = kit.regions()
    regions["regions"] = [
        kit.region("rim", anchor),
        kit.region("centre", [0, 0]),
        kit.region("north", [0, 300]),
        kit.region("south", [0, -300]),
    ]
    eras = kit.eras()
    for row, region_id in zip(eras["eras"], ["rim", "centre", "north"], strict=True):
        row["region"] = region_id

    kit.validate(kit.write(tmp_path, regions_table=regions, eras_table=eras))


@pytest.mark.parametrize("weight", [499, 2001, 0, -1000])
def test_a_weight_outside_500_to_2000_fails(tmp_path: Path, weight: int):
    regions = kit.regions()
    regions["regions"][2]["weight"] = weight

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.WEIGHT
    assert (problem.row, problem.field) == ('regions[2] "south"', "weight")


@pytest.mark.parametrize("weight", [500, 2000])
def test_a_weight_on_either_bound_passes(tmp_path: Path, weight: int):
    regions = kit.regions()
    regions["regions"][2]["weight"] = weight

    kit.validate(kit.write(tmp_path, regions_table=regions))


@pytest.mark.parametrize(
    ("field", "value", "rule"),
    [
        ("kit", "tundra", Rule.KIT),
        ("water", "ocean", Rule.WATER),
        ("ambient", "rainforest", Rule.AMBIENT),
        ("variant", "Basalt Steppe", Rule.VARIANT),
        ("id", "North Shore", Rule.SLUG),
        ("id", "-north", Rule.SLUG),
        ("name", "", Rule.LENGTH),
        ("name", "N" * 41, Rule.LENGTH),
    ],
)
def test_a_region_value_outside_its_list_fails(tmp_path: Path, field: str, value: str, rule: Rule):
    regions = kit.regions()
    regions["regions"][0][field] = value
    eras = kit.eras()
    eras["eras"][0]["region"] = regions["regions"][0]["id"]
    keywords = kit.keywords()
    keywords["keywords"][0]["region"] = regions["regions"][0]["id"]

    problem = kit.only(
        kit.problems(
            kit.write(tmp_path, regions_table=regions, eras_table=eras, keywords_table=keywords)
        )
    )

    assert problem.rule is rule
    assert (problem.file, problem.field) == ("regions.json", field)


def test_the_optional_region_fields_are_accepted(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][2].update(
        variant="basalt-steppe", ambient="volcanic", set_piece="A cone of black glass."
    )

    tables = kit.validate(kit.write(tmp_path, regions_table=regions))

    # `kits.yaml` is not in the pipeline, so the variant's form is all that was checked, and the
    # result says which variants that leaves unchecked (see `vocabulary`).
    assert tables.unchecked_variants == ("south: volcanic/basalt-steppe",)


def test_a_duplicate_region_id_fails(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][3]["id"] = "north"

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert problem.rule is Rule.DUPLICATE_ID
    assert problem.row == 'regions[3] "north"'


def test_an_empty_sources_list_fails(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][0]["sources"] = []

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert (problem.rule, problem.field) == (Rule.ROW_COUNT, "sources")


@pytest.mark.parametrize(("rows", "passes"), [(3, False), (4, True), (12, True), (13, False)])
def test_the_region_table_takes_4_to_12_rows(tmp_path: Path, rows: int, passes: bool):
    regions = kit.regions()
    # A ring of radius 900 holds thirteen anchors more than 150 apart.
    ring = [
        (900, 0),
        (797, 418),
        (511, 741),
        (108, 893),
        (-319, 841),
        (-674, 596),
        (-874, 215),
        (-874, -215),
        (-674, -596),
        (-319, -841),
        (108, -893),
        (511, -741),
        (797, -418),
    ]
    regions["regions"] = [kit.region(f"r{n}", list(ring[n])) for n in range(rows)]
    eras = kit.eras()
    for row in eras["eras"]:
        row["region"] = "r0"
    keywords: dict[str, Any] = {"plane": "dominaria", "keywords": []}
    directory = kit.write(tmp_path, regions_table=regions, eras_table=eras, keywords_table=keywords)

    if passes:
        kit.validate(directory)
    else:
        problem = kit.only(kit.problems(directory))
        assert (problem.rule, problem.file, problem.field) == (
            Rule.ROW_COUNT,
            "regions.json",
            "regions",
        )


# --- the plane's identity (F.0) -------------------------------------------------------------


def test_a_plane_field_that_differs_from_the_directory_fails(tmp_path: Path):
    keywords = kit.keywords()
    keywords["plane"] = "ravnica"

    problem = kit.only(kit.problems(kit.write(tmp_path, keywords_table=keywords)))

    assert (problem.rule, problem.file, problem.field) == (
        Rule.PLANE_IDENTITY,
        "keywords.json",
        "plane",
    )


def test_a_directory_that_is_not_a_hero_entry_fails_once(tmp_path: Path):
    """F.0: ``plane`` must match "an Appendix C.1 row with ``hero: true``"."""
    tables = [kit.regions(), kit.eras(), kit.keywords()]
    for table in tables:
        table["plane"] = "ravnica"
    directory = kit.write(
        tmp_path,
        regions_table=tables[0],
        eras_table=tables[1],
        keywords_table=tables[2],
        slug="ravnica",
    )

    found = kit.problems(directory)

    identity = [p for p in found if p.rule is Rule.PLANE_IDENTITY]
    assert len(identity) == 1
    assert "not one of the twenty hero entries" in identity[0].message


# --- eras -----------------------------------------------------------------------------------


def test_an_era_in_a_region_that_does_not_exist_fails(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][1]["region"] = "atlantis"

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.ERA_REGION
    assert (problem.row, problem.field) == ('eras[1] "noon"', "region")


def test_a_set_with_no_first_printings_on_the_plane_fails(tmp_path: Path):
    """`rrr` is Ravnica's set. The message lists the codes the pipeline expects for the plane."""
    eras = kit.eras()
    eras["eras"][0]["sets"] = ["aaa", "rrr"]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.SET_NOT_ON_PLANE
    assert (problem.row, problem.field) == ('eras[0] "dawn"', "sets")
    assert "aaa, bbb, ccc, ddd" in problem.message


def test_a_set_listed_twice_in_one_era_fails(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["sets"] = ["aaa", "aaa"]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.SET_IN_TWO_ERAS
    assert "this era, twice" in problem.message


def test_an_era_with_no_set_fails(tmp_path: Path):
    """4.16.2: "an era names at least one set". The set it dropped is then unmapped too."""
    eras = kit.eras()
    eras["eras"][2]["sets"] = []

    found = kit.problems(kit.write(tmp_path, eras_table=eras))

    assert sorted(p.rule for p in found) == [Rule.ROW_COUNT, Rule.SET_UNMAPPED]


@pytest.mark.parametrize(("rows", "passes"), [(2, False), (3, True), (4, True)])
def test_the_era_table_takes_at_least_3_rows(tmp_path: Path, rows: int, passes: bool):
    eras = kit.eras()
    if rows == 2:
        eras["eras"] = [
            kit.era("dawn", "north", ["aaa", "bbb"]),
            kit.era("dusk", "south", ["ccc", "ddd"]),
        ]
    elif rows == 4:
        eras["eras"] = [
            kit.era(f"era-{code}", "north", [code]) for code in ["aaa", "bbb", "ccc", "ddd"]
        ]
    directory = kit.write(tmp_path, eras_table=eras)

    if passes:
        kit.validate(directory)
    else:
        problem = kit.only(kit.problems(directory))
        assert (problem.rule, problem.file, problem.field) == (Rule.ROW_COUNT, "eras.json", "eras")


def test_the_era_table_takes_at_most_16_rows():
    """Sixteen is the lore ceiling and twenty-four the product one (F.0).

    The kit's plane has four sets, so seventeen eras cannot each name one; the ceiling is asserted
    on the constants the row count is checked against.
    """
    from eternities.lore import tables

    assert tables.ERA_ROWS == (3, 16)
    assert tables.PRODUCT_ERA_ROWS == (3, 24)
    assert tables.REGION_ROWS == (4, 12)


def test_a_headline_name_resolves_to_a_card_first_printed_in_the_eras_sets(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][1]["headline"] = ["Beta One", "Gamma One"]  # first printed in bbb and ccc

    kit.validate(kit.write(tmp_path, eras_table=eras))


@pytest.mark.parametrize(
    ("name", "why"),
    [
        ("Nobody At All", "no card of dataset synthetic has that name"),
        # Alpha One is first printed in `aaa`; the era's sets are `bbb` and `ccc`.
        ("Alpha One", "first printed in 'aaa' on dominaria"),
        # Rho One has a printing in a Dominaria set and stands on Ravnica.
        ("Rho One", "first printed in 'rrr' on ravnica"),
        # The second face's name is not the card's name.
        ("Gamma Other", "no card of dataset synthetic has that name"),
    ],
)
def test_a_headline_name_that_does_not_resolve_fails(tmp_path: Path, name: str, why: str):
    eras = kit.eras()
    eras["eras"][1]["headline"] = [name]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.HEADLINE
    assert (problem.row, problem.field) == ('eras[1] "noon"', "headline[0]")
    assert why in problem.message


def test_a_headline_name_two_cards_of_the_era_carry_does_not_resolve(tmp_path: Path):
    """A name is not an identifier: Scryfall reuses one across distinct cards. The kit's dataset
    with a second "Alpha One" first printed in the same set."""
    from eternities.lore.index import _Builder
    from eternities.lore.problems import LoreValidationError
    from eternities.lore.tables import validate_directory

    builder = _Builder("twins")
    builder.plane("dominaria", ["aaa", "bbb", "ccc", "ddd"])
    for n, code in [(1, "aaa"), (2, "bbb"), (3, "ccc"), (4, "ddd"), (6, "aaa")]:
        builder.card(
            "dominaria",
            oracle_id=oracle(n),
            name="Alpha One" if n in (1, 6) else f"Card {n}",
            back_name=None,
            printings=[(printing_id(n), code, str(n))],
        )
    eras = kit.eras()
    eras["eras"][0]["headline"] = ["Alpha One"]

    with pytest.raises(LoreValidationError) as raised:
        validate_directory(
            kit.write(tmp_path, eras_table=eras), builder.build(), hero_entries=kit.HEROES
        )

    problem = kit.only(raised.value.problems)
    assert problem.rule is Rule.HEADLINE
    assert "2 cards of the era carry that name" in problem.message


def test_a_reprint_in_the_eras_sets_is_not_a_first_printing(tmp_path: Path):
    """Alpha One is reprinted in `ddd`. "First printed in the era's sets" is not "printed in"."""
    eras = kit.eras()
    eras["eras"][2]["headline"] = ["Alpha One"]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.HEADLINE


def test_a_headline_takes_at_most_six_names_and_no_name_twice(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][1]["headline"] = ["Beta One"] * 7

    found = kit.problems(kit.write(tmp_path, eras_table=eras))

    assert {p.rule for p in found} == {Rule.ROW_COUNT, Rule.HEADLINE}
    assert sum(1 for p in found if "listed twice" in p.message) == 6


def test_a_headline_must_be_empty_when_the_eras_sets_carry_story_spotlight_cards(tmp_path: Path):
    """F.0: "empty when the sets carry Story Spotlight cards (5.13.2)"."""
    eras = kit.eras()
    eras["eras"][1]["headline"] = ["Beta One"]
    directory = kit.write(tmp_path, eras_table=eras)

    problem = kit.only(kit.problems(directory, spotlight_sets=frozenset({"ccc"})))

    assert problem.rule is Rule.HEADLINE_WITH_SPOTLIGHT
    assert (problem.row, problem.field) == ('eras[1] "noon"', "headline")

    # Spotlight cards in another era's set do not empty this one, and with no sidecar for the
    # entry the rule cannot be checked at all.
    kit.validate(directory, spotlight_sets=frozenset({"ddd"}))
    kit.validate(directory, spotlight_sets=None)


@pytest.mark.parametrize(("count", "passes"), [(0, False), (1, True), (3, True), (4, False)])
def test_an_era_takes_one_to_three_paragraphs(tmp_path: Path, count: int, passes: bool):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[kit.sentence()] for _ in range(count)]
    directory = kit.write(tmp_path, eras_table=eras)

    if passes:
        kit.validate(directory)
    else:
        problem = kit.only(kit.problems(directory))
        assert (problem.rule, problem.field) == (Rule.PARAGRAPH_COUNT, "paragraphs")


@pytest.mark.parametrize(("count", "passes"), [(0, False), (1, True), (6, True), (7, False)])
def test_a_paragraph_takes_one_to_six_sentences(tmp_path: Path, count: int, passes: bool):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[kit.sentence() for _ in range(count)]]
    directory = kit.write(tmp_path, eras_table=eras)

    if passes:
        kit.validate(directory)
    else:
        problem = kit.only(kit.problems(directory))
        assert (problem.rule, problem.field) == (Rule.SENTENCE_COUNT, "paragraphs[0]")


def test_a_paragraph_that_is_not_an_array_fails(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [kit.sentence()]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert (problem.rule, problem.field) == (Rule.WRONG_TYPE, "paragraphs[0]")


def test_a_sentence_takes_at_most_40_words(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[kit.sentence(" ".join(["word"] * 40))]]
    directory = kit.write(tmp_path, eras_table=eras)
    kit.validate(directory)

    eras["eras"][0]["paragraphs"] = [[kit.sentence(" ".join(["word"] * 41))]]
    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.WORD_LIMIT
    assert problem.field == "paragraphs[0][0].text"
    assert "41 words" in problem.message


def test_an_era_takes_at_most_300_words(tmp_path: Path):
    """Seventeen 16-word sentences and one of 28 are 300 words; one more word is 301."""
    eras = kit.eras()
    sixteen = " ".join(["word"] * 16)
    eras["eras"][0]["paragraphs"] = [[kit.sentence(sixteen) for _ in range(6)] for _ in range(3)]
    eras["eras"][0]["paragraphs"][2][5] = kit.sentence(" ".join(["word"] * 28))
    directory = kit.write(tmp_path, eras_table=eras)
    kit.validate(directory)  # 17 x 16 + 28 = 300

    eras["eras"][0]["paragraphs"][2][5] = kit.sentence(" ".join(["word"] * 29))
    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.WORD_LIMIT
    assert problem.field == "paragraphs"
    assert "301 words" in problem.message


def test_a_region_sentence_takes_at_most_40_words(tmp_path: Path):
    regions = kit.regions()
    regions["regions"][0]["sentence"] = kit.sentence(" ".join(["word"] * 41))

    problem = kit.only(kit.problems(kit.write(tmp_path, regions_table=regions)))

    assert (problem.rule, problem.field) == (Rule.WORD_LIMIT, "sentence.text")


def test_an_empty_sentence_fails(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[kit.sentence("  ")]]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert (problem.rule, problem.field) == (Rule.LENGTH, "paragraphs[0][0].text")


def test_a_sentence_object_takes_text_and_source_and_nothing_else(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [
        [{"text": "A sentence.", "source": kit.WIZARDS, "note": "check"}, "A bare sentence."]
    ]

    found = kit.problems(kit.write(tmp_path, eras_table=eras))

    assert sorted((p.rule, p.field) for p in found) == [
        (Rule.UNKNOWN_FIELD, "paragraphs[0][0].note"),
        (Rule.WRONG_TYPE, "paragraphs[0][1]"),
    ]


def test_a_sentence_text_or_source_of_the_wrong_type_fails(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[{"text": 7, "source": ["a"]}, {"source": kit.WIZARDS}]]

    found = kit.problems(kit.write(tmp_path, eras_table=eras))

    assert sorted((p.rule, p.field) for p in found) == [
        (Rule.MISSING_FIELD, "paragraphs[0][1].text"),
        (Rule.WRONG_TYPE, "paragraphs[0][0].source"),
        (Rule.WRONG_TYPE, "paragraphs[0][0].text"),
    ]


def test_years_take_one_to_twenty_words(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["years"] = " ".join(["long"] * 21)

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert (problem.rule, problem.field) == (Rule.WORD_LIMIT, "years")


def test_an_era_name_takes_1_to_60_characters(tmp_path: Path):
    eras = kit.eras()
    eras["eras"][0]["name"] = "N" * 61

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert (problem.rule, problem.field) == (Rule.LENGTH, "name")


# --- the presentation lint of 9.1.6 ---------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "The war was a game to the brothers.",
        "Every player in the war lost.",
        "The Players of Benalia kept the old songs.",
        "It was a GAME.",
        "Two games of stones decided the border.",
        "The war's end-game came at Argoth.",
    ],
)
def test_the_presentation_lint_refuses_game_and_player(tmp_path: Path, text: str):
    """9.1.6: "no use of the word 'game' or 'player' in authored interface text"."""
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[kit.sentence(text)]]

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.PRESENTATION_LINT
    assert problem.field == "paragraphs[0][0].text"


@pytest.mark.parametrize(
    "text",
    ["The gamekeeper of Llanowar kept the wood.", "A displayer of relics stood at the gate."],
)
def test_the_presentation_lint_reads_whole_words(tmp_path: Path, text: str):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"] = [[kit.sentence(text)]]

    kit.validate(kit.write(tmp_path, eras_table=eras))


def test_the_presentation_lint_reads_names_years_and_the_region_sentence(tmp_path: Path):
    """Every string a visitor sees. ``set_piece`` is never shown (F.0) and is not read."""
    regions = kit.regions()
    regions["regions"][0]["name"] = "The Player's Rest"
    regions["regions"][1]["sentence"] = kit.sentence("A game of tides.")
    regions["regions"][2]["set_piece"] = "A game board cut into the rock."
    eras = kit.eras()
    eras["eras"][0]["name"] = "The Great Game"
    eras["eras"][1]["years"] = "When the players left"

    found = kit.problems(kit.write(tmp_path, regions_table=regions, eras_table=eras))

    assert {p.rule for p in found} == {Rule.PRESENTATION_LINT}
    assert sorted((p.file, p.field) for p in found) == [
        ("eras.json", "name"),
        ("eras.json", "years"),
        ("regions.json", "name"),
        ("regions.json", "sentence.text"),
    ]


# --- sources resolved against the dataset (F.4) ---------------------------------------------


@pytest.mark.parametrize(
    "locator",
    [
        "https://magic.wizards.com/en/story/the-brothers-war",
        "https://magic.wizards.com/en/planes/dominaria",
        "https://scryfall.com/sets/dom",
        "https://scryfall.com/card/dom/1/karn-scion-of-urza",
        "https://mtg.wiki/page/Shiv",
        "https://mtg.wiki/page/Suq%27Ata_Empire?action=view#History",
        f"card:{oracle(1)}",
        f"card:{oracle(5)}",  # a card of the dataset, on any plane
        f"printing:{printing_id(1)}#front",
        f"printing:{printing_id(101)}#front",  # a reprint is a printing
        f"printing:{printing_id(3)}#back",  # Gamma One has a second face
    ],
)
def test_each_of_the_five_source_forms_validates(tmp_path: Path, locator: str):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"][0][0]["source"] = locator

    kit.validate(kit.write(tmp_path, eras_table=eras))


@pytest.mark.parametrize(
    ("locator", "rule"),
    [
        (f"card:{oracle(999)}", Rule.SOURCE_NOT_IN_DATASET),
        # A printing id is not a card id, and a card id is not a printing id.
        (f"card:{printing_id(1)}", Rule.SOURCE_NOT_IN_DATASET),
        (f"printing:{oracle(1)}#front", Rule.SOURCE_NOT_IN_DATASET),
        (f"printing:{printing_id(999)}#back", Rule.SOURCE_NOT_IN_DATASET),
        # Alpha One has one face.
        (f"printing:{printing_id(1)}#back", Rule.SOURCE_FACE),
    ],
)
def test_a_card_or_printing_source_is_checked_against_the_dataset(
    tmp_path: Path, locator: str, rule: Rule
):
    eras = kit.eras()
    eras["eras"][0]["paragraphs"][0][0]["source"] = locator

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is rule
    assert problem.field == "paragraphs[0][0].source"


# --- keywords -------------------------------------------------------------------------------


def test_a_keyword_shorter_than_three_characters_fails(tmp_path: Path):
    keywords = kit.keywords()
    keywords["keywords"].append({"word": "Ur", "region": "east"})

    problem = kit.only(kit.problems(kit.write(tmp_path, keywords_table=keywords)))

    assert problem.rule is Rule.KEYWORD
    assert (problem.file, problem.row, problem.field) == (
        "keywords.json",
        'keywords[1] "Ur"',
        "word",
    )


def test_a_keyword_naming_a_region_that_does_not_exist_fails(tmp_path: Path):
    keywords = kit.keywords()
    keywords["keywords"].append({"word": "Shivan", "region": "shiv"})

    problem = kit.only(kit.problems(kit.write(tmp_path, keywords_table=keywords)))

    assert problem.rule is Rule.KEYWORD_REGION
    assert (problem.row, problem.field) == ('keywords[1] "Shivan"', "region")


def test_a_word_maps_to_exactly_one_region(tmp_path: Path):
    """F.3. The match is case-folded (5.4.3), so `ALPHA` is `Alpha` again."""
    keywords = kit.keywords()
    keywords["keywords"].append({"word": "ALPHA", "region": "east"})

    problem = kit.only(kit.problems(kit.write(tmp_path, keywords_table=keywords)))

    assert problem.rule is Rule.KEYWORD_DUPLICATE


def test_an_empty_keyword_table_and_a_two_word_keyword_validate(tmp_path: Path):
    kit.validate(kit.write(tmp_path, keywords_table={"plane": "dominaria", "keywords": []}))
    two = {"plane": "dominaria", "keywords": [{"word": "Ice Age", "region": "north"}]}
    kit.validate(kit.write(tmp_path, keywords_table=two))


# --- product tables (F.2) -------------------------------------------------------------------


def _product() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
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
    return regions, eras, {"plane": "blind-eternities", "keywords": []}


def _write_product(
    root: Path, regions: dict[str, Any], eras: dict[str, Any], keywords: dict[str, Any]
) -> Path:
    return kit.write(
        root,
        regions_table=regions,
        eras_table=eras,
        keywords_table=keywords,
        slug="blind-eternities",
    )


def test_a_valid_product_table_validates(tmp_path: Path):
    tables = kit.validate(_write_product(tmp_path, *_product()))

    assert tables.kind == "product"


def test_a_product_tables_keyword_table_must_be_empty(tmp_path: Path):
    regions, eras, keywords = _product()
    keywords["keywords"] = [{"word": "Commander", "region": "north"}]

    problem = kit.only(kit.problems(_write_product(tmp_path, regions, eras, keywords)))

    assert (problem.rule, problem.file) == (Rule.PRODUCT_KEYWORDS, "keywords.json")


def test_a_product_eras_sets_lie_in_its_familys_list(tmp_path: Path):
    regions, eras, keywords = _product()
    eras["eras"][0]["region"] = "east"  # `pr1` is the north family's

    problem = kit.only(kit.problems(_write_product(tmp_path, regions, eras, keywords)))

    assert problem.rule is Rule.PRODUCT_ERA_SET_OUTSIDE_FAMILY
    assert (problem.file, problem.row) == ("eras.json", 'eras[0] "first"')


def test_the_families_cover_the_planes_set_codes_exactly_once(tmp_path: Path):
    regions, eras, keywords = _product()
    regions["regions"][2]["sets"] = ["pr3"]  # `pr4` is in no family
    regions["regions"][3]["sets"] = ["pr1"]  # `pr1` is in two

    found = kit.problems(_write_product(tmp_path, regions, eras, keywords))

    assert sorted(p.rule for p in found) == [
        Rule.PRODUCT_ERA_SET_OUTSIDE_FAMILY,
        Rule.PRODUCT_SET_IN_TWO_FAMILIES,
        Rule.PRODUCT_SET_UNMAPPED,
    ]


def test_a_family_naming_a_set_that_is_not_the_planes_fails(tmp_path: Path):
    regions, eras, keywords = _product()
    regions["regions"][3]["sets"] = ["aaa"]

    problem = kit.only(kit.problems(_write_product(tmp_path, regions, eras, keywords)))

    assert (problem.rule, problem.file) == (Rule.SET_NOT_ON_PLANE, "regions.json")


def test_a_product_region_needs_its_sets_and_a_lore_region_may_not_have_them(tmp_path: Path):
    regions, eras, keywords = _product()
    del regions["regions"][3]["sets"]
    found = kit.problems(_write_product(tmp_path, regions, eras, keywords))
    assert [(p.rule, p.field) for p in found] == [(Rule.MISSING_FIELD, "sets")]

    lore = kit.regions()
    lore["regions"][0]["sets"] = ["aaa"]
    problem = kit.only(kit.problems(kit.write(tmp_path / "lore", regions_table=lore)))
    assert (problem.rule, problem.field) == (Rule.UNKNOWN_FIELD, "sets")


def test_product_is_the_blind_eternities_kind_and_no_other_entrys(tmp_path: Path):
    """F.0: ``kind`` is "``lore``, or ``product`` for the Blind Eternities"."""
    eras = kit.eras()
    eras["kind"] = "product"
    found = kit.problems(kit.write(tmp_path / "a", eras_table=eras))
    assert Rule.KIND in {p.rule for p in found}

    regions, product_eras, keywords = _product()
    product_eras["kind"] = "lore"
    found = kit.problems(_write_product(tmp_path / "b", regions, product_eras, keywords))
    assert Rule.KIND in {p.rule for p in found}

    eras = kit.eras()
    eras["kind"] = "story"
    problem = kit.only(kit.problems(kit.write(tmp_path / "c", eras_table=eras)))
    assert (problem.rule, problem.field) == (Rule.KIND, "kind")


# --- the `accepted` record's own fields (F.0) -----------------------------------------------

_RECORD = {"by": "owner", "on": "2026-10-20", "issue": "DEC-1002", "digest": "sha256:" + "0" * 64}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("by", ""),
        ("by", "o" * 41),
        ("on", "20 October 2026"),
        ("on", "2026-10-32"),
        ("on", "2026-1-2"),
        ("issue", "DEC-"),
        ("issue", "dec-1002"),
        ("issue", "DEC-1002 "),
        ("digest", "0" * 64),
        ("digest", "sha256:" + "0" * 63),
        ("digest", "sha256:" + "A" * 64),
        ("digest", "sha256:<64 hex>"),
    ],
)
def test_an_accepted_record_with_a_malformed_field_is_invalid(
    tmp_path: Path, field: str, value: str
):
    """The record's fields and types are validity. Whether its digest matches is not (F.2)."""
    eras = kit.eras()
    eras["accepted"] = {**_RECORD, field: value}

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert problem.rule is Rule.ACCEPTED_RECORD
    assert (problem.file, problem.row, problem.field) == ("eras.json", "accepted", field)


def test_an_accepted_record_takes_exactly_its_four_fields(tmp_path: Path):
    eras = kit.eras()
    eras["accepted"] = {"by": "owner", "on": "2026-10-20", "digest": _RECORD["digest"], "ok": True}

    found = kit.problems(kit.write(tmp_path, eras_table=eras))

    assert sorted((p.rule, p.field) for p in found) == [
        (Rule.MISSING_FIELD, "issue"),
        (Rule.UNKNOWN_FIELD, "ok"),
    ]


def test_an_accepted_record_that_is_not_an_object_is_invalid(tmp_path: Path):
    eras = kit.eras()
    eras["accepted"] = "owner, 2026-10-20"

    problem = kit.only(kit.problems(kit.write(tmp_path, eras_table=eras)))

    assert (problem.rule, problem.field) == (Rule.WRONG_TYPE, "accepted")


# --- every failure is listed, and named ------------------------------------------------------


def test_every_failure_of_a_directory_is_listed_with_its_file_row_and_field(tmp_path: Path):
    """A drafter fixes a table in one pass, so validation does not stop at the first failure."""
    regions = kit.regions()
    regions["regions"][0]["weight"] = 100
    eras = kit.eras()
    eras["eras"][1]["region"] = "atlantis"
    keywords = kit.keywords()
    keywords["keywords"][0]["word"] = "Al"
    directory = kit.write(tmp_path, regions_table=regions, eras_table=eras, keywords_table=keywords)

    with pytest.raises(LoreValidationError) as raised:
        kit.validate(directory, display="pipeline/data/lore/dominaria")

    text = str(raised.value)
    assert "breaks 3 lore table rules" in text
    assert 'pipeline/data/lore/dominaria/regions.json: regions[0] "north": weight: is 100' in text
    assert 'pipeline/data/lore/dominaria/eras.json: eras[1] "noon": region: ' in text
    assert 'pipeline/data/lore/dominaria/keywords.json: keywords[0] "Al": word: ' in text
