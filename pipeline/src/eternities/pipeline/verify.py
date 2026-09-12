"""First-run verification duties (implementation plan §2, Phase 1).

Four questions the PRD deliberately left for the first real run to answer:

* **Q4** — does ``security_stamp: triangle`` reliably mark Universes Beyond printings, as 4.3.5
  assumes?
* **Q10** — the 2026 Appendix B set codes marked *verify*.
* **Q12** — do Universes Within (``slx``) cards share an ``oracle_id`` with their Secret Lair
  originals (4.4.5)?
* **Roster diff** — Appendix A against the MTG wiki's plane category (open question 1).

Every answer lands in the run report. Spec-affecting ones go back to the CEO rather than into
code: this module *observes*, it never edits an appendix.
"""

from __future__ import annotations

import json
import re
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Final, cast

from .appendices import Appendices, SetEntry
from .records import RawPrinting, ScrySet
from .stages import governing_set_row

WIKI_API: Final = "https://mtg.fandom.com/api.php"
WIKI_CATEGORY: Final = "Category:Planes"
USER_AGENT: Final = (
    "eternities-pipeline/0.1 (roster diff; https://github.com/DioPires/eternities-mtg-app)"
)

SECRET_LAIR_EXEMPT: Final = "slx"

WIKI_ALIASES: Final[dict[str, str]] = {
    # The wiki's page title and the Appendix A slug name the same plane differently.
    "lorwyn-shadowmoor": "lorwyn",
    "serra-s-realm": "serras-realm",
    "seven-planes-of-parnash": "parnash",
    "meditation-plane": "meditation-realm",
}
"""Appendix A slug for a wiki title that would otherwise read as a false difference."""

ALARA_SHARDS: Final[frozenset[str]] = frozenset({"bant", "esper", "grixis", "jund", "naya"})
"""PRD 4.7.2 keeps Alara's five shards as one plane; the wiki gives each a page."""

OPEN_QUESTION_1_CANDIDATES: Final[tuple[str, ...]] = (
    "kandoka",
    "foldaria",
    "clamhattan",
    "horsehead-nebula",
)
"""The four planes PRD open question 1 left undecided. All four were ratified onto Appendix A on
2026-09-04, so the roster finding no longer names them; the list stays because it is what the
question asked about, and dropping it would lose the trail from the question to its answer."""


@dataclass(frozen=True, slots=True)
class Finding:
    """One verification result, as it appears in the report."""

    question: str
    title: str
    verdict: str
    detail: list[str] = field(default_factory=list)
    action: str | None = None
    """Set when the answer needs a decision the pipeline must not make on its own."""


def _in_universes_beyond_set(
    code: str, by_code: dict[str, SetEntry], sets: dict[str, ScrySet]
) -> bool:
    """Whether a set is Universes Beyond, following the parent chain.

    Child sets - `pfin` (Final Fantasy Promos), `twho` (Doctor Who Tokens) - carry no Appendix B
    row of their own because 4.6 rule 3 already inherits one. A stamp check that ignored the
    parent would report them as unexplained triangles and make 4.3.5 look unsafe.

    The walk itself lives in :func:`~eternities.pipeline.stages.governing_set_row`, which is what
    4.3.1 uses to drop those same children. One implementation, so the two cannot drift apart.
    """
    resolved = governing_set_row(code, by_code, sets)
    return resolved is not None and resolved[0].universes_beyond


def verify_security_stamp(
    all_printings: list[RawPrinting], appendices: Appendices, sets: dict[str, ScrySet]
) -> Finding:
    """Q4 / PRD 4.3.5. Is ``triangle`` a reliable Universes Beyond marker?

    Measured, not assumed: count every triangle-stamped printing, then split them by whether
    their set is flagged Universes Beyond in Appendix B. A triangle inside an in-universe set is
    either a Universes Beyond skin (which 4.3.7's ``flavor_name`` rule already catches) or a
    counter-example that would make 4.3.5 unsafe.
    """
    by_code = appendices.by_code()
    stamps: Counter[str] = Counter()
    triangle_sets: Counter[str] = Counter()
    triangle_in_universe: Counter[str] = Counter()
    triangle_in_universe_no_flavour: Counter[str] = Counter()

    for printing in all_printings:
        stamps[printing.security_stamp or "(none)"] += 1
        if printing.security_stamp != "triangle":
            continue
        triangle_sets[printing.set_code] += 1
        if not _in_universes_beyond_set(printing.set_code, by_code, sets):
            triangle_in_universe[printing.set_code] += 1
            if printing.flavor_name is None:
                triangle_in_universe_no_flavour[printing.set_code] += 1

    total = sum(triangle_sets.values())
    unexplained = sum(triangle_in_universe_no_flavour.values())
    share = (total - unexplained) / total if total else 1.0
    verdict = (
        "confirmed — 4.3.5 is safe as a secondary guard"
        if unexplained == 0
        else f"qualified — {unexplained} triangle printings are neither in a Universes Beyond "
        "set nor flavour-named"
    )
    detail = [
        "a set counts as Universes Beyond when it, or any parent set, carries the Appendix B flag",
        "security_stamp distribution: "
        + ", ".join(f"{k}={v}" for k, v in sorted(stamps.items(), key=lambda kv: -kv[1])),
        f"triangle printings: {total} across {len(triangle_sets)} sets; "
        f"{share:.1%} sit in an Appendix B Universes Beyond set",
        "top triangle sets: " + ", ".join(f"{c}={n}" for c, n in triangle_sets.most_common(8)),
    ]
    if triangle_in_universe:
        detail.append(
            "triangle outside a Universes Beyond set: "
            + ", ".join(f"{c}={n}" for c, n in triangle_in_universe.most_common(8))
        )
    if triangle_in_universe_no_flavour:
        detail.append(
            "…of which without flavor_name (the ones 4.3.5 alone must catch): "
            + ", ".join(f"{c}={n}" for c, n in triangle_in_universe_no_flavour.most_common(8))
        )
    return Finding(
        question="Q4",
        title="security_stamp: triangle semantics (PRD 4.3.5)",
        verdict=verdict,
        detail=detail,
        action=None
        if unexplained == 0
        else "Confirm with the CEO that dropping these printings is intended.",
    )


def verify_set_codes(appendices: Appendices, sets: dict[str, ScrySet]) -> Finding:
    """Q10 / Appendix B. Every code the PRD marked *verify*, plus any it got wrong.

    Every row is re-checked on every run; what changed with review finding D8 is how much of a
    settled answer gets re-printed. A row carrying ``prdVerified`` was confirmed by an earlier run,
    so while it still matches it collapses into a dated count instead of a line of its own — the
    fifteen confirmed rows were being read out in full every run, burying the one line that was not
    settled, which is the failure ``prdRatified`` already fixed for corrections and the roster
    finding fixed for open question 1.

    A verified row that *stops* matching goes to ``regressed`` and is printed at the top, because
    the day it stops being true is the entire reason to keep checking it.
    """
    rows = [s for s in appendices.sets if s.prd_verify or s.corrected_from is not None]
    ok: list[str] = []
    settled: list[str] = []
    regressed: list[str] = []
    mismatched: list[str] = []
    missing: list[str] = []
    corrected: list[str] = []
    # Set codes whose PRD edit is still owed. Everything in `missing` and `mismatched` qualifies;
    # a *corrected* row qualifies only until it is ratified. A ratified correction stays in
    # `corrected` — it is provenance worth printing — but it must not keep asking for an edit that
    # is already made, which is the same failure the roster finding had against open question 1.
    outstanding: set[str] = set()

    for row in sorted(rows, key=lambda r: r.code):
        scry = sets.get(row.code)
        if scry is None:
            missing.append(f"{row.code} ({row.prd_name}) — no such set on Scryfall")
            if row.prd_verified is not None:
                regressed.append(
                    f"{row.code} was confirmed {row.prd_verified} and is now absent from Scryfall"
                )
            outstanding.add(row.code)
            continue
        if row.corrected_from is not None:
            ratified = (
                f", ratified into the PRD {row.prd_ratified}"
                if row.prd_ratified is not None
                else ""
            )
            corrected.append(
                f"{row.corrected_from} → {row.code} “{scry.name}” "
                f"(PRD said “{row.prd_name}”, released {scry.released_at}{ratified})"
            )
            if row.prd_ratified is None:
                outstanding.add(row.code)
        elif scry.name.lower() != row.prd_name.lower() and row.prd_section != "B.3":
            mismatched.append(f"{row.code}: PRD “{row.prd_name}” vs Scryfall “{scry.name}”")
            if row.prd_verified is not None:
                regressed.append(
                    f"{row.code} was confirmed {row.prd_verified} and now reads "
                    f"“{scry.name}” on Scryfall against the PRD's “{row.prd_name}”"
                )
            outstanding.add(row.code)
        elif row.prd_verified is not None:
            settled.append(f"{row.code} (confirmed {row.prd_verified})")
        else:
            ok.append(f"{row.code} “{scry.name}” ({scry.released_at}, {scry.set_type})")

    detail: list[str] = []
    if regressed:
        detail.append(f"REGRESSED since they were confirmed: {len(regressed)}")
        detail.extend(f"  {line}" for line in regressed)
    detail.append(f"confirmed by an earlier run and still matching: {len(settled)}")
    if settled:
        # Named but not expanded: the codes are cheap to print and let a reader see *which* rows
        # are settled without re-reading the full Scryfall row for each.
        detail.append("  " + ", ".join(settled))
    detail.append(f"confirmed by this run: {len(ok)}")
    detail.extend(f"  {line}" for line in ok)
    if corrected:
        detail.append(f"corrected against Scryfall: {len(corrected)}")
        detail.extend(f"  {line}" for line in corrected)
    if mismatched:
        detail.append(f"name mismatch: {len(mismatched)}")
        detail.extend(f"  {line}" for line in mismatched)
    if missing:
        detail.append(f"absent from Scryfall: {len(missing)}")
        detail.extend(f"  {line}" for line in missing)

    verdict = (
        f"REGRESSED — {len(regressed)} previously confirmed rows no longer match Scryfall"
        if regressed
        else "resolved — every verify-marked code exists on Scryfall"
        if not missing and not mismatched
        else "resolved with corrections — see below"
    )
    action = (
        "PRD Appendix B carries codes this run had to correct or fill in and the PRD text has "
        f"not absorbed yet ({', '.join(sorted(outstanding))}). The rows are in "
        "pipeline/data/appendix_b.json with `correctedFrom`/`prdVerify` provenance; the PRD "
        "itself needs the same edit, after which the row takes a `prdRatified` date and drops "
        "out of this ask."
        if outstanding
        else None
    )
    return Finding(
        question="Q10",
        title="Appendix B set codes marked “verify”",
        verdict=verdict,
        detail=detail,
        action=action,
    )


def verify_universes_within(
    all_printings: list[RawPrinting], appendices: Appendices, sets: dict[str, ScrySet]
) -> Finding:
    """Q12 / PRD 4.4.5. Do ``slx`` cards share an ``oracle_id`` with their originals?

    The Secret Lair predicate of Appendix B.4 is a code prefix *and* a name substring, so it needs
    the Scryfall set name. Passing the code twice made the clause dead — "Secret Lair" never
    appears in a 3-4 character code — and left the finding resting on the prefix test alone.
    """
    by_code = appendices.by_code()
    slx_oracle_ids = {p.oracle_id for p in all_printings if p.set_code == SECRET_LAIR_EXEMPT}
    shared: dict[str, set[str]] = {}
    for printing in all_printings:
        if printing.set_code == SECRET_LAIR_EXEMPT or printing.oracle_id not in slx_oracle_ids:
            continue
        row = by_code.get(printing.set_code)
        universes_beyond = row is not None and row.universes_beyond
        scry_set = sets.get(printing.set_code)
        secret_lair = scry_set is not None and appendices.secret_lair.matches(
            scry_set.code, scry_set.name
        )
        if universes_beyond or secret_lair:
            shared.setdefault(printing.oracle_id, set()).add(printing.set_code)

    verdict = (
        f"distinct — none of the {len(slx_oracle_ids)} Universes Within cards shares an "
        "oracle_id with a Secret Lair or Universes Beyond printing"
        if not shared
        else f"shared — {len(shared)} of {len(slx_oracle_ids)} Universes Within oracle_ids also "
        "appear on a Secret Lair or Universes Beyond printing"
    )
    detail = [
        f"slx printings: {sum(1 for p in all_printings if p.set_code == SECRET_LAIR_EXEMPT)}",
        f"distinct slx oracle_ids: {len(slx_oracle_ids)}",
    ]
    if shared:
        sample = sorted(shared.items())[:5]
        detail.append(
            "examples: " + "; ".join(f"{oid[:8]}… also in {sorted(codes)}" for oid, codes in sample)
        )
    return Finding(
        question="Q12",
        title="Universes Within oracle_id identity (PRD 4.4.5)",
        verdict=verdict,
        detail=detail,
        action=(
            "4.4.5's exemption is load-bearing: without it these cards would be excluded as "
            "Universes Beyond by origin. The 9.1.5 fixture locks the answer."
            if shared
            else None
        ),
    )


def _slugify(title: str) -> str:
    stripped = re.sub(r"\s*\(.*\)$", "", title).lower()
    stripped = re.sub(r"^the ", "", stripped)
    return re.sub(r"[^a-z0-9]+", "-", stripped).strip("-")


def fetch_wiki_planes() -> list[str]:
    """Every page title in the MTG wiki's ``Category:Planes``."""
    titles: list[str] = []
    cont: str | None = None
    while True:
        uri = (
            f"{WIKI_API}?action=query&list=categorymembers"
            f"&cmtitle={WIKI_CATEGORY}&cmlimit=500&format=json"
        )
        if cont:
            uri += f"&cmcontinue={cont}"
        request = urllib.request.Request(uri, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as response:
            page = cast("dict[str, Any]", json.loads(cast("bytes", response.read())))
        members = cast("list[dict[str, Any]]", page["query"]["categorymembers"])
        titles.extend(str(m["title"]) for m in members)
        continuation = cast("dict[str, Any]", page.get("continue", {}))
        cont = str(continuation["cmcontinue"]) if "cmcontinue" in continuation else None
        if cont is None:
            return titles


def verify_roster(appendices: Appendices, wiki_titles: list[str] | None) -> Finding:
    """Appendix A against the wiki's plane category (PRD open question 1).

    Category pages, Alara's five shards (one plane per 4.7.2) and the Universes Beyond settings
    are filtered out: they are known, deliberate differences, and leaving them in would bury the
    handful of entries that actually need a decision.
    """
    ours = {p.slug for p in appendices.planes}
    if wiki_titles is None:
        return Finding(
            question="Roster",
            title="Appendix A vs the MTG wiki plane category",
            verdict="not run — the wiki was unreachable from this run",
            detail=[],
            action="Re-run with network access to the MTG wiki, or diff by hand.",
        )

    candidates: dict[str, str] = {}
    for title in wiki_titles:
        if title.startswith("Category:") or "/" in title or title == "Plane":
            continue
        slug = WIKI_ALIASES.get(_slugify(title), _slugify(title))
        if slug in ALARA_SHARDS or slug in {"rabiah-scale"}:
            continue
        candidates[slug] = title

    only_wiki = sorted(set(candidates) - ours)
    only_appendix = sorted(ours - set(candidates) - {"blind-eternities"})

    detail = [
        f"wiki Category:Planes pages: {len(wiki_titles)}; "
        f"after filtering categories, Alara shards and aliases: {len(candidates)}",
        f"Appendix A entries: {len(ours)} (including blind-eternities, which is not a wiki plane)",
        f"in the wiki category but not in Appendix A ({len(only_wiki)}): "
        + ", ".join(candidates[s] for s in only_wiki),
    ]
    if only_appendix:
        detail.append(
            f"in Appendix A with no wiki page of that name ({len(only_appendix)}): "
            + ", ".join(only_appendix)
        )
    # Open question 1's candidates, reported only while they are still a question. Listing them
    # unconditionally outlived their usefulness the moment the board ratified them: the finding
    # went on asking the CEO to decide something already decided, in a report whose whole job is
    # to surface what needs a decision.
    open_q1 = [s for s in OPEN_QUESTION_1_CANDIDATES if s in candidates and s not in ours]
    if open_q1:
        detail.append(
            "PRD open question 1 candidates in the category and not yet on the roster: "
            + ", ".join(open_q1)
        )

    action = (
        "Roster additions are a PRD change, not a pipeline change. The list above is the raw "
        "diff; most entries are Universes Beyond settings or non-canon, which PRD 2.2 keeps out."
    )
    if open_q1:
        action += (
            " Open question 1's remaining candidates appear in the category — the CEO decides "
            "whether they join Appendix A."
        )
    return Finding(
        question="Roster",
        title="Appendix A vs the MTG wiki plane category",
        verdict=f"{len(only_wiki)} wiki entries absent from Appendix A",
        detail=detail,
        action=action,
    )
