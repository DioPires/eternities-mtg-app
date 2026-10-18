"""Emission of one world's layout: ``stands.bin``, ``worlds/<slug>.json``, ``lore/<slug>.json``.

PRD v4 4.13.3, 4.13.5 and 4.16.3, as leg 1 of the second slice emits them (9.6): one world's
records beside the slice's pinned v3 pack. ``docs/data-contract-v4.md`` has the fields and every
departure from the full contract v4, which is Wave 5.

Every coordinate is rounded here, once, by the rule of 5.4.18 (3); the polylines were rounded
when they were built (5.4.18 (5)) and are written as they are. A site's geometry is built in the
site's frame. An exact coordinate is moved to the world by the site's centre, a whole number of
millimetres, and the world value is rounded: rounding half away from zero does not commute with
the move. A local z of 6,519.5 mm at a centre z of -100,000 mm is -93,480.5 mm in the world and
is emitted as -93,481; rounding in the site's frame first would give 6,520 - 100,000 = -93,480.
A coordinate that is already whole (a rounded polyline, a pad, a lattice point) is moved as it is.

The JSON files are written in the canonical form of Appendix F.2 (keys sorted by code point, no
white space, UTF-8 as itself) and end with one line feed, so their bytes are stable.
"""

from __future__ import annotations

import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

from ..lore.digest import canonical
from .allocate import RETURN_PAD, Layout, SiteLayout
from .cards import PlaneCard, PlaneCards
from .constants import (
    ARRIVAL_YAW,
    COUNTS_PER_TURN,
    MICRO_PER_COUNT,
    PAD_RADIUS,
    PLAZA_EDGE_RADIUS,
    PLAZA_RADIUS,
    RETURN_PORTAL_SOUTH,
)
from .exact import SCALE, Directions, Pt, round_half_away
from .geometry import Shape
from .sites import Assignment, Flagged, headline_cards

CONTRACT_VERSION: Final = 4
STANDS_KIND: Final = 1
"""The header's kind byte: 1 was v3's star records and is v4's stand records."""
_HEADER: Final = struct.Struct("<4sBBHII")
_RECORD: Final = struct.Struct("<16sBBBBBBHHHiiiHHHH")
RECORD_BYTES: Final = 48
assert _RECORD.size == RECORD_BYTES

MARKER_UNDER: Final = 5
"""A set site under five stands has a marker stone, not a waystone (5.4.16)."""


@dataclass(frozen=True, slots=True)
class EmittedStand:
    index: int
    """The stand index: the record's position in ``stands.bin``."""
    card: PlaneCard
    site: int
    cluster: int
    x: int
    z: int
    yaw: int
    """Micro-degrees."""
    vertex: int
    arc: int


@dataclass(frozen=True, slots=True)
class Emitted:
    stands: tuple[EmittedStand, ...]
    stands_bin: bytes
    world: dict[str, Any]
    lore: dict[str, Any] | None
    headlines: tuple[tuple[str, str, tuple[str, ...]], ...]
    """Per era: its id, the rule that chose its headline cards, and their names."""

    def write(self, out: Path, slug: str) -> list[Path]:
        """Write the files under ``out`` and return their paths."""
        written = [out.joinpath("stands.bin"), out.joinpath("worlds", f"{slug}.json")]
        written[0].parent.mkdir(parents=True, exist_ok=True)
        written[0].write_bytes(self.stands_bin)
        written[1].parent.mkdir(parents=True, exist_ok=True)
        written[1].write_text(to_json(self.world), encoding="utf-8")
        if self.lore is not None:
            path = out.joinpath("lore", f"{slug}.json")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(to_json(self.lore), encoding="utf-8")
            written.append(path)
        return written


def to_json(document: dict[str, Any]) -> str:
    return canonical(document) + "\n"


def _placed(num: int, den: int, centre: int) -> int:
    """The world coordinate of the exact site-frame value ``num / den``: moved, then rounded once
    (5.4.18 (3))."""
    return round_half_away(num + centre * den, den)


def _rounded(shape: Shape, centre: Pt = (0, 0)) -> list[list[int]]:
    """A shape's vertices as whole millimetres in the world, with no vertex repeated in a row."""
    out: list[list[int]] = []
    for x, z in shape.pts:
        point = [_placed(x, shape.den, centre[0]), _placed(z, shape.den, centre[1])]
        if not out or out[-1] != point:
            out.append(point)
    if shape.closed and len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def _moved(points: Sequence[Pt], centre: Pt) -> list[list[int]]:
    return [[x + centre[0], z + centre[1]] for x, z in points]


def _clusters(site: SiteLayout) -> dict[int, int]:
    """Kept slot to cluster index: the slots that hold a stand, in slot order."""
    occupied = sorted({stand.slot for stand in site.placement.stands})
    return {slot: index for index, slot in enumerate(occupied)}


def _stone_kind(site: SiteLayout) -> str:
    if site.plan.kind == "era":
        return "reading"
    if site.plan.kind == "set" and site.plan.stands < MARKER_UNDER:
        return "marker"
    return "way"


def emit(
    layout: Layout,
    plane: PlaneCards,
    assignment: Assignment,
    tables: tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None,
    flagged: Sequence[Flagged],
    directions: Directions,
    *,
    kind: str = "lore",
    digest: str | None = None,
) -> Emitted:
    """The three files of one laid-out world. ``tables`` is (regions, eras, keywords) or None."""
    rows: list[tuple[int, int, bytes, PlaneCard, int, int, int, int, int]] = []
    for position, site in enumerate(layout.sites):
        clusters = _clusters(site)
        cx, cz = site.centre
        for card, stand in zip(site.plan.cards, site.placement.stands, strict=True):
            rows.append(
                (
                    position,
                    clusters[stand.slot],
                    card.order_key,
                    card,
                    _placed(stand.x, SCALE, cx),
                    _placed(stand.z, SCALE, cz),
                    stand.yaw * MICRO_PER_COUNT,
                    stand.vertex,
                    site.local.arcs[stand.vertex],
                )
            )
    rows.sort(key=lambda row: row[:3])
    stands = tuple(
        EmittedStand(
            index=index,
            card=row[3],
            site=row[0],
            cluster=row[1],
            x=row[4],
            z=row[5],
            yaw=row[6],
            vertex=row[7],
            arc=row[8],
        )
        for index, row in enumerate(rows)
    )
    data = bytearray(_HEADER.pack(b"ETRN", STANDS_KIND, CONTRACT_VERSION, 0, len(stands), 0))
    for stand in stands:
        card = stand.card
        data += _RECORD.pack(
            card.order_key,
            plane.plane_index,
            card.identity,
            card.colour_class,
            card.rarity,
            card.type_mask,
            1 if card.back_image else 0,
            stand.site,
            card.set_id,
            card.printings,
            stand.x,
            stand.z,
            stand.yaw,
            card.swatch,
            card.shard,
            card.shard_slot,
            stand.cluster,
        )
    index_of = {stand.card.oracle_id: stand.index for stand in stands}
    world = _world(layout, plane, assignment, tables, stands, index_of, directions)
    lore: dict[str, Any] | None = None
    headlines: list[tuple[str, str, tuple[str, ...]]] = []
    if tables is not None:
        lore, headlines = _lore(plane, tables, flagged, index_of, kind, digest)
    return Emitted(
        stands=stands,
        stands_bin=bytes(data),
        world=world,
        lore=lore,
        headlines=tuple(headlines),
    )


def _world(
    layout: Layout,
    plane: PlaneCards,
    assignment: Assignment,
    tables: tuple[dict[str, Any], dict[str, Any], dict[str, Any]] | None,
    stands: Sequence[EmittedStand],
    index_of: dict[str, int],
    directions: Directions,
) -> dict[str, Any]:
    cluster_of = {stand.index: stand.cluster for stand in stands}
    sites: list[dict[str, Any]] = []
    pads: list[dict[str, Any]] = [
        {"owner": "return", "x": RETURN_PAD[0], "z": RETURN_PAD[1], "radius": PAD_RADIUS}
    ]
    for site in layout.sites:
        local, centre = site.local, site.centre
        cx, cz = centre
        placement = site.placement
        clusters = _clusters(site)
        counts = [0] * len(clusters)
        for stand in placement.stands:
            counts[clusters[stand.slot]] += 1
        pad = (local.pad[0] + cx, local.pad[1] + cz)
        stone_x = _placed(local.stone[0], SCALE, cx)
        stone_z = _placed(local.stone[1], SCALE, cz)
        stone_yaw = directions.count_of(
            local.pad[0] * SCALE - local.stone[0], local.pad[1] * SCALE - local.stone[1]
        )
        pad_pose = {
            "x": pad[0],
            "z": pad[1],
            "yaw": (local.head_count + COUNTS_PER_TURN // 2) % COUNTS_PER_TURN * MICRO_PER_COUNT,
        }
        chapters: list[dict[str, Any]] = []
        stone_of = {stone.chapter: stone for stone in placement.stones}
        for number, chapter in enumerate(site.plan.chapters):
            first = index_of[chapter.cards[0].oracle_id]
            stone = stone_of.get(number)
            pose: dict[str, int] | None = None
            if stone is not None:
                vx, vz = local.path[stone.vertex]
                pose = {
                    "x": stone.x + cx,
                    "z": stone.z + cz,
                    "yaw": directions.count_of(vx - stone.x, vz - stone.z) * MICRO_PER_COUNT,
                }
            chapters.append(
                {
                    "setId": chapter.set.id,
                    "firstStand": first,
                    "firstCluster": cluster_of[first],
                    "stone": pose,
                    "destination": pad_pose if pose is None else pose,
                }
            )
        sites.append(
            {
                "key": site.plan.key,
                "kind": site.plan.kind,
                "regionId": site.plan.region,
                "eraId": site.plan.era,
                "setIds": [record.id for record in site.plan.sets],
                "centre": [cx, cz],
                "radius": local.radius,
                "boundingRadius": local.bounding,
                "blob": _rounded(local.blob, centre),
                "path": _moved(local.path[: placement.end + 1], centre),
                "pad": pad_pose,
                "approachPoint": [local.approach_point[0] + cx, local.approach_point[1] + cz],
                "stone": {
                    "kind": _stone_kind(site),
                    "x": stone_x,
                    "z": stone_z,
                    "yaw": stone_yaw * MICRO_PER_COUNT,
                },
                "clusters": [
                    {
                        "centre": [
                            _placed(slot.centre[0], slot.den, cx),
                            _placed(slot.centre[1], slot.den, cz),
                        ],
                        "arc": slot.arc,
                        "stands": counts[clusters[position]],
                    }
                    for position, slot in enumerate(site.capacity.slots)
                    if position in clusters
                ],
                "chapters": chapters,
            }
        )
        pads.append({"owner": site.plan.key, "x": pad[0], "z": pad[1], "radius": PAD_RADIUS})

    region_rows: list[dict[str, Any]] = (
        [{}] if tables is None else cast("list[dict[str, Any]]", tables[0]["regions"])
    )
    regions: list[dict[str, Any]] = []
    for position, (row, cell) in enumerate(zip(region_rows, layout.cells, strict=True)):
        first = next((i for i, site in enumerate(layout.sites) if site.region == position), None)
        regions.append(
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "kit": row.get("kit"),
                "variant": row.get("variant"),
                "water": row.get("water"),
                "ambient": row.get("ambient"),
                "cell": _rounded(cell),
                "firstSite": first,
            }
        )

    # A junction is an end of a leg: the far end of the plaza approach, a site's approach point,
    # or the vertex of the trail where a spur starts. It lists every leg that has the point as a
    # vertex.
    owners: dict[Pt, str] = {}
    if layout.approach is not None:
        owners[layout.approach.far] = "plaza"
    for site in layout.sites:
        point = site.local.approach_point
        owners[(point[0] + site.centre[0], point[1] + site.centre[1])] = site.plan.key
    vertices = [set(leg.polyline) for leg in layout.legs]
    ends: list[Pt] = []
    legs: list[dict[str, Any]] = []
    for leg in layout.legs:
        legs.append(
            {
                "id": leg.index,
                "kind": leg.kind,
                "from": leg.start,
                "to": leg.end,
                "polyline": [list(point) for point in leg.polyline],
                "startAttachment": [list(point) for point in leg.start_attachment],
                "endAttachment": [list(point) for point in leg.end_attachment],
            }
        )
        for point in (leg.polyline[0], leg.polyline[-1]):
            if point not in ends:
                ends.append(point)
    approach = layout.approach
    return {
        "contractVersion": CONTRACT_VERSION,
        "slug": plane.slug,
        "planeIndex": plane.plane_index,
        "dataHash": plane.data_hash,
        "law": assignment.law,
        "radius": layout.radius,
        "standCount": len(stands),
        "arrival": {"x": 0, "z": 0, "yaw": ARRIVAL_YAW},
        "returnPortal": {"x": 0, "z": -RETURN_PORTAL_SOUTH, "yaw": ARRIVAL_YAW},
        "plaza": {
            "radius": PLAZA_RADIUS,
            "edgeRadius": PLAZA_EDGE_RADIUS,
            "approach": None if approach is None else [list(approach.near), list(approach.far)],
        },
        "pads": pads,
        "heroVolumes": [
            {"id": volume.id, "polygon": _rounded(volume.shape)} for volume in layout.volumes
        ],
        "regions": regions,
        "sites": sites,
        "trail": {
            "legs": legs,
            "junctions": [
                {
                    "point": list(point),
                    "owner": owners.get(point),
                    "legs": [
                        leg.index
                        for leg, held in zip(layout.legs, vertices, strict=True)
                        if point in held
                    ],
                }
                for point in ends
            ],
        },
        "stands": {
            "vertex": [stand.vertex for stand in stands],
            "arc": [stand.arc for stand in stands],
        },
    }


def _lore(
    plane: PlaneCards,
    tables: tuple[dict[str, Any], dict[str, Any], dict[str, Any]],
    flagged: Sequence[Flagged],
    index_of: dict[str, int],
    kind: str,
    digest: str | None,
) -> tuple[dict[str, Any], list[tuple[str, str, tuple[str, ...]]]]:
    """The resolved tables of 4.16.3, with each era's headline stand indices (5.13.2)."""
    regions, eras, keywords = tables
    set_id = {record.code: record.id for record in plane.sets}
    headlines: list[tuple[str, str, tuple[str, ...]]] = []
    era_rows: list[dict[str, Any]] = []
    for era in cast("list[dict[str, Any]]", eras["eras"]):
        cards, rule = headline_cards(era, plane, flagged)
        headlines.append((str(era["id"]), rule, tuple(card.name for card in cards)))
        paragraphs = cast("list[list[dict[str, Any]]]", era["paragraphs"])
        era_rows.append(
            {
                "id": era["id"],
                "name": era["name"],
                "years": era["years"],
                "region": era["region"],
                "sets": era["sets"],
                "setIds": [
                    set_id[code] for code in cast("list[str]", era["sets"]) if code in set_id
                ],
                "paragraphs": paragraphs,
                "sources": list(
                    dict.fromkeys(
                        str(sentence["source"])
                        for paragraph in paragraphs
                        for sentence in paragraph
                    )
                ),
                "headline": [index_of[card.oracle_id] for card in cards],
            }
        )
    document = {
        "contractVersion": CONTRACT_VERSION,
        "slug": plane.slug,
        "kind": kind,
        "digest": digest,
        "regions": [
            {
                "id": row["id"],
                "name": row["name"],
                "sentence": row["sentence"],
                "sources": row["sources"],
            }
            for row in cast("list[dict[str, Any]]", regions["regions"])
        ],
        "eras": era_rows,
        "keywords": keywords["keywords"],
    }
    return document, headlines
