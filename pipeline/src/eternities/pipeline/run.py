"""The ``eternities build`` orchestrator (PRD 8.1.2, 8.2).

One function runs every stage in order and writes the artefacts plus the report. It owns the two
things the stages deliberately do not: the clock (``--as-of``, PRD 4.9.1) and the filesystem.

Determinism (PRD 4.9.1): the only inputs are the cached bulk file, the three curated appendices,
and the run date. ``generatedAt`` is derived from ``--as-of``, never from the wall clock, so two
runs of the same inputs produce byte-identical artefacts *and* an identical manifest.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..contract import write_dataset
from ..contract.models import Dataset
from . import records, report, scryfall, verify
from .appendices import Appendices, load_appendices
from .assemble import CardInput, build_dataset, printing_order
from .records import MeldResult, RawPrinting, ScrySet
from .stages import (
    CardExclusionResult,
    PlaneAssignment,
    PrintingFilterResult,
    assign_planes,
    choose_first_printings,
    exclude_cards,
    filter_printings,
)
from .swatches import DEFAULT_CACHE as SWATCH_CACHE
from .swatches import SwatchCache, SwatchRequest, fetch_swatches


@dataclass(frozen=True, slots=True)
class BuildResult:
    dataset: Dataset
    data_dir: Path
    report_path: Path
    report_text: str


@dataclass(frozen=True, slots=True)
class Prepared:
    """Everything the Scryfall-reading half of the run produces, before layout.

    Extracted because the swatch stage (§2.2) needs exactly this and nothing after it: the art a
    cell shows is a property of the card's printing list, which is fixed here, and is independent
    of the roster, the surface law and the plane geometry. Warming the swatch cache is therefore a
    separate command that reuses the same seven stages rather than a second implementation of them.
    """

    source: scryfall.BulkSource
    scry_sets: dict[str, ScrySet]
    appendices: Appendices
    all_printings: list[RawPrinting]
    filtered: PrintingFilterResult
    excluded: CardExclusionResult
    assignment: PlaneAssignment
    cards: list[CardInput]
    meld_results: dict[str, MeldResult]


def prepare(
    *,
    as_of: str,
    cache_dir: Path,
    bulk_updated_at: str | None = None,
    emit: Callable[[str], object] = print,
) -> Prepared:
    """Stages 1-5 of PRD 8.2: fetch, parse, filter, exclude, first printing, assign, detail."""
    emit("appendices: loading the three curated inputs (PRD 7.7.1)")
    appendices = load_appendices()

    emit("fetch: Scryfall default_cards + /sets (PRD 8.2.1)")
    source = scryfall.fetch(cache_dir, pinned_updated_at=bulk_updated_at)
    if bulk_updated_at is not None:
        emit(f"  pinned to the cached bulk file {source.path.name}")
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
    excluded = exclude_cards(all_printings, filtered.kept, appendices, scry_sets)
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

    return Prepared(
        source=source,
        scry_sets=scry_sets,
        appendices=appendices,
        all_printings=all_printings,
        filtered=filtered,
        excluded=excluded,
        assignment=assignment,
        cards=_card_inputs(first_printings, filtered.kept, assignment.by_oracle_id, details),
        meld_results=meld_results,
    )


def swatch_requests(cards: list[CardInput], scry_sets: dict[str, ScrySet]) -> list[SwatchRequest]:
    """One art source per card: printing index 0, which is what §2.3 says a cell shows.

    Order is the caller's business — the cache is keyed by ``(id, imageTs)`` and is indifferent to
    it — but the list is built from :func:`~eternities.pipeline.assemble.printing_order`, the same
    function ``p`` is written from, so the swatch and the credit can never disagree.
    """
    out: list[SwatchRequest] = []
    for card in cards:
        first = printing_order(card, scry_sets)[0]
        out.append(
            SwatchRequest(oracle_id=card.oracle_id, printing_id=first.id, image_ts=first.image_ts)
        )
    return out


def build(
    *,
    as_of: str,
    data_root: Path,
    reports_dir: Path,
    cache_dir: Path,
    dataset_name: str = "production",
    roster_diff: bool = True,
    bulk_updated_at: str | None = None,
    swatch_cache_path: Path | None = None,
    log: Callable[[str], object] = print,
) -> BuildResult:
    """Run every stage of PRD 8.2 and write the artefacts and the report."""
    emit = log

    ready = prepare(as_of=as_of, cache_dir=cache_dir, bulk_updated_at=bulk_updated_at, emit=emit)
    source, scry_sets, appendices = ready.source, ready.scry_sets, ready.appendices
    all_printings, cards, meld_results = ready.all_printings, ready.cards, ready.meld_results
    filtered, excluded, assignment = ready.filtered, ready.excluded, ready.assignment

    emit("swatches: per-card art statistic (worlds spec §2.2)")
    cache = SwatchCache(swatch_cache_path or SWATCH_CACHE)
    requests = swatch_requests(cards, scry_sets)
    swatch_stats = fetch_swatches(requests, cache, log=emit)
    if swatch_stats.failures:
        emit(f"  {swatch_stats.failed} swatches failed; the build will refuse to publish")
    cache.close()

    emit("layout + assemble (PRD 8.6, 8.3)")
    dataset, stats = build_dataset(
        cards,
        scry_sets,
        appendices,
        meld_results,
        swatches=cache,
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
        verify.verify_universes_within(all_printings, appendices, scry_sets),
        verify.verify_roster(appendices, wiki_titles),
    ]

    emit("emit: artefacts (PRD 8.3) + report (PRD 4.9.2)")
    previous = report.load_previous_planes(data_root)
    # Read the predecessor's own record *before* the write replaces it — on a re-run in a pruned
    # tree that directory is this run's own. `manifest_chain` explains what the pair is for.
    carried = report.recorded_previous_run(data_root / previous.name) if previous else None
    data_dir = write_dataset(
        dataset, data_root, previous_runs=report.manifest_chain(previous, carried)
    )

    plane_changes: list[tuple[str, str, str]] = []
    previous_run: str | None = None
    previous_run_pruned = False
    previous_run_contract_version: str | None = None
    if previous is not None and previous.name != data_dir.name:
        previous_run = previous.name
        if previous.planes is None:
            # A predecessor this build cannot decode is still the predecessor: `manifest_chain`
            # named it regardless, so the manifest chain holds, and only the diff is lost.
            previous_run_contract_version = previous.contract_version
        else:
            plane_changes = report.diff_planes(dataset, previous.planes)
    elif carried is not None:
        previous_run, previous_run_pruned = carried, True

    text = report.render(
        report.ReportInput(
            dataset=dataset,
            stats=stats,
            data_dir=data_dir,
            as_of=as_of,
            bulk_updated_at=source.updated_at,
            bulk_uri=source.download_uri,
            bulk_uri_reconstructed=source.uri_reconstructed,
            swatches=swatch_stats,
            total_printings=len(all_printings),
            total_oracle_ids=len({p.oracle_id for p in all_printings}),
            printings_dropped=filtered.dropped_by_rule,
            unreleased_by_set=filtered.unreleased_by_set,
            dropped_via_parent=filtered.dropped_via_parent,
            parent_rule_only=filtered.parent_rule_only,
            cards_excluded=excluded.excluded_by_rule,
            via_parent=assignment.via_parent,
            via_override=assignment.via_override,
            unused_overrides=assignment.unused_overrides,
            findings=findings,
            plane_changes=plane_changes,
            previous_run=previous_run,
            previous_run_pruned=previous_run_pruned,
            previous_run_contract_version=previous_run_contract_version,
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
