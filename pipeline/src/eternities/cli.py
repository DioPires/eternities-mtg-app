"""The ``eternities`` CLI.

Phase 0 ships the subcommands the contract needs. ``eternities build`` — the full Scryfall run of
PRD 8.1.2 — is Phase 1's named deliverable and is declared here so the surface is stable.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, cast

from .contract import write_dataset
from .contract.enums import CONTRACT_VERSION, PIPELINE_VERSION
from .fixtures import SCALE, SMALL, FixtureSpec, build

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_DATA_ROOT = REPO_ROOT / "web" / "public" / "data"
DATASETS_FILE = REPO_ROOT / "web" / "datasets.json"
REPORTS_DIR = REPO_ROOT / "pipeline" / "reports"
CACHE_DIR = REPO_ROOT / "pipeline" / ".cache" / "scryfall"
SWATCH_CACHE_FILE = REPO_ROOT / "pipeline" / ".cache" / "swatches" / "swatches.jsonl"

_FIXTURES: dict[str, FixtureSpec] = {"small": SMALL, "scale": SCALE}

DATA_DIR_NAME: Final = re.compile(r"^[0-9a-f]{16}$")
"""Data contract §1: a dataset directory is named for its 16-hex-character ``dataHash``."""


def _display(path: Path) -> str:
    """Repository-relative when it is inside the repository, absolute when it is not."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def remove_stale_dataset(data_root: Path, name: str) -> bool:
    """Delete a superseded dataset directory, refusing anything that is not one.

    Both call sites take ``name`` from ``web/datasets.json`` and hand it to ``rmtree``. The
    registry is a tracked file a hand-edit, a bad merge or a resolved conflict can put any string
    into, so it is trusted for the *intent* — which directory this run superseded — and never for
    the shape of the path. A name has to be a bare ``dataHash`` (data contract §1), which by
    construction cannot contain a separator, ``..`` or a drive; the parent is then re-checked
    against ``data_root`` so a symlinked child cannot redirect the delete outside the data root
    either.

    Returns whether anything was removed. A refusal prints: a registry that names a directory this
    function will not touch is a data problem to fix, not something to swallow — the same reason
    the run report exists.
    """
    if not DATA_DIR_NAME.fullmatch(name):
        print(f"  refused to remove {name!r}: not a 16-hex dataHash directory name")
        return False
    candidate = data_root / name
    if candidate.is_symlink() or not candidate.is_dir():
        print(f"  refused to remove {name!r}: not a directory (or is a symlink to one)")
        return False
    if candidate.resolve().parent != data_root.resolve():
        print(f"  refused to remove {name!r}: resolves outside {_display(data_root)}")
        return False
    shutil.rmtree(candidate)
    print(f"  removed stale {name}/")
    return True


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
            remove_stale_dataset(data_root, previous)
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
            swatch_cache_path=Path(args.swatch_cache).resolve(),
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
            remove_stale_dataset(data_root, previous)
    return 0


def _cmd_swatches(args: argparse.Namespace) -> int:
    """Warm the swatch cache without building anything (worlds spec §2.2).

    The fetch is the longest wall-clock stage in the pipeline by an order of magnitude — one
    request per card — and it is independent of the roster, the surface law and the plane geometry.
    So it gets its own command: start it early, let it run, resume it as often as needed, and only
    then pay for a build. ``--limit`` splits a cold warm across sittings.
    """
    from .pipeline.run import prepare, swatch_requests
    from .pipeline.scryfall import PinnedBulkMissingError
    from .pipeline.swatches import SwatchCache, fetch_swatches

    try:
        ready = prepare(
            as_of=str(args.as_of),
            cache_dir=Path(args.cache).resolve(),
            bulk_updated_at=args.bulk_updated_at,
        )
    except PinnedBulkMissingError as error:
        print(f"\nswatches failed — {error}", file=sys.stderr)
        return 1

    cache_path = Path(args.swatch_cache).resolve()
    cache = SwatchCache(cache_path)
    print(f"swatch cache: {_display(cache_path)} ({len(cache):,} records)")
    requests = swatch_requests(ready.cards, ready.scry_sets)
    stats = fetch_swatches(requests, cache, log=print, limit=args.limit)
    cache.close()

    print()
    print(
        f"wanted {stats.wanted:,}  cached {stats.cache_hits:,}  fetched {stats.fetched:,}  "
        f"failed {stats.failed:,}"
    )
    if stats.bytes_downloaded:
        print(
            f"downloaded {stats.bytes_downloaded / 1e6:,.1f} MB in {stats.elapsed_s / 60:.1f} min"
        )
    for printing_id, reason in stats.failures[:20]:
        print(f"  failed {printing_id}: {reason}")
    if stats.failed > 20:
        print(f"  ... and {stats.failed - 20} more")
    remaining = stats.wanted - stats.cache_hits - stats.fetched
    if remaining:
        print(f"{remaining:,} still missing — re-run to resume")
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
    build_cmd.add_argument(
        "--swatch-cache",
        default=str(SWATCH_CACHE_FILE),
        help="the (printing id, imageTs)-keyed swatch cache the art statistic is read from",
    )
    build_cmd.set_defaults(func=_cmd_build)

    swatch_cmd = sub.add_parser(
        "swatches",
        help="warm the swatch cache (worlds spec §2.2) without building; resumable, safe to repeat",
    )
    swatch_cmd.add_argument("--as-of", default=_today(), metavar="YYYY-MM-DD")
    swatch_cmd.add_argument("--cache", default=str(CACHE_DIR), help="Scryfall download cache")
    swatch_cmd.add_argument("--swatch-cache", default=str(SWATCH_CACHE_FILE))
    swatch_cmd.add_argument("--bulk-updated-at", default=None, metavar="TIMESTAMP")
    swatch_cmd.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="stop after N new fetches. The cache is append-only and resumable, so this splits a "
        "cold warm across sittings instead of holding one process open for an hour.",
    )
    swatch_cmd.set_defaults(func=_cmd_swatches)

    fixtures_cmd = sub.add_parser("fixtures", help="generate the seeded fixture datasets")
    fixtures_cmd.add_argument("which", choices=["small", "scale", "all"], default="all", nargs="?")
    fixtures_cmd.add_argument("--out", default=str(WEB_DATA_ROOT))
    fixtures_cmd.add_argument(
        "--set-active", choices=["small", "scale"], help="point datasets.json at this fixture"
    )
    fixtures_cmd.set_defaults(func=_cmd_fixtures)

    vector_cmd = sub.add_parser("test-vector", help="regenerate contract/test-vectors/v2")
    vector_cmd.add_argument("--out", default=str(REPO_ROOT / "contract" / "test-vectors" / "v2"))
    vector_cmd.set_defaults(func=_cmd_test_vector)

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
