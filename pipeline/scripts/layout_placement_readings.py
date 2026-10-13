"""Measure readings of the placement rules of PRD v4 5.4.10 on Dominaria's sites and on Rabiah.

Evidence for a ruling on DEC-1004. It goes away with the three switches it sets
(``capacity.ORDER``, ``placement.VERTEX_TRIES``, ``placement.UNDER_THREE``) when the CEO has ruled.

Inputs: dataset ``a5846bec28d1447e``, Dominaria's accepted tables with the keyword rule applied
(15 era sites and 11 regional sites, with their chapters), and Rabiah on the kit law: 27 sites.
Each site stands alone at one centre on the 10 m lattice; the world, the trail and the restarts
of 5.4.12 are not run.

For each reading the script prints two things.

1. **The census.** Each site at the first radius where it has capacity (5.4.9). Every kept slot
   is filled to its capacity with no stand limit, and no cluster ends the site. So the figures
   are what the rules accept per cluster, apart from the rule on a cluster under three.
2. **The site loop.** Each site is widened until every card has a stand, or twenty widenings
   have failed (5.4.9, 5.4.10).

Run from ``pipeline/``:
``uv run python -u scripts/layout_placement_readings.py [census] [loop] [reading ...]``.
With no reading named it runs all six; the readings are ``letter``, ``V``, ``W``, ``VW``, ``VWO``
and ``TVW``. A reading under which the sites fail takes long: a site that fails is built twenty
times, and its last radius is 6.7 times its first.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from eternities.layout import capacity, cards, local, placement, sites, trig
from eternities.layout.constants import SITE_WIDEN_LIMIT, site_seed
from eternities.layout.exact import Directions

REPO = Path(__file__).resolve().parents[2]
PACK = REPO / "web" / "public" / "data" / "a5846bec28d1447e"
LORE = REPO / "pipeline" / "data" / "lore" / "dominaria"
SITE = (500_000, 300_000)
"""Any centre on the 10 m lattice; the hexagonal lattice is global, so one is fixed."""

ALL = 1_000
"""More vertices than a 6 m window holds: a candidate may face any vertex of its window."""

READINGS = {
    "letter": ("The letter", "inner", "vertex", 1, "exhaust"),
    "V": (
        "V: a candidate faces the nearest vertex of its window that it fits",
        "inner",
        "vertex",
        ALL,
        "exhaust",
    ),
    "W": (
        "W: a cluster under three is withdrawn and its slot is void",
        "inner",
        "vertex",
        1,
        "void",
    ),
    "VW": ("V + W", "inner", "vertex", ALL, "void"),
    "VWO": (
        "V + W + O: candidates in order of distance to their path vertex",
        "inner",
        "distance",
        ALL,
        "void",
    ),
    "TVW": (
        "T + V + W: on a half-turn, a slot whose alternate side is the outer side is void",
        "alternate",
        "vertex",
        ALL,
        "void",
    ),
}

type Job = tuple[str, str, int, list[int]]


def _jobs() -> list[Job]:
    plane = cards.read_plane(PACK, "dominaria")
    regions, eras, keywords = (
        json.loads((LORE / name).read_text(encoding="utf-8"))
        for name in ("regions.json", "eras.json", "keywords.json")
    )
    assignment = sites.hero_assignment(plane, regions, eras, keywords)
    jobs: list[Job] = [
        (
            "dominaria",
            plan.key,
            plan.stands,
            [len(chapter.cards) for chapter in plan.chapters] or [plan.stands],
        )
        for plan in assignment.sites
    ]
    rabiah = sites.kit_assignment(cards.read_plane(PACK, "rabiah"))
    jobs.extend(("rabiah", plan.key, plan.stands, [plan.stands]) for plan in rabiah.sites)
    return jobs


def _with_capacity(
    job: Job, directions: Directions
) -> tuple[int, local.Local, capacity.Capacity] | None:
    """The site at the first radius where its capacity covers its stands and chapter stones."""
    plane, key, stands, chapters = job
    radius = local.base_radius(stands)
    for count in range(SITE_WIDEN_LIMIT + 1):
        built = local.build(radius, site_seed(plane, key), directions)
        if built is not None:
            found = capacity.capacity_of(built, SITE, stands, directions)
            if found.total - (len(chapters) - 1) >= stands:
                return count, built, found
        radius = local.widened(radius)
    return None


def _census(jobs: list[Job], directions: Directions) -> None:
    rule = placement.UNDER_THREE
    placement.UNDER_THREE = "keep"
    accepted = {False: Counter[int](), True: Counter[int]()}
    causes = [0] * len(placement.CAUSES)
    units = stands = considered = 0
    for job in jobs:
        found = _with_capacity(job, directions)
        if found is None:
            continue
        _, built, room = found
        placed = placement.place_site(built, room, [10**9], directions)
        per = Counter(stand.slot for stand in placed.stands)
        for position, slot in enumerate(room.slots):
            accepted[slot.on_turn][per[position]] += 1
            units += slot.capacity
        stands += len(placed.stands)
        considered += placed.considered
        causes = [a + b for a, b in zip(causes, placed.rejected, strict=True)]
    placement.UNDER_THREE = rule
    print("| Kept slots on | All | 0 | 1 | 2 | 3 | 4 | 5 | 6 to 8 | Under three |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for name, on_turn in (("runs", False), ("half-turns", True)):
        row = accepted[on_turn]
        every = sum(row.values())
        under = row[0] + row[1] + row[2]
        share = f"{under} ({100 * under // every} percent)" if every else "0"
        print(
            f"| {name} | {every} | {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | "
            f"{row[5]} | {row[6] + row[7] + row[8]} | {share} |"
        )
    print()
    print(
        f"Capacity counted by 5.4.9: {units} units. Stands accepted: {stands}. "
        f"Candidates considered: {considered}."
    )
    print()
    print("| Candidates rejected | Cause |")
    print("|---|---|")
    for name, count in zip(placement.CAUSES, causes, strict=True):
        print(f"| {count} | {name} |")
    print()


def _loop(jobs: list[Job], directions: Directions) -> None:
    print("| Site | Stands | Widenings | r_s (mm) | Kept slots | Clusters used | Last cause |")
    print("|---|---|---|---|---|---|---|")
    failed = widenings = 0
    for plane, key, stands, chapters in jobs:
        radius = local.base_radius(stands)
        row = ""
        cause = ""
        count = 0
        while not row:
            built = local.build(radius, site_seed(plane, key), directions)
            placed = None
            room = None
            if built is None:
                cause = "no path and approach"
            else:
                room = capacity.capacity_of(built, SITE, stands, directions)
                if room.total - (len(chapters) - 1) < stands:
                    cause = "capacity"
                else:
                    placed = placement.place_site(built, room, chapters, directions)
                    if placed.exhausted is not None:
                        cause = f"exhausted at {len(placed.stands)} stands"
            if placed is not None and room is not None and placed.exhausted is None:
                used = len({stand.slot for stand in placed.stands})
                row = f"{count} | {radius} | {len(room.slots)} | {used} | {cause or 'none'}"
            elif count == SITE_WIDEN_LIMIT:
                row = f"fails after 20 | {radius} | | | {cause}"
                failed += 1
            else:
                count += 1
                radius = local.widened(radius)
        if not row.startswith("fails"):
            widenings += count
        print(f"| `{key}` | {stands} | {row} |", flush=True)
    print()
    print(
        f"Sites that fail: {failed} of {len(jobs)}. Widenings of the sites that pass: {widenings}."
    )
    print()


def main(argv: list[str]) -> int:
    parts = [word for word in argv if word in ("census", "loop")] or ["census", "loop"]
    names = [word for word in argv if word in READINGS] or list(READINGS)
    directions = Directions(trig.load())
    jobs = _jobs()
    for name in names:
        title, sides, order, tries, under = READINGS[name]
        capacity.TURN_SIDES = sides
        capacity.ORDER = order
        placement.VERTEX_TRIES = tries
        placement.UNDER_THREE = under
        print(f"## {title}")
        print()
        if "census" in parts:
            _census(jobs, directions)
        if "loop" in parts:
            _loop(jobs, directions)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
