"""The trig table of PRD v4 5.4.18 (6): ``contract/test-vectors/v4/layout/trig.bin``.

The table's bytes are the contract: the allocator reads sin and cos from it and from nowhere else,
so its fixtures are bytes to compare on every machine. Three things are pinned here. The file is
the committed one (its SHA-256). Its entries are right: the five exact ones PRD 8.8.1 names, by
integer arithmetic only, and every entry against the generator. And the pipeline refuses any other
file before it uses a value.
"""

from __future__ import annotations

import hashlib
import importlib.util
import math
import shutil
from pathlib import Path
from typing import Any

import pytest

from eternities import cli
from eternities.layout import trig

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "pipeline" / "scripts" / "trig_table.py"

SHA256 = "fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777"
"""Spelled out, not imported: a change to the table has to be made here as well."""

ONE = 1 << 30
HALF = 1 << 29


def _script() -> Any:
    spec = importlib.util.spec_from_file_location("trig_table", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def table() -> trig.TrigTable:
    return trig.load()


def degrees(value: int) -> int:
    """A whole number of degrees as a count of thousandths."""
    return value * 1000


def test_the_committed_file_has_the_pinned_hash_and_size():
    data = trig.TRIG_TABLE.read_bytes()

    assert trig.TRIG_TABLE == REPO_ROOT / "contract/test-vectors/v4/layout/trig.bin"
    assert len(data) == 2_880_000 == trig.TABLE_BYTES
    assert hashlib.sha256(data).hexdigest() == SHA256 == trig.TRIG_SHA256


def test_the_five_exact_entries(table: trig.TrigTable):
    """PRD 8.8.1: 0, 30, 45, 60 and 90 degrees. "sin 30 is exactly 2^29; sin 90 is 2^30"."""
    assert (table.sin(degrees(0)), table.cos(degrees(0))) == (0, ONE)
    assert table.sin(degrees(30)) == HALF == 536_870_912
    assert table.cos(degrees(60)) == HALF
    assert (table.sin(degrees(90)), table.cos(degrees(90))) == (ONE, 0)
    assert ONE == 1_073_741_824

    # sin 45 = cos 45 = 2^30 / sqrt(2) = sqrt(2^59), which is irrational. `n` is its correct
    # rounding exactly when (n - 1/2)^2 < 2^59 < (n + 1/2)^2, that is (2n - 1)^2 < 2^61 <
    # (2n + 1)^2: integers only, so the test does not lean on a float to judge the table.
    diagonal = table.sin(degrees(45))
    assert diagonal == table.cos(degrees(45)) == 759_250_125
    assert (2 * diagonal - 1) ** 2 < 1 << 61 < (2 * diagonal + 1) ** 2

    # cos 30 = sin 60 = 2^30 * sqrt(3) / 2 = sqrt(3 * 2^58): (2n - 1)^2 < 3 * 2^60 < (2n + 1)^2.
    long_side = table.sin(degrees(60))
    assert long_side == table.cos(degrees(30)) == 929_887_697
    assert (2 * long_side - 1) ** 2 < 3 << 60 < (2 * long_side + 1) ** 2


def test_the_quadrants_carry_the_right_signs(table: trig.TrigTable):
    assert (table.sin(degrees(180)), table.cos(degrees(180))) == (0, -ONE)
    assert (table.sin(degrees(270)), table.cos(degrees(270))) == (-ONE, 0)
    assert (table.sin(degrees(210)), table.cos(degrees(120))) == (-HALF, -HALF)
    assert (table.sin(degrees(330)), table.cos(degrees(300))) == (-HALF, HALF)
    # One count is a thousandth of a degree: the first and the last entries of the turn.
    assert table.sin(1) == 18_740 == -table.sin(359_999)
    assert table.cos(1) == table.cos(359_999) == ONE


def test_every_entry_is_the_correct_rounding(table: trig.TrigTable):
    """All 360,000 records, two ways that do not share an error.

    Against the float library: `math.sin` is good to about 2^-22 at this scale, so it agrees with
    a correct table to within one unit everywhere, and a wrong record order, sign, byte order or
    angle unit would be off by millions. And as integers: sin^2 + cos^2 of the rounded pair is
    within (|sin| + |cos|) + 1/2 of 2^60, a bound no float is involved in.
    """
    for count in range(trig.COUNTS):
        sin_value, cos_value = table.sin(count), table.cos(count)
        angle = math.radians(count / 1000)
        assert abs(sin_value - round(math.sin(angle) * ONE)) <= 1, count
        assert abs(cos_value - round(math.cos(angle) * ONE)) <= 1, count
        assert abs(sin_value**2 + cos_value**2 - (1 << 60)) <= abs(sin_value) + abs(cos_value) + 1


def test_the_committed_script_generates_the_committed_bytes():
    """`pipeline/scripts/trig_table.py`, run in full. It is never run at build."""
    script = _script()

    generated = script.build_table()

    assert hashlib.sha256(generated).hexdigest() == SHA256
    assert generated == trig.TRIG_TABLE.read_bytes()
    assert script.PRECISION >= 50, "PRD 5.4.18 (6) asks for 50 digits or better"


def test_the_generator_does_not_call_the_float_library():
    """PRD 5.4.18 (6): "no ``math.sin``". The generator is `decimal` and integers."""
    source = SCRIPT.read_text(encoding="utf-8")

    assert "import math" not in source
    assert "from math" not in source
    assert "float(" not in source
    assert "from decimal import" in source


def test_the_script_checks_a_file_and_refuses_another(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    script = _script()

    assert script.main(["--check"]) == 0
    assert SHA256 in capsys.readouterr().out

    copy = tmp_path / "trig.bin"
    assert script.main(["--out", str(copy)]) == 0
    assert copy.read_bytes() == trig.TRIG_TABLE.read_bytes()

    data = bytearray(copy.read_bytes())
    data[8 * degrees(30)] ^= 1  # the low byte of sin 30
    copy.write_bytes(bytes(data))
    assert script.main(["--check", "--out", str(copy)]) == 1
    assert "differs from the generated table" in capsys.readouterr().err
    assert script.main(["--check", "--out", str(tmp_path / "absent.bin")]) == 1


def test_the_generator_refuses_an_entry_it_cannot_round():
    """The guard that makes "correctly rounded" a checked property: a value too close to a
    half-integer for the working precision is an error, not a guess."""
    script = _script()
    from decimal import Decimal

    with pytest.raises(ArithmeticError, match="half-integer"):
        script._scaled((Decimal(5) + Decimal("0.5")) / script.SCALE, 7)
    with pytest.raises(ValueError, match="outside"):
        script.entry(360_000, [])


# --- the pipeline asserts the hash before use -----------------------------------------------


def _corrupted(tmp_path: Path) -> Path:
    copy = tmp_path / "trig.bin"
    shutil.copyfile(trig.TRIG_TABLE, copy)
    data = bytearray(copy.read_bytes())
    data[-1] ^= 0x01  # one bit, in the last record
    copy.write_bytes(bytes(data))
    return copy


def test_a_table_with_one_bit_changed_is_refused(tmp_path: Path):
    with pytest.raises(trig.TrigTableError) as raised:
        trig.load(_corrupted(tmp_path))

    assert SHA256 in str(raised.value)
    assert "is not the committed table" in str(raised.value)


def test_a_truncated_or_missing_table_is_refused(tmp_path: Path):
    short = tmp_path / "trig.bin"
    short.write_bytes(trig.TRIG_TABLE.read_bytes()[:-8])

    with pytest.raises(trig.TrigTableError, match="2,879,992 bytes"):
        trig.load(short)
    with pytest.raises(trig.TrigTableError, match="does not exist"):
        trig.load(tmp_path / "absent.bin")


def test_a_count_outside_the_table_is_an_error_not_a_wrap(table: trig.TrigTable):
    """Reducing an angle is the caller's rule (5.4.18 (6)); the table does not guess one."""
    for count in (-1, 360_000):
        with pytest.raises(IndexError):
            table.sin(count)
        with pytest.raises(IndexError):
            table.cos(count)


def test_the_build_fails_on_a_table_that_is_not_the_committed_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    """PRD 5.4.18 (6): "the pipeline asserts the file's SHA-256 before use". `eternities build`
    checks the table first, so the failure comes before any download and writes nothing.

    The bulk file is pinned to a key the empty cache does not hold, and the swatch cache is a path
    of the test's own. A build that got past the table stops at the pinned file with another
    message: it can neither reach Scryfall nor write under `pipeline/.cache/`
    (`docs/scryfall-policy.md` section 4).
    """
    monkeypatch.setattr(trig, "TRIG_TABLE", _corrupted(tmp_path))

    code = cli.main(
        [
            "build",
            "--out",
            str(tmp_path / "data"),
            "--reports",
            str(tmp_path / "reports"),
            "--cache",
            str(tmp_path / "cache"),
            "--bulk-updated-at",
            "2026-10-12T09:05:45.962+00:00",
            "--swatch-cache",
            str(tmp_path / "swatches.jsonl"),
            "--no-roster-diff",
        ]
    )

    assert code == 1
    # The message is what shows the order: past the table, the build fails on the pinned file.
    assert "build failed — the trig table" in capsys.readouterr().err
    assert not (tmp_path / "data").exists()
    assert not (tmp_path / "cache").exists()
    assert not (tmp_path / "swatches.jsonl").exists()
