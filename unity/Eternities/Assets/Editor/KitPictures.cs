using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Kits;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.EditorTools
{
    // Pictures of a kit's props (DEC-1003), for the owner's eye and a reviewer's: the prefabs of a
    // category stood in rows on the kit's meadow under Dominaria's sun, seen from the avatar's eye
    // height at the quality level named. A row is at most `Row` metres wide, so a prop is seen
    // from about as near as a walker passes it. Nothing is saved but the pictures.
    //
    //   batchmode.sh -executeMethod Eternities.EditorTools.KitPictures.Run -picturesOut <dir> [-picturesQuality medium] [-picturesSunKelvin 5000]
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

            EditorSceneManager.OpenScene(Generate.HubScene, OpenSceneMode.Single);
            Camera camera = Camera.main;
            Light sun = Object.FindObjectsByType<Light>(FindObjectsSortMode.None).First(light => light.type == LightType.Directional);
            sun.transform.rotation = Temperate.Sun(Temperate.SunElevation, Temperate.SunAzimuth);
            sun.colorTemperature = kelvin == null ? Temperate.SunKelvin : float.Parse(kelvin, System.Globalization.CultureInfo.InvariantCulture);
            Ground();

            // The flat models of the first slice first, so a category's first row has them beside
            // what replaces them.
            var flat = new HashSet<string>(KitPrefabs.Temperate.Select(source => KitPrefabs.Path("temperate", source.Prefab)));
            foreach (IGrouping<string, string> category in PropRule.Props().Where(prop => prop.Kit == "Assets/Kits/temperate").Select(prop => prop.Path)
                .GroupBy(path => Path.GetFileName(Path.GetDirectoryName(path))))
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
                        var target = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                        camera.targetTexture = target;
                        for (int frame = 0; frame < Frames; frame++)
                        {
                            camera.Render();
                            yield return true;
                        }
                        Save(camera, target, Path.Combine(output, $"{category.Key}-{row}-{name}-{quality}.png"));
                    }
                    Object.DestroyImmediate(stood);
                }
            }
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
