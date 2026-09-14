"""The surface law of docs/worlds/spec.md §1.3 — contract v3's replacement for the spiral disc.

**Latitude is colour. Longitude is time.** Both per plane, never global. A world is a sphere tiled
with one cell per card; a cell's position is its card's colour class (a latitude band) and its
first-printing set (a longitude slice), so where a card sits on a world *means* something.

Three things in here are easy to get wrong and expensive to get wrong, and each has a guard:

**``theta`` is colatitude, everywhere.** Measured from the north pole, ``theta in [0, pi]``, row
``i``'s centre at ``(i + 1/2)*dphi``, latitude ``pi/2 - theta``. A row is a *small* circle of radius
``sin(theta)``, which is why :func:`seed_row_cells` carries ``sin`` and not ``cos``. Read as
latitude
the same formula runs ``+1 -> -1`` down the sphere and Dominaria's 81 rows sum to **zero** cells
(DEC-749 D1).

**Rows are equal-angle; bands are equal-area.** ``dphi = pi / rows`` is fixed and the row latitudes
never move. A band's share of ``cos(theta)`` is its colour class's share of the plane's cards,
so the
area a colour covers *is* the fraction of the plane that colour is. The two systems are independent,
so a band boundary generally falls **mid-row** — legal and intended. Band boundaries are never
snapped to rows: snapping would quantise a colour's area to ``1/rows`` and break the central claim.

**The per-row cell counts are population-derived, not closed-form.** The closed form is only the
starting point; :func:`build_grid` apportions each colour class's *actual* card count across
the rows
that class's band overlaps, in proportion to the overlap area. That is what delivers §1.3's
target of
**100% exact, zero displaced, zero bare** — and it is why the counts are shipped in ``planes.json``
rather than re-derived on the client (§2.1, §2.4). Rabiah is the proof the difference bites: the
closed form gives 78 slots for 75 cards.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from ..contract.enums import HueClass

ASPECT: Final = 4 / 3
"""§1.3: a cell is 4:3 because that is what an ``art_crop`` letterboxes into without being
stretched. Scryfall's terms forbid stretching card art, and 4:3 is how concept B avoids inheriting
the problem review §4.4 flags in the shipped planet shader."""

RADIUS_PER_ROOT_CARD: Final = 0.126
"""§1.3: ``radius = 0.126 * sqrt(cardCount)`` — **constant area per card**.

This is the law that makes Dominaria's 22% share of the multiverse visible: r 9.97 against Rabiah's
1.09, a 9.1x ratio, where PRD 5.3.2's ``log N`` gives 1.568x for the same pair. It has no clamp and
needs none — area per card is the invariant, so there is nothing to saturate (which is what PRD
5.3.2's ``RADIUS_SPAN_CARDS`` and its per-plane saturation report existed to watch)."""

MOON_RADIUS: Final = 0.55
"""§1.8: ``sqrt(0) = 0``, so the empty planes take a floor and become dark moons — present, unlit
and unlabelled until hover. Emptiness becomes a colour, not a size.

**It is a floor on every plane, not a special case for the empty ones** (DEC-749). Applied only
where ``cardCount == 0`` the law *inverts*: ``0.126 * sqrt(N)`` does not reach 0.55 until
**N = 20**, so a one-card world came out at radius 0.126 — under a quarter of the empty moon
beside it — and **15 of the v3 roster's 45 worlds** were drawn smaller than a plane holding
nothing. "Emptiness
becomes a colour, not a size" is the claim, and a moon that outsizes a world falsifies it."""

BAND_ORDER: Final[tuple[HueClass, ...]] = (
    HueClass.COLOURLESS,
    HueClass.GREEN,
    HueClass.RED,
    HueClass.BLACK,
    HueClass.BLUE,
    HueClass.WHITE,
    HueClass.MULTICOLOUR,
    HueClass.WHITE,
    HueClass.BLUE,
    HueClass.BLACK,
    HueClass.RED,
    HueClass.GREEN,
    HueClass.COLOURLESS,
)
"""§1.3's seven classes, **mirrored about the equator**, north to south:
``C G R B U W . Gold . W U B R G C``.

Gold takes its whole share in the single equatorial belt; every other class takes half its share in
each of a matched pair of bands. This differs from review §4.2's sketch deliberately — "five bands,
gold as an equatorial belt, colourless as ice caps" is five plus a belt plus two caps, which
does not
fit one hemisphere. Mirroring makes all three named readings literally true and makes a world
symmetric, which is what stops the mosaic reading as a bar chart wrapped round a ball."""

_MIRRORED: Final[frozenset[HueClass]] = frozenset(
    h for h in BAND_ORDER if h is not HueClass.MULTICOLOUR
)


def visual_radius(card_count: int) -> float:
    """§1.3's constant-area-per-card radius, under §1.8's moon floor. Never below the floor."""
    return max(RADIUS_PER_ROOT_CARD * math.sqrt(max(card_count, 0)), MOON_RADIUS)


def row_count(card_count: int) -> int:
    """§1.3's row count, from the standard equal-area sphere tiling. Final — never relaxed."""
    if card_count <= 0:
        return 0
    seed = math.sqrt(4 * math.pi / (ASPECT * card_count))
    return max(1, round(math.pi / seed))


def d_phi(rows: int) -> float:
    """Constant angular row height. Row ``i`` spans ``[i*dphi, (i+1)*dphi]`` in colatitude."""
    return math.pi / rows


def row_centre(index: int, dphi: float) -> float:
    """Colatitude of row ``index``'s centre: ``(i + 1/2) * dphi`` (§1.3, §2.1)."""
    return (index + 0.5) * dphi


def seed_row_cells(card_count: int) -> list[int]:
    """The closed form's cell counts — §1.3's *starting point*, kept for the report and the tests.

    ``round(2*pi*sin(theta) / (aspect*dphi))``. Not the shipped grid: :func:`build_grid` replaces
    these with population-derived counts. Rabiah is the standing example — 78 slots here against the
    75 cells the relaxation demands.
    """
    rows = row_count(card_count)
    if rows == 0:
        return []
    dphi = d_phi(rows)
    return [
        round(2 * math.pi * math.sin(row_centre(i, dphi)) / (ASPECT * dphi)) for i in range(rows)
    ]


def band_shares(hue_counts: Sequence[int]) -> list[float]:
    """Each of :data:`BAND_ORDER`'s thirteen bands as a fraction of the plane's cards.

    A mono class's count is halved across its matched pair; gold's is not. The thirteen shares sum
    to 1 exactly, which is what makes the boundaries below cover the whole sphere.
    """
    total = sum(hue_counts)
    if total <= 0:
        return [0.0] * len(BAND_ORDER)
    return [hue_counts[int(hue)] / total / (2.0 if hue in _MIRRORED else 1.0) for hue in BAND_ORDER]


def band_boundaries(hue_counts: Sequence[int]) -> list[float]:
    """Band edges in ``cos(theta)``, north (+1) to south (-1). ``len(BAND_ORDER) + 1`` values.

    Equal-**area**: a spherical zone between two colatitudes has area ``2*pi*(cos a - cos b)``, so a
    band's share of the ``cos(theta)`` range [1, -1] — which spans 2 — is exactly its share of the
    plane's cards. The area a colour covers *is* the fraction of the plane that colour is.

    The last edge is written as ``-1.0`` rather than accumulated, so the south pole is exact however
    the shares rounded on the way down.
    """
    edges = [1.0]
    for share in band_shares(hue_counts):
        edges.append(edges[-1] - 2.0 * share)
    edges[-1] = -1.0
    return edges


def _apportion(total: int, weights: Sequence[float]) -> list[int]:
    """Largest-remainder apportionment of ``total`` over ``weights``. Sums to ``total`` exactly.

    Hamilton's method, and the tie-break is the lowest index — deterministic, which a
    content-hashed artefact needs (PRD 4.9.1). Every alternative that rounds independently can miss
    the total by a few, and "a few" here is a few cards with nowhere to go.
    """
    if total <= 0:
        return [0] * len(weights)
    live = [i for i, w in enumerate(weights) if w > 0]
    if not live:
        out = [0] * len(weights)
        out[0] = total
        return out
    mass = sum(weights[i] for i in live)
    exact = [total * weights[i] / mass for i in live]
    out = [0] * len(weights)
    for slot, i in enumerate(live):
        out[i] = int(exact[slot])
    short = total - sum(out)
    if short > 0:
        # Zero-weight entries are excluded from `live` entirely rather than merely sorting last: a
        # row a band does not reach must not receive one of that band's cells under any rounding,
        # because a cell outside its own band is exactly the displaced card §1.3 forbids.
        order = sorted(range(len(live)), key=lambda s: (-(exact[s] - out[live[s]]), s))
        for slot in order[:short]:
            out[live[slot]] += 1
    return out


GOLD_BAND: Final = BAND_ORDER.index(HueClass.MULTICOLOUR)


@dataclass(frozen=True, slots=True)
class Placement:
    """Where one card's cell sits on the sphere."""

    row: int
    column: int
    band: int
    """Index into :data:`BAND_ORDER`, so the two halves of a mirrored pair are distinguishable."""
    set_band: int


@dataclass(frozen=True, slots=True)
class Grid:
    """One plane's shipped surface grid, and the placement of every card on it."""

    rows: int
    d_phi: float
    row_cells: list[int]
    """Cells per row, north to south. This is the ``rowCells`` table §2.4 ships."""

    placements: list[Placement]
    """Parallel to the ``groups`` the grid was built from, flattened in the caller's card order."""


def build_grid(groups: Sequence[tuple[HueClass, int, int]]) -> Grid:
    """The relaxed grid: §1.3's target of 100% exact, zero displaced, zero bare.

    ``groups`` is one entry per card, ``(hue class, set band, sequence within the group)`` — the
    caller's own card order, which the returned placements are parallel to. The grid is built from
    the population outwards rather than from the closed form inwards, and that is the whole of the
    relaxation:

    1. Band boundaries come from the colour fractions and are **fixed** (equal-area, never snapped).
    2. Row latitudes come from :func:`row_count` and are **fixed** (equal-angle).
    3. For each ``(band, set)`` group, its cards are apportioned across the rows its band overlaps,
       in proportion to the **overlap area** of row-and-band. Largest remainder, so every group gets
       exactly its card count: no card is displaced and no cell is left bare.
    4. ``rowCells[i]`` is then whatever fell in row ``i``, and the counts sum to the card count by
       construction rather than by a rounding that happened to work out.

    Step 3 is why the counts cannot be a function of ``cardCount`` and a row count, and
    therefore why
    §2.4 ships them.

    A consequence worth stating, because it is what keeps the cells 4:3 (§1.3): a band's card count
    over its area is the same constant ``N/2`` for *every* band, precisely because the boundaries
    were chosen to make it so. Summing step 3 over the bands, row ``i`` receives ``N`` times its own
    area fraction — the closed form's answer, reached from the population rather than assumed.
    """
    total = len(groups)
    rows = row_count(total)
    if rows == 0:
        return Grid(rows=0, d_phi=0.0, row_cells=[], placements=[])

    dphi = d_phi(rows)
    hue_counts = [0] * len(HueClass)
    for hue, _set_band, _seq in groups:
        hue_counts[int(hue)] += 1
    edges = band_boundaries(hue_counts)
    row_tops = [math.cos(i * dphi) for i in range(rows)]
    row_bottoms = [math.cos((i + 1) * dphi) for i in range(rows)]

    # How many cards each (hue, set) pair holds, and how that splits across a mirrored pair's two
    # bands. The odd card of an odd count goes north, deterministically — not to whichever band a
    # rounding mode happened to favour.
    pair_counts: dict[tuple[HueClass, int], int] = {}
    for hue, set_band, _seq in groups:
        pair_counts[(hue, set_band)] = pair_counts.get((hue, set_band), 0) + 1

    # `(set band, band index)` — set first, so a row's cells come out ordered by time and only then
    # by colour. That is what keeps "longitude is time" literally true in every row, including one
    # that straddles a band boundary: within a set's arc such a row shows its two bands as two
    # contiguous runs, the mildest reading of §1.3's "splits its cells between the two bands in
    # proportion to the area each band takes of that row".
    per_row: list[list[tuple[int, int]]] = [[] for _ in range(rows)]
    for band_index, hue in enumerate(BAND_ORDER):
        overlap = [
            max(
                0.0,
                min(row_tops[i], edges[band_index]) - max(row_bottoms[i], edges[band_index + 1]),
            )
            for i in range(rows)
        ]
        if sum(overlap) <= 0:
            continue
        northern = band_index < GOLD_BAND
        set_bands = sorted(s for (h, s) in pair_counts if h is hue)
        remaining = [
            _band_share(hue, s, pair_counts[(hue, s)], northern=northern) for s in set_bands
        ]
        if sum(remaining) <= 0:
            continue

        # Two apportionments, not one. The band's whole population is spread over its rows first,
        # and only then is a row's quota split between the sets in it.
        #
        # Doing it the other way — one apportionment per (band, set) group — is what the first
        # draft did, and it is wrong in a way that only shows up on the artefact. A group of a
        # dozen cards spread over a dozen rows floors to zero almost everywhere, and largest
        # remainder then hands its cells to the rows with the widest overlap. Every group makes the
        # same choice, so the thin rows at a band's edges — and above all the polar rows, whose
        # overlap is a fraction of a percent of the band — are starved by every group at once.
        # Dominaria came out with **four empty polar rows** against a closed form that wants
        # 2, 7, 12, 16 cells there, and a cell aspect 20x off 4:3 instead of within 18%.
        #
        # Apportioning the band first removes the bias by construction: because the boundaries were
        # chosen to make a band's cards-per-area the same constant N/2 for every band, summing this
        # step over the bands gives row `i` exactly N times its own area fraction.
        for i, quota in enumerate(_apportion(sum(remaining), overlap)):
            if quota <= 0:
                continue
            # Weights are the *remaining* counts, so this cannot over-draw a set (a set whose
            # floor already equals its remainder has no remainder left to win a seat with) and the
            # final row's quota is exactly what is left. Each set therefore lands in every row of
            # its band in proportion, which is what keeps a row's longitude slices close to the
            # plane-wide ones instead of stacking a set into a latitude stripe.
            for slot, taken in enumerate(_apportion(quota, remaining)):
                if taken:
                    per_row[i].extend([(set_bands[slot], band_index)] * taken)
                    remaining[slot] -= taken

    for row in per_row:
        row.sort()

    # Hand the cells back out to the cards. A group's cells are visited north to south and, within
    # a row, west to east, so a group's `seq` decides which of its own cells a card takes and the
    # ordering is total: the same inputs place the same card on the same cell, run after run.
    queues: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for row_index, row in enumerate(per_row):
        for column, key in enumerate(row):
            queues.setdefault(key, []).append((row_index, column))

    placements: list[Placement] = []
    for hue, set_band, seq in groups:
        band_index = _band_for(hue, set_band, seq)
        # Gold is one band and takes `seq` outright; a mirrored class alternates, so its `seq`
        # halves into a position within whichever of the two bands this card went to.
        slot = seq if hue is HueClass.MULTICOLOUR else seq // 2
        queue = queues.get((set_band, band_index), [])
        if slot >= len(queue):
            raise AssertionError(
                f"band {band_index} / set {set_band} was apportioned {len(queue)} cells but card "
                f"{seq} of that group wants slot {slot}: the grid and the population disagree, "
                "which is the displaced-card failure §1.3 forbids"
            )
        row_index, column = queue[slot]
        placements.append(
            Placement(row=row_index, column=column, band=band_index, set_band=set_band)
        )

    return Grid(
        rows=rows,
        d_phi=dphi,
        row_cells=[len(row) for row in per_row],
        placements=placements,
    )


def _north_first(hue: HueClass, set_band: int) -> bool:
    """Which hemisphere a mirrored ``(class, set)`` group's *first* card goes to.

    Alternating by set index, not always north. The split is by parity of ``seq``, so a group with
    an odd card count has one card more in whichever hemisphere it started in — and if that were
    always north, then across the ~40 odd-count groups a class has on a large plane the north band
    would carry ~20 more cards than the south into the *same* area. On Dominaria that is a ~9%
    imbalance between the two halves of a mirrored pair: a visible asymmetry on a layout whose whole
    argument for mirroring is that a world should be symmetric. Parity of the set index averages it
    out without costing determinism.
    """
    del hue
    return set_band % 2 == 0


def _band_share(hue: HueClass, set_band: int, count: int, *, northern: bool) -> int:
    """How many of a ``(class, set)`` group's cards belong to the northern or southern band."""
    if hue is HueClass.MULTICOLOUR:
        # Gold appears once in BAND_ORDER, at the equator, so the loop reaches it exactly once and
        # it takes its whole count there. `northern` is False at that index and says nothing.
        return count
    starts_north = _north_first(hue, set_band)
    if northern:
        return (count + 1) // 2 if starts_north else count // 2
    return count // 2 if starts_north else (count + 1) // 2


def _band_for(hue: HueClass, set_band: int, seq: int) -> int:
    """Which of a mirrored pair's two bands this card takes. Gold has only one.

    Alternating by ``seq`` from the hemisphere :func:`_north_first` chose, so the counts this
    produces are exactly the shares :func:`_band_share` apportioned. Alternating rather than
    "first half north, second half south" also keeps a set's cards spread across both hemispheres
    instead of stacking one set into one of them.
    """
    if hue is HueClass.MULTICOLOUR:
        return GOLD_BAND
    north_index = BAND_ORDER.index(hue)
    south_index = len(BAND_ORDER) - 1 - north_index
    goes_north = (seq % 2 == 0) == _north_first(hue, set_band)
    return north_index if goes_north else south_index


def cell_direction(
    row: int, column: int, row_cells: int, dphi: float
) -> tuple[float, float, float]:
    """The unit-sphere cell centre §2.1's bytes 0-5 carry.

    Longitude is ``(column + 1/2 + stagger) * 2*pi / row_cells``, with **alternate rows staggered by
    half a cell** (§1.3) so the tiling reads as masonry and not as a graticule. ``y`` is
    ``cos(theta)``: the north pole is ``+y``, which is the orientation §1.4's ``east = cross(Y, n)``
    tangent frame assumes.
    """
    theta = row_centre(row, dphi)
    stagger = 0.5 if row % 2 else 0.0
    lam = (column + 0.5 + stagger) * (2.0 * math.pi / row_cells)
    sin_theta = math.sin(theta)
    return (sin_theta * math.cos(lam), math.cos(theta), sin_theta * math.sin(lam))


def nearest_row(y: float, rows: int, dphi: float) -> int:
    """Which row a ``y`` of ``cos(theta)`` belongs to — **nearest centre, never ``floor()``**.

    §2.1 is normative about this and the margin is thinner than it looks. float16 spacing on
    ``[0.5, 1)`` is ``2**-11`` = 4.883e-4, so the round-trip error is at most 2.44e-4. For Dominaria
    the gap between the two polar rows is 1.504e-3 in ``cos(theta)``: a margin of **3.08x** for
    nearest-centre matching, and half that — 1.54x — for a ``floor()`` against the boundary below.
    At the equator both are slack (79x), so the pole is the whole safety factor and the factor of
    two is not spare.
    """
    if rows <= 0:
        raise ValueError("a plane with no rows has no cell to match")
    theta = math.acos(max(-1.0, min(1.0, y)))
    return max(0, min(rows - 1, round(theta / dphi - 0.5)))


def cell_half_extents(row: int, row_cells: int, dphi: float) -> tuple[float, float]:
    """§1.4's ``iSize``, in units of world radius: **arc length, not angle**.

    A row is a small circle of radius ``sin(theta_r)``, not a great circle, so a longitude angle
    ``dlam`` subtends ``dlam * sin(theta_r)`` of surface while a colatitude angle subtends itself.
    Dropping that factor draws Dominaria's polar row **51.6x** too wide — a half-extent of pi/2 =
    1.571 *world radii*, a quad wider than the globe it sits on, against a correct 0.0305 (DEC-749
    D2). The same factor is what makes §1.3's 4:3 aspect true at every latitude.

    Not in the contract — the client derives it from ``rowCells`` — but the pipeline owns the
    definition, and the aspect invariant below is checked against it.
    """
    theta = row_centre(row, dphi)
    return ((math.pi / row_cells) * math.sin(theta), dphi / 2)
