"""Validate one lore directory: every rule of PRD v4 4.16.2 and Appendix F.0 to F.4.

A lore directory holds ``regions.json``, ``eras.json`` and ``keywords.json`` for one hero entry.
:func:`validate_directory` reads the three, applies every rule and either returns the tables with
their digest and acceptance status, or raises :class:`LoreValidationError` listing every failure by
file, row and field. It does not stop at the first one: a drafter fixes a table in one pass.

**What is validity and what is not.** Whether the ``accepted`` record's digest matches the files is
the acceptance status (F.2). It is returned, never raised: a table set with a stale record is valid
and builds in development (4.16.5). The record's own fields and types are validity.

**What ``fixture`` relaxes** (5.4.14): the row minimums (4 regions, 3 eras), down to one row each.
Nothing else. The acceptance requirement it also relaxes is enforced by the stage, not here.

**Readings this module settles**, each named in the pull request that added it:

- A word is a run of characters between white space, so the limits count ``len(text.split())``.
- ``kit`` is required. F.0 gives it a default, the theme row's kit, and does not mark it optional;
  the theme row is Appendix C ingestion (4.12), which is not in the pipeline.
- ``variant`` is checked for its form only, for the same reason (``vocabulary``).
- ``kind`` is ``product`` for the Blind Eternities and ``lore`` for every other entry (F.0, 5.13.8).
- The presentation lint of 9.1.6 reads every string a visitor sees: sentence texts, region and era
  names, and ``years``. ``set_piece`` is never shown and is not read.
- A headline name resolves to exactly one card of the entry's plane whose first printing is in the
  era's sets.
- ``headline`` must be empty when the era's sets carry Story Spotlight cards (F.0). The rule needs
  the entry's sidecar; with no sidecar it cannot be checked, and the report says so.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Final, Literal, cast

from . import strict_json
from .digest import DIGEST_PREFIX, FILES, AcceptanceStatus, digest_of, status_of
from .index import LoreIndex
from .problems import LoreValidationError, Problem, Rule
from .sources import locator_flaw
from .strict_json import Flaw
from .vocabulary import AMBIENT, BLIND_ETERNITIES, KITS, MAX_KITS_PER_ENTRY, WATER

REGIONS_FILE, ERAS_FILE, KEYWORDS_FILE = FILES

REGION_ROWS: Final = (4, 12)
ERA_ROWS: Final = (3, 16)
PRODUCT_ERA_ROWS: Final = (3, 24)
FIXTURE_MIN_ROWS: Final = 1

DISC_RADIUS: Final = 1000
"""An anchor is a pair in thousandths inside the unit disc: u^2 + v^2 <= 1,000,000."""
MIN_ANCHOR_DISTANCE: Final = 150
WEIGHT_RANGE: Final = (500, 2000)

REGION_NAME_CHARS: Final = 40
ERA_NAME_CHARS: Final = 60
YEARS_WORDS: Final = 20
SENTENCE_WORDS: Final = 40
ERA_WORDS: Final = 300
PARAGRAPHS: Final = (1, 3)
SENTENCES: Final = (1, 6)
HEADLINE_NAMES: Final = 6
KEYWORD_CHARS: Final = 3
ACCEPTED_BY_CHARS: Final = 40

_SLUG: Final = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_LINT: Final = re.compile(r"\b(?:game|player)s?\b", re.IGNORECASE)
_DATE: Final = re.compile(r"\d{4}-\d{2}-\d{2}")
_ISSUE: Final = re.compile(r"DEC-[0-9]+")
_DIGEST: Final = re.compile(re.escape(DIGEST_PREFIX) + r"[0-9a-f]{64}")

type _Kind = Literal["string", "integer", "array", "object"]

_ARTICLE: Final[dict[_Kind, str]] = {
    "string": "a string",
    "integer": "an integer",
    "array": "an array",
    "object": "an object",
}


@dataclass(frozen=True, slots=True)
class LoreTables:
    """One validated table set."""

    slug: str
    kind: str
    regions: dict[str, Any]
    eras: dict[str, Any]
    keywords: dict[str, Any]
    digest: str
    recorded_digest: str | None
    """The ``accepted`` record's digest, or ``None`` when the tables carry no record."""
    status: AcceptanceStatus
    unchecked_variants: tuple[str, ...]
    """``region: kit/variant`` for every region that names a variant (see ``vocabulary``)."""


def has_tables(directory: Path) -> bool:
    """A directory has tables when any of the three files is there; then all three must be."""
    return any((directory / name).exists() for name in FILES)


def validate_directory(
    directory: Path,
    index: LoreIndex,
    *,
    hero_entries: tuple[str, ...],
    fixture: bool = False,
    spotlight_sets: frozenset[str] | None = None,
    display: str | None = None,
) -> LoreTables:
    """Apply 4.16.2 and F.0 to ``directory``; raise :class:`LoreValidationError` on any failure.

    ``spotlight_sets`` is the set codes that carry a Story Spotlight card of this plane, from the
    entry's sidecar, or ``None`` when the entry has no sidecar. ``display`` is the directory's name
    in messages; it defaults to the path as given.
    """
    check = Check(directory.name, index, hero_entries, fixture, spotlight_sets)
    documents: dict[str, dict[str, Any]] = {}
    for name in FILES:
        document = check.read(directory / name, name)
        if document is not None:
            documents[name] = document
    if len(documents) == len(FILES):
        product = check.kind(documents[ERAS_FILE]) == "product"
        regions = check.regions(documents[REGIONS_FILE], product)
        check.eras(documents[ERAS_FILE], regions, product)
        check.keywords(documents[KEYWORDS_FILE], regions, product)
        recorded = check.accepted(documents[ERAS_FILE])
    else:
        product, recorded = False, None

    if check.problems:
        raise LoreValidationError(display or str(directory), check.problems)

    computed = digest_of(documents[REGIONS_FILE], documents[ERAS_FILE], documents[KEYWORDS_FILE])
    return LoreTables(
        slug=directory.name,
        kind="product" if product else "lore",
        regions=documents[REGIONS_FILE],
        eras=documents[ERAS_FILE],
        keywords=documents[KEYWORDS_FILE],
        digest=computed,
        recorded_digest=recorded,
        status=status_of(recorded, computed),
        unchecked_variants=tuple(check.variants),
    )


def _is(kind: _Kind, value: Any) -> bool:
    if kind == "string":
        return isinstance(value, str)
    if kind == "integer":
        # `True` is an `int` in Python and a boolean in JSON.
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "array":
        return isinstance(value, list)
    return isinstance(value, dict)


def _words(text: str) -> int:
    return len(text.split())


def _row(table: str, position: int, row: Any) -> str:
    """``regions[3] "shiv"``: the row's position, and its id when it has one."""
    label = f"{table}[{position}]"
    if isinstance(row, dict):
        ident = cast("dict[str, Any]", row).get("id")
        if isinstance(ident, str):
            return f'{label} "{ident}"'
    return label


def _named_rows(document: Any) -> dict[str, str]:
    """``regions[3]`` to ``regions[3] "shiv"``, for every row the rules name with its id.

    The reader reports a forbidden value by the path to it, before any rule has read the row. This
    is how its message names the row as the rules below name it. A keyword and a sidecar printing
    are named by position, so they are not here; neither is a row whose id is not text.
    """
    names: dict[str, str] = {}
    if isinstance(document, dict):
        for table in ("regions", "eras"):
            rows = cast("dict[str, Any]", document).get(table)
            if isinstance(rows, list):
                for position, row in enumerate(cast("list[Any]", rows)):
                    named = _row(table, position, row)
                    if not strict_json.lone_surrogates(named):
                        names[f"{table}[{position}]"] = named
    return names


@dataclass(slots=True)
class _Region:
    row: str
    sets: frozenset[str]
    """The family's set codes; empty on a lore table."""


class Check:
    """One directory's validation: the problems found so far, and the rules that find them.

    ``spotlight`` uses the reading and shape rules for the sidecar, so a failure there is named
    the same way.
    """

    def __init__(
        self,
        slug: str,
        index: LoreIndex,
        hero_entries: tuple[str, ...],
        fixture: bool,
        spotlight_sets: frozenset[str] | None,
    ) -> None:
        self.slug = slug
        self.index = index
        self.hero_entries = hero_entries
        self.fixture = fixture
        self.spotlight_sets = spotlight_sets
        self.expected = index.expected_sets(slug)
        self.problems: list[Problem] = []
        self.variants: list[str] = []
        self._hero_reported = False

    def add(self, rule: Rule, file: str, row: str, field: str, message: str) -> None:
        self.problems.append(Problem(rule=rule, file=file, row=row, field=field, message=message))

    # --- reading -------------------------------------------------------------------------------

    def read(self, path: Path, name: str) -> dict[str, Any] | None:
        if not path.exists():
            self.add(Rule.MISSING_FILE, name, "", "", "the file does not exist (4.16.1)")
            return None
        try:
            value = strict_json.load(path)
        except strict_json.NotJsonError as error:
            self.add(Rule.NOT_JSON, name, "", "", str(error))
            return None
        # Every forbidden number and every repeated field is reported here, once, with the path
        # to it. The rules below then pass over a `Flaw` without a second message.
        names = _named_rows(value)
        for where, flaw in strict_json.flaws(value):
            row, _, field = where.partition(".")
            if not field:
                row, field = "", where
            rule = Rule.DUPLICATE_FIELD if flaw.duplicate else Rule.NUMBER
            self.add(rule, name, names.get(row, row), field, flaw.message)
        surrogates = strict_json.lone_surrogates(value)
        for where in surrogates:
            row, _, field = where.partition(".")
            if not field:
                row, field = "", where
            self.add(
                Rule.NOT_JSON,
                name,
                names.get(row, row),
                field,
                "holds half of a surrogate pair, which is not text",
            )
        if not isinstance(value, dict):
            self.add(Rule.WRONG_TYPE, name, "", "", "the file must hold one JSON object (F.0)")
            return None
        return None if surrogates else cast("dict[str, Any]", value)

    def shape(
        self,
        file: str,
        row: str,
        value: Any,
        required: dict[str, _Kind],
        optional: dict[str, _Kind] | None = None,
        *,
        prefix: str = "",
    ) -> dict[str, Any] | None:
        """F.0: exactly these fields, with these types.

        Returns the members that are present and well typed, so each later rule runs on what is
        sound and stays silent about what was already reported. ``None`` when ``value`` is not an
        object at all.
        """
        if isinstance(value, Flaw):
            return None
        if not isinstance(value, dict):
            self.add(Rule.WRONG_TYPE, file, row, prefix.rstrip("."), "must be an object (F.0)")
            return None
        members = cast("dict[str, Any]", value)
        fields: dict[str, _Kind] = {**required, **(optional or {})}
        sound: dict[str, Any] = {}
        for key, member in members.items():
            if key not in fields:
                self.add(
                    Rule.UNKNOWN_FIELD,
                    file,
                    row,
                    prefix + key,
                    f"is not a field of F.0; the fields here are {', '.join(sorted(fields))}",
                )
            elif isinstance(member, Flaw):
                continue
            elif not _is(fields[key], member):
                self.add(
                    Rule.WRONG_TYPE,
                    file,
                    row,
                    prefix + key,
                    f"must be {_ARTICLE[fields[key]]} (F.0)",
                )
            else:
                sound[key] = member
        for key in required:
            if key not in members:
                self.add(Rule.MISSING_FIELD, file, row, prefix + key, "is required (F.0)")
        return sound

    def strings(self, file: str, row: str, field: str, values: list[Any]) -> list[str] | None:
        """The array's members when every one is a string; otherwise report and return ``None``."""
        sound = True
        for position, value in enumerate(values):
            if isinstance(value, Flaw):
                sound = False
            elif not isinstance(value, str):
                self.add(Rule.WRONG_TYPE, file, row, f"{field}[{position}]", "must be a string")
                sound = False
        return cast("list[str]", values) if sound else None

    def plane(self, file: str, document: dict[str, Any]) -> None:
        """F.0: ``plane`` matches the directory and an Appendix C.1 row with ``hero: true``."""
        named = document.get("plane")
        if isinstance(named, str) and named != self.slug:
            self.add(
                Rule.PLANE_IDENTITY,
                file,
                "",
                "plane",
                f"is {named!r} and the directory is {self.slug!r}; the two must match (F.0)",
            )
        if self.slug not in self.hero_entries and not self._hero_reported:
            self._hero_reported = True
            self.add(
                Rule.PLANE_IDENTITY,
                file,
                "",
                "plane",
                f"the directory {self.slug!r} is not one of the twenty hero entries of "
                "Appendix C.1 (F.0)",
            )

    def count(
        self, file: str, field: str, rows: list[Any], limits: tuple[int, int], what: str
    ) -> None:
        low, high = limits
        if self.fixture:
            low = min(low, FIXTURE_MIN_ROWS)
        if not low <= len(rows) <= high:
            self.add(
                Rule.ROW_COUNT,
                file,
                "",
                field,
                f"has {len(rows)} {what}; the table takes {low} to {high} (F.0)",
            )

    # --- strings a visitor reads ---------------------------------------------------------------

    def lint(self, file: str, row: str, field: str, text: str) -> None:
        found = _LINT.search(text)
        if found:
            self.add(
                Rule.PRESENTATION_LINT,
                file,
                row,
                field,
                f"uses the word {found[0]!r}; the presentation lint allows neither 'game' nor "
                "'player' in authored text (9.1.6)",
            )

    def name(self, file: str, row: str, field: str, text: str, limit: int) -> None:
        if not 1 <= len(text) <= limit:
            self.add(
                Rule.LENGTH,
                file,
                row,
                field,
                f"is {len(text)} characters; the field takes 1 to {limit} (F.0)",
            )
        self.lint(file, row, field, text)

    def slug_id(self, file: str, row: str, ident: str, seen: dict[str, str]) -> None:
        if not _SLUG.fullmatch(ident):
            self.add(
                Rule.SLUG,
                file,
                row,
                "id",
                f"{ident!r} is not a slug: lower-case letters and digits joined by single "
                "hyphens (4.16.2)",
            )
        if ident in seen:
            self.add(
                Rule.DUPLICATE_ID, file, row, "id", f"{ident!r} is also the id of {seen[ident]}"
            )
        else:
            seen[ident] = row

    def locator(self, file: str, row: str, field: str, locator: str) -> None:
        flaw = locator_flaw(locator, self.index)
        if flaw is not None:
            self.add(flaw.rule, file, row, field, flaw.message)

    def sentence(self, file: str, row: str, field: str, value: Any) -> int:
        """One sentence object. Returns its word count, 0 when the text cannot be counted."""
        if isinstance(value, Flaw):
            return 0
        if not isinstance(value, dict):
            self.add(
                Rule.WRONG_TYPE, file, row, field, "must be a sentence object {text, source} (F.0)"
            )
            return 0
        members = cast("dict[str, Any]", value)
        for key in members:
            if key not in ("text", "source"):
                self.add(
                    Rule.UNKNOWN_FIELD,
                    file,
                    row,
                    f"{field}.{key}",
                    "is not a field of a sentence object; the fields are source, text (F.0)",
                )

        words = 0
        text = members.get("text")
        if "text" not in members:
            self.add(Rule.MISSING_FIELD, file, row, f"{field}.text", "is required (F.0)")
        elif isinstance(text, Flaw):
            pass
        elif not isinstance(text, str):
            self.add(Rule.WRONG_TYPE, file, row, f"{field}.text", "must be a string (F.0)")
        else:
            words = _words(text)
            if words == 0:
                self.add(Rule.LENGTH, file, row, f"{field}.text", "is empty")
            if words > SENTENCE_WORDS:
                self.add(
                    Rule.WORD_LIMIT,
                    file,
                    row,
                    f"{field}.text",
                    f"has {words} words; a sentence takes at most {SENTENCE_WORDS} (4.16.2)",
                )
            self.lint(file, row, f"{field}.text", text)

        source = members.get("source")
        if source is None or (isinstance(source, str) and not source.strip()):
            self.add(
                Rule.SENTENCE_WITHOUT_SOURCE,
                file,
                row,
                f"{field}.source",
                "the sentence has no source; every sentence carries one (4.16.2, F.4)",
            )
        elif isinstance(source, Flaw):
            pass
        elif not isinstance(source, str):
            self.add(Rule.WRONG_TYPE, file, row, f"{field}.source", "must be a string (F.0)")
        else:
            self.locator(file, row, f"{field}.source", source)
        return words

    # --- eras.json: kind and the acceptance record ---------------------------------------------

    def kind(self, document: dict[str, Any]) -> str:
        """The table's kind. An entry's kind is fixed by its slug, so a wrong one is reported."""
        expected = "product" if self.slug == BLIND_ETERNITIES else "lore"
        declared = document.get("kind")
        if not isinstance(declared, str):
            return expected  # `eras` reports the missing or mistyped field
        if declared not in ("lore", "product"):
            self.add(
                Rule.KIND, ERAS_FILE, "", "kind", f"is {declared!r}; it is 'lore' or 'product'"
            )
            return expected
        if declared != expected:
            self.add(
                Rule.KIND,
                ERAS_FILE,
                "",
                "kind",
                f"is {declared!r}; the tables of {self.slug} are {expected!r}, because 'product' "
                "is the Blind Eternities' kind and no other entry's (F.0)",
            )
        return declared

    def accepted(self, document: dict[str, Any]) -> str | None:
        """F.0: exactly ``{by, on, issue, digest}``. Returns the recorded digest when sound."""
        if not isinstance(document.get("accepted"), dict):
            return None  # absent, or mistyped, which `eras` reports with the file's other fields
        row = "accepted"
        record = (
            self.shape(
                ERAS_FILE,
                row,
                document["accepted"],
                {"by": "string", "on": "string", "issue": "string", "digest": "string"},
            )
            or {}
        )
        by, on = record.get("by"), record.get("on")
        issue, digest = record.get("issue"), record.get("digest")
        if isinstance(by, str) and not 1 <= len(by) <= ACCEPTED_BY_CHARS:
            self.add(
                Rule.ACCEPTED_RECORD,
                ERAS_FILE,
                row,
                "by",
                f"is {len(by)} characters; the field takes 1 to {ACCEPTED_BY_CHARS} (F.0)",
            )
        if isinstance(on, str) and not is_date(on):
            self.add(
                Rule.ACCEPTED_RECORD, ERAS_FILE, row, "on", f"{on!r} is not a date YYYY-MM-DD (F.0)"
            )
        if isinstance(issue, str) and not _ISSUE.fullmatch(issue):
            self.add(
                Rule.ACCEPTED_RECORD,
                ERAS_FILE,
                row,
                "issue",
                f"{issue!r} does not match DEC-[0-9]+ (F.0)",
            )
        if isinstance(digest, str) and not _DIGEST.fullmatch(digest):
            self.add(
                Rule.ACCEPTED_RECORD,
                ERAS_FILE,
                row,
                "digest",
                f"{digest!r} is not 'sha256:' followed by 64 lower-case hex digits (F.0)",
            )
            return None
        return digest if isinstance(digest, str) else None

    # --- regions.json --------------------------------------------------------------------------

    def regions(self, document: dict[str, Any], product: bool) -> dict[str, _Region]:
        file = REGIONS_FILE
        top = self.shape(file, "", document, {"plane": "string", "regions": "array"}) or {}
        self.plane(file, document)
        rows = cast("list[Any]", top.get("regions", []))
        if "regions" in top:
            self.count(file, "regions", rows, REGION_ROWS, "rows")

        required: dict[str, _Kind] = {
            "id": "string",
            "name": "string",
            "kit": "string",
            "anchor": "array",
            "weight": "integer",
            "water": "string",
            "sentence": "object",
            "sources": "array",
        }
        if product:
            required["sets"] = "array"
        optional: dict[str, _Kind] = {
            "variant": "string",
            "ambient": "string",
            "set_piece": "string",
        }

        regions: dict[str, _Region] = {}
        ids: dict[str, str] = {}
        kits: list[str] = []
        anchors: list[tuple[str, int, int]] = []
        families: dict[str, str] = {}
        families_sound = True
        for position, raw in enumerate(rows):
            row = _row("regions", position, raw)
            region = self.shape(file, row, raw, required, optional)
            if region is None:
                families_sound = False
                continue

            if "id" in region:
                self.slug_id(file, row, region["id"], ids)
            if "name" in region:
                self.name(file, row, "name", region["name"], REGION_NAME_CHARS)

            kit = region.get("kit")
            if kit is not None:
                if kit not in KITS:
                    self.add(
                        Rule.KIT,
                        file,
                        row,
                        "kit",
                        f"{kit!r} is not one of the twelve kits: {', '.join(sorted(KITS))} (5.6.1)",
                    )
                elif kit not in kits:
                    if len(kits) >= MAX_KITS_PER_ENTRY:
                        self.add(
                            Rule.FOURTH_KIT,
                            file,
                            row,
                            "kit",
                            f"{kit!r} is distinct kit number {len(kits) + 1} of the entry, after "
                            f"{', '.join(kits)}; an entry takes at most {MAX_KITS_PER_ENTRY} "
                            "(4.16.2, 11.18)",
                        )
                    kits.append(kit)

            variant = region.get("variant")
            if variant is not None:
                if not _SLUG.fullmatch(variant):
                    self.add(Rule.VARIANT, file, row, "variant", f"{variant!r} is not a slug (F.0)")
                elif "id" in region and kit in KITS:
                    self.variants.append(f"{region['id']}: {kit}/{variant}")

            if "anchor" in region:
                anchor = self.anchor(file, row, region["anchor"])
                if anchor is not None:
                    self.separation(file, row, anchor, anchors)
                    anchors.append((row, *anchor))

            weight = region.get("weight")
            if weight is not None and not WEIGHT_RANGE[0] <= weight <= WEIGHT_RANGE[1]:
                self.add(
                    Rule.WEIGHT,
                    file,
                    row,
                    "weight",
                    f"is {weight}; a weight is an integer in thousandths in "
                    f"[{WEIGHT_RANGE[0]}, {WEIGHT_RANGE[1]}] (4.16.2)",
                )

            water = region.get("water")
            if water is not None and water not in WATER:
                self.add(
                    Rule.WATER,
                    file,
                    row,
                    "water",
                    f"{water!r} is not a water value: {', '.join(sorted(WATER))} (4.12.2)",
                )
            ambient = region.get("ambient")
            if ambient is not None and ambient not in AMBIENT:
                self.add(
                    Rule.AMBIENT,
                    file,
                    row,
                    "ambient",
                    f"{ambient!r} is not an ambient family: {', '.join(sorted(AMBIENT))} (4.12.2)",
                )

            if "sentence" in region:
                self.sentence(file, row, "sentence", region["sentence"])
            if "sources" in region:
                listed = cast("list[Any]", region["sources"])
                if not listed:
                    self.add(
                        Rule.ROW_COUNT, file, row, "sources", "is empty; it takes 1 or more (F.0)"
                    )
                for at, locator in enumerate(self.strings(file, row, "sources", listed) or []):
                    self.locator(file, row, f"sources[{at}]", locator)

            members: frozenset[str] = frozenset()
            if product:
                codes = None
                if "sets" in region:
                    codes = self.strings(file, row, "sets", cast("list[Any]", region["sets"]))
                if codes is None:
                    families_sound = False
                else:
                    members = frozenset(codes)
                    for code in codes:
                        if code not in self.expected:
                            self.not_on_plane(file, row, "sets", code)
                        elif code in families:
                            self.add(
                                Rule.PRODUCT_SET_IN_TWO_FAMILIES,
                                file,
                                row,
                                "sets",
                                f"set {code!r} is also listed by {families[code]}; a set code "
                                "appears exactly once across the families (F.0)",
                            )
                        else:
                            families[code] = row
            if "id" in region and region["id"] not in regions:
                regions[region["id"]] = _Region(row=row, sets=members)

        if product and families_sound and "regions" in top:
            for code in self.expected:
                if code not in families:
                    self.add(
                        Rule.PRODUCT_SET_UNMAPPED,
                        file,
                        "",
                        "regions",
                        f"set {code!r} has first printings on {self.slug} and no family lists "
                        "it (F.0)",
                    )
        return regions

    def anchor(self, file: str, row: str, value: list[Any]) -> tuple[int, int] | None:
        if any(isinstance(member, Flaw) for member in value):
            return None
        if len(value) != 2 or not all(_is("integer", member) for member in value):
            self.add(
                Rule.WRONG_TYPE,
                file,
                row,
                "anchor",
                "must be [integer, integer], in thousandths (F.0)",
            )
            return None
        u, v = cast("list[int]", value)
        if u * u + v * v > DISC_RADIUS * DISC_RADIUS:
            self.add(
                Rule.ANCHOR_OUTSIDE_DISC,
                file,
                row,
                "anchor",
                f"[{u}, {v}] lies outside the unit disc: u^2 + v^2 is {u * u + v * v:,}, over "
                f"{DISC_RADIUS * DISC_RADIUS:,} (4.16.2)",
            )
            return None
        return u, v

    def separation(
        self, file: str, row: str, anchor: tuple[int, int], placed: list[tuple[str, int, int]]
    ) -> None:
        """4.16.2: anchors pairwise at least 150 apart. Compared squared, so no root decides."""
        u, v = anchor
        for other, ou, ov in placed:
            squared = (u - ou) ** 2 + (v - ov) ** 2
            if squared < MIN_ANCHOR_DISTANCE**2:
                self.add(
                    Rule.ANCHORS_TOO_CLOSE,
                    file,
                    row,
                    "anchor",
                    f"[{u}, {v}] is under {math.isqrt(squared) + 1} thousandths from the anchor "
                    f"[{ou}, {ov}] of {other}; two anchors are at least {MIN_ANCHOR_DISTANCE} "
                    "apart (4.16.2, 5.4.5)",
                )

    def not_on_plane(self, file: str, row: str, field: str, code: str) -> None:
        self.add(
            Rule.SET_NOT_ON_PLANE,
            file,
            row,
            field,
            f"set {code!r} has no first printings on {self.slug} in dataset {self.index.label}; "
            f"the plane's set codes are {', '.join(self.expected) or 'none'} (F.0)",
        )

    # --- eras.json -----------------------------------------------------------------------------

    def eras(self, document: dict[str, Any], regions: dict[str, _Region], product: bool) -> None:
        file = ERAS_FILE
        top = (
            self.shape(
                file,
                "",
                document,
                {"plane": "string", "kind": "string", "eras": "array"},
                {"accepted": "object"},
            )
            or {}
        )
        self.plane(file, document)
        rows = cast("list[Any]", top.get("eras", []))
        if "eras" in top:
            self.count(file, "eras", rows, PRODUCT_ERA_ROWS if product else ERA_ROWS, "rows")

        required: dict[str, _Kind] = {
            "id": "string",
            "name": "string",
            "years": "string",
            "region": "string",
            "sets": "array",
            "headline": "array",
            "paragraphs": "array",
        }
        ids: dict[str, str] = {}
        mapped: dict[str, str] = {}
        sets_sound = True
        for position, raw in enumerate(rows):
            row = _row("eras", position, raw)
            era = self.shape(file, row, raw, required)
            if era is None:
                sets_sound = False
                continue

            if "id" in era:
                self.slug_id(file, row, era["id"], ids)
            if "name" in era:
                self.name(file, row, "name", era["name"], ERA_NAME_CHARS)
            years = era.get("years")
            if years is not None:
                if not 1 <= _words(years) <= YEARS_WORDS:
                    self.add(
                        Rule.WORD_LIMIT,
                        file,
                        row,
                        "years",
                        f"has {_words(years)} words; the field takes 1 to {YEARS_WORDS} (F.0)",
                    )
                self.lint(file, row, "years", years)

            family = regions.get(era["region"]) if "region" in era else None
            if "region" in era and family is None:
                self.add(
                    Rule.ERA_REGION,
                    file,
                    row,
                    "region",
                    f"{era['region']!r} is not the id of a region in {REGIONS_FILE}; the ids are "
                    f"{', '.join(regions) or 'none'} (4.16.2)",
                )

            codes = None
            if "sets" in era:
                codes = self.strings(file, row, "sets", cast("list[Any]", era["sets"]))
            if codes is None:
                sets_sound = False
                codes = []
            elif not codes:
                self.add(Rule.ROW_COUNT, file, row, "sets", "is empty; an era names 1 or more sets")
            for code in codes:
                if code not in self.expected:
                    self.not_on_plane(file, row, "sets", code)
                elif code in mapped:
                    other = "this era, twice" if mapped[code] == row else mapped[code]
                    self.add(
                        Rule.SET_IN_TWO_ERAS,
                        file,
                        row,
                        "sets",
                        f"set {code!r} is also listed by {other}; a set appears in exactly one "
                        "era (4.16.2)",
                    )
                else:
                    mapped[code] = row
                if product and family is not None and code not in family.sets:
                    self.add(
                        Rule.PRODUCT_ERA_SET_OUTSIDE_FAMILY,
                        file,
                        row,
                        "sets",
                        f"set {code!r} is not in the sets of the era's family, {family.row} (F.2)",
                    )

            if "headline" in era:
                self.headline(file, row, cast("list[Any]", era["headline"]), frozenset(codes))
            if "paragraphs" in era:
                self.paragraphs(file, row, cast("list[Any]", era["paragraphs"]))

        if sets_sound and "eras" in top:
            for code in self.expected:
                if code not in mapped:
                    self.add(
                        Rule.SET_UNMAPPED,
                        file,
                        "",
                        "eras",
                        f"set {code!r} has first printings on {self.slug} in dataset "
                        f"{self.index.label} and no era lists it; every such set appears in "
                        "exactly one era (4.16.2)",
                    )

    def headline(self, file: str, row: str, values: list[Any], era_sets: frozenset[str]) -> None:
        if len(values) > HEADLINE_NAMES:
            self.add(
                Rule.ROW_COUNT,
                file,
                row,
                "headline",
                f"has {len(values)} names; it takes 0 to {HEADLINE_NAMES} (F.0)",
            )
        names = self.strings(file, row, "headline", values)
        if not names:
            return
        if self.spotlight_sets is not None and era_sets & self.spotlight_sets:
            carried = ", ".join(sorted(era_sets & self.spotlight_sets))
            self.add(
                Rule.HEADLINE_WITH_SPOTLIGHT,
                file,
                row,
                "headline",
                f"must be empty: the era's sets ({carried}) carry Story Spotlight cards, and "
                "those are the era's headline cards (F.0, 5.13.2)",
            )
        seen: set[str] = set()
        for position, name in enumerate(names):
            field = f"headline[{position}]"
            if name in seen:
                self.add(Rule.HEADLINE, file, row, field, f"{name!r} is listed twice")
                continue
            seen.add(name)
            candidates = [self.index.cards[oracle] for oracle in self.index.names.get(name, ())]
            here = [
                card
                for card in candidates
                if card.plane == self.slug and card.first_set in era_sets
            ]
            if len(here) == 1:
                continue
            if not candidates:
                why = f"no card of dataset {self.index.label} has that name"
            elif not here:
                where = "; ".join(
                    f"first printed in {card.first_set!r} on {card.plane}" for card in candidates
                )
                why = f"the card of that name is {where}"
            else:
                why = f"{len(here)} cards of the era carry that name"
            self.add(
                Rule.HEADLINE,
                file,
                row,
                field,
                f"{name!r} does not resolve to one card of {self.slug} first printed in the "
                f"era's sets: {why} (4.16.2)",
            )

    def paragraphs(self, file: str, row: str, values: list[Any]) -> None:
        if not PARAGRAPHS[0] <= len(values) <= PARAGRAPHS[1]:
            self.add(
                Rule.PARAGRAPH_COUNT,
                file,
                row,
                "paragraphs",
                f"has {len(values)} paragraphs; an era takes {PARAGRAPHS[0]} to {PARAGRAPHS[1]} "
                "(4.16.2)",
            )
        total = 0
        for at, paragraph in enumerate(values):
            field = f"paragraphs[{at}]"
            if isinstance(paragraph, Flaw):
                continue
            if not isinstance(paragraph, list):
                self.add(
                    Rule.WRONG_TYPE, file, row, field, "must be an array of sentence objects (F.0)"
                )
                continue
            sentences = cast("list[Any]", paragraph)
            if not SENTENCES[0] <= len(sentences) <= SENTENCES[1]:
                self.add(
                    Rule.SENTENCE_COUNT,
                    file,
                    row,
                    field,
                    f"has {len(sentences)} sentences; a paragraph takes {SENTENCES[0]} to "
                    f"{SENTENCES[1]} (4.16.2)",
                )
            for number, sentence in enumerate(sentences):
                total += self.sentence(file, row, f"{field}[{number}]", sentence)
        if total > ERA_WORDS:
            self.add(
                Rule.WORD_LIMIT,
                file,
                row,
                "paragraphs",
                f"has {total} words; an era takes at most {ERA_WORDS} (4.16.2)",
            )

    # --- keywords.json -------------------------------------------------------------------------

    def keywords(
        self, document: dict[str, Any], regions: dict[str, _Region], product: bool
    ) -> None:
        file = KEYWORDS_FILE
        top = self.shape(file, "", document, {"plane": "string", "keywords": "array"}) or {}
        self.plane(file, document)
        rows = cast("list[Any]", top.get("keywords", []))
        if product and rows:
            self.add(
                Rule.PRODUCT_KEYWORDS,
                file,
                "",
                "keywords",
                f"has {len(rows)} rows; a product table's keyword table is empty (4.16.2, F.3)",
            )
        seen: dict[str, str] = {}
        for position, raw in enumerate(rows):
            row = f"keywords[{position}]"
            keyword = self.shape(file, row, raw, {"word": "string", "region": "string"})
            if keyword is None:
                continue
            word = keyword.get("word")
            if word is not None:
                row = f'{row} "{word}"'
                if len(word) < KEYWORD_CHARS:
                    self.add(
                        Rule.KEYWORD,
                        file,
                        row,
                        "word",
                        f"is {len(word)} characters; a keyword is at least {KEYWORD_CHARS} "
                        "(4.16.2)",
                    )
                folded = word.casefold()
                if folded in seen:
                    self.add(
                        Rule.KEYWORD_DUPLICATE,
                        file,
                        row,
                        "word",
                        f"is also the word of {seen[folded]}; a word maps to exactly one region "
                        "(F.3)",
                    )
                else:
                    seen[folded] = row
            if "region" in keyword and keyword["region"] not in regions:
                self.add(
                    Rule.KEYWORD_REGION,
                    file,
                    row,
                    "region",
                    f"{keyword['region']!r} is not the id of a region in {REGIONS_FILE}; the ids "
                    f"are {', '.join(regions) or 'none'} (4.16.2)",
                )


def is_date(text: str) -> bool:
    """``YYYY-MM-DD``, and a day the calendar has."""
    if not _DATE.fullmatch(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True
