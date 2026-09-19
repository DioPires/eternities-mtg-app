"""Seeded layout rules shared by the fixture generator and the pipeline.

Kept free of Scryfall concepts on purpose: it maps counts and hue classes to positions and nothing
else, so both callers reuse it verbatim.

**Contract v3 retired the spiral disc.** PRD 8.6.2's arm generation, ``arm_width_scale`` (inert on
every plane over 500 cards — review §4.1), ``BULGE_SCALE``, the chronology-*radius* mapping of PRD
5.4.2, shear, the bar and the disc thickness all went with the galaxy, and so did PRD 5.3.2's
``log N`` radius and its clamp. What replaces them is the surface law of docs/worlds/spec.md §1.3,
which lives in :mod:`eternities.fixtures.surface` — a world is a sphere of cells, one per card —
and §1.8's belt, which is what the Blind Eternities becomes. This module keeps the rules that are
still about *where a plane sits in the system* rather than where a card sits on a plane.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from ..contract.enums import FRAME_RADIUS, PlaneKind
from . import rng

SPIRAL_THRESHOLD: Final = 50
"""PRD 5.3.6's population threshold, still the source of ``kind`` in ``planes.json``.

``kind`` is one of the fields §2.4 keeps, and it keeps its v2 meaning with it: the worlds renderer
does not read it, the galaxy renderer does, and re-labelling the enum would be a contract change
§2.4 did not ask for."""

HOME_ELEVATION_RAD: Final = math.pi / 6
"""PRD 8.6.1 / `HOME_POLAR` in ``web/src/camera/framing.ts``: the home view looks down on the disc
from 30 degrees above it.

The ``home`` law has to know this angle (§1.11's layout amendment, DEC-759). The camera compresses
in-plane distance by ``sin(30 deg) = 0.5`` and leaves vertical distance nearly intact, and that
compression is the whole reason one world ends up behind another on screen."""

HOME_DISTANCE_FACTOR: Final = 1.9
"""``framing.multiverse``'s ``frame: r * 1.9`` — where the home view's eye sits, in multiverse
radii. With :data:`REFERENCE_FOCAL_PX` it converts a pixel size into world units."""

REFERENCE_FOCAL_PX: Final = 1080.0 / (2.0 * math.tan(math.radians(55.0) / 2.0))
"""§1.3's ``focalPx``: the reference viewport's focal length, 1080 rows at a 55 degree vertical
fov. Pixels are a viewport-relative unit, so a law written in them has to name the viewport it was
written for; on a shorter viewport the floor below is a larger share of the screen and the
separation this module buys shrinks with it."""

PICK_PROXY_MARGIN: Final = 1.15
"""``PLANE_PICK_MARGIN`` in ``web/src/scene/worlds/scenePicker.ts``: a plane is picked through a
proxy this much larger than the world it draws."""

PICK_FLOOR_PX: Final = 12.0
"""§1.11's screen-space pick floor: 24 CSS px of *diameter*, so 12 px of radius. A world smaller
than this on screen is still picked through a 24 px proxy, which is why the separation law floors
every plane's proxy here rather than using the drawn radius."""

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

BELT_RADIUS_FACTOR: Final = 1.12
"""§1.8: the belt sits at 1.12 x ``multiverseRadius`` — 145.6 units on production."""

BELT_SET_GAP: Final = 0.06
"""§1.8: a 6% gap at each end of a set's arc, so "one arc per set" reads as arcs and not as a
continuous smear."""

BELT_RADIAL_JITTER: Final = 0.06
BELT_VERTICAL_JITTER: Final = 0.035
"""§1.8, both as fractions of the belt radius. A mathematically clean ring reads as a UI element,
not as debris; the jitter is what stops it. Deterministic, from the same seeded hash as everything
else here (PRD 4.9.1)."""


@dataclass(frozen=True, slots=True)
class PlaneMotion:
    """The seeded per-plane parameters of PRD 5.3.14-15.

    Seven fields shorter than v2: ``shearAmplitude``/``PeriodS``/``Phase``, ``armPitch``, ``bar``
    and the per-plane and top-level ``discThickness`` all retire with the spiral disc (§2.4).
    """

    tilt: tuple[float, float, float, float]
    spin_period_s: float
    spin_direction: int
    drift_amplitude: float
    drift_period_s: float
    drift_phase: float


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
    )


def pick_proxy_radius(radius: float, multiverse_radius: float) -> float:
    """The radius of a plane's pick proxy at the home view, in world units.

    §1.11 floors the plane-level proxy at 24 CSS px of diameter *after projection*, so a small
    world's pick target is not its drawn disc: it is whichever is larger of the drawn proxy and
    that floor. :func:`place_planes` separates the proxies, not the discs, because the proxy is
    what the pointer hits.
    """
    floor = PICK_FLOOR_PX * HOME_DISTANCE_FACTOR * multiverse_radius / REFERENCE_FOCAL_PX
    return max(PICK_PROXY_MARGIN * radius, floor)


def place_planes(
    entries: list[tuple[str, float, bool]],
    multiverse_radius: float,
    margin: float,
    drift_amplitude: float,
) -> dict[str, tuple[float, float, float]]:
    """PRD 8.6.1 plane placement by seeded rejection sampling.

    ``entries`` are ``(slug, visual_radius, is_zero_card)``. Returns home positions. Placement is
    largest-first so the tight constraints are satisfied while the disc is still empty. The
    ``margin`` must be at least twice the ``drift_amplitude`` (PRD 5.3.3), which the caller
    enforces; both rules below are stated at maximum drift, because a gap that exists only at rest
    is not a gap (PRD 8.9.1's reading on the world-space one).

    Two rules, and they answer different questions (§1.11's layout amendment, DEC-759):

    * ``margin`` keeps the *drawn* discs apart in world space, at maximum drift. PRD 5.3.3.
    * the **home-view separation rule** keeps the *pick proxies* apart on screen, at every azimuth
      of the multiverse's turn. A proxy floored to 24 px is 2.9 world units in radius on production,
      and the camera compresses in-plane distance by ``sin(30 deg)``, so two worlds a comfortable
      world-space margin apart can still land on top of each other in the home view. That is what
      §1.11 measured and could not fix from the renderer: a nearer disc takes the pixels, and no
      pick policy recovers them.

    The vertical scatter that PRD 8.6.1's disc thickness used to give each plane is gone with it,
    and that is not a simplification — it is half the fix. Over a turn a pair's worst screen
    separation is ``|d*sin(elev) - dy*cos(elev)|``: at 30 degrees, 8 units of height cancels 14
    units of in-plane distance, so the thickness was *manufacturing* coincidences that the
    in-plane rule cannot see. The disc is flat here; the belt (§1.8) keeps its own jitter.
    """
    proxy = {slug: pick_proxy_radius(radius, multiverse_radius) for slug, radius, _ in entries}
    sin_elevation = math.sin(HOME_ELEVATION_RAD)
    # Two planes can drift toward each other at once, so the worst case closes by both amplitudes.
    drift_closure = 2.0 * drift_amplitude
    placed: list[tuple[float, float, tuple[float, float, float]]] = []
    result: dict[str, tuple[float, float, float]] = {}

    for slug, radius, zero_card in sorted(entries, key=lambda e: (-e[1], e[0])):
        position: tuple[float, float, float] | None = None
        for attempt in range(4000):
            # sqrt keeps the sample uniform over the disc's area.
            u = rng.unit(slug, "r", attempt)
            frac = math.sqrt(0.5 + 0.5 * u) if zero_card else math.sqrt(u)
            r = frac * (multiverse_radius - radius)
            theta = rng.between(0.0, 2.0 * math.pi, slug, "theta", attempt)
            candidate = (r * math.cos(theta), 0.0, r * math.sin(theta))
            if all(
                _distance(candidate, other) >= radius + other_radius + margin
                and (_in_plane(candidate, other) - drift_closure) * sin_elevation
                >= proxy[slug] + other_proxy
                for other_radius, other_proxy, other in placed
            ):
                position = candidate
                break
        if position is None:
            raise RuntimeError(
                f"could not place plane {slug!r} after 4000 attempts; it either overlaps a "
                "neighbour in world space or its pick proxy overlaps one in the home view. "
                "Raise multiverse_radius, or lower the radius law's constant"
            )
        placed.append((radius, proxy[slug], position))
        result[slug] = position
    return result


def _in_plane(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    """Distance in the disc plane. The home view's compression acts on this, not on the 3-D one."""
    return math.hypot(a[0] - b[0], a[2] - b[2])


def _distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)))


def belt_position(
    oracle_id: str, set_band: int, band_count: int, index_in_set: int, set_size: int
) -> tuple[float, float, float]:
    """§1.8: one arc per set around the whole system, in the Blind Eternities' own local frame.

    The dust plane's local frame is multiverse coordinates scaled by ``1 / multiverseRadius`` (PRD
    8.3), so the belt's 1.12 R is simply 1.12 here and the shader path stays identical for every
    star.

    The belt replaces PRD 8.6.3's rejection-sampled scatter outright. The scatter existed to make
    4,980 cards — 17.4% of the multiverse, the largest population after Dominaria — look like
    "connecting tissue" between the planes; §1.8's judgement is that it should stop pretending to
    have a shape. One arc per set in chronological order is a reading, which a cloud was not.

    Cards spread evenly along their set's arc. The arc is that set's share of 360 degrees minus a
    6% gap at each end, so the arcs read as arcs. Radial and vertical jitter are seeded per card.
    """
    span = 2.0 * math.pi / max(band_count, 1)
    start = set_band * span + BELT_SET_GAP * span
    usable = span * (1.0 - 2.0 * BELT_SET_GAP)
    # `+ 1` in the denominator, so a set's first and last card sit inside its arc rather than on
    # the gap boundaries it just paid for.
    lam = start + usable * (index_in_set + 1) / (max(set_size, 1) + 1)

    radius = BELT_RADIUS_FACTOR * (
        1.0 + BELT_RADIAL_JITTER * rng.between(-1.0, 1.0, oracle_id, "beltr")
    )
    y = BELT_RADIUS_FACTOR * BELT_VERTICAL_JITTER * rng.between(-1.0, 1.0, oracle_id, "belty")
    return _clamp_to_frame((radius * math.cos(lam), y, radius * math.sin(lam)))


def _clamp_to_frame(p: tuple[float, float, float]) -> tuple[float, float, float]:
    """PRD 8.9.1 invariant: plane-local positions stay inside the frame radius of 1.2.

    The belt is the only thing that comes close now — 1.12 x 1.06 = 1.1872 against a limit of
    1.194 — and a world's cells are unit vectors, a long way inside. Kept because the invariant is
    about the *bytes*, and the margin is what stops ``float16(1.2) = 1.2001953125`` failing it.
    """
    length = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
    limit = FRAME_RADIUS * FRAME_CLAMP_SAFETY
    if length <= limit:
        return p
    scale = limit / length
    return (p[0] * scale, p[1] * scale, p[2] * scale)


def brightness_for(printing_count: int, cap: int) -> int:
    """PRD 5.4.10: quantised log printing count, capped at the plane's 98th percentile.

    Byte 9, still written and still unread by the worlds renderer — §2.1 keeps bytes 8-9 so that a
    v3 dataset would render on the galaxy path if the dual-scene period ever needs it. Reclaiming
    them is a v4 conversation.
    """
    capped = min(max(printing_count, 1), max(cap, 1))
    top = math.log(max(cap, 1) + 1.0)
    t = math.log(capped + 1.0) / top if top > 0 else 1.0
    return round(40 + 215 * min(max(t, 0.0), 1.0))


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
    """PRD 5.3.5: a plane's palette is its colour-identity distribution over the hue classes.

    Load-bearing under v3 in a way it was not under v2: §1.8 makes this the colour of an undetailed
    world below 6 px, through its deviation from the card-weighted multiverse mean.
    """
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
