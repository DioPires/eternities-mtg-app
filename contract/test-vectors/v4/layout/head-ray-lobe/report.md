# Layout report: Mercadia (`mercadia`)

- Dataset: `pack`. Plane index (v3 `planes.json`): 0.
- Law: the kit law. One set site for each set with first printings (5.4.2).
- Stands: 12. Sites: 1 (0 era, 0 regional, 1 set). Regions: 1. Hero volumes: 0.
- R₀ = 93,144 mm. R = 112,705 mm after 3 of 20 passes, so the world is 225,410 mm across. Restarts at step (4): 2 (0 after a redraw, 0 after a widening at placement, 2 where a widened site no longer fits at its centre).
- Site widenings: 3 (3 for capacity, 0 for no path and approach, 0 where the kept slots ran out, 0 where two void slots in a row cut the path).
- Redraws at the same radius: 0, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 0 of 1.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 93,144 | 0 | 0 | 0 | 0 / 0 / 0 | the world | `set:ha1` | R is widened: region 'the world' cannot hold site 'set:ha1' |
| 2 | 102,459 | 3 | 0 | 2 | 0 / 0 / 2 | the world | `set:ha1` | R is widened: region 'the world' cannot hold site 'set:ha1' |
| 3 | 112,705 | 0 | 0 | 0 | 0 / 0 / 0 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| the world | 39,855 | 1 | 3,569 | 8 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `set:ha1` | the world | 12 | 3 | 0 | 11,726 | 15,605 | 33,726 | 3 | 3 / 0 / 0 / 0 | 0 | 0 | 2 | 1 | 20 | 0, -60,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `set:ha1` | capacity | capacity 0 for 12 | 12,898 |
| 2 | 2 | `set:ha1` | capacity | capacity 0 for 12 | 14,187 |
| 3 | 2 | `set:ha1` | capacity | capacity 6 for 12 | 15,605 |

## Redraws in order

No site is redrawn.

## Sweep-direction tries (5.4.8)

| Site | The try that passes | Why each earlier try fails, in try order |
|---|---|---|
| `set:ha1` | 2 | the attachment square lies within 5 m of the blob |

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `set:ha1` | 30,491 | none | 30,491 | 30,491 | 9,000 | 9,000 | 3,491 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `set:ha1` | 3 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 3 / 0 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 3 | 1 |
| 4 | 1 |
| 5 | 1 |

## The path vertex of each stand (ruling 2, V)

6 of 12 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 27,602,000 micro-degrees. The largest arc length between the two vertices is 3,096 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 6 |
| 4 | 2 |
| 5 | 1 |
| 8 | 2 |
| 12 | 1 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `set:ha1` | 63,953 | 11 | no |

- The trail's legs: 63,953 mm. The spurs: 0 mm.
- From the plaza's edge path to the last site's pad on the trail: 83,953 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 0 min 28 s. At `AvatarController.RunSpeed` (6,000 mm/s): 0 min 14 s.

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,832 mm.

| Assertion | Tested |
|---|---|
| approach-length | 1 |
| apron-apron | 0 |
| apron-corridor | 9 |
| apron-pad | 0 |
| apron-path | 3 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-plane | 12 |
| card-set | 12 |
| card-site | 12 |
| card-stand | 24 |
| chapter-first | 0 |
| chapter-list | 1 |
| chapter-order | 0 |
| chapter-stone | 0 |
| cluster-arcs | 2 |
| cluster-count | 3 |
| cluster-size | 3 |
| corridor-end | 12 |
| corridor-plaza | 0 |
| corridor-stone | 0 |
| corridor-volume | 0 |
| corridor-window | 12 |
| footprint-apron | 0 |
| footprint-blob | 12 |
| footprint-cluster | 12 |
| footprint-corridor | 7 |
| footprint-footprint | 0 |
| footprint-pad | 0 |
| footprint-path | 0 |
| footprint-plaza | 0 |
| footprint-stone | 0 |
| footprint-volume | 0 |
| gap-between | 2 |
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
| record-class | 12 |
| record-cluster | 12 |
| record-count | 1 |
| record-order | 11 |
| record-site | 12 |
| record-vertex | 12 |
| record-yaw | 12 |
| site-bounds | 133 |
| site-list | 1 |
| site-reached | 1 |
| site-region | 1 |
| spur | 0 |
| stand-count | 1 |
| stand-region | 12 |
| stand-spacing | 1 |
| stone-pad | 0 |
| stone-path | 1 |
| stone-place | 1 |
| stone-plaza | 0 |
| stone-stone | 0 |
| stone-volume | 0 |
| trail-leg | 1 |
| volume-arrival | 0 |
| volume-path | 0 |
| volume-site | 0 |
| world-format | 1 |
