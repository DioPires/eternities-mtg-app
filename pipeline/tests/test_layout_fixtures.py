"""The layout fixtures of PRD v4 5.4.14, byte for byte (5.4.18, 8.8.1).

Every fixture but the two of Dominaria is made again here and compared with its committed
bytes. Dominaria takes about a minute a run, so the hosted ``pipeline`` job makes those two
again in its own step, ``eternities layout fixtures --check`` (8.8.5); this file still asserts
what their committed output says.
"""

from __future__ import annotations

import json
import shutil
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from eternities import cli
from eternities.layout import fixtures, trig
from eternities.layout.fixtures import Fixture, FixtureError
from eternities.lore.vocabulary import load_hero_entries

from layout_kit import directions

SLOW = {"dominaria", "dominaria-hero-volumes"}
"""Made again by the CI step, not by this file."""

IN_SCOPE = {
    "dominaria": "layout",
    "rabiah": "layout",
    "zhalfir": "layout",
    "vryn": "layout",
    "shandalar": "layout",
    "hero-one-region-one-era": "layout",
    "era-unmapped-set": "failure",
    "keyword-moves-one-card": "layout",
    "degenerate-cell": "failure",
    "anchor-outside-unit-disc": "failure",
    "era-three-sets-one-card": "layout",
    "head-ray-lobe": "layout",
    "dominaria-hero-volumes": "layout",
}
"""The fixtures of 5.4.14 in leg 1's scope; the Blind Eternities has no product tables yet."""


@cache
def found() -> dict[str, Fixture]:
    return {fixture.name: fixture for fixture in fixtures.discover()}


def world(name: str) -> dict[str, Any]:
    fixture = found()[name]
    return json.loads((fixture.directory / "worlds" / f"{fixture.slug}.json").read_text("utf-8"))


def check(name: str) -> dict[str, Any]:
    return json.loads((found()[name].directory / "check.json").read_text(encoding="utf-8"))


def report(name: str) -> str:
    return (found()[name].directory / "report.md").read_text(encoding="utf-8")


def test_every_fixture_in_scope_is_committed_with_its_manifest():
    assert {name: fixture.expect for name, fixture in found().items()} == IN_SCOPE
    assert all(fixture.purpose.endswith(".") for fixture in found().values())
    assert sorted(path.name for path in fixtures.PREDICATES.glob("*.json")) == [
        "nested-squares.json",
        "notch.json",
    ]


@pytest.mark.parametrize("name", sorted(set(IN_SCOPE) - SLOW))
def test_a_fixture_made_again_has_its_committed_bytes(name: str):
    fixture = found()[name]
    produced = fixtures.produce(fixture, directions(), trig.load(), load_hero_entries())
    assert fixtures.differences(fixture, produced) == []
    assert produced == fixtures.committed(fixture)


@pytest.mark.parametrize(
    "name", sorted(name for name, expect in IN_SCOPE.items() if expect == "layout")
)
def test_the_independent_checker_is_green_on_every_fixture(name: str):
    fixture = found()[name]
    document = check(name)
    assert (document["result"], document["violationCount"], document["violations"]) == (
        "pass",
        0,
        [],
    )
    assert document["figures"]["connected"] is True
    assert sum(document["assertions"].values()) > 0
    for site in document["figures"]["sites"]:
        assert site["toFirst"] <= 18_000 and site["between"] <= 18_000 and site["toEnd"] <= 10_000
    held = fixtures.committed(fixture)
    expected = {"stands.bin", "report.md", "check.json", f"worlds/{fixture.slug}.json"}
    assert expected <= set(held) <= expected | {f"lore/{fixture.slug}.json"}
    assert world(name)["standCount"] == (len(held["stands.bin"]) - 16) // 48


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("era-unmapped-set", "set 'ta2' has first printings on theros"),
        ("degenerate-cell", "DegenerateCell: region 'edge': degenerate cell"),
        ("anchor-outside-unit-disc", '"far": anchor: [800, 700] lies outside the unit disc'),
    ],
)
def test_a_fixture_that_must_fail_records_the_failure_that_names_its_subject(
    name: str, message: str
):
    held = fixtures.committed(found()[name])
    assert list(held) == ["failure.txt"]
    text = held["failure.txt"].decode()
    assert message in text and text.endswith("\n")
    # No path of the machine that made it.
    assert "/Users/" not in text and "/home/" not in text


def test_the_predicate_fixtures_hold_under_the_checkers_own_predicates():
    assert fixtures.predicate_failures() == []


def test_dominaria_is_laid_out_from_its_accepted_tables():
    document = world("dominaria")
    assert (document["standCount"], document["law"], document["dataHash"]) == (
        6_271,
        "hero",
        "a5846bec28d1447e",
    )
    kinds = [site["kind"] for site in document["sites"]]
    assert (kinds.count("era"), kinds.count("region")) == (15, 11)
    assert len(document["regions"]) == 12
    text = report("dominaria")
    assert "acceptance status: accepted" in text
    assert "sha256:59322664c8da5b437cf9c5c00a7126a12bdf0570c458cfd154a2680ee443b8d2" in text
    assert f"R = {document['radius']:,} mm after" in text
    # Fifteen legs of the trail and eleven spurs.
    legs = [leg["kind"] for leg in document["trail"]["legs"]]
    assert (legs.count("trail"), legs.count("spur")) == (15, 11)
    assert check("dominaria")["figures"]["minimumStandSpacing"] >= 2_500


def test_the_small_worlds_of_5_4_13():
    assert [len(world(name)["sites"]) for name in ("shandalar", "vryn", "zhalfir", "rabiah")] == [
        1
    ] * 4
    assert [world(name)["standCount"] for name in ("shandalar", "vryn", "zhalfir", "rabiah")] == [
        1,
        2,
        4,
        75,
    ]
    # One stand beside one short path, with a marker stone.
    (site,) = world("shandalar")["sites"]
    assert [cluster["stands"] for cluster in site["clusters"]] == [1]
    assert site["stone"]["kind"] == "marker"
    # A two-card plane has one cluster of two, kept under the small-site rule.
    assert [cluster["stands"] for cluster in world("vryn")["sites"][0]["clusters"]] == [2]
    assert sum(cluster["stands"] for cluster in world("zhalfir")["sites"][0]["clusters"]) == 4
    assert world("rabiah")["sites"][0]["stone"]["kind"] == "way"


def test_a_hero_plane_of_one_region_and_one_era_has_one_site():
    document = world("hero-one-region-one-era")
    assert [(site["key"], site["kind"]) for site in document["sites"]] == [("era:kami-war", "era")]
    assert len(document["regions"]) == 1 and document["standCount"] == 12
    assert len(document["regions"][0]["cell"]) == 72


def test_the_keyword_moves_exactly_one_card_to_a_regional_site():
    document = world("keyword-moves-one-card")
    assert [site["key"] for site in document["sites"]] == ["era:landfall", "region:south"]
    assert [sum(c["stands"] for c in site["clusters"]) for site in document["sites"]] == [9, 1]
    assert "| Sunspire Lookout | Sunspire | `south` | `landfall` | `region:south` |" in report(
        "keyword-moves-one-card"
    )


def test_the_era_of_three_sets_has_one_cluster_and_two_chapter_stones():
    (site,) = world("era-three-sets-one-card")["sites"]
    assert [cluster["stands"] for cluster in site["clusters"]] == [3]
    stones = [chapter["stone"] for chapter in site["chapters"]]
    assert stones[0] is None and None not in stones[1:]
    assert (stones[1]["x"], stones[1]["z"]) != (stones[2]["x"], stones[2]["z"])


def test_the_report_names_the_sweep_direction_try_that_passes():
    text = report("head-ray-lobe")
    assert "| `set:ha1` | 2 | the attachment square lies within 5 m of the blob |" in text


def test_a_hero_volume_moves_a_site_and_the_trail_routes_round_it():
    free, held = world("dominaria"), world("dominaria-hero-volumes")
    (volume,) = held["heroVolumes"]
    assert volume["id"] == "fixture-keep" and free["heroVolumes"] == []
    centre = {site["key"]: site["centre"] for site in free["sites"]}
    moved = {site["key"]: site["centre"] for site in held["sites"]}
    # The volume covers the ground where the site stood: the site stands elsewhere.
    xs, zs = [x for x, _ in volume["polygon"]], [z for _, z in volume["polygon"]]
    assert min(xs) < centre["era:the-dark"][0] < max(xs)
    assert min(zs) < centre["era:the-dark"][1] < max(zs)
    assert moved["era:the-dark"] != centre["era:the-dark"]
    # The legs to and from that site take another route.
    legs = {leg["to"]: leg["polyline"] for leg in free["trail"]["legs"]}
    routed = {leg["to"]: leg["polyline"] for leg in held["trail"]["legs"]}
    assert routed["era:the-dark"] != legs["era:the-dark"]
    assert routed["era:fallen-empires"] != legs["era:fallen-empires"]

    # The leg from `era:brothers-war` crosses the volume's ground in the free world and keeps
    # clear of it with the volume.
    def inside(point: list[int]) -> bool:
        return min(xs) <= point[0] <= max(xs) and min(zs) <= point[1] <= max(zs)

    assert any(inside(point) for point in legs["era:the-dark"])
    assert not any(inside(point) for point in routed["era:the-dark"])
    assert check("dominaria-hero-volumes")["result"] == "pass"
    assert held["standCount"] == 6_271


# --- the fixtures command ---------------------------------------------------------------------


def copy(tmp_path: Path, name: str) -> Fixture:
    shutil.copytree(found()[name].directory, tmp_path / name)
    return next(fixture for fixture in fixtures.discover(tmp_path) if fixture.name == name)


def test_a_changed_byte_is_a_difference_and_a_write_restores_it(tmp_path: Path):
    fixture = copy(tmp_path, "era-three-sets-one-card")
    produced = fixtures.produce(fixture, directions(), trig.load(), load_hero_entries())
    assert fixtures.differences(fixture, produced) == []
    stands = fixture.directory / "stands.bin"
    data = bytearray(stands.read_bytes())
    data[16 + 28] ^= 1
    stands.write_bytes(bytes(data))
    (fixture.directory / "check.json").unlink()
    (fixture.directory / "failure.txt").write_text("stale\n", encoding="utf-8")
    assert fixtures.differences(fixture, produced) == [
        "era-three-sets-one-card/check.json: not committed",
        "era-three-sets-one-card/failure.txt: committed, and the run does not make it",
        "era-three-sets-one-card/stands.bin: 160 bytes from the run differ from the 160 bytes "
        "committed",
    ]
    fixtures.write(fixture, produced)
    assert fixtures.differences(fixture, produced) == []
    assert not (fixture.directory / "failure.txt").exists()


def test_a_fixture_that_lays_out_where_a_failure_is_expected_is_a_difference(tmp_path: Path):
    fixture = copy(tmp_path, "shandalar")
    manifest = json.loads((fixture.directory / "fixture.json").read_text(encoding="utf-8"))
    manifest["expect"] = "failure"
    (fixture.directory / "fixture.json").write_text(json.dumps(manifest), encoding="utf-8")
    (changed,) = fixtures.discover(tmp_path)
    produced = fixtures.produce(changed, directions(), trig.load(), load_hero_entries())
    assert fixtures.differences(changed, produced) == [
        "shandalar: the manifest expects a failure; the run gave a layout"
    ]


def test_a_failing_fixture_that_is_written_loses_its_stale_layout(tmp_path: Path):
    fixture = copy(tmp_path, "degenerate-cell")
    (fixture.directory / "worlds").mkdir()
    (fixture.directory / "worlds" / "tarkir.json").write_text("{}\n", encoding="utf-8")
    produced = fixtures.produce(fixture, directions(), trig.load(), load_hero_entries())
    assert list(produced) == ["failure.txt"]
    assert len(fixtures.differences(fixture, produced)) == 1
    fixtures.write(fixture, produced)
    assert not (fixture.directory / "worlds").exists()
    assert fixtures.differences(fixture, produced) == []


@pytest.mark.parametrize(
    ("manifest", "message"),
    [
        ("{", "fixture.json cannot be read"),
        ('{"slug": "vryn", "expect": "layout"}', "fixture.json cannot be read"),
        (
            '{"slug": "vryn", "expect": "maybe", "purpose": "x."}',
            "`expect` is `layout` or `failure`",
        ),
        ('{"slug": "vryn", "expect": "layout", "purpose": "x."}', "the pack pack is not there"),
        (
            '{"slug": "vryn", "expect": "layout", "purpose": "x.", "productionPack": "0000"}',
            "the pack 0000 is not there",
        ),
    ],
)
def test_a_manifest_that_cannot_be_used_fails_naming_the_fixture(
    tmp_path: Path, manifest: str, message: str
):
    directory = tmp_path / "broken"
    directory.mkdir()
    (directory / "fixture.json").write_text(manifest, encoding="utf-8")
    with pytest.raises(FixtureError, match=f"fixture broken: .*{message}"):
        fixtures.discover(tmp_path)


def test_the_fixtures_command_checks_and_names_a_difference(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
):
    assert cli.main(["layout", "fixtures", "--check", "shandalar", "degenerate-cell"]) == 0
    printed = capsys.readouterr().out
    assert "shandalar: 4 files, matches" in printed
    assert "degenerate-cell: 1 files, matches" in printed
    assert cli.main(["layout", "fixtures", "--check", "atlantis"]) == 1
    assert "no fixture named ['atlantis']" in capsys.readouterr().err

    fixture = copy(tmp_path, "shandalar")
    (fixture.directory / "report.md").write_text("stale\n", encoding="utf-8")
    monkeypatch.setattr(fixtures, "discover", lambda: [fixture])
    assert cli.main(["layout", "fixtures", "--check", "shandalar"]) == 1
    printed = capsys.readouterr()
    assert "shandalar: 4 files, differs" in printed.out
    assert "shandalar/report.md:" in printed.err and "1 differences" in printed.err
    # Without --check the command writes the fixture again.
    assert cli.main(["layout", "fixtures", "shandalar"]) == 0
    assert "shandalar: 4 files, written" in capsys.readouterr().out
    assert cli.main(["layout", "fixtures", "--check", "shandalar"]) == 0
