"""Measure readings of the cut rule of PRD v4 5.4.9 on Dominaria's era sites and on Rabiah.

Evidence for the hand-back of 2026-10-13 on DEC-1004. It goes away with the three switches it
sets, when the CEO has ruled on the reading.

For each site it builds the local geometry (5.4.7, 5.4.8) at the base radius, counts the capacity
(5.4.9) and widens the site until the capacity covers its stands and chapter stones, or twenty
widenings have failed. Keyword moves and placement (5.4.10) are not applied: the stand count of
an era site is the count of cards first printed in its sets.

Run from ``pipeline/``: ``uv run python scripts/layout_cut_readings.py``.
"""

from __future__ import annotations

import itertools
import json
import sys
from collections import Counter
from pathlib import Path

from eternities.layout import capacity, local, trig
from eternities.layout.constants import SITE_WIDEN_LIMIT, site_seed
from eternities.layout.exact import Directions
from eternities.lore import LoreIndex

REPO = Path(__file__).resolve().parents[2]
PACK = REPO / "web" / "public" / "data" / "a5846bec28d1447e"
ERAS = REPO / "pipeline" / "data" / "lore" / "dominaria" / "eras.json"
SITE = (500_000, 300_000)
"""Any centre on the 10 m lattice; the hexagonal lattice is global, so one is fixed."""

READINGS = (
    ("letter", "letter", 0, False),
    ("A: a void slot on a half-turn is passed over", "skip", 0, False),
    ("B: the half-turn inside the blob, the vertex inside the window", "letter", 10_500, True),
)


def _sites() -> list[tuple[str, str, int, int]]:
    index = LoreIndex.from_pack(PACK)
    by_set = Counter(card.first_set for card in index.cards_on("dominaria"))
    eras = json.loads(ERAS.read_text(encoding="utf-8"))["eras"]
    sites = [
        (
            "dominaria",
            f"era:{era['id']}",
            sum(by_set[code] for code in era["sets"]),
            sum(1 for code in era["sets"] if by_set[code]) - 1,
        )
        for era in eras
    ]
    sites.append(("rabiah", "set:arn", len(index.cards_on("rabiah")), 0))
    return sites


def _census(sites: list[tuple[str, str, int, int]], directions: Directions) -> None:
    """Every slot of every site at its base radius, with no cut applied, under the letter."""
    totals = [0, 0, 0, 0, 0, 0]
    turns = arc = 0
    for plane, key, stands, _ in sites:
        built = local.build(local.base_radius(stands), site_seed(plane, key), directions)
        if built is None:
            continue
        found = capacity.capacity_of(built, SITE, stands, directions, turn_rule="census")
        totals = [a + b for a, b in zip(totals, found.census, strict=True)]
        for index, turn in enumerate(built.turn):
            if turn != 0:
                arc += built.arcs[index + 1] - built.arcs[index]
                turns += index == 0 or built.turn[index - 1] == 0
    print("## The slots, at the base radius, with no cut applied")
    print("| Slots on | All | Kept | Void: disc not inside the blob | Void: under 3 candidates |")
    print("|---|---|---|---|---|")
    for name, (kept, disc, few) in (("runs", totals[:3]), ("half-turns", totals[3:])):
        print(f"| {name} | {kept + disc + few} | {kept} | {disc} | {few} |")
    print()
    print(f"Half-turns: {turns}. Their arc length in all: {arc} mm.")
    print()


def main() -> int:
    directions = Directions(trig.load())
    sites = _sites()
    _census(sites, directions)
    for title, turn_rule, inset, window in READINGS:
        local.TURN_INSET = inset
        capacity.WINDOW_VERTEX = window
        print(f"## {title}")
        print("| Site | Stands | Widenings | r_s (mm) | Sweeps | Path (m) | Kept | Void | Cut at |")
        print("|---|---|---|---|---|---|---|---|---|")
        failed = widenings = largest = 0
        for plane, key, stands, stones in sites:
            radius = local.base_radius(stands)
            row = None
            for count in range(SITE_WIDEN_LIMIT + 1):
                built = local.build(radius, site_seed(plane, key), directions)
                if built is not None:
                    found = capacity.capacity_of(
                        built, SITE, stands, directions, turn_rule=turn_rule
                    )
                    if found.total - stones >= stands:
                        row = (count, built, found)
                        break
                radius = local.widened(radius)
            if row is None:
                failed += 1
                print(f"| `{key}` | {stands} | fails after 20 | | | | | | |")
                continue
            count, built, found = row
            widenings += count
            arcs = [0, *(slot.arc for slot in found.slots)]
            largest = max(largest, *(b - a for a, b in itertools.pairwise(arcs)))
            cut = "none" if found.cut is None else f"{found.cut // 1000} m"
            print(
                f"| `{key}` | {stands} | {count} | {built.radius} | {built.sweeps} | "
                f"{built.arcs[-1] // 1000} | {len(found.slots)} | {found.void} | {cut} |"
            )
        print()
        print(
            f"Sites that fail: {failed}. Widenings in all: {widenings}. Largest arc length "
            f"between kept slots: {largest // 1000} m."
        )
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
