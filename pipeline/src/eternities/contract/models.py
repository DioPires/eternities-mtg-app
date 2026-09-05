"""In-memory shapes the encoder writes from. Frozen: see docs/data-contract.md."""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import HueClass, PlaneKind, SizeClass, assert_known_layout

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
    #: Five-bit WUBRG mask, sharing byte 7 with ``hue``. No default on purpose: a silently
    #: zeroed identity reads as colourless and would dim real cards under the 6.6.2 filter.
    colour_identity: int
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
    """A card's second face. ``b`` in a plane shard (contract §9)."""

    name: str
    mana_cost: str
    type_line: str
    oracle_text: str

    printing_id: str | None = None
    """Set only for a **meld** back (PRD line 125).

    A meld result is excluded as a card of its own but stays reachable as the back face of its
    components. It is a separate Scryfall object with its own id and its own top-level
    ``image_uris`` and **no** ``card_faces``, so its image cannot be derived from the component's
    printing. These two fields are the only way the image is reachable at all; they are absent on
    every other layout, which costs nothing in a shard.
    """

    image_ts: int | None = None
    """Cache-busting timestamp for :attr:`printing_id`. Set together with it or not at all."""

    def __post_init__(self) -> None:
        if (self.printing_id is None) != (self.image_ts is None):
            raise ValueError("a back face needs both printing_id and image_ts, or neither")


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

    def __post_init__(self) -> None:
        # `layout` decides whether a back *image* exists (contract §9), so an unclassified value
        # must stop the run rather than reach a consumer that would derive a URI which 404s.
        assert_known_layout(self.layout)


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
