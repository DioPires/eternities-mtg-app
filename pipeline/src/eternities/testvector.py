"""The shared byte-level test vector.

One small, hand-checkable dataset that both sides of the contract assert against:
``pipeline/tests/test_test_vector.py`` re-encodes it and compares bytes; ``web/test/*.test.ts``
decodes the same committed files and compares values. A one-sided contract change fails CI.

Deliberately exercises the awkward cases:
  - a zero-card plane (PRD 5.3.6) whose shard file is present but empty,
  - a plane that crosses the 2000-card shard boundary is out of reach at this size, so the vector
    instead pins ``shardSize`` and the shard-index arithmetic explicitly in ``vector.json``,
  - one card of every *back* shape the contract distinguishes (contract §9): a ``transform`` card
    (two faces **and** a back image), a ``split``, an ``adventure`` and a ``flip`` card (two faces,
    **no** back image — their derived back URI 404s on live Scryfall), a ``meld`` card (a back face
    whose image is a separate Scryfall object, reached through ``b.id``/``b.ts``), and plain
    single-faced cards. ``backNames`` is non-empty and covers every non-null ``b``, not only the
    double-faced ones — PRD 6.5.2 wants "Stomp" to find Bonecrusher Giant,
  - a card with no colour identity, a multicolour card, and a conspiracy with an empty type mask,
  - a star at the frame radius, a negative coordinate, and an exact-zero coordinate, so float16
    rounding is pinned,
  - a card whose printings span a reprint-only set, so the set dictionary's ``planeSlug: null``
    branch is covered.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any, cast

from .contract.binary import decode_stars, decode_swatches
from .contract.encode import encode_artefacts
from .contract.enums import (
    BLIND_ETERNITIES_SLUG,
    CONTRACT_VERSION,
    LAYOUTS,
    HueClass,
    PlaneKind,
    SizeClass,
    colour_identity_mask,
    hue_class_for,
    pack_colour_byte,
    type_mask_for,
)
from .contract.images import CARD_BACK_URI, back_image_uri, has_back_image, image_uri, page_uri
from .contract.models import (
    Card,
    CardFace,
    Dataset,
    Plane,
    PlaneSetRef,
    Printing,
    SetRecord,
    StarRecord,
    Swatch,
)
from .fixtures import layout, surface

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
    row_cells: list[int] | None = None,
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
        tilt=_IDENTITY_QUAT if slug == BLIND_ETERNITIES_SLUG else (0.25, 0.0, 0.0, 0.968246),
        spin_period_s=0.0 if slug == BLIND_ETERNITIES_SLUG else 180.0,
        spin_direction=1 if index % 2 == 0 else -1,
        drift_amplitude=0.0 if slug == BLIND_ETERNITIES_SLUG else 1.5,
        drift_period_s=0.0 if slug == BLIND_ETERNITIES_SLUG else 90.0,
        drift_phase=0.0 if slug == BLIND_ETERNITIES_SLUG else 1.25,
        palette=(0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1),
        nebula_tint=(0.3, 0.4, 0.5),
        sets=sets,
        row_cells=row_cells or [],
    )


def build_test_vector() -> Dataset:
    sets = [
        SetRecord(0, "tv1", "Test Vector One", 1993, "dominaria", 3),
        SetRecord(1, "tv2", "Test Vector Two", 2004, "dominaria", 1),
        SetRecord(2, "tv3", "Test Vector Three", 2015, "ravnica", 7),
        SetRecord(3, "rp0", "Reprint Only Masters", 2020, None, 0),
    ]

    def printing(
        pid: str, set_id: int, rarity: SizeClass, ts: int, cn: str, artist: str = "Ava Ohm"
    ) -> Printing:
        # v3 §2.3: the sixth tuple element. One printing carries `""` on purpose — Scryfall has no
        # artist for some objects, and an encoder that dropped the element instead of writing an
        # empty string would shorten exactly one tuple and nothing else would notice.
        return Printing(
            id=pid,
            set_id=set_id,
            rarity=rarity,
            image_ts=ts,
            collector_number=cn,
            artist=artist,
        )

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
        # 3 — transform: two faces AND a back image, derived from the same printing id.
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
        # 6 — split. Two faces, one physical side: `b` is non-null and there is NO back image.
        # Checked live in Phase 0 — Fire // Ice's derived back URI 404s. `b` is also the only place
        # the second half's oracle text can live: Scryfall gives a split card no top-level
        # `oracle_text` at all, only `card_faces` (PRD line 156).
        Card(
            oracle_id="00000000-0000-4000-8000-000000000007",
            name="Flame // Frost",
            mana_cost="{1}{R} // {1}{U}",
            type_line="Instant // Instant",
            oracle_text="Flame deals 2 damage to any target.",
            back=CardFace(
                name="Frost",
                mana_cost="{1}{U}",
                type_line="Instant",
                oracle_text="Tap target creature.",
            ),
            colour_identity="UR",
            rarity=SizeClass.UNCOMMON,
            layout="split",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000010", 2, SizeClass.UNCOMMON, 1700000010, "215"
                )
            ],
            set_ids=[2],
        ),
        # 7 — adventure. Same shape as split: a second face, no second image.
        Card(
            oracle_id="00000000-0000-4000-8000-000000000008",
            name="Bonecrusher Fixture",
            mana_cost="{2}{R}",
            type_line="Creature — Giant",
            oracle_text="Whenever this creature becomes the target of a spell, it deals 2 damage.",
            back=CardFace(
                name="Stomp",
                mana_cost="{1}{R}",
                type_line="Instant — Adventure",
                oracle_text="Damage can't be prevented this turn.",
            ),
            colour_identity="R",
            rarity=SizeClass.RARE,
            layout="adventure",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000011", 2, SizeClass.RARE, 1700000011, "781"
                )
            ],
            set_ids=[2],
        ),
        # 8 — flip. Two faces printed upside down on one side: still no back image.
        Card(
            oracle_id="00000000-0000-4000-8000-000000000009",
            name="Erayo Fixture",
            mana_cost="{1}{U}",
            type_line="Legendary Creature — Moonfolk Monk",
            oracle_text="Flying.",
            back=CardFace(
                name="Erayo's Essence",
                mana_cost="",
                type_line="Legendary Enchantment",
                oracle_text="Counter the first spell each opponent casts each turn.",
            ),
            colour_identity="U",
            rarity=SizeClass.RARE,
            layout="flip",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000012", 2, SizeClass.RARE, 1700000012, "35"
                )
            ],
            set_ids=[2],
        ),
        # 9 — meld. PRD line 125: the meld result is not a card of its own but stays reachable as
        # the back face of its components. It is a separate Scryfall object with its own id and its
        # own *front* image and no `card_faces`, so `b` carries that id and timestamp — the only
        # shape in the contract where the back image is not derived from the component's printing.
        Card(
            oracle_id="00000000-0000-4000-8000-00000000000a",
            name="Bruna Fixture",
            mana_cost="{5}{W}{W}",
            type_line="Legendary Creature — Angel Horror",
            oracle_text="Flying. (Melds with Gisela Fixture.)",
            back=CardFace(
                name="Brisela Fixture",
                mana_cost="",
                type_line="Legendary Creature — Eldrazi Angel",
                oracle_text="Flying, first strike, vigilance, lifelink.",
                printing_id="bbbbbbbb-0000-4000-8000-000000000001",
                image_ts=1700000013,
            ),
            colour_identity="W",
            rarity=SizeClass.RARE,
            layout="meld",
            printings=[
                printing(
                    "aaaaaaaa-0000-4000-8000-000000000013",
                    2,
                    SizeClass.RARE,
                    1700000014,
                    "15a",
                    # §2.3: `""` where Scryfall has no artist. Pinned in the vector because an
                    # encoder that omitted the element instead of writing an empty string would
                    # shorten exactly one tuple, and nothing else in the artefacts would notice.
                    "",
                )
            ],
            set_ids=[2],
        ),
    ]

    # v3 §2.1: bytes 0-5 are unit-sphere cell centres, so the positions are no longer free. The two
    # card-bearing planes are laid out by the shipped surface law and their `rowCells` are pinned
    # below — §2.1 asks the vector to pin "one complete small world — every slot, every band, every
    # set slice, and its `rowCells`", and `ravnica`'s seven cards over one set is that world.
    #
    # The float16 edge cases the v2 vector carried as positions did not survive the change (a cell
    # centre is not a free value), so they move to `float16Checks` in `vector_summary`, where both
    # sides still assert the round trip that made them worth pinning.
    dominaria_grid = _surface_grid(cards[1:3])
    ravnica_grid = _surface_grid(cards[3:10])
    positions: list[tuple[float, float, float]] = [
        # The belt (§1.8): 1.12 R with jitter, in the dust plane's own local frame.
        layout.belt_position("tv-dust-0", 0, 1, 0, 1),
        *_cell_directions(dominaria_grid),
        *_cell_directions(ravnica_grid),
    ]
    brightness = [40, 128, 200, 1, 255, 0, 17, 96, 160, 224]
    # v3 §2.1: byte 10 is reserved, written 0.
    twinkle = [0] * 10
    # §2.2: four uint16 RGB565 samples per card, in star order. Hand-picked rather than fetched, and
    # they cover the ends of every field: pure red is the top five bits, pure green the middle six
    # (which is the one field an RGB555 packing would get wrong), pure blue the bottom five.
    swatches: list[Swatch] = [
        (0x0000, 0xFFFF, 0xF800, 0x001F),
        (0x07E0, 0x0000, 0xFFFF, 0xF800),
        (0x001F, 0x07E0, 0x0000, 0xFFFF),
        (0xFFFF, 0x001F, 0x07E0, 0x0000),
        (0x8410, 0x4208, 0xC618, 0x2104),
        (0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF),
        (0x0000, 0x0000, 0x0000, 0x0000),
        (0xF81F, 0x07FF, 0xFFE0, 0x8000),
        (0x0020, 0x0800, 0x0001, 0x1082),
        (0x39E7, 0x7BEF, 0xAD75, 0xDEFB),
    ]

    stars = [
        StarRecord(
            x=positions[i][0],
            y=positions[i][1],
            z=positions[i][2],
            plane_index=0 if i == 0 else (1 if i < 3 else 2),
            hue=hue_class_for(card.colour_identity),
            colour_identity=colour_identity_mask(card.colour_identity),
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
            dominaria_grid.row_cells,
        ),
        _plane(
            2,
            "ravnica",
            "Ravnica",
            PlaneKind.IRREGULAR,
            7,
            3,
            (-30.0, -1.25, 15.0),
            6.5,
            [PlaneSetRef(2, "tv3", "Test Vector Three", 2015, 7)],
            ravnica_grid.row_cells,
        ),
        _plane(3, "segovia", "Segovia", PlaneKind.EMPTY, 0, 10, (55.0, 0.0, 40.0), 3.0, []),
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
        swatches=swatches,
        multiverse_radius=100.0,
    )


def _surface_grid(cards: list[Card]) -> surface.Grid:
    """One vector plane through the shipped surface law, from its own cards' colours and sets."""
    sequence: dict[tuple[int, int], int] = {}
    groups: list[tuple[HueClass, int, int]] = []
    for card in cards:
        hue = hue_class_for(card.colour_identity)
        set_band = card.set_ids[0]
        key = (int(hue), set_band)
        sequence[key] = sequence.get(key, -1) + 1
        groups.append((hue, set_band, sequence[key]))
    return surface.build_grid(groups)


def _cell_directions(grid: surface.Grid) -> list[tuple[float, float, float]]:
    return [
        surface.cell_direction(p.row, p.column, grid.row_cells[p.row], grid.d_phi)
        for p in grid.placements
    ]


def expected_uris() -> list[dict[str, Any]]:
    """Derived Scryfall URIs, pinned so both implementations agree (contract §9).

    ``backLarge`` is ``None`` wherever the card has no back image. That is the case the vector
    exists to pin: a split, adventure or flip card has a second *face* and no second *image*, and
    the URI a naive ``face='back'`` derivation produces 404s on live Scryfall.
    """
    dataset = build_test_vector()
    by_id = {s.id: s for s in dataset.sets}
    out: list[dict[str, Any]] = []
    for card in dataset.cards:
        for p in card.printings:
            back_large = back_image_uri(card.layout, card.back, p.id, p.image_ts, "large")
            out.append(
                {
                    "printingId": p.id,
                    "imageTs": str(p.image_ts),
                    "layout": card.layout,
                    "hasSecondFace": card.back is not None,
                    "hasBackImage": back_large is not None,
                    "small": image_uri(p.id, p.image_ts, "small"),
                    "large": image_uri(p.id, p.image_ts, "large"),
                    "artCrop": image_uri(p.id, p.image_ts, "art_crop"),
                    "backLarge": back_large,
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
    swatches_bin = next((a.data for a in artefacts if a.path == "swatches.bin"), b"")
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
                "colourIdentity": s.colour_identity,
                "sizeClass": int(s.size),
                "brightness": s.brightness,
                "twinklePhase": s.twinkle_phase,
                "typeMask": s.type_mask,
            }
            for i, s in enumerate(decoded)
        ],
        "swatches": [list(s) for s in decode_swatches(swatches_bin)] if swatches_bin else [],
        "rowCells": {p.slug: p.row_cells for p in dataset.planes if p.row_cells},
        "artists": [[pr.artist for pr in c.printings] for c in dataset.cards],
        # The float16 round trip these used to be asserted through the star positions. v3 makes a
        # position a unit-sphere cell centre, so it is no longer a free value and the edge cases
        # need a home of their own: a denormal, an exact power of two, the smallest normal, and a
        # value that only survives a correct decode. Both sides run them through `float16ToNumber`.
        "float16Checks": [
            {"bits": bits, "value": _float16(bits)}
            for bits in [0x0000, 0x0001, 0x0400, 0x3C00, 0x3555, 0xBC00, 0x7BFF, 0x1800, 0x9800]
        ],
        "oracleIds": oracle_ids,
        "setIdsPerStar": [c.set_ids for c in dataset.cards],
        "planeShards": manifest["planeShards"],
        "files": [a.path for a in artefacts],
        "cardBackUri": CARD_BACK_URI,
        "uris": expected_uris(),
        # Byte 7 in full: the hue class, the five-bit identity, and the packed byte both sides
        # must agree on. Every arity is covered, because the packing is only observable at the
        # byte and a mono-green card (byte 132) is what an unmasked v1 reader gets wrong first.
        "colourChecks": [
            {
                "colourIdentity": ci,
                "hueClass": int(hue_class_for(ci)),
                "identityMask": colour_identity_mask(ci),
                "colourByte": pack_colour_byte(hue_class_for(ci), colour_identity_mask(ci)),
            }
            for ci in ["W", "U", "B", "R", "G", "WU", "UR", "BRG", "RGWU", "WUBRG", ""]
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
        # Every Scryfall layout and whether it has a back *image*. This is the cross-language
        # enforcement of contract §9's split between "second face" and "back image": both sides
        # answer for all of them, so neither can quietly disagree about, say, `adventure`.
        "backImageChecks": [
            {"layout": layout, "hasBackImage": has_back_image(layout)} for layout in sorted(LAYOUTS)
        ],
        "shardIndexChecks": [
            {"localIndex": 0, "shard": 0},
            {"localIndex": 1999, "shard": 0},
            {"localIndex": 2000, "shard": 1},
            {"localIndex": 4001, "shard": 2},
        ],
        # The `home`-law camera constants, so the hand mirror in `fixtures/layout.py` has a
        # two-sided guard (DEC-884). Every value is *read from* `layout`, never restated here: a
        # summary that transcribed them would pin its own transcription and let the law drift.
        #
        # This is the same freeze point as everything above it. Move a constant on the Python side
        # and `test_summary_matches_committed_vector_json` reds against the committed file; move it
        # on the TypeScript side and `web/test/test-vector.test.ts` reds against the same file;
        # regenerate the vector after a Python-side move and the TypeScript half reds, which is the
        # case the old one-way mirror could not see at all.
        #
        # Spelled in the units each side *owns*, not in a compromise: the pick floor is published
        # as a **diameter** because that is what `scenePicker.ts` declares, while `layout` keeps it
        # as a radius; the fov and the reference viewport height are published separately rather
        # than pre-multiplied into a focal length, because a focal length cannot say which of the
        # two moved and the renderer has no focal-length constant to compare against. The polar
        # angle is not published either — `framing.ts` stores `pi/2 - elevation` and the web test
        # does that subtraction itself, so the conversion is visible in the assertion.
        "cameraLaw": {
            "homeElevationRad": layout.HOME_ELEVATION_RAD,
            "homeDistanceFactor": layout.HOME_DISTANCE_FACTOR,
            "fovDegrees": layout.REFERENCE_FOV_DEG,
            "referenceViewportHeightPx": layout.REFERENCE_VIEWPORT_HEIGHT_PX,
            "referenceFocalPx": layout.REFERENCE_FOCAL_PX,
            "pickProxyMargin": layout.PICK_PROXY_MARGIN,
            "pickFloorDiameterPx": layout.PICK_FLOOR_PX * 2.0,
            "driftVerticalRatio": layout.DRIFT_VERTICAL_RATIO,
        },
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


def _float16(bits: int) -> float:
    """The value a correct decoder reads from a binary16 bit pattern (contract §5)."""
    return cast("float", struct.unpack("<e", struct.pack("<H", bits))[0])
