"""How a lore table failure is named: the rule, the file, the row and the field.

PRD v4 4.16.2 fails the build "with the row named" and Appendix F.0 "naming the file and the
field". A :class:`Problem` carries the four, and its :class:`Rule` is a stable name a test can
assert on, so a negative test fails for the reason it names and not for a neighbouring one.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Rule(StrEnum):
    # The files themselves (F.0).
    MISSING_FILE = "missing-file"
    NOT_JSON = "not-json"
    NUMBER = "number"
    DUPLICATE_FIELD = "duplicate-field"
    UNKNOWN_FIELD = "unknown-field"
    MISSING_FIELD = "missing-field"
    WRONG_TYPE = "wrong-type"
    PLANE_IDENTITY = "plane-identity"
    ROW_COUNT = "row-count"
    SLUG = "slug"
    DUPLICATE_ID = "duplicate-id"
    LENGTH = "length"
    # Regions (F.1).
    KIT = "kit"
    FOURTH_KIT = "fourth-kit"
    VARIANT = "variant"
    WATER = "water"
    AMBIENT = "ambient"
    ANCHOR_OUTSIDE_DISC = "anchor-outside-disc"
    ANCHORS_TOO_CLOSE = "anchors-too-close"
    WEIGHT = "weight"
    # Eras (F.2).
    KIND = "kind"
    ACCEPTED_RECORD = "accepted-record"
    ERA_REGION = "era-region"
    SET_UNMAPPED = "set-unmapped"
    SET_IN_TWO_ERAS = "set-in-two-eras"
    SET_NOT_ON_PLANE = "set-not-on-plane"
    HEADLINE = "headline"
    HEADLINE_WITH_SPOTLIGHT = "headline-with-spotlight"
    PARAGRAPH_COUNT = "paragraph-count"
    SENTENCE_COUNT = "sentence-count"
    # Sentences (F.0, F.4, 9.1.6).
    SENTENCE_WITHOUT_SOURCE = "sentence-without-source"
    SOURCE_OFF_ALLOWLIST = "source-off-allowlist"
    SOURCE_NOT_IN_DATASET = "source-not-in-dataset"
    SOURCE_FACE = "source-face"
    WORD_LIMIT = "word-limit"
    PRESENTATION_LINT = "presentation-lint"
    # Keywords (F.3).
    KEYWORD = "keyword"
    KEYWORD_REGION = "keyword-region"
    KEYWORD_DUPLICATE = "keyword-duplicate"
    # Product tables (F.2).
    PRODUCT_KEYWORDS = "product-keywords"
    PRODUCT_SET_UNMAPPED = "product-set-unmapped"
    PRODUCT_SET_IN_TWO_FAMILIES = "product-set-in-two-families"
    PRODUCT_ERA_SET_OUTSIDE_FAMILY = "product-era-set-outside-family"
    # The Story Spotlight sidecar (9.6).
    SPOTLIGHT = "spotlight"
    SPOTLIGHT_NOT_IN_DATASET = "spotlight-not-in-dataset"


@dataclass(frozen=True, slots=True)
class Problem:
    rule: Rule
    file: str
    row: str
    """The row, as ``regions[3] "shiv"``; empty for the file's own fields."""
    field: str
    message: str

    def render(self, directory: str) -> str:
        parts = [f"{directory}/{self.file}", self.row, self.field, self.message]
        return ": ".join(part for part in parts if part)


class LoreValidationError(RuntimeError):
    """One lore directory failed PRD 4.16.2 or Appendix F.0. Every failure is listed."""

    def __init__(self, directory: str, problems: list[Problem]) -> None:
        self.directory = directory
        self.problems = problems
        lines = "\n".join(f"  {problem.render(directory)}" for problem in problems)
        noun = "rule" if len(problems) == 1 else "rules"
        super().__init__(f"{directory} breaks {len(problems)} lore table {noun}:\n{lines}")
