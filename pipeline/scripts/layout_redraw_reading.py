"""Measure reading X, a redraw at the same radius, beside the law (V + W) of DEC-1004.

Evidence for the CEO's ruling on X (DEC-1004 ruling 2, item 9; DEC-1040 note 14). The script and
the ``redraw_limit`` parameter of ``allocate.allocate`` go, or X becomes the law, with that
ruling. Every fixture is emitted under the law, ``redraw_limit=0``.

**Reading X.** Each site keeps a redraw count ``a``, 0 at the start and kept across passes and
restarts. Its seed string is that of 5.4.1 at ``a = 0`` and gains ``|<a>`` at ``a >= 1``. When
placement exhausts a site and ``a`` is under the limit, ``a`` goes up by one, r_s stays and the
pass restarts at step (4) of 5.4.12. At the limit the site is widened as today. A widening for
any cause returns ``a`` to 0.

Inputs: dataset ``a5846bec28d1447e``, Dominaria's accepted tables, and the four kit worlds
(Rabiah, Zhalfir, Vryn, Shandalar). Each world runs end to end by the order of computation of
5.4.12. No checker runs here.

**A second reading, J, measured beside X.** The site keeps its seed, so its blob, its path and
its capacity stay. Only the jitter draws of placement take a new stream: that of the seed
string with ``|jitter|<a>``. The count, the limit and the widening rule are those of X.

Run from ``pipeline/``:
``uv run python -u scripts/layout_redraw_reading.py [limit ...] [j<limit> ...]``. A plain number
is a limit of X and ``j3`` is J with the limit 3. With nothing named it runs 0 (the law) and X
at 1, 3 and 7.
"""

from __future__ import annotations

import json
import sys
import time
from collections import Counter
from pathlib import Path

from eternities.layout import allocate, build, cards, sites
from eternities.layout.exact import Directions

REPO = Path(__file__).resolve().parents[2]
PACK = REPO / "web" / "public" / "data" / "a5846bec28d1447e"
LORE = REPO / "pipeline" / "data" / "lore" / "dominaria"
KIT_WORLDS = ("rabiah", "zhalfir", "vryn", "shandalar")
LIMITS = (0, 1, 3, 7)


def _dominaria(limit: int, scope: str, directions: Directions) -> None:
    plane = cards.read_plane(PACK, "dominaria")
    regions, eras, keywords = (
        json.loads((LORE / name).read_text(encoding="utf-8"))
        for name in ("regions.json", "eras.json", "keywords.json")
    )
    assignment = sites.hero_assignment(plane, regions, eras, keywords)
    started = time.monotonic()
    try:
        found = allocate.allocate(
            "dominaria",
            assignment.sites,
            build.region_rows(regions),
            [],
            directions,
            redraw_limit=limit,
            redraw_scope=scope,
        )
    except allocate.LayoutError as error:
        print(f"Dominaria does not lay out: {error}")
        print()
        return
    seconds = int(time.monotonic() - started)
    widenings = Counter(event.cause for event in found.events if event.kind == "widening")
    redraws = sum(1 for event in found.events if event.kind == "redraw")
    trail = sum(leg.length for leg in found.legs if leg.kind == "trail")
    print(
        f"R0 = {found.initial_radius:,} mm. R = {found.radius:,} mm after {found.passes} passes. "
        f"{found.restarts} restarts. {redraws} redraws. {seconds} s."
    )
    print(
        f"Site widenings: {sum(widenings.values())} "
        f"({', '.join(f'{count} for {cause}' for cause, count in sorted(widenings.items()))})."
    )
    print(f"The trail from the plaza to the last era site's approach point: {trail:,} mm.")
    for event in found.events:
        if event.kind == "short":
            print(f"- {event.text}")
    print()
    print("| Site | Stands | Widenings | Redraws at the end | r_s (mm) | Kept slots | Capacity |")
    print("|---|---|---|---|---|---|---|")
    for site in found.sites:
        print(
            f"| `{site.plan.key}` | {site.plan.stands} | {site.widenings} | {site.redraws} | "
            f"{site.local.radius:,} | {len(site.capacity.slots)} | {site.capacity.total} |"
        )
    print()


def _kit(limit: int, scope: str, directions: Directions) -> None:
    print("| World | Stands | r_s (mm) | Widenings | R (mm) | Passes | Restarts | Redraws |")
    print("|---|---|---|---|---|---|---|---|")
    for slug in KIT_WORLDS:
        assignment = sites.kit_assignment(cards.read_plane(PACK, slug))
        found = allocate.allocate(
            slug, assignment.sites, None, [], directions, redraw_limit=limit, redraw_scope=scope
        )
        redraws = sum(1 for event in found.events if event.kind == "redraw")
        site = found.sites[0]
        print(
            f"| {slug} | {site.plan.stands} | {site.local.radius:,} | {site.widenings} | "
            f"{found.radius:,} | {found.passes} | {found.restarts} | {redraws} |"
        )
    print()


def main(argv: list[str]) -> int:
    words = argv or [str(limit) for limit in LIMITS]
    directions = build.load_directions()
    for word in words:
        scope = "jitter" if word.startswith("j") else "site"
        limit = int(word.removeprefix("j"))
        if limit == 0:
            title = "The law: V + W"
        elif scope == "site":
            title = f"V + W + X, up to {limit} redraws at a radius"
        else:
            title = f"V + W + J, up to {limit} redraws of the jitter at a radius"
        print(f"## {title}")
        print()
        _dominaria(limit, scope, directions)
        _kit(limit, scope, directions)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
