"""The ``eternities`` CLI.

Phase 0 ships the subcommands the contract needs. ``eternities build`` — the full Scryfall run of
PRD 8.1.2 — is Phase 1's named deliverable and is declared here so the surface is stable.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from .contract import write_dataset
from .contract.enums import CONTRACT_VERSION, PIPELINE_VERSION
from .fixtures import SCALE, SMALL, FixtureSpec, build

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_DATA_ROOT = REPO_ROOT / "web" / "public" / "data"
DATASETS_FILE = REPO_ROOT / "web" / "datasets.json"
REPORTS_DIR = REPO_ROOT / "pipeline" / "reports"
CACHE_DIR = REPO_ROOT / "pipeline" / ".cache" / "scryfall"

_FIXTURES: dict[str, FixtureSpec] = {"small": SMALL, "scale": SCALE}


def _display(path: Path) -> str:
    """Repository-relative when it is inside the repository, absolute when it is not."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _cmd_fixtures(args: argparse.Namespace) -> int:
    data_root = Path(args.out).resolve()
    names: list[str] = list(_FIXTURES) if args.which == "all" else [args.which]
    # Only the canonical data directory owns `datasets.json`. Writing fixtures somewhere else is
    # a scratch run — CI does exactly this to diff against what is committed — and must not
    # mutate a tracked file.
    owns_registry = data_root == WEB_DATA_ROOT.resolve()

    registry: dict[str, Any] = {}
    if DATASETS_FILE.exists():
        registry = cast("dict[str, Any]", json.loads(DATASETS_FILE.read_text(encoding="utf-8")))
    fixtures: dict[str, str] = {
        str(k): str(v) for k, v in cast("dict[str, Any]", registry.get("fixtures", {})).items()
    }
    # Which *fixture* the app is pointed at, resolved before the hashes move under us. The registry
    # stores a hash, but the intent it encodes is a name, and regenerating changes every hash.
    previous_active = str(registry.get("active", ""))
    active_name = next((n for n, h in fixtures.items() if h == previous_active), None)

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
            f"-> {_display(out_dir)}"
        )

    if not owns_registry:
        if args.set_active:
            print(f"--set-active ignored: {_display(data_root)} is not the canonical data root")
        return 0

    registry["fixtures"] = fixtures
    # Follow the fixture, not the hash. Regenerating rewrites every content hash and deletes the
    # old directory, so a `setdefault` here would leave `active` pointing at a directory that no
    # longer exists and the app fetching 404s until someone thought to pass `--set-active`.
    #
    # When `active` is not a fixture at all it is something this command does not own — Phase 1's
    # real dataset, which supersedes the fixtures as what the app ships (PRD 8.3) — and only
    # `--set-active` may move it. Regenerating fixtures must not quietly point the app back at
    # synthetic data.
    if active_name:
        fallback = fixtures.get("scale") or next(iter(fixtures.values()))
        registry["active"] = fixtures.get(active_name, fallback)
    elif not previous_active:
        registry["active"] = fixtures.get("scale") or next(iter(fixtures.values()))
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


def _cmd_build(args: argparse.Namespace) -> int:
    from .pipeline import UnmappedSetError
    from .pipeline import build as run_pipeline
    from .pipeline.records import UnknownEnumError
    from .pipeline.scryfall import PinnedBulkMissingError

    data_root = Path(args.out).resolve()
    try:
        result = run_pipeline(
            as_of=str(args.as_of),
            data_root=data_root,
            reports_dir=Path(args.reports).resolve(),
            cache_dir=Path(args.cache).resolve(),
            dataset_name=str(args.dataset),
            roster_diff=not args.no_roster_diff,
            bulk_updated_at=args.bulk_updated_at,
        )
    except (UnknownEnumError, UnmappedSetError, PinnedBulkMissingError) as error:
        # PRD 7.7.2, 4.6.4 and the pinned cache key are the rules that stop a run rather than
        # guess. None is a crash to be read from a traceback: the message names what to add
        # and where.
        print(f"\nbuild failed — {error}", file=sys.stderr)
        return 1

    print()
    print(f"data:   {_display(result.data_dir)}")
    print(f"report: {_display(result.report_path)}")

    if data_root == WEB_DATA_ROOT.resolve():
        registry: dict[str, Any] = {}
        if DATASETS_FILE.exists():
            registry = cast("dict[str, Any]", json.loads(DATASETS_FILE.read_text(encoding="utf-8")))
        previous = str(registry.get("production", ""))
        registry["production"] = result.data_dir.name
        # A real dataset supersedes the fixtures as what the app ships (PRD 8.3).
        registry["active"] = result.data_dir.name
        DATASETS_FILE.write_text(
            json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(f"datasets.json active = {result.data_dir.name}")
        if previous and previous != result.data_dir.name and (data_root / previous).exists():
            # PRD 8.8.3: the stale hash directory goes in the same pull request.
            shutil.rmtree(data_root / previous)
            print(f"  removed stale {previous}/")
    return 0


def _today() -> str:
    return datetime.now(tz=UTC).date().isoformat()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="eternities", description="Eternities data pipeline")
    parser.add_argument(
        "--version",
        action="version",
        version=f"eternities {PIPELINE_VERSION} (data contract v{CONTRACT_VERSION})",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build_cmd = sub.add_parser(
        "build", help="run every pipeline stage against Scryfall and write artefacts + report"
    )
    build_cmd.add_argument(
        "--as-of",
        default=_today(),
        metavar="YYYY-MM-DD",
        help="run date (PRD 4.9.1). Fixes which sets have shipped (4.3.8) and is recorded in the "
        "manifest; the same date and inputs give byte-identical artefacts. Default: today.",
    )
    build_cmd.add_argument(
        "--bulk-updated-at",
        default=None,
        metavar="TIMESTAMP",
        help="pin the Scryfall bulk cache key, e.g. 2026-09-04T09:05:32.308+00:00. Reuses the "
        "cached file with that `updated_at` and makes no network call, so an appendix-only "
        "re-run is not silently fed a newer card file (PRD 4.9.1). Fails if the cache lacks it.",
    )
    build_cmd.add_argument("--out", default=str(WEB_DATA_ROOT), help="data root directory")
    build_cmd.add_argument("--reports", default=str(REPORTS_DIR), help="report directory")
    build_cmd.add_argument("--cache", default=str(CACHE_DIR), help="Scryfall download cache")
    build_cmd.add_argument(
        "--dataset", default="production", help="manifest `dataset` label (PRD 8.3)"
    )
    build_cmd.add_argument(
        "--no-roster-diff",
        action="store_true",
        help="skip the MTG wiki roster diff (implementation plan §2); the run still succeeds "
        "without network access to the wiki",
    )
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
