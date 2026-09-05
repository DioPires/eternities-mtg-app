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


def test_plane_move_does_not_hide_a_field_change(tmp_path: Path, capsys: Any) -> None:
    """DEC-673 N1: a move that also edits the card is reported as both, not just the louder one.

    Until N1 the plane-move branch ended the comparison, so the rename here left the field row
    reading zero. `cards changed` counts oracle ids, so the card is still counted once across the
    two rows it now appears in.
    """
    old = write_dataset(tmp_path / "old", {"alara": [card()], "abyss": []})
    new = write_dataset(tmp_path / "new", {"alara": [], "abyss": [card(name="Renamed Card")]})

    found, _ = buckets(capsys, old, new)

    assert found["plane"] == 1
    assert found["field"] == 1
    assert found["changed"] == 1


def test_plane_move_does_not_hide_a_printing_change(tmp_path: Path, capsys: Any) -> None:
    """DEC-673 N1, the case that motivated it.

    `printing changed otherwise` is the row the runbook tells the operator to read, and the runbook
    also tells them every `card changed plane` row should trace to an appendix edit they made. In
    the run where it does trace, they wave the move through — so a genuine Scryfall anomaly on that
    same card must not be riding along in a row that reads zero.
    """
    moved = card()
    odd = card(p=[["printing-1", 99, "c", 1783903215, "1"]])
    old = write_dataset(tmp_path / "old", {"alara": [moved], "abyss": []})
    new = write_dataset(tmp_path / "new", {"alara": [], "abyss": [odd]})

    found, out = buckets(capsys, old, new)

    assert found["plane"] == 1
    assert found["printing_other"] == 1
    # The move is a real move and the anomaly is a real anomaly; neither is invented by the other.
    assert [found[k] for k in ("changed", "field", "cache_buster")] == [1, 0, 0]
    assert "Test Card: alara -> abyss" in out


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

    DEC-673 N5 puts this on **stdout**. The runbook has the operator paste the classifier output
    into the pull request; on stderr a redirect carried the phantom move and dropped the warning
    that disqualifies it.
    """
    root = write_dataset(tmp_path / "one", {"alara": [card()], "abyss": [card()]})

    slug, _ = classifier.load_shards(root)["card-1"]

    assert slug == "alara"  # sorted order: abyss loads first, alara wins
    captured = capsys.readouterr()
    assert "appears in both abyss and alara" in captured.out
    assert captured.err == ""


def test_duplicate_is_reported_beside_the_plane_move_it_disqualifies(
    tmp_path: Path, capsys: Any
) -> None:
    """DEC-673 N5, through `classify` rather than `load_shards`.

    The dangerous duplicate is one in a shard sorting *after* the true one, because that is when
    last-shard-wins flips the answer and invents the move. Both must reach the same stream, and the
    warning has to come after the row it is about or a reader who stops at the list never sees it.
    """
    old = write_dataset(tmp_path / "old", {"alara": [card()], "amonkhet": []})
    # `card-1` now sits in both shards; `amonkhet` sorts last, so it takes the card.
    new = write_dataset(tmp_path / "new", {"alara": [card()], "amonkhet": [card()]})

    found, out = buckets(capsys, old, new)

    assert found["plane"] == 1  # the phantom move
    assert capsys.readouterr().err == ""
    assert "appears in both alara and amonkhet" in out
    # The warning is useless to an operator who is not told what it costs them, so pin the reason
    # and not just the message.
    assert "duplicate oracle ids (1) — each can fake a plane move above" in out
    # After the move it disqualifies, not before it and not on another stream.
    assert out.index("Test Card: alara -> amonkhet") < out.index("appears in both")


def test_cache_buster_bucket_excludes_a_card_whose_fields_also_moved(
    tmp_path: Path, capsys: Any
) -> None:
    """DEC-673 N3: the `not fields_changed` guard, which is what makes the accounting safe.

    A card that was re-stamped *and* edited is not "cache-buster only" — but its tuples are still
    real cache-buster tuples and must stay in the tuple total, which is the whole point of counting
    tuples separately from cards. Without the guard this card lands in both rows and the bucket
    entries outnumber the changed cards.
    """
    old = write_dataset(tmp_path / "old", {"alara": [card()]})
    both = card(t="Enchantment", p=[["printing-1", 7, "c", 1783999999, "1"]])
    new = write_dataset(tmp_path / "new", {"alara": [both]})

    found, out = buckets(capsys, old, new)

    assert found["field"] == 1
    assert found["cache_buster"] == 0
    # The tuple still counts, on the same row whose card count excludes it.
    assert re.search(r"image cache-buster only:\s+0 card\(s\), 1 printing tuple\(s\)", out)
    assert found["changed"] == 1


def test_plane_move_does_not_exclude_a_card_from_the_cache_buster_bucket(
    tmp_path: Path, capsys: Any
) -> None:
    """DEC-681 N1, the behaviour behind the module docstring's corrected sentence.

    The `card(s)` figure on the cache-buster row is filtered by the card's own contents — a field
    change, a printing-count change or a printing anomaly keeps it out. A plane move is not about
    the card's contents, so it does not: a card that moved shard and was only re-stamped is a real
    cache-buster card *and* a real plane move, and is counted in both rows.

    Before DEC-678 removed the plane-move `continue` this could not happen, which is why the
    docstring said "sole symptom" and why that stopped being true.
    """
    old = write_dataset(tmp_path / "old", {"alara": [card()], "abyss": []})
    restamped = card(p=[["printing-1", 7, "c", 1783999999, "1"]])
    new = write_dataset(tmp_path / "new", {"alara": [], "abyss": [restamped]})

    found, out = buckets(capsys, old, new)

    assert found["plane"] == 1
    assert found["cache_buster"] == 1
    assert re.search(r"image cache-buster only:\s+1 card\(s\), 1 printing tuple\(s\)", out)
    # One card with two symptoms, counted once overall and reported in both rows.
    assert found["changed"] == 1
    assert [found[k] for k in ("field", "printing_other", "printing_count")] == [0, 0, 0]
    # `main` prints the module docstring as its usage text, so the stale claim was operator-facing.
    # This only blocks the exact sentence that was reviewed and found false; a fresh wording that
    # is false in some new way is on the reader, not on this assertion.
    assert "*sole* symptom" not in classifier.__doc__


def test_cache_buster_bucket_excludes_a_card_with_a_printing_anomaly(
    tmp_path: Path, capsys: Any
) -> None:
    """DEC-681 N2: the `only_stamp` conjunct, the one of the three that had no test.

    Two printings on one card: the first is re-stamped, the second changes its set. That single
    anomaly is enough to disqualify the card from "cache-buster only" even though the other tuple
    really is cache-buster churn — so the row reads `0 card(s), 1 printing tuple(s)` beside a
    `printing changed otherwise` of 1. Without `only_stamp` the card would be advertised as
    ignorable noise on the same line that the anomaly is reported on.
    """
    was = card(p=[["printing-1", 7, "c", 1783903215, "1"], ["printing-2", 8, "u", 1783903215, "2"]])
    # First tuple: cache-buster only. Second: same printing id, different set — a real anomaly.
    now = card(
        p=[["printing-1", 7, "c", 1783999999, "1"], ["printing-2", 99, "u", 1783903215, "2"]]
    )
    old = write_dataset(tmp_path / "old", {"alara": [was]})
    new = write_dataset(tmp_path / "new", {"alara": [now]})

    found, out = buckets(capsys, old, new)

    assert found["printing_other"] == 1
    assert found["cache_buster"] == 0
    # The re-stamped tuple is still counted, on the row whose card count excludes it.
    assert re.search(r"image cache-buster only:\s+0 card\(s\), 1 printing tuple\(s\)", out)
    # Nothing else fired: this is `only_stamp` doing the work, not one of the other two conjuncts.
    assert [found[k] for k in ("changed", "field", "printing_count", "plane")] == [1, 0, 0, 0]


def test_duplicate_count_is_oracle_ids_not_warning_lines(tmp_path: Path, capsys: Any) -> None:
    """DEC-681 N3. One duplicate, two datasets, one id — the header has to say 1.

    `classify` collects from both `load_shards` calls into one list, so a duplicate that persists
    across a refresh (the likeliest real one: nobody fixes the appendix between the two runs)
    produces two lines. Counting lines makes that read identically to two different ids being
    duplicated, and the header's own label says it counts ids.
    """
    shards = {"alara": [card()], "amonkhet": [card()]}
    old = write_dataset(tmp_path / "old", shards)
    new = write_dataset(tmp_path / "new", shards)

    _, out = buckets(capsys, old, new)

    assert "duplicate oracle ids (1) — each can fake a plane move above" in out
    # Both lines still print: the count is de-duplicated, the evidence is not. Each names its own
    # dataset, so an operator can tell which run to go and look at.
    assert "warning: old: Test Card appears in both alara and amonkhet" in out
    assert "warning: new: Test Card appears in both alara and amonkhet" in out


def test_two_duplicated_ids_count_as_two(tmp_path: Path, capsys: Any) -> None:
    """The other half of DEC-681 N3: de-duplicating must not collapse distinct ids to one.

    Without this, a header hard-wired to 1 — or one counting `len(set(messages))` on lines that
    happen to share a dataset — passes the test above.
    """
    other = card("card-2", "Other Card")
    both = write_dataset(tmp_path / "old", {"alara": [card(), other], "amonkhet": [card(), other]})
    new = write_dataset(tmp_path / "new", {"alara": [card(), other]})

    _, out = buckets(capsys, both, new)

    assert "duplicate oracle ids (2) — each can fake a plane move above" in out
    assert "Test Card appears in both alara and amonkhet" in out
    assert "Other Card appears in both alara and amonkhet" in out


def test_shard_without_a_slug_falls_back_to_the_file_name(tmp_path: Path) -> None:
    """DEC-673 N4: the `<slug>.<n>.json` fallback, which no real dataset has ever exercised.

    All 93 shards in both the old and new 2026-09-05 datasets carry a `slug` equal to their file
    name stem, so this is belt-and-braces against a contract that has not moved. It is also the
    only thing standing between a slug-less shard and every card in it reading as a plane move.
    """
    root = tmp_path / "one"
    (root / "planes").mkdir(parents=True)
    payload = {"contractVersion": 2, "shard": 0, "shardSize": 2000, "cards": [card()]}
    (root / "planes" / "alara.0.json").write_text(json.dumps(payload, separators=(",", ":")))

    slug, _ = classifier.load_shards(root)["card-1"]

    assert slug == "alara"


def test_load_shards_returns_the_slug(tmp_path: Path) -> None:
    """The docstring's promise, pinned: the slug has to leave the function."""
    root = write_dataset(tmp_path / "one", {"alara": [card()]})

    loaded = classifier.load_shards(root)

    slug, loaded_card = loaded["card-1"]
    assert slug == "alara"
    assert loaded_card["n"] == "Test Card"
