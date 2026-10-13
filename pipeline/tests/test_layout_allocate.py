"""The outer iteration of PRD v4 5.4.12: its order, its restarts, its bounds and its failures.

Small one-site worlds run end to end here in well under a second. Dominaria runs in the
fixtures (``eternities layout fixtures --check``), not in this file.
"""

from __future__ import annotations

import itertools
from typing import Any

import pytest

from eternities.layout import allocate, local, regions, trail
from eternities.layout import capacity as capacity_step
from eternities.layout.allocate import (
    CAPACITY,
    CUT,
    NO_PATH,
    RAN_OUT,
    WIDENING_CAUSES,
    LayoutError,
    Volume,
)
from eternities.layout.cards import PlaneCard, PlaneSet
from eternities.layout.constants import PASS_LIMIT, SITE_WIDEN_LIMIT
from eternities.layout.geometry import polygon
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


def set_site(count: int, code: str = "ha1") -> SitePlan:
    record = PlaneSet(1, code, code, 2000)
    return SitePlan(f"set:{code}", "set", None, None, (record,), cards(count, code), ())


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


def test_reading_x_redraws_a_site_at_the_same_radius_and_the_law_does_not():
    # Reading X is measured for DEC-1040 and is not the law: the default limit is 0.
    plan = set_site(75, "arn")
    law = allocate.allocate("rabiah", [plan], None, [], directions())
    assert law.sites[0].redraws == 0
    assert not [event for event in law.events if event.kind == "redraw"]
    exhausted = [event for event in law.events if event.cause in (RAN_OUT, CUT)]
    assert exhausted
    assert {event.cause for event in law.events if event.kind == "widening"} <= {
        CAPACITY,
        NO_PATH,
        RAN_OUT,
        CUT,
    }
    redrawn = allocate.allocate("rabiah", [plan], None, [], directions(), redraw_limit=1)
    redraws = [event for event in redrawn.events if event.kind == "redraw"]
    assert redraws
    # A redraw keeps the radius; the widening that follows it returns the count to 0.
    first = redraws[0]
    assert first.site == "set:arn"
    assert local.widened(first.radius) == exhausted[0].radius
    assert redrawn.sites[0].local.radius <= law.sites[0].local.radius
    assert len(redrawn.sites[0].placement.stands) == 75


def test_reading_j_redraws_the_jitter_and_keeps_the_sites_geometry():
    # The second measured reading: the site keeps its seed, so a redraw changes no blob, no
    # path and no capacity, and only the jitter stream of placement.
    plan = set_site(75, "arn")
    law = allocate.allocate("rabiah", [plan], None, [], directions())
    kept = allocate.allocate(
        "rabiah", [plan], None, [], directions(), redraw_limit=1, redraw_scope="jitter"
    )
    redraws = [event for event in kept.events if event.kind == "redraw"]
    assert redraws
    assert len(kept.sites[0].placement.stands) == 75
    # The first radius is tried under the same seed as the law's: the same first widening.
    first_law = next(event for event in law.events if event.kind == "widening")
    first_kept = next(event for event in kept.events if event.kind == "widening")
    assert (first_law.cause, first_law.radius) == (first_kept.cause, first_kept.radius)
    site = kept.sites[0]
    again = local.build(site.local.radius, "eternities-v4|rabiah|set:arn", directions())
    assert again is not None
    assert (site.local.blob.pts, site.local.path) == (again.blob.pts, again.path)
