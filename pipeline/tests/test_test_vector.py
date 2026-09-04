"""The committed test vector must be exactly what this encoder produces, byte for byte.

The TypeScript decoder asserts against the same files (``web/test/test-vector.test.ts``), so this
test failing means the contract moved on one side only.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from eternities.contract.encode import encode_artefacts
from eternities.testvector import build_test_vector, vector_summary

VECTOR_DIR = Path(__file__).resolve().parents[2] / "contract" / "test-vectors" / "v1"


def test_vector_directory_is_committed():
    assert VECTOR_DIR.is_dir(), (
        f"{VECTOR_DIR} is missing; regenerate it with `uv run eternities test-vector`"
    )


@pytest.mark.parametrize("relative", ["stars.bin", "sets.bin", "planes.json", "search.json"])
def test_encoded_artefact_matches_committed_bytes(relative: str):
    artefacts, _ = encode_artefacts(build_test_vector())
    encoded = next(a for a in artefacts if a.path == relative)
    committed = (VECTOR_DIR / relative).read_bytes()
    assert encoded.data == committed, (
        f"{relative} drifted from the committed vector; if the change is intended, bump "
        "contractVersion, update docs/data-contract.md, and get the contract change reviewed"
    )


def test_every_artefact_is_committed_and_nothing_extra():
    artefacts, _ = encode_artefacts(build_test_vector())
    expected = {a.path for a in artefacts} | {"manifest.json", "vector.json"}
    found = {
        str(p.relative_to(VECTOR_DIR)).replace("\\", "/")
        for p in VECTOR_DIR.rglob("*")
        if p.is_file()
    }
    assert found == expected


def test_summary_matches_committed_vector_json():
    committed = json.loads((VECTOR_DIR / "vector.json").read_text(encoding="utf-8"))
    assert vector_summary() == committed


def test_manifest_hash_matches_the_directory_contents():
    artefacts, manifest = encode_artefacts(build_test_vector())
    committed = json.loads((VECTOR_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert committed["dataHash"] == manifest["dataHash"]
    assert committed["files"] == [
        {"path": a.path, "bytes": len(a.data), "sha256": a.sha256} for a in artefacts
    ]


def test_zero_card_plane_still_gets_one_empty_shard():
    """PRD 5.3.6's empty plane must not need a special case in the loader (contract §9)."""
    _, manifest = encode_artefacts(build_test_vector())
    assert manifest["planeShards"]["segovia"] == 1
    shard = json.loads((VECTOR_DIR / "planes" / "segovia.0.json").read_text(encoding="utf-8"))
    assert shard["cards"] == []
