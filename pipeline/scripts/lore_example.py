#!/usr/bin/env python
"""Generate the lore schema example of PRD v4 Appendix F.5.

Writes ``regions.json``, ``eras.json`` and ``keywords.json`` to
``contract/test-vectors/v4/layout/dominaria-example/dominaria/`` from the three tables of F.5 and
its expansion rule. The tables and the rule are ``eternities.lore.example``, because the pipeline
re-runs the rule on every run and compares the bytes; this script is how the files are written.

The rule resolves one oracle id per era against a dataset. The dataset is the committed production
pack that ``web/datasets.json`` names, so the script needs no Scryfall download.

    uv run python scripts/lore_example.py            # write the three files
    uv run python scripts/lore_example.py --check    # compare the committed files, write nothing
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from eternities.lore import example
from eternities.lore.index import LoreIndex

REPO_ROOT = Path(__file__).resolve().parents[2]


def production_pack() -> Path:
    registry = json.loads((REPO_ROOT / "web" / "datasets.json").read_text(encoding="utf-8"))
    return REPO_ROOT / "web" / "public" / "data" / str(registry["production"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n", 1)[0])
    parser.add_argument("--data", default=None, help="data pack directory (default: production)")
    parser.add_argument("--out", default=str(example.EXAMPLE_DIR), help="the example's directory")
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare the files under --out with what the rule generates, and write nothing",
    )
    args = parser.parse_args(argv)

    index = LoreIndex.from_pack(Path(args.data) if args.data else production_pack())
    out = Path(args.out)
    if args.check:
        differing = example.differing_files(index, out)
        if differing:
            print(
                f"{out / example.PLANE}: {', '.join(differing)} differ from what the expansion "
                f"rule generates on dataset {index.label}",
                file=sys.stderr,
            )
            return 1
        print(f"{out / example.PLANE} is what the expansion rule generates on {index.label}")
        return 0

    directory = example.write(index, out)
    print(f"wrote {directory} from dataset {index.label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
