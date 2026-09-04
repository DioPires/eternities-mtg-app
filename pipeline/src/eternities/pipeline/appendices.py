"""The three curated inputs of PRD 7.7.1: Appendix A, Appendix B, and ``overrides.json``.

Everything else the pipeline knows is derived. These files are loaded once, validated against each
other, and then treated as read-only: a plane slug that does not exist, or a duplicate set code,
fails the run here rather than producing a quietly wrong dataset (PRD 4.6).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

DATA_DIR: Final = Path(__file__).resolve().parents[3] / "data"
APPENDIX_A: Final = DATA_DIR / "appendix_a.json"
APPENDIX_B: Final = DATA_DIR / "appendix_b.json"
OVERRIDES: Final = DATA_DIR / "overrides.json"

BLIND_ETERNITIES: Final = "blind-eternities"


@dataclass(frozen=True, slots=True)
class PlaneEntry:
    """One Appendix A row: the canonical roster (PRD 4.7)."""

    slug: str
    display_name: str
    notes: str


@dataclass(frozen=True, slots=True)
class SetEntry:
    """One Appendix B row (PRD 4.1.4).

    ``plane`` is ``None`` exactly when the row is Universes Beyond or explicitly excluded; those
    rows exist so 4.3.1 can drop their printings and 4.4.3 can recognise a card that originates
    there, not to assign a plane.
    """

    code: str
    name: str
    plane: str | None
    universes_beyond: bool
    excluded: bool
    notes: str
    prd_section: str
    prd_verify: bool
    prd_name: str
    prd_date: str
    corrected_from: str | None

    @property
    def drops_printings(self) -> bool:
        """PRD 4.3.1: a Universes Beyond or excluded row drops every printing in its set."""
        return self.universes_beyond or self.excluded


@dataclass(frozen=True, slots=True)
class SecretLairRule:
    """PRD Appendix B.4, expressed as a rule rather than a row list.

    The known codes drift with every drop, so the appendix states a predicate — code prefix plus
    name substring — and one exemption (``slx``, Universes Within, which is in-universe).
    """

    code_prefix: str
    name_contains: str
    exempt_codes: frozenset[str]

    def matches(self, code: str, name: str) -> bool:
        if code in self.exempt_codes:
            return False
        return code.startswith(self.code_prefix) and self.name_contains.lower() in name.lower()


@dataclass(frozen=True, slots=True)
class Appendices:
    planes: tuple[PlaneEntry, ...]
    sets: tuple[SetEntry, ...]
    secret_lair: SecretLairRule
    overrides: dict[str, str]
    """Card name -> plane slug (PRD 4.1.5, 4.6.1)."""

    def __post_init__(self) -> None:
        slugs = [p.slug for p in self.planes]
        _reject_duplicates(slugs, "Appendix A plane slug")
        if BLIND_ETERNITIES not in slugs:
            raise ValueError(f"Appendix A must contain {BLIND_ETERNITIES!r} (PRD 4.7.3)")
        _reject_duplicates([s.code for s in self.sets], "Appendix B set code")

        known = set(slugs)
        # PRD 4.6: "Every plane referenced by Appendix B or overrides.json must exist in
        # Appendix A; violations fail the pipeline."
        for entry in self.sets:
            if entry.plane is not None and entry.plane not in known:
                raise ValueError(
                    f"Appendix B row {entry.code!r} maps to plane {entry.plane!r}, "
                    "which is not in Appendix A (PRD 4.6)"
                )
            if entry.plane is None and not entry.drops_printings:
                raise ValueError(
                    f"Appendix B row {entry.code!r} has no plane and is not flagged "
                    "universes_beyond or excluded; every in-universe row needs a plane (PRD 4.6.2)"
                )
        for name, slug in sorted(self.overrides.items()):
            if slug not in known:
                raise ValueError(
                    f"overrides.json maps {name!r} to plane {slug!r}, "
                    "which is not in Appendix A (PRD 4.6)"
                )

    @property
    def plane_slugs(self) -> tuple[str, ...]:
        return tuple(p.slug for p in self.planes)

    def by_code(self) -> dict[str, SetEntry]:
        return {s.code: s for s in self.sets}


def _reject_duplicates(values: list[str], label: str) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    if duplicates:
        raise ValueError(f"duplicate {label}: {sorted(duplicates)}")


def _read_json(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))


def load_appendices(
    appendix_a: Path = APPENDIX_A,
    appendix_b: Path = APPENDIX_B,
    overrides: Path = OVERRIDES,
) -> Appendices:
    """Load and cross-validate the curated inputs."""
    a = _read_json(appendix_a)
    b = _read_json(appendix_b)
    o = _read_json(overrides)

    planes = tuple(
        PlaneEntry(
            slug=str(row["slug"]),
            display_name=str(row["displayName"]),
            notes=str(row.get("notes", "")),
        )
        for row in cast("list[dict[str, Any]]", a["planes"])
    )
    sets = tuple(
        SetEntry(
            code=str(row["code"]),
            name=str(row["name"]),
            plane=None if row.get("plane") is None else str(row["plane"]),
            universes_beyond=bool(row.get("universesBeyond", False)),
            excluded=bool(row.get("excluded", False)),
            notes=str(row.get("notes", "")),
            prd_section=str(row.get("prdSection", "")),
            prd_verify=bool(row.get("prdVerify", False)),
            prd_name=str(row.get("prdName", row["name"])),
            prd_date=str(row.get("prdDate", "")),
            corrected_from=(
                None if row.get("correctedFrom") is None else str(row["correctedFrom"])
            ),
        )
        for row in cast("list[dict[str, Any]]", b["sets"])
    )
    rule = cast("dict[str, Any]", b["secretLairRule"])
    secret_lair = SecretLairRule(
        code_prefix=str(rule["codePrefix"]),
        name_contains=str(rule["nameContains"]),
        exempt_codes=frozenset(str(c) for c in cast("list[Any]", rule["exemptCodes"])),
    )
    override_map = {str(k): str(v) for k, v in cast("dict[str, Any]", o["overrides"]).items()}
    return Appendices(planes=planes, sets=sets, secret_lair=secret_lair, overrides=override_map)
