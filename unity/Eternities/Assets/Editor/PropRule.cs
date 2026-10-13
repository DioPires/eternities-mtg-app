using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    public enum PropCategory { Tree, Bush, GroundCover, Rock, Structure }

    // The prop conditioning rule (DEC-1003; `unity/Eternities/README.md` states it). A kit prop is
    // one prefab under its kit's `Prefabs/<category>/`: in metres, with its base at its origin,
    // inside its category's caps. `PropRuleTests` holds every prop of every kit to it, so a prop
    // outside the rule turns `unity-editmode` red.
    //
    // The caps are the proposal of 2026-10-12 on DEC-1003, from the measured figures of the
    // candidate models; the owner sets them from PRD v4 7.2's kit rows.
    public static class PropRule
    {
        public sealed class Cap
        {
            public int Triangles;               // at the nearest level the prefab draws
            public int Materials;
            public float HeightFrom, HeightTo;  // metres
            public float Sink;                  // the share of its height that may stand under its base
        }

        public static readonly IReadOnlyDictionary<PropCategory, Cap> Caps = new Dictionary<PropCategory, Cap>
        {
            [PropCategory.Tree] = new Cap { Triangles = 60000, Materials = 3, HeightFrom = 2.5f, HeightTo = 30, Sink = 0.05f },
            [PropCategory.Bush] = new Cap { Triangles = 10000, Materials = 3, HeightFrom = 0.3f, HeightTo = 3, Sink = 0.1f },
            // A tuft a hand high has its roots a finger under the ground.
            [PropCategory.GroundCover] = new Cap { Triangles = 2500, Materials = 1, HeightFrom = 0.02f, HeightTo = 2.5f, Sink = 0.25f },
            // A rock lies in the ground: the photographed ones are modelled with a third of them under it.
            [PropCategory.Rock] = new Cap { Triangles = 10000, Materials = 1, HeightFrom = 0.05f, HeightTo = 5, Sink = 0.45f },
            [PropCategory.Structure] = new Cap { Triangles = 5000, Materials = 3, HeightFrom = 0.05f, HeightTo = 12, Sink = 0.15f },
        };

        // A category's folder under a kit's `Prefabs/`.
        public static readonly IReadOnlyDictionary<string, PropCategory> Folders = new Dictionary<string, PropCategory>
        {
            ["Trees"] = PropCategory.Tree, ["Bushes"] = PropCategory.Bush, ["GroundCover"] = PropCategory.GroundCover,
            ["Rocks"] = PropCategory.Rock, ["Structures"] = PropCategory.Structure,
        };

        // At the `basic` standard a prop of any category has up to this many materials: the flat
        // models of that standard colour a rock's grass cap or a reed's head with a material.
        public const int BasicMaterials = 3;
        // A prop over this many triangles carries lighter levels of detail, and its farthest has at
        // most this share of its nearest's.
        public const int LevelsFrom = 2000;
        public const float FarthestShare = 0.1f;
        // What a build carries for a prop, whichever level is drawn: the triangles of its meshes.
        public const int Shipped = 150000;
        // No point of a prop is more than this over its base, in metres.
        public const float Over = 0.01f;
        // At the `photographic` standard a model is in real metres and is drawn at about its own
        // size. The trial of DEC-953 drew stones of 7 to 30 cm at 2 to 3 m.
        public const float DrawnFrom = 0.5f, DrawnTo = 2;
        // The trial's leaves were given a thickness of 0.25, a quarter of HDRP's own, and its far
        // trees stood pale against the sun.
        public const float ThinnestLeaf = 0.5f;
        // A cut tree's leaves are cards that carry the round crown's normal on both faces, and
        // not their own. With the photograph's gloss on them a crown shines as one mirror: the
        // first wood of DEC-1003 stood silver against the sun. So such a card has no gloss.
        public const float CrownGloss = 0;

        public const string Basic = "basic", Photographic = "photographic";

        // What the rule reads off a prefab.
        public sealed class Measure
        {
            public Bounds Bounds;       // in the prefab's own space: metres, when its root keeps the rule
            public int Nearest, Farthest, Shipped, Materials;
            public float Height => Bounds.size.y;
        }

        // A kit's standard (PRD v4 8.12.6), which its `CREDITS.md` states above its first table
        // until `kits.yaml` exists.
        public static string Standard(string kitFolder)
        {
            string credits = File.ReadAllText($"{kitFolder}/CREDITS.md");
            int tables = credits.IndexOf("\n## ", System.StringComparison.Ordinal);
            Match stated = Regex.Match(tables < 0 ? credits : credits.Substring(0, tables), @"standard: (\w+)");
            if (!stated.Success || (stated.Groups[1].Value != Basic && stated.Groups[1].Value != Photographic))
            {
                throw new InvalidDataException($"{kitFolder}/CREDITS.md does not state the kit's standard above its first table: `standard: {Basic}` or `standard: {Photographic}`");
            }
            return stated.Groups[1].Value;
        }

        // A prop's standard: its kit's, but for the first slice's flat models of trees, bushes, rocks
        // and wheat, which the first slice's scatter of Dominaria draws (`Temperate.Kinds`). Those
        // are held at the basic standard until the dressing of regions with the kit's variants
        // replaces that scatter (PRD v4 9.6, leg 2). No variant grows them (`VariantTests`).
        public static string Standard(string kitFolder, string path)
        {
            string standard = Standard(kitFolder);
            bool scattered = kitFolder == "Assets/Kits/temperate"
                && Eternities.Kits.Temperate.Kinds.Any(kind => KitPrefabs.Path("temperate", kind.Prefab) == path);
            return standard == Photographic && scattered ? Basic : standard;
        }

        // Every prop prefab of every kit, with its kit's folder.
        public static IEnumerable<(string Kit, string Path)> Props()
        {
            foreach (string guid in AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/Kits" }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                Match under = Regex.Match(path, @"^(Assets/Kits/[^/]+)/Prefabs/");
                if (under.Success)
                {
                    yield return (under.Groups[1].Value, path);
                }
            }
        }

        // The category a prefab's folder gives it, or null.
        public static PropCategory? Category(string path)
        {
            Match under = Regex.Match(path, @"/Prefabs/([^/]+)/[^/]+\.prefab$");
            return under.Success && Folders.TryGetValue(under.Groups[1].Value, out PropCategory category) ? category : (PropCategory?)null;
        }

        static int Triangles(Mesh mesh, int level) => Enumerable.Range(0, mesh.subMeshCount).Sum(sub => (int)mesh.GetLod(sub, level).indexCount) / 3;

        // The first and the last level of its mesh that a renderer draws. The importer's levels are
        // in the mesh (`generateMeshLods` in the model's `.meta`); a renderer starts further down
        // with a whole `meshLodSelectionBias`, or draws one level only with `forceMeshLod`.
        static (int first, int last) Levels(MeshRenderer renderer, Mesh mesh)
        {
            int last = mesh.lodCount - 1;
            if (renderer.forceMeshLod >= 0)
            {
                int forced = Mathf.Min(renderer.forceMeshLod, last);
                return (forced, forced);
            }
            return (Mathf.Clamp(Mathf.FloorToInt(renderer.meshLodSelectionBias), 0, last), last);
        }

        static IEnumerable<(MeshRenderer renderer, Mesh mesh)> Drawn(IEnumerable<Renderer> renderers) =>
            renderers.OfType<MeshRenderer>().Select(renderer => (renderer, renderer.GetComponent<MeshFilter>()?.sharedMesh)).Where(drawn => drawn.Item2 != null);

        public static Measure Of(GameObject prefab)
        {
            var levels = prefab.GetComponent<LODGroup>();
            Renderer[] all = prefab.GetComponentsInChildren<Renderer>();
            Renderer[] near = levels != null ? levels.GetLODs().First().renderers : all;
            Renderer[] far = levels != null ? levels.GetLODs().Last().renderers : all;
            var measure = new Measure
            {
                Nearest = Drawn(near).Sum(drawn => Triangles(drawn.mesh, Levels(drawn.renderer, drawn.mesh).first)),
                Farthest = Drawn(far).Sum(drawn => Triangles(drawn.mesh, Levels(drawn.renderer, drawn.mesh).last)),
                Shipped = Drawn(all).Select(drawn => drawn.mesh).Distinct().Sum(mesh => Triangles(mesh, 0)),
                Materials = Drawn(near).Sum(drawn => drawn.renderer.sharedMaterials.Length),
            };
            // Every vertex of the nearest level, where it stands in the prefab.
            bool any = false;
            foreach ((MeshRenderer renderer, Mesh mesh) in Drawn(near))
            {
                Matrix4x4 place = prefab.transform.worldToLocalMatrix * renderer.transform.localToWorldMatrix;
                foreach (Vector3 vertex in mesh.vertices)
                {
                    Vector3 at = place.MultiplyPoint3x4(vertex);
                    if (!any)
                    {
                        measure.Bounds = new Bounds(at, Vector3.zero);
                        any = true;
                    }
                    measure.Bounds.Encapsulate(at);
                }
            }
            return measure;
        }

        // What of the rule a prefab breaks, each in a sentence; nothing, if it keeps it. `kit` is the
        // folder whose `Props/` and `Terrain/` hold the files `fetch.sh` checks against their sources.
        public static List<string> Violations(GameObject prefab, PropCategory category, string standard, string kit)
        {
            var broken = new List<string>();
            Cap cap = Caps[category];
            Transform root = prefab.transform;
            if (root.localScale != Vector3.one || root.localRotation != Quaternion.identity)
            {
                broken.Add($"its root is scaled {root.localScale} and turned {root.localEulerAngles}: a prop's root is as it is in the world, at scale 1 and unturned");
            }
            var drawn = Drawn(prefab.GetComponentsInChildren<Renderer>()).ToList();
            if (drawn.Count == 0)
            {
                broken.Add("it draws no mesh");
                return broken;
            }
            foreach ((MeshRenderer renderer, Mesh mesh) in drawn)
            {
                Vector3 scale = renderer.transform.lossyScale;
                if (Mathf.Abs(scale.x - scale.y) > 1e-4f * scale.x || Mathf.Abs(scale.x - scale.z) > 1e-4f * scale.x)
                {
                    broken.Add($"{renderer.name} is scaled {scale}: not the same along every axis");
                }
                if (renderer.sharedMaterials.Length != mesh.subMeshCount || renderer.sharedMaterials.Any(material => material == null))
                {
                    broken.Add($"{renderer.name} has {renderer.sharedMaterials.Count(material => material != null)} materials for {mesh.subMeshCount} parts of its mesh");
                }
            }

            Measure measure = Of(prefab);
            if (measure.Height < cap.HeightFrom || measure.Height > cap.HeightTo)
            {
                broken.Add($"it is {measure.Height:F2} m tall: a {category} is {cap.HeightFrom} to {cap.HeightTo} m");
            }
            Vector3 low = measure.Bounds.min, high = measure.Bounds.max;
            if (low.y > Over)
            {
                broken.Add($"it stands {low.y:F2} m over its base");
            }
            if (-low.y > cap.Sink * measure.Height + 1e-4f)
            {
                broken.Add($"{-low.y:F2} m of its {measure.Height:F2} m are under its base: a {category} has at most {cap.Sink:P0} of its height there");
            }
            if (low.x > 0 || high.x < 0 || low.z > 0 || high.z < 0)
            {
                broken.Add($"its base is not under it: it reaches from ({low.x:F2}, {low.z:F2}) to ({high.x:F2}, {high.z:F2}) on the ground");
            }

            if (measure.Nearest > cap.Triangles)
            {
                broken.Add($"its nearest level has {measure.Nearest} triangles: a {category} has at most {cap.Triangles}");
            }
            int materials = standard == Basic ? BasicMaterials : cap.Materials;
            if (measure.Materials > materials)
            {
                broken.Add($"it has {measure.Materials} materials: a {category} at the {standard} standard has at most {materials}");
            }
            if (measure.Nearest > LevelsFrom && measure.Farthest > FarthestShare * measure.Nearest)
            {
                broken.Add($"its farthest level has {measure.Farthest} triangles of its nearest's {measure.Nearest}: a prop over {LevelsFrom} carries levels down to {FarthestShare:P0}");
            }
            if (measure.Shipped > Shipped)
            {
                broken.Add($"its meshes hold {measure.Shipped} triangles: a build carries at most {Shipped} for a prop");
            }
            var levels = prefab.GetComponent<LODGroup>();
            if (levels != null)
            {
                var nearest = new HashSet<Material>(levels.GetLODs().First().renderers.SelectMany(renderer => renderer.sharedMaterials));
                if (levels.GetLODs().Skip(1).SelectMany(level => level.renderers).SelectMany(renderer => renderer.sharedMaterials).Any(material => !nearest.Contains(material)))
                {
                    broken.Add("a farther level has a material its nearest level has not: every level is lit as the nearest is");
                }
            }

            if (standard == Photographic && category != PropCategory.Structure)
            {
                foreach ((MeshRenderer renderer, Mesh mesh) in drawn)
                {
                    float against = Against(renderer, mesh, broken);
                    if (against < DrawnFrom || against > DrawnTo)
                    {
                        broken.Add($"{renderer.name} is drawn at {against:F1} times the size its file gives it: a photographic model is drawn at {DrawnFrom} to {DrawnTo} times");
                    }
                }
                foreach (Material material in drawn.SelectMany(one => one.renderer.sharedMaterials).Where(one => one != null).Distinct())
                {
                    Photograph(material, kit, broken);
                }
            }
            return broken;
        }

        // How large a prefab draws its meshes against the size their files give them: the least
        // and the most of them. A variant grows a prop at a share of its prefab, and the rule's
        // `DrawnFrom` to `DrawnTo` holds the two together (`VariantTests`).
        public static (float Least, float Most) Against(GameObject prefab)
        {
            var broken = new List<string>();
            float[] each = Drawn(prefab.GetComponentsInChildren<Renderer>()).Select(drawn => Against(drawn.renderer, drawn.mesh, broken)).ToArray();
            return (each.Min(), each.Max());
        }

        // How large a renderer draws its mesh against the size the mesh has in its own file.
        static float Against(MeshRenderer renderer, Mesh mesh, List<string> broken)
        {
            float drawn = renderer.transform.lossyScale.x;
            string file = AssetDatabase.GetAssetPath(mesh);
            if (!(AssetImporter.GetAtPath(file) is ModelImporter importer))
            {
                return drawn;
            }
            if (!importer.useFileScale || importer.globalScale != 1)
            {
                broken.Add($"{file} is not imported at its file's own scale: `useFileScale` on and `globalScale` 1");
            }
            MeshFilter theirs = AssetDatabase.LoadAssetAtPath<GameObject>(file).GetComponentsInChildren<MeshFilter>(true).First(filter => filter.sharedMesh == mesh);
            return drawn / theirs.transform.lossyScale.x;
        }

        // A photographic prop's colour is its photograph's: a file `fetch.sh` checks against its
        // source, read as a colour, with no tint over it. The trial of DEC-953 wrote a leaf's
        // photograph out again and several times too dark.
        static void Photograph(Material material, string kit, List<string> broken)
        {
            Texture colour = material.HasProperty("_BaseColorMap") ? material.GetTexture("_BaseColorMap") : null;
            string file = colour == null ? null : AssetDatabase.GetAssetPath(colour);
            if (file == null || !(file.StartsWith($"{kit}/Props/") || file.StartsWith($"{kit}/Terrain/")))
            {
                broken.Add($"the material {material.name} has no photograph for its colour: a file under the kit's `Props/` or `Terrain/`, as downloaded");
            }
            else if (AssetImporter.GetAtPath(file) is TextureImporter importer && !importer.sRGBTexture)
            {
                broken.Add($"{file} is not read as a colour: `sRGBTexture` on");
            }
            Color tint = material.GetColor("_BaseColor");
            if (Mathf.Min(tint.r, tint.g, tint.b) < 0.98f || Mathf.Max(tint.r, tint.g, tint.b) > 1)
            {
                broken.Add($"the material {material.name} tints its photograph {tint}: the colour is the photograph's");
            }
            Texture normal = material.HasProperty("_NormalMap") ? material.GetTexture("_NormalMap") : null;
            if (normal != null && AssetImporter.GetAtPath(AssetDatabase.GetAssetPath(normal)) is TextureImporter normals && normals.textureType != TextureImporterType.NormalMap)
            {
                broken.Add($"{AssetDatabase.GetAssetPath(normal)} is the material {material.name}'s normal map and is not imported as one");
            }
            // HDRP's material type 5 is the translucent one: light passes through it.
            if (material.HasProperty("_MaterialID") && material.GetFloat("_MaterialID") == 5 && material.GetFloat("_Thickness") < ThinnestLeaf)
            {
                broken.Add($"the material {material.name} lets light through a thickness of {material.GetFloat("_Thickness")}: at least {ThinnestLeaf}");
            }
            // Double-sided normal mode 2 is "none": both faces are lit by the mesh's normal.
            if (material.HasProperty("_DoubleSidedNormalMode") && material.GetFloat("_DoubleSidedEnable") == 1 && material.GetFloat("_DoubleSidedNormalMode") == 2
                && material.GetFloat("_SmoothnessRemapMax") > CrownGloss)
            {
                broken.Add($"the material {material.name} is lit by its crown's normal on both faces with a gloss of up to {material.GetFloat("_SmoothnessRemapMax")}: at most {CrownGloss}");
            }
        }

        // A kit's props as its `CREDITS.md` lists them under "Props as drawn": one row a prefab,
        // with the height and the triangles measured here.
        public static string CreditsRow(string path)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            Measure measure = Of(prefab);
            string[] models = Drawn(prefab.GetComponentsInChildren<Renderer>()).Select(one => AssetDatabase.GetAssetPath(one.mesh)).Distinct()
                .Select(file => $"`{Regex.Replace(file, @"^Assets/Kits/[^/]+/", "")}`").ToArray();
            string levels = measure.Farthest == measure.Nearest ? $"{measure.Nearest:N0}" : $"{measure.Nearest:N0} to {measure.Farthest:N0}";
            string category = Regex.Replace(Category(path).ToString(), "(?<=[a-z])(?=[A-Z])", " ").ToLowerInvariant();
            return $"| {Path.GetFileNameWithoutExtension(path)} | {category} | {string.Join(", ", models)} | {measure.Height:F2} m | {levels} | {measure.Materials} |";
        }

        // The rows to put in a kit's `CREDITS.md`, in the Console, for whoever adds a prop. From the
        // command line: `batchmode.sh -quit -executeMethod Eternities.EditorTools.PropRule.Print`.
        [MenuItem("Eternities/Kit props as drawn")]
        public static void Print()
        {
            Debug.Log("Props as drawn\n" + string.Join("\n", Props().Select(prop => CreditsRow(prop.Path))));
        }
    }
}
