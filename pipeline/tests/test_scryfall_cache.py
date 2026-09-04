"""The pinned bulk cache key of PRD 4.9.1 (`eternities build --bulk-updated-at`).

4.9.1's determinism claim is "the same bulk file, appendices and `--as-of` give byte-identical
artefacts". Nothing in the pipeline could hold the first of those three still: `fetch` asked
Scryfall which file was current, and Scryfall republishes `default_cards` several times a day. An
appendix-only re-run therefore silently changed the card data too, and the 4.9.2 plane diff — the
thing the run report exists to be reviewed on — stopped separating the appendix edit from the
day's card churn.

Every test here runs offline. Reaching the network would defeat the point.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eternities.pipeline.scryfall import PinnedBulkMissingError, fetch

UPDATED_AT = "2026-09-04T09:05:32.308+00:00"
STAMP = "20260904T0905323080000"
URI = "https://data.scryfall.io/default-cards/default-cards-20260904090532.jsonl.gz"


def _cache(root: Path, *, meta: bool = True) -> Path:
    cache = root / "scryfall"
    cache.mkdir(parents=True)
    (cache / f"default_cards-{STAMP}.jsonl.gz").write_bytes(b"")
    (cache / f"sets-{STAMP}.json").write_text(json.dumps({"data": []}), encoding="utf-8")
    if meta:
        (cache / f"default_cards-{STAMP}.meta.json").write_text(
            json.dumps({"updatedAt": UPDATED_AT, "downloadUri": URI}), encoding="utf-8"
        )
    return cache


def test_a_pinned_key_is_served_from_the_cache_without_a_network_call(tmp_path: Path):
    cache = _cache(tmp_path)

    source = fetch(cache, pinned_updated_at=UPDATED_AT)

    assert source.updated_at == UPDATED_AT
    assert source.path == cache / f"default_cards-{STAMP}.jsonl.gz"
    assert source.sets_path == cache / f"sets-{STAMP}.json"


def test_the_pinned_run_reproduces_the_reports_bulk_file_row(tmp_path: Path):
    """The report prints the upstream file name, which the cache key alone cannot reconstruct —
    Scryfall's name drops the sub-second part the key keeps. The sidecar written at download time
    is what makes a pinned re-run's report comparable with the run it reproduces."""
    source = fetch(_cache(tmp_path), pinned_updated_at=UPDATED_AT)
    assert source.download_uri == URI
    assert source.download_uri.rsplit("/", 1)[-1] == "default-cards-20260904090532.jsonl.gz"


def test_a_cache_without_a_sidecar_still_serves_the_pin(tmp_path: Path):
    """Caches predating the sidecar exist. Falling back to the local path keeps the run possible
    and keeps the report honest about what it actually read."""
    cache = _cache(tmp_path, meta=False)
    source = fetch(cache, pinned_updated_at=UPDATED_AT)
    assert source.download_uri == str(cache / f"default_cards-{STAMP}.jsonl.gz")


def test_a_missing_pin_fails_loudly_rather_than_downloading_todays_file(tmp_path: Path):
    """The failure mode this flag exists to prevent: a pin that silently becomes "whatever is
    current" is worse than no pin, because the report would still claim the pinned date."""
    cache = _cache(tmp_path)

    with pytest.raises(PinnedBulkMissingError) as error:
        fetch(cache, pinned_updated_at="2020-01-01T00:00:00.000+00:00")

    message = str(error.value)
    assert "2020-01-01T00:00:00.000+00:00" in message
    assert f"default_cards-{STAMP}.jsonl.gz" in message, "name what the cache does hold"


def test_a_cache_holding_the_cards_but_not_the_sets_is_not_a_usable_pin(tmp_path: Path):
    cache = _cache(tmp_path)
    (cache / f"sets-{STAMP}.json").unlink()

    with pytest.raises(PinnedBulkMissingError, match="sets-"):
        fetch(cache, pinned_updated_at=UPDATED_AT)


def test_the_sidecar_is_not_mistaken_for_the_bulk_file(tmp_path: Path):
    """`default_cards-<stamp>.meta.json` matches the same glob as `…-<stamp>.json` would."""
    cache = _cache(tmp_path)
    source = fetch(cache, pinned_updated_at=UPDATED_AT)
    assert source.path.name.endswith(".jsonl.gz")
