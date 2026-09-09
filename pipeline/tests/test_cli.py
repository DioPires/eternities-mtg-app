"""Tests for :mod:`eternities.cli`, and for review finding D3 in particular.

Both ``eternities fixtures`` and ``eternities build`` delete the dataset directory they
superseded, and both take its name from ``web/datasets.json`` — a tracked file that a hand-edit,
a bad merge or a resolved conflict can put any string into. The name then reached ``rmtree``
unvalidated. These tests drive the guard with the strings that mattered rather than asserting the
regex, because the regex is not the thing that has to hold: "this call cannot delete anything but
a dataset directory inside the data root" is.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from eternities.cli import remove_stale_dataset

VALID = "0123456789abcdef"


def _dataset_dir(root: Path, name: str = VALID) -> Path:
    directory = root / name
    directory.mkdir(parents=True)
    (directory / "manifest.json").write_text("{}", encoding="utf-8")
    return directory


def test_a_real_dataset_directory_is_removed(tmp_path: Path):
    directory = _dataset_dir(tmp_path)
    assert remove_stale_dataset(tmp_path, VALID) is True
    assert not directory.exists()


@pytest.mark.parametrize(
    "name",
    [
        "",
        ".",
        "..",
        "../../etc",
        "/etc",
        "0123456789abcdef/../..",
        "0123456789ABCDEF",
        "0123456789abcde",
        "0123456789abcdefa",
        "0123456789abcdeg",
        "production",
        "web",
        "*",
    ],
)
def test_a_name_that_is_not_a_datahash_is_refused(tmp_path: Path, name: str):
    """The shapes a broken registry can hold, none of which may reach ``rmtree``.

    ``..`` and ``/etc`` are the traversal cases; the near-miss hex strings (wrong case, one
    character short, one too long, a non-hex digit) are the ones a truncated or hand-typed hash
    produces; ``production`` and ``web`` are what a reader who mistook the registry's *keys* for
    its values would write, and each names something real next to the data root.
    """
    victim = tmp_path / "keep-me"
    victim.mkdir()
    (victim / "file.txt").write_text("data", encoding="utf-8")

    assert remove_stale_dataset(tmp_path, name) is False
    assert (victim / "file.txt").exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["keep-me"]


def test_a_symlink_shaped_like_a_dataset_directory_is_refused(tmp_path: Path):
    """The one case the name check alone cannot catch.

    ``0123456789abcdef`` passes every shape test and still resolves wherever its target points, so
    a symlink planted in the data root would redirect the delete out of it. Refused on being a
    symlink, before the resolved-parent check even matters.
    """
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "precious.bin").write_text("payload", encoding="utf-8")
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / VALID).symlink_to(outside, target_is_directory=True)

    assert remove_stale_dataset(data_root, VALID) is False
    assert (outside / "precious.bin").exists()
    assert (data_root / VALID).is_symlink(), "the link itself is left for a human to look at"


def test_a_missing_directory_is_refused_rather_than_raising(tmp_path: Path):
    """Both call sites test ``.exists()`` first, so this is only reachable through a race — and a
    race that crashed the run after the artefacts were written would lose the report."""
    assert remove_stale_dataset(tmp_path, VALID) is False


def test_a_file_wearing_a_dataset_name_is_refused(tmp_path: Path):
    (tmp_path / VALID).write_text("not a directory", encoding="utf-8")
    assert remove_stale_dataset(tmp_path, VALID) is False
    assert (tmp_path / VALID).exists()


def test_a_refusal_says_so_on_stdout(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    """A silent refusal is the same defect class as an unchecked delete: the registry names a
    directory the pipeline will not touch, and nobody finds out."""
    _dataset_dir(tmp_path)
    assert remove_stale_dataset(tmp_path, "production") is False
    assert "refused to remove 'production'" in capsys.readouterr().out


def test_the_guard_accepts_exactly_what_the_encoder_produces(tmp_path: Path):
    """Data contract §1: a dataset directory is named for its 16-hex ``dataHash``.

    Pinned against a real encoder output rather than the constant, so a change to the hash length
    or alphabet fails here instead of quietly making every stale directory unremovable.
    """
    from eternities.contract import write_dataset
    from eternities.fixtures import SMALL, build

    written = write_dataset(build(SMALL), tmp_path)
    assert remove_stale_dataset(tmp_path, written.name) is True
    assert not written.exists()
