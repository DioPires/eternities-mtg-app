"""The composition `run.build` performs between the predecessor loader and the manifest.

Both halves were already pinned on their own — `load_previous_planes` returns an unreadable
predecessor rather than `None` (test_report.py), and `render` refuses to say "first production
run" when it is handed one (test_report.py) — and yet DEC-649 showed the whole chain could still
be broken with nothing failing: gate the manifest link on `previous.planes` in `run.build` and all
197 tests passed. The gap was the join, and that no test imported `build` at all.

So this module runs the real orchestrator, end to end, over a hand-written bulk file of two cards.
The fetch stage is the only impure one and `--bulk-updated-at` already pins it to a cache entry
(PRD 4.9.1), so a cache directory built here is all the isolation needed: everything downstream —
the appendices, every 8.2 stage, the encoder — is the code that ships. `roster_diff=False` skips
the one remaining network call, which is a report item and never a build input.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from eternities.contract.enums import CONTRACT_VERSION
from eternities.pipeline import run

AS_OF = "2026-09-04"
BULK_UPDATED_AT = "2026-09-04T09:05:32.308+00:00"
# The cache key is the timestamp with its punctuation removed (see `scryfall._stamp`); spelled out
# rather than imported so a change to that rule fails here loudly instead of following along.
STAMP = "20260904T0905323080000"

# Both real Appendix B rows, so the appendices this build loads are the shipped ones.
SETS = [
    {
        "code": "lea",
        "name": "Limited Edition Alpha",
        "released_at": "1993-08-05",
        "set_type": "core",
        "digital": False,
    },
    {
        "code": "rav",
        "name": "Ravnica: City of Guilds",
        "released_at": "2005-10-07",
        "set_type": "expansion",
        "digital": False,
    },
]


def _card(index: int, set_code: str) -> dict[str, object]:
    oracle_id = f"00000000-0000-4000-8000-{index:012d}"
    return {
        "id": f"{oracle_id}-p",
        "oracle_id": oracle_id,
        "name": f"Card {index}",
        "set": set_code,
        "released_at": SETS[0]["released_at"] if set_code == "lea" else SETS[1]["released_at"],
        "rarity": "common",
        "layout": "normal",
        "lang": "en",
        "collector_number": str(index),
        "color_identity": ["G"],
        "mana_cost": "{1}{G}",
        "type_line": "Creature — Test",
        "oracle_text": "Text.",
        "image_uris": {
            "normal": f"https://cards.scryfall.io/normal/front/a/b/{index}.jpg?1700000000"
        },
    }


def _write_cache(cache_dir: Path, cards: list[dict[str, object]]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / f"default_cards-{STAMP}.json").write_text(json.dumps(cards), encoding="utf-8")
    (cache_dir / f"sets-{STAMP}.json").write_text(json.dumps({"data": SETS}), encoding="utf-8")


def _write_swatch_cache(path: Path, cards: list[dict[str, object]]) -> None:
    """A pre-warmed swatch cache, so the build takes the cache-hit path and never leaves the box.

    The swatch stage is the second impure stage (worlds spec §2.2) and it is resumable by design:
    a record already in the cache is never fetched. Seeding it here is what keeps this suite's
    "everything downstream is the code that ships" claim true — the stage runs for real, decides
    every card is cached, and reports 0 fetched.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(
            json.dumps({"id": str(card["id"]), "ts": 1700000000, "s": [i, i, i, i]}) + "\n"
            for i, card in enumerate(cards)
        ),
        encoding="utf-8",
    )


def _build(tmp_path: Path, *, as_of: str, cards: list[dict[str, object]]) -> run.BuildResult:
    cache_dir = tmp_path / "cache"
    _write_cache(cache_dir, cards)
    swatch_cache = tmp_path / "swatches.jsonl"
    _write_swatch_cache(swatch_cache, cards)
    return run.build(
        as_of=as_of,
        data_root=tmp_path / "data",
        reports_dir=tmp_path / "reports",
        cache_dir=cache_dir,
        roster_diff=False,  # the wiki diff is a report item, and this must not touch the network
        bulk_updated_at=BULK_UPDATED_AT,
        swatch_cache_path=swatch_cache,
        log=_quiet,
    )


def _quiet(*_: Any) -> None:
    """`build` narrates every stage; the tests read the artefacts, not the log."""


def _manifest(directory: Path) -> dict[str, object]:
    return json.loads((directory / "manifest.json").read_text(encoding="utf-8"))


def test_a_first_build_writes_no_previous_run_key(tmp_path: Path):
    """The other side of the pin: `build` must not invent a link where there is no predecessor.

    Omitted rather than `null`, which is what keeps every already-committed manifest — the
    fixtures and the test vector — byte-identical.
    """
    result = _build(tmp_path, as_of=AS_OF, cards=[_card(1, "lea"), _card(2, "rav")])

    assert "previousRun" not in _manifest(result.data_dir)


def test_build_links_a_predecessor_it_cannot_decode(tmp_path: Path):
    """DEC-647 B1 through DEC-649: the whole chain, from the directory on disk to the two
    artefacts that have to agree about it.

    The predecessor is present but written under a contract this build cannot read, so there is no
    plane diff. That is the case the mutation exploited — it is the one where `previous.planes` is
    `None` — and both the manifest link and the report's wording have to survive it. Assert them
    together, because either one alone passed while the other was broken.
    """
    first = _build(tmp_path, as_of="2026-09-01", cards=[_card(1, "lea"), _card(2, "rav")])
    assert "previousRun" not in _manifest(first.data_dir)

    manifest = _manifest(first.data_dir)
    manifest["contractVersion"] = CONTRACT_VERSION - 1
    (first.data_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    # Not merely a different layout: undecodable. Removing the file the loader would have had to
    # read proves it never reaches for the bytes, so `planes is None` is reached the real way.
    (first.data_dir / "sets.bin").unlink()

    # A third card, so the second build is a different content hash and lands beside the first.
    second = _build(
        tmp_path, as_of="2026-09-04", cards=[_card(1, "lea"), _card(2, "rav"), _card(3, "lea")]
    )

    assert second.data_dir != first.data_dir
    assert _manifest(second.data_dir)["previousRun"] == first.data_dir.name, (
        "an unreadable predecessor is still the predecessor; the manifest chain must hold"
    )
    assert "First production run" not in second.report_text
    assert first.data_dir.name in second.report_text


def test_build_links_a_readable_predecessor_and_diffs_it(tmp_path: Path):
    """The ordinary case, so the guard above cannot be satisfied by linking unconditionally
    *without* the loader ever succeeding: here the predecessor decodes and the 4.9.2 diff runs.
    """
    first = _build(tmp_path, as_of="2026-09-01", cards=[_card(1, "lea"), _card(2, "rav")])
    # Card 2 moves from Ravnica to Dominaria, which is exactly what 4.9.2 exists to report.
    second = _build(tmp_path, as_of="2026-09-04", cards=[_card(1, "lea"), _card(2, "lea")])

    assert second.data_dir != first.data_dir
    assert _manifest(second.data_dir)["previousRun"] == first.data_dir.name
    assert "Card 2" in second.report_text
