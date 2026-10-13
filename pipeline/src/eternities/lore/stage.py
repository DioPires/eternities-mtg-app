"""The lore stage of a pipeline run (PRD v4 4.16.2, 4.16.5, 9.1.5, Appendix F.5, 9.6).

One function, :func:`run_stage`, does on every run what those sections ask of one:

1. reads the twenty hero entries (``vocabulary``);
2. validates the tables of every hero entry directory under ``pipeline/data/lore/``, and its Story
   Spotlight sidecar when the directory has one;
3. validates the schema example of Appendix F.5 under the ordinary rules, with no flag, and asserts
   that the expansion rule still generates the committed bytes;
4. derives each entry's acceptance status (F.2) and, under ``distribution``, fails on any entry
   that is not accepted.

``eternities build`` runs it on the dataset it has just assembled. ``eternities lore check`` and
the tests run it on the committed production pack.

**Three states of a hero entry's directory** (4.16.5):

- no directory, or a directory with none of the three tables (a sidecar alone): the entry has no
  tables. A development build lays it out by the kit law and the report lists it under "hero
  entries without tables"; a distribution build fails naming it.
- the three tables, valid: the entry is laid out from them whatever its acceptance status.
- anything else (one or two of the three files, or a rule broken): the build fails in both modes.

A directory under ``pipeline/data/lore/`` that is not named for a hero entry fails the build too:
F.0 requires the directory to match an Appendix C.1 row, and a misspelt directory would otherwise
be an entry silently left without tables.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final

from . import example
from .digest import AcceptanceStatus
from .index import LoreIndex
from .problems import LoreValidationError
from .spotlight import SIDECAR_NAME, SpotlightSidecar, validate_sidecar
from .tables import LoreTables, has_tables, validate_directory
from .vocabulary import load_hero_entries

REPO_ROOT: Final = Path(__file__).resolve().parents[4]
LORE_ROOT: Final = REPO_ROOT / "pipeline" / "data" / "lore"


class LoreStageError(RuntimeError):
    """The lore stage stops the build. The message names every entry and every rule."""


@dataclass(frozen=True, slots=True)
class EntryResult:
    slug: str
    expected_sets: tuple[str, ...]
    """The set codes with first printings on the plane, which the tables must map once each."""
    tables: LoreTables | None
    """``None`` when the entry has no tables (4.16.5)."""
    sidecar: SpotlightSidecar | None


@dataclass(frozen=True, slots=True)
class ExampleResult:
    directory: str
    tables: LoreTables


@dataclass(frozen=True, slots=True)
class LoreStageResult:
    dataset: str
    entries: tuple[EntryResult, ...]
    """The twenty hero entries, in Appendix C.1's order."""
    example: ExampleResult | None
    distribution: bool

    @property
    def without_tables(self) -> tuple[str, ...]:
        return tuple(entry.slug for entry in self.entries if entry.tables is None)


@dataclass(frozen=True, slots=True)
class LoreInputs:
    """Where a run's lore stage reads. The defaults are the committed inputs.

    A run over a dataset that is not the production roster replaces them: the committed tables,
    the schema example and the sidecar name real set codes and real printings, and the twenty hero
    entries are planes such a dataset may hold no card on.
    """

    root: Path = LORE_ROOT
    example_dir: Path | None = example.EXAMPLE_DIR
    """``None`` skips the schema example."""
    hero_entries: tuple[str, ...] | None = None
    """``None`` reads the committed list, which asserts the twenty (4.16.5)."""


def _display(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def run_stage(
    index: LoreIndex,
    *,
    lore_root: Path = LORE_ROOT,
    example_dir: Path | None = example.EXAMPLE_DIR,
    hero_entries: tuple[str, ...] | None = None,
    distribution: bool = False,
) -> LoreStageResult:
    """Validate every lore input against ``index``; raise :class:`LoreStageError` on any failure.

    ``example_dir=None`` skips the schema example. Only a run on a dataset that is not the
    production roster passes it: the example names Dominaria's real set codes.
    """
    heroes = hero_entries or load_hero_entries()
    failures: list[str] = []

    if lore_root.is_dir():
        for child in sorted(lore_root.iterdir()):
            if child.is_dir() and child.name not in heroes:
                failures.append(
                    f"{_display(child)} is not named for a hero entry of Appendix C.1; a lore "
                    "directory is pipeline/data/lore/<slug>/ (PRD v4 4.16.1, F.0)"
                )

    entries: list[EntryResult] = []
    for slug in heroes:
        directory = lore_root / slug
        sidecar: SpotlightSidecar | None = None
        tables: LoreTables | None = None
        try:
            if (directory / SIDECAR_NAME).exists():
                sidecar = validate_sidecar(
                    directory / SIDECAR_NAME,
                    index,
                    hero_entries=heroes,
                    display=_display(directory),
                )
            if has_tables(directory):
                tables = validate_directory(
                    directory,
                    index,
                    hero_entries=heroes,
                    spotlight_sets=None if sidecar is None else sidecar.sets_with_cards,
                    display=_display(directory),
                )
        except LoreValidationError as error:
            failures.append(str(error))
        entries.append(
            EntryResult(
                slug=slug, expected_sets=index.expected_sets(slug), tables=tables, sidecar=sidecar
            )
        )

    checked_example: ExampleResult | None = None
    if example_dir is not None:
        try:
            checked_example = _example(index, example_dir, heroes)
        except (LoreValidationError, example.ExampleError) as error:
            failures.append(str(error))

    if failures:
        raise LoreStageError("\n".join(failures))

    if distribution:
        _require_acceptance(entries, lore_root)

    return LoreStageResult(
        dataset=index.label,
        entries=tuple(entries),
        example=checked_example,
        distribution=distribution,
    )


def _example(index: LoreIndex, example_dir: Path, heroes: tuple[str, ...]) -> ExampleResult:
    """F.5: the committed example validates with no flag, and the rule regenerates its bytes.

    It is a fixture input, never the entry's tables, so its acceptance is not asked for.
    """
    directory = example_dir / example.PLANE
    tables = validate_directory(directory, index, hero_entries=heroes, display=_display(directory))
    differing = example.differing_files(index, example_dir)
    if differing:
        raise example.ExampleError(
            f"{_display(directory)}: {', '.join(differing)} are not what the expansion rule of "
            f"Appendix F.5 generates on dataset {index.label}. Run "
            "`uv run python scripts/lore_example.py` and commit the result, or correct the rule."
        )
    return ExampleResult(directory=_display(directory), tables=tables)


def acceptance_refusal(tables: LoreTables, where: str) -> str | None:
    """Why a valid table set is not accepted (F.2), or ``None`` when it is."""
    if tables.status is AcceptanceStatus.ABSENT:
        return f"{where}/eras.json carries no `accepted` record"
    if tables.status is AcceptanceStatus.STALE:
        return (
            f"the `accepted` record of {where} is stale: it names {tables.recorded_digest} and "
            f"the files are {tables.digest}"
        )
    return None


def _require_acceptance(entries: list[EntryResult], lore_root: Path) -> None:
    """4.16.5: under ``--distribution`` every hero entry has tables, and they are accepted."""
    refused: list[str] = []
    for entry in entries:
        where = _display(lore_root / entry.slug)
        if entry.tables is None:
            what = "no lore directory" if not (lore_root / entry.slug).is_dir() else "no tables"
            refused.append(f"{entry.slug}: {what} at {where}")
        else:
            refusal = acceptance_refusal(entry.tables, where)
            if refusal is not None:
                refused.append(f"{entry.slug}: {refusal}")
    if refused:
        noun = "entry is" if len(refused) == 1 else "entries are"
        raise LoreStageError(
            f"--distribution: {len(refused)} hero {noun} not accepted (PRD v4 4.16.5):\n"
            + "\n".join(f"  {line}" for line in refused)
        )


def report_section(result: LoreStageResult | None) -> list[str]:
    """The run report's lore section: per hero entry its set codes, status and digest."""
    out = ["## Lore tables (PRD v4 4.16)", ""]
    if result is None:
        out.append("Not run.")
        return out

    out.append(
        f"Checked against dataset `{result.dataset}`. A hero entry's tables must map each of its "
        "set codes below to exactly one era (4.16.2). The acceptance status is F.2's: reported on "
        "every run, enforced only by `--distribution` (4.16.5)."
    )
    out.extend(
        ["", "| Hero entry | Tables | Acceptance | Digest | Set codes with first printings |"]
    )
    out.append("|---|---|---|---|---|")
    for entry in result.entries:
        codes = ", ".join(f"`{code}`" for code in entry.expected_sets) or "none"
        if entry.tables is None:
            cells = ["none", "n/a", "n/a"]
        else:
            cells = [entry.tables.kind, f"**{entry.tables.status}**", f"`{entry.tables.digest}`"]
        out.append(
            f"| `{entry.slug}` | {' | '.join(cells)} | {len(entry.expected_sets)}: {codes} |"
        )

    missing = result.without_tables
    out.extend(["", f"### Hero entries without tables ({len(missing)})", ""])
    if missing:
        out.append(", ".join(f"`{slug}`" for slug in missing))
        out.append("")
        out.append(
            "A development build lays these out by the kit law; a `--distribution` build fails "
            "naming each (4.16.5)."
        )
    else:
        out.append("None.")

    out.extend(["", "### Distribution (4.16.5)", ""])
    if result.distribution:
        out.append(
            "`--distribution`: every hero entry's tables validate and carry a matching `accepted` "
            "record. The manifest records `distribution: true`."
        )
    else:
        accepted = sum(
            1
            for entry in result.entries
            if entry.tables is not None and entry.tables.status is AcceptanceStatus.ACCEPTED
        )
        out.append(
            f"Not requested. {accepted} of {len(result.entries)} hero entries are accepted; "
            "a `--distribution` build needs all of them."
        )

    variants = [
        v for entry in result.entries if entry.tables for v in entry.tables.unchecked_variants
    ]
    if variants:
        out.extend(["", "### Variants not checked", ""])
        out.append(
            "`kits.yaml` (4.12) is not in the pipeline, so these `variant` values were checked "
            "for their form only: " + "; ".join(f"`{variant}`" for variant in variants) + "."
        )

    out.extend(["", "### Schema example (Appendix F.5)", ""])
    if result.example is None:
        out.append("Not checked on this run.")
    else:
        out.append(
            f"`{result.example.directory}/` validates under the ordinary rules with no flag, and "
            "the expansion rule regenerates its three files byte for byte. Digest "
            f"`{result.example.tables.digest}`, acceptance status "
            f"**{result.example.tables.status}** (a fixture input, never the entry's tables)."
        )

    out.extend(["", "### Story Spotlight sidecars (9.6)", ""])
    sidecars = [entry.sidecar for entry in result.entries if entry.sidecar is not None]
    if not sidecars:
        out.append("None.")
    for sidecar in sidecars:
        on_plane = sidecar.on_plane
        by_set = ", ".join(f"`{code}` {count}" for code, count in sidecar.by_set.items())
        two_faced = sum(1 for printing in sidecar.printings if printing.back_name is not None)
        out.append(
            f"`{sidecar.plane}`: **{sidecar.count}** printings, every one a printing of the "
            f"dataset, on {len({p.oracle_id for p in sidecar.printings})} cards ({by_set}). "
            f"{len(on_plane)} are cards of `{sidecar.plane}`; the other "
            f"{sidecar.count - len(on_plane)} stand on another plane. {two_faced} "
            f"{'has' if two_faced == 1 else 'have'} a second face. Fetched on "
            f"{sidecar.fetched_on} by `{sidecar.fetch_script}` from the bulk file of "
            f"{sidecar.bulk_updated_at}."
        )
    undecided = [
        entry.slug for entry in result.entries if entry.tables is not None and entry.sidecar is None
    ]
    if undecided:
        out.append("")
        out.append(
            "No sidecar, so F.0's rule that `headline` is empty when the era's sets carry Story "
            "Spotlight cards was not checked for: " + ", ".join(f"`{s}`" for s in undecided) + "."
        )
    return out
