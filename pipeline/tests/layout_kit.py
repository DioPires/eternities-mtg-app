"""Shared helpers for the allocator's tests (PRD v4 5.4, 8.8.1)."""

from __future__ import annotations

from functools import cache

from eternities.layout import trig
from eternities.layout.exact import Directions


@cache
def directions() -> Directions:
    """The committed trig table, read once for the whole test run."""
    return Directions(trig.load())
