"""Scryfall URI derivation. The TypeScript twin is ``web/src/data/images.ts``.

Verified against live Scryfall responses in Phase 0; see ``docs/scryfall-policy.md``.
PRD 4.11.3 still holds: the browser loads Scryfall's own URIs at the size the view needs.
"""

from __future__ import annotations

from typing import Final, Literal
from urllib.parse import quote

from .enums import assert_known_layout
from .models import CardFace

type ImageSize = Literal["small", "normal", "large", "art_crop", "border_crop"]
type CardFaceSide = Literal["front", "back"]

IMAGE_ORIGIN: Final = "https://cards.scryfall.io"
BACKS_ORIGIN: Final = "https://backs.scryfall.io"
PAGE_ORIGIN: Final = "https://scryfall.com"

CARD_BACK_URI: Final = f"{BACKS_ORIGIN}/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg"
"""The Scryfall-provided card back of PRD 5.6.2."""

_SIZES: Final[frozenset[str]] = frozenset({"small", "normal", "large", "art_crop", "border_crop"})


def image_uri(
    printing_id: str, image_ts: int, size: ImageSize, face: CardFaceSide = "front"
) -> str:
    """Scryfall image URI for a printing.

    ``printing_id`` is the Scryfall card ``id``; ``image_ts`` is the cache-busting integer that
    Scryfall appends as a query string and that the pipeline stores per printing.
    """
    if size not in _SIZES:
        raise ValueError(f"unknown image size {size!r}")
    if len(printing_id) < 2:
        raise ValueError(f"printing id {printing_id!r} is too short")
    return (
        f"{IMAGE_ORIGIN}/{size}/{face}/{printing_id[0]}/{printing_id[1]}/{printing_id}.jpg"
        f"?{image_ts}"
    )


def page_uri(set_code: str, collector_number: str) -> str:
    """Scryfall page for a printing (PRD 6.4 'Open on Scryfall').

    Both halves are percent-encoded: Scryfall collector numbers carry ``★`` and ``†`` (``266★``),
    which a browser papers over inside an ``href`` but which breaks the moment the string is
    fetched or re-templated.
    """
    return f"{PAGE_ORIGIN}/card/{quote(set_code, safe='')}/{quote(collector_number, safe='')}"


BACK_IMAGE_LAYOUTS: Final[frozenset[str]] = frozenset(
    {"transform", "modal_dfc", "double_faced_token", "reversible_card", "art_series"}
)
"""The layouts whose printings have a ``.../back/<id>.jpg`` image.

Two faces is *not* the same thing as a back image. Split, adventure and flip cards have two faces —
PRD line 156 needs the per-face oracle text, and on Scryfall a split card's text exists **only**
inside ``card_faces`` — but they are printed on one side, have no per-face ``image_uris``, and
their derived back URI 404s. ``b`` therefore answers "is there a second face", and this answers
"is there a second image". The TypeScript twin is ``BACK_IMAGE_LAYOUTS`` in ``images.ts``."""


def has_back_image(layout: str) -> bool:
    """Whether a printing of this layout has a back image (PRD 4.2.2, 5.6.2)."""
    return assert_known_layout(layout) in BACK_IMAGE_LAYOUTS


def back_image_uri(
    layout: str, back: CardFace | None, printing_id: str, image_ts: int, size: ImageSize
) -> str | None:
    """The back image of a card as printed, or ``None`` when it has none.

    Two sources, because there are two kinds of back:

    - A **meld** result (PRD line 125) is its own Scryfall card with its own id and its own
      ``image_uris``; it has no ``card_faces``. Its image is a *front*, keyed by ``b.id``/``b.ts``.
      This is why :class:`~eternities.contract.models.CardFace` carries an optional printing id.
    - A **transform**-family printing has a genuine back image under the same printing id.

    Everything else — split, adventure, flip, and every single-faced layout — returns ``None``.
    """
    if back is not None and back.printing_id is not None and back.image_ts is not None:
        return image_uri(back.printing_id, back.image_ts, size, "front")
    if has_back_image(layout):
        return image_uri(printing_id, image_ts, size, "back")
    return None
