"""In-memory shapes the encoder writes from. Frozen: see docs/data-contract.md."""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import HueClass, PlaneKind, SizeClass, assert_known_layout

type Vec3 = tuple[float, float, float]
type Quat = tuple[float, float, float, float]
type Palette = tuple[float, float, float, float, float, float, float]
type Swatch = tuple[int, int, int, int]
"""One card's art as four uint16 RGB565 samples: top-left, top-right, bottom-left, bottom-right.

Eight bytes in ``swatches.bin`` (worlds spec §2.2). This is a *pixel* statistic of the card's own
art, which is the thing concept B is built on and the thing ``hueClass`` — a seven-way
classification of colour identity — is not."""


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
    """v3 (§1.3): ``0.126 * sqrt(cardCount)`` — constant area per card — or §1.8's moon floor for
    an empty plane. The Blind Eternities still carries the multiverse radius for the belt."""
    tilt: Quat
    spin_period_s: float
    spin_direction: int
    drift_amplitude: float
    drift_period_s: float
    drift_phase: float
    palette: Palette
    nebula_tint: Vec3
    sets: list[PlaneSetRef] = field(default_factory=list)
    row_cells: list[int] = field(default_factory=list)
    """v3 (§2.4): the surface grid's per-row cell counts, north to south.

    ``len(row_cells)`` is the row count; row latitudes are equal-angle with ``dphi = pi / rows`` and
    centres at ``(i + 1/2) * dphi``, so the client's only remaining derivation is matching a cell to
    its row by nearest colatitude.

    Shipped rather than derived because §1.3's relaxation makes the counts *population*-derived: the
    closed form no longer describes the shipped grid (Rabiah, 78 slots from the formula against 75
    cells in fact). Counting the stars per row would also recover it, but only *because* §1.3
    mandates zero bare cells, and a contract whose correctness depends on a rendering invariant
    holding forever is not worth the ~3 KB it saves. The counting path survives as a pipeline
    invariant check instead, which is what makes "zero bare" verifiable at the artefact.

    Empty planes and the belt carry an empty list and omit the key."""

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
    artist: str = ""
    """v3 (§2.3). Per *printing*, not per card, because art differs between printings; ``""`` where
    Scryfall has no artist.

    An inline string rather than an id into a dictionary, and that is a budget decision, not a
    stylistic one: the only sensible home for a global artist dictionary is ``search.json``, which
    is half of the 95%-full ``search.json`` + ``sets.bin`` pair, while the shards have 4.4x
    headroom. The cost goes where the headroom is.

    It is in the contract at all because concept B shows tens of thousands of ``art_crop``s with no
    card in sight, so the app stops satisfying the alternative clause of Scryfall's terms — "show
    the artist and copyright, *or* the full card alongside" — that the focused-card planets satisfy
    today."""


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

    swatches: list[Swatch] = field(default_factory=list)
    """Parallel to ``stars`` too: index i is the art statistic of star i (§2.2).

    ``swatches.bin``'s whole encoding is that parallelism — the lookup is ``starIndex * 8 + 16``
    with no table — so :meth:`__post_init__` refuses a dataset where it does not hold rather than
    letting the encoder write a file whose every index is silently off by one."""

    multiverse_radius: float = 100.0

    def __post_init__(self) -> None:
        if len(self.cards) != len(self.stars):
            raise ValueError(
                f"cards ({len(self.cards)}) and stars ({len(self.stars)}) must be parallel"
            )
        if self.swatches and len(self.swatches) != len(self.stars):
            raise ValueError(
                f"swatches ({len(self.swatches)}) and stars ({len(self.stars)}) must be parallel"
            )
