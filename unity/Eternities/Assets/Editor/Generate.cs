using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Travel;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;

namespace Eternities.EditorTools
{
    // The batchmode scene generation entry point (PRD v4 8.2.5). It makes what the slice needs and an
    // engineer does not write by hand, from the pinned pack and nothing else, so a reviewer
    // reproduces the slice's world from the command line:
    //
    // - not committed: the part of the pack the slice reads, copied from `web/public/data/<hash>/`
    //   to `StreamingAssets/data/<hash>/` with every file checked against the pack's manifest, and
    //   each world's layout beside it, `layout/<slug>.txt` (`WorldFiles.Generate`);
    // - committed: the slice's plain materials under `Assets/Kits/core/Materials/`, and the
    //   persistent scene, `Assets/Scenes/Hub.unity`.
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
            changed |= Set(Lit("hub-ground", new Color(0.09f, 0.09f, 0.12f), 0f, 0.5f), app.HubGroundMaterial, m => app.HubGroundMaterial = m);
            changed |= Set(Lit("portal-frame", new Color(0.12f, 0.11f, 0.10f), 0.6f, 0.5f), app.PortalFrameMaterial, m => app.PortalFrameMaterial = m);
            changed |= Set(Unlit("portal-surface", new Color(0.35f, 0.75f, 1f, 1f), transparent: false), app.PortalSurfaceMaterial, m => app.PortalSurfaceMaterial = m);
            changed |= Set(Unlit("veil", new Color(0, 0, 0, 1), transparent: true), app.VeilMaterial, m => app.VeilMaterial = m);

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
        // Each is made once, under `Assets/Kits/core/Materials/`, and then left alone.
        static Material Lit(string name, Color colour, float metallic, float smoothness)
        {
            return Made(name, "HDRP/Lit", material =>
            {
                material.SetColor("_BaseColor", colour);
                material.SetFloat("_Metallic", metallic);
                material.SetFloat("_Smoothness", smoothness);
            });
        }

        static Material Unlit(string name, Color colour, bool transparent)
        {
            return Made(name, "HDRP/Unlit", material =>
            {
                material.SetColor("_UnlitColor", colour);
                material.SetFloat("_SurfaceType", transparent ? 1 : 0);
            });
        }

        static Material Made(string name, string shader, System.Action<Material> set)
        {
            Directory.CreateDirectory(MaterialFolder);
            string path = $"{MaterialFolder}/{name}.mat";
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
