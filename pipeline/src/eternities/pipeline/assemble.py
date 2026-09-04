"""Stage 6 — layout, and the assembly of the contract :class:`Dataset` (PRD 8.2.6, 8.3, 8.6).

Pure: takes the tables the earlier stages produced and returns the dataset the encoder writes.
The seeded layout rules themselves live in ``eternities.fixtures.layout`` and are shared verbatim
with the fixture generator, so the real dataset and ``fixture-scale`` are laid out by the same
code (implementation plan §2, Phase 0).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

from ..contract.enums import (
    BLIND_ETERNITIES_SLUG,
    HueClass,
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
)
from ..fixtures import layout, rng
from .appendices import Appendices
from .records import CardDetail, MeldResult, RawPrinting, ScrySet

MULTIVERSE_RADIUS: Final = 130.0
"""R of PRD 8.6.1, sized so the whole Appendix A roster packs with the 5.3.3 anti-overlap margin.
Identical to ``fixture-scale``, so bench numbers taken against the fixture carry over."""

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
class AssemblyStats:
    cards_per_plane: dict[str, int]
    sets_per_plane: dict[str, int]
    blind_eternities_top_sets: list[tuple[str, str, int]]
    """PRD 9.2.2: ``(code, name, cards)`` of the sets contributing most to the dust."""
    largest_plane: tuple[str, int]


def build_dataset(
    cards: list[CardInput],
    sets: dict[str, ScrySet],
    appendices: Appendices,
    meld_results: dict[str, MeldResult],
    *,
    dataset_name: str,
    as_of: str,
    generated_at: str,
    scryfall_bulk_updated_at: str | None,
) -> tuple[Dataset, AssemblyStats]:
    """Lay out every plane and card and return the dataset the encoder writes."""
    roster = {p.slug: p for p in appendices.planes}
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
    radii = {s: layout.visual_radius(len(by_plane[s])) for s in named}
    mean_spacing = 2.0 * MULTIVERSE_RADIUS / max(math.sqrt(len(named)), 1.0)
    # PRD 5.3.3: the gap must survive drift. Every plane drifts by layout.DRIFT_FACTOR x mean
    # spacing and a pair can drift toward each other, so the margin clears several times that.
    margin = layout.PLANE_MARGIN_FACTOR * mean_spacing
    positions = layout.place_planes(
        [(s, radii[s], len(by_plane[s]) == 0) for s in named], MULTIVERSE_RADIUS, margin
    )
    motions = {s: layout.plane_motion(s, mean_spacing) for s in ordered_slugs}
    plane_positions = [positions[s] for s in named]
    plane_radii = [radii[s] for s in named]

    planes: list[Plane] = []
    stars: list[StarRecord] = []
    out_cards: list[Card] = []

    for index, slug in enumerate(ordered_slugs):
        bands = plane_bands[slug]
        band_of = {ref.code: band for band, ref in enumerate(bands)}
        rows = sorted(
            by_plane[slug],
            key=lambda c: (
                band_of.get(c.first_printing.set_code, len(bands)),
                int(hue_class_for(c.detail.colour_identity)),
                c.oracle_id,
            ),
        )
        star_offset = len(stars)
        motion = motions[slug]
        spiral = layout.plane_kind(slug, len(rows)) is layout.PlaneKind.SPIRAL

        arm_counts = [0] * 5
        for row in rows:
            hue = hue_class_for(row.detail.colour_identity)
            if int(hue) < 5:
                arm_counts[int(hue)] += 1
        mean_arm = sum(arm_counts) / 5.0 if sum(arm_counts) else 1.0
        cap = _brightness_cap([len(r.printings) for r in rows])

        for row in rows:
            hue = hue_class_for(row.detail.colour_identity)
            band = band_of.get(row.first_printing.set_code, max(len(bands) - 1, 0))
            if slug == BLIND_ETERNITIES_SLUG:
                position = layout.blind_eternities_position(
                    row.oracle_id, len(stars), plane_positions, plane_radii, MULTIVERSE_RADIUS
                )
            else:
                position = layout.card_position(
                    slug,
                    row.oracle_id,
                    hue,
                    band,
                    max(len(bands), 1),
                    motion,
                    layout.arm_width_scale(arm_counts[int(hue)] if int(hue) < 5 else 0, mean_arm),
                    spiral,
                )
            card = _contract_card(row, set_id_of, sets, meld_results)
            stars.append(
                StarRecord(
                    x=position[0],
                    y=position[1],
                    z=position[2],
                    plane_index=index,
                    hue=hue,
                    size=card.rarity,
                    brightness=layout.brightness_for(len(row.printings), cap),
                    twinkle_phase=rng.integer(0, 255, row.oracle_id, "twinkle"),
                    type_mask=type_mask_for(card.type_line),
                )
            )
            out_cards.append(card)

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
                home=(0.0, 0.0, 0.0) if slug == BLIND_ETERNITIES_SLUG else positions[slug],
                radius=MULTIVERSE_RADIUS if slug == BLIND_ETERNITIES_SLUG else radii[slug],
                tilt=motion.tilt,
                spin_period_s=motion.spin_period_s,
                spin_direction=motion.spin_direction,
                drift_amplitude=motion.drift_amplitude,
                drift_period_s=motion.drift_period_s,
                drift_phase=motion.drift_phase,
                shear_amplitude=motion.shear_amplitude,
                shear_period_s=motion.shear_period_s,
                shear_phase=motion.shear_phase,
                arm_pitch=motion.arm_pitch,
                disc_thickness=motion.disc_thickness,
                bar=motion.bar,
                palette=palette,
                nebula_tint=layout.nebula_tint(palette),
                sets=bands,
            )
        )

    dataset = Dataset(
        dataset=dataset_name,
        as_of=as_of,
        generated_at=generated_at,
        scryfall_bulk_updated_at=scryfall_bulk_updated_at,
        planes=planes,
        sets=set_records,
        stars=stars,
        cards=out_cards,
        multiverse_radius=MULTIVERSE_RADIUS,
        disc_thickness=0.15 * MULTIVERSE_RADIUS,
    )
    return dataset, _stats(by_plane, plane_bands, sets)


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
        key=lambda code: (sets[code].released_at if code in sets else "9999-12-31", code),
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
        counts, key=lambda code: (sets[code].released_at if code in sets else "9999-12-31", code)
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


def _contract_card(
    row: CardInput,
    set_id_of: dict[str, int],
    sets: dict[str, ScrySet],
    meld_results: dict[str, MeldResult],
) -> Card:
    detail = row.detail
    printings = sorted(
        row.printings,
        key=lambda p: (
            sets[p.set_code].released_at if p.set_code in sets else "9999-12-31",
            p.set_code,
            p.collector_number,
            p.id,
        ),
    )
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
    plane_bands: dict[str, list[PlaneSetRef]],
    sets: dict[str, ScrySet],
) -> AssemblyStats:
    dust = by_plane.get(BLIND_ETERNITIES_SLUG, [])
    contributions: dict[str, int] = {}
    for card in dust:
        code = card.first_printing.set_code
        contributions[code] = contributions.get(code, 0) + 1
    top = sorted(contributions.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    largest = max(((s, len(r)) for s, r in by_plane.items()), key=lambda kv: (kv[1], kv[0]))
    return AssemblyStats(
        cards_per_plane={s: len(r) for s, r in by_plane.items()},
        sets_per_plane={s: len(b) for s, b in plane_bands.items()},
        blind_eternities_top_sets=[
            (code, sets[code].name if code in sets else code, count) for code, count in top
        ],
        largest_plane=largest,
    )


def hue_of(colour_identity: str) -> HueClass:
    """Re-exported so the report can label arms without importing the enums module."""
    return hue_class_for(colour_identity)
