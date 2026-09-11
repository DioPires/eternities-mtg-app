"""The seeded layout rules of PRD 8.6, shared by the fixture generator and Phase 1's pipeline.

Kept free of Scryfall concepts on purpose: it maps counts and hue classes to positions and nothing
else, so Phase 1 can reuse it verbatim.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from ..contract.enums import FRAME_RADIUS, HueClass, PlaneKind
from . import rng

R_MIN: Final = 3.0
R_MAX: Final = 12.0
"""PRD 5.3.2: visual radius is log(card count), clamped to [r_min, r_max]."""

RADIUS_SPAN_CARDS: Final = 30000
"""The card count at which a plane's radius reaches ``R_MAX`` — where 5.3.2's clamp bites.

Not a spec constant. 5.3.2 fixes the curve ("log(card count), clamped to [r_min, r_max]") and
leaves the normalisation open, so this is a visual tunable; it was an unnamed literal inside
:func:`visual_radius`. It is deliberately *not* re-derived per run from the largest plane: radii
feed 8.6.1's plane placement by rejection sampling, so moving this moves every plane's home
position, renames the dataset directory and forces a full refresh — a value that drifted with the
data would do all of that on every run.

Which leaves the clamp reachable, and reaching it invisible in the artefacts: planes of 30,000 and
60,000 cards both encode radius 12.0. Production is not close: its largest *plane* is `dominaria`
at 6,266 cards (2026-09-06) — 84.8% of the span on the log scale, radius 10.63 of 12, below the
0.9 reporting fraction, which is why the run report says no plane is within 90% of the span. The
28,587 that sits near the clamp is the whole multiverse's card count, not any one plane's, and the
gap between the two is the headroom. :func:`radius_saturation` exists so the run report tracks
that per plane, rather than the next refresh finding out (review finding D2)."""

RADIUS_SATURATION_REPORT_FRACTION: Final = 0.9
"""Saturation from here up is reported per plane (PRD 4.9.2)."""

SPIRAL_THRESHOLD: Final = 50
"""PRD 5.3.6: >= 50 cards is a five-arm spiral, 1-49 an irregular cloud, 0 an empty glow."""

ARMS: Final = 5

ARM_WIDTH_BASE: Final = 0.35
"""An arm's angular half-width as a fraction of the arm *spacing*, before 8.6.2's scaling law.

PRD 8.6.2 fixes the scaling (``sqrt(count_arm / mean_count)``, clamped) but says nothing about the
base, so this is a visual tunable rather than a spec constant. It was 0.5, which makes an arm's full
width ``2 * 0.5 * 360/ARMS`` = 72 degrees against a spacing of exactly 72 degrees: at
``arm_width_scale == 1.0`` the five arms tile the disc with no dark lane at all. Because colour
balance improves with card count, scale approaches 1.0 exactly on the large planes PRD 9.3
criterion 2 governs, so the arms were least legible where the criterion asks for most. 0.35 gives a
50.4-degree arm and a 21.6-degree lane at scale 1.0 (DEC-683/DEC-684)."""

BULGE_SCALE: Final = 0.3
HALO_MIN: Final = 1.05
HALO_MAX: Final = 1.2
BAND_JITTER: Final = 0.35
"""PRD 8.6.2: radial jitter is +/- 0.35 of a band."""

PLANE_MARGIN_FACTOR: Final = 0.15
"""PRD 5.3.3, as a fraction of mean plane spacing: the anti-overlap margin :func:`place_planes`
must be given. Every plane drifts by ``DRIFT_FACTOR`` of the same spacing and a pair can drift
toward each other, so this has to clear twice that with room to spare. Named rather than written
twice, because the pipeline and the fixture generator both have to pass the same value."""

DRIFT_FACTOR: Final = 0.03
"""PRD 5.3.15: drift amplitude is 3% of mean plane spacing."""

FRAME_CLAMP_SAFETY: Final = 0.995
"""How far inside ``FRAME_RADIUS`` :func:`_clamp_to_frame` actually clamps.

``float16(1.2)`` is ``1.2001953125``, so a star sitting exactly on the frame radius fails the 8.9.1
invariant once it is encoded. The margin is what keeps the invariant true of the *bytes*."""


@dataclass(frozen=True, slots=True)
class PlaneMotion:
    """The seeded per-plane parameters of PRD 5.3.14-15, 5.4.13 and 8.6.2."""

    tilt: tuple[float, float, float, float]
    spin_period_s: float
    spin_direction: int
    drift_amplitude: float
    drift_period_s: float
    drift_phase: float
    shear_amplitude: float
    shear_period_s: float
    shear_phase: float
    arm_pitch: float
    disc_thickness: float
    bar: bool


def radius_saturation(card_count: int) -> float:
    """Where this card count sits on ``RADIUS_SPAN_CARDS``, on the log scale that sets the radius.

    ``1.0`` means the plane is clamped at ``R_MAX`` and any growth from here is unrepresentable.
    Unclamped on purpose: a value above 1.0 is the number the report needs to say *how far* past
    the span the data has gone.
    """
    if card_count <= 0:
        return 0.0
    return math.log(card_count + 1) / math.log(RADIUS_SPAN_CARDS)


def visual_radius(card_count: int) -> float:
    """PRD 5.3.2. Zero-card planes render at ``R_MIN``; see ``RADIUS_SPAN_CARDS`` for the clamp."""
    if card_count <= 0:
        return R_MIN
    return R_MIN + (R_MAX - R_MIN) * min(radius_saturation(card_count), 1.0)


def plane_kind(slug: str, card_count: int) -> PlaneKind:
    if slug == "blind-eternities":
        return PlaneKind.DUST
    if card_count == 0:
        return PlaneKind.EMPTY
    if card_count < SPIRAL_THRESHOLD:
        return PlaneKind.IRREGULAR
    return PlaneKind.SPIRAL


def _quaternion_from_axis_angle(
    axis: tuple[float, float, float], angle: float
) -> tuple[float, float, float, float]:
    length = math.sqrt(sum(c * c for c in axis)) or 1.0
    x, y, z = (c / length for c in axis)
    half = angle * 0.5
    s = math.sin(half)
    return (x * s, y * s, z * s, math.cos(half))


def plane_motion(slug: str, mean_spacing: float) -> PlaneMotion:
    """Seeded motion parameters. The Blind Eternities gets the identity transform (PRD 8.3)."""
    if slug == "blind-eternities":
        return PlaneMotion(
            tilt=(0.0, 0.0, 0.0, 1.0),
            spin_period_s=0.0,
            spin_direction=1,
            drift_amplitude=0.0,
            drift_period_s=0.0,
            drift_phase=0.0,
            shear_amplitude=0.0,
            shear_period_s=0.0,
            shear_phase=0.0,
            arm_pitch=0.0,
            disc_thickness=0.05,
            bar=False,
        )

    tilt_axis = (
        rng.between(-1.0, 1.0, slug, "tiltx"),
        rng.between(-0.35, 0.35, slug, "tilty"),
        rng.between(-1.0, 1.0, slug, "tiltz"),
    )
    return PlaneMotion(
        tilt=_quaternion_from_axis_angle(tilt_axis, rng.between(-0.9, 0.9, slug, "tiltangle")),
        # PRD 5.3.14: 2-5 minute spin.
        spin_period_s=rng.between(120.0, 300.0, slug, "spin"),
        spin_direction=1 if rng.flag(0.5, slug, "spindir") else -1,
        # PRD 5.3.15: 3% of mean plane spacing, 60-120 s.
        drift_amplitude=DRIFT_FACTOR * mean_spacing,
        drift_period_s=rng.between(60.0, 120.0, slug, "driftperiod"),
        drift_phase=rng.between(0.0, 2.0 * math.pi, slug, "driftphase"),
        # PRD 5.4.13: amplitude <= 10 degrees, period 40-90 s.
        shear_amplitude=rng.between(0.02, math.radians(10.0), slug, "shearamp"),
        shear_period_s=rng.between(40.0, 90.0, slug, "shearperiod"),
        shear_phase=rng.between(0.0, 2.0 * math.pi, slug, "shearphase"),
        arm_pitch=rng.between(0.35, 0.85, slug, "pitch"),
        disc_thickness=rng.between(0.035, 0.07, slug, "thickness"),
        bar=rng.flag(0.3, slug, "bar"),
    )


def place_planes(
    entries: list[tuple[str, float, bool]],
    multiverse_radius: float,
    margin: float,
) -> dict[str, tuple[float, float, float]]:
    """PRD 8.6.1 plane placement by seeded rejection sampling.

    ``entries`` are ``(slug, visual_radius, is_zero_card)``. Returns home positions. Placement is
    largest-first so the tight constraints are satisfied while the disc is still empty. The
    ``margin`` must be at least twice the drift amplitude (PRD 5.3.3), which the caller enforces.
    """
    half_thickness = 0.075 * multiverse_radius
    placed: list[tuple[str, float, tuple[float, float, float]]] = []
    result: dict[str, tuple[float, float, float]] = {}

    for slug, radius, zero_card in sorted(entries, key=lambda e: (-e[1], e[0])):
        position: tuple[float, float, float] | None = None
        for attempt in range(4000):
            # sqrt keeps the sample uniform over the disc's area.
            u = rng.unit(slug, "r", attempt)
            frac = math.sqrt(0.5 + 0.5 * u) if zero_card else math.sqrt(u)
            r = frac * (multiverse_radius - radius)
            theta = rng.between(0.0, 2.0 * math.pi, slug, "theta", attempt)
            y = rng.gaussian(slug, "y", attempt) * half_thickness * 0.5
            y = max(-half_thickness, min(half_thickness, y))
            candidate = (r * math.cos(theta), y, r * math.sin(theta))
            if all(
                _distance(candidate, other) >= radius + other_radius + margin
                for _, other_radius, other in placed
            ):
                position = candidate
                break
        if position is None:
            raise RuntimeError(
                f"could not place plane {slug!r} without overlap after 4000 attempts; "
                "raise multiverse_radius or lower r_max"
            )
        placed.append((slug, radius, position))
        result[slug] = position
    return result


def _distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)))


def card_position(
    plane_slug: str,
    oracle_id: str,
    hue: HueClass,
    band: int,
    band_count: int,
    motion: PlaneMotion,
    arm_width_scale: float,
    spiral: bool,
) -> tuple[float, float, float]:
    """PRD 8.6.2 plane-local card placement. Always inside ``FRAME_RADIUS``."""
    bands = max(band_count, 1)
    jitter_r = rng.between(-BAND_JITTER, BAND_JITTER, plane_slug, oracle_id, "jr")
    r = (band + 0.5 + jitter_r) / bands
    r = min(max(r, 0.02), 1.0)

    thickness = motion.disc_thickness

    if hue is HueClass.MULTICOLOUR:
        r *= BULGE_SCALE
        theta = rng.between(0.0, 2.0 * math.pi, plane_slug, oracle_id, "bulge")
        thickness *= 3.0
    elif hue is HueClass.COLOURLESS:
        r = rng.between(HALO_MIN, HALO_MAX, plane_slug, oracle_id, "halo")
        theta = rng.between(0.0, 2.0 * math.pi, plane_slug, oracle_id, "halotheta")
    elif not spiral:
        # PRD 5.4.6 / 8.6.2: under 50 cards, angle is uniform everywhere.
        theta = rng.between(0.0, 2.0 * math.pi, plane_slug, oracle_id, "uniform")
    else:
        arm = int(hue)  # W U B R G map to arms 0-4 (PRD 8.6.2).
        r0 = 0.1
        spread = (2.0 * math.pi / ARMS) * ARM_WIDTH_BASE * arm_width_scale
        jitter_theta = rng.between(-spread, spread, plane_slug, oracle_id, "jt")
        theta = (
            2.0 * math.pi * arm / ARMS + motion.arm_pitch * math.log(max(r, r0) / r0) + jitter_theta
        )

    x = r * math.cos(theta)
    z = r * math.sin(theta)
    if motion.bar and hue is HueClass.MULTICOLOUR:
        x *= 1.8
    y = rng.gaussian(plane_slug, oracle_id, "y") * thickness

    return _clamp_to_frame((x, y, z))


def _clamp_to_frame(p: tuple[float, float, float]) -> tuple[float, float, float]:
    """PRD 8.9.1 invariant: plane-local positions stay inside the frame radius of 1.2."""
    length = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
    limit = FRAME_RADIUS * FRAME_CLAMP_SAFETY
    if length <= limit:
        return p
    scale = limit / length
    return (p[0] * scale, p[1] * scale, p[2] * scale)


DUST_ATTEMPTS: Final = 24
"""PRD 8.6.3 samples per dust card; the best-weighted one wins."""

DUST_EXCLUSION_FACTOR: Final = 1.3
"""A dust card must clear this multiple of a plane's visual radius."""


@dataclass(frozen=True, slots=True)
class DustField:
    """The plane geometry PRD 8.6.3's scatter reads, with its per-plane tables built once.

    :func:`scatter` used to take the raw ``plane_positions``/``plane_radii`` lists and re-derive
    everything per card: the nearest-neighbour lookup was a full 86-plane scan run twelve times
    *per card*, and the exclusion radius was re-multiplied for every plane on every attempt. On
    production's 4,980 dust cards that came to roughly 15.5 million distance computations in pure
    Python, two thirds of them re-deriving the same 86-entry table (review finding D5).

    Nothing about the sampling changed: the tables are pure functions of the plane geometry, which
    is fixed before the first dust card is placed, so every position this produces is the position
    the per-card version produced. ``test_fixtures`` and the committed fixture hashes are what
    hold that.
    """

    positions: tuple[tuple[float, float, float], ...]
    radii: tuple[float, ...]
    multiverse_radius: float
    nearest_other: tuple[int, ...]
    """Index of each plane's nearest other plane — 86 x 86 once, not 86 per card."""
    exclusion: tuple[float, ...]
    """``DUST_EXCLUSION_FACTOR * radius`` per plane."""
    neighbour_spread: tuple[float, ...]
    """``0.35 * distance`` to the nearest other plane, the midpoint sampler's jitter scale."""

    @classmethod
    def build(
        cls,
        plane_positions: list[tuple[float, float, float]],
        plane_radii: list[float],
        multiverse_radius: float,
    ) -> DustField:
        nearest = tuple(_nearest_other(i, plane_positions) for i in range(len(plane_positions)))
        return cls(
            positions=tuple(plane_positions),
            radii=tuple(plane_radii),
            multiverse_radius=multiverse_radius,
            nearest_other=nearest,
            exclusion=tuple(DUST_EXCLUSION_FACTOR * r for r in plane_radii),
            neighbour_spread=tuple(
                0.35 * _distance(plane_positions[i], plane_positions[j])
                for i, j in enumerate(nearest)
            ),
        )

    def scatter(self, oracle_id: str, index: int) -> tuple[float, float, float]:
        """PRD 8.6.3: through the disc, avoiding plane interiors, densest between neighbours.

        Returns a position in the Blind Eternities' own local frame, which is multiverse
        coordinates scaled by ``1 / multiverse_radius`` (PRD 8.3), so the shader path is identical
        for every star.
        """
        multiverse_radius = self.multiverse_radius
        half_thickness = 0.075 * multiverse_radius
        positions = self.positions
        best: tuple[float, float, float] | None = None
        best_weight = -1.0

        for attempt in range(DUST_ATTEMPTS):
            # Half the samples are biased toward a midpoint between two neighbouring planes, which
            # is the "connecting tissue" reading of PRD 8.6.3; the rest fill the volume.
            if positions and attempt % 2 == 0:
                a = rng.integer(0, len(positions) - 1, oracle_id, "pa", attempt)
                pa, pb = positions[a], positions[self.nearest_other[a]]
                t = rng.between(0.35, 0.65, oracle_id, "t", attempt)
                spread = self.neighbour_spread[a]
                candidate = tuple(
                    pa[i] + (pb[i] - pa[i]) * t + rng.gaussian(oracle_id, "s", attempt, i) * spread
                    for i in range(3)
                )
            else:
                u = rng.unit(oracle_id, "r", attempt)
                r = math.sqrt(u) * multiverse_radius
                theta = rng.between(0.0, 2.0 * math.pi, oracle_id, "theta", attempt)
                candidate = (
                    r * math.cos(theta),
                    rng.gaussian(oracle_id, "y", attempt) * half_thickness * 0.6,
                    r * math.sin(theta),
                )

            x, y, z = candidate
            y = max(-half_thickness * 1.4, min(half_thickness * 1.4, y))
            radial = math.sqrt(x * x + z * z)
            if radial > multiverse_radius:
                scale = multiverse_radius / radial
                x, z = x * scale, z * scale
            candidate = (x, y, z)

            clearance = self._clearance(candidate)
            if clearance <= 0.0:
                continue
            # Prefer samples nearest a plane's exclusion shell: the dust reads densest there.
            weight = 1.0 / (1.0 + clearance)
            if weight > best_weight:
                best_weight, best = weight, candidate

        if best is None:
            # Every sample landed inside a plane: fall back to the outer rim, always clear.
            theta = rng.between(0.0, 2.0 * math.pi, oracle_id, "fallback", index)
            best = (
                multiverse_radius * 0.98 * math.cos(theta),
                0.0,
                multiverse_radius * 0.98 * math.sin(theta),
            )

        inv = 1.0 / multiverse_radius
        return _clamp_to_frame((best[0] * inv, best[1] * inv, best[2] * inv))

    def _clearance(self, candidate: tuple[float, float, float]) -> float:
        """Distance from the nearest plane's exclusion shell, or ``<= 0`` inside one.

        The caller only distinguishes "inside a plane" from "this far out", so the scan stops at
        the first plane that swallows the candidate instead of finishing the ``min`` — and on the
        midpoint-biased samples, which aim between two planes, that is where most of them land.
        The value returned when nothing swallows it is the full minimum, computed with the same
        :func:`_distance` as before so the weighting is bit-for-bit what it was.
        """
        if not self.positions:
            return 1.0
        best = math.inf
        for position, exclusion in zip(self.positions, self.exclusion, strict=True):
            clearance = _distance(candidate, position) - exclusion
            if clearance <= 0.0:
                return clearance
            if clearance < best:
                best = clearance
        return best


def _nearest_other(index: int, positions: list[tuple[float, float, float]]) -> int:
    best, best_d = index, math.inf
    for j, p in enumerate(positions):
        if j == index:
            continue
        d = _distance(positions[index], p)
        if d < best_d:
            best, best_d = j, d
    return best


def brightness_for(printing_count: int, cap: int) -> int:
    """PRD 5.4.10: quantised log printing count, capped at the plane's 98th percentile."""
    capped = min(max(printing_count, 1), max(cap, 1))
    top = math.log(max(cap, 1) + 1.0)
    t = math.log(capped + 1.0) / top if top > 0 else 1.0
    return round(40 + 215 * min(max(t, 0.0), 1.0))


def arm_width_scale(arm_count: int, mean_count: float) -> float:
    """PRD 8.6.2: arm width scales with sqrt(count_arm / mean_count), clamped."""
    if mean_count <= 0:
        return 1.0
    return min(max(math.sqrt(arm_count / mean_count), 0.5), 1.8)


type Palette = tuple[float, float, float, float, float, float, float]

_NEBULA_BASE: Final[tuple[tuple[float, float, float], ...]] = (
    (0.98, 0.94, 0.84),  # W warm ivory
    (0.24, 0.55, 0.90),  # U cerulean
    (0.45, 0.28, 0.70),  # B violet
    (0.95, 0.42, 0.20),  # R ember orange
    (0.24, 0.68, 0.42),  # G viridian
    (0.92, 0.76, 0.30),  # multicolour gold
    (0.72, 0.75, 0.80),  # colourless silver
)


def palette_from_hue_counts(counts: Sequence[float]) -> Palette:
    """PRD 5.3.5: a plane's palette is its colour-identity distribution over the hue classes."""
    total = sum(counts)
    if total <= 0:
        return (1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7)
    w, u, b, r, g, m, c = (v / total for v in counts)
    return (w, u, b, r, g, m, c)


def nebula_tint(palette: Palette) -> tuple[float, float, float]:
    """PRD 5.3.5: a weighted blend of the two dominant hues, in the base hues of 5.4.8."""
    ranked = sorted(range(7), key=lambda i: (-palette[i], i))[:2]
    w0, w1 = palette[ranked[0]], palette[ranked[1]]
    total = (w0 + w1) or 1.0
    red, green, blue = (
        (_NEBULA_BASE[ranked[0]][c] * w0 + _NEBULA_BASE[ranked[1]][c] * w1) / total
        for c in range(3)
    )
    return (red, green, blue)
