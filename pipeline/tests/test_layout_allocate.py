"""The outer iteration of PRD v4 5.4.12: its order, its restarts, its bounds and its failures.

Small one-site worlds run end to end here in well under a second. Dominaria runs in the
fixtures (``eternities layout fixtures --check``), not in this file.
"""

from __future__ import annotations

import dataclasses
import itertools
from typing import Any

import pytest

from eternities.layout import allocate, local, regions, trail
from eternities.layout import capacity as capacity_step
from eternities.layout import placement as placement_step
from eternities.layout.allocate import (
    CAPACITY,
    NO_FIT,
    RAN_OUT,
    REDRAWN,
    RESTART_CAUSES,
    WIDENED,
    WIDENING_CAUSES,
    Event,
    LayoutError,
    Volume,
)
from eternities.layout.cards import PlaneCard, PlaneSet
from eternities.layout.constants import PASS_LIMIT, REDRAW_LIMIT, SITE_WIDEN_LIMIT
from eternities.layout.geometry import polygon
from eternities.layout.local import Local
from eternities.layout.placement import Placement
from eternities.layout.regions import RegionRow
from eternities.layout.sites import Chapter, SitePlan

from layout_kit import directions


def cards(count: int, code: str = "ha1", set_id: int = 1, first: int = 1) -> tuple[PlaneCard, ...]:
    return tuple(
        PlaneCard(
            oracle_id=f"00000000-0000-4000-8000-{number:012d}",
            name=f"Card {number}",
            back_name=None,
            type_line="Creature",
            set_id=set_id,
            set_code=code,
            identity=1,
            rarity=0,
            type_mask=1,
            back_image=False,
            printings=1,
            swatch=0,
            local_index=number - 1,
        )
        for number in range(first, first + count)
    )


def _always(value: Any) -> Any:
    """A stand-in for a step of the allocator that gives ``value`` whatever it is asked."""

    def stub(*args: Any, **more: Any) -> Any:
        return value

    return stub


def set_site(count: int, code: str = "ha1", first: int = 1) -> SitePlan:
    record = PlaneSet(1, code, code, 2000)
    return SitePlan(
        f"set:{code}", "set", None, None, (record,), cards(count, code, first=first), ()
    )


def lay(plans: list[SitePlan], **more: Any) -> allocate.Layout:
    return allocate.allocate("mercadia", plans, None, [], directions(), **more)


def test_a_one_card_world_is_laid_out_by_the_order_of_5_4_12():
    found = lay([set_site(1)])
    (site,) = found.sites
    # R0 is the third term of 5.4.4 for a floor-radius site: 35 m + 2 x 25.8 m.
    assert found.initial_radius == 86_600
    assert found.radius >= found.initial_radius
    assert found.passes == sum(1 for event in found.events if event.kind == "pass")
    assert found.restarts == sum(1 for event in found.events if event.kind == "restart")
    assert site.widenings == sum(1 for event in found.events if event.kind == "widening")
    assert len(site.placement.stands) == 1
    assert site.placement.exhausted is None
    assert site.redraws == 0
    # One leg, from the plaza approach to the site's approach point.
    (leg,) = found.legs
    assert found.approach is not None
    assert leg.polyline[0] == found.approach.far
    point = site.local.approach_point
    assert leg.polyline[-1] == (point[0] + site.centre[0], point[1] + site.centre[1])
    assert (leg.kind, leg.start, leg.end) == ("trail", "plaza", "set:ha1")
    assert found.cells == (found.world,)
    # The same inputs give the same layout.
    again = lay([set_site(1)])
    assert again.radius == found.radius
    assert [(s.x, s.z, s.yaw, s.vertex) for s in again.sites[0].placement.stands] == [
        (s.x, s.z, s.yaw, s.vertex) for s in site.placement.stands
    ]
    assert again.legs == found.legs


def test_every_widening_keeps_its_radius_across_restarts_and_passes():
    found = lay([set_site(12)])
    (site,) = found.sites
    radius = local.base_radius(12)
    for _ in range(site.widenings):
        radius = local.widened(radius)
    assert site.local.radius == radius
    assert site.widenings >= 1
    widenings = [event for event in found.events if event.kind == "widening"]
    assert [event.radius for event in widenings] == sorted(event.radius for event in widenings)
    assert {event.cause for event in widenings} <= set(WIDENING_CAUSES)
    assert all(event.site == "set:ha1" for event in widenings)
    # R is widened by ceil(11 R / 10) a pass.
    passes = [event.radius for event in found.events if event.kind == "pass"]
    assert passes[0] == found.initial_radius
    assert all(b == regions.widened_world(a) for a, b in itertools.pairwise(passes))
    assert passes[-1] == found.radius
    shorts = [event for event in found.events if event.kind == "short"]
    assert len(shorts) == found.passes - 1
    assert all(event.site == "set:ha1" and event.region is None for event in shorts)


def test_a_hero_world_places_era_sites_then_regional_sites_and_routes_a_spur():
    record = PlaneSet(1, "ix1", "First", 2001)
    held = cards(10, "ix1")
    era = SitePlan(
        "era:landfall",
        "era",
        "north",
        "landfall",
        (record,),
        held[:9],
        (Chapter(record, held[:9]),),
    )
    regional = SitePlan("region:south", "region", "south", None, (), held[9:], ())
    rows = [RegionRow("north", (0, 400), 1_000), RegionRow("south", (0, -400), 1_000)]
    found = allocate.allocate("ixalan", [era, regional], rows, [], directions())
    assert [site.region for site in found.sites] == [0, 1]
    assert len(found.cells) == 2
    # The era site stands in the northern cell and the regional site in the southern one.
    assert found.sites[0].centre[1] > 0 > found.sites[1].centre[1]
    trail_leg, spur = found.legs
    assert (trail_leg.kind, trail_leg.start, trail_leg.end) == ("trail", "plaza", "era:landfall")
    assert (spur.kind, spur.start, spur.end) == ("spur", "trail", "region:south")
    # The spur starts at a vertex of the trail so far.
    assert spur.polyline[0] in trail_leg.polyline
    assert [len(site.placement.stands) for site in found.sites] == [9, 1]


def test_a_world_with_no_site_has_a_plaza_and_no_trail():
    found = lay([])
    assert found.radius == found.initial_radius == 30_000
    assert (found.sites, found.legs, found.approach) == ((), (), None)


def test_a_site_that_never_reaches_capacity_fails_after_twenty_widenings(
    monkeypatch: pytest.MonkeyPatch,
):
    empty = capacity_step.Capacity(slots=(), total=0, void=2, cut=18_000, end=1, state=0)
    monkeypatch.setattr(capacity_step, "capacity_of", _always(empty))
    with pytest.raises(LayoutError) as raised:
        lay([set_site(4)])
    message = str(raised.value)
    assert "site 'set:ha1' of mercadia" in message
    assert f"capacity 0 for 4 after {SITE_WIDEN_LIMIT} widenings" in message
    assert "5.4.12" in message


def test_a_site_with_no_path_and_approach_fails_after_twenty_widenings(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(local, "build", _always(None))
    with pytest.raises(LayoutError, match="no path and approach in eighteen tries after 20"):
        lay([set_site(4)])


def test_a_region_still_short_on_the_twentieth_pass_fails_naming_the_region_and_the_site(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(allocate.placing, "place", _always(None))
    with pytest.raises(LayoutError) as raised:
        lay([set_site(4)])
    assert str(raised.value) == (
        f"mercadia: region 'the world' cannot hold site 'set:ha1' after {PASS_LIMIT} passes "
        "(5.4.12)"
    )


def test_a_leg_with_no_route_on_the_twentieth_pass_fails_naming_its_two_ends(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(trail, "leg", _always(None))
    with pytest.raises(LayoutError, match="the trail leg from 'plaza' to 'set:ha1' has no route"):
        lay([set_site(4)])


def test_a_plaza_approach_with_no_angle_makes_the_world_short(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(trail, "plaza_approach", _always(None))
    with pytest.raises(LayoutError) as raised:
        lay([set_site(4)])
    # The failure names the leg's two ends (5.4.11).
    assert str(raised.value) == (
        "mercadia: the trail leg from 'plaza' to 'set:ha1' has no route: the plaza approach "
        "finds no angle after 20 passes (5.4.12)"
    )


def square(x: int, z: int, half: int) -> Volume:
    return Volume(
        "keep",
        polygon(
            [(x - half, z - half), (x + half, z - half), (x + half, z + half), (x - half, z + half)]
        ),
    )


def test_a_hero_volume_over_the_arrival_point_or_the_return_pad_fails_naming_the_volume():
    with pytest.raises(LayoutError, match="hero volume 'keep' of mercadia covers the arrival"):
        allocate.allocate("mercadia", [set_site(4)], None, [square(0, 0, 2_000)], directions())
    with pytest.raises(LayoutError, match="hero volume 'keep' of mercadia covers the return pad"):
        allocate.allocate("mercadia", [set_site(4)], None, [square(0, -7_000, 1_000)], directions())


def test_a_hero_volume_within_two_millimetres_of_the_arrival_point_covers_it():
    # 5.4.18 (4): the arrival point must lie 2 mm clear of a volume, as every exclusion does.
    def north_of(gap: int) -> Volume:
        return Volume(
            "keep",
            polygon([(-2_000, gap), (2_000, gap), (2_000, gap + 3_000), (-2_000, gap + 3_000)]),
        )

    for gap in (-1_000, 0, 1):
        with pytest.raises(LayoutError, match="covers the arrival point"):
            allocate.allocate("mercadia", [set_site(4)], None, [north_of(gap)], directions())
    found = allocate.allocate("mercadia", [set_site(4)], None, [north_of(2)], directions())
    assert found.volumes[0].id == "keep"


def test_a_hero_volume_may_overlap_the_plaza_and_moves_the_first_site():
    free = lay([set_site(4)])
    # Over the plaza's north side, clear of the arrival point and of the return pad.
    on_plaza = allocate.allocate(
        "mercadia", [set_site(4)], None, [square(0, 9_000, 2_000)], directions()
    )
    assert on_plaza.sites[0].centre == free.sites[0].centre
    centre = free.sites[0].centre
    moved = allocate.allocate(
        "mercadia", [set_site(4)], None, [square(centre[0], centre[1], 10_000)], directions()
    )
    assert moved.sites[0].centre != centre
    assert moved.volumes[0].id == "keep"


# The redraw (reading X; the CEO's ruling 3 of 2026-10-14 on DEC-1004).


class Spy:
    """Records every local geometry built, and exhausts the first placement of chosen sites.

    ``exhaust`` maps a site key to the number of its placements, counted from its first, that
    report the site exhausted (the kept slots ran out). Every other placement is the real one.
    """

    def __init__(self, monkeypatch: pytest.MonkeyPatch, exhaust: dict[str, int]) -> None:
        self.built: list[tuple[int, str]] = []
        """(r_s, seed string) of every local geometry built, in order."""
        self.placed: list[tuple[str, int]] = []
        """(site key, r_s) of every placement computed, in order."""
        self.exhaust = dict(exhaust)
        self.after: list[str] = []
        """The site keys whose last forced exhaustion has happened, in order."""
        self._site: dict[int, str] = {}
        real_build, real_place = local.build, placement_step.place_site

        def build(radius: int, seed: str, directions: Any) -> Local | None:
            self.built.append((radius, seed))
            found = real_build(radius, seed, directions)
            if found is not None:
                self._site[id(found)] = seed.split("|")[2]
            return found

        def place(built: Local, capacity: Any, *more: Any) -> Placement:
            found = real_place(built, capacity, *more)
            key = self._site[id(built)]
            self.placed.append((key, built.radius))
            if self.exhaust.get(key, 0) > 0:
                self.exhaust[key] -= 1
                if self.exhaust[key] == 0:
                    self.after.append(key)
                return dataclasses.replace(found, exhausted=0)
            return found

        monkeypatch.setattr(local, "build", build)
        monkeypatch.setattr(placement_step, "place_site", place)


def seed(key: str, redraw: int = 0) -> str:
    plain = f"eternities-v4|mercadia|{key}"
    return plain if redraw == 0 else f"{plain}|{redraw}"


def after(events: tuple[Event, ...], event: Event) -> tuple[Event, ...]:
    return events[events.index(event) + 1 :]


def test_a_site_exhausted_at_placement_is_redrawn_at_the_same_radius_and_restarts():
    assert REDRAW_LIMIT == 1
    plan = set_site(4)
    law = lay([plan])
    with pytest.MonkeyPatch.context() as patch:
        spy = Spy(patch, {"set:ha1": 1})
        found = lay([plan])
    (redraw,) = [event for event in found.events if event.kind == "redraw"]
    radius = law.sites[0].local.radius
    assert (redraw.site, redraw.cause, redraw.radius) == ("set:ha1", RAN_OUT, radius)
    # The pass restarts at step (4), and step (4) builds the site again at the same r_s from
    # the seed string with |1.
    restart = after(found.events, redraw)[0]
    assert (restart.kind, restart.cause) == ("restart", REDRAWN)
    assert spy.placed == [("set:ha1", radius), ("set:ha1", radius)]
    assert spy.built[-1] == (radius, seed("set:ha1", 1))
    assert spy.built.count((radius, seed("set:ha1"))) == 1
    # No widening follows the redraw: the site is laid out at the same r_s with a = 1.
    assert not [event for event in after(found.events, redraw) if event.kind == "widening"]
    (site,) = found.sites
    assert (site.local.radius, site.redraws, site.widenings) == (radius, 1, law.sites[0].widenings)
    again = local.build(radius, seed("set:ha1", 1), directions())
    assert again is not None
    assert (site.local.blob.pts, site.local.path) == (again.blob.pts, again.path)
    assert len(site.placement.stands) == 4


def test_a_site_exhausted_again_after_its_redraw_is_widened_and_its_count_returns_to_zero():
    plan = set_site(4)
    radius = lay([plan]).sites[0].local.radius
    with pytest.MonkeyPatch.context() as patch:
        spy = Spy(patch, {"set:ha1": 2})
        found = lay([plan])
    (redraw,) = [event for event in found.events if event.kind == "redraw"]
    restart, widening, second = after(found.events, redraw)[:3]
    assert (restart.kind, restart.cause) == ("restart", REDRAWN)
    assert (widening.kind, widening.cause, widening.site) == ("widening", RAN_OUT, "set:ha1")
    assert widening.radius == local.widened(radius)
    assert (second.kind, second.cause) == ("restart", WIDENED)
    # Exhausted at a = 1 the site is widened, and the widened site's seed has no suffix.
    assert spy.placed == [("set:ha1", radius)] * 2 + [("set:ha1", local.widened(radius))]
    assert spy.built[-2:] == [
        (radius, seed("set:ha1", 1)),
        (local.widened(radius), seed("set:ha1")),
    ]
    (site,) = found.sites
    assert (site.local.radius, site.redraws) == (local.widened(radius), 0)


def test_the_redraw_count_is_kept_across_a_restart_and_a_pass_over_r(
    monkeypatch: pytest.MonkeyPatch,
):
    plans = [set_site(4, "ha1"), set_site(4, "ha2", first=5)]
    spy = Spy(monkeypatch, {"set:ha1": 1, "set:ha2": 1})
    # The first leg reserved after both redraws fails the leg check once, so R is widened.
    real_meets = trail.meets
    failed: list[bool] = []

    def meets(obstacles: Any, polyline: Any) -> tuple[str, int] | None:
        if len(spy.after) == 2 and not failed:
            failed.append(True)
            return ("blob", 0)
        return real_meets(obstacles, polyline)

    monkeypatch.setattr(trail, "meets", meets)
    found = lay(plans)
    first, second = [event for event in found.events if event.kind == "redraw"]
    assert (first.site, second.site) == ("set:ha1", "set:ha2")
    # set:ha1 is redrawn; the restart that set:ha2's redraw causes keeps its count, and so does
    # the pass over R that the failed leg causes.
    rest = after(found.events, first)
    assert [(e.kind, e.cause) for e in rest[:3]] == [
        ("restart", REDRAWN),
        ("redraw", RAN_OUT),
        ("restart", REDRAWN),
    ]
    short = next(event for event in rest if event.kind == "short")
    assert "has no route: its strip meets the blob of site 'set:ha1'" in short.text
    assert after(found.events, short)[0].kind == "pass"
    assert not [e for e in rest if e.kind == "widening" and e.site == "set:ha1"]
    ha1, ha2 = found.sites
    assert (ha1.local.radius, ha1.redraws) == (first.radius, 1)
    again = local.build(first.radius, seed("set:ha1", 1), directions())
    assert again is not None
    assert (ha1.local.blob.pts, ha1.local.path) == (again.blob.pts, again.path)
    # set:ha2's redrawn site has no capacity at the same r_s. That widening returns its count
    # to 0, as a widening for any cause does.
    widening = next(e for e in after(found.events, second) if e.kind == "widening")
    assert (widening.site, widening.cause) == ("set:ha2", CAPACITY)
    assert (ha2.local.radius, ha2.redraws) == (widening.radius, 0)
    assert (widening.radius, seed("set:ha2")) in spy.built


def test_a_pass_takes_at_most_41_restarts_for_each_site(monkeypatch: pytest.MonkeyPatch):
    # 5.4.12 with the redraw: at most 20 widenings and 21 redraws per site, so at most
    # 41 x (the number of sites) restarts in a pass.
    assert allocate.restart_bound(1) == 41 == SITE_WIDEN_LIMIT + (SITE_WIDEN_LIMIT + 1)
    assert allocate.restart_bound(26) == 1_066
    ample = capacity_step.Capacity(slots=(), total=100, void=0, cut=None, end=0, state=0)
    exhausted = Placement(
        stands=(), stones=(), end=0, exhausted=0, withdrawn=(), considered=0, rejected=()
    )
    placements: list[int] = []

    def place(built: Local, *more: Any) -> Placement:
        placements.append(built.radius)
        return exhausted

    monkeypatch.setattr(capacity_step, "capacity_of", _always(ample))
    monkeypatch.setattr(placement_step, "place_site", place)
    with pytest.raises(LayoutError, match=r"after 20 widenings \(r_s = "):
        lay([set_site(4)])
    # Placement exhausts the site twice at each of its 21 radii, once at a = 0 and once at
    # a = 1: 41 restarts, and the 42nd exhaustion fails the build.
    assert len(placements) == allocate.restart_bound(1) + 1
    radius = local.base_radius(4)
    for step in range(SITE_WIDEN_LIMIT + 1):
        assert placements[2 * step : 2 * step + 2] == [radius, radius]
        radius = local.widened(radius)
    # The loop of a pass reads the bound: a lower bound stops it.
    monkeypatch.setattr(allocate, "restart_bound", _always(3))
    with pytest.raises(AssertionError, match="unreachable"):
        lay([set_site(4)])


def test_every_restart_names_its_cause():
    found = lay([set_site(75, "arn")])
    restarts = [event for event in found.events if event.kind == "restart"]
    assert restarts
    assert {event.cause for event in restarts} <= set(RESTART_CAUSES)
    assert NO_FIT in RESTART_CAUSES


# The leg check (the CEO's ruling 3 of 2026-10-14 on DEC-1004).


def test_a_leg_that_fails_the_check_has_no_route_and_the_failure_names_its_two_ends(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(trail, "meets", _always(("stone", 0)))
    with pytest.raises(LayoutError) as raised:
        lay([set_site(4)])
    assert str(raised.value) == (
        "mercadia: the trail leg from 'plaza' to 'set:ha1' has no route: its strip meets the "
        f"stone of site 'set:ha1' after {PASS_LIMIT} passes (5.4.12)"
    )


def test_a_spur_that_fails_the_check_names_its_end_and_a_volume_is_named_by_its_id(
    monkeypatch: pytest.MonkeyPatch,
):
    record = PlaneSet(1, "ix1", "First", 2001)
    held = cards(10, "ix1")
    era = SitePlan(
        "era:landfall",
        "era",
        "north",
        "landfall",
        (record,),
        held[:9],
        (Chapter(record, held[:9]),),
    )
    regional = SitePlan("region:south", "region", "south", None, (), held[9:], ())
    rows = [RegionRow("north", (0, 400), 1_000), RegionRow("south", (0, -400), 1_000)]
    far = square(-900_000, 900_000, 1_000)
    calls: list[int] = []

    def meets(obstacles: Any, polyline: Any) -> tuple[str, int] | None:
        # Each pass reserves the trail leg, then the spur: the spur fails, then the leg.
        calls.append(1)
        return None if len(calls) % 2 else ("pad", 0)

    monkeypatch.setattr(trail, "meets", meets)
    with pytest.raises(LayoutError) as raised:
        allocate.allocate("ixalan", [era, regional], rows, [far], directions())
    assert str(raised.value) == (
        "ixalan: the spur from the trail to 'region:south' has no route: its strip meets the "
        f"pad of site 'era:landfall' after {PASS_LIMIT} passes (5.4.12)"
    )
    monkeypatch.setattr(trail, "meets", _always(("hero volume", 0)))
    with pytest.raises(LayoutError, match="its strip meets hero volume 'keep' after 20 passes"):
        allocate.allocate("ixalan", [era, regional], rows, [far], directions())
