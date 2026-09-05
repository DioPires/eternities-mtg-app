#!/usr/bin/env python3
"""Classify what actually changed between two dataset directories.

    python pipeline/scripts/classify-refresh-diff.py <old-data-dir> <new-data-dir>

PRD 4.9.2's report answers "which cards changed *plane*". That is the question the data quality
gates care about, and on a normal refresh the answer is `None`. It is not the question a reviewer
staring at the pull request has, which is "why are 13 shard files in this diff when the report says
nothing changed" — and the gap between those two questions is where a real change hides.

The 2026-09-05 rehearsal is the worked example. The report said no card changed plane, truthfully.
Thirteen shards changed anyway: 38 cards, 40 printing tuples, **every one of them only in
`imageTs`** — the cache-buster in Scryfall's image URI, which they re-stamp when a card is
re-scanned. Nothing about the product changed. But "nothing changed" was a conclusion that took a
script to reach, and eyeballing 351 KB of minified JSON per shard would never have reached it.

So this sorts every difference into one of five buckets, loudest last:

  * `imageTs` only                  — Scryfall re-stamped an image. Expected, ignorable, noisy.
  * printing added or removed       — a new printing of an existing card. Expected after a release.
  * card added or removed           — the card set moved. Cross-check against the report's counts.
  * a non-printing field changed    — name, type, oracle text, colour identity, layout, size class.
                                      Rare, and worth reading one by one.
  * a printing changed some other   — same printing id, different set/rarity/collector number. This
    field                             should not happen; if it does, read it before merging.

Exit code is 0 whatever it finds. This is a reading aid for a human review step, not a gate — the
gates are PRD 9.2's and they live in the report.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

# A printing is `[id, setId, rarityChar, imageTs, collectorNumber]` (docs/data-contract.md).
PRINTING_ID = 0
PRINTING_IMAGE_TS = 3


def load_shards(root: Path) -> dict[str, dict]:
    """Every card in a dataset, by `oracle_id`, with the shard it came from."""
    cards: dict[str, dict] = {}
    for shard in sorted((root / "planes").glob("*.json")):
        for card in json.loads(shard.read_text())["cards"]:
            cards[card["u"]] = card
    return cards


def classify(old: Path, new: Path) -> int:
    before = load_shards(old)
    after = load_shards(new)

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))

    image_ts_only: list[str] = []
    printing_counts: list[tuple[str, int, int]] = []
    field_changes: list[tuple[str, list[str]]] = []
    printing_oddities: list[tuple[str, list, list]] = []
    changed_fields: Counter[str] = Counter()
    image_ts_printings = 0

    for oracle_id in sorted(set(before) & set(after)):
        a, b = before[oracle_id], after[oracle_id]
        if a == b:
            continue
        name = b.get("n", oracle_id)

        rest_a = {k: v for k, v in a.items() if k != "p"}
        rest_b = {k: v for k, v in b.items() if k != "p"}
        if rest_a != rest_b:
            keys = set(rest_a) | set(rest_b)
            differing = sorted(k for k in keys if rest_a.get(k) != rest_b.get(k))
            field_changes.append((name, differing))
            changed_fields.update(differing)
            continue

        pa, pb = a["p"], b["p"]
        if len(pa) != len(pb):
            printing_counts.append((name, len(pa), len(pb)))
            continue

        only_stamp = True
        for x, y in zip(pa, pb, strict=True):
            if x == y:
                continue
            same_identity = x[PRINTING_ID] == y[PRINTING_ID] and [
                v for i, v in enumerate(x) if i != PRINTING_IMAGE_TS
            ] == [v for i, v in enumerate(y) if i != PRINTING_IMAGE_TS]
            if same_identity:
                image_ts_printings += 1
            else:
                only_stamp = False
                printing_oddities.append((name, x, y))
        if only_stamp:
            image_ts_only.append(name)

    print(f"old: {old}")
    print(f"new: {new}")
    print()
    print(f"cards added:   {len(added)}")
    print(f"cards removed: {len(removed)}")
    changed = (
        len(image_ts_only) + len(printing_counts) + len(field_changes) + len(printing_oddities)
    )
    print(f"cards changed: {changed}")
    print()
    print(
        f"  image cache-buster only:      {len(image_ts_only):>5} card(s), "
        f"{image_ts_printings} printing tuple(s)"
    )
    print(f"  printing added or removed:    {len(printing_counts):>5} card(s)")
    print(f"  non-printing field changed:   {len(field_changes):>5} card(s)")
    print(f"  printing changed otherwise:   {len(printing_oddities):>5} card(s)  <-- read these")

    if added:
        print(f"\ncards added ({len(added)}):")
        for oracle_id in added[:40]:
            print(f"  + {after[oracle_id].get('n', oracle_id)}")
        if len(added) > 40:
            print(f"  ... and {len(added) - 40} more")
    if removed:
        print(f"\ncards removed ({len(removed)}):")
        for oracle_id in removed[:40]:
            print(f"  - {before[oracle_id].get('n', oracle_id)}")
        if len(removed) > 40:
            print(f"  ... and {len(removed) - 40} more")
    if printing_counts:
        print(f"\nprinting count changed ({len(printing_counts)}):")
        for name, was, now in printing_counts[:40]:
            print(f"  {name}: {was} -> {now}")
    if field_changes:
        print(
            f"\nnon-printing fields changed ({len(field_changes)}), "
            f"by field: {dict(changed_fields)}"
        )
        for name, fields in field_changes[:40]:
            print(f"  {name}: {', '.join(fields)}")
    if printing_oddities:
        print(f"\nprintings that changed beyond the cache-buster ({len(printing_oddities)}):")
        for name, was, now in printing_oddities[:40]:
            print(f"  {name}\n    old {was}\n    new {now}")

    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    old, new = Path(argv[0]), Path(argv[1])
    for path in (old, new):
        if not (path / "planes").is_dir():
            print(f"not a dataset directory (no planes/): {path}", file=sys.stderr)
            return 2
    return classify(old, new)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
