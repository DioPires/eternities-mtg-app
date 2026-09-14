"""Stages 2 to 5 of PRD 8.2, as pure functions over in-memory tables.

Nothing here touches the network, the clock, or the filesystem: every stage takes rows and
returns rows, so a unit test builds its input by hand and asserts the whole rule. Each function
also returns the counters PRD 4.9.2 wants in the run report, because a rule that drops cards
silently is exactly what the report exists to prevent.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Final

from .appendices import Appendices, SetEntry
from .records import RawPrinting, ScrySet

EXCLUDED_SET_TYPES: Final[frozenset[str]] = frozenset(
    {"promo", "token", "memorabilia", "minigame", "funny", "alchemy", "vanguard"}
)
"""PRD 4.3.2."""

EXCLUDED_LAYOUTS: Final[frozenset[str]] = frozenset(
    {
        "token",
        "double_faced_token",
        "emblem",
        "art_series",
        "planar",
        "scheme",
        "vanguard",
        "augment",
        "host",
        "reversible_card",
    }
)
"""PRD 4.3.3."""

FIRST_PRINTING_SET_TYPE_PRIORITY: Final[dict[str, int]] = {"expansion": 0, "core": 0}
"""PRD 4.5.1: expansion and core win a release-date tie; everything else ranks after them."""

_OTHER_SET_TYPE_PRIORITY: Final = 1

UNIVERSES_BEYOND_STAMP: Final = "triangle"

OWN_ROW_RULE: Final = "4.3.1 Appendix B universes_beyond or excluded"
PARENT_ROW_RULE: Final = "4.3.1 Appendix B universes_beyond or excluded (inherited from a parent)"


def governing_set_row(
    code: str, by_code: dict[str, SetEntry], sets: dict[str, ScrySet]
) -> tuple[SetEntry, str] | None:
    """The Appendix B row that governs a set: its own, or the nearest one up its parent chain.

    Appendix B rows a *product*, not every set code Scryfall splits it into. A Universes Beyond
    release ships a spine set plus tokens, promos, art series, minigames and bonus sheets, and only
    the spine gets a row — 4.6 rule 3 already inherits the plane through the Scryfall parent, so
    nobody adds rows for the children. Reading 4.3.1 as "own row only" therefore leaks the children
    of a Universes Beyond product into the data: `pza` (TMNT Source Material, parent `tmt`) is a
    `masterpiece` with an `oval` stamp and no `flavor_name`, so no other 4.3 rule catches it either.

    Nearest row wins rather than "any ancestor is flagged": a child of an in-universe product line
    is in-universe, whatever sits further up the chain. Cycles are impossible in Scryfall's data but
    are guarded anyway, because a parse of somebody else's data is not a place to trust that.
    """
    seen: set[str] = set()
    current: str | None = code
    while current is not None and current not in seen:
        seen.add(current)
        row = by_code.get(current)
        if row is not None:
            return row, current
        entry = sets.get(current)
        current = entry.parent_set_code if entry else None
    return None


# --------------------------------------------------------------------------------------------
# Stage 2 — filter printings (PRD 4.3)
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PrintingFilterResult:
    kept: list[RawPrinting]
    dropped_by_rule: Counter[str]
    unreleased_sets: list[str]
    """PRD 4.9.2: sets excluded because they had not shipped on the run date."""
    dropped_via_parent: dict[str, str] = field(default_factory=dict)
    """Set code -> the ancestor whose Appendix B row dropped it (PRD 4.3.1, read through 4.6.3).

    Reported for the same reason 4.6 reports its rule-3 inheritances: a set dropped because of a
    row it does not carry itself must be visible, not silent."""
    parent_rule_only: dict[str, int] = field(default_factory=dict)
    """Set code -> printings the parent walk is the *only* thing dropping.

    Most of :attr:`dropped_via_parent` is over-determined: a Universes Beyond release's tokens and
    promos would fall to 4.3.2's ``set_type`` list or 4.3.5's stamp anyway. Counting the printings
    that no other 4.3 rule catches keeps the long list from being over-read — today one set, `pza`,
    is the whole reason the walk exists — and turns that into a number the next run re-measures
    rather than a comment that quietly goes stale."""


def filter_printings(
    printings: list[RawPrinting],
    sets: dict[str, ScrySet],
    appendices: Appendices,
    as_of: str,
) -> PrintingFilterResult:
    """PRD 4.3. A printing survives only if no rule fires."""
    by_code = appendices.by_code()
    dropped: Counter[str] = Counter()
    unreleased: set[str] = set()
    via_parent: dict[str, str] = {}
    parent_only: Counter[str] = Counter()
    kept: list[RawPrinting] = []
    governing: dict[str, tuple[SetEntry, str] | None] = {}

    for printing in printings:
        scry_set = sets.get(printing.set_code)
        if printing.set_code not in governing:
            governing[printing.set_code] = governing_set_row(printing.set_code, by_code, sets)
        resolved = governing[printing.set_code]
        row = resolved[0] if resolved is not None else None
        rule = _printing_exclusion_rule(printing, scry_set, row, appendices, as_of)
        if rule is None:
            kept.append(printing)
            continue
        dropped[rule] += 1
        if rule == "4.3.8 set unreleased on the run date":
            unreleased.add(printing.set_code)
        if rule == PARENT_ROW_RULE and resolved is not None:
            via_parent[printing.set_code] = resolved[1]
            # Re-run 4.3 with the inherited row withheld: whatever comes back is what would have
            # caught this printing without the walk, and `None` means nothing would have.
            if _printing_exclusion_rule(printing, scry_set, None, appendices, as_of) is None:
                parent_only[printing.set_code] += 1

    return PrintingFilterResult(
        kept=kept,
        dropped_by_rule=dropped,
        unreleased_sets=sorted(unreleased),
        dropped_via_parent=dict(sorted(via_parent.items())),
        parent_rule_only=dict(sorted(parent_only.items())),
    )


def _printing_exclusion_rule(
    printing: RawPrinting,
    scry_set: ScrySet | None,
    row: SetEntry | None,
    appendices: Appendices,
    as_of: str,
) -> str | None:
    """The first PRD 4.3 rule that excludes this printing, or ``None`` if it survives.

    ``row`` is the *governing* row of :func:`governing_set_row`, not necessarily the set's own.
    """
    if row is not None and row.drops_printings:
        return OWN_ROW_RULE if row.code == printing.set_code else PARENT_ROW_RULE
    if scry_set is not None and appendices.secret_lair.matches(scry_set.code, scry_set.name):
        return "4.3.2 Secret Lair"
    if scry_set is not None and scry_set.set_type in EXCLUDED_SET_TYPES:
        return f"4.3.2 set_type {scry_set.set_type}"
    if printing.layout in EXCLUDED_LAYOUTS:
        return f"4.3.3 layout {printing.layout}"
    if printing.promo:
        return "4.3.4 promo"
    if printing.digital or (scry_set is not None and scry_set.digital):
        return "4.3.4 digital"
    if printing.oversized:
        return "4.3.4 oversized"
    # `row` is the *governing* row, so a stamp exemption inherits down a product line exactly as
    # 4.3.1's drop does. Reading it off the set's own row instead would let a child set disagree
    # with the parent whose exemption it was — the shape the `pza` leak had.
    if printing.security_stamp == UNIVERSES_BEYOND_STAMP and not (
        row is not None and row.stamp_exempt
    ):
        return "4.3.5 security_stamp triangle"
    if printing.lang != "en":
        return "4.3.6 non-English"
    if printing.flavor_name is not None:
        return "4.3.7 flavor_name"
    if scry_set is None:
        # A printing whose set is absent from /sets cannot be date-checked or plane-mapped. It is
        # a data surprise, not a rule; 4.6.4 will fail on it if it survives to be a first
        # printing, so record it here rather than dropping it silently.
        return None
    if scry_set.released_at > as_of:
        return "4.3.8 set unreleased on the run date"
    return None


# --------------------------------------------------------------------------------------------
# Stage 3 — exclude cards (PRD 4.4)
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CardExclusionResult:
    included: set[str]
    """``oracle_id`` of every card that survives."""
    excluded_by_rule: Counter[str]
    universes_beyond_cards: int


def exclude_cards(
    all_printings: list[RawPrinting],
    included_printings: list[RawPrinting],
    appendices: Appendices,
    sets: dict[str, ScrySet],
) -> CardExclusionResult:
    """PRD 4.4, over every printing in the bulk file — not only the ones 4.3 kept.

    Rule 3 is the reason ``all_printings`` is needed: the Universes Beyond origin test looks at a
    card's *earliest* printing of any kind, so that Sol Ring is not exiled by its Warhammer
    40,000 reprint and The One Ring is not rescued by its appearance in The List (PRD 4.4.3).

    ``sets`` is needed for the same reason 4.3.1 needs it: the origin test reads Appendix B, and
    Appendix B rows a product rather than every set code Scryfall splits it into.
    """
    by_code = appendices.by_code()
    exempt_codes = appendices.secret_lair.exempt_codes

    earliest: dict[str, RawPrinting] = {}
    content_warning: set[str] = set()
    meld_results: set[str] = set()
    for printing in all_printings:
        current = earliest.get(printing.oracle_id)
        if current is None or printing.order_key < current.order_key:
            earliest[printing.oracle_id] = printing
        if printing.content_warning:
            content_warning.add(printing.oracle_id)
        if printing.is_meld_result:
            meld_results.add(printing.oracle_id)

    with_included: set[str] = set()
    exempted: set[str] = set()
    for printing in included_printings:
        with_included.add(printing.oracle_id)
        if printing.set_code in exempt_codes:
            exempted.add(printing.oracle_id)

    excluded_by_rule: Counter[str] = Counter()
    included: set[str] = set()
    universes_beyond = 0

    for oracle_id in sorted(with_included):
        if oracle_id in content_warning:
            excluded_by_rule["4.4.2 content_warning"] += 1
            continue
        if oracle_id in meld_results:
            excluded_by_rule["4.4.6 meld result"] += 1
            continue
        first_ever = earliest[oracle_id]
        # 4.4.5: an `slx` printing (Universes Within) exempts the card from rule 3 outright.
        if oracle_id not in exempted and _originates_universes_beyond(first_ever, by_code, sets):
            excluded_by_rule["4.4.3 Universes Beyond origin"] += 1
            universes_beyond += 1
            continue
        included.add(oracle_id)

    # 4.4.1 is the complement of "has an included printing", so it is counted, not iterated.
    all_oracle_ids = set(earliest)
    excluded_by_rule["4.4.1 no included printing"] = len(all_oracle_ids - with_included)

    return CardExclusionResult(
        included=included,
        excluded_by_rule=excluded_by_rule,
        universes_beyond_cards=universes_beyond,
    )


def _originates_universes_beyond(
    first_ever: RawPrinting, by_code: dict[str, SetEntry], sets: dict[str, ScrySet]
) -> bool:
    """PRD 4.4.3, read as a test on the *earliest* printing.

    Both clauses bind to the earliest printing. Applying the stamp clause to *any* printing would
    exile in-universe staples reprinted inside Universes Beyond products, which is precisely the
    failure 4.4.3's own rationale rules out and which PRD 9.1.5's Sol Ring row locks against.

    The Appendix B lookup is :func:`governing_set_row`, the same walk 4.3.1 uses. Reading it as
    "own row only" would leave the two rules disagreeing about what "its set is Universes Beyond"
    means for a child set — the shape the `pza` leak had. Nothing observable depends on it today
    (a card first printed in an inherited-drop set has no included printing there, so 4.4.1 takes
    it first, and genuine originals carry the triangle stamp the second clause catches), but two
    accidents are not a reason for one file to read one appendix two ways.

    The stamp clause honours :attr:`~.appendices.SetEntry.stamp_exempt` for the same reason 4.3.5
    does, and this is the half that is easy to miss: exempting a set in 4.3.5 alone lets its
    printings through stage 2 and straight into this test, where the identical stamp excludes the
    *card* instead. The set would move from "dropped by 4.3.5" to "dropped by 4.4.3" and ship
    nothing, which is how `clu` behaved before the exemption reached both sites.
    """
    resolved = governing_set_row(first_ever.set_code, by_code, sets)
    if resolved is not None and resolved[0].universes_beyond:
        return True
    if resolved is not None and resolved[0].stamp_exempt:
        return False
    return first_ever.security_stamp == UNIVERSES_BEYOND_STAMP and first_ever.flavor_name is None


# --------------------------------------------------------------------------------------------
# Stage 4 — first printing (PRD 4.5)
# --------------------------------------------------------------------------------------------


def first_printing_sort_key(
    printing: RawPrinting, sets: dict[str, ScrySet]
) -> tuple[str, int, str, str, str]:
    """PRD 4.5.1: earliest release date, then set-type priority, then set code.

    **Deviation from the literal wording of 4.5.1, reported to the CEO in the first run's report.**
    4.5.1 says "earliest *set* release date". That is wrong for rolling products. The List
    (``plst``) carries a single set date of 2020-09-26 but keeps adding printings for years, so
    ordering by the set date made The List the first printing of 706 cards that had plainly been
    printed elsewhere first — Academy Manufactor before Modern Horizons 2, A Killer Among Us
    before Murders at Karlov Manor — and would have moved every one of them onto the wrong plane.

    The date used is therefore the *printing's* own ``released_at``, which Scryfall sets per
    printing and which equals the set's date for every ordinary set. The set-type priority and
    set code still break ties exactly as 4.5.1 specifies, and chronology bands (5.4.2) are
    unaffected: a band is a position in the plane's set list, not a date comparison.

    Collector number and printing id extend the key so the order is total — two printings of one
    card inside a single set must not depend on input order (PRD 8.9.1).
    """
    scry_set = sets.get(printing.set_code)
    priority = (
        FIRST_PRINTING_SET_TYPE_PRIORITY.get(scry_set.set_type, _OTHER_SET_TYPE_PRIORITY)
        if scry_set
        else _OTHER_SET_TYPE_PRIORITY
    )
    return (
        printing.released_at,
        priority,
        printing.set_code,
        printing.collector_number,
        printing.id,
    )


def choose_first_printings(
    included_printings: list[RawPrinting], included_cards: set[str], sets: dict[str, ScrySet]
) -> dict[str, RawPrinting]:
    """PRD 4.5: one first printing per included card."""
    best: dict[str, RawPrinting] = {}
    best_key: dict[str, tuple[str, int, str, str, str]] = {}
    for printing in included_printings:
        if printing.oracle_id not in included_cards:
            continue
        key = first_printing_sort_key(printing, sets)
        current = best_key.get(printing.oracle_id)
        if current is None or key < current:
            best[printing.oracle_id] = printing
            best_key[printing.oracle_id] = key
    return best


# --------------------------------------------------------------------------------------------
# Stage 5 — assign plane (PRD 4.6)
# --------------------------------------------------------------------------------------------


class UnmappedSetError(RuntimeError):
    """PRD 4.6.4. New sets are added to Appendix B deliberately, never bucketed silently."""


class OverrideDriftError(RuntimeError):
    """An ``overrides.json`` record names a card its ``oracle_id`` no longer identifies.

    Curated by hand, keyed by an opaque id, and read by nobody until it misfires: exactly the file
    whose carried name has to be checked rather than trusted (see
    :class:`~eternities.pipeline.appendices.CardOverride`).
    """


@dataclass(slots=True)
class PlaneAssignment:
    by_oracle_id: dict[str, str] = field(default_factory=dict)
    via_parent: dict[str, str] = field(default_factory=dict)
    """Set code -> parent set code, for every card mapped through rule 3 (reported per PRD 4.6)."""
    via_override: list[str] = field(default_factory=list)
    """``"<name> -> <plane>"`` for each applied override, in the report's reading order."""
    unused_overrides: list[str] = field(default_factory=list)
    """Records that matched no first printing — curated lines doing nothing (PRD 4.9.2).

    Not an error. An override for a card some 4.3/4.4 rule excludes, or one stranded by a Scryfall
    oracle-id merge, is a real state of a hand-maintained file, and the run's answer is still
    correct without it. But a curated line that silently does nothing is the failure this repo's
    two "cards via overrides" appendix notes already had — Appendix B claimed a curation that was
    never written — so it is reported rather than swallowed."""
    unmapped: dict[str, int] = field(default_factory=dict)
    """Set code -> card count, for sets with no Appendix B row and no mapped parent."""


def assign_planes(
    first_printings: dict[str, RawPrinting],
    sets: dict[str, ScrySet],
    appendices: Appendices,
) -> PlaneAssignment:
    """PRD 4.6, rules in order, first match wins. Raises on an unmapped set."""
    by_code = appendices.by_code()
    result = PlaneAssignment()
    applied: set[str] = set()

    for oracle_id in sorted(first_printings):
        printing = first_printings[oracle_id]
        override = appendices.overrides.get(oracle_id)
        if override is not None:
            if override.card_name != printing.card_name:
                raise OverrideDriftError(
                    f"overrides.json record {oracle_id} says {override.card_name!r} but that "
                    f"oracle_id is {printing.card_name!r} on this bulk file. Re-check the "
                    "curation: either the name is stale or the id is the wrong card."
                )
            result.by_oracle_id[oracle_id] = override.plane
            result.via_override.append(f"{override.card_name} -> {override.plane}")
            applied.add(oracle_id)
            continue

        # Rules 2 and 3 are one walk, not two lookups: `governing_set_row` returns the set's own
        # row when it has one and the nearest ancestor's otherwise, which is exactly what 4.6
        # states. Climbing a single level instead — as this did — makes a grandchild set fail
        # 4.6.4 rather than inherit, and leaves a third reading of "parent" in the codebase after
        # 4.3.1 and the stamp check were unified on this one.
        resolved = governing_set_row(printing.set_code, by_code, sets)
        if resolved is not None and (plane := resolved[0].plane) is not None:
            source = resolved[1]
            result.by_oracle_id[oracle_id] = plane
            if source != printing.set_code:
                result.via_parent[printing.set_code] = source
            continue

        result.unmapped[printing.set_code] = result.unmapped.get(printing.set_code, 0) + 1

    result.unused_overrides = [
        f"{o.card_name} ({oid}) -> {o.plane}"
        for oid, o in sorted(appendices.overrides.items(), key=lambda kv: kv[1].card_name)
        if oid not in applied
    ]

    if result.unmapped:
        listing = ", ".join(
            f"{code} ({count} cards)" for code, count in sorted(result.unmapped.items())
        )
        raise UnmappedSetError(
            "PRD 4.6.4: first-printing sets with no Appendix B row and no mapped parent — "
            f"{listing}. Add a row to pipeline/data/appendix_b.json and re-run."
        )
    return result
