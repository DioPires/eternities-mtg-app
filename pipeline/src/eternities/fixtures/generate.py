"""Synthetic fixture datasets for Phase 0.

Two datasets, both generated with the seeded rules of PRD 8.6 so web work never waits on the
pipeline and bench numbers mean something from the first shader commit (implementation plan §2):

``fixture-small``  4 planes plus the Blind Eternities, ~500 cards, one Blind Eternities shard.
                   For semantic and decoder tests.
``fixture-scale``  every Appendix A roster entry, ~30 000 stars, sharded Blind Eternities.
                   For performance and label-collision work.

Nothing here touches Scryfall. Phase 1 replaces the card source; the layout rules in
``layout.py`` and the encoder in ``eternities.contract`` are shared, not forked.
"""

from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from ..contract.enums import (
    BLIND_ETERNITIES_SLUG,
    SHARD_SIZE,
    CardType,
    HueClass,
    SizeClass,
    hue_class_for,
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
from . import layout, rng

APPENDIX_A: Final = Path(__file__).resolve().parents[3] / "data" / "appendix_a.json"

NAMESPACE: Final = uuid.UUID("6e7d1f4a-2c3b-4a5e-9d80-1f2a3b4c5d6e")
"""Fixed namespace so every fixture id is reproducible from its key alone."""

MULTIVERSE_RADIUS: Final = 130.0
"""R of PRD 8.6.1. Sized so 82 planes plus the PRD 5.3.3 anti-overlap margin actually pack."""

BLIND_ETERNITIES_SHARE: Final = 0.22
"""PRD 9.2.2 expects 20-25% in the real data; the fixtures sit in that range on purpose."""

_COLOUR_IDENTITIES: Final[tuple[str, ...]] = (
    "W",
    "U",
    "B",
    "R",
    "G",
    "WU",
    "UB",
    "BR",
    "RG",
    "GW",
    "WB",
    "UR",
    "BG",
    "RW",
    "GU",
    "WUB",
    "BRG",
    "GWU",
    "RGW",
    "URW",
    "",
)
_TYPE_LINES: Final[tuple[str, ...]] = (
    "Creature — Human Wizard",
    "Creature — Elf Druid",
    "Legendary Creature — Dragon",
    "Instant",
    "Sorcery",
    "Artifact",
    "Artifact Creature — Golem",
    "Enchantment",
    "Enchantment Creature — Nymph",
    "Legendary Planeswalker — Jace",
    "Land",
    "Basic Land — Island",
    "Battle — Siege",
    "Conspiracy",
)
_LAYOUT_WEIGHTS: Final[dict[str, int]] = {
    # Deliberately covers every *back* shape contract §9 distinguishes, because the fixtures are
    # what Phase 2+ develops against and "two faces" is not "has a back image".
    "normal": 30,  # one face
    "split": 1,  # two faces, no back image — the derived back URI would 404
    "adventure": 1,  # ditto
    "flip": 1,  # ditto
    "transform": 2,  # two faces and a real back image under the same printing id
    "modal_dfc": 1,  # ditto
    "meld": 1,  # back face is a separate Scryfall object, carrying its own id and timestamp
}
_LAYOUTS: Final[tuple[str, ...]] = tuple(
    layout for layout, weight in _LAYOUT_WEIGHTS.items() for _ in range(weight)
)
_TWO_FACED: Final[frozenset[str]] = frozenset(_LAYOUT_WEIGHTS) - {"normal"}
_ADJECTIVES: Final[tuple[str, ...]] = (
    "Ancient",
    "Gilded",
    "Hollow",
    "Riven",
    "Silent",
    "Umbral",
    "Vaulted",
    "Wandering",
    "Ember",
    "Tidal",
    "Iron",
    "Verdant",
    "Shrouded",
    "Radiant",
    "Sunken",
    "Kindled",
)
_NOUNS: Final[tuple[str, ...]] = (
    "Warden",
    "Sentinel",
    "Chorus",
    "Reliquary",
    "Migration",
    "Covenant",
    "Lantern",
    "Harrow",
    "Requiem",
    "Bastion",
    "Threshold",
    "Cartographer",
    "Aurora",
    "Effigy",
    "Tempest",
    "Archivist",
)
_ORACLE_CLAUSES: Final[tuple[str, ...]] = (
    "Flying, vigilance.",
    "When this enters, draw a card.",
    "{T}: Add one mana of any colour.",
    "Whenever a creature you control dies, each opponent loses 1 life.",
    "Trample. Other creatures you control get +1/+1.",
    "Destroy target creature. Its controller creates a Treasure token.",
    "Counter target spell unless its controller pays {2}.",
    "At the beginning of your end step, scry 2.",
)


@dataclass(frozen=True, slots=True)
class FixtureSpec:
    name: str
    plane_slugs: list[str] | None
    """``None`` means every Appendix A roster entry."""
    total_cards: int
    as_of: str


SMALL: Final = FixtureSpec(
    name="fixture-small",
    plane_slugs=[BLIND_ETERNITIES_SLUG, "dominaria", "ravnica", "innistrad", "segovia"],
    total_cards=500,
    as_of="2026-09-04",
)
SCALE: Final = FixtureSpec(
    name="fixture-scale",
    plane_slugs=None,
    total_cards=30000,
    as_of="2026-09-04",
)


def _roster() -> list[dict[str, str]]:
    payload = json.loads(APPENDIX_A.read_text(encoding="utf-8"))
    planes: list[dict[str, str]] = payload["planes"]
    return planes


def _stable_uuid(*key: object) -> str:
    return str(uuid.uuid5(NAMESPACE, "/".join(str(k) for k in key)))


def _card_name(slug: str, index: int) -> str:
    a = rng.choice(list(_ADJECTIVES), slug, index, "adj")
    n = rng.choice(list(_NOUNS), slug, index, "noun")
    suffix = rng.integer(1, 999, slug, index, "suffix")
    return f"{a} {n} {suffix}"


def _allocate_cards(slugs: list[str], total: int) -> dict[str, int]:
    """Give the Blind Eternities its share, then skew the rest so plane sizes look real."""
    named = [s for s in slugs if s != BLIND_ETERNITIES_SLUG]
    blind = round(total * BLIND_ETERNITIES_SHARE)
    remaining = total - blind

    # A Zipf-ish weight over a deterministic shuffle of the roster. The tail is explicit rather
    # than emergent so all three of PRD 5.3.6's morphologies are exercised: a few big spirals, a
    # band of under-50-card irregular clouds, and a handful of genuine zero-card planes.
    order = sorted(named, key=lambda s: rng.unit(s, "rank"))
    counts = dict.fromkeys(named, 0)
    counts[BLIND_ETERNITIES_SLUG] = blind
    if not order:
        return counts

    zero_count = max(1, len(order) // 12)
    small_count = max(1, len(order) // 5)
    small_planes = order[-(zero_count + small_count) : -zero_count]
    large_planes = order[: len(order) - zero_count - small_count] or [order[0]]

    small_total = 0
    for slug in small_planes:
        counts[slug] = rng.integer(1, layout.SPIRAL_THRESHOLD - 1, slug, "smallcount")
        small_total += counts[slug]

    weights = [1.0 / (i + 1.6) ** 0.95 for i in range(len(large_planes))]
    scale = max(remaining - small_total, len(large_planes)) / sum(weights)
    assigned = 0
    for slug, weight in zip(large_planes, weights, strict=True):
        n = max(layout.SPIRAL_THRESHOLD, int(weight * scale))
        counts[slug] = n
        assigned += n
    # Absorb the rounding drift into the largest plane so the total is exact.
    counts[large_planes[0]] += remaining - small_total - assigned
    return counts


def _sets_for_plane(slug: str, card_count: int) -> list[tuple[str, str, int, int]]:
    """``(code, name, year, card_count)`` in chronological order — the chronology bands of 5.4.2."""
    if card_count == 0:
        return []
    band_count = min(max(1, round(math.sqrt(card_count) / 2.2)), 24)
    years = sorted({rng.integer(1993, 2026, slug, "year", i) for i in range(band_count)}) or [1993]
    per_band = card_count // len(years)
    extra = card_count - per_band * len(years)
    out: list[tuple[str, str, int, int]] = []
    for i, year in enumerate(years):
        code = f"{slug[:2]}{i:02d}"
        name = f"{slug.replace('-', ' ').title()} {year}"
        count = per_band + (1 if i < extra else 0)
        out.append((code, name, year, count))
    return out


def _printings(oracle_id: str, first_set_id: int, reprint_pool: list[int]) -> list[Printing]:
    """1-6 printings, first one in the card's own set — the planet list of PRD 5.6.7."""
    count = 1 + int(rng.unit(oracle_id, "printings") ** 2.4 * 6)
    printings: list[Printing] = []
    used = {first_set_id}
    for i in range(count):
        if i == 0:
            set_id = first_set_id
        else:
            set_id = rng.choice(reprint_pool, oracle_id, "reprint", i)
            if set_id in used:
                continue
            used.add(set_id)
        printings.append(
            Printing(
                id=_stable_uuid("printing", oracle_id, i),
                set_id=set_id,
                rarity=SizeClass(rng.integer(0, 3, oracle_id, "prarity", i)),
                image_ts=1700000000 + rng.integer(0, 90000000, oracle_id, "ts", i),
                collector_number=str(rng.integer(1, 420, oracle_id, "cn", i)),
            )
        )
    return printings


def build(spec: FixtureSpec) -> Dataset:
    roster = _roster()
    by_slug = {p["slug"]: p for p in roster}
    slugs = (
        [p["slug"] for p in roster]
        if spec.plane_slugs is None
        else [s for s in spec.plane_slugs if s in by_slug]
    )
    if BLIND_ETERNITIES_SLUG not in slugs:
        raise ValueError("every fixture must contain the Blind Eternities (PRD 4.7.3)")

    counts = _allocate_cards(slugs, spec.total_cards)

    # --- global set dictionary -------------------------------------------------------------
    sets: list[SetRecord] = []
    plane_sets: dict[str, list[PlaneSetRef]] = {}
    for slug in slugs:
        refs: list[PlaneSetRef] = []
        for code, name, year, count in _sets_for_plane(slug, counts[slug]):
            set_id = len(sets)
            sets.append(SetRecord(set_id, code, name, year, slug, count))
            refs.append(PlaneSetRef(set_id, code, name, year, count))
        plane_sets[slug] = refs

    # Reprint-only products carry no Appendix B row and no plane (PRD 4.6, 6.5.4, 6.6.3).
    for i in range(max(4, len(slugs) // 6)):
        sets.append(
            SetRecord(
                len(sets), f"rp{i:02d}", f"Masters Collection {1998 + i * 3}", 1998 + i * 3, None, 0
            )
        )
    reprint_pool = list(range(len(sets)))

    # --- plane geometry --------------------------------------------------------------------
    named = [s for s in slugs if s != BLIND_ETERNITIES_SLUG]
    radii = {s: layout.visual_radius(counts[s]) for s in named}
    mean_spacing = 2.0 * MULTIVERSE_RADIUS / max(math.sqrt(len(named)), 1.0)
    # PRD 5.3.3: spacing must exceed the radii sum plus at least twice the drift amplitude. Every
    # plane drifts by layout.DRIFT_FACTOR * mean_spacing, and a pair can drift toward each other,
    # so the margin has to clear 4 x that, with slack for the float16 round trip.
    margin = layout.PLANE_MARGIN_FACTOR * mean_spacing
    positions = layout.place_planes(
        [(s, radii[s], counts[s] == 0) for s in named], MULTIVERSE_RADIUS, margin
    )
    motions = {s: layout.plane_motion(s, mean_spacing) for s in slugs}

    ordered_slugs = [BLIND_ETERNITIES_SLUG, *sorted(named)]

    # --- cards and stars -------------------------------------------------------------------
    planes: list[Plane] = []
    stars: list[StarRecord] = []
    cards: list[Card] = []
    plane_positions = [positions[s] for s in sorted(named)]
    plane_radii = [radii[s] for s in sorted(named)]

    for index, slug in enumerate(ordered_slugs):
        entry = by_slug[slug]
        card_count = counts[slug]
        motion = motions[slug]
        refs = plane_sets[slug]
        star_offset = len(stars)

        rows = _plane_cards(slug, card_count, refs, reprint_pool)
        spiral = layout.plane_kind(slug, card_count) is layout.PlaneKind.SPIRAL
        arm_counts = [0] * 5
        for row in rows:
            if int(row.hue) < 5:
                arm_counts[int(row.hue)] += 1
        mean_arm = sum(arm_counts) / 5.0 if sum(arm_counts) else 1.0

        printing_counts = sorted(len(r.card.printings) for r in rows)
        cap = (
            printing_counts[min(len(printing_counts) - 1, int(len(printing_counts) * 0.98))]
            if printing_counts
            else 1
        )

        for row in rows:
            if slug == BLIND_ETERNITIES_SLUG:
                pos = layout.blind_eternities_position(
                    row.card.oracle_id, len(stars), plane_positions, plane_radii, MULTIVERSE_RADIUS
                )
            else:
                pos = layout.card_position(
                    slug,
                    row.card.oracle_id,
                    row.hue,
                    row.band,
                    max(len(refs), 1),
                    motion,
                    layout.arm_width_scale(
                        arm_counts[int(row.hue)] if int(row.hue) < 5 else 0, mean_arm
                    ),
                    spiral,
                )
            stars.append(
                StarRecord(
                    x=pos[0],
                    y=pos[1],
                    z=pos[2],
                    plane_index=index,
                    hue=row.hue,
                    size=row.card.rarity,
                    brightness=layout.brightness_for(len(row.card.printings), cap),
                    twinkle_phase=rng.integer(0, 255, row.card.oracle_id, "twinkle"),
                    type_mask=type_mask_for(row.card.type_line),
                )
            )
            cards.append(row.card)

        palette = _palette(rows)
        planes.append(
            Plane(
                index=index,
                slug=slug,
                display_name=entry["displayName"],
                notes=entry["notes"],
                kind=layout.plane_kind(slug, card_count),
                card_count=card_count,
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
                sets=refs,
            )
        )

    return Dataset(
        dataset=spec.name,
        as_of=spec.as_of,
        generated_at=f"{spec.as_of}T00:00:00Z",
        scryfall_bulk_updated_at=None,
        planes=planes,
        sets=sets,
        stars=stars,
        cards=cards,
        multiverse_radius=MULTIVERSE_RADIUS,
        disc_thickness=0.15 * MULTIVERSE_RADIUS,
    )


@dataclass(frozen=True, slots=True)
class _Row:
    card: Card
    hue: HueClass
    band: int


def _plane_cards(
    slug: str, card_count: int, refs: list[PlaneSetRef], reprint_pool: list[int]
) -> list[_Row]:
    """Cards for one plane, already in the ``stars.bin`` order of PRD 8.3: band, then arm."""
    rows: list[_Row] = []
    band_of: list[int] = []
    for band, ref in enumerate(refs):
        band_of.extend([band] * ref.card_count)
    # A rounding drift in _sets_for_plane can leave a card without a band; park it in the last one.
    while len(band_of) < card_count:
        band_of.append(max(len(refs) - 1, 0))

    for i in range(card_count):
        oracle_id = _stable_uuid("card", slug, i)
        identity = rng.choice(list(_COLOUR_IDENTITIES), oracle_id, "ci")
        type_line = rng.choice(list(_TYPE_LINES), oracle_id, "type")
        card_layout = rng.choice(list(_LAYOUTS), oracle_id, "layout")
        band = band_of[i]
        first_set_id = refs[band].id if refs else reprint_pool[0]
        # Every two-faced layout gets a `b`, not only the ones with a back image: a split card has
        # no top-level oracle text on Scryfall at all, so `b` is the only place the second half can
        # live (PRD line 156). A meld back additionally carries its own printing id and timestamp,
        # because the meld result is a separate Scryfall object (PRD line 125).
        back = (
            CardFace(
                name=f"{_card_name(slug, i)} // Reverse",
                mana_cost="",
                type_line="Creature — Spirit",
                oracle_text=rng.choice(list(_ORACLE_CLAUSES), oracle_id, "backtext"),
                printing_id=_stable_uuid("meld", oracle_id) if card_layout == "meld" else None,
                image_ts=(
                    1700000000 + rng.integer(0, 90000000, oracle_id, "meldts")
                    if card_layout == "meld"
                    else None
                ),
            )
            if card_layout in _TWO_FACED
            else None
        )
        printings = _printings(oracle_id, first_set_id, reprint_pool)
        card = Card(
            oracle_id=oracle_id,
            name=_card_name(slug, i),
            mana_cost=_mana_cost(oracle_id, identity),
            type_line=type_line,
            oracle_text=" ".join(
                rng.choice(list(_ORACLE_CLAUSES), oracle_id, "text", k)
                for k in range(rng.integer(1, 3, oracle_id, "clauses"))
            ),
            back=back,
            colour_identity=identity,
            rarity=SizeClass(rng.integer(0, 3, oracle_id, "rarity")),
            layout=card_layout,
            printings=printings,
            set_ids=sorted({p.set_id for p in printings}),
        )
        rows.append(_Row(card=card, hue=hue_class_for(identity), band=band))

    rows.sort(key=lambda r: (r.band, int(r.hue), r.card.oracle_id))
    return rows


def _mana_cost(oracle_id: str, identity: str) -> str:
    generic = rng.integer(0, 5, oracle_id, "generic")
    pips = "".join(f"{{{c}}}" for c in identity)
    return (f"{{{generic}}}" if generic or not pips else "") + pips


def _palette(rows: list[_Row]) -> tuple[float, float, float, float, float, float, float]:
    buckets = [0.0] * 7
    for row in rows:
        buckets[int(row.hue)] += 1.0
    return layout.palette_from_hue_counts(buckets)


def blind_eternities_shard_count(dataset: Dataset) -> int:
    blind = next(p for p in dataset.planes if p.slug == BLIND_ETERNITIES_SLUG)
    return max(1, math.ceil(blind.card_count / SHARD_SIZE))


__all__ = [
    "SCALE",
    "SMALL",
    "CardType",
    "FixtureSpec",
    "blind_eternities_shard_count",
    "build",
]
