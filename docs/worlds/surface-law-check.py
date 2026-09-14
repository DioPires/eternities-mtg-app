#!/usr/bin/env python3
"""Reproduce every arithmetic claim §1.2-§1.6 and §2.1 of `spec.md` make about the surface law.

This is a **documentation check**, not the implementation. Leg P owns the surface law in Python
(`pipeline/`) and leg R1 owns it on the client; this file exists so that the numbers the spec
argues from can be re-derived by anyone reading it, and so that a future edit to those numbers
fails something rather than merely disagreeing with prose.

Run: `python3 docs/worlds/surface-law-check.py` (stdlib only, no deps, exits non-zero on failure).

Every assertion below is one the spec states in words. The four that were *wrong* in the
8b731de..b0ff90c draft, and that DEC-749 corrects, are marked D1/D2/D4 and N1.
"""

import json
import math
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

ASPECT = 4 / 3  # §1.3: an `art_crop` letterboxes into 4:3 without being stretched.

failures: list[str] = []


def check(label: str, got: object, want: object, tol: float | None = None) -> None:
    ok = abs(float(got) - float(want)) <= tol if tol is not None else got == want  # type: ignore[arg-type]
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}: {got}" + ("" if ok else f"  (expected {want})"))
    if not ok:
        failures.append(label)


def grid(card_count: int) -> tuple[float, int, list[int]]:
    """§1.3's closed form. Returns (dphi, rows, cells-per-row north to south).

    D1: the angle is COLATITUDE theta, centres at (i + 1/2)*dphi, and a row's circumference is
    2*pi*sin(theta). Reading theta as latitude and writing `cos` is the degenerate form.
    """
    dphi_seed = math.sqrt(4 * math.pi / (ASPECT * card_count))
    rows = round(math.pi / dphi_seed)
    dphi = math.pi / rows
    cells = [round(2 * math.pi * math.sin((i + 0.5) * dphi) / (ASPECT * dphi)) for i in range(rows)]
    return dphi, rows, cells


def i_size(rows_cells: list[int], dphi: float, r: int) -> tuple[float, float]:
    """§1.4's `iSize`, in units of world radius. D2: the longitudinal half-extent is ARC LENGTH.

    A row is a small circle of radius sin(theta_r), so a longitude angle subtends
    `angle * sin(theta_r)` of surface. A colatitude angle subtends itself.
    """
    theta_r = (r + 0.5) * dphi
    return (math.pi / rows_cells[r]) * math.sin(theta_r), dphi / 2


def pool_size(tier_layers: int, max_layers: int) -> int:
    """§1.6/§1.12's clamp. N1: the outer max() is load-bearing — max_layers can be 0."""
    return max(0, min(tier_layers, max_layers - 32))


print("§1.3 the grid (D1 — theta is colatitude, the formula carries sin)")
dphi_dom, rows_dom, cells_dom = grid(6266)
check("Dominaria rows", rows_dom, 81)
check("Dominaria dphi", round(dphi_dom, 6), 0.038785, tol=5e-6)
check("Dominaria sum(rowCells) == cardCount", sum(cells_dom), 6266)
check("Dominaria rowCells is symmetric about the equator", cells_dom, cells_dom[::-1])

# The literal 'cos((i + 1/2)*dphi)' reading the draft could be parsed into.
degenerate = [round(2 * math.pi * math.cos((i + 0.5) * dphi_dom) / (ASPECT * dphi_dom)) for i in range(rows_dom)]
check("...and the latitude misreading sums to 0 cells", sum(degenerate), 0)
check("...with negative counts in the southern rows", min(degenerate) < 0, True)

dphi_rab, rows_rab, cells_rab = grid(75)
check("Rabiah rows", rows_rab, 9)
check("Rabiah closed-form slots (§1.3: 78 for 75 cards)", sum(cells_rab), 78)

print("\n§2.1 iSize (D2 — arc length, not angle)")
lon_corrected, lat = i_size(cells_dom, dphi_dom, 0)
lon_raw = math.pi / cells_dom[0]
check("Dominaria rowCells[0]", cells_dom[0], 2)
check("polar half-extent, corrected", round(lon_corrected, 6), 0.030460, tol=1e-6)
check("polar half-extent, sin dropped", round(lon_raw, 6), 1.570796, tol=1e-6)
check("overdraw ratio (spec: 51x)", round(lon_raw / lon_corrected, 2), 51.57, tol=0.01)
check("latitudinal half-extent is dphi/2, unconverted", round(lat, 6), round(dphi_dom / 2, 6))
check("uncorrected quad is wider than the globe's radius", lon_raw > 1.0, True)

print("\n§1.3 the 4:3 aspect law, which the same factor is what makes true")
aspects = [2 * math.pi * math.sin((i + 0.5) * dphi_dom) / (cells_dom[i] * dphi_dom) for i in range(rows_dom)]
mid = aspects[len(aspects) // 2]
check("equatorial aspect is 4:3", round(mid, 3), 1.333, tol=0.01)
check("all rows within 18% of 4:3", max(abs(a / ASPECT - 1) for a in aspects) < 0.18, True)
check("polar aspect is pi/2, from integer rowCells not from D2", round(aspects[0], 3), 1.571, tol=0.001)
off = sum(cells_dom[i] for i, a in enumerate(aspects) if abs(a / ASPECT - 1) > 0.10)
check("Dominaria cells outside +/-10% of 4:3", off, 4)
# ...and without the conversion the ratio is aspect / sin(theta), which is 81 at the pole.
check("aspect at the pole with sin dropped", round(2 * math.pi / (cells_dom[0] * dphi_dom), 1), 81.0, tol=0.1)

print("\n§2.1 float16 nearest-row matching")
gap = math.cos(0.5 * dphi_dom) - math.cos(1.5 * dphi_dom)
half_ulp = 2 ** -11 / 2
check("Dominaria polar sin-lat gap", round(gap, 9), 0.001503812, tol=1e-8)
# Nearest-row tolerates half the gap either side of a row centre; floor() tolerates only the
# distance to the boundary below, which is half as much (§2.1: "twice the error a floor() does").
nearest_margin = (gap / 2) / half_ulp
check("nearest-row margin (spec: 3.08x)", round(nearest_margin, 2), 3.08, tol=0.01)
check("floor() margin is half of it", round(nearest_margin / 2, 2), 1.54, tol=0.01)
check("...and at the pole that is the whole safety factor", nearest_margin / 2 < 2.0, True)
check("at the equator nearest-row is slack (spec: 79x)", round(dphi_dom / 2 / half_ulp, 0), 79.0, tol=1.0)

print("\n§1.6/§1.12 the art-pool clamp (N1 — the floor)")
TIERS = [1024, 1024, 512, 256, 128]
check("typical device, no clamp", [pool_size(t, 2048) for t in TIERS], TIERS)
check("WebGL2 spec-minimum 256: tiers 0-3 clamp to 224", [pool_size(t, 256) for t in TIERS], [224, 224, 224, 224, 128])
check("...so only tier 4 stays distinct there", len(set(pool_size(t, 256) for t in TIERS)), 2)
check("unanswered limit (0) floors at 0, never -32", [pool_size(t, 0) for t in TIERS], [0, 0, 0, 0, 0])
check("...which the unfloored formula gets wrong", min(TIERS[0], 0 - 32), -32)

print("\n§3.1 the roster counts are derived, not constants (DEC-751)")
PROD = REPO / "web/public/data/6d4779695fde33ea/planes.json"
if not PROD.is_file():
    # Deliberately a failure, not a skip: a check that silently passes when its input moved is
    # the rubber stamp §3.1's negative-control note exists to forbid.
    check(f"production planes.json is readable at {PROD}", False, True)
else:
    planes = json.loads(PROD.read_text())["planes"]
    worlds_with_cards = [p for p in planes if p.get("kind") != "dust" and p.get("cardCount", 0) > 0]
    planes_with_cards = [p for p in planes if p.get("cardCount", 0) > 0]
    check("87 planes on the production roster", len(planes), 87)
    check("worldsWithCards — W1 iterates these", len(worlds_with_cards), 29)
    check("planesWithCards — W5's floor IS this length", len(planes_with_cards), 30)
    check("...which is the worlds plus the belt", len(planes_with_cards) - len(worlds_with_cards), 1)
    check("empty planes carry no cards", len([p for p in planes if p.get("cardCount", 0) == 0]), 57)
    check("cards on worlds (D3)", sum(p["cardCount"] for p in worlds_with_cards), 23607)
    check("Forgotten Realms is NOT in today's roster", any(p.get("slug") == "afr" for p in planes), False)

    # The point of the derivation: the same code gives a different floor on a different dataset, so
    # a literal 30 in the gate is a statement about one file rather than about correct behaviour.
    floors = {}
    for path in sorted(REPO.glob("web/public/data/*/planes.json")):
        rows = json.loads(path.read_text())["planes"]
        floors[path.parent.name] = len([p for p in rows if p.get("cardCount", 0) > 0])
    print(f"        derived W5 floor per tracked dataset: {floors}")
    check("...and it is not the same number for every dataset", len(set(floors.values())) > 1, True)

    # Forgotten Realms lands as a 30th world (DEC-710's curation sign-off, already answered).
    after_fr = len(planes_with_cards) + 1
    check("once FR lands the derived floor moves to 31", after_fr, 31)
    check("...so a hard-coded 30 would go RED on correct behaviour", after_fr > 30, True)

print("\n§1.4 the winding (DEC-694 trap 1) — derived, not asserted")


def facing(indices: list[int]) -> float:
    """Sign of the first triangle's geometric normal along the outward surface normal `n`.

    §1.4's frame: the quad's corners are at (+/-1, +/-1) in (east, north), north = cross(east, n).
    Take n = +z, east = +x, so north = cross(x, z) = -y. A triangle's normal is
    cross(b - a, c - a); its dot with n decides whether the cell faces the camera or is culled.
    """
    n = (0.0, 0.0, 1.0)
    east, north = (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]  # the unit quad, CCW in its own (x, y)
    pts = [tuple(east[k] * u + north[k] * v + n[k] for k in range(3)) for u, v in corners]
    a, b, c = (pts[i] for i in indices[:3])
    u_vec = [b[k] - a[k] for k in range(3)]
    v_vec = [c[k] - a[k] for k in range(3)]
    cross = (
        u_vec[1] * v_vec[2] - u_vec[2] * v_vec[1],
        u_vec[2] * v_vec[0] - u_vec[0] * v_vec[2],
        u_vec[0] * v_vec[1] - u_vec[1] * v_vec[0],
    )
    return sum(cross[k] * n[k] for k in range(3))


check("spec order [0,2,1,0,3,2] faces OUTWARD (+n)", facing([0, 2, 1, 0, 3, 2]) > 0, True)
check("the 'tidied' [0,1,2,0,2,3] faces INWARD (-n)", facing([0, 1, 2, 0, 2, 3]) < 0, True)

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
    sys.exit(1)
print("all surface-law checks reproduce the spec")
