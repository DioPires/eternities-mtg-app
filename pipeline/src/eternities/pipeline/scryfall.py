"""Stage 1 — fetch (PRD 8.2.1).

Downloads the Scryfall ``default_cards`` bulk file and ``/sets``, caching both locally by
Scryfall's bulk ``updated_at`` so a re-run costs nothing and stays byte-identical (PRD 4.9.1).

This is the only module that touches the network. Every other stage is a pure function over the
rows this one yields, which is what makes them unit-testable without a fixture download
(PRD 8.2).
"""

from __future__ import annotations

import gzip
import json
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

BULK_INDEX_URI: Final = "https://api.scryfall.com/bulk-data"
SETS_URI: Final = "https://api.scryfall.com/sets"
USER_AGENT: Final = "eternities-pipeline/0.1 (https://github.com/DioPires/eternities-mtg-app)"

DEFAULT_CACHE: Final = Path(__file__).resolve().parents[3] / ".cache" / "scryfall"

_TIMEOUT: Final = 120


@dataclass(frozen=True, slots=True)
class BulkSource:
    """What the fetch stage found upstream, and where it landed on disk."""

    updated_at: str
    download_uri: str
    path: Path
    sets_path: Path


class PinnedBulkMissingError(RuntimeError):
    """``--bulk-updated-at`` named a bulk file this cache does not hold (PRD 4.9.1)."""


def _stamp(updated_at: str) -> str:
    """Cache-key form of Scryfall's ``updated_at``: the timestamp with its punctuation removed."""
    return updated_at.replace(":", "").replace("-", "").replace("+", "").replace(".", "")


def _meta_path(cache_dir: Path, bulk_type: str, stamp: str) -> Path:
    return cache_dir / f"{bulk_type}-{stamp}.meta.json"


def _request(uri: str) -> bytes:
    request = urllib.request.Request(uri, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        return cast("bytes", response.read())


def _download(uri: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".partial")
    request = urllib.request.Request(uri, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response, partial.open("wb") as out:
        while chunk := response.read(1 << 20):
            out.write(cast("bytes", chunk))
    partial.replace(target)


def _bulk_entry(bulk_type: str) -> dict[str, Any]:
    index = cast("dict[str, Any]", json.loads(_request(BULK_INDEX_URI)))
    for entry in cast("list[dict[str, Any]]", index["data"]):
        if entry.get("type") != bulk_type:
            continue
        # The index response carries a summary; the per-object endpoint carries the download URI.
        if "download_uri" in entry or "jsonl_download_uri" in entry:
            return entry
        return cast("dict[str, Any]", json.loads(_request(str(entry["uri"]))))
    raise RuntimeError(f"Scryfall bulk data has no {bulk_type!r} entry")


def fetch(
    cache_dir: Path = DEFAULT_CACHE,
    *,
    bulk_type: str = "default_cards",
    pinned_updated_at: str | None = None,
) -> BulkSource:
    """Download the bulk card file and the set list, or reuse the cached copies.

    Cache keys are Scryfall's ``updated_at`` for the bulk file, so a refresh is a new file and an
    unchanged upstream is a no-op (PRD 8.2.1).

    ``pinned_updated_at`` names a cached key instead of asking upstream which one is current. That
    is what makes 4.9.1's determinism claim checkable *later*: Scryfall republishes
    ``default_cards`` several times a day, so an unpinned re-run of an appendix-only change would
    silently fold in a different card file and the plane diff would stop meaning anything. Pinning
    touches the network not at all — a run that cannot be served from the cache fails rather than
    quietly falling back to today's file.
    """
    if pinned_updated_at is not None:
        return _pinned(cache_dir, bulk_type, pinned_updated_at)

    entry = _bulk_entry(bulk_type)
    updated_at = str(entry["updated_at"])
    stamp = _stamp(updated_at)

    uri = str(entry.get("jsonl_download_uri") or entry["download_uri"])
    suffix = ".jsonl.gz" if "jsonl" in uri else ".json.gz" if uri.endswith(".gz") else ".json"
    cards_path = cache_dir / f"{bulk_type}-{stamp}{suffix}"
    if not cards_path.exists():
        _download(uri, cards_path)

    sets_path = cache_dir / f"sets-{stamp}.json"
    if not sets_path.exists():
        sets_path.parent.mkdir(parents=True, exist_ok=True)
        sets_path.write_bytes(_fetch_all_sets())

    # The upstream URI is not recoverable from the cache key — Scryfall's file name drops the
    # sub-second part the key keeps — so record it beside the download. Without it a pinned re-run
    # could not reproduce the report's "Scryfall bulk file" row.
    _meta_path(cache_dir, bulk_type, stamp).write_text(
        json.dumps({"updatedAt": updated_at, "downloadUri": uri}, indent=2) + "\n",
        encoding="utf-8",
    )

    return BulkSource(updated_at=updated_at, download_uri=uri, path=cards_path, sets_path=sets_path)


def _pinned(cache_dir: Path, bulk_type: str, updated_at: str) -> BulkSource:
    """Serve one exact cache key, or fail naming what is missing and what is there."""
    stamp = _stamp(updated_at)
    candidates = sorted(cache_dir.glob(f"{bulk_type}-{stamp}.*json*"))
    cards = [p for p in candidates if not p.name.endswith(".meta.json")]
    sets_path = cache_dir / f"sets-{stamp}.json"
    if not cards or not sets_path.exists():
        held = (
            sorted(p.name for p in cache_dir.glob(f"{bulk_type}-*")) if cache_dir.exists() else []
        )
        raise PinnedBulkMissingError(
            f"--bulk-updated-at {updated_at!r} needs {bulk_type}-{stamp}.* and sets-{stamp}.json "
            f"in {cache_dir}; it holds {held or 'nothing'}. Re-run without the flag to download, "
            "or point --cache at the machine that has them."
        )

    meta_path = _meta_path(cache_dir, bulk_type, stamp)
    uri = str(cards[0])
    if meta_path.exists():
        meta = cast("dict[str, Any]", json.loads(meta_path.read_text(encoding="utf-8")))
        uri = str(meta.get("downloadUri", uri))
    return BulkSource(updated_at=updated_at, download_uri=uri, path=cards[0], sets_path=sets_path)


def _fetch_all_sets() -> bytes:
    """``/sets`` is a paginated list object; follow ``next_page`` until it runs out."""
    rows: list[Any] = []
    uri: str | None = SETS_URI
    while uri:
        page = cast("dict[str, Any]", json.loads(_request(uri)))
        rows.extend(cast("list[Any]", page["data"]))
        uri = str(page["next_page"]) if page.get("has_more") else None
    return json.dumps({"data": rows}, ensure_ascii=False).encode("utf-8")


def _open_text(path: Path) -> Any:
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("r", encoding="utf-8")


def iter_cards(path: Path) -> Iterator[dict[str, Any]]:
    """Stream the bulk file one card object at a time.

    Both shapes Scryfall publishes are handled: JSON Lines (one object per line, what the current
    ``jsonl_download_uri`` serves) and the legacy single JSON array. Streaming matters — the
    decompressed file is over a gigabyte and the pipeline keeps only the fields it needs.
    """
    with _open_text(path) as handle:
        first = handle.readline()
        stripped = first.lstrip()
        if stripped.startswith("["):
            # Legacy array form: no per-line framing, so parse the whole document.
            document = stripped + handle.read()
            yield from cast("list[dict[str, Any]]", json.loads(document))
            return
        if stripped:
            yield cast("dict[str, Any]", json.loads(stripped))
        for line in handle:
            line = cast("str", line).strip().rstrip(",")
            if line and line not in {"[", "]"}:
                yield cast("dict[str, Any]", json.loads(line))


def read_sets(path: Path) -> list[dict[str, Any]]:
    document = cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))
    return cast("list[dict[str, Any]]", document["data"])
