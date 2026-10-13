"""The allocator of the journey law: the order of computation of PRD v4 5.4.12.

One world at a time: sites and assignment are given (:mod:`.sites`); this module finds R, the
regions, every site's local geometry and centre, its capacity, the trail, the placement and the
trim, with the restarts and the widenings of 5.4.12, and stops with a named failure when a bound
is reached. It is the only allocator (8.3.3): the engine reads its output.

**What the code defines where 5.4.12 leaves a choice** (5.4.18 (12)):

- R0 is computed once, from the base radii, before any site is widened.
- A site whose eighteen sweep-direction tries all fail is widened at step (4), before any centre
  is placed, and the widening counts toward the site's twenty.
- At step (5) a widened site is re-checked at its centre against every other site of the pass,
  not only the sites placed before it.
- A local geometry, a capacity and a placement are pure functions of their inputs, so a restart
  that meets the same inputs again reads the earlier result instead of computing it again.
- A site is exhausted at placement when two void slots in a row cut its path, or its kept slots
  run out, while cards remain (the CEO's ruling 2 of 2026-10-13 on DEC-1004, W). It is widened
  and the pass restarts at step (4).

**Reading X, measured and not the law.** ``allocate(..., redraw_limit=n)`` gives a site that is
exhausted at placement up to ``n`` second attempts at the same radius before it is widened: its
redraw count ``a`` goes up by one, its seed string gains ``|<a>``, and the pass restarts at
step (4). A widening returns ``a`` to 0. The law is ``redraw_limit=0``, and every fixture is
emitted under it. ``redraw_scope="jitter"`` is a second reading measured beside X: the site
keeps its seed, so its blob, its path and its capacity stay, and only the jitter draws of
placement take the stream of the seed string with ``|jitter|<a>``. The two parameters exist for
``scripts/layout_redraw_reading.py`` and go, or one becomes the law, with the CEO's ruling on X
(DEC-1004 ruling 2, item 9; DEC-1040 note 14).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from . import capacity as capacity_step
from . import local as local_step
from . import placement as placement_step
from . import placing, regions, trail
from .capacity import Capacity
from .constants import (
    MARGIN,
    PAD_RADIUS,
    PASS_LIMIT,
    PATH_HALF_WIDTH,
    PLAZA_EDGE_RADIUS,
    PLAZA_RADIUS,
    RETURN_PORTAL_SOUTH,
    SITE_WIDEN_LIMIT,
    site_seed,
    world_seed,
)
from .exact import Directions, Prng, Pt
from .geometry import SegmentIndex, Shape, boxes_apart, clear, disc, point_in_polygon, strip
from .local import Local
from .placement import Foreign, Placement
from .regions import RegionRow
from .sites import SitePlan
from .trail import Leg, Obstacles, PlazaApproach

RETURN_PAD: Pt = (0, -RETURN_PORTAL_SOUTH + PAD_RADIUS)
"""The return portal's pad: in front of the portal, on the side of the plaza's centre."""

_FOREIGN_REACH = 1_000
"""A stand's shapes lie within a metre of its site's blob; a reservation farther than that from
the blob's box is not tested against them."""


class LayoutError(RuntimeError):
    """A failure mode of 5.4.12: the build fails with its subject named."""


@dataclass(frozen=True, slots=True)
class Volume:
    """A hero volume: a named polygon in whole millimetres, world frame."""

    id: str
    shape: Shape


CAPACITY = "capacity"
NO_PATH = "no path and approach"
RAN_OUT = "the kept slots ran out"
CUT = "two void slots in a row"
WIDENING_CAUSES: tuple[str, ...] = (NO_PATH, CAPACITY, RAN_OUT, CUT)


@dataclass(frozen=True, slots=True)
class Event:
    """One step of the outer iteration, for the layout report."""

    kind: str
    """``pass``, ``widening`` (of a site), ``redraw``, ``restart`` or ``short`` (R is widened)."""
    text: str
    site: str | None = None
    cause: str | None = None
    """A widening's cause, one of :data:`WIDENING_CAUSES`."""
    region: str | None = None
    radius: int = 0
    """R for a pass; the site's new r_s for a widening."""


@dataclass(frozen=True, slots=True)
class SiteLayout:
    plan: SitePlan
    region: int
    """Index of the site's region in the region list."""
    local: Local
    centre: Pt
    widenings: int
    redraws: int
    """Reading X's redraw count at the final layout; 0 under the law."""
    capacity: Capacity
    placement: Placement


@dataclass(frozen=True, slots=True)
class Layout:
    slug: str
    radius: int
    initial_radius: int
    passes: int
    restarts: int
    world: Shape
    cells: tuple[Shape, ...]
    """One cell per region row, in table order; a kit world has one, the world polygon."""
    volumes: tuple[Volume, ...]
    sites: tuple[SiteLayout, ...]
    approach: PlazaApproach | None
    """None for a world with no site."""
    legs: tuple[Leg, ...]
    events: tuple[Event, ...]
    """Every pass, widening, restart and widening of R, in order, for the layout report."""


@dataclass(slots=True)
class _Short:
    """The world is short at this R (5.4.6, 5.4.11): the outer iteration widens it."""

    message: str
    site: str | None = None
    region: str | None = None


@dataclass(slots=True)
class _State:
    slug: str
    plans: tuple[SitePlan, ...]
    region_of: tuple[int, ...]
    directions: Directions
    volumes: tuple[Volume, ...]
    radius: dict[str, int]
    redraw_limit: int = 0
    redraw_scope: str = "site"
    widenings: dict[str, int] = field(default_factory=dict)
    redraws: dict[str, int] = field(default_factory=dict)
    locals: dict[tuple[str, int, int], Local | None] = field(default_factory=dict)
    capacities: dict[tuple[str, int, int, Pt], Capacity] = field(default_factory=dict)
    placements: dict[tuple[str, int, int, Pt, tuple[object, ...]], Placement] = field(
        default_factory=dict
    )
    events: list[Event] = field(default_factory=list)
    restarts: int = 0

    def widen(self, plan: SitePlan, cause: str, detail: str) -> None:
        """One widening of a site (5.4.9), or the failure of 5.4.12 after twenty."""
        if self.widenings[plan.key] == SITE_WIDEN_LIMIT:
            raise LayoutError(
                f"site {plan.key!r} of {self.slug}: {detail} after {SITE_WIDEN_LIMIT} widenings "
                f"(r_s = {self.radius[plan.key]:,} mm; 5.4.12)"
            )
        self.widenings[plan.key] += 1
        self.redraws[plan.key] = 0
        self.radius[plan.key] = local_step.widened(self.radius[plan.key])
        self.events.append(
            Event(
                kind="widening",
                text=f"widening {self.widenings[plan.key]} of `{plan.key}`: {detail}; "
                f"r_s = {self.radius[plan.key]:,} mm",
                site=plan.key,
                cause=cause,
                radius=self.radius[plan.key],
            )
        )

    def exhausted(self, plan: SitePlan, cause: str, detail: str) -> None:
        """A site is exhausted at placement: it is widened (5.4.10), or redrawn under reading X."""
        if self.redraws[plan.key] < self.redraw_limit:
            self.redraws[plan.key] += 1
            self.events.append(
                Event(
                    kind="redraw",
                    text=f"redraw {self.redraws[plan.key]} of `{plan.key}`: {detail}; "
                    f"r_s = {self.radius[plan.key]:,} mm",
                    site=plan.key,
                    cause=cause,
                    radius=self.radius[plan.key],
                )
            )
            return
        self.widen(plan, cause, detail)

    def drawn(self, plan: SitePlan) -> int:
        """The redraw count that the site's own stream reads: 0 under the law."""
        return self.redraws[plan.key] if self.redraw_scope == "site" else 0

    def seed(self, plan: SitePlan) -> str:
        """The site's seed string (5.4.1); under reading X it gains ``|<a>`` at a redraw."""
        seed = site_seed(self.slug, plan.key)
        redraw = self.drawn(plan)
        return seed if redraw == 0 else f"{seed}|{redraw}"

    def jitter(self, plan: SitePlan) -> Prng | None:
        """The jitter stream of the reading that redraws the jitter only; None under the law."""
        redraw = self.redraws[plan.key] if self.redraw_scope == "jitter" else 0
        if redraw == 0:
            return None
        return Prng.of(f"{site_seed(self.slug, plan.key)}|jitter|{redraw}")

    def local(self, plan: SitePlan) -> Local:
        """The site's local geometry at its radius, widening it while no try passes (5.4.8)."""
        while True:
            key = (plan.key, self.radius[plan.key], self.drawn(plan))
            if key not in self.locals:
                self.locals[key] = local_step.build(key[1], self.seed(plan), self.directions)
            found = self.locals[key]
            if found is not None:
                return found
            self.widen(plan, NO_PATH, "no path and approach in eighteen tries")

    def capacity(self, plan: SitePlan, built: Local, centre: Pt) -> Capacity:
        key = (plan.key, built.radius, self.drawn(plan), centre)
        found = self.capacities.get(key)
        if found is None:
            found = capacity_step.capacity_of(built, centre, plan.stands, self.directions)
            self.capacities[key] = found
        return found


def allocate(
    slug: str,
    plans: Sequence[SitePlan],
    rows: Sequence[RegionRow] | None,
    volumes: Sequence[Volume],
    directions: Directions,
    *,
    redraw_limit: int = 0,
    redraw_scope: str = "site",
) -> Layout:
    """Lay one world out (5.4.12). ``rows`` is the region table, or None for a kit world.

    ``redraw_limit`` and ``redraw_scope`` are the measured readings of the module's note; the
    law is a limit of 0.
    """
    plans = tuple(plans)
    if rows is None:
        region_of = tuple(0 for _ in plans)
    else:
        ids = [row.id for row in rows]
        region_of = tuple(ids.index(plan.region or "") for plan in plans)
    state = _State(
        slug=slug,
        plans=plans,
        region_of=region_of,
        directions=directions,
        volumes=tuple(volumes),
        radius={plan.key: local_step.base_radius(plan.stands) for plan in plans},
        redraw_limit=redraw_limit,
        redraw_scope=redraw_scope,
    )
    state.widenings = {plan.key: 0 for plan in plans}
    state.redraws = {plan.key: 0 for plan in plans}
    _check_volumes(state)
    initial = regions.initial_radius(
        [local_step.bounding_radius(state.radius[plan.key]) for plan in plans]
    )
    radius = initial
    for number in range(1, PASS_LIMIT + 1):
        world = regions.world_polygon(radius, directions)
        cells = [world] if rows is None else regions.partition(radius, list(rows), directions)
        state.events.append(
            Event(kind="pass", text=f"pass {number}: R = {radius:,} mm", radius=radius)
        )
        found = _pass(state, radius, world, cells)
        if isinstance(found, _Short):
            if number == PASS_LIMIT:
                raise LayoutError(f"{slug}: {found.message} after {PASS_LIMIT} passes (5.4.12)")
            state.events.append(
                Event(
                    kind="short",
                    text=f"R is widened: {found.message}",
                    site=found.site,
                    region=found.region,
                    radius=radius,
                )
            )
            radius = regions.widened_world(radius)
            continue
        sites, approach, legs = found
        return Layout(
            slug=slug,
            radius=radius,
            initial_radius=initial,
            passes=number,
            restarts=state.restarts,
            world=world,
            cells=tuple(cells),
            volumes=state.volumes,
            sites=tuple(sites),
            approach=approach,
            legs=tuple(legs),
            events=tuple(state.events),
        )
    raise AssertionError("unreachable: the last pass returns or raises")


def _check_volumes(state: _State) -> None:
    pad = disc(state.directions.disc, RETURN_PAD[0], RETURN_PAD[1], 1, PAD_RADIUS)
    for volume in state.volumes:
        den = volume.shape.den
        if point_in_polygon(0, 0, volume.shape.scaled(den)):
            raise LayoutError(
                f"hero volume {volume.id!r} of {state.slug} covers the arrival point (5.4.11)"
            )
        if not clear(pad, volume.shape, MARGIN):
            raise LayoutError(
                f"hero volume {volume.id!r} of {state.slug} covers the return pad (5.4.11)"
            )


def _pass(
    state: _State, radius: int, world: Shape, cells: Sequence[Shape]
) -> tuple[list[SiteLayout], PlazaApproach | None, list[Leg]] | _Short:
    """Steps (4) to (7) at one R, with their restarts."""
    plans = state.plans
    ground = placing.Ground(state.directions, [volume.shape for volume in state.volumes])
    world_cells: dict[tuple[int, int], bool] = {}
    while True:
        # (4) Local geometry, then centres in site order.
        built = [state.local(plan) for plan in plans]
        placed: list[placing.Placed] = []
        last_era: Pt = (0, 0)
        for position, plan in enumerate(plans):
            if position == 0:
                reference: Pt = (0, 0)
            elif plan.kind == "region":
                reference = last_era
            else:
                reference = placed[-1].centre
            centre = placing.place(
                ground,
                built[position].bounding,
                cells[state.region_of[position]],
                reference,
                placed,
            )
            if centre is None:
                region = plan.region or "the world"
                return _Short(
                    f"region {region!r} cannot hold site {plan.key!r}", plan.key, plan.region
                )
            placed.append(placing.Placed(centre, built[position].bounding))
            if plan.kind != "region":
                last_era = centre

        # (5) Capacity, widening a short site in place.
        restart = False
        capacities: list[Capacity] = []
        for position, plan in enumerate(plans):
            centre = placed[position].centre
            while True:
                found = state.capacity(plan, built[position], centre)
                if found.total - plan.chapter_stones >= plan.stands:
                    break
                state.widen(
                    plan,
                    CAPACITY,
                    f"capacity {found.total - plan.chapter_stones} for {plan.stands}",
                )
                built[position] = state.local(plan)
                others = placed[:position] + placed[position + 1 :]
                cell = cells[state.region_of[position]]
                if not placing.admissible(ground, centre, built[position].bounding, cell, others):
                    restart = True
                    break
                placed[position] = placing.Placed(centre, built[position].bounding)
            if restart:
                break
            capacities.append(found)
        if restart:
            state.restarts += 1
            state.events.append(
                Event(
                    kind="restart",
                    text="restart at step (4): a widened site no longer fits at its centre",
                )
            )
            continue

        # (6) Reservations and the trail.
        centres = [site.centre for site in placed]
        obstacles = Obstacles(
            radius,
            world,
            ground.plaza,
            ground.volumes,
            list(zip(built, centres, strict=True)),
            world_cells,
        )
        routed = _trail(state, obstacles, built, centres)
        if isinstance(routed, _Short):
            return routed
        approach, legs = routed

        # (7) Placement, chapter stones and the trim.
        indexes = [SegmentIndex(leg.polyline) for leg in legs]
        sites: list[SiteLayout] = []
        for position, plan in enumerate(plans):
            centre = centres[position]
            foreign, signature = _foreign(state, built[position], centre, approach, legs, indexes)
            key = (plan.key, built[position].radius, state.redraws[plan.key], centre, signature)
            found_placement = state.placements.get(key)
            if found_placement is None:
                chapters = [len(chapter.cards) for chapter in plan.chapters] or [plan.stands]
                found_placement = placement_step.place_site(
                    built[position],
                    capacities[position],
                    chapters,
                    state.directions,
                    foreign,
                    state.jitter(plan),
                )
                state.placements[key] = found_placement
            if found_placement.exhausted is not None:
                held = len(found_placement.stands)
                if found_placement.exhausted:
                    cause = CUT
                    where = f"{CUT} cut the path at slot {found_placement.exhausted}"
                else:
                    cause, where = RAN_OUT, RAN_OUT
                state.exhausted(
                    plan, cause, f"exhausted at {held} of {plan.stands} stands, {where}"
                )
                restart = True
                break
            sites.append(
                SiteLayout(
                    plan=plan,
                    region=state.region_of[position],
                    local=built[position],
                    centre=centre,
                    widenings=state.widenings[plan.key],
                    redraws=state.redraws[plan.key],
                    capacity=capacities[position],
                    placement=found_placement,
                )
            )
        if restart:
            state.restarts += 1
            state.events.append(
                Event(kind="restart", text="restart at step (4): a site is exhausted at placement")
            )
            continue
        return sites, approach, legs


def _trail(
    state: _State, obstacles: Obstacles, built: Sequence[Local], centres: Sequence[Pt]
) -> tuple[PlazaApproach | None, list[Leg]] | _Short:
    """The plaza approach and the legs, in leg order (5.4.11)."""
    plans = state.plans
    points = [
        (site.approach_point[0] + centre[0], site.approach_point[1] + centre[1])
        for site, centre in zip(built, centres, strict=True)
    ]
    chain = [i for i, plan in enumerate(plans) if plan.kind != "region"]
    spurs = [i for i, plan in enumerate(plans) if plan.kind == "region"]
    if not chain:
        return None, []
    approach = trail.plaza_approach(obstacles, points[chain[0]], state.directions)
    if approach is None:
        return _Short("the plaza approach finds no angle")
    prng = Prng.of(world_seed(state.slug))
    legs: list[Leg] = []
    name, anchor = "plaza", approach.far
    for position in chain:
        key = plans[position].key
        found = trail.leg(
            obstacles,
            len(legs),
            "trail",
            (name, key),
            (anchor, points[position]),
            prng,
            state.directions,
        )
        if found is None:
            return _Short(f"the trail leg from {name!r} to {key!r} has no route", key)
        legs.append(found)
        name, anchor = key, points[position]
    for position in spurs:
        key = plans[position].key
        start = trail.nearest_vertex(legs, points[position])
        found = trail.leg(
            obstacles,
            len(legs),
            "spur",
            ("trail", key),
            (start, points[position]),
            prng,
            state.directions,
        )
        if found is None:
            return _Short(f"the spur from the trail to {key!r} has no route", key)
        legs.append(found)
    return approach, legs


def _foreign(
    state: _State,
    built: Local,
    centre: Pt,
    approach: PlazaApproach | None,
    legs: Sequence[Leg],
    indexes: Sequence[SegmentIndex],
) -> tuple[Foreign, tuple[object, ...]]:
    """The world's reservations near one site, in the site's frame, and what names them.

    Only a reservation within a metre of the blob's box can meet a stand's shapes. The second
    value holds the same shapes as plain tuples: it keys the placement a restart may reuse.
    """
    cx, cz = centre
    x0, z0, x1, z1 = built.blob.box
    box = (x0 + cx, z0 + cz, x1 + cx, z1 + cz)
    solid: list[Shape] = []
    corridor: list[Shape] = []
    signature: list[object] = []
    reach = PATH_HALF_WIDTH + _FOREIGN_REACH
    for found, index in zip(legs, indexes, strict=True):
        run: list[Pt] = []
        last = -2
        for segment in [*index.near(box, reach), -1]:
            if segment != last + 1 and run:
                solid.append(strip(run, PATH_HALF_WIDTH))
                signature.append(("leg", tuple(run)))
                run = []
            if segment < 0:
                break
            if not run:
                ax, az = found.polyline[segment]
                run.append((ax - cx, az - cz))
            bx, bz = found.polyline[segment + 1]
            run.append((bx - cx, bz - cz))
            last = segment
    if approach is not None and not boxes_apart(box, approach.strip.box, reach):
        solid.append(approach.strip.translated(-cx, -cz))
        signature.append(("plaza approach", approach.count))
    plaza_box = (-PLAZA_EDGE_RADIUS, -PLAZA_EDGE_RADIUS, PLAZA_EDGE_RADIUS, PLAZA_EDGE_RADIUS)
    if not boxes_apart(box, plaza_box, _FOREIGN_REACH):
        solid.append(disc(state.directions.disc, -cx, -cz, 1, PLAZA_EDGE_RADIUS))
        corridor.append(disc(state.directions.disc, -cx, -cz, 1, PLAZA_RADIUS))
        signature.append("plaza")
    for volume in state.volumes:
        if not boxes_apart(box, volume.shape.box, _FOREIGN_REACH):
            moved = volume.shape.translated(-cx, -cz)
            solid.append(moved)
            corridor.append(moved)
            signature.append(("volume", volume.id))
    return Foreign(solid=tuple(solid), corridor=tuple(corridor)), tuple(signature)
