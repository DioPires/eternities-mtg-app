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

So this sorts every difference into six buckets, loudest last:

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

A card is reported in every bucket whose symptom it actually has, not just the loudest: the buckets
answer different questions, and a louder row must not swallow a quieter one on the same card. The
`printing changed otherwise` row in particular is the one the runbook tells the operator to read,
and it would otherwise be hidden by a rename or a plane move on that card. `cards changed` counts
oracle ids, so a card with two symptoms appears in two rows and is still counted once — the bucket
rows sum to more than it, by design.

The one thing that is still a count of a different population: the `printing tuple(s)` figure on the
cache-buster row counts every cache-buster tuple in the diff, including tuples on cards that landed
in a louder bucket, while the `card(s)` figure beside it excludes any card that also had a field
change, a printing-count change or a printing anomaly. A plane move does not exclude a card from
that figure: a card that moved shard and was re-stamped is counted in both rows, because the move
says nothing about whether the card's own contents changed by more than a cache-buster.

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


def load_shards(
    root: Path, duplicates: list[tuple[str, str]] | None = None
) -> dict[str, tuple[str, dict]]:
    """Every card in a dataset, by `oracle_id`, with the shard slug it came from.

    The slug is what makes a plane move visible: a card can move between shards without a single
    byte of the card itself changing, so the card alone cannot answer PRD 9.2.3's question.

    A duplicate oracle id is what makes that answer untrustworthy — last-shard-wins picks the slug,
    so a card duplicated into a later-sorting shard reads as a plane move that never happened. The
    warning therefore goes to **stdout**, not stderr: the runbook has the operator paste the
    classifier output into the pull request, and on stderr the warning was dropped by any redirect
    while the phantom move it disqualifies went through (DEC-673 N5). Pass `duplicates` to collect
    `(oracle_id, message)` pairs instead, which is how `classify` reprints them beside that row.
    The oracle id rides along because `classify` calls this once per dataset onto one shared list,
    so a duplicate that persists across a refresh contributes two messages for one id and only the
    id can tell the header how many ids there really are (DEC-681 N3).
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
                message = (
                    f"warning: {root.name}: {card.get('n', card['u'])} appears in both "
                    f"{seen[0]} and {slug}; taking {slug}"
                )
                if duplicates is None:
                    print(message)
                else:
                    duplicates.append((card["u"], message))
            cards[card["u"]] = (slug, card)
    return cards


def classify(old: Path, new: Path) -> int:
    duplicates: list[tuple[str, str]] = []
    before = load_shards(old, duplicates)
    after = load_shards(new, duplicates)

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
            # Deliberately no `continue`, for the same reason as the field-change branch below: a
            # move must not hide a printing change on the same card. The runbook's flow is that
            # every `card changed plane` row traces back to an appendix edit you made — so in the
            # run where it does trace, the operator waves it through, and a genuine Scryfall
            # anomaly on that card would ride along invisibly (DEC-673 N1).

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
        # All three conjuncts are load-bearing. `stamp_printings` became so with N1's fix above:
        # a byte-identical plane move now reaches this line with `a == b`, so it leaves
        # `only_stamp` true and `fields_changed` false, and only the zero stamp count keeps it out
        # of the quietest bucket. `not fields_changed` is what keeps a card whose fields also moved
        # from being reported as cache-buster-only while still counting its tuples (DEC-673 N3).
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
    if duplicates:
        # Immediately after the plane-move rows, because that is the list these disqualify: a
        # duplicated card gets its slug from whichever shard sorts last, which can fabricate a
        # move above. Read these before believing that list (DEC-673 N5).
        # Count ids, not lines. Both datasets append to one list, so the likeliest real case — a
        # duplicate that survives the refresh — is two lines about one id, and a bare line count
        # reads the same as two genuinely different ids (DEC-681 N3). Every line still prints; it
        # is only the headline that had to stop counting them.
        distinct = {oracle_id for oracle_id, _ in duplicates}
        print(f"\nduplicate oracle ids ({len(distinct)}) — each can fake a plane move above:")
        for _, message in duplicates:
            print(f"  {message}")

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
