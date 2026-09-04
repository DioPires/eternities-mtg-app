"""The ``eternities build`` orchestrator (PRD 8.1.2, 8.2).

One function runs every stage in order and writes the artefacts plus the report. It owns the two
things the stages deliberately do not: the clock (``--as-of``, PRD 4.9.1) and the filesystem.

Determinism (PRD 4.9.1): the only inputs are the cached bulk file, the three curated appendices,
and the run date. ``generatedAt`` is derived from ``--as-of``, never from the wall clock, so two
runs of the same inputs produce byte-identical artefacts *and* an identical manifest.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..contract import write_dataset
from ..contract.models import Dataset
from . import records, report, scryfall, verify
from .appendices import Appendices, load_appendices
from .assemble import CardInput, build_dataset
from .records import RawPrinting, ScrySet
from .stages import (
    assign_planes,
    choose_first_printings,
    exclude_cards,
    filter_printings,
)


@dataclass(frozen=True, slots=True)
class BuildResult:
    dataset: Dataset
    data_dir: Path
    report_path: Path
    report_text: str


def build(
    *,
    as_of: str,
    data_root: Path,
    reports_dir: Path,
    cache_dir: Path,
    dataset_name: str = "production",
    roster_diff: bool = True,
    log: object = print,
) -> BuildResult:
    """Run every stage of PRD 8.2 and write the artefacts and the report."""
    emit = log if callable(log) else print

    emit("appendices: loading the three curated inputs (PRD 7.7.1)")
    appendices = load_appendices()

    emit("fetch: Scryfall default_cards + /sets (PRD 8.2.1)")
    source = scryfall.fetch(cache_dir)
    emit(f"  bulk updated_at {source.updated_at}")
    scry_sets = {
        s.code: s for s in (records.parse_set(row) for row in scryfall.read_sets(source.sets_path))
    }
    emit(f"  {len(scry_sets)} sets")

    emit("parse: reducing the bulk file to printing rows")
    all_printings = records.read_printings(scryfall.iter_cards(source.path))
    emit(f"  {len(all_printings):,} printings")

    emit("enums: PRD 7.7.2 fail-loud check")
    records.assert_known_enums(all_printings, scry_sets.values())

    emit("filter printings (PRD 4.3)")
    filtered = filter_printings(all_printings, scry_sets, appendices, as_of)
    emit(f"  {len(filtered.kept):,} kept, {sum(filtered.dropped_by_rule.values()):,} dropped")

    emit("exclude cards (PRD 4.4)")
    excluded = exclude_cards(all_printings, filtered.kept, appendices)
    emit(f"  {len(excluded.included):,} cards included")

    emit("first printing (PRD 4.5)")
    first_printings = choose_first_printings(filtered.kept, excluded.included, scry_sets)

    emit("assign plane (PRD 4.6)")
    assignment = assign_planes(first_printings, scry_sets, appendices)

    emit("detail: second pass for the oracle fields of the first printings")
    wanted = {p.id for p in first_printings.values()}
    meld_ids = _meld_result_ids(all_printings)
    details, meld_results = records.read_details(scryfall.iter_cards(source.path), wanted, meld_ids)
    missing = wanted - set(details)
    if missing:
        raise RuntimeError(
            f"{len(missing)} first printings vanished between the two passes over "
            f"{source.path.name}; the cached bulk file changed under the run"
        )

    cards = _card_inputs(first_printings, filtered.kept, assignment.by_oracle_id, details)

    emit("layout + assemble (PRD 8.6, 8.3)")
    dataset, stats = build_dataset(
        cards,
        scry_sets,
        appendices,
        meld_results,
        dataset_name=dataset_name,
        as_of=as_of,
        generated_at=f"{as_of}T00:00:00Z",
        scryfall_bulk_updated_at=source.updated_at,
    )

    emit("verify: first-run duties (implementation plan §2)")
    wiki_titles: list[str] | None = None
    if roster_diff:
        try:
            wiki_titles = verify.fetch_wiki_planes()
        except OSError as error:  # the diff is a report item, never a reason to fail a build
            emit(f"  roster diff skipped: {error}")
    findings = [
        verify.verify_security_stamp(all_printings, appendices, scry_sets),
        verify.verify_set_codes(appendices, scry_sets),
        verify.verify_universes_within(all_printings, appendices),
        verify.verify_roster(appendices, wiki_titles),
    ]

    emit("emit: artefacts (PRD 8.3) + report (PRD 4.9.2)")
    previous = report.load_previous_planes(data_root, exclude="")
    data_dir = write_dataset(dataset, data_root)

    plane_changes: list[tuple[str, str, str]] = []
    previous_run: str | None = None
    if previous is not None and previous[0] != data_dir.name:
        previous_run, previous_map = previous
        plane_changes = report.diff_planes(dataset, previous_map)

    text = report.render(
        report.ReportInput(
            dataset=dataset,
            stats=stats,
            data_dir=data_dir,
            as_of=as_of,
            bulk_updated_at=source.updated_at,
            bulk_uri=source.download_uri,
            total_printings=len(all_printings),
            total_oracle_ids=len({p.oracle_id for p in all_printings}),
            printings_dropped=filtered.dropped_by_rule,
            unreleased_sets=filtered.unreleased_sets,
            cards_excluded=excluded.excluded_by_rule,
            via_parent=assignment.via_parent,
            via_override=assignment.via_override,
            findings=findings,
            plane_changes=plane_changes,
            previous_run=previous_run,
        )
    )
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_path = reports_dir / f"{as_of}.md"
    report_path.write_text(text, encoding="utf-8")

    return BuildResult(
        dataset=dataset, data_dir=data_dir, report_path=report_path, report_text=text
    )


def _meld_result_ids(all_printings: list[RawPrinting]) -> set[str]:
    """Printing ids of every meld result, so the second pass can pick up their images.

    A meld result is excluded as a card (4.4.6) but stays reachable as its components' back face,
    and its image is its own Scryfall object — not derivable from the component (contract §9).
    """
    return {p.id for p in all_printings if p.is_meld_result}


def _card_inputs(
    first_printings: dict[str, RawPrinting],
    included_printings: list[RawPrinting],
    plane_of: dict[str, str],
    details: dict[str, records.CardDetail],
) -> list[CardInput]:
    by_oracle_id: dict[str, list[RawPrinting]] = {}
    for printing in included_printings:
        if printing.oracle_id in first_printings:
            by_oracle_id.setdefault(printing.oracle_id, []).append(printing)
    return [
        CardInput(
            oracle_id=oracle_id,
            plane_slug=plane_of[oracle_id],
            first_printing=printing,
            printings=by_oracle_id[oracle_id],
            detail=details[printing.id],
        )
        for oracle_id, printing in sorted(first_printings.items())
    ]


__all__ = ["Appendices", "BuildResult", "ScrySet", "build"]
