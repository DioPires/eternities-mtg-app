# Temperate kit: asset credits

Every binary asset of the `temperate` kit (PRD v4 5.6, 8.12, 9.5), one row each. All are CC0 1.0.
`sources.yaml` carries the same rows with each file's download URL and SHA-256.

The binaries are committed in this folder through Git LFS. `./fetch.sh` verifies each against
`sources.yaml` and downloads a missing file from its source. It does not download a derived file:
it verifies the kit's own copy, and `./derive.sh` makes that file again from its source. The
`fetch.sh` run fails if a row here differs from its `sources.yaml` entry or if an asset folder
holds a file without one, Unity's `.meta` files aside (PRD 8.12.2: an asset without a row blocks
the merge). So whatever is made from these files (terrain layers, materials, prefabs) lives beside
`Terrain/`, `Props/` and `Audio/`, not inside them.

The kit is at `standard: photographic` (PRD v4 8.12.6; DEC-1003): its vegetation, rocks and ground
are photographic CC0 models and textures, as downloaded or as a committed script derives them
(`Derive/`, PRD v4 7.6.4). The first slice's ten flat models of trees, bushes, rocks and wheat
and its meadow ground (`leafy_grass`) retired with its scatter when leg 2 dressed Dominaria's
regions with the kit's variants (PRD v4 9.6; DEC-1005). The structures are Kenney's.
A model reaches the world through one prefab under `Prefabs/<category>/`, in metres and with its
base at its origin (the prop conditioning rule, `unity/Eternities/README.md`). "Props as drawn"
lists each prefab with the height and the triangles measured on it; `PropRuleTests` holds the rule
and that table.

## Terrain layers (JPG at 2K, 2048 × 2048; `ground037` at 1K)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Terrain/dirt_floor_diff_2k.jpg` | <https://polyhaven.com/a/dirt_floor> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Dirt path terrain layer (plaza, radial and ring paths); albedo |
| `Terrain/dirt_floor_nor_gl_2k.jpg` | <https://polyhaven.com/a/dirt_floor> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Dirt path terrain layer (plaza, radial and ring paths); normal, OpenGL convention |
| `Terrain/dirt_floor_arm_2k.jpg` | <https://polyhaven.com/a/dirt_floor> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Dirt path terrain layer (plaza, radial and ring paths); mask source, AO in R, roughness in G, metalness in B |
| `Terrain/ganges_river_pebbles_diff_2k.jpg` | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Gravel terrain layer (river bed, banks and the lake shore); albedo |
| `Terrain/ganges_river_pebbles_nor_gl_2k.jpg` | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Gravel terrain layer (river bed, banks and the lake shore); normal, OpenGL convention |
| `Terrain/ganges_river_pebbles_arm_2k.jpg` | <https://polyhaven.com/a/ganges_river_pebbles> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Gravel terrain layer (river bed, banks and the lake shore); mask source, AO in R, roughness in G, metalness in B |
| `Terrain/forrest_ground_01_diff_2k.jpg` | <https://polyhaven.com/a/forrest_ground_01> | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood and meadow terrain layer, thin grass over earth with twigs; albedo |
| `Terrain/forrest_ground_01_nor_gl_2k.jpg` | <https://polyhaven.com/a/forrest_ground_01> | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood and meadow terrain layer, thin grass over earth with twigs; normal, OpenGL convention |
| `Terrain/forrest_ground_01_arm_2k.jpg` | <https://polyhaven.com/a/forrest_ground_01> | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood and meadow terrain layer, thin grass over earth with twigs; mask source, AO in R, roughness in G, metalness in B |
| `Terrain/forest_leaves_03_diff_2k.jpg` | <https://polyhaven.com/a/forest_leaves_03> | Dimitrios Savva, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood terrain layer, dark leaf litter; albedo |
| `Terrain/forest_leaves_03_nor_gl_2k.jpg` | <https://polyhaven.com/a/forest_leaves_03> | Dimitrios Savva, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood terrain layer, dark leaf litter; normal, OpenGL convention |
| `Terrain/forest_leaves_03_arm_2k.jpg` | <https://polyhaven.com/a/forest_leaves_03> | Dimitrios Savva, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood terrain layer, dark leaf litter; mask source, AO in R, roughness in G, metalness in B |
| `Terrain/brown_mud_leaves_01_diff_2k.jpg` | <https://polyhaven.com/a/brown_mud_leaves_01> | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Marsh terrain layer, brown mud with leaves and moss; albedo |
| `Terrain/brown_mud_leaves_01_nor_gl_2k.jpg` | <https://polyhaven.com/a/brown_mud_leaves_01> | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Marsh terrain layer, brown mud with leaves and moss; normal, OpenGL convention |
| `Terrain/brown_mud_leaves_01_arm_2k.jpg` | <https://polyhaven.com/a/brown_mud_leaves_01> | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Marsh terrain layer, brown mud with leaves and moss; mask source, AO in R, roughness in G, metalness in B |
| `Terrain/mud_forest_diff_2k.jpg` | <https://polyhaven.com/a/mud_forest> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Marsh terrain layer, dark wet mud; albedo |
| `Terrain/mud_forest_nor_gl_2k.jpg` | <https://polyhaven.com/a/mud_forest> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Marsh terrain layer, dark wet mud; normal, OpenGL convention |
| `Terrain/mud_forest_arm_2k.jpg` | <https://polyhaven.com/a/mud_forest> | eye-candy.xyz | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Marsh terrain layer, dark wet mud; mask source, AO in R, roughness in G, metalness in B |
| `Terrain/dark_rock_diff_2k.jpg` | <https://polyhaven.com/a/dark_rock> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Highland terrain layer, dark fissured rock (basalt ground for Shiv); albedo |
| `Terrain/dark_rock_nor_gl_2k.jpg` | <https://polyhaven.com/a/dark_rock> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Highland terrain layer, dark fissured rock (basalt ground for Shiv); normal, OpenGL convention |
| `Terrain/dark_rock_arm_2k.jpg` | <https://polyhaven.com/a/dark_rock> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Highland terrain layer, dark fissured rock (basalt ground for Shiv); mask source, AO in R, roughness in G, metalness in B |
| `Terrain/ground037_diff_1k.jpg` | <https://ambientcg.com/a/Ground037> | Lennart Demes (ambientCG) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Meadow terrain layer, moss and thin grass over damp earth; albedo |
| `Terrain/ground037_nor_gl_1k.jpg` | <https://ambientcg.com/a/Ground037> | Lennart Demes (ambientCG) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Meadow terrain layer, moss and thin grass over damp earth; normal, OpenGL convention |
| `Terrain/ground037_rough_1k.jpg` | <https://ambientcg.com/a/Ground037> | Lennart Demes (ambientCG) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Meadow terrain layer, moss and thin grass over damp earth; mask source, roughness |
| `Terrain/ground037_ao_1k.jpg` | <https://ambientcg.com/a/Ground037> | Lennart Demes (ambientCG) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Meadow terrain layer, moss and thin grass over damp earth; mask source, ambient occlusion |
| `Terrain/dark_rock_02_diff_2k.jpg` | <https://polyhaven.com/a/dark_rock_02> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Highland terrain layer, dark blocky rock (basalt ground for Shiv); albedo |
| `Terrain/dark_rock_02_nor_gl_2k.jpg` | <https://polyhaven.com/a/dark_rock_02> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Highland terrain layer, dark blocky rock (basalt ground for Shiv); normal, OpenGL convention |
| `Terrain/dark_rock_02_arm_2k.jpg` | <https://polyhaven.com/a/dark_rock_02> | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Highland terrain layer, dark blocky rock (basalt ground for Shiv); mask source, AO in R, roughness in G, metalness in B |

## Props (FBX)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Props/statue_obelisk.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Marker stone for sites under five stands (PRD 5.4.15) |
| `Props/path_wood.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Wooden ford planks where water crosses a path (PRD 8.4.2) |
| `Props/bridge_wood.fbx` | <https://kenney.nl/assets/nature-kit> | Kenney | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Wooden bridge where water crosses a path (PRD 8.4.2) |

## Props, photographic (FBX; JPG maps at 1K or 2K; PNG opacity)

From Poly Haven, as downloaded. A file of several plants or rocks is several props, each a prefab
that draws one of its meshes; "Props as drawn" lists them.

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Props/rock_moss_set_01_1k.fbx` | <https://polyhaven.com/a/rock_moss_set_01> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, six mossy boulders of 1.1 to 1.8 m; model |
| `Props/rock_moss_set_01_diff_2k.jpg` | <https://polyhaven.com/a/rock_moss_set_01> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, six mossy boulders of 1.1 to 1.8 m; albedo |
| `Props/rock_moss_set_01_nor_gl_2k.jpg` | <https://polyhaven.com/a/rock_moss_set_01> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, six mossy boulders of 1.1 to 1.8 m; normal, OpenGL convention |
| `Props/rock_moss_set_01_arm_2k.jpg` | <https://polyhaven.com/a/rock_moss_set_01> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, six mossy boulders of 1.1 to 1.8 m; mask source, AO in R, roughness in G, metalness in B |
| `Props/rock_moss_set_02_1k.fbx` | <https://polyhaven.com/a/rock_moss_set_02> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, seven mossy rocks of 0.5 to 1.3 m; model |
| `Props/rock_moss_set_02_diff_2k.jpg` | <https://polyhaven.com/a/rock_moss_set_02> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, seven mossy rocks of 0.5 to 1.3 m; albedo |
| `Props/rock_moss_set_02_nor_gl_2k.jpg` | <https://polyhaven.com/a/rock_moss_set_02> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, seven mossy rocks of 0.5 to 1.3 m; normal, OpenGL convention |
| `Props/rock_moss_set_02_arm_2k.jpg` | <https://polyhaven.com/a/rock_moss_set_02> | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rocks, seven mossy rocks of 0.5 to 1.3 m; mask source, AO in R, roughness in G, metalness in B |
| `Props/boulder_01_1k.fbx` | <https://polyhaven.com/a/boulder_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rock, a bare boulder of 1.0 m; model |
| `Props/boulder_01_diff_2k.jpg` | <https://polyhaven.com/a/boulder_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rock, a bare boulder of 1.0 m; albedo |
| `Props/boulder_01_nor_gl_2k.jpg` | <https://polyhaven.com/a/boulder_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rock, a bare boulder of 1.0 m; normal, OpenGL convention |
| `Props/boulder_01_arm_2k.jpg` | <https://polyhaven.com/a/boulder_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Rock, a bare boulder of 1.0 m; mask source, AO in R, roughness in G, metalness in B |
| `Props/shrub_02_1k.fbx` | <https://polyhaven.com/a/shrub_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Shrubs, four thin-stemmed plants of 1.0 to 1.4 m; model |
| `Props/shrub_02_diff_1k.jpg` | <https://polyhaven.com/a/shrub_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Shrubs, four thin-stemmed plants of 1.0 to 1.4 m; albedo |
| `Props/shrub_02_nor_gl_1k.jpg` | <https://polyhaven.com/a/shrub_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Shrubs, four thin-stemmed plants of 1.0 to 1.4 m; normal, OpenGL convention |
| `Props/shrub_02_arm_1k.jpg` | <https://polyhaven.com/a/shrub_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Shrubs, four thin-stemmed plants of 1.0 to 1.4 m; mask source, AO in R, roughness in G, metalness in B |
| `Props/shrub_02_alpha_1k.png` | <https://polyhaven.com/a/shrub_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Shrubs, four thin-stemmed plants of 1.0 to 1.4 m; opacity |
| `Props/fern_02_1k.fbx` | <https://polyhaven.com/a/fern_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Ferns, four plants of 0.2 to 0.4 m; model |
| `Props/fern_02_diff_1k.jpg` | <https://polyhaven.com/a/fern_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Ferns, four plants of 0.2 to 0.4 m; albedo |
| `Props/fern_02_nor_gl_1k.jpg` | <https://polyhaven.com/a/fern_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Ferns, four plants of 0.2 to 0.4 m; normal, OpenGL convention |
| `Props/fern_02_arm_1k.jpg` | <https://polyhaven.com/a/fern_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Ferns, four plants of 0.2 to 0.4 m; mask source, AO in R, roughness in G, metalness in B |
| `Props/fern_02_alpha_1k.png` | <https://polyhaven.com/a/fern_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Ferns, four plants of 0.2 to 0.4 m; opacity |
| `Props/grass_medium_01_1k.fbx` | <https://polyhaven.com/a/grass_medium_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 5 to 32 cm; model |
| `Props/grass_medium_01_diff_1k.jpg` | <https://polyhaven.com/a/grass_medium_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 5 to 32 cm; albedo |
| `Props/grass_medium_01_nor_gl_1k.jpg` | <https://polyhaven.com/a/grass_medium_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 5 to 32 cm; normal, OpenGL convention |
| `Props/grass_medium_01_arm_1k.jpg` | <https://polyhaven.com/a/grass_medium_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 5 to 32 cm; mask source, AO in R, roughness in G, metalness in B |
| `Props/grass_medium_01_alpha_1k.png` | <https://polyhaven.com/a/grass_medium_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 5 to 32 cm; opacity |
| `Props/grass_medium_02_1k.fbx` | <https://polyhaven.com/a/grass_medium_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 16 to 40 cm; model |
| `Props/grass_medium_02_diff_1k.jpg` | <https://polyhaven.com/a/grass_medium_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 16 to 40 cm; albedo |
| `Props/grass_medium_02_nor_gl_1k.jpg` | <https://polyhaven.com/a/grass_medium_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 16 to 40 cm; normal, OpenGL convention |
| `Props/grass_medium_02_arm_1k.jpg` | <https://polyhaven.com/a/grass_medium_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 16 to 40 cm; mask source, AO in R, roughness in G, metalness in B |
| `Props/grass_medium_02_alpha_1k.png` | <https://polyhaven.com/a/grass_medium_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Grass tufts of 16 to 40 cm; opacity |
| `Props/celandine_01_1k.fbx` | <https://polyhaven.com/a/celandine_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, lesser celandine; model |
| `Props/celandine_01_diff_1k.jpg` | <https://polyhaven.com/a/celandine_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, lesser celandine; albedo |
| `Props/celandine_01_nor_gl_1k.jpg` | <https://polyhaven.com/a/celandine_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, lesser celandine; normal, OpenGL convention |
| `Props/celandine_01_arm_1k.jpg` | <https://polyhaven.com/a/celandine_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, lesser celandine; mask source, AO in R, roughness in G, metalness in B |
| `Props/celandine_01_alpha_1k.png` | <https://polyhaven.com/a/celandine_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, lesser celandine; opacity |
| `Props/dandelion_01_1k.fbx` | <https://polyhaven.com/a/dandelion_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, dandelion; model |
| `Props/dandelion_01_diff_1k.jpg` | <https://polyhaven.com/a/dandelion_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, dandelion; albedo |
| `Props/dandelion_01_nor_gl_1k.jpg` | <https://polyhaven.com/a/dandelion_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, dandelion; normal, OpenGL convention |
| `Props/dandelion_01_arm_1k.jpg` | <https://polyhaven.com/a/dandelion_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, dandelion; mask source, AO in R, roughness in G, metalness in B |
| `Props/dandelion_01_alpha_1k.png` | <https://polyhaven.com/a/dandelion_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Flowering ground cover, dandelion; opacity |
| `Props/shrub_03_1k.fbx` | <https://polyhaven.com/a/shrub_03> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Slender stems with seed spikes, four plants of 26 to 40 cm; model |
| `Props/shrub_03_diff_1k.jpg` | <https://polyhaven.com/a/shrub_03> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Slender stems with seed spikes, four plants of 26 to 40 cm; albedo |
| `Props/shrub_03_nor_gl_1k.jpg` | <https://polyhaven.com/a/shrub_03> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Slender stems with seed spikes, four plants of 26 to 40 cm; normal, OpenGL convention |
| `Props/shrub_03_arm_1k.jpg` | <https://polyhaven.com/a/shrub_03> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Slender stems with seed spikes, four plants of 26 to 40 cm; mask source, AO in R, roughness in G, metalness in B |
| `Props/shrub_03_alpha_1k.png` | <https://polyhaven.com/a/shrub_03> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Slender stems with seed spikes, four plants of 26 to 40 cm; opacity |
| `Props/weed_plant_02_1k.fbx` | <https://polyhaven.com/a/weed_plant_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Broad-leaved weeds, five low clusters of 12 to 29 cm across; model |
| `Props/weed_plant_02_diff_1k.jpg` | <https://polyhaven.com/a/weed_plant_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Broad-leaved weeds, five low clusters of 12 to 29 cm across; albedo |
| `Props/weed_plant_02_nor_gl_1k.jpg` | <https://polyhaven.com/a/weed_plant_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Broad-leaved weeds, five low clusters of 12 to 29 cm across; normal, OpenGL convention |
| `Props/weed_plant_02_arm_1k.jpg` | <https://polyhaven.com/a/weed_plant_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Broad-leaved weeds, five low clusters of 12 to 29 cm across; mask source, AO in R, roughness in G, metalness in B |
| `Props/weed_plant_02_alpha_1k.png` | <https://polyhaven.com/a/weed_plant_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Broad-leaved weeds, five low clusters of 12 to 29 cm across; opacity |
| `Props/shrub_sorrel_01_1k.fbx` | <https://polyhaven.com/a/shrub_sorrel_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood sorrel, small clusters of 2 to 6 cm with pink flowers; model |
| `Props/shrub_sorrel_01_diff_1k.jpg` | <https://polyhaven.com/a/shrub_sorrel_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood sorrel, small clusters of 2 to 6 cm with pink flowers; albedo |
| `Props/shrub_sorrel_01_nor_gl_1k.jpg` | <https://polyhaven.com/a/shrub_sorrel_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood sorrel, small clusters of 2 to 6 cm with pink flowers; normal, OpenGL convention |
| `Props/shrub_sorrel_01_arm_1k.jpg` | <https://polyhaven.com/a/shrub_sorrel_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood sorrel, small clusters of 2 to 6 cm with pink flowers; mask source, AO in R, roughness in G, metalness in B |
| `Props/shrub_sorrel_01_alpha_1k.png` | <https://polyhaven.com/a/shrub_sorrel_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Wood sorrel, small clusters of 2 to 6 cm with pink flowers; opacity |
| `Props/nettle_plant_1k.fbx` | <https://polyhaven.com/a/nettle_plant> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Nettles, six plants of 2 to 22 cm; model |
| `Props/nettle_plant_diff_1k.jpg` | <https://polyhaven.com/a/nettle_plant> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Nettles, six plants of 2 to 22 cm; albedo |
| `Props/nettle_plant_nor_gl_1k.jpg` | <https://polyhaven.com/a/nettle_plant> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Nettles, six plants of 2 to 22 cm; normal, OpenGL convention |
| `Props/nettle_plant_arm_1k.jpg` | <https://polyhaven.com/a/nettle_plant> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Nettles, six plants of 2 to 22 cm; mask source, AO in R, roughness in G, metalness in B |
| `Props/nettle_plant_alpha_1k.png` | <https://polyhaven.com/a/nettle_plant> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Nettles, six plants of 2 to 22 cm; opacity |
| `Props/rock_07_1k.fbx` | <https://polyhaven.com/a/rock_07> | Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Stone, a dark block 32 cm long; model |
| `Props/rock_07_diff_1k.jpg` | <https://polyhaven.com/a/rock_07> | Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Stone, a dark block 32 cm long; albedo |
| `Props/rock_07_nor_gl_1k.jpg` | <https://polyhaven.com/a/rock_07> | Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Stone, a dark block 32 cm long; normal, OpenGL convention |
| `Props/rock_07_arm_1k.jpg` | <https://polyhaven.com/a/rock_07> | Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Stone, a dark block 32 cm long; mask source, AO in R, roughness in G, metalness in B |
| `Props/dry_branches_medium_01_1k.fbx` | <https://polyhaven.com/a/dry_branches_medium_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Dry fallen branches, three of 0.8 to 1.3 m long; model |
| `Props/dry_branches_medium_01_diff_1k.jpg` | <https://polyhaven.com/a/dry_branches_medium_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Dry fallen branches, three of 0.8 to 1.3 m long; albedo |
| `Props/dry_branches_medium_01_nor_gl_1k.jpg` | <https://polyhaven.com/a/dry_branches_medium_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Dry fallen branches, three of 0.8 to 1.3 m long; normal, OpenGL convention |
| `Props/dry_branches_medium_01_arm_1k.jpg` | <https://polyhaven.com/a/dry_branches_medium_01> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-12 | Dry fallen branches, three of 0.8 to 1.3 m long; mask source, AO in R, roughness in G, metalness in B |
| `Props/jacaranda_tree_trunk_diff_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its trunk; albedo |
| `Props/jacaranda_tree_trunk_nor_gl_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its trunk; normal, OpenGL convention |
| `Props/jacaranda_tree_trunk_arm_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its trunk; mask source, AO in R, roughness in G, metalness in B |
| `Props/jacaranda_tree_branches_diff_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its boughs and twigs; albedo |
| `Props/jacaranda_tree_branches_nor_gl_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its boughs and twigs; normal, OpenGL convention |
| `Props/jacaranda_tree_branches_arm_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its boughs and twigs; mask source, AO in R, roughness in G, metalness in B |
| `Props/jacaranda_tree_leaves_diff_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its leaves; albedo |
| `Props/jacaranda_tree_leaves_nor_gl_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its leaves; normal, OpenGL convention |
| `Props/jacaranda_tree_leaves_arm_1k.jpg` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its leaves; mask source, AO in R, roughness in G, metalness in B |
| `Props/jacaranda_tree_leaves_alpha_1k.png` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall: its leaves; opacity |
| `Props/tree_small_02_diff_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its trunk; albedo |
| `Props/tree_small_02_nor_gl_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its trunk; normal, OpenGL convention |
| `Props/tree_small_02_arm_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its trunk; mask source, AO in R, roughness in G, metalness in B |
| `Props/tree_small_02_branch_diff_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its twigs; albedo |
| `Props/tree_small_02_branch_nor_gl_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its twigs; normal, OpenGL convention |
| `Props/tree_small_02_branch_arm_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its twigs; mask source, AO in R, roughness in G, metalness in B |
| `Props/tree_small_02_leaves_diff_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its leaves; albedo |
| `Props/tree_small_02_leaves_nor_gl_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its leaves; normal, OpenGL convention |
| `Props/tree_small_02_leaves_arm_1k.jpg` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its leaves; mask source, AO in R, roughness in G, metalness in B |
| `Props/tree_small_02_leaves_alpha_1k.png` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall: its leaves; opacity |
| `Props/island_tree_01_diff_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its trunk; albedo |
| `Props/island_tree_01_nor_gl_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its trunk; normal, OpenGL convention |
| `Props/island_tree_01_arm_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its trunk; mask source, AO in R, roughness in G, metalness in B |
| `Props/island_tree_01_branches_diff_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its twigs; albedo |
| `Props/island_tree_01_branches_nor_gl_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its twigs; normal, OpenGL convention |
| `Props/island_tree_01_branches_arm_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its twigs; mask source, AO in R, roughness in G, metalness in B |
| `Props/island_tree_01_leaves_diff_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its leaves; albedo |
| `Props/island_tree_01_leaves_nor_gl_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its leaves; normal, OpenGL convention |
| `Props/island_tree_01_leaves_arm_1k.jpg` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its leaves; mask source, AO in R, roughness in G, metalness in B |
| `Props/island_tree_01_leaves_alpha_1k.png` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall: its leaves; opacity |

## Props, cut from photographic models (FBX)

A tree or a bush as Poly Haven publishes it is a mesh of up to four million triangles, with no
lighter level in its file. Each file here is one cut to three or four levels of detail by a
script under `Derive/` (PRD v4 7.6.4, the derived binary): a broadleaf or a bush by
`cut_tree.py`, a fir by `cut_fir.py` from its glTF. Its source is pinned in `sources.yaml` by its
address (`url`) and its SHA-256 (`source_sha256`), a glTF's data file by `url_2` and
`source_sha256_2`, and is not committed; `derived_by` is the script and its word for the plant.
`./derive.sh` downloads the source, cuts it again and holds the result to the file here, byte
for byte. `Derive/<file>.json` is the cut's own report of what it kept. A cut model is drawn with
its source's photographs, which are in the table above as downloaded.

A sedge clump is set by `set_clump.py` from the stems of a scan by ffish.asia / floraZia.com, and
the scan's photograph is copied out of its glTF, byte for byte, by `scan_photograph.py`. Sketchfab
gives no download without a login, so the two scans' glTF files, as downloaded, are pinned at a
pre-release of this repository that holds them and nothing else:
<https://github.com/DioPires/eternities-mtg-app/releases/tag/kit-sources-temperate-1>. The Source
column names each scan's own page.

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Props/jacaranda_tree_cut.fbx` | <https://polyhaven.com/a/jacaranda_tree> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Jacaranda, a spreading tree 19.5 m tall and 24.7 m across; cut by `Derive/cut_tree.py` from the source's 3,863,832 triangles to four levels of 59,620 to 452 |
| `Props/tree_small_02_cut.fbx` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall; cut by `Derive/cut_tree.py` from the source's 2,062,487 triangles to four levels of 58,999 to 429 |
| `Props/island_tree_01_cut.fbx` | <https://polyhaven.com/a/island_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Gnarled small tree, 5.0 m tall; cut by `Derive/cut_tree.py` from the source's 1,599,403 triangles to four levels of 58,998 to 429 |
| `Props/fir_sapling_medium_branches_diff_1k.jpg` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their trunk and boughs; albedo |
| `Props/fir_sapling_medium_branches_nor_gl_1k.jpg` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their trunk and boughs; normal, OpenGL convention |
| `Props/fir_sapling_medium_branches_arm_1k.jpg` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their trunk and boughs; mask source, AO in R, roughness in G, metalness in B |
| `Props/fir_sapling_medium_twigs_diff_1k.jpg` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their needles, as sprays; albedo |
| `Props/fir_sapling_medium_twigs_nor_gl_1k.jpg` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their needles, as sprays; normal, OpenGL convention |
| `Props/fir_sapling_medium_twigs_arm_1k.jpg` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their needles, as sprays; mask source, AO in R, roughness in G, metalness in B |
| `Props/fir_sapling_medium_twigs_alpha_1k.png` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young firs, three of 6.0 to 8.9 m: their needles, as sprays; opacity |
| `Props/fir_tree_01_bark_diff_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their boughs; albedo |
| `Props/fir_tree_01_bark_nor_gl_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their boughs; normal, OpenGL convention |
| `Props/fir_tree_01_bark_arm_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their boughs; mask source, AO in R, roughness in G, metalness in B |
| `Props/fir_tree_01_trunk_a_diff_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir of 19.0 m: its trunk; albedo |
| `Props/fir_tree_01_trunk_a_nor_gl_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir of 19.0 m: its trunk; normal, OpenGL convention |
| `Props/fir_tree_01_trunk_a_arm_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir of 19.0 m: its trunk; mask source, AO in R, roughness in G, metalness in B |
| `Props/fir_tree_01_trunk_b_diff_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir of 14.1 m: its trunk; albedo |
| `Props/fir_tree_01_trunk_b_nor_gl_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir of 14.1 m: its trunk; normal, OpenGL convention |
| `Props/fir_tree_01_trunk_b_arm_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir of 14.1 m: its trunk; mask source, AO in R, roughness in G, metalness in B |
| `Props/fir_tree_01_twig_diff_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their needles, as sprays; albedo |
| `Props/fir_tree_01_twig_nor_gl_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their needles, as sprays; normal, OpenGL convention |
| `Props/fir_tree_01_twig_arm_1k.jpg` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their needles, as sprays; mask source, AO in R, roughness in G, metalness in B |
| `Props/fir_tree_01_twig_alpha_1k.png` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall firs, two of 14.1 and 19.0 m: their needles, as sprays; opacity |
| `Props/searsia_lucida_diff_1k.jpg` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bushes, seven of 0.7 to 2.3 m: stems, twigs and leaves; albedo |
| `Props/searsia_lucida_nor_gl_1k.jpg` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bushes, seven of 0.7 to 2.3 m: stems, twigs and leaves; normal, OpenGL convention |
| `Props/searsia_lucida_arm_1k.jpg` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bushes, seven of 0.7 to 2.3 m: stems, twigs and leaves; mask source, AO in R, roughness in G, metalness in B |
| `Props/searsia_lucida_alpha_1k.png` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bushes, seven of 0.7 to 2.3 m: stems, twigs and leaves; opacity |
| `Props/island_tree_02_diff_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its trunk; albedo |
| `Props/island_tree_02_nor_gl_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its trunk; normal, OpenGL convention |
| `Props/island_tree_02_arm_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its trunk; mask source, AO in R, roughness in G, metalness in B |
| `Props/island_tree_02_branches_diff_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its twigs; albedo |
| `Props/island_tree_02_branches_nor_gl_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its twigs; normal, OpenGL convention |
| `Props/island_tree_02_branches_arm_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its twigs; mask source, AO in R, roughness in G, metalness in B |
| `Props/island_tree_02_leaves_diff_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its leaves; albedo |
| `Props/island_tree_02_leaves_nor_gl_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its leaves; normal, OpenGL convention |
| `Props/island_tree_02_leaves_arm_1k.jpg` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its leaves; mask source, AO in R, roughness in G, metalness in B |
| `Props/island_tree_02_leaves_alpha_1k.png` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree of 3.4 m, drawn smaller as a shrub: its leaves; opacity |
| `Props/fir_tree_01_a_cut.fbx` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir, 19.0 m; cut by `Derive/cut_fir.py` from the source's 4,176,819 triangles to four levels of 57,964 to 418 |
| `Props/fir_tree_01_b_cut.fbx` | <https://polyhaven.com/a/fir_tree_01> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Tall fir, 14.1 m; cut by `Derive/cut_fir.py` from the source's 2,300,624 triangles to four levels of 58,031 to 417 |
| `Props/fir_sapling_medium_a_cut.fbx` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young fir, 8.9 m; cut by `Derive/cut_fir.py` from the source's 685,046 triangles to four levels of 48,937 to 374 |
| `Props/fir_sapling_medium_b_cut.fbx` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young fir, 7.8 m; cut by `Derive/cut_fir.py` from the source's 420,822 triangles to four levels of 45,430 to 369 |
| `Props/fir_sapling_medium_c_cut.fbx` | <https://polyhaven.com/a/fir_sapling_medium> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Young fir, 6.0 m; cut by `Derive/cut_fir.py` from the source's 427,645 triangles to four levels of 45,556 to 368 |
| `Props/searsia_lucida_a_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 2.3 m; cut by `Derive/cut_tree.py` from the source's 113,405 triangles to three levels of 9,598 to 280 |
| `Props/searsia_lucida_b_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 2.0 m; cut by `Derive/cut_tree.py` from the source's 88,629 triangles to three levels of 9,598 to 280 |
| `Props/searsia_lucida_c_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 1.7 m; cut by `Derive/cut_tree.py` from the source's 77,603 triangles to three levels of 9,599 to 280 |
| `Props/searsia_lucida_d_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 1.4 m; cut by `Derive/cut_tree.py` from the source's 56,320 triangles to three levels of 8,538 to 280 |
| `Props/searsia_lucida_e_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 1.0 m; cut by `Derive/cut_tree.py` from the source's 27,701 triangles to three levels of 5,446 to 280 |
| `Props/searsia_lucida_f_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 0.7 m; cut by `Derive/cut_tree.py` from the source's 7,232 triangles to three levels of 3,287 to 280 |
| `Props/searsia_lucida_g_cut.fbx` | <https://polyhaven.com/a/searsia_lucida> | James Ray Cock, Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Leafy bush, 0.8 m; cut by `Derive/cut_tree.py` from the source's 6,302 triangles to three levels of 3,223 to 280 |
| `Props/island_tree_02_cut.fbx` | <https://polyhaven.com/a/island_tree_02> | Rico Cilliers, Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Small gnarled tree, 3.4 m tall and 4.2 m across, drawn smaller as a shrub; cut by `Derive/cut_tree.py` from the source's 1,072,213 triangles to three levels of 9,999 to 379 |
| `Props/tree_small_02_sapling_cut.fbx` | <https://polyhaven.com/a/tree_small_02> | Rico Cilliers | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Slender small tree, 4.6 m tall, drawn at half its size as a sapling under a wood's trees; cut by `Derive/cut_tree.py` from the source's 2,062,487 triangles to three levels of 9,998 to 379 |
| `Props/carex_dispalata_1_diff_scan.jpg` | <https://sketchfab.com/3d-models/cc0-kasa-sge-sedge-carex-dispalata-79f4b32c824c45be8e3f668d18062cdf> | ffish.asia / floraZia.com | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Kasa-suge sedge, the stem of 0.59 m: its photograph, taken out of the scan's glTF byte for byte by `Derive/scan_photograph.py`; albedo |
| `Props/carex_dispalata_2_diff_scan.jpg` | <https://sketchfab.com/3d-models/cc0-kasa-sge-sedge-carex-dispalata-79f4b32c824c45be8e3f668d18062cdf> | ffish.asia / floraZia.com | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Kasa-suge sedge, the stem of 0.55 m: its photograph, taken out of the scan's glTF byte for byte by `Derive/scan_photograph.py`; albedo |
| `Props/carex_maximowiczii_diff_scan.jpg` | <https://sketchfab.com/3d-models/cc0-maximowiczs-sedge-carex-maximowiczii-5737d74736ab440cb5b87f1c23ff96ff> | ffish.asia / floraZia.com | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Maximowicz's sedge, a stem of 0.33 m: its photograph, taken out of the scan's glTF byte for byte by `Derive/scan_photograph.py`; albedo |
| `Props/carex_dispalata_clump.fbx` | <https://sketchfab.com/3d-models/cc0-kasa-sge-sedge-carex-dispalata-79f4b32c824c45be8e3f668d18062cdf> | ffish.asia / floraZia.com | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Kasa-suge sedge, a clump of 16 stems 0.59 m tall for the marsh and the meadow; set by `Derive/set_clump.py` from the scan's two stems of 100,842 and 168,188 triangles, to three levels of 9,600 to 800 |
| `Props/carex_maximowiczii_clump.fbx` | <https://sketchfab.com/3d-models/cc0-maximowiczs-sedge-carex-maximowiczii-5737d74736ab440cb5b87f1c23ff96ff> | ffish.asia / floraZia.com | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-13 | Maximowicz's sedge, a clump of 28 stems 0.34 m tall for the marsh and the meadow; set by `Derive/set_clump.py` from the scan's stem of 58,424 triangles, to three levels of 9,520 to 896 |

## Props as drawn

One row a prefab under `Prefabs/`. The height is the prefab's at scale 1; the triangles are those
of the nearest level of detail it draws, and of the farthest where it has more than one. To print
the rows from the prefabs: the editor's menu, Eternities, "Kit props as drawn".

| Prop | Category | Model | Height | Triangles | Materials |
|---|---|---|---|---|---|
| carex_dispalata | bush | `Props/carex_dispalata_clump.fbx` | 0.59 m | 9,600 to 800 | 2 |
| carex_maximowiczii | bush | `Props/carex_maximowiczii_clump.fbx` | 0.34 m | 9,520 to 896 | 1 |
| island_tree_02 | bush | `Props/island_tree_02_cut.fbx` | 2.05 m | 9,999 to 379 | 3 |
| searsia_lucida_a | bush | `Props/searsia_lucida_a_cut.fbx` | 2.34 m | 9,598 to 280 | 1 |
| searsia_lucida_b | bush | `Props/searsia_lucida_b_cut.fbx` | 2.00 m | 9,598 to 280 | 1 |
| searsia_lucida_c | bush | `Props/searsia_lucida_c_cut.fbx` | 1.69 m | 9,599 to 280 | 1 |
| searsia_lucida_d | bush | `Props/searsia_lucida_d_cut.fbx` | 1.43 m | 8,538 to 280 | 1 |
| searsia_lucida_e | bush | `Props/searsia_lucida_e_cut.fbx` | 1.02 m | 5,446 to 280 | 1 |
| searsia_lucida_f | bush | `Props/searsia_lucida_f_cut.fbx` | 0.74 m | 3,287 to 280 | 1 |
| searsia_lucida_g | bush | `Props/searsia_lucida_g_cut.fbx` | 0.79 m | 3,223 to 280 | 1 |
| tree_small_02_sapling | bush | `Props/tree_small_02_sapling_cut.fbx` | 2.35 m | 9,998 to 379 | 3 |
| celandine_01_a | ground cover | `Props/celandine_01_1k.fbx` | 0.19 m | 622 to 64 | 1 |
| celandine_01_b | ground cover | `Props/celandine_01_1k.fbx` | 0.14 m | 599 to 64 | 1 |
| celandine_01_e | ground cover | `Props/celandine_01_1k.fbx` | 0.12 m | 442 to 64 | 1 |
| dandelion_01_a | ground cover | `Props/dandelion_01_1k.fbx` | 0.16 m | 1,933 to 64 | 1 |
| dandelion_01_b | ground cover | `Props/dandelion_01_1k.fbx` | 0.11 m | 1,873 to 64 | 1 |
| dandelion_01_c | ground cover | `Props/dandelion_01_1k.fbx` | 0.10 m | 998 to 64 | 1 |
| dandelion_01_d | ground cover | `Props/dandelion_01_1k.fbx` | 0.06 m | 880 to 63 | 1 |
| dandelion_01_e | ground cover | `Props/dandelion_01_1k.fbx` | 0.05 m | 520 to 64 | 1 |
| dry_branches_medium_01_a | ground cover | `Props/dry_branches_medium_01_1k.fbx` | 0.34 m | 1,534 to 64 | 1 |
| dry_branches_medium_01_b | ground cover | `Props/dry_branches_medium_01_1k.fbx` | 0.14 m | 1,408 to 64 | 1 |
| dry_branches_medium_01_c | ground cover | `Props/dry_branches_medium_01_1k.fbx` | 0.14 m | 1,536 to 64 | 1 |
| fern_02_a | ground cover | `Props/fern_02_1k.fbx` | 0.29 m | 784 to 64 | 1 |
| fern_02_b | ground cover | `Props/fern_02_1k.fbx` | 0.43 m | 2,384 to 64 | 1 |
| fern_02_c | ground cover | `Props/fern_02_1k.fbx` | 0.35 m | 2,248 to 64 | 1 |
| fern_02_d | ground cover | `Props/fern_02_1k.fbx` | 0.21 m | 816 to 64 | 1 |
| grass_medium_01_mid_a | ground cover | `Props/grass_medium_01_1k.fbx` | 0.22 m | 2,287 to 64 | 1 |
| grass_medium_01_mid_b | ground cover | `Props/grass_medium_01_1k.fbx` | 0.18 m | 1,257 to 64 | 1 |
| grass_medium_01_mid_c | ground cover | `Props/grass_medium_01_1k.fbx` | 0.14 m | 1,466 to 64 | 1 |
| grass_medium_01_small_a | ground cover | `Props/grass_medium_01_1k.fbx` | 0.14 m | 833 to 64 | 1 |
| grass_medium_01_small_b | ground cover | `Props/grass_medium_01_1k.fbx` | 0.10 m | 653 to 64 | 1 |
| grass_medium_01_tall_a | ground cover | `Props/grass_medium_01_1k.fbx` | 0.32 m | 290 to 64 | 1 |
| grass_medium_01_tall_b | ground cover | `Props/grass_medium_01_1k.fbx` | 0.29 m | 310 to 64 | 1 |
| grass_medium_01_tall_c | ground cover | `Props/grass_medium_01_1k.fbx` | 0.24 m | 340 to 64 | 1 |
| grass_medium_02_a | ground cover | `Props/grass_medium_02_1k.fbx` | 0.16 m | 714 to 64 | 1 |
| grass_medium_02_b | ground cover | `Props/grass_medium_02_1k.fbx` | 0.18 m | 1,760 to 64 | 1 |
| grass_medium_02_c | ground cover | `Props/grass_medium_02_1k.fbx` | 0.23 m | 1,215 to 64 | 1 |
| grass_medium_02_d | ground cover | `Props/grass_medium_02_1k.fbx` | 0.26 m | 2,489 to 64 | 1 |
| grass_medium_02_e | ground cover | `Props/grass_medium_02_1k.fbx` | 0.40 m | 1,664 to 64 | 1 |
| nettle_plant_medium_a | ground cover | `Props/nettle_plant_1k.fbx` | 0.13 m | 1,535 to 64 | 1 |
| nettle_plant_medium_b | ground cover | `Props/nettle_plant_1k.fbx` | 0.10 m | 1,535 to 153 | 1 |
| nettle_plant_tall_a | ground cover | `Props/nettle_plant_1k.fbx` | 0.22 m | 1,919 to 147 | 1 |
| nettle_plant_tall_b | ground cover | `Props/nettle_plant_1k.fbx` | 0.19 m | 2,111 to 64 | 1 |
| shrub_02_a | ground cover | `Props/shrub_02_1k.fbx` | 1.37 m | 1,919 to 64 | 1 |
| shrub_02_b | ground cover | `Props/shrub_02_1k.fbx` | 1.22 m | 1,344 to 64 | 1 |
| shrub_02_c | ground cover | `Props/shrub_02_1k.fbx` | 1.07 m | 2,494 to 64 | 1 |
| shrub_02_d | ground cover | `Props/shrub_02_1k.fbx` | 1.00 m | 1,344 to 64 | 1 |
| shrub_03_a | ground cover | `Props/shrub_03_1k.fbx` | 0.40 m | 2,385 to 64 | 1 |
| shrub_03_b | ground cover | `Props/shrub_03_1k.fbx` | 0.35 m | 2,134 to 64 | 1 |
| shrub_03_c | ground cover | `Props/shrub_03_1k.fbx` | 0.30 m | 1,790 to 63 | 1 |
| shrub_03_d | ground cover | `Props/shrub_03_1k.fbx` | 0.26 m | 1,978 to 63 | 1 |
| shrub_sorrel_01_a | ground cover | `Props/shrub_sorrel_01_1k.fbx` | 0.06 m | 353 to 64 | 1 |
| shrub_sorrel_01_b | ground cover | `Props/shrub_sorrel_01_1k.fbx` | 0.05 m | 414 to 64 | 1 |
| shrub_sorrel_01_d | ground cover | `Props/shrub_sorrel_01_1k.fbx` | 0.05 m | 990 to 64 | 1 |
| shrub_sorrel_01_e | ground cover | `Props/shrub_sorrel_01_1k.fbx` | 0.05 m | 503 to 63 | 1 |
| weed_plant_02_a | ground cover | `Props/weed_plant_02_1k.fbx` | 0.07 m | 1,536 to 64 | 1 |
| weed_plant_02_b | ground cover | `Props/weed_plant_02_1k.fbx` | 0.07 m | 2,273 to 64 | 1 |
| weed_plant_02_c | ground cover | `Props/weed_plant_02_1k.fbx` | 0.05 m | 1,766 to 148 | 1 |
| weed_plant_02_d | ground cover | `Props/weed_plant_02_1k.fbx` | 0.04 m | 1,928 to 63 | 1 |
| weed_plant_02_e | ground cover | `Props/weed_plant_02_1k.fbx` | 0.04 m | 2,182 to 64 | 1 |
| boulder_01 | rock | `Props/boulder_01_1k.fbx` | 1.00 m | 8,264 to 64 | 1 |
| rock_07 | rock | `Props/rock_07_1k.fbx` | 0.14 m | 3,710 to 80 | 1 |
| rock_moss_set_01_rock01 | rock | `Props/rock_moss_set_01_1k.fbx` | 1.47 m | 5,758 to 142 | 1 |
| rock_moss_set_01_rock02 | rock | `Props/rock_moss_set_01_1k.fbx` | 1.26 m | 5,758 to 64 | 1 |
| rock_moss_set_01_rock03 | rock | `Props/rock_moss_set_01_1k.fbx` | 1.10 m | 5,000 to 64 | 1 |
| rock_moss_set_01_rock04 | rock | `Props/rock_moss_set_01_1k.fbx` | 1.77 m | 5,438 to 80 | 1 |
| rock_moss_set_01_rock05 | rock | `Props/rock_moss_set_01_1k.fbx` | 1.21 m | 8,702 to 64 | 1 |
| rock_moss_set_01_rock06 | rock | `Props/rock_moss_set_01_1k.fbx` | 1.26 m | 8,994 to 64 | 1 |
| rock_moss_set_02_rock07 | rock | `Props/rock_moss_set_02_1k.fbx` | 0.74 m | 9,826 to 64 | 1 |
| rock_moss_set_02_rock08 | rock | `Props/rock_moss_set_02_1k.fbx` | 0.53 m | 8,000 to 64 | 1 |
| rock_moss_set_02_rock09 | rock | `Props/rock_moss_set_02_1k.fbx` | 0.61 m | 7,894 to 64 | 1 |
| rock_moss_set_02_rock10 | rock | `Props/rock_moss_set_02_1k.fbx` | 0.77 m | 8,000 to 64 | 1 |
| rock_moss_set_02_rock11 | rock | `Props/rock_moss_set_02_1k.fbx` | 1.31 m | 8,000 to 64 | 1 |
| rock_moss_set_02_rock12 | rock | `Props/rock_moss_set_02_1k.fbx` | 0.74 m | 7,999 to 64 | 1 |
| rock_moss_set_02_rock13 | rock | `Props/rock_moss_set_02_1k.fbx` | 1.26 m | 7,928 to 64 | 1 |
| bridge_wood | structure | `Props/bridge_wood.fbx` | 1.60 m | 220 | 3 |
| path_wood | structure | `Props/path_wood.fbx` | 0.10 m | 60 | 2 |
| statue_obelisk | structure | `Props/statue_obelisk.fbx` | 2.19 m | 38 | 2 |
| fir_sapling_medium_a | tree | `Props/fir_sapling_medium_a_cut.fbx` | 8.88 m | 48,937 to 374 | 2 |
| fir_sapling_medium_b | tree | `Props/fir_sapling_medium_b_cut.fbx` | 7.82 m | 45,430 to 369 | 2 |
| fir_sapling_medium_c | tree | `Props/fir_sapling_medium_c_cut.fbx` | 5.96 m | 45,556 to 368 | 2 |
| fir_tree_01_a | tree | `Props/fir_tree_01_a_cut.fbx` | 19.03 m | 57,964 to 418 | 3 |
| fir_tree_01_b | tree | `Props/fir_tree_01_b_cut.fbx` | 14.08 m | 58,031 to 417 | 3 |
| island_tree_01 | tree | `Props/island_tree_01_cut.fbx` | 5.05 m | 58,998 to 429 | 3 |
| jacaranda_tree | tree | `Props/jacaranda_tree_cut.fbx` | 19.48 m | 59,620 to 452 | 3 |
| tree_small_02 | tree | `Props/tree_small_02_cut.fbx` | 4.58 m | 58,999 to 429 | 3 |

## Audio (Ogg Vorbis)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Audio/meadow_songbirds_loop.ogg` | <https://freesound.org/people/DreamSavvyr/sounds/781115/> | DreamSavvyr | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | Ambient bed, meadow (PRD 5.12.1); seamless stereo loop, 60.0 s |
| `Audio/river_splashy_loop.ogg` | <https://freesound.org/people/loopo/sounds/164039/> | loopo | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-10 | River spatial emitter (PRD 5.12.3); seamless mono loop, 9.8 s |
| `Audio/lake_lapping_loop.ogg` | <https://freesound.org/people/laughatlantic/sounds/528067/> | laughatlantic | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-16 | Lake and pond spatial emitter (PRD 5.12.3); mono, 22.6 s, looped with a crossfade in code |

## Notes

- **Cooked size.** 229.9 MB on 2026-10-16 (DEC-1005, at `000732c`), against PRD 7.2's 250 MB for a
  kit at the photographic standard: textures 178.7 MB, meshes 49.4 MB, audio 1.6 MB. It was
  231.9 MB on 2026-10-13: leg 2 retired the first slice's ten flat models, `leafy_grass` and the
  `meadow` layer, and added the lake's loop. It is what the assets under this folder take in a
  macOS player's data, summed by the build from its own report (`Build: cooked by owner`,
  `unity/Eternities/README.md`). A megabyte there is 1,048,576 bytes, as in Unity's own build
  report; in megabytes of a million bytes the kit is 241.1. The figures below are the 2026-10-13
  build's. A normal or
  mask map cooks to a byte a texel and a third more for its smaller levels: 1.3 MB at 1K in that
  build, so 5.3 MB at 2K. A 2K colour cooks to 2.7 MB. So the 24 normal and mask maps that are
  2K files are imported at 1K (`maxTextureSize` in their `.meta`), and a colour stays at its
  file's size. With the 24 at 2K the kit would be about 96 MB more, which is over its row; that
  figure is the sum and was not built. A scan's photograph (`_diff_scan.jpg`) is imported at 1K,
  as every plant's photograph here is: at 2K the three cooked to 2.7 MB each, and the kit to
  237.9 MB.
- **Size.** The kit's sources are 190 files and 235.6 MB (2026-10-16; 202 files and 250.5 MB
  before leg 2 retired the first slice's flat models and ground). `fetch.sh` holds a model and a texture
  to 8 MB each and the kit's sources to 300 MB, the proposal on DEC-1003; the first
  slice's subset of 24 files and 39.2 MB was under DEC-952's limits of 200 KB a prop, 8 MB a
  texture and 60 MB in all. The cooked size against PRD 7.2 is the build's check (PRD 8.7.2), not
  this one.
- **Textures are JPG.** At 2K only Poly Haven's JPG stays under 8 MB per texture (the PNG albedo is
  23 MB, the EXR normal 11 MB). PRD 8.2.3's Git LFS list has no `*.jpg`; `.gitattributes` carries
  the pattern for `unity/`. `nor_gl` is the OpenGL normal convention, which Unity uses. `arm` packs
  ambient occlusion, roughness and metalness; `Assets/Editor/KitMaskImport.cs` repacks it into the
  HDRP mask map as it is imported (smoothness is one minus roughness), so an `arm` texture is
  assigned as a mask map as it is.
- **The structures are the FBX members** of Kenney's Nature Kit 2.1 archive, not their GLB twins:
  Unity imports FBX without a package, and glTF needs one that PRD 9.5's pinned list does not
  carry. They are ASCII FBX 7.3 with flat colour materials and no textures, modelled in kit units,
  so each prefab sets its own scale and its HDRP material: `KitPrefabs` makes it once. The obelisk,
  the path boards and the bridge are drawn by nothing yet: where water crosses the trail, leg 2's
  dressing makes a ford of the ground itself (PRD v4 5.4.11), and the stones are leg 2's third pull
  request's. Being text, they carry trailing whitespace: the repository's `trailing-whitespace` and
  `end-of-file-fixer` hooks must exclude them, or a commit rewrites the bytes these checksums pin.
- **Audio files are Freesound's high-quality Ogg previews** of the two CC0 sounds; the uploads (a
  24-bit WAV and an 88 kbps Ogg) need a Freesound login to download. Decoded, the meadow loop is
  stereo, 44.1 kHz, 2,646,000 frames (60.000 s) and the river loop mono, 44.1 kHz, 433,431 frames
  (9.828 s), which are the uploads' published durations. In both, the step from the last sample to
  the first is inside the file's ordinary sample-to-sample range and neither end fades. Nobody has
  listened to them in a loop yet; that is the slice's check.
- **Ground from ambientCG** (`ground037`) is its 1K files: at 2K its colour is 8.7 MB and its
  normal map 10.3 MB, over the cap. ambientCG publishes roughness and ambient occlusion as two
  files and no `arm`; `KitMaskImport` packs the mask from `_rough_` with `_ao_` beside it. The
  files are members of ambientCG's archive under the kit's own names.
- **Not chosen.** ambientCG's grass (`Grass001` to `Grass008`): its own listing gives their
  technique as procedural, so they are not photographs; and `Grass004`'s 2K normal map is 10.0 MB.
  Freesound 817163 (a mono river loop): its page describes a transfer of 1930s to 1960s studio
  effects, so the CC0 dedication could not be traced to the recording's owner.
