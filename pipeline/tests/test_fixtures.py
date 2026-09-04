"""Fixture invariants. These are the subset of PRD 8.9.1 that Phase 0's synthetic data can carry."""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

import pytest

from eternities.contract import FRAME_RADIUS, SHARD_SIZE, decode_sets, decode_stars
from eternities.contract.encode import encode_artefacts, shard_count_for
from eternities.contract.enums import BLIND_ETERNITIES_SLUG, HueClass, PlaneKind
from eternities.contract.models import Dataset
from eternities.fixtures import SCALE, SMALL, build
from eternities.fixtures.generate import MULTIVERSE_RADIUS

REAL_HUE_SHARE: dict[HueClass, float] = {
    HueClass.WHITE: 0.1514,
    HueClass.BLUE: 0.1487,
    HueClass.BLACK: 0.1510,
    HueClass.RED: 0.1501,
    HueClass.GREEN: 0.1478,
    HueClass.MULTICOLOUR: 0.1654,
    HueClass.COLOURLESS: 0.0855,
}
"""Hue-class shares of the Phase 1 production dataset — 28,587 cards from the 2026-09-04 Scryfall
bulk after the PRD 4.3/4.4 filters. The same measurement `generate._COLOUR_IDENTITIES` is weighted
from, restated here so the two have to be changed together deliberately."""


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


@pytest.mark.parametrize(("name", "tolerance"), [("scale", 0.015), ("small", 0.05)])
def test_hue_classes_follow_the_real_card_distribution(
    name: str, tolerance: float, request: pytest.FixtureRequest
):
    """DEC-605. The five arms of PRD 5.4.1 are the mono-colour hue classes; multicolour goes to
    the bulge and colourless to the halo (`layout.card_position`). Phase 0 drew colour identity
    uniformly from a list that was 15/21 multicolour, so ~70% of every plane sat in the bulge and
    the planes rendered as round blobs. The fixture has to carry real Magic's proportions or
    nobody can judge the star field against it.

    The tolerance is per hue class and absolute; ``fixture-small`` draws 500 times, so it gets the
    wider band that sampling noise alone needs.
    """
    dataset: Dataset = request.getfixturevalue(name)
    counts = Counter(int(star.hue) for star in dataset.stars)
    for hue, expected in REAL_HUE_SHARE.items():
        share = counts[int(hue)] / len(dataset.stars)
        assert abs(share - expected) <= tolerance, (
            f"{hue.name} is {share:.2%} of {dataset.dataset}, real Magic is {expected:.2%}"
        )


def test_multicolour_never_dominates_a_spiral_plane(scale: Dataset):
    """The failure DEC-605 was filed for, stated per plane rather than in aggregate: a spiral's
    arms hold more stars than its bulge. A plane-level check is what catches a distribution that
    is right overall but skewed inside the planes that are actually rendered as spirals."""
    for plane in scale.planes:
        if plane.kind is not PlaneKind.SPIRAL:
            continue
        stars = scale.stars[plane.star_offset : plane.star_offset + plane.star_count]
        bulge = sum(1 for s in stars if s.hue is HueClass.MULTICOLOUR)
        arms = sum(1 for s in stars if int(s.hue) < 5)
        # Real Magic puts 4.5 arm stars in for every bulge star. The margin here is deliberately
        # slack: a 50-card spiral is the smallest one there is, and sampling noise alone moves its
        # ratio by a lot. The regression this locks out sat at 0.35.
        assert arms > 2 * bulge, (
            f"{plane.slug}: {bulge} stars in the bulge against {arms} in the arms"
        )


def test_writing_fixtures_elsewhere_leaves_the_registry_alone(tmp_path: Path):
    """CI regenerates the fixtures into a scratch directory to diff them against what is
    committed (`.github/workflows/ci.yml`). That must not touch `web/datasets.json`."""
    from eternities.cli import DATASETS_FILE, main

    before = DATASETS_FILE.read_bytes() if DATASETS_FILE.exists() else None
    assert main(["fixtures", "small", "--out", str(tmp_path), "--set-active", "small"]) == 0
    after = DATASETS_FILE.read_bytes() if DATASETS_FILE.exists() else None
    assert after == before
    assert len(list(tmp_path.iterdir())) == 1


def test_regenerating_fixtures_leaves_a_non_fixture_active_alone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """`active` may point at something `eternities fixtures` does not own — Phase 1's real dataset
    supersedes the fixtures as what the app ships (PRD 8.3). Regenerating must not quietly point
    the app back at synthetic data; only `--set-active` moves it."""
    from eternities import cli

    registry = tmp_path / "datasets.json"
    registry.write_text(
        json.dumps({"active": "deadbeefdeadbeef", "production": "deadbeefdeadbeef"}) + "\n",
        encoding="utf-8",
    )
    data_root = tmp_path / "data"
    monkeypatch.setattr(cli, "DATASETS_FILE", registry)
    monkeypatch.setattr(cli, "WEB_DATA_ROOT", data_root)

    assert cli.main(["fixtures", "small", "--out", str(data_root)]) == 0
    written = json.loads(registry.read_text(encoding="utf-8"))
    assert written["active"] == "deadbeefdeadbeef"
    assert written["fixtures"]["small"] != "deadbeefdeadbeef"

    assert cli.main(["fixtures", "small", "--out", str(data_root), "--set-active", "small"]) == 0
    written = json.loads(registry.read_text(encoding="utf-8"))
    assert written["active"] == written["fixtures"]["small"]


def test_scratch_fixtures_match_the_committed_ones(tmp_path: Path):
    """The committed data directories must be exactly what the generator produces today."""
    from eternities.cli import WEB_DATA_ROOT, main

    assert main(["fixtures", "all", "--out", str(tmp_path)]) == 0
    for produced in sorted(tmp_path.iterdir()):
        committed = WEB_DATA_ROOT / produced.name
        assert committed.is_dir(), f"{produced.name} is not committed under web/public/data/"
        for path in sorted(produced.rglob("*")):
            if path.is_file():
                relative = path.relative_to(produced)
                assert path.read_bytes() == (committed / relative).read_bytes(), (
                    f"{relative} differs from the committed fixture"
                )
