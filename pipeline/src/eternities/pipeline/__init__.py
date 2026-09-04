"""The Scryfall pipeline of PRD 8.2 — the stages behind ``eternities build``.

``eternities.contract`` owns the artefact formats (frozen in Phase 0); this package owns the
stages that produce a dataset to write through them. Stage boundaries follow PRD 8.2 exactly:
fetch, filter printings, exclude cards, first printing, assign plane, layout, emit.
"""

from __future__ import annotations

from .appendices import Appendices, PlaneEntry, SetEntry, load_appendices
from .assemble import CardInput, build_dataset
from .records import RawPrinting, ScrySet, UnknownEnumError, assert_known_enums
from .run import BuildResult, build
from .stages import (
    UnmappedSetError,
    assign_planes,
    choose_first_printings,
    exclude_cards,
    filter_printings,
)

__all__ = [
    "Appendices",
    "BuildResult",
    "CardInput",
    "PlaneEntry",
    "RawPrinting",
    "ScrySet",
    "SetEntry",
    "UnknownEnumError",
    "UnmappedSetError",
    "assert_known_enums",
    "assign_planes",
    "build",
    "build_dataset",
    "choose_first_printings",
    "exclude_cards",
    "filter_printings",
    "load_appendices",
]
