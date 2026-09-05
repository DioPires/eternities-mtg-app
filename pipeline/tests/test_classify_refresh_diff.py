"""The refresh diff classifier, pinned at the two blind spots DEC-668 found.

The script is a reading aid for the human review step in `docs/refresh-runbook.md` §3, not a gate,
so it had no tests — and that is exactly how it shipped unable to see a card changing plane. A card
can move between shards without a single byte of the card itself changing, and the review that
found this moved one `alara` -> `abyss` and watched the script print the clean baseline in all six
numbers while two shard files sat in the diff.

That is the one class of change PRD 9.2.3 exists to catch, and the runbook documents the run where
9.2.3 prints no number at all (a contract bump leaves one run with no decodable predecessor). In
that run this script is the only reconciliation there is.

The datasets here are hand-written and tiny; the real pair is exercised by hand per the runbook.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "pipeline" / "scripts" / "classify-refresh-diff.py"


def _load_script() -> Any:
    # The file name is hyphenated, so it is a path import rather than a module import.
    spec = importlib.util.spec_from_file_location("classify_refresh_diff", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


classifier = _load_script()


def card(oracle_id: str = "card-1", name: str = "Test Card", **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "u": oracle_id,
        "n": name,
        "m": "{1}",
        "t": "Artifact",
        "o": "",
        "b": None,
        "ci": "",
        "r": 1,
        "l": "normal",
        "p": [["printing-1", 7, "c", 1783903215, "1"]],
    }
    base.update(overrides)
    return base


def write_dataset(root: Path, shards: dict[str, list[dict[str, Any]]]) -> Path:
    (root / "planes").mkdir(parents=True)
    for index, (slug, cards) in enumerate(sorted(shards.items())):
        payload = {
            "contractVersion": 2,
            "slug": slug,
            "shard": 0,
            "shardSize": 2000,
            "starOffset": index * 2000,
            "cards": cards,
        }
        (root / "planes" / f"{slug}.0.json").write_text(json.dumps(payload, separators=(",", ":")))
    return root


def buckets(capsys: Any, old: Path, new: Path) -> tuple[dict[str, int], str]:
    classifier.classify(old, new)
    out = capsys.readouterr().out
    rows = {
        "added": r"cards added:\s+(\d+)",
        "removed": r"cards removed:\s+(\d+)",
        "changed": r"cards changed:\s+(\d+)",
        "cache_buster": r"image cache-buster only:\s+(\d+) card",
        "printing_count": r"printing added or removed:\s+(\d+)",
        "field": r"non-printing field changed:\s+(\d+)",
        "printing_other": r"printing changed otherwise:\s+(\d+)",
        "plane": r"card changed plane:\s+(\d+)",
    }
    found: dict[str, int] = {}
    for key, pattern in rows.items():
        match = re.search(pattern, out)
        assert match is not None, f"no `{key}` row in output:\n{out}"
        found[key] = int(match.group(1))
    return found, out


def test_identical_datasets_report_nothing(tmp_path: Path, capsys: Any) -> None:
    """The control. Without it, a classifier that shouts on everything would pass the rest."""
    shards = {"alara": [card()], "abyss": [card("card-2", "Other Card")]}
    old = write_dataset(tmp_path / "old", shards)
    new = write_dataset(tmp_path / "new", shards)

    found, _ = buckets(capsys, old, new)

    assert [found[k] for k in ("added", "removed", "changed", "plane")] == [0, 0, 0, 0]
    assert found["printing_other"] == 0


def test_byte_identical_plane_move_is_reported(tmp_path: Path, capsys: Any) -> None:
    """DEC-668 B2: the card does not change at all — only the shard holding it does."""
    moved = card()
    old = write_dataset(tmp_path / "old", {"alara": [moved], "abyss": []})
    new = write_dataset(tmp_path / "new", {"alara": [], "abyss": [moved]})

    found, out = buckets(capsys, old, new)

    assert found["plane"] == 1
    assert found["changed"] == 1
    # Not miscounted as the card set moving, and not silently swallowed by a quieter bucket.
    assert [found[k] for k in ("added", "removed", "cache_buster", "field")] == [0, 0, 0, 0]
    assert "Test Card: alara -> abyss" in out


def test_plane_move_outranks_a_field_change(tmp_path: Path, capsys: Any) -> None:
    """A move that also edits the card is still a move. Loudest bucket wins."""
    old = write_dataset(tmp_path / "old", {"alara": [card()], "abyss": []})
    new = write_dataset(tmp_path / "new", {"alara": [], "abyss": [card(name="Renamed Card")]})

    found, _ = buckets(capsys, old, new)

    assert found["plane"] == 1
    assert found["field"] == 0
    assert found["changed"] == 1


def test_field_change_does_not_hide_a_printing_change(tmp_path: Path, capsys: Any) -> None:
    """DEC-668 N1: `printing changed otherwise` is the row the runbook says to read.

    Before this, the field-change branch ended the comparison, so a printing that changed beyond
    its cache-buster on the same card left that row reading zero.
    """
    old = write_dataset(tmp_path / "old", {"alara": [card()]})
    odd = card(name="Renamed Card", p=[["printing-1", 99, "c", 1783903215, "1"]])
    new = write_dataset(tmp_path / "new", {"alara": [odd]})

    found, _ = buckets(capsys, old, new)

    assert found["field"] == 1
    assert found["printing_other"] == 1
    # One card, two symptoms: the summary must not double-count it.
    assert found["changed"] == 1


def test_cache_buster_only_stays_in_its_own_bucket(tmp_path: Path, capsys: Any) -> None:
    """The routine case the 2026-09-05 rehearsal was made of, kept honest against the above."""
    old = write_dataset(tmp_path / "old", {"alara": [card()]})
    restamped = card(p=[["printing-1", 7, "c", 1783999999, "1"]])
    new = write_dataset(tmp_path / "new", {"alara": [restamped]})

    found, _ = buckets(capsys, old, new)

    assert found["cache_buster"] == 1
    assert [found[k] for k in ("changed", "field", "printing_other", "plane")] == [1, 0, 0, 0]


def test_duplicate_oracle_id_is_reported(tmp_path: Path, capsys: Any) -> None:
    """DEC-668 N9. Last shard still wins; it just stops doing it silently.

    With the slug now load-bearing, a card in two shards at once could otherwise read as a plane
    move that never happened.
    """
    root = write_dataset(tmp_path / "one", {"alara": [card()], "abyss": [card()]})

    slug, _ = classifier.load_shards(root)["card-1"]

    assert slug == "alara"  # sorted order: abyss loads first, alara wins
    assert "appears in both abyss and alara" in capsys.readouterr().err


def test_load_shards_returns_the_slug(tmp_path: Path) -> None:
    """The docstring's promise, pinned: the slug has to leave the function."""
    root = write_dataset(tmp_path / "one", {"alara": [card()]})

    loaded = classifier.load_shards(root)

    slug, loaded_card = loaded["card-1"]
    assert slug == "alara"
    assert loaded_card["n"] == "Test Card"
