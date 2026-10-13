"""Read a lore table as the JSON of Appendix F.0, where every number has one spelling.

PRD v4 Appendix F.0: "Every number in the three files is an integer (anchors and weights in
thousandths); a fraction, an exponent, a leading plus or a negative zero fails validation, so the
canonical form of F.2 has exactly one spelling for every value." ``json.loads`` accepts three of
the four and would hand the digest a float, so this reader keeps what the standard parser would
have smoothed over:

- a fraction or an exponent (``1.5``, ``1e3``, ``1.0``) and a negative zero (``-0``) are read as a
  :class:`Flaw` that stands where the number stood, so the validator names its row and field;
- a leading plus (``+1``) and a leading zero (``01``) are not JSON at all, and fail the read with
  the line and the column;
- a field written twice in one object is a :class:`Flaw` too: the standard parser keeps the last
  and drops the first, and a dropped value is not in the digest.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast


@dataclass(frozen=True, slots=True)
class Flaw:
    """A value F.0 forbids, standing where it was written."""

    duplicate: bool
    message: str


class NotJsonError(ValueError):
    """The file is not UTF-8 JSON. The message says where."""


def _float(literal: str) -> Flaw:
    return Flaw(
        duplicate=False,
        message=f"{literal} is not an integer in plain decimal: no fraction and no exponent (F.0)",
    )


def _int(literal: str) -> int | Flaw:
    if literal == "-0":
        return Flaw(duplicate=False, message="-0 is a negative zero; write 0 (F.0)")
    return int(literal)


def _constant(literal: str) -> Flaw:
    return Flaw(duplicate=False, message=f"{literal} is not a JSON number (F.0)")


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            out[key] = Flaw(duplicate=True, message="the field is written twice in one object")
        else:
            out[key] = value
    return out


def loads(text: str) -> Any:
    """Parse ``text``; forbidden values come back as :class:`Flaw` objects in the tree."""
    try:
        return json.loads(
            text,
            parse_float=_float,
            parse_int=_int,
            parse_constant=_constant,
            object_pairs_hook=_object,
        )
    except json.JSONDecodeError as error:
        hint = ""
        if text[error.pos : error.pos + 1] == "+":
            hint = "; a number has a leading plus (F.0)"
        raise NotJsonError(
            f"not valid JSON at line {error.lineno} column {error.colno}: {error.msg}{hint}"
        ) from None


def load(path: Path) -> Any:
    try:
        text = path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as error:
        raise NotJsonError(f"not UTF-8 at byte {error.start}") from None
    return loads(text)


def flaws(value: Any, path: str = "") -> list[tuple[str, Flaw]]:
    """Every :class:`Flaw` in a parsed tree, with the path to it (``regions[2].weight``)."""
    if isinstance(value, Flaw):
        return [(path, value)]
    found: list[tuple[str, Flaw]] = []
    if isinstance(value, dict):
        for key, member in cast("dict[str, Any]", value).items():
            found.extend(flaws(member, f"{path}.{key}" if path else key))
    elif isinstance(value, list):
        for position, member in enumerate(cast("list[Any]", value)):
            found.extend(flaws(member, f"{path}[{position}]"))
    return found


def lone_surrogates(value: Any, path: str = "") -> list[str]:
    """The path of every string that is not text: one holding half of a surrogate pair.

    ``"\\ud800"`` is legal JSON and reads as a string UTF-8 cannot write, so the canonical form of
    F.2, which is UTF-8, has no bytes for it.
    """
    found: list[str] = []
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            found.append(path)
    elif isinstance(value, dict):
        for key, member in cast("dict[str, Any]", value).items():
            found.extend(lone_surrogates(key, f"{path}.{key!r}" if path else repr(key)))
            found.extend(lone_surrogates(member, f"{path}.{key}" if path else key))
    elif isinstance(value, list):
        for position, member in enumerate(cast("list[Any]", value)):
            found.extend(lone_surrogates(member, f"{path}[{position}]"))
    return found
