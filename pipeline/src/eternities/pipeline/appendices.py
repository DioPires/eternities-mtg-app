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

from ..contract.enums import BLIND_ETERNITIES_SLUG

DATA_DIR: Final = Path(__file__).resolve().parents[3] / "data"
APPENDIX_A: Final = DATA_DIR / "appendix_a.json"
APPENDIX_B: Final = DATA_DIR / "appendix_b.json"
OVERRIDES: Final = DATA_DIR / "overrides.json"


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
    prd_verified: str | None = None
    """Date a run confirmed this ``prdVerify`` row against Scryfall, or ``None`` while it is open.

    ``prdVerify`` marks a row open question 10 asked the *first run* to confirm. Fifteen rows were
    confirmed on 2026-09-06 and every run since re-printed all fifteen in full, so the Q10 finding
    asked the reader to re-read a settled answer to find the one line that was not — the failure
    the roster finding had against open question 1 and ``prd_ratified`` fixed for corrections
    (review finding D8).

    Recording it does not stop the check: :func:`~eternities.pipeline.verify.verify_set_codes`
    still tests every row against Scryfall each run, and a verified row that stops matching is
    reported as a regression rather than collapsed into the count. What the date removes is the
    noise, not the guard."""
    prd_ratified: str | None = None
    """Date the PRD text took this row's correction, or ``None`` while it is still outstanding.

    Only meaningful alongside ``corrected_from``. It exists so the Q10 finding can stop asking for
    a PRD edit that has already been made, the same way the roster finding stopped re-asking open
    question 1 — a report whose job is to surface what needs a decision must not carry a settled
    one. A newly corrected row defaults to ``None``, so the ask reappears for the next correction.
    """

    @property
    def drops_printings(self) -> bool:
        """PRD 4.3.1: a Universes Beyond or excluded row drops every printing in its set."""
        return self.universes_beyond or self.excluded


@dataclass(frozen=True, slots=True)
class CardOverride:
    """One ``overrides.json`` record: a curated plane for one card (PRD 4.1.5, 4.6 rule 1).

    Keyed by ``oracle_id``, not by card name. A front-face name is not an identifier — Scryfall
    reuses one across distinct cards, and every such pair would move together under a single
    curated line — while ``oracle_id`` is what the rest of the pipeline already joins on: stage 3
    excludes by it, stage 4 chooses one first printing per it, and the encoder writes it into
    every artefact.

    ``card_name`` is kept anyway, because the file is curated by a human reading it and a bare
    list of UUIDs is unreviewable. It is therefore an *assertion* rather than data:
    :func:`~eternities.pipeline.stages.assign_planes` fails the run when the oracle id no longer
    names this card, which is the drift a hand-maintained file accumulates.
    """

    oracle_id: str
    card_name: str
    plane: str
    why: str
    """Why this card moves. Curation is a judgement call; the reason belongs beside it, not in a
    commit message the next curator will not find."""


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
    overrides: dict[str, CardOverride]
    """``oracle_id`` -> the curated record (PRD 4.1.5, 4.6.1). See :class:`CardOverride`."""

    def __post_init__(self) -> None:
        slugs = [p.slug for p in self.planes]
        _reject_duplicates(slugs, "Appendix A plane slug")
        if BLIND_ETERNITIES_SLUG not in slugs:
            raise ValueError(f"Appendix A must contain {BLIND_ETERNITIES_SLUG!r} (PRD 4.7.3)")
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
        for oracle_id, override in sorted(self.overrides.items()):
            if override.plane not in known:
                raise ValueError(
                    f"overrides.json maps {override.card_name!r} ({oracle_id}) to plane "
                    f"{override.plane!r}, which is not in Appendix A (PRD 4.6)"
                )
            if not override.card_name:
                raise ValueError(
                    f"overrides.json record {oracle_id} has no `name`; the name is the assertion "
                    "that makes the record reviewable (see CardOverride)"
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
            prd_verified=(None if row.get("prdVerified") is None else str(row["prdVerified"])),
            prd_ratified=(None if row.get("prdRatified") is None else str(row["prdRatified"])),
        )
        for row in cast("list[dict[str, Any]]", b["sets"])
    )
    rule = cast("dict[str, Any]", b["secretLairRule"])
    secret_lair = SecretLairRule(
        code_prefix=str(rule["codePrefix"]),
        name_contains=str(rule["nameContains"]),
        exempt_codes=frozenset(str(c) for c in cast("list[Any]", rule["exemptCodes"])),
    )
    return Appendices(
        planes=planes, sets=sets, secret_lair=secret_lair, overrides=_read_overrides(o, overrides)
    )


def _read_overrides(document: dict[str, Any], path: Path) -> dict[str, CardOverride]:
    """``overrides.json``'s ``overrides`` array, keyed by ``oracle_id``.

    The shape changed with the move off name keys (review finding D1). The old shape was a JSON
    *object* of ``name -> slug``; the new one is an array of records. An object here is therefore
    not a schema surprise to guess at, it is a file that predates the change, so it gets its own
    message naming the migration rather than a ``KeyError`` from the first record read.
    """
    raw = document["overrides"]
    if isinstance(raw, dict):
        raise ValueError(
            f"{path} uses the old name-keyed `overrides` object. It is now an array of records "
            "with `oracleId`, `name`, `plane` and `why` — a front-face name is not an identifier "
            "(review finding D1). Re-key the entries by Scryfall oracle_id."
        )
    result: dict[str, CardOverride] = {}
    for row in cast("list[dict[str, Any]]", raw):
        oracle_id = str(row["oracleId"])
        if oracle_id in result:
            raise ValueError(f"{path} carries two records for oracle_id {oracle_id}")
        result[oracle_id] = CardOverride(
            oracle_id=oracle_id,
            card_name=str(row["name"]),
            plane=str(row["plane"]),
            why=str(row.get("why", "")),
        )
    return result
