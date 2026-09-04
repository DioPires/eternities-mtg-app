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
from ..contract.models import Dataset
from .assemble import AssemblyStats
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
    unreleased_sets: list[str]
    cards_excluded: Counter[str]
    via_parent: dict[str, str]
    via_override: list[str]
    dropped_via_parent: dict[str, str] = field(default_factory=dict)
    """PRD 4.3.1 read through 4.6.3: set code -> the ancestor whose row dropped it."""
    findings: list[Finding] = field(default_factory=list)
    plane_changes: list[tuple[str, str, str]] = field(default_factory=list)
    """``(card name, previous plane, new plane)`` — PRD 4.9.2's last section."""
    previous_run: str | None = None


def load_previous_planes(data_root: Path, exclude: str) -> tuple[str, dict[str, str]] | None:
    """Reconstruct ``oracle_id -> plane slug`` from a previous run's committed artefacts.

    No sidecar file: ``planes.json`` gives each plane's contiguous star range (data contract §2)
    and ``sets.bin``'s ORACLE_IDS section gives the star order, which is all the mapping needs.

    "Previous" is the run with the latest ``asOf``/``generatedAt``, not the lexicographically
    largest directory name. Directory names are content hashes and carry no ordering, so sorting on
    them picks an arbitrary run the moment two production directories co-exist — and 4.9.2's diff
    is only meaningful against the run this one actually follows.
    """
    production: list[tuple[tuple[str, str, str], Path]] = []
    for directory in data_root.glob("*"):
        if not directory.is_dir() or directory.name == exclude:
            continue
        manifest_path = directory / "manifest.json"
        if not manifest_path.exists():
            continue
        manifest = cast("dict[str, Any]", json.loads(manifest_path.read_text(encoding="utf-8")))
        if manifest.get("dataset") != "production":
            continue
        key = (str(manifest.get("asOf", "")), str(manifest.get("generatedAt", "")), directory.name)
        production.append((key, directory))

    if not production:
        return None
    directory = max(production)[1]
    planes_doc = cast(
        "dict[str, Any]", json.loads((directory / "planes.json").read_text(encoding="utf-8"))
    )
    oracle_ids, _ = decode_sets((directory / "sets.bin").read_bytes())
    mapping: dict[str, str] = {}
    for plane in cast("list[dict[str, Any]]", planes_doc["planes"]):
        start = int(plane["starOffset"])
        for oracle_id in oracle_ids[start : start + int(plane["starCount"])]:
            mapping[oracle_id] = str(plane["slug"])
    return directory.name, mapping


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


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return lines


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
                ["Scryfall bulk file", f"`{data.bulk_uri.rsplit('/', 1)[-1]}`"],
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
                [
                    "9.2.2 Blind Eternities share",
                    f"**{share:.2%}** ({blind.star_count:,} of {star_count:,} cards) — "
                    + (
                        "inside the 20-25% range PRD 9.2.2 expected"
                        if 0.20 <= share <= 0.25
                        else "**outside** the 20-25% range PRD 9.2.2 expected"
                    ),
                ],
                [
                    "9.2.3 Cards that changed plane",
                    f"{len(data.plane_changes)}"
                    + (
                        f" (vs run `{data.previous_run}`)"
                        if data.previous_run
                        else " — no previous production run to compare against"
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
    else:
        out.append("None: every dropped set carries its own row.")

    out.extend(
        [
            "",
            "## Sets excluded as unreleased (PRD 4.3.8)",
            "",
            (
                ", ".join(f"`{c}`" for c in data.unreleased_sets)
                if data.unreleased_sets
                else "None."
            ),
            "",
            "## Card-level overrides applied (PRD 4.6 rule 1)",
            "",
            (
                ", ".join(sorted(data.via_override))
                if data.via_override
                else "None — `overrides.json` is still empty (PRD 4.1.5)."
            ),
            "",
            "## Cards whose plane changed since the previous run (PRD 4.9.2)",
            "",
        ]
    )
    if data.previous_run is None:
        out.append("First production run: nothing to compare against.")
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
