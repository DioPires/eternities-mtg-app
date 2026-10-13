"""One world from its inputs to its emitted files (PRD v4 9.6, leg 1 of the second slice).

The steps are those of 5.4.12 with their inputs read first: the plane's cards from a contract v3
pack, the hero entry's validated lore tables or the kit law, an optional hero-volumes file, and
the committed trig table. This module computes no position; it calls the allocator once and hands
its layout to the emission.

**The hero-volumes file** is the minimal form that ``docs/data-contract-v4.md`` documents: a JSON
object ``{"plane": <slug>, "volumes": [{"id": <id>, "polygon": [[x, z], ...]}, ...]}`` with
whole millimetres in the world frame. The owner's exporter is Wave 5.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

from ..lore import LoreIndex, LoreIndexError, LoreTables, LoreValidationError, validate_directory
from ..lore.spotlight import SIDECAR_NAME, validate_sidecar
from ..lore.tables import has_tables
from . import allocate, cards, check, emit, regions, sites, trig
from .allocate import Layout, Volume
from .cards import PlaneCards
from .check import CheckedCard, CheckResult
from .emit import Emitted
from .exact import Directions
from .geometry import polygon
from .regions import RegionRow
from .sites import Assignment, Flagged

_ID: Final = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class VolumesError(RuntimeError):
    """The hero-volumes file does not have the form the contract note gives."""


FAILURES: Final = (
    LoreValidationError,
    LoreIndexError,
    cards.PackError,
    sites.AssignmentError,
    regions.DegenerateCell,
    allocate.LayoutError,
    VolumesError,
)
"""The failures that name their subject (5.4.12, 4.16.2): a build reports one and stops."""


@dataclass(frozen=True, slots=True)
class Built:
    plane: PlaneCards
    tables: LoreTables | None
    """The validated lore tables, or None when the world is laid out by the kit law."""
    assignment: Assignment
    layout: Layout
    emitted: Emitted


def load_directions() -> Directions:
    """The committed trig table, its SHA-256 asserted (5.4.18 (6))."""
    return Directions(trig.load())


def read_volumes(path: Path, slug: str) -> list[Volume]:
    """The hero volumes of one world from the minimal file form."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise VolumesError(f"{path.name}: cannot be read as JSON ({error})") from None
    if not isinstance(document, dict) or set(cast("dict[str, Any]", document)) != {
        "plane",
        "volumes",
    }:
        raise VolumesError(f"{path.name}: the file holds exactly `plane` and `volumes`")
    top = cast("dict[str, Any]", document)
    if top["plane"] != slug:
        raise VolumesError(f"{path.name}: the file is for {top['plane']!r}, not for {slug!r}")
    rows = top["volumes"]
    if not isinstance(rows, list):
        raise VolumesError(f"{path.name}: `volumes` is a list")
    found: list[Volume] = []
    seen: set[str] = set()
    for position, row in enumerate(cast("list[Any]", rows)):
        where = f"{path.name}: volume {position}"
        if not isinstance(row, dict) or set(cast("dict[str, Any]", row)) != {"id", "polygon"}:
            raise VolumesError(f"{where} holds exactly `id` and `polygon`")
        entry = cast("dict[str, Any]", row)
        ident = entry["id"]
        if not isinstance(ident, str) or _ID.fullmatch(ident) is None or ident in seen:
            raise VolumesError(f"{where}: `id` is a slug that no other volume has")
        seen.add(ident)
        points = entry["polygon"]
        if not isinstance(points, list) or len(cast("list[Any]", points)) < 3:
            raise VolumesError(f"{where} ({ident}): `polygon` has three vertices or more")
        vertices: list[tuple[int, int]] = []
        for point in cast("list[Any]", points):
            pair = cast("list[Any]", point) if isinstance(point, list) else []
            if len(pair) != 2 or not all(type(value) is int for value in pair):
                raise VolumesError(
                    f"{where} ({ident}): a vertex is a pair of whole millimetres [x, z]"
                )
            vertices.append((int(pair[0]), int(pair[1])))
        found.append(Volume(id=ident, shape=polygon(vertices)))
    return found


def region_rows(regions: dict[str, Any]) -> list[RegionRow]:
    return [
        RegionRow(
            id=str(row["id"]),
            anchor=(int(row["anchor"][0]), int(row["anchor"][1])),
            weight=int(row["weight"]),
        )
        for row in cast("list[dict[str, Any]]", regions["regions"])
    ]


def build_world(
    slug: str,
    data_dir: Path,
    directions: Directions,
    *,
    lore_dir: Path | None = None,
    hero_entries: Sequence[str] = (),
    fixture: bool = False,
    volumes: Path | None = None,
    lore_display: str | None = None,
) -> Built:
    """Lay ``slug`` out from the pack at ``data_dir`` and return its layout and its files.

    ``lore_dir`` is the entry's own directory, ``<lore root>/<slug>``. When it holds tables the
    world is laid out from them, after they validate against the pack (4.16.2; ``fixture`` relaxes
    the row minimums and the ``accepted`` requirement, 5.4.14). Otherwise the kit law applies.
    ``lore_display`` is the directory's name in a validation message; it defaults to the path.
    Raises one of :data:`FAILURES` as it is: each names its subject.
    """
    plane = cards.read_plane(data_dir, slug)
    tables: LoreTables | None = None
    flagged: list[Flagged] = []
    if lore_dir is not None and has_tables(lore_dir):
        index = LoreIndex.from_pack(data_dir)
        heroes = tuple(hero_entries)
        spotlight_sets: frozenset[str] | None = None
        if (lore_dir / SIDECAR_NAME).exists():
            sidecar = validate_sidecar(
                lore_dir / SIDECAR_NAME, index, hero_entries=heroes, display=lore_display
            )
            spotlight_sets = sidecar.sets_with_cards
            flagged = [
                Flagged(p.oracle_id, p.set_code, p.collector_number) for p in sidecar.headline
            ]
        tables = validate_directory(
            lore_dir,
            index,
            hero_entries=heroes,
            fixture=fixture,
            spotlight_sets=spotlight_sets,
            display=lore_display,
        )
    held = [] if volumes is None else read_volumes(volumes, slug)
    if tables is None:
        assignment = sites.kit_assignment(plane)
        rows = None
        triple = None
    else:
        assignment = sites.hero_assignment(plane, tables.regions, tables.eras, tables.keywords)
        rows = region_rows(tables.regions)
        triple = (tables.regions, tables.eras, tables.keywords)
    layout = allocate.allocate(slug, assignment.sites, rows, held, directions)
    emitted = emit.emit(
        layout,
        plane,
        assignment,
        triple,
        flagged,
        directions,
        kind="lore" if tables is None else tables.kind,
        digest=None if tables is None else tables.digest,
    )
    return Built(plane=plane, tables=tables, assignment=assignment, layout=layout, emitted=emitted)


def check_built(built: Built, table: trig.TrigTable) -> CheckResult:
    """Run the independent checker (3.2) on a world's emitted files, as a reader would read them.

    The world and lore documents pass through their written form first, so the checker sees the
    integers of the files and nothing the allocator still holds.
    """
    emitted = built.emitted
    world = cast("dict[str, Any]", json.loads(emit.to_json(emitted.world)))
    lore = (
        None
        if emitted.lore is None
        else cast("dict[str, Any]", json.loads(emit.to_json(emitted.lore)))
    )
    held = [
        CheckedCard(
            oracle_id=card.oracle_id,
            set_id=card.set_id,
            names=(card.name,) if card.back_name is None else (card.name, card.back_name),
        )
        for card in built.plane.cards
    ]
    return check.check_world(emitted.stands_bin, world, lore, held, table)
