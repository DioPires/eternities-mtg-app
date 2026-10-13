"""Lore tables for the hero entries (PRD v4 4.16, Appendix F).

``tables`` validates one directory, ``digest`` names it for the owner's acceptance, ``stage`` runs
both over every hero entry on a pipeline run, ``example`` is the schema example of F.5 and
``spotlight`` is the Story Spotlight sidecar of 9.6.
"""

from __future__ import annotations

from .digest import AcceptanceStatus, DigestError, digest_of_directory
from .index import LoreIndex, LoreIndexError
from .problems import LoreValidationError, Problem, Rule
from .stage import LoreStageError, LoreStageResult, run_stage
from .tables import LoreTables, validate_directory

__all__ = [
    "AcceptanceStatus",
    "DigestError",
    "LoreIndex",
    "LoreIndexError",
    "LoreStageError",
    "LoreStageResult",
    "LoreTables",
    "LoreValidationError",
    "Problem",
    "Rule",
    "digest_of_directory",
    "run_stage",
    "validate_directory",
]
