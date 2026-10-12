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
            public float Sink;          // how far its lowest point stands under its base, in metres
        }

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
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(file);
                MeshFilter[] theirs = model == null ? new MeshFilter[0]
                    : model.GetComponentsInChildren<MeshFilter>(true).Where(filter => source.Mesh == null || filter.sharedMesh.name == source.Mesh).ToArray();
                if (theirs.Length != 1)
                {
                    throw new InvalidDataException(model == null ? $"the kit's prop {file} is not in the project: run Assets/Kits/{kit}/fetch.sh and git lfs pull"
                        : $"{file} holds {theirs.Length} meshes named {source.Mesh ?? "anything"}, and a prop is one of them");
                }

                var root = new GameObject(System.IO.Path.GetFileName(source.Prefab));
                var drawn = new GameObject("Model");
                drawn.transform.SetParent(root.transform, false);
                // The mesh as its file turns and sizes it, times the prop's size against its file's.
                Quaternion turn = theirs[0].transform.rotation;
                drawn.transform.localRotation = Quaternion.Angle(turn, Quaternion.identity) < 0.01f ? Quaternion.identity : turn;
                drawn.transform.localScale = theirs[0].transform.lossyScale * source.Metres;
                Mesh mesh = theirs[0].sharedMesh;
                drawn.AddComponent<MeshFilter>().sharedMesh = mesh;
                drawn.AddComponent<MeshRenderer>().sharedMaterials = theirs[0].GetComponent<MeshRenderer>().sharedMaterials.Select(material =>
                {
                    if (!KitColours.TryGetValue(material.name, out (string name, Color colour) ours))
                    {
                        throw new InvalidDataException($"{file} uses the material {material.name}, which the kit has no colour for");
                    }
                    return Generate.Lit($"{kit}-{ours.name}", ours.colour, 0f, 0.15f, $"Assets/Kits/{kit}/Materials");
                }).ToArray();
                // The base: the mesh's own origin on the ground, and its lowest point `Sink` under it.
                // A mesh that stands on its origin to a hundredth of a millimetre stands on it.
                float lowest = mesh.vertices.Min(vertex => drawn.transform.TransformPoint(vertex).y);
                drawn.transform.localPosition = new Vector3(0, 0 - (Mathf.Abs(lowest) < 1e-5f ? 0 : lowest) - source.Sink, 0);

                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
                PrefabUtility.SaveAsPrefabAsset(root, path);
                Object.DestroyImmediate(root);
            }
        }
    }
}
