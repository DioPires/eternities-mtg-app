"""The run report of PRD 4.9.2, written to ``pipeline/reports/<date>.md``.

The report is the reviewable artefact: PRD 8.8.3 commits it beside the data so a refresh is
reviewed as a diff, and PRD 9.2 makes three of its sections quality gates. Everything it prints
comes from counters the stages returned, so a rule that silently dropped cards shows up here as a
number that moved.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from ..contract.binary import decode_sets
from ..contract.enums import CONTRACT_VERSION
from ..contract.models import Dataset
from .assemble import BRIGHTNESS_PERCENTILE, AssemblyStats
from .swatches import CONCURRENCY, SWATCH_SOURCE, SwatchStats
from .verify import Finding

BLIND_ETERNITIES_SLUG = "blind-eternities"


@dataclass(slots=True)
class ReportInput:
    dataset: Dataset
    stats: AssemblyStats
    data_dir: Path
    as_of: str
    bulk_updated_at: str
    bulk_uri: str
    total_printings: int
    total_oracle_ids: int
    printings_dropped: Counter[str]
    unreleased_by_set: dict[str, int]
    cards_excluded: Counter[str]
    via_parent: dict[str, str]
    via_override: list[str]
    bulk_uri_reconstructed: bool = False
    """See ``BulkSource.uri_reconstructed``: the URI is a local cache path, so say so on the row."""
    swatches: SwatchStats | None = None
    """What §2.2's fetch cost this run. ``None`` for a dataset built without a swatch cache."""
    unused_overrides: list[str] = field(default_factory=list)
    """``overrides.json`` records that matched no first printing (see ``PlaneAssignment``)."""
    dropped_via_parent: dict[str, str] = field(default_factory=dict)
    """PRD 4.3.1 read through 4.6.3: set code -> the ancestor whose row dropped it."""
    parent_rule_only: dict[str, int] = field(default_factory=dict)
    """Set code -> printings no other 4.3 rule would have dropped."""
    findings: list[Finding] = field(default_factory=list)
    plane_changes: list[tuple[str, str, str]] = field(default_factory=list)
    """``(card name, previous plane, new plane)`` — PRD 4.9.2's last section."""
    previous_run: str | None = None
    previous_run_pruned: bool = False
    """The predecessor is known but its artefacts are gone (PRD 8.8.3), so no diff was computed.

    Distinct from ``previous_run is None``, which means there was never a predecessor. Saying
    "first production run" on a rebuild is a false claim about the data, not a missing detail."""
    previous_run_contract_version: str | None = None
    """The ``contractVersion`` the predecessor recorded (as JSON text, see ``PreviousRun``) when it
    is not the one this build speaks, so its artefacts are present but cannot be decoded.

    The third way to reach "no diff", and it is not the same as either of the other two: unlike
    ``previous_run is None`` there was a predecessor, and unlike ``previous_run_pruned`` its files
    are still on disk. Only the reader has moved on. The manifest link is unaffected either way."""


def recorded_previous_run(directory: Path) -> str | None:
    """The predecessor a committed run recorded in its own manifest (contract §3).

    The tree holds one production directory at a time (PRD 8.8.3), so a rebuild finds only the run
    it is about to overwrite and has nothing to diff against. That run's manifest still remembers
    what *it* followed, which is the chain 4.9.2 needs to stay unbroken across a re-run.
    """
    manifest_path = directory / "manifest.json"
    if not manifest_path.exists():
        return None
    manifest = cast("dict[str, Any]", json.loads(manifest_path.read_text(encoding="utf-8")))
    recorded = manifest.get("previousRun")
    return str(recorded) if recorded else None


@dataclass(frozen=True, slots=True)
class PreviousRun:
    """The production run this one follows, and its plane mapping if this build can read it."""

    name: str
    planes: dict[str, str] | None = None
    """``oracle_id -> plane slug``, or ``None`` when the artefacts could not be decoded."""
    contract_version: str | None = None
    """Set with ``planes = None``: the ``contractVersion`` the predecessor's manifest recorded,
    as JSON text, because it is not always the integer it should be.

    Carried rather than reduced to a flag so the report can name what it found. ``"null"`` (the
    key was absent) and ``'"1"'`` (a string where an integer belongs) are both real ways for a
    predecessor to become unreadable, and both are worth reading in the report rather than
    flattening into "some other version"."""


def load_previous_planes(data_root: Path) -> PreviousRun | None:
    """Find the previous production run and reconstruct ``oracle_id -> plane slug`` from it.

    No sidecar file: ``planes.json`` gives each plane's contiguous star range (data contract §2)
    and ``sets.bin``'s ORACLE_IDS section gives the star order, which is all the mapping needs.

    "Previous" is the run with the latest ``asOf``/``generatedAt``, not the lexicographically
    largest directory name. Directory names are content hashes and carry no ordering, so sorting on
    them picks an arbitrary run the moment two production directories co-exist — and 4.9.2's diff
    is only meaningful against the run this one actually follows.

    ``None`` means one thing only: no production run exists to follow. A predecessor written under
    another contract version still *is* the predecessor, so it is selected like any other and
    returned with ``planes = None`` — the caller keeps the manifest link and the report says why
    the diff is missing, rather than both of them claiming this is a first run.
    """
    production: list[tuple[tuple[str, str, str], Path, Any]] = []
    for directory in data_root.glob("*"):
        if not directory.is_dir():
            continue
        manifest_path = directory / "manifest.json"
        if not manifest_path.exists():
            continue
        manifest = cast("dict[str, Any]", json.loads(manifest_path.read_text(encoding="utf-8")))
        if manifest.get("dataset") != "production":
            continue
        key = (str(manifest.get("asOf", "")), str(manifest.get("generatedAt", "")), directory.name)
        production.append((key, directory, manifest.get("contractVersion")))

    if not production:
        return None
    _, directory, version = max(production, key=lambda entry: entry[0])
    if version != CONTRACT_VERSION:
        # Selected, but not decoded: `decode_sets` tests the header for strict equality and would
        # abort the whole run. The 4.9.2 diff is informational, so an unreadable predecessor loses
        # the diff and nothing else — the run succeeds, `previousRun` still names it, and the
        # report says the artefacts are there but this build cannot read them.
        return PreviousRun(directory.name, contract_version=json.dumps(version))
    planes_doc = cast(
        "dict[str, Any]", json.loads((directory / "planes.json").read_text(encoding="utf-8"))
    )
    oracle_ids, _ = decode_sets((directory / "sets.bin").read_bytes())
    mapping: dict[str, str] = {}
    for plane in cast("list[dict[str, Any]]", planes_doc["planes"]):
        start = int(plane["starOffset"])
        for oracle_id in oracle_ids[start : start + int(plane["starCount"])]:
            mapping[oracle_id] = str(plane["slug"])
    return PreviousRun(directory.name, planes=mapping)


def manifest_chain(previous: PreviousRun | None, carried: str | None) -> list[str | None]:
    """The candidate predecessors ``write_dataset`` records in the manifest, in priority order.

    The manifest records which run the 4.9.2 diff was taken against, because 8.8.3 deletes that
    directory in the same commit and the report names it in prose only. There are two candidates
    because a *re-run* in an already-pruned tree finds only the directory it is about to overwrite:
    ``carried`` is what that directory's own manifest recorded (``recorded_previous_run``), which is
    the predecessor the first build established, and using it keeps the re-run byte-identical
    (4.9.1) instead of dropping the field and claiming to be a first run.

    ``previous`` contributes its **name**, never its ``planes``. That is the whole content of this
    function and it is DEC-647 B1: a predecessor this build cannot decode is still the predecessor,
    so the chain holds and only the diff is lost. Gating the name on ``planes is not None`` puts
    "First production run" into the report of a third run and silently drops the link — which is
    why the composition lives here, in one place a test can hold, rather than inline at the one
    call site in ``run.build``.
    """
    return [previous.name if previous else None, carried]


def diff_planes(dataset: Dataset, previous: dict[str, str]) -> list[tuple[str, str, str]]:
    """PRD 4.9.2: cards whose plane changed since the last run."""
    current: dict[str, tuple[str, str]] = {}
    for plane in dataset.planes:
        for card in dataset.cards[plane.star_offset : plane.star_offset + plane.star_count]:
            current[card.oracle_id] = (card.name, plane.slug)
    changes = [
        (name, previous[oracle_id], slug)
        for oracle_id, (name, slug) in current.items()
        if oracle_id in previous and previous[oracle_id] != slug
    ]
    return sorted(changes)


def _plane_change_gate(
    changes: int, previous_run: str | None, pruned: bool, contract_version: str | None
) -> str:
    """PRD 9.2.3's cell. Four states, because "0" means several very different things."""
    if previous_run is None:
        return f"{changes} — no previous production run to compare against"
    if pruned:
        return (
            f"not computed — this run follows `{previous_run}`, whose artefacts 8.8.3 removed "
            "when it was superseded, so there is nothing left to diff against"
        )
    if contract_version is not None:
        return (
            f"not computed — this run follows `{previous_run}`, whose artefacts are still in the "
            f"tree but record `contractVersion` {contract_version}; this build speaks "
            f"{CONTRACT_VERSION} and cannot decode them"
        )
    return f"{changes} (vs run `{previous_run}`)"


def _parent_rule_only_note(via_parent: dict[str, str], parent_only: dict[str, int]) -> str:
    """How much of the table above the parent walk is actually load-bearing for.

    The table runs to dozens of rows and reads as though the walk were doing all of that work.
    Almost every one of those sets is over-determined — a token set is dropped by 4.3.2 whichever
    row is consulted — so the honest number is the one measured here, and it is re-measured every
    run rather than asserted once in prose that would go stale the next time a product ships.
    """
    total = len(via_parent)
    these = f"this {total} set" if total == 1 else f"these {total} sets"
    if not parent_only:
        return (
            f"None of {these} needs the walk to be dropped: every printing in them is caught by "
            "another 4.3 rule as well. The walk is a guard here, not the load-bearing rule for "
            "any set in this run."
        )
    listed = ", ".join(
        f"`{code}` ({count:,} printing{'' if count == 1 else 's'}, "
        f"inherited from `{via_parent[code]}`)"
        for code, count in sorted(parent_only.items(), key=lambda kv: (-kv[1], kv[0]))
    )
    verb = "is" if len(parent_only) == 1 else "are"
    return (
        f"Only {len(parent_only)} of {these} {verb} load-bearing: {listed}. Every "
        "printing in the rest is caught by another 4.3 rule anyway — a token or promo set falls "
        "to 4.3.2 whichever Appendix B row is consulted — so the length of the table is not a "
        "measure of how much the walk is doing."
    )


def _unreleased_section(unreleased_by_set: dict[str, int]) -> list[str]:
    """PRD 4.3.8 as amended: the printings its date check excluded, counted per set.

    The check reads each printing's own ``released_at``, so a set listed here may also have
    printings that shipped and are in the dataset (`fdc`). It runs last in 4.3, so a printing
    another 4.3 rule already dropped is counted under that rule instead.
    """
    if not unreleased_by_set:
        return ["None."]
    total = sum(unreleased_by_set.values())
    return [
        *_table(
            ["set", "printings excluded"],
            [[f"`{code}`", f"{count:,}"] for code, count in unreleased_by_set.items()],
        ),
        "",
        f"{total:,} printing{'' if total == 1 else 's'} in {len(unreleased_by_set)} "
        f"set{'' if len(unreleased_by_set) == 1 else 's'} excluded: each printing's own "
        "`released_at` is after the run date. The set's own date is not read, so a listed set may "
        "also hold printings dated on or before the run date; this rule does not drop those. A "
        "printing an earlier 4.3 rule drops is counted under that rule, not here.",
    ]


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return lines


def _assignment_section(data: ReportInput) -> list[str]:
    """Worlds spec §2.6 item 5: exact / displaced / bare per plane, which must read ``N / 0 / 0``.

    This replaces v2's radius-headroom table. That one watched PRD 5.3.2's ``log N`` clamp for the
    refresh that would reach it; §1.3's ``0.126·√N`` has no clamp, because constant area per card
    is the invariant and there is nothing left to saturate.

    This is the section a regression in the surface law shows up in. The prototype ran three
    assignment passes and left Dominaria at 200 displaced and Rabiah at 3 bare of 75; production
    relaxes the grid to the population instead, and the pipeline fails its own invariant test if any
    card is displaced. A displaced card is a card in the wrong place on a map whose entire claim is
    that position means something, so the only acceptable table here is an uneventful one.
    """
    rows = data.stats.assignment
    out = ["## Surface assignment (worlds spec §1.3)", ""]
    if not rows:
        out.append("No plane carries cards.")
        return out
    displaced = sum(r.displaced for r in rows)
    bare = sum(r.bare for r in rows)
    out.append(
        f"{sum(r.cards for r in rows):,} cards over {len(rows)} worlds: "
        f"**{sum(r.exact for r in rows):,} exact, {displaced:,} displaced, {bare:,} bare.** "
        "The grid relaxes to the population — only the per-row *cell counts* move; the row "
        "latitudes stay equal-angle and the band boundaries stay equal-area and are never snapped "
        "to a row. `rowCells` in `planes.json` is the shipped table (§2.4)."
    )
    out.extend(
        [
            "",
            *_table(
                ["World", "Cards", "Exact", "Displaced", "Bare", "Rows", "Closed form", "Aspect"],
                [
                    [
                        f"`{r.slug}`",
                        f"{r.cards:,}",
                        f"{r.exact:,}",
                        str(r.displaced),
                        str(r.bare),
                        str(r.rows),
                        f"{r.seed_cells:,}" + ("" if r.seed_cells == r.cards else " x"),
                        f"{r.aspect_deviation:.1%}",
                    ]
                    for r in rows[:12]
                ],
            ),
        ]
    )
    if len(rows) > 12:
        out.extend(["", f"_{len(rows) - 12} smaller worlds omitted; all are exact / 0 / 0._"])
    mismatched = [r for r in rows if r.seed_cells != r.cards]
    out.extend(
        [
            "",
            f"**Closed form differs from the card count on {len(mismatched)} of {len(rows)} "
            "worlds** (marked `x`). That column is what §1.3's relaxation exists for and why §2.4 "
            "ships `rowCells` rather than a formula: `round(2*pi*sin(theta) / (aspect*dphi))` "
            "summed over the rows is only approximately the card count, and the shipped grid has "
            "to be exactly it.",
            "",
            "**Aspect** is the worst row's deviation from 4:3. It is bounded by integer "
            "`rowCells`, "
            "not by the surface law: a two-cell polar row has an aspect of pi/2. The renderer must "
            "letterbox art into the cell's own rect and may not assume 4:3 anywhere (§2.1).",
        ]
    )
    return out


def _swatch_section(data: ReportInput) -> list[str]:
    """Worlds spec §2.6 item 5: what the art statistic cost and whether it is complete."""
    out = ["## Swatch fetch (worlds spec §2.2)", ""]
    stats = data.swatches
    if stats is None:
        out.append("This dataset carries no `swatches.bin`.")
        return out
    out.append(
        f"{stats.wanted:,} cards wanted a swatch from Scryfall `{SWATCH_SOURCE}`: "
        f"**{stats.cache_hits:,} already cached, {stats.fetched:,} fetched, "
        f"{stats.failed:,} failed.** The cache is keyed by `(printing id, imageTs)`, so a refresh "
        "re-fetches only what Scryfall actually changed, and the *decoded* 8-byte record is "
        "what is "
        "stored — the images themselves are not kept (review §4.4)."
    )
    if stats.bytes_downloaded:
        out.extend(
            [
                "",
                f"Downloaded {stats.bytes_downloaded / 1e6:,.1f} MB in "
                f"{stats.elapsed_s / 60:.1f} minutes at {CONCURRENCY} concurrent.",
            ]
        )
    if stats.failures:
        out.extend(
            [
                "",
                "**A failed swatch is a black cell**, so the build refuses to publish with any. "
                "This list is empty in a committed run; it is here for the run that hit them.",
                "",
                *_table(
                    ["Printing", "Reason"],
                    [[f"`{pid}`", reason] for pid, reason in stats.failures[:20]],
                ),
            ]
        )
    return out


def _brightness_cap_section(data: ReportInput) -> list[str]:
    """PRD 5.4.10's per-plane percentile cap, as numbers (review finding D6).

    The cap is applied in the pipeline, so the 11.11 "visual tunable" reading of it is not
    available to the browser: ``stars.bin`` carries the capped byte and not the printing count it
    came from. The count does reach the browser — ``planes/*.json`` ships every card's printing
    list — but not in the star record the renderer reads, so a re-tune is still a data refresh.
    Publishing the caps at least makes the choice reviewable here.
    """
    out = ["## Brightness cap per plane (PRD 5.4.10)", ""]
    rows = [row for row in data.stats.brightness_caps if row[2] > row[1]]
    out.append(
        f"The cap is each plane's {BRIGHTNESS_PERCENTILE:.0%} percentile of printing count. "
        f"{len(rows)} of {len(data.stats.brightness_caps)} non-empty planes hold at least one card "
        "above their cap; those cards all encode the same maximum brightness. The cap is applied "
        "before encoding, so changing the curve means re-running the pipeline (finding D6)."
    )
    if rows:
        out.extend(
            [
                "",
                *_table(
                    ["Plane", "Cap", "Highest", "Cards at or above"],
                    [
                        [f"`{slug}`", str(cap), str(highest), f"{at_cap:,}"]
                        for slug, cap, highest, at_cap in sorted(rows, key=lambda r: (-r[2], r[0]))[
                            :10
                        ]
                    ],
                ),
            ]
        )
        if len(rows) > 10:
            out.append("")
            out.append(f"Top 10 by highest printing count; {len(rows) - 10} more planes are alike.")
    return out


def render(data: ReportInput) -> str:
    dataset = data.dataset
    blind = next(p for p in dataset.planes if p.slug == BLIND_ETERNITIES_SLUG)
    star_count = len(dataset.stars)
    share = blind.star_count / star_count if star_count else 0.0
    manifest = cast(
        "dict[str, Any]",
        json.loads((data.data_dir / "manifest.json").read_text(encoding="utf-8")),
    )

    out: list[str] = [
        f"# Eternities pipeline run — {data.as_of}",
        "",
        f"`eternities build --as-of {data.as_of}`. Report format: PRD 4.9.2. "
        "Data quality gates: PRD 9.2.",
        "",
        "## Run",
        "",
        *_table(
            ["Field", "Value"],
            [
                ["Dataset", dataset.dataset],
                ["Data hash", f"`{data.data_dir.name}`"],
                ["Run date (`--as-of`)", data.as_of],
                ["Scryfall bulk `updated_at`", data.bulk_updated_at],
                [
                    "Scryfall bulk file",
                    f"`{data.bulk_uri.rsplit('/', 1)[-1]}`"
                    + (
                        " — cache filename; this entry predates the URI sidecar, so the upstream "
                        "name is not recoverable"
                        if data.bulk_uri_reconstructed
                        else ""
                    ),
                ],
                ["Pipeline version", str(manifest["pipelineVersion"])],
                ["Contract version", str(manifest["contractVersion"])],
            ],
        ),
        "",
        "## Counts",
        "",
        *_table(
            ["Measure", "Value"],
            [
                ["Printings in the bulk file", f"{data.total_printings:,}"],
                ["Distinct `oracle_id`s in the bulk file", f"{data.total_oracle_ids:,}"],
                [
                    "Printings included (4.3)",
                    f"{data.total_printings - sum(data.printings_dropped.values()):,}",
                ],
                ["Cards included (4.4)", f"{star_count:,}"],
                ["Printings emitted", f"{sum(len(c.printings) for c in dataset.cards):,}"],
                ["Planes", f"{len(dataset.planes)}"],
                ["Sets in the dictionary", f"{len(dataset.sets)}"],
            ],
        ),
        "",
        "## Printings excluded, per rule (PRD 4.3)",
        "",
        *_table(
            ["Rule", "Printings"],
            [
                [rule, f"{count:,}"]
                for rule, count in sorted(
                    data.printings_dropped.items(), key=lambda kv: (-kv[1], kv[0])
                )
            ],
        ),
        "",
        "## Cards excluded, per rule (PRD 4.4)",
        "",
        *_table(
            ["Rule", "Cards"],
            [
                [rule, f"{count:,}"]
                for rule, count in sorted(
                    data.cards_excluded.items(), key=lambda kv: (-kv[1], kv[0])
                )
            ],
        ),
        "",
        "## Data quality gates (PRD 9.2)",
        "",
        *_table(
            ["Gate", "Result"],
            [
                ["9.2.1 Unmapped sets", "**0** — enforced; the run fails otherwise (4.6.4)"],
                # 9.2.2 is reported, not enforced (PRD 9.2), and prd_v3.md 9.2.2 records 17.42%
                # as the baseline the board accepted — below the 20-25% that document first
                # expected, which it calls a better starting point than predicted rather than a
                # defect. So the row records the number against the accepted baseline and
                # classifies nothing; it used to append "**outside** the 20-25% range", which read
                # as a standing defect on every production run. If the board ever re-baselines,
                # prd_v3.md 9.2.2 and this string move together. (DEC-675)
                [
                    "9.2.2 Blind Eternities share",
                    f"**{share:.2%}** ({blind.star_count:,} of {star_count:,} cards) — "
                    "reported, not gated; PRD 9.2.2 records 17.42% (2026-09-04) as the "
                    "board-accepted baseline",
                ],
                [
                    "9.2.3 Cards that changed plane",
                    _plane_change_gate(
                        len(data.plane_changes),
                        data.previous_run,
                        data.previous_run_pruned,
                        data.previous_run_contract_version,
                    ),
                ],
            ],
        ),
        "",
        "### Blind Eternities baseline (PRD 9.2.2)",
        "",
        f"**Baseline: {share:.2%}.** The top contributing sets are where curation pays "
        "(PRD 11.9); the target is this baseline minus what curating the top three recovers.",
        "",
        *_table(
            ["Set", "Code", "Cards", "Share of dust"],
            [
                [name, f"`{code}`", f"{count:,}", f"{count / max(blind.star_count, 1):.1%}"]
                for code, name, count in data.stats.blind_eternities_top_sets
            ],
        ),
        "",
        "## Cards per plane (PRD 4.9.2)",
        "",
        *_table(
            ["Plane", "Slug", "Cards", "Bands", "Kind"],
            [
                [
                    plane.display_name,
                    f"`{plane.slug}`",
                    f"{plane.card_count:,}",
                    str(len(plane.sets)),
                    str(plane.kind),
                ]
                for plane in sorted(dataset.planes, key=lambda p: (-p.card_count, p.slug))
            ],
        ),
        "",
        *_assignment_section(data),
        "",
        *_swatch_section(data),
        "",
        *_brightness_cap_section(data),
        "",
        "## Sets mapped through a parent set (PRD 4.6 rule 3)",
        "",
    ]

    if data.via_parent:
        out.extend(
            _table(
                ["Set", "Inherited from"],
                [[f"`{code}`", f"`{parent}`"] for code, parent in sorted(data.via_parent.items())],
            )
        )
        out.append("")
        out.append(
            "Listed so a child set inheriting a plane it should not have — a bonus sheet under "
            "an in-universe parent — is visible rather than silent (PRD 4.6)."
        )
    else:
        out.append("None: every first-printing set has its own Appendix B row.")

    out.extend(["", "## Sets dropped through an ancestor's Appendix B row (PRD 4.3.1)", ""])
    if data.dropped_via_parent:
        out.extend(
            _table(
                ["Set", "Dropped by the row on"],
                [
                    [f"`{code}`", f"`{parent}`"]
                    for code, parent in sorted(data.dropped_via_parent.items())
                ],
            )
        )
        out.append("")
        out.append(
            "Appendix B rows a product, not every set code Scryfall splits it into: a Universes "
            "Beyond release ships tokens, promos, art series and bonus sheets that carry no row of "
            "their own. 4.3.1 follows the Scryfall parent chain exactly as 4.6 rule 3 does, so "
            "those children drop with their parent instead of leaking through."
        )
        out.append("")
        out.append(_parent_rule_only_note(data.dropped_via_parent, data.parent_rule_only))
    else:
        out.append("None: every dropped set carries its own row.")

    out.extend(
        [
            "",
            "## Sets excluded as unreleased (PRD 4.3.8)",
            "",
            *_unreleased_section(data.unreleased_by_set),
            "",
            "## Card-level overrides applied (PRD 4.6 rule 1)",
            "",
            (
                ", ".join(sorted(data.via_override))
                if data.via_override
                else "None — `overrides.json` carries no records (PRD 4.1.5)."
            ),
        ]
    )
    if data.unused_overrides:
        # A curated line that matches nothing is the state Appendix B's two "cards via overrides"
        # notes were already in: a claimed curation with no effect. Named here so the next refresh
        # either fixes the record or deletes it.
        out.extend(
            [
                "",
                f"**{len(data.unused_overrides)} override "
                f"{'record' if len(data.unused_overrides) == 1 else 'records'} matched no first "
                "printing.** Each is either a card some 4.3/4.4 rule excludes, or a stale record "
                "whose `oracleId` no longer belongs to a card in the dataset. Fix or delete "
                "them.",
                "",
                *(f"- {line}" for line in data.unused_overrides),
            ]
        )
    out.extend(
        [
            "",
            "## Cards whose plane changed since the previous run (PRD 4.9.2)",
            "",
        ]
    )
    if data.previous_run is None:
        out.append("First production run: nothing to compare against.")
    elif data.previous_run_pruned:
        out.append(
            f"Not computed. This run follows `{data.previous_run}`, recorded in the manifest, but "
            "PRD 8.8.3 removed that directory when it was superseded — the artefacts the diff "
            "needs are no longer in the tree. Rebuilding an already-superseded run reaches this "
            "state; a refresh of a committed run does not."
        )
    elif data.previous_run_contract_version is not None:
        out.append(
            f"Not computed. This run follows `{data.previous_run}`, whose artefacts are still in "
            f"the tree but record `contractVersion` {data.previous_run_contract_version}; this "
            f"build speaks {CONTRACT_VERSION}, and the binary decoders test the header for strict "
            "equality rather than guess at an older layout. The predecessor is named in this "
            "run's manifest all the same, so the chain is intact and the diff resumes on the next "
            "run written under the current contract."
        )
    elif not data.plane_changes:
        out.append(f"None, against run `{data.previous_run}`.")
    else:
        out.extend(
            _table(
                ["Card", "Was", "Now"],
                [[name, f"`{was}`", f"`{now}`"] for name, was, now in data.plane_changes[:200]],
            )
        )
        if len(data.plane_changes) > 200:
            out.append("")
            out.append(f"…and {len(data.plane_changes) - 200} more.")
        out.append("")
        out.append("Each row should trace to an appendix or override edit (PRD 9.2.3).")

    out.extend(["", "## First-run verification duties", ""])
    if not data.findings:
        out.append("Not run.")
    for finding in data.findings:
        out.extend(
            [
                f"### {finding.question} — {finding.title}",
                "",
                f"**Verdict:** {finding.verdict}",
                "",
            ]
        )
        out.extend(f"- {line}" for line in finding.detail)
        if finding.action:
            out.extend(["", f"**For the CEO:** {finding.action}"])
        out.append("")

    shard_rows = [
        row for row in cast("list[dict[str, Any]]", manifest["files"]) if "/" in str(row["path"])
    ]
    top_rows = [
        [f"`{row['path']}`", f"{int(row['bytes']):,}"]
        for row in cast("list[dict[str, Any]]", manifest["files"])
        if "/" not in str(row["path"])
    ]
    top_rows.append(
        [
            f"`planes/*.json` ({len(shard_rows)} shards)",
            f"{sum(int(row['bytes']) for row in shard_rows):,}",
        ]
    )
    out.extend(
        [
            "## Artefacts",
            "",
            *_table(["File", "Bytes"], top_rows),
            "",
            f"Written to `web/public/data/{data.data_dir.name}/` (PRD 8.8.3).",
            "",
        ]
    )
    return "\n".join(out) + "\n"
