"""Reproduce DEC-759's evidence: the layouts behind every number in spec.md §1.11's layout block.

    uv run --project pipeline python docs/worlds/dec759-separation-study.py /tmp/dec759

writes one `homes-*.json` per arm, then measure each with the committed sweep:

    DEC759_HOMES=/tmp/dec759/homes-new-shipped.json pnpm exec vitest run \\
      test/pick-target-separation.test.ts

`DEC759_VIEWPORT=1280x720` and `DEC759_AZIMUTHS=72` on the same command are the other two axes
that block reports. The default run of that file — no environment at all — is the committed
acceptance measurement and is what CI scores; this script exists because the *study* around it
spans layouts the tree does not otherwise contain.

Four arms isolate the two levers, all at today's constants and on the roster the production
dataset carries:

    old      PRD 8.6.1 as it was: the disc has thickness, no separation rule.
    flat     the thickness removed, still no separation rule.
    rule     the separation rule, with the thickness kept — so the rule has to pay for the
             vertical offset it cannot control, `|d*sin(elev) - dy*cos(elev)|`.
    new      both, which is `layout.place_planes` itself.

Each arm is also drawn six more times under salted keys. A layout is a *draw*, not a law: `home`
moves on every dataset refresh, so a single arm's count is one sample and the range across draws
is the claim that survives. The salt is applied by wrapping `rng`, so every draw runs through the
real placement code rather than a restatement of it.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import types
from collections.abc import Callable
from pathlib import Path
from typing import Any

from eternities.cli import DATASETS_FILE, REPO_ROOT, WEB_DATA_ROOT
from eternities.fixtures import layout, rng

Homes = dict[str, tuple[float, float, float]]
Entry = tuple[str, float, bool]

NONCES = ["shipped", "n1", "n2", "n3", "n4", "n5", "n6"]
OLD_LAYOUT_AT = "0be35f1:pipeline/src/eternities/fixtures/layout.py"
"""Where the pre-DEC-759 `place_planes` is read from, rather than restated here: a control a
reviewer has to trust my transcription of is not a control. Pinned to the commit DEC-759 branched
from, so the arm keeps meaning "the law before this change" after it merges."""


def roster() -> tuple[float, list[dict[str, Any]]]:
    registry = json.loads(DATASETS_FILE.read_text(encoding="utf-8"))
    planes = json.loads(
        (WEB_DATA_ROOT / str(registry["production"]) / "planes.json").read_text(encoding="utf-8")
    )
    named = [p for p in planes["planes"] if p["slug"] != "blind-eternities"]
    return float(planes["multiverseRadius"]), named


def old_place_planes() -> Callable[[list[Entry], float, float], Homes]:
    """The shipping law before DEC-759, loaded from git so the control is the real thing."""
    source = subprocess.run(
        ["git", "show", OLD_LAYOUT_AT], capture_output=True, text=True, check=True, cwd=REPO_ROOT
    ).stdout
    # A real module object registered in `sys.modules`, not a bare dict: `@dataclass` resolves
    # its own class's module to read annotations, and a synthetic namespace makes it fail.
    module = types.ModuleType("dec759_old_layout")
    sys.modules[module.__name__] = module
    exec(  # the input is a git object from this repository
        compile(
            source.replace("from . import rng", "from eternities.fixtures import rng").replace(
                "from ..contract.enums import", "from eternities.contract.enums import"
            ),
            "old_layout.py",
            "exec",
        ),
        module.__dict__,
    )
    place: Callable[[list[Entry], float, float], Homes] = module.place_planes
    return place


def ablation(
    entries: list[Entry],
    radius: float,
    margin: float,
    drift: float,
    *,
    flat: bool,
    rule: bool,
) -> Homes:
    """`flat` and `rule` as independent switches — the two cells `place_planes` cannot produce.

    The rule here carries the `- |dy| * cos(elev)` term the flat law does not need: with a
    thickness in play, height *cancels* in-plane distance at one of the two alignments where a
    pair lines up with the view, so a rule stated in-plane alone would be measuring nothing.
    """
    half = 0.075 * radius
    sin_e, cos_e = math.sin(layout.HOME_ELEVATION_RAD), math.cos(layout.HOME_ELEVATION_RAD)
    closure = (
        2.0 * drift * (1.0 + layout.DRIFT_VERTICAL_RATIO / math.tan(layout.HOME_ELEVATION_RAD))
    )
    placed: list[tuple[float, float, bool, tuple[float, float, float]]] = []
    result: Homes = {}
    for slug, r_visual, zero in sorted(entries, key=lambda e: (-e[1], e[0])):
        rho = layout.pick_proxy_radius(r_visual, radius)
        candidate = (0.0, 0.0, 0.0)
        for attempt in range(layout.PLACEMENT_ATTEMPTS):
            u = rng.unit(slug, "r", attempt)
            frac = math.sqrt(0.5 + 0.5 * u) if zero else math.sqrt(u)
            reach = frac * (radius - r_visual)
            theta = rng.between(0.0, 2.0 * math.pi, slug, "theta", attempt)
            y = 0.0
            if not flat:
                y = max(-half, min(half, rng.gaussian(slug, "y", attempt) * half * 0.5))
            candidate = (reach * math.cos(theta), y, reach * math.sin(theta))
            ok = True
            for other_r, other_rho, other_world, other in placed:
                if math.dist(candidate, other) < r_visual + other_r + margin:
                    ok = False
                    break
                if rule and (not zero or other_world):
                    gap = math.hypot(candidate[0] - other[0], candidate[2] - other[2]) - closure
                    if gap * sin_e - abs(candidate[1] - other[1]) * cos_e < rho + other_rho:
                        ok = False
                        break
            if ok:
                break
        placed.append((r_visual, rho, not zero, candidate))
        result[slug] = candidate
    return result


def main(out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    radius, named = roster()
    mean_spacing = 2.0 * radius / math.sqrt(len(named))
    margin = layout.PLANE_MARGIN_FACTOR * mean_spacing
    drift = layout.DRIFT_FACTOR * mean_spacing
    entries = [(p["slug"], float(p["radius"]), int(p["cardCount"]) == 0) for p in named]
    old = old_place_planes()
    real = {name: getattr(rng, name) for name in ("unit", "between", "gaussian")}

    for nonce in NONCES:
        if nonce == "shipped":
            for name, fn in real.items():
                setattr(rng, name, fn)
        else:
            rng.unit = lambda *k, _n=nonce: real["unit"](*k, _n)
            rng.between = lambda lo, hi, *k, _n=nonce: real["between"](lo, hi, *k, _n)
            rng.gaussian = lambda *k, _n=nonce: real["gaussian"](*k, _n)
        arms = {
            "old": old(entries, radius, margin),
            "flat": ablation(entries, radius, margin, drift, flat=True, rule=False),
            "rule": ablation(entries, radius, margin, drift, flat=False, rule=True),
            "new": layout.place_planes(entries, radius, margin, drift),
        }
        for arm, homes in arms.items():
            path = out_dir / f"homes-{arm}-{nonce}.json"
            path.write_text(
                json.dumps({s: [round(c, 6) for c in h] for s, h in sorted(homes.items())}),
                encoding="utf-8",
            )
        print(f"{nonce}: {' '.join(sorted(arms))} -> {out_dir}")

    for name, fn in real.items():
        setattr(rng, name, fn)
    # The `shipped` draw of the `old` arm must BE the shipped dataset, or the control is not one.
    control = json.loads((out_dir / "homes-old-shipped.json").read_text(encoding="utf-8"))
    drift_max = max(math.dist(control[p["slug"]], p["home"]) for p in named)
    print(f"control vs the published homes: {drift_max:.2e} (rounding only, or the control is bad)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/dec759")))
