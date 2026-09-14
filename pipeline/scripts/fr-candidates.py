#!/usr/bin/env python
"""Dump every first printing a set contributes, with the oracle fields curation needs.

Unlike ``dust-candidates.py`` this does not filter to the Blind Eternities: a set-level Appendix B
mapping moves *every* first printing of the set, so the reviewable list is every one of them, dust
or not. The plane each card holds today is printed beside it, which is how a card that a curated
override already placed elsewhere stays visible instead of being silently re-pointed.

    uv run python scripts/fr-candidates.py clb afr afc --out /tmp/fr.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from eternities.pipeline import records, scryfall
from eternities.pipeline.appendices import load_appendices
from eternities.pipeline.stages import (
    assign_planes,
    choose_first_printings,
    exclude_cards,
    filter_printings,
)

CACHE = Path(__file__).resolve().parents[1] / ".cache" / "scryfall"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sets", nargs="+", help="set codes to report on")
    parser.add_argument("--as-of", default="2026-09-14")
    parser.add_argument("--bulk-updated-at", default=None)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    wanted = set(args.sets)

    appendices = load_appendices()
    source = scryfall.fetch(CACHE, pinned_updated_at=args.bulk_updated_at)
    scry_sets = {
        s.code: s for s in (records.parse_set(row) for row in scryfall.read_sets(source.sets_path))
    }
    all_printings = records.read_printings(scryfall.iter_cards(source.path))
    filtered = filter_printings(all_printings, scry_sets, appendices, args.as_of)
    excluded = exclude_cards(all_printings, filtered.kept, appendices, scry_sets)
    first = choose_first_printings(filtered.kept, excluded.included, scry_sets)
    assignment = assign_planes(first, scry_sets, appendices)

    ids = {oid for oid, printing in first.items() if printing.set_code in wanted}
    details, _ = records.read_details(
        scryfall.iter_cards(source.path), {first[o].id for o in ids}, set()
    )

    rows: list[dict[str, Any]] = []
    for oid in sorted(ids, key=lambda o: (first[o].set_code, first[o].card_name)):
        printing = first[oid]
        detail = details[printing.id]
        rows.append(
            {
                "oracleId": oid,
                "name": detail.front.name,
                "set": printing.set_code,
                "collectorNumber": printing.collector_number,
                "plane": assignment.by_oracle_id.get(oid),
                "typeLine": detail.front.type_line,
                "oracleText": detail.front.oracle_text,
                "backName": detail.back.name if detail.back else None,
                "backTypeLine": detail.back.type_line if detail.back else None,
                "backText": detail.back.oracle_text if detail.back else None,
            }
        )

    Path(args.out).write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"{len(rows)} first printings across {sorted(wanted)} -> {args.out}")
    from collections import Counter

    print(Counter(r["set"] for r in rows).most_common())
    print(Counter(r["plane"] for r in rows).most_common())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
