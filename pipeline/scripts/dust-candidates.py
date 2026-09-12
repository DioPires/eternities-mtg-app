#!/usr/bin/env python
"""Dump the Blind Eternities cards a given set contributes, for curation (PRD 11.9, plan Q4).

Runs the real stages against the cached bulk file, so the list is exactly what a build assigns —
not an approximation from the raw Scryfall rows. Read-only: it writes one JSON file and never
touches an appendix or a dataset.

    uv run python scripts/dust-candidates.py clb mom afr --out /tmp/candidates.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from eternities.pipeline import records, scryfall
from eternities.pipeline.appendices import BLIND_ETERNITIES, load_appendices
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
    parser.add_argument("--as-of", default="2026-09-06")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    wanted = set(args.sets)

    appendices = load_appendices()
    source = scryfall.fetch(CACHE, pinned_updated_at=None)
    scry_sets = {
        s.code: s for s in (records.parse_set(row) for row in scryfall.read_sets(source.sets_path))
    }
    all_printings = records.read_printings(scryfall.iter_cards(source.path))
    filtered = filter_printings(all_printings, scry_sets, appendices, args.as_of)
    excluded = exclude_cards(all_printings, filtered.kept, appendices, scry_sets)
    first = choose_first_printings(filtered.kept, excluded.included, scry_sets)
    assignment = assign_planes(first, scry_sets, appendices)

    ids = {
        oid
        for oid, printing in first.items()
        if printing.set_code in wanted and assignment.by_oracle_id.get(oid) == BLIND_ETERNITIES
    }
    # The oracle text is only in the second pass, and curation needs it: a card's setting is
    # usually in its type line (legendary creature, saga) or its rules text, not its name.
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
                "typeLine": detail.front.type_line,
                "oracleText": detail.front.oracle_text,
                "backName": detail.back.name if detail.back else None,
                "backTypeLine": detail.back.type_line if detail.back else None,
                "backText": detail.back.oracle_text if detail.back else None,
            }
        )

    Path(args.out).write_text(json.dumps(rows, indent=1) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for row in rows:
        counts[str(row["set"])] = counts.get(str(row["set"]), 0) + 1
    print(f"{len(rows)} dust cards: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
