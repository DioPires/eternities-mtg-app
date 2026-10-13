"""The static check of PRD v4 8.8.1: no floating-point operation in the allocator or the checker.

5.4.18 (2) makes every quantity of the allocator and of the pipeline's checker an ``int`` or a
``fractions.Fraction``. This test reads the source of those modules and fails on anything that
can make a float:

- a float or complex literal;
- a call of ``float``, ``complex`` or ``round`` (5.4.18 (3) has its own rounding rule);
- the operator ``/``, wherever it stands. A rational division is written ``Fraction(n, d)``, so
  the operator never appears and the test needs no types;
- a power whose exponent is not a whole literal of zero or more;
- a name from ``math`` other than ``isqrt``, ``gcd`` and ``lcm``, which are integer functions;
- an import of a module that computes in floats.

The emission is scanned too: it rounds every coordinate, once (5.4.18 (3)).
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

LAYOUT = Path(__file__).resolve().parents[1] / "src" / "eternities" / "layout"

ALLOCATOR = (
    "allocate.py",
    "capacity.py",
    "constants.py",
    "exact.py",
    "geometry.py",
    "local.py",
    "placement.py",
    "placing.py",
    "regions.py",
    "sites.py",
    "trail.py",
)
CHECKER = ("check.py",)
EMISSION = ("emit.py",)

INTEGER_MATH = {"isqrt", "gcd", "lcm"}
FLOAT_MODULES = {"cmath", "decimal", "numpy", "random", "statistics", "time"}
FLOAT_CALLS = {"float", "complex", "round"}


def float_operations(source: str) -> list[str]:
    """Every construct of ``source`` that can make a float, as ``line: what``."""
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Constant) and isinstance(node.value, float | complex):
            found.append(f"{line}: the literal {node.value!r}")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FLOAT_CALLS:
                found.append(f"{line}: a call of {node.func.id}")
        elif isinstance(node, ast.BinOp | ast.AugAssign) and isinstance(node.op, ast.Div):
            found.append(f"{line}: the operator /")
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            exponent = node.right
            whole = isinstance(exponent, ast.Constant) and type(exponent.value) is int
            if not whole:
                found.append(f"{line}: a power with an exponent that is no whole literal")
        elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id == "math" and node.attr not in INTEGER_MATH:
                found.append(f"{line}: math.{node.attr}")
        elif isinstance(node, ast.ImportFrom) and node.module == "math":
            found.extend(
                f"{line}: math.{alias.name}"
                for alias in node.names
                if alias.name not in INTEGER_MATH
            )
        elif isinstance(node, ast.Import | ast.ImportFrom):
            modules = (
                [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
            found.extend(
                f"{line}: an import of {module}"
                for module in modules
                if module.split(".")[0] in FLOAT_MODULES
            )
    return sorted(found)


@pytest.mark.parametrize("name", ALLOCATOR + CHECKER + EMISSION)
def test_no_float_reaches_the_allocator_or_the_checker(name: str):
    assert float_operations((LAYOUT / name).read_text(encoding="utf-8")) == []


def test_every_module_of_the_allocator_is_scanned():
    # A module that this test does not list computes no position: it reads inputs, calls the
    # allocator or writes a report. A new module must be listed here or there.
    others = {"__init__.py", "build.py", "cards.py", "fixtures.py", "report.py", "trig.py"}
    present = {path.name for path in LAYOUT.glob("*.py")}
    assert present == set(ALLOCATOR + CHECKER + EMISSION) | others


@pytest.mark.parametrize(
    ("planted", "what"),
    [
        ("HALF = 0.5\n", "the literal 0.5"),
        ("x = float(3)\n", "a call of float"),
        ("x = round(q)\n", "a call of round"),
        ("import math\nx = math.sqrt(2)\n", "math.sqrt"),
        ("from math import pi\n", "math.pi"),
        ("x = a / b\n", "the operator /"),
        ("x /= 2\n", "the operator /"),
        ("x = a ** -1\n", "a power with an exponent that is no whole literal"),
        ("x = 1j\n", "the literal 1j"),
        ("import random\n", "an import of random"),
    ],
)
def test_the_check_finds_a_planted_float(planted: str, what: str):
    source = (LAYOUT / "exact.py").read_text(encoding="utf-8") + "\n" + planted
    found = float_operations(source)
    assert len(found) == 1
    assert found[0].endswith(what)


def test_the_integer_forms_pass():
    source = (
        "from fractions import Fraction\n"
        "from math import isqrt, gcd\n"
        "x = Fraction(a, b)\n"
        "y = a // b\n"
        "z = isqrt(a * a + b * b) ** 2\n"
        "w = Fraction(1, 2) * x\n"
    )
    assert float_operations(source) == []
