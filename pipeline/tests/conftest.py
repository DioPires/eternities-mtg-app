"""Shared builders for the pipeline tests.

Every stage of PRD 8.2 is a pure function over tables, so the tests build those tables by hand
rather than downloading anything. ``printing()`` and ``scry_set()`` default to a plain, included
in-universe printing; each test overrides only the field whose rule it is exercising.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, NoReturn, cast

import pytest

from eternities.pipeline.appendices import (
    Appendices,
    PlaneEntry,
    SecretLairRule,
    SetEntry,
)
from eternities.pipeline.records import RawPrinting, ScrySet

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPO_ROOT / "web" / "public" / "data"
DATASETS_FILE = REPO_ROOT / "web" / "datasets.json"


def printing(
    oracle_id: str = "card-1",
    *,
    printing_id: str | None = None,
    name: str = "Test Card",
    set_code: str = "tst",
    released_at: str = "2000-01-01",
    rarity: str = "common",
    layout: str = "normal",
    lang: str = "en",
    promo: bool = False,
    digital: bool = False,
    oversized: bool = False,
    security_stamp: str | None = None,
    flavor_name: str | None = None,
    content_warning: bool = False,
    collector_number: str = "1",
    image_ts: int = 1700000000,
    is_meld_result: bool = False,
) -> RawPrinting:
    return RawPrinting(
        id=printing_id or f"{oracle_id}-{set_code}-{collector_number}",
        oracle_id=oracle_id,
        card_name=name,
        set_code=set_code,
        released_at=released_at,
        rarity=rarity,
        layout=layout,
        lang=lang,
        promo=promo,
        digital=digital,
        oversized=oversized,
        security_stamp=security_stamp,
        flavor_name=flavor_name,
        content_warning=content_warning,
        collector_number=collector_number,
        image_ts=image_ts,
        is_meld_result=is_meld_result,
    )


def scry_set(
    code: str = "tst",
    *,
    name: str | None = None,
    released_at: str = "2000-01-01",
    set_type: str = "expansion",
    parent_set_code: str | None = None,
    digital: bool = False,
) -> ScrySet:
    return ScrySet(
        code=code,
        name=name or f"Set {code}",
        released_at=released_at,
        set_type=set_type,
        parent_set_code=parent_set_code,
        digital=digital,
    )


def set_entry(
    code: str = "tst",
    *,
    plane: str | None = "dominaria",
    universes_beyond: bool = False,
    excluded: bool = False,
) -> SetEntry:
    return SetEntry(
        code=code,
        name=f"Set {code}",
        plane=None if (universes_beyond or excluded) else plane,
        universes_beyond=universes_beyond,
        excluded=excluded,
        notes="",
        prd_section="B.1",
        prd_verify=False,
        prd_name=f"Set {code}",
        prd_date="2000-01",
        corrected_from=None,
    )


def appendices(
    *,
    sets: list[SetEntry] | None = None,
    planes: list[str] | None = None,
    overrides: dict[str, str] | None = None,
) -> Appendices:
    slugs = planes or ["blind-eternities", "dominaria", "ravnica"]
    return Appendices(
        planes=tuple(PlaneEntry(slug=s, display_name=s.title(), notes="") for s in slugs),
        sets=tuple(sets if sets is not None else [set_entry()]),
        secret_lair=SecretLairRule(
            code_prefix="sl", name_contains="Secret Lair", exempt_codes=frozenset({"slx"})
        ),
        overrides=overrides or {},
    )


def _no_production_dataset(reason: str) -> NoReturn:
    """Skip locally, fail in CI.

    Locally a missing production dataset is an ordinary state: `eternities build` needs a 78 MB
    bulk file and nobody should have to download it to run the unit tests. In CI it is a defect —
    the 9.1.5 table, the four exclusions and the production invariant test are the gate PRD 9.1.4
    wants on every change, and a silent skip would let all of them disappear at once by losing one
    key in `datasets.json`.
    """
    if os.environ.get("CI"):
        pytest.fail(f"{reason} — PRD 9.1.5 must run in CI, not skip")
    pytest.skip(reason)


@pytest.fixture(scope="session")
def production_dir() -> Path:
    """The committed production dataset (see :func:`_no_production_dataset`)."""
    if not DATASETS_FILE.exists():
        _no_production_dataset("web/datasets.json is missing")
    registry = cast("dict[str, Any]", json.loads(DATASETS_FILE.read_text(encoding="utf-8")))
    name = registry.get("production")
    if not name:
        _no_production_dataset("no production dataset committed yet (run `eternities build`)")
    directory = DATA_ROOT / str(name)
    if not (directory / "manifest.json").exists():
        _no_production_dataset(f"production dataset {name} is not on disk")
    return directory


def read_json(path: Path) -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))
