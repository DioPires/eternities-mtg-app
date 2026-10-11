using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Travel;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace Eternities.EditorTools
{
    // The batchmode scene generation entry point (PRD v4 8.2.5). It makes what the slice needs and an
    // engineer does not write by hand, from the pinned pack and nothing else, so a reviewer
    // reproduces the slice's world from the command line:
    //
    // - not committed: the part of the pack the slice reads, copied from `web/public/data/<hash>/`
    //   to `StreamingAssets/data/<hash>/` with every file checked against the pack's manifest, and
    //   each world's layout beside it, `layout/<slug>.txt` (`WorldFiles.Generate`);
    // - committed: the slice's plain materials under `Assets/Kits/core/Materials/` and
    //   `Assets/Kits/temperate/Materials/`, and the persistent scene, `Assets/Scenes/Hub.unity`.
    //
    // A missing argument or a failure throws, and the editor turns an exception in an
    // `-executeMethod` target into exit code 1.
    public static class Generate
    {
        // The slice has one world (PRD v4 9.5).
        public static readonly string[] Worlds = { "dominaria" };

        public const string HubScene = "Assets/Scenes/Hub.unity";
        const string MaterialFolder = "Assets/Kits/core/Materials";

        public static void Run()
        {
            string reportOut = CommandLine.Optional("-reportOut");
            foreach (WorldFiles.Result world in Everything(CommandLine.Require("-packHash")))
            {
                Debug.Log($"Generate: {world.Layout.Input.PlaneSlug}\n{world.Report}");
                if (reportOut != null)
                {
                    File.WriteAllText(reportOut, world.Report);
                }
            }
        }

        // The same from the editor's menu, for whoever has the project open.
        [MenuItem("Eternities/Generate")]
        static void FromTheMenu()
        {
            foreach (WorldFiles.Result world in Everything(ManifestHash()))
            {
                Debug.Log($"Generate: {world.Layout.Input.PlaneSlug}\n{world.Report}");
            }
        }

        // Everything the entry point makes: each world's files, the slice's materials and the
        // persistent scene. Run again on a tree it has already filled, it changes nothing.
        public static List<WorldFiles.Result> Everything(string packHash)
        {
            if (packHash != ManifestHash())
            {
                throw new InvalidDataException($"the project is pinned to pack {ManifestHash()}, not {packHash}");
            }
            var worlds = new List<WorldFiles.Result>();
            foreach (string slug in Worlds)
            {
                worlds.Add(Build(packHash, slug));
            }
            PersistentScene();
            return worlds;
        }

        // The hash `StreamingAssets/data/manifest.json` names (PRD v4 8.3.1).
        public static string ManifestHash()
        {
            string manifest = File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "data", "manifest.json"));
            return Json.Text(Json.Object(Json.Parse(manifest))["hash"]);
        }

        // The persistent scene (PRD v4 8.4.1): the template's camera, sun and sky, and the one object
        // that builds the rest at run time. The scene is opened and completed, never rebuilt, so the
        // identifiers the editor gave its objects stay and a second run saves nothing.
        public static void PersistentScene()
        {
            Scene scene = EditorSceneManager.OpenScene(HubScene, OpenSceneMode.Single);
            bool changed = false;
            App app = Object.FindAnyObjectByType<App>();
            if (app == null)
            {
                app = new GameObject("Eternities").AddComponent<App>();
                changed = true;
            }
            Material[] stands =
            {
                Lit("plinth-common-stone", new Color(0.46f, 0.45f, 0.43f), 0f, 0.25f),
                Lit("plinth-uncommon-bronze", new Color(0.55f, 0.36f, 0.20f), 0.8f, 0.45f),
                Lit("plinth-rare-silver", new Color(0.72f, 0.73f, 0.75f), 0.9f, 0.6f),
                Lit("plinth-mythic-gold", new Color(0.83f, 0.62f, 0.22f), 0.9f, 0.65f),
                Lit("stand-slab", new Color(0.05f, 0.05f, 0.06f), 0f, 0.3f),
            };
            if (app.StandMaterials == null || !stands.SequenceEqual(app.StandMaterials))
            {
                app.StandMaterials = stands;
                changed = true;
            }
            changed |= Set(Lit("mannequin", new Color(0.78f, 0.76f, 0.72f), 0f, 0.4f), app.AvatarMaterial, m => app.AvatarMaterial = m);
            // Matt: on a ground this wide a smooth one is paid for in screen-space reflections, 5 ms a frame.
            changed |= Set(Lit("hub-floor", new Color(0.09f, 0.09f, 0.12f), 0f, 0.05f), app.HubGroundMaterial, m => app.HubGroundMaterial = m);
            changed |= Set(Lit("portal-frame", new Color(0.12f, 0.11f, 0.10f), 0.6f, 0.5f), app.PortalFrameMaterial, m => app.PortalFrameMaterial = m);
            changed |= Set(Unlit("portal-surface", new Color(0.35f, 0.75f, 1f, 1f), transparent: false), app.PortalSurfaceMaterial, m => app.PortalSurfaceMaterial = m);
            changed |= Set(Unlit("veil", new Color(0, 0, 0, 1), transparent: true), app.VeilMaterial, m => app.VeilMaterial = m);
            changed |= Set(Unlit("image-surface-cutout", Color.white, transparent: false, cutout: true), app.ImageSurfaceMaterial, m => app.ImageSurfaceMaterial = m);
            foreach ((string name, Shader held, System.Action<Shader> assign) in new (string, Shader, System.Action<Shader>)[]
            {
                ("Hidden/Eternities/Exhibit", app.ExhibitShader, shader => app.ExhibitShader = shader),
                ("Hidden/Eternities/ExhibitComposite", app.ExhibitCompositeShader, shader => app.ExhibitCompositeShader = shader),
            })
            {
                Shader shader = Shader.Find(name);
                if (shader == null)
                {
                    throw new InvalidDataException($"the shader {name} is not in the project");
                }
                if (shader != held)
                {
                    assign(shader);
                    changed = true;
                }
            }

            // The overlays' panel settings and the theme they name (PRD v4 8.1.2): two small assets,
            // made once. Everything else of the overlays is code.
            const string uiFolder = "Assets/Kits/core/UI";
            Directory.CreateDirectory(uiFolder);
            if (!File.Exists($"{uiFolder}/Runtime.tss"))
            {
                File.WriteAllText($"{uiFolder}/Runtime.tss", "@import url(\"unity-theme://default\");\n");
                AssetDatabase.ImportAsset($"{uiFolder}/Runtime.tss");
            }
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>($"{uiFolder}/Panel.asset");
            if (panel == null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                panel.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>($"{uiFolder}/Runtime.tss");
                panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
                panel.referenceResolution = new Vector2Int(1920, 1080);
                panel.match = 1;    // by height, so text is the same size on a wide display
                AssetDatabase.CreateAsset(panel, $"{uiFolder}/Panel.asset");
                AssetDatabase.SaveAssets();
            }
            if (panel != app.PanelSettings)
            {
                app.PanelSettings = panel;
                changed = true;
            }

            // The kit's two water prefabs (PRD v4 9.5): made once with the water system's defaults, and
            // then the owner's to tune. A second run leaves them as they are.
            changed |= SetObject(WaterPrefab("River", WaterSurfaceType.River), app.RiverPrefab, prefab => app.RiverPrefab = prefab);
            changed |= SetObject(WaterPrefab("Lake", WaterSurfaceType.OceanSeaLake), app.LakePrefab, prefab => app.LakePrefab = prefab);

            // The kit's props (PRD v4 8.4.2): each kind's mesh from its model, drawn in the kit's own
            // materials, one for each material name the models use.
            KitProp[] props = Temperate.Kinds.Select(ModelOf).ToArray();
            if (app.KitProps == null || app.KitProps.Length != props.Length
                || !props.Zip(app.KitProps, (wanted, held) => held != null && wanted.Mesh == held.Mesh && held.Materials != null && wanted.Materials.SequenceEqual(held.Materials)).All(same => same))
            {
                app.KitProps = props;
                changed = true;
            }

            // The kit's two loops (PRD v4 5.12): the ambient bed and the river.
            foreach ((string file, AudioClip held, System.Action<AudioClip> assign) in new (string, AudioClip, System.Action<AudioClip>)[]
            {
                ("meadow_songbirds_loop", app.AmbientBed, clip => app.AmbientBed = clip),
                ("river_splashy_loop", app.RiverLoop, clip => app.RiverLoop = clip),
            })
            {
                var clip = AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/Kits/temperate/Audio/{file}.ogg");
                if (clip == null)
                {
                    throw new InvalidDataException($"the kit's loop {file}.ogg is not in the project: run Assets/Kits/temperate/fetch.sh and git lfs pull");
                }
                if (clip != held)
                {
                    assign(clip);
                    changed = true;
                }
            }

            // The kit's terrain layers are the owner's (DEC-953, day 1). Until all three are
            // committed the ground is painted in plain colours.
            TerrainLayer[] layers = new[] { "meadow", "path", "gravel" }
                .Select(name => AssetDatabase.LoadAssetAtPath<TerrainLayer>($"Assets/Kits/temperate/TerrainLayers/{name}.terrainlayer")).ToArray();
            if (layers.Any(layer => layer == null))
            {
                layers = new TerrainLayer[0];
            }
            if (app.TerrainLayers == null || !layers.SequenceEqual(app.TerrainLayers))
            {
                app.TerrainLayers = layers;
                changed = true;
            }
            if (changed)
            {
                EditorUtility.SetDirty(app);
            }
            if (changed)
            {
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene);
            }
        }

        static bool SetObject(GameObject wanted, GameObject held, System.Action<GameObject> assign)
        {
            if (wanted == held)
            {
                return false;
            }
            assign(wanted);
            return true;
        }

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
            ["dirt"] = ("earth", new Color(0.50f, 0.41f, 0.27f)),
            ["woodInner"] = ("reed", new Color(0.55f, 0.52f, 0.26f)),
            ["_defaultMat"] = ("pale", new Color(0.70f, 0.67f, 0.50f)),
        };

        static KitProp ModelOf(PropKind kind)
        {
            string path = $"Assets/Kits/temperate/Props/{kind.Model}.fbx";
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            MeshFilter filter = model == null ? null : model.GetComponentInChildren<MeshFilter>();
            if (filter == null)
            {
                throw new InvalidDataException($"the kit's prop {path} is not in the project: run Assets/Kits/temperate/fetch.sh and git lfs pull");
            }
            Material[] materials = filter.GetComponent<MeshRenderer>().sharedMaterials.Select(theirs =>
            {
                if (!KitColours.TryGetValue(theirs.name, out (string name, Color colour) ours))
                {
                    throw new InvalidDataException($"{path} uses the material {theirs.name}, which the kit has no colour for");
                }
                return Lit($"temperate-{ours.name}", ours.colour, 0f, 0.15f, "Assets/Kits/temperate/Materials");
            }).ToArray();
            return new KitProp { Mesh = filter.sharedMesh, Materials = materials };
        }

        static GameObject WaterPrefab(string name, WaterSurfaceType type)
        {
            const string folder = "Assets/Kits/temperate/Water";
            Directory.CreateDirectory(folder);
            string path = $"{folder}/{name}.prefab";
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null)
            {
                var made = new GameObject(name);
                var surface = made.AddComponent<WaterSurface>();
                surface.surfaceType = type;
                surface.geometryType = WaterGeometryType.Quad;
                prefab = PrefabUtility.SaveAsPrefabAsset(made, path);
                Object.DestroyImmediate(made);
            }
            return prefab;
        }

        static bool Set(Material wanted, Material held, System.Action<Material> assign)
        {
            if (wanted == held)
            {
                return false;
            }
            assign(wanted);
            return true;
        }

        // The slice's materials are plain colours until the kit's art replaces them: the plinth's is
        // the card's rarity in four steps (PRD v4 5.5.1), stone, bronze, silver and gold-veined.
        // Each is made once, under `Assets/Kits/core/Materials/` or its kit's folder, and then left
        // alone.
        static Material Lit(string name, Color colour, float metallic, float smoothness, string folder = MaterialFolder)
        {
            return Made(name, "HDRP/Lit", material =>
            {
                material.SetColor("_BaseColor", colour);
                material.SetFloat("_Metallic", metallic);
                material.SetFloat("_Smoothness", smoothness);
            }, folder);
        }

        // `cutout`: the material draws nothing where its colour map's alpha is under a half.
        static Material Unlit(string name, Color colour, bool transparent, bool cutout = false)
        {
            return Made(name, "HDRP/Unlit", material =>
            {
                material.SetColor("_UnlitColor", colour);
                material.SetFloat("_SurfaceType", transparent ? 1 : 0);
                material.SetFloat("_AlphaCutoffEnable", cutout ? 1 : 0);
                material.SetFloat("_AlphaCutoff", 0.5f);
            });
        }

        static Material Made(string name, string shader, System.Action<Material> set, string folder = MaterialFolder)
        {
            Directory.CreateDirectory(folder);
            string path = $"{folder}/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find(shader)) { name = name };
                set(material);
                HDMaterial.ValidateMaterial(material);
                AssetDatabase.CreateAsset(material, path);
                AssetDatabase.SaveAssets();
            }
            return material;
        }

        // The repository's copy of a pack, which the pipeline commits (PRD v4 8.2.1).
        public static string RepositoryPack(string packHash) =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", packHash));

        public static string ProjectPack(string packHash) => Path.Combine(Application.streamingAssetsPath, "data", packHash);

        public static WorldFiles.Result Build(string packHash, string slug)
        {
            WorldFiles.Result world = WorldFiles.Generate(RepositoryPack(packHash), ProjectPack(packHash), slug);
            AssetDatabase.Refresh();
            return world;
        }
    }
}
