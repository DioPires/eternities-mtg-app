"""The layout report of one world (PRD v4 9.6, 4.13.7, 5.4.10, 5.4.15).

``report.md`` stands beside a world's emitted files and is a fixture with them, so it is a pure
function of the layout: no time, no path of the machine, no figure that a second run could print
differently. Every length is printed from its millimetre integer (DEC-976, N8) and every area
from its exact rational, rounded once to a whole square metre.

The walking times use the avatar's two speeds as ``Assets/Scripts/Avatar/AvatarController.cs``
defines them, ``WalkSpeed`` and ``RunSpeed``; a test reads that file and compares.

This module reads the allocator's layout and computes no position.
"""

from __future__ import annotations

import itertools
from collections import Counter
from collections.abc import Sequence
from typing import Any, Final

from . import local as local_step
from .allocate import CAPACITY, CUT, NO_PATH, RAN_OUT, Event, Layout, SiteLayout
from .build import Built
from .constants import APPROACH_LENGTH, MICRO_PER_COUNT, PLAZA_APPROACH_LENGTH
from .exact import SCALE, Directions, round_half_away
from .placement import yaw_gap
from .regions import doubled_area

WALK_SPEED: Final = 3_000
"""``AvatarController.WalkSpeed``, 3 m/s, in millimetres a second."""
RUN_SPEED: Final = 6_000
"""``AvatarController.RunSpeed``, 6 m/s, in millimetres a second."""

_SQUARE_METRE: Final = 1_000_000


def _mm(value: int) -> str:
    return f"{value:,}"


def _minutes(length: int, speed: int) -> str:
    """The time to cover ``length`` mm at ``speed`` mm/s, to the second, rounded half up."""
    seconds = (2 * length + speed) // (2 * speed)
    return f"{seconds // 60} min {seconds % 60:02d} s"


def _table(header: Sequence[str], rows: Sequence[Sequence[object]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines.extend("| " + " | ".join(str(cell) for cell in row) + " |" for row in rows)
    return lines


def site_gaps(site: SiteLayout) -> tuple[int, int, int]:
    """The three gaps of 5.4.10 on the trimmed path: to the first occupied slot, the largest
    between two occupied slots, and from the last one to the path's end."""
    slots = site.capacity.slots
    arcs = sorted({slots[stand.slot].arc for stand in site.placement.stands})
    if not arcs:
        return 0, 0, 0
    between = max((b - a for a, b in itertools.pairwise(arcs)), default=0)
    return arcs[0], between, site.local.arcs[site.placement.end] - arcs[-1]


def _passes(events: Sequence[Event]) -> list[list[object]]:
    rows: list[list[object]] = []
    number = restarts = widenings = radius = 0
    for event in events:
        if event.kind == "pass":
            number += 1
            restarts = widenings = 0
            radius = event.radius
        elif event.kind == "restart":
            restarts += 1
        elif event.kind == "widening":
            widenings += 1
        elif event.kind == "short":
            region = "the world" if event.region is None else f"`{event.region}`"
            site = "none" if event.site is None else f"`{event.site}`"
            rows.append([number, _mm(radius), widenings, restarts, region, site, event.text])
    rows.append([number, _mm(radius), widenings, restarts, "none", "none", "the world is laid out"])
    return rows


def _widening_rows(events: Sequence[Event]) -> list[list[object]]:
    """Every site widening in order: its pass over R, its site, its cause and what was found."""
    rows: list[list[object]] = []
    number = 0
    for event in events:
        if event.kind == "pass":
            number += 1
        elif event.kind == "widening":
            detail = event.text.split(": ", 1)[1].rsplit("; ", 1)[0]
            rows.append(
                [len(rows) + 1, number, f"`{event.site}`", event.cause, detail, _mm(event.radius)]
            )
    return rows


def _disc_area(radius: int, directions: Directions) -> int:
    """Twice the area of the 72-gon of ``radius`` (5.4.18 (13)), as a numerator over 2^60."""
    ring = directions.disc
    cross = sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(ring, (*ring[1:], ring[0]), strict=True))
    return radius * radius * cross


def _regions(layout: Layout, names: Sequence[str], directions: Directions) -> list[list[object]]:
    rows: list[list[object]] = []
    for position, (name, cell) in enumerate(zip(names, layout.cells, strict=True)):
        held = [site for site in layout.sites if site.region == position]
        area = doubled_area(cell)
        cell_m2 = round_half_away(area.numerator, 2 * _SQUARE_METRE * area.denominator)
        discs = sum(_disc_area(site.local.bounding, directions) for site in held)
        discs_m2 = round_half_away(discs, 2 * _SQUARE_METRE * SCALE * SCALE)
        # The share is the discs' exact area over the cell's exact area, in whole percent.
        share = 100 * discs * area.denominator // (SCALE * SCALE * area.numerator)
        rows.append([name, _mm(cell_m2), len(held), _mm(discs_m2), share])
    return rows


def _widenings(layout: Layout) -> dict[str, Counter[str]]:
    found: dict[str, Counter[str]] = {site.plan.key: Counter() for site in layout.sites}
    for event in layout.events:
        if event.kind == "widening" and event.site is not None and event.cause is not None:
            found[event.site][event.cause] += 1
    return found


def _slot_rows(layout: Layout) -> list[list[object]]:
    rows: list[list[object]] = []
    for site in layout.sites:
        census = site.capacity.census
        on_turn = {slot.number: slot.on_turn for slot in site.capacity.slots}
        withdrawn = Counter(on_turn[number] for number in site.placement.withdrawn)
        occupied = Counter(
            site.capacity.slots[position].on_turn
            for position in {stand.slot for stand in site.placement.stands}
        )
        rows.append(
            [
                f"`{site.plan.key}`",
                f"{census[0]} / {census[3]}",
                f"{census[1]} / {census[4]}",
                f"{census[2]} / {census[5]}",
                f"{withdrawn[False]} / {withdrawn[True]}",
                f"{occupied[False]} / {occupied[True]}",
            ]
        )
    return rows


def _vertex_figures(layout: Layout, directions: Directions) -> tuple[Counter[int], int, int]:
    """Stands by the rank of their path vertex, the largest turn from the nearest vertex in
    micro-degrees, and the largest arc length between the two vertices (ruling 2, V)."""
    ranks: Counter[int] = Counter()
    turn = apart = 0
    for site in layout.sites:
        path, arcs = site.local.path, site.local.arcs
        for stand in site.placement.stands:
            ranks[stand.rank] += 1
            if stand.rank == 0:
                continue
            nx, nz = path[stand.nearest]
            nearest = directions.count_of(nx * SCALE - stand.x, nz * SCALE - stand.z)
            turn = max(turn, yaw_gap(nearest, stand.yaw) * MICRO_PER_COUNT)
            apart = max(apart, abs(arcs[stand.vertex] - arcs[stand.nearest]))
    return ranks, turn, apart


def render(built: Built, check: dict[str, Any] | None, directions: Directions) -> str:
    """The report of one laid-out world. ``check`` is the independent checker's document."""
    layout, plane, assignment = built.layout, built.plane, built.assignment
    tables = built.tables
    stands = sum(site.plan.stands for site in layout.sites)
    kinds = Counter(site.plan.kind for site in layout.sites)
    widenings = _widenings(layout)
    total_widenings = Counter[str]()
    for counter in widenings.values():
        total_widenings.update(counter)
    lines: list[str] = [f"# Layout report: {plane.display_name} (`{plane.slug}`)", ""]
    lines.append(
        f"- Dataset: `{plane.data_hash}`. Plane index (v3 `planes.json`): {plane.plane_index}."
    )
    if tables is None:
        lines.append("- Law: the kit law. One set site for each set with first printings (5.4.2).")
    else:
        lines.append(
            f"- Law: the plane's lore tables ({tables.kind}). Digest `{tables.digest}`; "
            f"acceptance status: {tables.status}."
        )
    lines.append(
        f"- Stands: {_mm(stands)}. Sites: {len(layout.sites)} "
        f"({kinds['era']} era, {kinds['region']} regional, {kinds['set']} set). "
        f"Regions: {len(layout.cells)}. Hero volumes: {len(layout.volumes)}."
    )
    lines.append(
        f"- R₀ = {_mm(layout.initial_radius)} mm. R = {_mm(layout.radius)} mm after "
        f"{layout.passes} of 20 passes, so the world is {_mm(2 * layout.radius)} mm across. "
        f"Restarts at step (4): {layout.restarts}."
    )
    lines.append(
        f"- Site widenings: {sum(total_widenings.values())} "
        f"({total_widenings[CAPACITY]} for capacity, {total_widenings[NO_PATH]} for no path and "
        f"approach, {total_widenings[RAN_OUT]} where the kept slots ran out, "
        f"{total_widenings[CUT]} where two void slots in a row cut the path)."
    )
    lines.append(f"- Trig table: sha256 `{directions.sha256}` (5.4.18 (6)).")
    if check is not None:
        verdict = "pass" if check["result"] == "pass" else "FAIL"
        lines.append(
            f"- Independent checker (3.2): {verdict}, {check['violationCount']} violations."
        )
    lines.append("")

    lines += ["## Passes over R", ""]
    lines += _table(
        ["Pass", "R (mm)", "Site widenings", "Restarts", "Region", "Site", "Result"],
        _passes(layout.events),
    )
    lines.append("")

    names = (
        ["the world"] if tables is None else [f"`{row['id']}`" for row in tables.regions["regions"]]
    )
    lines += ["## Regions", ""]
    lines += _table(
        [
            "Region",
            "Cell area (m²)",
            "Sites",
            "Bounding discs' area (m²)",
            "Discs' share of the cell (percent, rounded down)",
        ],
        _regions(layout, names, directions),
    )
    lines.append("")

    lines += ["## Sites", ""]
    site_rows: list[list[object]] = []
    for position, site in enumerate(layout.sites):
        causes = widenings[site.plan.key]
        clusters = len({stand.slot for stand in site.placement.stands})
        site_rows.append(
            [
                position,
                f"`{site.plan.key}`",
                names[site.region],
                site.plan.stands,
                clusters,
                len(site.placement.stones),
                _mm(local_step.base_radius(site.plan.stands)),
                _mm(site.local.radius),
                _mm(site.local.bounding),
                site.widenings,
                f"{causes[CAPACITY]} / {causes[NO_PATH]} / {causes[RAN_OUT]} / {causes[CUT]}",
                site.local.tries,
                site.local.sweeps,
                site.capacity.total,
                f"{site.centre[0]:,}, {site.centre[1]:,}",
            ]
        )
    lines += _table(
        [
            "#",
            "Site",
            "Region",
            "Stands",
            "Clusters",
            "Chapter stones",
            "Base r_s (mm)",
            "Final r_s (mm)",
            "b_s (mm)",
            "Widenings",
            "By cause: capacity / no path / slots ran out / cut",
            "Sweep-direction tries",
            "Sweeps",
            "Capacity",
            "Centre (mm)",
        ],
        site_rows,
    )
    lines.append("")

    lines += ["## Site widenings in order", ""]
    widening_rows = _widening_rows(layout.events)
    if widening_rows:
        lines += _table(
            ["#", "Pass", "Site", "Cause", "What was found", "New r_s (mm)"], widening_rows
        )
    else:
        lines.append("No site is widened.")
    lines.append("")

    lines += ["## Sweep-direction tries (5.4.8)", ""]
    tried = [site for site in layout.sites if site.local.tries > 1]
    if tried:
        lines += _table(
            ["Site", "The try that passes", "Why each earlier try fails, in try order"],
            [
                [f"`{site.plan.key}`", site.local.tries, "; ".join(site.local.failures)]
                for site in tried
            ],
        )
    else:
        lines.append("Every site's first sweep direction passes.")
    lines.append("")

    lines += ["## Site paths and gaps (mm)", ""]
    path_rows: list[list[object]] = []
    for site in layout.sites:
        arcs = site.local.arcs
        first, between, last = site_gaps(site)
        cut = "none" if site.capacity.cut is None else _mm(site.capacity.cut)
        path_rows.append(
            [
                f"`{site.plan.key}`",
                _mm(arcs[-1]),
                cut,
                _mm(arcs[site.capacity.end]),
                _mm(arcs[site.placement.end]),
                _mm(first),
                _mm(between),
                _mm(last),
            ]
        )
    lines += _table(
        [
            "Site",
            "Path as built",
            "Cut at capacity",
            "Path after the cut",
            "Path after the trim",
            "Pad to first cluster",
            "Largest gap between clusters",
            "Last cluster to the path's end",
        ],
        path_rows,
    )
    lines += [
        "",
        "The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.",
        "",
        "## Slots on the final layout (on runs / on half-turns)",
        "",
    ]
    lines += _table(
        [
            "Site",
            "Kept at capacity",
            "Void: the disc is not inside the blob",
            "Void: under 3 candidates",
            "Withdrawn at placement",
            "Occupied",
        ],
        _slot_rows(layout),
    )
    lines.append("")

    sizes = Counter[int]()
    for site in layout.sites:
        sizes.update(Counter(stand.slot for stand in site.placement.stands).values())
    lines += ["## Clusters by size", ""]
    lines += _table(["Stands in the cluster", "Clusters"], [[n, sizes[n]] for n in sorted(sizes)])
    lines.append("")

    ranks, turn, apart = _vertex_figures(layout, directions)
    lines += ["## The path vertex of each stand (ruling 2, V)", ""]
    lines.append(
        f"{_mm(stands - ranks[0])} of {_mm(stands)} stands face a vertex other than the nearest "
        f"vertex of their window. The largest turn from the nearest vertex is {_mm(turn)} "
        f"micro-degrees. The largest arc length between the two vertices is {_mm(apart)} mm."
    )
    lines.append("")
    lines += _table(
        ["Rank of the path vertex in the window (0 is the nearest)", "Stands"],
        [[rank, ranks[rank]] for rank in sorted(ranks)],
    )
    lines.append("")

    lines += ["## The trail", ""]
    lines += _table(
        ["Leg", "Kind", "From", "To", "Length (mm)", "Cells routed", "Start cell blocked"],
        [
            [
                leg.index,
                leg.kind,
                leg.start,
                f"`{leg.end}`",
                _mm(leg.length),
                leg.cells,
                "yes" if leg.start_blocked else "no",
            ]
            for leg in layout.legs
        ],
    )
    trail = sum(leg.length for leg in layout.legs if leg.kind == "trail")
    spurs = sum(leg.length for leg in layout.legs if leg.kind == "spur")
    walk = PLAZA_APPROACH_LENGTH + trail + APPROACH_LENGTH
    lines += [
        "",
        f"- The trail's legs: {_mm(trail)} mm. The spurs: {_mm(spurs)} mm.",
        f"- From the plaza's edge path to the last site's pad on the trail: {_mm(walk)} mm "
        f"(the plaza approach, {_mm(PLAZA_APPROACH_LENGTH)} mm; the legs; the last approach, "
        f"{_mm(APPROACH_LENGTH)} mm). No site path is counted.",
        f"- At `AvatarController.WalkSpeed` ({_mm(WALK_SPEED)} mm/s): "
        f"{_minutes(walk, WALK_SPEED)}. At `AvatarController.RunSpeed` ({_mm(RUN_SPEED)} mm/s): "
        f"{_minutes(walk, RUN_SPEED)}.",
        "",
    ]

    if tables is not None:
        moved = [move for move in assignment.keyword_matches if move.moved]
        lines += ["## Keyword assignments (5.4.3)", ""]
        lines.append(
            f"{len(assignment.keyword_matches)} cards have a selected keyword. "
            f"{len(moved)} of them stand at a regional site; the others stand at their era's "
            "site, which lies in the keyword's region."
        )
        lines.append("")
        lines += _table(
            ["Card", "Keyword", "Region", "Era", "Stands at"],
            [
                [
                    move.card.name,
                    move.keyword,
                    f"`{move.region}`",
                    f"`{move.era}`",
                    f"`region:{move.region}`" if move.moved else f"`era:{move.era}`",
                ]
                for move in assignment.keyword_matches
            ],
        )
        lines += ["", "### Cards whose name matches keywords of two regions", ""]
        if assignment.two_regions:
            lines += _table(
                ["Card", "Regions, in keyword order"],
                [
                    [card.name, ", ".join(f"`{region}`" for region in regions)]
                    for card, regions in assignment.two_regions
                ],
            )
        else:
            lines.append("None.")
        lines += ["", "### Empty chapters", ""]
        if assignment.empty_chapters:
            lines += _table(
                ["Era", "Set"],
                [[f"`{era}`", f"`{code}`"] for era, code in assignment.empty_chapters],
            )
        else:
            lines.append("None.")
        lines += ["", "## Headline cards per era (5.13.2)", ""]
        lines += _table(
            ["Era", "Rule", "Cards"],
            [
                [f"`{era}`", rule, "; ".join(cards) if cards else "none"]
                for era, rule, cards in built.emitted.headlines
            ],
        )
        lines.append("")

    if check is not None:
        lines += ["## The independent checker (3.2, 5.4.10)", ""]
        figures = check["figures"]
        spacing = figures["minimumStandSpacing"]
        lines.append(
            f"- Result: {check['result']}. Violations: {check['violationCount']}. "
            f"Path network connected: {'yes' if figures['connected'] else 'no'}. "
            f"Least distance between two stands: "
            f"{'none' if spacing is None else _mm(spacing) + ' mm'}."
        )
        lines.append("")
        lines += _table(
            ["Assertion", "Tested"],
            [[name, _mm(count)] for name, count in sorted(check["assertions"].items())],
        )
        if check["violations"]:
            lines += ["", "### Violations", ""]
            lines += [f"- {message}" for message in check["violations"]]
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"
