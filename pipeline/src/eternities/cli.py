"""The ``eternities`` CLI.

Phase 0 ships the subcommands the contract needs. ``eternities build`` — the full Scryfall run of
PRD 8.1.2 — is Phase 1's named deliverable and is declared here so the surface is stable.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, cast

from .contract import write_dataset
from .contract.enums import CONTRACT_VERSION, PIPELINE_VERSION
from .fixtures import SCALE, SMALL, FixtureSpec, build

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_DATA_ROOT = REPO_ROOT / "web" / "public" / "data"
DATASETS_FILE = REPO_ROOT / "web" / "datasets.json"

_FIXTURES: dict[str, FixtureSpec] = {"small": SMALL, "scale": SCALE}


def _cmd_fixtures(args: argparse.Namespace) -> int:
    data_root = Path(args.out).resolve()
    names: list[str] = list(_FIXTURES) if args.which == "all" else [args.which]

    registry: dict[str, Any] = {}
    if DATASETS_FILE.exists():
        registry = cast("dict[str, Any]", json.loads(DATASETS_FILE.read_text(encoding="utf-8")))
    fixtures: dict[str, str] = {
        str(k): str(v) for k, v in cast("dict[str, Any]", registry.get("fixtures", {})).items()
    }

    for name in names:
        spec = _FIXTURES[name]
        dataset = build(spec)
        previous = fixtures.get(name)
        out_dir = write_dataset(dataset, data_root)
        fixtures[name] = out_dir.name
        if previous and previous != out_dir.name and (data_root / previous).exists():
            # The data directory is immutable and content-hashed; a stale one is dead weight
            # (PRD 8.3, 8.8.2).
            shutil.rmtree(data_root / previous)
            print(f"  removed stale {previous}/")
        print(
            f"{spec.name}: {len(dataset.stars)} stars, {len(dataset.planes)} planes "
            f"-> {out_dir.relative_to(REPO_ROOT)}"
        )

    registry["fixtures"] = fixtures
    registry.setdefault("active", fixtures.get("scale") or next(iter(fixtures.values())))
    if args.set_active:
        registry["active"] = fixtures[args.set_active]
    DATASETS_FILE.write_text(
        json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"datasets.json active = {registry['active']}")
    return 0


def _cmd_test_vector(args: argparse.Namespace) -> int:
    from .testvector import write_test_vector

    out = Path(args.out).resolve()
    write_test_vector(out)
    print(f"wrote the shared contract test vector to {out}")
    return 0


def _cmd_build(_: argparse.Namespace) -> int:
    print(
        "eternities build runs the full Scryfall pipeline of PRD 8.2 and is Phase 1's deliverable "
        "(implementation-plan.md §2). Phase 0 froze the contract it will write through: see "
        "docs/data-contract.md and eternities.contract.",
        file=sys.stderr,
    )
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="eternities", description="Eternities data pipeline")
    parser.add_argument(
        "--version",
        action="version",
        version=f"eternities {PIPELINE_VERSION} (data contract v{CONTRACT_VERSION})",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build_cmd = sub.add_parser("build", help="run every pipeline stage (Phase 1)")
    build_cmd.set_defaults(func=_cmd_build)

    fixtures_cmd = sub.add_parser("fixtures", help="generate the seeded fixture datasets")
    fixtures_cmd.add_argument("which", choices=["small", "scale", "all"], default="all", nargs="?")
    fixtures_cmd.add_argument("--out", default=str(WEB_DATA_ROOT))
    fixtures_cmd.add_argument(
        "--set-active", choices=["small", "scale"], help="point datasets.json at this fixture"
    )
    fixtures_cmd.set_defaults(func=_cmd_fixtures)

    vector_cmd = sub.add_parser("test-vector", help="regenerate contract/test-vectors/v1")
    vector_cmd.add_argument("--out", default=str(REPO_ROOT / "contract" / "test-vectors" / "v1"))
    vector_cmd.set_defaults(func=_cmd_test_vector)

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
