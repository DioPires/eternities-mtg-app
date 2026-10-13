using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    // A kit's prop prefabs (the prop conditioning rule, `PropRule`): one prefab a prop, under the
    // kit's `Prefabs/<category>/`, made once from its model and then left alone, as the kit's
    // materials, layers and water are. The prefab is where a model becomes a prop: it gives the
    // model its size in metres and puts the prop's base at its origin, and nothing else in the
    // project reads a model file.
    public static class KitPrefabs
    {
        public sealed class Source
        {
            public string Prefab;       // under the kit's `Prefabs/`, without its extension: its category's folder and its name
            public string Model;        // the file under the kit's `Props/`
            public string Mesh;         // which of the file's meshes, for a file that holds several
            public float Metres = 1;    // how large the prop is against its file: 1 for a model in real metres
            // The share of its height that stands under its base. Without one, the mesh's own origin
            // is the base: where its maker stood it on the ground.
            public float? Sink;
            // A photographic model: each of its materials is drawn with its own photographs, the
            // files `<material>_diff_<size>.jpg`, `_nor_gl_` and `_arm_` beside the model, or the
            // model's own where a material has none; and the importer makes its levels of detail.
            public string Photographs;  // the size of the photographs, "1k" or "2k"; null for a model of flat colours
            public bool Leaves;         // cut out by the photograph's opacity, and lit from both sides and through
            public int From;            // the level of detail it is drawn from, for a mesh heavier than its category's cap
            // A model cut to levels of its own (`Derive/cut_tree.py`): its file's meshes
            // `<Mesh>_LOD0` on, the first drawn while the prop takes at least the first share of
            // the view's height and each lighter one down to its own. The importer makes it no
            // levels. Of its materials, the one whose photograph has an opacity file is its leaves.
            public float[] Until;
        }

        // A tree's levels: the nearest while it is a third of the view's height or more, which is
        // within 15 m of a tree 5 m tall, and the farthest to the edge of sight.
        static readonly float[] TreeLevels = { 0.30f, 0.10f, 0.035f, 0.0001f };
        // A bush's three: the nearest within 14 m of a bush 2 m tall.
        static readonly float[] BushLevels = { 0.12f, 0.04f, 0.0001f };

        // The temperate kit's props (`Assets/Kits/temperate/CREDITS.md`). They are Kenney's models,
        // which have no real unit: `Metres` is the middle of the range the first slice drew each
        // at (`Temperate.Kinds`), and for the three it did not draw, a first setting.
        public static readonly Source[] Temperate =
        {
            new Source { Prefab = "Trees/tree_oak", Model = "tree_oak.fbx", Metres = 6.5f },
            new Source { Prefab = "Trees/tree_thin", Model = "tree_thin.fbx", Metres = 5.75f },
            new Source { Prefab = "Trees/tree_pineTallA", Model = "tree_pineTallA.fbx", Metres = 6.5f },
            new Source { Prefab = "Bushes/plant_bush", Model = "plant_bush.fbx", Metres = 4.25f },
            new Source { Prefab = "Bushes/plant_bushLarge", Model = "plant_bushLarge.fbx", Metres = 6 },
            new Source { Prefab = "Rocks/rock_largeA", Model = "rock_largeA.fbx", Metres = 2.5f },
            new Source { Prefab = "Rocks/stone_largeB", Model = "stone_largeB.fbx", Metres = 2.5f },
            new Source { Prefab = "Rocks/stone_smallFlatA", Model = "stone_smallFlatA.fbx", Metres = 2.75f },
            new Source { Prefab = "Rocks/stone_tallD", Model = "stone_tallD.fbx", Metres = 3 },
            new Source { Prefab = "GroundCover/crops_wheatStageB", Model = "crops_wheatStageB.fbx", Metres = 2.6f },
            new Source { Prefab = "Structures/statue_obelisk", Model = "statue_obelisk.fbx", Metres = 2.5f },
            new Source { Prefab = "Structures/path_wood", Model = "path_wood.fbx", Metres = 2 },
            new Source { Prefab = "Structures/bridge_wood", Model = "bridge_wood.fbx", Metres = 4 },
        };

        // The temperate kit's photographic props (PRD v4 8.12.1; DEC-1003), from Poly Haven. A file
        // holds several rocks or plants, and each is a prop.
        public static readonly Source[] TemperatePhotographs = new[]
        {
            // Four of the six are over a rock's cap as their file has them, and are drawn from their
            // second level. Two lie deeper in the ground in their files than a rock may: 40% here.
            Photographs("Rocks", "rock_moss_set_01", "2k", false, 0, "rock03", "rock06"),
            Photographs("Rocks", "rock_moss_set_01", "2k", false, 1, "rock01", "rock02", "rock04"),
            Photographs("Rocks", "rock_moss_set_01", "2k", false, 1, "rock05").Select(rock => { rock.Sink = 0.4f; return rock; }),
            Photographs("Rocks", "rock_moss_set_02", "2k", false, 0, "rock07", "rock08", "rock09", "rock10", "rock11", "rock12"),
            Photographs("Rocks", "rock_moss_set_02", "2k", false, 0, "rock13").Select(rock => { rock.Sink = 0.4f; return rock; }),
            Photographs("Rocks", "boulder_01", "2k", false, 0, "LOD3"),
            // Thin stems a metre tall, which its source calls ground cover: undergrowth, not a bush.
            Photographs("GroundCover", "shrub_02", "1k", true, 2, "a_LOD0", "b_LOD0", "c_LOD0", "d_LOD0"),
            Photographs("GroundCover", "fern_02", "1k", true, 0, "a", "b", "c", "d"),
            Photographs("GroundCover", "grass_medium_01", "1k", true, 0, "mid_a_LOD0", "mid_b_LOD0", "mid_c_LOD0", "small_a_LOD0", "small_b_LOD0", "tall_a_LOD0", "tall_b_LOD0", "tall_c_LOD0"),
            Photographs("GroundCover", "grass_medium_02", "1k", true, 0, "a", "b", "c", "d", "e"),
            Photographs("GroundCover", "celandine_01", "1k", true, 0, "a_LOD0", "b_LOD0", "e_LOD0"),
            Photographs("GroundCover", "dandelion_01", "1k", true, 0, "a_LOD1", "b_LOD1", "c_LOD1", "d_LOD1", "e_LOD1"),
            // The second batch: more species for the floor of a wood and for wet and for stony
            // ground. A plant over ground cover's cap is drawn from a lighter level.
            Photographs("GroundCover", "shrub_03", "1k", true, 0, "a_LOD0", "b_LOD0", "c_LOD0", "d_LOD0"),
            Photographs("GroundCover", "weed_plant_02", "1k", true, 1, "a_LOD0"),
            Photographs("GroundCover", "weed_plant_02", "1k", true, 0, "b_LOD0", "c_LOD0", "d_LOD0", "e_LOD0"),
            Photographs("GroundCover", "shrub_sorrel_01", "1k", true, 0, "a", "b", "d", "e"),
            Photographs("GroundCover", "nettle_plant", "1k", true, 2, "medium_a_LOD0", "medium_b_LOD0", "tall_a_LOD0", "tall_b_LOD0"),
            // A fallen branch lies about its file's origin, and here on the ground.
            Photographs("GroundCover", "dry_branches_medium_01", "1k", false, 2, "a", "b", "c").Select(branch => { branch.Sink = 0.05f; return branch; }),
            Photographs("Rocks", "rock_07", "1k", false, 0, "LOD2"),
            // Trees. Each is its source cut to four levels by `Derive/cut_tree.py` (PRD v4 7.6.4):
            // as published it is one mesh of one to four million triangles.
            Cut("Trees", "jacaranda_tree", TreeLevels),
            Cut("Trees", "tree_small_02", TreeLevels),
            Cut("Trees", "island_tree_01", TreeLevels),
            // Firs, cut by `Derive/cut_fir.py`: two tall ones of one source and three young ones
            // of another. A fir's needles become cards that show the sprays its source photographed.
            Cut("Trees", "fir_tree_01_a", TreeLevels),
            Cut("Trees", "fir_tree_01_b", TreeLevels),
            Cut("Trees", "fir_sapling_medium_a", TreeLevels),
            Cut("Trees", "fir_sapling_medium_b", TreeLevels),
            Cut("Trees", "fir_sapling_medium_c", TreeLevels),
            // Bushes: seven of one source, and a small tree of 3.4 m that stands as a shrub at six
            // tenths of its size. No source has a second leafy bush.
            Cut("Bushes", "searsia_lucida_a", BushLevels),
            Cut("Bushes", "searsia_lucida_b", BushLevels),
            Cut("Bushes", "searsia_lucida_c", BushLevels),
            Cut("Bushes", "searsia_lucida_d", BushLevels),
            Cut("Bushes", "searsia_lucida_e", BushLevels),
            Cut("Bushes", "searsia_lucida_f", BushLevels),
            Cut("Bushes", "searsia_lucida_g", BushLevels),
            Cut("Bushes", "island_tree_02", BushLevels, 0.6f),
        }.SelectMany(some => some).ToArray();

        // Props of one file: the meshes named, each `<asset>_<mesh>` in the file, as the prefab
        // `<category>/<asset>_<mesh>` without a mesh's `_LOD` ending.
        static IEnumerable<Source> Photographs(string category, string asset, string size, bool leaves, int from, params string[] meshes) =>
            meshes.Select(mesh => new Source
            {
                Prefab = $"{category}/{asset}_{System.Text.RegularExpressions.Regex.Replace(mesh, "_?LOD\\d$", "")}".TrimEnd('_'),
                Model = $"{asset}_1k.fbx", Mesh = $"{asset}_{mesh}", Photographs = size, Leaves = leaves, From = from,
            });

        // A prop cut from its source: the kit's `<asset>_cut.fbx`, drawn with the source's
        // photographs at 1K, at its file's size or at a share of it.
        static IEnumerable<Source> Cut(string category, string asset, float[] until, float metres = 1) => new[]
        {
            new Source { Prefab = $"{category}/{asset}", Model = $"{asset}_cut.fbx", Mesh = asset, Metres = metres, Photographs = "1k", Leaves = true, Until = until },
        };

        // The models' material names (Kenney's Nature Kit), and the temperate kit's colour for each:
        // Dominaria's greens, ochre and slate (PRD v4 Appendix C). The models' own colours are
        // pastel and are not used.
        static readonly Dictionary<string, (string name, Color colour)> KitColours = new Dictionary<string, (string, Color)>
        {
            ["leafsGreen"] = ("leaf", new Color(0.23f, 0.38f, 0.14f)),
            ["leafsDark"] = ("leaf-dark", new Color(0.12f, 0.25f, 0.14f)),
            ["woodBark"] = ("bark", new Color(0.33f, 0.25f, 0.17f)),
            ["woodBarkDark"] = ("bark-dark", new Color(0.24f, 0.18f, 0.13f)),
            ["grass"] = ("bush", new Color(0.28f, 0.42f, 0.16f)),
            ["stone"] = ("stone", new Color(0.47f, 0.49f, 0.51f)),
            ["stoneDark"] = ("stone-dark", new Color(0.36f, 0.38f, 0.40f)),
            ["dirt"] = ("earth", new Color(0.50f, 0.41f, 0.27f)),
            ["dirtDark"] = ("earth-dark", new Color(0.38f, 0.31f, 0.21f)),
            ["wood"] = ("wood", new Color(0.40f, 0.29f, 0.18f)),
            ["woodInner"] = ("reed", new Color(0.55f, 0.52f, 0.26f)),
            ["_defaultMat"] = ("pale", new Color(0.70f, 0.67f, 0.50f)),
        };

        public static string Folder(string kit) => $"Assets/Kits/{kit}/Prefabs";

        // How a photographic model is imported, written into its `.meta` once: the levels of detail
        // the importer makes, the file's axes turned into the project's in the mesh itself, so a
        // mesh stands on its own y axis, and none of the file's cameras or lights. The file's
        // materials stay, for their names; nothing draws them. A model cut to levels of its own
        // gets none from the importer.
        static void Condition(string file, bool levels)
        {
            if (!(AssetImporter.GetAtPath(file) is ModelImporter importer))
            {
                return;
            }
            if (importer.generateMeshLods == levels && importer.bakeAxisConversion)
            {
                return;
            }
            importer.generateMeshLods = levels;
            importer.bakeAxisConversion = true;
            importer.importAnimation = false;
            importer.animationType = ModelImporterAnimationType.None;
            importer.importCameras = false;
            importer.importLights = false;
            importer.importBlendShapes = false;
            importer.SaveAndReimport();
        }

        const string FoliageProfile = "Packages/com.unity.render-pipelines.high-definition/Runtime/RenderPipelineResources/FoliageDiffusionProfile.asset";

        // The kit's material for one material of a photographic model: its photograph as the
        // colour, untinted, with its normal map and its mask (`KitMaskImport`). Made once.
        static Material Photographed(string kit, string file, string theirs, Source source)
        {
            string props = $"Assets/Kits/{kit}/Props";
            string ofModel = System.IO.Path.GetFileNameWithoutExtension(file);
            ofModel = ofModel.EndsWith("_1k") ? ofModel.Substring(0, ofModel.Length - 3) : ofModel;
            string named = theirs != null && File.Exists($"{props}/{theirs}_diff_{source.Photographs}.jpg") ? theirs : ofModel;
            string path = $"Assets/Kits/{kit}/Materials/{kit}-{named}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null)
            {
                return material;
            }
            Texture2D Map(string kind)
            {
                string map = $"{props}/{named}_{kind}_{source.Photographs}.jpg";
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(map);
                if (texture == null)
                {
                    throw new InvalidDataException($"the kit's texture {map} is not in the project: run Assets/Kits/{kit}/fetch.sh and git lfs pull");
                }
                return texture;
            }
            string normal = $"{props}/{named}_nor_gl_{source.Photographs}.jpg";
            if (AssetImporter.GetAtPath(normal) is TextureImporter normals && normals.textureType != TextureImporterType.NormalMap)
            {
                normals.textureType = TextureImporterType.NormalMap;
                normals.SaveAndReimport();
            }
            material = new Material(Shader.Find("HDRP/Lit")) { name = $"{kit}-{named}" };
            material.SetTexture("_BaseColorMap", Map("diff"));
            material.SetColor("_BaseColor", Color.white);
            material.SetTexture("_NormalMap", Map("nor_gl"));
            material.SetFloat("_NormalScale", 1);
            material.SetTexture("_MaskMap", Map("arm"));
            // Of a cut model's materials, its leaves are the one with an opacity file; its wood is whole.
            bool leaves = source.Leaves && (source.Until == null || KitAlphaImport.OpacityOf($"{props}/{named}_diff_{source.Photographs}.jpg") != null);
            if (leaves)
            {
                material.SetFloat("_AlphaCutoffEnable", 1);
                material.SetFloat("_AlphaCutoff", KitAlphaImport.Cut);
                material.SetFloat("_DoubleSidedEnable", 1);
                // Mirror: the back of a leaf is lit as its front is. A cut tree's leaves are cards
                // that carry the round crown's normal and not their own, so both faces keep it.
                material.SetFloat("_DoubleSidedNormalMode", source.Until == null ? 1 : 2);
                if (source.Until != null)
                {
                    // With one normal for the whole crown, the photograph's gloss is one mirror.
                    material.SetFloat("_SmoothnessRemapMax", PropRule.CrownGloss);
                }
                // A leaf lets light through: HDRP's translucent material with its own foliage
                // profile, at HDRP's own thickness (`PropRule.ThinnestLeaf`).
                material.SetFloat("_MaterialID", 5);
                material.SetFloat("_TransmissionEnable", 1);
                material.SetFloat("_Thickness", 1);
            }
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            AssetDatabase.CreateAsset(material, path);
            if (leaves)
            {
                // The profile is held beside the material in its file, so the file comes first.
                UnityEngine.Rendering.HighDefinition.HDMaterial.SetDiffusionProfile(material,
                    AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.HighDefinition.DiffusionProfileSettings>(FoliageProfile));
            }
            UnityEngine.Rendering.HighDefinition.HDMaterial.ValidateMaterial(material);
            EditorUtility.SetDirty(material);
            AssetDatabase.SaveAssets();
            return material;
        }

        public static string Path(string kit, string prefab) => $"{Folder(kit)}/{prefab}.prefab";

        // Makes each of a kit's prefabs that is not there yet. A second run changes nothing.
        public static void Make(string kit, Source[] sources)
        {
            foreach (Source source in sources)
            {
                string path = Path(kit, source.Prefab);
                if (AssetDatabase.LoadAssetAtPath<GameObject>(path) != null)
                {
                    continue;
                }
                string file = $"Assets/Kits/{kit}/Props/{source.Model}";
                if (source.Photographs != null)
                {
                    Condition(file, levels: source.Until == null);
                }
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(file);
                if (model == null)
                {
                    throw new InvalidDataException($"the kit's prop {file} is not in the project: run Assets/Kits/{kit}/fetch.sh and git lfs pull");
                }
                // One mesh, or one a level for a model cut to levels of its own.
                string[] named = source.Until == null ? new[] { source.Mesh } : source.Until.Select((until, level) => $"{source.Mesh}_LOD{level}").ToArray();
                MeshFilter[] theirs = named.Select(name =>
                {
                    MeshFilter[] found = model.GetComponentsInChildren<MeshFilter>(true).Where(filter => name == null || filter.sharedMesh.name == name).ToArray();
                    if (found.Length != 1)
                    {
                        throw new InvalidDataException($"{file} holds {found.Length} meshes named {name ?? "anything"}, and a prop is one of them");
                    }
                    return found[0];
                }).ToArray();

                var root = new GameObject(System.IO.Path.GetFileName(source.Prefab));
                var levels = new List<LOD>();
                for (int level = 0; level < theirs.Length; level++)
                {
                    var drawn = new GameObject(theirs.Length == 1 ? "Model" : $"LOD{level}");
                    drawn.transform.SetParent(root.transform, false);
                    // The mesh as its file turns and sizes it, times the prop's size against its file's.
                    Quaternion turn = theirs[level].transform.rotation;
                    drawn.transform.localRotation = Quaternion.Angle(turn, Quaternion.identity) < 0.01f ? Quaternion.identity : turn;
                    drawn.transform.localScale = theirs[level].transform.lossyScale * source.Metres;
                    Mesh mesh = theirs[level].sharedMesh;
                    drawn.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var renderer = drawn.AddComponent<MeshRenderer>();
                    renderer.sharedMaterials = theirs[level].GetComponent<MeshRenderer>().sharedMaterials.Select(material =>
                    {
                        if (source.Photographs != null)
                        {
                            return Photographed(kit, file, material == null ? null : material.name, source);
                        }
                        if (!KitColours.TryGetValue(material.name, out (string name, Color colour) ours))
                        {
                            throw new InvalidDataException($"{file} uses the material {material.name}, which the kit has no colour for");
                        }
                        return Generate.Lit($"{kit}-{ours.name}", ours.colour, 0f, 0.15f, $"Assets/Kits/{kit}/Materials");
                    }).ToArray();
                    renderer.meshLodSelectionBias = source.From;
                    // The base: the mesh's own origin, or its lowest point a share of its height under it.
                    if (source.Sink != null)
                    {
                        float lowest = mesh.vertices.Min(vertex => drawn.transform.TransformPoint(vertex).y);
                        float highest = mesh.vertices.Max(vertex => drawn.transform.TransformPoint(vertex).y);
                        drawn.transform.localPosition = new Vector3(0, 0 - lowest - source.Sink.Value * (highest - lowest), 0);
                    }
                    if (source.Until != null)
                    {
                        levels.Add(new LOD(source.Until[level], new Renderer[] { renderer }));
                    }
                }
                if (levels.Count > 0)
                {
                    var group = root.AddComponent<LODGroup>();
                    group.fadeMode = LODFadeMode.None;
                    group.SetLODs(levels.ToArray());
                    group.RecalculateBounds();
                }

                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
                PrefabUtility.SaveAsPrefabAsset(root, path);
                Object.DestroyImmediate(root);
            }
        }
    }
}
