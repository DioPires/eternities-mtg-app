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

So this sorts every difference into one of six buckets, loudest last:

  * `imageTs` only                  — Scryfall re-stamped an image. Expected, ignorable, noisy.
  * printing added or removed       — a new printing of an existing card. Expected after a release.
  * card added or removed           — the card set moved. Cross-check against the report's counts.
  * a non-printing field changed    — name, type, oracle text, colour identity, layout, size class.
                                      Rare, and worth reading one by one.
  * a printing changed some other   — same printing id, different set/rarity/collector number. This
    field                             should not happen; if it does, read it before merging.
  * the card changed plane          — it is in a different shard than it was. This is PRD 9.2.3's
                                      question, and the one class of change that moves two shard
                                      files while every byte of the card stays the same. Read it
                                      against the report's 9.2.3 count, and remember that a run
                                      whose predecessor is under an older data contract prints no
                                      9.2.3 number at all — then this line is the only account of
                                      it that exists.

A card is reported in one bucket, the loudest that applies, except that a non-printing field change
and a printing change are reported side by side: they answer different questions and the second is
the one the runbook tells the operator to read.

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


def load_shards(root: Path) -> dict[str, tuple[str, dict]]:
    """Every card in a dataset, by `oracle_id`, with the shard slug it came from.

    The slug is what makes a plane move visible: a card can move between shards without a single
    byte of the card itself changing, so the card alone cannot answer PRD 9.2.3's question.
    """
    cards: dict[str, tuple[str, dict]] = {}
    for shard in sorted((root / "planes").glob("*.json")):
        payload = json.loads(shard.read_text())
        # The shard states its own plane; the file name (`<slug>.<n>.json`) is the fallback.
        slug = payload.get("slug") or shard.name.split(".")[0]
        for card in payload["cards"]:
            seen = cards.get(card["u"])
            if seen is not None:
                # Last shard wins, as it always has — but say so. A card in two planes at once
                # would otherwise surface as a plane move that never happened.
                print(
                    f"warning: {root.name}: {card.get('n', card['u'])} appears in both "
                    f"{seen[0]} and {slug}; taking {slug}",
                    file=sys.stderr,
                )
            cards[card["u"]] = (slug, card)
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
    plane_moves: list[tuple[str, str, str]] = []
    changed_fields: Counter[str] = Counter()
    changed_cards: set[str] = set()
    image_ts_printings = 0

    for oracle_id in sorted(set(before) & set(after)):
        (slug_a, a), (slug_b, b) = before[oracle_id], after[oracle_id]
        if slug_a == slug_b and a == b:
            continue
        changed_cards.add(oracle_id)
        name = b.get("n", oracle_id)

        # Loudest bucket, and the only one that can fire on a byte-identical card.
        if slug_a != slug_b:
            plane_moves.append((name, slug_a, slug_b))
            continue

        rest_a = {k: v for k, v in a.items() if k != "p"}
        rest_b = {k: v for k, v in b.items() if k != "p"}
        fields_changed = rest_a != rest_b
        if fields_changed:
            keys = set(rest_a) | set(rest_b)
            differing = sorted(k for k in keys if rest_a.get(k) != rest_b.get(k))
            field_changes.append((name, differing))
            changed_fields.update(differing)
            # Deliberately no `continue`: a field change must not hide a printing change on the
            # same card, because "printing changed otherwise" is the row the runbook says to read.

        pa, pb = a["p"], b["p"]
        if len(pa) != len(pb):
            printing_counts.append((name, len(pa), len(pb)))
            continue

        only_stamp = True
        stamp_printings = 0
        for x, y in zip(pa, pb, strict=True):
            if x == y:
                continue
            same_identity = x[PRINTING_ID] == y[PRINTING_ID] and [
                v for i, v in enumerate(x) if i != PRINTING_IMAGE_TS
            ] == [v for i, v in enumerate(y) if i != PRINTING_IMAGE_TS]
            if same_identity:
                stamp_printings += 1
            else:
                only_stamp = False
                printing_oddities.append((name, x, y))
        image_ts_printings += stamp_printings
        if only_stamp and stamp_printings and not fields_changed:
            image_ts_only.append(name)

    print(f"old: {old}")
    print(f"new: {new}")
    print()
    print(f"cards added:   {len(added)}")
    print(f"cards removed: {len(removed)}")
    print(f"cards changed: {len(changed_cards)}")
    print()
    print(
        f"  image cache-buster only:      {len(image_ts_only):>5} card(s), "
        f"{image_ts_printings} printing tuple(s)"
    )
    print(f"  printing added or removed:    {len(printing_counts):>5} card(s)")
    print(f"  non-printing field changed:   {len(field_changes):>5} card(s)")
    print(f"  printing changed otherwise:   {len(printing_oddities):>5} card(s)  <-- read these")
    print(f"  card changed plane:           {len(plane_moves):>5} card(s)  <-- read these")

    if added:
        print(f"\ncards added ({len(added)}):")
        for oracle_id in added[:40]:
            slug, card = after[oracle_id]
            print(f"  + {card.get('n', oracle_id)} ({slug})")
        if len(added) > 40:
            print(f"  ... and {len(added) - 40} more")
    if removed:
        print(f"\ncards removed ({len(removed)}):")
        for oracle_id in removed[:40]:
            slug, card = before[oracle_id]
            print(f"  - {card.get('n', oracle_id)} ({slug})")
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
    if plane_moves:
        print(f"\ncards that changed plane ({len(plane_moves)}):")
        for name, was, now in plane_moves[:40]:
            print(f"  {name}: {was} -> {now}")
        if len(plane_moves) > 40:
            print(f"  ... and {len(plane_moves) - 40} more")

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
