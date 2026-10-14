"""One world from its inputs to its files: the build, the emission, the report and the commands
(PRD v4 4.13.3, 4.13.5, 4.16.3, 9.6).

Rabiah is read from the production pack and laid out by the kit law. The hero worlds are the
synthetic planes of two fixtures. Dominaria runs in ``eternities layout fixtures``.
"""

from __future__ import annotations

import json
import re
import shutil
import struct
from collections import Counter
from functools import cache
from math import isqrt
from pathlib import Path
from typing import Any

import pytest

from eternities import cli
from eternities.layout import build, cards, check, emit, fixtures, geometry, report, trig
from eternities.layout.build import Built, VolumesError
from eternities.layout.constants import PAD_RADIUS, STONE_ACROSS, STONE_ALONG
from eternities.layout.exact import SCALE
from eternities.lore import LoreIndex
from eternities.lore.vocabulary import load_hero_entries

from layout_kit import directions

REPO_ROOT = Path(__file__).resolve().parents[2]
PACK = REPO_ROOT / "web" / "public" / "data" / "a5846bec28d1447e"
RECORD = struct.Struct("<16sBBBBBBHHHiiiHHHH")


@cache
def rabiah() -> Built:
    return build.build_world("rabiah", PACK, directions())


@cache
def synthetic(name: str) -> Built:
    fixture = next(found for found in fixtures.discover() if found.name == name)
    return build.build_world(
        fixture.slug,
        fixture.pack,
        directions(),
        lore_dir=fixture.lore,
        hero_entries=load_hero_entries(),
        fixture=True,
    )


def records(built: Built) -> list[tuple[Any, ...]]:
    data = built.emitted.stands_bin
    return [RECORD.unpack_from(data, 16 + 48 * index) for index in range((len(data) - 16) // 48)]


# --- the cards of a plane, from the v3 pack ---------------------------------------------------


def test_a_planes_cards_are_read_from_the_v3_pack():
    plane = rabiah().plane
    assert (plane.slug, plane.display_name, plane.data_hash) == ("rabiah", "Rabiah", PACK.name)
    assert plane.plane_index == 66
    assert [(record.code, record.year) for record in plane.sets] == [("arn", 1993)]
    assert len(plane.cards) == 75
    assert [card.local_index for card in plane.cards] == list(range(75))
    assert all(card.set_code == "arn" and card.shard == 0 for card in plane.cards)
    assert all(card.shard_slot == card.local_index for card in plane.cards)
    for card in plane.cards:
        expected = 6 if card.identity == 0 else 5 if card.identity & (card.identity - 1) else None
        assert card.colour_class == (
            card.identity.bit_length() - 1 if expected is None else expected
        )
        assert card.order_key == bytes.fromhex(card.oracle_id.replace("-", ""))


def test_dominarias_cards_from_the_pack_are_the_lore_indexs_with_the_same_first_sets():
    # Departure 1 of pull request 1 (DEC-1091, N3): the cards are read from the v3 pack directly,
    # and they are the cards and first sets that `LoreIndex` gives the tables' validation.
    plane = cards.read_plane(PACK, "dominaria")
    indexed = LoreIndex.from_pack(PACK).cards_on("dominaria")
    read = {card.oracle_id: card.set_code for card in plane.cards}
    assert len(read) == len(plane.cards) == len(indexed) == 6_271
    assert read == {card.oracle_id: card.first_set for card in indexed}


def test_a_swatch_is_the_mean_of_the_four_samples_rounded_half_up():
    assert cards.mean_swatch((0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF)) == 0xFFFF
    assert cards.mean_swatch((0, 0, 0, 0)) == 0
    # Red 31, 31, 30, 30 has the mean 30.5, which rounds up to 31.
    assert cards.mean_swatch((31 << 11, 31 << 11, 30 << 11, 30 << 11)) == 31 << 11
    assert cards.mean_swatch((1, 0, 0, 0)) == 0
    assert cards.mean_swatch((1, 1, 0, 0)) == 1
    assert any(card.swatch for card in rabiah().plane.cards)


def test_a_pack_without_the_plane_or_a_file_fails_naming_it(tmp_path: Path):
    with pytest.raises(cards.PackError, match="has no plane 'atlantis'"):
        cards.read_plane(PACK, "atlantis")
    with pytest.raises(cards.PackError, match=r"is missing planes\.json"):
        cards.read_plane(tmp_path, "rabiah")


# --- stands.bin (4.13.3) ----------------------------------------------------------------------


def test_stands_bin_has_the_v3_header_at_version_four_and_48_byte_records():
    built = rabiah()
    data = built.emitted.stands_bin
    assert struct.unpack_from("<4sBBHII", data) == (b"ETRN", 1, 4, 0, 75, 0)
    assert len(data) == 16 + 75 * 48 == 3_616
    by_id = {card.order_key: card for card in built.plane.cards}
    held = records(built)
    # Sorted by plane index, site index, cluster index, then `oracle_id` bytes.
    keys = [(row[1], row[7], row[16], row[0]) for row in held]
    assert keys == sorted(keys)
    assert len({row[0] for row in held}) == 75
    for row in held:
        card = by_id[row[0]]
        assert row[1:7] == (
            66,
            card.identity,
            card.colour_class,
            card.rarity,
            card.type_mask,
            1 if card.back_image else 0,
        )
        assert (row[7], row[8], row[9]) == (0, card.set_id, card.printings)
        assert (row[13], row[14], row[15]) == (card.swatch, card.shard, card.shard_slot)
        # A yaw is a whole count of the trig table.
        assert row[12] % 1_000 == 0 and 0 <= row[12] < 360_000_000


def test_a_coordinate_is_rounded_once_as_a_world_value():
    # 5.4.18 (3) rounds the world value q (DEC-1091, B4). A local z of 6,519.5 mm at a centre z of
    # -100,000 mm is -93,480.5 mm in the world, and half away from zero gives -93,481. Rounding
    # in the site's frame first gives 6,520 - 100,000 = -93,480.
    blob = geometry.polygon([(0, 0), (2_000, 0), (0, 13_039)], 2)
    assert emit._rounded(blob, (0, -100_000)) == [[0, -100_000], [1_000, -100_000], [0, -93_481]]
    # The stands, the site stone and the cluster centres take the same rule, over 2^30.
    half = 6_519 * SCALE + SCALE // 2
    assert emit._placed(half, SCALE, -100_000) == -93_481
    assert emit._placed(half, SCALE, 100_000) == 106_520
    assert emit._placed(-half, SCALE, 100_000) == 93_481
    assert emit._placed(-half, SCALE, -100_000) == -106_520


def test_the_stand_index_joins_a_record_to_its_corridor_vertex():
    built = rabiah()
    world = built.emitted.world
    (site,) = world["sites"]
    assert (
        world["standCount"] == len(world["stands"]["vertex"]) == len(world["stands"]["arc"]) == 75
    )
    arcs = [0]
    for (ax, az), (bx, bz) in zip(site["path"], site["path"][1:], strict=False):
        arcs.append(arcs[-1] + isqrt((bx - ax) ** 2 + (bz - az) ** 2))
    for stand in built.emitted.stands:
        vertex = world["stands"]["vertex"][stand.index]
        assert vertex < len(site["path"])
        assert world["stands"]["arc"][stand.index] == arcs[vertex] == stand.arc
        assert abs(stand.arc - site["clusters"][stand.cluster]["arc"]) <= 6_000
    assert [cluster["stands"] for cluster in site["clusters"]] == [
        sum(1 for stand in built.emitted.stands if stand.cluster == index)
        for index in range(len(site["clusters"]))
    ]


# --- worlds/<slug>.json (4.13.5) --------------------------------------------------------------


def test_a_kit_worlds_file_carries_every_field_of_4_13_5():
    world = rabiah().emitted.world
    assert set(world) == {
        "contractVersion",
        "slug",
        "planeIndex",
        "dataHash",
        "law",
        "radius",
        "standCount",
        "arrival",
        "returnPortal",
        "plaza",
        "pads",
        "heroVolumes",
        "regions",
        "sites",
        "trail",
        "stands",
    }
    assert (world["contractVersion"], world["slug"], world["law"]) == (4, "rabiah", "kit")
    assert world["arrival"] == {"x": 0, "z": 0, "yaw": 90_000_000}
    assert world["returnPortal"] == {"x": 0, "z": -8_000, "yaw": 90_000_000}
    assert world["plaza"]["radius"] == 12_000 and world["plaza"]["edgeRadius"] == 15_000
    # One unnamed region: the whole world.
    (region,) = world["regions"]
    assert (region["id"], region["name"], region["firstSite"]) == (None, None, 0)
    assert len(region["cell"]) == 72
    (site,) = world["sites"]
    assert set(site) == {
        "key",
        "kind",
        "regionId",
        "eraId",
        "setIds",
        "centre",
        "radius",
        "boundingRadius",
        "blob",
        "path",
        "pad",
        "approachPoint",
        "stone",
        "clusters",
        "chapters",
    }
    assert (site["key"], site["kind"], site["regionId"], site["eraId"]) == (
        "set:arn",
        "set",
        None,
        None,
    )
    assert site["setIds"] == [3] and site["chapters"] == []
    assert site["stone"]["kind"] == "way"
    assert len(site["blob"]) == 72
    assert world["pads"] == [
        {"owner": "return", "x": 0, "z": -6_500, "radius": PAD_RADIUS},
        {"owner": "set:arn", "x": site["pad"]["x"], "z": site["pad"]["z"], "radius": PAD_RADIUS},
    ]
    # The stone stands 4 m along the head ray and 3 m across it from the head.
    head = site["path"][0]
    reach = (site["stone"]["x"] - head[0]) ** 2 + (site["stone"]["z"] - head[1]) ** 2
    assert abs(reach - STONE_ALONG**2 - STONE_ACROSS**2) < 2 * 5_000 * 2
    (leg,) = world["trail"]["legs"]
    assert (leg["id"], leg["kind"], leg["from"], leg["to"]) == (0, "trail", "plaza", "set:arn")
    assert leg["polyline"][0] == world["plaza"]["approach"][1] == leg["startAttachment"][0]
    assert leg["polyline"][-1] == site["approachPoint"] == leg["endAttachment"][1]
    assert world["trail"]["junctions"] == [
        {"point": leg["polyline"][0], "owner": "plaza", "legs": [0]},
        {"point": leg["polyline"][-1], "owner": "set:arn", "legs": [0]},
    ]


def test_the_marker_stone_of_a_set_site_under_five_stands():
    shandalar = build.build_world("shandalar", PACK, directions())
    assert shandalar.emitted.world["sites"][0]["stone"]["kind"] == "marker"
    assert len(shandalar.emitted.stands) == 1
    assert shandalar.emitted.lore is None
    assert shandalar.emitted.headlines == ()


def test_a_hero_worlds_file_carries_its_regions_its_chapters_and_its_spur():
    built = synthetic("keyword-moves-one-card")
    world = built.emitted.world
    assert world["law"] == "hero"
    assert [(region["id"], region["firstSite"]) for region in world["regions"]] == [
        ("north", 0),
        ("south", 1),
    ]
    assert all(
        region["kit"] == "temperate" and region["water"] == "river" for region in world["regions"]
    )
    era, regional = world["sites"]
    assert (era["key"], era["kind"], era["regionId"], era["eraId"], era["setIds"]) == (
        "era:landfall",
        "era",
        "north",
        "landfall",
        [1],
    )
    assert era["stone"]["kind"] == "reading"
    assert (regional["key"], regional["kind"], regional["eraId"], regional["setIds"]) == (
        "region:south",
        "region",
        None,
        [],
    )
    assert regional["stone"]["kind"] == "way" and regional["chapters"] == []
    # One chapter, with no stone: travel arrives at the pad.
    (chapter,) = era["chapters"]
    assert (chapter["setId"], chapter["firstCluster"], chapter["stone"]) == (1, 0, None)
    assert chapter["destination"] == era["pad"]
    trail_leg, spur = world["trail"]["legs"]
    assert (spur["kind"], spur["from"], spur["to"]) == ("spur", "trail", "region:south")
    junction = world["trail"]["junctions"][2]
    assert junction == {"point": spur["polyline"][0], "owner": None, "legs": [0, 1]}
    assert spur["polyline"][0] in trail_leg["polyline"]
    # The one card with the keyword stands at the regional site.
    moved = [stand for stand in built.emitted.stands if stand.site == 1]
    assert [stand.card.name for stand in moved] == ["Sunspire Lookout"]


def test_three_chapters_of_one_card_stand_in_one_cluster_with_two_chapter_stones():
    built = synthetic("era-three-sets-one-card")
    (site,) = built.emitted.world["sites"]
    assert [cluster["stands"] for cluster in site["clusters"]] == [3]
    first, second, third = site["chapters"]
    assert [chapter["setId"] for chapter in site["chapters"]] == [1, 2, 3]
    assert first["stone"] is None and first["destination"] == site["pad"]
    assert second["stone"] is not None and third["stone"] is not None
    assert second["destination"] == second["stone"] != third["stone"]
    assert {chapter["firstCluster"] for chapter in site["chapters"]} == {0}
    assert sorted(chapter["firstStand"] for chapter in site["chapters"]) == [0, 1, 2]
    # Two lattice points, in the world frame: z = 2,599 k and x = 3,000 i + 1,500 k.
    for stone in (second["stone"], third["stone"]):
        k, rest = divmod(stone["z"], 2_599)
        assert rest == 0 and (stone["x"] - 1_500 * k) % 3_000 == 0


def test_an_era_whose_every_card_moved_keeps_its_site_with_no_stand(tmp_path: Path):
    # The fixture's plane, cut down to the one card that the keyword moves: the era site has no
    # card left. It still stands, with its pad, its reading stone and the first segment of its
    # path, because the trail visits every era (5.4.2, 5.4.11).
    fixture = next(found for found in fixtures.discover() if found.name == "keyword-moves-one-card")
    shutil.copytree(fixture.directory, tmp_path / "moved")
    shard = tmp_path / "moved" / "pack" / "planes" / "ixalan.0.json"
    rows = json.loads(shard.read_text(encoding="utf-8"))
    rows["cards"] = [card for card in rows["cards"] if card["n"] == "Sunspire Lookout"]
    shard.write_text(json.dumps(rows), encoding="utf-8")
    planes = tmp_path / "moved" / "pack" / "planes.json"
    listed = json.loads(planes.read_text(encoding="utf-8"))
    listed["planes"][0]["cardCount"] = listed["planes"][0]["starCount"] = 1
    planes.write_text(json.dumps(listed), encoding="utf-8")
    built = build.build_world(
        "ixalan",
        tmp_path / "moved" / "pack",
        directions(),
        lore_dir=tmp_path / "moved" / "ixalan",
        hero_entries=load_hero_entries(),
        fixture=True,
    )
    era, regional = built.emitted.world["sites"]
    assert (era["key"], era["clusters"], era["chapters"], len(era["path"])) == (
        "era:landfall",
        [],
        [],
        2,
    )
    assert era["stone"]["kind"] == "reading" and era["setIds"] == [1]
    assert [cluster["stands"] for cluster in regional["clusters"]] == [1]
    assert built.assignment.empty_chapters == (("landfall", "ix1"),)
    assert [leg["to"] for leg in built.emitted.world["trail"]["legs"]] == [
        "era:landfall",
        "region:south",
    ]
    assert build.check_built(built, trig.load()).ok
    text = report.render(built, None, directions())
    assert "### Empty chapters\n\n| Era | Set |\n|---|---|\n| `landfall` | `ix1` |" in text
    assert report.site_gaps(built.layout.sites[0]) == (0, 0, 0)


# --- lore/<slug>.json (4.16.3) ----------------------------------------------------------------


def test_a_hero_worlds_lore_file_carries_the_resolved_tables_and_the_headline_stands():
    built = synthetic("keyword-moves-one-card")
    lore = built.emitted.lore
    assert lore is not None and built.tables is not None
    assert set(lore) == {"contractVersion", "slug", "kind", "digest", "regions", "eras", "keywords"}
    assert (lore["contractVersion"], lore["slug"], lore["kind"]) == (4, "ixalan", "lore")
    assert lore["digest"] == built.tables.digest
    assert lore["keywords"] == [{"word": "Sunspire", "region": "south"}]
    assert [set(region) for region in lore["regions"]] == [
        {"id", "name", "sentence", "sources"}
    ] * 2
    (era,) = lore["eras"]
    assert set(era) == {
        "id",
        "name",
        "years",
        "region",
        "sets",
        "setIds",
        "paragraphs",
        "sources",
        "headline",
    }
    assert (era["sets"], era["setIds"]) == (["ix1"], [1])
    assert era["sources"] == ["https://magic.wizards.com/en/story/fixture"]
    # No flagged printing, no list and no legendary creature: no headline card.
    assert era["headline"] == []
    assert built.emitted.headlines == (("landfall", "legendary creatures", ()),)


def test_the_json_files_are_written_in_the_canonical_form(tmp_path: Path):
    built = synthetic("keyword-moves-one-card")
    written = built.emitted.write(tmp_path, "ixalan")
    assert [path.relative_to(tmp_path).as_posix() for path in written] == [
        "stands.bin",
        "worlds/ixalan.json",
        "lore/ixalan.json",
    ]
    for path in written[1:]:
        text = path.read_text(encoding="utf-8")
        document = json.loads(text)
        assert text.endswith("\n") and "\n" not in text[:-1]
        assert (
            text
            == json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            + "\n"
        )
    assert written[0].read_bytes() == built.emitted.stands_bin
    assert emit.to_json({"b": [1, {"z": "é", "a": None}], "a": True}) == (
        '{"a":true,"b":[1,{"a":null,"z":"é"}]}\n'
    )


# --- the hero-volumes file --------------------------------------------------------------------


def volumes_file(tmp_path: Path, document: Any) -> Path:
    path = tmp_path / "volumes.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def test_a_hero_volumes_file_gives_named_polygons(tmp_path: Path):
    square = [[1_000, 1_000], [2_000, 1_000], [2_000, 2_000], [1_000, 2_000]]
    path = volumes_file(
        tmp_path, {"plane": "rabiah", "volumes": [{"id": "keep", "polygon": square}]}
    )
    (volume,) = build.read_volumes(path, "rabiah")
    assert volume.id == "keep"
    assert volume.shape.pts == ((1_000, 1_000), (2_000, 1_000), (2_000, 2_000), (1_000, 2_000))
    assert volume.shape.closed and volume.shape.den == 1


MALFORMED: list[tuple[Any, str]] = [
    ([1], "holds exactly `plane` and `volumes`"),
    ({"plane": "rabiah"}, "holds exactly `plane` and `volumes`"),
    ({"plane": "vryn", "volumes": []}, "is for 'vryn', not for 'rabiah'"),
    ({"plane": "rabiah", "volumes": {}}, "`volumes` is a list"),
    ({"plane": "rabiah", "volumes": [{"id": "a"}]}, "holds exactly `id` and `polygon`"),
    ({"plane": "rabiah", "volumes": [{"id": "A b", "polygon": []}]}, "`id` is a slug"),
    (
        {
            "plane": "rabiah",
            "volumes": [
                {"id": "a", "polygon": [[0, 0], [1, 0], [1, 1]]},
                {"id": "a", "polygon": [[0, 0], [1, 0], [1, 1]]},
            ],
        },
        "volume 1: `id` is a slug that no other volume has",
    ),
    (
        {"plane": "rabiah", "volumes": [{"id": "a", "polygon": [[0, 0], [1, 1]]}]},
        "three vertices",
    ),
    (
        {"plane": "rabiah", "volumes": [{"id": "a", "polygon": [[0, 0], [1, 0], [1.5, 1]]}]},
        "a pair of whole millimetres",
    ),
    (
        {"plane": "rabiah", "volumes": [{"id": "a", "polygon": [[0, 0], [1, 0], [True, 1]]}]},
        "a pair of whole millimetres",
    ),
]


@pytest.mark.parametrize(("document", "message"), MALFORMED)
def test_a_malformed_hero_volumes_file_fails_naming_the_fault(
    tmp_path: Path, document: Any, message: str
):
    with pytest.raises(VolumesError, match=re.escape(message)):
        build.read_volumes(volumes_file(tmp_path, document), "rabiah")


def test_a_hero_volumes_file_that_is_no_json_fails(tmp_path: Path):
    path = tmp_path / "volumes.json"
    path.write_text("{", encoding="utf-8")
    with pytest.raises(VolumesError, match="cannot be read as JSON"):
        build.read_volumes(path, "rabiah")
    with pytest.raises(VolumesError, match="cannot be read as JSON"):
        build.read_volumes(tmp_path / "none.json", "rabiah")


def test_a_hero_volume_is_emitted_and_keeps_the_site_ten_metres_away(tmp_path: Path):
    free = rabiah().emitted.world["sites"][0]["centre"]
    half = 10_000
    square = [
        [free[0] - half, free[1] - half],
        [free[0] + half, free[1] - half],
        [free[0] + half, free[1] + half],
        [free[0] - half, free[1] + half],
    ]
    path = volumes_file(
        tmp_path, {"plane": "rabiah", "volumes": [{"id": "keep", "polygon": square}]}
    )
    built = build.build_world("rabiah", PACK, directions(), volumes=path)
    world = built.emitted.world
    assert world["heroVolumes"] == [{"id": "keep", "polygon": square}]
    assert world["sites"][0]["centre"] != free
    assert build.check_built(built, trig.load()).ok


# --- the checker and the report ---------------------------------------------------------------


def test_the_checker_reads_the_written_files_and_passes():
    for built in (
        rabiah(),
        synthetic("keyword-moves-one-card"),
        synthetic("era-three-sets-one-card"),
    ):
        result = build.check_built(built, trig.load())
        assert result.ok and result.violation_count == 0 and result.violations == ()
        document = result.document()
        assert document["result"] == "pass"
        assert document["figures"]["connected"] is True
        assert json.loads(emit.to_json(document)) == document


def test_the_report_is_a_pure_function_of_the_layout():
    built = rabiah()
    document = build.check_built(built, trig.load()).document()
    text = report.render(built, document, directions())
    assert text == report.render(built, document, directions())
    assert text.startswith("# Layout report: Rabiah (`rabiah`)\n")
    assert text.endswith("\n") and not text.endswith("\n\n")
    layout = built.layout
    assert f"R = {layout.radius:,} mm after {layout.passes} of 20 passes" in text
    assert "- Law: the kit law." in text
    assert "- Independent checker (3.2): pass, 0 violations." in text
    for heading in (
        "## Passes over R",
        "## Regions",
        "## Sites",
        "## Site widenings in order",
        "## Redraws in order",
        "## Sweep-direction tries (5.4.8)",
        "## Site paths and gaps (mm)",
        "## Slots on the final layout (on runs / on half-turns)",
        "## Clusters by size",
        "## The path vertex of each stand (ruling 2, V)",
        "## The trail",
        "## The independent checker (3.2, 5.4.10)",
    ):
        assert heading in text
    assert "## Keyword assignments" not in text
    # The redraws of ruling 3: per site and in all, and the restarts by cause.
    redraws = [event for event in layout.events if event.kind == "redraw"]
    assert redraws
    assert f"- Redraws at the same radius: {len(redraws)}, at most 1 at a radius." in text
    restarts = Counter(event.cause for event in layout.events if event.kind == "restart")
    assert sum(restarts.values()) == layout.restarts
    assert (
        f"Restarts at step (4): {layout.restarts} ({restarts['a redraw']} after a redraw, "
        f"{restarts['a widening at placement']} after a widening at placement, "
        f"{restarts['a widened site no longer fits']} where" in text
    )
    site = layout.sites[0]
    assert f"| {len(redraws)} | {site.redraws} | {site.local.tries} |" in text
    # Every figure is printed from its integer: no decimal point stands between two digits,
    # apart from the PRD's section numbers.
    body = re.sub(r"\(?\b\d+(\.\d+)+\b( \(\d+\))?\)?", "", text.replace("5.4.18 (6)", ""))
    assert not re.search(r"\d\.\d", body)
    # The three gaps are within the bounds of 5.4.10.
    first, between, last = report.site_gaps(layout.sites[0])
    assert first <= 18_000 and between <= 18_000 and last <= 10_000
    assert report.render(built, None, directions()).count("independent checker") == 0


def test_a_hero_worlds_report_lists_its_keyword_assignments_and_headlines():
    built = synthetic("keyword-moves-one-card")
    text = report.render(built, None, directions())
    assert "| Sunspire Lookout | Sunspire | `south` | `landfall` | `region:south` |" in text
    assert "### Cards whose name matches keywords of two regions\n\nNone." in text
    assert "### Empty chapters\n\nNone." in text
    assert "| `landfall` | legendary creatures | none |" in text
    assert "acceptance status: absent" in text
    assert "| `north` |" in text and "| `south` |" in text


def test_the_walking_times_use_the_avatars_two_speeds():
    source = (
        REPO_ROOT / "unity" / "Eternities" / "Assets" / "Scripts" / "Avatar" / "AvatarController.cs"
    ).read_text(encoding="utf-8")
    found = re.search(r"const float WalkSpeed = (\d+), RunSpeed = (\d+)", source)
    assert found is not None
    assert (int(found[1]) * 1_000, int(found[2]) * 1_000) == (report.WALK_SPEED, report.RUN_SPEED)
    assert report._minutes(8_295_643, report.WALK_SPEED) == "46 min 05 s"
    assert report._minutes(1_500, 3_000) == "0 min 01 s"
    assert report._minutes(1_499, 3_000) == "0 min 00 s"


# --- the commands -----------------------------------------------------------------------------


def test_layout_build_writes_the_files_the_report_and_the_checkers_document(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    out = tmp_path / "pack"
    code = cli.main(
        ["layout", "build", "rabiah", "--out", str(out), "--report", str(tmp_path / "rabiah.md")]
    )
    printed = capsys.readouterr()
    assert code == 0, printed.err
    assert "rabiah: 75 stands at 1 sites" in printed.out
    assert "the independent checker passes" in printed.out
    assert (out / "stands.bin").read_bytes() == rabiah().emitted.stands_bin
    assert json.loads((out / "worlds" / "rabiah.json").read_text()) == rabiah().emitted.world
    assert not (out / "lore").exists()
    assert (tmp_path / "rabiah.md").read_text().startswith("# Layout report: Rabiah")
    assert json.loads((tmp_path / "rabiah.check.json").read_text())["result"] == "pass"


def test_layout_build_writes_no_pack_file_when_the_checker_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
):
    # DEC-1091, N16: a build that the checker fails leaves nothing in the player's folder; its
    # report and the checker's document still name the violation.
    def failed(built: Built, table: trig.TrigTable) -> check.CheckResult:
        passed = check_built(built, table)
        return check.CheckResult(
            violations=("card-plane: a planted violation",),
            violation_count=1,
            assertions=passed.assertions,
            figures=passed.figures,
        )

    check_built = build.check_built
    monkeypatch.setattr(build, "check_built", failed)
    out = tmp_path / "data" / "pack"
    report_file = tmp_path / "rabiah.md"
    code = cli.main(["layout", "build", "rabiah", "--out", str(out), "--report", str(report_file)])
    printed = capsys.readouterr()
    assert code == 1
    assert "the first: card-plane: a planted violation. No file was written to" in printed.err
    assert not (tmp_path / "data").exists()
    assert "- card-plane: a planted violation" in report_file.read_text(encoding="utf-8")
    assert json.loads((tmp_path / "rabiah.check.json").read_text())["result"] == "fail"
    # With the checker green the files go to their place, and no temporary folder stays beside it.
    monkeypatch.setattr(build, "check_built", check_built)
    assert (
        cli.main(["layout", "build", "rabiah", "--out", str(out), "--report", str(report_file)])
        == 0
    )
    assert [path.name for path in (tmp_path / "data").iterdir()] == ["pack"]
    assert (out / "stands.bin").read_bytes() == rabiah().emitted.stands_bin


def test_layout_build_fails_naming_the_subject(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    fixture = next(found for found in fixtures.discover() if found.name == "degenerate-cell")
    code = cli.main(
        [
            "layout",
            "build",
            "tarkir",
            "--data",
            str(fixture.pack),
            "--lore-root",
            str(fixture.directory),
            "--fixture",
            "--out",
            str(tmp_path),
        ]
    )
    assert code == 1
    assert "layout build failed — region 'edge': degenerate cell" in capsys.readouterr().err
    assert not (tmp_path / "stands.bin").exists()
    assert cli.main(["layout", "build", "atlantis", "--out", str(tmp_path)]) == 1
    assert "has no plane 'atlantis'" in capsys.readouterr().err


# --- DEC-1091 delta re-read 1, kill case (D8 at the stands, the site stone and the clusters) ---


def test_the_stands_the_site_stone_and_the_cluster_centres_round_the_world_value():
    # 5.4.18 (3) at the three places of B4 where no fixture holds a tie (DEC-1091 delta re-read
    # 1): a site-frame value that ends in half a millimetre and moves to a world value of the
    # other sign is rounded half away from zero in the world, to 1 mm and not to 0.
    from dataclasses import replace

    built = rabiah()
    site = built.layout.sites[0]
    cx = site.centre[0]
    assert cx != 0
    sign = 1 if cx > 0 else -1
    half = sign * SCALE // 2 - cx * SCALE
    stand = replace(site.placement.stands[0], x=half)
    slot = replace(site.capacity.slots[0], centre=(sign - 2 * cx, 0), den=2)
    moved = replace(
        site,
        local=replace(site.local, stone=(half, site.local.stone[1])),
        placement=replace(site.placement, stands=(stand, *site.placement.stands[1:])),
        capacity=replace(site.capacity, slots=(slot, *site.capacity.slots[1:])),
    )
    layout = replace(built.layout, sites=(moved, *built.layout.sites[1:]))
    emitted = emit.emit(layout, built.plane, built.assignment, None, (), directions())
    first = site.plan.cards[0].oracle_id
    (record,) = [stand for stand in emitted.stands if stand.card.oracle_id == first]
    world = emitted.world["sites"][0]
    assert (record.x, world["stone"]["x"], world["clusters"][0]["centre"][0]) == (sign, sign, sign)
