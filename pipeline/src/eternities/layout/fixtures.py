"""The layout fixtures of PRD v4 5.4.14 that leg 1 of the second slice emits (9.6).

A fixture is a directory under ``contract/test-vectors/v4/layout/`` with a manifest,
``fixture.json``, that names its inputs. Its outputs stand beside the manifest and are compared
byte for byte on every run (5.4.18): ``stands.bin``, ``worlds/<slug>.json``, ``lore/<slug>.json``
(a hero world), ``report.md`` and ``check.json`` (the independent checker's document). A fixture
that must fail holds one output, ``failure.txt``: the failure's class and its message.

The manifest's fields:

- ``slug``: the plane.
- ``productionPack``: the data hash of the committed production pack, read from
  ``web/public/data/<hash>/``; or ``pack``: a synthetic contract v3 pack inside the fixture.
- ``productTables``: true to read the entry's tables from ``pipeline/data/lore/<slug>/``; or
  ``lore``: a directory inside the fixture, named for the slug; neither for the kit law.
- ``loreFixture``: true to validate the tables under ``--fixture`` (5.4.14).
- ``heroVolumes``: a hero-volumes file inside the fixture, or null.
- ``expect``: ``layout`` or ``failure``.
- ``purpose``: one sentence for the reader.

The two predicate fixtures of 5.4.14 stand in ``predicates/`` and have no manifest: each is one
document that the checker's own predicates must judge as the document says.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

from . import build, check, emit, report, trig
from .exact import Directions

REPO: Final = Path(__file__).resolve().parents[4]
ROOT: Final = REPO / "contract" / "test-vectors" / "v4" / "layout"
PREDICATES: Final = ROOT / "predicates"
PACKS: Final = REPO / "web" / "public" / "data"
PRODUCT_TABLES: Final = REPO / "pipeline" / "data" / "lore"
MANIFEST: Final = "fixture.json"
FAILURE: Final = "failure.txt"
OUTPUT_FILES: Final = ("stands.bin", "report.md", "check.json", FAILURE)
OUTPUT_DIRECTORIES: Final = ("worlds", "lore")


class FixtureError(RuntimeError):
    """A fixture's manifest cannot be read, or names an input that is not there."""


@dataclass(frozen=True, slots=True)
class Fixture:
    name: str
    directory: Path
    slug: str
    pack: Path
    lore: Path | None
    lore_fixture: bool
    volumes: Path | None
    expect: str
    purpose: str


def _load(directory: Path) -> Fixture:
    name = directory.name
    try:
        manifest = cast(
            "dict[str, Any]", json.loads((directory / MANIFEST).read_text(encoding="utf-8"))
        )
        slug = str(manifest["slug"])
        expect = str(manifest["expect"])
        purpose = str(manifest["purpose"])
    except (OSError, ValueError, KeyError) as error:
        raise FixtureError(f"fixture {name}: {MANIFEST} cannot be read ({error!r})") from None
    if expect not in ("layout", "failure"):
        raise FixtureError(f"fixture {name}: `expect` is `layout` or `failure`")
    if "productionPack" in manifest:
        pack = PACKS / str(manifest["productionPack"])
    else:
        pack = directory / str(manifest.get("pack", "pack"))
    if not (pack / "planes.json").exists():
        raise FixtureError(f"fixture {name}: the pack {pack.name} is not there")
    lore: Path | None = None
    if manifest.get("productTables"):
        lore = PRODUCT_TABLES / slug
    elif manifest.get("lore"):
        lore = directory / str(manifest["lore"])
    volumes = manifest.get("heroVolumes")
    return Fixture(
        name=name,
        directory=directory,
        slug=slug,
        pack=pack,
        lore=lore,
        lore_fixture=bool(manifest.get("loreFixture", False)),
        volumes=None if volumes is None else directory / str(volumes),
        expect=expect,
        purpose=purpose,
    )


def discover(root: Path = ROOT) -> list[Fixture]:
    """Every fixture under ``root``, by name."""
    return [_load(path.parent) for path in sorted(root.glob(f"*/{MANIFEST}"))]


def produce(
    fixture: Fixture, directions: Directions, table: trig.TrigTable, heroes: Sequence[str]
) -> dict[str, bytes]:
    """The fixture's complete output: path under the fixture's directory to bytes."""
    try:
        built = build.build_world(
            fixture.slug,
            fixture.pack,
            directions,
            lore_dir=fixture.lore,
            hero_entries=heroes,
            fixture=fixture.lore_fixture,
            volumes=fixture.volumes,
            lore_display=f"{fixture.name}/{fixture.slug}",
        )
    except build.FAILURES as error:
        return {FAILURE: f"{type(error).__name__}: {error}\n".encode()}
    result = build.check_built(built, table)
    document = result.document()
    emitted = built.emitted
    files = {
        "stands.bin": emitted.stands_bin,
        f"worlds/{fixture.slug}.json": emit.to_json(emitted.world).encode(),
        "report.md": report.render(built, document, directions).encode(),
        "check.json": emit.to_json(document).encode(),
    }
    if emitted.lore is not None:
        files[f"lore/{fixture.slug}.json"] = emit.to_json(emitted.lore).encode()
    return files


def committed(fixture: Fixture) -> dict[str, bytes]:
    """The fixture's output files as they stand in its directory."""
    found: dict[str, bytes] = {}
    for name in OUTPUT_FILES:
        path = fixture.directory / name
        if path.exists():
            found[name] = path.read_bytes()
    for name in OUTPUT_DIRECTORIES:
        for path in sorted((fixture.directory / name).glob("*.json")):
            found[f"{name}/{path.name}"] = path.read_bytes()
    return found


def differences(fixture: Fixture, produced: dict[str, bytes]) -> list[str]:
    """What a fresh run gives that the committed fixture does not hold, one line a file."""
    held = committed(fixture)
    found: list[str] = []
    expected = FAILURE in produced
    if expected != (fixture.expect == "failure"):
        outcome = produced[FAILURE].decode().strip() if expected else "a layout"
        found.append(
            f"{fixture.name}: the manifest expects a {fixture.expect}; the run gave {outcome}"
        )
    for name in sorted(set(produced) | set(held)):
        if name not in held:
            found.append(f"{fixture.name}/{name}: not committed")
        elif name not in produced:
            found.append(f"{fixture.name}/{name}: committed, and the run does not make it")
        elif produced[name] != held[name]:
            found.append(
                f"{fixture.name}/{name}: {len(produced[name]):,} bytes from the run differ from "
                f"the {len(held[name]):,} bytes committed"
            )
    return found


def write(fixture: Fixture, produced: dict[str, bytes]) -> None:
    """Replace the fixture's committed output with a fresh run's."""
    for name in committed(fixture):
        if name not in produced:
            (fixture.directory / name).unlink()
    for name, data in produced.items():
        path = fixture.directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    for name in OUTPUT_DIRECTORIES:
        directory = fixture.directory / name
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()


def predicate_failures(root: Path = PREDICATES) -> list[str]:
    """The predicate fixtures of 5.4.14 that the checker's predicates judge otherwise."""
    found: list[str] = []
    for path in sorted(root.glob("*.json")):
        document = cast("dict[str, Any]", json.loads(path.read_text(encoding="utf-8")))
        found.extend(f"predicates/{path.name}: {line}" for line in check.check_predicates(document))
    return found
