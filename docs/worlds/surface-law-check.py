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
    rows = max(1, round(math.pi / dphi_seed))  # §1.3's floor: one row, and every row holds >= 1 cell
    dphi = math.pi / rows
    cells = [max(1, round(2 * math.pi * math.sin((i + 0.5) * dphi) / (ASPECT * dphi))) for i in range(rows)]
    if card_count <= 2:
        # The relaxation's exact-N invariant: the closed form offers [2] slots at both N = 1 and
        # N = 2, and a one-card world takes one of them (§1.3's floor).
        cells = [card_count]
    return dphi, rows, cells


def i_size(rows_cells: list[int], dphi: float, r: int) -> tuple[float, float]:
    """§1.4's `iSize`, in units of world radius. D2: the longitudinal half-extent is ARC LENGTH.

    A row is a small circle of radius sin(theta_r), so a longitude angle subtends
    `angle * sin(theta_r)` of surface. A colatitude angle subtends itself.
    """
    theta_r = (r + 0.5) * dphi
    return (math.pi / rows_cells[r]) * math.sin(theta_r), dphi / 2


LIFT = 1.006  # §1.4: the cell is lifted just off the globe.
RADIUS_K = 0.126  # §1.3: radius = 0.126 * sqrt(cardCount)...
MOON_FLOOR = 0.55  # ...floored at §1.8's dark-moon radius, for worlds as well as moons.
# §1.4's subdivision tolerance: a flat facet spanning 2*gamma of arc sags 1.006*(1 - cos gamma)
# below the lifted sphere. Hold that under 1% of the radius; the sqrt(2) is the two axes meeting
# at a facet corner.
GAMMA_MAX = math.acos(1 - 0.01 / LIFT)
GAMMA_AXIS = GAMMA_MAX / math.sqrt(2)


def corner_lift(lon_half: float, lat_half: float) -> float:
    """§1.3/§1.4: how far a TANGENT quad's corner floats above the unit sphere, in radius units."""
    return math.sqrt(LIFT**2 + lon_half**2 + lat_half**2) - 1.0


def subdivision(card_count: int) -> tuple[int, int, int]:
    """§1.4: the per-world (k_lon, k_lat) and the world's total sub-quad count."""
    dphi, _rows, cells = grid(card_count)
    k_lon = k_lat = 1
    for r in range(len(cells)):
        lon_half, lat_half = i_size(cells, dphi, r)
        k_lon = max(k_lon, math.ceil(lon_half / GAMMA_AXIS))
        k_lat = max(k_lat, math.ceil(lat_half / GAMMA_AXIS))
    return k_lon, k_lat, sum(cells) * k_lon * k_lat


def world_radius(card_count: int) -> float:
    """§1.3's radius law, with §1.8's floor applied to worlds as well as to empty planes."""
    return max(RADIUS_K * math.sqrt(card_count), MOON_FLOOR)


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

print("\n§1.3 the small-world floor (DEC-751's n = 1 finding, re-derived)")


def slot_aspect(card_count: int, row: int = 0) -> float:
    dphi, _rows, cells = grid(card_count)
    return 2 * math.pi * math.sin((row + 0.5) * dphi) / (cells[row] * dphi)


dphi_1, rows_1, cells_1 = grid(1)
dphi_2, rows_2, cells_2 = grid(2)
check("N = 1 is one row on the equator", (rows_1, cells_1, round(dphi_1, 6)), (1, [1], round(math.pi, 6)))
check("N = 2 is the same row with two cells", (rows_2, cells_2), (1, [2]))
check("the N = 1 cell spans the sphere: half-extents (pi, pi/2)",
      [round(v, 6) for v in i_size(cells_1, dphi_1, 0)], [round(math.pi, 6), round(math.pi / 2, 6)])
# Constant area per card is what makes the wrap correct rather than degenerate: a cell's world area
# is 4*pi*radius^2/N, and radius = 0.126*sqrt(N), so it is the same 0.200 for every N.
areas = [4 * math.pi * (RADIUS_K * math.sqrt(n)) ** 2 / n for n in (1, 2, 30, 75, 6266)]
check("one card is the same physical area on every world", [round(a, 3) for a in areas], [0.200] * 5)

# The aspect deviation at N <= 2 is real, bounded, and NOT where the law breaks: art letterboxes.
check("slot aspect at N = 1", round(slot_aspect(1), 3), 2.000, tol=0.001)
check("slot aspect at N = 2", round(slot_aspect(2), 3), 1.000, tol=0.001)
check("slot aspect at N = 3", round(slot_aspect(3), 3), 1.414, tol=0.001)
check("...which is CLOSER to 4:3 than Dominaria's own polar row",
      abs(slot_aspect(3) / ASPECT - 1) < abs(aspects[0] / ASPECT - 1), True)

# What does break is §1.4's tangent quad, and it is a continuum rather than a cliff at N = 2.
lifts = {}
for n in (6266, 75, 30, 3, 2, 1):
    dphi_n, _rows_n, cells_n = grid(n)
    lifts[n] = max(corner_lift(*i_size(cells_n, dphi_n, r)) for r in range(len(cells_n)))
print(f"        tangent-quad corner lift, % of radius: {[(n, round(v * 100, 1)) for n, v in lifts.items()]}")
check("Dominaria's worst cell floats 0.7% above the sphere", round(lifts[6266] * 100, 1), 0.7)
check("Rabiah 5.7%", round(lifts[75] * 100, 1), 5.7)
check("a 30-card world (shenmeng) 11.6%", round(lifts[30] * 100, 1), 11.6)
check("N = 2 is 144%", round(lifts[2] * 100, 1), 143.9)
check("N = 1 is 265% — the 'cell' is a billboard 2.6x the globe", round(lifts[1] * 100, 1), 265.4)
check("...so the lift is monotone in N, not a special case at the bottom",
      all(lifts[a] > lifts[b] for a, b in zip([1, 2, 3, 30, 75], [2, 3, 30, 75, 6266])), True)

print("\n§1.4 the subdivision that bounds it")
check("tolerance: sag <= 1% of radius at gamma_max", round(LIFT * (1 - math.cos(GAMMA_MAX)) * 100, 3), 1.000, tol=0.001)
check("per-axis step", round(GAMMA_AXIS, 4), 0.0998, tol=5e-5)
check("k at N = 1", subdivision(1)[:2], (32, 16))
check("k at N = 2", subdivision(2)[:2], (16, 16))
check("k at Rabiah's 75", subdivision(75)[:2], (3, 2))
check("k at 30 cards", subdivision(30)[:2], (5, 3))
check("k is (1,1) — today's flat quad — from 574 cards up", subdivision(574)[:2], (1, 1))
check("...and 573 is the last world that subdivides at all", subdivision(573)[:2] != (1, 1), True)
check("Dominaria is unsubdivided", subdivision(6266)[:2], (1, 1))
# Cost: the relaxed sheet holds exactly N cells, so a world's sub-quads are N * k_lon * k_lat.
relaxed_cost = {n: n * subdivision(n)[0] * subdivision(n)[1] for n in range(1, 574)}
check("no subdivided world exceeds 1,146 sub-quads", max(relaxed_cost.values()), 1146)
check("...well inside the sphere's own envelope, 4*pi/gamma_axis^2",
      max(relaxed_cost.values()) < 4 * math.pi / GAMMA_AXIS**2, True)
check("N = 1 costs 512 sub-quads against Dominaria's 6,266 cells", relaxed_cost[1], 512)
# And the subdivision actually delivers the tolerance it was sized for, at every N.
worst_sag = 0.0
for n in list(range(1, 600)) + [1000, 2000, 6266]:
    k_lon, k_lat, _ = subdivision(n)
    dphi_n, _rows_n, cells_n = grid(n)
    for r in range(len(cells_n)):
        lon_half, lat_half = i_size(cells_n, dphi_n, r)
        gamma = math.hypot(lon_half / k_lon, lat_half / k_lat)
        worst_sag = max(worst_sag, LIFT * (1 - math.cos(gamma)))
check("worst facet sag over N = 1..6266 stays under 1%", round(worst_sag * 100, 3) <= 1.0, True)

print("\n§1.3/§1.8 the radius floor — a world is never smaller than an empty moon")
check("the laws cross at 19 cards", (round(RADIUS_K * math.sqrt(19), 3), round(RADIUS_K * math.sqrt(20), 3)),
      (0.549, 0.563))
check("unfloored, a one-card world is 4.4x smaller in radius than a dark moon",
      round(MOON_FLOOR / (RADIUS_K * math.sqrt(1)), 2), 4.37, tol=0.01)
check("...and 19x smaller in silhouette", round((MOON_FLOOR / RADIUS_K) ** 2, 1), 19.1, tol=0.05)
check("floored, that cohort is moon-sized and is told apart by colour", world_radius(1), MOON_FLOOR)
check("above 19 cards the constant-area law is untouched", round(world_radius(6266), 3), 9.974, tol=0.001)

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
    # `afr` is the SET code; the roster keys on PLANE slugs, and the plane is `forgotten-realms`.
    check("Forgotten Realms is NOT in today's roster",
          any(p.get("slug") == "forgotten-realms" for p in planes), False)
    check("...and `afr` is a set code, not a plane slug, in either dataset",
          any(p.get("slug") == "afr" for p in planes), False)

    # The point of the derivation: the same code gives a different floor on a different dataset, so
    # a literal 30 in the gate is a statement about one file rather than about correct behaviour.
    floors = {}
    for path in sorted(REPO.glob("web/public/data/*/planes.json")):
        rows = json.loads(path.read_text())["planes"]
        floors[path.parent.name] = len([p for p in rows if p.get("cardCount", 0) > 0])
    print(f"        derived W5 floor per tracked dataset: {floors}")
    check("...and it is not the same number for every dataset", len(set(floors.values())) > 1, True)

    # An earlier revision of this file predicted the next dataset here: "Forgotten Realms lands as a
    # 30th world, so the derived floor moves to 31". It was wrong by fifteen worlds, and it is the
    # best argument in this file for deriving rather than predicting. The v3 dataset is now
    # MEASURED (DEC-745 PR #46 head 311b87d, dataset dabe2c9a68b4d799, re-measured on DEC-749):
    # the refresh is the first to bake in PR #41's plane overrides, so it changes the roster's
    # shape, not its size.
    V3 = {"planes": 88, "worlds": 45, "planesWithCards": 46, "empty": 42, "cardsOnWorlds": 24399}
    v3_path = REPO / "web/public/data/dabe2c9a68b4d799/planes.json"
    if v3_path.is_file():
        v3 = json.loads(v3_path.read_text())["planes"]
        v3_worlds = [p for p in v3 if p.get("kind") != "dust" and p.get("cardCount", 0) > 0]
        v3_with_cards = [p for p in v3 if p.get("cardCount", 0) > 0]
        check("v3 planes", len(v3), V3["planes"])
        check("v3 worldsWithCards", len(v3_worlds), V3["worlds"])
        check("v3 planesWithCards — W5's floor on the dataset the gate runs on", len(v3_with_cards),
              V3["planesWithCards"])
        check("v3 empty planes", len([p for p in v3 if p.get("cardCount", 0) == 0]), V3["empty"])
        check("v3 cards on worlds", sum(p["cardCount"] for p in v3_worlds), V3["cardsOnWorlds"])
        fr = [p for p in v3 if p.get("slug") == "forgotten-realms"]
        check("Forgotten Realms is in v3, as the plane `forgotten-realms`", len(fr), 1)
        check("...carrying the 664 cards DEC-745 mapped", fr[0]["cardCount"] if fr else 0, 664)
        small = [p for p in v3_worlds if world_radius(p["cardCount"]) == MOON_FLOOR]
        check("v3 worlds the radius floor binds on (§1.3)", len(small), 15)
        check("...six of which carry exactly one card",
              len([p for p in v3_worlds if p["cardCount"] == 1]), 6)
    else:
        # Not a silent skip: the figures and their provenance are printed, and the +1 prediction
        # this replaced is gone either way.
        print(f"        PENDING — v3 dataset not on this branch (lands with PR #46): {V3}")
    check("the refresh is NOT '29 worlds + 1'", V3["worlds"], 45)
    check("...so W5's floor moves 30 -> 46, not 30 -> 31", V3["planesWithCards"], 46)
    check("...and a gate pinned at either literal goes RED on correct behaviour",
          V3["planesWithCards"] != len(planes_with_cards), True)

print("\n§3.1 W2's IQR(L*) half — why it is measured iso-shade (DEC-749, on DEC-752's finding)")

AZIMUTH, ELEVATION = 0.72, 0.38  # §1.7: the key light, camera-relative.
LIGHT = (
    math.cos(ELEVATION) * math.sin(AZIMUTH),
    math.sin(ELEVATION),
    math.cos(ELEVATION) * math.cos(AZIMUTH),
)
FACING_CUT = 0.12  # §1.6's own facing test.


def shade(n: tuple[float, float, float]) -> float:
    """§1.4's shading law. `s` is the wrapped lambert term; the square is the spec's."""
    s = min(1.0, max(0.0, sum(n[k] * LIGHT[k] for k in range(3)) * 0.5 + 0.5))
    return 0.10 + 0.95 * s * s


def equal_area_sphere(count: int):
    """Fibonacci lattice: deterministic and equal-area, which is what §1.3's cells are."""
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(count):
        z = 1 - (2 * i + 1) / count
        r = math.sqrt(max(0.0, 1 - z * z))
        yield (r * math.cos(golden * i), r * math.sin(golden * i), z)


def quartiles(xs: list[float]) -> tuple[float, float, float]:
    xs = sorted(xs)
    n = len(xs)

    def at(p: float) -> float:
        i = p * (n - 1)
        lo = int(i)
        return xs[lo] * (1 - (i - lo)) + xs[min(lo + 1, n - 1)] * (i - lo)

    return at(0.25), at(0.50), at(0.75)


def l_star(luminance: float) -> float:
    return 116 * luminance ** (1 / 3) - 16 if luminance > 0.008856 else 903.3 * luminance


# The camera looks down +z, so the front-facing cap is `n.z > 0.12`.
points = list(equal_area_sphere(200_000))
front = [shade(n) for n in points if n[2] > FACING_CUT]
q1, q2, q3 = quartiles(front)
check("light is 0.798 rad off the camera axis", round(math.acos(LIGHT[2]), 3), 0.798, tol=0.001)
check("shade quartiles over the front-facing cap", [round(q, 3) for q in (q1, q2, q3)], [0.363, 0.611, 0.852])

# One swatch for the whole world: L* = 116*(Y_swatch * shade)^(1/3) - 16, so the IQR is the shade
# gradient alone. Every plausible swatch luminance clears W2's floor of 8 on its own.
SWATCH_LUMINANCES = [0.10, 0.18, 0.25, 0.35, 0.50]
iqrs = [l_star(y * q3) - l_star(y * q1) for y in SWATCH_LUMINANCES]
print(f"        IQR(L*) with ONE swatch, per swatch luminance: {[round(v, 1) for v in iqrs]}")
check("un-subsetted IQR(L*) with one swatch, darkest case", round(min(iqrs), 1), 12.6, tol=0.05)
check("...brightest case", round(max(iqrs), 1), 21.6, tol=0.05)
check("...so the criterion cannot fail: every case clears the floor of 8", min(iqrs) > 8, True)

# The >= 6 px cut only trims the limb, where cells are most foreshortened and darkest. It raises
# the low quartile, so it narrows the IQR -- it does not rescue the measure.
trimmed = [shade(n) for n in points if n[2] > 0.24]
t1, _, t3 = quartiles(trimmed)
worst_trimmed = l_star(min(SWATCH_LUMINANCES) * t3) - l_star(min(SWATCH_LUMINANCES) * t1)
check("the >= 6 px cut narrows the worst case only to 11.9", round(worst_trimmed, 1), 11.9, tol=0.05)
check("...still above the floor", worst_trimmed > 8, True)

# Iso-shade: +/- 2.5% of the median shade. Holding shade fixed removes the gradient, so what is
# left is swatch-to-swatch lightness -- and under `?swatch=mean` that is identically zero.
iso = [s for s in front if abs(s / q2 - 1) <= 0.025]
i1, _, i3 = quartiles(iso)
check("iso-shade band is a usable fraction of the cap", 0.02 < len(iso) / len(front) < 0.20, True)
check("iso-shade residual gradient is negligible", round(max(l_star(y * i3) - l_star(y * i1) for y in SWATCH_LUMINANCES), 1) < 1.0, True)

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
