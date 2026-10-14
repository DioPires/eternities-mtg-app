# Layout report: Rabiah (`rabiah`)

- Dataset: `a5846bec28d1447e`. Plane index (v3 `planes.json`): 66.
- Law: the kit law. One set site for each set with first printings (5.4.2).
- Stands: 75. Sites: 1 (0 era, 0 regional, 1 set). Regions: 1. Hero volumes: 0.
- R₀ = 135,360 mm. R = 180,165 mm after 4 of 20 passes, so the world is 360,330 mm across. Restarts at step (4): 7 (3 after a redraw, 2 after a widening at placement, 2 where a widened site no longer fits at its centre).
- Site widenings: 4 (2 for capacity, 0 for no path and approach, 2 where the kept slots ran out, 0 where two void slots in a row cut the path).
- Redraws at the same radius: 3, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 0 of 1.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 135,360 | 0 | 0 | 0 | 0 / 0 / 0 | the world | `set:arn` | R is widened: region 'the world' cannot hold site 'set:arn' |
| 2 | 148,896 | 2 | 1 | 3 | 1 / 0 / 2 | the world | `set:arn` | R is widened: region 'the world' cannot hold site 'set:arn' |
| 3 | 163,786 | 2 | 2 | 4 | 2 / 2 / 0 | the world | `set:arn` | R is widened: region 'the world' cannot hold site 'set:arn' |
| 4 | 180,165 | 0 | 0 | 0 | 0 / 0 / 0 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| the world | 101,845 | 1 | 13,877 | 13 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `set:arn` | the world | 75 | 19 | 0 | 29,316 | 42,919 | 66,503 | 4 | 2 / 0 / 2 / 0 | 3 | 0 | 2 | 4 | 156 | -20,000, -90,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `set:arn` | capacity | capacity 64 for 75 | 32,247 |
| 2 | 2 | `set:arn` | capacity | capacity 69 for 75 | 35,471 |
| 3 | 3 | `set:arn` | the kept slots ran out | exhausted at 52 of 75 stands, the kept slots ran out | 39,018 |
| 4 | 3 | `set:arn` | the kept slots ran out | exhausted at 70 of 75 stands, the kept slots ran out | 42,919 |

## Redraws in order

| # | Pass | Site | Cause | What was found | r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `set:arn` | the kept slots ran out | exhausted at 48 of 75 stands, the kept slots ran out | 32,247 |
| 2 | 3 | `set:arn` | the kept slots ran out | exhausted at 58 of 75 stands, the kept slots ran out | 35,471 |
| 3 | 3 | `set:arn` | the kept slots ran out | exhausted at 65 of 75 stands, the kept slots ran out | 39,018 |

## Sweep-direction tries (5.4.8)

| Site | The try that passes | Why each earlier try fails, in try order |
|---|---|---|
| `set:arn` | 2 | the attachment square lies within 5 m of the blob |

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `set:arn` | 287,689 | none | 287,689 | 230,356 | 9,000 | 18,000 | 5,356 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `set:arn` | 18 / 11 | 2 / 0 | 0 / 0 | 1 / 3 | 14 / 5 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 3 | 4 |
| 4 | 12 |
| 5 | 3 |

## The path vertex of each stand (ruling 2, V)

35 of 75 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 56,511,000 micro-degrees. The largest arc length between the two vertices is 8,487 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 40 |
| 1 | 1 |
| 2 | 3 |
| 3 | 2 |
| 4 | 5 |
| 5 | 5 |
| 6 | 1 |
| 7 | 2 |
| 8 | 3 |
| 9 | 2 |
| 10 | 3 |
| 12 | 2 |
| 13 | 1 |
| 14 | 1 |
| 15 | 1 |
| 16 | 2 |
| 17 | 1 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `set:arn` | 104,141 | 19 | no |

- The trail's legs: 104,141 mm. The spurs: 0 mm.
- From the plaza's edge path to the last site's pad on the trail: 124,141 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 0 min 41 s. At `AvatarController.RunSpeed` (6,000 mm/s): 0 min 21 s.

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,635 mm.

| Assertion | Tested |
|---|---|
| approach-length | 1 |
| apron-apron | 0 |
| apron-corridor | 48 |
| apron-pad | 0 |
| apron-path | 7 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-plane | 75 |
| card-set | 75 |
| card-site | 75 |
| card-stand | 150 |
| chapter-cluster | 0 |
| chapter-first | 0 |
| chapter-list | 1 |
| chapter-order | 0 |
| chapter-stone | 0 |
| cluster-arcs | 18 |
| cluster-cap | 19 |
| cluster-count | 19 |
| cluster-size | 19 |
| corridor-end | 75 |
| corridor-plaza | 0 |
| corridor-stone | 0 |
| corridor-volume | 0 |
| corridor-window | 75 |
| footprint-apron | 0 |
| footprint-blob | 75 |
| footprint-cluster | 75 |
| footprint-corridor | 37 |
| footprint-footprint | 0 |
| footprint-pad | 0 |
| footprint-path | 0 |
| footprint-plaza | 0 |
| footprint-stone | 0 |
| footprint-volume | 0 |
| gap-between | 18 |
| gap-end | 1 |
| gap-first | 1 |
| header | 1 |
| leg-attachment | 2 |
| pad-head | 1 |
| pad-list | 2 |
| pad-pad | 0 |
| pad-plaza | 1 |
| pad-volume | 0 |
| path-empty | 0 |
| plaza-approach | 1 |
| plaza-figures | 1 |
| record-class | 75 |
| record-cluster | 75 |
| record-count | 1 |
| record-order | 74 |
| record-site | 75 |
| record-vertex | 75 |
| record-yaw | 75 |
| site-bounds | 391 |
| site-list | 1 |
| site-reached | 1 |
| site-region | 1 |
| spur | 0 |
| stand-count | 1 |
| stand-region | 75 |
| stand-spacing | 19 |
| stand-yaw | 75 |
| stone-pad | 0 |
| stone-path | 1 |
| stone-place | 1 |
| stone-plaza | 0 |
| stone-stone | 0 |
| stone-volume | 0 |
| trail-leg | 1 |
| trail-order | 2 |
| volume-arrival | 0 |
| volume-path | 0 |
| volume-site | 0 |
| world-format | 1 |
