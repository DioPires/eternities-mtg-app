"""The acceptance digest and the acceptance status of PRD v4 Appendix F.2.

The owner accepts one exact table set, and the digest is how the acceptance names it: the SHA-256
of the three files' **canonical form**, concatenated in the order regions, eras, keywords, with the
``accepted`` member taken out of ``eras.json`` first (the record cannot hash itself). Any edit to
any value, any re-ordering of an array and any change to a source moves the digest; white space and
the order of an object's keys do not.

Only the pipeline computes the digest, and :func:`canonical` is the one serialiser F.2 names.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from pathlib import Path
from typing import Any, Final, cast

from . import strict_json

FILES: Final = ("regions.json", "eras.json", "keywords.json")
"""The three tables, in the order the digest reads them."""

DIGEST_PREFIX: Final = "sha256:"


class DigestError(ValueError):
    """The digest of a directory is undefined: a file is missing, is not JSON or breaks F.0."""


class AcceptanceStatus(StrEnum):
    """F.2: reported on every run; only ``--distribution`` enforces it (4.16.5)."""

    ACCEPTED = "accepted"
    STALE = "stale"
    ABSENT = "absent"


def canonical(value: Any) -> str:
    """F.2's canonical form: keys sorted by code point, no white space, UTF-8 written as itself."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_of(regions: Any, eras: Any, keywords: Any) -> str:
    """The digest of three parsed tables. ``accepted`` is removed from ``eras`` here."""
    if isinstance(eras, dict):
        document = cast("dict[str, Any]", eras)
        eras = {key: member for key, member in document.items() if key != "accepted"}
    text = canonical(regions) + canonical(eras) + canonical(keywords)
    return DIGEST_PREFIX + hashlib.sha256(text.encode("utf-8")).hexdigest()


def digest_of_directory(directory: Path) -> str:
    """The digest of a lore directory, for ``eternities lore digest``.

    The files must be the JSON of F.0, because the canonical form has one spelling per value only
    there. The other rules of 4.16.2 are not applied: a digest names bytes, and validity is
    ``eternities lore validate``'s question.
    """
    parsed: list[Any] = []
    for name in FILES:
        path = directory / name
        if not path.exists():
            raise DigestError(f"{path} does not exist")
        try:
            value = strict_json.load(path)
        except strict_json.NotJsonError as error:
            raise DigestError(f"{path}: {error}") from None
        found = strict_json.flaws(value)
        if found:
            where, flaw = found[0]
            raise DigestError(f"{path}: {where}: {flaw.message}")
        surrogates = strict_json.lone_surrogates(value)
        if surrogates:
            raise DigestError(f"{path}: {surrogates[0]}: holds half of a surrogate pair")
        parsed.append(value)
    return digest_of(*parsed)


def status_of(recorded: str | None, computed: str) -> AcceptanceStatus:
    """``recorded`` is the ``accepted`` record's digest, or ``None`` when there is no record."""
    if recorded is None:
        return AcceptanceStatus.ABSENT
    return AcceptanceStatus.ACCEPTED if recorded == computed else AcceptanceStatus.STALE
