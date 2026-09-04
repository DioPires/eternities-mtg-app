"""The shared byte-level test vector.

One small, hand-checkable dataset that both sides of the contract assert against:
``pipeline/tests/test_test_vector.py`` re-encodes it and compares bytes; ``web/test/*.test.ts``
decodes the same committed files and compares values. A one-sided contract change fails CI.

Deliberately exercises the awkward cases:
  - a zero-card plane (PRD 5.3.6) whose shard file is present but empty,
  - a plane that crosses the 2000-card shard boundary is out of reach at this size, so the vector
    instead pins ``shardSize`` and the shard-index arithmetic explicitly in ``vector.json``,
  - a double-faced card (PRD 4.2.2) so ``backNames`` is non-empty,
  - a card with no colour identity, a multicolour card, and a conspiracy with an empty type mask,
  - a star at the frame radius, a negative coordinate, and an exact-zero coordinate, so float16
    rounding is pinned,
  - a card whose printings span a reprint-only set, so the set dictionary's ``planeSlug: null``
    branch is covered.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .contract.binary import decode_stars
from .contract.encode import encode_artefacts
from .contract.enums import (
    CONTRACT_VERSION,
    FRAME_RADIUS,
    PlaneKind,
    SizeClass,
    hue_class_for,
    type_mask_for,
)
from .contract.images import CARD_BACK_URI, image_uri, page_uri
from .contract.models import (
    Card,
    CardFace,
    Dataset,
    Plane,
    PlaneSetRef,
    Printing,
    SetRecord,
    StarRecord,
)

_IDENTITY_QUAT = (0.0, 0.0, 0.0, 1.0)


def _plane(
    index: int,
    slug: str,
    display_name: str,
    kind: PlaneKind,
    card_count: int,
    star_offset: int,
    home: tuple[float, float, float],
    radius: float,
    sets: list[PlaneSetRef],
) -> Plane:
    return Plane(
        index=index,
        slug=slug,
        display_name=display_name,
        notes="",
        kind=kind,
        card_count=card_count,
        star_offset=star_offset,
        star_count=card_count,
        home=home,
        radius=radius,
        tilt=_IDENTITY_QUAT if slug == "blind-eternities" else (0.25, 0.0, 0.0, 0.968246),
        spin_period_s=0.0 if slug == "blind-eternities" else 180.0,
        spin_direction=1 if index % 2 == 0 else -1,
        drift_amplitude=0.0 if slug == "blind-eternities" else 1.5,
        drift_period_s=0.0 if slug == "blind-eternities" else 90.0,
        drift_phase=0.0 if slug == "blind-eternities" else 1.25,
        shear_amplitude=0.0 if slug == "blind-eternities" else 0.1,
        shear_period_s=0.0 if slug == "blind-eternities" else 60.0,
        shear_phase=0.0 if slug == "blind-eternities" else 0.5,
        arm_pitch=0.0 if slug == "blind-eternities" else 0.6,
        disc_thickness=0.05,
        bar=slug == "ravnica",
        palette=(0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1),
        nebula_tint=(0.3, 0.4, 0.5),
        sets=sets,
    )


def build_test_vector() -> Dataset:
    sets = [
        SetRecord(0, "tv1", "Test Vector One", 1993, "dominaria", 3),
        SetRecord(1, "tv2", "Test Vector Two", 2004, "dominaria", 1),
        SetRecord(2, "tv3", "Test Vector Three", 2015, "ravnica", 2),
        SetRecord(3, "rp0", "Reprint Only Masters", 2020, None, 0),
    ]

    def printing(pid: str, set_id: int, rarity: SizeClass, ts: int, cn: str) -> Printing:
        return Printing(id=pid, set_id=set_id, rarity=rarity, image_ts=ts, collector_number=cn)

    cards: list[Card] = [
        # 0 — Blind Eternities dust, colourless, one printing, at exact-zero coordinates.
        Card(
            oracle_id="00000000-0000-4000-8000-000000000001",
            name="Dust Mote",
            mana_cost="{2}",
            type_line="Artifact",
            oracle_text="{T}: Add {C}.",
            back=None,
            colour_identity="",
            rarity=SizeClass.COMMON,
            layout="normal",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000001", 0, SizeClass.COMMON, 1700000001, "1"
                )
            ],
            set_ids=[0],
        ),
        # 1 — mono-white, three printings across two sets including a reprint-only set.
        Card(
            oracle_id="00000000-0000-4000-8000-000000000002",
            name="Serra's Test Angel",
            mana_cost="{4}{W}{W}",
            type_line="Creature — Angel",
            oracle_text="Flying, vigilance.",
            back=None,
            colour_identity="W",
            rarity=SizeClass.RARE,
            layout="normal",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000002", 0, SizeClass.RARE, 1700000002, "12"
                ),
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000003", 1, SizeClass.MYTHIC, 1700000003, "13a"
                ),
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000004", 3, SizeClass.RARE, 1700000004, "301"
                ),
            ],
            set_ids=[0, 1, 3],
        ),
        # 2 — multicolour, at the frame radius, negative coordinates.
        Card(
            oracle_id="00000000-0000-4000-8000-000000000003",
            name="Golden Confluence",
            mana_cost="{1}{U}{R}",
            type_line="Instant",
            oracle_text="Counter target spell unless its controller pays {2}.",
            back=None,
            colour_identity="UR",
            rarity=SizeClass.UNCOMMON,
            layout="normal",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000005", 0, SizeClass.UNCOMMON, 1700000005, "77"
                )
            ],
            set_ids=[0],
        ),
        # 3 — double-faced, so backNames is non-empty (PRD 4.2.2, 6.5.2).
        Card(
            oracle_id="00000000-0000-4000-8000-000000000004",
            name="Watcher of Vectors",
            mana_cost="{U}",
            type_line="Creature — Human Wizard",
            oracle_text="At the beginning of your end step, scry 2.",
            back=CardFace(
                name="Aberration of Vectors",
                mana_cost="",
                type_line="Creature — Insect Horror",
                oracle_text="Flying.",
            ),
            colour_identity="U",
            rarity=SizeClass.COMMON,
            layout="transform",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000006", 2, SizeClass.COMMON, 1700000006, "60"
                )
            ],
            set_ids=[2],
        ),
        # 4 — conspiracy: no type bit at all, so it matches only with no type facet (PRD 6.6.2).
        Card(
            oracle_id="00000000-0000-4000-8000-000000000005",
            name="Backroom Bargain",
            mana_cost="",
            type_line="Conspiracy",
            oracle_text="Hidden agenda.",
            back=None,
            colour_identity="",
            rarity=SizeClass.RARE,
            layout="normal",
            printings=[
                printing("aaaaaaaa-0000-4000-8000-000000000007", 2, SizeClass.RARE, 1700000007, "3")
            ],
            set_ids=[2],
        ),
        # 5 — every type bit set at once, maximum brightness, maximum twinkle phase.
        Card(
            oracle_id="00000000-0000-4000-8000-000000000006",
            name="Everything Everywhere",
            mana_cost="{W}{U}{B}{R}{G}",
            type_line=(
                "Legendary Artifact Creature Enchantment Land Planeswalker Battle Instant "
                "Sorcery — Omen"
            ),
            oracle_text="This is a contract fixture, not a real card.",
            back=None,
            colour_identity="WUBRG",
            rarity=SizeClass.MYTHIC,
            layout="normal",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000008", 2, SizeClass.MYTHIC, 1700000008, "★1"
                ),
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000009", 3, SizeClass.MYTHIC, 1700000009, "999"
                ),
            ],
            set_ids=[2, 3],
        ),
    ]

    positions: list[tuple[float, float, float]] = [
        (0.0, 0.0, 0.0),
        (0.5, 0.0625, -0.25),
        (-FRAME_RADIUS * 0.995, 0.0, 0.0),
        (0.125, -0.03125, 0.75),
        (0.25, 0.5, -0.125),
        (0.0009765625, 1.0, 0.0),  # a value that only survives a correct float16 round trip
    ]
    brightness = [40, 128, 200, 1, 255, 0]
    twinkle = [0, 64, 128, 200, 255, 7]

    stars = [
        StarRecord(
            x=positions[i][0],
            y=positions[i][1],
            z=positions[i][2],
            plane_index=0 if i == 0 else (1 if i < 3 else 2),
            hue=hue_class_for(card.colour_identity),
            size=card.rarity,
            brightness=brightness[i],
            twinkle_phase=twinkle[i],
            type_mask=type_mask_for(card.type_line),
        )
        for i, card in enumerate(cards)
    ]

    planes = [
        _plane(
            0,
            "blind-eternities",
            "Blind Eternities",
            PlaneKind.DUST,
            1,
            0,
            (0.0, 0.0, 0.0),
            100.0,
            [PlaneSetRef(0, "tv1", "Test Vector One", 1993, 1)],
        ),
        _plane(
            1,
            "dominaria",
            "Dominaria",
            PlaneKind.IRREGULAR,
            2,
            1,
            (10.0, 0.5, -20.0),
            8.0,
            [
                PlaneSetRef(0, "tv1", "Test Vector One", 1993, 1),
                PlaneSetRef(1, "tv2", "Test Vector Two", 2004, 1),
            ],
        ),
        _plane(
            2,
            "ravnica",
            "Ravnica",
            PlaneKind.IRREGULAR,
            3,
            3,
            (-30.0, -1.25, 15.0),
            6.5,
            [PlaneSetRef(2, "tv3", "Test Vector Three", 2015, 3)],
        ),
        _plane(3, "segovia", "Segovia", PlaneKind.EMPTY, 0, 6, (55.0, 0.0, 40.0), 3.0, []),
    ]

    return Dataset(
        dataset="test-vector",
        as_of="2026-09-04",
        generated_at="2026-09-04T00:00:00Z",
        scryfall_bulk_updated_at="2026-09-03T09:00:00Z",
        planes=planes,
        sets=sets,
        stars=stars,
        cards=cards,
        multiverse_radius=100.0,
        disc_thickness=15.0,
    )


def expected_uris() -> list[dict[str, str]]:
    """Derived Scryfall URIs, pinned so both implementations agree (contract §9)."""
    dataset = build_test_vector()
    by_id = {s.id: s for s in dataset.sets}
    out: list[dict[str, str]] = []
    for card in dataset.cards:
        for p in card.printings:
            out.append(
                {
                    "printingId": p.id,
                    "imageTs": str(p.image_ts),
                    "small": image_uri(p.id, p.image_ts, "small"),
                    "large": image_uri(p.id, p.image_ts, "large"),
                    "artCrop": image_uri(p.id, p.image_ts, "art_crop"),
                    "backLarge": image_uri(p.id, p.image_ts, "large", "back"),
                    "page": page_uri(by_id[p.set_id].code, p.collector_number),
                }
            )
    return out


def vector_summary() -> dict[str, Any]:
    """The machine-readable half of the vector: values both sides must agree on after decoding."""
    dataset = build_test_vector()
    artefacts, manifest = encode_artefacts(dataset)
    oracle_ids = [c.oracle_id for c in dataset.cards]
    # Read the positions back out of the encoded bytes, so the recorded values are what a decoder
    # actually sees after the float16 round trip rather than what the encoder was handed.
    stars_bin = next(a.data for a in artefacts if a.path == "stars.bin")
    decoded = decode_stars(stars_bin)
    return {
        "contractVersion": CONTRACT_VERSION,
        "dataHash": manifest["dataHash"],
        "starCount": len(dataset.stars),
        "stars": [
            {
                "index": i,
                "x": s.x,
                "y": s.y,
                "z": s.z,
                "planeIndex": s.plane_index,
                "hueClass": int(s.hue),
                "sizeClass": int(s.size),
                "brightness": s.brightness,
                "twinklePhase": s.twinkle_phase,
                "typeMask": s.type_mask,
            }
            for i, s in enumerate(decoded)
        ],
        "oracleIds": oracle_ids,
        "setIdsPerStar": [c.set_ids for c in dataset.cards],
        "planeShards": manifest["planeShards"],
        "files": [a.path for a in artefacts],
        "cardBackUri": CARD_BACK_URI,
        "uris": expected_uris(),
        "hueClassChecks": [
            {"colourIdentity": ci, "hueClass": int(hue_class_for(ci))}
            for ci in ["W", "U", "B", "R", "G", "WU", "WUBRG", ""]
        ],
        "typeMaskChecks": [
            {"typeLine": tl, "typeMask": type_mask_for(tl)}
            for tl in [
                "Creature — Human Wizard",
                "Basic Land — Island",
                "Artifact Creature — Golem",
                "Legendary Planeswalker — Jace",
                "Conspiracy",
                "Battle — Siege",
                "Instant",
                "Enchantment Creature — Nymph",
            ]
        ],
        "shardIndexChecks": [
            {"localIndex": 0, "shard": 0},
            {"localIndex": 1999, "shard": 0},
            {"localIndex": 2000, "shard": 1},
            {"localIndex": 4001, "shard": 2},
        ],
    }


def write_test_vector(out_dir: Path) -> None:
    dataset = build_test_vector()
    artefacts, manifest = encode_artefacts(dataset)
    if out_dir.exists():
        for existing in sorted(out_dir.rglob("*"), reverse=True):
            if existing.is_file():
                existing.unlink()
            else:
                existing.rmdir()
    out_dir.mkdir(parents=True, exist_ok=True)
    for artefact in artefacts:
        target = out_dir / artefact.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(artefact.data)
    (out_dir / "manifest.json").write_bytes(
        json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    )
    (out_dir / "vector.json").write_bytes(
        json.dumps(vector_summary(), ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    )
