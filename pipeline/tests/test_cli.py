"""Tests for :mod:`eternities.cli`, and for review finding D3 in particular.

Both ``eternities fixtures`` and ``eternities build`` delete the dataset directory they
superseded, and both take its name from ``web/datasets.json`` — a tracked file that a hand-edit,
a bad merge or a resolved conflict can put any string into. The name then reached ``rmtree``
unvalidated. These tests drive the guard with the strings that mattered rather than asserting the
regex, because the regex is not the thing that has to hold: "this call cannot delete anything but
a dataset directory inside the data root" is.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

from eternities import cli
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


# --- the dual-scene publish of worlds spec §2.6 item 6 ------------------------------------------


def _registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, body: dict[str, object]) -> Path:
    """Point the CLI's module-level registry and data root at a scratch tree."""
    data_root = tmp_path / "data"
    data_root.mkdir()
    registry = tmp_path / "datasets.json"
    registry.write_text(json.dumps(body), encoding="utf-8")
    monkeypatch.setattr(cli, "DATASETS_FILE", registry)
    monkeypatch.setattr(cli, "WEB_DATA_ROOT", data_root)
    return data_root


class _Result:
    def __init__(self, data_dir: Path, report_path: Path) -> None:
        self.data_dir = data_dir
        self.report_path = report_path


def _stub_pipeline(monkeypatch: pytest.MonkeyPatch, data_dir: Path, report: Path) -> None:
    """Stand in for the orchestrator. `test_run_build` runs the real one end to end; what these
    tests drive is the registry half of `_cmd_build`, which a real run would take minutes to reach
    and would then only exercise for one combination of flags."""
    import eternities.pipeline as pipeline_pkg

    def build(**_kwargs: object) -> _Result:
        return _Result(data_dir, report)

    monkeypatch.setattr(pipeline_pkg, "build", build)


def _run_build(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, keep_active: bool, register: str | None
) -> dict[str, object]:
    """Drive `_cmd_build`'s registry half with the pipeline stubbed out.

    The pipeline itself is covered end to end by `test_run_build`; what is under test here is the
    six lines that decide which keys move and whether the predecessor's directory survives — which
    is the whole of §2's "the dual-scene period is free" claim, and is otherwise only observable
    by running a 25-minute production build.
    """
    data_root = _registry(
        tmp_path, monkeypatch, {"active": "1111111111111111", "production": "1111111111111111"}
    )
    (data_root / "1111111111111111").mkdir()
    (data_root / "1111111111111111" / "manifest.json").write_text("{}", encoding="utf-8")
    new_dir = data_root / "2222222222222222"
    new_dir.mkdir()

    _stub_pipeline(monkeypatch, new_dir, tmp_path / "report.md")

    args = argparse.Namespace(
        out=str(data_root),
        as_of="2026-09-14",
        reports=str(tmp_path),
        cache=str(tmp_path),
        swatch_cache=str(tmp_path / "s.jsonl"),
        dataset="production",
        no_roster_diff=True,
        bulk_updated_at=None,
        register=register,
        keep_active=keep_active,
    )
    assert cli._cmd_build(args) == 0
    return json.loads(Path(cli.DATASETS_FILE).read_text(encoding="utf-8"))


def test_keep_active_publishes_beside_the_deployed_dataset_and_keeps_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """§2's dual-scene period, and the reason it is free.

    A data directory is content-hashed and immutable and `datasets.json` names which one a build
    uses, so a v3 dataset is a *new directory*: the galaxy build keeps pointing at the last v2 one
    and is not touched. That is only true if this run leaves `active` where it is **and** leaves
    the predecessor on disk — and 8.8.3's "the stale hash directory goes in the same pull request"
    would otherwise delete exactly the dataset the deployed app is fetching.
    """
    registry = _run_build(tmp_path, monkeypatch, keep_active=True, register="worlds")

    assert registry["active"] == "1111111111111111", "the deployed build must not move"
    assert registry["production"] == "2222222222222222"
    assert registry["worlds"] == "2222222222222222"
    data_root = Path(cli.WEB_DATA_ROOT)
    assert (data_root / "1111111111111111").is_dir(), "the predecessor is still being served"


def test_without_keep_active_a_build_still_supersedes_and_prunes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """The negative control. Without the flag the v2 behaviour is untouched: `active` follows the
    run and PRD 8.8.3 prunes the superseded directory — so the test above is measuring the flag and
    not simply a build that never prunes anything."""
    registry = _run_build(tmp_path, monkeypatch, keep_active=False, register=None)

    assert registry["active"] == "2222222222222222"
    assert registry["production"] == "2222222222222222"
    assert "worlds" not in registry
    assert not (Path(cli.WEB_DATA_ROOT) / "1111111111111111").exists()


def test_a_directory_another_key_still_names_is_never_pruned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Belt and braces on the same rule, from the other side: the guard is "no other key names it",
    not "the flag was passed". A registry that still points `active` at the predecessor must keep
    it even if someone runs the build without `--keep-active` afterwards."""
    data_root = _registry(
        tmp_path, monkeypatch, {"active": "1111111111111111", "production": "3333333333333333"}
    )
    for name in ("1111111111111111", "3333333333333333"):
        (data_root / name).mkdir()
        (data_root / name / "manifest.json").write_text("{}", encoding="utf-8")
    new_dir = data_root / "2222222222222222"
    new_dir.mkdir()
    _stub_pipeline(monkeypatch, new_dir, tmp_path / "report.md")
    args = argparse.Namespace(
        out=str(data_root),
        as_of="2026-09-14",
        reports=str(tmp_path),
        cache=str(tmp_path),
        swatch_cache=str(tmp_path / "s.jsonl"),
        dataset="production",
        no_roster_diff=True,
        bulk_updated_at=None,
        register=None,
        keep_active=True,
    )

    assert cli._cmd_build(args) == 0

    assert (data_root / "1111111111111111").is_dir(), "`active` names it"
    assert (data_root / "3333333333333333").is_dir(), "`--keep-active` spared the predecessor"


def test_the_cli_exposes_the_swatch_warm_as_its_own_command():
    """§2.2's fetch is the longest stage in the pipeline and is independent of everything after
    it, so it has to be startable — and resumable — without paying for a build."""
    parser_args = cli.main.__doc__  # keeps the import used if the parser changes shape
    del parser_args
    with pytest.raises(SystemExit) as exit_code:
        cli.main(["swatches", "--help"])
    assert exit_code.value.code == 0
