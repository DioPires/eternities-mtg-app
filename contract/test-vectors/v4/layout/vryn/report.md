# Layout report: Vryn (`vryn`)

- Dataset: `a5846bec28d1447e`. Plane index (v3 `planes.json`): 83.
- Law: the kit law. One set site for each set with first printings (5.4.2).
- Stands: 2. Sites: 1 (0 era, 0 regional, 1 set). Regions: 1. Hero volumes: 0.
- R₀ = 86,600 mm. R = 95,260 mm after 2 of 20 passes, so the world is 190,520 mm across. Restarts at step (4): 1 (0 after a redraw, 0 after a widening at placement, 1 where a widened site no longer fits at its centre).
- Site widenings: 2 (2 for capacity, 0 for no path and approach, 0 where the kept slots ran out, 0 where two void slots in a row cut the path).
- Redraws at the same radius: 0, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 0 of 1.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 86,600 | 0 | 0 | 0 | 0 / 0 / 0 | the world | `set:mom` | R is widened: region 'the world' cannot hold site 'set:mom' |
| 2 | 95,260 | 2 | 0 | 1 | 0 / 0 / 1 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| the world | 28,472 | 1 | 2,472 | 8 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `set:mom` | the world | 2 | 1 | 0 | 9,000 | 10,890 | 28,068 | 2 | 2 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 5 | -20,000, -50,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `set:mom` | capacity | capacity 0 for 2 | 9,900 |
| 2 | 2 | `set:mom` | capacity | capacity 0 for 2 | 10,890 |

## Redraws in order

No site is redrawn.

## Sweep-direction tries (5.4.8)

Every site's first sweep direction passes.

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `set:mom` | 18,814 | none | 18,814 | 18,814 | 18,000 | 0 | 814 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `set:mom` | 1 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 2 | 1 |

## The path vertex of each stand (ruling 2, V)

1 of 2 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 6,012,000 micro-degrees. The largest arc length between the two vertices is 519 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 1 |
| 2 | 1 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `set:mom` | 72,732 | 13 | no |

- The trail's legs: 72,732 mm. The spurs: 0 mm.
- From the plaza's edge path to the last site's pad on the trail: 92,732 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 0 min 31 s. At `AvatarController.RunSpeed` (6,000 mm/s): 0 min 15 s.

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,971 mm.

| Assertion | Tested |
|---|---|
| approach-length | 1 |
| apron-apron | 0 |
| apron-corridor | 0 |
| apron-pad | 0 |
| apron-path | 0 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-set | 2 |
| card-site | 2 |
| card-stand | 4 |
| chapter-first | 0 |
| chapter-list | 1 |
| chapter-order | 0 |
| chapter-stone | 0 |
| cluster-arcs | 0 |
| cluster-count | 1 |
| cluster-size | 1 |
| corridor-end | 2 |
| corridor-plaza | 0 |
| corridor-stone | 0 |
| corridor-volume | 0 |
| corridor-window | 2 |
| footprint-apron | 0 |
| footprint-blob | 2 |
| footprint-cluster | 2 |
| footprint-corridor | 0 |
| footprint-footprint | 0 |
| footprint-pad | 0 |
| footprint-path | 0 |
| footprint-plaza | 0 |
| footprint-stone | 0 |
| footprint-volume | 0 |
| gap-between | 0 |
| gap-end | 1 |
| gap-first | 1 |
| header | 1 |
| leg-attachment | 2 |
| pad-head | 1 |
| pad-list | 2 |
| pad-pad | 0 |
| pad-plaza | 1 |
| pad-volume | 0 |
| plaza-approach | 1 |
| plaza-figures | 1 |
| record-class | 2 |
| record-cluster | 2 |
| record-count | 1 |
| record-order | 1 |
| record-site | 2 |
| record-vertex | 2 |
| record-yaw | 2 |
| site-bounds | 111 |
| site-list | 1 |
| site-reached | 1 |
| site-region | 1 |
| spur | 0 |
| stand-count | 1 |
| stand-region | 2 |
| stand-spacing | 0 |
| stone-pad | 0 |
| stone-path | 1 |
| stone-plaza | 0 |
| stone-stone | 0 |
| stone-volume | 0 |
| trail-leg | 1 |
| volume-arrival | 0 |
| volume-path | 0 |
| volume-site | 0 |
| world-format | 1 |
