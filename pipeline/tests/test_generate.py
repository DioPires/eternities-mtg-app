"""Unit tests for :mod:`eternities.fixtures.generate` (review finding D10).

``generate.py`` is 557 lines and was reached only end-to-end, through ``test_fixtures.py`` and the
committed fixture hashes. Line coverage was already high — 97% before this file existed — which is
exactly why it needed unit tests rather than more coverage: end-to-end assertions on the two built
fixtures pin what the whole generator *produces*, not what each rule *is*, so a broken rule shows
up as "the fixture hash moved" and the reader has to work out which of the 557 lines did it.

Each test here drives one helper and asserts the property that helper exists to guarantee, so a
break names the rule. The two committed fixtures stay the acceptance test; these are the diagnosis.
"""

from __future__ import annotations

import pytest

from eternities.contract.enums import BLIND_ETERNITIES_SLUG, SHARD_SIZE, HueClass, hue_class_for
from eternities.contract.models import PlaneSetRef
from eternities.fixtures import SMALL, build, generate
from eternities.fixtures.generate import (
    BLIND_ETERNITIES_SHARE,
    FixtureSpec,
    blind_eternities_shard_count,
)

ROSTER = [p["slug"] for p in generate._roster()]


# --- the roster, and what a spec is allowed to ask for ----------------------------------------


def test_the_roster_is_read_from_appendix_a_and_carries_the_blind_eternities():
    assert BLIND_ETERNITIES_SLUG in ROSTER
    assert len(ROSTER) == len(set(ROSTER)), "a duplicate slug would double-count a plane"


def test_a_spec_naming_an_unknown_plane_drops_it_rather_than_inventing_one():
    """``build`` filters ``plane_slugs`` against the roster.

    A slug the roster does not have cannot get a ``displayName`` or ``notes``, and the pipeline's
    own assembly refuses that case outright (``build_dataset`` raises on planes absent from
    Appendix A). The generator's answer is to drop it, so the two never disagree about what a
    roster is — but the fixture then silently has fewer planes than its spec asked for, which is
    worth a test rather than a reading of the comprehension.
    """
    spec = FixtureSpec(
        name="probe",
        plane_slugs=[BLIND_ETERNITIES_SLUG, "dominaria", "not-a-plane"],
        total_cards=80,
        as_of="2026-09-04",
    )
    dataset = build(spec)
    assert sorted(p.slug for p in dataset.planes) == [BLIND_ETERNITIES_SLUG, "dominaria"]


def test_a_spec_that_omits_the_blind_eternities_is_refused():
    """PRD 4.7.3: the dust plane is not optional, and the generator will not quietly add it.

    Refusing rather than repairing is the right half of the choice — a fixture missing the dust
    plane has no catch-all for the cards no plane claims, and silently inserting one would make
    the spec a lie about what was built.
    """
    spec = FixtureSpec(
        name="probe", plane_slugs=["dominaria", "ravnica"], total_cards=80, as_of="2026-09-04"
    )
    with pytest.raises(ValueError, match="Blind Eternities"):
        build(spec)


# --- _allocate_cards -------------------------------------------------------------------------


@pytest.mark.parametrize("total", [50, 500, 4321, 30000])
def test_the_allocation_spends_the_whole_budget_exactly(total: int):
    """The rounding drift is absorbed into the largest plane, so the total must be exact.

    Asserted across four sizes because the drift is a function of how the Zipf weights round, and
    a single size can be exact by luck.
    """
    counts = generate._allocate_cards(ROSTER, total)
    assert sum(counts.values()) == total


def test_the_blind_eternities_gets_its_prd_9_2_2_share():
    total = 30000
    counts = generate._allocate_cards(ROSTER, total)
    assert counts[BLIND_ETERNITIES_SLUG] == round(total * BLIND_ETERNITIES_SHARE)
    assert 0.20 <= counts[BLIND_ETERNITIES_SLUG] / total <= 0.25, "PRD 9.2.2's band"


def test_the_allocation_produces_all_three_plane_morphologies():
    """PRD 5.3.6 has three shapes and the fixtures are what the renderer is developed against.

    The tail is explicit in ``_allocate_cards`` rather than emergent precisely so this holds; an
    allocation that happened to give every plane 50+ cards would leave the irregular-cloud and
    empty-glow paths untested at fixture scale and nobody would notice until production.
    """
    counts = generate._allocate_cards(ROSTER, 30000)
    named = {s: n for s, n in counts.items() if s != BLIND_ETERNITIES_SLUG}
    assert any(n == 0 for n in named.values()), "no empty plane"
    assert any(0 < n < 50 for n in named.values()), "no irregular cloud"
    assert any(n >= 50 for n in named.values()), "no spiral"


def test_a_budget_too_small_for_a_spiral_each_spreads_the_roster_instead_of_starving_it():
    """Pins ``_allocate_cards``' conditional ``floor`` (review note N1).

    The guard is a *morphology* guard, not the negative-count fix — ``_spend_exactly``'s clawback
    is what keeps counts non-negative, and forcing the floor unconditionally leaves every other
    test in this file green. What it costs is shape: at the full roster on 500 cards the floor
    would hand ``SPIRAL_THRESHOLD`` to each large plane, the clawback would take it all back off
    the tail, and 87 planes would collapse to 9 non-empty ones. Guarded, the same budget spreads
    over 63 — a fixture whose planes are nearly all empty is not one the renderer can be developed
    against.
    """
    counts = generate._allocate_cards(ROSTER, 500)
    assert sum(counts.values()) == 500
    assert sum(1 for n in counts.values() if n > 0) > 40, "budget collapsed onto a few planes"


def test_the_allocation_never_goes_negative_on_a_budget_too_small_for_the_shape():
    """A found bug, and the reason this file exists (review finding D10).

    Every large plane wanted ``SPIRAL_THRESHOLD`` cards and every small plane drew 1-49 regardless
    of the budget, so the single-plane drift absorption at the end went negative. The full roster
    at 500 cards handed `shandalar` **-3,063** cards; at 5,000 it was still -582. Neither shipped
    spec reaches it — ``SMALL`` is 500 cards over 5 planes and ``SCALE`` is 30,000 over 87 — but a
    fixture spec is a four-line addition, and a negative card count does not raise: it flows into
    ``star_count`` and encodes as a corrupt dataset.
    """
    for total in [0, 1, 5, 20, 50, 100, 500, 1000, 5000]:
        counts = generate._allocate_cards(ROSTER, total)
        assert all(n >= 0 for n in counts.values()), f"total={total}: {_negatives(counts)}"
        assert sum(counts.values()) == total, f"total={total} allocated {sum(counts.values())}"


def test_the_allocation_partitions_a_tiny_roster_instead_of_double_counting_one_plane():
    """The other half of the same bug: the three size bands overlapped.

    At two named planes the small band and the large-plane fallback resolved to the *same* plane,
    which was added to ``small_total`` and then overwritten by the large loop — so the budget was
    charged twice for one plane and the allocation no longer summed to ``total``. Three planes at
    a total of 0 came out at **-23**.

    The budgets have to reach past the low hundreds, and that is not decoration (review finding
    B1). Below a total of 65 the small band's ``room`` cap drives every small draw to 0, so the
    overlapping plane contributes nothing and there is no double charge to see: restoring the
    pre-fix slicing leaves a ``range(40)`` sweep entirely green. The two-named-plane roster is the
    one that breaks, contiguously from a total of 65 up — at 500 it allocates 477.
    """
    for roster in (
        [BLIND_ETERNITIES_SLUG, "dominaria"],
        [BLIND_ETERNITIES_SLUG, "dominaria", "ravnica"],
        [BLIND_ETERNITIES_SLUG, "dominaria", "ravnica", "innistrad"],
    ):
        for total in [*range(40), 65, 100, 500, 5000, 30000]:
            counts = generate._allocate_cards(roster, total)
            assert sum(counts.values()) == total, f"{len(roster)} planes, total={total}: {counts}"
            assert all(n >= 0 for n in counts.values()), f"{roster} at {total}: {counts}"
            assert set(counts) == set(roster)


def _negatives(counts: dict[str, int]) -> dict[str, int]:
    return {slug: n for slug, n in counts.items() if n < 0}


def test_the_allocation_is_deterministic_for_one_roster_and_budget():
    """PRD 8.2: every choice is a keyed hash, so there is nothing to re-seed."""
    assert generate._allocate_cards(ROSTER, 500) == generate._allocate_cards(ROSTER, 500)


def test_a_roster_of_only_the_blind_eternities_allocates_without_dividing_by_zero():
    counts = generate._allocate_cards([BLIND_ETERNITIES_SLUG], 100)
    assert counts == {BLIND_ETERNITIES_SLUG: round(100 * BLIND_ETERNITIES_SHARE)}


# --- _sets_for_plane -------------------------------------------------------------------------


@pytest.mark.parametrize("card_count", [1, 7, 49, 50, 300, 4000, 30000])
def test_the_chronology_bands_account_for_every_card(card_count: int):
    """PRD 5.4.2: the bands *are* the plane's cards, partitioned. A card outside every band has
    no chronological position, and ``_plane_cards`` would have to park it somewhere."""
    bands = generate._sets_for_plane("dominaria", card_count)
    assert sum(count for _, _, _, count in bands) == card_count
    assert 1 <= len(bands) <= 24


def test_a_zero_card_plane_has_no_bands():
    assert generate._sets_for_plane("segovia", 0) == []


@pytest.mark.parametrize("card_count", [1, 300, 30000])
def test_the_bands_are_in_chronological_order_with_unique_codes(card_count: int):
    """Data contract §4: "band `b` of a plane is `sets[b]`", so the order is the artefact."""
    bands = generate._sets_for_plane("ravnica", card_count)
    years = [year for _, _, year, _ in bands]
    assert years == sorted(years)
    codes = [code for code, _, _, _ in bands]
    assert len(codes) == len(set(codes))


# --- _printings ------------------------------------------------------------------------------


def test_a_cards_first_printing_is_in_its_own_set():
    """PRD 5.6.7's planet list starts at the card's own set; a reprint pool entry would put the
    card's first printing on a plane it does not belong to."""
    for i in range(200):
        printings = generate._printings(f"oracle-{i}", first_set_id=7, reprint_pool=[1, 2, 3, 4])
        assert printings[0].set_id == 7


def test_printing_counts_stay_inside_the_prd_range_and_skew_low():
    """1-6 printings, weighted toward 1 (``unit ** 2.4``) — the real distribution's shape.

    A flat draw would centre the fixtures on 3.5 printings a card, which is nothing like Magic and
    would make PRD 5.4.10's brightness curve read as uniform across a plane. Measured on 4,000
    draws: mean 2.18, and 47.9% of cards have exactly one printing. Asserted as "the single-printing
    mode dominates and the mean sits well under the flat 3.5" rather than against those figures,
    because the exponent is a tunable and the shape is what has to survive tuning.
    """
    counts = [
        len(generate._printings(f"oracle-{i}", 0, [1, 2, 3, 4, 5, 6, 7, 8])) for i in range(4000)
    ]
    assert min(counts) >= 1
    assert max(counts) <= 6
    assert sum(counts) / len(counts) < 2.75, "a flat 1-6 draw would sit at 3.5"
    singles = sum(1 for n in counts if n == 1) / len(counts)
    assert singles > 0.35, f"one printing must be the mode; it is {singles:.1%}"


def test_a_reprint_pool_of_one_set_yields_exactly_one_printing():
    """The de-duplication path: every reprint draw collides with the first set and is skipped."""
    printings = generate._printings("oracle-1", first_set_id=3, reprint_pool=[3])
    assert [p.set_id for p in printings] == [3]


def test_printing_ids_are_distinct_within_a_card():
    printings = generate._printings("oracle-1", 0, list(range(1, 20)))
    ids = [p.id for p in printings]
    assert len(ids) == len(set(ids))


# --- _plane_cards ----------------------------------------------------------------------------


def _refs(counts: list[int]) -> list[PlaneSetRef]:
    return [
        PlaneSetRef(id=i, code=f"c{i:02d}", name=f"Set {i}", year=1993 + i, card_count=n)
        for i, n in enumerate(counts)
    ]


def test_plane_cards_are_emitted_in_the_stars_bin_order():
    """PRD 8.3: band, then arm, then oracle id. This ordering is what makes plane star ranges
    contiguous and shard boundaries computable, so it is a contract, not a convenience."""
    rows = generate._plane_cards("dominaria", 120, _refs([40, 40, 40]), [0, 1, 2])
    keys = [(row.band, int(row.hue), row.card.oracle_id) for row in rows]
    assert keys == sorted(keys)


def test_every_card_gets_a_band_even_when_the_refs_undercount():
    """``_sets_for_plane``'s rounding can leave the last cards without a band of their own.

    The generator parks them in the final band rather than raising. That choice is only safe if
    nothing ends up band-less — a missing entry would be an ``IndexError`` mid-build — so the
    under-count is driven here directly instead of waiting for a card count that produces it.
    """
    rows = generate._plane_cards("dominaria", 10, _refs([3, 3]), [0, 1])
    assert len(rows) == 10
    assert {row.band for row in rows} <= {0, 1}
    assert sum(1 for row in rows if row.band == 1) == 7, "the drift lands in the last band"


def test_a_plane_with_no_bands_falls_back_to_the_reprint_pool_for_its_first_set():
    rows = generate._plane_cards("dominaria", 5, [], [9])
    assert len(rows) == 5
    assert all(row.card.printings[0].set_id == 9 for row in rows)
    assert {row.band for row in rows} == {0}


def test_the_hue_class_recorded_on_a_row_is_the_one_its_identity_implies():
    """The row's hue is what sorts it into an arm; a disagreement with the card's own colour
    identity would put a star in the wrong arm of PRD 5.4.1 while every artefact still validated."""
    rows = generate._plane_cards("ravnica", 300, _refs([150, 150]), [0, 1])
    for row in rows:
        assert row.hue == hue_class_for(row.card.colour_identity)


def test_two_faced_layouts_get_a_back_and_normal_ones_do_not():
    """Contract §9: ``b`` answers "is there a second face", not "is there a back image"."""
    rows = generate._plane_cards("innistrad", 600, _refs([600]), [0])
    seen: dict[str, bool] = {}
    for row in rows:
        seen.setdefault(row.card.layout, row.card.back is not None)
        assert (row.card.back is not None) == seen[row.card.layout], (
            f"layout {row.card.layout!r} is inconsistent about having a second face"
        )
    assert seen.get("normal") is False
    assert any(has_back for layout_name, has_back in seen.items() if layout_name != "normal")


def test_only_a_meld_back_carries_its_own_printing_id():
    """A meld result is a separate Scryfall object, so its image is not derivable from the
    component's printing; every other two-faced layout shares the front's printing."""
    rows = generate._plane_cards("innistrad", 1200, _refs([1200]), [0])
    backs = [(row.card.layout, row.card.back) for row in rows if row.card.back is not None]
    assert backs, "no two-faced card in 1200 draws means the layout weights broke"
    for layout_name, back in backs:
        assert back is not None
        if layout_name == "meld":
            assert back.printing_id is not None and back.image_ts is not None
        else:
            assert back.printing_id is None and back.image_ts is None


def test_a_cards_set_ids_are_the_sorted_unique_sets_of_its_printings():
    rows = generate._plane_cards("dominaria", 200, _refs([100, 100]), [0, 1, 2, 3])
    for row in rows:
        assert row.card.set_ids == sorted({p.set_id for p in row.card.printings})


# --- _mana_cost ------------------------------------------------------------------------------


@pytest.mark.parametrize("identity", ["", "W", "WU", "WUBRG"])
def test_a_mana_cost_carries_one_pip_per_colour_in_its_identity(identity: str):
    cost = generate._mana_cost("oracle-1", identity)
    for colour in identity:
        assert f"{{{colour}}}" in cost


def test_a_colourless_card_still_has_a_cost():
    """``{0}`` is a real Magic cost and the only thing a colourless card can be given here; an
    empty string would render as a blank cost line in the card panel."""
    for i in range(50):
        assert generate._mana_cost(f"oracle-{i}", "") != ""


# --- _palette and the shard count -------------------------------------------------------------


def test_a_palette_is_the_hue_distribution_and_sums_to_one():
    rows = generate._plane_cards("dominaria", 400, _refs([400]), [0])
    palette = generate._palette(rows)
    assert len(palette) == 7
    assert abs(sum(palette) - 1.0) < 1e-9
    for hue in HueClass:
        share = sum(1 for row in rows if row.hue == hue) / len(rows)
        assert abs(palette[int(hue)] - share) < 1e-9


def test_an_empty_plane_gets_a_flat_palette_rather_than_a_division_by_zero():
    palette = generate._palette([])
    assert abs(sum(palette) - 1.0) < 1e-9
    assert len(set(palette)) == 1


# --- the synthetic art statistic (§2.2, DEC-796) ----------------------------------------------
#
# These tests are the reason the column exists at all. `fixture-scale` carries swatches so the
# worlds roster can compose in CI (DEC-793), and a column that composed but said nothing would buy
# that coverage in name only: every worlds surface would then run against data that cannot show a
# bug. So each test pins one property that makes a drawn swatch load-bearing rather than decorative.


def _channels(sample: int) -> tuple[int, int, int]:
    """One packed RGB565 sample back into its (5, 6, 5)-bit components."""
    return (sample >> 11, (sample >> 5) & 0x3F, sample & 0x1F)


def test_a_swatch_column_reproduces_exactly_between_builds():
    """The dataset name is a content hash (PRD 4.9.1), so a swatch that drifted would move it."""
    first = build(SMALL)
    second = build(SMALL)
    assert first.swatches == second.swatches
    assert first.swatches, "a fixture with no swatches cannot compose a worlds roster"


def test_the_swatch_column_is_parallel_to_the_stars():
    """Star order *is* the encoding (§2.2): the browser's lookup is ``starIndex * 8 + 16``."""
    dataset = build(SMALL)
    assert len(dataset.swatches) == len(dataset.stars)


def test_swatches_differ_between_cards_rather_than_repeating_one_value():
    """A constant column cannot show a misrouted lookup.

    Reading the wrong card's swatch is invisible when every card's swatch is the same, and the
    worlds surface reads this column by star index across the whole roster. Asserted on the *drawn*
    quantity as well — ``worldSource.ts`` reduces the four samples to their mean — because a column
    whose records differ but whose means do not would still paint every cell the same colour.
    """
    dataset = build(SMALL)
    assert len(set(dataset.swatches)) == len(dataset.swatches)
    means = {
        tuple(sum(c) / 4 for c in zip(*(_channels(s) for s in swatch), strict=True))
        for swatch in dataset.swatches
    }
    assert len(means) == len(dataset.swatches)


def test_no_component_sits_on_a_channel_endpoint_and_no_2x2_is_one_value_four_times():
    """0 and full scale are what a cleared buffer and a saturated default look like.

    A swatch that landed on either could not testify that the data path ran at all, and four
    identical samples would make the 2x2 one value written four times — so the corners are
    asserted distinct as well. PRD 8.2's seeded rules make both properties reproducible, not lucky.
    """
    dataset = build(SMALL)
    for swatch in dataset.swatches:
        assert len(set(swatch)) > 1, f"{swatch} is one value written four times"
        for sample in swatch:
            red, green, blue = _channels(sample)
            assert 0 < red < 31, f"red {red} sits on a 5-bit endpoint"
            assert 0 < green < 63, f"green {green} sits on a 6-bit endpoint"
            assert 0 < blue < 31, f"blue {blue} sits on a 5-bit endpoint"


def test_the_shard_count_covers_every_dust_card():
    dataset = build(SMALL)
    blind = next(p for p in dataset.planes if p.slug == BLIND_ETERNITIES_SLUG)
    shards = blind_eternities_shard_count(dataset)
    assert shards >= 1
    assert (shards - 1) * SHARD_SIZE < max(blind.card_count, 1) <= shards * SHARD_SIZE


def test_the_shard_count_is_at_least_one_even_with_no_dust_cards():
    """The app fetches shard 0 unconditionally; a count of zero would make that a 404."""
    spec = FixtureSpec(
        name="probe", plane_slugs=[BLIND_ETERNITIES_SLUG], total_cards=0, as_of="2026-09-04"
    )
    assert blind_eternities_shard_count(build(spec)) == 1
