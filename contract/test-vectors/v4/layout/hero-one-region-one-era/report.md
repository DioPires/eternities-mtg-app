# Layout report: Kamigawa (`kamigawa`)

- Dataset: `pack`. Plane index (v3 `planes.json`): 0.
- Law: the plane's lore tables (lore). Digest `sha256:59ad3a3da2d3d790141e9d4923fff5fabdd0d2b06c5ab9060f077de6923b92b9`; acceptance status: absent.
- Stands: 12. Sites: 1 (1 era, 0 regional, 0 set). Regions: 1. Hero volumes: 0.
- R₀ = 93,144 mm. R = 112,705 mm after 3 of 20 passes, so the world is 225,410 mm across. Restarts at step (4): 3 (0 after a redraw, 0 after a widening at placement, 3 where a widened site no longer fits at its centre).
- Site widenings: 4 (4 for capacity, 0 for no path and approach, 0 where the kept slots ran out, 0 where two void slots in a row cut the path).
- Redraws at the same radius: 0, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 0 of 1.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 93,144 | 0 | 0 | 0 | 0 / 0 / 0 | `towabara` | `era:kami-war` | R is widened: region 'towabara' cannot hold site 'era:kami-war' |
| 2 | 102,459 | 3 | 0 | 2 | 0 / 0 / 2 | `towabara` | `era:kami-war` | R is widened: region 'towabara' cannot hold site 'era:kami-war' |
| 3 | 112,705 | 1 | 0 | 1 | 0 / 0 / 1 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| `towabara` | 39,855 | 1 | 3,976 | 9 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `era:kami-war` | `towabara` | 12 | 3 | 0 | 11,726 | 17,165 | 35,598 | 4 | 4 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 15 | -10,000, -60,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `era:kami-war` | capacity | capacity 4 for 12 | 12,898 |
| 2 | 2 | `era:kami-war` | capacity | capacity 4 for 12 | 14,187 |
| 3 | 2 | `era:kami-war` | capacity | capacity 10 for 12 | 15,605 |
| 4 | 3 | `era:kami-war` | capacity | capacity 9 for 12 | 17,165 |

## Redraws in order

No site is redrawn.

## Sweep-direction tries (5.4.8)

Every site's first sweep direction passes.

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `era:kami-war` | 31,108 | none | 31,108 | 31,108 | 9,000 | 9,000 | 4,108 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `era:kami-war` | 3 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 3 / 0 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 4 | 3 |

## The path vertex of each stand (ruling 2, V)

5 of 12 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 28,033,000 micro-degrees. The largest arc length between the two vertices is 4,127 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 7 |
| 2 | 1 |
| 3 | 1 |
| 5 | 2 |
| 7 | 1 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `era:kami-war` | 69,920 | 11 | no |

- The trail's legs: 69,920 mm. The spurs: 0 mm.
- From the plaza's edge path to the last site's pad on the trail: 89,920 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 0 min 30 s. At `AvatarController.RunSpeed` (6,000 mm/s): 0 min 15 s.

## Keyword assignments (5.4.3)

0 cards have a selected keyword. 0 of them stand at a regional site; the others stand at their era's site, which lies in the keyword's region.

| Card | Keyword | Region | Era | Stands at |
|---|---|---|---|---|

### Cards whose name matches keywords of two regions

None.

### Empty chapters

None.

## Headline cards per era (5.13.2)

| Era | Rule | Cards |
|---|---|---|
| `kami-war` | legendary creatures | none |

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,883 mm.

| Assertion | Tested |
|---|---|
| approach-length | 1 |
| apron-apron | 0 |
| apron-corridor | 8 |
| apron-pad | 0 |
| apron-path | 0 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-set | 12 |
| card-site | 12 |
| card-stand | 24 |
| chapter-first | 1 |
| chapter-list | 14 |
| chapter-order | 2 |
| chapter-stone | 1 |
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
| footprint-corridor | 5 |
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
| site-bounds | 135 |
| site-list | 2 |
| site-reached | 1 |
| site-region | 1 |
| spur | 0 |
| stand-count | 1 |
| stand-region | 12 |
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
