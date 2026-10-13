#!/usr/bin/env python
"""Write a hero entry's Story Spotlight sidecar (PRD v4 9.6) from Scryfall's bulk data.

The sidecar, ``pipeline/data/lore/<slug>/spotlight.json``, lists the id of every printing Scryfall
flags ``story_spotlight`` among the plane's set codes with first printings. It stands in until the
pipeline retains the flag per printing (4.16.4).

The script reads the ``default_cards`` bulk file through the pipeline's cached client
(``eternities.pipeline.scryfall``): one download at most, and none when the cache holds the file.
It never calls the card API (``docs/scryfall-policy.md`` section 4). The plane's set codes come
from the committed production pack that ``web/datasets.json`` names.

    uv run python scripts/spotlight_sidecar.py dominaria
    uv run python scripts/spotlight_sidecar.py dominaria --check
    uv run python scripts/spotlight_sidecar.py dominaria --check \\
        --bulk-updated-at 2026-10-12T09:05:45.962+00:00

``--check`` writes nothing: it reads the bulk file again and compares its printing ids with the
committed sidecar's. ``--bulk-updated-at`` pins the cached bulk file, so the comparison is against
the same upstream bytes the sidecar was written from.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from eternities.lore.index import LoreIndex
from eternities.lore.spotlight import SIDECAR_NAME
from eternities.lore.vocabulary import load_hero_entries
from eternities.pipeline import scryfall

REPO_ROOT = Path(__file__).resolve().parents[2]
LORE_ROOT = REPO_ROOT / "pipeline" / "data" / "lore"
CACHE = REPO_ROOT / "pipeline" / ".cache" / "scryfall"
SCRIPT = "pipeline/scripts/spotlight_sidecar.py"


def production_pack() -> Path:
    registry = json.loads((REPO_ROOT / "web" / "datasets.json").read_text(encoding="utf-8"))
    return REPO_ROOT / "web" / "public" / "data" / str(registry["production"])


def _collector_key(number: str) -> tuple[int, str]:
    digits = "".join(ch for ch in number if ch.isdigit())
    return (int(digits) if digits else 0, number)


def flagged(bulk: Path, codes: tuple[str, ...]) -> list[dict[str, str]]:
    """Every printing in ``bulk`` with ``story_spotlight`` set, in one of ``codes``.

    Ordered by the plane's set order, then collector number, then id, so the file is stable.
    """
    order = {code: position for position, code in enumerate(codes)}
    rows: list[dict[str, str]] = []
    for card in scryfall.iter_cards(bulk):
        if card.get("story_spotlight") is True and card.get("set") in order:
            faces: list[dict[str, Any]] = card.get("card_faces") or []
            name = str(faces[0]["name"]) if faces else str(card["name"])
            rows.append(
                {
                    "id": str(card["id"]),
                    "set": str(card["set"]),
                    "collector_number": str(card["collector_number"]),
                    "name": name,
                }
            )
    rows.sort(key=lambda r: (order[r["set"]], _collector_key(r["collector_number"]), r["id"]))
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n", 1)[0])
    parser.add_argument("slug", help="the hero entry, for example dominaria")
    parser.add_argument("--data", default=None, help="data pack directory (default: production)")
    parser.add_argument("--cache", default=str(CACHE), help="Scryfall download cache")
    parser.add_argument(
        "--bulk-updated-at",
        default=None,
        metavar="TIMESTAMP",
        help="pin the cached bulk file by its `updated_at`; makes no network call",
    )
    parser.add_argument("--out", default=None, help=f"default: {LORE_ROOT}/<slug>/{SIDECAR_NAME}")
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare the committed sidecar's printing ids with the bulk file's, write nothing",
    )
    args = parser.parse_args(argv)

    # Before any download: a sidecar belongs to a hero entry, and a directory under the lore root
    # that is not one fails the build (`eternities.lore.stage`).
    if args.slug not in load_hero_entries():
        print(f"{args.slug} is not a hero entry of Appendix C.1", file=sys.stderr)
        return 1
    index = LoreIndex.from_pack(Path(args.data) if args.data else production_pack())
    codes = index.expected_sets(args.slug)
    if not codes:
        print(f"{args.slug} has no set with first printings in {index.label}", file=sys.stderr)
        return 1
    try:
        source = scryfall.fetch(Path(args.cache), pinned_updated_at=args.bulk_updated_at)
    except scryfall.PinnedBulkMissingError as error:
        print(str(error), file=sys.stderr)
        return 1
    rows = flagged(source.path, codes)
    by_set = Counter(row["set"] for row in rows)
    summary = ", ".join(f"{code} {by_set[code]}" for code in codes if by_set[code])
    out = Path(args.out) if args.out else LORE_ROOT / args.slug / SIDECAR_NAME

    if args.check:
        committed = json.loads(out.read_text(encoding="utf-8"))
        listed = [str(row["id"]) for row in committed["printings"]]
        fetched = [row["id"] for row in rows]
        if sorted(listed) != sorted(fetched):
            print(
                f"{out} lists {len(listed)} printings and bulk {source.updated_at} flags "
                f"{len(fetched)}: only in the file {sorted(set(listed) - set(fetched))}, only in "
                f"the bulk {sorted(set(fetched) - set(listed))}",
                file=sys.stderr,
            )
            return 1
        print(
            f"{out} matches bulk {source.updated_at}: {len(fetched)} printings ({summary}); "
            f"the file records count {committed['count']}, fetched on {committed['fetched_on']}"
        )
        return 0

    document = {
        "plane": args.slug,
        "fetched_on": datetime.now(tz=UTC).date().isoformat(),
        "fetch_script": SCRIPT,
        "bulk": {"type": "default_cards", "updated_at": source.updated_at},
        "dataset": index.label,
        "set_codes": list(codes),
        "count": len(rows),
        "printings": rows,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}: {len(rows)} printings ({summary}) from bulk {source.updated_at}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
