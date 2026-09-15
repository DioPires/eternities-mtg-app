"""Writes a :class:`~eternities.contract.models.Dataset` to a content-hashed data directory.

Deterministic by construction (PRD 4.9.1): sorted keys, fixed separators, no wall-clock reads,
no iteration over unordered collections.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .binary import encode_sets, encode_stars, encode_swatches
from .enums import (
    BLIND_ETERNITIES_SLUG,
    CONTRACT_VERSION,
    PIPELINE_VERSION,
    SHARD_SIZE,
    SIZE_CLASS_TO_RARITY_CHAR,
    STAR_RECORD_BYTES,
    SWATCH_RECORD_BYTES,
)
from .models import Card, CardFace, Dataset, Plane

DATA_HASH_LENGTH = 16
"""Hex characters. 8 bytes of sha256 — collision-free for a repository's worth of runs."""


def _dumps(value: Any) -> bytes:
    """One JSON dialect for every artefact, so diffs are stable."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode(
        "utf-8"
    )


def _round(value: float, places: int = 6) -> float:
    """Keep floats short and byte-identical across platforms."""
    rounded = round(value, places)
    return 0.0 if rounded == 0 else rounded


def shard_count_for(card_count: int) -> int:
    """Amendment A1: every plane shards at ``SHARD_SIZE``; an empty plane still gets one file."""
    return max(1, math.ceil(card_count / SHARD_SIZE))


@dataclass(frozen=True, slots=True)
class EncodedArtefact:
    path: str
    data: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def _plane_json(plane: Plane) -> dict[str, Any]:
    """One plane's row of ``planes.json``.

    v3 (worlds spec §2.4): ``shearAmplitude``/``PeriodS``/``Phase``, ``armPitch``, ``bar`` and the
    per-plane ``discThickness`` are gone with the spiral disc, and ``rowCells`` arrives. Seven
    fields out, one in — and the one that arrives is an array, so ``planes.json`` grows rather than
    shrinks. It is noise in the budget either way and is listed for completeness, not for savings.

    ``rowCells`` is omitted rather than written empty for the belt and the empty planes: neither has
    a surface grid, and a key present-but-empty invites a client to read ``length`` as a row count.
    """
    row: dict[str, Any] = {
        "index": plane.index,
        "slug": plane.slug,
        "displayName": plane.display_name,
        "notes": plane.notes,
        "kind": str(plane.kind),
        "cardCount": plane.card_count,
        "starOffset": plane.star_offset,
        "starCount": plane.star_count,
        "shardCount": shard_count_for(plane.card_count),
        "home": [_round(v) for v in plane.home],
        "radius": _round(plane.radius),
        "tilt": [_round(v) for v in plane.tilt],
        "spinPeriodS": _round(plane.spin_period_s, 3),
        "spinDirection": plane.spin_direction,
        "driftAmplitude": _round(plane.drift_amplitude),
        "driftPeriodS": _round(plane.drift_period_s, 3),
        "driftPhase": _round(plane.drift_phase),
        "palette": [_round(v, 4) for v in plane.palette],
        "nebulaTint": [_round(v, 4) for v in plane.nebula_tint],
        "firstYear": plane.first_year,
        "lastYear": plane.last_year,
        "sets": [
            {"id": s.id, "code": s.code, "name": s.name, "year": s.year, "cardCount": s.card_count}
            for s in plane.sets
        ],
    }
    if plane.row_cells:
        row["rowCells"] = plane.row_cells
    return row


def _face_json(face: CardFace) -> dict[str, Any]:
    row: dict[str, Any] = {
        "n": face.name,
        "m": face.mana_cost,
        "t": face.type_line,
        "o": face.oracle_text,
    }
    if face.printing_id is not None and face.image_ts is not None:
        row["id"] = face.printing_id
        row["ts"] = face.image_ts
    return row


def _card_json(card: Card) -> dict[str, Any]:
    row: dict[str, Any] = {
        "u": card.oracle_id,
        "n": card.name,
        "m": card.mana_cost,
        "t": card.type_line,
        "o": card.oracle_text,
        # `b` is "there is a second face", not "there is a back image": split, adventure and flip
        # cards have one and not the other (contract §9). `id`/`ts` appear only on a meld back,
        # whose image is a separate Scryfall object and cannot be derived from the printing.
        "b": None if card.back is None else _face_json(card.back),
        "ci": card.colour_identity,
        "r": int(card.rarity),
        "l": card.layout,
        # v3 (§2.3): the printing tuple gains a sixth element, the artist, inline rather than as an
        # id into a dictionary. A dictionary is the smaller encoding, but its only sensible home is
        # `search.json`, which is half of the 95%-full pair; the shards have 4.4x headroom. The
        # cost goes where the headroom is.
        "p": [
            [
                p.id,
                p.set_id,
                SIZE_CLASS_TO_RARITY_CHAR[p.rarity],
                p.image_ts,
                p.collector_number,
                p.artist,
            ]
            for p in card.printings
        ],
    }
    return row


def encode_artefacts(
    dataset: Dataset, *, previous_runs: Sequence[str | None] = ()
) -> tuple[list[EncodedArtefact], dict[str, Any]]:
    """Encode everything but ``manifest.json``, and return it alongside the manifest body.

    The manifest is produced last because it carries the hash over the others.

    ``previous_runs`` are candidate predecessors in priority order, and the manifest records the
    first that is not this run's own ``dataHash``. That is what makes the field survive a re-run:
    8.8.3 deletes the superseded directory in the same commit, so a second build in the same tree
    finds only *itself* on disk, and a manifest naming itself would both be wrong and break 4.9.1's
    byte-identical guarantee. The caller's second candidate is the predecessor the first build
    already recorded, which is exactly the answer that keeps the two runs identical.

    The key is omitted rather than written as ``null`` when no candidate survives — every fixture,
    and a first production run — so every already-committed manifest is unchanged.
    """
    artefacts: list[EncodedArtefact] = []

    artefacts.append(
        EncodedArtefact(
            "planes.json",
            _dumps(
                {
                    "contractVersion": CONTRACT_VERSION,
                    "shardSize": SHARD_SIZE,
                    "multiverseRadius": _round(dataset.multiverse_radius),
                    # The top-level `discThickness` retires with the per-plane one (§2.4): it is a
                    # property of a spiral disc, and a world is a sphere.
                    "planes": [_plane_json(p) for p in dataset.planes],
                }
            ),
        )
    )

    artefacts.append(EncodedArtefact("stars.bin", encode_stars(dataset.stars)))

    # §2.2: its own file, fetched with `stars.bin`, and only when there is one. A dataset with no
    # swatch column simply has no `swatches.bin`, which is a missing file the loader can see rather
    # than a file of zeroes it cannot.
    #
    # That case is now a v2 dataset rather than a fixture: since DEC-796 both fixtures invent a
    # swatch per card from its own id, because a dataset without the file can never compose a
    # worlds roster and so silently drops every worlds surface out of CI (DEC-793). The branch
    # stays because the column is still what decides, and the committed v2 dataset has none.
    if dataset.swatches:
        artefacts.append(EncodedArtefact("swatches.bin", encode_swatches(dataset.swatches)))

    artefacts.append(
        EncodedArtefact(
            "sets.bin",
            encode_sets(
                [c.oracle_id for c in dataset.cards],
                [c.set_ids for c in dataset.cards],
            ),
        )
    )

    # Every non-null back face, not only the double-faced ones: PRD 6.5.2 wants "Stomp" to find
    # Bonecrusher Giant and "Ice" to find Fire // Ice, and those are adventure and split cards.
    back_names = [[i, c.back.name] for i, c in enumerate(dataset.cards) if c.back is not None]
    artefacts.append(
        EncodedArtefact(
            "search.json",
            _dumps(
                {
                    "contractVersion": CONTRACT_VERSION,
                    "starCount": len(dataset.stars),
                    "planes": [
                        {
                            "index": p.index,
                            "slug": p.slug,
                            "name": p.display_name,
                            "cardCount": p.card_count,
                        }
                        for p in dataset.planes
                    ],
                    "sets": [
                        {
                            "id": s.id,
                            "code": s.code,
                            "name": s.name,
                            "year": s.year,
                            "planeSlug": s.plane_slug,
                            "cardCount": s.card_count,
                        }
                        for s in dataset.sets
                    ],
                    "cardNames": [c.name for c in dataset.cards],
                    "backNames": back_names,
                }
            ),
        )
    )

    for plane in dataset.planes:
        # The shard *count* comes from card_count and the shard *slices* from star_count. They are
        # the same number by construction — one star per card — but nothing else enforces it, and a
        # divergence would silently drop cards off the end or emit empty trailing shards.
        if plane.card_count != plane.star_count:
            raise ValueError(
                f"plane {plane.slug} has {plane.card_count} cards but {plane.star_count} stars; "
                "shard arithmetic needs them equal"
            )
        shards = shard_count_for(plane.card_count)
        for shard in range(shards):
            start = plane.star_offset + shard * SHARD_SIZE
            end = min(start + SHARD_SIZE, plane.star_offset + plane.star_count)
            artefacts.append(
                EncodedArtefact(
                    f"planes/{plane.slug}.{shard}.json",
                    _dumps(
                        {
                            "contractVersion": CONTRACT_VERSION,
                            "slug": plane.slug,
                            "shard": shard,
                            "shardSize": SHARD_SIZE,
                            "starOffset": start,
                            "cards": [_card_json(c) for c in dataset.cards[start:end]],
                        }
                    ),
                )
            )

    artefacts.sort(key=lambda a: a.path)

    blind = next((p for p in dataset.planes if p.slug == BLIND_ETERNITIES_SLUG), None)
    blind_stars = blind.star_count if blind else 0
    star_count = len(dataset.stars)

    manifest: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "dataset": dataset.dataset,
        "dataHash": compute_data_hash(artefacts),
        "asOf": dataset.as_of,
        "generatedAt": dataset.generated_at,
        "scryfallBulkUpdatedAt": dataset.scryfall_bulk_updated_at,
        "previousRun": None,
        "starRecordBytes": STAR_RECORD_BYTES,
        "swatchRecordBytes": SWATCH_RECORD_BYTES,
        "shardSize": SHARD_SIZE,
        "counts": {
            "planes": len(dataset.planes),
            "stars": star_count,
            "sets": len(dataset.sets),
            "printings": sum(len(c.printings) for c in dataset.cards),
            "blindEternitiesStars": blind_stars,
            "blindEternitiesShare": _round(blind_stars / star_count, 6) if star_count else 0.0,
        },
        "planeShards": {p.slug: shard_count_for(p.card_count) for p in dataset.planes},
        "files": [{"path": a.path, "bytes": len(a.data), "sha256": a.sha256} for a in artefacts],
    }
    # Declared in place above so the key sits beside the other provenance fields rather than after
    # the `files` array, then resolved here, where the hash it must not equal is finally known.
    resolved = next(
        (run for run in previous_runs if run is not None and run != manifest["dataHash"]), None
    )
    if resolved is None:
        del manifest["previousRun"]
    else:
        manifest["previousRun"] = resolved
    return artefacts, manifest


def compute_data_hash(artefacts: list[EncodedArtefact]) -> str:
    """sha256 over the path-sorted ``"<path> <sha256>"`` lines, manifest excluded."""
    lines = sorted(f"{a.path} {a.sha256}" for a in artefacts)
    digest = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
    return digest[:DATA_HASH_LENGTH]


def write_dataset(
    dataset: Dataset, data_root: Path, *, previous_runs: Sequence[str | None] = ()
) -> Path:
    """Write one run into ``<data_root>/<dataHash>/`` and return that directory."""
    artefacts, manifest = encode_artefacts(dataset, previous_runs=previous_runs)
    out_dir = data_root / str(manifest["dataHash"])
    out_dir.mkdir(parents=True, exist_ok=True)
    for artefact in artefacts:
        target = out_dir / artefact.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(artefact.data)
    (out_dir / "manifest.json").write_bytes(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=False).encode("utf-8") + b"\n"
    )
    return out_dir
