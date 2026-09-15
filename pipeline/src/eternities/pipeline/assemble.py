"""Stage 6 — layout, and the assembly of the contract :class:`Dataset` (PRD 8.2.6, 8.3, 8.6).

Pure: takes the tables the earlier stages produced and returns the dataset the encoder writes.
The seeded layout rules themselves live in ``eternities.fixtures.layout`` and are shared verbatim
with the fixture generator, so the real dataset and ``fixture-scale`` are laid out by the same
code (implementation plan §2, Phase 0).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Final

from ..contract.enums import (
    BLIND_ETERNITIES_SLUG,
    MULTIVERSE_RADIUS,
    UNRELEASED_DATE,
    HueClass,
    colour_identity_mask,
    hue_class_for,
    size_class_for,
    type_mask_for,
)
from ..contract.models import (
    Card,
    CardFace,
    Dataset,
    Plane,
    PlaneSetRef,
    Printing,
    SetRecord,
    StarRecord,
    Swatch,
)
from ..fixtures import layout, surface
from .appendices import Appendices
from .records import CardDetail, MeldResult, RawPrinting, ScrySet
from .swatches import MissingSwatchError, SwatchCache

BRIGHTNESS_PERCENTILE: Final = 0.98
"""PRD 5.4.10: the printing-count cap is the plane's 98th percentile."""


@dataclass(frozen=True, slots=True)
class CardInput:
    """One included card, with everything the layout and emit stages need."""

    oracle_id: str
    plane_slug: str
    first_printing: RawPrinting
    printings: list[RawPrinting]
    """Included printings, release-ordered — the planet order of PRD 5.6.7."""
    detail: CardDetail


@dataclass(frozen=True, slots=True)
class PlaneAssignmentStats:
    """One plane's row of §2.6 item 5's assignment report, which must read ``N / 0 / 0``.

    The prototype ran three passes — exact (colour *and* set), colour only, anywhere — and left
    Dominaria at 5,372 exact / 694 colour-only / 200 displaced / 0 bare and Rabiah at 49 / 0 / 26 /
    3 bare of 75. Production relaxes the grid to the population instead, so the only honest row is
    every card exact. A displaced card is a card in the wrong place on a map whose entire claim is
    that position means something, which is why this is a report line *and* an invariant.
    """

    slug: str
    cards: int
    exact: int
    displaced: int
    bare: int
    rows: int
    seed_cells: int
    """What §1.3's closed form would have given. Rabiah is the standing example of the two
    disagreeing: 78 slots from the formula against the 75 cells the relaxation demands."""

    aspect_deviation: float
    """Worst ``|aspect / (4:3) - 1|`` over the plane's rows. Integer ``rowCells`` is what bounds
    this, not the surface law: at ``rowCells = 2`` a cell's aspect is pi/2 (§2.1)."""


@dataclass(frozen=True, slots=True)
class AssemblyStats:
    blind_eternities_top_sets: list[tuple[str, str, int]]
    """PRD 9.2.2: ``(code, name, cards)`` of the sets contributing most to the dust."""
    assignment: list[PlaneAssignmentStats] = field(default_factory=list)
    brightness_caps: list[tuple[str, int, int, int]] = field(default_factory=list)
    """``(slug, cap, highest printing count, cards at or above the cap)`` (finding D6).

    PRD 5.4.10's 98th-percentile cap is applied here, in the pipeline, and only the capped
    ``brightness`` byte reaches ``stars.bin`` — so re-tuning the curve is a data refresh, not a
    browser setting. Publishing the numbers does not change that; it makes the cap reviewable from
    the report rather than only inferable from the encoded bytes."""


def build_dataset(
    cards: list[CardInput],
    sets: dict[str, ScrySet],
    appendices: Appendices,
    meld_results: dict[str, MeldResult],
    *,
    swatches: SwatchCache | None = None,
    dataset_name: str,
    as_of: str,
    generated_at: str,
    scryfall_bulk_updated_at: str | None,
) -> tuple[Dataset, AssemblyStats]:
    """Lay out every plane and card and return the dataset the encoder writes.

    ``swatches`` is optional so a caller with no warmed cache can still assemble a dataset;
    production always passes one, and a dataset built without it carries no ``swatches.bin``.

    Note that the *fixtures* do not come through here at all — :mod:`eternities.fixtures.generate`
    builds their :class:`Dataset` directly, and since DEC-796 it invents a swatch per card from
    that card's own id (§2.2's schema, no art required). This path is the Scryfall one, where a
    swatch is a real pixel statistic and a missing one is :class:`MissingSwatchError` rather than
    something to fabricate: inventing art data for production would put colours on the mosaic that
    no card actually has.
    """
    roster = {p.slug: p for p in appendices.planes}
    missing_swatches: list[str] = []
    unknown = sorted({c.plane_slug for c in cards} - set(roster))
    if unknown:
        raise ValueError(f"cards assigned to planes absent from Appendix A: {unknown}")

    set_records, set_id_of = _global_set_dictionary(cards, sets, appendices)
    by_plane: dict[str, list[CardInput]] = {slug: [] for slug in roster}
    for card in cards:
        by_plane[card.plane_slug].append(card)

    plane_bands = {
        slug: _chronology_bands(rows, sets, set_id_of) for slug, rows in by_plane.items()
    }

    # --- plane geometry (PRD 8.6.1) --------------------------------------------------------
    ordered_slugs = [
        BLIND_ETERNITIES_SLUG,
        *sorted(s for s in roster if s != BLIND_ETERNITIES_SLUG),
    ]
    named = [s for s in ordered_slugs if s != BLIND_ETERNITIES_SLUG]
    radii = {s: surface.visual_radius(len(by_plane[s])) for s in named}
    mean_spacing = 2.0 * MULTIVERSE_RADIUS / max(math.sqrt(len(named)), 1.0)
    # PRD 5.3.3: the gap must survive drift. Every plane drifts by layout.DRIFT_FACTOR x mean
    # spacing and a pair can drift toward each other, so the margin clears several times that.
    margin = layout.PLANE_MARGIN_FACTOR * mean_spacing
    positions = layout.place_planes(
        [(s, radii[s], len(by_plane[s]) == 0) for s in named], MULTIVERSE_RADIUS, margin
    )
    motions = {s: layout.plane_motion(s, mean_spacing) for s in ordered_slugs}

    planes: list[Plane] = []
    stars: list[StarRecord] = []
    out_cards: list[Card] = []
    swatch_column: list[Swatch] = []
    brightness_caps: list[tuple[str, int, int, int]] = []
    assignment: list[PlaneAssignmentStats] = []

    for index, slug in enumerate(ordered_slugs):
        bands = plane_bands[slug]
        band_of = _band_index(slug, bands, by_plane[slug])
        rows = sorted(
            by_plane[slug],
            key=lambda c: (
                band_of[c.first_printing.set_code],
                int(hue_class_for(c.detail.colour_identity)),
                c.oracle_id,
            ),
        )
        star_offset = len(stars)
        motion = motions[slug]
        printing_counts = [len(r.printings) for r in rows]
        cap = _brightness_cap(printing_counts)
        if printing_counts:
            brightness_caps.append(
                (slug, cap, max(printing_counts), sum(1 for n in printing_counts if n >= cap))
            )

        is_dust = slug == BLIND_ETERNITIES_SLUG
        positions_for_rows, row_cells, stats_row = (
            _belt_positions(rows, band_of, len(bands))
            if is_dust
            else _surface_positions(slug, rows, band_of)
        )

        for row, position in zip(rows, positions_for_rows, strict=True):
            hue = hue_class_for(row.detail.colour_identity)
            card = _contract_card(row, set_id_of, sets, meld_results)
            stars.append(
                StarRecord(
                    x=position[0],
                    y=position[1],
                    z=position[2],
                    plane_index=index,
                    hue=hue,
                    colour_identity=colour_identity_mask(row.detail.colour_identity),
                    size=card.rarity,
                    brightness=layout.brightness_for(len(row.printings), cap),
                    # v3 byte 10 is reserved, written 0: there is no twinkle on a mosaic (§2.1).
                    twinkle_phase=0,
                    type_mask=type_mask_for(card.type_line),
                )
            )
            out_cards.append(card)
            if swatches is not None:
                first = printing_order(row, sets)[0]
                found = swatches.get(first.id, first.image_ts)
                if found is None:
                    missing_swatches.append(first.id)
                else:
                    swatch_column.append(found)

        # Empty planes are moons, not worlds (§1.8): no grid, no cells, nothing to be exact about.
        # Counting them here would have the report open with "over 87 worlds" on a roster that has
        # 45 — a number a reader would take for the world count and W5's label budget.
        if stats_row is not None and stats_row.cards > 0:
            assignment.append(stats_row)

        palette = layout.palette_from_hue_counts(_hue_histogram(rows))
        planes.append(
            Plane(
                index=index,
                slug=slug,
                display_name=roster[slug].display_name,
                notes=roster[slug].notes,
                kind=layout.plane_kind(slug, len(rows)),
                card_count=len(rows),
                star_offset=star_offset,
                star_count=len(stars) - star_offset,
                home=(0.0, 0.0, 0.0) if is_dust else positions[slug],
                radius=MULTIVERSE_RADIUS if is_dust else radii[slug],
                tilt=motion.tilt,
                spin_period_s=motion.spin_period_s,
                spin_direction=motion.spin_direction,
                drift_amplitude=motion.drift_amplitude,
                drift_period_s=motion.drift_period_s,
                drift_phase=motion.drift_phase,
                palette=palette,
                nebula_tint=layout.nebula_tint(palette),
                sets=bands,
                row_cells=row_cells,
            )
        )

    if missing_swatches:
        raise MissingSwatchError(missing_swatches)

    dataset = Dataset(
        dataset=dataset_name,
        as_of=as_of,
        generated_at=generated_at,
        scryfall_bulk_updated_at=scryfall_bulk_updated_at,
        planes=planes,
        sets=set_records,
        stars=stars,
        cards=out_cards,
        swatches=swatch_column,
        multiverse_radius=MULTIVERSE_RADIUS,
    )
    return dataset, _stats(by_plane, sets, brightness_caps, assignment)


def _surface_positions(
    slug: str, rows: list[CardInput], band_of: dict[str, int]
) -> tuple[list[tuple[float, float, float]], list[int], PlaneAssignmentStats]:
    """Lay one world out on its sphere (§1.3) and report what the assignment cost.

    The report row is computed here rather than inferred later because "exact / displaced / bare"
    is only meaningful against the grid that was actually built: :func:`surface.build_grid` places
    every card in its own band and its own set's slice by construction, so the honest row is
    ``N / 0 / 0`` — and this function is where a future change that stopped making that true would
    have to lie about it.
    """
    if not rows:
        return [], [], PlaneAssignmentStats(slug, 0, 0, 0, 0, 0, 0, 0.0)

    sequence: dict[tuple[int, int], int] = {}
    groups: list[tuple[HueClass, int, int]] = []
    for row in rows:
        hue = hue_class_for(row.detail.colour_identity)
        set_band = band_of[row.first_printing.set_code]
        key = (int(hue), set_band)
        sequence[key] = sequence.get(key, -1) + 1
        groups.append((hue, set_band, sequence[key]))

    grid = surface.build_grid(groups)
    out = [
        surface.cell_direction(p.row, p.column, grid.row_cells[p.row], grid.d_phi)
        for p in grid.placements
    ]

    displaced = sum(
        1
        for (hue, set_band, _), p in zip(groups, grid.placements, strict=True)
        if surface.BAND_ORDER[p.band] is not hue or p.set_band != set_band
    )
    bare = sum(grid.row_cells) - len({(p.row, p.column) for p in grid.placements})
    deviation = max(
        (
            abs(
                2
                * math.pi
                * math.sin(surface.row_centre(i, grid.d_phi))
                / (count * grid.d_phi)
                / surface.ASPECT
                - 1
            )
            for i, count in enumerate(grid.row_cells)
            if count
        ),
        default=0.0,
    )
    return (
        out,
        grid.row_cells,
        PlaneAssignmentStats(
            slug=slug,
            cards=len(rows),
            exact=len(rows) - displaced,
            displaced=displaced,
            bare=bare,
            rows=grid.rows,
            seed_cells=sum(surface.seed_row_cells(len(rows))),
            aspect_deviation=deviation,
        ),
    )


def _belt_positions(
    rows: list[CardInput], band_of: dict[str, int], band_count: int
) -> tuple[list[tuple[float, float, float]], list[int], None]:
    """§1.8's belt: one arc per set, chronological, each set its share of 360 degrees.

    ``rowCells`` is empty and omitted — the belt has no surface grid — and there is no assignment
    row, because "exact / displaced / bare" is a statement about cells and the belt has none.
    """
    per_set: dict[int, int] = {}
    for row in rows:
        set_band = band_of[row.first_printing.set_code]
        per_set[set_band] = per_set.get(set_band, 0) + 1
    seen: dict[int, int] = {}
    out: list[tuple[float, float, float]] = []
    for row in rows:
        set_band = band_of[row.first_printing.set_code]
        seen[set_band] = seen.get(set_band, 0) + 1
        out.append(
            layout.belt_position(
                row.oracle_id, set_band, band_count, seen[set_band] - 1, per_set[set_band]
            )
        )
    return out, [], None


def _band_index(slug: str, bands: list[PlaneSetRef], rows: list[CardInput]) -> dict[str, int]:
    """Set code -> chronology band, total over ``rows``' first-printing sets (PRD 5.4.2).

    One mapping, one lookup, no default. It was read twice with two *different* defaults — past
    the end when sorting, the last band when positioning — which cannot both be right: a card the
    mapping missed would sort after every band and then be placed inside the final one, so the
    star's radius and its position in ``planes.json[].sets`` would disagree while the artefacts
    still validated. Unreachable today, because :func:`_chronology_bands` is derived from exactly
    these rows; the point is that if it ever stops being true the run says which plane and which
    set, rather than emitting a plausible dataset (review findings D4, D7).
    """
    band_of = {ref.code: band for band, ref in enumerate(bands)}
    missing = sorted({r.first_printing.set_code for r in rows} - set(band_of))
    if missing:
        raise ValueError(
            f"plane {slug!r}: first-printing sets {missing} have no chronology band, though the "
            "bands are built from exactly these rows (PRD 5.4.2)"
        )
    return band_of


def _hue_histogram(rows: list[CardInput]) -> list[float]:
    buckets = [0.0] * 7
    for row in rows:
        buckets[int(hue_class_for(row.detail.colour_identity))] += 1.0
    return buckets


def _brightness_cap(printing_counts: list[int]) -> int:
    """PRD 5.4.10's 98th percentile, over this plane's cards."""
    if not printing_counts:
        return 1
    ordered = sorted(printing_counts)
    index = min(len(ordered) - 1, int(len(ordered) * BRIGHTNESS_PERCENTILE))
    return ordered[index]


def _global_set_dictionary(
    cards: list[CardInput], sets: dict[str, ScrySet], appendices: Appendices
) -> tuple[list[SetRecord], dict[str, int]]:
    """Every set with at least one included printing, chronologically, ids ``0..n-1``.

    Reprint-only products are in here — PRD 6.5.4 searches them and 6.6.3 filters by them — and
    carry ``planeSlug: null`` because they have no Appendix B row (data contract §7).
    """
    appearing: set[str] = set()
    first_printed: dict[str, int] = {}
    for card in cards:
        for printing in card.printings:
            appearing.add(printing.set_code)
        code = card.first_printing.set_code
        first_printed[code] = first_printed.get(code, 0) + 1

    by_code = appendices.by_code()
    ordered = sorted(
        appearing,
        key=lambda code: (sets[code].released_at if code in sets else UNRELEASED_DATE, code),
    )
    records: list[SetRecord] = []
    set_id_of: dict[str, int] = {}
    for set_id, code in enumerate(ordered):
        scry_set = sets.get(code)
        row = by_code.get(code)
        set_id_of[code] = set_id
        records.append(
            SetRecord(
                id=set_id,
                code=code,
                name=scry_set.name if scry_set else code,
                year=scry_set.year if scry_set else 0,
                plane_slug=row.plane if row is not None else None,
                card_count=first_printed.get(code, 0),
            )
        )
    if len(records) > 0xFFFF:
        raise ValueError(f"{len(records)} sets exceeds the uint16 set id space of sets.bin")
    return records, set_id_of


def _chronology_bands(
    rows: list[CardInput], sets: dict[str, ScrySet], set_id_of: dict[str, int]
) -> list[PlaneSetRef]:
    """PRD 5.4.2: the plane's first-printing sets in chronological order, one band each."""
    counts: dict[str, int] = {}
    for row in rows:
        code = row.first_printing.set_code
        counts[code] = counts.get(code, 0) + 1
    ordered = sorted(
        counts, key=lambda code: (sets[code].released_at if code in sets else UNRELEASED_DATE, code)
    )
    return [
        PlaneSetRef(
            id=set_id_of[code],
            code=code,
            name=sets[code].name if code in sets else code,
            year=sets[code].year if code in sets else 0,
            card_count=counts[code],
        )
        for code in ordered
    ]


def printing_order(row: CardInput, sets: dict[str, ScrySet]) -> list[RawPrinting]:
    """A card's printings in the order they appear as ``p`` in a shard — PRD 5.6.7's planet order.

    By the *printing's set release date*, which is not the same thing as the card's debut: a promo
    or a list reprint whose set shipped earlier sorts ahead of the set the card first appeared in.
    ``p[0]`` is therefore the earliest-released printing, and §2.3 makes it the one whose art a cell
    shows and whose artist the cell credits.

    Lifted out of :func:`_contract_card` because the swatch stage needs exactly this element and
    must not re-derive it: a swatch taken from a different printing than the cell draws is a
    mismatch nothing in the artefacts could detect.
    """
    return sorted(
        row.printings,
        key=lambda p: (
            sets[p.set_code].released_at if p.set_code in sets else UNRELEASED_DATE,
            p.set_code,
            p.collector_number,
            p.id,
        ),
    )


def _contract_card(
    row: CardInput,
    set_id_of: dict[str, int],
    sets: dict[str, ScrySet],
    meld_results: dict[str, MeldResult],
) -> Card:
    detail = row.detail
    printings = printing_order(row, sets)
    return Card(
        oracle_id=row.oracle_id,
        name=detail.front.name,
        mana_cost=detail.front.mana_cost,
        type_line=detail.front.type_line,
        oracle_text=detail.front.oracle_text,
        back=_back_face(detail, meld_results),
        colour_identity=detail.colour_identity,
        rarity=size_class_for(row.first_printing.rarity),
        layout=detail.layout,
        printings=[
            Printing(
                id=p.id,
                set_id=set_id_of[p.set_code],
                rarity=size_class_for(p.rarity),
                image_ts=p.image_ts,
                collector_number=p.collector_number,
                artist=p.artist,
            )
            for p in printings
        ],
        set_ids=sorted({set_id_of[p.set_code] for p in printings}),
    )


def _back_face(detail: CardDetail, meld_results: dict[str, MeldResult]) -> CardFace | None:
    """``b`` answers "is there a second face" (data contract §9).

    A meld component has no ``card_faces`` at all: its other half is a separate Scryfall object,
    so it is looked up by the ``all_parts`` link and carries its own printing id and timestamp.
    """
    if detail.layout == "meld" and detail.meld_result_id is not None:
        meld = meld_results.get(detail.meld_result_id)
        if meld is not None:
            return CardFace(
                name=meld.face.name,
                mana_cost=meld.face.mana_cost,
                type_line=meld.face.type_line,
                oracle_text=meld.face.oracle_text,
                printing_id=meld.printing_id,
                image_ts=meld.image_ts,
            )
    if detail.back is None:
        return None
    return CardFace(
        name=detail.back.name,
        mana_cost=detail.back.mana_cost,
        type_line=detail.back.type_line,
        oracle_text=detail.back.oracle_text,
    )


def _stats(
    by_plane: dict[str, list[CardInput]],
    sets: dict[str, ScrySet],
    brightness_caps: list[tuple[str, int, int, int]],
    assignment: list[PlaneAssignmentStats],
) -> AssemblyStats:
    """The report's numbers.

    ``radius_saturation`` and ``largest_plane`` are gone. The first watched PRD 5.3.2's ``log N``
    clamp for the refresh that would reach it; §1.3's ``0.126 * sqrt(N)`` has no clamp — area per
    card is the invariant, so there is nothing to saturate — and a report row about a law that no
    longer exists is worse than no row. The second was never read by anything (review §6.1 group D).
    """
    dust = by_plane.get(BLIND_ETERNITIES_SLUG, [])
    contributions: dict[str, int] = {}
    for card in dust:
        code = card.first_printing.set_code
        contributions[code] = contributions.get(code, 0) + 1
    top = sorted(contributions.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    return AssemblyStats(
        blind_eternities_top_sets=[
            (code, sets[code].name if code in sets else code, count) for code, count in top
        ],
        assignment=sorted(assignment, key=lambda row: (-row.cards, row.slug)),
        brightness_caps=brightness_caps,
    )
