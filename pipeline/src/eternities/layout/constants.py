"""The constants of PRD v4 5.4.1, in the integers the allocator and the checker compute with.

Lengths are millimetres and angles micro-degrees (5.4.18 (1)). This module is the only one the
independent checker shares with the allocator (8.3.3): a figure here is the nominal figure the
checker tests the emitted geometry against.
"""

from __future__ import annotations

from typing import Final

# 5.4.18 (1), (6): units and the trig table's resolution.
MICRO_PER_TURN: Final = 360_000_000
MICRO_PER_COUNT: Final = 1_000
"""Micro-degrees in one count of the trig table (a thousandth of a degree)."""
COUNTS_PER_TURN: Final = 360_000
COUNTS_PER_DEGREE: Final = 1_000

# 5.4.18 (4): the allocator's safety margin. The checker tests the nominal figure.
MARGIN: Final = 2

# 5.4.18 (8): the hexagonal lattice. x = 3,000 i + 1,500 k, z = 2,599 k.
LATTICE_PITCH: Final = 3_000
LATTICE_HALF_PITCH: Final = 1_500
LATTICE_ROW: Final = 2_599
JITTER_RADIUS: Final = 248
MIN_STAND_SPACING: Final = 2_500

# Stand geometry.
FOOTPRINT_WIDTH: Final = 700
FOOTPRINT_DEPTH: Final = 300
APRON_WIDTH: Final = 1_000
APRON_DEPTH: Final = 1_500
CORRIDOR_WIDTH: Final = 1_500
CORRIDOR_HALF_WIDTH: Final = 750
CORRIDOR_MIN_CROSSING: Final = 30_000_000
"""Two corridors that meet do so at 30 degrees or more (5.4.10), in micro-degrees."""

# Paths, pads, stones.
PATH_HALF_WIDTH: Final = 1_500
PAD_RADIUS: Final = 1_500
STONE_RADIUS: Final = 500
STONE_CLEARANCE: Final = 500
STONE_ALONG: Final = 4_000
STONE_ACROSS: Final = 3_000

# The plaza.
PLAZA_RADIUS: Final = 12_000
PLAZA_EDGE_RADIUS: Final = 15_000
PLAZA_APPROACH_LENGTH: Final = 10_000
PLAZA_APPROACH_END: Final = 25_000
PLAZA_APPROACH_STEP: Final = 10_000_000
PLAZA_APPROACH_TRIES: Final = 36
RETURN_PORTAL_SOUTH: Final = 8_000
ARRIVAL_YAW: Final = 90_000_000
"""North is +z and a yaw is counter-clockwise from +x (4.13.3), so facing north is 90 degrees."""

# Clusters.
CLUSTER_OFFSET: Final = 6_000
CLUSTER_RADIUS: Final = 4_500
SLOT_SPACING: Final = 9_000
CAP_MIN: Final = 3
CAP_MAX: Final = 8
CLUSTER_ALONG: Final = 1_500
CLUSTER_ACROSS: Final = 1_000
CORRIDOR_ARC_WINDOW: Final = 6_000
"""Test (e) of 5.4.9: a candidate's path vertex lies within 6 m of its slot along the path."""
MIN_CLUSTER: Final = 3

# The site path.
SWEEP_SPACING: Final = 21_000
CHORD_SHORTENING: Final = 4_500
HEAD_SHORTENING: Final = 1_500
SWEEP_WOBBLE: Final = 3_000
SWEEP_WAVELENGTH: Final = (24_000, 40_000)
SWEEP_TAPER: Final = 6_000
SAMPLE_STEP: Final = 500
HALF_TURN_STEP: Final = 15_000_000
HALF_TURN_SEGMENTS: Final = 12
SWEEP_TRIES: Final = 18
SWEEP_TRY_STEP: Final = 10_000_000
APPROACH_LENGTH: Final = 10_000
"""From the pad's centre to the approach point (5.4.8): the point lies 11.5 m past the head."""

# The site blob.
BLOB_FLOOR: Final = 9_000
K_SITE: Final = 11_459_156
"""The integer nearest 36 m^2 / pi, in mm^2 (5.4.18 (13)). Pi is never computed."""
BLOB_VERTICES: Final = 72
BLOB_STEP: Final = 5_000_000
BLOB_AMPLITUDE: Final = (200, 1_000)
BLOB_DEFORMATION_DIVISOR: Final = 5
"""The deformation is 0.2: one fifth of the weighted cosines."""
BOUNDING_EXTRA: Final = 15_000
SITE_WIDEN_LIMIT: Final = 20

# Regions and site placement.
ANCHOR_SCALE: Final = (4, 5_000)
"""An anchor in thousandths is scaled by 0.8 R / 1,000 = 4 R / 5,000 (5.4.5)."""
WEIGHT_SCALE: Final = 16_000
"""A weight in thousandths times (0.25 R)^2 is weight * R^2 / 16,000 (5.4.5)."""
CELL_MARGIN: Final = 10_000
SITE_PITCH: Final = 10_000
SITE_SPACING: Final = 10_000

# The trail.
GRID_PITCH: Final = 5_000
OBSTACLE_EXPANSION: Final = 5_000
STRAIGHT_COST: Final = 5
DIAGONAL_COST: Final = 7
NEAR_BLOB: Final = 10_000
TRAIL_WOBBLE: Final = 3_000
TRAIL_WAVELENGTH: Final = (30_000, 50_000)
TRAIL_TAPER: Final = 10_000

# The world.
WORLD_FLOOR: Final = 30_000
WORLD_PLAZA_TERM: Final = 25_000
WORLD_FIT_TERM: Final = 35_000
PASS_LIMIT: Final = 20
WORLD_VERTICES: Final = 72
DISC_VERTICES: Final = 72
DISC_STEP_COUNTS: Final = 5_000
"""A disc is the 72-gon of the table directions of every 5 degrees (5.4.18 (13))."""

# The gap bounds of 5.4.10, asserted by the checker on the emitted geometry.
GAP_TO_FIRST: Final = 18_000
GAP_BETWEEN: Final = 18_000
GAP_TO_END: Final = 10_000

SEED_PREFIX: Final = "eternities-v4"


def site_seed(plane: str, site_key: str) -> str:
    return f"{SEED_PREFIX}|{plane}|{site_key}"


def world_seed(plane: str) -> str:
    return f"{SEED_PREFIX}|{plane}|world"
