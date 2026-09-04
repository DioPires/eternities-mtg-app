"""Fixture invariants. These are the subset of PRD 8.9.1 that Phase 0's synthetic data can carry."""

from __future__ import annotations

import math

import pytest

from eternities.contract import FRAME_RADIUS, SHARD_SIZE, decode_sets, decode_stars
from eternities.contract.encode import encode_artefacts, shard_count_for
from eternities.contract.enums import BLIND_ETERNITIES_SLUG, PlaneKind
from eternities.contract.models import Dataset
from eternities.fixtures import SCALE, SMALL, build
from eternities.fixtures.generate import MULTIVERSE_RADIUS


@pytest.fixture(scope="module")
def small() -> Dataset:
    return build(SMALL)


@pytest.fixture(scope="module")
def scale() -> Dataset:
    return build(SCALE)


def test_small_fixture_shape(small: Dataset):
    assert small.dataset == "fixture-small"
    assert len(small.planes) == 5  # four planes plus the Blind Eternities
    assert len(small.stars) == 500
    blind = next(p for p in small.planes if p.slug == BLIND_ETERNITIES_SLUG)
    assert shard_count_for(blind.card_count) == 1, "fixture-small must stay at one dust shard"


def test_scale_fixture_shape(scale: Dataset):
    assert scale.dataset == "fixture-scale"
    assert len(scale.planes) == 83, "every Appendix A roster entry, Blind Eternities included"
    assert len(scale.stars) == 30000
    blind = next(p for p in scale.planes if p.slug == BLIND_ETERNITIES_SLUG)
    assert shard_count_for(blind.card_count) > 1, "fixture-scale must exercise sharded dust"
    assert any(p.kind is PlaneKind.EMPTY for p in scale.planes), "PRD 5.3.6 zero-card planes"
    assert any(p.kind is PlaneKind.SPIRAL for p in scale.planes)
    assert any(p.kind is PlaneKind.IRREGULAR for p in scale.planes)


@pytest.mark.parametrize("name", ["small", "scale"])
def test_every_card_has_exactly_one_plane(name: str, request: pytest.FixtureRequest):
    dataset: Dataset = request.getfixturevalue(name)
    covered = 0
    for plane in dataset.planes:
        assert plane.star_offset == covered
        for i in range(plane.star_offset, plane.star_offset + plane.star_count):
            assert dataset.stars[i].plane_index == plane.index
        covered += plane.star_count
    assert covered == len(dataset.stars)


@pytest.mark.parametrize("name", ["small", "scale"])
def test_positions_stay_inside_the_frame_radius(name: str, request: pytest.FixtureRequest):
    """PRD 8.9.1, checked after the float16 round trip rather than before it."""
    dataset: Dataset = request.getfixturevalue(name)
    artefacts, _ = encode_artefacts(dataset)
    stars = decode_stars(next(a.data for a in artefacts if a.path == "stars.bin"))
    for i, s in enumerate(stars):
        length = math.sqrt(s.x**2 + s.y**2 + s.z**2)
        assert length <= FRAME_RADIUS, f"star {i} at {length:.4f} escapes the frame radius"


def test_planes_never_overlap_including_drift(scale: Dataset):
    """PRD 5.3.3: spacing exceeds the radii sum plus twice the drift amplitude."""
    named = [p for p in scale.planes if p.slug != BLIND_ETERNITIES_SLUG]
    for i, a in enumerate(named):
        for b in named[i + 1 :]:
            distance = math.dist(a.home, b.home)
            required = a.radius + b.radius + 2 * (a.drift_amplitude + b.drift_amplitude)
            assert distance >= required, f"{a.slug} and {b.slug} can touch while drifting"


def test_blind_eternities_is_the_identity_transform(scale: Dataset):
    """PRD 8.3: row zero, identity transform, radius R, zero spin."""
    blind = scale.planes[0]
    assert blind.slug == BLIND_ETERNITIES_SLUG
    assert blind.index == 0
    assert blind.tilt == (0.0, 0.0, 0.0, 1.0)
    assert blind.home == (0.0, 0.0, 0.0)
    assert blind.radius == MULTIVERSE_RADIUS
    assert blind.spin_period_s == 0.0


def test_set_ids_are_sorted_and_deduplicated(small: Dataset):
    for card in small.cards:
        assert card.set_ids == sorted(set(card.set_ids))
        assert card.set_ids, "every card has at least one included printing (PRD 4.4.1)"


def test_sets_bin_round_trips_through_the_contract(small: Dataset):
    artefacts, _ = encode_artefacts(small)
    oracle_ids, per_star = decode_sets(next(a.data for a in artefacts if a.path == "sets.bin"))
    assert oracle_ids == [c.oracle_id for c in small.cards]
    assert per_star == [c.set_ids for c in small.cards]


def test_shards_cover_every_card_exactly_once(small: Dataset):
    artefacts, manifest = encode_artefacts(small)
    import json

    for plane in small.planes:
        seen: list[str] = []
        for shard in range(manifest["planeShards"][plane.slug]):
            payload = json.loads(
                next(a.data for a in artefacts if a.path == f"planes/{plane.slug}.{shard}.json")
            )
            assert payload["starOffset"] == plane.star_offset + shard * SHARD_SIZE
            seen.extend(c["u"] for c in payload["cards"])
        expected = [
            c.oracle_id
            for c in small.cards[plane.star_offset : plane.star_offset + plane.star_count]
        ]
        assert seen == expected


def test_generation_is_deterministic():
    """PRD 4.9.1: same inputs, byte-identical outputs."""
    first, _ = encode_artefacts(build(SMALL))
    second, _ = encode_artefacts(build(SMALL))
    assert [(a.path, a.sha256) for a in first] == [(a.path, a.sha256) for a in second]


def test_blind_eternities_share_is_in_the_expected_band(scale: Dataset):
    """PRD 9.2.2 expects 20-25% in the real data; the fixture should not mislead the bench."""
    blind = scale.planes[0]
    share = blind.star_count / len(scale.stars)
    assert 0.20 <= share <= 0.25
