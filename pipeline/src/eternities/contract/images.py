"""Scryfall URI derivation. The TypeScript twin is ``web/src/data/images.ts``.

Verified against live Scryfall responses in Phase 0; see ``docs/scryfall-policy.md``.
PRD 4.11.3 still holds: the browser loads Scryfall's own URIs at the size the view needs.
"""

from __future__ import annotations

from typing import Final, Literal

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
    """Scryfall page for a printing (PRD 6.4 'Open on Scryfall')."""
    return f"{PAGE_ORIGIN}/card/{set_code}/{collector_number}"
