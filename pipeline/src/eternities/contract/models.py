"""In-memory shapes the encoder writes from. Frozen: see docs/data-contract.md."""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import HueClass, PlaneKind, SizeClass

type Vec3 = tuple[float, float, float]
type Quat = tuple[float, float, float, float]
type Palette = tuple[float, float, float, float, float, float, float]


@dataclass(frozen=True, slots=True)
class StarRecord:
    """One card. 12 bytes on the wire (docs/data-contract.md §5)."""

    x: float
    y: float
    z: float
    plane_index: int
    hue: HueClass
    size: SizeClass
    brightness: int
    twinkle_phase: int
    type_mask: int


@dataclass(frozen=True, slots=True)
class SetRecord:
    """A row of the global set dictionary. ``id`` is the uint16 used by ``sets.bin``."""

    id: int
    code: str
    name: str
    year: int
    plane_slug: str | None
    card_count: int


@dataclass(frozen=True, slots=True)
class PlaneSetRef:
    """A set as listed on a plane: one chronology band (PRD 5.4.2)."""

    id: int
    code: str
    name: str
    year: int
    card_count: int


@dataclass(frozen=True, slots=True)
class Plane:
    index: int
    slug: str
    display_name: str
    notes: str
    kind: PlaneKind
    card_count: int
    star_offset: int
    star_count: int
    home: Vec3
    radius: float
    tilt: Quat
    spin_period_s: float
    spin_direction: int
    drift_amplitude: float
    drift_period_s: float
    drift_phase: float
    shear_amplitude: float
    shear_period_s: float
    shear_phase: float
    arm_pitch: float
    disc_thickness: float
    bar: bool
    palette: Palette
    nebula_tint: Vec3
    sets: list[PlaneSetRef] = field(default_factory=list)

    @property
    def first_year(self) -> int | None:
        return min((s.year for s in self.sets), default=None)

    @property
    def last_year(self) -> int | None:
        return max((s.year for s in self.sets), default=None)


@dataclass(frozen=True, slots=True)
class Printing:
    """PRD 4.8. Image and page URIs are derived from these fields (contract §9)."""

    id: str
    set_id: int
    rarity: SizeClass
    image_ts: int
    collector_number: str


@dataclass(frozen=True, slots=True)
class CardFace:
    name: str
    mana_cost: str
    type_line: str
    oracle_text: str


@dataclass(frozen=True, slots=True)
class Card:
    """A card's detail row, as written into a plane shard."""

    oracle_id: str
    name: str
    mana_cost: str
    type_line: str
    oracle_text: str
    back: CardFace | None
    colour_identity: str
    rarity: SizeClass
    layout: str
    printings: list[Printing]
    set_ids: list[int]
    """Distinct included-printing set ids, ascending. Drives ``sets.bin`` section 3."""


@dataclass(frozen=True, slots=True)
class Dataset:
    """Everything one pipeline run produces, before it is written to disk."""

    dataset: str
    as_of: str
    generated_at: str
    scryfall_bulk_updated_at: str | None
    planes: list[Plane]
    sets: list[SetRecord]
    stars: list[StarRecord]
    cards: list[Card]
    """Parallel to ``stars``: index i is the detail of star i."""

    multiverse_radius: float = 100.0
    disc_thickness: float = 15.0

    def __post_init__(self) -> None:
        if len(self.cards) != len(self.stars):
            raise ValueError(
                f"cards ({len(self.cards)}) and stars ({len(self.stars)}) must be parallel"
            )
