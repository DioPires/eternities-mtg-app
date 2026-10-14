# Layout report: Lorwyn (`lorwyn`)

- Dataset: `pack`. Plane index (v3 `planes.json`): 0.
- Law: the plane's lore tables (lore). Digest `sha256:8f4518ad310ffc338314ad7c8103936bbf1993262c4aee4dad5549d5e57b26ba`; acceptance status: absent.
- Stands: 3. Sites: 1 (1 era, 0 regional, 0 set). Regions: 1. Hero volumes: 0.
- R₀ = 86,600 mm. R = 95,260 mm after 2 of 20 passes, so the world is 190,520 mm across. Restarts at step (4): 1 (0 after a redraw, 0 after a widening at placement, 1 where a widened site no longer fits at its centre).
- Site widenings: 2 (2 for capacity, 0 for no path and approach, 0 where the kept slots ran out, 0 where two void slots in a row cut the path).
- Redraws at the same radius: 0, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 0 of 1.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 86,600 | 0 | 0 | 0 | 0 / 0 / 0 | `glen` | `era:elder-days` | R is widened: region 'glen' cannot hold site 'era:elder-days' |
| 2 | 95,260 | 2 | 0 | 1 | 0 / 0 / 1 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| `glen` | 28,472 | 1 | 2,472 | 8 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `era:elder-days` | `glen` | 3 | 1 | 2 | 9,000 | 10,890 | 28,068 | 2 | 2 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 5 | -20,000, -50,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `era:elder-days` | capacity | capacity 1 for 3 | 9,900 |
| 2 | 2 | `era:elder-days` | capacity | capacity 2 for 3 | 10,890 |

## Redraws in order

No site is redrawn.

## Sweep-direction tries (5.4.8)

Every site's first sweep direction passes.

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `era:elder-days` | 19,105 | none | 19,105 | 13,908 | 9,000 | 0 | 4,908 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `era:elder-days` | 1 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 3 | 1 |

## The path vertex of each stand (ruling 2, V)

1 of 3 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 40,075,000 micro-degrees. The largest arc length between the two vertices is 5,849 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 2 |
| 10 | 1 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `era:elder-days` | 56,711 | 10 | no |

- The trail's legs: 56,711 mm. The spurs: 0 mm.
- From the plaza's edge path to the last site's pad on the trail: 76,711 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 0 min 26 s. At `AvatarController.RunSpeed` (6,000 mm/s): 0 min 13 s.

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
| `elder-days` | legendary creatures | none |

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,962 mm.

| Assertion | Tested |
|---|---|
| approach-length | 1 |
| apron-apron | 0 |
| apron-corridor | 1 |
| apron-pad | 0 |
| apron-path | 0 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-set | 3 |
| card-site | 3 |
| card-stand | 6 |
| chapter-first | 3 |
| chapter-list | 9 |
| chapter-order | 0 |
| chapter-stone | 3 |
| cluster-arcs | 0 |
| cluster-count | 1 |
| cluster-size | 1 |
| corridor-end | 3 |
| corridor-plaza | 0 |
| corridor-stone | 1 |
| corridor-volume | 0 |
| corridor-window | 3 |
| footprint-apron | 0 |
| footprint-blob | 3 |
| footprint-cluster | 3 |
| footprint-corridor | 1 |
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
| record-class | 3 |
| record-cluster | 3 |
| record-count | 1 |
| record-order | 2 |
| record-site | 3 |
| record-vertex | 3 |
| record-yaw | 3 |
| site-bounds | 104 |
| site-list | 4 |
| site-reached | 1 |
| site-region | 1 |
| spur | 0 |
| stand-count | 1 |
| stand-region | 3 |
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
