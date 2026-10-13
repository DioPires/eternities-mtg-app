using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Kits;
using Eternities.Travel;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.EditorTools
{
    // Pictures of a kit's props (DEC-1003), for the owner's eye and a reviewer's: the prefabs of a
    // category stood in rows on the kit's meadow under Dominaria's sun, seen from the avatar's eye
    // height at the quality level named. A row is at most `Row` metres wide, so a prop is seen
    // from about as near as a walker passes it. Nothing is saved but the pictures.
    //
    //   batchmode.sh -executeMethod Eternities.EditorTools.KitPictures.Run -picturesOut <dir> [-picturesQuality medium] [-picturesSunKelvin 5000] [-picturesVariant meadow|all [-picturesTime <frames>]] [-picturesCategory Trees]
    //
    // With `-picturesVariant`, the pictures are of the kit's variants and not of its props one
    // by one: a patch of ground painted with the variant's layers and dressed with its props at
    // the density of the quality level, seen from the avatar's eye height where a walker stands
    // in it, looking north and looking toward the sun.
    //
    // No `-quit`: a picture is kept after the editor has run some sixty frames on it, so that the
    // sky's light on the shaded sides and the exposure have settled, and the editor exits by
    // itself after the last.
    //
    // A grey post 1.8 m tall stands at the left of each row, for scale. Each row is taken twice:
    // looking north, with the sun behind the camera's left shoulder, and looking back toward the
    // sun, where leaves that let too much light through show pale.
    public static class KitPictures
    {
        const int Width = 1920, Height = 1080;
        // A timed run renders at the reference machine's display, as the bench's figures of record do.
        const int TimedWidth = 3456, TimedHeight = 2234;
        const float Eye = 1.6f;
        // How wide a row is, by category, in metres: ground cover is a hand high and is seen from
        // a step away, a tree from across a clearing.
        static readonly Dictionary<string, float> Rows = new Dictionary<string, float> { ["GroundCover"] = 2.5f, ["Bushes"] = 7, ["Trees"] = 30 };
        const float Row = 12;
        const int Frames = 60;

        public static void Run()
        {
            // The level in force is the project's own setting, and the editor writes it out as it
            // exits: it is put back first.
            int level = QualitySettings.GetQualityLevel();
            IEnumerator<bool> pictures = Pictures();
            void Step()
            {
                try
                {
                    if (!pictures.MoveNext())
                    {
                        EditorApplication.update -= Step;
                        QualitySettings.SetQualityLevel(level, true);
                        EditorApplication.Exit(0);
                    }
                }
                catch (System.Exception failure)
                {
                    Debug.LogException(failure);
                    QualitySettings.SetQualityLevel(level, true);
                    EditorApplication.Exit(1);
                }
            }
            EditorApplication.update += Step;
        }

        // One step an editor frame.
        static IEnumerator<bool> Pictures()
        {
            string output = CommandLine.Require("-picturesOut");
            string quality = CommandLine.Optional("-picturesQuality") ?? "medium";
            string kelvin = CommandLine.Optional("-picturesSunKelvin");
            Directory.CreateDirectory(output);
            int level = System.Array.IndexOf(QualitySettings.names, quality);
            if (level < 0)
            {
                throw new InvalidDataException($"no quality level is named {quality}");
            }
            QualitySettings.SetQualityLevel(level, true);

            string named = CommandLine.Optional("-picturesVariant");
            if (named != null)
            {
                // The scene as the generation entry point leaves it, with the variants in it.
                Generate.PersistentScene();
            }
            EditorSceneManager.OpenScene(Generate.HubScene, OpenSceneMode.Single);
            Camera camera = Camera.main;
            Light sun = Object.FindObjectsByType<Light>(FindObjectsSortMode.None).First(light => light.type == LightType.Directional);
            sun.transform.rotation = Temperate.Sun(Temperate.SunElevation, Temperate.SunAzimuth);
            sun.colorTemperature = kelvin == null ? Temperate.SunKelvin : float.Parse(kelvin, System.Globalization.CultureInfo.InvariantCulture);
            if (named != null)
            {
                App app = Object.FindAnyObjectByType<App>();
                KitVariant[] scene = app.KitVariants;
                bool any = false;
                for (int i = 0; i < Variants.Temperate.Length; i++)
                {
                    Variant variant = Variants.Temperate[i];
                    if (named != "all" && named != variant.Name)
                    {
                        continue;
                    }
                    any = true;
                    GameObject patch = Dress(variant, scene[i], app.GroundMaterials.Last(), Temperate.Density(quality));
                    // Toward the sun: its azimuth is clockwise from north.
                    float toSun = Temperate.SunAzimuth * Mathf.Deg2Rad;
                    foreach ((string name, Vector3 ahead) in new[] { ("north", Vector3.forward), ("sun", new Vector3(Mathf.Sin(toSun), 0, Mathf.Cos(toSun))) })
                    {
                        camera.transform.position = new Vector3(0, Eye, 0);
                        camera.transform.LookAt(new Vector3(0, Eye, 0) + ahead * 12 + Vector3.down * 1.2f);
                        foreach (bool step in Shot(camera, Path.Combine(output, $"variant-{variant.Name}-{name}-{quality}.png")))
                        {
                            yield return step;
                        }
                    }
                    string timed = CommandLine.Optional("-picturesTime");
                    if (timed != null)
                    {
                        camera.transform.position = new Vector3(0, Eye, 0);
                        camera.transform.LookAt(new Vector3(0, Eye, 12) + Vector3.down * 1.2f);
                        foreach (bool step in Timed(camera, patch, variant, int.Parse(timed), quality, Path.Combine(output, $"variant-{variant.Name}-time-{quality}.json")))
                        {
                            yield return step;
                        }
                    }
                    Object.DestroyImmediate(patch);
                }
                if (!any)
                {
                    throw new InvalidDataException($"the kit has no variant named {named}: {string.Join(", ", Variants.Temperate.Select(variant => variant.Name))}");
                }
                yield break;
            }
            Ground();

            // The flat models of the first slice first, so a category's first row has them beside
            // what replaces them.
            var flat = new HashSet<string>(KitPrefabs.Temperate.Select(source => KitPrefabs.Path("temperate", source.Prefab)));
            string only = CommandLine.Optional("-picturesCategory");
            foreach (IGrouping<string, string> category in PropRule.Props().Where(prop => prop.Kit == "Assets/Kits/temperate").Select(prop => prop.Path)
                .GroupBy(path => Path.GetFileName(Path.GetDirectoryName(path))).Where(category => only == null || category.Key == only))
            {
                var left = new Queue<string>(category.OrderBy(path => flat.Contains(path) ? 0 : 1).ThenBy(path => path));
                for (int row = 1; left.Count > 0; row++)
                {
                    var stood = new GameObject(category.Key);
                    float width = Stand(stood.transform, left, Rows.TryGetValue(category.Key, out float wide) ? wide : Row, out float tallest);
                    // Far enough back to hold the row and its tallest prop.
                    float back = Mathf.Max(1.5f, 0.55f * width + 0.5f, 1.2f * tallest);
                    foreach ((string name, float side) in new[] { ("north", -1f), ("sun", 1f) })
                    {
                        camera.transform.position = new Vector3(width / 2, Eye, side * back);
                        camera.transform.LookAt(new Vector3(width / 2, Mathf.Min(tallest / 2, Eye), 0));
                        foreach (bool step in Shot(camera, Path.Combine(output, $"{category.Key}-{row}-{name}-{quality}.png")))
                        {
                            yield return step;
                        }
                    }
                    Object.DestroyImmediate(stood);
                }
            }
        }

        // A picture from where the camera stands, kept after the editor has run its frames on it.
        static IEnumerable<bool> Shot(Camera camera, string path)
        {
            var target = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            camera.targetTexture = target;
            for (int frame = 0; frame < Frames; frame++)
            {
                camera.Render();
                yield return true;
            }
            Save(camera, target, path);
        }

        // What a dressed patch costs to draw, for the hand-back's frame cost (DEC-1003; leg 2's
        // row R judges it): the north view rendered `frames` times with all the variant's props,
        // as many with all but its ground cover, and as many with none, in turns of a tenth, each
        // frame timed from the start of its render to the end of the GPU's work on it. The editor
        // renders off screen and one frame at a time, so a frame here is longer than a player's,
        // whose CPU and GPU overlap: what it gives is the difference between the runs.
        static IEnumerable<bool> Timed(Camera camera, GameObject patch, Variant variant, int frames, string quality, string path)
        {
            var target = new RenderTexture(TimedWidth, TimedHeight, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            camera.targetTexture = target;
            var cover = new HashSet<string>(variant.Grows.Where(growth => growth.Category == "GroundCover").Select(growth => growth.Name));
            string[] runs = { "all", "no cover", "none" };
            void Dressed(int run)
            {
                foreach (Transform child in patch.transform)
                {
                    if (child.GetComponent<Terrain>() == null)
                    {
                        child.gameObject.SetActive(run == 0 || (run == 1 && !cover.Contains(child.name)));
                    }
                }
            }
            var series = runs.Select(run => new List<double>()).ToArray();
            var clock = new System.Diagnostics.Stopwatch();
            int turn = Mathf.Max(10, frames / 10);
            for (int done = -Frames; done < runs.Length * frames; done++)
            {
                int run = done < 0 ? 0 : (done / turn) % runs.Length;
                if (done >= 0 && done % turn == 0)
                {
                    Dressed(run);
                }
                clock.Restart();
                camera.Render();
                AsyncGPUReadback.Request(target, 0, 0, 1, 0, 1, 0, 1).WaitForCompletion();
                clock.Stop();
                // The first frames of a turn are not counted: the pipeline's history settles on them.
                if (done >= 0 && done % turn >= 5)
                {
                    series[run].Add(clock.Elapsed.TotalMilliseconds);
                }
                yield return true;
            }
            Dressed(0);
            camera.targetTexture = null;
            target.Release();
            double Percentile(List<double> one, int percent)
            {
                List<double> sorted = one.OrderBy(ms => ms).ToList();
                return sorted[Mathf.Clamp(Mathf.CeilToInt(percent / 100f * sorted.Count) - 1, 0, sorted.Count - 1)];
            }
            string Ms(double ms) => ms.ToString("F3", System.Globalization.CultureInfo.InvariantCulture);
            string Figures(List<double> one) => $"{{\"count\": {one.Count}, \"p50Ms\": {Ms(Percentile(one, 50))}, \"p90Ms\": {Ms(Percentile(one, 90))}, \"p99Ms\": {Ms(Percentile(one, 99))}}}";
            int props = patch.transform.Cast<Transform>().Count(child => child.GetComponent<Terrain>() == null);
            int covers = patch.transform.Cast<Transform>().Count(child => cover.Contains(child.name));
            string report = $"{{\"variant\": \"{variant.Name}\", \"quality\": \"{quality}\", \"size\": \"{TimedWidth}x{TimedHeight}\", \"props\": {props}, \"groundCover\": {covers}, "
                + $"\"all\": {Figures(series[0])}, \"noCover\": {Figures(series[1])}, \"none\": {Figures(series[2])}, "
                + $"\"p90DeltaMs\": {Ms(Percentile(series[0], 90) - Percentile(series[2], 90))}, \"p90DeltaNoCoverMs\": {Ms(Percentile(series[1], 90) - Percentile(series[2], 90))}}}\n";
            File.WriteAllText(path, report);
            Debug.Log($"KitPictures: {report}");
        }

        // How wide the dressed patch is, in metres: the walker stands at its middle, and bushes,
        // rocks and trees stand out to its edge.
        const float Patch = 240;

        // A patch of ground painted with a variant's layers and dressed with its props, as the
        // scene holds them, at a share of its full density.
        static GameObject Dress(Variant variant, KitVariant held, Material groundMaterial, float density)
        {
            uint seed = (uint)Eternities.Layout.SplitMix64.Fnv1a64($"eternities-v4|variant|{variant.Name}");
            var patch = new GameObject(variant.Name);
            const int Resolution = 1024;
            var data = new TerrainData { name = variant.Name, heightmapResolution = 33, alphamapResolution = Resolution };
            data.size = new Vector3(Patch, 1, Patch);       // after the resolutions, which reset it
            data.terrainLayers = held.Layers;
            var alphas = new float[Resolution, Resolution, held.Layers.Length];
            Variants.Paint(variant, alphas, Patch, seed);
            data.SetAlphamaps(0, 0, alphas);
            GameObject ground = Terrain.CreateTerrainGameObject(data);
            ground.transform.SetParent(patch.transform, false);
            ground.transform.localPosition = new Vector3(-Patch / 2, 0, -Patch / 2);
            // A copy: a terrain sets its layers' keywords on its material, and the scene's is a file.
            ground.GetComponent<Terrain>().materialTemplate = new Material(groundMaterial);

            var counts = new int[variant.Grows.Length];
            foreach (Prop prop in Variants.Scatter(variant, Patch, density, seed, Vector2.zero))
            {
                Growth growth = variant.Grows[prop.Kind];
                held.Props[prop.Kind].Stand(growth.Name, patch.transform, new Vector3(prop.X, 0, prop.Z), prop.Yaw, prop.Scale, shadow: growth.Category != "GroundCover");
                counts[prop.Kind]++;
            }
            Debug.Log($"KitPictures: {variant.Name} at {density:P0} of its density: {counts.Sum()} props on {Patch} m x {Patch} m, of them "
                + string.Join(", ", variant.Grows.Select((growth, kind) => (growth.Category, counts[kind])).GroupBy(one => one.Category).Select(group => $"{group.Sum(one => one.Item2)} {group.Key}")));
            return patch;
        }

        // The kit's meadow, as the world lays it: a plain 400 m across.
        static void Ground()
        {
            var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>($"{Generate.LayerFolder}/meadow.terrainlayer");
            var material = new Material(Shader.Find("HDRP/Lit"));
            material.SetTexture("_BaseColorMap", layer.diffuseTexture);
            material.SetColor("_BaseColor", new Color(layer.diffuseRemapMax.x, layer.diffuseRemapMax.y, layer.diffuseRemapMax.z));
            material.SetTexture("_NormalMap", layer.normalMapTexture);
            material.SetTexture("_MaskMap", layer.maskMapTexture);
            material.SetTextureScale("_BaseColorMap", Vector2.one * (400 / layer.tileSize.x));
            HDMaterial.ValidateMaterial(material);
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.transform.localScale = Vector3.one * 40;
            ground.GetComponent<MeshRenderer>().sharedMaterial = material;
        }

        // The next prefabs along x from 0, as many as a row holds and one at least, each clear of
        // the last by a third of its width, after a post of a walker's height. Returns the row's
        // width.
        static float Stand(Transform parent, Queue<string> paths, float row, out float tallest)
        {
            GameObject post = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            post.transform.SetParent(parent, false);
            post.transform.localScale = new Vector3(0.06f, 0.9f, 0.06f);
            post.transform.localPosition = new Vector3(0, 0.9f, 0);
            float at = 0.2f;
            tallest = 0;
            for (int stood = 0; paths.Count > 0; stood++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(paths.Peek());
                Bounds bounds = PropRule.Of(prefab).Bounds;
                if (stood > 0 && at + 1.33f * bounds.size.x > row)
                {
                    break;
                }
                paths.Dequeue();
                at += Mathf.Max(0.1f, bounds.size.x * 0.33f) - bounds.min.x;
                var prop = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
                prop.transform.localPosition = new Vector3(at, 0, 0);
                at += bounds.max.x;
                tallest = Mathf.Max(tallest, bounds.max.y);
            }
            return at + 0.2f;
        }

        // The camera's last frame as a PNG.
        static void Save(Camera camera, RenderTexture target, string path)
        {
            RenderTexture.active = target;
            var picture = new Texture2D(Width, Height, TextureFormat.RGB24, false);
            picture.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
            File.WriteAllBytes(path, picture.EncodeToPNG());
            RenderTexture.active = null;
            camera.targetTexture = null;
            Object.DestroyImmediate(picture);
            target.Release();
            Debug.Log($"KitPictures: {path}");
        }
    }
}
