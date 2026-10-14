# Layout report: Ixalan (`ixalan`)

- Dataset: `pack`. Plane index (v3 `planes.json`): 0.
- Law: the plane's lore tables (lore). Digest `sha256:4965f9d966f286c6a753f0de30fcc5e7b5c8a9ee0564dac6a80c2639ded754a1`; acceptance status: absent.
- Stands: 10. Sites: 2 (1 era, 1 regional, 0 set). Regions: 2. Hero volumes: 0.
- R₀ = 89,372 mm. R = 108,141 mm after 3 of 20 passes, so the world is 216,282 mm across. Restarts at step (4): 3 (0 after a redraw, 0 after a widening at placement, 3 where a widened site no longer fits at its centre).
- Site widenings: 8 (8 for capacity, 0 for no path and approach, 0 where the kept slots ran out, 0 where two void slots in a row cut the path).
- Redraws at the same radius: 0, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 0 of 2.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 89,372 | 0 | 0 | 0 | 0 / 0 / 0 | `north` | `era:landfall` | R is widened: region 'north' cannot hold site 'era:landfall' |
| 2 | 98,310 | 3 | 0 | 2 | 0 / 0 / 2 | `north` | `era:landfall` | R is widened: region 'north' cannot hold site 'era:landfall' |
| 3 | 108,141 | 5 | 0 | 1 | 0 / 0 / 1 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| `north` | 18,346 | 1 | 3,384 | 18 |
| `south` | 18,346 | 1 | 2,979 | 16 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `era:landfall` | `north` | 9 | 2 | 0 | 10,155 | 14,866 | 32,840 | 4 | 4 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 11 | -30,000, 50,000 |
| 1 | `region:south` | `south` | 1 | 1 | 0 | 9,000 | 13,176 | 30,812 | 4 | 4 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 4 | -30,000, -50,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 2 | `era:landfall` | capacity | capacity 0 for 9 | 11,170 |
| 2 | 2 | `era:landfall` | capacity | capacity 0 for 9 | 12,287 |
| 3 | 2 | `era:landfall` | capacity | capacity 0 for 9 | 13,515 |
| 4 | 3 | `era:landfall` | capacity | capacity 5 for 9 | 14,866 |
| 5 | 3 | `region:south` | capacity | capacity 0 for 1 | 9,900 |
| 6 | 3 | `region:south` | capacity | capacity 0 for 1 | 10,890 |
| 7 | 3 | `region:south` | capacity | capacity 0 for 1 | 11,979 |
| 8 | 3 | `region:south` | capacity | capacity 0 for 1 | 13,176 |

## Redraws in order

No site is redrawn.

## Sweep-direction tries (5.4.8)

Every site's first sweep direction passes.

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `era:landfall` | 25,952 | none | 25,952 | 22,936 | 9,000 | 9,000 | 4,936 |
| `region:south` | 21,851 | none | 21,851 | 21,851 | 18,000 | 0 | 3,851 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `era:landfall` | 2 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 2 / 0 |
| `region:south` | 1 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 1 | 1 |
| 4 | 1 |
| 5 | 1 |

## The path vertex of each stand (ruling 2, V)

5 of 10 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 19,827,000 micro-degrees. The largest arc length between the two vertices is 2,801 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 5 |
| 1 | 1 |
| 3 | 1 |
| 5 | 1 |
| 6 | 1 |
| 7 | 1 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `era:landfall` | 40,390 | 7 | no |
| 1 | spur | trail | `region:south` | 117,928 | 20 | no |

- The trail's legs: 40,390 mm. The spurs: 117,928 mm.
- From the plaza's edge path to the last site's pad on the trail: 60,390 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 0 min 20 s. At `AvatarController.RunSpeed` (6,000 mm/s): 0 min 10 s.

## Keyword assignments (5.4.3)

1 cards have a selected keyword. 1 of them stand at a regional site; the others stand at their era's site, which lies in the keyword's region.

| Card | Keyword | Region | Era | Stands at |
|---|---|---|---|---|
| Sunspire Lookout | Sunspire | `south` | `landfall` | `region:south` |

### Cards whose name matches keywords of two regions

None.

### Empty chapters

None.

## Headline cards per era (5.13.2)

| Era | Rule | Cards |
|---|---|---|
| `landfall` | legendary creatures | none |

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,791 mm.

| Assertion | Tested |
|---|---|
| approach-length | 2 |
| apron-apron | 0 |
| apron-corridor | 5 |
| apron-pad | 0 |
| apron-path | 0 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-plane | 10 |
| card-set | 10 |
| card-site | 10 |
| card-stand | 20 |
| chapter-first | 1 |
| chapter-list | 12 |
| chapter-order | 1 |
| chapter-stone | 1 |
| cluster-arcs | 1 |
| cluster-count | 3 |
| cluster-size | 3 |
| corridor-end | 10 |
| corridor-plaza | 0 |
| corridor-stone | 0 |
| corridor-volume | 0 |
| corridor-window | 10 |
| footprint-apron | 0 |
| footprint-blob | 10 |
| footprint-cluster | 10 |
| footprint-corridor | 2 |
| footprint-footprint | 0 |
| footprint-pad | 0 |
| footprint-path | 0 |
| footprint-plaza | 0 |
| footprint-stone | 0 |
| footprint-volume | 0 |
| gap-between | 1 |
| gap-end | 2 |
| gap-first | 2 |
| header | 1 |
| leg-attachment | 4 |
| pad-head | 2 |
| pad-list | 3 |
| pad-pad | 0 |
| pad-plaza | 1 |
| pad-volume | 0 |
| plaza-approach | 1 |
| plaza-figures | 1 |
| record-class | 10 |
| record-cluster | 10 |
| record-count | 1 |
| record-order | 9 |
| record-site | 10 |
| record-vertex | 10 |
| record-yaw | 10 |
| site-bounds | 234 |
| site-list | 3 |
| site-reached | 2 |
| site-region | 2 |
| spur | 1 |
| stand-count | 1 |
| stand-region | 10 |
| stand-spacing | 2 |
| stone-pad | 0 |
| stone-path | 2 |
| stone-place | 2 |
| stone-plaza | 0 |
| stone-stone | 0 |
| stone-volume | 0 |
| trail-leg | 1 |
| volume-arrival | 0 |
| volume-path | 0 |
| volume-site | 0 |
| world-format | 1 |
