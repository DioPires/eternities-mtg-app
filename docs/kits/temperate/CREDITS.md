# Temperate kit: asset credits (slice subset)

Every binary asset of the `temperate` kit's slice subset (PRD v4 5.6, 8.12, 9.5), one row each. All
are CC0 1.0. `sources.yaml` carries the same rows with each file's download URL and SHA-256.

The binaries are not committed in this folder. `./fetch.sh` downloads them here and verifies each
against `sources.yaml`. That run fails if a row here differs from its `sources.yaml` entry or if an
asset folder holds a file without one (PRD 8.12.2: an asset without a row blocks the merge). Until
the binaries are committed, the upstream URLs are the only copy of these exact bytes.

## Terrain layers (2K JPG, 2048 × 2048)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Terrain/leafy_grass_diff_2k.jpg` | <https://polyhaven.com/a/leafy_grass> | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Meadow grass terrain layer; albedo |
| `Terrain/leafy_grass_nor_gl_2k.jpg` | <https://polyhaven.com/a/leafy_grass> | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Meadow grass terrain layer; normal, OpenGL convention |
| `Terrain/leafy_grass_arm_2k.jpg` | <https://polyhaven.com/a/leafy_grass> | Charlotte Baglioni | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Meadow grass terrain layer; mask source, AO in R, roughness in G, metalness in B |
| `Terrain/dirt_floor_diff_2k.jpg` | <https://polyhaven.com/a/dirt_floor> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Dirt path terrain layer (plaza, radial and ring paths); albedo |
| `Terrain/dirt_floor_nor_gl_2k.jpg` | <https://polyhaven.com/a/dirt_floor> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Dirt path terrain layer (plaza, radial and ring paths); normal, OpenGL convention |
| `Terrain/dirt_floor_arm_2k.jpg` | <https://polyhaven.com/a/dirt_floor> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Dirt path terrain layer (plaza, radial and ring paths); mask source, AO in R, roughness in G, metalness in B |
| `Terrain/ganges_river_pebbles_diff_2k.jpg` | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Gravel terrain layer (river bed, banks and the lake shore); albedo |
| `Terrain/ganges_river_pebbles_nor_gl_2k.jpg` | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Gravel terrain layer (river bed, banks and the lake shore); normal, OpenGL convention |
| `Terrain/ganges_river_pebbles_arm_2k.jpg` | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Gravel terrain layer (river bed, banks and the lake shore); mask source, AO in R, roughness in G, metalness in B |

## Props (FBX)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Props/tree_oak.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Tree species 1 of 3, broadleaf (oak) |
| `Props/tree_thin.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Tree species 2 of 3, slender with a split crown (birch-like) |
| `Props/tree_pineTallA.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Tree species 3 of 3, conifer |
| `Props/plant_bush.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Bush 1 of 2, small |
| `Props/plant_bushLarge.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Bush 2 of 2, large |
| `Props/rock_largeA.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Rock 1 of 3, boulder with a grass cap |
| `Props/stone_largeB.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Rock 2 of 3, bare grey boulder |
| `Props/stone_smallFlatA.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Rock 3 of 3, small flat stone |
| `Props/crops_wheatStageB.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Reeds for the water edge (a clump of stalks with seed heads) |
| `Props/stone_tallD.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Standing stone, the reference shape for the stand plinth (PRD 5.5.1) |
| `Props/statue_obelisk.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Marker stone for sites under five stands (PRD 5.4.15) |
| `Props/path_wood.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Wooden ford planks where water crosses a path (PRD 8.4.2) |
| `Props/bridge_wood.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Wooden bridge where water crosses a path (PRD 8.4.2) |

## Audio (Ogg Vorbis)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Audio/meadow_songbirds_loop.ogg` | <https://freesound.org/people/DreamSavvyr/sounds/781115/> | DreamSavvyr | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Ambient bed, meadow (PRD 5.12.1); seamless stereo loop, 60.0 s |
| `Audio/river_splashy_loop.ogg` | <https://freesound.org/people/loopo/sounds/164039/> | loopo | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | River spatial emitter (PRD 5.12.3); seamless mono loop, 9.8 s |

## Notes for the slice

- **Size.** 24 files, 39.2 MB of source files, against DEC-952's limit of 60 MB for the subset
  before cooking. The largest texture is 6.0 MB (cap 8 MB) and the largest prop 82 KB (cap 200 KB);
  `fetch.sh` enforces all three. The cooked size against PRD 7.2 is the build's check (PRD 8.7.2),
  not this one.
- **Textures are JPG.** At 2K only Poly Haven's JPG stays under 8 MB per texture (the PNG albedo is
  23 MB, the EXR normal 11 MB). PRD 8.2.3's Git LFS list has no `*.jpg`, so the LFS attributes need
  that pattern before these are committed. `nor_gl` is the OpenGL normal convention, which Unity
  uses. `arm` packs ambient occlusion, roughness and metalness; the HDRP mask map is repacked from
  it on import (smoothness is one minus roughness).
- **Props are the FBX members** of Kenney's Nature Kit 2.1 archive, not their GLB twins: Unity
  imports FBX without a package, and glTF needs one that PRD 9.5's pinned list does not carry. They
  are ASCII FBX 7.3 with flat colour materials and no textures, modelled in kit units (the trees are
  1.2 to 1.5 units tall, the standing stone 0.77), so each prefab sets its own scale and its HDRP
  material. Being text, they carry trailing whitespace: the repository's `trailing-whitespace` and
  `end-of-file-fixer` hooks must exclude them, or a commit rewrites the bytes these checksums pin.
- **Audio files are Freesound's high-quality Ogg previews** of the two CC0 sounds; the uploads (a
  24-bit WAV and an 88 kbps Ogg) need a Freesound login to download. Decoded, the meadow loop is
  stereo, 44.1 kHz, 2,646,000 frames (60.000 s) and the river loop mono, 44.1 kHz, 433,431 frames
  (9.828 s), which are the uploads' published durations. In both, the step from the last sample to
  the first is inside the file's ordinary sample-to-sample range and neither end fades. Nobody has
  listened to them in a loop yet; that is the slice's check.
- **Not chosen.** ambientCG's lawn grass (`Grass004`): its 2K normal map is 10.0 MB, over the cap.
  Freesound 817163 (a mono river loop): its page describes a transfer of 1930s to 1960s studio
  effects, so the CC0 dedication could not be traced to the recording's owner.
