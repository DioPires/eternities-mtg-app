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
    // - committed: the stand materials and the persistent scene, `Assets/Scenes/Hub.unity`.
    //
    // A missing argument or a failure throws, and the editor turns an exception in an
    // `-executeMethod` target into exit code 1.
    public static class Generate
    {
        // The slice has one world (PRD v4 9.5).
        public static readonly string[] Worlds = { "dominaria" };

        public const string HubScene = "Assets/Scenes/Hub.unity";
        const string StandMaterialFolder = "Assets/Kits/core/Materials";

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

        // Everything the entry point makes: each world's files, the stand materials and the
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
            Material[] materials = StandMaterials();
            if (app.StandMaterials == null || !materials.SequenceEqual(app.StandMaterials))
            {
                app.StandMaterials = materials;
                EditorUtility.SetDirty(app);
                changed = true;
            }
            if (changed)
            {
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene);
            }
        }

        // The plinth's material is the card's rarity, in four steps (PRD v4 5.5.1): stone, bronze,
        // silver, gold-veined. The fifth is the slab behind the image surface. They are plain lit
        // colours until the kit's art replaces them; each is made once and then left alone.
        static Material[] StandMaterials()
        {
            (string Name, Color Colour, float Metallic, float Smoothness)[] wanted =
            {
                ("plinth-common-stone", new Color(0.46f, 0.45f, 0.43f), 0f, 0.25f),
                ("plinth-uncommon-bronze", new Color(0.55f, 0.36f, 0.20f), 0.8f, 0.45f),
                ("plinth-rare-silver", new Color(0.72f, 0.73f, 0.75f), 0.9f, 0.6f),
                ("plinth-mythic-gold", new Color(0.83f, 0.62f, 0.22f), 0.9f, 0.65f),
                ("stand-slab", new Color(0.05f, 0.05f, 0.06f), 0f, 0.3f),
            };
            Directory.CreateDirectory(StandMaterialFolder);
            var materials = new Material[wanted.Length];
            for (int i = 0; i < wanted.Length; i++)
            {
                string path = $"{StandMaterialFolder}/{wanted[i].Name}.mat";
                materials[i] = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (materials[i] != null)
                {
                    continue;
                }
                var material = new Material(Shader.Find("HDRP/Lit")) { name = wanted[i].Name };
                material.SetColor("_BaseColor", wanted[i].Colour);
                material.SetFloat("_Metallic", wanted[i].Metallic);
                material.SetFloat("_Smoothness", wanted[i].Smoothness);
                HDMaterial.ValidateMaterial(material);
                AssetDatabase.CreateAsset(material, path);
                materials[i] = material;
            }
            AssetDatabase.SaveAssets();
            return materials;
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
